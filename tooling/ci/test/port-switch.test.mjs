// port-switch.test.mjs — tooling/ops/port-switch.mjs must refuse, FAIL and LOSE
// exactly when it should, and PASS only when every check does.
//
// Fixture registries for each outcome (PASS, FAIL, LOST), the two refusals the
// brief names (no --dry-run; a flag where a value belongs, shell-13), and the
// margin check over a copy of the REAL fee, channel and price registers.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, feeFor, webhook, channelsChanging, storeBilledRails, canMoveTo, margin } from '../../ops/port-switch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const TOOL = join(REPO, 'tooling', 'ops', 'port-switch.mjs');

const run = (args, cwd = REPO) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  const out = `${r.stderr}${r.stdout}`;
  return { code: r.status, out, first: out.split('\n')[0] };
};

const adapter = (over = {}) => ({
  id: 'acme',
  vendor: 'acme',
  status: 'live',
  impl: { file: 'src/acme.ts', symbol: 'acme' },
  capabilities: ['verify'],
  secrets: ['ACME_SECRET'],
  identity: ['ownerDomain'],
  environments: ['sandbox', 'live'],
  cost: { feeCells: [], unit: null },
  conformance: { file: 'test/acme.test.ts' },
  exportDuty: 'Leaves with us: every row. Cannot move: the mandates.',
  readAt: null,
  ...over,
});

const port = (over = {}) => ({
  $schema: './port.schema.json',
  port: 'widgets',
  level: { claimed: 2, target: 3 },
  interface: { ts: { file: 'src/contract.ts', symbols: ['WidgetPort'] } },
  adapters: [
    adapter(),
    adapter({ id: 'beta', vendor: 'beta', status: 'built', secrets: ['BETA_SECRET'], conformance: { file: 'test/beta.test.ts' } }),
    adapter({ id: 'fake', vendor: null, status: 'fake', secrets: [], identity: [], environments: ['test'], conformance: { file: 'test/fake.test.ts' } }),
  ],
  selection: { by: 'single', source: null, default: { live: 'acme', sandbox: 'acme', test: 'fake' }, canary: null },
  generated: false,
  handTables: [],
  conformance: { suite: { file: 'test/conformance.ts', runner: 'runWidgetConformance' }, pending: [] },
  switch: { runbook: 'Private/runbooks/switch-vendor.md#widgets', dryRun: 'node tooling/ops/port-switch.mjs widgets --to <adapter> --dry-run' },
  _why: ['fixture'],
  ...over,
});

function fixture(doc = port(), files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'port-switch-'));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  w(`tooling/ports/${doc.port}.json`, JSON.stringify(doc, null, 2));
  w('tooling/house-identity.json', JSON.stringify({ ownerDomain: 'example.invalid' }));
  w('services/w/src/types.ts', 'export interface Env {\n  ACME_SECRET?: string;\n  BETA_SECRET?: string;\n}\n');
  w('test/conformance.ts', 'export function runWidgetConformance(a: unknown) { return a; }\n');
  for (const id of ['acme', 'beta', 'fake']) w(`test/${id}.test.ts`, `import { runWidgetConformance } from './conformance';\nrunWidgetConformance('${id}');\n`);
  for (const [rel, text] of Object.entries(files)) w(rel, text);
  return root;
}

describe('port-switch — the invocation', () => {
  it('refuses without --dry-run (exit 2)', () => {
    const r = run(['widgets', '--to', 'beta', '--root', fixture()]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /REFUSED — --dry-run is required/);
  });
  it('refuses a flag given where a value belongs (shell-13)', () => {
    const r = run(['widgets', '--to', '--dry-run']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /REFUSED — --to was given "--dry-run", which is a flag/);
  });
  it('a trailing --dry-run never eats an argument, and a leading one is the same call', () => {
    assert.deepEqual(parseArgs(['p', '--to', 'x', '--dry-run']), parseArgs(['--dry-run', 'p', '--to', 'x']));
    assert.equal(parseArgs(['p', '--dry-run', '--to', 'x']).to, 'x');
  });
  it('refuses an unknown flag and a second positional', () => {
    assert.match(parseArgs(['p', '--to', 'x', '--dry-run', '--force']).error, /unknown flag --force/);
    assert.match(parseArgs(['p', 'q', '--to', 'x', '--dry-run']).error, /exactly one <port>/);
  });
});

describe('port-switch — the outcomes', () => {
  it('PASS: every check passes, exit 0, and nothing is switched', () => {
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture()]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /^port-switch: PASS — all 8 checks pass \(dry run; nothing was switched\)/);
    for (let n = 1; n <= 8; n++) assert.match(r.out, new RegExp(`^PASS  C${n} `, 'm'));
    assert.match(r.out, /C7 standby: acme would become standby/);
  });
  it('FAIL: --to a fake for live', () => {
    const r = run(['widgets', '--to', 'fake', '--dry-run', '--root', fixture()]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /^port-switch: FAIL — C1 target: `fake` is a fake/);
  });
  it('…while --to the fake for test is allowed by C1', () => {
    const r = run(['widgets', '--to', 'fake', '--dry-run', '--env', 'test', '--root', fixture()]);
    assert.match(r.out, /^PASS  C1 target/m);
  });
  it('FAIL: a target that does not exist', () => {
    const r = run(['widgets', '--to', 'nope', '--dry-run', '--root', fixture()]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /C1 target: .*has no adapter `nope`/);
  });
  it('FAIL: a draft target (C2)', () => {
    const doc = port();
    doc.adapters[1].status = 'draft';
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture(doc)]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /C2 status: `beta` is draft/);
  });
  it('FAIL: an undeclared secret name (C3)', () => {
    const doc = port();
    doc.adapters[1].secrets = ['NOBODY_DECLARES_THIS'];
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture(doc)]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /C3 secrets: not declared: NOBODY_DECLARES_THIS/);
  });
  it('FAIL: an identity path absent from house-identity.json (C4)', () => {
    const doc = port();
    doc.adapters[1].identity = ['legalName'];
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture(doc)]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /C4 identity: absent from tooling\/house-identity\.json: legalName/);
  });
  it('FAIL: a conformance file that only IMPORTS the runner (C5)', () => {
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture(port(), { 'test/beta.test.ts': "import { runWidgetConformance } from './conformance';\n" })]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /C5 conformance: test\/beta\.test\.ts does not CALL runWidgetConformance/);
  });
  it('FAIL: a pending case for the target (C5)', () => {
    const doc = port({ conformance: { suite: { file: 'test/conformance.ts', runner: 'runWidgetConformance' }, pending: [{ adapter: 'beta', case: 'refuses a replay', row: 'O-FIXTURE' }] } });
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture(doc)]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /C5 conformance: 1 pending case\(s\): refuses a replay \(O-FIXTURE\)/);
  });
  it('FAIL: no export duty written (C6)', () => {
    const doc = port();
    doc.adapters[1].exportDuty = 'tbd';
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture(doc)]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL  C6 export: no export duty written for: beta/m);
  });
  it('FAIL: no current adapter to stand by (C7)', () => {
    const r = run(['widgets', '--to', 'acme', '--dry-run', '--root', fixture()]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL  C7 standby: no current adapter other than `acme`/m);
  });
  it('LOST: identity unreadable is exit 2, never a pass', () => {
    const root = fixture(port(), { 'tooling/house-identity.json': '{ nope' });
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /^port-switch: LOST — C4 identity/);
  });
  it('LOST: a priced port whose fee register is missing', () => {
    const doc = port();
    doc.adapters[0].cost.feeCells = ['paddle-checkout'];
    const r = run(['widgets', '--to', 'beta', '--dry-run', '--root', fixture(doc)]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /^port-switch: LOST — C8 margin: tooling\/catalog\/fee-register\.json could not be read/);
  });
});

describe('port-switch — margin over a copy of the REAL registers', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'port-switch-real-'));
    for (const rel of ['tooling/ports', 'tooling/catalog/fee-register.json', 'tooling/channel-register.json', 'tooling/house-identity.json',
      'services/platform/src/app-config-data.json', 'services/platform/src/types.ts', 'services/subscriptiontracker-api/src/types.ts',
      // extensions/catalog/extensions.json: render-rail-prices limb D reads it to tell an extension
      // (web only) from an app (store column) since FullShot became a priced product (#1117).
      'apps/subscriptiontracker/app.yaml', 'catalog', 'extensions/catalog/extensions.json']) {
      cpSync(join(REPO, rel), join(root, rel), { recursive: true });
    }
  });
  it('green control: payments --to razorpay --from paddle prints a net per channel and price', () => {
    const r = run(['payments', '--to', 'razorpay', '--from', 'paddle', '--dry-run', '--root', root]);
    assert.match(r.out, /^PASS  C8 margin: \d+ net\(s\)/m, r.out);
    assert.match(r.out, /web \(paddle\): paddle → razorpay/);
    assert.match(r.out, /net +\d+\.\d\d → +\d+\.\d\d/);
    assert.doesNotMatch(r.out, /ios-appstore/, '--from paddle leaves the store channels alone');
  });
  it('a switch that lowers the net says so, and says the ADR must say why', () => {
    const r = run(['payments', '--to', 'paddle', '--from', 'razorpay', '--dry-run', '--root', root]);
    // razorpay serves no channel's primary rail, so nothing moves: a PASS that says so, not a silent one
    assert.match(r.out, /C8 margin: no channel served by razorpay would change rail/);
    const doc = JSON.parse(readFileSync(join(root, 'tooling/ports/payments.json'), 'utf8'));
    const cells = JSON.parse(readFileSync(join(root, 'tooling/catalog/fee-register.json'), 'utf8')).cells;
    const paddle = doc.adapters.find((a) => a.id === 'paddle');
    const rc = doc.adapters.find((a) => a.id === 'revenuecat');
    const onWeb = feeFor(paddle, 'paddle', 599, cells);
    const onStore = feeFor(rc, 'paddle', 599, cells);
    assert.ok(onStore.fee.percentBps > onWeb.fee.percentBps, 'a store aggregator costs more than the web rail');
    // A WEB rail that charges a store's rate: the web channels may move to it (same billing kind),
    // and every net falls. (#1127 re-review, nit A: revenuecat, a store biller, can no longer take
    // the web channels, so it is not the example any more.)
    const dear = { id: 'dear-web', capabilities: ['verify', 'checkout'], cost: { feeCells: ['apple-iap-standard'], unit: null } };
    const lower = margin(root, doc, dear, [paddle]);
    assert.equal(lower.verdict, 'PASS');
    assert.match(lower.detail, /^\d+ of \d+ net\(s\) FALL .* the switch's ADR must say why$/);
  });
  it('red: a fee cell deleted from the register is LOST (exit 2), never a pass', () => {
    const rel = join(root, 'tooling/catalog/fee-register.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      delete doc.cells['razorpay-platform'];
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(['payments', '--to', 'razorpay', '--from', 'paddle', '--dry-run', '--root', root]);
      assert.match(r.out, /^LOST  C8 margin: .*has no cell `razorpay-platform`/m, r.out);
    } finally { writeFileSync(rel, before); }
  });
  it('the paddle threshold cell applies under its threshold and the base cell above it', () => {
    const doc = JSON.parse(readFileSync(join(root, 'tooling/ports/payments.json'), 'utf8'));
    const cells = JSON.parse(readFileSync(join(root, 'tooling/catalog/fee-register.json'), 'utf8')).cells;
    const paddle = doc.adapters.find((a) => a.id === 'paddle');
    assert.deepEqual(feeFor(paddle, 'paddle', 599, cells).cells, ['paddle-under-10']);
    assert.deepEqual(feeFor(paddle, 'paddle', 3499, cells).cells, ['paddle-checkout']);
  });
});

// ⏱ 2026-10-01 · port-pay-core · the payments dry run's own lines (C9–C12) and the per-case
// PENDING lines, over a copy of the REAL registers plus the Worker config and the conformance files.
describe('port-switch — the payments additions over a copy of the REAL registers', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'port-switch-pay-'));
    for (const rel of ['tooling/ports', 'tooling/catalog/fee-register.json', 'tooling/channel-register.json', 'tooling/house-identity.json',
      'services/platform/src/app-config-data.json', 'services/platform/src/types.ts', 'services/subscriptiontracker-api/src/types.ts',
      'services/platform/wrangler.jsonc', 'services/platform/test', 'apps/subscriptiontracker/app.yaml', 'catalog', 'extensions/catalog/extensions.json']) {
      cpSync(join(REPO, rel), join(root, rel), { recursive: true });
    }
  });
  it('red: --to razorpay prints every pending case as FAIL and exits 1', () => {
    const r = run(['payments', '--to', 'razorpay', '--dry-run', '--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL  C5 conformance: \d+ pending case\(s\)/m);
    assert.match(r.out, /^FAIL  C5 pending: purchase grants \(O-RAZORPAY-CHECKOUT-ADAPTER\)$/m);
    // Counted off the real tree: subscriptiontracker's 3 offerings and, since #1117, FullShot Pro's 2.
    assert.match(r.out, /^FAIL  C10 prices: 5 of 5 offering\(s\) have no razorpay price id yet/m);
    assert.match(r.out, /to create on razorpay: subscriptiontracker pro_monthly/);
  });
  it('red: --to fake for live is a FAIL (C1), whatever else passes', () => {
    const r = run(['payments', '--to', 'fake', '--dry-run', '--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /^port-switch: FAIL — C1 target: `fake` is a fake; a fake is never selectable in live/);
  });
  it('--to paddle prints the webhook URL, the secrets by name, the prices, the channels and the run-off', () => {
    const r = run(['payments', '--to', 'paddle', '--from', 'revenuecat', '--dry-run', '--root', root]);
    assert.match(r.out, /^PASS  C9 webhook: register https:\/\/platform\.nikatru\.com\/v1\/money\/paddle at paddle; secrets by name: PADDLE_NOTIFICATION_SECRET, PADDLE_API_KEY$/m);
    // FullShot Pro (#1117) is served with no Paddle price yet (RAIL_PRICE_PENDING), so C10 names it.
    assert.match(r.out, /^FAIL  C10 prices: 2 of 5 offering\(s\) have no paddle price id yet/m);
    assert.match(r.out, /to create on paddle: fullshot pro_monthly/);
    assert.doesNotMatch(r.out, /to create on paddle: subscriptiontracker/);
    // #1127 money review, finding 3: RevenueCat's channels are billed by the STORES, so a web rail
    // cannot take them. Nothing moves, and no margin is counted for them.
    assert.match(r.out, /^PASS  C11 channels: no channel's purchaseRail changes; 3 store-billed channel\(s\) stay on their store's billing, which `paddle` cannot take: android-play \(play-billing\), ios-appstore \(apple-iap\), macos-appstore \(apple-iap\)$/m);
    assert.match(r.out, /^PASS  C12 run-off: a RUN-OFF, not a cutover: card and UPI mandates do not move/m);
    assert.match(r.out, /^ {4}run-off revenuecat: Leaves with us/m);
    assert.match(r.out, /^PASS  C8 margin: no channel served by revenuecat would change rail; no net moves$/m);
  });

  // #1127 money review, finding 3: the dry run said android-play, ios-appstore and macos-appstore
  // move to Razorpay and counted their margin gain. A store-billed channel never moves to a web rail.
  it('red: --to razorpay moves no store-billed channel, and C8 nets only the channels that move', () => {
    const r = run(['payments', '--to', 'razorpay', '--dry-run', '--root', root]);
    const c11 = r.out.split('\n').find((l) => /C11 channels/.test(l)) ?? '';
    for (const ch of ['android-play', 'ios-appstore', 'macos-appstore']) {
      assert.doesNotMatch(c11, new RegExp(`${ch} \\([a-z-]+ → razorpay\\)`), `${ch} is billed by its store`);
      assert.doesNotMatch(r.out, new RegExp(`^ {4}${ch} \\(`, 'm'), `C8 nets nothing for ${ch}`);
    }
    assert.match(c11, /^PASS  C11 channels: 8 channel\(s\) would change purchaseRail: web \(paddle → razorpay\)/);
    assert.match(c11, /3 store-billed channel\(s\) stay on their store's billing, which `razorpay` cannot take/);
    assert.match(r.out, /^PASS  C8 margin: \d+ net\(s\)/m, 'the per-channel net per price, current against target');
    assert.match(r.out, /^ {4}web \(paddle\): paddle → razorpay$/m);
  });
  // #1127 re-review, nit A: the move rule is SYMMETRIC. A store aggregator cannot bill a web page,
  // so --to revenuecat lists no web, desktop or extension channel, and C8 nets none of them.
  it('red: --to revenuecat moves no web-billed channel (web, desktop or extension), and C8 nets none', () => {
    const r = run(['payments', '--to', 'revenuecat', '--dry-run', '--root', root]);
    const c11 = r.out.split('\n').find((l) => /C11 channels/.test(l)) ?? '';
    for (const ch of ['web', 'windows-store', 'windows-direct', 'linux-snap', 'linux-appimage', 'chrome-webstore', 'edge-addons', 'amo']) {
      assert.doesNotMatch(c11, new RegExp(`(?:: |, )${ch} \\([a-z-]+ → revenuecat\\)`), `${ch} is billed on the web`);
      assert.doesNotMatch(r.out, new RegExp(`^ {4}${ch} \\(`, 'm'), `C8 nets nothing for ${ch}`);
    }
    assert.match(c11, /^PASS  C11 channels: no channel's purchaseRail changes; 8 web-billed channel\(s\) stay on a web rail, which `revenuecat` \(a store biller\) cannot take: web \(paddle\)/);
    assert.match(r.out, /^PASS  C8 margin: no channel served by paddle, razorpay would change rail; no net moves$/m);
  });
  it('the move rule is one predicate, both ways: kind in, kind out', () => {
    const stores = new Set(['play-billing', 'apple-iap']);
    const storeBiller = { capabilities: ['verify', 'cancel-store'] };
    const webRail = { capabilities: ['verify', 'checkout', 'cancel'] };
    assert.equal(canMoveTo('play-billing', storeBiller, stores), true);
    assert.equal(canMoveTo('play-billing', webRail, stores), false);
    assert.equal(canMoveTo('paddle', webRail, stores), true);
    assert.equal(canMoveTo('paddle', storeBiller, stores), false, 'a web channel never moves to a store biller');
  });
  it('green control: a store-billing target CAN take a store-billed channel (the rule is derived, not a name list)', () => {
    const doc = JSON.parse(readFileSync(join(root, 'tooling/ports/payments.json'), 'utf8'));
    const revenuecat = doc.adapters.find((a) => a.id === 'revenuecat');
    const otherStore = { id: 'store-two', capabilities: ['verify', 'cancel-store'], cost: { feeCells: ['play-billing-subscription'] } };
    const r = channelsChanging(root, otherStore, [revenuecat], [...doc.adapters, otherStore]);
    assert.equal(r.verdict, 'PASS');
    assert.match(r.detail, /channel\(s\) would change purchaseRail: ios-appstore \(apple-iap → store-two\), macos-appstore \(apple-iap → store-two\)$/);
    assert.ok(storeBilledRails(doc.adapters, JSON.parse(readFileSync(join(root, 'tooling/catalog/fee-register.json'), 'utf8')).cells).has('play-billing'));
  });
  it('a port other than payments prints none of C9–C12', () => {
    const r = run(['telemetry', '--to', 'sentry', '--dry-run', '--root', root]);
    assert.doesNotMatch(r.out, /C9 webhook|C10 prices|C11 channels|C12 run-off/);
  });
  it('a declared per-SALE unit cost is a fee (the fake costs 0), never LOST', () => {
    const fake = { id: 'fake', cost: { feeCells: [], unit: { usd: 0, per: 'sale', asOf: '2026-10-01', verify: 'no vendor, no fee' } } };
    assert.deepEqual(feeFor(fake, 'paddle', 599, {}).fee, { percentBps: 0, fixedMinor: 0 });
    const perMonth = { id: 'x', cost: { feeCells: [], unit: { usd: 5, per: 'month', asOf: '2026-10-01', verify: 'a flat plan' } } };
    assert.match(feeFor(perMonth, 'paddle', 599, {}).lost, /carries no fee cells/);
  });
});

// #1127 CodeQL #546 js/regex-injection: `webhook` is exported, so it allowlists `env` itself
// and finds the env block by comparing keys as strings, never by a RegExp built from input.
describe('port-switch — C9 never builds a RegExp from --env', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'port-switch-env-'));
    mkdirSync(join(root, 'services/platform'), { recursive: true });
    writeFileSync(join(root, 'services/platform/wrangler.jsonc'), JSON.stringify({
      name: 'platform',
      routes: [{ pattern: 'platform.example.test', custom_domain: true }],
      env: {
        'sandbox-old': { routes: [{ pattern: 'platform-old.example.test', custom_domain: true }] },
        sandbox: { routes: [{ pattern: 'platform.sandbox.example.test', custom_domain: true }] },
      },
    }, null, 2));
  });
  const target = { id: 'paddle', vendor: 'paddle', secrets: ['PADDLE_API_KEY'] };
  it('green control: each declared environment finds its OWN block', () => {
    assert.deepEqual(webhook(root, 'live', target).verdict, 'PASS');
    assert.match(webhook(root, 'live', target).detail, /^register https:\/\/platform\.example\.test\/v1\/money\/paddle/);
    const s = webhook(root, 'sandbox', target);
    assert.equal(s.verdict, 'PASS', s.detail);
    assert.match(s.detail, /^register https:\/\/platform\.sandbox\.example\.test\/v1\/money\/paddle/);
  });
  it('red: an --env carrying regex syntax is refused, never matched as a pattern', () => {
    for (const env of ['sand.ox', 'sandbox|live', '.*', 'Sandbox']) {
      const r = webhook(root, env, target);
      assert.equal(r.verdict, 'FAIL', `${env}: ${r.detail}`);
      assert.match(r.detail, /is not a declared environment \(live, sandbox, test\)/);
    }
  });
});

describe('port-switch — a MAIL switch moves more than code (C9–C14)', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'port-switch-mail-'));
    for (const rel of ['tooling/ports', 'tooling/mail-transport.json', 'tooling/house-identity.json', 'tooling/ceilings.json', 'tooling/channel-register.json',
      'services/platform/src/types.ts', 'services/platform/test/mail-resend.conformance.test.ts', 'services/platform/test/mail-ses.conformance.test.ts',
      'services/_shared/test/mail-fake.conformance.test.ts']) cpSync(join(REPO, rel), join(root, rel), { recursive: true });
  });
  const edit = (rel, fn) => {
    const abs = join(root, rel);
    const before = readFileSync(abs, 'utf8');
    const doc = JSON.parse(before);
    fn(doc);
    writeFileSync(abs, JSON.stringify(doc));
    return () => writeFileSync(abs, before);
  };

  it('red: --to ses prints the SES draft as FAIL (status: draft) and exits 1 — on the REAL registry', () => {
    const r = run(['mail', '--to', 'ses', '--dry-run']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /FAIL — C1 target: `ses` is draft \(status: draft\)/);
    assert.match(r.out, /FAIL\s+C2 status: `ses` is draft/);
    const c9 = r.out.split('\n').find((l) => /C9 dns/.test(l)) ?? '';
    assert.match(c9, /^FAIL\s+C9 dns: `ses` has no rail/);
    for (const k of ['SPF include', 'DKIM', 'return-path MX', 'DMARC alignment']) assert.ok(c9.includes(k), `C9 names ${k}`);
    assert.match(r.out, /FAIL\s+C12 suppression: .*export from `resend`, import into `ses`/);
  });
  it('the real resend rail names SPF, DKIM, return-path and DMARC; the suppression duty FAILs until named; cost is LOST, not guessed', () => {
    const r = run(['mail', '--to', 'resend', '--dry-run']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PASS\s+C9 dns: rail `resend`: .*SPF include send\.mail\.nikatru\.com.*return-path MX.*DKIM resend\._domainkey/);
    assert.match(r.out, /PASS\s+C11 streams: .*auth: smtp \(external/);
    assert.match(r.out, /FAIL\s+C12 suppression/);
    assert.match(r.out, /LOST\s+C14 cost: tooling\/ceilings\.json records no row for resend/);
  });
  it('green control: with both methods named, C12 passes and secrets are listed per stream', () => {
    const undo = edit('tooling/ports/mail.json', (d) => {
      for (const a of d.adapters) if (a.delivery) a.delivery.suppression = { export: 'export method named in the runbook', import: 'import method named in the runbook' };
    });
    try {
      const r = run(['mail', '--to', 'resend', '--from', 'ses', '--dry-run', '--root', root]);
      assert.match(r.out, /PASS\s+C12 suppression: export: export method named in the runbook → import: import method named in the runbook/);
      assert.match(r.out, /reports: stays on resend/);
    } finally { undo(); }
  });
  it('red: a rail missing its return-path MX FAILs C9', () => {
    const undo = edit('tooling/mail-transport.json', (d) => { d.authRecords.records = d.authRecords.records.filter((x) => x.kind !== 'mx'); });
    try {
      const r = run(['mail', '--to', 'resend', '--from', 'ses', '--dry-run', '--root', root]);
      assert.match(r.out, /FAIL\s+C9 dns: rail `resend` in tooling\/mail-transport\.json lacks return-path MX/);
    } finally { undo(); }
  });
  it('a fake target needs no DNS, domain or warm-up — and is still refused for live by C1', () => {
    const r = run(['mail', '--to', 'fake', '--dry-run', '--env', 'test', '--from', 'resend', '--root', root]);
    assert.match(r.out, /PASS\s+C9 dns: `fake` is a fake/);
    const live = run(['mail', '--to', 'fake', '--dry-run', '--root', root]);
    assert.match(live.first, /FAIL — C1 target: `fake` is a fake/);
  });
});

describe('port-switch — the telemetry plan (C9) over the REAL registers', () => {
  // Run against the repository itself: the plan reads four registers and the two
  // uploaders, and every one of them is read-only here.
  it('green control: --to sentry --env sandbox --from noop passes, and C9 lists every channel, Worker, uploader and monitor', () => {
    const r = run(['telemetry', '--to', 'sentry', '--env', 'sandbox', '--from', 'noop', '--dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^PASS  C9 plan: \d+ app build\(s\) need a release if the app sink moves; 2 Worker\(s\) a redeploy; 2 uploader\(s\); \d+ monitor\(s\) to recreate/m);
    assert.match(r.out, /GLITCHTIP_DSN is COMPILE-TIME .* APP RELEASE on every channel below/);
    const channels = JSON.parse(readFileSync(join(REPO, 'tooling/channel-register.json'), 'utf8')).channels;
    for (const c of channels.filter((x) => (x.crashSink?.layers ?? []).includes('dart'))) {
      assert.match(r.out, new RegExp(`^ +${c.id} +GLITCHTIP_DSN \\(--dart-define\\) → release this channel$`, 'm'), `channel ${c.id} is not named`);
    }
    assert.match(r.out, /^ +platform +GLITCHTIP_DSN \(deploy var\) → set it and REDEPLOY/m);
    assert.match(r.out, /^ +subscriptiontracker-api +GLITCHTIP_DSN \(deploy var\)/m);
    assert.match(r.out, /node tooling\/ops\/upload-native-symbols\.mjs/);
    assert.match(r.out, /node tooling\/ops\/upload-web-sourcemaps\.mjs/);
    assert.match(r.out, /^ +#1 +GET +glitchtip\.nikatru\.com$/m);
    assert.match(r.out, /export it optionally; never block the switch on it/);
    assert.match(r.out, /cost delta: noop: no unit cost recorded → sentry: no unit cost recorded/);
  });
  it('red: a missing uploader is LOST (exit 2), never a pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'port-switch-tel-'));
    for (const rel of ['tooling/ports', 'tooling/channel-register.json', 'tooling/platform-register.json', 'tooling/monitor-register.json',
      'tooling/ops/upload-native-symbols.mjs', 'packages/telemetry/test']) {
      cpSync(join(REPO, rel), join(root, rel), { recursive: true });
    }
    const r = run(['telemetry', '--to', 'sentry', '--env', 'sandbox', '--from', 'noop', '--dry-run', '--root', root]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /^port-switch: LOST — C9 plan: tooling\/ops\/upload-web-sourcemaps\.mjs does not exist/);
  });
  it('red: a Worker target fails C5 — the ts half has no registered suite (it claims L2)', () => {
    const r = run(['telemetry', '--to', 'webhook', '--from', 'ntfy', '--dry-run']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL  C5 conformance: services\/_shared\/test\/notifier\.test\.ts does not CALL runTelemetryClientConformance/m);
    assert.match(r.out, /Workers \(TOUCHED by this switch\)/);
  });
});

// ⏱ 2026-10-02 · port-sql — C9, the export dry run, over the REAL sql.json and the
// REAL migrations. The export here is built at test time from the migrations in
// the dump's JSON-lines shape, so this block grades the TOOL (flags, gzip, exit
// codes, the deciding line); services/platform/test/sql-export-replay.test.ts
// feeds the replay the shipped dumpD1Database's own output.
describe('port-switch sql — C9 replays one export into node:sqlite', () => {
  let dir;
  const exportOf = (database, migDir, { dropTable = null } = {}) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync(join(REPO, migDir)).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(REPO, migDir, f), 'utf8'));
    if (database === 'platform_db') db.exec("INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES ('nightly-export', 'platform_db', 1, NULL, '2026-10-02T02:30:00Z')");
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter((t) => t.name !== dropTable);
    const lines = [{ kind: 'meta', database, exportedAt: '2026-10-02T02:30:00Z', generator: 'platform-worker-backup/2' }];
    let rows = 0;
    for (const t of tables) lines.push({ kind: 'schema', table: t.name, sql: t.sql });
    for (const t of tables) {
      const data = db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all();
      for (const d of data) lines.push({ kind: 'row', table: t.name, data: { ...d } });
      lines.push({ kind: 'table-end', table: t.name, rows: data.length, truncated: false });
      rows += data.length;
    }
    lines.push({ kind: 'end', tables: tables.length, rows, truncated: false, queries: 3 });
    db.close();
    return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  };
  const write = (name, text, gz = true) => {
    const file = join(dir, name);
    writeFileSync(file, gz ? gzipSync(Buffer.from(text)) : text);
    return file;
  };
  before(() => { dir = mkdtempSync(join(tmpdir(), 'sql-export-')); });

  it('green control: a gzipped platform_db export replays — every check PASS, exit 0', () => {
    const r = run(['sql', '--to', 'sqlite', '--dry-run', '--env', 'sandbox', '--export', write('platform_db.jsonl.gz', exportOf('platform_db', 'services/platform/migrations'))]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /^port-switch: PASS — all 9 checks pass/);
    assert.match(r.out, /PASS  C9 replay: platform_db: \d+ migration\(s\) of services\/platform\/migrations replayed; \d+ table\(s\) and \d+ row\(s\) match the export/);
    assert.match(r.out, /cron_heartbeat\s+1 row\(s\)/);
  });
  it('…and so does subscriptiontracker_db, found by the wrangler config that owns its migrations, uncompressed', () => {
    const r = run(['sql', '--to', 'sqlite', '--dry-run', '--env', 'sandbox', '--export', write('st.jsonl', exportOf('subscriptiontracker_db', 'services/subscriptiontracker-api/migrations'), false)]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PASS  C9 replay: subscriptiontracker_db: \d+ migration\(s\) of services\/subscriptiontracker-api\/migrations replayed/);
  });
  it('red: an export MISSING a table is FAIL (exit 1), and the first line names C9 and the table', () => {
    const r = run(['sql', '--to', 'sqlite', '--dry-run', '--env', 'sandbox', '--export', write('missing.jsonl.gz', exportOf('platform_db', 'services/platform/migrations', { dropTable: 'signups' }))]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /^port-switch: FAIL — C9 replay: platform_db: 1 mismatch\(es\) — first: table `signups` is created by the migrations and is missing from the export/);
  });
  it('LOST: no --export is exit 2 — the export duty unrehearsed is never a pass', () => {
    const r = run(['sql', '--to', 'sqlite', '--dry-run', '--env', 'sandbox']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /^port-switch: LOST — C9 replay: no --export <file>/);
  });
  it('the sqlite engine is never a live target (C1), export or not', () => {
    const r = run(['sql', '--to', 'sqlite', '--dry-run', '--export', write('live.jsonl.gz', exportOf('platform_db', 'services/platform/migrations'))]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /^port-switch: FAIL — C1 target: `sqlite` is a fake; a fake is never selectable in live/);
  });
  it('--export belongs to the sql port alone', () => {
    assert.match(parseArgs(['payments', '--to', 'paddle', '--dry-run', '--export', 'x.gz']).error, /--export is for sql/);
    assert.equal(parseArgs(['sql', '--to', 'sqlite', '--dry-run', '--export', 'x.gz']).export, 'x.gz');
  });
});
