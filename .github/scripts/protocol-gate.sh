#!/usr/bin/env bash
# The wire protocol deploy gate (crc-sync docs/adr/0103, errata in docs/wip/DEPLOY-GATE-2.md). Run from the repo root of a
# checkout with full history and tags (it reads crc-desktop's wire-protocol.js at the release tag with `git show`).
#
# It decides whether deploy.yml may RECREATE crc-sync, and WHICH image. It never fails the job: the SSH deploy, `git pull` and
# every other image always run. Outputs (to $GITHUB_OUTPUT, or stdout):
#   hold=true|false     image=<repo>@sha256:<digest>   (empty when it could not be resolved)    server_protocol=<n>
#
# The protocol is read from the image's `org.sourcedcs.wire-protocol` label (set by crc-sync-docker.yml), on the exact digest the
# deploy will then pull. `image` is that digest, so what is checked is what is deployed (no `:latest` race).
#
# Fails CLOSED (hold=true, with an ::error:: saying why) when:
#   - the image ref cannot be resolved to a digest, or the digest has no readable label
#   - the published release cannot be read (releases API unreachable, garbled or listing no version)
#   - the newest published version has no tag in git, or its wire-protocol.js exists but has no readable number
#   - the protocols differ
# Only SKIP_PROTOCOL_GATE=true (human only, workflow_dispatch input) lets crc-sync through regardless; it still needs the digest.
#
# "Published" = the NEWEST version the releases API lists across win and linux (sort -V). A half-published release (one leg
# uploaded) is therefore judged by the newer version, not held on the older one.
# A release tag without crc-desktop/app/public/js/wire-protocol.js is protocol 1 (before the handshake).
#
# Env: IMAGE_REPO (e.g. ghcr.io/niknam3/sourcedcs/crc-sync), IMAGE_REF (tag to resolve: sha-<short> or latest),
#      RELEASES_URL (default https://sourcedcs.page/api/releases/latest; file:// works for tests), SKIP_PROTOCOL_GATE,
#      IMAGETOOLS (default "docker buildx imagetools"; a test stub), GATE_LABEL (default org.sourcedcs.wire-protocol).
set -u

RELEASES_URL="${RELEASES_URL:-https://sourcedcs.page/api/releases/latest}"
IMAGETOOLS="${IMAGETOOLS:-docker buildx imagetools}"
LABEL="${GATE_LABEL:-org.sourcedcs.wire-protocol}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
DESK_FILE="crc-desktop/app/public/js/wire-protocol.js"
HOW_TO_SKIP="Rerun the Deploy workflow with skip_protocol_gate only if you accept that every old client sees 'Update required'."

image=""; server=""
finish() { # finish <hold>
  { echo "hold=$1"; echo "image=$image"; echo "server_protocol=$server"; } >> "$OUT"
  exit 0
}
fail() { echo "::error title=Protocol gate::$1 crc-sync is NOT recreated by this deploy; everything else is."; finish true; }

: "${IMAGE_REPO:?IMAGE_REPO is required}"
: "${IMAGE_REF:?IMAGE_REF is required}"

# 1. Pin the image: resolve the tag to a digest ONCE, then inspect and deploy that digest.
digest=$($IMAGETOOLS inspect "$IMAGE_REPO:$IMAGE_REF" --format '{{.Manifest.Digest}}' 2>/dev/null | head -1) || digest=""
case "$digest" in sha256:*) ;; *) fail "could not resolve $IMAGE_REPO:$IMAGE_REF to an image digest (was the image built and pushed?)." ;; esac
image="$IMAGE_REPO@$digest"

if [ "${SKIP_PROTOCOL_GATE:-}" = "true" ]; then
  echo "::warning title=Protocol gate skipped::skip_protocol_gate was set by the person who started this deploy. Deploying $image."
  finish false
fi

# 2. The protocol of the image about to be deployed.
imgjson=$($IMAGETOOLS inspect "$image" --format '{{json .Image}}' 2>/dev/null) || imgjson=""
server=$(printf '%s' "$imgjson" | jq -r --arg l "$LABEL" '
    (if has("config") then . else ([.[]? | select(type == "object" and has("config"))] | .[0]) end)
    | .config.Labels[$l] // empty' 2>/dev/null) || server=""
case "$server" in ''|*[!0-9]*) server=""; fail "the image $image has no readable $LABEL label (built before the label existed, or the registry could not be read)." ;; esac

# 3. The newest published release. Fail closed if it cannot be read.
json=$(curl --fail --silent --show-error --location --max-time 20 --retry 2 --retry-delay 3 "$RELEASES_URL" 2>/dev/null) || json=""
v=$(printf '%s' "$json" | jq -r '[.win.version, .linux.version] | map(select(type == "string" and length > 0)) | .[]' 2>/dev/null) || v=""
[ -n "$v" ] || fail "could not read the published crc-desktop release from $RELEASES_URL, so the wire protocol cannot be compared. $HOW_TO_SKIP"
newest=$(printf '%s\n' "$v" | sort -V | tail -1)
tag="crc-desktop-v$newest"

if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
  fail "the newest published CRC v$newest has no tag $tag in this repository. $HOW_TO_SKIP"
fi
if client=$(git show "$tag:$DESK_FILE" 2>/dev/null); then
  published=$(printf '%s' "$client" | sed -n 's/.*WIRE_PROTOCOL[[:space:]]*[:=][[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)
  [ -n "$published" ] || fail "$tag has $DESK_FILE but no WIRE_PROTOCOL number could be read from it."
else
  published=1
fi

if [ "$server" != "$published" ]; then
  fail "crc-sync ($image) speaks protocol $server, the newest published CRC v$newest speaks $published: publish a crc-desktop release first (tag crc-desktop-vX.Y.Z from main) or revert the wire change."
fi
echo "protocol gate: crc-sync ($image) and the newest published CRC v$newest both speak protocol $server."
finish false
