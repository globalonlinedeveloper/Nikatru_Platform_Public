#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// measure-frame-ink.mjs — the ink READING of a directory of frames, per device
// class, the way `assert-listing-assets.mjs` judges it.
//
//   node tooling/store/measure-frame-ink.mjs [--root <repo>] <dir> [<dir> …]
//
// For every `NN-name.png` under each directory it prints the frame's native
// reading (ink, textless control, removed ink). When the directory is a
// declared device-type set — `apps/<app>/store/<channel>/<set dir>` — and
// `storeMetadataContract.inkRule.classes` names `<channel>/<set>`, it also
// prints the class's reading: the run median of removed ink after each frame is
// area-averaged to the set's `capture.logicalWidth`, both calibration medians,
// their separation, the floor they put down and the run's headroom over it.
//
// ── WHY IT PRINTS A READING AND NOTHING TO PASTE ────────────────────────────
// Until 2026-09-24 this printed a paste-ready `inkFloor.frames` block: eight
// `{measured, textlessControl}` rows a recapture had to copy into the register
// by hand, which is the defect row O-STORE-INK-FLOOR-HAND-PASTED names. The
// register now carries no per-frame number at all. The floor is computed from
// the class's committed calibration frames on every run of the guard, so there
// is nothing to paste — only a reading of why a run passed or failed, which is
// what `store-screenshots.yml` prints from a failed capture's log.
//
// 🔴 IT PRINTS, IT DOES NOT JUDGE AND IT DOES NOT WRITE. The verdict and its
// exit code belong to `assert-listing-assets.mjs`; this exits 0 whenever it
// read a frame, under the floor or over it. A reading tool that failed would be
// a second guard with its own idea of the rule. For the same reason it does not
// repeat the guard's refusals of a calibration set (fewer than four frames per
// mode, served and glyphless naming different pages): where the guard reports
// such a class COVERAGE LOST, this may still print the numbers it could read.
//
// ⚠️ `--root` names the repository whose register and calibration directories
// are read (default: the one this file lives in). The frame directories are
// read as given, relative to the working directory.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRgba } from './png-codec.mjs';
import { METRIC_ID, INK_DELTA, measureFrameInk, removedInkRunMedian } from './frame-ink.mjs';

const argv = process.argv.slice(2);
const rootAt = argv.indexOf('--root');
const ROOT = resolve(rootAt !== -1 && argv[rootAt + 1] ? argv[rootAt + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const dirs = argv.filter((a, i) => !a.startsWith('--') && !(rootAt !== -1 && i === rootAt + 1));

if (dirs.length === 0) {
  console.error('measure-frame-ink: REFUSING — no directory given.');
  console.error('usage: node tooling/store/measure-frame-ink.mjs [--root <repo>] <dir-of-frames> [<dir> …]');
  console.error('  e.g. node tooling/store/measure-frame-ink.mjs \\');
  console.error('         apps/subscriptiontracker/store/android-play/screenshots \\');
  console.error('         apps/subscriptiontracker/store/android-play/screenshots-tablet');
  process.exit(1);
}

let contract = null;
try {
  contract = JSON.parse(readFileSync(join(ROOT, 'tooling', 'channel-register.json'), 'utf8')).storeMetadataContract ?? null;
} catch {
  // No readable register: every directory is read without a class, which is
  // still a true reading.
}
const rule = contract?.inkRule ?? null;

const pngsIn = (abs) => readdirSync(abs).filter((f) => f.toLowerCase().endsWith('.png')).sort();

/** The class a frame directory belongs to, or why it has none. The channel is
 *  the directory's parent (apps/<app>/store/<channel>/<set dir>) and the set is
 *  the one of that channel's deviceTypeCoverage.sets whose `dir` it is. */
function classFor(abs) {
  const channel = basename(dirname(abs));
  const sets = contract?.perChannel?.[channel]?.graphicAssets?.screenshots?.deviceTypeCoverage?.sets;
  if (!sets || typeof sets !== 'object') return { why: `"${channel}" is not a register channel with device-type sets` };
  const setName = Object.keys(sets).find((k) => k !== '_why' && sets[k]?.dir === basename(abs));
  if (!setName) return { why: `no set of "${channel}" is the directory "${basename(abs)}"` };
  const key = `${channel}/${setName}`;
  const spec = rule?.classes?.[key];
  const c = sets[setName].capture;
  if (!spec) return { why: `storeMetadataContract.inkRule.classes names no "${key}"` };
  if (!c || !Number.isInteger(c.logicalWidth) || !Number.isInteger(c.logicalHeight) || !Number.isInteger(c.logicalWidth * c.dpr)) {
    return { why: `"${key}" has no readable capture geometry` };
  }
  return { key, lw: c.logicalWidth, lh: c.logicalHeight, dpr: c.dpr, w: c.logicalWidth * c.dpr, h: c.logicalHeight * c.dpr, calibration: spec.calibration };
}

/** Both modes of a calibration directory, decoded, or why they cannot be read. */
function calibrationFrames(cls) {
  const base = join(ROOT, String(cls.calibration ?? ''));
  const out = {};
  for (const mode of ['served', 'glyphless']) {
    const dir = join(base, mode);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return { why: `${cls.calibration}/${mode}/ does not exist` };
    const imgs = pngsIn(dir).map((f) => decodeRgba(readFileSync(join(dir, f))));
    if (imgs.length === 0) return { why: `${cls.calibration}/${mode}/ holds no frame` };
    if (imgs.some((i) => i.width !== cls.w || i.height !== cls.h)) return { why: `${cls.calibration}/${mode}/ holds a frame that is not ${cls.w}x${cls.h}` };
    out[mode] = imgs;
  }
  return out;
}

const subjects = [];
for (const dir of dirs) {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    console.error(`measure-frame-ink: REFUSING — ${dir} is not a directory.`);
    process.exit(1);
  }
  subjects.push({ abs, files: pngsIn(abs) });
}

// 🔴 AN EMPTY SUBJECT IS A REFUSAL, NEVER A READING, and it is refused before
// anything reaches stdout: headers over no frames would look exactly like a
// measured run.
if (subjects.every((s) => s.files.length === 0)) {
  console.error(
    `measure-frame-ink: REFUSING — no .png frames under ${dirs.join(', ')}. ` +
      'A reading of no frames measures nothing, and printing one would look like a measurement.',
  );
  process.exit(1);
}

let read = 0;
console.log(`metric ${METRIC_ID}, per-channel delta ${INK_DELTA}; removed ink = measured - textless control`);

for (const { abs, files } of subjects) {
  const cls = classFor(abs);
  console.log('');
  console.log(
    cls.key
      ? `${basename(abs)} — class ${cls.key}, captured ${cls.lw}x${cls.lh}@${cls.dpr} = ${cls.w}x${cls.h}`
      : `${basename(abs)} — no ink class (${cls.why}): native readings only, and no floor to compare with`,
  );
  const imgs = [];
  for (const file of files) {
    const img = decodeRgba(readFileSync(join(abs, file)));
    const key = `${basename(abs)}/${file}`;
    // Progress on stderr, so stdout stays the reading.
    process.stderr.write(`  measuring ${key} (${img.width}x${img.height}) … `);
    const t0 = Date.now();
    const m = measureFrameInk(img);
    const removed = Number((m.measured - m.textlessControl).toFixed(6));
    process.stderr.write(`${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    console.log(`  ${key} ${img.width}x${img.height}: measured ${m.measured}, textless ${m.textlessControl}, removed ${removed} (native)`);
    read++;
    if (cls.key && img.width === cls.w && img.height === cls.h) imgs.push(img);
    else if (cls.key) console.log(`    ⚠️ not the class's ${cls.w}x${cls.h}: left out of the class reading, and the guard refuses it`);
  }
  if (!cls.key || imgs.length === 0) continue;
  const runMedian = removedInkRunMedian(imgs, cls.lw);
  console.log(`  run median of removed ink at ${cls.lw} CSS px: ${runMedian} (n ${imgs.length})`);
  const cal = calibrationFrames(cls);
  if (cal.why) {
    console.log(`  calibration: ${cal.why} — no floor can be computed, and the guard reports this class COVERAGE LOST`);
    continue;
  }
  const served = removedInkRunMedian(cal.served, cls.lw);
  const glyphless = removedInkRunMedian(cal.glyphless, cls.lw);
  // The guard's arithmetic, printed: the floor is the geometric mean of the
  // two calibration medians (register inkRule.floorRule).
  const floor = glyphless > 0 && served > 0 ? Math.sqrt(served * glyphless) : 0;
  console.log(
    `  calibration ${cls.calibration}/: served median ${served}, glyphless median ${glyphless}, ` +
      `separation ${glyphless > 0 ? (served / glyphless).toFixed(2) : '—'}x (needs >= ${rule?.minSeparation ?? '?'}), floor ${floor.toFixed(6)}`,
  );
  console.log(`  headroom: ${floor > 0 ? (runMedian / floor).toFixed(2) : '—'}x`);
}

console.error(`measure-frame-ink: ${read} frame(s) read. This is a reading, not a verdict: assert-listing-assets.mjs judges.`);
