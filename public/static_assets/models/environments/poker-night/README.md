# Poker Night furnishing models

Nine canonical project-authored GLBs under the repository license. The original
eight furnishings (chair, sideboard, pendant, carafe, tumbler, landscape, rug and
curtained window) retain the sources recorded in companion
`poker_night_v1/runtime/export-report.json`. The approved source hash is
`62d76ab2db5e4dbc07eb58d63293bc7b1716ec44e7734ea3f723e70a0c62e585`;
current curtain/tieback edits are preserved in the existing runtime source.

`poker-door.glb` is a new derivative of approved companion
`room_backwalls_v1/poker-backwall-v2.blend`, SHA-256
`60aab360dad4af0960f269d674045200b7c8db71ee9d1cf77144a4bf5e7a7d44`.
It contains paneled walnut joinery, a small upper three-light glazed opening and
brass hardware. Origin is floor/door center, glTF Y-up/front +Z, metres; the room
scales by seven. The side stiles/casing join without coplanar overlaps. UV grain
follows the long axis of each piece. The inset door sits on the south wall, offset
right in the reverse seated view; plaster and wainscot/trim are clipped around it.
Runtime nearly clear glazing disables depth writes; phones omit its blended pass.
No interactive door, collider, game rule, extra light or saved-state field is added.

The narrow `room_backwalls_v1/export_backwalls.py` uses the existing evaluated,
material-batched export recipe and portable-alpha adaptation. The source is never
saved by export. Review room/table, staging, background and lights are excluded.
Canonical publishing records exact decoded geometry/material/image fingerprints
and source/candidate desktop/touch comparisons in the model manifest. Nine GLBs
total 4,136,108 bytes from 6,164,592 raw export bytes.

New geometry/material adaptations are project originals. Walnut color reuses the
already credited CC0 Luke.RUSTLTD map; other project leather/curtain/landscape/rug
maps and owner edits retain their prior credits. No external asset is downloaded.
See the app's `docs/ASSET_CREDITS.md` and `docs/PLAN_ROOM_THEMES.md` for source and
verification details. Runtime model URLs remain canonical under this directory.
