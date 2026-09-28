// ─────────────────────────────────────────────────────────────────────────────
// derived-sets.test.mjs — tooling/ci/assert-derived-sets.mjs refuses a derived
// listing set whose recorded sources no longer match the tree, a declaration it
// cannot run, and a screenshot README that restates its CAPTURE.json.
// O-CAPTURE-LEAVES-DERIVED-SETS-STALE, AR-D3b, 2026-09-27.
//
//   RC6  one Play frame's bytes change, the apps-gov-in set does not  -> 1, naming
//        `node tooling/store/finish-capture.mjs --app demo --channel android-play`
//   RC8  derivedFrom.deriver names a file that does not exist         -> 2
//   RC9  `1080x1920` written into the Play screenshots README          -> 1
//
// Each case builds its own temporary tree (fixtures/derived-sets-tree.mjs),
// derives it with tooling/store/finish-capture.mjs, mutates it, and runs the
// guard as a process. No image is decoded by the guard.
//
// Run:  node --single-threaded --test tooling/ci/test/derived-sets.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTree, frame, image, APP, PLAY, AGI } from './fixtures/derived-sets-tree.mjs';
import { encodeRgba } from '../../store/png-codec.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINISH = join(REPO, 'tooling', 'store', 'finish-capture.mjs');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-derived-sets.mjs');
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 120_000 });
const REDO = `node tooling/store/finish-capture.mjs --app ${APP} --channel android-play`;

/** A tree whose apps-gov-in sets were just derived. */
function derivedTree(opts) {
  const root = makeTree(opts);
  const r = run(FINISH, '--app', APP, '--channel', 'android-play', root);
  assert.equal(r.status, 0, r.stderr);
  return root;
}

describe('assert-derived-sets.mjs', () => {
  test('a freshly derived tree is green, and says what it compared', () => {
    const root = derivedTree();
    try {
      const r = run(GUARD, root);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /ok — 2 derived set\(s\), 1 deriver\(s\), 5 source hash\(es\) current across 2 tree\(s\); 2 screenshot README\(s\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 RC6: a Play frame changed under an unchanged apps-gov-in set exits 1, naming the finish command', () => {
    const root = derivedTree();
    try {
      writeFileSync(join(root, PLAY, 'screenshots', '03-insights.png'), frame(7));
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /apps\/demo\/store\/apps-gov-in\/screenshots is STALE: apps\/demo\/store\/android-play\/screenshots\/03-insights\.png has changed since it was derived/);
      assert.ok(r.stderr.includes(`Run \`${REDO}\``), r.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a changed Play store icon under an unchanged apps-gov-in icon exits 1', () => {
    const root = derivedTree();
    try {
      writeFileSync(join(root, PLAY, 'store-icon-512.png'), encodeRgba(image(8, 8, () => [1, 2, 3, 255])));
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /apps-gov-in\/store-icon-512\.png is STALE: apps\/demo\/store\/android-play\/store-icon-512\.png has changed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a frame added to the Play set that was never derived from exits 1', () => {
    const root = derivedTree();
    try {
      writeFileSync(join(root, PLAY, 'screenshots', '05-extra.png'), frame(5));
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /05-extra\.png is in the source set and was never derived from/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a record with no derivation.sources exits 1', () => {
    const root = derivedTree();
    try {
      const at = join(root, AGI, 'screenshots', 'CAPTURE.json');
      const cap = JSON.parse(readFileSync(at, 'utf8'));
      delete cap.derivation.sources;
      writeFileSync(at, JSON.stringify(cap));
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /records no derivation\.sources/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 RC8: a derivedFrom naming a deriver that does not exist is COVERAGE LOST (exit 2)', () => {
    const root = derivedTree();
    try {
      const at = join(root, 'tooling', 'channel-register.json');
      const reg = JSON.parse(readFileSync(at, 'utf8'));
      reg.storeMetadataContract.perChannel['apps-gov-in'].graphicAssets.derivedScreenshots.derivedFrom.deriver = 'tooling/ci/no-such-deriver.mjs';
      writeFileSync(at, JSON.stringify(reg));
      const r = run(GUARD, root);
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /COVERAGE LOST — the deriver tooling\/ci\/no-such-deriver\.mjs does not exist/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a deriver that exports no DERIVER { write, check } is COVERAGE LOST (exit 2)', () => {
    const root = derivedTree();
    try {
      const at = join(root, 'tooling', 'channel-register.json');
      const reg = JSON.parse(readFileSync(at, 'utf8'));
      reg.storeMetadataContract.perChannel['apps-gov-in'].graphicAssets.assets['store-icon-512.png'].derivedFrom.deriver = 'tooling/store/png-codec.mjs';
      writeFileSync(at, JSON.stringify(reg));
      const r = run(GUARD, root);
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /tooling\/store\/png-codec\.mjs exports no DERIVER \{ write, check \}/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a set carrying both generatedBy and derivedFrom exits 1', () => {
    const root = derivedTree();
    try {
      const at = join(root, 'tooling', 'channel-register.json');
      const reg = JSON.parse(readFileSync(at, 'utf8'));
      reg.storeMetadataContract.perChannel['apps-gov-in'].graphicAssets.assets['store-icon-512.png'].generatedBy = 'tooling/ci/assert-apps-gov-in-media.mjs';
      writeFileSync(at, JSON.stringify(reg));
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /carries BOTH `generatedBy`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a register declaring no derivedFrom at all is COVERAGE LOST (exit 2)', () => {
    const root = derivedTree();
    try {
      const at = join(root, 'tooling', 'channel-register.json');
      const reg = JSON.parse(readFileSync(at, 'utf8'));
      delete reg.storeMetadataContract.perChannel['apps-gov-in'].graphicAssets.derivedScreenshots;
      delete reg.storeMetadataContract.perChannel['apps-gov-in'].graphicAssets.assets['store-icon-512.png'].derivedFrom;
      writeFileSync(at, JSON.stringify(reg));
      const r = run(GUARD, root);
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /declares no derivedFrom/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 an app whose derived sets were never derived checks nothing: COVERAGE LOST (exit 2)', () => {
    const root = makeTree();
    try {
      const r = run(GUARD, root);
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stdout, /not derived yet/);
      assert.match(r.stderr, /0 recorded source\(s\) checked/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 RC9: `1080x1920` written into the Play screenshots README exits 1', () => {
    const root = derivedTree();
    try {
      appendFileSync(join(root, PLAY, 'screenshots', 'README.md'), '\nEvery frame is 1080x1920.\n');
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /android-play\/screenshots\/README\.md restates pixels 1080x1920/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 the same size spelled with × and spaces is refused too', () => {
    const root = derivedTree();
    try {
      appendFileSync(join(root, PLAY, 'screenshots', 'README.md'), '\n| 01-home.png | 1080 × 1920 |\n');
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /restates pixels 1080x1920/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a README restating the recorded count next to its field name exits 1', () => {
    const root = derivedTree();
    try {
      appendFileSync(join(root, AGI, 'screenshots', 'README.md'), '\nThe record says `count: 4`.\n');
      const r = run(GUARD, root);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, /apps-gov-in\/screenshots\/README\.md restates count 4/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a README naming a size its record does not hold is not a restatement', () => {
    const root = derivedTree();
    try {
      appendFileSync(join(root, PLAY, 'screenshots', 'README.md'), '\nPlay asks for at least 1080 pixels; 10801x1920 is not this.\n');
      const r = run(GUARD, root);
      assert.equal(r.status, 0, r.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
