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
// -- FAIL-CLOSED, AND WHAT EACH EXIT MEANS ---------------------------------------
//   0 - the dashboard was read; the waiting count and the oldest age are both at
//       or under their ceilings. Both numbers are printed.
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
// Env:    GH_TOKEN or GITHUB_TOKEN (issues: read on the Public repository)
//
// `process.exit()` IS BANNED IN THIS FILE, the same rule its neighbours in
// tooling/ops carry: set `process.exitCode`.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';

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

/** PURE. When each waiting branch joined the queue, from revisions newest first.
 *  Returns Map branch -> { since: ISO, lowerBound: boolean }. */
export function firstSeen(branches, revisions, { complete }) {
  const seen = new Map();
  const sets = revisions.map((r) => ({ at: r.editedAt, set: new Set(waitingEntries(r.diff).map((e) => e.branch)) }));
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
  for (const key of ['maxWaiting', 'maxOldestDays']) {
    const v = f?.[key];
    if (!Number.isFinite(v?.value) || v.value <= 0) return { error: `renovate-backlog-floor.json ${key}.value is not a positive number` };
    if (typeof v?.basis !== 'string' || v.basis.length < 40) return { error: `renovate-backlog-floor.json ${key}.basis is missing or shorter than 40 characters: a ceiling without its measurement is a guess` };
  }
  if (!Number.isInteger(f?.issue) || f.issue <= 0) return { error: 'renovate-backlog-floor.json issue is not the dashboard issue number' };
  return { issue: f.issue, maxWaiting: f.maxWaiting.value, maxOldestDays: f.maxOldestDays.value };
}

/** PURE. The verdict, so every branch is reachable from a test with no network. */
export function judge({ issue, floor, now }) {
  const title = String(issue?.title ?? '');
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
  const complete = revisions ? revisions.length >= (edits.totalCount ?? Infinity) : false;
  const ages = entries.length > 0 ? firstSeen(entries.map((e) => e.branch), revisions, { complete }) : new Map();
  const updatedAt = String(issue.updatedAt ?? '');
  const aged = entries.map((e) => {
    const s = ages.get(e.branch);
    const since = s?.since ?? updatedAt;
    return { ...e, since, lowerBound: s?.lowerBound === true, days: (now - Date.parse(since)) / DAY_MS };
  });
  aged.sort((a, b) => b.days - a.days);
  const oldest = aged[0];
  const headings = [...new Set(entries.map((e) => e.heading ?? '(none)'))];
  const measured = {
    asOf: updatedAt,
    waiting: entries.length,
    oldestDays: oldest ? Number(oldest.days.toFixed(1)) : 0,
    oldestBranch: oldest?.branch ?? null,
    headings,
  };
  const findings = [];
  if (entries.length > floor.maxWaiting) {
    findings.push(`x THE RENOVATE QUEUE IS ${entries.length} UPDATES, past its ceiling of ${floor.maxWaiting} (renovate-backlog-floor.json).`);
  }
  const tooOld = aged.filter((a) => a.days > floor.maxOldestDays);
  if (tooOld.length > 0) {
    findings.push(`x ${tooOld.length} UPDATE(S) HAVE WAITED LONGER THAN ${floor.maxOldestDays} DAYS (renovate-backlog-floor.json):`);
    for (const a of tooOld.slice(0, 10)) findings.push(`    ${a.days.toFixed(1)}d${a.lowerBound ? '+' : ''}  ${a.branch}  since ${a.since}`);
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
        '    NEVER tick "create all" on the dashboard: every PR at once runs full CI and exhausts the GitHub API.',
      ],
    };
  }
  const unproven = aged.filter((a) => a.lowerBound && a.days <= floor.maxOldestDays);
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
      `ok  renovate queue ${entries.length} <= ${floor.maxWaiting}, oldest ${measured.oldestDays}d <= ${floor.maxOldestDays}d` +
        ` - #417 at ${updatedAt}, ${revisions ? revisions.length : 0} revision(s) read, heading(s): ${headings.join(' / ') || '(none waiting)'}`,
    ],
  };
}

const QUERY = `query($owner:String!,$name:String!,$number:Int!,$edits:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){
      title state body updatedAt
      userContentEdits(first:$edits){ totalCount nodes { editedAt diff } }
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
          body: JSON.stringify({ query: QUERY, variables: { owner, name, number, edits: EDITS_READ } }),
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
      const issue = body?.data?.repository?.issue;
      if (!issue) throw new CouldNotLook(`issue #${number} did not come back from the GraphQL read`);
      return issue;
    },
    { sleep, note },
  );
}

async function main(argv) {
  const json = argv.includes('--json');
  const owner = 'globalonlinedeveloper';
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
