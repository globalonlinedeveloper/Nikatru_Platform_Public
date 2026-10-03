// ─────────────────────────────────────────────────────────────────────────────
// ict-log-retention.test.mjs — the boxes' 180-day minimised ICT log job (lane
// dpdp-rights, the CERT-In addendum; docs/ops/boxes/ict-log-retention.sh).
//
// Runs the REAL script, with a fake `docker` on PATH and the archive directory in
// a temp dir, as identity-log-retention.test.mjs does for the 7-day job. The red
// control the brief names: a log older than 180 days survives -> the check FAILS.
//
// ⚠️ POSIX ONLY: the job runs under /bin/sh on the Linux boxes, so on a Windows
// host these cases are skipped by name rather than spawning a shell script there.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'docs', 'ops', 'boxes', 'ict-log-retention.sh');
const DAY_S = 86_400;
const SKIP = process.platform === 'win32' ? 'the box job is POSIX sh and runs on the Linux boxes' : false;

const LOG =
  '2026-10-03T04:00:00Z GET /auth/v1/token 200 remote_addr=49.37.12.201 user=asha@example.com sub=0f8fad5b-d9cb-469f-a165-70867728950e\n' +
  '2026-10-03T04:00:01Z GET /health 200 from 2401:4900:1c2a:5b1e::1\n';

function box({ containers = ['supabase-auth'], leak = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ictlog-'));
  const bin = join(root, 'bin');
  const arch = join(root, 'archive');
  mkdirSync(bin);
  mkdirSync(arch);
  const cases = containers.map((c) => `  ${c}) ;;`).join('\n');
  // `docker logs … <name>` prints LOG; `docker inspect <name>` exits 1 for an unknown one.
  // With `leak`, the fake prints an address the minimiser's patterns do not cover (a
  // zero-padded octet run is still IPv4 to the checker), which proves the CHECK reads
  // the archive rather than trusting the minimiser.
  const body = leak ? "printf 'addr 10.0.0.1x\\n' | sed 's/x$//'" : `cat <<'L'\n${LOG}L`;
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh\nfor last; do :; done\ncase "$last" in\n${cases}\n  *) echo "Error: No such container: $last" >&2; exit 1 ;;\nesac\nif [ "$1" = logs ]; then\n${body}\nfi\nexit 0\n`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return { root, bin, arch };
}

function run(b, args = ['supabase-auth'], env = {}) {
  const r = spawnSync('sh', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${b.bin}:${process.env.PATH}`, ICT_LOG_ARCH: b.arch, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const age = (path, days) => {
  const t = Date.now() / 1000 - days * DAY_S;
  utimesSync(path, t, t);
};

describe('ict-log-retention.sh — 180 days, minimised, and watched', { skip: SKIP }, () => {
  test('GREEN CONTROL: the day is archived with no address, no email and no account id; a 181-day archive is deleted; exit 0', () => {
    const b = box();
    const old = join(b.arch, 'supabase-auth-20260401T000000Z.log.gz');
    writeFileSync(old, 'old');
    age(old, 181);
    const { code, out } = run(b);
    assert.equal(code, 0, out);
    const kept = readdirSync(b.arch);
    assert.ok(!kept.includes('supabase-auth-20260401T000000Z.log.gz'), kept.join(' '));
    const today = kept.find((f) => /^supabase-auth-\d{8}T\d{6}Z\.log\.gz$/.test(f));
    assert.ok(today, kept.join(' '));
    const text = gunzipSync(readFileSync(join(b.arch, today))).toString('utf8');
    assert.match(text, /GET \/auth\/v1\/token 200/);
    assert.doesNotMatch(text, /49\.37\.12\.201|asha@example\.com|0f8fad5b|2401:4900/);
    assert.match(text, /remote_addr=\[ip\] user=\[email\] sub=\[id\]/);
    assert.match(out, /done: failed=0/);
  });

  test('a 179-day archive is KEPT: the period is 180 days, not less', () => {
    const b = box();
    const young = join(b.arch, 'supabase-auth-20260407T000000Z.log.gz');
    writeFileSync(young, 'young');
    age(young, 179);
    const { code, out } = run(b);
    assert.equal(code, 0, out);
    assert.ok(readdirSync(b.arch).includes('supabase-auth-20260407T000000Z.log.gz'));
  });

  test('🔴 a log older than 180 days that SURVIVES the prune FAILS the check (exit 1, no beat)', () => {
    const b = box();
    const old = join(b.arch, 'supabase-auth-20260301T000000Z.log.gz');
    writeFileSync(old, 'old');
    age(old, 200);
    // `find` without -delete stands in for a prune that stopped deleting.
    writeFileSync(join(b.bin, 'find'), `#!/bin/sh\nfor a; do [ "$a" = -delete ] && exit 0; done\nexec /usr/bin/find "$@"\n`);
    chmodSync(join(b.bin, 'find'), 0o755);
    const { code, out } = run(b);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL ict-log-retention \S+ 1 archive\(s\) older than 180 days remain/);
  });

  test('🔴 an address that survives minimisation FAILS', () => {
    const b = box({ leak: true });
    writeFileSync(join(b.bin, 'sed'), `#!/bin/sh\ncat\n`); // a minimiser that does nothing
    chmodSync(join(b.bin, 'sed'), 0o755);
    const { code, out } = run(b);
    assert.equal(code, 1, out);
    assert.match(out, /a network address survived minimisation/);
  });

  test('🔴 a container docker does not know FAILS, and the others still run', () => {
    const b = box({ containers: ['supabase-auth'] });
    const { code, out } = run(b, ['supabase-gone', 'supabase-auth']);
    assert.equal(code, 1, out);
    assert.match(out, /supabase-gone: docker does not know this container/);
    assert.match(out, /ok ict-log-retention \S+ supabase-auth: minimised/);
  });

  test('🔴 no container named at all FAILS rather than archiving nothing', () => {
    const { code, out } = run(box(), []);
    assert.equal(code, 1, out);
    assert.match(out, /no container named/);
  });
});
