// ─────────────────────────────────────────────────────────────────────────────
// desktop-runner-identity.test.mjs — the negative cases for
// assert-desktop-runner-identity.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// This repo has shipped a guard whose six fixture tests all passed against a
// broken version (`assert-seams-wired.mjs`, whose caller check matched the
// function's own declaration): a fixture you write encodes the same
// misunderstanding as the guard you write. The copy below carries the real
// Runner.rc, the real AppInfo.xcconfig and the real build.gradle.kts, so every
// mutation here is one a person could actually make.
//
// 🔬 ONE CASE BELOW EXISTS BECAUSE THE FIRST MUTATION RUN WAS WRONG, NOT THE
// GUARD. Removing only the macOS PRODUCT_BUNDLE_IDENTIFIER left the android
// applicationId still supplying a forbidden set, so the guard passed — correctly.
// It is kept as `both id sources` + `one id source` precisely so nobody later
// "fixes" the guard to fail on the harmless half.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-desktop-runner-identity.mjs');

const APP = 'apps/subscriptiontracker';
const RC = `${APP}/windows/runner/Runner.rc`;
const XC = `${APP}/macos/Runner/Configs/AppInfo.xcconfig`;
const GRADLE = `${APP}/android/app/build.gradle.kts`;

/** A real-tree copy carrying exactly what the guard reads — nothing invented. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-desktop-identity-'));
  for (const rel of [RC, XC, GRADLE]) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  cpSync(join(REPO, APP, 'pubspec.yaml'), join(root, APP, 'pubspec.yaml'));
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
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  // A mutation that did not apply is a FALSE pass: the guard would be judged
  // against unmodified input and every case would look "caught".
  assert.notEqual(after, before, `mutation anchor not found in ${rel} — the test proved nothing`);
  writeFileSync(p, after);
};

// 🔴 THE MUTATION READS THE ID OUT OF THE FILE; IT DOES NOT SPELL IT. Until
// 2026-09-09 the three "id source gone" mutations below searched for the
// literal `com.nikatru.subscriptiontracker`, and the rename to `com.nikatru.subscriptiontracker`
// made every one of them an anchor that matches nothing. `edit`'s land-check
// turns that into a LOUD failure rather than a silent pass — which is the only
// reason this was a re-spelling job and not seven dead controls — but a control
// that has to be hand-re-spelled on every rename is a control that WILL be
// re-spelled wrong eventually. These two helpers strip whatever reverse-DNS id
// the file actually declares, so the next rename cannot reach them at all.
//
// What the mutation must produce is an id that is NOT reverse-DNS, because the
// guard derives its forbidden set from dotted ids and the case under test is
// "no id source left to derive from".
// The app id AS THE TREE DECLARES IT TODAY, read once. The two `setValue` rows
// below inject a bad value that must CONTAIN a real application id; typing that
// id made them survive the rename only because the ORG PREFIX (`com.nikatru`)
// happened to be unchanged. Reading it keeps them testing the whole id.
const REAL_APP_ID = (() => {
  const m = readFileSync(join(REPO, GRADLE), 'utf8').match(/^\s*applicationId = "([^"]+)"$/m);
  assert.ok(m, `no applicationId in ${GRADLE} — this test can derive nothing`);
  return m[1];
})();

const stripXcId = (s) => s.replace(/^(PRODUCT_BUNDLE_IDENTIFIER = )[A-Za-z0-9_.-]+$/m, '$1app');
const stripGradleId = (s) => s.replace(/^(\s*applicationId = )"[A-Za-z0-9_.-]+"$/m, '$1"app"');

describe('the real tree', () => {
  test('passes, and says what it read', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /identity field\(s\) read/);
      },
    );
  });

  test('states out loud that it does not assert WHICH company name is correct', () => {
    // The factory is multi-brand. A future reader must not mistake this guard
    // for one that pins the brand, or they will "strengthen" it into something
    // that fails on app #2.
    withTree(
      () => {},
      (r) => assert.match(r.stdout, /does NOT assert which company name is correct/),
    );
  });
});

describe('limb 1 — no application id in a field a human reads', () => {
  /** Overwrite one `VALUE "<field>", "<anything>"` with `replacement`.
   *
   *  ⚠️ THE CURRENT VALUE IS MATCHED, NEVER TYPED. Two of these rows carried the
   *  app's brand as a literal, so the 2026-09-09 rename turned `.replace()` into
   *  a no-op — and a mutation that mutates nothing leaves a RED CONTROL passing
   *  the guard and failing only on the assertion, if it fails at all. It is
   *  asserted here that the text really changed, so the next rename cannot
   *  quietly disarm these three cases the way this one did. */
  const setValue = (field, replacement) => (src) => {
    const re = new RegExp(`VALUE "${field}", "[^"]*"`);
    if (!re.test(src)) throw new Error(`fixture anchor not found: VALUE "${field}" — Runner.rc moved under this test`);
    const out = src.replace(re, `VALUE "${field}", "${replacement}"`);
    if (out === src) throw new Error(`the mutation for ${field} changed nothing, so this red control proves nothing`);
    return out;
  };

  const FIELDS = [
    ['CompanyName', setValue('CompanyName', 'com.nikatru')],
    ['FileDescription', setValue('FileDescription', REAL_APP_ID)],
    ['LegalCopyright', (s) => s.replace('Copyright (C) 2026 Nikatru.', 'Copyright (C) 2026 com.nikatru.')],
    ['ProductName', setValue('ProductName', REAL_APP_ID)],
  ];

  for (const [field, mutate] of FIELDS) {
    test(`Windows ${field} carrying the app id fails`, () => {
      withTree(
        (root) => edit(root, RC, mutate),
        (r) => {
          assert.equal(r.status, 1);
          assert.match(r.stderr, new RegExp(`VALUE "${field}"`));
          assert.match(r.stderr, /contains the application id/);
        },
      );
    });
  }

  test('macOS PRODUCT_COPYRIGHT carrying the app id fails', () => {
    withTree(
      (root) => edit(root, XC, (s) => s.replace('Copyright © 2026 Nikatru.', 'Copyright © 2026 com.nikatru.')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /PRODUCT_COPYRIGHT.*contains the application id/s);
      },
    );
  });

  test('the org prefix alone is enough — the full bundle id need not appear', () => {
    // The real defect was `com.nikatru`, a PREFIX of `com.nikatru.subscriptiontracker`.
    // Matching only the whole id would have missed the bug that motivated this.
    withTree(
      (root) => edit(root, RC, (s) => s.replace('VALUE "CompanyName", "Nikatru"', 'VALUE "CompanyName", "com.nikatru"')),
      (r) => assert.match(r.stderr, /application id "com\.nikatru"/),
    );
  });

  test('a legitimate domain in a human field does NOT fail', () => {
    // The guard must not fire on correct input. `nikatru.com` is a dotted
    // lowercase token and a naive pattern rejects it; a guard that fails on
    // correct input gets disabled by whoever hits it next.
    //
    // ⚠️ BOTH platforms are edited, and the first draft of this test edited only
    // Windows — which tripped limb 2 (the holders then disagreed) and read as
    // limb 1 rejecting the domain. It was the test that was wrong. A one-sided
    // edit here proves nothing about the domain and everything about drift.
    withTree(
      (root) => {
        edit(root, RC, (s) => s.replace('Copyright (C) 2026 Nikatru.', 'Copyright (C) 2026 Nikatru (nikatru.com).'));
        edit(root, XC, (s) => s.replace('Copyright © 2026 Nikatru.', 'Copyright © 2026 Nikatru (nikatru.com).'));
      },
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });

  test('the com.example Flutter placeholder fails', () => {
    withTree(
      (root) => edit(root, RC, setValue('ProductName', 'com.example')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /com\.example.*placeholder/);
      },
    );
  });

  test('an empty human field fails', () => {
    withTree(
      (root) => edit(root, RC, (s) => s.replace('VALUE "CompanyName", "Nikatru"', 'VALUE "CompanyName", ""')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /is empty/);
      },
    );
  });

  test('a deleted VERSIONINFO field fails rather than being skipped', () => {
    // Missing is not empty — it is unreadable, and skipping it silently is how a
    // scanner stops covering what it thinks it covers.
    withTree(
      (root) => edit(root, RC, (s) => s.replace(/^.*VALUE "CompanyName".*$\n/m, '')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no VALUE "CompanyName"/);
      },
    );
  });
});

describe('limb 2 — one company, two platforms, one spelling', () => {
  test('a copyright holder that differs by platform fails', () => {
    withTree(
      (root) => edit(root, XC, (s) => s.replace('Copyright © 2026 Nikatru.', 'Copyright © 2026 Nikatru Labs.')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /copyright holder differs by platform/);
      },
    );
  });

  test('a CompanyName that disagrees with the copyright holder fails', () => {
    withTree(
      (root) => edit(root, RC, (s) => s.replace('VALUE "CompanyName", "Nikatru"', 'VALUE "CompanyName", "Acme"')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /are different companies/);
      },
    );
  });

  test('a copyright line the parser cannot read fails, and does not pass quietly', () => {
    withTree(
      (root) => edit(root, XC, (s) => s.replace(/^PRODUCT_COPYRIGHT = .+$/m, 'PRODUCT_COPYRIGHT = (c) Nikatru')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /not in the form/);
      },
    );
  });
});

describe('coverage — an empty evaluation set is never green', () => {
  test('both id sources gone → the guard says it has nothing to compare against', () => {
    withTree(
      (root) => {
        edit(root, XC, stripXcId);
        edit(root, GRADLE, stripGradleId);
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });

  test('ONE id source gone still passes — the other still supplies the forbidden set', () => {
    // Kept deliberately. The first mutation run treated this as a miss; it is
    // not. Making the guard fail here would make it fail on a correct tree.
    withTree(
      (root) => edit(root, XC, stripXcId),
      (r) => assert.equal(r.status, 0, r.stderr),
    );
  });

  test('an app with no desktop runner at all is COVERAGE LOST, not a pass', () => {
    withTree(
      (root) => {
        rmSync(join(root, APP, 'windows'), { recursive: true, force: true });
        rmSync(join(root, APP, 'macos'), { recursive: true, force: true });
      },
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST: no app under apps\//);
      },
    );
  });

  test('no apps/ directory at all is COVERAGE LOST', () => {
    withTree(
      (root) => rmSync(join(root, 'apps'), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 2);
        assert.match(r.stderr, /COVERAGE LOST/);
      },
    );
  });
});
