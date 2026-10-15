# meshoptimizer JavaScript decoder

Vendored unchanged from `meshoptimizer@0.24.0` (MIT):
`meshopt_decoder_reference.js`, SHA-256
`2fad1a37ec276ddd0e1eaa1b389f2fcb1d57d684cbcb38de4116a95ba8925ef3`.

Source: <https://github.com/zeux/meshoptimizer/tree/v0.24/js>.
Author: Arseny Kapoulkine; reference JavaScript decoder by Jasper St. Pierre.
The complete upstream license is retained as `LICENSE.md`.

The bundled path in `rendering/model-loader.js` uses this JavaScript implementation
to decode all built-in lossless GLBs without WebAssembly compilation, eval, generated
workers, external requests or a build step. It implements Three.js's Meshopt
interface (`supported`, `ready`, `decodeGltfBuffer`). The adapter is shared by
gameplay, previews, collider editing and rooms; only
exact canonical bundled allowlist URLs use it. Other URLs (including uploads,
blobs, data and external models) use an ordinary GLTFLoader without this decoder.

Upstream labels the reference implementation educational and not performance
optimized. We use it deliberately to retain the app's existing enforced CSP,
which does not permit WebAssembly compilation. The shipped shelf's complete 117
compressed views decode to 10,768,776 bytes in approximately 52 ms in an isolated
local Node measurement; this is not a mobile/browser performance guarantee.
Reference-decoder publishing compares every source/candidate attribute, oriented triangle and image.
Normal tests pin decoded buffers/images and browser material/animation/hierarchy
baselines, loading/rendering all 101 canonical models under strict CSP.

Do not replace this with the WASM module without reviewing CSP compatibility and
failure handling. Keep untrusted payloads outside the decoder path. Recheck
compressed assets, phone cold loading, disposal, and resizing
when updating this decoder or shelf export.
