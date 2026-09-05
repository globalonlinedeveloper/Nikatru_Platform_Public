// ─────────────────────────────────────────────────────────────────────────────
// contract.d.ts — the TypeScript view of contract.js. Hand-written, never
// generated, and never compiled: a declaration file emits nothing, so it does
// not make anything that imports it a "built" artefact.
//
// services/platform imports `contract.js` and TypeScript resolves these types
// beside it. The extensions import the same `contract.js` and `tsc --noEmit
// --checkJs` grades their call sites against these same declarations. One file
// of runtime, one file of types, two consumers, zero build steps.
// ─────────────────────────────────────────────────────────────────────────────

export type MoneyEnvironment = 'live' | 'sandbox';

export const MONEY_ENVIRONMENTS: readonly MoneyEnvironment[];

export function isMoneyEnvironment(v: unknown): v is MoneyEnvironment;

export interface RevocationReason {
  readonly reason: string;
  /** The one member that GIVES ACCESS BACK. Dropping this field is the bug. */
  readonly restores: boolean;
}

export const REVOCATION_REASONS: readonly RevocationReason[];

export function isRevocationReason(v: unknown): boolean;

export function restoresAccess(reason: string): boolean;

export const CONTRACT_TABLE: {
  readonly moneyEnvironments: readonly MoneyEnvironment[];
  readonly revocationReasons: readonly RevocationReason[];
};
