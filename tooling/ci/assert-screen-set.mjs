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
//   · `PaywallGate` SHIPPED in the design system and was referenced by
//     nothing for months — that dead-on-arrival stretch is the defect this
//     bullet remembers. It is CONSUMED today: `class _GatedInsights` in
//     `apps/subly/lib/core/router.dart` (the `/insights` route builder)
//     constructs it, and so does `child: PaywallGate(` in the app brick's
//     `lib/features/home/home_screen.dart`
//   · the account-deletion dialog's confirm button called
//     `Navigator.pop(dialogContext)` and nothing else, which looks exactly like
//     a button that worked
// A screen that exists and nothing reaches is not a screen. So `anchor` proves
// it EXISTS and `reachable` proves something CALLS it, and the second is the one
// that keeps catching real defects.
//
// 🔴 …AND `reachable` WAS OPTIONAL UNTIL 2026-08-06, WHICH MADE IT SKIPPABLE BY
// OMISSION. Four `present` entries — `system.offline`, `settings.appearance`,
// `settings.support`, `settings.about` — carried no `reachable` key at all, and
// this guard printed `22 present and anchored; 18 additionally proven reachable`
// and exited 0. The half of C-13's acceptance those four skipped was skipped
// SILENTLY, because `if (s.reachable)` treats an absent field as "nothing to
// check" and an empty domain reports exactly like a satisfied one. That is this
// corpus's named recurring defect, arriving inside the guard written against it.
//
// It cost a real dead feature: `OfflineNotice` had ZERO consumers anywhere in
// the repository — its declaration and its constructor were the only two
// occurrences — while sitting `present` and green for nine days.
//
// So `reachable` is now MANDATORY on every `present` entry. An entry that
// genuinely cannot have one takes a dated `reachableExempt` instead, and every
// exemption is PRINTED ON EVERY RUN: an absent assertion must never again be
// indistinguishable from a passing one.
//
// ── 📏 APPENDED 2026-08-25 — THE COUNTS ABOVE ARE 2026-08-06 AND ARE NOT TODAY'S ─
// The paragraph above is left EXACTLY as written: it quotes this guard's own
// output of that day, and renumbering a dated record falsifies it rather than
// repairing it. What is fixed here is that it was being read as the CURRENT
// state — `tooling/dod-register.json` carried "22" as the live screen figure
// because it was copied from this header while the floor below already read 24.
// A header that narrates a superseded state beside a newer floor is a
// source-of-truth defect, not a typo, so the current state is now stated here
// where the stale one is read.
//
// MEASURED 2026-08-25 by running this file (`node tooling/ci/assert-screen-set.mjs`,
// exit 0), and these are the numbers it printed:
//   · 25 screen(s) declared          (MIN_SCREENS floor: 25)
//   · 24 present and anchored        (MIN_PRESENT floor: 24)
//   · 24 proven reachable, 0 exempt  (equal to `present` by construction)
//   · 1 blocked — `auth.callbacks`, on app_links (deep-link handling), 2026-07-28
//   · 0 todo, 0 deliberately not built
// So the header and the floor now agree with each other and with the register.
//
// THREE `22`s remain in this file and NONE of them is a current count. (This
// note quotes the string it counts, so a grep returns MORE than three — the
// figure is NOT self-inclusive; count the three named here, not the hits.)
// They are:
//   · the quoted 2026-08-06 output in the paragraph above;
//   · the `reachableChecked >= 22` floor named further down as one the FIRST
//     version of that change had and this one deliberately does NOT have;
//   · "All 22 present entries carried a reachability proof on 2026-08-06" inside
//     the MIN_PRESENT failure message — kept verbatim because it is true OF THAT
//     DATE, and now followed in the same sentence by today's 24 so the message
//     cannot be read as claiming the register still holds 22.
//
// ── WHY A BLOCKER IS ITSELF CHECKED ────────────────────────────────────────
// `blocked` entries name what must land first. That claim is verified: if the
// named blocker has already shipped, the build fails. Otherwise "blocked by
// stage 5" becomes a permanent excuse that outlives stage 5 — the same rot the
// dated grandfather lists elsewhere exist to prevent.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';

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
// 24 since 2026-08-10: research/44 §7 rung 3 added `monetization.promo-card`.
// 25 since 2026-08-11: `auth.password-reset` split out of `auth.callbacks` when
// the reset link finally had somewhere to land.
// RAISED WITH THE TREE ON PURPOSE — left at 23, deleting a screen would leave
// exactly 23 and this floor would stop catching the deletion it exists to
// catch. A ratchet that does not follow the thing it measures has stopped.
const MIN_SCREENS = 25;
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
  // 🪦 SHIPPED 2026-08-01. This used to be `!/PaywallGate\(/.test(brick)` — a
  // deliberate tripwire that turned CI red the moment a real `PaywallGate`
  // consumer reached the template, because a paywall in the stamped chassis
  // without the rest of the purchase path is a promise the app cannot keep.
  // It fired exactly as designed and the increment that trips it has landed.
  //
  // It is not deleted, and it is not left pointing at its old predicate. Either
  // would be wrong in a different way: deleting the key makes a stray
  // `"blockedBy": "stage 5 (money rail)"` fall through with NO predicate and
  // pass silently, and keeping the old predicate makes it fail forever for a
  // reason that is no longer true. Returning `false` means the blocker has
  // shipped, so ANY remaining claim to be blocked by it fails loudly with the
  // "build the screen or restate the block" message below. The invariant the
  // tripwire actually protected has moved to `checkPurchasePathIsWhole()`, which
  // runs on EVERY invocation rather than only when something claims to be
  // blocked — see the section below.
  'stage 5 (money rail)': () => false,
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
    for (const e of listDir(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (e.endsWith('.dart')) out += readFileSync(f, 'utf8');
    }
  };
  try { walk(join(ROOT, dir)); } catch { /* absent */ }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — AN ANCHOR FOLLOWS ITS SCREEN INTO THE CHASSIS PACKAGE
// (ADR 067 decision 2)
//
// The register already accepts ANY path in `anchor.file`, including a
// `packages/...` one, and three anchors already point there. What it could not
// express until now is the SHAPE chassis step 4 actually produces: the anchor
// file still exists, is still routed and is still the file a reader would look
// in, but the `class SettingsScreen` it names has moved into
// `package:nikatru_chassis_screens` and what is left is an ADAPTER that builds
// the package widget.
//
// Read at the adapter alone, `class <Symbol>` is gone and this guard says the
// screen "does not declare" it. That is true of the file and false of the tree,
// and the repair a reader reaches for is to re-point the anchor at the package
// — which quietly drops the assertion that the BRICK still routes it. Both
// halves matter, so the anchor keeps naming the brick file and the declaration
// is looked for one import away.
//
// WHAT DOES NOT CHANGE: the anchor file must still EXIST (an absent file is
// still a failure, never a delegation), the symbol must still be declared
// somewhere this guard actually reads, and the `reachable` half is untouched —
// a screen that nothing reaches is still a screen nothing reaches.
//
// ONE LEVEL, ONE IMPORT. Two different chassis imports in one adapter is
// ambiguous and refused rather than guessed; a target not on disk is a failure,
// not a pass.
// ─────────────────────────────────────────────────────────────────────────────
const CHASSIS_PKG = 'nikatru_chassis_screens';
const CHASSIS_DIR = 'packages/chassis_screens';
const CHASSIS_IMPORT = new RegExp(`import\\s+'package:${CHASSIS_PKG}/([^']+\\.dart)'`, 'g');
const stripCode = (src) => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `.dart` under `rel`, recursively, as paths relative to ROOT. */
function dartFilesUnder(rel) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = listDir(join(ROOT, d));
    } catch {
      return;
    }
    for (const e of entries) {
      const child = `${d}/${e}`;
      if (statSync(join(ROOT, child)).isDirectory()) walk(child);
      else if (e.endsWith('.dart')) out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

/** The chassis file(s) `rel` delegates to, resolved ONE level.
 *  `null` = no delegation · `{ lost }` = a delegation this resolver could not
 *  follow · `{ files }`. `null` and `{ lost }` are different answers on purpose:
 *  collapsing them is how a resolver that stopped reaching its target starts
 *  reporting that there was nothing to reach. */
function delegationOf(rel) {
  if (!existsSync(join(ROOT, rel))) return null;
  CHASSIS_IMPORT.lastIndex = 0;
  const src = stripCode(readFileSync(join(ROOT, rel), 'utf8'));
  const paths = [...new Set([...src.matchAll(CHASSIS_IMPORT)].map((m) => m[1]))];
  if (paths.length === 0) return null;
  if (paths.length > 1) {
    return {
      lost:
        `imports ${paths.length} different \`package:${CHASSIS_PKG}\` paths (${paths.join(', ')}), so the ` +
        'file that now declares the screen cannot be identified. This guard names ONE file per anchor and ' +
        'will not guess between two of them.',
    };
  }
  const target = `${CHASSIS_DIR}/lib/${paths[0]}`;
  if (!existsSync(join(ROOT, target))) {
    return {
      lost:
        `delegates to \`package:${CHASSIS_PKG}/${paths[0]}\`, which resolves to \`${target}\` — and that ` +
        'file is not on disk. The screen was emptied into a package that does not carry it.',
    };
  }
  const targetSrc = stripCode(readFileSync(join(ROOT, target), 'utf8'));
  const out = [target];
  for (const m of targetSrc.matchAll(/export\s+'([^':]+\.dart)'/g)) {
    const t = `${CHASSIS_DIR}/lib/${m[1]}`;
    if (existsSync(join(ROOT, t))) out.push(t);
  }
  return { files: out };
}

// ── THE TRIPWIRE, RE-POINTED AT THE INVARIANT IT WAS ALWAYS ABOUT ───────────
//
// The old form was a BLOCKER predicate, so it only ran while some register entry
// still claimed to be blocked by stage 5. That made it a one-shot: the day the
// two `monetization.*` rows flipped to `present`, the check that had been
// guarding "no paywall without a purchase path" stopped running altogether —
// which is this repo's most expensive recurring shape (a check that silently
// stops checking) arriving by way of its own success.
//
// So the invariant is stated directly and checked EVERY RUN, in both directions:
//
//   · a `PaywallGate(` in the stamped chassis with no purchase path is a
//     promise the app cannot keep — the original tripwire, preserved;
//   · a purchase path with no `PaywallGate(` is a rail that can take money and
//     unlocks nothing — the mirror defect, which the old form could not see.
//
// Each limb is matched as a CALL and excludes the file that declares it, for the
// reason assert-seams-wired.mjs carries a scar about: `foo(` finds a declaration
// as readily as a call, so a "does anything use this?" check that ignores
// declarations passes with every real caller deleted.
function checkPurchasePathIsWhole() {
  const BRICK_LIB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';
  if (!existsSync(join(ROOT, BRICK_LIB))) {
    problems.push(
      `COVERAGE LOST — ${BRICK_LIB} does not exist, so the paywall/purchase-path invariant ranged over nothing.`,
    );
    return;
  }
  // 🔴 THE BRICK LIB IS NOT THE WHOLE STAMPED CHASSIS ONCE A SCREEN DELEGATES.
  // Every limb below is matched over the template's own source; move
  // `paywall_screen.dart` into `package:nikatru_chassis_screens` and
  // `.startCheckout(` leaves this directory while `PaywallGate(` may not — which
  // reads here as "a gate with no way to pay past it", a finding about a tree
  // that is perfectly whole. So the chassis files the brick delegates to are
  // read WITH it. This only ever ADDS text: a limb that was present stays
  // present, and a limb that is genuinely absent is still absent.
  let src = readAll(BRICK_LIB);
  const delegated = new Set();
  for (const rel of dartFilesUnder(BRICK_LIB)) {
    const d = delegationOf(rel);
    if (d && d.lost) {
      problems.push(
        `COVERAGE LOST — \`${rel}\` ${d.lost} The purchase-path invariant is read over the stamped ` +
          'chassis, and a delegation it cannot follow is a limb it cannot see.',
      );
      continue;
    }
    for (const f of (d && d.files) || []) delegated.add(f);
  }
  for (const f of [...delegated].sort()) src += readFileSync(join(ROOT, f), 'utf8');
  if (delegated.size) {
    notes.push(
      `⬜ the purchase-path scan read ${delegated.size} chassis file(s) the template delegates to: ` +
        `${[...delegated].sort().join(', ')}`,
    );
  }
  src = stripCode(src);

  const gate = /PaywallGate\(/.test(src);
  // The limbs a paywall is a promise WITHOUT. Each is the call site, in the
  // template, not the declaration (which lives in packages/purchases).
  const LIMBS = [
    { re: /\.startCheckout\(/, what: 'a checkout launch (PurchaseRail.startCheckout)' },
    { re: /\.awaitUnlock\(/, what: 'the bounded convergence wait after a checkout returns' },
    { re: /\.requestCancellation\(/, what: 'the ROSCA cancel call ([5]M-9)' },
    { re: /entitlementsProvider/, what: 'the SERVER entitlement read that decides the lock' },
    { re: /\.onPurchaseSuccess\(/, what: 'the money funnel ([5]M-16)' },
  ];
  const missing = LIMBS.filter((l) => !l.re.test(src));

  if (gate && missing.length > 0) {
    problems.push(
      `PAYWALL WITHOUT A PURCHASE PATH — the stamped chassis uses \`PaywallGate(\` but is missing ${missing
        .map((m) => m.what)
        .join('; ')}. A gate in the template with no way to pay past it is a promise every stamped app makes and none can keep. Land the path or take the gate out.`,
    );
  } else if (!gate && missing.length < LIMBS.length) {
    problems.push(
      `A PURCHASE PATH WITH NOTHING TO UNLOCK — the stamped chassis can take money (${LIMBS.length - missing.length}/${LIMBS.length} limb(s) present) but no \`PaywallGate(\` gates anything. A rail that charges and unlocks nothing is worse than no rail.`,
    );
  } else if (gate) {
    ok(`purchase path whole — PaywallGate plus all ${LIMBS.length} limbs present in the stamped chassis`);
  } else {
    // Neither: a chassis with no money rail at all. Legitimate, and reported so
    // the state cannot become invisible.
    notes.push('⬜ the stamped chassis carries NO money rail (no PaywallGate and no purchase path).');
  }
}
checkPurchasePathIsWhole();

let present = 0;
let reachableChecked = 0;
const todo = [];
const notBuilding = [];
const blocked = [];
const reachableExempt = [];

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
    let declaredIn = pattern.test(code) ? s.anchor.file : null;
    if (declaredIn === null) {
      // The screen may have moved into the chassis package, leaving an adapter
      // at this path — see the resolver above. The anchor stays on the brick
      // file (which still routes it) and the declaration is looked for one
      // import away.
      const d = delegationOf(s.anchor.file);
      if (d && d.lost) {
        problems.push(
          `\`${s.id}\`: \`${s.anchor.file}\` does not ${kind === 'uses' ? 'use' : 'declare'} ` +
            `\`${s.anchor.symbol}\`, and its delegation could not be followed — it ${d.lost}`,
        );
        continue;
      }
      for (const f of (d && d.files) || []) {
        if (pattern.test(stripCode(readFileSync(join(ROOT, f), 'utf8')))) {
          declaredIn = f;
          break;
        }
      }
    }
    if (declaredIn === null) {
      problems.push(`\`${s.id}\`: \`${s.anchor.file}\` does not ${kind === 'uses' ? 'use' : 'declare'} \`${s.anchor.symbol}\`.`);
      continue;
    }
    if (declaredIn !== s.anchor.file) {
      notes.push(
        `⬜ ${s.id} — \`${s.anchor.symbol}\` is DECLARED IN \`${declaredIn}\`, which ` +
          `\`${s.anchor.file}\` delegates to. The anchor stays on the brick file because that is what ` +
          'still routes it; a property judged somewhere else is printed rather than left to be inferred.',
      );
    }
    present++;

    // ── The half that keeps catching real defects — and it is NOT OPTIONAL ──
    //
    // The `else` branch below is the entire point of this change. `if
    // (s.reachable)` on its own is an assertion whose domain the register can
    // empty by saying nothing, and four entries had done exactly that.
    if (!s.reachable) {
      // The one permitted escape, and it is loud rather than silent. It must
      // ARGUE — a reason and a date — and it is printed on every run below, so
      // an exemption cannot decay into an unexamined gap the way an absent
      // field did.
      const ex = s.reachableExempt;
      if (!ex?.why || !/^\d{4}-\d{2}-\d{2}$/.test(ex?.declaredOn ?? '')) {
        problems.push(
          `\`${s.id}\` is PRESENT but names no \`reachable\`, so the SECOND HALF of C-13's acceptance ` +
            '("present in a fresh stamp AND reachable") is not checked for it — and an absent assertion ' +
            'reads exactly like a satisfied one. Add `reachable` {file, pattern, why} naming something a ' +
            'stamped app really does, or a `reachableExempt` {why, declaredOn} that argues why it cannot ' +
            'have one (exemptions are printed every run and cannot hide). `OfflineNotice` sat here with ' +
            'ZERO consumers in the whole repository while this guard reported it green.',
        );
        continue;
      }
      reachableExempt.push(s);
    } else {
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
  ok(`${present} screen(s) present and anchored; ${reachableChecked} proven reachable`);
}

// ── REQUIRED_COVERAGE — the reachability limb may not shrink ────────────────
//
// ⚠️ THERE IS DELIBERATELY NO `reachableChecked >= 22` FLOOR HERE, AND THE FIRST
// VERSION OF THIS CHANGE HAD ONE. With `reachable` now mandatory and the
// exemption ceiling at zero, `reachableChecked` is EQUAL TO `present` by
// construction on every run — so such a floor could never fail on its own, and
// "an assertion that cannot fail is worse than none: it inflates apparent
// coverage". The two floors below are the two things that can genuinely move.
//
//   · MIN_PRESENT — the mandatory-`reachable` rule stops the domain being
//     emptied ONE ENTRY AT A TIME; this stops it being emptied WHOLESALE, by
//     the move that rule cannot see. Demote twenty present screens to `todo`
//     and every message above stays truthful while the guard checks two. The
//     todo list is printed, but a printed gap is a note, and this repo's rule
//     is to prefer a build-failing guard over a note.
//   · the EXEMPTION CEILING — an escape hatch with no ceiling becomes the norm.
//
// Both are checked-in numbers that only ever move with a reason, the same idiom
// as MIN_SCREENS above and check-migrations.mjs's REQUIRED_COVERAGE.
// 23 since 2026-08-10 — `monetization.promo-card` landed `present` with a
// reachability proof. Same ratchet rule as MIN_SCREENS above.
// 24 since 2026-08-11 — `auth.password-reset` landed `present`, reachable
// through the router's recovery gate.
// MEASURED 2026-08-25: `present` is 24, so this floor sits EXACTLY on the tree —
// demote or delete one screen and it bites. Not raised, because nothing landed;
// not lowered, because a floor lowered to match prose has stopped being a floor.
const MIN_PRESENT = 24;
const REQUIRED_COVERAGE = { reachableExempt: 0 };
if (present > 0 && present < MIN_PRESENT) {
  problems.push(
    `COVERAGE LOST — only ${present} screen(s) are PRESENT, expected >= ${MIN_PRESENT}, so the reachability ` +
      'half ranged over that many. All 22 present entries carried a reachability proof on 2026-08-06, and all ' +
      '24 did when this was last measured (2026-08-25: 25 declared, 24 present, 24 proven reachable, 0 exempt, ' +
      '1 blocked); a run ' +
      'that checks fewer means entries left the `present` set (to todo/blocked/not-building). That is a ' +
      'legitimate move and it may not happen quietly — screens leaving `present` is exactly how the half of ' +
      'C-13 that catches dead screens stops running.',
  );
}
if (reachableExempt.length > REQUIRED_COVERAGE.reachableExempt) {
  problems.push(
    `${reachableExempt.length} screen(s) claim a reachability EXEMPTION, and the checked-in ceiling is ` +
      `${REQUIRED_COVERAGE.reachableExempt}. Exemptions are printed rather than hidden, but a ceiling is what stops ` +
      'them becoming the norm: raise it deliberately in the same change, or prove the screen reachable. ' +
      `Claimed: ${reachableExempt.map((s) => s.id).join(', ')}.`,
  );
}

// PRINTED EVERY RUN, never merely counted. The whole failure this replaces was
// an unmet clause that produced no output at all.
if (reachableExempt.length) {
  notes.push(
    `⬜ ${reachableExempt.length} PRESENT screen(s) EXEMPT from the reachability half — re-read these, they are the ones nothing proves a user can get to:`,
  );
  for (const s of reachableExempt) notes.push(`   · ${s.id} — ${s.reachableExempt.why} (${s.reachableExempt.declaredOn})`);
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
  console.log(
    `\nassert-screen-set: ok — ${present} present (${reachableChecked} reachability-proven, ${reachableExempt.length} exempt), ` +
      `${blocked.length} blocked, ${todo.length} to build, ${notBuilding.length} deliberately not built`,
  );
}
