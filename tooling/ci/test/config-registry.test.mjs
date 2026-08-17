// ─────────────────────────────────────────────────────────────────────────────
// config-registry.test.mjs — assert-config-registry.mjs must be able to FAIL.
//
// [pipeline 4]B-2. The guard's sentence is "the set of apps the shared config
// service serves is DATA; adding an app needs no Worker source edit", and the
// seven observations that make it false are enumerated in the guard's header.
// Each has a case below, and each case differs from the PASSING fixture in
// exactly one dimension — a fixture that differs in two proves neither.
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

function tree({ catalogue = CATALOGUE, data = DATA, configTs = CONFIG_TS, typesTs = TYPES_TS, hook = preGen(), omit = null } = {}) {
  const root = join(TMP, `t${seq++}`);
  const files = {
    'catalog/apps.json': JSON.stringify(catalogue, null, 2),
    'services/platform/src/app-config-data.json': typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    'services/platform/src/config.ts': configTs,
    'services/platform/src/types.ts': typesTs,
    'tooling/bricks/app/hooks/pre_gen.dart': hook,
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
