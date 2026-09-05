// ─────────────────────────────────────────────────────────────────────────────
// deletion-control.test.mjs — the negative cases for assert-deletion-control.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// This repo has shipped a guard whose six fixture tests all passed against a
// broken version (`assert-seams-wired.mjs`, whose caller check matched the
// function's own declaration): a fixture you write encodes the same
// misunderstanding as the guard you write. The copy below carries the real
// brick, the real apps/subly, the real root pubspec and — since [ADR 065]
// chassis step 2 — the real shared confirmation widget, so a mutation here is
// the mutation a person would actually make.
//
// ── AND EVERY CASE WAS PROVED ABLE TO FAIL (2026-09-05) ─────────────────────
// Three tests in this repo were found measuring nothing. So each limb of the
// guard was DELETED in turn and this file re-run; the cases that went red are
// recorded beside the limb they stand for:
//
//   limb removed from the guard                    tests that went RED
//   the chassis property loop                      the 4 shared-confirmation cases
//   the chassis presence COVERAGE LOST             "DELETING THE WIDGET"
//   the chassis line floor                         "STUBBING IT BELOW ITS OWN FLOOR"
//   limb 3 back to a bare `showDialog` substring   "THE OTHER DIALOGS…", "DROPPING barrierDismissible…"
//   the per-root local-branch property loop        the 3 apps/subly-carries-its-own cases
//   the branch dropped from the passing line       "names both roots AND the branch", "STEP 4 DONE RIGHT"
//
// Every new case is on that table. A case that appears on none of these rows is
// a case that measures nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-deletion-control.mjs');

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const SUBLY = 'apps/subly';
const BRICK_SETTINGS = `${BRICK}/lib/features/settings/settings_screen.dart`;
const SUBLY_SETTINGS = `${SUBLY}/lib/features/settings/settings_screen.dart`;
// The file that DECLARES the erasure hook, not the barrel that re-exports it.
// `${SUBLY}/lib/state/providers.dart` until 2026-09-04, when the spine was split
// into per-capability files behind that barrel. Pointed at the barrel, the
// mutation below matches nothing and this test's own "a test that mutates
// nothing proves nothing" self-check is what fails — which is the design
// working, and the reason this line is a constant rather than a literal.
const SUBLY_AUTH_PROVIDERS = `${SUBLY}/lib/state/providers/auth.dart`;
// The SECOND subject, since [ADR 065] chassis step 2: the confirmation itself.
const CHASSIS = 'packages/design_system/lib/src/widgets/destructive_confirm_dialog.dart';
// The guard's own full-checkout sentinel. See [realTree].
const SENTINEL = 'tooling/ci/assert-deletion-control.mjs';

/** A real-tree copy carrying exactly what the guard reads. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-deletion-control-'));
  mkdirSync(join(root, BRICK), { recursive: true });
  mkdirSync(join(root, SUBLY), { recursive: true });
  mkdirSync(join(root, dirname(CHASSIS)), { recursive: true });
  mkdirSync(join(root, dirname(SENTINEL)), { recursive: true });
  cpSync(join(REPO, 'pubspec.yaml'), join(root, 'pubspec.yaml'));
  cpSync(join(REPO, BRICK, 'lib'), join(root, BRICK, 'lib'), { recursive: true });
  cpSync(join(REPO, SUBLY, 'lib'), join(root, SUBLY, 'lib'), { recursive: true });
  // The shared confirmation. Without it every case below would be COVERAGE
  // LOST for a reason that has nothing to do with what it is testing.
  cpSync(join(REPO, CHASSIS), join(root, CHASSIS));
  // 🔴 THE SENTINEL IS COPIED ON PURPOSE, so this tree counts as a full
  // checkout and the chassis LINE FLOOR is applied here. The floor is a
  // measurement of the real repository and would mean nothing over a fixture —
  // but this tree is not a fixture: it carries the real brick, the real
  // apps/subly and the real widget, byte for byte. Leaving the sentinel out
  // would make the floor the one limb no test could ever reach.
  cpSync(join(REPO, SENTINEL), join(root, SENTINEL));
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

const edit = (root, rel, fn) => {
  const p = join(root, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};

/**
 * [edit], but a replacement that changed nothing FAILS THE TEST.
 *
 * 🔴 THREE TESTS IN THIS REPO WERE FOUND MEASURING NOTHING. Every case below
 * mutates the real tree by literal string, so a refactor upstream that changes
 * the spelling silently turns the mutation into a no-op and the "guard caught
 * it" assertion into "the guard was red for some other reason, or green over an
 * untouched tree". The one inline check at `requestServerDeletion` already
 * existed for this; it is a helper now so no new case can forget it.
 */
const mutate = (root, rel, fn) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(
    after,
    before,
    `the mutation of ${rel} did not apply — a test that mutates nothing proves nothing`,
  );
  writeFileSync(p, after);
};

describe('the real tree', () => {
  test('passes, and names both roots AND the branch each one took', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /2 of 2 root\(s\) offer accounts/);
        assert.match(r.stdout, /apps\/subly/);
        // 🔴 THE PASSING LINE HAS TO SAY WHERE IT LOOKED. Naming the roots and
        // nothing else stayed literally true while every property of the
        // confirmation had left those trees for packages/design_system and
        // gone unchecked — see the guard's header.
        assert.match(r.stdout, /=delegates to the shared confirmation/);
        assert.match(r.stdout, /apps\/subly=carries its own confirmation/);
        assert.match(r.stdout, /holds all 3 propert\(ies\)/);
        assert.match(r.stdout, /floor 90/, 'the tmp tree must count as a full checkout');
      },
    );
  });

  test('the copy the other tests mutate really is the real one', () => {
    // Without this, every "mutation caught" below could be an artefact of a
    // hand-built stand-in rather than evidence about the shipped app.
    withTree(
      () => {},
      () => {
        const real = readFileSync(join(REPO, SUBLY_SETTINGS), 'utf8');
        assert.ok(real.includes('.deleteAccount('), 'apps/subly must really carry the call site');
        assert.ok(real.includes('accountDeletionOutcomeOf('), 'and really classify the outcome');
        // And the second subject is the shipped widget, not a stand-in.
        const widget = readFileSync(join(REPO, CHASSIS), 'utf8');
        assert.ok(widget.includes('class DestructiveConfirmDialog'), 'the shared confirmation is real');
        assert.ok(widget.includes('PopScope(canPop: !_busy'), 'and really refuses to close mid-flight');
      },
    );
  });
});

describe('an app with accounts must SHIP the control', () => {
  test('🔴 DELETING THE CALL SITE FROM apps/subly FAILS — the exact state before [ADR 027]', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('.deleteAccount(', '.signOut(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /apps\/subly: no `\.deleteAccount\(` CALL SITE/);
      },
    );
  });

  test('🔴 AND FROM THE BRICK FAILS TOO — the template is app #2 through #50', () => {
    withTree(
      (root) => edit(root, BRICK_SETTINGS, (s) => s.replaceAll('await auth.deleteAccount()', 'await auth.signOut()')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no `\.deleteAccount\(` CALL SITE/);
      },
    );
  });

  test('a DECLARATION does not satisfy the call-site check', () => {
    // `Future<void> deleteAccount() async` exists in both trees already. The
    // leading dot is the whole check — assert-seams-wired.mjs shipped broken for
    // exactly this reason, and all six of its fixtures passed against it.
    withTree(
      (root) => {
        edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('.deleteAccount(', '.signOut('));
        edit(root, SUBLY_SETTINGS, (s) => `${s}\nFuture<void> deleteAccount() async {}\n`);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no `\.deleteAccount\(` CALL SITE/);
      },
    );
  });

  test('a COMMENTED-OUT call site does not satisfy it either', () => {
    withTree(
      (root) => {
        edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('.deleteAccount(', '.signOut('));
        edit(root, SUBLY_SETTINGS, (s) => `${s}\n// auth.deleteAccount();\n`);
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no `\.deleteAccount\(` CALL SITE/);
      },
    );
  });

  test('a call site OUTSIDE settings does not count — a reviewer looks in Settings', () => {
    withTree(
      (root) => {
        edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('.deleteAccount(', '.signOut('));
        writeFileSync(
          join(root, SUBLY, 'lib', 'state', 'orphan_delete.dart'),
          'void wire(dynamic a) { a.deleteAccount(); }\n',
        );
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no `\.deleteAccount\(` CALL SITE in lib\/features\/settings/);
      },
    );
  });
});

describe('the confirmation must not be one tap away', () => {
  test('removing the dialog fails', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('showDialog', 'showNothing')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /opens no dialog/);
      },
    );
  });

  test('🔴 THE OTHER DIALOGS ON THE SCREEN DO NOT COVER THE DELETION', () => {
    // The brick's settings screen opens a reminder-priming dialog at :434 and
    // an edit-profile dialog at :530. Remove ONLY the deletion's own
    // confirmation and a bare `showDialog` substring is still satisfied by
    // either of them — which is how this limb could stay green over a deletion
    // with no confirmation at all. Coverage of a screen is not coverage of its
    // rules, and this is the case that says so.
    withTree(
      (root) =>
        mutate(root, BRICK_SETTINGS, (s) => {
          const bd = s.indexOf('barrierDismissible: false');
          const at = s.lastIndexOf('showDialog', bd);
          return (
            s.slice(0, at) +
            'showNothing' +
            s.slice(at + 'showDialog'.length).replace('      barrierDismissible: false,\n', '')
          );
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NOT ONE of them is the deletion's own undismissable confirmation/);
        // And it says how many it DID find, so the reader can see that the
        // screen still has dialogs and that having them is not the point.
        assert.match(r.stderr, /2 `showDialog` call\(s\)/);
      },
    );
  });

  test('🔴 DROPPING barrierDismissible: false FAILS — the barrier is half the lock', () => {
    withTree(
      (root) =>
        mutate(root, BRICK_SETTINGS, (s) => s.replace('      barrierDismissible: false,\n', '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NOT ONE of them is the deletion's own undismissable confirmation/);
      },
    );
  });

  test('removing the RE-AUTH fails', () => {
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('signInWithEmail(', 'signedInAlready(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not RE-AUTHENTICATE/);
      },
    );
  });
});

describe('the outcomes must not collapse into one message', () => {
  test('🔴 COLLAPSING THE FAILURE PATH BACK TO catch(_) FAILS', () => {
    // The defect this limb exists for: one string for 501 (nothing was deleted)
    // and 502 (the data is gone and the login still works).
    withTree(
      (root) => edit(root, SUBLY_SETTINGS, (s) => s.replaceAll('core.accountDeletionOutcomeOf(', 'ignore(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never reaches\s+`accountDeletionOutcomeOf`/);
      },
    );
  });

  test('and collapsing it in the BRICK fails', () => {
    withTree(
      (root) => edit(root, BRICK_SETTINGS, (s) => s.replaceAll('core.accountDeletionOutcomeOf(', 'ignore(')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never reaches\s+`accountDeletionOutcomeOf`/);
      },
    );
  });
});

describe('the server hook must not be nulled out from under it', () => {
  test('🔴 requestServerDeletion: null FAILS even with every other limb intact', () => {
    // This is not hypothetical: it is what the brick shipped until [pipeline
    // C-15]. Every visible limb passes and the user is signed out, never deleted.
    withTree(
      (root) =>
        edit(root, SUBLY_AUTH_PROVIDERS, (s) => {
          const out = s.replace(
            /requestServerDeletion: \(\) =>[\s\S]*?\),\n/,
            'requestServerDeletion: null,\n',
          );
          assert.ok(
            /requestServerDeletion:\s*null/.test(out),
            'the mutation itself did not apply — a test that mutates nothing proves nothing',
          );
          return out;
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /requestServerDeletion: null` is wired/);
      },
    );
  });
});

describe('the domain filter is derived, and cannot become a waiver', () => {
  test('an app with NO account surface owes nothing, and says so out loud', () => {
    withTree(
      (root) => {
        // Strip the auth seam from apps/subly entirely — the shape of a future
        // app that genuinely has no accounts.
        rmSync(join(root, SUBLY, 'lib'), { recursive: true, force: true });
        mkdirSync(join(root, SUBLY, 'lib'), { recursive: true });
        writeFileSync(join(root, SUBLY, 'lib', 'main.dart'), 'void main() {}\n');
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /apps\/subly — no account surface/);
        assert.match(r.stdout, /1 of 2 root\(s\) offer accounts/);
      },
    );
  });

  test('🔴 A MERE MENTION OF AuthRepository IS NOT AN ACCOUNT SURFACE', () => {
    // Both limbs are required precisely so a leftover import cannot conjure an
    // obligation — and so deleting the sign-in path cannot dissolve one.
    withTree(
      (root) => {
        rmSync(join(root, SUBLY, 'lib'), { recursive: true, force: true });
        mkdirSync(join(root, SUBLY, 'lib'), { recursive: true });
        writeFileSync(join(root, SUBLY, 'lib', 'main.dart'), '// AuthRepository lived here once\nclass AuthRepository {}\n');
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /signInWithEmail: false/);
      },
    );
  });
});

describe('coverage self-checks', () => {
  test('🔴 EVERY ROOT JUDGED ACCOUNT-FREE IS COVERAGE LOST, NOT A PASS', () => {
    // Every assertion is gated on that judgement, so a clean pass over an
    // account-free world would mean the scan stopped recognising an account.
    withTree(
      (root) => {
        for (const app of [BRICK, SUBLY]) {
          rmSync(join(root, app, 'lib'), { recursive: true, force: true });
          mkdirSync(join(root, app, 'lib'), { recursive: true });
          writeFileSync(join(root, app, 'lib', 'main.dart'), 'void main() {}\n');
        }
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /not one of the 2 root\(s\) was judged to offer accounts/);
      },
    );
  });

  test('an empty app lib is COVERAGE LOST — a scan over nothing prints ok', () => {
    withTree(
      (root) => rmSync(join(root, SUBLY, 'lib'), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /no Dart source was read under apps\/subly\/lib/);
      },
    );
  });

  test('losing the workspace block is COVERAGE LOST', () => {
    withTree(
      (root) => writeFileSync(join(root, 'pubspec.yaml'), 'name: nikatru_workspace\n'),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /no readable `workspace:` block/);
      },
    );
  });

  test('🔴 DROPPING apps/* FROM THE WORKSPACE LIST IS COVERAGE LOST, NOT A SMALLER PASS', () => {
    // The exact shape of the original hole: a domain that collapses to the brick
    // template, which was never the problem.
    withTree(
      (root) =>
        edit(root, 'pubspec.yaml', (s) => s.replace(/^\s*-\s*apps\/subly\s*$/m, '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /only 1 root\(s\) resolved/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SECOND SUBJECT — the confirmation itself, since [ADR 065] chassis step 2.
//
// 🔴 EVERY CASE IN THIS SECTION WAS GREEN BEFORE THE GUARD CHANGE THEY BELONG
// TO. Measured on 2026-09-05 by running the PREVIOUS version of the guard
// (`git show HEAD:tooling/ci/assert-deletion-control.mjs`) against these exact
// mutations of this worktree: gutting the secret gate exited 0, flipping
// `canPop` to `true` exited 0, and DELETING THE WIDGET FILE exited 0. The
// brick's settings tree still called `showDialog`, so the old limb 3 stayed
// satisfied over a confirmation that had none of the properties limb 3 stands
// for.
// ─────────────────────────────────────────────────────────────────────────────
describe('the shared confirmation keeps its properties where it now lives', () => {
  test('🔴 GUTTING THE SECRET GATE FAILS — one stray tap must not reach the deletion', () => {
    withTree(
      (root) =>
        mutate(root, CHASSIS, (s) =>
          s
            .replace('final bool ready = !_busy && value.text.isNotEmpty;', 'final bool ready = !_busy;')
            .replace('onPressed: ready ? _run : null,', 'onPressed: _run,'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /destructive_confirm_dialog\.dart: the shared confirmation/);
        assert.match(r.stderr, /INERT until the secret is typed/);
      },
    );
  });

  test('keeping the read but making the button unconditional fails too', () => {
    // The FIRST draft of this limb passed this exactly: it asked for
    // `.text.isEmpty` anywhere and for an `onPressed` that could be `null`
    // anywhere, and the CANCEL button satisfies the second half in every
    // version of this file. A limb that cannot fail is not a limb.
    withTree(
      (root) => mutate(root, CHASSIS, (s) => s.replace('onPressed: ready ? _run : null,', 'onPressed: _run,')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /INERT until the secret is typed/);
      },
    );
  });

  test('🔴 MAKING IT DISMISSIBLE MID-FLIGHT FAILS', () => {
    // And this one caught a real defect in the guard rather than in the widget:
    // the first `PopScope` check was a negative lookahead that `\s*` could
    // backtrack past, so `canPop: true` matched "not true" and this mutation
    // exited 0. The value is captured and compared now.
    withTree(
      (root) =>
        mutate(root, CHASSIS, (s) =>
          s.replace(
            'return PopScope(canPop: !_busy, child: _form(context));',
            'return PopScope(canPop: true, child: _form(context));',
          ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /NOTHING may dismiss it while the request is in flight/);
      },
    );
  });

  test('🔴 COLLAPSING THE RESULT PHASE TO A FIXED STRING FAILS', () => {
    // 501 (nothing was deleted) and 502 (the data is gone and the login still
    // works) must not read identically — the same defect limb 5 covers on the
    // app side, asserted on the side that actually paints the sentence.
    withTree(
      (root) =>
        mutate(root, CHASSIS, (s) =>
          s
            .replace(
              'Text(report.message, key: widget.resultKey),',
              'Text(widget.confirmLabel, key: widget.resultKey),',
            )
            .replace(
              'final DestructiveActionReport report = await widget.onConfirm();',
              'final DestructiveActionReport report = await _go();',
            ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /says WHAT ACTUALLY HAPPENED/);
      },
    );
  });

  test('🔴 DELETING THE WIDGET IS COVERAGE LOST, NOT A PASS', () => {
    withTree(
      (root) => rmSync(join(root, CHASSIS), { force: true }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /destructive_confirm_dialog\.dart is not a file/);
      },
    );
  });

  test('🔴 STUBBING IT BELOW ITS OWN FLOOR IS COVERAGE LOST — one floor for this root alone', () => {
    // A stub failing three property limbs would read as three behavioural
    // regressions when the truth is that the subject is gone. And the floor is
    // this root's OWN: no neighbouring tree can carry it, which is the failure
    // assert-workspace-coverage.mjs:130-136 and assert-no-tls-pinning.mjs:75-93
    // both record.
    withTree(
      (root) => writeFileSync(join(root, CHASSIS), 'class DestructiveConfirmDialog {}\n'),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /below its floor of 90/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENFORCEMENT FOLLOWS THE BEHAVIOUR, WHICH IS WHAT CHASSIS STEP 4 NEEDS.
// ─────────────────────────────────────────────────────────────────────────────
describe('a root that carries its own confirmation owes the properties itself', () => {
  test('🔴 apps/subly LOSING ITS IN-FLIGHT LOCK FAILS', () => {
    withTree(
      (root) =>
        mutate(root, SUBLY_SETTINGS, (s) =>
          s.replace(
            'return PopScope(canPop: !_busy, child: _form(context));',
            'return PopScope(canPop: true, child: _form(context));',
          ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /apps\/subly: its OWN confirmation/);
        assert.match(r.stderr, /NOTHING may dismiss it while the request is in flight/);
      },
    );
  });

  test('🔴 apps/subly LOSING ITS SECRET GATE FAILS', () => {
    withTree(
      (root) =>
        mutate(root, SUBLY_SETTINGS, (s) =>
          s.replace('onPressed: (_busy || widget.password.text.isEmpty) ? null : _run,', 'onPressed: _run,'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /apps\/subly: its OWN confirmation/);
        assert.match(r.stderr, /INERT until the secret is typed/);
      },
    );
  });

  test('🔴 STEP 4 DONE WRONG — the copy emptied and nothing delegated — FAILS', () => {
    withTree(
      (root) =>
        mutate(root, SUBLY_SETTINGS, (s) =>
          s
            .replace(
              'return PopScope(canPop: !_busy, child: _form(context));',
              'return PopScope(canPop: true, child: _form(context));',
            )
            .replace('onPressed: (_busy || widget.password.text.isEmpty) ? null : _run,', 'onPressed: _run,')
            .replace(
              'final core.AccountDeletionOutcome outcome = await widget.onConfirm();',
              'final core.AccountDeletionOutcome outcome = await _go();',
            ),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /apps\/subly: its OWN confirmation/);
        assert.match(r.stderr, /Delegating to `packages\/design_system/);
      },
    );
  });

  test('✅ STEP 4 DONE RIGHT — the copy emptied AND the tree delegates — STAYS GREEN', () => {
    // The point of the whole design. When chassis step 4 takes apps/subly's own
    // dialog away, the properties are still enforced — over the widget it now
    // renders — and the passing line SAYS the branch flipped, so the move is
    // visible in the log rather than inferred. Without the last replacement
    // this is the failing case immediately above, which is what makes this
    // green a measurement and not an absence.
    withTree(
      (root) =>
        mutate(root, SUBLY_SETTINGS, (s) =>
          s
            .replace(
              'return PopScope(canPop: !_busy, child: _form(context));',
              'return PopScope(canPop: true, child: _form(context));',
            )
            .replace('onPressed: (_busy || widget.password.text.isEmpty) ? null : _run,', 'onPressed: _run,')
            .replace(
              'final core.AccountDeletionOutcome outcome = await widget.onConfirm();',
              'final core.AccountDeletionOutcome outcome = await _go();',
            )
            .replace(
              'builder: (BuildContext dialogContext) => _DeleteAccountDialog(',
              'builder: (BuildContext dialogContext) => DestructiveConfirmDialog(',
            ),
        ),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /apps\/subly=delegates to the shared confirmation/);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DELETION CONTROL MOVED INTO THE CHASSIS PACKAGE — [ADR 067] decision 2
//
// [ADR 066] step 4 empties a settings screen into
// `package:nikatru_chassis_screens`, and the `.deleteAccount(` call site goes
// with the body. Read at the adapter alone this guard reports that an app with
// accounts ships no in-app deletion path — a store-blocking claim, made about a
// tree that has one.
//
// 🔴 THE EXTENSION SHIPPED WITH NO TEST. It gained 93 lines on 2026-09-05 and
// this file gained none. DD3 is the case that matters: an import the adapter
// never references must NOT widen the scan, because a package file that merely
// SAYS `.deleteAccount(` is not a deletion control a user can reach.
// ─────────────────────────────────────────────────────────────────────────────
describe('a deletion control that moved into the chassis package', () => {
  const CHASSIS_REL = 'packages/chassis_screens/lib/settings_body.dart';
  const IMPORT = "import 'package:nikatru_chassis_screens/settings_body.dart';\n";
  const USE = '\nWidget shell(BuildContext c) => const SettingsBody();\n';

  /** The package file. `carries` false makes the call genuinely absent from
   *  both files, which is the finding this guard exists for. */
  const packageBody = (carries) =>
    'class SettingsBody {\n  Future<void> remove(WidgetRef ref) async {\n' +
    (carries ? '    await repo.deleteAccount();\n' : '    return;\n') +
    '  }\n}\n';

  const moved = ({ inPackage = true, used = true, onDisk = true } = {}) => (root) => {
    edit(root, SUBLY_SETTINGS, (s) => IMPORT + s.split('.deleteAccount(').join('.noopRemove(') + (used ? USE : ''));
    if (onDisk) {
      const p = join(root, CHASSIS_REL);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, packageBody(inPackage));
    }
  };

  // GREEN CONTROL 1 — the resolver runs on an otherwise untouched tree.
  test('DD0 · an honest delegation is followed and REPORTED, and the run stays green', () => {
    withTree(
      (root) => {
        edit(root, SUBLY_SETTINGS, (s) => IMPORT + s + USE);
        const p = join(root, CHASSIS_REL);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, packageBody(false));
      },
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /the settings scan also read 1 chassis file\(s\) it delegates to/);
      },
    );
  });

  // GREEN CONTROL 2 — the call site itself moves and is found where it landed.
  test('DD1 · the call site moves into the package and the control is still shipped', () => {
    withTree(moved({ inPackage: true }), (r) => {
      assert.equal(r.status, 0, r.stderr);
    });
  });

  test('DD2 · 🔴 the call site is in NEITHER file — the store finding still fires', () => {
    withTree(moved({ inPackage: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /no `\.deleteAccount\(` CALL SITE/);
    });
  });

  // 🔴 THE EXPLOIT: the call is deleted, the package says the words, and
  // nothing in the adapter references the import.
  test('DD3 · 🔴 an UNUSED chassis import does not stand in for the deleted call site', () => {
    withTree(moved({ inPackage: true, used: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /never references anything it declares \(SettingsBody\)/);
    });
  });

  test('DD4 · 🔴 a delegation to a file that is not on disk is COVERAGE LOST', () => {
    withTree(moved({ onDisk: false }), (r) => {
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout + r.stderr, /that file is not on disk/);
    });
  });
});
