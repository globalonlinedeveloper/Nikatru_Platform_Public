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
// `catalog/apps.json` and into every listing file — one per rendered field per
// DECLARED store tree, which is a product and not a constant — are EXACTLY what
// `apps/subscriptiontracker/app.yaml` renders to. If that ever stops holding, the declaration
// and the tree have parted company and every negative case below is about a
// tree nobody ships.
//
// ⚠️ THIS SENTENCE USED TO SAY "twenty-five listing files" AND WAS WRONG THE DAY
// a sixth store tree landed (apps-gov-in, 2026-09-20) — the same stale-constant
// defect that turned two cases below red while the renderer was correct. The
// count is derived now, in prose as well as in code.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseYaml, YamlError } from '../../app-yaml/yaml.mjs';
import { validate, assertSchemaUnderstood, SchemaError } from '../../app-yaml/schema-validate.mjs';
import { appleCategoryUti } from '../../app-yaml/render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-app-yaml.mjs');
const RENDER = join(REPO, 'tooling', 'app-yaml', 'render.mjs');

const APP_YAML = 'apps/subscriptiontracker/app.yaml';
const PRIVACY_YAML = 'apps/subscriptiontracker/privacy.yaml';
const CATALOGUE = 'catalog/apps.json';
const TITLE = 'apps/subscriptiontracker/store/windows-store/title.txt';

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
    'apps/subscriptiontracker/app.yaml',
    'apps/subscriptiontracker/privacy.yaml',
    'catalog/apps.json',
    'tooling/channel-register.json',
    'tooling/legal/provider-register.json',
    'sites/nikatru/subscriptiontracker/privacy.html',
    'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml',
    'extensions/Extension/Full_Screen_Shot/publish/STORE-LISTING.md',
    // limb 3b holds the extension declaration's processors to this file's
    // policy.networkAllowlist, and refuses (2) a declaration without it.
    'extensions/Extension/Full_Screen_Shot/tool.json',
    // the declaration's `app:` is held to this file's slug.
    'extensions/Extension/Full_Screen_Shot/publish/identity.json',
    'extensions/templates/tool/publish/STORE-LISTING.md',
    // ── the six icon-label targets ────────────────────────────────────────
    // Not decoration: a declaration carrying `shortName` and NO target file is
    // a COVERAGE LOST refusal in the renderer, so a fixture missing these would
    // exercise that refusal on every case below instead of the case's own
    // mutation. They are exactly the files ICON_LABEL_TARGETS names.
    'apps/subscriptiontracker/web/manifest.json',
    'apps/subscriptiontracker/android/app/src/main/AndroidManifest.xml',
    'apps/subscriptiontracker/ios/Runner/Info.plist',
    'apps/subscriptiontracker/macos/Runner/Info.plist',
    'apps/subscriptiontracker/pubspec.yaml',
    // ── the shipped Dart limb 8 reads ─────────────────────────────────────
    // Limb 8 refuses with COVERAGE LOST when the app's lib/ or every
    // packages/*/lib holds no Dart file, and fails on an EXEMPT_CIPHER_IMPORTS
    // row whose file is absent. These two are the least that satisfies both:
    // one app file, and the one exempt importer.
    'apps/subscriptiontracker/lib/main.dart',
    'packages/core/lib/src/content/ed25519_pack_verifier.dart',
  ]) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  cpSync(join(REPO, 'apps/subscriptiontracker/store'), join(root, 'apps/subscriptiontracker/store'), { recursive: true });
  // limb 8 (b) reads the rendered store/*/*.txt of a transmitting extension.
  cpSync(join(REPO, 'extensions/Extension/Full_Screen_Shot/store'), join(root, 'extensions/Extension/Full_Screen_Shot/store'), { recursive: true });
  // ⏱ 2026-09-24 — every repository-path `source` the two declarations name.
  // render-privacy refuses a source that does not exist, so a fixture without
  // them would exercise that refusal on every case below. Read off the
  // declarations themselves, so a row that re-points its source brings the new
  // file into the fixture with it.
  for (const rel of ['apps/subscriptiontracker/privacy.yaml', 'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml']) {
    const doc = parseYaml(readFileSync(join(REPO, rel), 'utf8'));
    const rows = [...(doc.collects ?? []), ...(doc.storeDisclosures ?? []), ...(doc.processors ?? []), doc.limitedUse ?? {}];
    for (const src of rows.map((r) => r?.source)) {
      if (typeof src !== 'string' || src.startsWith('https://') || existsSync(join(root, src))) continue;
      mkdirSync(join(root, dirname(src)), { recursive: true });
      cpSync(join(REPO, src), join(root, src));
    }
  }
  return root;
}

const PRIVACY_RENDER = join(REPO, 'tooling', 'app-yaml', 'render-privacy.mjs');
const PLAY_SWORN = 'apps/subscriptiontracker/store/android-play/data-safety.json';
const APPLE_SWORN = 'apps/subscriptiontracker/store/ios-appstore/privacy-manifest.json';
const SITE_NOTICE = 'sites/nikatru/subscriptiontracker/privacy.html';
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
  '    source: apps/subscriptiontracker/store/android-play/data-safety.json',
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

/** The declaration with its top-level `billing:` block removed. ⏱ 2026-09-22 —
 *  apps/subscriptiontracker opted in to mobile IAP, so a case that appends its
 *  own billing block, or is ABOUT an app that has not opted in, must take the
 *  real one away first: appending a second `billing:` key is a different failure
 *  (a duplicate key) from the one the case names. Comments above it stay. */
const withoutBilling = (text) => text.replace(/^billing:\n(?:[ \t]+\S.*\n)*/m, '');

/** Every store listing directory `render.mjs --check` will grade, DERIVED from
 *  the two authorities the renderer itself reads: the register's `kind: "store"`
 *  rows with a `{app}` template, filtered to the ones that exist on disk. The
 *  renderer skips a declared channel with no tree on purpose — creating one is
 *  owner-gated — so "exists" is half the derivation and not an optimisation.
 *
 *  🔴 IT IS DERIVED BECAUSE THE HAND-WRITTEN NUMBER WENT STALE, MEASURED. Two
 *  cases below asserted `=== 5`, "five channels, one short-description each".
 *  On 2026-09-20 `apps/subscriptiontracker/store/apps-gov-in/` was created —
 *  the sixth declared channel finally getting the listing tree the brick had
 *  templated all along — and both cases went red at `got 6` while the renderer
 *  was behaving perfectly: it named all six, the new one included. A constant
 *  that turns a CORRECT renderer red is the same defect as one that lets a
 *  broken one through, and it is the reason assert-store-metadata.mjs computes
 *  REQUIRED_COVERAGE as a RELATIONSHIP rather than a number.
 *
 *  🔴 AND IT IS NOT `plan(root)`. Deriving the expectation by running the
 *  renderer's own planner would make these cases assert the renderer against
 *  itself: delete the listing half of `plan` and the expected set would empty
 *  with the actual one, and both cases would pass over nothing. The register and
 *  the filesystem are read here independently, which is the whole point.
 *
 *  The floor below is what stops the derivation going vacuous: a register that
 *  parsed to zero store rows would make "names every stale file" true by naming
 *  none. */
function listingDirs(root, appId = 'subscriptiontracker') {
  const register = JSON.parse(get(root, 'tooling/channel-register.json'));
  const dirs = (Array.isArray(register.channels) ? register.channels : [])
    .filter((c) => c && c.kind === 'store' && typeof c.storeMetadataDir === 'string' && c.storeMetadataDir.includes('{app}'))
    .map((c) => c.storeMetadataDir.replace('{app}', appId))
    .filter((d) => existsSync(join(root, d)));
  assert.ok(dirs.length >= 2, `the fixture must carry at least two store listing trees or this assertion is vacuous; derived ${dirs.length}`);
  return dirs;
}

/** `--check`'s stale list must name EXACTLY the derived set for `file`: every
 *  directory, and no phantom. Both halves bite — dropping one is the drift the
 *  case exists to catch, and inventing one is a renderer writing where no
 *  channel is declared. */
function assertNamesEveryListing(out, root, file) {
  const dirs = listingDirs(root);
  for (const d of dirs) {
    assert.ok(out.includes(`${d}/${file}`), `--check did not name ${d}/${file}:\n${out}`);
  }
  const named = [...out.matchAll(new RegExp(file.replace('.', '\\.'), 'g'))].length;
  assert.equal(named, dirs.length, `expected ${file} named once per declared listing tree (${dirs.length}), got ${named}:\n${out}`);
}

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
      // One short-description per DECLARED listing tree, derived from the
      // register. A drift check that named only the catalogue would leave the
      // listing copy silently forked.
      assertNamesEveryListing(out, root, 'short-description.txt');
      assert.equal(spawn(GUARD, [root]).code, 1);
    } finally { kill(root); }
  });

  test('MUTATION: editing the name without re-rendering names every title.txt', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^name: .*$/m, 'name: Subly Pro'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assertNamesEveryListing(out, root, 'title.txt');
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

  test('MUTATION: an EXTENSION processor nobody has named is refused too (S2-claims-08)', () => {
    // ⏱ 2026-09-25. Limb 3 walked apps only, so this exact row — a misspelt
    // processor on the extension surface — exited 0.
    const root = tree();
    try {
      const rel = 'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml';
      const text = get(root, rel);
      assert.ok(text.includes('\nprocessors: []\n'), 'the extension declaration must still carry `processors: []` for this mutation to mean anything');
      put(root, rel, text.replace('\nprocessors: []\n', [
        '',
        'processors:',
        '  - id: cloudflre',
        '    role: infrastructure',
        '    purpose: A misspelt party, schema-valid in every other respect.',
        '    source: tooling/legal/provider-register.json',
        '    asOf: "2026-09-25"',
        '',
      ].join('\n')));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /processor "cloudflre" is not a row in tooling\/legal\/provider-register\.json/);
    } finally { kill(root); }
  });

  test('MUTATION: an extension that allowlists a host while declaring `processors: []` is refused (S2-claims-01)', () => {
    const root = tree();
    try {
      const rel = 'extensions/Extension/Full_Screen_Shot/tool.json';
      const t = readJson(root, rel);
      assert.deepEqual(t.policy.networkAllowlist, [], 'FullShot must still allowlist nothing for this mutation to mean anything');
      t.policy.networkAllowlist = ['api.example.test'];
      putJson(root, rel, t);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /declares `processors: \[\]` — nothing leaves the device — but .*tool\.json allowlists 1 network destination/);
      // limb 8 (a): the same tool now transmits, and all three halves of its
      // declaration still say it does not.
      assert.match(out, /the tool transmits, but the declaration says `collects: \[\]`/);
      assert.match(out, /the tool transmits, but the declaration says `processors: \[\]`/);
      assert.match(out, /the tool transmits, but "Authentication information" is `not-collected`/);
      assert.match(out, /limb 8 — 1 transmitting tools/);
    } finally { kill(root); }
  });

  test('MUTATION: a transmitting extension whose rendered store text says "No cloud" is refused (limb 8 b)', () => {
    const root = tree();
    try {
      const toolRel = 'extensions/Extension/Full_Screen_Shot/tool.json';
      const t = readJson(root, toolRel);
      t.policy.networkAllowlist = ['api.example.test'];
      putJson(root, toolRel, t);
      const txt = 'extensions/Extension/Full_Screen_Shot/store/edge/long-description.txt';
      put(root, txt, `${get(root, txt)}No cloud.\n`);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /store\/edge\/long-description\.txt: says "No cloud", but the tool transmits/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: a transmitting extension with no rendered store text exits 2 (limb 8 b)', () => {
    const root = tree();
    try {
      const toolRel = 'extensions/Extension/Full_Screen_Shot/tool.json';
      const t = readJson(root, toolRel);
      t.policy.networkAllowlist = ['api.example.test'];
      putJson(root, toolRel, t);
      rmSync(join(root, 'extensions/Extension/Full_Screen_Shot/store'), { recursive: true, force: true });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /holds no rendered \.txt file/);
    } finally { kill(root); }
  });

  test('MUTATION: an extension declaration whose `app:` is not its identity.json slug is refused (R20)', () => {
    const root = tree();
    try {
      const rel = 'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml';
      const text = get(root, rel);
      assert.ok(text.includes('\napp: fullshot\n'), 'the extension declaration must still say `app: fullshot` for this mutation to mean anything');
      put(root, rel, text.replace('\napp: fullshot\n', '\napp: fullshots\n'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /declares app "fullshots" but .*identity\.json names slug "fullshot"/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: an extension declaration with no identity.json beside it exits 2', () => {
    const root = tree();
    try {
      rmSync(join(root, 'extensions/Extension/Full_Screen_Shot/publish/identity.json'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /has no extensions\/Extension\/Full_Screen_Shot\/publish\/identity\.json beside it/);
    } finally { kill(root); }
  });

  test('POSITIVE CONTROL: the real extension transmits nothing and says so — 0 transmitting tools', () => {
    const root = tree();
    try {
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, out);
      assert.match(out, /limb 3b — 0 transmitting tools among 1 extension declaration/);
      assert.match(out, /limb 8 — 0 transmitting tools/);
    } finally { kill(root); }
  });

  test('COVERAGE LOST: an extension declaration with no tool.json beside it exits 2', () => {
    const root = tree();
    try {
      rmSync(join(root, 'extensions/Extension/Full_Screen_Shot/tool.json'));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.match(out, /has no extensions\/Extension\/Full_Screen_Shot\/tool\.json beside it/);
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
      rmSync(join(root, 'apps/subscriptiontracker/store'), { recursive: true });
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
      // ⚠️ READ FROM THE DECLARATION, not typed. This carried the brand as a
      // literal until the 2026-09-09 rename, at which point the case failed on a
      // string nothing produces any more rather than on the property it is
      // about — that a tagline edit leaves the title alone.
      const declaredName = get(root, APP_YAML).match(/^name: (.*)$/m)[1].trim();
      assert.equal(get(root, TITLE), `${declaredName}\n`, 'a tagline change must not touch the title');
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
      'apps/subscriptiontracker/store/android-play/data-safety.json',
      'apps/subscriptiontracker/store/android-play/content-rating.json',
      'apps/subscriptiontracker/store/android-play/ads-declaration.json',
      'apps/subscriptiontracker/store/ios-appstore/privacy-manifest.json',
      'apps/subscriptiontracker/store/android-play/long-description.txt',
      'apps/subscriptiontracker/store/ios-appstore/keywords.txt',
      'apps/subscriptiontracker/store/windows-store/search-terms.txt',
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
      rmSync(join(root, 'apps/subscriptiontracker/store/linux-snap'), { recursive: true });
      assert.equal(spawn(RENDER, [root]).code, 0);
      assert.equal(existsSync(join(root, 'apps/subscriptiontracker/store/linux-snap')), false);
    } finally { kill(root); }
  });

  // ── O-APPLE-LISTING-HAS-NO-EULA (2026-09-24) ─────────────────────────────
  // terms-of-use-url.txt is the first RENDERED listing field that only some
  // channels carry. Until this change the renderer wrote every rendered field
  // into every channel tree, and wrote the string `undefined` for a rendered
  // field it had no value for. Measured on the base commit with the new
  // vocabulary row: its renderer wrote terms-of-use-url.txt into all six trees,
  // android-play included, each reading `undefined`.
  test('MUTATION: `legal` without `termsUrl` is a FINDING (1), not a coverage loss', () => {
    const root = tree();
    try {
      const text = get(root, APP_YAML);
      assert.match(text, /^ {2}termsUrl: \S+$/m, 'the real declaration must carry legal.termsUrl for this case to remove it');
      put(root, APP_YAML, text.replace(/^ {2}termsUrl: .*\n/m, ''));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /required property "termsUrl" is absent/);
    } finally { kill(root); }
  });

  test('R4: a channel whose additionalFiles omit terms-of-use-url.txt gets no terms file', () => {
    const TERMS = 'terms-of-use-url.txt';
    const root = tree();
    try {
      const register = readJson(root, 'tooling/channel-register.json');
      const smc = register.storeMetadataContract;
      assert.ok(smc.perChannel['macos-appstore'].additionalFiles.includes(TERMS), 'the real register declares terms on macos-appstore');
      smc.perChannel['macos-appstore'].additionalFiles = smc.perChannel['macos-appstore'].additionalFiles.filter((f) => f !== TERMS);
      putJson(root, 'tooling/channel-register.json', register);
      rmSync(join(root, 'apps/subscriptiontracker/store/macos-appstore', TERMS));
      const { code, out } = spawn(RENDER, [root]);
      assert.equal(code, 0, out);
      // READ FROM THE DECLARATION, not typed, like the tagline case above.
      const termsUrl = get(root, APP_YAML).match(/^ {2}termsUrl: (\S+)$/m)[1];
      // The expected set comes from the register and the filesystem, never from
      // plan(): a case that asked the renderer what it should write would agree
      // with any renderer.
      const rows = register.channels.filter((c) => c && c.kind === 'store' && typeof c.storeMetadataDir === 'string' && c.storeMetadataDir.includes('{app}'));
      let declaring = 0;
      let notDeclaring = 0;
      for (const c of rows) {
        const dir = c.storeMetadataDir.replace('{app}', 'subscriptiontracker');
        if (!existsSync(join(root, dir))) continue;
        const declared = [...smc.requiredFiles, ...(smc.perChannel[c.id]?.additionalFiles ?? [])].includes(TERMS);
        assert.equal(existsSync(join(root, dir, TERMS)), declared, `${dir}/${TERMS} must exist exactly when "${c.id}" declares it:\n${out}`);
        if (declared) {
          declaring += 1;
          assert.equal(get(root, `${dir}/${TERMS}`), `${termsUrl}\n`);
        } else {
          notDeclaring += 1;
        }
      }
      assert.equal(existsSync(join(root, 'apps/subscriptiontracker/store/android-play', TERMS)), false, 'android-play declares no terms URL');
      assert.ok(declaring >= 1 && notDeclaring >= 2, `the case needs both kinds of channel to mean anything: ${declaring} declaring, ${notDeclaring} not`);
    } finally { kill(root); }
  });

  test('R5: a rendered field with no value THROWS and writes nothing — never the string `undefined`', () => {
    const root = tree();
    try {
      // render.mjs imports the vocabulary by a path relative to ITSELF, so this
      // case runs a copy of the real renderer and its imports inside the
      // fixture, beside a vocabulary that marks one more field rendered.
      for (const rel of [
        'tooling/app-yaml/render.mjs',
        'tooling/app-yaml/yaml.mjs',
        'tooling/app-yaml/schema-validate.mjs',
        'tooling/app-yaml/schema/app.schema.json',
        'tooling/sites/apex.mjs',
        'contracts/store/vocabulary.js',
      ]) {
        mkdirSync(join(root, dirname(rel)), { recursive: true });
        cpSync(join(REPO, rel), join(root, rel));
      }
      const copy = join(root, 'tooling/app-yaml/render.mjs');
      // Green control first: the copy, unmutated, agrees with the tree.
      const green = spawn(copy, [root, '--check']);
      assert.equal(green.code, 0, green.out);

      const vocabRel = 'contracts/store/vocabulary.js';
      const anchor = "  { name: 'terms-of-use-url.txt', kind: 'url', app: 'additional', extension: null, rendered: true },\n";
      assert.ok(get(root, vocabRel).includes(anchor), 'the vocabulary must still carry the row this case anchors on');
      put(root, vocabRel, get(root, vocabRel).replace(anchor, `${anchor}  { name: 'eula-url.txt', kind: 'url', app: 'additional', extension: null, rendered: true },\n`));
      // Declared on a channel, so a renderer that skipped the value check would
      // write it there.
      const register = readJson(root, 'tooling/channel-register.json');
      register.storeMetadataContract.perChannel['ios-appstore'].additionalFiles.push('eula-url.txt');
      putJson(root, 'tooling/channel-register.json', register);

      const { code, out } = spawn(copy, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /marks "eula-url\.txt" rendered, and this renderer has no value for it/);
      for (const d of listingDirs(root)) {
        assert.equal(existsSync(join(root, d, 'eula-url.txt')), false, `${d}/eula-url.txt must not be written:\n${out}`);
      }
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

  // ⏱ 2026-09-24 (the PR 913 review, L2): `format: date` read `Date.parse(v)`, and
  // V8 parses `2026-02-31` as 3 March, so the format passed a day that does not exist.
  test('`format: date` refuses an impossible calendar date and accepts a real leap day', () => {
    const date = { type: 'string', format: 'date' };
    assert.deepEqual(validate('2026-02-31', date), ['#: "2026-02-31" is not a valid date']);
    assert.deepEqual(validate('2026-04-31', date), ['#: "2026-04-31" is not a valid date']);
    assert.deepEqual(validate('2028-02-29', date), [], 'green control: a real leap day');
    assert.deepEqual(validate('2026-09-24', date), []);
  });
});

describe('limb 4 — the declaration and the two SWORN store declarations agree', () => {
  test('POSITIVE CONTROL: the real tree matches in both directions, and says how many rows it compared', () => {
    // The strongest statement available here: the twelve categories a human
    // swore to Google, the twelve Apple rows derived from them, and the twelve
    // in the notice declaration are the same twelve. If that stops holding,
    // every negative case below is about a tree nobody ships. (Eleven until
    // 2026-09-25: O-OAUTH-NAME-UNDECLARED added Personal info / Name.)
    const root = tree();
    try {
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, out);
      assert.match(out, /limb 4 — 12 collected categor\(ies\) across 1 app\(s\)/);
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
      assert.match(out, /sites\/nikatru\/subscriptiontracker\/privacy\.html/);
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

  test('MUTATION: a `source` naming a file that does not exist is a FINDING in the guard AND in --check', () => {
    // ⏱ 2026-09-24. Before render-privacy graded existence, this exact mutation
    // exited 0 from both: the schema checks a source's shape, and nine FullShot
    // rows went on citing a packet after it was due to be deleted.
    const root = tree();
    try {
      const rel = 'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml';
      const text = get(root, rel);
      const from = 'source: extensions/Extension/Full_Screen_Shot/publish/COMPLIANCE-CHECKLIST.md';
      assert.ok(text.includes(from), 'the extension declaration must still cite COMPLIANCE-CHECKLIST.md for this mutation to mean anything');
      put(root, rel, text.replace(from, 'source: extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY-HOSTING.md'));
      const guard = spawn(GUARD, [root]);
      assert.equal(guard.code, 1, `expected a finding from the guard, got ${guard.code}:\n${guard.out}`);
      assert.match(guard.out, /PRIVACY-POLICY-HOSTING\.md does not exist in this repository/);
      const check = spawn(PRIVACY_RENDER, ['--check', root]);
      assert.equal(check.code, 1, `expected a finding from --check, got ${check.code}:\n${check.out}`);
      assert.match(check.out, /PRIVACY-POLICY-HOSTING\.md does not exist in this repository/);
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

  /** apps/subscriptiontracker has a pubspec; the fixture tree does not copy it, so cases that
   *  are ABOUT the dependency have to supply one. Written rather than copied so
   *  each case states exactly the dependency set it is testing. */
  const pubspec = (deps) =>
    'name: subscriptiontracker\nenvironment:\n  sdk: ">=3.5.0 <4.0.0"\ndependencies:\n' +
    deps.map((d) => `  ${d}:\n    path: ../../packages/x\n`).join('');

  /** The app opted in (`declare`) or not (`undeclare`), whatever the real
   *  declaration says today — each case states the side it is about. */
  const declare = (root) => put(root, APP_YAML, withoutBilling(get(root, APP_YAML)) + IAP_BLOCK);
  const undeclare = (root) => put(root, APP_YAML, withoutBilling(get(root, APP_YAML)));

  const SDK_ROW = 'purchases_flutter 10.13.1';
  const IAP_PACKAGE = 'nikatru_billing_revenuecat';

  /** 🔴 THE STORE ROWS ARE WRITTEN INTO THE FIXTURE, never inherited. They are
   *  what limb 6 grades, so a case that took them from the real files would be
   *  testing whatever the real files say that day. `ios`/`macos` put or remove a
   *  `purchases_flutter <version>` row in that `binaryInventory`; `play` puts or
   *  removes the bridge's `dependencySurface.direct` entry. Nothing else moves. */
  const storeRows = (root, { ios, macos, play }) => {
    const apple = readJson(root, APPLE_SWORN);
    for (const [platform, want] of [['ios', ios], ['macos', macos]]) {
      const rows = apple.binaryInventory[platform].filter((r) => !/^purchases_flutter\b/.test(String(r.binary)));
      if (want) {
        rows.push({ binary: SDK_ROW, manifest: 'fixture', accessedApis: [], basis: ['fixture row'] });
      }
      apple.binaryInventory[platform] = rows;
    }
    putJson(root, APPLE_SWORN, apple);
    const ds = readJson(root, PLAY_SWORN);
    if (play) ds.dependencySurface.direct[IAP_PACKAGE] = { introduces: ['Purchase history'], why: 'fixture entry' };
    else delete ds.dependencySurface.direct[IAP_PACKAGE];
    putJson(root, PLAY_SWORN, ds);
  };

  /** An opted-in app whose pubspec and Play `Purchase history` answer are both
   *  right, so the only variable left is the store rows the case sets. */
  const optedIn = (root, rows) => {
    put(root, 'apps/subscriptiontracker/pubspec.yaml', pubspec(['nikatru_purchases', IAP_PACKAGE]));
    declare(root);
    storeRows(root, rows);
  };

  test('POSITIVE CONTROL — no declaration, no dependency and no store SDK row is clean', () => {
    const root = tree();
    try {
      put(root, 'apps/subscriptiontracker/pubspec.yaml', pubspec(['nikatru_purchases']));
      undeclare(root);
      storeRows(root, { ios: false, macos: false, play: false });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `expected a clean tree, got ${code}:\n${out}`);
      // The empty forward domain is PRINTED, never resolved to an ok line — an
      // ok here would read as "the sworn IAP rows were checked" when none exist.
      assert.match(out, /limb 6 — NO app declares/);
    } finally { kill(root); }
  });

  test('POSITIVE CONTROL — declared, depended on, and every structured store row present is clean', () => {
    const root = tree();
    try {
      optedIn(root, { ios: true, macos: true, play: true });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `expected a clean tree, got ${code}:\n${out}`);
      assert.match(out, /limb 6 — 1 of 1 app\(s\) declare mobile IAP/);
    } finally { kill(root); }
  });

  test('declared WITHOUT the bridge dependency fails', () => {
    const root = tree();
    try {
      put(root, 'apps/subscriptiontracker/pubspec.yaml', pubspec(['nikatru_purchases']));
      declare(root);
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
        'apps/subscriptiontracker/pubspec.yaml',
        pubspec(['nikatru_purchases', 'nikatru_billing_revenuecat']),
      );
      undeclare(root);
      storeRows(root, { ios: false, macos: false, play: false });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /declares no .billing\.mobileIap./);
    } finally { kill(root); }
  });

  test('a RevenueCat TOMBSTONE comment is not a dependency', () => {
    // apps/subscriptiontracker's real pubspec carries a comment recording why no billing
    // aggregator is present. A substring search over the file reports the
    // dependency this limb exists to detect; comments are stripped first.
    const root = tree();
    try {
      put(
        root,
        'apps/subscriptiontracker/pubspec.yaml',
        pubspec(['nikatru_purchases']) +
          '  # nikatru_billing_revenuecat: deliberately absent — see ADR 026.\n',
      );
      undeclare(root);
      storeRows(root, { ios: false, macos: false, play: false });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `a comment must not read as a dependency:\n${out}`);
    } finally { kill(root); }
  });

  test('declared, depended on, but the Play form does not swear Purchase history', () => {
    const root = tree();
    try {
      optedIn(root, { ios: true, macos: true, play: true });
      const ds = JSON.parse(get(root, 'apps/subscriptiontracker/store/android-play/data-safety.json'));
      const posture = ds.buildPosture.current;
      for (const a of ds.answers) {
        if (a.type === 'Purchase history') a.collected[posture] = false;
      }
      putJson(root, 'apps/subscriptiontracker/store/android-play/data-safety.json', ds);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /does not swear "Purchase history"/);
    } finally { kill(root); }
  });

  // 🔴 RED CONTROLS FOR THE PROSE FALSE-PASS, ⏱ 2026-09-22. The Apple half used
  // to regex the WHOLE stringified manifest for /revenue\s*cat|purchases_flutter/i,
  // and the real manifest says, in a `basis`, that "the RevenueCat line is gone"
  // — so a sentence recording the SDK's REMOVAL satisfied the check that it was
  // present. Each case below leaves (and adds) exactly that kind of prose, proves
  // the old regex would have matched it, and requires RED anyway.
  const OLD_TOKEN = /revenue\s*cat|purchases_flutter/i;

  test('RED CONTROL — a manifest that names RevenueCat only in PROSE, with no inventory row, fails', () => {
    const root = tree();
    try {
      optedIn(root, { ios: false, macos: false, play: true });
      const apple = readJson(root, APPLE_SWORN);
      apple.binaryInventory._why = [].concat(apple.binaryInventory._why ?? [], [
        `RevenueCat's ${SDK_ROW} is linked through ${IAP_PACKAGE} on both Apple platforms.`,
      ]);
      putJson(root, APPLE_SWORN, apple);
      assert.match(get(root, APPLE_SWORN), OLD_TOKEN, 'the fixture must carry the prose the old regex matched');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /binaryInventory\.ios has no "purchases_flutter <version>" row/);
      assert.match(out, /binaryInventory\.macos has no "purchases_flutter <version>" row/);
    } finally { kill(root); }
  });

  test('RED CONTROL — an iOS row does not answer for the macOS binary', () => {
    // Two bundles, two aggregated privacy reports. The manifest's `channels`
    // names both App Store channels, so both inventories must carry the row.
    const root = tree();
    try {
      optedIn(root, { ios: true, macos: false, play: true });
      assert.deepEqual(
        readJson(root, APPLE_SWORN).channels.filter((c) => /appstore$/.test(c)).sort(),
        ['ios-appstore', 'macos-appstore'],
        'the fixture manifest must ship on both App Store channels or this case is about nothing',
      );
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /binaryInventory\.macos has no "purchases_flutter <version>" row/);
      assert.doesNotMatch(out, /binaryInventory\.ios has no/);
    } finally { kill(root); }
  });

  test('RED CONTROL — a Play form that names the bridge only in PROSE fails', () => {
    // The Android half reads `dependencySurface.direct`, the map
    // assert-play-declarations holds equal to the pubspec — never the text.
    const root = tree();
    try {
      optedIn(root, { ios: true, macos: true, play: false });
      const ds = readJson(root, PLAY_SWORN);
      ds.dependencySurface._why = [].concat(ds.dependencySurface._why ?? [], [
        `${IAP_PACKAGE} links RevenueCat's purchases_flutter into the Play build.`,
      ]);
      putJson(root, PLAY_SWORN, ds);
      assert.match(get(root, PLAY_SWORN), new RegExp(IAP_PACKAGE), 'the fixture must name the bridge in prose');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /dependencySurface\.direct has no "nikatru_billing_revenuecat" entry/);
    } finally { kill(root); }
  });

  test('an Apple SDK row WITHOUT the declaration fails — the reverse, on the same field', () => {
    const root = tree();
    try {
      put(root, 'apps/subscriptiontracker/pubspec.yaml', pubspec(['nikatru_purchases']));
      undeclare(root);
      storeRows(root, { ios: false, macos: true, play: false });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /binaryInventory\.macos carries a purchases_flutter row and .* declares no .billing\.mobileIap./);
    } finally { kill(root); }
  });

  test('a Play dependencySurface entry WITHOUT the declaration fails — the reverse, on the same field', () => {
    const root = tree();
    try {
      put(root, 'apps/subscriptiontracker/pubspec.yaml', pubspec(['nikatru_purchases']));
      undeclare(root);
      storeRows(root, { ios: false, macos: false, play: true });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /dependencySurface\.direct names nikatru_billing_revenuecat and .* declares no .billing\.mobileIap./);
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
        withoutBilling(get(root, APP_YAML)) +
          '\nbilling:\n  mobileIap:\n    provider: revenuecat\n' +
          '    entitlementId: pro\n    revenuecatAppIds:\n      android: only_android\n',
      );
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `expected a finding, got ${code}:\n${out}`);
      assert.match(out, /ios/);
    } finally { kill(root); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ICON LABEL — `shortName`, and the six OS-level fields it renders into.
//
// The recorded failing cases for the SURGICAL half of the renderer. Everything
// else it writes is a file whose entire content it owns, where staleness is a
// whole-file comparison; these six are one span inside a file that is mostly
// somebody else's, so the failure modes differ in kind:
//
//   · the span is not rewritten at all        → --check must go RED, per file
//   · the span is hand-edited back afterwards → --check must go RED
//   · the ANCHOR is gone from a file that is
//     still there                             → COVERAGE LOST (2), never a skip,
//                                               because a silent skip is exactly
//                                               how a retired brand survives a
//                                               rename in the one field a user
//                                               reads every day
//   · a platform the app was never stamped
//     for                                     → skipped, and skipping is right
//
// ⛔ THE .desktop `Name=` IS NOT IN THIS LIST. It is the sixth OS-level label and
// it reads the same `shortName`, but `tooling/store/render-linux-icons.mjs`
// derives that whole file and assert-launcher-icons.mjs limb 7 re-derives it —
// so its cases live in launcher-icons.test.mjs, where its owner's do.
//
// The label used below shares a token with the declaration's `name` on purpose:
// that rule belongs to assert-app-naming.mjs, and a fixture that violated it
// would be testing two guards at once.
// ─────────────────────────────────────────────────────────────────────────────
const LABEL = 'Subly Label';
const LABEL_TARGETS = [
  ['apps/subscriptiontracker/web/manifest.json', (t) => JSON.parse(t).short_name],
  ['apps/subscriptiontracker/android/app/src/main/AndroidManifest.xml', (t) => t.match(/android:label="([^"]*)"/)?.[1]],
  ['apps/subscriptiontracker/ios/Runner/Info.plist', (t) => t.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/)?.[1]],
  ['apps/subscriptiontracker/macos/Runner/Info.plist', (t) => t.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/)?.[1]],
  ['apps/subscriptiontracker/pubspec.yaml', (t) => t.match(/^msix_config:[\s\S]*?^ {2}display_name: (.*)$/m)?.[1]],
];

/** Set (or replace) `shortName:` in the fixture's declaration. */
function declareShortName(root, value) {
  const text = get(root, APP_YAML);
  const next = /^shortName: .*$/m.test(text)
    ? text.replace(/^shortName: .*$/m, `shortName: ${value}`)
    : text.replace(/^(name: .*)$/m, `$1\nshortName: ${value}`);
  assert.notEqual(next, text, 'the fixture declaration must carry a `name:` line to anchor on');
  put(root, APP_YAML, next);
}

const stripMsix = (root) => {
  const text = get(root, 'apps/subscriptiontracker/pubspec.yaml');
  const at = text.indexOf('\nmsix_config:');
  assert.notEqual(at, -1, 'the fixture pubspec must still carry an msix_config block');
  put(root, 'apps/subscriptiontracker/pubspec.yaml', `${text.slice(0, at)}\n`);
};

describe('the icon label reaches the five OS-level name fields this renderer owns', () => {
  test('declaring shortName makes --check RED naming every one of the five files', () => {
    const root = tree();
    try {
      declareShortName(root, LABEL);
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, `a declared label that has reached no platform file is stale, not ok:\n${out}`);
      for (const [rel] of LABEL_TARGETS) assert.ok(out.includes(rel), `${rel} was not named as stale:\n${out}`);
    } finally { kill(root); }
  });

  test('a write run puts the label in all five, ESCAPED for each format, and --check then passes', () => {
    const root = tree();
    try {
      declareShortName(root, 'Subly & Co');
      const first = spawn(RENDER, [root]);
      assert.equal(first.code, 0, first.out);
      for (const [rel, extract] of LABEL_TARGETS) {
        // One value, three encodings, and that is the point: `&` is markup in
        // XML, ordinary text in JSON and a YAML anchor sigil that forces the
        // scalar to be quoted. A single shared `replace` would get two of the
        // three wrong and produce files that no longer parse.
        const expected = rel.endsWith('.plist') || rel.endsWith('.xml')
          ? 'Subly &amp; Co'
          : rel.endsWith('pubspec.yaml')
            ? '"Subly & Co"'
            : 'Subly & Co';
        assert.equal(extract(get(root, rel)), expected, `${rel} did not receive the label`);
      }
      // The manifest must still PARSE and the plist must still be well formed —
      // an unescaped `&` in XML is a malformed document, and that is the whole
      // reason each target carries its own encoder rather than one shared
      // `replace`. JSON.parse above is the manifest's proof; `&amp;` is the
      // plist's.
      const second = spawn(RENDER, [root, '--check']);
      assert.equal(second.code, 0, second.out);
    } finally { kill(root); }
  });

  test('a hand edit to ONE rendered label is caught, and only that file is named', () => {
    const root = tree();
    try {
      declareShortName(root, LABEL);
      assert.equal(spawn(RENDER, [root]).code, 0);
      const rel = 'apps/subscriptiontracker/android/app/src/main/AndroidManifest.xml';
      put(root, rel, get(root, rel).replace(/android:label="[^"]*"/, 'android:label="Subly Legacy"'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.ok(out.includes(rel), out);
      assert.ok(!out.includes('Info.plist'), `only the file that drifted is stale:\n${out}`);
    } finally { kill(root); }
  });

  test('the anchor GONE from a file that is still there is COVERAGE LOST, not a skip', () => {
    const root = tree();
    try {
      declareShortName(root, LABEL);
      const rel = 'apps/subscriptiontracker/ios/Runner/Info.plist';
      const text = get(root, rel);
      const stripped = text.replace(/[ \t]*<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>\n/, '');
      assert.notEqual(stripped, text, 'the fixture plist must carry the key this case removes');
      put(root, rel, stripped);
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 2, `a field the renderer owns that has vanished must not read as ok:\n${out}`);
      assert.ok(out.includes('CFBundleDisplayName (iOS)'), out);
    } finally { kill(root); }
  });

  test('a platform the app was never stamped for is skipped, not lost', () => {
    const root = tree();
    try {
      declareShortName(root, LABEL);
      rmSync(join(root, 'apps/subscriptiontracker/macos'), { recursive: true, force: true });
      assert.equal(spawn(RENDER, [root]).code, 0);
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 0, `an absent platform directory is not a defect:\n${out}`);
    } finally { kill(root); }
  });

  test('a pubspec with no msix_config block is skipped — `applies` is what makes that safe', () => {
    const root = tree();
    try {
      declareShortName(root, LABEL);
      stripMsix(root);
      const { code, out } = spawn(RENDER, [root]);
      assert.equal(code, 0, `an app not packaged for the Microsoft Store has no such field to render:\n${out}`);
    } finally { kill(root); }
  });

  test('a shortName that reaches NO target at all is COVERAGE LOST', () => {
    const root = tree();
    try {
      declareShortName(root, LABEL);
      for (const dir of ['web', 'android', 'ios', 'macos']) {
        rmSync(join(root, 'apps/subscriptiontracker', dir), { recursive: true, force: true });
      }
      stripMsix(root);
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 2, `a label that reaches no operating system is not a rendered label:\n${out}`);
      assert.ok(out.includes('NOT ONE of the 5 icon-label'), out);
    } finally { kill(root); }
  });

  test('shortName over the 15-character cap is refused by the schema, not truncated', () => {
    const root = tree();
    try {
      declareShortName(root, 'Subly Subscriptions Manager');
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.ok(out.includes('shortName'), out);
    } finally { kill(root); }
  });

  test('no shortName means no label rendering at all — the field is optional in the schema', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^shortName: .*\n/m, ''));
      const before = LABEL_TARGETS.map(([rel]) => get(root, rel));
      const { code, out } = spawn(RENDER, [root]);
      assert.equal(code, 0, out);
      LABEL_TARGETS.forEach(([rel], i) => assert.equal(get(root, rel), before[i], `${rel} must be untouched`));
    } finally { kill(root); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 — O-APPLE-PLIST-KEYS-UNRENDERED. LSApplicationCategoryType and
// ITSAppUsesNonExemptEncryption are rendered from app.yaml into both Apple
// Info.plists. Until then neither key was in either file and assert-app-yaml
// exited 0, because nothing read them: deleting one, or flipping the legal
// answer by hand, was invisible.
// ─────────────────────────────────────────────────────────────────────────────
const IOS_PLIST = 'apps/subscriptiontracker/ios/Runner/Info.plist';
const MAC_PLIST = 'apps/subscriptiontracker/macos/Runner/Info.plist';
const CATEGORY_KEY = /\t<key>LSApplicationCategoryType<\/key>\n\t<string>[^<]*<\/string>\n/;
const ENCRYPTION_KEY = /\t<key>ITSAppUsesNonExemptEncryption<\/key>\n\t<(?:true|false)\/>\n/;
const withoutPlistKeys = (text) => text.replace(CATEGORY_KEY, '').replace(ENCRYPTION_KEY, '');

describe('the two Apple Info.plist keys are rendered from app.yaml', () => {
  test('the committed plists are exactly what a render of a key-less plist writes', () => {
    const root = tree();
    try {
      put(root, IOS_PLIST, withoutPlistKeys(get(root, IOS_PLIST)));
      put(root, MAC_PLIST, withoutPlistKeys(get(root, MAC_PLIST)));
      assert.doesNotMatch(get(root, IOS_PLIST), /LSApplicationCategoryType|ITSAppUsesNonExemptEncryption/);
      const stale = spawn(RENDER, [root, '--check']);
      assert.equal(stale.code, 1, `a plist missing both keys is stale:\n${stale.out}`);
      assert.ok(stale.out.includes(IOS_PLIST) && stale.out.includes(MAC_PLIST), stale.out);
      assert.equal(spawn(RENDER, [root]).code, 0);
      assert.equal(get(root, IOS_PLIST), readFileSync(join(REPO, IOS_PLIST), 'utf8'));
      assert.equal(get(root, MAC_PLIST), readFileSync(join(REPO, MAC_PLIST), 'utf8'));
      assert.match(get(root, MAC_PLIST), /<key>ITSAppUsesNonExemptEncryption<\/key>\n\t<false\/>\n<\/dict>\n<\/plist>\n$/);
    } finally { kill(root); }
  });

  test('deleting ONE rendered key is RED in assert-app-yaml, naming that plist only', () => {
    const root = tree();
    try {
      put(root, MAC_PLIST, get(root, MAC_PLIST).replace(CATEGORY_KEY, ''));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, `the category key deleted from the macOS plist must not read as ok:\n${out}`);
      assert.ok(out.includes(MAC_PLIST), out);
      assert.ok(!out.includes(IOS_PLIST), `only the file that lost its key is stale:\n${out}`);
    } finally { kill(root); }
  });

  test('a hand-edited category value is replaced in place, never written twice', () => {
    const root = tree();
    try {
      put(root, IOS_PLIST, get(root, IOS_PLIST).replace('public.app-category.productivity', 'public.app-category.games'));
      const stale = spawn(RENDER, [root, '--check']);
      assert.equal(stale.code, 1, stale.out);
      assert.ok(stale.out.includes(IOS_PLIST), stale.out);
      assert.equal(spawn(RENDER, [root]).code, 0);
      assert.equal(get(root, IOS_PLIST), readFileSync(join(REPO, IOS_PLIST), 'utf8'));
      assert.equal(get(root, IOS_PLIST).split('<key>LSApplicationCategoryType</key>').length - 1, 1);
    } finally { kill(root); }
  });

  test('declaring usesNonExemptEncryption: true flips <false/> to <true/> in both plists and changes nothing else', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace('  usesNonExemptEncryption: false', '  usesNonExemptEncryption: true'));
      const iosBefore = get(root, IOS_PLIST);
      const macBefore = get(root, MAC_PLIST);
      const { code, out } = spawn(RENDER, [root]);
      assert.equal(code, 0, out);
      const flip = (t) => t.replace('<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>', '<key>ITSAppUsesNonExemptEncryption</key>\n\t<true/>');
      assert.notEqual(flip(iosBefore), iosBefore, 'the fixture plist must carry the false this case flips');
      assert.equal(get(root, IOS_PLIST), flip(iosBefore));
      assert.equal(get(root, MAC_PLIST), flip(macBefore));
    } finally { kill(root); }
  });

  test('an app with no Apple target is skipped, and its category is never asked for a UTI', () => {
    const root = tree();
    try {
      rmSync(join(root, 'apps/subscriptiontracker/ios'), { recursive: true, force: true });
      rmSync(join(root, 'apps/subscriptiontracker/macos'), { recursive: true, force: true });
      put(root, APP_YAML, get(root, APP_YAML).replace(/^category: .*$/m, 'category: Games'));
      const { code, out } = spawn(RENDER, [root]);
      assert.equal(code, 0, `no Apple plist means no Apple category to map:\n${out}`);
      assert.ok(!out.includes('APPLE_CATEGORY_UTI'), out);
    } finally { kill(root); }
  });

  test('a plist with no root </dict> close is COVERAGE LOST, even though both keys are still in it', () => {
    const root = tree();
    try {
      const text = get(root, MAC_PLIST);
      const stripped = text.replace(/<\/dict>\n<\/plist>\n$/, '</plist>\n');
      assert.notEqual(stripped, text, 'the fixture plist must end with the root close this case removes');
      assert.match(stripped, /ITSAppUsesNonExemptEncryption/);
      put(root, MAC_PLIST, stripped);
      const r = spawn(RENDER, [root, '--check']);
      assert.equal(r.code, 2, `a plist the renderer cannot anchor in must not read as ok or as stale:\n${r.out}`);
      assert.ok(r.out.includes(MAC_PLIST), r.out);
      const g = spawn(GUARD, [root]);
      assert.equal(g.code, 2, g.out);
    } finally { kill(root); }
  });

  test('a category with no Apple UTI is an authoring error that names the map, and nothing is written', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace(/^category: .*$/m, 'category: Games'));
      const before = get(root, IOS_PLIST);
      const { code, out } = spawn(RENDER, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('APPLE_CATEGORY_UTI') && out.includes('"Games"'), out);
      assert.equal(get(root, IOS_PLIST), before, 'a refused render writes nothing');
    } finally { kill(root); }
  });

  test('a key written twice is refused, not guessed', () => {
    const root = tree();
    try {
      const text = get(root, IOS_PLIST);
      put(root, IOS_PLIST, text.replace('</dict>\n</plist>\n', '\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<true/>\n</dict>\n</plist>\n'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.ok(out.includes('<key>ITSAppUsesNonExemptEncryption</key> 2 times'), out);
    } finally { kill(root); }
  });

  test('appleCategoryUti: an empty map is COVERAGE LOST, an unmapped word a problem, a mapped word its UTI', () => {
    assert.ok(appleCategoryUti('Productivity', {}).lost);
    assert.ok(appleCategoryUti('Games').problem);
    assert.deepEqual(appleCategoryUti('Productivity'), { uti: 'public.app-category.productivity' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 — ONE RULE FOR EVERY MACHINE THE DATA SITS ON.
// apps/subscriptiontracker/privacy.yaml listed `oracle-cloud` (the vendor of the
// identity machine) and omitted `hostinger` (the vendor of the LIVE crash sink)
// under a self-hosted rule applied to one vendor only (HANDOFF-stores REVIEW #12;
// owner decision "Name Hostinger"). These cases read the REAL tree, so the old
// declaration is RED here: a live register row that receives personal data and
// is missing from an app's processors fails, and so does a processor whose
// register row does not record the rendered notice in `namedIn` — the record
// that makes assert-policy-claims limb (b) re-read the page on every run.
// ─────────────────────────────────────────────────────────────────────────────
describe('every live vendor that receives personal data is named in each app notice', () => {
  const register = JSON.parse(readFileSync(join(REPO, 'tooling/legal/provider-register.json'), 'utf8'));
  const providers = Array.isArray(register.providers) ? register.providers : [];
  const byId = new Map(providers.map((p) => [p.id, p]));
  const appDeclarations = readdirSync(join(REPO, 'apps'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(REPO, 'apps', d.name, 'privacy.yaml')))
    .map((d) => ({ app: d.name, doc: parseYaml(readFileSync(join(REPO, 'apps', d.name, 'privacy.yaml'), 'utf8')) }))
    .filter(({ doc }) => doc.surface === 'app');
  const liveSinks = providers.filter((p) => p.status === 'live' && Array.isArray(p.receives) && p.receives.length > 0);

  test('the domain is not empty — an empty quantifier would pass over nothing', () => {
    assert.ok(appDeclarations.length >= 1, 'no app-surface apps/*/privacy.yaml was read');
    assert.ok(liveSinks.length >= 2, `expected at least two live sinks, read ${liveSinks.map((p) => p.id).join(', ')}`);
    assert.ok(liveSinks.some((p) => p.id === 'hostinger'), 'hostinger is the live crash sink and must be read as one');
  });

  test('each app declaration lists every live sink as a processor', () => {
    for (const { app, doc } of appDeclarations) {
      const ids = new Set((doc.processors ?? []).map((p) => p.id));
      const missing = liveSinks.filter((p) => !ids.has(p.id)).map((p) => p.id);
      assert.deepEqual(missing, [], `apps/${app}/privacy.yaml omits live sink(s): ${missing.join(', ')}`);
    }
  });

  test('each processor records the rendered notice in its register row `namedIn`', () => {
    for (const { app, doc } of appDeclarations) {
      const page = `${app}/privacy.html`;
      for (const pr of doc.processors ?? []) {
        const row = byId.get(pr.id);
        assert.ok(row, `processor ${pr.id} has no row in tooling/legal/provider-register.json`);
        assert.ok(
          (row.namedIn ?? []).includes(page),
          `provider ${pr.id} does not record ${page} in namedIn, so assert-policy-claims never re-reads that page for it`,
        );
      }
    }
  });

  // ⏱ 2026-09-25 — the cell is the register row's `name` (the company), no
  // longer the id: O-APP-PRIVACY-OMITS-STORE-BILLING.
  test('the rendered notice itself carries a table row for every processor, by its company name', () => {
    for (const { app, doc } of appDeclarations) {
      const html = readFileSync(join(REPO, 'sites', 'nikatru', app, 'privacy.html'), 'utf8');
      for (const pr of doc.processors ?? []) {
        const name = byId.get(pr.id)?.name;
        assert.ok(typeof name === 'string', `processor ${pr.id} has no named row in tooling/legal/provider-register.json`);
        assert.ok(html.includes(`<tr><td>${name}</td>`), `sites/nikatru/${app}/privacy.html has no row for ${pr.id} (${name})`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-15 · [ADR 085] A — the RevenueCat app-id routing map is RENDERED.
// The platform verifier routes an event to the app that declares its RevenueCat
// app id; the Worker cannot read YAML, so render.mjs writes the table into
// services/platform/src/lib/mor/revenuecat-app-ids.ts. Each case is declared on
// its own (assert-no-loop-cases).
describe('ADR 085 A — the RevenueCat app-id map is rendered from the declarations', () => {
  const MODULE = 'services/platform/src/lib/mor/revenuecat-app-ids.ts';
  const IAP =
    '\nbilling:\n  mobileIap:\n    provider: revenuecat\n    entitlementId: pro\n' +
    '    revenuecatAppIds:\n      android: rc_fixture_android\n      ios: rc_fixture_ios\n';
  const withModule = () => {
    const root = tree();
    mkdirSync(join(root, dirname(MODULE)), { recursive: true });
    cpSync(join(REPO, MODULE), join(root, MODULE));
    return root;
  };

  test('the committed module matches the declarations', () => {
    // ⏱ 2026-09-22 — this case used to pin the EMPTY map ("no app declares
    // mobile IAP today"). apps/subscriptiontracker opted in, so the expectation is
    // read from the declaration itself: every declared id routes to its app, and
    // an app that declares none leaves the map empty.
    const root = withModule();
    try {
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 0, out);
      const ids = parseYaml(get(root, APP_YAML))?.billing?.mobileIap?.revenuecatAppIds ?? {};
      const text = get(root, MODULE);
      if (Object.keys(ids).length === 0) {
        assert.match(text, /export const REVENUECAT_APP_IDS: Readonly<Record<string, string>> = \{\n\};/);
      }
      for (const rc of Object.values(ids)) assert.match(text, new RegExp(`"${rc}": "subscriptiontracker",`));
    } finally { kill(root); }
  });

  test('a declaration renders its ids into the module, and --check names the stale file first', () => {
    const root = withModule();
    try {
      put(root, APP_YAML, withoutBilling(get(root, APP_YAML)) + IAP);
      const stale = spawn(RENDER, [root, '--check']);
      assert.equal(stale.code, 1, stale.out);
      assert.match(stale.out, /revenuecat-app-ids\.ts/);
      const wrote = spawn(RENDER, [root]);
      assert.equal(wrote.code, 0, wrote.out);
      const text = get(root, MODULE);
      assert.match(text, /"rc_fixture_android": "subscriptiontracker",/);
      assert.match(text, /"rc_fixture_ios": "subscriptiontracker",/);
    } finally { kill(root); }
  });

  test('a HAND EDIT to the module is refused by --check', () => {
    const root = withModule();
    try {
      put(root, MODULE, get(root, MODULE).replace('= {\n', '= {\n  "rc_hand": "subscriptiontracker",\n'));
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.equal(code, 1, out);
      assert.match(out, /revenuecat-app-ids\.ts/);
    } finally { kill(root); }
  });

  test('one RevenueCat id declared by TWO apps is a problem, never last-writer-wins', () => {
    const root = withModule();
    try {
      put(root, APP_YAML, withoutBilling(get(root, APP_YAML)) + IAP);
      mkdirSync(join(root, 'apps/twin'), { recursive: true });
      // The twin carries no `shortName`, so it is not asked for icon-label files
      // this fixture has no reason to copy.
      put(
        root,
        'apps/twin/app.yaml',
        get(root, APP_YAML).replace(/^id: subscriptiontracker$/m, 'id: twin').replace(/^shortName:.*\n/m, ''),
      );
      const { code, out } = spawn(RENDER, [root, '--check']);
      assert.notEqual(code, 0, out);
      assert.match(out, /revenuecatAppIds\.android is "rc_fixture_android", which apps\/subscriptiontracker\/app\.yaml\s+also declares/);
    } finally { kill(root); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('limb 7 — AI content is declared, and its consequences hold, both ways', () => {
  // O-PLAY-AI-CONTENT-REPORTING. Every case mutates the REAL declaration tree.
  const CR = 'apps/subscriptiontracker/store/android-play/content-rating.json';
  const DS = 'apps/subscriptiontracker/store/android-play/data-safety.json';
  const CFG = 'apps/subscriptiontracker/lib/core/app_config.dart';
  const TABLE = 'table:platform_db.content_reports';
  const flipTrue = (root) =>
    put(root, APP_YAML, get(root, APP_YAML).replace('  generatesContent: false', '  generatesContent: true'));
  const writeLib = (root, rel, text) => {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    put(root, rel, text);
  };

  test('POSITIVE CONTROL — the shipped tree answers false and carries the claim', () => {
    const root = tree();
    try {
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `expected a clean tree, got ${code}:\n${out}`);
      assert.match(out, /limb 7 — NO app declares `ai\.generatesContent: true`/);
    } finally { kill(root); }
  });

  test('a declaration that does not answer at all fails the schema', () => {
    const root = tree();
    try {
      const text = get(root, APP_YAML);
      assert.ok(text.includes('ai:\n  generatesContent: false\n'), 'fixture anchor');
      put(root, APP_YAML, text.replace('ai:\n  generatesContent: false\n', ''));
      const { code, out } = spawn(GUARD, [root]);
      assert.notEqual(code, 0, out);
      assert.match(out, /ai/);
    } finally { kill(root); }
  });

  test('false with the claim gone fails', () => {
    const root = tree();
    try {
      const cr = JSON.parse(get(root, CR));
      cr.claims = cr.claims.filter((c) => c.id !== 'generates-ai-content');
      putJson(root, CR, cr);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /generates-ai-content` claim is absent/);
    } finally { kill(root); }
  });

  test('false with a floor tell dropped fails, naming it', () => {
    const root = tree();
    try {
      const cr = JSON.parse(get(root, CR));
      const claim = cr.claims.find((c) => c.id === 'generates-ai-content');
      claim.tells.dartPackages = claim.tells.dartPackages.filter((p) => p !== 'firebase_ai');
      putJson(root, CR, cr);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /missing the tell\(s\) firebase_ai/);
    } finally { kill(root); }
  });

  test('false while the app constant says true fails', () => {
    const root = tree();
    try {
      writeLib(root, CFG, 'class AppConfig {\n  static const bool generatesAiContent = true;\n}\n');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /says `generatesAiContent = true` and .* declares `ai\.generatesContent: false`/);
    } finally { kill(root); }
  });

  test('true with nothing behind it fails three ways', () => {
    const root = tree();
    try {
      flipTrue(root);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /declares no `generatesAiContent` constant/);
      assert.match(out, /nothing under apps\/subscriptiontracker\/lib opens the report dialog/);
      assert.match(out, /still EXCLUDES table:platform_db\.content_reports/);
    } finally { kill(root); }
  });

  test('a wiring that exists only in a comment is not a wiring', () => {
    const root = tree();
    try {
      flipTrue(root);
      writeLib(root, CFG, 'class AppConfig {\n  static const bool generatesAiContent = true;\n}\n');
      writeLib(root, 'apps/subscriptiontracker/lib/x.dart', '// showReportContentDialog(context, ref)\n');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /opens the report dialog/);
    } finally { kill(root); }
  });

  test('true with the constant, the control and the Data safety answer passes', () => {
    const root = tree();
    try {
      flipTrue(root);
      writeLib(root, CFG, 'class AppConfig {\n  static const bool generatesAiContent = true;\n}\n');
      writeLib(root, 'apps/subscriptiontracker/lib/x.dart', 'void f() { showReportContentDialog(context, ref); }\n');
      const ds = JSON.parse(get(root, DS));
      assert.ok(TABLE in ds.inventory.notFromThisApp, 'fixture anchor');
      delete ds.inventory.notFromThisApp[TABLE];
      ds.answers[0].inventoryRows = [...(ds.answers[0].inventoryRows ?? []), TABLE];
      putJson(root, DS, ds);
      const cr = JSON.parse(get(root, CR));
      cr.claims.find((c) => c.id === 'generates-ai-content').answer = true;
      putJson(root, CR, cr);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, out);
      assert.match(out, /limb 7 — 1 of 1 app\(s\) generate AI content/);
    } finally { kill(root); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 — O-APPLE-PLIST-KEYS-UNRENDERED. `usesNonExemptEncryption: false`
// is rendered into ITSAppUsesNonExemptEncryption, which App Store review reads
// as a legal answer. Limb 8 holds that `false` to the Dart that ships: a cipher
// import outside EXEMPT_CIPHER_IMPORTS, a cipher class name, or a direct cipher
// dependency in the app's pubspec is RED. Every case mutates the real tree.
// ─────────────────────────────────────────────────────────────────────────────
describe('limb 8 — an export-compliance `false` holds to the code the app ships', () => {
  const VERIFIER = 'packages/core/lib/src/content/ed25519_pack_verifier.dart';
  const APP_PUBSPEC = 'apps/subscriptiontracker/pubspec.yaml';
  const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
  const writeDart = (root, rel, text) => {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    put(root, rel, text);
  };
  const addDependency = (root, rel, line) => {
    const text = get(root, rel);
    assert.ok(/^dependencies:\n/m.test(text), `fixture anchor: ${rel} has a dependencies block`);
    put(root, rel, text.replace(/^dependencies:\n/m, `dependencies:\n${line}\n`));
  };

  test('POSITIVE CONTROL — the shipped tree declares false and imports cryptography only in the recorded verifier', () => {
    const root = tree();
    try {
      assert.match(get(root, VERIFIER), /^import 'package:cryptography\/cryptography\.dart';$/m, 'fixture anchor');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `expected a clean tree, got ${code}:\n${out}`);
      assert.match(out, /limb 8 — 1 app\(s\) declare no non-exempt encryption; 2 shipped Dart file\(s\) carry no cipher class/);
    } finally { kill(root); }
  });

  test('RC3 — a cipher dependency and its import in the app, with false declared, is RED on both', () => {
    const root = tree();
    try {
      addDependency(root, APP_PUBSPEC, '  cryptography: ^2.7.0');
      writeDart(root, 'apps/subscriptiontracker/lib/core/vault.dart', "import 'package:cryptography/cryptography.dart';\n\nfinal vault = 1;\n");
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('apps/subscriptiontracker/app.yaml declares no non-exempt encryption and imports cryptography at apps/subscriptiontracker/lib/core/vault.dart:1'), out);
      assert.ok(out.includes(`${APP_PUBSPEC} depends directly on cryptography`), out);
    } finally { kill(root); }
  });

  test('a direct cipher dependency in the app pubspec with no import anywhere is still RED', () => {
    const root = tree();
    try {
      addDependency(root, APP_PUBSPEC, '  pointycastle: ^3.9.1');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes(`${APP_PUBSPEC} depends directly on pointycastle`), out);
    } finally { kill(root); }
  });

  test('a cipher import in a shared package names the file and the line the import is on, past a block comment', () => {
    const root = tree();
    try {
      writeDart(root, 'packages/core/lib/src/sealed.dart', "/* two\n   lines */\n// one\nimport 'package:pointycastle/export.dart';\n");
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('imports pointycastle at packages/core/lib/src/sealed.dart:4'), out);
      assert.ok(out.includes('every app linking it (subscriptiontracker)'), out);
    } finally { kill(root); }
  });

  test('an exemption covers one package in one file: the verifier importing a second cipher package is RED', () => {
    const root = tree();
    try {
      put(root, VERIFIER, get(root, VERIFIER).replace("import 'package:cryptography/cryptography.dart';", "import 'package:cryptography/cryptography.dart';\nimport 'package:encrypt/encrypt.dart';"));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes(`imports encrypt at ${VERIFIER}:4`), out);
      assert.ok(!out.includes('imports cryptography at'), `the recorded pair stays exempt:\n${out}`);
    } finally { kill(root); }
  });

  test('a commented-out cipher import, and a comment naming a cipher class, are not code', () => {
    // The block comment puts the import at the START of a line and the doc
    // comment names a class the section 1 grep matches: both are red without
    // the comment strip, which is what this case exists to hold.
    const root = tree();
    try {
      writeDart(
        root,
        'apps/subscriptiontracker/lib/core/later.dart',
        "/*\nimport 'package:sodium/sodium.dart';\n*/\n/// Signed, never sealed: no AesGcm here.\nfinal later = 1;\n",
      );
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, out);
    } finally { kill(root); }
  });

  test('a cipher class named in the EXEMPT file is RED: the exemption is for a package, not for what is done with it', () => {
    const root = tree();
    try {
      put(root, VERIFIER, `${get(root, VERIFIER)}\nfinal _sealer = AesGcm.with256bits();\n`);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, new RegExp(`names the cipher \`AesGcm\` at ${VERIFIER.replace(/[./]/g, '\\$&')}:\\d+`));
    } finally { kill(root); }
  });

  test('an exemption whose file no longer imports its package is RED as stale', () => {
    const root = tree();
    try {
      put(root, VERIFIER, get(root, VERIFIER).replace("import 'package:cryptography/cryptography.dart';\n", ''));
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes(`records ${VERIFIER} importing cryptography, and it no longer does`), out);
    } finally { kill(root); }
  });

  test('an exemption whose file is gone is RED as stale', () => {
    const root = tree();
    try {
      rmSync(join(root, VERIFIER));
      writeDart(root, 'packages/core/lib/nikatru_core.dart', 'library nikatru_core;\n');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes(`records ${VERIFIER} importing cryptography, and that file does not exist`), out);
    } finally { kill(root); }
  });

  test('an app lib/ with no Dart file is COVERAGE LOST, never a pass', () => {
    const root = tree();
    try {
      rmSync(join(root, 'apps/subscriptiontracker/lib'), { recursive: true, force: true });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.ok(out.includes('limb 8 found no Dart file under apps/subscriptiontracker/lib.'), out);
    } finally { kill(root); }
  });

  test('no Dart file under any packages/*/lib is COVERAGE LOST, never a pass', () => {
    const root = tree();
    try {
      rmSync(join(root, 'packages'), { recursive: true, force: true });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.ok(out.includes('limb 8 found no Dart file under any packages/*/lib.'), out);
    } finally { kill(root); }
  });

  test('the app brick: a cipher dependency in its pubspec is RED, because it stamps false', () => {
    const root = tree();
    try {
      writeDart(root, `${BRICK}/pubspec.yaml`, 'name: {{app_id}}\ndependencies:\n  flutter:\n    sdk: flutter\n  sodium: ^3.4.0\n');
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes(`${BRICK}/pubspec.yaml depends directly on sodium`), out);
    } finally { kill(root); }
  });

  test('the app brick: a cipher import in its lib/ is RED', () => {
    const root = tree();
    try {
      writeDart(root, `${BRICK}/lib/main.dart`, "import 'package:flutter/material.dart';\nimport 'package:webcrypto/webcrypto.dart';\n");
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes(`imports webcrypto at ${BRICK}/lib/main.dart:2`), out);
    } finally { kill(root); }
  });

  test('declaring true is the conservative answer and is not graded: the same import passes', () => {
    const root = tree();
    try {
      put(root, APP_YAML, get(root, APP_YAML).replace('  usesNonExemptEncryption: false', '  usesNonExemptEncryption: true'));
      assert.equal(spawn(RENDER, [root]).code, 0, 'the plists re-render to <true/>');
      writeDart(root, 'apps/subscriptiontracker/lib/core/vault.dart', "import 'package:cryptography/cryptography.dart';\n");
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, out);
      assert.match(out, /limb 8 — every one of 1 app\(s\) declares `usesNonExemptEncryption: true`/);
    } finally { kill(root); }
  });

  test('a declaration with no exportCompliance answer fails the schema', () => {
    const root = tree();
    try {
      const text = get(root, APP_YAML);
      const cut = text.replace(/^exportCompliance:\n(?: {2}.*\n)+/m, '');
      assert.notEqual(cut, text, 'fixture anchor');
      put(root, APP_YAML, cut);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.match(out, /exportCompliance/);
    } finally { kill(root); }
  });
});

describe('limb 9 — every provider the app’s configuration triggers is declared in its privacy.yaml', () => {
  const PROVIDER_REGISTER = 'tooling/legal/provider-register.json';
  /** privacy.yaml with one `processors` row removed; the anchor asserts it was there. */
  const dropProcessor = (root, id) => {
    const text = get(root, PRIVACY_YAML);
    const cut = text.replace(new RegExp(`^  - id: ${id}\\n(?: {4}.*\\n)+\\n?`, 'm'), '');
    assert.notEqual(cut, text, `fixture anchor: privacy.yaml declares ${id}`);
    put(root, PRIVACY_YAML, cut);
  };
  /** Re-render the notice so the case fails on limb 9 alone, not on a stale page. */
  const rerender = (root) => {
    const r = spawn(PRIVACY_RENDER, [root]);
    assert.equal(r.code, 0, `the notice re-renders:\n${r.out}`);
  };
  const setRequiredWhen = (root, id, requiredWhen) => {
    const reg = readJson(root, PROVIDER_REGISTER);
    const row = reg.providers.find((p) => p.id === id);
    assert.ok(row, `fixture anchor: ${PROVIDER_REGISTER} has a ${id} row`);
    if (requiredWhen === undefined) delete row.requiredWhen;
    else row.requiredWhen = requiredWhen;
    putJson(root, PROVIDER_REGISTER, reg);
  };

  test('POSITIVE CONTROL — the shipped tree declares all ten providers its configuration triggers', () => {
    const root = tree();
    try {
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 0, `expected a clean tree, got ${code}:\n${out}`);
      assert.match(out, /limb 9 — 1 app\(s\) graded: 10 required provider\(s\), each declared among 10 processor\(s\), and no `never` provider declared/);
    } finally { kill(root); }
  });

  test('RC1 — revenuecat dropped is RED, pointing at the app.yaml line that names it', () => {
    const root = tree();
    try {
      dropProcessor(root, 'revenuecat');
      rerender(root);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('apps/subscriptiontracker/privacy.yaml: processor "revenuecat" is required and not declared'), out);
      assert.match(out, /apps\/subscriptiontracker\/app\.yaml:\d+ \(billing\.mobileIap\.provider\)/);
    } finally { kill(root); }
  });

  test('google-play dropped is RED, pointing at the channel that sells on play-billing', () => {
    const root = tree();
    try {
      dropProcessor(root, 'google-play');
      rerender(root);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('processor "google-play" is required and not declared'), out);
      assert.match(out, /tooling\/channel-register\.json:\d+ \(android-play purchaseRail\.rail\)/);
    } finally { kill(root); }
  });

  test('apple-app-store dropped is RED, naming both Apple channels', () => {
    const root = tree();
    try {
      dropProcessor(root, 'apple-app-store');
      rerender(root);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('processor "apple-app-store" is required and not declared'), out);
      assert.match(out, /\(ios-appstore purchaseRail\.rail\)/);
      assert.match(out, /\(macos-appstore purchaseRail\.rail\)/);
    } finally { kill(root); }
  });

  test('supabase dropped is RED, pointing at its own register row, because its kind is always', () => {
    const root = tree();
    try {
      dropProcessor(root, 'supabase');
      rerender(root);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('processor "supabase" is required and not declared'), out);
      assert.match(out, /tooling\/legal\/provider-register\.json:\d+ \(requiredWhen always\)/);
    } finally { kill(root); }
  });

  test('RC2 — a `never` provider declared is RED, quoting the reason on its row', () => {
    const root = tree();
    try {
      put(root, PRIVACY_YAML, `${get(root, PRIVACY_YAML)}
  - id: microsoft-store
    role: store_billing
    purpose: Bills and delivers in-app purchases made through that store, under its own terms.
    source: tooling/legal/provider-register.json
    asOf: "2026-09-25"
`);
      rerender(root);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('processor "microsoft-store" is declared, and its row at tooling/legal/provider-register.json:'), out);
      assert.ok(out.includes('says requiredWhen never ("Every Windows channel sells on paddle'), out);
    } finally { kill(root); }
  });

  test('RC4 — a requiredWhen kind the resolver does not know is COVERAGE LOST, never a pass', () => {
    const root = tree();
    try {
      setRequiredWhen(root, 'supabase', { kind: 'sometimes' });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.ok(out.includes('limb 9 cannot judge tooling/legal/provider-register.json'), out);
      assert.ok(out.includes('provider "supabase" requiredWhen.kind is "sometimes"'), out);
    } finally { kill(root); }
  });

  test('a register row with no requiredWhen at all is COVERAGE LOST, not a provider nobody needs', () => {
    const root = tree();
    try {
      setRequiredWhen(root, 'revenuecat', undefined);
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 2, out);
      assert.ok(out.includes('provider "revenuecat" has no requiredWhen object'), out);
    } finally { kill(root); }
  });

  test('a `never` with a reason too short to read is RED as malformed', () => {
    const root = tree();
    try {
      setRequiredWhen(root, 'lemon-squeezy', { kind: 'never', why: 'retired' });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('tooling/legal/provider-register.json: provider "lemon-squeezy" requiredWhen.why must say'), out);
    } finally { kill(root); }
  });

  test('a channelRail naming a rail no channel register row defines is RED as malformed', () => {
    const root = tree();
    try {
      setRequiredWhen(root, 'paddle', { kind: 'channelRail', rail: 'padle' });
      const { code, out } = spawn(GUARD, [root]);
      assert.equal(code, 1, out);
      assert.ok(out.includes('provider "paddle" requiredWhen.rail is "padle", which is not a selling rail'), out);
    } finally { kill(root); }
  });
});

describe('render-privacy — the notice names each processor by its company, from the register', () => {
  test('the rendered table prints the register `name`, not the id', () => {
    const root = tree();
    try {
      put(root, SITE_NOTICE, '');
      const r = spawn(PRIVACY_RENDER, [root]);
      assert.equal(r.code, 0, r.out);
      const page = get(root, SITE_NOTICE);
      assert.ok(page.includes('<tr><td>RevenueCat</td><td>iap aggregator</td>'), page);
      assert.ok(page.includes('<tr><td>Apple App Store</td><td>store billing</td>'), page);
      assert.ok(page.includes('<tr><td>Oracle Cloud</td><td>infrastructure</td>'), page);
      assert.ok(!page.includes('<td>revenuecat</td>'), 'the id is a key, not a name a reader can look up');
    } finally { kill(root); }
  });

  test('RC3 — a processor with no register row stops the render with exit 1, and nothing is written', () => {
    const root = tree();
    try {
      const before = get(root, SITE_NOTICE);
      put(root, PRIVACY_YAML, `${get(root, PRIVACY_YAML)}
  - id: acme
    role: infrastructure
    purpose: A company the provider register has never heard of.
    source: tooling/legal/provider-register.json
    asOf: "2026-09-25"
`);
      const r = spawn(PRIVACY_RENDER, [root]);
      assert.equal(r.code, 1, r.out);
      assert.ok(r.out.includes('apps/subscriptiontracker/privacy.yaml: processor "acme" has no row in tooling/legal/provider-register.json'), r.out);
      assert.equal(get(root, SITE_NOTICE), before, 'a refused render writes nothing');
    } finally { kill(root); }
  });
});
