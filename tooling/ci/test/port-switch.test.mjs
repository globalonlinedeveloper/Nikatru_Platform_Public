// port-switch.test.mjs — tooling/ops/port-switch.mjs must refuse, FAIL and LOSE
// exactly when it should, and PASS only when every check does.
//
// Fixture registries for each outcome (PASS, FAIL, LOST), the two refusals the
// brief names (no --dry-run; a flag where a value belongs, shell-13), and the
// margin check over a copy of the REAL fee, channel and price registers.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, feeFor } from '../../ops/port-switch.mjs';

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
      'apps/subscriptiontracker/app.yaml', 'catalog']) {
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
    const lower = run(['payments', '--to', 'revenuecat', '--from', 'paddle', '--dry-run', '--root', root]);
    assert.match(lower.out, /C8 margin: \d+ of \d+ net\(s\) FALL .* the switch's ADR must say why/);
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
