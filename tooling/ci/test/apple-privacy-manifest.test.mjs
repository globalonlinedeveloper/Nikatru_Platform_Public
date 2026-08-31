// ─────────────────────────────────────────────────────────────────────────────
// apple-privacy-manifest.test.mjs — assert-apple-privacy-manifest.mjs must be
// able to FAIL, and render-apple-privacy-manifest.mjs must round-trip.
//
// 🔴 EVERY TREE BELOW IS BUILT FROM THE REAL FILES AND THEN MUTATED. Nothing
// here is a hand-written fixture of what a privacy manifest "looks like": the
// audit, both `.xcprivacy` files, both `project.pbxproj` files,
// `.flutter-plugins-dependencies`, `data-safety.json` and `pubspec.lock` are
// COPIED from `apps/subly` and one thing is broken per case. The house rule is
// that a fixture agrees with whatever misunderstanding wrote it — a plist I
// typed would encode my idea of a plist, and the guard would then be tested
// against my idea rather than against Xcode's.
//
// ⚠️ AND EVERY MUTATION IS LAND-CHECKED BEFORE ITS EXIT CODE IS TRUSTED. The
// play-declarations run recorded two mutations that reported NOT CAUGHT because
// `.replace` had silently anchored on the wrong occurrence — the guard was right
// to stay quiet, and the test was wrong. `mutated()` below fails loudly when a
// replacement changed nothing, so a no-op mutation can never read as a weak
// limb.
//
// RECORDED MUTATION RUN — see the table in the suite `the limbs must bite`.
// Every case asserts a NON-ZERO exit AND the specific sentence that limb owns,
// because "some limb fired" is not evidence that THIS limb fired.
//
// Run:  node --test "tooling/ci/test/apple-privacy-manifest.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AUDIT_REL,
  MANIFEST_REL,
  PBXPROJ_REL,
  PLATFORMS,
  APP_TARGET_SOURCES,
  AppleManifestUnavailable,
  readAudit,
  renderAll,
  renderManifest,
} from '../../store/render-apple-privacy-manifest.mjs';
import { parsePlist, parsePbxproj } from '../assert-apple-privacy-manifest.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-apple-privacy-manifest.mjs');
const RENDERER = join(REPO, 'tooling', 'store', 'render-apple-privacy-manifest.mjs');
const APP = 'subly';

/** Everything the guard reads. Copied verbatim; the tests break one at a time. */
const SUBJECT_FILES = [
  ['pubspec.lock', 'pubspec.lock'],
  [`apps/${APP}/${AUDIT_REL}`, `apps/${APP}/${AUDIT_REL}`],
  [`apps/${APP}/store/android-play/data-safety.json`, `apps/${APP}/store/android-play/data-safety.json`],
  [`apps/${APP}/.flutter-plugins-dependencies`, `apps/${APP}/.flutter-plugins-dependencies`],
  ...PLATFORMS.map((p) => [`apps/${APP}/${MANIFEST_REL[p]}`, `apps/${APP}/${MANIFEST_REL[p]}`]),
  ...PLATFORMS.map((p) => [`apps/${APP}/${PBXPROJ_REL[p]}`, `apps/${APP}/${PBXPROJ_REL[p]}`]),
];

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-appleprivacy-'));
});
after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** A copy of the real subject tree. `mutate(root)` breaks exactly one thing. */
function tree(mutate) {
  const root = join(TMP, `t${seq++}`);
  for (const [from, to] of SUBJECT_FILES) {
    const src = join(REPO, from);
    assert.ok(existsSync(src), `subject file missing from the real tree: ${from}`);
    const dst = join(root, to);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  if (mutate) mutate(root);
  return root;
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
const write = (root, rel, text) => writeFileSync(join(root, rel), text);

/** Replace, and REFUSE to continue if nothing changed. A no-op mutation is a
 *  broken test, not a weak guard, and the difference is invisible unless you go
 *  and look. */
function mutated(text, from, to, what) {
  const next = typeof from === 'string' ? text.replace(from, to) : text.replace(from, to);
  assert.notEqual(next, text, `mutation did not land: ${what}`);
  return next;
}

/** Edit the audit and REGENERATE both manifests, so limb 1 stays green and the
 *  limb under test is the only thing that can fire. Without this every audit
 *  mutation would trip the byte comparison first and prove nothing about the
 *  limb it was written for. */
function editAuditAndRegenerate(root, edit) {
  const rel = `apps/${APP}/${AUDIT_REL}`;
  const audit = JSON.parse(read(root, rel));
  const before = JSON.stringify(audit);
  edit(audit);
  assert.notEqual(JSON.stringify(audit), before, 'audit mutation did not land');
  write(root, rel, `${JSON.stringify(audit, null, 2)}\n`);
  const rendered = renderAll(audit, APP);
  for (const p of PLATFORMS) write(root, `apps/${APP}/${MANIFEST_REL[p]}`, rendered[p]);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('render-apple-privacy-manifest.mjs — the generator round-trips', () => {
  test('the committed .xcprivacy files are BYTE-FOR-BYTE what the audit renders', () => {
    const { audit } = readAudit(join(REPO, 'apps', APP));
    const rendered = renderAll(audit, APP);
    for (const p of PLATFORMS) {
      const committed = readFileSync(join(REPO, 'apps', APP, MANIFEST_REL[p]), 'utf8');
      assert.equal(rendered[p], committed, `${MANIFEST_REL[p]} is not what the audit renders`);
    }
  });

  test('--check on the real tree exits 0', () => {
    const r = spawnSync(process.execPath, [RENDERER, '--app', APP, '--check'], {
      encoding: 'utf8',
      cwd: REPO,
    });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });

  test('the two platforms differ in EXACTLY two lines — the platform id and the source list', () => {
    const { audit } = readAudit(join(REPO, 'apps', APP));
    const ios = renderManifest(audit, 'ios', APP).split('\n');
    const macos = renderManifest(audit, 'macos', APP).split('\n');
    assert.equal(ios.length, macos.length);
    const differing = ios.map((l, i) => (l === macos[i] ? null : i)).filter((i) => i !== null);
    assert.equal(differing.length, 2, `expected 2 differing lines, got ${differing.length}`);
    assert.match(ios[differing[0]], /Platform: ios\./);
    assert.match(macos[differing[0]], /Platform: macos\./);
    for (const f of APP_TARGET_SOURCES.ios) assert.ok(ios[differing[1]].includes(f));
    for (const f of APP_TARGET_SOURCES.macos) assert.ok(macos[differing[1]].includes(f));
  });

  test('what it renders parses back to what the audit declares', () => {
    const { audit } = readAudit(join(REPO, 'apps', APP));
    for (const p of PLATFORMS) {
      const doc = parsePlist(renderManifest(audit, p, APP));
      assert.equal(doc.NSPrivacyTracking, audit.tracking.NSPrivacyTracking);
      assert.deepEqual(doc.NSPrivacyTrackingDomains, audit.tracking.NSPrivacyTrackingDomains);
      assert.deepEqual(
        doc.NSPrivacyCollectedDataTypes.map((r) => r.NSPrivacyCollectedDataType),
        audit.collectedDataTypes.rows.map((r) => r.type),
      );
      assert.deepEqual(
        doc.NSPrivacyCollectedDataTypes.map((r) => r.NSPrivacyCollectedDataTypeLinked),
        audit.collectedDataTypes.rows.map((r) => r.linked),
      );
      assert.deepEqual(
        doc.NSPrivacyCollectedDataTypes.map((r) => r.NSPrivacyCollectedDataTypePurposes),
        audit.collectedDataTypes.rows.map((r) => r.purposes),
      );
      assert.deepEqual(doc.NSPrivacyAccessedAPITypes, []);
    }
  });

  test('a NON-EMPTY accessedApiDetermination renders and parses back — U-1\'s remedy is not dead code', () => {
    const { audit } = readAudit(join(REPO, 'apps', APP));
    const withRow = JSON.parse(JSON.stringify(audit));
    withRow.accessedApiDetermination.ios = [
      { category: 'NSPrivacyAccessedAPICategorySystemBootTime', reasons: ['35F9.1'] },
    ];
    const text = renderManifest(withRow, 'ios', APP);
    const doc = parsePlist(text);
    assert.deepEqual(doc.NSPrivacyAccessedAPITypes, [
      {
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
        NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
      },
    ]);
    // And the header must stop claiming the array is empty.
    assert.ok(!text.includes('NSPrivacyAccessedAPITypes IS EMPTY BY MEASUREMENT'));
    assert.ok(text.includes('NSPrivacyAccessedAPITypes IS NON-EMPTY'));
  });

  test('readAudit REFUSES an audit that is absent, unparseable or vacuous', () => {
    const empty = join(TMP, 'no-audit');
    mkdirSync(empty, { recursive: true });
    assert.throws(() => readAudit(empty), AppleManifestUnavailable);

    const root = tree((r) => {
      const audit = JSON.parse(read(r, `apps/${APP}/${AUDIT_REL}`));
      audit.collectedDataTypes.rows = [];
      write(r, `apps/${APP}/${AUDIT_REL}`, `${JSON.stringify(audit, null, 2)}\n`);
    });
    assert.throws(() => readAudit(join(root, 'apps', APP)), (e) => {
      assert.ok(e instanceof AppleManifestUnavailable);
      assert.match(e.lines.join(' '), /declares no collectedDataTypes\.rows/);
      return true;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the readers parse structure, not prose', () => {
  test('the plist reader does not read the header comment as a declaration', () => {
    // The rendered header names UserDefaults, CA92.1 and 1C8F.1 in a sentence
    // explaining why they are NOT declared. A grep would conclude the opposite.
    const committed = readFileSync(join(REPO, 'apps', APP, MANIFEST_REL.ios), 'utf8');
    assert.ok(committed.includes('NSPrivacyAccessedAPICategoryUserDefaults') === false);
    assert.ok(committed.includes('CA92.1'), 'the header must still name CA92.1 in prose');
    assert.deepEqual(parsePlist(committed).NSPrivacyAccessedAPITypes, []);
  });

  test('the pbxproj reader finds BOTH native targets and both Resources phases', () => {
    const objects = parsePbxproj(readFileSync(join(REPO, 'apps', APP, PBXPROJ_REL.ios), 'utf8'));
    const targets = [...objects.values()].filter((o) => o.isa === 'PBXNativeTarget').map((o) => o.name);
    assert.deepEqual(targets.sort(), ['Runner', 'RunnerTests']);
    const phases = [...objects.values()].filter((o) => o.isa === 'PBXResourcesBuildPhase');
    assert.equal(phases.length, 2, 'the iOS project carries two Resources phases; the empty one is RunnerTests');
  });

  test('a settings dict re-using a target id does not overwrite the target', () => {
    // PBXProject carries `attributes = { TargetAttributes = { <targetId> = {…} } }`
    // and that inner block has no `isa`. It is not an object.
    const objects = parsePbxproj(readFileSync(join(REPO, 'apps', APP, PBXPROJ_REL.ios), 'utf8'));
    for (const o of objects.values()) assert.ok(o.isa, `object ${o.id} has no isa`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-apple-privacy-manifest.mjs — the positive controls', () => {
  test('the REAL repository passes', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, `the real tree must pass, got:\n${out}`);
  });

  test('an unmutated copy of the real subject files passes', () => {
    const { code, out } = run(tree(null));
    assert.equal(code, 0, `the baseline copy must pass, got:\n${out}`);
  });

  test('it PRINTS what it cannot see on every run, in the audit\'s own words', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0);
    assert.match(out, /CANNOT SEE — THE COCOAPODS CLOSURE/);
    assert.match(out, /Sentry\/HybridSDK 8\.58\.4/);
    assert.match(out, /CANNOT SEE — THE BUILT BUNDLE/);
    assert.match(out, /UNRESOLVED U-1/);
    assert.match(out, /objc_msgSend/);
  });

  test('it WARNS, and does not fail, on constants whose witness is `knowledge`', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0);
    assert.match(out, /witness `knowledge`/);
    assert.match(out, /collectedDataType NSPrivacyCollectedDataTypeCoarseLocation/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the limbs must bite', () => {
  // ── limb 1 ────────────────────────────────────────────────────────────────
  test('limb 1 — a HAND-EDITED .xcprivacy is a build failure', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${MANIFEST_REL.ios}`;
      write(
        r,
        rel,
        mutated(
          read(r, rel),
          '<string>NSPrivacyCollectedDataTypeCoarseLocation</string>',
          '<string>NSPrivacyCollectedDataTypePreciseLocation</string>',
          'hand-edit the iOS manifest',
        ),
      );
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /is NOT what .* renders — first difference at line/);
  });

  test('limb 1 — a hand-edited macOS manifest is caught too, not just iOS', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${MANIFEST_REL.macos}`;
      write(r, rel, mutated(read(r, rel), '<array/>\n</dict>', '<array>\n\t</array>\n</dict>', 'macOS body edit'));
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /macos\/Runner\/PrivacyInfo\.xcprivacy is NOT what/);
  });

  test('limb 1 — a DELETED manifest is a failure, not a skip', () => {
    const root = tree((r) => rmSync(join(r, 'apps', APP, MANIFEST_REL.macos)));
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /macos\/Runner\/PrivacyInfo\.xcprivacy does not exist/);
  });

  // ── limb 2 ────────────────────────────────────────────────────────────────
  test('limb 2 — the pbxproj REFERENCE removed', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${PBXPROJ_REL.ios}`;
      const before = read(r, rel);
      const after = before
        .split('\n')
        .filter((l) => !l.includes('PrivacyInfo.xcprivacy'))
        .join('\n');
      assert.notEqual(after, before, 'mutation did not land: strip the xcprivacy references');
      write(r, rel, after);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /contains no PBXFileReference for PrivacyInfo\.xcprivacy/);
  });

  // 🔴 THE MISTAKE THAT MATTERS. The string is still in the file, the file
  // reference still exists, the build file still exists — and the app bundle
  // gets nothing, because the only Resources phase naming it is RunnerTests'.
  test('limb 2 — the reference present but ONLY in the RunnerTests Resources phase', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${PBXPROJ_REL.ios}`;
      let text = read(r, rel);
      const memberLine = text
        .split('\n')
        .find((l) => /PrivacyInfo\.xcprivacy in Resources \*\/,\s*$/.test(l));
      assert.ok(memberLine, 'could not find the Runner Resources membership line');
      text = mutated(text, `${memberLine}\n`, '', 'remove the membership line from the Runner phase');
      // The EMPTY PBXResourcesBuildPhase is RunnerTests' — put it there instead.
      text = mutated(
        text,
        /(isa = PBXResourcesBuildPhase;\n\t{3}buildActionMask = 2147483647;\n\t{3}files = \(\n)(\t{3}\);)/,
        `$1${memberLine}\n$2`,
        'insert the membership line into the RunnerTests phase',
      );
      write(r, rel, text);
      const after = read(r, rel);
      assert.ok(after.includes('PrivacyInfo.xcprivacy'), 'the string must still be present — that is the point');
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /is NOT in the Runner target's PBXResourcesBuildPhase/);
    assert.match(out, /SILENT HALF/);
  });

  test('limb 2 — the macOS manifest dropped from the Runner Resources phase', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${PBXPROJ_REL.macos}`;
      const text = read(r, rel);
      const memberLine = text.split('\n').find((l) => /PrivacyInfo\.xcprivacy in Resources \*\/,\s*$/.test(l));
      assert.ok(memberLine, 'could not find the macOS Runner Resources membership line');
      write(r, rel, mutated(text, `${memberLine}\n`, '', 'drop the macOS membership line'));
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /is NOT in the Runner target's PBXResourcesBuildPhase/);
  });

  test('limb 2 — the header\'s source-file set must match the Runner Sources phase', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${PBXPROJ_REL.ios}`;
      const text = read(r, rel);
      const line = text.split('\n').find((l) => /SceneDelegate\.swift in Sources \*\/,\s*$/.test(l));
      assert.ok(line, 'could not find the SceneDelegate Sources line');
      write(r, rel, mutated(text, `${line}\n`, '', 'drop SceneDelegate from the Sources phase'));
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /the ios manifest header says the app target's own code is/);
  });

  // ── limb 3 ────────────────────────────────────────────────────────────────
  test('limb 3 — an INVENTED accessed-API category', () => {
    const root = tree((r) =>
      editAuditAndRegenerate(r, (a) => {
        a.accessedApiDetermination.ios = [
          { category: 'NSPrivacyAccessedAPICategoryTelepathy', reasons: ['35F9.1'] },
        ];
      }),
    );
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /NSPrivacyAccessedAPICategoryTelepathy`, which is not in the audit's vocabulary/);
  });

  test('limb 3 — a reason code declared under the WRONG category', () => {
    const root = tree((r) =>
      editAuditAndRegenerate(r, (a) => {
        // CA92.1 is real, and it belongs to UserDefaults, not SystemBootTime.
        a.accessedApiDetermination.macos = [
          { category: 'NSPrivacyAccessedAPICategorySystemBootTime', reasons: ['CA92.1'] },
        ];
      }),
    );
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /reason code `CA92\.1` under `NSPrivacyAccessedAPICategorySystemBootTime`/);
    assert.match(out, /belongs to `NSPrivacyAccessedAPICategoryUserDefaults`/);
  });

  test('limb 3 — an INVENTED reason code', () => {
    const root = tree((r) =>
      editAuditAndRegenerate(r, (a) => {
        a.accessedApiDetermination.ios = [
          { category: 'NSPrivacyAccessedAPICategorySystemBootTime', reasons: ['ZZ99.9'] },
        ];
      }),
    );
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /reason code `ZZ99\.9`, which is not in the audit's vocabulary\.reasonCodes/);
  });

  test('limb 3 — an INVENTED purpose string', () => {
    const root = tree((r) =>
      editAuditAndRegenerate(r, (a) => {
        a.collectedDataTypes.rows[0].purposes = ['NSPrivacyCollectedDataTypePurposeVibes'];
      }),
    );
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /purpose `NSPrivacyCollectedDataTypePurposeVibes`/);
  });

  // ── limb 4 ────────────────────────────────────────────────────────────────
  test('limb 4 — a NEW plugin with no inventory row: "nobody said what required-reason APIs this uses"', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/.flutter-plugins-dependencies`;
      const fpd = JSON.parse(read(r, rel));
      fpd.plugins.ios.push({
        name: 'camera_avfoundation',
        path: '/pub-cache/hosted/pub.dev/camera_avfoundation-0.9.0/',
        native_build: true,
        dependencies: [],
        dev_dependency: false,
      });
      write(r, rel, `${JSON.stringify(fpd)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /camera_avfoundation is linked into the build/);
    assert.match(out, /nobody said what required-reason APIs this uses/);
  });

  test('limb 4 — EQUALITY, not subset: an inventory row the build no longer links', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/.flutter-plugins-dependencies`;
      const fpd = JSON.parse(read(r, rel));
      const before = fpd.plugins.macos.length;
      fpd.plugins.macos = fpd.plugins.macos.filter((p) => p.name !== 'in_app_review');
      assert.equal(fpd.plugins.macos.length, before - 1, 'mutation did not land: drop in_app_review');
      write(r, rel, `${JSON.stringify(fpd)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /declares in_app_review, which the build no longer links/);
  });

  test('limb 4 — a plugin VERSION bump the audit never read', () => {
    const root = tree((r) => {
      const text = read(r, 'pubspec.lock');
      write(
        r,
        'pubspec.lock',
        mutated(
          text,
          /(  app_links:\n(?:.*\n)*?    version: ")7\.2\.1(")/,
          '$17.9.9$2',
          'bump app_links in pubspec.lock',
        ),
      );
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /audits app_links 7\.2\.1 and pubspec\.lock resolves app_links 7\.9\.9/);
  });

  // ── limb 5 ────────────────────────────────────────────────────────────────
  test('limb 5 — a Play row FLIPPED without this file moving is a contradiction', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/store/android-play/data-safety.json`;
      const ds = JSON.parse(read(r, rel));
      const victim = ds.answers.find((a) => a.collected?.['backend-live'] === false);
      assert.ok(victim, 'no un-collected Play row to flip');
      victim.collected['backend-live'] = true;
      write(r, rel, `${JSON.stringify(ds, null, 2)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /the two sworn declarations CONTRADICT each other/);
    assert.match(out, /Play says collected, Apple does not declare/);
  });

  test('limb 5 — an Apple row whose fromPlayRow the Play file does not collect', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/store/android-play/data-safety.json`;
      const ds = JSON.parse(read(r, rel));
      const victim = ds.answers.find((a) => a.type === 'Crash logs');
      assert.ok(victim, 'the Crash logs row is expected in the Play declaration');
      victim.collected['backend-live'] = false;
      write(r, rel, `${JSON.stringify(ds, null, 2)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /Apple names fromPlayRow, Play does not collect: Crash logs/);
  });

  test('limb 5 — the two files answering for DIFFERENT build postures', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/store/android-play/data-safety.json`;
      const ds = JSON.parse(read(r, rel));
      ds.buildPosture.current = 'demo';
      write(r, rel, `${JSON.stringify(ds, null, 2)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /answers for posture `backend-live` and .* builds `demo`/);
  });

  test('limb 5 — a fromPlayRow that names no Play row at all', () => {
    const root = tree((r) =>
      editAuditAndRegenerate(r, (a) => {
        a.collectedDataTypes.rows[0].fromPlayRow = 'Telepathic impressions';
      }),
    );
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /which is not a row in .* at all/);
  });

  // ── limb 6 ────────────────────────────────────────────────────────────────
  test('limb 6 — NSPrivacyTrackingDomains non-empty while NSPrivacyTracking is false', () => {
    const root = tree((r) =>
      editAuditAndRegenerate(r, (a) => {
        a.tracking.NSPrivacyTrackingDomains = ['telemetry.example.com'];
      }),
    );
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /NSPrivacyTracking false AND 1 NSPrivacyTrackingDomains/);
    assert.match(out, /only the PAIR is checkable/);
  });

  test('limb 6 — a row used for TRACKING while the app swears it does not track', () => {
    const root = tree((r) =>
      editAuditAndRegenerate(r, (a) => {
        a.collectedDataTypes.rows.find((x) => x.type === 'NSPrivacyCollectedDataTypeDeviceID').tracking = true;
      }),
    );
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /NSPrivacyCollectedDataTypeDeviceID` is used for TRACKING while NSPrivacyTracking is false/);
  });

  // ── limb 7 ────────────────────────────────────────────────────────────────
  test('limb 7 — a SUBJECT-FREE tree REFUSES', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /apps does not exist/);
  });

  test('limb 7 — apps/ with no audit in it REFUSES rather than printing ok over nothing', () => {
    const root = join(TMP, `noaudit${seq++}`);
    mkdirSync(join(root, 'apps', 'ghost'), { recursive: true });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /NOT ONE carries store\/ios-appstore\/privacy-manifest\.json/);
  });

  test('limb 7 — an audit with NO collected rows REFUSES', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${AUDIT_REL}`;
      const audit = JSON.parse(read(r, rel));
      audit.collectedDataTypes.rows = [];
      write(r, rel, `${JSON.stringify(audit, null, 2)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares no collectedDataTypes\.rows/);
  });

  test('limb 7 — an EMPTY binaryInventory REFUSES', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${AUDIT_REL}`;
      const audit = JSON.parse(read(r, rel));
      audit.binaryInventory.macos = [];
      write(r, rel, `${JSON.stringify(audit, null, 2)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /declares an empty binaryInventory\.macos/);
  });

  test('limb 7 — a missing .flutter-plugins-dependencies REFUSES rather than skipping limb 4', () => {
    const root = tree((r) => rmSync(join(r, 'apps', APP, '.flutter-plugins-dependencies')));
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /flutter-plugins-dependencies does not exist/);
  });

  test('limb 7 — a missing data-safety.json REFUSES rather than skipping limb 5', () => {
    const root = tree((r) => rmSync(join(r, 'apps', APP, 'store', 'android-play', 'data-safety.json')));
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /data-safety\.json does not exist/);
  });

  test('limb 7 — an empty closed vocabulary REFUSES (a membership test against nothing cannot fail)', () => {
    const root = tree((r) => {
      const rel = `apps/${APP}/${AUDIT_REL}`;
      const audit = JSON.parse(read(r, rel));
      audit.vocabulary.purposes.values = [];
      write(r, rel, `${JSON.stringify(audit, null, 2)}\n`);
    });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /enumerates no vocabulary\.purposes\.values/);
  });
});
