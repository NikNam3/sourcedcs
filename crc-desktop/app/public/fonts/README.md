# Map glyphs

Signed-distance-field glyph ranges (`{font}/{range}.pbf`) for the scope's labels, served by `app/server.js` at `/fonts/`
so no label, and no track, depends on MapTiler. Taken unchanged from the openmaptiles/fonts v2.0 release
(https://github.com/openmaptiles/fonts/releases/tag/v2.0), only the ranges the client draws.

- Roboto Regular, Roboto Medium: Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0), Google.
- Noto Sans Regular: SIL Open Font License 1.1 (https://openfontlicense.org), Google.

Roboto Mono is not in that release; its stacks fall back to Roboto. A range not shipped answers an empty 200.
