// ─────────────────────────────────────────────────────────────────────────────
// geo.ts — REQUEST GEOGRAPHY, IN ONE HELPER. THE ONLY MODULE THAT READS `.cf`.
//
// ⏱ 2026-10-01 · O-CLOUDFLARE-BINDINGS-SCATTERED (port-storage). `request.cf`
// is Cloudflare's per-request object: the edge PoP that terminated the
// connection, the network it came from, and a coarse location — all derived by
// the edge from the transport, never from a header the caller wrote. It was read
// by hand in three modules (the edge-ceiling key, the events row's coarse geo and
// the request log's colo), each with its own guard against a missing or odd
// value. It is read HERE now, and assert-ports limb 10 refuses a `.cf` read in
// any other module under services/*/src: a second runtime answers this one
// function, not three call sites.
//
// 🔴 USED ONLY WHERE IT WAS USED. The edge-ceiling key (colo + asn), the events
// row (country, region, city) and the request log (colo). Never for choosing a
// payment rail — that is the channel register's answer, ruled (Q2) — and never
// `country` for anything that decides money: it is where the edge saw the
// connection, not where the buyer is.
//
// Each field is passed through only when the runtime gave it the type it
// documents, and is otherwise ABSENT — the callers' own fallbacks (`-`, null,
// undefined) are unchanged. `asn` is kept as given (a number in workerd), so the
// edge key's own bound applies exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

/** What the edge knows about where a request came from. Every field may be absent. */
export interface RequestGeo {
  /** ISO 3166-1 alpha-2, as the edge saw the connection. */
  country?: string;
  region?: string;
  city?: string;
  /** The edge PoP (IATA code) that terminated the connection. */
  colo?: string;
  /** The autonomous system the connection came from. */
  asn?: number | string;
}

/** The geography of `req`, from the runtime's per-request object. Never throws. */
export function requestGeo(req: Request): RequestGeo {
  const cf = (req as Request & { cf?: unknown }).cf;
  if (typeof cf !== 'object' || cf === null) return {};
  const raw = cf as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const geo: RequestGeo = {};
  const country = str(raw.country);
  if (country !== undefined) geo.country = country;
  const region = str(raw.region);
  if (region !== undefined) geo.region = region;
  const city = str(raw.city);
  if (city !== undefined) geo.city = city;
  const colo = str(raw.colo);
  if (colo !== undefined) geo.colo = colo;
  if (typeof raw.asn === 'number' || typeof raw.asn === 'string') geo.asn = raw.asn;
  return geo;
}
