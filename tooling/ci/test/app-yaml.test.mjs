// ─────────────────────────────────────────────────────────────────────────────
// app-yaml.test.mjs — the recorded failing cases for assert-app-yaml.mjs and the
// renderer it grades.
//
// [pipeline F-10] "Every guard carries a recorded failing case and a self-check
// that its own scan still reaches everything it claims to cover."
// `assert-guard-coverage.mjs` refuses a guard no test file names, in its own
// words: "It has only ever run against the real repo, which is valid input by
// definition, so nothing exercises its failing path."
//
// ── EVERY CASE MUTATES A REAL TREE AND SPAWNS THE REAL EXECUTABLES ───────────
// No mocks and no hand-written fixture catalogue. A fixture that models the
// renderer's own assumptions agrees with it about exactly the thing under test —
// this repository's recorded reason for `assert-clone-contract.mjs` parsing
// rather than grepping, and for `generate-apps-data.test.mjs` running the real
// script against a real temp tree.
//
// The tree each case runs against is the REAL repository's declaration, register
// and store trees, copied file by file. So the POSITIVE CONTROL below is the
// strongest statement available: the bytes a human wrote by hand into
// `catalog/apps.json` and into twenty-five listing files are EXACTLY what
// `apps/subly/app.yaml` renders to. If that ever stops holding, the declaration
// and the tree have parted company and every negative case below is about a
// tree nobody ships.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseYaml, YamlError } from '../../app-yaml/yaml.mjs';
import { validate, assertSchemaUnderstood, SchemaError } from '../../app-yaml/schema-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-app-yaml.mjs');
const RENDER = join(REPO, 'tooling', 'app-yaml', 'render.mjs');

const APP_YAML = 'apps/subly/app.yaml';
const PRIVACY_YAML = 'apps/subly/privacy.yaml';
const CATALOGUE = 'catalog/apps.json';
const TITLE = 'apps/subly/store/windows-store/title.txt';

/* Never through a pipe, and never `$?` beside a command substitution: this
   corpus has had a failing command read as exit 0 three times that way. */
const spawn = (script, args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: r.status === null ? 2 : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A copy of everything the guard and the two renderers read, and nothing else.
 *
 *  🔴 THE NOTICE SURFACES ARE IN THE FIXTURE, not stubbed. Limbs 4 and 5 both
 *  refuse an incomplete tree with COVERAGE LOST — limb 4 when a sworn store file
 *  is absent or still the brick's stamped one, limb 5 when not one extension
 *  store listing carries the privacy-practices markers — so a fixture missing
 *  them would exercise the refusals on every case instead of the case's own
 *  mutation. The files below are exactly the ones `planPrivacy` opens. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'app-yaml-'));
  for (const rel of [
    'apps/subly/app.yaml',
    'apps/subly/privacy.yaml',
    'catalog/apps.json',
    'tooling/channel-register.json',
    'tooling/legal/provider-register.json',
    'sites/nikatru/subly/privacy.html',
    'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml',
    'extensions/Extension/Full_Screen_Shot/publish/STORE-LISTING.md',
    'extensions/templates/tool/publish/STORE-LISTING.md',
  ]) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  cpSync(join(REPO, 'apps/subly/store'), join(root, 'apps/subly/store'), { recursive: true });
  return root;
}

const PRIVACY_RENDER = join(REPO, 'tooling', 'app-yaml', 'render-privacy.mjs');
const PLAY_SWORN = 'apps/subly/store/android-play/data-safety.json';
const APPLE_SWORN = 'apps/subly/store/ios-appstore/privacy-manifest.json';
const SITE_NOTICE = 'sites/nikatru/subly/privacy.html';
const EXT_LISTING = 'extensions/Extension/Full_Screen_Shot/publish/STORE-LISTING.md';

const readJson = (root, rel) => JSON.parse(get(root, rel));
const putJson = (root, rel, obj) => put(root, rel, `${JSON.stringify(obj, null, 2)}\n`);

/** One more `collects` row, valid against the schema and matching NOTHING in
 *  either sworn file. Appended after the last row so the block structure holds. */
const EXTRA_COLLECTS_ROW = [
  '',
  '  - category: Messages',
  '    type: Other in-app messages',
  '    purposes:',
  '      - Analytics',
  '    retentionClass: 400',
  '    required: false',
  '    shared: false',
  '    basis: >-',
  '      A row that is schema-valid in every respect and appears in neither sworn',
  '      store declaration. This is the whole point of the case: the declaration',
  '      alone cannot decide what the app collects.',
  '    source: apps/subly/store/android-play/data-safety.json',
  '    asOf: "2026-09-06"',
  '',
].join('\n');

/** Insert `EXTRA_COLLECTS_ROW` at the end of the `collects:` block — i.e. just
 *  before the `processors:` key, which is the next top-level key in the file. */
function addCollectsRow(root) {
  const text = get(root, PRIVACY_YAML);
  const at = text.indexOf('\nprocessors:');
  assert.notEqual(at, -1, 'the declaration must still carry a top-level `processors:` key');
  put(root, PRIVACY_YAML, `${text.slice(0, at)}\n${EXTRA_COLLECTS_ROW}${text.slice(at)}`);
}
const put = (root, rel, text) => writeFileSync(join(root, rel), text);
const get = (root, rel) => readFileSync(join(root, rel), 'utf8');
const kill = (root) => rmSync(root, { recursive: true, force: true });

describe('assert-app-yaml — the declaration and its renderings', () => {
  test('POSITIVE CONTROL: the real tree is valid and every rendering is fresh', () => {
    const root = tree();
    try {
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `the real declaration must grade clean:\n${out}`);
      assert.match(out, /byte-identical/);
    } finally { kill(root); }
  });

  test('POSITIVE CONTROL: --check is green and writes nothing on the real tree', () => {
    const root = tree();
    try {
      const before = get(root, CATALOGUE);
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 0, out);
      assert.equal(get(root, CATALOGUE), before, '--check must not write — it is a read-only assertion');
    } finally { kill(root); }
  });

  test('MUTATION: deleting `id` from the declaration is a FINDING, not a coverage loss', () => {
    // Exit 1 and not 2 is the assertion. Both are non-zero, and only one names
    // the repair: this guard exited 2 blaming its privacy limb until it learned
    // to stop at the declaration that would not parse.
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).split('\n').filter((l) => !l.startsWith('id: ')).join('\n'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /required property "id" is absent/);
    } finally { kill(root); }
  });

  test('MUTATION: editing the tagline without re-rendering fails, and NAMES every stale file', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^tagline: .*$/m, 'tagline: Track every subscription in one calm place'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.match(out, /catalog\/apps\.json/);
      // Five channels, one short-description each. A drift check that named only
      // the catalogue would leave the listing copy silently forked.
      const named = [...out.matchAll(/short-description\.txt/g)].length;
      assert.equal(named, 5, `expected all five channels named, got ${named}:\n${out}`);
      assert.equal(spawn(GUARD, [root]).code, 1);
    } finally { kill(root); }
  });

  test('MUTATION: editing the name without re-rendering names every title.txt', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^name: .*$/m, 'name: Subly Pro'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.equal([...out.matchAll(/title\.txt/g)].length, 5, out);
    } finally { kill(root); }
  });

  test('MUTATION: a HAND EDIT to a listing file fails — the only thing that can catch one', () => {
    // `title.txt` holds nothing but the title a store shows, so it cannot carry
    // a "generated, do not edit" header. This comparison is the whole protection.
    const root = tree();
    try {
      put(root, TITLE, 'Subly — Best Subscription App\n');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /windows-store\/title\.txt/);
    } finally { kill(root); }
  });

  test('MUTATION: a hand edit to catalog/apps.json fails', () => {
    const root = tree();
    try {
      put(root, CATALOGUE, get(root, CATALOGUE).replace('"status": "live"', '"status": "preview"'));
      assert.equal(spawn(GUARD, [root]).code, 1);
    } finally { kill(root); }
  });

  test('MUTATION: `listings.web` written by hand is refused — it is DERIVED', () => {
    const root = tree();
    try {
      put(root, APP_YAML, `${get(root, APP_YAML).replace(/^listings:$/m, 'listings:\n  web: https://elsewhere.example')}`);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /DERIVED from hosts\.web/);
    } finally { kill(root); }
  });

  test('MUTATION: a processor nobody has named is refused', () => {
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('  - id: cloudflare', '  - id: some-analytics-vendor'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /is not a row in tooling\/legal\/provider-register\.json/);
    } finally { kill(root); }
  });

  test('MUTATION: a network address in the privacy declaration is refused', () => {
    // C-NO-NETWORK-ADDRESS-COLUMN. This claim has already been false in
    // publication once, which is why the words are refused and not only the flag.
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('    type: Diagnostics', '    type: IP address'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /names a network address/);
    } finally { kill(root); }
  });

  test('MUTATION: `networkAddress: true` is refused by the schema itself', () => {
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('networkAddress: false', 'networkAddress: true'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /networkAddress/);
    } finally { kill(root); }
  });

  test('MUTATION: a retention period outside the locked set is refused', () => {
    // [ADR 045] / C-RETENTION-PERIODS: 400 / 730 / 1100 and nothing else, so a
    // convenience change cannot quietly extend how long personal data is kept.
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('retentionClass: 400', 'retentionClass: 3650'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /retentionClass/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: no declaration at all exits 2, never 0', () => {
    const root = tree();
    try {
      rmSync(join(root, APP_YAML));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, `a run that graded nothing must not share an exit code with a pass:\n${out}`);
      assert.match(out, /COVERAGE LOST/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: an unreadable channel register exits 2', () => {
    // The storefront key set AND every listing directory come from it. Without
    // it the rendered `listings` block silently loses keys and no listing file
    // is written at all — a run that would otherwise report the catalogue fresh.
    const root = tree();
    try {
      rmSync(join(root, 'tooling/channel-register.json'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: no privacy declaration anywhere exits 2', () => {
    const root = tree();
    try {
      rmSync(join(root, PRIVACY_YAML));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /privacy\.yaml/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: a declaration that renders ZERO listing files exits 2', () => {
    const root = tree();
    try {
      rmSync(join(root, 'apps/subly/store'), { recursive: true });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /ZERO listing files/);
    } finally { kill(root); }
  });

  test('the renderer WRITES the repair it names, and is byte-stable across runs', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^tagline: .*$/m, 'tagline: Track every subscription in one calm place'));
      assert.equal(spawn(RENDER, [root]).code, 0);
      const first = get(root, CATALOGUE);
      assert.match(first, /one calm place/);
      assert.equal(get(root, TITLE), 'Subly\n', 'a tagline change must not touch the title');
      assert.equal(spawn(RENDER, [root]).code, 0);
      // A drift check over an unstable generator fails at random and gets
      // switched off within a week, taking the real protection with it.
      assert.equal(get(root, CATALOGUE), first, 'the renderer must be byte-stable across runs');
      assert.equal(spawn(GUARD, [root]).code, 0);
    } finally { kill(root); }
  });

  test('the renderer NEVER touches a sworn declaration or the editorial copy', () => {
    // assert-sworn-store-files.mjs limb 7 is the tripwire this respects:
    // "a template that carries answers makes app #2 swear to app #1's code".
    const untouchable = [
      'apps/subly/store/android-play/data-safety.json',
      'apps/subly/store/android-play/content-rating.json',
      'apps/subly/store/android-play/ads-declaration.json',
      'apps/subly/store/ios-appstore/privacy-manifest.json',
      'apps/subly/store/android-play/long-description.txt',
      'apps/subly/store/ios-appstore/keywords.txt',
      'apps/subly/store/windows-store/search-terms.txt',
    ];
    const root = tree();
    try {
      const before = new Map(untouchable.map((rel) => [rel, get(root, rel)]));
      assert.ok(before.size > 0 && [...before.values()].every((v) => v.length > 0), 'the fixture must actually carry the files it claims to protect');
      put(root, APP_YAML, get(root, APP_YAML).replace(/^name: .*$/m, 'name: Renamed'));
      assert.equal(spawn(RENDER, [root]).code, 0);
      for (const [rel, text] of before) assert.equal(get(root, rel), text, `${rel} must not be rewritten by the renderer`);
    } finally { kill(root); }
  });

  test('the renderer creates no store tree that was not already there', () => {
    // A missing tree on a deferred channel is an OWNER-GATED gap that
    // assert-store-metadata.mjs prints. A renderer that conjured one would turn
    // that print into a commitment nobody made.
    const root = tree();
    try {
      rmSync(join(root, 'apps/subly/store/linux-snap'), { recursive: true });
      assert.equal(spawn(RENDER, [root]).code, 0);
      assert.equal(existsSync(join(root, 'apps/subly/store/linux-snap')), false);
    } finally { kill(root); }
  });
});

describe('yaml.mjs — the subset REFUSES what it does not implement', () => {
  const refuses = [
    ['flow sequences', 'platforms: [web, android]\n'],
    ['flow mappings', 'hosts: {web: x.nikatru.com}\n'],
    ['anchors', 'a: &x 1\nb: *x\n'],
    ['tags', 'a: !!str 1\n'],
    ['a tab', 'a:\n\t- b\n'],
    ['odd indentation', 'a:\n   b: 1\n'],
    ['a duplicate key', 'a: 1\na: 2\n'],
    ['document markers', '---\na: 1\n'],
    ['an un-chomped folded scalar', 'a: >\n  text\n'],
    ['an un-chomped literal scalar', 'a: |\n  text\n'],
  ];
  for (const [what, text] of refuses) {
    test(`refuses ${what} rather than guessing`, () => {
      assert.throws(() => parseYaml(text), YamlError, `${what} was parsed instead of refused`);
    });
  }

  test('a `#` inside a quoted value is CONTENT, not a comment', () => {
    assert.deepEqual(parseYaml('a: "x # y"\n'), { a: 'x # y' });
  });

  test('a trailing comment outside quotes IS stripped', () => {
    assert.deepEqual(parseYaml('a: b # note\n'), { a: 'b' });
  });

  test('escapes in a double-quoted scalar survive, and an unknown one is refused', () => {
    assert.deepEqual(parseYaml('a: "he said \\"hi\\""\n'), { a: 'he said "hi"' });
    assert.throws(() => parseYaml('a: "\\q"\n'), YamlError);
  });

  test('a folded block scalar joins its lines with one space', () => {
    assert.deepEqual(parseYaml('a: >-\n  one\n  two\n'), { a: 'one two' });
  });

  test('a sequence of mappings parses, and so does one of scalars', () => {
    assert.deepEqual(parseYaml('rows:\n  - k: 1\n    j: 2\n  - k: 3\n'), { rows: [{ k: 1, j: 2 }, { k: 3 }] });
    assert.deepEqual(parseYaml('rows:\n  - a\n  - b\n'), { rows: ['a', 'b'] });
  });
});

describe('schema-validate.mjs — an unimplemented keyword is refused, never ignored', () => {
  test('an unknown keyword throws instead of silently not constraining', () => {
    // The whole design. A validator that skips what it does not understand turns
    // every schema typo into a constraint that reads as present and is not there.
    assert.throws(() => assertSchemaUnderstood({ type: 'array', minimumItems: 2 }), SchemaError);
  });

  test('additionalProperties:true is refused — every object schema closes its set', () => {
    assert.throws(() => assertSchemaUnderstood({ type: 'object', additionalProperties: true }), SchemaError);
  });

  test('a format with no implementation is refused', () => {
    assert.throws(() => assertSchemaUnderstood({ type: 'string', format: 'email' }), SchemaError);
  });

  test('the two shipped schemas are entirely understood by this validator', () => {
    for (const rel of ['tooling/app-yaml/schema/app.schema.json', 'tooling/app-yaml/schema/privacy.schema.json']) {
      const schema = JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
      assert.equal(assertSchemaUnderstood(schema, rel), true, `${rel} carries a keyword nothing enforces`);
    }
  });

  test('it reports EVERY problem at once, not the first', () => {
    const schema = { type: 'object', additionalProperties: false, required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' } } };
    assert.equal(validate({ c: 1 }, schema).length, 3);
  });
});

describe('limb 4 — the declaration and the two SWORN store declarations agree', () => {
  test('POSITIVE CONTROL: the real tree matches in both directions, and says how many rows it compared', () => {
    // The strongest statement available here: the eleven categories a human
    // swore to Google, the eleven Apple rows derived from them, and the eleven
    // in the notice declaration are the same eleven. If that stops holding,
    // every negative case below is about a tree nobody ships.
    const root = tree();
    try {
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, out);
      assert.match(out, /limb 4 — 11 collected categor\(ies\) across 1 app\(s\)/);
    } finally { kill(root); }
  });

  test('MUTATION: a row added to privacy.yaml ALONE is a FINDING (1), naming the sworn file', () => {
    const root = tree();
    try {
      addCollectsRow(root);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /android-play\/data-safety\.json has no row for it/);
      assert.match(out, /Messages \/ Other in-app messages/);
    } finally { kill(root); }
  });

  test('MUTATION: a sworn Play row the declaration does not mention is a FINDING, the other direction', () => {
    // One direction alone is the defect this limb is named after. A declaration
    // that is a SUBSET of the sworn answers passes "every declared row is sworn"
    // while the app collects a category its own notice never mentions.
    const root = tree();
    try {
      const text = get(root, PRIVACY_YAML);
      const at = text.indexOf('  - category: Location');
      const next = text.indexOf('  - category: Personal info');
      assert.ok(at !== -1 && next > at, 'the first collects row must still be the Location one');
      put(root, PRIVACY_YAML, text.slice(0, at) + text.slice(next));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /swears "Location \/ Approximate location" is collected/);
    } finally { kill(root); }
  });

  test('MUTATION: a data-safety.json still STAMPED is COVERAGE LOST (2), never a pass', () => {
    // The brick ships this file with `buildPosture: null` and no `answers`, on
    // purpose. Comparing a real declaration against it finds nothing wrong over
    // an empty set — C-COVERAGE-LOST-IS-NOT-PASS is exactly this case.
    const root = tree();
    try {
      const sworn = readJson(root, PLAY_SWORN);
      sworn.buildPosture = null;
      putJson(root, PLAY_SWORN, sworn);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, `expected COVERAGE LOST, got ${code}:\n${out}`);
      assert.match(out, /still the STAMPED template/);
      assert.match(out, /COVERAGE LOST/);
    } finally { kill(root); }
  });

  test('MUTATION: an unanswered Apple manifest is COVERAGE LOST (2) too', () => {
    const root = tree();
    try {
      const sworn = readJson(root, APPLE_SWORN);
      sworn.collectedDataTypes = null;
      putJson(root, APPLE_SWORN, sworn);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, `expected COVERAGE LOST, got ${code}:\n${out}`);
      assert.match(out, /carries no `rows` array/);
    } finally { kill(root); }
  });

  test('MUTATION: an Apple row whose Play row the declaration dropped is a FINDING (1)', () => {
    const root = tree();
    try {
      const sworn = readJson(root, APPLE_SWORN);
      sworn.collectedDataTypes.rows = sworn.collectedDataTypes.rows.filter((r) => r.fromPlayRow !== 'Crash logs');
      putJson(root, APPLE_SWORN, sworn);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /is "Crash logs"/);
    } finally { kill(root); }
  });

  test('THE APP ARITY FLOOR DID NOT MOVE: `collects: []` on an app declaration is still refused', () => {
    // `collects` and `processors` carried `minItems: 1` unconditionally before
    // the extension surface existed. The floor moved INTO the app branch of the
    // schema, and this is the demonstration that it is still there — the case a
    // reviewer would otherwise have to take on trust.
    const root = tree();
    try {
      const text = get(root, PRIVACY_YAML);
      const start = text.indexOf('collects:');
      const end = text.indexOf('\nprocessors:');
      assert.ok(start !== -1 && end > start);
      put(root, PRIVACY_YAML, `${text.slice(0, start)}collects: []${text.slice(end)}`);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /permitted shapes/);
    } finally { kill(root); }
  });

  test('THE APP ARITY FLOOR DID NOT MOVE: `processors: []` is still refused', () => {
    const root = tree();
    try {
      const text = get(root, PRIVACY_YAML);
      const start = text.indexOf('\nprocessors:');
      assert.notEqual(start, -1);
      put(root, PRIVACY_YAML, `${text.slice(0, start)}\nprocessors: []\n`);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /permitted shapes/);
    } finally { kill(root); }
  });

  test('a declaration that names a network address is STILL refused, with the surface key present', () => {
    // Limb 3's refusal, re-run because the schema grew a discriminator around
    // it. A constraint that survives a refactor only by accident is one nobody
    // has proved survived it.
    const root = tree();
    try {
      put(root, PRIVACY_YAML, get(root, PRIVACY_YAML).replace('type: Approximate location', 'type: Approximate location and IP address'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /names a network address/);
    } finally { kill(root); }
  });
});

describe('limb 5 — the notice surfaces are what the declaration renders to', () => {
  test('POSITIVE CONTROL: --check is green on the real tree and writes nothing', () => {
    const root = tree();
    try {
      const before = [SITE_NOTICE, EXT_LISTING].map((rel) => [rel, get(root, rel)]);
      const { code, out } = spawn(PRIVACY_RENDER, [root, '--check']);
      assert.equal(code, 0, out);
      assert.match(out, /3 notice rendering\(s\) match/);
      for (const [rel, text] of before) assert.equal(get(root, rel), text, `${rel} must not be rewritten by --check`);
    } finally { kill(root); }
  });

  test('MUTATION: a hand edit BETWEEN the STORE-LISTING markers is caught, and restoring it is green', () => {
    // The bytes between those markers are pasted into a store dashboard. A
    // dashboard answer that contradicts the code is a policy strike at account
    // level, and the surrounding document is hand-written prose that cannot
    // carry a single "generated" header — so this comparison is the only thing
    // standing between an edit and a console.
    const root = tree();
    try {
      const original = get(root, EXT_LISTING);
      assert.equal(spawn(PRIVACY_RENDER, [root, '--check']).code, 0, 'the control must be green first');
      put(root, EXT_LISTING, original.replace('| Website content | **YES — handled locally only** |', '| Website content | **NO** |'));
      const bad = spawn(PRIVACY_RENDER, [root, '--check']);
      assert.equal(bad.code, 1, `expected the edit to be caught:\n${bad.out}`);
      assert.match(bad.out, /STORE-LISTING\.md/);
      const guarded = spawn(GUARD, [root]);
      assert.equal(guarded.code, 1, `the guard must fail on it too:\n${guarded.out}`);
      assert.match(guarded.out, /policy strike/);
      put(root, EXT_LISTING, original);
      assert.equal(spawn(PRIVACY_RENDER, [root, '--check']).code, 0, 'restoring the bytes must be green again');
      assert.equal(spawn(GUARD, [root]).code, 0);
    } finally { kill(root); }
  });

  test('MUTATION: a hand edit to the per-app notice page is caught', () => {
    const root = tree();
    try {
      put(root, SITE_NOTICE, get(root, SITE_NOTICE).replace('<h2>4. Who else touches it</h2>', '<h2>4. Nobody else touches it</h2>'));
      const { code, out } = spawn(PRIVACY_RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.match(out, /sites\/nikatru\/subly\/privacy\.html/);
    } finally { kill(root); }
  });

  test('MUTATION: no fenced store listing anywhere is COVERAGE LOST (2), not "0 renderings, clean"', () => {
    const root = tree();
    try {
      rmSync(join(root, 'extensions'), { recursive: true, force: true });
      const { code, out } = spawn(PRIVACY_RENDER, [root, '--check']);
      assert.equal(code, 2, `expected COVERAGE LOST, got ${code}:\n${out}`);
      assert.match(out, /carries the privacy-practices markers/);
    } finally { kill(root); }
  });

  test('MUTATION: only the TEMPLATE fenced is COVERAGE LOST — a stamped notice proves nothing', () => {
    const root = tree();
    try {
      rmSync(join(root, 'extensions/Extension'), { recursive: true, force: true });
      const { code, out } = spawn(PRIVACY_RENDER, [root, '--check']);
      assert.equal(code, 2, `expected COVERAGE LOST, got ${code}:\n${out}`);
      assert.match(out, /every fenced store listing is the tool TEMPLATE/);
    } finally { kill(root); }
  });

  test('the tool TEMPLATE renders the UNANSWERED notice, never a plausible default', () => {
    // The brick stamps its four sworn store files UNANSWERED for the same
    // reason. The one default that is tempting here — "this item does not
    // collect user data" — is a policy strike for any tool that reads page
    // content, so the template ships no answer at all.
    const root = tree();
    try {
      const text = get(root, 'extensions/templates/tool/publish/STORE-LISTING.md');
      assert.match(text, /UNANSWERED/);
      assert.doesNotMatch(text, /Dashboard answer/);
    } finally { kill(root); }
  });

  test('the extension declaration is graded by the guard, not just by the renderer', () => {
    const root = tree();
    try {
      const rel = 'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml';
      put(root, rel, get(root, rel).replace('noSale: true', 'noSale: false'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /limitedUse\/noSale/);
    } finally { kill(root); }
  });

  test('the empty flow sequence `[]` parses, and every other flow form is still refused', () => {
    // The one flow form this subset admits, and the reason it had to be: there
    // is no block form for an empty sequence, so `collects:` with nothing under
    // it parses as null — a different value and a different failure. Every
    // other flow form stays refused, which is what the cases above rely on.
    assert.deepEqual(parseYaml('collects: []\n'), { collects: [] });
    assert.throws(() => parseYaml('collects: [a]\n'), YamlError);
    assert.throws(() => parseYaml('collects: {}\n'), YamlError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('limb 6 — the mobile-IAP opt-in and the bridge dependency travel together', () => {
  // [ADR 067] decision 7. Two edits make an app sell through a store billing
  // rail, and either one alone is a defect — in opposite directions and with
  // very different costs. Every case below mutates the REAL declaration tree.
  const IAP_BLOCK =
    '\nbilling:\n  mobileIap:\n    provider: revenuecat\n    entitlementId: pro\n' +
    '    revenuecatAppIds:\n      android: fixture_android_app\n      ios: fixture_ios_app\n';

  /** apps/subly has a pubspec; the fixture tree does not copy it, so cases that
   *  are ABOUT the dependency have to supply one. Written rather than copied so
   *  each case states exactly the dependency set it is testing. */
  const pubspec = (deps) =>
    'name: subly\nenvironment:\n  sdk: ">=3.5.0 <4.0.0"\ndependencies:\n' +
    deps.map((d) => `  ${d}:\n    path: ../../packages/x\n`).join('');

  test('POSITIVE CONTROL — no declaration and no dependency is the shipped tree', () => {
    const root = tree();
    try {
      put(root, 'apps/subly/pubspec.yaml', pubspec(['nikatru_purchases']));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `expected a clean tree, got ${code}:\n${out}`);
      // The empty forward domain is PRINTED, never resolved to an ok line — an
      // ok here would read as "the sworn IAP rows were checked" when none exist.
      assert.match(out, /limb 6 — NO app declares/);
    } finally { kill(root); }
  });

  test('declared WITHOUT the bridge dependency fails', () => {
    const root = tree();
    try {
      put(root, 'apps/subly/pubspec.yaml', pubspec(['nikatru_purchases']));
      put(root, APP_YAML, get(root, APP_YAML) + IAP_BLOCK);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /does not depend on nikatru_billing_revenuecat/);
    } finally { kill(root); }
  });

  test('the DEPENDENCY without the declaration fails — the expensive direction', () => {
    // 🔴 THIS IS THE CASE THAT PROTECTS ANYBODY. The binary gains StoreKit and
    // the Play Billing Library, both sworn store declarations change, and
    // nothing else in the tree says so.
    const root = tree();
    try {
      put(
        root,
        'apps/subly/pubspec.yaml',
        pubspec(['nikatru_purchases', 'nikatru_billing_revenuecat']),
      );
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /declares no .billing\.mobileIap./);
    } finally { kill(root); }
  });

  test('a RevenueCat TOMBSTONE comment is not a dependency', () => {
    // apps/subly's real pubspec carries a comment recording why no billing
    // aggregator is present. A substring search over the file reports the
    // dependency this limb exists to detect; comments are stripped first.
    const root = tree();
    try {
      put(
        root,
        'apps/subly/pubspec.yaml',
        pubspec(['nikatru_purchases']) +
          '  # nikatru_billing_revenuecat: deliberately absent — see ADR 026.\n',
      );
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `a comment must not read as a dependency:\n${out}`);
    } finally { kill(root); }
  });

  test('declared, depended on, but the Play form does not swear Purchase history', () => {
    const root = tree();
    try {
      put(
        root,
        'apps/subly/pubspec.yaml',
        pubspec(['nikatru_purchases', 'nikatru_billing_revenuecat']),
      );
      put(root, APP_YAML, get(root, APP_YAML) + IAP_BLOCK);
      const ds = JSON.parse(get(root, 'apps/subly/store/android-play/data-safety.json'));
      const posture = ds.buildPosture.current;
      for (const a of ds.answers) {
        if (a.type === 'Purchase history') a.collected[posture] = false;
      }
      putJson(root, 'apps/subly/store/android-play/data-safety.json', ds);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /does not swear "Purchase history"/);
    } finally { kill(root); }
  });

  test('declared, depended on, and the Apple manifest names the provider nowhere', () => {
    const root = tree();
    try {
      put(
        root,
        'apps/subly/pubspec.yaml',
        pubspec(['nikatru_purchases', 'nikatru_billing_revenuecat']),
      );
      put(root, APP_YAML, get(root, APP_YAML) + IAP_BLOCK);
      const rel = 'apps/subly/store/ios-appstore/privacy-manifest.json';
      const apple = get(root, rel)
        .replace(/purchases_flutter/g, 'some_other_package')
        .replace(/RevenueCat/gi, 'SomeOtherVendor');
      put(root, rel, apple);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /names the provider nowhere/);
    } finally { kill(root); }
  });

  test('the schema refuses a billing block that is missing half the app ids', () => {
    // An app that declares mobile IAP with only one platform id is an app whose
    // other store build configures the SDK against nothing.
    const root = tree();
    try {
      put(
        root,
        APP_YAML,
        get(root, APP_YAML) +
          '\nbilling:\n  mobileIap:\n    provider: revenuecat\n' +
          '    entitlementId: pro\n    revenuecatAppIds:\n      android: only_android\n',
      );
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /ios/);
    } finally { kill(root); }
  });
});
