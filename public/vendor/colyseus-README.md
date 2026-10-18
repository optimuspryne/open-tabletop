# Colyseus browser SDK

Vendored unchanged from **@colyseus/sdk@0.18.5**, published 2026-10-03,
verified against the npm registry on 2026-10-16.

- Artifact: [npm tarball](https://registry.npmjs.org/@colyseus/sdk/-/sdk-0.18.5.tgz).
- Tarball integrity: `sha512-wHlUCq+oPeiI74mNM5p6yr8WE5EBJXwNxVIPnov7D8+Q/F6p7dyjWec3PfKOSv9or3uP5OjsCYKPwlC2hkxlHQ==`.
- Shipped file: `package/dist/colyseus.js`, including its original copyright header.
- SHA-256: `96557215f2411918b1eed792ed99983ff3df129cf9512fa12a0faf89a11410f4`.
- Header records embedded `@colyseus/schema 5.0.8`; this is distinct from the
  server's locked schema 5.0.40. The full-server/browser test verifies decoding
  and per-client view filtering across that pair.
- License: MIT, Endel Dreyer. The unchanged upstream license ships alongside the
  bundle as [colyseus-LICENSE.txt](colyseus-LICENSE.txt), including in Docker.

The bundle provides the existing `Colyseus` UMD global and stays self-hosted at
`/vendor/colyseus.js`. No source maps, debug bundle, CDN, build step or CSP
relaxation is required. The SDK feature-detects eval and uses its fallback under
our enforced policy; this artifact was tested with that policy.

The coordinated server set is core **0.18.18**, ws-transport **0.18.4** and schema
**5.0.40**. See the [upgrade record](../../docs/COLYSEUS_018_ASSESSMENT.md) for peer
requirements, caller changes, tests and remaining manual acceptance. Replace
server and client together; refresh browsers after restarting the app.
