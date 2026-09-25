import { describe, it, expect, afterEach, vi } from 'vitest';
import wranglerRaw from '../wrangler.jsonc?raw';
import REGISTER_RAW from '../../../tooling/ops/register.json?raw';
import {
  scheduled,
  NIGHTLY_CRON,
  BACKUP_CRON,
  BACKUP_JOB,
  DISPATCHER_TARGET,
  GITHUB_DISPATCH_JOB,
  OPS_WATCHDOG_JOB,
  OPS_HOURLY_CRON,
  OPS_STUCK_RUNS_JOB,
} from '../src/scheduled';
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

  it('🔴 BACKUP_CRON is a cron the deployed config actually declares', () => {
    // The same typo case as NIGHTLY_CRON's, and it fails in the direction that
    // matters more: a mistyped BACKUP_CRON does not make the export run twice,
    // it routes 02:30 into the `!== NIGHTLY_CRON` branch and the OFF-VENDOR
    // EXPORT NEVER RUNS — while the dispatcher's own heartbeat goes green on that
    // firing, so every reading of "is the schedule alive" says yes.
    expect(CRONS).toContain(BACKUP_CRON);
    expect(CRONS.filter((c) => c === BACKUP_CRON)).toHaveLength(1);
    expect(BACKUP_CRON).not.toEqual(NIGHTLY_CRON);
  });

  it('the register partitions the crons: the backup keeps its own, the dispatcher keeps the rest, everything else keeps the nightly one', () => {
    // The other direction of the same fact. check-heartbeats.mjs judges a job
    // against the crons named here, so a job whose real schedule and declared
    // schedule disagree is measured against one it does not keep.
    //
    // ⚠️ THIS USED TO READ `WATCHED[dispatch] === CRONS` — "the dispatcher keeps
    // EVERY cron" — and that was true only while every non-nightly firing WAS a
    // dispatcher firing. BACKUP_CRON broke it on 2026-09-05. Restating it as a
    // PARTITION keeps the property that actually matters (every declared cron is
    // kept by exactly one job, and no job claims a cron it does not run on)
    // instead of weakening it to fit.
    //
    // ⏱ 2026-09-24 (O-OPS-WATCHDOG-STUCK-RUNS-HOURLY): the hourly stuck-run cron
    // is a fourth kind of firing, kept by ops_stuck_runs alone, so the grid is
    // every cron but the backup AND the hourly one.
    const grid = CRONS.filter((c) => c !== BACKUP_CRON && c !== OPS_HOURLY_CRON);
    expect(WATCHED[GITHUB_DISPATCH_JOB]).toEqual(grid);
    // [O-LAPTOP-ROUTINES-DIE-OVERNIGHT] The ops watchdog rides the dispatcher's
    // grid, so it keeps exactly the same crons.
    expect(WATCHED[OPS_WATCHDOG_JOB]).toEqual(grid);
    expect(WATCHED[BACKUP_JOB]).toEqual([BACKUP_CRON]);
    expect(WATCHED[OPS_STUCK_RUNS_JOB]).toEqual([OPS_HOURLY_CRON]);
    for (const [job, jobCrons] of Object.entries(WATCHED)) {
      if (job === GITHUB_DISPATCH_JOB || job === OPS_WATCHDOG_JOB || job === BACKUP_JOB || job === OPS_STUCK_RUNS_JOB) continue;
      expect(jobCrons, `${job} must keep only the nightly cron`).toEqual([NIGHTLY_CRON]);
    }
    // And every declared cron is kept by someone — the half check-heartbeats.mjs
    // refuses outright, restated here so it fails in the fast suite too.
    const kept = new Set(Object.values(WATCHED).flat());
    for (const c of CRONS) expect([...kept], `cron ${c} is declared but no job keeps it`).toContain(c);
  });

  it('every DISPATCHER cron is 6h apart from its neighbours — the margin is derived, not guessed', () => {
    // A number with no derivation is a number somebody guessed. The window these
    // firings feed is 36h (1d cadence x 1.5), and the schedule they replace had
    // a MEASURED max gap of 48.8h. Even spacing is what turns "four crons" into
    // "at most 6h stale".
    //
    // 🔴 BACKUP_CRON IS EXCLUDED, and excluding it is the honest move rather than
    // the convenient one. 02:30 does not dispatch anything, so counting it would
    // make the dispatcher's gaps look SMALLER than they are — a margin computed
    // over firings that do not deliver the thing being measured. With it in the
    // list this assertion still passed, which is exactly why it had to be fixed
    // deliberately: it would have gone on passing while measuring the wrong set.
    // OPS_HOURLY_CRON is excluded for the same reason (⏱ 2026-09-24): it
    // dispatches nothing, and its `*` hour is no hour of the grid.
    const hours = CRONS.filter((c) => c !== BACKUP_CRON && c !== OPS_HOURLY_CRON)
      .map((c) => Number(c.split(/\s+/)[1]))
      .sort((a, b) => a - b);
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
  it('🔴 EVERY margin firing writes ONLY the dispatcher and the ops watchdog — the sweep does not run four times a day', async () => {
    for (const c of CRONS.filter((x) => x !== NIGHTLY_CRON && x !== BACKUP_CRON && x !== OPS_HOURLY_CRON)) {
      expect(await runScheduled(c), `margin cron ${c}`).toEqual([GITHUB_DISPATCH_JOB, OPS_WATCHDOG_JOB].sort());
    }
  });

  it('🔴 the backup firing writes ONLY the backup — it does not dispatch, and it does not sweep', async () => {
    // The routing claim, through the real handler. The env this harness builds
    // has no BACKUPS_R2 binding, so the export reports a RED row rather than
    // writing anything — which is the point: the assertion here is about WHICH
    // job's rows appear, and a limb that silently reported success on a missing
    // bucket would satisfy it just as well while backing up nothing.
    expect(await runScheduled(BACKUP_CRON)).toEqual([BACKUP_JOB]);
  });

  it('the nightly firing still writes every watched job it owns', async () => {
    // ops_stuck_runs is written by the hourly firing alone (⏱ 2026-09-24).
    const jobs = await runScheduled(NIGHTLY_CRON);
    expect(jobs.sort()).toEqual(
      Object.keys(WATCHED)
        .filter((j) => j !== BACKUP_JOB && j !== OPS_STUCK_RUNS_JOB)
        .sort(),
    );
  });

  it('⚠️ an UNRECOGNISED cron runs the DISPATCHER ONLY — and that inverted on 2026-09-03', async () => {
    // 🔴 IT USED TO RUN EVERYTHING, and that was right with ONE margin firing.
    // With four, the same default would run the retention sweep FOUR TIMES A DAY
    // if NIGHTLY_CRON were ever mistyped — every run green, nothing to see.
    // The risk moved rather than vanished (a typo now means the nightly limbs
    // never run), and THAT risk has a test: `NIGHTLY_CRON is a cron the deployed
    // config actually declares`. The old direction had no such check available.
    expect(await runScheduled('7 7 7 7 7')).toEqual([GITHUB_DISPATCH_JOB, OPS_WATCHDOG_JOB].sort());
  });

  it('a firing with NO cron at all still runs everything — only a STRING can be a margin firing', async () => {
    // `event.cron` absent is not "some other schedule", it is "no schedule was
    // reported" — a local invocation, a test double, a runtime that stopped
    // sending it. Running the full handler is the safe reading of that, and it
    // is why the branch tests `typeof === 'string'` before comparing. The
    // hourly stuck-run job is reached only by its own cron STRING, so an absent
    // cron runs the nightly handler without it (⏱ 2026-09-24).
    expect((await runScheduled(undefined)).sort()).toEqual(
      Object.keys(WATCHED)
        .filter((j) => j !== BACKUP_JOB && j !== OPS_STUCK_RUNS_JOB)
        .sort(),
    );
  });
});

// ── [O-GITHUB-SCHEDULER] every firing ends with the off-Cloudflare beat ─────
describe('every firing beats the off-Cloudflare heartbeat, AFTER its rows have landed', () => {
  const BEAT = 'https://glitchtip.example/api/0/organizations/o/heartbeat_check/beat-id/';

  async function fire(cron: string | undefined, beatUrl: string | undefined) {
    const db = realPlatformDb();
    const beats: number[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (String(input) === BEAT) {
        // The number of heartbeat rows ALREADY written when the beat goes out.
        beats.push(Number(db.rows('SELECT COUNT(*) AS n FROM cron_heartbeat')[0].n));
        return Promise.resolve({ status: 200 } as Response);
      }
      return Promise.resolve({ status: 204 } as Response);
    }) as unknown as typeof fetch;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
    const env = { PLATFORM_DB: db, GITHUB_DISPATCH_TOKEN: 'tok', PLATFORM_CRON_HEARTBEAT_URL: beatUrl } as unknown as Env;
    await scheduled({ cron } as never, env, ctx as never);
    await Promise.all(pending);
    return beats;
  }

  it('🔴 each declared cron beats exactly once, and only after at least one heartbeat row exists', async () => {
    // Every cron but OPS_HOURLY_CRON, which never beats this URL (⏱ 2026-09-24;
    // held by C5 below).
    expect(CRONS.length).toBeGreaterThan(0);
    for (const c of CRONS.filter((x) => x !== OPS_HOURLY_CRON)) {
      const beats = await fire(c, BEAT);
      expect(beats, `cron ${c}`).toHaveLength(1);
      expect(beats[0], `cron ${c}: rows written before the beat`).toBeGreaterThan(0);
    }
  });

  it('with no URL configured no beat is sent, and the firing still writes its rows', async () => {
    expect(await fire(NIGHTLY_CRON, undefined)).toEqual([]);
    expect(await runScheduled(NIGHTLY_CRON)).toContain(GITHUB_DISPATCH_JOB);
  });
});

// ── [O-OPS-WATCHDOG-STUCK-RUNS-HOURLY] the stuck-run check's own hourly firing ─
// ⏱ 2026-09-24. The check left the 6-hourly dispatcher grid for `15 * * * *`, and
// its beat (OPS_STUCK_RUNS_HEARTBEAT_URL) carries the finding: it goes out only
// when the scan read everything and no stuck run is left unhandled. C4 and the
// C6 invariant use LITERALS, not the exports, so they run unchanged against the
// code before this change and are red there on their assertions.
describe('the hourly stuck-run firing is its own firing, and its beat stops while a run is stuck', () => {
  const CRON_BEAT = 'https://glitchtip.example/api/0/organizations/o/heartbeat_check/CRON-BEAT/';
  const WATCHDOG_BEAT = 'https://glitchtip.example/api/0/organizations/o/heartbeat_check/WATCHDOG-BEAT/';
  const STUCK_BEAT = 'https://glitchtip.example/api/0/organizations/o/heartbeat_check/STUCK-BEAT/';

  /** Fire one cron through the real handler with all three beat URLs set. With
   *  `stuck`, the Actions list holds one in_progress run started 3 h ago. */
  async function fireWith(cron: string | undefined, stuck: boolean) {
    const db = realPlatformDb();
    const calls: { url: string; method: string; rowsBefore: number }[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', rowsBefore: Number(db.rows('SELECT COUNT(*) AS n FROM cron_heartbeat')[0].n) });
      if (url.includes('/actions/runs?status=in_progress')) {
        const runs = stuck ? [{ id: 4242, status: 'in_progress', run_started_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }] : [];
        return Promise.resolve(json({ total_count: runs.length, workflow_runs: runs }));
      }
      if (url.includes('/actions/runs?status=queued')) return Promise.resolve(json({ total_count: 0, workflow_runs: [] }));
      if (url === CRON_BEAT || url === WATCHDOG_BEAT || url === STUCK_BEAT) return Promise.resolve(new Response('', { status: 200 }));
      return Promise.resolve({ status: 204 } as Response);
    }) as unknown as typeof fetch;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
    const env = {
      PLATFORM_DB: db,
      GITHUB_DISPATCH_TOKEN: 'tok',
      PLATFORM_CRON_HEARTBEAT_URL: CRON_BEAT,
      OPS_WATCHDOG_HEARTBEAT_URL: WATCHDOG_BEAT,
      OPS_STUCK_RUNS_HEARTBEAT_URL: STUCK_BEAT,
    } as unknown as Env;
    await scheduled({ cron } as never, env, ctx as never);
    await Promise.all(pending);
    const jobs = db.rows('SELECT DISTINCT job FROM cron_heartbeat ORDER BY job').map((r) => r.job);
    const rows = db.rows('SELECT job, target, ok, detail FROM cron_heartbeat ORDER BY job, target');
    const posts = (url: string) => calls.filter((c) => c.method === 'POST' && c.url === url);
    return { calls, jobs, rows, posts };
  }

  it('C1 — OPS_HOURLY_CRON is `15 * * * *`, declared exactly once, and is neither the nightly nor the backup cron', () => {
    expect(OPS_HOURLY_CRON).toBe('15 * * * *');
    expect(CRONS.filter((c) => c === OPS_HOURLY_CRON)).toHaveLength(1);
    expect(OPS_HOURLY_CRON).not.toEqual(NIGHTLY_CRON);
    expect(OPS_HOURLY_CRON).not.toEqual(BACKUP_CRON);
  });

  it('C2 — the register watches ops_stuck_runs on the hourly cron alone, and no other job keeps that cron', () => {
    expect(OPS_STUCK_RUNS_JOB).toBe('ops_stuck_runs');
    expect(WATCHED[OPS_STUCK_RUNS_JOB]).toEqual([OPS_HOURLY_CRON]);
    for (const [job, jobCrons] of Object.entries(WATCHED)) {
      if (job === OPS_STUCK_RUNS_JOB) continue;
      expect(jobCrons, `${job} must not keep the hourly cron`).not.toContain(OPS_HOURLY_CRON);
    }
  });

  it('C3 — with no stuck run the hourly firing beats OPS_STUCK_RUNS_HEARTBEAT_URL exactly once, AFTER its row landed', async () => {
    const { posts, rows } = await fireWith(OPS_HOURLY_CRON, false);
    expect(posts(STUCK_BEAT)).toHaveLength(1);
    expect(posts(STUCK_BEAT)[0].rowsBefore).toBeGreaterThan(0);
    expect(rows).toEqual([expect.objectContaining({ job: 'ops_stuck_runs', target: 'actions-stuck-runs', ok: 1 })]);
  });

  it('🔴 C4 — the `15 * * * *` firing records only ops_stuck_runs and makes no workflow-dispatch POST', async () => {
    const { jobs, calls } = await fireWith('15 * * * *', false);
    expect(jobs).toEqual(['ops_stuck_runs']);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/dispatches'))).toEqual([]);
  });

  it('C5 — the hourly firing never beats PLATFORM_CRON_HEARTBEAT_URL or OPS_WATCHDOG_HEARTBEAT_URL', async () => {
    // Monitor 37 proves the dispatcher grid ran and monitor 40 that the 6-hourly
    // watchdog did; an hourly beat on either would hide the grid stopping.
    for (const stuck of [false, true]) {
      const { posts } = await fireWith(OPS_HOURLY_CRON, stuck);
      expect(posts(CRON_BEAT), `stuck=${stuck}`).toEqual([]);
      expect(posts(WATCHDOG_BEAT), `stuck=${stuck}`).toEqual([]);
    }
  });

  it('🔴 C6 — a run stuck 3 h with the cancel flag off: the row is ok=1 FINDING, and the beat is WITHHELD and says why', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { posts, rows, calls } = await fireWith(OPS_HOURLY_CRON, true);
      expect(posts(STUCK_BEAT)).toEqual([]);
      expect(calls.filter((c) => c.url.endsWith('/cancel'))).toEqual([]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ job: 'ops_stuck_runs', target: 'actions-stuck-runs', ok: 1 });
      expect(String(rows[0].detail)).toMatch(/^FINDING: 1 run\(s\) past 120m: 4242\(180m in_progress\); flag-only/);
      expect(log.mock.calls.flat().join('\n')).toMatch(/\[cron\] ops stuck-runs: heartbeat WITHHELD: 1 stuck run\(s\) unhandled/);
    } finally {
      log.mockRestore();
    }
  });

  it('🔴 C6 invariant — fire every declared cron with a run stuck 3 h and the flag off: at least one ops heartbeat is WITHHELD', async () => {
    // Written against the wrangler CRONS and the literal env keys only, so it
    // reads the same on the code before this change, where every firing that
    // saw the stuck run still beat OPS_WATCHDOG_HEARTBEAT_URL.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let examined = 0;
    let withheld = 0;
    try {
      for (const c of CRONS) {
        const { calls, posts } = await fireWith(c, true);
        if (!calls.some((x) => x.url.includes('/actions/runs?status=in_progress'))) continue;
        examined += 1;
        if (posts(WATCHDOG_BEAT).length + posts(STUCK_BEAT).length === 0) withheld += 1;
      }
    } finally {
      log.mockRestore();
    }
    expect(examined, 'no declared cron looked at the Actions runs at all').toBeGreaterThan(0);
    expect(withheld, 'every firing that saw a run stuck 3 h still sent an ops heartbeat').toBeGreaterThan(0);
    expect(withheld, 'a firing saw the stuck run and beat anyway').toBe(examined);
  });

  it('C7 — the dispatcher grid no longer reads the Actions run lists: the check moved, it is not run twice', async () => {
    for (const c of CRONS.filter((x) => x !== BACKUP_CRON && x !== OPS_HOURLY_CRON)) {
      const { calls, posts } = await fireWith(c, true);
      expect(calls.filter((x) => x.url.includes('/actions/runs?status=')), `cron ${c}`).toEqual([]);
      expect(posts(WATCHDOG_BEAT), `cron ${c} still beats the 6-hourly watchdog`).toHaveLength(1);
    }
  });
});
