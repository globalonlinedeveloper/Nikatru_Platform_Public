#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# post-config-manifest.sh — RUNS ON A BOX (Box B, Box C), from cron. Hashes the
# box's LIVE compose, override and tunnel config and POSTs the hashes to the
# platform Worker, so drift from the vendored copies is READ, not guessed.
#
# PB-27 (O-JWKS-FALLBACK-LIVES-TEN-MINUTES folds O-BOX-CONFIG-OUTSIDE-THE-LANE).
# The box pushes; CI never SSHes in. The chain:
#   this script → POST /v1/ops/box-manifest (services/platform/src/routes/box-manifest.ts)
#   → platform_db.box_config_manifest (migrations/0024_box_config_manifest.sql)
#   → tooling/ops/check-box-config-drift.mjs in ops-watch, against
#     tooling/ops/box-config-vendored.json.
#
# ── WHAT IT SENDS, AND WHAT IT NEVER SENDS ───────────────────────────────────
# One sha256 per file, under a LOGICAL name ("compose", "override", "tunnel").
# Never a file's content, never a path, never the secret on a command line
# (curl reads the Authorization header from a file, so it is not in `ps`).
# It writes NOTHING on the box: the box config stays applied by hand.
#
# ── CONFIG: two root-only files, installed by the lead (box operations) ─────
#   /etc/nikatru/box-manifest.conf      shell assignments:
#       BOX=boxc                                    # boxb | boxc
#       ENDPOINT=https://platform.nikatru.com/v1/ops/box-manifest
#       SECRET_FILE=/etc/nikatru/box-manifest.secret  # mode 0600, the box's secret only
#   /etc/nikatru/box-manifest.files     one `<logical name> <absolute path>` per line;
#                                       `#` comments and blank lines are skipped.
#   Override either with BOX_MANIFEST_CONF / BOX_MANIFEST_FILES (the tests do).
#
# ── INSTALL (cron.d, once a day, offset from the backup window) ──────────────
#   install -m 0755 post-config-manifest.sh /usr/local/sbin/nikatru-post-config-manifest
#   echo '17 5 * * * root /usr/local/sbin/nikatru-post-config-manifest >>/var/log/nikatru-box-manifest.log 2>&1' \
#     > /etc/cron.d/nikatru-box-manifest
#   Read back the first post: run it by hand once and look for `HTTP 204`.
#
# Exit: 0 posted (HTTP 204); 1 the Worker refused the post; 2 could not build or
# send a manifest (a listed file missing, no config, no secret, no network).
# A LISTED FILE THAT IS MISSING IS NOT SKIPPED: exit 2 with its logical name,
# because a manifest without it would read on the Worker as "the box stopped
# having that file" — which the reader then reports as drift, the right answer
# for a box, the wrong one for a typo here.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

CONF="${BOX_MANIFEST_CONF:-/etc/nikatru/box-manifest.conf}"
LIST="${BOX_MANIFEST_FILES:-/etc/nikatru/box-manifest.files}"

fail() { echo "box-manifest: $*" >&2; exit 2; }

[ -r "$CONF" ] || fail "no config at $CONF"
# shellcheck disable=SC1090
. "$CONF"
[ -n "${BOX:-}" ] || fail "BOX is not set in $CONF"
[ -n "${ENDPOINT:-}" ] || fail "ENDPOINT is not set in $CONF"
[ -n "${SECRET_FILE:-}" ] && [ -r "$SECRET_FILE" ] || fail "SECRET_FILE is not set or not readable"
[ -r "$LIST" ] || fail "no file list at $LIST"
case "$BOX" in boxb|boxc) ;; *) fail "BOX must be boxb or boxc, got '$BOX'" ;; esac

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

files=""
count=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  name=$(printf '%s\n' "$line" | awk '{print $1}')
  path=$(printf '%s\n' "$line" | awk '{print $2}')
  printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9._-]{0,63}$' || fail "bad logical name '$name' in $LIST"
  [ -n "$path" ] || fail "no path for '$name' in $LIST"
  [ -f "$path" ] || fail "listed file '$name' is missing on this box"
  sum=$(hash_of "$path")
  files="${files}${files:+,}\"${name}\":\"${sum}\""
  count=$((count + 1))
done < "$LIST"
[ "$count" -gt 0 ] || fail "$LIST lists no file"

body="{\"box\":\"${BOX}\",\"files\":{${files}}}"

# The header goes through a 0600 temp file, so the secret is never an argument.
umask 077
hdr=$(mktemp)
trap 'rm -f "$hdr"' EXIT
printf 'Authorization: Bearer %s\n' "$(cat "$SECRET_FILE")" > "$hdr"

status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
  -X POST -H "@$hdr" -H 'Content-Type: application/json' \
  --data "$body" "$ENDPOINT") || fail "the POST did not complete"

echo "box-manifest: box=$BOX files=$count HTTP $status"
[ "$status" = "204" ] || exit 1
