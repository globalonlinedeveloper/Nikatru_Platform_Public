/* discover.mjs — which tools does this push actually affect?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/discover.mjs                       list every tool
     node scripts/discover.mjs --base <sha>          only tools the diff touches
     node scripts/discover.mjs --base <sha> --out "$GITHUB_OUTPUT"
     node scripts/discover.mjs --json                machine-readable, stdout
     node scripts/discover.mjs --run-gates --tool <id> --stage <gates|package|release>
                               [--target <t>] [--os <o>] [--zip <path>]
     node scripts/discover.mjs --assert-generic

   ⏱ 2026-09-25 (O-EXTENSION-GATES-NAME-ONE-TOOL): the two modes on the last
   lines. A tool's own store gates are DATA in its tool.json `gates` list, and
   `--run-gates` runs the ones declared for one (tool, stage) — so each job
   calls it once and no workflow step carries a tool id in an `if:`.
   `--assert-generic` is the refusal that keeps it that way; it runs in the
   gate-inventory job. Both are described where they are implemented, below
   the matrix report. The default mode's output is unchanged by them: `gates`
   is read by these two modes and by the declaration check, nothing else.

   Emits `tools=["fullshot",...]` and `count=N`, which ci.yml turns into the
   job matrix. IT EMITS IDS, NOT PATHS: the artifact names, the zip names and
   the release tags are all built from the id, and a matrix keyed on anything
   else has to translate somewhere — which is a place to get it wrong.

   THE THREE WAYS THIS SCRIPT IS ALLOWED TO BE WRONG, AND WHICH ONE IT PICKS

   Testing too few tools ships a break. Testing too many wastes runner minutes.
   Those are not symmetrical, so every ambiguity here resolves to ALL TOOLS:

     - no --base, an empty --base, or the all-zeros sha GitHub sends for the
       first push to a branch  ->  ALL
     - a --base git cannot resolve (force-push, shallow clone, deleted branch)
       ->  ALL, with the reason printed
     - the commit-subject fallback cannot READ the subjects (git log failed)
       ->  ALL, with the reason printed
     - not a git repository at all  ->  ALL, with the reason printed
     - the diff touches core/, scripts/, .github/ or a root-level config file
       ->  ALL, because those change what every tool is graded by

   WHY THE EMPTY ANSWER IS PRINTED LOUDLY

   `count=0` is a legitimate outcome — ci.yml guards on it — but it is also
   exactly what a broken glob produces, and a broken glob looks like a green
   run. So a zero-tool answer always explains WHY it is zero: no tool.json
   files at all, or a diff that touched none of them. "No matches found" from a
   search that never looked in the right place is this corpus's most expensive
   recurring bug; it does not get to hide here.

   Exit codes: 0 the matrix is trustworthy · 1 a tool.json is malformed or two
   tools share an id (a matrix built on that is quietly wrong) · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { constants as osConstants } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs, die, EXIT_OK, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, loadAllTools } from './lib/toolinfo.mjs';

/* `--json` and `--all` are booleans and parseArgs takes the next token as a
   flag's value (report.mjs:137-139), so `--all <anything>` silently read as
   --all OFF — a NARROWER matrix from a flag whose whole job is to widen it.
   Same treatment as lint.mjs:48. Only --base, --out and --repo-root take values
   in the matrix mode; --tool, --stage, --target, --os and --zip belong to
   --run-gates alone. */
const BOOLEAN_FLAGS = ['json', 'all', 'run-gates', 'assert-generic'];
const args = parseArgs(process.argv.slice(2)
  .map(a => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
const MATRIX_FLAGS = ['base', 'out', 'json', 'all'];
const RUN_GATES_FLAGS = ['tool', 'stage', 'target', 'os', 'zip'];
args.rejectUnknown([...MATRIX_FLAGS, 'repo-root', 'run-gates', 'assert-generic', ...RUN_GATES_FLAGS]);
const root = repoRoot(args);

/* One mode per run. A flag from another mode is refused rather than ignored:
   `--run-gates --all` reading as "run the gates" would drop the --all silently,
   and `--stage package` without --run-gates would print a matrix and exit 0
   having run no gate at all. */
const MODE = args.bool('run-gates') ? 'run-gates' : args.bool('assert-generic') ? 'assert-generic' : 'matrix';
{
  const given = k => args.has(k);
  if (args.bool('run-gates') && args.bool('assert-generic')) die('--run-gates and --assert-generic are two modes; give one.');
  if (MODE !== 'matrix' && MATRIX_FLAGS.some(given)) {
    die('--' + MODE + ' takes none of ' + MATRIX_FLAGS.filter(given).map(k => '--' + k).join(', ') + '; those build the CI matrix.');
  }
  if (MODE !== 'run-gates' && RUN_GATES_FLAGS.some(given)) {
    die(RUN_GATES_FLAGS.filter(given).map(k => '--' + k).join(', ') + ' belong(s) to --run-gates; without it this run would ' +
      (MODE === 'matrix' ? 'print a matrix and run no gate.' : 'ignore them.'));
  }
}

/* Paths that change how EVERY tool is graded. A change here widens the matrix
   to everything, because the gates themselves moved. */
const WIDENS_TO_ALL = [
  'core/', 'scripts/', '.github/', 'templates/',
  '.gitattributes', '.gitignore', '.githooks/'
];

/* 🔴 THE SAME LIST FOR THE WORLD ABOVE THIS TREE, ADDED 2026-09-05 WITH THE MOVE
   INTO Nikatru_Platform_Public ([ADR 067] decision 1). These paths are OUTSIDE
   the extensions subtree and still change what every tool is graded by: the
   workflow that runs the gates, the shared contract the extensions import
   verbatim, and the root attribute/ignore files that decide what a checkout and
   therefore a package even contains. Repo-relative, never prefixed. */
const OUTSIDE_WIDENS_TO_ALL = [
  '.github/workflows/', 'contracts/', '.gitattributes', '.gitignore', '.githooks/'
];

/* ---------------- declared gates (tool.json `gates`) ----------------
   ⏱ 2026-09-25, O-EXTENSION-GATES-NAME-ONE-TOOL. Until this date the three
   FullShot store gates were three workflow steps, each behind an `if:` that
   compared the matrix tool (or the release tag's id) with the literal
   'fullshot'. A second extension would have inherited none of them, and
   nothing said so. Now a tool declares them:

     "gates": [ { "id": "amo-source", "stage": "gates",
                  "run": "Extension/<Tool>/publish/<script> [args]",
                  "when": { "target": "firefox", "os": "ubuntu-24.04" } } ]

   `stage` names the job the gate belongs to (gates, package, release). `run`
   is a node script, relative to this tree's root — the directory every
   extension job runs in — plus fixed arguments; it is spawned with this
   node binary and NO shell, so a declaration cannot smuggle a pipe or a
   `$(...)` into a job. `when` narrows a gate to one matrix leg; a key it
   names must be given on the command line and equal, or the gate does not
   run on that leg and the log says so.

   A DECLARATION THAT CANNOT RUN IS A MATRIX ERROR, in every mode. A `run`
   path that no longer resolves, or a `when.target` the tool does not build,
   is a gate that silently stops running — the same class as a `tests` entry
   that points at nothing (lib/toolinfo.mjs), and refused the same way. */
const GATE_STAGES = ['gates', 'package', 'release'];
const GATE_KEYS = ['id', 'stage', 'run', 'when'];
const GATE_WHEN_KEYS = ['target', 'os'];
const RE_GATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_GATE_SCRIPT = /\.(?:mjs|cjs|js)$/;

function declaredGates(t) {
  return Array.isArray(t.raw.gates) ? t.raw.gates : [];
}

function gateProblems(t) {
  const where = t.rel + '/tool.json';
  const g = t.raw.gates;
  if (g === undefined) return [];
  if (!Array.isArray(g)) return [where + ': "gates" must be an array of { id, stage, run, when? } declarations, found ' + typeof g + '.'];
  const out = [];
  const seen = new Set();
  g.forEach((d, i) => {
    const at = where + ': gates[' + i + ']';
    if (!d || typeof d !== 'object' || Array.isArray(d)) { out.push(at + ' must be an object.'); return; }
    for (const k of Object.keys(d)) {
      if (!GATE_KEYS.includes(k)) {
        out.push(at + ' has an unknown key "' + k + '" (known: ' + GATE_KEYS.join(', ') + '). A misspelt "when" would run the gate on every leg; a misspelt "stage" would run it on none.');
      }
    }
    if (typeof d.id !== 'string' || !RE_GATE_ID.test(d.id)) out.push(at + ': "id" must be lowercase-kebab, found ' + JSON.stringify(d.id) + '.');
    else if (seen.has(d.id)) out.push(at + ': "id" "' + d.id + '" is declared twice in this tool; the log names a failing gate by its id.');
    else seen.add(d.id);
    if (!GATE_STAGES.includes(d.stage)) out.push(at + ': "stage" is ' + JSON.stringify(d.stage) + ', expected one of ' + GATE_STAGES.join(', ') + '.');
    if (typeof d.run !== 'string' || !d.run.trim()) out.push(at + ': "run" must be "<script> [args]", a node script relative to ' + path.basename(root) + '/.');
    else {
      const script = d.run.trim().split(/\s+/)[0];
      const abs = path.resolve(root, script);
      const rel = path.relative(root, abs);
      if (path.isAbsolute(script) || rel.startsWith('..') || path.isAbsolute(rel)) out.push(at + ': "run" names ' + script + ', which is outside ' + path.basename(root) + '/. A gate runs a script this tree owns.');
      else if (!RE_GATE_SCRIPT.test(script)) out.push(at + ': "run" names ' + script + ', which is not a node script (.mjs, .cjs or .js). It is spawned with node and no shell.');
      else if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) out.push(at + ': "run" names ' + script + ', which does not exist. A gate path that no longer resolves does not fail on its own — the job that runs it is the first to find out, and only on the leg that reaches it.');
    }
    if (d.when !== undefined) {
      if (!d.when || typeof d.when !== 'object' || Array.isArray(d.when)) out.push(at + ': "when" must be an object like { "target": "firefox", "os": "ubuntu-24.04" }.');
      else for (const [k, v] of Object.entries(d.when)) {
        if (!GATE_WHEN_KEYS.includes(k)) out.push(at + ': "when" has an unknown key "' + k + '" (known: ' + GATE_WHEN_KEYS.join(', ') + ').');
        else if (typeof v !== 'string' || !v) out.push(at + ': when.' + k + ' must be a non-empty string, found ' + JSON.stringify(v) + '.');
        else if (k === 'target' && !Object.prototype.hasOwnProperty.call(t.targets || {}, v)) {
          out.push(at + ': when.target is "' + v + '", which this tool does not build (targets: ' + (Object.keys(t.targets || {}).join(', ') || 'none') + '). The gate would never run.');
        }
      }
    }
  });
  return out;
}

/* --run-gates: run the gates one tool declares for one stage, in the order it
   declares them, and exit with the first non-zero code. Fail-fast, like the
   workflow steps they replace: a later gate does not run after an earlier one
   failed, and the log names the ones that did not run. No declaration at the
   stage is a legitimate state (a tool may have no store gate of its own) and
   exits 0, printing that it ran none. */
function runGates() {
  const id = args.get('tool');
  const stage = args.get('stage');
  if (typeof id !== 'string' || !id) die('--run-gates needs --tool <id>.');
  if (!GATE_STAGES.includes(stage)) die('--run-gates needs --stage <' + GATE_STAGES.join('|') + '>, found ' + JSON.stringify(stage ?? null) + '.');
  const tool = tools.find(t => t.id === id);
  if (!tool) die('--tool "' + id + '" is not the id of a tool on disk (' + (tools.map(t => t.id).sort().join(', ') || 'NONE') + ').');
  const leg = {};
  for (const k of GATE_WHEN_KEYS) {
    const v = args.get(k);
    if (v === true || v === '') die('--' + k + ' needs a value.');
    if (typeof v === 'string') leg[k] = v;
  }
  const zip = args.get('zip');
  if (zip === true || zip === '') die('--zip needs a path.');

  const atStage = declaredGates(tool).filter(d => d.stage === stage);
  const runnable = [];
  for (const d of atStage) {
    const off = Object.entries(d.when || {}).filter(([k, v]) => leg[k] !== v);
    if (off.length) {
      console.log('not on this leg  ' + d.id + '  (declared for ' + off.map(([k, v]) => k + '=' + v).join(' ') +
        '; this leg is ' + (off.map(([k]) => k + '=' + (leg[k] ?? 'unset')).join(' ')) + ')');
    } else runnable.push(d);
  }
  if (!runnable.length) {
    console.log('no gates declared for ' + id + ' at ' + stage +
      (atStage.length ? ' that run on this leg (' + atStage.length + ' declared for other legs)' : '') + '.');
    process.exit(EXIT_OK);
  }
  for (let i = 0; i < runnable.length; i++) {
    const d = runnable[i];
    const [script, ...fixed] = d.run.trim().split(/\s+/);
    const argv = [...fixed, ...(typeof zip === 'string' ? ['--zip', zip] : [])];
    console.log('── gate ' + (i + 1) + ' of ' + runnable.length + ': ' + id + ' · ' + stage + ' · ' + d.id + '  →  node ' + [script, ...argv].join(' '));
    const res = spawnSync(process.execPath, [path.resolve(root, script), ...argv], { stdio: 'inherit' });
    if (res.error) die('could not start gate "' + d.id + '": ' + res.error.message);
    const code = res.status ?? (128 + (osConstants.signals[res.signal] || 0));
    if (code !== 0) {
      const rest = runnable.slice(i + 1).map(x => x.id);
      console.error('gate "' + d.id + '" of ' + id + ' exited ' + code + (res.signal ? ' (' + res.signal + ')' : '') + '.' +
        (rest.length ? ' Not run after it: ' + rest.join(', ') + '.' : ''));
      process.exit(code);
    }
  }
  console.log(runnable.length + ' gate(s) declared for ' + id + ' at ' + stage + ' ran, and every one exited 0: ' + runnable.map(d => d.id).join(', ') + '.');
  process.exit(EXIT_OK);
}

/* --assert-generic: no extension workflow names a tool. Exit 1 on any line of
   extensions-ci.yml or extensions.yml that compares the matrix tool or the
   release tag's id with `==` or `!=`, in either order. COMMENTS COUNT: the
   row's own confirmation is a plain grep of .github/workflows, and a comment
   that spelled the literal would make that grep report a seam that is not
   there. Two more findings keep the runner honest: a stage some tool declares
   a gate at that no workflow step runs `--run-gates` for (the gate would never
   run), and a `when.os` that no workflow names (a leg that does not exist).

   Exit 2, COVERAGE LOST, when either workflow is absent or empty, or when no
   tool declares a gate at all: a clean answer over no subject is not a pass. */
const LITERAL = /\b(?:matrix\.tool|steps\.tag\.outputs\.id)\s*[!=]=|[!=]=\s*(?:matrix\.tool|steps\.tag\.outputs\.id)\b/;
const RUNNER_CALL = /\bdiscover\.mjs\s+--run-gates\b.*?--stage\s+([A-Za-z0-9_-]+)/;
const GENERIC_WORKFLOWS = ['extensions-ci.yml', 'extensions.yml'];

/* The directory GitHub reads this tree's workflows from: its own .github/ when
   it is a repository of its own (the `git subtree split` case), otherwise the
   enclosing repository's, one level up — where they live since 2026-09-05. */
function workflowDir() {
  const own = path.join(root, '.github', 'workflows');
  return fs.existsSync(own) ? own : path.join(path.dirname(root), '.github', 'workflows');
}

function assertGeneric() {
  const dir = workflowDir();
  const texts = new Map();
  for (const f of GENERIC_WORKFLOWS) {
    const abs = path.join(dir, f);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); }
    catch (e) { die('COVERAGE LOST — ' + abs + ' cannot be read (' + e.code + '). A workflow this check cannot read is not a workflow that names no tool.'); }
    if (!text.trim()) die('COVERAGE LOST — ' + abs + ' is empty. An empty file names no tool because it runs nothing.');
    texts.set(f, text);
  }
  const declared = tools.flatMap(t => declaredGates(t).map(d => ({ tool: t.id, ...d })));
  if (!declared.length) {
    die('COVERAGE LOST — no tool declares a gate in its tool.json (' + (tools.map(t => t.id).sort().join(', ') || 'no tools') + '). ' +
      'With nothing declared, every runner step runs nothing, and a clean scan would say the workflows are generic while no store gate runs at all.');
  }

  const findings = [];
  const stagesCalled = new Set();
  let lines = 0;
  for (const [f, text] of texts) {
    text.split(/\r?\n/).forEach((line, i) => {
      lines++;
      if (LITERAL.test(line)) findings.push('.github/workflows/' + f + ':' + (i + 1) + '  names a tool: ' + line.trim());
      const m = line.match(RUNNER_CALL);
      if (m) stagesCalled.add(m[1]);
    });
  }
  for (const stage of GATE_STAGES) {
    const at = declared.filter(d => d.stage === stage);
    if (at.length && !stagesCalled.has(stage)) {
      findings.push('stage "' + stage + '" has ' + at.length + ' declared gate(s) (' + at.map(d => d.tool + '/' + d.id).join(', ') +
        ') and no workflow step runs `discover.mjs --run-gates ... --stage ' + stage + '`, so none of them ever runs.');
    }
  }
  const allText = [...texts.values()].join('\n');
  for (const d of declared) {
    if (d.when && typeof d.when.os === 'string' && !allText.includes(d.when.os)) {
      findings.push(d.tool + '/' + d.id + ' is declared for os "' + d.when.os + '", which neither workflow names — the leg it needs does not exist.');
    }
  }

  for (const d of declared) {
    console.log('DECLARED  ' + d.tool + ' · ' + d.stage + ' · ' + d.id + '  →  ' + d.run +
      (d.when ? '  (' + Object.entries(d.when).map(([k, v]) => k + '=' + v).join(' ') + ')' : ''));
  }
  console.log('read ' + lines + ' line(s) of ' + GENERIC_WORKFLOWS.join(' and ') + ' in ' + dir);
  if (findings.length) {
    console.log('\n' + findings.length + ' finding(s):');
    for (const x of findings) console.log('  FAIL  ' + x);
    console.log('\nA step that runs only for one tool id is a gate every other tool silently skips. Declare the gate in');
    console.log('that tool\'s tool.json `gates` and let the job\'s one `discover.mjs --run-gates` step run it.');
    process.exit(EXIT_FAIL);
  }
  console.log('ok  no extension workflow names a tool; ' + declared.length + ' declared gate(s) across ' +
    new Set(declared.map(d => d.stage)).size + ' stage(s), each stage run by a `--run-gates` step.');
  process.exit(EXIT_OK);
}

const { tools, errors, warnings } = loadAllTools(root);
for (const t of tools) errors.push(...gateProblems(t));

if (errors.length) {
  console.error((MODE === 'matrix' ? 'CANNOT BUILD A CI MATRIX' : MODE === 'run-gates' ? 'CANNOT RUN THE DECLARED GATES' : 'CANNOT GRADE THE WORKFLOWS') +
    ' — ' + errors.length + ' tool.json problem(s):');
  for (const e of errors) console.error('  - ' + e);
  if (MODE === 'matrix') {
    console.error('\nA matrix built from a malformed tool.json is quietly wrong: it skips a tool, or it');
    console.error('gives two tools the same artifact name and the second silently overwrites the first.');
  } else {
    console.error('\nThese are the same problems that stop the CI matrix being built; the matrix job fails on them first.');
  }
  process.exit(EXIT_FAIL);
}
for (const w of warnings) console.log('WARN  ' + w);

if (MODE === 'run-gates') runGates();
if (MODE === 'assert-generic') assertGeneric();

const allIds = tools.map(t => t.id).sort();

function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function isGitRepo() {
  try { git(['rev-parse', '--git-dir']); return true; } catch (_) { return false; }
}

/* 🔴 WHERE THIS TREE SITS INSIDE ITS REPOSITORY, AND WHY ASKING IS NOT OPTIONAL.
   `git diff --name-only` prints paths relative to the REPOSITORY ROOT, not to
   the directory git was run in. While this repo was its own repository the two
   were the same and nothing here had to know the difference. Since 2026-09-05 it
   is a subtree of Nikatru_Platform_Public, so git prints
   `extensions/Extension/Full_Screen_Shot/manifest.json` while `t.rel` is
   `Extension/Full_Screen_Shot` — and every `f.startsWith(t.rel + '/')` below is
   FALSE for a file that is plainly inside a tool.

   MEASURED BEFORE IT WAS FIXED, on the merge commit itself: the path match found
   nothing, the commit-subject fallback happened to find a `fullshot:` subject
   among the 61 imported commits, and the answer came out right BY LUCK. A pull
   request that edits a tool and says "Fix the popup" would have selected NONE,
   count=0, every per-tool job skipped, and the run green over 542 files. That is
   exactly the failure report 16 §10.5 names as Risk 2, arriving through the one
   script the same report calls the best-designed part of this repo.

   `git rev-parse --show-prefix` answers it: `extensions/` here, `` when this
   tree is its own repository again after a `git subtree split`. A NULL answer —
   git could not say — widens to ALL, in line with every other ambiguity on this
   page: a path comparison that cannot be anchored silently matches nothing, and
   matching nothing is the expensive direction. */
function repoPrefix() {
  try {
    const p = git(['rev-parse', '--show-prefix']).trim().replace(/\\/g, '/');
    return p === '' || p.endsWith('/') ? p : p + '/';
  } catch (_) { return null; }
}

/* Returns {files, reason} — files===null means "could not diff, widen to all". */
function changedFiles(base) {
  if (!base || base === '' || /^0{7,40}$/.test(base)) {
    return { files: null, reason: 'no usable --base (GitHub sends an all-zeros sha for the first push to a branch)' };
  }
  if (!isGitRepo()) return { files: null, reason: 'not a git repository (' + root + ')' };
  try { git(['cat-file', '-e', base + '^{commit}']); }
  catch (_) { return { files: null, reason: 'git cannot resolve base "' + base + '" — force-push, shallow clone, or a deleted branch' }; }
  let out;
  try { out = git(['diff', '--name-only', base + '...HEAD']); }
  catch (_) {
    /* No merge base (unrelated histories) — fall back to a straight two-dot
       diff rather than reporting an empty change set, which would test nothing. */
    try { out = git(['diff', '--name-only', base, 'HEAD']); }
    catch (e2) { return { files: null, reason: 'git diff against "' + base + '" failed: ' + String(e2.message).split('\n')[0] }; }
  }
  return { files: out.split('\n').map(s => s.trim()).filter(Boolean), reason: null };
}

/* CONTRIBUTING §7: commits are `<tool-id>: <imperative summary>`. That prefix is
   the fallback when path detection is ambiguous — a commit that only edits a
   file outside any tool directory but says `fullshot:` is telling you which
   tool the author believes they changed, and believing them costs one job.

   Returns {ids, error}, and the sentinel is the point. A git failure here used
   to return [], which the caller then published as "no commit subject carried a
   tool-id prefix" — a claim about subjects it had never read — with count=0,
   which ci.yml turns into skipping every per-tool job. Silent, green, testing
   nothing: the one git call in this file that failed CLOSED, against a header
   (:19, :29-36) that promises every ambiguity widens and every zero explains
   itself. `ids: []` still means what it always meant — read, none matched.

   No `-1` fallback: an empty or all-zeros base is already `files === null` out
   of changedFiles and widened at :153 before this is ever called, so the branch
   could not be taken and only inflated apparent coverage. */
function idsFromCommitSubjects(base) {
  let out;
  try { out = git(['log', '--format=%s', base + '..HEAD']); }
  catch (e) {
    /* execFileSync's own message is only "Command failed: git log …". What git
       actually objected to is on the piped stderr, and that is the half a
       reader can act on. */
    return { ids: null, error: String(e.stderr || '').trim().split('\n')[0] || String(e.message).split('\n')[0] };
  }
  const found = new Set();
  for (const s of out.split('\n').map(s => s.trim()).filter(Boolean)) {
    const m = /^([a-z][a-z0-9-]*)\s*:/.exec(s);
    if (m && allIds.includes(m[1])) found.add(m[1]);
  }
  return { ids: [...found], error: null };
}

let selected;
let why;

if (args.bool('all') || tools.length === 0) {
  selected = allIds;
  why = args.bool('all') ? '--all was given' : 'there are no tools to select from';
} else {
  /* Trimmed ONCE, here. It used to be trimmed for changedFiles and passed raw to
     idsFromCommitSubjects, so a base carrying whitespace — an env var with a
     trailing newline, a shell-quoted argument — resolved fine for cat-file and
     diff and then failed `git log`, landing squarely in the swallow that was. */
  const rawBase = args.get('base', process.env.GITHUB_BASE_SHA || '');
  const base = typeof rawBase === 'string' ? rawBase.trim() : '';
  const { files, reason } = changedFiles(base);
  const prefix = files === null ? '' : repoPrefix();
  if (files === null) {
    selected = allIds;
    why = 'widened to ALL tools: ' + reason;
  } else if (prefix === null) {
    selected = allIds;
    why = 'widened to ALL tools: git rev-parse --show-prefix failed, so this tree could not be located ' +
      'inside its repository — and an unanchored path comparison silently matches nothing';
  } else {
    /* Split the diff at the subtree boundary. Inside becomes tree-relative, which
       is what every path rule on this page is written against; outside is graded
       by OUTSIDE_WIDENS_TO_ALL and is otherwise none of this script's business.
       With prefix === '' both lists behave exactly as they did before the move. */
    const inside = prefix ? files.filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length)) : files;
    const outside = prefix ? files.filter(f => !f.startsWith(prefix)) : [];
    const outsideWidener = outside.find(f => OUTSIDE_WIDENS_TO_ALL.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p)));
    const widener = inside.find(f => WIDENS_TO_ALL.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p)))
      ?? outsideWidener;
    if (widener) {
      selected = allIds;
      why = 'widened to ALL tools: ' + (widener === outsideWidener ? prefix.replace(/\/$/, '') + '/.. → ' : '') +
        widener + ' changed, and that changes what every tool is graded by';
    } else {
      const hit = new Set();
      for (const t of tools) for (const f of inside) if (f.startsWith(t.rel + '/')) hit.add(t.id);
      if (hit.size === 0) {
        const { ids: fromSubjects, error: logError } = idsFromCommitSubjects(base);
        if (logError) {
          selected = allIds;
          why = 'widened to ALL tools: git log against "' + base + '" failed: ' + logError +
            ' — the commit subjects were never read, so a zero answer would be a guess';
        } else if (fromSubjects.length) {
          selected = fromSubjects.sort();
          why = 'no changed file fell inside a tool directory; the commit subject prefix named ' + selected.join(', ') +
            ' (CONTRIBUTING §7)';
        } else {
          selected = [];
          why = files.length + ' file(s) changed (' + inside.length + ' inside ' +
            (prefix || './') + ', ' + outside.length + ' above it) and none of them are inside a tool ' +
            'directory, and every commit subject was read and none carried a tool-id prefix';
        }
      } else {
        selected = [...hit].sort();
        why = 'changed files fall inside ' + selected.length + ' tool director' + (selected.length === 1 ? 'y' : 'ies');
      }
    }
  }
}

/* ---------------- report ---------------- */
console.log('tools on disk: ' + (allIds.length ? allIds.join(', ') : 'NONE'));
if (allIds.length === 0) {
  console.log('');
  console.log('  This repo currently contains NO Category/Tool/tool.json files.');
  console.log('  That is a real state, not a search failure: no tool has been onboarded to the');
  console.log('  monorepo contract yet. A tool joins by adding tool.json + CHANGELOG.md to its');
  console.log('  directory (spec §1.3) — zero source changes, zero file moves.');
  console.log('  Until then every per-tool gate has nothing to grade, and ci.yml skips the matrix');
  console.log('  on count=0 rather than reporting a green run over an empty set.');
}
console.log('selected:      ' + (selected.length ? selected.join(', ') : 'NONE') + '  (' + why + ')');

const payload = JSON.stringify(selected);

if (args.has('json')) console.log(payload);

const outPath = args.get('out');
if (typeof outPath === 'string' && outPath) {
  /* GITHUB_OUTPUT is append-only and key=value per line. */
  try {
    fs.appendFileSync(path.resolve(outPath), 'tools=' + payload + '\ncount=' + selected.length + '\n', 'utf8');
    console.log('wrote tools/count to ' + outPath);
  } catch (e) { die('cannot write --out "' + outPath + '": ' + e.message); }
}

process.exit(EXIT_OK);
