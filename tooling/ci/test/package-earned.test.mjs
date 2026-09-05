// ─────────────────────────────────────────────────────────────────────────────
// package-earned.test.mjs — assert-package-earned.mjs must be able to FAIL.
//
// [pipeline C-4] A package is earned, never named. A new package needs a native
// binary payload, a licence exposure, or a codegen step; a capability name is
// not a reason.
//
// ⚠️ SECOND LINE OF EVIDENCE. Six mutations were run against the REAL repository
// first — the register and the real package tree — and all six were caught:
//   1. a new `packages/share` with no earn-reason (the C-4 failure itself)
//   2. flutter_secure_storage removed from platform_storage's pubspec, so the
//      native-binary claim no longer substantiates
//   3. the style-dictionary config deleted, so the codegen claim points at
//      nothing
//   4. `declaredOn` removed from a grandfathered entry
//   5. free text put back in the `reason` field
//   6. every package turned GRANDFATHERED, i.e. the rule enforcing nothing
//
// The arithmetic in the C-4 lock was verified against the tree before any of
// this was designed: of 8 packages exactly 4 substantiate a structural reason
// (platform_storage / notifications / telemetry — native; tokens — codegen) and
// exactly 4 substantiate nothing (core / design_system / api_client / analysis).
// The lock's "four day-one packages that substantiate nothing" is exactly right.
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
const GUARD = join(CI_DIR, 'assert-package-earned.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-earned-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/**
 * A tree mirroring the real one: EIGHT packages, four substantiating and four
 * grandfathered. The package floor is 8 and the "nothing substantiates"
 * coverage check needs a non-zero substantiated count, so a thinner fixture
 * would fail for reasons unrelated to the case under test — and a fixture with
 * no substantiating packages at all would agree with a guard whose
 * substantiation had stopped running.
 */
function tree({ mutate = (r) => r, dropBuildFile = false, extraPkgs = [], dropPkgs = [], ledger = null } = {}) {
  const root = join(TMP, `r${seq++}`);
  const G = (detail) => ({ reason: 'GRANDFATHERED', declaredOn: '2026-07-28', detail });

  let register = {
    consumerRoots: ['apps/subly'],
    packageEarnReasons: {
      _why: ['fixture'],
      'packages/platform_storage': { reason: 'native-binary', evidence: { dependency: 'flutter_secure_storage' }, detail: 'five native keystores behind one Dart call' },
      'packages/notifications': { reason: 'native-binary', evidence: { dependency: 'flutter_local_notifications' }, detail: 'native scheduling APIs per platform' },
      'packages/telemetry': { reason: 'native-binary', evidence: { dependency: 'sentry_flutter' }, detail: 'native crash handlers' },
      'packages/tokens': { reason: 'codegen', evidence: { buildFile: 'packages/tokens/style-dictionary.config.mjs' }, detail: 'a build step, not a library' },
      'packages/core': G('the spine, not an earned split'),
      'packages/design_system': G('pure Flutter widgets; its real justification is the C-5 boundary'),
      'packages/api_client': G('dio is pure Dart, so this substantiates nothing'),
      'packages/analysis': G('a lint ruleset — config, not code'),
    },
    capabilities: [],
  };
  register = mutate(register);

  const files = {};
  files[join(root, 'tooling/capability-register.json')] = JSON.stringify(register, null, 2);

  const spec = (name, deps) => `name: ${name}\npublish_to: none\n\ndependencies:\n${deps}\n`;
  const pkgs = {
    platform_storage: spec('nikatru_platform_storage', '  flutter:\n    sdk: flutter\n  shared_preferences: ^2.2.0\n  flutter_secure_storage: ^9.0.0\n'),
    notifications: spec('nikatru_notifications', '  flutter_local_notifications: ^17.2.0\n  timezone: ^0.9.4\n'),
    telemetry: spec('nikatru_telemetry', '  sentry_flutter: ^9.24.0\n'),
    core: spec('nikatru_core', '  crypto: ^3.0.0\n  cryptography: ^2.9.0\n'),
    design_system: spec('nikatru_design_system', '  flutter:\n    sdk: flutter\n'),
    api_client: spec('nikatru_api_client', '  dio: ^5.4.0\n'),
    analysis: spec('nikatru_lints', '  flutter_lints: ^6.0.0\n'),
  };
  for (const [name, body] of Object.entries(pkgs)) {
    if (dropPkgs.includes(name)) continue;
    files[join(root, `packages/${name}/pubspec.yaml`)] = body;
  }
  // tokens is a Node package: no pubspec, just its build file.
  if (!dropPkgs.includes('tokens')) {
    files[join(root, 'packages/tokens/package.json')] = '{"name":"tokens"}\n';
    if (!dropBuildFile) files[join(root, 'packages/tokens/style-dictionary.config.mjs')] = 'export default {};\n';
  }
  for (const p of extraPkgs) files[join(root, `packages/${p}/pubspec.yaml`)] = spec(`nikatru_${p}`, '  flutter:\n    sdk: flutter\n');

  // The chassis ledger, when a case is about the `chassis` reason. Absent by
  // default — no package in the base fixture claims it, and a ledger nothing
  // reads would make the "could not be read" limb untestable.
  if (ledger !== null) files[join(root, 'tooling/chassis-ledger.json')] = JSON.stringify(ledger, null, 2);

  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, body);
  }
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-package-earned', () => {
  test('passes on a tree shaped like the real repository', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /8 package\(s\) on disk/);
    assert.match(out, /4 package\(s\) substantiate a structural reason/);
    // The exemptions must be visible, every run — an unseen list only grows.
    assert.match(out, /4 package\(s\) earn NONE of the three structural reasons/);
  });

  // THE FAILURE C-4 EXISTS FOR. Left unchecked this is how six packages get
  // spawned for share, deep-links, review, purchases, connectivity, analytics.
  test('FAILS when a new package appears with no earn-reason', () => {
    const { code, out } = run(tree({ extraPkgs: ['share'] }));
    assert.equal(code, 1);
    assert.match(out, /`packages\/share` exists but names no earn-reason/);
    assert.match(out, /the capability belongs in an existing package/);
  });

  describe('a reason must substantiate itself against the tree', () => {
    test('FAILS when the native dependency it cites is no longer declared', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          r.packageEarnReasons['packages/platform_storage'].evidence.dependency = 'not_a_real_dep';
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /claims `native-binary` via `not_a_real_dep`, but its pubspec does not declare/);
    });

    test('FAILS when the codegen build file it cites does not exist', () => {
      const { code, out } = run(tree({ dropBuildFile: true }));
      assert.equal(code, 1);
      assert.match(out, /claims `codegen` via .*style-dictionary.*which does not exist/);
    });

    // The whole reason the enum is closed: free text always passes.
    test('FAILS when free text comes back as a reason', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          r.packageEarnReasons['packages/tokens'].reason = 'we needed a home for this';
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /not in the closed enum/);
      assert.match(out, /a justification nobody can check always passes/);
    });

    test('FAILS when a claim cites no evidence at all', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          delete r.packageEarnReasons['packages/telemetry'].evidence;
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /names no evidence.dependency/);
    });

    test('FAILS when licence-exposure does not name the licence', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          r.packageEarnReasons['packages/telemetry'] = { reason: 'licence-exposure', evidence: { dependency: 'sentry_flutter' }, detail: 'x' };
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /without naming evidence.licence/);
    });
  });

  describe('exemptions stay reviewable', () => {
    // An undated exemption is permanent by accident.
    test('FAILS when a grandfathered package has no date', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          delete r.packageEarnReasons['packages/core'].declaredOn;
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /GRANDFATHERED without a `declaredOn` date/);
    });

    test('FAILS when a grandfathered package gives no reason', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          delete r.packageEarnReasons['packages/api_client'].detail;
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /GRANDFATHERED with no `detail`/);
    });

    // The decorative-guard case: if everything is exempt, nothing is enforced,
    // and the run still reads like a pass.
    test('FAILS when every package becomes grandfathered', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          for (const k of Object.keys(r.packageEarnReasons)) {
            if (k.startsWith('_')) continue;
            r.packageEarnReasons[k] = { reason: 'GRANDFATHERED', declaredOn: '2026-07-28', detail: 'x' };
          }
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /not one package substantiated a structural reason/);
    });
  });

  describe('the list cannot drift from the tree', () => {
    test('FAILS on a justification for a package that no longer exists', () => {
      const { code, out } = run(tree({ dropPkgs: ['telemetry'] }));
      assert.equal(code, 1);
      assert.match(out, /still justifies `packages\/telemetry`, which no longer exists/);
    });

    test('FAILS rather than reporting clean when the register block is missing', () => {
      const { code, out } = run(tree({
        mutate: (r) => {
          delete r.packageEarnReasons;
          return r;
        },
      }));
      assert.equal(code, 1);
      assert.match(out, /has no `packageEarnReasons` block/);
    });

    test('FAILS rather than reporting clean when packages/ has gone thin', () => {
      const { code, out } = run(tree({ dropPkgs: ['telemetry', 'analysis', 'tokens'] }));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — found only \d+ package dir\(s\)/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // `chassis`, AND THE GRANDFATHERED DATE — ADR 067 decision 2 / ADR 066 defect 1
  //
  // THE GREEN CONTROL IS NOT DECORATION HERE. Without it every red below is
  // equally consistent with a `chassis` branch that refuses everything — which
  // would pass this file and fail the first real chassis package.
  // ───────────────────────────────────────────────────────────────────────
  describe('a chassis package is earned by a MEASURED shrink, not by being called one', () => {
    const MOVED = {
      path: 'lib/features/settings/settings_screen.dart',
      verdict: 'MOVES',
      target: 'packages/chassis_screens/lib/src/settings_body.dart',
      callSiteDelta: -212,
    };

    const withChassis = (rows) => ({
      extraPkgs: ['chassis_screens'],
      ledger: { files: rows },
      mutate: (r) => {
        r.packageEarnReasons['packages/chassis_screens'] = {
          reason: 'chassis',
          evidence: { ledgerTarget: 'packages/chassis_screens' },
          detail: 'the measured destination of chassis step 4',
        };
        return r;
      },
    });

    // GREEN CONTROL.
    test('passes when the ledger records a MOVES row into it with a NEGATIVE callSiteDelta', () => {
      const { code, out } = run(tree(withChassis([MOVED])));
      assert.equal(code, 0);
      assert.match(out, /5 package\(s\) substantiate a structural reason/);
    });

    // THE MUTATION [ADR 066]'s rule exists for: the call site got BIGGER.
    test('FAILS when the only MOVES row into it made the call site bigger', () => {
      const { code, out } = run(tree(withChassis([{ ...MOVED, callSiteDelta: 5 }])));
      assert.equal(code, 1);
      assert.match(out, /holds no MOVES row landing there with a NEGATIVE callSiteDelta/);
      assert.match(out, /a package NAMED, not earned/);
    });

    test('FAILS when nothing has moved into it at all', () => {
      const { code, out } = run(tree(withChassis([])));
      assert.equal(code, 1);
      assert.match(out, /holds no MOVES row landing there/);
    });

    // A prefix match on a `/` boundary, so a NEIGHBOURING package cannot pay for
    // this one's place.
    test('FAILS when the shrinking row lands in a DIFFERENT package', () => {
      const { code, out } = run(
        tree(withChassis([{ ...MOVED, target: 'packages/chassis_screens_other/lib/x.dart' }])),
      );
      assert.equal(code, 1);
      assert.match(out, /holds no MOVES row landing there/);
    });

    // An unread ledger and an empty one are different answers, and the guard
    // must say which — collapsing them is how a reader that stopped reaching its
    // file starts reporting no findings.
    test('reports COVERAGE LOST rather than a finding when there is no ledger to read', () => {
      const opts = withChassis([]);
      delete opts.ledger;
      const { code, out } = run(tree(opts));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST/);
      assert.match(out, /not the same as passing/);
    });

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 THE EVIDENCE MUST NAME THE PACKAGE IT JUSTIFIES.
    //
    // `evidence.ledgerTarget` is free text out of a register, and the case
    // above only ever exercised an HONEST one. Measured on the real tree by an
    // independent reviewer, 2026-09-05: register `packages/chassis_screens`
    // with `ledgerTarget: "packages"` and one MOVES row landing in
    // `packages/design_system` with `callSiteDelta: -42` — EXIT 0, "11
    // package(s), 7 substantiated". A shrink measured into a DIFFERENT package
    // earned this one its place, and the widest possible prefix was the cheapest
    // thing to write.
    //
    // Both halves are pinned: a ledgerTarget OUTSIDE the package is refused
    // outright, and a ledgerTarget inside it still cannot be paid for by a row
    // that lands elsewhere.
    // ─────────────────────────────────────────────────────────────────────
    const dishonest = (ledgerTarget, rows) => ({
      extraPkgs: ['chassis_screens'],
      ledger: { files: rows },
      mutate: (r) => {
        r.packageEarnReasons['packages/chassis_screens'] = {
          reason: 'chassis',
          evidence: { ledgerTarget },
          detail: 'the measured destination of chassis step 4',
        };
        return r;
      },
    });

    test('FAILS when evidence.ledgerTarget is a WIDER path than the package it justifies', () => {
      const { code, out } = run(
        tree(dishonest('packages', [{ ...MOVED, target: 'packages/design_system/lib/probe.dart', callSiteDelta: -42 }])),
      );
      assert.equal(code, 1);
      assert.match(out, /is not `packages\/chassis_screens` and does not sit inside it/);
      assert.match(out, /a ledger row measuring a shrink into somewhere else substantiates that somewhere else/);
    });

    test('FAILS when evidence.ledgerTarget names a DIFFERENT package entirely', () => {
      const { code, out } = run(
        tree(dishonest('packages/design_system', [{ ...MOVED, target: 'packages/design_system/lib/probe.dart', callSiteDelta: -42 }])),
      );
      assert.equal(code, 1);
      assert.match(out, /is not `packages\/chassis_screens` and does not sit inside it/);
    });

    // GREEN CONTROL for the pair above — an honest, NARROWER ledgerTarget
    // inside the package still passes, so the two reds are not consistent with
    // a limb that refuses every ledgerTarget.
    test('an honest ledgerTarget NARROWER than the package still passes', () => {
      const opts = dishonest('packages/chassis_screens/lib', [MOVED]);
      const { code, out } = run(tree(opts));
      assert.equal(code, 0, out);
      assert.match(out, /5 package\(s\) substantiate a structural reason/);
    });

    test('FAILS when a chassis claim names no ledgerTarget', () => {
      const { code, out } = run(
        tree({
          extraPkgs: ['chassis_screens'],
          ledger: { files: [MOVED] },
          mutate: (r) => {
            r.packageEarnReasons['packages/chassis_screens'] = { reason: 'chassis', detail: 'x' };
            return r;
          },
        }),
      );
      assert.equal(code, 1);
      assert.match(out, /names no evidence.ledgerTarget/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // [ADR 066] DEFECT 1 — "PREDATES THE RULE" WAS PROSE UNTIL 2026-09-05
  //
  // Measured on the real tree before the fix: a `packages/zzz_probe` declared
  // GRANDFATHERED with the day's own date exited 0 and was merely PRINTED, under
  // a guard comment reading "A NEW package with no reason fails the build".
  // ───────────────────────────────────────────────────────────────────────
  describe('GRANDFATHERED means predates the rule, and the date is checked', () => {
    // GREEN CONTROL: the four real exemptions are dated ON the rule date and must
    // keep passing. Without it the case below is consistent with a branch that
    // refuses every grandfathered package.
    test('passes on the rule date itself', () => {
      const { code } = run(
        tree({
          mutate: (r) => {
            r.packageEarnReasons['packages/core'].declaredOn = '2026-07-28';
            return r;
          },
        }),
      );
      assert.equal(code, 0);
    });

    test('FAILS on a date AFTER the rule date', () => {
      const { code, out } = run(
        tree({
          extraPkgs: ['app_chassis'],
          mutate: (r) => {
            r.packageEarnReasons['packages/app_chassis'] = {
              reason: 'GRANDFATHERED',
              declaredOn: '2026-09-06',
              detail: 'a brand new package claiming an exemption it cannot have',
            };
            return r;
          },
        }),
      );
      assert.equal(code, 1);
      assert.match(out, /GRANDFATHERED with `declaredOn` 2026-09-06, which is AFTER the rule date 2026-07-28/);
      assert.match(out, /a new package claiming an exemption it cannot have/);
    });

    test('a date one day BEFORE the rule date is still a real grandfather clause', () => {
      const { code } = run(
        tree({
          mutate: (r) => {
            r.packageEarnReasons['packages/analysis'].declaredOn = '2026-07-27';
            return r;
          },
        }),
      );
      assert.equal(code, 0);
    });
  });
});
