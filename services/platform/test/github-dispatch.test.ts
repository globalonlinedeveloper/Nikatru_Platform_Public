import { describe, it, expect, afterEach } from 'vitest';
import {
  dispatchGithubWorkflows,
  GITHUB_DISPATCH_JOB,
  GITHUB_DISPATCH_TARGETS,
} from '../src/scheduled';
import { realPlatformDb } from './harness';
import type { Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// [research/76 §C] PHASE 1 — the Cloudflare cron that fires a GitHub workflow.
//
// 🔴 THE ONE PROPERTY THIS SUITE EXISTS FOR: A ROW IS WRITTEN ON EVERY PATH.
// A dispatcher that quietly does nothing is indistinguishable from a dispatcher
// that is working, and that is the shape of every silent failure this portfolio
// has paid for — the keep-alive recording a 401 as ok=1, `analytics_liveness`
// returning ok=1 unconditionally, the `ops` GlitchTip project that "had received
// nothing, ever" while a bot check dropped every send at the edge. So each test
// below asserts the ROW, not the call.
//
// ⚠️ AND THE REQUEST SHAPE IS ASSERTED, not assumed. A missing `User-Agent` is a
// 403 from GitHub that no local run would ever show, and the wrong `ref` would
// let a branch decide what the portfolio's alarm clock executes. Both are
// checked against the captured request rather than trusted.
// ─────────────────────────────────────────────────────────────────────────────

const envWith = (db: ReturnType<typeof realPlatformDb>, token?: string) =>
  ({ PLATFORM_DB: db, ...(token === undefined ? {} : { GITHUB_DISPATCH_TOKEN: token }) }) as unknown as Env;

const rows = (db: ReturnType<typeof realPlatformDb>) =>
  db.rows(`SELECT * FROM cron_heartbeat WHERE job = '${GITHUB_DISPATCH_JOB}' ORDER BY target`);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Captures every request so the SHAPE can be asserted, and answers with the
 *  status the test is about. Deliberately returns a bare object rather than a
 *  `Response`: the limb reads `.status` and nothing else, and depending on the
 *  narrowest fact is what keeps this double honest. */
function stubFetch(status: number | Error) {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    if (status instanceof Error) return Promise.reject(status);
    return Promise.resolve({ status } as Response);
  }) as unknown as typeof fetch;
  return seen;
}

describe('the declared targets are safe by construction', () => {
  it('every target dispatches the DEFAULT branch — a ref is what decides which file runs', () => {
    expect(GITHUB_DISPATCH_TARGETS.length).toBeGreaterThan(0);
    for (const t of GITHUB_DISPATCH_TARGETS) {
      // 🔴 `workflow_dispatch` executes the workflow file FROM THE REF GIVEN, so
      // a target pointing at a feature branch would let that branch decide what
      // the portfolio's alarm clock runs. This is the assertion that stops it.
      expect(t.ref).toBe('main');
      expect(t.owner).toBe('globalonlinedeveloper');
      expect(t.workflow).toMatch(/\.ya?ml$/);
    }
  });

  it('Phase 1 fires ONLY workflows that gate nothing — ops-watch is Phase 2 and must not be here', () => {
    // ⛔ ops-watch.yml, e2e.yml and build-platforms.yml all leave records that
    // duty rows read as `event=schedule`. A dispatch arrives as
    // `event=workflow_dispatch`, which those readers refuse — so adding one here
    // WITHOUT repointing its evidence re-creates the 46-hour freeze of
    // 2026-09-02. This test is the tripwire on that mistake.
    const forbidden = ['ops-watch.yml', 'e2e.yml', 'build-platforms.yml'];
    for (const t of GITHUB_DISPATCH_TARGETS) expect(forbidden).not.toContain(t.workflow);
  });
});

describe('a dispatch that is accepted', () => {
  it('writes ok=1 with the workflow and ref in the detail', async () => {
    const db = realPlatformDb();
    stubFetch(204);
    await dispatchGithubWorkflows(envWith(db, 'tok'));
    const out = rows(db);
    expect(out).toHaveLength(GITHUB_DISPATCH_TARGETS.length);
    expect(out[0].ok).toBe(1);
    expect(String(out[0].detail)).toContain('HTTP 204');
    expect(String(out[0].detail)).toContain(GITHUB_DISPATCH_TARGETS[0].workflow);
  });

  it('sends the request GitHub actually requires — method, ref, and a User-Agent', async () => {
    const db = realPlatformDb();
    const seen = stubFetch(204);
    await dispatchGithubWorkflows(envWith(db, 'tok'));
    expect(seen).toHaveLength(GITHUB_DISPATCH_TARGETS.length);
    const [{ url, init }] = seen;
    expect(url).toBe(
      `https://api.github.com/repos/${GITHUB_DISPATCH_TARGETS[0].owner}/${GITHUB_DISPATCH_TARGETS[0].repo}` +
        `/actions/workflows/${GITHUB_DISPATCH_TARGETS[0].workflow}/dispatches`,
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main' });
    const headers = init.headers as Record<string, string>;
    // 🔴 GitHub answers 403 to a request with no User-Agent, and this portfolio
    // has already lost weeks to a bot check silently dropping a default agent.
    expect(headers['User-Agent']).toBeTruthy();
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('🔴 a 2xx that is NOT 204 is a failure — GitHub accepts a dispatch with 204 and nothing else', async () => {
    const db = realPlatformDb();
    stubFetch(200);
    await dispatchGithubWorkflows(envWith(db, 'tok'));
    // 200 here means something answered that is not the dispatch endpoint
    // behaving as documented. Calling it a run would be the `status < 500` bug
    // the keep-alive header records, one endpoint over.
    expect(rows(db)[0].ok).toBe(0);
    expect(String(rows(db)[0].detail)).toContain('HTTP 200');
  });
});

describe('every way it can fail still leaves a row', () => {
  it('no token configured — one ok=0 row per target, naming the missing secret, and NO request made', async () => {
    const db = realPlatformDb();
    const seen = stubFetch(204);
    await dispatchGithubWorkflows(envWith(db, undefined));
    const out = rows(db);
    expect(out).toHaveLength(GITHUB_DISPATCH_TARGETS.length);
    for (const r of out) {
      expect(r.ok).toBe(0);
      expect(String(r.detail)).toContain('GITHUB_DISPATCH_TOKEN');
    }
    // A fail-closed seam must not also be a silent one: it records, and it does
    // not fire a credential-less request that would 401 and confuse the record.
    expect(seen).toHaveLength(0);
  });

  it('a refusal (404) is ok=0 and the detail says what a 404 usually means here', async () => {
    const db = realPlatformDb();
    stubFetch(404);
    await dispatchGithubWorkflows(envWith(db, 'tok'));
    expect(rows(db)[0].ok).toBe(0);
    expect(String(rows(db)[0].detail)).toContain('HTTP 404');
    expect(String(rows(db)[0].detail)).toMatch(/token cannot see/);
  });

  it('a network error is ok=0, not an exception that swallows the whole cron', async () => {
    const db = realPlatformDb();
    stubFetch(new Error('boom'));
    // 🔴 It must not throw: this limb runs inside the same `waitUntil` chain as
    // the retention sweep, and an escaping error would take the rest with it.
    await expect(dispatchGithubWorkflows(envWith(db, 'tok'))).resolves.toBeUndefined();
    expect(rows(db)[0].ok).toBe(0);
    expect(String(rows(db)[0].detail)).toContain('request failed');
  });

  it('an abort (the 10s bound) lands on the same failing path as any other error', async () => {
    const db = realPlatformDb();
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    stubFetch(abort);
    await dispatchGithubWorkflows(envWith(db, 'tok'));
    expect(rows(db)[0].ok).toBe(0);
    expect(String(rows(db)[0].detail)).toContain('request failed');
  });

  it('the detail is truncated to what the column takes, so a huge error cannot break the write', async () => {
    const db = realPlatformDb();
    stubFetch(new Error('x'.repeat(5000)));
    await dispatchGithubWorkflows(envWith(db, 'tok'));
    expect(String(rows(db)[0].detail).length).toBeLessThanOrEqual(200);
    expect(rows(db)[0].ok).toBe(0);
  });
});
