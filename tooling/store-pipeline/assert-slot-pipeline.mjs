#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-slot-pipeline.mjs — THE GUARD OVER THE TEMPLATE ITSELF.
//
// The pipeline template is one file installed in fifteen repositories. Two
// things can go wrong with that shape and only one of them is obvious:
//   · the OBVIOUS one — a slot edits its installed copy and drifts;
//   · the SILENT one — the gates that stop a normal push from reaching a store
//     are deleted, in one repository, and everything still goes green, because
//     a deleted gate has no failing test of its own.
// This guard exists for the second one. Every check below names the failure it
// prevents, and every one of them has been made able to fail — see the mutation
// log in tooling/store-pipeline/README.md.
//
// ── WHAT IT CHECKS ──────────────────────────────────────────────────────────
//  1. TABLES AGREE WITH THE REGISTER, BOTH DIRECTIONS. artifact-build.mjs's
//     format table and slot-signing.mjs's seam table must each be exactly the
//     set tooling/channel-register.json declares. A channel or format added to
//     the register with no entry here would otherwise resolve to `undefined`
//     and take the "nothing to do" path — silently, in the one direction that
//     reports clean.
//  2. DECLARED SCRIPTS EXIST. A seam naming a script that was deleted is a
//     signing step nobody runs.
//  3. EVERY SLOT TARGET RESOLVES UNAMBIGUOUSLY. Two submittable channels for
//     one target means "the store for this slot" has two answers, and no
//     pipeline may pick one.
//  4. TARGETS WITH NO CHANNEL ARE DECLARED, WITH A REASON, AND ONLY THOSE. A
//     bare allow-list is a place to silence findings; a list where every line
//     must say what it is for is a list somebody has to defend. Stale entries
//     fail in the same direction — deleting a line needs nobody's permission.
//  5. THE BUILD TEMPLATE CANNOT REACH A STORE. No `--submit`, no `secrets.`
//     reference of any kind, in any job. This is the check that keeps "nothing
//     that could publish to a real store without an explicit deliberate
//     trigger" true rather than merely intended.
//  6. THE BUILD TEMPLATE CANNOT GO VACUOUSLY GREEN. Both the `build` job and
//     the `no-product` job must exist and their conditions must be exact
//     complements. Deleting the second one to tidy the run list restores the
//     silent green, so deleting it fails here instead.
//  7. THE SUBMIT TEMPLATE'S FOUR GATES ARE INTACT: dispatch-only trigger, a
//     confirmation whose default does not confirm, a submitting job with BOTH
//     `environment:` and an `if:` on that confirmation, `needs` on the dry run,
//     and a signature check that runs BEFORE the submit step in the same job.
//  8. EVERY SECRET NAMED IN THE SUBMIT TEMPLATE IS INSIDE THE PER-SLOT MARKERS
//     AND IS DECLARED FOR THIS SLOT'S CHANNEL. A slot cannot carry another
//     store's credentials, and a name nobody declared fails.
//  9. NO SECRET VALUE IS IN ANY FILE OF THIS TEMPLATE. Indirections only.
// 10. THE INSTALLED COPY IS THE TEMPLATE. Byte-identical for the build
//     workflow; identical outside the per-slot markers for the submit workflow.
//
// ── THE TWO ABSENCES, ANSWERED DIFFERENTLY ──────────────────────────────────
// 🔴 A subject absent because THIS CHECKOUT IS THE ORIGIN AND HAS NOT INSTALLED
// THE TEMPLATE, and a subject absent because SOMEBODY DELETED THE INSTALLED
// WORKFLOW, must never be answered by the same test.
//   · installed copies absent, no flag     -> REFUSE, exit 2.
//   · `--template-only` DECLARED           -> check 10 does not run, the number
//     of assertions NOT made is printed, and the run says so in capitals.
//   · `--template-only` declared AND the copies are actually installed
//                                          -> REFUSE, exit 2. The declaration is
//     self-policing: a waiver that outlives its reason is how a guard dies.
//
// Usage:  node tooling/store-pipeline/assert-slot-pipeline.mjs [--template-only]
//                                                              [--root <dir>]
// Exit:   0 = the template is intact and its tables agree with the register
//         1 = findings (each named)
//         2 = COVERAGE LOST — a subject this guard claims to check was absent
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ARTIFACT_BUILD, registerFormats } from './artifact-build.mjs';
import { SIGNING_SEAMS } from './signing-seams.mjs';

const ARGV = process.argv.slice(2);
const has = (n) => ARGV.includes(n);
const val = (n) => {
  const i = ARGV.indexOf(n);
  return i >= 0 && i + 1 < ARGV.length ? ARGV[i + 1] : null;
};
const TEMPLATE_ONLY = has('--template-only');

const findings = [];
const fail = (line, ...detail) => findings.push([line, ...detail]);
let notMade = 0;

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

const SELF = fileURLToPath(import.meta.url);
const DIR = dirname(SELF);
const ROOT = val('--root') ? resolve(val('--root')) : resolve(DIR, '..', '..');
const REL = 'tooling/store-pipeline';

const MATRIX_REL = 'catalog/store-matrix.json';
const CHANNELS_REL = 'tooling/channel-register.json';

for (const rel of [MATRIX_REL, CHANNELS_REL]) {
  if (!existsSync(join(ROOT, rel))) coverageLost([`${rel} is not in this checkout`, `root: ${ROOT}`, 'This guard checks the template AGAINST the registers. Without them it', 'would be comparing the template to nothing and reporting agreement.']);
}
const matrix = JSON.parse(readFileSync(join(ROOT, MATRIX_REL), 'utf8'));
const register = JSON.parse(readFileSync(join(ROOT, CHANNELS_REL), 'utf8'));

if (!matrix.slots?.length) coverageLost([`${MATRIX_REL} declares no slots`, 'Every per-slot assertion below would pass vacuously over zero rows.']);
if (!register.channels?.length) coverageLost([`${CHANNELS_REL} declares no channels`, 'Same floor, same reason.']);

const BUILD_TPL = `${REL}/slot-build.yml`;
const SUBMIT_TPL = `${REL}/slot-submit.yml`;
for (const rel of [BUILD_TPL, SUBMIT_TPL, `${REL}/resolve-slot.mjs`, `${REL}/slot-signing.mjs`, `${REL}/artifact-build.mjs`]) {
  if (!existsSync(join(ROOT, rel))) coverageLost([`${rel} is missing`, 'The template is not all here, so what this guard would check is not all here.']);
}
const buildTpl = readFileSync(join(ROOT, BUILD_TPL), 'utf8');
const submitTpl = readFileSync(join(ROOT, SUBMIT_TPL), 'utf8');

// ── 1 · TABLES AGREE WITH THE REGISTER, BOTH DIRECTIONS ─────────────────────
const formats = registerFormats(register);
for (const f of formats) if (!(f in ARTIFACT_BUILD)) fail(`artifact format "${f}" is declared in ${CHANNELS_REL} and has NO entry in ${REL}/artifact-build.mjs`, 'A slot for that channel would resolve to no build verb and build nothing.');
for (const k of Object.keys(ARTIFACT_BUILD)) if (!formats.has(k)) fail(`${REL}/artifact-build.mjs declares format "${k}" and no channel in ${CHANNELS_REL} names it`, 'A stale key. Deleting a line needs nobody\'s permission, so this fails rather than prints.');

const channelIds = new Set(register.channels.map((c) => c.id));
for (const id of channelIds) if (!(id in SIGNING_SEAMS)) fail(`channel "${id}" is in ${CHANNELS_REL} and has NO entry in SIGNING_SEAMS`, 'It would resolve to undefined and take the "nothing to do" path silently.');
for (const id of Object.keys(SIGNING_SEAMS)) if (!channelIds.has(id)) fail(`SIGNING_SEAMS declares channel "${id}" and ${CHANNELS_REL} has no such channel`);

// ── 2 · DECLARED SCRIPTS EXIST ──────────────────────────────────────────────
for (const [id, seam] of Object.entries(SIGNING_SEAMS)) {
  if (!seam.why || seam.why.length < 20) fail(`SIGNING_SEAMS["${id}"] has no written reason`, 'A null with no reason is an omission wearing a declaration\'s clothes.');
  for (const mode of ['prepare', 'verify']) {
    const s = seam[mode];
    if (s && !existsSync(join(ROOT, s))) fail(`SIGNING_SEAMS["${id}"].${mode} names ${s} and it is not in this checkout`);
  }
}

// ── 3 & 4 · CHANNEL COVERAGE OF THE MATRIX, BOTH DIRECTIONS ─────────────────
/** Slot targets that tooling/channel-register.json does not cover AT ALL, each
 *  with the reason it is absent rather than broken. Every entry must really
 *  derive zero candidate channels, and every target that derives zero must be
 *  here — checked both ways below. */
const UNCOVERED_TARGETS = {
  Chrome: 'The Chrome Web Store extension lives in the Nikatru_Chrome_Extensions_{Public,Private} repository pair. CORRECTED 2026-08-19: this used to read "outside the store tree entirely" and that is no longer true — the pair now sits INSIDE the store tree at Projects/Chrome_Web_Store/Chrome/Extensions/Nikatru_Chrome_Extensions_{Public,Private}, moved and renamed by the Store x Platform x Type reorg (REPOINTED 2026-08-19 EVENING: this parenthesis read "the GitHub repos kept their old names" and that stopped being true hours later - all five repos were renamed on GitHub too, so directory name and remote name AGREE again. Verified with `gh repo list`; `gh api repos/<owner>/<old-name>` returns 200 via the rename redirect and is a false positive). It is still outside THIS repository, which is what makes the target uncovered here, and tooling/channel-register.json has never described a browser-extension channel. catalog/store-matrix.json backing.products[fullshot] records the slot as shell-claimed for exactly this reason: the product exists and is not filed here. Whether one repo becomes three is STORE-MATRIX-PLAN.md section 5.2 and it is OPEN.',
  Edge: 'Same product, same repository pair, same open decision. Edge Add-ons is a second submission target of the one FullShot extension.',
  Firefox: 'Same product and same open decision, plus the one that makes guessing expensive: the AMO gecko.id in identity.json is fixed PERMANENTLY at first signing. No lane is invented for this target, and that restraint is the point.',
};

const targets = [...new Set(matrix.slots.map((s) => s.target))];
const lower = (x) => String(x).toLowerCase();
const uncoveredSeen = new Set();
for (const t of targets) {
  const candidates = register.channels.filter((ch) => (ch.platforms ?? []).map(lower).includes(lower(t)));
  const submittable = candidates.filter((ch) => ch.submittable === true);
  if (candidates.length === 0) {
    uncoveredSeen.add(t);
    if (!UNCOVERED_TARGETS[t]) fail(`slot target "${t}" has NO channel in ${CHANNELS_REL} and is not declared in UNCOVERED_TARGETS`, 'An undeclared gap is a gap nobody has had to defend.');
  }
  if (submittable.length > 1) fail(`slot target "${t}" has ${submittable.length} submittable channels (${submittable.map((c) => c.id).join(', ')})`, '"The store for this slot" has two answers and no pipeline may pick one.');
}
for (const t of Object.keys(UNCOVERED_TARGETS)) {
  if (!targets.includes(t)) fail(`UNCOVERED_TARGETS declares "${t}" and no slot in ${MATRIX_REL} has that target`);
  else if (!uncoveredSeen.has(t)) fail(`UNCOVERED_TARGETS declares "${t}" as uncovered and ${CHANNELS_REL} now covers it`, 'Good news that went stale. Delete the entry.');
}

// ── the shared workflow parser. Not re-implemented here, on purpose. ────────
const PARSER_REL = 'tooling/ci/workflow-scan.mjs';
if (!existsSync(join(ROOT, PARSER_REL))) {
  coverageLost([
    `${PARSER_REL} is missing, so the templates cannot be parsed`,
    'This guard deliberately carries no workflow parser of its own.',
    'tooling/ci/assert-guard-coverage.mjs records what four copies of one cost:',
    'they drift in the one way that reports clean — WHICH LINES THEY CAN SEE.',
  ]);
}
const { parseWorkflow } = await import(`file://${join(ROOT, PARSER_REL).replace(/\\/g, '/')}`);
const buildWf = parseWorkflow(ROOT, BUILD_TPL);
const submitWf = parseWorkflow(ROOT, SUBMIT_TPL);
if (!buildWf || !submitWf) coverageLost(['a template parsed to nothing', 'The parser reached the file and found no structure; every check below would range over an empty job map.']);
if (buildWf.jobs.size === 0 || submitWf.jobs.size === 0) coverageLost([`a template parsed to ZERO jobs (build=${buildWf.jobs.size}, submit=${submitWf.jobs.size})`, 'Every per-job assertion below would pass over nothing.']);

// ── 5 · THE BUILD TEMPLATE CANNOT REACH A STORE ─────────────────────────────
// 🔴 SCANNED OVER THE PARSED, COMMENT-STRIPPED LINES, NEVER THE RAW FILE. This
// repository's own rule — "assert on parsed structure, never by grepping prose"
// — was learned when a `grep '"r2_buckets"'` matched the comment explaining why
// there is no r2_buckets. Both templates DISCUSS `--submit` and `secrets.` in
// their headers, at length and on purpose, so a raw scan reports the
// documentation as the defect and the real thing goes unexamined behind it.
// Proven here: the first run of this guard raised three findings, all of them
// its own prose.
const codeOf = (wf) => wf.lines.map((l) => l.text).join('\n');
const buildCode = codeOf(buildWf);
const submitCode = codeOf(submitWf);
if (buildCode.length < 200) coverageLost([`${BUILD_TPL} reduced to ${buildCode.length} characters of non-comment text`, 'A file that is almost all comment to this parser is a file every check below', 'ranges over nothing.']);

if (/--submit\b/.test(buildCode)) fail(`${BUILD_TPL} RUNS \`--submit\``, 'The build lane runs on every push. Nothing on that trigger may reach a store.');
{
  const refs = [...buildCode.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  if (refs.length) fail(`${BUILD_TPL} references ${refs.length} secret(s): ${[...new Set(refs)].join(', ')}`, 'The build template holds no credentials by design: a lane that runs on every', 'push and can authenticate to a store is a one-way door left ajar.');
}

// ── 6 · THE BUILD TEMPLATE CANNOT GO VACUOUSLY GREEN ────────────────────────
const buildJob = buildWf.jobs.get('build');
const noProductJob = buildWf.jobs.get('no-product');
if (!buildJob) fail(`${BUILD_TPL} has no \`build\` job`);
if (!noProductJob) {
  fail(`${BUILD_TPL} has no \`no-product\` job`, 'Without it an empty slot skips the build job and the workflow shows a green', 'tick — the exact shape of a check that has stopped checking.');
} else if (buildJob) {
  const a = buildJob.jobIf?.cond ?? '';
  const b = noProductJob.jobIf?.cond ?? '';
  const want = "needs.slot.outputs.productState == 'present'";
  const wantNot = "needs.slot.outputs.productState != 'present'";
  if (a !== want) fail(`${BUILD_TPL} job \`build\` has if: ${a || '(none)'} — expected ${want}`);
  if (b !== wantNot) fail(`${BUILD_TPL} job \`no-product\` has if: ${b || '(none)'} — expected ${wantNot}`, 'The two conditions must be exact complements, or some product state falls', 'through both jobs and the run is green having done nothing.');
}

// ── 7 · THE SUBMIT TEMPLATE'S GATES ─────────────────────────────────────────
{
  const onBlock = submitCode.split(/\npermissions:/)[0].split(/\non:\s*\n/)[1] ?? '';
  const triggers = [...onBlock.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  if (triggers.length !== 1 || triggers[0] !== 'workflow_dispatch') {
    fail(`${SUBMIT_TPL} triggers on ${triggers.join(', ') || '(none parsed)'} — must be workflow_dispatch and nothing else`, 'Anything that fires by itself can reach a one-way door.');
  }
  const def = submitTpl.match(/^\s*default:\s*'([^']*)'/m);
  if (!def) fail(`${SUBMIT_TPL} declares no default for the confirm input`);
  else if (/^SUBMIT-/.test(def[1])) fail(`${SUBMIT_TPL}'s confirm input defaults to "${def[1]}", which CONFIRMS`, 'A dispatch left at its default is the most likely dispatch there is.');

  const submitJobs = [...submitWf.jobs.values()].filter((j) => j.logical.some((l) => /--submit\b/.test(l.text)));
  if (submitJobs.length === 0) {
    coverageLost([
      `${SUBMIT_TPL} has no job running \`--submit\``,
      'Every gate check below would range over nothing and report intact gates',
      'on a workflow that has no gated step at all.',
    ]);
  }
  for (const j of submitJobs) {
    const body = j.lines.map((l) => l.text).join('\n');
    if (!/^ {4}environment:\s*\S/m.test(body)) fail(`${SUBMIT_TPL} job \`${j.name}\` runs --submit with NO \`environment:\``, 'That is the reviewer gate. Without it the job starts the moment it is dispatched.');
    if (!j.jobIf || !/inputs\.confirm/.test(j.jobIf.cond)) fail(`${SUBMIT_TPL} job \`${j.name}\` runs --submit with no \`if:\` on inputs.confirm`, 'That is the typed confirmation. Without it the dispatch alone submits.');
    if (!j.needs.includes('dry-run')) fail(`${SUBMIT_TPL} job \`${j.name}\` does not \`needs: dry-run\``, 'The path must be proven to walk on THIS commit before anything is uploaded.');
    const verifyAt = j.logical.findIndex((l) => /slot-signing\.mjs --verify/.test(l.text));
    const submitAt = j.logical.findIndex((l) => /--submit\b/.test(l.text));
    if (verifyAt === -1) fail(`${SUBMIT_TPL} job \`${j.name}\` submits without reading the artifact's signature first`, 'Stores bind the signing certificate at the first submission and never accept', 'another. A signature nobody read is a one-way door taken blind.');
    else if (verifyAt > submitAt) fail(`${SUBMIT_TPL} job \`${j.name}\` reads the signature AFTER submitting`);
  }
}

// ── 8 · SECRETS IN THE SUBMIT TEMPLATE ──────────────────────────────────────
{
  // The markers ARE comments, so they are located in the raw file by LINE
  // NUMBER, and the secret references are then found in the parsed lines and
  // compared by line number. Mixing the two coordinate systems is the only way
  // to bound a comment-delimited region without scanning prose for `secrets.`.
  const rawLines = submitTpl.split('\n');
  const beginLine = rawLines.findIndex((l) => l.includes('PER-SLOT BLOCK BEGIN')) + 1;
  const endLine = rawLines.findIndex((l) => l.includes('PER-SLOT BLOCK END')) + 1;
  if (beginLine === 0 || endLine === 0 || endLine < beginLine) {
    fail(`${SUBMIT_TPL} has no PER-SLOT BLOCK BEGIN/END markers`, 'The markers are what bound the one editable region. Without them every line', 'is editable and nothing can tell a slot-local change from a template change.');
  } else {
    for (const l of submitWf.lines) {
      for (const m of l.text.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (l.n < beginLine || l.n > endLine) fail(`${SUBMIT_TPL}:${l.n} references secrets.${m[1]} OUTSIDE the per-slot markers (lines ${beginLine}–${endLine})`, 'Credentials outside the marked block are credentials the next re-copy silently reverts.');
      }
    }
  }

  // The names must be the ones the register declares FOR THIS SLOT'S CHANNEL.
  let plan = null;
  try {
    plan = JSON.parse(execFileSync(process.execPath, [join(ROOT, REL, 'resolve-slot.mjs'), '--json'], { encoding: 'utf8', cwd: ROOT }));
  } catch (e) {
    const outText = String(e.stdout ?? '');
    try { plan = JSON.parse(outText); } catch { plan = null; }
  }
  if (!plan) {
    notMade++;
    console.log('⚠️  NOT CHECKED: the secret names could not be held to a channel, because');
    console.log('    resolve-slot.mjs did not produce a plan for this checkout. That is a');
    console.log('    real hole in this run, printed rather than passed over.');
  } else {
    const ch = register.channels.find((c) => c.id === plan.storeChannel) ?? null;
    const allowed = new Set([
      ...(ch?.signing?.ciSecrets?.names ?? []),
      ...Object.keys(register.ciSecretRegister?.nonSigning ?? {}),
      ...(register.ciSecretRegister?.nonSigning ?? []).map?.((x) => x?.name).filter(Boolean) ?? [],
    ]);
    for (const m of new Set([...submitCode.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))) {
      if (!allowed.has(m)) fail(`${SUBMIT_TPL} names secrets.${m}, which ${CHANNELS_REL} does not declare for channel "${plan.storeChannel}"`, 'Either this slot is carrying another store\'s credentials, or a name was', 'invented. Both are the same failure at the store.');
    }
  }
}

// ── 9 · NO SECRET VALUES ANYWHERE IN THE TEMPLATE ───────────────────────────
{
  const files = ['README.md', 'slot-build.yml', 'slot-submit.yml', 'resolve-slot.mjs', 'slot-signing.mjs', 'artifact-build.mjs', 'assert-slot-pipeline.mjs'];
  let scanned = 0;
  for (const f of files) {
    const abs = join(ROOT, REL, f);
    if (!existsSync(abs)) continue;
    scanned++;
    const text = readFileSync(abs, 'utf8');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) fail(`${REL}/${f} contains a PEM private key block`);
    if (/\bghp_[A-Za-z0-9]{20,}/.test(text)) fail(`${REL}/${f} contains what looks like a GitHub token`);
    if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) fail(`${REL}/${f} contains what looks like an AWS access key id`);
    // A long unbroken base64 run is how a keystore travels. Prose and code here
    // never produce one; a 120-char run is far past anything either does.
    for (const line of text.split('\n')) {
      const m = line.match(/[A-Za-z0-9+/]{120,}={0,2}/);
      if (m) fail(`${REL}/${f} contains a ${m[0].length}-character base64-looking run`, 'That is the shape a keystore or credential blob travels in.');
    }
  }
  if (scanned < 5) coverageLost([`the secret-value scan reached only ${scanned} template file(s)`, 'A scan that reaches almost nothing reports clean for the same reason an', 'empty directory does.']);
}

// ── 10 · THE INSTALLED COPY IS THE TEMPLATE ─────────────────────────────────
const installed = [
  { tpl: BUILD_TPL, inst: '.github/workflows/slot-build.yml', exact: true },
  { tpl: SUBMIT_TPL, inst: '.github/workflows/slot-submit.yml', exact: false },
];
const present = installed.filter((p) => existsSync(join(ROOT, p.inst)));

if (present.length === 0 && !TEMPLATE_ONLY) {
  coverageLost([
    'neither slot workflow is installed under .github/workflows, and --template-only was not declared',
    ...installed.map((p) => `  absent: ${p.inst}`),
    '',
    'REFUSING rather than passing. Two different absences hide behind this one',
    'symptom and they must not share an answer:',
    '  · this checkout is the ORIGIN and has not installed the template — normal,',
    '    and what --template-only declares;',
    '  · a slot repository DELETED its installed workflow — the failure this',
    '    guard exists for.',
    'Passing here would report the second as the first, forever.',
  ]);
}
if (present.length > 0 && TEMPLATE_ONLY) {
  coverageLost([
    '--template-only was declared and the workflows ARE installed',
    ...present.map((p) => `  present: ${p.inst}`),
    'The declaration is self-policing: the day the subject becomes reachable',
    'where the waiver is passed, the waiver fails instead of suppressing the',
    'check forever. Drop the flag.',
  ]);
}

const stripPerSlot = (text) => {
  const b = text.indexOf('PER-SLOT BLOCK BEGIN');
  const e = text.indexOf('PER-SLOT BLOCK END');
  if (b === -1 || e === -1 || e < b) return text;
  return text.slice(0, b) + text.slice(e);
};

if (TEMPLATE_ONLY) {
  notMade += installed.length;
  console.log('⚠️  --template-only DECLARED. THE INSTALLED-COPY CHECK DID NOT RUN.');
  for (const p of installed) console.log(`    not compared: ${p.inst}  <-  ${p.tpl}`);
} else {
  for (const p of installed) {
    const abs = join(ROOT, p.inst);
    if (!existsSync(abs)) {
      fail(`${p.inst} is not installed and its sibling is`, 'A slot runs both or neither; half an installation is a gate that is present', 'in one workflow and absent in the other.');
      continue;
    }
    const a = readFileSync(join(ROOT, p.tpl), 'utf8');
    const b = readFileSync(abs, 'utf8');
    const same = p.exact ? a === b : stripPerSlot(a) === stripPerSlot(b);
    if (!same) fail(`${p.inst} differs from ${p.tpl}${p.exact ? '' : ' outside the per-slot markers'}`, 'catalog/copy-origins.json classifies .github/workflows/** as per-slot, so', 'assert-copy-parity.mjs never compares these ACROSS slots. This within-repo', 'comparison is the only thing standing against fifteen silent divergences.');
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('');
console.log(`checked: ${formats.size} artifact format(s), ${channelIds.size} channel(s), ${targets.length} slot target(s), ${matrix.slots.length} slot row(s), 2 template workflow(s)`);
if (notMade) console.log(`⚠️  ${notMade} assertion group(s) were NOT made in this run. Silence is not success.`);

if (findings.length) {
  console.error('');
  console.error(`✗ ${findings.length} finding(s):`);
  for (const f of findings) {
    console.error(`  · ${f[0]}`);
    for (const d of f.slice(1)) console.error(`      ${d}`);
  }
  process.exit(1);
}
console.log('✓ the slot pipeline template is intact and its tables agree with the register');
process.exit(0);
