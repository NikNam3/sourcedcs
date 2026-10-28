# USMTF Air Tasking Order: a reference for implementers

Research note for lanes **L3** (crc-sync USMTF ATO parser), **L11** (atobrief USMTF export) and
**L14** (ATO-to-Strip binding, EFSP WP7). Decision H1 (`docs/parallel/decisions.md`) makes USMTF
the interface between systems. This note fixes **one recommended reading** of each set so that the
exporter and the parser agree. Where the sources disagree, it shows every version and says which one
to use.

> **Source caveat, carry it into code comments.** MIL-STD-6040 is *Distribution Statement C* (US
> Government agencies and their contractors only), and was **not consulted** (§5). Everything here
> comes from public academic papers, public DCS and flight-sim community documents, and a few
> training excerpts. The set names and the overall grammar agree across all the sources, and several
> field orders are confirmed independently. Anything marked **[COMMUNITY]** or **[PROFILE]** is not
> confirmed by an official text. **[PROFILE]** means a SOURCE DCS convention that this note defines
> so that our own exporter and parser agree. It is not a claim about the standard.

## 0. Sources (cited inline by tag)

| Tag | Source | Kind |
|---|---|---|
| **[AFIT]** | Compton, Hopkinson, Peterson, Moore, *Using Modeling and Simulation to Examine the Benefits of a Network Tasking Order*, J. Defense Modeling & Simulation 9(3):205–217, 2012, doi:10.1177/1548512910371702. PDF: <https://scholar.afit.edu/cgi/viewcontent.cgi?article=2172&context=facpub> (Cloudflare-gated; read via web.archive.org). Cites *MITRE, USMTF Message Browser Help, 2004 Baseline* as its format source | Peer-reviewed, US Air Force (AFIT). **Best public source for field semantics** |
| **[NPS]** | Murray & Quigley, *Automatically Generating a Distributed 3D Battlespace Using USMTF and XML-MTF Air Tasking Order…*, NPS thesis, June 2000. <https://faculty.nps.edu/brutzman/vrtp/dis-java-vrml/archive/DisJavaVrml-AirTaskingOrderThesis-MurrayQuigleyJune2000.pdf> (also DTIC ADA381836). App. B holds an XML-MTF ATO DTD derived from the DISA XML-MTF work | Academic, US Navy. Gives the ATO hierarchy and the OPER/EXER/MSGID/TIMEFRAM element names |
| **[455]** | 455 vAEW wiki, *ATO, ACO & SPINS Guide: ATO*, <https://wiki.455aew.com/books/ato-aco-spins-guide/page/ato> (author "Roman", undated). The source that L3 used | DCS community. Detailed, but **contradicts itself** (§1.6) |
| **[CO]** | Combined Ops wiki (DCS AOC Tools, a USMTF ATO *generator* for DCS): ATO basics <https://wiki.combinedops.org/air-tasking-order-ato-basics-dcs-aoc-tools-p9>, callsign <https://wiki.combinedops.org/callsign-p30>, takeoff/landing <https://wiki.combinedops.org/dcs-mission-editor-takeoff-landing-waypoints-p31>, AMSNLOC <https://wiki.combinedops.org/mission-location-amsnloc-dcs-aoc-tools-p32>, GTGTLOC <https://wiki.combinedops.org/target-location-gtgtloc-dcs-aoc-tools-p33>, AR <https://www.wiki.combinedops.org/arinfo-line-and-5refuel-block-p39> (pages updated Aug–Sep 2026) | DCS community tool. Shows what a live DCS-ecosystem producer actually emits |
| **[CO-IFF]** | Combined Ops, *IFF/SIF Codes added to Air Tasking Order*, 29 Jul 2021, <https://www.combinedops.org/post-19-iff-sif-codes-added-to-air-tasking-order> | DCS community |
| **[AMVI]** | Aeronautica Militare Virtuale Italiana, *ATO, ACO and SPINS Guide* rev 0.2, 18 Nov 2012, <https://www.vitaf.it/AMVI_Sito/Activity/Campagne/Falcon/CombatDawn/ATO_ACO_QUICKGUIDE.pdf> (same ATO text: <https://www.vitaf.it/AMVI_Sito/Activity/Campagne/Falcon/CommandoSling2012/AIR-TASKING-ORDER-GUIDE.pdf>) | Falcon-sim community. Reproduces the **pre-2000 `ATOCONF` message map** (MSNDAT/MSNLOC/CONTROL/REFUEL) and a real-looking ACO header |
| **[VRF]** | vRF-briefing, *How to read the ATO*, <https://github.com/5jotters/vRF-briefing/blob/master/docs/Lectures/ATO.md> | Community (NATO TLP style). A third, **non-conforming** AMSNDAT layout |
| **[MX]** | Matrix Games forum, user "Klahn", *mission naming*, <https://forums.matrixgames.com/viewtopic.php?t=388747> | Forum post with one real-looking mission, which the poster calls an "older" format |
| **[GOE]** | Graveyard of Empires (Patreon), *Air Tasking Order – Example 3 – Air to Air Refueling*, <https://www.patreon.com/posts/air-tasking-3-to-115746467> | **Seen only as a search excerpt** (the page returns 403) |
| **[6040]** | MIL-STD-6040B Notice 1 (26 Aug 2009) metadata, <https://everyspec.com/MIL-STD/MIL-STD-3000-9999/MIL-STD-6040B_NOTICE-1_24276/> | Official, **metadata only**: title, Distribution Statement C, how to obtain it |
| **[NISP]** | NATO FMN Spiral 5 "Formatted Messages for Air" profile, <https://nisp.nw3.dk/serviceprofile/fmn5-20231123-prf-199.html>, and APP-11(D) entries <https://nisp.nw3.dk/standard/nato-app-11-ed.d-v1.html> | NATO interoperability profile. Names ATO and ACO as ADatP-3 Baseline 11 messages |
| **[WP]** | Wikipedia, *Air tasking order*, <https://en.wikipedia.org/wiki/Air_tasking_order> | Background: the ATO is USMTF, and since 2004 also an XML schema under ADatP-3 and MIL-STD-6040 |

---

## 1. What USMTF is, and the ATO message

### 1.1 The standards

- **USMTF** (US Message Text Format) is the DoD's character-oriented formatted-message standard,
  in use since the 1970s. It is defined by **MIL-STD-6040** (DISA is the configuration manager).
  There are over 370 message types [AFIT], [NPS §II.C]. Every message also has an XML form
  (**XML-MTF**) [NPS], [WP].
- The NATO counterpart is **ADatP-3**, which holds the syntax rules, and **APP-11**, the NATO
  Message Catalogue, which holds the message definitions. They are released in baselines; FMN
  Spiral 5 names the ATO and ACO as ADatP-3 Baseline 11 messages [NISP]. The slash syntax is
  shared, so a USMTF ATO and an APP-11 ATO look alike.
- **The ATO message.** The current MSGID identifier is **`ATO`** [455], [NPS App. D
  `message_text_format_identifier` = `ATO`], [CO], [VRF]. **`ATOCONF`** ("Air Tasking
  Order/Confirmation") is the older JINTACCS/USMTF name. It had a different set vocabulary
  (`PERID`, `AIRTASK`, `MSNDAT`, `MSNLOC`, `TGTLOC`, `CONTROL`, `REFUEL`) [AMVI]. The sets in §9.9
  (`AMSNDAT`, `MSNACFT`, …) belong to the **USMTF 2000-and-later** ATO [AFIT], [455].
  **Recommended:** emit `MSGID/ATO/…`, and accept `ATOCONF` when parsing, with a warning.

### 1.2 Syntax (confirmed by [AFIT], [455], [CO], [NPS], and the tpub GENADMIN excerpt below)

- A **set** is one logical line: `SETID/field/field/…//`. `/` separates fields, and `//` ends the
  set [AFIT]: "each line of data, or set, is terminated by '//'; … Within a set, fields are
  separated by '/'. Fields containing '-' are optional and no data has been entered."
- **Empty field**: `-`. Trailing empty optional fields may simply be left out, as in
  `MSGID/ATO/SOURCEDCS AOC/ATO C/SEP//`, which has no qualifier fields.
- **Line wrap**: "due to length it may wrap to fill multiple lines of text" [AFIT]. The AFIT sample
  wraps **inside a field** (`ARRLOC:` newline, indent, `KDZ7`). The 455 examples wrap inside
  fields too (`LTIOV:011345ZOCT19` / ` 98`, `NAME:BLUE ` / `TRACK`). The traditional teletype line
  limit is 69 characters. That figure is widely cited but **was not verified** against 6040.
  **Recommended parse:** inside a linear set, delete each newline together with the whitespace that
  starts the next line. This is L3 §5.3 rule 5. **Recommended export:** wrap only directly after a
  `/`, indent continuation lines by 5 spaces, and keep every line at 69 characters or fewer. That
  way no wrap ever splits a field.
- **Field descriptors**: some fields carry a keyword prefix, `KEY:value`. Examples:
  `ACTYP:F15C`, `DEPLOC:LBNA`, `ICAO:LLKA`, `PFREQ:343.3`, `PDESIG:GREEN`, `NAME:BLUE TRACK`,
  `ARCT:011000Z`, `KLBS:30.0`, `TOT:`, `NET:`, `NLT:`, `ID:`, `DMPIS:`, `FROM:`, `TO:`, `ASOF:`.
  A descriptor usually picks one alternative of a *choice* field, so parsers should find such
  fields **by key** [455], [CO]. `OTHAC:F16CJ` [MX] is the "other aircraft" alternative to `ACTYP:`.
  Accept both.
- **Columnar sets** (set names that start with a digit: `5REFUEL`, `6ROUTE`, `7CONTROL`,
  `9PKGDAT`): the set name stands alone on a line, **with or without a trailing `/`** ([455] has
  `5REFUEL`, [CO] has `5REFUEL/`). Next comes a header line of `/`-prefixed column names, then one
  `/`-prefixed data row per line, padded with spaces. The **last row ends in `//`** [455], [CO].
  Newlines are significant inside columnar sets. The leading digit is sometimes said to be the
  column count, but the published examples do not bear that out (`9PKGDAT` has 7 columns and
  `5REFUEL` has 9). **Do not rely on it.**
- **Segments** are groups of sets that repeat as a unit. The ATO is a tree of nested segments
  (§1.3). **Repeating fields** also occur inside a set: the IFF/SIF field of `MSNACFT` repeats once
  per mode [AFIT], [455].
- **Free-text sets**: `AMPN` amplifies the set just before it (normally a `REF`). `NARR` is
  narrative. `RMKS` is remarks. `GENTEXT/heading/text//` is general text; [455] notes that unit
  remarks usually sit in a `GENTEXT` at the end of a `TASKUNIT` block. Old message maps define AMPN
  and NARR as "free text to explain preceding reference set" [AMVI]. **Recommended:** the parser
  treats everything up to `//` as text. The exporter never writes `/` inside free text (it replaces
  it with a space).
- **Classification**: USMTF messages open with a classification line and close with
  `DECL/…//` when the message is classified. A tpub-hosted Navy training excerpt describes a sample
  GENADMIN as "classification … MSGID … NARR … DECL" with `DECL/30JAN99//`
  (<https://meteorologytraining.tpub.com/14272/css/14272_33.htm>). None of the community ATO
  examples carries a classification line. **Recommended:** export a bare first line equal to
  atobrief's `header.classification` (for example `UNCLAS`), and omit `DECL` for UNCLAS. The parser
  skips non-set lines before the first set, and records the first one as `classification`.
- **Case and character set**: upper case throughout. Stay within `A–Z 0–9 space . , - ( ) : +`.
  Whether `+` is legal in the USMTF character set is **unverified**, and it matters for atobrief
  loadout codes (§4).

### 1.3 Message structure of the ATO

Grouping from [AFIT] ("grouped first by tasked country, then by tasked service, and after that by
individual tasked units") and the DTD in [NPS] App. B (`tasked_country_segment` ⊃
`service_tasked_segment` ⊃ `task_unit_and_location_segment` ⊃ `aircraft_mission_data_segment`).
Mandatory-set rule from [455]: every mission has `AMSNDAT` and `MSNACFT`, plus exactly one of
`GTGTLOC`/`MTGTLOC`/`SHIPTGT`/`ESCDATA`/`RECCEDAT`/`AIRMOVE`/`AMSNLOC`. [AMVI]'s old ATOCONF rule
has the same shape: "PERID, AIRTASK, TASKUNIT, and MSNDAT are mandatory … one (but only one) of
MSNLOC, TGTLOC, RECDATA".

```
[classification line]                       e.g. UNCLAS
EXER | OPER                                 one of them
MSGID                                       mandatory
REF / AMPN / NARR                           optional, repeatable
AKNLDG                                      optional
TIMEFRAM                                    period of the ATO
( TSKCNTRY                                  repeat per country
  ( SVCTASK                                 repeat per service
    ( TASKUNIT                              repeat per unit
      ( AMSNDAT                             repeat per mission  ─┐
        MSNACFT+                            ≥1 per mission       │ mission
        GTGTLOC|…|AMSNLOC                   exactly one          │ segment
        optional: ASUPTFOR ASUPTBY PKGCMD 9PKGDAT CONTROLA     │
                  7CONTROL FACINFOR ARINFO REFTSK 5REFUEL        │
                  6ROUTE URMKREF AMPN NARR …                    ─┘
      )*
      GENTEXT (unit remarks)                optional
    )* )* )*
[DECL]                                      only if classified
```

**Recommended scoping rule (parser and exporter):** every set belongs to the mission opened by the
most recent `AMSNDAT`. A mission ends at the next `AMSNDAT`, `TASKUNIT`, `SVCTASK` or `TSKCNTRY`.
This also covers the package sets. [455] says `PKGCMD` "is used when the mission is part of a
package" and that `9PKGDAT` "provides the **package commander** information about missions in the
package". So `PKGCMD` sits **in each member mission**, and `9PKGDAT` sits **in the package
commander's mission** (the one with `MC` in `AMSNDAT`). ⚠ This differs from L3 §5.5, which closes
the current mission when it sees `9PKGDAT`/`PKGCMD`. L3 should attach them to the current mission
instead. L3 must also recognise `TSKCNTRY` and `SVCTASK`: they are the real names of the grouping
sets its briefing calls "`TASKCTRY`-style". Both close the current mission.

### 1.4 Time formats (DTG)

| Form | Example | Where |
|---|---|---|
| `DDHHMMZ` | `011000Z`, `141345Z` | inside a known month: `ARCT:`, `NLT:`, `TOSTA`, 5REFUEL `ARCT` [455] |
| `DDHHMMZMON` | `011000ZOCT`, `141200ZSEP` | AMSNLOC, DEPLOC/ARRLOC times, `NET:`/`TOT:` [455], [AFIT] (`241200ZAPR`) |
| `DDHHMMZMONYYYY` | `010600ZOCT1998` | TIMEFRAM FROM/TO/ASOF [455]; [NPS] DTD `(day, hour_time, minute_time, time_zone, month_name, year)` |
| `DDHHMMSSZ…` | (to the second) | GTGTLOC TOT variant in the [NPS] DTD (`day_time_on_target_to_the_second`) |

- The zone letter is `Z` (UTC). [CO] also allows `J` (local or sim time). **Recommended:** always
  `Z`. The parser warns on any other zone letter.
- Month: three-letter English upper case (`JAN`…`DEC`). Year: 4 digits.
- A DTG without a month or year is resolved against TIMEFRAM, picking the candidate inside (or
  nearest to) the ATO period (L3 `usmtf-time.js`).
- **In-game time.** All DTGs are **DCS in-game** UTC, never real-world time. atobrief keeps these
  apart (`header.ato_date` against `ato.irl_date`). The exporter must use `ato_date`.
- ⚠ [AMVI]'s ACO example writes `PERIOD/230600FEB2007/…` **without a zone letter**, which looks
  like a typo. The parser should accept it with a warning.

### 1.5 The sets, one by one

Notation: `f1…fn` are field positions after the set ID. **M** = mandatory in the recommended
reading, **O** = optional. The "recommended" column is what the L11 exporter writes and what the
L3 parser must read.

#### Header sets

| Set | Fields (recommended) | Example | Notes / sources |
|---|---|---|---|
| `EXER` | f1 exercise nickname **M**; f2 additional identifier O | `EXER/IRON FLAG 26-3//` | [AMVI], [NPS] DTD `exercise_nickname`, `exercise_message_additional_identifier`. [AMVI] also shows `EXER/OFF 450 FTU TRAINING/-//` |
| `OPER` | f1 operation codeword **M**; f2 plan originator and number O; f3 option nickname O; f4 secondary option nickname O | `OPER/505th TRS TRAINING//` [455]; `OPER/COBRA GOLD 07/C2WS/ATOTRNG/-//` [AMVI] | [455] says "one field only", but [AMVI] and the [NPS] DTD have 4. **Read 4, write 1** |
| `MSGID` | f1 `ATO` **M**; f2 originator **M**; f3 message serial number O; f4 month name O; f5 qualifier O (`CHG` = change; [AMVI] ACO also uses it); f6 qualifier serial number O | `MSGID/ATO/USCENTCOM/ATO A/OCT/CHG/1//` [455] | [CO] offers qualifier "New" or "CHG". A new ATO **leaves f5/f6 out**. [VRF]'s `MSGID/ATO/VIRTUALTLPSTAFF/-/NOV/TLPv CONFIDENTIAL/-//` misuses f5 for classification, so do not copy it. The month "does NOT by itself imply the ATO is valid for the entire month" [AMVI] |
| `AKNLDG` | f1 `YES`/`NO` **M**; f2 instructions O | `AKNLDG/NO//` | [455], [AMVI] |
| `TIMEFRAM` | f1 `FROM:`DTG **M**; f2 `TO:`DTG **M**; f3 `ASOF:`DTG O | `TIMEFRAM/FROM:010600ZOCT1998/TO:020559ZOCT1998/ASOF:302100ZSEP1998//` [455] | Also [CO] (ATO header) and the [NPS] DTD `effective_day_time_frame`. **Aliases the parser should accept:** `PERIOD` ([VRF]: `PERIOD/FROM 180000ZNOV18/TO182359ZNOV18//`, which is malformed) and the old `PERID` [AMVI]. In the **ACO**, `PERIOD/start/stop//` is the correct set [AMVI]. Normally 24 h, 0600Z to 0559Z the next day |

#### Tasking hierarchy

| Set | Fields | Example | Notes |
|---|---|---|---|
| `TSKCNTRY` | f1 tasked country **M** | `TSKCNTRY/US//` | [AFIT], [MX], [NPS] |
| `SVCTASK` | f1 tasked service code **M** | `SVCTASK/F//` | `F` = Air Force [AFIT]. Other letters (for example `A`, `N`, `M`) are **unverified**; the [NPS] XML uses free text (`ARMY`, `USAF`). Read it as an opaque string |
| `TASKUNIT` | f1 unit designator **M**; f2 location O (`ICAO:xxxx`, a place name, or a lat/long); f3 comments O | `TASKUNIT/23FS/ICAO:ETAD//` [AFIT] | [455]: "used only once and is followed by missions information assigned to this unit". [AMVI] has f3 comments |

#### Mission sets used by §9.9

**`AMSNDAT`: Aircraft Mission Data.** Recommended reading: the **12-field form (variant B)**.

| f | Meaning | M/O | Format |
|---|---|---|---|
| 1 | Residual mission indicator: `N` = non-residual, "the mission falls entirely within the ATO period" [AFIT] | M | `N` / `Y` (only `N` is attested) |
| 2 | Mission number | M | alphanumeric, e.g. `0121C`, `D123HB` |
| 3 | AMC mission number or event number | O | |
| 4 | Package identification | O | e.g. `AAF`, `AB` |
| 5 | Mission commander: `MC` if this mission is the package commander, else empty | O | |
| 6 | Primary mission type | M | code (§1.5 note) |
| 7 | Secondary mission type | O | code |
| 8 | Air alert status | O | code; values not public |
| 9 | Departure location, if not the TASKUNIT location | O | `DEPLOC:` + ICAO, base name or lat/long |
| 10 | Departure day-time and month | O | `DDHHMMZMON` |
| 11 | Recovery location | O | `ARRLOC:` + as f9 |
| 12 | Recovery day-time and month | O | `DDHHMMZMON` |

Example [AFIT]: `AMSNDAT/N/D123HB/-/-/-/SEAD/-/-/DEPLOC:KGZ6/241200ZAPR/ARRLOC:KDZ7/241300ZAPR//`

Where the sources disagree:

- **Variant A** [455, field list and standalone example]:
  `AMSNDAT/0121C/-/AAF/MC/BARCAP/-/-/DEPLOC:LBNA/ARRLOC:LLKA//`. It has 9 fields: no residual
  indicator and no DTGs.
- **Variant B** [455, its own multi-set example]:
  `AMSNDAT/N/0121C/-/AAF/-/BRCAP/-/` (line break) `/DEPLOC:LBNA/010715ZOCT/ARRLOC:LLKA/010815ZOCT//`.
  The break falls between two slashes, so f8 comes out **empty** rather than `-`. That is a wiki
  artefact: the parser reads the empty field as empty.
- Variant B is also what [AFIT] documents field by field, and what [CO] emits
  (`AMSNDAT/N/0121C/-/AAF/-/BARCAP/-/-/DEPLOC:LBNA/010715ZOCT/ARRLOC:LLKA/010815ZOCT//`).
- **Variant C** [VRF]:
  `AMSNDAT/40RJ1626/PACKAGE "HOTCHILI"/PHANTOM/COBRA/2F16/2F16/AI/-/0630Z/DEPLOC:LEAB/ARRLOC:LEAB/4G12/-/-//`.
  It mixes callsign, aircraft and configuration into AMSNDAT, like the old `MSNDAT` [AMVI]. It is
  **non-conforming. Do not support it**; flag it as `UNKNOWN_LAYOUT`.
- **Recommendation:** write B. Read B, and fall back to A when f1 is not a single letter (L3 §5.4
  already does this). Always find `DEPLOC`/`ARRLOC` **by key**, and treat the field right after
  each as its DTG when it is DTG-shaped.

**`MSNACFT`: Individual Aircraft Mission Data.** It repeats: one set per aircraft type or callsign
group in the mission.

| f | Meaning | M/O | Sources |
|---|---|---|---|
| 1 | Number of aircraft | M | all |
| 2 | Type and model: `ACTYP:` + code, or `OTHAC:` + free text | M | [455], [AFIT], [MX] |
| 3 | Call sign (abbreviated) | M | all |
| 4 | Primary configuration code (SCL, see [455] §"Configuration codes") | O | all |
| 5 | Secondary configuration code | O | all |
| 6… | Optional: **Link 16 abbreviated call sign, TACAN channel, primary JTIDS Unit (JU) address** | O | [AFIT], listed in this order: "secondary configuration codes, Link 16 abbreviated call sign, TACAN channel, primary JTIDS Unit address, and IFF/SIF mode and code" |
| last | **IFF/SIF mode and code**, repeated once per mode | O | [AFIT], [455], [CO-IFF] |

The public examples do not agree on the positions between f5 and the IFF group:

| Source | Line | Fields between config and IFF |
|---|---|---|
| [AFIT] | `MSNACFT/1/ACTYP:F16CJ/SUPP01/2HARM/-/20001/30111//` | none: IFF at f6 and f7 ("seven fields") |
| [455] | `MSNACFT/4/ACTYP:F15C/EAGLE 21/2IR6RK/BEST/-/27/-/20001/30111//` | three: `-`, `27`, `-`. The 455 field list says "Field 6 – Datalink code, Field 7 and following – IFF", which does not match its own example |
| [CO] | `MSNACFT/4/ACTYP:F16C/VIPER 1/2IR6RK/BEST/-/27/-/20001/30111//` | the same as [455] (copied) |
| [MX] | `MSNACFT/2/OTHAC:F16CJ/DART02/HARM/-/100/20163/30163//` | one: `100` ("older format") |
| [GOE] (excerpt) | `MSNACFT/1/ACTYP:C135FR/TOTAL31/BEST/-/101/-/32005//` | two: `101`, `-` |

Reading: the IFF group is **self-describing** (its first digit is the mode) and always comes
**last**. The datalink/TACAN/JU fields are optional and appear in varying numbers. Mapped onto the
[AFIT] order, the [455] line reads f6 = Link 16 abbreviated call sign (`-`), f7 = TACAN (`27`),
f8 = JU (`-`), then IFF. That is a consistent reading, but it is **unconfirmed**.

- **Recommended parse** (L3 already does this): take f1–f5 by position. Walk back from the end,
  taking at most 3 fields that are IFF-shaped or `-`; those are the IFF slots. Keep the fields in
  between as a raw `datalink[]` list.
- **Recommended export [PROFILE]** is a fixed 11-field shape, so that the parse is deterministic:
  `MSNACFT/count/ACTYP:type/callsign/cfg1/cfg2/L16cs/TACAN/JU/M1/M2/M3//`. It has 3 datalink slots
  in the [AFIT] order and exactly 3 IFF slots in the order Mode 1, Mode 2, Mode 3, with `-` for a
  mode that has no code.
  - The fixed IFF slots matter because a JU address is 5 octal digits. A JU such as `20011` has the
    same shape as a Mode 2 token, and without a Mode 1 slot the walk-back would take it for one.

**`AMSNLOC`: Aircraft Mission Location.** Used for missions that have no target point: CAP, AR,
AEW, alert, SEAD area and so on [455], [AFIT], [CO].

| f | Meaning | M/O | Format |
|---|---|---|---|
| 1 | Start day-time and month | O | `DDHHMMZMON` |
| 2 | Stop day-time and month | O | `DDHHMMZMON` |
| 3 | Mission location name | O | free, e.g. `SEIRAQ`, `CAP1` |
| 4 | Altitude, **hundreds of feet MSL** | O | `260` = 26,000 ft [455], [AFIT]. The old `MSNLOC` allowed "(altitude) or (flight level)" [AMVI], so also accept `FL260` and a block such as `240-260` with a warning, and never emit them |
| 5 | Mission priority | O | e.g. `1` |
| 6 | Location (coordinates or area) | O | only [455] and [CO] list it |

Examples: `AMSNLOC/011000ZOCT/011200ZOCT/SEIRAQ/260/1//` [455]; `AMSNLOC/-/-/-/210/1//` [AFIT] (5
fields); `AMSNLOC/280442ZOCT/280542ZOCT/CAP1/320/-/-//` [CO] (6 fields). EFSP M6 takes the **vul
window from f1/f2**.

**`GTGTLOC`: Ground Target Location.** Not in §9.9, but it carries the strike vul window (NET/NLT),
so L3 should read f2–f4. [455] field list: f1 `P`/`A`; f2 `TOT:`DTG; f3 `NET:`DTG; f4 `NLT:`DTG;
f5 target name; f6 `ID:`target id; f7 target type; f8 DMPI description; f9 `DMPIS:`coords; f10
datum (`WE` = WGS-84); f11 elevation (`257FT`); f12 component target id; f13 priority; f14 extra
id. [455]'s own example has 15 fields and [CO]'s has 14:
`GTGTLOC/P/TOT:090303ZDEC/-/NLT:090308ZDEC/-/TGT1/-/-/DMPI:4440639N4003212E/-/600FT/-/-/-//`.
[CO] even puts `-` where the name belongs and `TGT1` at f6 without an `ID:`. **Recommended:** read
TOT/NET/NLT/ID/DMPIS **by key only**.

**`CONTROLA`: Control of Air Assets.** It goes in the controlled mission.

| f | Meaning | M/O |
|---|---|---|
| 1 | Control agency type: `AWAC`, `CRC`, `OTR` [455]. [VRF] also shows `BOT`. Treat the value as an open set | M |
| 2 | Agency call sign | M |
| 3 | Primary: `PFREQ:` MHz, or `PDESIG:` designator | O |
| 4 | Secondary: `SFREQ:` or `SDESIG:` | O |
| 5 | Report-in point (RIP) | O |
| 6 | Control comments (old `CONTROL` set, [AMVI]) | O |

- [455]'s list has 5 fields, but its example `CONTROLA/AWAC/DARKSTAR/PDESIG:GREEN/SDESIG:WHITE/DR01/NAME:JIM//`
  has 6. The old `CONTROL` set had exactly 6, ending in "report-in point/control comments" [AMVI].
  So in the 455 example, `DR01` is the RIP and `NAME:JIM` is probably a comment. **[COMMUNITY]**
  reading.
- [VRF] shows `CONTROLA/BOT/COBRA/235.6/-/E5/-//`, with a bare frequency and no `PFREQ:`.
- **Recommended export:** `CONTROLA/AWAC/MAGIC 11/PFREQ:251.0/SFREQ:305.5/NAME:ALPHA//`, putting
  the RIP in f5 as `NAME:`. **Parse:** RIP = the `NAME:` value if present, else f5 bare. A bare
  number in f3 or f4 is a frequency. (This differs slightly from L3 §5.4, which takes "`NAME:` if
  present else first bare after secondary". The two agree on every example except 455's, where the
  4-field reading takes `DR01` and a `NAME:`-first reading takes `JIM`. **Prefer f5 by position**,
  i.e. `DR01`, and keep the other as `comments`.)

**`7CONTROL`: Control Information.** A columnar set in the **controlling agency's** mission (an AWACS
or CRC mission), one row per controlled mission [455]. Columns: `MSNNO` mission number, `ACSIGN`
call sign, `NO` count, `ACTYPE` (`AC:` + type), `MSNTY` mission type, `TOSTA` time on station
(`DDHHMMZ`), `RIP` report-in point (name, designator or coordinates such as `2840N08040W`). Example
row: `/0111I /TALON 11 /3/AC:A6E /INT /010930Z /2840N08040W`. Only [455] documents it.

**`ARINFO`: Air Refueling Information.** It goes in the **receiver's** mission. [455]'s list gives
16 fields, and its example has 17 tokens:

```
ARINFO/APPLE 20/4010A/B:34010/NAME:BLUE TRACK/200/ARCT:011000Z/NDAR:011015ZOCT/KLBS:30.0/
PFREQ:343.3/SFREQ:277.8/AE20/ACTYP:KC10/BOM/2/TNKR:2/18-81/2-2-4//
```

| pos (example) | token | 455 list says | Recommended reading |
|---|---|---|---|
| 1 | `APPLE 20` | tanker call sign | tanker call sign **M** |
| 2 | `4010A` | tanker mission number | tanker mission number (the join key to the tanker mission) |
| 3 | `B:34010` | tanker IFF/SIF mode+code | tanker IFF, Mode 3 `4010`. The `B:` descriptor is unexplained, so accept it with or without |
| 4 | `NAME:BLUE TRACK` | ARCP name | ARCP / track name |
| 5 | `200` | altitude, hundreds of ft | altitude, hundreds of ft |
| 6 | `ARCT:011000Z` | ARCT | air refueling control time |
| 7 | `NDAR:011015ZOCT` | end of AR | end of AR |
| 8 | `KLBS:30.0` | offload, klb | offload, klb |
| 9 / 10 | `PFREQ:` / `SFREQ:` | frequencies | frequencies (or `PDESIG:`/`SDESIG:`) |
| 11 | `AE20` | *(not in list)* | **unknown**; keep raw |
| 12 | `ACTYP:KC10` | list f11: tanker type | tanker type |
| 13 | `BOM` | list f12: AR system `BOM`/`CDT` | AR system: `BOM` = boom. `CDT` is probably a drogue type, **unverified** |
| 14 | `2` | list f13: unknown | unknown |
| 15 | `TNKR:2` | list f14: unknown | probably the number of tankers (**guess**) |
| 16 | `18-81` | list f15: TACAN | A/A TACAN pair (18 and 81 are 63 apart, the A/A channel offset) |
| 17 | `2-2-4` | list f16: unknown | unknown |

The list and the example are **off by one from position 11 on**. [CO] reproduces the same line
verbatim, so there is no second opinion. **Recommended:** parse by descriptor, plus positions
1/2/3/5; take the AR system as the first of `BOM|CDT|BOOM|DROGUE`, and the TACAN as the first field
that is `\d{1,3}-\d{1,3}` **or `\d{1,3}[XY]`**. The second form is needed because atobrief stores
TACANs as `39X`; L3's regex must be widened. **Export [PROFILE]:** keep the 16 positions of the
example, with `-` in 11, 14 and 15. The TACAN goes in 16.

**`REFTSK`: Refueling Task.** It goes in the **tanker's** mission. f1 AR system; f2 `KLBS:` total
offload; f3 `KLBS:` alert/contingency offload; f4 `PFREQ:`/`PDESIG:`; f5 `SFREQ:`/`SDESIG:`; f6
TACAN; f7 unknown. Example [455], [CO]: `REFTSK/CDT/KLBS:50.0/KLBS:20.0/PFREQ:323.3/SFREQ:242.8/29-92/3-3-4//`.

**`5REFUEL`: Refueling data.** A columnar set in the **tanker's** mission, one row per receiver.
Header [455]: `/MSNNO /RECCS /NO/ACTYPE /OFLD /ARCT /SEQ /TYP /ARS`, meaning receiver mission
number, receiver call sign, count, type (`AC:`), offload (`KLB:`), ARCT (`DDHHMMZ`), sequence
(`A:`), fuel type (`A:JP8`), AR system. [455]'s prose explanation skips `MSNNO` and calls `SEQ`
"unknown"; follow the header names. [CO] emits rows **without descriptors**
(`/205/UZI1/2/F-16C_50/-/280454ZOCT/-/-/-`), so the descriptor prefix is optional. Map columns **by
header name**.

**`9PKGDAT` and `PKGCMD`: Package data and Package Commander** [455]. Only 455 documents them.

- `9PKGDAT` is columnar: `/PKGID /UNIT /MSNNO /PMSN /NO/ACTYPE /ACSIGN`, one row per package
  member. It goes in the **commander's** mission (§1.3).
- `PKGCMD/pkg id/commander's unit/commander's mission no./commander's call sign//`, for example
  `PKGCMD/AN/CVN68 VA-165/0111I/TALON 11//`. It goes in **each member** mission.
- The package id also appears in AMSNDAT f4, and `MC` in f5. Those two fields are enough for EFSP
  M2. The package sets only add the commander's details.

**Others met in the examples:** `ASUPTFOR`/`ASUPTBY` (the supported and supporting mission; [455],
[CO]), `FACINFOR`, `6ROUTE` (the route; [CO]:
`/PN/ROUTEPT/TYP/ATIME/TAS/ALT`), `URMKREF` (remark refs), `MTGTLOC`, `SHIPTGT`, `RECCEDAT` +
`PTRCPLOT`, `AIRMOVE`. `ACMID` is an **ACO** set (airspace control means), not an ATO set [AMVI].
An ATO mission refers to ACMs only by name, e.g. AMSNLOC f3 or ARINFO `NAME:`.

**Mission-type codes.** The official code list is in 6040 and is not public. Attested codes
include:

| Code | Source |
|---|---|
| `BARCAP`, `BRCAP` | [455], [CO] |
| `FCAP`, `INT`, `ESC`, `EW` | [455] |
| `SEAD` | [AFIT] |
| `AI` | [VRF] |
| `STRIKE`, `ESCORT` | [CO] `ASUPTFOR`/`ASUPTBY` f1 |

⚠ **`INT` is interdiction, not intercept.** [455] tasks an A-6E and an F-15E as `INT`. The parser
treats mission types as opaque strings. **Recommended export:** atobrief's own vocabulary,
upper-cased (`CAP`, `STRIKE`, `SEAD`, `REFUELING`, …). This round-trips, and no receiver depends
on the official table.

### 1.6 Summary of the 455 wiki's self-contradictions

| Set | Contradiction | Recommended |
|---|---|---|
| AMSNDAT | Field list (9 fields, no `N`, no DTGs) against its own multi-set example (12 fields) | 12-field form ([AFIT], [CO] agree) |
| MSNACFT | "Field 6 datalink, 7+ IFF" against the example, which has IFF at 9–10 and `27` at 7 | IFF from the end; fixed 11-field profile for export |
| ARINFO | 16-field list against a 17-token example (unexplained `AE20` at 11) | descriptors plus positions 1/2/3/5; profile with `-` fillers |
| CONTROLA | 5-field list against a 6-field example | f5 = RIP, f6 = comments |
| OPER | "one field only" against the 4-field definition ([AMVI], [NPS]) | read 4, write 1 |
| AMSNLOC | 6 fields against [AFIT]'s 5 | f6 optional |
| 5REFUEL | Prose column list (8, missing MSNNO) against the header (9) | header names |
| MTGTLOC | two "Field 4" entries | not used |

---

## 2. IFF, datalink and callsigns

### 2.1 IFF/SIF in `MSNACFT` (and the tanker IFF in `ARINFO`)

- **Token = mode digit + code**, with no spaces:
  - `20001` = Mode 2, code 0001, and `30111` = Mode 3, code 0111 [AFIT], [455].
  - "3 digit for Mode 1 and 5 digit for Mode 3 … 131 means Mode 1, code 31, 35011 means Mode 3,
    code 5011" [CO-IFF].
- **Mode 1**: 2 digits. The first is octal 0–7 and the second 0–3 (32 codes). Token `1dd`.
- **Mode 2**: 4 octal digits, "personal unit identity" [AFIT]. Token `2dddd`.
- **Mode 3/A**: 4 octal digits, "normal air traffic control identity" [AFIT]. Token `3dddd`.
- **Mode 4 and Mode 5** are crypto modes; the ATO gives no codes for them. They are handled in SPINS
  or the ATO's free-text parts. [VRF] shows "A NOTIONAL IFF MODE 1 AND MODE 4 WILL BE USED…" in
  remarks. Mode C (altitude) and Mode S addresses do not appear in any public ATO example.
- The field **repeats**, once per mode, and the mode digit identifies each token, so order does
  not matter to a reader. The **[PROFILE]** export order is Mode 1, Mode 2, Mode 3, with `-`
  placeholders (§1.5).
- **Validation:** octal only. A 5-digit token starting with `1` is malformed. The Mode 3 checks
  (reserved `7500`/`7600`/`7700`, crc-sync's synthetic block) belong to L3 through
  `code-allocator` (L3 §5.4).
- **`IFF 1 xx 2 xxxx 3 xxxx`**: this spaced form appears in **no** USMTF source examined. It is a
  briefing/kneeboard convention. If it turns up, it will be inside `AMPN`/`NARR`/`GENTEXT`, never in
  `MSNACFT`. Do not emit it in a formatted field.

### 2.2 Datalink

- The only public statement is [AFIT]'s list: **Link 16 abbreviated call sign, TACAN channel,
  primary JTIDS Unit address**, placed after the configuration codes. The 455 wiki calls a single
  field "Datalink code", and its example value `27` is most likely the TACAN.
- Link 16 facts that do not depend on 6040: a JU/STN address is **5 octal digits** (`00001`–`77777`,
  15 bits). The Link 16 voice call sign is **4 characters** (e.g. `VP11`); this is from general
  Link 16 knowledge and was **not verified** against a public source.
- **[PROFILE]** f6 = Link 16 abbreviated call sign (4 characters), f7 = TACAN (e.g. `38Y`, or an
  A/A pair), f8 = primary JU (5 octal digits).
  - This is EFSP **M5** "datalink code".
  - L3 should store f6–f8 as `{ l16Callsign, tacan, ju }` when the message has exactly the
    11-field profile shape, and as `datalinkRaw[]` otherwise.

### 2.3 Callsigns

- MSNACFT f3 is the "call sign (abbreviated)" [455]. Examples: `EAGLE 21`, `TALON 11`,
  `LIGHTNING 01`, `SUPP01`, `DART02`, `VIPER 1`, `TOTAL31`, `UZI1`. So there may be a space between
  the name and the number, and a leading zero is allowed. Column values in 5REFUEL/7CONTROL/9PKGDAT
  are the same callsigns, space-padded.
- Normalisation belongs to L3 §5.6 (upper-case, strip spaces, `-` and `_`, then require
  `^[A-Z0-9]{1,7}$`).
  - ⚠ Name + two digits overflows 7 characters for names longer than 5 letters (`LIGHTNING 01`,
    `DARKSTAR`, `WEASEL 41`). Those lines become non-seedable, which is by design.
  - The **exporter** should warn when an atobrief callsign normalises to more than 7 characters.
- atobrief callsigns are DCS group names (`SHADOW-1`, `Knight 2`). Export them upper-cased with `-`
  and `_` replaced by a space (`SHADOW 1`, `KNIGHT 2`). Never abbreviate.

---

## 3. Synthetic example ATO (test fixture)

**SYNTHETIC. Not derived from any real ATO.** It follows every recommended reading and
**[PROFILE]** shape above, and it is laid out as the L11 exporter would emit it: wraps only after
`/`, lines of 69 characters or fewer. Theatre: Persian Gulf, in-game date 14 SEP 2026.

It contains:
- a 2-ship CAP, `VIPER 11`, which receives fuel;
- a strike package `AB`:
  - package commander `DUDE 21` (F-15E, `GTGTLOC`, receives fuel, carries `9PKGDAT`);
  - `SNAKE 41` (SEAD, `PKGCMD`);
- a tanker `SHELL 71` with `REFTSK` and `5REFUEL` for both receivers;
- the AWACS `MAGIC 11` with `7CONTROL`.

The IFF codes are octal and avoid reserved codes. Every cross-reference matches: mission numbers,
ARCTs, offloads, TACAN and callsigns agree between each `ARINFO`, `5REFUEL` and `7CONTROL`.

```text
UNCLAS
EXER/IRON FLAG 26-3//
MSGID/ATO/SOURCEDCS AOC/ATO C/SEP//
AKNLDG/NO//
TIMEFRAM/FROM:140600ZSEP2026/TO:150559ZSEP2026/
     ASOF:131800ZSEP2026//
TSKCNTRY/US//
SVCTASK/F//
TASKUNIT/SOURCE DCS 1/ICAO:OMAM//
AMSNDAT/N/1101A/-/-/-/CAP/-/-/DEPLOC:OMAM/141200ZSEP/ARRLOC:OMAM/
     141530ZSEP//
MSNACFT/2/ACTYP:F16C/VIPER 11/402+/-/VP11/-/00011/112/20011/
     34521//
AMSNLOC/141300ZSEP/141500ZSEP/CAP NORTH/250/1//
CONTROLA/AWAC/MAGIC 11/PFREQ:251.0/SFREQ:305.5/NAME:ALPHA//
ARINFO/SHELL 71/1901T/34571/NAME:ANCHOR BLUE/220/ARCT:141345Z/
     NDAR:141400ZSEP/KLBS:12.0/PFREQ:276.1/-/-/ACTYP:KC135/BOM/-/
     -/38Y//
TASKUNIT/SOURCE DCS 2/ICAO:OMAM//
AMSNDAT/N/1202S/-/AB/MC/STRIKE/-/-/DEPLOC:OMAM/141315ZSEP/
     ARRLOC:OMAM/141645ZSEP//
MSNACFT/2/ACTYP:F15E/DUDE 21/202+4X31/-/DU21/-/00021/121/20021/
     34531//
GTGTLOC/P/-/NET:141458ZSEP/NLT:141502Z/COMMAND BUNKER/ID:TGT-01/
     -/-/DMPIS:271130N0561845E/WE/120FT//
CONTROLA/AWAC/MAGIC 11/PFREQ:251.0/SFREQ:305.5/NAME:BRAVO//
ARINFO/SHELL 71/1901T/34571/NAME:ANCHOR BLUE/220/ARCT:141420Z/
     NDAR:141440ZSEP/KLBS:16.0/PFREQ:276.1/-/-/ACTYP:KC135/BOM/-/
     -/38Y//
9PKGDAT
/PKGID /UNIT         /MSNNO /PMSN   /NO/ACTYPE  /ACSIGN
/AB    /SOURCE DCS 2 /1202S /STRIKE /2 /AC:F15E /DUDE 21
/AB    /SOURCE DCS 2 /1203S /SEAD   /2 /AC:F16C /SNAKE 41//
NARR/PACKAGE AB PUSH FROM IP WEST AT 141445Z//
AMSNDAT/N/1203S/-/AB/-/SEAD/-/-/DEPLOC:OMAM/141305ZSEP/
     ARRLOC:OMAM/141640ZSEP//
MSNACFT/2/ACTYP:F16C/SNAKE 41/402+2X88/-/SN41/-/00041/141/20041/
     34541//
AMSNLOC/141450ZSEP/141510ZSEP/SEAD BOX EAST/240/1//
CONTROLA/AWAC/MAGIC 11/PFREQ:251.0/SFREQ:305.5/NAME:BRAVO//
PKGCMD/AB/SOURCE DCS 2/1202S/DUDE 21//
GENTEXT/UNIT REMARKS/SNAKE 41 WEAPONS FREE IN SEAD BOX EAST ONLY//
TASKUNIT/909ARS/ICAO:OMAM//
AMSNDAT/N/1901T/-/-/-/REFUELING/-/-/DEPLOC:OMAM/141130ZSEP/
     ARRLOC:OMAM/141700ZSEP//
MSNACFT/1/ACTYP:KC135/SHELL 71/-/-/-/38Y/-/-/-/34571//
AMSNLOC/141230ZSEP/141630ZSEP/ANCHOR BLUE/220/1//
REFTSK/BOM/KLBS:60.0/KLBS:10.0/PFREQ:276.1/-/38Y//
5REFUEL
/MSNNO /RECCS    /NO/ACTYPE  /OFLD    /ARCT    /SEQ /TYP   /ARS
/1101A /VIPER 11 /2 /AC:F16C /KLB:12.0/141345Z /A:1 /A:JP8 /BOM
/1202S /DUDE 21  /2 /AC:F15E /KLB:16.0/141420Z /A:2 /A:JP8 /BOM//
TASKUNIT/960AACS/ICAO:OMAM//
AMSNDAT/N/1801W/-/-/-/AEW/-/-/DEPLOC:OMAM/141100ZSEP/
     ARRLOC:OMAM/141800ZSEP//
MSNACFT/1/ACTYP:E3/MAGIC 11/-/-/MG11/-/00001/-/-/34501//
AMSNLOC/141200ZSEP/141730ZSEP/AEW ORBIT/300/1//
7CONTROL
/MSNNO /ACSIGN   /NO/ACTYPE  /MSNTY  /TOSTA   /RIP
/1101A /VIPER 11 /2 /AC:F16C /CAP    /141300Z /ALPHA
/1202S /DUDE 21  /2 /AC:F15E /STRIKE /141445Z /BRAVO
/1203S /SNAKE 41 /2 /AC:F16C /SEAD   /141440Z /BRAVO//
```

What a correct parse must yield. This doubles as a test oracle.

| Mission | Callsign (norm.) | Pkg / MC | Mode 1/2/3 | Datalink (L16 / TACAN / JU) | Vul window | Agency (RIP) | AR |
|---|---|---|---|---|---|---|---|
| 1101A | VIPER11 | – | 12 / 0011 / 4521 | VP11 / – / 00011 | 1300–1500Z (AMSNLOC) | MAGIC 11 AWAC 251.0 (ALPHA) | recv SHELL 71, ARCT 1345Z, 12.0 klb |
| 1202S | DUDE21 | AB / MC | 21 / 0021 / 4531 | DU21 / – / 00021 | 1458–1502Z (GTGTLOC NET/NLT) | MAGIC 11 (BRAVO) | recv SHELL 71, ARCT 1420Z, 16.0 klb |
| 1203S | SNAKE41 | AB / cmdr 1202S | 41 / 0041 / 4541 | SN41 / – / 00041 | 1450–1510Z | MAGIC 11 (BRAVO) | – |
| 1901T | SHELL71 | – | – / – / 4571 | – / 38Y / – | 1230–1630Z | – | tanker: 2 receivers, 60.0 klb total |
| 1801W | MAGIC11 | – | – / – / 4501 | MG11 / – / 00001 | 1200–1730Z | – (is the agency) | – |

Deliberate edge cases in the fixture:
- wrapped linear sets, including a wrap directly after `DEPLOC:OMAM/` and one inside `TIMEFRAM`;
- a one-line free-text `GENTEXT` (free text cannot be wrapped after a `/`, so the exporter must
  break it only after a space it keeps; the parser's `\n\s*` → `""` rule then preserves the space);
- a `9PKGDAT` inside the commander's mission, followed by a `NARR`;
- trailing optional fields left out in `MSGID`;
- `-` IFF placeholders;
- a TOT of `-` with NET/NLT present;
- `DDHHMMZ` values resolved against TIMEFRAM.

---

## 4. Mapping atobrief YAML → USMTF (for L11) and the gaps both ways

Source: `docs/atobrief/yaml-format.md`. "✔" = direct. "~" = derived or lossy. "✘" = no home.

| atobrief field | USMTF set / field | | Notes |
|---|---|---|---|
| `header.classification` | first line (e.g. `UNCLAS`); `DECL` if classified | ~ | atobrief has no declassification data. Refuse to export anything but UNCLAS |
| `header.operation` | `EXER` f1 (or `OPER` f1) | ~ | atobrief does not say which. Default `EXER`; config switch |
| `header.ato_date` | `MSGID` f4 month; date part of every DTG; `TIMEFRAM` | ✔ | in-game date |
| `ato.ingame_start_time` | `TIMEFRAM FROM:` | ~ | TO = FROM + 24 h − 1 min; ASOF = export time mapped to in-game date. Both invented, so flag them |
| `ato.irl_date`, `irl_time_zulu` | – | ✘ | real-world time has no USMTF home. Optionally `NARR` |
| `ato.local_offset_hours` | – | ✘ | USMTF is `Z` only |
| `ato.codewords[]` | `GENTEXT/CODEWORDS/…` | ~ | free text only |
| `missions[].mission_number` | `AMSNDAT` f2 | ✔ | verbatim. `MSN3266` is valid alphanumeric. Keep it identical to the SPINS C3 join (which strips `MSN`); L11 and L3 must agree on one form |
| `missions[].callsign` | `MSNACFT` f3 | ✔ | upper-case, `-`/`_` → space (§2.3) |
| `missions[].mission_type` | `AMSNDAT` f6 | ✔ | verbatim upper-case (§1.5 note) |
| `missions[].unit` | `TASKUNIT` f1 (missions grouped by unit) | ✔ | missing unit → a configured default unit |
| `missions[].deploy` / `recovery` | `AMSNDAT` f9 `DEPLOC:` / f11 `ARRLOC:` | ✔ | ICAO or carrier id verbatim |
| `missions[].takeoff_time` / `recovery_time` | `AMSNDAT` f10 / f12 | ✔ | HHMMZ + ato_date → `DDHHMMZMON` |
| `missions[].divert` | – | ✘ | `NARR` at most |
| `missions[].dtc_cartridge` | – | ✘ | internal |
| `aircraft.count` / `type` | `MSNACFT` f1 / f2 `ACTYP:` | ✔ | DCS type strings are not official ACTYP codes. Use `ACTYP:` anyway, since the squadron owns both ends |
| `aircraft.loadout` | `MSNACFT` f4 (primary configuration) | ~ | the atobrief loadout code (`501+3X381X114`) is not a USMTF SCL (`X4222`, `4G310`). Export it verbatim as an opaque code. `+` may be outside the USMTF character set (§1.2), so this is **unresolved** |
| `targets[].target_id` | `GTGTLOC` f6 `ID:` (+ f5 name, f9 `DMPIS:`, f11 elevation from `registry.targets`) | ✔ | DMS `N26°30'00"` → `263000N0562000E` |
| `targets[].tot_net` / `tot_nlt` | `GTGTLOC` f3 `NET:` / f4 `NLT:` | ✔ | TOT (f2) = `-`; atobrief has no single TOT |
| `targets[].tos` / `toffs` | `AMSNLOC` f1 / f2 | ✔ | **the vul window for CAP/CAS-type missions** |
| derived `_vul_start`/`_vul_end` (IP/EP times) | – | ✘ | IP/EP times are **not** the ATO vul window (L3 §3.6). Do not export them as AMSNLOC |
| `steer_points[]` | `6ROUTE` [CO] | ~ | out of §9.9 scope |
| `steer_points[].orbit.alt_ft` | `AMSNLOC` f4 (÷100) | ~ | first orbit on the route |
| orbit / station name | `AMSNLOC` f3 | ~ | the registry steerpoint or ACM name, if any |
| `control.agency_id` → `registry.control_agencies` | `CONTROLA` f1 (`AWACS`→`AWAC`, `CRC`→`CRC`), f2 callsign, f3 `PFREQ:` | ✔ | f3 = the `primary_freq_mhz` override, else the registry value |
| – | `CONTROLA` f4 `SFREQ:`, f5 RIP | ✘ | atobrief lacks both (§4.2) |
| `refuel[].tanker_id` → `registry.tankers[]` | `ARINFO` f1 callsign, f5 alt (`altitude_ft`/100), f9 `PFREQ:` (`freq_mhz`), f12 `ACTYP:` (`registry.callsigns[..].type`), f16 TACAN (`tacan`) | ✔ | |
| `refuel[].time_from` / `time_to` | `ARINFO` f6 `ARCT:` / f7 `NDAR:` | ~ | atobrief's "AAR window open/close" is read as ARCT/end-AR |
| `registry.tankers[]` | a **synthesized tanker mission**: `AMSNDAT` + `MSNACFT` + `AMSNLOC` (orbit) + `REFTSK` + `5REFUEL` rows built from every `refuel[]` that names this tanker | ~ | needs an invented mission number, unit and times (§4.2) |
| `registry.control_agencies` | optionally a synthesized AEW/CRC mission with `7CONTROL` rows | ~ | not needed for M7, since CONTROLA alone gives it |
| `spins` C3 IFF table (`[msn, "3", code]`) | `MSNACFT` Mode 3 slot | ✔ | The codes are random today (L3 §3.6); `Flashbang 1.6.yaml` has none |
| `aco.*` | the **ACO** message (`ACMID`, …), not the ATO | ✘ | separate message |
| `spins.*` (other), `comms.*`, `weather.*`, `registry.bullseye`/`reference_points`/`lines`, threat data | – | ✘ | not ATO content (SPINS and the comm plan are separate documents) |

### 4.1 atobrief data with no USMTF home

`irl_date`/`irl_time_zulu`, `local_offset_hours`, `divert`, `dtc_cartridge`, per-waypoint
`speed_kts`/`route` tags, orbit geometry (width, leg, heading, direction), the steerpoint registry,
lines, bullseye, comms preset tables, weather, the SAM threat database, and codewords (free text
only). The in-game/real-time distinction is squadron-specific.

### 4.2 USMTF acceptance fields atobrief lacks (EFSP WP7 needs most of them)

| USMTF field | EFSP block | Status in atobrief | Suggested atobrief addition (L11 / later) |
|---|---|---|---|
| Package id (AMSNDAT f4), MC (f5), PKGCMD/9PKGDAT | **M2** | none | `mission.package_id`, `mission.package_commander: bool` |
| Mode 1 / Mode 2 | **M4** | none | `mission.iff: {mode1, mode2, mode3}`, with Mode 3 moved out of SPINS |
| Mode 3 | reconciliation bridge (L14) | SPINS C3 only, random | the same `mission.iff.mode3`, allocated rather than random |
| Link 16 call sign / TACAN / JU | **M5** | none | `mission.datalink: {l16_callsign, tacan, ju}` |
| Vul window for non-CAP missions | **M6** | only derived IP/EP times | explicit `mission.vul: {start, end}`, or rely on GTGTLOC NET/NLT |
| Report-in point, secondary frequency | **M6/M7** | none | `control.report_in_point`, `control.secondary_freq_mhz` |
| Alert status (AMSNDAT f8) | **M16** | none | `mission.alert_status` |
| Secondary mission type, mission priority | M3 | none | optional |
| Tanker mission number, ARCP name, offload, AR system, tanker IFF | **M12** | tankers are not missions | `registry.tankers[].mission_number`, `arcp`, `offload_klb`, `system: BOOM\|DROGUE` |
| MSGID originator / serial / CHG qualifier, TIMEFRAM end / ASOF | header | none | `header.originator`, `header.serial`, `header.ato_type: EXER\|OPER` |
| TSKCNTRY / SVCTASK | hierarchy | none | configured constants (`US` / `F`) |

Per decision H1, L3 flags each missing acceptance field per mission, so L14 can fall back to
callsign binding. An export from today's atobrief will have **empty M2/M4/M5/M16 on every
mission**, and an M6 window only for missions with `tos`/`toffs` or NET/NLT.

---

## 5. Public-source caveats

- **Official and restricted.**
  - MIL-STD-6040(B) is *Distribution Statement C: US Government agencies and their contractors*,
    controlled by DISA. It is obtained through DoD-PKI portals, and foreign release needs disclosure
    authorisation [6040]. It holds the authoritative set and field definitions, code tables
    (mission types, alert status, SVCTASK letters, ACTYP codes, AR systems) and field lengths. **None
    of that is in this note.**
  - NATO APP-11 and ADatP-3 are sold or distributed through NSO and national channels
    (<https://standards.globalspec.com/std/9984523/nato-app-11-d>); they were not consulted either.
  - AFTTP 3-3.AOC and similar ATO-reading guides are generally not public.
- **Official or academic, public.**
  - [AFIT] is peer-reviewed, public, and cites the 2004 USMTF baseline. It is the only public
    source that explains AMSNDAT (12 fields), the TSKCNTRY/SVCTASK/TASKUNIT hierarchy and the
    MSNACFT datalink fields.
  - [NPS] gives the element names and hierarchy of a 2000-era XML-MTF ATO. Its App. B DTD is
    hand-trimmed and puts MSNACFT data **before** AMSNDAT, so do not read message order from it.
  - [WP] gives background only.
- **Community.**
  - [455]: its field lists are internally inconsistent (§1.6). It is the only source for
    `7CONTROL`, `9PKGDAT`, `PKGCMD`, `REFTSK` and most of `ARINFO`. Its examples reuse a 1998 USAF
    training ATO (`505th TRS TRAINING`, `ATO A`), apparently the T.B. Williams *ATO USMTF 2000
    Primer*, which is on Course Hero and paywalled:
    <https://www.coursehero.com/file/8720202/ATO-Primer/>.
  - [CO] is a working generator in the DCS ecosystem. Its examples copy 455's for MSNACFT and
    ARINFO, so they are **not independent confirmation** of those two sets. Its AMSNDAT, AMSNLOC,
    GTGTLOC and 5REFUEL output differs from 455 in useful ways.
  - [AMVI] gives the older ATOCONF vocabulary and a plausible real ACO header.
  - [VRF] is a non-conforming dialect.
  - [MX] and [GOE] are single lines, and GOE was seen only as a search excerpt.
- **Consequence.** Treat every field position beyond AMSNDAT (which [AFIT] confirms), the MSNACFT
  config fields and the IFF token format as **[COMMUNITY]**. The **[PROFILE]** shapes in this note
  exist so that *our* exporter and parser agree. A third-party producer (for example Combined Ops'
  AOC Tools) may put datalink fields differently, which is why the parser must stay
  descriptor-first and read IFF from the end.

### Unresolved ambiguities

1. MSNACFT: the real positions and meaning of the fields between the configuration codes and IFF
   (Link 16 call sign / TACAN / JU, or a single "datalink code").
2. ARINFO: the meaning of positions 11 (`AE20`), 14, 15 (`TNKR:`) and 17 (`2-2-4`), and of the
   `B:` descriptor on the tanker IFF.
3. CONTROLA: whether f5 or `NAME:` is the RIP when both are present.
4. Official code tables: mission types, alert status, SVCTASK letters, the AR system `CDT`, ACTYP
   codes.
5. The USMTF character set (is `+` legal?) and the maximum field lengths, which matter for
   atobrief loadout codes and long callsigns.
6. The placement of `9PKGDAT`/`PKGCMD` (the recommended reading is in-mission; L3 currently treats
   them as package-level).
7. The classification line and `DECL` form in a modern ATO. No ATO example shows either.
