import json
import os
import sys

import bpy


COLLECTION_NAME = "Bugatti Mistral 2024 Car"
RIM_PREFIX = "Subdiv#104"


def script_arg(index: int, default: str | None = None) -> str:
    try:
        separator = sys.argv.index("--")
        return sys.argv[separator + 1 + index]
    except (ValueError, IndexError):
        if default is not None:
            return default
        raise SystemExit("Missing required script argument")


def collect_images(node_tree: bpy.types.NodeTree | None, found: set[bpy.types.Image]) -> None:
    if not node_tree:
        return
    for node in node_tree.nodes:
        image = getattr(node, "image", None)
        if image:
            found.add(image)
        nested_tree = getattr(node, "node_tree", None)
        if nested_tree and nested_tree != node_tree:
            collect_images(nested_tree, found)


output_path = os.path.abspath(script_arg(0))
report_path = os.path.abspath(script_arg(1, output_path + ".json"))
max_texture_size = int(script_arg(2, "2048"))

collection = bpy.data.collections.get(COLLECTION_NAME)
if collection is None:
    raise SystemExit(f'Collection "{COLLECTION_NAME}" was not found')

export_objects = list(collection.all_objects)
export_meshes = [obj for obj in export_objects if obj.type == "MESH"]

for obj in export_meshes:
    for modifier in obj.modifiers:
        if modifier.type != "SUBSURF":
            continue
        limit = 1 if obj.name.startswith(RIM_PREFIX) else 2
        modifier.levels = min(modifier.levels, limit)
        modifier.render_levels = min(modifier.render_levels, limit)

used_materials = {
    slot.material
    for obj in export_meshes
    for slot in obj.material_slots
    if slot.material
}
used_images: set[bpy.types.Image] = set()
for material in used_materials:
    collect_images(material.node_tree, used_images)

scaled_images = []
for image in used_images:
    width, height = image.size
    if width <= 0 or height <= 0 or max(width, height) <= max_texture_size:
        continue
    scale = max_texture_size / max(width, height)
    target_width = max(1, round(width * scale))
    target_height = max(1, round(height * scale))
    image.scale(target_width, target_height)
    scaled_images.append({
        "name": image.name,
        "from": [width, height],
        "to": [target_width, target_height],
    })

bpy.ops.object.select_all(action="DESELECT")
for obj in export_objects:
    obj.hide_set(False)
    obj.select_set(True)

if export_meshes:
    bpy.context.view_layer.objects.active = export_meshes[0]

os.makedirs(os.path.dirname(output_path), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_path,
    check_existing=False,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_yup=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_image_quality=85,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_attributes=False,
    export_skins=False,
    export_morph=False,
)

report = {
    "source": bpy.data.filepath,
    "output": output_path,
    "collection": COLLECTION_NAME,
    "objects": len(export_objects),
    "mesh_objects": len(export_meshes),
    "materials": len(used_materials),
    "images": len(used_images),
    "max_texture_size": max_texture_size,
    "scaled_images": scaled_images,
    "output_bytes": os.path.getsize(output_path),
}

with open(report_path, "w", encoding="utf-8") as output_file:
    json.dump(report, output_file, ensure_ascii=False, indent=2)

print(f"SIILVANA_EXPORT={output_path}")
print(f"SIILVANA_EXPORT_BYTES={report['output_bytes']}")
