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
//   7. `adapter.onHttpClientCreate = …` in apps/subly/lib/main.dart ⇒ exit 1.
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
  'apps/subly/lib/main.dart': 'Future<void> main() async {}\n',
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
      fixture(base({ 'apps/subly/lib/main.dart': 'void wire(dynamic a) { a.onHttpClientCreate = (c) => c; }\nFuture<void> main() async {}\n' })),
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
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /an absence over an empty set/i);
  });

  test('COVERAGE LOST when every file found is classified as a test double', () => {
    const { code, out } = run(fixture({ 'packages/api_client/test/only_test.dart': 'class X {}\n' }));
    assert.equal(code, 1);
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
      fixture(base({ 'apps/subly/build/web/snapshot.dart': 'x.badCertificateCallback = (a, b, c) => true;\n' })),
    );
    assert.equal(code, 0, out);
  });
});
