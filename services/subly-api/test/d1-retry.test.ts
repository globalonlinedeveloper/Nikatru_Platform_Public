// ─────────────────────────────────────────────────────────────────────────────
// d1-retry.test.ts — the transient-D1 retry must retry the right thing, refuse
// the wrong thing, and never turn a failed write into a reported success.
//
// 🔴 WHY THIS FILE IS MOSTLY NEGATIVE CASES. The retry was added to stop a real
// production 500 (`D1_ERROR: D1 DB storage operation exceeded timeout which
// caused object to be reset`) from reddening `E2E (live)` roughly every other
// night. The dangerous version of that fix is the one that also swallows the
// errors it should not — a constraint failure retried is a slow error, and a
// write that failed but reports success is data loss reported as health. So the
// cases below are weighted toward what must STILL throw.
//
// The subject is driven with fake statements, so every branch is reachable
// without a live D1 and without waiting for a Durable Object to be reset — the
// exact problem that made this defect so hard to reproduce in the first place.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { allRows, firstRow, isTransientD1Error, isUniqueViolation, run, withD1Retry } from '../src/lib/d1';

/** The real message, verbatim from the production stack trace. */
const RESET = new Error(
  'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.',
);
const UNIQUE = new Error('D1_ERROR: UNIQUE constraint failed: subscriptions.id');

/** A fake D1PreparedStatement whose `all`/`first`/`run` fail a set number of
 *  times before succeeding. `calls` is what the assertions are really about:
 *  a retry that did not happen and a retry that happened twice look identical
 *  from the return value alone. */
function stmt(opts: { failures: number; error?: Error; value?: unknown }) {
  const state = { calls: 0 };
  // ⚠️ `has` RATHER THAN `?? fallback`. The first version of this helper used
  // `step() ?? <default>`, which made `value: null` indistinguishable from "no
  // value given" — so the one case that asserts firstRow maps an absent row to
  // null could never pass. The double, not the subject, was wrong.
  const has = Object.prototype.hasOwnProperty.call(opts, 'value');
  const step = (fallback: unknown) => {
    state.calls++;
    if (state.calls <= opts.failures) throw opts.error ?? RESET;
    return has ? opts.value : fallback;
  };
  return {
    state,
    stmt: {
      all: async () => step({ results: [{ id: 'row' }] }),
      first: async () => step({ id: 'row' }),
      run: async () => step({ success: true, results: [], meta: { changes: 1 } }),
    } as unknown as D1PreparedStatement,
  };
}

describe('isTransientD1Error — narrow by construction', () => {
  it('recognises the message measured in production', () => {
    expect(isTransientD1Error(RESET)).toBe(true);
  });

  it('recognises the other documented transients', () => {
    for (const m of [
      'Durable Object reset because its code was updated',
      'Network connection lost',
      'internal error in Durable Object storage',
    ]) {
      expect(isTransientD1Error(new Error(m)), m).toBe(true);
    }
  });

  it('🔴 REFUSES a constraint failure — deterministic, and retrying it only makes the error slower', () => {
    expect(isTransientD1Error(UNIQUE)).toBe(false);
    expect(isTransientD1Error(new Error('D1_ERROR: NOT NULL constraint failed: subscriptions.user_id'))).toBe(false);
  });

  it('🔴 REFUSES a constraint failure even when the word "reset" is also in the message', () => {
    // The ordering inside isTransientD1Error is what this asserts: a longer
    // message can carry both, and the constraint half must win.
    const both = new Error('UNIQUE constraint failed: subscriptions.id (object was reset)');
    expect(isTransientD1Error(both)).toBe(false);
  });

  it('refuses SQL, auth and type errors, and anything that is not an Error at all', () => {
    for (const e of [
      new Error('D1_ERROR: no such column: nope'),
      new Error('Unauthorized'),
      new TypeError('stmt.bind is not a function'),
      'a bare string',
      null,
      undefined,
    ]) {
      expect(isTransientD1Error(e), String(e)).toBe(false);
    }
  });
});

describe('withD1Retry', () => {
  it('returns the value without retrying when the first attempt succeeds', async () => {
    const op = vi.fn(async () => 'ok');
    expect(await withD1Retry(op)).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries ONE transient failure and then succeeds', async () => {
    let n = 0;
    const v = await withD1Retry(async () => {
      if (++n === 1) throw RESET;
      return 'ok';
    }, { delayMs: 0 });
    expect(v).toBe('ok');
    expect(n).toBe(2);
  });

  it('🔴 does NOT retry a non-transient error — it surfaces on the first attempt', async () => {
    let n = 0;
    await expect(withD1Retry(async () => { n++; throw UNIQUE; }, { delayMs: 0 })).rejects.toThrow(/UNIQUE/);
    expect(n, 'a constraint failure must cost exactly one attempt').toBe(1);
  });

  it('🔴 rethrows the ORIGINAL error once attempts are exhausted, unwrapped', async () => {
    let n = 0;
    await expect(
      withD1Retry(async () => { n++; throw RESET; }, { delayMs: 0 }),
    ).rejects.toThrow(/storage operation exceeded timeout/);
    expect(n).toBe(2);
  });

  it('🔴 REFUSES a nonsense `attempts` rather than silently not retrying', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(
        withD1Retry(async () => 'ok', { attempts: bad as number }),
      ).rejects.toThrow(/attempts must be an integer/);
    }
  });

  it('attempts: 1 disables retrying, explicitly', async () => {
    let n = 0;
    await expect(
      withD1Retry(async () => { n++; throw RESET; }, { attempts: 1, delayMs: 0 }),
    ).rejects.toThrow(RESET);
    expect(n).toBe(1);
  });
});

describe('the helpers that use it', () => {
  it('allRows survives one reset and returns the rows', async () => {
    const { stmt: s, state } = stmt({ failures: 1, value: { results: [{ id: 'a' }] } });
    expect(await allRows(s)).toEqual([{ id: 'a' }]);
    expect(state.calls).toBe(2);
  });

  it('firstRow survives one reset, and still maps an absent row to null', async () => {
    const { stmt: s } = stmt({ failures: 1, value: null });
    expect(await firstRow(s)).toBeNull();
  });

  it('run survives one reset and reports the real meta', async () => {
    const { stmt: s, state } = stmt({ failures: 1, value: { success: true, results: [], meta: { changes: 1 } } });
    const r = await run(s);
    expect(r.meta.changes).toBe(1);
    expect(state.calls).toBe(2);
  });

  // ── the write-path correctness argument, both sides ────────────────────────
  it('🔴 a UNIQUE violation AFTER a transient retry is a SUCCESS — the first attempt committed', async () => {
    // Reset first, then the retry collides with the row the reset attempt had
    // already written. Surfacing this would turn a successful write into a 500.
    let n = 0;
    const s = {
      run: async () => {
        if (++n === 1) throw RESET;
        throw UNIQUE;
      },
    } as unknown as D1PreparedStatement;
    const r = await run(s);
    expect(r.success).toBe(true);
    expect(r.meta.changes, 'this invocation changed nothing; the earlier attempt did').toBe(0);
    expect(n).toBe(2);
  });

  it('🔴 a UNIQUE violation on the FIRST attempt still THROWS — that is a real duplicate, not a retry artefact', async () => {
    // This is the case that keeps the branch above honest. If it ever starts
    // passing, `run` is swallowing genuine collisions.
    let n = 0;
    const s = { run: async () => { n++; throw UNIQUE; } } as unknown as D1PreparedStatement;
    await expect(run(s)).rejects.toThrow(/UNIQUE/);
    expect(n, 'no retry should have been attempted for a deterministic error').toBe(1);
  });

  it('🔴 a transient failure that never clears still THROWS — the retry is not an error sink', async () => {
    const s = { run: async () => { throw RESET; } } as unknown as D1PreparedStatement;
    await expect(run(s)).rejects.toThrow(/storage operation exceeded timeout/);
  });
});

describe('isUniqueViolation', () => {
  it('recognises the D1 wording and refuses everything else', () => {
    expect(isUniqueViolation(UNIQUE)).toBe(true);
    expect(isUniqueViolation(RESET)).toBe(false);
    expect(isUniqueViolation(new Error('no such table'))).toBe(false);
  });
});
