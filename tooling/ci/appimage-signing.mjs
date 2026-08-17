#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// appimage-signing.mjs — materialise the AppImage SIGNING KEY for one CI build
// and decide, out loud, whether this run is allowed to be unsigned.
//
// The third instance of tooling/ci/android-signing.mjs's shape, applied to the
// `linux-appimage` row of tooling/channel-register.json:
//
//   secret supplied → arrange the key in $RUNNER_TEMP, export
//                     APPIMAGE_SIGNING_POSTURE=release-signed, construct the
//                     detached-signature generation AND the verification against
//                     the register's PINNED PUBLIC KEY
//   absent          → posture = `unsigned-build-proof`, printed in capitals with
//                     the OWNER item named — UNLESS this is a release lane AND
//                     the register ARMS this channel, where the absence is a
//                     FAILURE and not a posture
//   half            → FAIL, always. See the note on reachability below.
//
// 🔴 THE RELEASE-LANE FAILURE IS SCOPED BY THE REGISTER, NOT BY THE TAG ALONE.
// Measured 2026-08-09, before any tag had ever been pushed: a `subly-v*` tag
// killed this step, and therefore build-platforms.yml's `linux_web_android` job,
// while `windows-signing.mjs` killed `windows` and `apple-signing.mjs` killed
// `apple` for the identical reason. The `release` job `needs:` all three, so the
// FIRST GitHub Release this repository would ever publish was skipped — three
// individually-defensible checks composing into an unreachable release. This row
// is `submittable: false`, `served: false`, `lane: null`: nothing is published
// from it, so an unsigned build here reaches nobody. The scope test now comes
// from those fields, through `tooling/ci/channel-arming.mjs`, and the gap is
// PRINTED IN FULL on the release lane instead ([pipeline C-6] — the owner item
// here is three obligations the owner alone can discharge, listed below). The
// failing case did not go away: serve this row, and the identical tag fails
// naming the field that armed it.
//
// 🔴 WHY THIS ROW IS THE MOST EXPOSED ONE IN THE REGISTER, in its own words:
// `keyKind: "own-signing-key"`, and "no store gatekeeper verifies this one, so
// the signature is only worth what our custody of it is worth." There is no
// Google to reset an upload key and no CA to reissue a certificate. Losing the
// key silently breaks every future update's provenance for users who verified an
// earlier build; disclosing it lets anyone publish an .AppImage this project
// cannot disown.
//
// And the signature is LOAD-BEARING rather than decorative, because of where the
// file is served from. [ADR 015] §4, quoted in the row's own notes: the AppImage
// comes from dl.nikatru.com on R2 and never a direct GitHub link, so "the
// invariant is that CI produces the signed artifact, not where it is served
// from". A download from an R2 bucket carries NO platform identity — no store
// review, no Authenticode chain, no Play App Signing. The detached signature is
// the entire provenance story for this channel. An unsigned .AppImage is not a
// weaker release; it is an anonymous binary on a CDN.
//
// ── WHAT THE REGISTER DECLARES, AND THE PASSPHRASE QUESTION ANSWERED ────────
// `signing.ciSecrets.names` on the `linux-appimage` row declares EXACTLY ONE
// secret: APPIMAGE_SIGNING_KEY_B64. There is NO passphrase secret, and this file
// does not invent one — an Ed25519 seed is 32 bytes of key material and the row
// records no wrapping around it. Asking for a passphrase the register does not
// declare would put this script and the register permanently out of step, which
// is the exact drift the "names come from the declaration" rule exists to stop.
//
// ⚠️ THE HALF-CONFIGURED BRANCH IS THEREFORE UNREACHABLE ON TODAY'S REGISTER,
// and it is kept anyway — deliberately, with the reason written down, because
// this repository deletes assertions that cannot fail. It is not one of them:
// the secret-set law is DERIVED from the register's list, so the branch becomes
// reachable the moment that list grows a second name (a passphrase, a key id, a
// separate public-key transport). Its failing case is written against a fixture
// row declaring two names — which is the same input a future register change
// would produce, not a shape invented to make a test pass.
//
// ── 🔴 THE SENTINEL PIN, AND WHY IT MUST FAIL LOUDLY ────────────────────────
// `signing.signingPublicKey.publicKeyBase64` is a PIN: the PUBLIC half of the
// keypair, so a swapped private key is caught here rather than by a user whose
// verification of the next update fails. Today it is the string
// `APPIMAGE-SIGNING-KEY-NOT-GENERATED`, recorded alongside a
// `notYetConfiguredSentinel` carrying the same string.
//
// A SENTINEL CAN NEVER MATCH A REAL PUBLIC KEY, so:
//   · posture `unsigned-build-proof` → correct and expected. PRINT the gap.
//   · posture `release-signed`       → 🔴 FAIL, LOUDLY. A private key was
//     supplied while the register still says no keypair exists. Either the key
//     was generated and the register never updated — leaving the pin
//     unenforceable and every future swap invisible — or key material reached
//     this build through a path nobody recorded.
// "Skip the comparison when the pin is a sentinel" is the assertion that cannot
// fail, and it would make the release path pass on the day the pin stopped
// meaning anything.
//
// ── HOW THE PIN IS ACTUALLY CHECKED, AND WHY IT IS STRONGER THAN A READ-BACK ─
// For Ed25519 the public key is DERIVED from the private key. So this script
// does not have to wait for an artifact to exist: it derives the public half of
// the supplied secret and compares it to the pin BEFORE anything is signed. A
// swapped secret fails at the moment it is materialised rather than after a
// build has been spent. The signature round-trip is still performed — with
// node's own crypto, which is always present — as proof that the materialised
// key really signs, and the openssl commands the release lane will run are
// constructed and printed alongside.
//
// ── ⚠️ WHAT THIS FILE CANNOT CLAIM, stated so green is not mistaken for safe ─
// openssl 3.x is what the release lane uses to produce and check the detached
// signature (`pkeyutl -rawin` is Ed25519's path and needs OpenSSL 3.0+). It may
// not exist on the machine this runs on, so those commands are constructed as
// data, printed, and executed only when the binary is resolvable — with a
// printed note when it is not. The output parser has been exercised against
// FIXTURES ONLY; the header of tooling/ci/test/appimage-signing.test.mjs says
// the same rather than implying more coverage than exists.
//
// Usage:
//   node tooling/ci/appimage-signing.mjs [--app <slug>] [--out <dir>]
//                                        [--repo-root <path>] [--github-env <path>]
//                                        [--artifact <path>]…
// Env in:  the names tooling/channel-register.json declares on `linux-appimage`
//          GITHUB_REF, GITHUB_WORKFLOW_REF — read to DERIVE the release lane.
// Env out (via $GITHUB_ENV): APPIMAGE_SIGNING_KEY_PATH, APPIMAGE_SIGNING_PUBKEY_PATH,
//          any declared passthrough names, and APPIMAGE_SIGNING_POSTURE.
// Exit 0 = the posture is decided and legal for this lane. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, randomBytes } from 'node:crypto';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { armedFatalLines, releaseGapVerdict, unarmedGapLines } from './channel-arming.mjs';

export const APPS = 'catalog/apps.json';
export const REGISTER = 'tooling/channel-register.json';
export const CHANNEL_ID = 'linux-appimage';
/** The transport for the key material. Declared here rather than read because
 *  openssl wants a FILE and a path cannot travel through a repository secret —
 *  the same single exception the Android and Windows seams carry. Cross-checked
 *  against the register's declared names, so the two cannot drift silently. */
export const B64_ENV = 'APPIMAGE_SIGNING_KEY_B64';
export const POSTURE_ENV = 'APPIMAGE_SIGNING_POSTURE';
export const KEY_PATH_ENV = 'APPIMAGE_SIGNING_KEY_PATH';
export const PUB_PATH_ENV = 'APPIMAGE_SIGNING_PUBKEY_PATH';
export const RELEASE_SIGNED = 'release-signed';
export const UNSIGNED_PROOF = 'unsigned-build-proof';
/** The only algorithm this seam implements. The register declares it per-row, so
 *  a row that says anything else is a COVERAGE LOST rather than a silent
 *  reinterpretation of the key bytes. */
export const ALGORITHM = 'ed25519';

/** RFC 8410 §7: an Ed25519 PKCS#8 PrivateKeyInfo is this fixed 16-byte prefix
 *  followed by the 32-byte seed. Fixed because the algorithm has no parameters. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
/** RFC 8410 §4: the SubjectPublicKeyInfo prefix, then the 32 raw public bytes. */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export const SEED_BYTES = 32;

// ═════════════════════════════════════════════════════════════════════════════
// PURE DECISION FUNCTIONS
//
// Exported, and free of the filesystem and the environment, so their failing
// cases are ordinary assertions rather than a runner that needs openssl.
// ═════════════════════════════════════════════════════════════════════════════

/** The secret-set law: all, none, or the state that is never legal. */
export function decideSecretSet(names, env) {
  const value = (n) => (env[n] ?? '').trim();
  const supplied = names.filter((n) => value(n) !== '');
  const missing = names.filter((n) => value(n) === '');
  const state = supplied.length === 0 ? 'none' : missing.length === 0 ? 'all' : 'partial';
  return { supplied, missing, state };
}

/**
 * Is this a RELEASE lane? DERIVED from what GitHub sets, never declared in YAML.
 *
 * ⚠️ `linux-appimage` declares NO submission workflow (`kind: "direct"`,
 * `submittable: false`), so limb (b) contributes nothing today and says so.
 */
export function decideRelease({ gitRef = '', workflowRef = '', submissionWorkflow = null } = {}) {
  const reasons = [];
  const blind = [];
  const ref = String(gitRef).trim();
  const wf = String(workflowRef).trim();
  if (ref.startsWith('refs/tags/')) reasons.push(`the run is a TAG push (${ref})`);
  if (submissionWorkflow !== null && wf !== '') {
    const runningPath = wf.split('@')[0];
    if (runningPath.endsWith(`/${submissionWorkflow}`) || runningPath === submissionWorkflow) {
      reasons.push(`this is ${CHANNEL_ID}'s declared submission workflow (${submissionWorkflow})`);
    }
  }
  if (submissionWorkflow === null) {
    blind.push(
      `${REGISTER}'s ${CHANNEL_ID} row declares no \`submission.workflow\` (it is a direct-download row served ` +
        'from R2, not a store submission), so limb (b) contributed nothing — only a tag push can mark a release here.',
    );
  } else if (wf === '') {
    blind.push('GITHUB_WORKFLOW_REF is unset (not a GitHub job), so limb (b) could not be evaluated.');
  }
  return { required: reasons.length > 0, reasons, blind };
}

/**
 * What KIND of thing is in the register's public-key pin?
 *
 * 'absent'    — null. Weaker, not broken: print the gap.
 * 'sentinel'  — equal to the row's own `notYetConfiguredSentinel`.
 * 'ed25519'   — base64 that round-trips and decodes to exactly 32 bytes.
 * 'malformed' — anything else, including base64 of the WRONG LENGTH. The length
 *               is checked as structure, not as a floor: an Ed25519 public key
 *               is exactly 32 bytes, so 31 or 33 is not "close", it is a
 *               different thing that can never match.
 */
export function classifyPublicKeyPin(signingPublicKey) {
  const sentinel =
    typeof signingPublicKey?.notYetConfiguredSentinel === 'string' ? signingPublicKey.notYetConfiguredSentinel : null;
  const raw = signingPublicKey?.publicKeyBase64 ?? null;
  if (raw === null) return { kind: 'absent', raw, sentinel, value: null };
  if (sentinel !== null && String(raw) === sentinel) return { kind: 'sentinel', raw, sentinel, value: null };
  const flat = String(raw).replace(/\s+/g, '');
  const bytes = Buffer.from(flat, 'base64');
  // Buffer.from silently ignores non-base64 characters, so a round-trip is the
  // only way to tell "valid base64" from "something that decoded to anything".
  if (bytes.toString('base64').replace(/=+$/, '') !== flat.replace(/=+$/, '')) {
    return { kind: 'malformed', raw, sentinel, value: null, why: 'it is not valid base64 (it does not round-trip)' };
  }
  if (bytes.length !== SEED_BYTES) {
    return {
      kind: 'malformed',
      raw,
      sentinel,
      value: null,
      why: `it decodes to ${bytes.length} byte(s); an Ed25519 public key is exactly ${SEED_BYTES}`,
    };
  }
  return { kind: 'ed25519', raw, sentinel, value: bytes.toString('base64') };
}

/**
 * 🔴 THE LOUD RULE — a sentinel pin and a `release-signed` posture cannot both
 * be true. Returns `{ fatal, print }`.
 */
export function pinVerdict(pin, posture) {
  if (posture === RELEASE_SIGNED) {
    if (pin.kind === 'sentinel') {
      return {
        fatal:
          `${REGISTER}'s ${CHANNEL_ID}.signing.signingPublicKey.publicKeyBase64 is still the placeholder ` +
          `${JSON.stringify(pin.sentinel)}, and this lane is about to declare posture "${RELEASE_SIGNED}". ` +
          'A sentinel can never match a real public key, so the pin is comparing NOTHING while reporting that it ' +
          'compared. Either the keypair was generated and the register was never updated — leaving every future ' +
          'swap of that secret invisible — or private key material reached this build through a path nobody ' +
          'recorded. Transcribe the PUBLIC half into that field in the same change that creates the secret.',
        print: null,
      };
    }
    if (pin.kind === 'malformed') {
      return {
        fatal:
          `${REGISTER}'s ${CHANNEL_ID}.signing.signingPublicKey.publicKeyBase64 is ${JSON.stringify(pin.raw)} and ` +
          `cannot be used as a pin — ${pin.why}. It can never match any key, so every release build would fail ` +
          'with a message about the artifact instead of about this line.',
        print: null,
      };
    }
    if (pin.kind === 'absent') {
      return {
        fatal: null,
        print:
          `NO PINNED PUBLIC KEY — ${REGISTER}'s ${CHANNEL_ID}.signing.signingPublicKey.publicKeyBase64 is null, so ` +
          'the signature below proves only that SOME key signed the .AppImage. A secret silently replaced by ' +
          'another valid keypair would be accepted here, and the users it breaks are the ones who verified an ' +
          'earlier build — the one group this signature exists for.',
      };
    }
    return { fatal: null, print: null };
  }
  if (pin.kind === 'sentinel') {
    return {
      fatal: null,
      print:
        `the pinned public key is still ${JSON.stringify(pin.sentinel)}, which is correct: no keypair has been ` +
        'generated, so there is nothing to pin and nothing was signed. This line becomes a FAILURE the moment a ' +
        `lane declares "${RELEASE_SIGNED}" without updating it.`,
    };
  }
  return { fatal: null, print: null };
}

/**
 * Turn the secret's bytes into an Ed25519 private key, accepting the three forms
 * a correctly produced secret can legitimately take. Returns `{ key, form }` or
 * throws with a message naming what was actually found.
 *
 * Structure, never a length floor — the same rule the Android seam applies to a
 * keystore. An invented minimum would fire on a correct key and pass a padded
 * stub. What this catches is the case no later step can attribute: base64 of the
 * wrong file, or of an error page somebody pasted into a secret.
 */
export function decodeSigningKey(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') throw new Error('the value is empty after trimming');

  // (a) a PEM, pasted whole. Recognised by its armour rather than by guessing.
  if (text.startsWith('-----BEGIN')) {
    const key = createPrivateKey({ key: text, format: 'pem' });
    if (key.asymmetricKeyType !== ALGORITHM) {
      throw new Error(`the PEM is a ${key.asymmetricKeyType ?? 'unknown'} key, not ${ALGORITHM}`);
    }
    return { key, form: 'pem' };
  }

  const flat = text.replace(/\s+/g, '');
  const bytes = Buffer.from(flat, 'base64');
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== flat.replace(/=+$/, '')) {
    throw new Error(`it is not valid base64 (it decodes to ${bytes.length} byte(s) and does not round-trip)`);
  }

  // (b) the raw 32-byte seed — what the register describes: "the base64 Ed25519
  //     PRIVATE seed". Wrapped in the fixed RFC 8410 PKCS#8 envelope, which has
  //     no parameters and therefore no room for ambiguity.
  if (bytes.length === SEED_BYTES) {
    return {
      key: createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, bytes]), format: 'der', type: 'pkcs8' }),
      form: 'raw-seed',
    };
  }

  // (c) an already-wrapped PKCS#8 DER, which is what several key generators emit.
  if (bytes.length === PKCS8_ED25519_PREFIX.length + SEED_BYTES && bytes.subarray(0, PKCS8_ED25519_PREFIX.length).equals(PKCS8_ED25519_PREFIX)) {
    return { key: createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' }), form: 'pkcs8-der' };
  }

  throw new Error(
    `it decodes to ${bytes.length} byte(s), which is neither a ${SEED_BYTES}-byte Ed25519 seed nor a ` +
      `${PKCS8_ED25519_PREFIX.length + SEED_BYTES}-byte PKCS#8 Ed25519 key (first byte 0x${bytes[0].toString(16).padStart(2, '0')})`,
  );
}

/** The 32 raw public bytes, base64 — the exact shape the register pins. */
export function derivePublicKeyBase64(privateKey) {
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  if (spki.length !== SPKI_ED25519_PREFIX.length + SEED_BYTES || !spki.subarray(0, SPKI_ED25519_PREFIX.length).equals(SPKI_ED25519_PREFIX)) {
    throw new Error(`the derived SubjectPublicKeyInfo is ${spki.length} byte(s) and does not carry the Ed25519 prefix`);
  }
  return spki.subarray(SPKI_ED25519_PREFIX.length).toString('base64');
}

/**
 * The detached-signature command, as data.
 *
 * `-rawin` is Ed25519's path through pkeyutl (the algorithm signs the message,
 * not a pre-computed digest) and needs OpenSSL 3.0+. There is no secret on this
 * argv — the private key travels as a file path — so `redacted` is the same
 * array, and it is still returned so callers cannot come to depend on the
 * distinction being absent.
 */
export function buildSignCommand({ keyPath, artifact, signaturePath = null, exe = 'openssl' }) {
  if (!keyPath || !artifact) throw new Error('buildSignCommand needs keyPath and artifact');
  const sig = signaturePath ?? `${artifact}.sig`;
  const args = ['pkeyutl', '-sign', '-inkey', keyPath, '-rawin', '-in', artifact, '-out', sig];
  return { exe, args, redacted: [...args], signaturePath: sig };
}

/**
 * The verification, against the PUBLIC key — never against the private one.
 *
 * ⚠️ A SEPARATE COMMAND FROM THE SIGN, ON PURPOSE: a step that produces a
 * signature and then reports its own success is the "green means ran" failure
 * with extra stages.
 */
export function buildVerifyCommand({ publicKeyPath, artifact, signaturePath = null, exe = 'openssl' }) {
  if (!publicKeyPath || !artifact) throw new Error('buildVerifyCommand needs publicKeyPath and artifact');
  const sig = signaturePath ?? `${artifact}.sig`;
  const args = ['pkeyutl', '-verify', '-pubin', '-inkey', publicKeyPath, '-rawin', '-in', artifact, '-sigfile', sig];
  return { exe, args, redacted: [...args], signaturePath: sig };
}

/**
 * Parse `openssl pkeyutl -verify` output.
 *
 * 🔴 THE VERDICT IS THE PARSED TEXT, NEVER THE EXIT STATUS. `recognised === false`
 * means the text matched nothing this parser knows — which the caller must treat
 * as COVERAGE LOST, never as a pass and never as a fail-by-default that would
 * hide a parser which had stopped understanding the tool.
 */
export function parseOpensslVerify(text) {
  const src = String(text ?? '');
  if (/Signature Verified Successfully/i.test(src)) return { recognised: true, verified: true };
  if (/Signature Verification Failure/i.test(src)) return { recognised: true, verified: false };
  return { recognised: false, verified: false };
}

/**
 * Compare a derived public key against the pin. Returns a problem string or null.
 * Kept separate from the derivation so "the key was unreadable" and "the wrong
 * key was supplied" can never collapse into one verdict.
 */
export function comparePublicKey(derivedBase64, pin) {
  if (pin.kind !== 'ed25519') return null; // the gap or the fatal is pinVerdict's
  if (derivedBase64 !== pin.value) {
    return (
      'the supplied private key is NOT the half of the pinned public key. ' +
      `expected ${pin.value}; the secret derives to ${derivedBase64}. ` +
      'No gatekeeper re-signs this channel and no store can reissue the key, so a swapped secret would be ' +
      'discovered by the users whose verification of the next update fails — which is the one group this ' +
      `signature exists for. If the keypair was rotated deliberately, update ${REGISTER}'s ` +
      `${CHANNEL_ID}.signing.signingPublicKey in the same change.`
    );
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// WIRING
// ═════════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const optAll = (name) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && i + 1 < argv.length) out.push(argv[i + 1]);
  return out;
};

/** 🔴 AN EMPTY STRING IS NOT AN UNSET VARIABLE — with `RUNNER_TEMP=''`,
 *  `resolve('')` is the CURRENT DIRECTORY, and a private key inside the
 *  repository is one workspace-relative upload-artifact glob away from being
 *  published on a PUBLIC repo. */
const envOr = (name, fallback) => {
  const v = (process.env[name] ?? '').trim();
  return v === '' ? fallback : v;
};

const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const OUT_DIR = resolve(opt('out') ?? envOr('RUNNER_TEMP', tmpdir()));
const GITHUB_ENV = opt('github-env') ?? envOr('GITHUB_ENV', null);

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nappimage-signing: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nappimage-signing: FAILED');
  process.exit(1);
}

/** A newline in a value is REFUSED rather than escaped — `$GITHUB_ENV` is
 *  line-oriented, so a value carrying one writes a second, attacker-chosen
 *  assignment into every later step's environment. */
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

function exportEnv(pairs) {
  assertExportable(pairs);
  if (GITHUB_ENV === null) {
    console.log('');
    console.log('⬜ NOT EXPORTED — no $GITHUB_ENV and no --github-env, so nothing was written for later');
    console.log('   steps. Outside a GitHub job that is expected; inside one it is a wiring fault.');
    for (const k of Object.keys(pairs)) console.log(`   would export: ${k}`);
    return;
  }
  appendFileSync(GITHUB_ENV, `${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
}

/** Resolved rather than assumed: "the tool was missing" and "the signature is
 *  good" must not be the same outcome. */
function resolveOpenssl() {
  const explicit = opt('openssl');
  const candidates = explicit ? [explicit] : ['openssl'];
  for (const c of candidates) {
    const r = spawnSync(c, ['version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return { exe: c, version: `${r.stdout ?? ''}`.trim() };
  }
  return null;
}

function main() {
  const registerRaw = read(REGISTER);
  if (registerRaw === null) {
    coverageLost([
      `${REGISTER} does not exist.`,
      'It declares which secret this channel takes and pins the public key it must derive to. Without it the',
      'posture decision would be made blind and would default to "an unsigned build is fine".',
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
      'That row carries the secret name, the pinned public key and the restore-drill record. With it gone this',
      'script would ask for a name of its own invention and pin against undefined.',
    ]);
  }

  const declared = channel.signing?.ciSecrets?.names;
  if (
    !Array.isArray(declared) ||
    declared.length === 0 ||
    declared.some((n) => typeof n !== 'string' || n.trim() === '')
  ) {
    coverageLost([
      `${REGISTER}'s ${CHANNEL_ID}.signing.ciSecrets.names is not a non-empty list of secret names.`,
      'It is the ONLY declaration of what this channel needs — including whether a passphrase exists, which',
      'today it does not. A hard-coded copy here would drift from it silently.',
    ]);
  }
  if (!declared.includes(B64_ENV)) {
    coverageLost([
      `${REGISTER}'s ${CHANNEL_ID} row declares ${declared.join(', ')} and does NOT declare ${B64_ENV}.`,
      'That name is the transport for the key material and is the one name this script owns rather than reads.',
      'The two have drifted: reconcile them in one change, or a materialised key would have nothing pointing at it.',
    ]);
  }
  const PASSTHROUGH = declared.filter((n) => n !== B64_ENV);

  const declaredAlgorithm = channel.signing?.signingPublicKey?.algorithm ?? null;
  if (declaredAlgorithm !== null && String(declaredAlgorithm).toLowerCase() !== ALGORITHM) {
    coverageLost([
      `${REGISTER}'s ${CHANNEL_ID}.signing.signingPublicKey.algorithm is ${JSON.stringify(declaredAlgorithm)}, and this`,
      `     seam implements ${ALGORITHM} only. Reading the secret's bytes as an ${ALGORITHM} seed anyway would`,
      '     silently produce a key nobody chose. Implement the declared algorithm, or correct the row.',
    ]);
  }

  // ── which app ──────────────────────────────────────────────────────────────
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

  // ── the lane ───────────────────────────────────────────────────────────────
  const submissionWorkflow = typeof channel.submission?.workflow === 'string' ? channel.submission.workflow : null;
  const lane = decideRelease({
    gitRef: process.env.GITHUB_REF ?? '',
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? '',
    submissionWorkflow,
  });

  console.log(`── AppImage signing · app "${app.slug}" · lane requires signing: ${lane.required ? 'YES' : 'no'} ──`);
  for (const r of lane.reasons) console.log(`   required because ${r}`);
  if (!lane.required)
    console.log('   no release signal (not a tag push, not a declared submission workflow) — a BUILD PROOF is legal here');
  for (const b of lane.blind) console.log(`   ⬜ ${b}`);

  const set = decideSecretSet(declared, process.env);
  const value = (n) => (process.env[n] ?? '').trim();

  if (set.state === 'partial') {
    die([
      'FAIL AppImage signing is HALF configured and this build refuses to guess.',
      `     supplied: ${set.supplied.join(', ')}`,
      `     missing:  ${set.missing.join(', ')}`,
      `     ${REGISTER} declares ${declared.length} secret(s) for this row; supply all of them or none. A partial`,
      '     set produces an UNSIGNED .AppImage from a run that looked like a signing run, and this channel has',
      '     no gatekeeper downstream that would notice.',
    ]);
  }

  const pin = classifyPublicKeyPin(channel.signing?.signingPublicKey);
  const drill = channel.signing?.restoreDrill ?? null;

  if (set.state === 'none') {
    const verdict = pinVerdict(pin, UNSIGNED_PROOF);
    // 🔴 IS THE CHANNEL ARMED? From THIS row's own register fields, never from a
    // channel name written here — the row was found by id above and the answer
    // is the register's from that point on.
    const gap = releaseGapVerdict([channel]);
    if (lane.required && gap.fatal) {
      die([
        'FAIL this is a RELEASE lane and no AppImage signing key is configured.',
        `     absent: ${declared.join(', ')}`,
        '',
        ...armedFatalLines(gap.armed),
        '',
        '     A release lane that cannot sign must not publish a direct download. The .AppImage is served from',
        '     dl.nikatru.com on R2 and never a direct GitHub link ([ADR 015] §4), so the detached signature is',
        '     the ENTIRE provenance story for this channel — an unsigned one is an anonymous binary on a CDN.',
        '',
        '     🔴 THIS IS AN OWNER ITEM, AND IT IS THREE OBLIGATIONS, NOT ONE.',
        `     ${REGISTER} records this row's custody as: "${channel.signing?.custody ?? '(undeclared)'}"`,
        '       1. GENERATE the Ed25519 keypair, and transcribe the PUBLIC half into',
        `          ${CHANNEL_ID}.signing.signingPublicKey.publicKeyBase64 in the same change.`,
        `       2. CUSTODY of the private half — keyKind "${channel.signing?.keyKind ?? 'own-signing-key'}" means no`,
        '          gatekeeper re-signs and no store can reissue. Losing it breaks every future update for the',
        '          users who verified an earlier one; disclosing it lets anyone publish as us.',
        `       3. A RESTORE DRILL. The row records restoreDrill.required=${drill?.required ?? 'undeclared'}`,
        `          and restoreDrill.date=${JSON.stringify(drill?.date ?? null)} — "${drill?.note ?? '(no note)'}"`,
        '          A backup nobody has restored from is a belief, not a backup.',
        '     Only the owner can do any of the three, so this lane cannot be unblocked by an agent.',
        '',
        '     …or run this lane on a non-release trigger, where an unsigned BUILD PROOF is the recorded,',
        '     labelled outcome rather than a silent one.',
      ]);
    }
    // A release lane whose channel is NOT armed. Printed in full, not fatal —
    // and confined to `lane.required`, so nothing a branch, a fork PR or the
    // weekly platform proof prints has changed by one byte.
    if (lane.required) {
      console.log('');
      for (const l of unarmedGapLines({
        armings: gap.unarmed,
        secretNames: declared,
        laneReasons: lane.reasons,
        ownerItem:
          'GENERATE the Ed25519 keypair, take CUSTODY of the private half, and run a RESTORE DRILL — ' +
          `three obligations no agent can discharge. ${REGISTER} records this row's custody as ` +
          `"${channel.signing?.custody ?? '(undeclared)'}"`,
      })) {
        console.log(l);
      }
    }
    console.log('');
    console.log(`⬜ SIGNING POSTURE: ${UNSIGNED_PROOF.toUpperCase()}`);
    console.log('   No AppImage signing key is set, so no detached signature is produced for this build.');
    console.log('   🔴 AN UNSIGNED .AppImage HAS NO PROVENANCE AT ALL. It is served from R2, where nothing but');
    console.log('      this signature distinguishes our build from anyone else\'s. This artifact is a build proof:');
    console.log('      it proves the Linux bundle compiles, and nothing about who produced it.');
    console.log('   ⬜ OWNER ITEM — GENERATE the keypair, record CUSTODY of the private half, and run a RESTORE');
    console.log(`      DRILL (restoreDrill.required=${drill?.required ?? 'undeclared'}, date=${JSON.stringify(drill?.date ?? null)}).`);
    console.log('      No agent can do any of the three, and a backup nobody has restored from is a belief.');
    if (verdict.print) console.log(`   ⬜ ${verdict.print}`);
    console.log('   This is the correct outcome for a branch, a fork PR and the weekly platform proof.');
    exportEnv({ [POSTURE_ENV]: UNSIGNED_PROOF });
    console.log('\nappimage-signing: OK (unsigned build proof, labelled)');
    process.exit(0);
  }

  // ── all supplied ───────────────────────────────────────────────────────────
  // 🔴 THE SENTINEL CHECK RUNS BEFORE ANY KEY MATERIAL TOUCHES DISK.
  const verdict = pinVerdict(pin, RELEASE_SIGNED);
  if (verdict.fatal) {
    die([
      '🔴 FAIL THE PUBLIC-KEY PIN AND THE POSTURE DISAGREE.',
      `     ${verdict.fatal}`,
      '',
      '     Nothing was written to disk. No key was materialised by this run.',
    ]);
  }

  assertExportable(Object.fromEntries(PASSTHROUGH.map((n) => [n, value(n)])));

  let decoded;
  try {
    decoded = decodeSigningKey(value(B64_ENV));
  } catch (e) {
    die([
      `FAIL ${B64_ENV} is not an ${ALGORITHM} private key — ${e.message}.`,
      '     No part of the value is printed. The usual cause is base64 of the wrong file, of a public key',
      '     instead of a private one, or of an error page a download produced.',
    ]);
  }

  let derivedPublic;
  try {
    derivedPublic = derivePublicKeyBase64(decoded.key);
  } catch (e) {
    coverageLost([
      `the public half could not be derived from the supplied ${ALGORITHM} key — ${e.message}.`,
      'The pin comparison below is the only check that the RIGHT key was supplied, and it cannot be made.',
    ]);
  }

  const mismatch = comparePublicKey(derivedPublic, pin);
  if (mismatch) {
    die(['FAIL the supplied signing key is not the pinned one.', `     ${mismatch}`, '', '     Nothing was written to disk.']);
  }

  // ── materialise, outside the workspace ─────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const keyPath = join(OUT_DIR, `${app.slug}-appimage-signing.pem`);
  const pubPath = join(OUT_DIR, `${app.slug}-appimage-signing.pub.pem`);
  if (!isAbsolute(keyPath) || !isAbsolute(pubPath)) {
    coverageLost([
      `the resolved key path ${keyPath} is not absolute.`,
      'A relative path resolves against whatever directory a later step happens to run in.',
    ]);
  }
  writeFileSync(keyPath, decoded.key.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  writeFileSync(pubPath, createPublicKey(decoded.key).export({ format: 'pem', type: 'spki' }), { mode: 0o644 });

  const exported = { [KEY_PATH_ENV]: keyPath, [PUB_PATH_ENV]: pubPath, [POSTURE_ENV]: RELEASE_SIGNED };
  for (const n of PASSTHROUGH) exported[n] = value(n);
  exportEnv(exported);

  console.log('');
  console.log(`ok   ${ALGORITHM} key materialised from a ${decoded.form} secret — written outside the workspace`);
  console.log(`ok   ${KEY_PATH_ENV} and ${PUB_PATH_ENV} point at it (the private value is never printed)`);
  console.log(`⬜ SIGNING POSTURE: ${RELEASE_SIGNED.toUpperCase()}`);
  if (verdict.print) console.log(`   ⬜ ${verdict.print}`);
  if (pin.kind === 'ed25519') {
    console.log(`ok   the supplied key derives to the PINNED public key ${pin.value} — checked before anything was signed`);
  }

  // ── the round-trip proof: this key really signs ────────────────────────────
  // node's crypto is always present, so this is not skippable and is not a
  // fixture: it signs a fresh random probe with the materialised private key and
  // verifies it with the DERIVED public key. A materialised credential that
  // cannot sign is the Android seam's lesson restated — "it says what it INTENDS;
  // it cannot say what the tool did" — closed here for the one part that can be.
  const probe = randomBytes(64);
  const probeSig = cryptoSign(null, probe, decoded.key);
  if (!cryptoVerify(null, probe, createPublicKey(decoded.key), probeSig)) {
    coverageLost([
      'the materialised key produced a signature that does not verify against its own public half.',
      'That is not a possible outcome for a well-formed Ed25519 key, so either the decode above produced',
      'something other than what it reported, or this runtime\'s crypto is not behaving as documented.',
    ]);
  }
  console.log(`ok   round-trip proof — the materialised key signed a ${probe.length}-byte probe and it verified`);

  // ── the commands, constructed as data ──────────────────────────────────────
  const artifacts = optAll('artifact');
  const sample = artifacts[0] ?? `build/${app.slug}-x86_64.AppImage`;
  const signCmd = buildSignCommand({ keyPath, artifact: sample });
  const verifyCmd = buildVerifyCommand({ publicKeyPath: pubPath, artifact: sample });
  console.log('');
  console.log('   ── the commands this posture authorises ──');
  console.log(`   ${signCmd.exe} ${signCmd.redacted.join(' ')}`);
  console.log(`   ${verifyCmd.exe} ${verifyCmd.redacted.join(' ')}`);

  // ── execution, guarded on the tool existing ────────────────────────────────
  const OPENSSL = resolveOpenssl();
  const problems = [];
  let signed = 0;
  if (OPENSSL === null) {
    console.log('');
    console.log('   ⬜ SIGNATURES NOT PRODUCED — openssl could not be run (not on PATH). The commands above are');
    console.log('      constructed and printed, and NOTHING was signed by them. A missing tool is not a passing');
    console.log(`      check: ${POSTURE_ENV} says "${RELEASE_SIGNED}" and the release lane that consumes it is`);
    console.log('      what must refuse to publish an .AppImage with no .sig beside it.');
  } else if (artifacts.length === 0) {
    console.log('');
    console.log(`   ⬜ SIGNATURES NOT PRODUCED — ${OPENSSL.version} is available but no --artifact was given, so`);
    console.log('      there is nothing built to sign yet. Pass the .AppImage after the build step.');
  } else {
    for (const a of artifacts) {
      const abs = isAbsolute(a) ? a : join(ROOT, a);
      if (!existsSync(abs)) {
        problems.push(`${a} does not exist. This step runs after the build; a missing artifact means the build did not produce what this lane claims it did.`);
        continue;
      }
      if (statSync(abs).size === 0) {
        problems.push(`${a} is ZERO bytes. A truncated AppImage signs perfectly well and fails on a user's machine.`);
        continue;
      }
      const s = buildSignCommand({ keyPath, artifact: abs, exe: OPENSSL.exe });
      const sr = spawnSync(s.exe, s.args, { encoding: 'utf8' });
      if (sr.status !== 0 || !existsSync(s.signaturePath)) {
        problems.push(`${a} — the detached signature was not produced (${`${sr.stderr ?? ''}`.trim().split('\n')[0] || 'no output'}).`);
        continue;
      }
      const v = buildVerifyCommand({ publicKeyPath: pubPath, artifact: abs, signaturePath: s.signaturePath, exe: OPENSSL.exe });
      const vr = spawnSync(v.exe, v.args, { encoding: 'utf8' });
      const parsed = parseOpensslVerify(`${vr.stdout ?? ''}${vr.stderr ?? ''}`);
      if (!parsed.recognised) {
        problems.push(
          `${a} — COVERAGE LOST: the openssl output matched neither "Signature Verified Successfully" nor ` +
            '"Signature Verification Failure". It cannot be read as a pass, and reading it as a failure would ' +
            'hide a parser that has stopped understanding the tool.',
        );
        continue;
      }
      if (!parsed.verified) {
        problems.push(`${a} — the detached signature does not verify against the pinned public key.`);
        continue;
      }
      console.log(`   ${a} · signed · ${s.signaturePath}`);
      signed++;
    }
    if (signed === 0 && problems.length === 0) {
      coverageLost([
        `${artifacts.length} artifact path(s) were given and NOT ONE was signed.`,
        "Every assertion above ranged over an empty set, which is this repository's single most repeated failure.",
      ]);
    }
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error('');
    console.error('  This channel has no gatekeeper downstream. A bad or missing signature is discovered by the');
    console.error('  users whose verification of the next update fails — which is the one group it exists for.');
    console.error('\nappimage-signing: FAILED');
    process.exit(1);
  }

  console.log('');
  console.log(
    `appimage-signing: OK — posture "${RELEASE_SIGNED}"` +
      `${signed > 0 ? `; ${signed}/${artifacts.length} artifact(s) signed and verified with ${OPENSSL.version}` : '; signature commands constructed, not executed (see above)'}`,
  );
}

const isEntry = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntry) main();
