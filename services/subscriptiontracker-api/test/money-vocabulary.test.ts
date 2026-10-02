import { describe, it, expect } from 'vitest';
import { isMoneyEnvironment } from '../src/lib/money';
import { isMoneyEnvironment as declared, MONEY_ENVIRONMENTS } from '../../../contracts/entitlement/contract.js';

// ─────────────────────────────────────────────────────────────────────────────
// money-vocabulary.test.ts — this Worker's money vocabulary IS the contract's.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-035).
// src/lib/money.ts restated `MoneyEnvironment` / `isMoneyEnvironment` instead of
// importing them from contracts/entitlement/contract.js, the declaration
// services/platform re-exports. A restatement agrees until the day a third value
// is added to one side. 🔴 RED with the restatement put back: the function is
// then a different object.
// ─────────────────────────────────────────────────────────────────────────────

describe('the money environment vocabulary has one declaration', () => {
  it('lib/money re-exports the contract function itself, not a copy of it', () => {
    expect(isMoneyEnvironment).toBe(declared);
  });

  it('and accepts exactly the contract’s values', () => {
    for (const v of MONEY_ENVIRONMENTS) expect(isMoneyEnvironment(v)).toBe(true);
    for (const v of ['', 'LIVE', 'production', undefined, null]) expect(isMoneyEnvironment(v)).toBe(false);
  });
});
