// ─────────────────────────────────────────────────────────────────────────────
// assert-apps-gov-in-media.mjs — the apps.gov.in screenshots and icon are
// DERIVED from the Play set, and this file both derives them and proves the
// committed files are still exactly that derivation.
//
// Register row O-APPS-GOV-IN-CHANNEL-APK, item 3.
//
// WHY DERIVED, NOT CAPTURED. The portal's upload form accepts a screenshot only
// at EXACTLY 155x290 (contracts/store/vocabulary.js STORE_FORM_RULES, read from
// the form's own script 2026-09-22). This channel ships the same app, the same
// screens, as the android-play lane, whose phone set is a LIVE capture at
// 1080x1920. A re-capture at 155x290 would need a signed-in E2E account on the
// machine that runs it; a derivation needs nothing but the committed originals,
// and it cannot drift from them without this guard saying so.
//
// THE DERIVATION, exactly (so a reader can repeat it by hand):
//   1. decode the Play original (tooling/store/png-codec.mjs, the one decoder);
//   2. pad it to the target's aspect ratio by REPEATING its edge rows (or
//      columns) — 1080x1920 becomes 1080x2021, 50 rows on top, 51 below — so
//      nothing is cropped and nothing is stretched;
//   3. downscale by an exact area average (every source pixel contributes in
//      proportion to the area it covers in the output pixel), rounded;
//   4. encode as a 24-bit PNG with no alpha channel.
// Integer-exact and deterministic: the check re-derives and compares PIXELS,
// not bytes, so a different zlib build cannot fail it.
//
// THE ICON is the Play store icon, byte for byte. That file is derived 2:1 from
// the launcher-icon master apps/<app>/assets/icon/app_icon_1024.png by
// tooling/store/render-play-graphics.mjs, and is 512x512 already.
//
// Usage:
//   node tooling/ci/assert-apps-gov-in-media.mjs [<repo-root>]          check every apps/*/store/apps-gov-in
//   node tooling/ci/assert-apps-gov-in-media.mjs --write --app <app>    derive, write, record CAPTURE.json
//
// Exit codes: 0 green · 1 a finding · 2 COVERAGE LOST (nothing was checked, or
// the rules or a record could not be read — never reported as a pass).
//
// ⏱ 2026-09-22 · WIRED INTO ci.yml, AND RUN WITH V8 BACKGROUND TASKS OFF.
// Until this date its only call was a build-platforms.yml step, which runs on a
// dispatch, a tag or the Monday/Thursday cron and never on a pull request: a PR
// that re-captured the Play set merged green and the next scheduled build went
// red. It now also runs as the last step of ci.yml's guards-store job. It
// decodes every committed file and re-derives it from its 1080x1920 original,
// pixel by pixel — the hot code the four heavy image guards relaunch for
// (nodejs/node#54918, see single-threaded-relaunch.mjs) — so it adopts the same
// relaunch, and both workflow steps run it as `node --single-threaded`.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeRgba, encodeRgba, PngUnreadable } from '../store/png-codec.mjs';
import { STORE_FORM_RULES } from '../../contracts/store/vocabulary.js';
import { listDir } from './tree-walk.mjs';
// The ONE relaunch with V8 background tasks off — see that module's header.
import { backgroundTasksNote, relaunchSingleThreaded } from './single-threaded-relaunch.mjs';

const NAME = 'assert-apps-gov-in-media';
const CHANNEL = 'apps-gov-in';
const PLAY = 'android-play';
export const METHOD = 'pad-to-aspect-then-area-average';
const SHOT = /^\d\d-[a-z0-9-]+\.png$/;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Pad to the target aspect ratio by repeating the edge rows (or columns).
 *  Returns the input unchanged when the ratio already matches to the pixel. */
export function padToAspect({ width, height, rgba }, tw, th) {
  const wantH = Math.round((width * th) / tw);
  const wantW = Math.round((height * tw) / th);
  if (wantH > height) {
    const top = Math.floor((wantH - height) / 2);
    const out = Buffer.alloc(width * wantH * 4);
    const stride = width * 4;
    for (let y = 0; y < wantH; y++) {
      const sy = Math.min(height - 1, Math.max(0, y - top));
      rgba.copy(out, y * stride, sy * stride, (sy + 1) * stride);
    }
    return { width, height: wantH, rgba: out, pad: { axis: 'rows', before: top, after: wantH - height - top } };
  }
  if (wantW > width) {
    const left = Math.floor((wantW - width) / 2);
    const out = Buffer.alloc(wantW * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < wantW; x++) {
        const sx = Math.min(width - 1, Math.max(0, x - left));
        rgba.copy(out, (y * wantW + x) * 4, (y * width + sx) * 4, (y * width + sx) * 4 + 4);
      }
    }
    return { width: wantW, height, rgba: out, pad: { axis: 'columns', before: left, after: wantW - width - left } };
  }
  return { width, height, rgba, pad: { axis: 'none', before: 0, after: 0 } };
}

/** Per output index, the source indices it covers and each one's weight (the
 *  overlap length). Weights of one output sum to src/dst. */
function spans(src, dst) {
  const scale = src / dst;
  const out = [];
  for (let o = 0; o < dst; o++) {
    const a = o * scale;
    const b = (o + 1) * scale;
    const taps = [];
    for (let s = Math.floor(a); s < Math.min(src, Math.ceil(b)); s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 0) taps.push([s, w]);
    }
    out.push(taps);
  }
  return { out, scale };
}

/** Exact area-average downscale to tw x th, RGBA in, RGBA out, alpha forced to
 *  255 (the caller has already refused a translucent source). */
export function areaAverage({ width, height, rgba }, tw, th) {
  if (tw > width || th > height) throw new RangeError(`areaAverage only shrinks (${width}x${height} -> ${tw}x${th})`);
  const hx = spans(width, tw);
  const vy = spans(height, th);
  const mid = new Float64Array(tw * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, b = 0;
      for (const [s, w] of hx.out[x]) {
        const i = (y * width + s) * 4;
        r += rgba[i] * w; g += rgba[i + 1] * w; b += rgba[i + 2] * w;
      }
      const d = (y * tw + x) * 3;
      mid[d] = r / hx.scale; mid[d + 1] = g / hx.scale; mid[d + 2] = b / hx.scale;
    }
  }
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, b = 0;
      for (const [s, w] of vy.out[y]) {
        const i = (s * tw + x) * 3;
        r += mid[i] * w; g += mid[i + 1] * w; b += mid[i + 2] * w;
      }
      const d = (y * tw + x) * 4;
      out[d] = Math.round(r / vy.scale); out[d + 1] = Math.round(g / vy.scale); out[d + 2] = Math.round(b / vy.scale); out[d + 3] = 255;
    }
  }
  return { width: tw, height: th, rgba: out };
}

/** The whole derivation: PNG bytes in, { png, image, pad } out. Throws on a
 *  translucent source — averaging colour under partial alpha has no one answer. */
export function deriveScreenshot(buf, { width: tw, height: th }) {
  const src = decodeRgba(buf);
  for (let i = 3; i < src.rgba.length; i += 4) {
    if (src.rgba[i] !== 255) throw new PngUnreadable([`the source has a translucent pixel (alpha ${src.rgba[i]} at byte ${i}); a store screenshot is opaque, and a blend has no single right colour`]);
  }
  const padded = padToAspect(src, tw, th);
  const image = areaAverage(padded, tw, th);
  return { png: encodeRgba(image, { opaque: true }), image, pad: padded.pad, source: { width: src.width, height: src.height } };
}

/** Same pixels, ignoring alpha (the committed file has none). */
export function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2]) return false;
  }
  return true;
}

const storeDir = (root, app, channel) => join(root, 'apps', app, 'store', channel);
const rel = (root, p) => p.slice(root.length + 1).replace(/\\/g, '/');

/** Check one app's apps-gov-in tree. Returns { problems, notes, checked }. */
export function checkApp(root, app, rules = STORE_FORM_RULES[CHANNEL]) {
  const problems = [];
  const notes = [];
  let checked = 0;
  const agi = storeDir(root, app, CHANNEL);
  const shotsDir = join(agi, rules.screenshots.dir);
  const record = join(shotsDir, 'CAPTURE.json');
  const redo = `node tooling/ci/assert-apps-gov-in-media.mjs --write --app ${app}`;
  const present = existsSync(shotsDir) ? listDir(shotsDir).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort() : [];
  if (!existsSync(record)) {
    if (present.length) problems.push(`${rel(root, shotsDir)} holds ${present.length} image(s) and no CAPTURE.json: nothing says where they came from. Run \`${redo}\`.`);
    else notes.push(`${app}: no apps-gov-in screenshots derived yet (a freshly stamped app). \`${redo}\` makes them once the Play set exists.`);
    return { problems, notes, checked };
  }
  let cap;
  try {
    cap = JSON.parse(readFileSync(record, 'utf8'));
  } catch (e) {
    problems.push(`${rel(root, record)} does not parse (${e.message}).`);
    return { problems, notes, checked };
  }
  if (cap.derivation?.method !== METHOD) {
    problems.push(`${rel(root, record)} records derivation.method ${JSON.stringify(cap.derivation?.method ?? null)}, not "${METHOD}". Run \`${redo}\`.`);
    return { problems, notes, checked };
  }
  const files = Array.isArray(cap.files) ? cap.files : [];
  const named = files.map((f) => f.name).sort();
  if (JSON.stringify(named) !== JSON.stringify(present)) {
    problems.push(`${rel(root, shotsDir)} holds [${present.join(', ')}] and CAPTURE.json names [${named.join(', ')}]. Every image must be a recorded derivation, and every recorded one must be there.`);
  }
  for (const f of files) {
    const out = join(shotsDir, f.name);
    const src = join(root, f.from ?? '');
    if (!f.from || !existsSync(src)) {
      problems.push(`${f.name}: its source ${JSON.stringify(f.from ?? null)} does not exist. Run \`${redo}\`.`);
      continue;
    }
    if (!existsSync(out)) continue; // reported by the set comparison above
    const srcBuf = readFileSync(src);
    const outBuf = readFileSync(out);
    if (sha256(srcBuf) !== f.sourceSha256) {
      problems.push(`${f.name} is STALE: ${f.from} has changed since it was derived (sha256 ${sha256(srcBuf).slice(0, 12)}…, recorded ${String(f.sourceSha256).slice(0, 12)}…). Run \`${redo}\` and commit the result.`);
      continue;
    }
    if (sha256(outBuf) !== f.sha256 || outBuf.length !== f.bytes) {
      problems.push(`${f.name} is not the file CAPTURE.json recorded (sha256 ${sha256(outBuf).slice(0, 12)}…, ${outBuf.length} bytes; recorded ${String(f.sha256).slice(0, 12)}…, ${f.bytes} bytes). Somebody edited it by hand. Run \`${redo}\`.`);
      continue;
    }
    let committed;
    let expected;
    try {
      committed = decodeRgba(outBuf);
      expected = deriveScreenshot(srcBuf, rules.screenshots).image;
    } catch (e) {
      problems.push(`${f.name}: ${e instanceof PngUnreadable ? e.lines.join(' ') : e.message}`);
      continue;
    }
    if (!samePixels(committed, expected)) {
      problems.push(`${f.name} is ${committed.width}x${committed.height} and its pixels are not the ${METHOD} of ${f.from}. Run \`${redo}\`.`);
      continue;
    }
    checked++;
  }
  const iconName = rules.icon.file;
  const icon = join(agi, iconName);
  const playIcon = join(storeDir(root, app, PLAY), iconName);
  if (!existsSync(icon)) problems.push(`${rel(root, icon)} is missing. Run \`${redo}\`.`);
  else if (!existsSync(playIcon)) problems.push(`${rel(root, playIcon)} is missing, and the apps.gov.in icon is a copy of it. Run \`node tooling/store/render-play-graphics.mjs --app ${app}\` first.`);
  else if (sha256(readFileSync(icon)) !== sha256(readFileSync(playIcon))) problems.push(`${rel(root, icon)} is not a byte copy of ${rel(root, playIcon)}. Run \`${redo}\`.`);
  else checked++;
  return { problems, notes, checked };
}

/** Derive and write one app's screenshots, icon and CAPTURE.json. */
export function writeApp(root, app, rules = STORE_FORM_RULES[CHANNEL]) {
  const playShots = join(storeDir(root, app, PLAY), 'screenshots');
  const agi = storeDir(root, app, CHANNEL);
  const shotsDir = join(agi, rules.screenshots.dir);
  const sources = existsSync(playShots) ? listDir(playShots).filter((n) => SHOT.test(n)).sort() : [];
  if (sources.length < rules.screenshots.min || sources.length > rules.screenshots.max) {
    throw new RangeError(`${rel(root, playShots)} has ${sources.length} phone screenshot(s); the portal takes ${rules.screenshots.min} to ${rules.screenshots.max}.`);
  }
  const playCap = JSON.parse(readFileSync(join(playShots, 'CAPTURE.json'), 'utf8'));
  if (playCap.posture !== 'live') throw new RangeError(`${rel(root, playShots)}/CAPTURE.json says posture ${JSON.stringify(playCap.posture)}; only a LIVE capture may be derived from (a demo set carries a "Demo data" banner and third-party names).`);
  for (const n of listDir(shotsDir).filter((x) => /\.(png|jpe?g)$/i.test(x) && !sources.includes(x))) {
    throw new RangeError(`${rel(root, join(shotsDir, n))} would be left behind with no source; remove it first.`);
  }
  const files = [];
  let pad;
  for (const name of sources) {
    const srcBuf = readFileSync(join(playShots, name));
    const d = deriveScreenshot(srcBuf, rules.screenshots);
    pad = d.pad;
    writeFileSync(join(shotsDir, name), d.png);
    files.push({ name, from: rel(root, join(playShots, name)), sourceSha256: sha256(srcBuf), sourcePixels: `${d.source.width}x${d.source.height}`, sha256: sha256(d.png), bytes: d.png.length });
  }
  const iconSrc = join(storeDir(root, app, PLAY), rules.icon.file);
  const iconOut = join(agi, rules.icon.file);
  copyFileSync(iconSrc, iconOut);
  const iconBuf = readFileSync(iconOut);
  const s = rules.screenshots;
  const cap = {
    _why: [
      'A DERIVATION RECORD. Nothing photographed anything for this channel: each image below is the',
      'android-play phone screenshot it names, padded to the portal\'s aspect ratio by repeating its edge',
      'rows and shrunk by an exact area average to the only size the apps.gov.in form accepts. The',
      'recorded source hashes are the mechanism: when the Play set is re-captured they stop matching, and',
      'tooling/ci/assert-apps-gov-in-media.mjs fails naming the command that re-derives. That guard also',
      're-derives every file and compares pixels, so a hand-edited image fails too.',
    ],
    posture: playCap.posture,
    _postureWhy: 'Inherited from the Play set\'s CAPTURE.json, which the derivation refuses unless it says "live".',
    derivation: {
      method: METHOD,
      command: `node tooling/ci/assert-apps-gov-in-media.mjs --write --app ${app}`,
      steps: [
        'decode the Play original (tooling/store/png-codec.mjs)',
        `pad to ${s.width}:${s.height} by repeating edge ${pad.axis} (${pad.before} before, ${pad.after} after)`,
        `area-average down to ${s.width}x${s.height}, rounded`,
        'encode as 24-bit PNG, no alpha channel',
      ],
    },
    deviceType: 'phone',
    pixels: `${s.width}x${s.height}`,
    count: files.length,
    files,
    icon: {
      name: rules.icon.file,
      from: rel(root, iconSrc),
      derivedBy: `node tooling/store/render-play-graphics.mjs --app ${app} (2:1 from apps/${app}/assets/icon/app_icon_1024.png, the launcher-icon master), then copied byte for byte by the command above`,
      sha256: sha256(iconBuf),
      bytes: iconBuf.length,
      pixels: `${rules.icon.width}x${rules.icon.height}`,
    },
    requirements: {
      screenshots: `${s.min} to ${s.max} files, exactly ${s.width}x${s.height}, ${s.formats.join(' or ')}, at most ${s.maxBytes} bytes each`,
      icon: `${rules.icon.width}x${rules.icon.height}, under ${rules.icon.maxBytesExclusive} bytes`,
      source: rules.source,
      asOf: rules.asOf,
    },
  };
  writeFileSync(join(shotsDir, 'CAPTURE.json'), `${JSON.stringify(cap, null, 2)}\n`);
  return cap;
}

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const WRITE = argv.includes('--write');
  const ai = argv.indexOf('--app');
  const APP = ai >= 0 ? argv[ai + 1] : undefined;
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--app');
  const ROOT = resolve(positional[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const rules = STORE_FORM_RULES[CHANNEL];
  if (!rules?.screenshots || !rules?.icon) coverageLost([`contracts/store/vocabulary.js STORE_FORM_RULES has no "${CHANNEL}" screenshots/icon rules.`]);

  if (WRITE) {
    if (!APP || !/^[a-z][a-z0-9_]*$/.test(APP)) coverageLost([`--write needs --app <app> (got ${JSON.stringify(APP ?? null)}).`]);
    const cap = writeApp(ROOT, APP, rules);
    for (const f of cap.files) console.log(`   wrote ${f.name}: ${cap.pixels}, ${f.bytes} bytes (from ${f.from})`);
    console.log(`   copied ${cap.icon.name}: ${cap.icon.pixels}, ${cap.icon.bytes} bytes`);
    console.log(`${NAME}: wrote ${cap.count} screenshot(s), the icon and CAPTURE.json for ${APP}`);
    return;
  }

  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) coverageLost([`${appsDir} does not exist; there is no tree to check.`]);
  const apps = listDir(appsDir).filter((a) => existsSync(storeDir(ROOT, a, CHANNEL))).sort();
  if (!apps.length) coverageLost([`no apps/*/store/${CHANNEL} tree exists under ${ROOT}.`, 'The channel is in the register; zero trees means the walk looked in the wrong place, not that everything is fine.']);
  const problems = [];
  let checked = 0;
  for (const app of apps) {
    const r = checkApp(ROOT, app, rules);
    problems.push(...r.problems.map((p) => `${app}: ${p}`));
    for (const n of r.notes) console.log(`   ⬜ ${n}`);
    checked += r.checked;
  }
  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`\n${NAME}: FAILED`);
    process.exit(1);
  }
  if (checked === 0) coverageLost([`${apps.length} apps-gov-in tree(s) and not one derived file checked.`, 'Every tree is still underived; a check that looked at nothing is not a pass.']);
  // Read from this process's own start-up flags: remove the relaunch below and
  // this says ON, and apps-gov-in-media.test.mjs fails.
  console.log(`   ${backgroundTasksNote()}`);
  console.log(`${NAME}: ok — ${checked} file(s) re-derived or matched across ${apps.length} app(s)`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
// ── the process that does the work runs with V8 background tasks OFF ────────
// Inside `isMain`, NOT at module level as in assert-listing-assets.mjs, because
// this file is also a LIBRARY: apps-gov-in-media.test.mjs imports padToAspect,
// areaAverage, checkApp and writeApp, and a module-level relaunch would spawn
// this file again with the test runner's own arguments. argv passes through the
// relaunch unchanged, so `--write --app <app>` works exactly as before.
// `coverageLost` is a hoisted function declaration, so handing it over is safe.
if (isMain) {
  const relaunched = relaunchSingleThreaded(import.meta.url, process.argv.slice(2), coverageLost);
  if (relaunched !== null) process.exit(relaunched);
  main();
}
