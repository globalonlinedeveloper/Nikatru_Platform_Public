// ─────────────────────────────────────────────────────────────────────────────
// check-jwks-error-rate.test.mjs — tooling/ops/check-jwks-error-rate.mjs goes
// RED when clients get the JWKS as a 5xx, stays GREEN on the shield's own
// subrequest 504s, and says "could not look" rather than green when it could not.
//
// ⏱ 2026-09-30 · lane fix-auth-jwks-504. The first case is the red control for
// the misreading this detector exists to prevent: 879 Cache API "504s" a day,
// with not one client 5xx among them. No case reaches the network: every fetch
// is an injected stub.
//
// Run:  node --test tooling/ci/test/check-jwks-error-rate.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST,
  JWKS_PATH,
  MAX_5XX_RATE,
  MAX_STALE_STARTS_PER_DAY,
  MIN_SAMPLE,
  REVALIDATE_UA,
  ROW_LIMIT,
  judge,
  run,
  tally,
} from '../../ops/check-jwks-error-rate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const ZONE_ID = 'zone-id-1';
const noSleep = async () => {};
const env = { CLOUDFLARE_API_TOKEN: 'test-token' };
const NOW = new Date('2026-09-30T20:00:00Z');

const row = (date, requestSource, edgeResponseStatus, count, userAgent = '') => ({
  count,
  dimensions: { date, requestSource, edgeResponseStatus, userAgent },
});

/** 2026-09-30 as measured: eyeball reads all 200, and the shield's Cache API
 *  lookups of an expired entry logged as 504 (the phantom). */
const MEASURED = [
  row('2026-09-30', 'eyeball', 200, 1202),
  row('2026-09-30', 'edgeWorkerFetch', 200, 2047),
  row('2026-09-30', 'edgeWorkerCacheAPI', 204, 744),
  row('2026-09-30', 'edgeWorkerCacheAPI', 504, 735),
  row('2026-09-30', 'edgeWorkerCacheAPI', 200, 487),
  row('2026-09-30', 'edgeWorkerFetch', 499, 16),
];

/** A Cloudflare stub: the zone lookup and the GraphQL endpoint. */
function cloudflare({ rows = MEASURED, errors, zones = [{ id: ZONE_ID }], gqlStatus = 200 } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    if (url.includes('/zones?name=')) return new Response(JSON.stringify({ success: true, errors: [], result: zones }), { status: 200 });
    if (url.endsWith('/graphql')) {
      if (gqlStatus !== 200) return new Response('{}', { status: gqlStatus });
      const body = errors ? { data: null, errors } : { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: rows }] } }, errors: null };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not stubbed', { status: 404 });
  };
  impl.calls = calls;
  return impl;
}

async function quiet(fn) {
  const out = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: await fn(), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}

describe('only what a CLIENT got is judged', () => {
  test('🔴 the measured day — 735 Cache API 504s, no client 5xx — is GREEN, and the 504s are shown as context', async () => {
    const f = cloudflare();
    const { code, out } = await quiet(() => run({ env, fetchImpl: f, sleep: noSleep, now: NOW }));
    assert.equal(code, 0, out);
    assert.match(out, /0\/1202 client reads 5xx = 0\.00%/);
    assert.match(out, /\+735 5xx on the shield's own cache\/origin subrequests, not client answers/);
  });

  test('a rate over all request sources WOULD have read red: the phantom is real in the raw rows', () => {
    const all = MEASURED.reduce((n, r) => n + r.count, 0);
    const all5xx = MEASURED.filter((r) => r.dimensions.edgeResponseStatus >= 500).reduce((n, r) => n + r.count, 0);
    assert.ok(all5xx / all > MAX_5XX_RATE, 'the fixture must carry the misreading this detector refuses');
  });

  test('client 5xx over 1% on a day is RED, and names the day', async () => {
    const rows = [row('2026-09-29', 'eyeball', 200, 1400), row('2026-09-30', 'eyeball', 200, 980), row('2026-09-30', 'eyeball', 504, 20)];
    const { code, out } = await quiet(() => run({ env, fetchImpl: cloudflare({ rows }), sleep: noSleep, now: NOW }));
    assert.equal(code, 1, out);
    assert.match(out, /✗ 2026-09-30 {2}20\/1000 client reads 5xx = 2\.00%, over 1%/);
    assert.match(out, /✓ 2026-09-29/);
  });

  test('exactly 1% is not over it; a 520 counts as a 5xx', () => {
    assert.equal(judge(tally([row('d', 'eyeball', 200, 990), row('d', 'eyeball', 520, 10)])).code, 0);
    assert.equal(judge(tally([row('d', 'eyeball', 200, 989), row('d', 'eyeball', 520, 11)])).code, 1);
  });

  test('a day under the sample floor is shown, not judged', () => {
    const v = judge(tally([row('a', 'eyeball', 200, 1000), row('b', 'eyeball', 502, 5), row('b', 'eyeball', 200, MIN_SAMPLE - 10)]));
    assert.equal(v.code, 0);
    assert.match(v.lines.join('\n'), /b {2}5\/95 client reads 5xx — under 100 reads, not judged/);
  });
});

describe('the query asks for the one path on the one host', () => {
  test('host, path and a window of seven WHOLE UTC days (today excluded) are the variables sent', async () => {
    const f = cloudflare();
    await quiet(() => run({ env, fetchImpl: f, sleep: noSleep, now: NOW }));
    const gql = f.calls.find((c) => c.url.endsWith('/graphql'));
    assert.equal(gql.body.variables.host, HOST);
    assert.equal(gql.body.variables.path, JWKS_PATH);
    assert.equal(gql.body.variables.zone, ZONE_ID);
    // NOW is 2026-09-30T20:00Z: the partial 09-30 and the partial 09-23 are both out.
    assert.equal(gql.body.variables.until, '2026-09-30T00:00:00.000Z');
    assert.equal(gql.body.variables.since, '2026-09-23T00:00:00.000Z');
    assert.match(gql.body.query, /requestSource/);
    assert.match(gql.body.query, /userAgent/);
    assert.match(gql.body.query, new RegExp(`limit: ${ROW_LIMIT}\\b`));
  });

  test('the revalidation User-Agent is the one the shield sends', () => {
    const src = readFileSync(join(REPO, 'services', 'edge-shield', 'src', 'index.ts'), 'utf8');
    const m = /export const REVALIDATE_UA = '([^']+)';/.exec(src);
    assert.ok(m, 'services/edge-shield/src/index.ts no longer declares REVALIDATE_UA');
    assert.equal(m[1], REVALIDATE_UA);
  });
});

describe('🔴 a STALE serve hides an outage behind a 200, so it is counted on its own', () => {
  const day = (staleStarts, status = 503) => [
    row('2026-09-29', 'eyeball', 200, 1400),
    row('2026-09-29', 'edgeWorkerFetch', status, staleStarts, REVALIDATE_UA),
    row('2026-09-29', 'edgeWorkerFetch', 200, 300, REVALIDATE_UA),
  ];

  test('more than the daily allowance of failed shield revalidations is RED, though every client got a 200', async () => {
    const rows = day(MAX_STALE_STARTS_PER_DAY + 1);
    const { code, out } = await quiet(() => run({ env, fetchImpl: cloudflare({ rows }), sleep: noSleep, now: NOW }));
    assert.equal(code, 1, out);
    assert.match(out, /✗ 2026-09-29 {2}6 failed shield revalidations/);
    assert.match(out, /0\/1400 client reads 5xx/);
  });

  test('a deadline abort (499) and no status (0) count as failed revalidations too', () => {
    for (const status of [499, 0, 520]) {
      assert.equal(tally(day(MAX_STALE_STARTS_PER_DAY + 1, status))[0].staleStarts, MAX_STALE_STARTS_PER_DAY + 1);
    }
  });

  test('up to the allowance is shown, not reported', () => {
    const v = judge(tally(day(MAX_STALE_STARTS_PER_DAY)));
    assert.equal(v.code, 0);
    assert.match(v.lines.join('\n'), /5 failed shield revalidation\(s\)/);
  });

  test('a 5xx subrequest from any OTHER caller is context, never a stale start', () => {
    const rows = [
      row('2026-09-29', 'eyeball', 200, 1400),
      row('2026-09-29', 'edgeWorkerFetch', 503, 50, 'GlitchTip/6.2.6'),
      row('2026-09-29', 'edgeWorkerCacheAPI', 504, 900, ''),
    ];
    const [t] = tally(rows);
    assert.equal(t.staleStarts, 0);
    assert.equal(t.sub5xx, 950);
    assert.equal(judge([t]).code, 0);
  });
});

describe('COULD NOT LOOK is exit 2, never a pass', () => {
  test('no token', async () => {
    const { code, out } = await quiet(() => run({ env: {}, fetchImpl: cloudflare(), sleep: noSleep, now: NOW }));
    assert.equal(code, 2);
    assert.match(out, /CLOUDFLARE_API_TOKEN is not in the environment/);
  });

  test('a token without analytics read: the GraphQL error is named with the permission it needs', async () => {
    const errors = [{ message: "zone 'x' does not have access to the path", extensions: { code: 'authz' } }];
    const { code, out } = await quiet(() => run({ env, fetchImpl: cloudflare({ errors }), sleep: noSleep, now: NOW }));
    assert.equal(code, 2);
    assert.match(out, /Zone → Analytics → Read/);
  });

  test('an empty window — the monitor or the host stopped — is not a clean one', async () => {
    const { code, out } = await quiet(() => run({ env, fetchImpl: cloudflare({ rows: [] }), sleep: noSleep, now: NOW }));
    assert.equal(code, 2, out);
    assert.match(out, /no day in the window had 100 client reads/);
  });

  test('only subrequest rows, no eyeball reads, is not a clean window either', async () => {
    const rows = MEASURED.filter((r) => r.dimensions.requestSource !== 'eyeball');
    const { code } = await quiet(() => run({ env, fetchImpl: cloudflare({ rows }), sleep: noSleep, now: NOW }));
    assert.equal(code, 2);
  });

  test('a zone that does not resolve to exactly one', async () => {
    const { code } = await quiet(() => run({ env, fetchImpl: cloudflare({ zones: [] }), sleep: noSleep, now: NOW }));
    assert.equal(code, 2);
  });

  test('a GraphQL HTTP refusal', async () => {
    const { code } = await quiet(() => run({ env, fetchImpl: cloudflare({ gqlStatus: 403 }), sleep: noSleep, now: NOW }));
    assert.equal(code, 2);
  });

  test('an answer AT the row limit may be truncated, so it is not judged', async () => {
    const rows = Array.from({ length: ROW_LIMIT }, () => row('2026-09-29', 'eyeball', 200, 2));
    const { code, out } = await quiet(() => run({ env, fetchImpl: cloudflare({ rows }), sleep: noSleep, now: NOW }));
    assert.equal(code, 2, out);
    assert.match(out, /may be truncated/);
  });

  test('a row without a date or a count is refused, not skipped', () => {
    assert.throws(() => tally([{ count: 3, dimensions: {} }]), /without a date or a count/);
  });
});
