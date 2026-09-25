#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-edge.mjs — the Microsoft Edge Add-ons submission lane: four calls,
// two of them polled to a terminal state, v1.1 headers.
//
// ── THE FOUR CALLS, ALL FROM ONE PRIMARY SOURCE (fetched 2026-09-07) ─────────
//   1. POST /v1/products/{productID}/submissions/draft/package
//      Authorization: ApiKey <key> · X-ClientID: <clientId> · Content-Type: application/zip
//      → 202 Accepted with a Location header carrying the operationID
//   2. GET  /v1/products/{productID}/submissions/draft/package/operations/{operationID}
//      → the upload status, RE-READ until `Succeeded` or `Failed`
//   3. POST /v1/products/{productID}/submissions          (body: notes JSON)
//      → 202 Accepted with a Location header carrying the operationID
//      — sent ONLY after call 2 read `Succeeded`
//   4. GET  /v1/products/{productID}/submissions/operations/{operationID}
//      → the publish status, RE-READ until `Succeeded` or `Failed`
// Endpoint root: https://api.addons.microsoftedge.microsoft.com (EDGE_API_BASE_URL
// may point it at loopback for the stub tests, and at nothing else).
//
// 🔴 EVERY STATUS READ ANSWERS 200, SO THE STATUS FIELD DECIDES (EXT-6,
// 2026-09-25). Until then call 2 was read once for `ok`, and an upload Edge had
// marked `Failed` was published anyway; call 4 likewise. Both are now polled
// through store-poll.mjs, and a run that stops looking before a terminal state
// says NOT CONFIRMED, never SUBMITTED. The POSTs are never re-sent.
//
// ⚠️ THE VERSION WORD IS AMBIGUOUS ON THE PAGE AND THAT AMBIGUITY IS REAL. The
// documentation calls the AUTH SCHEME v1.1 ("v1.1 uses an API key… The REST
// endpoints use specific request headers for v1.1") while every PATH is still
// `/v1/…`. So "Edge Add-ons API v1.1" means the ApiKey + X-ClientID headers, and
// the URL segment stays `v1`. Both halves are copied from the page rather than
// harmonised, because harmonising them would have invented a `/v1.1/` route that
// returns 404 against a live account.
//
// ⚠️ NEVER `process.exit()` AFTER A `fetch` ON WINDOWS (TRAPS shell-12). Every
// path below sets `process.exitCode`.
//
// ⏱ CORRECTED 2026-09-07 — the product id was the repository-global secret
// EDGE_PRODUCT_ID; it is now extensions/Extension/<tool>/tool.json
// storeMetadata.stores.edge.listingId, and the lane REFUSES while it is null.
//
// Usage:
//   node scripts/publish-edge.mjs --tool <id> --zip <path> [--notes <text>]
// ─────────────────────────────────────────────────────────────────────────────

import { laneVerdict, ArmingCoverageLost, readSubmittablePackage } from './publish-arming.mjs';
import { requireStorePublishEnvironment } from './lib/store-environment.mjs';
import { pollToTerminal, readStatus, classifyEdgeOperation, loopbackBase, overrideLine, pollTiming, NOT_CONFIRMED } from './store-poll.mjs';
import { CouldNotLook } from '../../tooling/ops/bounded-retry.mjs';

const PRIMARY_SOURCES = Object.freeze({
  api: 'https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api',
});

const API_ROOT = 'https://api.addons.microsoftedge.microsoft.com';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const TOOL = opt('tool');
const ZIP = opt('zip');
const NOTES = opt('notes', 'Automated submission from the extensions release lane.');

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\npublish-edge: FAILED');
  process.exitCode = 1;
}

const authHeaders = () => ({
  authorization: `ApiKey ${process.env.EDGE_API_KEY}`,
  'x-clientid': String(process.env.EDGE_CLIENT_ID ?? ''),
});

/** The operationID the page says arrives in the `Location` header of a 202. It is
 *  read from the header and never guessed from the body: the page documents the
 *  header and documents no body for these two calls. */
function operationIdFrom(response) {
  const loc = response.headers.get('location');
  if (loc === null || loc.trim() === '') return null;
  return loc.trim().split('/').pop();
}

/**
 * Re-read one Edge operation until it is `Succeeded` or `Failed`. Returns true
 * only on `Succeeded`; every other end has already printed its FAIL.
 * `afterFail` says what the store holds when this operation did not succeed.
 */
async function pollOperation(what, url, timing, afterFail) {
  let r;
  try {
    r = await pollToTerminal({
      read: () => readStatus(url, authHeaders(), `the Edge ${what} status read`),
      classify: classifyEdgeOperation,
      ...timing,
    });
  } catch (e) {
    if (!(e instanceof CouldNotLook)) throw e;
    die([`FAIL could not look at the ${what} status: ${e.message}`, `     ${NOT_CONFIRMED}`]);
    return false;
  }
  if (r.state === 'succeeded') {
    console.log(`ok   ${what} Succeeded — read ${r.reads} time(s)`);
    return true;
  }
  if (r.state === 'timed-out') {
    die([`FAIL the ${what} operation is ${r.detail}.`, `     ${NOT_CONFIRMED}`]);
    return false;
  }
  die([`FAIL the Edge ${what} operation ended ${r.detail}`, `     ${afterFail}`, `     Source: ${PRIMARY_SOURCES.api}`]);
  return false;
}

async function main() {
  if (TOOL === null || TOOL.trim() === '') {
    die(['FAIL --tool <id> is required.']);
    return;
  }
  // The seam and the poll timing are settled before anything is read: a refused
  // override stops the run before any request, to any host.
  const seam = loopbackBase('EDGE_API_BASE_URL', API_ROOT);
  if (seam.error !== undefined) {
    die([`FAIL ${seam.error}`]);
    return;
  }
  if (seam.override) console.log(overrideLine('EDGE_API_BASE_URL', seam.base));
  const timing = pollTiming(process.env, seam.override);
  if (timing.error !== undefined) {
    die([`FAIL ${timing.error}`]);
    return;
  }
  let result = null;
  try {
    result = laneVerdict('edge-addons', { toolId: TOOL, ...(opt('repo-root') === null ? {} : { root: opt('repo-root') }) });
  } catch (e) {
    if (e instanceof ArmingCoverageLost) {
      die(e.lines);
      return;
    }
    throw e;
  }
  for (const l of result.lines) console.log(l);
  if (result.verdict === 'refuse') {
    process.exitCode = 1;
    return;
  }
  if (result.verdict !== 'go') return;

  let packageBytes;
  try {
    packageBytes = readSubmittablePackage(ZIP);
  } catch (err) {
    die([`FAIL ${err.message}`]);
    return;
  }

  // [ADR 031] class A — the store-publish environment is read back immediately
  // before the first store call. lib/store-environment.mjs; EXT-3, 2026-09-24.
  const gate = await requireStorePublishEnvironment();
  for (const l of gate.lines) (gate.ok ? console.log : console.error)(l);
  if (!gate.ok) {
    die(['     NOT SUBMITTED: the store-publish environment was not shown to gate this run.']);
    return;
  }
  // 🔴 THE PRODUCT ID COMES OFF THE TOOL, NOT OUT OF THE ENVIRONMENT. Same
  // correction as publish-cws.mjs and the same measured fail-open: one Partner
  // Center account publishes every tool, so a repository-global EDGE_PRODUCT_ID
  // made every tool's release address the FIRST tool's product. `laneVerdict`
  // has already refused every path where this is null.
  const product = encodeURIComponent(result.identity.listingId);
  const draftPackage = `${seam.base}/v1/products/${product}/submissions/draft/package`;
  const submissions = `${seam.base}/v1/products/${product}/submissions`;

  // 1. upload the package
  const up = await fetch(draftPackage, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/zip' },
    body: packageBytes,
  });
  if (up.status !== 202) {
    die([
      `FAIL the package upload returned HTTP ${up.status} and the documented success is 202 Accepted.`,
      `     ${(await up.text()).slice(0, 500)}`,
      `     Source: ${PRIMARY_SOURCES.api}`,
    ]);
    return;
  }
  const uploadOp = operationIdFrom(up);
  if (uploadOp === null) {
    die([
      'FAIL the upload returned 202 with no `Location` header, so there is no operationID to poll.',
      `     ${PRIMARY_SOURCES.api} documents that header as where the operationID arrives; without it this`,
      '     run cannot tell an accepted upload from a rejected one, and reporting success would be a guess.',
    ]);
    return;
  }
  console.log(`ok   package accepted — upload operation ${uploadOp}`);

  // 2. poll the upload until Edge names a terminal state; publish nothing on any other end
  const uploaded = await pollOperation(
    'upload',
    `${draftPackage}/operations/${encodeURIComponent(uploadOp)}`,
    timing,
    'Nothing was published: the publish call is sent only after the upload reads Succeeded.',
  );
  if (!uploaded) return;

  // 3. publish the draft
  const pub = await fetch(submissions, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ notes: NOTES }),
  });
  if (pub.status !== 202) {
    die([
      `FAIL the publish call returned HTTP ${pub.status} and the documented success is 202 Accepted.`,
      `     ${(await pub.text()).slice(0, 500)}`,
      '     The package IS uploaded into the draft; only the publish failed.',
    ]);
    return;
  }
  const publishOp = operationIdFrom(pub);
  if (publishOp === null) {
    die(['FAIL the publish returned 202 with no `Location` header, so there is no operationID to poll.']);
    return;
  }
  console.log(`ok   publish accepted — publish operation ${publishOp}`);

  // 4. poll the publish until Edge names a terminal state
  const published = await pollOperation(
    'publish',
    `${submissions}/operations/${encodeURIComponent(publishOp)}`,
    timing,
    'The package IS uploaded into the draft; only the publish failed.',
  );
  if (!published) return;
  // The listing the [10]D-9 record names: the tool's `listings.edge`.
  if (result.identity.listingUrl !== null) console.log(`LISTING_URL=${result.identity.listingUrl}`);
  console.log(`publish-edge: SUBMITTED — ${TOOL} uploaded and submitted for certification on Microsoft Edge Add-ons.`);
}

await main();
