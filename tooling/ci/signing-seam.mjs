// ─────────────────────────────────────────────────────────────────────────────
// signing-seam.mjs — the signing PRIMITIVES, once. Each per-keyKind signing
// script in tooling/ci (apple-signing.mjs, android-signing.mjs,
// appimage-signing.mjs) is, or is becoming, an ADAPTER over this module: it
// knows its key kind, its register rows, its messages and its exits; this module
// knows how a release lane is recognised, what the all-or-none law says, how a
// key is decoded and placed, and how a value reaches $GITHUB_ENV.
//
// 🔴 WHY THIS EXISTS — O-SIGNING-PRIMITIVES-IN-FOUR-COPIES. Measured at Public
// main 80ef8e39, with four signing scripts: `coverageLost` and `fail` in three
// files, the base64 decode-and-magic check in three, `exportEnv` in three (only
// ONE of them refusing a value with a line break in it), `decideSecretSet` in
// two, and the release-lane derivation in all four. The copies had already
// diverged in the one place that matters most: android refused a newline before
// writing $GITHUB_ENV, and appimage did not. A primitive with a copy per script
// is a fix that has to land N times, and the Nth is the one that is forgotten.
//
// ⏱ 2026-09-25 — apple-signing.mjs is the FIRST adapter (C5a). android-signing
// and appimage-signing still carry their own copies until C5b moves them; the
// census in test/signing-seam-census.test.mjs names both as PENDING and fails
// the day either stops defining the primitive it is listed for, so the list is
// emptied by the change that empties it.
//
// ── THE ONE DESIGN CHOICE ───────────────────────────────────────────────────
// `releaseLane()` asks the REGISTER, not the environment alone, whether this run
// must be release-signed: the ref says "this is a release", and channel-arming's
// `releaseGapVerdict` says whether any row this adapter serves can reach a user.
// `mustSign` is the conjunction. The arming law lives in channel-arming.mjs and
// is imported, never re-stated here.
//
// ── WHAT THIS MODULE DELIBERATELY DOES NOT HOLD ──────────────────────────────
//   · a channel id. The adapter hands in the rows it looked up by id and the
//     label its messages use ("Apple"); the census test checks this file
//     against every id the real register declares.
//   · a process exit. A refusal comes back as a verdict with its lines, or goes
//     through the `fail` the adapter hands in; the adapter's own `coverageLost`
//     and `die` print it and exit, and assert-guard-coverage reads that exit in
//     the adapter's file, where it has always read it. Nothing here exits, so
//     every function is callable from a test.
//   · a spawn. Nothing here runs an external tool (bounded-spawn.test.mjs B7c
//     is the check on the adapters that do).
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { REGISTER, releaseGapVerdict } from './channel-arming.mjs';

/**
 * THE ALL-OR-NONE LAW. Which of `names` carry a value in `values`.
 * `kind` is 'all' | 'none' | 'partial'; an adapter treats 'partial' as fatal on
 * every lane, and may narrow it only by a rule it states (apple's KEYLESS_ENV).
 * An empty string, or one that is only whitespace, counts as ABSENT.
 *
 * Refuses an empty `names`: over zero names `missing` is empty too, and the law
 * would answer 'all' about a set nobody declared.
 */
export function decideSecretSet(names, values) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new TypeError('decideSecretSet needs the non-empty list of names the law ranges over');
  }
  const has = (n) => String(values?.[n] ?? '').trim() !== '';
  const supplied = names.filter(has);
  const missing = names.filter((n) => !has(n));
  const kind = missing.length === 0 ? 'all' : supplied.length === 0 ? 'none' : 'partial';
  return { kind, supplied, missing };
}

/**
 * IS THIS A RELEASE LANE? — the ref half, DERIVED from what GitHub sets and
 * never from a flag a workflow can delete:
 *
 *   (a) a TAG push — `gitRef` starting `refs/tags/`;
 *   (b) the rows' DECLARED submission workflow — `workflowRef`'s PATH (the part
 *       before `@`, so a branch name cannot change the answer) ending in one of
 *       `submissionWorkflows`.
 *
 * `blind` names each limb that could not contribute, so a narrowed derivation is
 * printed rather than hidden. `label` is the adapter's word for its rows.
 */
export function releaseSignal({ gitRef = '', workflowRef = '', submissionWorkflows = [], label } = {}) {
  if (typeof label !== 'string' || label.trim() === '') throw new TypeError('releaseSignal needs the label its messages name the rows by');
  const reasons = [];
  const blind = [];
  const ref = String(gitRef ?? '').trim();
  const wfRef = String(workflowRef ?? '').trim();
  const declared = submissionWorkflows.filter((w) => typeof w === 'string' && w !== '');

  if (ref.startsWith('refs/tags/')) reasons.push(`the run is a TAG push (${ref})`);

  if (declared.length > 0 && wfRef !== '') {
    const runningPath = wfRef.split('@')[0];
    for (const w of new Set(declared)) {
      if (runningPath.endsWith(`/${w}`) || runningPath === w) {
        reasons.push(`this is a declared ${label} submission workflow (${w})`);
        break;
      }
    }
  }
  if (declared.length === 0) {
    blind.push(
      `no ${label} row in ${REGISTER} declares a \`submission.workflow\`, so limb (b) contributed nothing — ` +
        'only a tag push can mark a release here.',
    );
  }
  if (wfRef === '' && declared.length > 0) {
    blind.push('GITHUB_WORKFLOW_REF is unset (not a GitHub job), so limb (b) could not be evaluated.');
  }
  return { required: reasons.length > 0, reasons, blind };
}

/**
 * MUST THIS RUN SIGN? `rows` are the register rows the adapter serves, as the
 * register handed them back; `gitRef` / `workflowRef` are GITHUB_REF and
 * GITHUB_WORKFLOW_REF.
 *
 * Returns `{ lane, gap, mustSign }`: `lane` is `releaseSignal()`'s answer over
 * the rows' own `submission.workflow`, `gap` is channel-arming's
 * `releaseGapVerdict(rows)` (which rows are armed, which are not), and
 * `mustSign` is "a release lane AND an armed row". ONE armed row is enough — an
 * adapter serving two rows signs both with one identity.
 *
 * Throws on no rows: every adapter exits COVERAGE LOST before this when its row
 * is absent, and a verdict over zero rows is "nothing is armed", a pass.
 */
export function releaseLane({ rows, gitRef = '', workflowRef = '', label } = {}) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((r) => r === null || typeof r !== 'object')) {
    throw new TypeError('releaseLane needs the register rows the adapter serves — a verdict over none arms nothing');
  }
  const lane = releaseSignal({
    gitRef,
    workflowRef,
    submissionWorkflows: rows.map((r) => r.submission?.workflow).filter((w) => typeof w === 'string'),
    label,
  });
  const gap = releaseGapVerdict(rows);
  return { lane, gap, mustSign: lane.required && gap.fatal };
}

/**
 * DECODE A BASE64 KEY SECRET AND CHECK WHAT IT OPENS WITH.
 *
 * Base64 that is not base64 decodes to SOMETHING — `Buffer.from` ignores what it
 * cannot read rather than throwing — so a secret pasted with a stray fragment
 * truncates silently and is discovered later, by a tool, in a message about a
 * file format. Re-encoding and comparing is the only way to see it.
 *
 * `magic` is null (no structural check) or a list of ALTERNATIVE byte prefixes,
 * each a non-empty byte array — `[[0x30]]` for DER, several for a keystore that
 * may be one of three formats. Structure, not a size floor: an invented minimum
 * length fires on a correct small file and passes a padded stub.
 *
 * Returns `{ bytes, problem, lines, length, found }`. `problem` is null (and
 * `bytes` the decoded key), or one of 'empty' | 'not-base64' | 'magic' (and
 * `bytes` null). `lines` is the message for that problem; an adapter may print
 * its own instead for 'magic', where the key kind is what the reader needs.
 * `found` is the hex of the leading bytes the magic was compared against. No
 * part of the value itself is ever put into `lines`.
 */
export function decodeKey(b64, { name = 'the value', magic = null } = {}) {
  if (magic !== null && (!Array.isArray(magic) || magic.length === 0 || magic.some((m) => Buffer.from(m).length === 0))) {
    throw new TypeError('decodeKey `magic` is null or a non-empty list of non-empty byte prefixes');
  }
  const text = String(b64 ?? '').replace(/\s+/g, '');
  if (text === '') {
    return {
      bytes: null,
      problem: 'empty',
      length: 0,
      found: null,
      lines: [`${name} is whitespace only after trimming — it passed the presence check and carries nothing.`],
    };
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== text.replace(/=+$/, '')) {
    return {
      bytes: null,
      problem: 'not-base64',
      length: bytes.length,
      found: null,
      lines: [
        `FAIL ${name} is not valid base64 (it decodes to ${bytes.length} byte(s) and does not round-trip).`,
        '     The value is never printed. Re-create it with a tool that emits a single unbroken base64 string,',
        '     and paste it without added line breaks or quotes.',
      ],
    };
  }
  if (magic !== null) {
    const prefixes = magic.map((m) => Buffer.from(m));
    const width = Math.max(...prefixes.map((p) => p.length));
    const head = bytes.subarray(0, width);
    const found = head.length === 0 ? '--' : `0x${head.toString('hex')}`;
    if (!prefixes.some((p) => bytes.length >= p.length && bytes.subarray(0, p.length).equals(p))) {
      return {
        bytes: null,
        problem: 'magic',
        length: bytes.length,
        found,
        lines: [
          `FAIL ${name} decodes to ${bytes.length} byte(s) that do not open with the expected format marker.`,
          `     Expected ${prefixes.map((p) => `0x${p.toString('hex')}`).join(' or ')}; found ${found}.`,
          '     No part of the value is printed. The usual cause is base64 of the wrong file, or of an error page.',
        ],
      };
    }
    return { bytes, problem: null, length: bytes.length, found, lines: [] };
  }
  return { bytes, problem: null, length: bytes.length, found: null, lines: [] };
}

/**
 * WRITE KEY MATERIAL, and nothing else, to an ABSOLUTE path with `mode`.
 *
 * A relative path resolves against the working directory, which for a CI job is
 * the repository — the one place key material must stay out of, because every
 * `actions/upload-artifact` path is workspace-relative and this repository is
 * public. `chmod` follows the write because `writeFileSync`'s `mode` applies only
 * when the file is CREATED; a file already at the path would keep its old mode.
 *
 * Returns null when written, or the refusal as lines for the adapter's
 * `coverageLost` — nothing is written on a refusal.
 */
export function placeKey(path, bytes, mode = 0o600) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return [
      `the key-material path is not absolute (${String(path)}).`,
      'A relative path resolves against the working directory, which for a CI job is the repository — the',
      'one place key material must stay out of.',
    ];
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return [`refusing to write ${bytes instanceof Uint8Array ? 'zero bytes' : 'a non-byte value'} as key material to ${path}.`];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { mode });
  chmodSync(path, mode);
  return null;
}

/** The keys whose value carries a line break. $GITHUB_ENV is line-oriented, so
 *  such a value would inject a second, attacker-chosen assignment. */
export function newlineOffenders(pairs) {
  return Object.entries(pairs).filter(([, v]) => /[\r\n]/.test(String(v))).map(([k]) => k);
}

/**
 * Append `pairs` to $GITHUB_ENV in ONE write, so every later step in the job
 * sees the same complete set — exporting one variable of several makes every
 * other reader see a HALF-supplied configuration.
 *
 * 🔴 A VALUE WITH A LINE BREAK IS REFUSED BEFORE ANYTHING IS WRITTEN, through
 * the adapter's `fail`. Android refused this; apple checked it; appimage did
 * not — the divergence this module was extracted to end.
 *
 * `githubEnv` null, undefined or blank is "no $GITHUB_ENV": nothing is written,
 * and that is PRINTED — `unexported` is the adapter's line(s) saying what
 * refuses to run without the export — never a silent pass. A blank path is
 * treated as unset rather than opened: `appendFileSync('')` is ENOENT after the
 * posture was already printed as decided.
 *
 * Returns true when written, false otherwise.
 */
export function exportEnv(pairs, githubEnv, { fail, unexported = [], log = (line) => console.log(line) } = {}) {
  if (typeof fail !== 'function') throw new TypeError("exportEnv needs the adapter's fail(): a refusal with nowhere to go is a skip");
  const offenders = newlineOffenders(pairs);
  if (offenders.length) {
    fail([
      `FAIL the value for ${offenders.join(', ')} contains a line break, and $GITHUB_ENV is line-oriented.`,
      '     Writing it would inject a second, attacker-chosen assignment into the job environment.',
      '     Re-create the secret without the trailing newline. The value itself is never printed.',
    ]);
    return false;
  }
  if (githubEnv === null || githubEnv === undefined || String(githubEnv).trim() === '') {
    log('');
    log('⬜ NOT EXPORTED — no $GITHUB_ENV and no --github-env, so nothing was written for later');
    log(`   steps. Outside a GitHub job that is expected. Inside one it is a wiring fault${unexported.length ? ', and' : '.'}`);
    for (const l of unexported) log(l);
    for (const k of Object.keys(pairs)) log(`   would export: ${k}`);
    return false;
  }
  appendFileSync(githubEnv, `${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  return true;
}
