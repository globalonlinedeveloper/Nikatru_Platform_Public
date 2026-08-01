// ─────────────────────────────────────────────────────────────────────────────
// package-boundaries.test.mjs — assert-package-boundaries.mjs must be able to FAIL.
//
// [pipeline C-5] core stays pure Dart · the design system stays domain-free · an
// app never imports a vendor SDK an adapter already wraps.
//
// ⚠️ THESE FIXTURES ARE THE SECOND LINE OF EVIDENCE. The guard's whole premise —
// that checking pubspecs is not enough — was established by breaking the REAL
// repository first, twice, and watching the toolchain report success:
//
//   · `import 'package:flutter/material.dart'` + `Color? purityIsDead;` added to
//     packages/core/lib/src/result.dart with its pubspec untouched
//        → `dart analyze packages/core` **exit 0**
//   · `import 'package:nikatru_core/...'` + `Failure? domainLeaked;` added to
//     design_system's paywall_gate.dart, pubspec untouched
//        → `dart analyze packages/design_system` **exit 0**
//
// Both resolve because every package here sets `resolution: workspace`, and pub
// workspaces share one package config — so a member can import anything any
// other member depends on. The analyzer's only complaint is the INFO
// `depend_on_referenced_packages`, and this workspace keeps infos non-fatal.
// The original C-5 acceptance criterion (pubspecs only) could not have failed.
//
// Seven mutations were then run against the real tree, all caught, before a line
// of this file existed:
//   1. Flutter imported into core            5. an adapter losing its vendor dep
//   2. core imported into design_system         (COVERAGE LOST + a stale entry)
//   3. the brick reaching for dio directly   6. core importing undeclared `meta`
//   4. a plugin added to core's pubspec      7. a grandfathered bypass FIXED
//                                               (the stale-entry direction)
//
// An EIGHTH mutation, 2026-08-01, that all seven above had missed: the import
// scanner hardcoded the single quote, so `import "package:flutter/material.dart"`
// added to packages/core/lib/src/result.dart left the guard printing "core is
// pure" (the single-quoted control failed correctly). All three C-5 limbs route
// through that one function, so quote style walked through every one of them.
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
const GUARD = join(CI_DIR, 'assert-package-boundaries.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-bounds-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/**
 * A tree that MIRRORS THE REAL REPOSITORY, not a minimal one.
 *
 * That distinction is load-bearing here. The derived wrapped-vendor set has a
 * floor of 6, and the three grandfathered Subly bypasses must be present or the
 * guard's stale-entry check fires on every case. A thinner fixture would fail
 * for reasons unrelated to the behaviour under test — and, worse, a fixture with
 * no adapters at all would let a broken derivation look clean, which is the
 * precise failure this guard's own coverage check exists to prevent.
 */
function tree({
  coreDeps = '  crypto: ^3.0.0\n  cryptography: ^2.9.0\n',
  coreImports = "import 'package:crypto/crypto.dart';\nimport 'package:cryptography/cryptography.dart';\n",
  dsDeps = '  flutter:\n    sdk: flutter\n',
  dsImports = "import 'package:flutter/material.dart';\n",
  apiClientDeps = '  dio: ^5.4.0\n  nikatru_core:\n    path: ../core\n',
  authDeps = '  flutter:\n    sdk: flutter\n  nikatru_core:\n    path: ../core\n  supabase_flutter: ^2.16.0\n',
  sublyImports = null,
  brickImports = "import 'package:flutter/material.dart';\n",
  extra = {},
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = {};
  const spec = (name, deps) =>
    `name: ${name}\npublish_to: none\nresolution: workspace\n\nenvironment:\n  sdk: ">=3.5.0 <4.0.0"\n\ndependencies:\n${deps}\ndev_dependencies:\n  lints: ^6.0.0\n`;

  files[join(root, 'packages/core/pubspec.yaml')] = spec('nikatru_core', coreDeps);
  files[join(root, 'packages/core/lib/src/result.dart')] = coreImports;

  files[join(root, 'packages/design_system/pubspec.yaml')] = spec('nikatru_design_system', dsDeps);
  files[join(root, 'packages/design_system/lib/src/theme.dart')] = dsImports;

  // The four adapters, carrying the six wrapped vendors the floor expects.
  files[join(root, 'packages/api_client/pubspec.yaml')] = spec('nikatru_api_client', apiClientDeps);
  files[join(root, 'packages/notifications/pubspec.yaml')] = spec(
    'nikatru_notifications',
    '  flutter:\n    sdk: flutter\n  nikatru_core:\n    path: ../core\n  flutter_local_notifications: ^17.2.0\n  timezone: ^0.9.4\n',
  );
  files[join(root, 'packages/platform_storage/pubspec.yaml')] = spec(
    'nikatru_platform_storage',
    '  flutter:\n    sdk: flutter\n  nikatru_core:\n    path: ../core\n  shared_preferences: ^2.2.0\n  flutter_secure_storage: ^9.0.0\n',
  );
  files[join(root, 'packages/auth_supabase/pubspec.yaml')] = spec('nikatru_auth_supabase', authDeps);
  files[join(root, 'packages/telemetry/pubspec.yaml')] = spec(
    'nikatru_telemetry',
    '  flutter:\n    sdk: flutter\n  sentry_flutter: ^9.24.0\n',
  );
  // A lint-config package. It declares a third-party dep like an adapter does,
  // but a lint ruleset is config, not a wrapped SDK — nobody imports it in code.
  // Present so the "is it excluded?" question is answered by the fixture too.
  files[join(root, 'packages/analysis/pubspec.yaml')] = spec('nikatru_analysis', '  flutter_lints: ^6.0.0\n');

  // Subly, carrying the three real grandfathered bypasses.
  files[join(root, 'apps/subly/lib/services/notifications/notification_service.dart')] =
    sublyImports ??
    "import 'package:flutter_local_notifications/flutter_local_notifications.dart';\nimport 'package:timezone/timezone.dart' as tz;\n";
  files[join(root, 'apps/subly/lib/data/auth/supabase_auth_repository.dart')] =
    "import 'package:supabase_flutter/supabase_flutter.dart' as sb;\n";
  files[join(root, 'apps/subly/lib/data/api/dio_api_client.dart')] =
    "import 'package:dio/dio.dart';\nimport 'package:nikatru_api_client/nikatru_api_client.dart';\n";

  files[join(root, 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart')] = brickImports;

  for (const [rel, body] of Object.entries(extra)) files[join(root, rel)] = body;

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

describe('assert-package-boundaries', () => {
  test('passes on a tree shaped like the real repository', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /derived 7 wrapped vendor\(s\) from 5 adapter\(s\)/);
    // flutter_lints must NOT be treated as a wrapped vendor.
    assert.doesNotMatch(out, /flutter_lints/);
    // The real debt is printed, every run.
    assert.match(out, /4 grandfathered adapter bypass\(es\)/);
  });

  // ── A · core stays pure Dart ───────────────────────────────────────────────
  describe('core purity', () => {
    // THE CASE THE OLD CRITERION COULD NOT CATCH. `dart analyze` exits 0 here.
    test('FAILS when core IMPORTS Flutter with its pubspec untouched', () => {
      const { code, out } = run(tree({
        coreImports: "import 'package:crypto/crypto.dart';\nimport 'package:cryptography/cryptography.dart';\nimport 'package:flutter/material.dart';\n",
      }));
      assert.equal(code, 1);
      assert.match(out, /core IMPORTS `package:flutter`/);
      assert.match(out, /a pub workspace resolves it anyway/);
    });

    test('FAILS when core declares a Flutter SDK dependency', () => {
      const { code, out } = run(tree({ coreDeps: '  crypto: ^3.0.0\n  flutter:\n    sdk: flutter\n' }));
      assert.equal(code, 1);
      assert.match(out, /core declares `flutter` from an SDK/);
    });

    // An allowlist, not a ban-list: a ban-list only stops the plugins somebody
    // thought of, so a NEW dependency must be a reviewed event whatever it is.
    test('FAILS when a plugin is added to core, even a plausible one', () => {
      const { code, out } = run(tree({ coreDeps: '  crypto: ^3.0.0\n  cryptography: ^2.9.0\n  shared_preferences: ^2.2.0\n' }));
      assert.equal(code, 1);
      assert.match(out, /`shared_preferences`, which is not on the pure-Dart allowlist/);
    });

    // The general form of the workspace hole: the package need not be Flutter.
    test('FAILS when core imports any undeclared package', () => {
      const { code, out } = run(tree({
        coreImports: "import 'package:crypto/crypto.dart';\nimport 'package:cryptography/cryptography.dart';\nimport 'package:meta/meta.dart';\n",
      }));
      assert.equal(code, 1);
      assert.match(out, /core imports `package:meta`.*without declaring it/s);
    });

    // `package:` inside prose is not a dependency — the sibling-guard mistake
    // where a grep matched the comment explaining why a thing was absent.
    test('does NOT fire on package: mentioned in a comment', () => {
      const { code } = run(tree({
        coreImports: "// never do this: import 'package:flutter/material.dart';\nimport 'package:crypto/crypto.dart';\nimport 'package:cryptography/cryptography.dart';\n",
      }));
      assert.equal(code, 0);
    });

    // 🔴 QUOTE STYLE IS NOT A BOUNDARY (2026-08-01 full-corpus review). The
    // scanner hardcoded `'`, and Dart accepts `"` — so a double-quoted import
    // walked through ALL THREE C-5 limbs invisibly. Mutation-proven on the real
    // packages/core: the double-quoted form left the guard printing "core is
    // pure" while the single-quoted control failed. Nothing else contradicts it
    // either — `prefer_single_quotes` is a non-fatal INFO under this
    // workspace's analyze posture and `dart format` does not normalise quotes.
    test('FAILS when core imports Flutter with DOUBLE quotes', () => {
      const { code, out } = run(tree({
        coreImports: "import 'package:crypto/crypto.dart';\nimport 'package:cryptography/cryptography.dart';\nimport \"package:flutter/material.dart\";\n",
      }));
      assert.equal(code, 1, 'a boundary quote style can walk around is not a boundary');
      assert.match(out, /core IMPORTS `package:flutter`/);
    });

    test('FAILS when core EXPORTS an undeclared package with double quotes', () => {
      const { code, out } = run(tree({
        coreImports: "import 'package:crypto/crypto.dart';\nimport 'package:cryptography/cryptography.dart';\nexport \"package:meta/meta.dart\";\n",
      }));
      assert.equal(code, 1);
      assert.match(out, /core imports `package:meta`.*without declaring it/s);
    });

    test('does NOT fire on a DOUBLE-quoted package: mentioned in a comment', () => {
      const { code, out } = run(tree({
        coreImports: "// never do this: import \"package:flutter/material.dart\";\nimport 'package:crypto/crypto.dart';\nimport 'package:cryptography/cryptography.dart';\n",
      }));
      assert.equal(code, 0, out);
    });

    test('FAILS rather than reporting clean when core has no imports at all', () => {
      const { code, out } = run(tree({ coreImports: '// nothing here\n' }));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — no `package:` imports found anywhere under packages\/core\/lib/);
    });
  });

  // ── B · the design system stays domain-free ───────────────────────────────
  describe('design system domain-freedom', () => {
    // The failure 39-CHASSIS §6 names by hand: "just read isPro".
    test('FAILS when design_system IMPORTS core with its pubspec untouched', () => {
      const { code, out } = run(tree({
        dsImports: "import 'package:flutter/material.dart';\nimport 'package:nikatru_core/nikatru_core.dart';\n",
      }));
      assert.equal(code, 1);
      assert.match(out, /design_system IMPORTS `package:nikatru_core`/);
    });

    test('FAILS when design_system IMPORTS core with DOUBLE quotes — limb B', () => {
      const { code, out } = run(tree({
        dsImports: "import 'package:flutter/material.dart';\nimport \"package:nikatru_core/nikatru_core.dart\";\n",
      }));
      assert.equal(code, 1);
      assert.match(out, /design_system IMPORTS `package:nikatru_core`/);
    });

    test('FAILS when design_system declares a domain package', () => {
      const { code, out } = run(tree({ dsDeps: '  flutter:\n    sdk: flutter\n  nikatru_core:\n    path: ../core\n' }));
      assert.equal(code, 1);
      assert.match(out, /design_system declares `nikatru_core`/);
    });
  });

  // ── C · apps never go around an adapter ──────────────────────────────────
  describe('adapter bypasses', () => {
    test('FAILS on a NEW bypass in the brick template', () => {
      const { code, out } = run(tree({
        brickImports: "import 'package:flutter/material.dart';\nimport 'package:dio/dio.dart';\n",
      }));
      assert.equal(code, 1);
      assert.match(out, /brick imports `package:dio` directly/);
      assert.match(out, /`packages\/api_client` already wraps it/);
    });

    test('FAILS on a NEW bypass written with DOUBLE quotes — limb C', () => {
      const { code, out } = run(tree({
        brickImports: "import 'package:flutter/material.dart';\nimport \"package:dio/dio.dart\";\n",
      }));
      assert.equal(code, 1);
      assert.match(out, /brick imports `package:dio` directly/);
    });

    // The lock's explicit requirement: this set must never range over nothing.
    // An adapter that stops declaring its SDK is exactly how it would.
    test('FAILS rather than passing everything when the vendor set shrinks', () => {
      const { code, out } = run(tree({ apiClientDeps: '  nikatru_core:\n    path: ../core\n' }));
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — derived only 6 wrapped vendor\(s\)/);
      assert.match(out, /would range over an almost-empty set and pass everything/);
    });

    // Debt that has been paid must leave the list, or the list stops meaning
    // anything — the same discipline as a stale coverage claim.
    test('FAILS on a stale grandfather entry once the bypass is fixed', () => {
      const { code, out } = run(tree({ sublyImports: "import 'package:timezone/timezone.dart' as tz;\n" }));
      assert.equal(code, 1);
      assert.match(out, /KNOWN_BYPASSES still lists `apps\/subly\|flutter_local_notifications`/);
      assert.match(out, /It was fixed — delete the entry/);
    });

    test('FAILS rather than reporting clean when there is nothing to scan', () => {
      const root = tree();
      rmSync(join(root, 'apps'), { recursive: true, force: true });
      rmSync(join(root, 'tooling'), { recursive: true, force: true });
      const { code, out } = run(root);
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — no app or brick lib\/ directory found/);
    });
  });
});
