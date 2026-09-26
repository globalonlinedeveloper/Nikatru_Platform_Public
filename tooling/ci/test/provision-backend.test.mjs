// ─────────────────────────────────────────────────────────────────────────────
// provision-backend.test.mjs — tooling/scripts/provision-backend.mjs must be
// able to FAIL.
//
// [pipeline S-12r] (absent from origins.lock.json by construction — S-12r is a residual of S-12, raised by Private/pre-minimal-2026-09-08:plans/03-stamper-plan.md after the pipeline harvest was frozen) This script had NEITHER of the two properties F-10 requires.
// Nothing ran it (`grep -rn provision-backend .github/` -> 0) and nothing tested
// it, because it lives under tooling/scripts/ rather than tooling/ci/ and so sat
// outside assert-guard-coverage.mjs's subject set entirely. It is not a guard —
// it is the one command the stamp's own checklist tells the owner to run — and
// the repo's precedent for exactly that is three lines up in ci.yml, where the
// four release scripts are dry-run exercised on every push.
//
// WHAT IS BEING PROTECTED. The riskiest thing in the script is its config
// surgery: a regex that rewrites a uuid inside the stamped wrangler.jsonc,
// scoped so that PLATFORM_DB — SHARED by the whole portfolio, bound in the very
// same d1_databases array — is never the one rewritten. A brick template edit
// (renaming the binding, reordering the array, growing the block past the
// 400-character window) breaks that scoping silently, and the consequence lands
// on a live database.
//
// ⚠️ `--dry` COULD NOT BE THE EXERCISE, which is why `--self-check` exists:
// --dry dies at the credential gate without CLOUDFLARE_API_TOKEN, then runs
// `npm ci` and calls `wrangler d1 info` before stopping. In CI that fails
// for people without a secret rather than for defects. The two tests at the
// bottom pin that distinction so a future "simplification" cannot quietly point
// the CI step back at --dry.
//
// Every case builds a fake stamped service in a temp dir and runs the REAL
// script against it with cwd set there. The five mutations below were each first
// proven against the real worktree's stamped services/probeapi-api/wrangler.jsonc
// (restore byte-verified) before being written here — a fixture I wrote encodes
// the same misunderstanding as the code I wrote.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname, resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spiedRun, racyOn } from './fixtures/fs-spy-run.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(CI_DIR, '..', 'scripts', 'provision-backend.mjs');
const REPO = resolve(CI_DIR, '..', '..');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-prov-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ID = '9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351';

/** The stamped shape, comments and all — the comments matter, because a check
 *  that grepped instead of parsing would read them. APP_DB first, as the brick
 *  template writes it. */
const goodConfig = (appId) => `{
  // A stamped backend Worker.
  "name": "${appId}-api",
  "d1_databases": [
    {
      // PER-APP. The only resource this Worker owns outright.
      "binding": "APP_DB",
      "database_name": "${appId}_db",
      "database_id": "${PLACEHOLDER}",
      "migrations_dir": "migrations"
    },
    {
      // SHARED across the portfolio — never rewritten by the provisioner.
      "binding": "PLATFORM_DB",
      "database_name": "platform_db",
      "database_id": "${PLATFORM_ID}"
    }
  ]
}
`;

function tree(appId, { config = goodConfig(appId) } = {}) {
  const root = join(TMP, `r${seq++}`);
  const p = join(root, 'services', `${appId}-api`, 'wrangler.jsonc');
  mkdirSync(dirname(p), { recursive: true });
  if (config !== null) writeFileSync(p, config);
  else mkdirSync(dirname(p), { recursive: true });
  return root;
}

/** Runs the real script with the credentials DELIBERATELY stripped from the
 *  environment. If --self-check ever starts needing them, these tests go red —
 *  which is the property the CI step depends on. */
const run = (root, ...args) => {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('[S-12r] --self-check exercises the config surgery, offline', () => {
  // CodeQL #86 paired the existence check at the top with the rewrite at the end, which only
  // a live Cloudflare account reaches. The fixed shape — the config is READ, never checked for
  // existence first — is shared by the offline path, so it is pinned there, strictly: not even
  // the existsSync-then-read that CodeQL tolerates.
  test('the stamped config is read with no existence check of its path first (CodeQL #86)', () => {
    const root = tree('probeapi');
    const env = { ...process.env };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    const { code, text, verdict } = spiedRun([SCRIPT, 'probeapi', '--self-check'], { cwd: root, under: root, env });
    assert.equal(code, 0, text);
    assert.ok(verdict.uses.some((u) => u.endsWith('/wrangler.jsonc')), 'the config was never read');
    assert.deepEqual(racyOn(verdict, '/wrangler.jsonc', { key: 'pairs' }), []);
  });

  test('the stamped shape passes, with no credentials in the environment', () => {
    const { code, out } = run(tree('probeapi'), 'probeapi', '--self-check');
    assert.equal(code, 0, out);
    assert.match(out, /the patch rewrites APP_DB\.database_id/);
    assert.match(out, /PLATFORM_DB\.database_id is untouched/);
    assert.match(out, /No token, no install, no network, no writes/);
  });

  // 🔴 P-A — the brick renames the binding. The script targets it BY NAME, so a
  // template rename leaves the live run patching nothing.
  test('FAILS when the APP_DB binding is renamed', () => {
    const root = tree('probeapi', {
      config: goodConfig('probeapi').replace('"binding": "APP_DB"', '"binding": "APPDB"'),
    });
    const { code, out } = run(root, 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /no d1_databases entry is bound as "APP_DB"/);
  });

  // 🔴 P-B — THE ONE THE SCOPING EXISTS FOR. Reordering the array alone is
  // harmless (the regex anchors on the binding name); reordering it while the
  // pattern is broadened is how the SHARED binding gets rewritten. Proven
  // against the real tree by broadening APP_DB_BLOCK to `"[A-Z_]*DB"` and
  // putting PLATFORM_DB first.
  test('FAILS when the APP_DB entry loses its database_id, so the patch would hit PLATFORM_DB', () => {
    // APP_DB declares no database_id of its own, so the scoped regex runs on
    // past it and captures PLATFORM_DB's instead. It still MATCHES — it just
    // matches the wrong thing, which is the failure a bare "did the regex match"
    // check cannot see.
    const config = `{
  "name": "probeapi-api",
  "d1_databases": [
    {
      "binding": "APP_DB",
      "database_name": "probeapi_db",
      "migrations_dir": "migrations"
    },
    {
      "binding": "PLATFORM_DB",
      "database_name": "platform_db",
      "database_id": "${PLATFORM_ID}"
    }
  ]
}
`;
    const { code, out } = run(tree('probeapi', { config }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /the APP_DB entry declares no `database_id`/);
    // The decisive half: it names the SHARED binding's id as what the live run
    // would have overwritten. Reporting only "something is missing" would send a
    // reader looking for a rename that never happened.
    assert.match(out, new RegExp(`the live run would have captured "${PLATFORM_ID}"`));
  });

  // 🔴 P-C — the 400-character window is the scoping. Grow the block past it and
  // the live run dies at step 1 for every newly stamped backend app.
  test('FAILS when the APP_DB block outgrows the scoping window', () => {
    const root = tree('probeapi', {
      config: goodConfig('probeapi').replace(
        '"binding": "APP_DB",',
        `"binding": "APP_DB",\n      "//pad": "${'x'.repeat(420)}",`,
      ),
    });
    const { code, out } = run(root, 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /APP_DB_BLOCK did not match the stamped config/);
  });

  // 🔴 P-D — without PLATFORM_DB present, "the shared binding was not rewritten"
  // is true because there was nothing to rewrite. That is an assertion that
  // cannot fail, which this repo treats as worse than none.
  test('FAILS when PLATFORM_DB is absent, rather than passing by its absence', () => {
    const config = `{
  "name": "probeapi-api",
  "d1_databases": [
    {
      "binding": "APP_DB",
      "database_name": "probeapi_db",
      "database_id": "${PLACEHOLDER}",
      "migrations_dir": "migrations"
    }
  ]
}
`;
    const { code, out } = run(tree('probeapi', { config }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /no d1_databases entry is bound as "PLATFORM_DB"/);
    assert.match(out, /proven by\s+its absence rather than by the scoping/);
  });

  test('FAILS when the stamped config is not parseable JSONC', () => {
    const { code, out } = run(tree('probeapi', { config: '{ not json' }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /is not parseable JSONC/);
  });

  test('FAILS when there is no stamped backend at all', () => {
    const { code, out } = run(tree('probeapi', { config: null }), 'probeapi', '--self-check');
    assert.equal(code, 1, out);
    assert.match(out, /no stamped backend at/);
  });

  // O-APP-ID-FORM-UNVALIDATED (a). The old snake_case rule let `habit_tracker`
  // through, and the script then died one check later on "no stamped backend" —
  // also exit 1, which is why the exit code alone proves nothing here. The
  // refusal must come from the contract, before any name is built from the id.
  test('refuses habit_tracker before any other check, naming the app-id contract', () => {
    const { code, out } = run(tree('habit_tracker', { config: null }), 'habit_tracker');
    assert.equal(code, 1, out);
    assert.match(out, /contracts\/app-id/);
    assert.match(out, /"_"/);
    assert.doesNotMatch(out, /no stamped backend/);
  });

  // ── the boundary that makes this mode usable in CI at all ─────────────────
  // If --self-check ever starts reaching the credential gate, the CI step
  // becomes a secret check that fails on every fork PR. These two pin the split.
  test('--self-check never reaches the credential gate', () => {
    const { out } = run(tree('probeapi'), 'probeapi', '--self-check');
    assert.doesNotMatch(out, /CLOUDFLARE_API_TOKEN is not set/);
  });

  test('--dry, by contrast, DOES demand credentials — which is why it is not the CI exercise', () => {
    const { code, out } = run(tree('probeapi'), 'probeapi', '--dry');
    assert.equal(code, 1, out);
    assert.match(out, /CLOUDFLARE_API_TOKEN is not set/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O-SERVICE-KIT-UNBUILT (E-a1): step [1] installs with `npm ci` from the stamped
// lockfile, step [6] writes the `appWorkers` row, and `--check` finds a Worker with
// none. The live path runs END TO END here with no network: the service's own
// wrangler (the path step [1] resolves) is a fake that answers d1 info, migrations
// and execute, and the credentials are made-up values it never sends anywhere.
// The stamped service is the REAL brick template rendered for the app id, and the
// route-client map is the REAL one, so these cases also pin that the map covers
// what the template mounts.
// ─────────────────────────────────────────────────────────────────────────────
const BRICK_API = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';
const ROUTE_CLIENTS = 'tooling/bricks/app/route-clients.json';
const render = (rel, appId) => readFileSync(join(REPO, BRICK_API, rel), 'utf8').replaceAll('{{app_id}}', appId);
const LIVE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** The service's own wrangler, faked: every call is appended to wrangler-calls.log. */
const FAKE_WRANGLER = `import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const a = process.argv.slice(2);
appendFileSync(join(dirname(fileURLToPath(import.meta.url)), 'wrangler-calls.log'), a.join(' ') + '\\n');
const is = (...w) => w.every((x, i) => a[i] === x);
if (is('d1', 'info')) { console.log(JSON.stringify({ uuid: '${LIVE_UUID}' })); process.exit(0); }
if (is('d1', 'migrations', 'apply')) { console.log('applied'); process.exit(0); }
if (is('d1', 'execute')) { console.log(JSON.stringify([{ results: [{ name: 'd1_migrations' }, { name: 'records' }] }])); process.exit(0); }
console.error('fake wrangler: unexpected call ' + a.join(' '));
process.exit(1);
`;

/** npm, faked on PATH: records its arguments, and `ci` installs the fake wrangler. */
const FAKE_NPM = `import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const a = process.argv.slice(2);
appendFileSync(join(process.cwd(), 'npm-calls.log'), a.join(' ') + '\\n');
if (a[0] !== 'ci') process.exit(1);
const bin = join(process.cwd(), 'node_modules', 'wrangler', 'bin');
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, 'wrangler.js'), readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'wrangler.js.src'), 'utf8'));
writeFileSync(join(bin, '..', 'package.json'), '{ "type": "module" }\\n');
`;

const stampRegister = () => ({
  servingWorker: { name: 'platform', entrypoint: 'services/platform/src/index.ts', config: 'services/platform/wrangler.jsonc' },
  appWorkers: [],
  bindingSources: { configs: ['services/platform/wrangler.jsonc', `${BRICK_API}/wrangler.jsonc`] },
  routes: [],
});

/** A freshly stamped, not yet provisioned `services/<appId>-api`, plus the map and a register. */
function stampedTree(appId, { lockfile = true, wrangler = true, index = (s) => s, inventory = (s) => s } = {}) {
  const root = join(TMP, `s${seq++}`);
  const svc = `services/${appId}-api`;
  const put = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  put(`${svc}/wrangler.jsonc`, render('wrangler.jsonc', appId));
  put(`${svc}/package.json`, render('package.json', appId));
  put(`${svc}/src/index.ts`, index(render('src/index.ts', appId)));
  put(`${svc}/src/routes/account.ts`, render('src/routes/account.ts', appId));
  if (lockfile) put(`${svc}/package-lock.json`, render('package-lock.json', appId));
  if (wrangler) {
    put(`${svc}/node_modules/wrangler/bin/wrangler.js`, FAKE_WRANGLER);
    // Node stops its package-scope walk at node_modules, so the fake declares its own module type.
    put(`${svc}/node_modules/wrangler/package.json`, '{ "type": "module" }\n');
  }
  put(ROUTE_CLIENTS, readFileSync(join(REPO, ROUTE_CLIENTS), 'utf8'));
  put('tooling/platform-register.json', `${JSON.stringify(stampRegister(), null, 2)}\n`);
  // Step [7]'s two files, copied from the REAL tree: the template row it copies is the
  // real one, and the host row is spliced into the real, hand-formatted register.
  put(INVENTORY, inventory(readFileSync(join(REPO, INVENTORY), 'utf8')));
  put(MONITORS, readFileSync(join(REPO, MONITORS), 'utf8'));
  return root;
}
const INVENTORY = 'tooling/legal/data-inventory.json';
const MONITORS = 'tooling/monitor-register.json';

/** The live path, with made-up credentials and (optionally) a fake npm first on PATH. */
function provision(root, appId, { fakeNpm = false } = {}) {
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: 'fixture-not-a-token', CLOUDFLARE_ACCOUNT_ID: 'fixture-account' };
  if (fakeNpm) {
    const bin = join(root, 'fakebin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'fake-npm.mjs'), FAKE_NPM);
    writeFileSync(join(bin, 'wrangler.js.src'), FAKE_WRANGLER);
    writeFileSync(join(bin, 'npm'), `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, '/')}" "$(dirname "$0")/fake-npm.mjs" "$@"\n`);
    chmodSync(join(bin, 'npm'), 0o755);
    writeFileSync(join(bin, 'npm.cmd'), `@"${process.execPath}" "%~dp0fake-npm.mjs" %*\r\n`);
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = `${bin}${delimiter}${env[pathKey]}`;
  }
  const r = spawnSync(process.execPath, [SCRIPT, appId], { cwd: root, encoding: 'utf8', env, timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const registerOf = (root) => JSON.parse(readFileSync(join(root, 'tooling', 'platform-register.json'), 'utf8'));
const wranglerCalls = (root, appId) => {
  const p = join(root, 'services', `${appId}-api`, 'node_modules', 'wrangler', 'bin', 'wrangler-calls.log');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n') : [];
};

describe('E-a1 step [6] — the appWorkers row, derived from the stamped mounts', () => {
  test('P1 green: the row is the template\'s two mounts with the map\'s clients, and nothing is deployed', () => {
    const root = stampedTree('probeapi');
    const { code, out } = provision(root, 'probeapi');
    assert.equal(code, 0, out);
    assert.match(out, /\[6\] Writing probeapi-api's appWorkers row into tooling\/platform-register\.json/);
    const reg = registerOf(root);
    assert.equal(reg.appWorkers.length, 1);
    const row = reg.appWorkers[0];
    assert.equal(row.name, 'probeapi-api');
    assert.equal(row.entrypoint, 'services/probeapi-api/src/index.ts');
    assert.equal(row.config, 'services/probeapi-api/wrangler.jsonc');
    assert.deepEqual(row.hosts, ['probeapi-api.nikatru.com']);
    assert.equal(row.dsnSecret, 'GLITCHTIP_DSN_PROBEAPI');
    assert.equal(row.clientBasePath, '/v1');
    assert.equal(Object.hasOwn(row, 'cors'), false, '`cors` is reserved for E-b1 and not written yet');
    assert.deepEqual(
      row.routes.map((r) => [r.id, r.method, r.path, r.auth, r.owningFile, r.client.file, r.client.expression]),
      [
        ['probeapi-health', 'GET', '/v1/health', 'public', 'services/probeapi-api/src/index.ts', 'tooling/ci/worker-set.mjs', "/\\/health$/.test(String(x?.path ?? ''))"],
        ['probeapi-account-delete', 'DELETE', '/v1/account', 'required', 'services/probeapi-api/src/routes/account.ts', 'services/platform/src/routes/account.ts', '`${origin}/v1/account`'],
      ],
    );
    assert.ok(row.routes.every((r) => !Object.hasOwn(r, 'unconsumedReason')), 'step [6] wrote a waiver');
    assert.match(row.routes[0].noLimiterReason, /It DOES I\/O/);
    assert.deepEqual(reg.bindingSources.configs, [
      'services/platform/wrangler.jsonc',
      'services/probeapi-api/wrangler.jsonc',
      `${BRICK_API}/wrangler.jsonc`,
    ]);
    const calls = wranglerCalls(root, 'probeapi');
    assert.ok(calls.length > 0, 'the fake wrangler was never called — the case would test nothing');
    assert.ok(!calls.some((c) => /^(deploy|versions|secret)\b/.test(c)), `step [6] must deploy nothing: ${calls.join(' | ')}`);
  });

  test('P2 a second run leaves an existing row exactly as it is', () => {
    const root = stampedTree('probeapi');
    assert.equal(provision(root, 'probeapi').code, 0);
    const before = readFileSync(join(root, 'tooling', 'platform-register.json'), 'utf8');
    const inventoryBefore = readFileSync(join(root, INVENTORY), 'utf8');
    const monitorsBefore = readFileSync(join(root, MONITORS), 'utf8');
    const { code, out } = provision(root, 'probeapi');
    assert.equal(code, 0, out);
    assert.match(out, /services\/probeapi-api\/wrangler\.jsonc already has a row \(probeapi-api\); left unchanged/);
    assert.equal(readFileSync(join(root, 'tooling', 'platform-register.json'), 'utf8'), before);
    // E-b2: step [7] is idempotent too.
    assert.match(out, /already has d1:probeapi_db; left unchanged/);
    assert.match(out, /already has probeapi-api\.nikatru\.com; left unchanged/);
    assert.equal(readFileSync(join(root, INVENTORY), 'utf8'), inventoryBefore);
    assert.equal(readFileSync(join(root, MONITORS), 'utf8'), monitorsBefore);
  });

  test('P3 a mounted route the map does not name: exit 1 naming it, and the register untouched', () => {
    const root = stampedTree('probeapi', {
      index: (s) => {
        const at = "app.route('/v1', api);";
        assert.ok(s.includes(at), 'the template no longer mounts its api group — the case would test nothing');
        return s.replace(at, `app.get('/v1/records', (c) => c.json([]));\n${at}`);
      },
    });
    const before = readFileSync(join(root, 'tooling', 'platform-register.json'), 'utf8');
    const { code, out } = provision(root, 'probeapi');
    assert.equal(code, 1, out);
    assert.match(out, /step \[6\]: tooling\/bricks\/app\/route-clients\.json names no client for 1 route\(s\)/);
    assert.match(out, /^ {4}GET \/v1\/records \(mounted by services\/probeapi-api\/src\/index\.ts\)$/m);
    assert.match(out, /This step writes no `unconsumedReason`/);
    assert.equal(readFileSync(join(root, 'tooling', 'platform-register.json'), 'utf8'), before);
  });

  test('P4 an entrypoint with no mount: exit 1, and no `routes: []` row', () => {
    const root = stampedTree('probeapi', { index: () => "export default { fetch: () => new Response('') };\n" });
    const { code, out } = provision(root, 'probeapi');
    assert.equal(code, 1, out);
    assert.match(out, /found no mounted route in services\/probeapi-api\/src\/index\.ts/);
    assert.deepEqual(registerOf(root).appWorkers, []);
  });
});

describe('E-b2 step [7] — the inventory row and the monitor host row, files only', () => {
  const lineSet = (text) => text.split('\n').map((l) => l.replace(/,\s*$/, ''));

  test('S1 green: d1:probeapi_db is copied from the template, and the host row asks for its monitor', () => {
    const root = stampedTree('probeapi');
    const monitorsBefore = readFileSync(join(root, MONITORS), 'utf8');
    const { code, out } = provision(root, 'probeapi');
    assert.equal(code, 0, out);
    assert.match(out, /\[7\] Writing probeapi_db's tooling\/legal\/data-inventory\.json row and probeapi-api's tooling\/monitor-register\.json host row\(s\)/);

    const stores = JSON.parse(readFileSync(join(root, INVENTORY), 'utf8')).stores;
    const at = stores.findIndex((s) => s.id === 'd1:probeapi_db');
    assert.ok(at >= 0, 'no d1:probeapi_db row');
    assert.equal(stores[at + 1].id, 'd1:{{app_id}}_db', 'the concrete row sits just before the template, and the template stays');
    const row = stores[at];
    assert.deepEqual(Object.keys(row), ['id', 'kind', 'name', 'personalData', 'holds', 'retention', 'writtenBy']);
    assert.equal(row.kind, 'd1-database');
    assert.equal(row.name, 'probeapi_db');
    assert.equal(row.personalData, false);
    assert.equal(row.retention.kind, 'derived');
    assert.deepEqual(row.writtenBy, ['services/probeapi-api/wrangler.jsonc']);
    assert.doesNotMatch(JSON.stringify(row), /template, not a live store|\{\{app_id\}\}|a template of one/, 'the concrete row still describes a template');

    const monitorsAfter = readFileSync(join(root, MONITORS), 'utf8');
    const hosts = JSON.parse(monitorsAfter).hosts;
    assert.deepEqual(hosts.slice(0, -1), JSON.parse(monitorsBefore).hosts, 'only one host row was added');
    const host = hosts.at(-1);
    assert.equal(host.hostname, 'probeapi-api.nikatru.com');
    assert.equal(host.derivedFrom, 'appCatalogue');
    assert.equal(host.monitor, null);
    assert.deepEqual(host.gap.create, {
      name: 'probeapi-api health', type: 'GET', path: '/v1/health', expectedStatus: 200, expectedBody: '"ok":true', intervalSeconds: 60, project: 'probeapi',
    });
    // The hand-formatted file is spliced, never re-serialised: every line it had is still there, in order.
    const before = lineSet(monitorsBefore);
    let i = 0;
    for (const line of lineSet(monitorsAfter)) if (line === before[i]) i++;
    assert.equal(i, before.length, 'step [7] rewrote lines of the monitor register it did not add');
    const calls = wranglerCalls(root, 'probeapi');
    assert.ok(calls.length > 0 && !calls.some((c) => /^(deploy|versions|secret)\b/.test(c)), `step [7] must deploy nothing: ${calls.join(' | ')}`);
  });

  test('S2 no template row to copy: exit 1 naming it, and neither file is written', () => {
    const root = stampedTree('probeapi', {
      inventory: (s) => {
        const inv = JSON.parse(s);
        const n = inv.stores.length;
        inv.stores = inv.stores.filter((x) => x.id !== 'd1:{{app_id}}_db');
        assert.equal(inv.stores.length, n - 1, 'the real inventory has no template row — the case would test nothing');
        return `${JSON.stringify(inv, null, 2)}\n`;
      },
    });
    const inventoryBefore = readFileSync(join(root, INVENTORY), 'utf8');
    const monitorsBefore = readFileSync(join(root, MONITORS), 'utf8');
    const { code, out } = provision(root, 'probeapi');
    assert.equal(code, 1, out);
    assert.match(out, /has no d1:\{\{app_id\}\}_db template row to copy/);
    assert.equal(readFileSync(join(root, INVENTORY), 'utf8'), inventoryBefore);
    assert.equal(readFileSync(join(root, MONITORS), 'utf8'), monitorsBefore);
  });
});

describe('E-a1 step [1] — `npm ci` from the stamped lockfile, never `npm install`', () => {
  test('N1 no package-lock.json: exit 1 before anything is installed or called', () => {
    const root = stampedTree('probeapi', { lockfile: false });
    const { code, out } = provision(root, 'probeapi');
    assert.equal(code, 1, out);
    assert.match(out, /package-lock\.json does not exist\./);
    assert.match(out, /Step \[1\] installs with `npm ci`/);
    assert.deepEqual(wranglerCalls(root, 'probeapi'), [], 'wrangler ran for a service with no lockfile');
    assert.deepEqual(registerOf(root).appWorkers, []);
  });

  test('N2 node_modules missing: step [1] runs `npm ci` (a fake npm on PATH records it)', () => {
    const root = stampedTree('probeapi', { wrangler: false });
    const { code, out } = provision(root, 'probeapi', { fakeNpm: true });
    assert.equal(code, 0, out);
    assert.match(out, /node_modules missing → npm ci/);
    const calls = readFileSync(join(root, 'services', 'probeapi-api', 'npm-calls.log'), 'utf8').trim().split('\n');
    assert.deepEqual(calls.map((c) => c.split(' ')[0]), ['ci']);
  });
});

describe('E-a1 --check — every Worker directory has a register row', () => {
  const WORKER = '{ "name": "w", "main": "src/index.ts" }\n';
  /** A Worker that OWNS a D1 (it declares `migrations_dir`) and serves one host. */
  const OWNING = (d) => `{ "name": "${d}", "main": "src/index.ts", "d1_databases": [{ "binding": "APP_DB", "database_name": "${d.replace(/-api$/, '')}_db", "database_id": "x", "migrations_dir": "migrations" }] }\n`;
  function checkTree({ dirs, rows, register = true, owning = [], hosts = {}, stores = [], monitorHosts = [], inventory = true }) {
    const root = join(TMP, `c${seq++}`);
    for (const d of dirs) {
      mkdirSync(join(root, 'services', d), { recursive: true });
      writeFileSync(join(root, 'services', d, 'wrangler.jsonc'), owning.includes(d) ? OWNING(d) : WORKER);
      if (owning.includes(d)) {
        mkdirSync(join(root, 'services', d, 'migrations'), { recursive: true });
        writeFileSync(join(root, 'services', d, 'migrations', '0001_init.sql'), 'CREATE TABLE records (id TEXT);\n');
      }
    }
    mkdirSync(join(root, 'services', '_shared'), { recursive: true });
    mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
    if (register) {
      const reg = {
        servingWorker: { name: 'platform', config: 'services/platform/wrangler.jsonc' },
        appWorkers: rows.map((d) => ({ name: d, config: `services/${d}/wrangler.jsonc`, ...(hosts[d] ? { hosts: hosts[d] } : {}) })),
      };
      writeFileSync(join(root, 'tooling', 'platform-register.json'), JSON.stringify(reg, null, 2));
    }
    // E-b2: step [7]'s two files, which --check now reads.
    if (inventory) writeFileSync(join(root, INVENTORY), JSON.stringify({ stores: stores.map((id) => ({ id })) }, null, 2));
    writeFileSync(join(root, MONITORS), JSON.stringify({ hosts: monitorHosts.map((hostname) => ({ hostname, monitor: null })) }, null, 2));
    return root;
  }

  test('K1 green: the serving Worker and every app Worker have a row, with no credentials', () => {
    const { code, out } = run(checkTree({ dirs: ['platform', 'x-api'], rows: ['x-api'] }), '--check');
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}services\/platform — servingWorker/);
    assert.match(out, /ok {2}services\/x-api — appWorkers\[0\]/);
    assert.match(out, /all 2 Worker director\(ies\) under services\/ have a register row/);
  });

  test('K2 (the red control) a Worker directory with no appWorkers row: exit 1 naming it, and only it', () => {
    const { code, out } = run(checkTree({ dirs: ['platform', 'x-api', 'y-api'], rows: ['x-api'] }), '--check');
    assert.equal(code, 1, out);
    assert.match(out, /^✗ services\/y-api holds a wrangler\.jsonc and tooling\/platform-register\.json has no appWorkers row for it\./m);
    assert.doesNotMatch(out, /✗ services\/x-api/);
  });

  test('K3 no register: COVERAGE LOST, exit 2', () => {
    const { code, out } = run(checkTree({ dirs: ['platform'], rows: [], register: false }), '--check');
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/platform-register\.json is missing or not JSON/);
  });

  test('K4 no Worker directory at all: COVERAGE LOST, exit 2', () => {
    const { code, out } = run(checkTree({ dirs: [], rows: [] }), '--check');
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — no Worker directory/);
  });

  test('K5 --check takes no app_id: exit 1 with its usage', () => {
    const { code, out } = run(checkTree({ dirs: ['platform'], rows: [] }), 'probeapi', '--check');
    assert.equal(code, 1, out);
    assert.match(out, /--check covers every Worker under services\/ and takes no app_id \(got "probeapi"\)/);
  });

  // ── E-b2: step [7]'s rows ─────────────────────────────────────────────────
  const provisioned = (over = {}) => ({
    dirs: ['platform', 'x-api'], rows: ['x-api'], owning: ['x-api'], hosts: { 'x-api': ['x-api.nikatru.com'] },
    stores: ['d1:x_db'], monitorHosts: ['x-api.nikatru.com'], ...over,
  });

  test('K6 green: a registered Worker whose owned D1 and host both have their rows', () => {
    const { code, out } = run(checkTree(provisioned()), '--check');
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}services\/x-api\/wrangler\.jsonc — d1:x_db; hosts x-api\.nikatru\.com/);
    assert.match(out, /every owned D1 and host of theirs has its inventory and monitor-register row/);
  });

  test('K7 (RC12) an appWorkers row and no inventory row: exit 1 naming d1:x_db, and only it', () => {
    const { code, out } = run(checkTree(provisioned({ stores: [] })), '--check');
    assert.equal(code, 1, out);
    assert.match(out, /^✗ services\/x-api\/wrangler\.jsonc owns D1 x_db and tooling\/legal\/data-inventory\.json has no `d1:x_db` row\./m);
    assert.doesNotMatch(out, /has no host row/);
  });

  test('K8 an appWorkers row whose host has no monitor-register row: exit 1 naming the host', () => {
    const { code, out } = run(checkTree(provisioned({ monitorHosts: [] })), '--check');
    assert.equal(code, 1, out);
    assert.match(out, /^✗ services\/x-api\/wrangler\.jsonc serves x-api\.nikatru\.com and tooling\/monitor-register\.json has no host row for it\./m);
  });

  test('K9 no inventory: COVERAGE LOST, exit 2', () => {
    const { code, out } = run(checkTree(provisioned({ inventory: false })), '--check');
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/legal\/data-inventory\.json is missing/);
  });
});
