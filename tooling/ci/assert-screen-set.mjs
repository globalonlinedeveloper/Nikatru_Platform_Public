#!/usr/bin/env node
// [pipeline C-13] THE NON-APP-SPECIFIC SCREEN SET EXISTS ONCE AND IS INHERITED.
//
// C-13's acceptance is that a NAMED LIST is declared and each screen is proven
// present in a fresh stamp and reachable. This enforces both halves against
// `tooling/screen-register.json`.
//
// ── WHY "REACHABLE" IS A SEPARATE CHECK FROM "PRESENT" ──────────────────────
// Because this repo has now shipped the difference three times, and each time
// everything was green:
//   · `ConsentController.record` existed with ZERO call sites — every event was
//     silently discarded, and no test failed, because refusing is the correct
//     behaviour when consent is absent
//   · `PaywallGate` exists today with zero consumers
//   · the account-deletion dialog's confirm button called
//     `Navigator.pop(dialogContext)` and nothing else, which looks exactly like
//     a button that worked
// A screen that exists and nothing reaches is not a screen. So `anchor` proves
// it EXISTS and `reachable` proves something CALLS it, and the second is the one
// that keeps catching real defects.
//
// ── WHY A BLOCKER IS ITSELF CHECKED ────────────────────────────────────────
// `blocked` entries name what must land first. That claim is verified: if the
// named blocker has already shipped, the build fails. Otherwise "blocked by
// stage 5" becomes a permanent excuse that outlives stage 5 — the same rot the
// dated grandfather lists elsewhere exist to prevent.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const REGISTER = 'tooling/screen-register.json';
const problems = [];
const notes = [];
const ok = (m) => console.log(`ok   ${m}`);

let reg;
try {
  reg = JSON.parse(readFileSync(join(ROOT, REGISTER), 'utf8'));
} catch (e) {
  console.error(`FAIL ${REGISTER} could not be read or parsed (${e.message}). The screen set is undeclared, so nothing can be checked.`);
  console.error('\nassert-screen-set: FAILED');
  process.exit(1);
}

const screens = reg.screens ?? [];
// A floor, not `> 0`: the register has held 16 since it was written, and a list
// somebody trims to three would otherwise read as a clean pass.
const MIN_SCREENS = 23;
if (screens.length < MIN_SCREENS) {
  problems.push(
    `COVERAGE LOST — the register declares only ${screens.length} screen(s), expected >= ${MIN_SCREENS}. DoD §4-A names the full set; a register somebody has trimmed asserts less while looking identical.`,
  );
} else {
  ok(`${screens.length} screen(s) declared`);
}

// Blockers that have already shipped. Checked so an excuse cannot outlive its
// reason.
const BLOCKERS_STILL_REAL = {
  'stage 5 (money rail)': () =>
    // Real the moment nothing can take a payment. `PaywallGate` having a
    // consumer would be the signal that this changed.
    !/PaywallGate\(/.test(
      existsSync(join(ROOT, 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib'))
        ? readAll('tooling/bricks/app/__brick__/apps/{{app_id}}/lib')
        : '',
    ),
  // Real until app_links is an actual dependency. The moment it is, the
  // callback screens are buildable and this excuse must stop working.
  'app_links (deep-link handling)': () =>
    !/^\s+app_links\s*:/m.test(
      existsSync(join(ROOT, 'tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml'))
        ? readFileSync(join(ROOT, 'tooling/bricks/app/__brick__/apps/{{app_id}}/pubspec.yaml'), 'utf8')
        : '',
    ),
};

function readAll(dir) {
  let out = '';
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (e.endsWith('.dart')) out += readFileSync(f, 'utf8');
    }
  };
  try { walk(join(ROOT, dir)); } catch { /* absent */ }
  return out;
}

let present = 0;
let reachableChecked = 0;
const todo = [];
const notBuilding = [];
const blocked = [];

for (const s of screens) {
  if (!s.id || !s.what || !s.status) {
    problems.push(`a screen entry is missing id/what/status: ${JSON.stringify(s).slice(0, 80)}`);
    continue;
  }

  if (s.status === 'present') {
    if (!s.anchor?.file || !s.anchor?.symbol) {
      problems.push(`\`${s.id}\` is PRESENT but names no anchor (file + symbol), so nothing proves it exists.`);
      continue;
    }
    const p = join(ROOT, s.anchor.file);
    if (!existsSync(p)) {
      problems.push(`\`${s.id}\` claims to live in \`${s.anchor.file}\`, which does not exist.`);
      continue;
    }
    const src = readFileSync(p, 'utf8');
    // Strip comments first: a symbol named only in prose is not a screen. This
    // repo has already shipped a guard that matched its own explanatory comment.
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // 🔴 THE ANCHOR MUST SAY WHAT KIND OF THING IT IS. A bare \b<symbol>\b
    // match is the declaration-vs-usage trap in a new guise: renaming
    // `class NotFoundScreen` to `class NotFoundScreenGone` left this guard GREEN,
    // because the class's own CONSTRUCTOR (`const NotFoundScreen({...})`) still
    // matched the bare word. Found by mutating the real tree; the bare version
    // passed. Third time this exact shape has bitten in this repo.
    const kind = s.anchor.kind ?? 'class';
    const patterns = {
      // Our own widget/class: the DECLARATION, not a mention of the name.
      class: new RegExp(`\\b(?:class|mixin|enum)\\s+${s.anchor.symbol}\\b`),
      // A method we own — its declaration or its call site.
      member: new RegExp(`\\b${s.anchor.symbol}\\s*\\(`),
      // A Flutter widget we USE rather than declare. The generic group is
      // load-bearing: the real call site is `SegmentedButton<ThemeMode>(`, and
      // without it this reported a widget that is plainly there as missing.
      uses: new RegExp(`\\b${s.anchor.symbol}\\s*(?:<[^>]*>)?\\s*\\(`),
    };
    const pattern = patterns[kind];
    if (!pattern) {
      problems.push(`\`${s.id}\`: unknown anchor kind \`${kind}\` (expected class / member / uses).`);
      continue;
    }
    if (!pattern.test(code)) {
      problems.push(`\`${s.id}\`: \`${s.anchor.file}\` does not ${kind === 'uses' ? 'use' : 'declare'} \`${s.anchor.symbol}\`.`);
      continue;
    }
    present++;

    // The half that keeps catching real defects.
    if (s.reachable) {
      const rp = join(ROOT, s.reachable.file);
      if (!existsSync(rp)) {
        problems.push(`\`${s.id}\`: reachability file \`${s.reachable.file}\` does not exist.`);
        continue;
      }
      const rcode = readFileSync(rp, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (!rcode.includes(s.reachable.pattern)) {
        problems.push(
          `\`${s.id}\` EXISTS but nothing reaches it — \`${s.reachable.pattern}\` is gone from \`${s.reachable.file}\`. ${s.reachable.why ?? ''}`,
        );
        continue;
      }
      reachableChecked++;
    }
  } else if (s.status === 'blocked') {
    if (!s.blockedBy) {
      problems.push(`\`${s.id}\` is BLOCKED with no \`blockedBy\`. An unexplained block is indistinguishable from work nobody did.`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.declaredOn ?? '')) {
      problems.push(`\`${s.id}\` is BLOCKED without a \`declaredOn\` date — an undated block is permanent by accident.`);
    }
    const stillReal = BLOCKERS_STILL_REAL[s.blockedBy];
    if (stillReal && !stillReal()) {
      problems.push(
        `\`${s.id}\` claims to be blocked by "${s.blockedBy}", but that blocker has SHIPPED. Build the screen or restate the block — otherwise the excuse outlives its reason.`,
      );
    }
    blocked.push(s);
  } else if (s.status === 'not-building') {
    // A deliberate NO. It must carry a dated reason, because "we decided not to"
    // with no argument is indistinguishable from "nobody got to it" six months
    // later — and this state exists precisely to stop dead features being built.
    if (!s.detail) {
      problems.push(`\`${s.id}\` is NOT-BUILDING with no \`detail\`. A deliberate no needs its argument recorded, or it decays into an undocumented gap.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.declaredOn ?? '')) {
      problems.push(`\`${s.id}\` is NOT-BUILDING without a \`declaredOn\` date.`);
    }
    notBuilding.push(s);
  } else if (s.status === 'todo') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.declaredOn ?? '')) {
      problems.push(`\`${s.id}\` is TODO without a \`declaredOn\` date.`);
    }
    todo.push(s);
  } else {
    problems.push(`\`${s.id}\` has unknown status \`${s.status}\` (expected present / blocked / todo / not-building).`);
  }
}

// A register of nothing-but-todo would pass every check above while asserting
// nothing about the tree.
if (screens.length > 0 && present === 0) {
  problems.push('COVERAGE LOST — not one screen is marked present, so every anchor check above ranged over nothing.');
} else if (present > 0) {
  ok(`${present} screen(s) present and anchored; ${reachableChecked} additionally proven reachable`);
}

if (blocked.length) {
  notes.push(`⬜ ${blocked.length} BLOCKED — the blocker is re-checked every run, so the excuse cannot outlive its reason:`);
  for (const s of blocked) notes.push(`   · ${s.id} — ${s.blockedBy} (${s.declaredOn})`);
}
if (todo.length) {
  notes.push(`⬜ ${todo.length} TODO — buildable now, not yet built:`);
  for (const s of todo) notes.push(`   · ${s.id} — ${s.what}`);
}
if (notBuilding.length) {
  notes.push(`⬜ ${notBuilding.length} DELIBERATELY NOT BUILT — each would be a dead feature, and the reason is recorded:`);
  for (const s of notBuilding) notes.push(`   · ${s.id} (${s.declaredOn})`);
}
if (notes.length) console.log(`\n${notes.join('\n')}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-screen-set: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-screen-set: ok — ${present} present, ${blocked.length} blocked, ${todo.length} to build, ${notBuilding.length} deliberately not built`);
}
