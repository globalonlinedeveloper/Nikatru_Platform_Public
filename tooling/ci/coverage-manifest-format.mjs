// ─────────────────────────────────────────────────────────────────────────────
// coverage-manifest-format.mjs — the ONE serialisation of
// tooling/ci/test/coverage-manifest.json, the per-test-file ratchet that
// assert-guard-coverage.mjs maintains and ci.yml diffs byte for byte.
//
// NOT A GUARD. A pure function: counts in, text out. No filesystem, no exit.
//
// ── WHY EACH ENTRY IS TWO LINES AND A BLANK (rv2-pipe-a P-2, 2026-09-29) ────
// Keyed by file, two PRs that each raise ONE file's count write two different
// lines — but when those files sort next to each other, the two edited lines
// TOUCH, and git's three-way merge (GitHub's update-branch included) calls
// touching edits a conflict. #1050 did exactly that: it raised
// post-deploy-smoke.test.mjs while main had raised policy-claims.test.mjs, the
// line above it. So each entry is its key on one line and its count on the
// next, with a blank line between entries: a count edit never touches another
// entry's lines, and a new entry inserted into a gap is fenced from the counts
// on both sides by an unchanged key line or blank. Measured on a scratch
// repository, both orders: neighbouring raises, a new entry beside a raised
// one (either side), two new entries in adjacent gaps and a new entry beside
// raises on both sides all merge cleanly; one blank line alone still
// conflicted on a new entry landing just above a raised one. Two PRs raising
// the SAME file still conflict, and must: the merged count is a re-measure,
// which the ratchet does. So does appending after the LAST entry beside a
// raise of it (its line gains the comma). tooling/ci/test/generated-merge.test.mjs
// merges real branches over it. JSON allows the whitespace, so every reader's
// JSON.parse is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/** `{ "<test file>": <count> }` → the manifest's bytes: keys sorted; each
 *  entry its key line then its count line; a blank line between entries; a
 *  trailing newline. */
export function serialiseManifest(counts) {
  const keys = Object.keys(counts).sort();
  if (!keys.length) return '{}\n';
  return `{\n${keys.map((k) => `  ${JSON.stringify(k)}:\n    ${JSON.stringify(counts[k])}`).join(',\n\n')}\n}\n`;
}
