#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// read-ledger-version-code.mjs — the largest versionCode the [10]D-9 ledger holds
// for one environment, for assert-app-versioning.mjs --play-floor.
//
// ⏱ ADDED 2026-09-24 (O-PLAY-VERSIONCODE-HIGH-WATER-UNRECORDED; cloud-review #909
// finding 1). The mark --play-floor holds a run above,
// `android-play.versionCodeHighWater.consumed.<app>` in tooling/channel-register.json,
// moves only when somebody commits it. The chain the review wrote down: an upload
// nobody recorded leaves the mark below Play's real one, a renamed workflow restarts
// its run counter at 1 with a floor above that stale mark, and every run up to the
// real one builds, uploads and is refused by Play. So every upload now writes the
// versionCode it consumed into its ledger Deployment (`payload.version_code`,
// record-deployment.mjs --version-code), and submit-play.yml reads the largest one
// here before each build and passes it as --recorded-upload: a ledger above the
// committed mark stops the dispatch until the mark is committed.
//
// WHY A FILE OF ITS OWN, AND NOT A MODE OF record-deployment.mjs. A mode would be
// invoked as `record-deployment.mjs --read-version-code …`, and RECORD_CALL
// (workflow-scan.mjs) reads every `record-deployment.mjs <token>` in a workflow as a
// ledger WRITE to the environment named by the token; assert-publish-records.mjs and
// assert-ops-register.mjs would then count, or refuse, a record call to an environment
// called `--read-version-code` in the dry-run job. Changing that shared reader is a
// wider change than one file. What stays shared is the part that must not fork: the
// bounded GitHub client (`api` in record-deployment.mjs, its retry and rate-limit
// policy) and the payload reading (`maxVersionCode` in deployment-record.mjs, the one
// declaration of the record shape).
//
// WHY THE LEDGER AND NOT PLAY. A live Play read is a vendor call no writer can test,
// and a draft-discarded bundle consumes its versionCode without appearing on a track.
// The ledger Deployment is written by the upload job itself, keyed by ENVIRONMENT, so
// it survives the workflow rename that is the failure above.
//
// Usage:
//   node tooling/ci/read-ledger-version-code.mjs <environment>
//   env:  GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY
//         GITHUB_API_URL — the real origin or loopback only (githubApiBase)
//   The job needs `permissions: deployments: read`.
// stdout is ONLY the answer: the largest whole `payload.version_code` of 1 or more on
// that environment's Deployments, or `none` when no Deployment carries one (every
// Deployment written before 2026-09-24). Diagnostics go to stderr.
// Exit 0 = printed.
//      2 = could not read: no token or repository, GitHub refused or the bound ran out,
//          or more than MAX_PAGES full pages. Never 1: an unreadable ledger is not a
//          finding about the mark, and the step that runs this fails closed on it.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, githubApiBase, RateLimitExhausted, RATE_LIMIT_BUDGET_MS, limitName } from './record-deployment.mjs';
import { maxVersionCode } from './deployment-record.mjs';

/** GitHub's largest page. */
export const PER_PAGE = 100;

/** A ceiling on READS: 10 pages is 1,000 Deployments on one environment. A ledger that
 *  fills every page has not been read to its end, so its max is not proven. */
export const MAX_PAGES = 10;

function couldNotRead(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 2;
}

async function main() {
  // 🔴 STDOUT IS THE ANSWER. The shared client prints "succeeded after N retries" with
  // console.log, and a `$(…)` capture would hand that line to --recorded-upload as part of
  // the versionCode. Every diagnostic in this process goes to stderr.
  console.log = (...a) => console.error(...a);
  const environment = process.argv[2];
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!environment || environment.startsWith('--')) {
    return couldNotRead('no environment given — usage: read-ledger-version-code.mjs <environment>');
  }
  if (!repo) return couldNotRead('GITHUB_REPOSITORY is not set, so there is no ledger to read');
  if (!token) return couldNotRead('GH_TOKEN / GITHUB_TOKEN is not set — the job needs `permissions: deployments: read`');

  const transport = githubApiBase();
  if (transport.error) return couldNotRead(transport.error);
  if (transport.override) console.error(`⬜ GITHUB_API_URL override in effect: ${transport.base} — a LOOPBACK TEST SEAM, not GitHub.`);
  const ctx = { base: transport.base, method: 'GET', rl: { deadline: null, retries: 0, secondaryStrikes: 0 } };

  const deployments = [];
  let complete = false;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await api(
        `deployments?environment=${encodeURIComponent(environment)}&per_page=${PER_PAGE}&page=${page}`,
        token,
        repo,
        null,
        ctx,
      );
      if (!Array.isArray(rows)) {
        return couldNotRead(`GET deployments page ${page} for "${environment}" did not answer a list, so the ledger was not read`);
      }
      deployments.push(...rows);
      if (rows.length < PER_PAGE) {
        complete = true;
        break;
      }
    }
  } catch (err) {
    if (err instanceof RateLimitExhausted) {
      return couldNotRead(
        `the ${limitName(err.refusal)} did not reset within ${RATE_LIMIT_BUDGET_MS / 60_000} minutes (${err.why}); ` +
          `the ledger for "${environment}" was not read. Last response: ${err.message}`,
      );
    }
    return couldNotRead(`could not read the ledger for "${environment}": ${err.message}`);
  }
  if (!complete) {
    return couldNotRead(
      `"${environment}" has more than ${(MAX_PAGES * PER_PAGE).toLocaleString('en-US')} Deployments; the max is not proven, ` +
        `because only the first ${MAX_PAGES} pages were read`,
    );
  }

  const max = maxVersionCode(deployments);
  console.error(
    `⬜ ${deployments.length} Deployment(s) on ${environment}; ` +
      `${max === null ? 'none carries a payload.version_code' : `the largest payload.version_code is ${max}`}`,
  );
  process.stdout.write(`${max === null ? 'none' : max}\n`);
}

// Run only when run, not when imported — the same guard as record-deployment.mjs.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
