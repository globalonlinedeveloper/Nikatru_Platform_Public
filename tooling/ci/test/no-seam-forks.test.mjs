// ─────────────────────────────────────────────────────────────────────────────
// no-seam-forks.test.mjs — assert-no-seam-forks.mjs must be able to FAIL.
//
// [pipeline C-3] no capability exists twice · [pipeline C-9] no seam
// implementation in the brick template. Both named this guard and both were
// marked VERIFIED while it did not exist.
//
// ⚠️ These fixtures are the SECOND line of evidence. Five mutations were run
// against the REAL repository first and all five behaved correctly: a same-name
// fork in the template, a renamed implementer in the template, a renamed
// implementer in an app, the real Subly fork left undeclared — all caught; and a
// legitimate test double correctly did NOT fire.
//
// The guard needed three fixes during those runs, none of which a fixture I wrote
// first would have exposed:
//   1. it reported `class works implements AuthRepository` — the pattern spanned
//      out of a doc comment. Comments are now stripped before matching.
//   2. it missed the one real fork in the tree, because that fork is a same-named
//      class with NO implements clause. Both detection modes are now required.
//   3. it counted `abstract class AuthRepository` — the contract's own declaration
//      — as a shared implementation, turning two homeless classes into "forks".
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-no-seam-forks.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-forks-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** The [ADR 042] parity pair, at the paths the guard hardcodes. Every fixture
 *  tree must contain both files or the guard exits COVERAGE LOST — which is the
 *  point of that limb, and is why they are defaults here rather than opt-in.
 *  A case overrides either one by writing the same path into `extra`. */
const CHASSIS = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/auth/sign_in_screen.dart';
const FORK = 'apps/subscriptiontracker/lib/features/auth/login_screen.dart';

/** The other two DECIDABLE pairs, added 2026-08-12. Same shape, different seam:
 *  both gate on `caps.canSchedule` off NotificationCapabilities. */
const BRICK_F = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features';
const SUBLY_F = 'apps/subscriptiontracker/lib/features';
const SETTINGS_CHASSIS = `${BRICK_F}/settings/settings_screen.dart`;
const SETTINGS_FORK = `${SUBLY_F}/settings/settings_screen.dart`;
const HOME_CHASSIS = `${BRICK_F}/home/home_screen.dart`;
const HOME_FORK = `${SUBLY_F}/home/home_screen.dart`;

/** The nine WATCHED pairs — undecidable because their chassis gates on nothing.
 *  Every fixture tree must contain them for the same reason it must contain the
 *  parity pair: their ABSENCE is itself a failure the guard is meant to report. */
const WATCHED = [
  ['firstrun/onboarding_screen.dart', 'onboarding/onboarding_screen.dart'],
  ['auth/check_inbox_screen.dart', 'auth/check_inbox_screen.dart'],
  // Ninth, added 2026-08-13 with the ARRIVE limb. It was a real chassis/fork
  // pair on disk that appeared in NEITHER of the guard's lists.
  ['auth/legal_consent_fields.dart', 'auth/legal_consent_fields.dart'],
  ['auth/reaccept_terms_screen.dart', 'auth/reaccept_terms_screen.dart'],
  ['auth/reset_password_screen.dart', 'auth/reset_password_screen.dart'],
  ['auth/sign_up_screen.dart', 'auth/sign_up_screen.dart'],
  ['auth/verify_email_screen.dart', 'auth/verify_email_screen.dart'],
  ['monetization/manage_plan_screen.dart', 'monetization/manage_plan_screen.dart'],
  ['monetization/paywall_screen.dart', 'monetization/paywall_screen.dart'],
];
/** …plus the two SHELL pairs (2026-09-14), which sit beside lib/features rather
 *  than under it, same file name on both sides. */
const BRICK_LIB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';
const SUBLY_LIB = 'apps/subscriptiontracker/lib';
const SHELL = ['app.dart', 'main.dart'];

/** A tree with: core declaring two contracts, packages/ implementing ONE of them
 *  (so the other is deliberately homeless), the parity pair at parity, plus
 *  whatever `extra` files a case needs. MIN_CONTRACTS is 5, so the register
 *  declares five. */
// The LANDED-behaviour limb's shapes, at parity on both sides. Real code
// shapes, not prose: the guard blanks comments and strings first.
const LANDED_HOME =
  'class _PromoState {\n  Widget build() {\n' +
  '    decide(hasContent: offerings.isNotEmpty && rail.canStartCheckout);\n' +
  '    return PromoCard(priceLabel: l10n.promoCardPrice(MoneyFormatter(l10n.localeName).format(offering.price), term));\n' +
  '  }\n}\n';
const LANDED_CANCEL = 'Future<void> _cancelSchedules() async {\n  await svc.cancel(kDailyReminderId);\n}\n';
const LANDED_PROVIDERS_CHASSIS = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart';
const LANDED_PROVIDERS_FORK = 'apps/subscriptiontracker/lib/state/providers/notifications.dart';

function tree({ extra = {}, violations = null, omit = [] } = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};

  // The parity pair, at parity: C = F = {oauthRedirect}, as the real tree is
  // today. Class names deliberately do NOT collide with the fixture contracts —
  // these files are the parity limb's subject, not the fork limb's.
  files[join(root, CHASSIS)] =
    'class SignInScreen {\n  Widget build(BuildContext context) {\n' +
    '    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);\n' +
    '    if (caps.oauthRedirect) return const AppleButton();\n    return const Empty();\n  }\n}\n';
  files[join(root, FORK)] =
    'class LoginScreen {\n  Widget build(BuildContext context) {\n' +
    '    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);\n' +
    '    if (caps.oauthRedirect && providers.any) return const AppleButton();\n    return const Empty();\n  }\n}\n';

  // The two other decidable pairs, at parity: C = F = {canSchedule}.
  const schedGate = (cls) =>
    `class ${cls} {\n  Widget build(BuildContext context) {\n` +
    '    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(p);\n' +
    '    if (!caps.canSchedule) return const Unavailable();\n    return const Toggle();\n  }\n}\n';
  files[join(root, SETTINGS_CHASSIS)] = schedGate('SettingsScreen');
  files[join(root, SETTINGS_FORK)] = schedGate('SettingsScreen');
  files[join(root, HOME_CHASSIS)] = schedGate('HomeScreen') + LANDED_HOME;
  files[join(root, HOME_FORK)] = schedGate('HomeScreen') + LANDED_HOME;
  // The landed-behaviour limb's other pair: reminders-off cancels its own id.
  files[join(root, LANDED_PROVIDERS_CHASSIS)] = LANDED_CANCEL;
  files[join(root, LANDED_PROVIDERS_FORK)] = LANDED_CANCEL;

  // The watched pairs: present, and gating on NOTHING — which is exactly the
  // condition the watch limb asserts still holds.
  for (const [c, f] of WATCHED) {
    files[join(root, `${BRICK_F}/${c}`)] = 'class Screen {\n  Widget build() => const Empty();\n}\n';
    files[join(root, `${SUBLY_F}/${f}`)] = 'class Screen {\n  Widget build() => const Empty();\n}\n';
  }

  // The brick holds .dart OUTSIDE `lib/features` too — `lib/`, `lib/state/`,
  // `lib/core/`, `hooks/` and `test/` on the real tree. Modelled here because a
  // brick made of nothing but features is a shape that does not exist, and a
  // fixture that assumed it made emptying the features root indistinguishable
  // from emptying the whole root — which sent the ARRIVE limb's own case to the
  // per-root coverage floor instead (2026-09-05).
  files[join(root, 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart')] =
    'class App {\n  Widget build() => const Empty();\n}\n';
  files[join(root, 'tooling/bricks/app/hooks/pre_gen.dart')] = '// hook\n';
  // The SHELL pairs, watched since 2026-09-14 (O-SHELL-PAIR-UNCOMPARED): the
  // brick's lib/app.dart above and lib/main.dart, each against Subly's copy.
  // Present and gating on nothing, like every other watched pair.
  for (const s of SHELL) {
    if (!files[join(root, `${BRICK_LIB}/${s}`)]) {
      files[join(root, `${BRICK_LIB}/${s}`)] = 'void main() {}\n';
    }
    files[join(root, `${SUBLY_LIB}/${s}`)] = 'class Shell {\n  Widget build() => const Empty();\n}\n';
  }

  const CONTRACTS = ['NotificationService', 'KeyValueStore', 'Analytics', 'PackVerifier', 'AuthRepository'];
  files[join(root, 'packages/core/lib/seams.dart')] =
    CONTRACTS.map((c) => `abstract interface class ${c} {}`).join('\n') + '\n';

  // one real shared implementation — so NotificationService is "homed"
  files[join(root, 'packages/notifications/lib/impl.dart')] =
    'import "../../core/lib/seams.dart";\nclass LocalNotificationService implements NotificationService {}\n';
  // AuthRepository deliberately has NO shared implementation → homeless
  // padding so the file floor (10) is cleared
  for (let i = 0; i < 10; i++) files[join(root, `packages/core/lib/pad${i}.dart`)] = '// pad\n';

  const capabilities = [{
    id: 'core',
    owner: 'packages/core',
    package: 'nikatru_core',
    seams: CONTRACTS.map((c) => ({ file: 'packages/core/lib/seams.dart', symbol: c })),
    consumers: [],
    unconsumedReason: 'fixture',
  }];
  if (violations) capabilities[0].violations = violations;
  files[join(root, 'tooling/capability-register.json')] =
    JSON.stringify({ consumerRoots: ['apps/app1'], capabilities }, null, 2);

  for (const [rel, body] of Object.entries(extra)) files[join(root, rel)] = body;

  for (const rel of omit) delete files[join(root, rel)];
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('the passing path', () => {
  test('a clean tree passes', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no seam forks/);
  });

  test('a shared implementation in packages/ is never a fork', () => {
    const { code } = run(tree());
    assert.equal(code, 0);
  });
});

describe('[C-9] a fork in the BRICK TEMPLATE — every stamped app inherits it', () => {
  test('same-name fork fails, and says the template is worse', () => {
    const { code, out } = run(tree({
      extra: { 'tooling/bricks/app/__brick__/apps/x/lib/f.dart': 'class NotificationService {}\n' },
    }));
    assert.equal(code, 1);
    assert.match(out, /THE TEMPLATE — every stamped app inherits this/);
  });

  test('RENAMED implementer in the template fails', () => {
    const { code, out } = run(tree({
      extra: { 'tooling/bricks/app/__brick__/apps/x/lib/f.dart': 'class MyOwn implements NotificationService {}\n' },
    }));
    assert.equal(code, 1);
    assert.match(out, /class MyOwn re-implements `NotificationService`/);
  });
});

describe('[C-3] a fork in an app', () => {
  test('renamed implementer in an app fails', () => {
    const { code, out } = run(tree({ extra: { 'apps/a/lib/f.dart': 'class Sneaky implements NotificationService {}\n' } }));
    assert.equal(code, 1);
    assert.match(out, /inside an app/);
  });

  test('a DECLARED fork passes but is printed every run', () => {
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/f.dart': 'class NotificationService {}\n' },
      violations: [{ path: 'apps/a/lib/f.dart', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 0, out);
    assert.match(out, /declared fork of `NotificationService`/);
  });
});

describe('the distinction that makes the guard usable', () => {
  test('HOMELESS is not a fork — the sole implementation must not fail the build', () => {
    // AuthRepository has no shared implementation in the fixture.
    const { code, out } = run(tree({ extra: { 'apps/a/lib/auth.dart': 'class SupabaseAuth implements AuthRepository {}\n' } }));
    assert.equal(code, 0, out);
    assert.match(out, /Not a fork: it is the only one that exists/);
    assert.match(out, /\[2\]C-15/);
  });

  test('test doubles and probes are exempt', () => {
    for (const dir of ['test', 'integration_test', 'live_probe']) {
      const { code, out } = run(tree({ extra: { [`apps/a/${dir}/d.dart`]: 'class _Fake implements NotificationService {}\n' } }));
      assert.equal(code, 0, `${dir}: ${out}`);
    }
  });

  test('an ABSTRACT class is a contract, not an implementation', () => {
    // Regression: `abstract class AuthRepository` was being counted as a shared
    // implementation of itself, which reclassified every real one as a fork.
    const { code, out } = run(tree({ extra: { 'apps/a/lib/x.dart': 'abstract class AuthRepository {}\n' } }));
    assert.equal(code, 0, out);
  });
});

describe('parse structure, not prose', () => {
  test('a contract named in a COMMENT creates no finding', () => {
    // Regression: the pattern once spanned out of a doc comment and reported a
    // class called "works".
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/c.dart': '// NotificationService implements the thing, and the class works well.\nclass Unrelated {}\n' },
    }));
    assert.equal(code, 0, out);
  });

  test('a block comment mentioning a contract creates no finding', () => {
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/c.dart': '/* class NotificationService {} */\nclass Other {}\n' },
    }));
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A WAIVER THAT MATCHES NOTHING (limb added 2026-08-10, with the cut-1 reversal)
//
// The reversal deleted `apps/subscriptiontracker/lib/data/auth/supabase_auth_repository.dart`
// and its violation entry stayed behind — matching nothing, printing nothing,
// failing nothing, because the waiver loop only ever speaks when a suspect is
// FOUND. Stale is silent by construction, which is this repository's recurring
// shape: a check that quietly stopped checking. Worse than untidy, it is a
// standing re-entry permit — put a fork back at that path and it is waived on
// sight with nobody deciding to.
//
// 🔬 THE FIRST VERSION OF THIS LIMB FAILED ON THE REAL TREE FOR THE WRONG
// REASON, and the last case here is that bug. `AnalyticsFunnel` is declared as a
// `capability-implemented-in-app` violation; it is not a registered SEAM, so the
// scan cannot see it at all and "not a suspect" says nothing about it. A guard
// reporting the limits of its own reach as a defect in the tree is exactly what
// the register's coverage rules exist to stop.
// ─────────────────────────────────────────────────────────────────────────────
describe('a declared violation must still describe something', () => {
  test('a waiver whose FILE is gone fails, and names the path', () => {
    const { code, out } = run(tree({
      violations: [{ path: 'apps/a/lib/deleted.dart', symbol: 'NotificationService', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/a\/lib\/deleted\.dart — the file does not exist/);
    assert.match(out, /match NOTHING in the tree/);
  });

  test('a waiver whose file survived but no longer implements the seam fails', () => {
    const { code, out } = run(tree({
      // The file is real; the fork was extracted out of it and something else
      // was left behind. The waiver now covers a file that is not a fork.
      extra: { 'apps/a/lib/f.dart': 'class SomethingElse {}\n' },
      violations: [{ path: 'apps/a/lib/f.dart', symbol: 'NotificationService', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 1, out);
    assert.match(out, /nothing in it declares or re-implements `NotificationService` any more/);
  });

  test('a waiver for a NON-SEAM capability is left alone — the scan cannot see it', () => {
    // `AnalyticsFunnel` is not in the register's `seams`, so it is not a
    // contract and never appears in `suspects`. Failing here would be the guard
    // measuring its own blind spot. The file must exist; that half still applies.
    const { code, out } = run(tree({
      extra: { 'apps/a/lib/funnel.dart': 'class AnalyticsFunnel {}\n' },
      violations: [{ path: 'apps/a/lib/funnel.dart', symbol: 'AnalyticsFunnel', kind: 'capability-implemented-in-app', detail: 'known', fixOwner: 'C-3' }],
    }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /match NOTHING in the tree/);
  });
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when the register yields too few contracts', () => {
    const root = tree();
    writeFileSync(join(root, 'tooling/capability-register.json'),
      JSON.stringify({ consumerRoots: ['apps/app1'], capabilities: [{ id: 'x', owner: 'packages/core', seams: [] }] }));
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register is absent', () => {
    const root = tree();
    rmSync(join(root, 'tooling/capability-register.json'));
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST — no capability register/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ONE FLOOR PER ROOT — the union floor that stood here until 2026-09-05
//
// The guard used to floor `sharedFiles.length + suspectFiles.length` at 10: one
// number over `packages/`, `apps/` and `tooling/bricks/`, which any ONE of them
// can satisfy alone. Measured on the real tree that day, `packages/` moved aside
// and moved back: the old guard printed
//     ok  no seam forks — 17 contract(s), 180 file(s) scanned; 0 shared
//     implementation(s), …
// and exited 0. That is not a scan that saw less — with nothing homed, EVERY
// fork in an app or in the brick template is reclassified "homeless" and printed
// as a ⚠ instead of failing the build.
//
// These fixtures are the SECOND line of evidence; the real-tree mutation table
// is in the guard's own header. The case that matters most below is
// `apps/ alone falls below its floor while the UNION is enormous` — it is the
// exact shape a single pooled floor cannot see, and it is red only because the
// floors are now per root.
//
// ⚠️ NOT COVERED HERE, said out loud rather than left to be assumed: a fixture
// cannot push `tooling/bricks` below its floor of 11. The brick contributes 14
// files to every fixture tree — 3 parity chassis + 11 watched chassis (the 9
// screens, and since 2026-09-14 the two shell files lib/app.dart and
// lib/main.dart) — and
// removing any of them trips the parity or watch limb first, which is the right
// ordering (a precise diagnosis beats a count). That floor's evidence is the
// real-tree `tooling/bricks removed` mutation, not this file.
// ─────────────────────────────────────────────────────────────────────────────

/** Every `.dart` this guard could CLASSIFY under `dir` — for a suspect root that
 *  is the non-exempt subset, which is what the floor counts. */
function classifiable(root, dir, suspect) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith('.dart')) out.push(`${dir}/${r}`);
    }
  };
  walk('');
  return suspect ? out.filter((f) => !/(^|\/)(test|integration_test|live_probe)(\/|$)/.test(f)) : out;
}

/** Make a fixture look like a FULL CHECKOUT and pad each root to an exact
 *  classifiable count. The sentinel the guard looks for is its own file, which
 *  sits outside all three subject roots — so it survives any mutation OF a
 *  subject, which is the whole reason it is not `apps/pubspec.yaml` or similar. */
// bricks default 15, not 14: the landed-behaviour rows add one brick file
// (lib/state/providers.dart) to the base tree, and padding only ever adds.
// 16 since 2026-09-14: the watched SHELL pair adds the brick lib/main.dart.
function checkout(root, { apps = 40, packages = 95, bricks = 16 } = {}) {
  const sentinel = join(root, 'tooling/ci/assert-no-seam-forks.mjs');
  mkdirSync(dirname(sentinel), { recursive: true });
  writeFileSync(sentinel, '// sentinel: this root is a checkout of the repository\n');
  for (const [dir, want, suspect] of [
    ['apps', apps, true],
    ['packages', packages, false],
    ['tooling/bricks', bricks, true],
  ]) {
    const have = classifiable(root, dir, suspect).length;
    for (let i = 0; i < want - have; i++) {
      const p = join(root, dir, `padcov/lib/p${i}.dart`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, '// pad\n');
    }
  }
  return root;
}

describe('coverage is per ROOT — a pooled floor is satisfied by one root alone', () => {
  test('a full checkout above every floor passes, and PRINTS the split with each floor', () => {
    const { code, out } = run(checkout(tree()));
    assert.equal(code, 0, out);
    assert.match(out, /apps=40\/floor 37/);
    assert.match(out, /packages=95\/floor 90/);
    assert.match(out, /tooling\/bricks=16\/floor 11/);
  });

  test('🔴 apps/ alone below its floor fails, though the UNION is twenty times the old one', () => {
    // apps = 15 (the chassis/fork pair files, the landed-behaviour app file
    // and, since 2026-09-14, the two watched shell files),
    // union = 15 + 300 + 16 = 331.
    // The old `< 10` floor was satisfied three hundred times over. This is the
    // defect, and it is red only because the floor is now per root.
    const { code, out } = run(checkout(tree(), { apps: 0, packages: 300, bricks: 16 }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — 1 of the 3 declared root\(s\)/);
    assert.match(out, /`apps` yielded only 15 file\(s\) to classify, below its floor of 37/);
  });

  test('🔴 packages/ below its floor fails — with nothing homed, no fork can be a fork', () => {
    const { code, out } = run(checkout(tree(), { packages: 89 }));
    assert.equal(code, 2, out);
    assert.match(out, /`packages` yielded only 89 file\(s\) to classify, below its floor of 90/);
    assert.match(out, /every fork is reclassified "homeless"/);
  });

  test('the floor is exact: 37 passes, 36 does not', () => {
    const green = run(checkout(tree(), { apps: 37 }));
    assert.equal(green.code, 0, green.out);
    assert.match(green.out, /apps=37\/floor 37/);
    const red = run(checkout(tree(), { apps: 36 }));
    assert.equal(red.code, 2, red.out);
    assert.match(red.out, /below its floor of 37/);
  });

  test('two roots lost are reported TOGETHER, not one at a time', () => {
    // Naming only the first sends the reader to fix half of it.
    const { code, out } = run(checkout(tree(), { apps: 20, packages: 50 }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — 2 of the 3 declared root\(s\)/);
    assert.match(out, /`apps` yielded only 20/);
    assert.match(out, /`packages` yielded only 50/);
  });

  test('THE CONTROL — a legitimate shrink stays GREEN. A floor that fires on honest work gets switched off', () => {
    // A package folded into another (−40 of 135) and app features dropped
    // (−3 of 43): the real shape of both is in the guard's mutation table.
    const { code, out } = run(checkout(tree(), { apps: 43, packages: 135 }));
    assert.equal(code, 0, out);
    const shrunk = run(checkout(tree(), { apps: 40, packages: 95 }));
    assert.equal(shrunk.code, 0, shrunk.out);
  });

  test('the floor counts the SUBJECT — test doubles never reach a verdict, so they cannot prop one up', () => {
    // 200 files under apps/**/test/ do not lift `apps` over its floor of 37,
    // and on the real tree the mirror of this is what keeps the floor off
    // honest work: Subly's 69 test files are 47% of apps/ and moving them
    // must not redden a guard that never classified them.
    const root = checkout(tree(), { apps: 0, packages: 95, bricks: 16 });
    for (let i = 0; i < 200; i++) {
      const p = join(root, `apps/padapp/test/t${i}.dart`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, '// double\n');
    }
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /`apps` yielded only 15 file\(s\) to classify/);
  });
});

describe('a declared root that delivers NOTHING is COVERAGE LOST, checkout or not', () => {
  for (const dir of ['apps', 'packages', 'tooling/bricks']) {
    test(`${dir} absent → named, and named FIRST`, () => {
      const root = tree();
      rmSync(join(root, dir), { recursive: true, force: true });
      const { code, out } = run(root);
      assert.equal(code, 2, out);
      assert.match(out, new RegExp(`\`${dir.replace('/', '\\/')}\` is not a directory under this root`));
    });
  }

  test('a suspect root whose every file is a test double is empty of subject, not clean', () => {
    const root = tree();
    rmSync(join(root, 'apps'), { recursive: true, force: true });
    for (let i = 0; i < 5; i++) {
      const p = join(root, `apps/a/test/t${i}.dart`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, '// double\n');
    }
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /all 5 \.dart file\(s\) under `apps` sit in a test\/, integration_test\/ or live_probe\//);
  });
});

describe('the floors are measurements of ONE tree and say so when they are not applied', () => {
  test('a synthetic root skips the floors and PRINTS that it did', () => {
    // The fixture trees are far below every floor and must still pass, or none
    // of the cases above could exist. A run that skipped the floors silently
    // would be indistinguishable from one that met them.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /this root is not a checkout of this repository, so the per-root floors were NOT applied/);
    assert.doesNotMatch(out, /\/floor \d/);
  });

  test('the structural check still runs over a synthetic root — an absent root is not excused', () => {
    const root = tree();
    rmSync(join(root, 'packages'), { recursive: true, force: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /`packages` is not a directory under this root/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 FIX (1) IN THE HEADER — "comments are now stripped" — WAS TWO REGEXES, AND
// TWO REGEXES ARE NOT A TOKENIZER (2026-08-07).
//
// The block pattern ran FIRST, so a `/*` inside a `//` line comment opened a
// phantom block that ran to the next `*​/` and blanked everything between it —
// including a `class X implements <Contract>` declaration. The guard then found
// no fork and printed ok, which is this file's own subject one level up: a check
// that silently stopped checking. ZERO of the 217 real Dart files were affected,
// so only a mutation could find it. Same defect and same repair as
// assert-ops-register.mjs (which lost 103 lines of a real file) and
// assert-no-clone-tells.mjs; all three now share text-reductions.mjs.
// ─────────────────────────────────────────────────────────────────────────────
describe('the stripper is a tokenizer — a comment cannot hide a fork', () => {
  test('🔴 a fork AFTER a line comment containing `/*` is still found', () => {
    const { code, out } = run(tree({
      extra: {
        'apps/app1/lib/f.dart':
          // NotificationService, not AuthRepository: the latter is deliberately
          // homeless in this fixture, and a homeless class is reported as
          // [2]C-15 work at exit 0 — which would have made this assertion pass
          // for the wrong reason and prove nothing about the stripper.
          '// worker sources live under services/*/src/ — unrelated to this file\n' +
          'class MyNotifier implements NotificationService {}\n' +
          "const doc = 'the span above would close here */';\n",
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /MyNotifier/);
  });

  test('a declaration inside a REAL comment is still not a fork', () => {
    const { code, out } = run(tree({
      extra: { 'apps/app1/lib/f.dart': '// class Ghost implements AuthRepository {}\n/* class Ghost2 implements Analytics {} */\nclass B {}\n' },
    }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /Ghost/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITY — the limb [ADR 042] owed (added 2026-08-12).
//
// ⚠️ THESE FIXTURES ARE THE SECOND LINE OF EVIDENCE. Five mutations were run
// against the REAL repository first and all five behaved correctly; they are
// listed in the guard's own header, because a fixture written beside a guard
// encodes the same misunderstanding as the guard. The two that the ADR itself
// names ([ADR 042]:119-122) were run on the real files with `dart format
// --output=none` clean on the mutated text, and both were restored
// byte-identically.
//
// What the limb is: C = the `caps.<field>` reads in the brick's
// sign_in_screen.dart, F = the same set in Subly's login_screen.dart, both with
// comments AND string literals stripped. Require C ⊆ F. The fork was ACCEPTED,
// so it may carry more; what it may not do is quietly carry less.
// ─────────────────────────────────────────────────────────────────────────────
describe('[ADR 042] an accepted fork must follow the chassis it forked', () => {
  test('parity holds → passes, and SAYS SO on every run', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    // Printed, not silent: an operator can see the limb is alive without
    // reading the source, which is the difference between this and a check
    // that quietly stopped checking.
    assert.match(out, /\[ADR 042\] parity — apps\/subscriptiontracker\/lib\/features\/auth\/login_screen\.dart follows all 1 chassis/);
    assert.match(out, /3 accepted fork\(s\) at parity, 11 watched/);
  });

  test('🔴 the chassis gains a capability the fork never hears about → EXIT 1, naming the fork', () => {
    // [ADR 042]:121 — the whole reason the limb exists. The next auth capability
    // added to the brick reaches all 49 stamped apps and not this one.
    const { code, out } = run(tree({
      extra: {
        [CHASSIS]:
          'class SignInScreen {\n  Widget build(BuildContext context) {\n' +
          '    if (caps.oauthRedirect) return const AppleButton();\n' +
          '    if (caps.secureSessionStorage) return const Locked();\n    return const Empty();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/subscriptiontracker\/lib\/features\/auth\/login_screen\.dart/);
    assert.match(out, /does NOT read `caps\.secureSessionStorage`/);
    assert.match(out, /fallen behind the chassis screen they forked/);
  });

  test('🔴 the fork drops its gate → EXIT 1, the control that proves the fork is read at all', () => {
    // [ADR 042]:122.
    const { code, out } = run(tree({
      extra: {
        [FORK]: 'class LoginScreen {\n  Widget build(BuildContext context) {\n' +
          '    if (providers.any) return const AppleButton();\n    return const Empty();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /does NOT read `caps\.oauthRedirect`/);
    assert.match(out, /fork reads \{—\}/);
  });

  test('C ⊆ F, not C = F — the fork may carry MORE', () => {
    // It carries more by design: the ADR-027 deletion notice, the E2EKeys.login*
    // anchors, the localized _friendlyMessage mapping. Requiring equality would
    // fail the tree on the day the limb was written.
    const { code, out } = run(tree({
      extra: {
        [FORK]: 'class LoginScreen {\n  Widget build(BuildContext context) {\n' +
          '    if (caps.oauthRedirect) return const AppleButton();\n' +
          '    if (caps.biometricUnlock) return const Extra();\n    return const Empty();\n  }\n}\n',
      },
    }));
    assert.equal(code, 0, out);
  });

  test('🔴 a `caps.` read that survives ONLY IN A COMMENT does not satisfy parity', () => {
    // "The stripping is not hygiene, it is the assertion" ([ADR 042]:101-103).
    // Measured on the real file: login_screen.dart names `caps.oauthRedirect` in
    // a comment narrating the fix as well as in the live `if`, so a raw match is
    // satisfied by the prose alone.
    const { code, out } = run(tree({
      extra: {
        [FORK]: 'class LoginScreen {\n  Widget build(BuildContext context) {\n' +
          '    // the gate used to be `if (caps.oauthRedirect && providers.any)` here\n' +
          '    /* and caps.oauthRedirect is discussed at length in this block too */\n' +
          '    return const AppleButton();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /does NOT read `caps\.oauthRedirect`/);
  });

  test('a `caps.` read inside a STRING LITERAL does not satisfy parity either', () => {
    const { code, out } = run(tree({
      extra: {
        [FORK]: 'class LoginScreen {\n  Widget build(BuildContext context) {\n' +
          "    debugPrint('gated on caps.oauthRedirect');\n    return const AppleButton();\n  }\n}\n",
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /does NOT read `caps\.oauthRedirect`/);
  });

  test('`caps?.field` counts — it is the same read', () => {
    const { code, out } = run(tree({
      extra: {
        [FORK]: 'class LoginScreen {\n  Widget build(BuildContext context) {\n' +
          '    if (caps?.oauthRedirect ?? false) return const AppleButton();\n    return const Empty();\n  }\n}\n',
      },
    }));
    assert.equal(code, 0, out);
  });
});

describe('the parity limb knows when it is not looking', () => {
  test('COVERAGE LOST when the CHASSIS file is gone', () => {
    const root = tree();
    rmSync(join(root, CHASSIS));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — the accepted-fork parity limb reached nothing/);
    assert.match(out, /sign_in_screen\.dart — the file is not there/);
  });

  test('COVERAGE LOST when the FORK file is gone — a converged fork must be DECIDED, not 404d', () => {
    const root = tree();
    rmSync(join(root, FORK));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /login_screen\.dart — the file is not there/);
  });

  test('🔴 COVERAGE LOST when the chassis yields ZERO caps reads — C ⊆ F would hold for any F', () => {
    // The assertion-that-cannot-fail case, and the one a green run can never
    // distinguish from a clean tree. If the brick's screen stops gating on
    // capabilities (renamed local, refactored away), an empty C makes the subset
    // test vacuously true forever.
    const { code, out } = run(tree({
      extra: {
        [CHASSIS]: 'class SignInScreen {\n  Widget build(BuildContext context) {\n    return const Empty();\n  }\n}\n',
      },
    }));
    assert.equal(code, 2, out);
    assert.match(out, /0 `caps\.<field>` read\(s\) found/);
    assert.match(out, /cannot fail and is therefore worse than none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO PAIRS ADDED 2026-08-12, AND THE WATCH OVER THE REST.
//
// [ADR 042]:263 — "Each new pair needs its own two mutations. An unmutated pair
// inflates apparent coverage." So each of settings and home carries BOTH below,
// and both were ALSO run against a copy of the real tree before these fixtures
// were written — a fixture encodes the same misunderstanding as the guard it
// was written beside, so it is the second line of evidence, never the first.
//
// ⚠️ TWO ASSERTIONS HERE CANNOT BE REACHED FROM A FIXTURE TREE, and saying so is
// the honest thing rather than writing a case that only looks like it covers
// them: MIN_PARITY_PAIRS and MIN_ACCOUNTED_PAIRS are module constants of the
// guard, so no fixture can vary them. Both were negative-tested by mutating a
// COPY of the guard source (tooling/ci → scratchpad) against a copy of the real
// tree: deleting the settings pair → "✗ COVERAGE LOST — 2 accepted-fork parity
// pair(s), expected at least 3"; deleting a watched pair → "✗ COVERAGE LOST —
// 10 chassis/fork screen pair(s) accounted for, expected at least 11".
//
// 🔴 AND THAT PARAGRAPH WAS THE DEFECT, NOT JUST A CAVEAT. Both mutations above
// delete an entry from one of the guard's own arrays — they exercise the VANISH
// direction, which is the direction MIN_ACCOUNTED_PAIRS handles. Its failure
// message claims something stronger: that a pair "in NEITHER" list is caught.
// It could not be. The condition is `PARITY.length + WATCHED.length < 12`,
// three constants in the guard's own source, evaluated without touching the
// filesystem — so a pair ARRIVING on disk was invisible, and one already had:
// `auth/legal_consent_fields.dart` was unlisted while the guard printed ok.
// Negative-testing only the direction the guard handles is the repo's own
// recorded defect. The ARRIVE limb and the cases below are the other direction,
// and unlike the two constants above they ARE reachable from a fixture tree.
// ─────────────────────────────────────────────────────────────────────────────
describe('the ARRIVE limb — a pair that appears on disk in NEITHER list', () => {
  test('🔴 a new chassis screen WITH a Subly counterpart → EXIT 1, naming both paths', () => {
    const root = tree();
    writeFileSync(join(root, `${BRICK_F}/settings/zz_new_screen.dart`), 'class ZzNew {}\n');
    writeFileSync(join(root, `${SUBLY_F}/settings/zz_new_screen.dart`), 'class ZzNew {}\n');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /1 chassis\/fork screen pair\(s\) exist on disk and are in NEITHER list/);
    assert.match(out, /settings\/zz_new_screen\.dart/);
    // The count floor is UNTOUCHED by this mutation — 12 accounted is still 12.
    // Asserting its message is absent is what proves the ARRIVE limb, and not
    // the vanish limb, is what caught this.
    assert.doesNotMatch(out, /expected at least/);
  });

  test('a new chassis screen with NO Subly counterpart is PRINTED, not failed — the path rule cannot see a rename', () => {
    const root = tree();
    writeFileSync(join(root, `${BRICK_F}/settings/zz_chassis_only.dart`), 'class ZzOnly {}\n');
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /have NO same-path Subly counterpart/);
    assert.match(out, /zz_chassis_only\.dart/);
  });

  test('🔴 an EMPTY brick features universe is COVERAGE LOST, not a clean tree', () => {
    const root = tree();
    rmSync(join(root, BRICK_F), { recursive: true, force: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /produced NO \.dart file\(s\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('[ADR 042] the SETTINGS pair — decidable, and therefore enforced', () => {
  test('🔴 the chassis gains a capability the fork lacks → EXIT 1, naming the settings fork', () => {
    const { code, out } = run(tree({
      extra: {
        [SETTINGS_CHASSIS]:
          'class SettingsScreen {\n  Widget build(BuildContext context) {\n' +
          '    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(p);\n' +
          '    if (!caps.canSchedule) return const Unavailable();\n' +
          '    if (!caps.canNotify) return const Unavailable();\n    return const Toggle();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/subscriptiontracker\/lib\/features\/settings\/settings_screen\.dart/);
    assert.match(out, /does NOT read `caps\.canNotify`/);
    assert.match(out, /chassis reads \{canNotify, canSchedule\} · fork reads \{canSchedule\}/);
  });

  test('🔴 the fork drops its gate, COMMENT LEFT IN → EXIT 1 (the stripping is the assertion)', () => {
    // The control that proves the limb reads the settings FORK at all, and that
    // prose cannot satisfy it. An unstripped implementation reads
    // `caps.canSchedule` out of the comment and prints ok.
    const { code, out } = run(tree({
      extra: {
        [SETTINGS_FORK]:
          'class SettingsScreen {\n  Widget build(BuildContext context) {\n' +
          '    // the gate that used to live here read caps.canSchedule\n' +
          '    return const Toggle();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /does NOT read `caps\.canSchedule`/);
    assert.match(out, /chassis reads \{canSchedule\} · fork reads \{—\}/);
  });
});

describe('[ADR 042] the HOME pair — the one no ADR listed', () => {
  test('🔴 the chassis gains a capability the fork lacks → EXIT 1, naming the home fork', () => {
    const { code, out } = run(tree({
      extra: {
        [HOME_CHASSIS]:
          'class HomeScreen {\n  Widget build(BuildContext context) {\n' +
          '    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(p);\n' +
          '    if (!caps.canSchedule) return const Unavailable();\n' +
          '    if (!caps.canNotify) return const Unavailable();\n    return const Toggle();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /apps\/subscriptiontracker\/lib\/features\/home\/home_screen\.dart/);
    assert.match(out, /does NOT read `caps\.canNotify`/);
  });

  test('🔴 the fork drops its gate, COMMENT LEFT IN → EXIT 1', () => {
    const { code, out } = run(tree({
      extra: {
        [HOME_FORK]:
          'class HomeScreen {\n  Widget build(BuildContext context) {\n' +
          '    // this used to pass caps.canSchedule\n    return const Toggle();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /does NOT read `caps\.canSchedule`/);
    assert.match(out, /fork reads \{—\}/);
  });
});

describe('the watch — the eleven pairs this guard does NOT cover, and says so', () => {
  test('🔴 a watched chassis that GAINS a caps gate must demand promotion, not stay quiet', () => {
    // The whole reason the watch exists. Under a guard that only knew the auth
    // pair, this capability reaches every stamped app and not Subly, silently.
    const { code, out } = run(tree({
      extra: {
        [`${BRICK_F}/monetization/paywall_screen.dart`]:
          'class PaywallScreen {\n  Widget build(BuildContext context) {\n' +
          '    if (!caps.canSchedule) return const Empty();\n    return const Paywall();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /1 watched pair\(s\) BECAME DECIDABLE and were not promoted/);
    assert.match(out, /monetization\/paywall_screen\.dart/);
    assert.match(out, /now reads \{canSchedule\}/);
  });

  test('COVERAGE LOST when a watched file is gone — the declaration must stay true', () => {
    const root = tree();
    rmSync(join(root, `${SUBLY_F}/monetization/paywall_screen.dart`));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — the watch lost sight of 1 path\(s\)/);
    assert.match(out, /paywall_screen\.dart — the file is not there/);
  });

  test('the watch is PRINTED on every clean run — a limitation nobody sees is mistaken for coverage', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /11 chassis\/fork screen pair\(s\) are WATCHED, NOT COVERED/);
    assert.match(out, /They fail this guard the day that stops being true/);
    assert.match(out, /lib\/app\.dart, lib\/main\.dart\. The shell pairs .* their content is NOT compared/);
  });

  // ── THE SHELL PAIR — 2026-09-14, O-SHELL-PAIR-UNCOMPARED ─────────────────
  // Before this date no list held lib/app.dart or lib/main.dart, and moving
  // Subly's app.dart aside on the real tree left the guard at EXIT 0. The clean
  // run above is the green control; these are one half moving without the other.
  test('🔴 the FORK shell moves without the brick shell → COVERAGE LOST, naming it', () => {
    const root = tree();
    rmSync(join(root, `${SUBLY_LIB}/app.dart`));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — the watch lost sight of 1 path\(s\)/);
    assert.match(out, /apps\/subscriptiontracker\/lib\/app\.dart — the file is not there/);
  });

  test('🔴 the BRICK shell moves without the fork shell → COVERAGE LOST, naming it', () => {
    const root = tree();
    rmSync(join(root, `${BRICK_LIB}/main.dart`));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib\/main\.dart — the file is not there/);
  });

  test('🔴 the brick shell gains a caps gate the fork never hears about → promotion demanded', () => {
    const { code, out } = run(tree({
      extra: {
        [`${BRICK_LIB}/app.dart`]:
          'class App {\n  Widget build(BuildContext context) {\n' +
          '    if (!caps.canSchedule) return const Empty();\n    return const Shell();\n  }\n}\n',
      },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /1 watched pair\(s\) BECAME DECIDABLE and were not promoted/);
    assert.match(out, /__brick__\/apps\/\{\{app_id\}\}\/lib\/app\.dart\n\s+now reads \{canSchedule\}/);
    assert.match(out, /Its fork is apps\/subscriptiontracker\/lib\/app\.dart/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — A CAPS GATE FOLLOWS THE SCREEN INTO THE CHASSIS (ADR 067 dec. 2)
//
// [ADR 066] named this guard's zero-caps limb as one of the THREE HARD
// CONSTRAINTS on chassis step 4, and it was right to: emptying
// `sign_in_screen.dart` into `package:nikatru_chassis_screens` takes the
// `if (caps.oauthRedirect …)` gate with it, C goes to zero at the adapter, and
// C ⊆ F becomes a test that cannot fail. The guard says COVERAGE LOST — about
// the file it read, and about a tree where the gate is one import away.
//
// So C and F are taken over the adapter PLUS what it delegates to. WHAT THE
// TESTS BELOW PIN, in this order:
//   D1  the union is real            — parity holds with the gate in the package
//   D2  the fork must still match    — the adapter dropping its read still FAILS
//   D3  the zero-caps rule SURVIVES  — an empty UNION still fails, still naming
//                                      the adapter, which is the limb [ADR 066]
//                                      measured and the one thing that must not
//                                      be softened to make step 4 land
//   D4  a delegation that resolves to nothing is COVERAGE LOST
//   D5  two chassis imports in one adapter is refused, not guessed
//
// D1 is the green control for all four reds. Without it every one of them is
// consistent with a resolver that refuses every delegation.
// ─────────────────────────────────────────────────────────────────────────────
describe('a caps gate that moved into the chassis is still compared', () => {
  const CHASSIS_BODY = 'packages/chassis_screens/lib/sign_in_body.dart';

  /** The chassis side emptied into the package, adapter left behind.
   *
   *  `gateInAdapter` — the adapter keeps a live `caps.<field>` read of its own.
   *  [ADR 066]'s zero-caps tripwire is evaluated HERE and nowhere else, so this
   *  is the flag D3 turns off.
   *  `extraGateInPackage` — the package gates on a SECOND field the adapter
   *  never mentions. That is what D2b uses to prove the union is real.
   *  `adapterUsesBody` / `forkUnusedImport` — an import that is never used.
   *  D7 and D8 are the cases the 2026-09-05 review demonstrated on the real
   *  tree: one unused import line turned a deleted gate from EXIT 1 to EXIT 0. */
  const delegating = ({
    gateInAdapter = true,
    extraGateInPackage = false,
    packageOnDisk = true,
    forkReads = true,
    forkFollowsExtra = true,
    secondImport = false,
    adapterUsesBody = true,
    forkUnusedImport = false,
  } = {}) => {
    const extra = {};
    extra[CHASSIS] =
      "import 'package:flutter/material.dart';\n" +
      "import 'package:nikatru_chassis_screens/sign_in_body.dart';\n" +
      (secondImport ? "import 'package:nikatru_chassis_screens/other_body.dart';\n" : '') +
      '\nclass SignInScreen {\n  Widget build(BuildContext context) {\n' +
      '    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);\n' +
      (gateInAdapter
        ? '    if (caps.oauthRedirect) return const AppleButton();\n'
        : '    if (providers.any) return const AppleButton();\n') +
      `    return const ${adapterUsesBody ? 'SignInBody' : 'Empty'}();\n  }\n}\n`;
    if (packageOnDisk) {
      extra[CHASSIS_BODY] =
        'class SignInBody {\n  Widget build(BuildContext context) {\n' +
        '    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);\n' +
        '    if (caps.oauthRedirect) return const AppleButton();\n' +
        (extraGateInPackage ? '    if (caps.canNotify) return const Bell();\n' : '') +
        '    return const Empty();\n  }\n}\n';
    }
    if (secondImport) {
      extra['packages/chassis_screens/lib/other_body.dart'] =
        'class OtherBody {\n  Widget build(BuildContext context) => const Empty();\n}\n';
    }
    if (!forkReads || !forkFollowsExtra || forkUnusedImport) {
      extra[FORK] =
        (forkUnusedImport ? "import 'package:nikatru_chassis_screens/sign_in_body.dart';\n\n" : '') +
        'class LoginScreen {\n  Widget build(BuildContext context) {\n' +
        '    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);\n' +
        (forkReads
          ? '    if (caps.oauthRedirect && providers.any) return const AppleButton();\n'
          : '    if (providers.any) return const AppleButton();\n') +
        (extraGateInPackage && forkFollowsExtra ? '    if (caps.canNotify) return const Bell();\n' : '') +
        '    return const Empty();\n  }\n}\n';
    }
    return tree({ extra });
  };

  // GREEN CONTROL.
  test('D1 · the gate is in the package, the adapter still gates, parity holds', () => {
    const { code, out } = run(delegating());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no seam forks/);
  });

  // THE MUTATION THE PARITY LIMB EXISTS FOR, through a delegation.
  test('D2 · the FORK drops the read the chassis package still gates on', () => {
    const { code, out } = run(delegating({ forkReads: false }));
    assert.equal(code, 1, out);
    assert.match(out, /does NOT read `caps.oauthRedirect`/);
    assert.match(out, /chassis reads \{oauthRedirect\}/);
  });

  // THE UNION IS REAL, AND IT IS ENFORCED. The package gates on a field the
  // adapter never mentions; the fork must follow it there. Without this case,
  // D1 is equally consistent with a resolver that reads only the adapter.
  test('D2b · a gate that exists ONLY in the package is still a gate the fork must follow', () => {
    const { code, out } = run(delegating({ extraGateInPackage: true, forkFollowsExtra: false }));
    assert.equal(code, 1, out);
    assert.match(out, /does NOT read `caps.canNotify`/);
    assert.match(out, /chassis reads \{canNotify, oauthRedirect\}/);
  });

  // ── [ADR 066] HARD CONSTRAINT #2, ON THE ADAPTER, UNWIDENED ───────────────
  // Shipped on 2026-09-05 evaluated over the adapter ∪ package UNION, and a
  // review stripped every `caps.` read out of the adapter, left the package
  // mentioning `caps.oauthRedirect`, and watched EXIT 1 become EXIT 0. The
  // tripwire's subject is whether THIS FILE still gates on anything.
  test('D3 · the adapter gating on NOTHING still fails, even though the package gates', () => {
    const { code, out } = run(delegating({ gateInAdapter: false }));
    assert.equal(code, 2, out);
    assert.match(out, /sign_in_screen\.dart — 0 `caps\.<field>` read\(s\) found IN THE ADAPTER ITSELF/);
    assert.match(out, /the tripwire is about whether this file still gates on anything/);
    assert.match(out, /the subset test cannot fail and is therefore worse than none/);
  });

  test('D4 · COVERAGE LOST when the delegation resolves to nothing on disk', () => {
    const { code, out } = run(delegating({ packageOnDisk: false }));
    assert.equal(code, 2, out);
    assert.match(out, /delegates to `package:nikatru_chassis_screens\/sign_in_body\.dart`/);
    assert.match(out, /that file is not on disk/);
  });

  test('D5 · two chassis imports in one adapter is refused, not guessed', () => {
    const { code, out } = run(delegating({ secondImport: true }));
    assert.equal(code, 2, out);
    assert.match(out, /imports 2 different `package:nikatru_chassis_screens` paths/);
    assert.match(out, /will not guess between two of them/);
  });

  // The floors [ADR 066] named are UNTOUCHED by the widening — asserted, not
  // asserted-about. A delegating screen is still a screen that must EXIST at its
  // declared path, and the pair count is still 12 — RAISED to 14 on 2026-09-14
  // by the two watched shell pairs (O-SHELL-PAIR-UNCOMPARED), not by delegation.
  test('D6 · MIN_ACCOUNTED_PAIRS and the per-file existsSync are unchanged', () => {
    const guard = readFileSync(GUARD, 'utf8');
    assert.match(guard, /const MIN_ACCOUNTED_PAIRS = 14;/);
    // The adapter is a FILE. Deleting it is still loud, delegation or not.
    const root = delegating();
    rmSync(join(root, CHASSIS));
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /the file is not there/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D7 AND D8 — THE EXPLOIT, REPRODUCED AS A TEST.
  //
  // 2026-09-05, measured on the real tree by an independent reviewer:
  //   1. `apps/subscriptiontracker/.../login_screen.dart`, `caps.oauthRedirect` gate deleted
  //      → EXIT 1, "1 accepted fork(s) have fallen behind the chassis screen".
  //   2. ONE line added — `import 'package:nikatru_chassis_screens/sign_in.dart';`
  //      — with the target merely MENTIONING `caps.oauthRedirect`, nothing in
  //      the fork using it → SAME TREE, EXIT 0, "follows all 1 chassis caps".
  // The union was taken on the strength of an import line alone. Every
  // delegation case above has its adapter genuinely delegating, so not one of
  // them ranged over this. These two do.
  // ─────────────────────────────────────────────────────────────────────────
  test('D7 · 🔴 the fork drops its gate and adds an UNUSED chassis import — still EXIT 1', () => {
    const { code, out } = run(delegating({ forkReads: false, forkUnusedImport: true }));
    assert.equal(code, 2, out);
    assert.match(out, /never references anything it declares \(SignInBody\)/);
    assert.match(out, /a reference is evidence/);
  });

  test('D8 · 🔴 the ADAPTER imports the package and never uses it — refused, not followed', () => {
    const { code, out } = run(delegating({ adapterUsesBody: false }));
    assert.equal(code, 2, out);
    assert.match(out, /never references anything it declares \(SignInBody\)/);
    assert.match(out, /dead code wearing a delegation's costume/);
  });
});

// ── LANDED BEHAVIOUR PARITY (app-blockers wave, 2026-09-11) ─────────────────
describe('the landed-behaviour limb', () => {
  test('a clean tree reports every landed row at parity', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /landed parity — reminders-off-cancels-only-its-own-id/);
    assert.match(r.out, /3 landed behaviour\(s\) at parity/);
  });

  test('the STAMP reverted to cancelAll() fails, naming the row and the side', () => {
    const r = run(tree({ extra: { [LANDED_PROVIDERS_CHASSIS]: 'Future<void> f() async {\n  await svc.cancelAll();\n}\n' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reminders-off-cancels-only-its-own-id/);
    assert.match(r.out, /the stamp .* does not have the landed shape/);
  });

  test('a HALF-port — the fix added beside the old call — still fails on the defect shape', () => {
    const r = run(tree({ extra: { [LANDED_PROVIDERS_FORK]: 'Future<void> f() async {\n  await svc.cancel(kDailyReminderId);\n  await svc.cancelAll();\n}\n' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the app .* still carries the defect shape/);
  });

  test('the APP without MoneyFormatter on the promo price fails', () => {
    const r = run(tree({
      extra: {
        [HOME_FORK]:
          'class HomeScreen {\n  Widget build(BuildContext context) {\n' +
          '    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(p);\n' +
          '    if (!caps.canSchedule) return const Unavailable();\n' +
          '    decide(hasContent: offerings.isNotEmpty && rail.canStartCheckout);\n' +
          '    return PromoCard(priceLabel: l10n.promoCardPrice(offering.formattedPrice, term));\n  }\n}\n',
      },
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /promo-price-through-money-formatter/);
  });

  test('the landed shape inside a COMMENT does not satisfy the row', () => {
    const r = run(tree({ extra: { [LANDED_PROVIDERS_FORK]: '// await svc.cancel(kDailyReminderId);\nFuture<void> f() async {}\n' } }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reminders-off-cancels-only-its-own-id/);
  });

  test('a row whose file is missing is COVERAGE LOST, never a pass', () => {
    const r = run(tree({ omit: [LANDED_PROVIDERS_FORK] }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the landed-behaviour limb/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 — MoneyFormatter HAS ONE IMPLEMENTATION, IN nikatru_core.
// The app and the brick each carried a copy and this guard's LANDED_PAIRS row
// pinned only the promo call site, so deleting or editing the brick copy left
// everything green. The class moved to packages/core beside Money; both old files
// are one re-export. These cases read the REAL tree.
// ─────────────────────────────────────────────────────────────────────────────
describe('MoneyFormatter has ONE implementation, in nikatru_core', () => {
  const REPO = resolve(CI_DIR, '..', '..');
  const HOME = 'packages/core/lib/src/money/money_format.dart';
  const SHIMS = [
    'apps/subscriptiontracker/lib/core/format/money_format.dart',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/core/format/money_format.dart',
  ];
  const SKIP = /(^|[\\/])(\.dart_tool|build|\.git|node_modules)([\\/]|$)/;
  const dartUnder = (rel) =>
    readdirSync(join(REPO, rel), { recursive: true })
      .map((p) => String(p))
      .filter((p) => p.endsWith('.dart') && !SKIP.test(p))
      .map((p) => join(rel, p).replaceAll('\\', '/'));
  const declares = (text) => /^\s*(?:(?:abstract|base|final|sealed|interface)\s+)*class\s+MoneyFormatter\b/m.test(text);

  test('exactly one class MoneyFormatter across packages/, apps/ and the brick — in nikatru_core', () => {
    const found = [...dartUnder('packages'), ...dartUnder('apps'), ...dartUnder('tooling/bricks')].filter((rel) =>
      declares(readFileSync(join(REPO, rel), 'utf8')),
    );
    assert.deepEqual(found, [HOME]);
  });

  test('the app and the brick carry the SAME re-export and no implementation', () => {
    const [appShim, brickShim] = SHIMS.map((rel) => readFileSync(join(REPO, rel), 'utf8'));
    assert.equal(brickShim, appShim, 'the brick and the app must re-export identically');
    assert.match(appShim, /export 'package:nikatru_core\/nikatru_core\.dart'\s+show Money, MoneyBag, MoneyFormatter;/);
    assert.doesNotMatch(appShim, /\bNumberFormat\b|^\s*import\s/m, 'a re-export imports nothing and formats nothing');
  });

  test('nikatru_core exports the implementation', () => {
    const barrel = readFileSync(join(REPO, 'packages/core/lib/nikatru_core.dart'), 'utf8');
    assert.match(barrel, /^export 'src\/money\/money_format\.dart';$/m);
  });
});
