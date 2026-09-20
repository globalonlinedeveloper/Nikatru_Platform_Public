// ─────────────────────────────────────────────────────────────────────────────
// store-vocabulary.test.mjs — assert-store-vocabulary.mjs must be able to FAIL.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-09-20, ten, on
// this worktree; each applied to the real files, the guard run, the file
// restored byte-exact, and the restore re-verified green before the next one).
// A fixture you wrote encodes the same misunderstanding as the guard you wrote,
// so the real tree goes first and the fixtures come after.
//
//   M1  contract renames a channel id (amo -> amo-x)   -> exit 1, BOTH limbs: the
//                                                          missing value and the
//                                                          unused one
//   M2  contract gains `.flatpak`, which no channel     -> exit 1, unused-value
//       accepts                                             limb, twice (formats
//                                                          block and rows)
//   M3  a REAL category.txt changed to "Finance"        -> exit 1, both category
//                                                          limbs
//   M4  render.mjs restates RENDERED_LISTING_FILES      -> exit 1, restatement
//   M5  an axis emptied                                 -> exit 2 COVERAGE LOST
//       (and contracts/store/generate.mjs --check       -> exit 1 on its own floor)
//   M6  vocabulary.json hand-edited                     -> exit 1, derived-copy limb
//   M7  the import removed from check-store-metadata    -> exit 1
//   M8  `android-sideload` (awaitingChannelRow) leaked  -> exit 1, section 3
//       into the vocabulary
//   D1  contract flips long-description.txt to          -> tooling/app-yaml/render.mjs
//       rendered:true                                      --check exit 1, naming
//                                                          three listing files
//   D2  contract moves long-description.txt from        -> extensions/scripts/
//       per-store to shared                                check-store-metadata.mjs
//                                                          exit 1, naming _shared
//
//   D1 and D2 are the proof that MATTERS: they show the two re-pointed consumers
//   really read the contract, rather than importing it and carrying on with a
//   copy — which is exactly how the revocation-reason set drifted.
//
//   Green controls before and after every one: exit 0. `git status` clean.
//
// ── WHAT THE FIXTURES BELOW ADD ──────────────────────────────────────────────
// The real-tree mutations cannot produce a tree with NO listing trees, or a
// consumer file that is absent, or a register missing its deviceTypeCoverage
// block — and those are the COVERAGE LOST limbs, which are the ones that decide
// whether this guard is evidence or decoration. So the fixtures build a whole
// small root and take pieces out of it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-store-vocabulary.mjs');

const CONTRACT_JS = join(REPO, 'contracts', 'store', 'vocabulary.js');
const REGISTER = join(REPO, 'tooling', 'channel-register.json');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'store-vocab-'));
});
after(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const write = (abs, text) => {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
};

/**
 * The stand-in for tooling/app-yaml/render.mjs. The real file pulls in a YAML
 * parser, a schema validator and the apex-URL helper, none of which this guard
 * looks at; what it DOES look at is the import specifier and the exported
 * array's value, and both are reproduced here exactly.
 */
const RENDER_STAND_IN = [
  "import { renderedListingFiles } from '../../contracts/store/vocabulary.js';",
  'export const RENDERED_LISTING_FILES = renderedListingFiles();',
  '',
].join('\n');

const CHECK_STAND_IN = [
  "import { extensionPerStoreListingFiles, extensionSharedListingFiles } from '../../contracts/store/vocabulary.js';",
  'const REQUIRED_PER_STORE = extensionPerStoreListingFiles();',
  'const REQUIRED_SHARED = extensionSharedListingFiles();',
  'export { REQUIRED_PER_STORE, REQUIRED_SHARED };',
  '',
].join('\n');

/**
 * Build a complete, PASSING root, then let each case break exactly one thing.
 * Starting from a green fixture is the only way a red proves what broke it.
 *
 * `edit` receives the parsed contract source and register so a case can mutate
 * either before anything is written.
 */
function makeRoot(name, { contractEdit, registerEdit, skip = new Set() } = {}) {
  const root = join(TMP, name);
  mkdirSync(root, { recursive: true });

  let contractSrc = readFileSync(CONTRACT_JS, 'utf8');
  if (contractEdit) contractSrc = contractEdit(contractSrc);
  write(join(root, 'contracts', 'store', 'vocabulary.js'), contractSrc);

  const register = JSON.parse(readFileSync(REGISTER, 'utf8'));
  if (registerEdit) registerEdit(register);
  write(join(root, 'tooling', 'channel-register.json'), JSON.stringify(register, null, 2) + '\n');

  if (!skip.has('render')) write(join(root, 'tooling', 'app-yaml', 'render.mjs'), RENDER_STAND_IN);
  if (!skip.has('check')) write(join(root, 'extensions', 'scripts', 'check-store-metadata.mjs'), CHECK_STAND_IN);

  // generate.mjs is NOT copied into the fixture: a case that deliberately
  // empties an axis would hit the generator's own floor and never reach the
  // guard. generateJson() below writes exactly what generate.mjs writes.
  return root;
}

/**
 * Materialise vocabulary.json for a fixture root, from that root's own source.
 * The cache-busting query is what lets several fixtures, each with a different
 * contract, be imported in one node process.
 */
async function generateJson(root) {
  const href = `${pathToFileURL(join(root, 'contracts', 'store', 'vocabulary.js')).href}?v=${fixtureSerial++}`;
  const mod = await import(href);
  const payload = { $schema: './vocabulary.schema.json', ...JSON.parse(JSON.stringify(mod.STORE_VOCABULARY)) };
  write(join(root, 'contracts', 'store', 'vocabulary.json'), JSON.stringify(payload, null, 2) + '\n');
  return mod;
}

let fixtureSerial = 0;

/** The listing trees a passing fixture needs: one per channel that declares a category. */
async function materialiseTrees(root, { skipApps = false, skipExtensions = false, extraAppFile = null, appDirName = null } = {}) {
  const mod = await generateJson(root);
  const v = mod.STORE_VOCABULARY;
  const required = mod.appRequiredListingFiles();
  const perStore = mod.extensionPerStoreListingFiles();
  const shared = mod.extensionSharedListingFiles();

  const registerRows = JSON.parse(readFileSync(join(root, 'tooling', 'channel-register.json'), 'utf8')).channels;
  const extKeyFor = (channelId) => registerRows.find((c) => c.id === channelId)?.extensionStoreKey ?? null;

  for (const [channelId, categories] of Object.entries(v.listingCategories)) {
    const extKey = extKeyFor(channelId);
    if (extKey) {
      if (skipExtensions) continue;
      const base = join(root, 'extensions', 'Extension', 'Demo', 'store', extKey);
      for (const f of perStore) write(join(base, f), f === 'category.txt' ? `${categories.join('\n')}\n` : 'x\n');
      write(join(base, 'README.md'), '# card\n');
      const sharedBase = join(root, 'extensions', 'Extension', 'Demo', 'store', '_shared');
      for (const f of shared) write(join(sharedBase, f), 'x\n');
      write(join(sharedBase, 'README.md'), '# card\n');
      continue;
    }
    if (skipApps) continue;
    const dir = appDirName ?? channelId;
    const base = join(root, 'apps', 'demo', 'store', dir);
    for (const f of required) write(join(base, f), f === 'category.txt' ? `${categories.join('\n')}\n` : 'x\n');
  }
  if (extraAppFile && !skipApps) {
    write(join(root, 'apps', 'demo', 'store', 'android-play', extraAppFile), 'x\n');
  }
  return mod;
}

// ═════════════════════════════════════════════════════════════════════════════
describe('assert-store-vocabulary — the green control', () => {
  test('the real repository passes', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    assert.match(out, /is the one home for the store vocabulary/);
  });

  test('a built fixture passes, so every red below is the mutation and not the fixture', async () => {
    const root = makeRoot('green');
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });
});

describe('assert-store-vocabulary — COVERAGE LOST, the limbs that decide whether this is evidence', () => {
  test('exit 2 when the contract is absent', () => {
    const root = join(TMP, 'no-contract');
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /contracts\/store\/vocabulary\.js is not present/);
  });

  test('exit 2 when an axis is emptied', async () => {
    const root = makeRoot('empty-axis', {
      contractEdit: (s) => s.replace(/export const DEVICE_CLASSES = [^;]+;/, 'export const DEVICE_CLASSES = [];'),
    });
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /`deviceClasses` axis is empty/);
  });

  test('exit 2 when no application listing tree exists', async () => {
    const root = makeRoot('no-app-trees');
    await materialiseTrees(root, { skipApps: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /no apps\/\*\/store/);
  });

  test('exit 2 when no extension store tree exists', async () => {
    const root = makeRoot('no-ext-trees');
    await materialiseTrees(root, { skipExtensions: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /no extensions\/\*\*\/store\/ tree/);
  });

  test('exit 2 when a re-pointed consumer is gone', async () => {
    const root = makeRoot('no-consumer', { skip: new Set(['check']) });
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /check-store-metadata\.mjs is not present/);
  });

  test('exit 2 when the register loses its deviceTypeCoverage block', async () => {
    const root = makeRoot('no-device-sets', {
      registerEdit: (r) => {
        delete r.storeMetadataContract.perChannel['android-play'].graphicAssets.screenshots.deviceTypeCoverage;
      },
    });
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /deviceTypeCoverage\.sets/);
  });
});

describe('assert-store-vocabulary — a value a consumer spells that the contract lacks', () => {
  test('a channel id the register has and the contract does not', async () => {
    const root = makeRoot('missing-channel', {
      contractEdit: (s) => s.replace("  'amo',\n", ''),
      // The contract also declares categories for `amo`; drop them so this case
      // reds on ONE thing.
      // (the replace below runs on the already-edited source)
    });
    const src = readFileSync(join(root, 'contracts', 'store', 'vocabulary.js'), 'utf8');
    write(join(root, 'contracts', 'store', 'vocabulary.js'), src.replace(/\n\s+amo: \[[^\]]*\],/, ''));
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /channelIds: .*spells 1 value\(s\) the contract does not carry: amo/);
  });

  test('a listing file in a tree that the contract does not carry', async () => {
    const root = makeRoot('stray-listing-file');
    await materialiseTrees(root, { extraAppFile: 'whats-new.txt' });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /whats-new\.txt is not a listing field the contract carries/);
  });

  test('a listing tree directory that names no channel', async () => {
    const root = makeRoot('unknown-channel-dir');
    await materialiseTrees(root);
    write(join(root, 'apps', 'demo', 'store', 'itch-io', 'title.txt'), 'x\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /which the contract does not carry as a channel id/);
  });

  test('a category a tree spells that the contract does not declare', async () => {
    const root = makeRoot('stray-category');
    await materialiseTrees(root);
    write(join(root, 'apps', 'demo', 'store', 'android-play', 'category.txt'), 'Finance\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /"Finance" is spelled for android-play and the contract does not carry it/);
  });
});

describe('assert-store-vocabulary — a value the contract carries that no consumer spells', () => {
  test('an artifact format no channel accepts', async () => {
    const root = makeRoot('unused-format', {
      contractEdit: (s) => s.replace("  '.AppImage',\n]);", "  '.AppImage',\n  '.flatpak',\n]);"),
    });
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /the contract carries 1 value\(s\).*does not spell: \.flatpak/s);
    assert.match(out, /UNUSED-VALUE limb/);
  });

  test('a declared category no listing tree uses', async () => {
    const root = makeRoot('unused-category', {
      contractEdit: (s) => s.replace("  'android-play': ['Productivity'],", "  'android-play': ['Productivity', 'Finance'],"),
    });
    await materialiseTrees(root);
    // materialiseTrees writes every declared category into the tree, which is
    // what a passing fixture needs; put the tree back to the ONE value it had
    // so the second declared value is the thing nothing spells.
    write(join(root, 'apps', 'demo', 'store', 'android-play', 'category.txt'), 'Productivity\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /android-play declares 1 category value\(s\) no tree spells: Finance/);
  });
});

describe('assert-store-vocabulary — the ordered listing arrays', () => {
  test('reordering the required files reds, because consumers use the array verbatim', async () => {
    const root = makeRoot('reordered', {
      registerEdit: (r) => {
        const f = r.storeMetadataContract.requiredFiles;
        r.storeMetadataContract.requiredFiles = [f[1], f[0], ...f.slice(2)];
      },
    });
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /ORDER IS LOAD-BEARING/);
  });
});

describe('assert-store-vocabulary — the ids that are deliberately not vocabulary', () => {
  test('an awaitingChannelRow id leaked into the vocabulary reds', async () => {
    const root = makeRoot('leaked-prospective', {
      contractEdit: (s) => s.replace("  'amo',\n]);", "  'amo',\n  'android-sideload',\n]);"),
    });
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /NOT channel rows are in the vocabulary: android-sideload/);
  });

  test('exit 2 when the register lists neither a prospective nor a disqualified id', async () => {
    const root = makeRoot('no-prospective', {
      registerEdit: (r) => {
        r.purchaseRails.awaitingChannelRow = [];
        r.disqualified = [];
      },
    });
    await materialiseTrees(root);
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /neither an awaitingChannelRow nor a disqualified id/);
  });
});

describe('assert-store-vocabulary — the re-pointed consumers', () => {
  test('a consumer that restates the array reds even though it still imports', async () => {
    const root = makeRoot('restated');
    await materialiseTrees(root);
    write(
      join(root, 'tooling', 'app-yaml', 'render.mjs'),
      [
        "import { renderedListingFiles } from '../../contracts/store/vocabulary.js';",
        "export const RENDERED_LISTING_FILES = ['title.txt', 'short-description.txt', 'category.txt', 'privacy-policy-url.txt', 'support-url.txt'];",
        'void renderedListingFiles;',
        '',
      ].join('\n'),
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /restates RENDERED_LISTING_FILES as an array literal/);
  });

  test('a consumer that dropped the import reds', async () => {
    const root = makeRoot('no-import');
    await materialiseTrees(root);
    write(join(root, 'extensions', 'scripts', 'check-store-metadata.mjs'), 'const REQUIRED_PER_STORE = fromSomewhereElse();\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /does not import \.\.\/\.\.\/contracts\/store\/vocabulary\.js/);
  });

  test('an IMPORTING consumer whose exported value disagrees still reds — the import is the floor, not the proof', async () => {
    const root = makeRoot('import-but-wrong');
    await materialiseTrees(root);
    write(
      join(root, 'tooling', 'app-yaml', 'render.mjs'),
      [
        "import { renderedListingFiles } from '../../contracts/store/vocabulary.js';",
        'const files = renderedListingFiles();',
        'export const RENDERED_LISTING_FILES = files.slice(1);',
        '',
      ].join('\n'),
    );
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /does not equal the contract's renderedListingFiles\(\)/);
  });
});

describe('assert-store-vocabulary — the generated copy', () => {
  test('a hand-edited vocabulary.json reds', async () => {
    const root = makeRoot('hand-edited-json');
    await materialiseTrees(root);
    const p = join(root, 'contracts', 'store', 'vocabulary.json');
    const j = JSON.parse(readFileSync(p, 'utf8'));
    j.deviceClasses.push('foldable');
    writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /is not what contracts\/store\/vocabulary\.js would generate/);
  });
});

describe('contracts/store/generate.mjs — its own floors', () => {
  const GEN = join(REPO, 'contracts', 'store', 'generate.mjs');

  test('--check passes on the committed tree', () => {
    const r = spawnSync(process.execPath, [GEN, '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
});
