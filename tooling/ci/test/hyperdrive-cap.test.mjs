// ─────────────────────────────────────────────────────────────────────────────
// hyperdrive-cap.test.mjs — assert-hyperdrive-cap.mjs must be able to FAIL on
// each limb, and must refuse when it reads nothing.
//
// Register row O-HYPERDRIVE-COLLISION. Nothing in the tree used Hyperdrive when
// this landed (2026-09-14), so the passing real tree is the zero-binding case and
// every failing case is a fixture that adds one.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-hyperdrive-cap.mjs');
const BRICK = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-hd-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const ORIGIN = { host: 'Box A', maxConnections: 100, reserved: 3, inUse: 25, budget: 72, asOf: '2026-09-14', verify: 'SHOW max_connections;' };
const HD = (binding, extra = '') => `{\n  // the api\n  "name": "platform",\n  "hyperdrive": [{ "binding": "${binding}", "id": "abc123" }]${extra}\n}\n`;
const PLAIN = '{\n  "name": "platform"\n}\n';

function fixture({ platform = PLAIN, register = { origin: ORIGIN, configs: [] }, brick = '{\n  "name": "{{app_id}}-api"\n}\n', docs = null } = {}) {
  const dir = join(TMP, `r${seq++}`);
  for (const d of ['services/platform', 'tooling/ops', BRICK, 'docs']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'services/platform/wrangler.jsonc'), platform);
  if (register !== null) writeFileSync(join(dir, 'tooling/ops/hyperdrive.json'), JSON.stringify(register, null, 2));
  if (brick !== null) writeFileSync(join(dir, BRICK, 'wrangler.jsonc'), brick);
  if (docs !== null) writeFileSync(join(dir, 'docs/hyperdrive.md'), docs);
  return dir;
}
const run = (dir) => {
  const r = spawnSync(process.execPath, [GUARD, dir], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-hyperdrive-cap', () => {
  test('passes with zero bindings, and says it read the configs', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}hyperdrive cap — 2 wrangler config\(s\) read \(brick included\), 0 Hyperdrive binding\(s\)/);
  });

  test('passes a binding with a declared cap inside the budget', () => {
    const reg = { origin: ORIGIN, configs: [{ service: 'platform', binding: 'BOXA_PG', originConnectionLimit: 40 }] };
    const { code, out } = run(fixture({ platform: HD('BOXA_PG'), register: reg }));
    assert.equal(code, 0, out);
    assert.match(out, /1 Hyperdrive binding\(s\).*declared caps 40 of origin budget 72/);
  });

  test('C1: a binding with no row fails, naming the budget', () => {
    const { code, out } = run(fixture({ platform: HD('BOXA_PG') }));
    assert.equal(code, 1, out);
    assert.match(out, /C1 services\/platform\/wrangler\.jsonc → hyperdrive\[BOXA_PG\] has NO row in tooling\/ops\/hyperdrive\.json/);
  });

  test('C1: a binding inside an env block is read too', () => {
    const cfg = `{\n  "name": "platform",\n  "env": { "staging": { "hyperdrive": [{ "binding": "STG_PG", "id": "x" }] } }\n}\n`;
    const { code, out } = run(fixture({ platform: cfg }));
    assert.equal(code, 1, out);
    assert.match(out, /C1 services\/platform\/wrangler\.jsonc → env\.staging\.hyperdrive\[STG_PG\] has NO row/);
  });

  test('C1: a binding in the brick template is held to the same rule', () => {
    const brick = '{\n  "name": "{{app_id}}-api",\n  "hyperdrive": [{ "binding": "APP_PG", "id": "{{hyperdrive_id}}" }]\n}\n';
    const { code, out } = run(fixture({ brick }));
    assert.equal(code, 1, out);
    assert.match(out, /C1 .*\{\{app_id\}\}-api\/wrangler\.jsonc → hyperdrive\[APP_PG\] has NO row/);
  });

  test('C1: a row whose cap is not a positive integer fails', () => {
    const reg = { origin: ORIGIN, configs: [{ service: 'platform', binding: 'BOXA_PG', originConnectionLimit: 0 }] };
    const { code, out } = run(fixture({ platform: HD('BOXA_PG'), register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /C1 .* originConnectionLimit is 0, not a positive integer/);
  });

  test('C2: caps summing over the budget fail', () => {
    const reg = { origin: ORIGIN, configs: [{ service: 'platform', binding: 'BOXA_PG', originConnectionLimit: 100 }] };
    const { code, out } = run(fixture({ platform: HD('BOXA_PG'), register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /C2 the declared originConnectionLimit values sum to 100, over origin\.budget 72/);
  });

  test('C2: a budget that is not maxConnections - reserved - inUse fails', () => {
    const { code, out } = run(fixture({ register: { origin: { ...ORIGIN, budget: 97 }, configs: [] } }));
    assert.equal(code, 1, out);
    assert.match(out, /C2 tooling\/ops\/hyperdrive\.json origin\.budget is 97, but .* = 72/);
  });

  test('C3: a provisioning command without --origin-connection-limit fails; with it, passes', () => {
    const bad = run(fixture({ docs: 'npx wrangler hyperdrive create boxa --connection-string="$PG"\n' }));
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /C3 docs\/hyperdrive\.md:1 runs `wrangler hyperdrive create` without --origin-connection-limit/);
    const good = run(fixture({ docs: 'npx wrangler hyperdrive create boxa --connection-string="$PG" --origin-connection-limit 40\n' }));
    assert.equal(good.code, 0, good.out);
  });

  test('C4: a row for a binding nothing declares fails', () => {
    const reg = { origin: ORIGIN, configs: [{ service: 'platform', binding: 'GONE_PG', originConnectionLimit: 10 }] };
    const { code, out } = run(fixture({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /C4 tooling\/ops\/hyperdrive\.json declares platform → GONE_PG, and no wrangler config binds it/);
  });

  test('COVERAGE LOST: no register', () => {
    const { code, out } = run(fixture({ register: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/ops\/hyperdrive\.json does not exist/);
  });

  test('COVERAGE LOST: origin numbers without asOf + verify', () => {
    const { asOf, ...noAsOf } = ORIGIN;
    const { code, out } = run(fixture({ register: { origin: noAsOf, configs: [] } }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*carries no `asOf` \+ `verify`/);
  });

  test('COVERAGE LOST: the brick template is missing', () => {
    const { code, out } = run(fixture({ brick: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*\{\{app_id\}\}-api\/wrangler\.jsonc does not exist/);
  });
});
