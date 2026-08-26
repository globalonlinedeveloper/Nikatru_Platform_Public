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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
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
      // COLLECTED, so its `tells` would be unreachable — this is the row that
      // carries the always-asserted form instead. See clientAbsenceRequiredFor.
      clientAbsence: {
        claim: 'the address is typed by the user; the account list is never read',
        androidPermissions: ['android.permission.GET_ACCOUNTS'],
        dartPackages: [],
        iosUsageDescriptionKeys: [],
      },
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
  resolved: [],
  clientAbsenceRequiredFor: { types: ['Personal info|Email address'] },
  crashSdkSurface: {
    lockfile: 'pubspec.lock',
    pinned: { sentry_flutter: '9.26.0' },
    finding: 'the crash SDK attaches a persistent per-install id',
    cannotSee: 'what the receiving server does with the event',
  },
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
    // THE MEASURED UNION. Deliberately three rows and not four: one per GRADE the
    // block actually uses (`read`, `inferred`, and the row that admits it has no
    // attribution at all), because every obligation limb 7a enforces hangs off
    // the grade. A fourth `read` row would add a copy, not a case.
    merged: {
      measuredFrom: {
        runId: '1',
        runName: 'Build all 6 platforms — run #1',
        commit: '0000000000000000000000000000000000000000',
        artifact: 'subly-android-release-signed',
        file: 'app/outputs/bundle/release/app-release.aab',
        entry: 'base/manifest/AndroidManifest.xml',
        method: 'decoded from the aapt2 XmlNode protobuf, cross-checked with `aapt2 dump permissions`',
        measuredOn: '2026-08-26',
      },
      releaseManifest: 'apps/subly/android/app/src/main/AndroidManifest.xml',
      lockfile: 'pubspec.lock',
      permissions: [
        {
          name: 'android.permission.VIBRATE',
          attributedTo: 'flutter_local_notifications',
          attribution: 'direct',
          evidenceGrade: 'read',
          evidence: "the package's own plugin AndroidManifest.xml declares it",
          collectionSignal: false,
          why: 'a hardware effect with no read side',
        },
        {
          name: 'android.permission.INTERNET',
          attributedTo: null,
          attribution: 'unattributed',
          evidenceGrade: null,
          evidence: null,
          collectionSignal: false,
          why: 'a transport, not a collector',
        },
        {
          name: 'com.example.subly.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
          attributedTo: 'androidx.core',
          attribution: 'transitive',
          evidenceGrade: 'inferred',
          evidence: 'the merged manifest carries androidx.core\'s own appComponentFactory',
          residual: 'the AAR manifest itself was not read — no gradle cache on the measuring host',
          collectionSignal: false,
          why: 'signature-level, so nothing outside the app can hold it',
        },
      ],
      unattributed: {
        'android.permission.INTERNET': 'nothing here says which library declares it, and naming one would be a guess',
      },
      expectedButAbsent: {
        'android.permission.ACCESS_NETWORK_STATE': 'predicted by the reasoning this block replaced, and measurably not there',
      },
      pinned: { flutter_local_notifications: '17.2.4' },
    },
    cannotSee: 'which library contributed which merged permission is not readable here',
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

// The RESOLVED versions, which is what the crash-SDK pin is compared against —
// not the pubspec range, because `^9.26.0` is satisfied by 9.99.0 and that is not
// the source anybody read.
const LOCK = `# Generated by pub
packages:
  flutter:
    dependency: "direct main"
    description: flutter
    source: sdk
    version: "0.0.0"
  flutter_local_notifications:
    dependency: transitive
    description:
      name: flutter_local_notifications
      url: "https://pub.dev"
    source: hosted
    version: "17.2.4"
  sentry_flutter:
    dependency: transitive
    description:
      name: sentry_flutter
      url: "https://pub.dev"
    source: hosted
    version: "9.26.0"
sdks:
  dart: ">=3.5.0 <4.0.0"
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

// The Runner Info.plists, carrying real keys and NOT ONE NS…UsageDescription —
// which is exactly the real tree's state. They are REQUIRED_COVERAGE for the iOS
// usage-key haystack: that haystack is legitimately empty, so its floor is on
// whether the files were found and parsed, never on how many keys they held.
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>subly</string>
	<key>CFBundleVersion</key>
	<string>1</string>
</dict>
</plist>
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
    'apps/subly/ios/Runner/Info.plist': PLIST,
    'apps/subly/macos/Runner/Info.plist': PLIST,
    'apps/subly/pubspec.yaml': PUBSPEC,
    'pubspec.lock': LOCK,
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
    // 🔴 THIS LINE USED TO ASSERT THAT THE GUARD SAID THE MERGED MANIFEST HAD
    // NEVER BEEN READ. It has been read (2026-08-26, off a signed .aab) and limb
    // 7a now asserts that reading, so the printed caveat NARROWED rather than
    // disappeared — what is unseen is which library contributed which
    // permission, not the set itself. A caveat that outlives the gap it
    // describes is the same defect as a claim with no check behind it.
    assert.match(out(r), /WHO CONTRIBUTED EACH MERGED PERMISSION/);
    assert.match(out(r), /merged\.unattributed/);
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

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE HAYSTACK THAT IS LEGITIMATELY EMPTY.
//
// On the real tree the iOS usage-key set has ZERO members and that is TRUE — no
// native Apple capability is used and neither Apple store has been shipped to.
// Meanwhile 18 declared tell entries (17 distinct keys) compare against it, so
// all 18 are constant-false, inside a summary line that reads `0 iOS usage
// key(s)` whether the instrument is working or not.
//
// So the floor CANNOT be `usageKeys.size > 0` — that is a red no code change can
// clear, i.e. an alarm that gets muted rather than fixed. It is on the
// INSTRUMENT: were the plists located, and does the same reduction the key scan
// uses still yield plist structure from them? The last test in this block is the
// guard-on-the-guard: a true zero must still PASS.
//
// MUTATION-PROVEN AGAINST THE REAL TREE, not only these fixtures — 3/3 caught,
// baseline exit 0 before and after, files byte-restored:
//   · apps/subly/ios/Runner/Info.plist renamed away    → REQUIRED_COVERAGE fires
//   · all 3 Info.plists under ios/+macos/ renamed away → "found NO Info.plist"
//   · the ios plist body wrapped in <!-- -->           → "ZERO <key> … stripInert"
// The third mutation FIRST reported NOT CAUGHT and the harness was wrong, not the
// guard: the plist has four nested <dict>s and anchoring on the FIRST </dict>
// commented out an inner block, leaving 20+ keys readable. A no-op mutation is a
// broken test, not a weak guard — and it is invisible until you go and look.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-play-declarations — the iOS usage-key haystack, floored on the instrument', () => {
  test('ZERO usage keys PASSES — the floor is not on how many keys the files held', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /COVERAGE LOST/);
    assert.match(out(r), /0 iOS usage key\(s\)/);
  });

  test('the zero is PRINTED, loudly, with the number of tells it silences', () => {
    // Self-declaring emptiness. Without this the only trace is `0 iOS usage
    // key(s)` in an ok line, which reads the same when the walk is broken.
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Precise location').tells.iosUsageDescriptionKeys = ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription']; } }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /iOS USAGE-KEY HAYSTACK IS EMPTY, AND THAT IS CURRENTLY TRUE/);
    assert.match(out(r), /2 Info\.plist file\(s\) located/);
    assert.match(out(r), /all 2 declared iOS-usage-key tell\(s\) are constant-false today/);
  });

  test('the required iOS Runner Info.plist going missing is COVERAGE LOST, not "no keys"', () => {
    const r = run(makeRoot({ files: (f) => { f['apps/subly/ios/Runner/Info.plist'] = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /apps\/subly\/ios\/Runner\/Info\.plist is REQUIRED_COVERAGE for the iOS usage-key haystack/);
    assert.doesNotMatch(out(r), /assert-play-declarations: ok/);
  });

  test('the required macOS Runner Info.plist going missing is COVERAGE LOST too', () => {
    const r = run(makeRoot({ files: (f) => { f['apps/subly/macos/Runner/Info.plist'] = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /apps\/subly\/macos\/Runner\/Info\.plist is REQUIRED_COVERAGE/);
  });

  test('the walk reaching NO Info.plist at all is COVERAGE LOST — the walk() regression', () => {
    const r = run(makeRoot({ files: (f) => { f['apps/subly/ios/Runner/Info.plist'] = null; f['apps/subly/macos/Runner/Info.plist'] = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /found NO Info\.plist at all/);
    assert.match(out(r), /An absence that is indistinguishable from a broken reading is/);
  });

  test('a plist the REDUCTION eats is COVERAGE LOST — a blank page is not a clean bill of health', () => {
    // stripInert() removes comments before the key scan. A plist whose body is
    // inside <!-- --> is found, is parsed, and yields nothing — the exact shape
    // of "the instrument stopped working" that a file-count check would miss.
    const r = run(makeRoot({ files: (f) => { f['apps/subly/ios/Runner/Info.plist'] = '<plist><dict><!--<key>CFBundleName</key><string>subly</string>--></dict></plist>\n'; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /apps\/subly\/ios\/Runner\/Info\.plist was found but yielded ZERO <key> elements after stripInert\(\)/);
  });

  test('a plist with keys but no NS…UsageDescription is NOT a failure — the zero is honest', () => {
    // The guard-on-the-guard. If this ever goes red, the floor has migrated from
    // the instrument onto the result and become an unclearable daily red.
    const r = run(makeRoot({ files: (f) => { f['apps/subly/ios/Runner/Info.plist'] = '<plist><dict><key>CFBundleIdentifier</key><string>tru.nika.subly</string></dict></plist>\n'; } }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /assert-play-declarations: ok/);
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

// ─────────────────────────────────────────────────────────────────────────────
// 🔬 REAL-TREE MUTATION RUN FOR THE LIMBS BELOW — 2026-08-04, 8/8 CAUGHT, plus
// one CONTROL that had to keep passing (a resolved entry whose answer is filled
// in). Baseline passed before and after; every file restored from an in-memory
// original and byte-compared; `git status` clean at the end. The mutations were
// applied to apps/subly/pubspec.yaml, the real release AndroidManifest.xml, the
// real pubspec.lock and the real data-safety.json — NOT to these fixtures.
//
// WHY THESE LIMBS EXIST AT ALL. The `tells` limb only evaluates a row answering
// "never collected in EVERY posture". A row answering `true` — or `null` — keeps
// its tell list in the file where everyone reads it as coverage, while nothing
// evaluates it. Settling Approximate location as collected (the edge infers a
// coarse geo from the connection) made that measurable: 24 tells across four
// rows were unreachable, including EVERY location tell in the declaration.
// `clientAbsence` is the half of the claim that survives collection —
// "collected, but never from the DEVICE" — and it is evaluated unconditionally.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-play-declarations — clientAbsence: the claim that survives collection', () => {
  test('a collected row with a clientAbsence block passes, and the count is printed', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /client-absence tell\(s\) evaluated/);
  });

  test('FAILS when a clientAbsence permission appears — even though the row IS collected', () => {
    const r = run(makeRoot({
      files: (f) => {
        f['apps/subly/android/app/src/main/AndroidManifest.xml'] =
          '<manifest><uses-permission android:name="android.permission.GET_ACCOUNTS"/><application/></manifest>\n';
      },
      ds: (x) => {
        x.androidPermissions.declaredInRepo['apps/subly/android/app/src/main/AndroidManifest.xml'] = ['android.permission.GET_ACCOUNTS'];
      },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /clientAbsence and android\.permission\.GET_ACCOUNTS is now declared/);
    assert.match(out(r), /The device can now supply this type DIRECTLY/);
  });

  test('FAILS when a clientAbsence dart package becomes a direct dependency', () => {
    const r = run(makeRoot({
      ds: (x) => {
        findAnswer(x, 'Email address').clientAbsence.dartPackages = ['google_sign_in'];
        x.dependencySurface.direct.google_sign_in = { introduces: ['Email address'], why: 'identity' };
      },
      files: (f) => {
        f['apps/subly/pubspec.yaml'] = PUBSPEC.replace('dev_dependencies:', '  google_sign_in: ^6.0.0\ndev_dependencies:');
      },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /clientAbsence and `google_sign_in` is now a direct dependency/);
  });

  test('COVERAGE LOST when a clientAbsence block is kept but emptied of every tell', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').clientAbsence.androidPermissions = []; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /declares `clientAbsence` with ZERO tells in it/);
  });

  test('FAILS when a clientAbsence block states no claim — tells with nothing to be a claim ABOUT', () => {
    const r = run(makeRoot({ ds: (x) => { delete findAnswer(x, 'Email address').clientAbsence.claim; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares `clientAbsence` with no `claim`/);
  });

  test('REQUIRED_COVERAGE: FAILS when a named row loses its clientAbsence block entirely', () => {
    const r = run(makeRoot({ ds: (x) => { delete findAnswer(x, 'Email address').clientAbsence; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is required to carry a `clientAbsence` block and does not/);
  });

  test('COVERAGE LOST when the REQUIRED_COVERAGE list itself is emptied', () => {
    const r = run(makeRoot({ ds: (x) => { x.clientAbsenceRequiredFor.types = []; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /clientAbsenceRequiredFor\.types is missing or empty/);
  });

  test('FAILS when the REQUIRED_COVERAGE list names a type that has no answer row', () => {
    const r = run(makeRoot({ ds: (x) => { x.clientAbsenceRequiredFor.types = ['Personal info|Nickname']; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /there is no answer with that "Category\|Type"/);
  });

  // 🔬 THE GENERAL HALF, needing no list: a `tells` block on a collected row can
  // never be reached, so it is an assertion that cannot fire — which this
  // repository treats as worse than none, because it is read as coverage.
  test('FAILS when a tells block is left on a row that IS collected — unreachable by construction', () => {
    const r = run(makeRoot({ ds: (x) => { findAnswer(x, 'Email address').tells = { dartPackages: ['firebase_analytics'] }; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /every tell in that block is UNREACHABLE/);
  });
});

describe('assert-play-declarations — the crash-SDK version pin', () => {
  test('FAILS when the lockfile moves off the version whose source was read', () => {
    const r = run(makeRoot({ files: (f) => { f['pubspec.lock'] = LOCK.replace('9.26.0', '9.27.0'); } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /resolves `sentry_flutter` to 9\.27\.0/);
    assert.match(out(r), /A different version is a different program/);
  });

  test('FAILS when the pinned package is not in the dependency graph at all', () => {
    const r = run(makeRoot({
      files: (f) => { f['pubspec.lock'] = LOCK.replace(/ {2}sentry_flutter:\n(?: {4}.*\n| {6}.*\n)*/, ''); },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /resolves no such package/);
  });

  test('COVERAGE LOST when the pin list is emptied', () => {
    const r = run(makeRoot({ ds: (x) => { x.crashSdkSurface.pinned = {}; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /crashSdkSurface\.pinned is missing or empty/);
  });

  test('COVERAGE LOST when the lockfile is gone', () => {
    const r = run(makeRoot({ files: (f) => { f['pubspec.lock'] = null; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    // ⚠️ THIS ASSERTED crashSdkSurface's MESSAGE UNTIL LIMB 7a WAS WRITTEN.
    // Both limbs pin against the same lock and both COVERAGE LOST when it is
    // gone; 7a simply reaches it first, and coverageLost() exits on the spot.
    // The assertion moved rather than being loosened to match either — a check
    // that accepts whichever message happens to arrive stops being able to say
    // WHICH limb noticed. 7b's own missing-lock branch is unreachable while 7a
    // guards the same file, and that is stated here rather than left as a
    // silently dead line in the guard.
    assert.match(out(r), /androidPermissions\.merged\.lockfile names pubspec\.lock, which does not exist/);
  });

  test('FAILS when the surface block stops saying what it cannot see', () => {
    const r = run(makeRoot({ ds: (x) => { delete x.crashSdkSurface.cannotSee; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /crashSdkSurface carries no `cannotSee`/);
  });
});

describe('assert-play-declarations — a settled question cannot drift back', () => {
  const RESOLVED = () => ({
    id: 'edge-derived-coarse-geo',
    affects: ['Email address'],
    ownerItem: 'O-3',
    question: 'does the edge-derived geo count as collection?',
    answer: 'yes — Play says inferred approximate location must be disclosed',
    settledOn: '2026-08-04',
    settledBy: 'the primary source, on the page this file already cited',
  });

  test('a resolved entry pointing at a filled-in answer passes and is counted', () => {
    const r = run(makeRoot({ ds: (x) => { x.resolved = [RESOLVED()]; } }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 settled question\(s\) re-checked/);
  });

  test('FAILS when an answer recorded as settled is re-nulled — the backslide', () => {
    const r = run(makeRoot({
      ds: (x) => {
        x.resolved = [RESOLVED()];
        findAnswer(x, 'Email address').collected['backend-live'] = null;
        findAnswer(x, 'Email address').unresolved = 'edge-derived-coarse-geo';
        x.unresolved = [
          { id: 'edge-derived-coarse-geo', affects: ['Email address'], ownerItem: 'O-3', question: 'q', howToResolve: 'h', status: 's' },
        ];
      },
    }));
    assert.equal(r.status, 1);
    assert.match(out(r), /and that answer is STILL null/);
    assert.match(out(r), /is ALSO listed in `unresolved`/);
  });

  test('FAILS when a resolved entry records no provenance', () => {
    const r = run(makeRoot({ ds: (x) => { const e = RESOLVED(); delete e.settledBy; x.resolved = [e]; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has no `settledBy`/);
  });

  test('FAILS when a resolved entry points at no Play data type', () => {
    const r = run(makeRoot({ ds: (x) => { const e = RESOLVED(); e.affects = []; x.resolved = [e]; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /names no `affects`/);
  });

  test('FAILS when settledOn is not an ISO date', () => {
    const r = run(makeRoot({ ds: (x) => { const e = RESOLVED(); e.settledOn = 'August 2026'; x.resolved = [e]; } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /settledOn is not an ISO date/);
  });
});

// ═════ limb 7a — the MERGED manifest measurement ═════════════════════════════
// 🔴 THE BLOCK THIS COVERS SPENT ITS FIRST DAY MAKING TWO PROMISES NOTHING KEPT.
// androidPermissions.merged said in prose that `expectedButAbsent` was "an
// equality with teeth" and that `pinned` was what stopped the reading "going
// quietly stale" — while NOTHING READ EITHER KEY. The measurement itself was
// correct; the sentences beside it were claims with no check behind them, which
// is this corpus's signature defect. These tests exist so that stays fixed.
//
// RECORDED MUTATION RUN AGAINST THE REAL TREE, 2026-08-26 — 10/10 caught,
// baseline PASS before and after, data-safety.json restored from an in-memory
// original and sha256-compared byte-identical:
//   pin drifts 17.2.4→17.9.0 · pinned package leaves the graph · an
//   expectedButAbsent permission APPEARS · merged deleted · permissions emptied
//   · pinned emptied · the unattributed row loses its named finding · the
//   `inferred` row loses its residual · a `read` row loses its evidence ·
//   measuredFrom loses its runId.
// The fixture cases below are the regression net that pins the MESSAGES; the
// real-tree block at the end is what stops the fixture drifting away from the
// declaration it claims to model.
describe('assert-play-declarations — limb 7a: the merged manifest, as measured', () => {
  test('the happy path counts what it graded, so a reader can see it ranged over something', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /3 MERGED manifest permission\(s\) graded \(measured from run 1, 2026-08-26\)/);
    assert.match(out(r), /1 merged-manifest version pin\(s\) match pubspec\.lock/);
    assert.match(out(r), /1 predicted-but-absent permission\(s\) still absent/);
  });

  // ── the pin: the one drift no other limb in this file can see ──────────────
  test('🔴 FAILS when a pinned plugin version drifts in the lock', () => {
    // The bump that changes the merged set with NO other file moving: the
    // pubspec range is unchanged, the manifest equality is unchanged, the
    // dependency equality is unchanged. Only the resolution moved.
    const r = run(makeRoot({ files: (f) => { f['pubspec.lock'] = LOCK.replace('17.2.4', '17.9.0'); } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /resolves `flutter_local_notifications` to 17\.9\.0/);
    assert.match(out(r), /A bump is the one way this measurement rots/);
  });

  test('FAILS when the pinned package has left the dependency graph entirely', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.pinned = { gone_package: '1.0.0' }; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /androidPermissions\.merged\.pinned names `gone_package` and pubspec\.lock resolves no such package/);
  });

  // ── expectedButAbsent: the receipt with teeth ──────────────────────────────
  test('🔴 FAILS when an `expectedButAbsent` permission APPEARS in the merged set', () => {
    const r = run(makeRoot({
      ds: (x) => {
        x.androidPermissions.merged.permissions.push({
          name: 'android.permission.ACCESS_NETWORK_STATE',
          attributedTo: 'sentry_flutter',
          attribution: 'transitive',
          evidenceGrade: 'read',
          evidence: 'it turned up in a later re-measurement',
          collectionSignal: false,
          why: 'appended silently, which is the thing the block forbids',
        });
      },
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /under `expectedButAbsent` AND carries it in `permissions`/);
    assert.match(out(r), /Do NOT append it silently/);
  });

  test('FAILS when an expectedButAbsent entry loses the write-up that makes it actionable', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.expectedButAbsent['android.permission.ACCESS_NETWORK_STATE'] = ''; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /expectedButAbsent\["android\.permission\.ACCESS_NETWORK_STATE"\] carries no reason/);
  });

  // ── what each grade obliges ────────────────────────────────────────────────
  test('FAILS when a `read` row carries no evidence — the grade is then just a word', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.permissions[0].evidence = ''; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is graded `read` and carries no `evidence`/);
  });

  test('FAILS when an `inferred` row carries no residual — that residual IS the difference from `read`', () => {
    const r = run(makeRoot({ ds: (x) => { delete x.androidPermissions.merged.permissions[2].residual; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is graded `inferred` and carries no `residual`/);
  });

  test('FAILS on an evidence grade the block does not use', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.permissions[0].evidenceGrade = 'probably'; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /which is not one of read, inferred/);
  });

  test('FAILS on an attribution the block does not use', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.permissions[0].attribution = 'probably flutter'; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /which is not one of direct, transitive, unattributed/);
  });

  test('FAILS when a row carries no boolean collectionSignal — silence must not read as "no"', () => {
    const r = run(makeRoot({ ds: (x) => { delete x.androidPermissions.merged.permissions[0].collectionSignal; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /has no boolean `collectionSignal`/);
  });

  // ── unattributed, in BOTH directions ───────────────────────────────────────
  test('🔴 FAILS when an unattributed row has no named finding — a blank filled in with silence', () => {
    const r = run(makeRoot({ ds: (x) => { delete x.androidPermissions.merged.unattributed['android.permission.INTERNET']; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /`merged\.unattributed` carries no finding for it/);
  });

  test('FAILS when an unattributed row is quietly given a source without closing the finding', () => {
    const r = run(makeRoot({
      ds: (x) => {
        const row = x.androidPermissions.merged.permissions[1];
        row.attribution = 'transitive';
        row.attributedTo = 'sentry_flutter';
        row.evidenceGrade = 'read';
        row.evidence = 'a guess, dressed';
      },
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /still carries an open finding for `android\.permission\.INTERNET`/);
  });

  test('FAILS when a finding outlives the row it was about', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.unattributed['android.permission.GONE'] = 'x'; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /names `android\.permission\.GONE`, which is in no `permissions` row/);
  });

  test('FAILS when an unattributed row half-names a source', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.permissions[1].attributedTo = 'probably sentry'; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /graded `unattributed` while still carrying an attributedTo/);
  });

  // ── the provenance, and the "it all came from dependencies" sentence ───────
  test('FAILS when the measurement loses the receipt it was taken from', () => {
    const r = run(makeRoot({ ds: (x) => { delete x.androidPermissions.merged.measuredFrom.runId; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /measuredFrom has no `runId`/);
  });

  test('FAILS when measuredOn is not an ISO date', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.measuredFrom.measuredOn = 'August 2026'; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /measuredFrom\.measuredOn is not an ISO date/);
  });

  test('FAILS when the release manifest starts hand-declaring one of the merged permissions', () => {
    // `merged._why` asserts that not ONE of these arrived from this repository.
    const r = run(makeRoot({
      ds: (x) => { x.androidPermissions.declaredInRepo['apps/subly/android/app/src/main/AndroidManifest.xml'] = ['android.permission.VIBRATE']; },
      files: (f) => { f['apps/subly/android/app/src/main/AndroidManifest.xml'] = MANIFEST.replace('<application', '<uses-permission android:name="android.permission.VIBRATE"/>\n    <application'); },
    }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no longer arrived wholly from dependencies/);
  });

  test('FAILS when the named release manifest is not one the walk found', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.releaseManifest = 'apps/subly/android/app/src/nope/AndroidManifest.xml'; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not one of the manifests this walk found/);
  });

  test('FAILS when one permission is listed twice — a merged manifest is a SET', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.permissions.push({ ...x.androidPermissions.merged.permissions[0] }); } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /appears TWICE/);
  });

  // ── COVERAGE: a limb that ranges over nothing must never certify anything ──
  test('COVERAGE LOST when the whole `merged` block is deleted', () => {
    const r = run(makeRoot({ ds: (x) => { delete x.androidPermissions.merged; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /androidPermissions carries no `merged` block/);
  });

  test('COVERAGE LOST when merged.permissions is emptied — not "no permissions merged"', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.permissions = []; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /androidPermissions\.merged\.permissions is empty or not an array/);
  });

  test('COVERAGE LOST when merged.pinned is emptied — the pin is the anti-rot, not decoration', () => {
    const r = run(makeRoot({ ds: (x) => { x.androidPermissions.merged.pinned = {}; } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /androidPermissions\.merged\.pinned is missing or empty/);
  });

  test('COVERAGE LOST when the lock parses to ZERO versions — a moved format is not "no drift"', () => {
    // Every package heading loses its two-space indent, so the shared
    // parseLockVersions() anchor matches nothing. A subset check would read that
    // as "no pin drifted" and pass.
    const r = run(makeRoot({ files: (f) => { f['pubspec.lock'] = LOCK.replace(/^ {2}(\S)/gm, '$1'); } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /parsed to ZERO resolved package versions/);
  });
});

// ═════ the REAL declaration — the anti-drift check ═══════════════════════════
// ⚠️ A FIXTURE AGREES WITH WHATEVER MISUNDERSTANDING WROTE IT, and the fixture
// above is a THREE-row miniature of a FOUR-row measurement. These read the real
// file, so the miniature cannot quietly stop modelling the thing it stands in for.
describe('assert-play-declarations — limb 7a against the REAL data-safety.json', () => {
  const REPO = resolve(CI_DIR, '..', '..');
  const DS_PATH = join(REPO, 'apps', 'subly', 'store', 'android-play', 'data-safety.json');
  const realMerged = () => {
    assert.ok(existsSync(DS_PATH), `${DS_PATH} does not exist — this limb reads it and cannot be checked against it`);
    const m = JSON.parse(readFileSync(DS_PATH, 'utf8')).androidPermissions?.merged;
    assert.ok(m, 'the real declaration carries no androidPermissions.merged — limb 7a would COVERAGE LOST');
    return m;
  };

  test('🔴 the REAL tree passes, and the merged limb ranged over something while it did', () => {
    const r = run(REPO);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /assert-play-declarations: ok/);
    const m = out(r).match(/(\d+) MERGED manifest permission\(s\) graded/);
    assert.ok(m, `the ok summary does not report the merged limb at all:\n${out(r)}`);
    assert.ok(Number(m[1]) > 0, 'the merged limb graded ZERO rows and still reported ok');
  });

  test('every pinned package still resolves to the pinned version in the real pubspec.lock', () => {
    // Read independently of the guard's own parse: a shared parse that is wrong
    // agrees with itself, and this is the check that would notice.
    const lock = readFileSync(join(REPO, 'pubspec.lock'), 'utf8');
    const pinned = realMerged().pinned;
    assert.ok(Object.keys(pinned).length > 0, 'merged.pinned is empty on the real declaration');
    for (const [pkg, version] of Object.entries(pinned)) {
      const block = lock.match(new RegExp(`^ {2}${pkg}:\\n(?: {4,}.*\\n)+`, 'm'));
      assert.ok(block, `pubspec.lock has no entry for the pinned package ${pkg}`);
      assert.match(block[0], new RegExp(`^ {4}version: "?${version.replace(/\./g, '\\.')}"?\\s*$`, 'm'), `${pkg} is pinned to ${version} and the lock says otherwise`);
    }
  });

  test('every expectedButAbsent permission is still absent from the real merged set', () => {
    const m = realMerged();
    const names = new Set(m.permissions.map((p) => p.name));
    const absent = Object.keys(m.expectedButAbsent ?? {});
    assert.ok(absent.length > 0, 'expectedButAbsent is empty — the receipt with teeth has no teeth');
    for (const name of absent) {
      assert.equal(names.has(name), false, `${name} was predicted, measured absent, and has now appeared — re-take the reading`);
    }
  });

  test('every real row carries the fields its own grade obliges', () => {
    for (const p of realMerged().permissions) {
      if (p.attribution === 'unattributed') {
        assert.equal(p.attributedTo, null, `${p.name} is unattributed and still names a source`);
        assert.equal(p.evidenceGrade, null, `${p.name} is unattributed and still carries a grade`);
      } else {
        assert.ok(['read', 'inferred'].includes(p.evidenceGrade), `${p.name} has grade ${p.evidenceGrade}`);
        assert.ok(typeof p.evidence === 'string' && p.evidence.trim() !== '', `${p.name} is graded ${p.evidenceGrade} with no evidence`);
        if (p.evidenceGrade === 'inferred') {
          assert.ok(typeof p.residual === 'string' && p.residual.trim() !== '', `${p.name} is inferred with no residual`);
        }
      }
      assert.equal(typeof p.collectionSignal, 'boolean', `${p.name} does not say whether it is a collection signal`);
    }
  });

  test('every unattributed row has a named finding, and every finding has a row', () => {
    const m = realMerged();
    const unattributed = m.permissions.filter((p) => p.attribution === 'unattributed').map((p) => p.name);
    const findings = Object.keys(m.unattributed ?? {});
    assert.deepEqual([...unattributed].sort(), [...findings].sort(), 'the unattributed rows and the named findings have drifted apart');
  });
});
