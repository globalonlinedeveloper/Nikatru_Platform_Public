#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-release-lane-generic.mjs — the release lane set is a RELATIONSHIP, not
// a string ban.
//
// [pipeline 9]R-1 "One generic release lane builds any app: adding an app
//                 requires no new or edited workflow file."
//
// ── WHY THE CRITERION R-1 SHIPPED WITH COULD NOT WORK ────────────────────────
// It read: *fail if any release workflow contains a hard-coded app path
// (`apps/<id>`) outside a `workflow_call` input default.* That is a rule about a
// STRING, and a rule about a string is satisfied by MOVING the string. Hoisting
// the same literal into `env: APP: apps/subly` and writing
// `working-directory: ${{ env.APP }}` passes it exactly — one app, one file,
// guard green, nothing generic. So this guard resolves the reference instead of
// banning it: `${{ env.X }}` and `${{ matrix.X }}` are EXPANDED before anything
// is counted, and the answer is compared to the workspace.
//
// It also had a BLIND SPOT that mattered more than the bypass. It scanned
// workflows only — and a GUARD can hardcode a lane just as fatally. One did:
// assert-seams-wired.mjs carried `const DEPLOY = 'deploy-web.yml'`, so the
// crash-sink assertion was bound to the WEB lane while build-platforms.yml built
// all six platforms with zero `--dart-define`s. Two artifact lanes, no crash
// sink, guard green. (That specific case was repaired on 2026-08-02 by deriving
// the lane set from tooling/channel-register.json; limb B below is what stops
// the NEXT one, and re-introducing that one line is its recorded failing case.)
//
// ── THE THREE LIMBS ──────────────────────────────────────────────────────────
// LIMB A — EQUALITY, not "resolves to exactly one app". With exactly one app in
//   the workspace those two are indistinguishable, so the doc's original form
//   would have demanded a matrix refactor of two workflows on day one to satisfy
//   an assertion that proves nothing. Equality has the same failing input — app
//   #2 — without that cost, and it goes red on the day the requirement stops
//   being theoretical. The app set is DERIVED from the root pubspec `workspace:`
//   list, which already exists, is already maintained, and is already policed by
//   assert-workspace-coverage.mjs. Never from a list inside this guard.
//
// LIMB A′ — THE PARAMETER MUST BE REAL, added 2026-08-06 with the matrix
//   refactor that made limb A's "parameterised" branch reachable for the first
//   time. Two ways to satisfy limb A while shipping a broken lane, and both are
//   now failures:
//
//     · A MIXED lane. `parameterised` short-circuited the equality check, so ONE
//       `apps/${{ matrix.app }}` anywhere in the file excused every remaining
//       `working-directory: apps/subly` beside it. That lane builds app #2's web
//       bundle out of app #1's directory. A lane is generic when EVERY app path
//       is parameterised, so a resolved literal alongside a dynamic one fails.
//
//     · A MATRIX KEY NOBODY DECLARED. `apps/${{ matrix.app }}` in a job with no
//       `strategy.matrix.app` expands to the empty string at run time — GitHub
//       does not error, it builds `apps/` — and this guard could not tell that
//       from a real matrix, because both are simply unresolvable here. So the
//       key a lane's app path names must be DECLARED in a `matrix:` block in the
//       same file. The declaration's VALUE may be dynamic (`${{ fromJSON(...) }}`
//       is the correct shape and is what the real lanes use); what cannot be
//       missing is the key. This is the stand-in check: without it the guard
//       would be measuring a placeholder and reporting a property.
//
//   ⚠️ WHAT THIS STILL CANNOT SEE, stated rather than implied: when the matrix
//   value is `${{ fromJSON(needs.prepare.outputs.apps) }}`, whether that job
//   really emits the workspace app set is a RUN-TIME fact. The mitigation is
//   that `--emit-apps` below is the emitter, so the lane's matrix and this
//   guard's expected set are produced by ONE function in ONE file — a lane
//   cannot drift from the workspace without this guard's own reading drifting
//   with it. It is a shared implementation, not an assertion, and it is the
//   honest ceiling.
//
// LIMB B — a guard that names ONE workflow as its only lane must SAY SO, in its
//   own file, with a reason. The declaration lives in the bound guard rather
//   than in a map here on purpose: a central exemption list is read by the
//   person maintaining the list and by nobody else, so the author of the NEXT
//   lane-bound guard would never see it. `// LANE-BOUND: <file.yml> — <why>` in
//   the guard's own header is in front of the only person who can fix it.
//
// ── WHAT IS DELIBERATELY NOT ASSERTED ────────────────────────────────────────
// The workflows R-1 owns are `build-platforms.yml` and `e2e.yml` — named by
// company/pipeline/09-release-engineering.md, reconciliation PART 6. The WEB
// deploy lane's genericity belongs to `[10]D-2b`, and per-channel refactors stay
// with their channel owners. Every OTHER workflow is still resolved and its app
// set PRINTED every run, so a divergence is visible without this guard failing
// a build over another stage's work.
//
// ⚠️ THE HONEST LIMIT, stated rather than papered over: limb B's subject is a
// guard that binds EXACTLY ONE lane, so a guard could buy silence by naming a
// second workflow it does not really use. That literal would be dead code, and
// the stale-declaration check below is the other half of the same pincer — but
// it is not closed, and pretending otherwise would be the "assertion that cannot
// fail" this repo keeps deleting.
//
// Usage:  node tooling/ci/assert-release-lane-generic.mjs [repoRoot]
//         node tooling/ci/assert-release-lane-generic.mjs --emit-apps [repoRoot]
// Exit 0 = every R-1 lane covers the whole workspace and no guard hides a lane.
//
// `--emit-apps` prints the workspace app IDS as a JSON array (`["subly"]`) and
// exits. THIS IS NOT A CONVENIENCE. `build-platforms.yml` and `e2e.yml` build
// their `strategy.matrix.app` from this output, so the set a lane iterates and
// the set this guard grades it against come from the SAME `workspaceApps()`
// call. The alternative — a second pubspec reader inlined in each workflow — is
// three implementations of one parse, and this repository's most repeated
// failure is the copy that quietly stops reading what it thinks it reads.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { parseAllWorkflows, WORKFLOW_DIR } from './workflow-scan.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const argv = process.argv.slice(2);
const EMIT_APPS = argv[0] === '--emit-apps';
const ROOT_ARG = EMIT_APPS ? argv[1] : argv[0];
const ROOT = resolve(ROOT_ARG ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CI_DIR = join(ROOT, 'tooling', 'ci');
const GATE_SCRIPT = 'tooling/ci/assert-gate-passed.mjs';

// ── the emitter the release lanes' matrix is built from ──────────────────────
// Deliberately BEFORE every coverage floor below: this mode answers one question
// ("which apps does the workspace declare") and must not be able to fail because
// an unrelated limb lost its corpus. It fails LOUDLY on an empty answer, because
// an empty matrix is a workflow that runs zero jobs and reports success — the
// green-over-nothing shape this whole file exists to remove.
if (EMIT_APPS) {
  const found = workspaceApps(ROOT);
  if (found === null || found.length === 0) {
    console.error(`FAIL --emit-apps: ${join(ROOT, 'pubspec.yaml')} declares no \`workspace:\` entry under apps/.`);
    console.error('     A release lane whose matrix is [] runs no build and reports green. Refusing to emit one.');
    process.exit(1);
  }
  const ids = found.map((a) => a.slice('apps/'.length));
  const nested = ids.filter((id) => id.includes('/'));
  if (nested.length) {
    console.error(`FAIL --emit-apps: workspace entr${nested.length === 1 ? 'y' : 'ies'} ${nested.join(', ')} nest below apps/<id>.`);
    console.error('     The lanes address an app as `apps/${{ matrix.app }}`, which a nested path cannot round-trip.');
    process.exit(1);
  }
  console.log(JSON.stringify(ids));
  process.exit(0);
}

const problems = [];
const ok = (m) => console.log(`ok   ${m}`);
const note = (m) => console.log(`--   ${m}`);
const fail = (m) => problems.push(m);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-release-lane-generic: FAILED');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// R-1's OWN COVERAGE SET, and the classification of everything else.
//
// Named, because ownership is a decision somebody made and wrote down, not
// something a regex can infer. What is NOT hand-maintained is the SET OF
// WORKFLOWS: it comes from `git ls-files`, and any workflow this map does not
// account for FAILS. A new workflow therefore acquires an owner on the day it
// lands rather than on the day somebody remembers this file exists.
// ─────────────────────────────────────────────────────────────────────────────
const R1_LANES = ['build-platforms.yml', 'e2e.yml'];

const CLASSIFIED_ELSEWHERE = new Map([
  [
    'deploy-web.yml',
    '[10]D-2b owns the WEB deploy lane and its genericity. company/pipeline/09-release-engineering.md ' +
      'reconciliation PART 6 splits them deliberately: web is the live channel and is buildable today, ' +
      'the native/release half is deferred by 39-CHASSIS §4 cut 5, and merging the two would put one ' +
      "stage's exemption on the other's requirement.",
  ],
  [
    'deploy-workers.yml',
    'deploys services/*, which are Workers and not apps. R-1 quantifies over the workspace APP set, so a ' +
      'lane that never builds an app has nothing for this guard to compare and would report a permanent ' +
      'empty-set pass if it were graded.',
  ],
  [
    'ops-watch.yml',
    'reads a D1 table and files an issue. It builds nothing, ships nothing and names no app; [14]O-4 owns ' +
      'it. Grading it would add a workflow to the denominator that can never move the answer.',
  ],
  [
    'submit-appstore.yml',
    "[10]D-10 owns the store submission paths. The script it runs is already `--app`-parameterised; the " +
      'workflow that calls it is the half that still names one app, and pulling that into R-1 would claim ' +
      "another stage's refactor while its channel is still `served: false`.",
  ],
  ['submit-play.yml', 'same as submit-appstore.yml — [10]D-10 owns it, `served: false`, script already `--app`-parameterised.'],
  [
    'store-screenshots.yml',
    '[10]D-5 owns the store LISTING, and this workflow produces a listing asset rather than a release ' +
      'artifact: it builds no shippable binary, publishes nothing and uploads pictures. R-1 quantifies ' +
      'over the workspace APP set to prove a lane is generic; a lane that ships no app has nothing for ' +
      'this guard to compare and would sit in the denominator as a permanent empty-set pass. It is ' +
      'already `--app`-parameterised (`node tooling/store/capture-play-screenshots.mjs --app subly`), so ' +
      'the genericity R-1 cares about is in the script, and what holds its OUTPUT generic is ' +
      'assert-listing-assets.mjs, whose expected set is { channels declaring graphicAssets } x { apps }.',
  ],
  ['submit-snap.yml', 'same as submit-appstore.yml — [10]D-10 owns it, `served: false`, script already `--app`-parameterised.'],
  ['submit-windows-store.yml', 'same as submit-appstore.yml — [10]D-10 owns it, `served: false`, script already `--app`-parameterised.'],
]);

// ── the workflow set, anchored to what git tracks ────────────────────────────
if (!existsSync(join(ROOT, WORKFLOW_DIR))) {
  coverageLost([
    `${WORKFLOW_DIR} does not exist under ${ROOT}, so both limbs ranged over nothing.`,
    'The scan is broken, not the tree.',
  ]);
}

const parsed = parseAllWorkflows(ROOT);
const seen = parsed.map((w) => w.rel.split('/').pop()).sort();

const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', WORKFLOW_DIR], { encoding: 'utf8' });
const tracked =
  ls.status === 0
    ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)).map((l) => l.split('/').pop()))].sort()
    : [];
// A fixture root is not a git repository, and saying "no tracked workflows" there
// is the truth rather than a coverage loss — the same distinction
// assert-guard-coverage.mjs draws with `scanningRealRepo`.
const scanningRealRepo = ROOT_ARG === undefined;
if (tracked.length === 0 && scanningRealRepo) {
  coverageLost([
    `\`git ls-files -- ${WORKFLOW_DIR}\` returned no tracked workflow under ${ROOT}.`,
    'The manifest that anchors the workflow set is unreadable, so "did I see every lane" cannot be answered.',
  ]);
}
if (tracked.length) {
  const unseen = tracked.filter((t) => !seen.includes(t));
  if (unseen.length) {
    coverageLost([
      `git tracks ${tracked.length} workflow(s) and this scan parsed ${seen.length}; it never saw: ${unseen.join(', ')}.`,
      'An unseen workflow takes its app references with it, so limb A would be computed over a smaller set',
      'and still print ok — the exact shape of the floors this repo replaced with identities.',
    ]);
  }
}
if (seen.length === 0) {
  coverageLost([`no workflow parsed under ${WORKFLOW_DIR}, so there is no lane to grade.`]);
}

// ── the gate workflow, DERIVED ───────────────────────────────────────────────
// `ci.yml` is not a release lane: it is the gate every other lane waits on, and
// there is exactly one of it by construction — assert-gate-passed.mjs polls a
// check run BY NAME. So it is excluded from limb B's idea of "a lane", and it is
// found the way assert-release-provenance.mjs finds it: from that script's own
// `const GATE`, never from a filename typed here. If the gate is renamed, this
// follows it; if it is ambiguous, that is a coverage loss and not a default.
const gateSrc = existsSync(join(ROOT, GATE_SCRIPT)) ? readFileSync(join(ROOT, GATE_SCRIPT), 'utf8') : null;
const gateName = gateSrc?.match(/const GATE = '([^']+)'/)?.[1] ?? null;
if (gateName === null && scanningRealRepo) {
  coverageLost([
    `${GATE_SCRIPT} no longer declares \`const GATE = '…'\`, so this guard cannot tell which workflow IS the gate.`,
    'Without that, ci.yml would be graded as a release lane and every guard bound to it would be reported',
    'as hiding a channel — a false red that gets a guard switched off.',
  ]);
}
const gateWorkflows = parsed
  .filter((w) => [...w.jobs.values()].some((j) => (j.displayName ?? j.name) === gateName))
  .map((w) => w.rel.split('/').pop());
if (gateName !== null && gateWorkflows.length !== 1 && scanningRealRepo) {
  coverageLost([
    `${gateWorkflows.length} workflow(s) declare a job producing the "${gateName}" check (${gateWorkflows.join(', ') || 'none'}).`,
    'Exactly one must, or "which file is the gate" has no answer and limb B cannot tell a gate binding from',
    'a channel binding.',
  ]);
}
const GATE_WORKFLOW = gateWorkflows[0] ?? null;

// Every workflow is owned: R-1's, the gate, or a written classification.
const unclassified = seen.filter(
  (f) => !R1_LANES.includes(f) && f !== GATE_WORKFLOW && !CLASSIFIED_ELSEWHERE.has(f),
);
if (unclassified.length) {
  fail(
    `${unclassified.length} workflow(s) belong to no declared owner: ${unclassified.join(', ')}. ` +
      "Add each to R1_LANES (R-1 grades it against the workspace) or to CLASSIFIED_ELSEWHERE with the stage that owns it. " +
      'An unclassified lane is one nobody is holding to app-genericity, which is the state R-1 exists to end.',
  );
}
const missingR1 = R1_LANES.filter((f) => !seen.includes(f));
if (missingR1.length) {
  coverageLost([
    `R-1's declared coverage set names ${missingR1.join(', ')}, which ${missingR1.length === 1 ? 'is' : 'are'} not in ${WORKFLOW_DIR}.`,
    'Limb A would then grade fewer lanes than R-1 claims and still print ok.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// LIMB A — which apps does a lane actually resolve to?
// ─────────────────────────────────────────────────────────────────────────────

/** The workspace app set. Derived, never listed here. */
function workspaceApps(root) {
  const p = join(root, 'pubspec.yaml');
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'));
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at === -1) return null;
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const m = lines[i].match(/^\s+-\s+(['"]?)([^'"\s]+)\1\s*$/);
    if (!m) break;
    out.push(m[2].replace(/\/+$/, ''));
  }
  return out.filter((e) => e.startsWith('apps/'));
}

const apps = workspaceApps(ROOT);
if (apps === null || apps.length === 0) {
  coverageLost([
    `the root pubspec.yaml under ${ROOT} yielded no \`workspace:\` entry under apps/.`,
    'Limb A compares each lane to that set; an empty right-hand side makes every lane trivially equal to it',
    'and this guard would certify a workflow that covers nothing.',
  ]);
}
const APPS = new Set(apps);

/** The sentinel a `${{ … }}` leaves behind when nothing here can resolve it. */
const DYNAMIC = ' dynamic ';

/** `KEY: value` under every `env:` block in the file — workflow level and job
 *  level merged. Merging is deliberate and it is what closes the bypass: the
 *  hoist the original criterion invited (`env: APP: apps/subly` at file scope)
 *  and the same literal written inline resolve to the identical answer. */
export function collectEnv(lines) {
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(/^(\s*)env:\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      if (t.match(/^ */)[0].length <= indent) break;
      const kv = t.match(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!kv) break;
      map.set(kv[1], kv[2].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return map;
}

/** `matrix:` keys → their value lists, flow (`app: [a, b]`) and block form.
 *  Supported because a matrix over apps is the CORRECT generic shape, and a
 *  guard that failed the refactor it exists to demand is a guard that gets
 *  switched off. */
export function collectMatrix(lines) {
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(/^(\s*)matrix:\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    let key = null;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      const ind = t.match(/^ */)[0].length;
      if (ind <= indent) break;
      const flow = t.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*\[(.*)\]\s*$/);
      if (flow) {
        map.set(flow[1], flow[2].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
        key = null;
        continue;
      }
      const block = t.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
      if (block) { key = block[1]; map.set(key, []); continue; }
      const item = t.match(/^\s*-\s*(['"]?)(.+?)\1\s*$/);
      if (item && key) map.get(key).push(item[2]);
    }
  }
  return map;
}

/** Every key DECLARED under any `matrix:` block, whatever its value can be read
 *  as. `collectMatrix` above answers "what does this key expand to" and can only
 *  answer it for a static list; this answers the strictly weaker "does this key
 *  exist at all", which is the question limb A′ needs — the correct generic form
 *  is `app: ${{ fromJSON(needs.prepare.outputs.apps) }}`, whose VALUE is a
 *  run-time fact and whose KEY is right there in the file.
 *
 *  Without this, `apps/${{ matrix.app }}` in a job carrying NO matrix read
 *  exactly like a real one: both are unresolvable here, and only one of them
 *  builds anything. GitHub expands the missing key to the empty string, so the
 *  lane cheerfully runs against `apps/` and this guard called it generic. */
export function collectMatrixKeys(lines) {
  const keys = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(/^(\s*)matrix:\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      if (t.match(/^ */)[0].length <= indent) break;
      const kv = t.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*):/);
      if (kv) keys.add(kv[1]);
    }
  }
  return keys;
}

/** One line, with every `${{ … }}` resolved — possibly into SEVERAL lines, when
 *  a matrix key carries several values. Anything this cannot resolve becomes the
 *  DYNAMIC sentinel, which is not a failure: a path whose app segment is a
 *  run-time parameter is a lane that genuinely serves any app. */
export function expandExpressions(text, env, matrix) {
  const PLACEHOLDER = /\$\{\{\s*([^}]*?)\s*\}\}/;
  let variants = [text];
  for (let round = 0; round < 12; round++) {
    let changed = false;
    const next = [];
    for (const v of variants) {
      const m = v.match(PLACEHOLDER);
      if (!m) { next.push(v); continue; }
      changed = true;
      const expr = m[1].trim();
      let subs = null;
      let mm;
      if ((mm = expr.match(/^env\.([A-Za-z_][A-Za-z0-9_]*)$/)) && env.has(mm[1])) subs = [env.get(mm[1])];
      else if ((mm = expr.match(/^matrix\.([A-Za-z_][A-Za-z0-9_-]*)$/)) && matrix.has(mm[1]) && matrix.get(mm[1]).length) subs = matrix.get(mm[1]);
      if (!subs) subs = [DYNAMIC];
      for (const s of subs) next.push(v.slice(0, m.index) + s + v.slice(m.index + m[0].length));
    }
    variants = next;
    if (!changed) break;
  }
  return variants;
}

const APP_REF = new RegExp(`apps/(${DYNAMIC}|[A-Za-z0-9_.-]+)`, 'g');

/** What a workflow resolves to: a set of `apps/<id>`, plus whether any app path
 *  is parameterised. Comments are already blanked by parseWorkflow — essential
 *  here, because build-platforms.yml names `apps/subly/android/app/build.gradle.kts`
 *  and `apps/subly/.gitignore` IN PROSE, and a raw match would read a lane's own
 *  explanation as its behaviour. */
export function laneApps(wf, env, matrix) {
  const resolved = new Set();
  const exprs = new Set();
  let parameterised = false;
  for (const line of wf.lines) {
    if (!line.text.includes('apps/')) continue;
    // The expression sitting in the APP SEGMENT itself, before any expansion —
    // `apps/${{ matrix.app }}` yields `matrix.app`. Limb A′ needs the reference
    // as written, which the expanded variants have by definition thrown away.
    for (const m of line.text.matchAll(/apps\/\$\{\{\s*([^}]*?)\s*\}\}/g)) exprs.add(m[1].trim());
    for (const variant of expandExpressions(line.text, env, matrix)) {
      for (const m of variant.matchAll(APP_REF)) {
        if (m[1] === DYNAMIC) parameterised = true;
        else resolved.add(`apps/${m[1]}`);
      }
    }
  }
  return { resolved, parameterised, exprs };
}

const expected = [...APPS].sort().join(', ');
let gradedLanes = 0;
for (const wf of parsed) {
  const file = wf.rel.split('/').pop();
  const env = collectEnv(wf.lines);
  const matrix = collectMatrix(wf.lines);
  const { resolved, parameterised, exprs } = laneApps(wf, env, matrix);
  const got = [...resolved].sort().join(', ') || '(none)';

  if (!R1_LANES.includes(file)) {
    note(`${file} — resolves to ${parameterised ? 'a PARAMETERISED app path' : got}; owned by ${file === GATE_WORKFLOW ? 'the gate, not a channel' : 'another stage'}, not graded here`);
    continue;
  }
  gradedLanes++;
  if (parameterised) {
    // ── LIMB A′ ─────────────────────────────────────────────────────────────
    // A parameterised lane is generic only if the parameter is REAL and if
    // NOTHING beside it is still nailed to one app. Both checks exist because
    // limb A's `parameterised` branch is a short-circuit: it returns ok without
    // ever reaching the equality, so anything it lets through is unmeasured.
    const declaredKeys = collectMatrixKeys(wf.lines);
    const undeclared = [...exprs]
      .map((e) => e.match(/^matrix\.([A-Za-z_][A-Za-z0-9_-]*)/)?.[1])
      .filter((k) => k && !declaredKeys.has(k));
    if (undeclared.length) {
      fail(
        `${file} addresses its apps as \`apps/\${{ matrix.${undeclared[0]} }}\` but declares no \`${undeclared[0]}:\` ` +
          `key under any \`strategy.matrix:\` block (it declares ${declaredKeys.size ? [...declaredKeys].join(', ') : 'none'}). ` +
          'GitHub expands an undefined matrix context to the EMPTY STRING rather than erroring, so that lane builds ' +
          '`apps/` on every run while reading here as fully generic — a guard measuring a stand-in, which is the one ' +
          'defect this file was written to stop repeating. Declare the dimension (`app: ${{ fromJSON(needs.prepare.outputs.apps) }}`).',
      );
    } else if (resolved.size) {
      fail(
        `${file} is MIXED: its app paths are parameterised, and it ALSO still names ${[...resolved].sort().join(', ')} ` +
          'literally. A matrix leg for app #2 would run those steps against app #1 — the wrong directory, or the wrong ' +
          "artifact uploaded under the second app's name — and limb A cannot see it, because `parameterised` returns ok " +
          'before the equality is reached. Every app path in an R-1 lane is parameterised, or the lane is not generic.',
      );
    } else {
      ok(`${file} — the app segment of its paths is a run-time parameter over a declared dimension, and no path beside it names an app, so it serves any app in the workspace`);
    }
    continue;
  }
  const missing = [...APPS].filter((a) => !resolved.has(a));
  const extra = [...resolved].filter((a) => !APPS.has(a));
  if (missing.length || extra.length) {
    fail(
      `${file} covers {${got}} and the workspace holds {${expected}}` +
        `${missing.length ? ` — MISSING ${missing.join(', ')}` : ''}${extra.length ? ` — UNKNOWN ${extra.join(', ')}` : ''}. ` +
        'R-1 is the claim that adding an app needs no new or edited workflow file; an app the release lanes ' +
        'cannot see ships by copy-pasting this workflow and editing its paths, on the one surface where ' +
        'silent drift has cost this repo the most.',
    );
  } else {
    ok(`${file} — covers exactly the workspace app set {${got}}`);
  }
}
if (gradedLanes === 0) {
  coverageLost([
    'limb A graded ZERO lanes, so the equality it exists to assert ranged over nothing.',
    `R1_LANES names ${R1_LANES.join(', ')}; if a lane was renamed, rename it here in the same change.`,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// LIMB B — no guard binds itself to one lane without saying so.
// ─────────────────────────────────────────────────────────────────────────────

/** The declaration a lane-bound guard carries in its OWN header. */
const DECLARATION = /^\s*\/\/\s*LANE-BOUND:\s*([A-Za-z0-9._-]+\.ya?ml)\s+—\s+(\S.*)$/;
/** Short enough to write honestly, long enough that "because" does not pass. */
const MIN_REASON = 60;

const guardFiles = existsSync(CI_DIR) ? listDir(CI_DIR).filter((f) => f.endsWith('.mjs')).sort() : [];
if (guardFiles.length === 0) {
  coverageLost([
    `no .mjs found under ${CI_DIR}, so limb B read no guard at all.`,
    'A scan over nothing prints ok, which is this repository\'s single most repeated failure.',
  ]);
}

/** Workflow filenames a source file uses AS A NAME — the whole of a string
 *  literal, optionally with its `.github/workflows/` prefix. NOT a text match:
 *  every guard in this tree discusses workflows in prose, and several do it
 *  inside string literals (assert-guard-coverage.mjs's exemption reasons name
 *  e2e.yml in a sentence). A prose mention is not a binding, and a guard that
 *  could not tell them apart would demand a declaration from files that bind
 *  nothing — the false red that gets a check switched off. */
export function boundWorkflows(source, workflowFiles) {
  const code = stripSourceComments(source, '.mjs');
  const found = new Set();
  for (const m of code.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
    const lit = m[2];
    if (!/^[A-Za-z0-9._\-/]+$/.test(lit)) continue;
    const tail = lit.split('/').pop();
    if (workflowFiles.includes(tail)) found.add(tail);
  }
  return found;
}

let declared = 0;
let boundGuards = 0;
const bindingProblems = problems.length;
for (const g of guardFiles) {
  const src = readFileSync(join(CI_DIR, g), 'utf8');
  const bound = boundWorkflows(src, seen);
  // The gate is not a channel: exactly one workflow produces the `ci-gate`
  // check by construction, so binding to it says nothing about lanes. Removing
  // it from the set — rather than skipping guards that mention it — is what
  // stops a real deploy-web binding hiding behind a ci.yml one.
  if (GATE_WORKFLOW) bound.delete(GATE_WORKFLOW);

  const decls = src
    .split('\n')
    .map((l) => l.match(DECLARATION))
    .filter(Boolean)
    .map((m) => ({ workflow: m[1], why: m[2].trim() }));

  // A declaration for a lane the guard no longer binds is a PERMANENT WAIVER
  // wearing a comment. Checked in both directions for the same reason the
  // capability register is: a one-way list drifts into fiction.
  for (const d of decls) {
    declared++;
    if (!bound.has(d.workflow)) {
      fail(
        `tooling/ci/${g} declares \`LANE-BOUND: ${d.workflow}\` but its code no longer names that workflow ` +
          `(it names ${bound.size ? [...bound].join(', ') : 'none'}). Either the binding moved and the declaration ` +
          'is now a standing waiver nobody re-read, or the guard became generic and should lose the line.',
      );
    }
    if (d.why.length < MIN_REASON) {
      fail(
        `tooling/ci/${g}'s LANE-BOUND declaration for ${d.workflow} gives a ${d.why.length}-character reason, ` +
          `under the ${MIN_REASON} this asks for. The declaration exists so the next person can tell a deliberate ` +
          'channel-specific check from a lane somebody forgot to derive; a reason too short to say which is neither.',
      );
    }
  }

  if (bound.size !== 1) continue;
  boundGuards++;
  const only = [...bound][0];
  if (!decls.some((d) => d.workflow === only)) {
    fail(
      `tooling/ci/${g} names exactly one workflow — ${only} — and carries no \`// LANE-BOUND: ${only} — <why>\` ` +
        'declaration. A guard bound to one lane answers a question about that lane and reports ok for every other ' +
        'one, which is how assert-seams-wired.mjs printed ok while build-platforms.yml shipped two artifact lanes ' +
        'with no crash sink. Derive the lane (tooling/channel-register.json carries `lane.workflow` per channel), ' +
        'or declare the binding and say why it is right.',
    );
  }
}
// `all matched` must not be printed beside a FAIL. A summary line that
// contradicts the failures under it is how a reader concludes the failures are
// stale — the same reason assert-seams-wired prints its ok only when both ends
// of the crash-sink check held.
if (problems.length > bindingProblems) {
  note(`lane bindings — ${problems.length - bindingProblems} problem(s) below; ${boundGuards} guard(s) bind exactly one lane, ${declared} declaration(s)`);
} else if (declared === 0 && boundGuards === 0) {
  note(
    'no guard binds a single lane and none declares one — limb B is asserting the absence it wants, ' +
      'which is the correct end state and not a coverage loss (the scan itself is floored above).',
  );
} else {
  ok(`lane bindings — ${boundGuards} guard(s) bind exactly one lane, ${declared} declaration(s), all matched`);
}

console.log(`\nscanned ${seen.length} workflow(s) and ${guardFiles.length} guard(s); workspace apps: {${expected}}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-release-lane-generic: FAILED');
  process.exitCode = 1;
} else {
  console.log('assert-release-lane-generic: ok');
}
