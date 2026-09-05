/* lint.mjs — node --check every shipped .js and .mjs.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/lint.mjs                 every tool, plus core/ and scripts/
     node scripts/lint.mjs fullshot        one tool (id or Category/Tool_Dir)
     node scripts/lint.mjs core            the shared core
     node scripts/lint.mjs scripts         this tooling, checking itself
     node scripts/lint.mjs fullshot --all  every .js/.mjs in the tree, shipped or not

   A syntax error in a shipped file is not a style problem. Chrome refuses to
   register a service worker that will not parse, and the extension then fails
   to install with an error that names the file but not the line. `node --check`
   names the line and prints a caret under the token. That is the whole gate:
   no style opinions, no config file, no dependency, no plugin ecosystem.

   WHAT COUNTS AS "SHIPPED"

   The package allowlist in tool.json decides — the same set pack would zip —
   so a file that cannot ship cannot fail this gate, and a file that ships can
   never skip it. The tests named in tool.json are checked too: a sim with a
   syntax error does not fail, it fails to START, and a runner that treats a
   non-zero exit as "the test found a bug" reports the same thing either way.

   REQUIRED COVERAGE — WHY LINTING ZERO FILES IS A FAILURE

   The recurring bug in this family is never a broken check, it is a check that
   silently stopped checking: an allowlist edit narrows the file set to nothing
   and the gate prints a cheerful pass over an empty set. So a tool that yields
   zero files to check FAILS here and says so. `--allow-empty` exists for the
   one legitimate case, and using it is then a visible decision in a workflow
   file rather than an accident in a glob.

   core/ is the documented exception: when it does not exist, this reports zero
   files and exits 0 — with the absence stated in full, never as a silent pass.

   Exit codes: 0 everything parsed · 1 something did not (or nothing was
   checked) · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, loadAllTools, resolveTool, packagedFiles, walk } from './lib/toolinfo.mjs';

/* `--all` and `--allow-empty` are BOOLEANS, and parseArgs is deliberately dumb:
   it takes the next token as a flag's value (report.mjs:137-139). So
   `lint.mjs --all fullshot` handed "fullshot" to --all, left the positional
   empty, and ran whole-repo mode with --all OFF — two orderings of one argv,
   opposite verdicts, and the only trace was a header reading "everything".
   Pinning the booleans to the `--key=value` form before parseArgs sees them
   keeps a positional a positional. Only --repo-root takes a value here. */
const BOOLEAN_FLAGS = ['all', 'allow-empty'];
const args = parseArgs(process.argv.slice(2)
  .map(a => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
args.rejectUnknown(['all', 'allow-empty', 'repo-root']);
const root = repoRoot(args);
const target = args.positional[0];
/* One target, or none. Quietly ignoring the second is how a gate ends up
   grading a smaller set than the one that was asked for. */
if (args.positional.length > 1) {
  die('more than one target given: ' + args.positional.map(t => '"' + t + '"').join(', ') +
    '\nThis gate takes exactly ONE — a tool id, a Category/Tool_Dir, "core", "scripts", or nothing\n' +
    'at all for everything. It will not pick one of them for you.');
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'web-ext-artifacts']);
const isScript = rel => /\.(?:js|mjs|cjs)$/i.test(rel);

/* Each entry is {abs, label, why} — `why` explains what put the file in the set,
   so a surprising result is diagnosable without re-reading tool.json.

   `shipped` is counted SEPARATELY from the total, and that separation is the
   whole coverage guarantee. The first version of this file asserted only that
   the combined set was non-empty — so when the self-test narrowed
   package.include to a pattern matching nothing, the tests named in tool.json
   still put one file in the set and the gate reported a cheerful pass over an
   extension whose entire shipped surface had stopped being checked. That is the
   exact failure this project keeps paying for: not a broken check, a check that
   quietly stopped checking.

   So `shipped` is read from package.include in EVERY mode, never from whichever
   branch happened to build the lint set. --all used to mark every file in the
   tree as shipped, which switched this assertion off in the one mode advertised
   as the broadest: on a tool whose package.include matched nothing,
   `lint.mjs fullshot` FAILED and `lint.mjs fullshot --all` passed over the same
   tree. A flag that widens what is linted must never narrow what is asserted. */
function filesForTool(tool) {
  const out = new Map();
  const add = (rel, why) => {
    const abs = path.join(tool.dirAbs, rel);
    if (!fs.existsSync(abs)) return;
    if (!out.has(abs)) out.set(abs, { abs, label: tool.rel + '/' + rel, why });
  };

  const { files } = packagedFiles(root, tool);
  const shipped = files.filter(rel => isScript(rel) && fs.existsSync(path.join(tool.dirAbs, rel))).length;

  if (args.bool('all')) {
    for (const rel of walk(tool.dirAbs, { skip: r => SKIP_DIRS.has(r.slice(r.lastIndexOf('/') + 1)) })) {
      if (isScript(rel)) add(rel, 'in the tree (--all)');
    }
  } else {
    for (const rel of files) if (isScript(rel)) add(rel, 'shipped: package.include');
  }
  for (const rel of tool.tests) add(rel, 'tool.json "tests"');
  return { set: [...out.values()], shipped };
}

function filesUnder(dirRel, why) {
  const abs = path.join(root, dirRel);
  if (!fs.existsSync(abs)) return [];
  return walk(abs, { skip: r => SKIP_DIRS.has(r.slice(r.lastIndexOf('/') + 1)) })
    .filter(isScript)
    .map(rel => ({ abs: path.join(abs, rel), label: dirRel + '/' + rel, why }));
}

/* ---------------- collect ---------------- */
let set = [];
let scope;
let coreAbsent = false;
/* null when "shipped files" is not the right unit for this target (core/,
   scripts/, the whole repo); a number when it is (one tool). */
let shippedCount = null;
/* The tool.json the shipped-coverage failure must name. `target` is a SELECTOR,
   and in the form CI uses it is an id — ci.yml runs the matrix discover.mjs
   emits, and that emits ids — so a path built from it read "fullshot/tool.json",
   which exists nowhere. */
let toolJsonRel = null;

if (target === 'core') {
  scope = 'core/';
  set = filesUnder('core', 'in core/');
  if (!fs.existsSync(path.join(root, 'core'))) coreAbsent = true;
} else if (target === 'scripts') {
  scope = 'scripts/';
  set = filesUnder('scripts', 'in scripts/');
} else if (target) {
  const tool = resolveTool(root, target);
  scope = tool.id + ' (' + tool.rel + ')';
  toolJsonRel = tool.rel + '/tool.json';
  const f = filesForTool(tool);
  set = f.set;
  shippedCount = f.shipped;
} else {
  const { tools, errors } = loadAllTools(root);
  if (errors.length) {
    console.error('CANNOT RUN — tool.json problems:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(2);
  }
  scope = 'everything (' + tools.length + ' tool(s) + core/ + scripts/)';
  for (const t of tools) set.push(...filesForTool(t).set);
  set.push(...filesUnder('core', 'in core/'));
  set.push(...filesUnder('scripts', 'in scripts/'));
  const seen = new Set();
  set = set.filter(f => (seen.has(f.abs) ? false : (seen.add(f.abs), true)));
}

set.sort((a, b) => (a.label < b.label ? -1 : 1));

/* ---------------- run ---------------- */
/* One `node --check` per file. A process each is not free, but it is the exact
   parser that will refuse the file at load time, and a hand-rolled substitute
   would be a second opinion nobody asked for. Bounded concurrency keeps a
   55-file tool under a couple of seconds. */
function check(file) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['--check', file.abs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.stdout.on('data', () => {});
    p.on('error', e => resolve({ file, ok: false, err: 'could not spawn node: ' + e.message }));
    p.on('close', code => resolve({ file, ok: code === 0, err }));
  });
}

async function runAll(files, limit) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(files.length, 1)) }, async () => {
    while (i < files.length) { const f = files[i++]; results.push(await check(f)); }
  });
  await Promise.all(workers);
  return results;
}

const r = new Report('lint · ' + scope);

if (set.length === 0) {
  if (coreAbsent) {
    r.note('core/ does not exist in this repository.');
    r.note('That is a stated absence, not a passing check: the shared runtime described in spec §2');
    r.note('has not been created yet, so there is nothing here to parse. Nothing is being skipped.');
    r.pass('0 files checked (core/ is absent)');
    process.exit(r.finish());
  }
  if (args.bool('allow-empty')) {
    r.warn('0 files checked', '--allow-empty was given, so an empty set is not a failure here.');
    process.exit(r.finish());
  }
  r.fail('0 files checked — REQUIRED COVERAGE not met',
    'This gate selected no .js/.mjs file for "' + (target || 'everything') + '", and a gate that checks\n' +
    'nothing reports exactly the same green as a gate that checked everything and found it clean.\n' +
    'Most likely cause: package.include in tool.json no longer matches any file on disk.\n' +
    'If zero really is correct here, pass --allow-empty so the decision is visible.');
  process.exit(EXIT_FAIL);
}

/* The coverage that actually matters: the SHIPPED surface. A tool whose tests
   still lint while its packaged scripts have all fallen out of package.include
   is the case that produced a green run over nothing. shippedCount comes from
   package.include in every mode, so --all cannot turn this off. */
if (shippedCount === 0 && !args.bool('allow-empty')) {
  /* Name where the files that WERE checked came from, rather than asserting it:
     under --all they came from the tree, not from tool.json "tests". */
  const from = new Map();
  for (const f of set) from.set(f.why, (from.get(f.why) || 0) + 1);
  r.fail('0 SHIPPED files checked — REQUIRED COVERAGE not met',
    'package.include in ' + toolJsonRel + ' selects no .js/.mjs file at all. ' + set.length + ' file(s) were\n' +
    'still checked (' + [...from.entries()].map(([why, n]) => n + ' ' + why).join(' · ') + '), so without\n' +
    'this assertion the run would have reported a pass while the shipped surface went ungraded.\n' +
    'Fix package.include, or pass --allow-empty if a tool that ships no script is really intended.');
  process.exit(EXIT_FAIL);
}

const results = await runAll(set, Math.max(2, Math.min(8, os.cpus().length)));
results.sort((a, b) => (a.file.label < b.file.label ? -1 : 1));

let bad = 0;
for (const res of results) {
  if (res.ok) continue;
  bad++;
  /* node --check prints the file, the offending line, a caret and the error.
     Reprinting it verbatim is better than paraphrasing it. */
  r.fail(res.file.label, String(res.err).trimEnd().split('\n').slice(0, 12).join('\n'));
}

const bySource = new Map();
for (const res of results) bySource.set(res.file.why, (bySource.get(res.file.why) || 0) + 1);
const breakdown = [...bySource.entries()].map(([why, n]) => n + ' ' + why).join(' · ');

if (!bad) r.pass(results.length + ' file(s) parse', breakdown);
else r.note(results.length + ' file(s) checked (' + breakdown + ')');

process.exit(r.finish());
