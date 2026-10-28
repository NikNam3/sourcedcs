# 0057 — the Strip panel uses CRC's type scale, and a Strip arriving in a Bay is announced

## Context

Two things a controller reported after Layout C (`0056`):

- **The panel's text was bigger than the rest of CRC.** `#efsp-panel` set a font family and no size, so the Position tabs, Bay tabs, the New Strip toolbar and every control styled `font: inherit` fell through to the browser's 16px default. Popovers and the ⋯ menu are portalled to `<body>` (F-001), which sets Courier New and no size, so they rendered at 16px in a different face as well. The Strips added 12–13px on top. Every other CRC panel uses 9–11px, with the track panel's base at 11px.
- **It was hard to tell that a Strip had landed in a Bay.** Nothing counted the Strips in a Bay, and nothing marked a Strip handed over by another controller, least of all in a Bay the controller was not looking at.

Three options were mocked (reference artifact, "EFSP text size & arrivals"). The controller chose B, revised to: no arrivals line for arrivals in the Bay on screen, no "NEW" label (the amber edge and "from" line are enough), and a flash that plays once, never replayed when something else re-renders the Bay.

## Decision

### One type scale

`#efsp-panel` gets `font-size: 11px`. The scale is four steps plus the callsign:

| Step | Used for |
|---|---|
| 9px | field labels |
| 10px | indicators, the tab header, Rack headers, tab counts, the "from" line |
| 11px | the panel base: tabs, toolbar, buttons, banners, reasons, popovers, the ⋯ menu |
| 12px | field values, the ⋯ menu items |
| 13px bold | the callsign |

The popovers and the menu get the panel's font family and 11px explicitly, because they are not under `#efsp-panel`. Toolbar and tab controls centre their text (`inline-flex`, `align-items: center`); the + New Strip button's text sat at the top of its 32px box. Control heights are unchanged: 44px on the Strip, 28–32px on the tabs.

### Counts and arrivals

- **Counts.** Every Bay tab shows how many live Strips are in it, and every held Position tab shows its total. Tabs carry `data-bay-id` / `data-position-id`, because a count inside the tab would break anything that matched the tab by its text.
- **What an arrival is** (`efsp-arrivals.js`). An arrival is either of two things, in a Bay owned by a Position this controller holds:
  - a Strip that **moves into it from a different Bay**, whoever moved it. That covers another controller handing it over, and also this controller's own NLA or drag, including between two Bays of the same Position. The first version skipped the controller's own moves; the controller testing it held every Position and saw nothing at all. Working several Positions at once is exactly when a Strip goes somewhere you are not looking.
  - a Strip that is **new to this client and made by somebody else** (`strip.updatedBy`, the server's controllerId): a coordination or TOFI replica, or another controller's new Strip. The client knows its own controllerId from the Position records it holds (`primary.controllerId`).

  Not an arrival: a Strip the controller just created, a reorder within a Bay, or any change that leaves a Strip where it was. The "from" line names the previous Position, or the previous Bay for a move within one Position.

  Arrivals are noted from **both** the board delta and the controller's own Mutation ack. The controller's own move can reach the client in its ack before the delta, and by then the Strip is already in its new Bay; whichever of the two comes second sees no Bay change and adds nothing.
- **Out of view.** The arrival's Bay tab turns amber with `+N`, the Position tab gets an amber dot, and a line under the Bay tabs lists the newest three: callsign, destination Bay, and who it came from. Clicking a line opens that Bay and selects the Strip. Opening the Bay, by the line or by its tab, clears the `+N`, the dot and its lines.
- **In view.** Nothing is listed. The Strip flashes once and keeps an amber edge and a "from GND" line in its tab.
- **The flash plays exactly once.** It plays on the first build of the Strip where the controller can see it (`consumeEfspArrivalFlash`), which also starts a 30 s clock. Any later build, for any reason, shows the steady edge. The render signature carries only whether a Strip *is* marked, never whether its flash has played, so marking the flash as played cannot itself trigger a rebuild that replays it.
- **Clearing.** The mark goes when the controller touches the Strip (pointer or key, cleared in place so a starting drag is not rebuilt out from under the pointer) or 30 s after they first saw it. A Strip that leaves the Bay or is dropped stops being new.

## Consequences

- An arrival while the panel is docked behind another tab is not "seen": the Bay stays `+N` and the Strip flashes when the panel is next shown.
- A snapshot (connect or reconnect) never produces arrivals; only board deltas do.
- The e2e specs select tabs by `data-bay-id` / `data-position-id`. `e2e/l5-arrivals.spec.js` covers the arrival rules with two controllers, including the flash not replaying.
