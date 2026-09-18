import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  boxaTargets,
  boxaReachability,
  BOXA_REACH_JOB,
  opsWatchdogJob,
  OPS_WATCHDOG_JOB,
} from '../src/scheduled';
import {
  checkStuckRuns,
  checkMainConclusions,
  checkGlitchtipMonitors,
  OPS_STUCK_RUN_MINUTES,
  OPS_MAX_CANCELS_PER_RUN,
  OPS_MAIN_WORKFLOWS,
  OPS_GLITCHTIP_MONITORS,
  OPS_WATCHDOG_MAX_SUBREQUESTS,
} from '../src/ops-watchdog';
import type { Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// [O-LAPTOP-ROUTINES-DIE-OVERNIGHT] The laptop watchdog's portable work, on the
// Worker cron. What these cases pin:
//   · every not-configured path is a RECORDED ok=0, never a silent pass;
//   · a stuck run is flagged, and cancelled ONLY behind the owner's flag;
//   · a finding (red main, monitor down) is ok=1 + FINDING:, never ok=0;
//   · the heartbeat goes out only AFTER the rows landed, and not at all when
//     the checks throw;
//   · no credential reaches a detail or a log line.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = 'ghp_SECRET-TOKEN-VALUE';
const GT_TOKEN = 'gt-SECRET-TOKEN-VALUE';
const BEAT = 'https://glitchtip.example/api/0/organizations/o/heartbeat_check/WATCHDOG-SECRET-ID/';
const NOW = Date.parse('2026-09-18T12:00:00Z');

/** Captures heartbeat rows, and the order in which batch() and fetch() happen. */
function fakeDb(events: string[] = []) {
  const bound: unknown[][] = [];
  const db = {
    prepare() {
      return { bind(...args: unknown[]) { bound.push(args); return {}; } };
    },
    batch: vi.fn(async () => { events.push('batch'); return []; }),
  };
  return { db, bound };
}

function env(overrides: Partial<Env> = {}, events: string[] = []): { e: Env; bound: unknown[][] } {
  const { db, bound } = fakeDb(events);
  return { e: { PLATFORM_DB: db, ...overrides } as unknown as Env, bound };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

/** A GitHub + GlitchTip double. `runs` are served under in_progress; queued is empty. */
function apiDouble(opts: {
  runs?: { id: number; status: string; run_started_at?: string; created_at?: string }[];
  cancelStatus?: number;
  conclusion?: string;
  isUp?: boolean;
  events?: string[];
}) {
  const calls: { url: string; method: string }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    opts.events?.push(url === BEAT ? 'beat' : 'fetch');
    if (url === BEAT) return new Response('', { status: 200 });
    if (url.includes('/actions/runs?status=in_progress')) return json({ total_count: opts.runs?.length ?? 0, workflow_runs: opts.runs ?? [] });
    if (url.includes('/actions/runs?status=queued')) return json({ total_count: 0, workflow_runs: [] });
    if (url.endsWith('/cancel')) return new Response('', { status: opts.cancelStatus ?? 202 });
    if (url.includes('/actions/workflows/')) return json({ workflow_runs: [{ id: 99, conclusion: opts.conclusion ?? 'success', updated_at: minutesAgo(30) }] });
    if (url.includes('/monitors/')) return json({ name: 'm', isUp: opts.isUp ?? true, lastChange: minutesAgo(60) });
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', f);
  return { f, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('boxaReachability — Box A over HTTP, never a silent pass', () => {
  it('has NO default list: unset or blank means zero targets', () => {
    expect(boxaTargets(env().e)).toEqual([]);
    expect(boxaTargets(env({ BOXA_REACH_URLS: ' , ' }).e)).toEqual([]);
    expect(boxaTargets(env({ BOXA_REACH_URLS: ' https://a.test/ ,https://a.test/, https://b.test/' }).e)).toEqual([
      'https://a.test/',
      'https://b.test/',
    ]);
  });

  it('🔴 unset writes ONE ok=0 "not configured" row and probes nothing', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { e, bound } = env();
    await boxaReachability(e);
    expect(f).not.toHaveBeenCalled();
    expect(bound).toHaveLength(1);
    expect(bound[0][0]).toBe(BOXA_REACH_JOB);
    expect(bound[0][2]).toBe(0);
    expect(String(bound[0][3])).toMatch(/not configured.*BOXA_REACH_URLS/);
  });

  it('grades like Box B: a 401 is reachable, a 530 and a throw are not', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response('', { status: 401 });
      if (n === 2) return new Response('error code: 1033', { status: 530 });
      throw new Error('connect ETIMEDOUT');
    }));
    const { e, bound } = env({ BOXA_REACH_URLS: 'https://a.test/,https://b.test/,https://c.test/' });
    await boxaReachability(e);
    expect(bound.map((r) => [r[0], r[1], r[2]])).toEqual([
      [BOXA_REACH_JOB, 'https://a.test/', 1],
      [BOXA_REACH_JOB, 'https://b.test/', 0],
      [BOXA_REACH_JOB, 'https://c.test/', 0],
    ]);
  });
});

describe('checkStuckRuns — flag always, cancel only when allowed', () => {
  it('without GITHUB_DISPATCH_TOKEN it records not-configured (ok=0) and calls nothing', async () => {
    const { f } = apiDouble({});
    const row = await checkStuckRuns(env().e, NOW);
    expect(row.ok).toBe(false);
    expect(row.detail).toMatch(/not configured/);
    expect(f).not.toHaveBeenCalled();
  });

  it('a run past the threshold is FLAGGED, a fresh one is not, and nothing is cancelled by default', async () => {
    const { calls } = apiDouble({
      runs: [
        { id: 1, status: 'in_progress', run_started_at: minutesAgo(OPS_STUCK_RUN_MINUTES + 30) },
        { id: 2, status: 'in_progress', run_started_at: minutesAgo(5) },
      ],
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const row = await checkStuckRuns(env({ GITHUB_DISPATCH_TOKEN: TOKEN }).e, NOW);
    expect(row.ok).toBe(true);
    expect(row.detail).toMatch(/^FINDING: 1 run\(s\)/);
    expect(row.detail).toContain('1(150m in_progress)');
    expect(row.detail).not.toContain('2(');
    expect(row.detail).toMatch(/flag-only/);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('🔴 any value but exactly "true" keeps it flag-only', async () => {
    for (const v of ['1', 'TRUE', 'yes', ' true']) {
      const { calls } = apiDouble({ runs: [{ id: 7, status: 'queued', created_at: minutesAgo(600) }] });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await checkStuckRuns(env({ GITHUB_DISPATCH_TOKEN: TOKEN, OPS_WATCHDOG_CANCEL_STUCK: v }).e, NOW);
      expect(calls.filter((c) => c.method === 'POST'), `flag ${JSON.stringify(v)}`).toEqual([]);
    }
  });

  it('with the flag "true" it POSTs .../runs/{id}/cancel for each stuck run, capped per firing', async () => {
    const runs = Array.from({ length: OPS_MAX_CANCELS_PER_RUN + 2 }, (_, i) => ({
      id: 100 + i, status: 'in_progress', run_started_at: minutesAgo(OPS_STUCK_RUN_MINUTES + 1),
    }));
    const { calls } = apiDouble({ runs });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const row = await checkStuckRuns(env({ GITHUB_DISPATCH_TOKEN: TOKEN, OPS_WATCHDOG_CANCEL_STUCK: 'true' }).e, NOW);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(OPS_MAX_CANCELS_PER_RUN);
    expect(posts[0].url).toBe('https://api.github.com/repos/globalonlinedeveloper/Nikatru_Platform_Public/actions/runs/100/cancel');
    expect(row.ok).toBe(true);
    expect(row.detail).toMatch(new RegExp(`cancelled=${OPS_MAX_CANCELS_PER_RUN} refused=0`));
  });

  it('a REFUSED cancel (token lacks actions:write) is ok=0, not a finding', async () => {
    apiDouble({ runs: [{ id: 5, status: 'in_progress', run_started_at: minutesAgo(999) }], cancelStatus: 403 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const row = await checkStuckRuns(env({ GITHUB_DISPATCH_TOKEN: TOKEN, OPS_WATCHDOG_CANCEL_STUCK: 'true' }).e, NOW);
    expect(row.ok).toBe(false);
    expect(row.detail).toMatch(/cancel 5 HTTP 403/);
  });

  it('an unreadable run list is ok=0 "unreadable", never "none stuck"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const row = await checkStuckRuns(env({ GITHUB_DISPATCH_TOKEN: TOKEN }).e, NOW);
    expect(row.ok).toBe(false);
    expect(row.detail).toMatch(/^unreadable: .*HTTP 401/);
  });
});

describe('main conclusions and GlitchTip monitors — findings are detail, not ok=0', () => {
  it('🔴 a FAILED ci.yml on main is ok=1 with FINDING: — ok=0 would freeze the queue that must merge the fix', async () => {
    apiDouble({ conclusion: 'failure' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const rows = await checkMainConclusions(env({ GITHUB_DISPATCH_TOKEN: TOKEN }).e);
    expect(rows.map((r) => r.target)).toEqual(OPS_MAIN_WORKFLOWS.map((w) => `main:${w}`));
    for (const r of rows) {
      expect(r.ok).toBe(true);
      expect(r.detail).toMatch(/^FINDING: .* on main: failure \(run 99/);
    }
  });

  it('without a token both main rows are not-configured ok=0', async () => {
    apiDouble({});
    const rows = await checkMainConclusions(env().e);
    expect(rows.every((r) => !r.ok && /not configured/.test(r.detail))).toBe(true);
  });

  it('without GLITCHTIP_TOKEN every monitor row is not-configured ok=0 and GlitchTip is never called', async () => {
    const { f } = apiDouble({});
    const rows = await checkGlitchtipMonitors(env().e);
    expect(rows.map((r) => r.target)).toEqual(OPS_GLITCHTIP_MONITORS.map((m) => `glitchtip-monitor-${m}`));
    expect(rows.every((r) => !r.ok && /not configured: GLITCHTIP_TOKEN/.test(r.detail))).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('with the token it reads monitors 6 and 22; a DOWN monitor is a finding, not a failed check', async () => {
    const { calls } = apiDouble({ isUp: false });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const rows = await checkGlitchtipMonitors(env({ GLITCHTIP_TOKEN: GT_TOKEN }).e);
    expect(calls.map((c) => c.url)).toEqual([
      'https://glitchtip.nikatru.com/api/0/organizations/nikatru/monitors/6/',
      'https://glitchtip.nikatru.com/api/0/organizations/nikatru/monitors/22/',
    ]);
    expect(rows.every((r) => r.ok && r.detail.startsWith('FINDING: '))).toBe(true);
  });
});

describe('opsWatchdogJob — beat only after the work, never when it throws', () => {
  it('🔴 records every row FIRST, then beats exactly once', async () => {
    const events: string[] = [];
    apiDouble({ events });
    const { e, bound } = env({ GITHUB_DISPATCH_TOKEN: TOKEN, GLITCHTIP_TOKEN: GT_TOKEN, OPS_WATCHDOG_HEARTBEAT_URL: BEAT }, events);
    expect(await opsWatchdogJob(e)).toBe('beat');
    expect(events.filter((x) => x !== 'fetch')).toEqual(['batch', 'beat']);
    expect(events[events.length - 1]).toBe('beat');
    expect(bound.every((r) => r[0] === OPS_WATCHDOG_JOB)).toBe(true);
    expect(bound.map((r) => r[1])).toContain('(watchdog)');
    expect(bound.every((r) => r[2] === 1)).toBe(true);
  });

  it('not-configured limbs are recorded ok=0 and STILL beat — the checks completed and said so', async () => {
    const events: string[] = [];
    apiDouble({ events });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { e, bound } = env({ OPS_WATCHDOG_HEARTBEAT_URL: BEAT }, events);
    expect(await opsWatchdogJob(e)).toBe('beat');
    expect(events).toEqual(['batch', 'beat']);
    const notOk = bound.filter((r) => r[2] === 0).map((r) => r[1]);
    expect(notOk).toEqual(['actions-stuck-runs', 'main:ci.yml', 'main:ops-watch.yml', 'glitchtip-monitor-6', 'glitchtip-monitor-22']);
  });

  it('🔴 when the checks THROW: one ok=0 row, and the beat is WITHHELD', async () => {
    const events: string[] = [];
    const { f } = apiDouble({ events });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { e, bound } = env({ OPS_WATCHDOG_HEARTBEAT_URL: BEAT }, events);
    const result = await opsWatchdogJob(e, async () => { throw new Error('boom'); });
    expect(result).toBe('withheld');
    expect(f).not.toHaveBeenCalled();
    expect(bound).toHaveLength(1);
    expect(bound[0][1]).toBe('(watchdog)');
    expect(bound[0][2]).toBe(0);
    expect(String(bound[0][3])).toMatch(/threw, heartbeat withheld: Error: boom/);
  });

  it('with no heartbeat secret it records the rows and sends no beat, saying so', async () => {
    const events: string[] = [];
    apiDouble({ events });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { e } = env({ GITHUB_DISPATCH_TOKEN: TOKEN }, events);
    expect(await opsWatchdogJob(e)).toBe('skipped');
    expect(events).not.toContain('beat');
    expect(events).toContain('batch');
    expect(log.mock.calls.flat().join('\n')).toMatch(/OPS_WATCHDOG_HEARTBEAT_URL is not set/);
  });

  it('⚠️ no token or heartbeat path reaches a recorded detail or a log line', async () => {
    apiDouble({ conclusion: 'failure', isUp: false, cancelStatus: 403, runs: [{ id: 9, status: 'queued', created_at: minutesAgo(999) }] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { e, bound } = env({
      GITHUB_DISPATCH_TOKEN: TOKEN, GLITCHTIP_TOKEN: GT_TOKEN, OPS_WATCHDOG_HEARTBEAT_URL: BEAT, OPS_WATCHDOG_CANCEL_STUCK: 'true',
    });
    await opsWatchdogJob(e);
    const surface = JSON.stringify(bound) + log.mock.calls.flat().join('\n');
    expect(surface).not.toMatch(/SECRET-TOKEN-VALUE|WATCHDOG-SECRET-ID/);
  });

  it('@ceiling — the declared subrequest budget is the sum of its parts, and the worst case stays inside it', async () => {
    expect(OPS_WATCHDOG_MAX_SUBREQUESTS).toBe(2 + OPS_MAX_CANCELS_PER_RUN + OPS_MAIN_WORKFLOWS.length + OPS_GLITCHTIP_MONITORS.length + 1);
    const runs = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, status: 'in_progress', run_started_at: minutesAgo(9999) }));
    const { f } = apiDouble({ runs });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { e } = env({
      GITHUB_DISPATCH_TOKEN: TOKEN, GLITCHTIP_TOKEN: GT_TOKEN, OPS_WATCHDOG_HEARTBEAT_URL: BEAT, OPS_WATCHDOG_CANCEL_STUCK: 'true',
    });
    await opsWatchdogJob(e);
    expect(f.mock.calls.length).toBe(OPS_WATCHDOG_MAX_SUBREQUESTS);
  });
});
