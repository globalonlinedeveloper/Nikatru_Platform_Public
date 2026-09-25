// assert-frames-carry-text.test.mjs — the failing cases of
// tooling/e2e/assert-frames-carry-text.mjs, driven as the PROGRAM it is.
//
// 🔴 EVERY CASE HERE SPAWNS THE SCRIPT AND READS ITS EXIT CODE, because the
// exit code is the whole contract: 0 green, 1 a run with no text, 2 COVERAGE
// LOST. Importing its functions would prove the arithmetic and leave the three
// numbers CI actually reads unasserted — and the defect this guard exists to
// end is a lane that exits 0 while proving nothing.
//
// 🔴 THE FRAMES ARE REAL, AND BOTH SIDES OF THE DEFECT ARE COMMITTED.
// fixtures/frames-ink-2026-09-23/ holds five pages of the live app captured
// the way the drive captures them (headless Chrome, 430x932, DPR 1): `served/`
// as the app draws them, `glyphless/` with every font request answered 200
// text/html — the dev-server behaviour that shipped a glyphless listing from
// #567 to #854. The floor was measured on them (tooling/e2e-leg-register.json
// framesCarryText `_why`). A synthetic frame would prove the code path and
// nothing about whether the floor separates real pages.
//
// Row O-NIGHTLY-E2E-DRIVES-A-GLYPHLESS-APP.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const GUARD = join(ROOT, 'tooling', 'e2e', 'assert-frames-carry-text.mjs');

const FIXTURES = join(HERE, 'fixtures', 'frames-ink-2026-09-23');
const SERVED = join(FIXTURES, 'served');
const GLYPHLESS = join(FIXTURES, 'glyphless');
const STORE_PHONE = join(ROOT, 'apps', 'subscriptiontracker', 'store', 'android-play', 'screenshots');

const V8_OFF = /V8 background tasks: OFF \(--single-threaded\)/;

/** The last lines a killed spawn had printed. A timeout AFTER the verdict line
 *  is an exit that never completed; one before it is work that never did. */
const tail = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd().split('\n').slice(-6).join('\n') || '(nothing)';

// ⏱ 2026-09-25 · the spawn has a ceiling. With none, one hung run held ci.yml's
// guard-meta job until its 25-minute kill (run 36106900356, job 107981386553)
// and named nothing; this file took 23.5 s in the green run 36104371801.
// ⏱ 2026-09-25 (later) · the ceiling then fired on the glyphless case of run
// 36192015901 at 120 s, while the served, mixed and filtered cases took 3.2-5.6 s
// in the same file: an exit deadlock (nodejs/node#54918), fixed in the guard by
// the single-threaded relaunch. The message now carries status, signal and what
// the guard had printed, so the next timeout says WHICH of the two it was.
const run = (...args) => {
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  assert.equal(
    r.error,
    undefined,
    `tooling/e2e/assert-frames-carry-text.mjs did not finish (${r.error?.code ?? r.error}; status ${r.status}, signal ${r.signal}): ` +
      `the 120 s spawn ceiling stopped it. Its last output:\n${tail(r)}`,
  );
  return r;
};

const pngs = (dir) => readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

/** `textlessFrame` of every frame in `from`, written to `to` — computed in a
 *  `--single-threaded` child, not in this test process. It is the same pixel
 *  loop the guard relaunches for, and this process exits under the test runner,
 *  where a deadlock at exit has no ceiling but the job's. */
function filterFramesInChild(from, to) {
  const codec = pathToFileURL(join(ROOT, 'tooling', 'store', 'png-codec.mjs')).href;
  const ink = pathToFileURL(join(ROOT, 'tooling', 'store', 'frame-ink.mjs')).href;
  const src = [
    "import { readdirSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `import { decodeRgba, encodeRgba } from ${JSON.stringify(codec)};`,
    `import { textlessFrame } from ${JSON.stringify(ink)};`,
    'const [from, to] = process.argv.slice(1);',
    "for (const f of readdirSync(from).filter((n) => n.endsWith('.png')).sort()) {",
    '  writeFileSync(join(to, f), encodeRgba(textlessFrame(decodeRgba(readFileSync(join(from, f)))), { opaque: true }));',
    '}',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--single-threaded', '--input-type=module', '-e', src, from, to], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(r.error, undefined, `filtering the served frames did not finish (${r.error?.code ?? r.error}).\n${tail(r)}`);
  assert.equal(r.status, 0, `filtering the served frames failed.\n${tail(r)}`);
  assert.deepEqual(pngs(to), pngs(from), 'every served frame must have its filtered twin');
}

describe('assert-frames-carry-text, as the program CI runs', () => {
  test('a run of real pages with their text drawn is green', () => {
    // Anti-vacuity first: a fixture directory that quietly lost its frames
    // would turn this into a COVERAGE LOST, but name it before that.
    assert.equal(pngs(SERVED).length, 5, 'expected the five committed served frames');
    const r = run(SERVED);
    assert.equal(r.status, 0, `real frames that carry drawn text must pass.\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /carry drawn text/);
    // Spawned bare, exactly as a caller without the flag would: the pixels were
    // read by the relaunched single-threaded child. Drop the relaunch and this
    // line says ON.
    assert.match(r.stdout, V8_OFF, 'the frames must be measured with V8 background tasks OFF (nodejs/node#54918)');
  });

  test('the SAME pages rendered with no fonts are a FINDING, exit 1', () => {
    // 🔴 THE RED CONTROL IS THE POINT OF THE GUARD, NOT A FORMALITY. These are
    // not textlessFrame estimates: they are the defect, reproduced on the real
    // app. The first version of this guard (a per-frame ratio against the
    // store's 0.7) passed three of these five, sign-in and sign-up among them,
    // and went red only on the two near-empty pages.
    assert.equal(pngs(GLYPHLESS).length, 5, 'expected the five committed glyphless frames');
    const r = run(GLYPHLESS);
    assert.equal(r.status, 1, `a glyphless run must be a finding (1), not a pass and not a 2.\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /carry no text/);
    assert.doesNotMatch(r.stderr, /lower(ing)? the floor to/i);
    // The case that hung (run 36192015901): it is the one that leaves through
    // process.exit(1), and its exit status must come through the relaunch.
    assert.match(r.stdout, V8_OFF, 'the finding must be computed with V8 background tasks OFF (nodejs/node#54918)');
  });

  test('one page that keeps its text does not rescue a glyphless run', () => {
    // A Turnstile widget draws real HTML text when Flutter draws none, and a
    // run can hold a page or two like that. The verdict is the run's median,
    // so one outlier cannot carry it.
    const dir = mkdtempSync(join(tmpdir(), 'frames-carry-text-mixed-'));
    try {
      for (const f of pngs(GLYPHLESS)) copyFileSync(join(GLYPHLESS, f), join(dir, `g-${f}`));
      copyFileSync(join(SERVED, '03-sign-in.png'), join(dir, 's-03-sign-in.png'));
      const r = run(dir);
      assert.equal(r.status, 1, `one text-bearing page among glyphless ones is still a finding.\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /carry no text/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the served pages with their glyphs filtered away are a FINDING, exit 1', () => {
    // The estimate the first version was built on: `textlessFrame` of a real
    // frame. Kept because it is the cheapest shape of "icons stayed, glyphs
    // went" and it must stay red too.
    const dir = mkdtempSync(join(tmpdir(), 'frames-carry-text-filtered-'));
    try {
      filterFramesInChild(SERVED, dir);
      const r = run(dir);
      assert.equal(r.status, 1, `filtered frames must be a finding.\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /carry no text/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('frames at a width the floor was not measured at are COVERAGE LOST, exit 2', () => {
    // The store frames are 1080 wide at DPR 2.625. Removed ink falls roughly
    // as 1/DPR, so judging them against a floor measured at 430 would be a
    // verdict about nothing — in either direction.
    const r = run(STORE_PHONE);
    assert.equal(r.status, 2, `a frame at another width must not be judged.\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST/);
    assert.match(r.stderr, /measured on frames 430 wide/);
  });

  test('a directory with no frames in it is COVERAGE LOST, exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frames-carry-text-empty-'));
    try {
      const r = run(dir);
      assert.equal(r.status, 2, `zero frames is a duty that could not be done, not a clean run.\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a directory that is not there is COVERAGE LOST, exit 2', () => {
    // The shape a failed capture actually takes: the drive exits 0 and the
    // screenshots directory was never created.
    const r = run(join(tmpdir(), 'frames-carry-text-absent-directory-that-does-not-exist'));
    assert.equal(r.status, 2, `a missing directory is COVERAGE LOST.\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST/);
  });

  test('no argument at all is COVERAGE LOST, exit 2', () => {
    const r = run();
    assert.equal(r.status, 2, `no directory means nothing was read.\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST/);
    assert.match(r.stderr, /usage:/);
  });

  test('the floor is read from the e2e register, and is not the store fraction', () => {
    // 🔴 THE ONE THING A PASSING RUN CANNOT SHOW. A floor copied into the
    // guard would leave every case above green while the tree carried two
    // numbers that drift apart; a floor borrowed from the store block is the
    // defect this version replaced. So the source text is asserted directly.
    const src = readFileSync(GUARD, 'utf8');
    assert.match(src, /minMedianRemovedInk/, 'the guard must read its floor off the register');
    assert.match(src, /e2e-leg-register\.json/);
    const code = src
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(code, /minFractionOfMeasured|channel-register\.json/, 'the store drift fraction is not this guard\'s number');
    assert.doesNotMatch(
      code,
      /(?:fraction|floor|threshold)\s*=\s*0\.\d/i,
      'the guard must not assign a literal floor: the register owns that number.',
    );
    const block = JSON.parse(readFileSync(join(ROOT, 'tooling', 'e2e-leg-register.json'), 'utf8')).framesCarryText;
    assert.equal(block.metric, 'local-contrast-ink-v1');
    assert.equal(block.calibratedWidth, 430, 'the floor was measured at the drive\'s --browser-dimension width');
  });
});

describe('the directory the e2e workflow points it at', () => {
  test('the step names the same screenshots path the upload uploads', () => {
    // Order and path in one: the check must read the frames the artifact is
    // made from, or it grades something nobody looks at.
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'e2e.yml'), 'utf8');
    const stepAt = wf.indexOf('tooling/e2e/assert-frames-carry-text.mjs');
    assert.notEqual(stepAt, -1, 'e2e.yml no longer runs assert-frames-carry-text.mjs');
    const uploadAt = wf.indexOf('name: Upload per-page screenshots');
    assert.notEqual(uploadAt, -1, 'e2e.yml no longer uploads the screenshots');
    assert.ok(
      stepAt < uploadAt,
      'the text check must run BEFORE the upload step, so a glyphless run is red on the step and the frames are still attached.',
    );
    const uploadPath = /path:\s*apps\/\$\{\{\s*matrix\.app\s*\}\}\/screenshots\//.test(wf);
    assert.ok(uploadPath, 'the upload no longer takes apps/<app>/screenshots/ — re-point the check at whatever replaced it');
    assert.match(
      wf.slice(stepAt - 400, stepAt + 200),
      /apps\/\$\{\{\s*matrix\.app\s*\}\}\/screenshots/,
      'the check must be pointed at apps/<app>/screenshots, the directory the drive writes and the upload reads',
    );
  });

  test('the drive still captures at the width the floor was measured at', () => {
    // The floor is only valid at one width, and the lever that sets it is
    // flutter drive's --browser-dimension. This test used to hold
    // `--window-size=430,…`, which flutter drive resizes over with its own
    // 1600x1024 default: it was green while every frame was 1600x881, and the
    // first nightly (E2E live run 35824787614) was the thing that noticed.
    // So it reads the drive command itself, and refuses a --window-size there.
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'e2e.yml'), 'utf8');
    const block = JSON.parse(readFileSync(join(ROOT, 'tooling', 'e2e-leg-register.json'), 'utf8')).framesCarryText;
    const sizeProblems = (text) => {
      const start = text.indexOf('flutter drive \\');
      if (start === -1) return ['e2e.yml has no `flutter drive \\` command'];
      const drive = text.slice(start, text.indexOf('| tee', start));
      const out = [];
      const dims = [...drive.matchAll(/--browser-dimension=(\d+)[x,](\d+)(?:@([\d.]+))?/g)];
      if (dims.length !== 1) out.push(`the drive passes --browser-dimension ${dims.length} time(s), not once`);
      else if (Number(dims[0][1]) !== block.calibratedWidth || dims[0][3] !== '1') {
        out.push(`the drive is --browser-dimension=${dims[0][0].split('=')[1]}, not ${block.calibratedWidth}x…@1, the size framesCarryText was measured at`);
      }
      if (/--window-size/.test(drive)) out.push('the drive passes --window-size, which flutter drive resizes over; it is not a size lever');
      return out;
    };
    assert.deepEqual(sizeProblems(wf), [], `re-measure framesCarryText in the same change as a drive-size change`);

    // Red controls: each is the drive of a different day, and each must fail.
    const dim = /--browser-dimension=\S+ \\\n/;
    assert.match(wf, dim, 'the mutation must land');
    const reds = {
      'the flag removed (1600x1024 default)': wf.replace(dim, ''),
      'the 2026-07-18 drive': wf.replace(dim, '--web-browser-flag=--window-size=430,932 \\\n'),
      'a DPR of 2': wf.replace(/--browser-dimension=(\d+)x(\d+)@1/, '--browser-dimension=$1x$2@2'),
      'another width': wf.replace(/--browser-dimension=\d+x/, '--browser-dimension=390x'),
    };
    for (const [what, text] of Object.entries(reds)) {
      assert.notEqual(text, wf, `${what}: the mutation must land`);
      assert.notDeepEqual(sizeProblems(text), [], `${what} must be red`);
    }
  });
});
