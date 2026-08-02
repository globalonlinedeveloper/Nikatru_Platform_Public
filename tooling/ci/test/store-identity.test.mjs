// ─────────────────────────────────────────────────────────────────────────────
// store-identity.test.mjs — assert-store-identity.mjs and the shared readers in
// read-identity.mjs must be able to FAIL.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Eight mutations against a full COPY of this
// repository, 2026-08-03, all eight caught and restored byte-identically:
//
//   1. `applicationId = "com.nikatru.subly2"` ⇒ exit 1 naming the canonical
//      form. (First attempt MISSED because the mutation hit `namespace =` and
//      not `applicationId =` — a defect in the MUTATION, diagnosed rather than
//      accepted, which is the rule this repo has written down twice.)
//   2. THE SHARPEST CASE: the Linux `set(APPLICATION_ID …)` line DELETED ⇒
//      exit 1. Windows was green on having no identity at all for weeks, so an
//      absent identity must never read like a correct one.
//   3. the Linux id changed to `com.example.subly` ⇒ exit 1. Nothing in this
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  readGradleApplicationId,
  readAppleBundleId,
  readCMakeApplicationId,
  readMsixIdentityName,
  resolveIdentity,
} from '../read-identity.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-store-identity.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ident-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const REGISTER = () => ({
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
    },
  ],
});

function fixture({ register = REGISTER(), apps = [{ slug: 'subly', platforms: ['web'] }], files = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  const write = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('sites/_shared/_data/apps.json', JSON.stringify(apps, null, 2));
  const defaults = {
    'apps/subly/android/app/build.gradle.kts': 'android {\n    namespace = "com.nikatru.subly"\n    defaultConfig {\n        applicationId = "com.nikatru.subly"\n    }\n}\n',
    'apps/subly/linux/CMakeLists.txt': 'cmake_minimum_required(VERSION 3.13)\nset(APPLICATION_ID "com.nikatru.subly")\n',
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
    const r = readGradleApplicationId('android {\n  namespace = "com.other.thing"\n  applicationId = "com.nikatru.subly"\n}', 'g');
    assert.equal(r.value, 'com.nikatru.subly');
  });

  test('gradle: no applicationId is MISSING, and the message says why it cannot wait', () => {
    const r = readGradleApplicationId('android { namespace = "x" }', 'g');
    assert.equal(r.value, null);
    assert.match(r.missing, /Play binds the package name PERMANENTLY at the first upload/);
  });

  test('apple: TEST bundles are dropped EXPLICITLY, not by taking the first match', () => {
    const text = 'PRODUCT_BUNDLE_IDENTIFIER = com.nikatru.subly.RunnerTests;\nPRODUCT_BUNDLE_IDENTIFIER = com.nikatru.subly;\n';
    assert.equal(readAppleBundleId(text, 'p').value, 'com.nikatru.subly');
  });

  test('apple: ONLY test bundles is MISSING — there is nothing to submit under', () => {
    const r = readAppleBundleId('PRODUCT_BUNDLE_IDENTIFIER = com.nikatru.subly.RunnerTests;', 'p');
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
    assert.equal(readCMakeApplicationId('set(APPLICATION_ID "com.nikatru.subly")', 'c').value, 'com.nikatru.subly');
  });

  test('cmake: no APPLICATION_ID is MISSING — the one nothing compared before D-3', () => {
    const r = readCMakeApplicationId('project(runner LANGUAGES CXX)', 'c');
    assert.match(r.missing, /the id GTK registers the application under/);
  });

  test('msix: reads identity_name out of the msix_config block', () => {
    const y = 'name: subly\nmsix_config:\n  display_name: Subly\n  identity_name: NIKATRU.Subly\n';
    assert.equal(readMsixIdentityName(y, 'p').value, 'NIKATRU.Subly');
  });

  test('msix: no msix_config block is MISSING', () => {
    assert.match(readMsixIdentityName('name: subly\n', 'p').missing, /no `msix_config:` block/);
  });

  test('resolveIdentity: an unknown kind is LOST, never a silent skip', () => {
    const r = resolveIdentity(TMP, 'subly', { kind: 'invented', declaredIn: 'apps/{app}/x' });
    assert.match(r.lost, /has no reader/);
  });

  test('resolveIdentity: a declaredIn with no {app} is LOST', () => {
    const r = resolveIdentity(TMP, 'subly', { kind: 'gradle-application-id', declaredIn: 'apps/subly/x' });
    assert.match(r.lost, /is not an "\{app\}" template/);
  });
});

describe('assert-store-identity', () => {
  test('PASSES when every declared platform resolves to com.nikatru.<slug>', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /2 \(app × platform\) identity\(ies\) compared/);
  });

  test('FAILS on an Android package name that is not the canonical form', () => {
    const { code, out } = run(
      fixture({
        files: {
          'apps/subly/android/app/build.gradle.kts':
            'android {\n    namespace = "com.nikatru.subly"\n    defaultConfig {\n        applicationId = "com.nikatru.subly2"\n    }\n}\n',
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /declares "com\.nikatru\.subly2" and architecture §24's canonical form is "com\.nikatru\.subly"/);
    assert.match(out, /Two platforms disagreeing is two apps/);
  });

  // THE SHARPEST CASE — absence must not read as agreement.
  test('FAILS when the Linux APPLICATION_ID is gone — absence is not agreement', () => {
    const { code, out } = run(fixture({ files: { 'apps/subly/linux/CMakeLists.txt': 'project(runner LANGUAGES CXX)\n' } }));
    assert.equal(code, 1);
    assert.match(out, /declares no `APPLICATION_ID`/);
  });

  test('FAILS when the platform folder exists and its identity FILE does not', () => {
    const { code, out } = run(fixture({ files: { 'apps/subly/linux/CMakeLists.txt': null, 'apps/subly/linux/main.cc': 'int main(){}' } }));
    assert.equal(code, 1);
    assert.match(out, /The platform folder is there, so this app IS built for it/);
  });

  // The relationship, and the direction that keeps it from firing on correct input.
  test('a web-only app with NO platform folders is not failing to declare anything', () => {
    const { code, out } = run(
      fixture({
        apps: [{ slug: 'subly', platforms: ['web'] }, { slug: 'probe2', platforms: ['web'] }],
        files: { 'apps/probe2/pubspec.yaml': 'name: probe2\n' },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /skipped for having no platform folder/);
  });

  test('a catalogue entry with no app on disk is PRINTED, not judged', () => {
    const { code, out } = run(fixture({ apps: [{ slug: 'subly' }, { slug: 'ghost' }] }));
    assert.equal(code, 0, out);
    assert.match(out, /lists "ghost" and apps\/ghost is not on disk/);
  });

  test('FAILS on a catalogue entry with no slug', () => {
    const { code, out } = run(fixture({ apps: [{ slug: 'subly' }, { name: 'nameless' }] }));
    assert.equal(code, 1);
    assert.match(out, /carries an entry with no `slug`/);
  });

  // ── coverage self-checks ──────────────────────────────────────────────────
  test('COVERAGE LOST when the catalogue is empty', () => {
    const { code, out } = run(fixture({ apps: [] }));
    assert.equal(code, 1);
    assert.match(out, /lists no app/);
  });

  test('COVERAGE LOST when no register row declares an identity', () => {
    const register = REGISTER();
    for (const c of register.channels) delete c.identity;
    const { code, out } = run(fixture({ register }));
    assert.equal(code, 1);
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
    const { code, out } = run(fixture({ register, files: { 'apps/subly/ios/project.pbxproj': '// empty\n' } }));
    assert.equal(code, 1);
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
    assert.equal(code, 1);
    assert.match(out, /produced ZERO comparisons/);
  });

  test('COVERAGE LOST when the register is not there', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});
