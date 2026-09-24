#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// record-deployment.mjs — leave a machine-readable marker of what went live.
//
// "What is in production right now?" was answerable only by inference: no
// deploy recorded the SHA it shipped. CLAUDE.md is explicit that done/live/
// working must never be asserted from memory, and this is the missing half of
// that rule on the deploy side.
//
// Writes a GitHub Deployment + a success status, so the answer is queryable:
//   gh api repos/<owner>/<repo>/deployments?environment=platform --jq '.[0].sha'
//
// If this step fails the job goes red AFTER a successful deploy. That is
// deliberate and it means exactly one thing: the code shipped but we cannot say
// what shipped. Treat it as a real failure — an unrecorded deploy is the state
// this script exists to abolish.
//
// Pipeline requirement: Private/requirements/ → F-5b, and
// [pipeline 10]D-9 for the store half below.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// ── THE STORE HALF, DECIDED BEFORE THE FIRST SUBMISSION — [10]D-9 ────────────
// A web deploy has one state ("live") and a fixed URL, so a prose description
// was enough. A STORE submission is not that: it has a REVIEW STATE that is not
// "live" for most of its life, and a LISTING URL the store issues, which is the
// only address anybody can open. `--state` and `--listing-url` carry both, in
// the round-trippable encoding declared once in tooling/ci/deployment-record.mjs.
//
// Deciding this shape after the first submission would mean re-writing a record
// that is by then the ONLY copy of what happened — the console history is
// behind an account, and D-9's question gets asked at exactly the moment nobody
// can log in.
//
// 🔴 A STORE ENVIRONMENT WITHOUT A LISTING URL IS REFUSED. The channel's `kind`
// is resolved from tooling/channel-register.json rather than guessed from the
// name, so this cannot be satisfied by renaming an environment. A store record
// whose listing nobody can open is the second source of truth D-9 exists to
// prevent: it says something shipped and gives no way to look at it.
//
// 🔴 …AND A STORE THIS FACTORY CANNOT SUBMIT TO IS A THIRD CASE, added
// 2026-09-06. `submittable: false` says no lane here can submit through that
// channel — the three browser add-on rows, whose first publish is manual ([ADR
// 067] decision 8). A run that publishes the artifact and submits nothing has
// neither a review state nor a listing to give, because the store has not been
// sent anything and the listing does not exist until somebody publishes. Both
// requirements above would therefore ask for facts that cannot exist, and the
// only ways to satisfy them are fictions. Such a row records
// `--state pending_manual_publish` and no listing URL; the state is REFUSED on
// any row this factory can submit to, so it cannot become the easy way out of
// naming a real submission.
//
// Usage:
//   node tooling/ci/record-deployment.mjs <environment> [environment-url]
//   node tooling/ci/record-deployment.mjs <environment> [url] \
//        --state <in_review|live|rejected|pulled> --listing-url <url>
//   node tooling/ci/record-deployment.mjs <environment> [url] \
//        --state pending_manual_publish            # submittable:false store rows
//   node tooling/ci/record-deployment.mjs <environment> [url] --state in_review \
//        --listing-url <url> --version-code <n>    # ⏱ 2026-09-24: a row with versionCodeHighWater
//     → `version_code` joins the Deployment payload. REQUIRED on a row whose register entry
//       carries a `versionCodeHighWater` block (android-play) and REFUSED on every other row;
//       tooling/ci/read-ledger-version-code.mjs reads the largest one back for --play-floor.
//   env:  GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_SHA
//         GITHUB_API_URL — the real origin or loopback only (a test seam; see githubApiBase)
//         ⏱ 2026-09-23 · GITHUB_WORKFLOW_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT,
//         GITHUB_RUN_NUMBER — THE RUN IDENTITY. Every Actions step has them from
//         the runner. They are written into the Deployment as its `payload`
//         ({workflow, run_id, run_attempt, run_number}), and that payload is
//         what tooling/ops/check-prod-provenance.mjs binds a SUBMITTED build to
//         its run by — a time window let a dry run at the same commit borrow an
//         upload's Deployment. (A Deployment written before 2026-09-23 has no
//         payload and binds only through the dated `legacyDeploymentBindings`
//         in tooling/prod-provenance.json.) Required on a submittable channel;
//         written whenever present on every other one.
// Exit 0 = recorded.
//      1 = refused or failed: a bad record shape, a missing precondition, or a REAL
//          answer from GitHub (401, a 403 with no rate-limit signal, a 422 …).
//      2 = the DEPLOY SUCCEEDED and the record was NOT written: GitHub's rate
//          limit outlasted the bound (THE BOUND, below), or ⏱ 2026-09-23 the
//          environment is a submittable channel and the run identity above is
//          missing, so the record would bind to no run. Red on purpose.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeDescription,
  resolveEnvironment,
  STATES,
  STATE_MEANING,
  SUBMIT_TIME_STATES,
  NOT_SUBMITTED_STATES,
} from './deployment-record.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

/** A flag's value, or null. Written out rather than pulled from a dependency:
 *  this script runs at the end of a real deploy and must not be able to fail
 *  for a reason unrelated to the deploy. */
function flagValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`--${name} was given with no value`);
  return v;
}

// ── THE WRITE IS RETRIED, AND ONLY WHERE RETRYING IS HONEST ──────────────
// 🔴 A 503 ON 2026-08-17 LEFT A PUBLISHED SHA WITH NO DEPLOYMENT RECORD. The
// deploy itself succeeded; this script then failed the job, correctly, saying
// the one thing it exists to say — the code shipped and we cannot state what
// shipped. But the cause was a transient upstream error on a single POST, and
// the record for that SHA does not exist to this day.
//
// A whole-job re-run is not the remedy: by then the deploy has already
// happened, so re-running re-deploys to get a second chance at the write.
//
// WHAT IS RETRIED, AND WHAT MUST NEVER BE. 5xx and network failures only.
//   · a 5xx says "ask again"                                → retry
//   · a network error never reached GitHub at all           → retry
//   · a 4xx is a REAL ANSWER — a bad token, a missing repo, an unprocessable
//     body. Retrying it repeats a wrong request three times and reports the
//     same failure later, having taught the reader that the guard is flaky
//     rather than that the request is wrong.
//
// ⚠️ 429 IS DELIBERATELY NOT RETRIED, though it is the one 4xx that would
// justify it. Honouring a rate limit means reading `Retry-After` and waiting
// what it says; retrying a 429 on a fixed backoff is how a client turns a
// throttle into a ban. That is a different change with its own source to cite,
// and inventing the wait here would be exactly the fabricated number this
// repository keeps deleting.
export const RETRY_ATTEMPTS = 3;

/** Pure, so both directions are tested without a network or a token. */
export function isRetryable({ status = null, networkError = false }) {
  if (networkError) return true;
  if (typeof status !== 'number') return false;
  return status >= 500 && status <= 599;
}

/** Pure. Bounded and short: this runs at the end of a real deploy, and a long
 *  sleep here is a job holding a runner open to re-ask a question that has
 *  already been answered twice. */
export const retryDelayMs = (attempt) => 500 * 2 ** (attempt - 1);

// ── ⏱ APPENDED 2026-09-11 — A RATE LIMIT IS "COULD NOT ASK", NOT "REFUSED" ──
// The ⚠️ paragraph above is left exactly as written: it named the change it was
// waiting for — honour the wait GitHub states, with a source — and this is it.
//
// 🔴 RUN 34570837376 (deploy-web on main, 68589a95). The gate passed, `wrangler
// pages deploy` succeeded (Cloudflare holds a production deployment at that
// SHA), the post-deploy smoke passed, and then this script printed
//   ✗ could not record the deployment: POST deployments → 403 {
//     "message": "API rate limit exceeded for installation. …"
// Several agents' concurrent CI had drained the shared GitHub App installation
// quota. The 403 went down the "a 4xx is a REAL ANSWER" branch, so a SUCCESSFUL
// deploy read as a failed one, and the record for that SHA is missing — which
// the provenance and freshness readers depend on. A rate-limit refusal says
// nothing about the request; it says the question could not be asked yet.
// Filing it as "refused" is the mirror image of filing "I could not look" as
// "I looked and it was fine".
//
// THE SOURCE — GitHub REST docs, "Rate limits for the REST API", read 2026-09-11:
//   https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
//   · a PRIMARY limit answers 403 or 429 with `x-ratelimit-remaining: 0`
//     (headers: x-ratelimit-limit, -remaining, -used, -reset, -resource);
//   · a SECONDARY limit answers 403 or 429 with an error message saying a
//     secondary rate limit was exceeded;
//   · the wait, in the docs' own order: when `retry-after` is present, not
//     before that many seconds; else when `x-ratelimit-remaining` is 0, not
//     before `x-ratelimit-reset` (UTC epoch seconds); otherwise at least one
//     minute, growing exponentially while a secondary limit keeps refusing.
// Nothing below invents a wait. The one number chosen here is the BOUND.
//
// WHAT COUNTS AS A RATE LIMIT — a signal, never a bare 403:
//   · 403/429 carrying `retry-after`                        → wait that long
//   · 403/429 carrying `x-ratelimit-remaining: 0`           → wait for the reset
//   · 403/429 whose message says "secondary rate limit"     → 1 min, doubling
//   · 403/429 whose message says "API rate limit exceeded"  → 1 min (the primary
//     refusal's own words, for a response that lost its headers)
//   · a bare 429 — RFC 6585 §4 defines the status itself as too many requests,
//     so it is a rate limit that names no wait               → 1 min
// A 401, and a 403 with none of those ("Resource not accessible by
// integration"), is still a REAL ANSWER and fails on the first response.
//
// THE BOUND — RATE_LIMIT_BUDGET_MS, 10 minutes, measured against the jobs that
// run this script (`timeout-minutes`, and job durations read from the Actions
// API on 2026-09-11):
//   · TIGHTEST: deploy-workers.yml `platform` / `subscriptiontracker-api`,
//     timeout-minutes: 15. "Deploy platform" took 1m19s, 1m22s, 1m29s and 2m02s
//     over its last four green runs, so ~2m + 10m leaves ~3m of headroom.
//   · deploy-web.yml, timeout-minutes: 35. Run 34570837376 spent 5m12s in the
//     gate and 2m24s from setup-flutter to this step. Worst case is the gate's
//     full 20-minute poll + ~2.5m + 10m = ~32.5m, still inside 35.
//   · build-platforms.yml `release` (20; ~1m measured), submit-* (30),
//     extensions.yml `release` (45).
// test/github-rate-limit.test.mjs re-derives that list from the workflows and
// fails if any recording job leaves under 3 minutes beside the bound.
// An installation window resets HOURLY, so ten minutes cannot outwait every
// refusal, and is not meant to. When the next PERMITTED retry is already beyond
// the bound, this gives up AT ONCE rather than holding a runner open for a wait
// it knows cannot end in time — and says the deploy succeeded, because it did.

/** The real API origin — the one non-loopback value GITHUB_API_URL may hold. */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

/** The bound on rate-limit waiting, counted from the first rate-limit refusal. */
export const RATE_LIMIT_BUDGET_MS = 10 * 60 * 1000;

/** A cap on REQUESTS as well as time: a server naming a one-second wait over and
 *  over would otherwise be asked ~600 times inside the bound, against a quota
 *  that is by definition already spent. */
export const RATE_LIMIT_MAX_RETRIES = 10;

/** GitHub's "otherwise, wait for at least one minute". */
export const SECONDARY_MIN_WAIT_MS = 60 * 1000;

/** `x-ratelimit-reset` is whole epoch seconds and the runner's clock is not
 *  GitHub's; one second past the reset is the earliest honest retry. */
export const RESET_SKEW_MS = 1000;

/** A header from a fetch `Headers` or a plain object, case-insensitively. */
function headerOf(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((h) => h.toLowerCase() === name);
  return key === undefined ? null : String(headers[key]);
}

/** Pure. What a non-2xx GitHub response MEANS. One of:
 *    { kind: 'rate-limit', limit: 'primary'|'secondary'|'unspecified', waitMs, signal }
 *    { kind: 'transient' } — a 5xx: ask again on the short backoff
 *    { kind: 'answer' }    — a real answer about the request: do not re-ask
 *  `secondaryStrikes` is how many secondary refusals came before this one. It
 *  is shared with assert-gate-passed.mjs so the two scripts that spend one
 *  installation quota cannot disagree about what a rate limit is. */
export function classifyRefusal({ status, headers = null, bodyText = '', now = Date.now(), secondaryStrikes = 0 }) {
  if (typeof status !== 'number') return { kind: 'answer' };
  if (isRetryable({ status })) return { kind: 'transient' };
  if (status !== 403 && status !== 429) return { kind: 'answer' };

  const text = String(bodyText ?? '');
  const secondaryWords = /secondary rate limit/i.test(text);
  const primaryWords = /API rate limit exceeded/i.test(text);
  const remaining = (headerOf(headers, 'x-ratelimit-remaining') ?? '').trim();
  const exhausted = remaining === '0';
  const limit = secondaryWords ? 'secondary' : exhausted || primaryWords ? 'primary' : 'unspecified';

  const retryAfter = (headerOf(headers, 'retry-after') ?? '').trim();
  if (retryAfter !== '') {
    let waitMs = null;
    if (/^\d+$/.test(retryAfter)) waitMs = Number(retryAfter) * 1000;
    else if (Number.isFinite(Date.parse(retryAfter))) waitMs = Math.max(0, Date.parse(retryAfter) - now);
    if (waitMs !== null) return { kind: 'rate-limit', limit, waitMs, signal: `retry-after: ${retryAfter}` };
  }
  if (exhausted) {
    const reset = (headerOf(headers, 'x-ratelimit-reset') ?? '').trim();
    if (/^\d+$/.test(reset)) {
      return {
        kind: 'rate-limit',
        limit,
        waitMs: Math.max(0, Number(reset) * 1000 - now) + RESET_SKEW_MS,
        signal: `x-ratelimit-remaining: 0, x-ratelimit-reset: ${reset}`,
      };
    }
    return { kind: 'rate-limit', limit, waitMs: SECONDARY_MIN_WAIT_MS, signal: 'x-ratelimit-remaining: 0 and no readable x-ratelimit-reset' };
  }
  if (secondaryWords) {
    return {
      kind: 'rate-limit',
      limit,
      waitMs: SECONDARY_MIN_WAIT_MS * 2 ** Math.max(0, secondaryStrikes),
      signal: 'a "secondary rate limit" message',
    };
  }
  if (primaryWords) return { kind: 'rate-limit', limit, waitMs: SECONDARY_MIN_WAIT_MS, signal: 'an "API rate limit exceeded" message' };
  if (status === 429) return { kind: 'rate-limit', limit, waitMs: SECONDARY_MIN_WAIT_MS, signal: '429 with no wait named' };
  return { kind: 'answer' };
}

/** Pure. Take the wait a rate-limit refusal names, or give up now. `deadline` is
 *  absolute (ms); a caller with its own earlier deadline passes the minimum. */
export function planRateLimitWait({ refusal, now, deadline, retriesSoFar, maxRetries = RATE_LIMIT_MAX_RETRIES }) {
  if (retriesSoFar >= maxRetries) {
    return { giveUp: true, why: `still rate-limited after ${maxRetries} rate-limit retries` };
  }
  if (now + refusal.waitMs > deadline) {
    return {
      giveUp: true,
      why:
        `the next permitted retry is ${formatWait(refusal.waitMs)} away (${refusal.signal}) and only ` +
        `${formatWait(Math.max(0, deadline - now))} of the bound remain`,
    };
  }
  return { giveUp: false, waitMs: refusal.waitMs };
}

export const formatWait = (ms) => (ms >= 60_000 ? `${Math.round(ms / 6_000) / 10} min` : `${Math.ceil(ms / 1000)}s`);

/** The name a person reads. The tokens these lanes use are the job's own
 *  `github.token`, an App installation token, so a primary limit is the
 *  installation's quota. */
export const limitName = (refusal) =>
  refusal.limit === 'secondary' ? 'secondary rate limit' : refusal.limit === 'primary' ? 'installation rate limit' : 'rate limit';

/** A test seam that can only ever point at this machine.
 *  🔴 LOOPBACK OR THE REAL ORIGIN, NOTHING ELSE. This process holds a token with
 *  `deployments: write` (the gate, `checks: read`); an unconstrained base URL is
 *  a one-environment-variable path for sending it to any host. Same rule, same
 *  reason as `loopbackOr` in tooling/release/submit-play.mjs, which is file-local
 *  there. GitHub Actions sets GITHUB_API_URL to the real origin on every runner,
 *  and that value is accepted unchanged. */
export function githubApiBase(env = process.env) {
  const raw = String(env.GITHUB_API_URL ?? '').trim().replace(/\/+$/, '');
  if (raw === '' || raw === GITHUB_API_ORIGIN) return { base: GITHUB_API_ORIGIN, override: false };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: `GITHUB_API_URL is set and is not a URL: ${JSON.stringify(raw)}.` };
  }
  const loopback = u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!loopback) {
    return {
      error:
        `GITHUB_API_URL points at ${u.origin}, which is neither ${GITHUB_API_ORIGIN} nor loopback. It exists so ` +
        "the tests can drive the real transport against a local server; any other value would send this job's " +
        'GitHub token to that host.',
    };
  }
  return { base: raw, override: true };
}

/** Thrown when a rate limit outlasts the bound. It is NOT a refusal of the
 *  request, and main() says so in words a person cannot misread. */
export class RateLimitExhausted extends Error {
  constructor(message, { refusal, why }) {
    super(message);
    this.name = 'RateLimitExhausted';
    this.refusal = refusal;
    this.why = why;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The one bounded GitHub client. ⏱ 2026-09-24 — exported, and `ctx.method` names the verb
 *  (default POST, every write here): read-ledger-version-code.mjs reads the ledger through
 *  it with `method: 'GET'` and no body, so the read and the write share one retry and
 *  rate-limit policy. A call with no body sends no body and no content-type. */
export async function api(path, token, repo, body, ctx) {
  const method = ctx.method ?? 'POST';
  const hasBody = body !== undefined && body !== null;
  let last = null;
  let transientAttempts = 0;
  for (;;) {
    let res = null;
    try {
      res = await fetch(`${ctx.base}/repos/${repo}/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          'user-agent': 'nikatru-record-deployment',
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      // A network error never reached GitHub at all → the short backoff below.
      last = new Error(`${method} ${path} → ${e && e.message ? e.message : e}`);
    }

    if (res !== null) {
      const text = await res.text();
      if (res.ok) {
        // EVERY ATTEMPT IS PRINTED, including the one that worked. A retry that
        // succeeds silently is a transient fault nobody ever learns about, and
        // the 2026-08-17 outage was invisible until somebody went looking for a
        // record that was not there.
        if (transientAttempts > 0 || ctx.rl.retries > 0) {
          console.log(
            `   ⬜ ${method} ${path} succeeded after ${transientAttempts} transient and ${ctx.rl.retries} rate-limit ` +
              `retr${transientAttempts + ctx.rl.retries === 1 ? 'y' : 'ies'} in this run.`,
          );
        }
        return JSON.parse(text);
      }
      last = new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      const refusal = classifyRefusal({ status: res.status, headers: res.headers, bodyText: text, secondaryStrikes: ctx.rl.secondaryStrikes });
      if (refusal.kind === 'rate-limit') {
        // "Could not ask", not "refused": wait what GitHub says, inside ONE bound
        // shared by every write this run makes — or give up now, and let main()
        // say that the deploy succeeded and only the record is missing.
        const now = Date.now();
        ctx.rl.deadline ??= now + RATE_LIMIT_BUDGET_MS;
        const plan = planRateLimitWait({ refusal, now, deadline: ctx.rl.deadline, retriesSoFar: ctx.rl.retries });
        if (plan.giveUp) throw new RateLimitExhausted(last.message, { refusal, why: plan.why });
        ctx.rl.retries++;
        if (refusal.limit === 'secondary') ctx.rl.secondaryStrikes++;
        console.error(
          `   ⬜ ${method} ${path} → ${res.status}: ${limitName(refusal)} (${refusal.signal}) — GitHub could not be asked yet, ` +
            `which is not a refusal; waiting ${formatWait(plan.waitMs)} (rate-limit retry ${ctx.rl.retries} of at most ` +
            `${RATE_LIMIT_MAX_RETRIES}, bound ${RATE_LIMIT_BUDGET_MS / 60_000} min).`,
        );
        await sleep(plan.waitMs);
        continue;
      }
      if (refusal.kind !== 'transient') throw last;
    }

    transientAttempts++;
    if (transientAttempts >= RETRY_ATTEMPTS) break;
    console.error(
      res !== null
        ? `   ⬜ ${method} ${path} → ${res.status} on attempt ${transientAttempts} of ${RETRY_ATTEMPTS} — retrying.`
        : `   ⬜ ${method} ${path} could not reach GitHub on attempt ${transientAttempts} of ${RETRY_ATTEMPTS} — retrying (${last.message}).`,
    );
    await sleep(retryDelayMs(transientAttempts));
  }
  // The attempts are exhausted, not the reasons. This still fails the job — an
  // unrecorded deploy is the state this script exists to abolish, and a retry
  // budget running out does not make the record exist.
  throw new Error(`${last.message} (after ${RETRY_ATTEMPTS} attempts)`);
}

// ── ⏱ 2026-09-23 · THE RUN IDENTITY THE DEPLOYMENT CARRIES ─────────────────
// check-prod-provenance.mjs accepts a build stamped by a store-submission lane
// only when a Deployment on that lane's environment names the run — by id and
// by workflow file. It used to ask whether the Deployment was CREATED during
// the run, and a dry run at the same commit whose lifetime overlapped the
// upload's Deployment passed that test. A run id cannot be overlapped.
export const RUN_IDENTITY_ENV = Object.freeze(['GITHUB_WORKFLOW_REF', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_RUN_NUMBER']);

/** PURE. `{ payload, missing }` from an environment. `payload` is
 *  `{workflow, run_id, run_attempt, run_number}` — `workflow` is the workflow
 *  FILE basename out of GITHUB_WORKFLOW_REF (`owner/repo/.github/workflows/x.yml@ref`),
 *  the three numbers are positive safe integers — or `null`, with `missing`
 *  naming every variable that was absent or unreadable. */
export function runIdentity(env = process.env) {
  const missing = [];
  const wf = String(env.GITHUB_WORKFLOW_REF ?? '').match(/\.github\/workflows\/([^/@]+\.ya?ml)@/);
  if (!wf) missing.push('GITHUB_WORKFLOW_REF');
  const num = (name) => {
    const raw = String(env[name] ?? '');
    const n = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(n)) {
      missing.push(name);
      return null;
    }
    return n;
  };
  const run_id = num('GITHUB_RUN_ID');
  const run_attempt = num('GITHUB_RUN_ATTEMPT');
  const run_number = num('GITHUB_RUN_NUMBER');
  if (missing.length) return { payload: null, missing };
  return { payload: { workflow: wf[1], run_id, run_attempt, run_number }, missing };
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { i++; continue; }
    positional.push(argv[i]);
  }
  const [environment, environmentUrl] = positional;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  if (!environment) return fail('no environment given — usage: record-deployment.mjs <environment> [url] [--state <s>] [--listing-url <u>]');
  if (!repo) return fail('GITHUB_REPOSITORY is not set');
  if (!sha) return fail('GITHUB_SHA is not set');
  if (!token) return fail('GH_TOKEN / GITHUB_TOKEN is not set — the job needs `permissions: deployments: write`');

  // ── [10]D-9: the record's SHAPE, resolved before anything is written ───────
  let description;
  let state;
  let listingUrl;
  let submittable = false;
  let versionCodeRaw = null;
  let recordsVersionCode = false;
  try {
    state = flagValue(argv, 'state');
    listingUrl = flagValue(argv, 'listing-url');
    versionCodeRaw = flagValue(argv, 'version-code');
    if (state !== null && !STATES.includes(state)) {
      return fail(
        `--state "${state}" is not one of ${STATES.join(', ')}. A free-text state is a state nobody can ` +
          'query, which is the whole of what [10]D-9 asks for.',
      );
    }
    // Is this a STORE environment? Resolved from the register, never from the
    // name — otherwise renaming an environment is how you skip the rule.
    const regAbs = join(ROOT, REGISTER_REL);
    if (!existsSync(regAbs)) {
      return fail(
        `${REGISTER_REL} does not exist, so this script cannot tell a store channel from a web one and ` +
          'cannot enforce the listing-URL rule. Refusing rather than writing a record whose completeness ' +
          'nothing checked.',
      );
    }
    const register = JSON.parse(readFileSync(regAbs, 'utf8'));
    const resolved = resolveEnvironment(register, environment);
    if (resolved === null) {
      return fail(
        `no row in ${REGISTER_REL} claims the environment "${environment}". ` +
          'An environment nothing claims is a record filed under a channel that does not exist. ' +
          'A RELEASE channel matches by `deploymentEnvironment` template (e.g. "{app}-web"); a backend ' +
          'Worker matches a `serviceEnvironments` row by exact name (e.g. "platform"). Add the right ' +
          'one — a Worker must NOT be given a `channels` row, which would put it into every ' +
          '{served channel} × {app} assertion in the tree.',
      );
    }
    // ── IS THIS A CHANNEL THIS FACTORY CAN SUBMIT THROUGH? ────────────────────
    // Read from the register, never from the environment name and never from the
    // caller's flags: `submittable: false` is the row's own declaration that no
    // lane here can submit to it, and it is what separates "the store has this
    // and is reviewing it" from "the artifact exists and somebody still has to
    // upload it by hand". `=== false` rather than falsy, so a row that forgot the
    // field keeps the stricter submission rules rather than escaping them.
    const isStore = resolved.channel.kind === 'store';
    const cannotSubmit = isStore && resolved.channel.submittable === false;
    submittable = resolved.channel.submittable === true;
    // ⏱ 2026-09-24 — does this row record the versionCode each upload consumes? Read from the
    // register's `versionCodeHighWater` block, never from the environment's name.
    const hw = resolved.channel.versionCodeHighWater;
    recordsVersionCode = hw !== null && typeof hw === 'object' && !Array.isArray(hw);
    const NOT_SUBMITTED = NOT_SUBMITTED_STATES[0];
    if (state !== null && NOT_SUBMITTED_STATES.includes(state) && !cannotSubmit) {
      return fail(
        `--state ${state} was given for "${environment}", and ${
          isStore
            ? `the ${resolved.channel.id} row is \`submittable: ${JSON.stringify(resolved.channel.submittable ?? null)}\` — this factory CAN submit through it`
            : `the ${resolved.channel.id} channel is kind: "${resolved.channel.kind}", which nobody submits to`
        }. ${STATE_MEANING[NOT_SUBMITTED]} It is the one thing this state may say, and saying it here would ` +
          'file a manual publish that is owed for a channel that has a lane. Pass the state that is true instead.',
      );
    }
    if (isStore && !cannotSubmit && !listingUrl) {
      return fail(
        `"${environment}" is the ${resolved.channel.id} channel (kind: store) and no --listing-url was given. ` +
          'A store record whose listing nobody can open says something shipped and gives no way to look at ' +
          'it — the second source of truth [10]D-9 exists to prevent.',
      );
    }
    // A `submittable: false` store row is asked for the state and NOT for a
    // listing: the listing does not exist until the manual publish happens, so
    // demanding it would be demanding a fiction. The state below is still
    // mandatory, which is where the honesty is enforced.
    if (cannotSubmit && state !== null && !NOT_SUBMITTED_STATES.includes(state)) {
      return fail(
        `--state ${state} was given for "${environment}", and the ${resolved.channel.id} row is ` +
          '`submittable: false` — no lane in this factory can submit through it, so no run here can have ' +
          `put it in that state. ${STATE_MEANING[state] ?? ''} If the manual publish HAS happened, the row is ` +
          'what is out of date: flip `submittable`/`served` in the register first, so the ledger and the ' +
          'register cannot disagree about whether a submission path exists.',
      );
    }
    // 🔴 A STORE CHANNEL MAY NOT INHERIT THE `live` DEFAULT.
    // "live" is the right default for a web deploy: the upload finishing IS the
    // thing going live, and there is no third party in between. On a store it is
    // the single most consequential thing this ledger could get wrong — an
    // upload is `in_review`, and the store decides `live` hours-to-weeks later,
    // possibly never. A forgotten flag must not be the difference between "we
    // submitted it" and "the store approved it", so a store record has to say
    // which one it means, out loud, at the call site.
    if (isStore && state === null) {
      return fail(
        `"${environment}" is the ${resolved.channel.id} channel (kind: store) and no --state was given. ` +
          `A store submission is NOT live when the upload succeeds — it is "${SUBMIT_TIME_STATES[0]}" until the ` +
          `store decides, which happens after this run has ended. There is no default here on purpose: pass ` +
          `--state ${(cannotSubmit ? NOT_SUBMITTED_STATES : STATES.filter((s) => !NOT_SUBMITTED_STATES.includes(s))).join('|')} explicitly. ` +
          `${cannotSubmit ? STATE_MEANING[NOT_SUBMITTED] : STATE_MEANING.in_review}`,
      );
    }
    if (state === null) state = 'live'; // web / service: the upload IS the go-live
    description = encodeDescription({ state, sha, listingUrl });
  } catch (err) {
    return fail(`could not build the deployment record: ${err.message}`);
  }

  // ── ⏱ 2026-09-23 · THE RUN IDENTITY, BEFORE ANYTHING IS WRITTEN ───────────
  // A submittable channel's record is the witness a submitted build is accepted
  // on, and it witnesses only the run its payload names. Without the identity
  // the record would bind to no run, so it is not written: exit 2, the same
  // "the upload happened and its record did not" as the rate-limit branch.
  const identity = runIdentity(process.env);
  if (submittable && identity.payload === null) {
    console.error(
      `✗ "${environment}" is a channel this factory SUBMITS to, and the run identity is missing or unreadable: ` +
        `${identity.missing.join(', ')}. The record is NOT written: tooling/ops/check-prod-provenance.mjs binds a ` +
        "submitted build to its run ONLY through the Deployment payload these variables name, so a record without " +
        'them would witness no run at all.',
    );
    console.error(
      '  Every GitHub Actions step has them from the runner — a step that lost them was wrapped in something that ' +
        'cleared its environment. For a recovery written by hand, pass the values of the run being recorded: ' +
        `GITHUB_SHA=${sha} ${RUN_IDENTITY_ENV.map((k) => `${k}=<from that run>`).join(' ')}.`,
    );
    process.exitCode = 2;
    return;
  }

  // ── ⏱ 2026-09-24 · THE versionCode THE UPLOAD CONSUMED, BEFORE ANYTHING IS WRITTEN ──
  // cloud-review #909 finding 1. The committed mark in the register moved only when somebody
  // committed it, so an upload nobody recorded left --play-floor holding a run against a
  // stale mark. A row with a `versionCodeHighWater` block now writes the code into this
  // Deployment's payload as `version_code`, and read-ledger-version-code.mjs hands the
  // largest one to --play-floor before the next build. Required there, refused elsewhere:
  // a code on a row that bounds nothing is a claim no reader checks. Both exit 1, after the
  // run-identity refusal (exit 2) above.
  let versionCode = null;
  if (recordsVersionCode) {
    if (versionCodeRaw === null || !/^[1-9]\d*$/.test(versionCodeRaw) || !Number.isSafeInteger(Number(versionCodeRaw))) {
      return fail(
        `"${environment}" is a row whose ${REGISTER_REL} entry carries \`versionCodeHighWater\`, and ` +
          `${versionCodeRaw === null ? 'no --version-code was given' : `--version-code "${versionCodeRaw}" is not a whole number of 1 or more`}. ` +
          'Every upload on this row writes the versionCode it consumed into its ledger Deployment, because ' +
          'assert-app-versioning.mjs --play-floor reads it back to stop a build while the committed mark is below it. ' +
          'Pass the versionCode the upload carried (the build\'s --build-number).',
      );
    }
    versionCode = Number(versionCodeRaw);
  } else if (versionCodeRaw !== null) {
    return fail(
      `--version-code was given for "${environment}", whose ${REGISTER_REL} row carries no \`versionCodeHighWater\` ` +
        'block: nothing reads a versionCode back from this ledger, so the record would carry a claim no check holds. ' +
        'Drop the flag, or record the row\'s high-water block first.',
    );
  }
  const payload =
    identity.payload || versionCode !== null
      ? { ...(identity.payload ?? {}), ...(versionCode !== null ? { version_code: versionCode } : {}) }
      : null;

  // ── the transport: the real API, or a loopback test seam ─────────────────
  const transport = githubApiBase();
  if (transport.error) return fail(transport.error);
  if (transport.override) console.log(`⬜ GITHUB_API_URL override in effect: ${transport.base} — a LOOPBACK TEST SEAM, not GitHub.`);
  // ONE rate-limit budget for the whole run — the deployment AND its status —
  // so two writes cannot each spend the full bound.
  const ctx = { base: transport.base, rl: { deadline: null, retries: 0, secondaryStrikes: 0 }, deploymentId: null };

  try {
    // required_contexts: [] — the gate was already enforced by
    // assert-gate-passed.mjs before anything deployed. Leaving this unset makes
    // GitHub re-derive its own contexts and reject the record, which would turn
    // a successful deploy into a red job for no real reason.
    const deployment = await api('deployments', token, repo, {
      ref: sha,
      environment,
      // 🔴 THE SAME ENCODING AS THE STATUS BELOW — ONE SHAPE, NOT TWO.
      // This field read `${environment} deploy` until 2026-08-06, so the ledger
      // carried the nk1 record on the deployment STATUS and free prose on the
      // DEPLOYMENT. That is not a cosmetic split: the one-call query this
      // script's own header documents — `gh api …/deployments` — returns the
      // DEPLOYMENT's description, and `readSubmissions` (the reader D-6's
      // cadence limb and D-10 limb (iii) both consume) decodes exactly that
      // field. Verified live 2026-08-06: every deployment read
      // `"subscriptiontracker-web deploy"` and every status read `nk1 state=live sha=6525fb7d`
      // — so the documented ledger source decoded as UNPARSEABLE on every row,
      // and a cadence count over it was a count of zero that looked like
      // compliance. Reading statuses instead would be one extra API call per
      // deployment to recover a field we were already writing; writing the
      // encoding here costs nothing and makes the cheap query the correct one.
      description,
      // ⏱ 2026-09-23 — the run that wrote this record, by id. Omitted only on a
      // non-submittable channel run outside Actions; see RUN_IDENTITY_ENV.
      // ⏱ 2026-09-24 — plus `version_code` on a versionCodeHighWater row (above).
      ...(payload ? { payload } : {}),
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: true,
    }, ctx);
    ctx.deploymentId = deployment.id;

    await api(`deployments/${deployment.id}/statuses`, token, repo, {
      // The GitHub Deployment Status `state` and [10]D-9's REVIEW state are two
      // different things and both are needed. This one says the RECORDING
      // succeeded; the encoded description says what the store thinks. A
      // submission sitting `in_review` is a successfully recorded fact.
      state: 'success',
      ...(environmentUrl ? { environment_url: environmentUrl } : {}),
      description,
    }, ctx);

    console.log(
      `ok  recorded ${environment} ${state} at ${sha.slice(0, 8)}` +
        `${versionCode !== null ? ` · versionCode ${versionCode}` : ''}` +
        `${listingUrl ? ` · listing ${listingUrl}` : ''}${environmentUrl ? ` → ${environmentUrl}` : ''}`,
    );

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `**${environment} ${state} sha:** \`${sha}\`${listingUrl ? ` · [listing](${listingUrl})` : ''}` +
          `${environmentUrl ? ` → ${environmentUrl}` : ''}\n`,
      );
    }
  } catch (err) {
    if (err instanceof RateLimitExhausted) {
      // 🔴 THE ONE SENTENCE THIS BRANCH EXISTS TO PRINT. The step before this
      // one deployed; nobody reading a red job should have to infer that, and
      // run 34570837376 is what it looks like when they must.
      console.error(
        `✗ the DEPLOY SUCCEEDED; the GitHub Deployment record for ${sha} could not be written because the ` +
          `${limitName(err.refusal)} did not reset within ${RATE_LIMIT_BUDGET_MS / 60_000} minutes.`,
      );
      console.error(`  ${err.why}.`);
      console.error(`  Last response: ${err.message}`);
      if (ctx.deploymentId !== null) {
        console.error(`  Deployment ${ctx.deploymentId} WAS created for ${environment}; its success status is what could not be written.`);
      }
      console.error(
        '  This is NOT a failed deploy, and NOT a refused record — GitHub could not be asked. The record for this SHA ' +
          'is MISSING, and this step stays red (exit 2) so that stays visible.',
      );
      console.error(
        `  Write it once the limit resets by running ONLY this script again, same arguments, with GITHUB_SHA=${sha}. ` +
          'A whole-job re-run re-deploys to get a second chance at a write.',
      );
      // ⏱ 2026-09-23 — and with THIS run's identity, or the recovery record
      // names no run and a submitted build stays unattributable. Printed as the
      // exact assignments to pass; none of them is a secret.
      console.error(
        identity.payload
          ? `  Pass this run's identity too, exactly: GITHUB_SHA=${sha} ` +
              `GITHUB_WORKFLOW_REF=${process.env.GITHUB_WORKFLOW_REF} GITHUB_RUN_ID=${identity.payload.run_id} ` +
              `GITHUB_RUN_ATTEMPT=${identity.payload.run_attempt} GITHUB_RUN_NUMBER=${identity.payload.run_number}`
          : `  This run carried no readable identity (${identity.missing.join(', ')}), so the recovery record will carry no run payload.`,
      );
      process.exitCode = 2;
      return;
    }
    return fail(`could not record the deployment: ${err.message}`);
  }
}

// ── RUN ONLY WHEN RUN, NOT WHEN IMPORTED ────────────────────────────
// This was a bare `await main()` until 2026-08-20, so IMPORTING this file
// executed a deploy recorder: with no environment and no token it took the
// failure path and set a non-zero exit code on whatever imported it. That is
// why the retry decisions above could not be unit-tested until now — the only
// way to reach them was to run the whole outward-facing script.
//
// The guard is the same one build-enforcement-index.mjs uses. Invoked as
// `node tooling/ci/record-deployment.mjs …` this is true and nothing changes;
// the top-level await is kept so the process still waits for the write.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
