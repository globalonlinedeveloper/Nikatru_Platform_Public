// ─────────────────────────────────────────────────────────────────────────────
// derive-site-shots.test.mjs — the site's copies follow a re-captured frame
// (tooling/sites/derive-site-shots.mjs), with ImageMagick replaced by a fake that
// records the argument vector and writes bytes, so the run needs no image tool.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DeriveRefused, commandFor, derive, nextVersion, plan } from '../../sites/derive-site-shots.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const COMMAND = 'convert <from> -strip -filter Lanczos -resize 540x960 -quality 72 -define webp:method=6 sites/nikatru/apps/shots/<slug>-<N>-v<V>.webp';
const FRAME = 'apps/demo/store/android-play/screenshots/01-home.png';
const FRAME2 = 'apps/demo/store/android-play/screenshots/02-calendar.png';

/** A tree with two frames and their two v2 web copies, both current. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'nk-site-shots-'));
  mkdirSync(join(root, 'apps/demo/store/android-play/screenshots'), { recursive: true });
  mkdirSync(join(root, 'sites/nikatru/apps/shots'), { recursive: true });
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, FRAME), 'frame-1-old');
  writeFileSync(join(root, FRAME2), 'frame-2');
  writeFileSync(join(root, 'sites/nikatru/apps/shots/demo-1-v2.webp'), 'web-1-old');
  writeFileSync(join(root, 'sites/nikatru/apps/shots/demo-2-v2.webp'), 'web-2');
  const record = {
    derivation: { command: COMMAND },
    shots: [
      { file: 'sites/nikatru/apps/shots/demo-1-v2.webp', sha256: sha('web-1-old'), bytes: 9, from: FRAME, sourceSha256: sha('frame-1-old') },
      { file: 'sites/nikatru/apps/shots/demo-2-v2.webp', sha256: sha('web-2'), bytes: 5, from: FRAME2, sourceSha256: sha('frame-2') },
    ],
  };
  writeFileSync(join(root, 'tooling/site-shots.json'), `${JSON.stringify(record, null, 2)}\n`);
  return root;
}

/** The fake `convert`: writes "<from bytes>→webp" at the output path. */
function fakeConvert(calls) {
  return (argv, root) => {
    calls.push(argv);
    const from = argv[1];
    writeFileSync(join(root, argv[argv.length - 1]), `${readFileSync(join(root, from), 'utf8')}->webp`);
    return { ok: true };
  };
}

describe('derive-site-shots', () => {
  test('a web name gets the next version; a name without one gets none', () => {
    assert.equal(nextVersion('sites/nikatru/apps/shots/subscriptiontracker-4-v2.webp'), 'sites/nikatru/apps/shots/subscriptiontracker-4-v3.webp');
    assert.equal(nextVersion('sites/nikatru/apps/shots/subscriptiontracker-4.webp'), null);
  });

  test('the record command becomes an argument vector: <from> and the output substituted, nothing else', () => {
    assert.deepEqual(commandFor(COMMAND, FRAME, 'out.webp'), [
      'convert', FRAME, '-strip', '-filter', 'Lanczos', '-resize', '540x960', '-quality', '72', '-define', 'webp:method=6', 'out.webp',
    ]);
    assert.equal(commandFor('convert in out', FRAME, 'x'), null, 'a command with no <from> is refused');
  });

  test('a tree whose frames are unchanged derives nothing and writes nothing', () => {
    const root = tree();
    try {
      const before = readFileSync(join(root, 'tooling/site-shots.json'), 'utf8');
      const calls = [];
      const r = derive(root, { convert: fakeConvert(calls), render: () => assert.fail('render ran with nothing stale') });
      assert.deepEqual(r.changed, []);
      assert.equal(calls.length, 0);
      assert.equal(readFileSync(join(root, 'tooling/site-shots.json'), 'utf8'), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a re-captured frame gets a NEW versioned copy, the old one goes, and the entry is re-recorded', () => {
    const root = tree();
    try {
      writeFileSync(join(root, FRAME), 'frame-1-new');
      assert.equal(plan(root).stale.length, 1);
      const calls = [];
      const r = derive(root, { convert: fakeConvert(calls), render: () => ['sites/nikatru/apps/demo.html'] });
      assert.equal(calls.length, 1, 'only the stale entry is re-derived');
      assert.equal(calls[0].at(-1), 'sites/nikatru/apps/shots/demo-1-v3.webp');
      assert.equal(existsSync(join(root, 'sites/nikatru/apps/shots/demo-1-v2.webp')), false, 'the old copy is still served');
      assert.equal(readFileSync(join(root, 'sites/nikatru/apps/shots/demo-2-v2.webp'), 'utf8'), 'web-2', 'an unchanged copy was touched');
      const rec = JSON.parse(readFileSync(join(root, 'tooling/site-shots.json'), 'utf8'));
      const e = rec.shots[0];
      assert.equal(e.file, 'sites/nikatru/apps/shots/demo-1-v3.webp');
      assert.equal(e.sourceSha256, sha('frame-1-new'));
      assert.equal(e.sha256, sha('frame-1-new->webp'));
      assert.equal(e.bytes, Buffer.byteLength('frame-1-new->webp'));
      assert.equal(rec.shots[1].file, 'sites/nikatru/apps/shots/demo-2-v2.webp');
      assert.deepEqual(r.changed, ['sites/nikatru/apps/demo.html', 'sites/nikatru/apps/shots', 'tooling/site-shots.json']);
      assert.equal(plan(root).stale.length, 0, 'the tree is still stale after the derivation');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 a derivation that fails keeps the old copy and the record as they were', () => {
    const root = tree();
    try {
      writeFileSync(join(root, FRAME), 'frame-1-new');
      const before = readFileSync(join(root, 'tooling/site-shots.json'), 'utf8');
      assert.throws(
        () => derive(root, { convert: () => ({ ok: false, err: 'no decode delegate for WEBP' }), render: () => [] }),
        (e) => e instanceof DeriveRefused && e.code === 1 && /no decode delegate/.test(e.lines[0]),
      );
      assert.equal(existsSync(join(root, 'sites/nikatru/apps/shots/demo-1-v2.webp')), true);
      assert.equal(readFileSync(join(root, 'tooling/site-shots.json'), 'utf8'), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unreadable or empty record is COVERAGE LOST (exit 2), never a clean run', () => {
    const root = tree();
    try {
      writeFileSync(join(root, 'tooling/site-shots.json'), '{"shots": []}');
      assert.throws(() => plan(root), (e) => e instanceof DeriveRefused && e.code === 2);
      writeFileSync(join(root, 'tooling/site-shots.json'), 'not json');
      assert.throws(() => plan(root), (e) => e instanceof DeriveRefused && e.code === 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the real record is current against the frames on disk, or names what is stale', () => {
    // Not a pass/fail on the tree's state (a re-capture PR carries both halves):
    // the real record must PARSE and every `from` must exist.
    const repo = join(import.meta.dirname, '..', '..', '..');
    const { stale, record } = plan(repo);
    assert.ok(Array.isArray(record.shots) && record.shots.length >= 1);
    assert.ok(Array.isArray(stale));
  });
});
