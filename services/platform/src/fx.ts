// ─────────────────────────────────────────────────────────────────────────────
// ST-I3 · THE HOME-CURRENCY RATE TABLE — the ECB's euro reference rates, fetched
// by the nightly cron, kept in CONFIG_KV, served to every app by GET /v1/fx/latest.
//
// 🔴 A CONVERSION IS ONLY HONEST WITH A DATED RATE FROM A SOURCE THAT CAN BE
// CITED. packages/core's Money note says so, and it is why the hardcoded
// `{USD:1.0, INR:83.0}` table that once multiplied a user's ₹499 by 83 was
// removed rather than corrected. This file is that source: the European Central
// Bank's daily reference table, carried with the ECB's own date for it (`asOf`)
// and the ECB's own name for it (`source`), so the UI can print the attribution
// line and core can say when the table has gone stale.
//
// ⚠️ PUBLIC DATA, NOT USER DATA. The request carries nothing about anybody, the
// table is the same for every caller, and nothing here is personal — which is
// why it lives in CONFIG_KV beside the per-app config and needs no migration
// and no retention row.
//
// 🔴 ON ANY FAILURE THE LAST GOOD TABLE STAYS. A refused fetch, a timeout, a
// malformed document, a missing currency or a non-positive rate writes an ok=0
// heartbeat and leaves `fx:ecb:latest` exactly as it was. A table the ECB did not
// publish is never better than yesterday's, so nothing here ever deletes one.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from './types';
import type { KvStore } from '../../_shared/src/ports/kv';

/** The ECB's daily reference-rate document: one `Cube time` and one
 *  `Cube currency/rate` per quoted currency, units per ONE euro. */
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** The CONFIG_KV key the table lives under. The one writer is `refreshFxRates`;
 *  the one reader on the request path is routes/fx.ts. */
export const FX_KV_KEY = 'fx:ecb:latest';

/** The ECB's own name for the series, for the attribution line the UI shows. */
export const FX_SOURCE = 'Euro foreign exchange reference rates, European Central Bank';

/** The heartbeat target — one row per run, naming the upstream it read. */
export const FX_TARGET = 'ecb';

/** The currencies a table must quote before it may replace the last good one.
 *  USD, INR and GBP are the currencies the portfolio's apps sell in and total
 *  in today; a table without one of them cannot convert a real user's total. */
export const FX_REQUIRED_CURRENCIES: readonly string[] = ['USD', 'INR', 'GBP'];

/** @ceiling none — a per-request TIMEOUT in milliseconds, not a platform cap. */
export const FX_FETCH_TIMEOUT_MS = 10_000;

/**
 * The oldest the ECB's NEWEST fix can honestly be at the 06:00 UTC read, in
 * calendar days.
 *
 * DERIVED, NOT CHOSEN: the ECB publishes on TARGET business days, and the
 * longest runs of closed days are four long — Good Friday to Easter Monday, or
 * Christmas and 26 December beside a weekend. Read at 06:00 UTC, the newest fix
 * after Easter is Thursday's on the Tuesday morning: five days back. A newest
 * table OLDER than this has not been held back by a holiday; the publication has
 * stopped, or the document is frozen, and a green row every night would hide it.
 *
 * @ceiling none — a CALENDAR fact about the upstream, not a resource cap.
 */
export const FX_MAX_FIX_GAP_DAYS = 5;

/** What CONFIG_KV holds and GET /v1/fx/latest answers. The shape is
 *  contracts/fx/latest.v1.example.json's `response`. */
export interface FxTable {
  source: string;
  sourceUrl: string;
  base: 'EUR';
  /** The ECB's date for the fix, `YYYY-MM-DD`. */
  asOf: string;
  /** When this Worker read it, ISO 8601. */
  fetchedAt: string;
  /** Units of each currency per ONE euro. Every value is finite and positive. */
  rates: Record<string, number>;
}

export type FxParse =
  | { ok: true; asOf: string; rates: Record<string, number> }
  | { ok: false; reason: string };

export interface FxRow {
  target: string;
  ok: boolean;
  detail: string;
}

const refuse = (reason: string): FxParse => ({ ok: false, reason });

/** `YYYY-MM-DD` that names a real calendar day. */
function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The attributes of one start tag, by name. Single or double quotes. */
function attributesOf(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:'([^']*)'|"([^"]*)")/g)) {
    out.set(m[1], m[2] ?? m[3] ?? '');
  }
  return out;
}

/**
 * Parses the ECB daily document WITHOUT A DOM — a Worker has none, and the
 * document is three levels of one element name. Every `<Cube …>` start tag is
 * read by its attributes: `time` dates the table, `currency` + `rate` is a row.
 *
 * REFUSED, each with the reason the heartbeat prints: no `Cube time`, more than
 * one (that is the history file, not the daily one), a date that is not a day, a
 * row with no rate, a code that is not three capitals, the base quoting itself,
 * a currency twice, a rate that is not a decimal, a rate at or below zero, and a
 * table without every FX_REQUIRED_CURRENCIES member.
 */
export function parseEcbDaily(xml: string): FxParse {
  const cubes = [...xml.matchAll(/<Cube\b([^>]*)>/g)].map((m) => attributesOf(m[1]));
  const times = cubes.filter((a) => a.has('time')).map((a) => a.get('time') as string);
  if (times.length === 0) return refuse('no Cube time element: not an ECB reference table');
  if (times.length > 1) return refuse(`${times.length} Cube time elements: not the daily table`);
  const asOf = times[0];
  if (!isCalendarDate(asOf)) return refuse(`Cube time ${JSON.stringify(asOf)} is not a calendar date`);

  const rates: Record<string, number> = {};
  for (const a of cubes) {
    if (!a.has('currency')) continue;
    const code = a.get('currency') as string;
    const raw = a.get('rate');
    if (raw === undefined) return refuse(`currency ${JSON.stringify(code)} carries no rate`);
    if (!/^[A-Z]{3}$/.test(code)) return refuse(`currency ${JSON.stringify(code)} is not an ISO 4217 code`);
    if (code === 'EUR') return refuse('the table quotes EUR, its own base');
    if (Object.hasOwn(rates, code)) return refuse(`currency ${code} appears twice`);
    if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return refuse(`rate for ${code} is ${JSON.stringify(raw)}, not a decimal`);
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) return refuse(`rate for ${code} is ${raw}: a non-positive rate`);
    rates[code] = rate;
  }
  const missing = FX_REQUIRED_CURRENCIES.filter((c) => !Object.hasOwn(rates, c));
  if (missing.length > 0) return refuse(`the table lacks ${missing.join(', ')}`);
  return { ok: true, asOf, rates };
}

/**
 * Reads what CONFIG_KV holds back into an [FxTable], or null when it is absent
 * or is not one. The same rules as the parser, so a table this Worker would have
 * refused from the ECB is refused from its own cache too.
 */
export function parseStoredFxTable(raw: string | null): FxTable | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const t = v as Record<string, unknown>;
  if (t.base !== 'EUR' || typeof t.asOf !== 'string' || !isCalendarDate(t.asOf)) return null;
  if (typeof t.source !== 'string' || typeof t.sourceUrl !== 'string' || typeof t.fetchedAt !== 'string') return null;
  if (typeof t.rates !== 'object' || t.rates === null || Array.isArray(t.rates)) return null;
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(t.rates as Record<string, unknown>)) {
    if (!/^[A-Z]{3}$/.test(code) || code === 'EUR') return null;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
    rates[code] = rate;
  }
  if (FX_REQUIRED_CURRENCIES.some((c) => !Object.hasOwn(rates, c))) return null;
  return { source: t.source, sourceUrl: t.sourceUrl, base: 'EUR', asOf: t.asOf, fetchedAt: t.fetchedAt, rates };
}

/**
 * One bounded GET of the daily document, parsed. Never throws: a transport
 * failure, a timeout, a non-2xx or an unreadable body comes back as a refusal.
 *
 * 🔴 THE TIMEOUT IS THE POINT. This runs inside the nightly chain, ahead of the
 * renewals fan-out and the retention sweep; an upstream that accepts the
 * connection and never answers would hold every limb after it for as long as
 * the runtime lets the invocation live.
 */
export async function fetchEcbDaily(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = FX_FETCH_TIMEOUT_MS,
): Promise<FxParse> {
  let res: Response;
  try {
    res = await fetchImpl(ECB_DAILY_URL, {
      method: 'GET',
      headers: { accept: 'application/xml, text/xml' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return refuse(`no answer: ${String(err).slice(0, 120)}`);
  }
  if (res.status < 200 || res.status > 299) return refuse(`HTTP ${res.status}`);
  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    return refuse(`body unreadable: ${String(err).slice(0, 120)}`);
  }
  return parseEcbDaily(body);
}

/** Whole calendar days from `asOf` to the UTC date of `nowMs`. */
function daysBehind(asOf: string, nowMs: number): number {
  const today = Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
}

/**
 * Fetch, validate and keep the ECB table; return the ONE heartbeat row the
 * scheduler records under the fx job. Never throws.
 *
 *   ok=1  a valid table is cached: written tonight, or already the newest.
 *   ok=0  anything else — no binding, a refused or unreadable fetch, a KV write
 *         that failed, or an upstream whose newest fix is older than
 *         FX_MAX_FIX_GAP_DAYS. In every ok=0 case `fx:ecb:latest` is untouched,
 *         and the detail says which table is still being served.
 */
export async function refreshFxRates(
  env: Env,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; nowMs?: number } = {},
): Promise<FxRow> {
  const nowMs = opts.nowMs ?? Date.now();
  // Declared required in types.ts, but a deploy can still lack it; an unbound
  // namespace is a failure row, never a throw that skips the rest of the chain.
  const kv = (env as unknown as { CONFIG_KV?: KvStore }).CONFIG_KV;
  if (!kv) return { target: FX_TARGET, ok: false, detail: 'no CONFIG_KV binding: nowhere to keep the table' };

  let last: FxTable | null = null;
  let lastNote = '';
  try {
    last = parseStoredFxTable(await kv.get(FX_KV_KEY));
  } catch (err) {
    lastNote = ` (the kept table could not be read: ${String(err).slice(0, 60)})`;
  }
  const kept = last ? `still serving ${last.asOf}` : `no table cached${lastNote}`;

  const fetched = await fetchEcbDaily(opts.fetchImpl ?? fetch, opts.timeoutMs ?? FX_FETCH_TIMEOUT_MS);
  if (!fetched.ok) return { target: FX_TARGET, ok: false, detail: `refused: ${fetched.reason}; ${kept}` };

  const lag = daysBehind(fetched.asOf, nowMs);
  const staleNote =
    lag > FX_MAX_FIX_GAP_DAYS
      ? `the ECB's newest fix is ${fetched.asOf}, ${lag} days back — more than the longest holiday gap (${FX_MAX_FIX_GAP_DAYS})`
      : null;
  const count = Object.keys(fetched.rates).length;

  // Never replace a newer table with an older one: a lagging mirror is not news.
  if (last && fetched.asOf <= last.asOf) {
    const why = fetched.asOf === last.asOf ? 'unchanged' : `the ECB served ${fetched.asOf}, older than the kept one`;
    return staleNote
      ? { target: FX_TARGET, ok: false, detail: `${staleNote}; ${kept}` }
      : { target: FX_TARGET, ok: true, detail: `${why}: ${kept}, ${Object.keys(last.rates).length} currencies` };
  }

  const table: FxTable = {
    source: FX_SOURCE,
    sourceUrl: ECB_DAILY_URL,
    base: 'EUR',
    asOf: fetched.asOf,
    fetchedAt: new Date(nowMs).toISOString(),
    rates: fetched.rates,
  };
  try {
    await kv.put(FX_KV_KEY, JSON.stringify(table));
  } catch (err) {
    return { target: FX_TARGET, ok: false, detail: `KV write failed: ${String(err).slice(0, 80)}; ${kept}` };
  }
  return staleNote
    ? { target: FX_TARGET, ok: false, detail: `cached ${fetched.asOf}, but ${staleNote}` }
    : { target: FX_TARGET, ok: true, detail: `cached ${fetched.asOf}: ${count} currencies` };
}
