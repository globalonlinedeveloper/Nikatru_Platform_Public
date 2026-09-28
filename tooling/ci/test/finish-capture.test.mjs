// ─────────────────────────────────────────────────────────────────────────────
// finish-capture.test.mjs — tooling/store/finish-capture.mjs re-derives every set
// whose register entry declares `derivedFrom` on the captured channel, prints each
// derived set's path and nothing else on stdout, and changes nothing on a second
// run (RC10). O-CAPTURE-LEAVES-DERIVED-SETS-STALE, AR-D3b, 2026-09-27.
//
// Each case builds its own temporary tree (fixtures/derived-sets-tree.mjs) and
// runs the script as a process, the way store-screenshots.yml runs it.
//
// Run:  node --single-threaded --test tooling/ci/test/finish-capture.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivationOrder } from '../../store/derived-sets.mjs';
import { makeTree, snapshot, frame, APP, PLAY, AGI } from './fixtures/derived-sets-tree.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINISH = join(REPO, 'tooling', 'store', 'finish-capture.mjs');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-derived-sets.mjs');
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 120_000 });

describe('finish-capture.mjs', () => {
  test('RC10: derives the two apps-gov-in sets, prints their paths, and a second run changes no byte', () => {
    const root = makeTree();
    try {
      const first = run(FINISH, '--app', APP, '--channel', 'android-play', root);
      assert.equal(first.status, 0, first.stderr);
      assert.deepEqual(first.stdout.trim().split('\n').sort(), [`${AGI}/screenshots`, `${AGI}/store-icon-512.png`]);
      const once = snapshot(root);
      assert.ok(once[`${AGI}/screenshots/01-home.png`] && once[`${AGI}/screenshots/CAPTURE.json`], 'the first run wrote no derived set');
      const second = run(FINISH, '--app', APP, '--channel', 'android-play', root);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(second.stdout, first.stdout);
      assert.deepEqual(snapshot(root), once);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the tree it leaves passes assert-derived-sets.mjs; a re-capture then fails it until finish runs again', () => {
    const root = makeTree();
    try {
      assert.equal(run(FINISH, '--app', APP, '--channel', 'android-play', root).status, 0);
      const green = run(GUARD, root);
      assert.equal(green.status, 0, green.stderr);
      writeFileSync(join(root, PLAY, 'screenshots', '02-calendar.png'), frame(9));
      const stale = run(GUARD, root);
      assert.equal(stale.status, 1, stale.stdout);
      assert.match(stale.stderr, /02-calendar\.png has changed since it was derived/);
      assert.equal(run(FINISH, '--app', APP, '--channel', 'android-play', root).status, 0);
      assert.equal(run(GUARD, root).status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a captured set holding frames and no CAPTURE.json is refused (exit 1), and nothing is derived', () => {
    const root = makeTree();
    try {
      rmSync(join(root, PLAY, 'screenshots', 'CAPTURE.json'));
      const r = run(FINISH, '--app', APP, '--channel', 'android-play', root);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /holds 4 frame\(s\) and no CAPTURE\.json/);
      assert.equal(r.stdout, '');
      assert.equal(existsSync(join(root, AGI, 'screenshots', 'CAPTURE.json')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a channel with no frame at all is refused (exit 1): there is no capture to finish', () => {
    const root = makeTree();
    try {
      const r = run(FINISH, '--app', APP, '--channel', 'linux-snap', root);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /no set of apps\/demo\/store\/linux-snap holds a frame/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a captured channel no set is derived from prints nothing and exits 0', () => {
    const root = makeTree();
    try {
      mkdirSync(join(root, 'apps', APP, 'store', 'linux-snap', 'screenshots'), { recursive: true });
      writeFileSync(join(root, 'apps', APP, 'store', 'linux-snap', 'screenshots', '01-home.png'), frame(1));
      writeFileSync(join(root, 'apps', APP, 'store', 'linux-snap', 'screenshots', 'CAPTURE.json'), '{"posture":"live"}\n');
      const r = run(FINISH, '--app', APP, '--channel', 'linux-snap', root);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /no set declares derivedFrom on linux-snap/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a derivedFrom naming a deriver that does not exist is COVERAGE LOST (exit 2)', () => {
    const root = makeTree({ edit: (r) => { r.storeMetadataContract.perChannel['apps-gov-in'].graphicAssets.derivedScreenshots.derivedFrom.deriver = 'tooling/ci/no-such-deriver.mjs'; } });
    try {
      const r = run(FINISH, '--app', APP, '--channel', 'android-play', root);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /COVERAGE LOST — the deriver tooling\/ci\/no-such-deriver\.mjs does not exist/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 declarations that derive the captured channel back from its own derivative are COVERAGE LOST (exit 2)', () => {
    const root = makeTree({
      edit: (r) => {
        r.storeMetadataContract.perChannel['android-play'].graphicAssets.mirror = { dir: 'mirror', derivedFrom: { channel: 'apps-gov-in', set: 'screenshots', deriver: 'tooling/ci/assert-apps-gov-in-media.mjs' } };
      },
    });
    try {
      const r = run(FINISH, '--app', APP, '--channel', 'android-play', root);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /cycle through the captured channel "android-play"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--app is required (exit 2)', () => {
    const r = run(FINISH, '--channel', 'android-play');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--app <app> is required/);
  });
});

describe('derivationOrder', () => {
  const e = (channel, from) => ({ channel, derivedFrom: { channel: from } });
  test('walks transitively, each channel after the channel it is made from', () => {
    assert.deepEqual(derivationOrder([e('c', 'b'), e('b', 'a'), e('z', 'y')], 'a'), ['b', 'c']);
  });
  test('reaches nothing from a channel no set is derived from', () => {
    assert.deepEqual(derivationOrder([e('b', 'a')], 'q'), []);
  });
  test('🔴 refuses a cycle among derived channels', () => {
    assert.throws(() => derivationOrder([e('b', 'a'), e('b', 'c'), e('c', 'b')], 'a'), /cycle among b, c/);
  });
});

// The deriver reads the record it wrote; a guard reading it must find the same keys.
test('the derived record carries derivation.sources for every Play frame and the icon', () => {
  const root = makeTree();
  try {
    assert.equal(run(FINISH, '--app', APP, '--channel', 'android-play', root).status, 0);
    const cap = JSON.parse(readFileSync(join(root, AGI, 'screenshots', 'CAPTURE.json'), 'utf8'));
    assert.deepEqual(cap.derivation.sources.map((s) => s.file), [
      `${PLAY}/screenshots/01-home.png`,
      `${PLAY}/screenshots/02-calendar.png`,
      `${PLAY}/screenshots/03-insights.png`,
      `${PLAY}/screenshots/04-budget.png`,
      `${PLAY}/store-icon-512.png`,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
