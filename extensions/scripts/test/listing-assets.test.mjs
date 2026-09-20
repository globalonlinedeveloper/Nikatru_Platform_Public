/* listing-assets.test.mjs — check-listing-assets.mjs must be able to FAIL, and
   fail for the RIGHT reason.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node --test extensions/scripts/test/listing-assets.test.mjs

   A guard over pictures is unusually easy to write vacuously: "the file is
   there" passes over a 1279-pixel crop, a JPEG renamed .png and an icon with no
   alpha channel, and every one of those is an upload rejection. So every case
   below breaks ONE property of a tree that is otherwise complete, and asserts
   both the exit code and the sentence — an exit 1 that came from a different
   limb would otherwise read as proof.

   THE SUBJECT IS A COPY OF THE REAL LISTING TREE, not a hand-built stub. The
   fixture copies the tool's own tool.json, manifest.json, icons and store/ into
   a temp root and points the guard at it with --repo-root, which every gate in
   `scripts/` supports for exactly this reason. Only the screenshot images are
   synthesised, so that these cases do not depend on whether anybody has run
   publish/shots.mjs on this machine today.

   ⚠️ REAL-TREE MUTATIONS, recorded because a fixture passing is not a guard
   working. Run on this worktree, green control first, restored byte-exact
   afterwards — see the lane report for the exit codes.

   Exit codes under test: 0 everything agrees · 1 something disagrees ·
   2 could not run. */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, unlinkSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { encode } from '../lib/png.mjs';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = resolve(SCRIPTS, '..');
const GUARD = join(SCRIPTS, 'check-listing-assets.mjs');
const TOOL_REL = join('Extension', 'Full_Screen_Shot');
const REAL_TOOL = join(EXTENSIONS, TOOL_REL);

/* Everything loadTool() needs to resolve the tool, plus the subject itself.
   test/ is excluded on purpose: it carries the e2e island's node_modules once
   anybody has installed it, which would make every copy below minutes long. */
const COPY = ['tool.json', 'manifest.json', 'CHANGELOG.md', 'README.md', 'icons', 'store', 'publish'];

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-listing-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
let root, toolDir, shotDir;

/* A solid one-colour PNG at an exact size — the only property any of these
   cases is about. */
function png(w, h, colorType = 2, value = 0x55) {
  const rgba = new Uint8ClampedArray(w * h * 4).fill(value);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return encode({ width: w, height: h, rgba, colorType });
}

function freshTree(shots = 4) {
  root = join(TMP, 'root-' + (++seq));
  toolDir = join(root, TOOL_REL);
  mkdirSync(toolDir, { recursive: true });
  for (const name of COPY) {
    const from = join(REAL_TOOL, name);
    if (existsSync(from)) cpSync(from, join(toolDir, name), { recursive: true });
  }
  /* 🔴 `tests` IS DROPPED FROM THE FIXTURE'S tool.json, AND THAT IS NOT A
     CONVENIENCE. lib/toolinfo.mjs refuses to load ANY tool whose `tests` list
     names a file that is absent — rightly: "a test path that no longer resolves
     does not fail, it silently stops running". The fixture omits `test/`
     because that directory carries the e2e island's node_modules and copying it
     would make each of these cases minutes long. The two choices were eleven
     empty stub files, which would satisfy that check by lying to it, or
     removing the key, which removes the claim instead of faking it. This guard
     never reads `tests`; check-catalog.mjs and lint.mjs own that field against
     the REAL tree. */
  const tj = JSON.parse(readFileSync(join(REAL_TOOL, 'tool.json'), 'utf8'));
  delete tj.tests;
  writeFileSync(join(toolDir, 'tool.json'), JSON.stringify(tj, null, 2) + '\n');
  shotDir = join(toolDir, 'store', '_shared', 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  /* Whatever a real run left there is replaced, so the count is this test's. */
  for (const f of readdirSync(shotDir)) {
    if (/\.(png|jpe?g)$/i.test(f)) unlinkSync(join(shotDir, f));
  }
  for (let i = 1; i <= shots; i++) {
    writeFileSync(join(shotDir, '0' + i + '-frame-1280x800.png'), png(1280, 800));
  }
  return root;
}

function run(extra = []) {
  const res = spawnSync(process.execPath, [GUARD, 'fullshot', '--repo-root', root, ...extra],
    { encoding: 'utf8' });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

describe('check-listing-assets.mjs', () => {
  beforeEach(() => { freshTree(); });

  test('GREEN CONTROL — the complete tree passes, and it graded something', () => {
    const { code, out } = run();
    assert.equal(code, 0, out);
    /* The control must also prove REACH. A pass over zero assets is the
       vacuous shape this whole file exists to rule out. */
    assert.match(out, /promo-tile-440x280\.png/);
    assert.match(out, /logo-300x300\.png/);
    assert.match(out, /icon-128\.png/);
    assert.match(out, /listing asset\(s\) graded/);
  });

  test("a DELETED required asset reddens, and names the store that requires it", () => {
    unlinkSync(join(toolDir, 'store', 'chrome', 'promo-tile-440x280.png'));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /promo-tile-440x280\.png exists/);
    assert.match(out, /required by chrome/);
  });

  test('a required asset at the WRONG SIZE reddens — one pixel is enough', () => {
    writeFileSync(join(toolDir, 'store', 'chrome', 'promo-tile-440x280.png'), png(440, 279));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /is exactly 440x280/);
    assert.match(out, /it is 440x279/);
  });

  test('the 128x128 icon WITHOUT an alpha channel reddens', () => {
    /* Chrome specifies 16px of TRANSPARENT padding, which colour type 2 cannot
       express. The file is the right size and opens fine in any viewer. */
    writeFileSync(join(toolDir, 'store', '_shared', 'icon-128.png'), png(128, 128, 2));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /icon-128\.png has an accepted PNG colour type/);
    assert.match(out, /colour type 2/);
  });

  test('a file that is not a PNG at all reddens rather than passing on its name', () => {
    writeFileSync(join(toolDir, 'store', 'edge', 'logo-300x300.png'), Buffer.from('this is not a PNG'));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /logo-300x300\.png is a readable PNG/);
  });

  test('ZERO screenshots reddens — Chrome requires at least one', () => {
    freshTree(0);
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /holds at least 1 image\(s\)/);
  });

  test('SIX screenshots reddens — Chrome allows five and one set goes to all three', () => {
    freshTree(6);
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /holds at most 5 image\(s\)/);
  });

  test('a screenshot at a size only ONE store takes reddens', () => {
    /* 640x400 is legal on Chrome and rejected by Edge, which takes 640x480.
       One shared set is uploaded to all three, so a Chrome-only size is a set
       that cannot be shared — and it is a size a hand-crop lands on. */
    writeFileSync(join(shotDir, '05-frame-640x400.png'), png(640, 400));
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /is a size all three stores accept/);
    assert.match(out, /it is 640x400/);
  });

  test('a tool with no listing tree at all is a NOTE, not a failure', () => {
    /* Creating a listing is owner work; keeping one is not. Deleting the whole
       store/ tree is the "this tool ships to no store yet" state, and it must
       not be indistinguishable from "somebody deleted the tile". */
    rmSync(join(toolDir, 'store'), { recursive: true, force: true });
    const { code, out } = run();
    assert.equal(code, 2, out);
    assert.match(out, /zero listing assets were graded|NO TREE/);
  });

  test('RESTORED — the same tree is green again, so the cases above moved it', () => {
    const { code } = run();
    assert.equal(code, 0);
  });
});
