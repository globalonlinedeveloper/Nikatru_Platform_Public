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
// ── `--sha` · THE ROLLBACK CASE, ADDED 2026-08-21 (E18) ──────────────────────
// GITHUB_SHA IS THE COMMIT THE RUN WAS DISPATCHED AGAINST, NOT THE ONE THAT WAS
// BUILT. The two are the same on every `push`, and they part company the moment
// a lane checks out something else — which is exactly what a rollback is:
// deploy-web.yml now takes a `rollback_to` input, gives it to
// `actions/checkout` as `ref:`, and ships the bundle built from THAT commit.
// With GITHUB_SHA as the only source, such a run would have filed a record
// naming the head of main: the ledger would say the bad commit is live while
// the good one is serving, and every reader downstream — the daily provenance
// monitor, check-prod-provenance.mjs, `readSubmissions` — would agree with it.
// A ledger that is confidently wrong is worse than the hole it replaced.
//
// It is a FULL 40-character lowercase SHA or nothing. A short SHA records a
// string no `deployments?sha=` query matches; a branch or tag records something
// that is not a commit at all. And when it differs from GITHUB_SHA the
// difference is PRINTED — a lane silently recording a commit other than its own
// is the one shape this flag could turn into a new lie.
//
// 🔴 THE FLAG ONLY WORKS IF THE COPY THAT RUNS IS THIS ONE, AND ON A ROLLBACK
// THAT IS NOT AUTOMATIC. A lane that checks out an older commit replaces this
// file with that commit's version of it, and every version before 2026-08-21
// SKIPS the flag rather than rejecting it — the positional loop above does
// `if (argv[i].startsWith('--')) { i++; continue; }`, so `--sha <40-hex>` is
// consumed and discarded and the record is filed against GITHUB_SHA on a GREEN
// run. Measured that day against `git show HEAD:tooling/ci/record-deployment.mjs`
// with GITHUB_SHA unset: `… --sha 4174c2ab…` still exits 1 with `GITHUB_SHA is
// not set`, i.e. the flag supplied nothing at all.
// deploy-web.yml closes this from its side: on a rollback it checks the
// DISPATCHED commit out beside the target and runs the recorder from there, and
// a step before the gate RUNS the copy that will run — handing it an invalid
// `--sha` and requiring the 40-hex refusal below to come back — before anything
// can ship. It does NOT grep this file's source for the flag: the first draft of
// that step did, and this very paragraph defeated it, because a comment naming
// the expression matched exactly as well as the statement that reads it
// (measured 2026-08-21 on a copy whose live statement was replaced and whose
// header was left alone — `grep -qF` still said yes). Any other lane that grows
// a `ref:` must do the same — passing `--sha` to a checked-out older copy of
// this script is indistinguishable, from the outside, from not passing it.
//
// ⚠️ WHICH OF THE FOUR NEW `--sha` CONDITIONS DECIDES PASS/FAIL, swept
// 2026-08-21 by setting each one alone to `if (false)` in a scratch copy and
// re-running the CLI — ALL FOUR, not a sample. Written down because two of them
// are message quality, and a reader who counts four guards here would be
// counting two decorations. Every run below is
//   GH_TOKEN=tok GITHUB_REPOSITORY=o/r \
//   GITHUB_SHA=e2ba7df9000000000000000000000000000000ab \
//   node tooling/ci/record-deployment.mjs subly-web https://x --sha <input>
// with a scratch `console.log('SHA_USED=' + sha)` added so the recorded SHA is
// observable, and a deliberately invalid token so nothing can reach GitHub:
//   · `shaOverride ?? process.env.GITHUB_SHA` — THE one that carries the fix.
//     Reduced to `process.env.GITHUB_SHA`, input `--sha 4174c2ab7b40…a15`
//     prints `SHA_USED=e2ba7df9…` (dispatched) instead of `SHA_USED=4174c2ab…`
//     (built). Silent, and green on a runner with a real token.
//   · the 40-hex refusal — REFUSES ON ITS OWN DOMAIN, and that domain is not
//     covered by deployment-record.mjs's pre-existing hex check, which only
//     tests `sha.slice(0, 8)`. Input `--sha 4174c2ab` (an 8-character short
//     SHA — the plausible operator paste): intact, the one-line `✗ --sha
//     "4174c2ab" is not a full 40-character…` and nothing else runs; as
//     `if (false)`, that refusal is gone and the script goes on to POST with
//     `ref` set to the 8-character string (`SHA_USED=4174c2ab`, then only the
//     fake token's 401 stops it — so the exit code is 1 for a DIFFERENT reason
//     and the code alone does not show the difference; the printed `ref` does).
//     A 7-character or uppercase value is caught either way by the pre-existing
//     check, so THIS is the input that proves the limb.
//   · the OVERRIDE PRINT below — a print, not a refusal. Disabled, `SHA_USED`
//     is unchanged and only the ⬜ line disappears. Its whole value is that an
//     incident reader does not have to infer the substitution.
//   · the try/catch around `flagValue` — shape, not pass/fail, and KEPT for a
//     reason that is not "it looks tidy": it is the same try/catch the
//     pre-existing `--state` / `--listing-url` reads already sit in, and that
//     shape is PINNED BY THE SUITE — tooling/ci/test/deployment-record.test.mjs
//     asserts `/--state was given with no value/` against the real CLI. Removed,
//     a dangling `--sha` still exits 1, as an uncaught stack trace instead of
//     the one-line `✗ --sha was given with no value`, so `--sha` alone would
//     answer a dangling flag differently from every other flag on this script.
//
// ⚠️ COVERAGE, STATED RATHER THAN IMPLIED — AND THE STATEMENT GOT SHARPER ON
// 2026-08-22, BECAUSE A CONJUNCT TURNED OUT TO BE PINNED AFTER ALL. The blunt
// version ("the two refusals have no in-suite negative half") was true of the
// ROLLBACK input and false of one half of one condition, so it is replaced
// rather than repeated. Still true: nothing in tooling/ci/test/ passes `--sha`
// to this script — re-measured after the last edit of this pass,
// `grep -rn -- "--sha" tooling/ci/test/` returns 8 hits, every one of them in
// release-durable.test.mjs and every one of them release-manifest.mjs's
// unrelated flag. What a test CAN already kill, measured one condition at a
// time against the real CLI:
//   · `shaOverride !== null` — PINNED, and hard. Drop that conjunct and
//     `/^[0-9a-f]{40}$/.test(null)` is false on every invocation that gives no
//     `--sha` at all, so the script refuses `--sha "null"` on the PUSH path and
//     ALL THREE `record-deployment (offline paths)` cases in
//     tooling/ci/test/guards.test.mjs stop matching the message they assert
//     (`no environment given`, `GITHUB_REPOSITORY`, `GITHUB_SHA`).
//   · the 40-hex regex itself — NOT pinned. Only a `--sha` value can reach it
//     and no test supplies one.
//   · `if (!sha)`, whose message this change edited — PINNED, by that same
//     file's "FAILS when there is no SHA to record". As `if (false)` the run
//     still exits 1, but the line becomes `could not build the deployment
//     record: sha ""…`, which does not contain GITHUB_SHA, and the assertion
//     fails. An exit code alone would NOT have shown this.
//   · the override print and the try/catch — neither pinned, and neither is a
//     refusal; see the sweep above.
// The test that pins the rollback half belongs to whoever next owns
// tooling/ci/test/deployment-record.test.mjs. What DOES cover this script from
// the suite is unchanged by `--sha`: deployment-record.test.mjs still asserts
// that every `record-deployment.mjs <environment>` call site in every workflow
// resolves against tooling/channel-register.json.
//
// Usage:
//   node tooling/ci/record-deployment.mjs <environment> [environment-url]
//   node tooling/ci/record-deployment.mjs <environment> [url] \
//        --state <in_review|live|rejected|pulled> --listing-url <url>
//   node tooling/ci/record-deployment.mjs <environment> [url] --sha <40-hex>
//   env:  GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY, GITHUB_SHA
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, token, repo, body) {
  let last = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    let res = null;
    let networkError = false;
    try {
      res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
          'user-agent': 'nikatru-record-deployment',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      networkError = true;
      last = new Error(`POST ${path} → ${e && e.message ? e.message : e}`);
    }

    if (res !== null) {
      const text = await res.text();
      if (res.ok) {
        // EVERY ATTEMPT IS PRINTED, including the one that worked. A retry that
        // succeeds silently is a transient fault nobody ever learns about, and
        // the 2026-08-17 outage was invisible until somebody went looking for a
        // record that was not there.
        if (attempt > 1) console.log(`   ⬜ POST ${path} succeeded on attempt ${attempt} of ${RETRY_ATTEMPTS}.`);
        return JSON.parse(text);
      }
      last = new Error(`POST ${path} → ${res.status} ${text.slice(0, 300)}`);
      if (!isRetryable({ status: res.status })) throw last;
      console.error(`   ⬜ POST ${path} → ${res.status} on attempt ${attempt} of ${RETRY_ATTEMPTS} — retrying.`);
    } else if (isRetryable({ networkError })) {
      console.error(`   ⬜ POST ${path} could not reach GitHub on attempt ${attempt} of ${RETRY_ATTEMPTS} — retrying (${last.message}).`);
    }

    if (attempt < RETRY_ATTEMPTS) await sleep(retryDelayMs(attempt));
  }
  // The attempts are exhausted, not the reasons. This still fails the job — an
  // unrecorded deploy is the state this script exists to abolish, and a retry
  // budget running out does not make the record exist.
  throw new Error(`${last.message} (after ${RETRY_ATTEMPTS} attempts)`);
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
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  // E18 — see the header block. Read BEFORE the checks below, because it is one
  // of the two things that can supply the SHA those checks are about.
  let shaOverride;
  try {
    shaOverride = flagValue(argv, 'sha');
  } catch (err) {
    return fail(err.message);
  }
  if (shaOverride !== null && !/^[0-9a-f]{40}$/.test(shaOverride)) {
    return fail(
      `--sha "${shaOverride}" is not a full 40-character lowercase commit SHA. A short SHA records a string ` +
        'no `deployments?sha=` query matches, and a branch or tag records something that is not a commit — ' +
        'either way the ledger stops answering the one question it exists for.',
    );
  }
  const sha = shaOverride ?? process.env.GITHUB_SHA;

  if (!environment) return fail('no environment given — usage: record-deployment.mjs <environment> [url] [--state <s>] [--listing-url <u>] [--sha <40-hex>]');
  if (!repo) return fail('GITHUB_REPOSITORY is not set');
  if (!sha) return fail('GITHUB_SHA is not set and no --sha was given');
  if (!token) return fail('GH_TOKEN / GITHUB_TOKEN is not set — the job needs `permissions: deployments: write`');

  // ── [10]D-9: the record's SHAPE, resolved before anything is written ───────
  let description;
  let state;
  let listingUrl;
  try {
    state = flagValue(argv, 'state');
    listingUrl = flagValue(argv, 'listing-url');
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
    if (resolved.channel.kind === 'store' && !listingUrl) {
      return fail(
        `"${environment}" is the ${resolved.channel.id} channel (kind: store) and no --listing-url was given. ` +
          'A store record whose listing nobody can open says something shipped and gives no way to look at ' +
          'it — the second source of truth [10]D-9 exists to prevent.',
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
    if (resolved.channel.kind === 'store' && state === null) {
      return fail(
        `"${environment}" is the ${resolved.channel.id} channel (kind: store) and no --state was given. ` +
          `A store submission is NOT live when the upload succeeds — it is "${SUBMIT_TIME_STATES[0]}" until the ` +
          `store decides, which happens after this run has ended. There is no default here on purpose: pass ` +
          `--state ${STATES.join('|')} explicitly. ${STATE_MEANING.in_review}`,
      );
    }
    if (state === null) state = 'live'; // web / service: the upload IS the go-live
    description = encodeDescription({ state, sha, listingUrl });
  } catch (err) {
    return fail(`could not build the deployment record: ${err.message}`);
  }

  // E18 — PRINTED, NEVER SILENT, and only when the two actually disagree. On
  // every push `--sha` repeats GITHUB_SHA and this says nothing; the day it says
  // something, a lane recorded a commit other than the one it was dispatched
  // against, and that is a fact an incident reader must not have to infer.
  if (shaOverride !== null && shaOverride !== process.env.GITHUB_SHA) {
    console.log(
      `⬜ --sha ${shaOverride} OVERRIDES GITHUB_SHA (${process.env.GITHUB_SHA ?? 'unset'}) — this run is ` +
        'redeploying an earlier commit, so the record names what was BUILT, not what was dispatched.',
    );
  }

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
      // `"subly-web deploy"` and every status read `nk1 state=live sha=6525fb7d`
      // — so the documented ledger source decoded as UNPARSEABLE on every row,
      // and a cadence count over it was a count of zero that looked like
      // compliance. Reading statuses instead would be one extra API call per
      // deployment to recover a field we were already writing; writing the
      // encoding here costs nothing and makes the cheap query the correct one.
      description,
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: true,
    });

    await api(`deployments/${deployment.id}/statuses`, token, repo, {
      // The GitHub Deployment Status `state` and [10]D-9's REVIEW state are two
      // different things and both are needed. This one says the RECORDING
      // succeeded; the encoded description says what the store thinks. A
      // submission sitting `in_review` is a successfully recorded fact.
      state: 'success',
      ...(environmentUrl ? { environment_url: environmentUrl } : {}),
      description,
    });

    console.log(
      `ok  recorded ${environment} ${state} at ${sha.slice(0, 8)}` +
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
