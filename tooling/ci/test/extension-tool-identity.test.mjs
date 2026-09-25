// ─────────────────────────────────────────────────────────────────────────────
// extension-tool-identity.test.mjs — extensions/scripts/lib/tool-identity.mjs,
// the one place a tool's Firefox add-on id is built and a placeholder identity
// value is recognised (O-NEW-TOOL-HAS-NO-FIREFOX-IDENTITY).
//
// Graded here:
//   - geckoIdFor, isPlaceholderValue, isPlaceholderIdentity — each input a
//     reader can meet, written out one case at a time;
//   - readHouseIdentity / identityFromHouse against the real
//     tooling/house-identity.json;
//   - derivedListingId on the real Full_Screen_Shot, and on tmpdir copies with
//     one thing broken each;
//   - the lib's mergePatch is scripts/pack.mjs's mergePatch, compared as code
//     (pack.mjs exports nothing and packs when loaded, so it cannot be imported);
//   - the scripts that used to build the id themselves now import it.
//
// Run:  node --test tooling/ci/test/extension-tool-identity.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  geckoIdFor, isPlaceholderValue, isPlaceholderIdentity, LISTED_IDENTITY_FIELDS,
  readHouseIdentity, identityFromHouse, mergePatch, derivedListingId,
} from '../../../extensions/scripts/lib/tool-identity.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXT = join(REPO, 'extensions');
const FULLSHOT = join(EXT, 'Extension', 'Full_Screen_Shot');
const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));

/* Comments and whitespace differ freely; the CODE may not. The same reduction
   Full_Screen_Shot's publish/package.node.js applies in mergePatchDrift(). */
function normalizeFn(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* The text of `function mergePatch … }` in a source file, by brace depth. */
function mergePatchSource(src) {
  const start = src.indexOf('function mergePatch');
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

describe('geckoIdFor', () => {
  test('slug and owner domain, joined by @', () => {
    assert.equal(geckoIdFor({ slug: 'fullshot', ownerDomain: 'nikatru.com' }), 'fullshot@nikatru.com');
  });
  test('the template placeholder passes through unchanged, for isPlaceholderValue to refuse', () => {
    assert.equal(geckoIdFor({ slug: 'newtool', ownerDomain: 'REPLACE-WITH-YOUR-DOMAIN.com' }), 'newtool@REPLACE-WITH-YOUR-DOMAIN.com');
  });
  test('a missing owner domain is spelled out, not dropped', () => {
    assert.equal(geckoIdFor({ slug: 'newtool' }), 'newtool@undefined');
  });
});

describe('isPlaceholderValue', () => {
  test('the empty string is a placeholder', () => {
    assert.equal(isPlaceholderValue(''), true);
  });
  test('undefined is a placeholder', () => {
    assert.equal(isPlaceholderValue(undefined), true);
  });
  test('null is a placeholder', () => {
    assert.equal(isPlaceholderValue(null), true);
  });
  test('the template domain REPLACE-WITH-YOUR-DOMAIN.com is a placeholder', () => {
    assert.equal(isPlaceholderValue('REPLACE-WITH-YOUR-DOMAIN.com'), true);
  });
  test('REPLACE anywhere, any case, is a placeholder', () => {
    assert.equal(isPlaceholderValue('https://replace-me.nikatru.com/x/privacy'), true);
  });
  test('an add-on id on the template domain is a placeholder', () => {
    assert.equal(isPlaceholderValue('newtool@REPLACE-WITH-YOUR-DOMAIN.com'), true);
  });
  test('a .example domain at the end is a placeholder', () => {
    assert.equal(isPlaceholderValue('acme.example'), true);
  });
  test('a .example host followed by a path is a placeholder', () => {
    assert.equal(isPlaceholderValue('https://acme.example/tool/privacy'), true);
  });
  test('a .example host followed by a port is a placeholder', () => {
    assert.equal(isPlaceholderValue('https://acme.example:8443/'), true);
  });
  test('an address at a .example domain is a placeholder', () => {
    assert.equal(isPlaceholderValue('support@acme.example'), true);
  });
  test('a real domain is not a placeholder', () => {
    assert.equal(isPlaceholderValue('nikatru.com'), false);
  });
  test('a real add-on id is not a placeholder', () => {
    assert.equal(isPlaceholderValue('fullshot@nikatru.com'), false);
  });
  test('a real host that merely contains "example" as a label prefix is not a placeholder', () => {
    assert.equal(isPlaceholderValue('https://examples.nikatru.com/'), false);
  });
  test('.examples (a different TLD spelling) is not the reserved domain', () => {
    assert.equal(isPlaceholderValue('acme.examples'), false);
  });
});

describe('isPlaceholderIdentity', () => {
  test('a real identity is not a placeholder', () => {
    assert.equal(isPlaceholderIdentity({ slug: 'fullshot', ownerDomain: 'nikatru.com' }), false);
  });
  test('the template identity is a placeholder', () => {
    assert.equal(isPlaceholderIdentity({ slug: 'newtool', ownerDomain: 'REPLACE-WITH-YOUR-DOMAIN.com' }), true);
  });
  test('an identity with no owner domain is a placeholder', () => {
    assert.equal(isPlaceholderIdentity({ slug: 'newtool' }), true);
  });
  test('null is a placeholder identity', () => {
    assert.equal(isPlaceholderIdentity(null), true);
  });
  test('a string is not an identity', () => {
    assert.equal(isPlaceholderIdentity('nikatru.com'), true);
  });
});

describe('the house identity', () => {
  test('LISTED_IDENTITY_FIELDS names the three listed fields, in order', () => {
    assert.deepEqual(LISTED_IDENTITY_FIELDS, ['ownerDomain', 'supportEmail', 'privacyPolicyUrl']);
  });
  test('readHouseIdentity reads the real tooling/house-identity.json', () => {
    const h = readHouseIdentity(REPO);
    assert.equal(h.error, undefined, h.error);
    assert.equal(h.value.ownerDomain, 'nikatru.com');
    assert.equal(h.value.supportEmail, 'support@nikatru.com');
    assert.equal(h.value.privacyPolicyUrlPattern, 'https://nikatru.com/{slug}/privacy');
    assert.equal(h.value.homepageUrl, 'https://nikatru.com/');
  });
  test('readHouseIdentity returns an error, not a partial object, when the file is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tool-identity-nohouse-'));
    try {
      const h = readHouseIdentity(dir);
      assert.equal(h.value, undefined);
      assert.match(h.error, /tooling\/house-identity\.json could not be read/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('readHouseIdentity returns an error when a field is a bare string rather than {value, why}', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tool-identity-barehouse-'));
    try {
      const real = readJson(join(REPO, 'tooling', 'house-identity.json'));
      real.supportEmail = 'support@nikatru.com';
      mkdirSync(join(dir, 'tooling'));
      writeFileSync(join(dir, 'tooling', 'house-identity.json'), JSON.stringify(real, null, 2));
      const h = readHouseIdentity(dir);
      assert.equal(h.value, undefined);
      assert.match(h.error, /supportEmail\.value is not a non-empty string/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('identityFromHouse expands {slug} in the privacy pattern', () => {
    const h = readHouseIdentity(REPO).value;
    assert.deepEqual(identityFromHouse(h, 'newtool'), {
      slug: 'newtool',
      ownerDomain: 'nikatru.com',
      supportEmail: 'support@nikatru.com',
      privacyPolicyUrl: 'https://nikatru.com/newtool/privacy',
      homepageUrl: 'https://nikatru.com/',
    });
  });
  test('identityFromHouse of the house values and "fullshot" is Full_Screen_Shot\'s identity.json, field for field', () => {
    const h = readHouseIdentity(REPO).value;
    const want = identityFromHouse(h, 'fullshot');
    const have = readJson(join(FULLSHOT, 'publish', 'identity.json'));
    assert.equal(have.slug, want.slug);
    assert.equal(have.ownerDomain, want.ownerDomain);
    assert.equal(have.supportEmail, want.supportEmail);
    assert.equal(have.privacyPolicyUrl, want.privacyPolicyUrl);
    assert.equal(have.homepageUrl, want.homepageUrl);
  });
});

describe('mergePatch', () => {
  test('a null member deletes', () => {
    assert.deepEqual(mergePatch({ a: 1, b: 2 }, { b: null }), { a: 1 });
  });
  test('an object member merges recursively', () => {
    assert.deepEqual(mergePatch({ s: { a: 1, b: 2 } }, { s: { b: 3 } }), { s: { a: 1, b: 3 } });
  });
  test('an array replaces wholesale', () => {
    assert.deepEqual(mergePatch({ l: [1, 2, 3] }, { l: [9] }), { l: [9] });
  });
  test('the lib\'s mergePatch is scripts/pack.mjs\'s mergePatch, as code', () => {
    const packSrc = mergePatchSource(readFileSync(join(EXT, 'scripts', 'pack.mjs'), 'utf8'));
    const libSrc = mergePatchSource(readFileSync(join(EXT, 'scripts', 'lib', 'tool-identity.mjs'), 'utf8'));
    assert.notEqual(packSrc, null, 'scripts/pack.mjs no longer defines a function named mergePatch');
    assert.notEqual(libSrc, null, 'lib/tool-identity.mjs no longer defines a function named mergePatch');
    assert.equal(normalizeFn(libSrc), normalizeFn(packSrc),
      'lib/tool-identity.mjs mergePatch and scripts/pack.mjs mergePatch are no longer the same code');
  });
  test('the comparison above can fail: a one-token change to a copy of the source is seen', () => {
    const packSrc = mergePatchSource(readFileSync(join(EXT, 'scripts', 'pack.mjs'), 'utf8'));
    const mutated = packSrc.replace('delete out[key]', 'out[key] = null');
    assert.notEqual(mutated, packSrc, 'the mutation found nothing to change');
    assert.notEqual(normalizeFn(mutated), normalizeFn(packSrc));
  });
});

describe('derivedListingId on the real Full_Screen_Shot', () => {
  const tool = readJson(join(FULLSHOT, 'tool.json'));
  test('the firefox store\'s listing id is fullshot@nikatru.com, read from the merged manifest', () => {
    const d = derivedListingId({ tool, storeKey: 'firefox', root: FULLSHOT });
    assert.equal(d.problem, null, d.problem);
    assert.equal(d.listingId, 'fullshot@nikatru.com');
    assert.equal(d.manifestId, 'fullshot@nikatru.com');
    assert.equal(d.identityId, 'fullshot@nikatru.com');
    assert.equal(d.manifest, 'manifest.json + publish/manifest.firefox.json');
  });
  test('the chrome store declares no add-on id, so its listing id is store-issued (null)', () => {
    assert.equal(derivedListingId({ tool, storeKey: 'chrome', root: FULLSHOT }), null);
  });
  test('the edge store declares no add-on id, so its listing id is store-issued (null)', () => {
    assert.equal(derivedListingId({ tool, storeKey: 'edge', root: FULLSHOT }), null);
  });
  test('a store the tool does not declare is a problem, not a null', () => {
    const d = derivedListingId({ tool, storeKey: 'opera', root: FULLSHOT });
    assert.match(d.problem, /declares no storeMetadata\.stores\.opera/);
  });
});

describe('derivedListingId on a broken copy', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'tool-identity-fullshot-'));
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  /* A fresh copy of just the files derivedListingId reads, per case. */
  function copyOf(name) {
    const root = join(dir, name);
    mkdirSync(join(root, 'publish'), { recursive: true });
    cpSync(join(FULLSHOT, 'tool.json'), join(root, 'tool.json'));
    cpSync(join(FULLSHOT, 'manifest.json'), join(root, 'manifest.json'));
    cpSync(join(FULLSHOT, 'publish', 'manifest.firefox.json'), join(root, 'publish', 'manifest.firefox.json'));
    cpSync(join(FULLSHOT, 'publish', 'identity.json'), join(root, 'publish', 'identity.json'));
    return root;
  }

  test('an unchanged copy derives fullshot@nikatru.com', () => {
    const root = copyOf('green');
    const d = derivedListingId({ tool: readJson(join(root, 'tool.json')), storeKey: 'firefox', root });
    assert.equal(d.listingId, 'fullshot@nikatru.com');
  });
  test('identity.json naming another domain is two values for one id', () => {
    const root = copyOf('mismatch');
    const idPath = join(root, 'publish', 'identity.json');
    const id = readJson(idPath);
    id.ownerDomain = 'other-domain.com';
    writeFileSync(idPath, JSON.stringify(id, null, 2));
    const d = derivedListingId({ tool: readJson(join(root, 'tool.json')), storeKey: 'firefox', root });
    assert.equal(d.listingId, null);
    assert.match(d.problem, /declares the add-on id "fullshot@nikatru\.com" and publish\/identity\.json implies "fullshot@other-domain\.com": two values for one id/);
  });
  test('the template placeholder in identity.json is a placeholder problem', () => {
    const root = copyOf('placeholder');
    const idPath = join(root, 'publish', 'identity.json');
    const id = readJson(idPath);
    id.ownerDomain = 'REPLACE-WITH-YOUR-DOMAIN.com';
    writeFileSync(idPath, JSON.stringify(id, null, 2));
    const d = derivedListingId({ tool: readJson(join(root, 'tool.json')), storeKey: 'firefox', root });
    assert.equal(d.listingId, null);
    assert.match(d.problem, /the add-on id is a placeholder/);
  });
  test('no identity.json beside a manifest that declares an id is a problem', () => {
    const root = copyOf('noidentity');
    rmSync(join(root, 'publish', 'identity.json'));
    const d = derivedListingId({ tool: readJson(join(root, 'tool.json')), storeKey: 'firefox', root });
    assert.equal(d.listingId, null);
    assert.match(d.problem, /publish\/identity\.json could not be read/);
  });
  test('an overlay that removes the add-on id makes the listing id store-issued (null)', () => {
    const root = copyOf('noid');
    const ovPath = join(root, 'publish', 'manifest.firefox.json');
    const ov = readJson(ovPath);
    ov.browser_specific_settings = null;
    writeFileSync(ovPath, JSON.stringify(ov, null, 2));
    assert.equal(derivedListingId({ tool: readJson(join(root, 'tool.json')), storeKey: 'firefox', root }), null);
  });
  test('a store that names no target is a problem', () => {
    const root = copyOf('notarget');
    const tool = readJson(join(root, 'tool.json'));
    delete tool.storeMetadata.stores.firefox.target;
    const d = derivedListingId({ tool, storeKey: 'firefox', root });
    assert.match(d.problem, /names no build target/);
  });
  test('an overlay that does not parse is a problem', () => {
    const root = copyOf('badoverlay');
    writeFileSync(join(root, 'publish', 'manifest.firefox.json'), '{ not json');
    const d = derivedListingId({ tool: readJson(join(root, 'tool.json')), storeKey: 'firefox', root });
    assert.match(d.problem, /publish\/manifest\.firefox\.json could not be read/);
  });
});

describe('the derivations import the lib', () => {
  const LIB_IMPORT = /import \{[^}]*\bgeckoIdFor\b[^}]*\} from '[./]*(?:scripts\/)?lib\/tool-identity\.mjs';/;
  test('scripts/check-store-packages.mjs imports geckoIdFor from the lib', () => {
    assert.match(readFileSync(join(EXT, 'scripts', 'check-store-packages.mjs'), 'utf8'), LIB_IMPORT);
  });
  test('scripts/policy-check.mjs imports geckoIdFor from the lib', () => {
    assert.match(readFileSync(join(EXT, 'scripts', 'policy-check.mjs'), 'utf8'), LIB_IMPORT);
  });
  test('templates/tool/publish/pack.mjs imports geckoIdFor from the lib', () => {
    assert.match(readFileSync(join(EXT, 'templates', 'tool', 'publish', 'pack.mjs'), 'utf8'), LIB_IMPORT);
  });
  test('templates/tool/publish/bump-version.mjs imports geckoIdFor from the lib', () => {
    assert.match(readFileSync(join(EXT, 'templates', 'tool', 'publish', 'bump-version.mjs'), 'utf8'), LIB_IMPORT);
  });
  test('no derivation builds the id by concatenating slug and ownerDomain itself', () => {
    const files = [
      join(EXT, 'scripts', 'check-store-packages.mjs'),
      join(EXT, 'scripts', 'policy-check.mjs'),
      join(EXT, 'templates', 'tool', 'publish', 'pack.mjs'),
      join(EXT, 'templates', 'tool', 'publish', 'bump-version.mjs'),
    ];
    const hits = files.filter((f) => /slug\s*\+\s*'@'\s*\+/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(hits, []);
  });
});

/* ⏱ 2026-09-25 (R-6, R-7): publish-arming.mjs toolListingId() — the arming
   lane's reader — takes a Firefox add-on id from derivedListingId and refuses a
   hand listingId on the same store. Graded on the real tree and on tmpdir trees
   shaped like the repository (extensions/Extension/<dir>/tool.json). */
describe('toolListingId derives the add-on id the package declares', () => {
  let dir;
  let arming;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tool-identity-arming-'));
    arming = await import('../../../extensions/scripts/publish-arming.mjs');
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  /* A repository-shaped copy of the files toolListingId and derivedListingId read. */
  function repoCopy(name, mutateTool) {
    const root = join(dir, name);
    const tdir = join(root, 'extensions', 'Extension', 'Full_Screen_Shot');
    mkdirSync(join(tdir, 'publish'), { recursive: true });
    const tool = readJson(join(FULLSHOT, 'tool.json'));
    if (mutateTool) mutateTool(tool);
    writeFileSync(join(tdir, 'tool.json'), JSON.stringify(tool, null, 2));
    cpSync(join(FULLSHOT, 'manifest.json'), join(tdir, 'manifest.json'));
    cpSync(join(FULLSHOT, 'publish', 'manifest.firefox.json'), join(tdir, 'publish', 'manifest.firefox.json'));
    cpSync(join(FULLSHOT, 'publish', 'identity.json'), join(tdir, 'publish', 'identity.json'));
    return root;
  }

  test('the real tree: the firefox listing id is fullshot@nikatru.com, derived', () => {
    const r = arming.toolListingId({ toolId: 'fullshot', storeKey: 'firefox', root: REPO });
    assert.equal(r.listingId, 'fullshot@nikatru.com');
    assert.equal(r.source, 'derived');
    assert.match(r.field, /manifest\.json \+ publish\/manifest\.firefox\.json\) browser_specific_settings\.gecko\.id$/);
  });
  test('the real tree: the chrome listing id is still read from the store row (null until issued)', () => {
    const r = arming.toolListingId({ toolId: 'fullshot', storeKey: 'chrome', root: REPO });
    assert.equal(r.source, 'declared');
    assert.equal(r.listingId, null);
  });
  test('the real tree: the edge listing id is still read from the store row', () => {
    const r = arming.toolListingId({ toolId: 'fullshot', storeKey: 'edge', root: REPO });
    assert.equal(r.source, 'declared');
    assert.equal(r.listingId, '877f2fe1-fcdd-4501-974d-bb00ee98d56b');
  });
  test('Full_Screen_Shot/tool.json carries no listingId on its firefox store', () => {
    const stores = readJson(join(FULLSHOT, 'tool.json')).storeMetadata.stores;
    assert.equal(Object.prototype.hasOwnProperty.call(stores.firefox, 'listingId'), false);
  });
  test('a hand listingId naming another add-on is refused as two sources (RC-F2)', () => {
    const root = repoCopy('two-sources-other', (t) => { t.storeMetadata.stores.firefox.listingId = 'x@nikatru.com'; });
    assert.throws(() => arming.toolListingId({ toolId: 'fullshot', storeKey: 'firefox', root }),
      (e) => e instanceof arming.ArmingIdentityRefused && /two sources for one add-on id/.test(e.lines[0]) && /"x@nikatru\.com"/.test(e.lines[0]));
  });
  test('a hand listingId equal to the derived id is still two sources', () => {
    const root = repoCopy('two-sources-same', (t) => { t.storeMetadata.stores.firefox.listingId = 'fullshot@nikatru.com'; });
    assert.throws(() => arming.toolListingId({ toolId: 'fullshot', storeKey: 'firefox', root }),
      (e) => e instanceof arming.ArmingIdentityRefused && /two sources for one add-on id/.test(e.lines[0]));
  });
  test('listingId: null on the firefox store is not a source, and the id is derived', () => {
    const root = repoCopy('null-hand', (t) => { t.storeMetadata.stores.firefox.listingId = null; });
    const r = arming.toolListingId({ toolId: 'fullshot', storeKey: 'firefox', root });
    assert.equal(r.listingId, 'fullshot@nikatru.com');
  });
  test('a placeholder identity is refused as a finding, not derived', () => {
    const root = repoCopy('placeholder');
    const idPath = join(root, 'extensions', 'Extension', 'Full_Screen_Shot', 'publish', 'identity.json');
    const id = readJson(idPath);
    id.ownerDomain = 'REPLACE-WITH-YOUR-DOMAIN.example';
    writeFileSync(idPath, JSON.stringify(id, null, 2));
    assert.throws(() => arming.toolListingId({ toolId: 'fullshot', storeKey: 'firefox', root }),
      (e) => e instanceof arming.ArmingIdentityRefused && /the add-on id is a placeholder/.test(e.lines[0]));
  });
  test('an identity.json that cannot be read is COVERAGE LOST, not a finding', () => {
    const root = repoCopy('noidentity');
    rmSync(join(root, 'extensions', 'Extension', 'Full_Screen_Shot', 'publish', 'identity.json'));
    assert.throws(() => arming.toolListingId({ toolId: 'fullshot', storeKey: 'firefox', root }),
      (e) => e instanceof arming.ArmingCoverageLost && !(e instanceof arming.ArmingIdentityRefused) && /^COVERAGE LOST/.test(e.lines[0]));
  });
  test('a tool directory with no manifest keeps the store-row path (the gate self-test\'s minimal fixtures)', () => {
    const root = join(dir, 'minimal');
    const tdir = join(root, 'extensions', 'Extension', 'fullshot');
    mkdirSync(tdir, { recursive: true });
    writeFileSync(join(tdir, 'tool.json'), JSON.stringify({ id: 'fullshot', storeMetadata: { stores: { firefox: { target: 'chromium', dir: 'store/firefox', served: false, listingId: 'fixture@nikatru.com' } } } }));
    const r = arming.toolListingId({ toolId: 'fullshot', storeKey: 'firefox', root });
    assert.equal(r.source, 'declared');
    assert.equal(r.listingId, 'fixture@nikatru.com');
  });
});

/* ⏱ 2026-09-25 (R-8, R-9): the `skip` verdict, and `--plan`. A tmpdir tree
   carries the real channel register plus a copy of Full_Screen_Shot's files, so
   the amo row is graded exactly as the real tree grades it. The credential values
   are made up — the verdict tests presence and never reads a value. */
describe('the amo lane answers skip for a tool with no Firefox package, and --plan reads no credential', () => {
  let dir;
  let arming;
  const ARMING_CLI = join(EXT, 'scripts', 'publish-arming.mjs');
  const FIXTURE_ENV = { AMO_JWT_ISSUER: 'fixture-issuer', AMO_JWT_SECRET: 'fixture-secret' };
  const BARE_ENV = { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tool-identity-skip-'));
    arming = await import('../../../extensions/scripts/publish-arming.mjs');
  });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  function laneTree(name, mutateTool) {
    const root = join(dir, name);
    const tdir = join(root, 'extensions', 'Extension', 'Full_Screen_Shot');
    mkdirSync(join(tdir, 'publish'), { recursive: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    cpSync(join(REPO, 'tooling', 'channel-register.json'), join(root, 'tooling', 'channel-register.json'));
    const tool = readJson(join(FULLSHOT, 'tool.json'));
    if (mutateTool) mutateTool(tool);
    writeFileSync(join(tdir, 'tool.json'), JSON.stringify(tool, null, 2));
    cpSync(join(FULLSHOT, 'manifest.json'), join(tdir, 'manifest.json'));
    cpSync(join(FULLSHOT, 'publish', 'manifest.firefox.json'), join(tdir, 'publish', 'manifest.firefox.json'));
    cpSync(join(FULLSHOT, 'publish', 'identity.json'), join(tdir, 'publish', 'identity.json'));
    return root;
  }
  function placeholderIdentity(root) {
    const idPath = join(root, 'extensions', 'Extension', 'Full_Screen_Shot', 'publish', 'identity.json');
    const id = readJson(idPath);
    id.ownerDomain = 'REPLACE-WITH-YOUR-DOMAIN.example';
    writeFileSync(idPath, JSON.stringify(id, null, 2));
  }
  const cli = (root, ...argv) => spawnSync(process.execPath, [ARMING_CLI, '--repo-root', root, ...argv], { encoding: 'utf8', env: BARE_ENV });

  test('the amo lane declares the firefox build target', () => {
    assert.equal(arming.LANES.amo.target, 'firefox');
  });
  test('the chrome and edge lanes declare no target, so they never answer skip', () => {
    assert.equal(arming.LANES['chrome-webstore'].target, undefined);
    assert.equal(arming.LANES['edge-addons'].target, undefined);
  });
  test('a tool with both the firefox target and the firefox store is graded, not skipped (go with credentials)', () => {
    const root = laneTree('both');
    const v = arming.laneVerdict('amo', { toolId: 'fullshot', env: FIXTURE_ENV, root });
    assert.equal(v.verdict, 'go');
    assert.equal(v.identity.listingId, 'fullshot@nikatru.com');
  });
  test('a tool with neither the firefox target nor the firefox store answers skip, with its reason (RC-F4)', () => {
    const root = laneTree('neither', (t) => { delete t.targets.firefox; delete t.storeMetadata.stores.firefox; });
    const v = arming.laneVerdict('amo', { toolId: 'fullshot', env: FIXTURE_ENV, root });
    assert.equal(v.verdict, 'skip');
    assert.match(v.reason, /declares neither a firefox build target .* nor a firefox store/);
    assert.match(v.lines[0], /^⬜ SKIPPED — channel "amo"/);
  });
  test('skip is decided before credentials: no credentials still answers skip, never refuse', () => {
    const root = laneTree('neither-nocreds', (t) => { delete t.targets.firefox; delete t.storeMetadata.stores.firefox; });
    const v = arming.laneVerdict('amo', { toolId: 'fullshot', env: {}, root });
    assert.equal(v.verdict, 'skip');
  });
  test('a firefox target with no firefox store is COVERAGE LOST, not skip', () => {
    const root = laneTree('target-only', (t) => { delete t.storeMetadata.stores.firefox; });
    assert.throws(() => arming.laneVerdict('amo', { toolId: 'fullshot', env: FIXTURE_ENV, root }),
      (e) => e instanceof arming.ArmingCoverageLost && !(e instanceof arming.ArmingIdentityRefused) && /builds a firefox target and declares no firefox store/.test(e.lines[0]));
  });
  test('a firefox store with no firefox target is COVERAGE LOST, not skip', () => {
    const root = laneTree('store-only', (t) => { delete t.targets.firefox; });
    assert.throws(() => arming.laneVerdict('amo', { toolId: 'fullshot', env: FIXTURE_ENV, root }),
      (e) => e instanceof arming.ArmingCoverageLost && !(e instanceof arming.ArmingIdentityRefused) && /declares a firefox store and no firefox build target/.test(e.lines[0]));
  });
  test('a caller that names no tool gets the channel-only answer and is never skipped', () => {
    const root = laneTree('no-tool', (t) => { delete t.targets.firefox; delete t.storeMetadata.stores.firefox; });
    const v = arming.laneVerdict('amo', { env: FIXTURE_ENV, root });
    assert.equal(v.verdict, 'go');
  });
  test('CLI: skip exits 0 and prints ARMING_VERDICT=skip and its ARMING_REASON (RC-F4)', () => {
    const root = laneTree('cli-neither', (t) => { delete t.targets.firefox; delete t.storeMetadata.stores.firefox; });
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ARMING_VERDICT=skip$/m);
    assert.match(r.stdout, /^ARMING_REASON=tool "fullshot" declares neither a firefox build target/m);
  });
  test('CLI: a store with no target exits 2, COVERAGE LOST (RC-F4)', () => {
    const root = laneTree('cli-store-only', (t) => { delete t.targets.firefox; });
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^COVERAGE LOST — .* declares a firefox store and no firefox build target/m);
  });
  test('CLI: a hand listingId beside the derived id exits 1 (a finding), not 2', () => {
    const root = laneTree('cli-two-sources', (t) => { t.storeMetadata.stores.firefox.listingId = 'x@nikatru.com'; });
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /two sources for one add-on id/);
  });
  test('CLI: an armed amo row with no credentials exits 1 and prints ARMING_VERDICT=refuse', () => {
    const root = laneTree('cli-nocreds');
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^ARMING_VERDICT=refuse$/m);
  });
  test('--plan on the real tree: exit 0, the derived id, and SKIPPED: not a release run', () => {
    const r = spawnSync(process.execPath, [ARMING_CLI, '--channel', 'amo', '--tool', 'fullshot', '--plan'], { encoding: 'utf8', env: BARE_ENV });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /identity axis: "fullshot@nikatru\.com" — derived/);
    assert.match(r.stdout, /arming axis: channel "amo" is ARMED/);
    assert.match(r.stdout.trimEnd(), /SKIPPED: not a release run$/);
  });
  test('--plan reads no credential: the same tree answers the same with made-up credentials set', () => {
    const root = laneTree('plan-creds');
    const bare = cli(root, '--channel', 'amo', '--tool', 'fullshot', '--plan');
    const withCreds = spawnSync(process.execPath, [ARMING_CLI, '--repo-root', root, '--channel', 'amo', '--tool', 'fullshot', '--plan'], { encoding: 'utf8', env: { ...BARE_ENV, ...FIXTURE_ENV } });
    assert.equal(bare.status, 0);
    assert.equal(withCreds.status, 0);
    assert.equal(withCreds.stdout, bare.stdout);
    assert.doesNotMatch(bare.stdout, /AMO_JWT/);
  });
  test('--plan exits 1 on the armed channel when the add-on id is a placeholder', () => {
    const root = laneTree('plan-placeholder');
    placeholderIdentity(root);
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot', '--plan');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /identity axis: 🔴 .*placeholder/);
    assert.match(r.stdout, /SKIPPED: not a release run/);
  });
  test('--plan exits 0 on an unarmed channel with a placeholder id, and says what arming it would do', () => {
    const root = laneTree('plan-placeholder-unarmed');
    const regPath = join(root, 'tooling', 'channel-register.json');
    const reg = readJson(regPath);
    reg.channels.find((c) => c.id === 'amo').submittable = false;
    writeFileSync(regPath, JSON.stringify(reg, null, 2));
    placeholderIdentity(root);
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot', '--plan');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /arming axis: channel "amo" is NOT ARMED/);
    assert.match(r.stdout, /arming it with this id refuses every release/);
  });
  test('--plan exits 2 when the identity file cannot be read (COVERAGE LOST)', () => {
    const root = laneTree('plan-noidentity');
    rmSync(join(root, 'extensions', 'Extension', 'Full_Screen_Shot', 'publish', 'identity.json'));
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot', '--plan');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^COVERAGE LOST/m);
  });
  test('--plan on a tool with no Firefox package: exit 0, surface axis SKIP', () => {
    const root = laneTree('plan-neither', (t) => { delete t.targets.firefox; delete t.storeMetadata.stores.firefox; });
    const r = cli(root, '--channel', 'amo', '--tool', 'fullshot', '--plan');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /surface axis: ⬜ SKIP — tool "fullshot" declares neither/);
    assert.match(r.stdout, /SKIPPED: not a release run/);
  });
});
