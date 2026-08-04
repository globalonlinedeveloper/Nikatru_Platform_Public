#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers-deploy.mjs — a push that STARTS the deploy workflow
// must be able to REACH a deploy job. [pipeline 14]O-7
//
// ── 🔴 THE MEASURED FAILURE THIS ENCODES (2026-08-04) ────────────────────────
// `deploy-workers.yml` had two independent path lists that nobody had ever
// compared:
//
//   on.push.paths            services/subly-api/**, services/platform/**,
//                            .github/workflows/deploy-workers.yml
//   dorny/paths-filter       services/subly-api/**, services/platform/**
//
// So a change to the WORKFLOW ITSELF triggered a run whose `detect` job set both
// outputs to `false`, skipped both deploy jobs, and reported **success**.
//
// That is exactly what happened to #155, whose entire subject was repairing this
// same deploy job: a second, unqualified `wrangler deploy` had been wiping
// `--var GLITCHTIP_DSN` and `--var RELEASE` off the live `platform` Worker. The
// repair merged. `ci-gate` went green. The tracker recorded "Fixed in #155".
// And `platform.nikatru.com/v1/health` went on answering `"build": null` — with
// the crash sink of the Worker every app depends on for config, analytics,
// consent, entitlements and the money webhook still dark — for SIX HOURS, until
// a human dispatched the workflow by hand and watched the SHA appear.
//
// 📌 THE SHAPE, WHICH IS THE POINT: nothing was red. A deploy workflow that
// deploys nothing and a deploy workflow that deploys correctly are the same
// green tick. This repository already has `assert-green-means-ran.mjs` for the
// case where a JOB skips its real work behind a secret preflight; this is the
// same disease one level up, where the WORKFLOW skips every job behind a path
// filter that does not match its own trigger.
//
// ── WHAT IT ASSERTS ─────────────────────────────────────────────────────────
//   1. Every path in `on.push.paths` is claimed by at least one filter. A
//      trigger with no filter is a run that can only ever do nothing.
//   2. The workflow's OWN file is claimed by EVERY filter. Shared deploy
//      machinery affects every service it deploys, so proving a change to it
//      means redeploying all of them — half a proof is what produced the six
//      hours above.
//
// ── HOW IT READS THE FILE ───────────────────────────────────────────────────
// By indentation-scoped structure, never by grepping for a string. A `grep` for
// `deploy-workers.yml` would have matched the `on.push.paths` entry, the header
// comment on line 3, and now this guard's own name in a comment — and reported
// the filter fixed while it was still wrong. That is not hypothetical either:
// this repo has a recorded case of `grep '"r2_buckets"'` matching the template
// comment explaining why there is no `r2_buckets`.
//
// ── REQUIRED_COVERAGE ───────────────────────────────────────────────────────
// A parser aimed at two specific blocks stops finding them the moment either is
// reformatted, and would then pass over an empty set — the single most common
// way a guard in this repo has died. So the counts it must find are asserted
// explicitly, and falling below them is a FAILURE, never a quiet pass.
//
// Exit 0 = every trigger can reach a deploy.  Exit 1 = it cannot, or could not
// be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WORKFLOW_DIR = resolve(HERE, '..', '..', '.github', 'workflows');

// ── NOT LANE-BOUND, DELIBERATELY ────────────────────────────────────────────
// This guard was first written against `deploy-workers.yml` by name, and
// `assert-release-lane-generic.mjs` limb B rejected it on the first CI run —
// correctly. A guard that names one workflow answers a question about that
// workflow and reports ok for every other one, which is exactly how
// assert-seams-wired.mjs printed ok while build-platforms.yml shipped two
// artifact lanes with no crash sink.
//
// The property here is not about deploys at all: ANY workflow that starts on a
// path list and then gates its jobs behind an inner filter can be triggered by
// a path the filter does not claim, in which case every job skips and the run
// reports SUCCESS. So the subject set is DISCOVERED — every workflow that uses
// a paths-filter — rather than named. Adding one tomorrow gets covered with no
// edit here, and the alternative (a `LANE-BOUND:` declaration) would have been
// a standing waiver for the one shape this guard exists to find.

/** REQUIRED_COVERAGE. These detect A PARSE THAT READ NOTHING — they are not a
 *  claim about how many paths or filters a workflow ought to have.
 *
 *  ⚠️ BOTH WERE 2 WHEN THIS GUARD WAS DEPLOY-WORKERS-SPECIFIC, and generalising
 *  it exposed that as an INVENTED LIMIT: a workflow deploying one service has
 *  exactly one filter, and the guard would have failed it for being correct.
 *  That is the same class as enforcing Google's RECOMMENDED screenshot size as
 *  a requirement — a floor that fires on a good input teaches people to delete
 *  the check. The honest floor is "did the parser find the block at all". */
export const MIN_TRIGGER_PATHS = 1;
export const MIN_FILTERS = 1;
/** At least one workflow in the tree must gate jobs behind a paths-filter. If
 *  none does, this guard has nothing to check — and a scan over nothing that
 *  prints ok is this repository's single most repeated failure. */
export const MIN_FILTERED_WORKFLOWS = 1;

/** Every workflow file in the tree, as bare filenames. */
export function workflowFiles() {
  if (!existsSync(WORKFLOW_DIR)) return [];
  return listDir(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
}

/** Does this workflow gate jobs behind a path filter? Detected by the action
 *  it uses, not by a filename, so the subject set follows the tree. */
export function usesPathsFilter(text) {
  return /uses:\s*dorny\/paths-filter@/.test(text) && /^\s+filters:\s*\|\s*$/m.test(text);
}

const indentOf = (line) => line.length - line.trimStart().length;
const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '');

/**
 * Collect `- item` entries that sit strictly deeper than `parentIndent`,
 * starting at `from`. Stops at the first line that dedents to or past the
 * parent — which is what makes this structural rather than a scan.
 */
function collectList(lines, from, parentIndent) {
  const out = [];
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (indentOf(line) <= parentIndent) break;
    const m = line.trim().match(/^-\s+(.*)$/);
    if (m) out.push(unquote(m[1]));
    else break;
  }
  return out;
}

/** `on.push.paths`, reached by walking the nesting rather than matching text. */
export function parseTriggerPaths(text) {
  const lines = text.split(/\r?\n/);
  let onIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^on:\s*$/.test(lines[i])) { onIdx = i; break; }
  }
  if (onIdx === -1) return null;

  let pushIdx = -1;
  let pushIndent = -1;
  for (let i = onIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (indentOf(line) === 0) break; // left the `on:` block
    if (/^\s+push:\s*$/.test(line)) { pushIdx = i; pushIndent = indentOf(line); break; }
  }
  if (pushIdx === -1) return null;

  for (let i = pushIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (indentOf(line) <= pushIndent) break; // left `push:`
    if (/^\s+paths:\s*$/.test(line)) return collectList(lines, i + 1, indentOf(line));
  }
  return null;
}

/**
 * The `filters:` block-scalar handed to dorny/paths-filter, as
 * `{ name: [path, ...] }`. Read from the literal block, so a filter added in a
 * different step or a different workflow is deliberately NOT counted.
 */
export function parseFilters(text) {
  const lines = text.split(/\r?\n/);
  let idx = -1;
  let keyIndent = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s+filters:\s*\|\s*$/.test(lines[i])) { idx = i; keyIndent = indentOf(lines[i]); break; }
  }
  if (idx === -1) return null;

  const out = {};
  let current = null;
  for (let i = idx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (indentOf(line) <= keyIndent) break; // block scalar ended
    const trimmed = line.trim();
    const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (keyMatch) { current = keyMatch[1]; out[current] = []; continue; }
    const itemMatch = trimmed.match(/^-\s+(.*)$/);
    if (itemMatch && current) out[current].push(unquote(itemMatch[1]));
  }
  return out;
}

/** The decision, pure so every branch is reachable without touching disk.
 *  `selfPath` is the subject workflow's own repo-relative path — supplied by
 *  the caller rather than baked in, which is what keeps this generic. */
export function judge(triggerPaths, filters, selfPath) {
  const problems = [];

  if (!Array.isArray(triggerPaths) || triggerPaths.length < MIN_TRIGGER_PATHS) {
    problems.push(
      `COVERAGE LOST: expected at least ${MIN_TRIGGER_PATHS} entries under \`on.push.paths\`, parsed ` +
        `${Array.isArray(triggerPaths) ? triggerPaths.length : 'none'}. The parser is no longer reading the ` +
        `block it targets, so it would compare an empty set against an empty set and report clean.`,
    );
  }
  if (!filters || Object.keys(filters).length < MIN_FILTERS) {
    problems.push(
      `COVERAGE LOST: expected at least ${MIN_FILTERS} named filters, parsed ` +
        `${filters ? Object.keys(filters).length : 'none'}. Same failure as above, from the other side.`,
    );
  }
  if (problems.length) return problems;

  const names = Object.keys(filters);
  const claimed = new Set(names.flatMap((n) => filters[n]));

  for (const p of triggerPaths) {
    if (!claimed.has(p)) {
      problems.push(
        `\`${p}\` triggers the workflow but appears in NO filter. A push touching only this path starts a ` +
          `run in which every deploy job is skipped and the run reports SUCCESS — a deploy that deployed ` +
          `nothing, indistinguishable from one that worked.`,
      );
    }
  }

  for (const n of names) {
    if (!filters[n].includes(selfPath)) {
      problems.push(
        `filter \`${n}\` does not include \`${selfPath}\`. A change to the shared deploy machinery must be ` +
          `proven by redeploying EVERY service it deploys; leaving one out is how a repair to this workflow ` +
          `merges green while that service keeps running the build the broken path left behind.`,
      );
    }
  }

  return problems;
}

function main() {
  const files = workflowFiles();
  if (files.length === 0) {
    console.error(`✗ COVERAGE LOST: no workflow files under ${WORKFLOW_DIR}.`);
    console.error('  This guard cannot verify what it cannot read, and that is a failure, not a skip.');
    process.exit(1);
  }

  const problems = [];
  const checked = [];

  for (const f of files) {
    const text = readFileSync(resolve(WORKFLOW_DIR, f), 'utf8');
    if (!usesPathsFilter(text)) continue;

    const selfPath = `.github/workflows/${f}`;
    const triggerPaths = parseTriggerPaths(text);
    const filters = parseFilters(text);
    // A workflow may gate jobs behind a filter without a `push.paths` trigger
    // at all (workflow_dispatch only). That is coherent, not a defect — there
    // is no trigger path that could fail to reach a job.
    if (triggerPaths === null) continue;

    checked.push({ f, triggerPaths, filters });
    for (const p of judge(triggerPaths, filters, selfPath)) problems.push(`${selfPath}: ${p}`);
  }

  if (checked.length < MIN_FILTERED_WORKFLOWS) {
    console.error(
      `✗ COVERAGE LOST: scanned ${files.length} workflow(s) and found ${checked.length} that gate jobs behind a ` +
        `paths-filter with a \`push.paths\` trigger; expected at least ${MIN_FILTERED_WORKFLOWS}.`,
    );
    console.error('  Either the detection stopped matching, or the shape moved. Both are failures — a scan');
    console.error("  over nothing prints ok, which is this repository's single most repeated failure.");
    process.exit(1);
  }

  if (problems.length) {
    console.error('✗ A TRIGGER PATH CANNOT REACH THE JOBS IT TRIGGERS\n');
    for (const p of problems) console.error(`  · ${p}\n`);
    console.error('  Measured 2026-08-04: run 30933229005 pushed #155 — whose subject was repairing the');
    console.error('  deploy job — skipped both deploy jobs and reported SUCCESS, leaving the live platform');
    console.error('  Worker on `build: null` with its crash sink dark for six hours.');
    process.exit(1);
  }

  const summary = checked
    .map((c) => `${c.f} (${c.triggerPaths.length} path(s), ${Object.keys(c.filters).length} filter(s))`)
    .join('; ');
  console.log(
    `ok  ${checked.length} filtered workflow(s) of ${files.length} scanned — ${summary}; every trigger reaches a ` +
      'job, and every filter includes its own workflow file.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
