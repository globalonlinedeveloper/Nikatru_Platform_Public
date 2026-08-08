// ─────────────────────────────────────────────────────────────────────────────
// appimage-signing.test.mjs — tooling/ci/appimage-signing.mjs must be able to FAIL.
//
// 🔬 THE KEYS HERE ARE REAL CRYPTO, NOT STUBS. Every keypair below comes from
// node's own `generateKeyPairSync('ed25519')`, the seeds are the real 32 bytes
// pulled out of a real PKCS#8 export, and the guard derives the public half the
// same way it does in CI. That is a deliberate choice over committing a
// pre-generated blob: a blob encodes whatever the author believed on the day,
// and the one thing this seam must get right is what a REAL Ed25519 key looks
// like in each of the three forms a correctly produced secret can take.
//
// 📌 WHAT IS A FIXTURE, SAID PLAINLY. `openssl pkeyutl -verify` output is
// TRANSCRIBED, not captured — openssl may not exist on the machine running this,
// and the guard's own header says the parser has been exercised against fixtures
// only. A fixture agrees with whatever misunderstanding wrote it, so it is the
// regression net and never the proof. The pin comparison, by contrast, is real
// and needs no tool at all: for Ed25519 the public key is DERIVED from the
// private one, so "is this the key we pinned?" is answered in-process.
//
// ⚠️ ONE TEST BRANCHES ON WHETHER openssl IS PRESENT, and it asserts something
// in BOTH branches — that the tool is used and the artifact really signs, or
// that the absence is reported and nothing is claimed. A test that skipped would
// be a green tick over a check that never ran, which is the defect
// assert-green-means-ran.mjs exists for.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  ALGORITHM,
  B64_ENV,
  CHANNEL_ID,
  KEY_PATH_ENV,
  POSTURE_ENV,
  PUB_PATH_ENV,
  RELEASE_SIGNED,
  SEED_BYTES,
  UNSIGNED_PROOF,
  buildSignCommand,
  buildVerifyCommand,
  classifyPublicKeyPin,
  comparePublicKey,
  decideRelease,
  decideSecretSet,
  decodeSigningKey,
  derivePublicKeyBase64,
  parseOpensslVerify,
  pinVerdict,
} from '../appimage-signing.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CI_DIR, '..', '..');
const PREPARE = join(CI_DIR, 'appimage-signing.mjs');

const SENTINEL = 'APPIMAGE-SIGNING-KEY-NOT-GENERATED';
const SUBMIT_WF = '.github/workflows/submit-appimage.yml';

let TMP;
let seq = 0;

/** A real Ed25519 keypair, reduced to every form a secret could legitimately
 *  carry it in. Nothing here is transcribed. */
function makeKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync(ALGORITHM);
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey,
    publicKey,
    seedB64: pkcs8.subarray(pkcs8.length - SEED_BYTES).toString('base64'),
    pkcs8B64: pkcs8.toString('base64'),
    pemPrivate: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicB64: spki.subarray(spki.length - SEED_BYTES).toString('base64'),
  };
}

let KEY;
let OTHER;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-appimage-'));
  KEY = makeKeypair();
  OTHER = makeKeypair();
});
after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

// ── fixture repository roots ─────────────────────────────────────────────────
function makeRoot({
  pin = SENTINEL,
  sentinel = SENTINEL,
  signingPublicKey,
  algorithm = ALGORITHM,
  channelId = CHANNEL_ID,
  register = true,
  names = [B64_ENV],
  apps = [{ slug: 'subly' }],
  submissionWorkflow = null,
} = {}) {
  const root = join(TMP, `root${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'sites', '_shared', '_data'), { recursive: true });
  if (register) {
    const spk =
      signingPublicKey === undefined
        ? { notYetConfiguredSentinel: sentinel, algorithm, publicKeyBase64: pin }
        : signingPublicKey;
    const row = {
      id: channelId,
      kind: 'direct',
      signing: {
        keyKind: 'own-signing-key',
        custody: 'does not exist — no store gatekeeper verifies this one.',
        restoreDrill: { date: null, required: true, note: 'No key generated.' },
        signingPublicKey: spk,
        ciSecrets: names === null ? undefined : { names },
      },
    };
    if (submissionWorkflow !== null) row.submission = { workflow: submissionWorkflow };
    writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({ channels: [row] }));
  }
  if (apps !== null) writeFileSync(join(root, 'sites', '_shared', '_data', 'apps.json'), JSON.stringify(apps));
  return root;
}

const out = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`;

function runPrepare(root, env = {}, { app = 'subly', args = [] } = {}) {
  const outDir = join(TMP, `out${seq++}`);
  const ghEnv = join(TMP, `ghenv${seq++}.txt`);
  const r = spawnSync(
    process.execPath,
    [PREPARE, '--app', app, '--repo-root', root, '--out', outDir, '--github-env', ghEnv, ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        [B64_ENV]: '',
        GITHUB_REF: '',
        GITHUB_WORKFLOW_REF: '',
        ...env,
      },
    },
  );
  return { r, outDir, ghEnv, exported: existsSync(ghEnv) ? readFileSync(ghEnv, 'utf8') : '' };
}

const ON_TAG = { GITHUB_REF: 'refs/tags/subly-v1.0.0' };

// ═════ the decision law ══════════════════════════════════════════════════════
describe('appimage-signing · the secret-set law', () => {
  test('the register declares ONE secret today, so all/none are the only reachable states', () => {
    assert.equal(decideSecretSet([B64_ENV], {}).state, 'none');
    assert.equal(decideSecretSet([B64_ENV], { [B64_ENV]: 'x' }).state, 'all');
  });

  test('an EMPTY STRING is not a value', () => {
    assert.equal(decideSecretSet([B64_ENV], { [B64_ENV]: '   ' }).state, 'none');
  });

  test('🔴 the HALF branch is reachable the moment the REGISTER declares a second name — which is why it is kept', () => {
    // The law is derived from the register's list, not from a constant here. A
    // future row that adds a passphrase, a key id or a separate public-key
    // transport produces exactly this input.
    const s = decideSecretSet([B64_ENV, 'APPIMAGE_SIGNING_KEY_PASSPHRASE'], { [B64_ENV]: 'x' });
    assert.equal(s.state, 'partial');
    assert.deepEqual(s.missing, ['APPIMAGE_SIGNING_KEY_PASSPHRASE']);
  });
});

describe('appimage-signing · a release lane is DERIVED, not declared in YAML', () => {
  test('a TAG push requires signing', () => {
    assert.equal(decideRelease({ gitRef: 'refs/tags/subly-v1.0.0' }).required, true);
  });
  test('a branch push does not', () => {
    assert.equal(decideRelease({ gitRef: 'refs/heads/main' }).required, false);
  });
  test('a DECLARED submission workflow does, matched on its PATH', () => {
    const d = decideRelease({ workflowRef: `owner/x/${SUBMIT_WF}@refs/heads/main`, submissionWorkflow: SUBMIT_WF });
    assert.equal(d.required, true);
  });
  test('the REAL row declares none, and the blind spot is printed rather than assumed away', () => {
    assert.match(decideRelease({ workflowRef: 'owner/x/.github/workflows/ci.yml@main' }).blind.join(' '), /declares no `submission\.workflow`/);
  });
});

describe('appimage-signing · the public-key pin classification', () => {
  test('the row as PR #202 records it TODAY classifies as a sentinel', () => {
    const p = classifyPublicKeyPin({ notYetConfiguredSentinel: SENTINEL, publicKeyBase64: SENTINEL, algorithm: ALGORITHM });
    assert.equal(p.kind, 'sentinel');
  });

  test('a real 32-byte public key classifies as ed25519', () => {
    const p = classifyPublicKeyPin({ publicKeyBase64: KEY.publicB64 });
    assert.equal(p.kind, ALGORITHM);
    assert.equal(p.value, KEY.publicB64);
  });

  test('null is "absent"', () => {
    assert.equal(classifyPublicKeyPin({ publicKeyBase64: null }).kind, 'absent');
    assert.equal(classifyPublicKeyPin(undefined).kind, 'absent');
  });

  test('🔴 base64 of the WRONG LENGTH is malformed, not "close enough"', () => {
    const p = classifyPublicKeyPin({ publicKeyBase64: Buffer.alloc(31).toString('base64') });
    assert.equal(p.kind, 'malformed');
    assert.match(p.why, /31 byte/);
  });

  test('text that is not base64 at all is malformed', () => {
    assert.equal(classifyPublicKeyPin({ publicKeyBase64: 'not base64 !!!' }).kind, 'malformed');
  });
});

describe('appimage-signing · 🔴 the sentinel rule', () => {
  test('a SENTINEL pin with a RELEASE-SIGNED posture is FATAL', () => {
    const v = pinVerdict(classifyPublicKeyPin({ notYetConfiguredSentinel: SENTINEL, publicKeyBase64: SENTINEL }), RELEASE_SIGNED);
    assert.ok(v.fatal);
    assert.match(v.fatal, /placeholder/);
    assert.match(v.fatal, /comparing NOTHING/);
  });

  test('the same sentinel with an UNSIGNED-PROOF posture is PRINTED, never fatal', () => {
    const v = pinVerdict(classifyPublicKeyPin({ notYetConfiguredSentinel: SENTINEL, publicKeyBase64: SENTINEL }), UNSIGNED_PROOF);
    assert.equal(v.fatal, null);
    assert.match(v.print, /which is correct/);
  });

  test('a malformed pin under a release posture is fatal and says what was wrong with it', () => {
    const v = pinVerdict(classifyPublicKeyPin({ publicKeyBase64: Buffer.alloc(10).toString('base64') }), RELEASE_SIGNED);
    assert.match(v.fatal, /10 byte/);
  });

  test('an ABSENT pin passes and PRINTS the gap', () => {
    const v = pinVerdict(classifyPublicKeyPin({ publicKeyBase64: null }), RELEASE_SIGNED);
    assert.equal(v.fatal, null);
    assert.match(v.print, /NO PINNED PUBLIC KEY/);
  });

  test('a REAL pin under a release posture says nothing — the guard must not fire on correct input', () => {
    const v = pinVerdict(classifyPublicKeyPin({ publicKeyBase64: KEY.publicB64 }), RELEASE_SIGNED);
    assert.equal(v.fatal, null);
    assert.equal(v.print, null);
  });
});

describe('appimage-signing · decoding the secret', () => {
  test('the raw 32-byte seed — what the register describes — is accepted', () => {
    const d = decodeSigningKey(KEY.seedB64);
    assert.equal(d.form, 'raw-seed');
    assert.equal(derivePublicKeyBase64(d.key), KEY.publicB64);
  });

  test('an already-wrapped PKCS#8 DER is accepted, and derives to the SAME public key', () => {
    const d = decodeSigningKey(KEY.pkcs8B64);
    assert.equal(d.form, 'pkcs8-der');
    assert.equal(derivePublicKeyBase64(d.key), KEY.publicB64);
  });

  test('a PEM pasted whole is accepted, and derives to the SAME public key', () => {
    const d = decodeSigningKey(KEY.pemPrivate);
    assert.equal(d.form, 'pem');
    assert.equal(derivePublicKeyBase64(d.key), KEY.publicB64);
  });

  test('base64 with embedded line breaks is accepted — that is how most tools emit it', () => {
    assert.equal(derivePublicKeyBase64(decodeSigningKey(KEY.seedB64.replace(/(.{8})/g, '$1\n')).key), KEY.publicB64);
  });

  test('an empty value is refused', () => {
    assert.throws(() => decodeSigningKey('   '), /empty/);
  });

  test('text that is not base64 is refused', () => {
    assert.throws(() => decodeSigningKey('this is not base64 !!!'), /not valid base64/);
  });

  test('valid base64 of the WRONG LENGTH is refused, naming what was found', () => {
    assert.throws(() => decodeSigningKey(Buffer.alloc(20).toString('base64')), /20 byte\(s\)/);
  });

  test('valid base64 of an HTML error page is refused', () => {
    assert.throws(() => decodeSigningKey(Buffer.from('<html><body>404</body></html>').toString('base64')), /neither a 32-byte/);
  });

  test('🔴 a PEM carrying the WRONG ALGORITHM is refused rather than reinterpreted', () => {
    const { privateKey } = generateKeyPairSync('ed448');
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    assert.throws(() => decodeSigningKey(pem), /not ed25519/);
  });

  test('the PUBLIC key pasted into the secret by mistake is refused — it is 32 bytes but not a private key', () => {
    // A raw 32-byte public key decodes to the right LENGTH, so this is the case
    // a length check alone cannot catch: it is accepted as a seed, and the key it
    // derives is NOT the pinned one. That is what comparePublicKey is for.
    const d = decodeSigningKey(KEY.publicB64);
    assert.notEqual(derivePublicKeyBase64(d.key), KEY.publicB64);
    assert.ok(comparePublicKey(derivePublicKeyBase64(d.key), classifyPublicKeyPin({ publicKeyBase64: KEY.publicB64 })));
  });
});

describe('appimage-signing · the pin comparison', () => {
  test('the right key passes', () => {
    assert.equal(comparePublicKey(KEY.publicB64, classifyPublicKeyPin({ publicKeyBase64: KEY.publicB64 })), null);
  });

  test('🔴 a DIFFERENT, perfectly valid key is refused, and BOTH keys are named', () => {
    const problem = comparePublicKey(OTHER.publicB64, classifyPublicKeyPin({ publicKeyBase64: KEY.publicB64 }));
    assert.ok(problem);
    assert.match(problem, /NOT the half of the pinned public key/);
    assert.ok(problem.includes(KEY.publicB64));
    assert.ok(problem.includes(OTHER.publicB64));
  });

  test('with NO pin the comparison is skipped rather than faked', () => {
    assert.equal(comparePublicKey(OTHER.publicB64, classifyPublicKeyPin({ publicKeyBase64: null })), null);
  });
});

describe('appimage-signing · the constructed commands', () => {
  test('the sign command uses -rawin, which is Ed25519\'s path through pkeyutl', () => {
    const c = buildSignCommand({ keyPath: '/t/k.pem', artifact: '/t/subly.AppImage' });
    assert.deepEqual(c.args.slice(0, 2), ['pkeyutl', '-sign']);
    assert.ok(c.args.includes('-rawin'));
    assert.equal(c.signaturePath, '/t/subly.AppImage.sig');
  });

  test('the verify command uses the PUBLIC key, never the private one', () => {
    const c = buildVerifyCommand({ publicKeyPath: '/t/k.pub.pem', artifact: '/t/subly.AppImage' });
    assert.ok(c.args.includes('-pubin'));
    assert.equal(c.args[c.args.indexOf('-inkey') + 1], '/t/k.pub.pem');
    assert.ok(c.args.includes('-sigfile'));
  });

  test('both refuse to build a command with nothing to act on', () => {
    assert.throws(() => buildSignCommand({ keyPath: '/t/k.pem' }), /artifact/);
    assert.throws(() => buildVerifyCommand({ artifact: 'x' }), /publicKeyPath/);
  });
});

describe('appimage-signing · the verify-output parser', () => {
  test('a verified signature is read as verified', () => {
    const p = parseOpensslVerify('Signature Verified Successfully\n');
    assert.deepEqual(p, { recognised: true, verified: true });
  });

  test('🔴 a FAILED verification is read as a failure — the parser, not an exit code, is what says so', () => {
    const p = parseOpensslVerify('Signature Verification Failure\n');
    assert.equal(p.recognised, true);
    assert.equal(p.verified, false);
  });

  test('🔴 UNRECOGNISED output is not a pass AND not a plausible-looking failure', () => {
    // An UNSIGNED artifact makes openssl complain about the missing sigfile, and
    // that text says nothing about a signature at all. Reading it as "not
    // verified" would hide a parser that had stopped understanding the tool.
    const p = parseOpensslVerify('Could not open file or uri for loading signature file: subly.AppImage.sig');
    assert.equal(p.recognised, false);
    assert.equal(p.verified, false);
  });

  test('empty output is unrecognised', () => {
    assert.equal(parseOpensslVerify('').recognised, false);
    assert.equal(parseOpensslVerify(null).recognised, false);
  });
});

// ═════ the endings, as a real subprocess ═════════════════════════════════════
describe('appimage-signing · the three endings', () => {
  test('no secret on a NON-release lane is a labelled build proof, and passes', () => {
    const { r, exported } = runPrepare(makeRoot({}), {});
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /UNSIGNED-BUILD-PROOF/);
    assert.match(exported, new RegExp(`${POSTURE_ENV}=${UNSIGNED_PROOF}`));
  });

  test('the unsigned ending names all THREE owner obligations, and reads the drill out of the register', () => {
    const { r } = runPrepare(makeRoot({}), {});
    assert.match(out(r), /OWNER ITEM/);
    assert.match(out(r), /GENERATE the keypair/);
    assert.match(out(r), /CUSTODY/);
    assert.match(out(r), /RESTORE/);
    assert.match(out(r), /restoreDrill\.required=true/);
    assert.match(out(r), /a backup nobody has restored from is a belief/);
  });

  test('🔴 a TAG PUSH with NO secret FAILS, and names the secret to create', () => {
    const { r } = runPrepare(makeRoot({}), ON_TAG);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /this is a RELEASE lane and no AppImage signing key is configured/);
    assert.match(out(r), new RegExp(B64_ENV));
  });

  test('the tag-push failure explains WHY an unsigned AppImage is worse here than elsewhere', () => {
    const { r } = runPrepare(makeRoot({}), ON_TAG);
    assert.match(out(r), /ENTIRE provenance story/);
    assert.match(out(r), /anonymous binary on a CDN/);
  });

  test('the declared submission workflow is also a release trigger', () => {
    const { r } = runPrepare(makeRoot({ submissionWorkflow: SUBMIT_WF }), {
      GITHUB_WORKFLOW_REF: `owner/repo/${SUBMIT_WF}@refs/heads/main`,
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /declared submission workflow/);
  });

  test('🔴 HALF the secrets FAILS — with a register row declaring two names, which is the shape a passphrase would add', () => {
    const { r } = runPrepare(makeRoot({ names: [B64_ENV, 'APPIMAGE_SIGNING_KEY_PASSPHRASE'], pin: KEY.publicB64 }), {
      [B64_ENV]: KEY.seedB64,
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /HALF configured/);
    assert.match(out(r), /APPIMAGE_SIGNING_KEY_PASSPHRASE/);
  });

  test('🔴 the secret against the SENTINEL pin FAILS, and nothing is written to disk', () => {
    const { r, outDir } = runPrepare(makeRoot({ pin: SENTINEL }), { [B64_ENV]: KEY.seedB64 });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /THE PUBLIC-KEY PIN AND THE POSTURE DISAGREE/);
    assert.match(out(r), /APPIMAGE-SIGNING-KEY-NOT-GENERATED/);
    assert.ok(!existsSync(join(outDir, 'subly-appimage-signing.pem')), 'a private key was left on disk by a run that failed');
  });

  test('🔴 a DIFFERENT valid key against a REAL pin FAILS before anything is written', () => {
    const { r, outDir } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: OTHER.seedB64 });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /not the pinned one/);
    assert.ok(!existsSync(join(outDir, 'subly-appimage-signing.pem')), 'a private key was left on disk by a run that failed');
  });

  test('the RIGHT key against a REAL pin materialises both halves and exports three variables', () => {
    const { r, outDir, exported } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64, ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    const priv = join(outDir, 'subly-appimage-signing.pem');
    const pub = join(outDir, 'subly-appimage-signing.pub.pem');
    assert.ok(existsSync(priv), out(r));
    assert.ok(existsSync(pub), out(r));
    // The materialised private key really is the one that was supplied.
    assert.equal(derivePublicKeyBase64(createPrivateKey(readFileSync(priv, 'utf8'))), KEY.publicB64);
    assert.equal(
      createPublicKey(readFileSync(pub, 'utf8')).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64'),
      KEY.publicB64,
    );
    const names = exported.trim().split('\n').map((l) => l.split('=')[0]).sort();
    assert.deepEqual(names, [KEY_PATH_ENV, POSTURE_ENV, PUB_PATH_ENV].sort());
  });

  test('the round-trip proof runs and is reported — the materialised key really signs', () => {
    const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64, ...ON_TAG });
    assert.match(out(r), /round-trip proof/);
    assert.match(out(r), /it verified/);
  });

  test('an all-three form of the same key produces the same outcome — pkcs8 and pem too', () => {
    for (const [label, secret] of [['pkcs8', KEY.pkcs8B64], ['pem', KEY.pemPrivate]]) {
      const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: secret, ...ON_TAG });
      assert.equal(r.status, 0, `${label}: ${out(r)}`);
      assert.match(out(r), new RegExp(RELEASE_SIGNED.toUpperCase()));
    }
  });

  test('the printed commands name openssl pkeyutl for both halves', () => {
    const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64, ...ON_TAG });
    assert.match(out(r), /openssl pkeyutl -sign/);
    assert.match(out(r), /openssl pkeyutl -verify -pubin/);
  });

  test('🔴 with NO artifact, the run NEVER claims a signature was produced', () => {
    const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64, ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /SIGNATURES NOT PRODUCED/);
    assert.match(out(r), /constructed, not executed/);
    assert.doesNotMatch(out(r), /artifact\(s\) signed and verified/);
  });
});

describe('appimage-signing · execution is guarded on the tool, and asserts in BOTH branches', () => {
  test('with an --artifact, either openssl signs it for real or the absence is reported — never a silent claim', () => {
    const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
    const hasOpenssl = !probe.error && probe.status === 0;

    const artifact = join(TMP, `subly-${seq++}.AppImage`);
    writeFileSync(artifact, Buffer.alloc(4096, 0x5a));
    const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64, ...ON_TAG }, { args: ['--artifact', artifact] });

    if (hasOpenssl) {
      assert.equal(r.status, 0, out(r));
      assert.match(out(r), /1\/1 artifact\(s\) signed and verified/);
      assert.ok(existsSync(`${artifact}.sig`), 'the detached signature was not written next to the artifact');
    } else {
      assert.equal(r.status, 0, out(r));
      assert.match(out(r), /SIGNATURES NOT PRODUCED — openssl could not be run/);
      assert.ok(!existsSync(`${artifact}.sig`), 'a signature appeared without a tool to produce it');
    }
  });

  test('a MISSING artifact is a failure, never a silent skip', () => {
    const { r } = runPrepare(
      makeRoot({ pin: KEY.publicB64 }),
      { [B64_ENV]: KEY.seedB64, ...ON_TAG },
      { args: ['--artifact', join(TMP, 'never-built.AppImage')] },
    );
    const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) {
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /does not exist/);
    } else {
      // Without openssl the loop is not entered at all, and the run must say so
      // rather than reporting a verified artifact.
      assert.match(out(r), /SIGNATURES NOT PRODUCED/);
    }
  });
});

describe('appimage-signing · the secret is never printed and never half-written', () => {
  test('no fragment of the private secret appears in the output', () => {
    const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64, ...ON_TAG });
    assert.ok(!out(r).includes(KEY.seedB64), 'the private seed was printed');
    assert.ok(!out(r).includes(KEY.seedB64.slice(0, 16)), 'a fragment of the private seed was printed');
  });

  test('the PUBLIC key IS printed — it is not a secret, and the pin is worthless if nobody can read it', () => {
    const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64, ...ON_TAG });
    assert.ok(out(r).includes(KEY.publicB64));
  });

  test('the key is written OUTSIDE the repository tree, at an absolute path', () => {
    const root = makeRoot({ pin: KEY.publicB64 });
    const { r, exported } = runPrepare(root, { [B64_ENV]: KEY.seedB64, ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    const written = exported.match(new RegExp(`^${KEY_PATH_ENV}=(.+)$`, 'm'))[1];
    assert.ok(!resolve(written).startsWith(resolve(root)), `${written} is inside ${root} — an upload-artifact glob could reach it`);
    assert.equal(written, resolve(written));
  });

  test('an EMPTY $RUNNER_TEMP does not put the private key in the CURRENT directory', () => {
    const ghEnv = join(TMP, `ghenv-rt${seq++}.txt`);
    const r = spawnSync(
      process.execPath,
      [PREPARE, '--app', 'subly', '--repo-root', makeRoot({ pin: KEY.publicB64 }), '--github-env', ghEnv],
      {
        encoding: 'utf8',
        cwd: TMP,
        env: { ...process.env, RUNNER_TEMP: '', GITHUB_REF: '', GITHUB_WORKFLOW_REF: '', [B64_ENV]: KEY.seedB64 },
      },
    );
    assert.equal(r.status, 0, out(r));
    const written = readFileSync(ghEnv, 'utf8').match(new RegExp(`^${KEY_PATH_ENV}=(.+)$`, 'm'))[1];
    assert.notEqual(resolve(dirname(written)), resolve(TMP), 'the private key landed in the working directory');
  });

  test('an EMPTY $GITHUB_ENV is treated as unset, not as a file named ""', () => {
    const r = spawnSync(process.execPath, [PREPARE, '--app', 'subly', '--repo-root', makeRoot({})], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ENV: '', GITHUB_REF: '', GITHUB_WORKFLOW_REF: '', [B64_ENV]: '' },
    });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /NOT EXPORTED/);
    assert.doesNotMatch(out(r), /ENOENT/);
  });
});

describe('appimage-signing · coverage self-checks', () => {
  test('COVERAGE LOST when the register is gone', () => {
    const { r } = runPrepare(makeRoot({ register: false }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the linux-appimage row is gone', () => {
    const { r } = runPrepare(makeRoot({ channelId: 'elsewhere' }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`declares no "${CHANNEL_ID}" channel`));
  });

  test('COVERAGE LOST when the row declares no ciSecrets.names', () => {
    const { r } = runPrepare(makeRoot({ names: null }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not a non-empty list of secret names/);
  });

  test('🔴 COVERAGE LOST when the register stops declaring the key transport name', () => {
    const { r } = runPrepare(makeRoot({ names: ['SOMETHING_ELSE_B64'] }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`does NOT declare ${B64_ENV}`));
  });

  test('🔴 COVERAGE LOST when the row declares an algorithm this seam does not implement', () => {
    // The alternative — reading the bytes as an Ed25519 seed anyway — would
    // silently produce a key nobody chose.
    const { r } = runPrepare(makeRoot({ algorithm: 'ed448', pin: KEY.publicB64 }), { [B64_ENV]: KEY.seedB64 });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /"ed448"/);
  });

  test('COVERAGE LOST when apps.json is missing', () => {
    const { r } = runPrepare(makeRoot({ apps: null }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('an unknown --app fails and lists the apps it knows', () => {
    const { r } = runPrepare(makeRoot({}), {}, { app: 'notanapp' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /Known: subly/);
  });

  test('FAILS when the secret is valid base64 of something that is not a key', () => {
    const { r } = runPrepare(makeRoot({ pin: KEY.publicB64 }), {
      [B64_ENV]: Buffer.from('<html><body>404</body></html>').toString('base64'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`${B64_ENV} is not an ${ALGORITHM} private key`));
  });
});

// ═════ the real register — the anti-drift check ══════════════════════════════
describe('appimage-signing · against the REAL tooling/channel-register.json', () => {
  const realRegister = () => {
    const p = join(REPO_ROOT, 'tooling', 'channel-register.json');
    assert.ok(existsSync(p), `${p} does not exist — this seam reads it and cannot be checked against it`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };

  test('🔴 the linux-appimage row declares EXACTLY ONE secret — there is no passphrase', () => {
    const row = realRegister().channels.find((c) => c.id === CHANNEL_ID);
    assert.ok(row, `the register declares no ${CHANNEL_ID} row`);
    assert.deepEqual(row.signing.ciSecrets.names, [B64_ENV]);
  });

  test('the row declares ed25519, which is the only algorithm this seam implements', () => {
    const row = realRegister().channels.find((c) => c.id === CHANNEL_ID);
    assert.equal(String(row.signing.signingPublicKey.algorithm).toLowerCase(), ALGORITHM);
  });

  test('the recorded pin is STILL a sentinel — the day it stops being one, the release path becomes live', () => {
    const row = realRegister().channels.find((c) => c.id === CHANNEL_ID);
    const p = classifyPublicKeyPin(row.signing.signingPublicKey);
    assert.equal(p.kind, 'sentinel', `the pin is now ${p.kind}; if a keypair was generated, this test is the reminder that the sentinel rule has changed meaning`);
  });

  test('the restore drill is still required and still undone — that is the owner gap the unsigned ending prints', () => {
    const row = realRegister().channels.find((c) => c.id === CHANNEL_ID);
    assert.equal(row.signing.restoreDrill.required, true);
    assert.equal(row.signing.restoreDrill.date, null);
  });
});
