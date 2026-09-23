#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// measure-frame-ink.mjs — take BOTH halves of an `inkFloor` row off a fresh
// capture, with one tool, on one day, from the same bytes.
//
//   node tooling/store/measure-frame-ink.mjs <dir> [<dir> …]
//
// Prints a paste-ready `frames` block for every `NN-name.png` under the given
// directories, keyed the way `tooling/channel-register.json` keys them: the
// directory's own name, a slash, the file name. Point it at an unzipped
// `play-screenshots-subscriptiontracker` artifact and the output IS the row.
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// The register's own text calls a recapture that moves a frame's ink by more
// than 30% "the intended cost: a floor nobody has to maintain is a floor nobody
// has measured". Paying that cost needs `measured` AND `textlessControl` for
// the new frames — and until `frame-ink.mjs` grew `textlessFrame`, nothing in
// the tree could produce the second one. The eight numbers in the register came
// from a script that was never committed, so the rows could be read and could
// not be re-taken.
//
// 🔴 IT PRINTS, IT DOES NOT WRITE. The register is a sworn store contract and a
// floor in it is a claim about a capture somebody looked at. A tool that edited
// it would let a recapture lower its own floor on the way past, which is the one
// thing the block exists to prevent — the same reason
// `capture-play-screenshots.mjs` opens a pull request rather than committing the
// frames it just took.
//
// ⚠️ READ `frame-ink.mjs`'s HEADER BEFORE PASTING. Its measurement table records
// that `measured` reproduces the committed rows exactly and `textlessControl`
// does NOT — every reading from this tool is higher than the recorded one, by 3%
// to 36%. A row must therefore take BOTH halves from here or BOTH from the
// recorded set; mixing them compares two instruments and calls the difference a
// change in the frames.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRgba } from './png-codec.mjs';
import { METRIC_ID, INK_DELTA, measureFrameInk } from './frame-ink.mjs';

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (dirs.length === 0) {
  console.error('measure-frame-ink: REFUSING — no directory given.');
  console.error('usage: node tooling/store/measure-frame-ink.mjs <dir-of-frames> [<dir> …]');
  console.error('  e.g. node tooling/store/measure-frame-ink.mjs \\');
  console.error('         apps/subscriptiontracker/store/android-play/screenshots \\');
  console.error('         apps/subscriptiontracker/store/android-play/screenshots-tablet');
  process.exit(1);
}

const frames = {};
let read = 0;
const parents = new Set();

for (const dir of dirs) {
  const abs = resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    console.error(`measure-frame-ink: REFUSING — ${dir} is not a directory.`);
    process.exit(1);
  }
  parents.add(basename(dirname(abs)));
  for (const file of readdirSync(abs).filter((f) => f.endsWith('.png')).sort()) {
    const img = decodeRgba(readFileSync(join(abs, file)));
    const key = `${basename(abs)}/${file}`;
    // Progress on stderr so stdout stays a clean JSON document a reader can
    // pipe straight into a diff against the committed row.
    process.stderr.write(`  measuring ${key} (${img.width}x${img.height}) … `);
    const t0 = Date.now();
    frames[key] = measureFrameInk(img);
    process.stderr.write(
      `measured ${frames[key].measured}, textless ${frames[key].textlessControl} ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)\n`,
    );
    read++;
  }
}

// 🔴 AN EMPTY SUBJECT IS A REFUSAL, NEVER A PASS. Printing `{}` here would hand
// somebody an `inkFloor.frames` block that enforces nothing at all, and it would
// look exactly like a measured one.
if (read === 0) {
  console.error(
    `measure-frame-ink: REFUSING — no .png frames under ${dirs.join(', ')}. ` +
      'An empty frames block enforces nothing, and a floor that cannot fire is worse than none.',
  );
  process.exit(1);
}

console.log(JSON.stringify({ metric: METRIC_ID, delta: INK_DELTA, frames }, null, 2));
console.error('');
// why: this hint said android-play whatever the frames were. store-screenshots.yml
// now prints this row from a FAILED capture of every channel, so a linux-snap log
// would have said "paste into android-play" under linux-snap frames. The channel
// is the set directory's parent (apps/<app>/store/<channel>/<set>), named only
// when the register declares it and all the directories agree; otherwise the
// placeholder stays, which is never wrong.
let channel = '<channel>';
try {
  const reg = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'channel-register.json'), 'utf8'),
  );
  const known = reg.storeMetadataContract?.perChannel ?? {};
  const [only] = parents;
  if (parents.size === 1 && Object.hasOwn(known, only)) channel = only;
} catch {
  // No readable register beside the tool: the placeholder is still true.
}
console.error(`measure-frame-ink: ${read} frame(s). Paste \`frames\` into`);
console.error(`  storeMetadataContract.perChannel["${channel}"].graphicAssets.screenshots.inkFloor`);
console.error('and REWRITE its `source` with today\'s date, the run that captured the frames, and this command.');
