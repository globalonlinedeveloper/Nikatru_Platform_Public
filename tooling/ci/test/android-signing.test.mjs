// ─────────────────────────────────────────────────────────────────────────────
// android-signing.test.mjs — the two halves of the Android release-signing fix
// must both be able to FAIL:
//   tooling/ci/android-signing.mjs        arranges the credential
//   tooling/ci/assert-artifact-signed.mjs reads what actually signed the bundle
//
// 🔬 THESE FIXTURES ARE REAL CRYPTO, NOT STUBS. Every archive below is signed by
// `jarsigner` with a keystore `keytool` generated seconds earlier, and the guard
// reads it with the same `keytool -printcert -jarfile` it uses in CI. That was a
// deliberate choice over committing pre-signed blobs: a blob encodes whatever the
// author believed on the day, and the one thing this guard must get right is what
// a REAL signature looks like.
//
// 📌 THE JDK IS A HARD REQUIREMENT HERE AND THESE TESTS DO NOT SKIP. A skipped
// test is a green tick over work that never ran — the exact defect
// assert-green-means-ran.mjs exists for — so a missing keytool fails loudly.
// GitHub's ubuntu runners ship a JDK with $JAVA_HOME set, and ci.yml's guard lane
// runs there.
//
// ⚠️ RECORDED MUTATIONS AGAINST THE REAL TREE (not against these fixtures) are in
// the PR that introduced them; a fixture agrees with whatever misunderstanding
// wrote it, so it is the regression net and never the proof.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-artifact-signed.mjs');
const PREPARE = join(CI_DIR, 'android-signing.mjs');

/** keytool/jarsigner on PATH, else under $JAVA_HOME/bin — the same resolution
 *  order the guard itself uses, so the test cannot pass against a tool the guard
 *  would not find. */
function jdkTool(name) {
  const candidates = [name];
  if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', name));
  for (const c of candidates) {
    const r = spawnSync(c, ['-help'], { encoding: 'utf8' });
    if (!r.error) return c;
  }
  throw new Error(
    `${name} could not be run (not on PATH, not under $JAVA_HOME/bin). These tests sign real archives; ` +
      'they do not skip, because a skipped signature test is a green tick over a check that never ran.',
  );
}

let TMP;
let KEYTOOL;
let JARSIGNER;
let seq = 0;

/** The certificate SHA-256 of each generated keystore, read back with keytool —
 *  never assumed. */
const fingerprints = new Map();

const PW = 'fixture-password';

function makeKeystore(name, dname, alias) {
  const path = join(TMP, `${name}.keystore`);
  const gen = spawnSync(
    KEYTOOL,
    ['-genkeypair', '-keystore', path, '-storetype', 'PKCS12', '-alias', alias, '-keyalg', 'RSA',
     '-keysize', '2048', '-validity', '3650', '-storepass', PW, '-keypass', PW, '-dname', dname],
    { encoding: 'utf8' },
  );
  assert.equal(gen.status, 0, `keytool -genkeypair failed: ${gen.stdout}${gen.stderr}`);
  const list = spawnSync(KEYTOOL, ['-list', '-v', '-keystore', path, '-storepass', PW, '-alias', alias], { encoding: 'utf8' });
  const fp = `${list.stdout}`.match(/SHA256:\s*([0-9A-F:]+)/)?.[1];
  assert.ok(fp, `could not read the fingerprint back out of ${name}`);
  fingerprints.set(name, fp);
  return path;
}

/** A zip that stands in for an .aab. Signed or not depending on `keystore`. */
function makeArchive(name, keystore, alias) {
  const path = join(TMP, `${name}.aab`);
  copyFileSync(join(TMP, 'unsigned.zip'), path);
  if (keystore === null) return path;
  const r = spawnSync(JARSIGNER, ['-keystore', keystore, '-storepass', PW, '-keypass', PW, path, alias], { encoding: 'utf8' });
  assert.equal(r.status, 0, `jarsigner failed: ${r.stdout}${r.stderr}`);
  return path;
}

before(() => {
  KEYTOOL = jdkTool('keytool');
  JARSIGNER = jdkTool('jarsigner');
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-sign-'));

  // A minimal zip, written by hand so the fixtures need no `jar` binary: one
  // stored (uncompressed) entry, local header + central directory + EOCD.
  writeFileSync(join(TMP, 'unsigned.zip'), minimalZip('hello.txt', 'nikatru fixture'));

  makeKeystore('release', 'CN=Nikatru, OU=Apps, O=NIKATRU, L=Chennai, ST=Tamil Nadu, C=IN', 'subly');
  makeKeystore('other', 'CN=Somebody Else, O=Elsewhere, C=US', 'other');
  // The DN Android Studio and AGP have always generated for a debug keystore.
  makeKeystore('debug', 'CN=Android Debug, O=Android, C=US', 'androiddebugkey');
  // 🔴 A LEGITIMATE RELEASE KEY WHOSE CN STARTS WITH THE DEBUG CN. keytool
  // prints this as `CN="Android Debug, Inc", O=NIKATRU, C=IN` — QUOTED, not
  // backslash-escaped (measured, keytool 17). The debug rule is EXACT EQUALITY
  // on CN, so this is a release key; loosen it to `includes()` or `startsWith()`
  // — the tempting "be lenient" change — and a correct build starts failing.
  // A guard that fires on correct input is the one thing worse than one that
  // misses, and this fixture is what makes that direction testable.
  makeKeystore('comma', 'CN=Android Debug\\, Inc, O=NIKATRU, C=IN', 'comma');

  makeArchive('release-signed', join(TMP, 'release.keystore'), 'subly');
  makeArchive('other-signed', join(TMP, 'other.keystore'), 'other');
  makeArchive('debug-signed', join(TMP, 'debug.keystore'), 'androiddebugkey');
  makeArchive('comma-signed', join(TMP, 'comma.keystore'), 'comma');
  makeArchive('unsigned', null, null);
});

after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

/** A stored-only zip. 30-byte local header, 46-byte central header, 22-byte EOCD. */
function minimalZip(name, body) {
  const n = Buffer.from(name, 'utf8');
  const b = Buffer.from(body, 'utf8');
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of b) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(b.length, 18);
  local.writeUInt32LE(b.length, 22);
  local.writeUInt16LE(n.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(b.length, 20);
  central.writeUInt32LE(b.length, 24);
  central.writeUInt16LE(n.length, 28);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + n.length, 12);
  eocd.writeUInt32LE(local.length + n.length + b.length, 16);
  return Buffer.concat([local, n, b, central, n, eocd]);
}

// ── fixture repository roots ─────────────────────────────────────────────────
const GRADLE = `
val releaseSigningEnv = mapOf(
    "storeFile" to "ANDROID_KEYSTORE_PATH",
    "storePassword" to "ANDROID_KEYSTORE_PASSWORD",
    "keyAlias" to "ANDROID_KEY_ALIAS",
    "keyPassword" to "ANDROID_KEY_PASSWORD",
)
android { defaultConfig { applicationId = "com.nikatru.subly" } }
`;

const SUBMIT_WF = '.github/workflows/submit-play.yml';

function makeRoot({
  pin,
  channelId = 'android-play',
  register = true,
  gradle = GRADLE,
  apps = [{ slug: 'subly' }],
  submissionWorkflow = SUBMIT_WF,
} = {}) {
  const root = join(TMP, `root${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'catalog'), { recursive: true });
  if (register) {
    const row = { id: channelId, signing: { uploadCertificate: { sha256: pin ?? null } } };
    if (submissionWorkflow !== null) row.submission = { workflow: submissionWorkflow };
    writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({ channels: [row] }));
  }
  if (apps !== null) writeFileSync(join(root, 'catalog', 'apps.json'), JSON.stringify(apps));
  if (gradle !== null) {
    mkdirSync(join(root, 'apps', 'subly', 'android', 'app'), { recursive: true });
    writeFileSync(join(root, 'apps', 'subly', 'android', 'app', 'build.gradle.kts'), gradle);
  }
  return root;
}

const out = (r) => `${r.stdout}${r.stderr}`;
const runGuard = (root, artifacts, posture) =>
  spawnSync(process.execPath, [GUARD, ...(root ? ['--repo-root', root] : []), ...artifacts], {
    encoding: 'utf8',
    env: { ...process.env, ANDROID_SIGNING_POSTURE: posture },
  });

// ═════ assert-artifact-signed.mjs ════════════════════════════════════════════
describe('assert-artifact-signed — the happy paths really pass', () => {
  test('a release-signed bundle matching the pin passes', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'release-signed.aab')], 'release-signed');
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /release-signed by the pinned upload certificate/);
  });

  test('a debug-signed bundle on a lane that DECLARED a build proof passes, and says so in capitals', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'debug-signed.aab')], 'debug-signed-build-proof');
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /CANNOT BE UPLOADED TO GOOGLE PLAY/);
  });

  test('two artifacts are both read — the loop does not stop at the first', () => {
    const root = makeRoot({ pin: fingerprints.get('release') });
    const copy = join(TMP, 'release-signed-2.aab');
    copyFileSync(join(TMP, 'release-signed.aab'), copy);
    const r = runGuard(root, [join(TMP, 'release-signed.aab'), copy], 'release-signed');
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /2\/2 artifact\(s\)/);
  });

  test('a real key whose CN merely STARTS WITH the debug CN is a release key, not debug', () => {
    // The false-positive direction. `CN="Android Debug, Inc"` is a legitimate
    // certificate; only EXACT equality on CN keeps it one. Loosening the rule to
    // includes()/startsWith() turns this test red, which is the point of it.
    const r = runGuard(makeRoot({ pin: fingerprints.get('comma') }), [join(TMP, 'comma-signed.aab')], 'release-signed');
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /is DEBUG-SIGNED/);
  });
});

describe('assert-artifact-signed — the debug key is the defect it exists for', () => {
  test('FAILS when the lane arranged signing and the bundle is debug-signed', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'debug-signed.aab')], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is DEBUG-SIGNED/);
    assert.match(out(r), /Gradle did not use them/);
  });

  test('the failure PRINTS the signer DN, so the diagnosis is in the log', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'debug-signed.aab')], 'release-signed');
    assert.match(out(r), /CN=Android Debug, O=Android, C=US/);
  });

  test('FAILS when a key appeared that the lane did NOT arrange', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'release-signed.aab')], 'debug-signed-build-proof');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /a path the lane did not arrange/);
  });

  test('FAILS on an UNSIGNED archive — and keytool exits 0 on one, so the verdict cannot be its status', () => {
    const raw = spawnSync(KEYTOOL, ['-printcert', '-jarfile', join(TMP, 'unsigned.aab')], { encoding: 'utf8' });
    assert.equal(raw.status, 0, 'keytool is expected to exit 0 on an unsigned archive — that is why this guard parses');
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'unsigned.aab')], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no readable JAR \(v1\) signature/);
  });
});

describe('assert-artifact-signed — the fingerprint pin', () => {
  test('FAILS when a DIFFERENT, perfectly valid non-debug key signed the bundle', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'other-signed.aab')], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /not the pinned upload key/);
    assert.match(out(r), /CN=Somebody Else/);
  });

  test('colons and case in the recorded pin are presentation, not identity', () => {
    const flat = fingerprints.get('release').replace(/:/g, '').toLowerCase();
    const r = runGuard(makeRoot({ pin: flat }), [join(TMP, 'release-signed.aab')], 'release-signed');
    assert.equal(r.status, 0, out(r));
  });

  test('a NULL pin passes and PRINTS the gap — an unpinned key is weaker, not broken', () => {
    const r = runGuard(makeRoot({ pin: null }), [join(TMP, 'release-signed.aab')], 'release-signed');
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /NO PINNED FINGERPRINT/);
  });

  test('a MALFORMED pin fails against the record, not against the artifact', () => {
    const r = runGuard(makeRoot({ pin: 'not-a-fingerprint' }), [join(TMP, 'release-signed.aab')], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not a\s+SHA-256/);
  });

  test('the summary never claims a fingerprint comparison that did not happen', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'debug-signed.aab')], 'debug-signed-build-proof');
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /0 fingerprint\(s\) compared/);
  });
});

describe('assert-artifact-signed — coverage self-checks', () => {
  test('COVERAGE LOST when ANDROID_SIGNING_POSTURE is absent', () => {
    const r = spawnSync(process.execPath, [GUARD, '--repo-root', makeRoot({ pin: null }), join(TMP, 'release-signed.aab')], {
      encoding: 'utf8',
      env: { ...process.env, ANDROID_SIGNING_POSTURE: '' },
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /does not know what the lane intended/);
  });

  test('COVERAGE LOST on an unrecognised posture — it is never resolved to a default', () => {
    const r = runGuard(makeRoot({ pin: null }), [join(TMP, 'release-signed.aab')], 'probably-fine');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no artifact path is given at all', () => {
    const r = runGuard(makeRoot({ pin: null }), [], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /evaluated nothing/);
  });

  test('COVERAGE LOST when the register is missing', () => {
    const r = runGuard(makeRoot({ register: false }), [join(TMP, 'release-signed.aab')], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register has no android-play row', () => {
    const r = runGuard(makeRoot({ pin: null, channelId: 'something-else' }), [join(TMP, 'release-signed.aab')], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares no "android-play" channel/);
  });

  test('a missing artifact file is a failure, never a silent skip', () => {
    const r = runGuard(makeRoot({ pin: null }), [join(TMP, 'never-built.aab')], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /does not exist/);
  });

  test('a ZERO-BYTE artifact is a failure — it would spend a version code', () => {
    const empty = join(TMP, 'empty.aab');
    writeFileSync(empty, '');
    const r = runGuard(makeRoot({ pin: null }), [empty], 'release-signed');
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /ZERO bytes/);
  });

  test('the unsigned case reports WHY before reporting that nothing was evaluated', () => {
    const r = runGuard(makeRoot({ pin: null }), [join(TMP, 'unsigned.aab')], 'release-signed');
    const text = out(r);
    assert.ok(
      text.indexOf('no readable JAR (v1) signature') < text.indexOf('NOT ONE yielded'),
      `the diagnosis must precede the coverage line:\n${text}`,
    );
  });

  test('it states what it CANNOT see, so green is not read as "fully checked"', () => {
    const r = runGuard(makeRoot({ pin: fingerprints.get('release') }), [join(TMP, 'release-signed.aab')], 'release-signed');
    assert.match(out(r), /v1 \(JAR\) signatures only/);
  });

  test('without --repo-root the FIRST artifact is still read (the scan-secrets off-by-one)', () => {
    // No --repo-root, so ROOT is the real repository and its real pin applies —
    // which is why this uses the debug-proof posture, where no pin is consulted.
    // If `rootIdx + 1` had been used unguarded, argv[0] would be filtered out and
    // this would report zero artifacts instead of one.
    const r = runGuard(null, [join(TMP, 'debug-signed.aab')], 'debug-signed-build-proof');
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1\/1 artifact\(s\)/);
  });
});

// ═════ android-signing.mjs ═══════════════════════════════════════════════════
const b64Of = (p) => readFileSync(p).toString('base64');

function runPrepare(root, env, { app = 'subly' } = {}) {
  const outDir = join(TMP, `out${seq++}`);
  const ghEnv = join(TMP, `ghenv${seq++}.txt`);
  const r = spawnSync(
    process.execPath,
    [PREPARE, '--app', app, '--repo-root', root, '--out', outDir, '--github-env', ghEnv],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANDROID_KEYSTORE_BASE64: '',
        ANDROID_KEYSTORE_PASSWORD: '',
        ANDROID_KEY_ALIAS: '',
        ANDROID_KEY_PASSWORD: '',
        // Blanked rather than inherited: these tests run INSIDE a GitHub job,
        // where both are set to this repository's own values, and a release-lane
        // derivation that read the surrounding run would answer a question about
        // ci.yml instead of about the fixture.
        GITHUB_REF: '',
        GITHUB_WORKFLOW_REF: '',
        ...env,
      },
    },
  );
  return { r, outDir, ghEnv, exported: existsSync(ghEnv) ? readFileSync(ghEnv, 'utf8') : '' };
}

const FULL = () => ({
  ANDROID_KEYSTORE_BASE64: b64Of(join(TMP, 'release.keystore')),
  ANDROID_KEYSTORE_PASSWORD: PW,
  ANDROID_KEY_ALIAS: 'subly',
  ANDROID_KEY_PASSWORD: PW,
});

/** The two signals that make a lane a release lane, as GitHub sets them. */
const ON_TAG = { GITHUB_REF: 'refs/tags/subly-v1.0.0' };
const ON_SUBMISSION_WF = { GITHUB_WORKFLOW_REF: `globalonlinedeveloper/repo/${SUBMIT_WF}@refs/heads/main` };

describe('android-signing — a release lane is DERIVED, not declared in YAML', () => {
  test('a TAG push requires signing, and says which signal decided it', () => {
    const { r } = runPrepare(makeRoot({}), ON_TAG);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /required because the run is a TAG push/);
    assert.match(out(r), /this is a RELEASE lane/);
  });

  test("the channel's DECLARED submission workflow requires signing", () => {
    const { r } = runPrepare(makeRoot({}), ON_SUBMISSION_WF);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declared submission workflow/);
  });

  test('ANOTHER workflow on a branch does NOT — the build proof stays legal', () => {
    const { r } = runPrepare(makeRoot({}), {
      GITHUB_REF: 'refs/heads/feat/whatever',
      GITHUB_WORKFLOW_REF: 'globalonlinedeveloper/repo/.github/workflows/build-platforms.yml@refs/heads/feat/whatever',
    });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /no release signal/);
  });

  test('the workflow ref is matched on its PATH, so a branch name cannot change the answer', () => {
    const { r } = runPrepare(makeRoot({}), {
      GITHUB_WORKFLOW_REF: `owner/other-repo/${SUBMIT_WF}@refs/tags/whatever`,
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declared submission workflow/);
  });

  test('COVERAGE LOST when the register is gone — the decision would default to "proof is fine"', () => {
    const { r } = runPrepare(makeRoot({ register: false }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the android-play row is gone', () => {
    const { r } = runPrepare(makeRoot({ channelId: 'elsewhere' }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares no "android-play" channel/);
  });

  test('a row with no submission.workflow PRINTS the narrowed derivation rather than hiding it', () => {
    const { r } = runPrepare(makeRoot({ submissionWorkflow: null }), ON_SUBMISSION_WF);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /declares no `submission.workflow`/);
  });
});

describe('android-signing — the three endings', () => {
  test('no secrets on a NON-release lane is a labelled build proof, and passes', () => {
    const { r, exported } = runPrepare(makeRoot({}), {});
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /DEBUG-SIGNED-BUILD-PROOF/);
    assert.match(exported, /ANDROID_SIGNING_POSTURE=debug-signed-build-proof/);
  });

  test('no secrets on a RELEASE lane FAILS and names every secret to create', () => {
    const { r } = runPrepare(makeRoot({}), ON_TAG);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /this is a RELEASE lane and no Android signing secrets are configured/);
    for (const n of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
      assert.match(out(r), new RegExp(n));
    }
  });

  test('HALF a keystore FAILS on EVERY lane, release or not', () => {
    const partial = { ...FULL() };
    delete partial.ANDROID_KEY_ALIAS;
    const { r } = runPrepare(makeRoot({}), partial);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /HALF configured/);
    assert.match(out(r), /missing:\s+ANDROID_KEY_ALIAS/);
  });

  test('all four materialise the keystore BYTE-FOR-BYTE and export five variables', () => {
    const { r, outDir, exported } = runPrepare(makeRoot({}), { ...FULL(), ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    const written = join(outDir, 'subly-upload.keystore');
    assert.ok(existsSync(written), out(r));
    assert.deepEqual(readFileSync(written), readFileSync(join(TMP, 'release.keystore')));
    const names = exported.trim().split('\n').map((l) => l.split('=')[0]).sort();
    assert.deepEqual(names, [
      'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEYSTORE_PATH', 'ANDROID_KEY_ALIAS',
      'ANDROID_KEY_PASSWORD', 'ANDROID_SIGNING_POSTURE',
    ]);
  });

  test('the materialised keystore really SIGNS — the whole chain, not just the bytes', () => {
    const { r, outDir, exported } = runPrepare(makeRoot({}), { ...FULL(), ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    const written = exported.match(/^ANDROID_KEYSTORE_PATH=(.+)$/m)[1];
    const archive = join(outDir, 'chain.aab');
    copyFileSync(join(TMP, 'unsigned.zip'), archive);
    const signed = spawnSync(JARSIGNER, ['-keystore', written, '-storepass', PW, '-keypass', PW, archive, 'subly'], { encoding: 'utf8' });
    assert.equal(signed.status, 0, `${signed.stdout}${signed.stderr}`);
    const g = runGuard(makeRoot({ pin: fingerprints.get('release') }), [archive], 'release-signed');
    assert.equal(g.status, 0, out(g));
  });
});

describe('android-signing — the secret is never printed and never half-written', () => {
  test('neither the password nor the base64 appears anywhere in the output', () => {
    const full = FULL();
    const { r } = runPrepare(makeRoot({}), { ...full, ...ON_TAG });
    const text = out(r);
    assert.doesNotMatch(text, new RegExp(PW));
    assert.ok(!text.includes(full.ANDROID_KEYSTORE_BASE64.slice(0, 40)), 'a fragment of the keystore base64 was printed');
  });

  test('a value carrying a newline is refused BEFORE any key is written to disk', () => {
    const { r, outDir } = runPrepare(makeRoot({}), { ...FULL(), ANDROID_KEY_ALIAS: 'subly\nPATH=/evil' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /contains a line break/);
    assert.ok(!existsSync(join(outDir, 'subly-upload.keystore')), 'a keystore was left on disk by a run that failed');
  });

  test('the keystore is written OUTSIDE the repository tree', () => {
    const root = makeRoot({});
    const { r, exported } = runPrepare(root, { ...FULL(), ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    const written = exported.match(/^ANDROID_KEYSTORE_PATH=(.+)$/m)[1];
    assert.ok(!resolve(written).startsWith(resolve(root)), `${written} is inside ${root} — an upload-artifact glob could reach it`);
  });

  test('an EMPTY $GITHUB_ENV is treated as unset, not as a file named ""', () => {
    // Found by mutation, not by design: `?? null` cannot tell an empty string
    // from an unset variable, and the script crashed with ENOENT AFTER printing
    // a successful posture.
    const r = spawnSync(process.execPath, [PREPARE, '--app', 'subly', '--repo-root', makeRoot({})], {
      encoding: 'utf8',
      env: {
        ...process.env, GITHUB_ENV: '', GITHUB_REF: '', GITHUB_WORKFLOW_REF: '',
        ANDROID_KEYSTORE_BASE64: '', ANDROID_KEYSTORE_PASSWORD: '', ANDROID_KEY_ALIAS: '', ANDROID_KEY_PASSWORD: '',
      },
    });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /NOT EXPORTED/);
    assert.doesNotMatch(out(r), /ENOENT/);
  });

  test('an EMPTY $RUNNER_TEMP does not put the keystore in the CURRENT directory', () => {
    // `resolve('')` is the cwd, which for a CI job is the repository — the one
    // place this file exists to keep a private key out of.
    const ghEnv = join(TMP, `ghenv-rt${seq++}.txt`);
    const r = spawnSync(process.execPath, [PREPARE, '--app', 'subly', '--repo-root', makeRoot({}), '--github-env', ghEnv], {
      encoding: 'utf8',
      cwd: TMP,
      env: { ...process.env, RUNNER_TEMP: '', GITHUB_REF: '', GITHUB_WORKFLOW_REF: '', ...FULL() },
    });
    assert.equal(r.status, 0, out(r));
    const written = readFileSync(ghEnv, 'utf8').match(/^ANDROID_KEYSTORE_PATH=(.+)$/m)[1];
    assert.notEqual(resolve(dirname(written)), resolve(TMP), 'the keystore landed in the working directory');
  });

  test('the exported path is ABSOLUTE — Gradle resolves a relative storeFile elsewhere', () => {
    const { exported } = runPrepare(makeRoot({}), { ...FULL(), ...ON_TAG });
    const written = exported.match(/^ANDROID_KEYSTORE_PATH=(.+)$/m)[1];
    assert.equal(written, resolve(written));
  });
});

describe('android-signing — a secret that is not what it claims to be', () => {
  test('FAILS when the base64 does not round-trip', () => {
    const { r } = runPrepare(makeRoot({}), { ...FULL(), ANDROID_KEYSTORE_BASE64: 'this is not base64 !!!' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not valid base64/);
  });

  test('FAILS on valid base64 of something that is not a keystore', () => {
    const { r } = runPrepare(makeRoot({}), {
      ...FULL(),
      ANDROID_KEYSTORE_BASE64: Buffer.from('<html><body>404</body></html>').toString('base64'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /are not a keystore/);
  });

  test('a JKS magic number is accepted too — the rule is structure, not one format', () => {
    const jks = Buffer.alloc(64);
    jks.writeUInt32BE(0xfeedfeed, 0);
    const { r } = runPrepare(makeRoot({}), { ...FULL(), ANDROID_KEYSTORE_BASE64: jks.toString('base64') });
    assert.equal(r.status, 0, out(r));
  });

  test('base64 with embedded line breaks is accepted — that is how most tools emit it', () => {
    const wrapped = b64Of(join(TMP, 'release.keystore')).replace(/(.{64})/g, '$1\n');
    const { r } = runPrepare(makeRoot({}), { ...FULL(), ANDROID_KEYSTORE_BASE64: wrapped });
    assert.equal(r.status, 0, out(r));
  });
});

describe('android-signing — coverage self-checks', () => {
  test('COVERAGE LOST when the Gradle file is gone', () => {
    const { r } = runPrepare(makeRoot({ gradle: null }), FULL());
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the Gradle signing env map is deleted — the names come from there', () => {
    const { r } = runPrepare(makeRoot({ gradle: 'android { defaultConfig { applicationId = "com.nikatru.subly" } }' }), FULL());
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declares no release-signing environment map/);
  });

  test('COVERAGE LOST when the map has no storeFile key — nothing would point at the keystore', () => {
    const gradle = 'val releaseSigningEnv = mapOf(\n "storePassword" to "ANDROID_KEYSTORE_PASSWORD",\n)\n';
    const { r } = runPrepare(makeRoot({ gradle }), FULL());
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no "storeFile" key/);
  });

  test('COVERAGE LOST when apps.json is missing', () => {
    const { r } = runPrepare(makeRoot({ apps: null }), FULL());
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('an unknown --app fails and lists the apps it knows', () => {
    const { r } = runPrepare(makeRoot({}), FULL(), { app: 'notanapp' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /Known: subly/);
  });

  test('the env-var names really are read from Gradle, not hard-coded here', () => {
    // Rename every variable in the fixture's map. A script carrying its own copy
    // of the list would still see the four ANDROID_* values in the environment
    // and report a complete set; this one must ask for the RENAMED ones.
    const renamed = GRADLE.replace(/ANDROID_/g, 'NEWNAME_');
    const { r } = runPrepare(makeRoot({ gradle: renamed }), FULL());
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /HALF configured/);
    assert.match(out(r), /NEWNAME_KEYSTORE_PASSWORD/);
  });
});
