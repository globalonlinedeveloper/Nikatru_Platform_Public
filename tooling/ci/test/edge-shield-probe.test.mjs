// ─────────────────────────────────────────────────────────────────────────────
// edge-shield-probe.test.mjs — tooling/ops/check-edge-shield.mjs must be able to
// go RED, and must say "could not look" rather than green when it could not.
//
// ⏱ 2026-09-26 · LEAD RULING SHIELD-R1 §7, row O-BOXES-UNSHIELDED-FROM-SPIKES.
// The probe reads `x-nikatru-shield: 1` off one answer per shield route. Every
// way the shield leaves the path looks like a healthy box (the origin still
// answers), so the header is the whole signal and each case below is a way it
// could stop being read. No case reaches the network: every fetch is injected.
//
// Run:  node --test tooling/ci/test/edge-shield-probe.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  PROBES,
  SHIELD_HEADER,
  EDGE_CONFIG_REL,
  zoneRoutesOf,
  routeMatches,
  coverage,
  judge,
  run,
} from '../../ops/check-edge-shield.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const noSleep = async () => {};

/** A fetch that answers every probe with `status` and the given headers. */
const answering = (headersFor = () => ({ [SHIELD_HEADER]: '1' }), status = 403) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method });
    return new Response('x', { status, headers: headersFor(url) });
  };
  impl.calls = calls;
  return impl;
};

/** Capture console output of one run. */
async function quiet(fn) {
  const out = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    const code = await fn();
    return { code, out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'edge-shield-probe-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function fixture(cfgText) {
  const root = join(TMP, `r${seq++}`);
  if (cfgText !== null) {
    const abs = join(root, EDGE_CONFIG_REL);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, cfgText);
  } else {
    mkdirSync(root, { recursive: true });
  }
  return root;
}
const REAL_CFG = readFileSync(join(REPO, EDGE_CONFIG_REL), 'utf8');

describe('check-edge-shield — the relationship to the real routes', () => {
  test('every route the REAL wrangler.jsonc declares has a probe inside it, and every probe is inside a route', () => {
    const routes = zoneRoutesOf(REAL_CFG);
    assert.ok(routes.length >= 2, `parsed ${routes.length} route(s) — the parse is broken, not the config`);
    assert.deepEqual(coverage(routes), { unprobed: [], stray: [] });
  });

  test('the probes are the ruling’s two, and neither carries a credential', () => {
    assert.deepEqual(
      PROBES.map((p) => `${p.method} ${p.url}`),
      [
        'GET https://auth-api.nikatru.com/auth/v1/.well-known/jwks.json',
        'POST https://glitchtip.nikatru.com/api/1/envelope/',
      ],
    );
    for (const p of PROBES) {
      const h = Object.keys(p.headers ?? {}).map((k) => k.toLowerCase());
      for (const secret of ['authorization', 'apikey', 'x-sentry-auth', 'cookie']) assert.ok(!h.includes(secret), `${p.url} carries ${secret}`);
      assert.ok(!/sentry_key=|apikey=/.test(p.url), `${p.url} carries a key in its query`);
    }
  });

  test('routeMatches reads a Cloudflare route pattern: host plus path, `*` a wildcard, no scheme or query', () => {
    assert.equal(routeMatches('auth-api.nikatru.com/auth/v1/*', 'https://auth-api.nikatru.com/auth/v1/.well-known/jwks.json'), true);
    assert.equal(routeMatches('auth-api.nikatru.com/auth/v1/*', 'https://auth-api.nikatru.com/auth/v1/token?grant_type=password'), true);
    assert.equal(routeMatches('auth-api.nikatru.com/auth/v1/*', 'https://auth-api.nikatru.com/rest/v1/x'), false);
    assert.equal(routeMatches('glitchtip.nikatru.com/api/*', 'https://glitchtip.nikatru.com/api/1/envelope/'), true);
    assert.equal(routeMatches('glitchtip.nikatru.com/api/*', 'https://evil.example/glitchtip.nikatru.com/api/1/'), false);
    assert.equal(routeMatches('glitchtip.nikatru.com/api/*', 'https://glitchtipXnikatru.com/api/1/'), false);
  });
});

describe('check-edge-shield — the verdict', () => {
  test('GREEN (0) when every probe answers with the header, whatever the status', async () => {
    const fetchImpl = answering(() => ({ [SHIELD_HEADER]: '1' }), 403);
    const { code, out } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep }));
    assert.equal(code, 0, out);
    assert.equal(fetchImpl.calls.length, PROBES.length);
    assert.match(out, /in path on all 2 route\(s\)/);
  });

  test('🔴 RED (1) — "shield not in path" — when ONE probe answers without the header', async () => {
    const fetchImpl = answering((url) => (url.includes('glitchtip') ? {} : { [SHIELD_HEADER]: '1' }), 403);
    const { code, out } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep }));
    assert.equal(code, 1, out);
    assert.match(out, /Box B crash intake .* NO x-nikatru-shield header — SHIELD NOT IN PATH/);
    assert.match(out, /1 of 2 probe\(s\) answered WITHOUT the shield: shield not in path/);
  });

  test('RED when the header is present with another value', () => {
    const v = judge(PROBES[0], new Response('', { status: 200, headers: { [SHIELD_HEADER]: '0' } }));
    assert.equal(v.ok, false);
    assert.match(v.line, /x-nikatru-shield: "0"/);
  });

  test('a 5xx from a box that is down still passes through the shield, and that is GREEN here', async () => {
    // The box's health is status.mjs's question; this one is only "is the shield in path".
    const fetchImpl = answering(() => ({ [SHIELD_HEADER]: '1' }), 530);
    const { code, out } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep }));
    assert.equal(code, 0, out);
  });

  test('COULD NOT LOOK (2), never green, when a probe never answers after the bounded retry', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n++;
      throw new TypeError('fetch failed');
    };
    const { code, out } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep }));
    assert.equal(code, 2, out);
    assert.ok(n > PROBES.length, `the transport failure was not retried (${n} calls)`);
    assert.match(out, /never answered; nothing is known about them\. Not a pass\./);
  });

  test('ops mode judges the FIRST answer: a missing header is RED at once, not re-asked', async () => {
    const fetchImpl = answering(() => ({}), 200);
    const { code } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep }));
    assert.equal(code, 1);
    assert.equal(fetchImpl.calls.length, PROBES.length);
  });

  test('--settle (the deploy smoke): a route still reaching the edge is re-asked, and GREEN once it arrives', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n++;
      return new Response('', { status: 200, headers: n <= 2 ? {} : { [SHIELD_HEADER]: '1' } });
    };
    const { code, out } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep, settle: true }));
    assert.equal(code, 0, out);
    assert.ok(n > PROBES.length, `nothing was re-asked (${n} calls)`);
  });

  test('🔴 --settle never turns "not in path" into "could not look": every answer unmarked is RED (1)', async () => {
    const fetchImpl = answering(() => ({}), 403);
    const { code, out } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep, settle: true }));
    assert.equal(code, 1, out);
    assert.match(out, /SHIELD NOT IN PATH/);
    assert.ok(fetchImpl.calls.length > PROBES.length, 'settle asked only once');
  });

  test('a RED probe outranks an unanswered one: 1, not 2', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('glitchtip')) throw new TypeError('fetch failed');
      return new Response('', { status: 200 });
    };
    const { code } = await quiet(() => run({ root: fixture(REAL_CFG), fetchImpl, sleep: noSleep }));
    assert.equal(code, 1);
  });
});

describe('check-edge-shield — COVERAGE LOST before any request', () => {
  const never = async () => {
    throw new Error('no request may be sent when coverage is lost');
  };

  test('no wrangler.jsonc', async () => {
    const { code, out } = await quiet(() => run({ root: fixture(null), fetchImpl: never, sleep: noSleep }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — services\/edge-shield\/wrangler\.jsonc does not exist/);
  });

  test('a config with no route', async () => {
    const cfg = REAL_CFG.replace(/"routes": \[[\s\S]*?\],/, '"routes": [],');
    const { code, out } = await quiet(() => run({ root: fixture(cfg), fetchImpl: never, sleep: noSleep }));
    assert.equal(code, 2, out);
    assert.match(out, /declares no route/);
  });

  test('a route added with no probe inside it', async () => {
    const cfg = REAL_CFG.replace(
      '"routes": [',
      '"routes": [\n    { "pattern": "ntfy.nikatru.com/*", "zone_name": "nikatru.com" },',
    );
    const { code, out } = await quiet(() => run({ root: fixture(cfg), fetchImpl: never, sleep: noSleep }));
    assert.equal(code, 2, out);
    assert.match(out, /route ntfy\.nikatru\.com\/\* has no probe inside it/);
  });

  test('a route that moved, leaving a probe outside every route', async () => {
    const cfg = REAL_CFG.replace('glitchtip.nikatru.com/api/*', 'glitchtip.nikatru.com/api/0/*');
    const { code, out } = await quiet(() => run({ root: fixture(cfg), fetchImpl: never, sleep: noSleep }));
    assert.equal(code, 2, out);
    assert.match(out, /probe https:\/\/glitchtip\.nikatru\.com\/api\/1\/envelope\/ falls inside no route/);
  });
});

describe('check-edge-shield — where it runs', () => {
  const wf = (name) => readFileSync(join(REPO, '.github', 'workflows', name), 'utf8');

  /** The lines of one top-level job, by its key. */
  const job = (text, key) => {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l === `  ${key}:`);
    assert.ok(at >= 0, `no job ${key}`);
    const end = lines.findIndex((l, i) => i > at && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
    return lines.slice(at, end === -1 ? undefined : end).join('\n');
  };

  test('ops-watch runs it as its own job, which the alert job needs, and turns 1 and 2 into distinct annotations', () => {
    const own = job(wf('ops-watch.yml'), 'edge-shield');
    const at = own.indexOf('node tooling/ops/check-edge-shield.mjs');
    assert.ok(at >= 0, 'the edge-shield job does not run the probe');
    const step = own.slice(own.lastIndexOf('- name:', at), own.indexOf('exit "$code"', at));
    // …and a red job reaches the durable issue only if the alert job needs it.
    const alert = job(wf('ops-watch.yml'), 'alert');
    assert.match(alert, /needs:\s*\n?\s*\[[^\]]*\bedge-shield\b[^\]]*\]/);
    assert.match(step, /node tooling\/ops\/check-edge-shield\.mjs\n\s+code=\$\?/);
    assert.match(step, /"\$code" -eq 2/);
    assert.match(step, /"\$code" -eq 1/);
    assert.match(step, /shield not in path/i);
  });

  test('deploy-workers smokes the shield with it after the deploy, before the record', () => {
    const shield = job(wf('deploy-workers.yml'), 'edge-shield');
    const deploy = shield.indexOf('id: deploy');
    const smoke = shield.indexOf('node tooling/ops/check-edge-shield.mjs --settle');
    const record = shield.indexOf('node tooling/ci/record-deployment.mjs edge-shield');
    assert.ok(deploy >= 0 && smoke > deploy && record > smoke, `order deploy ${deploy} < smoke ${smoke} < record ${record}`);
  });
});
