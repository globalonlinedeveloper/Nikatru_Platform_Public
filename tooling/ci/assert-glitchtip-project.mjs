#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-glitchtip-project.mjs — every GlitchTip call site in .github/workflows
// names the project from ONE declaration, and never from the app slug.
//
// ── THE FAILURE THIS EXISTS FOR, MEASURED 2026-09-09 ─────────────────────────
// build-platforms.yml and deploy-web.yml passed `--project "$APP"` — the matrix
// app slug, i.e. the name of a DIRECTORY IN THIS REPOSITORY. The submit-*.yml
// lanes passed a literal. Renaming the app therefore moved some call sites and
// left others behind, and moved them onto a project name that did not exist on
// the server: they POSTed to
//   /api/0/projects/nikatru/subscriptiontracker/files/difs/assemble/
// and got 404 from an instance that still held the retired slug. In the Apple
// lane that 404 sat BETWEEN the .ipa and the step that reads its signature back,
// so GitHub skipped the packaging and the proof.
//
// A GlitchTip project slug is a name on a REMOTE SERVER. Renaming a directory is
// a commit; renaming that project is a PUT against the instance. They are two
// facts and deriving one from the other asserts they are one, which is false the
// moment either moves alone.
//
// ── WHY A FILE AND NOT A LITERAL IN THE YAML ─────────────────────────────────
// The first repair spelled the project out at each call site, and
// assert-release-lane-generic.mjs refused it — correctly. [pipeline 10]D-2b
// abolishes per-app workflow authoring, and an app id typed into a graded lane's
// `run` is exactly that. So the value lives in tooling/ops/glitchtip-project.json
// and the lanes READ IT AT RUN TIME. That is the same rule D-2b states, applied
// to a value that is not per-app at all: one crash sink for the portfolio.
//
// ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
//   1. a call site whose project argument is derived from the APP — `$APP`,
//      `${env:APP}`, `${{ matrix.app }}` — the coupling that caused the 404;
//   2. a variable-form call site whose STEP does not read the declaration, so
//      the variable could hold anything;
//   3. a literal-form call site whose literal is not the declared project — the
//      drift between the four derived lanes and the seven literal ones;
//   4. ZERO call sites found — a rewrite that renames the flag would otherwise
//      make this guard silently pass over nothing. [C-COVERAGE-LOST-IS-NOT-PASS]
//
// It does NOT assert which project is the right one. That is the live instance's
// answer, and `--live` asks it: with GLITCHTIP_TOKEN set it GETs the project and
// requires 200. CI does not pass --live — ci.yml's standing objection to a CI
// limb depending on the GlitchTip box stands — so the live check is a laptop and
// runbook step, and the offline invariant is the merge-blocking one.
//
// ── ⏱ APPENDED 2026-09-23 — 5. A GLITCHTIP NETWORK CALL RUN BARE FROM A STEP ──
// Row O-GLITCHTIP-CALLS-HAVE-NO-RETRY. deploy-web run 35831511489 went red on
//   error: Failed to create release: POST https://glitchtip.nikatru.com/api/0/organizations/nikatru/releases/ returned 522 <unknown status code>: error code: 522
// because `glitchtip-cli releases new` ran straight from the step, and the CLI
// has no retry. Every GlitchTip call now goes through a node script that uses
// tooling/ops/bounded-retry.mjs: create-glitchtip-release, upload-web-sourcemaps
// and upload-native-symbols. This limb keeps it that way. It refuses any `run:`
// shell segment, bash or pwsh, whose glitchtip-cli invocation names `releases`,
// `deploys` or `send-event`, or `debug-files` / `sourcemaps` / `dart-symbol-map`
// followed by `upload`; and any curl / wget / Invoke-RestMethod /
// Invoke-WebRequest segment on a GlitchTip `/api/0/` path. What stays in YAML is
// local: `sourcemaps inject` and the install step's `--version`.
//   · Built on tooling/ci/workflow-scan.mjs (parseWorkflow, stepShell,
//     shellSegments). A continued line is joined by the STEP'S shell's own
//     continuation character before it is split, so `…/glitchtip-cli \` on one
//     line and `releases new` on the next is one command, not two innocent ones.
//   · Zero `run:` steps read is COVERAGE LOST (exit 2), not a pass.
//   · ⚠️ It reads the program by NAME. A pwsh step that stores the path in a
//     variable (`$out = … 'glitchtip-cli.exe'`, then `& $out releases new`) is
//     invisible to it; no workflow does that today, and the Windows lane's
//     install step only asks `--version` that way.
// Failing cases: tooling/ci/test/glitchtip-project.test.mjs, "a GlitchTip network
// call run bare from a step is refused".
//
// Usage:
//   node tooling/ci/assert-glitchtip-project.mjs [--workflows <dir>] [--live]
// Exit 0 = one declared project, reached the same way everywhere.
// Exit 1 = it is not, and why. Exit 2 = a flag this guard does not know, or COVERAGE LOST: the
// declaration or the workflow tree could not be read, ZERO call sites, or --live could not ask
// (no GLITCHTIP_TOKEN, host unreachable, credential refused 401/403, server error). A 404 is a finding.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// why: `listDir`, never `readdirSync`. tooling/ci/assert-walks-bounded.mjs holds
// this for every guard, and the reason is measured: a bare listing descends into
// a nested checkout — a git worktree, a submodule, a stray clone — and reads
// another repository's workflows as this tree's. That is green in CI, which
// creates no worktrees, and red on the one machine actually looking at it.
import { listDir } from './tree-walk.mjs';
import { parseWorkflow, stepShell, shellSegments } from './workflow-scan.mjs';

const NAME = 'assert-glitchtip-project';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DECL_REL = 'tooling/ops/glitchtip-project.json';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--workflows', '--live', '--help', '-h']);
for (const a of argv) {
  if (a.startsWith('-') && !KNOWN.has(a)) {
    console.error(`${NAME}: unknown flag ${a}. Known: ${[...KNOWN].join(' ')}`);
    process.exit(2);
  }
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`usage: node ${'tooling/ci/assert-glitchtip-project.mjs'} [--workflows <dir>] [--live]`);
  process.exit(0);
}
const wIdx = argv.indexOf('--workflows');
const WORKFLOWS = wIdx === -1 ? join(REPO, '.github', 'workflows') : resolve(argv[wIdx + 1] ?? '');
const LIVE = argv.includes('--live');

const fail = (lines) => {
  console.error(`${NAME}: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

const declPath = join(REPO, ...DECL_REL.split('/'));
if (!existsSync(declPath)) {
  coverageLost([
    `COVERAGE LOST — ${DECL_REL} does not exist.`,
    'It is the one place the crash sink\'s project is written. Without it every call',
    'site below is an independent claim, which is the state that produced the 404.',
  ]);
}
let decl;
try {
  decl = JSON.parse(readFileSync(declPath, 'utf8'));
} catch (e) {
  coverageLost([`COVERAGE LOST — ${DECL_REL} is not valid JSON — ${e.message}`]);
}
const DECLARED = decl.project;
const DECLARED_ORG = decl.org;
if (typeof DECLARED !== 'string' || !DECLARED || typeof DECLARED_ORG !== 'string' || !DECLARED_ORG) {
  fail([`${DECL_REL} must carry non-empty string \`org\` and \`project\`.`]);
}

// 🔴 THE TOKEN GOES TO ONE HOST, PINNED HERE — CodeQL #293. `instance` is data in a
// register any PR can edit, and --live attaches GLITCHTIP_TOKEN to whatever base it
// resolves; reading the base from the register let an edit to that file decide where
// the next operator's token was sent. The register may still RECORD the instance, and
// this checks the record names the pinned host, offline too, so a PR that changes it
// is red in CI rather than live on someone's laptop. A different instance for one run
// is an operator's choice made in the environment (GLITCHTIP_URL), never a file edit.
const GLITCHTIP_HOST = 'glitchtip.nikatru.com';
if (decl.instance !== undefined) {
  let host = null;
  try {
    const u = new URL(String(decl.instance));
    host = u.protocol === 'https:' && u.username === '' && u.password === '' ? u.hostname : null;
  } catch {
    host = null;
  }
  if (host !== GLITCHTIP_HOST) {
    fail([
      `${DECL_REL} names instance ${JSON.stringify(decl.instance)}; the GlitchTip token is only ever sent to https://${GLITCHTIP_HOST}.`,
      'A different instance is an operator choice for one run: set GLITCHTIP_URL. It is not a register edit.',
    ]);
  }
}

if (!existsSync(WORKFLOWS)) {
  console.error(`${NAME}: COVERAGE LOST — no workflow directory at ${WORKFLOWS}`);
  coverageLost([]);
}

// A GlitchTip call site is `--project <x>` on a line that also carries
// `--org <y>`, or within three lines of one — the uploaders take one flag per
// continued line, so the two are not always adjacent.
// `--project-name=` is Cloudflare Pages and is NOT this; that value IS per-app
// and IS correctly derived, so the regex requires whitespace after `--project`.
const ORG_NEAR = /--org\s+\S/;
// why: the `${{ … }}` alternative comes FIRST and is not optional. A bare `\S+`
// stops at the space inside `${{ matrix.app }}` and captures `${{`, which is a
// variable but is not recognisably app-derived — so the exact expression this
// guard exists to refuse would have been graded by the weaker of its two rules.
// Caught by case R1b, which is why the alternative is written out rather than
// assumed away.
const PROJECT = /--project\s+("?\$\{\{[^}]*\}\}"?|\S+)/;
// Derived from the APP: the coupling that caused the outage. `$gt_project` and
// `$gt.project` are variables too, but they are graded by their step's read of
// the declaration, not refused outright — so this pattern names the app forms.
const APP_DERIVED = /(^|[^A-Za-z0-9_])(\$\{?APP\}?|\$\{env:APP\}|\$\{\{\s*matrix\.app\s*\}\})/;
const STEP_START = /^\s*-\s/;

const sites = [];
for (const f of listDir(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n)).sort()) {
  const lines = readFileSync(join(WORKFLOWS, f), 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = PROJECT.exec(lines[i]);
    if (!m) continue;
    const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
    if (!ORG_NEAR.test(near)) continue;
    // The enclosing step: back to the nearest `- ` at the start of a list item.
    let start = i;
    while (start > 0 && !STEP_START.test(lines[start])) start--;
    const step = lines.slice(start, i + 1).join('\n');
    sites.push({
      file: f,
      line: i + 1,
      raw: lines[i].trim(),
      arg: m[1].replace(/["'\\`]/g, ''),
      stepReadsDecl: step.includes(DECL_REL) || step.includes('glitchtip-project.json'),
    });
  }
}

if (sites.length === 0) {
  coverageLost([
    'COVERAGE LOST — found ZERO GlitchTip --project call sites in .github/workflows.',
    'On 2026-09-09 there were twelve. Zero means either every symbol and source-map',
    'upload has been deleted, or the flag was renamed and this guard has stopped',
    'guarding. Both are COVERAGE LOST, and neither is a pass.',
    `Looked in: ${WORKFLOWS}`,
  ]);
}

const appDerived = sites.filter((s) => APP_DERIVED.test(s.arg));
if (appDerived.length) {
  fail([
    `${appDerived.length} GlitchTip --project argument(s) are derived from the APP SLUG.`,
    'A GlitchTip project is a name on a remote server. A directory in this repository',
    'is not. Deriving the first from the second asserts they move together; on',
    `2026-09-09 they did not, and every upload took a 404. Read ${DECL_REL} instead.`,
    ...appDerived.map((s) => `${s.file}:${s.line}  ${s.raw}`),
  ]);
}

const isVariable = (a) => a.includes('$');
const badVariable = sites.filter((s) => isVariable(s.arg) && !s.stepReadsDecl);
if (badVariable.length) {
  fail([
    `${badVariable.length} call site(s) pass a VARIABLE whose step never reads ${DECL_REL}.`,
    'A variable that is not assigned from the declaration can hold anything, which is',
    'the same unchecked claim a literal was — with the checking made harder. Assign it',
    'in the same step, from that file.',
    ...badVariable.map((s) => `${s.file}:${s.line}  ${s.raw}`),
  ]);
}

const badLiteral = sites.filter((s) => !isVariable(s.arg) && s.arg !== DECLARED);
if (badLiteral.length) {
  fail([
    `${badLiteral.length} literal call site(s) do not name the declared project "${DECLARED}".`,
    `${DECL_REL} is the one declaration. A second spelling means one half of the`,
    'pipeline uploads into a project nobody reads, or into one that does not exist —',
    'which is exactly what happened when four lanes moved and seven did not.',
    ...badLiteral.map((s) => `${s.file}:${s.line}  --project ${s.arg}`),
  ]);
}

// ── 5. NO GLITCHTIP WRITE IS RUN BARE FROM A STEP (⏱ APPENDED 2026-09-23) ───
// The header section of the same date says why. Built on workflow-scan.mjs: its
// parse (comments blanked, a `run: |` block joined with ` ; `), its shell
// resolution and its segment splitter. `parseAllWorkflows` is not called because
// it takes a REPOSITORY root and appends .github/workflows, while `--workflows`
// names the directory itself (the fixtures in glitchtip-project.test.mjs are flat
// directories); `parseWorkflow` over this guard's own listing is the same parse.
const workflows = listDir(WORKFLOWS)
  .filter((n) => /\.ya?ml$/.test(n))
  .sort()
  .map((f) => parseWorkflow(WORKFLOWS, f))
  .filter(Boolean);
// The binary as the program of a segment: the token ENDS at `glitchtip-cli`
// (`.exe` on Windows), however it is prefixed — `${RUNNER_TEMP}/`, a quote, `& `.
// A URL that merely contains the name (`…/glitchtip-cli/-/jobs/…`) does not end there.
const CLI_TOKEN = /(?:^|[\s"'/\\&(])glitchtip-cli(?:\.exe)?["']?(?=\s|$)/;
// The subcommands that reach the server. `releases` whole, reads included: every
// GlitchTip call goes through a retrying script, not only the writes.
const NETWORK_SUBCOMMAND = new Set(['releases', 'deploys', 'send-event']);
const UPLOADING_SUBCOMMAND = new Set(['debug-files', 'sourcemaps', 'dart-symbol-map']);
const HTTP_CLIENT = /(?:^|\s)(?:curl|wget|Invoke-RestMethod|Invoke-WebRequest|irm|iwr)(?=\s|$)/i;
const RUN_KEY = /^\s*(?:-\s+)?run:\s*/;

const bareWrites = [];
let runLines = 0;
let cliSegments = 0;
for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    for (const l of job.logical) {
      if (!RUN_KEY.test(l.text)) continue;
      runLines++;
      // A continued line is ONE command. The continuation character is the SHELL's —
      // `\` for bash, a backtick for pwsh — so the step's shell is asked, not guessed.
      // A shell nobody can name joins both: seeing more can only refuse more.
      const { family } = stepShell(wf, l.n);
      const cont = family === 'pwsh' || family === 'powershell' ? /`\s*;\s/g : family === null ? /[\\`]\s*;\s/g : /\\\s*;\s/g;
      const text = l.text.replace(RUN_KEY, '').replace(cont, ' ');
      for (const raw of shellSegments(text)) {
        const seg = raw.trim();
        if (HTTP_CLIENT.test(seg) && seg.includes('/api/0/')) {
          bareWrites.push(`${wf.rel}:${l.n}  an HTTP client calls a GlitchTip /api/0/ path: ${seg.slice(0, 160)}`);
          continue;
        }
        const m = CLI_TOKEN.exec(seg);
        if (!m) continue;
        cliSegments++;
        const words = seg.slice(m.index + m[0].length).trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ''));
        const direct = words.find((w) => NETWORK_SUBCOMMAND.has(w));
        const up = words.findIndex((w) => UPLOADING_SUBCOMMAND.has(w));
        const uploads = up !== -1 && words.slice(up + 1).includes('upload');
        if (direct || uploads) {
          const sub = direct ?? `${words[up]} upload`;
          bareWrites.push(`${wf.rel}:${l.n}  glitchtip-cli ${sub}, run bare from the step: ${seg.slice(0, 160)}`);
        }
      }
    }
  }
}
if (runLines === 0) {
  coverageLost([
    `COVERAGE LOST — the write limb read ZERO \`run:\` steps in ${workflows.length} workflow(s).`,
    'Either the workflow parse stopped reaching the steps, or there are none; neither is a pass.',
    `Looked in: ${WORKFLOWS}`,
  ]);
}
if (bareWrites.length) {
  fail([
    `${bareWrites.length} GlitchTip network call(s) are run BARE from a workflow step, outside the retrying scripts.`,
    'glitchtip-cli has no retry, and one 522 from the origin failed deploy-web run 35831511489. A release',
    'is created by tooling/ops/create-glitchtip-release.mjs, source maps are uploaded by',
    'tooling/ops/upload-web-sourcemaps.mjs and native symbols by tooling/ops/upload-native-symbols.mjs,',
    'each through tooling/ops/bounded-retry.mjs. Only the local `sourcemaps inject` and `--version` stay in YAML.',
    ...bareWrites,
  ]);
}

const read = sites.filter((s) => isVariable(s.arg)).length;
console.log(
  `${NAME}: ${sites.length} call site(s) — ${read} read ${DECL_REL} in their own step, ` +
    `${sites.length - read} spell the declared project "${DECLARED}".`,
);
for (const s of sites) console.log(`  ${s.file}:${s.line}${isVariable(s.arg) ? '  (reads the declaration)' : ''}`);
console.log(
  `${NAME}: write limb — ${runLines} run step(s) in ${workflows.length} workflow(s), ${cliSegments} segment(s) naming glitchtip-cli; ` +
    'none runs a GlitchTip network call bare (releases, debug-files/sourcemaps upload, or an HTTP client on /api/0/).',
);

if (LIVE) {
  const token = process.env.GLITCHTIP_TOKEN;
  if (!token) {
    console.error(`${NAME}: COVERAGE LOST — --live needs GLITCHTIP_TOKEN in the environment. Refusing to report a pass it did not make.`);
    coverageLost([]);
  }
  const base = (process.env.GLITCHTIP_URL ?? `https://${GLITCHTIP_HOST}`).replace(/\/+$/, '');
  const url = `${base}/api/0/projects/${DECLARED_ORG}/${DECLARED}/`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch (e) {
    console.error(`${NAME}: COVERAGE LOST — could not reach ${base} — ${e.message}`);
    coverageLost([]);
  }
  if (res.status === 401 || res.status === 403 || res.status >= 500) {
    coverageLost([
      `COVERAGE LOST — the live instance answers ${res.status}: it ${res.status >= 500 ? "could not answer" : "refused the credential"}, so whether project "${DECLARED}" exists was never asked.`,
      `GET ${url}`,
    ]);
  }
  if (res.status !== 200) {
    fail([
      `the live instance answers ${res.status} for project "${DECLARED}".`,
      `GET ${url}`,
      'The declaration and the server disagree, which is the exact 2026-09-09 failure.',
      'Rename the project on GlitchTip, or correct the declaration — but not by guessing',
      'which of the two is behind.',
    ]);
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    coverageLost([`COVERAGE LOST — the live instance answered 200 with a body that is not JSON (${e.message}).`]);
  }
  console.log(`${NAME}: live check OK — "${body.slug}" (id ${body.id}) exists on ${base}.`);
}

/** The COVERAGE LOST stop: this run could not see what it must judge — the declaration, the
 *  workflow tree, any call site at all, or (--live) the instance itself, for want of a token, a
 *  route or a credential it accepts. Exit 2, never 1, which would read as a finding, and never 0
 *  (AGENTS.md exit-code convention, O-EXIT2-CONVENTION-GAP). Hoisted, so it is callable above. */
function coverageLost(lines) {
  if (lines.length) console.error(`${NAME}: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}
