// ─────────────────────────────────────────────────────────────────────────────
// sworn-store-files.test.mjs — the negative cases for assert-sworn-store-files.mjs.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, never a hand-built fixture.
// This repo has shipped a guard whose six fixture tests all passed against a
// broken version (`assert-seams-wired.mjs`, whose caller check matched the
// function's own declaration): a fixture you write encodes the same
// misunderstanding as the guard you write. The copy below carries the real
// channel register, the real apps/subly declarations and the real brick
// templates, so a mutation here is the mutation a person would actually make —
// and the WHOLESALE case is the actual stamped template, extracted from the
// re-stamp patch rather than typed.
//
// 🔬 THE HOLE EACH CASE IS ABOUT WAS MEASURED FIRST. Before this guard existed,
// all twenty-four mutations below were run against assert-play-declarations.mjs
// with the exit code captured on its own line. The eleven marked MEASURED HOLE
// were exit 0 there. The rest are that guard's job and are asserted here only
// where this one deliberately overlaps (it mostly does not).
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-sworn-store-files.mjs');

const BRICK_STORE = 'tooling/bricks/app/__brick__/apps/{{app_id}}/store/android-play';
const SUBLY_STORE = 'apps/subly/store/android-play';
/** The FOURTH sworn declaration (2026-08-31, [G-49]) — the Apple privacy
 *  manifest audit. It is the first one that is not a Play form and the first on
 *  a second channel, which is why the tree below copies a whole second store
 *  directory rather than another file. */
const BRICK_IOS = 'tooling/bricks/app/__brick__/apps/{{app_id}}/store/ios-appstore';
const SUBLY_IOS = 'apps/subly/store/ios-appstore';
const PM = `${SUBLY_IOS}/privacy-manifest.json`;
const PM_TMPL = `${BRICK_IOS}/privacy-manifest.json`;
const DS = `${SUBLY_STORE}/data-safety.json`;
const CR = `${SUBLY_STORE}/content-rating.json`;
/** The third sworn declaration (2026-08-09) — Play "App content → Ads". It is
 *  in the derived set below for the same reason as the other two: it cites code,
 *  so limb 5 resolves its paths and the fixture has to carry them. */
const ADS = `${SUBLY_STORE}/ads-declaration.json`;
const SETTINGS = 'apps/subly/lib/features/settings/settings_screen.dart';
const REGISTER = 'tooling/channel-register.json';
/** Limb 9's subject. `put(SUBLY_STORE)` already copies it (the whole channel
 *  directory goes in), so it needs no separate seed — but the files IT cites do,
 *  which is why `citedPaths()` below reads it too. */
const README = `${SUBLY_STORE}/README.md`;

/**
 * The paths limb 5 will resolve, DERIVED from the real declarations with the
 * guard's own matcher rather than listed here.
 *
 * 🔬 THE HAND-LISTED VERSION WAS WRITTEN FIRST AND WAS WRONG WITHIN A MINUTE:
 * it named `apps/subly/lib` and missed `apps/subly/pubspec.yaml`, so the
 * BASELINE case failed and read exactly like a broken guard. Copying whole
 * trees instead fixed the correctness and made the suite time out — 21 cases ×
 * a ~100 MB copy. Deriving the set gives 43 files, and it cannot go stale:
 * cite a new file in the declaration and the fixture copies it.
 *
 * 🔴 IT CAN GO STALE IN ONE WAY, AND IT IS THE ALTERNATION. This must stay
 * identical to `PATH_RE` in assert-sworn-store-files.mjs. A citation under a
 * top-level directory only one of the two lists never lands in the fixture
 * tree, so the copied file is absent and the guard under test COVERAGE-LOSTs
 * on a subject the real repository has. `catalog` was added to both together
 * when the app catalogue became `catalog/apps.json`.
 */
const CITED_RE = /(?:apps|catalog|packages|services|tooling|sites)\/[A-Za-z0-9_.\/{}-]*\.(?:dart|json|jsonc|yaml|yml|ts|tsx|mjs|html|txt|xml|sql|arb|md)/g;
function citedPaths() {
  const set = new Set();
  // …and the channel README, which limb 9 resolves. Derived, not listed: the
  // README's derivation map cites 11 repository paths — app_config, apps.json,
  // the register, the brick's brick.yaml, the data inventory and SIX .mjs
  // scripts (assert-store-metadata, assert-play-declarations,
  // assert-ads-declarations, submit-play, render-play-graphics,
  // capture-play-screenshots) — and hand-listing them is the mistake this
  // function's own header records making.
  for (const rel of [DS, CR, ADS, README, PM, `${SUBLY_IOS}/README.md`]) {
    for (const m of readFileSync(join(REPO, rel), 'utf8').matchAll(CITED_RE)) set.add(m[0]);
  }
  return [...set];
}

/** How many sworn declarations the REGISTER declares — the same derivation the
 *  guard makes, so the baseline assertion below cannot go stale the next time a
 *  console artefact acquires a repo representation. It was hard-coded at 2 and
 *  went stale within one increment, which is the failure mode this file is
 *  otherwise entirely about. */
function swornCount() {
  const reg = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8'));
  const perChannel = reg.storeMetadataContract?.perChannel ?? {};
  let n = 0;
  for (const [channel, contract] of Object.entries(perChannel)) {
    if (channel.startsWith('_')) continue;
    for (const f of contract?.additionalFiles ?? []) if (f.endsWith('.json')) n++;
  }
  // …and the one `realTree()` seeds when the register does not carry it yet, so
  // the count describes the fixture the cases actually run against.
  if (!(perChannel['ios-appstore']?.additionalFiles ?? []).includes('privacy-manifest.json')) n++;
  return n;
}

/** A real-tree copy carrying exactly what the guard reads. */
function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-sworn-'));
  const put = (rel) => {
    const from = join(REPO, rel);
    if (!existsSync(from)) return;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(from, join(root, rel), { recursive: true });
  };
  put('pubspec.yaml');
  put(REGISTER);
  put(SUBLY_STORE);
  put(BRICK_STORE);
  put(SUBLY_IOS);
  put(BRICK_IOS);
  for (const rel of citedPaths()) put(rel);
  // ⚠️ THE REGISTER ENTRY THAT MAKES privacy-manifest.json SWORN, seeded here
  // and ONLY if it is absent. The sworn set is DERIVED from
  // storeMetadataContract, so without the entry every case in this file dies on
  // "this guard specs ios-appstore/privacy-manifest.json, which the register no
  // longer declares as sworn" — one true failure wearing 180 confusing masks.
  // Seeding it makes each case below a statement about the SPEC. It masks
  // nothing: the very next test asserts the REAL register carries the entry, so
  // if it is ever dropped exactly one case goes red and it names the file.
  const reg = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  const ios = reg.storeMetadataContract.perChannel['ios-appstore'].additionalFiles;
  if (!ios.includes('privacy-manifest.json')) ios.push('privacy-manifest.json');
  writeFileSync(join(root, REGISTER), `${JSON.stringify(reg, null, 2)}\n`);
  // The UI anchors' own inputs (P2.7): limb 6's copy half reads the .arb,
  // which the declarations do not CITE — the derived set above cannot know
  // about it, so it is seeded explicitly, beside the reduction library the
  // guard imports for the code half.
  put('apps/subly/lib/l10n/app_en.arb');
  // Limb 8's inputs, seeded for the same reason and worth stating precisely:
  // `buildPosture._why` cites these three by BASENAME and line
  // (`providers.dart:540-545`), and `CITED_RE` matches repo-relative paths only,
  // so the derived set above genuinely cannot reach them. Leaving them out made
  // every case in this file fail with "only 1 of 4 line citation(s) were
  // evaluated" — the guard reporting, correctly, that the harness had starved it.
  for (const rel of [
    'apps/subly/lib/state/providers.dart',
    'apps/subly/lib/state/analytics_providers.dart',
    'apps/subly/lib/app.dart',
  ]) {
    put(rel);
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

const readDoc = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const writeDoc = (root, rel, j) => writeFileSync(join(root, rel), `${JSON.stringify(j, null, 2)}\n`);
const editDoc = (root, rel, fn) => {
  const j = readDoc(root, rel);
  fn(j);
  writeDoc(root, rel, j);
};
const editText = (root, rel, fn) => writeFileSync(join(root, rel), fn(readFileSync(join(root, rel), 'utf8')));

describe('the real tree', () => {
  test('passes, and says how much it actually read', () => {
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, new RegExp(`${swornCount()} sworn declaration\\(s\\) still answered`));
        assert.match(r.stdout, /cited path\(s\) resolve/);
        assert.match(r.stdout, /brick template\(s\) still blank/);
        // Limb 9 ran and says so. Without this the baseline passes identically
        // whether the README limb read 32 paths or was never reached.
        assert.match(r.stdout, /path\(s\) in [1-9]\d* channel README\(s\) resolve/);
      },
    );
  });

  test('the copy the other tests mutate really is the answered one', () => {
    // Without this, every "regression caught" below could be an artefact of a
    // stand-in rather than evidence about the file that ships to Google.
    withTree(
      () => {},
      () => {
        const ds = JSON.parse(readFileSync(join(REPO, DS), 'utf8'));
        assert.ok(ds.answers.length > 30, 'data-safety must really carry its answers');
        assert.equal(typeof ds.dataSecurity.encryptedInTransit.answer, 'boolean');
        assert.ok(readFileSync(join(REPO, SETTINGS), 'utf8').includes('Export data (CSV)'));
      },
    );
  });
});

describe('the FOURTH declaration — the Apple privacy manifest audit [G-49]', () => {
  test('🔴 THE REAL REGISTER DECLARES IT SWORN — the one thing `realTree()` seeds', () => {
    // The self-check that stops the seeding above from masking anything. Every
    // other case in this block is a statement about the SPEC; this one is the
    // statement about REALITY, and if the register entry is dropped this is the
    // single case that goes red, by name.
    const reg = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8'));
    const ios = reg.storeMetadataContract?.perChannel?.['ios-appstore']?.additionalFiles ?? [];
    assert.ok(
      ios.includes('privacy-manifest.json'),
      'tooling/channel-register.json -> storeMetadataContract.perChannel["ios-appstore"].additionalFiles ' +
        'does not list privacy-manifest.json. The sworn set is DERIVED from that contract, so until the ' +
        'entry lands the guard specs a file nothing requires to exist and exits COVERAGE LOST on the real ' +
        'tree — the floors below are real, and nothing is asserting them where it counts.',
    );
  });

  test('the copy the cases mutate really is the answered audit', () => {
    // Same reason as the data-safety twin above: without this, every "caught"
    // below could be an artefact of a stand-in rather than evidence about the
    // file both PrivacyInfo.xcprivacy are generated from.
    const pm = JSON.parse(readFileSync(join(REPO, PM), 'utf8'));
    assert.ok(pm.binaryInventory.ios.length > 10, 'the audit must really carry its binary inventory');
    assert.ok(pm.collectedDataTypes.rows.length > 5, 'and its collected-data rows');
    assert.equal(typeof pm.tracking.NSPrivacyTracking, 'boolean');
  });

  test('🔴 PM1 — REPLACING THE AUDIT WITH THE BRICK TEMPLATE FAILS', () => {
    withTree(
      (root) => cpSync(join(root, PM_TMPL), join(root, PM)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /privacy-manifest\.json is \d+ lines; the floor is/);
        assert.match(r.stderr, /sources\.cited` as an ARRAY/);
        assert.match(r.stderr, /answers `null` for \d+ field\(s\)/);
      },
    );
  });

  test('🔴 PM3c — THE ROWS THAT ARE NOT PLUGINS DELETED, WHICH BOTH GUARDS MISSED', () => {
    // The finding the mutation sweep paid for. assert-apple-privacy-manifest.mjs
    // holds the inventory EQUAL to `.flutter-plugins-dependencies`, so the app
    // target, the engine framework and App.framework are outside its subject
    // set. Deleting exactly those and nothing else was exit 0 on BOTH guards
    // until `requiredRows` existed — the audit collapsed to "only plugins
    // matter", with App.framework, the binary that can carry no manifest at all,
    // simply absent from the document.
    withTree(
      (root) =>
        editDoc(root, PM, (j) => {
          const structural = (row) => /Runner \(the app target\)|Flutter\.framework|FlutterMacOS\.framework|App\.framework/.test(row.binary);
          for (const p of ['ios', 'macos']) j.binaryInventory[p] = j.binaryInventory[p].filter((row) => !structural(row));
        }),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /NOT ONE with `manifest` === "this-file"/);
        assert.match(r.stderr, /NOT ONE with `binary` containing "App\.framework"/);
      },
    );
  });

  test('🔴 PM16 — `manifest` dropped from every inventory row, so no row says what was READ', () => {
    withTree(
      (root) =>
        editDoc(root, PM, (j) => {
          for (const p of ['ios', 'macos']) for (const row of j.binaryInventory[p]) delete row.manifest;
        }),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /`binaryInventory\.ios\[0\]` has no `manifest`/);
      },
    );
  });

  test('🔴 PM5 — `_readme` collapsed to the brick template\'s own prose', () => {
    // Not a truncation: the answered file keeps a perfectly well-formed
    // `_readme`, the one the TEMPLATE ships. It reads like documentation and
    // says nothing about this app.
    withTree(
      (root) => editDoc(root, PM, (j) => { j._readme = readDoc(root, PM_TMPL)._readme; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /line `_readme`; the floor is 30/);
      },
    );
  });

  test('🔴 PM6b — `tracking.basis` deleted while the two Apple fields stay correct', () => {
    // The sibling renders the plist from NSPrivacyTracking and NSPrivacyTracking-
    // Domains, so nulling either is exit 1 there and is NOT repeated here.
    // Deleting the `basis` — the only record of why the PAIR is what it is, and
    // Apple's rule is on the pair — is exit 0 there.
    withTree(
      (root) => editDoc(root, PM, (j) => { delete j.tracking.basis; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`tracking` carries 2 key\(s\); at least 3 are required/);
      },
    );
  });

  test('🔴 PM7b — `accessedApiDetermination._why` deleted, both empty arrays intact', () => {
    // Both platform arrays are EMPTY today and that is the audit's finding, not
    // its default — `_why` is the whole difference between the two. Deleting the
    // block outright is exit 1 on the sibling (it renders from it); deleting
    // only the reasoning is exit 0.
    withTree(
      (root) => editDoc(root, PM, (j) => { delete j.accessedApiDetermination._why; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`accessedApiDetermination` carries 2 key\(s\)/);
      },
    );
  });

  test('🔴 PM20 — `sdkListFindings` deleted', () => {
    withTree(
      (root) => editDoc(root, PM, (j) => { delete j.sdkListFindings; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`sdkListFindings` carries 0 key\(s\)/);
      },
    );
  });

  test('🔴 PM11 — `ffiFindings` deleted, the record that the FFI question was asked', () => {
    withTree(
      (root) => editDoc(root, PM, (j) => { delete j.ffiFindings; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`ffiFindings` carries 0 key\(s\)/);
      },
    );
  });

  test('🔴 PM8 — every binary `basis` replaced with "stamped", caught by the AGGREGATE', () => {
    // The per-row floor here is 7 and "stamped" is 7 characters, so the per-row
    // limb passes it by one character — deliberately, because the shortest
    // CORRECT basis in this document is also 7 ("As iOS."). 27 × 7 = 189 against
    // the live total is what makes the regression visible.
    //
    // ⚠️ THE NUMBERS MOVE WHEN THE INVENTORY DOES, AND THAT IS THE POINT rather
    // than a maintenance tax: this assertion names the row COUNT, so adding a
    // binary without noticing lands here. It went 25 → 27 when
    // `flutter_inappwebview_{ios,macos}` were linked in by cloudflare_turnstile.
    // Widening the regex to `\d+` would buy quiet and lose exactly the signal.
    withTree(
      (root) =>
        editDoc(root, PM, (j) => {
          for (const p of ['ios', 'macos']) for (const row of j.binaryInventory[p]) row.basis = 'stamped';
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /carries 189 character\(s\) of `basis` across 27 row\(s\); the floor is 2000/);
      },
    );
  });

  test('🔴 PM10 — `cannotSee.items` emptied, so a green guard reads as a complete audit', () => {
    withTree(
      (root) => editDoc(root, PM, (j) => { j.cannotSee.items = []; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`cannotSee\.items` is EMPTY/);
      },
    );
  });

  test('🔴 PM12b — every row loses `linkedBasis`, the one field Play never asked for', () => {
    // `type` and `fromPlayRow` are the sibling's — dropping either is exit 1
    // there, through the Data-safety cross-check, and neither is repeated here.
    // Apple's "linked to the user's identity" has no Play counterpart at all, so
    // no cross-check can reach it: dropping it from every row is exit 0 there.
    withTree(
      (root) => editDoc(root, PM, (j) => { for (const row of j.collectedDataTypes.rows) delete row.linkedBasis; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`collectedDataTypes\.rows\[0\]` has no `linkedBasis`/);
      },
    );
  });

  test('🔴 PM13 — an open question hollowed out in place', () => {
    withTree(
      (root) => editDoc(root, PM, (j) => { delete j.unresolved[0].decision; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`unresolved\[0\]` has no `decision`/);
      },
    );
  });

  test('PM2 — emptying `unresolved` is EXIT 0, and that is the decision, not a gap', () => {
    // Asserted in the PASSING direction on purpose. `unresolved` legitimately
    // empties as questions settle — android-play/data-safety.json carries
    // `unresolved: []` and `resolved: [2]` today, having started the other way
    // round — so a floor there would go red on a correct improvement. Written
    // down as a test rather than a comment so that ADDING that floor breaks
    // something and has to be argued for.
    withTree(
      (root) => editDoc(root, PM, (j) => { j.unresolved = []; }),
      (r) => {
        assert.equal(r.status, 0, r.stderr);
      },
    );
  });

  test('🔴 PM14/PM15 — the Apple template must STAY a template', () => {
    withTree(
      (root) => cpSync(join(root, PM), join(root, PM_TMPL)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /ios-appstore[\\/]privacy-manifest\.json carries NO null answers/);
      },
    );
    withTree(
      (root) => editDoc(root, PM_TMPL, (j) => { j.unresolved = []; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /empty `unresolved` list/);
      },
    );
  });

  test('the brick template carries NO answer from any other app', () => {
    // Limb 7 asks whether the template still has nulls. This asks the inverse
    // question a floor cannot: that nobody pasted app #1's measurements in. The
    // constants are the tell — a real Apple category or reason code in a
    // template is, by definition, an answer about somebody else's binaries.
    const raw = readFileSync(join(REPO, PM_TMPL), 'utf8');
    for (const tell of ['NSPrivacyAccessedAPICategory', 'NSPrivacyCollectedDataType', 'Flutter.framework']) {
      assert.ok(!raw.includes(tell), `the brick template names ${tell} — that is an ANSWER, not a question`);
    }
    const j = JSON.parse(raw);
    assert.ok(j._readme.length >= 20, 'the template must still instruct the person stamping app #2');
    assert.ok(j.unresolved.length >= 5, 'and still name the work they owe');
    assert.ok(j._structuralFacts.facts.length >= 4, 'and still carry the facts true of every app in the factory');
  });
});

describe('the wholesale regression — the stamp written over the answers', () => {
  test('🔴 REPLACING data-safety.json WITH THE BRICK TEMPLATE FAILS', () => {
    withTree(
      (root) => cpSync(join(root, BRICK_STORE, 'data-safety.json'), join(root, DS)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /is \d+ lines; the floor is/);
        assert.match(r.stderr, /sources\.cited` as an ARRAY/);
        assert.match(r.stderr, /answers `null` for \d+ field\(s\)/);
      },
    );
  });

  test('🔴 AND content-rating.json THE SAME WAY', () => {
    withTree(
      (root) => cpSync(join(root, BRICK_STORE, 'content-rating.json'), join(root, CR)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /content-rating\.json is \d+ lines/);
      },
    );
  });
});

describe('the PARTIAL regressions — every one measured at exit 0 on assert-play-declarations', () => {
  test('🔴 MEASURED HOLE M1 — nulling dataSecurity.encryptedInTransit.answer', () => {
    withTree(
      (root) => editDoc(root, DS, (j) => { j.dataSecurity.encryptedInTransit.answer = null; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /encryptedInTransit\.answer` is null and must be a boolean/);
      },
    );
  });

  test('🔴 MEASURED HOLE M17 — deleting `resolved`', () => {
    withTree(
      (root) => editDoc(root, DS, (j) => { delete j.resolved; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`resolved` is missing/);
      },
    );
  });

  test('🔴 MEASURED HOLE M25 — emptying `resolved` rather than deleting it', () => {
    withTree(
      (root) => editDoc(root, DS, (j) => { j.resolved = []; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`resolved` is EMPTY/);
      },
    );
  });

  test('a `resolved` entry stripped of its write-up fails', () => {
    withTree(
      (root) => editDoc(root, DS, (j) => { delete j.resolved[0].settledBy; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`resolved\[0\]` has no `settledBy`/);
      },
    );
  });

  test('🔴 MEASURED HOLE M20 — every `basis` replaced with a placeholder word', () => {
    withTree(
      (root) => editDoc(root, DS, (j) => { for (const a of j.answers) a.basis = 'stamped'; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /is 7 character\(s\)/);
      },
    );
  });

  test('🔴 MEASURED HOLE M26 — `_readme` truncated to five lines', () => {
    withTree(
      (root) => editDoc(root, DS, (j) => { j._readme = j._readme.slice(0, 5); }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /5-line `_readme`/);
      },
    );
  });

  test('🔴 MEASURED HOLE M10 — content-rating loses its rating authorities', () => {
    withTree(
      (root) => editDoc(root, CR, (j) => { delete j.authorities; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`authorities\.list` is missing/);
      },
    );
  });

  test('🔴 MEASURED HOLE M11 — content-rating loses its named human obligations', () => {
    withTree(
      (root) => editDoc(root, CR, (j) => { delete j.humanOwned; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /`humanOwned` carries 0 key\(s\)/);
      },
    );
  });

  test('every source citation deleted fails on the COUNT, which play-declarations does not check', () => {
    withTree(
      (root) => editDoc(root, DS, (j) => { j.sources = { allowedHosts: j.sources.allowedHosts }; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /carries 0 source citation\(s\)/);
      },
    );
  });
});

describe('limb 5 — a declaration may not cite code that is gone', () => {
  test('🔴 renaming a cited file fails', () => {
    withTree(
      (root) => rmSync(join(root, SETTINGS)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /cites apps\/subly\/lib\/features\/settings\/settings_screen\.dart, which does not exist/);
      },
    );
  });
});

describe('limb 9 — the channel README may not cite code that is gone either', () => {
  test('🔴 THE TEN-INSTANCE DEFECT, REPLAYED: the pre-#216 app_config path fails', () => {
    // This is not a hypothetical mutation — it is the tree as it stood until
    // this increment. #216 moved `lib/core/config/app_config.dart` to
    // `lib/core/app_config.dart`; limb 5 repaired the three citations inside the
    // declarations, and TEN more sat in the five channel READMEs (two per
    // channel: the privacy-policy-url and support-url rows of every derivation
    // map) for the simple reason that a `.md` was never in this guard's subject
    // set. One re-introduced instance is enough to go red, which is the property
    // that matters: the fix cannot be half-applied in silence.
    withTree(
      (root) =>
        editText(root, README, (s) =>
          s.replace('apps/subly/lib/core/app_config.dart', 'apps/subly/lib/core/config/app_config.dart'),
        ),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(
          r.stderr,
          /README\.md:\d+ cites apps\/subly\/lib\/core\/config\/app_config\.dart, which does not exist/,
        );
      },
    );
  });

  test('deleting the READMEs is COVERAGE LOST, not a pass', () => {
    // The failure this whole file is about, in its limb-9 shape: with no README
    // the per-README loop iterates zero times and every path assertion is
    // vacuously satisfied. `assert-store-metadata.mjs` owns the file's PRESENCE;
    // this asserts that when it is gone, THIS guard says it stopped scanning
    // rather than printing ok over an empty set.
    //
    // ⚠️ IT IS BOTH READMEs SINCE [G-49], and that is a real change in what the
    // case can claim. The fixture carried exactly one channel until the Apple
    // audit put a second store directory in it, and limb 9 skips a channel whose
    // README is absent by design — so deleting ONE now leaves the limb ranging
    // over the other, which is coverage, not a loss. The vacuity this guards
    // against is the loop reaching ZERO, so the mutation has to empty the set.
    withTree(
      (root) => {
        rmSync(join(root, README));
        rmSync(join(root, `${SUBLY_IOS}/README.md`));
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /not one channel README was read/);
      },
    );
  });

  test('a README that cites NO code is COVERAGE LOST — the matcher must still match', () => {
    // The subtler half. The file is present, so the case above stays green, and
    // the derivation map — the thing limb 9 exists to check — has evaporated. A
    // path check that matches nothing passes forever.
    withTree(
      (root) => {
        for (const rel of [README, `${SUBLY_IOS}/README.md`]) {
          writeFileSync(join(root, rel), '# Store listing metadata\n\nThe derivation map used to be here.\n');
        }
      },
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /matched ZERO repository paths/);
      },
    );
  });
});

describe('limb 6 — the UI anchor, which limb 5 cannot see', () => {
  test('🔴 DELETING THE EXPORT ROW FAILS, WITH THE FILE STILL PRESENT', () => {
    // The exact P2.6b risk: a wholesale apply of the stamped settings screen
    // deletes this row. The file still exists, so every path citation resolves,
    // and the sworn sentence describing the row becomes false in silence.
    // P2.7 correction: the merged screen renders the row through l10n, so the
    // anchor is the CODE symbol (matched with comments/strings stripped —
    // two comments in the real screen narrate the row and must never satisfy
    // it). Deleting the _LinkRow that references it is the mutation.
    withTree(
      (root) => editText(root, SETTINGS, (s) => s.replace('l10n.exportDataCsv', 'l10n.helpSupport')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /rests on a screen row that is GONE/);
      },
    );
  });

  test('🔴 REWORDING THE ARB COPY AWAY FROM THE SWORN SENTENCE FAILS', () => {
    // The copy half: the key can survive while the text users see stops being
    // the export row the declaration describes.
    withTree(
      (root) =>
        editDoc(root, 'apps/subly/lib/l10n/app_en.arb', (j) => {
          j.exportDataCsv = 'Share a screenshot';
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /rests on screen copy that is GONE/);
      },
    );
  });

  test('a COMMENT naming the row does not satisfy the code anchor', () => {
    // The false green this correction removes: delete the real reference and
    // leave only a comment narrating it — the raw-includes version passed.
    withTree(
      (root) =>
        editText(root, SETTINGS, (s) =>
          s.replace('l10n.exportDataCsv', 'l10n.helpSupport') + '\n// l10n.exportDataCsv lived here\n',
        ),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /rests on a screen row that is GONE/);
      },
    );
  });

  test('🔴 AND A STALE ANCHOR FAILS RATHER THAN SILENTLY NOT APPLYING', () => {
    withTree(
      (root) =>
        editDoc(root, DS, (j) => {
          const a = j.answers.find((x) => x.type === 'Files and docs');
          a.basis = 'No storage permission, no file-picker and no share package, so the app performs no file I/O.';
          j.dataSecurity.deletionRequestSupported.inAppControl = 'apps/subly/lib/app.dart';
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /STALE ANCHOR/);
      },
    );
  });
});

describe('limb 8 — a `file.dart:NNN` citation still points at what it describes', () => {
  test('🔴 INSERTING LINES ABOVE THE CITED LINE FAILS — the drift no human re-walks', () => {
    // The measured case, and it is not hypothetical: three of the four
    // citations in `buildPosture._why` were 500–1300 lines out on 2026-08-10,
    // and the FOURTH drifted from :376 to :396 the same day, in the very edit
    // that shipped the prose telling a human to re-walk them. Ten inserted
    // lines reproduce it exactly.
    withTree(
      (root) => {
        const p = join(root, 'apps/subly/lib/app.dart');
        writeFileSync(p, `${'// pad\n'.repeat(10)}${readFileSync(p, 'utf8')}`);
      },
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /DRIFTED CITATION/);
        assert.match(r.stderr, /const _ConsentPrompt\(\)/);
      },
    );
  });

  test('🔴 A RENAMED CONSTRUCT IS REPORTED AS A RENAME, NOT AS DRIFT', () => {
    // Different defect, different repair: moving the number would be wrong when
    // the thing the sentence describes has been renamed out of existence. The
    // guard has to say which one it is or the fix is a guess.
    withTree(
      (root) => {
        const p = join(root, 'apps/subly/lib/state/analytics_providers.dart');
        writeFileSync(p, readFileSync(p, 'utf8').replaceAll('core.NoOpAnalytics()', 'core.SilentAnalytics()'));
      },
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /STALE LINE ANCHOR/);
        assert.match(r.stderr, /That is a RENAME, not a line shift/);
      },
    );
  });

  test('🔴 DELETING THE CITATION ITSELF FAILS — an anchor with nothing to check passes forever', () => {
    withTree(
      (root) =>
        editDoc(root, DS, (j) => {
          j.buildPosture._why = j.buildPosture._why.map((l) => l.replace(/app\.dart:\d+/g, 'app.dart'));
        }),
      (r) => {
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stderr, /no longer cites app\.dart:<line> at all/);
      },
    );
  });

  test('the real tree evaluates all four, so the limb is not vacuous', () => {
    // The floor exists because a scan over zero citations prints exactly like a
    // scan over four correct ones.
    withTree(
      () => {},
      (r) => {
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stderr, /line citation\(s\) were evaluated/);
      },
    );
  });
});

describe('limb 7 — the template must STAY a template', () => {
  test('🔴 COPYING ANSWERS INTO THE BRICK FAILS — app #2 may not swear to app #1\'s code', () => {
    withTree(
      (root) => cpSync(join(root, DS), join(root, BRICK_STORE, 'data-safety.json')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /brick template .* is \d+ lines — as long as an ANSWERED declaration/);
      },
    );
  });

  test('emptying the template\'s `unresolved` list fails — a blank form that reads as finished', () => {
    withTree(
      (root) => editDoc(root, `${BRICK_STORE}/content-rating.json`, (j) => { j.unresolved = []; }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /empty `unresolved` list/);
      },
    );
  });
});

describe('REQUIRED_COVERAGE — the scan must know when it has stopped scanning', () => {
  test('🔴 A THIRD SWORN .json IN THE REGISTER WITH NO SPEC IS COVERAGE LOST', () => {
    withTree(
      (root) =>
        editDoc(root, REGISTER, (j) => {
          j.storeMetadataContract.perChannel['ios-appstore'].additionalFiles.push('privacy-nutrition.json');
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /privacy-nutrition\.json/);
      },
    );
  });

  test('a spec for a file the register no longer swears to is COVERAGE LOST', () => {
    withTree(
      (root) =>
        editDoc(root, REGISTER, (j) => {
          const a = j.storeMetadataContract.perChannel['android-play'].additionalFiles;
          j.storeMetadataContract.perChannel['android-play'].additionalFiles = a.filter((f) => f !== 'content-rating.json');
        }),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no longer declares as sworn/);
      },
    );
  });

  test('deleting the declaration from the app is COVERAGE LOST, not a pass', () => {
    withTree(
      (root) => rmSync(join(root, CR)),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never exercised/);
      },
    );
  });

  test('a brick template that cannot be read is COVERAGE LOST — the floors lose their yardstick', () => {
    withTree(
      (root) => rmSync(join(root, BRICK_STORE, 'data-safety.json')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /COVERAGE LOST/);
        assert.match(r.stderr, /brick template/);
      },
    );
  });

  test('a root pubspec with no workspace block is COVERAGE LOST', () => {
    withTree(
      (root) => editText(root, 'pubspec.yaml', (s) => s.replace(/^workspace:$/m, 'workspace_disabled:')),
      (r) => {
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no readable `workspace:` block/);
      },
    );
  });
});
