import { afterEach, describe, it, expect, vi } from 'vitest';

import { anchoredOffset, ANCHOR_VAR, installedOffset, parseTestNow, shiftedDate, TEST_NOW_VAR } from './test-clock';

// ─────────────────────────────────────────────────────────────────────────────
// test-clock.test.ts — the shared test clock is WIRED into every Worker suite,
// MOVES `Date` when NIKATRU_TEST_NOW is set, and moves NOTHING when it is not.
//
// The time-travel workflow is evidence only while two things hold: every
// Worker's vitest.config.ts still loads test-clock.ts, and the file still moves
// the clock. Either breaking leaves the weekly run green on today's clock, which
// reads exactly like "no fuse found". So both are asserted here, in every lane
// that runs the shared suite, and the clock half again under the variable by the
// time-travel run itself (T2 is the case that run proves itself with).
//
//   T1 every Worker's vitest.config.ts (and the brick's) lists test-clock.ts in
//      `setupFiles` — read from the tree, refused when the tree is empty
//   T2 under NIKATRU_TEST_NOW, `Date.now()` and `new Date()` read that instant;
//      without it, they read the real clock
//   T3 the shifted `Date` moves only the no-argument forms
//   T4 a test that pins its own clock and restores it gets the shift back
//   T5 a value without a zone, or not an instant, is refused
//   T6 an ancestor's anchor for the SAME instant is reused; another's is not
// ─────────────────────────────────────────────────────────────────────────────

const nodeProcess = (
  globalThis as unknown as {
    process: {
      cwd(): string;
      env: Record<string, string | undefined>;
      getBuiltinModule(id: 'node:fs'): {
        existsSync(p: string): boolean;
        readFileSync(p: string, enc: 'utf8'): string;
        readdirSync(p: string): string[];
      };
    };
  }
).process;
const fs = nodeProcess.getBuiltinModule('node:fs');

function repoRoot(): string {
  const cwd = nodeProcess.cwd().replaceAll('\\', '/');
  for (const up of ['', '/..', '/../..', '/../../..']) {
    if (fs.existsSync(`${cwd}${up}/services/_shared/test/test-clock.ts`)) return `${cwd}${up}`;
  }
  throw new Error(`COVERAGE LOST — no ancestor of ${cwd} holds services/_shared/test/test-clock.ts.`);
}

const DAY = 86_400_000;
const travelTo = parseTestNow(nodeProcess.env[TEST_NOW_VAR]);

describe('test-clock.ts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T1 every Worker suite loads it', () => {
    const root = repoRoot();
    const configs = fs
      .readdirSync(`${root}/services`)
      .filter((d) => d !== '_shared' && fs.existsSync(`${root}/services/${d}/vitest.config.ts`))
      .map((d) => `services/${d}/vitest.config.ts`);
    const bricks = `${root}/tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/vitest.config.ts`;
    // A stamped Worker carries its own config; the brick's is the template every
    // new one is stamped from, so it is held to the same line.
    if (fs.existsSync(bricks)) configs.push(bricks.slice(root.length + 1));
    expect(configs.length, 'no Worker vitest.config.ts was found, so nothing was checked').toBeGreaterThanOrEqual(3);
    for (const c of configs) {
      const text = fs.readFileSync(`${root}/${c}`, 'utf8');
      const setup = /setupFiles:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? '';
      expect(setup, `${c} does not load ../_shared/test/test-clock.ts`).toMatch(/['"]\.\.\/_shared\/test\/test-clock\.ts['"]/);
    }
  });

  it('T2 the clock reads NIKATRU_TEST_NOW when it is set, and the real clock when it is not', () => {
    const real = vi.getRealSystemTime();
    if (travelTo === null) {
      expect(installedOffset(Date)).toBeNull();
      expect(Math.abs(Date.now() - real)).toBeLessThan(DAY);
    } else {
      expect(installedOffset(Date)).not.toBeNull();
      // Started at the instant, and has only run forward since — by no more than
      // the length of a test run.
      expect(Date.now()).toBeGreaterThanOrEqual(travelTo);
      expect(Date.now() - travelTo).toBeLessThan(DAY);
      expect(new Date().getTime() - travelTo).toBeLessThan(DAY);
    }
  });

  it('T3 only the no-argument forms move', () => {
    const D = shiftedDate(globalThis.Date, 400 * DAY);
    const before = Date.now();
    expect(D.now() - before).toBeGreaterThanOrEqual(400 * DAY - 1000);
    expect(new D().getTime() - before).toBeGreaterThanOrEqual(400 * DAY - 1000);
    expect(new D('2020-02-29T12:00:00Z').toISOString()).toBe('2020-02-29T12:00:00.000Z');
    expect(new D(0).getTime()).toBe(0);
    expect(D.UTC(2020, 0, 1)).toBe(Date.UTC(2020, 0, 1));
    expect(D.parse('2020-01-01T00:00:00Z')).toBe(Date.UTC(2020, 0, 1));
    expect(new D() instanceof Date).toBe(true);
    expect((D as unknown as () => string)()).toMatch(/\d{4}/);
    expect(installedOffset(D)).toBe(400 * DAY);
  });

  it('T4 a test that pins its own clock is pinned, and gets the shift back after', () => {
    const shiftedBefore = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T00:00:00Z'));
    expect(new Date().toISOString()).toBe('2026-09-25T00:00:00.000Z');
    vi.useRealTimers();
    expect(Math.abs(Date.now() - shiftedBefore)).toBeLessThan(DAY);
  });

  it('T5 a typo is refused, never read as "today"', () => {
    for (const bad of ['2027-11-05', '2027-11-05T00:00:00', 'tomorrow', '2027-13-45T00:00:00Z']) {
      expect(() => parseTestNow(bad), bad).toThrow(/not an ISO-8601 instant with a zone/);
    }
    expect(parseTestNow(undefined)).toBeNull();
    expect(parseTestNow('')).toBeNull();
    expect(parseTestNow('2027-11-05T00:00:00Z')).toBe(Date.UTC(2027, 10, 5));
  });

  it('T6 one offset per run: the anchor is reused for its own instant only', () => {
    const at = '2027-11-05T00:00:00Z';
    expect(anchoredOffset({ [TEST_NOW_VAR]: at, [ANCHOR_VAR]: `${at}|1234` })).toBe(1234);
    expect(anchoredOffset({ [TEST_NOW_VAR]: '2030-01-01T00:00:00Z', [ANCHOR_VAR]: `${at}|1234` })).toBeNull();
    expect(anchoredOffset({ [TEST_NOW_VAR]: at })).toBeNull();
    if (travelTo !== null) {
      // This process moved the clock, so it left the anchor its children reuse.
      expect(anchoredOffset(nodeProcess.env)).toBe(installedOffset(Date));
    }
  });
});
