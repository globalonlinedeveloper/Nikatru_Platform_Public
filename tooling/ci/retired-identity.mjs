// ─────────────────────────────────────────────────────────────────────────────
// retired-identity.mjs — WHAT COUNTS AS A RETIRED NAME, in one place.
//
// [ADR 079]. Two checks ask the same question of two different worlds:
//
//   · tooling/ci/assert-retired-names.mjs  — does the SOURCE TREE name it?
//   · tooling/ops/check-retired-names-live.mjs — does the CLOUDFLARE ACCOUNT?
//
// The tokens already live in one place (tooling/channel-register.json), because
// assert-store-identity.mjs reads them too and a guard-side copy would be a
// second list to forget. The MATCHING RULE is the same kind of thing and had the
// same exposure: two copies of `squash` drifting apart would mean the tree check
// and the account check disagreed about whether `Sub-Ly` is the retired name —
// and the one that said no would be the one nobody re-read.
//
// So the rule lives here and both import it. `subly`, `Subly`, `SUBLY_DB`,
// `sub-ly` and `subly.nikatru.com` are one refusal.
// ─────────────────────────────────────────────────────────────────────────────

/** The register both checks read their tokens from. */
export const RETIRED_REGISTER_REL = 'tooling/channel-register.json';

/**
 * Case- and separator-insensitive form.
 *
 * Everything that is not a letter or a digit goes, so a name cannot dodge the
 * comparison by changing punctuation — which is exactly what a rename under
 * pressure does (`subly_db` → `subly-db` → `Subly DB`).
 */
export const squash = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The retired token `value` carries, or null.
 *
 * ⚠️ SUBSTRING, DELIBERATELY. `subly-api`, `SUBLY_DB` and `subly.nikatru.com`
 * are all the retired name wearing a suffix, and each one was a real live
 * resource on 2026-09-11. The cost is that a token which is a substring of an
 * innocent word would refuse it; the register's tokens are product names chosen
 * to be distinctive, and a false refusal is loud and immediately fixable, while
 * a missed one is silent and was already shipped once.
 */
export function retiredIn(tokens, value) {
  const v = squash(value);
  return tokens.find((t) => v.includes(squash(t))) ?? null;
}

/**
 * The non-empty retired tokens a parsed channel-register declares.
 *
 * Returns `[]` rather than throwing: each caller decides what an empty list
 * means for it. Every caller treats it as COVERAGE LOST, because a
 * check with no tokens refuses nothing and reads exactly like a clean world.
 */
export function tokensFrom(register) {
  const raw = register?.retiredIdentityTokens?.tokens;
  return (Array.isArray(raw) ? raw : []).filter((t) => typeof t === 'string' && t.trim() !== '');
}
