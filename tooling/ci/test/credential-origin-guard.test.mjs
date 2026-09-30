// ─────────────────────────────────────────────────────────────────────────────
// credential-origin-guard.test.mjs — tooling/ci/assert-credential-origin.mjs.
//
// ⏱ 2026-10-01 (review 2 of the CodeQL stack, finding 1). The red controls are
// the REAL files with one pin reverted, in memory: a fixture written by the same
// hand as the rule would encode the rule's blind spots. The green control is the
// guard spawned on this tree.
//
// Run:  node --test tooling/ci/test/credential-origin-guard.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { envNames, inSubject, judge, parseExempt, rawUse, scanSource, SENTINELS } from '../assert-credential-origin.mjs';
import { CREDENTIAL_ENV } from '../../ops/credential-origin.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-credential-origin.mjs');
const code = (rel) => stripSourceComments(readFileSync(join(REPO, rel), 'utf8'), '.mjs');
/** The real file with [from] replaced by [to]; fails loudly if [from] is gone, so a
 *  red control can never pass because its mutation silently applied to nothing. */
const mutated = (rel, from, to) => {
  const text = code(rel);
  assert.ok(text.includes(from), `${rel} no longer contains the line this red control reverts: ${from}`);
  return text.replace(from, to);
};

describe('assert-credential-origin — the tree', () => {
  test('GREEN CONTROL: the guard is clean on this tree, and says how much it read', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /ok {2}assert-credential-origin — \d+ file\(s\) read, \d+ read a credential/);
  });

  test('the names come from the helper: every credential and base in CREDENTIAL_ENV, nothing else', () => {
    const { credentials, bases } = envNames();
    assert.deepEqual(credentials, [...CREDENTIAL_ENV.supabase.credentials, ...CREDENTIAL_ENV.glitchtip.credentials]);
    assert.ok(credentials.includes('SUPABASE_SERVICE_ROLE_KEY') && credentials.includes('SENTRY_AUTH_TOKEN'));
    assert.ok(bases.includes('SUPABASE_URL') && bases.includes('GLITCHTIP_DSN'));
  });

  test('every sentinel is a real, in-scope, clean file', () => {
    for (const s of SENTINELS) {
      const r = scanSource(code(s));
      assert.ok(r.reads.length > 0, `${s} reads no credential by the guard's patterns`);
      assert.deepEqual(r.findings, [], s);
    }
  });

  test('the subject: tooling and extensions scripts, never tests, fixtures or the brick', () => {
    assert.equal(inSubject('tooling/e2e/purge.mjs'), true);
    assert.equal(inSubject('extensions/scripts/store-poll.mjs'), true);
    assert.equal(inSubject('tooling/ci/test/x.test.mjs'), false);
    assert.equal(inSubject('tooling/ci/test/fixtures/a/b.js'), false);
    assert.equal(inSubject('tooling/bricks/app/__brick__/x.mjs'), false);
    assert.equal(inSubject('services/platform/src/index.ts'), false);
  });
});

describe('assert-credential-origin — red controls on the real files', () => {
  test('🔴 delete_headless.mjs with its one pin reverted to the raw SUPABASE_URL: limbs P and R', () => {
    const r = scanSource(mutated(
      'tooling/e2e/delete_headless.mjs',
      "supaUrl = credentialOrigin(need('SUPABASE_URL'), 'supabase');",
      "supaUrl = need('SUPABASE_URL').replace(/\\/+$/, '');",
    ));
    assert.deepEqual(r.findings.map((f) => f.limb).sort(), ['P', 'R']);
    assert.match(r.findings.find((f) => f.limb === 'R').what, /reads SUPABASE_URL into `supaUrl`, and `supaUrl` never passes through credentialOrigin\(\)/);
  });

  test('🔴 upload-web-sourcemaps.mjs building a request from the RAW base while the pin stays: limb R', () => {
    const r = scanSource(mutated('tooling/ops/upload-web-sourcemaps.mjs', 'target = new URL(path, origin);', 'target = new URL(path, base);'));
    assert.deepEqual(r.findings.map((f) => f.limb), ['R']);
    assert.match(r.findings[0].what, /`base` holds the RAW SENTRY_URL .* used as the base of a URL/);
  });

  test('🔴 upload-native-symbols.mjs handing the DSN host to the CLI unpinned: limbs P and R', () => {
    const r = scanSource(mutated(
      'tooling/ops/upload-native-symbols.mjs',
      "server = credentialOrigin(`${dsn.startsWith('http://') ? 'http' : 'https'}://${m[1]}`, 'glitchtip');",
      "server = `${dsn.startsWith('http://') ? 'http' : 'https'}://${m[1]}`;",
    ));
    assert.deepEqual(r.findings.map((f) => f.limb).sort(), ['P', 'R']);
  });

  test('🔴 create-glitchtip-release.mjs creating the release on the configured value: limb R', () => {
    const r = scanSource(mutated('tooling/ops/create-glitchtip-release.mjs', 'const r = await createRelease({ server, token,', 'const r = await createRelease({ server: configured, token,'));
    assert.deepEqual(r.findings.map((f) => f.limb), ['R']);
    assert.match(r.findings[0].what, /`configured` holds the RAW SENTRY_URL .* handed on as an object value/);
  });
});

describe('assert-credential-origin — the rules, on small inputs', () => {
  test('a credential NAMED in a message or a list is not a read; no read, no scope', () => {
    const r = scanSource("const names = ['SUPABASE_SERVICE_ROLE_KEY'];\nconsole.error('set SUPABASE_SERVICE_ROLE_KEY');\nawait fetch(`${process.env.SUPABASE_URL}/x`);\n");
    assert.deepEqual(r.reads, []);
    assert.deepEqual(r.findings, []);
  });

  test('a read that never sends is judged by limb R only', () => {
    const r = scanSource("const k = process.env.GLITCHTIP_TOKEN;\nconst u = process.env.GLITCHTIP_URL;\nconsole.log(`${u}`);\n");
    assert.deepEqual(r.findings.map((f) => f.limb), ['R']);
  });

  test('a pin on the same line as the read is clean; a raw use of the RESULT is not the base', () => {
    const r = scanSource("const k = need('SUPABASE_SERVICE_ROLE_KEY');\nconst o = credentialOrigin(need('SUPABASE_URL'), 'supabase');\nawait fetch(`${o}/auth/v1/x`, { headers: { apikey: k } });\n");
    assert.deepEqual(r.findings, []);
  });

  test('rawUse: each shape a request is built from, and a use inside the pin itself is not raw', () => {
    assert.equal(rawUse('x = `${b}/api`;', 'b').what, 'interpolated into a string');
    assert.equal(rawUse('x = b + "/api";', 'b').what, 'concatenated');
    assert.equal(rawUse('fetch(b);', 'b').what, 'passed to a fetch');
    assert.equal(rawUse('env: { SENTRY_URL: b },', 'b').what, 'handed on as an object value');
    assert.equal(rawUse("o = credentialOrigin(`${b}`, 'glitchtip');", 'b'), null);
    assert.equal(rawUse('if (!/^https?:/.test(b)) die();', 'b'), null);
  });

  test('exemptions: a row suppresses its (path, limb); a row that suppresses nothing is STALE', () => {
    const files = [{ path: 'tooling/a.mjs', code: "const k = process.env.GLITCHTIP_TOKEN;\nawait fetch('https://x');\n" }];
    const live = judge(files, [{ path: 'tooling/a.mjs', limb: 'P', reason: 'x'.repeat(20) }]);
    assert.deepEqual([live.findings.length, live.stale.length], [0, 0]);
    const stale = judge(files, [{ path: 'tooling/a.mjs', limb: 'P', reason: 'r' }, { path: 'tooling/a.mjs', limb: 'R', reason: 'r' }]);
    assert.deepEqual(stale.stale.map((s) => s.limb), ['R']);
    assert.deepEqual(judge(files, []).findings.map((f) => f.limb), ['P']);
  });

  test('parseExempt refuses a row without a real reason, and the checked-in file parses', () => {
    assert.match(parseExempt('{"exempt":[{"path":"a","limb":"P","reason":"short"}]}'), /row 0/);
    assert.match(parseExempt('{"exempt":[{"path":"a","limb":"X","reason":"a reason of twenty characters"}]}'), /row 0/);
    assert.match(parseExempt('nope'), /does not parse/);
    assert.ok(Array.isArray(parseExempt(readFileSync(join(REPO, 'tooling', 'ci', 'credential-origin-exempt.json'), 'utf8'))));
  });
});
