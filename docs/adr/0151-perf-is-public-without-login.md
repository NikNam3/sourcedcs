# 0151: perf is public, without login

**Status.** Accepted (TOLD step 0 design review, 2026-10-28; the access decision itself is of 27 Oct 2026). Spec:
`docs/wip/TOLD.md`, "Deployment and operations".

## Context

atobrief, sourcedcs-web and crc-sync sign users in through Casdoor. perf is a static app: all calculation runs in the
browser, the server only serves files, and step 1 has no database and no API. The manual's cover carries a distribution
restriction; the app ships data extracted from it and shows its pages in the figure view.

## Decision

1. **perf is public, with no login.** It is served on the perf. subdomain, one path per aircraft (`/f16/`, later
   `/fa18/`), behind the existing nginx reverse proxy.
2. The human decided this on 27 Oct 2026 knowing the distribution restriction.

## Consequences

- No Casdoor client, no tokens and no secrets in perf. The image is nginx serving `web/` and `data/`.
- The inputs live in the URL hash (`#v=1&…`), so a computed TOLD can be shared and the inputs never reach a server's
  access log. The last inputs are kept in localStorage as a convenience only.
- Saved loadouts or other shared state come no earlier than step 3. If they are needed then, a small service is added,
  with a login only for what writes data.
- A later change of the access decision is a new ADR.
