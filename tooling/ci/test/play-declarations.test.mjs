// ─────────────────────────────────────────────────────────────────────────────
// play-declarations.test.mjs — assert-play-declarations.mjs must be able to FAIL.
//
// RECORDED MUTATION RUN, against the REAL TREE (not a copy, not these fixtures):
// **24/24 caught**, baseline PASS before and after, every file restored from an
// in-memory original and byte-compared, `git status` clean at the end.
//
// 🔬 THAT RUN FOUND TWO BUGS AND BOTH WERE MINE, NOT THE GUARD'S — and they are
// the failure this repository keeps writing down, so they are recorded here.
//
//   1. THE GUARD'S OWN DECLARATION WAS INCOMPLETE, and the guard caught it on the
//      first run. "Device or other IDs" answered `null` under the demo posture
//      (because what the crash SDK puts in `contexts.device` is not knowable from
//      this tree) and I had not attached it to the `unresolved` entry written for
//      exactly that question. A null with no open question behind it is an
//      unanswered form field with no plan to answer it, which is precisely what
//      the limb is for. It failed the build. That is the guard working before it
//      had a single test.
//
//   2. HARNESS BUG THAT LOOKED EXACTLY LIKE A WEAK GUARD. The two most important
//      mutations — adding an identity dart-define to the Play lane, and dropping
//      the crash define — both reported NOT CAUGHT. They anchored on
//      `--dart-define=GLITCHTIP_DSN`, which appears FIVE times in
//      build-platforms.yml (web, linux, apk, appbundle, windows), so `.replace`
//      mutated the WEB step. The guard was right to stay silent: a define on the
//      web build is not the Play artefact. Re-anchored on `--build-number`, which
//      only the appbundle step carries, both were caught immediately.
//      **A no-op or misplaced mutation is a broken test, not a weak guard**, and
//      the difference is invisible unless you go and look.
//
// ⚠️ A FIXTURE AGREES WITH WHATEVER MISUNDERSTANDING WROTE IT. Everything below
// is the REGRESSION NET — it pins the messages and the shapes so a refactor
// cannot quietly drop a limb. The proof that the limbs bite is the mutation run
// against the real repository, summarised above.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-play-declarations.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-playdecl-'));
});
after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

// ── the minimal tree the guard needs, all of it valid ────────────────────────
// Deliberately SMALL: two Play data types, one posture pair, one dependency.
// The real vocabulary has 38 types and modelling all of them here would make
// every test a diff against a copy of the declaration rather than a statement
// about one rule.
const REGISTER = {
  channels: [
    {
      id: 'android-play',
      kind: 'store',
      served: false,
      storeMetadataDir: 'apps/{app}/store/android-play',
    },
  ],
  storeMetadataContract: {
    requiredFiles: ['title.txt'],
    perChannel: { 'android-play': { additionalFiles: ['data-safety.json', 'content-rating.json'] } },
  },
};

const CITE = (url) => ({ url, fetched: '2026-08-04', quote: 'a quoted sentence from the page' });

const DATA_SAFETY = () => ({
  app: 'subly',
  channel: 'android-play',
  sources: {
    allowedHosts: ['support.google.com'],
    vocabulary: CITE('https://support.google.com/googleplay/android-developer/answer/10787469'),
    accuracyRule: CITE('https://support.google.com/googleplay/android-developer/answer/10144311'),
  },
  // THREE types, not two, and the third earns its place. With only Location and
  // Personal info, the test that flips Location to COLLECTED left the fixture
  // with no tell-bearing absence claim at all — so the guard fired
  // `COVERAGE LOST: NOT ONE tell was evaluated` and the test read that as the
  // tell limb misfiring. It was not: on a two-row declaration, zero tells really
  // is total coverage loss. Contacts keeps a tell-bearing absence claim in the
  // set no matter what any single test flips.
  vocabulary: {
    categories: { Location: ['Precise location'], 'Personal info': ['Email address'], Contacts: ['Contacts'] },
    purposes: ['App functionality', 'Account management'],
  },
  buildPosture: {
    lane: '.github/workflows/build-platforms.yml',
    buildCommandContains: 'flutter build appbundle',
    expectedDefines: ['GLITCHTIP_DSN'],
    identityDefines: ['SUPABASE_URL'],
    current: 'demo',
    postures: { demo: 'no identity defines', 'backend-live': 'identity defines supplied' },
  },
  answers: [
    {
      category: 'Location',
      type: 'Precise location',
      collected: { demo: false, 'backend-live': false },
      shared: { demo: false, 'backend-live': false },
      ephemeral: false,
      required: null,
      purposes: [],
      tells: { androidPermissions: ['android.permission.ACCESS_FINE_LOCATION'], dartPackages: ['geolocator'], iosUsageDescriptionKeys: [] },
      evidence: [],
      inventoryRows: [],
      basis: 'no location permission and no location package',
    },
    {
      category: 'Personal info',
      type: 'Email address',
      collected: { demo: false, 'backend-live': true },
      shared: { demo: false, 'backend-live': false },
      ephemeral: false,
      required: true,
      purposes: ['Account management'],
      tells: { androidPermissions: [], dartPackages: [], iosUsageDescriptionKeys: [] },
      evidence: ['apps/subly/lib/login.dart'],
      inventoryRows: ['table:subly_db.subscriptions'],
      basis: 'sent to the identity provider on sign-in',
    },
    {
      category: 'Contacts',
      type: 'Contacts',
      collected: { demo: false, 'backend-live': false },
      shared: { demo: false, 'backend-live': false },
      ephemeral: false,
      required: null,
      purposes: [],
      tells: { androidPermissions: ['android.permission.READ_CONTACTS'], dartPackages: ['flutter_contacts'], iosUsageDescriptionKeys: [] },
      evidence: [],
      inventoryRows: [],
      basis: 'no contacts permission and no contacts package',
    },
  ],
  unresolved: [],
  dataSecurity: {
    encryptedInTransit: { answer: true, basis: 'every endpoint is https', clientRoots: ['apps/subly/lib'] },
    deletionRequestSupported: {
      answer: true,
      webDeletionUrl: 'https://nikatru.com/delete-account.html',
      sitePage: 'sites/nikatru/delete-account.html',
      inAppControl: 'apps/subly/lib/settings.dart',
      guards: [],
      basis: 'in-app control plus a web link',
    },
    playFamiliesPolicy: { answer: false, basis: 'not aimed at children', humanOwned: true },
    independentSecurityReview: { answer: false, basis: 'none commissioned', humanOwned: true },
  },
  inventory: { register: 'tooling/legal/data-inventory.json', notFromThisApp: {} },
  androidPermissions: {
    declaredInRepo: { 'apps/subly/android/app/src/main/AndroidManifest.xml': [] },
    cannotSee: 'the merged manifest is not readable here',
  },
  dependencySurface: {
    manifest: 'apps/subly/pubspec.yaml',
    direct: { flutter: { introduces: [], why: 'the SDK' } },
  },
});

const CONTENT_RATING = () => ({
  app: 'subly',
  channel: 'android-play',
  assignedRating: null,
  status: 'pending-questionnaire-submission',
  statusReason: 'the questionnaire has not been submitted',
  sources: {
    allowedHosts: ['support.google.com'],
    ratingIsAssignedNotChosen: CITE('https://support.google.com/googleplay/android-developer/answer/9859655'),
  },
  questionnaireWording: { status: 'UNVERIFIED', why: 'only rendered inside the Play Console' },
  claims: [
    {
      id: 'not-a-game',
      claim: 'an app, not a game',
      answer: false,
      derivation: 'listing-category',
      categoryFile: 'apps/subly/store/android-play/category.txt',
      categoryValue: 'Productivity',
      gameCategories: ['Games'],
      basis: 'the listing category is Productivity',
    },
    {
      id: 'contains-ads',
      claim: 'no advertising',
      answer: false,
      derivation: 'dependency-tells',
      tells: { dartPackages: ['google_mobile_ads'], androidPermissions: ['com.google.android.gms.permission.AD_ID'] },
      basis: 'no ads SDK and no ad-id permission',
    },
    {
      id: 'shares-personal-info-with-third-parties',
      claim: 'no personal info is shared',
      answer: false,
      derivation: 'cross-check',
      crossCheck: { file: 'data-safety.json', rule: 'no-answer-declares-shared', why: 'asked on both forms' },
      basis: 'every data type declares shared:false',
    },
    {
      id: 'target-audience-children',
      claim: 'not for children',
      answer: false,
      derivation: 'cross-check',
      crossCheck: { file: 'data-safety.json', rule: 'equals-play-families-policy', why: 'asked on both forms' },
      basis: 'not aimed at children',
    },
    {
      id: 'content-descriptors',
      claim: 'no violence, sexual content or profanity',
      answer: false,
      derivation: 'human-owned',
      surfaces: ['apps/subly/store/android-play/category.txt'],
      basis: 'no mechanical tell exists for this; a human re-reads the surfaces',
    },
  ],
  humanOwned: { affirmContentDescriptors: 'a human re-reads the listing copy and screenshots' },
});

const INVENTORY = () => ({
  stores: [
    {
      id: 'table:subly_db.subscriptions',
      kind: 'd1-table',
      name: 'subscriptions',
      personalData: true,
      holds: 'user-entered subscriptions',
      retention: { kind: 'keep', reason: 'the user\'s own data' },
      erasure: { kind: 'purge', route: 'services/subly-api/src/routes/account.ts', reason: 'keyed on user_id' },
      writtenBy: ['services/subly-api/migrations/0001_init.sql'],
    },
  ],
});

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- A COMMENT NAMING android.permission.ACCESS_FINE_LOCATION, which is not a
         permission. Stripping XML comments first is the whole point. -->
    <application android:label="subly"/>
</manifest>
`;

const PUBSPEC = `name: subly
dependencies:
  flutter:
    sdk: flutter
  # commented_out_package: ^1.0.0
dev_dependencies:
  flutter_test:
    sdk: flutter
`;

const WORKFLOW = `name: Build platforms
jobs:
  android:
    runs-on: ubuntu-latest
    steps:
      - name: Build android (aab)
        run: >
          flutter build appbundle --release
          --build-number=1
          --dart-define=GLITCHTIP_DSN=x
  web:
    runs-on: ubuntu-latest
    steps:
      - name: Build web
        run: >
          flutter build web --release
          --dart-define=GLITCHTIP_DSN=x
`;

function writeFile(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
}

/** A complete, PASSING tree. `patch` mutates the parsed objects in place. */
function makeRoot(patch = {}) {
  const root = join(TMP, `r${seq++}`);
  const register = structuredClone(REGISTER);
  const ds = DATA_SAFETY();
  const cr = CONTENT_RATING();
  const inv = INVENTORY();
  const files = {
    'apps/subly/android/app/src/main/AndroidManifest.xml': MANIFEST,
    'apps/subly/pubspec.yaml': PUBSPEC,
    '.github/workflows/build-platforms.yml': WORKFLOW,
    'apps/subly/store/android-play/category.txt': 'Productivity\n',
    'apps/subly/store/android-play/title.txt': 'Subly\n',
    'apps/subly/lib/login.dart': "const url = 'https://example.test';\n",
    'apps/subly/lib/settings.dart': '// the delete-account control\n',
    'sites/nikatru/delete-account.html': '<html><body>delete</body></html>\n',
    'services/subly-api/src/routes/account.ts': '// DELETE /v1/account\n',
  };

  if (patch.register) patch.register(register);
  if (patch.ds) patch.ds(ds);
  if (patch.cr) patch.cr(cr);
  if (patch.inv) patch.inv(inv);
  if (patch.files) patch.files(files);

  writeFile(root, 'tooling/channel-register.json', register);
  writeFile(root, 'tooling/legal/data-inventory.json', inv);
  writeFile(root, 'apps/subly/store/android-play/data-safety.json', ds);
  writeFile(root, 'apps/subly/store/android-play/content-rating.json', cr);
  for (const [rel, body] of Object.entries(files)) {
    if (body !== null) writeFile(root, rel, body);
  }
  return root;
}

const findAnswer = (ds, type) => ds.answers.find((a) => a.type === type);
const findClaim = (cr, id) => cr.claims.find((c) => c.id === id);

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-play-declarations — the happy path really passes', () => {
  test('a complete, consistent pair of declarations passes', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /assert-play-declarations: ok/);
  });

  test('it names the posture it derived, so a reader knows which column to submit', () => {
    const r = run(makeRoot());
    assert.match(out(r), /lane posture "demo" confirmed against \.github\/workflows\/build-platforms\.yml/);
    assert.match(out(r), /defines: GLITCHTIP_DSN/);
  });

  test('an XML COMMENT naming a permission is not a permission', () => {
    // The fixture manifest mentions ACCESS_FINE_LOCATION inside <!-- -->.
    // A grep would fail the Location answer; a parse must not.
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
  });

  test('a COMMENTED-OUT dependency is not a dependency', () => {
    // PUBSPEC carries `# commented_out_package:`. If the `#` strip regressed,
    // the dependency equality would demand an entry for it.
    const r = run(makeRoot());
    assert.doesNotMatch(out(r), /commented_out_package/);
  });

  test('it prints what it CANNOT see, so green is not read as "the form is right"', () => {
    const r = run(makeRoot());
    assert.match(out(r), /what this guard CANNOT see/);
    assert.match(out(r), /MERGED Android manifest/);
    assert.match(out(r), /TRANSITIVE Dart dependencies/);
    assert.match(out(r), /the IARC rating — assigned by the rating authorities/);
  });
});

describe('assert-play-declarations — COVERAGE LOST rather than a quiet pass', () => {
  test('the declaration file being gone is COVERAGE LOST, not a pass', () => {
    const root = makeRoot();
    rmSync(join(root, 'apps/subly/store/android-play/data-safety.json'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('dropping the file from the register contract is COVERAGE LOST — two guards, one relationship', () => {
    const r = run(makeRoot({ register: (x) => { x.storeMetadataContract.perChannel['android-play'].additionalFiles = ['content-rating.json']; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /additionalFiles does not list "data-safety\.json"/);
  });

  test('an empty vocabulary is COVERAGE LOST — otherwise zero answers would pass', () => {
    const r = run(makeRoot({ ds: (x) => { x.vocabulary.categories = {}; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /vocabulary\.categories/);
  });

  test('no answers at all is COVERAGE LOST', () => {
    const r = run(makeRoot({ ds: (x) => { x.answers = []; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('a build command that no longer matches the lane is COVERAGE LOST, not a silent skip', () => {
    const r = run(makeRoot({ ds: (x) => { x.buildPosture.buildCommandContains = 'flutter build aab-v2'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /flutter build aab-v2/);
  });

  test('an inventory with no personal-data row is COVERAGE LOST', () => {
    const r = run(makeRoot({ inv: (x) => { x.stores[0].personalData = false; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /personalData/);
  });

  test('every tell disappearing is COVERAGE LOST — the limb that makes this checkable', () => {
    const r = run(makeRoot({ ds: (x) => { for (const a of x.answers) a.tells = { androidPermissions: [], dartPackages: [], iosUsageDescriptionKeys: [] }; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NOT ONE tell was evaluated/);
  });
});

describe('assert-play-declarations — the posture limb', () => {
  test('FAILS when the Play lane gains an identity dart-define', () => {
    const r = run(makeRoot({
      files: (f) => { f['.github/workflows/build-platforms.yml'] = WORKFLOW.replace('--build-number=1', '--build-number=1\n          --dart-define=SUPABASE_URL=x'); },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /now passes --dart-define=SUPABASE_URL to the Play artefact/);
    assert.match(out(r), /understates what the shipped bundle collects/);
  });

  test('FAILS when the Play lane drops a declared define — overstating is inaccurate too', () => {
    const r = run(makeRoot({
      files: (f) => { f['.github/workflows/build-platforms.yml'] = WORKFLOW.replace('\n          --dart-define=GLITCHTIP_DSN=x\n  web:', '\n  web:'); },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /expectedDefines lists GLITCHTIP_DSN/);
  });

  test('a define on ANOTHER platform lane is NOT the Play artefact and must not fire', () => {
    // The false-positive direction, and the one that cost a real debugging
    // session: build-platforms.yml passes GLITCHTIP_DSN on five steps.
    const r = run(makeRoot({
      files: (f) => { f['.github/workflows/build-platforms.yml'] = WORKFLOW.replace('flutter build web --release', 'flutter build web --release\n          --dart-define=SUPABASE_URL=x'); },
    }));
    assert.equal(r.status, 0, out(r));
  });

  test('FAILS when `current` is not one of the declared postures', () => {
    const r = run(makeRoot({ ds: (x) => { x.buildPosture.current = 'staging'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /buildPosture\.current is "staging"/);
  });
});

describe('assert-play-declarations — the code tells', () => {
  test('FAILS when a permission contradicts a "never collected" answer', () => {
    const r = run(makeRoot({
      files: (f) => { f['apps/subly/android/app/src/main/AndroidManifest.xml'] = MANIFEST.replace('<application', '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>\n    <application'); },
      ds: (x) => { x.androidPermissions.declaredInRepo['apps/subly/android/app/src/main/AndroidManifest.xml'] = ['android.permission.ACCESS_FINE_LOCATION']; },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NEVER collected, and android\.permission\.ACCESS_FINE_LOCATION/);
  });

  test('the tell fires INDEPENDENTLY of the permission-equality limb', () => {
    // Declaring the new permission satisfies the equality check. The answer is
    // still false. One limb must not be able to silence the other.
    const r = run(makeRoot({
      files: (f) => { f['apps/subly/android/app/src/main/AndroidManifest.xml'] = MANIFEST.replace('<application', '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>\n    <application'); },
      ds: (x) => { x.androidPermissions.declaredInRepo['apps/subly/android/app/src/main/AndroidManifest.xml'] = ['android.permission.ACCESS_FINE_LOCATION']; },
    }));
    assert.doesNotMatch(out(r), /A permission is the loudest single tell/);
    assert.match(out(r), /NEVER collected, and android\.permission\.ACCESS_FINE_LOCATION/);
  });

  test('FAILS when a package contradicts a "never collected" answer', () => {
    const r = run(makeRoot({
      files: (f) => { f['apps/subly/pubspec.yaml'] = PUBSPEC.replace('dependencies:\n', 'dependencies:\n  geolocator: ^13.0.0\n'); },
      ds: (x) => { x.dependencySurface.direct.geolocator = { introduces: [], why: 'added' }; },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /`geolocator` is now a direct dependency/);
  });

  test('FAILS when an iOS usage-description key contradicts a "never collected" answer', () => {
    const r = run(makeRoot({
      files: (f) => { f['apps/subly/ios/Runner/Info.plist'] = '<plist><dict><key>NSLocationWhenInUseUsageDescription</key><string>why</string></dict></plist>\n'; },
      ds: (x) => { findAnswer(x, 'Precise location').tells.iosUsageDescriptionKeys = ['NSLocationWhenInUseUsageDescription']; },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NSLocationWhenInUseUsageDescription now appears in an Info\.plist/);
  });

  test('a tell on a COLLECTED type does not fire — the limb is about claims of absence', () => {
    const r = run(makeRoot({
      ds: (x) => { findAnswer(x, 'Precise location').collected['backend-live'] = true; findAnswer(x, 'Precise location').required = true; findAnswer(x, 'Precise location').purposes = ['App functionality']; findAnswer(x, 'Precise location').evidence = ['apps/subly/lib/login.dart']; },
      files: (f) => { f['apps/subly/android/app/src/main/AndroidManifest.xml'] = MANIFEST.replace('<application', '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>\n    <application'); },
    }));
    // It fails on the permission EQUALITY (undeclared permission), not on the tell.
    assert.match(out(r), /A permission is the loudest single tell/);
    assert.doesNotMatch(out(r), /NEVER collected, and android\.permission\.ACCESS_FINE_LOCATION/);
  });
});

describe('assert-play-declarations — equality on permissions and dependencies', () => {
  test('FAILS when a manifest gains an undeclared permission', () => {
    const r = run(makeRoot({
      files: (f) => { f['apps/subly/android/app/src/main/AndroidManifest.xml'] = MANIFEST.replace('<application', '<uses-permission android:name="android.permission.VIBRATE"/>\n    <application'); },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /A permission is the loudest single tell/);
  });

  test('FAILS when the declaration names a manifest that is gone', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.declaredInRepo['apps/subly/android/app/src/nope/AndroidManifest.xml'] = []; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /describing a manifest that is gone/);
  });

  test('FAILS when a new dependency arrives with nobody saying what it collects', () => {
    const r = run(makeRoot({ files: (f) => { f['apps/subly/pubspec.yaml'] = PUBSPEC.replace('dependencies:\n', 'dependencies:\n  some_new_sdk: ^1.0.0\n'); } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /A new dependency arrived and nobody said what data it can collect/);
  });

  test('FAILS when the dependency map outlives the dependency', () => {
    const r = run(makeRoot({ ds: (x) => { x.dependencySurface.direct.removed_pkg = { introduces: [], why: 'gone' }; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /no longer depends on it/);
  });

  test('FAILS when the dependency map and the answer contradict each other', () => {
    const r = run(makeRoot({ ds: (x) => { x.dependencySurface.direct.flutter.introduces = ['Precise location']; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares it NEVER collected in any posture/);
  });

  test('FAILS when the "cannot see" caveat is emptied', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.cannotSee = ''; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `cannotSee`/);
  });
});

describe('assert-play-declarations — the inventory relation, both directions', () => {
  test('FAILS when a personal-data store is neither mapped nor excluded', () => {
    const r = run(makeRoot({
      inv: (x) => { x.stores.push({ id: 'table:subly_db.diary', kind: 'd1-table', name: 'diary', personalData: true, holds: 'x', retention: { kind: 'keep', reason: 'x' }, erasure: { kind: 'purge', route: 'services/subly-api/src/routes/account.ts', reason: 'x' }, writtenBy: [] }); },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /neither maps it to a Play data type nor excludes it/);
  });

  test('FAILS when an exclusion outlives the store it excluded', () => {
    const r = run(makeRoot({ ds: (x) => { x.inventory.notFromThisApp['table:gone.table'] = 'a reason'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has no such row/);
  });

  test('FAILS when a row is BOTH mapped and excluded', () => {
    const r = run(makeRoot({ ds: (x) => { x.inventory.notFromThisApp['table:subly_db.subscriptions'] = 'a reason'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /both MAPS .* and lists it in inventory\.notFromThisApp/);
  });

  test('FAILS when an exclusion carries no reason', () => {
    const r = run(makeRoot({
      inv: (x) => { x.stores.push({ id: 'table:x.y', kind: 'd1-table', name: 'y', personalData: true, holds: 'x', retention: { kind: 'keep', reason: 'x' }, writtenBy: [] }); },
      ds: (x) => { x.inventory.notFromThisApp['table:x.y'] = '   '; },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no reason/);
  });

  test('FAILS when an answer maps to an inventory row that does not exist', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').inventoryRows = ['table:nope.nope']; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which does not exist in/);
  });
});

describe('assert-play-declarations — answer shape and the honest null', () => {
  test('FAILS when a Play data type has no answer row', () => {
    const r = run(makeRoot({ ds: (x) => { x.answers = x.answers.filter((a) => a.type !== 'Precise location'); } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has NO answer for "Location\|Precise location"/);
  });

  test('FAILS when an answer names a type Play does not have', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Precise location').type = 'Extremely precise location'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which is not a type in `vocabulary\.categories`/);
  });

  test('FAILS when an answer is missing a posture', () => {
    const r = run(makeRoot({ ds: (x) => { delete findAnswer(x, 'Email address').collected['backend-live']; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has no entry for posture "backend-live"/);
  });

  test('FAILS when a null answer has no open question behind it', () => {
    // The exact defect this guard caught in its own declaration on first run.
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').collected.demo = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names no entry in the declaration's own `unresolved` list/);
  });

  test('a null WITH an open question passes, and PRINTS that the form cannot be submitted', () => {
    const r = run(makeRoot({
      ds: (x) => {
        findAnswer(x, 'Email address').collected.demo = null;
        findAnswer(x, 'Email address').unresolved = 'q1';
        x.unresolved = [{ id: 'q1', affects: ['Email address'], ownerItem: 'O-3', question: 'is it?', howToResolve: 'observe it', status: 'UNVERIFIED' }];
      },
    }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /THE FORM CANNOT BE SUBMITTED YET/);
    assert.match(out(r), /is UNANSWERED \(q1\)/);
  });

  test('FAILS when an open question is referenced by no answer', () => {
    const r = run(makeRoot({ ds: (x) => { x.unresolved = [{ id: 'orphan', affects: ['Email address'], ownerItem: 'O-3', question: 'q', howToResolve: 'h', status: 's' }]; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is referenced by NO answer/);
  });

  test('FAILS when an open question names nobody to own it', () => {
    const r = run(makeRoot({
      ds: (x) => {
        findAnswer(x, 'Email address').collected.demo = null;
        findAnswer(x, 'Email address').unresolved = 'q1';
        x.unresolved = [{ id: 'q1', affects: ['Email address'], question: 'is it?', howToResolve: 'observe it', status: 'UNVERIFIED' }];
      },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has no `ownerItem`/);
  });

  test('FAILS when a collected type declares no purpose', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').purposes = []; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is collected and declares no `purposes`/);
  });

  test('FAILS when a purpose is not one Play offers', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').purposes = ['Vibes']; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which is not one of the purposes Play offers/);
  });

  test('FAILS when a collected type does not say required-or-optional', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').required = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /Play asks required-or-optional for every collected type/);
  });

  test('FAILS when a collected type points at evidence that is gone', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').evidence = ['apps/subly/lib/moved.dart']; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names evidence apps\/subly\/lib\/moved\.dart, which does not exist/);
  });

  test('PRINTS, rather than failing, when an absence claim has no mechanical tell', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Precise location').tells = { androidPermissions: [], dartPackages: [], iosUsageDescriptionKeys: ['NSLocationWhenInUseUsageDescription'] }; } }));
    assert.equal(r.status, 0, out(r));
  });
});

describe('assert-play-declarations — citations', () => {
  test('FAILS when a citation has no fetch date', () => {
    const r = run(makeRoot({ ds: (x) => { delete x.sources.vocabulary.fetched; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /sources\.vocabulary has no `fetched`/);
  });

  test('FAILS when a citation is sourced to a host that neither wrote nor enforces the rule', () => {
    const r = run(makeRoot({ ds: (x) => { x.sources.vocabulary.url = 'https://compliance-blog.example.com/play'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which is not in sources\.allowedHosts/);
  });

  test('FAILS when the allowed-host list is emptied, so any host would pass', () => {
    const r = run(makeRoot({ ds: (x) => { x.sources.allowedHosts = []; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /allowedHosts is missing or empty/);
  });

  test('FAILS when a fetch date is not an ISO date', () => {
    const r = run(makeRoot({ ds: (x) => { x.sources.vocabulary.fetched = 'August 2026'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not an ISO date/);
  });
});

describe('assert-play-declarations — data security', () => {
  test('FAILS when a plaintext endpoint appears in shipped client code', () => {
    const r = run(makeRoot({ files: (f) => { f['apps/subly/lib/login.dart'] = "const url = 'http://example.test';\n"; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /contains a `http:\/\/` URL in shipped client code/);
  });

  test('a `http://` inside a COMMENT is not an endpoint', () => {
    const r = run(makeRoot({ files: (f) => { f['apps/subly/lib/login.dart'] = "// once was http://example.test\nconst url = 'https://example.test';\n"; } }));
    assert.equal(r.status, 0, out(r));
  });

  test('FAILS when the web deletion page named on the form does not exist', () => {
    const r = run(makeRoot({ files: (f) => { f['sites/nikatru/delete-account.html'] = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /and it does not exist/);
  });

  test('FAILS when the erasure route derived from the inventory is gone', () => {
    const r = run(makeRoot({ files: (f) => { f['services/subly-api/src/routes/account.ts'] = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /the route answering it is gone/);
  });

  test('FAILS when the web deletion URL is not an absolute https URL', () => {
    const r = run(makeRoot({ ds: (x) => { x.dataSecurity.deletionRequestSupported.webDeletionUrl = '/delete-account.html'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not a single absolute https URL/);
  });

  test('FAILS when deletion is claimed and no mapped row names a route', () => {
    const r = run(makeRoot({ inv: (x) => { delete x.stores[0].erasure; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NOT ONE mapped inventory row names an erasure route/);
  });

  test('the two optional badges PRINT their human owner rather than looking derived', () => {
    const r = run(makeRoot());
    assert.match(out(r), /HUMAN-OWNED — dataSecurity\.playFamiliesPolicy = false/);
    assert.match(out(r), /HUMAN-OWNED — dataSecurity\.independentSecurityReview = false/);
  });
});

describe('assert-play-declarations — the content rating record', () => {
  test('FAILS when a rating is written down without the certificate that issued it', () => {
    const r = run(makeRoot({ cr: (x) => { x.assignedRating = 'PEGI 3'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /a guess wearing the costume of a result/);
  });

  test('a rating WITH an IARC certificate and a source is accepted', () => {
    const r = run(makeRoot({
      cr: (x) => {
        x.assignedRating = 'PEGI 3';
        x.iarcCertificate = { id: '00000000-0000-0000-0000-000000000000', source: CITE('https://support.google.com/googleplay/android-developer/answer/9859655') };
      },
    }));
    assert.equal(r.status, 0, out(r));
  });

  test('FAILS when there is no rating and the status does not say so', () => {
    const r = run(makeRoot({ cr: (x) => { x.status = 'done'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /the status must say so/);
  });

  test('FAILS when the listing category and the questionnaire answer disagree', () => {
    const r = run(makeRoot({ files: (f) => { f['apps/subly/store/android-play/category.txt'] = 'Games\n'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /the misrepresentation Google removes apps for/);
  });

  test('FAILS when an ads SDK contradicts the no-ads answer', () => {
    const r = run(makeRoot({
      files: (f) => { f['apps/subly/pubspec.yaml'] = PUBSPEC.replace('dependencies:\n', 'dependencies:\n  google_mobile_ads: ^5.0.0\n'); },
      ds: (x) => { x.dependencySurface.direct.google_mobile_ads = { introduces: [], why: 'added' }; },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /claim "contains-ads" answers false and `google_mobile_ads` is a direct dependency/);
  });

  test('FAILS when the ad-ID permission contradicts the no-ads answer', () => {
    const r = run(makeRoot({
      files: (f) => { f['apps/subly/android/app/src/main/AndroidManifest.xml'] = MANIFEST.replace('<application', '<uses-permission android:name="com.google.android.gms.permission.AD_ID"/>\n    <application'); },
      ds: (x) => { x.androidPermissions.declaredInRepo['apps/subly/android/app/src/main/AndroidManifest.xml'] = ['com.google.android.gms.permission.AD_ID']; },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /claim "contains-ads" answers false and com\.google\.android\.gms\.permission\.AD_ID is declared/);
  });

  test('FAILS when a "dependency-tells" claim declares no tells — an assertion that cannot fail', () => {
    const r = run(makeRoot({ cr: (x) => { findClaim(x, 'contains-ads').tells = { dartPackages: [], androidPermissions: [] }; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /An assertion that cannot fail is worse than none/);
  });

  test('FAILS when a claim declares an unknown derivation', () => {
    const r = run(makeRoot({ cr: (x) => { findClaim(x, 'contains-ads').derivation = 'obviously-true'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /there is no third category/);
  });

  test('FAILS when a cross-check names a rule this guard does not implement', () => {
    const r = run(makeRoot({ cr: (x) => { findClaim(x, 'target-audience-children').crossCheck.rule = 'vibes'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /the claim reads as checked and is not/);
  });

  test('FAILS when a human-owned claim names no surfaces to re-read', () => {
    const r = run(makeRoot({ cr: (x) => { findClaim(x, 'content-descriptors').surfaces = []; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /"Somebody checked" with no scope is not a check/);
  });

  test('a human-owned claim PRINTS its surfaces rather than looking derived', () => {
    const r = run(makeRoot());
    assert.match(out(r), /HUMAN-OWNED — content rating "content-descriptors"/);
  });
});

describe('assert-play-declarations — the two forms cannot contradict each other', () => {
  test('FAILS when Data safety declares sharing and the rating form denies it', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').shared['backend-live'] = true; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /they now give Google two different answers/);
  });

  test('FAILS when the Families-Policy badge is flipped on one form only', () => {
    const r = run(makeRoot({ ds: (x) => { x.dataSecurity.playFamiliesPolicy.answer = true; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /playFamiliesPolicy\.answer is true/);
  });

  test('the sharing cross-check agrees when BOTH forms say sharing happens', () => {
    const r = run(makeRoot({
      ds: (x) => { findAnswer(x, 'Email address').shared['backend-live'] = true; },
      cr: (x) => { findClaim(x, 'shares-personal-info-with-third-parties').answer = true; },
    }));
    assert.equal(r.status, 0, out(r));
  });
});
