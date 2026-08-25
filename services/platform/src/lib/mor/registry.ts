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
//
// ─────────────────────────────────────────────────────────────────────────────
// CORRECTION 2026-08-25 — LANDED THE SAME DAY THE RECORD ABOVE WAS WRITTEN, and
// before any reader had leaned on it. THE COUNT ABOVE IS WRONG. It is corrected
// here rather than overwritten, because the figure above is a DATED measurement
// and a later reader is owed all three of the old figure, the measured one, and
// the direction of the error.
//
//   STATED    "one occurrence in the tree, its own declaration" — ZERO readers.
//   MEASURED  `git grep -n moneySecretEnvVars`, run from the root of each of the
//             four repositories, returns THREE matching lines, not one. The
//             record UNDERSTATED the sweep by two, in the direction that
//             flattered the deletion.
//
//     Nikatru_Platform_Public      1   ← the DELETED header line above
//     Nikatru_Platform_Private     2   ← plans/p4-p7-specs/p4-checkout.json
//     Nikatru_Extensions_Public    0
//     Nikatru_Extensions_Private   0
//
// WHERE THE TWO FURTHER LINES ARE, AND WHY THEY LEAVE THE DELETION STANDING.
// Both sit in ONE file — `p4-checkout.json` under `plans/p4-p7-specs/` in
// Nikatru_Platform_Private — and both inside its single element `edits[5]`,
// whose `file` field names THIS file's path. They are that scripted patch's
// `find` and `replace`: the `find` is the helper's exact former text, anchored
// on it character-for-character, and the `replace` re-emits that text and then
// appends a `checkoutCredentialEnvVars()` documented as "the outbound twin of
// [moneySecretEnvVars]".
//
// That patch can never run. The spec's FIRST key is `DO-NOT-APPLY` — "SUPERSEDED
// BY [ADR 044] AND WAS NEVER REPAIRED. Do not implement anything below it." —
// and ADR 044 itself (`decisions/044-paddle-checkout-contract.md`, Status ✅
// LOCKED) names that spec in its own `Supersedes:` header as DO-NOT-APPLY and
// "stays that way". ADR 044, the contract that actually governs checkout, never
// mentions the deleted helper, never mentions its proposed twin
// `checkoutCredentialEnvVars`, and never mentions `secretEnvVar` at all. So the
// three hits are one declaration site and two lines of a superseded,
// never-repaired, do-not-apply spec: NO live caller, NO pending patch, NO
// owner-locked seam removed. Do not resurrect the function.
//
// ⚠️ AND THE BARE SWEEP WILL DRIFT FROM THREE, BY THIS CORRECTION'S OWN DOING:
// the text you are reading sits inside the sweep's domain and spells the
// identifier twice more, so Nikatru_Platform_Public now answers 3 on its own —
// all three lines in THIS file, all three commentary, none of them code. The
// rule that does not drift is the same command with this file excluded:
//
//     git grep -n <the identifier> -- ':!services/platform/src/lib/mor/registry.ts'
//
// which returns 0 / 2 / 0 / 0 across the four repos in the order listed above —
// i.e. every occurrence outside this record is one of the two spec lines.
//
// WHAT WAS DEFECTIVE WAS THE ARITHMETIC, NOT THE CONCLUSION. A zero whose
// declared domain is "all four repositories in every language" has to be the
// number that sweep actually returns, and this one was not — inside a record
// whose entire purpose is to be trusted by a later reader instead of re-derived.
// A reader who runs the rule as written now gets three, and gets, in the same
// breath, the reason all three are inert.
// ─────────────────────────────────────────────────────────────────────────────
