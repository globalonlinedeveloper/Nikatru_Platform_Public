import { describe, it, expect, afterEach } from 'vitest';
import wranglerRaw from '../wrangler.jsonc?raw';
import REGISTER_RAW from '../../../tooling/ops/register.json?raw';
import { scheduled, NIGHTLY_CRON, DISPATCHER_TARGET, GITHUB_DISPATCH_JOB } from '../src/scheduled';
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

describe('the nightly cron is a real one, and the others are margin firings', () => {
  it('🔴 NIGHTLY_CRON is a cron the deployed config actually declares', () => {
    // THE TYPO CASE, and it inverted when the constant did. It used to be "a
    // value matching no cron makes the early return unreachable, so the sweep
    // runs twice a day". Now the branch is `cron !== NIGHTLY_CRON`, so a typo
    // means NO firing runs the nightly limbs — the keep-alive stops, and a
    // free-tier Supabase project drifts toward its ~7-day auto-pause with every
    // heartbeat green. Strictly worse, and this is the case that catches it.
    expect(CRONS).toContain(NIGHTLY_CRON);
  });

  it('there is exactly ONE nightly cron and at least one margin firing', () => {
    expect(CRONS.length).toBeGreaterThan(1);
    expect(CRONS.filter((c) => c === NIGHTLY_CRON)).toHaveLength(1);
  });

  it('the register says the dispatcher keeps EVERY cron and every other job keeps only the nightly one', () => {
    // The other direction of the same fact. check-heartbeats.mjs judges a job
    // against the crons named here, so a job whose real schedule and declared
    // schedule disagree is measured against one it does not keep. The nightly
    // jobs run on ONE firing; the dispatcher runs on all of them.
    expect(WATCHED[GITHUB_DISPATCH_JOB]).toEqual(CRONS);
    for (const [job, jobCrons] of Object.entries(WATCHED)) {
      if (job === GITHUB_DISPATCH_JOB) continue;
      expect(jobCrons, `${job} must keep only the nightly cron`).toEqual([NIGHTLY_CRON]);
    }
  });

  it('every margin cron is 6h apart from its neighbours — the margin is derived, not guessed', () => {
    // A number with no derivation is a number somebody guessed. The window these
    // firings feed is 36h (1d cadence x 1.5), and the schedule they replace had
    // a MEASURED max gap of 48.8h. Even spacing is what turns "four crons" into
    // "at most 6h stale".
    const hours = CRONS.map((c) => Number(c.split(/\s+/)[1])).sort((a, b) => a - b);
    const gaps = hours.map((h, i) => (i === 0 ? h + 24 - hours[hours.length - 1] : h - hours[i - 1]));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(6);
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
  it('🔴 EVERY margin firing writes ONLY the dispatcher — the sweep does not run four times a day', async () => {
    for (const c of CRONS.filter((x) => x !== NIGHTLY_CRON)) {
      expect(await runScheduled(c), `margin cron ${c}`).toEqual([GITHUB_DISPATCH_JOB]);
    }
  });

  it('the nightly firing still writes every watched job', async () => {
    const jobs = await runScheduled(NIGHTLY_CRON);
    expect(jobs.sort()).toEqual(Object.keys(WATCHED).sort());
  });

  it('⚠️ an UNRECOGNISED cron runs the DISPATCHER ONLY — and that inverted on 2026-09-03', async () => {
    // 🔴 IT USED TO RUN EVERYTHING, and that was right with ONE margin firing.
    // With four, the same default would run the retention sweep FOUR TIMES A DAY
    // if NIGHTLY_CRON were ever mistyped — every run green, nothing to see.
    // The risk moved rather than vanished (a typo now means the nightly limbs
    // never run), and THAT risk has a test: `NIGHTLY_CRON is a cron the deployed
    // config actually declares`. The old direction had no such check available.
    expect(await runScheduled('7 7 7 7 7')).toEqual([GITHUB_DISPATCH_JOB]);
  });

  it('a firing with NO cron at all still runs everything — only a STRING can be a margin firing', async () => {
    // `event.cron` absent is not "some other schedule", it is "no schedule was
    // reported" — a local invocation, a test double, a runtime that stopped
    // sending it. Running the full handler is the safe reading of that, and it
    // is why the branch tests `typeof === 'string'` before comparing.
    expect((await runScheduled(undefined)).sort()).toEqual(Object.keys(WATCHED).sort());
  });
});
