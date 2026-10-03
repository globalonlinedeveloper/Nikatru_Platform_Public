#!/usr/bin/env node
// -----------------------------------------------------------------------------
// check-code-scanning-age.mjs - finding P-9. Reads the repository's OPEN GitHub
// code-scanning alerts and goes red when a high or critical one has stood
// untriaged longer than MAX_AGE_DAYS.
//
// -- WHY IT EXISTS -------------------------------------------------------------
// Measured 2026-09-29: 146 code-scanning alerts open, 31 high and 0 critical,
// none dismissed with a reason, 26 of them new since 2026-09-24. Nothing in
// tooling/ or .github/ read them: CodeQL wrote them and they aged in a tab nobody
// opened. An alert list nobody reads is the "zero readers" shape, and a scanner
// whose output is never judged is a scanner that is not running.
//
// -- THE POLICY ----------------------------------------------------------------
//   · PAGED: security_severity_level `high` or `critical`, OPEN, created more
//     than MAX_AGE_DAYS ago. Each is printed (number, rule, severity, age,
//     path:line, url) and the run exits 1. One threshold for both levels: there
//     are 0 critical today and a stricter number for them would be a guess.
//   · PENDING: a paged-level alert younger than that is printed and is exit 0 -
//     a week is the triage window, not the fix window.
//   · COUNTED ONLY: medium, low and alerts with no security severity (quality
//     rules). They are in the summary line and never page.
//   · TRIAGED: `fixed`, and `dismissed` WITH a non-empty dismissed_reason. 🔴 A
//     dismissal with NO reason is NOT triage: it is graded exactly like an open
//     alert, because a click with no reason is how an alert disappears without
//     anyone deciding anything. (The live read asks for state=open only, so this
//     limb bites on a fixture or a future all-states read; it is stated so the
//     rule does not depend on which query fed it.)
//
// -- FAIL-CLOSED, AND WHAT EACH EXIT MEANS ---------------------------------------
//   0 - the list was read; no paged-level alert is past its window. The summary
//       line says how many alerts were read, including "0 open alerts read".
//   1 - at least one high/critical alert is past MAX_AGE_DAYS untriaged.
//   2 - COULD NOT LOOK: no token, the API refused (403 without security-events:
//       read, 404 with code scanning off), a page that is not a JSON array, an
//       item missing number/state/created_at/rule, a severity outside the enum,
//       a list truncated at MAX_PAGES, or a non-empty list in which NO alert
//       carries rule.security_severity_level (the field this reader grades by is
//       gone, and "0 high" would be a false clean). NEVER 0.
//   An EMPTY list from the API is legitimately 0 alerts: exit 0, said out loud.
//
// Usage:  node tooling/ops/check-code-scanning-age.mjs [--now <iso>] [--fixture <alerts.json>] [--json]
// Env:    GH_TOKEN or GITHUB_TOKEN (security-events: read), GITHUB_REPOSITORY
//         (owner/name; defaults to the Public repository)
//   --fixture reads the alert list (one JSON array, the pages concatenated) from
//   a file instead of the API; --now pins the clock. Both are the test seam.
//
// `process.exit()` IS BANNED IN THIS FILE, the same rule its neighbours in
// tooling/ops carry: set `process.exitCode`.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { CouldNotLook, fetchWithBoundedRetry } from './bounded-retry.mjs';
import { PLATFORM_REPO_SLUG } from '../generated/codehost.mjs';

export { CouldNotLook } from './bounded-retry.mjs';

export const GITHUB_API = 'https://api.github.com';
export const DEFAULT_REPOSITORY = PLATFORM_REPO_SLUG;
/** The triage window for a paged-level alert. Judgement, not a measurement:
 *  one week covers a weekly ops-watch slot plus a working week to look. */
export const MAX_AGE_DAYS = 7;
export const DAY_MS = 86_400_000;
/** The levels that page. Everything else is counted and printed, never paged. */
export const PAGED_SEVERITIES = Object.freeze(['critical', 'high']);
/** GitHub's security_severity_level enum. `none` is this file's name for null
 *  (a quality rule with no security severity). Anything else is a shape change. */
export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);
export const STATES = Object.freeze(['open', 'dismissed', 'fixed']);
export const PER_PAGE = 100;
/** Pages read per run. 146 alerts is two pages; a list still continuing after
 *  this many is COULD NOT LOOK, never a partial count. */
export const MAX_PAGES = 20;

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** PURE. Why this item is not a code-scanning alert this reader can grade, or null. */
export function shapeProblem(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'an item is not an object';
  if (!Number.isInteger(a.number)) return 'an item has no integer `number`';
  if (!STATES.includes(a.state)) return `alert #${a.number} has state ${JSON.stringify(a.state)}, not one of ${STATES.join('/')}`;
  if (!Number.isFinite(Date.parse(String(a.created_at ?? '')))) return `alert #${a.number} has no parseable \`created_at\``;
  if (!a.rule || typeof a.rule !== 'object') return `alert #${a.number} has no \`rule\` object`;
  const s = a.rule.security_severity_level;
  if (s != null && !SEVERITIES.includes(s)) return `alert #${a.number} has rule.security_severity_level ${JSON.stringify(s)}, not one of ${SEVERITIES.join('/')}`;
  return null;
}

/** PURE. Is this alert settled by a human or by a fix? A dismissal with no
 *  reason is NOT triage (header, THE POLICY). */
export function isTriaged(a) {
  if (a.state === 'fixed') return true;
  return a.state === 'dismissed' && nonEmpty(a.dismissed_reason);
}

const where = (a) => {
  const loc = a?.most_recent_instance?.location;
  return loc?.path ? `${loc.path}${Number.isInteger(loc.start_line) ? `:${loc.start_line}` : ''}` : '(no location)';
};

const line = (a) =>
  `    #${a.number}  ${a.rule.id ?? '(no rule id)'}  ${a.rule.security_severity_level}  ${a.days.toFixed(1)}d` +
  `${a.state === 'dismissed' ? '  (dismissed WITHOUT a reason)' : ''}  ${where(a)}${a.html_url ? `  ${a.html_url}` : ''}`;

/** PURE. The verdict over an alert list, so every branch is reachable from a test
 *  with no network. Returns { code, lines, measured? }. */
export function judge(alerts, { now, maxAgeDays = MAX_AGE_DAYS } = {}) {
  if (!Array.isArray(alerts)) {
    return { code: 2, lines: [`x COULD NOT LOOK - the alert list is ${alerts === null ? 'null' : typeof alerts}, not an array.`] };
  }
  if (!Number.isFinite(now)) return { code: 2, lines: ['x COULD NOT LOOK - the clock is not a finite instant.'] };
  for (const a of alerts) {
    const p = shapeProblem(a);
    if (p) return { code: 2, lines: [`x COULD NOT LOOK - ${p}. The response shape changed; grading what parsed would be a partial count.`] };
  }
  if (alerts.length > 0 && !alerts.some((a) => a.rule.security_severity_level != null)) {
    return {
      code: 2,
      lines: [
        `x COULD NOT LOOK - ${alerts.length} alert(s) read and not one carries rule.security_severity_level,`,
        '    the field this reader grades by. "0 high" here would be a false clean.',
      ],
    };
  }
  const bySeverity = Object.fromEntries([...SEVERITIES, 'none'].map((s) => [s, 0]));
  const byState = Object.fromEntries(STATES.map((s) => [s, 0]));
  const overdue = [];
  const pending = [];
  for (const a of alerts) {
    const sev = a.rule.security_severity_level ?? 'none';
    byState[a.state] += 1;
    if (isTriaged(a)) continue;
    bySeverity[sev] += 1;
    if (!PAGED_SEVERITIES.includes(sev)) continue;
    const days = (now - Date.parse(a.created_at)) / DAY_MS;
    (days > maxAgeDays ? overdue : pending).push({ ...a, days });
  }
  overdue.sort((x, y) => y.days - x.days);
  pending.sort((x, y) => y.days - x.days);
  const untriaged = Object.values(bySeverity).reduce((x, y) => x + y, 0);
  const measured = { read: alerts.length, untriaged, bySeverity, byState, overdue: overdue.length, pending: pending.length, maxAgeDays };
  const summary =
    alerts.length === 0
      ? '    0 open alerts read (the API answered an empty list).'
      : `    ${alerts.length} alert(s) read · untriaged by severity: ` +
        `critical ${bySeverity.critical} · high ${bySeverity.high} · medium ${bySeverity.medium} · low ${bySeverity.low} · none ${bySeverity.none}` +
        ` · by state: open ${byState.open} · dismissed ${byState.dismissed} · fixed ${byState.fixed}`;
  const pendingLines = pending.length
    ? [`    ${pending.length} ${PAGED_SEVERITIES.join('/')} alert(s) PENDING, inside the ${maxAgeDays}-day triage window:`, ...pending.map(line)]
    : [];
  if (overdue.length > 0) {
    return {
      code: 1,
      measured,
      lines: [
        `x ${overdue.length} ${PAGED_SEVERITIES.join('/').toUpperCase()} CODE-SCANNING ALERT(S) UNTRIAGED FOR MORE THAN ${maxAgeDays} DAYS:`,
        ...overdue.map(line),
        summary,
        ...pendingLines,
        '    Fix it, or dismiss it on GitHub WITH a reason (false positive / won\'t fix / used in tests).',
        '    A dismissal with no reason is graded as still open. MAX_AGE_DAYS is never raised to clear the red.',
      ],
    };
  }
  return {
    code: 0,
    measured,
    lines: [`ok  no ${PAGED_SEVERITIES.join('/')} code-scanning alert is untriaged past ${maxAgeDays} days`, summary, ...pendingLines],
  };
}

/** PURE. The `rel="next"` URL of a Link header, or null. */
export function nextLink(header) {
  for (const part of String(header ?? '').split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return null;
}

/**
 * Every open alert, page by page, each GET on the shared bounded plan
 * (tooling/ops/bounded-retry.mjs). GET is a safe method, so re-sending one that
 * never answered is safe.
 *
 * `doFetch` IS A TEST SEAM. vacuous-10: it renames the call site, and the B8
 * adoption sweep in ops-bounded-retry.test.mjs matches `doFetch(` for exactly
 * that reason. No timer of its own: the per-request ceiling is armed by the
 * shared plan and handed in as `signal`.
 *
 * `state` and `ref` exist for tooling/ci/assert-alert-disposition.mjs limb C
 * (which also reads `dismissed`) and tooling/ci/assert-codeql-pr-no-new-high.mjs
 * (which reads a pull request's merge ref). The defaults are this file's own read.
 */
export async function readAlerts({ repository, token, sleep, note, doFetch = fetch, maxPages = MAX_PAGES, state = 'open', ref = null }) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  let url = `${GITHUB_API}/repos/${repository}/code-scanning/alerts?state=${state}&per_page=${PER_PAGE}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
  const all = [];
  for (let page = 1; url; page += 1) {
    if (page > maxPages) {
      throw new CouldNotLook(`the alert list still continued after ${maxPages} page(s) (${all.length} alerts read), so the count would be partial`);
    }
    const at = url;
    const res = await fetchWithBoundedRetry(({ signal }) => doFetch(at, { headers, signal }), { sleep, note, describe: (why) => `GET ${at}: ${why}` });
    let text;
    try {
      text = await res.text();
    } catch (e) {
      throw new CouldNotLook(`GET ${at} answered HTTP ${res.status} and then dropped mid-body (${e?.message ?? e})`);
    }
    if (!res.ok) {
      throw new CouldNotLook(
        `GET ${at} answered HTTP ${res.status}: ${text.slice(0, 300)}` +
          (res.status === 403 ? ' (the token needs security-events: read)' : res.status === 404 ? ' (code scanning may be off, or the repository name is wrong)' : ''),
      );
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CouldNotLook(`GET ${at} answered unparseable JSON: ${text.slice(0, 200)}`);
    }
    if (!Array.isArray(body)) throw new CouldNotLook(`GET ${at} answered ${JSON.stringify(body).slice(0, 200)}, not an array of alerts`);
    all.push(...body);
    url = nextLink(res.headers?.get?.('link'));
  }
  return all;
}

const flagOf = (argv, name) => {
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};

async function main(argv) {
  const json = argv.includes('--json');
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  console.log(`check-code-scanning-age - open code-scanning alerts of ${repository}   (P-9)`);
  const nowFlag = flagOf(argv, '--now');
  const now = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (!Number.isFinite(now)) {
    console.error(`x COULD NOT LOOK - --now is not a parseable date: ${nowFlag}. That is exit 2, never a pass.`);
    process.exitCode = 2;
    return;
  }
  let alerts;
  const fixture = flagOf(argv, '--fixture');
  if (argv.includes('--fixture') && !fixture) {
    console.error('x COULD NOT LOOK - --fixture was given with no file. That is exit 2, never a pass.');
    process.exitCode = 2;
    return;
  }
  if (fixture) {
    console.log('!!  OFFLINE FIXTURE MODE - --fixture is set. This must NEVER appear in a real ops-watch log.');
    try {
      alerts = JSON.parse(readFileSync(fixture, 'utf8'));
    } catch (e) {
      console.error(`x COULD NOT LOOK - the fixture ${fixture} could not be read as JSON (${e.message}). That is exit 2, never a pass.`);
      process.exitCode = 2;
      return;
    }
  } else {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('x COULD NOT LOOK - neither GH_TOKEN nor GITHUB_TOKEN is in the environment, so no alert was read.');
      console.error('    Nothing about the code-scanning alerts is known from this run. That is exit 2, never a pass.');
      process.exitCode = 2;
      return;
    }
    try {
      alerts = await readAlerts({ repository, token, note: (l) => console.error(`    ${l}`) });
    } catch (e) {
      console.error(`x COULD NOT LOOK - ${e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`}`);
      console.error('    Nothing about the code-scanning alerts is known from this run. That is exit 2, never a pass.');
      process.exitCode = 2;
      return;
    }
  }
  const v = judge(alerts, { now });
  for (const l of v.lines) (v.code === 0 ? console.log : console.error)(l);
  if (json && v.measured) console.log(JSON.stringify(v.measured));
  process.exitCode = v.code;
}

if (process.argv[1] && process.argv[1].endsWith('check-code-scanning-age.mjs')) {
  await main(process.argv.slice(2));
}
