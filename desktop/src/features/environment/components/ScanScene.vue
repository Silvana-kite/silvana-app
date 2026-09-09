<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Cpu } from 'lucide-vue-next';
import { AmbientLight, BoxGeometry, CylinderGeometry, DirectionalLight, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, RingGeometry, Scene, TorusGeometry, WebGLRenderer } from 'three';
import { useWizardStore } from '../stores/wizard';

const props = defineProps<{ scanning: boolean }>();
const wizard = useWizardStore();
const host = ref<HTMLDivElement>();
const failed = ref(false);
let renderer: WebGLRenderer | undefined;
let scene: Scene | undefined;
let observer: ResizeObserver | undefined;
let frame = 0;
let lastRender = 0;
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
onMounted(() => {
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf7f8fa, 0);
    renderer.domElement.setAttribute('aria-label', '全息芯片扫描视图');
    renderer.domElement.setAttribute('role', 'img');
    host.value!.append(renderer.domElement);
    scene = new Scene();
    const camera = new PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(5.1, 5.6, 6.5);
    camera.lookAt(0, 0, 0);
    scene.add(new AmbientLight(0xffffff, 2.8));
    const key = new DirectionalLight(0xffffff, 5);
    key.position.set(3, 7, 3);
    scene.add(key);
    const rim = new DirectionalLight(0x43cdb9, 3);
    rim.position.set(-5, 2, -3);
    scene.add(rim);
    const chip = new Group();
    const metal = new MeshStandardMaterial({ color: 0xb4c4c7, metalness: 0.65, roughness: 0.28 });
    const core = new MeshPhysicalMaterial({ color: 0x153e40, metalness: 0.55, roughness: 0.18, clearcoat: 1 });
    const glow = new MeshStandardMaterial({ color: 0x7efce0, emissive: 0x25bb9d, emissiveIntensity: 0.55, roughness: 0.25 });
    chip.add(new Mesh(new BoxGeometry(2.22, 0.16, 2.22), metal));
    const lid = new Mesh(new BoxGeometry(1.85, 0.3, 1.85), core);
    lid.position.y = 0.2;
    chip.add(lid);
    const edge = new LineSegments(new EdgesGeometry(lid.geometry), new LineBasicMaterial({ color: 0x5be3c6, transparent: true, opacity: 0.8 }));
    edge.position.copy(lid.position);
    chip.add(edge);
    for (let side = 0; side < 4; side++) {
      const pins = new Group();
      for (let i = 0; i < 10; i++) {
        const pin = new Mesh(new BoxGeometry(0.1, 0.07, 0.32), metal);
        pin.position.set(-0.87 + i * 0.194, -0.015, 1.23);
        pins.add(pin);
      }
      pins.rotation.y = side * Math.PI / 2;
      chip.add(pins);
    }
    // Etched traces keep the chip legible without a text texture.
    for (let i = 0; i < 5; i++) {
      const line = new Mesh(new BoxGeometry(0.055, 0.012, 0.8 + (i % 2) * 0.35), glow);
      line.position.set((i - 2) * 0.19, 0.357, 0);
      chip.add(line);
    }
    chip.rotation.y = -0.15;
    chip.position.y = 0.23;
    scene.add(chip);
    const platform = new Mesh(new CylinderGeometry(2.05, 2.12, 0.045, 96), new MeshPhysicalMaterial({ color: 0xe1eeeb, transparent: true, opacity: 0.38, metalness: 0.25, roughness: 0.3 }));
    platform.position.y = -0.58;
    scene.add(platform);
    for (const radius of [1.65, 2.1, 2.6]) {
      const ring = new Mesh(new TorusGeometry(radius, 0.009, 8, 128), new MeshStandardMaterial({ color: 0x73b7ad, transparent: true, opacity: radius === 2.6 ? 0.2 : 0.5 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.55;
      scene.add(ring);
    }
    const sweep = new Mesh(new RingGeometry(0.3, 2.07, 64, 1, 0, Math.PI / 3), new MeshStandardMaterial({ color: 0x34c5ac, transparent: true, opacity: 0.22, side: 2 }));
    sweep.rotation.x = -Math.PI / 2;
    sweep.position.y = -0.53;
    scene.add(sweep);
    const resize = () => {
      const width = host.value?.clientWidth ?? 1;
      const height = host.value?.clientHeight ?? 1;
      renderer!.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer!.render(scene!, camera);
    };
    observer = new ResizeObserver(resize);
    observer.observe(host.value!);
    resize();
    function render(time: number) {
      frame = requestAnimationFrame(render);
      if (document.hidden || time - lastRender < 33) return;
      lastRender = time;
      const reduced = preference.matches || wizard.motion === 'reduced';
      chip.position.y = reduced ? 0.23 : 0.23 + Math.sin(time / 1600) * 0.06;
      sweep.visible = props.scanning;
      if (!reduced && props.scanning) sweep.rotation.z = -time / 600;
      glow.emissiveIntensity = props.scanning && !reduced ? 0.8 + Math.sin(time / 200) * 0.4 : 0.55;
      renderer!.render(scene!, camera);
    }
    frame = requestAnimationFrame(render);
    renderer.domElement.addEventListener('webglcontextlost', () => { failed.value = true; cancelAnimationFrame(frame); });
  } catch { failed.value = true; }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  scene?.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
    }
  });
  renderer?.dispose();
  renderer?.domElement.remove();
});
</script>
<template><div ref="host" class="scan-scene" :class="{ 'has-failed': failed }"><div v-if="failed" class="scan-scene__fallback"><Cpu :size="100" :stroke-width="1" /></div></div></template>
<style scoped>
.scan-scene { position: absolute; inset: 0; }.scan-scene :deep(canvas) { display: block; width: 100%; height: 100%; }.has-failed :deep(canvas) { display: none; }.scan-scene__fallback { display: grid; height: 100%; place-items: center; color: #188f80; }
</style>
