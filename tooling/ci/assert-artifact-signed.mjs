#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-artifact-signed.mjs — read the signature out of the BUILT ARTIFACT and
// refuse to call a debug-signed bundle a release.
//
// 🔴 WHY THIS EXISTS — it is a post-defect guard, 2026-08-04.
// Every .aab this factory had ever produced was DEBUG-SIGNED. The Gradle release
// signingConfig was correct and had been for weeks; it reads four values from the
// environment and falls back to `signingConfigs.getByName("debug")` when they are
// absent, and NO WORKFLOW SUPPLIED THEM. So the fallback fired on every run,
// silently and by design, and Google Play — which rejects a debug-signed upload —
// would have been the first thing in the chain to say so, after the account, the
// listing and the 14-day tester window were already spent.
//
// 📌 EVERY EXISTING CHECK WAS GREEN AND EVERY ONE OF THEM WAS RIGHT.
// tooling/release/submit-play.mjs printed the debug fallback as the RECORDED
// posture. tooling/channel-register.json described it in prose. The Gradle file
// explained it in a header. Not one of them was reading the artifact, so the
// question "what actually signed this bundle?" had no answer anywhere — and a
// configuration scan can never answer it, because the config was already correct.
// That is the whole reason this guard reads bytes off disk instead.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   1. the artifact carries a signature at all (an UNSIGNED bundle is worse than
//      a debug-signed one and looks identical to a passing config scan)
//   2. no signer is the Android debug key. The marker is the DN — Android Studio
//      and AGP generate `CN=Android Debug, O=Android, C=US` for every debug
//      keystore ever created, documented at developer.android.com/studio/publish/
//      app-signing ("Android Studio … creates a debug keystore and certificate …
//      with the distinguished name CN=Android Debug, O=Android, C=US"), read
//      2026-08-04. Parsed into RDNs and compared on CN, never grepped: the string
//      "Android Debug" also appears in the prose of this file and in the guard's
//      own test, and a text match over the wrong buffer would read either as an
//      artifact.
//   3. the signer is the key we MEANT to use — its certificate SHA-256 matches
//      the fingerprint pinned in tooling/channel-register.json.
//   4. the real signature agrees with the posture tooling/ci/android-signing.mjs
//      exported. That step arranges a credential; this one
//      reads the outcome. A step that arranges a thing and then reports its own
//      success is the "green means ran" failure with extra stages.
//
// ── 🔬 ON PINNING THE FINGERPRINT, AND WHY IT IS WORTH THE BRITTLENESS ───────
// A pin fails the build whenever the key legitimately changes, which is a real
// cost and the reason to think twice. It is worth it here because of WHAT an
// unpinned check would miss and HOW an upload key changes.
//   · Without the pin, limb 2 accepts ANY non-debug key. A secret swapped for
//     another perfectly valid keystore — a copy-paste between repositories, a
//     rotation half-applied, a keystore restored from the wrong backup — produces
//     a bundle that is correctly signed, passes every other check here, and is
//     then REFUSED by Play, whose upload certificate is fixed at first upload.
//     That failure surfaces at the store, which is the one place this repository
//     has decided failures must not surface.
//   · An upload key does not rotate by accident. With Play App Signing, replacing
//     it means requesting an upload-key reset from Google and waiting for it to
//     take effect — a deliberate, multi-step, human process. Editing one line of
//     the register inside that process is proportionate; a silent swap is not.
//   · The fingerprint is NOT a secret. It is the SHA-256 of a public certificate,
//     shown in the Play Console and required in plaintext by App Links'
//     assetlinks.json and by Google Sign-In configuration. Pinning it in a public
//     register publishes nothing that signing an app does not already publish.
// If the pin is absent the guard PRINTS that gap on every run rather than
// failing: an unpinned fingerprint is a weaker guarantee, not a broken build.
//
// ── ⚠️ WHAT THIS GUARD CANNOT SEE, stated so green is not mistaken for safe ──
//   · It reads the JAR (v1) signature block ONLY, via `keytool -printcert
//     -jarfile`. An .aab always carries one — that is how app bundles are signed
//     — so the Play artifact is fully covered. An .apk built for minSdk ≥ 24 may
//     carry an APK Signing Block (v2/v3) and NO v1 block, and this guard reports
//     such a file as UNSIGNED. Do not point it at an .apk. Reading v2 needs
//     `apksigner` from the Android SDK build-tools; that branch is not written,
//     because it could not be exercised on the machine this was authored on and
//     an unexercised branch is worse than an absent one.
//   · It cannot tell an upload key from an app signing key. With Play App
//     Signing, Google holds the key installs are bound to; we hold only the one
//     that authenticates an upload. Nothing in the artifact distinguishes them —
//     that distinction lives in the register's `keyKind`.
//   · It says nothing about whether Play will ACCEPT the bundle. It answers one
//     question — which key signed this file — and leaves version codes, target
//     API level and policy to the guards that own them.
//
// Usage:
//   node tooling/ci/assert-artifact-signed.mjs [--repo-root <path>] <artifact>…
// Env in: ANDROID_SIGNING_POSTURE (required — exported by
//         tooling/ci/android-signing.mjs; the guard refuses to run without it)
// Exit 0 = the artifact is signed by the key this lane intended. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTER = 'tooling/channel-register.json';
const CHANNEL_ID = 'android-play';
const POSTURE_ENV = 'ANDROID_SIGNING_POSTURE';
const RELEASE_SIGNED = 'release-signed';
const DEBUG_PROOF = 'debug-signed-build-proof';

/** The documented Android debug certificate. Only the CN is compared — AGP has
 *  always generated exactly this DN, and matching on CN alone still catches a
 *  debug keystore somebody re-created with a different O or C. */
const DEBUG_CN = 'Android Debug';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const rootIdx = argv.indexOf('--repo-root');
// 🔴 `rootIdx + 1` ALONE IS THE BUG scan-secrets.mjs SHIPPED. With the flag
// absent, indexOf returns -1 and -1 + 1 is 0 — the first ARTIFACT's own index —
// so the flagless form would silently drop its first artifact and, with one
// artifact, evaluate none. (That path is not a quiet pass here: zero evaluated
// artifacts is COVERAGE LOST. It would still have been a failure nobody could
// attribute.)
const rootValueIdx = rootIdx >= 0 ? rootIdx + 1 : -1;
const artifacts = argv.filter((a, i) => !a.startsWith('--') && i !== rootValueIdx);

const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-artifact-signed: FAILED');
  process.exit(1);
}

// ── the posture this lane INTENDED ───────────────────────────────────────────
// Required, not defaulted. A default would make the most important comparison in
// the file — intended vs actual — collapse into "actual vs actual" on exactly the
// runs where the export failed, which is when it matters.
const posture = (process.env[POSTURE_ENV] ?? '').trim();
if (posture === '') {
  coverageLost([
    `${POSTURE_ENV} is not set, so this guard does not know what the lane intended.`,
    'It is exported by tooling/ci/android-signing.mjs. Its absence means that step did not run,',
    'did not reach $GITHUB_ENV, or ran in a different job — and comparing the artifact against a',
    'default would certify whatever it found.',
  ]);
}
if (posture !== RELEASE_SIGNED && posture !== DEBUG_PROOF) {
  coverageLost([
    `${POSTURE_ENV} is ${JSON.stringify(posture)}, which is neither "${RELEASE_SIGNED}" nor "${DEBUG_PROOF}".`,
    'An unrecognised posture cannot be compared to anything, and treating it as either one would pick a',
    'verdict by accident.',
  ]);
}

// ── the artifacts ────────────────────────────────────────────────────────────
if (artifacts.length === 0) {
  coverageLost([
    'no artifact path was given, so this guard evaluated nothing.',
    'A signature check over an empty set prints ok and is the single most repeated failure in this',
    'repository. Pass the built .aab.',
  ]);
}

// ── keytool ──────────────────────────────────────────────────────────────────
// Resolved rather than assumed: if it cannot be run, the correct outcome is a
// COVERAGE LOST, never a pass. "The tool was missing" and "the artifact is fine"
// must not be the same exit code.
function resolveKeytool() {
  const candidates = ['keytool'];
  const home = process.env.JAVA_HOME;
  if (home) candidates.push(join(home, 'bin', 'keytool'));
  for (const c of candidates) {
    const r = spawnSync(c, ['-help'], { encoding: 'utf8' });
    if (!r.error) return c;
  }
  return null;
}
const KEYTOOL = resolveKeytool();
if (KEYTOOL === null) {
  coverageLost([
    'keytool could not be run (not on PATH and not under $JAVA_HOME/bin).',
    'It is this guard\'s only way to read a signature. Without it the check cannot be made, and a check',
    'that cannot be made must not report success. Add a JDK to the job (actions/setup-java).',
  ]);
}

// ── the pinned fingerprint ───────────────────────────────────────────────────
const registerAbs = join(ROOT, REGISTER);
if (!existsSync(registerAbs)) {
  coverageLost([
    `${REGISTER} does not exist under ${ROOT}.`,
    'It carries the pinned upload-certificate fingerprint. Without it limb 3 would range over undefined',
    'and every non-debug key would read as the right one.',
  ]);
}
let register;
try {
  register = JSON.parse(readFileSync(registerAbs, 'utf8'));
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}
const channel = (register.channels ?? []).find((c) => c.id === CHANNEL_ID);
if (!channel) {
  coverageLost([
    `${REGISTER} declares no "${CHANNEL_ID}" channel.`,
    'That row is where the upload key is enumerated ([9]R-3) and where its fingerprint is pinned.',
  ]);
}

/** Colons and case are presentation. Compare the 32 bytes. */
const normalise = (fp) => String(fp).replace(/[\s:]/g, '').toUpperCase();
const pinnedRaw = channel.signing?.uploadCertificate?.sha256 ?? null;
let pinned = null;
if (pinnedRaw === null) {
  prints.push(
    `NO PINNED FINGERPRINT — ${REGISTER}'s ${CHANNEL_ID}.signing.uploadCertificate.sha256 is null, so limb 3 ` +
      'is not enforced: ANY non-debug key passes. A different keystore silently replacing ours would be ' +
      'accepted here and refused by Play, whose upload certificate is fixed at the first upload.',
  );
} else if (!/^[0-9A-F]{64}$/.test(normalise(pinnedRaw))) {
  // Not COVERAGE LOST — the guard is working perfectly; the record is wrong. A
  // malformed pin can never match, so it would fail every build with a message
  // about the artifact rather than about the typo.
  problems.push(
    `${REGISTER}'s ${CHANNEL_ID}.signing.uploadCertificate.sha256 is ${JSON.stringify(pinnedRaw)}, which is not a ` +
      'SHA-256 (32 bytes, hex, colons optional). It can never match any certificate, so every release build ' +
      'would fail with a message about the artifact instead of about this line.',
  );
} else {
  pinned = normalise(pinnedRaw);
}

// ── read the signature ───────────────────────────────────────────────────────
/**
 * `Owner: CN=…, OU=…, O=…` → a map of RDN type to value.
 *
 * 🔬 A PLAIN SPLIT, AND THE MUTATION RUN IS WHY. The first draft split on
 * `,(?=\s*TYPE=)` so a comma inside a value could not create a bogus RDN, with a
 * comment claiming that protected a real case. Reverting it to `split(',')`
 * turned NO test red — this guard reads only `CN`, and there is no input on
 * which the two disagree about it. By this repo's own rule that is sophistication
 * to delete, not to keep for safety.
 *
 * What makes the plain split SAFE rather than merely untested is measured, not
 * assumed: keytool QUOTES a value containing a comma rather than escaping it.
 * `-dname "CN=Android Debug\, Inc, O=NIKATRU, C=IN"` prints
 * `Owner: CN="Android Debug, Inc", O=NIKATRU, C=IN` (verified 2026-08-04,
 * keytool 17). So a truncation always leaves the opening quote behind —
 * `"Android Debug` — which can never equal a bare comparison target. The one
 * direction that would matter, a FALSE debug positive failing a legitimate
 * release build, is structurally unreachable. That case is a real fixture in the
 * test file, and it goes red the moment the CN comparison is loosened to a
 * substring match.
 */
function parseDn(dn) {
  const out = new Map();
  for (const part of dn.split(',')) {
    const m = part.match(/^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/);
    if (m) out.set(m[1].toUpperCase(), m[2]);
  }
  return out;
}

/** Every `Signer #N` block keytool printed, reduced to the LEAF certificate —
 *  `Certificate #1` in each block. Certificates #2… are the chain, and asserting
 *  on a CA's DN would be asking a different question entirely. */
function parseSigners(text) {
  const blocks = text.split(/^Signer #\d+:/m).slice(1);
  const out = [];
  for (const b of blocks) {
    const owner = b.match(/^Owner:\s*(.+?)\s*$/m)?.[1] ?? null;
    const sha = b.match(/^\s*SHA256:\s*([0-9A-Fa-f:]+)\s*$/m)?.[1] ?? null;
    if (owner === null || sha === null) continue;
    out.push({ owner, sha256: normalise(sha), dn: parseDn(owner) });
  }
  return out;
}

let evaluated = 0;
/** How many artifacts actually had their fingerprint COMPARED. Counted rather
 *  than inferred from `pinned !== null`, because the first live run printed
 *  "fingerprint pinned and matched" over a debug-signed artifact whose
 *  fingerprint was never looked at — a summary line claiming a check that did
 *  not happen is the same class of lie as a guard that scans nothing. */
let fingerprintChecked = 0;
for (const rel of artifacts) {
  const abs = isAbsolute(rel) ? rel : join(ROOT, rel);
  if (!existsSync(abs)) {
    problems.push(`${rel} does not exist. This guard runs after the build; a missing artifact means the build did not produce what this lane claims it did.`);
    continue;
  }
  const size = statSync(abs).size;
  if (size === 0) {
    problems.push(`${rel} is ZERO bytes. A truncated bundle uploads and fails processing, which spends a version code that can never be reused.`);
    continue;
  }

  const r = spawnSync(KEYTOOL, ['-printcert', '-jarfile', abs], { encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const signers = parseSigners(output);

  // 🔴 keytool EXITS 0 ON AN UNSIGNED ARCHIVE, printing "Not a signed jar file".
  // Measured, not assumed — an exit-code check here would have passed every
  // unsigned bundle. The verdict is the parsed signer list, never the status.
  if (signers.length === 0) {
    problems.push(
      `${rel} carries no readable JAR (v1) signature — keytool found no signer (${output.trim().split('\n')[0] || 'no output'}). ` +
        'An unsigned bundle is refused by Play outright. Note this guard reads v1 only: an .apk with a ' +
        'v2/v3-only APK Signing Block also lands here, and should not be passed to it (see the header).',
    );
    continue;
  }
  evaluated++;

  const debugSigners = signers.filter((s) => s.dn.get('CN') === DEBUG_CN);
  const isDebug = debugSigners.length > 0;
  for (const s of signers) {
    console.log(`   ${rel} · signer ${JSON.stringify(s.owner)} · SHA-256 ${s.sha256.match(/../g).join(':')}`);
  }

  // ── limb 4: the artifact must agree with what the lane arranged ────────────
  if (posture === RELEASE_SIGNED && isDebug) {
    problems.push(
      `${rel} is DEBUG-SIGNED (${debugSigners.map((s) => JSON.stringify(s.owner)).join(', ')}) and ${POSTURE_ENV} says ` +
        `"${RELEASE_SIGNED}". The signing secrets were supplied and Gradle did not use them — the exact silent ` +
        'fallback this guard exists for. Google Play rejects a debug-signed upload.',
    );
    continue;
  }
  if (posture === DEBUG_PROOF && !isDebug) {
    problems.push(
      `${rel} is signed by ${signers.map((s) => JSON.stringify(s.owner)).join(', ')} and ${POSTURE_ENV} says ` +
        `"${DEBUG_PROOF}". A key reached this build through a path the lane did not arrange — a stray ` +
        'key.properties, an inherited environment — and an artifact nobody can attribute is the thing that ' +
        'must never reach a store.',
    );
    continue;
  }

  if (isDebug) {
    // The legal, LABELLED unsigned-for-release outcome. Loud on purpose: a
    // debug-signed bundle that reads as ordinary is how this defect survived.
    prints.push(
      `${rel} is DEBUG-SIGNED and this lane declared "${DEBUG_PROOF}", so that is the expected outcome. ` +
        '🔴 IT CANNOT BE UPLOADED TO GOOGLE PLAY. It proves the Android module builds and nothing about the release key.',
    );
    continue;
  }

  // ── limb 3: it is the key we meant ────────────────────────────────────────
  if (pinned === null) {
    prints.push(`${rel} is release-signed; its fingerprint was NOT compared to a pin (see above).`);
    continue;
  }
  const wrong = signers.filter((s) => s.sha256 !== pinned);
  if (wrong.length) {
    problems.push(
      `${rel} is signed by a certificate that is not the pinned upload key. ` +
        `expected SHA-256 ${pinned.match(/../g).join(':')}; found ` +
        `${wrong.map((s) => `${s.sha256.match(/../g).join(':')} (${JSON.stringify(s.owner)})`).join(', ')}. ` +
        `Play fixes the upload certificate at the FIRST upload and refuses every later bundle signed by another ` +
        `key, so a swapped secret surfaces at the store rather than here — unless this line catches it. If the ` +
        `key was rotated deliberately, update ${REGISTER}'s ${CHANNEL_ID}.signing.uploadCertificate in the same change.`,
    );
    continue;
  }
  fingerprintChecked++;
  ok(`${rel} — release-signed by the pinned upload certificate`);
}

// A pass produced by reading nothing is the failure this repository keeps
// meeting. Every artifact could have been missing, empty or unreadable above and
// the loop would simply have ended.
//
// ⚠️ THE ACCUMULATED PROBLEMS ARE PRINTED FIRST, and the first live run is why.
// An unsigned bundle produces BOTH a precise diagnosis and an empty evaluation
// set; exiting on the coverage check alone replaced "this file carries no
// signature" with "nothing was evaluated", which is true, useless, and reads as
// a broken guard rather than a broken artifact.
if (evaluated === 0) {
  for (const p of problems) console.error(`FAIL ${p}`);
  coverageLost([
    `${artifacts.length} artifact path(s) were given and NOT ONE yielded a readable signature.`,
    'Every assertion above ranged over an empty set. Either the build produced nothing, or the paths are',
    'wrong, or keytool has stopped reading these files — and all three look identical to a clean run.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  Every .aab this factory built before 2026-08-04 was debug-signed and every configuration');
  console.error('  check was green, because the configuration was already correct and nothing read the bytes.');
  console.error('\nassert-artifact-signed: FAILED');
  process.exit(1);
}

console.log('');
console.log(
  `assert-artifact-signed: OK — ${evaluated}/${artifacts.length} artifact(s) read with keytool; posture "${posture}" ` +
    `matches the real signer; ${fingerprintChecked} fingerprint(s) compared against the pin` +
    `${pinned === null ? ' (none pinned — see above)' : ''}`,
);
console.log('   v1 (JAR) signatures only — an .apk with a v2/v3-only signing block is NOT readable here.');
