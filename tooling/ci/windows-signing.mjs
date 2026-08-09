#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// windows-signing.mjs — materialise the Windows CODE-SIGNING CERTIFICATE for one
// CI build and decide, out loud, whether this run is allowed to be unsigned.
//
// This is tooling/ci/android-signing.mjs's shape applied to the `windows-direct`
// row of tooling/channel-register.json, and it is deliberately the SAME shape,
// because the defect it forecloses is the same one: a lane that quietly produces
// an artifact nobody can ship, with every check green.
//
//   all secrets supplied → arrange the .pfx in $RUNNER_TEMP, export
//                          WINDOWS_SIGNING_POSTURE=release-signed, construct the
//                          `signtool sign` command AND the `signtool verify /pa`
//                          read-back that proves it afterwards
//   none supplied        → posture = `unsigned-build-proof`, printed in capitals
//                          together with the OWNER item that is the real blocker
//                          — UNLESS this is a release lane AND the register ARMS
//                          this channel, where the absence is a FAILURE and not
//                          a posture
//   some supplied        → FAIL, always, on every lane. Half a credential is an
//                          artifact nobody can explain.
//
// 🔴 THE RELEASE-LANE FAILURE IS SCOPED BY THE REGISTER, NOT BY THE TAG ALONE,
// AND THAT CORRECTION WAS MEASURED. Until 2026-08-09 the middle ending read
// "UNLESS this is a release lane" full stop, and the consequence was that a
// `subly-v*` tag killed this job — while `apple-signing.mjs` killed the `apple`
// job and `appimage-signing.mjs` killed `linux_web_android` for the same reason.
// build-platforms.yml's `release` job `needs:` all three, so the FIRST GitHub
// Release this repository would ever publish was unreachable, blocked on a
// certificate protecting a download that does not exist: `windows-direct` is
// `submittable: false`, `served: false`, `lane: null`. The scope test now comes
// from those fields, through `tooling/ci/channel-arming.mjs`, and the gap is
// PRINTED IN FULL on the release lane instead ([pipeline C-6] — the owner-gated
// gap must print, because failing on a certificate only the owner can BUY blocks
// every merge and every release of every other channel). The failing case did
// not go away: arm the row in the register and the identical tag fails, naming
// the field that armed it. See channel-arming.mjs's header for the derivation.
//
// 🔴 THE DIFFERENCE FROM THE ANDROID ROW, AND IT IS THE WHOLE REASON THIS FILE
// EXISTS SEPARATELY: the Play upload key is a thing we HAVE. This certificate is
// a thing we must BUY, every year, from a CA in the Microsoft Trusted Root
// Program — the register says so in one sentence that is easy to skim past:
// "does not exist — and unlike every other row this one costs real money every
// year." So the unsigned ending here is not a temporary wiring gap somebody can
// close in an afternoon; it is an OWNER item with a RECURRING COST attached, and
// this script prints it as one. A gap that prints as a to-do gets ignored. A gap
// that prints as an invoice gets decided.
//
// ── WHAT THE REGISTER DECIDES AND WHAT THIS FILE DECIDES ────────────────────
// Names come from the REGISTER, never from this file — the same rule the Android
// seam applies to build.gradle.kts, for the same reason: two copies of a secret
// list drift, and the drift is SILENT. `signing.ciSecrets.names` on the
// `windows-direct` row is the declaration; this script reads it and asks for
// exactly those. Rename them there and this script asks for the new names;
// delete the row and it reports COVERAGE LOST rather than defaulting to "an
// unsigned build is fine".
//
// The ONE name declared here rather than read is WINDOWS_CODESIGN_PFX_BASE64 —
// the transport for the certificate FILE. signtool wants a path and a path
// cannot travel through a repository secret. It is cross-checked against the
// register's list, so the two cannot drift apart silently either.
//
// ── 🔴 THE SENTINEL PIN, AND WHY IT MUST FAIL LOUDLY ────────────────────────
// `signing.codeSigningCertificate.sha256` is a PIN: the thumbprint of the
// certificate we mean to sign with, so a swapped .pfx is caught here rather than
// by a user's SmartScreen prompt. Today its value is the string
// `CODE-SIGNING-CERT-NOT-PURCHASED`, recorded alongside a
// `notYetConfiguredSentinel` field carrying the same string — the register's way
// of saying "this field is a placeholder, not a value".
//
// A SENTINEL CAN NEVER MATCH A REAL CERTIFICATE. So there are exactly two honest
// readings of "the pin is the sentinel":
//   · posture is `unsigned-build-proof`  → correct and expected. Nothing was
//     signed, so there is nothing to compare. PRINT the gap; do not fail.
//   · posture claims `release-signed`    → 🔴 FAIL, LOUDLY. Something supplied a
//     certificate the register still describes as unpurchased. Either the
//     secrets were created and the register was never updated — in which case
//     the pin is unenforceable and every future swap is invisible — or key
//     material reached this build through a path nobody recorded. Both are the
//     exact shape of failure this repository keeps meeting: a check that is
//     present, green, and comparing against a placeholder.
// The tempting third reading — "skip the comparison when the pin is a sentinel"
// — is the assertion that cannot fail. It would make the release path pass on
// the day the pin stopped meaning anything.
//
// ── ⚠️ THE MICROSOFT STORE PATH IS NOT THIS FILE'S BUSINESS ─────────────────
// `windows-store` is a separate row with `keyKind: "none"`: the Store re-signs
// the .msix with its own certificate and no key of ours is involved. One line is
// printed saying so on every run — read out of the register rather than asserted
// from memory — because "windows" reading as ONE thing is precisely what the
// two-row split exists to prevent.
//
// ── ⚠️ WHAT THIS FILE CANNOT CLAIM, stated so green is not mistaken for safe ─
// signtool.exe ships with the Windows SDK and is absent from most machines,
// including the one this was authored on. So the sign and verify COMMANDS are
// constructed as data by pure functions, printed, and executed only when the
// tool is actually resolvable — with a printed note when it is not. A missing
// tool is never the same outcome as a passing check: with `--artifact` given and
// signtool absent, the read-back is reported as NOT PERFORMED.
//
// The verify-output parser reads `signtool verify /pa /v`, whose chain block is
// printed ROOT-FIRST with increasing indentation, leaf LAST. The leaf is selected
// by MAXIMUM INDENTATION rather than by position: correct under that format, and
// still correct if a future signtool reverses the order. It has been exercised
// against FIXTURES ONLY — see the header of tooling/ci/test/windows-signing.test.mjs,
// which says the same thing rather than implying more coverage than exists.
//
// Usage:
//   node tooling/ci/windows-signing.mjs [--app <slug>] [--out <dir>]
//                                       [--repo-root <path>] [--github-env <path>]
//                                       [--artifact <path>]… [--timestamp-url <url>]
// Env in:  the names tooling/channel-register.json declares on `windows-direct`
//          GITHUB_REF, GITHUB_WORKFLOW_REF — read to DERIVE whether this is a
//          release lane. There is deliberately no flag a workflow can set or forget.
// Env out (via $GITHUB_ENV): WINDOWS_CODESIGN_PFX_PATH, the declared passthrough
//          names, and WINDOWS_SIGNING_POSTURE.
// Exit 0 = the posture is decided and legal for this lane. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { armedFatalLines, releaseGapVerdict, unarmedGapLines } from './channel-arming.mjs';

export const APPS = 'sites/_shared/_data/apps.json';
export const REGISTER = 'tooling/channel-register.json';
export const CHANNEL_ID = 'windows-direct';
export const STORE_CHANNEL_ID = 'windows-store';
/** The transport for the certificate FILE — declared here because signtool wants
 *  a path and a path cannot travel through a repository secret. Cross-checked
 *  against the register's declared names below, so it cannot drift silently. */
export const B64_ENV = 'WINDOWS_CODESIGN_PFX_BASE64';
export const POSTURE_ENV = 'WINDOWS_SIGNING_POSTURE';
export const PATH_ENV = 'WINDOWS_CODESIGN_PFX_PATH';
export const RELEASE_SIGNED = 'release-signed';
export const UNSIGNED_PROOF = 'unsigned-build-proof';
/** RFC 3161 timestamp authority. A code signature without a timestamp stops
 *  verifying the day the certificate expires — which for a downloadable .exe
 *  means every build already on a user's disk turns untrusted at once. */
export const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com';

// ═════════════════════════════════════════════════════════════════════════════
// PURE DECISION FUNCTIONS
//
// Exported and free of the filesystem, the environment and any external binary,
// so their failing cases can be written as ordinary assertions rather than as a
// runner that needs a Windows SDK. Everything below the `main()` boundary is
// wiring; everything here is the law.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The secret-set law: all, none, or the state that is never legal.
 * `names` comes from the register; `env` is a plain object so a test can hand it
 * a map instead of process.env.
 */
export function decideSecretSet(names, env) {
  const value = (n) => (env[n] ?? '').trim();
  const supplied = names.filter((n) => value(n) !== '');
  const missing = names.filter((n) => value(n) === '');
  const state = supplied.length === 0 ? 'none' : missing.length === 0 ? 'all' : 'partial';
  return { supplied, missing, state };
}

/**
 * Is this a RELEASE lane? DERIVED from signals GitHub sets, never from a flag a
 * workflow could forget — the identical derivation android-signing.mjs makes,
 * and for the identical reason: the defect being foreclosed IS a switch that was
 * never thrown, so the answer may not depend on somebody remembering a line.
 *
 * (a) a TAG push — `GITHUB_REF` starting `refs/tags/`.
 * (b) the channel's DECLARED submission workflow, if the row declares one.
 *
 * ⚠️ `windows-direct` declares NO submission workflow today (`kind: "direct"`,
 * `submittable: false`), so limb (b) contributes nothing — and that is REPORTED
 * as a blind spot rather than assumed away. A derivation missing an input
 * answers a narrower question than it claims to.
 */
export function decideRelease({ gitRef = '', workflowRef = '', submissionWorkflow = null } = {}) {
  const reasons = [];
  const blind = [];
  const ref = String(gitRef).trim();
  const wf = String(workflowRef).trim();
  if (ref.startsWith('refs/tags/')) reasons.push(`the run is a TAG push (${ref})`);
  if (submissionWorkflow !== null && wf !== '') {
    // `owner/repo/.github/workflows/x.yml@refs/heads/main` — the PATH part only.
    // Matching the whole string would tie the answer to a branch name.
    const runningPath = wf.split('@')[0];
    if (runningPath.endsWith(`/${submissionWorkflow}`) || runningPath === submissionWorkflow) {
      reasons.push(`this is ${CHANNEL_ID}'s declared submission workflow (${submissionWorkflow})`);
    }
  }
  if (submissionWorkflow === null) {
    blind.push(
      `${REGISTER}'s ${CHANNEL_ID} row declares no \`submission.workflow\` (it is a direct-download row, not a ` +
        'store submission), so limb (b) contributed nothing — only a tag push can mark a release here.',
    );
  } else if (wf === '') {
    blind.push('GITHUB_WORKFLOW_REF is unset (not a GitHub job), so limb (b) could not be evaluated.');
  }
  return { required: reasons.length > 0, reasons, blind };
}

/** Colons, spaces and case are presentation. Compare the bytes. */
export const normaliseThumbprint = (fp) => String(fp).replace(/[\s:]/g, '').toUpperCase();

/**
 * What KIND of thing is in the register's pin field?
 *
 * 'absent'    — null. Weaker, not broken: print the gap, do not fail.
 * 'sentinel'  — equal to the row's own `notYetConfiguredSentinel`. A placeholder
 *               that can never match anything real.
 * 'sha256'    — 64 hex characters. A usable pin.
 * 'sha1'      — 40 hex characters. Called out SEPARATELY and by name because the
 *               register's own `source` line tells the owner to transcribe it
 *               with `Get-PfxCertificate | Format-List Subject,Thumbprint`, and
 *               PowerShell's `Thumbprint` property is a SHA-1. Following the
 *               recorded instruction literally therefore produces a value that
 *               can never match a SHA-256 comparison, and the resulting failure
 *               would read as "the artifact is signed by the wrong key". This
 *               branch exists so it reads as what it is.
 * 'malformed' — anything else.
 */
export function classifyPin(certificate) {
  const sentinel =
    typeof certificate?.notYetConfiguredSentinel === 'string' ? certificate.notYetConfiguredSentinel : null;
  const raw = certificate?.sha256 ?? null;
  if (raw === null) return { kind: 'absent', raw, sentinel, value: null };
  if (sentinel !== null && String(raw) === sentinel) return { kind: 'sentinel', raw, sentinel, value: null };
  const flat = normaliseThumbprint(raw);
  if (/^[0-9A-F]{64}$/.test(flat)) return { kind: 'sha256', raw, sentinel, value: flat };
  if (/^[0-9A-F]{40}$/.test(flat)) return { kind: 'sha1', raw, sentinel, value: flat };
  return { kind: 'malformed', raw, sentinel, value: null };
}

/**
 * 🔴 THE LOUD RULE. Given a pin classification and the posture this lane is
 * about to declare, is the pair coherent?
 *
 * Returns `{ fatal, print }` — `fatal` is a message that must end the run,
 * `print` is a gap that must be visible and is not a failure.
 */
export function pinVerdict(pin, posture) {
  if (posture === RELEASE_SIGNED) {
    if (pin.kind === 'sentinel') {
      return {
        fatal:
          `${REGISTER}'s ${CHANNEL_ID}.signing.codeSigningCertificate.sha256 is still the placeholder ` +
          `${JSON.stringify(pin.sentinel)}, and this lane is about to declare posture "${RELEASE_SIGNED}". ` +
          'A sentinel can never match a real certificate, so the pin is comparing NOTHING while reporting that ' +
          'it compared. Either a certificate was configured and the register was never updated — in which case ' +
          'every future swap of that secret is invisible — or key material reached this build through a path ' +
          'nobody recorded. Transcribe the issued certificate into that field in the same change that creates ' +
          'the secrets.',
        print: null,
      };
    }
    if (pin.kind === 'sha1') {
      return {
        fatal:
          `${REGISTER}'s ${CHANNEL_ID}.signing.codeSigningCertificate.sha256 is ${JSON.stringify(pin.raw)} — 40 hex ` +
          "characters, which is a SHA-1, not a SHA-256. PowerShell's `Get-PfxCertificate | Format-List Thumbprint` " +
          "emits SHA-1, and that is the command the register's own `source` line recommends. A SHA-1 in a SHA-256 " +
          'field can never match, so every release build would fail with a message about the artifact instead of ' +
          'about this line. Re-read it as SHA-256 (`Get-FileHash` over the exported .cer, or `certutil -dump`).',
        print: null,
      };
    }
    if (pin.kind === 'malformed') {
      return {
        fatal:
          `${REGISTER}'s ${CHANNEL_ID}.signing.codeSigningCertificate.sha256 is ${JSON.stringify(pin.raw)}, which is ` +
          "neither a SHA-256 thumbprint nor the row's declared placeholder. It can never match any certificate.",
        print: null,
      };
    }
    if (pin.kind === 'absent') {
      return {
        fatal: null,
        print:
          `NO PINNED THUMBPRINT — ${REGISTER}'s ${CHANNEL_ID}.signing.codeSigningCertificate.sha256 is null, so the ` +
          'read-back below cannot say WHICH certificate signed the artifact, only that one did. A .pfx secret ' +
          'silently replaced by another valid certificate would be accepted here and surface as a changed ' +
          "publisher name in a user's SmartScreen prompt.",
      };
    }
    return { fatal: null, print: null };
  }
  // Unsigned build proof. Nothing was signed, so nothing is compared — and the
  // sentinel is the CORRECT state of the record, not a defect.
  if (pin.kind === 'sentinel') {
    return {
      fatal: null,
      print:
        `the pinned thumbprint is still ${JSON.stringify(pin.sentinel)}, which is correct: no certificate has been ` +
        'purchased, so there is nothing to pin and nothing was signed. This line becomes a FAILURE the moment a ' +
        `lane declares "${RELEASE_SIGNED}" without updating it.`,
    };
  }
  return { fatal: null, print: null };
}

/**
 * The signing command, as data.
 *
 * Returns `{ exe, args, redacted }`. `redacted` is the same argv with the
 * password replaced — printing `args` would put a secret in a public build log,
 * and "we will remember not to print it" is not a mechanism.
 */
export function buildSignCommand({
  pfxPath,
  password,
  artifact,
  timestampUrl = DEFAULT_TIMESTAMP_URL,
  exe = 'signtool',
}) {
  if (!pfxPath || !artifact) throw new Error('buildSignCommand needs pfxPath and artifact');
  const args = [
    'sign',
    '/f', pfxPath,
    '/p', String(password ?? ''),
    // SHA-256 file digest. SHA-1 authenticode is refused by current Windows.
    '/fd', 'SHA256',
    // RFC 3161 timestamp + its own SHA-256 digest. Without this the signature
    // dies with the certificate and every already-downloaded build turns
    // untrusted on the same day.
    '/tr', timestampUrl,
    '/td', 'SHA256',
    '/v',
    artifact,
  ];
  const pIdx = args.indexOf('/p') + 1;
  const redacted = args.map((a, i) => (i === pIdx ? '***' : a));
  return { exe, args, redacted };
}

/**
 * The READ-BACK. `signtool verify /pa` asks Windows the question a user's
 * machine will ask: does this signature chain to a root in the Microsoft Trusted
 * Root Program? `/pa` selects the Authenticode policy — without it signtool uses
 * the Windows-driver policy and a perfectly good application signature reports
 * as untrusted.
 *
 * ⚠️ THIS IS A SEPARATE COMMAND FROM THE SIGN, ON PURPOSE. A step that arranges
 * a credential and then reports its own success is the "green means ran" failure
 * with extra stages — the same pairing android-signing.mjs has with
 * assert-artifact-signed.mjs.
 */
export function buildVerifyCommand({ artifact, exe = 'signtool' }) {
  if (!artifact) throw new Error('buildVerifyCommand needs artifact');
  return { exe, args: ['verify', '/pa', '/v', artifact], redacted: ['verify', '/pa', '/v', artifact] };
}

/**
 * Parse `signtool verify /pa /v` output.
 *
 * 🔴 THE VERDICT IS THE PARSED TEXT, NEVER THE EXIT STATUS — the same lesson
 * assert-artifact-signed.mjs records about keytool exiting 0 on an unsigned
 * archive. This parser is handed a string precisely so its failing cases are
 * plain assertions.
 *
 * The chain block is printed root-first with increasing indentation, leaf LAST
 * and most indented. The leaf is chosen by MAXIMUM INDENTATION rather than by
 * position: that is correct under the documented format and remains correct if a
 * future signtool reverses the order. A one-element chain resolves to itself.
 *
 * Returns `{ verified, leaf, entries, errors, warnings, recognised }`.
 * `recognised === false` means the text matched nothing this parser knows, which
 * the caller must treat as COVERAGE LOST — never as a pass, and never as a
 * fail-by-default that would hide a broken parser behind a plausible verdict.
 */
export function parseSigntoolVerify(text) {
  const src = String(text ?? '');
  const entries = [];
  let current = null;
  for (const line of src.split(/\r?\n/)) {
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    let m;
    if ((m = t.match(/^Issued to:\s*(.+?)\s*$/))) {
      current = { indent, subject: m[1], sha256: null, sha1: null };
      entries.push(current);
      continue;
    }
    if (current === null) continue;
    if ((m = t.match(/^SHA256 hash:\s*([0-9A-Fa-f\s:]+?)\s*$/))) current.sha256 = normaliseThumbprint(m[1]);
    else if ((m = t.match(/^SHA1 hash:\s*([0-9A-Fa-f\s:]+?)\s*$/))) current.sha1 = normaliseThumbprint(m[1]);
  }
  let leaf = null;
  for (const e of entries) if (leaf === null || e.indent > leaf.indent) leaf = e;

  const successfully = src.match(/Number of files successfully Verified:\s*(\d+)/i);
  const errorCount = src.match(/Number of errors:\s*(\d+)/i);
  const warnCount = src.match(/Number of warnings:\s*(\d+)/i);
  const sawSuccessLine = /^\s*Successfully verified:/m.test(src);
  const sawError = /SignTool Error:/i.test(src);

  const recognised = successfully !== null || sawSuccessLine || sawError;
  const verified =
    successfully !== null
      ? Number(successfully[1]) > 0 && (errorCount === null || Number(errorCount[1]) === 0)
      : sawSuccessLine && !sawError;

  return {
    recognised,
    verified: recognised ? verified : false,
    leaf,
    entries,
    errors: errorCount === null ? null : Number(errorCount[1]),
    warnings: warnCount === null ? null : Number(warnCount[1]),
  };
}

/**
 * Compare a parsed read-back against the pin. Returns a problem string, or null.
 * Separated from the parse so that "the output was unreadable" and "the wrong
 * certificate signed it" can never collapse into one verdict.
 */
export function compareThumbprint(parsed, pin) {
  if (!parsed.recognised) {
    return (
      'COVERAGE LOST — the signtool output matched nothing this parser recognises: neither a verification ' +
      'summary nor a SignTool Error. It cannot be read as a pass, and reading it as a failure would hide a ' +
      'parser that has stopped understanding the tool.'
    );
  }
  if (!parsed.verified) {
    return (
      'signtool did not verify the artifact against the Authenticode policy (/pa). An unsigned or untrusted ' +
      'binary is exactly what a direct download must never be.'
    );
  }
  if (pin.kind !== 'sha256') return null; // the gap is printed by pinVerdict
  if (parsed.leaf === null || parsed.leaf.sha256 === null) {
    return (
      'signtool verified the artifact but printed no SHA-256 for the signing certificate, so the pin was NOT ' +
      'compared. Reporting a pinned match here would be a claim about a comparison that did not happen.'
    );
  }
  if (parsed.leaf.sha256 !== pin.value) {
    return (
      'the artifact is signed by a certificate that is NOT the pinned one. expected SHA-256 ' +
      `${pin.value.match(/../g).join(':')}; found ${parsed.leaf.sha256.match(/../g).join(':')} ` +
      `(${JSON.stringify(parsed.leaf.subject)}). If the certificate was renewed or replaced deliberately, update ` +
      `${REGISTER}'s ${CHANNEL_ID}.signing.codeSigningCertificate in the same change.`
    );
  }
  return null;
}

/**
 * Is the decoded secret a PKCS#12 (.pfx) at all?
 *
 * Structure, not a size floor: an invented minimum length fires on a correct
 * small certificate and passes a padded stub. PKCS#12 is DER, so the first byte
 * of a real one is a SEQUENCE tag, 0x30. What this catches is the case no later
 * step can attribute — base64 of the wrong file, or of an HTML error page a
 * download produced and somebody pasted into a secret.
 */
export function looksLikePkcs12(bytes) {
  return bytes.length > 0 && bytes[0] === 0x30;
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

/** 🔴 AN EMPTY STRING IS NOT AN UNSET VARIABLE, and `??` cannot tell them apart.
 *  Recorded on the Android seam and inherited here unchanged: with `RUNNER_TEMP=''`
 *  — which a shell produces by exporting an empty value — `resolve('')` is the
 *  CURRENT DIRECTORY, so the .pfx would be written INSIDE the repository, which
 *  is the one place this file exists to keep it out of. */
const envOr = (name, fallback) => {
  const v = (process.env[name] ?? '').trim();
  return v === '' ? fallback : v;
};

const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const OUT_DIR = resolve(opt('out') ?? envOr('RUNNER_TEMP', tmpdir()));
const GITHUB_ENV = opt('github-env') ?? envOr('GITHUB_ENV', null);
const TIMESTAMP_URL = opt('timestamp-url') ?? DEFAULT_TIMESTAMP_URL;

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

/** The scan cannot continue and reporting a posture would be a claim about
 *  nothing. Same idiom as every guard in tooling/ci. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nwindows-signing: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nwindows-signing: FAILED');
  process.exit(1);
}

/**
 * A newline in a value is REFUSED rather than escaped. `$GITHUB_ENV` is
 * line-oriented, so a value carrying one writes a SECOND assignment of the
 * writer's choosing into the environment of every later step in the job — a
 * secret becomes a way to set PATH.
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

/** ALL OR NONE, and that is why this is ONE call — a later reader seeing one
 *  variable of two concludes the config is HALF supplied, which is the state
 *  this file refuses everywhere else. */
function exportEnv(pairs) {
  assertExportable(pairs);
  if (GITHUB_ENV === null) {
    console.log('');
    console.log('⬜ NOT EXPORTED — no $GITHUB_ENV and no --github-env, so nothing was written for later');
    console.log('   steps. Outside a GitHub job that is expected. Inside one it is a wiring fault, and the');
    console.log(`   downstream read-back refuses to run without ${POSTURE_ENV}.`);
    for (const k of Object.keys(pairs)) console.log(`   would export: ${k}`);
    return;
  }
  appendFileSync(GITHUB_ENV, `${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
}

/** Resolved rather than assumed. "The tool was missing" and "the artifact is
 *  fine" must not be the same outcome, so this returns null and the caller
 *  PRINTS the gap instead of skipping quietly. */
function resolveSigntool() {
  const explicit = opt('signtool');
  const candidates = explicit ? [explicit] : ['signtool', 'signtool.exe'];
  for (const c of candidates) {
    const r = spawnSync(c, ['/?'], { encoding: 'utf8' });
    if (!r.error) return c;
  }
  return null;
}

function main() {
  // ── the register is the declaration ────────────────────────────────────────
  const registerRaw = read(REGISTER);
  if (registerRaw === null) {
    coverageLost([
      `${REGISTER} does not exist.`,
      'It declares which secrets this channel takes and pins the certificate they must carry. Without it the',
      'posture decision would be made blind and would default to "an unsigned build is fine" — on the one',
      'lane where it is not.',
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
      'That row carries the secret names, the certificate pin and the submission path. With it gone this',
      'script would ask for names of its own invention and pin against undefined.',
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
      'It is the ONLY declaration of what this channel needs. A hard-coded copy in this file would drift from',
      'it silently — this script would keep asking for names nothing supplies while every build reported a',
      'clean unsigned proof.',
    ]);
  }
  if (!declared.includes(B64_ENV)) {
    coverageLost([
      `${REGISTER}'s ${CHANNEL_ID} row declares ${declared.join(', ')} and does NOT declare ${B64_ENV}.`,
      'That name is the transport for the certificate FILE and is the one name this script owns rather than',
      'reads. The two have drifted: either the register was renamed, or this constant is stale. Reconcile them',
      'in one change — a decoded certificate with nothing pointing at it is a silent unsigned build.',
    ]);
  }
  const PASSTHROUGH = declared.filter((n) => n !== B64_ENV);

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

  console.log(
    `── Windows direct-download signing · app "${app.slug}" · lane requires signing: ${lane.required ? 'YES' : 'no'} ──`,
  );
  for (const r of lane.reasons) console.log(`   required because ${r}`);
  if (!lane.required)
    console.log('   no release signal (not a tag push, not a declared submission workflow) — a BUILD PROOF is legal here');
  for (const b of lane.blind) console.log(`   ⬜ ${b}`);

  // The one line about the OTHER Windows row, READ FROM THE REGISTER rather than
  // asserted from memory — the two paths have OPPOSITE signing answers, and
  // "windows" reading as one thing is what the split exists to prevent.
  const storeRow = (register.channels ?? []).find((c) => c.id === STORE_CHANNEL_ID);
  const storeKind = storeRow?.signing?.keyKind ?? 'UNDECLARED';
  console.log(
    `   ⬜ OUT OF SCOPE: the Microsoft Store path (${STORE_CHANNEL_ID}, keyKind "${storeKind}") is NOT signed here — ` +
      'the Store re-signs the .msix with its own certificate, so no key of ours is involved and ' +
      `${storeRow?.submission?.script ?? 'its submission script'} owns that lane.`,
  );

  // ── what was actually supplied ─────────────────────────────────────────────
  const set = decideSecretSet(declared, process.env);
  const value = (n) => (process.env[n] ?? '').trim();

  if (set.state === 'partial') {
    die([
      'FAIL Windows code signing is HALF configured and this build refuses to guess.',
      `     supplied: ${set.supplied.join(', ')}`,
      `     missing:  ${set.missing.join(', ')}`,
      '     Supply all of them or none. A .pfx with no password (or a password with no .pfx) produces an',
      '     UNSIGNED .exe from a run that looked like a signing run — and an unsigned direct download is',
      '     precisely what Microsoft Store Policies §10.2.9 forbids for this channel.',
    ]);
  }

  const pin = classifyPin(channel.signing?.codeSigningCertificate);

  if (set.state === 'none') {
    const verdict = pinVerdict(pin, UNSIGNED_PROOF);
    // 🔴 IS THE CHANNEL ARMED? Derived from THIS row's own register fields —
    // `served`, `submittable`, `lane` — and never from a channel name written
    // here. The row was found by id above; from here on the answer is the
    // register's, so arming `windows-direct` needs no edit to this file and
    // cannot be undone by one either.
    const gap = releaseGapVerdict([channel]);
    if (lane.required && gap.fatal) {
      // 🔴 THE WHOLE POINT OF THE FILE.
      die([
        'FAIL this is a RELEASE lane and no Windows code-signing secrets are configured.',
        `     absent: ${declared.join(', ')}`,
        '',
        ...armedFatalLines(gap.armed),
        '',
        '     A release lane that cannot sign must not produce a direct-download artifact. Microsoft Store',
        '     Policies v7.19 §10.2.9 requires every PE file on a non-gaming direct download to be signed by a',
        '     certificate chaining to the Microsoft Trusted Root Program; an unsigned .exe reaches the user as',
        '     a SmartScreen block, which is the first place this failure would otherwise surface.',
        '',
        '     🔴 THIS IS AN OWNER ITEM WITH A RECURRING COST, NOT A WIRING GAP.',
        `     ${REGISTER} records this row's custody as: "${channel.signing?.custody ?? '(undeclared)'}"`,
        '     Closing it means PURCHASING a code-signing certificate from a CA in the Microsoft Trusted Root',
        '     Program and RENEWING it every year. Nobody can create these secrets until that purchase happens,',
        '     so this lane cannot be unblocked by an agent.',
        '',
        '     Once purchased, create the repository secrets (Settings → Secrets and variables → Actions):',
        ...declared.map((n) => `       ${n}`),
        `     …and transcribe the issued certificate into ${CHANNEL_ID}.signing.codeSigningCertificate in the`,
        '     same change, or the pin stays a placeholder and this script fails on the next release lane.',
        '     …or run this lane on a non-release trigger, where an unsigned BUILD PROOF is the recorded,',
        '     labelled outcome rather than a silent one.',
      ]);
    }
    // A release lane whose channel is NOT armed. Printed in full — the loudest
    // thing this run says — and not fatal, because failing would block the
    // release of five channels that ARE ready on a certificate only the owner
    // can buy. This block does not exist on a non-release trigger, so every
    // branch, fork PR and weekly proof prints exactly what it printed before.
    if (lane.required) {
      console.log('');
      for (const l of unarmedGapLines({
        armings: gap.unarmed,
        secretNames: declared,
        laneReasons: lane.reasons,
        ownerItem:
          'a Windows code-signing certificate must be PURCHASED from a CA in the Microsoft Trusted Root ' +
          `Program and RENEWED every year. ${REGISTER} records this row's custody as ` +
          `"${channel.signing?.custody ?? '(undeclared)'}"`,
      })) {
        console.log(l);
      }
    }
    console.log('');
    console.log(`⬜ SIGNING POSTURE: ${UNSIGNED_PROOF.toUpperCase()}`);
    console.log('   No Windows code-signing secrets are set, so nothing signs the .exe / .msix produced here.');
    console.log('   🔴 AN UNSIGNED DIRECT DOWNLOAD IS BLOCKED BY SMARTSCREEN. This artifact is a build proof: it');
    console.log('      proves the Windows module compiles, and nothing about a code-signing certificate.');
    console.log('   ⬜ OWNER ITEM — a code-signing certificate must be PURCHASED from a CA in the Microsoft');
    console.log('      Trusted Root Program, and RENEWED every year. It is the only signing credential in this');
    console.log('      register that costs money on a recurring basis, and no agent can create it.');
    if (verdict.print) console.log(`   ⬜ ${verdict.print}`);
    console.log('   This is the correct outcome for a branch, a fork PR and the weekly platform proof.');
    exportEnv({ [POSTURE_ENV]: UNSIGNED_PROOF });
    console.log('\nwindows-signing: OK (unsigned build proof, labelled)');
    process.exit(0);
  }

  // ── all supplied: the posture this run is about to claim ───────────────────
  // 🔴 THE SENTINEL CHECK RUNS BEFORE ANY KEY MATERIAL TOUCHES DISK. Writing the
  // .pfx first would leave a real certificate on a runner from a run that
  // failed — a half-state, and this repo does not ship those.
  const verdict = pinVerdict(pin, RELEASE_SIGNED);
  if (verdict.fatal) {
    die([
      '🔴 FAIL THE CERTIFICATE PIN AND THE POSTURE DISAGREE.',
      `     ${verdict.fatal}`,
      '',
      '     Nothing was written to disk. No .pfx was materialised by this run.',
    ]);
  }

  assertExportable(Object.fromEntries(PASSTHROUGH.map((n) => [n, value(n)])));

  const b64 = value(B64_ENV).replace(/\s+/g, '');
  if (b64 === '')
    coverageLost([`${B64_ENV} is whitespace only after trimming — it passed the presence check and carries nothing.`]);
  const bytes = Buffer.from(b64, 'base64');
  // Buffer.from ignores anything that is not base64 rather than throwing, so a
  // secret pasted with a stray fragment decodes to SOMETHING and the truncation
  // is discovered by signtool, later, in a message about a PKCS#12 format.
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
    die([
      `FAIL ${B64_ENV} is not valid base64 (it decodes to ${bytes.length} byte(s) and does not round-trip).`,
      '     The value is never printed. Re-create it from the .pfx with a tool that emits a single unbroken',
      '     base64 string, and paste it without added line breaks or quotes.',
    ]);
  }
  if (!looksLikePkcs12(bytes)) {
    die([
      `FAIL ${B64_ENV} decodes to ${bytes.length} byte(s) that are not a PKCS#12 archive.`,
      `     Expected DER (first byte 0x30, a SEQUENCE); found first byte 0x${bytes[0]?.toString(16).padStart(2, '0') ?? '--'}.`,
      '     No part of the value is printed. The usual cause is base64 of the wrong file, of a PEM, or of an',
      '     error page a download produced.',
    ]);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const pfxPath = join(OUT_DIR, `${app.slug}-codesign.pfx`);
  if (!isAbsolute(pfxPath)) {
    coverageLost([
      `the resolved .pfx path ${pfxPath} is not absolute.`,
      'A relative path resolves against whatever directory a later step happens to run in, which is not where',
      'this wrote it.',
    ]);
  }
  // 0600 on a POSIX runner; Windows ignores the mode and its ACL already limits
  // $RUNNER_TEMP to the run. Written OUTSIDE the workspace either way: every
  // actions/upload-artifact path in this repo is workspace-relative, and on a
  // PUBLIC repo an uploaded artifact is downloadable by anyone.
  writeFileSync(pfxPath, bytes, { mode: 0o600 });

  const exported = { [PATH_ENV]: pfxPath, [POSTURE_ENV]: RELEASE_SIGNED };
  for (const n of PASSTHROUGH) exported[n] = value(n);
  exportEnv(exported);

  console.log('');
  console.log(`ok   certificate materialised — ${bytes.length} byte(s) written outside the workspace`);
  console.log(`ok   ${PATH_ENV} points at it; ${PASSTHROUGH.length} further variable(s) exported (values never printed)`);
  console.log(`⬜ SIGNING POSTURE: ${RELEASE_SIGNED.toUpperCase()}`);
  if (verdict.print) console.log(`   ⬜ ${verdict.print}`);
  if (pin.kind === 'sha256')
    console.log(`ok   pinned thumbprint ${pin.value.match(/../g).join(':')} — the read-back below compares against it`);

  // ── the commands, constructed as data ──────────────────────────────────────
  const artifacts = optAll('artifact');
  const sample = artifacts[0] ?? `build/windows/x64/runner/Release/${app.slug}.exe`;
  const sign = buildSignCommand({
    pfxPath,
    password: value(PASSTHROUGH[0] ?? ''),
    artifact: sample,
    timestampUrl: TIMESTAMP_URL,
  });
  const verify = buildVerifyCommand({ artifact: sample });
  console.log('');
  console.log('   ── the commands this posture authorises (password redacted) ──');
  console.log(`   ${sign.exe} ${sign.redacted.join(' ')}`);
  console.log(`   ${verify.exe} ${verify.redacted.join(' ')}`);

  // ── the read-back, executed only if it CAN be ──────────────────────────────
  const SIGNTOOL = resolveSigntool();
  const problems = [];
  let readBack = 0;
  if (SIGNTOOL === null) {
    console.log('');
    console.log('   ⬜ READ-BACK NOT PERFORMED — signtool could not be run (not on PATH; it ships with the Windows');
    console.log('      SDK). The commands above are constructed and printed, and NOTHING was verified. A missing');
    console.log(`      tool is not a passing check: ${POSTURE_ENV} says "${RELEASE_SIGNED}" and the lane that`);
    console.log('      consumes it is what must refuse an unverified release.');
  } else if (artifacts.length === 0) {
    console.log('');
    console.log('   ⬜ READ-BACK NOT PERFORMED — signtool is available but no --artifact was given, so there is');
    console.log('      nothing built to verify yet. Pass the .exe / .msix after the build step.');
  } else {
    for (const a of artifacts) {
      const abs = isAbsolute(a) ? a : join(ROOT, a);
      if (!existsSync(abs)) {
        problems.push(
          `${a} does not exist. This read-back runs after the build; a missing artifact means the build did not produce what this lane claims it did.`,
        );
        continue;
      }
      if (statSync(abs).size === 0) {
        problems.push(`${a} is ZERO bytes. A truncated binary signs and ships and fails on a user's machine.`);
        continue;
      }
      const cmd = buildVerifyCommand({ artifact: abs, exe: SIGNTOOL });
      const r = spawnSync(cmd.exe, cmd.args, { encoding: 'utf8' });
      const parsed = parseSigntoolVerify(`${r.stdout ?? ''}${r.stderr ?? ''}`);
      if (parsed.leaf)
        console.log(
          `   ${a} · signer ${JSON.stringify(parsed.leaf.subject)}${parsed.leaf.sha256 ? ` · SHA-256 ${parsed.leaf.sha256.match(/../g).join(':')}` : ''}`,
        );
      const problem = compareThumbprint(parsed, pin);
      if (problem) problems.push(`${a} — ${problem}`);
      else readBack++;
    }
    if (readBack === 0 && problems.length === 0) {
      coverageLost([
        `${artifacts.length} artifact path(s) were given and NOT ONE was read back.`,
        "Every assertion above ranged over an empty set, which is this repository's single most repeated failure.",
      ]);
    }
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error('');
    console.error('  A direct-download binary that does not verify against the Authenticode policy reaches the user');
    console.error('  as a SmartScreen block — the last place in the chain where this could have been found.');
    console.error('\nwindows-signing: FAILED');
    process.exit(1);
  }

  console.log('');
  console.log(
    `windows-signing: OK — posture "${RELEASE_SIGNED}"` +
      `${readBack > 0 ? `; ${readBack}/${artifacts.length} artifact(s) read back with signtool` : '; read-back constructed, not performed (see above)'}`,
  );
}

const isEntry = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntry) main();
