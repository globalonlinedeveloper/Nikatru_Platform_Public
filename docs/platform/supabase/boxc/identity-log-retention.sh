#!/bin/sh
# docs/platform/supabase/boxc/identity-log-retention.sh -> Box C /opt/supabase/identity-log-retention.sh
#
# SYN-P2 (2026-10-02): the identity stack's request logs keep a connection's
# address for 7 days at most, then it is gone.
#
# What carries one, measured on Box C 2026-10-02 (counts only):
#   - supabase-auth (GoTrue): `remote_addr` on every request line (the forwarded
#     client address, 12697 public of 14101 matched), and `ip_address` on every
#     audit event it logs;
#   - supabase-envoy: the access log, an address on every line.
# Docker's json-file cap (daemon.json 5 x 50 MB) is a SIZE, and at ~1.4 MB a day
# it would keep months. This job makes it a TIME: once a day it moves each log
# into a root-only archive and empties the live file, and deletes any archive
# (and any docker size-rotation) older than RETAIN_DAYS. A line is therefore
# kept at most RETAIN_DAYS days: written up to one day before its cut, deleted
# six days after it.
#
# Why 7: the lost-request diagnoses of 2026-10-01 (a platform read at 08:51Z, an
# edge 520 at 15:00Z) were read from these logs within a day; a week covers a
# weekend. The tables themselves keep no address at all
# (../sql/identity-address-null-on-write.sql).
#
# Reading an older line: `docker logs supabase-auth` shows only since the last
# cut; earlier days are `zcat /var/log/nikatru-identity/supabase-auth-*.json.gz`.
#
# Installed in root's crontab (fields are IST, like every job on this box):
#   10 4 * * * /opt/supabase/identity-log-retention.sh >> /var/log/nikatru-identity/run.log 2>&1
# The live file is opened O_APPEND by dockerd, so truncating it is safe; lines
# written between the copy and the truncate (milliseconds) are lost.
set -eu
RETAIN_DAYS=7
ARCH=/var/log/nikatru-identity
umask 077
mkdir -p "$ARCH"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# Deleted when older than RETAIN_DAYS-1 days less an hour, so the daily run that
# falls at that age removes it rather than the one a day later.
maxmin=$(( (RETAIN_DAYS - 1) * 1440 - 60 ))

for c in supabase-auth supabase-envoy; do
  log=$(docker inspect -f '{{.LogPath}}' "$c" </dev/null)
  [ -n "$log" ] || { echo "FATAL: no log path for $c" >&2; exit 1; }
  if [ -s "$log" ]; then
    tmp="$ARCH/.$c-$stamp.json.gz.tmp"
    gzip -c "$log" > "$tmp"
    [ -s "$tmp" ] || { echo "FATAL: empty archive for $c" >&2; rm -f "$tmp"; exit 1; }
    mv "$tmp" "$ARCH/$c-$stamp.json.gz"
    truncate -s 0 "$log"
  fi
  find "$(dirname "$log")" -maxdepth 1 -name "$(basename "$log").*" -mmin +"$maxmin" -delete
done

find "$ARCH" -maxdepth 1 -name '*.json.gz' -mmin +"$maxmin" -delete
echo "ok identity-log-retention $stamp archives=$(find "$ARCH" -maxdepth 1 -name '*.json.gz' | wc -l)"
