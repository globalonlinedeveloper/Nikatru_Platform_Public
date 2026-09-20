// local-chromedriver.test.mjs — the version the catalogue hands back becomes a
// directory this script SPAWNS a binary out of, so it is constrained to what a
// version may look like before it is allowed anywhere near a path.
//
// WHY THIS SUITE EXISTS. CodeQL raised js/command-line-injection as CRITICAL
// against `local-chromedriver.mjs` on 2026-09-20: `build.version` is read out of
// the Chrome-for-Testing JSON — remote data — and every path below it is joined
// from that string, including the one `reportDriver` executes. A catalogue entry
// (or anything able to sit in front of it) spelling a traversal would be
// normalised by `join` and RUN.
//
// 🔴 AND THE CHECKSUM DOES NOT COVER IT. The downloaded zip is verified against
// the size and MD5 Google publishes for the object, but the "already installed"
// branch reaches the spawn with no download and no checksum in the way at all —
// it finds a path, sees a file, and runs it. So the defence has to be on the
// STRING, before it becomes a path, which is what `isPlainVersion` is.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.NIKATRU_LOCAL_CHROMEDRIVER_IMPORT_ONLY = '1';
const { isPlainVersion, versionPath, pickBuild } = await import('../../store/local-chromedriver.mjs');

describe('versionPath — the name is rebuilt from numbers, not sliced from their string', () => {
  test('a real version round-trips unchanged', () => {
    for (const v of ['153.0.8010.52', '153.0.8010', '153.0', '153']) {
      assert.equal(versionPath(v), v);
    }
  });

  test('🔴 leading zeros are NORMALISED, which proves the output is rebuilt', () => {
    // If the original string were being passed through, this would come back
    // as "153.00.08010.052". It does not, because each group went through
    // Number() and the name is joined from what THIS process produced — the
    // property that makes the path safe without trusting a regex.
    assert.equal(versionPath('153.00.08010.052'), '153.0.8010.52');
  });

  test('a traversal or any non-digit group THROWS rather than returning a usable name', () => {
    for (const v of ['../../etc', '153.0/../..', '..\\..\\Windows', '153.x', '153.0.8010.52.1', '']) {
      assert.throws(() => versionPath(v), /not a version/, `${JSON.stringify(v)} must throw`);
    }
  });

  test('the output can only contain digits and dots, whatever went in', () => {
    assert.match(versionPath('153.0.8010.52'), /^[0-9.]+$/);
  });
});

describe('isPlainVersion — only a version may become a path', () => {
  test('the shapes Chrome-for-Testing really publishes are accepted', () => {
    for (const v of ['153.0.8010.52', '153.0.8010', '153.0', '153']) {
      assert.equal(isPlainVersion(v), true, `${v} is a version and must be accepted`);
    }
  });

  test('🔴 a traversal is REFUSED — this is the case the rule exists for', () => {
    // Each of these, joined under the install base, escapes it. The last two are
    // the Windows forms, which are the ones that matter on the machine this
    // script was written for.
    for (const v of [
      '../../../../usr/bin/env',
      '..\\..\\..\\Windows\\System32\\calc',
      '..',
      'C:\\Windows\\System32',
      '/etc',
    ]) {
      assert.equal(isPlainVersion(v), false, `${v} must never become part of a spawned path`);
    }
  });

  test('anything that is not a bare version is refused, including the near misses', () => {
    for (const v of ['153.0.8010.52 ', '', '153..0', 'v153.0', '153.0.8010.52.1', '1.2.3.4.5']) {
      assert.equal(isPlainVersion(v), false, `${JSON.stringify(v)} must be refused`);
    }
  });

  test('a non-string — a JSON number, null, an object — is refused rather than coerced', () => {
    // The catalogue is parsed JSON, so `version` can arrive as any JSON type.
    // `String(153)` would look like a version; the guard must not get there.
    for (const v of [153, null, undefined, { toString: () => '153.0' }, ['153.0']]) {
      assert.equal(isPlainVersion(v), false, `${JSON.stringify(v) ?? typeof v} must be refused`);
    }
  });
});

describe('pickBuild — the highest catalogued build sharing the major', () => {
  const catalogue = {
    versions: [
      { version: '153.0.8010.47', downloads: { chromedriver: [{ platform: 'win64', url: 'u47' }] } },
      { version: '153.0.8010.52', downloads: { chromedriver: [{ platform: 'win64', url: 'u52' }] } },
      { version: '152.0.1.1', downloads: { chromedriver: [{ platform: 'win64', url: 'u152' }] } },
      // No win64 download: present in the catalogue, unusable here.
      { version: '153.9.9.9', downloads: { chromedriver: [{ platform: 'linux64', url: 'ulnx' }] } },
    ],
  };

  test('picks the highest build of the asked-for major, not the highest overall', () => {
    assert.deepEqual(pickBuild(catalogue, '153', 'win64'), { version: '153.0.8010.52', url: 'u52' });
  });

  test('a build with no download for this platform is not picked, however high', () => {
    // 153.9.9.9 sorts above every win64 row and must still lose, or the caller
    // would be handed a row whose `url` is undefined.
    assert.equal(pickBuild(catalogue, '153', 'win64').version, '153.0.8010.52');
  });

  test('a major nobody publishes answers null rather than the nearest thing', () => {
    assert.equal(pickBuild(catalogue, '999', 'win64'), null);
  });

  test('an empty or absent catalogue answers null rather than throwing', () => {
    assert.equal(pickBuild({ versions: [] }, '153', 'win64'), null);
    assert.equal(pickBuild({}, '153', 'win64'), null);
  });
});
