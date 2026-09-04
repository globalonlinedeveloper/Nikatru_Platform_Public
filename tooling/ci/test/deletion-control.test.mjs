// ─────────────────────────────────────────────────────────────────────────────
// deletion-control.test.mjs — the negative cases for assert-deletion-control.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// This repo has shipped a guard whose six fixture tests all passed against a
// broken version (`assert-seams-wired.mjs`, whose caller check matched the
// function's own declaration): a fixture you write encodes the same
// misunderstanding as the guard you write. The copy below carries the real
// brick, the real apps/subly and the real root pubspec, so a mutation here is
// the mutation a person would actually make.
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

/** A real-tree copy carrying exactly what the guard reads. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-deletion-control-'));
  mkdirSync(join(root, BRICK), { recursive: true });
  mkdirSync(join(root, SUBLY), { recursive: true });
  cpSync(join(REPO, 'pubspec.yaml'), join(root, 'pubspec.yaml'));
  cpSync(join(REPO, BRICK, 'lib'), join(root, BRICK, 'lib'), { recursive: true });
  cpSync(join(REPO, SUBLY, 'lib'), join(root, SUBLY, 'lib'), { recursive: true });
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

describe('the real tree', () => {
  test('passes, and names both roots', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /2 of 2 root\(s\) offer accounts/);
        assert.match(r.stdout, /apps\/subly/);
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
