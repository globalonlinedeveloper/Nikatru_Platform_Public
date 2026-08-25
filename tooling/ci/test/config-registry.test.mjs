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
  // 🔴 IT CARRIES `theme` AND `text` BECAUSE LIMBS 9 AND 10 ARE ABOUT THEM.
  // Limb 9 refuses to scan for a field `packages/core` does not parse (that
  // would be measuring the Dart class rather than the tree), and limb 10's
  // subject is the accessor's own declaration — so a fixture carrying neither
  // proves neither.
  // (CORRECTION 2026-08-25: limb 10 and its cases 10a–10h are deleted, and so is
  //  `AppConfig.text` in the real class. The `text` member is kept in this
  //  fixture ONLY so the fixture keeps resembling a Dart class with more than
  //  one method — no case reads it any more. `theme` is still load-bearing for
  //  every limb-9 case below.)
  'packages/core/lib/src/config/app_config.dart': `class AppConfig {\n  final Map<String, Object?>? theme;\n  final Map<String, String> copy;\n  bool feature(String key, {bool orElse = false}) => features[key] ?? orElse;\n  String text(String key) => copy[key] ?? key;\n}\n`,
  'apps/subly/lib/state/providers.dart': `const String kPromoCardFeature = 'promo_card_enabled';\n`,
  // 🔴 IT DECLARES ITS RECEIVER `core.AppConfig? cfg`, AND THAT IS NOT
  // DECORATION (2026-08-25). Limb 9's BOUND set resolves `.theme` against the
  // identifiers a file declares with an AppConfig type, and this line is the
  // real tree's idiom verbatim — home_screen.dart, onboarding_screen.dart,
  // money_providers.dart and providers.dart all open the same way. A fixture
  // whose receiver were an untyped `cfg` would make every BOUND case fail for
  // the wrong reason and would prove nothing about the tree.
  'apps/subly/lib/features/home/home_screen.dart': `Widget build() {\n  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;\n  final bool on = cfg?.feature(kPromoCardFeature) ?? false;\n  return on ? card() : empty();\n}\n`,
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
    'packages/core/lib/src/config/app_config.dart',
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

  test('6c · an OPTIONAL field added to AppConfig does NOT fail LIMB 6 — `?` is the contract', () => {
    // ⚠️ THE DART MIRROR IS PART OF THIS FIXTURE AS OF 2026-08-25, AND THE CASE
    // IS WEAKER WITHOUT IT. It used to add `renewal_notice?` to the TS interface
    // ALONE and assert exit 0, which limb 9 now correctly fails: an optional
    // field packages/core never parses is a field no client can read. That
    // unmirrored case did not disappear, it moved to 9h. What survives here is
    // 6c's own claim — the `?` keeps the field out of limb 6's completeness set,
    // so `defaults` need not carry it.
    const r = run(
      tree({
        typesTs: TYPES_TS.replace('  theme?:', '  renewal_notice?: string;\n  theme?:'),
        dart: {
          ...DART,
          'packages/core/lib/src/config/app_config.dart': DART['packages/core/lib/src/config/app_config.dart'].replace(
            '  final Map<String, Object?>? theme;',
            '  final Map<String, Object?>? theme;\n  final String? renewalNotice;',
          ),
        },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /defaults carry all 8 required AppConfig field\(s\)/);
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
    // app_config.dart STAYS: it joined REQUIRED_COVERAGE with limbs 9/10, so
    // dropping it exits at limb 0 with a DIFFERENT coverage message and this
    // case would assert nothing about limb 8. Its `feature(` is a DECLARATION,
    // not a `.feature(` call site, so the count this test is about is still 0.
    const r = run(
      tree({
        dart: {
          'packages/core/test/config_test.dart': DART['packages/core/test/config_test.dart'],
          'packages/core/lib/src/config/app_config.dart': DART['packages/core/lib/src/config/app_config.dart'],
        },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*ZERO `feature\(` call sites/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9 · AN *OPTIONAL* AppConfig FIELD IS STILL A FIELD (2026-08-25)
//
// The real-tree proof, recorded here because these fixtures are not the proof:
// four mutations were made to the WORKING TREE, run, and every file restored
// byte-identical afterwards.
//   A  `"theme": { "seed": "#6459F5" }` added to app-config-data.json `defaults`
//      → EXIT 1, "emits optional AppConfig field \"theme\" (defaults) and
//      NOTHING reads it". app-config-data.json sha256 b00e6a2e…16a7fac before
//      and after.
//   B  `Object? _t(core.AppConfig? cfg) => cfg?.theme;` added to
//      apps/subly/lib/features/home/home_screen.dart → EXIT 1, "is READ by …
//      and … emits it from NOWHERE". sha256 f551aeed…3412251 before and after.
//   C  every `theme` renamed to `__gone__` in packages/core's app_config.dart
//      → EXIT 1, "does not mention `theme`". sha256 00be0c94…5687e restored.
//   D  `String _t(core.AppConfig cfg) => cfg.text('promo.card.title');` added to
//      home_screen.dart → EXIT 1, limb 10's "has a non-test caller".
// Unmutated, the guard PRINTS both tripwires and exits 0.
//
// ── CORRECTION 2026-08-25 ────────────────────────────────────────────────────
// The four runs above are still what they say they are, and they were NOT
// enough: every one of them moves an AppConfig-typed receiver, so none of them
// asks what the reader scan does with a `.theme` that belongs to something else.
// Re-measured on a detached worktree of 6d67631 with the guard AS SHIPPED:
//
//   A′ `"theme": {"seed":"#6459F5"}` added to `defaults`            → EXIT 1
//   B′ A′ PLUS one line appended to home_screen.dart,
//        `ThemeData? _appTheme(MaterialApp app) => app.theme;`      → EXIT 0
//
// One unrelated line of shipped Dart turned a correct FAIL into a PASS — the
// worst defect class this repository has, and the guard's own header asserted it
// could not happen. The limb now computes a LOOSE set and a BOUND set and feeds
// each branch the one whose error direction is a FAIL; see the rewritten ⚠️
// paragraph and the CORRECTION beside it in the guard. Re-measured on the same
// worktree after the fix, ALL of these with the fixed guard:
//
//   A′ (emitted, no reader at all)                                  → EXIT 1
//   B′ (emitted, `.theme` only on a MaterialApp)                    → EXIT 1,
//        and the message NAMES home_screen.dart as a NEAR MISS
//   C′ (emitted, plus `Object? _seed(core.AppConfig? cfg) => cfg?.theme;`
//        appended to home_screen.dart)                              → EXIT 0,
//        "read off an AppConfig-typed receiver by …home_screen.dart"
//   D′ (NOT emitted, `.theme` only on a MaterialApp)                → EXIT 1,
//        the read-and-unemitted branch, which reads the LOOSE set
//   E′ (limb 10: `String text(String key, {String? fallback})` PLUS a non-test
//        caller) → EXIT 0 on the shipped guard, EXIT 1 on the fixed one.
// 9k below is B′ as a fixture; 10h is E′.
//
// ── CORRECTION 2026-08-25 · THE LIMB-10 HALVES OF THIS RECORD HAVE NO SUBJECT ─
// The runs above are left exactly as measured; this is appended, not a rewrite.
// LATER THE SAME DAY `AppConfig.text` WAS DELETED from packages/core's
// app_config.dart along with its only two callers, and limb 10 was deleted with
// it rather than left as a branch that could only ever print "its subject is
// gone". So of the runs recorded above:
//   · D  (`cfg.text('promo.card.title')` in home_screen.dart → EXIT 1 on limb
//        10) no longer has a limb to fail. Re-running it today would exit 0.
//   · E′ (the signature-change-plus-caller run) likewise. Its fixture, 10h, was
//        deleted in the same change, together with 10a–10g.
// The limb-9 runs — A, B, C, A′, B′, C′, D′ — are untouched and 9k below is
// still B′ as a fixture; only the "10h is E′" half of that sentence is stale, and
// this note is what retires it.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-config-registry — 9 · an OPTIONAL AppConfig field is still a field', () => {
  test('9a · the armed tripwire is PRINTED on the passing tree, not asserted away', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /optional AppConfig field "theme" — TRIPWIRE ARMED, DOMAIN EMPTY/);
  });

  test('9b · EMITTED with no reader fails — limb 6 cannot see past the `?`', () => {
    // The whole reason this limb exists: limb 6 builds its required set with
    // `.filter((k) => k[2] !== '?')`, so this key is outside it BY
    // CONSTRUCTION and the tree below passes limb 6 while serving dead data.
    const r = run(tree({ data: { ...DATA, defaults: { ...DATA.defaults, theme: { seed: '#6459F5' } } } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /emits optional AppConfig field "theme"[\s\S]*NOTHING reads it/);
  });

  test('9c · emitted from a PER-APP entry counts as emitted too, not just `defaults`', () => {
    const r = run(tree({ data: { ...DATA, apps: { subly: { features: { renewals: true }, theme: {} } } } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /emits optional AppConfig field "theme" \(apps\.subly\)/);
  });

  test('9d · READ with no emitter fails — the `update_url` seam, which reported healthy', () => {
    const r = run(
      tree({
        dart: { ...DART, 'apps/subly/lib/features/home/home_screen.dart': `${DART['apps/subly/lib/features/home/home_screen.dart']}Object? t(cfg) => cfg?.theme;\n` },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /optional AppConfig field "theme" is READ by[\s\S]*emits it from NOWHERE/);
  });

  test('9e · emitted AND read is the healthy state, and NAMES the file rather than counting it', () => {
    // ⚠️ THE ASSERTION USED TO BE ON A COUNT — `read by 1 non-test Dart
    // file(s)` — while the guard's header claimed "every matched file is named
    // in the message so a false positive is one glance to disprove". It was
    // not, and the count is exactly what made the B′ disarm above invisible in
    // the log. The name is now the assertion.
    const r = run(
      tree({
        data: { ...DATA, defaults: { ...DATA.defaults, theme: { seed: '#6459F5' } } },
        dart: { ...DART, 'apps/subly/lib/features/home/home_screen.dart': `${DART['apps/subly/lib/features/home/home_screen.dart']}Object? t(core.AppConfig? c) => c?.theme;\n` },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(
      r.out,
      /optional AppConfig field "theme" is emitted \(defaults\) and read off an AppConfig-typed receiver by apps\/subly\/lib\/features\/home\/home_screen\.dart/,
    );
  });

  test('9f · A READER IN A TEST FILE IS NOT A READER — the fixture that would go green', () => {
    // 🔴 THE NEGATIVE THIS LIMB IS MOST LIKELY TO LOSE. `config_test.dart`
    // asserts `c.theme` is null on the REAL tree, and `chassis_properties_test`
    // reads `app.theme` off a MaterialApp — a DIFFERENT SYMBOL. If the `/test/`
    // filter ever stops filtering, both count as readers, the armed tripwire
    // reports healthy, and the limb quietly stops catching its own class.
    const r = run(
      tree({
        dart: { ...DART, 'packages/core/test/config_test.dart': "void main() {\n  expect(c.feature('renewals'), isTrue);\n  expect(c.theme, isNull);\n}\n" },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /optional AppConfig field "theme" — TRIPWIRE ARMED, DOMAIN EMPTY/);
  });

  test('9g · A READER INSIDE A COMMENT IS NOT A READER — prose is not code', () => {
    const r = run(
      tree({
        dart: { ...DART, 'apps/subly/lib/features/home/home_screen.dart': `/// Deliberately does NOT read cfg?.theme — see the config contract.\n${DART['apps/subly/lib/features/home/home_screen.dart']}` },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /optional AppConfig field "theme" — TRIPWIRE ARMED, DOMAIN EMPTY/);
  });

  test('9h · an optional field the Dart mirror does not parse fails', () => {
    // A key `packages/core` never parses is a key no client can read, so the
    // reader scan would be reporting a fact about the Dart class instead of
    // about the tree. This is also the case 6c used to assert passed.
    const r = run(tree({ typesTs: TYPES_TS.replace('  theme?:', '  renewal_notice?: string;\n  theme?:') }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares optional AppConfig field "renewal_notice"[\s\S]*does not mention `renewalNotice`/);
  });

  test('9i · snake_case is camelCased for the Dart side, not compared raw', () => {
    const r = run(
      tree({
        typesTs: TYPES_TS.replace('  theme?:', '  renewal_notice?: string;\n  theme?:'),
        dart: { ...DART, 'packages/core/lib/src/config/app_config.dart': `${DART['packages/core/lib/src/config/app_config.dart'].replace('}\n', '  final String? renewalNotice;\n}\n')}` },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /optional AppConfig field "renewal_notice" — TRIPWIRE ARMED/);
  });

  test('9j · AppConfig with NO optional field reports an empty domain rather than passing silently', () => {
    const r = run(tree({ typesTs: TYPES_TS.replace('  theme?: Record<string, unknown>;\n', '') }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /declares NO optional field today/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE TWO-SET CASES (2026-08-25). Everything above this line was green
  // against a limb that could be disarmed by one line of unrelated Dart.
  // ───────────────────────────────────────────────────────────────────────────

  test('9k · emitted, with `.theme` only on a NON-AppConfig receiver, FAILS — THE DISARM', () => {
    // 🔴 THIS IS THE DEFECT, AS A FIXTURE. It is 9b (emitted, dead) plus ONE
    // line that reads a MaterialApp — a line a theming change introduces by
    // definition. Against the shipped limb, whose ONE matcher was `\.theme\b`,
    // this tree printed "emitted (defaults) and read by 1 non-test Dart file(s)"
    // and EXITED 0: a correct FAIL turned into a pass, which is the worst defect
    // class in this repository and the one the limb's own header swore could not
    // happen here. `app.theme` on a MaterialApp already occurs 6 times in the
    // real tree (3 in apps/subly/test/chassis_properties_test.dart, 3 in the
    // brick's copy); they are cut only because of where they live.
    const r = run(
      tree({
        data: { ...DATA, defaults: { ...DATA.defaults, theme: { seed: '#6459F5' } } },
        dart: {
          ...DART,
          'apps/subly/lib/features/home/home_screen.dart': `${DART['apps/subly/lib/features/home/home_screen.dart']}ThemeData? _appTheme(MaterialApp app) => app.theme;\n`,
        },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOTHING reads it off an AppConfig-typed receiver/);
    // …and the near miss is NAMED, so an under-reach of the binding scan is one
    // glance to see rather than a silent FAIL with no file in it.
    assert.match(r.out, /NEAR MISS[\s\S]*apps\/subly\/lib\/features\/home\/home_screen\.dart/);
  });

  test('9l · a BOUND reader passes, and the note names the reader AND the near miss', () => {
    const r = run(
      tree({
        data: { ...DATA, defaults: { ...DATA.defaults, theme: { seed: '#6459F5' } } },
        dart: {
          ...DART,
          'apps/subly/lib/features/home/home_screen.dart': `${DART['apps/subly/lib/features/home/home_screen.dart']}Object? _seed(core.AppConfig? c) => c?.theme;\n`,
          'apps/subly/lib/features/shell/app_shell.dart': 'ThemeData? _appTheme(MaterialApp app) => app.theme;\n',
        },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /read off an AppConfig-typed receiver by apps\/subly\/lib\/features\/home\/home_screen\.dart/);
    assert.match(r.out, /NOT counted as a reader: apps\/subly\/lib\/features\/shell\/app_shell\.dart/);
  });

  test('9m · the PARAMETER idiom `_copy(core.AppConfig? cfg, …)` resolves — three surfaces use it', () => {
    // The receiver is declared nowhere but the parameter list, in a file that
    // declares nothing else. If the resolver only understood `final core.AppConfig? x = …`
    // this tree would FAIL, and the fix for that FAIL would be to widen the
    // matcher — the dangerous direction.
    const r = run(
      tree({
        data: { ...DATA, defaults: { ...DATA.defaults, theme: { seed: '#6459F5' } } },
        dart: {
          ...DART,
          'apps/subly/lib/features/onboarding/onboarding_screen.dart':
            'String _copy(core.AppConfig? cfg, String key) => cfg?.theme?.toString() ?? key;\n',
        },
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /read off an AppConfig-typed receiver by apps\/subly\/lib\/features\/onboarding\/onboarding_screen\.dart/);
  });

  test('9n · a METHOD whose RETURN type is AppConfig is not itself a receiver', () => {
    // `AppConfig? peek(String appId)` is real — packages/core's config_loader.dart
    // declares it, and `AppConfig? get(…)`, and `AppConfig? defaultConfigFor(…)`.
    // Counting those names as AppConfig-typed identifiers would let `peek.theme`
    // — which is not a config read at all — disarm the limb, which is the same
    // RED-to-GREEN loosening in a new place.
    const r = run(
      tree({
        data: { ...DATA, defaults: { ...DATA.defaults, theme: { seed: '#6459F5' } } },
        dart: {
          ...DART,
          'packages/core/lib/src/config/config_loader.dart':
            'AppConfig? peek(String appId) => null;\nObject? _s() => peek.theme;\n',
        },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOTHING reads it off an AppConfig-typed receiver/);
  });

  test('9o · ZERO AppConfig-typed identifiers anywhere is COVERAGE LOST, not "nothing reads it"', () => {
    // With no declaration the resolver can see, BOUND is empty for every key no
    // matter what the tree reads, and the emitted branch would fail on a fact
    // about the regex. A guard that fails for the wrong reason teaches its
    // reader to widen it.
    const r = run(
      tree({
        data: { ...DATA, defaults: { ...DATA.defaults, theme: { seed: '#6459F5' } } },
        dart: {
          ...DART,
          'apps/subly/lib/features/home/home_screen.dart':
            'Widget build() {\n  final bool on = cfg?.feature(kPromoCardFeature) ?? false;\n  return on ? card() : empty();\n}\n',
        },
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST[\s\S]*resolved ZERO AppConfig-typed identifiers/);
  });
});
