// ─────────────────────────────────────────────────────────────────────────────
// The MoR adapter registry — [ADR 004]'s "per-provider signature adapters" made
// enumerable.
//
// It exists as DATA rather than as a switch statement in the route for one
// reason: `tooling/ci/assert-mor-adapters.mjs` derives the provider set FROM
// THIS FILE. A guard whose right-hand side is a hand-kept list in the guard
// itself stops covering a provider the day one is added and never says so — the
// exact "a check that stopped checking" shape [pipeline F-10] exists for. Here,
// registering a rail automatically puts it inside the guard's floor ("every
// registered provider has a passing tampered-body test"), and an EMPTY registry
// is COVERAGE LOST rather than a clean run over nothing.
// ─────────────────────────────────────────────────────────────────────────────
import type { MoRWebhookVerifier } from './contract';
import { paddleVerifier } from './paddle';

/**
 * Every rail that can verify a notification today.
 *
 * ⚠️ LEMON SQUEEZY IS DELIBERATELY ABSENT, and its absence is the honest state
 * rather than an oversight. [ADR 004] applies to both rails the same day, and
 * the interface above is exactly what lets the choice flip — but not one Lemon
 * Squeezy signature fact has been established from a primary source in this
 * repo. Registering an adapter built on a guessed signature scheme would put a
 * rail in the registry that CANNOT verify anything, and it would satisfy every
 * count-based guard while doing so. When the facts are sourced, the adapter is
 * one file and one line here.
 */
export const MOR_VERIFIERS: readonly MoRWebhookVerifier[] = [paddleVerifier];

const BY_PROVIDER = new Map(MOR_VERIFIERS.map((v) => [v.provider, v]));

export function verifierFor(provider: string): MoRWebhookVerifier | null {
  return BY_PROVIDER.get(provider) ?? null;
}

/** The env var names every registered rail's destination secret lives under. */
export function moneySecretEnvVars(): readonly string[] {
  return MOR_VERIFIERS.map((v) => v.secretEnvVar);
}
