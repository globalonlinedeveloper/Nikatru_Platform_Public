// ─────────────────────────────────────────────────────────────────────────────
// appstore-submission.test.mjs — tooling/release/submit-appstore.mjs must be
// able to FAIL, and --submit must refuse.
//
// [pipeline D-10] limb (i): "a submission script exists AND resolves to a step
// in a workflow". A script that exists and has stopped working satisfies the
// letter of that limb and none of its point — which is why the dry run is wired
// into ci.yml on every push as well as into submit-appstore.yml, and why it has
// these tests.
//
// ⚠️ THESE FIXTURES ARE THE SECOND LINE OF EVIDENCE, NOT THE FIRST. CLAUDE.md:
// "A fixture passing is not a guard working — MUTATE THE REAL TREE." The script
// was mutation-proven FIRST against a scratch COPY of the real repository
// (2026-08-01, 20 mutations across this script, submit-snap.mjs and
// assert-store-metadata.mjs): 19 caught, 1 printed by design, restore verified
// green before and after every case, and no case "caught" by a crash. That run
// corrected a bad MUTATION rather than a bad check — renaming a channel's `id`
// without renaming its `storeMetadataDir` orphans nothing, so the first version
// of the orphan case proved only that the harness was wrong.
//
// 🔴 THE MOST IMPORTANT CASE IN THIS FILE IS THE ONE THAT ASSERTS A REFUSAL.
// `--submit` prints `UNVERIFIED:` for every App Store Connect API fact that was
// not fetched from a primary source, and exits 1 BEFORE running any check. If
// somebody later implements `--submit`, this test failing is the correct signal
// — it means the refusal is gone and the UNVERIFIED list must have been replaced
// by sourced facts, not deleted.
//
// 🔴 NO APPLE BUILD IS EXERCISED HERE OR ANYWHERE LOCALLY. There is no Apple
// hardware on the development machine and no distribution certificate exists
// (OWNER_QUEUE A-4), so unlike the Microsoft path — which validated a real
// 14.8 MiB .msix — there is NO recorded end-to-end proof over a real .ipa or
// .pkg, and there cannot be one until A-4 completes. Everything below is a
// fixture, and the artifact cases use a stand-in file of the right NAME, which
// proves the path handling and nothing about Apple packaging.
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
const SCRIPT = join(REPO, 'tooling', 'release', 'submit-appstore.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-applesubmit-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const BUNDLE = 'com.nikatru.subly';
const APPLE_SOURCE = 'developer.apple.com/help/app-store-connect/reference/app-information/ — fetched 2026-07-29';

const FILES = {
  'README.md': 'derivation map\n',
  'title.txt': 'Subly\n',
  'short-description.txt': 'Track every subscription in one place\n',
  'long-description.txt': 'A longer description.\n',
  'category.txt': 'Productivity\n',
  'privacy-policy-url.txt': 'https://nikatru.com/privacy.html\n',
  'support-url.txt': 'https://nikatru.com/contact.html\n',
  'screenshots/README.md': 'slot\n',
  'subtitle.txt': 'Every subscription, one list\n',
  'keywords.txt': 'subscription,tracker\n',
  'promotional-text.txt': 'Know what renews.\n',
};

const ARTIFACT = {
  'ios-appstore': 'apps/subly/build/ios/ipa/subly.ipa',
  'macos-appstore': 'apps/subly/build/macos/pkg/subly.pkg',
};

const appleRow = (id, over = {}) => ({
  id,
  kind: 'store',
  served: false,
  submittable: true,
  platforms: [id === 'ios-appstore' ? 'ios' : 'macos'],
  artifactFormats: [id === 'ios-appstore' ? '.ipa' : '.pkg'],
  storeMetadataDir: `apps/{app}/store/${id}`,
  ownerQueue: 'A-4',
  bundleIdentifier: {
    value: BUNDLE,
    declaredIn: id === 'ios-appstore' ? 'apps/{app}/ios/Runner.xcodeproj/project.pbxproj' : 'apps/{app}/macos/Runner/Configs/AppInfo.xcconfig',
  },
  submission: { runbook: 'company/runbooks/store-submission-apple.md' },
  ...over,
});

const perChannelLimits = () => ({
  additionalFiles: ['subtitle.txt', 'keywords.txt', 'promotional-text.txt'],
  maxChars: {
    'title.txt': { max: 30, min: 2, source: APPLE_SOURCE },
    'subtitle.txt': { max: 30, source: APPLE_SOURCE },
  },
});

/** Build a fixture repo. Everything is valid unless a knob says otherwise. */
function tree({
  mutateRegister = null,
  fields = {},
  omitFiles = [],
  omitTree = false,
  withArtifact = false,
  artifactBytes = 1024,
  iosBundle = BUNDLE,
  macosBundle = BUNDLE,
  omitProject = false,
  extraPbxproj = '',
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
      perChannel: { 'ios-appstore': perChannelLimits(), 'macos-appstore': perChannelLimits() },
    },
    channels: [appleRow('ios-appstore'), appleRow('macos-appstore')],
  };
  if (mutateRegister) mutateRegister(register);

  write('tooling/channel-register.json', JSON.stringify(register, null, 2));
  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', name: 'Subly', tagline: 'Track every subscription in one place', platforms: ['web'], status: 'live' }]));

  if (!omitProject) {
    // The iOS shape: a pbxproj carrying the app bundle AND the test bundles, so
    // the "drop the test bundles" logic is exercised rather than assumed.
    write(
      'apps/subly/ios/Runner.xcodeproj/project.pbxproj',
      [
        '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ' + iosBundle + ';',
        '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ' + iosBundle + '.RunnerTests;',
        extraPbxproj,
        '',
      ].join('\n'),
    );
    // The macOS shape: an xcconfig. Its pbxproj carries ONLY the test bundle,
    // which is why the register names the xcconfig — a reader that guessed would
    // compare against the test bundle and agree with itself.
    write('apps/subly/macos/Runner/Configs/AppInfo.xcconfig', `PRODUCT_NAME = subly\nPRODUCT_BUNDLE_IDENTIFIER = ${macosBundle}\n`);
    write('apps/subly/macos/Runner.xcodeproj/project.pbxproj', `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${macosBundle}.RunnerTests;\n`);
  }

  if (!omitTree) {
    for (const channelId of ['ios-appstore', 'macos-appstore']) {
      for (const [rel, body] of Object.entries(FILES)) {
        if (omitFiles.includes(rel)) continue;
        write(`apps/subly/store/${channelId}/${rel}`, fields[rel] ?? body);
      }
    }
  }
  if (withArtifact) {
    for (const rel of Object.values(ARTIFACT)) write(rel, 'x'.repeat(artifactBytes));
  }
  return root;
}

function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_STORE_CONNECT_ISSUER_ID: '',
      APP_STORE_CONNECT_KEY_ID: '',
      APP_STORE_CONNECT_PRIVATE_KEY: '',
      APP_STORE_CONNECT_APP_ID: '',
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const ios = (root, extra = []) => run(root, ['--dry-run', '--channel', 'ios-appstore', '--app', 'subly', ...extra]);
const macos = (root, extra = []) => run(root, ['--dry-run', '--channel', 'macos-appstore', '--app', 'subly', ...extra]);

/** A crash is not a catch. */
const assertComplained = (out) => {
  assert.doesNotMatch(out, /TypeError|ReferenceError|node:internal/, out);
  assert.match(out, /^FAIL /m, out);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('submit-appstore — both Apple channels are walkable, and --submit refuses', () => {
  test('--dry-run PASSES for iOS over a complete tree and an artifact, and sends nothing', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /DRY RUN OK — nothing was sent to Apple/);
    assert.match(out, /artifact apps\/subly\/build\/ios\/ipa\/subly\.ipa/);
    assert.match(out, /bundle identifier com\.nikatru\.subly/);
  });

  test('--dry-run PASSES for macOS, reading the xcconfig and not the pbxproj', () => {
    const { code, out } = macos(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /artifact apps\/subly\/build\/macos\/pkg\/subly\.pkg/);
    assert.match(out, /AppInfo\.xcconfig agree/);
  });

  // 🔴 the refusal, and it must be BEFORE any validation
  test('--submit REFUSES with UNVERIFIED, before running a single check', () => {
    const { code, out } = run(tree({ withArtifact: true }), ['--submit', '--channel', 'ios-appstore', '--app', 'subly']);
    assert.equal(code, 1, out);
    assert.match(out, /--submit is NOT IMPLEMENTED, and refusing is the implementation/);
    assert.match(out, /UNVERIFIED: the App Store Connect API base URL/);
    assert.match(out, /Nothing was validated/);
    assert.doesNotMatch(out, /metadata tree .* field\(s\) present/);
  });

  test('the refusal names the JWT claim set as UNVERIFIED, not just the endpoints', () => {
    const { out } = run(tree(), ['--submit', '--channel', 'macos-appstore']);
    assert.match(out, /UNVERIFIED: the exact JWT claim set, algorithm and expiry the API accepts for a \.p8 key/);
  });

  // ── the mode and the channel both have to be said out loud ────────────────
  test('FAILS when neither --dry-run nor --submit is given', () => {
    const { code, out } = run(tree(), ['--channel', 'ios-appstore']);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when both --dry-run and --submit are given', () => {
    const { code, out } = run(tree(), ['--dry-run', '--submit', '--channel', 'ios-appstore']);
    assert.equal(code, 1, out);
    assert.match(out, /exactly one of --dry-run and --submit is required/);
  });

  test('FAILS when no --channel is given — it must not default to one of two records', () => {
    const { code, out } = run(tree(), ['--dry-run']);
    assert.equal(code, 1, out);
    assert.match(out, /--channel must be one of: ios-appstore, macos-appstore/);
  });

  test('FAILS on a --channel that is not an Apple store row', () => {
    const { code, out } = run(tree(), ['--dry-run', '--channel', 'windows-store']);
    assert.equal(code, 1, out);
    assert.match(out, /--channel must be one of/);
  });

  // ── the listing ───────────────────────────────────────────────────────────
  test('FAILS when a listing field is missing', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitFiles: ['title.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /title\.txt is missing/);
  });

  test('FAILS when an Apple-only field is missing', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitFiles: ['subtitle.txt'] }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subtitle\.txt is missing/);
  });

  test('FAILS when a listing field is emptied', () => {
    const { code, out } = macos(tree({ withArtifact: true, fields: { 'category.txt': '  \n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /category\.txt is EMPTY/);
  });

  test('FAILS when the whole metadata tree is gone', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitTree: true }));
    assert.equal(code, 1, out);
    assert.match(out, /the store metadata tree apps\/subly\/store\/ios-appstore does not exist/);
  });

  test('FAILS when a URL field is not an absolute https URL', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'support-url.txt': '/contact.html\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /not a single absolute https URL/);
  });

  // ── the two SOURCED Apple limits, and the citation discipline ─────────────
  test('FAILS on a 31-character subtitle, citing the page it came from', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'subtitle.txt': `${'x'.repeat(31)}\n` } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subtitle\.txt is 31 characters; the limit is 30/);
    assert.match(out, /app-store-connect\/reference\/app-information/);
  });

  test('PASSES on exactly 30 characters — the limit is not off by one', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'subtitle.txt': `${'x'.repeat(30)}\n` } }));
    assert.equal(code, 0, out);
  });

  test('FAILS below the sourced minimum of 2 characters', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'title.txt': 'S\n' } }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /title\.txt is 1 characters; the minimum is 2/);
  });

  // 🔴 A LIMIT WITHOUT A CITATION IS NOT ENFORCED, AND NOT SILENTLY SKIPPED.
  test('FAILS when a declared limit has no `source` — an unsourced number is not enforceable', () => {
    const { code, out } = ios(
      tree({
        withArtifact: true,
        mutateRegister: (r) => delete r.storeMetadataContract.perChannel['ios-appstore'].maxChars['subtitle.txt'].source,
      }),
    );
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares a ios-appstore character limit for subtitle\.txt with NO `source`/);
  });

  test('enforces NOTHING on a field with no declared limit — keywords carry no number', () => {
    const { code, out } = ios(tree({ withArtifact: true, fields: { 'keywords.txt': `${'k'.repeat(5000)}\n` } }));
    assert.equal(code, 0, out);
  });

  // ── the bundle identifier: one declaration, two readers ───────────────────
  test('FAILS when the iOS project builds a different bundle id from the register', () => {
    const { code, out } = ios(tree({ withArtifact: true, iosBundle: 'com.someoneelse.subly' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /bundle identifier DISAGREES/);
  });

  test('FAILS when the macOS xcconfig builds a different bundle id from the register', () => {
    const { code, out } = macos(tree({ withArtifact: true, macosBundle: 'com.someoneelse.subly' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /bundle identifier DISAGREES/);
  });

  // 🔴 the case that makes `declaredIn` load-bearing rather than decorative
  test('does NOT mistake the RunnerTests bundle for the app bundle', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /RunnerTests/);
  });

  test('FAILS when the project declares TWO different app bundle ids', () => {
    const { code, out } = ios(tree({ withArtifact: true, extraPbxproj: '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.nikatru.other;' }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /declares 2 DIFFERENT app bundle identifiers/);
  });

  test('FAILS when the file that declares the bundle id does not exist', () => {
    const { code, out } = ios(tree({ withArtifact: true, omitProject: true }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /does not exist, so channel "ios-appstore"'s bundle identifier cannot be compared/);
  });

  test('COVERAGE LOST when the project file carries no bundle id at all', () => {
    const root = tree({ withArtifact: true });
    writeFileSync(join(root, 'apps/subly/ios/Runner.xcodeproj/project.pbxproj'), '// nothing here\n');
    const { code, out } = ios(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*contains ZERO `PRODUCT_BUNDLE_IDENTIFIER` assignments/);
  });

  test('COVERAGE LOST when the register declares no bundleIdentifier', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => delete r.channels.find((c) => c.id === 'ios-appstore').bundleIdentifier }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*declares no `bundleIdentifier`/);
  });

  test('FAILS when bundleIdentifier.value is emptied', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels.find((c) => c.id === 'ios-appstore').bundleIdentifier.value = '') }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /bundleIdentifier is incomplete/);
  });

  // ── the artifact ──────────────────────────────────────────────────────────
  test('FAILS when the artifact is absent and --allow-missing-artifact was NOT passed', () => {
    const { code, out } = ios(tree());
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /subly\.ipa does not exist/);
  });

  test('PASSES with --allow-missing-artifact, and SAYS the package was not validated', () => {
    const { code, out } = ios(tree(), ['--allow-missing-artifact']);
    assert.equal(code, 0, out);
    assert.match(out, /NO SIGNED ARTIFACT/);
    assert.match(out, /distribution certificate and provisioning profile OWNER_QUEUE A-4 gates/);
  });

  test('FAILS on a zero-byte artifact', () => {
    const { code, out } = ios(tree({ withArtifact: true, artifactBytes: 0 }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /ZERO bytes/);
  });

  test('FAILS when the channel stops accepting the format the path produces', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels.find((c) => c.id === 'ios-appstore').artifactFormats = ['.zip']) }));
    assert.equal(code, 1, out);
    assertComplained(out);
    assert.match(out, /matches none of the formats channel "ios-appstore" accepts/);
  });

  // ── credentials and floors: printed, never failed, never read ─────────────
  test('PRINTS which credentials are absent and never their values', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /CREDENTIALS NOT CONFIGURED — 4 of 4 absent/);
    assert.match(out, /APP_STORE_CONNECT_PRIVATE_KEY/);
  });

  test('reports credentials as present without printing them', () => {
    const secret = 'THIS-MUST-NEVER-BE-PRINTED';
    const { code, out } = run(tree({ withArtifact: true }), ['--dry-run', '--channel', 'ios-appstore'], {
      APP_STORE_CONNECT_ISSUER_ID: 'i',
      APP_STORE_CONNECT_KEY_ID: 'k',
      APP_STORE_CONNECT_PRIVATE_KEY: secret,
      APP_STORE_CONNECT_APP_ID: '1',
    });
    assert.equal(code, 0, out);
    assert.match(out, /credentials — all 4 environment variable\(s\) present/);
    assert.doesNotMatch(out, new RegExp(secret));
  });

  // 🔴 the sourced floor that is NOT met, printed on every run
  test('PRINTS the unpinned Xcode 26 floor, with its source and its date', () => {
    const { code, out } = ios(tree({ withArtifact: true }));
    assert.equal(code, 0, out);
    assert.match(out, /XCODE FLOOR NOT PINNED/);
    assert.match(out, /must be built with Xcode 26 or later/);
    assert.match(out, /arm64-only/);
  });

  test('stops printing the Xcode gap once tooling/versions.json pins one', () => {
    const root = tree({ withArtifact: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling/versions.json'), JSON.stringify({ xcode: '26.0' }));
    const { code, out } = ios(root);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /XCODE FLOOR NOT PINNED/);
  });

  // ── the register is the single declaration ────────────────────────────────
  test('COVERAGE LOST when the register declares no such channel', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels = r.channels.filter((c) => c.id !== 'ios-appstore')) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*declares no "ios-appstore" channel/);
  });

  test('COVERAGE LOST when storeMetadataContract.requiredFiles is emptied', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.storeMetadataContract.requiredFiles = []) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — .*requiredFiles/);
  });

  test('FAILS when the channel stops being submittable', () => {
    const { code, out } = ios(tree({ withArtifact: true, mutateRegister: (r) => (r.channels.find((c) => c.id === 'ios-appstore').submittable = false) }));
    assert.equal(code, 1, out);
    assert.match(out, /is not marked `submittable`/);
  });
});
