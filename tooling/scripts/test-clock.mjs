// ─────────────────────────────────────────────────────────────────────────────
// test-clock.mjs — THE NODE HALF OF THE TEST-TIME CLOCK. Loaded with
//   NODE_OPTIONS="--import=<repo>/tooling/scripts/test-clock.mjs"
// so EVERY node process of a run — the `node --test` runner, each test file it
// forks, and each child a test spawns — reads the same shifted clock.
//
// 🔴 WHY A PRELOAD AND NOT A HELPER A TEST CALLS. The #1101 lane faked the clock
// inside one process and the child it spawned kept the REAL one: a fake clock is
// a property of a process, and a process boundary drops it. Two environment
// variables are a property of the process TREE — every child inherits
// NODE_OPTIONS and NIKATRU_TEST_NOW unless a test hands it a hand-built env —
// so the shift crosses every spawn a tooling test makes. tooling/ci/test/
// test-clock.test.mjs proves it on a grandchild.
//
// With NIKATRU_TEST_NOW unset or empty this module does NOTHING. With an
// ISO-8601 instant that carries its zone, the global `Date` STARTS at that
// instant and advances in real time; only `Date` is faked, timers stay real.
// Anything else THROWS at startup, naming the value: a typo must never run the
// suite on today and call it a time-travel run.
//
// 🔴 ONE OFFSET PER RUN, NOT ONE PER PROCESS. The first process to load this
// computes `instant − real now` and writes it to NIKATRU_TEST_NOW_ANCHOR as
// `<instant>|<offset ms>`; every descendant that inherits the same instant
// REUSES that offset instead of starting its own clock at the instant. Without
// it a child started 18 s after its parent ran 18 s BEHIND it — measured on the
// first time-travel run of tooling/ci/test: heavy-lock.test.mjs planted a lock
// "10 min old" by the parent's clock and the child guard read it as 9.7 min.
// On a real calendar every process shares one clock; so must a moved one.
//
// The Worker half — the vitest setup file every Worker suite loads — is
// services/_shared/test/test-clock.ts, with the full argument for an offset
// `Date` over a frozen fake clock. Both mark the `Date` they install with
// `Symbol.for('nikatru.testClock')`, so a process that loads both shifts ONCE.
//
// ── TWO HELPERS FOR A TEST THAT SPAWNS ──────────────────────────────────────
//   clockEnv()          the three variables of THIS run's clock, for a test that
//                       builds its child's env from scratch (`{ PATH, … }`) —
//                       the #1101 failure mode: the child kept the real clock
//                       and its dates disagreed with the parent's.
//   useRealClock(why)   for a test whose subject is a clock NO process can move
//                       — a file's mtime, the live tree's register dates graded
//                       against today. It puts the real `Date` back in this
//                       process and removes the run's variables from
//                       process.env, so its children run on the real clock too.
//                       It demands a reason, and prints it on a moved run, so
//                       every opt-out is named in the log it hides from.
//
// Not a guard and not a CLI: importing it (or loading it with --import) is the
// whole interface. The scheduled .github/workflows/time-travel.yml loads it.
// ─────────────────────────────────────────────────────────────────────────────

export const TEST_NOW_VAR = 'NIKATRU_TEST_NOW';
export const ANCHOR_VAR = 'NIKATRU_TEST_NOW_ANCHOR';
const MARK = Symbol.for('nikatru.testClock');
const REAL = Symbol.for('nikatru.testClock.real');
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** `NIKATRU_TEST_NOW` as epoch ms, `null` when unset or empty; throws on anything else. */
export function parseTestNow(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const v = String(raw).trim();
  const ms = INSTANT.test(v) ? Date.parse(v) : Number.NaN;
  if (!Number.isFinite(ms)) {
    throw new Error(
      `${TEST_NOW_VAR}=${JSON.stringify(raw)} is not an ISO-8601 instant with a zone ` +
        '(for example 2027-11-05T00:00:00Z). Refusing to run on the real clock and call it a time-travel run ' +
        '(tooling/scripts/test-clock.mjs).',
    );
  }
  return ms;
}

/** A `Date` whose no-argument forms read `real.now() + offsetMs`; every other form is `real`'s. */
export function shiftedDate(real, offsetMs) {
  const now = () => real.now() + offsetMs;
  const shifted = new Proxy(real, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget === shifted ? target : newTarget);
    },
    apply() {
      return new real(now()).toString();
    },
    get(target, prop, receiver) {
      if (prop === 'now') return now;
      if (prop === MARK) return offsetMs;
      if (prop === REAL) return real;
      return Reflect.get(target, prop, receiver);
    },
  });
  return shifted;
}

/** The offset an ancestor recorded for THIS instant, or null. An anchor left by
 *  a different instant (a test that hands a child its own NIKATRU_TEST_NOW) is
 *  not this run's, and is ignored. */
export function anchoredOffset(env) {
  const instant = String(env[TEST_NOW_VAR] ?? '').trim();
  const m = /^(.+)\|(-?\d+)$/.exec(String(env[ANCHOR_VAR] ?? ''));
  return m && m[1] === instant ? Number(m[2]) : null;
}

/** The variables that carry this run's clock to a child, as an object to spread
 *  into a hand-built env. Empty when the clock was not moved. */
export function clockEnv(env = process.env) {
  const out = {};
  if (parseTestNow(env[TEST_NOW_VAR]) === null) return out;
  for (const k of [TEST_NOW_VAR, ANCHOR_VAR, 'NODE_OPTIONS']) {
    if (env[k] !== undefined && env[k] !== '') out[k] = env[k];
  }
  return out;
}

/** Puts the real clock back for this process and its future children, and says
 *  why on a moved run. Returns true when there was a moved clock to undo. */
export function useRealClock(why) {
  if (typeof why !== 'string' || why.trim().length < 40) {
    throw new Error('useRealClock(why): say, in a sentence, which clock this test reads that no process can move.');
  }
  const real = globalThis.Date[REAL];
  delete process.env[TEST_NOW_VAR];
  delete process.env[ANCHOR_VAR];
  if (typeof real !== 'function') return false;
  globalThis.Date = real;
  console.log(`# test-clock: this file runs on the REAL clock — ${why.trim()}`);
  return true;
}

const target = parseTestNow(process.env[TEST_NOW_VAR]);
if (target !== null && typeof globalThis.Date[MARK] !== 'number') {
  const offset = anchoredOffset(process.env) ?? target - Date.now();
  process.env[ANCHOR_VAR] = `${String(process.env[TEST_NOW_VAR]).trim()}|${offset}`;
  globalThis.Date = shiftedDate(globalThis.Date, offset);
}
