// ─────────────────────────────────────────────────────────────────────────────
// windows-signing.test.mjs — tooling/ci/windows-signing.mjs must be able to FAIL.
//
// 📌 WHAT IS REAL HERE AND WHAT IS A FIXTURE, SAID PLAINLY RATHER THAN IMPLIED.
// The android-signing suite signs real archives with a real keytool, because a
// JDK is on every runner it targets. signtool.exe is NOT: it ships with the
// Windows SDK, it does not exist on the machine this was authored on, and it
// cannot be installed by a test. So this file splits the subject in two:
//
//   · THE DECISION LAW — the secret-set rule, the release-lane derivation, the
//     pin classification, the sentinel rule, the command construction and the
//     verify-output parse — is exercised DIRECTLY, as exported pure functions.
//     No process, no tool, no fixture tree. These are the parts that decide
//     whether a build is allowed to be unsigned, and they are fully covered.
//   · THE VERIFY-OUTPUT PARSER runs against TRANSCRIBED signtool output. A
//     fixture agrees with whatever misunderstanding wrote it, so it is the
//     regression net and never the proof — the same caveat android-signing.test
//     records about its own fixtures, and it is worth MORE here, not less,
//     because no real signtool has ever been pointed at this parser. The header
//     of the guard says so too. Do not read a green run of this file as evidence
//     that the parser understands signtool; read it as evidence that the parser
//     still understands what we believe signtool prints.
//
// The subprocess tests below use fixture repository roots, exactly as
// android-signing.test.mjs does, because the endings — what is written, what is
// exported, what is printed — are the behaviour a workflow depends on.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  B64_ENV,
  CHANNEL_ID,
  DEFAULT_TIMESTAMP_URL,
  POSTURE_ENV,
  PATH_ENV,
  RELEASE_SIGNED,
  UNSIGNED_PROOF,
  buildSignCommand,
  buildVerifyCommand,
  classifyPin,
  compareThumbprint,
  decideRelease,
  decideSecretSet,
  looksLikePkcs12,
  normaliseThumbprint,
  parseSigntoolVerify,
  pinVerdict,
} from '../windows-signing.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CI_DIR, '..', '..');
const PREPARE = join(CI_DIR, 'windows-signing.mjs');

const PW_ENV = 'WINDOWS_CODESIGN_PFX_PASSWORD';
const PW = 'fixture-pfx-password';
const SENTINEL = 'CODE-SIGNING-CERT-NOT-PURCHASED';
const PIN = 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90';
const OTHER_PIN = '00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF';

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-winsign-'));
});
after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** A byte string that PASSES the structural check without being a real
 *  certificate: PKCS#12 is DER, so a real one opens with a SEQUENCE tag. The
 *  guard deliberately checks structure and not contents — see its header on why
 *  no password is verified here — so a real .pfx would test nothing extra and
 *  would put key material in the repository. */
const derBlob = (n = 512) => {
  const b = Buffer.alloc(n, 0x41);
  b[0] = 0x30;
  b[1] = 0x82;
  return b;
};
const PFX_B64 = derBlob().toString('base64');

// ── fixture repository roots ─────────────────────────────────────────────────
function makeRoot({
  pin = SENTINEL,
  sentinel = SENTINEL,
  certificate,
  channelId = CHANNEL_ID,
  register = true,
  names = [B64_ENV, PW_ENV],
  apps = [{ slug: 'subly' }],
  submissionWorkflow = null,
  storeRow = true,
} = {}) {
  const root = join(TMP, `root${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  mkdirSync(join(root, 'sites', '_shared', '_data'), { recursive: true });
  if (register) {
    const cert =
      certificate === undefined
        ? { notYetConfiguredSentinel: sentinel, sha256: pin, subject: sentinel }
        : certificate;
    const row = {
      id: channelId,
      kind: 'direct',
      signing: {
        keyKind: 'code-signing-certificate',
        custody: 'does not exist — and unlike every other row this one costs real money every year.',
        codeSigningCertificate: cert,
        ciSecrets: names === null ? undefined : { names },
      },
    };
    if (submissionWorkflow !== null) row.submission = { workflow: submissionWorkflow };
    const channels = [row];
    if (storeRow) {
      channels.push({
        id: 'windows-store',
        signing: { keyKind: 'none' },
        submission: { script: 'tooling/release/submit-windows-store.mjs' },
      });
    }
    writeFileSync(join(root, 'tooling', 'channel-register.json'), JSON.stringify({ channels }));
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
        [PW_ENV]: '',
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

const FULL = () => ({ [B64_ENV]: PFX_B64, [PW_ENV]: PW });
const ON_TAG = { GITHUB_REF: 'refs/tags/subly-v1.0.0' };
const SUBMIT_WF = '.github/workflows/submit-windows-direct.yml';

// ═════ the decision law — pure, no process, no tool ══════════════════════════
describe('windows-signing · the secret-set law', () => {
  test('none supplied is "none", and an EMPTY STRING is not a value', () => {
    const s = decideSecretSet([B64_ENV, PW_ENV], { [B64_ENV]: '', [PW_ENV]: '   ' });
    assert.equal(s.state, 'none');
    assert.deepEqual(s.missing, [B64_ENV, PW_ENV]);
  });

  test('all supplied is "all"', () => {
    assert.equal(decideSecretSet([B64_ENV, PW_ENV], FULL()).state, 'all');
  });

  test('either half alone is "partial" — the state that is never legal', () => {
    assert.equal(decideSecretSet([B64_ENV, PW_ENV], { [B64_ENV]: PFX_B64 }).state, 'partial');
    assert.equal(decideSecretSet([B64_ENV, PW_ENV], { [PW_ENV]: PW }).state, 'partial');
  });

  test('the law ranges over the names it is GIVEN, not over any list of its own', () => {
    const s = decideSecretSet(['RENAMED_A', 'RENAMED_B'], { ...FULL(), RENAMED_A: 'x' });
    assert.deepEqual(s.missing, ['RENAMED_B']);
  });
});

describe('windows-signing · a release lane is DERIVED, not declared in YAML', () => {
  test('a TAG push requires signing and names the signal', () => {
    const d = decideRelease({ gitRef: 'refs/tags/subly-v1.0.0' });
    assert.equal(d.required, true);
    assert.match(d.reasons.join(' '), /TAG push/);
  });

  test('a branch push does not', () => {
    assert.equal(decideRelease({ gitRef: 'refs/heads/feat/whatever' }).required, false);
  });

  test('a DECLARED submission workflow requires signing, matched on its PATH so a branch name cannot change the answer', () => {
    const d = decideRelease({
      workflowRef: `owner/other-repo/${SUBMIT_WF}@refs/tags/whatever`,
      submissionWorkflow: SUBMIT_WF,
    });
    assert.equal(d.required, true);
    assert.match(d.reasons.join(' '), /declared submission workflow/);
  });

  test('ANOTHER workflow does not — the build proof stays legal', () => {
    const d = decideRelease({
      workflowRef: 'owner/repo/.github/workflows/build-platforms.yml@refs/heads/main',
      submissionWorkflow: SUBMIT_WF,
    });
    assert.equal(d.required, false);
  });

  test('a row with NO submission.workflow prints the narrowed derivation rather than hiding it — which is the REAL register today', () => {
    const d = decideRelease({ workflowRef: 'owner/repo/.github/workflows/x.yml@refs/heads/main' });
    assert.equal(d.required, false);
    assert.match(d.blind.join(' '), /declares no `submission\.workflow`/);
  });
});

describe('windows-signing · the pin classification', () => {
  test('the row as PR #202 records it TODAY classifies as a sentinel', () => {
    const p = classifyPin({ notYetConfiguredSentinel: SENTINEL, sha256: SENTINEL, subject: SENTINEL });
    assert.equal(p.kind, 'sentinel');
    assert.equal(p.value, null);
  });

  test('a real SHA-256 classifies as one, and colons and case are presentation', () => {
    const spaced = PIN.match(/../g).join(':').toLowerCase();
    assert.equal(classifyPin({ sha256: spaced }).kind, 'sha256');
    assert.equal(classifyPin({ sha256: spaced }).value, PIN);
    assert.equal(normaliseThumbprint(spaced), PIN);
  });

  test('null is "absent" — an unpinned certificate is weaker, not broken', () => {
    assert.equal(classifyPin({ sha256: null }).kind, 'absent');
    assert.equal(classifyPin(undefined).kind, 'absent');
  });

  test('40 hex characters classify as SHA-1, separately and by name', () => {
    // The register's own `source` line recommends `Get-PfxCertificate |
    // Format-List Thumbprint`, and that property is a SHA-1. Following the
    // recorded instruction literally produces exactly this value.
    assert.equal(classifyPin({ sha256: 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4' }).kind, 'sha1');
  });

  test('anything else is malformed', () => {
    assert.equal(classifyPin({ sha256: 'not-a-thumbprint' }).kind, 'malformed');
  });
});

describe('windows-signing · 🔴 the sentinel rule', () => {
  test('a SENTINEL pin with a RELEASE-SIGNED posture is FATAL, and the message says why', () => {
    const v = pinVerdict(classifyPin({ notYetConfiguredSentinel: SENTINEL, sha256: SENTINEL }), RELEASE_SIGNED);
    assert.ok(v.fatal, 'a sentinel pin under a release posture must be fatal');
    assert.match(v.fatal, /placeholder/);
    assert.match(v.fatal, /comparing NOTHING/);
  });

  test('the same sentinel with an UNSIGNED-PROOF posture is PRINTED, never fatal — it is the correct state of the record', () => {
    const v = pinVerdict(classifyPin({ notYetConfiguredSentinel: SENTINEL, sha256: SENTINEL }), UNSIGNED_PROOF);
    assert.equal(v.fatal, null);
    assert.match(v.print, /which is correct/);
  });

  test('a SHA-1 pin under a release posture is fatal and names the Thumbprint trap', () => {
    const v = pinVerdict(classifyPin({ sha256: 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4' }), RELEASE_SIGNED);
    assert.match(v.fatal, /SHA-1, not a SHA-256/);
    assert.match(v.fatal, /Get-PfxCertificate/);
  });

  test('a malformed pin under a release posture is fatal', () => {
    assert.ok(pinVerdict(classifyPin({ sha256: 'nonsense' }), RELEASE_SIGNED).fatal);
  });

  test('an ABSENT pin passes and PRINTS the gap — unpinned is weaker, not broken', () => {
    const v = pinVerdict(classifyPin({ sha256: null }), RELEASE_SIGNED);
    assert.equal(v.fatal, null);
    assert.match(v.print, /NO PINNED THUMBPRINT/);
  });

  test('a REAL pin under a release posture says nothing at all — the guard must not fire on correct input', () => {
    const v = pinVerdict(classifyPin({ sha256: PIN }), RELEASE_SIGNED);
    assert.equal(v.fatal, null);
    assert.equal(v.print, null);
  });
});

describe('windows-signing · the constructed commands', () => {
  test('the sign command carries /fd SHA256 and an RFC 3161 timestamp', () => {
    const c = buildSignCommand({ pfxPath: 'C:/t/subly.pfx', password: PW, artifact: 'subly.exe' });
    assert.deepEqual(c.args.slice(0, 2), ['sign', '/f']);
    assert.equal(c.args[c.args.indexOf('/fd') + 1], 'SHA256');
    assert.equal(c.args[c.args.indexOf('/tr') + 1], DEFAULT_TIMESTAMP_URL);
    assert.equal(c.args[c.args.indexOf('/td') + 1], 'SHA256');
    assert.equal(c.args[c.args.length - 1], 'subly.exe');
  });

  test('🔴 the REDACTED form does not carry the password and the real one does', () => {
    const c = buildSignCommand({ pfxPath: 'C:/t/subly.pfx', password: PW, artifact: 'subly.exe' });
    assert.ok(c.args.includes(PW), 'the real argv must carry the password or signtool cannot open the .pfx');
    assert.ok(!c.redacted.includes(PW), 'the printable argv leaked the password');
    assert.ok(c.redacted.includes('***'));
  });

  test('the verify command uses /pa — the Authenticode policy, not the driver policy', () => {
    const c = buildVerifyCommand({ artifact: 'subly.exe' });
    assert.deepEqual(c.args, ['verify', '/pa', '/v', 'subly.exe']);
  });

  test('both refuse to build a command with nothing to act on', () => {
    assert.throws(() => buildSignCommand({ pfxPath: 'x' }), /artifact/);
    assert.throws(() => buildVerifyCommand({}), /artifact/);
  });
});

// ── transcribed signtool output ──────────────────────────────────────────────
// Root-first, increasing indentation, leaf LAST and most indented.
const verifiedOutput = (leafSha) => `Verifying: subly.exe

Signature Index: 0 (Primary Signature)
Hash of file (sha256): 8E9F0A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7

Signing Certificate Chain:
    Issued to: Example Assured ID Root CA
    Issued by: Example Assured ID Root CA
    Expires:   Mon Nov 10 05:30:00 2031
    SHA1 hash: 0563B8630D62D75ABBC8AB1E4BDFB5A899B24D43
    SHA256 hash: FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF

        Issued to: Example Code Signing CA
        Issued by: Example Assured ID Root CA
        Expires:   Thu Nov 09 05:29:59 2034
        SHA1 hash: 1111111111111111111111111111111111111111
        SHA256 hash: EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE

            Issued to: NIKATRU
            Issued by: Example Code Signing CA
            Expires:   Fri Aug 08 05:29:59 2027
            SHA1 hash: 2222222222222222222222222222222222222222
            SHA256 hash: ${leafSha}

The signature is timestamped: Sat Aug 08 12:00:00 2026
Successfully verified: subly.exe

Number of files successfully Verified: 1
Number of warnings: 0
Number of errors: 0
`;

const UNSIGNED_OUTPUT = `Verifying: subly.exe
SignTool Error: No signature found.

Number of files successfully Verified: 0
Number of warnings: 0
Number of errors: 1
`;

const UNTRUSTED_OUTPUT = `Verifying: subly.exe

Signing Certificate Chain:
    Issued to: Somebody Else
    Issued by: Somebody Else
    Expires:   Fri Aug 08 05:29:59 2027
    SHA1 hash: 3333333333333333333333333333333333333333
    SHA256 hash: ${OTHER_PIN}

SignTool Error: A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider.

Number of files successfully Verified: 0
Number of warnings: 0
Number of errors: 1
`;

describe('windows-signing · the verify-output parser', () => {
  test('a verified signature is read as verified, and the LEAF is the most-indented entry', () => {
    const p = parseSigntoolVerify(verifiedOutput(PIN));
    assert.equal(p.recognised, true);
    assert.equal(p.verified, true);
    assert.equal(p.entries.length, 3, 'all three chain entries must be seen');
    assert.equal(p.leaf.subject, 'NIKATRU');
    assert.equal(p.leaf.sha256, PIN);
    assert.equal(p.errors, 0);
  });

  test('🔴 an UNSIGNED binary is NOT verified — and the parser, not an exit code, is what says so', () => {
    const p = parseSigntoolVerify(UNSIGNED_OUTPUT);
    assert.equal(p.recognised, true);
    assert.equal(p.verified, false);
    assert.equal(p.leaf, null);
    assert.equal(compareThumbprint(p, classifyPin({ sha256: PIN })) !== null, true);
    assert.match(compareThumbprint(p, classifyPin({ sha256: PIN })), /did not verify/);
  });

  test('an UNTRUSTED chain is not verified even though a certificate was printed', () => {
    const p = parseSigntoolVerify(UNTRUSTED_OUTPUT);
    assert.equal(p.verified, false);
    assert.equal(p.leaf.subject, 'Somebody Else');
    assert.match(compareThumbprint(p, classifyPin({ sha256: PIN })), /Authenticode policy/);
  });

  test('🔴 a MISMATCHED but perfectly valid certificate is refused, and both thumbprints are named', () => {
    const p = parseSigntoolVerify(verifiedOutput(OTHER_PIN));
    assert.equal(p.verified, true, 'signtool itself is happy — this is the case only the pin catches');
    const problem = compareThumbprint(p, classifyPin({ sha256: PIN }));
    assert.ok(problem, 'a different valid certificate must not pass the pin');
    assert.match(problem, /NOT the pinned one/);
    // Printed colon-separated, the way every certificate tool shows a thumbprint
    // — so the operator can paste it straight into a comparison.
    const colon = (h) => h.match(/../g).join(':');
    assert.ok(problem.includes(colon(PIN)), 'the expected thumbprint must be named');
    assert.ok(problem.includes(colon(OTHER_PIN)), 'the thumbprint actually found must be named');
  });

  test('a matching certificate passes', () => {
    assert.equal(compareThumbprint(parseSigntoolVerify(verifiedOutput(PIN)), classifyPin({ sha256: PIN })), null);
  });

  test('🔴 UNRECOGNISED output is COVERAGE LOST, never a pass and never a plausible-looking failure', () => {
    const p = parseSigntoolVerify('the quick brown fox');
    assert.equal(p.recognised, false);
    assert.match(compareThumbprint(p, classifyPin({ sha256: PIN })), /COVERAGE LOST/);
  });

  test('empty output is unrecognised rather than "not verified"', () => {
    assert.equal(parseSigntoolVerify('').recognised, false);
    assert.equal(parseSigntoolVerify(null).recognised, false);
  });

  test('a verified artifact whose chain printed NO SHA-256 does not count as a pinned match', () => {
    const noSha = verifiedOutput(PIN).replace(/^ *SHA256 hash: .*$/gm, '');
    const p = parseSigntoolVerify(noSha);
    assert.equal(p.verified, true);
    assert.match(compareThumbprint(p, classifyPin({ sha256: PIN })), /was NOT\s+compared|NOT compared/);
  });

  test('with NO pin the comparison is skipped rather than faked', () => {
    assert.equal(compareThumbprint(parseSigntoolVerify(verifiedOutput(OTHER_PIN)), classifyPin({ sha256: null })), null);
  });
});

describe('windows-signing · the PKCS#12 structure check', () => {
  test('DER (first byte 0x30) is accepted', () => {
    assert.equal(looksLikePkcs12(derBlob()), true);
  });
  test('an HTML error page is not', () => {
    assert.equal(looksLikePkcs12(Buffer.from('<html><body>404</body></html>')), false);
  });
  test('a PEM is not — it is base64 of the WRONG encoding, which decodes to something', () => {
    assert.equal(looksLikePkcs12(Buffer.from('-----BEGIN CERTIFICATE-----')), false);
  });
  test('empty is not', () => {
    assert.equal(looksLikePkcs12(Buffer.alloc(0)), false);
  });
});

// ═════ the endings, as a real subprocess ═════════════════════════════════════
describe('windows-signing · the three endings', () => {
  test('no secrets on a NON-release lane is a labelled build proof, and passes', () => {
    const { r, exported } = runPrepare(makeRoot({}), {});
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /UNSIGNED-BUILD-PROOF/);
    // The posture is EXPORTED to $GITHUB_ENV, not merely printed — a later step
    // reads the file, and a run that only announced the posture in its log would
    // leave every downstream reader with nothing.
    assert.match(exported, new RegExp(`${POSTURE_ENV}=${UNSIGNED_PROOF}`));
  });

  test('the unsigned ending names the OWNER item and says it costs money every year', () => {
    const { r } = runPrepare(makeRoot({}), {});
    assert.match(out(r), /OWNER ITEM/);
    assert.match(out(r), /PURCHASED/);
    assert.match(out(r), /RENEWED every year/);
  });

  test('🔴 a TAG PUSH with NO secrets FAILS, and names every secret to create', () => {
    const { r } = runPrepare(makeRoot({}), ON_TAG);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /this is a RELEASE lane and no Windows code-signing secrets are configured/);
    assert.match(out(r), /required because the run is a TAG push/);
    for (const n of [B64_ENV, PW_ENV]) assert.match(out(r), new RegExp(n));
  });

  test('a tag-push failure still explains that the blocker is a PURCHASE, not wiring', () => {
    const { r } = runPrepare(makeRoot({}), ON_TAG);
    assert.match(out(r), /OWNER ITEM WITH A RECURRING COST, NOT A WIRING GAP/);
    assert.match(out(r), /costs real money every year/);
  });

  test('🔴 HALF the secrets FAILS on EVERY lane, release or not', () => {
    for (const [env, label] of [
      [{ [B64_ENV]: PFX_B64 }, 'certificate without password'],
      [{ [PW_ENV]: PW }, 'password without certificate'],
    ]) {
      const { r } = runPrepare(makeRoot({}), env);
      assert.equal(r.status, 1, `${label}: ${out(r)}`);
      assert.match(out(r), /HALF configured/);
    }
  });

  test('half the secrets on a NON-release lane fails too — a build proof does not excuse it', () => {
    const { r } = runPrepare(makeRoot({}), { [B64_ENV]: PFX_B64 });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`missing:\\s+${PW_ENV}`));
  });

  test('🔴 BOTH secrets against the SENTINEL pin FAILS — the posture would claim a comparison that cannot happen', () => {
    const { r, outDir } = runPrepare(makeRoot({ pin: SENTINEL }), FULL());
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /THE CERTIFICATE PIN AND THE POSTURE DISAGREE/);
    assert.match(out(r), /CODE-SIGNING-CERT-NOT-PURCHASED/);
    assert.ok(!existsSync(join(outDir, 'subly-codesign.pfx')), 'a certificate was left on disk by a run that failed');
  });

  test('both secrets against a REAL pin materialise the .pfx and export three variables', () => {
    const { r, outDir, exported } = runPrepare(makeRoot({ pin: PIN }), { ...FULL(), ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    const written = join(outDir, 'subly-codesign.pfx');
    assert.ok(existsSync(written), out(r));
    assert.deepEqual(readFileSync(written), derBlob());
    const names = exported.trim().split('\n').map((l) => l.split('=')[0]).sort();
    assert.deepEqual(names, [POSTURE_ENV, PW_ENV, PATH_ENV].sort());
    assert.match(out(r), new RegExp(RELEASE_SIGNED.toUpperCase()));
  });

  test('with a real pin, the read-back is reported as CONSTRUCTED rather than claimed as done', () => {
    // signtool does not exist on most machines, and a missing tool must never
    // read as a passing check.
    const { r } = runPrepare(makeRoot({ pin: PIN }), { ...FULL(), ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /READ-BACK NOT PERFORMED/);
    assert.match(out(r), /read-back constructed, not performed/);
    assert.doesNotMatch(out(r), /artifact\(s\) read back/);
  });

  test('the printed commands never contain the password', () => {
    const { r } = runPrepare(makeRoot({ pin: PIN }), { ...FULL(), ...ON_TAG });
    assert.match(out(r), /signtool sign \/f/);
    assert.match(out(r), /signtool verify \/pa/);
    assert.doesNotMatch(out(r), new RegExp(PW));
  });
});

describe('windows-signing · the secret is never printed and never half-written', () => {
  test('neither the password nor a fragment of the base64 appears in the output', () => {
    const { r } = runPrepare(makeRoot({ pin: PIN }), { ...FULL(), ...ON_TAG });
    const text = out(r);
    assert.doesNotMatch(text, new RegExp(PW));
    assert.ok(!text.includes(PFX_B64.slice(0, 40)), 'a fragment of the certificate base64 was printed');
  });

  test('a value carrying a newline is refused BEFORE any key is written to disk', () => {
    const { r, outDir } = runPrepare(makeRoot({ pin: PIN }), { ...FULL(), [PW_ENV]: `${PW}\nPATH=/evil` });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /contains a line break/);
    assert.ok(!existsSync(join(outDir, 'subly-codesign.pfx')), 'a certificate was left on disk by a run that failed');
  });

  test('the .pfx is written OUTSIDE the repository tree', () => {
    const root = makeRoot({ pin: PIN });
    const { r, exported } = runPrepare(root, { ...FULL(), ...ON_TAG });
    assert.equal(r.status, 0, out(r));
    const written = exported.match(new RegExp(`^${PATH_ENV}=(.+)$`, 'm'))[1];
    assert.ok(!resolve(written).startsWith(resolve(root)), `${written} is inside ${root} — an upload-artifact glob could reach it`);
    assert.equal(written, resolve(written), 'the exported path must be absolute');
  });

  test('an EMPTY $RUNNER_TEMP does not put the certificate in the CURRENT directory', () => {
    const ghEnv = join(TMP, `ghenv-rt${seq++}.txt`);
    const r = spawnSync(
      process.execPath,
      [PREPARE, '--app', 'subly', '--repo-root', makeRoot({ pin: PIN }), '--github-env', ghEnv],
      {
        encoding: 'utf8',
        cwd: TMP,
        env: { ...process.env, RUNNER_TEMP: '', GITHUB_REF: '', GITHUB_WORKFLOW_REF: '', ...FULL() },
      },
    );
    assert.equal(r.status, 0, out(r));
    const written = readFileSync(ghEnv, 'utf8').match(new RegExp(`^${PATH_ENV}=(.+)$`, 'm'))[1];
    assert.notEqual(resolve(dirname(written)), resolve(TMP), 'the certificate landed in the working directory');
  });

  test('an EMPTY $GITHUB_ENV is treated as unset, not as a file named ""', () => {
    const r = spawnSync(process.execPath, [PREPARE, '--app', 'subly', '--repo-root', makeRoot({})], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ENV: '', GITHUB_REF: '', GITHUB_WORKFLOW_REF: '', [B64_ENV]: '', [PW_ENV]: '' },
    });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /NOT EXPORTED/);
    assert.doesNotMatch(out(r), /ENOENT/);
  });
});

describe('windows-signing · a secret that is not what it claims to be', () => {
  test('FAILS when the base64 does not round-trip', () => {
    const { r } = runPrepare(makeRoot({ pin: PIN }), { ...FULL(), [B64_ENV]: 'this is not base64 !!!' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not valid base64/);
  });

  test('FAILS on valid base64 of something that is not a PKCS#12', () => {
    const { r } = runPrepare(makeRoot({ pin: PIN }), {
      ...FULL(),
      [B64_ENV]: Buffer.from('<html><body>404</body></html>').toString('base64'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /are not a PKCS#12 archive/);
  });

  test('base64 with embedded line breaks is accepted — that is how most tools emit it', () => {
    const wrapped = PFX_B64.replace(/(.{64})/g, '$1\n');
    const { r } = runPrepare(makeRoot({ pin: PIN }), { ...FULL(), [B64_ENV]: wrapped });
    assert.equal(r.status, 0, out(r));
  });
});

describe('windows-signing · coverage self-checks', () => {
  test('COVERAGE LOST when the register is gone — the decision would default to "a proof is fine"', () => {
    const { r } = runPrepare(makeRoot({ register: false }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the windows-direct row is gone', () => {
    const { r } = runPrepare(makeRoot({ channelId: 'somewhere-else' }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`declares no "${CHANNEL_ID}" channel`));
  });

  test('COVERAGE LOST when the row declares no ciSecrets.names', () => {
    const { r } = runPrepare(makeRoot({ names: null }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /is not a non-empty list of secret names/);
  });

  test('🔴 COVERAGE LOST when the register stops declaring the base64 transport name', () => {
    // The one name this script owns rather than reads. If the register renames it
    // and this constant does not follow, a decoded certificate would have nothing
    // pointing at it and the build would silently produce an unsigned binary.
    const { r } = runPrepare(makeRoot({ names: ['SOMETHING_ELSE_B64', PW_ENV] }), {});
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`does NOT declare ${B64_ENV}`));
  });

  test('the secret names really are read from the REGISTER, not hard-coded here', () => {
    // Rename the passthrough in the fixture. A script carrying its own copy of
    // the list would still see WINDOWS_CODESIGN_PFX_PASSWORD in the environment
    // and report a complete set; this one must ask for the RENAMED name.
    const { r } = runPrepare(makeRoot({ names: [B64_ENV, 'RENAMED_PFX_PASSWORD'] }), FULL());
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /HALF configured/);
    assert.match(out(r), /RENAMED_PFX_PASSWORD/);
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

  test('every run prints the ONE line saying the Store path is out of scope, read from the register', () => {
    const { r } = runPrepare(makeRoot({}), {});
    assert.match(out(r), /OUT OF SCOPE: the Microsoft Store path \(windows-store, keyKind "none"\)/);
    assert.match(out(r), /submit-windows-store\.mjs/);
  });
});

// ═════ the real register — the anti-drift check ══════════════════════════════
describe('windows-signing · against the REAL tooling/channel-register.json', () => {
  const realRegister = () => {
    const p = join(REPO_ROOT, 'tooling', 'channel-register.json');
    assert.ok(existsSync(p), `${p} does not exist — this seam reads it and cannot be checked against it`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };

  test('the windows-direct row declares exactly the two secrets this seam reads', () => {
    const row = realRegister().channels.find((c) => c.id === CHANNEL_ID);
    assert.ok(row, `the register declares no ${CHANNEL_ID} row`);
    assert.deepEqual([...row.signing.ciSecrets.names].sort(), [B64_ENV, PW_ENV].sort());
  });

  test('the recorded pin is STILL a sentinel — the day it stops being one, the release path becomes live', () => {
    const row = realRegister().channels.find((c) => c.id === CHANNEL_ID);
    const p = classifyPin(row.signing.codeSigningCertificate);
    assert.equal(p.kind, 'sentinel', `the pin is now ${p.kind}; if a certificate was purchased, this test is the reminder that the sentinel rule has changed meaning`);
  });

  test('the store row still says keyKind "none", which is what the out-of-scope line claims', () => {
    const row = realRegister().channels.find((c) => c.id === 'windows-store');
    assert.equal(row.signing.keyKind, 'none');
  });
});
