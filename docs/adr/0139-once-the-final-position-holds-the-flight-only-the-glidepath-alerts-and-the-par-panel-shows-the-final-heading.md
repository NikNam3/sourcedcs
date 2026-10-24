# 0139: Once the final Position holds the flight only the glidepath alerts; the PAR panel shows the final heading

**Status.** Accepted (lane U-PAR-FT, 2026-10-24). Rulings: decisions.md **H164** (FT-Q5 a + note, FT-Q7 c + note, FT-Q8
note), **S-ARCH-93** (the APRT centreline is 3° off), H160 (N airfields, no literal ids), ADR 0132 (rules name roles).
**Supersedes H134 LT-RQ8 a for the PAR final** (and ADR 0117's "altitude until Begin descent"); LT-RQ9 a (no heading
check on a final) stands and is widened. Builds on ADR 0112 (the PAR sample), 0117 (the PAR final), 0123 (the
elevation limits), 0130 (the approach values), 0058 (conformance).

## Context

In the final test the human handed a track at 4,000 ft to PAR; PAR said "descend and maintain 3,000" (an intermediate
altitude, not the final descent) and got a level-bust alert. Conformance checked the altitude until "Begin descent",
so PAR's own clearances alerted against the altitude AP had assigned. The human's ruling (FT-Q8): once PAR has the
flight, no conformance alerts at all, only a warning when the track leaves the glideslope. The same round asked for the
heading that holds the final course on the PAR panel, with the aircraft's own beside it (FT-Q5), for the azimuth
autoscale to go while zoom stays (FT-Q7 c), and S-ARCH-93 found the APRT extended centreline drawn on the runway number
read as magnetic, 3° off the pavement at Incirlik.

## Decision

### 1. Held by the final Position: nothing of the clearance is checked

`src/efsp/final-position.js` decides who is "on a final" from Facility data, never an id: the **final Positions** of a
Facility are those that own a Bay with `view: 'final'` (Incirlik's PAR, the carrier's two lane controllers; any number of
Facilities and finals). A flight is held on a final while its FINAL Strip is owned by one of them and is ON_FINAL (or the
carrier's BALL). For such a flight `ConformanceMonitor` checks **no HEADING, no LEVEL_BUST, no WRONG_WAY** — from the
handoff on, before Begin descent too. The literal `'CARRIER'` the old `finals` map compared against is gone: the carrier
and the airfield are the same rule now, and the only difference (no glidepath at sea) follows from there being no PAR
sample there.

Why: the final controller works the flight on its own frequency with continuous guidance ("HEADING (heading)", JO
7110.65BB para 5-12-4) and its own intermediate altitudes; course and glidepath deviation are its calls. An alert against
AP's last assignment is noise, and one against PAR's own instruction is the controller alerting itself.

**The missed approach is still checked** (¶5-10-12: the climb-out is "a specific heading and altitude"; H137). It no
longer counts as on a final: at an airfield the `MISSED_APPROACH` conversion hands the Strip back to AP as an ARRIVAL,
and a drag into PAR's missed-approach Bay makes it BOLTER_WAVEOFF, which is not a final state. Either way the climb-out
heading and altitude are the flight's clearance again and alert as any arrival's. That holds because a missed approach
is an assignment the pilot must fly exactly, unlike the talk-down's continuous corrections.

### 2. GLIDESLOPE: the one alert on a PAR final

After **Begin descent** is recorded (from it the glidepath is the reference, ¶5-12-3/5-12-4), above **decision altitude**
(H116: below DA the pilot decides), the PAR monitor's latest plot more than `glidepathAboveDeg` (1°) above or
`glidepathBelowDeg` (0.5°) below the glidepath for `glidepathPersistSec` (2 s) raises a conformance alert
`{ kind: 'GLIDESLOPE', side: 'ABOVE'|'BELOW', devDeg, limitDeg, since }`. The limits are `config/alerting.json`'s, equal
to the PAR panel's default tolerance lines (ADR 0123; a parity test holds them together); a controller's own panel
tolerance setting moves the drawn lines and the instant red, not the alert. A plot older than NO PLOT (3 s), an INOP
elevation or no plot raises nothing (`ParMonitor#glidepathOf`). Nothing raised it before: the panel only coloured the
plot. Ours: the order has no automated glidepath alert; the persistence and the use of the panel defaults are ours.

It is shown where FT-Q8 asked, in the existing alert style: the PAR panel's EL row in the same red (`BELOW GLIDEPATH` /
`ABOVE GLIDEPATH`) and a red `GP ↓` / `GP ↑` chip on the Strip. The map data block is unchanged.

### 3. The final heading and the aircraft's heading (FT-Q5)

The PAR sample gains `headings: { needed, current, windFrom, windKt }`, whole degrees **magnetic** (H15): `needed` is the
final approach course (true) plus the wind correction angle `asin(wind × sin(wind from − course) / TAS)`, the TAS being
the aircraft's ground vector (DCS's course and groundspeed, grid → true) less the wind; `current` is DCS's heading, grid
→ true → magnetic. The wind is the airfield's, from the same per-airport DCS weather the tower and ATIS read (H76;
`app/airport-weather.js`, now built before the monitors). No wind, or a crosswind the aircraft cannot hold: `needed` is
null and shown "—", never the bare course passed off as a heading. The panel reads `FIN HDG` then `HDG` on the deviation
row, grey (a picture, not an instruction, H115; the word "need" stays off the panel), and draws a heading tick on the
azimuth scope: a ±10° scale in the middle of its top edge, a grey mark at the final heading (labelled), a magenta one at
the aircraft's heading, hollow at the edge when it is further off. The tick's form is ours.

### 4. The azimuth window is fixed (FT-Q7 c)

`autoscaleView` sets the range and the elevation height only; the azimuth window stays where it is, **±3°** by default
(three times the ±1° tolerance, so a track a little off the course stays in sight). Shift+wheel on the azimuth scope zooms
it without pausing autoscale; a double-click puts it back to ±3° (and resumes autoscale as before). There was never a pan
(H115 anchors touchdown); none was added.

### 5. The APRT extended centreline on the runway end's true heading (S-ARCH-93)

The runway-status record on the wire names its `airportIcao`. When a record names the APRT panel's airfield and the
typed runway is one of its ends, the centreline is drawn on that end's `endHeadingsTrue` (052.7 / 232.7 at Incirlik).
An airfield no Facility describes keeps the old fallback, the runway number × 10 as magnetic, converted by crc-sync. The
line still starts at the airfield reference point, not the threshold (unchanged).

## Consequences

- Wire: the PAR sample's `headings` (recorded by `wire:record`, protocol stays 2: already ahead of the last release);
  the runway-status record's `airportIcao` is record content (not scanned, no bump needed); a new conformance alert
  kind, `GLIDESLOPE`, which a client that does not know it ignores.
- Freeze goldens that hash runway-status records change by the new key.
- A controller who never records Begin descent gets no glidepath alert on that approach.
- The glidepath limits are server-wide (`alerting.json`, `state/` overridable), not per controller.
