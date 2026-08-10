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
const DS = `${SUBLY_STORE}/data-safety.json`;
const CR = `${SUBLY_STORE}/content-rating.json`;
/** The third sworn declaration (2026-08-09) — Play "App content → Ads". It is
 *  in the derived set below for the same reason as the other two: it cites code,
 *  so limb 5 resolves its paths and the fixture has to carry them. */
const ADS = `${SUBLY_STORE}/ads-declaration.json`;
const SETTINGS = 'apps/subly/lib/features/settings/settings_screen.dart';
const REGISTER = 'tooling/channel-register.json';

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
 */
const CITED_RE = /(?:apps|packages|services|tooling|sites)\/[A-Za-z0-9_.\/{}-]*\.(?:dart|json|jsonc|yaml|yml|ts|tsx|html|txt|xml|sql|arb|md)/g;
function citedPaths() {
  const set = new Set();
  for (const rel of [DS, CR, ADS]) {
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
  for (const rel of citedPaths()) put(rel);
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
