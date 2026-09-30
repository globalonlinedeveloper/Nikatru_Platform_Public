// ─────────────────────────────────────────────────────────────────────────────
// no-tls-pinning.test.mjs — assert-no-tls-pinning.mjs must be able to FAIL.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Seven mutations against a full COPY of this
// repository, 2026-08-03, all seven caught and all seven restored
// byte-identically with the tree green again:
//
//   1. `client.badCertificateCallback = (cert, host, port) => true;` in
//      packages/api_client/lib/src/rest_client.dart ⇒ exit 1 naming the file
//      and the line. This is the realistic path: four lines, no new dependency.
//   2. THE FALSE-ALARM CASE, and it was written first — the ~22 real lines of
//      Ed25519 pack-KEY pinning under packages/core/lib/src/content/ ([ADR 016],
//      LOCKED and desirable) must not fire. They do not; the passing line says
//      so out loud and counts them.
//   3. `SecurityContext(withTrustedRoots: false)` in the BRICK template ⇒
//      exit 1. The template is the one place a defect is born into every future
//      app at once.
//   4. the same override under `packages/api_client/test/` ⇒ exit 0. Two
//      `implements HttpClientAdapter` fakes really live in this tree and they
//      ship to nobody.
//   5. a COMMENT stating the client never sets badCertificateCallback ⇒ exit 0.
//   6. SCOPE pointed at directories that do not exist ⇒ COVERAGE LOST. An
//      ABSENCE assertion over an empty set is true of every tree, including one
//      where the scan is broken — there is no weaker failure than this one.
//   7. `adapter.onHttpClientCreate = …` in apps/subscriptiontracker/lib/main.dart ⇒ exit 1.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-no-tls-pinning.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-tls-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

function fixture(files) {
  const root = join(TMP, `f${seq++}`);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(root, { recursive: true });
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const CLEAN_CLIENT = `import 'package:dio/dio.dart';

class RestClient {
  RestClient(this._dio);
  final Dio _dio;
  Future<void> get(String path) async => _dio.get(path);
}
`;

/** The real shape of the false-alarm surface: an Ed25519 PACK key, pinned on
 *  purpose, using the word "pinned" nine times. */
const PACK_VERIFIER = `/// The pinned Ed25519 public keys used to verify every remote content pack.
/// Why a map and not one constant (ADR 016): the pinned key is baked into the
/// binary, so rotation needs a release; a map lets a new key be pinned before
/// the old one is retired.
const kContentPackPublicKeys = <String, String>{'k1': 'AAAA'};

/// The pinned public key for [keyId], or null when that key_id is not pinned.
String? pinnedKey(String keyId) => kContentPackPublicKeys[keyId];

/// Whether at least one real pack-signing key has been pinned.
bool get hasPinnedKey => kContentPackPublicKeys.isNotEmpty;
`;

const base = (extra = {}) => ({
  'packages/api_client/lib/src/rest_client.dart': CLEAN_CLIENT,
  'packages/core/lib/src/content/pack_verifier.dart': PACK_VERIFIER,
  'apps/subscriptiontracker/lib/main.dart': 'Future<void> main() async {}\n',
  'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart': 'class App {}\n',
  ...extra,
});

describe('assert-no-tls-pinning', () => {
  test('passes on a tree that overrides no certificate trust — the state today', () => {
    const { code, out } = run(fixture(base()));
    assert.equal(code, 0, out);
    assert.match(out, /shipped \.dart file\(s\) scanned/);
  });

  // ── the false-alarm case, first ───────────────────────────────────────────
  test('the Ed25519 pack-KEY pinning of [ADR 016] does NOT fire, and is counted out loud', () => {
    const { code, out } = run(fixture(base()));
    assert.equal(code, 0, out);
    assert.match(out, /1 pack-verifier file\(s\) in scope and correctly NOT flagged/);
  });

  // ── the failing cases ─────────────────────────────────────────────────────
  test('FAILS on badCertificateCallback in a shipped client', () => {
    const { code, out } = run(
      fixture(
        base({
          'packages/api_client/lib/src/rest_client.dart':
            `${CLEAN_CLIENT}\nvoid trustAll(HttpClient c) {\n  c.badCertificateCallback = (cert, host, port) => true;\n}\n`,
        }),
      ),
    );
    assert.equal(code, 1);
    assert.match(out, /badCertificateCallback/);
    assert.match(out, /Cloudflare Universal SSL auto-renews/);
  });

  test('FAILS on a hand-built SecurityContext in the BRICK template', () => {
    const { code, out } = run(
      fixture(base({ 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart': 'final ctx = SecurityContext(withTrustedRoots: false);\nclass App {}\n' })),
    );
    assert.equal(code, 1);
    assert.match(out, /SecurityContext/);
    assert.match(out, /__brick__/);
  });

  test('FAILS on setTrustedCertificatesBytes', () => {
    const { code, out } = run(
      fixture(base({ 'packages/core/lib/src/net.dart': 'void pin(dynamic ctx, List<int> pem) => ctx.setTrustedCertificatesBytes(pem);\n' })),
    );
    assert.equal(code, 1);
    assert.match(out, /setTrustedCertificates/);
  });

  test('FAILS on onHttpClientCreate', () => {
    const { code, out } = run(
      fixture(base({ 'apps/subscriptiontracker/lib/main.dart': 'void wire(dynamic a) { a.onHttpClientCreate = (c) => c; }\nFuture<void> main() async {}\n' })),
    );
    assert.equal(code, 1);
    assert.match(out, /onHttpClientCreate/);
  });

  // ── what must NOT fire ────────────────────────────────────────────────────
  test('the same override under test/ does not fire — a fake adapter ships to nobody', () => {
    const { code, out } = run(
      fixture(base({ 'packages/api_client/test/rest_client_test.dart': 'void t(HttpClient c) { c.badCertificateCallback = (a, b, p) => true; }\nclass _FakeAdapter {}\n' })),
    );
    assert.equal(code, 0, out);
    assert.match(out, /test double\(s\) excluded by path/);
  });

  test('a COMMENT naming the API does not fire', () => {
    const { code, out } = run(
      fixture(base({ 'packages/api_client/lib/src/rest_client.dart': `// This client never sets badCertificateCallback and builds no SecurityContext.\n${CLEAN_CLIENT}` })),
    );
    assert.equal(code, 0, out);
  });

  test('a pinning PACKAGE is a printed note, never a failure — a blacklist cannot fail on the real path', () => {
    const { code, out } = run(
      fixture(base({ 'packages/api_client/pubspec.yaml': 'name: api_client\ndependencies:\n  http_certificate_pinning: ^2.0.0\n' })),
    );
    assert.equal(code, 0, out);
    assert.match(out, /certificate-pinning dependency/);
  });

  // ── the coverage self-check ───────────────────────────────────────────────
  test('COVERAGE LOST when the scan reaches no Dart at all', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /an absence over an empty set/i);
  });

  test('COVERAGE LOST when every file found is classified as a test double', () => {
    const { code, out } = run(fixture({ 'packages/api_client/test/only_test.dart': 'class X {}\n' }));
    assert.equal(code, 2);
    assert.match(out, /classified as a test double/);
  });

  test('the pack verifier leaving the scan is reported, not silently accepted', () => {
    const files = base();
    delete files['packages/core/lib/src/content/pack_verifier.dart'];
    const { code, out } = run(fixture(files));
    assert.equal(code, 0, out);
    assert.match(out, /LOUDEST false-alarm surface/);
  });

  test('build/ output is not scanned — an unfiltered grep here matches compiled snapshots', () => {
    const { code, out } = run(
      fixture(base({ 'apps/subscriptiontracker/build/web/snapshot.dart': 'x.badCertificateCallback = (a, b, c) => true;\n' })),
    );
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The platform-config limb (rv2-security-016). A pin in Android network security
// config or an Info.plist needs no Dart at all, and passed this guard until
// 2026-09-30.
//
// 🔴 REAL-TREE RUN FIRST, 2026-09-30, in place, each mutation restored before the next:
//   A. apps/subscriptiontracker/android/app/src/main/res/xml/network_security_config.xml
//      with a <pin-set> for nikatru.com ⇒ EXIT 1, naming the file and line 5.
//   B. the main AndroidManifest.xml naming android:networkSecurityConfig=
//      "@xml/network_security_config" with no such file ⇒ EXIT 2.
//   C. NSAppTransportSecurity › NSPinnedDomains added to ios/Runner/Info.plist ⇒ EXIT 1.
//   D. ios/Runner/Info.plist moved away ⇒ EXIT 2 (structural + floor).
//   Green control before and after: EXIT 0, "10 android .xml + 7 ios/macos .plist".
describe('assert-no-tls-pinning · platform config (network security config, Info.plist)', () => {
  const REPO = resolve(CI_DIR, '..', '..');
  const MANIFEST =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application android:label="x">\n  </application>\n</manifest>\n';
  const PLIST =
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>x</string>\n</dict>\n</plist>\n';
  const APP = 'apps/subscriptiontracker';
  const platform = (extra = {}) =>
    base({
      [`${APP}/android/app/src/main/AndroidManifest.xml`]: MANIFEST,
      [`${APP}/ios/Runner/Info.plist`]: PLIST,
      [`${APP}/macos/Runner/Info.plist`]: PLIST,
      ...extra,
    });
  const NSC = (inner) =>
    '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n  <domain-config>\n' +
    `    <domain includeSubdomains="true">nikatru.com</domain>\n${inner}  </domain-config>\n</network-security-config>\n`;
  const PIN_SET = '    <pin-set expiration="2027-01-01">\n      <pin digest="SHA-256">AAAA=</pin>\n    </pin-set>\n';
  const WITH_ATS = (plist, key) =>
    plist.replace('<dict>\n', `<dict>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>${key}</key>\n\t\t<dict/>\n\t</dict>\n`);
  const NSC_MANIFEST = MANIFEST.replace('<application ', '<application android:networkSecurityConfig="@xml/network_security_config" ');

  test('passes on platform config that pins nothing, and says how much it read', () => {
    const { code, out } = run(fixture(platform()));
    assert.equal(code, 0, out);
    assert.match(out, /1 android \.xml \+ 2 ios\/macos \.plist platform-config file\(s\) read/);
  });

  test('🔴 FAILS on a network-security-config <pin-set>', () => {
    const { code, out } = run(fixture(platform({ [`${APP}/android/app/src/main/res/xml/network_security_config.xml`]: NSC(PIN_SET) })));
    assert.equal(code, 1, out);
    assert.match(out, /network_security_config\.xml:5 declares a network-security-config <pin-set>/);
  });

  test('FAILS on a trust anchor compiled in from @raw/', () => {
    const anchor = '    <trust-anchors>\n      <certificates src="@raw/my_ca"/>\n    </trust-anchors>\n';
    const { code, out } = run(fixture(platform({ [`${APP}/android/app/src/main/res/xml/nsc.xml`]: NSC(anchor) })));
    assert.equal(code, 1, out);
    assert.match(out, /trust anchor compiled in from @raw\//);
  });

  test('a system trust anchor and a COMMENTED-OUT pin-set do not fire', () => {
    const ok = `    <trust-anchors>\n      <certificates src="system"/>\n    </trust-anchors>\n    <!--\n${PIN_SET}    -->\n`;
    const { code, out } = run(fixture(platform({ [`${APP}/android/app/src/main/res/xml/nsc.xml`]: NSC(ok) })));
    assert.equal(code, 0, out);
  });

  // One explicit test() per key, never a loop (assert-no-loop-cases).
  const pinnedPlistFails = (key) => () => {
    const { code, out } = run(fixture(platform({ [`${APP}/macos/Runner/Info.plist`]: WITH_ATS(PLIST, key) })));
    assert.equal(code, 1, out);
    assert.match(out, /macos\/Runner\/Info\.plist:\d+ declares an App Transport Security pinned identity/);
  };
  test('🔴 FAILS on NSPinnedDomains in an Info.plist', pinnedPlistFails('NSPinnedDomains'));
  test('FAILS on NSPinnedLeafIdentities in an Info.plist', pinnedPlistFails('NSPinnedLeafIdentities'));
  test('FAILS on NSPinnedCAIdentities in an Info.plist', pinnedPlistFails('NSPinnedCAIdentities'));
  test('FAILS on TSKPinnedDomains (TrustKit) in an Info.plist', pinnedPlistFails('TSKPinnedDomains'));

  test('COVERAGE LOST when an app has an android/ directory and no main AndroidManifest.xml', () => {
    const files = platform({ [`${APP}/android/build.gradle.kts`]: '// gradle\n' });
    delete files[`${APP}/android/app/src/main/AndroidManifest.xml`];
    const { code, out } = run(fixture(files));
    assert.equal(code, 2, out);
    assert.match(out, /android exists and .*AndroidManifest\.xml was not read/);
  });

  test('COVERAGE LOST when an app has an ios/ directory and no Runner/Info.plist', () => {
    const files = platform({ [`${APP}/ios/Podfile`]: '# pods\n' });
    delete files[`${APP}/ios/Runner/Info.plist`];
    const { code, out } = run(fixture(files));
    assert.equal(code, 2, out);
    assert.match(out, /ios exists and .*ios\/Runner\/Info\.plist was not read/);
  });

  test('🔴 COVERAGE LOST when the manifest names a network security config the walk never read', () => {
    const { code, out } = run(fixture(platform({ [`${APP}/android/app/src/main/AndroidManifest.xml`]: NSC_MANIFEST })));
    assert.equal(code, 2, out);
    assert.match(out, /names android:networkSecurityConfig="@xml\/network_security_config" and no res\/xml\/network_security_config\.xml/);
  });

  test('the same manifest with its config present is read, and a pin in that config fires', () => {
    const withNsc = (inner) =>
      platform({
        [`${APP}/android/app/src/main/AndroidManifest.xml`]: NSC_MANIFEST,
        [`${APP}/android/app/src/main/res/xml/network_security_config.xml`]: NSC(inner),
      });
    const clean = run(fixture(withNsc('')));
    assert.equal(clean.code, 0, clean.out);
    const pinned = run(fixture(withNsc(PIN_SET)));
    assert.equal(pinned.code, 1, pinned.out);
  });

  // THE REAL FILES, copied into a fixture, so the suite notices them drifting.
  const real = (rel) => readFileSync(join(REPO, ...rel.split('/')), 'utf8');
  test('🔴 the REAL manifest and Info.plists PASS, and NSPinnedDomains injected into the real ios plist goes RED', () => {
    const files = {
      [`${APP}/android/app/src/main/AndroidManifest.xml`]: real(`${APP}/android/app/src/main/AndroidManifest.xml`),
      [`${APP}/ios/Runner/Info.plist`]: real(`${APP}/ios/Runner/Info.plist`),
      [`${APP}/macos/Runner/Info.plist`]: real(`${APP}/macos/Runner/Info.plist`),
    };
    const green = run(fixture(base(files)));
    assert.equal(green.code, 0, green.out);
    const iosPlist = files[`${APP}/ios/Runner/Info.plist`];
    const pinned = iosPlist.replace(/<dict>/, '<dict>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSPinnedDomains</key>\n\t\t<dict/>\n\t</dict>');
    assert.notEqual(pinned, iosPlist, 'the real Info.plist has no <dict>; re-read this test');
    const red = run(fixture(base({ ...files, [`${APP}/ios/Runner/Info.plist`]: pinned })));
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /ios\/Runner\/Info\.plist:\d+ declares an App Transport Security pinned identity/);
  });
});
