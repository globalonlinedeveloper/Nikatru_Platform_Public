// ─────────────────────────────────────────────────────────────────────────────
// free-api-scope-transient.test.mjs — a network blip is not a verdict.
//
// ops-watch run 34602047972 (2026-09-11T13:02Z) failed "The store service
// account is still powerless on GCP" with `iam — list service accounts — could
// not be reached (fetch failed)`, exit 1, while the token minted and the other
// three reads answered 403 in the same second. The re-run passed. These cases
// pin the contract of tooling/ops/verify-free-api-scope.mjs:
//   · a thrown request, a 5xx or a 429 is retried;
//   · a read still unreachable after its retries is exit 2 ("could not look");
//   · a success or an unexpected 4xx is still exit 1, and is never retried;
//   · a finding beats an unreachable read.
//
// ⚠️ NOTHING HERE TOUCHES GOOGLE. `fetch` is replaced by a preload that answers
// from a scenario; the service-account key is generated per run and never
// leaves the temp directory. The environment is built from scratch, so the local
// vault key file is never read.
//
// Run:  node --test tooling/ci/test/free-api-scope-transient.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'verify-free-api-scope.mjs');
const EXPECT = 'nikatru-free-api@nikatru-platform.iam.gserviceaccount.com';

const TMP = mkdtempSync(join(tmpdir(), 'free-api-scope-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY = JSON.stringify({ type: 'service_account', client_email: EXPECT, private_key: privateKey, project_id: 'nikatru-platform' });

// Each scenario key is a URL substring; its value is the answer per call, the last
// one repeating: 'throw' (a network error), 'token' (a minted token), or a status.
const PRELOAD = join(TMP, 'fake-google.mjs');
writeFileSync(
  PRELOAD,
  [
    "const scenario = JSON.parse(process.env.FAKE_GCP_SCENARIO || '{}');",
    'const counts = {};',
    'globalThis.fetch = async (url) => {',
    '  const u = String(url);',
    "  const key = Object.keys(scenario).find((k) => u.includes(k)) ?? (u.includes('oauth2') ? 'oauth2' : 'default');",
    "  const seq = scenario[key] ?? (key === 'oauth2' ? ['token'] : [403]);",
    '  const n = (counts[key] = (counts[key] ?? 0) + 1);',
    '  const step = seq[Math.min(n - 1, seq.length - 1)];',
    '  process.stdout.write(`FAKE ${key} call ${n} -> ${step}\\n`);',
    "  if (step === 'throw') throw new TypeError('fetch failed');",
    "  if (step === 'token') return new Response(JSON.stringify({ access_token: 'fake-token' }), { status: 200 });",
    "  return new Response('{}', { status: step });",
    '};',
    '',
  ].join('\n'),
);

function run(scenario) {
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, SCRIPT], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PLAY_SERVICE_ACCOUNT_JSON: KEY,
      FAKE_GCP_SCENARIO: JSON.stringify(scenario),
      VERIFY_FREE_API_SCOPE_RETRY_MS: '1',
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const calls = (out, key) => (out.match(new RegExp(`FAKE ${key} call `, 'g')) ?? []).length;

describe('verify-free-api-scope — a network blip is not a verdict', () => {
  test('CONTROL: every read denied is exit 0, one call each', () => {
    const { code, out } = run({});
    assert.equal(code, 0, out);
    assert.match(out, /every one of 4 project-level reads is denied/);
    assert.equal(calls(out, 'default'), 4, out);
  });

  test('a read that throws once and then answers 403 is retried and passes (run 34602047972)', () => {
    const { code, out } = run({ 'iam.googleapis': ['throw', 403] });
    assert.equal(code, 0, out);
    assert.match(out, /ok {3}denied: iam — list service accounts/);
    assert.equal(calls(out, 'iam.googleapis'), 2, out);
  });

  test('a read that throws on every attempt is exit 2, "could not look", never a finding', () => {
    const { code, out } = run({ 'iam.googleapis': ['throw'] });
    assert.equal(code, 2, out);
    // ⏱ 2026-09-21 — TIGHTENED, NOT LOOSENED. The shared helper
    // (tooling/ops/bounded-retry.mjs) now appends WHY an exhausted plan is still
    // COULD NOT LOOK, so the line carries the cause AND the sentence that stops the
    // next hand turning it into a pass. Both are asserted.
    assert.match(out, /⬜ iam — list service accounts — could not be reached after 3 attempt\(s\) \(fetch failed — and the same on all 3 attempt\(s\)/);
    assert.match(out, /is an OUTAGE, not a blip, so this is COULD NOT LOOK and not a pass/);
    assert.doesNotMatch(out, /✗ /);
    assert.equal(calls(out, 'iam.googleapis'), 3, out);
  });

  test('a read that answers 503 on every attempt is exit 2', () => {
    const { code, out } = run({ 'iam.googleapis': [503] });
    assert.equal(code, 2, out);
    assert.match(out, /could not be reached after 3 attempt\(s\) \(HTTP 503 — and the same on all 3 attempt\(s\)/);
  });

  test('a 429 then 403 is retried and passes', () => {
    const { code, out } = run({ serviceusage: [429, 403] });
    assert.equal(code, 0, out);
    assert.equal(calls(out, 'serviceusage'), 2, out);
  });

  test('a token mint that throws once is retried and the check still runs', () => {
    const { code, out } = run({ oauth2: ['throw', 'token'] });
    assert.equal(code, 0, out);
    assert.equal(calls(out, 'oauth2'), 2, out);
  });

  test('a read that SUCCEEDS is exit 1 even while another read is unreachable — the finding wins', () => {
    const { code, out } = run({ cloudbilling: [200], 'iam.googleapis': ['throw'] });
    assert.equal(code, 1, out);
    assert.match(out, /✗ 🔓 cloudbilling — read billing info SUCCEEDED/);
    assert.match(out, /⬜ iam — list service accounts — could not be reached/);
  });

  test('an unexpected 404 is exit 1 and is NOT retried (an answer, not a blip)', () => {
    const { code, out } = run({ serviceusage: [404] });
    assert.equal(code, 1, out);
    assert.match(out, /serviceusage — list enabled APIs returned HTTP 404/);
    assert.equal(calls(out, 'serviceusage'), 1, out);
  });
});
