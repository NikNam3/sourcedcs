#!/bin/sh
# Reload nginx every 12 hours so renewed certbot certificates are picked up.
# This replaces the `(while :; do sleep 12h; nginx -s reload; done) &` that used to sit in the
# compose `command:` string (that string moved to nginx/templates/default.conf.template).
# The nginx image runs every executable script in /docker-entrypoint.d/ before it starts nginx.
( while :; do sleep 12h; nginx -s reload; done ) &
exit 0
