# Map glyphs

Signed-distance-field glyph ranges (`{font}/{range}.pbf`) for the scope's labels, served by `app/server.js` at `/fonts/`
so no label, and no track, depends on MapTiler. Taken unchanged from the openmaptiles/fonts v2.0 release
(https://github.com/openmaptiles/fonts/releases/tag/v2.0), only the ranges the client draws.

- Roboto Regular, Roboto Medium: Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0), Google.
- Noto Sans Regular: SIL Open Font License 1.1 (https://openfontlicense.org), Google.

A font stack (`Roboto Regular,Noto Sans Regular`) is answered **merged** by `app/glyph-route.js`: the shipped fonts' files
for the range are concatenated fallback first, primary last (maplibre keeps the last glyph per code point), so Noto Sans
fills what Roboto lacks (the `↑`/`↓` trend arrows, `▲▼`, `≠ ≤ ≥`). Roboto Mono is not in that release; its stacks are
answered with Roboto of the same weight, and a stack with no shipped font with Roboto Regular. A range not shipped answers an
empty 200. The `.pbf` files are binary in git (`.gitattributes`).
