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

  // Limbs 1-2.
  const { problems: unitProblems, owners } = judgeUnits(units, plans);
  problems.push(...unitProblems);

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
