// ─────────────────────────────────────────────────────────────────────────────
// iso4217.d.ts — the TypeScript view of iso4217.js. Hand-written, never
// generated, and never compiled (the same shape as entitlement/contract.d.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const MINOR_UNIT_DIGITS: Readonly<Record<string, number>>;

export function isIso4217(code: unknown): code is string;

export function minorUnitDigits(code: string): number | null;

export function toMinorUnits(price: number, code: string): number | null;

export function legacyClientMinorUnitDigits(code: string): number;

export const LEGACY_SCALE_CODES: readonly string[];

export function legacyMinorUnits(price: number, code: string): number | null;
