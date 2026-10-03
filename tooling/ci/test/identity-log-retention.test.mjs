// ─────────────────────────────────────────────────────────────────────────────
// identity-log-retention.test.mjs — the Box C job the privacy notice's "request
// logs are kept 7 days" rests on (docs/platform/supabase/boxc/
// identity-log-retention.sh).
//
// ⏱ 2026-10-02 · review 1 of #1140, finding 4. Under `set -eu`, ONE container
// that `docker inspect` could not find ended the run before any pruning, the
// archive prune included, and exited 1 into a log nobody read. The job now
// prunes each container on its own, always prunes the archive, prints one line
// per step, and exits non-zero on any failure so the heartbeat wrapper
// (hb-run.sh) withholds the beat. These cases run the REAL script, with a fake
// `docker` on PATH and the archive directory in a temp dir.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'docs', 'platform', 'supabase', 'boxc', 'identity-log-retention.sh');
const DAY_S = 86_400;

/** A box: a docker log dir with one live log per container, an archive dir, and a fake `docker`. */
function box({ containers = ['supabase-auth', 'supabase-envoy'], sweep = 'echo 1' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'idlog-'));
  const bin = join(root, 'bin');
  const logs = join(root, 'containers');
  const arch = join(root, 'archive');
  mkdirSync(bin);
  mkdirSync(logs);
  mkdirSync(arch);
  const known = {};
  for (const c of containers) {
    const log = join(logs, `${c}-json.log`);
    writeFileSync(log, `{"log":"a request line from ${c}"}\n`);
    known[c] = log;
  }
  // `docker inspect -f '{{.LogPath}}' <name>`: the path, or exit 1 like the real CLI.
  // `docker exec supabase-db psql … mfa_challenge_ip_sweep()`: `sweep`, a shell line.
  const cases = Object.entries(known).map(([c, p]) => `  ${c}) echo '${p}' ;;`).join('\n');
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh\nif [ "$1" = exec ]; then\n  case "$*" in *'nikatru_privacy.mfa_challenge_ip_sweep()'*) ${sweep} ;; *) echo "unexpected: $*" >&2; exit 1 ;; esac\n  exit $?\nfi\nname="$4"\ncase "$name" in\n${cases}\n  *) echo "Error: No such object: $name" >&2; exit 1 ;;\nesac\n`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return { root, bin, logs, arch, known };
}

function age(path, days) {
  const t = Date.now() / 1000 - days * DAY_S;
  utimesSync(path, t, t);
}

function run(b) {
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${b.bin}:${process.env.PATH}`, IDENTITY_LOG_ARCH: b.arch },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('identity-log-retention.sh — 7 days, and watched', () => {
  test('GREEN CONTROL: both logs cut into the archive, emptied, and an 8-day archive deleted; exit 0', () => {
    const b = box();
    try {
      const old = join(b.arch, 'supabase-auth-20260920T000000Z.json.gz');
      writeFileSync(old, 'old');
      age(old, 8);
      const { code, out } = run(b);
      assert.equal(code, 0, out);
      const kept = readdirSync(b.arch);
      assert.ok(!kept.includes('supabase-auth-20260920T000000Z.json.gz'), out);
      assert.equal(kept.filter((f) => /^supabase-(auth|envoy)-\d{8}T\d{6}Z\.json\.gz$/.test(f)).length, 2, kept.join(' '));
      for (const log of Object.values(b.known)) assert.equal(statSync(log).size, 0);
      assert.match(out, /ok identity-log-retention \S+ supabase-auth: cut/);
      assert.match(out, /ok identity-log-retention \S+ mfa challenge address sweep: 1 blanked/);
      assert.match(out, /done: failed=0/);
    } finally { rmSync(b.root, { recursive: true, force: true }); }
  });

  test('🔴 a container docker cannot find is a FAIL (exit 1), and the OTHER container and the archive prune still run', () => {
    // The shape of the defect: under `set -e` the first `docker inspect` that
    // failed ended the run, so the 8-day archive below survived past 7 days.
    const b = box({ containers: ['supabase-auth'] });
    try {
      const old = join(b.arch, 'supabase-envoy-20260920T000000Z.json.gz');
      writeFileSync(old, 'old');
      age(old, 8);
      const { code, out } = run(b);
      assert.equal(code, 1, out);
      assert.match(out, /FAIL identity-log-retention \S+ supabase-envoy: no log path/);
      assert.match(out, /ok identity-log-retention \S+ supabase-auth: cut/);
      assert.ok(!readdirSync(b.arch).includes('supabase-envoy-20260920T000000Z.json.gz'), 'the archive prune must run whatever failed before it');
      assert.equal(statSync(b.known['supabase-auth']).size, 0);
    } finally { rmSync(b.root, { recursive: true, force: true }); }
  });

  test('🔴 no archive of a container inside 36 h (nothing was cut) is a FAIL, never a quiet pass', () => {
    const b = box();
    try {
      writeFileSync(b.known['supabase-envoy'], '');
      const stale = join(b.arch, 'supabase-envoy-20260929T000000Z.json.gz');
      writeFileSync(stale, 'x');
      age(stale, 2);
      const { code, out } = run(b);
      assert.equal(code, 1, out);
      assert.match(out, /FAIL identity-log-retention \S+ supabase-envoy: no archive inside the last 36 h/);
    } finally { rmSync(b.root, { recursive: true, force: true }); }
  });

  // ⏱ 2026-10-02 · ruling on review 2 of #1140, item 1: the expired MFA
  // challenge's address is blanked by THIS job; a sweep that did not run must
  // withhold the beat, or the notice's "erased within a day" rests on nothing.
  test('🔴 the MFA challenge address sweep failing (psql error) is a FAIL (exit 1), and the log cut still runs', () => {
    const b = box({ sweep: 'echo \'ERROR:  function nikatru_privacy.mfa_challenge_ip_sweep() does not exist\' >&2; exit 3' });
    try {
      const { code, out } = run(b);
      assert.equal(code, 1, out);
      assert.match(out, /FAIL identity-log-retention \S+ mfa challenge address sweep did not run: exit 3: ERROR: {2}function/);
      assert.match(out, /ok identity-log-retention \S+ supabase-auth: cut/);
    } finally { rmSync(b.root, { recursive: true, force: true }); }
  });

  test('🔴 a sweep that answers with no row count (the db container missing) is a FAIL, never a quiet pass', () => {
    const b = box({ sweep: 'true' });
    try {
      const { code, out } = run(b);
      assert.equal(code, 1, out);
      assert.match(out, /FAIL identity-log-retention \S+ mfa challenge address sweep did not run/);
    } finally { rmSync(b.root, { recursive: true, force: true }); }
  });

  test('the script still says RETAIN_DAYS=7, the number the notices publish (policy-claims.json)', () => {
    assert.match(readFileSync(SCRIPT, 'utf8'), /^RETAIN_DAYS=7$/m);
  });
});
