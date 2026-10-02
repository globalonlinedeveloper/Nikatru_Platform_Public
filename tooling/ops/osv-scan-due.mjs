#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// osv-scan-due.mjs — IS THE DAILY OSV SCAN OF MAIN DUE ON THIS ops-watch RUN?
//
// ⏱ 2026-10-02 · #1095 review finding 5 (lane fix-pr-token-scope). The scan ran only when
// `github.event.schedule == '30 7 * * *'`, and GitHub delivers a small share of cron slots on
// time (TRAPS ci-16: 10.1% measured). On 2026-10-01 the morning ops-watch run skipped both OSV
// steps, so a dropped slot meant no scan that day, and nothing noticed: a month of dropped
// slots read exactly like a month of clean scans. Instead of one slot, ANY scheduled ops-watch
// run now performs the scan when the newest GRADED scan is older than DUE_HOURS, so the next
// slot GitHub does deliver catches up; and past STALE_HOURS (1.5 × the daily cadence) this
// prints a ::warning:: naming the age, the absence limb the review asked for.
//
// A GRADED scan is a run of ops-watch.yml whose step SCAN_STEP concluded `success` or
// `failure`: a red scan graded main too (it found an advisory, or could not look, and paged).
// `skipped` and `cancelled` graded nothing.
//
// FAILS OPEN, TOWARDS SCANNING: an unreadable history writes due=true and says why, because a
// skipped scan is the failure this exists to prevent. It never exits non-zero for the history;
// the scan step it schedules is the grader.
//
// Writes `due=true|false` to $GITHUB_OUTPUT. Needs GH_TOKEN/GITHUB_TOKEN (actions: read).
// Usage: node tooling/ops/osv-scan-due.mjs [--now <iso>]
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';

export const WORKFLOW = 'ops-watch.yml';
export const SCAN_STEP = 'Known-vulnerable dependencies on main (canary, floor, then the tree)';
export const DUE_HOURS = 20;
export const STALE_HOURS = 36;
/** Runs read at most, newest first: a day of every ops-watch slot and its dispatches. */
export const MAX_RUNS = 15;
const GRADED = new Set(['success', 'failure']);

/**
 * The decision, from the newest graded scan (or none). PURE.
 * @param {{ runId: number, at: string } | null} newest
 */
export function decide(newest, nowMs) {
  if (!newest) return { due: true, stale: true, why: `no ${WORKFLOW} run in the last ${MAX_RUNS} graded "${SCAN_STEP}"` };
  const hours = (nowMs - Date.parse(newest.at)) / 3600e3;
  const age = `${hours.toFixed(1)} h ago (run ${newest.runId})`;
  if (hours < DUE_HOURS) return { due: false, stale: false, why: `the newest graded scan was ${age}, under ${DUE_HOURS} h` };
  return { due: true, stale: hours > STALE_HOURS, why: `the newest graded scan was ${age}${hours > STALE_HOURS ? `, past the ${STALE_HOURS} h window` : ''}` };
}

/** The newest graded scan in the history, read through `fetchImpl`. Throws when it cannot read. */
export async function newestGradedScan({ fetchImpl = fetch, repo, token, currentRunId = null }) {
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  // The shared reading of "a blip or an outage" (bounded-retry.mjs): a dropped wire, a 429 or a 5xx is
  // asked again within its ceiling; any other non-OK status is an answer.
  const get = async (url) => {
    const path = url.replace(api, '');
    const res = await fetchWithBoundedRetry(({ signal }) => fetchImpl(url, { headers, signal }), { describe: (s) => `GET ${path}: ${s}` });
    if (!res.ok) throw new Error(`GET ${path} answered HTTP ${res.status}`);
    return res.json();
  };
  const runs = await get(`${api}/actions/workflows/${WORKFLOW}/runs?branch=main&status=completed&per_page=${MAX_RUNS}`);
  if (!Array.isArray(runs?.workflow_runs)) throw new Error('the runs listing carried no workflow_runs array');
  for (const run of runs.workflow_runs) {
    if (String(run.id) === String(currentRunId)) continue;
    const jobs = await get(`${api}/actions/runs/${run.id}/jobs?per_page=50`);
    for (const job of jobs?.jobs ?? []) {
      const step = (job.steps ?? []).find((s) => s.name === SCAN_STEP);
      if (step && GRADED.has(step.conclusion)) return { runId: run.id, at: step.completed_at ?? job.completed_at ?? run.updated_at };
    }
  }
  return null;
}

async function main() {
  const i = process.argv.indexOf('--now');
  const nowMs = i === -1 ? Date.now() : Date.parse(process.argv[i + 1] ?? '');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || 'globalonlinedeveloper/Nikatru_Platform_Public';
  let d;
  try {
    if (!token) throw new Error('no GH_TOKEN / GITHUB_TOKEN in the environment');
    if (Number.isNaN(nowMs)) throw new Error('--now is not an ISO instant');
    d = decide(await newestGradedScan({ repo, token, currentRunId: process.env.GITHUB_RUN_ID ?? null }), nowMs);
  } catch (e) {
    d = { due: true, stale: false, why: `the scan history could not be read (${e.message}), so the scan runs: a skipped scan is what this prevents` };
  }
  console.log(`osv-scan-due: due=${d.due} — ${d.why}`);
  if (d.stale) {
    console.log(`::warning title=The daily OSV scan of main is overdue::${d.why}. Nothing graded main's dependencies in that window; this run performs the scan now.`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `due=${d.due}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
