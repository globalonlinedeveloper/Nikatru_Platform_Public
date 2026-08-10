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
// in both trees. `apps/subly/test/legal_gates_test.dart` covers the app side;
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
const SUBLY = 'apps/subly';
const SUBLY_SIGNUP = `${SUBLY}/lib/features/auth/sign_up_screen.dart`;
const SUBLY_LOGIN = `${SUBLY}/lib/features/auth/login_screen.dart`;
const SUBLY_REACCEPT = `${SUBLY}/lib/features/auth/reaccept_terms_screen.dart`;
const SUBLY_FIELDS = `${SUBLY}/lib/features/auth/legal_consent_fields.dart`;
const BRICK_SIGNUP = `${BRICK}/lib/features/auth/sign_up_screen.dart`;

/** A real-tree copy carrying exactly what the guard reads: both roots' auth
 *  feature directories. Nothing else is read, so nothing else is copied. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-signup-consent-'));
  for (const r of [BRICK, SUBLY]) {
    mkdirSync(join(root, r, 'lib', 'features'), { recursive: true });
    cpSync(join(REPO, r, 'lib', 'features', 'auth'), join(root, r, 'lib', 'features', 'auth'), {
      recursive: true,
    });
  }
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
  test('passes, and reports what it actually scanned', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /5 surface\(s\) scanned/);
        assert.match(r.stdout, /every consent flag initialises to false/);
      },
    );
  });

  test('the copy the other cases mutate really carries the flags', () => {
    // Without this, every "caught" below could be an artefact of a stand-in
    // rather than evidence about the screens that ship.
    for (const rel of [SUBLY_SIGNUP, SUBLY_LOGIN, BRICK_SIGNUP]) {
      const src = readFileSync(join(REPO, rel), 'utf8');
      assert.ok(src.includes('bool _acceptedTerms = false;'), `${rel} must carry the terms flag`);
      assert.ok(src.includes('bool _marketingEmail = false;'), `${rel} must carry the marketing flag`);
    }
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

  test('🔴 a PRE-TICKED MARKETING box fails in the BRICK — where no Dart test can see it', () => {
    withTree(
      (root) =>
        edit(root, BRICK_SIGNUP, (s) =>
          s.replace('bool _marketingEmail = false;', 'bool _marketingEmail = true;'),
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /PRE-TICKED CONSENT/);
        assert.match(r.stderr, /__brick__/);
      },
    );
  });

  test('the interstitial is covered too — it takes a fresh act, not a carried-forward one', () => {
    withTree(
      (root) => edit(root, SUBLY_REACCEPT, (s) => s.replace('bool _accepted = false;', 'bool _accepted = true;')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /reaccept_terms_screen/);
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
});

describe('the guard knows when it is not looking', () => {
  test('COVERAGE LOST when a listed surface is missing', () => {
    withTree(
      (root) => rmSync(join(root, BRICK_SIGNUP)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
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
