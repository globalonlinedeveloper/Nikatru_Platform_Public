#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// submit-appstore.mjs — the repeatable submission path for BOTH Apple store
// channels: ios-appstore (.ipa) and macos-appstore (.pkg).
//
// [pipeline D-10] "For each store channel, the path from signed artifact to
//                  submitted release is scripted and repeatable … so submission
//                  #2 costs minutes, not archaeology."
//
// D-10's replacement acceptance has three re-checkable limbs. This file is
// limb (i) — "a submission script exists AND resolves to a step in a workflow,
// parsed not grepped". Limb (ii) is Private/runbooks/store-submission-apple.md.
// Limb (iii) — a submission record in the [10]D-9 ledger — needs a real
// submission and stays UNSATISFIED; it is the only one of the three that can
// prove the path was walked rather than merely written, and nothing here
// pretends otherwise.
//
// ── WHY ONE SCRIPT FOR TWO CHANNELS ──────────────────────────────────────────
// The two rows are separate submissions with separate App Store Connect records,
// separate metadata trees and independent review outcomes — which is why the
// register carries two rows and this repo carries two metadata trees. But they
// authenticate with the SAME Apple Developer account (ACTIVE since 2026-08-31) and the
// SAME App Store Connect API key. Two scripts would be two copies of one
// authentication path, and the second one would be the first to drift
// ([pipeline F-2]). So: one script, `--channel`, and every path it touches comes
// from the register row it was pointed at.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the artifact and the bundle
//              identifier the Xcode project actually builds, and exits 0 WITHOUT
//              one byte leaving the machine. This is the mode CI runs.
// `--submit`   ⏱ 2026-10-03 (release lane apple-ready) — UPLOADS THE SIGNED BUILD
//              TO APP STORE CONNECT FOR TESTFLIGHT PROCESSING, AND NOTHING ELSE.
//              It never creates a version, never attaches a build to one and
//              never submits anything for App Review: that is the owner's one
//              console act ([ADR 031] class A). In order: the Small Business
//              Program gate (assert-small-business-program.mjs
//              --real-submission), the store's own typed word (--confirm
//              UPLOAD-IOS-TO-TESTFLIGHT or UPLOAD-MACOS-TO-TESTFLIGHT),
//              the lane (GitHub Actions only, a job carrying `environment:` that
//              reads the bundles' signatures first, and the store-publish
//              environment read back with its required reviewer), every check the
//              dry run makes, and only then the upload. Until 2026-10-03 it
//              REFUSED with `UNVERIFIED:` lines; each is now sourced (below).
//
// ── THE TOOL LANDSCAPE, SO THE NEXT READER DOES NOT RE-DERIVE IT ─────────────
// THE UPLOAD IS THE APP STORE CONNECT API'S BUILD UPLOADS RESOURCE (API 4.1), read
// from developer.apple.com/documentation/appstoreconnectapi/build-uploads on
// 2026-10-03: POST /v1/buildUploads {cfBundleShortVersionString, cfBundleVersion,
// platform IOS|MAC_OS, relationships.app} → POST /v1/buildUploadFiles {assetType
// ASSET, fileName, fileSize, uti com.apple.ipa|com.apple.pkg} answers
// `uploadOperations` [{method, url, offset, length, requestHeaders}] → each part
// sent as given → PATCH /v1/buildUploadFiles/{id} {uploaded: true} → GET
// /v1/buildUploads/{id} `state.state` AWAITING_UPLOAD|PROCESSING|FAILED|COMPLETE.
// "You can also use Xcode or Transporter" — both need a Mac; this needs Node and
// HTTPS, so it runs on any runner. `xcrun altool` is NOT used: workflow-scan.mjs
// classifies it as a store CLI, and the API is the supported route.
// THE TOKEN is ES256 over {iss, iat, exp ≤ 20 min, aud appstoreconnect-v1} with
// `kid` — tooling/ops/provision-apple.mjs `ascJwt`, the one signer, MEASURED: it
// answered HTTP 200 against the live account on 2026-09-16 and again 2026-10-03.
//
// 🔴 `xcrun notarytool` IS NOT PART OF EITHER CHANNEL HERE. Notarization belongs
// to **Developer ID direct distribution** — a `.dmg`/`.pkg` hosted by us — which
// this register does not carry as a row at all. A **Mac App Store** submission is
// signed and reviewed, NOT notarized. Conflating the two is the most common way
// this path goes wrong, so it is written in three places: here, the
// macos-appstore tree README, and the runbook.
//
// 🔴 NOTHING HERE IS LIVE AND NOTHING HERE CAN BE. Both rows are `served: false`.
// CORRECTED 2026-09-08: this paragraph used to open "There is no Apple Developer
// account", frozen at a reading from 2026-08-03, twenty-eight days before the
// enrolment. There IS one, it is ACTIVE, and its App Store Connect API key exists
// and works — it is what answered HTTP 200. What does not exist is a distribution
// certificate or a provisioning profile (both empty sets on 2026-09-08), and
// this script wires NONE of them. A dry run over an artifact that cannot yet be
// signed is still worth having: it is what makes enrolment day minutes rather
// than archaeology, which is the whole of D-10.
// ⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP): the certificate and the profile
// exist since 2026-09-09, and build-platforms.yml signs with them. ⏱ 2026-10-01 (#1187):
// submit-appstore.yml signs in its dry-run job too, and hands the signed bytes on.
//
// Usage:
//   node tooling/release/submit-appstore.mjs --dry-run --channel ios-appstore
//   node tooling/release/submit-appstore.mjs --dry-run --channel macos-appstore --app subscriptiontracker
//   node tooling/release/submit-appstore.mjs --dry-run --channel ios-appstore --allow-missing-artifact
//   node tooling/release/submit-appstore.mjs --submit  --channel ios-appstore --app subscriptiontracker \
//        --confirm UPLOAD-IOS-TO-TESTFLIGHT --bundle-short-version 1.0.7 --bundle-version 7
//        (GitHub Actions only, in submit-appstore.yml's `submit` job)
//   [--repo-root <path>]   point every path below at a different tree (tests)
//   APP_STORE_CONNECT_API_BASE_URL   a LOOPBACK test seam for the upload (tests); anything else refuses
//   APPLE_RELEASE_TARGET   '' or `testflight` — the only target there is; any other value refuses
//                          (assert-channel-register.mjs reads the same variable: PUBLIC_REACH)
//
// Exit 0 = the submission path is walkable (dry run), or the build was uploaded
//          and App Store Connect did not report it FAILED (submit).
//       1 = it is not, a gate refused, or App Store Connect refused or FAILED the upload.
//       2 = COVERAGE LOST: an input it must read is absent or unreadable (submit-common.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readAppleBundleId } from '../ci/read-identity.mjs';
import { appleArtifactPath } from '../ci/apple-signing.mjs';
import { parseWorkflow } from '../ci/workflow-scan.mjs';
import { ascJwt } from '../ops/provision-apple.mjs';
import { submitCli, storeSubmitter, invokedAsScript, requirePublishEnvironment, PUBLISH_ENVIRONMENT } from './submit-common.mjs';
import { bundleIdOf, REGISTER as APPLE_REGISTER } from '../ci/apple-provisioning.mjs';
import { storeRecordOf, missingIdsOf } from '../store/store-record.mjs';

const CHANNELS = ['ios-appstore', 'macos-appstore'];
const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';

// ── the ChannelSubmitter (submit-common.mjs · tooling/ports/channels.json) ────
/** The typed word `--submit` needs, ONE PER STORE (assert-publish-steps-guarded.mjs
 *  limb 2: a shared word is one decision taken twice): the `confirm_ios` /
 *  `confirm_macos` dispatch inputs of submit-appstore.yml, compared again here
 *  (submit-play.mjs PG-1's shape). Each names what happens — an upload for
 *  TestFlight processing — and not a review. */
export const CONFIRM_TOKENS = Object.freeze({ 'ios-appstore': 'UPLOAD-IOS-TO-TESTFLIGHT', 'macos-appstore': 'UPLOAD-MACOS-TO-TESTFLIGHT' });
/** The guard the submit job must run on the downloaded bundles BEFORE the upload
 *  step (PG-4): it reads each signature, profile and entitlement out of the bytes. */
const SIGNATURE_GUARD = 'assert-artifact-signed-apple.mjs';
/** The one target there is. assert-channel-register.mjs's PUBLIC_REACH reads the
 *  same variable: unset or `testflight` reaches no public step. */
export const RELEASE_TARGET_ENV = 'APPLE_RELEASE_TARGET';

/** Both Apple channels behind the one store contract — one submitter per row,
 *  as the register carries one row per channel. ⏱ 2026-10-03: the plan is what
 *  `--submit` does — one API upload, read back — and it stops there; the review
 *  submission is the owner's console act and this submitter writes nothing there
 *  (stores-07: one write surface per plan). */
const appleSubmitter = (channel) =>
  storeSubmitter({
    channel,
    script: 'tooling/release/submit-appstore.mjs',
    steps: (artifact) => [
      { does: `run the Small Business Program gate for ${channel} before any upload`, surface: 'local', call: `node tooling/ci/assert-small-business-program.mjs --for-submission=${channel} --real-submission`, writes: false },
      { does: `upload ${artifact?.path ?? 'the signed build'} to App Store Connect for TestFlight processing (never submitted for review)`, surface: 'api', call: 'POST /v1/buildUploads, POST /v1/buildUploadFiles, the upload operations, PATCH /v1/buildUploadFiles/{id}', writes: true },
      { does: 'read the build upload back until App Store Connect reports PROCESSING or COMPLETE, and fail on FAILED', surface: 'api', call: 'GET /v1/buildUploads/{id}', writes: false },
      { does: 'STOP: attaching the build to a version and submitting it for review is the owner\'s console act, never this script\'s', surface: 'console', call: 'App Store Connect — Private/runbooks/store-submission-apple.md', writes: false },
    ],
    uploadArgv: (artifact, opts) => ['--submit', '--channel', channel, '--app', artifact.app, '--confirm', opts?.confirm ?? ''],
  });
export const iosAppstoreSubmitter = appleSubmitter(CHANNELS[0]);
export const macosAppstoreSubmitter = appleSubmitter(CHANNELS[1]);

// ── the upload transport (App Store Connect API 4.1, Build Uploads) ──────────
// Function DECLARATIONS on purpose: `cli()` runs at the `invokedAsScript` line
// below, and a `const` declared after it would still be in its temporal dead zone.

/** The App Store Connect origin, or a LOOPBACK test seam. Anything else refuses:
 *  the requests carry a bearer token minted from the team's API key. */
export function ascApiBase(env = process.env) {
  const canonical = 'https://api.appstoreconnect.apple.com';
  const raw = String(env.APP_STORE_CONNECT_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (raw === '' || raw === canonical) return { base: canonical, loopback: false };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: `APP_STORE_CONNECT_API_BASE_URL is set and is not a URL: ${JSON.stringify(raw)}.` };
  }
  const loopback = u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!loopback) {
    return {
      error:
        `APP_STORE_CONNECT_API_BASE_URL points at ${u.origin}, which is neither ${canonical} nor loopback. It exists so the ` +
        'tests can drive the real transport against a local server; any other value would send a token minted from the ' +
        "team's API key, and a signed build, to that host.",
    };
  }
  return { base: raw, loopback: true };
}

/** An upload operation's URL is Apple's (https, a host under apple.com) — or, under
 *  the loopback seam only, that same loopback origin. The parts carry the signed
 *  build, so a reservation answer naming any other host is refused, not followed. */
export function uploadUrlProblem(url, api) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return `upload operation URL ${JSON.stringify(String(url).slice(0, 120))} is not a URL`;
  }
  if (api.loopback) return u.origin === new URL(api.base).origin ? null : `upload operation URL ${u.origin} is not the loopback seam's origin`;
  if (u.protocol !== 'https:' || !(u.hostname === 'apple.com' || u.hostname.endsWith('.apple.com'))) {
    return `upload operation URL ${u.origin} is not an https host under apple.com — refused, not followed`;
  }
  return null;
}

/** A CFBundleShortVersionString / CFBundleVersion as App Store Connect accepts it:
 *  one to three period-separated non-negative integers. */
export function bundleVersionProblem(name, value) {
  if (typeof value !== 'string' || !/^\d+(\.\d+){0,2}$/.test(value)) {
    return `${name} is ${JSON.stringify(value)}; it is one to three period-separated integers, read off the built bundle by the dry-run job`;
  }
  return null;
}

const ascErr = (j) => (j?.errors ?? []).map((e) => `${e.code ?? ''} ${e.detail ?? e.title ?? ''}`.trim()).join('; ') || 'no error body';

/**
 * Upload ONE signed build and read it back. Returns `{ ok, uploadId, state, lines }`
 * and never exits; every line is ready to print.
 *   · `token()` mints a fresh JWT per request (a token lives 15 minutes; an upload
 *     plus its read-back can outlast one);
 *   · each upload operation is sent with exactly its method, headers, offset and
 *     length, with a bounded retry on a transport error or a 5xx;
 *   · the read-back polls GET /v1/buildUploads/{id} until PROCESSING or COMPLETE
 *     (accepted), FAILED (refused, its errors printed), or the ceiling — at which a
 *     state still AWAITING_UPLOAD is a failure and anything else is reported as read.
 */
export async function uploadBuild({
  api,
  token,
  appRecordId,
  platform,
  shortVersion,
  bundleVersion,
  bytes,
  fileName,
  uti,
  fetchImpl = fetch,
  pollMs = 20000,
  ceilingMs = 20 * 60 * 1000,
  partTimeoutMs = 10 * 60 * 1000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const lines = [];
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${api.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120000),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
  const fail = (line, extra = {}) => ({ ok: false, lines: [...lines, `FAIL ${line}`], ...extra });

  // 1 · the upload record
  const created = await call('POST', '/v1/buildUploads', {
    data: {
      type: 'buildUploads',
      attributes: { cfBundleShortVersionString: shortVersion, cfBundleVersion: bundleVersion, platform },
      relationships: { app: { data: { type: 'apps', id: appRecordId } } },
    },
  });
  if (created.status !== 201 || typeof created.json?.data?.id !== 'string') {
    return fail(`POST /v1/buildUploads answered ${created.status}: ${ascErr(created.json)}. Nothing was uploaded.`);
  }
  const uploadId = created.json.data.id;
  lines.push(`ok   build upload ${uploadId} created — ${platform} ${shortVersion} (${bundleVersion}) on App Store Connect record ${appRecordId}`);

  // 2 · the file reservation
  const reserved = await call('POST', '/v1/buildUploadFiles', {
    data: {
      type: 'buildUploadFiles',
      attributes: { assetType: 'ASSET', fileName, fileSize: bytes.length, uti },
      relationships: { buildUpload: { data: { type: 'buildUploads', id: uploadId } } },
    },
  });
  const fileId = reserved.json?.data?.id;
  const ops = reserved.json?.data?.attributes?.uploadOperations;
  if (reserved.status !== 201 || typeof fileId !== 'string' || !Array.isArray(ops) || ops.length === 0) {
    return fail(`POST /v1/buildUploadFiles answered ${reserved.status}: ${ascErr(reserved.json)} (upload ${uploadId} holds no file).`, { uploadId });
  }
  // Every part is checked BEFORE the first byte leaves: the set must tile the file exactly.
  let covered = 0;
  const sorted = [...ops].sort((a, b) => Number(a.offset) - Number(b.offset));
  for (const [i, op] of sorted.entries()) {
    const problem = uploadUrlProblem(op?.url, api);
    if (problem) return fail(`${problem} (operation ${i + 1} of ${ops.length}).`, { uploadId });
    if (!Number.isInteger(op.offset) || !Number.isInteger(op.length) || op.length < 1 || op.offset !== covered) {
      return fail(`upload operation ${i + 1} is offset ${op.offset}, length ${op.length}; the parts must tile the ${bytes.length}-byte file from 0 with no gap or overlap.`, { uploadId });
    }
    covered += op.length;
  }
  if (covered !== bytes.length) return fail(`the ${ops.length} upload operations cover ${covered} bytes of a ${bytes.length}-byte file.`, { uploadId });

  // 3 · the parts
  for (const [i, op] of sorted.entries()) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).filter((h) => h?.name).map((h) => [h.name, String(h.value ?? '')]));
    let status = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetchImpl(op.url, {
          method: String(op.method || 'PUT').toUpperCase(),
          headers,
          body: bytes.subarray(op.offset, op.offset + op.length),
          signal: AbortSignal.timeout(partTimeoutMs),
        });
        status = res.status;
        await res.arrayBuffer().catch(() => null);
        if (res.ok) break;
        if (res.status < 500) break;
      } catch (e) {
        lastError = e;
        status = null;
      }
      if (attempt < 3) await sleep(2000 * attempt);
    }
    if (status === null || status < 200 || status > 299) {
      return fail(`upload operation ${i + 1} of ${sorted.length} (${op.length} bytes) answered ${status ?? `no response (${lastError?.message ?? 'unknown'})`} after its retries. Upload ${uploadId} is incomplete and was NOT committed.`, { uploadId });
    }
  }
  lines.push(`ok   ${sorted.length} upload operation(s) sent — ${bytes.length} bytes of ${fileName}`);

  // 4 · the commit
  const committed = await call('PATCH', `/v1/buildUploadFiles/${fileId}`, {
    data: { type: 'buildUploadFiles', id: fileId, attributes: { uploaded: true } },
  });
  if (committed.status !== 200) {
    return fail(`PATCH /v1/buildUploadFiles/${fileId} (uploaded: true) answered ${committed.status}: ${ascErr(committed.json)}.`, { uploadId });
  }
  lines.push(`ok   build upload file ${fileId} committed`);

  // 5 · the read-back, with a ceiling
  const started = Date.now();
  let state = null;
  for (;;) {
    const read = await call('GET', `/v1/buildUploads/${uploadId}`);
    if (read.status !== 200) return fail(`GET /v1/buildUploads/${uploadId} answered ${read.status}: ${ascErr(read.json)}.`, { uploadId, state });
    const s = read.json?.data?.attributes?.state;
    state = typeof s?.state === 'string' ? s.state : null;
    const details = (k) => (Array.isArray(s?.[k]) ? s[k].map((d) => `${d?.code ?? ''} ${d?.description ?? ''}`.trim()).filter(Boolean) : []);
    if (state === 'FAILED') {
      return fail(`App Store Connect FAILED build upload ${uploadId}: ${details('errors').join('; ') || 'no error detail'}.`, { uploadId, state });
    }
    if (state === 'COMPLETE' || (state === 'PROCESSING' && Date.now() - started >= ceilingMs)) {
      for (const w of details('warnings')) lines.push(`⬜   warning from App Store Connect: ${w}`);
      lines.push(`ok   build upload ${uploadId} reads ${state}${state === 'PROCESSING' ? ` at the ${Math.round(ceilingMs / 60000)}-minute ceiling — processing continues on Apple's side; the build appears in TestFlight when it ends` : ''}`);
      return { ok: true, uploadId, state, lines };
    }
    if (Date.now() - started >= ceilingMs) {
      return fail(`build upload ${uploadId} still reads ${JSON.stringify(state)} after ${Math.round(ceilingMs / 60000)} minutes; a committed upload that has not reached PROCESSING is not accepted.`, { uploadId, state });
    }
    await sleep(pollMs);
  }
}

// ── the CLI, which runs only when this file is the entry point ────────────────
// ⏱ 2026-10-01 (port-channels): the export above made this file a module that
// tooling/release/test/submitters.contract.test.mjs imports, and a script whose
// body runs on import cannot be imported — it would read the test's argv and
// exit. So the body is `cli()`, called below only when node was pointed at this
// file. The body is the CLI exactly as it was, and it is DELIBERATELY LEFT AT
// COLUMN 0: re-indenting it would rewrite every line other lanes patch here, and
// every patch to it would stop applying. Its behaviour, flags and exit codes are
// unchanged; the dry runs in ci.yml `app-dryrun` walk it as before.
if (invokedAsScript(import.meta.url)) await cli();

async function cli() {
// ── arguments, and the two stops (submit-common.mjs: COVERAGE LOST exits 2) ──
const { flag, opt, root: ROOT, ok, abs, read, coverageLost, die, appOf } = submitCli('submit-appstore');

const DRY_RUN = flag('dry-run');
const SUBMIT = flag('submit');
const ALLOW_MISSING_ARTIFACT = flag('allow-missing-artifact');

const problems = [];
const prints = [];

if (DRY_RUN === SUBMIT) {
  die([
    'FAIL exactly one of --dry-run and --submit is required.',
    '     Defaulting either way is how a dry run becomes a submission (or a submission',
    '     silently becomes a no-op). The mode has to be said out loud.',
  ]);
}

const CHANNEL_ID = opt('channel');
if (!CHANNELS.includes(CHANNEL_ID)) {
  die([
    `FAIL --channel must be one of: ${CHANNELS.join(', ')}${CHANNEL_ID ? ` (got ${JSON.stringify(CHANNEL_ID)})` : ' (none given)'}.`,
    '     iOS and macOS are SEPARATE App Store Connect records with separate metadata trees and',
    '     independent review outcomes. Defaulting to one of them would submit the wrong listing',
    '     to the right account, which reviews cleanly and is still wrong.',
  ]);
}

// ── --submit: the gates, FIRST, before anything else runs ─────────────────────
// ⏱ 2026-10-03 (release lane apple-ready). Until today this block REFUSED every
// --submit with seven UNVERIFIED lines. The ones the upload needs are sourced in
// the header (the Build Uploads resource, read 2026-10-03; the JWT, measured
// live); the three about versions, listings and the review submission are not
// needed, because this script never does any of them — the review submission is
// the owner's console act. Every gate below still runs BEFORE any check, so a
// refused --submit never gets partway.
// 🔴 THE FIRST GATE: the Small Business Program gate
// (AB-M5-02). It reads two registers and sends nothing, and it guards the
// SUBMISSION rather than the bytes: a submission made from a laptop, or through
// the App Store Connect API once the calls below are sourced, sells at the
// standard commission unless the enrolment is recorded. CI publish jobs carry it
// through submit-preconditions.mjs; this path had nothing. It stays here, in
// front of the upload. Resolved from THIS
// FILE, like the D-6 preflight below, so `--repo-root` points only its reads.
const SBP_GATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-small-business-program.mjs');
const sbpCommand = `node tooling/ci/assert-small-business-program.mjs --for-submission=${CHANNEL_ID} --real-submission`;
const SBP_GATE_TIMEOUT_MS = 120000;
// 🔴 A GATE, NOT A REPORT: a non-zero status exits HERE, in its own block, before
// the lane gates below and long before the upload, so it still stops a submission
// the gate refused whatever is edited after it (#1088 review, minor 1). A gate that did not answer (timeout,
// signal) is a refusal too: its status is null, never 0.
if (SUBMIT) {
  const g = spawnSync(process.execPath, [SBP_GATE, `--for-submission=${CHANNEL_ID}`, '--real-submission', ROOT], {
    encoding: 'utf8',
    timeout: SBP_GATE_TIMEOUT_MS,
  });
  console.error('');
  console.error(
    g.status === 0
      ? `ok   the Small Business Program gate passed (${sbpCommand}).`
      : `FAIL the Small Business Program gate REFUSED this submission (${sbpCommand} exited ${g.status}${g.error ? `, ${g.error.code ?? g.error.message}` : ''}):`,
  );
  for (const l of `${g.stdout ?? ''}${g.stderr ?? ''}`.trimEnd().split('\n')) console.error(`     ${l}`);
  if (g.status !== 0) {
    console.error('\nsubmit-appstore: FAILED — nothing was submitted.');
    // The gate's COVERAGE LOST (2) is not folded into a refusal's 1: it could not read the enrolment at all.
    process.exit(g.status === 2 ? 2 : 1);
  }
}

// ── PG-1 … PG-5 · the lane gates (submit-play.mjs's, with the Apple guard) ────
// Each one refuses BEFORE any check below runs and long before a byte leaves.
const CONFIRM = opt('confirm', '');
const SHORT_VERSION = opt('bundle-short-version');
const BUNDLE_VERSION = opt('bundle-version');
if (SUBMIT) {
  // PG-1 · the typed word. The workflow's job `if:` reads the same input; the `if:` is one
  // deletable YAML line, so the script compares it again where the upload runs.
  if (CONFIRM !== CONFIRM_TOKENS[CHANNEL_ID]) {
    die([
      `FAIL --submit --channel ${CHANNEL_ID} requires --confirm ${CONFIRM_TOKENS[CHANNEL_ID]}; got ${JSON.stringify(CONFIRM ?? '')}.`,
      '     This is the dispatch input a human types. --submit uploads a signed build to the live App Store',
      '     Connect account, where its build number is consumed for that version forever. A mode flag alone',
      '     is one typo away from that. .github/workflows/submit-appstore.yml passes each store’s own confirm input through.',
    ]);
  }
  // PG-2 · you cannot upload an artifact you declined to look for.
  if (ALLOW_MISSING_ARTIFACT) {
    die([
      'FAIL --allow-missing-artifact is a DRY-RUN flag and --submit refuses it.',
      '     Combined with --submit it would mean "upload the build, and never mind whether there is one".',
    ]);
  }
  // PG-2b · the target: TestFlight processing is the only one. assert-channel-register.mjs's
  // PUBLIC_REACH reads this variable too, so the gate and the script cannot mean different things.
  const target = (process.env[RELEASE_TARGET_ENV] ?? '').trim();
  if (target !== '' && target !== 'testflight') {
    die([
      `FAIL ${RELEASE_TARGET_ENV} is ${JSON.stringify(target)}; this script uploads for TestFlight processing and nothing else.`,
      '     Submitting a build for App Review is the owner\'s console act ([ADR 031] class A). There is no other target.',
    ]);
  }
  // PG-2c · the two version strings the upload record declares, read off the built bundles by the
  // dry-run job (plutil) and handed on; App Store Connect then holds the binary to them.
  const versionProblems = [bundleVersionProblem('--bundle-short-version', SHORT_VERSION), bundleVersionProblem('--bundle-version', BUNDLE_VERSION)].filter(Boolean);
  if (versionProblems.length) die(versionProblems.map((p) => `FAIL ${p}.`));
  // PG-3 · the lane: the reviewer approval [ADR 031] requires exists only on a GitHub environment.
  if ((process.env.GITHUB_ACTIONS ?? '') !== 'true' || (process.env.GITHUB_REPOSITORY ?? '').trim() === '') {
    die([
      'FAIL --submit runs only inside GitHub Actions (GITHUB_ACTIONS=true and GITHUB_REPOSITORY set).',
      `     [ADR 031] the publish gate is the "${PUBLISH_ENVIRONMENT}" environment with a REQUIRED REVIEWER, and that`,
      '     approval exists only in a run\'s history. Dispatch .github/workflows/submit-appstore.yml instead.',
    ]);
  }
  // PG-4 · the lane is SHAPED like a gated lane, read from its own YAML: every job that runs
  // `submit-appstore.mjs --submit` declares `environment:` and runs the signature guard on the
  // downloaded bundles BEFORE that step.
  {
    let subWorkflowRel = '.github/workflows/submit-appstore.yml';
    try {
      const row = (JSON.parse(read(REGISTER) ?? '{}').channels ?? []).find((c) => c.id === CHANNEL_ID);
      if (typeof row?.submission?.workflow === 'string') subWorkflowRel = row.submission.workflow;
    } catch {
      /* the register is parsed properly, with its own COVERAGE LOST, below */
    }
    const wf = parseWorkflow(ROOT, subWorkflowRel);
    if (wf === null) die([`FAIL the submission workflow ${subWorkflowRel} does not exist under ${ROOT}; PG-4 reads the gate's shape out of it.`]);
    const isSubmit = (l) => /submit-appstore\.mjs/.test(l.text) && /--submit\b/.test(l.text);
    const jobs = [...wf.jobs.values()].filter((j) => j.logical.some(isSubmit));
    if (jobs.length === 0) die([`FAIL no job in ${subWorkflowRel} invokes \`submit-appstore.mjs --submit\`, so this run was driven from somewhere the gate does not reach.`]);
    for (const job of jobs) {
      if (!job.lines.some((l) => /^ {4}environment:/.test(l.text))) {
        die([`FAIL ${subWorkflowRel} job "${job.name}" runs \`--submit\` and declares no \`environment:\` — the gate IS the environment ([ADR 031]).`]);
      }
      const submitAt = job.logical.find(isSubmit);
      const signatureAt = job.logical.find((l) => l.text.includes(SIGNATURE_GUARD));
      if (!signatureAt || signatureAt.n > submitAt.n) {
        die([
          `FAIL ${subWorkflowRel} job "${job.name}" ${signatureAt ? `runs ${SIGNATURE_GUARD} at line ${signatureAt.n}, AFTER the upload at line ${submitAt.n}` : `uploads and never runs ${SIGNATURE_GUARD}`}.`,
          '     That guard reads the signature, the embedded profile and the entitlements out of the bytes being',
          '     uploaded; App Store Connect refuses a wrongly signed build after the upload, and the build number is spent.',
        ]);
      }
    }
    ok(`PG-4 lane shape — ${subWorkflowRel} gates the upload job on an environment and reads the bundles' signatures first`);
  }
  // PG-5 · the environment EXISTS and carries a REQUIRED REVIEWER (`environment:` alone fails open).
  {
    const gate = await requirePublishEnvironment({ label: 'PG-5', userAgent: 'nikatru-submit-appstore' });
    if (!gate.ok) die(gate.lines);
    for (const l of gate.lines) console.log(l);
  }
}

// ── the register is the single declaration everything below reads ────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The channel row, the bundle identifier and the metadata contract all live there. With it gone',
    'every validation below would range over undefined and pass by having nothing to check.',
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
    'This script exists to submit to exactly that row. Without it there is no artifact format, no',
    'metadata directory template and no bundle identifier to validate.',
  ]);
}
if (channel.submittable !== true) {
  die([`FAIL channel "${CHANNEL_ID}" is not marked \`submittable\` in ${REGISTER}.`, '     A store you cannot submit to has no submission path to run.']);
}

const contract = register.storeMetadataContract;
const requiredFiles = Array.isArray(contract?.requiredFiles) ? contract.requiredFiles : [];
if (requiredFiles.length === 0) {
  coverageLost([
    `${REGISTER} declares no \`storeMetadataContract.requiredFiles\`.`,
    'The metadata validation below iterates that list. Empty, it checks every file in zero seconds',
    'and reports the listing complete — exactly the shape [10]D-5 exists to remove.',
  ]);
}
const extraFiles = contract?.perChannel?.[CHANNEL_ID]?.additionalFiles ?? [];
const maxChars = contract?.perChannel?.[CHANNEL_ID]?.maxChars ?? {};
const urlFiles = new Set(contract?.urlFiles ?? []);

// ── which app ────────────────────────────────────────────────────────────────
const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — there is no app to submit.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);

// `--app` is required (submit-common appOf); there is no first-app default.
const app = appOf(apps, APPS);

// ── the app's own Apple identity and App Store record ───────────────────────
// ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b). Both are per app, and the channel
// row carries neither:
//   · the bundle id the app signs with is tooling/apple-provisioning.json's, read
//     by apple-provisioning.mjs's bundleIdOf and never derived again here;
//   · the App Store Connect record this channel submits to is the app's own
//     apps/<id>/app.yaml `stores.<channel>`, read by tooling/store/store-record.mjs.
// Until 9b the row carried ONE bundleIdentifier and the lane ONE App Store Connect
// app id (the APP_STORE_CONNECT_{IOS,MACOS}_APP_ID secrets), so this block refused
// any app but the first (O-STORE-LANES-HARD-WIRE-ONE-APP). With the record per app
// there is no first app to protect, and the refusal retired with its subject.
const appleRaw = read(APPLE_REGISTER);
if (appleRaw === null) {
  coverageLost([
    `${APPLE_REGISTER} does not exist, so the bundle id app "${app.slug}" signs with cannot be read.`,
    'It is the one declaration of that id; without it the Xcode project below has nothing to be compared to.',
  ]);
}
let appBundle;
try {
  appBundle = bundleIdOf(JSON.parse(appleRaw), app.slug);
} catch (e) {
  die([`FAIL ${e.message}.`, `     App "${app.slug}" has no Apple identity, so it has no App Store record to submit to.`]);
}
let ascRecord;
try {
  ascRecord = storeRecordOf(ROOT, app.slug, CHANNEL_ID);
} catch (e) {
  die([
    `FAIL ${e.message}.`,
    `     The App Store Connect record "${CHANNEL_ID}" submits to is app "${app.slug}"'s own; without one this run has no target.`,
  ]);
}

console.log(`── Apple App Store submission path · app "${app.slug}" · channel "${CHANNEL_ID}" ──`);
console.log(`   mode: ${DRY_RUN ? 'DRY RUN (nothing leaves this machine)' : 'SUBMIT'}`);
console.log('');

// ── 1. the metadata tree ─────────────────────────────────────────────────────
const metaDir = String(channel.storeMetadataDir ?? '').replace('{app}', app.slug);
if (metaDir === '') {
  coverageLost([`channel "${CHANNEL_ID}" declares no \`storeMetadataDir\` — there is no listing to submit.`]);
}
if (!existsSync(abs(metaDir)) || !statSync(abs(metaDir)).isDirectory()) {
  die([
    `FAIL the store metadata tree ${metaDir} does not exist.`,
    '     [10]D-5: the listing lives in the repo and the console is a copy of it. With no tree there',
    '     is nothing to submit but whatever somebody last typed into App Store Connect.',
  ]);
}

let filesChecked = 0;
for (const rel of [...requiredFiles, ...extraFiles]) {
  const p = `${metaDir}/${rel}`;
  const text = read(p);
  if (text === null) {
    problems.push(`${p} is missing. ${REGISTER}'s storeMetadataContract requires it.`);
    continue;
  }
  if (text.trim() === '') {
    problems.push(`${p} is EMPTY. An empty listing field satisfies "the file exists" and submits a blank.`);
    continue;
  }
  filesChecked++;

  if (urlFiles.has(rel)) {
    const url = text.trim();
    if (!/^https:\/\/\S+$/.test(url) || /\s/.test(url)) {
      problems.push(`${p} is not a single absolute https URL: ${JSON.stringify(url)}. App Store Connect requires a resolvable privacy policy URL, and a support URL that 404s is a review rejection.`);
    }
  }

  // 🔴 THE ONLY TWO APPLE LENGTH LIMITS WITH A PRIMARY SOURCE, and the guard
  // refuses to enforce one that arrives without its citation. Everything else on
  // an Apple listing — the keywords field, the description, promotional text —
  // is COULD-NOT-ESTABLISH and carries NO number, here or in the register.
  const chars = maxChars[rel];
  if (chars && (Number.isInteger(chars.max) || Number.isInteger(chars.min))) {
    if (typeof chars.source !== 'string' || chars.source.trim() === '') {
      problems.push(
        `${REGISTER} declares a ${CHANNEL_ID} character limit for ${rel} with NO \`source\`. An invented limit fires on CORRECT input; this path will not enforce a number nobody sourced.`,
      );
    } else {
      const n = text.trim().length;
      if (Number.isInteger(chars.max) && n > chars.max) problems.push(`${p} is ${n} characters; the limit is ${chars.max}. Source: ${chars.source}`);
      if (Number.isInteger(chars.min) && n < chars.min) problems.push(`${p} is ${n} characters; the minimum is ${chars.min}. Source: ${chars.source}`);
    }
  }
}
// A pass produced by reading nothing is the failure this repo keeps meeting.
if (filesChecked === 0) {
  coverageLost([
    `${metaDir} yielded ZERO readable metadata files out of ${requiredFiles.length + extraFiles.length} expected.`,
    'Every field check above ran over an empty set. The scan is broken or the tree was emptied;',
    'either way this is not a listing that can be submitted.',
  ]);
}
if (!problems.length) ok(`metadata tree ${metaDir} — ${filesChecked} field(s) present and non-empty`);

// ── [10]D-6 PREFLIGHT — the portfolio-safety gate, run by the RELEASE PATH ────
// 🔴 IN THE SCRIPT AND NOT ONLY IN CI, and the difference is the whole point.
// CI runs assert-submission-safety.mjs on every push in its PORTFOLIO mode; that
// compares the taglines across apps, and it says nothing about the
// app somebody is submitting RIGHT NOW. The `--submitting` mode's
// web-prove-first rule can only be asked at the moment of a submission — so it
// is asked here, by the path that would do it, rather than by a lane that ran
// hours earlier on a different question.
//
// A strike attaches to the PUBLISHER, so the cost of getting this wrong is every
// other app in the portfolio losing distribution at once (L21).
{
  // Resolved from THIS FILE, never from ROOT: `--repo-root` points the CHECKS
  // at another tree (that is how the tests drive this script), and the guard
  // itself always lives beside the release scripts. Resolving it from ROOT
  // meant a fixture root had to contain a copy of tooling/ci to be testable.
  const safety = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-submission-safety.mjs');
  const r = spawnSync(process.execPath, [safety, ROOT, '--submitting', '--app', app.slug], { encoding: 'utf8' });
  if (r.status !== 0) {
    die([
      'FAIL the [10]D-6 submission-safety preflight refused this submission:',
      `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd(),
    ]);
  }
  ok(`[10]D-6 preflight — catalog/apps.json records "${app.slug}" as status "live"; ${((r.stdout ?? '').match(/TAGLINE PAIRS COMPARED: \d+/) ?? ['TAGLINE PAIRS COMPARED: unreported'])[0]}. This preflight made no web request.`);
}

// ── 2. the bundle identifier ─────────────────────────────────────────────────
// Read from BOTH declarations and compare, for the same reason the Microsoft
// path compares the MSIX identity: two copies of an identity is how the wrong
// one ships. Unlike Partner Center's assigned values this one is OURS, already
// real, and therefore checkable today with no Apple account.
//
// ⚠️ iOS and macOS declare it in DIFFERENT FILES and the register says which.
// The macOS pbxproj carries only `com.nikatru.subscriptiontracker.RunnerTests`, so a reader
// that assumed one location would compare against the TEST bundle's id and
// agree with itself.
// ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): the VALUE is bundleIdOf's (above), and
// the FILE Xcode declares it in is the row's `identity.declaredIn` — the same (kind,
// file) pair tooling/ci/assert-store-identity.mjs grades against bundleIdOf. The row
// no longer carries a `bundleIdentifier` value of its own: a second copy of an
// identity is how the wrong one ships.
const declaredBundle = appBundle;
const declaredInTemplate = typeof channel.identity?.declaredIn === 'string' ? channel.identity.declaredIn.trim() : '';
if (declaredInTemplate === '') {
  coverageLost([
    `channel "${CHANNEL_ID}" declares no \`identity.declaredIn\`.`,
    'It names the file Xcode declares the bundle id in (the pbxproj for iOS, an xcconfig for macOS). Absent,',
    'the comparison below has no file to read and would report agreement between two unknowns.',
  ]);
}
{
  const declaredInRel = declaredInTemplate.replace('{app}', app.slug);
  const projectText = read(declaredInRel);
  if (projectText === null) {
    problems.push(`${declaredInRel} does not exist, so channel "${CHANNEL_ID}"'s bundle identifier cannot be compared to what Xcode actually builds.`);
  } else {
    // 🔴 THE READER IS SHARED with tooling/ci/assert-store-identity.mjs since
    // 2026-08-03 (tooling/ci/read-identity.mjs). It drops the TEST bundles
    // EXPLICITLY rather than by taking "the first match" — order-dependent and
    // silently wrong — and the macOS pbxproj contains nothing but RunnerTests,
    // so that distinction is the difference between checking the app and
    // checking the test target. One declaration: a second copy of an identity
    // reader fails by reporting agreement between two things it read wrongly.
    const bundleRead = readAppleBundleId(projectText, declaredInRel);
    if (bundleRead.lost) {
      coverageLost([
        bundleRead.lost,
        'Either the file layout changed or this script is reading the wrong file.',
      ]);
    }
    const appBundles = bundleRead.value === null ? [] : [bundleRead.value];
    if (bundleRead.missing) {
      problems.push(bundleRead.missing);
    } else if (appBundles[0] !== declaredBundle) {
      problems.push(
        `bundle identifier DISAGREES for app "${app.slug}" on channel "${CHANNEL_ID}": ${APPLE_REGISTER} says ${JSON.stringify(declaredBundle)}, ${declaredInRel} builds ${JSON.stringify(appBundles[0])}. App Store Connect binds a record to ONE bundle id — an upload under the other is rejected, and changing it after a release makes a different app.`,
      );
    } else {
      ok(`bundle identifier ${declaredBundle} — ${APPLE_REGISTER} and ${declaredInRel} agree`);
    }
  }
}

// ── 3. the artifact ──────────────────────────────────────────────────────────
// ⚠️ THESE PATHS ARE OURS, NOT AN APPLE CONTRACT. `flutter build ipa` writes to
// build/ios/ipa/; a Mac App Store .pkg is produced by `productbuild` from a
// signed .app, which submit-appstore.yml does not make (unsigned by choice until
// the signing seam lands there), so its location is a convention this repo chooses. Nothing here is claimed as
// sourced, and the register's artifactFormats is what decides whether the file
// is even the right KIND.
// ⏱ 2026-09-25 (O-APPLE-PROVER-SKIPS-THE-PKG): the path is the row's own
// `signing.seam.artifactGlob`, through apple-signing.mjs's appleArtifactPath —
// the glob bp's upload and PROVE are held to. The two literals that stood here
// were a third copy of it.
let artifactRel;
try {
  artifactRel = appleArtifactPath(channel, app.slug);
} catch (e) {
  coverageLost([
    `channel "${CHANNEL_ID}" gives no artifact path: ${e.message}.`,
    `${REGISTER}'s signing.seam.artifactGlob is the one path the upload, PROVE and this script read.`,
  ]);
}
const acceptedFormats = (channel.artifactFormats ?? []).filter((f) => typeof f === 'string');
if (!acceptedFormats.some((f) => artifactRel.endsWith(f))) {
  problems.push(
    `the configured output ${artifactRel} matches none of the formats channel "${CHANNEL_ID}" accepts (${acceptedFormats.join(', ')}). The packaging convention and the register disagree about what this channel takes.`,
  );
}

if (existsSync(abs(artifactRel))) {
  const bytes = statSync(abs(artifactRel)).size;
  if (bytes === 0) {
    problems.push(`${artifactRel} exists and is ZERO bytes. A truncated upload is rejected after the wait, which costs a review slot.`);
  } else {
    ok(`artifact ${artifactRel} — ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
} else if (ALLOW_MISSING_ARTIFACT) {
  prints.push(
    `NO SIGNED ARTIFACT — ${artifactRel} is not on disk and --allow-missing-artifact was passed, so the listing and the bundle identifier were validated and the package was not. ` +
      'The submit-appstore.yml lane never passes this flag: it signs and packages first. Off that lane there may be no signed package to read.',
  );
} else {
  problems.push(
    `${artifactRel} does not exist. .github/workflows/submit-appstore.yml signs and packages it immediately before running this dry run (since 2026-10-01, review AA-18), so a run reaching here from that lane means the signed build or the productbuild produced nothing while exiting 0. Pass --allow-missing-artifact only off that lane, to validate the listing and identity alone (and say so in the output, which is what that flag does).`,
  );
}

// ── 4. credentials — presence only, never values ─────────────────────────────
// The App Store Connect API authenticates with a `.p8` private key plus the two
// ids that identify it. These NAMES are OURS — the secret names this repo would
// use — not an API contract, so nothing here is claimed as sourced.
//
// 🔴 THE KEY IS NEVER READ, PARSED OR PRINTED BY A DRY RUN, only tested for
// presence: a dry run has no reason to touch private key material. ⏱ 2026-10-03:
// --submit reads it ONCE, at the upload, to sign its tokens, and never prints it;
// for --submit an absent credential is a FAILURE, not a printed gap.
const CREDENTIAL_ENV = [
  ['APP_STORE_CONNECT_ISSUER_ID', 'the App Store Connect API issuer id (per-team, from Users and Access -> Integrations)'],
  ['APP_STORE_CONNECT_KEY_ID', 'the id of the .p8 API key'],
  ['APP_STORE_CONNECT_PRIVATE_KEY', 'the .p8 private key contents — read only by --submit, to sign its tokens; never printed'],
];
const missingCreds = CREDENTIAL_ENV.filter(([k]) => !process.env[k] || process.env[k].trim() === '');
if (SUBMIT && missingCreds.length > 0) {
  problems.push(
    `--submit needs every App Store Connect credential, and ${missingCreds.length} of ${CREDENTIAL_ENV.length} are absent: ${missingCreds.map(([k]) => k).join(', ')}. The submit job reads them from repository secrets by name.`,
  );
} else if (missingCreds.length === 0) {
  ok(`credentials — all ${CREDENTIAL_ENV.length} environment variable(s) present (values never read or printed)`);
} else {
  prints.push(
    `CREDENTIALS NOT CONFIGURED — ${missingCreds.length} of ${CREDENTIAL_ENV.length} absent: ${missingCreds.map(([k]) => k).join(', ')}. The ASC API key among them DOES exist as a repository secret; the certificate ones have never been issued, so this is a printed gap and not a failure. (${missingCreds.map(([k, why]) => `${k} = ${why}`).join(' · ')})`,
  );
}

// ── 4b. the App Store Connect record — the app's own, never a secret ─────────
// ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): it was APP_STORE_CONNECT_APP_ID,
// fed from one repository secret per channel — one app's record for every app.
// A pending record is the owner's step (create the record), printed like the
// other owner-gated gaps; an issued one with a hole is a finding.
if (ascRecord.state === 'issued') {
  const holes = missingIdsOf(CHANNEL_ID, ascRecord);
  if (holes.length > 0) {
    problems.push(`${ascRecord.rel} stores.${CHANNEL_ID} is state: issued and lacks ${holes.join(', ')}. An issued record names the App Store Connect record it is.`);
  } else {
    ok(`App Store Connect record ${ascRecord.recordId} — ${ascRecord.rel} stores.${CHANNEL_ID} (issued; the app's own record, not a secret)`);
  }
} else if (SUBMIT) {
  problems.push(`${ascRecord.rel} stores.${CHANNEL_ID} is state: pending — there is no App Store Connect record to upload a build to.`);
} else {
  prints.push(
    `APP STORE RECORD PENDING — ${ascRecord.rel} stores.${CHANNEL_ID} is state: pending, so app "${app.slug}" has no App Store Connect record yet. ` +
      'Creating it is an owner step; its Apple ID is then written into the record as recordId, state: issued.',
  );
}

// ── 5. the floors that are sourced, and are not met ──────────────────────────
// Printed on every run rather than failing, because pinning Xcode is real work
// that nobody can validate without an Apple runner — and a gap nobody sees
// becomes permanent ([pipeline C-6]).
//
// 🔴 THIS TEST IS `hasOwnProperty`, AND FROM 2026-08-08 TO 2026-08-20 THAT WAS
// THE ONLY THING IN THE REPOSITORY STANDING BETWEEN A BUILD AND A STORE POLICY
// ALREADY IN FORCE — the warning landed 2026-08-01 (e90b110) and the `xcode` key
// that silenced it landed 2026-08-08 (fb9fe26), both measured with `git log -S`.
// The key's PRESENCE silenced the warning; nothing compared the pin to
// the machine, so writing `xcode: "26"` down removed the sentence describing
// the hazard and left the hazard untouched. A declaration read as an
// enforcement is this corpus's cardinal defect wearing its most convincing
// costume, because the declaration is TRUE — it is just not a check.
//
// Since 2026-08-20 the enforcement exists: tooling/ci/assert-xcode-floor.mjs
// runs in build-platforms.yml's `apple` job and compares `xcodebuild -version`
// against this key, refusing COVERAGE LOST when it cannot ask. So the test
// below is now what it always read like — "is there a floor for that guard to
// enforce?" — rather than the floor itself.
const versionsRaw = read('tooling/versions.json');
let xcodePinned = false;
if (versionsRaw !== null) {
  try {
    xcodePinned = Object.prototype.hasOwnProperty.call(JSON.parse(versionsRaw), 'xcode');
  } catch {
    xcodePinned = false;
  }
}
if (!xcodePinned) {
  prints.push(
    'XCODE FLOOR NOT PINNED — developer.apple.com/news/upcoming-requirements/ (fetched 2026-07-29): apps uploaded to App Store Connect "must be built with Xcode 26 or later", in force since 28 April 2026. ' +
      'tooling/versions.json has no `xcode` key, so tooling/ci/assert-xcode-floor.mjs has no floor to compare the runner against and exits COVERAGE LOST. ' +
      'Also sourced and relevant: the macos-26 runner is arm64-only.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (no signing credentials are configured; A-4 closed 2026-08-31) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nsubmit-appstore: FAILED');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('');
  console.log('submit-appstore: DRY RUN OK — nothing was sent to Apple.');
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'Private/runbooks/store-submission-apple.md'}`);
  process.exit(0);
}

// ── 6. --submit: the upload, for TestFlight processing — and nothing after it ──
// Every gate above passed and every check the dry run makes found nothing, so the
// bytes on disk are the ones the dry-run job built, hashed and handed on (the
// workflow's sha256 step) and whose signature this job read (PG-4).
{
  const api = ascApiBase();
  if (api.error) die([`FAIL ${api.error}`]);
  if (api.loopback) console.log(`⬜   APP_STORE_CONNECT_API_BASE_URL override in effect: ${api.base} — a LOOPBACK TEST SEAM, not App Store Connect.`);
  // A secret pasted with literal "\n" sequences is normalised; the value is never printed.
  const rawKey = process.env.APP_STORE_CONNECT_PRIVATE_KEY;
  const privateKey = rawKey.includes('\n') ? rawKey : rawKey.replace(/\\n/g, '\n');
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID.trim();
  const keyId = process.env.APP_STORE_CONNECT_KEY_ID.trim();
  const token = () => ascJwt({ issuerId, keyId, privateKey });
  try {
    token();
  } catch (e) {
    die([`FAIL APP_STORE_CONNECT_PRIVATE_KEY did not sign an ES256 token (${e.code ?? e.name}). Nothing was sent; the key's value is not printed.`]);
  }
  // The test seam may shorten the read-back; App Store Connect itself always gets the real cadence.
  const knob = (name, fallback) => (api.loopback && /^\d+$/.test(process.env[name] ?? '') ? Number(process.env[name]) : fallback);
  const ios = CHANNEL_ID === 'ios-appstore';
  console.log('');
  console.log(`→    uploading ${artifactRel} to App Store Connect record ${ascRecord.recordId} for TestFlight processing (never for review)`);
  const result = await uploadBuild({
    api,
    token,
    appRecordId: ascRecord.recordId,
    platform: ios ? 'IOS' : 'MAC_OS',
    shortVersion: SHORT_VERSION,
    bundleVersion: BUNDLE_VERSION,
    bytes: readFileSync(abs(artifactRel)),
    fileName: basename(artifactRel),
    uti: ios ? 'com.apple.ipa' : 'com.apple.pkg',
    pollMs: knob('SUBMIT_APPSTORE_POLL_MS', 20000),
    ceilingMs: knob('SUBMIT_APPSTORE_CEILING_MS', 20 * 60 * 1000),
  });
  for (const l of result.lines) (l.startsWith('FAIL') ? console.error : console.log)(l);
  if (!result.ok) {
    console.error('\nsubmit-appstore: FAILED — App Store Connect did not accept the build. Nothing was submitted for review.');
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log(`submit-appstore: UPLOADED — ${CHANNEL_ID} ${SHORT_VERSION} (${BUNDLE_VERSION}), build upload ${result.uploadId}, state ${result.state}.`);
  console.log('   NOTHING WAS SUBMITTED FOR REVIEW. Attaching this build to a version and submitting it is the owner\'s');
  console.log(`   console act: ${channel.submission?.runbook ?? 'Private/runbooks/store-submission-apple.md'}`);
}
}
