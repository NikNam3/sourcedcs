### Changed: FAA vocabulary (read this first)
- Positions are renamed after the FAA's operating-position designators: Tower is now **LC** (Local Control), Ground is **GC** (Ground Control), Approach is **AP**. Their Bays follow (`lc-…`, `gc-…`, `ap-…`). `OPS`, `CD`, `RSU`, `SFA`, `PAR`, `CTR` and the tactical and carrier Positions keep their names
- The FIELD STATE panel is now **RUNWAY STATUS**; the short-term conflict alert tag is now **CA** (Conflict Alert); Block 5's label is **BEACON** (the assigned code); a Strip's Role is now its **strip type**; "FDR" is **flight data**
- Positions are **staffed / unstaffed** (not occupied / unmanned), you **sign on** to them (not hold them), and an unstaffed Position's Strips go to the Position it is **consolidated at** (not its covering Position); a coordination that is waiting is **INITIATED** (not PROPOSED)
- `docs/glossary.md` maps every old word to the new one; the controller's guide and the usage guide use the new words
- The server's EFSP state is reset with this release (no migration): open Strips, the Mutation log and the runway status start empty. Your saved panel layout may reset once
- For the server operator: before deploying client and server together, edit `infra/.env` (rename `ASACS_DOMAIN`/`ASACS_URL` to `CRCSYNC_DOMAIN`/`CRCSYNC_URL` if set; the old names are no longer read) and wipe the `efsp-*` files in the `crc-sync-state` volume

### New
- Radar line-of-sight: radars now respect terrain — a target can be masked by mountains/terrain between it and the radar, instead of every radar seeing straight through the ground within its range ring
- Ground/ship radars use a realistic assumed antenna height (airborne radars still use live altitude) so LOS masking isn't unrealistically easy to trigger
- LOS terrain profile chart: hover a radar in the RADARS panel (with Radar Debug on) to see a terrain-vs-distance chart along its current beam, with the sight line and exactly where it's blocked
- Elevation contour overlay, toggleable under Settings → Map Overlays
- In-app update indicator in the topbar (checking / downloading % / ready-to-restart), so you can see and control an update without digging through logs
- "What's New" dialog after an update installs, showing what changed in the new version
