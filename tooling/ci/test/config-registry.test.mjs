// ─────────────────────────────────────────────────────────────────────────────
// config-registry.test.mjs — assert-config-registry.mjs must be able to FAIL.
//
// [pipeline 4]B-2. The guard's sentence is "the set of apps the shared config
// service serves is DATA; adding an app needs no Worker source edit", and the
// eight observations that make it false are enumerated in the guard's header.
// Each has a case below, and each case differs from the PASSING fixture in
// exactly one dimension — a fixture that differs in two proves neither.
//
// Observation 8 (a served `features` key that is ON and unread) joined on
// 2026-08-21 and brought two new surfaces into the fixture: a Dart tree and
// tooling/sites/generate-discovery.mjs. Its cases are LAST in this file, and its
// real-tree proof is recorded beside them — the four mutations were made to
// services/platform/src/app-config-data.json in the working tree, run, and the
// file restored byte-identical (sha256 b00e6a2e…16a7fac before and after).
//
// ⚠️ THESE FIXTURES ARE NOT THE PROOF, AND THIS REPO HAS THE SCAR TO SAY SO.
// assert-seams-wired.mjs shipped with all six of its fixture tests green
// against a version that could not fail, because a fixture encodes the same
// misunderstanding as the guard it was written beside. The proof is the REAL
// TREE mutated and restored byte-identical; these cases exist so the guard's
// branches stay exercised after the real-tree run is a memory.
//
// Run:  node --test "tooling/ci/test/config-registry.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-config-registry.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-cfgreg-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** The catalogue, as post_gen.dart writes it. */
const CATALOGUE = [
  { slug: 'subly', name: 'Subly', tagline: 't', url: 'https://subly.nikatru.com', api: 'https://api.nikatru.com', platforms: ['web'], status: 'live' },
];

/** The value document. */
const DATA = {
  sharedApiBaseUrl: 'https://platform.nikatru.com/v1',
  defaults: {
    features: {},
    flags: {},
    paywall: { enabled: false, offerings: [] },
    content_pack: null,
    copy: {},
    min_supported_version: '1.0.0',
    max_promos_per_week: 0,
    update_url: null,
  },
  apps: { subly: { features: { renewals: true } } },
};

/** The Worker source, reduced to the two things the guard reads: the catalogue
 *  import reaching `buildRegistry`, and APP_ID_PATTERN.
 *
 *  🔴 IT CARRIES A HEADER COMMENT NAMING AN APP ID ON PURPOSE. The real file's
 *  header quotes the old hardcoded registry (`subly: { … }`) as the defect it
 *  removed — so a guard that grepped raw text would fire on the very prose
 *  explaining why the thing it looks for is absent. That is not hypothetical
 *  here: this repo has already shipped a `grep '"r2_buckets"'` that matched the
 *  comment saying there is no `r2_buckets`. The literal limb must read
 *  comment-STRIPPED source, and this fixture is how that stays true. */
const CONFIG_TS = `// Until B-2 the registry was a literal here:
//     export const DEFAULT_CONFIGS = { subly: { app_id: 'subly' } };
// which is why 'lingo' 404'd. It is derived now.
import type { AppConfig } from './types';
import catalogueJson from '../../../catalog/apps.json';
import configDataJson from './app-config-data.json';

export const APP_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export function buildRegistry(catalogue, data) {
  return {};
}

export const DEFAULT_CONFIGS = buildRegistry(
  catalogueJson,
  configDataJson,
);
`;

/** The wire contract. Only the AppConfig interface is read. */
const TYPES_TS = `export interface AppConfig {
  app_id: string;
  api_base_url: string;
  features: Record<string, boolean>;
  flags: Record<string, number>;
  paywall: { enabled: boolean };
  content_pack: string | null;
  copy: Record<string, string>;
  min_supported_version: string;
  max_promos_per_week: number;
  update_url: string | null;
  theme?: Record<string, unknown>;
}
`;

/** The brick hook. Only the client-only api_base_url literal is read, and the
 *  fixture keeps the ternary's true branch so the regex has to pick the right
 *  one — a pattern that grabbed the first literal would pass on a copy that had
 *  only the else branch. */
const preGen = (base = 'https://platform.nikatru.com/v1') => `void run(HookContext context) {
  // The client-only app calls the shared Worker at ${base}.
  vars['api_domain'] = resolvedApiDomain;
  vars['api_base_url'] = needsBackend
      ? 'https://\$resolvedApiDomain'
      : '${base}';
}
`;

/** The landing-page generator, reduced to the one thing limb 8 reads: the
 *  FEATURE_NAMES map that gives a served feature key a reader-facing name.
 *
 *  🔴 ITS HEADER COMMENT NAMES A KEY THAT IS NOT IN THE MAP, ON PURPOSE — the
 *  same trap CONFIG_TS carries one limb over. A raw-text scan would accept
 *  `teleport` as "named by the generator" because the prose explaining that it
 *  is NOT named mentions it, and would then report the exact opposite of the
 *  truth for the one key the limb exists to catch. */
const DISCOVERY_MJS = `// The bullets on each app landing page. A key with no entry here (teleport,
// say) has no reader-facing name and gets no bullet.
const FEATURE_NAMES = new Map([
  ['renewals', ['Renewal reminders', 'You are told what renews, and when.']],
]);
export const RAIL_CONFIG = 'services/platform/src/app-config-data.json';
`;

/** Shipped Dart, in the shape the real tree has it: the key is a `const String`
 *  in ONE file and the `feature(` call is in ANOTHER. A single-pass scan
 *  resolves that or not depending on directory order, so the fixture pins the
 *  two-pass behaviour rather than trusting it. */
const DART = {
  'packages/core/lib/src/config/app_config.dart': `class AppConfig {\n  bool feature(String key, {bool orElse = false}) => features[key] ?? orElse;\n}\n`,
  'apps/subly/lib/state/providers.dart': `const String kPromoCardFeature = 'promo_card_enabled';\n`,
  'apps/subly/lib/features/home/home_screen.dart': `Widget build() {\n  final bool on = cfg?.feature(kPromoCardFeature) ?? false;\n  return on ? card() : empty();\n}\n`,
  // 🔴 A TEST THAT READS A KEY MUST NOT COUNT AS A READER. This file asks for
  // `renewals` — the one key the passing fixture serves — so if the `/test/`
  // filter ever stops filtering, the ARMED-and-unread case below goes GREEN and
  // the limb quietly stops catching the class it was written for.
  'packages/core/test/config_test.dart': `void main() {\n  expect(c.feature('renewals'), isTrue);\n}\n`,
};

function tree({
  catalogue = CATALOGUE,
  data = DATA,
  configTs = CONFIG_TS,
  typesTs = TYPES_TS,
  hook = preGen(),
  discovery = DISCOVERY_MJS,
  dart = DART,
  omit = null,
} = {}) {
  const root = join(TMP, `t${seq++}`);
  const files = {
    'catalog/apps.json': JSON.stringify(catalogue, null, 2),
    'services/platform/src/app-config-data.json': typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    'services/platform/src/config.ts': configTs,
    'services/platform/src/types.ts': typesTs,
    'tooling/bricks/app/hooks/pre_gen.dart': hook,
    'tooling/sites/generate-discovery.mjs': discovery,
    ...dart,
  };
  for (const [rel, body] of Object.entries(files)) {
    if (rel === omit) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

describe('assert-config-registry — the passing case', () => {
  test('a tree whose served set is data passes', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /served config set — 1 app\(s\)/);
  });

  test('and it PRINTS the served set, so a shrink is visible', () => {
    const r = run(tree());
    assert.match(r.out, /subly → https:\/\/api\.nikatru\.com\/v1/);
  });

  test('an app with no `api` host is printed against the SHARED base', () => {
    const r = run(tree({ catalogue: [{ slug: 'lingo', api: '' }], data: { ...DATA, apps: {} } }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /lingo → https:\/\/platform\.nikatru\.com\/v1/);
  });
});

describe('assert-config-registry — COVERAGE', () => {
  for (const rel of [
    'catalog/apps.json',
    'services/platform/src/config.ts',
    'services/platform/src/app-config-data.json',
    'services/platform/src/types.ts',
    'tooling/bricks/app/hooks/pre_gen.dart',
    'tooling/sites/generate-discovery.mjs',
  ]) {
    test(`a missing ${rel} is COVERAGE LOST, not a pass`, () => {
      const r = run(tree({ omit: rel }));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /COVERAGE LOST/);
    });
  }

  test('an EMPTY catalogue is COVERAGE LOST — every limb would range over nothing', () => {
    const r = run(tree({ catalogue: [] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('an unparseable value document is COVERAGE LOST, not "no apps configured"', () => {
    const r = run(tree({ data: '{not json' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('APP_ID_PATTERN unreadable from config.ts is COVERAGE LOST', () => {
    const r = run(tree({ configTs: CONFIG_TS.replace(/export const APP_ID_PATTERN.*\n/, '') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*APP_ID_PATTERN/);
  });
});

describe('assert-config-registry — the seven observations', () => {
  test('1 · the catalogue import deleted from config.ts', () => {
    const r = run(tree({ configTs: CONFIG_TS.replace(/import catalogueJson.*\n/, '') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not import/);
  });

  test('1b · imported but never passed to buildRegistry — an import nothing consumes', () => {
    const r = run(tree({ configTs: CONFIG_TS.replace('buildRegistry(\n  catalogueJson,', "buildRegistry(\n  [{ slug: 'x' }],") }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never passes it to/);
  });

  test('2 · an app id typed back into config.ts as a registry key', () => {
    const r = run(tree({ configTs: `${CONFIG_TS}\nconst LEGACY = {\n  subly: { renewals: true },\n};\n` }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /appears as a registry key/);
  });

  test('2b · …or as a string literal', () => {
    const r = run(tree({ configTs: `${CONFIG_TS}\nconst FLAGSHIP = 'subly';\n` }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /appears as a string literal/);
  });

  test('2c · but the SAME id inside a comment does not fire — prose is not code', () => {
    // The trap this limb has to survive: the real config.ts header quotes the
    // literal it deleted. A raw-text grep reports the opposite of the truth
    // exactly when the code is right.
    const r = run(tree({ configTs: `${CONFIG_TS}\n// The old registry was { subly: {…} } and 'subly' was its only key.\n` }));
    assert.equal(r.code, 0, r.out);
  });

  test('3 · a value-document entry for an app the catalogue does not have', () => {
    const r = run(tree({ data: { ...DATA, apps: { ...DATA.apps, lingo: { content_pack: 'x' } } } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /which is not a slug in/);
  });

  test('4 · a catalogue slug APP_ID_PATTERN rejects is reported, not silently dropped', () => {
    const r = run(tree({ catalogue: [...CATALOGUE, { slug: 'My App', api: '' }], data: { ...DATA, apps: {} } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /APP_ID_PATTERN rejects/);
  });

  test('4b · a row with no slug at all', () => {
    const r = run(tree({ catalogue: [...CATALOGUE, { name: 'nameless' }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has no string `slug`/);
  });

  test('5 · the same slug listed twice', () => {
    const r = run(tree({ catalogue: [...CATALOGUE, { ...CATALOGUE[0] }] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /more than once/);
  });

  test('6 · defaults lose a field AppConfig declares required', () => {
    const defaults = { ...DATA.defaults };
    delete defaults.min_supported_version;
    const r = run(tree({ data: { ...DATA, defaults } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /missing "min_supported_version"/);
  });

  test('6b · a field ADDED to AppConfig with no default fails the same day', () => {
    const r = run(tree({ typesTs: TYPES_TS.replace('  theme?:', '  renewal_notice: string | null;\n  theme?:') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /missing "renewal_notice"/);
  });

  test('6c · an OPTIONAL field added to AppConfig does NOT fail — `?` is the contract', () => {
    const r = run(tree({ typesTs: TYPES_TS.replace('  theme?:', '  renewal_notice?: string;\n  theme?:') }));
    assert.equal(r.code, 0, r.out);
  });

  test('7 · the shared api base diverges from the brick fallback', () => {
    const r = run(tree({ data: { ...DATA, sharedApiBaseUrl: 'https://api.nikatru.com/v1' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TWO SPELLINGS OF ONE HOST/);
  });

  test('7b · …and it fails in the other direction too, from the brick side', () => {
    const r = run(tree({ hook: preGen('https://platform.nikatru.com/v2') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TWO SPELLINGS OF ONE HOST/);
  });

  test('7c · an unparseable brick literal is COVERAGE LOST, not agreement', () => {
    const r = run(tree({ hook: "void run() { vars['api_base_url'] = someFunction(); }\n" }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*pre_gen/);
  });
});


describe('assert-config-registry — 8 · a served feature key nobody reads', () => {
  // 🔴 WHY THIS LIMB EXISTS, AND WHY IT IS NOT A ONE-LANGUAGE SCAN.
  // The real tree serves `apps.subly.features = {renewals, budgets, exports}`
  // and 185 non-test Dart files read none of them; the only `.feature(` call in
  // shipped Dart asks for `promo_card_enabled`, which the document does not
  // serve. On that evidence the three keys are dead and the next move is to
  // delete them. They are not dead: tooling/sites/generate-discovery.mjs names
  // all three in FEATURE_NAMES and renders them as the three "What you get"
  // bullets on sites/nikatru/apps/subly.html, which Cloudflare Pages serves out
  // of this repo. The union of the two surfaces IS the limb.
  const withFeatures = (features) => ({ ...DATA, apps: { subly: { features } } });

  test('a key read by the site generator is not dead — the passing fixture', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 served feature key\(s\) have a non-test reader/);
  });

  test('8 · a key served TRUE that neither surface reads FAILS', () => {
    const r = run(tree({ data: withFeatures({ renewals: true, teleport: true }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /features\.teleport is served TRUE and NOTHING reads it/);
  });

  test('8b · the SAME key served FALSE is PRINTED, not failed — the disarmed lever', () => {
    // `max_promos_per_week`'s shape one field over: served at its inert value,
    // read by nothing, changing nothing when its reader lands. Failing here
    // would make "declare the switch before the code" impossible to do at all.
    const r = run(tree({ data: withFeatures({ renewals: true, teleport: false }) }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /DISARMED FEATURE LEVER\(S\)[\s\S]*apps\.subly\.features\.teleport/);
  });

  test('8c · a NON-BOOLEAN value fails — _boolMap drops it and the generator skips it', () => {
    const r = run(tree({ data: withFeatures({ renewals: true, teleport: 1 }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /features\.teleport = 1, which is not a boolean/);
  });

  test('8d · a key read only from DART is alive too — the union has two halves', () => {
    const r = run(tree({ data: withFeatures({ renewals: true, promo_card_enabled: true }) }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 served feature key\(s\) have a non-test reader/);
  });

  test('8e · …and the Dart half resolves a `const String` from ANOTHER file', () => {
    // The const lives in providers.dart, the call in home_screen.dart. Delete
    // the declaration and the call can no longer be resolved, which is COVERAGE
    // LOST rather than "promo_card_enabled has no reader".
    const dart = { ...DART };
    delete dart['apps/subly/lib/state/providers.dart'];
    const r = run(tree({ dart }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*cannot resolve the key read by/);
  });

  test('8f · `defaults.features` is in the domain too, not just per-app', () => {
    const r = run(tree({ data: { ...DATA, defaults: { ...DATA.defaults, features: { teleport: true } } } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /defaults\.features\.teleport is served TRUE/);
  });

  test('8g · a key named ONLY in the generator’s prose is not a reader', () => {
    // DISCOVERY_MJS's header comment mentions `teleport` while FEATURE_NAMES
    // does not carry it. A raw-text scan passes here and is reporting the
    // opposite of the truth — this repo has shipped that exact defect once
    // (a `grep '"r2_buckets"'` that matched the comment saying there is none).
    const r = run(tree({ data: withFeatures({ renewals: true, teleport: true }) }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /features\.teleport is served TRUE/);
  });

  test('8h · a key read ONLY by a test is not a reader', () => {
    // packages/core/test/config_test.dart reads `renewals`. Take the site
    // generator's name for it away — RENAMED, not deleted, so FEATURE_NAMES
    // stays non-empty and this is the reader limb answering rather than the
    // COVERAGE one — and the key must go red, because the only remaining reader
    // is under a `test/` path.
    const r = run(tree({ discovery: DISCOVERY_MJS.replace("'renewals'", "'budgets'") }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /features\.renewals is served TRUE and NOTHING reads it/);
  });

  test('8i · a key shipped code READS but nothing serves is PRINTED, not failed', () => {
    // `promo_card_enabled` is read at two call sites and served nowhere, so it
    // resolves to `feature()`'s `orElse: false` and the promo card is dark.
    // That is deliberate and owner-gated (arming it makes the app a promotional
    // surface and re-derives the Play ads declaration), so the guard says so
    // every run rather than blocking CI on a decision only the owner can take.
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /READ BUT UNSERVED — promo_card_enabled \(1 call site\(s\)\)/);
  });

  test('8j · COVERAGE — FEATURE_NAMES unparseable is not "the site reads nothing"', () => {
    const r = run(tree({ discovery: "export const RAIL_CONFIG = 'x';\n" }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*FEATURE_NAMES could not be parsed/);
  });

  test('8k · COVERAGE — an EMPTY FEATURE_NAMES map is COVERAGE LOST', () => {
    const r = run(tree({ discovery: 'const FEATURE_NAMES = new Map([]);\n' }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*parsed to ZERO keys/);
  });

  test('8l · COVERAGE — zero `feature(` call sites means the scan moved, not the tree', () => {
    const dart = { ...DART };
    delete dart['apps/subly/lib/features/home/home_screen.dart'];
    const r = run(tree({ dart }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*ZERO `feature\(` call sites/);
  });

  test('8m · a tree whose only non-test Dart is the brick hook reports honestly', () => {
    // 🔴 THE CASE THAT DELETED A LIMB. It was written to prove a
    // `dartFiles.length === 0` COVERAGE branch and instead proved that branch
    // UNREACHABLE: `tooling/bricks/app/hooks/pre_gen.dart` is in
    // REQUIRED_COVERAGE, it is Dart, and it sits under a DART_ROOT — so by the
    // time limb 8 runs the count is never 0, and a missing hook has already
    // exited at limb 0. The branch was removed from the guard rather than kept
    // "for safety". What survives is the honest answer for this tree: no
    // `feature(` call site anywhere, so "no Dart reader" is a fact about the
    // scan and says so.
    const r = run(tree({ dart: { 'packages/core/test/config_test.dart': DART['packages/core/test/config_test.dart'] } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*ZERO `feature\(` call sites/);
  });
});
