#!/bin/sh
# docs/ops/boxes/ict-log-retention.sh -> /opt/nikatru/ict-log-retention.sh on Box B and Box C
#
# ⏱ 2026-10-03 · lane dpdp-rights, CERT-In addendum (lead decision; ADR in Private).
# The CERT-In Directions of 28 April 2022 ask every service provider to keep the
# logs of its ICT systems for a rolling 180 days, within India. Our two boxes are
# in Mumbai. Their containers' own logs are short-lived on purpose (the identity
# request log keeps a network address 7 days and no longer:
# docs/platform/supabase/boxc/identity-log-retention.sh), so this job keeps a
# SEPARATE, MINIMISED copy for 180 days:
#   - once a day, the last 24 h of each named container's log;
#   - minimised BEFORE it is written: every IPv4 and IPv6 address, every e-mail
#     address and every UUID (an account id) becomes [ip] / [email] / [id]. The
#     privacy notice says no network address is kept with any record about a
#     person; this copy keeps none at all, so it is not personal data;
#   - gzipped into a root-only archive, and anything older than RETAIN_DAYS
#     deleted.
# The end state is CHECKED, as the identity job checks its own: an archive older
# than RETAIN_DAYS still present, no archive of a container inside 36 h, or an
# address that survived minimisation in today's archive is a FAIL; any FAIL exits
# 1, so the heartbeat wrapper withholds the beat and the monitor goes Down
# (tooling/ops/register.json duty.ict-log-retention-boxb / -boxc).
#
# Installed in root's crontab (IST, like every job on these boxes), through the
# box's heartbeat wrapper, with the containers that box runs:
#   Box C:  20 4 * * * /opt/supabase/hb-run.sh ict-log-retention /opt/nikatru/ict-log-retention.sh supabase-auth supabase-envoy supabase-db >> /var/log/nikatru-ict/run.log 2>&1
#   Box B:  20 4 * * * /opt/glitchtip/hb-run.sh ict-log-retention /opt/nikatru/ict-log-retention.sh glitchtip-web glitchtip-worker ntfy >> /var/log/nikatru-ict/run.log 2>&1
# (the container names are the lead's to confirm on each box; a name docker cannot
# find is a FAIL, never a silent skip).
set -u
RETAIN_DAYS=180
# The archive directory; overridable for tooling/ci/test/ict-log-retention.test.mjs only.
ARCH=${ICT_LOG_ARCH:-/var/log/nikatru-ict}
FRESH_MIN=$(( 36 * 60 ))
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
failed=0
fail() { echo "FAIL ict-log-retention $stamp $*"; failed=1; }
[ "$#" -gt 0 ] || { echo "FAIL ict-log-retention $stamp: no container named (pass the box's containers as arguments)"; exit 1; }
mkdir -p "$ARCH" || { echo "FAIL ict-log-retention $stamp: cannot create $ARCH"; exit 1; }

# The minimiser. One sed program, applied before anything touches the disk.
minimise() {
  sed -E \
    -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[id]/g' \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[email]/g' \
    -e 's/([0-9]{1,3}\.){3}[0-9]{1,3}/[ip]/g' \
    -e 's/([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}/[ip]/g'
}

for c in "$@"; do
  tmp="$ARCH/.$c-$stamp.log.gz.tmp"
  if docker logs --timestamps --since 24h "$c" </dev/null 2>&1 | minimise | gzip -c > "$tmp" && [ -s "$tmp" ] \
     && mv "$tmp" "$ARCH/$c-$stamp.log.gz"; then
    :
  else
    rm -f "$tmp"
    fail "$c: no minimised archive written (container missing, or no log)"
    continue
  fi
  if ! docker inspect "$c" >/dev/null 2>&1 </dev/null; then
    fail "$c: docker does not know this container (renamed?); its archive is not evidence"
  fi
  # 🔴 THE MINIMISATION IS CHECKED, NOT ASSUMED: an IPv4 address in today's archive is a FAIL.
  if gzip -dc "$ARCH/$c-$stamp.log.gz" | grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}'; then
    fail "$c: a network address survived minimisation"
  fi
  if [ -n "$(find "$ARCH" -maxdepth 1 -name "$c-*.log.gz" -mmin -"$FRESH_MIN" | head -n 1)" ]; then
    echo "ok ict-log-retention $stamp $c: minimised, newest archive inside 36 h"
  else
    fail "$c: no archive inside the last 36 h"
  fi
done

find "$ARCH" -maxdepth 1 -name '*.log.gz' -mmin +"$(( RETAIN_DAYS * 1440 - 60 ))" -delete || fail "archive prune did not run"
stale=$(find "$ARCH" -maxdepth 1 -name '*.log.gz' -mmin +"$(( RETAIN_DAYS * 1440 ))" | wc -l)
[ "$stale" -eq 0 ] || fail "$stale archive(s) older than $RETAIN_DAYS days remain"
echo "ict-log-retention $stamp done: failed=$failed archives=$(find "$ARCH" -maxdepth 1 -name '*.log.gz' | wc -l) stale=$stale"
exit "$failed"
