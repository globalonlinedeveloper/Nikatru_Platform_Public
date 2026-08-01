// ─────────────────────────────────────────────────────────────────────────────
// screen-set.test.mjs — assert-screen-set.mjs must be able to FAIL.
//
// [pipeline C-13] The non-app-specific screen set exists once and is inherited.
//
// ⚠️ SECOND LINE OF EVIDENCE. Four mutations on the REAL tree first:
//   1. the 404 exists but nothing routes to it            → caught
//   2. the error screen exists but is never installed     → caught
//   3. a declared screen's CLASS renamed                  → NOT caught at first.
//      `\b<symbol>\b` still matched the class's own CONSTRUCTOR, so
//      `class NotFoundScreen` → `class NotFoundScreenGone` left the guard green.
//      That is the declaration-vs-usage trap for the THIRD time in this repo.
//      Anchors now declare their KIND (class / member / uses) and `class`
//      matches the declaration.
//   4. a blocked screen whose blocker has shipped         → caught
//
// ⚠️ Fixing (3) then broke `settings.appearance`, because the real call site is
// `SegmentedButton<ThemeMode>(` and the `uses` pattern had no generic group — a
// widget plainly present, reported missing. Both directions matter: a guard that
// cries wolf gets switched off as surely as one that sleeps.
//
// WHY "present" AND "reachable" ARE SEPARATE. This repo has shipped the
// difference three times with everything green: ConsentController.record with
// zero call sites, PaywallGate with zero consumers, and an account-deletion
// button whose confirm action was `Navigator.pop` and nothing else.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-screen-set.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-screens-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const WIDGETS = 'packages/design_system/lib/src/widgets/system_screens.dart';
const ROUTER = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/core/router.dart';
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const BRICK_LIB = `${BRICK}/lib`;

/**
 * A register at or above the floor of 16 — a thinner one fails for a reason
 * unrelated to the case under test.
 */
function tree({ mutate = (r) => r, widgets = null, router = null } = {}) {
  const root = join(TMP, `r${seq++}`);

  const present = [
    {
      id: 'system.not-found',
      what: '404',
      status: 'present',
      anchor: { file: WIDGETS, symbol: 'NotFoundScreen' },
      reachable: { file: ROUTER, pattern: 'errorBuilder:', why: 'go_router would show its own error page' },
    },
    {
      id: 'system.offline',
      what: 'offline notice',
      status: 'present',
      anchor: { file: WIDGETS, symbol: 'OfflineNotice' },
    },
    {
      id: 'settings.appearance',
      what: 'theme choice',
      status: 'present',
      anchor: { file: ROUTER, symbol: 'SegmentedButton', kind: 'uses' },
    },
  ];
  // Padding to clear the floor without inventing meaning.
  // 17 since 2026-08-01: MIN_SCREENS went 22 -> 23 when the money rail added
  // monetization.manage-plan to the register.
  const padding = Array.from({ length: 17 }, (_, i) => ({
    id: `todo.pad${i}`,
    what: 'not yet built',
    status: 'todo',
    declaredOn: '2026-07-28',
  }));
  // 🔴 RE-POINTED 2026-08-01 FROM "stage 5 (money rail)" TO app_links, and the
  // reason IS the guard working: stage 5 shipped, so its predicate now returns
  // false and ANY entry still claiming to be blocked by it fails. A fixture that
  // kept the old blocker would be red on every case for a reason unrelated to
  // the one under test — and would be asserting that a shipped excuse still
  // works, which is the opposite of what this guard is for.
  const blocked = [
    {
      id: 'auth.callbacks',
      what: 'oauth callback screens',
      status: 'blocked',
      blockedBy: 'app_links (deep-link handling)',
      declaredOn: '2026-07-28',
    },
    {
      id: 'auth.callback-error',
      what: 'oauth callback failure',
      status: 'blocked',
      blockedBy: 'app_links (deep-link handling)',
      declaredOn: '2026-07-28',
    },
  ];

  // [pipeline C-13] A `not-building` entry, so the fourth state is exercised
  // rather than only described. It is a DELIBERATE no with its argument
  // recorded — not a todo nobody came back to.
  const notBuilding = [
    {
      id: 'settings.language',
      what: 'language picker',
      status: 'not-building',
      detail: 'one locale ships, so a picker could not change anything',
      declaredOn: '2026-07-29',
    },
  ];
  let register = { screens: [...present, ...blocked, ...padding, ...notBuilding] };
  register = mutate(register);

  const files = {
    'tooling/screen-register.json': JSON.stringify(register, null, 2),
    [WIDGETS]:
      widgets ??
      'class NotFoundScreen extends StatelessWidget {\n  const NotFoundScreen({super.key});\n}\n\nclass OfflineNotice extends StatelessWidget {\n  const OfflineNotice({super.key});\n}\n',
    [ROUTER]:
      router ??
      'final router = GoRouter(\n  errorBuilder: (c, s) => const NotFoundScreen(),\n  routes: [],\n);\nfinal x = SegmentedButton<ThemeMode>(segments: []);\n',
    // The brick lib the purchase-path invariant reads.
    //
    // 🔴 ALL FIVE LIMBS PLUS THE GATE, and it has to be all-or-nothing: since
    // 2026-08-01 the guard asserts BOTH directions — a `PaywallGate(` with no
    // purchase path is a promise every stamped app makes and none can keep, and
    // a purchase path with no gate is a rail that charges and unlocks nothing.
    // A fixture carrying some-but-not-all would fail every case for a reason
    // unrelated to the one under test. (Before that date this file said "no
    // PaywallGate consumer, so blocked by stage 5 is still true" — the blocker
    // predicate it referred to has shipped.)
    [`${BRICK_LIB}/app.dart`]: 'class App extends StatelessWidget {}\n',
    [`${BRICK_LIB}/features/home/home_screen.dart`]:
      'Widget build(BuildContext c) => PaywallGate(\n  locked: ref.watch(paywallLockedProvider),\n  child: const SizedBox.shrink(),\n);\n',
    [`${BRICK_LIB}/state/money_providers.dart`]:
      'final entitlementsProvider = FutureProvider((ref) async => x);\n',
    [`${BRICK_LIB}/features/monetization/paywall_screen.dart`]:
      'await rail.startCheckout(o);\nawait c.awaitUnlock(appId: a);\nawait funnel.onPurchaseSuccess(o.productId);\n',
    [`${BRICK_LIB}/features/monetization/manage_plan_screen.dart`]:
      'await rail.requestCancellation();\n',
  };

  for (const [f, body] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-screen-set', () => {
  test('passes when every declared screen is present and reachable', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /23 screen\(s\) declared/);
    assert.match(out, /3 screen\(s\) present and anchored/);
    // Blocked and todo must PRINT — a gap nobody sees is a gap that grows.
    assert.match(out, /2 BLOCKED/);
    assert.match(out, /17 TODO/);
  });

  // ── present vs reachable — the distinction that keeps catching real bugs ──
  test('FAILS when a screen exists but nothing reaches it', () => {
    const { code, out } = run(tree({
      router: 'final router = GoRouter(routes: []);\nfinal x = SegmentedButton<ThemeMode>(segments: []);\n',
    }));
    assert.equal(code, 1);
    assert.match(out, /EXISTS but nothing reaches it/);
  });

  // 🔴 THE DECLARATION-vs-USAGE TRAP, third occurrence in this repo. The bare
  // word still matches the class's own constructor.
  test('FAILS when a declared class is renamed, constructor notwithstanding', () => {
    const { code, out } = run(tree({
      widgets:
        'class NotFoundScreenGone extends StatelessWidget {\n  const NotFoundScreen({super.key});\n}\n\nclass OfflineNotice extends StatelessWidget {\n  const OfflineNotice({super.key});\n}\n',
    }));
    assert.equal(code, 1);
    assert.match(out, /does not declare `NotFoundScreen`/);
  });

  // …and the other direction: a widget that IS there must not be reported
  // missing just because it carries a generic argument.
  test('does NOT report a generic widget as missing', () => {
    const { code } = run(tree());
    assert.equal(code, 0, 'SegmentedButton<ThemeMode>( should satisfy a `uses` anchor');
  });

  test('FAILS when a present screen names no anchor', () => {
    const { code, out } = run(tree({
      mutate: (r) => {
        delete r.screens.find((s) => s.id === 'system.offline').anchor;
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /is PRESENT but names no anchor/);
  });

  // ── blocked entries cannot rot ───────────────────────────────────────────
  test('FAILS when a blocker has already shipped', () => {
    const root = tree();
    // `app_links` becoming a real dependency is the signal that the callback
    // screens are buildable — so the excuse must stop working the same hour.
    //
    // (This used to plant a `PaywallGate` consumer to signal that stage 5 had
    // landed. Stage 5 HAS landed, so a PaywallGate in the template is now the
    // tree's normal state, and that blocker's predicate returns false
    // unconditionally — which is itself asserted by the fixture no longer being
    // able to use it.)
    const pubspec = join(root, BRICK, 'pubspec.yaml');
    mkdirSync(dirname(pubspec), { recursive: true });
    writeFileSync(pubspec, 'dependencies:\n  flutter:\n    sdk: flutter\n  app_links: ^6.0.0\n');
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /but that blocker has SHIPPED/);
  });

  test('FAILS when a block is undated', () => {
    const { code, out } = run(tree({
      mutate: (r) => {
        delete r.screens.find((s) => s.id === 'auth.callbacks').declaredOn;
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /BLOCKED without a `declaredOn` date/);
  });

  test('FAILS when a block names no blocker', () => {
    const { code, out } = run(tree({
      mutate: (r) => {
        delete r.screens.find((s) => s.id === 'auth.callbacks').blockedBy;
        return r;
      },
    }));
    assert.equal(code, 1);
    assert.match(out, /BLOCKED with no `blockedBy`/);
  });

  // ── the deliberate NO must carry its argument ────────────────────────────
  describe('not-building is a decision, not a shrug', () => {
    test('prints what was deliberately not built', () => {
      const { code, out } = run(tree());
      assert.equal(code, 0);
      assert.match(out, /1 DELIBERATELY NOT BUILT/);
    });

    // "We decided not to" with no argument is indistinguishable from "nobody
    // got to it" six months later.
    test('FAILS when a deliberate no records no reason', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          delete r.screens.find((s) => s.id === 'settings.language').detail;
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /NOT-BUILDING with no `detail`/);
    });

    test('FAILS when a deliberate no is undated', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          delete r.screens.find((s) => s.id === 'settings.language').declaredOn;
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /NOT-BUILDING without a `declaredOn` date/);
    });
  });

  // ── coverage self-checks ─────────────────────────────────────────────────
  test('FAILS rather than reporting clean when the register is trimmed', () => {
    const { code, out } = run(tree({
      mutate: (r) => ({ screens: r.screens.slice(0, 3) }),
    }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — the register declares only 3 screen\(s\)/);
  });

  // A register of nothing-but-todo passes every anchor check by having none.
  test('FAILS when not one screen is marked present', () => {
    const { code, out } = run(tree({
      mutate: (r) => ({
        screens: r.screens.map((s) =>
          s.status === 'present'
            ? { id: s.id, what: s.what, status: 'todo', declaredOn: '2026-07-28' }
            : s,
        ),
      }),
    }));
    assert.equal(code, 1);
    assert.match(out, /not one screen is marked present/);
  });
});
