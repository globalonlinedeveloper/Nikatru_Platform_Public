#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-lane-inputs.mjs — a path-scoped lane's globs are DERIVED from what its
// jobs read, and a glob that misses an input is a finding. [ADR 095]
//
// A lane callee (.github/workflows/lane-<name>.yml) does its work on a pull request
// only when tooling/ci/lane-map.json says a changed path is in the lane
// (lane-detect.mjs). So the lane's globs ARE its trigger: a path the lane's jobs
// read and the globs do not name is a change those jobs never see before merge.
// Main is never narrowed (lane-detect answers affected=true on every push), so a
// miss cannot reach a release unchecked; it reaches main unchecked, and main goes
// red after the merge instead of the PR before it. That is still the defect, and
// this guard is what stops it: the globs of each lane in DERIVED_LANES are not
// written by hand, they are this script's `--write` output, and the check
// recomputes them from the tree on every run.
//
// ── WHAT A LANE READS, AND WHERE EACH RULE COMES FROM ───────────────────────
//   workflow  the callee itself, every local action it `uses:` (the directory),
//             and every tracked path the callee's or an action's text names: a
//             `working-directory:`, a `run:` argument, a hashFiles() glob. A
//             `${{ … }}` inside a path is any run of characters.
//   scripts   every `node <script>` the callee runs, and every module it imports,
//             through tooling/scripts/affected-guards.mjs closureSubjects — the
//             repository's one static extraction of what a script reads (string
//             literals, `join(ROOT, 'a', 'b')` chains, template literals). A script
//             the step writes to the runner is read as the step's own text. When a
//             module spawns node, every script it names is followed too, read as an
//             import is (its files and globs, not its directory walks): a module that
//             never spawns names other scripts as data. A `node --test <target>`
//             runs every tracked suite its target matches, and an `--import`
//             preload is a script too. A module that imports a COMPUTED path
//             loads the adapters a port register it names lists (tooling/ports/*.json).
//   tools     a command that reads a manifest by convention: mason (mason.yaml),
//             flutter / dart / melos (the root pubspec.yaml, pubspec.lock,
//             analysis_options.yaml), npm (package.json and its lockfile, in the
//             step's working directory) — TOOL_MANIFESTS.
//   pub graph every pub workspace member (the root pubspec's `workspace:`, what
//             melos analyses and tests), every `path:` dependency of each member,
//             transitively, and the root pubspec.yaml and pubspec.lock.
//   the brick a brick file the lane reads is read again as the code it is stamped
//             to: a relative path in it (`../_shared/test/**`, `../../../_shared/src/…`)
//             resolved from its stamped place, when that lands outside the stamp.
//   the map   tooling/ci/lane-map.json, lane-detect.mjs and lane-verdict.mjs: the
//             detect and verdict jobs run them, so they are scripts above.
// A directory becomes `<dir>/**`. A file inside a directory already derived is
// folded into it. The set is sorted, so `--write` is deterministic.
//
// ⚠️ THE EXTRACTION IS STATIC, AND ITS BLIND SPOT IS affected-guards.mjs's: a
// script that builds a path only from data it read names no literal for it, and a
// script's subject that is a WHOLE TOP-LEVEL DIRECTORY of more than fifty files
// (`tooling`, `services` — usually the head of a `join(ROOT, 'tooling', …)` chain)
// is not taken as an input, by the same `covers()` rule that tool uses to call such
// a subject broad. A directory the WORKFLOW names (`dart format apps/`) is always
// taken. The backstop is that main is never narrowed.
//
// Usage:  node tooling/ci/assert-lane-inputs.mjs [--root <dir>] [--write] [--lane <name>]
//   --write  rewrite each derived lane's `globs` in tooling/ci/lane-map.json
//   --lane   derive one lane (default: every lane in DERIVED_LANES)
// Exit 0 = every derived lane's globs equal its derivation.
// Exit 1 = a finding: a derived input the globs miss (named, with what reads it),
//          or a glob the derivation does not produce (hand-written).
// Exit 2 = COVERAGE LOST: the map, a lane, its callee, its node calls or the pub
//          workspace could not be read — a derivation over nothing is never a pass.
// Tests:  tooling/ci/test/lane-inputs.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, parseAllActions, workflowSteps, shellSegments, ACTION_DIR } from './workflow-scan.mjs';
import { globToRegExp, MAP_REL } from './lane-detect.mjs';
import { trackedTree, parseNodeCall, closureSubjects, subjectsOf, workspaceMembers, covers } from '../scripts/affected-guards.mjs';

/** THE LANES WHOSE GLOBS ARE DERIVED. Named here, not read from a field of the map:
 *  a lane that dropped such a field would silently leave this guard's domain. */
export const DERIVED_LANES = ['apps', 'brick'];

class CoverageLost extends Error {}

const SCRIPT = /\.(m?js|cjs)$/;
/** A tool reads its manifest by convention, never by a path anything names: the one
 *  read no text shows. `at` is where it looks — the step's working directory, or the
 *  repository root, which is where pub workspace and mason resolve from. */
const TOOL_MANIFESTS = [
  { what: 'mason reads mason.yaml', runs: /(^|[\s;&|(])mason\s+(make|get|add|bundle)\b/m, reads: ['mason.yaml', 'mason-lock.json'], at: 'root' },
  { what: 'pub resolves from the workspace root', runs: /(^|[\s;&|(])(flutter|dart|melos)\s/m, reads: ['pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml'], at: 'root' },
  { what: 'npm reads its manifest and lockfile', runs: /(^|[\s;&|(])(npm\s+(ci|install|test|run)|npx)\b/m, reads: ['package.json', 'package-lock.json'], at: 'cwd' },
];
/** A module that starts a node process: the scripts it names may be what it runs. */
const SPAWNS_NODE = /\bprocess\.execPath\b|\b(?:spawn|spawnSync|execFile|execFileSync|fork)\(\s*['"]node['"]/;
const EXPR = /\$\{\{[^}]*\}\}/g;
/** A dynamic import whose argument is not a string literal: the module loads a path
 *  it computed, so the code it runs is named by data rather than by its own text. */
const IMPORTS_COMPUTED = /\bimport\(\s*[^\s'"`)]/;
/** A port register: the one kind of JSON whose script paths are code a reader loads. */
const PORT_REGISTER = /^tooling\/ports\/[^/]+\.json$/;

/** Every tracked script a JSON file names as a string value (any depth). An
 *  unreadable or unparsable file names none: the file itself is already an input. */
export function scriptsNamedIn(rel, read, tree) {
  let data;
  try { data = JSON.parse(read(rel)); } catch { return []; }
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      const p = posix.normalize(v.replace(/^\.\//, ''));
      if (SCRIPT.test(p) && tree.files.has(p)) out.add(p);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(data);
  return [...out].sort();
}

/** One word of workflow text as a candidate path: quotes, a leading `./` or `/`,
 *  and a trailing `/` or `.` stripped; an expression becomes \u0000. */
function candidate(word) {
  let s = word.replace(EXPR, '\u0000').replace(/^['"`]+|['"`,;)]+$/g, '');
  s = s.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.$/, '');
  if (!s || s.length > 240 || s.startsWith('..') || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  if (!/[A-Za-z0-9]/.test(s.replace(/\u0000/g, ''))) return null;
  return s;
}

/** A candidate against the tracked tree: a file, a directory, or a glob that
 *  matches a tracked file and holds a whole directory in its literal prefix. */
function placeOf(cand, tree) {
  if (cand === null) return null;
  if (cand.includes('\u0000') || cand.includes('*')) {
    const g = cand.replace(/\u0000/g, '*').replace(/\*{3,}/g, '**');
    const prefix = g.slice(0, g.indexOf('*'));
    if (!prefix.includes('/')) return null;
    let re;
    try { re = globToRegExp(g); } catch { return null; }
    return tree.list.some((f) => re.test(f)) ? { kind: 'glob', path: g } : null;
  }
  if (tree.files.has(cand)) return { kind: 'file', path: cand };
  if (tree.dirs.has(cand)) return { kind: 'dir', path: cand };
  return null;
}

/** Every tracked path one block of workflow text names. A word counts only when it
 *  is shaped like a path — it holds a `/`, or it is a file name with an extension —
 *  so a matrix value or an echoed word (`packages`, `apps`) names no directory. */
function pathsInText(text, tree) {
  const out = [];
  const words = String(text).replace(EXPR, (m) => m.replace(/\s+/g, '')).split(/[\s'"`=(),;|<>]+/);
  for (const w of words) {
    if (!w.includes('/') && !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.[A-Za-z0-9]{1,8}$/.test(w)) continue;
    const p = placeOf(candidate(w), tree);
    if (p) out.push(p);
  }
  return out;
}

/** The working directory one step runs in, from the step or the job's defaults. */
function workingDir(job, step) {
  const lines = job.lines ?? [];
  for (const l of lines) {
    if (l.n < step.first || l.n > step.last) continue;
    const m = l.text.match(/^\s+working-directory:\s*(\S+)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  const d = lines.findIndex((l) => /^ {4}defaults:\s*$/.test(l.text));
  for (let k = d + 1; d !== -1 && k < lines.length && (/^ {6,}/.test(lines[k].text) || !lines[k].text.trim()); k++) {
    const m = lines[k].text.match(/^\s+working-directory:\s*(\S+)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return '.';
}

/** `path:` dependencies of one pubspec, resolved against its directory. */
export function pathDependencies(text, dir) {
  const out = [];
  for (const m of String(text).matchAll(/^\s+path:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm)) {
    const p = posix.normalize(posix.join(dir, m[1])).replace(/\/+$/, '');
    if (!p.startsWith('..')) out.push(p);
  }
  return out;
}

/**
 * The derivation of one lane. Returns { inputs: Map<glob, from>, calls } where
 * `from` names the first thing that reads it.
 */
export function deriveLane(root, map, lane, { tree = trackedTree(root), read = (rel) => readFileSync(join(root, rel), 'utf8') } = {}) {
  const entry = map.lanes?.[lane];
  if (!entry) throw new CoverageLost(`lane "${lane}" is not in ${MAP_REL} (lanes: ${Object.keys(map.lanes ?? {}).join(', ')})`);
  if (typeof entry.callee !== 'string') throw new CoverageLost(`${MAP_REL} lane "${lane}" has no \`callee\`, so there is no workflow to derive its inputs from`);
  const wf = parseWorkflow(root, entry.callee);
  if (wf === null) throw new CoverageLost(`${MAP_REL} lane "${lane}" names callee ${entry.callee}, which does not exist`);
  if (wf.jobs.size === 0) throw new CoverageLost(`${entry.callee} declares no jobs, so its inputs cannot be derived`);

  const found = new Map(); // `${kind}:${path}` → { kind, path, from }
  const add = (p, from) => { const k = `${p.kind}:${p.path}`; if (!found.has(k)) found.set(k, { ...p, from }); };
  add({ kind: 'file', path: entry.callee }, 'the lane callee itself');

  // workflow text and local actions
  const actions = new Map(parseAllActions(root).map((a) => [posix.dirname(a.rel), a]));
  const usedActions = new Set();
  for (const l of wf.lines) {
    const u = l.text.match(/^\s*(?:-\s+)?uses:\s*['"]?\.\/(\.github\/actions\/[A-Za-z0-9._-]+)['"]?\s*$/);
    if (u) usedActions.add(u[1]);
  }
  for (const a of usedActions) {
    if (!actions.has(a)) throw new CoverageLost(`${entry.callee} uses ./${a}, which is not an action under ${ACTION_DIR}`);
    add({ kind: 'dir', path: a }, `${entry.callee} (uses: ./${a})`);
    for (const p of pathsInText(actions.get(a).lines.map((x) => x.text).join('\n'), tree)) add(p, `${a}/action.yml`);
  }
  const calls = [];
  const inline = [];
  for (const job of wf.jobs.values()) {
    for (const p of pathsInText(job.lines.map((x) => x.text).join('\n'), tree)) add(p, `${entry.callee} job "${job.name}"`);
    for (const step of workflowSteps(job)) {
      if (!step.run) continue;
      const wd = workingDir(job, step);
      for (const t of TOOL_MANIFESTS) {
        if (!t.runs.test(step.run.text)) continue;
        for (const f of t.reads) {
          const rel = posix.normalize(posix.join(t.at === 'cwd' && !wd.includes('${{') ? wd : '.', f));
          if (tree.files.has(rel)) add({ kind: 'file', path: rel }, `${entry.callee} job "${job.name}" (${t.what})`);
        }
      }
      for (const seg of shellSegments(step.run.text)) {
        const c = parseNodeCall(seg);
        // ⏱ 2026-10-02 (#1148 put `node --test "tooling/release/test/*.test.mjs"` in
        // app-dryrun): a `--test` call names no `script`, so its suites were taken as a
        // literal glob and what they READ (tooling/ports/channels.json, their fixtures)
        // was derived by nothing. Each suite the call runs, and each `--import` preload,
        // is a script of the step. A target that matches no tracked file is COVERAGE LOST.
        if (c?.test) {
          const base = wd.includes('${{') ? '.' : wd;
          for (const t of c.test) {
            const pat = posix.normalize(posix.join(base, t));
            const re = pat.includes('*') ? globToRegExp(pat) : null;
            const hits = re ? tree.list.filter((f) => re.test(f)) : tree.files.has(pat) ? [pat] : [];
            if (hits.length === 0) throw new CoverageLost(`${entry.callee} job "${job.name}" runs \`node --test ${t}\`, which matches no tracked file`);
            for (const h of hits) calls.push({ rel: h, job: job.name });
          }
          for (let i = 0; i < (c.flags ?? []).length; i++) {
            if (c.flags[i] === '--import' && SCRIPT.test(c.flags[i + 1] ?? '')) calls.push({ rel: posix.normalize(posix.join(base, c.flags[i + 1])), job: job.name });
          }
          continue;
        }
        if (!c?.script) continue;
        if (c.script.includes('$')) {
          // A script the step writes to the runner (`echo "…" > "$RUNNER_TEMP/x.mjs"`) is
          // read as the source it is: the step's own text, scanned as JavaScript.
          inline.push({ text: step.run.text, job: job.name });
          continue;
        }
        calls.push({ rel: posix.normalize(posix.join(wd.includes('${{') ? '.' : wd, c.script)), job: job.name });
      }
    }
  }
  if (calls.length === 0) throw new CoverageLost(`${entry.callee} runs no \`node <script>\`, so the lane's detect step cannot be one of its jobs`);

  // scripts: each call's import closure, and every script a SPAWNING module names.
  // A module that names other scripts and never starts a node process is naming
  // them as data (assert-release-lane-generic lists the lane-bound guards), so only
  // a module whose source spawns node has its named scripts followed, and those are
  // read as an import is: their files and globs, never their directory walks.
  const queue = calls.map((c) => [c.rel, `${entry.callee} job "${c.job}"`, true]);
  for (const { text, job } of inline) {
    const via = `${entry.callee} job "${job}" (a script the step writes)`;
    const { subjects, deps } = subjectsOf(text, entry.callee, tree);
    for (const s of subjects) {
      if (s.kind !== 'file' && covers(s, s.kind === 'dir' ? `${s.path}/x` : firstMatch(s, tree)) === 'broad') continue;
      add({ kind: s.kind, path: s.path }, via);
      if (s.kind === 'file' && SCRIPT.test(s.path) && SPAWNS_NODE.test(text)) queue.push([s.path, via, true]);
    }
    for (const d of deps) queue.push([d, via, true]);
  }
  const walked = new Set();
  const spawns = (rel) => { try { return SPAWNS_NODE.test(read(rel)); } catch { return false; } };
  const importsComputed = (rel) => { try { return IMPORTS_COMPUTED.test(read(rel)); } catch { return false; } };
  while (queue.length) {
    const [rel, via, primary] = queue.shift();
    if (walked.has(rel)) continue;
    walked.add(rel);
    if (!tree.files.has(rel)) throw new CoverageLost(`${via} runs ${rel}, which is not a tracked file`);
    const { subjects, closure } = closureSubjects(rel, tree, read, {});
    for (const m of closure) add({ kind: 'file', path: m }, m === rel ? via : `imported by ${rel}`);
    const spawners = new Set(closure.filter(spawns));
    // A module that imports a path it COMPUTED (`import(<expression>)`) loads code a
    // data file names: the contract suite imports each adapter tooling/ports/channels.json
    // lists. So every tracked script a JSON subject of such a module names is followed,
    // read as an import is. Only for a dynamic importer: elsewhere a script path in a
    // register is data (a job row, a citation), and following it would widen the lane.
    // Only a PORT register the importing module itself names (tooling/ports/*.json):
    // a port names its adapters' code by design (`impl.file`). Any other register's
    // script paths are data (a job row, a citation); following them widened the apps
    // lane from 144 globs to 208, pulling in every Worker's wrangler.jsonc.
    for (const m of closure.filter(importsComputed)) {
      for (const s of subjectsOf(read(m), m, tree).subjects) {
        if (s.kind !== 'file' || !PORT_REGISTER.test(s.path)) continue;
        for (const p of scriptsNamedIn(s.path, read, tree)) {
          if (!walked.has(p)) queue.push([p, `imported by ${m} through ${s.path}`, false]);
        }
      }
    }
    for (const s of subjects) {
      if (s.kind !== 'file' && s.kind !== 'dir' && s.kind !== 'glob') continue;
      if (s.kind === 'dir' && !primary) continue;
      if (s.kind !== 'file' && covers(s, s.kind === 'dir' ? `${s.path}/x` : firstMatch(s, tree)) === 'broad') continue;
      add({ kind: s.kind, path: s.path }, `read by ${rel}`);
      if (s.kind === 'file' && SCRIPT.test(s.path) && !s.path.includes('/test/') && !walked.has(s.path) && spawners.size) {
        queue.push([s.path, `spawned by ${rel}`, false]);
      }
    }
  }

  // pub graph
  const members = workspaceMembers(root);
  if (members.length === 0) throw new CoverageLost('the root pubspec.yaml declares no `workspace:` member, so the pub graph read nothing');
  add({ kind: 'file', path: 'pubspec.yaml' }, 'the pub workspace root');
  if (tree.files.has('pubspec.lock')) add({ kind: 'file', path: 'pubspec.lock' }, 'the pub workspace lockfile');
  const pending = members.map((m) => [m, 'a pub workspace member (pubspec.yaml workspace:)']);
  const seenPkg = new Set();
  while (pending.length) {
    const [dir, why] = pending.shift();
    if (seenPkg.has(dir)) continue;
    seenPkg.add(dir);
    if (!tree.files.has(`${dir}/pubspec.yaml`)) throw new CoverageLost(`${why}: ${dir} has no tracked pubspec.yaml`);
    add({ kind: 'dir', path: dir }, why);
    for (const dep of pathDependencies(read(`${dir}/pubspec.yaml`), dir)) pending.push([dep, `a path dependency of ${dir}/pubspec.yaml`]);
  }

  // the stamp: a brick file the lane reads becomes code at the path the brick stamps it
  // to, and what that code reads by a relative path OUTSIDE the stamp is read too —
  // a stamped Worker's `../_shared/test/**` tests and `../../../_shared/src/…` imports.
  const reads = [...found.values()];
  const covered = (f) => reads.some((p) => p.path === f || (p.kind === 'dir' && f.startsWith(`${p.path}/`)) || (p.kind === 'glob' && globToRegExp(asMapPattern(p.path)).test(f)));
  for (const f of tree.list) {
    const m = f.match(BRICK_FILE);
    if (!m || !TEXT_FILE.test(f) || !covered(f)) continue;
    let text;
    try { text = read(f); } catch { continue; }
    for (const p of stampedReads(m[1], text, tree)) add(p, `the stamp of ${f}`);
  }
  return { inputs: fold(found), calls };
}

const BRICK_FILE = /^tooling\/bricks\/[^/]+\/__brick__\/(.+)$/;
const TEXT_FILE = /\.(ts|js|mjs|cjs|json|jsonc|yaml|yml|toml|dart)$/;

/** A brick path as the path it is stamped to: a section tag `{{#x}}…{{/x}}` keeps its
 *  text, and a variable `{{x}}` is \u0000 (somewhere inside the stamp). */
export function stampedPath(rel) {
  return rel.replace(/\{\{[#^/][^}]*\}\}/g, '').replace(/\{\{\{?[^}]*\}?\}\}/g, '\u0000');
}

/** The tracked places one brick file's text reaches by a relative path, from where it is stamped. */
export function stampedReads(rel, text, tree) {
  const at = posix.dirname(stampedPath(rel));
  const out = [];
  const refs = [
    ...[...String(text).matchAll(/['"](\.\.\/[^'"\s]+)['"]/g)].map((x) => x[1]),
    ...[...String(text).matchAll(/^\s*path:\s*(\.\.\/\S+)\s*$/gm)].map((x) => x[1]),
  ];
  for (const ref of refs) {
    const p = posix.normalize(posix.join(at, ref)).replace(/\/+$/, '');
    if (p.startsWith('..') || p.includes('\u0000') || p.includes('{')) continue;
    let place = placeOf(p, tree);
    for (const ext of ['.ts', '.js', '.mjs', '.dart', '/index.ts']) place ??= placeOf(`${p}${ext}`, tree);
    if (place) out.push(place);
  }
  return out;
}

/** The first tracked path a glob subject matches (for the breadth rule). */
function firstMatch(s, tree) {
  const re = globToRegExp(s.path);
  return tree.list.find((f) => re.test(f)) ?? '';
}

/** A path in the map's glob syntax: a brick's `{{app_id}}` is no glob lane-detect
 *  reads (it refuses `[]{}`), so each segment holding one becomes `*`. Wider, never
 *  narrower: the segment still matches the file it came from. */
export function asMapPattern(path) {
  const segs = [];
  let cur = '';
  let depth = 0;
  for (const c of path) {
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    if (c === '/' && depth === 0) { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => (/[[\]{}]/.test(s) ? (s === '**' ? s : '*') : s)).join('/');
}

/** Places → sorted globs, each with what reads it; a path under a derived `<dir>/**` folds into it. */
function fold(found) {
  const places = [...found.values()].map((p) => {
    const path = asMapPattern(p.path);
    // `<d>/**` is the directory d, whatever named it
    if (/^[^*]+\/\*\*$/.test(path)) return { ...p, kind: 'dir', path: path.slice(0, -3) };
    return { ...p, path, kind: p.kind === 'file' && path !== p.path ? 'glob' : p.kind };
  });
  const dirs = places.filter((p) => p.kind === 'dir').map((p) => p.path.split('/'));
  // Structurally, never by what the tree holds today: `<d>/**` subsumes a path or glob
  // strictly below it, segment by segment, where a `*` of d stands for one segment
  // of anything but `**`.
  const under = (path) => {
    const segs = path.split('/');
    return dirs.some((d) => segs.length > d.length && d.every((x, i) => x === segs[i] || (x === '*' && !segs[i].includes('**'))));
  };
  const out = new Map();
  for (const p of places) {
    if (under(p.path)) continue;
    const g = p.kind === 'dir' ? `${p.path}/**` : p.path;
    if (!out.has(g)) out.set(g, p.from);
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The finding lines for one lane: inputs the globs miss, globs nothing derives. */
export function judgeLane(lane, globs, inputs) {
  const have = new Set(globs);
  const problems = [];
  for (const [g, from] of inputs) {
    if (!have.has(g)) {
      problems.push(
        `lane "${lane}" misses input ${g} (${from}). A pull request that changes it skips the lane's jobs, which read it. ` +
          'Run `node tooling/ci/assert-lane-inputs.mjs --write` and commit tooling/ci/lane-map.json.',
      );
    }
  }
  for (const g of globs) {
    if (!inputs.has(g)) {
      problems.push(
        `lane "${lane}" glob ${g} is not derived from anything the lane reads: it is hand-written. ` +
          'A derived lane\'s globs are --write output only; if the lane does read it, make that read visible to the derivation.',
      );
    }
  }
  return problems;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
  const root = resolve(arg(argv, '--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const mapPath = join(root, MAP_REL);
  if (!existsSync(mapPath)) throw new CoverageLost(`${MAP_REL} does not exist under ${root}`);
  let map;
  try {
    map = JSON.parse(readFileSync(mapPath, 'utf8'));
  } catch (e) {
    throw new CoverageLost(`${MAP_REL} could not be parsed (${e.message})`);
  }
  const only = arg(argv, '--lane');
  const lanes = only === undefined ? DERIVED_LANES : [only];
  if (only !== undefined && !DERIVED_LANES.includes(only)) throw new CoverageLost(`--lane ${only} is not a derived lane (${DERIVED_LANES.join(', ')})`);
  const tree = trackedTree(root);
  if (tree.list.length === 0) throw new CoverageLost(`git ls-files listed ZERO tracked files under ${root}`);
  const problems = [];
  const summary = [];
  for (const lane of lanes) {
    const { inputs, calls } = deriveLane(root, map, lane, { tree });
    if (inputs.size === 0) throw new CoverageLost(`lane "${lane}" derived ZERO inputs`);
    if (argv.includes('--write')) {
      map.lanes[lane].globs = [...inputs.keys()];
      continue;
    }
    const globs = Array.isArray(map.lanes[lane].globs) ? map.lanes[lane].globs : [];
    problems.push(...judgeLane(lane, globs, inputs));
    summary.push(`${lane}: ${inputs.size} derived input globs from ${new Set(calls.map((c) => c.rel)).size} node script(s) of ${map.lanes[lane].callee}`);
  }
  if (argv.includes('--write')) {
    writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    console.log(`wrote ${MAP_REL}: ${lanes.map((l) => `${l} ${map.lanes[l].globs.length} globs`).join(', ')}`);
    return 0;
  }
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error('\nassert-lane-inputs: FAILED');
    return 1;
  }
  console.log(`ok  lane inputs — ${summary.join('; ')}; each lane's globs equal its derivation`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof CoverageLost)) throw e;
    console.error(`FAIL COVERAGE LOST — ${e.message}`);
    console.error('\nassert-lane-inputs: FAILED (exit 2 — a derivation over nothing is never a pass)');
    process.exitCode = 2;
  }
}
