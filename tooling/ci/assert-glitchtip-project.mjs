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

const read = sites.filter((s) => isVariable(s.arg)).length;
console.log(
  `${NAME}: ${sites.length} call site(s) — ${read} read ${DECL_REL} in their own step, ` +
    `${sites.length - read} spell the declared project "${DECLARED}".`,
);
for (const s of sites) console.log(`  ${s.file}:${s.line}${isVariable(s.arg) ? '  (reads the declaration)' : ''}`);

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
