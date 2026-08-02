// ─────────────────────────────────────────────────────────────────────────────
// gates.mjs — [pipeline 7]P-13: publish is a GATE, not a copy.
//
// The original acceptance criterion tested ONE member of a five-gate union
// ("publish refuses when the review log is missing"), so four of the five gates
// could be deleted with the criterion still passing. Here the required-artifact
// list is DERIVED from the gate registry below, and every gate carries its own
// recorded failing case.
//
// ⛔ THE PUBLISH TARGET DOES NOT EXIST AND THIS FILE DOES NOT CREATE ONE.
// `[4]B-18` owns the shelf: one shared R2 bucket with an `<app_id>/` prefix per
// [ADR 020], the `packs.nikatru.com` custom-domain binding, the cache policy and
// `latest.json` hosting. services/platform/wrangler.jsonc still reads "NO
// r2_buckets YET". Stage 7 owns the GATE, and a gate is about refusing — refusing
// needs no destination, which is why this half is buildable and negative-testable
// with no bucket at all.
//
// 🔴 CONTENT-HASH BINDING ON ALL FIVE, not just the review log. An artifact
// naming a DIFFERENT pack is the same defect as a missing one, and it is the one
// that actually happens: re-run the pipeline, get a new content hash, and four
// stale reports still sit in the gates directory looking complete.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** THE REGISTRY. `requirement` is the REQUIRED_COVERAGE key — assert-publish-
 *  gate.mjs asserts this set still names P-3, P-4, P-5, P-7 and P-9, so deleting
 *  a gate is COVERAGE LOST rather than a shorter list that still passes. */
export const DECLARED_GATES = Object.freeze([
  Object.freeze({
    id: 'qa',
    requirement: 'P-3',
    artifact: 'qa-report.json',
    guard: null,
    what: 'the machine QA report — per-modality checks over every produced item',
  }),
  Object.freeze({
    id: 'review',
    requirement: 'P-4',
    artifact: 'review.jsonl',
    guard: 'tooling/ci/assert-review-gate.mjs',
    what: 'the human verdict log over the DERIVED sample — the copyright moat and the AI-Act evidence trail',
  }),
  Object.freeze({
    id: 'licence',
    requirement: 'P-5',
    artifact: 'licence-clearance.json',
    guard: 'tooling/ci/assert-content-licences.mjs',
    what: 'every licence family this pack consumes, cleared against tooling/legal/content-licence-register.json',
  }),
  Object.freeze({
    id: 'inertness',
    requirement: 'P-7',
    artifact: 'inertness-report.json',
    guard: 'tooling/ci/assert-pack-inert.mjs',
    what: 'the member enumeration + magic-byte verdict for every file in the pack',
  }),
  Object.freeze({
    id: 'roundtrip',
    requirement: 'P-9',
    artifact: 'roundtrip-result.json',
    guard: 'tooling/ci/assert-pack-roundtrip.mjs',
    what: 'the produced pack, loaded by the REAL client loader against a test keypair',
  }),
]);

export const REQUIRED_ARTIFACTS = Object.freeze(DECLARED_GATES.map((g) => g.artifact));

/**
 * The publish precondition. Returns `{ ok, problems }` and NEVER uploads.
 *
 * @param {string} gatesDir directory holding the gate artifacts
 * @param {string} contentHash the pack's content hash — every artifact must name it
 */
export function publishPreconditionProblems(gatesDir, contentHash) {
  const problems = [];
  for (const gate of DECLARED_GATES) {
    const path = join(gatesDir, gate.artifact);
    if (!existsSync(path)) {
      problems.push(`[${gate.requirement}] ${gate.artifact} is absent — ${gate.what}`);
      continue;
    }
    const raw = readFileSync(path, 'utf8');
    // review.jsonl is JSON Lines; the other four are JSON documents. Both must
    // BIND to the pack, and the binding is parsed rather than grepped: a
    // content hash sitting in a comment or a filename is not a claim.
    let bound = [];
    try {
      bound = gate.artifact.endsWith('.jsonl')
        ? raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).content_hash)
        : [JSON.parse(raw).content_hash];
    } catch (e) {
      problems.push(`[${gate.requirement}] ${gate.artifact} is not parseable (${e.message})`);
      continue;
    }
    if (bound.length === 0) {
      problems.push(`[${gate.requirement}] ${gate.artifact} carries no rows at all, so it binds to nothing`);
      continue;
    }
    const wrong = [...new Set(bound.filter((h) => h !== contentHash))];
    if (wrong.length) {
      problems.push(
        `[${gate.requirement}] ${gate.artifact} names content_hash ${wrong.map((w) => JSON.stringify(w)).join(', ')}, ` +
          `not ${contentHash} — it describes a DIFFERENT pack. This is what a re-run leaves behind.`,
      );
    }
  }
  return problems;
}

/** Parse review.jsonl into rows, or throw. */
export function readReviewLog(path) {
  const rows = [];
  const raw = readFileSync(path, 'utf8');
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`${path}:${i + 1} is not valid JSON (${e.message})`);
    }
  });
  return rows;
}
