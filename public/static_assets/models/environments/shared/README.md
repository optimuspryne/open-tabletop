# Shared furnished-room scenery

`gray-pup-in-bed.glb` is the owner-approved all-gray terrier lying in a blue bed.
It appears in the southwest/front-left open corner of Cozy, Poker Night, Medieval
Tavern and Modern Bar, facing the table; Standard remains skybox-only.

- glTF Y-up, metres, ground origin at Y=0; authored bed width/depth is approximately
  0.6314 × 0.5478 m, total height 0.2849 m. Runtime scale is seven.
- 227,104 triangles, 14 material batches, no textures, skinning or animation.
- Canonical lossless Meshopt payload: 4,765,964 bytes; ordinary derivative:
  7,450,420 bytes. Exact hashes/decoded metadata are in `../../manifest.json`.
- Original geometry/materials under the repository license; see
  [asset credits](../../../../../docs/ASSET_CREDITS.md).
- The accepted detailed Blender master remains unchanged in companion
  `Open-Tabletop_Asset_Builders/3d_models/original/pup_in_bed_v2/`.
  `pup_room_integration_v1/` retains the approved mockups, separate runtime exporter,
  uncompressed derivative, source hash and actual room render checks.

`public/rendering/rooms/room-companion.js` owns shared asset/placement constants and
the bed fallback. The normal room assembly owns loading, replacement, contact
shadow, phone policy, picking exclusion and disposal. Refresh clients after updates;
no server restart, migration or gameplay collision is introduced.
