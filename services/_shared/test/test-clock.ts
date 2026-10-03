// ─────────────────────────────────────────────────────────────────────────────
// test-clock.ts — A WORKER TEST CAN BE RUN ON ANOTHER DAY. Every Worker's
// vitest.config.ts lists this file in `test.setupFiles`, beside no-network.ts,
// so it runs before each test file is imported, in every Worker stamped from the
// brick too.
//
// 🔴 THE DEFECT THIS EXISTS FOR. ⏱ 2026-10-01 00:00Z, services/platform's
// fx.test.ts read the real clock against a fixed `asOf`, and when the wall clock
// passed asOf + 5 days the case went red on EVERY pull request for hours, on
// code nobody had touched (#1101). The sweep that pinned it found two more fuses
// of the same shape in money.test.ts (2027-01-01) and receipts.test.ts
// (2027-09-01). Each was found by READING. A date fuse is invisible on the day
// it is written and fires on a day nobody chose, so the only way to find the
// next one before it fires is to run the suite on that day — which is what the
// weekly .github/workflows/time-travel.yml does with this file.
//
// WHAT THIS DOES. With `NIKATRU_TEST_NOW` unset or empty it does NOTHING: the
// global `Date` is untouched and the suite runs exactly as it did before this
// file. With `NIKATRU_TEST_NOW=2027-11-05T00:00:00Z` (an ISO-8601 instant WITH
// its zone — a zoneless one would mean a different instant on every runner) the
// global `Date` is replaced by one whose "now" STARTS at that instant and then
// advances in real time. Only `Date` is faked; setTimeout, setInterval,
// performance.now() and the event loop stay real, so a timeout still times out.
// An unparseable value THROWS, naming it: a typo must never quietly run the
// suite on today and call it a time-travel run.
//
// WHY AN OFFSET `Date` AND NOT `vi.useFakeTimers` + `vi.setSystemTime`:
//   · it ADVANCES. A frozen clock hangs any `while (Date.now() < deadline)` and
//     reads every elapsed time as 0; the shifted clock is the real one plus a
//     constant, so durations are real durations.
//   · it SURVIVES the tests that pin their own clock. A test that calls
//     `vi.useFakeTimers()` starts its fake clock at `Date.now()` — the shifted
//     one — and its `vi.useRealTimers()` restores the `Date` it found, which is
//     this one. A test that calls `vi.setSystemTime(X)` is pinned to X, as it
//     asked: a pinned test is the cure, not the disease.
//   · the ONE path that drops it is vitest's own `resetDate()` (a test that
//     called `vi.setSystemTime` WITHOUT fake timers, then `vi.useRealTimers`),
//     which puts back the `Date` vitest captured before this file ran. The
//     `beforeEach` below puts the shift back before the next test.
//
// ⚠️ NO IMPORT BUT `vitest`, for the reason no-network.ts gives: the shared
// home has no node_modules (shared-home.test.ts).
//
// The node half — child processes in tooling tests — is
// tooling/scripts/test-clock.mjs, loaded with `--import` through NODE_OPTIONS so
// every child inherits it. Both mark the `Date` they install with the same
// symbol, so a process that has both (a vitest fork under that NODE_OPTIONS)
// shifts ONCE, and both honour NIKATRU_TEST_NOW_ANCHOR (`<instant>|<offset>`),
// so a process whose ancestor already moved the clock reuses that offset
// instead of starting a second clock at the instant (the header of
// test-clock.mjs has the measured case).
// ─────────────────────────────────────────────────────────────────────────────
import { beforeEach } from 'vitest';

/** The variable both halves read. */
export const TEST_NOW_VAR = 'NIKATRU_TEST_NOW';
/** `<instant>|<offset ms>`, written by the first process of a run to move the clock. */
export const ANCHOR_VAR = 'NIKATRU_TEST_NOW_ANCHOR';

/** Marks a `Date` installed by either half (see tooling/scripts/test-clock.mjs). */
const MARK = Symbol.for('nikatru.testClock');

/** An ISO-8601 instant with an explicit zone: `Z` or `±hh:mm`. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** `NIKATRU_TEST_NOW` as epoch ms, `null` when unset or empty; throws on anything else. */
export function parseTestNow(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const v = raw.trim();
  const ms = INSTANT.test(v) ? Date.parse(v) : Number.NaN;
  if (!Number.isFinite(ms)) {
    throw new Error(
      `${TEST_NOW_VAR}=${JSON.stringify(raw)} is not an ISO-8601 instant with a zone ` +
        '(for example 2027-11-05T00:00:00Z). Refusing to run on the real clock and call it a time-travel run ' +
        '(services/_shared/test/test-clock.ts).',
    );
  }
  return ms;
}

type DateCtor = DateConstructor & { [MARK]?: number };

/** A `Date` whose no-argument forms read `real.now() + offsetMs`; every other form is `real`'s. */
export function shiftedDate(real: DateConstructor, offsetMs: number): DateConstructor {
  const now = (): number => real.now() + offsetMs;
  const shifted: DateConstructor = new Proxy(real, {
    construct(target, args, newTarget): object {
      return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget === shifted ? target : newTarget);
    },
    // `Date()` called without `new` returns the current time as a string.
    apply() {
      return new real(now()).toString();
    },
    get(target, prop, receiver) {
      if (prop === 'now') return now;
      if (prop === MARK) return offsetMs;
      return Reflect.get(target, prop, receiver);
    },
  });
  return shifted;
}

/** The offset an installed shift carries, or `null` when `ctor` is not one. */
export function installedOffset(ctor: DateConstructor): number | null {
  const o = (ctor as DateCtor)[MARK];
  return typeof o === 'number' ? o : null;
}

// Through `globalThis`, as shared-home.test.ts reads `process`: the Workers'
// `types` are only @cloudflare/workers-types, which has no `process`.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const target = parseTestNow(env[TEST_NOW_VAR]);

/** The offset an ancestor recorded for THIS instant, or null (see the header). */
export function anchoredOffset(e: Record<string, string | undefined>): number | null {
  const m = /^(.+)\|(-?\d+)$/.exec(e[ANCHOR_VAR] ?? '');
  return m && m[1] === (e[TEST_NOW_VAR] ?? '').trim() ? Number(m[2]) : null;
}

if (target !== null) {
  // The `Date` this file found, captured before anything replaced it. When the
  // node half already shifted it, keep that one: its offset was taken against
  // the real clock, and a second shift would add the distance twice.
  const found = globalThis.Date;
  let shift = found;
  if (installedOffset(found) === null) {
    const offset = anchoredOffset(env) ?? target - found.now();
    env[ANCHOR_VAR] = `${(env[TEST_NOW_VAR] ?? '').trim()}|${offset}`;
    shift = shiftedDate(found, offset);
  }
  globalThis.Date = shift;

  beforeEach(() => {
    // Put the shift back only over the `Date` this file found. Anything else is
    // a test's own fake clock (vitest's, or sinon's under `vi.useFakeTimers`),
    // and replacing it would unpin a pinned test.
    if (globalThis.Date === found && found !== shift) globalThis.Date = shift;
  });
}
