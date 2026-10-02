#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-deploy-triggers-deploy.mjs — a change that alters what a deploy SHIPS
// must be a change its deploy unit CLAIMS. [pipeline 14]O-7
//
// ── WHERE THE QUESTION MOVED [ADR 095 §4] ───────────────────────────────────
// Until ADR 095 §4 a deploy STARTED on its workflow's `on.push.paths` and then
// REACHED a job through a dorny filter, and this guard compared those two lists.
// The deploy workflows are now called from ci.yml after ci-gate, on every push to
// main, and each deploy job's first step, `plan-deploy.mjs <environment>`, decides
// from `deployUnits` in tooling/ci/lane-map.json whether that unit publishes. So
// the unit is the one list left to be wrong, and the subject here is the unit:
// every workflow that runs the plan names its unit, and each unit is judged.
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
//   1. Every environment a workflow plans (`plan-deploy.mjs <environment>`)
//      resolves to a unit, the way plan-deploy.mjs resolves it; and every unit is
//      planned by some workflow. An environment with no unit refuses at run time,
//      so it never publishes; a unit nothing plans is a claim nothing acts on.
//   2. The workflow's OWN file is claimed by EVERY unit it plans. Shared deploy
//      machinery affects every service it deploys, so proving a change to it
//      means redeploying all of them — half a proof is what produced the six
//      hours above.
//   3. 🔴 A UNIT THAT CLAIMS A SOURCE TREE ALSO CLAIMS WHAT THAT TREE IMPORTS
//      FROM OUTSIDE ITSELF. Added 2026-09-06 with
//      [ADR 067] decision 2, which put the Worker chassis in
//      `services/_shared/src/` and made every carrier reach it by a bare
//      RELATIVE import that esbuild inlines.
//
//      Limbs 1 and 2 cannot see that class at all. A shared file claimed by ONE
//      unit and not the other is matched by one plan and not the other, and the
//      second service goes on running the
//      build it had. That is #155 one level down, and it is the objection
//      `services/platform/test/twinned-worker-modules.test.ts` recorded on
//      2026-08-17 as the reason not to have a shared home at all. The objection
//      was correct; this limb is the repair it implied.
//
//      DERIVED, NOT LISTED. For every glob of the shape `X/**`, the tree at `X`
//      is read for JS/TS relative specifiers that RESOLVE OUTSIDE `X`; each
//      resolved file must be claimed by that same unit. So
//      `contracts/entitlement/contract.js` is required of
//      the `platform` unit because `src/lib/mor/contract.ts` imports it, and
//      is NOT required of `subscriptiontracker-api`, which imports nothing from contracts/ —
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
//   The transitional equality limb (a deploy's own `on.push.paths` and dorny
//   filters equal its units) went with the triggers it compared, when ci.yml
//   began calling the deploys after ci-gate. `parseTriggerPaths` and
//   `usesPathsFilter` stay exported: tooling/ci/test/deploy-units.test.mjs
//   fails a deploy workflow that grows either trigger back.
//
//   4. 🔴 EVERY APP WORKER DEPLOYS FROM ONE MATRIX, IN THE SAFETY ORDER, and every
//      leg is graded. Added 2026-09-26 with O-SERVICE-KIT-UNBUILT (E-a2), when
//      deploy-workers.yml's one hand-written app job became the `app-worker`
//      matrix. The legs are READ, never listed here: tooling/ci/worker-set.mjs
//      appWorkerMatrix() is what the matrix carries on this tree (the
//      `appWorkers` rows of tooling/platform-register.json with a services/
//      directory), and:
//        · limb 1 expands a plan argument `${{ matrix.<dim>.worker }}` into
//          each leg's Worker name, so every leg needs its own unit, and (1b)
//          that unit claims the Worker's own tree — a leg whose unit did not
//          would plan nothing on a change to it and publish nothing;
//        · the job's `strategy.matrix.<dim>` is `${{ fromJSON(needs.<job>.outputs.<name>) }}`
//          of a job that runs `worker-set.mjs --for-deploy --json --app-workers`:
//          a literal list is a finding;
//        · for EVERY leg, the order a Worker must be deployed in: npm ci → its
//          D1 migrations (required when its config migrates one) → the live-SQL
//          check → the deploy that carries the vars, which is the leg's ONE
//          deploy (#155: a second, unqualified one wiped the vars; a Worker that
//          does not exist yet is created by this one, #981) → the smoke → the
//          record, conditioned `always() && steps.deploy.outcome == 'success'`.
//      No app Worker at all is COVERAGE LOST: limb 4 would grade nothing.
//      (The literal paths in THE MEASURED FAILURE above are the file as it
//      stood on 2026-08-04: history, not today's shape.)
//
//   5. 🔴 NOTHING THAT READS PLATFORM_DB GOES LIVE BEFORE ITS MIGRATIONS. Added
//      2026-10-01 with row O-APP-WORKERS-DEPLOY-BEFORE-THE-MIGRATION (PB-03): every
//      app Worker deployed and went live BEFORE deploy-workers.yml's platform job
//      applied the platform_db migrations they read, and the apex site's Function
//      binds platform_db unordered. DERIVED, NOT LISTED: every wrangler config under
//      services/*/ and tooling/sites/*/ that binds `PLATFORM_DB` is read, and every
//      job in any workflow that deploys one to PRODUCTION (a wrangler deploy in its
//      directory — or a matrix leg whose `dir` it is — or a `pages deploy` of the
//      project the tooling/sites/<project> directory names; never `--env`, never a
//      dry run) must TRANSITIVELY NEED the one job that runs
//      `d1 migrations apply PLATFORM_DB --remote`: through `needs:` inside its own
//      workflow, and through the `needs:` of every job that calls that workflow,
//      to that job or to a job calling the workflow it is in. No applier, two
//      appliers, or a binding config no job deploys is a finding; no binding config
//      at all is COVERAGE LOST.
//
// ── HOW IT READS THE FILE ───────────────────────────────────────────────────
// By indentation-scoped structure, never by grepping for a string. A `grep` for
// `deploy-workers.yml` would have matched the `on.push.paths` entry, the header
// comment on line 3, and now this guard's own name in a comment — and reported
// the filter fixed while it was still wrong. That is not hypothetical either:
// this repo has a recorded case of `grep '"r2_buckets"'` matching the template
// comment explaining why there is no `r2_buckets`. The plan invocations are
// read with comments stripped, for the same reason.
//
// ── REQUIRED_COVERAGE ───────────────────────────────────────────────────────
// A reader aimed at one JSON key and one command line stops finding them the
// moment either is renamed, and would then pass over an empty set — the single
// most common way a guard in this repo has died. So the counts it must find are
// asserted explicitly, and falling below them is COVERAGE LOST, never a quiet pass.
//
// Exit 0 = every unit claims what its deploy ships.  Exit 1 = a finding.
// Exit 2 = COVERAGE LOST: the units, or the workflows that plan them, could not
// be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { claimedTree, globClaims } from './deploy-globs.mjs';
import { parseAllWorkflows, workflowSteps } from './workflow-scan.mjs';
import { appWorkerMatrix } from './worker-set.mjs';
import { stripSourceComments } from './text-reductions.mjs';

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
// So the subject set is DISCOVERED — every unit in `deployUnits`, and every
// workflow that runs `plan-deploy.mjs` — rather than named. A unit or a deploy
// workflow added tomorrow gets covered with no edit here, and the alternative (a
// `LANE-BOUND:` declaration) would have been a standing waiver for the one shape
// this guard exists to find.

/** Where the deploy units live [ADR 095 §4]: the same file and key plan-deploy.mjs
 *  reads (its UNITS_REL), so the guard judges the list the plan acts on. */
export const UNITS_REL = 'tooling/ci/lane-map.json';

/** REQUIRED_COVERAGE. These detect A READ THAT FOUND NOTHING — they are not a
 *  claim about how many units a repository ought to have.
 *
 *  ⚠️ THE OLD FLOORS WERE 2 WHEN THIS GUARD WAS DEPLOY-WORKERS-SPECIFIC, and
 *  generalising it exposed that as an INVENTED LIMIT: a workflow deploying one
 *  service has exactly one unit, and the guard would have failed it for being
 *  correct. A floor that fires on a good input teaches people to delete the
 *  check. The honest floor is "did the reader find the thing at all". */
export const MIN_UNITS = 1;
/** At least one workflow in the tree must run the plan. If none does, limbs 1
 *  and 2 have nothing to check — and a scan over nothing that prints ok is this
 *  repository's single most repeated failure. */
export const MIN_PLANNING_WORKFLOWS = 1;
/** Limb 3's floor: source files actually READ under the trees the units
 *  claim. A walk that reaches none would judge every unit to import nothing
 *  and print a clean tree it never looked at. 40 is well under the ~80 the two
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

// ── LIMBS 1-2 · which workflow plans which unit ─────────────────────────────

/** `deployUnits` under `root`, or null when the file or the key is absent or is
 *  not an object of glob lists — the caller turns null into COVERAGE LOST. */
export function readUnits(root) {
  const abs = join(root, ...UNITS_REL.split('/'));
  if (!existsSync(abs)) return null;
  let units;
  try {
    units = JSON.parse(readFileSync(abs, 'utf8')).deployUnits;
  } catch {
    return null;
  }
  if (!units || typeof units !== 'object' || Array.isArray(units)) return null;
  const ok = Object.values(units).every((g) => Array.isArray(g) && g.every((x) => typeof x === 'string'));
  return ok ? units : null;
}

/** Every environment this workflow hands to `plan-deploy.mjs`, as written, with
 *  YAML comments stripped first: a plan named in a comment runs nothing. */
export function plannedEnvironments(text) {
  const code = text
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
  // One argument: plain characters and whole `${{ … }}` expressions, which carry spaces.
  return [...code.matchAll(/tooling\/ci\/plan-deploy\.mjs[ \t]+((?:\$\{\{[^}]*\}\}|[^\s'"])+)/g)].map((m) => m[1]);
}

/** The unit key an environment argument resolves to, the way plan-deploy.mjs's
 *  unitFor() resolves it — an exact key, else an `<app>` template key — after an
 *  expression such as `${{ matrix.app }}` is read as the `<app>` it stands for.
 *  Null when no unit answers, which plan-deploy.mjs refuses at run time. */
export function unitKeyFor(units, environment) {
  const env = environment.replace(/\$\{\{[^}]*\}\}/g, '<app>');
  if (Object.hasOwn(units, env)) return env;
  for (const key of Object.keys(units)) {
    if (!key.startsWith('<app>')) continue;
    const tail = key.slice('<app>'.length);
    if (!env.endsWith(tail)) continue;
    const app = env.slice(0, env.length - tail.length);
    if (app === '<app>' || /^[a-z0-9][a-z0-9-]*$/.test(app)) return key;
  }
  return null;
}

/**
 * Limbs 1 and 2, pure. `plans` is `[{ workflow, environments }]` for every workflow
 * that runs the plan. Returns `{ problems, owners }`, where `owners` maps each
 * unit key to the workflow files that plan it.
 */
export function judgeUnits(units, plans) {
  const problems = [];
  const owners = new Map(Object.keys(units).map((k) => [k, []]));
  for (const { workflow, environments } of plans) {
    const self = `.github/workflows/${workflow}`;
    for (const env of environments) {
      const key = unitKeyFor(units, env);
      if (key === null) {
        problems.push(
          `${self} runs \`plan-deploy.mjs ${env}\`, and ${UNITS_REL} deployUnits names no unit for it. The plan ` +
            'refuses at run time, so that deploy never publishes, and nothing before the merge says so.',
        );
        continue;
      }
      if (!owners.get(key).includes(workflow)) owners.get(key).push(workflow);
      let claimed = false;
      for (const g of units[key]) {
        const c = globClaims(g, self);
        if (c === null) {
          problems.push(
            `COVERAGE LOST: deployUnits["${key}"] carries the glob \`${g}\`, whose shape this reader cannot decide ` +
              '(nor can plan-deploy.mjs, which refuses it).',
          );
          claimed = true;
          break;
        }
        if (c) claimed = true;
      }
      if (!claimed) {
        problems.push(
          `deployUnits["${key}"] does not claim \`${self}\`, the workflow that deploys it. A change to the shared ` +
            'deploy machinery must be proven by redeploying EVERY unit it deploys; leaving one out is how a repair ' +
            'to this workflow merges green while that service keeps running the build the broken path left behind.',
        );
      }
    }
  }
  for (const [key, by] of owners) {
    if (by.length === 0) {
      problems.push(
        `deployUnits["${key}"] is planned by no workflow: no step runs \`plan-deploy.mjs\` for it, so its globs are ` +
          'a claim nothing acts on.',
      );
    }
  }
  return { problems, owners };
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

// `claimedTree` and `globClaims` live in ./deploy-globs.mjs since 2026-09-26: plan-deploy.mjs
// imports them there, so a deploy's inputs do not include this guard. Re-exported, so
// every importer of this path reads the same two functions.
export { claimedTree, globClaims };

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
 * Limb 3's decision over `units` (`{ key: [glob, ...] }`). Returns
 * `{ problems, scanned, external }` — `scanned` and `external` are reported so a
 * walk that reached nothing is visible rather than printed as a clean tree.
 */
export function judgeImports(root, units) {
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
            'guessing, and a guess that says "not claimed" fails a correct unit.',
        );
        return true; // treat as claimed; the COVERAGE LOST above is the report
      }
      if (verdict) return true;
    }
    return false;
  };

  for (const [name, globs] of Object.entries(units)) {
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
          if (!decide(globs, target, `unit \`${name}\``)) {
            problems.push(
              `unit \`${name}\` claims \`${glob}\`, and \`${f}\` imports \`${spec}\` — which resolves to ` +
                `\`${target}\`, OUTSIDE that tree and claimed by no glob of this unit. A push touching only ` +
                `\`${target}\` changes what this service BUILDS, and the plan matches no glob of this unit, so ` +
                'the deploy publishes nothing and the run reports SUCCESS while the live service goes on running ' +
                `the build it had. That is #155 one level down. Add the path to deployUnits["${name}"] in ${UNITS_REL}.`,
            );
          }
        }
      }
    }
  }

  return { problems, scanned, external };
}

// ── LIMB 4 · the app Worker matrix, graded leg by leg ───────────────────────

/** A plan argument naming a leg of the app Worker matrix: `${{ matrix.<dim>.worker }}`. */
export const WORKER_LEG = /^\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\.worker\s*\}\}$/;

/** Limb 1's input with every Worker-leg argument expanded into the legs' Worker
 *  names. `legs` null (the matrix could not be read) leaves the argument as
 *  written, so limb 1 names it rather than dropping it. */
export function expandPlans(plans, legs) {
  return plans.map((p) => ({
    ...p,
    environments: p.environments.flatMap((e) => (WORKER_LEG.test(e) && legs !== null ? legs : [e])),
  }));
}

/** Limb 1b: each leg's unit claims the Worker's own tree (`<dir>/**`). */
export function judgeLegUnits(units, entries) {
  const problems = [];
  for (const e of entries) {
    const key = unitKeyFor(units, e.worker);
    if (key === null) continue; // limb 1 names it
    if (!units[key].some((g) => claimedTree(g) === e.dir)) {
      problems.push(
        `deployUnits["${key}"] is the unit of the app Worker ${e.worker}, and no glob of it claims \`${e.dir}/**\`, the ` +
          "Worker's own tree. A push changing only that Worker would match nothing in its unit, so its leg would plan " +
          `"unchanged" and publish nothing while the run reports success — #155 in the matrix. Add \`${e.dir}/**\` to it.`,
      );
    }
  }
  return problems;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isWranglerAction = (s) => /^cloudflare\/wrangler-action@/.test(s.uses ?? '');
/** Does this step put a Worker live? A wrangler-action whose command is (or
 *  defaults to) `deploy`, or a `wrangler deploy` that is not a dry run. */
const deploysAWorker = (s) =>
  (isWranglerAction(s) && /^deploy\b/.test(norm(s.with.get('command')?.value ?? 'deploy')) && !/--dry-run/.test(s.with.get('command')?.value ?? '')) ||
  /\bwrangler\s+deploy\b(?![^;&|]*--dry-run)/.test(s.run?.text ?? '');

/**
 * Limb 4, pure over parsed workflows (workflow-scan.mjs `parseAllWorkflows`) and
 * the legs (`appWorkerMatrix(root).entries`). Returns `{ problems, jobs }`, where
 * `jobs` names each matrix deploy job found, `<workflow>:<job>`.
 */
export function judgeWorkerMatrix(workflows, entries) {
  const problems = [];
  const jobs = [];
  for (const wf of workflows) {
    for (const [id, job] of wf.jobs) {
      const steps = workflowSteps(job);
      const plan = steps.findIndex((s) => /plan-deploy\.mjs\s+\$\{\{\s*matrix\.[A-Za-z_][A-Za-z0-9_-]*\.worker\s*\}\}/.test(s.run?.text ?? ''));
      if (plan === -1) continue;
      const dim = steps[plan].run.text.match(/plan-deploy\.mjs\s+\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\.worker/)[1];
      const where = `${wf.rel}:${id}`;
      jobs.push(where);
      const leg = (f) => `\\$\\{\\{\\s*matrix\\.${dim}\\.${f}\\s*\\}\\}`;

      // The matrix is read from worker-set.mjs, never written here.
      const src = job.lines
        .map((l) => l.text.match(new RegExp(`^\\s+${dim}:\\s*\\$\\{\\{\\s*fromJSON\\(\\s*needs\\.([A-Za-z_][A-Za-z0-9_-]*)\\.outputs\\.([A-Za-z_][A-Za-z0-9_-]*)\\s*\\)\\s*\\}\\}\\s*$`)))
        .find(Boolean);
      if (!src) {
        problems.push(
          `${where} deploys the app Worker matrix and its \`strategy.matrix.${dim}\` is not ` +
            '`${{ fromJSON(needs.<job>.outputs.<name>) }}` of a job that runs worker-set.mjs. A matrix written into the ' +
            'workflow is a second list of Workers, and the one a new Worker is missing from.',
        );
      } else {
        const feeder = wf.jobs.get(src[1]);
        const feeds = feeder
          ? workflowSteps(feeder).some(
              (s) => /tooling\/ci\/worker-set\.mjs\s+--for-deploy\s+--json\s+--app-workers\b/.test(s.run?.text ?? '') && (s.run?.text ?? '').includes(`${src[2]}=`),
            ) && feeder.lines.some((l) => new RegExp(`^\\s+${src[2]}:\\s*\\$\\{\\{`).test(l.text))
          : false;
        if (!feeds) {
          problems.push(
            `${where} reads its matrix from \`needs.${src[1]}.outputs.${src[2]}\`, and job \`${src[1]}\` does not write that ` +
              'output from `node tooling/ci/worker-set.mjs --for-deploy --json --app-workers`. The legs must be the ones ' +
              'worker-set.mjs holds to the register, the lockfile rule and `dsnSecret`.',
          );
        }
      }

      // The safety order.
      const at = (pred) => steps.findIndex(pred);
      const npmCi = at((s) => /^npm ci\b/.test(norm(s.run?.text)));
      const migrate = at((s) => isWranglerAction(s) && new RegExp(`^d1 migrations apply ${leg('migrations')} --remote$`).test(norm(s.with.get('command')?.value)));
      const liveSql = at((s) => /tooling\/ops\/check-d1-accepts-live-sql\.mjs/.test(s.run?.text ?? ''));
      const deploy = at((s) => s.id === 'deploy' && isWranglerAction(s) && /^deploy\b/.test(norm(s.with.get('command')?.value)));
      const smoke = at((s) => /tooling\/ops\/post-deploy-smoke\.mjs/.test(s.run?.text ?? '') && new RegExp(`--url\\s+${leg('smokeUrl')}`).test(s.run?.text ?? ''));
      const record = at((s) => new RegExp(`tooling/ci/record-deployment\\.mjs\\s+${leg('worker')}`).test(s.run?.text ?? ''));
      const laterDeploys = deploy === -1 ? [] : steps.slice(deploy + 1).filter(deploysAWorker);
      const earlierDeploys = deploy === -1 ? [] : steps.slice(0, deploy).filter(deploysAWorker);

      for (const e of entries) {
        const w = `${where} · the ${e.worker} leg`;
        const need = (cond, msg) => { if (!cond) problems.push(`${w}: ${msg}`); };
        need(npmCi !== -1 && npmCi > plan, 'no `npm ci` after the plan step, so nothing installs the locked dependency tree it deploys.');
        if (e.migrations !== null) {
          need(
            migrate !== -1,
            `its Worker migrates ${e.migrations} (worker-set.mjs \`migrations\`), and no step runs \`d1 migrations apply \${{ matrix.${dim}.migrations }} --remote\`. ` +
              'Code that reads a column its database lacks is an outage: the schema expands BEFORE the deploy.',
          );
          need(migrate === -1 || migrate > npmCi, 'its migrations run before `npm ci`.');
          need(migrate === -1 || deploy === -1 || migrate < deploy, 'its migrations run AFTER the deploy: the Worker would go live on a database without its schema.');
        }
        need(liveSql !== -1, 'no live-SQL check (tooling/ops/check-d1-accepts-live-sql.mjs) runs before it deploys.');
        need(liveSql === -1 || migrate === -1 || e.migrations === null || liveSql > migrate, 'the live-SQL check runs before the migrations it must see.');
        need(liveSql === -1 || deploy === -1 || liveSql < deploy, 'the live-SQL check runs after the deploy.');
        need(deploy !== -1, 'no step `id: deploy` running a wrangler-action `deploy` — the step whose success the record is conditioned on.');
        need(
          earlierDeploys.length === 0,
          `${earlierDeploys.length} step(s) deploy before \`id: deploy\` (from line ${earlierDeploys[0]?.first}). A leg deploys its Worker ` +
            'exactly ONCE: a Worker that does not exist yet is created by the deploy that carries its vars, and a secret it needs ' +
            'rides that same version (`--secrets-file`, #981; assert-workflow-hardening limb 13). A second deploy is a second, ' +
            'unqualified path to the live Worker (#155).',
        );
        need(
          laterDeploys.length === 0,
          `${laterDeploys.length} step(s) deploy after \`id: deploy\` (from line ${laterDeploys[0]?.first}). The vars-carrying deploy must be the ` +
            "LAST deploy of the job: a later unqualified one wipes --var GLITCHTIP_DSN and --var RELEASE off the live Worker (#155).",
        );
        need(smoke !== -1 && smoke > deploy, `no smoke of \`\${{ matrix.${dim}.smokeUrl }}\` after the deploy, so nothing asks the live Worker whether it came up.`);
        need(record !== -1 && record > deploy, `no \`record-deployment.mjs \${{ matrix.${dim}.worker }}\` after the deploy, so the ledger never learns what is live.`);
        need(
          record === -1 || norm(steps[record].cond) === "always() && steps.deploy.outcome == 'success'",
          `the record step is conditioned \`${steps[record]?.cond ?? '(nothing)'}\`, not \`always() && steps.deploy.outcome == 'success'\`: a ` +
            'record must follow the act it describes, never a later verdict about it.',
        );
      }
    }
  }
  if (entries.length > 0 && jobs.length === 0) {
    problems.push(
      `worker-set.mjs names ${entries.length} app Worker(s) (${entries.map((e) => e.worker).join(', ')}) and no workflow job plans a ` +
        'leg of the app Worker matrix (`plan-deploy.mjs ${{ matrix.<dim>.worker }}`). Each app Worker deploys from that one ' +
        'matrix; a job written for one Worker is the shape app #2 is missing from.',
    );
  }
  return { problems, jobs };
}

// ── LIMB 5 · PLATFORM_DB migrates before every deploy that binds it ──────────

/** The binding every reader of the shared platform database declares. */
export const PLATFORM_DB_BINDING = 'PLATFORM_DB';
/** Where the configs that can bind it live: each Worker, and each Pages site's Function. */
export const BINDING_CONFIG_DIRS = ['services', 'tooling/sites'];
/** The one production migration of it: no `--env`, against the remote database. */
const PLATFORM_DB_APPLY = /^d1 migrations apply PLATFORM_DB --remote$/;

/** Every `<dir>/<name>` under BINDING_CONFIG_DIRS whose wrangler.jsonc binds PLATFORM_DB,
 *  comments stripped, so a comment naming the binding is not a binding. */
export function platformDbConfigs(root) {
  const out = [];
  for (const base of BINDING_CONFIG_DIRS) {
    const abs = join(root, base);
    if (!existsSync(abs)) continue;
    for (const name of listDir(abs).sort()) {
      const cfg = join(abs, name, 'wrangler.jsonc');
      if (!existsSync(cfg)) continue;
      const text = stripSourceComments(readFileSync(cfg, 'utf8'), '.ts');
      if (new RegExp(`"binding"\\s*:\\s*"${PLATFORM_DB_BINDING}"`).test(text)) out.push(`${base}/${name}`);
    }
  }
  return out;
}

const callTarget = (job) =>
  job.lines.map((l) => l.text.match(/^ {4}uses:\s*['"]?\.\/(\.github\/workflows\/[^@\s'"]+\.ya?ml)['"]?\s*$/)).find(Boolean)?.[1] ?? null;
const commandOf = (s) => norm(s.with.get('command')?.value ?? '');

/**
 * Limb 5, pure over parsed workflows, the binding config directories
 * (platformDbConfigs) and the app Worker legs (`appWorkerMatrix(root).entries`).
 * `{ problems, deployers, applier }`: `deployers` names each job graded,
 * `<workflow>:<job> (<config dir>)`; `applier` the one migration job, or null.
 */
export function judgePlatformDbOrder(workflows, configs, entries) {
  const problems = [];
  const key = (wf, job) => `${wf.rel}:${job}`;
  /** Every call job, in any workflow, that `uses:` the workflow at `rel`. */
  const callersOf = (rel) => workflows.flatMap((wf) => [...wf.jobs.values()].filter((j) => callTarget(j) === rel).map((j) => ({ wf, job: j })));

  // The applier: the one job whose wrangler-action runs the production PLATFORM_DB migration.
  const appliers = [];
  for (const wf of workflows) {
    for (const [id, job] of wf.jobs) {
      if (workflowSteps(job).some((s) => isWranglerAction(s) && PLATFORM_DB_APPLY.test(commandOf(s)))) appliers.push({ wf, id });
    }
  }
  if (appliers.length !== 1) {
    problems.push(
      `${appliers.length} job(s) run \`d1 migrations apply ${PLATFORM_DB_BINDING} --remote\`` +
        `${appliers.length ? ` (${appliers.map((a) => key(a.wf, a.id)).join(', ')})` : ''}, and there must be exactly ONE, ` +
        'which every deploy of a config binding it needs: with none, nothing migrates platform_db before what reads it ' +
        'goes live; with two, "the migration ran first" names no single job.',
    );
  }
  // The nodes that count as "the migration": the applier, and every job that calls its
  // workflow (and every job calling THAT one), since a call job succeeds only when it did.
  const migrated = new Set();
  const markCallers = (rel) => {
    for (const c of callersOf(rel)) {
      if (migrated.has(key(c.wf, c.job.name))) continue;
      migrated.add(key(c.wf, c.job.name));
      markCallers(c.wf.rel);
    }
  };
  if (appliers.length === 1) {
    migrated.add(key(appliers[0].wf, appliers[0].id));
    markCallers(appliers[0].wf.rel);
  }
  /** Every job a job transitively WAITS FOR: its `needs:` inside its workflow, and the
   *  `needs:` of every job that calls that workflow. A calling job itself is NOT one: the
   *  job runs inside it, so a sibling of the applier would otherwise "need" the migration
   *  through the call that encloses them both. */
  const ancestors = (wf, id) => {
    const needed = new Set();
    const visited = new Set();
    const walk = (w, j) => {
      if (visited.has(key(w, j))) return;
      visited.add(key(w, j));
      for (const n of w.jobs.get(j)?.needs ?? []) {
        needed.add(key(w, n));
        walk(w, n);
      }
      for (const c of callersOf(w.rel)) walk(c.wf, c.job.name);
    };
    walk(wf, id);
    return needed;
  };

  // The jobs that deploy a binding config to production.
  const deployers = [];
  const deployedConfigs = new Set();
  const legDir = /^\$\{\{\s*matrix\.[A-Za-z_][A-Za-z0-9_-]*\.dir\s*\}\}$/;
  for (const wf of workflows) {
    for (const [id, job] of wf.jobs) {
      const dirs = new Set();
      for (const s of workflowSteps(job)) {
        const cmd = isWranglerAction(s) ? commandOf(s) : norm(s.run?.text);
        if (/--env\b|--dry-run\b/.test(cmd)) continue;
        const wd = norm(s.with.get('workingDirectory')?.value ?? '');
        if (isWranglerAction(s) && /^deploy\b/.test(cmd)) {
          for (const c of configs) {
            if (wd === c || (legDir.test(wd) && entries.some((e) => e.dir === c))) dirs.add(c);
          }
        }
        const project = cmd.match(/\bpages deploy\b.*--project-name[= ]([A-Za-z0-9][A-Za-z0-9-]*)/)?.[1];
        if (project) for (const c of configs) if (c === `tooling/sites/${project}`) dirs.add(c);
      }
      for (const c of dirs) {
        deployedConfigs.add(c);
        deployers.push(`${key(wf, id)} (${c})`);
        if (migrated.size === 0) continue; // the applier finding above already names it
        // The applier deploying what it just migrated, in one job, is ordered by its own steps.
        const up = ancestors(wf, id);
        if (key(wf, id) !== key(appliers[0].wf, appliers[0].id) && ![...up].some((n) => migrated.has(n))) {
          const callers = callersOf(wf.rel).map((x) => key(x.wf, x.job.name));
          problems.push(
            `${key(wf, id)} deploys ${c}, whose wrangler.jsonc binds ${PLATFORM_DB_BINDING}, and does not transitively need ` +
              `${[...migrated].join(' or ')} — the job that migrates platform_db. It can go live on a database without the ` +
              `schema it reads (row O-APP-WORKERS-DEPLOY-BEFORE-THE-MIGRATION). Add that job to the \`needs:\` of ` +
              `${callers.length ? callers.join(', ') : `\`${id}\``}.`,
          );
        }
      }
    }
  }
  for (const c of configs) {
    if (!deployedConfigs.has(c)) {
      problems.push(
        `${c}/wrangler.jsonc binds ${PLATFORM_DB_BINDING} and no workflow job deploys it to production that this limb can ` +
          'read (a wrangler deploy in that directory or a matrix leg of it, or a `pages deploy --project-name=<name>` for ' +
          'tooling/sites/<name>). Either the deploy moved out of this reader\'s sight, or the config is dead.',
      );
    }
  }
  return { problems, deployers, applier: appliers.length === 1 ? key(appliers[0].wf, appliers[0].id) : null };
}

function main() {
  const files = workflowFiles();
  if (files.length === 0) {
    console.error(`✗ COVERAGE LOST: no workflow files under ${WORKFLOW_DIR}.`);
    console.error('  This guard cannot verify what it cannot read, and that is a failure, not a skip.');
    coverageLost();
  }

  const units = readUnits(REPO_ROOT);
  if (units === null || Object.keys(units).length < MIN_UNITS) {
    console.error(`✗ COVERAGE LOST: ${UNITS_REL} holds no readable \`deployUnits\` (expected at least ${MIN_UNITS} unit).`);
    console.error('  The units are the list plan-deploy.mjs publishes on, and the one this guard judges. With');
    console.error('  none read, every limb would range over nothing and print ok.');
    coverageLost();
  }

  const problems = [];
  const texts = new Map(files.map((f) => [f, readFileSync(resolve(WORKFLOW_DIR, f), 'utf8')]));
  const plans = files
    .map((workflow) => ({ workflow, environments: plannedEnvironments(texts.get(workflow)) }))
    .filter((p) => p.environments.length > 0);

  if (plans.length < MIN_PLANNING_WORKFLOWS) {
    console.error(
      `✗ COVERAGE LOST: scanned ${files.length} workflow(s) and found ${plans.length} that run ` +
        `\`plan-deploy.mjs <environment>\`; expected at least ${MIN_PLANNING_WORKFLOWS}.`,
    );
    console.error('  Either the plan step was renamed, or the shape moved. Both are failures — a scan over');
    console.error("  nothing prints ok, which is this repository's single most repeated failure.");
    coverageLost();
  }

  // Limbs 1-2, with each app Worker matrix leg read as its Worker (limb 4's legs).
  const matrix = appWorkerMatrix(REPO_ROOT);
  const legs = matrix.lost === null ? matrix.entries.map((e) => e.worker) : null;
  if (legs === null) {
    problems.push(
      `COVERAGE LOST: the app Worker matrix could not be read (${matrix.lost}), so limb 1 cannot expand a ` +
        '`${{ matrix.<dim>.worker }}` plan into its Workers and limb 4 has no leg to grade.',
    );
  }
  const { problems: unitProblems, owners } = judgeUnits(units, expandPlans(plans, legs));
  problems.push(...unitProblems);
  problems.push(...judgeLegUnits(units, matrix.entries));

  // Limb 4.
  const parsed = parseAllWorkflows(REPO_ROOT);
  const wm = judgeWorkerMatrix(parsed, matrix.entries);
  problems.push(...wm.problems);

  // Limb 5.
  const dbConfigs = platformDbConfigs(REPO_ROOT);
  if (dbConfigs.length === 0) {
    problems.push(
      `COVERAGE LOST: no wrangler.jsonc under ${BINDING_CONFIG_DIRS.join(' or ')} binds ${PLATFORM_DB_BINDING}, so limb 5 ` +
        'would grade no deploy. The binding moved, or the reader stopped finding it.',
    );
  }
  const order = judgePlatformDbOrder(parsed, dbConfigs, matrix.entries);
  problems.push(...order.problems);

  // Limb 3.
  const imports = judgeImports(REPO_ROOT, units);
  problems.push(...imports.problems);

  if (imports.scanned < MIN_SCANNED_SOURCES) {
    console.error(
      `✗ COVERAGE LOST: limb 3 read ${imports.scanned} source file(s) under the trees these units claim, ` +
        `fewer than the ${MIN_SCANNED_SOURCES} that exist today.`,
    );
    console.error('  It decides "does this unit claim what its tree imports" by reading those files. With');
    console.error('  none read, every unit is judged to import nothing and the limb certifies a clean tree');
    console.error('  it never looked at — the vacuous pass this repository refuses.');
    if (problems.every((p) => p.includes('COVERAGE LOST'))) coverageLost(); // with a finding beside it, the report below prints it and exits 1
  }

  if (problems.length) {
    console.error('✗ A CHANGE THAT ALTERS A DEPLOY IS NOT CLAIMED BY ITS UNIT\n');
    for (const p of problems) console.error(`  · ${p}\n`);
    console.error('  Measured 2026-08-04: run 30933229005 pushed #155 — whose subject was repairing the');
    console.error('  deploy job — skipped both deploy jobs and reported SUCCESS, leaving the live platform');
    console.error('  Worker on `build: null` with its crash sink dark for six hours.');
    if (problems.every((p) => p.includes('COVERAGE LOST'))) coverageLost(); process.exit(1); // 2 only when nothing but could-not-look stops; a finding keeps 1
  }

  const summary = plans
    .map((p) => `${p.workflow} (${[...owners].filter(([, by]) => by.includes(p.workflow)).map(([k]) => k).join(', ')})`)
    .join('; ');
  console.log(
    `ok  ${Object.keys(units).length} deploy unit(s) in ${UNITS_REL}, planned by ${plans.length} of ${files.length} ` +
      `workflow(s) scanned — ${summary}; every unit is planned, and claims the workflow that deploys it.`,
  );
  console.log(
    `ok  limb 3 — ${imports.scanned} bundled source file(s) read; ${imports.external.length} import(s) leave a ` +
      'claimed tree and every one is claimed by its own unit:',
  );
  for (const e of imports.external) {
    console.log(`      ${e.name}: ${e.from} → ${e.target}`);
  }
  console.log(
    `ok  limb 4 — ${matrix.entries.length} app Worker leg(s) (${matrix.entries.map((e) => e.worker).join(', ')}), read from ` +
      `worker-set.mjs, each graded in ${wm.jobs.join(', ')}: its unit claims its tree, and npm ci → migrations (where its ` +
      'Worker migrates a D1) → live-SQL check → the vars deploy, the leg\'s only one → smoke → record.',
  );
  console.log(
    `ok  limb 5 — ${dbConfigs.length} config(s) bind ${PLATFORM_DB_BINDING} (${dbConfigs.join(', ')}); ${order.deployers.length} ` +
      `production deploy job(s) of them (${order.deployers.join('; ')}), each transitively needing ${order.applier}, the one job ` +
      'that migrates it.',
  );
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
