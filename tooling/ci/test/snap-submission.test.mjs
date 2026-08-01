// ─────────────────────────────────────────────────────────────────────────────
// snap-submission.test.mjs — tooling/release/submit-snap.mjs must be able to
// FAIL, and --submit must refuse.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". For this channel the ci.yml dry run is the ONLY thing keeping
// the path from rotting — submit-snap.yml runs the same command, because there
// is no snapcraft.yaml for it to build anything from.
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
// 🔴 NO .snap HAS EVER BEEN BUILT. There is no snapcraft.yaml in the repository,
// so unlike the Microsoft path — which validated a real 14.8 MiB .msix — there
// is NO recorded end-to-end proof over a real artifact. The artifact cases below
// use a stand-in file of the right NAME, which proves path handling and nothing
// about snap packaging.
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

function tree({ mutateRegister = null, fields = {}, omitFiles = [], omitTree = false, withArtifact = false, artifactBytes = 1024, withRecipe = false } = {}) {
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
        submission: { runbook: 'company/runbooks/store-submission-snap.md' },
      },
    ],
  };
  if (mutateRegister) mutateRegister(register);

  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'] }]));

  if (!omitTree) {
    for (const [rel, body] of Object.entries(FILES)) {
      if (omitFiles.includes(rel)) continue;
      write(`apps/subly/store/linux-snap/${rel}`, fields[rel] ?? body);
    }
  }
  if (withArtifact) write(ARTIFACT, 'x'.repeat(artifactBytes));
  if (withRecipe) write('apps/subly/snap/snapcraft.yaml', 'name: subly\n');
  return root;
}

function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], {
    encoding: 'utf8',
    env: { ...process.env, SNAPCRAFT_STORE_CREDENTIALS: '', ...env },
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

  // 🔴 the refusal, and it must be BEFORE any validation
  test('--submit REFUSES with UNVERIFIED, before running a single check', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--submit', '--app', 'subly']);
    assert.equal(code, 1, out);
    assert.match(out, /--submit is NOT IMPLEMENTED, and refusing is the implementation/);
    assert.match(out, /UNVERIFIED: the exact `snapcraft upload` invocation/);
    assert.match(out, /Nothing was validated/);
    assert.doesNotMatch(out, /metadata tree .* field\(s\) present/);
  });

  test('the refusal explains the silent-auto-update stake, not just "not implemented"', () => {
    const { out } = run(tree(), ['--submit']);
    assert.match(out, /Snap auto-updates/);
    assert.match(out, /the wrong revision reaches real machines/);
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
    assert.match(out, /SNAP NAME NOT REGISTERED/);
    assert.match(out, /snapcraft register subly/);
    assert.match(out, /OWNER_QUEUE A-6/);
  });

  // ── the recipe that does not exist yet ────────────────────────────────────
  test('PRINTS the missing snapcraft recipe rather than failing on deferred work', () => {
    const { code, out } = dry(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /NO SNAPCRAFT RECIPE/);
    assert.match(out, /plugin: dump/);
    assert.match(out, /libmpv2/);
  });

  test('stops printing the recipe gap once one exists', () => {
    const { code, out } = dry(tree({ withArtifact: true, withRecipe: true }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /NO SNAPCRAFT RECIPE/);
    assert.match(out, /snapcraft recipe apps\/subly\/snap\/snapcraft\.yaml/);
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
  test('FAILS if the register grows a limit this script does not read', () => {
    const { code, out } = dry(
      tree({
        withArtifact: true,
        mutateRegister: (r) => (r.storeMetadataContract.perChannel['linux-snap'].maxChars = { 'title.txt': { max: 40, source: 'somewhere' } }),
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares maxChars for "linux-snap", and this script does not read them/);
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
    assert.match(out, /credentials — all 1 environment variable\(s\) present/);
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
