#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers-deploy.mjs — a push that STARTS the deploy workflow
// must be able to REACH a deploy job. [pipeline 14]O-7
//
// ── 🔴 THE MEASURED FAILURE THIS ENCODES (2026-08-04) ────────────────────────
// `deploy-workers.yml` had two independent path lists that nobody had ever
// compared:
//
//   on.push.paths            services/subscriptiontracker-api/**, services/platform/**,
//                            .github/workflows/deploy-workers.yml
//   dorny/paths-filter       services/subscriptiontracker-api/**, services/platform/**
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
//   3. 🔴 A FILTER THAT CLAIMS A SOURCE TREE ALSO CLAIMS WHAT THAT TREE IMPORTS
//      FROM OUTSIDE ITSELF — and so does `on.push.paths`. Added 2026-09-06 with
//      [ADR 067] decision 2, which put the Worker chassis in
//      `services/_shared/src/` and made every carrier reach it by a bare
//      RELATIVE import that esbuild inlines.
//
//      Limbs 1 and 2 cannot see that class at all. A shared file matching NO
//      trigger path starts no run, so limb 1 has nothing to range over; and a
//      shared file claimed by ONE filter and not the other passes limb 1 (which
//      asks only "at least one") while the second service goes on running the
//      build it had. That is #155 one level down, and it is the objection
//      `services/platform/test/twinned-worker-modules.test.ts` recorded on
//      2026-08-17 as the reason not to have a shared home at all. The objection
//      was correct; this limb is the repair it implied.
//
//      DERIVED, NOT LISTED. For every glob of the shape `X/**`, the tree at `X`
//      is read for JS/TS relative specifiers that RESOLVE OUTSIDE `X`; each
//      resolved file must be claimed by that same filter AND by
//      `on.push.paths`. So `contracts/entitlement/contract.js` is required of
//      the `platform` filter because `src/lib/mor/contract.ts` imports it, and
//      is NOT required of `subscriptiontracker_api`, which imports nothing from contracts/ —
//      the asymmetry the file's own prose argues for, now derived from the
//      imports instead of asserted in a comment.
//
//      ⚠️ TESTS ARE EXCLUDED, AND THAT IS THE DOMAIN, NOT A WAIVER. A `test/`
//      directory is not in the deployed bundle, so an import that escapes from
//      one cannot make production stale — and both Workers' suites legitimately
//      reach `tooling/`, `packages/` and each other. Including them would demand
//      deploy triggers for files a deploy cannot ship, which is how a limb that
//      fires on correct input gets deleted. `node_modules`, `.wrangler`, `dist`,
//      `build` and `coverage` are excluded for the same reason.
//
//      ⚠️ AND A SPECIFIER THAT RESOLVES TO NOTHING IS SKIPPED, NOT GUESSED AT.
//      `tsc --noEmit` and `wrangler deploy --dry-run` both already refuse a
//      broken import in these lanes; inventing a path here would only produce a
//      demand nobody could satisfy.
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
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const WORKFLOW_DIR = resolve(REPO_ROOT, '.github', 'workflows');

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
/** Limb 3's floor: source files actually READ under the trees the filters
 *  claim. A walk that reaches none would judge every filter to import nothing
 *  and print a clean tree it never looked at. 40 is well under the ~60 the two
 *  Workers' `src/` trees carry today, so an ordinary deletion does not fire it
 *  and a broken walk does. */
export const MIN_SCANNED_SOURCES = 40;

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

// ── LIMB 3 · what a claimed tree imports from outside itself ────────────────

/** The directories a deploy never ships, so an import escaping from one cannot
 *  make production stale. Named as a PROPERTY (not a file list) so a Worker
 *  added tomorrow inherits it. */
export const NOT_BUNDLED_DIRS = new Set([
  'test',
  'tests',
  '__tests__',
  'node_modules',
  '.wrangler',
  'dist',
  'build',
  'coverage',
]);

/** The extensions a bundler follows. `.json` is included because both Workers
 *  already import one (`resolveJsonModule`), which is exactly how the app
 *  catalogue became a build input of the platform Worker. */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'];

/** `services/platform/**` claims the TREE `services/platform`. Anything else
 *  claims files, not a tree, and has nothing to walk. */
export function claimedTree(glob) {
  const m = /^([^*?[\]]+)\/\*\*$/.exec(glob);
  return m ? m[1] : null;
}

/**
 * Does `glob` claim the repo-relative path `p`?
 *
 * Three shapes exist in this repository and each is answered exactly:
 * `X/**` (the tree), `X/*.ext` and `X/*` (files directly in X), and a literal
 * path. A glob of any OTHER shape returns `null` — "this reader cannot decide"
 * — and the caller turns that into COVERAGE LOST rather than into a pass. A
 * matcher that silently answers `false` for a shape it does not understand is
 * how a filter that really does claim a path gets reported as not claiming it,
 * and the fix somebody reaches for is deleting the limb.
 */
export function globClaims(glob, p) {
  const tree = claimedTree(glob);
  if (tree !== null) return p === tree || p.startsWith(`${tree}/`);
  const star = /^([^*?[\]]+)\/\*(\.[A-Za-z0-9.]+)?$/.exec(glob);
  if (star) {
    const [, dir, ext] = star;
    if (posix.dirname(p) !== dir) return false;
    return ext === undefined || p.endsWith(ext);
  }
  if (!/[*?[\]]/.test(glob)) return p === glob;
  return null;
}

/** Every source file under `relDir`, repo-relative, skipping what a deploy
 *  never ships. Walks through `listDir` like every other walk in tooling/ci. */
export function bundledFilesUnder(root, relDir) {
  const out = [];
  const walk = (rel) => {
    const abs = join(root, ...rel.split('/'));
    if (!existsSync(abs)) return;
    for (const entry of listDir(abs, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (NOT_BUNDLED_DIRS.has(entry.name)) continue;
        walk(child);
        continue;
      }
      if (SOURCE_EXTENSIONS.some((e) => entry.name.endsWith(e))) out.push(child);
    }
  };
  walk(relDir);
  return out.sort();
}

/** Every static relative specifier in `source`, in the two forms a bundle can
 *  contain: `… from '…'` (import and re-export) and `import('…')`. */
export function relativeSpecifiersOf(source) {
  const out = new Set();
  for (const m of source.matchAll(/\bfrom\s*['"](\.[^'"]*)['"]/g)) out.add(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g)) out.add(m[1]);
  for (const m of source.matchAll(/^\s*import\s*['"](\.[^'"]*)['"]/gm)) out.add(m[1]);
  return [...out];
}

/** The repo-relative file a specifier resolves to, or null when nothing on disk
 *  answers it. `?raw` and other Vite suffixes are stripped first — they are a
 *  loader instruction, not part of the path. */
export function resolveSpecifier(root, fromRelFile, spec) {
  const bare = spec.split('?')[0];
  const rel = posix.normalize(`${posix.dirname(fromRelFile)}/${bare}`);
  if (rel.startsWith('..')) return null; // outside the repository entirely
  const candidates = [rel, ...SOURCE_EXTENSIONS.map((e) => `${rel}${e}`)];
  // A `.js` specifier that TypeScript resolves to a `.ts` file — the shape
  // `src/lib/mor/contract.ts` uses for `contracts/entitlement/contract.js`
  // resolves to the real `.js`, but the inverse happens elsewhere in this repo.
  if (rel.endsWith('.js')) candidates.push(`${rel.slice(0, -3)}.ts`);
  for (const c of candidates) {
    const abs = join(root, ...c.split('/'));
    if (existsSync(abs) && statSync(abs).isFile()) return c;
  }
  return null;
}

/**
 * Limb 3's decision. Returns `{ problems, scanned, external }` — `scanned` and
 * `external` are reported so a walk that reached nothing is visible rather than
 * printed as a clean tree.
 */
export function judgeImports(root, triggerPaths, filters) {
  const problems = [];
  const external = [];
  let scanned = 0;

  const decide = (globs, p, what) => {
    for (const g of globs) {
      const verdict = globClaims(g, p);
      if (verdict === null) {
        problems.push(
          `COVERAGE LOST: ${what} carries the glob \`${g}\`, whose shape this reader cannot decide. It ` +
            'answers `X/**`, `X/*`, `X/*.ext` and a literal path; anything else would be judged by ' +
            'guessing, and a guess that says "not claimed" fails a correct workflow.',
        );
        return true; // treat as claimed; the COVERAGE LOST above is the report
      }
      if (verdict) return true;
    }
    return false;
  };

  for (const [name, globs] of Object.entries(filters)) {
    for (const glob of globs) {
      const tree = claimedTree(glob);
      if (tree === null) continue;
      const files = bundledFilesUnder(root, tree);
      scanned += files.length;
      for (const f of files) {
        const source = readFileSync(join(root, ...f.split('/')), 'utf8');
        for (const spec of relativeSpecifiersOf(source)) {
          const target = resolveSpecifier(root, f, spec);
          if (target === null) continue; // tsc and wrangler already refuse these
          if (target === tree || target.startsWith(`${tree}/`)) continue; // inside
          external.push({ name, from: f, spec, target });
          if (!decide(globs, target, `filter \`${name}\``)) {
            problems.push(
              `filter \`${name}\` claims \`${glob}\`, and \`${f}\` imports \`${spec}\` — which resolves to ` +
                `\`${target}\`, OUTSIDE that tree and claimed by no glob of this filter. A push touching only ` +
                `\`${target}\` changes what this service BUILDS, and this filter answers false, so its deploy ` +
                'job is skipped and the run reports SUCCESS while the live service goes on running the build ' +
                'it had. That is #155 one level down. Add the path to this filter (and to `on.push.paths`).',
            );
          }
          if (!decide(triggerPaths, target, '`on.push.paths`')) {
            problems.push(
              `\`${f}\` imports \`${spec}\` — which resolves to \`${target}\`, and NO path in ` +
                '`on.push.paths` claims it. A push touching only that file starts no run at all, so the ' +
                'filters never get the chance to be right about it.',
            );
          }
        }
      }
    }
  }

  return { problems, scanned, external };
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
    coverageLost();
  }

  const problems = [];
  const checked = [];
  let scannedSources = 0;
  const externalImports = [];

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

    // Limb 3 needs a parsed filter set to have something to walk; limb 1's own
    // COVERAGE LOST above already reports the case where there is none.
    if (filters && Object.keys(filters).length > 0) {
      const imports = judgeImports(REPO_ROOT, triggerPaths, filters);
      for (const p of imports.problems) problems.push(`${selfPath}: ${p}`);
      scannedSources += imports.scanned;
      externalImports.push(...imports.external.map((e) => ({ ...e, workflow: f })));
    }
  }

  if (checked.length < MIN_FILTERED_WORKFLOWS) {
    console.error(
      `✗ COVERAGE LOST: scanned ${files.length} workflow(s) and found ${checked.length} that gate jobs behind a ` +
        `paths-filter with a \`push.paths\` trigger; expected at least ${MIN_FILTERED_WORKFLOWS}.`,
    );
    console.error('  Either the detection stopped matching, or the shape moved. Both are failures — a scan');
    console.error("  over nothing prints ok, which is this repository's single most repeated failure.");
    if (problems.every((p) => p.includes('COVERAGE LOST'))) coverageLost(); // with a finding beside it, the report below prints it and exits 1
  }

  if (scannedSources < MIN_SCANNED_SOURCES) {
    console.error(
      `✗ COVERAGE LOST: limb 3 read ${scannedSources} source file(s) under the trees these filters claim, ` +
        `fewer than the ${MIN_SCANNED_SOURCES} that exist today.`,
    );
    console.error('  It decides "does this filter claim what its tree imports" by reading those files. With');
    console.error('  none read, every filter is judged to import nothing and the limb certifies a clean tree');
    console.error('  it never looked at — the vacuous pass this repository refuses.');
    if (problems.every((p) => p.includes('COVERAGE LOST'))) coverageLost(); // with a finding beside it, the report below prints it and exits 1
  }

  if (problems.length) {
    console.error('✗ A TRIGGER PATH CANNOT REACH THE JOBS IT TRIGGERS\n');
    for (const p of problems) console.error(`  · ${p}\n`);
    console.error('  Measured 2026-08-04: run 30933229005 pushed #155 — whose subject was repairing the');
    console.error('  deploy job — skipped both deploy jobs and reported SUCCESS, leaving the live platform');
    console.error('  Worker on `build: null` with its crash sink dark for six hours.');
    if (problems.every((p) => p.includes('COVERAGE LOST'))) coverageLost(); process.exit(1); // 2 only when nothing but could-not-look stops; a finding keeps 1
  }

  const summary = checked
    .map((c) => `${c.f} (${c.triggerPaths.length} path(s), ${Object.keys(c.filters).length} filter(s))`)
    .join('; ');
  console.log(
    `ok  ${checked.length} filtered workflow(s) of ${files.length} scanned — ${summary}; every trigger reaches a ` +
      'job, and every filter includes its own workflow file.',
  );
  console.log(
    `ok  limb 3 — ${scannedSources} bundled source file(s) read; ${externalImports.length} import(s) leave a ` +
      'claimed tree and every one is claimed by its own filter and by `on.push.paths`:',
  );
  for (const e of externalImports) {
    console.log(`      ${e.workflow} · ${e.name}: ${e.from} → ${e.target}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-deploy-triggers-deploy.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
