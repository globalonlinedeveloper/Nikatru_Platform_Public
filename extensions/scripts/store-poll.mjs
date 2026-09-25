// ─────────────────────────────────────────────────────────────────────────────
// store-poll.mjs — the three things every extension store call shares:
//   1. the poll-to-terminal loop and the terminal vocabularies of each store;
//   2. the loopback test seam for each store origin;
//   3. the keepalive presence gate.
// publish-edge.mjs, publish-cws.mjs, publish-cws-keepalive.mjs and
// store-key-keepalive.mjs import it, so none of the three is written twice.
// ADR 064; EXT-6, 2026-09-25.
//
// 🔴 A 200 IS NOT A SUCCESS ON EITHER STORE. Both APIs are asynchronous: the
// upload and the publish answer at once and the work happens afterwards. Edge
// answers HTTP 200 for an operation that is still running AND for one that has
// FAILED; the Chrome publish answers 200 with an item state that may be
// REJECTED. Until 2026-09-25 publish-edge.mjs read `!upStatus.ok` once and
// published, and publish-cws.mjs read `!pub.ok` — so a package the store refused
// printed SUBMITTED (row O-EXTENSION-PUBLISH-TRUSTS-HTTP-STATUS). Every answer is
// now CLASSIFIED against the store's own documented vocabulary, and anything the
// vocabulary does not name — an unknown value, a missing field, a non-200 on a
// status read — is FAILED. The poll fails closed.
//
// ⚠️ NOT A `publish-*` NAME, DELIBERATELY. tooling/ci/assert-publish-steps-guarded.mjs
// grades any `publish-*.mjs` a workflow runs as a store-publishing surface; this
// module publishes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { publishVerdict, LANES, REPO_ROOT } from './publish-arming.mjs';
import { CWS_SA_ENV } from './publish-cws-token.mjs';
import { fetchWithBoundedRetry } from '../../tooling/ops/bounded-retry.mjs';

/** How often a store's operation is re-read, and for how long in total. The
 *  worst case per dispatch is Edge's two polls, 2 × 600 s, inside the
 *  store-publish job's own `timeout-minutes`. */
export const STORE_POLL_INTERVAL_MS = 10_000;
export const STORE_POLL_CEILING_MS = 600_000;

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-read an asynchronous store operation until the store names a terminal
 * state, or until the ceiling.
 *
 * `read()` performs ONE status read and resolves to `{ httpStatus, body }` (body
 * the parsed JSON, or null). `classify(body, httpStatus)` answers
 * `{ state: 'succeeded' | 'failed' | 'in-progress', detail }`. A `read` that
 * throws (CouldNotLook, after the bounded retry) propagates to the caller, which
 * says "could not look" — never a pass.
 *
 * @returns {Promise<{state:'succeeded'|'failed'|'timed-out', detail:string, reads:number}>}
 */
export async function pollToTerminal({ read, classify, intervalMs = STORE_POLL_INTERVAL_MS, ceilingMs = STORE_POLL_CEILING_MS, sleep = nap, now = Date.now }) {
  const started = now();
  let reads = 0;
  for (;;) {
    const r = await read();
    reads += 1;
    const c = classify(r?.body ?? null, r?.httpStatus ?? 0);
    if (c.state === 'succeeded' || c.state === 'failed') return { state: c.state, detail: c.detail, reads };
    if (now() - started + intervalMs > ceilingMs) {
      return { state: 'timed-out', detail: `still ${c.detail} after ${reads} read(s) over ${Math.round((now() - started) / 1000)}s`, reads };
    }
    await sleep(intervalMs);
  }
}

/**
 * ONE status read, for `pollToTerminal`'s `read`: a GET under the ops lane's
 * bounded retry (tooling/ops/bounded-retry.mjs), which retries a dropped wire and
 * a 429/5xx and arms the per-request ceiling, and throws CouldNotLook when the
 * failure outlives it. Only GETs come through here; a POST is never re-sent,
 * because a re-sent upload is a second upload.
 *
 * @returns {Promise<{httpStatus:number, body:any}>}
 */
export async function readStatus(url, headers, what, fetchImpl = fetch) {
  const res = await fetchWithBoundedRetry(({ signal }) => fetchImpl(url, { headers, signal }), {
    describe: (s) => `${what}: ${s}`,
  });
  return { httpStatus: res.status, body: parseBody(await res.text()) };
}

/** A store answer's body for a classifier: the JSON, null for an empty body, and
 *  for anything else an object no vocabulary names — so it classifies FAILED. */
export function parseBody(text) {
  try {
    return text.trim() === '' ? null : JSON.parse(text);
  } catch {
    return { unparsed: text.slice(0, 300) };
  }
}

/** The line a timed-out poll ends on. The store may finish after this run stops
 *  looking, so the one wrong next step is a second upload of the same version. */
export const NOT_CONFIRMED = 'NOT CONFIRMED — the store may still be processing; do not re-upload the same version.';

const shown = (body) => JSON.stringify(body ?? null).slice(0, 300);

/**
 * Microsoft Edge Add-ons, both operation reads (upload and publish).
 * Source: learn.microsoft.com "addons-api-reference" (page dated 2026-09-02,
 * read 2026-09-23 for the EXT-6 design; not re-read by this change): `status`
 * is `InProgress`, `Succeeded` or `Failed`, and the answer is HTTP 200 in every
 * one of the three. The
 * "unexpected failure" body carries no `status` at all; 401 is a missing,
 * expired or invalid key and 404 an id that is invalid or not the caller's.
 */
export function classifyEdgeOperation(body, httpStatus = 200) {
  if (httpStatus !== 200) return { state: 'failed', detail: `HTTP ${httpStatus} (the documented status read answers 200) — ${shown(body)}` };
  const status = body?.status;
  if (status === 'Succeeded') return { state: 'succeeded', detail: 'Succeeded' };
  if (status === 'InProgress') return { state: 'in-progress', detail: 'InProgress' };
  if (status === 'Failed') return { state: 'failed', detail: `Failed — ${shown(body)}` };
  return { state: 'failed', detail: `no documented status (${JSON.stringify(status ?? null)}) — ${shown(body)}` };
}

/**
 * Chrome Web Store v2 UploadState, read off the `:upload` answer (`uploadState`)
 * or the `:fetchStatus` answer (`lastAsyncUploadState`).
 * Source: the developer.chrome.com v2 API reference (read 2026-09-23 for the
 * EXT-6 design; not re-read by this change): the enum is SUCCEEDED,
 * IN_PROGRESS, FAILED, NOT_FOUND, UPLOAD_STATE_UNSPECIFIED. The upload page's PROSE spells the running state UPLOAD_IN_PROGRESS, so both
 * spellings read as in-progress; the reference enum is the one listed first.
 */
export function classifyCwsUpload(body, httpStatus = 200) {
  if (httpStatus !== 200) return { state: 'failed', detail: `HTTP ${httpStatus} — ${shown(body)}` };
  const state = body !== null && typeof body === 'object' && 'uploadState' in body ? body.uploadState : body?.lastAsyncUploadState;
  if (state === 'SUCCEEDED') return { state: 'succeeded', detail: 'SUCCEEDED' };
  if (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') return { state: 'in-progress', detail: state };
  if (state === 'FAILED' || state === 'NOT_FOUND' || state === 'UPLOAD_STATE_UNSPECIFIED') return { state: 'failed', detail: `${state} — ${shown(body)}` };
  return { state: 'failed', detail: `no documented upload state (${JSON.stringify(state ?? null)}) — ${shown(body)}` };
}

/**
 * Chrome Web Store v2 ItemState, read off the `:publish` answer (`state`).
 * The enum is PENDING_REVIEW, STAGED, PUBLISHED, PUBLISHED_TO_TESTERS, REJECTED,
 * CANCELLED, ITEM_STATE_UNSPECIFIED. The first four mean the store took the
 * submission; the last three mean it did not.
 */
export function classifyCwsSubmission(body, httpStatus = 200) {
  if (httpStatus !== 200) return { state: 'failed', detail: `HTTP ${httpStatus} — ${shown(body)}` };
  const state = body?.state;
  if (state === 'PENDING_REVIEW' || state === 'STAGED' || state === 'PUBLISHED' || state === 'PUBLISHED_TO_TESTERS') return { state: 'succeeded', detail: state };
  if (state === 'REJECTED' || state === 'CANCELLED' || state === 'ITEM_STATE_UNSPECIFIED') return { state: 'failed', detail: `${state} — ${shown(body)}` };
  return { state: 'failed', detail: `no documented item state (${JSON.stringify(state ?? null)}) — ${shown(body)}` };
}

/**
 * A store origin, or a test seam that can only ever point at this machine.
 *
 * 🔴 LOOPBACK OR THE REAL ORIGIN, NOTHING ELSE. These processes hold a store API
 * key, a service-account bearer token and the release package; an unconstrained
 * base URL is a one-environment-variable path for sending all three to any host.
 * The rule and the return shape are those of `githubApiBase`
 * (tooling/ci/record-deployment.mjs) and `loopbackOr`
 * (tooling/release/submit-play.mjs); the three are one rule written three times,
 * recorded as a follow-up rather than consolidated here because
 * record-deployment.mjs is a deploy-web path.
 *
 * @returns {{base:string, override:boolean} | {error:string}}
 */
export function loopbackBase(envName, canonical, env = process.env) {
  const raw = String(env[envName] ?? '').trim().replace(/\/+$/, '');
  if (raw === '' || raw === canonical) return { base: canonical, override: false };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: `${envName} is set and is not a URL: ${JSON.stringify(raw)}.` };
  }
  const loopback = u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!loopback) {
    return {
      error:
        `${envName} points at ${u.origin}, which is neither ${canonical} nor loopback. It exists so the tests ` +
        'can drive the real transport against a local server; any other value would send this job\'s store ' +
        'credential and package to that host. Loopback or the real value — there is no third option.',
    };
  }
  return { base: raw, override: true };
}

/** The line a run prints while a seam is in effect, so no log can read a stub
 *  answer as the real store's. */
export const overrideLine = (envName, base) => `⬜   ${envName} override in effect: ${base} — this is a LOOPBACK TEST SEAM, not the real service.`;

/**
 * The poll timing. STORE_POLL_INTERVAL_MS and STORE_POLL_CEILING_MS shorten the
 * poll for the stub tests and are honoured ONLY while a loopback override is in
 * effect: against a real store a shortened ceiling would turn a slow store into
 * a NOT CONFIRMED that invites a second upload of the same version.
 *
 * @returns {{intervalMs:number, ceilingMs:number} | {error:string}}
 */
export function pollTiming(env = process.env, overrideInEffect = false) {
  const set = ['STORE_POLL_INTERVAL_MS', 'STORE_POLL_CEILING_MS'].filter((n) => String(env[n] ?? '').trim() !== '');
  if (set.length === 0) return { intervalMs: STORE_POLL_INTERVAL_MS, ceilingMs: STORE_POLL_CEILING_MS };
  if (!overrideInEffect) {
    return { error: `${set.join(' and ')} is set while no store origin is overridden. The poll timing may be shortened only against a loopback stub.` };
  }
  const read = (n, fallback) => {
    const raw = String(env[n] ?? '').trim();
    if (raw === '') return fallback;
    return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null;
  };
  const intervalMs = read('STORE_POLL_INTERVAL_MS', STORE_POLL_INTERVAL_MS);
  const ceilingMs = read('STORE_POLL_CEILING_MS', STORE_POLL_CEILING_MS);
  if (intervalMs === null || ceilingMs === null) return { error: `${set.join(' and ')} must be a positive whole number of milliseconds.` };
  return { intervalMs, ceilingMs };
}

/** The credentials each store's keepalive exercises, by name, out of the lane
 *  table. Chrome's keepalive mints a token and addresses no publisher, so it
 *  asks for the service account alone; AMO and Edge probe with both halves of
 *  their key. */
const KEEPALIVE_NAMES = Object.freeze({
  amo: null,
  'edge-addons': null,
  'chrome-webstore': [CWS_SA_ENV],
});

/**
 * THE ONE PRESENCE GATE for every store keepalive.
 *   probe      — the store's secret is present, armed or not: exercise it;
 *   refuse     — the secret is absent and the register ARMS the store (exit 1):
 *                the release lane depends on a credential that is not there;
 *   owner-step — the secret is absent and the store is unarmed (exit 0): only
 *                the owner can create it, so a scheduled run prints the step.
 *
 * A key that exists is exercised whether or not the row is armed. Gating the
 * probe on arming meant a present key could die unseen for as long as its row
 * stayed unarmed, and arming is exactly the moment it is first needed.
 *
 * Throws ArmingCoverageLost from the register read, for the caller to print.
 *
 * @returns {{gate:'probe'|'refuse'|'owner-step', lines:string[], missing:string[]}}
 */
export function keepaliveGate(store, env = process.env, root = REPO_ROOT) {
  const lane = LANES[store];
  if (lane === undefined) throw new Error(`keepaliveGate: no lane "${store}"; publish-arming.mjs declares [${Object.keys(LANES).join(', ')}].`);
  const names = KEEPALIVE_NAMES[store] ?? null;
  const secrets = names === null ? lane.secrets : lane.secrets.filter((s) => names.includes(s.name));
  const v = publishVerdict({ channelId: lane.channelId, secrets, ownerStep: lane.ownerStep, env, root });
  if (v.missing.length === 0) return { gate: 'probe', lines: v.lines, missing: [] };
  return { gate: v.arming.armed ? 'refuse' : 'owner-step', lines: v.lines, missing: v.missing };
}
