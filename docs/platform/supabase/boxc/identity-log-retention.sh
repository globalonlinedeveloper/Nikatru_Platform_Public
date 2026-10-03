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
# Installed in root's crontab (fields are IST, like every job on this box),
# through the heartbeat wrapper every other Box C duty runs under, which POSTs
# GlitchTip heartbeat monitor `Supabase identity log retention` ONLY when this
# script exits 0 (tooling/ops/register.json, duty.supabase-identity-log-retention):
#   10 4 * * * /opt/supabase/hb-run.sh identity-log-retention /opt/supabase/identity-log-retention.sh >> /var/log/nikatru-identity/run.log 2>&1
# The live file is opened O_APPEND by dockerd, so truncating it is safe; lines
# written between the copy and the truncate (milliseconds) are lost.
#
# ⏱ 2026-10-02 · review 1 of #1140, finding 4 — the published 7 days rests on
# this job, so it is WATCHED, and one fault no longer stops the rest:
#   - each container is cut and pruned on its own; a container `docker inspect`
#     cannot find (renamed or recreated by a compose change) is reported and
#     skipped, and the others and the archive prune still run;
#   - every step prints one `ok` or `FAIL` line, and any FAIL exits 1, so the
#     wrapper withholds the beat and the monitor goes Down;
#   - the end state is CHECKED, not assumed: an archive older than RETAIN_DAYS
#     still present, or no archive for a container in the last 36 h, is a FAIL.
#
# ⏱ 2026-10-02 · ruling on review 2 of #1140, item 1 — MFA stays on, so the MFA
# challenge address is kept while a challenge is pending (GoTrue compares it on
# verify) and blanked once it is verified (a trigger) or past GoTrue's 300 s
# expiry: THIS job runs that sweep, nikatru_privacy.mfa_challenge_ip_sweep()
# (../sql/identity-address-null-on-write.sql), once a day. A sweep that does not
# answer with a row count is a FAIL like any other step.
set -u
RETAIN_DAYS=7
# The archive directory; overridable for tooling/ci/test/identity-log-retention.test.mjs only.
ARCH=${IDENTITY_LOG_ARCH:-/var/log/nikatru-identity}
# 36 h: one missed daily run is a FAIL the next morning, not two days later.
FRESH_MIN=$(( 36 * 60 ))
umask 077
mkdir -p "$ARCH" || { echo "FAIL identity-log-retention: cannot create $ARCH"; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# Deleted when older than RETAIN_DAYS-1 days less an hour, so the daily run that
# falls at that age removes it rather than the one a day later.
maxmin=$(( (RETAIN_DAYS - 1) * 1440 - 60 ))
failed=0
fail() { echo "FAIL identity-log-retention $stamp $*"; failed=1; }

for c in supabase-auth supabase-envoy; do
  log=$(docker inspect -f '{{.LogPath}}' "$c" </dev/null 2>/dev/null) || log=''
  if [ -z "$log" ]; then
    fail "$c: no log path (container missing or renamed); its log is NOT cut"
    continue
  fi
  if [ -s "$log" ]; then
    tmp="$ARCH/.$c-$stamp.json.gz.tmp"
    if gzip -c "$log" > "$tmp" && [ -s "$tmp" ] && mv "$tmp" "$ARCH/$c-$stamp.json.gz"; then
      truncate -s 0 "$log" || fail "$c: archived but the live log was not emptied"
    else
      rm -f "$tmp"
      fail "$c: archive not written; the live log is kept"
    fi
  fi
  find "$(dirname "$log")" -maxdepth 1 -name "$(basename "$log").*" -mmin +"$maxmin" -delete \
    || fail "$c: docker size-rotations not pruned"
  # Fresh: an archive of this container inside the last 36 h. Both containers
  # log on every request and every health check, so a day with nothing to cut
  # does not happen; no fresh archive means the cut has not been happening.
  if [ -n "$(find "$ARCH" -maxdepth 1 -name "$c-*.json.gz" -mmin -"$FRESH_MIN" | head -n 1)" ]; then
    echo "ok identity-log-retention $stamp $c: cut, newest archive inside 36 h"
  else
    fail "$c: no archive inside the last 36 h"
  fi
done

swept=$(docker exec supabase-db psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -tAc \
  'SELECT nikatru_privacy.mfa_challenge_ip_sweep()' </dev/null 2>&1) || swept="exit $?: $swept"
case "$swept" in
  ''|*[!0-9]*) fail "mfa challenge address sweep did not run: $(printf '%s' "$swept" | head -c 200)" ;;
  *) echo "ok identity-log-retention $stamp mfa challenge address sweep: $swept blanked" ;;
esac

find "$ARCH" -maxdepth 1 -name '*.json.gz' -mmin +"$maxmin" -delete || fail "archive prune did not run"
stale=$(find "$ARCH" -maxdepth 1 -name '*.json.gz' -mmin +"$(( RETAIN_DAYS * 1440 ))" | wc -l)
[ "$stale" -eq 0 ] || fail "$stale archive(s) older than $RETAIN_DAYS days remain"
echo "identity-log-retention $stamp done: failed=$failed archives=$(find "$ARCH" -maxdepth 1 -name '*.json.gz' | wc -l) stale=$stale"
exit "$failed"
