// ─────────────────────────────────────────────────────────────────────────────
// signup-consent-shape.test.mjs — the negative cases for
// assert-signup-consent-shape.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// That is the house rule in this guard family and it was learned expensively:
// `assert-seams-wired.mjs` shipped with its caller check matching the function's
// own declaration, ALL SIX of its fixture tests were green, and only mutating
// the real brick exposed it. A fixture you write encodes the same
// misunderstanding as the guard you write.
//
// 🔬 THE THREE MUTATIONS BELOW WERE ALSO RUN AGAINST THE LIVE REPOSITORY BEFORE
// THIS FILE EXISTED, and all three behaved: pre-ticking Subly's terms box,
// pre-ticking the BRICK's marketing box, and deleting the disabling half of
// `LoginScreen`'s button. The second is the one that matters most for why this
// guard exists at all — the brick has no Dart test suite of its own, so a
// pre-ticked box stamped into every future app is invisible to `flutter test`
// in both trees. `apps/subscriptiontracker/test/legal_gates_test.dart` covers the app side;
// only this guard covers the template.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-signup-consent-shape.mjs');

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const SUBLY = 'apps/subscriptiontracker';
const SUBLY_SIGNUP = `${SUBLY}/lib/features/auth/sign_up_screen.dart`;
const SUBLY_LOGIN = `${SUBLY}/lib/features/auth/login_screen.dart`;
const SUBLY_REACCEPT = `${SUBLY}/lib/features/auth/reaccept_terms_screen.dart`;
const SUBLY_FIELDS = `${SUBLY}/lib/features/auth/legal_consent_fields.dart`;
const BRICK_SIGNUP = `${BRICK}/lib/features/auth/sign_up_screen.dart`;
const BRICK_FIELDS = `${BRICK}/lib/features/auth/legal_consent_fields.dart`;

/** The chassis package [ADR 071] emptied the brick's auth screens into. Three
 *  of the five listed surfaces and one of the two shared widgets now delegate
 *  here, so it is part of what this guard READS and therefore part of what the
 *  fixture must carry. */
const CHASSIS_LIB = 'packages/chassis_screens/lib';
const CHASSIS_SIGNUP = `${CHASSIS_LIB}/auth/sign_up_screen.dart`;
const CHASSIS_REACCEPT = `${CHASSIS_LIB}/auth/reaccept_terms_screen.dart`;
const CHASSIS_FIELDS = `${CHASSIS_LIB}/auth/legal_consent_fields.dart`;

/** A real-tree copy carrying exactly what the guard reads: both roots' auth
 *  feature directories AND the chassis package they delegate into.
 *
 *  🔴 THE PACKAGE IS COPIED, NOT STUBBED, AND THAT IS THE POINT OF THE HOUSE
 *  RULE AT THE TOP OF THIS FILE. Before [ADR 071] the brick screens carried
 *  their own flags and two directories were the whole domain; they now carry an
 *  import instead, and a fixture that left the target out would make EVERY case
 *  below fail as COVERAGE LOST for a reason none of them is about. A stub with
 *  the flags typed in by hand would be worse still — it would encode this
 *  file's belief about what moved rather than what did. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-signup-consent-'));
  // ⏱ 2026-09-24 · the guard grades every app in the root pubspec's `workspace:`
  // set (tooling/ci/app-set.mjs), so the copy carries the real one.
  cpSync(join(REPO, 'pubspec.yaml'), join(root, 'pubspec.yaml'));
  for (const r of [BRICK, SUBLY]) {
    mkdirSync(join(root, r, 'lib', 'features'), { recursive: true });
    cpSync(join(REPO, r, 'lib', 'features', 'auth'), join(root, r, 'lib', 'features', 'auth'), {
      recursive: true,
    });
  }
  mkdirSync(join(root, CHASSIS_LIB), { recursive: true });
  cpSync(join(REPO, CHASSIS_LIB), join(root, CHASSIS_LIB), { recursive: true });
  return root;
}

function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Rewrite `rel` inside the copied tree — AND PROVE THE REWRITE LANDED.
 *
 *  🔴 THE LAND-CHECK IS NOT BELT-AND-BRACES, IT CAUGHT A REAL FALSE GREEN HERE
 *  ON 2026-09-06. `String.replace` with a string pattern hits the FIRST
 *  occurrence (trap `flutter-10`), and a doc comment above the declaration
 *  quoted `bool _accepted = false;` verbatim — so the mutation landed in prose
 *  the guard strips before matching, the tree it was supposed to break was
 *  still correct, and the case read as "the guard did not catch it". A mutation
 *  test whose mutation silently did nothing is worse than no mutation test: it
 *  reports a guard defect that is not there, or hides one that is. */
const edit = (root, rel, fn) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, `the mutation of ${rel} changed nothing — it did not land`);
  writeFileSync(p, after);
};

describe('the real tree', () => {
  test('passes, and reports what it actually scanned', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /signup consent shape apps=1 — 6 surface\(s\) scanned/);
        // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP: limb 4 saw both Apple doors and every call site.
        assert.match(
          r.stdout,
          /2 Sign in with Apple door\(s\) record the acceptance before the provider \(3 call-site file\(s\), all listed\)/,
        );
        assert.match(r.stdout, /every consent flag initialises to false/);
      },
    );
  });

  test('the copy the other cases mutate really carries the flags', () => {
    // Without this, every "caught" below could be an artefact of a stand-in
    // rather than evidence about the screens that ship.
    //
    // ⚠️ THE BRICK'S ENTRY MOVED, AND IT MOVED TO A FILE RATHER THAN AWAY.
    // [ADR 071] emptied `${BRICK_SIGNUP}` into the chassis package; the flags
    // went with the boxes they belong to, so the file that must carry them is
    // the package one. Subly is untouched — it is a frozen rail-prover, so its
    // two surfaces still declare their own.
    for (const rel of [SUBLY_SIGNUP, SUBLY_LOGIN, CHASSIS_SIGNUP, `${CHASSIS_LIB}/auth/sign_in_screen.dart`]) {
      const src = readFileSync(join(REPO, rel), 'utf8');
      assert.ok(src.includes('bool _acceptedTerms = false;'), `${rel} must carry the terms flag`);
      assert.ok(src.includes('bool _marketingEmail = false;'), `${rel} must carry the marketing flag`);
    }
  });

  test('the brick surfaces really DELEGATE — the fixture models the tree, not a memory of it', () => {
    // The other half of the self-check above. If the adapter stopped importing
    // the package, the flags would be in neither file this guard reads and
    // every delegation case below would be measuring a tree that is no longer
    // the one that ships.
    //
    // ⏱ 2026-09-20 · SUBLY_REACCEPT JOINS THE LIST ([ADR 086]). The app adopted
    // `ReacceptTermsView`, so its interstitial is now judged through the same
    // delegation as the brick's, and the case above that mutates the chassis
    // flag expects the APP to be named in the failure. Drop the app's import and
    // that expectation becomes untrue silently — unless this asserts it.
    for (const [adapter, target] of [
      [BRICK_SIGNUP, 'auth/sign_up_screen.dart'],
      [`${BRICK}/lib/features/auth/reaccept_terms_screen.dart`, 'auth/reaccept_terms_screen.dart'],
      [BRICK_FIELDS, 'auth/legal_consent_fields.dart'],
      [SUBLY_REACCEPT, 'auth/reaccept_terms_screen.dart'],
    ]) {
      const src = readFileSync(join(REPO, adapter), 'utf8');
      assert.ok(
        src.includes(`import 'package:nikatru_chassis_screens/${target}';`),
        `${adapter} must delegate to ${target}`,
      );
    }
    assert.ok(readFileSync(join(REPO, CHASSIS_REACCEPT), 'utf8').includes('bool _accepted = false;'));
  });
});

describe('limb 1 — no box is born ticked', () => {
  test('🔴 a PRE-TICKED TERMS box fails, in the app', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_SIGNUP, (s) =>
          s.replace('bool _acceptedTerms = false;', 'bool _acceptedTerms = true;'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /PRE-TICKED CONSENT/);
        assert.match(r.stderr, /_acceptedTerms/);
      },
    );
  });

  test('🔴 a PRE-TICKED MARKETING box fails for the BRICK — now in the chassis file it delegates to', () => {
    // 🔬 THE POST-MOVE RE-RUN OF THE ORIGINAL BRICK MUTATION. It used to edit
    // `BRICK_SIGNUP` directly; [ADR 071] moved the declaration into the package
    // and the guard follows it there, so the mutation follows it too. The
    // ASSERTION is unchanged and so is what it protects: the brick has no Dart
    // suite of its own, so a pre-ticked box stamped into every future app is
    // invisible to `flutter test` in both trees. The failure must still NAME
    // the brick surface, because that is the surface that ships it.
    withTree(
      (root) =>
        edit(root, CHASSIS_SIGNUP, (s) =>
          s.replace('bool _marketingEmail = false;', 'bool _marketingEmail = true;'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /PRE-TICKED CONSENT/);
        assert.match(r.stderr, /__brick__/);
      },
    );
  });

  test('the interstitial is covered too — and Subly now takes it through its delegation', () => {
    // ⏱ 2026-09-20 · THE POST-ADOPTION RE-RUN OF THIS MUTATION, the same move the
    // BRICK case below made at [ADR 071]. `apps/subscriptiontracker` adopted
    // `ReacceptTermsView` ([ADR 086]; the measured row is in
    // `tooling/chassis-parity.json`), so the flag no longer lives in
    // SUBLY_REACCEPT and the mutation follows it into the chassis file.
    //
    // 🔴 AND THIS CASE FAILED FIRST, WHICH IS THE POINT OF THE LAND-CHECK ABOVE.
    // Left pointing at SUBLY_REACCEPT, `edit` still "landed": the adapter's own
    // doc comment quoted the declaration verbatim, so the rewrite hit PROSE the
    // guard strips before matching, the tree it was meant to break was still
    // correct, and the case reported a guard defect that was not there. The
    // decoy is gone from that doc and the mutation is aimed at the code.
    //
    // ⚠️ IT IS NOT A DUPLICATE OF THE BRICK CASE BELOW, and the ASSERTION is what
    // keeps them apart: one guard run names EVERY surface that reads the broken
    // flag, so this case fails unless the APP is one of them. Point the app's
    // adapter somewhere else and this reds while the brick case stays green.
    withTree(
      (root) =>
        edit(root, CHASSIS_REACCEPT, (s) =>
          s.replace('bool _accepted = false;', 'bool _accepted = true;'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /PRE-TICKED CONSENT/);
        assert.match(r.stderr, /apps\/subscriptiontracker\/lib\/features\/auth\/reaccept_terms_screen/);
      },
    );
  });

  test('🔴 the BRICK interstitial too, through its delegation', () => {
    withTree(
      (root) =>
        edit(root, CHASSIS_REACCEPT, (s) =>
          s.replace('bool _accepted = false;', 'bool _accepted = true;'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /PRE-TICKED CONSENT/);
        assert.match(r.stderr, /__brick__/);
      },
    );
  });

  test('a RENAMED flag fails rather than vanishing', () => {
    // The silent-stop shape: rename the field and a guard keyed on the name
    // finds nothing to check and reports clean.
    withTree(
      (root) => edit(root, SUBLY_SIGNUP, (s) => s.replaceAll('_acceptedTerms', '_tos')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no `bool _acceptedTerms = …;` declaration found/);
      },
    );
  });
});

describe('limb 2 — the terms tick blocks in BOTH positions', () => {
  test('🔴 deleting the DISABLING half fails, even with the guard intact', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_LOGIN, (s) =>
          s.replace(
            /onPressed: \(_loading \|\| \(_signUp && !_acceptedTerms\)\)\s*\n\s*\? null\s*\n\s*: _submit,/,
            'onPressed: _loading ? null : _submit,',
          ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NOT used to disable a button/);
      },
    );
  });

  test('🔴 deleting the EARLY-RETURN guard fails, even with the button disabled', () => {
    // The keyboard path: `onSubmitted:` reaches the handler without ever
    // touching the button, so a disabled button on its own is not the rule.
    withTree(
      (root) =>
        edit(root, SUBLY_SIGNUP, (s) =>
          s.replace('if (_busy || !_acceptedTerms) return;', 'if (_busy) return;'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NOT used in an early-return guard/);
      },
    );
  });
});

describe('limb 3 — the optional box may not gate the service', () => {
  test('🔴 gating sign-up on the MARKETING opt-in fails as conditionality', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_SIGNUP, (s) =>
          s.replace('if (_busy || !_acceptedTerms) return;', 'if (_busy || !_acceptedTerms || !_marketingEmail) return;'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /CONDITIONALITY/);
        assert.match(r.stderr, /Art 7\(4\)/);
      },
    );
  });
});

describe('the shared widget cannot be asked to pre-tick', () => {
  test('an `initial…` parameter fails — it is a way round limb 1', () => {
    withTree(
      (root) =>
        edit(root, SUBLY_FIELDS, (s) =>
          s.replace('this.enabled = true,', 'this.enabled = true,\n    this.initialTermsAccepted = false,'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /declares an `initial…` parameter/);
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔬 THE MUTATIONS FOR THE DELEGATION THIS UNIT ADDED TO THIS LIMB.
  //
  // Before [ADR 071] the brick's `legal_consent_fields.dart` WAS the widget and
  // reading it by path was sufficient. It is now a seventy-line forwarder, and
  // the constructor that renders the checkboxes is in the package. Reading only
  // the adapter would ask whether a forwarder declares `initialTermsAccepted:`
  // — a question whose answer is always no — so the limb would keep printing ok
  // about a file where the thing it forbids cannot occur. WC-CONTROL is the
  // green control: without it, WC-1 and WC-2 are equally consistent with a limb
  // that now refuses every tree.
  // ───────────────────────────────────────────────────────────────────────────
  test('WC-CONTROL · GREEN — the real delegating tree passes, and says what it read', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.match(
          r.stdout,
          /legal_consent_fields\.dart also read 1 chassis file\(s\) it delegates to/,
        );
      },
    );
  });

  test('WC-1 · 🔴 an `initial…` in the CHASSIS widget fails — the adapter alone could never carry it', () => {
    withTree(
      (root) =>
        edit(root, CHASSIS_FIELDS, (s) =>
          s.replace('this.enabled = true,', 'this.enabled = true,\n    this.initialTermsAccepted = false,'),
        ),
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stderr, /declares an `initial…` parameter/);
        assert.match(r.stderr, /__brick__/);
      },
    );
  });

  test('WC-2 · 🔴 a delegation this limb cannot follow is COVERAGE LOST, not silence', () => {
    withTree(
      (root) => rmSync(join(root, CHASSIS_FIELDS)),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /legal_consent_fields/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A SURFACE THAT MOVES INTO THE CHASSIS TAKES ITS CONSENT FLAG WITH IT.
//
// This guard pins its surfaces by path AND by field name, so [ADR 067]
// decision 2 — which empties the screen into `package:nikatru_chassis_screens`
// and leaves an adapter at the same path — moves `bool _acceptedTerms = false;`
// out from under limb 1. Without the delegation read, the first spine unit
// would have to edit a DPDP/CPRA guard mid-move.
//
// SC-D1 is the green control: it must PASS. Without it every refusal below is
// equally consistent with a guard that refuses any delegating tree at all.
// ─────────────────────────────────────────────────────────────────────────────
const CHASSIS_PKG = 'nikatru_chassis_screens';
const CHASSIS_FILE = 'packages/chassis_screens/lib/sign_up_body.dart';

/** Empty the terms-flag DECLARATION out of Subly's sign-up screen and into a
 *  chassis file, leaving an adapter that imports and uses it — chassis step 4,
 *  in miniature. `body` is what the package file ends up containing. */
const delegateSignUp = (root, { body, writePackage = true, used = true } = {}) => {
  edit(root, SUBLY_SIGNUP, (s) => {
    const stripped = s.replace('bool _acceptedTerms = false;', '');
    const use = used ? '\nWidget _chassisBody() => const SignUpBody();\n' : '\n';
    return `import 'package:${CHASSIS_PKG}/sign_up_body.dart';\n${stripped}${use}`;
  });
  if (!writePackage) return;
  mkdirSync(join(root, dirname(CHASSIS_FILE)), { recursive: true });
  writeFileSync(join(root, CHASSIS_FILE), body);
};

const CHASSIS_BODY_OK =
  'class SignUpBody extends StatelessWidget {\n' +
  '  const SignUpBody({super.key});\n' +
  '  bool _acceptedTerms = false;\n' +
  '  bool _marketingEmail = false;\n' +
  '}\n';

describe('a surface that moved into the chassis is judged where it now lives', () => {
  test('SC-D1 · GREEN CONTROL — the flag declaration in the package satisfies limb 1', () => {
    withTree(
      (root) => delegateSignUp(root, { body: CHASSIS_BODY_OK }),
      (r) => {
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /also read 1 chassis file\(s\) it delegates to/);
      },
    );
  });

  test('SC-D2 · the flag in NEITHER file still fails — the union only ever adds text', () => {
    withTree(
      (root) => delegateSignUp(root, { body: 'class SignUpBody {\n  const SignUpBody();\n}\n' }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no `bool _acceptedTerms = …;` declaration found/);
      },
    );
  });

  test('SC-D3 · a delegation target that is not on disk is COVERAGE LOST, not silence', () => {
    withTree(
      (root) => delegateSignUp(root, { body: CHASSIS_BODY_OK, writePackage: false }),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /not on disk|asserted NOWHERE/);
      },
    );
  });

  test('SC-D4 · an UNUSED chassis import is COVERAGE LOST — an import is a claim, not evidence', () => {
    withTree(
      (root) => delegateSignUp(root, { body: CHASSIS_BODY_OK, used: false }),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /never references anything it declares|ALSO DECLARES/);
      },
    );
  });
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when a listed surface is missing', () => {
    withTree(
      (root) => rmSync(join(root, BRICK_SIGNUP)),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST — tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}: no file under .* declares `\\bclass\\s\+SignUpScreen\\b`/);
      },
    );
  });

  test('a comment saying `_acceptedTerms = true` is NOT a finding', () => {
    // This guard's own prose, and the doc comments on the surfaces themselves,
    // contain that exact string. Unstripped, a correct tree fails.
    withTree(
      (root) =>
        edit(root, SUBLY_SIGNUP, (s) =>
          s.replace(
            'bool _acceptedTerms = false;',
            '// once upon a time somebody wrote bool _acceptedTerms = true; here\n  bool _acceptedTerms = false;',
          ),
        ),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
      },
    );
  });
});

// ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP — limb 4. Sign in with Apple can create an
// account, and for as long as its door had no clickwrap limbs 1-3 printed ok,
// because a door with no boxes is not a surface. Each case below breaks one way
// that gap could come back.
describe('limb 4 · every Sign in with Apple door records the acceptance first', () => {
  const CHASSIS_SIGNIN = `${CHASSIS_LIB}/auth/sign_in_screen.dart`;
  const BRICK_SIGNIN = `${BRICK}/lib/features/auth/sign_in_screen.dart`;

  test('🔴 the chassis Apple handler no longer records the acceptance → caught', () => {
    withTree(
      (root) =>
        edit(root, CHASSIS_SIGNIN, (src) =>
          src.replace('      await widget.onAcceptTerms(marketingEmail: _marketingEmail);\n', ''),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /APPLE ACCOUNT WITHOUT ACCEPTED TERMS — tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/lib\/features\/auth\/sign_in_screen\.dart/);
      },
    );
  });

  test("🔴 the acceptance moved AFTER the provider in Subly's LoginScreen → caught", () => {
    withTree(
      (root) =>
        edit(root, SUBLY_LOGIN, (src) => {
          const accept =
            /      if \(termsOwed\) \{\n        await ref\n            \.read\(legalAcceptanceProvider\.notifier\)\n            \.accept\(marketingEmail: _marketingEmail\);\n      \}\n/;
          const m = accept.exec(src);
          assert.ok(m, 'the acceptance block the mutation moves must exist');
          return src
            .replace(accept, '')
            .replace('      await auth.signInWithApple();\n', `      await auth.signInWithApple();\n${m[0]}`);
        }),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /APPLE ACCOUNT WITHOUT ACCEPTED TERMS — apps\/subscriptiontracker\/lib\/features\/auth\/login_screen\.dart/);
      },
    );
  });

  test('🔴 the terms refusal ahead of the chassis provider is gone → caught', () => {
    withTree(
      (root) =>
        edit(root, CHASSIS_SIGNIN, (src) =>
          src.replace('if (widget.appleTermsOwed && !_acceptedTerms) {', 'if (false) {'),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /has NO early `if \(… !_acceptedTerms …\)` refusal/);
      },
    );
  });

  test('🔴 the chassis Apple button stays live while the terms are unticked → caught', () => {
    withTree(
      (root) =>
        edit(root, CHASSIS_SIGNIN, (src) =>
          src.replace('(_busy || (widget.appleTermsOwed && !_acceptedTerms))', '_busy'),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /the Sign in with Apple button is not disabled on `!_acceptedTerms`/);
      },
    );
  });

  test('🔴 the brick adapter decides the device owes nothing → caught', () => {
    withTree(
      (root) =>
        edit(root, BRICK_SIGNIN, (src) =>
          src.replace(
            /appleTermsOwed: core\.needsLegalReacceptance\([\s\S]*?kLegalVersions,\n\s*\),/,
            'appleTermsOwed: false,',
          ),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /`appleTermsOwed:` must be `core\.needsLegalReacceptance\(acceptedStamp: ref\.watch\(legalAcceptanceProvider\)/);
      },
    );
  });

  test('🔴 a NEW door that calls Sign in with Apple and is not listed → caught', () => {
    withTree(
      (root) =>
        writeFileSync(
          join(root, SUBLY, 'lib', 'features', 'auth', 'quick_apple.dart'),
          'Future<void> quick(dynamic auth) async {\n  await auth.signInWithApple();\n}\n',
        ),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /UNLISTED APPLE DOOR — apps\/subscriptiontracker\/lib\/features\/auth\/quick_apple\.dart/);
      },
    );
  });

  test('a DECLARATION of the seam method is not a call site', () => {
    withTree(
      (root) =>
        writeFileSync(
          join(root, SUBLY, 'lib', 'features', 'auth', 'declares_apple.dart'),
          'abstract class X {\n  Future<void> signInWithApple();\n}\n',
        ),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
      },
    );
  });
});

// ⏱ 2026-09-24 · O-GUARDS-READ-A-HAND-LISTED-APP-SET. The surfaces were app #1's
// paths, so a second app was never read. Each surface is now found by the class
// it declares, in every app of the workspace set and in the brick. A stamped app
// has the BRICK's layout (sign_in_screen.dart's `SignInScreen`, not
// login_screen.dart's `LoginScreen`), so app 2 below is the brick's auth tree
// copied into apps/scratch — the layout the factory stamps, not app #1's.
describe('app set · a second app in the brick layout', () => {
  const SCRATCH = 'apps/scratch';
  const SCRATCH_SIGNIN = `${SCRATCH}/lib/features/auth/sign_in_screen.dart`;

  /** app 2 on disk, AND in the workspace (`declare: false` leaves it out). */
  const addScratch = (root, { declare = true } = {}) => {
    mkdirSync(join(root, SCRATCH, 'lib', 'features'), { recursive: true });
    cpSync(join(REPO, BRICK, 'lib', 'features', 'auth'), join(root, SCRATCH, 'lib', 'features', 'auth'), {
      recursive: true,
    });
    if (declare) {
      edit(root, 'pubspec.yaml', (s) =>
        s.replace('  - apps/subscriptiontracker\n', `  - apps/subscriptiontracker\n  - ${SCRATCH}\n`),
      );
    }
  };

  test('RC2 · GREEN — app 2 is read: apps=2, three more surfaces, a third Apple door', () => {
    withTree(
      (root) => addScratch(root),
      (r) => {
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stdout, /signup consent shape apps=2 — 9 surface\(s\) scanned/);
        assert.match(r.stdout, /9 terms tick\(s\) block in both positions/);
        assert.match(r.stdout, /3 Sign in with Apple door\(s\) record the acceptance before the provider \(4 call-site file\(s\), all listed\)/);
        assert.match(r.stdout, /⬜ apps\/scratch\/lib\/features\/auth\/sign_in_screen\.dart also read 1 chassis file/);
      },
    );
  });

  test("🔴 app 2's own adapter decides the device owes nothing → caught, naming app 2", () => {
    // The brick's SignInScreen config, including its wiring check, reaches app 2
    // because the locator matched `SignInScreen` there — not because of a path.
    withTree(
      (root) => {
        addScratch(root);
        edit(root, SCRATCH_SIGNIN, (src) =>
          src.replace(/appleTermsOwed: core\.needsLegalReacceptance\([\s\S]*?kLegalVersions,\n\s*\),/, 'appleTermsOwed: false,'),
        );
      },
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /apps\/scratch\/lib\/features\/auth\/sign_in_screen\.dart: `appleTermsOwed:` must be/);
      },
    );
  });

  test('app 2 with NO sign-in door is COVERAGE LOST, naming apps/scratch and both symbols', () => {
    withTree(
      (root) => {
        addScratch(root);
        rmSync(join(root, SCRATCH_SIGNIN));
      },
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stderr, /COVERAGE LOST — apps\/scratch: no file under apps\/scratch\/lib\/ declares `\\bclass\\s\+\(LoginScreen\|SignInScreen\)\\b` — the sign-in door/);
      },
    );
  });

  test('two files declaring one surface in app 2 is a finding, not a pick', () => {
    withTree(
      (root) => {
        addScratch(root);
        writeFileSync(
          join(root, SCRATCH, 'lib', 'features', 'auth', 'sign_up_screen_copy.dart'),
          'class SignUpScreen {}\n',
        );
      },
      (r) => {
        assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stderr, /apps\/scratch: 2 files declare `\\bclass\\s\+SignUpScreen\\b`/);
      },
    );
  });

  test('RC1 · a workspace with no apps/ member is COVERAGE LOST before any surface is graded', () => {
    withTree(
      (root) => edit(root, 'pubspec.yaml', (s) => s.replace('  - apps/subscriptiontracker\n', '')),
      (r) => {
        assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
        assert.match(r.stderr, /COVERAGE LOST — assert-signup-consent-shape: .*pubspec\.yaml declares no `workspace:` entry under apps\//);
        assert.doesNotMatch(r.stdout, /signup consent shape/);
      },
    );
  });
});
