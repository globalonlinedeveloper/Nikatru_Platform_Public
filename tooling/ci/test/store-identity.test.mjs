// ─────────────────────────────────────────────────────────────────────────────
// store-identity.test.mjs — assert-store-identity.mjs and the shared readers in
// read-identity.mjs must be able to FAIL.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Eight mutations against a full COPY of this
// repository, 2026-08-03, all eight caught and restored byte-identically:
//
//   1. `applicationId = "com.nikatru.subscriptiontracker2"` ⇒ exit 1 naming the canonical
//      form. (First attempt MISSED because the mutation hit `namespace =` and
//      not `applicationId =` — a defect in the MUTATION, diagnosed rather than
//      accepted, which is the rule this repo has written down twice.)
//   2. THE SHARPEST CASE: the Linux `set(APPLICATION_ID …)` line DELETED ⇒
//      exit 1. Windows was green on having no identity at all for weeks, so an
//      absent identity must never read like a correct one.
//   3. the Linux id changed to `com.example.subscriptiontracker` ⇒ exit 1. Nothing in this
//      repository compared that value before [10]D-3.
//   4. the shared Apple reader's matcher broken ⇒ COVERAGE LOST, not a pass.
//   5. every `identity` block removed from the register ⇒ COVERAGE LOST. (Also
//      MISSED first time, for replacing one occurrence instead of all — same
//      diagnosis, same fix.)
//   6. the app catalogue emptied ⇒ COVERAGE LOST.
//   7. a SECOND catalogue entry with no platform folders ⇒ exit 0 with the gap
//      PRINTED. A web-only app is not failing to declare an Android package
//      name, and a guard that said otherwise would be switched off.
//   8. the macOS xcconfig's bundle id changed ⇒ exit 1 — a DIFFERENT file from
//      the iOS one, which is exactly why the path is data in the register and
//      not a constant in a reader.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  readGradleApplicationId,
  readAppleBundleId,
  readCMakeApplicationId,
  readMsixIdentityName,
  resolveIdentity,
  windowsIdentityOf,
} from '../read-identity.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-store-identity.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ident-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const REGISTER = () => ({
  retiredIdentityTokens: { tokens: ['subly'] },
  channels: [
    { id: 'web', kind: 'web', platforms: ['web'], deploymentEnvironment: '{app}-web' },
    {
      id: 'android-play',
      kind: 'store',
      platforms: ['android'],
      identity: { kind: 'gradle-application-id', declaredIn: 'apps/{app}/android/app/build.gradle.kts' },
    },
    {
      id: 'linux-snap',
      kind: 'store',
      platforms: ['linux'],
      identity: { kind: 'cmake-application-id', declaredIn: 'apps/{app}/linux/CMakeLists.txt' },
      snapName: { declaredIn: 'apps/{app}/store/linux-snap/snap-name.txt', derivation: 'param-case(apps/{app}/app.yaml name)' },
    },
  ],
});

function fixture({ register = REGISTER(), apps = [{ slug: 'subscriptiontracker', platforms: ['web'] }], files = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  const write = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('catalog/apps.json', JSON.stringify(apps, null, 2));
  const defaults = {
    'apps/subscriptiontracker/android/app/build.gradle.kts': 'android {\n    namespace = "com.nikatru.subscriptiontracker"\n    defaultConfig {\n        applicationId = "com.nikatru.subscriptiontracker"\n    }\n}\n',
    'apps/subscriptiontracker/linux/CMakeLists.txt': 'cmake_minimum_required(VERSION 3.13)\nset(APPLICATION_ID "com.nikatru.subscriptiontracker")\n',
    'apps/subscriptiontracker/app.yaml': 'id: subscriptiontracker\nname: Nikatru Subscription Tracker # the store title\n',
    'apps/subscriptiontracker/store/linux-snap/snap-name.txt': 'nikatru-subscription-tracker\n',
  };
  for (const [rel, body] of Object.entries({ ...defaults, ...files })) {
    if (body === null) continue;
    write(rel, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('read-identity — each reader answers found / missing / lost, never a guess', () => {
  test('gradle: finds applicationId and is not confused by namespace', () => {
    const r = readGradleApplicationId('android {\n  namespace = "com.other.thing"\n  applicationId = "com.nikatru.subscriptiontracker"\n}', 'g');
    assert.equal(r.value, 'com.nikatru.subscriptiontracker');
  });

  test('gradle: no applicationId is MISSING, and the message says why it cannot wait', () => {
    const r = readGradleApplicationId('android { namespace = "x" }', 'g');
    assert.equal(r.value, null);
    assert.match(r.missing, /Play binds the package name PERMANENTLY at the first upload/);
  });

  test('apple: TEST bundles are dropped EXPLICITLY, not by taking the first match', () => {
    const text = 'PRODUCT_BUNDLE_IDENTIFIER = com.nikatru.subscriptiontracker.RunnerTests;\nPRODUCT_BUNDLE_IDENTIFIER = com.nikatru.subscriptiontracker;\n';
    assert.equal(readAppleBundleId(text, 'p').value, 'com.nikatru.subscriptiontracker');
  });

  test('apple: ONLY test bundles is MISSING — there is nothing to submit under', () => {
    const r = readAppleBundleId('PRODUCT_BUNDLE_IDENTIFIER = com.nikatru.subscriptiontracker.RunnerTests;', 'p');
    assert.match(r.missing, /only for test bundles/);
  });

  test('apple: two DIFFERENT app bundle ids is MISSING — nothing says which ships', () => {
    const r = readAppleBundleId('PRODUCT_BUNDLE_IDENTIFIER = com.a;\nPRODUCT_BUNDLE_IDENTIFIER = com.b;', 'p');
    assert.match(r.missing, /2 DIFFERENT app bundle identifiers/);
  });

  test('apple: ZERO assignments is LOST — a reader that finds nothing agrees with nothing', () => {
    const r = readAppleBundleId('// nothing here', 'p');
    assert.match(r.lost, /ZERO `PRODUCT_BUNDLE_IDENTIFIER` assignments/);
  });

  test('cmake: finds APPLICATION_ID', () => {
    assert.equal(readCMakeApplicationId('set(APPLICATION_ID "com.nikatru.subscriptiontracker")', 'c').value, 'com.nikatru.subscriptiontracker');
  });

  test('cmake: no APPLICATION_ID is MISSING — the one nothing compared before D-3', () => {
    const r = readCMakeApplicationId('project(runner LANGUAGES CXX)', 'c');
    assert.match(r.missing, /the id GTK registers the application under/);
  });

  test('msix: reads identity_name out of the msix_config block', () => {
    const y = 'name: subscriptiontracker\nmsix_config:\n  display_name: Subly\n  identity_name: NIKATRU.Subly\n';
    assert.equal(readMsixIdentityName(y, 'p').value, 'NIKATRU.Subly');
  });

  test('msix: no msix_config block is MISSING', () => {
    assert.match(readMsixIdentityName('name: subscriptiontracker\n', 'p').missing, /no `msix_config:` block/);
  });

  test('resolveIdentity: an unknown kind is LOST, never a silent skip', () => {
    const r = resolveIdentity(TMP, 'subscriptiontracker', { kind: 'invented', declaredIn: 'apps/{app}/x' });
    assert.match(r.lost, /has no reader/);
  });

  test('resolveIdentity: a declaredIn with no {app} is LOST', () => {
    const r = resolveIdentity(TMP, 'subscriptiontracker', { kind: 'gradle-application-id', declaredIn: 'apps/subscriptiontracker/x' });
    assert.match(r.lost, /is not an "\{app\}" template/);
  });
});

// ⏱ 2026-09-25 — O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1). windowsIdentityOf reads
// the identity Partner Center issued to ONE app out of that app's own app.yaml.
// Every identity here is synthetic (ZZTest.*): none was issued by Partner Center.
describe('read-identity — windowsIdentityOf reads the app it is asked about, and nothing else', () => {
  const declare = (slug, body) => {
    const root = join(TMP, `w${seq++}`);
    if (body !== null) {
      mkdirSync(join(root, 'apps', slug), { recursive: true });
      writeFileSync(join(root, 'apps', slug, 'app.yaml'), body);
    }
    return root;
  };

  test('a complete record is FOUND, both fields, with the declaration it came from', () => {
    const root = declare('zzone', 'id: zzone\nstores:\n  windows-store:\n    identityName: ZZTest.AppOne\n    packageFamilyName: ZZTest.AppOne_aaaaaaaaaaaaa\n');
    const r = windowsIdentityOf(root, 'zzone');
    assert.deepEqual(r.value, { identityName: 'ZZTest.AppOne', packageFamilyName: 'ZZTest.AppOne_aaaaaaaaaaaaa' });
    assert.equal(r.rel, 'apps/zzone/app.yaml');
    assert.equal(r.missing, null);
  });

  test('a record on the sentinel is FOUND as written — "not yet issued" is the caller\'s to tell', () => {
    const root = declare('zzone', 'id: zzone\nstores:\n  windows-store:\n    identityName: PARTNER-CENTER-PENDING\n    packageFamilyName: PARTNER-CENTER-PENDING\n');
    assert.deepEqual(windowsIdentityOf(root, 'zzone').value, { identityName: 'PARTNER-CENTER-PENDING', packageFamilyName: 'PARTNER-CENTER-PENDING' });
  });

  test('two apps in one root each answer with their OWN record', () => {
    const root = declare('zzone', 'id: zzone\nstores:\n  windows-store:\n    identityName: ZZTest.AppOne\n    packageFamilyName: ZZTest.AppOne_aaaaaaaaaaaaa\n');
    mkdirSync(join(root, 'apps', 'zztwo'), { recursive: true });
    writeFileSync(join(root, 'apps', 'zztwo', 'app.yaml'), 'id: zztwo\nstores:\n  windows-store:\n    identityName: ZZTest.AppTwo\n    packageFamilyName: ZZTest.AppTwo_bbbbbbbbbbbbb\n');
    assert.equal(windowsIdentityOf(root, 'zzone').value.identityName, 'ZZTest.AppOne');
    assert.equal(windowsIdentityOf(root, 'zztwo').value.identityName, 'ZZTest.AppTwo');
  });

  test('an app.yaml with no stores record is UNDECLARED, not missing and not found', () => {
    const r = windowsIdentityOf(declare('zzone', 'id: zzone\n'), 'zzone');
    assert.equal(r.undeclared, 'apps/zzone/app.yaml');
    assert.equal(r.value, null);
    assert.equal(r.missing, null);
  });

  test('no app.yaml at all is ABSENT', () => {
    const r = windowsIdentityOf(declare('zzone', null), 'zzone');
    assert.equal(r.absent, 'apps/zzone/app.yaml');
    assert.equal(r.value, null);
    assert.equal(r.undeclared, undefined);
  });

  test('a record with one field is MISSING — a hole, not a placeholder', () => {
    const r = windowsIdentityOf(declare('zzone', 'id: zzone\nstores:\n  windows-store:\n    identityName: ZZTest.AppOne\n'), 'zzone');
    assert.equal(r.value, null);
    assert.match(r.missing, /apps\/zzone\/app\.yaml stores\.windows-store\.packageFamilyName missing or empty — a hole, not a placeholder/);
  });

  test('an empty field is a hole too', () => {
    const r = windowsIdentityOf(declare('zzone', 'id: zzone\nstores:\n  windows-store:\n    identityName: ""\n    packageFamilyName: ZZTest.AppOne_aaaaaaaaaaaaa\n'), 'zzone');
    assert.match(r.missing, /stores\.windows-store\.identityName missing or empty/);
  });

  test('a record that is a scalar is MISSING, not undeclared', () => {
    const r = windowsIdentityOf(declare('zzone', 'id: zzone\nstores:\n  windows-store: ZZTest.AppOne\n'), 'zzone');
    assert.match(r.missing, /stores\.windows-store is "ZZTest\.AppOne", not a record of identityName and packageFamilyName/);
  });

  test('an app.yaml that does not parse is MISSING, naming the parse failure', () => {
    const r = windowsIdentityOf(declare('zzone', 'id: zzone\nid: zzone\n'), 'zzone');
    assert.match(r.missing, /apps\/zzone\/app\.yaml does not parse \(.*duplicate key "id"/);
  });
});

describe('assert-store-identity — the snap name is DERIVED, and a retired token is refused in any form', () => {
  // ⏱ 2026-09-11 — REVIEW-stores-2026-09-10 #7. Before this, snap-name.txt was shape-checked
  // only: every name below except the first passed every guard in the repository.
  test('PASSES when snap-name.txt is param-case of app.yaml name, and SAYS how many it compared', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}snap name — 1 snap name\(s\) equal param-case\(apps\/\{app\}\/app\.yaml name\); retired token\(s\) "subly" refused across 2 store identity\(ies\) and 1 snap name\(s\)/);
  });

  test('FAILS a shape-valid name that is not the derived one — the slug alone', () => {
    const { code, out } = run(fixture({ files: { 'apps/subscriptiontracker/store/linux-snap/snap-name.txt': 'subscriptiontracker\n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /snap-name\.txt is "subscriptiontracker" and the derived snap name is "nikatru-subscription-tracker"/);
  });

  for (const retired of ['subly', 'nikatru-subly', 'sub-ly', 'SUBLY']) {
    test(`FAILS the retired name in the form ${JSON.stringify(retired)}`, () => {
      const { code, out } = run(fixture({ files: { 'apps/subscriptiontracker/store/linux-snap/snap-name.txt': `${retired}\n` } }));
      assert.equal(code, 1, out);
      assert.match(out, /carries the RETIRED token "subly"/);
    });
  }

  test('a retired token is refused in a STORE IDENTITY too, not only in the snap name', () => {
    const { code, out } = run(
      fixture({
        files: {
          'apps/subscriptiontracker/linux/CMakeLists.txt': 'cmake_minimum_required(VERSION 3.13)\nset(APPLICATION_ID "com.nikatru.Sub_ly")\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /declares "com\.nikatru\.Sub_ly", which carries the RETIRED token "subly"/);
  });

  test('FAILS when the app is built for Linux and snap-name.txt is missing', () => {
    const { code, out } = run(fixture({ files: { 'apps/subscriptiontracker/store/linux-snap/snap-name.txt': null } }));
    assert.equal(code, 1, out);
    assert.match(out, /snap-name\.txt does not exist, so nothing states the GLOBAL name it would register/);
  });

  test('FAILS a snap-name.txt holding two candidates', () => {
    const { code, out } = run(fixture({ files: { 'apps/subscriptiontracker/store/linux-snap/snap-name.txt': 'nikatru-subscription-tracker\nnikatru-subscriptions\n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /holds 2 non-empty line\(s\)/);
  });

  test('FAILS when app.yaml declares no name — nothing to derive from', () => {
    const { code, out } = run(fixture({ files: { 'apps/subscriptiontracker/app.yaml': 'id: subscriptiontracker\n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no top-level `name`, so the snap name cannot be derived/);
  });

  test('COVERAGE LOST when the register declares no retired tokens', () => {
    const register = REGISTER();
    delete register.retiredIdentityTokens;
    const { code, out } = run(fixture({ register }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/channel-register\.json declares no `retiredIdentityTokens\.tokens`/);
  });

  test('COVERAGE LOST when the snap derivation is one the guard does not implement', () => {
    const register = REGISTER();
    register.channels.find((c) => c.id === 'linux-snap').snapName.derivation = 'whatever the author typed';
    const { code, out } = run(fixture({ register }));
    assert.equal(code, 2, out);
    assert.match(out, /the only derivation this guard implements is "param-case\(apps\/\{app\}\/app\.yaml name\)"/);
  });
});

describe('assert-store-identity', () => {
  test('PASSES when every declared platform resolves to com.nikatru.<slug>', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /2 \(app × platform\) identity\(ies\) compared/);
  });

  // O-APP-ID-FORM-UNVALIDATED (a). `com.nikatru.habit_tracker` would be bound by
  // every store for good; the slug is refused through contracts/app-id first.
  test('a catalog slug habit_tracker is refused, naming it', () => {
    const { code, out } = run(
      fixture({ apps: [{ slug: 'subscriptiontracker', platforms: ['web'] }, { slug: 'habit_tracker', platforms: ['web'] }] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /catalog\/apps\.json\[1\] slug "habit_tracker": app id "habit_tracker" breaks the pattern/);
    assert.match(out, /contracts\/app-id/);
  });

  test('FAILS on an Android package name that is not the canonical form', () => {
    const { code, out } = run(
      fixture({
        files: {
          'apps/subscriptiontracker/android/app/build.gradle.kts':
            'android {\n    namespace = "com.nikatru.subscriptiontracker"\n    defaultConfig {\n        applicationId = "com.nikatru.subscriptiontracker2"\n    }\n}\n',
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /declares "com\.nikatru\.subscriptiontracker2" and architecture §24's canonical form is "com\.nikatru\.subscriptiontracker"/);
    assert.match(out, /Two platforms disagreeing is two apps/);
  });

  // THE SHARPEST CASE — absence must not read as agreement.
  test('FAILS when the Linux APPLICATION_ID is gone — absence is not agreement', () => {
    const { code, out } = run(fixture({ files: { 'apps/subscriptiontracker/linux/CMakeLists.txt': 'project(runner LANGUAGES CXX)\n' } }));
    assert.equal(code, 1);
    assert.match(out, /declares no `APPLICATION_ID`/);
  });

  test('FAILS when the platform folder exists and its identity FILE does not', () => {
    const { code, out } = run(fixture({ files: { 'apps/subscriptiontracker/linux/CMakeLists.txt': null, 'apps/subscriptiontracker/linux/main.cc': 'int main(){}' } }));
    assert.equal(code, 1);
    assert.match(out, /The platform folder is there, so this app IS built for it/);
  });

  // The relationship, and the direction that keeps it from firing on correct input.
  test('a web-only app with NO platform folders is not failing to declare anything', () => {
    const { code, out } = run(
      fixture({
        apps: [{ slug: 'subscriptiontracker', platforms: ['web'] }, { slug: 'probe2', platforms: ['web'] }],
        files: { 'apps/probe2/pubspec.yaml': 'name: probe2\n' },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /skipped for having no platform folder/);
  });

  test('a catalogue entry with no app on disk is PRINTED, not judged', () => {
    const { code, out } = run(fixture({ apps: [{ slug: 'subscriptiontracker' }, { slug: 'ghost' }] }));
    assert.equal(code, 0, out);
    assert.match(out, /lists "ghost" and apps\/ghost is not on disk/);
  });

  test('FAILS on a catalogue entry with no slug', () => {
    const { code, out } = run(fixture({ apps: [{ slug: 'subscriptiontracker' }, { name: 'nameless' }] }));
    assert.equal(code, 1);
    assert.match(out, /carries an entry with no `slug`/);
  });

  // ── coverage self-checks ──────────────────────────────────────────────────
  test('COVERAGE LOST when the catalogue is empty', () => {
    const { code, out } = run(fixture({ apps: [] }));
    assert.equal(code, 2);
    assert.match(out, /lists no app/);
  });

  test('COVERAGE LOST when no register row declares an identity', () => {
    const register = REGISTER();
    for (const c of register.channels) delete c.identity;
    const { code, out } = run(fixture({ register }));
    assert.equal(code, 2);
    assert.match(out, /declares an `identity` block/);
    assert.match(out, /having no identity read exactly like having the right one/);
  });

  test('COVERAGE LOST when a reader finds nothing at all', () => {
    const register = REGISTER();
    register.channels.push({
      id: 'ios-appstore',
      kind: 'store',
      platforms: ['ios'],
      identity: { kind: 'apple-bundle-id', declaredIn: 'apps/{app}/ios/project.pbxproj' },
    });
    const { code, out } = run(fixture({ register, files: { 'apps/subscriptiontracker/ios/project.pbxproj': '// empty\n' } }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /compares nothing to nothing and agrees/);
  });

  test('COVERAGE LOST when every pair is skipped and nothing is compared', () => {
    const { code, out } = run(
      fixture({
        apps: [{ slug: 'webonly' }],
        files: { 'apps/webonly/pubspec.yaml': 'name: webonly\n' },
      }),
    );
    assert.equal(code, 2);
    assert.match(out, /produced ZERO comparisons/);
  });

  test('COVERAGE LOST when the register is not there', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 — WINDOWS. REVIEW-stores-2026-09-10 #3: the windows-store row had no
// `identity` block, so this guard never saw it, and the submitter treated an all-
// placeholder identity as a print. The expected value is the REGISTER's
// packageIdentity.identityName (Partner Center assigns it; it is not the slug), and a
// placeholder is graded by RUNNING the channel's submitter with no credentials.
//
// The fixture carries a COPY of the real submitter and the tooling/ci modules it spawns,
// because the guard runs the script the register names inside the tree it grades.
const WIN_SENTINEL = 'PARTNER-CENTER-PENDING';
const WIN_REAL = { identityName: 'NikatruFixture.SubscriptionTracker', publisherDisplayName: 'Nikatru Fixture', publisher: 'CN=00000000-0000-0000-0000-000000000000' };

// ⏱ 2026-09-25 — O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1). `identity` is now the
// app's OWN record (apps/subscriptiontracker/app.yaml stores.windows-store), which
// `expectedFrom` names; the row keeps only the sentinel and the ACCOUNT, whose
// state is `accountReal` (by default real exactly when the identity is). `record`
// null writes an app.yaml with no stores block.
function windowsFixture({
  identity = WIN_SENTINEL,
  packaged = identity,
  served = false,
  placeholderValue = WIN_SENTINEL,
  submitter = null,
  dropRefusal = false,
  accountReal = identity !== WIN_SENTINEL,
  record = true,
} = {}) {
  const real = accountReal;
  const register = REGISTER();
  register.storeMetadataContract = {
    requiredFiles: ['README.md', 'title.txt', 'short-description.txt', 'long-description.txt', 'category.txt', 'privacy-policy-url.txt', 'support-url.txt', 'screenshots/README.md'],
    urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
    perChannel: { 'windows-store': { additionalFiles: ['search-terms.txt'], maxLines: { 'search-terms.txt': { max: 7, source: 'MS Store Policies v7.19 §10.1.3' } } } },
  };
  register.channels.push({
    id: 'windows-store',
    kind: 'store',
    served,
    submittable: true,
    platforms: ['windows'],
    artifactFormats: ['.msix'],
    storeMetadataDir: 'apps/{app}/store/windows-store',
    ownerQueue: 'A-2',
    identity: { kind: 'msix-identity-name', declaredIn: 'apps/{app}/pubspec.yaml', expectedFrom: 'apps/{app}/app.yaml stores.windows-store.identityName', placeholderValue },
    packageIdentity: {
      notYetConfiguredSentinel: WIN_SENTINEL,
      publisherDisplayName: real ? WIN_REAL.publisherDisplayName : WIN_SENTINEL,
      publisher: real ? WIN_REAL.publisher : `CN=${WIN_SENTINEL}`,
    },
    submission: { script: 'tooling/release/submit-windows-store.mjs', runbook: 'Private/runbooks/store-submission-windows.md' },
  });
  const msix = [
    'msix_config:',
    '  display_name: Subscriptions',
    `  publisher_display_name: ${real ? WIN_REAL.publisherDisplayName : WIN_SENTINEL}`,
    `  identity_name: ${packaged}`,
    `  publisher: ${real ? WIN_REAL.publisher : `CN=${WIN_SENTINEL}`}`,
    '  store: true',
    '  output_path: build/windows/msix',
    '  output_name: subscriptiontracker',
  ].join('\n');
  const listing = {
    'README.md': 'derivation map\n',
    'title.txt': 'Subscriptions\n',
    'short-description.txt': 'Track every subscription in one place\n',
    'long-description.txt': 'A longer description.\n',
    'category.txt': 'Productivity\n',
    'privacy-policy-url.txt': 'https://nikatru.com/privacy\n',
    'support-url.txt': 'https://nikatru.com/contact\n',
    'screenshots/README.md': 'slot\n',
    'search-terms.txt': 'a\nb\n',
  };
  const pfn = identity === WIN_SENTINEL ? WIN_SENTINEL : `${identity}_aaaaaaaaaaaaa`;
  const files = {
    'apps/subscriptiontracker/pubspec.yaml': `name: subscriptiontracker\n\n${msix}\n`,
    'apps/subscriptiontracker/windows/runner/main.cpp': 'int main(){}\n',
    'apps/subscriptiontracker/app.yaml':
      'id: subscriptiontracker\nname: Nikatru Subscription Tracker # the store title\n' +
      (record ? `stores:\n  windows-store:\n    identityName: ${identity}\n    packageFamilyName: ${pfn}\n` : ''),
  };
  for (const [k, v] of Object.entries(listing)) files[`apps/subscriptiontracker/store/windows-store/${k}`] = v;
  const root = fixture({
    register,
    apps: [{ slug: 'subscriptiontracker', name: 'Subscriptions', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' }],
    files,
  });
  cpSync(join(REPO, 'tooling', 'ci'), join(root, 'tooling', 'ci'), { recursive: true, filter: (src) => !src.split(/[\\/]/).includes('test') });
  // The submitter reads the app's record through tooling/ci/read-identity.mjs,
  // which parses app.yaml with the one YAML reader; without it the copy dies on load.
  mkdirSync(join(root, 'tooling', 'app-yaml'), { recursive: true });
  cpSync(join(REPO, 'tooling', 'app-yaml', 'yaml.mjs'), join(root, 'tooling', 'app-yaml', 'yaml.mjs'));
  const script = join(root, 'tooling', 'release', 'submit-windows-store.mjs');
  mkdirSync(dirname(script), { recursive: true });
  let source = submitter ?? readFileSync(join(REPO, 'tooling', 'release', 'submit-windows-store.mjs'), 'utf8');
  if (dropRefusal) {
    const cut = source.indexOf('  if (SUBMIT) {\n    problems.push(\n      `PLACEHOLDER PACKAGE IDENTITY');
    assert.ok(cut !== -1, 'the placeholder refusal is not where this mutation expects it');
    source = source.slice(0, cut) + '  if (false) {\n    problems.push(\n      `PLACEHOLDER PACKAGE IDENTITY' + source.slice(cut + '  if (SUBMIT) {\n    problems.push(\n      `PLACEHOLDER PACKAGE IDENTITY'.length);
  }
  writeFileSync(script, source);
  writeFileSync(join(root, 'tooling', 'release', 'submit-common.mjs'), readFileSync(join(REPO, 'tooling', 'release', 'submit-common.mjs'), 'utf8'));
  // The guard's own copy must be the one under test, not the fixture's snapshot of it.
  writeFileSync(join(root, 'tooling', 'ci', 'assert-store-identity.mjs'), readFileSync(GUARD, 'utf8'));
  return root;
}

describe('assert-store-identity — Windows: a store-assigned identity, and a placeholder that must be refused', () => {
  test('PRINTS the owner-gated placeholder and exits 0 — because the submitter was run and REFUSED it', () => {
    const { code, out } = run(windowsFixture());
    assert.equal(code, 0, out);
    assert.match(out, /OWNER-GATED \(A-2\) · app "subscriptiontracker" × channel "windows-store" \(windows\): the package identity is the placeholder "PARTNER-CENTER-PENDING"/);
    assert.match(out, /--submit REFUSES it \(run here with no credentials, exit non-zero, refusal named\)/);
    assert.match(out, /3 \(app × platform\) identity\(ies\) compared/);
  });

  test('🔴 MUTATION: FAILS when the submitter no longer refuses the placeholder', () => {
    const { code, out } = run(windowsFixture({ dropRefusal: true }));
    assert.equal(code, 1, out);
    assert.match(out, /still packages the placeholder identity and tooling\/release\/submit-windows-store\.mjs --submit did NOT refuse it by name/);
  });

  test("FAILS when the pubspec packages a different identity from the app's own record", () => {
    const { code, out } = run(windowsFixture({ identity: WIN_REAL.identityName, packaged: 'NikatruFixture.SomethingElse' }));
    assert.equal(code, 1, out);
    assert.match(out, /declares "NikatruFixture\.SomethingElse" and apps\/subscriptiontracker\/app\.yaml stores\.windows-store\.identityName is "NikatruFixture\.SubscriptionTracker"/);
  });

  test('FAILS when an app built for windows declares no stores.windows-store record', () => {
    const { code, out } = run(windowsFixture({ record: false }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/subscriptiontracker\/app\.yaml declares no stores\.windows-store record, and it is the one declaration of the identity Partner Center issued this app/);
  });

  // The state the brick stamps since B4a-2: the account configured, this app's
  // own identity not yet issued. Still owner-gated, and still REFUSED by --submit.
  test("PRINTS a stamped app's sentinel name under a configured account — the submitter was run and REFUSED it", () => {
    const { code, out } = run(windowsFixture({ accountReal: true }));
    assert.equal(code, 0, out);
    assert.match(out, /OWNER-GATED \(A-2\) · app "subscriptiontracker" × channel "windows-store" \(windows\): the package identity is the placeholder "PARTNER-CENTER-PENDING" in both apps\/subscriptiontracker\/app\.yaml and apps\/subscriptiontracker\/pubspec\.yaml/);
  });

  test('a CONFIGURED identity that agrees passes without printing the gap, and is not held to com.nikatru.<slug>', () => {
    const { code, out } = run(windowsFixture({ identity: WIN_REAL.identityName }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /OWNER-GATED/);
    assert.doesNotMatch(out, /canonical form is "com\.nikatru\.subscriptiontracker"/);
  });

  test('FAILS a served row that still packages the placeholder', () => {
    const { code, out } = run(windowsFixture({ served: true }));
    assert.equal(code, 1, out);
    assert.match(out, /the row says served: true and apps\/subscriptiontracker\/pubspec\.yaml still packages the placeholder/);
  });

  test('FAILS when the marked placeholder and the sentinel are two different strings', () => {
    const { code, out } = run(windowsFixture({ placeholderValue: 'PENDING' }));
    assert.equal(code, 1, out);
    assert.match(out, /identity\.placeholderValue is "PENDING" and packageIdentity\.notYetConfiguredSentinel is "PARTNER-CENTER-PENDING"/);
  });

  test('COVERAGE LOST when expectedFrom names a field the guard cannot read', () => {
    const root = windowsFixture();
    const regPath = join(root, 'tooling', 'channel-register.json');
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    reg.channels.find((c) => c.id === 'windows-store').identity.expectedFrom = 'packageIdentity.somethingElse';
    writeFileSync(regPath, JSON.stringify(reg, null, 2));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /the only field this guard knows how to read is "apps\/\{app\}\/app\.yaml stores\.windows-store\.identityName"/);
  });

  test('FAILS a native store channel that declares no identity block — the shape windows-store sat in', () => {
    const register = REGISTER();
    register.channels.push({ id: 'windows-store', kind: 'store', platforms: ['windows'] });
    const { code, out } = run(fixture({ register }));
    assert.equal(code, 1, out);
    assert.match(out, /channel "windows-store" is a store for windows and declares no `identity` block/);
  });

  test('a browser-extension store and a direct channel are not native identity channels', () => {
    const register = REGISTER();
    register.channels.push({ id: 'amo', kind: 'store', platforms: ['firefox'] }, { id: 'windows-direct', kind: 'direct', platforms: ['windows'] });
    const { code, out } = run(fixture({ register }));
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 — THE BRICK STAMPS THE DERIVED SNAP NAME, NOT THE SLUG.
// The snap limb above requires snap-name.txt to EQUAL param-case(app.yaml name).
// The brick stamped `app_id` through mason's paramCase instead, so a freshly
// stamped app built for Linux failed this guard on its first run — MEASURED on a
// probe stamped from 7a102b78 with a linux/ folder: `"probe"` against the derived
// `"probe-s-e-book-co"`. These cases read the BRICK, because the stamp itself
// needs mason and this runner has none: the template must stamp the var pre_gen
// derives, pre_gen must derive it from the same `shortName` post_gen writes as
// app.yaml `name`, and it must refuse what it cannot derive exactly.
// ─────────────────────────────────────────────────────────────────────────────
describe('the app brick stamps the snap name this guard derives', () => {
  const BRICK_REPO = resolve(CI_DIR, '..', '..');
  const brick = (rel) => readFileSync(join(BRICK_REPO, 'tooling', 'bricks', 'app', rel), 'utf8');

  test('the snap-name template stamps pre_gen\'s derived `snap_name` — no case filter over the slug', () => {
    const tpl = brick('__brick__/apps/{{app_id}}/store/linux-snap/snap-name.txt');
    assert.equal(tpl, '{{snap_name}}\n');
    assert.equal(tpl.includes('app_id'), false, 'the slug is not the derivation');
  });

  test('pre_gen derives `snap_name` from `shortName`, the value post_gen writes as app.yaml `name`', () => {
    const pre = brick('hooks/pre_gen.dart');
    const post = brick('hooks/post_gen.dart');
    assert.ok(pre.includes('final String shortName = _shortName(displayName);'), 'shortName is computed in pre_gen');
    assert.ok(pre.includes('final String? snapName = _snapName(shortName);'), 'the snap name is derived from shortName');
    assert.ok(pre.includes("vars['snap_name'] = snapName ?? '';"), 'the derived value is handed to the templates');
    assert.ok(post.includes("name: (v['short_name'] ?? displayName).toString(),"), 'post_gen writes shortName as app.yaml name');
  });

  test('pre_gen REFUSES a title it cannot derive exactly, and says why', () => {
    const pre = brick('hooks/pre_gen.dart');
    assert.ok(pre.includes('if (rune > 0x7f) return null;'), 'a non-ASCII title is refused, not approximated');
    assert.ok(pre.includes('return out.isEmpty ? null : out.toString();'), 'a title with no letter or digit is refused');
    assert.ok(pre.includes('the snap name cannot be derived from the store title'), 'the refusal names the problem');
  });
});
