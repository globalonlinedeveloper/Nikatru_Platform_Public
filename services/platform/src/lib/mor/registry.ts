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

// ─────────────────────────────────────────────────────────────────────────────
// DELETED 2026-08-25 — `moneySecretEnvVars()`, A HELPER WRITTEN FOR A CALLER
// THAT CANNOT EXIST.
//
// It returned `MOR_VERIFIERS.map((v) => v.secretEnvVar)` and had ZERO readers,
// measured across all four repositories in every language: one occurrence in the
// tree, its own declaration.
//
// It could not acquire one either, and that is the part worth recording rather
// than the count. Its intended readers were the guards — `contract.ts` says
// `secretEnvVar` is "named as DATA so tooling/ci/assert-money-config.mjs can
// enumerate the money secrets from the registry instead of from a hand-kept
// list". But a guard is `.mjs` run by bare node against a repository checkout;
// it cannot import a TypeScript module, so it can never CALL this. Both guards
// that need the set therefore PARSE it — assert-money-config.mjs:329-340 and
// assert-mor-adapters.mjs — reading MOR_VERIFIERS and then each adapter's
// `secretEnvVar: '…'` out of comment-stripped source. The registry's promise
// ("registering a rail automatically puts it inside the guard's floor") is kept
// by that parse, and it is kept whether or not this function exists.
//
// The Worker's own runtime never wanted a list: `routes/money.ts` reads
// `verifier.secretEnvVar` off the ONE verifier the URL segment resolved, and
// `routes/checkout.ts` names its credential directly. So this was a declaration
// standing in for a use — the same argument this repository applied to
// `Entitlement` on 2026-08-09, and the reason the deletion is recorded here
// instead of leaving a silence a later reader has to re-derive.
// ─────────────────────────────────────────────────────────────────────────────
