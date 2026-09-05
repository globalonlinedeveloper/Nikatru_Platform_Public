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
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
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
const FORK = 'apps/subly/lib/features/auth/login_screen.dart';

/** The other two DECIDABLE pairs, added 2026-08-12. Same shape, different seam:
 *  both gate on `caps.canSchedule` off NotificationCapabilities. */
const BRICK_F = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features';
const SUBLY_F = 'apps/subly/lib/features';
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

/** A tree with: core declaring two contracts, packages/ implementing ONE of them
 *  (so the other is deliberately homeless), the parity pair at parity, plus
 *  whatever `extra` files a case needs. MIN_CONTRACTS is 5, so the register
 *  declares five. */
function tree({ extra = {}, violations = null } = {}) {
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
  files[join(root, HOME_CHASSIS)] = schedGate('HomeScreen');
  files[join(root, HOME_FORK)] = schedGate('HomeScreen');

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
// The reversal deleted `apps/subly/lib/data/auth/supabase_auth_repository.dart`
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
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register is absent', () => {
    const root = tree();
    rmSync(join(root, 'tooling/capability-register.json'));
    const { code, out } = run(root);
    assert.equal(code, 1);
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
// cannot push `tooling/bricks` below its floor of 11. The brick contributes 12
// files to every fixture tree — 3 parity chassis + 9 watched chassis — and
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
function checkout(root, { apps = 40, packages = 95, bricks = 14 } = {}) {
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
    assert.match(out, /tooling\/bricks=14\/floor 11/);
  });

  test('🔴 apps/ alone below its floor fails, though the UNION is twenty times the old one', () => {
    // apps = 12 (the chassis/fork pair files only), union = 12 + 300 + 14 = 326.
    // The old `< 10` floor was satisfied three hundred times over. This is the
    // defect, and it is red only because the floor is now per root.
    const { code, out } = run(checkout(tree(), { apps: 0, packages: 300, bricks: 14 }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — 1 of the 3 declared root\(s\)/);
    assert.match(out, /`apps` yielded only 12 file\(s\) to classify, below its floor of 37/);
  });

  test('🔴 packages/ below its floor fails — with nothing homed, no fork can be a fork', () => {
    const { code, out } = run(checkout(tree(), { packages: 89 }));
    assert.equal(code, 1, out);
    assert.match(out, /`packages` yielded only 89 file\(s\) to classify, below its floor of 90/);
    assert.match(out, /every fork is reclassified "homeless"/);
  });

  test('the floor is exact: 37 passes, 36 does not', () => {
    const green = run(checkout(tree(), { apps: 37 }));
    assert.equal(green.code, 0, green.out);
    assert.match(green.out, /apps=37\/floor 37/);
    const red = run(checkout(tree(), { apps: 36 }));
    assert.equal(red.code, 1, red.out);
    assert.match(red.out, /below its floor of 37/);
  });

  test('two roots lost are reported TOGETHER, not one at a time', () => {
    // Naming only the first sends the reader to fix half of it.
    const { code, out } = run(checkout(tree(), { apps: 20, packages: 50 }));
    assert.equal(code, 1, out);
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
    const root = checkout(tree(), { apps: 0, packages: 95, bricks: 14 });
    for (let i = 0; i < 200; i++) {
      const p = join(root, `apps/padapp/test/t${i}.dart`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, '// double\n');
    }
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /`apps` yielded only 12 file\(s\) to classify/);
  });
});

describe('a declared root that delivers NOTHING is COVERAGE LOST, checkout or not', () => {
  for (const dir of ['apps', 'packages', 'tooling/bricks']) {
    test(`${dir} absent → named, and named FIRST`, () => {
      const root = tree();
      rmSync(join(root, dir), { recursive: true, force: true });
      const { code, out } = run(root);
      assert.equal(code, 1, out);
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
    assert.equal(code, 1, out);
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
    assert.equal(code, 1, out);
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
    assert.match(out, /\[ADR 042\] parity — apps\/subly\/lib\/features\/auth\/login_screen\.dart follows all 1 chassis/);
    assert.match(out, /3 accepted fork\(s\) at parity, 9 watched/);
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
    assert.match(out, /apps\/subly\/lib\/features\/auth\/login_screen\.dart/);
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — the accepted-fork parity limb reached nothing/);
    assert.match(out, /sign_in_screen\.dart — the file is not there/);
  });

  test('COVERAGE LOST when the FORK file is gone — a converged fork must be DECIDED, not 404d', () => {
    const root = tree();
    rmSync(join(root, FORK));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
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
    assert.equal(code, 1, out);
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
    assert.equal(code, 1, out);
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
    assert.match(out, /apps\/subly\/lib\/features\/settings\/settings_screen\.dart/);
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
    assert.match(out, /apps\/subly\/lib\/features\/home\/home_screen\.dart/);
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

describe('the watch — the nine pairs this guard does NOT cover, and says so', () => {
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
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — the watch lost sight of 1 path\(s\)/);
    assert.match(out, /paywall_screen\.dart — the file is not there/);
  });

  test('the watch is PRINTED on every clean run — a limitation nobody sees is mistaken for coverage', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /9 chassis\/fork screen pair\(s\) are WATCHED, NOT COVERED/);
    assert.match(out, /They fail this guard the day that stops being true/);
  });
});
