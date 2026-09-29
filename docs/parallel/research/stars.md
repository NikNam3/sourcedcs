# STARS (and ERAM) presentation: a reference for the ATC draw scheme

Research for decision **H5** (`docs/parallel/decisions.md`): ATC Positions (TWR, APP/RAPCON, CTR) get
their own scope presentation modelled on the FAA's STARS. Military/GCI Positions keep the current
military scheme. Where a track is seen both by a military radar and an ATC radar that the session
holds, the military presentation wins. This file is input for the design and build lanes. It decides
nothing. Open questions for the owner are in §9.

## 0. Sources, and how far to trust each

Every claim below is tagged with where it comes from:

| Tag | Source | Weight |
|---|---|---|
| **[65]** | FAA Order **JO 7110.65BB**, *Air Traffic Control*, 2/20/25 — <https://www.faa.gov/documentLibrary/media/Order/7110.65BB_Basic_dtd_2-20-25.pdf> (HTML edition: <https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap5_section_4.html>) | Normative. The procedures controllers follow. Says little about pixels. |
| **[7210]** | FAA Order **JO 7210.3**, *Facility Operation and Administration*, §3-9-1 "Color Use on ATC Displays" — current HTML <https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap3_section_9.html>. The same text is in 7210.3CC (6/17/21) <https://www.faa.gov/documentLibrary/media/Order/7210.3CC_FAC_Bsc_dtd_6-17-21.pdf> | Normative. The **National Color Standard for Terminal Systems**. |
| **[HF08]** | FAA WJHTC Human Factors Team, *Moving Toward an Air Traffic Control Display Standard: A Standardized Color Palette for Terminal Situation Displays* (DOT/FAA/TC-08/15), 2008 — <https://hf.tc.faa.gov/publications/2008-moving-toward-an-air-traffic-control-display-standard/full_text.pdf> | FAA research. Measured the **actual STARS TCW RGB values** (Table 1) and recommends a palette (Table 3). The only public source of STARS numeric colours I found. |
| **[vNAS]** | vNAS CRC documentation, STARS and ERAM chapters — <https://docs.virtualnas.net/crc/stars/>, <https://docs.virtualnas.net/crc/eram/> | **Community** (VATSIM). Written to mimic the real systems closely, with illustrations. Good for layout and behaviour. Not authoritative. |
| **[vice]** | *vice* STARS simulator documentation — <https://pharr.org/vice/> | **Community** training simulator. Detailed on data-block behaviour. Not authoritative. |
| **[wiki]** | Wikipedia, *Standard Terminal Automation Replacement System* — <https://en.wikipedia.org/wiki/Standard_Terminal_Automation_Replacement_System> | Background only. |
| **[repo]** | This repository: ADR 0058, ADR 0059, `docs/efsp-usage-guide.md` §8/§8B/§8C/§8E/§8F, `crc-desktop/app/public/js/{track-label,geojson,map-setup,iff}.js`, `docs/parallel/wave1/L10.md` | What exists today. |
| **[inference]** | My own reasoning, where no source says it directly | Treat as a proposal. |

The STARS Operator's Manual, the Site Rules Document (SRD) and the TI 6191.x technical instruction
books are not public. Anything they alone would settle is marked **community** or **inference**.
Where the two community sources disagree, both are given (§1.4).

STARS is also the DoD's terminal system: it runs USAF RAPCONs, USN RATCFs and Army ARACs [wiki]. So a
STARS look is the correct one for Incirlik's RAPCON (`APP`) in its own right, not only for
civil approach control.

---

## 1. STARS display fundamentals

### 1.1 Background, maps, range rings

- **Background must be black** [7210 §3-9-1a1]. STARS TCW measured 0,0,0 [HF08 Table 1].
- **Compass rose and range rings must be dim gray. Maps A and B must be dim gray or yellow** [7210
  §3-9-1a3]. Measured STARS "Dim Gray" = **140,140,140** for maps A/B, compass rose and range rings
  [HF08 Table 1]. HF08 recommends dim gray at **35 % of the owned-data-block white's luminance** [HF08
  Table 3].
- Video maps are split into two brightness groups, **MPA** and **MPB**, each with its own BRITE
  control [vNAS "BRITE Submenu"]. In practice this gives two map layers, for example the airspace
  and approach map on A and the reference map on B.
- **Geographic restriction** (a controller-drawn area) border, fill and text **must be yellow** by
  default [7210 §3-9-1a4]. HF08 recommends 30 % yellow (**76,76,0**) for the fill [HF08 Table 3].
- Rules from the colour standard that apply to the whole scope [7210 §3-9-1b–i]:
  - critical information coded by colour **must also** be coded another way, **such as blinking**;
  - **red = warning** and **yellow = caution/highlight**; these conventions "cannot be violated";
  - **pure blue must not be used for text, small symbols or fine detail**;
  - keep colour to a minimum;
  - colour use must be **consistent across every display a single controller uses**.

  The last rule matters for §3 and §4: a controller holding both APP and CTR should see one scheme.

### 1.2 Brightness categories (the BRITE menu)

On STARS, brightness rather than hue carries a lot of meaning, and each category has its own
control. The DCB BRITE submenu lists [vNAS]:

| Control | Governs |
|---|---|
| `DCB` | the button bar |
| `MPA` / `MPB` | video map groups A and B |
| `FDB` | full data blocks (and the preview area) |
| `LST` | lists and the System Status Area |
| `POS` | position symbols of tracks **with** an FDB |
| `LDB` | limited **and partial** data blocks |
| `OTH` | position symbols of tracks **without** an FDB |
| `TLS` | tools: predicted track lines, min-sep lines, range/bearing lines |
| `RR` / `CMP` | range rings / compass rose |
| `BCN` | beacon target symbols (beacon target extent) |
| `PRI` | primary / search / fusion target symbols |
| `HST` | history trails |
| `WX` / `WXC` | weather and weather contrast |

Community simulators step these in 5 % increments [vice release notes]. **Dwell** mode brightens the
track and data block nearest the cursor. It can be `OFF`, `ON` or `LOCK` (stays on the last
track dwelt) [vice "Dwell Mode"].

HF08 fixes relative luminances where one colour is referenced to another. Green 4 (beacon extent,
lists) is 30 % of Green. History trail steps are 100/78/38/25/15 % of trail 1. Dim gray maps are
35 % of white [HF08 Table 3].

### 1.3 Target symbols (the radar return)

What is drawn depends on the radar mode [vice "Track Symbols"]:

- **FUSED** (the modern default): every track is a **small filled blue circle**. The position
  symbol (§1.4) is drawn on top of it. The vNAS illustrations show exactly this: a blue disc with the
  owner's letter in it [vNAS figures].
- **MULTI / SINGLE** (sensor modes): a blue **search-target rectangle**, oriented by heading in
  MULTI or toward the site in SINGLE, where its size grows with range. SINGLE adds a green **beacon
  target extent** line on the far side of the return [vice].
- The standard says: **search/fusion target symbols must be blue**, and **beacon target extent must be
  green** [7210 §3-9-1a7–8]. Measured STARS values: search target blue **30,120,255**, beacon extent
  green **0,255,0** [HF08 Table 1]. HF08 recommends Deep Sky Blue **0,191,255** for the search
  target and Green 4 **0,139,0** for the beacon extent [HF08 Table 3].

**Recommendation for this app [inference]:** draw FUSED only. The app has no per-sensor plots, and
the server already fuses radars per session (ADR 0059).

### 1.4 Position symbols (the single character on the target)

"All tracks have a single-character position symbol at their center that indicates which
controller owns the track" [vice "Position Symbols"].

| Track state | Position symbol | Source |
|---|---|---|
| **Associated, owned** by a controller in my facility | that controller's **sector letter** (my own letter if I own it) | [vice], [vNAS "Tracking Aircraft"] |
| Associated, owned by an adjacent **terminal** facility | that facility's ID character | [vice] |
| Associated, owned by an **en-route** (ARTCC) controller | **`C`** or the en-route facility ID | [vice], [vNAS "Inbound Handoffs"] |
| Unassociated, beacon (Mode 3/A) received | **`*`** (asterisk) | [vNAS "LDBs"], [vice] |
| Unassociated, code **1200** (VFR) | **`V`** | [vNAS] |
| Unassociated, code in the controller's **beacon-select list** | **square** (altitude-reporting) / **triangle** (not reporting) | [vNAS], [vice] |
| **Primary only** (no transponder) | **disagreement**: vNAS shows a **diamond** with no data block. vice says a **plus** for primary-only and a **diamond** for "transponder on, no altitude", and elsewhere a "triangle" that can be inhibited (`2PI`/`2PE`) | [vNAS "More Data Block Examples"], [vice "Untracked Aircraft", "Position Symbols"] |

The position symbol's brightness is `POS` when the track has an FDB and `OTH` when it does not
[vNAS]. When control is dropped, the symbol "will change back to an asterisk" [vNAS].

**Recommendation [inference]:** use `*` for an unassociated beacon track, and a small **`+`** for
primary-only, which is also ERAM's uncorrelated-primary symbol (§4). A diamond is easy to confuse
with the app's current `ac-iff-*` shapes. Record this as a deliberate choice, since the community
sources conflict.

### 1.5 History trails

- **History trails must be blue** [7210 §3-9-1a9]. STARS uses **five blues, fading with age**:
  **30,80,200 → 70,70,170 → 50,50,130 → 40,40,110 → 30,30,90** [HF08 Tables 1 and 3].
- They are drawn as small dots [vNAS figures, vice]. The count is 0–10 (`HISTORY`), and the interval
  is set by `H_RATE`: a dot is added on the first radar update after `H_RATE` seconds [vice].
- Trail colour **does not** encode ownership or identity. Every track's trail is the same blue.
  Only `HST` brightness changes it.

### 1.6 Leader lines

- A leader line joins the position symbol to the data block. The data block sits in **one of eight
  directions** chosen with the numeric keypad: 7=NW 8=N 9=NE 4=W 6=E 1=SW 2=S 3=SE, with 5 meaning
  "default" or "clear" [vNAS Table 8, vice].
- Length is **0–7** steps (DCB `LDR`) [vice]. The default direction for owned tracks is set with
  `LDR DIR`. Separate defaults exist for unassociated tracks (`L#U`), for other owners (`L#*`) and
  per TCP. A per-track direction can also be pushed system-wide (`L##`) [vice, vNAS command
  reference].
- The leader line takes the data block's colour and brightness (white when owned, green otherwise)
  [vNAS figures].
- **LDBs on ERAM** have no leader line (§4). On STARS they do (vNAS figures show a green leader on an
  LDB).

### 1.7 Other symbology worth knowing (mostly out of scope)

- **Predicted Track Line (PTL):** a straight line to where the track will be in *n* minutes (0.5–3
  min on vice). Can be shown for own tracks or for all. **Must be white** [7210 §3-9-1a10; vNAS; vice].
- **Minimum separation line:** **must be white** [7210 §3-9-1a11].
- **TPA/ATPA** J-rings and cones: TPA blue **30,20,255** [HF08]. Out of scope.
- **CRDA ghost targets:** yellow on the STARS TCW, orange **255,165,0** recommended by HF08. Out of
  scope.
- **Cyan** is a highlight colour: "Yellow and cyan are defined as highlight colors in the STARS
  Technical Manual Instruction Book" [7210.3CC change summary, §3-9-1]. A middle-click highlights
  a data block in cyan [vNAS].

---

## 2. Data blocks: FDB, PDB and LDB

### 2.1 What the rules require

- A data block **must display flight identification and altitude information, as a minimum**, and
  must be kept until the aircraft has left the sector and all potential conflicts are resolved,
  **including an aircraft that is a point out** [65 §5-3-9a, Terminal].
- In prearranged coordination, a controller penetrating another's airspace must display that
  controller's aircraft with **at minimum the position symbol and altitude** [65 §5-3-9b].
- "ASSOCIATED — A radar target displaying a data block with flight identification and altitude
  information." [65 Pilot/Controller Glossary]
- STARS may be used for "tracking, tagging, handoff, altitude information, coordination, ground
  speed, identification" [65 §5-14-3].
- **An assigned altitude, if displayed, must be kept current.** "Climb and descent arrows, where
  available, must be used to indicate other than level flight." [65 §5-14-4d]
- Mode C **altitude filters** must cover the whole of the controller's jurisdiction. Terminal: at
  least 1,000 ft above the highest and below the lowest altitude the position is responsible for
  [65 §5-2-21]. Filters hide data blocks, **except** point-outs and inbound handoffs, which always show
  [vice "Altitude Filters"].
- A Mode C readout is **valid** when it is within **300 ft** of the pilot's report, or of field
  elevation on the ground. It must be re-validated after track start, a track start from coast,
  an unreliable readout, or an interfacility handoff [65 §5-2-15].

### 2.2 The three formats (STARS)

**Limited Data Block (LDB)**: an **unassociated** track (no flight plan). All unassociated
tracks are unowned [vNAS].
```
  3657        ← line 1: beacon code (facility may inhibit codes in LDBs)
  023         ← line 2: Mode C altitude, hundreds of feet MSL
 *            ← position symbol on a blue target, green leader
```
- The default content is **code + altitude** [vNAS]. vice shows only altitude by default, with code
  and ground speed appearing briefly when the track is slewed. Facilities differ.
- A departure squawking a non-1200 code with no matching flight plan shows a **flashing `WHO`** after
  the code until it is clicked [vNAS, vice].
- Colour: **green** [7210 §3-9-1a6]. Brightness: `LDB`.

**Partial Data Block (PDB)**: an **associated** track **owned by someone else**. It shows "the same
information as shown on line 2 of a Full Data Block" [vNAS]:
```
  030  25     ← altitude (time-shares with scratchpad / other facility's ID)  ground speed in TENS of knots (+ CWT letter)
 M            ← owner's letter
```
- Green, and `LDB` brightness [7210; vNAS; vice]. Some sites suppress ground speed in PDBs.
- Clicking a PDB turns it into an FDB. Clicking again turns it back [vNAS, vice].

**Full Data Block (FDB)**: the working format. Shown when [vNAS, vice]:
- **I own the track**;
- it is being **handed off to me** (or redirected to or by me);
- it has been **pointed out to me** and the point-out is not yet cleared;
- I handed it off and the handoff **was accepted** (it stays an FDB until clicked back to a PDB);
- I clicked a PDB;
- I have Quick Look on its owner's TCP (or Quick Look all), or someone force-quicklooked it to me;
- it is squawking a **Special Purpose Code**, or has an active safety alert such as low altitude;
- it matches a code being searched with the "beaconator"/`**####`;
- it is an overflight and "overflight FDBs" is on.

FDB layout, as the community sims render it [vNAS "FDBs", vice "FDBs"; illustrations]:
```
  CA                          ← line 0: alerts / SPC in RED (CA, LA, EM, RF, HJ, MI, LL), blinking until acknowledged
  DAL276 PO1R                 ← line 1: aircraft ID; then indicators (PO + recipient, ▵ = CA inhibited, * = MSAW inhibited, + = both)
  005 D 28H                   ← line 2: [alt | scratchpad1 | scratchpad2+ | other-facility ID]  [handoff-recipient char]  [GS in tens of kt + CWT | type | R+requested alt]
           A240               ← line 3: received vs assigned beacon code if mismatched; temporary/assigned altitude "A###"
 D                            ← my letter on a blue target, white leader
```
- **Line 1:** the aircraft ID. Two- or three-letter ICAO designators are used [65 §5-14-5a].
- **Line 2 left field** time-shares **Mode C altitude**, **scratchpad 1**, **scratchpad 2** (shown
  with a trailing `+`), and during an inter-facility handoff the **receiving facility/sector ID**
  (for example `N86`) [vNAS, vice].
- **Line 2 middle:** **one character naming the handoff recipient** while a handoff is pending
  (`D` means going to sector D) [vNAS "Track being handed off", vice "Outbound Handoffs"].
- **Line 2 right field** time-shares **ground speed in tens of knots**, followed by a
  **category letter** (wake/CWT A–I, or legacy H/B/J/F/L/R, plus `V` for VFR and `E` for
  overflight), with the **aircraft type** and optionally **`R`+requested altitude** [vNAS, vice].
- **Line 3:** the **received code and the assigned code** when the aircraft is not squawking what it
  was assigned. The assigned code flashes, and the pair disappears when the codes match. **`A###`** is
  the controller-entered **assigned (temporary) altitude** [vNAS, vice]. This matches [65 §5-4-6e
  NOTE]: when the received code differs from the computer-assigned one, the site-adapted code
  (received, assigned or both) is shown, and its removal confirms identity.
- **Altitude format:** three digits in **hundreds of feet MSL**, for example `072` = 7,200 ft, `180`
  = FL180 [vNAS, vice]. **No "FL" prefix and no climb-rate digits.** A **pilot-reported** altitude
  is followed by **`*`** (`140*`) [vNAS]. With no Mode C and no report the field is **blank**, and vice
  shows a yellow `ISR` (increased separation required).
- **Coast:** `CST` replaces the altitude (`AAL961 / CST 14`). The position symbol remains at the
  extrapolated position **without** the blue target [vNAS "Coasting track" figure]. [65 §5-4-5e/5-4-6f]:
  initiate **verbal coordination** before transferring a track showing `CST`, `NONE`, `DATA`,
  `OLD`, `AMB`/`AM`, `NAT`/`NT`. **Coast tracks must not be used for separation** [65 §5-13-7,
  en-route text; same principle].
- Tracks coasting for 30 s go to the **Coast/Suspend list** and stay there for 5 min [vNAS].
- **Time-sharing period:** not given in any public source I found. Community sims alternate roughly
  every 1–2 s. **Treat any value as an approximation.**
- **Ident:** a flashing **`ID`**. In an FDB it replaces the category letter and hides the type while
  it lasts. An LDB shows code + `ID`, and a PDB shows `ID` at the end of line 2 [vice "Ident"].

### 2.3 Colour and blink states of a data block

| State | My scope | Other scope | Source |
|---|---|---|---|
| I own it | **white** FDB, my letter | green PDB | [7210 a5–a6], [vNAS] |
| Owned by another, not involving me | **green** PDB (FDB if I click) | — | [7210], [vNAS] |
| Unassociated | **green** LDB, `*`/`V`/□ | green LDB | [7210], [vNAS] |
| **Handoff to me, pending** | **flashing white FDB**; owner's letter still on the target | sender: FDB with **my character on line 2** | [vNAS "Accepting a Handoff", "Track being handed off"], [vice "Inbound Handoffs"] |
| **Handoff accepted** | white FDB, **my letter** | sender: **blinking white FDB for about 5 s**, symbol changes to my letter. One click stops the blink, a second turns it **green**, a third makes it a PDB | [vNAS "Handing Off a Target"], [vice "Outbound Handoffs"] |
| **Point-out to me, pending** | **flashing yellow FDB** with **`PO`** after the callsign | sender: `PO` + **recipient TCP** after the callsign (`PO1R`) | [7210 a2 "Point out identifier blinking or steady must be yellow"], [vNAS "Point Outs"], [vice] |
| Point-out **accepted** | steady yellow until clicked, then green FDB, then PDB | sender: recipient ID removed, `PO` **blinks about 5 s** and clears | [vNAS], [vice] |
| Point-out **rejected** (`UN`) | back to green | sender: **flashing `UN`** until clicked | [vNAS], [vice] |
| **Conflict alert** | red **`CA`** on line 0, **blinking** and with an aural alarm until acknowledged (click either track), then steady red | same at every involved scope | [vNAS "STCA"], [vice "Collision Alerts"], [65 §5-14-6] |
| **Mode C intruder (MCI)** | CA-style alert when an **unassociated** track conflicts with an associated one. Two unassociated tracks never alert | — | [vice], [65 §5-14-6] |
| **MSAW** | red **`LA`** (low altitude) on line 0, aural | — | [vice "MSAW"], [65 §5-14-7], Glossary "MSAW" |
| **SPC 7500/7600/7700** | red **`HJ` / `RF` / `EM`** on line 0, forced FDB, aural. Also `MI` (7777), `LL` (7400), and controller-only `ME`, `MF`, `OD`, `LN` | — | [65 §5-2-8 NOTE 3: "STARS/MEARTS will display 'EM'"], [vNAS "Special Purpose Codes"], [vice] |
| **Highlighted** | **cyan** data block (middle-click) | — | [vNAS] |
| Alert data block measured colour | **255,0,0**; HF08 recommends **255,60,60** | — | [HF08] |

CA and MCI **suppression** (acknowledgement) is per control position. It "may not be suppressed or
inhibited at or for another control position without being coordinated", and **inhibit is only for
operations where separation criteria do not apply**, the examples being practice intercepts and air
shows [65 §5-14-6c]. That is the MARSA case in this app. ADR 0058 already suppresses STCA for a
MARSA pair.

### 2.4 How STARS CA works (for comparison with ADR 0058)

- Public sources give only the procedures. The vNAS implementation, which is community, looks
  **5 s ahead**, alerts at **< 3 NM and < 1,000 ft** when separation is not increasing, and suppresses
  alerts on final-approach corridors (4 NM wide, 30 NM out) [vNAS "STCA"].
- The real parameters are site-adapted and not public.
- ADR 0058's StcaMonitor (120 s straight-line look-ahead, 3 NM/1,000 ft, MARSA suppression) is a
  reasonable stand-in. **Only its presentation needs to become STARS-like** (§5).

---

## 3. How STARS differs from the military/GCI presentation

| Aspect | Military/GCI (today's scope, [repo]) | STARS |
|---|---|---|
| What colour means | **Affiliation**: `iffState` friendly / neutral / bogey / bandit / hostile (`iff.js` `IFF_COLOR_DEFAULTS`), soon from interrogation (L10, H3) | **Ownership and attention**: white = mine, green = not mine, yellow = pointed out or caution, red = warning, cyan = highlight. **There is no friend/foe.** Every aircraft is traffic to be separated [7210 §3-9-1] |
| Symbol shape | Shape by IFF (`tri-iff-bandit/hostile`) and domain (`gnd-`, `ship-`, `ac-`, `sq-`) (`map-setup.js`) | Same blue target for everything. The **character** on it says who owns it, or `*`/`V`/`+` if nobody does |
| Data block for every contact | Yes, the same template for all (`buildLabels`) | **Graded**: FDB / PDB / LDB / none, by relation to *me* |
| Altitude | `180`, `230*` (height finder), `210L` (datalink), plus a climb-rate `↑12` | `180` from Mode C only; `140*` = **pilot-reported** (a **different meaning** for `*`); no rate digits |
| Speed | `G450` (knots) | `45` (tens of knots) |
| Emergency text | `EMR` / `RDF` / `HIJ` in colour | `EM` / `RF` / `HJ` in red on line 0 |
| Trails | Coloured by IFF, faded by opacity (`buildTrails`) | Always blue, five-step fade |
| Leader line | Free-drag, geo-anchored (`buildLeaders`) | Eight keypad directions, length 0–7 |
| Height sources | Mode C, 3D radar height, datalink | **Mode C only.** Terminal surveillance radars are 2D [65 §5-14-4f: Mode C used for vertical separation]. The app's airport/approach radars are 2D + SSR as well (ADR 0059 table), which fits |

The important point for designers is that STARS answers **"what is my relation to this aircraft?"**
(mine / handing to me / pointed out to me / someone else's / nobody's). The GCI scope answers
**"whose side is it on?"** Mixing the two cues on one track would break both, which is why H5 picks one
scheme per track.

---

## 4. ERAM (en-route) briefly, and whether CTR should use it

### 4.1 What ERAM does differently

- **FDB vs LDB by control:** tracks owned by others show as **paired LDBs** (aircraft ID +
  altitude) by default. Having **separation responsibility with a paired track** means you **display
  an FDB** [65 §5-3-8, ERAM]. An LDB has **no position symbol, no leader line and no velocity
  vector**, and can only sit left or right of the target [vNAS "Limited Data Blocks"].
- **En-route data block minimum:** flight ID + altitude, where "the displayed altitude may be
  **assigned, interim, or reported**" [65 §5-3-8].
- **FDB fields** [vNAS "Full Data Blocks"]:
  - **Column 0**: `R` = **not your control**, and the on-frequency indicator.
  - **Line 0**: point-out `P` in yellow while pending, `A` in white when acknowledged.
  - **Line 1**: Field A, the aircraft ID.
  - **Line 2**: **Field B (assigned altitude) + a status character + Field C (Mode C)**, for
    example `300↑253` (climbing to FL300, now FL253), `300C` (reached), `100T253` (interim),
    `230+253` / `230-212` (through/below assigned), `230XXXX` (no Mode C), `VFR/055`.
    This is how ERAM implements the "climb and descent arrows" of [65 §5-14-4d].
  - **Line 3**: Field D, the **CID** (a 3-character computer ID). Field E is ground speed, or one of:
    `HIJK` / `RDOF` / `EMRG` (7500/7600/7700) [65 §5-2-8 NOTE 3: "ERAM will display EMRG"],
    `Hxxx` (handoff to sector xxx), `Oxxx` (accepted by xxx), `CST` (coast), `####` (received code
    ≠ assigned), `NONE` (no code received), `FRZN`.
  - **Line 4** (the "fourth line", mandatory in en route [65 §5-4-10a]): destination, type, **assigned
    heading `H080`** [65 §5-4-10d: "Coordination format for assigned headings must use the
    designation character 'H' preceding a three-digit number"], speed, free text.
- **Target symbols** [vNAS "Targets"/"Tracks", checked against its figures]:

  | Symbol | Meaning |
  |---|---|
  | `+` | uncorrelated primary |
  | `×` | correlated primary |
  | `/` | uncorrelated beacon |
  | `\` | correlated beacon |
  | `≡` | identing beacon |
  | `V` | code 1200 |
  | `I` | Mode C intruder |

  | Track symbol | Meaning |
  |---|---|
  | `◇` | flight-plan-aided track |
  | `◁` | free track |
  | `#` | coast track |
  | hourglass | frozen track |
- **Colour:** ERAM leans on **brightness** controls rather than an ownership hue. There are separate
  controls for paired and unpaired targets, paired and unpaired history, LDB, selected LDB, FDB,
  portal, line 4, dwell and so on [vNAS "Brightness Toolbar Menu"]. vNAS renders ERAM in
  yellow/amber on a very dark blue background. **I found no public FAA source for ERAM's colour
  values, so treat any ERAM palette as a community approximation.**
- **CA:** a conflict **flashes the data blocks**. vNAS models a 4-minute look-ahead at 5 NM (3 NM at
  or below FL230) and 1,000 ft, taking the data-block assigned altitude into account. A Mode C intruder
  gets a **Conflict Data Block** `TFC <code>` that blinks bright/dim [vNAS "Conflict Alert
  Processing", "Conflict Data Blocks"]. Suppression uses `CO`/`SG`, and SG is **only** for special
  military operations such as air refuelling and ADC intercepts [65 §5-13-1c].

### 4.2 Should CTR use ERAM?

**Recommendation: no, not in the first build. Give every ATC Position one scheme, STARS, and borrow
two ERAM ideas inside it.** [inference]

1. **One controller, one scheme** [7210 §3-9-1i]. Positions stack in this app: a controller commonly
   holds APP and CTR at once (guide §8, §9), and both draw on one map. Two ATC schemes on one scope
   would break the rule the colour standard states outright.
2. **CTR's radars are approach radars.** CTR sees "every airfield's approach radar in the
   theater" (guide §8B). Its sensor picture is terminal-like (2D + SSR), so nothing about ERAM's
   sensors needs modelling.
3. **What ERAM adds is already in the app, in different clothes.** ERAM's line 2 is *assigned vs
   current altitude with a trend arrow*, and its line 4 is *assigned heading*. ADR 0058 already
   holds one `ALT` and one `HDG` per flight and draws `A180 H050`. Borrow:
   - **(a)** the `↑`/`↓` trend between assigned and current, which [65 §5-14-4d] also requires on
     STARS "where available";
   - **(b)** the `H###` heading notation [65 §5-4-10d] on line 3.
4. **The cost of ERAM is high:** a different LDB model with no symbol and no leader, a
   different symbol vocabulary, CIDs and portal fences, for a benefit (en-route realism) the
   squadron has not asked for.

Keep ERAM as a later option (§9, Q4) if the owner wants CTR to *feel* like a Center.

---

## 5. A minimal, faithful STARS mode for this app

### 5.1 Which scheme applies to a track

`crc-sync/src/efsp/station-coverage.js` computes `stca = held positions ∩ {MILITARY_ATC, CIVIL_ATC}`.
`facility-config.js` maps OPS→BASOPS, and CD/GND/TWR/APP→MILITARY_ATC (Incirlik), and CTR→CIVIL_ATC.
TAC_C2/AIC/GCI are tactical.

**Terminology trap:** H5's "military presentation" means the **tactical/GCI** scheme. Incirlik's
TWR and APP are *military ATC* and **get STARS**. Designers should call the two schemes
**TACTICAL** and **ATC**, not "military" and "civil" [inference].

**The wire today cannot tell the client which scheme a track needs.** `sources` is
`PRIMARY|SSR|HEIGHT|DATALINK` (ADR 0059). It says what was *measured*, not *by which kind of
radar*. `HEIGHT` and `DATALINK` do imply a tactical sensor, but a contact seen by both an AWACS and
an approach radar with SSR carries `PRIMARY, SSR, HEIGHT`, and one seen only by an AWACS without
height would be indistinguishable. **Proposal [inference]:** `presentation.js` adds one allow-listed
field, for example `scheme: 'TACTICAL' | 'ATC'`:
- `TACTICAL` if any *current* radar in `_visibleTo(session)` is a tactical type (AWACS, fighter,
  carrier search), or if the datalink reports it;
- else `ATC`.

That puts H5's "military wins" in the one place that already knows the session's sensors. Classify
radar *types* once in `sensor-specs.json`, for example `presentation: 'ATC'` on airport, approach
and carrier approach, keeping to P5 (read once, never written). A session with **no** tactical
Position always gets `ATC`, so a pure TWR/APP/CTR scope is uniformly STARS.

**Consequences to flag:**
- A mixed session (for example APP + GCI) shows both schemes side by side. A track can **flip**
  scheme as AWACS coverage comes and goes.
- Hysteresis is recommended: stay `TACTICAL` for about two tactical sweeps after the last tactical
  hit. The "two sweeps" window in ADR 0059's `currentRadars` is the natural place for it.
- A scheme change should count toward the label revision, so the flip shows without waiting for
  a sweep.

### 5.2 Mapping: STARS element → data that exists here

"Mine" below means: the track is correlated (`label.source === 'FDR'`) to a live Strip whose owning
Position is one the controller is **acting as** (guide §9; `strip.ownerPositionId`, reached through
`stripIdsForTrackId()`).

| STARS element | Source in this app | Notes |
|---|---|---|
| **Associated track** | `label.source === 'FDR'` (correlated, guide §8C) | |
| Provisional association | `label.source === 'FDR_PROVISIONAL'` | STARS has no "provisional". Draw it as associated **plus** STARS line 3 `received  assigned` (squawked code vs `fdr.identity.beaconAssigned`, assigned flashing) when the cause is a code mismatch. That is exactly STARS's own cue [65 §5-4-6e NOTE]. Keep the `?` only where the cause is a callsign near-match [inference] |
| **Unassociated track** | `label.source` null / `TAG` | LDB. For a tag, show it on LDB line 1 in place of the code. That is app-specific, an analogue of ERAM's E-LDB ADS-B ID |
| **Owned by me** → white FDB, my letter | the correlated flight has a live Strip with `ownerPositionId ∈ acting-as` | Several Strips per flight is normal after a cross-Facility handoff (ADR 0054). The owner is the Strip whose `coordination.separationResponsibilityRef`, when coordination is `ACTIVE`, names the Position, else the Strip's `ownerPositionId` [inference, guide §8 table] |
| **Owned by other** → green PDB, owner's letter | the same rule, owner not held by me | |
| **Position-symbol letter** | new per-Position config, for example `TWR→T`, `APP→A`, `CTR→C` | `C` for Center is STARS's own convention [vice]. Put it in facility config: the owner picks the letters. TACTICAL owners after TOFI: see Q3 |
| **Handoff pending** (flashing white at the receiver; recipient char on line 2 at the sender) | a Strip with `coordination.primitive ∈ {HANDOFF, AIT}` and `state: 'PROPOSED'` (APP↔CTR only, guide §8) | Same-Facility transfers (dragging a Strip TWR→APP) are immediate, with no pending state. Show only the post-accept flash for those |
| **Handoff accepted** (the sender's white FDB blinks about 5 s, then click → green → PDB) | the coordination state going `PROPOSED → ACTIVE`, or `ownerPositionId` changing | The blink and click-down are **local UI state** per scope, never synced. That matches STARS, where each TCW acknowledges for itself |
| **Point-out** (receiver: flashing yellow `PO`; sender: `PO<id>`; accepted: steady yellow; rejected: sender flashes `UN`) | `coordination.primitive === 'POINT_OUT'`, `state` PROPOSED / ACTIVE / REJECTED | A very good fit. The guide already says POINT_OUT splits data vs separation. After acceptance, the data owner keeps the white FDB and the separation holder gets the yellow one |
| TRAFFIC / OPERATIONAL_REQUEST | coordination primitives | **No STARS display.** Leave off the scope. The Strip shows them |
| **FDB line 1**: callsign | `label.callsign` (the Strip's callsign) | |
| **FDB line 2 left**: Mode C altitude, hundreds of feet | `altitude.ft` when `altitude.source === 'MODE_C'` | Blank when `altitude` is null. In an `ATC`-scheme track `RADAR`/`DATALINK` altitudes cannot occur, because those sensors make the track `TACTICAL` (§5.1). **Assert it rather than draw `*`**: STARS's `*` means *pilot-reported* |
| Line 2 left time-share: scratchpad | nothing yet | **Leave out** (§5.4). A later candidate is the arrival runway or approach from a Strip Block |
| **Line 2 middle**: handoff recipient char | the peer Position's letter while `HANDOFF` is `PROPOSED` | |
| **Line 2 right**: GS in tens of knots / type | `kinematics(hist).speedKt`; `type` (the FDR's) | `45` not `G450`. Time-share with `typeText(t)` |
| CWT / category letter | could be derived from `type` | **Leave out** in v1 |
| **Line 3**: assigned altitude `A###` | the FDR `clearance.altitude` ACTIVE entry (ADR 0058) | Already drawn as `A180`. Add ERAM's trend (`A180↑`) when climbing or descending toward it [65 §5-14-4d]. Add `H050` for assigned heading [65 §5-4-10d, ERAM notation] |
| Line 3: received vs assigned code | `ssr.code` vs `fdr.identity.beaconAssigned` | Show only when they differ. Flash the assigned one |
| **LDB**: code + altitude | `ssr.code`, `altitude` (MODE_C) | Synthetic AI codes 6000–6777 (ADR 0059) are ordinary LDBs. Optionally a "beacon-select" square for a chosen block (§5.4) |
| **Primary-only**: symbol, no data block | `sources` has no `SSR` | Click → track panel (track number `TN…` lives there, not on the scope) |
| **Ident**: flashing `ID` | `ssr.ident` | Replaces today's whole-icon pulse |
| **SPC**: `EM`/`RF`/`HJ` red on line 0, forced FDB | `ssr.emergency` `GENERAL`/`RADIO`/`HIJACK` | `trackCodeTag` gets an ATC variant with the two-letter codes |
| **CA**: red `CA` on line 0, blink until acknowledged | `efsp-alerts.stca` (ADR 0058), already sent **only to ATC sessions** (ADR 0059) | Keep the CPA overlay: it is extra, not STARS, and useful. Acknowledge by clicking either track, locally |
| **MCI** | an STCA pair where one side is uncorrelated | Optional: show `CA` on both (vNAS/vice show it alike). No new server work |
| **MSAW `LA`** | none. ADR 0058 left terrain/MSAW out until AIRAC data exists | **Leave out** |
| Conformance (`HDG 072`, `BUST+600`, `ALT↓`) | ADR 0058 | **Not STARS.** STARS has no conformance monitor; ERAM's `+`/`-` in field B is the nearest thing. Keep it, on line 0, in a colour that is not STARS red/yellow (§6) |
| **Coast `CST`** | today a contact past its sensor window is simply `gone` (ADR 0059) and fades client-side (`sweepOpacity`) | Optional: for a *correlated* track only, hold the last data block for about 2 sweeps, dead-reckoned, with `CST` in the altitude field and no blue target. Otherwise leave out. The Strip's `NO TRK` "lost" state already tells the controller (guide §8C) |
| **History trail** | `history` (already used by `buildTrails`) | Five-step blue, not the IFF colour. Dots at fixed age intervals |
| **Leader line** | `labelOffsets` + `buildLeaders` | Keep the drag. Optionally snap to the 8 keypad directions. Default direction **N/NE** for owned tracks (the vNAS screenshot shows N) |
| **Altitude filter** | none | Useful at TWR (for example a 0–60 filter) but it is new UI. Leave out v1 (§5.4) |
| **Quick Look** | the acting-as set + Strip owner | Cheap later: "show FDBs for everything owned by Position X" |
| **Dwell** | the pointer's position | Cheap and helpful. Optional |
| `iffState`, `iffOverride`, declarations | L10 | **Ignored** in the ATC scheme (Q2) |
| Datalink lock lines | ADR 0059 | Tactical only. They never draw on ATC-scheme tracks |
| Ships and vehicles | `domain` | STARS does not present surface traffic (that is ASDE-X). In ATC scheme: primary symbol, no data block unless tagged; the guide says TWR's field radar is the only one that shows vehicles |

### 5.3 Minimum set (what "faithful" needs)

1. Blue fused target + one position character (owner letter / `*` / `+`).
2. FDB / PDB / LDB / none, chosen per scope by ownership (§5.2).
3. White = mine, green = everything else, yellow = pointed out to me, red = CA/SPC, cyan = the
   controller's highlight.
4. FDB lines: `CALLSIGN` / `ALT  GS` time-sharing with type / `A### H###` (assigned), plus a code
   mismatch pair when relevant. Altitude as three digits in hundreds of feet, ground speed in tens
   of knots.
5. Handoff and point-out states from EFSP coordination, with STARS's blink and click-down.
6. `EM`/`RF`/`HJ`, `ID` and `CA` on line 0 / in place, blinking until clicked.
7. Five-step blue history trails. Dim gray maps and range rings.
8. A monospace font. STARS alignment depends on fixed columns. Today's label layer uses
   `Roboto Regular`/`Noto Sans Regular` (`map-setup.js`), so the MapLibre glyph source must supply
   a mono face such as Roboto Mono. Check that before designing column time-sharing.

### 5.4 What to leave out, and why

| Left out | Why |
|---|---|
| Scratchpads 1/2 | No data owner in the app yet. They would invite free text that duplicates Strip Blocks |
| CWT/wake category letters | Low value in DCS. Would need a type table |
| MSAW `LA` | No terrain/MVA data (ADR 0058) |
| PTL, min-sep line, TPA/ATPA, CRDA | Tools, not presentation. Separate features |
| Altitude filters, beacon-select lists, `WHO` | New controls. Revisit with the "declutter at the end" decision (H6) |
| DCB / SSA / system lists | The app has its own panels |
| Coast/Suspend list | No coast model yet |
| Aural alarms | Not requested. The blink is the required redundant cue [7210 §3-9-1b] |
| ERAM formats | §4.2 |
| Affiliation colour / IFF on ATC tracks | H5 |

### 5.5 Things the design lane must decide (not research questions)

- A **ship or vehicle** on the TWR field radar with a tag: LDB with the tag, or nothing?
- **Provisional** correlation: STARS line-3 code pair only, or keep `?`? (§5.2)
- **Blink rate.** The app's `_pulseBright` toggles every 500 ms (`app.js`), so 1 Hz on/off. No
  public STARS figure. Reuse it.
- **Acknowledge gestures.** Today a click on a label opens the track panel and a drag moves it
  (`map-setup.js`). STARS uses clicks to cycle FDB/PDB and to acknowledge. Choose: for example, a
  click on the *target* cycles and acknowledges, and a click on the *label* opens the panel.

---

## 6. Colours and brightness for a dark map

Tokens below are given for the ATC scheme. "STARS" is the measured TCW value [HF08 Table 1]. "HF08"
is the FAA's recommended starting RGB [HF08 Table 3]. **Proposed** is my suggestion for this app's
MapLibre dark basemap, which is not pure black. Everything in the Proposed column is an
**approximation, not an FAA value**. Test it on the actual map, as [7210 §3-9-1g–h] demands of any
implementation.

| Token | Meaning | STARS (measured) | HF08 (recommended) | Proposed here |
|---|---|---|---|---|
| `--atc-bg` | scope background | `#000000` | `#000000` | keep the basemap. If a "STARS black" option is added, `#000000` |
| `--atc-db-owned` | owned FDB, its leader, PTL | `#FFFFFF` | `#E1E1E1` (225) | `#E6E6E6` |
| `--atc-db-other` | PDB/LDB/unowned FDB + leader | `#00FF00` | `#00FF00` | `#3CE63C` (slightly softer on a non-black map; *approx.*) |
| `--atc-pointout` | point-out FDB and `PO` text | `#FFFF00` | `#FFFF00` | `#FFFF00` |
| `--atc-alert` | `CA`, `EM`/`RF`/`HJ`, alert data block | `#FF0000` | `#FF3C3C` (255,60,60) | `#FF3C3C` |
| `--atc-highlight` | controller highlight | cyan (7210.3CC) | `#00FFFF` (listed for weather in lists) | `#00FFFF` |
| `--atc-target` | fused/search target disc | `#1E78FF` (30,120,255) | `#00BFFF` Deep Sky Blue | `#1E78FF` fill. Not used for text (7210 §3-9-1d) |
| `--atc-beacon-extent` | (unused: FUSED only) | `#00FF00` | `#008B00` Green 4 | — |
| `--atc-hist-1` … `-5` | history trail, newest → oldest | `#1E50C8` `#4646AA` `#323282` `#28286E` `#1E1E5A` | same | same. On a lighter basemap raise the oldest two to about `#34347A` / `#2A2A6A` (*approx.*) |
| `--atc-map` | video maps A/B, range rings, compass | `#8C8C8C` | `#8C8C8C` (35 % of white) | `#8C8C8C` at about 0.6 opacity |
| `--atc-restriction` | geographic restriction fill | yellow | `#4C4C00` (30 % yellow) | `#4C4C00` fill, `#FFFF00` border and text |
| `--atc-conform` | ADR 0058 conformance tags (not STARS) | — | — | keep today's orange `#FF8A4C` (BUST, WRONG_WAY) and amber `#E0A83C` (HDG). Documented as app-specific. HF08 reserves orange only for CRDA ghosts, which the app does not draw |

**Brightness categories to expose.** These are a subset of BRITE. The defaults are **community
approximations**:

| Category | Governs | Default |
|---|---|---|
| FDB | owned and forced FDBs | 100 % |
| LDB | PDB + LDB text and leaders | 80 % |
| POS | position symbol on FDB tracks | 100 % |
| OTH | position symbol on others | 80 % |
| PRI | the blue target | 80 % |
| HST | trails | 70 % |
| MPA / MPB | maps | 35–60 % |

Implement each as an opacity (or luminance) multiplier on its layer, which MapLibre supports per
paint property. Keep the existing `sweepOpacity` fade as a multiplier on top.

**Rules to keep while choosing values** [7210 §3-9-1b–f; HF08 §1.3]:
- Every colour-coded state also blinks or carries text (`CA`, `PO`, `EM`).
- Red and yellow keep their conventional meanings.
- No pure blue text.
- An attention colour must be at least as bright as everything around it. HF08 specifies at least
  20 cd/m² above distractors, or Δu′v′ > 0.24.

The present `IFF_COLOR_DEFAULTS` (`#4488cc`, `#ccaa00`, `#888888`, `#cc6600`, `#cc2222`) stay the
TACTICAL palette. Note the clash: tactical **yellow `#ccaa00` = bogey**, while ATC **yellow =
pointed out**. On a mixed scope (§5.1) a bogey and a pointed-out flight could read alike. That is one
more argument for the blue target disc and fixed-width white/green text on ATC tracks, which a
tactical track never has.

---

## 7. What already fits, and what must change in the code (pointers for the build lane)

- `track-label.js` is the single place that turns a wire track into text (ADR 0059). An ATC
  variant belongs there, next to the existing functions:
  - `altitudeShort` drops `*`/`L`;
  - `infoLine` loses `↑NN` and `G`;
  - `trackCodeTag` gets two-letter SPCs.
- `geojson.js` changes:
  - `trackColor()` currently returns an IFF colour for every layer (dots, trails, PPL, leaders,
    labels). The ATC scheme needs **per-layer** colours instead: target blue, trail blue ramp, text
    white/green/yellow;
  - `buildLabels` needs the FDB/PDB/LDB choice;
  - `buildDots` needs a `scheme` and `posChar` property.
- `map-setup.js`: `unit-squares` picks its icon by `iff`/`domain`. An ATC branch needs a blue disc
  plus a text symbol for the position character (a second symbol layer, since MapLibre cannot put
  data-driven text inside an icon image). `unit-emerg-square` is replaced in ATC by line-0 text.
- `iff.js`'s `IFF_STATES` stays byte-identical with the server (L10 constraint). The ATC scheme
  simply does not read it.

---

## 8. Quick reference card

```
ATC (STARS-like) scheme — one track, three scopes

  owned by me (APP=A)        owned by CTR (C), I'm APP     unassociated, squawking     primary only
  CA                                                        6123
  VIPER11                     042 38                        042                          +
  042  38  →(type F16)        C                             *
  A080↑ H270
  A                                                         (green, LDB)                 (blue target, no block)
  (white FDB, blue disc)      (green PDB)

  handoff CTR→me pending: white FDB, blinking, target still shows C
  pointed out to me:      yellow FDB "VIPER11 PO", blinking until clicked
  emergency:              red "EM" on line 0, FDB forced for everyone
```

---

## 9. Open questions for the owner

1. **Scheme flag on the wire.** Agree that crc-sync adds `scheme: 'TACTICAL'|'ATC'` per contact,
   computed per session from which radar *types* currently see it (§5.1)? Without it the client
   cannot apply "military wins" correctly.
2. **Declared hostiles on ATC scopes.** A controller declaration (`iffOverride`) is shared by
   everybody. Should an ATC-scheme track that someone declared `hostile` show anything (STARS has
   a yellow `SA/MI` — suspect aircraft / military intercept — indicator [HF08 Table 1]; `MI` is
   also SPC 7777 [vNAS]), or nothing at all (pure H5)?
3. **Owner letter after TOFI.** When a flight is handed to TAC_C2/GCI (guide §8C1) and an ATC
   scope still sees it by ATC radar: show a tactical letter (for example `M`), or keep the ATC
   owner's letter while the ATC Strip stays live?
4. **CTR = STARS?** Confirm §4.2 (STARS everywhere, with ERAM's trend arrow and `H###`), or ask for
   a real ERAM look at CTR later.
5. **Position letters.** Which single characters for TWR, APP, CTR (and ARR TWR / DEP positions if
   they ever own tracks)?
6. **Coast.** Show `CST` for a correlated track for a short time after it leaves the picture, or rely
   on the Strip's `NO TRK` (lost) as today?
7. **Primary-only symbol.** `+` (ERAM-consistent), or the vNAS diamond? The community sources
   disagree.
8. **Mixed sessions.** Is it acceptable for a controller holding APP + GCI to see two schemes at
   once, with tracks flipping as AWACS coverage changes? If not, the alternative is a whole-scope
   scheme chosen by the "highest" Position held.
