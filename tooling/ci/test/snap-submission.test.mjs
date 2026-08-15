// ─────────────────────────────────────────────────────────────────────────────
// snap-submission.test.mjs — tooling/release/submit-snap.mjs must be able to
// FAIL, and --submit must refuse.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". ⚠️ THIS HEADER SAID "the ci.yml dry run is the ONLY thing
// keeping the path from rotting — submit-snap.yml runs the same command, because
// there is no snapcraft.yaml for it to build anything from", and that stopped
// being true on 2026-08-09: submit-snap.yml compiles the Linux bundle, generates
// the recipe, PACKS a .snap and runs this script without
// `--allow-missing-artifact`. The ci.yml step is now the cheap listing-only half.
//
// ⚠️ THESE FIXTURES ARE THE SECOND LINE OF EVIDENCE, NOT THE FIRST. The script
// was mutation-proven FIRST against a scratch COPY of the real repository
// (2026-08-01, 20 mutations across this script, submit-appstore.mjs and
// assert-store-metadata.mjs): 19 caught, 1 printed by design, restore verified
// green before and after every case, and no case "caught" by a crash.
//
// 🔴 THE REFUSAL MATTERS MORE ON THIS CHANNEL THAN ANY OTHER. Snap auto-updates
// SILENTLY, so a guessed `release` verb does not produce a failed API call — it
// produces the wrong revision on somebody's desktop. `--submit` therefore exits
// 1 with `UNVERIFIED:` lines before running a single check.
//
// 🔴 NO .snap HAS BEEN BUILT YET, and the distinction from "cannot be" is new.
// Until 2026-08-09 there was no recipe and no packing step anywhere, so unlike
// the Microsoft path — which validated a real 14.8 MiB .msix — there was NO
// end-to-end proof possible. submit-snap.yml can now produce one, and the first
// dispatch is where that proof comes from; nothing in this suite is it. The
// artifact cases below use a stand-in file of the right NAME, which proves path
// handling and nothing about snap packaging.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'release', 'submit-snap.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-snapsubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const ARTIFACT = 'apps/subly/build/linux/snap/subly.snap';

const FILES = {
  'README.md': 'derivation map\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'screenshots/README.md': 'slot\n',
  'snap-name.txt': 'subly\n',
  'license.txt': 'proprietary\n',
};

function tree({
  mutateRegister = null,
  fields = {},
  omitFiles = [],
  omitTree = false,
  withArtifact = false,
  artifactBytes = 1024,
  withRecipe = false,
  // The real register declares `submission.recipeScript` and the file exists, so
  // the recipe is DERIVED at build time and no committed one is expected. The
  // fixture can build either arrangement, because §4 must recognise both and
  // must still print when neither is present.
  withRecipeScript = false,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  const register = {
    storeMetadataContract: {
      requiredFiles: ['README.md', 'title.txt', 'short-description.txt', 'long-description.txt', 'category.txt', 'privacy-policy-url.txt', 'support-url.txt', 'screenshots/README.md'],
      urlFiles: ['privacy-policy-url.txt', 'support-url.txt'],
      perChannel: { 'linux-snap': { additionalFiles: ['snap-name.txt', 'license.txt'] } },
    },
    channels: [
      {
        id: 'linux-snap',
        kind: 'store',
        served: false,
        submittable: true,
        platforms: ['linux'],
        artifactFormats: ['.snap'],
        storeMetadataDir: 'apps/{app}/store/linux-snap',
        ownerQueue: 'A-6',
        signing: { keyKind: 'none' },
        submission: {
          runbook: 'Private/company/runbooks/store-submission-snap.md',
          ...(withRecipeScript ? { recipeScript: 'tooling/release/generate-snapcraft.mjs' } : {}),
        },
      },
    ],
  };
  if (mutateRegister) mutateRegister(register);

  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' }]));

  if (!omitTree) {
    for (const [rel, body] of Object.entries(FILES)) {
      if (omitFiles.includes(rel)) continue;
      write(`apps/subly/store/linux-snap/${rel}`, fields[rel] ?? body);
    }
  }
  if (withArtifact) write(ARTIFACT, 'x'.repeat(artifactBytes));
  if (withRecipe) write('apps/subly/snap/snapcraft.yaml', 'name: subly\n');
  if (withRecipeScript) write('tooling/release/generate-snapcraft.mjs', '// stand-in for the generator\n');
  return root;
}

function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SNAPCRAFT_STORE_CREDENTIALS: '',
      // 🔴 THE AMBIENT CI VARIABLES ARE NEUTRALISED, AND THIS COST A RED CI RUN.
      // PG-4 refuses when GITHUB_ACTIONS is not "true". The helper inherited
      // process.env, so the case passed on a laptop (unset) and FAILED inside CI
      // — where the variable is set, PG-4 correctly did not fire, and the
      // assertion looked for a refusal that should not have happened. The test
      // was measuring THE RUNNER, not the script.
      // Cleared for every case so the subject is always the script's own logic;
      // a case that wants Actions-like conditions passes them EXPLICITLY through
      // `env`, which also makes that dependency visible at the call site instead
      // of hidden in whatever machine happens to run it.
      GITHUB_ACTIONS: '',
      GITHUB_REPOSITORY: '',
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const dry = (root, extra = []) => run(root, ['--dry-run', '--app', 'subly', ...extra]);

/** A crash is not a catch. */
const assertComplained = (out) => {
  assert.doesNotMatch(out, /TypeError|ReferenceError|node:internal/, out);
  assert.match(out, /^FAIL /m, out);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('submit-snap — the submission path is walkable, and --submit refuses', () => {
  test('--dry-run PASSES over a complete tree and an artifact, and sends nothing', () => {
    const { code, out } = dry(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN OK — nothing was sent to the Snap Store/);
    assert.match(out, /artifact apps\/subly\/build\/linux\/snap\/subly\.snap/);
  });

  // 🔴 THESE TWO REPLACE THE BLANKET `UNVERIFIED` REFUSAL, THEY DO NOT DELETE IT.
  // From 2026-08-01 to 2026-08-11 `--submit` refused outright and these cases
  // asserted that refusal. Five of its seven facts are now sourced, so the
  // refusal is gone — and a case that asserted a refusal must become a case that
  // asserts WHAT REPLACED IT, or coverage shrinks by exactly the thing that
  // changed. The stake the old case protected (a wrong revision reaching real
  // machines silently) is now PG-3's, and is asserted there with its citations.
  test('PG-1 · --submit REFUSES without the confirm token, before any validation', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--submit', '--app', 'subly']);
    assert.equal(code, 1, out);
    assert.match(out, /--submit requires --confirm SUBMIT-TO-SNAP-STORE/);
    // The gate is FIRST: nothing was validated on the way to refusing.
    assert.doesNotMatch(out, /metadata tree .* field\(s\) present/);
  });

  test('PG-3 · the stable risk is refused, and the refusal cites why it is class A', () => {
    const { code, out } = run(tree({ withArtifact: true }), [
      '--submit', '--app', 'subly', '--confirm', 'SUBMIT-TO-SNAP-STORE', '--channel', 'latest/stable',
    ]);
    assert.equal(code, 1, out);
    assert.match(out, /refuses the "stable" risk/);
    // The three sourced sentences that MAKE it class A, not the word "class A".
    // ⚠️ FRAGMENTS, NOT WHOLE SENTENCES: the refusal is printed wrapped, so a
    // regex spanning the wrap matches nothing and the case would fail for a
    // formatting reason while the citation was present all along.
    assert.match(out, /risk level by default/);
    assert.match(out, /checks for updates 4 times a day/);
    assert.match(out, /100% of devices/);
  });

  test('PG-3 · refuses stable on ANY track, not only latest', () => {
    const { code } = run(tree({ withArtifact: true }), [
      '--submit', '--app', 'subly', '--confirm', 'SUBMIT-TO-SNAP-STORE', '--channel', '2.x/stable',
    ]);
    assert.equal(code, 1);
  });

  test('PG-2 · --submit refuses --allow-missing-artifact, which is a dry-run flag', () => {
    const { code, out } = run(tree({ withArtifact: true }), [
      '--submit', '--app', 'subly', '--confirm', 'SUBMIT-TO-SNAP-STORE', '--allow-missing-artifact',
    ]);
    assert.equal(code, 1, out);
    assert.match(out, /is a DRY-RUN flag and --submit refuses it/);
  });

  test('PG-4 · --submit refuses outside GitHub Actions, where the reviewer gate lives', () => {
    const { code, out } = run(tree({ withArtifact: true }), [
      '--submit', '--app', 'subly', '--confirm', 'SUBMIT-TO-SNAP-STORE', '--channel', 'latest/edge',
    ]);
    assert.equal(code, 1, out);
    assert.match(out, /runs only inside GitHub Actions/);
  });

  test('FAILS when neither --dry-run nor --submit is given', () => {
    const { code, out } = run(tree(), []);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when both --dry-run and --submit are given', () => {
    const { code, out } = run(tree(), ['--dry-run', '--submit']);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  // ── the listing ───────────────────────────────────────────────────────────
  test('FAILS when a listing field is missing', () => {
    const { code, out } = dry(tree({ withArtifact: true, omitFiles: ['title.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /title\.txt is missing/);
  });

  test('FAILS when a listing field is emptied', () => {
    const { code, out } = dry(tree({ withArtifact: true, fields: { 'category.txt': '  \n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('FAILS when the whole metadata tree is gone', () => {
    const { code, out } = dry(tree({ withArtifact: true, omitTree: true }));
    assert.equal(code, 1, out);
    assert.match(out, /the store metadata tree apps\/subly\/store\/linux-snap does not exist/);
  });

  test('FAILS when a URL field is not an absolute https URL', () => {
    const { code, out } = dry(tree({ withArtifact: true, fields: { 'privacy-policy-url.txt': 'nikatru.com/privacy\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /not a single absolute https URL/);
  });

  // ── the snap name: the one irreversible field ─────────────────────────────
  test('FAILS when snap-name.txt is missing — the namespace is global and claimed once', () => {
    const { code, out } = dry(tree({ withArtifact: true, omitFiles: ['snap-name.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /snap-name\.txt is missing/);
  });

  test('FAILS on a name that is not the shape a snap name takes', () => {
    const { code, out } = dry(tree({ withArtifact: true, fields: { 'snap-name.txt': 'Subly App!\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /is not the shape a snap name takes/);
    // The caveat has to travel WITH the check: this is a shape rule, not a
    // sourced limit, and saying so is what stops it hardening into a fake fact.
    assert.match(out, /UNVERIFIED/);
  });

  test('FAILS on a leading hyphen', () => {
    const { code, out } = dry(tree({ withArtifact: true, fields: { 'snap-name.txt': '-subly\n' } }));
    assert.equal(code, 1, out);
    assert.match(out, /is not the shape a snap name takes/);
  });

  test('FAILS when two candidate names are listed — nobody decided', () => {
    const { code, out } = dry(tree({ withArtifact: true, fields: { 'snap-name.txt': 'subly\nsubly-app\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /contains more than one line/);
  });

  test('ACCEPTS an internal hyphen, which is the common real shape', () => {
    const { code, out } = dry(tree({ withArtifact: true, fields: { 'snap-name.txt': 'subly-app\n' } }));
    assert.equal(code, 0, out);
  });

  test('PRINTS that the name is not registered, and that availability is UNVERIFIED', () => {
    const { code, out } = dry(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /SNAP NAME REGISTRATION IS UNVERIFIABLE FROM HERE/);
    assert.match(out, /snapcraft register subly/);
    assert.match(out, /OWNER_QUEUE A-6/);
  });

  // ── where the recipe comes from ───────────────────────────────────────────
  test('PRINTS the missing snapcraft recipe when NEITHER source exists', () => {
    const { code, out } = dry(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /NO SNAPCRAFT RECIPE/);
    assert.match(out, /plugin: dump/);
    assert.match(out, /libmpv2/);
  });

  test('stops printing the recipe gap once a COMMITTED one exists', () => {
    const { code, out } = dry(tree({ withArtifact: true, withRecipe: true }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /NO SNAPCRAFT RECIPE/);
    assert.match(out, /snapcraft recipe apps\/subly\/snap\/snapcraft\.yaml/);
  });

  // 🔴 THE ARRANGEMENT THE REAL REGISTER USES, and the case whose absence made
  // this script print a closed gap on every run from 2026-08-08 to 2026-08-09.
  // The recipe is GENERATED and never committed, so looking only for a committed
  // file reported "nothing in this repo can build a .snap" while a workflow was
  // building one.
  test('a DECLARED generator is a recipe source: no committed file, and no gap printed', () => {
    const { code, out } = dry(tree({ withArtifact: true, withRecipeScript: true }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /NO SNAPCRAFT RECIPE/);
    assert.match(out, /recipe generator tooling\/release\/generate-snapcraft\.mjs/);
    assert.match(out, /DERIVED at build time and never committed/);
  });

  // …and the declaration alone is not enough: a register naming a generator that
  // is not on disk is a path nobody can walk, which must read as the gap it is.
  test('a DECLARED generator that is NOT on disk still prints the gap', () => {
    const { code, out } = dry(
      tree({
        withArtifact: true,
        mutateRegister: (r) => {
          r.channels[0].submission.recipeScript = 'tooling/release/generate-snapcraft.mjs';
        },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /NO SNAPCRAFT RECIPE/);
    assert.match(out, /names no `submission\.recipeScript` that does/);
  });

  // ── the artifact ──────────────────────────────────────────────────────────
  test('FAILS when the artifact is absent and --allow-missing-artifact was NOT passed', () => {
    const { code, out } = dry(tree());
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subly\.snap does not exist/);
  });

  test('PASSES with --allow-missing-artifact, and SAYS the package was not validated', () => {
    const { code, out } = dry(tree(), ['--allow-missing-artifact']);
    assert.equal(code, 0, out);
    assert.match(out, /NO PACKAGED ARTIFACT/);
  });

  test('FAILS on a zero-byte artifact', () => {
    const { code, out } = dry(tree({ withArtifact: true, artifactBytes: 0 }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /ZERO bytes/);
  });

  test('FAILS when the channel stops accepting the format the path produces', () => {
    const { code, out } = dry(tree({ withArtifact: true, mutateRegister: (r) => (r.channels[0].artifactFormats = ['.deb']) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /matches none of the formats channel "linux-snap" accepts/);
  });

  // 🔴 NO LIMIT IS DECLARED FOR THIS CHANNEL, AND ADDING ONE MUST NOT BE SILENT.
  // If a future increment writes a sourced Snap Store limit into the register,
  // this script would keep passing while appearing to enforce it. That is the
  // "a check that silently stopped checking" shape, pre-empted.
  // 🔴 INVERTED ON 2026-08-11. This used to assert that a declared limit FAILED
  // the run, on the correct ground that "a limit that looks enforced would not
  // be". The right end of that trade is to ENFORCE it — so the case now proves
  // the limit is read and applied, and its sibling below proves the fault that
  // replaced the old refusal: a limit arriving with no `source` is not a licence
  // to enforce a remembered number.
  test('ENFORCES a declared, SOURCED character limit', () => {
    const { code, out } = dry(
      tree({
        withArtifact: true,
        fields: { 'title.txt': `${'T'.repeat(80)}\n` },
        mutateRegister: (r) => (r.storeMetadataContract.perChannel['linux-snap'].maxChars = {
          'title.txt': { max: 40, source: 'https://example.invalid/ (fixture)' },
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /is 80 characters; the Snap Store caps this field at 40/);
  });

  test('a declared limit with NO source is a FAULT, not a licence to enforce it', () => {
    const { code, out } = dry(
      tree({
        withArtifact: true,
        mutateRegister: (r) => (r.storeMetadataContract.perChannel['linux-snap'].maxChars = {
          'title.txt': { max: 40 },
        }),
      }),
    );
    assert.equal(code, 1, out);
    // 🔴 IT FAILS HARDER THAN THE PER-FIELD FAULT, and that is correct. An
    // unsourced limit is never EVALUATED, so `limitsChecked` stays 0 and the
    // declared-but-none-measured branch fires first — the same COVERAGE LOST
    // shape this repo uses everywhere for 'the scan ranged over nothing'.
    assert.match(out, /1 field limit\(s\) are declared for "linux-snap" and NOT ONE was evaluated/);
  });

  test('enforces NO character limit today — a long title passes, because none is sourced', () => {
    const { code, out } = dry(tree({ withArtifact: true, fields: { 'title.txt': `${'T'.repeat(500)}\n` } }));
    assert.equal(code, 0, out);
  });

  // ── credentials: presence only, never values ──────────────────────────────
  test('PRINTS the absent credential and never its value', () => {
    const { code, out } = dry(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /CREDENTIALS NOT CONFIGURED — SNAPCRAFT_STORE_CREDENTIALS absent/);
  });

  test('reports the credential as present without printing it', () => {
    const secret = 'THIS-MUST-NEVER-BE-PRINTED';
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run'], { SNAPCRAFT_STORE_CREDENTIALS: secret });
    assert.equal(code, 0, out);
    assert.match(out, /credentials — SNAPCRAFT_STORE_CREDENTIALS present/);
    assert.doesNotMatch(out, new RegExp(secret));
  });

  // ── the register is the single declaration ────────────────────────────────
  test('COVERAGE LOST when the register declares no linux-snap row', () => {
    const { code, out } = dry(tree({ withArtifact: true, mutateRegister: (r) => (r.channels = []) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*declares no "linux-snap" channel/);
  });

  test('COVERAGE LOST when storeMetadataContract.requiredFiles is emptied', () => {
    const { code, out } = dry(tree({ withArtifact: true, mutateRegister: (r) => (r.storeMetadataContract.requiredFiles = []) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*requiredFiles/);
  });

  test('FAILS when the channel stops being submittable', () => {
    const { code, out } = dry(tree({ withArtifact: true, mutateRegister: (r) => (r.channels[0].submittable = false) }));
    assert.equal(code, 1, out);
    assert.match(out, /is not marked `submittable`/);
  });
});
