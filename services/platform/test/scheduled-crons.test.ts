import { describe, it, expect, afterEach } from 'vitest';
import wranglerRaw from '../wrangler.jsonc?raw';
import REGISTER_RAW from '../../../tooling/ops/register.json?raw';
import { scheduled, DISPATCH_ONLY_CRON, GITHUB_DISPATCH_JOB } from '../src/scheduled';
import { realPlatformDb } from './harness';
import type { Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKER HAS TWO SCHEDULES AND THEY DO DIFFERENT WORK.
//
// 🔴 THE SECOND ONE EXISTS TO GIVE THE EVIDENCE MARGIN. Measured over 30.8 days,
// the workflow it dispatches (ops-watch.yml) had 72 successful SCHEDULED runs —
// 2.3/day against the 12 slots its cron block declares — with a MAX GAP of 48.8h
// and SIX gaps over the 36h freshness window in one month. A 24h dispatch
// cadence leaves 12h of margin on that window; 12h leaves 24h.
//
// ⛔ AND THE NIGHTLY LIMBS MUST NOT RUN TWICE. `retentionSweep` DELETES. So the
// 18:00 firing takes an early return, and the cases below are what stop that
// early return from being one typo away from a sweep that runs twice a day —
// a mistake nothing else in this tree would notice, because both runs are green.
// ─────────────────────────────────────────────────────────────────────────────

/** JSONC → JSON, string-literal aware. Same reduction the sibling suites use:
 *  this file's prose is full of the words being looked for. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
}

const CRONS = ((parseJsonc(wranglerRaw).triggers as { crons?: string[] } | undefined)?.crons ?? []);

const WATCHED = (() => {
  const reg = JSON.parse(REGISTER_RAW) as {
    rows?: { mechanism?: { substrate?: string }; watchedJobs?: Record<string, string[]> }[];
  };
  return (reg.rows ?? []).find((r) => r.mechanism?.substrate === 'cloudflare-cron')?.watchedJobs ?? {};
})();

describe('the dispatch-only cron is a real one, and not the nightly one', () => {
  it('DISPATCH_ONLY_CRON is a cron the deployed config actually declares', () => {
    // 🔴 THE TYPO CASE. A value that matches no declared cron makes the early
    // return unreachable, every firing runs the full handler, and the retention
    // sweep runs TWICE A DAY — with both runs green and nothing to see.
    expect(CRONS).toContain(DISPATCH_ONLY_CRON);
  });

  it('it is NOT the first cron — the first is the full nightly handler', () => {
    expect(CRONS.length).toBeGreaterThan(1);
    expect(CRONS[0]).not.toBe(DISPATCH_ONLY_CRON);
  });

  it('the register says the dispatcher keeps BOTH crons and every other job keeps one', () => {
    // The other direction of the same fact. check-heartbeats.mjs judges a job
    // against the crons named here, so a job whose real schedule and declared
    // schedule disagree is measured against one it does not keep.
    expect(WATCHED[GITHUB_DISPATCH_JOB]).toEqual(CRONS);
    for (const [job, jobCrons] of Object.entries(WATCHED)) {
      if (job === GITHUB_DISPATCH_JOB) continue;
      expect(jobCrons, `${job} must keep only the nightly cron`).toEqual([CRONS[0]]);
    }
  });
});

// ── and the behaviour, through the REAL handler ─────────────────────────────
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function runScheduled(cron: string | undefined) {
  const db = realPlatformDb();
  // 204 = an accepted dispatch, so the dispatcher's own row is green and the
  // assertions below are about WHICH limbs ran, never about their verdicts.
  globalThis.fetch = (() => Promise.resolve({ status: 204 } as Response)) as unknown as typeof fetch;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
  const env = { PLATFORM_DB: db, GITHUB_DISPATCH_TOKEN: 'tok' } as unknown as Env;
  await scheduled({ cron } as never, env, ctx as never);
  await Promise.all(pending);
  return db.rows('SELECT DISTINCT job FROM cron_heartbeat ORDER BY job').map((r) => r.job);
}

describe('which limbs run is decided by which cron fired', () => {
  it('🔴 the 18:00 firing writes ONLY the dispatcher — the sweep does not run twice a day', async () => {
    expect(await runScheduled(DISPATCH_ONLY_CRON)).toEqual([GITHUB_DISPATCH_JOB]);
  });

  it('the nightly firing still writes every watched job', async () => {
    const jobs = await runScheduled(CRONS[0]);
    expect(jobs.sort()).toEqual(Object.keys(WATCHED).sort());
  });

  it('⚠️ an UNRECOGNISED cron runs everything — the fail-safe direction is stated, not assumed', async () => {
    // Skipping the keep-alive that stands between a free-tier Supabase project
    // and its ~7-day auto-pause costs more than dispatching a workflow twice, so
    // an unknown value degrades to "does all the work" rather than "does none".
    expect((await runScheduled('7 7 7 7 7')).sort()).toEqual(Object.keys(WATCHED).sort());
  });

  it('a firing with NO cron at all also runs everything', async () => {
    expect((await runScheduled(undefined)).sort()).toEqual(Object.keys(WATCHED).sort());
  });
});
