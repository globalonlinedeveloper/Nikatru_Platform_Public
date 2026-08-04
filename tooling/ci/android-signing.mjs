#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// android-signing.mjs — materialise the Android UPLOAD KEY for one CI build and
// decide, out loud, whether this run is allowed to be unsigned.
//
// 🔴 WHY THIS EXISTS — the defect it closes, named. Until 2026-08-04 every .aab
// CI produced was DEBUG-SIGNED, and nothing anywhere said so. The Gradle config
// (apps/<app>/android/app/build.gradle.kts) had been correct for weeks: it reads
// four values from `android/key.properties` or from the environment and falls
// back to `signingConfigs.getByName("debug")` when they are absent. NO WORKFLOW
// SUPPLIED THEM. So the fallback — a deliberate, recorded decision for a build
// PROOF — fired on every single run, including the ones whose whole purpose was
// to produce a store artifact. Google Play rejects a debug-signed upload, so the
// first submission would have failed at the last step of a path everything else
// reported healthy.
//
// The shape of that defect is the one this repository keeps meeting: a fallback
// that is CORRECT in one situation and silently WRONG in another, with nothing
// distinguishing the two. The repair is not to delete the fallback — a keyless
// build proof is still what build-platforms.yml's weekly run is for, and
// tooling/release/submit-play.mjs asserts the debug fallback still exists. The
// repair is to make the CHOICE explicit and to make the wrong one LOUD:
//
//   all four supplied   → materialise the keystore, export the four variables
//                         Gradle reads, posture = `release-signed`
//   none supplied       → posture = `debug-signed-build-proof`, printed in
//                         capitals — UNLESS this is a release lane, where the
//                         absence is a FAILURE and not a posture
//   some supplied       → FAIL, always, on every lane. Three of four values is
//                         an artifact nobody can explain, and Play accepts a
//                         given upload key exactly once.
//
// ⚠️ THIS SCRIPT IS NOT THE PROOF. It says what it INTENDS; it cannot say what
// Gradle did. `tooling/ci/assert-artifact-signed.mjs` reads the signature out of
// the built .aab and compares the real signer against the posture exported here.
// That pairing is deliberate: a step that arranges a credential and then reports
// its own success is the "green means ran" failure with extra steps.
//
// ── WHAT IS DELIBERATELY *NOT* CHECKED HERE ──────────────────────────────────
// The password is NOT verified against the keystore, and no `keytool` is
// invoked. Two reasons, both learned in this tree. A `keytool -list` needs the
// password on argv or on stdin and adds a second way for the step to fail
// WRONGLY — a guard that fires on correct input is one the next person deletes.
// And the backstop already exists and is stronger: a wrong password fails the
// Gradle signer loudly, and a right password that produced the wrong signature
// is caught by reading the artifact. What IS checked here is the one thing no
// later step can attribute — that the base64 decodes and the bytes are a
// keystore rather than, say, an HTML error page somebody pasted into a secret.
//
// ── NAMES COME FROM GRADLE, NEVER FROM THIS FILE ─────────────────────────────
// The four environment-variable names are PARSED OUT OF build.gradle.kts, the
// same way tooling/release/submit-play.mjs does it and for the same reason: two
// copies of that list drift, and the drift is SILENT — this script would export
// `ANDROID_KEY_ALIAS` forever while Gradle had been renamed to read something
// else, and every build would fall back to debug with both halves reporting
// success. Deleting the Gradle block therefore fails HERE, rather than quietly
// reverting the release build to an unconditional debug config.
//
// ── THE KEYSTORE IS WRITTEN OUTSIDE THE REPOSITORY, ON PURPOSE ───────────────
// $RUNNER_TEMP, never the workspace. Every `actions/upload-artifact` path in
// this repo is workspace-relative, so a keystore inside the tree is one broad
// `path:` away from being published — and on a PUBLIC repo an artifact is
// downloadable by anyone. `apps/<app>/android/key.properties` is gitignored,
// which protects the commit and does nothing about the upload. Outside the tree
// there is no glob that can reach it.
//
// ── WHY IT LIVES IN tooling/ci AND NOT IN tooling/release ───────────────────
// It runs only inside a GitHub job ($RUNNER_TEMP, $GITHUB_ENV) and it is not a
// submission path. `tooling/release/` carries an invariant a guard enforces —
// assert-channel-register.mjs fails any `.mjs` there that no channel row names in
// its `submission.script` — and filing a build-time helper alongside the four
// submit-*.mjs would have meant weakening that rule to accommodate a file, which
// is the wrong direction. Placed here it acquires the tooling/ci obligations
// instead (invoked by a workflow, named by a test, carries its own COVERAGE LOST),
// all of which it genuinely owes.
//
// Usage:
//   node tooling/ci/android-signing.mjs [--app <slug>] [--out <dir>]
//                                       [--repo-root <path>] [--github-env <path>]
// Env in:  ANDROID_KEYSTORE_BASE64 (+ the three names Gradle declares)
//          GITHUB_REF, GITHUB_WORKFLOW_REF — read to DERIVE whether this is a
//          release lane; see the block below. There is deliberately no flag a
//          workflow can set or forget.
// Env out (via $GITHUB_ENV): the four Gradle variables + ANDROID_SIGNING_POSTURE
// Exit 0 = the posture is decided and legal for this lane. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const APPS = 'sites/_shared/_data/apps.json';
const REGISTER = 'tooling/channel-register.json';
const CHANNEL_ID = 'android-play';
/** The transport for the keystore FILE. It is not one of Gradle's four names —
 *  Gradle wants a path, and a path cannot travel through a repository secret —
 *  so this is the one name declared here rather than parsed out of the build. */
const B64_ENV = 'ANDROID_KEYSTORE_BASE64';
/** The Gradle map key whose value this script PRODUCES rather than passes through. */
const PATH_KEY = 'storeFile';
const POSTURE_ENV = 'ANDROID_SIGNING_POSTURE';
const RELEASE_SIGNED = 'release-signed';
const DEBUG_PROOF = 'debug-signed-build-proof';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

/** 🔴 AN EMPTY STRING IS NOT AN UNSET VARIABLE, and `??` cannot tell them apart.
 *  Found by mutation run 2026-08-04: with `GITHUB_ENV=''` in the environment —
 *  which a shell produces by exporting an empty value — `?? null` yielded `''`,
 *  the null check passed, and the script CRASHED with `ENOENT: open ''` after
 *  printing a successful posture. The same shape with `RUNNER_TEMP=''` is worse
 *  and silent: `resolve('')` is the CURRENT DIRECTORY, so the keystore would have
 *  been written INSIDE the repository, which is the one place this file exists to
 *  keep it out of. Neither would ever have fired on a real runner, where both are
 *  always set — and "it cannot happen in production" is how both survive review. */
const envOr = (name, fallback) => {
  const v = (process.env[name] ?? '').trim();
  return v === '' ? fallback : v;
};

const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const OUT_DIR = resolve(opt('out') ?? envOr('RUNNER_TEMP', tmpdir()));
const GITHUB_ENV = opt('github-env') ?? envOr('GITHUB_ENV', null);

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

/** The scan cannot continue and reporting a posture would be a claim about
 *  nothing. Same idiom as every guard in tooling/ci. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nandroid-signing: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nandroid-signing: FAILED');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// IS THIS A RELEASE LANE? — DERIVED, NEVER DECLARED IN THE WORKFLOW.
//
// 🔴 THE FIRST DRAFT OF THIS FILE READ AN `ANDROID_SIGNING_REQUIRED: 'true'` LINE
// OUT OF THE YAML, AND THAT WAS THE SAME MISTAKE ONE LEVEL UP. The whole defect
// being repaired here is a switch that was never thrown: a correct fallback with
// nothing supplying the values. A hand-written flag in a workflow is a switch of
// exactly that kind — delete the line and the submission lane silently reverts to
// producing a build proof, with every check still green, which is the shape this
// entire change exists to remove. So the question is asked of things that cannot
// be deleted from a workflow file:
//
//   (a) A TAG PUSH. `GITHUB_REF` starting `refs/tags/` is a release by every
//       reading — build-platforms.yml's only release trigger is `tags: subly-v*`
//       — and it is set by GitHub, not by us.
//   (b) THE CHANNEL'S DECLARED SUBMISSION PATH. tooling/channel-register.json
//       names the workflow that submits to Play ([10]D-10 limb (i)); a workflow
//       whose whole subject is a submittable bundle may not produce one that
//       cannot be submitted. `GITHUB_WORKFLOW_REF` is the running workflow's own
//       path, also set by GitHub.
//
// Everything else — a branch push, a pull request, a fork, the weekly
// six-platform proof, a manual dispatch on main — is a BUILD PROOF and is allowed
// to be unsigned, provided it says so. That scoping is not caution: the weekly
// run feeds assert-platform-proof-fresh.mjs, which fails ci-gate when the proof
// is 14 days old, so demanding secrets there would let one missing secret block
// every merge in the repository.
// ─────────────────────────────────────────────────────────────────────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'It names the workflow that submits to Play, which is half of how this script decides whether an',
    'unsigned build is legal here. Without it that decision would be made blind and would default to',
    '"a build proof is fine" — on the one lane where it is not.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}
const channel = (register.channels ?? []).find((c) => c.id === CHANNEL_ID);
if (!channel) {
  coverageLost([
    `${REGISTER} declares no "${CHANNEL_ID}" channel.`,
    'That row is where the submission workflow is declared. With it gone, limb (b) below silently stops',
    'recognising the submission lane and a dry run over a debug-signed bundle would pass.',
  ]);
}

const gitRef = (process.env.GITHUB_REF ?? '').trim();
const workflowRef = (process.env.GITHUB_WORKFLOW_REF ?? '').trim();
const submissionWorkflow = typeof channel.submission?.workflow === 'string' ? channel.submission.workflow : null;

const reasons = [];
if (gitRef.startsWith('refs/tags/')) reasons.push(`the run is a TAG push (${gitRef})`);
if (submissionWorkflow !== null && workflowRef !== '') {
  // `owner/repo/.github/workflows/x.yml@refs/heads/main` — compare the PATH part
  // only. Matching the whole string would tie the answer to a branch name.
  const runningPath = workflowRef.split('@')[0];
  if (runningPath.endsWith(`/${submissionWorkflow}`) || runningPath === submissionWorkflow) {
    reasons.push(`this is ${CHANNEL_ID}'s declared submission workflow (${submissionWorkflow})`);
  }
}
const REQUIRED = reasons.length > 0;

/** Signals that could not contribute, printed rather than assumed away: a
 *  derivation missing an input answers a narrower question than it claims to. */
const blind = [];
if (submissionWorkflow === null) {
  blind.push(`${REGISTER}'s ${CHANNEL_ID} row declares no \`submission.workflow\`, so limb (b) contributed nothing — only a tag push can mark a release here.`);
}
if (workflowRef === '' && submissionWorkflow !== null) {
  blind.push('GITHUB_WORKFLOW_REF is unset (not a GitHub job), so limb (b) could not be evaluated.');
}

// ── which app ────────────────────────────────────────────────────────────────
const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — there is no app to sign for.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);

const appId = opt('app') ?? apps[0]?.slug;
const app = apps.find((a) => a.slug === appId);
if (!app) die([`FAIL no app "${appId}" in ${APPS}.`, `     Known: ${apps.map((a) => a.slug).join(', ')}`]);

// ── the four names, read out of the build itself ─────────────────────────────
const gradleRel = `apps/${app.slug}/android/app/build.gradle.kts`;
const gradleText = read(gradleRel);
if (gradleText === null) {
  coverageLost([
    `${gradleRel} does not exist.`,
    'It is the only declaration of which environment variables the release signing config reads, so',
    'this script would export a set of names nothing consumes and report a posture it cannot deliver.',
  ]);
}
// The `releaseSigningEnv` mapOf. Identical matcher to submit-play.mjs — one
// shape, read the same way by both, so they cannot disagree about what Gradle
// wants.
const envPairs = [...gradleText.matchAll(/"(\w+)"\s+to\s+"([A-Z0-9_]+)"/g)].map((m) => [m[1], m[2]]);
if (envPairs.length === 0) {
  coverageLost([
    `${gradleRel} declares no release-signing environment map.`,
    'With it gone the release build is unconditionally debug-signed and this script cannot tell — it',
    'would export the names it expected instead of the ones the build reads.',
  ]);
}
const envOf = new Map(envPairs);
if (!envOf.has(PATH_KEY)) {
  coverageLost([
    `${gradleRel} declares a signing env map with no "${PATH_KEY}" key (found ${[...envOf.keys()].join(', ')}).`,
    'That key names the variable this script WRITES; without it the decoded keystore would be left on',
    'disk with nothing pointing at it and the build would silently fall back to debug.',
  ]);
}
const PATH_VAR = envOf.get(PATH_KEY);
/** Names passed straight through from repository secrets — everything Gradle
 *  reads except the path, which is produced below. */
const PASSTHROUGH = envPairs.filter(([k]) => k !== PATH_KEY).map(([, v]) => v);

// ── what was actually supplied ───────────────────────────────────────────────
const value = (name) => (process.env[name] ?? '').trim();
const wanted = [B64_ENV, ...PASSTHROUGH];
const supplied = wanted.filter((n) => value(n) !== '');
const missing = wanted.filter((n) => value(n) === '');

console.log(`── Android signing · app "${app.slug}" · lane requires signing: ${REQUIRED ? 'YES' : 'no'} ──`);
for (const r of reasons) console.log(`   required because ${r}`);
if (!REQUIRED) console.log('   no release signal (not a tag push, not the declared submission workflow) — a BUILD PROOF is legal here');
for (const b of blind) console.log(`   ⬜ ${b}`);

// ── the three endings ────────────────────────────────────────────────────────
if (supplied.length > 0 && missing.length > 0) {
  // ALWAYS fatal, on every lane, and this is the one interesting decision in the
  // file. Falling back to debug with three of four values present produces a
  // debug-signed artifact from a run that looked like a signing run. Gradle
  // refuses the same state for the same reason; this refuses it EARLIER, so the
  // message names the secrets rather than a Kotlin exception.
  die([
    'FAIL Android signing is HALF configured and this build refuses to guess.',
    `     supplied: ${supplied.join(', ')}`,
    `     missing:  ${missing.join(', ')}`,
    '     Supply all of them or none. Three of four produces a debug-signed .aab from a run that',
    '     looked like a signing run — and Google Play accepts a given upload key exactly once, so',
    '     the artifact that gets uploaded is the one nobody can explain afterwards.',
  ]);
}

if (supplied.length === 0) {
  if (REQUIRED) {
    // 🔴 THE WHOLE POINT OF THE FILE. Before this existed, this branch produced a
    // debug-signed .aab and exit 0.
    die([
      'FAIL this is a RELEASE lane and no Android signing secrets are configured.',
      `     absent: ${wanted.join(', ')}`,
      '',
      '     A release lane that cannot sign must not produce an artifact. Google Play rejects a',
      '     debug-signed upload, so continuing here would spend a build, an artifact and a version',
      '     code to arrive at a bundle that cannot be submitted — with every check green.',
      '',
      '     Create the four repository secrets (Settings → Secrets and variables → Actions):',
      `       ${B64_ENV}      base64 of the upload keystore file`,
      ...PASSTHROUGH.map((n) => `       ${n}`),
      '     …or run this lane on a non-release trigger, where an unsigned BUILD PROOF is the',
      '     recorded, labelled outcome rather than a silent one.',
    ]);
  }
  // The legal unsigned ending — and it is LABELLED, which is the difference
  // between a build proof and the defect. A fork PR holds no secrets, so this is
  // the only outcome available there and it must stay a passing one.
  console.log('');
  console.log(`⬜ SIGNING POSTURE: ${DEBUG_PROOF.toUpperCase()}`);
  console.log('   No Android signing secrets are set, so Gradle falls back to the debug signing config.');
  console.log('   🔴 A DEBUG-SIGNED .aab CANNOT BE UPLOADED TO GOOGLE PLAY. This artifact is a build');
  console.log('      proof: it proves the Android module compiles, and nothing about the release key.');
  console.log('   This is the correct outcome for a branch, a fork PR and the weekly platform proof.');
  exportEnv({ [POSTURE_ENV]: DEBUG_PROOF });
  console.log('\nandroid-signing: OK (unsigned build proof, labelled)');
  process.exit(0);
}

// ── all supplied: materialise the keystore ───────────────────────────────────
// Every value is validated BEFORE anything is written. The first live run wrote
// the keystore and then refused the export, leaving a real key on disk from a
// run that failed — a half-state, and this repo does not ship those.
assertExportable(Object.fromEntries(PASSTHROUGH.map((n) => [n, value(n)])));

const b64 = value(B64_ENV).replace(/\s+/g, '');
if (b64 === '') coverageLost([`${B64_ENV} is whitespace only after trimming — it passed the presence check and carries nothing.`]);

const bytes = Buffer.from(b64, 'base64');
// Buffer.from ignores anything that is not base64 rather than throwing, so a
// secret that was pasted with a stray fragment decodes to SOMETHING and the
// truncation is discovered by the signer, later, in a message about a keystore
// format. Re-encoding and comparing is the only way to see it here.
if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
  die([
    `FAIL ${B64_ENV} is not valid base64 (it decodes to ${bytes.length} byte(s) and does not round-trip).`,
    '     The value is never printed. Re-create it from the keystore file with a tool that emits a',
    '     single unbroken base64 string, and paste it without added line breaks or quotes.',
  ]);
}
// A keystore is either DER (PKCS12 — a SEQUENCE, 0x30) or one of the two Java
// magics. Anything else is a file somebody pasted by mistake: an HTML error
// page, a PEM, a truncated download. Structure, not a size floor — an invented
// minimum length would fire on a correct small keystore and pass a padded stub.
const JKS = 0xfeedfeed;
const JCEKS = 0xcececece;
const looksLikeKeystore =
  bytes[0] === 0x30 || (bytes.length >= 4 && (bytes.readUInt32BE(0) === JKS || bytes.readUInt32BE(0) === JCEKS));
if (!looksLikeKeystore) {
  die([
    `FAIL ${B64_ENV} decodes to ${bytes.length} byte(s) that are not a keystore.`,
    '     Expected DER (PKCS12, first byte 0x30) or a JKS/JCEKS magic number; found first byte',
    `     0x${bytes[0]?.toString(16).padStart(2, '0') ?? '--'}. No part of the value is printed.`,
    '     The usual cause is base64 of the wrong file, or of an error page a download produced.',
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
const keystorePath = join(OUT_DIR, `${app.slug}-upload.keystore`);
if (!isAbsolute(keystorePath)) {
  coverageLost([`the resolved keystore path ${keystorePath} is not absolute.`, 'Gradle resolves a relative storeFile against the android/ directory, which is not where this wrote it.']);
}
// 0600 on a POSIX runner; Windows ignores the mode and its ACL already limits
// $RUNNER_TEMP to the run. Written outside the workspace either way — see header.
writeFileSync(keystorePath, bytes, { mode: 0o600 });

const exported = { [PATH_VAR]: keystorePath, [POSTURE_ENV]: RELEASE_SIGNED };
for (const n of PASSTHROUGH) exported[n] = value(n);
exportEnv(exported);

console.log('');
console.log(`ok   keystore materialised — ${bytes.length} byte(s) written outside the workspace`);
console.log(`ok   ${PATH_VAR} points at it; ${PASSTHROUGH.length} further variable(s) exported (values never printed)`);
console.log(`⬜ SIGNING POSTURE: ${RELEASE_SIGNED.toUpperCase()}`);
console.log('   This says what was ARRANGED, not what Gradle did. tooling/ci/assert-artifact-signed.mjs');
console.log('   reads the signature out of the built .aab and fails if it disagrees with this line.');
console.log('\nandroid-signing: OK');

/**
 * Append to $GITHUB_ENV so every later step in the job sees the same complete
 * set.
 *
 * 🔴 ALL FOUR OR NONE, AND THAT IS WHY THIS IS ONE CALL. Exporting only the
 * path — the tidier-looking option, with the passwords attached to each build
 * step instead — makes every OTHER reader of the environment see one variable of
 * four and conclude the config is HALF supplied. tooling/release/submit-play.mjs
 * does exactly that check and would have failed the submission path on a
 * correctly configured run.
 *
 * A value containing a newline is refused (see `assertExportable`).
 */
function exportEnv(pairs) {
  assertExportable(pairs);
  if (GITHUB_ENV === null) {
    // Not a failure: this script is runnable by hand. It is also not a silent
    // pass — assert-artifact-signed.mjs requires ANDROID_SIGNING_POSTURE to be
    // present and refuses to run without it, so a build in which this export did
    // not happen fails there rather than proceeding unlabelled.
    console.log('');
    console.log('⬜ NOT EXPORTED — no $GITHUB_ENV and no --github-env, so nothing was written for later');
    console.log('   steps. Outside a GitHub job that is expected. Inside one it is a wiring fault, and');
    console.log('   assert-artifact-signed.mjs refuses to run without ANDROID_SIGNING_POSTURE.');
    for (const k of Object.keys(pairs)) console.log(`   would export: ${k}`);
    return;
  }
  appendFileSync(GITHUB_ENV, `${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
}

/**
 * A newline in a value is REFUSED rather than escaped. `$GITHUB_ENV` is
 * line-oriented, so a value carrying one writes a SECOND assignment of the
 * writer's choosing into the environment of every later step in the job — a
 * secret becomes a way to set PATH. No keystore credential contains a line
 * break, so refusing costs nothing and the alternative (a heredoc with a random
 * delimiter) only moves the same question to the delimiter.
 */
function assertExportable(pairs) {
  for (const [k, v] of Object.entries(pairs)) {
    if (/[\r\n]/.test(v)) {
      die([
        `FAIL the value for ${k} contains a line break, and $GITHUB_ENV is line-oriented.`,
        '     Writing it would inject a second, attacker-chosen assignment into the job environment.',
        '     Re-create the secret without the trailing newline. The value itself is never printed.',
      ]);
    }
  }
}
