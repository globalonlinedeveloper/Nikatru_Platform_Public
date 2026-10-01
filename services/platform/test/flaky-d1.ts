// ─────────────────────────────────────────────────────────────────────────────
// flaky-d1.ts — THE ONE TRANSIENT-D1 FAULT INJECTOR, shared by every test that
// proves a route survives a D1 reset.
//
// ⏱ 2026-10-01 · O-PLATFORM-ROUTE-EDGES-UNTESTED (rv2-services-003). Moved here
// verbatim from test/d1-transient-preflight.test.ts, which still uses it, so the
// write-path tests (test/route-write-retry.test.ts) inject the SAME fault the
// erasure preflight is held to, rather than a second injector that drifts.
// Two things were added, both opt-in, so the preflight's cases are unchanged:
//
//   · `methods` — which statement methods strike. The preflight's reads strike
//     on `all` (its default, and the only one it ever had); a write strikes on
//     `run`.
//   · `commitFirst` — the struck execution RUNS the real statement first and
//     only then throws. That is the ambiguous half of the production fault: the
//     object reset AFTER the write committed and BEFORE the acknowledgement
//     returned. A retry then meets its own row, and a route that answers that as
//     "not found" or "rate limited" has turned a success into a failure.
// ─────────────────────────────────────────────────────────────────────────────
import type { RealDb } from './harness';

/** The production message, copied from the GlitchTip event named in lib/d1.ts.
 *  Deliberately the FULL wire text, not the substring the matcher looks for. */
export const TRANSIENT =
  'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.';

/** A failure D1 will return identically every time. Retrying it is pure delay. */
export const DETERMINISTIC = 'D1_ERROR: no such column: definitely_not_a_column';

type Method = 'all' | 'first' | 'run';

export interface FlakyOptions {
  /** How many matching executions fail before the real engine answers. Default 1. */
  times?: number;
  /** The statement methods that strike. Default `['all']` — a batch carrying a
   *  matching statement always strikes. */
  methods?: readonly Method[];
  /** Run the real statement BEFORE throwing: the write committed, the ack was lost. */
  commitFirst?: boolean;
}

/**
 * Wraps a real database and makes the FIRST `n` executions of any statement
 * matching `failWhen` throw. Everything else is the real engine.
 *
 * The counter lives on the WRAPPER, not on the statement, because that is the
 * shape the retry has to survive: `withD1Retry` re-invokes `.all()` on the SAME
 * prepared statement, so a per-statement counter would make the retry succeed
 * for the wrong reason.
 *
 * ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS. THE INJECTOR FOLLOWS THE STATEMENT
 * INTO `batch()`. The pragma reads now travel as ONE batch, and this class used
 * to pass a batch straight through — so the pragma case went red on
 * `injected === 1`, which is the injector doing its job: the fault had stopped
 * firing. A batch that carries any matching statement is now ONE execution, and
 * fails as one, because that is the unit D1 resets and the unit `withD1Retry`
 * re-sends.
 */
const INNER = Symbol('flaky-inner');
type Stmt = ReturnType<RealDb['prepare']>;
type Wrapped = { [INNER]: Stmt };

export class FlakyD1 {
  /** Executions of a MATCHING statement (or of a batch carrying one), thrown or not. */
  calls = 0;
  /** Executions this injector actually failed. Zero means the test is vacuous. */
  injected = 0;
  private remaining: number;
  private readonly methods: ReadonlySet<Method>;
  private readonly commitFirst: boolean;

  constructor(
    private readonly inner: RealDb,
    private readonly failWhen: RegExp,
    private readonly message: string,
    timesOrOptions: number | FlakyOptions = 1,
  ) {
    const o = typeof timesOrOptions === 'number' ? { times: timesOrOptions } : timesOrOptions;
    this.remaining = o.times ?? 1;
    this.methods = new Set(o.methods ?? ['all']);
    this.commitFirst = o.commitFirst ?? false;
  }

  /** One execution of a matching statement: counted, and failed while `remaining` lasts. */
  private strike(): boolean {
    this.calls++;
    if (this.remaining > 0) {
      this.remaining--;
      this.injected++;
      return true;
    }
    return false;
  }

  private async exec<T>(method: Method, real: () => Promise<T>): Promise<T> {
    if (!this.methods.has(method)) return real();
    if (!this.strike()) return real();
    if (this.commitFirst) await real();
    throw new Error(this.message);
  }

  private wrap(stmt: Stmt) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      [INNER]: stmt,
      bind: (...args: unknown[]) => self.wrap(stmt.bind(...args) as Stmt),
      all: <T = Record<string, unknown>>() => self.exec('all', () => stmt.all<T>()),
      first: <T = Record<string, unknown>>() => self.exec('first', () => stmt.first<T>()),
      run: () => self.exec('run', () => stmt.run()),
    };
  }

  prepare(sql: string) {
    const stmt = this.inner.prepare(sql);
    return this.failWhen.test(sql) ? this.wrap(stmt) : stmt;
  }

  async batch(statements: unknown[]) {
    const matching = statements.some((s) => typeof s === 'object' && s !== null && INNER in s);
    const real = statements.map((s) => (typeof s === 'object' && s !== null && INNER in s ? (s as Wrapped)[INNER] : s));
    if (matching && this.strike()) {
      if (this.commitFirst) await this.inner.batch(real as never);
      throw new Error(this.message);
    }
    return this.inner.batch(real as never);
  }
}
