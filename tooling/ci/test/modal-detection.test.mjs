// ─────────────────────────────────────────────────────────────────────────────
// modal-detection.test.mjs — the negative cases for assert-modal-detection.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL SUITE, never a hand-built fixture,
// and in this guard's family that is not a stylistic preference. The thing being
// guarded is a line that sat in `integration_test/store_screenshots_test.dart`
// for eighteen days looking exactly like correct code, in a file whose OTHER
// helpers had already been fixed. A fixture written from the same understanding
// that wrote the guard would reproduce the guard's blind spots, not the tree's —
// the assert-seams-wired failure shape, where all six fixtures were green
// against a caller check that matched the function's own declaration.
//
// So the primary case below is not a model of the defect. It IS the defect: the
// real file, with `consentDecline` swapped back to `find.byType(Dialog)` inside
// the same `waitFor` that failed run 32947223120 on 2026-08-26.
//
// 🔬 THE BASELINE CASE IS ITSELF A MEASUREMENT, and it is the one that decides
// whether this guard is usable. The first version of the guard flagged
// `find.byType(AppShell)` in `signOutIfSignedIn` — honest code asking which
// screen the app is on — and the real tree is what refuted it. `the real tree
// passes` and `a screen-state branch is not a modal detector` are therefore
// load-bearing tests, not smoke: they are what stops this guard being narrowed
// into uselessness OR widened back into a nuisance.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-modal-detection.mjs');

const SUBLY = 'apps/subly';
const CAPTURE = `${SUBLY}/integration_test/store_screenshots_test.dart`;
const APP_TEST = `${SUBLY}/integration_test/app_test.dart`;

/** The corrected consent block in the capture suite — the fix that shipped on
 *  2026-08-26 and the anchor every mutation below is expressed against. Written
 *  out rather than located by line number because another change to that file
 *  moves the line and would silently turn every mutation into a no-op. */
const ANCHOR_DECL = "final Finder consentDecline = find.text('No thanks');";
/** The finder as the `waitFor` argument, indentation included, so a replacement
 *  cannot accidentally match the declaration above. */
const ANCHOR_ARG = '\n      consentDecline,\n';

/** The brick, and the manifest that DECLARES it. Both, because the guard treats
 *  "the manifest is here and the app tree is not" as COVERAGE LOST — see the
 *  two-root cases below, which are the reason these paths are named at all. */
const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const BRICK_MANIFEST = 'tooling/bricks/app/brick.yaml';

/** A real-tree copy carrying exactly what the guard reads: the workspace list
 *  and both of Subly's suite directories, plus — by default — the brick and its
 *  manifest, so the tree under test has the SAME TWO ROOTS the repository has.
 *
 *  🔴 IT USED TO OMIT THE BRICK, and every case in this file therefore ran on
 *  one root. That is how the guard shipped able to lose an entire root in
 *  silence: measured 2026-08-26, brick present -> 329 sites / 72 files / 2
 *  roots exit 0, brick directory renamed -> 263 / 65 / 1, exit 0, "ok". No case
 *  here could have seen it, because no case here had two roots to lose one of.
 *  `{ brick: false }` still builds the one-root tree, and one case below uses it
 *  deliberately: a partial tree with NO brick package at all is legitimate, and
 *  must stay legitimate, or this harness could not exist. */
function realTree({ brick = true, brickManifest = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-modal-'));
  cpSync(join(REPO, 'pubspec.yaml'), join(root, 'pubspec.yaml'));
  for (const d of ['test', 'integration_test']) {
    cpSync(join(REPO, SUBLY, d), join(root, SUBLY, d), { recursive: true });
  }
  if (brick) cpSync(join(REPO, BRICK), join(root, BRICK), { recursive: true });
  if (brickManifest) {
    mkdirSync(join(root, 'tooling', 'bricks', 'app'), { recursive: true });
    cpSync(join(REPO, BRICK_MANIFEST), join(root, BRICK_MANIFEST));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { cwd: REPO, encoding: 'utf8' });
  return { ...r, out: `${r.stdout}${r.stderr}` };
}

function withTree(mutate, fn, opts) {
  const root = realTree(opts);
  try {
    mutate(root);
    fn(run(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Every `find.byType(` this tree actually contains, counted independently of
 *  the guard — the check on the guard's own printed number. Deliberately a
 *  DIFFERENT reading: raw text, comments and literals included, which is why it
 *  is an upper bound and not an equality. */
function rawByTypeCount(root) {
  let total = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.dart')) {
        total += readFileSync(p, 'utf8').split(/\bfind\s*\.\s*byType\s*\(/).length - 1;
      }
    }
  };
  for (const rootRel of [SUBLY, BRICK]) {
    for (const d of ['test', 'integration_test']) {
      const abs = join(root, rootRel, d);
      if (existsSync(abs)) walk(abs);
    }
  }
  return total;
}

/** Rewrite a file in the copy, ASSERTING the edit actually landed.
 *
 *  🔴 THE ASSERTION IS THE POINT. A mutation that silently matches nothing turns
 *  a "the guard catches X" test into a test that the UNMUTATED tree is clean —
 *  which passes, forever, while proving nothing. That is this repository's
 *  scan-over-nothing defect wearing a test's clothes, so every edit here is
 *  required to change the text it claims to change. */
function edit(root, rel, from, to) {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  assert.ok(
    before.includes(from),
    `the anchor for this mutation is no longer in ${rel}:\n  ${from}\n` +
      'The suite changed shape; re-point the anchor rather than deleting the case, or this test starts ' +
      'passing over an unmutated tree.',
  );
  const after = before.split(from).join(to);
  assert.notEqual(after, before, `mutating ${rel} produced no change`);
  writeFileSync(p, after);
}

describe('assert-modal-detection · the real tree', () => {
  test('passes at HEAD, and the count it reports is not zero', () => {
    withTree(
      () => {},
      (r, root) => {
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /assert-modal-detection: ok/);
        const m = r.out.match(/note (\d+) `find\.byType\(` site\(s\) across (\d+) suite file\(s\)/);
        assert.ok(m, `the passing line no longer reports its counts:\n${r.out}`);
        assert.ok(Number(m[1]) > 100, `only ${m[1]} sites — the scan has lost its grip on the corpus`);
        assert.ok(Number(m[2]) > 10, `only ${m[2]} files — the walk has lost its grip on the corpus`);
        assert.match(r.out, /in 2 root\(s\)/, 'the brick root is not being scanned by this harness');
        // …and the printed number is not free to drift from the tree. It counts
        // OCCURRENCES, so it must never exceed a raw text count that includes
        // the comments and literals the guard blanks. It printed 330 over 329
        // occurrences until 2026-08-26, because the alias limb pushed a second
        // site for one it had already counted.
        const raw = rawByTypeCount(root);
        assert.ok(
          Number(m[1]) <= raw,
          `the guard printed ${m[1]} sites over a tree holding at most ${raw} \`find.byType(\` occurrences — ` +
            'something is being counted twice',
        );
      },
    );
  });

  test('a screen-state branch is NOT a modal detector (the tree refuted the first rule)', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.out);
        // signOutIfSignedIn's `final Finder shell = find.byType(AppShell); if
        // (shell.evaluate().isEmpty) return false;` — flagged by the first draft
        // of this guard, and honest code. If it is ever named in a failure, limb
        // A has been widened back to "any type at a branch".
        assert.doesNotMatch(r.out, /app_test\.dart:\d+ — `find\.byType\(AppShell\)`/);
        assert.match(r.out, /\d+ screen-state/);
      },
    );
  });

  test('a suite ASSERTING no dialog is present stays legal', () => {
    withTree(
      (root) => {
        edit(
          root,
          CAPTURE,
          ANCHOR_DECL,
          `${ANCHOR_DECL}\n    expect(find.byType(Dialog), findsNothing);`,
        );
      },
      (r) => assert.equal(r.status, 0, r.out),
    );
  });
});

describe('assert-modal-detection · the recorded outage', () => {
  test('the 2026-08-26 line, put back verbatim, is caught at its own line', () => {
    withTree(
      (root) => edit(root, CAPTURE, ANCHOR_ARG, '\n      find.byType(Dialog),\n'),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /store_screenshots_test\.dart:\d+ — `find\.byType\(Dialog\)` is the DETECTOR of a `waitFor`/);
        assert.match(r.out, /1 detector/);
      },
    );
  });

  test('the same defect one indirection away — a local bound to the byType finder', () => {
    withTree(
      (root) => edit(root, CAPTURE, ANCHOR_DECL, 'final Finder consentDecline = find.byType(Dialog);'),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /via the local `consentDecline`/);
      },
    );
  });

  test('the hand-rolled poll — a byType finder in an `if` condition', () => {
    withTree(
      (root) =>
        edit(
          root,
          CAPTURE,
          ANCHOR_DECL,
          `${ANCHOR_DECL}\n    if (find.byType(AlertDialog).evaluate().isNotEmpty) { await tester.pump(); }`,
        ),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /`find\.byType\(AlertDialog\)` is the DETECTOR of a `if`/);
      },
    );
  });

  test('dismissing an overlay by tapping its chassis type', () => {
    withTree(
      (root) =>
        edit(root, CAPTURE, ANCHOR_DECL, `${ANCHOR_DECL}\n    await tester.tap(find.byType(Dialog));`),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /is the target of a `tap`/);
        assert.match(r.out, /1 dismissal/);
      },
    );
  });

  test('an APP-OWNED gate class is caught too — the shape no list of framework types can name', () => {
    // `ConsentGate` was real: a showDialog route in features/consent, deleted
    // 2026-08-10. MODAL_CHASSIS could never have contained it, which is the
    // whole reason GATE_SHAPED exists.
    withTree(
      (root) => edit(root, CAPTURE, ANCHOR_ARG, '\n      find.byType(ConsentGate),\n'),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /`find\.byType\(ConsentGate\)` is the DETECTOR of a `waitFor`/);
      },
    );
  });

  test('a poll helper this guard has never heard of is derived from its signature', () => {
    // The rule is not a list of names. A suite that calls its poller anything at
    // all is covered on the day it is written, because a poller is recognised by
    // returning bool and taking a Finder.
    withTree(
      (root) =>
        edit(
          root,
          CAPTURE,
          ANCHOR_DECL,
          'Future<bool> settleUntilSeen(WidgetTester t, Finder f) async => false;\n' +
            `    ${ANCHOR_DECL}\n` +
            '    if (await settleUntilSeen(tester, find.byType(Dialog))) { await tester.pump(); }',
        ),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /DETECTOR of a `settleUntilSeen`/);
      },
    );
  });
});

describe('assert-modal-detection · prose is not a call site', () => {
  test('the defect quoted in a COMMENT does not fail the file that explains it', () => {
    // Every file that fixed this bug quotes `find.byType(Dialog)` in its header.
    // A guard that reads prose as code fails its own documentation.
    withTree(
      (root) =>
        edit(
          root,
          CAPTURE,
          ANCHOR_DECL,
          '// if (await waitFor(tester, find.byType(Dialog))) { }\n    ' + ANCHOR_DECL,
        ),
      (r) => assert.equal(r.status, 0, r.out),
    );
  });

  test('the defect quoted in a STRING LITERAL is not a call site either', () => {
    // first_run_destination_test.dart:188 carries exactly this text inside an
    // `expect` reason, writing the rule down.
    withTree(
      (root) =>
        edit(
          root,
          CAPTURE,
          ANCHOR_DECL,
          `${ANCHOR_DECL}\n    debugPrint('never detect it with find.byType(Dialog) inside an if');`,
        ),
      (r) => assert.equal(r.status, 0, r.out),
    );
  });
});

describe('assert-modal-detection · the exemption route', () => {
  const withReason =
    '      // modal-detection: allow - this lane asserts the retired route dialog is absent, it answers no gate\n';

  test('a written reason satisfies the guard honestly, and is PRINTED', () => {
    withTree(
      (root) => edit(root, CAPTURE, ANCHOR_ARG, `\n${withReason}      find.byType(Dialog),\n`),
      (r) => {
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /1 site\(s\) carry a written modal-detection exemption/);
        assert.match(r.out, /it answers no gate/);
      },
    );
  });

  test('a marker with a thin reason is refused — a switch is not a reason', () => {
    withTree(
      (root) =>
        edit(root, CAPTURE, ANCHOR_ARG, '\n      // modal-detection: allow - legacy\n      find.byType(Dialog),\n'),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /character\(s\) of reason .* and 30 is the floor/);
        // …and it must NOT also be reported as stale. It excuses a real site;
        // the fix is to finish the sentence, not to delete the line.
        // 🔴 `a modal-detection exemption`, not `an exemption`. The guard's HELP
        // FOOTER ends with "An exemption that excuses nothing fails here too",
        // so the loose regex matched the guidance on every failing run — which
        // made this assertion, and the stale-exemption test below, pass without
        // reading a single finding. Caught by this case failing when the guard
        // was right; anchor on the finding's own wording.
        assert.doesNotMatch(r.out, /a modal-detection exemption that excuses nothing/);
      },
    );
  });

  test('an exemption left behind after the defect is fixed FAILS', () => {
    // A waiver over nothing is a live re-entry permit: the next byType written
    // on that line is waived on sight without anyone deciding to.
    withTree(
      (root) => edit(root, CAPTURE, ANCHOR_ARG, `\n${withReason}      consentDecline,\n`),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /a modal-detection exemption that excuses nothing/);
      },
    );
  });
});

describe('assert-modal-detection · coverage self-checks', () => {
  test('no suite directory at all is COVERAGE LOST, never ok', () => {
    // 🔴 BOTH ROOTS, and that is not tidiness. When this harness grew its second
    // root the single-root version of this case went green over a tree that
    // still held 67 brick sites — the mutation stopped being total the moment
    // the domain grew, which is the same "the scan lost a root and nobody
    // noticed" failure the guard itself now refuses.
    withTree(
      (root) => {
        for (const rootRel of [SUBLY, BRICK]) {
          for (const d of ['test', 'integration_test']) {
            rmSync(join(root, rootRel, d), { recursive: true, force: true });
          }
        }
        rmSync(join(root, BRICK_MANIFEST), { force: true });
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /COVERAGE LOST/);
        assert.match(r.out, /NOT ONE carries a \.dart file/);
      },
    );
  });

  test('suites present but not one `find.byType(` is COVERAGE LOST', () => {
    // The shape where the matcher, or the comment/literal reduction it runs on,
    // has stopped matching. Indistinguishable from a clean tree unless asked.
    withTree(
      (root) => {
        const walk = (dir) => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.dart')) {
              // `byType(` alone, not `find.byType(`. The guard's matcher
              // tolerates whitespace and a line break between `find`, `.` and
              // `byType` — so the literal replacement left ONE site standing and
              // this case tripped the classifier's self-check instead of the
              // matcher's. That is the guard being more careful than a grep, and
              // the mutation has to be as total as the scan is.
              writeFileSync(p, readFileSync(p, 'utf8').split('byType(').join('byKey('));
            }
          }
        };
        for (const rootRel of [SUBLY, BRICK]) {
          for (const d of ['test', 'integration_test']) {
            const abs = join(root, rootRel, d);
            if (existsSync(abs)) walk(abs);
          }
        }
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /COVERAGE LOST/);
        assert.match(r.out, /NOT ONE `find\.byType\(` was found/);
      },
    );
  });

  test('a pubspec with no workspace block is COVERAGE LOST, not an empty domain', () => {
    withTree(
      (root) => writeFileSync(join(root, 'pubspec.yaml'), 'name: nikatru_workspace\npublish_to: none\n'),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /COVERAGE LOST/);
        assert.match(r.out, /no readable `workspace:` block/);
      },
    );
  });

  test('an app root that lists no suite files cannot be quietly skipped', () => {
    // The single-root tree with its suites emptied rather than removed: the
    // directories exist, so a walk that "found the root" is satisfied, and the
    // file list is still zero.
    withTree(
      (root) => {
        for (const d of ['test', 'integration_test']) {
          rmSync(join(root, SUBLY, d), { recursive: true, force: true });
          mkdirSync(join(root, SUBLY, d), { recursive: true });
        }
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /COVERAGE LOST/);
      },
    );
  });
});

describe('assert-modal-detection · the guard names what right looks like', () => {
  test('the failure points at the corrected helpers, not only at the rule', () => {
    withTree(
      (root) => edit(root, CAPTURE, ANCHOR_ARG, '\n      find.byType(Dialog),\n'),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /answerConsentIfPrompted/);
        assert.match(r.out, /first_run_destination_test\.dart/);
        assert.match(r.out, /2026-07-27, 2026-08-08 and 2026-08-26/);
        assert.match(r.out, /modal-detection: allow/);
      },
    );
  });

  test('app_test.dart is readable by this guard at all (the file that states the rule)', () => {
    // A guard that cannot read the suite it cites is citing prose. This asserts
    // the walk actually reaches it, so the two cases above are about the tree
    // rather than about a path that resolves to nothing.
    withTree(
      (root) => edit(root, APP_TEST, 'void main() {', 'void main() {\n  // reached'),
      (r) => assert.equal(r.status, 0, r.out),
    );
  });
});

describe('assert-modal-detection · the second root cannot leave in silence', () => {
  // 🔴 THIS IS THE BLOCK THE GUARD SHIPPED WITHOUT, AND THE ONE THE HEADER'S OWN
  // DOCTRINE DEMANDED LOUDEST. `roots.push(BRICK)` was gated on a bare
  // `existsSync`, so the brick leaving was indistinguishable from the brick
  // never having been there. Measured 2026-08-26: brick present -> 329 sites /
  // 72 files / 2 roots, exit 0; the brick's app directory renamed and nothing
  // else touched -> 263 / 65 / 1, exit 0, "ok". 66 sites and 7 files went green
  // by disappearing, past four COVERAGE LOST limbs that each still had a large
  // non-empty set in front of them.
  test('the brick is DECLARED and its app tree is gone — COVERAGE LOST, not a smaller job', () => {
    withTree(
      (root) => rmSync(join(root, BRICK), { recursive: true, force: true }),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /COVERAGE LOST/);
        assert.match(r.out, /DECLARES a brick/);
        // …and it must NOT have printed a happy count first.
        assert.doesNotMatch(r.out, /assert-modal-detection: ok/);
      },
    );
  });

  test('a tree with no brick package at all is legitimate and stays green', () => {
    // The opposite direction, and it is load-bearing: this very harness built
    // one-root trees for its whole life, and a guard that refused them could
    // not be tested from a scratch copy. Absence of the PACKAGE is a partial
    // tree; absence of the app dir WITH the package present is a lost root.
    withTree(() => {}, (r) => {
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /in 1 root\(s\)/);
    }, { brick: false, brickManifest: false });
  });

  test('a derived root that is present but EMPTY cannot be quietly skipped', () => {
    withTree(
      (root) => {
        rmSync(join(root, BRICK, 'test'), { recursive: true, force: true });
        mkdirSync(join(root, BRICK, 'test'), { recursive: true });
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /COVERAGE LOST/);
        assert.match(r.out, /carry NO \.dart file/);
        assert.match(r.out, /__brick__/);
      },
    );
  });

  test('a defect stamped into the BRICK is caught — the root with no test runner', () => {
    // The brick has no Dart suite runner of its own, so a static read is the
    // only reading it ever gets. If the two-root walk is real, a defect written
    // there fails; if the brick is being walked but not classified, this is the
    // case that says so.
    withTree(
      (root) =>
        writeFileSync(
          join(root, BRICK, 'test', 'stamped_consent_test.dart'),
          'void main() {\n' +
            "  testWidgets('stamped', (WidgetTester tester) async {\n" +
            '    if (find.byType(Dialog).evaluate().isNotEmpty) {\n' +
            "      await tester.tap(find.text('No thanks'));\n" +
            '    }\n  });\n}\n',
        ),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /stamped_consent_test\.dart:\d+ — `find\.byType\(Dialog\)` is the DETECTOR of a `if`/);
      },
    );
  });
});

describe('assert-modal-detection · the indirections that used to pass', () => {
  const NEW_SUITE = `${SUBLY}/integration_test/zz_probe_test.dart`;
  const probe = (root, body) => writeFileSync(join(root, NEW_SUITE), body);

  test('a bool local — `final bool shown = find.byType(Gate)…isNotEmpty; if (shown)`', () => {
    // Measured 2026-08-26: classified `bare`, EXIT 0. The finder has no
    // enclosing call, which is TRUE and was treated as the end of the question.
    withTree(
      (root) =>
        probe(
          root,
          'void main() {\n' +
            "  testWidgets('x', (WidgetTester tester) async {\n" +
            '    final bool shown = find.byType(Dialog).evaluate().isNotEmpty;\n' +
            "    if (shown) {\n      await tester.tap(find.text('No thanks'));\n    }\n  });\n}\n",
        ),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /`find\.byType\(Dialog\)` is the DETECTOR of a `if` \(via the local `shown`\)/);
      },
    );
  });

  test('an INFERRED local — `final consentGate = find.byType(Gate);`', () => {
    // Measured 2026-08-26: also `bare`, also EXIT 0. The old alias pattern
    // hard-required the literal token `Finder`.
    withTree(
      (root) =>
        probe(
          root,
          'void main() {\n' +
            "  testWidgets('x', (WidgetTester tester) async {\n" +
            '    final consentGate = find.byType(AlertDialog);\n' +
            '    if (consentGate.evaluate().isNotEmpty) {\n      await tester.pump();\n    }\n  });\n}\n',
        ),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /`find\.byType\(AlertDialog\)` is the DETECTOR of a `if` \(via the local `consentGate`\)/);
      },
    );
  });

  test('the HONEST twin of that shape stays legal — a banner read into an expect', () => {
    // chassis_properties_test.dart:2898 is `final bool shown =
    // find.byType(MaterialBanner).evaluate().isNotEmpty;` followed by an
    // `expect`. A banner does not cover the app and an expect is not a branch.
    // If widening the alias limb ever reddens this, the widening was wrong.
    withTree(
      (root) =>
        probe(
          root,
          'void main() {\n' +
            "  testWidgets('x', (WidgetTester tester) async {\n" +
            '    final bool shown = find.byType(MaterialBanner).evaluate().isNotEmpty;\n' +
            '    expect(shown, true);\n  });\n}\n',
        ),
      (r) => assert.equal(r.status, 0, r.out),
    );
  });

  test('a suite that IMPORTS its poll helper instead of declaring it', () => {
    // 🔴 THE SHAPE THE GUARD'S OWN RECOMMENDATION CREATES. The header calls one
    // shared `answerFirstRunConsent(tester)` in `integration_test/consent.dart`
    // "the better answer"; `pollers` was derived PER FILE, so on the day that
    // helper lands, `waitFor` is declared in neither suite and limb A stops
    // seeing the exact shape of all three outages. Measured 2026-08-26 before
    // the corpus union: `inspection`, "0 detector", EXIT 0.
    withTree(
      (root) => {
        writeFileSync(
          join(root, SUBLY, 'integration_test', 'zz_shared_consent.dart'),
          "import 'package:flutter_test/flutter_test.dart';\n\n" +
            'Future<bool> pumpUntilFound(WidgetTester tester, Finder f) async => false;\n',
        );
        probe(
          root,
          "import 'zz_shared_consent.dart';\n\nvoid main() {\n" +
            "  testWidgets('x', (WidgetTester tester) async {\n" +
            '    if (await pumpUntilFound(tester, find.byType(Dialog))) {\n' +
            "      await tester.tap(find.text('No thanks'));\n    }\n  });\n}\n",
        );
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /zz_probe_test\.dart:\d+ — `find\.byType\(Dialog\)` is the DETECTOR of a `pumpUntilFound`/);
      },
    );
  });
});

describe('assert-modal-detection · the failure text is advice somebody can follow', () => {
  test('the footer does NOT tell the reader to exempt an assertion', () => {
    // 🔴 IT DID, AND THE ADVICE FAILED THE BUILD. The footer named "a suite
    // ASSERTING a dialog" as the example to exempt — but an assertion is never
    // flagged, so the marker matched nothing and the stale-exemption limb then
    // failed with "an exemption that excuses nothing. Delete it." The one
    // example the advice named was the one case the advice was wrong for.
    withTree(
      (root) => edit(root, CAPTURE, ANCHOR_ARG, '\n      find.byType(Dialog),\n'),
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /modal-detection: allow/, 'the exemption route is no longer explained at all');
        assert.match(r.out, /need NO marker/);
        assert.doesNotMatch(
          r.out,
          /a suite ASSERTING a dialog, or testing a screen that owns/,
          'the footer is telling the reader to write a marker over an assertion again',
        );
      },
    );
  });

  test('following that advice literally still fails, which is why it was removed', () => {
    // The behaviour is CORRECT and is not being changed: a marker over a site
    // this guard does not flag is a live re-entry permit. What changed is that
    // the guard no longer recommends writing one.
    withTree(
      (root) => {
        const p = join(root, `${SUBLY}/test/first_run_destination_test.dart`);
        const lines = readFileSync(p, 'utf8').split('\n');
        const at = lines.findIndex((l) => l.includes('find.byType(Dialog),'));
        assert.ok(at > 0, 'the assertion this case is written against has moved');
        lines.splice(at, 0, '          // modal-detection: allow - this lane asserts the retired dialog is absent');
        writeFileSync(p, lines.join('\n'));
      },
      (r) => {
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /a modal-detection exemption that excuses nothing/);
      },
    );
  });
});

describe('assert-modal-detection · the exemption marker on a CRLF checkout', () => {
  test('a marker is still read when the file uses CRLF line endings', () => {
    // ⚠️ NOT LIVE — `.gitattributes` pins `* text=auto eol=lf`, so no checkout in
    // this project produces the file this case writes. It is here because the
    // pattern has no `m` flag and is applied to lines from `split('\n')`: every
    // line then ends in a `\r` that `.` cannot match and a non-multiline `$`
    // will not skip, and BOTH readers of the pattern go silent at once — the
    // marker stops excusing its site (loudly) and the stale-exemption limb stops
    // finding stale markers at all (silently). One `\r?` makes the guard's
    // behaviour unconditional rather than contingent on a file it never reads.
    const reason = '      // modal-detection: allow - this lane pins the retired route dialog on purpose\n';
    withTree(
      (root) => {
        edit(root, CAPTURE, ANCHOR_ARG, `\n${reason}      find.byType(Dialog),\n`);
        const p = join(root, CAPTURE);
        writeFileSync(p, readFileSync(p, 'utf8').split('\n').join('\r\n'));
      },
      (r) => {
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /1 site\(s\) carry a written modal-detection exemption/);
        assert.match(r.out, /pins the retired route dialog on purpose/);
      },
    );
  });
});
