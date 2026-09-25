// ─────────────────────────────────────────────────────────────────────────────
// live-signin-key.test.mjs — the sign-in script the live site serves carries a
// publishable key the auth host accepts, the key is never printed, and "I could
// not look" is never a pass.
//
// tooling/ops/check-live-signin-key.mjs reads <apex>/js/signin.js, takes its
// SUPABASE_URL and its one sb_publishable_ key, and asks
// <SUPABASE_URL>/auth/v1/settings with the key in `apikey`. Every case below runs
// the real CLI with --fixtures, so every answer is a file in a temp directory.
// 🔴 THE KEYS ARE MADE UP (`sb_publishable_TESTONLY…`), built from parts so no
// key-shaped literal sits in this file, and the auth host is `.invalid`
// (RFC 2606), a name that never resolves.
//
//   K1  GREEN CONTROL — key served, host 200: exit 0, sha8 printed, key absent
//   K2  the host answers 401: RED, exit 1, key absent
//   K3  the host answers 403: RED, exit 1
//   K4  the host holds a ROTATED key (the gateway model refuses the served one):
//       RED, exit 1 — the failure this check exists for
//   K5  the placeholder is served: RED, exit 1, and the host is never asked
//   K6  a script with no sb_publishable_ key: RED, exit 1
//   K7  a body with no SUPABASE_URL (a page served in the script's place): RED
//   K8  two different keys in one script: RED, both named by sha8 only
//   K9  the script is 404: RED — the live site does not serve it
//   K10 the host answers 503 through every retry: exit 2, retries said aloud
//   K11 the script hangs past the per-request ceiling: exit 2
//   K12 the wire drops on every attempt: exit 2
//   K13 the host answers 200 with something that is not GoTrue settings: exit 2
//   K14 the script answers 403 (an edge challenge): exit 2, never judged
//   U1  the served path is DERIVED from the file in the tree, which exists
//   U2  the tree's own signin.js parses: an https auth host, and either the
//       placeholder or exactly one key
//   U3  judgeSettings, pure: 200 + settings 0, 401 1, 404 2, 200 + HTML 2
//   W1  ops-watch runs it in a job a duty row ALREADY claims (DERIVED)
//   W2  the step: `if: ${{ !cancelled() }}`, its own `timeout-minutes`, no `env:`
//
// Red controls, run by hand and restored:
//   R1 the step deleted from ops-watch.yml            → W1, W2 RED
//   R2 the step's `if:` deleted                       → ops-watch-readers.test.mjs
//      (the OLD guard, checkReaderIndependence) RED, naming the step; W2 RED
//   R3 `signal` dropped from the reader's live fetch   → ops-bounded-retry.test.mjs
//      B8 per-request-ceiling limb RED, naming the line
//
// ⚠️ NO CASE HERE TOUCHES THE NETWORK.
//
// Run:  node --test tooling/ci/test/live-signin-key.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APEX_ORIGIN } from '../../sites/apex.mjs';
import {
  PLACEHOLDER,
  SIGNIN_FILE,
  SITE_DIR,
  extractAuthUrl,
  judgeServedScript,
  judgeSettings,
  servedScriptUrl,
  sha8,
} from '../../ops/check-live-signin-key.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'check-live-signin-key.mjs');
const CALL = 'node tooling/ops/check-live-signin-key.mjs';

// Made up, 46 characters like the real class, and never typed whole.
const FAKE_KEY = ['sb', 'publishable', `TESTONLY${'0'.repeat(23)}`].join('_');
const ROTATED_KEY = ['sb', 'publishable', `TESTONLY${'1'.repeat(23)}`].join('_');
const AUTH = 'https://auth.fixture.invalid';
const SETTINGS = `${AUTH}/auth/v1/settings`;
const SETTINGS_OK = JSON.stringify({ external: { email: true, apple: false }, disable_signup: false });

const scriptWith = (key) =>
  [
    `export const SUPABASE_URL = '${AUTH}';`,
    `export const SUPABASE_PUBLISHABLE_KEY = '${key}';`,
    'const AUTH = `${SUPABASE_URL}/auth/v1`;',
  ].join('\n');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'live-signin-key-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** The real CLI, answered from a fixture table. */
function run(table, env = {}) {
  seq += 1;
  const file = join(TMP, `fixtures-${seq}.json`);
  writeFileSync(file, JSON.stringify(table));
  const r = spawnSync(process.execPath, [SCRIPT, '--fixtures', file], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}

/** The key, and its distinctive half, appear nowhere in what the run printed. */
function assertKeyAbsent(all, key) {
  assert.equal(all.includes(key), false, 'the key value was printed');
  assert.equal(all.includes(key.slice('sb_publishable_'.length)), false, 'the key body was printed');
}

describe('check-live-signin-key — the process, answered from fixtures', () => {
  test('K1 GREEN CONTROL: key served, host 200 — exit 0, sha8 printed, the key is not', () => {
    const r = run({
      [servedScriptUrl()]: { status: 200, body: scriptWith(FAKE_KEY) },
      [SETTINGS]: { status: 200, body: SETTINGS_OK, apikeySha8: sha8(FAKE_KEY) },
    });
    assert.equal(r.code, 0, r.all);
    assert.ok(r.out.includes(`sha8=${sha8(FAKE_KEY)}`), r.all);
    assert.match(r.out, /status 200/);
    assert.match(r.err, /OFFLINE FIXTURE MODE/);
    assertKeyAbsent(r.all, FAKE_KEY);
  });

  test('K2 the host answers 401 — RED, exit 1, the key is not printed', () => {
    const r = run({
      [servedScriptUrl()]: { status: 200, body: scriptWith(FAKE_KEY) },
      [SETTINGS]: { status: 401, body: '{"message":"Invalid API key"}' },
    });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /the live site's publishable key is refused by the auth host/);
    assert.ok(r.err.includes(`sha8=${sha8(FAKE_KEY)}`), r.all);
    assertKeyAbsent(r.all, FAKE_KEY);
  });

  test('K3 the host answers 403 — RED, exit 1', () => {
    const r = run({
      [servedScriptUrl()]: { status: 200, body: scriptWith(FAKE_KEY) },
      [SETTINGS]: { status: 403, body: '' },
    });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /refused by the auth host .*HTTP 403/);
    assertKeyAbsent(r.all, FAKE_KEY);
  });

  test('K4 the host holds a ROTATED key — the served one is refused, RED, exit 1', () => {
    const r = run({
      [servedScriptUrl()]: { status: 200, body: scriptWith(FAKE_KEY) },
      [SETTINGS]: { status: 200, body: SETTINGS_OK, apikeySha8: sha8(ROTATED_KEY) },
    });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /refused by the auth host .*HTTP 401/);
    assertKeyAbsent(r.all, FAKE_KEY);
    assertKeyAbsent(r.all, ROTATED_KEY);
  });

  test('K5 the placeholder is served — RED, exit 1, and the host is never asked', () => {
    // No row for SETTINGS: a request to it would be COULD NOT LOOK (exit 2), so
    // exit 1 also proves nothing was sent.
    const r = run({ [servedScriptUrl()]: { status: 200, body: scriptWith(PLACEHOLDER) } });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /still holds __SUPABASE_PUBLISHABLE_KEY__: the deploy did not fill/);
    assert.doesNotMatch(r.all, /auth\/v1\/settings/);
  });

  test('K6 a script with no sb_publishable_ key — RED, exit 1', () => {
    const r = run({ [servedScriptUrl()]: { status: 200, body: scriptWith('') } });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /carries no sb_publishable_ key: the deploy did not fill it/);
  });

  test('K7 a page served in the script\'s place (no SUPABASE_URL) — RED, exit 1', () => {
    const r = run({ [servedScriptUrl()]: { status: 200, body: '<!doctype html><title>nikatru</title>' } });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /names no https SUPABASE_URL/);
  });

  test('K8 two different keys in one script — RED, both named by sha8 only', () => {
    const body = `${scriptWith(FAKE_KEY)}\n// old: '${ROTATED_KEY}'`;
    const r = run({ [servedScriptUrl()]: { status: 200, body } });
    assert.equal(r.code, 1, r.all);
    assert.ok(r.err.includes(sha8(FAKE_KEY)) && r.err.includes(sha8(ROTATED_KEY)), r.all);
    assertKeyAbsent(r.all, FAKE_KEY);
    assertKeyAbsent(r.all, ROTATED_KEY);
  });

  test('K9 the script is 404 — RED, the live site does not serve it', () => {
    const r = run({ [servedScriptUrl()]: { status: 404, body: 'not found' } });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /answers 404/);
  });

  test('K10 the host answers 503 through every retry — exit 2, the retries are said aloud', { timeout: 30_000 }, () => {
    const r = run({
      [servedScriptUrl()]: { status: 200, body: scriptWith(FAKE_KEY) },
      [SETTINGS]: { status: 503, body: '' },
    });
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /COULD NOT LOOK: .*HTTP 503/);
    assert.equal((r.err.match(/↻ attempt/g) ?? []).length, 2, r.all);
    assertKeyAbsent(r.all, FAKE_KEY);
  });

  test('K11 the script hangs past the per-request ceiling — exit 2', { timeout: 30_000 }, () => {
    const r = run({ [servedScriptUrl()]: { fail: 'hang' } }, { OPS_REQUEST_TIMEOUT_MS: '200' });
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /COULD NOT LOOK: no answer within 0\.2s \(the per-request ceiling, attempt 3\)/);
  });

  test('K12 the wire drops on every attempt — exit 2', { timeout: 30_000 }, () => {
    const r = run({
      [servedScriptUrl()]: { status: 200, body: scriptWith(FAKE_KEY) },
      [SETTINGS]: { fail: 'reset' },
    });
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /COULD NOT LOOK: .*fetch failed/);
    assertKeyAbsent(r.all, FAKE_KEY);
  });

  test('K13 the host answers 200 with something that is not GoTrue settings — exit 2', () => {
    const r = run({
      [servedScriptUrl()]: { status: 200, body: scriptWith(FAKE_KEY) },
      [SETTINGS]: { status: 200, body: '<html>maintenance</html>' },
    });
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /not GoTrue settings/);
  });

  test('K14 the script answers 403 (an edge challenge) — exit 2, never judged', () => {
    const r = run({ [servedScriptUrl()]: { status: 403, body: '' } });
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /COULD NOT LOOK: .*HTTP 403/);
  });
});

describe('check-live-signin-key — the pure parts, against the tree', () => {
  test('U1 the served path is derived from the file in the tree, which exists', () => {
    assert.ok(existsSync(join(REPO, SIGNIN_FILE)), `${SIGNIN_FILE} is gone; the probe would read a path nothing deploys`);
    assert.ok(SIGNIN_FILE.startsWith(`${SITE_DIR}/`));
    assert.equal(servedScriptUrl(), new URL(SIGNIN_FILE.slice(SITE_DIR.length + 1), APEX_ORIGIN).href);
    assert.equal(new URL(servedScriptUrl()).origin, new URL(APEX_ORIGIN).origin);
  });

  test('U2 the tree\'s own signin.js parses: an https auth host, and the placeholder or exactly one key', () => {
    const body = readFileSync(join(REPO, SIGNIN_FILE), 'utf8');
    const host = extractAuthUrl(body);
    assert.ok(host && host.startsWith('https://'), 'signin.js no longer declares SUPABASE_URL in the shape the probe reads');
    const v = judgeServedScript(body);
    assert.ok(v.verdict === 'placeholder' || v.verdict === 'ok', `the tree's signin.js reads as '${v.verdict}'`);
    if (v.verdict === 'ok') assert.equal(v.authUrl, host);
  });

  test('U3 judgeSettings: 200 + settings is 0, 401 is 1, 404 is 2, 200 + HTML is 2', () => {
    assert.equal(judgeSettings(200, SETTINGS_OK).code, 0);
    assert.equal(judgeSettings(401, '').code, 1);
    assert.equal(judgeSettings(404, '').code, 2);
    assert.equal(judgeSettings(200, '<html></html>').code, 2);
    assert.equal(judgeSettings(200, '{"ok":true}').code, 2);
  });
});

describe('check-live-signin-key — where ops-watch runs it', () => {
  test('W1 ops-watch runs it in a job that a duty row ALREADY claims', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    assert.ok(wf.includes(CALL), 'ops-watch must run the check, or nothing watches the live sign-in key');
    // WHICH job runs it is derived from the workflow: the nearest `  <id>:` above.
    const lines = wf.split('\n');
    const at = lines.findIndex((l) => l.includes(CALL));
    let job = null;
    for (let i = at; i >= 0; i -= 1) {
      const m = lines[i].match(/^ {2}([a-z][a-z0-9-]*):$/);
      if (m) {
        job = m[1];
        break;
      }
    }
    assert.ok(job, 'could not derive which job runs the check');
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'ops', 'register.json'), 'utf8'));
    const rows = register.rows ?? [];
    assert.ok(rows.length > 0, 'the register must have rows, or this check is vacuous');
    const claiming = rows.filter((r) => (r.mechanism?.recordQuery?.unit?.jobs ?? []).includes(job)).map((r) => r.id);
    assert.ok(claiming.length > 0, `the \`${job}\` job is the unit of no duty row, so a red key would be watched by nobody`);
  });

  test('W2 the step runs after a red sibling, bounds itself, and takes no secret', () => {
    const lines = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8').split('\n');
    const at = lines.findIndex((l) => l.includes(CALL));
    assert.ok(at > 0, 'the step is gone');
    let start = at;
    while (start > 0 && !/^ {6}- name: /.test(lines[start])) start -= 1;
    const step = lines.slice(start, at + 1).join('\n');
    assert.match(step, /^ {8}if: \$\{\{ !cancelled\(\) \}\}$/m, 'a red step before it must not skip it');
    const t = step.match(/^ {8}timeout-minutes: (\d+)$/m);
    assert.ok(t && Number(t[1]) <= 3, 'its own ceiling, so a hung host cannot spend the job');
    assert.doesNotMatch(step, /^ {8}env:/m, 'it needs no secret; an unset one must never be the reason it is red');
  });
});
