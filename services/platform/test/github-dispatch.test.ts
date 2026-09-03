import { describe, it, expect, afterEach } from 'vitest';
import {
  dispatchGithubWorkflows,
  GITHUB_DISPATCH_JOB,
  GITHUB_DISPATCH_TARGETS,
} from '../src/scheduled';
import { realPlatformDb } from './harness';
import type { Env } from '../src/types';
import REGISTER_RAW from '../../../tooling/ops/register.json?raw';

/** Every workflow file, as a fact about the directory rather than a list a
 *  future edit can silently shorten — the reason insights-queries.test.ts
 *  globs rather than importing by name. */
const WORKFLOWS = import.meta.glob('../../../.github/workflows/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

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

  it('🔴 a dispatched workflow whose duty rows still read `event=schedule` MUST keep its own schedule', () => {
    // ⛔ THE INVARIANT THAT REPLACED A BLANKET BAN, 2026-09-03. The first version
    // of this case simply forbade ops-watch.yml, e2e.yml and build-platforms.yml
    // — which was right for Phase 1 and wrong as a rule, because it forbids the
    // thing Phase 2 exists to do while saying nothing about WHEN it becomes
    // safe. This says when.
    //
    // A dispatched run arrives as `event=workflow_dispatch`. Every duty row that
    // reads a workflow with `event: schedule` refuses it — correctly, because a
    // dispatch is indistinguishable from a hand-press and freshness is a claim
    // about the TIMER, not about somebody being awake. So while any row still
    // reads a workflow that way, that workflow's OWN `schedule:` block is what
    // keeps the evidence alive, and adding a Worker dispatch is purely additive.
    // Remove the schedule before moving the evidence and three duty rows go
    // stale inside their windows: the 46-hour freeze of 2026-09-02, self-inflicted.
    //
    // Checked against the REAL files — the register and the workflows — so it
    // cannot drift from either.
    const register = JSON.parse(REGISTER_RAW) as { rows?: Record<string, unknown>[] };
    const scheduleRead = new Set(
      (register.rows ?? [])
        .map((r) => (r as { mechanism?: { recordQuery?: { workflow?: string; event?: string } } }).mechanism?.recordQuery)
        .filter((q): q is { workflow: string; event: string } => q?.event === 'schedule' && typeof q?.workflow === 'string')
        .map((q) => q.workflow),
    );
    expect(scheduleRead.size, 'no row reads any workflow as `event: schedule` — this invariant would be vacuous').toBeGreaterThan(0);

    for (const t of GITHUB_DISPATCH_TARGETS) {
      if (!scheduleRead.has(t.workflow)) continue; // evidence has moved: the schedule may go
      const file = WORKFLOWS[`../../../.github/workflows/${t.workflow}`];
      expect(file, `dispatch target ${t.workflow} is not a workflow in this repository`).toBeTruthy();
      expect(
        /^\s*schedule:\s*$/m.test(file),
        `${t.workflow} is dispatched by the Worker AND still read as \`event: schedule\` by a duty row, ` +
          'but it declares no `schedule:` trigger. Its evidence would go stale inside its own window. ' +
          'Move the evidence first, or keep the schedule.',
      ).toBe(true);
    }
  });
});

describe('a dispatch that is accepted', () => {
  it('writes ok=1 with the workflow and ref in the detail', async () => {
    const db = realPlatformDb();
    stubFetch(204);
    await dispatchGithubWorkflows(envWith(db, 'tok'));
    const out = rows(db);
    expect(out).toHaveLength(GITHUB_DISPATCH_TARGETS.length);
    // Rows come back ORDERED BY target, which is not the order of the target
    // list — so every assertion here is per-target rather than positional. The
    // first draft indexed `[0]` and started failing the moment a second target
    // was added ahead of it alphabetically, which is a test breaking on its own
    // fixture rather than on the property.
    for (const t of GITHUB_DISPATCH_TARGETS) {
      const row = out.find((r) => r.target === `${t.repo}/${t.workflow}`);
      expect(row, `no heartbeat row for ${t.repo}/${t.workflow}`).toBeTruthy();
      expect(row!.ok).toBe(1);
      expect(String(row!.detail)).toContain('HTTP 204');
      expect(String(row!.detail)).toContain(t.workflow);
    }
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

describe('🔴 the token never leaves the fetch — the mitigation for a broadly-scoped credential', () => {
  // OWNER DECISION 2026-09-03: the Worker is given an EXISTING vault PAT rather
  // than a fine-grained one. Measured that day, all three vault PATs carry
  // `repo`, `admin:org`, `delete_repo` and `admin:enterprise` — so the credential
  // in this Worker can delete repositories and administer the organisation.
  //
  // ⚠️ THAT MAKES THE REALISTIC LEAK PATH WORTH CLOSING MECHANICALLY RATHER THAN
  // BY INTENTION. Cloudflare secrets cannot be read back out, so the exposure is
  // not the store — it is this code putting the value somewhere it can be seen: a
  // `console.log` that lands in Workers Logs, or a `detail` string that lands in
  // `cron_heartbeat` and is then read by check-heartbeats.mjs and pasted into a
  // PUBLIC GitHub issue by the ops-watch alert job. The second one is the real
  // hazard, and it is one interpolation away in a file whose whole idiom is
  // "put the reason in the detail".
  const TOKEN = 'ghp_SENTINEL_VALUE_THAT_MUST_NOT_APPEAR_ANYWHERE';

  it('no heartbeat detail contains the token, on the success path or any failure path', async () => {
    for (const outcome of [204, 200, 404, 500, new Error('boom with context')]) {
      const db = realPlatformDb();
      stubFetch(outcome as number | Error);
      await dispatchGithubWorkflows(envWith(db, TOKEN));
      for (const r of rows(db)) {
        expect(String(r.detail)).not.toContain(TOKEN);
        expect(String(r.detail)).not.toContain('ghp_');
        expect(String(r.target)).not.toContain(TOKEN);
      }
    }
  });

  it('no console line contains the token', async () => {
    const said: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => { said.push(a.map(String).join(' ')); };
    try {
      for (const outcome of [204, 404, new Error('boom')]) {
        const db = realPlatformDb();
        stubFetch(outcome as number | Error);
        await dispatchGithubWorkflows(envWith(db, TOKEN));
      }
    } finally {
      console.log = realLog;
    }
    expect(said.length).toBeGreaterThan(0);
    for (const line of said) expect(line).not.toContain(TOKEN);
  });

  it('the token reaches exactly one place — the Authorization header of the dispatch request', async () => {
    const db = realPlatformDb();
    const seen = stubFetch(204);
    await dispatchGithubWorkflows(envWith(db, TOKEN));
    const carrying = seen.filter((s) => JSON.stringify(s).includes(TOKEN));
    expect(carrying).toHaveLength(seen.length);
    for (const s of seen) {
      // In the header, and nowhere else in the request — not the URL (which
      // would put it in GitHub's own access logs and in any proxy's) and not
      // the body.
      expect((s.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(s.url).not.toContain(TOKEN);
      expect(String(s.init.body)).not.toContain(TOKEN);
    }
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
