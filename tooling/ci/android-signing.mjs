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
// ── ONE SCRIPT, TWO ROWS: THE KEY IS CHOSEN BY THE REGISTER ROW ─────────────
// Two register rows name this file as their `signing.seam.prepare`: android-play
// (the Play UPLOAD key) and apps-gov-in (that store's own APP-SIGNING key).
// `--channel <id>` says which row this run signs for; it defaults to android-play,
// so the bare `--app <slug>` form behaves as it always has. The row decides three
// things the workflow used to decide with `env -u`:
//
//   · WHICH SECRETS. A row whose `ciSecrets.gradleContract` carries `mapsOnto`
//     is read from its OWN names (APPSGOVIN_*) and each is translated onto the
//     Gradle variable the map names. The workflow no longer renames secrets into
//     ANDROID_* for one step.
//   · WHETHER A RELEASE LANE MUST SIGN. The ref says "this is a release"; the
//     row's arming (channel-arming.mjs, asked through the seam's `releaseLane`)
//     says whether an unsigned artifact from it could reach a user. An unarmed
//     row on a tag push PRINTS the gap and ends as a labelled build proof; an
//     armed one FAILS. The workflow no longer unsets GITHUB_REF to get that.
//   · WHERE THE RESULT GOES. A `mapsOnto` row writes ONLY the keystore path and
//     the posture, and only to `--github-output <file>` — never to $GITHUB_ENV,
//     which would overwrite the Play key's variables for every later step of the
//     job. `--github-env` on such a row is refused, and the job's own
//     $GITHUB_ENV is not read for it. The passwords reach Gradle from the build
//     step's own `env:`, straight from the secrets.
//
// The primitives — the all-or-none law, the release lane, the base64 decode, the
// key placement and the export — are signing-seam.mjs's; this file is the
// adapter: the rows, the Gradle names, the messages and the exits.
//
// Usage:
//   node tooling/ci/android-signing.mjs [--app <slug>] [--channel <id>] [--out <dir>]
//                                       [--repo-root <path>]
//                                       [--github-env <path> | --github-output <path>]
// Env in:  the row's secret names — for android-play ANDROID_KEYSTORE_BASE64 (+ the
//          three names Gradle declares); for a `mapsOnto` row, its `ciSecrets.names`
//          GITHUB_REF, GITHUB_WORKFLOW_REF — read to DERIVE whether this is a
//          release lane; see the block below. There is deliberately no flag a
//          workflow can set or forget.
// Out:     android-play — via $GITHUB_ENV: the four Gradle variables + ANDROID_SIGNING_POSTURE
//          a `mapsOnto` row — via --github-output: the path variable + ANDROID_SIGNING_POSTURE
// Exit 0 = the posture is decided and legal for this lane. 1 = it is not.
//      2 = COVERAGE LOST — the question could not be asked (register, row or input missing).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { decideSecretSet, releaseLane, decodeKey, placeKey, newlineOffenders, exportEnv } from './signing-seam.mjs';
import { armedFatalLines, unarmedGapLines } from './channel-arming.mjs';

const APPS = 'catalog/apps.json';
const REGISTER = 'tooling/channel-register.json';
/** The row a bare `--app` run signs for. */
const CHANNEL_DEFAULT = 'android-play';
/** A row may be signed here only if it names this file as its prepare seam. */
const ADAPTER = 'tooling/ci/android-signing.mjs';
/** The transport for the keystore FILE on android-play. It is not one of Gradle's
 *  four names — Gradle wants a path, and a path cannot travel through a repository
 *  secret — so this is the one name declared here rather than parsed out of the
 *  build. A `mapsOnto` row declares its own in `gradleContract.transport.name`. */
const B64_ENV = 'ANDROID_KEYSTORE_BASE64';
/** The Gradle map key whose value this script PRODUCES rather than passes through. */
const PATH_KEY = 'storeFile';
const POSTURE_ENV = 'ANDROID_SIGNING_POSTURE';
const RELEASE_SIGNED = 'release-signed';
const DEBUG_PROOF = 'debug-signed-build-proof';
/** A keystore is DER (PKCS12 — a SEQUENCE, 0x30) or one of the two Java magics,
 *  JKS 0xfeedfeed and JCEKS 0xcececece. Anything else is a file somebody pasted
 *  by mistake: an HTML error page, a PEM, a truncated download. Structure, not a
 *  size floor — an invented minimum length would fire on a correct small keystore
 *  and pass a padded stub. */
const KEYSTORE_MAGIC = [[0x30], [0xfe, 0xed, 0xfe, 0xed], [0xce, 0xce, 0xce, 0xce]];

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
const CHANNEL_ID = opt('channel') ?? CHANNEL_DEFAULT;
// Chosen by the caller (--out) or by the runner ($RUNNER_TEMP, private to the job),
// or null. When null, the keystore goes into a FRESH private directory created at
// write time (mkdtempSync: random suffix, owner-only), never a predictable name in
// the shared temp dir that anyone can pre-create as a symlink (the CodeQL #93 class; the same
// remedy apple-signing.mjs already carries). Decided lazily, so importing this
// module or a run that refuses early creates nothing.
const OUT_DIR_CHOSEN = opt('out') ?? envOr('RUNNER_TEMP', null);
const GITHUB_ENV_FLAG = opt('github-env');
const GITHUB_OUTPUT_FLAG = opt('github-output');

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

/** The scan cannot continue and reporting a posture would be a claim about
 *  nothing. Same idiom as every guard in tooling/ci. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nandroid-signing: FAILED');
  // ⏱ 2026-09-16 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
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
//       reading — build-platforms.yml's only release trigger is `tags: subscriptiontracker-v*`
//       — and it is set by GitHub, not by us.
//   (b) THE CHANNEL'S DECLARED SUBMISSION PATH. tooling/channel-register.json
//       names the workflow that submits to Play ([10]D-10 limb (i)); a workflow
//       whose whole subject is a submittable bundle may not produce one that
//       cannot be submitted. `GITHUB_WORKFLOW_REF` is the running workflow's own
//       path, also set by GitHub.
//
// A release lane then FAILS without a key only when the row is ARMED — when an
// unsigned artifact from it could reach a user (channel-arming.mjs). Everything
// else — a branch push, a pull request, a fork, the weekly six-platform proof, a
// manual dispatch on main, a tag build for a row that ships nothing yet — is a
// BUILD PROOF and is allowed to be unsigned, provided it says so. That scoping is
// not caution: the weekly run feeds assert-platform-proof-fresh.mjs, which fails
// ci-gate when the proof is 14 days old, so demanding secrets there would let one
// missing secret block every merge in the repository.
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
const channel = (register.channels ?? []).find((c) => c?.id === CHANNEL_ID);
if (!channel) {
  coverageLost([
    `${REGISTER} declares no "${CHANNEL_ID}" channel.`,
    'That row is where the submission workflow is declared. With it gone, limb (b) below silently stops',
    'recognising the submission lane and a dry run over a debug-signed bundle would pass.',
  ]);
}
const prepare = channel.signing?.seam?.prepare;
if (typeof prepare === 'string' && prepare !== ADAPTER) {
  die([
    `FAIL channel "${CHANNEL_ID}" is signed by ${prepare}, not by ${ADAPTER}.`,
    `     ${REGISTER} names the prepare seam per row; this script signs only the rows that name it.`,
  ]);
}

const { lane, gap, mustSign } = releaseLane({
  rows: [channel],
  gitRef: (process.env.GITHUB_REF ?? '').trim(),
  workflowRef: (process.env.GITHUB_WORKFLOW_REF ?? '').trim(),
  label: 'Android',
});

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
/** Names Gradle reads straight from the environment — everything except the
 *  path, which is produced below. */
const PASSTHROUGH = envPairs.filter(([k]) => k !== PATH_KEY).map(([, v]) => v);

// ── where each Gradle value comes from: the row's own names, or Gradle's ────
const contract = channel.signing?.ciSecrets?.gradleContract ?? null;
const mapsOnto = contract?.mapsOnto ?? null;
const MAPPED = mapsOnto !== null;
const declaredTransport = contract?.transport?.name ?? null;
/** Gradle variable → the environment name its value is read from. */
const sourceOf = new Map(PASSTHROUGH.map((g) => [g, g]));
let TRANSPORT = B64_ENV;
if (!MAPPED) {
  if (declaredTransport !== null && declaredTransport !== B64_ENV) {
    coverageLost([
      `${REGISTER}'s "${CHANNEL_ID}" row declares transport ${declaredTransport}, and a row without \`mapsOnto\` is read under Gradle's own names with ${B64_ENV} as the transport.`,
      'The row and this script disagree about which secret carries the keystore, so neither can be taken as the answer.',
    ]);
  }
} else {
  const names = channel.signing?.ciSecrets?.names;
  if (typeof mapsOnto !== 'object' || !Array.isArray(names) || typeof declaredTransport !== 'string' || !names.includes(declaredTransport)) {
    coverageLost([
      `${REGISTER}'s "${CHANNEL_ID}" row carries \`gradleContract.mapsOnto\` without a \`ciSecrets.names\` list that includes its \`transport.name\`.`,
      'Those are the names this row is signed from; without them there is no set to read.',
    ]);
  }
  TRANSPORT = declaredTransport;
  const rest = names.filter((n) => n !== declaredTransport);
  const onto = rest.map((n) => mapsOnto[n]);
  const same = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  if (onto.some((g) => typeof g !== 'string') || !same(Object.keys(mapsOnto), rest) || !same(onto, PASSTHROUGH)) {
    coverageLost([
      `${REGISTER}'s "${CHANNEL_ID}" \`mapsOnto\` does not translate its names onto exactly the variables ${gradleRel} reads.`,
      `     names (less the transport): ${rest.join(', ')}`,
      `     mapsOnto:                   ${Object.entries(mapsOnto).map(([k, v]) => `${k}→${v}`).join(', ')}`,
      `     Gradle reads:               ${PASSTHROUGH.join(', ')}`,
      'A value mapped onto a variable Gradle does not read is dropped, and one Gradle reads that nothing',
      'feeds leaves the set HALF supplied at the build step — both decided here, before a key is written.',
    ]);
  }
  for (const n of rest) sourceOf.set(mapsOnto[n], n);
}
if (MAPPED && GITHUB_ENV_FLAG !== null) {
  die([
    `FAIL --github-env was given for channel "${CHANNEL_ID}", whose row carries \`mapsOnto\`.`,
    '     This row\'s key is fed to Gradle for ONE build step. Written to $GITHUB_ENV it would replace the',
    '     Play upload key\'s variables for every later step of the job. Use --github-output <file>.',
  ]);
}
if (!MAPPED && GITHUB_OUTPUT_FLAG !== null) {
  die([
    `FAIL --github-output was given for channel "${CHANNEL_ID}", whose row carries no \`mapsOnto\`.`,
    '     Its variables are the job\'s own and go to $GITHUB_ENV (--github-env), where every later step reads them.',
  ]);
}
/** $GITHUB_ENV for android-play; the step-output file for a `mapsOnto` row, for
 *  which the job's own $GITHUB_ENV is never read. */
const DEST = MAPPED ? GITHUB_OUTPUT_FLAG : (GITHUB_ENV_FLAG ?? envOr('GITHUB_ENV', null));

// ── what was actually supplied ───────────────────────────────────────────────
const value = (name) => (process.env[name] ?? '').trim();
const wanted = [TRANSPORT, ...PASSTHROUGH.map((g) => sourceOf.get(g))];
const set = decideSecretSet(wanted, process.env);

console.log(`── Android signing · app "${app.slug}" · channel "${CHANNEL_ID}" · lane requires signing: ${mustSign ? 'YES' : 'no'} ──`);
for (const r of lane.reasons) console.log(`   required because ${r}`);
if (!lane.required) console.log('   no release signal (not a tag push, not the declared submission workflow) — a BUILD PROOF is legal here');
for (const b of lane.blind) console.log(`   ⬜ ${b}`);

/** The labelled unsigned ending — the difference between a build proof and the defect. */
function debugProofEnding() {
  console.log('');
  console.log(`⬜ SIGNING POSTURE: ${DEBUG_PROOF.toUpperCase()}`);
  console.log(`   No signing secrets are set for "${CHANNEL_ID}", so Gradle falls back to the debug signing config.`);
  console.log('   🔴 A DEBUG-SIGNED ARTIFACT CANNOT BE UPLOADED TO A STORE. This one is a build proof: it');
  console.log('      proves the Android module compiles, and nothing about the release key.');
  console.log('   This is the correct outcome for a branch, a fork PR, the weekly platform proof, and a');
  console.log('   release build for a channel that is not armed.');
  exportEnv({ [POSTURE_ENV]: DEBUG_PROOF }, DEST, { fail: die, unexported: unexportedLines() });
  console.log('\nandroid-signing: OK (unsigned build proof, labelled)');
  process.exit(0);
}

function unexportedLines() {
  return MAPPED
    ? ['   --github-output was not given, and this row never writes $GITHUB_ENV. The build step reads', '   ANDROID_SIGNING_POSTURE from that file.']
    : ['   assert-artifact-signed.mjs refuses to run without ANDROID_SIGNING_POSTURE.'];
}

// ── the endings ──────────────────────────────────────────────────────────────
if (set.kind === 'partial') {
  // ALWAYS fatal, on every lane, and this is the one interesting decision in the
  // file. Falling back to debug with three of four values present produces a
  // debug-signed artifact from a run that looked like a signing run. Gradle
  // refuses the same state for the same reason; this refuses it EARLIER, so the
  // message names the secrets rather than a Kotlin exception.
  die([
    'FAIL Android signing is HALF configured and this build refuses to guess.',
    `     supplied: ${set.supplied.join(', ')}`,
    `     missing:  ${set.missing.join(', ')}`,
    '     Supply all of them or none. Three of four produces a debug-signed artifact from a run that',
    '     looked like a signing run — and Google Play accepts a given upload key exactly once, so',
    '     the artifact that gets uploaded is the one nobody can explain afterwards.',
  ]);
}

if (set.kind === 'none') {
  if (mustSign) {
    // 🔴 THE WHOLE POINT OF THE FILE. Before this existed, this branch produced a
    // debug-signed .aab and exit 0.
    die([
      'FAIL this is a RELEASE lane and no Android signing secrets are configured.',
      `     absent: ${wanted.join(', ')}`,
      ...armedFatalLines(gap.armed),
      '',
      '     A release lane that cannot sign must not produce an artifact. Google Play rejects a',
      '     debug-signed upload, so continuing here would spend a build, an artifact and a version',
      '     code to arrive at a bundle that cannot be submitted — with every check green.',
      '',
      '     Create the repository secrets (Settings → Secrets and variables → Actions):',
      `       ${TRANSPORT}      base64 of the keystore file`,
      ...wanted.filter((n) => n !== TRANSPORT).map((n) => `       ${n}`),
      '     …or run this lane on a non-release trigger, where an unsigned BUILD PROOF is the',
      '     recorded, labelled outcome rather than a silent one.',
    ]);
  }
  if (lane.required) {
    console.log('');
    for (const l of unarmedGapLines({
      armings: gap.unarmed,
      secretNames: wanted,
      laneReasons: lane.reasons,
      ownerItem: `mint the "${CHANNEL_ID}" key and create its secrets (${wanted.join(', ')}).`,
    })) {
      console.log(l);
    }
  }
  debugProofEnding();
}

// ── all supplied: materialise the keystore ───────────────────────────────────
// Every value is validated BEFORE anything is written. The first live run wrote
// the keystore and then refused the export, leaving a real key on disk from a
// run that failed — a half-state, and this repo does not ship those. A line break
// is refused for every value, including the ones a `mapsOnto` row never exports.
const offenders = newlineOffenders(Object.fromEntries(wanted.filter((n) => n !== TRANSPORT).map((n) => [n, value(n)])));
if (offenders.length) {
  die([
    `FAIL the value for ${offenders.join(', ')} contains a line break, and $GITHUB_ENV is line-oriented.`,
    '     Writing it would inject a second, attacker-chosen assignment into the job environment.',
    '     Re-create the secret without the trailing newline. The value itself is never printed.',
  ]);
}

const key = decodeKey(value(TRANSPORT), { name: TRANSPORT, magic: KEYSTORE_MAGIC });
if (key.problem === 'empty') coverageLost(key.lines);
if (key.problem === 'not-base64') die(key.lines);
if (key.problem === 'magic') {
  die([
    `FAIL ${TRANSPORT} decodes to ${key.length} byte(s) that are not a keystore.`,
    '     Expected DER (PKCS12, first byte 0x30) or a JKS/JCEKS magic number; found first byte(s)',
    `     ${key.found}. No part of the value is printed.`,
    '     The usual cause is base64 of the wrong file, or of an error page a download produced.',
  ]);
}

const OUT_DIR = OUT_DIR_CHOSEN !== null ? resolve(OUT_DIR_CHOSEN) : mkdtempSync(join(tmpdir(), 'android-signing-'));
const keystorePath = join(OUT_DIR, `${app.slug}-upload.keystore`);
// 0600 on a POSIX runner; Windows ignores the mode and its ACL already limits
// $RUNNER_TEMP to the run. Written outside the workspace either way — see header.
const refused = placeKey(keystorePath, key.bytes);
if (refused !== null) {
  coverageLost([...refused, 'Gradle resolves a relative storeFile against the android/ directory, which is not where this wrote it.']);
}

// 🔴 ALL FOUR OR NONE for android-play, and that is why this is one call.
// Exporting only the path — the tidier-looking option, with the passwords attached
// to each build step instead — makes every OTHER reader of the environment see one
// variable of four and conclude the config is HALF supplied.
// tooling/release/submit-play.mjs does exactly that check. A `mapsOnto` row is the
// reverse case: its step output carries the path and the posture only, and the
// build step reads the passwords from its own `env:`.
const exported = { [PATH_VAR]: keystorePath, [POSTURE_ENV]: RELEASE_SIGNED };
if (!MAPPED) for (const g of PASSTHROUGH) exported[g] = value(g);
exportEnv(exported, DEST, { fail: die, unexported: unexportedLines() });

console.log('');
console.log(`ok   keystore materialised — ${key.bytes.length} byte(s) written outside the workspace`);
console.log(
  MAPPED
    ? `ok   ${PATH_VAR} points at it; the ${PASSTHROUGH.length} password/alias value(s) stay with the build step (values never printed)`
    : `ok   ${PATH_VAR} points at it; ${PASSTHROUGH.length} further variable(s) exported (values never printed)`,
);
console.log(`⬜ SIGNING POSTURE: ${RELEASE_SIGNED.toUpperCase()}`);
console.log('   This says what was ARRANGED, not what Gradle did. The row\'s verify seam reads the');
console.log('   signature out of the built artifact and fails if it disagrees with this line.');
console.log('\nandroid-signing: OK');
