// ─────────────────────────────────────────────────────────────────────────────
// well-known-shape.test.mjs — the recorded failing cases for
// assert-well-known-shape.mjs (and for tooling/sites/generate-well-known.mjs,
// which it grades against).
//
// [pipeline F-10] "Every guard carries a recorded failing case and a self-check
// that its own scan still reaches everything it claims to cover."
//
// ── THE REDS WERE PROVED ON THE REAL TREE FIRST ──────────────────────────────
// Green control on this repository (exit 0, "NOTHING DECLARED AND NOTHING
// PUBLISHED"), then `sites/nikatru/.well-known/assetlinks.json` was HAND-WRITTEN
// into the real tree while zero apps qualify — guard exit 1 (limb A), generator
// exit 1 — then the directory was removed and both went green again with nothing
// left behind. The coverage limb was proved by taking the real tree's own bytes
// into a temp root and removing / emptying / corrupting `catalog/apps.json`:
// exit 2 each time, which is COVERAGE LOST and deliberately NOT a pass.
//
// ⚠️ WHY THE POPULATED CASES ARE FIXTURES AND NOT REAL-TREE MUTATIONS. Making an
// app qualify means editing `catalog/apps.json` and `apps/<id>/app.yaml`, which
// are other units' files and are being written by other agents in this same
// worktree; a checksum-verify race against a live writer names your own files.
// So the populated tree is built from the same shapes in a temp root, and the
// ONE mutation that touches a path this unit owns — a hand-written file under
// `sites/nikatru/.well-known/` — is the one done on the real tree.
//
// 🔴 EVERY CASE ASSERTS THE EXIT CODE, NOT JUST THE TEXT, and asserts it is the
// RIGHT non-zero: 1 is a finding and 2 is COVERAGE LOST, and a guard that exits
// 2 where a finding was expected has stopped checking rather than found nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { aasaDetail, appIdentity, mobilePresence, planWellKnown, SURFACES, AASA_REL, ASSETLINKS_REL, CHECKOUT_RETURN_PATH } from '../../sites/generate-well-known.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CI_DIR = resolve(HERE, '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-well-known-shape.mjs');
const GENERATOR = join(REPO, 'tooling', 'sites', 'generate-well-known.mjs');

/* Never through a pipe, and never `$?` beside a command substitution: this
   corpus has read "EXIT 0" off a guard that exited 1 exactly that way. */
const spawn = (script, root) => {
  const r = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  return { code: r.status === null ? 2 : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const run = (root) => spawn(GUARD, root);
const generate = (root) => spawn(GENERATOR, root);

const CATALOG_REL = 'catalog/apps.json';
const HEADERS_REL = 'sites/nikatru/_headers';

const ROW = ({ slug = 'demo', platforms = ['web'], listings = {} } = {}) => ({
  slug,
  name: 'Nikatru Subscription Tracker',
  tagline: 'Track every subscription in one place',
  url: `https://nikatru.com/${slug}`,
  listings: { web: `https://nikatru.com/${slug}`, play: null, appstore: null, ...listings },
  platforms,
  status: 'live',
});

const DECL = ({ slug = 'demo', mobile = null } = {}) =>
  [
    `id: ${slug}`,
    'name: Nikatru Subscription Tracker',
    'shortName: Subscriptions',
    'tagline: Track every subscription in one place',
    'category: Productivity',
    'status: live',
    'hosts:',
    `  web: ${slug}.nikatru.com`,
    'platforms:',
    '  - web',
    'listings:',
    'legal:',
    '  privacyPolicyUrl: https://nikatru.com/privacy',
    '  supportUrl: https://nikatru.com/contact',
    ...(mobile ? mobile : []),
    '',
  ].join('\n');

/** ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): the identity is read from the records that hold it.
 *  The Android half is the app's own `stores.android-play` record, as app.yaml lines; the package name
 *  is derived (com.nikatru.<id>). The iOS half is the Apple register below: its `teamId` and the
 *  app's bundle id. A fixture team id, never the account's. */
const MOBILE = [
  'stores:',
  '  android-play:',
  '    state: issued',
  '    declaredOn: null',
  '    appSigningSha256:',
  '      - "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00"',
];

const FIXTURE_TEAM_ID = 'ABCDE12345';
/** The REAL tooling/apple-provisioning.json (read at run time, never copied into this file: it names App
 *  Store Connect resource ids), with the fixture app `demo` declared and a fixture team id. `mutate` edits it;
 *  null writes none. */
const appleRegister = (mutate = null) => {
  const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'apple-provisioning.json'), 'utf8'));
  reg.apps.demo = { bundleId: 'com.nikatru.demo', capabilities: ['IN_APP_PURCHASE'] };
  reg.teamId = FIXTURE_TEAM_ID;
  if (mutate) mutate(reg);
  return `${JSON.stringify(reg, null, 2)}\n`;
};

/** The `_headers` line limb H requires once an AASA exists. */
const AASA_HEADER = '/.well-known/apple-app-site-association\n  Content-Type: application/json\n';

/**
 * A root carrying only what this guard reads: the catalogue, the declarations,
 * and `_headers`. Everything else is absent on purpose — a fixture that copies
 * the repository grades the repository.
 */
function tree({ rows = [ROW()], decls = [DECL()], headers = '', catalog = undefined, apple = appleRegister() } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'well-known-'));
  mkdirSync(join(root, 'catalog'), { recursive: true });
  writeFileSync(join(root, ...CATALOG_REL.split('/')), catalog === undefined ? `${JSON.stringify(rows, null, 2)}\n` : catalog);
  for (const [i, text] of decls.entries()) {
    const slug = /^id: (\S+)/m.exec(text)?.[1] ?? `app${i}`;
    mkdirSync(join(root, 'apps', slug), { recursive: true });
    writeFileSync(join(root, 'apps', slug, 'app.yaml'), text);
  }
  mkdirSync(join(root, 'sites', 'nikatru'), { recursive: true });
  writeFileSync(join(root, ...HEADERS_REL.split('/')), headers);
  if (apple !== null) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'apple-provisioning.json'), apple);
  }
  return root;
}

/** A root where an app qualifies on both surfaces AND the files are generated. */
function populated(extra = {}) {
  const root = tree({
    rows: [ROW({ platforms: ['web', 'ios', 'android'], listings: { play: 'https://play.google.com/store/apps/details?id=com.nikatru.demo', appstore: 'https://apps.apple.com/app/id123456789' } })],
    decls: [DECL({ mobile: MOBILE })],
    headers: AASA_HEADER,
    ...extra,
  });
  const gen = generate(root);
  assert.equal(gen.code, 0, `the fixture generator must succeed or every case below is about a tree nobody could ship:\n${gen.out}`);
  return root;
}

const kill = (root) => rmSync(root, { recursive: true, force: true });
const readJson = (root, rel) => JSON.parse(readFileSync(join(root, ...rel.split('/')), 'utf8'));
const writeJson = (root, rel, value) => writeFileSync(join(root, ...rel.split('/')), `${JSON.stringify(value, null, 2)}\n`);

describe('assert-well-known-shape — the real tree', () => {
  test('POSITIVE CONTROL: this repository is green, and green means "nothing declared, nothing published"', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, `the shipped tree must pass, or every red below is about a tree nobody ships:\n${out}`);
    assert.match(out, /NOTHING DECLARED AND NOTHING PUBLISHED/);
    assert.match(out, /0 qualifying app\/surface pair\(s\), 0 file\(s\)/);
  });

  test('the generator writes NOTHING on this tree, and says why', () => {
    const { code, out } = generate(REPO);
    assert.equal(code, 0, out);
    assert.match(out, /0 file\(s\) planned, 0 written/);
    assert.match(out, /NOTHING TO DECLARE, SO NOTHING IS PUBLISHED/);
    assert.equal(existsSync(join(REPO, 'sites', 'nikatru', '.well-known')), false, 'a run with nothing to declare must not create the directory either');
  });

  test('the apex is imported, never typed: no literal hostname or app id in either file', () => {
    for (const abs of [GUARD, GENERATOR]) {
      const source = readFileSync(abs, 'utf8');
      // Comments carry the reasoning and DO name the host; the executable lines
      // must not. Strip line comments and block comments before looking.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.equal(/['"`][^'"`]*nikatru\.com/.test(code), false, `${abs} spells the apex in code instead of importing it from apex.mjs`);
      assert.equal(/['"`]subscriptiontracker['"`]/.test(code), false, `${abs} names one app in code; the set comes from the catalogue`);
    }
  });
});

describe('limb 0 — COVERAGE LOST is exit 2, and 2 is not a pass', () => {
  test('no catalogue at all', () => {
    const root = tree();
    rmSync(join(root, ...CATALOG_REL.split('/')));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — limb 0 \(the catalogue\) refused/);
    kill(root);
  });

  test('an empty catalogue — the shape that makes every other limb vacuously true', () => {
    const root = tree({ catalog: '[]\n' });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /carries no entries/);
    kill(root);
  });

  test('an unparseable catalogue', () => {
    const root = tree({ catalog: '{ not json\n' });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /not valid JSON/);
    kill(root);
  });

  test('a green run REPORTS its comparison count, so a scan that stops scanning is visible', () => {
    const { out } = run(REPO);
    const m = /(\d+) comparison\(s\)/.exec(out);
    assert.ok(m, `the passing line must carry a measurement:\n${out}`);
    assert.ok(Number(m[1]) > 0, 'a green run that compared nothing is the defect this guard exists to prevent');
  });
});

describe('limb A — the measured pair', () => {
  test('a hand-written association file while ZERO apps qualify', () => {
    const root = tree();
    mkdirSync(join(root, 'sites', 'nikatru', '.well-known'), { recursive: true });
    writeJson(root, ASSETLINKS_REL, [
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.nikatru.demo', sha256_cert_fingerprints: ['11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00'] } },
    ]);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb A \(the measured pair\)/);
    assert.match(out, /ZERO apps qualify/);
    kill(root);
  });

  test('the generator refuses the same file independently', () => {
    const root = tree();
    mkdirSync(join(root, 'sites', 'nikatru', '.well-known'), { recursive: true });
    writeJson(root, ASSETLINKS_REL, []);
    const { code, out } = generate(root);
    assert.equal(code, 1, out);
    assert.match(out, /this generator does not own it/);
    kill(root);
  });

  test('a qualifying app with NO file — the other direction of the same pair', () => {
    const root = tree({
      rows: [ROW({ platforms: ['web', 'ios'], listings: { appstore: 'https://apps.apple.com/app/id123456789' } })],
      decls: [DECL({ mobile: MOBILE })],
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /qualify .* and NO file exists/);
    kill(root);
  });

  test('a mobile presence with no identity is a FINDING, never a silent skip', () => {
    const root = tree({ rows: [ROW({ platforms: ['web', 'android'], listings: { play: 'https://play.google.com/store/apps/details?id=com.nikatru.demo' } })] });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /claims a android presence .* does not declare a usable identity/);
    kill(root);
  });

  // ⏱ 9b: the Apple half now exists for every app the Apple register declares, so an identity with no
  // presence is the normal state of an unshipped app. It publishes nothing and is not a finding.
  test('an identity with no presence publishes nothing, and is not a finding', () => {
    const root = tree({ decls: [DECL({ mobile: MOBILE })] });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    const gen = generate(root);
    assert.equal(gen.code, 0, gen.out);
    assert.match(gen.out, /0 qualifying \(ios\+android\), 0 file\(s\) planned/);
    kill(root);
  });

  test('🔴 RC8 — the Apple half reads teamId from tooling/apple-provisioning.json: without it an iOS presence is a finding', () => {
    const root = tree({
      rows: [ROW({ platforms: ['web', 'ios'], listings: { appstore: 'https://apps.apple.com/app/id123456789' } })],
      apple: appleRegister((reg) => delete reg.teamId),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /claims a ios presence .* does not declare a usable identity: tooling\/apple-provisioning\.json declares no usable teamId/);
    kill(root);
  });

  test('an iOS presence for an app the Apple register does not declare is a finding naming the app', () => {
    const root = tree({
      rows: [ROW({ platforms: ['web', 'ios'], listings: { appstore: 'https://apps.apple.com/app/id123456789' } })],
      apple: appleRegister((reg) => delete reg.apps.demo),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /declares no app "demo"/);
    kill(root);
  });
});

describe('limbs B–H — a populated tree, graded as a stranger\'s device would read it', () => {
  test('GREEN CONTROL: generated files pass every limb', () => {
    const root = populated();
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /graded on limbs B–H/);
    kill(root);
  });

  test('limb B — one edited byte in a generated file', () => {
    const root = populated();
    const aasa = readJson(root, AASA_REL);
    aasa.applinks.details[0].appIDs = ['ZZZZZ99999.com.nikatru.demo'];
    writeJson(root, AASA_REL, aasa);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb B \(drift\)/);
    kill(root);
  });

  test('limb C — an AASA that does not parse', () => {
    const root = populated();
    writeFileSync(join(root, ...AASA_REL.split('/')), '{ nope\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb C \(JSON\)/);
    kill(root);
  });

  test('limb D — the `.json` spelling iOS never fetches', () => {
    const root = populated();
    cpSync(join(root, ...AASA_REL.split('/')), join(root, ...`${AASA_REL}.json`.split('/')));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb D \(extension\)/);
    // ONE finding for one file: an earlier draft reported it twice.
    assert.equal(out.match(/limb D \(extension\)/g).length, 1, out);
    kill(root);
  });

  test('limb E — a component naming a slug the catalogue does not have', () => {
    const root = populated();
    const aasa = readJson(root, AASA_REL);
    aasa.applinks.details[0].components[1]['/'] = '/ghost/*';
    writeJson(root, AASA_REL, aasa);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /"ghost" is not a slug/);
    assert.match(out, /no entry in .* claims \/demo\/\*/, 'the reverse direction must fire too, or the set equality is half a check');
    kill(root);
  });

  test('limb E — a component widened past the app\'s own path', () => {
    const root = populated();
    const aasa = readJson(root, AASA_REL);
    aasa.applinks.details[0].components[1]['/'] = '/*';
    writeJson(root, AASA_REL, aasa);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /not the one shape this origin allows/);
    kill(root);
  });

  test('limb F — the checkout-return exclusion DELETED', () => {
    const root = populated();
    const aasa = readJson(root, AASA_REL);
    aasa.applinks.details[0].components = aasa.applinks.details[0].components.filter((c) => c.exclude !== true);
    writeJson(root, AASA_REL, aasa);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb F \(checkout-return\)/);
    assert.match(out, /does not exclude \/checkout-return/);
    kill(root);
  });

  test('limb F — the exclusion REORDERED behind the include, which is the silent version', () => {
    const root = populated();
    const aasa = readJson(root, AASA_REL);
    const c = aasa.applinks.details[0].components;
    aasa.applinks.details[0].components = [c[1], c[0]];
    writeJson(root, AASA_REL, aasa);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /AFTER an including component/);
    kill(root);
  });

  test('limb G — a path key in assetlinks.json, which narrows nothing', () => {
    const root = populated();
    const links = readJson(root, ASSETLINKS_REL);
    links[0].target.paths = ['/demo/*'];
    writeJson(root, ASSETLINKS_REL, links);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /THERE IS NO PATH-SCOPED DIGITAL ASSET LINKS/);
    kill(root);
  });

  test('limb G — an object instead of the flat array', () => {
    const root = populated();
    writeJson(root, ASSETLINKS_REL, { statements: readJson(root, ASSETLINKS_REL) });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /is not a JSON ARRAY/);
    kill(root);
  });

  test('limb G — a fingerprint that is not 32 hex octets', () => {
    const root = populated();
    const links = readJson(root, ASSETLINKS_REL);
    links[0].target.sha256_cert_fingerprints = ['deadbeef'];
    writeJson(root, ASSETLINKS_REL, links);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /sha256_cert_fingerprints/);
    kill(root);
  });

  test('limb G — the whole-origin grant is PRINTED on a green run, not buried', () => {
    const root = populated();
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /verified for ALL of/);
    kill(root);
  });

  test('limb H — an extensionless AASA with no Content-Type rule', () => {
    const root = populated();
    writeFileSync(join(root, ...HEADERS_REL.split('/')), '# nothing about .well-known here\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /limb H \(content type\)/);
    kill(root);
  });
});

describe('the plan itself', () => {
  test('the exclusion is component ZERO, because first match wins', () => {
    const detail = aasaDetail('demo', 'ABCDE12345.com.nikatru.demo');
    assert.equal(detail.components[0]['/'], CHECKOUT_RETURN_PATH);
    assert.equal(detail.components[0].exclude, true);
    assert.equal(detail.components[1]['/'], '/demo/*');
  });

  test('presence is either half of the catalogue claim, and nothing else', () => {
    const ios = SURFACES.find((s) => s.id === 'ios');
    assert.equal(mobilePresence(ROW(), ios).length, 0);
    assert.equal(mobilePresence(ROW({ platforms: ['web', 'ios'] }), ios).length, 1);
    assert.equal(mobilePresence(ROW({ listings: { appstore: 'https://apps.apple.com/app/id1' } }), ios).length, 1);
  });

  test('identity is read from the records, and never half-accepted', () => {
    const withRecord = tree({ decls: [DECL({ mobile: MOBILE })] });
    const ios = appIdentity(withRecord, 'demo', 'ios');
    assert.equal(ios.ok, true, ios.missing.join('; '));
    assert.equal(ios.value.appID, `${FIXTURE_TEAM_ID}.com.nikatru.demo`, 'the appID is the register\'s teamId and bundleIdOf, joined');
    const android = appIdentity(withRecord, 'demo', 'android');
    assert.equal(android.ok, true, android.missing.join('; '));
    assert.equal(android.value.packageName, 'com.nikatru.demo');
    kill(withRecord);
    const noTeam = tree({ apple: appleRegister((reg) => delete reg.teamId) });
    assert.equal(appIdentity(noTeam, 'demo', 'ios').ok, false);
    kill(noTeam);
    const noRecord = tree();
    assert.equal(appIdentity(noRecord, 'demo', 'android').ok, false);
    kill(noRecord);
    const emptyPrint = tree({ decls: [DECL({ mobile: ['stores:', '  android-play:', '    state: issued', '    declaredOn: null', '    appSigningSha256: []'] })] });
    assert.equal(appIdentity(emptyPrint, 'demo', 'android').ok, false);
    kill(emptyPrint);
  });

  test('a plan over this repository writes no file and reports the pair', () => {
    const plan = planWellKnown(REPO);
    assert.equal(plan.problems.length, 0, plan.problems.join('\n'));
    assert.equal(plan.qualifying.length, 0);
    assert.equal(plan.files.size, 0, 'an EMPTY association file is a cached negative answer, not a harmless placeholder');
    assert.ok(plan.comparisons > 0, 'a plan that compared nothing cannot support "nothing qualifies"');
  });
});
