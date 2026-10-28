# perf prototype (reference only)

Throwaway prototype from the planning phase. It proves the approach; it is not the
production code. Step 0 of docs/wip/TOLD.md rebuilds this properly.

What it shows:

- `extraction/extract.py` reads Figures B2-1, B2-2 and B2-3 (Appendix B, F110-GE-129)
  from the vector data of the HAF supplement PDF and writes `engine/data.json`.
  Axis calibration from tick labels snapped to grid lines, curve chaining,
  dash joining, order and physics checks. Panel geometry is hard-coded here;
  in step 0 it moves into one YAML spec per figure (see TOLD.md 0.5).
- `extraction/overlay.py` draws the extracted curves in red over the page for review.
- `engine/engine.js` interpolates curve families and guideline panels.
- `engine/test.js` runs the manual's sample problems. All pass within 0.5 %.

Run (PDF not in the repo; SHA-256 7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b):

    python3 -I extraction/extract.py <manual.pdf> engine/data.json
    python3 -I extraction/overlay.py <manual.pdf> engine/data.json <outdir>
    node engine/test.js "$PWD/engine/data.json"

Page indices are 0-based (B2-1 = 283, B2-2 = 284, B2-3 = 285).
