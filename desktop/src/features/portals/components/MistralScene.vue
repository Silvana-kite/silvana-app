<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, type ComponentPublicInstance } from 'vue';
import {
  ACESFilmicToneMapping,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type CameraView = 'front' | 'side' | 'rear' | 'top';
type SceneTheme = 'light' | 'dark';

const props = withDefaults(defineProps<{
  modelUrl?: string;
  paintColor?: string;
  autoRotate?: boolean;
  cameraView?: CameraView;
  theme?: SceneTheme;
}>(), {
  modelUrl: '/models/mistral/mistral-web.glb',
  paintColor: '#ffd21f',
  autoRotate: true,
  cameraView: 'front',
  theme: 'light',
});

const emit = defineEmits<{
  progress: [value: number];
  ready: [];
  error: [message: string];
}>();

let host: HTMLDivElement | null = null;
let renderer: WebGLRenderer | null = null;
let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let model: Group | null = null;
let resizeObserver: ResizeObserver | null = null;
let frameId = 0;
let environmentTarget: ReturnType<PMREMGenerator['fromScene']> | null = null;
let floorMaterial: MeshPhysicalMaterial | null = null;
const paintMaterials = new Set<MeshStandardMaterial>();
const target = new Vector3(0, 0.62, 0);

const viewPositions: Record<CameraView, Vector3> = {
  front: new Vector3(5.3, 2.25, 6.1),
  side: new Vector3(6.6, 1.75, 0.15),
  rear: new Vector3(-4.9, 2.1, -6.2),
  top: new Vector3(4.5, 5.5, 4.9),
};

function responsiveViewPosition(view: CameraView) {
  const aspect = camera?.aspect ?? 1.6;
  const scale = aspect < 0.7 ? 1.92 : aspect < 1 ? 1.5 : 1;
  return viewPositions[view].clone().sub(target).multiplyScalar(scale).add(target);
}

function assignHost(element: Element | ComponentPublicInstance | null) {
  host = element instanceof HTMLDivElement ? element : null;
}

function updateSize() {
  if (!host || !renderer || !camera) return;
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (controls) setCameraView(props.cameraView);
}

function setCameraView(view: CameraView) {
  if (!camera || !controls) return;
  camera.position.copy(responsiveViewPosition(view));
  controls.target.copy(target);
  controls.update();
}

function updatePaint(color: string) {
  for (const material of paintMaterials) {
    material.color.set(color);
    if (material instanceof MeshPhysicalMaterial) {
      material.clearcoat = Math.max(material.clearcoat, 0.82);
      material.clearcoatRoughness = 0.16;
    }
    material.needsUpdate = true;
  }
}

function updateTheme(theme: SceneTheme) {
  if (scene) scene.background = new Color(theme === 'dark' ? '#15191d' : '#d9dde1');
  floorMaterial?.color.set(theme === 'dark' ? '#272d31' : '#b8bdc1');
  if (floorMaterial) {
    floorMaterial.roughness = theme === 'dark' ? 0.42 : 0.32;
    floorMaterial.needsUpdate = true;
  }
  if (renderer) renderer.toneMappingExposure = theme === 'dark' ? 0.92 : 1.08;
}

function prepareModel(root: Group) {
  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());
  root.position.set(-center.x, -bounds.min.y + 0.018, -center.z);

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = window.innerWidth >= 768;
    object.receiveShadow = false;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      material.envMapIntensity = 1.15;
      const name = material.name.toLowerCase();
      if (name.includes('carpaint') || name.includes('car paint') || name === 'mistral') {
        paintMaterials.add(material);
        material.metalness = 0.72;
        material.roughness = 0.2;
      } else if (name === 'glass.002') {
        material.color.set('#182127');
        material.metalness = 0;
        material.roughness = 0.08;
        material.transparent = true;
        material.opacity = 0.38;
        material.depthWrite = false;
      } else if (name.includes('chrome')) {
        material.metalness = 1;
        material.roughness = 0.16;
      } else if (name.includes('carbon')) {
        material.metalness = 0.28;
        material.roughness = 0.34;
      } else if (name.includes('tire') || name.includes('rubber')) {
        material.metalness = 0;
        material.roughness = 0.82;
      } else if (name === 'daylights') {
        material.emissive.set('#d8efff');
        material.emissiveIntensity = 2.6;
      } else if (name === 'red light') {
        material.emissive.set('#8f0714');
        material.emissiveIntensity = 1.4;
      }
    }
  });

  updatePaint(props.paintColor);
}

function renderLoop() {
  if (!renderer || !scene || !camera || !controls) return;
  controls.update();
  renderer.render(scene, camera);
  frameId = window.requestAnimationFrame(renderLoop);
}

function disposeScene() {
  window.cancelAnimationFrame(frameId);
  resizeObserver?.disconnect();
  controls?.dispose();
  environmentTarget?.dispose();
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  scene?.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (material instanceof Material) materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  renderer?.dispose();
  renderer?.domElement.remove();
  paintMaterials.clear();
}

onMounted(() => {
  if (!host) return;

  try {
    renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: import.meta.env.DEV,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.35 : 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = window.innerWidth >= 768;
    renderer.domElement.setAttribute('aria-label', 'Bugatti Mistral 2024 三维模型');
    host.appendChild(renderer.domElement);

    scene = new Scene();
    scene.background = new Color(props.theme === 'dark' ? '#15191d' : '#d9dde1');

    camera = new PerspectiveCamera(33, 1, 0.05, 80);
    camera.position.copy(viewPositions[props.cameraView]);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 24;
    controls.minPolarAngle = 0.45;
    controls.maxPolarAngle = 1.52;
    controls.autoRotate = props.autoRotate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.72;
    controls.target.copy(target);
    controls.update();

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environmentTarget = pmrem.fromScene(room, 0.04);
    scene.environment = environmentTarget.texture;
    room.dispose();
    pmrem.dispose();

    scene.add(new HemisphereLight('#edf5ff', '#69645b', 1.65));
    const keyLight = new DirectionalLight('#fff8ee', 4.2);
    keyLight.position.set(5, 7, 4);
    keyLight.castShadow = window.innerWidth >= 768;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -5;
    keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5;
    keyLight.shadow.camera.bottom = -5;
    scene.add(keyLight);

    const rimLight = new DirectionalLight('#b8d8ff', 2.8);
    rimLight.position.set(-5, 3, -4);
    scene.add(rimLight);

    floorMaterial = new MeshPhysicalMaterial({
      color: props.theme === 'dark' ? '#272d31' : '#b8bdc1',
      roughness: props.theme === 'dark' ? 0.42 : 0.32,
      metalness: 0.05,
    });
    const floor = new Mesh(new PlaneGeometry(80, 80), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    updateSize();
    resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(host);

    new GLTFLoader().load(
      props.modelUrl,
      (gltf) => {
        model = gltf.scene;
        prepareModel(model);
        scene?.add(model);
        emit('progress', 100);
        emit('ready');
      },
      (event) => {
        const progress = event.total > 0 ? Math.round((event.loaded / event.total) * 100) : 0;
        emit('progress', Math.min(progress, 99));
      },
      (error) => {
        console.error('Unable to load Mistral model', error);
        emit('error', '模型加载失败，请检查显存或资源文件。');
      },
    );

    renderLoop();
  } catch (error) {
    console.error('Unable to initialize WebGL showroom', error);
    emit('error', '当前设备无法初始化 WebGL 场景。');
  }
});

watch(() => props.paintColor, updatePaint);
watch(() => props.theme, updateTheme);
watch(() => props.autoRotate, (value) => {
  if (controls) controls.autoRotate = value;
});
watch(() => props.cameraView, setCameraView);

onBeforeUnmount(disposeScene);
</script>

<template>
  <div :ref="assignHost" class="mistral-scene" />
</template>
