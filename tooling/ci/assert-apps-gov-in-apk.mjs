#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-apps-gov-in-apk.mjs — read the BUILT apps.gov.in .apk back, decide
// whether it may ever be taken to the portal, and NAME the artifact from what
// was read rather than from what the lane intended.
//
// Register row: O-APPS-GOV-IN-CHANNEL-APK (Private open.json, due 2026-10-06).
// Register seam: tooling/channel-register.json `apps-gov-in.signing.seam.verify`
// names this file; assert-channel-register.mjs refuses a seam whose script is gone.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// A Mobile Seva upload is a SELF-SIGNED .apk. There is no Play App Signing to
// hold the real key and re-sign for us: whichever key signs the upload is the
// key every install from that store is bound to, forever. So "which key signed
// this file" is the one question the lane must answer by READING the file. The
// owner decided the key on 2026-09-22 (its own, alias `nikatru-appsgovin`,
// never the Play upload key) and has not minted it yet, so the register pin
// `apps-gov-in.signing.signingCertificate.sha256` is null. Both states are
// correct and both are LOUD:
//
//   signer == android-play's upload pin     → FAIL, whatever else holds. Reusing
//                                             the upload key would silently
//                                             promote it into an app-signing key.
//   posture release + the debug signer      → FAIL (the key did not reach Gradle)
//   posture debug  + a non-debug signer     → FAIL (some other key leaked in)
//   pin set + signer != pin (or debug)      → FAIL
//   pin set + signer == pin                 → `apps-gov-in-<app>-apk`
//                                             (the ONLY name the owner uploads)
//   pin null + release-signed               → `apps-gov-in-<app>-apk-NOT-FOR-UPLOAD-release-signed-unpinned`
//   pin null + debug-signed (no secrets)    → `apps-gov-in-<app>-apk-NOT-FOR-UPLOAD-debug-signed-build-proof`
//
// The two NOT-FOR-UPLOAD outcomes exit 0 — the build is a correct build proof —
// and the step summary says why IN CAPITALS. The name is the safeguard: no
// artifact whose name ends `-apk` exists until a matching pin is recorded.
//
// ── THE FORM ANSWERS ARE CHECKED AGAINST THE SAME FILE ───────────────────────
// apps/<app>/store/apps-gov-in/form-answers.json answers the portal's upload
// form. Two of its answers are properties of the built .apk, so they are
// graded here, against `aapt2 dump badging` of this very file:
//   · step1.minimumPlatform.sdk equals the .apk's minSdk, and its label equals
//     the portal's own label for that level (contracts/store/vocabulary.js
//     STORE_FORM_RULES['apps-gov-in'].minPlatformLabels, read off the form's
//     script 2026-09-22). A minSdk the portal's list cannot express FAILS.
//   · the five permission questions (location, camera, contacts/call logs,
//     microphone, storage): "No" FAILS if the merged manifest requests one of
//     the named permissions, "Yes" FAILS if it requests none.
// The shape of the file (every step, every field) is graded without an .apk by
// assert-store-metadata.mjs.
//
// ── ⚠️ apksigner AND aapt2, ON PURPOSE, AND WHAT THEIR ABSENCE MEANS ─────────
// assert-android-vapt-manifest.mjs parses AXML itself so it never depends on
// build-tools. This guard cannot: the signer IS the question, and apksigner is
// the documented reader of v2/v3 signature blocks. Build-tools is resolved from
// $ANDROID_HOME (or $ANDROID_SDK_ROOT, or --build-tools), highest version
// first. An absent tool is COVERAGE LOST (exit 2), never a pass and never a
// mismatch — the two failure modes print differently.
//
// ── THE THREE SHAPES `apksigner verify --print-certs` PRINTS ─────────────────
// apksigner labels each certificate it prints, and the label is the only thing
// that differs between its shapes:
//   · no v3.1 block  → `Signer #N certificate DN: …` / `… SHA-256 digest: …`
//                      (build-tools 36.0.0, `--version` 0.9)
//   · a v3.1 block   → `Signer (minSdkVersion=A[ (dev release=true)], maxSdkVersion=B) certificate …`,
//                      the v3.1 signers first, then the v3.0 signers (AOSP apksig)
//   · per scheme     → `V2 Signer: certificate DN: …` / `V2 Signer: certificate SHA-256 digest: …`
//                      (build-tools 37.0.0 on the ubuntu runner, `--version` ALSO 0.9:
//                      the version string does not name the shape; run 35734304054)
//   · any, plus      → `Source Stamp Signer certificate …`, which is NOT a signer
// The parser keys each entry by its label. A signer is counted by its DISTINCT
// SHA-256: one key printed in two blocks or two schemes is one signer; two keys
// is a rotation and FAILS. A certificate line under any other label is
// COVERAGE LOST, named verbatim — an unknown shape is unread, never skipped.
// Every COVERAGE LOST on apksigner's output prints what apksigner returned
// (its path, `--version`, the first 20 lines of stdout and of stderr), and a
// successful read prints the shape it read (row O-APPS-GOV-IN-APK-SIGNER-UNREAD:
// the first real run, 35720583079, printed neither, so the format stayed unread).
//
// Usage:  node tooling/ci/assert-apps-gov-in-apk.mjs --apk <file.apk> --app <app-id>
//           --posture <release|debug> [--repo-root <dir>] [--build-tools <dir>]
// Writes `artifact_name=` and `verdict=` to $GITHUB_OUTPUT and a table to
// $GITHUB_STEP_SUMMARY when those are set.
// Exit 0 = the .apk is what its name will say it is.
// Exit 1 = a finding: wrong key, wrong pin, or a form answer the .apk contradicts.
// Exit 2 = COVERAGE LOST: nothing was read, or what was read could not be judged.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_FORM_RULES } from '../../contracts/store/vocabulary.js';
// The ONE directory listing in tooling/ci: it skips nested checkouts (see its header).
import { listDir } from './tree-walk.mjs';

const NAME = 'assert-apps-gov-in-apk';
const CHANNEL = 'apps-gov-in';
const PLAY = 'android-play';
const TOOL_TIMEOUT_MS = 120_000;
const PIN_SHAPE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const DEBUG_DN = /CN=Android Debug\b/;
export const POSTURES = ['release', 'debug'];

// The permission questions on the form's step 3, keyed by the stable `id` a
// form-answers.json entry carries (the portal numbers them; numbers move).
export const PERMISSION_QUESTIONS = {
  location: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION'],
  camera: ['android.permission.CAMERA'],
  'contacts-call-logs': ['android.permission.READ_CONTACTS', 'android.permission.WRITE_CONTACTS', 'android.permission.READ_CALL_LOG', 'android.permission.WRITE_CALL_LOG', 'android.permission.PROCESS_OUTGOING_CALLS'],
  microphone: ['android.permission.RECORD_AUDIO'],
  storage: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.MANAGE_EXTERNAL_STORAGE', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED'],
};

/** Lowercase or colon-less hex → the register's colon-separated uppercase form. */
export function toPinForm(hex) {
  const h = String(hex).replace(/:/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(h)) return null;
  return h.match(/.{2}/g).join(':');
}

// The labels apksig prints before ` certificate DN: ` (see the header).
const SIGNER_N = /^Signer #(\d+)$/;
const SIGNER_V31 = /^Signer \(minSdkVersion=(\d+)( \(dev release=true\))?, maxSdkVersion=(\d+)\)$/;
const SIGNER_SCHEME = /^V(\d+(?:\.\d+)?) Signer:$/;
const SOURCE_STAMP = 'Source Stamp Signer';
export const SHAPE_N = 'Signer #N';
export const SHAPE_V31 = 'Signer (minSdkVersion=…)';
export const SHAPE_SCHEME = 'V<n> Signer:';

/** A certificate label → the shape it belongs to, or null for a label apksig does not print. */
export function signerShape(label) {
  if (SIGNER_N.test(label)) return SHAPE_N;
  if (SIGNER_V31.test(label)) return SHAPE_V31;
  if (SIGNER_SCHEME.test(label)) return SHAPE_SCHEME;
  return null;
}

/**
 * `apksigner verify --print-certs` stdout → the SIGNER entries in print order,
 * [{ index, label, dn, sha256 }], keyed by label (the three shapes in the header).
 * `index` is N for `Signer #N` and the print position for the other shapes.
 * The array also carries:
 *   · `sourceStamp` — the `Source Stamp Signer` entry, or null. Never a signer.
 *   · `unknown`     — every certificate line whose label is no shape, verbatim.
 */
export function parseApksignerCerts(text) {
  const signers = [];
  const unknown = [];
  let sourceStamp = null;
  const open = new Map(); // label → the entry its last DN line opened
  for (const line of String(text).split(/\r?\n/)) {
    const cert = /^(.+?) certificate (DN|SHA-256 digest): (.*)$/.exec(line);
    if (!cert) continue;
    const [, label, field, value] = cert;
    const isStamp = label === SOURCE_STAMP;
    if (!isStamp && !signerShape(label)) {
      unknown.push(line);
      continue;
    }
    let entry = open.get(label);
    // printCertificate() prints DN first, then the digests: a DN line opens an
    // entry, and a digest with no open entry (or a second one) opens its own.
    if (field === 'DN' || !entry || entry.sha256 !== undefined) {
      const n = SIGNER_N.exec(label);
      entry = { index: n ? Number(n[1]) : signers.length + 1, label, dn: null };
      open.set(label, entry);
      if (isStamp) sourceStamp = entry;
      else signers.push(entry);
    }
    if (field === 'DN') entry.dn = value.trim();
    else entry.sha256 = toPinForm(value.trim());
  }
  for (const e of [...signers, ...(sourceStamp ? [sourceStamp] : [])]) if (e.sha256 === undefined) e.sha256 = null;
  return Object.assign(signers, { sourceStamp, unknown });
}

/** The distinct SHA-256 keys among the signer entries (one key printed in two blocks or two schemes is ONE). */
export function distinctSignerKeys(signers) {
  return [...new Set(signers.map((s) => s.sha256).filter(Boolean))];
}

/** One stream of a tool's output → at most `max` lines, each prefixed `<name>| `, control characters escaped. */
export function toolOutputLines(name, text, max = 20) {
  const s = String(text ?? '');
  if (s === '') return [`${name}: (empty, 0 bytes)`];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const esc = (l) => l.replace(/[\x00-\x1f\x7f]/g, (c) => ({ '\r': '\\r', '\t': '\\t' })[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  const out = [`${name}: ${lines.length} line(s), ${Buffer.byteLength(s)} bytes${lines.length > max ? `, first ${max} shown` : ''}`];
  for (const l of lines.slice(0, max)) out.push(`${name}| ${esc(l)}`);
  return out;
}

/** `aapt2 dump badging` stdout → the fields this guard and the summary use. */
export function parseBadging(text) {
  const s = String(text);
  const pkg = /^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'/m.exec(s);
  const sdk = /^(?:sdkVersion|minSdkVersion):'(\d+)'/m.exec(s);
  const target = /^targetSdkVersion:'(\d+)'/m.exec(s);
  const permissions = [...s.matchAll(/^uses-permission(?:-sdk-23)?: name='([^']+)'/gm)].map((m) => m[1]);
  return {
    packageName: pkg ? pkg[1] : null,
    versionCode: pkg ? pkg[2] : null,
    versionName: pkg ? pkg[3] : null,
    sdkVersion: sdk ? Number(sdk[1]) : null,
    targetSdkVersion: target ? Number(target[1]) : null,
    permissions: [...new Set(permissions)],
  };
}

/** The portal's own label for a minimum SDK level, or null if its list has none. */
export function portalLabel(sdk, rules = STORE_FORM_RULES[CHANNEL]) {
  return rules.minPlatformLabels[sdk] ?? null;
}

/**
 * The decision table in the header, as a pure function.
 * @returns {{ problems: string[], artifactName: string|null, verdict: string|null, reason: string|null }}
 */
export function decideArtifact({ app, posture, signer, pin, playPin }) {
  const problems = [];
  const isDebug = DEBUG_DN.test(signer.dn ?? '');
  if (signer.sha256 === playPin) {
    problems.push(`the .apk is signed by the ANDROID-PLAY UPLOAD KEY (${signer.sha256}). The apps.gov.in key is its own (owner, 2026-09-22, alias nikatru-appsgovin); a self-signed store binds every install to the upload key if it ships.`);
  }
  if (posture === 'release' && isDebug) {
    problems.push(`posture is "release" but the signer is the DEBUG key (${signer.dn}): the APPSGOVIN_* key never reached Gradle.`);
  }
  if (posture === 'debug' && !isDebug) {
    problems.push(`posture is "debug" (no APPSGOVIN_* secrets) but the signer is NOT the debug key (${signer.dn}, ${signer.sha256}): some other key reached the apps-gov-in build.`);
  }
  if (pin !== null && (isDebug || signer.sha256 !== pin)) {
    problems.push(`the signer ${signer.sha256} (${signer.dn}) does NOT match the pinned apps-gov-in certificate ${pin} (tooling/channel-register.json apps-gov-in.signing.signingCertificate.sha256).`);
  }
  if (problems.length) return { problems, artifactName: null, verdict: null, reason: null };
  if (pin !== null) {
    return { problems, artifactName: `${CHANNEL}-${app}-apk`, verdict: 'UPLOADABLE', reason: 'SIGNED BY THE PINNED apps-gov-in KEY. THIS IS THE FILE THE OWNER UPLOADS.' };
  }
  if (posture === 'release') {
    return {
      problems,
      artifactName: `${CHANNEL}-${app}-apk-NOT-FOR-UPLOAD-release-signed-unpinned`,
      verdict: 'NOT-FOR-UPLOAD',
      reason: 'RELEASE-SIGNED, BUT NO PIN IS RECORDED. PASTE THE CERTIFICATE SHA-256 INTO tooling/channel-register.json apps-gov-in.signing.signingCertificate.sha256 BEFORE ANY UPLOAD.',
    };
  }
  return {
    problems,
    artifactName: `${CHANNEL}-${app}-apk-NOT-FOR-UPLOAD-debug-signed-build-proof`,
    verdict: 'NOT-FOR-UPLOAD',
    reason: 'THE APPSGOVIN_* SECRETS ARE NOT SET, SO THIS .apk IS SIGNED WITH THE DEBUG KEY. IT PROVES THE BUILD. IT MUST NEVER BE UPLOADED.',
  };
}

/** form-answers.json against the built .apk's badging. Returns problem strings. */
export function checkFormAnswers(answers, badging, rules = STORE_FORM_RULES[CHANNEL]) {
  const problems = [];
  const mp = answers?.step1?.minimumPlatform;
  const label = portalLabel(badging.sdkVersion, rules);
  if (label === null) {
    const known = Object.keys(rules.minPlatformLabels).join(', ');
    problems.push(`the .apk's minSdk ${badging.sdkVersion} has NO entry in the portal's "Minimum Platform" list (${known}); the form cannot state it.`);
  }
  if (!mp || mp.sdk !== badging.sdkVersion) {
    problems.push(`form-answers.json step1.minimumPlatform.sdk is ${JSON.stringify(mp?.sdk ?? null)}, and the built .apk's minSdk is ${badging.sdkVersion}.`);
  }
  if (label !== null && mp?.label !== label) {
    problems.push(`form-answers.json step1.minimumPlatform.label is ${JSON.stringify(mp?.label ?? null)}; the portal's label for SDK ${badging.sdkVersion} is "${label}".`);
  }
  const step3 = Array.isArray(answers?.step3) ? answers.step3 : [];
  const held = new Set(badging.permissions);
  for (const [id, perms] of Object.entries(PERMISSION_QUESTIONS)) {
    const entry = step3.find((e) => e?.id === id);
    const requested = perms.filter((p) => held.has(p));
    if (!entry) {
      problems.push(`form-answers.json step3 has no entry with id "${id}".`);
    } else if (entry.answer === 'No' && requested.length) {
      problems.push(`form-answers.json answers "${id}" No, and the built .apk requests ${requested.join(', ')}.`);
    } else if (entry.answer === 'Yes' && !requested.length) {
      problems.push(`form-answers.json answers "${id}" Yes, and the built .apk requests none of ${perms.join(', ')}.`);
    } else if (entry.answer !== 'Yes' && entry.answer !== 'No') {
      problems.push(`form-answers.json step3 "${id}" answer is ${JSON.stringify(entry.answer)}; the form takes Yes or No.`);
    }
  }
  return problems;
}

/** The permissions a rail's BUILD would have to request, keyed by the rail id
 *  `purchaseRail.forbids` names. A rail cannot be proven present from badging —
 *  a Razorpay checkout is INTERNET, which every build holds — but a forbidden
 *  rail CAN be proven present, because Play Billing cannot work without its own
 *  permission. So this is one-sided on purpose: it never claims "the right rail
 *  shipped", only "a forbidden one did". */
const RAIL_PERMISSIONS = {
  'play-billing': ['com.android.vending.BILLING'],
};

/**
 * The built .apk against the register row's identity and its `purchaseRail`.
 *
 * Two facts the .apk states about itself that nothing read before:
 *
 * 1. **The package id.** `aapt2 badging` prints what the build actually stamped;
 *    `apps/<app>/android/app/build.gradle.kts` declares what it should be. They
 *    are the same string today and a flavour, a suffix or a merged manifest can
 *    part them. An .apk uploaded under a package id the store did not expect is
 *    a new listing, not an update, and on apps.gov.in that is a support ticket
 *    rather than a rollback.
 * 2. **No forbidden rail.** The row's `purchaseRail.forbids` names `play-billing`
 *    for a MECHANICAL reason, quoted in tooling/channel-register.json: the Play
 *    Billing Library resolves a purchase against the Play install that delivered
 *    the app, and apps.gov.in did not deliver it. A build that reached here with
 *    `com.android.vending.BILLING` would open a checkout that cannot complete —
 *    and it would be discovered by a buyer, on a government store, after paying.
 *
 * Returns problem strings; `applicationId` null means the declaration could not
 * be read, which is itself a problem (a check that quietly skips is not a check).
 */
export function checkBuiltIdentity(badging, row, applicationId) {
  const problems = [];
  if (applicationId === null) {
    problems.push(`no applicationId could be read from apps/<app>/android/app/build.gradle.kts, so the .apk's package "${badging.packageName ?? '?'}" is checked against nothing. The declaration is where the id is decided; an unreadable one is an unchecked upload, not a fine one.`);
  } else if (badging.packageName !== applicationId) {
    problems.push(`the built .apk's package is "${badging.packageName ?? '?'}" and apps/<app>/android/app/build.gradle.kts declares applicationId "${applicationId}". A store matches an update by package id: uploaded under another one it becomes a second listing.`);
  }
  const forbids = Array.isArray(row?.purchaseRail?.forbids) ? row.purchaseRail.forbids : null;
  if (forbids === null) {
    problems.push(`tooling/channel-register.json "${CHANNEL}" declares no \`purchaseRail.forbids\`, so no rail is forbidden in the built .apk and this limb ranges over nothing.`);
    return problems;
  }
  const held = new Set(badging.permissions);
  for (const rail of forbids) {
    for (const perm of RAIL_PERMISSIONS[rail] ?? []) {
      if (held.has(perm)) {
        problems.push(`the built .apk requests ${perm}, and tooling/channel-register.json "${CHANNEL}" forbids the "${rail}" rail on this channel. ${row.purchaseRail.forbidsWhy ? 'Its `forbidsWhy` says why it cannot work.' : ''} A sideloaded build cannot complete that purchase.`.trim());
      }
    }
  }
  return problems;
}

/** One markdown table cell. The backslash is escaped FIRST, so a `\|` in the
 *  input (a signer DN can carry one) cannot turn the added escape back into a
 *  cell break. */
export function mdCell(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/** A build-tools directory: the flag, else the SDK's highest numeric version. */
export function resolveBuildTools(flag, env = process.env) {
  if (flag) return resolve(flag);
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const root = join(sdk, 'build-tools');
  if (!existsSync(root)) return null;
  const versions = listDir(root)
    .filter((v) => /^\d+(\.\d+)*$/.test(v))
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pb[i] ?? 0) - (pa[i] ?? 0);
        if (d) return d;
      }
      return 0;
    });
  return versions.length ? join(root, versions[0]) : null;
}

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const flagValue = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ROOT = resolve(flagValue('--repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const APK = flagValue('--apk');
  const APP = flagValue('--app');
  const POSTURE = flagValue('--posture');
  const usage = `Usage: node tooling/ci/${NAME}.mjs --apk <file.apk> --app <app-id> --posture <release|debug> [--repo-root <dir>] [--build-tools <dir>]`;

  if (!APK) coverageLost(['no --apk was named.', 'The lane names the file it built; an empty argument is a lane that stopped passing it, not an .apk with nothing to check.', usage]);
  if (!APP || !/^[a-z][a-z0-9_]*$/.test(APP)) coverageLost([`--app must name the app directory under apps/ (got ${JSON.stringify(APP ?? null)}).`, usage]);
  if (!POSTURES.includes(POSTURE)) coverageLost([`--posture must be one of ${POSTURES.join(', ')} (got ${JSON.stringify(POSTURE ?? null)}).`, 'It is what the signing prep step decided; without it a debug signer cannot be told from a missing key.', usage]);
  const apkPath = resolve(APK);
  if (!existsSync(apkPath) || !statSync(apkPath).isFile() || statSync(apkPath).size === 0) {
    coverageLost([`${APK} does not exist or is empty.`, 'Nothing was built at the path the lane named, so there is no signer to read.']);
  }

  const rules = STORE_FORM_RULES[CHANNEL];
  if (!rules || !rules.minPlatformLabels) coverageLost([`contracts/store/vocabulary.js STORE_FORM_RULES has no "${CHANNEL}" entry with minPlatformLabels.`]);

  const registerPath = join(ROOT, 'tooling', 'channel-register.json');
  if (!existsSync(registerPath)) coverageLost([`${registerPath} is missing; the pin lives there.`]);
  const register = JSON.parse(readFileSync(registerPath, 'utf8'));
  const row = (register.channels ?? []).find((c) => c.id === CHANNEL);
  const playRow = (register.channels ?? []).find((c) => c.id === PLAY);
  const certificate = row?.signing?.signingCertificate;
  if (!certificate || !Object.hasOwn(certificate, 'sha256')) {
    coverageLost([`the register row "${CHANNEL}" has no signing.signingCertificate.sha256 key.`, 'null is an answer ("not minted"); an ABSENT key is a register that stopped saying.']);
  }
  const pin = certificate.sha256;
  if (pin !== null && !PIN_SHAPE.test(pin)) coverageLost([`apps-gov-in.signing.signingCertificate.sha256 is ${JSON.stringify(pin)}, which is not 32 colon-separated uppercase hex bytes.`]);
  const playPin = playRow?.signing?.uploadCertificate?.sha256;
  if (typeof playPin !== 'string' || !PIN_SHAPE.test(playPin)) coverageLost([`android-play.signing.uploadCertificate.sha256 is not a pin (${JSON.stringify(playPin ?? null)}); the Play-key refusal would range over nothing.`]);

  const tools = resolveBuildTools(flagValue('--build-tools'));
  if (!tools) coverageLost(['no Android build-tools directory: set ANDROID_HOME or ANDROID_SDK_ROOT, or pass --build-tools.', 'apksigner is the reader of the signature block; without it the signer is unknown, not fine.']);
  const exe = (n) => {
    const candidates = process.platform === 'win32' ? [`${n}.bat`, `${n}.exe`, n] : [n];
    return candidates.map((c) => join(tools, c)).find((p) => existsSync(p)) ?? null;
  };
  const apksigner = exe('apksigner');
  const aapt2 = exe('aapt2');
  if (!apksigner || !aapt2) coverageLost([`${tools} lacks ${[!apksigner && 'apksigner', !aapt2 && 'aapt2'].filter(Boolean).join(' and ')}.`]);

  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, shell: process.platform === 'win32' && cmd.endsWith('.bat') });
  const sig = run(apksigner, ['verify', '--print-certs', apkPath]);
  if (sig.error || sig.status === null) coverageLost([`apksigner did not finish (${sig.error?.message ?? `signal ${sig.signal}`}).`]);
  const problems = [];
  if (sig.status !== 0) problems.push(`apksigner verify exited ${sig.status}: the .apk's signature does not verify.\n     ${(sig.stderr || sig.stdout).trim().split('\n').slice(0, 6).join('\n     ')}`);
  const signers = parseApksignerCerts(sig.stdout);
  // What apksigner returned, for every COVERAGE LOST on its output: the next red names the format.
  const apksignerVersion = () => {
    const v = run(apksigner, ['--version']);
    if (v.error || v.status === null) return `did not finish (${v.error?.message ?? `signal ${v.signal}`})`;
    return `${(v.stdout || v.stderr || '').trim().split(/\r?\n/)[0] || '(printed nothing)'} (exit ${v.status})`;
  };
  const whatApksignerReturned = () => [
    `apksigner: ${apksigner}`,
    `apksigner --version: ${apksignerVersion()}`,
    `apksigner verify --print-certs exited ${sig.status}`,
    ...toolOutputLines('stdout', sig.stdout),
    ...toolOutputLines('stderr', sig.stderr),
  ];
  if (sig.status === 0 && signers.unknown.length) {
    coverageLost([
      `apksigner printed a certificate line whose label is none of "${SHAPE_N}", "${SHAPE_V31}", "${SHAPE_SCHEME}" or "${SOURCE_STAMP}": ${JSON.stringify(signers.unknown[0])}.`,
      'An unknown shape is unread, never skipped: the signer it names could be the one that matters.',
      ...whatApksignerReturned(),
    ]);
  }
  if (sig.status === 0 && signers.length === 0) {
    coverageLost([
      `apksigner exited 0 and printed no signer certificate line in any shape ("${SHAPE_N} certificate DN:", "${SHAPE_V31} certificate DN:" or "${SHAPE_SCHEME} certificate DN:").`,
      'The output format moved; the signer is unread, not absent.',
      ...whatApksignerReturned(),
    ]);
  }
  const unhashed = signers.find((s) => !s.sha256);
  if (sig.status === 0 && unhashed) coverageLost([`apksigner printed the signer "${unhashed.label}" with no parsable SHA-256 digest.`, ...whatApksignerReturned()]);
  const keys = distinctSignerKeys(signers);
  const shapes = [...new Set(signers.map((s) => signerShape(s.label)))];
  if (keys.length > 1) {
    problems.push(shapes.includes(SHAPE_V31)
      ? `the .apk carries a key rotation (${keys.length} distinct signer keys); an apps.gov.in upload carries exactly one key.`
      : `the .apk carries ${keys.length} distinct signer keys (${signers.map((s) => s.label).join(', ')}); an apps.gov.in upload carries exactly one key.`);
  }
  if (sig.status === 0) {
    const stamp = signers.sourceStamp ? `; plus a source stamp (${signers.sourceStamp.dn}), not counted` : '';
    console.log(`   · apksigner read: shape ${shapes.map((s) => `"${s}"`).join(' + ')}, ${keys.length} distinct signer key(s) over ${signers.length} signer entr${signers.length === 1 ? 'y' : 'ies'}${stamp} — ${apksigner}, ${apksignerVersion()}`);
    for (const l of toolOutputLines('stdout', sig.stdout)) console.log(`     ${l}`);
  }
  const signer = signers[0] ?? { dn: null, sha256: null };

  const badge = run(aapt2, ['dump', 'badging', apkPath]);
  // What aapt2 returned, for every COVERAGE LOST on its output (the same rule as apksigner's).
  const whatAapt2Returned = () => [
    `aapt2: ${aapt2}`,
    `aapt2 dump badging exited ${badge.status}`,
    ...toolOutputLines('stdout', badge.stdout),
    ...toolOutputLines('stderr', badge.stderr),
  ];
  if (badge.error || badge.status !== 0) coverageLost([`aapt2 dump badging failed (${badge.error?.message ?? `exit ${badge.status}`}).`, ...whatAapt2Returned()]);
  const badging = parseBadging(badge.stdout);
  if (badging.sdkVersion === null) coverageLost(['aapt2 badging printed no sdkVersion or minSdkVersion line; the minimum platform is unread, not absent.', ...whatAapt2Returned()]);

  const decision = signer.sha256 ? decideArtifact({ app: APP, posture: POSTURE, signer, pin, playPin }) : { problems: [], artifactName: null, verdict: null, reason: null };
  problems.push(...decision.problems);

  const answersPath = join(ROOT, 'apps', APP, 'store', CHANNEL, 'form-answers.json');
  if (!existsSync(answersPath)) {
    problems.push(`apps/${APP}/store/${CHANNEL}/form-answers.json does not exist: this app builds an apps.gov.in .apk and has no answers for the upload form.`);
  } else {
    let answers = null;
    try {
      answers = JSON.parse(readFileSync(answersPath, 'utf8'));
    } catch (e) {
      problems.push(`apps/${APP}/store/${CHANNEL}/form-answers.json is not JSON: ${e.message}`);
    }
    if (answers) problems.push(...checkFormAnswers(answers, badging, rules));
  }

  // The .apk's own identity, and the rails the row forbids in it.
  const gradlePath = join(ROOT, 'apps', APP, 'android', 'app', 'build.gradle.kts');
  const gradle = existsSync(gradlePath) ? readFileSync(gradlePath, 'utf8') : null;
  const declaredId = gradle === null ? null : (/applicationId\s*=\s*"([^"]+)"/.exec(gradle)?.[1] ?? null);
  problems.push(...checkBuiltIdentity(badging, row, declaredId));

  const label = portalLabel(badging.sdkVersion, rules);
  const bytes = statSync(apkPath).size;
  const rows = [
    ['file', basename(apkPath)],
    ['bytes', String(bytes)],
    ['package', badging.packageName ?? '?'],
    ['versionName', badging.versionName ?? '?'],
    ['versionCode', badging.versionCode ?? '?'],
    ['minSdk', `${badging.sdkVersion} — portal label "${label ?? 'NONE'}"`],
    ['targetSdk', String(badging.targetSdkVersion ?? '?')],
    ['posture', POSTURE],
    ['signer', `${signer.dn ?? '?'} · ${signer.sha256 ?? '?'}`],
    ['pin', pin ?? 'null (key not minted)'],
    ['verdict', problems.length ? 'FAILED' : decision.verdict],
    ['artifact', problems.length ? '(none)' : decision.artifactName],
  ];
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`### apps.gov.in .apk — ${APP}`, '', '| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${mdCell(v)} |`), ''];
    if (!problems.length) md.push(`**${decision.reason}**`, '');
    for (const p of problems) md.push(`- ❌ ${p.replace(/\n\s*/g, ' ')}`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
  }
  for (const [k, v] of rows) console.log(`   · ${k}: ${v}`);

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`\n${NAME}: FAILED`);
    process.exit(1);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `artifact_name=${decision.artifactName}\nverdict=${decision.verdict}\n`);
  if (decision.verdict !== 'UPLOADABLE') console.log(`\n⬜ ${decision.reason}`);
  console.log(`${NAME}: OK — ${decision.verdict}: ${decision.artifactName} (minSdk ${badging.sdkVersion} = "${label}", versionName ${badging.versionName}, ${bytes} bytes)`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
