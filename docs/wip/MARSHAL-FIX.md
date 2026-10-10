# MARSHAL-FIX (S-ARCH-38): the first press of a step button on a just-arrived Strip did nothing

## Cause

`crc-desktop/app/public/js/panels/efsp/strip-view.js` (the arrival block in `_buildStripLayout`, ADR 0057) cleared a
just-arrived Strip at **pointerdown**: it removed `.efsp-strip-from` ("from cv-marshal-coordination", two lines at
the 163px tab, 28px + the 6px tab gap) in place. Everything below it in the tab moved up 34px during the press, so
in `control-release.spec.js:141` the pointer went down on "Comms to CV_MARSHAL" (y 428-472) and came up on "Control to
CV_MARSHAL", which had moved under it. Down and up on different buttons is no click: the browser clicks their common
ancestor `.efsp-x-buttons`, which sends nothing and selects the Strip, and that selection is the rebuild the
supervisor's MutationObserver saw (it came after the press, not during it). Instrumented event order on the failing run:
`pointerdown transfer-comms`, `pointerup transfer-control`, `click efsp-x-buttons`, then `replaceWith` from
`_reconcileRackStrips`. A second, latent half: clearing the arrival at pointerdown also flipped `arr:` in the render
signature, so any render during a held press would have rebuilt the Strip under the button.

Why it showed up with MARSHAL-BOARD: on the pre-merge client the geometry is the same (the "from" line is also 28px,
the buttons are also stacked) apart from the removed slot board, which put the Strip 86px lower, and there the
pointerup stayed on Comms. I did not establish exactly why the 34px shift did not reach Control there. The likely
reason is the Bay's scroll position being clamped, but the defect itself is older than MARSHAL-BOARD: a press on any
button below the "from" line of an arrived Strip.

## Fix

The pointer press is noticed when it **ends**: pointerdown (capture) arms a one-shot document pointerup/pointercancel
listener that clears the arrival. Clearing after pointerup cannot change the click target, and the arrival record (so
the signature) stays put while the button is held. The keyboard path (keydown) is unchanged.

## Test

`crc-desktop/tests/efsp-ui-reachability.test.mjs`: "pressing a button on a just-arrived Strip moves nothing until the
press ends, so the press is a click (MARSHAL-FIX)". With the button held, the "from" line is still there and
`_stripElNeedsRebuild` is false. After the release the arrival is cleared and the release listener is gone. It fails on
the old code. The existing arrival test now releases the press before asserting it is noticed.

## Defaults taken

- Noticing on press end rather than on `click`, so a drag that starts on the Strip body still counts as noticing it.

## Guide/briefing

Nothing changes for the controller except that the amber "from" line now goes when the press ends instead of when it
starts.
