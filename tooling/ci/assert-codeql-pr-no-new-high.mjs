#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-codeql-pr-no-new-high.mjs — a pull request may not ADD a high or
// critical CodeQL alert.
//
// codeql.yml's header: "this is an alert sink, not a merge gate … If a finding
// ever needs to block, the way to do it is a named, reviewed rule — not turning
// this whole lane into a required check." This is that rule, and it is the only
// one. The CodeQL lane stays a sink; what blocks is THIS step, in ci.yml's
// security-scan job, a ci-gate constituent.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// Measured 2026-09-30: 160 open alerts, 35 of them high, growing about 7 a day,
// and every high was MERGED — PR #1071 alone added two (#522, #523) that its own
// CodeQL analysis had reported before the merge. The analysis ran; nothing read
// it. The default-branch half of the problem (every open alert carries a
// disposition) is assert-alert-disposition.mjs limb C. This is the other half:
// a new high never reaches main at all.
//
// ── HOW IT READS THE PR'S OWN ANALYSIS ──────────────────────────────────────
//   1. Wait for the CodeQL analysis of THIS pull request's head: the newest
//      analysis on refs/pull/<N>/merge whose commit is this run's merge commit,
//      or — when main moved and GitHub recomputed the merge ref (an `edited`
//      re-run) — a merge commit whose second parent is this PR's head SHA.
//      Polled every POLL_MS for up to WAIT_MS; CodeQL takes about 3 minutes
//      here (8 PR runs measured 2026-09-30: 136–212 s).
//   2. Read the OPEN alerts on refs/pull/<N>/merge. The PR analysis is
//      diff-informed, so this is the alerts in the PR's diff.
//   3. NEW = high or critical, and its number is neither open nor dismissed on
//      the default branch (an alert the PR merely touches keeps main's number).
//   A new high FAILS (exit 1). The ways out are the reviewed ones: fix it, or a
//   human dismisses it on GitHub with a reason (it then leaves state=open).
//
// ── EXIT CODES (C-COVERAGE-LOST-IS-NOT-PASS) ────────────────────────────────
//   0  the PR's analysis was read and adds no high/critical alert; OR the event
//      is not a pull request (printed, with why).
//   1  the PR adds at least one high/critical alert.
//   2  COVERAGE LOST — no token, the API refused (the job needs
//      `security-events: read`), the analysis never appeared inside WAIT_MS,
//      the analysis reported an error, a truncated page walk. Never a pass.
//
// NOT A PULL REQUEST: a push has no PR analysis to read. That prints and exits
// 0; the push to main is graded by limb C. A STACKED PR (base not main) IS
// graded: codeql.yml analyses a pull request into any base, so its own
// analysis exists, and "new" is still measured against main's alerts.
//
// Offline testing: --probe-file <json> answers every read (event, analyses,
// parents, prAlerts, mainOpen, mainDismissed); a banner says so.
//
// Usage:  node tooling/ci/assert-codeql-pr-no-new-high.mjs
// Env:    GH_TOKEN or GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME,
//         GITHUB_EVENT_PATH, GITHUB_SHA — all set by Actions.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAlerts, CouldNotLook, GITHUB_API, DEFAULT_REPOSITORY, PAGED_SEVERITIES } from '../ops/check-code-scanning-age.mjs';
import { fetchWithBoundedRetry } from '../ops/bounded-retry.mjs';

export const CATEGORY = '/language:javascript-typescript';
export const POLL_MS = 20_000;
export const WAIT_MS = 10 * 60_000;
export const DEFAULT_BRANCH = 'main';

/** PURE. The analysis that belongs to this PR's head, or null.
 *  `parentsOf(sha)` returns that commit's parent SHAs (possibly async). */
export async function pickAnalysis(analyses, { mergeSha, headSha, parentsOf }) {
  if (!Array.isArray(analyses)) throw new CouldNotLook('the analysis list is not an array');
  const ours = analyses
    .filter((a) => a && a.tool?.name === 'CodeQL' && a.category === CATEGORY && typeof a.commit_sha === 'string')
    .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
  const exact = ours.find((a) => a.commit_sha === mergeSha);
  if (exact) return exact;
  for (const a of ours.slice(0, 5)) {
    const parents = await parentsOf(a.commit_sha);
    if (Array.isArray(parents) && parents[1] === headSha) return a;
  }
  return null;
}

/** PURE. The high/critical alerts the PR adds. */
export function newHighs(prOpen, mainKnown) {
  const known = new Set(mainKnown.map((a) => a.number));
  return prOpen.filter((a) => a.state === 'open' && PAGED_SEVERITIES.includes(a.rule?.security_severity_level) && !known.has(a.number));
}

const where = (a) => {
  const l = a?.most_recent_instance?.location;
  return l?.path ? `${l.path}${Number.isInteger(l.start_line) ? `:${l.start_line}` : ''}` : '(no location)';
};

const flagOf = (argv, name) => {
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};

function couldNotLook(why) {
  console.error(`✗ COVERAGE LOST (exit 2) — ${why}`);
  console.error('    Nothing about this pull request\'s CodeQL alerts is known from this run. That is exit 2, never a pass.');
  process.exitCode = 2;
}

/** The live reads, behind one object so the probe can stand in for all of them. */
function liveSource({ repository, token }) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const note = (l) => console.error(`    ${l}`);
  const getJson = async (path) => {
    const url = `${GITHUB_API}${path}`;
    const res = await fetchWithBoundedRetry(({ signal }) => fetch(url, { headers, signal }), { note, describe: (why) => `GET ${url}: ${why}` });
    const text = await res.text();
    if (!res.ok) throw new CouldNotLook(`GET ${url} answered HTTP ${res.status}: ${text.slice(0, 300)}${res.status === 403 ? ' (the token needs security-events: read)' : ''}`);
    return JSON.parse(text);
  };
  return {
    analyses: (ref) => getJson(`/repos/${repository}/code-scanning/analyses?ref=${encodeURIComponent(ref)}&tool_name=CodeQL&per_page=20`),
    parentsOf: async (sha) => (await getJson(`/repos/${repository}/commits/${sha}`)).parents?.map((p) => p.sha) ?? [],
    alerts: (opts) => readAlerts({ repository, token, note, ...opts }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function probeSource(probe) {
  let poll = 0;
  return {
    // `analyses` is a list of answers, one per poll; the last repeats.
    analyses: async () => probe.analyses[Math.min(poll++, probe.analyses.length - 1)],
    parentsOf: async (sha) => probe.parents?.[sha] ?? [],
    alerts: async ({ state, ref }) => (ref ? probe.prAlerts : state === 'dismissed' ? probe.mainDismissed : probe.mainOpen),
    sleep: async () => {},
  };
}

async function main(argv) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  console.log(`assert-codeql-pr-no-new-high — a pull request may not add a high or critical CodeQL alert   (${repository})`);
  const probeFile = flagOf(argv, '--probe-file');
  let probe = null;
  if (probeFile) {
    console.log(`!!  --probe-file ${probeFile} — API ANSWERS ARE INJECTED. This is a TEST RUN, not a live check.`);
    probe = JSON.parse(readFileSync(probeFile, 'utf8'));
  }
  const eventName = probe ? probe.eventName : process.env.GITHUB_EVENT_NAME;
  let event = probe?.event ?? null;
  if (!probe && process.env.GITHUB_EVENT_PATH) {
    try {
      event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    } catch (e) {
      return couldNotLook(`the event payload ${process.env.GITHUB_EVENT_PATH} could not be read (${e.message}).`);
    }
  }
  if (eventName !== 'pull_request') {
    console.log(`ok  event is ${JSON.stringify(eventName ?? null)}, not a pull request — there is no PR analysis to read. The default branch is graded by assert-alert-disposition.mjs limb C.`);
    return;
  }
  const pr = event?.pull_request;
  const number = event?.number ?? pr?.number;
  const headSha = pr?.head?.sha;
  const base = pr?.base?.ref;
  const mergeSha = probe ? probe.mergeSha : process.env.GITHUB_SHA;
  if (!Number.isInteger(number) || !/^[0-9a-f]{40}$/.test(headSha ?? '') || !/^[0-9a-f]{40}$/.test(mergeSha ?? '')) {
    return couldNotLook('the pull_request event carries no PR number, head SHA or merge SHA to find its analysis by.');
  }
  if (base !== DEFAULT_BRANCH) console.log(`    PR #${number} is stacked on ${JSON.stringify(base)}; its own analysis is graded, and "new" means not open or dismissed on ${DEFAULT_BRANCH}.`);

  let src;
  if (probe) src = probeSource(probe);
  else {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) return couldNotLook('neither GH_TOKEN nor GITHUB_TOKEN is in the environment, so the PR analysis could not be read.');
    src = liveSource({ repository, token });
  }

  const ref = `refs/pull/${number}/merge`;
  try {
    let analysis = null;
    const deadline = Date.now() + WAIT_MS;
    for (let poll = 0; ; poll++) {
      analysis = await pickAnalysis(await src.analyses(ref), { mergeSha, headSha, parentsOf: src.parentsOf });
      if (analysis || Date.now() >= deadline || (probe && poll >= (probe.maxPolls ?? 3))) break;
      console.log(`    waiting for CodeQL's analysis of ${headSha.slice(0, 12)} on ${ref} (poll ${poll + 1})`);
      await src.sleep(POLL_MS);
    }
    if (!analysis) {
      return couldNotLook(
        `no CodeQL analysis (${CATEGORY}) of PR #${number} at head ${headSha.slice(0, 12)} appeared on ${ref} within ${WAIT_MS / 60_000} minutes. ` +
          'Check the CodeQL workflow run for this head; re-run this job once it has uploaded.',
      );
    }
    if (analysis.error) return couldNotLook(`the CodeQL analysis ${analysis.id} of ${ref} reported an error: ${analysis.error}`);
    console.log(`    analysis ${analysis.id} of ${analysis.commit_sha.slice(0, 12)} (${analysis.created_at}), ${analysis.results_count ?? '?'} result(s) in the diff`);

    const prOpen = await src.alerts({ state: 'open', ref });
    const mainKnown = [...(await src.alerts({ state: 'open' })), ...(await src.alerts({ state: 'dismissed' }))];
    if (!Array.isArray(prOpen) || !prOpen.every((a) => Number.isInteger(a?.number) && a?.rule)) {
      return couldNotLook(`the alert list of ${ref} is not a list of alerts.`);
    }
    const added = newHighs(prOpen, mainKnown);
    if (added.length === 0) {
      console.log(`ok  PR #${number} adds no ${PAGED_SEVERITIES.join('/')} CodeQL alert (${prOpen.length} open on ${ref}; ${mainKnown.length} open or dismissed on ${DEFAULT_BRANCH}).`);
      return;
    }
    console.error(`✗ PR #${number} ADDS ${added.length} ${PAGED_SEVERITIES.join('/').toUpperCase()} CODEQL ALERT(S):`);
    for (const a of added) console.error(`    #${a.number}  ${a.rule.id}  ${a.rule.security_severity_level}  ${where(a)}${a.html_url ? `  ${a.html_url}` : ''}`);
    console.error('    Fix it in this PR. If it is a false positive, a human dismisses it on GitHub WITH a reason, and this job is re-run.');
    process.exitCode = 1;
  } catch (e) {
    return couldNotLook(e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
