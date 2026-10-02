#!/usr/bin/env bash
# The wire protocol deploy gate (crc-sync docs/adr/0103). Compares the WIRE_PROTOCOL this checkout's crc-sync speaks with the one
# the PUBLISHED crc-desktop release speaks. Run from the repo root of a checkout with full history and tags.
#
# It never fails the job: it decides whether deploy.yml may RECREATE crc-sync (S-VERSION1). The SSH deploy, `git pull` and every
# other image always run. Output, to $GITHUB_OUTPUT (or stdout): hold=true|false.
#   - protocols equal                          -> hold=false
#   - protocols differ                         -> hold=true, with an ::error:: naming both numbers and the way out
#   - a published version with no tag in git   -> hold=true (the release and the repo disagree; fail closed)
#   - the releases API is unreachable/garbled  -> hold=false with a ::warning:: (the gate must not deadlock the deploy)
#   - SKIP_PROTOCOL_GATE=true (human only)     -> hold=false
# A release tag without crc-desktop/app/public/js/wire-protocol.js is protocol 1 (before the handshake).
#
# Env: RELEASES_URL (default https://sourcedcs.page/api/releases/latest; file:// works for tests), SKIP_PROTOCOL_GATE.
set -u

RELEASES_URL="${RELEASES_URL:-https://sourcedcs.page/api/releases/latest}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
DESK_FILE="crc-desktop/app/public/js/wire-protocol.js"

emit() { echo "hold=$1" >> "$OUT"; }

if [ "${SKIP_PROTOCOL_GATE:-}" = "true" ]; then
  echo "::warning title=Protocol gate skipped::skip_protocol_gate was set by the person who started this deploy."
  emit false; exit 0
fi

server=$(sed -n 's/.*WIRE_PROTOCOL:[[:space:]]*\([0-9][0-9]*\).*/\1/p' crc-sync/src/wire-protocol.js | head -1)
if [ -z "$server" ]; then
  echo "::error title=Protocol gate::could not read WIRE_PROTOCOL from crc-sync/src/wire-protocol.js"
  emit true; exit 0
fi

json=$(curl --fail --silent --show-error --location --max-time 20 --retry 2 --retry-delay 3 "$RELEASES_URL" 2>/dev/null) || json=""
versions=$(printf '%s' "$json" | jq -r '[.win.version, .linux.version] | map(select(. != null)) | unique | .[]' 2>/dev/null) || versions=""
if [ -z "$versions" ]; then
  echo "::warning title=Protocol gate skipped::could not read the published crc-desktop release from $RELEASES_URL. crc-sync is deployed ungated."
  emit false; exit 0
fi

hold=false
for v in $versions; do
  tag="crc-desktop-v$v"
  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "::error title=Protocol gate::the published CRC v$v has no tag $tag in this repository. crc-sync is not recreated; rerun with skip_protocol_gate if this is intended."
    hold=true; continue
  fi
  if client=$(git show "$tag:$DESK_FILE" 2>/dev/null); then
    published=$(printf '%s' "$client" | sed -n 's/.*WIRE_PROTOCOL[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)
    published="${published:-1}"
  else
    published=1
  fi
  if [ "$server" != "$published" ]; then
    echo "::error title=Protocol gate::crc-sync speaks protocol $server, the published CRC v$v speaks $published: publish a crc-desktop release first (tag crc-desktop-vX.Y.Z from main) or revert the wire change. crc-sync is NOT recreated by this deploy; everything else is."
    hold=true
  else
    echo "protocol gate: crc-sync and the published CRC v$v both speak protocol $server."
  fi
done
emit "$hold"
