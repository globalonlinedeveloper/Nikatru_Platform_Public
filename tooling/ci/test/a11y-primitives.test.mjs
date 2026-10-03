// ─────────────────────────────────────────────────────────────────────────────
// a11y-primitives.test.mjs — the red and green controls for
// assert-a11y-primitives.mjs, one limb at a time.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE. A hand-built fixture tree would
// encode the guard's own reading of Dart twice and go green together with it;
// the copy carries every real detector, every real obscured field and the real
// boot path, so a case that adds one instance proves the guard sees it among
// the ones that are really there. The copy is `git init`-ed because the guard
// enumerates with `git ls-files` — one enumeration, both callers.
//
// 🔬 THE RED CONTROLS ON THE BASE, measured 2026-09-28 against main e0beeb14
// (before this change's dialog fix and bootstrap call), with this guard:
// EXIT 1, exactly two lines — `ST-Y3: …destructive_confirm_dialog.dart:229 …
// no autofillHints:` and `ST-Y5: …bootstrap.dart never calls
// enableWebSemantics(): every stamped web app ships no screen-reader tree`.
// The Y3a and Y5 cases below reproduce each by undoing the fix in the copy.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-a11y-primitives.mjs');

const APP = 'apps/subscriptiontracker/lib';
const BRICK_LIB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib';
const DIALOG = 'packages/design_system/lib/src/widgets/destructive_confirm_dialog.dart';
const FOCUSABLE_TAP = 'packages/design_system/lib/src/widgets/focusable_tap.dart';
const BOOTSTRAP = 'packages/chassis_screens/lib/shell/bootstrap.dart';
const APP_MAIN = `${APP}/main.dart`;
const FIXTURE = `${APP}/features/zz_a11y_primitives_fixture.dart`;
const APP_HARNESS = 'apps/subscriptiontracker/integration_test/app_test.dart';

/** The real tree's integration harnesses, counted the plain way: a file under
 *  apps/<app>/integration_test/ or the brick's that calls `app.main()` on a line
 *  that is not a comment, and how many of those also call releaseWebSemantics(). */
function realHarnesses() {
  const dirs = [
    ...readdirSync(join(REPO, 'apps'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(REPO, 'apps', d.name, 'integration_test')),
    join(REPO, 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test'),
  ].filter((d) => existsSync(d));
  let boots = 0;
  let releases = 0;
  for (const d of dirs) {
    for (const f of readdirSync(d).filter((n) => n.endsWith('.dart'))) {
      const code = readFileSync(join(d, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');
      if (!/^\s*await app\.main\(\);/m.test(code)) continue;
      boots++;
      if (/^\s*releaseWebSemantics\(\);/m.test(code)) releases++;
    }
  }
  return { boots, releases };
}
const BRICK_HARNESS = 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test/app_test.dart';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });

/** Every tracked .dart under the guard's three root classes, and every
 *  integration harness limb 3 reads, copied. */
const IN_DOMAIN =
  /^(apps|packages)\/[^/]+\/lib\/|^tooling\/bricks\/app\/__brick__\/.*\/lib\/|^apps\/[^/]+\/integration_test\/|^tooling\/bricks\/app\/__brick__\/.*\/integration_test\//;
const DOMAIN = git(REPO, 'ls-files', '--', '*.dart').split('\n').filter((p) => IN_DOMAIN.test(p));

function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-a11y-primitives-'));
  for (const rel of DOMAIN) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'test');
  git(root, 'add', '-A');
  return root;
}

/** Runs `guard` (default: the real one) over a mutated copy of the real tree. */
function withTree(mutate, fn, guard = GUARD) {
  const root = realTree();
  try {
    mutate(root);
    git(root, 'add', '-A');
    fn(spawnSync(process.execPath, [guard, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A copy of the guard with `patch` applied to its source — how a case empties
 *  the baseline without a test-only switch in the shipped guard. */
function withPatchedGuard(patch, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-a11y-primitives-guard-'));
  try {
    const src = readFileSync(GUARD, 'utf8');
    const out = patch(src);
    assert.notEqual(out, src, 'the guard patch changed nothing — the case would pass vacuously');
    writeFileSync(join(dir, 'assert-a11y-primitives.mjs'), out);
    cpSync(join(REPO, 'tooling', 'ci', 'dart-source.mjs'), join(dir, 'dart-source.mjs'));
    fn(join(dir, 'assert-a11y-primitives.mjs'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const edit = (root, rel, fn) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, `the mutation of ${rel} changed nothing — the case would pass vacuously`);
  writeFileSync(p, after);
};
const write = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const fails = (r) => r.stderr.split('\n').filter((l) => l.startsWith('FAIL '));
const widget = (build) => `import 'package:flutter/widgets.dart';

class Zz extends StatelessWidget {
  const Zz({super.key});

  @override
  Widget build(BuildContext context) {
    return ${build};
  }
}
`;

describe('the real tree', () => {
  test('passes, prints every exemption and every baseline row with its owner', () => {
    withTree(() => {}, (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /ok {3}tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib — \d+ \.dart file\(s\); 0 gesture detector\(s\)/);
      const exempt = r.stdout.split('\n').filter((l) => l.startsWith('exempt '));
      assert.equal(exempt.length, 3, r.stdout);
      assert.equal(exempt.filter((l) => /legal_consent_fields\.dart:\d+ .*under ExcludeSemantics/.test(l)).length, 2);
      assert.equal(exempt.filter((l) => l.includes(`${FOCUSABLE_TAP}:`) && l.includes('FocusableActionDetector')).length, 1);
      const known = r.stdout.split('\n').filter((l) => l.startsWith('known '));
      // 7 -> 3 on 2026-09-29: ST-T3b converted the add sheet's three Y2 sites and
      // the notifications Close, and deleted their rows (the list only shrinks).
      // 3 -> 2 on 2026-10-01: ST-SETTINGS (SE-05) gave the delete-account
      // password field its autofill hint and deleted its ST-Y3 row.
      assert.equal(known.length, 2, r.stdout);
      for (const l of known) assert.match(l, /; owner [A-Z]\d+ — /);
      assert.match(r.stdout, /ST-Y2: 3 gesture detector\(s\), 0 without a tap callback, 3 in scope, 3 exempt/);
      // 10 -> 11 on 2026-10-01 (O-APPS-GOV-IN-VAPT-CHECKLIST): the chassis
      // ReauthDialog's password field, which carries its hint (still 1 without).
      // 11 -> 9 on 2026-10-01 (train st-entry): the app's private reset-password
      // copy and its two obscured boxes are gone — the app ADOPTS the chassis
      // ResetPasswordView, whose two boxes (now AuthField, still hinted) were
      // already counted. Read off the guard's own line.
      // 9 -> 11 and 1 -> 0 on 2026-10-01 (ST-SETTINGS, on st-entry): SE-02's
      // change-e-mail/password dialog adds two obscured fields, both hinted;
      // SE-05 hinted the last one, the delete-account password.
      // 11 -> 13 on 2026-10-02 (club-st-singles, T16 XP-03): the lock
      // screen's PIN and the set-a-PIN dialog's, both arriving WITH autofill
      // hints. Read off the guard's own line.
      assert.match(r.stdout, /ST-Y3: 13 obscured field\(s\), 0 without hints, all baselined/);
    });
  });
});

describe('limb 1 · ST-Y2 · every tap target takes the keyboard', () => {
  test('RED: a Semantics(button: true)-wrapped GestureDetector(onTap:) is refused, naming the wrapper and the fix', () => {
    withTree(
      (root) => write(root, FIXTURE, widget(`Semantics(
      button: true,
      child: GestureDetector(
        onTap: () {},
        child: const SizedBox(width: 48, height: 48),
      ),
    )`)),
      (r) => {
        assert.equal(r.status, 1, r.stdout + r.stderr);
        const f = fails(r);
        assert.equal(f.length, 1, r.stderr);
        assert.match(f[0], new RegExp(`ST-Y2: ${FIXTURE}:10 — GestureDetector\\(onTap\\) is a pointer-only control`));
        assert.match(f[0], new RegExp(`wrapped in Semantics\\(button: true\\) at ${FIXTURE}:8`));
        assert.match(f[0], /Fix: FocusableTap .*InkWell, or SegmentedButton/);
      },
    );
  });

  test('the real tree has NO Y2 site left to baseline: all four known sites were converted', () => {
    // ⏱ 2026-09-29 · ST-T3b. This case read "an EMPTY Y2 baseline names exactly
    // the four known sites" — the add sheet's chips, cycle and date field (B23)
    // and the notifications Close (C17). ST-T3b converted all four to
    // FocusableTap / SegmentedButton and deleted their rows, so the Y2 baseline
    // IS empty and the real tree must pass without one. A new pointer-only
    // control anywhere in scope turns this red (the fixture case above is the
    // refusal's own red control).
    withTree(() => {}, (r) => {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(fails(r).filter((l) => l.includes('ST-Y2')).length, 0, r.stderr);
      assert.match(r.stdout, /ST-Y2: .* 0 baselined, 0 refused/);
    });
  });

  test('RED: a RawGestureDetector with a TapGestureRecognizer is refused', () => {
    withTree(
      (root) => write(root, FIXTURE, widget(`RawGestureDetector(
      gestures: <Type, GestureRecognizerFactory>{
        TapGestureRecognizer: GestureRecognizerFactoryWithHandlers<TapGestureRecognizer>(
          () => TapGestureRecognizer(),
          (TapGestureRecognizer t) => t..onTap = () {},
        ),
      },
      child: const SizedBox(),
    )`)),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, new RegExp(`ST-Y2: ${FIXTURE}:\\d+ — RawGestureDetector\\(TapGestureRecognizer\\)`));
      },
    );
  });

  test('RED: ExcludeSemantics(excluding: false) excludes nothing, so it exempts nothing', () => {
    withTree(
      (root) => write(root, FIXTURE, widget(`ExcludeSemantics(
      excluding: false,
      child: GestureDetector(onLongPress: () {}, child: const SizedBox()),
    )`)),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /ST-Y2: .*zz_a11y_primitives_fixture\.dart:\d+ — GestureDetector\(onLongPress\)/);
      },
    );
  });

  test('GREEN: the same detector under ExcludeSemantics is exempt, and printed', () => {
    withTree(
      (root) => write(root, FIXTURE, widget(`ExcludeSemantics(
      child: GestureDetector(onTap: () {}, child: const SizedBox()),
    )`)),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, new RegExp(`exempt ${FIXTURE}:\\d+ GestureDetector\\(onTap\\) — under ExcludeSemantics`));
      },
    );
  });

  test('GREEN: the same code in a comment, a doc comment and a string is not a control', () => {
    withTree(
      (root) => write(root, FIXTURE, `// Semantics(button: true, child: GestureDetector(onTap: () {}))
/// GestureDetector(onTap: () {}, child: x)
/* RawGestureDetector(gestures: {TapGestureRecognizer: f}) */
const String a = 'GestureDetector(onTap: () {})';
const String b = """
Semantics(button: true, child: GestureDetector(onTap: () {}))
""";
`),
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });

  test('GREEN: a detector with no tap callback (a drag, or onTap: null) is out of scope', () => {
    withTree(
      (root) => write(root, FIXTURE, widget(`GestureDetector(
      onTap: null,
      onPanUpdate: (DragUpdateDetails d) {},
      child: GestureDetector(onVerticalDragEnd: (DragEndDetails d) {}, child: const SizedBox()),
    )`)),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /ST-Y2: 5 gesture detector\(s\), 2 without a tap callback, 3 in scope/);
      },
    );
  });

  test('RED: a baseline row whose instance is converted fails "delete this row"', () => {
    // ⏱ 2026-09-29 · ST-T3b: the real rows this case converted are gone (their
    // owner converted them), so the stale row is injected: an anchor that IS in
    // the add sheet but is no refused detector — exactly what a converted
    // instance's row looks like.
    withPatchedGuard(
      (src) => src.replace(
        /\nconst BASELINE = \[\n/,
        "\nconst BASELINE = [\n  { limb: 'ST-Y2', file: 'apps/subscriptiontracker/lib/features/add/add_subscription_sheet.dart', " +
          "anchor: 'setState(() => _saving = true);', what: 'the POPULAR service chips', owner: 'B23 — a converted row' },\n",
      ),
      (guard) => withTree(() => {}, (r) => {
        assert.equal(r.status, 1, r.stderr);
        const f = fails(r);
        assert.equal(f.length, 1, r.stderr);
        assert.match(f[0], /ST-Y2: BASELINE row for the POPULAR service chips .* Delete this row/);
      }, guard),
    );
  });

  test('RED: the primitive exemption lapses when FocusableActionDetector leaves the file', () => {
    withTree(
      (root) => edit(root, FOCUSABLE_TAP, (s) => s.replaceAll('FocusableActionDetector(', 'MouseRegion(')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, new RegExp(`ST-Y2: ${FOCUSABLE_TAP}:\\d+ — GestureDetector\\(onTap\\)`));
        assert.match(r.stderr, /the primitive exemption for .*focusable_tap\.dart .* matched no detector/);
      },
    );
  });

  test('COVERAGE LOST: a detector file whose parentheses do not balance is refused, not scored', () => {
    withTree(
      (root) => write(root, FIXTURE, 'Widget f() => GestureDetector(onTap: () {}, child: (x;\n'),
      (r) => {
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /COVERAGE LOST — .*zz_a11y_primitives_fixture\.dart: its parentheses do not balance/);
      },
    );
  });
});

describe('limb 2 · ST-Y3 autofill slice · every password field autofills', () => {
  test('RED (the base): the dialog without its hint is refused', () => {
    withTree(
      (root) => edit(root, DIALOG, (s) => s.replace(/^\s*autofillHints: const <String>\[AutofillHints\.password\],\n/m, '')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        const f = fails(r);
        assert.equal(f.length, 1, r.stderr);
        assert.match(f[0], new RegExp(`ST-Y3: ${DIALOG}:\\d+ — TextField\\(obscureText: …\\) is an obscured field with no autofillHints:`));
        assert.match(f[0], /SC 3\.3\.8/);
      },
    );
  });

  test('RED: autofillHints: null is refused as the literal null', () => {
    withTree(
      (root) => edit(root, DIALOG, (s) => s.replace('autofillHints: const <String>[AutofillHints.password],', 'autofillHints: null,')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /destructive_confirm_dialog\.dart:\d+ — TextField\(obscureText: …\) is an obscured field whose autofillHints is the literal null/);
      },
    );
  });

  test('RED: an AuthField(obscure: true) caller with no hint is refused; GREEN: obscureText: false is not obscured', () => {
    withTree(
      (root) => write(root, FIXTURE, widget(`Column(children: <Widget>[
      AuthField(label: 'p', obscure: true),
      TextField(obscureText: false),
    ])`)),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        const f = fails(r);
        assert.equal(f.length, 1, r.stderr);
        assert.match(f[0], new RegExp(`ST-Y3: ${FIXTURE}:\\d+ — AuthField\\(obscure: …\\)`));
      },
    );
  });

  test('GREEN: a passthrough counts, as in AuthField', () => {
    withTree(
      (root) => write(root, FIXTURE, widget('TextField(obscureText: hide, autofillHints: hints)')),
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });
});

describe('limb 3 · ST-Y5 · every stamped web app has a screen-reader tree', () => {
  test('RED (the base): bootstrap.dart without the call is refused, in the words of the defect', () => {
    withTree(
      (root) => edit(root, BOOTSTRAP, (s) => s.replace(/^\s*enableWebSemantics\(\);\n/m, '')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        const f = fails(r);
        assert.equal(f.length, 1, r.stderr);
        assert.match(f[0], /bootstrap\.dart never calls enableWebSemantics\(\): every stamped web app ships no screen-reader tree/);
      },
    );
  });

  test('RED: the call AFTER runGuarded( is refused', () => {
    withTree(
      (root) => edit(root, BOOTSTRAP, (s) => s
        .replace(/^\s*enableWebSemantics\(\);\n/m, '\n')
        .replace('  await runGuarded(() async {\n', '  await runGuarded(() async {\n    enableWebSemantics();\n')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /bootstrap\.dart:\d+ calls enableWebSemantics\(\) AFTER runGuarded\(/);
      },
    );
  });

  test('RED: an app main.dart that neither boots through bootstrapNikatru nor calls it first is refused', () => {
    withTree(
      (root) => edit(root, APP_MAIN, (s) => s.replace(/^\s*enableWebSemantics\(\);\n/m, '\n')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, new RegExp(`ST-Y5: ${APP_MAIN} neither boots through bootstrapNikatru\\( nor calls enableWebSemantics\\(\\) before runApp\\(`));
      },
    );
  });

  test('GREEN: the brick main reaches it through bootstrapNikatru( alone', () => {
    const brickMain = readFileSync(join(REPO, BRICK_LIB, 'main.dart'), 'utf8');
    assert.match(brickMain, /bootstrapNikatru\(/, 'the brick main no longer calls bootstrapNikatru — this case would prove nothing');
    assert.doesNotMatch(brickMain, /enableWebSemantics/, 'the brick calls it directly — this case would not isolate the bootstrap path');
    withTree(() => {}, (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /2 app entry point\(s\) reach it/);
    });
  });

  test('RED: a harness that boots main() and never releases the handle is refused', () => {
    withTree(
      (root) => edit(root, APP_HARNESS, (s) => s.replace(/^\s*releaseWebSemantics\(\);\n/m, '\n')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        const f = fails(r);
        assert.equal(f.length, 1, r.stderr);
        assert.match(f[0], new RegExp(`ST-Y5: ${APP_HARNESS}:\\d+ boots main\\(\\) and never calls releaseWebSemantics\\(\\)`));
        assert.match(f[0], /A SemanticsHandle was active at the end of the test/);
      },
    );
  });

  test('RED: a brick harness row whose harness now releases the handle fails "delete this row"', () => {
    withTree(
      (root) => edit(root, BRICK_HARNESS, (s) => s.replace('await app.main();', 'await app.main();\n    releaseWebSemantics();')),
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        const f = fails(r);
        assert.equal(f.length, 1, r.stderr);
        assert.match(f[0], /ST-Y5: BASELINE row for the brick e2e harness .*Delete this row/);
      },
    );
  });

  test('GREEN: app.main() in a comment or a string is not a boot', () => {
    withTree(
      (root) =>
        write(
          root,
          'apps/subscriptiontracker/integration_test/zz_fixture_test.dart',
          "import 'package:subscriptiontracker/main.dart' as app;\n\n// await app.main();\nconst String s = 'app.main()';\n",
        ),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        // ⏱ 2026-09-29 (ST-N1g) — DERIVED, not a literal: every real harness is a
        // file that boots main() on an uncommented line, and this literal broke on
        // each new one (4 → 6 with the two native-auth proofs). The fixture above
        // adds a commented boot and a string, which must add NOTHING to the count;
        // the brick's two baseline rows stay a literal pin.
        const { boots, releases } = realHarnesses();
        assert.equal(boots - releases, 2, 'the two brick baseline rows moved — re-read them, do not re-pin here');
        assert.match(r.stdout, new RegExp(`${boots} harness\\(es\\) boot main\\(\\), ${releases} release the handle, 2 baselined`));
      },
    );
  });

  test('COVERAGE LOST: no harness boots main() anywhere', () => {
    withTree(
      (root) => {
        rmSync(join(root, 'apps/subscriptiontracker/integration_test'), { recursive: true, force: true });
        rmSync(join(root, 'tooling/bricks/app/__brick__/apps/{{app_id}}/integration_test'), { recursive: true, force: true });
      },
      (r) => {
        // The two brick rows go stale with their harnesses, and a finding outranks the blind limb.
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /COVERAGE LOST — no integration harness under apps\/\*\/integration_test\//);
      },
    );
  });

  test('COVERAGE LOST: an app root with no main.dart', () => {
    withTree(
      (root) => rmSync(join(root, APP_MAIN)),
      (r) => {
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /COVERAGE LOST — apps\/subscriptiontracker\/lib has no tracked main\.dart/);
      },
    );
  });

  test('COVERAGE LOST: bootstrap.dart gone', () => {
    withTree(
      (root) => rmSync(join(root, BOOTSTRAP)),
      (r) => {
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /COVERAGE LOST — packages\/chassis_screens\/lib\/shell\/bootstrap\.dart is not tracked/);
      },
    );
  });
});

describe('coverage', () => {
  test('COVERAGE LOST: no roots at all', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-a11y-primitives-empty-'));
    try {
      writeFileSync(join(root, 'README.md'), 'nothing\n');
      git(root, 'init', '-q');
      git(root, 'add', '-A');
      const r = spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /COVERAGE LOST — no tracked \.dart file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('COVERAGE LOST: the brick root unreached, while the others still scan', () => {
    withTree(
      (root) => rmSync(join(root, 'tooling'), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /COVERAGE LOST — the brick root class derived NOTHING/);
      },
    );
  });

  test('a finding outranks a blind limb: exit 1 when both occur', () => {
    withTree(
      (root) => {
        rmSync(join(root, 'tooling'), { recursive: true, force: true });
        edit(root, DIALOG, (s) => s.replace('autofillHints: const <String>[AutofillHints.password],', ''));
      },
      (r) => {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /COVERAGE LOST — the brick root class/);
        assert.match(r.stderr, /ST-Y3: .*destructive_confirm_dialog\.dart/);
      },
    );
  });
});
