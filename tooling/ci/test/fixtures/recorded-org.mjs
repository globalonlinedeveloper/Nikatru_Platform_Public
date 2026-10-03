// ─────────────────────────────────────────────────────────────────────────────
// recorded-org.mjs — THE ONE PLACE A TEST TAKES THE CODE HOST'S ORG FROM.
//
// ⏱ 2026-10-03 · port-codehost. The org is config (tooling/github-org.json),
// and assert-no-dead-repo-names.mjs refuses it as a literal everywhere else —
// tests included (dead-repos.json `codehost.fixtureConstant`). A test that needs
// the org as DATA — a captured GitHub answer, a GITHUB_REPOSITORY a fixture was
// recorded under, a slug a parser must accept — imports RECORDED_ORG.
//
// It is the org the RECORDED fixtures (fixtures/land-rollup/, the 2026-09-11
// freeze, tooling/review/fixtures/) were captured under, so it does NOT follow an
// org move: those captures are history. A test about what the tree does TODAY
// reads tooling/generated/codehost.mjs instead.
// ─────────────────────────────────────────────────────────────────────────────
export const RECORDED_ORG = 'globalonlinedeveloper';
