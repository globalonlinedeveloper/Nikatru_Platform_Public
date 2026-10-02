// ─────────────────────────────────────────────────────────────────────────────
// tooling/ops/vitals/readers.mjs — STORE VITALS, ONE INTERFACE, ONE ADAPTER PER
// STORE (crash-rates; O-STORE-VITALS-UNREAD).
//
// Every adapter answers `read({ app, env, fetchImpl, now })` with READINGS in one
// normalised shape:
//   { channel, metric, value, unit, period, status, detail }
//     status  ok          — the store answered and the rate is `value`;
//             no-data     — the store answered with nothing (too few users yet):
//                           GREY, never a pass;
//             unreadable  — a credential is missing (named) or was refused, or
//                           the call failed: never red and never green;
//             no-source   — the store exposes no such data; `detail` says why.
// A body in a shape the docs do not describe THROWS (VitalsShapeError): an
// unknown field fails loudly, never as a zero.
//
// Store-aggregated rates only: no device, user or crash payload is fetched.
// Every call carries a timeout (VITALS_TIMEOUT_MS) and the run a request budget
// (MAX_VITALS_REQUESTS). Keys are read BY NAME from the environment the secret
// manifest gives (PLAY_SERVICE_ACCOUNT_JSON; APP_STORE_CONNECT_*), never printed.
//
// THE DOCS, read 2026-10-02 (field names come from these, never from memory):
//   · Google Play Developer Reporting API v1beta1 — POST
//     https://playdeveloperreporting.googleapis.com/v1beta1/{name=apps/*/crashRateMetricSet}:query
//     (and anrRateMetricSet, slowStartRateMetricSet); scope
//     https://www.googleapis.com/auth/playdeveloperreporting; DAILY rows only in
//     America/Los_Angeles; response {rows: [MetricsRow], nextPageToken};
//     MetricsRow {aggregationPeriod, startTime: DateTime, dimensions, metrics:
//     [MetricValue {metric, decimalValue: {value}}]} (the discovery document,
//     https://playdeveloperreporting.googleapis.com/$discovery/rest?version=v1beta1);
//     metrics userPerceivedCrashRate28dUserWeighted, userPerceivedAnrRate28dUserWeighted,
//     slowStartRate28dUserWeighted, distinctUsers ("Percentage of distinct users ...").
//     ⚠️ UNIT: the docs say "Percentage" of a google.type.Decimal and give no
//     example; this reader takes the value as a FRACTION of users (0.0042 = 0.42 %)
//     and THROWS on a value above 1, so a wrong reading is loud, never green.
//     The first real reading confirms it (Lead steps).
//     COST (ADR 033 forbids a metered API in the store project): the API's
//     "Usage limits" page (https://developers.google.com/play/developer/reporting/limits,
//     read 2026-10-02) states "a default limit of 10 queries per second" and names
//     no price and no billing requirement; no page states "free" outright, so the
//     lead confirms in the console that enabling it asks for no billing account
//     before enabling it (Lead steps). One run makes at most MAX_VITALS_REQUESTS calls.
//   · App Store Connect API — GET /v1/apps/{id}/perfPowerMetrics, filter[platform]
//     allows IOS only, filter[metricType] DISK HANG BATTERY LAUNCH MEMORY ANIMATION
//     TERMINATION STORAGE; the body is xcodeMetrics {productData: [{platform,
//     metricCategories: [{identifier, metrics: [{identifier, unit: {identifier,
//     displayName}, datasets: [{filterCriteria, points: [{value, version, ...}]}]}]}]}]}.
//     No crash-free rate is exposed: HANG / LAUNCH / TERMINATION are read and
//     reported ungraded (no threshold is set for them).
//   · Microsoft Store — Partner Center analytics `GET /v1.0/my/analytics/failurehits`
//     returns failure HIT COUNTS, not a per-user rate: no-source.
//   · macOS App Store: perfPowerMetrics filters by IOS only, so no-source. Snap,
//     apps.gov.in, the web and the direct downloads: no store-aggregated rate is
//     KNOWN for them (Snap's and apps.gov.in's docs were not established here):
//     no-source, each with its reason.
// ─────────────────────────────────────────────────────────────────────────────
import { createSign } from 'node:crypto';
import { ascJwt } from '../provision-apple.mjs';

/** @ceiling none — a client-side patience budget for one store call, not a platform resource. */
export const VITALS_TIMEOUT_MS = 15_000;
/** @ceiling none — the most store calls one run makes, a request budget we chose. */
export const MAX_VITALS_REQUESTS = 40;

export const PLAY_REPORTING = 'https://playdeveloperreporting.googleapis.com/v1beta1';
export const PLAY_SCOPE = 'https://www.googleapis.com/auth/playdeveloperreporting';
export const ASC_API = 'https://api.appstoreconnect.apple.com';

export class VitalsShapeError extends Error {}

/** The Play metric sets read, the metric each grades as, and the column taken. */
export const PLAY_SETS = [
  { set: 'crashRateMetricSet', metric: 'crash', column: 'userPerceivedCrashRate28dUserWeighted' },
  { set: 'anrRateMetricSet', metric: 'anr', column: 'userPerceivedAnrRate28dUserWeighted' },
  { set: 'slowStartRateMetricSet', metric: 'slow-start', column: 'slowStartRate28dUserWeighted' },
];

/** The ASC metric categories read (perfPowerMetrics); each metric is reported ungraded. */
export const ASC_CATEGORIES = ['HANG', 'LAUNCH', 'TERMINATION'];

/** Why each channel with no adapter reads nothing. */
export const NO_SOURCE = {
  'macos-appstore': 'App Store Connect perfPowerMetrics filters by platform IOS only; no macOS rate is exposed',
  'windows-store': 'Partner Center analytics (failurehits) returns failure hit counts, not a per-user rate',
  'windows-direct': 'a direct download has no store to aggregate it, and SDK session tracking is OFF (INV-1118)',
  'linux-snap': 'no store-aggregated crash or hang rate is known for the Snap Store (not established from its docs here)',
  'linux-appimage': 'a direct download has no store to aggregate it, and SDK session tracking is OFF (INV-1118)',
  'apps-gov-in': 'no store-aggregated crash or hang rate is known for apps.gov.in (not established from its docs here)',
  web: 'the web has no store, and SDK session tracking is OFF (INV-1118), so no crash-free rate exists',
};

const reading = (channel, metric, status, extra = {}) => ({ channel, metric, value: null, unit: 'fraction', period: null, status, detail: '', ...extra });

/** A budgeted, time-bounded fetch: never unbounded, never more than the run's budget. */
export function budgetedFetch(fetchImpl, budget = { left: MAX_VITALS_REQUESTS }) {
  return async (url, init = {}) => {
    if (budget.left <= 0) throw Object.assign(new Error('the run spent its request budget'), { name: 'BudgetError' });
    budget.left--;
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(VITALS_TIMEOUT_MS) });
  };
}

// ── Google Play ──────────────────────────────────────────────────────────────

/** An access token for the service account, by the JWT-bearer grant. */
async function playToken(saJson, f, nowSec) {
  let sa;
  try {
    sa = JSON.parse(saJson);
  } catch {
    return { error: 'PLAY_SERVICE_ACCOUNT_JSON is not JSON' };
  }
  const b64u = (x) => Buffer.from(x).toString('base64url');
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: PLAY_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  let sig;
  try {
    sig = b64u(signer.sign(sa.private_key));
  } catch {
    return { error: 'PLAY_SERVICE_ACCOUNT_JSON carries no usable private key' };
  }
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${body}.${sig}`,
  });
  if (res.status !== 200) return { error: `the token endpoint answered ${res.status}` };
  const j = await res.json();
  return typeof j.access_token === 'string' ? { token: j.access_token } : { error: 'the token endpoint returned no access_token' };
}

const ymd = (ms) => {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), timeZone: { id: 'America/Los_Angeles' } };
};

/** One Play query body: the last week of DAILY rows (the newest complete day is ~2 days behind). */
export function playQueryBody(column, nowMs) {
  return {
    timelineSpec: { aggregationPeriod: 'DAILY', startTime: ymd(nowMs - 9 * 86_400_000), endTime: ymd(nowMs - 1 * 86_400_000) },
    metrics: [column, 'distinctUsers'],
    dimensions: [],
  };
}

/** Parse a Play query answer into the newest row's value of `column`, or null for no rows. Throws on a shape the docs do not describe. */
export function parsePlayRows(body, column) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new VitalsShapeError('play: the answer is not an object');
  for (const k of Object.keys(body)) if (k !== 'rows' && k !== 'nextPageToken') throw new VitalsShapeError(`play: unknown field \`${k}\``);
  const rows = body.rows ?? [];
  if (!Array.isArray(rows)) throw new VitalsShapeError('play: `rows` is not a list');
  if (rows.length === 0) return null;
  let newest = null;
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!['aggregationPeriod', 'startTime', 'dimensions', 'metrics'].includes(k)) throw new VitalsShapeError(`play: unknown row field \`${k}\``);
    const t = r.startTime;
    if (!t || !Number.isInteger(t.year) || !Number.isInteger(t.month) || !Number.isInteger(t.day)) throw new VitalsShapeError('play: a row has no startTime date');
    const period = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    let value;
    for (const m of r.metrics ?? []) {
      if (m.metric !== column && m.metric !== 'distinctUsers') throw new VitalsShapeError(`play: unknown metric \`${m.metric}\``);
      if (m.metric !== column) continue;
      const raw = m.decimalValue?.value;
      if (typeof raw !== 'string') throw new VitalsShapeError(`play: ${column} carries no decimalValue.value`);
      value = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new VitalsShapeError(`play: ${column} is not a number`);
      if (value > 1) throw new VitalsShapeError(`play: ${column} is ${raw}, above 1 — not a fraction of users; the unit assumption is wrong`);
    }
    if (value === undefined) continue; // a day the metric has no value for
    if (newest === null || period > newest.period) newest = { period, value };
  }
  return newest;
}

export async function readPlay({ app, env, fetchImpl, now }) {
  const channel = 'android-play';
  if (!env.PLAY_SERVICE_ACCOUNT_JSON) return PLAY_SETS.map((s) => reading(channel, s.metric, 'unreadable', { detail: 'PLAY_SERVICE_ACCOUNT_JSON is not set' }));
  const f = budgetedFetch(fetchImpl, app.budget);
  let tok;
  try {
    tok = await playToken(env.PLAY_SERVICE_ACCOUNT_JSON, f, Math.floor(now() / 1000));
  } catch (e) {
    tok = { error: `the token call failed (${e?.name ?? 'error'})` };
  }
  if (tok.error) return PLAY_SETS.map((s) => reading(channel, s.metric, 'unreadable', { detail: `PLAY_SERVICE_ACCOUNT_JSON: ${tok.error}` }));
  const out = [];
  for (const s of PLAY_SETS) {
    let res;
    try {
      res = await f(`${PLAY_REPORTING}/apps/${encodeURIComponent(app.androidPackage)}/${s.set}:query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tok.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(playQueryBody(s.column, now())),
      });
    } catch (e) {
      out.push(reading(channel, s.metric, 'unreadable', { detail: `the ${s.set} query failed (${e?.name ?? 'error'})` }));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      out.push(reading(channel, s.metric, 'unreadable', { detail: `${res.status}: PLAY_SERVICE_ACCOUNT_JSON was refused, or the Reporting API is not enabled for it` }));
      continue;
    }
    if (res.status !== 200) {
      out.push(reading(channel, s.metric, 'unreadable', { detail: `the ${s.set} query answered ${res.status}` }));
      continue;
    }
    const got = parsePlayRows(await res.json(), s.column);
    out.push(got === null ? reading(channel, s.metric, 'no-data', { detail: 'Play returned no rows (too few users yet)' }) : reading(channel, s.metric, 'ok', { value: got.value, period: got.period }));
  }
  return out;
}

// ── App Store Connect (iOS) ──────────────────────────────────────────────────

/** Parse an xcodeMetrics body into one reading per metric of the read categories. Throws on an unknown shape. */
export function parseAscMetrics(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new VitalsShapeError('asc: the answer is not an object');
  for (const k of Object.keys(body)) if (!['insights', 'productData', 'version'].includes(k)) throw new VitalsShapeError(`asc: unknown field \`${k}\``);
  const products = body.productData ?? [];
  if (!Array.isArray(products)) throw new VitalsShapeError('asc: productData is not a list');
  const out = [];
  for (const p of products) {
    if (p.platform !== undefined && p.platform !== 'IOS') continue;
    for (const c of p.metricCategories ?? []) {
      if (typeof c.identifier !== 'string') throw new VitalsShapeError('asc: a metric category has no identifier');
      if (!ASC_CATEGORIES.includes(c.identifier)) continue;
      for (const m of c.metrics ?? []) {
        if (typeof m.identifier !== 'string' || typeof m.unit?.identifier !== 'string') throw new VitalsShapeError(`asc: a ${c.identifier} metric has no identifier or unit`);
        const ds = (m.datasets ?? []).find((d) => /fifty|50/.test(String(d?.filterCriteria?.percentile ?? ''))) ?? (m.datasets ?? [])[0];
        const pts = ds?.points ?? [];
        const last = pts[pts.length - 1];
        if (last === undefined) {
          out.push(reading('ios-appstore', `${c.identifier.toLowerCase()}:${m.identifier}`, 'no-data', { unit: m.unit.identifier, detail: 'no points yet' }));
          continue;
        }
        if (typeof last.value !== 'number' || !Number.isFinite(last.value)) throw new VitalsShapeError(`asc: ${m.identifier}'s newest point has no numeric value`);
        out.push(reading('ios-appstore', `${c.identifier.toLowerCase()}:${m.identifier}`, 'ok', { value: last.value, unit: m.unit.identifier, period: typeof last.version === 'string' ? `version ${last.version}` : null }));
      }
    }
  }
  return out;
}

export async function readAppStore({ app, env, fetchImpl, now }) {
  const channel = 'ios-appstore';
  const missing = ['APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_PRIVATE_KEY'].filter((k) => !env[k]);
  if (missing.length) return [reading(channel, 'perf-power', 'unreadable', { unit: null, detail: `${missing.join(', ')} not set` })];
  if (!app.ascAppId) return [reading(channel, 'perf-power', 'no-data', { unit: null, detail: 'no App Store record id in app.yaml yet' })];
  let jwt;
  try {
    jwt = ascJwt({ issuerId: env.APP_STORE_CONNECT_ISSUER_ID, keyId: env.APP_STORE_CONNECT_KEY_ID, privateKey: env.APP_STORE_CONNECT_PRIVATE_KEY, now: Math.floor(now() / 1000) });
  } catch {
    return [reading(channel, 'perf-power', 'unreadable', { unit: null, detail: 'APP_STORE_CONNECT_PRIVATE_KEY could not sign' })];
  }
  const f = budgetedFetch(fetchImpl, app.budget);
  let res;
  try {
    res = await f(`${ASC_API}/v1/apps/${encodeURIComponent(app.ascAppId)}/perfPowerMetrics?filter[platform]=IOS&filter[metricType]=${ASC_CATEGORIES.join(',')}`, {
      headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.apple.xcode-metrics+json, application/json' },
    });
  } catch (e) {
    return [reading(channel, 'perf-power', 'unreadable', { unit: null, detail: `the perfPowerMetrics read failed (${e?.name ?? 'error'})` })];
  }
  if (res.status === 401 || res.status === 403) return [reading(channel, 'perf-power', 'unreadable', { unit: null, detail: `${res.status}: the App Store Connect key was refused` })];
  if (res.status !== 200) return [reading(channel, 'perf-power', 'unreadable', { unit: null, detail: `perfPowerMetrics answered ${res.status}` })];
  const readings = parseAscMetrics(await res.json());
  return readings.length ? readings : [reading(channel, 'perf-power', 'no-data', { unit: null, detail: 'App Store Connect returned no metrics (too few users yet)' })];
}

/** The adapter for each channel; a channel with none reads `no-source` with its reason. */
export const ADAPTERS = { 'android-play': readPlay, 'ios-appstore': readAppStore };

export async function readChannel(channel, ctx) {
  const adapter = ADAPTERS[channel];
  if (!adapter) return [reading(channel, '*', 'no-source', { unit: null, detail: NO_SOURCE[channel] ?? 'no vitals adapter is written for this channel' })];
  return adapter(ctx);
}
