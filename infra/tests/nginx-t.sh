#!/usr/bin/env bash
# Renders infra/nginx/templates with dummy env (the nginx image's own envsubst step) and runs
# `nginx -t` in the official image, with throwaway self-signed certs at the paths the template
# names. Upstreams are `set $upstream` variables, so no DNS is needed. Needs docker + openssl.
# Run from anywhere: infra/tests/nginx-t.sh   (CI: .github/workflows/infra-nginx-check.yml)
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${NGINX_IMAGE:-nginx:alpine}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
domains=(wiki.example.org auth.example.org example.org ato.example.org crc.example.org)
for d in "${domains[@]}"; do
  mkdir -p "$tmp/live/$d"
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$d" \
    -keyout "$tmp/live/$d/privkey.pem" -out "$tmp/live/$d/fullchain.pem" 2>/dev/null
done
chmod -R a+rX "$tmp"
docker run --rm \
  -e WIKI_DOMAIN=wiki.example.org -e AUTH_DOMAIN=auth.example.org -e DOMAIN=example.org \
  -e ATOBRIEF_DOMAIN=ato.example.org -e CRCSYNC_DOMAIN=crc.example.org \
  -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
  -v "$PWD/nginx/snippets:/etc/nginx/snippets:ro" \
  -v "$tmp:/etc/letsencrypt:ro" \
  "$IMAGE" sh -c '/docker-entrypoint.d/20-envsubst-on-templates.sh >/dev/null && nginx -t'
