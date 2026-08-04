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
// Usage:
//   node tooling/ops/post-deploy-smoke.mjs \
//     --url https://subly.nikatru.com/version.json --field build_number --expect 123
//   node tooling/ops/post-deploy-smoke.mjs \
//     --url https://api.nikatru.com/v1/health --field build --expect <sha> --require-ok
//
// Offline testing: --fixture <file> reads a JSON array of fake responses
// (`[{status, body}]`, consumed one per attempt) so every branch of the decision
// is exercised with no network. It prints a loud banner, so its presence in a
// real CI log is unmistakable.
//
// Exit 0 = the live surface answered at the expected build.
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
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const url = flag(process.argv, '--url');
  const field = flag(process.argv, '--field');
  const expected = flag(process.argv, '--expect');
  const requireOk = process.argv.includes('--require-ok');
  const fixture = flag(process.argv, '--fixture');

  if (!url || !field || !expected) {
    console.error('✗ usage: post-deploy-smoke.mjs --url <u> --field <f> --expect <v> [--require-ok] [--fixture <json>]');
    process.exit(2);
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
