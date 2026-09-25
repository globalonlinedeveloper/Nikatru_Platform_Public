#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-cws.mjs — the Chrome Web Store submission lane: refresh the token,
// upload the package, publish the item.
//
// 🔴 THE SHAPE THIS FILE IMPLEMENTS IS v2 AND THE BRIEF SAID v1.1. Read the
// source before reading that as a deviation: developer.chrome.com's own "Use the
// Chrome Web Store API" page, FETCHED 2026-09-07, documents ONLY
// `https://chromewebstore.googleapis.com/v2/publishers/{PUBLISHER_ID}/items/{EXTENSION_ID}`
// with the verbs `:upload`, `:publish`, `:fetchStatus`, `:cancelSubmission` and
// `:setPublishedDeployPercentage`. The string "1.1" does not appear on it. The
// older `.../upload/chromewebstore/v1.1/items/{id}` path is the shape this
// factory's own research recorded on 2026-09-05 and is NOT what the primary
// source says today, so the v2 path is what is written.
//
// ⚠️ THAT CHANGE COSTS ONE MORE VALUE, AND IT IS NAMED RATHER THAN GUESSED. The
// v2 path carries a PUBLISHER_ID segment the v1.1 path did not have. It is read
// from the Developer Dashboard (Publisher → Settings) per the same page, so it
// is a real value with a real home and no way to derive it — hence
// `CWS_PUBLISHER_ID`, declared beside the other three rather than substituted
// with something plausible. A guessed publisher id does not fail here; it fails
// against a live account, on somebody else's item id.
//
// ── THE TWO CALLS ────────────────────────────────────────────────────────────
//   POST https://chromewebstore.googleapis.com/upload/v2/publishers/{P}/items/{I}:upload
//        Authorization: Bearer <token>; body = the zip bytes.
//   POST https://chromewebstore.googleapis.com/v2/publishers/{P}/items/{I}:publish
//        Authorization: Bearer <token>.
// preceded by the token mint:
//   POST https://oauth2.googleapis.com/token
//        grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer, assertion=<RS256 JWT>
//
// ⏱ CONVERTED 2026-09-09 — THE AUTH IS A SERVICE ACCOUNT, NOT A REFRESH TOKEN.
// CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN are retired. Google
// documents service accounts for this API at
// https://developer.chrome.com/docs/webstore/service-accounts (fetched
// 2026-09-09) — the account email is added in the Developer Dashboard under
// Account, and "you can only add one service account to your publisher". The
// single secret is CWS_SERVICE_ACCOUNT_JSON, the same shape the Play lane's
// PLAY_SERVICE_ACCOUNT_JSON already uses. See publish-cws-token.mjs.
//
// ⚠️ `upload` UPDATES AN EXISTING ITEM AND CANNOT CREATE ONE — the page says so
// ("Upload a package to update an existing store item") and adds that the upload
// FAILS if the manifest version was not increased. Chrome is therefore one of the
// stores [ADR 067] decision 8 covers: the first publish is a human in a console.
//
// ⚠️ NEVER `process.exit()` AFTER A `fetch` ON WINDOWS. While undici still holds
// the socket, node dies inside libuv and leaves with 3221226505 rather than the
// code the script chose (TRAPS shell-12). Every path below sets `process.exitCode`.
//
// ⏱ CORRECTED 2026-09-07 — `--tool` USED TO BE A LOG LINE. The item id was read
// from the repository-global secret CWS_ITEM_ID while the release lane is
// multi-tool by construction, so a second extension's tag would have uploaded to
// the FIRST tool's listing and reported success naming the second. The id now
// comes from extensions/Extension/<tool>/tool.json storeMetadata.stores.chrome.listingId
// and the lane REFUSES while it is null. CWS_ITEM_ID is no longer a secret this
// repository declares.
//
// Usage:
//   node scripts/publish-cws.mjs --tool <id> --zip <path>
// ─────────────────────────────────────────────────────────────────────────────

import { laneVerdict, ArmingCoverageLost, readSubmittablePackage } from './publish-arming.mjs';
import { mintAccessToken, CWS_SA_ENV, CWS_SA_DOC } from './publish-cws-token.mjs';
import { requireStorePublishEnvironment } from './lib/store-environment.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY SOURCES — fetched 2026-09-07.
// ─────────────────────────────────────────────────────────────────────────────
const PRIMARY_SOURCES = Object.freeze({
  api: 'https://developer.chrome.com/docs/webstore/using-api',
  serviceAccounts: CWS_SA_DOC,
});

const UPLOAD_ROOT = 'https://chromewebstore.googleapis.com/upload/v2/publishers';
const ITEM_ROOT = 'https://chromewebstore.googleapis.com/v2/publishers';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const TOOL = opt('tool');
const ZIP = opt('zip');

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\npublish-cws: FAILED');
  process.exitCode = 1;
}

async function main() {
  if (TOOL === null || TOOL.trim() === '') {
    die(['FAIL --tool <id> is required.']);
    return;
  }
  let result = null;
  try {
    result = laneVerdict('chrome-webstore', { toolId: TOOL, ...(opt('repo-root') === null ? {} : { root: opt('repo-root') }) });
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

  // [ADR 031] class A — the store-publish environment is read back immediately
  // before the first store call (the token mint is the first request this lane
  // makes on the store's behalf). lib/store-environment.mjs; EXT-3, 2026-09-24.
  const gate = await requireStorePublishEnvironment();
  for (const l of gate.lines) (gate.ok ? console.log : console.error)(l);
  if (!gate.ok) {
    die(['     NOT SUBMITTED: the store-publish environment was not shown to gate this run.']);
    return;
  }

  const tok = await mintAccessToken({ serviceAccountJson: process.env[CWS_SA_ENV] });
  if (!tok.ok) {
    die([
      `FAIL the Chrome Web Store token mint failed (HTTP ${tok.status}): ${tok.detail}`,
      `     Source: ${PRIMARY_SOURCES.serviceAccounts}. The credential is a SERVICE ACCOUNT key in`,
      `     ${CWS_SA_ENV}, not the retired refresh-token trio; a mint failure means the key was`,
      '     disabled, deleted or rotated, which the scheduled cws-token-keepalive job exists to catch first.',
    ]);
    return;
  }
  console.log(`ok   access token obtained as ${tok.clientEmail} (expires_in ${tok.expiresIn}s, scope ${tok.scope})`);

  const publisher = encodeURIComponent(process.env.CWS_PUBLISHER_ID);
  // 🔴 THE ITEM ID COMES OFF THE TOOL, NOT OUT OF THE ENVIRONMENT. `laneVerdict`
  // above already refused every path where `result.identity.listingId` is null,
  // so reaching this line means the tool declares its own destination. Reading
  // it from a repository secret is what let `--tool` be a decoration: the id was
  // the same for every tool in the repository, so a second extension's tag would
  // have uploaded here and printed SUBMITTED naming itself.
  const item = encodeURIComponent(result.identity.listingId);
  let bytes;
  try {
    bytes = readSubmittablePackage(ZIP);
  } catch (e) {
    die([`FAIL ${e.message}`]);
    return;
  }

  const up = await fetch(`${UPLOAD_ROOT}/${publisher}/items/${item}:upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok.accessToken}`, 'content-type': 'application/zip' },
    body: bytes,
  });
  const upText = await up.text();
  if (!up.ok) {
    die([
      `FAIL upload returned HTTP ${up.status}: ${upText.slice(0, 500)}`,
      `     ${PRIMARY_SOURCES.api}: upload UPDATES an existing item and fails if the manifest version was`,
      '     not increased. It cannot create a first listing — that is ADR 067 decision 8\'s manual step.',
    ]);
    return;
  }
  console.log(`ok   uploaded ${ZIP} — ${upText.slice(0, 300)}`);

  const pub = await fetch(`${ITEM_ROOT}/${publisher}/items/${item}:publish`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok.accessToken}` },
  });
  const pubText = await pub.text();
  if (!pub.ok) {
    die([
      `FAIL publish returned HTTP ${pub.status}: ${pubText.slice(0, 500)}`,
      '     The package IS uploaded; only the publish call failed. Re-running this step is safe — it',
      '     publishes the draft that is already there — but do not re-upload the same version.',
    ]);
    return;
  }
  console.log(`ok   published — ${pubText.slice(0, 300)}`);
  // The listing the [10]D-9 record names: the tool's `listings.chrome`.
  if (result.identity.listingUrl !== null) console.log(`LISTING_URL=${result.identity.listingUrl}`);
  console.log(`publish-cws: SUBMITTED — ${TOOL} uploaded and submitted for review on the Chrome Web Store.`);
}

await main();
