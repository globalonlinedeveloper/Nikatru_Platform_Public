// ─────────────────────────────────────────────────────────────────────────────
// password-reset-revokes.test.mjs — tooling/ops/verify-password-reset-revokes.mjs
// must be able to FAIL, and must tell a FINDING apart from an UNKNOWN.
//
// The probe answers the closing condition of O-AUTH-PASSWORD-RESET-HARDENING
// ("a test proving a reset revokes other refresh tokens") against the live auth
// backend. Its three exit codes are what an operator reads, and they mean three
// different things:
//   0  the reset revoked the other session's refresh token
//   1  IT DID NOT — a pre-existing session still refreshes after a reset
//   2  UNKNOWN: no credential, or a leg could not be measured. NOT a pass.
//
// 🔴 EXIT 2 IS THE ONE WORTH TESTING HARDEST, because it is the one a careless
// reader rounds to zero. The probe's whole shape rests on a NEGATIVE CONTROL —
// the same refresh token is exercised once BEFORE the reset (must succeed) and
// once AFTER (must be rejected). Without the control, a typo'd token, a wrong
// endpoint or a session that never existed produces the same rejection as a
// working revocation, and the run reports a pass over a probe that never
// worked. V3 below is that case: the control fails, and the answer must be 2.
//
// ⚠️ NO NETWORK. `fetch` is replaced by a routed stub through `--import`, so the
// live GoTrue is never touched and no user is ever created. The live proof is
// separate and was taken by hand on 2026-09-16 — a fixture cannot establish
// that the real server revokes anything, and this file does not claim to.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const PROBE = join(REPO, 'tooling', 'ops', 'verify-password-reset-revokes.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-reset-probe-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

/** A repo root carrying only a vault, so the probe's credential reader has
 *  something to find — or, with `vault: null`, deliberately nothing. */
const makeRoot = ({ vault } = {}) => {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, '.claude'), { recursive: true });
  if (vault !== null) {
    writeFileSync(
      join(root, '.claude', 'secrets.env'),
      vault ?? [
        'SUPABASE_URL=https://auth.example.invalid',
        'SUPABASE_PUBLISHABLE_KEY=anon-placeholder-for-tests',
        'SUPABASE_Secret_key=service-placeholder-for-tests',
        '',
      ].join('\n'),
    );
  }
  return root;
};

/**
 * A stub GoTrue, routed by URL. `plan` overrides any leg:
 *   controlRefresh · afterRefresh · createStatus · deleteStatus · sameToken
 * Everything not overridden behaves like a healthy server in which the reset
 * DOES revoke — so each case varies exactly one thing.
 */
const stubSource = (plan = {}) => `
let signIns = 0;
let refreshes = 0;
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/admin/users/')) return new Response('', { status: ${plan.deleteStatus ?? 200} });
  if (u.includes('/admin/users')) return J(${plan.createStatus ?? 200}, { id: 'user-1' });
  if (u.includes('grant_type=password')) {
    signIns++;
    const t = ${plan.sameToken ? "'same-token'" : "'refresh-' + signIns"};
    return J(200, { access_token: 'at-' + signIns, refresh_token: t });
  }
  if (u.includes('grant_type=refresh_token')) {
    refreshes++;
    // The FIRST refresh is the control (before the reset); the second is the
    // subject (after it). Which one a case breaks is what the case is about.
    if (refreshes === 1) {
      return ${plan.controlRefresh ?? "J(200, { access_token: 'at-c', refresh_token: 'refresh-rotated' })"};
    }
    return ${plan.afterRefresh ?? "J(400, { error: 'invalid_grant' })"};
  }
  if (u.includes('/admin/generate_link')) return J(200, { hashed_token: 'hashed-1' });
  if (u.includes('/auth/v1/verify')) return J(200, { access_token: 'recovery-at' });
  if (u.includes('/auth/v1/user')) return J(200, { id: 'user-1' });
  return J(404, { error: 'unrouted ' + u });
};
`;

const run = (root, plan = {}) => {
  const pre = join(TMP, `stub-${seq++}.mjs`);
  writeFileSync(pre, stubSource(plan));
  const env = { ...process.env };
  for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_Secret_key']) delete env[k];
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(pre).href, PROBE, root], { encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('verify-password-reset-revokes — the happy path really passes', () => {
  test('V1 POSITIVE CONTROL — control refreshes, subject is rejected: exit 0', () => {
    const r = run(makeRoot());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /CONTROL ok/);
    assert.match(r.out, /SUBJECT ok/);
    assert.match(r.out, /PASS/);
  });

  test('V1b — and the probe user is deleted on the way out', () => {
    const r = run(makeRoot());
    assert.match(r.out, /probe user deleted \(HTTP 200\)/);
  });
});

describe('verify-password-reset-revokes — a surviving session is a FINDING, not an unknown', () => {
  test('V2 — the other session still refreshes after the reset: exit 1', () => {
    const r = run(makeRoot(), { afterRefresh: "J(200, { access_token: 'still-alive', refresh_token: 'r' })" });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /THE OTHER SESSION SURVIVED THE RESET/);
  });

  test('V2b — and it still cleans up, because a failed probe must not leave an account behind', () => {
    const r = run(makeRoot(), { afterRefresh: "J(200, { access_token: 'still-alive', refresh_token: 'r' })" });
    assert.match(r.out, /probe user deleted/);
  });
});

describe('verify-password-reset-revokes — a VOID run is 2, never 0', () => {
  // 🔴 THE CASE THE WHOLE CONTROL EXISTS FOR. With the control broken, the
  // subject leg would still have been REJECTED — the stub's default — so a probe
  // without a control would have printed a confident PASS here.
  test('V3 — the control refresh fails before any reset: exit 2, and never PASS', () => {
    const r = run(makeRoot(), { controlRefresh: "J(400, { error: 'invalid_grant' })" });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /would prove nothing about the reset/);
    assert.doesNotMatch(r.out, /PASS/);
  });

  test('V4 — no credential at all: exit 2', () => {
    const r = run(makeRoot({ vault: null }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no credential/);
  });

  test('V5 — the probe user could not be created: exit 2, not a finding', () => {
    const r = run(makeRoot(), { createStatus: 500 });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /could not create the probe user/);
  });

  // Two sign-ins that hand back the SAME token are one session wearing two
  // names, and "the OTHER session" then does not exist in the run at all.
  test('V6 — both sign-ins return the same refresh token: exit 2', () => {
    const r = run(makeRoot(), { sameToken: true });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /SAME refresh token/);
  });

  test('V7 — a probe user left behind is never a clean exit', () => {
    const r = run(makeRoot(), { deleteStatus: 500 });
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /THE PROBE USER WAS NOT DELETED/);
  });
});
