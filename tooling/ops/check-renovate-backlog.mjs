#!/usr/bin/env node
// -----------------------------------------------------------------------------
// check-renovate-backlog.mjs - row O-RENOVATE-BACKLOG-OUTRUNS-ITS-LIMITS, limb 3.
// Reads the Dependency Dashboard (Public issue #417) and goes red when the queue
// of updates Renovate has found but not opened grows past a ceiling, or when its
// oldest entry has waited longer than one. Both ceilings are DATA, beside this
// file, in renovate-backlog-floor.json, each with its measured basis.
//
// -- WHY IT EXISTS -------------------------------------------------------------
// Measured 2026-09-22: the queue grew from 16 entries (2026-09-03) to 21 while
// every renovate.yml run reported success. prHourlyLimit 2 x the two runs inside
// the Monday window opened at most 4 PRs a week against about 4.4 arriving, so
// the queue could only grow, and nothing said so. A green workflow is not a
// draining queue.
//
// -- THE HEADING MOVES, THE MARKER DOES NOT --------------------------------------
// The section holding the queue was "Rate-Limited" on 2026-09-21 and "Awaiting
// Schedule" a day later: Renovate names it by whether the run fell inside the
// schedule. A reader keyed on one heading is blind to the other. So an entry is
// counted by the HTML marker Renovate itself reads its checkboxes back by
// (`<!-- unschedule-branch=... -->`, `<!-- unlimit-branch=... -->`,
// `<!-- approve-branch=... -->`), under WHATEVER heading holds it; the heading is
// printed, never trusted. A dashboard that still shows a waiting section or a
// "create all" box while no waiting marker parses is COULD NOT LOOK: the grammar
// changed, and zero would be a false clean.
//
// -- THE AGE ---------------------------------------------------------------------
// The dashboard carries no dates per entry. The issue's own edit history does:
// each revision is the whole body at `editedAt`. An entry's age is measured from
// the oldest revision of the UNBROKEN run of revisions, newest first, that lists
// it as waiting. If every revision read still lists it, the age is only a LOWER
// bound; a lower bound under the ceiling proves nothing, so it is exit 2.
//
// -- AN OPEN RENOVATE PR IS STILL THE QUEUE (2026-09-27, train WD1) --------------
// The markers above are updates Renovate has found and NOT opened. The moment it
// opens one, the entry leaves them for the dashboard's "Open" list - so a red
// major PR that nobody merges used to make this reader QUIETER: one fewer waiting,
// and its age gone with it. So the same read also takes the repository's OPEN pull
// requests, and every one whose head branch carries renovate.json's branchPrefix
// (BRANCH_PREFIX, held equal to it by the test) is counted into the queue, once
// per branch. Its age is measured from the oldest revision of the unbroken run
// that names its branch under ANY marker (waiting, then open), so the days it
// waited before Monday opened it are kept; the PR's own createdAt is the floor
// when the dashboard never named it. A PR list that did not come back, or came
// back truncated, is COULD NOT LOOK: zero open PRs would be a false clean.
//
// -- A MAJOR HAS CEILINGS OF ITS OWN (2026-09-29, finding B-7 of the round-2 review) --
// renovate.json holds EVERY major behind dashboard approval, so a major drains
// only when a person ticks its box or a lane lands it by hand: the automatic
// Monday window never reaches one. The queue's two ceilings still COUNT every
// major, and a pile of majors under them used to be invisible: ten majors beside
// three patches is 13 <= 15 and green. So majors carry two more ceilings, both in
// renovate-backlog-floor.json: maxWaitingMajors (the majors alone) and
// maxOldestMajorDays (the age ceiling a major is held to, in place of
// maxOldestDays - held equal to it, so the split loosens nothing). A major is
// an entry under an `approve-branch` marker, or an open Renovate PR whose branch
// ANY revision read listed under one (approval is how its PR came to open).
//
// -- FAIL-CLOSED, AND WHAT EACH EXIT MEANS ---------------------------------------
//   0 - the dashboard was read; the waiting count, the majors' count and every
//       age are at or under their ceilings. The numbers are printed.
//   1 - a ceiling is passed. Names the count or the oldest entries and their age.
//   2 - COULD NOT LOOK: no token, the API refused, the issue is not an open
//       Dependency Dashboard, the grammar changed, the floor file is unreadable,
//       or an age could not be established. NEVER 0.
//
// -- IT MUST NOT FREEZE THE MERGE THAT DRAINS IT ----------------------------------
// A backlog clears only by merging Renovate's PRs. A verdict from this file that
// blocked ci.yml's push run would freeze exactly that merge (backup-19). Which
// host runs it, and under which register row, is decided with the row - see the
// lane notes - and is NOT decided here.
//
// Usage:  node tooling/ops/check-renovate-backlog.mjs [--json]
// Env:    GH_TOKEN or GITHUB_TOKEN (issues: read AND pull-requests: read on the
//         Public repository; a workflow that runs this must grant both)
//
// `process.exit()` IS BANNED IN THIS FILE, the same rule its neighbours in
// tooling/ops carry: set `process.exitCode`.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';
import { CODEHOST } from '../generated/codehost.mjs';

export { CouldNotLook } from './bounded-retry.mjs';

export const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
export const FLOOR_FILE = new URL('./renovate-backlog-floor.json', import.meta.url);
/** Revisions of the dashboard read per run. Renovate edited #417 26 times in 19
 *  days (2026-09-03 to 2026-09-22), so this reaches several weeks back; an age it
 *  cannot reach the start of is a lower bound and handled as one. */
export const EDITS_READ = 60;
export const DAY_MS = 86_400_000;

/** The markers Renovate writes on an entry it has FOUND and NOT OPENED. */
export const WAITING_KINDS = Object.freeze(['unschedule-branch', 'unlimit-branch', 'approve-branch']);
/** Headings Renovate has used for a waiting section. Printed, and used only to
 *  notice that a waiting section exists while no marker parses. */
export const WAITING_HEADINGS = Object.freeze(['Awaiting Schedule', 'Rate-Limited', 'Pending Approval']);
/** renovate.json `branchPrefix`. An open PR whose head branch starts with it is
 *  Renovate's, and is still the queue until it merges. */
export const BRANCH_PREFIX = 'chore/renovate-';
/** Open pull requests read per run. The repository carries a handful at a time;
 *  a list longer than this is COULD NOT LOOK, never a partial count. */
export const PRS_READ = 100;
/** The marker Renovate writes on an update held for dashboard approval. Every
 *  major is held (renovate.json `dependencyDashboardApproval` on majors), so this
 *  marker is what a major is on #417. */
export const MAJOR_KIND = 'approve-branch';

const ENTRY = /^\s*-\s+\[[ xX]\]\s+<!--\s*([a-z-]+)=(\S+?)\s*-->(.*)$/;
const HEADING = /^##\s+(.+?)\s*$/;
const CREATE_ALL = /<!--\s*create-all-[a-z-]+\s*-->/;

/** PURE. Every waiting entry in one dashboard body, with the heading it sat under. */
export function waitingEntries(body) {
  const out = [];
  let heading = null;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) {
      heading = h[1];
      continue;
    }
    const e = ENTRY.exec(line);
    if (e && WAITING_KINDS.includes(e[1])) out.push({ kind: e[1], branch: e[2], title: e[3].trim(), heading });
  }
  return out;
}

/** PURE. Does the body still SHOW a waiting section, whatever parses out of it? */
export function showsWaitingSection(body) {
  const text = String(body ?? '');
  if (CREATE_ALL.test(text)) return true;
  return text.split(/\r?\n/).some((l) => {
    const h = HEADING.exec(l);
    return h && WAITING_HEADINGS.includes(h[1]);
  });
}

/** PURE. Every branch the body names under ANY `<!-- kind=branch -->` marker -
 *  waiting, open or closed. Ages an open PR's branch across the day it opened. */
export function namedBranches(body) {
  const out = new Set();
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const e = ENTRY.exec(line);
    if (e) out.add(e[2]);
  }
  return out;
}

/** PURE. Every branch the body lists under the approval marker - a major. */
export function approvalBranches(body) {
  return new Set(waitingEntries(body).filter((e) => e.kind === MAJOR_KIND).map((e) => e.branch));
}

/** PURE. When each waiting branch joined the queue, from revisions newest first.
 *  `names` says which branches a revision lists (default: its waiting markers).
 *  Returns Map branch -> { since: ISO, lowerBound: boolean }. */
export function firstSeen(branches, revisions, { complete, names = (b) => new Set(waitingEntries(b).map((e) => e.branch)) }) {
  const seen = new Map();
  const sets = revisions.map((r) => ({ at: r.editedAt, set: names(r.diff) }));
  for (const b of branches) {
    let since = null;
    let broke = false;
    for (const r of sets) {
      if (!r.set.has(b)) {
        broke = true;
        break;
      }
      since = r.at;
    }
    // Never seen in history (the history is older than the current body): it
    // joined at the latest edit, which is the current body itself.
    seen.set(b, { since, lowerBound: !broke && !complete });
  }
  return seen;
}

/** PURE. The floor file, or a reason it cannot be used. */
export function readFloor(raw) {
  let f;
  try {
    f = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return { error: `renovate-backlog-floor.json is not JSON (${e.message})` };
  }
  for (const key of ['maxWaiting', 'maxOldestDays', 'maxWaitingMajors', 'maxOldestMajorDays']) {
    const v = f?.[key];
    if (!Number.isFinite(v?.value) || v.value <= 0) return { error: `renovate-backlog-floor.json ${key}.value is not a positive number` };
    if (typeof v?.basis !== 'string' || v.basis.length < 40) return { error: `renovate-backlog-floor.json ${key}.basis is missing or shorter than 40 characters: a ceiling without its measurement is a guess` };
  }
  if (!Number.isInteger(f?.issue) || f.issue <= 0) return { error: 'renovate-backlog-floor.json issue is not the dashboard issue number' };
  // A majors ceiling looser than the queue's is not a ceiling of their own: the
  // queue's would always fire first, and the majors limb could never fail.
  if (f.maxWaitingMajors.value >= f.maxWaiting.value) return { error: 'renovate-backlog-floor.json maxWaitingMajors.value is not below maxWaiting.value, so it could never be the ceiling that fires' };
  if (f.maxOldestMajorDays.value > f.maxOldestDays.value) return { error: 'renovate-backlog-floor.json maxOldestMajorDays.value is above maxOldestDays.value: splitting majors out must not loosen the age they were held to' };
  return {
    issue: f.issue,
    maxWaiting: f.maxWaiting.value,
    maxOldestDays: f.maxOldestDays.value,
    maxWaitingMajors: f.maxWaitingMajors.value,
    maxOldestMajorDays: f.maxOldestMajorDays.value,
  };
}

/** PURE. The verdict, so every branch is reachable from a test with no network. */
export function judge({ issue, floor, now }) {
  const title = String(issue?.title ?? '');
  for (const key of ['maxWaiting', 'maxOldestDays', 'maxWaitingMajors', 'maxOldestMajorDays']) {
    if (!Number.isFinite(floor?.[key])) return { code: 2, lines: [`x COULD NOT LOOK - the floor carries no ${key}, so that ceiling cannot be judged.`] };
  }
  if (!/Dependency Dashboard/.test(title)) {
    return { code: 2, lines: [`x COULD NOT LOOK - the issue read is titled "${title}", not a Renovate Dependency Dashboard.`] };
  }
  if (issue?.state !== 'OPEN') {
    return { code: 2, lines: [`x COULD NOT LOOK - the Dependency Dashboard issue is ${issue?.state}; Renovate may be writing a new one.`] };
  }
  if (typeof issue?.body !== 'string' || issue.body.length === 0) {
    return { code: 2, lines: ['x COULD NOT LOOK - the Dependency Dashboard body came back empty.'] };
  }
  const entries = waitingEntries(issue.body);
  if (entries.length === 0 && showsWaitingSection(issue.body)) {
    return {
      code: 2,
      lines: [
        'x COULD NOT LOOK - the dashboard shows a waiting section or a "create all" box, but no waiting marker parsed.',
        `    markers read: ${WAITING_KINDS.join(', ')}. Renovate changed its grammar; zero here would be a false clean.`,
      ],
    };
  }
  const edits = issue?.userContentEdits;
  const revisions = Array.isArray(edits?.nodes) ? [...edits.nodes].sort((a, b) => String(b.editedAt).localeCompare(String(a.editedAt))) : null;
  if (entries.length > 0 && (!revisions || revisions.length === 0)) {
    return { code: 2, lines: ['x COULD NOT LOOK - the dashboard lists waiting entries but its edit history came back empty, so no age can be measured.'] };
  }
  const pulls = issue?.openPullRequests;
  if (!Array.isArray(pulls?.nodes)) {
    return {
      code: 2,
      lines: ['x COULD NOT LOOK - the repository\'s open pull requests did not come back, so an OPEN Renovate PR (which leaves the waiting list) could not be counted.'],
    };
  }
  if (Number.isInteger(pulls.totalCount) && pulls.totalCount > pulls.nodes.length) {
    return {
      code: 2,
      lines: [`x COULD NOT LOOK - ${pulls.totalCount} open pull requests exist and ${pulls.nodes.length} were read, so the open Renovate PRs among them cannot all be counted.`],
    };
  }
  const waitingBranches = new Set(entries.map((e) => e.branch));
  // Once per branch: a dashboard written before the PR opened still lists it as waiting.
  const opened = pulls.nodes.filter((p) => String(p?.headRefName ?? '').startsWith(BRANCH_PREFIX) && !waitingBranches.has(p.headRefName));
  const undated = opened.filter((p) => !Number.isFinite(Date.parse(String(p?.createdAt ?? ''))));
  if (undated.length > 0) {
    return { code: 2, lines: [`x COULD NOT LOOK - open Renovate PR #${undated[0].number} (${undated[0].headRefName}) came back with no createdAt, so its age is unknown.`] };
  }
  const complete = revisions ? revisions.length >= (edits.totalCount ?? Infinity) : false;
  const ages = entries.length > 0 ? firstSeen(entries.map((e) => e.branch), revisions, { complete }) : new Map();
  const listed = opened.length > 0 && revisions ? firstSeen(opened.map((p) => p.headRefName), revisions, { complete, names: namedBranches }) : new Map();
  const updatedAt = String(issue.updatedAt ?? '');
  const aged = entries.map((e) => {
    const s = ages.get(e.branch);
    const since = s?.since ?? updatedAt;
    return { ...e, since, lowerBound: s?.lowerBound === true, days: (now - Date.parse(since)) / DAY_MS };
  });
  for (const p of opened) {
    const s = listed.get(p.headRefName);
    const since = s?.since && Date.parse(s.since) < Date.parse(p.createdAt) ? s.since : p.createdAt;
    aged.push({ kind: 'open-pr', branch: p.headRefName, title: String(p.title ?? ''), heading: null, pr: p.number, since, lowerBound: s?.lowerBound === true, days: (now - Date.parse(since)) / DAY_MS });
  }
  // A major: under the approval marker now, or an open PR any revision listed there.
  const approvedOnce = new Set();
  for (const r of revisions ?? []) for (const b of approvalBranches(r.diff)) approvedOnce.add(b);
  for (const a of aged) {
    a.major = a.kind === MAJOR_KIND || (a.kind === 'open-pr' && approvedOnce.has(a.branch));
    a.ceiling = a.major ? floor.maxOldestMajorDays : floor.maxOldestDays;
  }
  aged.sort((a, b) => b.days - a.days);
  const oldest = aged[0];
  const majors = aged.filter((a) => a.major);
  const headings = [...new Set(entries.map((e) => e.heading ?? '(none)'))];
  const queue = entries.length + opened.length;
  const measured = {
    asOf: updatedAt,
    waiting: entries.length,
    open: opened.length,
    queue,
    majors: majors.length,
    oldestDays: oldest ? Number(oldest.days.toFixed(1)) : 0,
    oldestMajorDays: majors[0] ? Number(majors[0].days.toFixed(1)) : 0,
    oldestBranch: oldest?.branch ?? null,
    headings,
  };
  const findings = [];
  if (queue > floor.maxWaiting) {
    findings.push(
      `x THE RENOVATE QUEUE IS ${queue} UPDATES, past its ceiling of ${floor.maxWaiting} (renovate-backlog-floor.json): ` +
        `${entries.length} waiting on the dashboard + ${opened.length} open Renovate PR(s).`,
    );
  }
  if (majors.length > floor.maxWaitingMajors) {
    findings.push(
      `x ${majors.length} MAJORS WAIT FOR A PERSON, past their own ceiling of ${floor.maxWaitingMajors} (renovate-backlog-floor.json maxWaitingMajors): ` +
        'no Monday window drains a major; each needs its approve box ticked or a lane that lands it by hand.',
    );
  }
  const tooOld = aged.filter((a) => a.days > a.ceiling);
  for (const [group, head] of [
    [tooOld.filter((a) => !a.major), `UPDATE(S) HAVE WAITED LONGER THAN ${floor.maxOldestDays} DAYS (renovate-backlog-floor.json)`],
    [tooOld.filter((a) => a.major), `MAJOR(S) HAVE WAITED LONGER THAN ${floor.maxOldestMajorDays} DAYS (renovate-backlog-floor.json maxOldestMajorDays)`],
  ]) {
    if (group.length === 0) continue;
    findings.push(`x ${group.length} ${head}:`);
    for (const a of group.slice(0, 10)) findings.push(`    ${a.days.toFixed(1)}d${a.lowerBound ? '+' : ''}  ${a.branch}  since ${a.since}${a.pr ? `  (open PR #${a.pr})` : ''}`);
  }
  if (findings.length > 0) {
    return {
      code: 1,
      measured,
      lines: [
        ...findings,
        `    read from #417 at ${updatedAt}, heading(s): ${headings.join(' / ')}.`,
        '    The queue drains only by Renovate opening PRs and someone merging them. Read renovate.json',
        '    prHourlyLimit / prConcurrentLimit against the arrival rate, and look for majors waiting on a hand merge.',
        '    An open Renovate PR stays in the count, with the days it waited before it opened, until it merges.',
        '    NEVER tick "create all" on the dashboard: every PR at once runs full CI and exhausts the GitHub API.',
      ],
    };
  }
  const unproven = aged.filter((a) => a.lowerBound && a.days <= a.ceiling);
  if (unproven.length > 0) {
    return {
      code: 2,
      measured,
      lines: [
        `x COULD NOT LOOK - ${unproven.length} waiting entr(ies) are listed in every one of the ${revisions.length} revisions read,`,
        `    so their age is only a lower bound (e.g. ${unproven[0].branch}, >= ${unproven[0].days.toFixed(1)}d), and a lower bound under the ceiling proves nothing.`,
      ],
    };
  }
  return {
    code: 0,
    measured,
    lines: [
      `ok  renovate queue ${queue} <= ${floor.maxWaiting}, oldest ${measured.oldestDays}d <= ${floor.maxOldestDays}d` +
        ` (${entries.length} waiting + ${opened.length} open Renovate PR(s))` +
        `; majors ${majors.length} <= ${floor.maxWaitingMajors}, oldest major ${measured.oldestMajorDays}d <= ${floor.maxOldestMajorDays}d` +
        ` - #417 at ${updatedAt}, ${revisions ? revisions.length : 0} revision(s) read, heading(s): ${headings.join(' / ') || '(none waiting)'}`,
    ],
  };
}

const QUERY = `query($owner:String!,$name:String!,$number:Int!,$edits:Int!,$prs:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){
      title state body updatedAt
      userContentEdits(first:$edits){ totalCount nodes { editedAt diff } }
    }
    pullRequests(states:OPEN,first:$prs,orderBy:{field:CREATED_AT,direction:ASC}){
      totalCount nodes { number title headRefName createdAt }
    }
  }
}`;

/**
 * ONE GraphQL read on the shared bounded plan (tooling/ops/bounded-retry.mjs).
 * The verb is POST but the request is a query: it changes nothing, so re-sending
 * one that never answered is safe. That decision is recorded HERE, at the call
 * site, as bounded-retry.mjs's isSafeMethod note asks.
 *
 * `doFetch` IS A TEST SEAM. vacuous-10: it renames the call site, and the B8
 * adoption sweep in ops-bounded-retry.test.mjs matches `doFetch(` for exactly
 * that reason.
 *
 * NO TIMER OF ITS OWN. The per-request ceiling is armed by readWithBoundedRetry
 * on every attempt and handed in as `signal`; this read passes it to the fetch
 * and arms nothing else (B8 "NO RIVAL CEILING").
 */
export async function readDashboard({ owner, name, number, token, sleep, note, doFetch = fetch }) {
  return readWithBoundedRetry(
    async (_attempt, { signal }) => {
      let res;
      try {
        res = await doFetch(GITHUB_GRAPHQL, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ query: QUERY, variables: { owner, name, number, edits: EDITS_READ, prs: PRS_READ } }),
          signal,
        });
      } catch (e) {
        throw classifyThrown(e, `the GraphQL read of #${number} did not answer (${e?.name ?? 'error'}: ${e?.message ?? e})`);
      }
      let text;
      try {
        text = await res.text();
      } catch (e) {
        throw classifyThrown(e, `the GraphQL read answered HTTP ${res.status} and then dropped mid-body (${e?.message ?? e})`);
      }
      if (!res.ok) {
        const line = `the GraphQL read answered HTTP ${res.status}: ${text.slice(0, 300)}`;
        throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new CouldNotLook(`the GraphQL read answered unparseable JSON: ${text.slice(0, 200)}`);
      }
      if (Array.isArray(body?.errors) && body.errors.length > 0) {
        throw new CouldNotLook(`the GraphQL read returned errors: ${JSON.stringify(body.errors).slice(0, 300)}`);
      }
      const repository = body?.data?.repository;
      const issue = repository?.issue;
      if (!issue) throw new CouldNotLook(`issue #${number} did not come back from the GraphQL read`);
      // Not an issue field: the repository's open PRs, from the same read. judge()
      // refuses a missing list rather than counting it as none.
      return { ...issue, openPullRequests: repository.pullRequests ?? null };
    },
    { sleep, note },
  );
}

async function main(argv) {
  const json = argv.includes('--json');
  const owner = CODEHOST.org;
  const name = 'Nikatru_Platform_Public';
  console.log(`check-renovate-backlog - the Dependency Dashboard of ${owner}/${name}   (O-RENOVATE-BACKLOG-OUTRUNS-ITS-LIMITS)`);
  let floorRaw;
  try {
    floorRaw = readFileSync(FLOOR_FILE, 'utf8');
  } catch (e) {
    console.error(`x COULD NOT LOOK - renovate-backlog-floor.json could not be read (${e.message}). That is exit 2, never a pass.`);
    process.exitCode = 2;
    return;
  }
  const floor = readFloor(floorRaw);
  if (floor.error) {
    console.error(`x COULD NOT LOOK - ${floor.error}. That is exit 2, never a pass.`);
    process.exitCode = 2;
    return;
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('x COULD NOT LOOK - neither GH_TOKEN nor GITHUB_TOKEN is in the environment, so #417 was not read.');
    console.error('    Nothing about the Renovate queue is known from this run. That is exit 2, never a pass.');
    process.exitCode = 2;
    return;
  }
  let issue;
  try {
    issue = await readDashboard({ owner, name, number: floor.issue, token, note: (l) => console.error(`    ${l}`) });
  } catch (e) {
    console.error(`x COULD NOT LOOK - ${e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`}`);
    console.error('    Nothing about the Renovate queue is known from this run. That is exit 2, never a pass.');
    process.exitCode = 2;
    return;
  }
  const v = judge({ issue, floor, now: Date.now() });
  for (const line of v.lines) (v.code === 0 ? console.log : console.error)(line);
  if (json && v.measured) console.log(JSON.stringify(v.measured));
  process.exitCode = v.code;
}

if (process.argv[1] && process.argv[1].endsWith('check-renovate-backlog.mjs')) {
  await main(process.argv.slice(2));
}
