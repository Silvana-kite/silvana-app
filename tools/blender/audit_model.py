import json
import os
import sys
from collections import Counter

import bpy
from mathutils import Vector


def script_arg(index: int) -> str:
    try:
        separator = sys.argv.index("--")
    except ValueError as exc:
        raise SystemExit("Expected arguments after --") from exc
    try:
        return sys.argv[separator + 1 + index]
    except IndexError as exc:
        raise SystemExit("Missing output path") from exc


def resolved_image_path(image: bpy.types.Image) -> str:
    if not image.filepath:
        return ""
    return bpy.path.abspath(image.filepath, library=image.library)


def object_bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]] | None:
    corners = []
    for obj in objects:
        if obj.type != "MESH" or not obj.visible_get():
            continue
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)

    if not corners:
        return None

    minimum = [min(corner[axis] for corner in corners) for axis in range(3)]
    maximum = [max(corner[axis] for corner in corners) for axis in range(3)]
    return {
        "min": [round(value, 6) for value in minimum],
        "max": [round(value, 6) for value in maximum],
        "size": [round(maximum[i] - minimum[i], 6) for i in range(3)],
    }


def object_bound_size(obj: bpy.types.Object) -> list[float] | None:
    if obj.type != "MESH":
        return None
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = [min(corner[axis] for corner in corners) for axis in range(3)]
    maximum = [max(corner[axis] for corner in corners) for axis in range(3)]
    return [round(maximum[i] - minimum[i], 6) for i in range(3)]


output_path = os.path.abspath(script_arg(0))
scene = bpy.context.scene
mesh_objects = [obj for obj in scene.objects if obj.type == "MESH"]

object_types = Counter(obj.type for obj in scene.objects)
modifier_types = Counter(
    modifier.type
    for obj in mesh_objects
    for modifier in obj.modifiers
    if modifier.show_viewport
)

total_vertices = 0
total_polygons = 0
total_triangles = 0
total_evaluated_triangles = 0
largest_meshes = []
depsgraph = bpy.context.evaluated_depsgraph_get()
for obj in mesh_objects:
    mesh = obj.data
    mesh.calc_loop_triangles()
    vertices = len(mesh.vertices)
    polygons = len(mesh.polygons)
    triangles = len(mesh.loop_triangles)
    total_vertices += vertices
    total_polygons += polygons
    total_triangles += triangles
    evaluated_obj = obj.evaluated_get(depsgraph)
    evaluated_mesh = evaluated_obj.to_mesh()
    evaluated_mesh.calc_loop_triangles()
    evaluated_triangles = len(evaluated_mesh.loop_triangles)
    total_evaluated_triangles += evaluated_triangles
    evaluated_obj.to_mesh_clear()
    largest_meshes.append({
        "name": obj.name,
        "data": mesh.name,
        "vertices": vertices,
        "polygons": polygons,
        "triangles": triangles,
        "evaluated_triangles": evaluated_triangles,
        "materials": [
            slot.material.name if slot.material else None
            for slot in obj.material_slots
        ],
        "modifiers": [
            {
                "name": modifier.name,
                "type": modifier.type,
                "levels": getattr(modifier, "levels", None),
                "render_levels": getattr(modifier, "render_levels", None),
            }
            for modifier in obj.modifiers
            if modifier.show_viewport
        ],
        "visible": obj.visible_get(),
    })

largest_meshes.sort(key=lambda item: item["triangles"], reverse=True)

images = []
for image in bpy.data.images:
    resolved = resolved_image_path(image)
    packed = bool(image.packed_file or image.packed_files)
    images.append({
        "name": image.name,
        "source": image.source,
        "size": list(image.size),
        "filepath": image.filepath,
        "packed": packed,
        "exists": packed or image.source in {"GENERATED", "VIEWER"} or bool(resolved and os.path.exists(resolved)),
    })

report = {
    "source": bpy.data.filepath,
    "blender_version": bpy.app.version_string,
    "scene": scene.name,
    "render_engine": scene.render.engine,
    "unit_settings": {
        "system": scene.unit_settings.system,
        "scale_length": scene.unit_settings.scale_length,
        "length_unit": scene.unit_settings.length_unit,
    },
    "counts": {
        "objects": len(scene.objects),
        "object_types": dict(sorted(object_types.items())),
        "collections": len(bpy.data.collections),
        "meshes": len(bpy.data.meshes),
        "materials": len(bpy.data.materials),
        "images": len(bpy.data.images),
        "actions": len(bpy.data.actions),
        "vertices": total_vertices,
        "polygons": total_polygons,
        "triangles": total_triangles,
        "evaluated_triangles": total_evaluated_triangles,
    },
    "visible_bounds": object_bounds(list(scene.objects)),
    "modifier_types": dict(sorted(modifier_types.items())),
    "largest_meshes": largest_meshes[:100],
    "images": images,
    "missing_images": [image for image in images if not image["exists"]],
    "materials": [material.name for material in bpy.data.materials],
    "actions": [action.name for action in bpy.data.actions],
    "collections": {
        collection.name: [obj.name for obj in collection.objects]
        for collection in bpy.data.collections
    },
    "collection_stats": {
        collection.name: {
            "objects": len(collection.all_objects),
            "bounds": object_bounds(list(collection.all_objects)),
            "triangles": sum(
                item["triangles"]
                for item in largest_meshes
                if any(member.name == item["name"] for member in collection.all_objects)
            ),
            "evaluated_triangles": sum(
                item["evaluated_triangles"]
                for item in largest_meshes
                if any(member.name == item["name"] for member in collection.all_objects)
            ),
        }
        for collection in bpy.data.collections
    },
    "objects": [
        {
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "collections": [collection.name for collection in obj.users_collection],
            "visible": obj.visible_get(),
            "hide_render": obj.hide_render,
            "bound_size": object_bound_size(obj),
        }
        for obj in scene.objects
    ],
}

os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, "w", encoding="utf-8") as output_file:
    json.dump(report, output_file, ensure_ascii=False, indent=2)

print(f"SIILVANA_AUDIT={output_path}")
