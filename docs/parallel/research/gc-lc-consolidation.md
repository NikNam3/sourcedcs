# Ground control consolidated at local control: what the FAA allows, and what the EFSP does

Research lane DOC-GCLC (docs only), 2026-10-02. Question: desk RP-F1 / NX-3, decisions.md H101 and H102. The human:
"ground and tower are two different controllers… they obviously use two different frequencies so I assume there
are some more differences but I might be wrong". The ADR draft that takes this note's recommendation is
`docs/wip/DOC-GCLC-adr-draft.md`.

## 0. The answer in brief

- **The FAA allows it, under conditions.** One controller may work ground and local together ("consolidated" or
  "combined"), but JO 7210.3 ¶2-6-5 limits it to **periods of significantly reduced traffic**, and **never while the
  facility is conducting LUAW operations** (¶2-6-5, ¶10-3-8). The controller who works both is signed on to both and
  responsible for both, and must keep monitoring both frequencies.
- **The EFSP does something else under the same name.** Our "consolidation" moves GC's Strips to LC, but LC
  **cannot advance them**, because the permission table gives PUSHBACK, TAXI and TAXI_IN to GC only. The Strips are
  parked in LC's Coordination Bay until somebody signs on to GC. They are not worked.
- **The EFSP already has the FAA's model.** It is *combination* (guide §4.8.4): one controller signed on to GC and LC
  at once, with two Bay groups and the permissions checked per Position. Nothing warns about it today, and nothing
  knows about the LUAW rule.
- **The EFSP's departure lifecycle always goes through LUAW.** From RUNWAY_QUEUE the only next state is LUAW, so
  every departure is a LUAW operation. Read literally, ¶2-6-5 would then forbid combining GC and LC whenever a
  departure is moving.

## 1. What the FAA texts say

Versions read: **FAA Order JO 7210.3EE**, *Facility Operation and Administration* (its ¶1-1-4 cancels 7210.3DD of
20 April 2023), and **FAA Order JO 7110.65BB**, *Air Traffic Control*. Both were read on faa.gov on 2026-10-02.
WebFetch got a 403 there, so the pages were fetched with curl and read as text. The HTML drops the subparagraph
letters, so the letters cited below were **counted from the list structure** using the orders' own convention
(a., 1., (a)). Treat the letters as reconstructed; the paragraph numbers are printed in the pages.

### 1.1 JO 7210.3EE ¶2-6-5, Consolidating Positions

<https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap2_section_6.html>

> a. Assign personnel to positions as required by activity, equipment, and facility function. Positions may be
> consolidated in consideration of activity and the qualifications of the personnel involved.
>
> b. To the extent staffing resources permit, and where the position is established, the tower associate (local
> assist) position must be staffed. This position is considered essential to the operational integrity and safety
> levels required to minimize the potential for surface errors and land‐over incidents. Nonlocal control functions
> must not be consolidated/combined at the local control position except during periods of significantly reduced
> traffic levels.
>
> c. When conducting line up and wait (LUAW) operations, local control position must not be consolidated/combined
> with any other non‐local control position. REFERENCE- FAA Order JO 7210.3, Para 10-3-8.

Our research quote (the question) matches the text. Three points matter:

1. **"Consolidated/combined" is one notion.** The order writes the two words with a slash and never defines them
   apart. The meaning comes from use: one person signed on and responsible for more than one position's functions
   (¶2-2-3, §1.3 below). Nothing in the order *moves* traffic from one position to another; the person takes on the
   other position's job.
2. **Ground control is a "nonlocal control function".** TBL 10-1-1 lists GC (Ground Control) and LC (Local Control)
   as separate positions (§1.4). The only positions that may be combined with LC without restriction are other
   *local* positions (¶10-3-8a4, §1.2).
3. **Condition b is about traffic, condition c about the procedure in force.** "Significantly reduced traffic
   levels" is left to judgement: the order gives no number. "When conducting LUAW operations" refers to the
   facility's LUAW procedure being used, not to an aircraft being on the runway at this moment (§1.2).

### 1.2 JO 7210.3EE ¶10-3-8, LUAW operations

<https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap10_section_3.html>

The ATM must find an operational need for LUAW (a1), review the airport configuration (a2), and prepare a facility
directive (a3). The directive must cover, among other things, "(c) The consolidation and staffing of positions".
Then:

> a4. Local control position must not be consolidated/combined with any other non-local control position. For
> example, local control must not be consolidated/combined with the operations supervisor (OS)/controller-in-charge
> (CIC) position, clearance delivery, flight data, ground control, cab coordinator, etc. Local control can be
> combined with other local control positions to include tower associate (local assist) or local monitor position.
> When a Class B/helicopter position with defined control tower airspace is established, this position can be
> combined with local control.
>
> a5. The tower associate (local assist) position or a local monitor position must be staffed to permit more than one
> aircraft at a time to LUAW on the same runway between sunrise and sunset.
>
> a6. The OS/CIC position should not be combined with any other position.

**Ground control is named.** At a facility using LUAW there is no traffic-level exception: GC is never combined with
LC there. The LUAW approval sits with the Service Area Director (a10, a11), so "conducting LUAW operations" is a
facility-level status, approved and reviewed every year (a12). It is not a per-aircraft event.

### 1.3 Who decides, and how it is recorded

- **Who decides.** The ATM sets the rules: ¶2-6-5a ("assign personnel to positions as required by activity"),
  ¶2-6-12 (consolidating tower and TRACON in the cab needs a facility directive), and ¶10-3-8a3(c) (the LUAW
  directive covers consolidation). The **watch supervisor or CIC** makes the call on the day: ¶2-6-1d lists
  "Assigning positions/relief from positions" among the minimum watch-supervision tasks
  (<https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap2_section_6.html>).
- **One responsible person per consolidated position.** ¶2-2-3: "only one certified air traffic controller is signed
  on and responsible for each open position, **to include consolidated positions**, at any given time"
  (<https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap2_section_2.html>).
- **Recorded.** ¶2-2-6: the Cru‑X/ART electronic logs "must be used to indicate responsibility at all operational
  positions". The relieved controller enters the time of the change; when a position opens, the person opening it
  does. Paper Form 7230‑10 is the fallback. A combination is a sign-on record, not a separate form.
- **Combining is a relief like any other, done with care.** JO 7110.65BB ¶2-1-24 requires Appendix A's relief SOP
  every time responsibility moves. Appendix A, Precautions: "Extra care should be taken when more than one specialist
  relieves or is being relieved from a position at the same time; e.g., combining or decombining positions. Such
  simultaneous reliefs should be approached with caution."
  (<https://www.faa.gov/air_traffic/publications/atpubs/atc_html/appendix_a.html>,
  <https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap2_section_1.html>)

### 1.4 Ground and local are different jobs (JO 7110.65BB)

- **Positions.** JO 7210.3EE TBL 10-1-1 lists GC Ground Control, LC Local Control, CD Clearance Delivery and CC
  Coordinator (Tower) as separate designators
  (<https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap10_section_1.html>).
- **The runway belongs to LC.** ¶3-1-3: "The local controller has primary responsibility for operations conducted on
  the active runway and must control the use of those runways." GC must get LC's approval, naming the
  point/intersection, before letting an aircraft or vehicle cross or use any part of an active runway (a). LC
  authorizes with "CROSS (runway) AT (point)" (b). GC reports the operation complete (c). LC coordinates with GC
  before using a runway not previously designated active (e). Subpara d (operations *along* the runway only on the
  LC frequency) is marked "USA/USAF/USN NOT APPLICABLE": the services set their own local rules.
  (<https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap3_section_1.html>)
- **They exchange information.** ¶3-1-4: LC and GC "must exchange information as necessary… via verbal means,
  flight progress strips, other written information, or automation displays". GC tells LC about a departure taxied
  to a runway other than the active one (a) and about an aircraft taxied to an intersection (b).
- **GC owns the movement area.** ¶3-7-1 and ¶3-7-2: approve or disapprove movement on the movement area, give the
  taxi route up to the runway hold-short point, and give crossing instructions with the place to cross
  (<https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap3_section_7.html>). JO 7210.3EE ¶10-1-7 makes
  the ATM provide memory aids for runway crossing, LUAW and landing clearance, and procedures "to assist the local
  and ground controllers in maintaining awareness of aircraft positions".
- **Clearance delivery uses its own frequency or GC's.** JO 7210.3EE ¶10-4-6: pretaxi clearance on the CD frequency,
  or on the GC frequency "if the service can be provided without derogating the primary function of GC"; after the
  clearance the aircraft goes to GC for taxi
  (<https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap10_section_4.html>).

Why combining is risky. The runway crossing in ¶3-1-3 is a **two-person check**: GC asks, LC approves, GC reports
complete. Combined, one head does both halves and the check is gone. A LUAW aircraft sits on the runway and waits
for LC to remember it, and LUAW is the setting of runway incursions and land-over events. That is why ¶2-6-5b calls
the local assist position "essential… to minimize the potential for surface errors and land‐over incidents", and why
¶10-3-8a4 takes every other duty off LC while LUAW is in use. That reading is ours: the orders state the rule, not
the reason, beyond ¶2-6-5b's sentence.

### 1.5 Frequencies when combined

- **Every frequency stays monitored.** JO 7210.3EE ¶3-3-3: "Frequencies allocated to a facility must be continuously
  monitored", and shared frequencies must be "continuously monitored by one of the positions of operation"
  (<https://www.faa.gov/air_traffic/publications/atpubs/foa_html/chap3_section_3.html>). A controller who combines GC
  and LC therefore monitors **both** the ground and the tower frequency. Neither goes silent.
- **The order expects combined positions to keep separate frequencies.** JO 7110.65BB ¶2-1-17: "In situations where
  a sector has multiple frequencies **or when sectors are combined using multiple frequencies** and the aircraft will
  remain under your jurisdiction", phraseology "CHANGE TO MY FREQUENCY (frequency)". The same paragraph allows
  "Monitor Tower / Monitor Ground" for aircraft on the ground after coordination, and "Contact Ground/Tower"
  without the frequency when the pilot knows it. The text applies to sectors (en route), but the TERMINAL lines show
  the same model: pilots keep using the published GC and LC frequencies, and the one controller answers on both.
- **Not verified:** whether a tower, when combined, *couples* or *cross-couples* GC and LC so pilots on one hear the
  other. That is real-world practice we have heard of, but we found no faa.gov text for it in the paragraphs read.
  Nor did we verify ATIS wording such as "ground and tower combined on …".

### 1.6 What real towers do when it is quiet

From the order text only:

- ¶2-6-5a makes consolidation normal "in consideration of activity". ¶2-6-12 says tower and TRACON functions are
  "not normally consolidated during non-midwatch operations", and on midwatch "all functions may be consolidated
  for meals or breaks". ¶2-6-13 (single-person midnight operations): "When operations permit, it is expected that
  functions will be consolidated."
- ¶2-6-2 lets a CIC or supervisor do operational duties "on a limited basis such as during periods of low activity".
  During LUAW ¶10-3-8a6 says the OS/CIC "should not be combined with any other position".

So a quiet tower routinely runs GC and LC on one controller, often with CD and flight data as well, provided it is
not conducting LUAW operations. Once traffic builds, the CIC splits the positions out again. **Not verified:** any
national number for "significantly reduced traffic"; we found none, and it is left to the facility.

### 1.7 Military practice (USAF, Incirlik)

- JO 7110.65BB applies to USAF controllers where it says so: it carries USAF/USN-specific subparagraphs, e.g.
  ¶3-9-4l (USAF/USN: tell an aircraft holding in position to "CONTINUE HOLDING" or "TAXI OFF THE RUNWAY"),
  ¶3-9-4i (USN: no simultaneous LUAW on intersecting runways), and ¶3-1-3d's "USA/USAF/USN NOT APPLICABLE".
- **JO 7210.3 is an FAA facility-administration order.** Its ¶1-1-2 audience is "all ATO personnel and anyone using
  ATO directives". A USAF tower is run under the Department of the Air Force's own manual, DAFMAN 13‑204 Volume 3
  (formerly AFI 13‑204v3), *Air Traffic Control*. **Not verified:** what DAFMAN 13‑204v3 says about combining
  positions, LUAW or minimum tower manning. e‑publishing.af.mil returned 403 to every request, and the web search
  quota ran out during this lane. **Not verified:** any public description of Incirlik's (LTAG, 39th ABW) tower
  manning. So for our Incirlik facility, ¶2-6-5 is the best *public* doctrine we have, applied by analogy, and the
  USAF rule itself is open.

## 2. What the EFSP does today

The code was read on `lane/DOC-GCLC-research`, branched from `efsp-wp5-correlation` at `744bb62`. No tests were run.

### 2.1 Configuration

- `crc-sync/config/efsp-facility-incirlik.json` `consolidation`: `{ CD: "GC", GC: "LC", LC: "AP", SFA: "AP",
  PAR: "AP" }`. RSU and OPS are on no chain.
- The other facilities have no tower: carrier `{ CV_APP2: CV_APP1, CV_APP1: CV_MARSHAL }`; tactical
  `{ AIC, GCI, JTAC: TAC_C2 }`; center `{}`.
- `crc-sync/src/efsp/facility-schema.js` (the `consolidation:` note) lists the deviations from guide §4.8.6 rule 2:
  no AP→CTR or TAC_C2→CTR (ADR 0013), no RSU→LC (ADR 0075), the carrier chain stops at CV_MARSHAL (ADR 0074),
  JTAC→TAC_C2 is ours (ADR 0080). It ends: "Whether GC should consolidate into LC at all is open (decisions H101,
  RP-F1)". GC→LC ships **as the guide has it**, with no ADR of ours behind it.
- `EFSPImplementationGuide.md` §4.8.6 rule 2 cites no FAA source for the order `CD→GC→LC→AP→CTR`. Rule 5 is "warn,
  do not block".
- `docs/efsp-usage-guide.md` §8F1 lists consolidation as partly ours, and its Facility table (near the top of the guide) gives
  Incirlik's chain. `docs/glossary.md` maps "covering chain" to **consolidation**, citing ¶2-2-3 and ¶2-6-5, and records RP-F1
  as open.

### 2.2 What "consolidation" does in the code

1. **When a Position is vacated.** `efsp-ws.js` signs the controller off. For every Position left without a Primary,
   `PositionStore#consolidatedAt` (`position-store.js`) follows the chain to the **first staffed** Position, and
   `BoardStore#reassignPositionStrips` (`board-store.js`) sets that Position as `ownerPositionId` of every
   non-DROPPED Strip. Each Strip is stamped with `consolidatedFrom`, put in the new owner's Bay for its state or
   else **its first Bay that implies no state**, and audited as `SystemReassign`, reason `position-vacated`.
   The ack warns `{ positionId, count, routedTo }`. When GC is staffed again, `returnConsolidatedStrips` gives the
   Strips back (F10, ADR 0080).
2. **When a Strip is sent to a Position that has nobody on it.** `board/ops/transfer-strip.js` routes the transfer to
   `consolidatedAt(toPositionId)`. The NLA gates in `authority/strip-types/departure.js` and `arrival.js` count a
   Position as present if it is staffed **or** consolidated at a staffed one.
3. **LC cannot work GC's Strips.** `DEPARTURE_STATE_OWNERS` gives PUSHBACK and TAXI to `['GC']`, and
   `ARRIVAL_STATE_OWNERS` gives TAXI_IN to `['GC']`. `StripOps#nlaPrecheck` (`board/strip-ops.js`) and
   `Placement#validateBayImpliedTransition` (`board/placement.js`) both refuse an action unless the owner is allowed
   to act on the Strip's current state: "`TAXI is not LC's to advance`". LC has no Bay implying PUSHBACK, TAXI or
   TAXI_IN, so the Strips land in **`lc-coordination`**. In practice:
   - GC signs off with three taxiing aircraft and LC alone is left: they go to `lc-coordination`, stay frozen at TAXI,
     and cannot be put in the runway queue.
   - CD presses "Hand Off" on a CLEARED Strip while GC is empty: the NLA succeeds (GC is "present" through LC), and
     the Strip reaches LC as PUSHBACK, which LC cannot advance.
   - LC presses the NLA on a LANDED arrival while GC is empty: the Strip goes to LC as TAXI_IN, and LC cannot even
     Drop it, because TAXI_IN→DROPPED is GC's.

   All three are cleared by **signing on to GC**: the controller then acts as GC, and `returnConsolidatedStrips`
   returns the Strips. The same parking happens on CD→GC (PENDING_CLEARANCE is CD's) and on LC→AP (RUNWAY_QUEUE, LUAW
   and FINAL are LC's), and the usage guide already says so for the carrier ("a Marshal… then holds Strips it cannot
   advance"). F10 (ADR 0080) recorded the problem and fixed only the hand-back.
4. **Frequencies.** The EFSP has **no notion of a Position's frequency**. The one exception is SFA's frequency pool
   (`singleFrequencyApproach`, `sfa-store.js`). Consolidation changes nothing about radios: the SRS radio bridge in
   crc-desktop is outside the EFSP.
5. **Combination** is a different mechanism, and it is the FAA's (guide §4.8.4, §4.8.5). One controller signed on
   to GC and LC holds both hats. Permissions are checked per acting Position, never on the union. The Bays stay
   **grouped by Position**, and every action the client offers names the Position it acts as. **No warning** is
   given for combining LC with any non-local Position today.

### 2.3 What the EFSP knows about LUAW

- `LUAW` is a typed DEPARTURE state (guide §3.9, owner `['LC']`). Its source is 7210.3EE ¶10-3-8a3(b)'s strip-marking
  aid. It counts as a runway-using state (`runway-status.js` `RUNWAY_GATED_STATES`), and the strip stays in
  `lc-runway-queue` because no Bay implies LUAW.
- **Every departure goes through LUAW.** `computeDepartureNla`: RUNWAY_QUEUE's only next state is LUAW, with no
  `alsoLegal`. LUAW's next state is DEPARTED. So in the EFSP's model the facility is *always* conducting LUAW, and
  there is no way to clear an aircraft for takeoff from the hold-short line.
- **Nothing ties LUAW to staffing.** `grep -rn LUAW` finds no use in `position-store.js`, `efsp-ws.js`, the
  consolidation code or the permission table. There is no facility flag for "LUAW operations in effect".

## 3. What our chain gets right, and what it gets wrong

**Right**
- GC→LC is a pairing the FAA permits when traffic is low (¶2-6-5a, b). A quiet single-controller tower does it.
- Consolidation stays inside the Facility, and the hand-back on re-staffing (F10) matches decombining.
- "Warn, do not block" matches how a CIC uses consolidation: it is a staffing decision, not a hard rule, except for
  LUAW.

**Wrong or missing**
1. **The FAA meaning and ours differ.** FAA: a person takes on GC's functions. EFSP: GC's Strips get a new owner that
   is not allowed to work them, which is parking. The word "consolidated at" in our UI promises the first and
   delivers the second.
2. **There is no LUAW gate.** ¶2-6-5c and ¶10-3-8a4 say LC is never combined with GC while LUAW operations are
   conducted, and our lifecycle conducts LUAW on every departure.
3. **There is no traffic condition.** ¶2-6-5b restricts GC/LC to "significantly reduced traffic". The EFSP neither
   shows nor asks for one.
4. **Frequencies are not shown.** A combined controller must monitor both frequencies (¶3-3-3). The EFSP cannot
   remind them, because it has no per-Position frequency.
5. **No warning on combination.** The real form (one controller signed on to GC and LC) gets no ¶2-6-5 warning at
   all.
6. **GC→LC is undocumented.** It is the only Incirlik link with neither an FAA source nor an ADR.

## 4. Options

**A. Leave as is.** GC→LC stays, and so do the parking semantics.
- Pro: no work, no D19 change, no behaviour change in the soak or the goldens.
- Con: the label claims the FAA concept but behaves as parking. A lone LC controller still has to sign on to GC to
  move a taxiing aircraft, and nothing tells them so (only the warning "routed to LC"). Nothing knows about LUAW.

**B. Remove GC→LC; LC takes ground by combining, with a warning.** The Incirlik chain becomes
`{ CD: GC, LC: AP, SFA: AP, PAR: AP }`, so GC ends its chain. When GC is vacated and owns Strips, the existing D19
path warns (`routedTo: null`). The LC Primary, if any, is **offered GC** ("Take GC? 3 Strips"), which signs them on
to GC as a combination: two hats, two Bay groups, the Strips still GC's. Signing on to LC plus a non-local tower
Position (GC or CD), from either side, shows a ¶2-6-5 warning, worded more strongly when any Strip is at LUAW or
RUNWAY_QUEUE (¶2-6-5c, ¶10-3-8a4). The warning does not block.
- Pro: matches the FAA meaning exactly: one person signed on and responsible for both (¶2-2-3). LC can then work
  every Strip, with no frozen Strips and no `lc-coordination` parking. Uses mechanisms that already exist (§4.8.4
  combination, the D19 warning, guide rule 5). Small: one config line, one prompt, one warning rule.
- Con: departs from guide §4.8.6 rule 2, so it needs an ADR and a §8F1 row. While GC is unstaffed and nobody takes
  it, CD's "Hand Off" on a CLEARED Strip and LC's NLA on a LANDED arrival are **inhibited** ("no receiving Position
  present") rather than parked. That is honest, but it is a visible change. A Position with Strips and nobody on it
  is left as a known D19 case, as AP and CTR already are.

**C. Keep GC→LC; add a LUAW warning or block.** The chain is unchanged. Consolidation into LC, and combining LC with
GC, warns, and is **blocked** while any DEPARTURE is in LUAW at the Facility (or while a new facility flag
`luawOperations` is true).
- Pro: adds the one hard FAA rule. The smallest change to the config.
- Con: keeps the parking (wrong item 1): LC still cannot work what lands on it. Because every departure passes LUAW,
  a block would refuse consolidation at the very moments a departure is on the runway. That fights rule 5's
  "blocking a controller from leaving is worse than the stranding", which applies here because the vacating GC is
  the one blocked. And the block keys on a proxy (a Strip in LUAW), not on the facility procedure the FAA means.

**D. Consolidation means "take the hat", for every link.** Redefine consolidation for every chain: a vacated
Position's Strips stay its own, and the Primary of the Position it is consolidated at is **auto-signed on** (or
offered) to it as a combination, with Bays grouped by Position as §4.8.5 requires. GC→LC keeps the B warnings. This
also fixes CD→GC, LC→AP and the carrier's CV_APP→CV_MARSHAL parking.
- Pro: one meaning everywhere, matching the FAA. Removes `reassignPositionStrips`, `consolidatedFrom` and the
  hand-back, and with them the whole frozen-Strip class.
- Con: the largest change. It touches every Facility, the D19 logic, the soak and the goldens. Auto sign-on also
  touches the §4.8.2 Primary rules (a Primary nobody chose) and the LC→AP case at a USAF field (is AP allowed to take
  LC at all?). It is a design lane of its own, not a doctrine fix.

## 5. Recommendation

**Option B now; record D as the follow-up question.** B makes the GC/LC case match the FAA meaning: one person is
signed on to both and can work both. It puts the ¶2-6-5 conditions where the human will see them, at sign-on, as a
warning. It reuses combination, which the guide already built to the FAA model. It warns rather than blocks, because
our lifecycle makes every departure a LUAW operation and a squadron evening is often one controller in the tower, so
a block would make the single-controller tower impossible. That trade-off belongs to the human (question 1). D is
the right end state if the human confirms that "consolidated" should always mean "take the hat", but it is too large
for a doctrine fix.

## 6. Open questions for the human

1. **Warn or block during LUAW?** The FAA forbids combining GC with LC while LUAW operations are conducted, without
   exception. Our lifecycle always uses LUAW. Do we (a) only warn, (b) block combining while a Strip is at LUAW, or
   (c) add a takeoff clearance straight from the runway queue (RUNWAY_QUEUE→DEPARTED) and make LUAW optional?
2. **Incirlik doctrine.** Does anyone in the squadron know the USAF rule (DAFMAN 13‑204v3) or Incirlik's local
   practice for combining ground and tower? We could not read the manual.
3. **Frequencies.** Should the facility config carry each tower Position's frequency (display only), so a combined
   controller's header reads "GC 275.8 + LC 251.0: monitor both"? The values would be squadron data to verify.
4. **The other links.** Do the CD→GC and LC→AP links get the same treatment later (option D), or stay as parking?
