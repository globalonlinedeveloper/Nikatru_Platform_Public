// ─────────────────────────────────────────────────────────────────────────────
// captcha-gated-call-sites.test.mjs — the negative cases for
// assert-captcha-gated-call-sites.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture. The
// guard this one covers was written because a hand-maintained LIST of four
// screens could not represent a fifth surface reusing the first method; a
// hand-built fixture would encode exactly the same misunderstanding twice and
// go green.
//
// 🔬 THE BASELINE IS ITSELF A MEASUREMENT, and it is worth stating plainly so a
// later reader can tell a fixed defect from one that was never there: on
// 2026-09-04, BEFORE the settings fix in this same change, this guard's first
// run against the untouched tree failed with exactly one line —
// `settings_screen.dart:1213 calls signInWithEmail( with no usable
// captchaToken:`. That is the defect. ⚠️ THE `1213` IS THE PRE-FIX LINE AND IS
// QUOTED, NOT POINTED AT: the fix in this same commit moved that call, so
// following the number today lands somewhere else. It is here because a
// reproduction is worth more than a pointer — the case `the delete dialog's
// token is what the guard is FOR` below reproduces the failure by removing the
// argument again, and that is what keeps this claim honest as the file moves.
//
// ⚠️ THE COPY IS `git init`-ed. The guard enumerates with `git ls-files`, and a
// test that enumerated some other way would not be exercising the code that
// ships. One enumeration, both callers.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-captcha-gated-call-sites.mjs');

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const SUBLY = 'apps/subly';
const INTERFACE = 'packages/core/lib/src/auth/auth_repository.dart';
const SUBLY_SETTINGS = `${SUBLY}/lib/features/settings/settings_screen.dart`;
const SUBLY_LOGIN = `${SUBLY}/lib/features/auth/login_screen.dart`;
/** The file whose only mention of a gated method is a DOC COMMENT — the reason
 *  the reduction is mandatory rather than tidy. */
const SUBLY_CHECK_INBOX = `${SUBLY}/lib/features/auth/check_inbox_screen.dart`;

/** A real-tree copy carrying exactly what the guard reads, and nothing else. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-captcha-'));
  for (const r of [BRICK, SUBLY]) {
    mkdirSync(join(root, r), { recursive: true });
    cpSync(join(REPO, r, 'lib'), join(root, r, 'lib'), { recursive: true });
  }
  mkdirSync(dirname(join(root, INTERFACE)), { recursive: true });
  cpSync(join(REPO, INTERFACE), join(root, INTERFACE));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('add', '-A');
  return root;
}

function withTree(mutate, fn) {
  const root = realTree();
  try {
    mutate(root);
    // Re-stage, so a mutation is visible to `git ls-files`.
    execFileSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
    fn(spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const edit = (root, rel, fn) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, `the mutation of ${rel} changed nothing — the test would pass vacuously`);
  writeFileSync(p, after);
};

describe('the real tree', () => {
  test('passes, and reports both roots', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /ok {3}apps\/subly\/lib — adopted TurnstileGate/);
        assert.match(r.stdout, /TurnstileGate not adopted in this tree/);
      },
    );
  });

  test('the gated set is DERIVED from the interface, and names all four methods', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        for (const m of ['signInWithEmail', 'signUpWithEmail', 'sendPasswordReset', 'resendVerificationEmail']) {
          assert.match(r.stdout, new RegExp(m), `the derived set must name ${m}`);
        }
      },
    );
  });

  test('a doc comment naming a gated method is NOT a call site', () => {
    // check_inbox_screen.dart mentions `resendVerificationEmail()` in prose and
    // calls nothing. A grep-shaped guard reports a violation here; this one must
    // not, and the assertion is on the REAL file so it cannot rot.
    const src = readFileSync(join(REPO, SUBLY_CHECK_INBOX), 'utf8');
    assert.ok(src.includes('resendVerificationEmail()'), 'the prose mention must really still be there');
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stdout + r.stderr, /check_inbox_screen/, 'a doc comment was scored as a call site');
      },
    );
  });
});

describe('an adopted tree must pass a token at EVERY gated call site', () => {
  test('the delete dialog\'s token is what the guard is FOR', () => {
    // The 2026-09-04 defect, reproduced: drop the argument the fix added and the
    // guard must name this exact file, this exact method.
    withTree(
      (root) =>
        edit(root, SUBLY_SETTINGS, (s) =>
          s.replace(
            /await auth\.signInWithEmail\(\s*email: user\.email,\s*password: password,\s*captchaToken: captchaToken,\s*\);/,
            'await auth.signInWithEmail(email: user.email, password: password);',
          ),
        ),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, /settings_screen\.dart:\d+ calls signInWithEmail\(/);
        assert.match(r.stderr, /no usable `captchaToken:` argument/);
      },
    );
  });

  test('a literal `null` token is refused — it is the one spelling knowably useless', () => {
    // ⚠️ ANCHORED ON THE GATED CALL, NOT ON THE ARGUMENT ALONE. `captchaToken:
    // captchaToken,` now appears TWICE in this file — once in the
    // `_DeleteAccountDialog(` constructor and once in `signInWithEmail(` — and a
    // first draft replaced the constructor's, which is not a gated call at all,
    // so the guard stayed green and the case looked like a guard defect. A
    // mutation aimed at the wrong occurrence tests nothing.
    withTree(
      (root) =>
        edit(root, SUBLY_SETTINGS, (s) =>
          s.replace(
            /(await auth\.signInWithEmail\([^;]*?captchaToken: )captchaToken(,)/,
            '$1null$2',
          ),
        ),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, /settings_screen\.dart/);
        assert.match(r.stderr, /no usable `captchaToken:` argument/);
      },
    );
  });

  test('every OTHER adopted call site is covered too, not just the one that regressed', () => {
    // A guard that only catches the file it was written for is a hardcoded
    // assertion wearing a scanner's clothes. Drive it at login_screen instead.
    withTree(
      (root) => edit(root, SUBLY_LOGIN, (s) => s.split('captchaToken: _captchaToken,').join('')),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, /login_screen\.dart/);
      },
    );
  });

  test('deleting the Turnstile MOUNT from login_screen turns it red', () => {
    // The owner-specified negative case. Removing the widget leaves the tokens
    // being passed with no audited source on that surface — R2.
    //
    // ⚠️ THE MUTATION RENAMES THE IDENTIFIER EVERYWHERE rather than deleting the
    // mount expression with a regex. A first draft matched
    // `/TurnstileGate\(\s*onToken:[^)]*\)[^)]*\),/` and changed NOTHING, because
    // `[^)]*` cannot cross the `)` in the `(String? t)` parameter list — and a
    // mutation that silently no-ops makes the case pass for the wrong reason.
    // `edit`'s own vacuity assertion is what caught it.
    withTree(
      (root) => edit(root, SUBLY_LOGIN, (s) => s.split('TurnstileGate').join('_NotTheGate')),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, /login_screen\.dart/);
        assert.match(r.stderr, /never mounts TurnstileGate/);
      },
    );
  });
});

describe('the un-adopted tree is REPORTED and arms itself', () => {
  test('the brick prints rather than failing, and names its five call sites', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /👤 OWNER .*5 captcha-gated call site\(s\) and mounts TurnstileGate ZERO times/);
        assert.match(r.stdout, /PRINTED, NOT FAILED/);
      },
    );
  });

  test('🔴 AND THE EXEMPTION EXPIRES BY ITSELF: give the brick the widget and it starts failing', () => {
    // This is the case that makes the print defensible rather than a permanent
    // hole. Nothing in the guard is edited; the tree gains a mention of the
    // widget and every one of the brick's five call sites becomes governed.
    //
    // 🔴 THE MENTION MUST BE CODE, AND THE FIRST DRAFT PROVED IT THE HARD WAY.
    // Appending `// TurnstileGate` as a COMMENT left the guard green — correctly,
    // because it strips comments before looking. The test was wrong and the
    // guard was right, which is the one direction of disagreement worth having.
    withTree(
      (root) =>
        edit(
          root,
          `${BRICK}/lib/features/auth/sign_in_screen.dart`,
          (s) => `${s}\nWidget _armsTheGuard() => const TurnstileGate();\n`,
        ),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, new RegExp('sign_in_screen\\.dart:\\d+ calls signInWithEmail\\('));
        assert.doesNotMatch(r.stdout, /PRINTED, NOT FAILED/, 'the brick must no longer be merely reported');
      },
    );
  });
});

describe('coverage — a scanner that scans nothing prints perfectly', () => {
  test('an interface with no captchaToken parameter is COVERAGE LOST, not a clean tree', () => {
    withTree(
      (root) => edit(root, INTERFACE, (s) => s.split('captchaToken').join('unrelatedParam')),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /declares a `captchaToken` parameter|no method in/);
      },
    );
  });

  test('a missing interface is COVERAGE LOST', () => {
    withTree(
      (root) => rmSync(join(root, INTERFACE)),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });

  test('a root REQUIRED_COVERAGE names but cannot see is COVERAGE LOST', () => {
    withTree(
      (root) => rmSync(join(root, SUBLY, 'lib'), { recursive: true }),
      (r) => {
        assert.equal(r.status, 1, `expected a failure; stdout was:\n${r.stdout}`);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /apps\/subly\/lib/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A GATED CALL SITE THAT MOVED INTO THE CHASSIS PACKAGE — [ADR 067] decision 2
//
// [ADR 066] step 4 empties a sign-in screen into
// `package:nikatru_chassis_screens`, and every `signInWithEmail(` goes with the
// body. Read at the adapter alone this guard sees a root with no gated call
// sites at all — which reads exactly like a compliant one.
//
// 🔴 THE EXTENSION SHIPPED WITH NO TEST. It gained 75 lines on 2026-09-05 and
// this file gained none. CD3 is the case that matters: an import nothing
// references must not pull a package file into the scan, because a call site
// nobody can reach is not a call site.
// ─────────────────────────────────────────────────────────────────────────────
describe('a gated call site that moved into the chassis package', () => {
  const CHASSIS_REL = 'packages/chassis_screens/lib/sign_in_body.dart';
  const IMPORT = "import 'package:nikatru_chassis_screens/sign_in_body.dart';\n";

  /** `token` false is the mutation this guard exists for: the call is in the
   *  package and it passes no usable captchaToken. */
  const packageBody = (token) =>
    'class SignInBody extends StatelessWidget {\n  const SignInBody({super.key});\n' +
    // The surface must MOUNT the gate it threads a token from — a token
    // arriving from elsewhere is the dead-seam shape this guard also refuses.
    '  Widget build(BuildContext c) => const TurnstileGate(child: SizedBox.shrink());\n' +
    '  Future<void> go(WidgetRef ref) async {\n' +
    '    await repo.signInWithEmail(\n      email: e,\n      password: p,\n' +
    (token ? '      captchaToken: await gate.token(),\n' : '      captchaToken: null,\n') +
    '    );\n  }\n}\n';

  const delegate = ({ used = true, onDisk = true, token = true } = {}) => (root) => {
    edit(root, SUBLY_LOGIN, (s) => IMPORT + s + (used ? '\nWidget shell(BuildContext c) => const SignInBody();\n' : ''));
    if (onDisk) {
      const p = join(root, CHASSIS_REL);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, packageBody(token));
    }
  };

  // GREEN CONTROL — the delegation resolves, the package file joins the scan,
  // and its correctly-gated call site keeps the root green.
  test('CD1 · the delegation is followed and REPORTED, and a gated call passes', () => {
    withTree(delegate(), (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /chassis file\(s\) it delegates to/);
      assert.match(r.stdout, /sign_in_body\.dart/);
    });
  });

  // 🔴 THE FINDING, THROUGH THE DELEGATION. Without the resolver this tree is
  // green while every stamped app signs in with no captcha at all.
  test('CD2 · 🔴 an UNGATED call site IN THE PACKAGE is found and named', () => {
    withTree(delegate({ token: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /sign_in_body\.dart/);
    });
  });

  // 🔴 THE EXPLOIT: an import alone is not evidence that a call site went
  // anywhere, and it must not be read as "no delegation" either.
  test('CD3 · 🔴 an import the adapter never uses is refused, not followed', () => {
    withTree(delegate({ used: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /never references anything it declares \(SignInBody\)/);
    });
  });

  test('CD4 · 🔴 a delegation to a file that is not on disk is COVERAGE LOST', () => {
    withTree(delegate({ onDisk: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /that file is not on disk/);
    });
  });
});
