#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-codeql-pr-no-new-high.mjs — a pull request may not ADD a high or
// critical CodeQL alert, nor ANY alert its own dispositions file does not answer.
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
//   3. NEW = its number is neither open nor dismissed on the default branch (an
//      alert the PR merely touches keeps main's number). EVERY severity.
//   4. Each new alert is graded against the PR's OWN tooling/ci/codeql-
//      dispositions.json — the file in this checkout, not main's:
//        · high or critical        → FAILS, whatever the file says. Fix it, or a
//                                    human dismisses it on GitHub with a reason.
//        · a flow rule (js/file-access-to-http, js/http-to-file-access) with a
//          `by-design` entry for its number, rule and path in this PR → passes;
//        · anything else           → FAILS: fix it in this PR.
//
// ⏱ 2026-09-30 · WHY EVERY SEVERITY (review of #1087, finding 2). Until today
// this graded highs only, while limb C of assert-alert-disposition.mjs reads
// MAIN's alerts. So a new medium or note passed its own PR — the rule ignored it,
// and limb C could not see it yet — merged, and three minutes later main's
// analysis opened it and limb C reddened every other PR and main until somebody
// else dispositioned it. Grading the PR's new alerts against the PR's own file
// closes that: an alert reaches main only with its disposition beside it, and
// limb C can then go red only on a disproved claim or a CodeQL upgrade.
//
// ⏱ 2026-10-01 · THE SENTENCE ABOVE WAS WRONG, AND THIS IS WHAT IS TRUE (review 2
// of the CodeQL stack, finding 2). The PR analysis is DIFF-INFORMED: it reports
// only alerts whose location is on a line the PR changed (#1087's own PR analysis
// had 1 result against 64 in the full run of the same commit). A new alert whose
// primary location is an UNCHANGED line never appears on refs/pull/<N>/merge, so
// this rule passes it: a PR that deletes the last use of a local declared on an
// untouched line, removes a sanitizer or a credentialOrigin() call between an
// unchanged read and an unchanged fetch, or drops a paths-ignore entry. So an alert
// CAN reach main without a disposition, and so can one a CodeQL upgrade opens.
// That residue is NOT allowed to surface as red on unrelated PRs. Two readers hold
// it instead:
//   · MAIN turns red. The last step of codeql.yml's `analyze` job runs limb C of
//     assert-alert-disposition.mjs after every analysis of main (push, schedule),
//     so the commit that let the alert in carries the red, within minutes.
//   · A PULL REQUEST sees it as MAIN DEBT. On a pull_request event limb C fails
//     only on alerts in paths the PR changes, or whose entry the PR adds,
//     removes or edits (it can fix that in the same change); every other
//     undispositioned main alert prints, and blocks nothing. The push to main, and
//     that limb C step, still fail on it.
// Why not grade the full alert set of the merge ref instead: the PR analysis
// would have to stop being diff-informed, and a full analysis per PR still cannot
// see a CodeQL upgrade or a query change landing on main — a main-side check is
// needed either way, and with it the PR rule can stay the cheap, exact-on-the-
// diff check it is.
//
// ── EXIT CODES (C-COVERAGE-LOST-IS-NOT-PASS) ────────────────────────────────
//   0  the PR's analysis was read, and every new alert it adds is dispositioned
//      in the PR's own file; OR the event is not a pull request (printed).
//   1  the PR adds a high/critical alert, or any alert its own file does not
//      disposition, or its dispositions file is malformed.
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
import { parseDispositions, CODEQL_DISPOSITIONS_REL, HOST_RULES } from './assert-alert-disposition.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

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
  return newAlerts(prOpen, mainKnown).filter((a) => PAGED_SEVERITIES.includes(a.rule?.security_severity_level));
}

/** PURE. Every alert the PR adds, of any severity: open on the PR, unknown to main. */
export function newAlerts(prOpen, mainKnown) {
  const known = new Set(mainKnown.map((a) => a.number));
  return prOpen.filter((a) => a.state === 'open' && !known.has(a.number));
}

/** PURE. The verdict on the PR's new alerts against the PR's OWN disposition
 *  entries. Returns { added, highs, undispositioned, dispositioned }. */
export function gradeNew(prOpen, mainKnown, entries) {
  const byNumber = new Map(entries.map((e) => [e.alert, e]));
  const added = newAlerts(prOpen, mainKnown);
  const out = { added, highs: [], undispositioned: [], dispositioned: [] };
  for (const a of added) {
    if (PAGED_SEVERITIES.includes(a.rule?.security_severity_level)) {
      out.highs.push(a);
      continue;
    }
    const e = byNumber.get(a.number);
    const ok = e && e.disposition === 'by-design' && HOST_RULES.includes(a.rule?.id) && e.rule === a.rule.id && e.path === a.most_recent_instance?.location?.path;
    (ok ? out.dispositioned : out.undispositioned).push(a);
  }
  return out;
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
  console.log(`assert-codeql-pr-no-new-high — a pull request adds no high/critical CodeQL alert, and no alert its own dispositions do not answer   (${repository})`);
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
  if (!eventName) {
    // No event at all is not "not a pull request": it is a run outside Actions (or
    // an Actions run whose environment was scrubbed), and nothing was graded.
    return couldNotLook('GITHUB_EVENT_NAME is not set, so there is no event, and no pull request, to grade.');
  }
  if (eventName !== 'pull_request') {
    console.log(`ok  NOT APPLICABLE — event is ${JSON.stringify(eventName ?? null)}, not a pull request — there is no PR analysis to read. The default branch is graded by assert-alert-disposition.mjs limb C.`);
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
    // The PR's OWN dispositions file — the one in this checkout, which is what merges.
    let text;
    try {
      text = probe?.dispositionsText ?? readFileSync(resolve(ROOT, CODEQL_DISPOSITIONS_REL), 'utf8');
    } catch (e) {
      console.error(`✗ ${CODEQL_DISPOSITIONS_REL} could not be read in this PR's tree (${e.message}).`);
      process.exitCode = 1;
      return;
    }
    const { entries, problems } = parseDispositions(text);
    if (problems.length) {
      console.error(`✗ ${CODEQL_DISPOSITIONS_REL} in this PR has ${problems.length} problem(s):`);
      for (const p of problems) console.error(`    ${p}`);
      process.exitCode = 1;
      return;
    }
    const v = gradeNew(prOpen, mainKnown, entries);
    const line = (a) => `    #${a.number}  ${a.rule.id}  ${a.rule.security_severity_level ?? a.rule.severity ?? ''}  ${where(a)}${a.html_url ? `  ${a.html_url}` : ''}`;
    for (const a of v.dispositioned) console.log(`    ·  new #${a.number} ${a.rule.id} ${where(a)} — by-design in this PR's ${CODEQL_DISPOSITIONS_REL}`);
    if (v.highs.length === 0 && v.undispositioned.length === 0) {
      console.log(
        `ok  PR #${number} adds ${v.added.length} new CodeQL alert(s), every one dispositioned in its own file ` +
          `(${prOpen.length} open on ${ref}; ${mainKnown.length} open or dismissed on ${DEFAULT_BRANCH}).`,
      );
      return;
    }
    if (v.highs.length) {
      console.error(`✗ PR #${number} ADDS ${v.highs.length} ${PAGED_SEVERITIES.join('/').toUpperCase()} CODEQL ALERT(S) — never dispositionable here:`);
      for (const a of v.highs) console.error(line(a));
      console.error('    Fix it in this PR. If it is a false positive, a human dismisses it on GitHub WITH a reason, and this job is re-run.');
    }
    if (v.undispositioned.length) {
      console.error(`✗ PR #${number} ADDS ${v.undispositioned.length} CODEQL ALERT(S) ITS OWN ${CODEQL_DISPOSITIONS_REL} DOES NOT DISPOSITION:`);
      for (const a of v.undispositioned) console.error(line(a));
      console.error(
        `    Fix it in this PR — or, for a ${HOST_RULES.join(' / ')} whose host you verified, add a \`by-design\` entry with\n` +
          '    that number, rule, path, reason and host to the file in THIS PR. Merged without one, it reddens every other PR.',
      );
    }
    process.exitCode = 1;
  } catch (e) {
    return couldNotLook(e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
