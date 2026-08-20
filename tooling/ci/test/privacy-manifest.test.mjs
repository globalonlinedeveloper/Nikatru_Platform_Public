// ─────────────────────────────────────────────────────────────────────────────
// privacy-manifest.test.mjs — assert-privacy-manifest.mjs must be able to FAIL.
//
// Pipeline requirement: Private/requirements/ → C-6.
//
// 🔴 THE DEFECT UNDER TEST IS NOT "THE FILE IS MISSING". It is a
// PrivacyInfo.xcprivacy that EXISTS IN GIT AND IS NEVER COPIED INTO THE BUNDLE,
// because nothing lists it in the target's Copy Bundle Resources phase. From
// inside the repository that state is indistinguishable from never having
// written the file: the file is there, the diff reads right, the review passes,
// and the shipped app has no manifest. Only a machine that reads the pbxproj can
// tell those two apart, which is why this guard exists at all.
//
// apps/subly/{ios,macos}/Runner.xcodeproj carries `objectVersion = 54` with no
// PBXFileSystemSynchronizedRootGroup (measured 2026-08-20), so membership is
// explicit and omittable. A newer, folder-synchronised project would not need
// this — and the day one arrives, these fixtures are what says so.
//
// ⚠️ NO APPLE CONSTANT IS ASSERTED ANYWHERE IN THIS FILE, and that is deliberate
// rather than thin. The legal NSPrivacyAccessedAPIType strings and their
// approved reason codes are Apple's vocabulary; a sourced sweep on 2026-08-20
// returned two of five category names with citations. Testing against a list
// assembled from memory would pin invented constants into the suite, and a wrong
// constant is ITMS-91056 — a rejection. The rule under test is one level up and
// needs no vocabulary: a reason code with no citation in the register fails.
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
import { reasonCodesIn, isInResourcesPhase, MANIFEST_NAME, APPLE_TARGETS } from '../assert-privacy-manifest.mjs';

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assert-privacy-manifest.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-privman-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

const FILE_REF = 'AA1111111111111111111111';
const BUILD_FILE = 'BB2222222222222222222222';

/** A pbxproj carrying the manifest in the Resources phase — the correct shape. */
const pbxWired = () => `// !$*UTF8*$!
{
  objectVersion = 54;
  objects = {
    ${FILE_REF} /* ${MANIFEST_NAME} */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = ${MANIFEST_NAME}; sourceTree = "<group>"; };
    ${BUILD_FILE} /* ${MANIFEST_NAME} in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF} /* ${MANIFEST_NAME} */; };
    97C146EC1CF9000F007C117D /* Resources */ = {
      isa = PBXResourcesBuildPhase;
      buildActionMask = 2147483647;
      files = (
        ${BUILD_FILE} /* ${MANIFEST_NAME} in Resources */,
      );
      runOnlyForDeploymentPostprocessing = 0;
    };
  };
}`;

/** The silent case: the file is in the project navigator and in no build phase. */
const pbxRefOnly = () => `// !$*UTF8*$!
{
  objectVersion = 54;
  objects = {
    ${FILE_REF} /* ${MANIFEST_NAME} */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = ${MANIFEST_NAME}; sourceTree = "<group>"; };
    ${BUILD_FILE} /* ${MANIFEST_NAME} in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF} /* ${MANIFEST_NAME} */; };
    97C146EC1CF9000F007C117D /* Resources */ = {
      isa = PBXResourcesBuildPhase;
      buildActionMask = 2147483647;
      files = (
      );
      runOnlyForDeploymentPostprocessing = 0;
    };
  };
}`;

/** The project knows nothing about the file at all. */
const pbxEmpty = () => `// !$*UTF8*$!
{
  objectVersion = 54;
  objects = {
    97C146EC1CF9000F007C117D /* Resources */ = {
      isa = PBXResourcesBuildPhase;
      buildActionMask = 2147483647;
      files = (
      );
      runOnlyForDeploymentPostprocessing = 0;
    };
  };
}`;

const manifestWith = (codes) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>NSPrivacyAccessedAPITypes</key><array><dict>
    <key>NSPrivacyAccessedAPITypeReasons</key><array>
${codes.map((c) => `      <string>${c}</string>`).join('\n')}
    </array>
  </dict></array>
</dict></plist>
`;

/**
 * @param o.manifest  null writes none; otherwise the file body.
 * @param o.pbx       the ios pbxproj body.
 * @param o.register  the channel-register body (object or string).
 */
function fixture({ manifest = manifestWith([]), pbx = pbxWired(), register = { channels: [] } } = {}) {
  const root = join(TMP, `f${seq++}`);
  const ios = join(root, 'apps', 'subly', 'ios');
  mkdirSync(join(ios, 'Runner'), { recursive: true });
  mkdirSync(join(ios, 'Runner.xcodeproj'), { recursive: true });
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(ios, 'Runner.xcodeproj', 'project.pbxproj'), pbx);
  if (manifest !== null) writeFileSync(join(ios, 'Runner', MANIFEST_NAME), manifest);
  writeFileSync(
    join(root, 'tooling', 'channel-register.json'),
    typeof register === 'string' ? register : JSON.stringify(register, null, 2),
  );
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const citing = (code) => ({
  channels: [{
    id: 'ios-appstore',
    privacyManifest: { approvedReasonCodes: { [code]: { source: 'https://developer.apple.com/example', fetched: '2026-08-20' } } },
  }],
});

// ── the pure readers ────────────────────────────────────────────────────────
describe('assert-privacy-manifest — reading the manifest and the project', () => {
  test('reason codes are read out of the plist, deduplicated and sorted', () => {
    assert.deepEqual(reasonCodesIn(manifestWith(['E174.1', 'CA92.1', 'CA92.1'])), ['CA92.1', 'E174.1']);
  });

  test('a code SHAPE is matched, not a list — an unknown code is still found', () => {
    // The whole point: a code nobody has heard of is the one worth stopping.
    assert.deepEqual(reasonCodesIn(manifestWith(['ZZ99.7'])), ['ZZ99.7']);
  });

  test('prose that merely mentions a code is not a declaration', () => {
    assert.deepEqual(reasonCodesIn('<!-- CA92.1 is the app-only case -->'), []);
  });

  test('non-string input refuses rather than throwing', () => {
    for (const bad of [null, undefined, 42, {}]) assert.deepEqual(reasonCodesIn(bad), []);
  });

  test('a wired pbxproj reports membership', () => {
    assert.equal(isInResourcesPhase(pbxWired(), MANIFEST_NAME).member, true);
  });

  // 🔴 THE ONE THAT MATTERS.
  test('a PBXBuildFile listed in NO resources phase is NOT membership', () => {
    const v = isInResourcesPhase(pbxRefOnly(), MANIFEST_NAME);
    assert.equal(v.member, false);
    assert.match(v.why, /has a PBXBuildFile that no PBXResourcesBuildPhase lists/);
  });

  test('a project that never names the file is NOT membership', () => {
    const v = isInResourcesPhase(pbxEmpty(), MANIFEST_NAME);
    assert.equal(v.member, false);
    assert.match(v.why, /no PBXFileReference names/);
  });

  test('APPLE_TARGETS covers both Apple platforms — a shrunken list certifies less', () => {
    assert.deepEqual(APPLE_TARGETS.map((t) => t.platform).sort(), ['ios', 'macos']);
  });
});

// ── the verdicts ────────────────────────────────────────────────────────────
describe('assert-privacy-manifest — a manifest the build never copies is caught', () => {
  test('a wired manifest with no reason codes passes', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}privacy manifests/);
  });

  // 🔴 THE RECORDED FAILING CASE. In git, in the navigator, in no build phase.
  test('a manifest that EXISTS and is NOT copied FAILS, and says why', () => {
    const { code, out } = run(fixture({ pbx: pbxRefOnly() }));
    assert.equal(code, 1, out);
    assert.match(out, /EXISTS AND IS NOT COPIED/);
    assert.match(out, /indistinguishable/);
  });

  test('a manifest the project never references FAILS', () => {
    const { code, out } = run(fixture({ pbx: pbxEmpty() }));
    assert.equal(code, 1, out);
    assert.match(out, /no PBXFileReference names/);
  });

  test('a reason code with NO citation in the register FAILS', () => {
    const { code, out } = run(fixture({ manifest: manifestWith(['CA92.1']) }));
    assert.equal(code, 1, out);
    assert.match(out, /carries no citation for it/);
    assert.match(out, /ITMS-91056/);
  });

  test('the same code, cited with a source and a date, PASSES', () => {
    const { code, out } = run(fixture({ manifest: manifestWith(['CA92.1']), register: citing('CA92.1') }));
    assert.equal(code, 0, out);
  });

  // A citation without a real source is not a citation. Both halves are pinned,
  // because either alone would let an uncited code through.
  test('a citation with no source URL is not a citation', () => {
    const reg = { channels: [{ id: 'ios-appstore', privacyManifest: { approvedReasonCodes: { 'CA92.1': { fetched: '2026-08-20' } } } }] };
    const { code, out } = run(fixture({ manifest: manifestWith(['CA92.1']), register: reg }));
    assert.equal(code, 1, out);
  });

  test('a citation with no fetched date is not a citation', () => {
    const reg = { channels: [{ id: 'ios-appstore', privacyManifest: { approvedReasonCodes: { 'CA92.1': { source: 'https://developer.apple.com/x' } } } }] };
    const { code, out } = run(fixture({ manifest: manifestWith(['CA92.1']), register: reg }));
    assert.equal(code, 1, out);
  });

  test('an ABSENT manifest PRINTS and does not fail — the state today, owner-gated', () => {
    const { code, out } = run(fixture({ manifest: null }));
    assert.equal(code, 0, out);
    assert.match(out, /does not exist/);
    assert.match(out, /OWNER_QUEUE A-4/);
  });
});

// ── every way the scan could range over nothing ─────────────────────────────
describe('assert-privacy-manifest — a scan with no subject is never a pass', () => {
  test('no apps directory at all', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('an apps directory with no app in it', () => {
    const root = join(TMP, `noapps${seq++}`);
    mkdirSync(join(root, 'apps'), { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /holds no app directory/);
  });

  test('an app carrying NO Apple target is COVERAGE LOST, not clean', () => {
    const root = join(TMP, `noapple${seq++}`);
    mkdirSync(join(root, 'apps', 'subly', 'android'), { recursive: true });
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'channel-register.json'), '{"channels":[]}');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /no Apple target was found/);
  });

  test('an unreadable register is COVERAGE LOST', () => {
    const { code, out } = run(fixture({ register: '{ not json' }));
    assert.equal(code, 2, out);
    assert.match(out, /not valid JSON/);
  });
});
