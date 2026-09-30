// ─────────────────────────────────────────────────────────────────────────────
// sandbox-service-role.test.mjs — tooling/ops/check-sandbox-service-role.mjs
// (⏱ 2026-09-30, ADR no.NNN, second review of #1070 finding 4).
//
// The Cloudflare API is a fake; every case is a shape the live read can take.
//   · GREEN: two deployed sandbox scripts whose versions bind no service-role key;
//   · 🔴 RED: a SERVING version binds it; the NEWEST uploaded version binds it
//     (the next deploy would keep it);
//   · a never-deployed script (404) holds nothing and is not a failure;
//   · COULD NOT LOOK: no script named, a version answer with no bindings, any
//     other API refusal.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CouldNotLook, FORBIDDEN_BINDING, judge, readSandboxBindings } from '../../ops/check-sandbox-service-role.mjs';

/** A fake `cf(path, token)` over { script: { serving: [bindings], newest: [bindings] | undefined } }. */
function fakeApi(world) {
  return async (path) => {
    const m = path.match(/workers\/scripts\/([^/]+)\/(deployments|versions)(?:\/(.+))?$/);
    if (!m) throw new CouldNotLook(`unexpected path ${path}`);
    const [, script, what, id] = m;
    const w = world[decodeURIComponent(script)];
    if (!w) throw new CouldNotLook(`the Cloudflare API answered HTTP 404 for ${path}`);
    if (what === 'deployments') return { deployments: [{ versions: [{ version_id: 'serving-1', percentage: 100 }] }] };
    if (!id) return { items: w.newest ? [{ id: 'newest-2' }, { id: 'serving-1' }] : [{ id: 'serving-1' }] };
    const bindings = id === 'newest-2' ? w.newest : w.serving;
    if (bindings === null) return { resources: {} };
    return { resources: { bindings: bindings.map((name) => ({ name, type: 'secret_text' })) } };
  };
}
const read = (world, scripts = Object.keys(world)) => readSandboxBindings({ accountId: 'a', token: 't', scripts }, fakeApi(world));

describe('check-sandbox-service-role', () => {
  test('GREEN: deployed sandbox scripts binding no service-role key', async () => {
    const v = judge(await read({ 'platform-sandbox': { serving: ['SUPABASE_URL', 'PLATFORM_DB'] }, 'api-sandbox': { serving: ['APP_DB'] } }));
    assert.equal(v.ok, true);
    assert.match(v.line, /2 sandbox script\(s\), 2 deployed, 2 version\(s\) read; none holds SUPABASE_SERVICE_ROLE_KEY/);
  });

  test('🔴 RED: a SERVING version binds the service-role key', async () => {
    const v = judge(await read({ 'platform-sandbox': { serving: ['SUPABASE_URL', FORBIDDEN_BINDING] } }));
    assert.equal(v.ok, false);
    assert.match(v.line, /SUPABASE_SERVICE_ROLE_KEY is bound on: platform-sandbox version serving-/);
  });

  test('🔴 RED: the NEWEST uploaded version binds it (the next deploy keeps it) while the serving one does not', async () => {
    const v = judge(await read({ 'platform-sandbox': { serving: ['SUPABASE_URL'], newest: [FORBIDDEN_BINDING] } }));
    assert.equal(v.ok, false);
    assert.match(v.line, /platform-sandbox version newest-2/);
  });

  test('a never-deployed sandbox script holds nothing: not a failure, and counted as not deployed', async () => {
    const v = judge(await read({ 'platform-sandbox': { serving: ['SUPABASE_URL'] } }, ['platform-sandbox', 'gone-sandbox']));
    assert.equal(v.ok, true);
    assert.match(v.line, /2 sandbox script\(s\), 1 deployed/);
  });

  test('COULD NOT LOOK: no script named, or a version answer with no bindings', async () => {
    assert.throws(() => judge([]), CouldNotLook);
    await assert.rejects(read({ 'platform-sandbox': { serving: null } }), CouldNotLook);
  });
});
