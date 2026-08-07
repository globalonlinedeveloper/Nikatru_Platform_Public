#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// post-deploy-smoke.mjs — a deploy is not trusted until the LIVE surface answers
// at the build that was just shipped. [pipeline 14]O-7
//
// 🔴 THE MEASURED STATE THIS REPLACES. The last step of every deploy job was
// `record-deployment.mjs` — a step that WRITES a claim. No workflow performed a
// single request against a surface it had just deployed. So a deploy that
// uploaded nothing, uploaded to the wrong project, or was silently rolled back
// by the platform produced a green tick AND a deployment record naming the new
// SHA, and the first person to notice would have been a user.
//
// ⚠️ THIS IS NOT A SECOND SMOKE. Before writing it, `git log` and
// `git grep -i smoke` over `origin/main` were checked for stage 9's [9]R-13
// launch smoke: it had not landed (2026-08-03). If R-13 arrives later it must
// BUILD ON this script rather than add a second probe over the same deploy —
// two smokes over one deploy is exactly the drift these guards exist to prevent,
// because they disagree in the one way that reports "clean": which surface they
// actually looked at.
//
// ── WHAT IT JOINS ON, AND WHY IT IS NOT THE SHA EVERYWHERE ───────────────────
// The joinable key differs per surface, and writing the one you WISH were there
// is how a check ends up asserting nothing:
//
//   WEB (Cloudflare Pages).  `subly.nikatru.com/version.json` carries
//     `build_number`, and `deploy-web.yml` builds with
//     `--build-number=${{ github.run_number }}`. The SHA is NOT in version.json
//     — it appears only inside `main.dart.js` — so the joinable key is the RUN
//     NUMBER. Asserting on a SHA here would mean asserting on a field that does
//     not exist, which fails for the wrong reason on a good deploy and would be
//     "fixed" by deleting the assertion.
//
//   WORKERS.  `/v1/health` now carries `build`, threaded from `--var
//     RELEASE:${{ github.sha }}`. It is a SEPARATE field from `version`, which
//     is the literal "v1" API-contract version and can never equal a build
//     identity. Overloading the two would have made this check pass forever.
//
// ── FAIL CLOSED ──────────────────────────────────────────────────────────────
// A non-200, a body that will not parse, a missing field, a mismatched value, a
// timeout, or a missing argument are ALL failures. "I could not tell" must never
// read as "it is fine" — that is the whole reason the previous state (no check
// at all) looked healthy for every deploy this factory has ever made.
//
// ── THE ONE ARBITRARY CONSTANT, DECLARED AS ARBITRARY ────────────────────────
// A CDN does not serve the new asset at the instant the upload API returns, so a
// single immediate request would fail on healthy deploys and teach people to
// re-run the job until it passes — which is worse than no check. So there is a
// bounded retry, and both numbers below are JUDGEMENT, recorded as judgement:
// neither is a vendor SLA and neither may be cited as one. They are two
// constants, changed deliberately.
//
//   ATTEMPTS = 6, GAP_MS = 10_000  →  a ceiling of roughly one minute.
//   Long enough that propagation is not read as a bad deploy; short enough that
//   a genuinely bad deploy is reported inside the same job rather than after a
//   coffee. If a deploy routinely needs more than this, the right response is to
//   find out why, not to raise the number.
//
// ── THE EDGE CACHE LIMB — [14]O-8, `revert.mitigation.force-update` ──────────
// The force-update kill-switch is the ONLY channel that reaches an already
// installed client, and on the web channel it is carried entirely by the HTTP
// cache: [ADR 023] rejected the service worker DELIBERATELY, so there is no
// client-side update machinery at all. A client served a stale
// `flutter_bootstrap.js` runs the previous build and reports the previous
// version HONESTLY — it is the one client the gate cannot see.
//
// 🔴 THIS IS THE HALF OF THE RESPONSE THAT WAS MISSING, AND ITS ABSENCE IS THE
// WHOLE POINT. `tooling/ci/assert-web-cache-policy.mjs` reads the DECLARED
// policy in `apps/subly/web/_headers` on every push and cannot fetch: CI holds
// no Cloudflare credential, a fetching guard could not fail offline or on a
// fork, and it would turn a deploy-time property into a network dependency of
// every build. That guard says so in its own header and names this file as
// where the live assertion belongs.
//
// It belongs here because the gap it closes is not in the repository. The
// measured failure was the `nikatru.com` zone's Browser Cache TTL of 14400
// stamping `public, max-age=14400, must-revalidate` OVER the origin header on
// anything the edge caches by extension — `.js` and `.css`, which is exactly
// why HTML was unaffected and these two files were not. Four hours in which a
// raised `min_supported_version` cannot reach a client. Nothing in this
// repository changed, and nothing in this repository could have seen it: a zone
// setting or a Cache Rule can re-introduce it at any time, from outside the
// tree, with every offline guard still green. That is what "the property that
// failed here was never 'the file is right' — it was 'somebody looked'" means.
//
// ⚠️ THE EXPECTATION IS THE DECLARED REQUIREMENT, NOT TODAY'S MEASUREMENT.
// `_headers` declares `public, max-age=0, must-revalidate` on every stable-named
// URL, and the property that actually protects the kill-switch is the one this
// limb asserts: THE CLIENT MUST REVALIDATE BEFORE REUSING THE ENTRY POINT.
// So the directives are parsed and the freshness lifetime is required to be
// zero — `no-cache`/`no-store` also satisfy it, `immutable` never can. Exact
// string equality was rejected: it would fail on an equally-correct header the
// edge reordered, and that is the kind of red that gets a check deleted.
// Writing down whatever production happens to serve today would have produced a
// guard that passes by construction.
//
// ⚠️ A BAD Cache-Control IS NOT RETRYABLE. It is configuration — a zone setting
// or a Cache Rule — and it is identical one second after the deploy and one
// hour after. Waiting on it could only turn a real divergence into a slower
// real divergence. A missing or non-JavaScript entry point IS retryable, for
// the same reason the build mismatch above is: that is what propagation looks
// like from outside.
//
// Usage:
//   node tooling/ops/post-deploy-smoke.mjs \
//     --url https://subly.nikatru.com/version.json --field build_number --expect 123
//   node tooling/ops/post-deploy-smoke.mjs \
//     --url https://api.nikatru.com/v1/health --field build --expect <sha> --require-ok
//
// The edge cache limb runs when — and only when — the smoked URL is the WEB
// channel's join point (`/version.json`, which is what `deploy-web.yml`
// invokes). Worker health routes serve no Cache-Control at all and are governed
// by no `_headers` file, so applying the rule there would fail every Workers
// deploy for a policy that does not apply to it. That predicate is a coupling
// to the caller and is therefore ASSERTED AGAINST THE REAL WORKFLOW in
// `tooling/ci/test/post-deploy-smoke.test.mjs` — if the deploy stops smoking
// `/version.json`, that test goes red rather than this limb going quiet, which
// is the failure mode every guard in this repository is written against.
//
// Offline testing: --fixture <file> reads a JSON array of fake responses
// (`[{status, body, headers}]`, consumed one per attempt) so every branch of the
// decision is exercised with no network. --cache-fixture <file> reads a JSON
// object keyed by PATHNAME (`{"/main.dart.js": {status, headers}}`) for the edge
// cache limb; without it the limb is skipped under --fixture and says so, since
// it has no network to look at. Both print a loud banner, so their presence in a
// real CI log is unmistakable.
//
// Exit 0 = the live surface answered at the expected build, and the edge serves
//          the entry points revalidating.
// Exit 1 = it did not, or could not be read.  Exit 2 = bad invocation.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ATTEMPTS = 6;
const GAP_MS = 10_000;
const TIMEOUT_MS = 15_000;

/** `indexOf` returns -1 when absent, and -1 + 1 === 0 silently selects argv[0].
 *  That exact off-by-one shipped in assert-gate-passed.mjs and blocked both
 *  production deploys with the SHA plainly in the command line. Never repeat it. */
export function flag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] ?? null;
}

/**
 * The DECISION, kept pure so every branch is testable without a network.
 *
 * `expected` is compared as a STRING on both sides: `version.json` reports
 * `build_number` as a number in some builds and a string in others, and `123 !==
 * '123'` would fail a perfectly good deploy — the kind of red that gets a check
 * deleted rather than fixed.
 */
export function judge({ status, body, field, expected }) {
  if (status !== 200) {
    return { ok: false, retry: true, reason: `HTTP ${status} — the surface did not answer` };
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // NOT retryable: a 200 carrying non-JSON is a served page, not a slow one.
    // Pages answers an unknown path with the SPA shell, so this is the exact
    // shape of "the asset is not there" and must not be waited out.
    return { ok: false, retry: false, reason: 'the surface answered 200 with a body that is not JSON — an SPA shell answers like this, so this is a MISSING asset, not a slow one' };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, retry: false, reason: `the body parsed to ${typeof parsed}, not an object` };
  }
  if (!(field in parsed)) {
    // RETRYABLE for the same reason as the empty case below: a surface still
    // serving the PREVIOUS build answers in that build's shape, and if the field
    // was introduced by the deploy under test the key is simply absent until
    // propagation finishes.
    return {
      ok: false,
      retry: true,
      reason: `the body has no \`${field}\` field (keys: ${Object.keys(parsed).join(', ') || 'none'}). If this persists to the ceiling, the deploy does not thread a build identity at all, which is the state this check exists to end.`,
    };
  }
  const actual = parsed[field];
  if (actual === null || actual === undefined || String(actual) === '') {
    // ── 🔴 RETRYABLE SINCE 2026-08-04 — IT WAS RETURNING A FALSE RED ──────────
    // This branch returned `retry: false`, and on run 30934945633 it failed the
    // `platform` deploy in 240 MILLISECONDS: one attempt, no wait, against a
    // ceiling the message still advertised as "6 attempts 10s apart". Eighty
    // seconds later the same URL served `build:2cd7b7ac…`, the exact SHA the
    // deploy had shipped. THE DEPLOY WAS GOOD AND THIS CHECK CALLED IT BAD.
    //
    // Why empty is the propagating state, specifically: the version still being
    // served is the one deployed WITHOUT `--var RELEASE`, and a Worker with no
    // RELEASE var answers `build: null` — key present, value empty. So "empty"
    // is not evidence of a bad deploy; it is evidence of the OLD deploy.
    //
    // This branch was violating the rule the mismatch branch below already
    // states in this same file: propagation and failure "are distinguished by
    // whether it resolves inside the ceiling, which is the only honest way to
    // tell them apart from outside." That is just as true of an empty value as
    // of a wrong one.
    //
    // ⚠️ THE FAILURE IS NOT WEAKENED, ONLY DELAYED. A deploy that genuinely
    // never threads RELEASE still exits 1 — after ~60s instead of instantly.
    // Buying back a real false red for one minute on a real failure is the
    // trade, and it is deliberate.
    return {
      ok: false,
      retry: true,
      reason: `\`${field}\` is empty — the live surface is still serving a build that carries no identity. If this persists to the ceiling, the deploy did not thread a build identity.`,
    };
  }
  if (String(actual) !== String(expected)) {
    // RETRYABLE: this is what a CDN still serving the previous asset looks like,
    // and it is also what a failed deploy looks like. They are distinguished by
    // whether it resolves inside the ceiling, which is the only honest way to
    // tell them apart from outside.
    return { ok: false, retry: true, reason: `\`${field}\` is ${JSON.stringify(actual)}, expected ${JSON.stringify(String(expected))} — the live surface is still serving a different build` };
  }
  return { ok: true, actual: String(actual) };
}

/** The `ok:true` conjunct for Worker health, kept separate: a Worker that
 *  answers with the right build and `ok:false` has deployed and is unwell, and
 *  collapsing the two would report a bad deploy as a good one. */
export function judgeOk(body) {
  try {
    return JSON.parse(body)?.ok === true;
  } catch {
    return false;
  }
}

/** The web channel's stable-named entry points, named by the register row
 *  `revert.mitigation.force-update` as the surface the kill-switch travels
 *  over. `main.dart.js` is compiled output but its NAME is stable, so it is an
 *  entry point by the rule `_headers` states: the split is by whether the name
 *  carries a hash, not by file type. `/version.json` is checked too, from the
 *  headers already in hand — it is the URL the deploy actually smokes, so the
 *  limb can never be entirely about URLs nobody looks at. */
export const WEB_ENTRY_POINTS = ['/flutter_bootstrap.js', '/main.dart.js'];

/** Only the WEB channel is governed by an `_headers` file. See the header. */
export function isWebChannelSmoke(url) {
  try {
    return new URL(url).pathname === '/version.json';
  } catch {
    return false;
  }
}

/**
 * The edge-cache DECISION, pure so every branch is testable without a network.
 *
 * `expectType` is a RegExp over content-type: Pages answers an unknown path
 * with the SPA shell at 200, so `text/html` where JavaScript belongs is the
 * exact shape of "the entry point is not there" and must not be read as a
 * header verdict at all.
 */
export function judgeCacheControl({ status, contentType, cacheControl, expectType }) {
  if (status !== 200) {
    return { ok: false, retry: true, reason: `HTTP ${status} — the entry point did not answer` };
  }
  if (expectType && !expectType.test(String(contentType ?? ''))) {
    return {
      ok: false,
      retry: true,
      reason: `content-type is ${JSON.stringify(contentType ?? null)}, which does not match ${expectType} — Pages answers a MISSING asset with the SPA shell at 200, so this is the entry point not being there`,
    };
  }
  const raw = cacheControl == null ? '' : String(cacheControl).trim();
  if (raw === '') {
    return {
      ok: false,
      retry: false,
      reason:
        'the edge returned NO Cache-Control at all — the entry point is riding on whatever the platform happens to default to, which is the exact state apps/subly/web/_headers was written to end',
    };
  }
  const directives = raw
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const num = (name) => {
    const d = directives.find((x) => x.startsWith(`${name}=`));
    if (d === undefined) return null;
    const n = Number(d.slice(name.length + 1).replace(/^"|"$/g, ''));
    return Number.isFinite(n) ? n : Number.NaN;
  };
  if (directives.includes('immutable')) {
    return {
      ok: false,
      retry: false,
      reason: `\`immutable\` on a stable-named entry point (${raw}) — it tells a browser not to revalidate even on an explicit reload, so a raised min_supported_version can never reach a client that already has this file`,
    };
  }
  // Stricter than max-age=0, and both mean "ask before reusing", which is the
  // property the kill-switch actually needs.
  if (directives.includes('no-store') || directives.includes('no-cache')) {
    return { ok: true, actual: raw };
  }
  const maxAge = num('max-age');
  const sMaxAge = num('s-maxage');
  if (maxAge === null) {
    return {
      ok: false,
      retry: false,
      reason: `Cache-Control \`${raw}\` sets no freshness lifetime — with no max-age and no no-cache a shared cache is free to heuristically freshen this file, and _headers declares max-age=0`,
    };
  }
  if (!(maxAge === 0)) {
    return {
      ok: false,
      retry: false,
      reason: `\`max-age=${maxAge}\` on a stable-named entry point (${raw}) — a client keeps the PREVIOUS build for that long and reports the previous version honestly, which is the one client the force-update gate cannot see. This is the measured 2026-08-04 failure: the nikatru.com zone's Browser Cache TTL stamping over the declared max-age=0`,
    };
  }
  if (sMaxAge !== null && sMaxAge !== 0) {
    return {
      ok: false,
      retry: false,
      reason: `\`s-maxage=${sMaxAge}\` (${raw}) — max-age=0 is overridden for shared caches, and the Cloudflare edge IS a shared cache`,
    };
  }
  return { ok: true, actual: raw };
}

async function fetchOnce(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'nikatru-post-deploy-smoke', 'cache-control': 'no-cache' },
      // A cached answer would prove the CDN remembers the OLD build, which is
      // the precise thing this check must not accept.
      cache: 'no-store',
    });
    const headers = {};
    for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
    return { status: res.status, body: await res.text(), headers };
  } finally {
    clearTimeout(t);
  }
}

const JS_TYPE = /javascript|ecmascript/i;
const JSON_TYPE = /json/i;

/**
 * Probes one URL until the entry point is SERVED (retryable) and then judges
 * the header it carries (never retryable). `get` is injected so the tests drive
 * it with no network.
 */
async function probeCache({ url, expectType, get, canned, log }) {
  let last = 'no attempt was made';
  for (let i = 0; i < ATTEMPTS; i += 1) {
    let res;
    try {
      res = await get(url);
    } catch (e) {
      last = `request failed: ${e.message}`;
      if (i < ATTEMPTS - 1 && !canned) await new Promise((r) => setTimeout(r, GAP_MS));
      continue;
    }
    const h = res.headers ?? {};
    const verdict = judgeCacheControl({
      status: res.status,
      contentType: h['content-type'],
      cacheControl: h['cache-control'],
      expectType,
    });
    if (verdict.ok) {
      log(`ok  ${url} revalidates — Cache-Control: ${verdict.actual}`);
      return true;
    }
    last = verdict.reason;
    if (!verdict.retry) break;
    if (i < ATTEMPTS - 1 && !canned) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  console.error(`✗ EDGE CACHE POLICY FAILED for ${url} — ${last}`);
  return false;
}

/**
 * The limb. Returns true when every stable-named entry point on this origin is
 * served revalidating. Fails CLOSED: a probe that cannot be read is a failure,
 * because "I could not tell" reading as "it is fine" is the state that let
 * `max-age=14400` live behind a green build.
 */
export async function assertEdgeCachePolicy({ url, smokedHeaders, get, canned }) {
  const origin = new URL(url).origin;
  const log = (m) => console.log(`    ${m}`);
  console.log(`--  edge cache policy [14]O-8 — the force-update kill-switch travels over these:`);
  const smoked = judgeCacheControl({
    status: 200,
    contentType: (smokedHeaders ?? {})['content-type'],
    cacheControl: (smokedHeaders ?? {})['cache-control'],
    expectType: JSON_TYPE,
  });
  let ok = true;
  if (smoked.ok) {
    log(`ok  ${url} revalidates — Cache-Control: ${smoked.actual}`);
  } else {
    console.error(`✗ EDGE CACHE POLICY FAILED for ${url} — ${smoked.reason}`);
    ok = false;
  }
  for (const path of WEB_ENTRY_POINTS) {
    // eslint-disable-next-line no-await-in-loop
    const good = await probeCache({ url: `${origin}${path}`, expectType: JS_TYPE, get, canned, log });
    if (!good) ok = false;
  }
  return ok;
}

async function main() {
  const url = flag(process.argv, '--url');
  const field = flag(process.argv, '--field');
  const expected = flag(process.argv, '--expect');
  const requireOk = process.argv.includes('--require-ok');
  const fixture = flag(process.argv, '--fixture');
  const cacheFixture = flag(process.argv, '--cache-fixture');

  if (!url || !field || !expected) {
    console.error('✗ usage: post-deploy-smoke.mjs --url <u> --field <f> --expect <v> [--require-ok] [--fixture <json>] [--cache-fixture <json>]');
    process.exit(2);
  }

  let cacheCanned = null;
  if (cacheFixture) {
    console.log('!!  OFFLINE CACHE FIXTURE MODE — --cache-fixture is set. This must NEVER appear in a real CI log.');
    try {
      cacheCanned = JSON.parse(readFileSync(cacheFixture, 'utf8'));
    } catch (e) {
      console.error(`✗ could not read cache fixture ${cacheFixture}: ${e.message}`);
      process.exit(2);
    }
    if (cacheCanned === null || typeof cacheCanned !== 'object' || Array.isArray(cacheCanned)) {
      console.error('✗ the cache fixture must be an object keyed by pathname');
      process.exit(2);
    }
  }

  let canned = null;
  if (fixture) {
    console.log('!!  OFFLINE FIXTURE MODE — --fixture is set. This must NEVER appear in a real CI log.');
    try {
      canned = JSON.parse(readFileSync(fixture, 'utf8'));
    } catch (e) {
      console.error(`✗ could not read fixture ${fixture}: ${e.message}`);
      process.exit(2);
    }
    if (!Array.isArray(canned) || canned.length === 0) {
      console.error('✗ the fixture must be a non-empty array of {status, body}');
      process.exit(2);
    }
  }

  let last = 'no attempt was made';
  for (let i = 0; i < ATTEMPTS; i += 1) {
    let res;
    try {
      res = canned ? (canned[Math.min(i, canned.length - 1)] ?? {}) : await fetchOnce(url);
    } catch (e) {
      // A network error is retryable exactly once per attempt like any other —
      // but it is never a pass.
      last = `request failed: ${e.message}`;
      if (i < ATTEMPTS - 1 && !canned) await new Promise((r) => setTimeout(r, GAP_MS));
      continue;
    }
    const verdict = judge({ status: res.status, body: String(res.body ?? ''), field, expected });
    if (verdict.ok) {
      if (requireOk && !judgeOk(String(res.body ?? ''))) {
        console.error(`✗ ${url} is serving build ${verdict.actual} and reports ok:false — it deployed, and it is unwell.`);
        process.exit(1);
      }
      console.log(`ok  ${url} is live at ${field}=${verdict.actual} (attempt ${i + 1}/${ATTEMPTS})`);

      // ── [14]O-8. Runs AFTER the build match, deliberately: asserting the
      // cache policy of a surface that is not yet serving this build would
      // report on the previous deploy's headers. By here the edge has been
      // proven to be serving THIS build.
      if (!isWebChannelSmoke(url)) {
        console.log(`--  edge cache policy [14]O-8 — not applicable: ${url} is not the web channel's /version.json join point, and no _headers file governs it`);
        return;
      }
      if (canned && !cacheCanned) {
        console.log('--  edge cache policy [14]O-8 — SKIPPED: --fixture is set and --cache-fixture is not, so there is no live edge to look at. This line must never appear in a real CI log.');
        return;
      }
      const get = cacheCanned
        ? async (u) => cacheCanned[new URL(u).pathname] ?? { status: 404, headers: {} }
        : fetchOnce;
      const cacheOk = await assertEdgeCachePolicy({
        url,
        smokedHeaders: cacheCanned ? (cacheCanned[new URL(url).pathname] ?? {}).headers : res.headers,
        get,
        canned: Boolean(cacheCanned),
      });
      if (!cacheOk) {
        console.error('');
        console.error('    The deploy reached production and the EDGE is serving the entry points on a');
        console.error('    policy that lets a client keep the previous build. [ADR 023] rejected the');
        console.error('    service worker deliberately, so the HTTP cache is the ENTIRE update mechanism');
        console.error('    on this channel: a client holding a stale flutter_bootstrap.js runs the old');
        console.error('    build and reports the old version honestly — the one client the force-update');
        console.error('    kill-switch cannot see. Check the zone Browser Cache TTL and any Cache Rule');
        console.error('    before touching apps/subly/web/_headers: the 2026-08-04 divergence came from');
        console.error('    the ZONE stamping over a correct origin header, not from the file.');
        // ⚠️ `process.exitCode`, NOT `process.exit(1)`. Calling exit() here races
        // the keep-alive sockets the probes just opened: on Windows it aborts
        // with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and the
        // shell sees 0xC0000409 INSTEAD OF 1 — measured, not theorised. CI is
        // ubuntu-24.04 so it would not have shown there, which is exactly why a
        // crash standing in for an exit code is worth removing: a failure that
        // reports a garbage status is one step from a failure nobody reads.
        // The exit codes above are unchanged; only this branch unwinds.
        process.exitCode = 1;
      }
      return;
    }
    last = verdict.reason;
    if (!verdict.retry) break;
    if (i < ATTEMPTS - 1 && !canned) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.error(`✗ POST-DEPLOY SMOKE FAILED for ${url} — ${last}`);
  console.error('');
  console.error('    The deploy step reported success and the live surface does not agree. Until this');
  console.error('    check existed, that disagreement had no observer at all: the last step of every');
  console.error('    deploy job WROTE a claim about what was live and nothing ever READ one.');
  console.error(`    Ceiling: ${ATTEMPTS} attempt(s) ${GAP_MS / 1000}s apart. Both are judgement, not a vendor SLA.`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
