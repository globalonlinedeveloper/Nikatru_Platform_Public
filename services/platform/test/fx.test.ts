import { describe, it, expect, vi, afterEach } from 'vitest';
import VECTOR_RAW from '../../../contracts/fx/latest.v1.example.json?raw';
import {
  ECB_DAILY_URL,
  FX_KV_KEY,
  FX_MAX_FIX_GAP_DAYS,
  fetchEcbDaily,
  parseEcbDaily,
  parseStoredFxTable,
  refreshFxRates,
  type FxTable,
} from '../src/fx';
import { fxRates, FX_RATES_JOB } from '../src/scheduled';
import { app } from '../src/index';
import { realPlatformDb } from './harness';
import type { Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// ST-I3 · THE ECB RATE TABLE — parsed without a DOM, kept through every failure,
// served by GET /v1/fx/latest.
//
// 🔴 THE VECTOR IS THE CONTRACT BETWEEN THIS WORKER AND CORE. contracts/fx/
// latest.v1.example.json's `response` is what the Worker must store and serve
// for the hand-built ECB document below, and packages/core/test/money/
// fx_rates_test.dart reads the SAME file into FxTable and converts with it. A
// change to the payload that one side makes alone is red on the other side.
//
// The RED controls a fix must keep red: a zero rate, and a table without INR —
// both refused, and in both the last good table is still the one in KV. A
// TIMEOUT writes a failed row and throws nothing.
// ─────────────────────────────────────────────────────────────────────────────

interface Vector {
  response: FxTable;
  conversions: {
    from: { minor_units: number; currency: string };
    to: string;
    expect: { minor_units: number; currency: string };
  }[];
}
const VECTOR = JSON.parse(VECTOR_RAW) as Vector;

type Row = { currency: string; rate: string };

/** The ECB daily document's exact shape: gesmes envelope, a wrapper Cube, one
 *  dated Cube, one row per currency, single-quoted attributes. HAND-BUILT: the
 *  figures are the vector's, written the way the ECB writes them (trailing
 *  zeros kept), not any real day's fix. */
const FIXTURE_ROWS: Row[] = [
  { currency: 'USD', rate: '1.1732' },
  { currency: 'JPY', rate: '173.52' },
  { currency: 'GBP', rate: '0.87310' },
  { currency: 'INR', rate: '103.9870' },
  { currency: 'CHF', rate: '0.9345' },
  { currency: 'AUD', rate: '1.7802' },
  { currency: 'CAD', rate: '1.6275' },
];

function ecbXml(time: string = VECTOR.response.asOf, rows: Row[] = FIXTURE_ROWS): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">',
    '\t<gesmes:subject>Reference rates</gesmes:subject>',
    '\t<gesmes:Sender>',
    '\t\t<gesmes:name>European Central Bank</gesmes:name>',
    '\t</gesmes:Sender>',
    '\t<Cube>',
    `\t\t<Cube time='${time}'>`,
    ...rows.map((r) => `\t\t\t<Cube currency='${r.currency}' rate='${r.rate}'/>`),
    '\t\t</Cube>',
    '\t</Cube>',
    '</gesmes:Envelope>',
  ].join('\n');
}

const withRate = (currency: string, rate: string): Row[] =>
  FIXTURE_ROWS.map((r) => (r.currency === currency ? { currency, rate } : r));
const without = (currency: string): Row[] => FIXTURE_ROWS.filter((r) => r.currency !== currency);

/** A KV namespace that records what it was asked, and can refuse a write. */
class FakeKv {
  store = new Map<string, string>();
  reads: string[] = [];
  puts: string[] = [];
  constructor(private readonly failPut = false) {}
  async get(key: string) {
    this.reads.push(key);
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    if (this.failPut) throw new Error('KV put refused');
    this.puts.push(key);
    this.store.set(key, value);
  }
}

class FakeLimiter {
  keys: string[] = [];
  constructor(private readonly allow: boolean = true) {}
  limit = async ({ key }: { key: string }) => {
    this.keys.push(key);
    return { success: this.allow };
  };
}

/** A fetch that answers the ECB URL with `body`, and records what it was sent. */
function ecbAnswering(body: string, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const FETCHED_AT_MS = Date.parse(VECTOR.response.fetchedAt);

/** A KV already holding a good table one working day OLDER than the vector's. */
function kvWithLastGood(): { kv: FakeKv; lastGood: string } {
  const kv = new FakeKv();
  const lastGood = JSON.stringify({ ...VECTOR.response, asOf: '2026-09-24', fetchedAt: '2026-09-25T06:00:01.000Z' });
  kv.store.set(FX_KV_KEY, lastGood);
  return { kv, lastGood };
}

const envWith = (kv: FakeKv | undefined, db: unknown = undefined) =>
  ({ CONFIG_KV: kv, PLATFORM_DB: db }) as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseEcbDaily — the ECB document, read without a DOM', () => {
  it('reads the hand-built document into exactly the vector\'s asOf and rates', () => {
    const r = parseEcbDaily(ecbXml());
    expect(r).toEqual({ ok: true, asOf: VECTOR.response.asOf, rates: VECTOR.response.rates });
  });

  it('reads double-quoted attributes, and attributes in either order', () => {
    const xml = ecbXml().replace(/'/g, '"').replace(`currency="USD" rate="1.1732"`, `rate="1.1732" currency="USD"`);
    const r = parseEcbDaily(xml);
    expect(r.ok && r.rates.USD).toBe(1.1732);
  });

  it('🔴 RED CONTROL — a ZERO rate is refused, naming the currency', () => {
    expect(parseEcbDaily(ecbXml(undefined, withRate('INR', '0.0000')))).toEqual({
      ok: false,
      reason: 'rate for INR is 0.0000: a non-positive rate',
    });
  });

  it('🔴 RED CONTROL — a table WITHOUT INR is refused', () => {
    expect(parseEcbDaily(ecbXml(undefined, without('INR')))).toEqual({ ok: false, reason: 'the table lacks INR' });
  });

  it('every other malformed shape is refused with its own reason', () => {
    const cases: [string, string, RegExp][] = [
      ['a negative rate', ecbXml(undefined, withRate('USD', '-1.1732')), /USD is -1\.1732: a non-positive rate/],
      ['a rate that is not a decimal', ecbXml(undefined, withRate('GBP', 'N/A')), /GBP is "N\/A", not a decimal/],
      ['USD missing', ecbXml(undefined, without('USD')), /lacks USD/],
      ['GBP missing', ecbXml(undefined, without('GBP')), /lacks GBP/],
      ['a currency twice', ecbXml(undefined, [...FIXTURE_ROWS, { currency: 'USD', rate: '1.2' }]), /USD appears twice/],
      ['the base quoting itself', ecbXml(undefined, [...FIXTURE_ROWS, { currency: 'EUR', rate: '1' }]), /quotes EUR/],
      ['a code that is not ISO 4217', ecbXml(undefined, [...FIXTURE_ROWS, { currency: 'usd', rate: '1' }]), /not an ISO 4217 code/],
      ['no Cube time', ecbXml().replace(/<Cube time='[^']*'>/, '<Cube>'), /no Cube time/],
      ['the history file (two dated Cubes)', ecbXml().replace('</Cube>\n\t</Cube>', "</Cube>\n<Cube time='2026-09-24'></Cube>\n\t</Cube>"), /2 Cube time elements/],
      ['a date that is not a day', ecbXml('2026-02-30'), /not a calendar date/],
      ['an HTML error page', '<html><body>Service Unavailable</body></html>', /no Cube time/],
    ];
    for (const [name, xml, reason] of cases) {
      const r = parseEcbDaily(xml);
      expect(r.ok, name).toBe(false);
      expect(r.ok ? '' : r.reason, name).toMatch(reason);
    }
  });
});

describe('refreshFxRates — a good table is cached, and on ANY failure the last good one stays', () => {
  it('caches exactly the vector\'s `response`, fetched with a bound, and the row says so', async () => {
    const kv = new FakeKv();
    const { impl, calls } = ecbAnswering(ecbXml());
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS });
    expect(row).toEqual({ target: 'ecb', ok: true, detail: `cached ${VECTOR.response.asOf}: 7 currencies` });
    expect(JSON.parse(kv.store.get(FX_KV_KEY) as string)).toEqual(VECTOR.response);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ECB_DAILY_URL);
    // The bound is really passed, not merely declared.
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('🔴 RED CONTROL — a zero-rate table is refused and the last good table is untouched', async () => {
    const { kv, lastGood } = kvWithLastGood();
    const { impl } = ecbAnswering(ecbXml(undefined, withRate('INR', '0')));
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS });
    expect(row.ok).toBe(false);
    expect(row.detail).toBe('refused: rate for INR is 0: a non-positive rate; still serving 2026-09-24');
    expect(kv.store.get(FX_KV_KEY)).toBe(lastGood);
    expect(kv.puts).toEqual([]);
  });

  it('🔴 RED CONTROL — a table without INR is refused and the last good table is untouched', async () => {
    const { kv, lastGood } = kvWithLastGood();
    const { impl } = ecbAnswering(ecbXml(undefined, without('INR')));
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS });
    expect(row).toEqual({ target: 'ecb', ok: false, detail: 'refused: the table lacks INR; still serving 2026-09-24' });
    expect(kv.store.get(FX_KV_KEY)).toBe(lastGood);
  });

  it('🔴 a TIMEOUT is a failed row and the last good value — it does not throw and it does not hang', async () => {
    // An upstream that accepts the request and never answers. Without the
    // AbortSignal this promise never settles and the test times out; with it the
    // signal fires after 25 ms and the refusal names the timeout.
    const { kv, lastGood } = kvWithLastGood();
    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const row = await refreshFxRates(envWith(kv), { fetchImpl: hanging, timeoutMs: 25, nowMs: FETCHED_AT_MS });
    expect(row.ok).toBe(false);
    expect(row.detail).toMatch(/^refused: no answer: TimeoutError/);
    expect(row.detail).toMatch(/still serving 2026-09-24$/);
    expect(kv.store.get(FX_KV_KEY)).toBe(lastGood);
  });

  it('a non-2xx answer is refused, whatever its body says', async () => {
    const { kv, lastGood } = kvWithLastGood();
    const { impl } = ecbAnswering(ecbXml(), 503);
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS });
    expect(row).toEqual({ target: 'ecb', ok: false, detail: 'refused: HTTP 503; still serving 2026-09-24' });
    expect(kv.store.get(FX_KV_KEY)).toBe(lastGood);
  });

  it('with nothing cached, a failure says there is no table', async () => {
    const kv = new FakeKv();
    const { impl } = ecbAnswering('', 500);
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS });
    expect(row.detail).toBe('refused: HTTP 500; no table cached');
    expect(kv.store.has(FX_KV_KEY)).toBe(false);
  });

  it('no CONFIG_KV binding is a failed row — and NO request goes out', async () => {
    const { impl, calls } = ecbAnswering(ecbXml());
    const row = await refreshFxRates(envWith(undefined), { fetchImpl: impl });
    expect(row).toEqual({ target: 'ecb', ok: false, detail: 'no CONFIG_KV binding: nowhere to keep the table' });
    expect(calls).toEqual([]);
  });

  it('an OLDER fix never replaces a newer one', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    const { impl } = ecbAnswering(ecbXml('2026-09-24'));
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS });
    expect(row.ok).toBe(true);
    expect(row.detail).toMatch(/older than the kept one: still serving 2026-09-25/);
    expect(kv.puts).toEqual([]);
  });

  it('the SAME fix is not written again — a weekend costs no KV write', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    const { impl } = ecbAnswering(ecbXml());
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS + 2 * 86_400_000 });
    expect(row).toEqual({ target: 'ecb', ok: true, detail: 'unchanged: still serving 2026-09-25, 7 currencies' });
    expect(kv.puts).toEqual([]);
  });

  it('an upstream whose newest fix is older than the longest holiday gap is a FAILED row', async () => {
    // Five days back is the most a TARGET closure explains at the 06:00 read (the
    // Tuesday after Easter); a sixth means publication stopped or the document
    // froze, and a green row every night would hide it.
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    const { impl } = ecbAnswering(ecbXml());
    const asOfMs = Date.parse(`${VECTOR.response.asOf}T00:00:00Z`);
    const edge = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: asOfMs + FX_MAX_FIX_GAP_DAYS * 86_400_000 + 6 * 3_600_000 });
    expect(edge.ok).toBe(true);
    const late = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: asOfMs + (FX_MAX_FIX_GAP_DAYS + 1) * 86_400_000 + 6 * 3_600_000 });
    expect(late.ok).toBe(false);
    expect(late.detail).toMatch(/newest fix is 2026-09-25, 6 days back/);
  });

  it('a KV write that fails is a failed row, and says what is still served', async () => {
    const kv = new FakeKv(true);
    const { impl } = ecbAnswering(ecbXml());
    const row = await refreshFxRates(envWith(kv), { fetchImpl: impl, nowMs: FETCHED_AT_MS });
    expect(row.ok).toBe(false);
    expect(row.detail).toMatch(/^KV write failed: .*KV put refused; no table cached$/);
  });

  it('fetchEcbDaily never throws — a thrown transport is a refusal', async () => {
    const boom = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    await expect(fetchEcbDaily(boom)).resolves.toEqual({ ok: false, reason: 'no answer: TypeError: fetch failed' });
  });
});

describe('fxRates — the nightly limb writes ITS row, under its own job', () => {
  it('🔴 a timeout on the nightly run writes a FAILED heartbeat and keeps the last good table', async () => {
    const db = realPlatformDb();
    const { kv, lastGood } = kvWithLastGood();
    const signals: unknown[] = [];
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    });
    await expect(fxRates(envWith(kv, db))).resolves.toBeUndefined();
    const rows = db.rows('SELECT target, ok, detail FROM cron_heartbeat WHERE job = ?', FX_RATES_JOB);
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('ecb');
    expect(rows[0].ok).toBe(0);
    expect(String(rows[0].detail)).toMatch(/TimeoutError.*still serving 2026-09-24/);
    expect(kv.store.get(FX_KV_KEY)).toBe(lastGood);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it('a good night writes ok=1 and the table', async () => {
    // fxRates reads the wall clock (it has no nowMs seam), so pin Date to the
    // fixture's fetch instant. Unpinned, this case went red the day the
    // fixture's ECB fix (2026-09-25) grew older than FX_MAX_FIX_GAP_DAYS.
    vi.useFakeTimers({ toFake: ['Date'], now: FETCHED_AT_MS });
    const db = realPlatformDb();
    const kv = new FakeKv();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
      String(input) === ECB_DAILY_URL ? Promise.resolve(new Response(ecbXml())) : Promise.reject(new TypeError('unexpected')),
    );
    await fxRates(envWith(kv, db));
    const [row] = db.rows('SELECT ok, detail FROM cron_heartbeat WHERE job = ?', FX_RATES_JOB);
    expect(row.ok).toBe(1);
    expect(parseStoredFxTable(kv.store.get(FX_KV_KEY) ?? null)?.rates).toEqual(VECTOR.response.rates);
  });
});

describe('GET /v1/fx/latest — public, edge-ceilinged, cached, and never an empty 200', () => {
  function call(kv: FakeKv, limiter: FakeLimiter | undefined, query = '') {
    const req = new Request(`https://platform.nikatru.com/v1/fx/latest${query}`, {
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
    });
    Object.defineProperty(req, 'cf', { value: { colo: 'BOM', asn: 64500 } });
    const env = { CONFIG_KV: kv, FX_CEILING_LIMITER: limiter } as unknown as Env;
    return app.fetch(req, env);
  }

  it('serves the vector\'s `response` byte for byte, with an hour\'s cache', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    const limiter = new FakeLimiter();
    const res = await call(kv, limiter);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=3600');
    expect(await res.json()).toEqual(VECTOR.response);
    // The ceiling is keyed on the edge, never on anything the caller sent.
    expect(limiter.keys).toEqual(['edge:BOM:64500']);
  });

  it('a refused ceiling is a 429 and costs no KV read', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    const res = await call(kv, new FakeLimiter(false), '?cb=1');
    expect(res.status).toBe(429);
    expect(kv.reads).toEqual([]);
  });

  it('no table yet is a 503 that is not cached — never a `{}` that reads as a table', async () => {
    const res = await call(new FakeKv(), new FakeLimiter());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'fx_unavailable' });
  });

  it('a kept value that is not a valid table is a 503 too', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify({ ...VECTOR.response, rates: { ...VECTOR.response.rates, INR: 0 } }));
    expect((await call(kv, new FakeLimiter())).status).toBe(503);
  });

  it('an unbound ceiling fails OPEN, like every limiter on this Worker', async () => {
    const kv = new FakeKv();
    kv.store.set(FX_KV_KEY, JSON.stringify(VECTOR.response));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call(kv, undefined)).status).toBe(200);
  });
});

describe('the vector is internally consistent — its expectations follow from its own rates', () => {
  // Exact decimal arithmetic, independent of core's: each rate is a decimal
  // string, the cross goes through EUR, and the rounding is half to even. An
  // edited rate with an unedited expectation is red HERE as well as in Dart.
  const DIGITS: Record<string, number> = { JPY: 0 };
  const digits = (c: string) => DIGITS[c] ?? 2;
  const dec = (v: number): [bigint, bigint] => {
    const [int, frac = ''] = String(v).split('.');
    return [BigInt(int + frac), 10n ** BigInt(frac.length)];
  };
  const perEuro = (c: string): [bigint, bigint] => (c === 'EUR' ? [1n, 1n] : dec(VECTOR.response.rates[c]));
  const halfEven = (n: bigint, d: bigint): bigint => {
    const q = n / d;
    const twice = (n - q * d < 0n ? q * d - n : n - q * d) * 2n;
    const away = n < 0n ? -1n : 1n;
    if (twice > d || (twice === d && q % 2n !== 0n)) return q + away;
    return q;
  };

  it('every conversion row re-derives to its expected minor units', () => {
    expect(VECTOR.conversions.length).toBeGreaterThan(0);
    for (const c of VECTOR.conversions) {
      const [tn, td] = perEuro(c.to);
      const [fn, fd] = perEuro(c.from.currency);
      const n = BigInt(c.from.minor_units) * tn * fd * 10n ** BigInt(digits(c.to));
      const d = td * fn * 10n ** BigInt(digits(c.from.currency));
      expect(Number(halfEven(n, d)), `${c.from.currency}→${c.to}`).toBe(c.expect.minor_units);
      expect(c.expect.currency).toBe(c.to);
    }
  });
});
