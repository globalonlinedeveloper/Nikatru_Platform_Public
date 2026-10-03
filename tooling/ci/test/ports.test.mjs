// ports.test.mjs — assert-ports.mjs must be able to FAIL, limb by limb.
//
// Every limb's red control is a RECORDED MUTATION of a green fixture (vacuous-03):
// the green control runs first, then one change per case reddens exactly the
// limb it names, and the first output line must name that limb. The last block
// runs the guard over a copy of the REAL registries and reddens it there too
// ("a fixture passing is not a guard working").
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, forbiddenValues, evaluate, portLineFor, callsRunner } from '../assert-ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(HERE, '..', 'assert-ports.mjs');
const SCHEMA = JSON.parse(readFileSync(join(REPO, 'tooling/ports/port.schema.json'), 'utf8'));

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  const out = `${r.stderr}${r.stdout}`;
  return { code: r.status, out, first: (r.stderr.trim() ? r.stderr : r.stdout).split('\n')[0] };
};

const adapter = (over = {}) => ({
  id: 'acme',
  vendor: 'acme',
  status: 'live',
  impl: { file: 'services/w/src/lib/acme.ts', symbol: 'acmeVerifier' },
  capabilities: ['verify'],
  secrets: ['ACME_SECRET'],
  identity: ['ownerDomain'],
  environments: ['sandbox', 'live'],
  cost: { feeCells: [], unit: null },
  conformance: null,
  exportDuty: 'Leaves with us: every row. Cannot move: the mandates.',
  readAt: null,
  ...over,
});

const port = (over = {}) => ({
  $schema: './port.schema.json',
  port: 'widgets',
  level: { claimed: 2, target: 3 },
  interface: { ts: { file: 'services/w/src/lib/contract.ts', symbols: ['WidgetPort'] } },
  adapters: [adapter(), adapter({ id: 'fake', vendor: null, status: 'fake', impl: { file: 'services/w/src/lib/fake.ts', symbol: 'fakeWidget' }, secrets: [], identity: [], environments: ['test'] })],
  selection: { by: 'single', source: null, default: { live: 'acme', sandbox: 'acme', test: 'fake' }, canary: null },
  generated: false,
  handTables: [{ file: 'services/w/src/registry.ts', anchor: 'export const ADAPTERS', until: 'port-x', why: 'the adapter set is a hand array until the render tool lands' }],
  conformance: { suite: null, pending: [] },
  switch: { runbook: 'Private/runbooks/switch-vendor.md#widgets', dryRun: 'node tooling/ops/port-switch.mjs widgets --to <adapter> --dry-run' },
  _why: ['fixture'],
  ...over,
});

const nonPort = (rows) => ({ $schema: './port.schema.json#/$defs/nonPortRegister', _why: ['fixture'], rows });

function fixture({ ports = { widgets: port() }, nonPortRows = [{ vendor: 'other', registers: ['provider-register'], reason: 'a fixture vendor nobody ports', nonPort: true }], files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ports-'));
  const w = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  w('tooling/ports/port.schema.json', JSON.stringify(SCHEMA));
  for (const [name, doc] of Object.entries(ports)) w(`tooling/ports/${name}.json`, JSON.stringify(doc, null, 2));
  w('tooling/ports/_non-port.json', JSON.stringify(nonPort(nonPortRows), null, 2));
  w('tooling/capability-register.json', JSON.stringify({ vendors: { _why: [], acme: { seam: { file: 'services/w/src/lib/contract.ts', symbol: 'WidgetPort' } } } }));
  w('tooling/legal/provider-register.json', JSON.stringify({ providers: [{ id: 'acme' }, { id: 'other' }] }));
  w('tooling/house-identity.json', JSON.stringify({ ownerDomain: { value: 'acme.test', why: 'fixture' } }));
  w('services/w/src/types.ts', 'export interface Env {\n  ACME_SECRET?: string;\n  OTHER: string;\n  CACHE?: KVNamespace;\n}\n');
  // limb 13's one reader, and limb 12's binding type in a permitted home (types.ts above): each
  // limb's pattern must still match SOMETHING, or it is coverage lost.
  w('services/_shared/src/geo.ts', 'export function requestGeo(req: Request) {\n  return (req as Request & { cf?: { colo?: string } }).cf?.colo;\n}\n');
  w('services/w/src/lib/contract.ts', 'export interface WidgetPort {\n  verify(): boolean;\n}\n');
  w('services/w/src/lib/acme.ts', "import type { WidgetPort } from './contract';\nexport const acmeVerifier: WidgetPort = { verify: () => true };\n");
  w('services/w/src/lib/fake.ts', "import type { WidgetPort } from './contract';\nexport const fakeWidget: WidgetPort = { verify: () => false };\n");
  w('services/w/src/registry.ts', "import { acmeVerifier } from './lib/acme';\nexport const ADAPTERS = [acmeVerifier];\n");
  w('services/w/src/index.ts', "import { ADAPTERS } from './registry';\nexport default ADAPTERS;\n");
  w('tooling/ops/monitor-api/glitchtip.mjs', "export const listMonitors = (o) => fetch(`${o.base}/api/0/organizations/${o.org}/monitors/`);\n");
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) rmSync(join(root, rel), { force: true });
    else w(rel, text);
  }
  return root;
}

describe('assert-ports — the schema validator reads port.schema.json', () => {
  it('green: the fixture registry validates', () => {
    assert.deepEqual(validate(port(), SCHEMA, SCHEMA), []);
  });
  it('red: an unknown key is refused (additionalProperties: false)', () => {
    const errs = validate(port({ vendorNotes: 'x' }), SCHEMA, SCHEMA);
    assert.ok(errs.some((e) => e.includes('unknown key `vendorNotes`')), errs.join('\n'));
  });
  it('red: an unknown key inside an adapter is refused too', () => {
    const errs = validate(port({ adapters: [adapter({ apiKey: 'x' })] }), SCHEMA, SCHEMA);
    assert.ok(errs.some((e) => e.includes('unknown key `apiKey`')), errs.join('\n'));
  });
  it('red: a secret-looking value is refused', () => {
    // Assembled at run time: a literal vendor-key shape here is itself what gitleaks
    // (stripe-access-token) refuses at the pre-commit hook, fixtures included.
    const doc = port({ _why: [`the key is ${['sk', 'live', 'Ab3dE5gH7jK9mN1pQ'].join('_')}`] });
    assert.ok(forbiddenValues(doc).length > 0);
    const jwt = port({ _why: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig'] });
    assert.ok(forbiddenValues(jwt).length > 0);
    const email = port({ _why: ['mail owner@example.com'] });
    assert.ok(forbiddenValues(email).some((f) => f.what.includes('e-mail')));
    assert.deepEqual(forbiddenValues(port()), [], 'the green registry carries none');
  });
  it('red: a secret NAME that is not a NAME is refused by the schema', () => {
    const errs = validate(port({ adapters: [adapter({ secrets: ['not a name'] })] }), SCHEMA, SCHEMA);
    assert.ok(errs.some((e) => e.includes('secrets[0]')), errs.join('\n'));
  });
  it('the validator refuses a keyword it does not implement rather than ignoring it', () => {
    const errs = validate('x', { type: 'string', format: 'email' });
    assert.ok(errs.some((e) => e.includes('keyword `format`')));
  });
});

describe('assert-ports — every limb reddens', () => {
  it('green control: the fixture passes, with the table and the printed waiver', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.first, /^assert-ports: ok/);
    assert.match(r.out, /widgets\s+L2\s+L2\s+L3/);
    assert.match(r.out, /hand table `export const ADAPTERS`/);
  });
  it('limb 1: an unknown key exits 1 and the first line names limb 1', () => {
    const r = run(fixture({ ports: { widgets: port({ extra: true }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 1 \(schema\)/);
  });
  it('limb 1: a secret-looking value exits 1', () => {
    const r = run(fixture({ ports: { widgets: port({ _why: ['pdl_live_apikey_01abcdefghijklmnop'] }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 1/);
  });
  it('limb 1: the file name must equal `port`', () => {
    const r = run(fixture({ ports: { gadgets: port() } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the port is the file name/);
  });
  it('limb 1: an EMPTY port set is COVERAGE LOST (exit 2), not a pass (vacuous-02)', () => {
    const root = fixture({ ports: {} });
    const r = run(root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /COVERAGE LOST — limb 1/);
  });
  it('the shape is READ from port.schema.json: tightening the schema file alone reddens limb 1', () => {
    const tight = structuredClone(SCHEMA);
    tight.properties.level.properties.claimed.maximum = 1;
    const r = run(fixture({ files: { 'tooling/ports/port.schema.json': JSON.stringify(tight) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 1 \(schema\).*level\.claimed: above 1/);
  });
  it('limb 1: an unreadable schema is exit 2', () => {
    const r = run(fixture({ files: { 'tooling/ports/port.schema.json': '{ not json' } }));
    assert.equal(r.code, 2, r.out);
  });
  it('limb 2: an interface symbol renamed in its file exits 1', () => {
    const r = run(fixture({ files: { 'services/w/src/lib/contract.ts': 'export interface GadgetPort {}\n' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 2 \(symbols\)/);
  });
  it('limb 2: a declaration that only survives in a comment is not one', () => {
    const r = run(fixture({ files: { 'services/w/src/lib/acme.ts': '// export const acmeVerifier = 1;\nexport {};\n' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /symbol `acmeVerifier` is not declared/);
  });
  it('limb 3: a handTables anchor that is gone exits 1', () => {
    const r = run(fixture({ files: { 'services/w/src/registry.ts': "import { acmeVerifier } from './lib/acme';\nexport const SET = [acmeVerifier];\n" } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 3 \(waivers\)/);
  });
  it('limb 3: `generated: true` before the render tool exists exits 1', () => {
    const r = run(fixture({ ports: { widgets: port({ generated: true }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /generated: true/);
  });
  it('limb 4: a route importing the adapter directly exits 1', () => {
    const r = run(fixture({ files: { 'services/w/src/routes/x.ts': "import { acmeVerifier } from '../lib/acme';\nexport const x = acmeVerifier;\n" } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 4 \(imports\).*services\/w\/src\/routes\/x\.ts/);
  });
  it('limb 2: an outbound symbol that is not declared exits 1', () => {
    const out = { file: 'services/w/src/lib/acme.ts', symbol: 'acmeRail', modules: [] };
    const r = run(fixture({ ports: { widgets: port({ adapters: [adapter({ outbound: out }), port().adapters[1]] }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /outbound symbol `acmeRail` is not declared/);
  });
  it('limb 4: a route importing an adapter\'s outbound MODULE exits 1; the adapter\'s own outbound file may', () => {
    const out = { file: 'services/w/src/lib/acme-rail.ts', symbol: 'acmeRail', modules: ['services/w/src/lib/acme-cancel.ts'] };
    const files = {
      'services/w/src/lib/acme-cancel.ts': 'export const cancelAcme = () => true;\n',
      'services/w/src/lib/acme-rail.ts': "import { cancelAcme } from './acme-cancel';\nexport const acmeRail = { cancel: cancelAcme };\n",
    };
    const ports = { widgets: port({ adapters: [adapter({ outbound: out }), port().adapters[1]] }) };
    const green = run(fixture({ ports, files }));
    assert.equal(green.code, 0, green.out);
    const red = run(fixture({ ports, files: { ...files, 'services/w/src/routes/y.ts': "import { cancelAcme } from '../lib/acme-cancel';\nexport const y = cancelAcme;\n" } }));
    assert.equal(red.code, 1, red.out);
    assert.match(red.first, /limb 4 \(imports\).*services\/w\/src\/routes\/y\.ts.*acme-cancel\.ts/);
  });
  it('limb 4: the same import from the composition root is allowed', () => {
    const r = run(fixture({ files: { 'services/w/src/ports.ts': "import { acmeVerifier } from './lib/acme';\nexport const portFor = () => acmeVerifier;\n" } }));
    assert.equal(r.code, 0, r.out);
  });
  it('limb 4: a test file importing the adapter is not a module of the Worker', () => {
    const r = run(fixture({ files: { 'services/w/test/acme.test.ts': "import { acmeVerifier } from '../src/lib/acme';\n" } }));
    assert.equal(r.code, 0, r.out);
  });
  it('limb 4: without its handTables waiver the hand registry itself is a finding', () => {
    const r = run(fixture({ ports: { widgets: port({ handTables: [] }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 4.*services\/w\/src\/registry\.ts/);
    assert.match(r.out, /widgets\s+L2\s+L1/, 'the earned level drops with it');
  });
  it('limb 5: a secret name nothing declares exits 1', () => {
    const r = run(fixture({ ports: { widgets: port({ adapters: [adapter({ secrets: ['NOT_DECLARED'] }), port().adapters[1]] }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 5 \(secrets\)/);
    assert.match(r.out, /manifest absent, read interface Env/);
  });
  it('limb 5: when the manifest exists, the manifest decides', () => {
    const r = run(fixture({ files: { 'tooling/worker-secrets.json': JSON.stringify({ rows: [{ name: 'SOMETHING_ELSE' }] }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no row of tooling\/worker-secrets\.json/);
  });
  it('limb 5: no interface Env anywhere is COVERAGE LOST', () => {
    // (a binding type stays in types.ts, so limb 12's own coverage holds and limb 5 is the one that decides)
    const r = run(fixture({ files: { 'services/w/src/types.ts': 'export type X = KVNamespace;\n' } }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /^assert-ports: COVERAGE LOST — limb 5 \(secrets\): no `interface Env` member/);
  });
  it('limb 6: a claim above the earned level exits 1, and the table says so', () => {
    const r = run(fixture({ ports: { widgets: port({ level: { claimed: 3, target: 3 } }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 6 \(level\).*claims L3 and earns L2/);
  });
  it('limb 6: L3 is earned by two adapters whose tests CALL the runner, and not by an import alone', () => {
    const suite = { file: 'services/w/test/conformance.ts', runner: 'runWidgetConformance' };
    const p3 = port({
      level: { claimed: 3, target: 3 },
      conformance: { suite, pending: [] },
      adapters: [adapter({ conformance: { file: 'services/w/test/acme.test.ts' } }), { ...port().adapters[1], conformance: { file: 'services/w/test/fake.test.ts' } }],
    });
    const files = {
      'services/w/test/conformance.ts': 'export function runWidgetConformance(a: unknown) { return a; }\n',
      'services/w/test/acme.test.ts': "import { runWidgetConformance } from './conformance';\nrunWidgetConformance(1);\n",
      'services/w/test/fake.test.ts': "import { runWidgetConformance } from './conformance';\nrunWidgetConformance(2);\n",
      'tooling/ops/port-switch.mjs': '// present\n',
    };
    const green = run(fixture({ ports: { widgets: p3 }, files }));
    assert.equal(green.code, 0, green.out);
    assert.match(green.out, /widgets\s+L3\s+L3/);
    const importOnly = run(fixture({ ports: { widgets: p3 }, files: { ...files, 'services/w/test/fake.test.ts': "import { runWidgetConformance } from './conformance';\nvoid runWidgetConformance;\n" } }));
    assert.equal(importOnly.code, 1, importOnly.out);
    assert.match(importOnly.first, /earns L2: 1 conformant adapter/);
    const pending = run(fixture({ ports: { widgets: { ...p3, conformance: { suite, pending: [{ adapter: 'fake', case: 'refuses a forged body', row: 'O-FIXTURE' }] } } }, files }));
    assert.equal(pending.code, 1, pending.out);
    assert.match(pending.out, /PENDING widgets\/fake: refuses a forged body \(O-FIXTURE\)/);
  });
  it('limb 7: a fake that lists live exits 1', () => {
    const fake = { ...port().adapters[1], environments: ['test', 'live'] };
    const r = run(fixture({ ports: { widgets: port({ adapters: [adapter(), fake] }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb 7 \(fakes\)/);
  });
  it('limb 7: a fake selected for live exits 1', () => {
    const r = run(fixture({ ports: { widgets: port({ selection: { by: 'single', source: null, default: { live: 'fake', sandbox: 'acme', test: 'fake' }, canary: null } }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /selection\.default\.live is the fake/);
  });
  it('limb 8: a vendor placed nowhere exits 1', () => {
    const r = run(fixture({ nonPortRows: [{ vendor: 'acme-not', registers: ['provider-register'], reason: 'a row for a vendor that is not there', nonPort: true }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /vendor `other` .* is no adapter's `vendor` and no tooling\/ports\/_non-port\.json row/);
  });
  it('limb 8: a vendor placed twice exits 1', () => {
    const r = run(fixture({ nonPortRows: [{ vendor: 'other', registers: ['provider-register'], reason: 'a fixture vendor nobody ports', nonPort: true }, { vendor: 'acme', registers: ['provider-register'], reason: 'placed twice on purpose here', until: 'port-x' }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /vendor `acme` is placed 2 times/);
  });
  it('limb 8: two adapters of ONE port may share a vendor (two boxes at one provider) — one placement, printed together', () => {
    const twin = port({ adapters: [adapter(), adapter({ id: 'acme-two' }), port().adapters[1]] });
    const r = run(fixture({ ports: { widgets: twin } }));
    assert.equal(r.code, 0, r.out);
    assert.equal(portLineFor(evaluate(fixture({ ports: { widgets: twin } })), 'acme'), 'port: widgets (adapter acme, acme-two, earned L2)');
  });
  it('limb 8: …but the same vendor behind adapters of TWO ports is still placed twice', () => {
    const other = port({ port: 'gadgets', adapters: [adapter({ id: 'acme-g' })], selection: { by: 'single', source: null, default: { live: 'acme-g', sandbox: 'acme-g', test: null }, canary: null }, handTables: [], switch: { runbook: 'Private/runbooks/switch-vendor.md#gadgets', dryRun: 'node tooling/ops/port-switch.mjs gadgets --to <adapter> --dry-run' } });
    const r = run(fixture({ ports: { widgets: port(), gadgets: other } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /vendor `acme` is placed 2 times \(gadgets\/acme-g, widgets\/acme\)/);
  });
  it('limb 8: a row with both `until` and `nonPort` exits 1', () => {
    const r = run(fixture({ nonPortRows: [{ vendor: 'other', registers: ['provider-register'], reason: 'a fixture vendor nobody ports', nonPort: true, until: 'port-x' }] }));
    assert.equal(r.code, 1, r.out);
  });
  it("limb 8: a ported vendor whose C-8 seam.file differs from its port's interface exits 1", () => {
    const r = run(fixture({ files: { 'tooling/capability-register.json': JSON.stringify({ vendors: { acme: { seam: { file: 'services/w/src/lib/elsewhere.ts', symbol: 'X' } } } }) } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb 8 .*C-8 seam\.file is `services\/w\/src\/lib\/elsewhere\.ts`/);
  });
  it('limb 8: …unless the adapter declares that EXACT divergence, which is then printed', () => {
    const cap = JSON.stringify({ vendors: { acme: { seam: { file: 'services/w/src/lib/elsewhere.ts', symbol: 'X' } } } });
    const declared = port({ adapters: [adapter({ c8Seam: { file: 'services/w/src/lib/elsewhere.ts', why: 'the client half is the C-8 seam today', until: 'port-x' } }), port().adapters[1]] });
    const r = run(fixture({ ports: { widgets: declared }, files: { 'tooling/capability-register.json': cap } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /C-8 seam is services\/w\/src\/lib\/elsewhere\.ts, not this port's interface — until port-x/);
    const stale = run(fixture({ ports: { widgets: declared } }));
    assert.equal(stale.code, 1, stale.out);
    assert.match(stale.out, /Remove the stale waiver/);
  });
  it('limb 1: a DRAFT adapter may be unbuilt (empty impl) and vendorless; anything else may not', () => {
    const draft = { ...adapter({ id: 'next', vendor: null, status: 'draft', impl: {} }) };
    const ok = run(fixture({ ports: { widgets: port({ adapters: [...port().adapters, draft] }) } }));
    assert.equal(ok.code, 0, ok.out);
    const built = run(fixture({ ports: { widgets: port({ adapters: [...port().adapters, { ...draft, status: 'built' }] }) } }));
    assert.equal(built.code, 1, built.out);
    assert.match(built.first, /limb 1 \(schema\).*adapter `next` has vendor null but is not a fake and names no `channel`/);
    const half = run(fixture({ ports: { widgets: port({ adapters: [...port().adapters, { ...draft, impl: { file: 'services/w/src/lib/next.ts' } }] }) } }));
    assert.equal(half.code, 1, half.out);
    assert.match(half.out, /impl must be \{file, symbol\}, or \{\} while unbuilt/);
  });
  it('limb 8: ONE vendor may be the adapter of SEVERAL ports, with a non-port row for what is LEFT', () => {
    const gizmos = port({
      port: 'gizmos',
      handTables: [],
      adapters: [adapter({ id: 'acme-gizmo', impl: { file: 'services/w/src/lib/gizmo.ts', symbol: 'acmeGizmo' } }), port().adapters[1]],
      selection: { by: 'single', source: null, default: { live: 'acme-gizmo', sandbox: 'acme-gizmo', test: 'fake' }, canary: null },
    });
    const files = { 'services/w/src/lib/gizmo.ts': "import type { WidgetPort } from './contract';\nexport const acmeGizmo: WidgetPort = { verify: () => true };\n" };
    const rest = { vendor: 'acme', registers: ['provider-register'], reason: 'the rest of acme waits for its own train', until: 'port-x', remaining: ['the sql binding'] };
    const nonPortRows = [{ vendor: 'other', registers: ['provider-register'], reason: 'a fixture vendor nobody ports', nonPort: true }, rest];
    const ok = run(fixture({ ports: { widgets: port(), gizmos }, nonPortRows, files }));
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /vendor acme is the adapter of gizmos, widgets; what is left \(the sql binding\) until port-x/);
    assert.equal(portLineFor(evaluate(fixture({ ports: { widgets: port(), gizmos }, nonPortRows, files })), 'acme'),
      'port: gizmos (adapter acme-gizmo, earned L2); widgets (adapter acme, earned L2) — the rest (the sql binding) none yet, until port-x');
    // red: the same row without `remaining` is a vendor placed three times
    const { remaining: _r, ...bare } = rest;
    const noRest = run(fixture({ ports: { widgets: port(), gizmos }, nonPortRows: [nonPortRows[0], bare], files }));
    assert.equal(noRest.code, 1, noRest.out);
    assert.match(noRest.first, /limb 8 \(cross-register\): vendor `acme` is placed 3 times .*must name what is LEFT/);
    // red: `remaining` on a vendor no port has an adapter for
    const stale = run(fixture({ nonPortRows: [{ ...nonPortRows[0], nonPort: undefined, until: 'port-x', remaining: ['x'] }].map(({ nonPort: _n, ...r }) => r) }));
    assert.equal(stale.code, 1, stale.out);
    assert.match(stale.out, /row `other` names `remaining` surfaces, but `other` is no adapter of any port/);
  });
  it('limb 12: a handler typed with a Cloudflare binding type exits 1 and the first line names limb 12', () => {
    const r = run(fixture({ files: { 'services/w/src/routes/h.ts': 'export async function h(kv: KVNamespace) {\n  return kv.get("k");\n}\n' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 12 \(bindings\): `services\/w\/src\/routes\/h\.ts` names the Cloudflare binding type `KVNamespace`/);
    for (const t of ['R2Bucket', 'R2Objects', 'RateLimit', 'D1Database', 'D1PreparedStatement', 'D1Result']) {
      const x = run(fixture({ files: { 'services/w/src/routes/h.ts': `export const h = (b: ${t}) => b;\n` } }));
      assert.equal(x.code, 1, `${t}: ${x.out}`);
      assert.match(x.first, new RegExp(`limb 12 .*\`${t}\``));
    }
  });
  it('limb 12: the composition root, a types.ts and services/_shared/src/ports/ may name it; a comment or a string is not a type', () => {
    for (const rel of ['services/w/src/ports.ts', 'services/_shared/src/ports/adapters/cf.ts', 'services/v/src/types.ts']) {
      const r = run(fixture({ files: { [rel]: 'export const adapt = (b: KVNamespace) => b;\n' } }));
      assert.equal(r.code, 0, `${rel}: ${r.out}`);
    }
    const prose = run(fixture({ files: { 'services/w/src/routes/h.ts': '// never a KVNamespace or a D1Database here\nexport const why = "not an R2Bucket";\nexport const withinRateLimit = 1;\nexport const dumpD1Database = (db: SqlDb) => db;\n' } }));
    assert.equal(prose.code, 0, prose.out);
  });
  it('limb 12: a pattern that matches NOTHING in the tree is COVERAGE LOST (exit 2)', () => {
    const r = run(fixture({ files: { 'services/w/src/types.ts': 'export interface Env {\n  ACME_SECRET?: string;\n  OTHER: string;\n}\n' } }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /COVERAGE LOST — limb 12 \(bindings\): the binding-type pattern matched nothing/);
  });
  it('limb 13: a `.cf` read outside geo.ts exits 1 — dot, optional chain, bracket and destructuring alike', () => {
    for (const body of [
      'export const c = (r: Request) => (r as any).cf?.colo;\n',
      'export const c = (r: any) => r?.cf;\n',
      "export const c = (r: any) => r['cf'];\n",
      'export function c(r: any) {\n  const { cf } = r;\n  return cf;\n}\n',
      'export type G = IncomingRequestCfProperties;\n',
    ]) {
      const r = run(fixture({ files: { 'services/w/src/routes/e.ts': body } }));
      assert.equal(r.code, 1, `${body}${r.out}`);
      assert.match(r.first, /limb 13 \(geo\): `services\/w\/src\/routes\/e\.ts` reads the runtime's `cf` object/);
    }
  });
  it("limb 13: prose about request.cf, a 'cf-' header and a cf-named local are not reads", () => {
    const r = run(fixture({ files: { 'services/w/src/routes/e.ts': "// keyed on request.cf\nexport const h = (n: string) => n.startsWith('cf-') || n === 'x.cf';\nexport const cf = 1;\n" } }));
    assert.equal(r.code, 0, r.out);
  });
  it('limb 13: geo.ts gone (or no longer reading cf) is COVERAGE LOST (exit 2)', () => {
    const gone = run(fixture({ files: { 'services/_shared/src/geo.ts': null } }));
    assert.equal(gone.code, 2, gone.out);
    assert.match(gone.first, /COVERAGE LOST — limb 13 \(geo\): services\/_shared\/src\/geo\.ts was not walked/);
    const blind = run(fixture({ files: { 'services/_shared/src/geo.ts': 'export const requestGeo = () => ({});\n' } }));
    assert.equal(blind.code, 2, blind.out);
    assert.match(blind.first, /no longer matches the `\.cf` pattern/);
  });
  it('the exported reader gives C-8 its one line per vendor', () => {
    const r = evaluate(fixture());
    assert.equal(portLineFor(r, 'acme'), 'port: widgets (adapter acme, earned L2)');
    assert.equal(portLineFor(r, 'other'), 'port: none — deliberately not ported');
    assert.equal(portLineFor(r, 'nobody'), 'port: UNPLACED (assert-ports limb 8)');
  });
  it('limb 1: an adapter with no environment must be draft or retired', () => {
    const doc = port({ adapters: [adapter(), adapter({ id: 'second', status: 'built', environments: [] }), port().adapters[1]] });
    const r = run(fixture({ ports: { widgets: doc } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 1 .*adapter `second` lists no environment but is built/);
    const draft = port({ adapters: [adapter(), adapter({ id: 'second', status: 'draft', environments: [] }), port().adapters[1]] });
    assert.equal(run(fixture({ ports: { widgets: draft } })).code, 0);
  });
  it('limb 1: a stream names an adapter of the port, and only secrets that adapter declares', () => {
    const streams = (st) => port({ selection: { by: 'stream', source: null, default: { live: 'acme', sandbox: 'acme', test: 'fake' }, canary: null }, streams: st });
    assert.equal(run(fixture({ ports: { widgets: streams({ a: { adapter: 'acme', secrets: ['ACME_SECRET'], from: null, why: 'a fixture stream on acme' } }) } })).code, 0);
    const noAdapter = run(fixture({ ports: { widgets: streams({ a: { adapter: 'nope', secrets: [], from: null, why: 'a fixture stream on nothing' } }) } }));
    assert.match(noAdapter.first, /limb 1 .*stream `a` names adapter `nope`/);
    const badSecret = run(fixture({ ports: { widgets: streams({ a: { adapter: 'acme', secrets: ['OTHER'], from: null, why: 'a fixture stream with a stray key' } }) } }));
    assert.match(badSecret.first, /limb 1 .*stream `a` takes secret `OTHER`, which its adapter `acme` does not declare/);
    const missing = run(fixture({ ports: { widgets: port({ selection: { by: 'stream', source: null, default: { live: 'acme', sandbox: 'acme', test: 'fake' }, canary: null } }) } }));
    assert.match(missing.first, /limb 1 .*selected by stream but declares no `streams`/);
  });
  it('limb 1: a per-call port has features, each on an adapter of the port, with priced candidates and a model among them', () => {
    const price = { inputUsdPerMTok: 1, outputUsdPerMTok: 5, cacheReadUsdPerMTok: 0.1, cacheWriteUsdPerMTok: 1.25, asOf: '2026-10-02', source: 'https://example.invalid/pricing', verify: 'a fixture price' };
    const perCall = (features, models = { 'm-1': price }) => port({
      adapters: [adapter({ cost: { feeCells: [], unit: null, models } }), port().adapters[1]],
      selection: { by: 'per-call', source: null, default: { live: 'acme', sandbox: 'acme', test: 'fake' }, canary: null },
      ...(features ? { features } : {}),
    });
    const feature = (over = {}) => ({ adapter: 'acme', model: null, effort: null, maxInputTokens: 8000, candidates: ['m-1'], tokensPerCall: null, why: 'a fixture feature on acme', ...over });
    assert.equal(run(fixture({ ports: { widgets: perCall({ f: feature() }) } })).code, 0);
    assert.equal(run(fixture({ ports: { widgets: perCall({ f: feature({ maxInputTokens: null }) }) } })).code, 0, 'no cap is allowed: every call for the feature is refused');
    assert.match(run(fixture({ ports: { widgets: perCall({ f: feature({ maxInputTokens: undefined }) }) } })).first, /limb 1 .*missing required `maxInputTokens`/);
    // A fallback is billable, so it is priced by the same adapter (review 1 of #1136).
    assert.equal(run(fixture({ ports: { widgets: perCall({ f: feature() }, { 'm-1': { ...price, fallbacks: ['m-2'] }, 'm-2': price }) } })).code, 0);
    assert.match(run(fixture({ ports: { widgets: perCall({ f: feature() }, { 'm-1': { ...price, fallbacks: ['m-2'] } }) } })).first, /limb 1 .*model `m-1` falls back to `m-2`, which it does not price/);
    assert.equal(run(fixture({ ports: { widgets: perCall({ f: feature({ model: 'm-1' }) }) } })).code, 0);
    assert.match(run(fixture({ ports: { widgets: perCall(null) } })).first, /limb 1 .*selected per call and prices models but declares no `features`/);
    // A per-call port that prices no model (channels: the channel picks the submitter) needs no features.
    assert.equal(run(fixture({ ports: { widgets: perCall(null, {}) } })).code, 0);
    assert.match(run(fixture({ ports: { widgets: perCall({ f: feature({ adapter: 'nope' }) }) } })).first, /limb 1 .*feature `f` names adapter `nope`/);
    assert.match(run(fixture({ ports: { widgets: perCall({ f: feature({ candidates: ['m-2'] }) }) } })).first, /limb 1 .*feature `f` lists candidate `m-2`, which adapter `acme` does not price/);
    assert.match(run(fixture({ ports: { widgets: perCall({ f: feature({ model: 'm-9' }) }) } })).first, /limb 1 .*feature `f` runs on `m-9`, which is not one of its candidates/);
  });
  it('limb 6: a Dart adapter is graded against the clientSuite, never the TS runner', () => {
    const dart = (id) => adapter({ id, vendor: 'acme', status: 'built', impl: { file: 'services/w/src/lib/acme.ts', symbol: 'acmeVerifier' }, secrets: [], conformance: { file: `packages/p/test/${id}_test.dart` } });
    const doc = port({
      level: { claimed: 3, target: 3 },
      adapters: [dart('acme'), dart('acme-two'), port().adapters[1]],
      conformance: { suite: { file: 'services/w/test/suite.ts', runner: 'runWidgetConformance' }, clientSuite: { file: 'packages/p/lib/suite.dart', runner: 'runWidgetProviderConformance' }, pending: [] },
    });
    const files = {
      'services/w/test/suite.ts': 'export function runWidgetConformance(s: unknown) { return s; }\n',
      'packages/p/lib/suite.dart': 'void runWidgetProviderConformance(Object s) {}\n',
      'tooling/ops/port-switch.mjs': '// the dry-run tool\n',
    };
    const calls = (runner) => ({ 'packages/p/test/acme_test.dart': `void main() { ${runner}('acme'); }\n`, 'packages/p/test/acme-two_test.dart': `void main() { ${runner}('two'); }\n` });
    const green = run(fixture({ ports: { widgets: doc }, files: { ...files, ...calls('runWidgetProviderConformance') } }));
    assert.equal(green.code, 0, green.out);
    assert.match(green.out, /widgets\s+L3\s+L3\s+L3/);
    // The same Dart tests calling the TS runner's NAME earn nothing: a Dart test cannot call a TS runner.
    const red = run(fixture({ ports: { widgets: doc }, files: { ...files, ...calls('runWidgetConformance') } }));
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /widgets\s+L3\s+L2/);
  });
  it('limb 8: one vendor behind two adapters of ONE port is placed once; in two ports, twice', () => {
    const two = port({ adapters: [adapter(), adapter({ id: 'acme-smtp', status: 'external', impl: { configAt: 'box env ACME_*', verify: 'node verify.mjs' }, secrets: [] }), port().adapters[1]] });
    assert.equal(run(fixture({ ports: { widgets: two } })).code, 0);
    const other = port({ port: 'gadgets', handTables: [], switch: { runbook: null, dryRun: 'node tooling/ops/port-switch.mjs gadgets --to <adapter> --dry-run' }, level: { claimed: 0, target: 3 } });
    const r = run(fixture({ ports: { widgets: port(), gadgets: other } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /vendor `acme` is placed 2 times \(gadgets\/acme, widgets\/acme\)/);
  });
  it('limb 9: an owner-domain address literal in Worker source exits 1 — a subdomain too; a comment or src/generated/ does not', () => {
    const lit = run(fixture({ files: { 'services/w/src/index.ts': "import { ADAPTERS } from './registry';\nexport const TO = 'ops@acme.test';\nexport default ADAPTERS;\n" } }));
    assert.equal(lit.code, 1, lit.out);
    assert.match(lit.first, /limb 9 \(literals\): services\/w\/src\/index\.ts:2 carries an address on acme\.test/);
    const sub = run(fixture({ files: { 'services/w/src/index.ts': "import { ADAPTERS } from './registry';\nexport const FROM = 'X <alerts@mail.acme.test>';\nexport default ADAPTERS;\n" } }));
    assert.match(sub.first, /limb 9 .*index\.ts:2/);
    const prose = run(fixture({ files: { 'services/w/src/index.ts': "import { ADAPTERS } from './registry';\n// mails ops@acme.test\nexport default ADAPTERS;\n" } }));
    assert.equal(prose.code, 0, prose.out);
    const gen = run(fixture({ files: { 'services/w/src/generated/entity.ts': "export const TO = 'ops@acme.test';\n" } }));
    assert.equal(gen.code, 0, gen.out);
    const otherDomain = run(fixture({ files: { 'services/w/src/index.ts': "import { ADAPTERS } from './registry';\nexport const TO = 'ops@example.test';\nexport default ADAPTERS;\n" } }));
    assert.equal(otherDomain.code, 0, otherDomain.out);
  });
  it('limb 9: no entity source is COVERAGE LOST (exit 2), never a pass', () => {
    const r = run(fixture({ files: { 'tooling/house-identity.json': null } }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.first, /COVERAGE LOST — limb 9/);
  });
  it('limb 9: a stream `from` path the entity source does not hold exits 1', () => {
    const doc = port({ selection: { by: 'stream', source: null, default: { live: 'acme', sandbox: 'acme', test: 'fake' }, canary: null }, streams: { a: { adapter: 'acme', secrets: [], from: 'mail.from.a', why: 'a fixture stream with a sender' } } });
    const r = run(fixture({ ports: { widgets: doc } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb 9 .*stream `a` from path `mail\.from\.a` resolves to no value/);
  });
  it('callsRunner matches a CALL, never the declaring file or a bare name', () => {
    assert.equal(callsRunner('runX(adapter);', 'runX', '.ts'), true);
    assert.equal(callsRunner('import { runX } from "./s";', 'runX', '.ts'), false);
    assert.equal(callsRunner('export function runX() {}\nrunX();', 'runX', '.ts'), false);
    assert.equal(callsRunner('  runXConformance(a);', 'runX', '.dart'), false);
  });
});

describe('assert-ports — a port with two interfaces, graded apart (level.byInterface)', () => {
  // A ts half (acme + fake) and a dart half (dacme + dfake), sharing vendor acme.
  const dartAdapter = (over = {}) => adapter({ id: 'dacme', impl: { file: 'packages/w/lib/dacme.dart', symbol: 'DacmeClient' }, secrets: [], ...over });
  const twoHalves = (over = {}) => port({
    level: { claimed: 2, target: 3, byInterface: { ts: { claimed: 2, target: 3 }, dart: { claimed: 2, target: 3 } } },
    interface: { ts: { file: 'services/w/src/lib/contract.ts', symbols: ['WidgetPort'] }, dart: { file: 'packages/w/lib/widget.dart', symbols: ['WidgetClient'] } },
    adapters: [...port().adapters, dartAdapter(), dartAdapter({ id: 'dfake', vendor: null, status: 'fake', impl: { file: 'packages/w/lib/dfake.dart', symbol: 'DfakeClient' }, environments: ['test'] })],
    ...over,
  });
  const dartFiles = {
    'packages/w/lib/widget.dart': 'abstract class WidgetClient {\n  void send();\n}\n',
    'packages/w/lib/dacme.dart': 'class DacmeClient implements WidgetClient {\n  void send() {}\n}\n',
    'packages/w/lib/dfake.dart': 'class DfakeClient implements WidgetClient {\n  void send() {}\n}\n',
    'packages/w/lib/testing.dart': 'void runWidgetConformance(String name) {}\n',
    'packages/w/test/dacme_test.dart': "void main() {\n  runWidgetConformance('dacme');\n}\n",
    'packages/w/test/dfake_test.dart': "void main() {\n  runWidgetConformance('dfake');\n}\n",
    'tooling/ops/port-switch.mjs': '// present\n',
  };
  const conformant = (claimDart = 3) => twoHalves({
    level: { claimed: 2, target: 3, byInterface: { ts: { claimed: 2, target: 3 }, dart: { claimed: claimDart, target: 3 } } },
    adapters: twoHalves().adapters.map((a) => (a.id === 'dacme' ? { ...a, conformance: { file: 'packages/w/test/dacme_test.dart' } } : a.id === 'dfake' ? { ...a, conformance: { file: 'packages/w/test/dfake_test.dart' } } : a)),
    conformance: { suite: { file: 'packages/w/lib/testing.dart', runner: 'runWidgetConformance' }, pending: [] },
  });

  it('green control: each half is graded over its own adapters, and one vendor backs both halves of ONE port', () => {
    const r = run(fixture({ ports: { widgets: conformant() }, files: dartFiles }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^widgets\.dart\s+L3\s+L3\s+L3/m);
    assert.match(r.out, /^widgets\.ts\s+L2\s+L2\s+L3\s+\(below target: no conformance suite for the ts interface/m);
    assert.match(r.out, /^widgets\s+L2\s+L2\s+L3/m);
  });
  it('red: the dart half claims L3 while only ONE dart adapter calls the runner', () => {
    const one = conformant();
    one.adapters = one.adapters.map((a) => (a.id === 'dfake' ? { ...a, conformance: null } : a));
    const r = run(fixture({ ports: { widgets: one }, files: dartFiles }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 6 \(level\): tooling\/ports\/widgets\.json claims L3 for its dart interface and earns L2: 1 conformant adapter/);
  });
  it('red: a ts adapter calling the DART runner does not count toward the ts half', () => {
    const doc = conformant();
    doc.level.byInterface.ts.claimed = 3;
    doc.adapters = doc.adapters.map((a) => (a.id === 'acme' || a.id === 'fake' ? { ...a, conformance: { file: 'packages/w/test/dacme_test.dart' } } : a));
    const r = run(fixture({ ports: { widgets: doc }, files: dartFiles }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /claims L3 for its ts interface and earns L2: no conformance suite for the ts interface/);
  });
  it('red: the port-level claim must be the weakest interface\'s', () => {
    const doc = conformant();
    doc.level.claimed = 3;
    const r = run(fixture({ ports: { widgets: doc }, files: dartFiles }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /level\.claimed is L3, and its weakest interface claims L2/);
  });
  it('red: byInterface must grade exactly the declared interfaces', () => {
    const doc = conformant();
    delete doc.level.byInterface.ts;
    const r = run(fixture({ ports: { widgets: doc }, files: dartFiles }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 1 \(schema\): tooling\/ports\/widgets\.json level\.byInterface grades \["dart"\]/);
  });
  it('red: a per-interface selection naming the other half\'s adapter is refused', () => {
    const doc = conformant();
    doc.selection.byInterface = { ts: { by: 'single', source: null, default: { live: 'dacme', sandbox: null, test: null }, canary: null } };
    const r = run(fixture({ ports: { widgets: doc }, files: dartFiles }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /selection\.byInterface\.ts\.default\.live names `dacme`, which is not a ts adapter/);
  });
  it('red: a per-interface selection of a FAKE in live reddens limb 7', () => {
    const doc = conformant();
    doc.selection.byInterface = { ts: { by: 'single', source: null, default: { live: 'fake', sandbox: null, test: null }, canary: null } };
    const r = run(fixture({ ports: { widgets: doc }, files: dartFiles }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /limb 7 \(fakes\) tooling\/ports\/widgets\.json selection\.byInterface\.ts\.default\.live is the fake `fake`/);
  });
  it('red: one vendor in TWO ports is still placed twice (limb 8)', () => {
    const second = port({ port: 'gadgets', switch: { runbook: 'Private/runbooks/switch-vendor.md#gadgets', dryRun: 'node tooling/ops/port-switch.mjs gadgets --to <adapter> --dry-run' }, handTables: [] });
    const r = run(fixture({ ports: { widgets: port(), gadgets: second } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /vendor `acme` is placed 2 times \((gadgets\/acme, widgets\/acme|widgets\/acme, gadgets\/acme)\)/);
  });
  it('a DRAFT adapter whose vendor is placed elsewhere is not a second placement, and is printed; alone it places its vendor in its own port', () => {
    const doc = port({ adapters: [...port().adapters, adapter({ id: 'later', vendor: 'other', status: 'draft', impl: { file: 'services/w/src/lib/fake.ts', symbol: 'fakeWidget' }, secrets: [] })] });
    const ok = run(fixture({ ports: { widgets: doc } }));
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /widgets\/later: draft adapter of vendor other, placed at _non-port until it is built/);
    // A draft of a vendor its OWN port already places is that one placement (mail's ses on the real tree
    // is the case nothing else places: it places amazon-ses in mail, and the real-tree green control holds it).
    const own = port({ adapters: [...port().adapters, adapter({ id: 'later', status: 'draft', impl: { file: 'services/w/src/lib/fake.ts', symbol: 'fakeWidget' }, secrets: [] })] });
    const alone = run(fixture({ ports: { widgets: own } }));
    assert.equal(alone.code, 0, alone.out);
    assert.doesNotMatch(alone.out, /draft adapter of vendor acme/);
    // …and a BUILT adapter beside the _non-port row is still two placements: the rule is for drafts only.
    const built = port({ adapters: [...port().adapters, adapter({ id: 'later', vendor: 'other', status: 'built', impl: { file: 'services/w/src/lib/fake.ts', symbol: 'fakeWidget' }, secrets: [] })] });
    const twice = run(fixture({ ports: { widgets: built } }));
    assert.equal(twice.code, 1, twice.out);
    assert.match(twice.out, /vendor `other` is placed 2 times/);
  });

});

describe('assert-ports — limb 11, the monitor API', () => {
  it('green control: the adapter calls the monitor API and nothing else does', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /limb 11 scanned 0 ops script\(s\)/);
  });
  it('red: an ops script with its own fetch of a monitor route reddens limb 11', () => {
    const r = run(fixture({ files: { 'tooling/ops/rogue.mjs': "await fetch(`${BASE}/api/0/organizations/${ORG}/monitors/`, { headers: {} });\n" } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 11 \(monitor-api\): tooling\/ops\/rogue\.mjs calls GlitchTip's monitor API directly/);
  });
  it('red: composing the route away from the call is still a direct call', () => {
    const src = "const path = `organizations/${ORG}/monitors/`;\nasync function api(p) { return fetch(`${BASE}/api/0/${p}`); }\nawait api(path);\n";
    const r = run(fixture({ files: { 'tooling/ops/rogue.mjs': src } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /rogue\.mjs calls GlitchTip's monitor API directly/);
  });
  it('a mention in a comment, or a route string with no fetch, is not a call', () => {
    const r = run(fixture({ files: { 'tooling/ops/doc.mjs': "// fetch(`${BASE}/api/0/organizations/o/monitors/`)\nexport const route = 'monitors/';\n" } }));
    assert.equal(r.code, 0, r.out);
  });
  it('COVERAGE LOST: the adapter gone, or no longer matched, is exit 2', () => {
    const gone = run(fixture({ files: { 'tooling/ops/monitor-api/glitchtip.mjs': null } }));
    assert.equal(gone.code, 2, gone.out);
    assert.match(gone.first, /COVERAGE LOST — limb 11 \(monitor-api\)/);
    const blind = run(fixture({ files: { 'tooling/ops/monitor-api/glitchtip.mjs': 'export const x = 1;\n' } }));
    assert.equal(blind.code, 2, blind.out);
    assert.match(blind.out, /the matcher has broken/);
  });
});

describe('assert-ports — on a copy of the REAL registries', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ports-real-'));
    const copy = (rel) => { if (existsSync(join(REPO, rel))) cpSync(join(REPO, rel), join(root, rel), { recursive: true }); };
    for (const rel of ['tooling/ports', 'tooling/capability-register.json', 'tooling/legal/provider-register.json', 'tooling/channel-register.json', 'tooling/house-identity.json', 'tooling/ops/port-switch.mjs',
      'tooling/catalog/fee-register.json', 'services', 'packages/core/lib', 'packages/auth_supabase/lib', 'packages/telemetry/lib', 'packages/telemetry/test', 'tooling/ops', 'packages/api_client/lib', 'packages/api_client/test', 'apps/subscriptiontracker/lib/state/providers/auth.dart',
      // port-pay-client: the client half's seams, adapters and conformance tests (limb 10).
      'packages/purchases/lib', 'packages/purchases/test/conformance', 'packages/billing_revenuecat/lib', 'packages/billing_revenuecat/test/revenuecat_bridge_conformance_test.dart',
      // the channels port: the contract, its submitters and the conformance file that calls the runner
      'tooling/release', 'extensions/scripts/publish-cws.mjs', 'extensions/scripts/publish-edge.mjs', 'extensions/scripts/publish-amo.mjs',
      // the boxes port: the declarations and the module that reads them (port-boxes)
      'tooling/boxes', 'tooling/ops/box-declaration.mjs', 'tooling/ops/check-box-declared.mjs',
      // port-auth: the Dart half's two conformance tests (the fake and the GoTrue adapter)
      'packages/core/test/fake_auth_repository_conformance_test.dart', 'packages/auth_supabase/test/supabase_auth_conformance_test.dart',
      // port-auth: the site's pages and its one identity client (limb 4's site half)
      'sites/nikatru/js', 'sites/nikatru/app', 'sites/nikatru/ext',
      // port-codehost: the register the code-host names render from, and the rendered script module
      'tooling/github-org.json', 'tooling/generated']) copy(rel);
    rmSync(join(root, 'services', 'platform', 'node_modules'), { recursive: true, force: true });
  });
  it('green control: payments, mail and ai claim and earn L3; auth, telemetry and boxes claim and earn L2; channels claims L2 and earns L3', () => {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /payments\s+L3\s+L3\s+L3/);
    assert.match(r.out, /mail\s+L3\s+L3\s+L3/);
    for (const p of ['auth', 'boxes', 'telemetry', 'telemetry\\.ts']) assert.match(r.out, new RegExp(`^${p}\\s+L2\\s+L2\\s+L3`, 'm'));
    assert.match(r.out, /^telemetry\.dart\s+L3\s+L3\s+L3/m); // port-telemetry: the Dart half graded apart
    assert.match(r.out, /^auth\.dart\s+L3\s+L3\s+L3/m); // port-auth: the suite passes for the fake and the GoTrue adapter
    assert.match(r.out, /^codehost\s+L2\s+L2\s+L2/m); // port-codehost: the names are config, rendered
    assert.match(r.out, /codehost\/github: C-8 seam is services\/platform\/src\/scheduled\.ts, not this port's interface — until codehost-forge-exit/);
    assert.match(r.out, /^auth\.ts\s+L2\s+L2\s+L3/m); // port-auth: IdentityAdmin, one built adapter and a fake
    assert.match(r.out, /limb 4 \(URL half\): identity-provider URLs built only in 1 auth adapter/);
    assert.match(r.out, /identity URL: services\/edge-shield\/src\/classify\.ts names `\/auth\/v1`/);
    for (const p of ['kv', 'objects', 'ratelimit']) assert.match(r.out, new RegExp(`^${p}\\s+L2\\s+L2\\s+L2`, 'm')); // port-storage
    assert.match(r.out, /^sql\s+L2\s+L2\s+L3/m); // port-sql
    assert.match(r.out, /vendor cloudflare is the adapter of kv, objects, ratelimit, sql; what is left \(Workers, Pages, the nikatru\.com zone\)/);
    // port-sql: the D1 adapter's scenarios are named as pending, never hidden.
    assert.match(r.out, /PENDING sql\/d1: batch-is-atomic/);
    assert.match(r.out, /limb 3: services\/platform\/src\/generated\/ports\.ts matches tooling\/ports\/payments\.json/);
    assert.match(r.out, /PENDING payments\/revenuecat: refund reversed or dispute won restores \(O-REVENUECAT-VERIFIER\)/);
    assert.match(r.out, /ai\s+L3\s+L3\s+L3/);
    assert.match(r.out, /payments\/client\s+L3\s+L3\s+L3/);
    assert.match(r.out, /limb 10: payments\/client — PurchaseRail 3 conformant, IapBridge 2 conformant/);
    assert.match(r.out, /channels\s+L2\s+L3\s+L3/);
    assert.match(r.out, /CANDIDATE channels\/indus-appstore \(Indus Appstore\): not submittable — \[ADR 076\] rider; commission UNREAD/);
  });
  it('red: a REAL handler re-typed D1Database reddens limb 12 (lib/erasure-ledger.ts)', () => {
    const rel = join(root, 'services/platform/src/lib/erasure-ledger.ts');
    const before = readFileSync(rel, 'utf8');
    try {
      assert.match(before, /clearPendingErasure\(db: SqlDb,/, 'the seam this mutation flips is still there');
      writeFileSync(rel, before.replace('clearPendingErasure(db: SqlDb,', 'clearPendingErasure(db: D1Database,'));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 12 \(bindings\): `services\/platform\/src\/lib\/erasure-ledger\.ts` names the Cloudflare binding type `D1Database`/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: sql claiming L3 while D1 has pending scenarios reddens limb 6', () => {
    const rel = join(root, 'tooling/ports/sql.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.level.claimed = 3;
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 6 \(level\): tooling\/ports\/sql\.json claims L3 and earns L2: 1 conformant adapter\(s\)/);
    } finally { writeFileSync(rel, before); }
  });
  // port-pay-client · MUTATE THE REAL TREE: RevenueCat's conformance test that imports the suite
  // but never CALLS the runner reddens limb 10, and the client half falls to L2 (IapBridge has one).
  it('red: the RevenueCat bridge test importing the suite but never calling it reddens limb 10', () => {
    const rel = join(root, 'packages/billing_revenuecat/test/revenuecat_bridge_conformance_test.dart');
    const before = readFileSync(rel, 'utf8');
    try {
      // The call becomes a tear-off: the name stays, the suite never runs.
      const after = before.replace(/^( *)runIapBridgeConformance\(/m, '$1final Object never = runIapBridgeConformance;\n$1(');
      assert.notEqual(after, before, 'the mutation must land');
      writeFileSync(rel, after);
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 10 \(client\).*`revenuecat-bridge`.*never CALLS `runIapBridgeConformance`/);
      assert.match(r.out, /payments\/client\s+L3\s+L2/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a hand edit of the rendered Dart rail map reddens limb 3', () => {
    const rel = join(root, 'packages/purchases/lib/src/generated/rails.dart');
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, before.replace("  'windows-direct': 'hosted',", "  'windows-direct': 'none',"));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 3 \(waivers\): render --check: .*packages\/purchases\/lib\/src\/generated\/rails\.dart differs from its render/);
    } finally { writeFileSync(rel, before); }
  });
  const mutate = (rel, fn, check) => {
    const abs = join(root, rel);
    const before = readFileSync(abs, 'utf8');
    try {
      writeFileSync(abs, fn(before));
      check(run(root));
    } finally { writeFileSync(abs, before); }
  };
  it('red: lib/reminders.ts importing the Resend adapter reddens limb 4, and mail earns L1', () => {
    mutate('services/platform/src/lib/reminders.ts', (s) => `import { createResendMail } from '../adapters/mail/resend';\nexport const _ADAPTER = createResendMail;\n${s}`, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 4 \(imports\): tooling\/ports\/mail\.json: `services\/platform\/src\/lib\/reminders\.ts` imports the adapter `services\/platform\/src\/adapters\/mail\/resend\.ts`/);
      assert.match(r.out, /mail\s+L3\s+L1/);
    });
  });
  it('red: the mail fake selected for live reddens limb 7', () => {
    mutate('tooling/ports/mail.json', (s) => { const d = JSON.parse(s); d.selection.default.live = 'fake'; return JSON.stringify(d); }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /FAIL limb 7 \(fakes\) tooling\/ports\/mail\.json selection\.default\.live is the fake `fake`/);
    });
  });
  it('🔴 red: the AI stub listed for live reddens limb 7, and ai falls below its L3 claim', () => {
    mutate('tooling/ports/ai.json', (s) => { const d = JSON.parse(s); d.adapters.find((a) => a.id === 'stub').environments.push('live'); return JSON.stringify(d); }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /FAIL limb 7 \(fakes\) tooling\/ports\/ai\.json fake `stub` lists the `live` environment/);
      assert.match(r.out, /ai\s+L3\s+L1/);
    });
  });
  it('red: the AI stub selected for live reddens limb 7', () => {
    mutate('tooling/ports/ai.json', (s) => { const d = JSON.parse(s); d.selection.default.live = 'stub'; return JSON.stringify(d); }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /FAIL limb 7 \(fakes\) tooling\/ports\/ai\.json selection\.default\.live is the fake `stub`/);
    });
  });
  it('🔴 red: a route that builds an identity-provider URL itself reddens limb 4, and auth falls to L1 (port-auth)', () => {
    mutate('services/platform/src/routes/sessions.ts', (s) => `${s}\nexport const probe = (base: string) => fetch(\`\${base}/auth/v1/user\`);\n`, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 4 \(imports\): tooling\/ports\/auth\.json: `services\/platform\/src\/routes\/sessions\.ts` builds an identity-provider URL \(`\/auth\/v1`\)/);
      assert.match(r.out, /^auth\.ts\s+L2\s+L1/m);
    });
    mutate('services/platform/src/lib/reminders.ts', (s) => `${s}\nexport const rpc = (base: string) => \`\${base}/rest/v1/rpc/x\`;\n`, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /`services\/platform\/src\/lib\/reminders\.ts` builds an identity-provider URL \(`\/rest\/v1`\)/);
    });
  });
  it('🔴 red: a site page naming /auth/v1 outside the identity client reddens limb 4 (port-auth, the site half)', () => {
    mutate('sites/nikatru/js/signin.js', (s) => `${s}\nexport const leak = () => fetch(\`\${SUPABASE_URL}/auth/v1/user\`);\n`, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 4 \(imports\): tooling\/ports\/auth\.json: the site file `sites\/nikatru\/js\/signin\.js` names an identity-provider path/);
    });
    mutate('sites/nikatru/js/identity-client.js', (s) => s.replaceAll('/auth/v1', '/auth/vX'), (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /COVERAGE LOST — sites\/nikatru\/js\/identity-client\.js no longer names an identity-provider path/);
    });
  });
  it('limb 4 URL half: a URL in a COMMENT is not a call; the adapter no longer matching is COVERAGE LOST', () => {
    mutate('services/platform/src/routes/sessions.ts', (s) => `${s}\n// the old call was \`\${base}/auth/v1/user\`\n`, (r) => assert.equal(r.code, 0, r.out));
    mutate('services/platform/src/adapters/identity/gotrue.ts', (s) => s.replaceAll('/auth/v1', '/auth/vX').replaceAll('/rest/v1', '/rest/vX'), (r) => {
      // As with an import walk that read nothing: the loss is printed AND the port cannot earn its claim.
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /FAIL limb 4 \(imports\) COVERAGE LOST — no auth ts adapter .* matches the identity-URL pattern/);
      assert.match(r.out, /^auth\.ts\s+L2\s+L1/m);
    });
  });
  it('red: a route importing the Anthropic adapter reddens limb 4', () => {
    mutate('services/platform/src/lib/reminders.ts', (s) => `import { createAnthropicAi } from '../adapters/ai/anthropic';\nexport const _AI = createAnthropicAi;\n${s}`, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /limb 4 \(imports\) tooling\/ports\/ai\.json: `services\/platform\/src\/lib\/reminders\.ts` imports the adapter `services\/platform\/src\/adapters\/ai\/anthropic\.ts`/);
    });
  });
  it('ai keeps L3 through its client half when the TS tests stop calling the runner, and falls only when the Dart call goes too', () => {
    const ts = ['services/_shared/test/ai-stub.conformance.test.ts', 'services/platform/test/ai-anthropic.conformance.test.ts'];
    const dartRel = 'packages/api_client/test/ai_byok_conformance_test.dart';
    const saved = [...ts, dartRel].map((rel) => [rel, readFileSync(join(root, rel), 'utf8')]);
    try {
      for (const rel of ts) writeFileSync(join(root, rel), readFileSync(join(root, rel), 'utf8').replace(/runAiConformance\(\{/g, 'void ({'));
      let r = run(root);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /ai\s+L3\s+L3\s+L3/);
      writeFileSync(join(root, dartRel), readFileSync(join(root, dartRel), 'utf8').replace(/runAiProviderConformance\(/g, 'void ('));
      r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /ai\s+L3\s+L2/);
    } finally { for (const [rel, text] of saved) writeFileSync(join(root, rel), text); }
  });
  it('red: a sender put back as a literal in lib/report-notify.ts reddens limb 9', () => {
    mutate('services/platform/src/lib/report-notify.ts', (s) => `${s}\nexport const REPORT_NOTICE_FROM = 'Nikatru reports <alerts@mail.nikatru.com>';\n`, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 9 \(literals\): services\/platform\/src\/lib\/report-notify\.ts:\d+ carries an address on nikatru\.com/);
    });
  });
  it('red: an entity-source sender edited without a re-render reddens limb 9 (the generated module is stale)', () => {
    mutate('tooling/house-identity.json', (s) => { const d = JSON.parse(s); d.mail.from.reports.value = 'Nikatru alerts <alerts@mail.nikatru.com>'; return JSON.stringify(d); }, (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /limb 9 \(literals\) render-entity: STALE/);
    });
  });
  it("red: the fake's test no longer CALLING runMailConformance drops mail to L2, under its L3 claim", () => {
    mutate('services/_shared/test/mail-fake.conformance.test.ts', (s) => s.replace(/runMailConformance\(\{/, 'void ({'), (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /mail\s+L3\s+L2/);
      // resend alone: the SES draft passes the suite too, and is not counted.
      assert.match(r.out, /mail\.json claims L3 and earns L2: 1 conformant adapter\(s\)/);
    });
  });
  // ⏱ 2026-10-01 (port-channels): the per-channel adapter names its register row, not a vendor.
  const mutateChannels = (fn) => {
    const rel = join(root, 'tooling/ports/channels.json');
    const before = readFileSync(rel, 'utf8');
    const doc = JSON.parse(before);
    fn(doc);
    writeFileSync(rel, JSON.stringify(doc));
    try { return run(root); } finally { writeFileSync(rel, before); }
  };
  it('red: a channel adapter whose `channel` is no register row reddens limb 8', () => {
    const r = mutateChannels((d) => { d.adapters.find((a) => a.id === 'amo').channel = 'firefox-addons'; });
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 8 \(cross-register\): tooling\/ports\/channels\.json adapter `amo` names channel `firefox-addons`, which is no tooling\/channel-register\.json row/);
  });
  it('red: a non-fake adapter with neither a vendor nor a channel reddens limb 1', () => {
    const r = mutateChannels((d) => { delete d.adapters.find((a) => a.id === 'linux-snap').channel; });
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 1 \(schema\): .*adapter `linux-snap` has vendor null but is not a fake and names no `channel`/);
  });
  it('red: two adapters naming one channel redden limb 8', () => {
    const r = mutateChannels((d) => { d.adapters.find((a) => a.id === 'macos-appstore').channel = 'ios-appstore'; });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /channel `ios-appstore` is named by 2 adapters/);
  });
  it('red: a candidate that already has a register row reddens limb 8', () => {
    const r = mutateChannels((d) => { d.candidates[0].id = 'linux-snap'; });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /candidate `linux-snap` already has a tooling\/channel-register\.json row/);
  });
  it('red: a candidate that claims to be submittable reddens limb 1', () => {
    const r = mutateChannels((d) => { d.candidates[0].submittable = true; });
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 1 \(schema\): tooling\/ports\/channels\.json \$\.candidates\[0\]\.submittable: must be false/);
  });
  it('red: hostinger placed back in _non-port.json beside the boxes port reddens limb 8', () => {
    const rel = join(root, 'tooling/ports/_non-port.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.rows.push({ vendor: 'hostinger', registers: ['provider-register'], reason: 'the pre-port-boxes row, put back', until: 'port-boxes' });
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 8 \(cross-register\): vendor `hostinger` is placed 2 times \(boxes\/boxb, _non-port\)/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a box interface symbol that is not declared un-earns L2 for boxes (limb 2)', () => {
    const rel = join(root, 'tooling/ports/boxes.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.interface.js.symbols.push('readBoxNowhere');
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 2 \(symbols\).*`readBoxNowhere` is not declared in `tooling\/ops\/box-declaration\.mjs`/);
      assert.match(r.out, /boxes\s+L2\s+L0/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a conformance test that no longer CALLS runTelemetryClientConformance un-earns the dart L3', () => {
    const rel = join(root, 'packages/telemetry/test/noop_telemetry_client_conformance_test.dart');
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, before.replace('runTelemetryClientConformance(', '// runTelemetryClientConformance(\nnoCall('));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 6 \(level\): tooling\/ports\/telemetry\.json claims L3 for its dart interface and earns L2: 1 conformant adapter/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a Worker handler importing the sentry-envelope adapter reddens limb 4 and the ts half earns L1', () => {
    const rel = join(root, 'services/platform/src/index.ts');
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, `import { sentryEnvelopeSink } from '../../_shared/src/adapters/telemetry/sentry-envelope';\nvoid sentryEnvelopeSink;\n${before}`);
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /limb 4 \(imports\) tooling\/ports\/telemetry\.json: `services\/platform\/src\/index\.ts` imports the adapter `services\/_shared\/src\/adapters\/telemetry\/sentry-envelope\.ts`/);
      assert.match(r.out, /^telemetry\.ts\s+L2\s+L1\s+L3/m);
    } finally { writeFileSync(rel, before); }
  });
  it('red: verify-monitors calling the GlitchTip monitor URL itself reddens limb 11', () => {
    const rel = join(root, 'tooling/ops/verify-monitors.mjs');
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, `${before}\nawait fetch(\`\${BASE}/api/0/organizations/\${ORG}/monitors/\`, { headers: {} });\n`);
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 11 \(monitor-api\): tooling\/ops\/verify-monitors\.mjs calls GlitchTip's monitor API directly/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: the composition root may import it; scheduled.ts may not import the ntfy adapter', () => {
    const rel = join(root, 'services/platform/src/scheduled.ts');
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, `import { ntfyNotifier } from '../../_shared/src/adapters/telemetry/notify-ntfy';\nvoid ntfyNotifier;\n${before}`);
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /`services\/platform\/src\/scheduled\.ts` imports the adapter `services\/_shared\/src\/adapters\/telemetry\/notify-ntfy\.ts`/);
      assert.doesNotMatch(r.out, /`services\/platform\/src\/ports\.ts` imports the adapter/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: a REAL handler re-typed KVNamespace reddens limb 12 (routes/sessions.ts)', () => {
    const rel = join(root, 'services/platform/src/routes/sessions.ts');
    const before = readFileSync(rel, 'utf8');
    try {
      assert.match(before, /kv: KvStore \| undefined/, 'the seam this mutation flips is still there');
      writeFileSync(rel, before.replace('kv: KvStore | undefined', 'kv: KVNamespace | undefined'));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 12 \(bindings\): `services\/platform\/src\/routes\/sessions\.ts` names the Cloudflare binding type `KVNamespace`/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: the REAL events route reading request.cf directly again reddens limb 13', () => {
    const rel = join(root, 'services/platform/src/routes/events.ts');
    const before = readFileSync(rel, 'utf8');
    try {
      assert.match(before, /requestGeo\(c\.req\.raw\)/, 'the seam this mutation flips is still there');
      writeFileSync(rel, before.replace('requestGeo(c.req.raw)', '((c.req.raw as Request & { cf?: IncomingRequestCfProperties }).cf ?? {})'));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 13 \(geo\): `services\/platform\/src\/routes\/events\.ts` reads the runtime's `cf` object/);
    } finally { writeFileSync(rel, before); }
  });
  it("red: Cloudflare's non-port row without `remaining` reddens limb 8", () => {
    const rel = join(root, 'tooling/ports/_non-port.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      delete doc.rows.find((x) => x.vendor === 'cloudflare').remaining;
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 8 \(cross-register\): vendor `cloudflare` is placed 5 times/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: deleting one vendor from _non-port.json reddens limb 8', () => {
    const rel = join(root, 'tooling/ports/_non-port.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      // ⏱ 2026-10-03 · port-codehost: `github` is codehost's adapter now, so the row deleted is
      // the captcha authority's (a platform authority, never ported).
      doc.rows = doc.rows.filter((x) => x.vendor !== 'cloudflare-turnstile');
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 8 \(cross-register\): vendor `cloudflare-turnstile`/);
    } finally { writeFileSync(rel, before); }
  });
  it('🔴 red (port-codehost): github placed back in _non-port.json beside the codehost port reddens limb 8', () => {
    const rel = join(root, 'tooling/ports/_non-port.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.rows.push({ vendor: 'github', registers: ['capability-register'], reason: 'the workflow-dispatch call from the Worker cron', until: 'port-codehost' });
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /vendor `github` is placed 2 times \(codehost\/github, _non-port\)/);
    } finally { writeFileSync(rel, before); }
  });
  it("red: paddle's C-8 seam moved off MoRWebhookVerifier's file reddens limb 8", () => {
    const rel = join(root, 'tooling/capability-register.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.vendors.paddle.seam.file = 'services/platform/src/lib/mor/registry.ts';
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /adapter `paddle`: vendor `paddle`'s C-8 seam\.file is `services\/platform\/src\/lib\/mor\/registry\.ts`/);
    } finally { writeFileSync(rel, before); }
  });
  // ⏱ 2026-10-01 · port-pay-core: the checkout waiver is gone (the route dispatches through
  // src/ports.ts), so the red that stood here is replaced by the brief's own: a ROUTE that imports
  // Paddle's outbound module is a limb-4 finding, and the level falls with it.
  it('red: a route importing lib/mor/paddle-cancel reddens limb 4 and payments earns L1', () => {
    const rel = join(root, 'services/platform/src/routes/vendor-shaped.ts');
    try {
      writeFileSync(rel, "import { cancelPaddleSubscription } from '../lib/mor/paddle-cancel';\nexport const c = cancelPaddleSubscription;\n");
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 4 \(imports\).*routes\/vendor-shaped\.ts.*lib\/mor\/paddle-cancel\.ts/);
      assert.match(r.out, /payments\s+L3\s+L1/);
    } finally { rmSync(rel, { force: true }); }
  });
  it('red: a hand edit of the rendered table reddens limb 3', () => {
    const rel = join(root, 'services/platform/src/generated/ports.ts');
    const before = readFileSync(rel, 'utf8');
    try {
      writeFileSync(rel, before.replace("razorpay: 'none',", "razorpay: 'api',"));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 3 \(waivers\): render --check: services\/platform\/src\/generated\/ports\.ts differs from its render/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: the fake selected for live reddens limb 7', () => {
    const rel = join(root, 'tooling/ports/payments.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.selection.default.live = 'fake';
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /limb 7 \(fakes\) tooling\/ports\/payments\.json selection\.default\.live is the fake `fake`/);
    } finally { writeFileSync(rel, before); }
  });
  it('red: claiming L3 with a scenario pending on the fake reddens limb 6', () => {
    const rel = join(root, 'tooling/ports/payments.json');
    const before = readFileSync(rel, 'utf8');
    try {
      const doc = JSON.parse(before);
      doc.conformance.pending.push({ adapter: 'fake', case: 'an older event after a newer one cannot re-grant', row: 'O-FIXTURE' });
      writeFileSync(rel, JSON.stringify(doc));
      const r = run(root);
      assert.equal(r.code, 1, r.out);
      assert.match(r.first, /limb 6 \(level\).*payments\.json claims L3 and earns L2: 1 conformant adapter/);
    } finally { writeFileSync(rel, before); }
  });
});

// ⏱ 2026-10-01 · port-pay-client · limb 10, the client (Dart) half, on a fixture adapter package.
describe('assert-ports — limb 10, the client half, reddens', () => {
  const clientHalf = (over = {}) => ({
    level: { claimed: 3, target: 3 },
    seams: [{ interface: 'Rail', suite: { file: 'packages/seam/lib/testing/conformance.dart', runner: 'runRailConformance' } }],
    adapters: [
      { id: 'acme-rail', seam: 'Rail', status: 'built', impl: { file: 'packages/acme_rail/lib/acme_rail.dart', symbol: 'AcmeRail' }, conformance: { file: 'packages/acme_rail/test/acme_rail_conformance_test.dart' } },
      { id: 'fake-rail', seam: 'Rail', status: 'fake', impl: { file: 'packages/seam/lib/testing.dart', symbol: 'FakeRail' }, conformance: { file: 'packages/seam/test/fake_conformance_test.dart' } },
    ],
    pending: [],
    _why: ['fixture'],
    ...over,
  });
  const clientPort = (over = {}) => port({
    level: { claimed: 2, target: 3 },
    interface: { ts: { file: 'services/w/src/lib/contract.ts', symbols: ['WidgetPort'] }, dart: { file: 'packages/seam/lib/seam.dart', symbols: ['Rail'] } },
    client: clientHalf(over),
  });
  const CALLS = "import 'package:seam/testing.dart';\n\nvoid main() {\n  runRailConformance('acme', <String, Object>{});\n}\n";
  const files = (extra = {}) => ({
    'packages/seam/lib/seam.dart': "library;\n\nexport 'src/rail.dart';\n",
    'packages/seam/lib/src/rail.dart': 'abstract interface class Rail {\n  void sell();\n}\n',
    'packages/seam/lib/testing/conformance.dart': 'void runRailConformance(String adapter, Map<String, Object> fixtures) {}\n',
    'packages/seam/lib/testing.dart': "import 'seam.dart';\n\nclass FakeRail implements Rail {\n  @override\n  void sell() {}\n}\n",
    'packages/seam/test/fake_conformance_test.dart': CALLS,
    'packages/acme_rail/lib/acme_rail.dart': "import 'package:seam/seam.dart';\n\nclass AcmeRail implements Rail {\n  @override\n  void sell() {}\n}\n",
    'packages/acme_rail/test/acme_rail_conformance_test.dart': CALLS,
    'tooling/ops/port-switch.mjs': '// the dry-run tool L3 needs; its behaviour is port-switch.test.mjs\'s subject\n',
    ...extra,
  });
  it('green control: the client half claims and earns L3, through a library file that EXPORTS the seam', () => {
    const r = run(fixture({ ports: { widgets: clientPort() }, files: files() }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /widgets\/client\s+L3\s+L3\s+L3/);
  });
  it('red: an adapter package whose test imports the suite but never CALLS the runner', () => {
    const r = run(fixture({
      ports: { widgets: clientPort() },
      files: files({ 'packages/acme_rail/test/acme_rail_conformance_test.dart': "import 'package:seam/testing.dart';\n\n// runRailConformance('acme', {}); — a comment runs nothing\nvoid main() {\n  final Object f = runRailConformance;\n}\n" }),
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /^assert-ports: FAILED — limb 10 \(client\): .*`acme-rail`: `packages\/acme_rail\/test\/acme_rail_conformance_test\.dart` never CALLS `runRailConformance`/);
    assert.match(r.out, /widgets\/client\s+L3\s+L2/);
  });
  it('red: a class implementing the seam that is no registered client adapter', () => {
    const r = run(fixture({
      ports: { widgets: clientPort() },
      files: files({ 'packages/other_rail/lib/other.dart': "import 'package:seam/seam.dart';\n\nclass OtherRail implements Rail {\n  @override\n  void sell() {}\n}\n" }),
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 10 \(client\): .*`OtherRail` \(packages\/other_rail\/lib\/other\.dart\) implements the client seam `Rail` and is no client adapter/);
  });
  it('red: an app lib importing the shared fakes', () => {
    const r = run(fixture({
      ports: { widgets: clientPort() },
      files: files({ 'apps/shop/lib/main.dart': "import 'package:nikatru_purchases/testing.dart';\n\nvoid main() {}\n" }),
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 10 \(client\): apps\/shop\/lib\/main\.dart imports the shared payment fakes/);
  });
  it('red: a seam the library file neither declares nor exports reddens limb 2', () => {
    const r = run(fixture({ ports: { widgets: clientPort() }, files: files({ 'packages/seam/lib/seam.dart': 'library;\n' }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.first, /limb 2 \(symbols\): .*interface\.dart symbol `Rail` is not declared in `packages\/seam\/lib\/seam\.dart` or a file it exports/);
  });
  it('red: a conformance-less adapter must say why it waits', () => {
    const half = clientHalf();
    half.adapters[0] = { ...half.adapters[0], conformance: null };
    const p = port({
      level: { claimed: 2, target: 3 },
      interface: { ts: { file: 'services/w/src/lib/contract.ts', symbols: ['WidgetPort'] }, dart: { file: 'packages/seam/lib/seam.dart', symbols: ['Rail'] } },
      client: half,
    });
    const r = run(fixture({ ports: { widgets: p }, files: files() }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /client adapter `acme-rail` has no conformance test and says nothing about why/);
    assert.match(r.out, /widgets\/client\s+L3\s+L2/, 'and the seam is one conformant adapter short');
  });
});

describe('affected-guards selects assert-ports by REGISTRY CONTENT', () => {
  it('a registry-named impl file, a registry, a shared port module and geo.ts select it; an unnamed route does not', async () => {
    const { buildChecks, select, trackedTree } = await import('../../scripts/affected-guards.mjs');
    const { checks, contentLost } = buildChecks(REPO, trackedTree(REPO));
    assert.deepEqual(contentLost, []);
    const picks = (p) => select(checks, [p], null).selected.some((c) => c.id === 'guard:assert-ports');
    assert.equal(picks('services/platform/src/lib/mor/paddle.ts'), true, 'named by payments.json impl.file');
    assert.equal(picks('packages/telemetry/lib/src/noop_telemetry_client.dart'), true, 'named by telemetry.json impl.file');
    assert.equal(picks('tooling/ports/payments.json'), true);
    assert.equal(picks('services/_shared/src/ports/payments.ts'), true);
    assert.equal(picks('services/platform/src/routes/money.ts'), false, 'no registry names it, and it names no binding type and reads no .cf');
    // limbs 9/10: the one .cf reader, and a module whose TEXT carries the shape
    assert.equal(picks('services/_shared/src/geo.ts'), true, "limb 10's one reader");
    assert.equal(picks('services/_shared/src/ports/adapters/cloudflare.ts'), true, 'a registry impl file that names the binding types');
    assert.equal(picks('services/platform/src/routes/events.ts'), false, 'reads geography only through requestGeo');
    // the content branch itself: a binding type or a `.cf` read in Worker source selects; prose and tests do not
    const content = checks.find((c) => c.id === 'guard:assert-ports').subjects.find((x) => x.kind === 'content');
    const route = 'services/platform/src/routes/x.ts';
    assert.equal(content.test(route, 'export const f = (k: KVNamespace) => k;\n'), true);
    assert.equal(content.test(route, 'export const f = (r: any) => r.cf?.country;\n'), true);
    assert.equal(content.test(route, '// keyed on request.cf, never a KVNamespace\nexport const x = 1;\n'), false);
    assert.equal(content.test('services/platform/test/x.test.ts', 'export const f = (r: any) => r.cf;\n'), false, 'a test is not Worker source');
    assert.equal(picks('services/platform/src/lib/mor/paddle-cancel.ts'), true, 'named by payments.json outbound.modules');
    assert.equal(picks('services/platform/src/lib/mor/paddle-rail.ts'), true, 'named by payments.json outbound.file');
    assert.equal(picks('services/platform/src/generated/ports.ts'), true, 'the rendered table limb 3 checks');
    assert.equal(picks('services/platform/src/ports.ts'), true, 'the composition root limb 4 allows');
    assert.equal(picks('packages/purchases/lib/src/generated/rails.dart'), true, 'the Dart rail map limb 3 re-renders');
    assert.equal(picks('packages/billing_revenuecat/test/revenuecat_bridge_conformance_test.dart'), true, 'named by payments.json client conformance');
    assert.equal(picks('packages/notifications/lib/src/x.dart'), true, 'limb 10 derives the client adapters from every Dart lib');
  });
});
