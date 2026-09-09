# Mistral source asset

`mistral.blend` is the original project source, moved from the repository root without modifying its contents.

The runtime asset remains `desktop/public/models/mistral/mistral-web.glb`.
Use the Blender scripts in `tools/blender/` to audit or export the source. Blender itself is an external development tool and is not stored in this repository.

The original audit identified one unpacked, already missing image, `noir.png`. Other file textures were packed into the source. The existing runtime GLB is self-contained; moving the source does not change its assets.

Generated audits, previews, and conversion reports belong in `artifacts/models/mistral/`.
