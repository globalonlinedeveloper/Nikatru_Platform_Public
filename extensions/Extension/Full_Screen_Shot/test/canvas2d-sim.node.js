#!/usr/bin/env node
/* FullShot canvas2d rasterizer sim — grades test/pixel-sim/canvas2d.js itself.
   The fake canvas is the measuring instrument every other pixel test reads
   through, so it needs its own net: a broken rasterizer would otherwise show up
   as a mystery failure three tiers away, or worse, as a silent PASS.

   Two halves:
     (1) the NEW primitives U-1a added — state stack, transform, paths, stroke,
         text, alpha — each graded as "ink is here, background is there";
     (2) REGRESSION GUARDS on fillRect / drawImage / getImageData, which 35
         pixel-sim scenarios depend on byte-for-byte and which U-1a must not
         have moved by a single pixel.

   The last section replays the exact op sequence each pages/editor.js
   drawObject branch issues. It does NOT load editor.js — that is U-1b's job;
   this only proves the rasterizer speaks the whole vocabulary.

   Usage: node test/canvas2d-sim.node.js   [exit 0 = all pass]
   FS_CANVAS2D=<path> points the suite at a different rasterizer — that is how
   the fail-first run was done, against a copy of the pre-U-1a file. */
'use strict';
const path = require('path');
const { FakeCanvas } = require(process.env.FS_CANVAS2D
  ? path.resolve(process.env.FS_CANVAS2D) : './pixel-sim/canvas2d');

let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}

/* A paint script that throws must produce a readable red list, not a crash —
   an un-extended rasterizer throws on the very first ctx.save(). */
function scene(w, h, paint) {
  const cv = new FakeCanvas();
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  let err = null;
  try {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);          // white page, so "no ink" is assertable
    paint(ctx, cv);
  } catch (e) { err = String((e && e.message) || e); }
  return { cv, ctx, err };
}
function px(cv, x, y) {
  const o = (y * cv.width + x) * 4;
  return [cv._data[o], cv._data[o + 1], cv._data[o + 2], cv._data[o + 3]];
}
const isInk = p => p[0] !== 255 || p[1] !== 255 || p[2] !== 255;
const exact = (p, rgb) => p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2];
const near = (p, rgb, t) => Math.abs(p[0] - rgb[0]) <= t && Math.abs(p[1] - rgb[1]) <= t &&
                            Math.abs(p[2] - rgb[2]) <= t;

/* fold a paint-time throw into every check of that scene */
function ck(s, label, ok, extra) {
  check(label, !s.err && !!ok, s.err ? 'threw: ' + s.err : extra);
}
/* reading state back is a call too — a missing method must read as one red
   check, not as a stack trace that hides every check after it */
function probe(fn, fallback) {
  try { const v = fn(); return v === undefined ? fallback : v; }
  catch (e) { return fallback; }
}
function inkAt(s, x, y) { return !s.err && isInk(px(s.cv, x, y)); }
function inkRows(s, x, y0, y1) {   // how many rows in [y0,y1) carry ink at column x
  let n = 0;
  for (let y = y0; y < y1; y++) if (inkAt(s, x, y)) n++;
  return n;
}
function inkCols(s, y, x0, x1) {
  let n = 0;
  for (let x = x0; x < x1; x++) if (inkAt(s, x, y)) n++;
  return n;
}
function inkTotal(s) {
  let n = 0;
  for (let y = 0; y < s.cv.height; y++) for (let x = 0; x < s.cv.width; x++) if (inkAt(s, x, y)) n++;
  return n;
}
function makeImg(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rgb = fn(x, y), o = (y * w + x) * 4;
    d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
  }
  return { width: w, height: h, data: d };
}

const RED = [239, 68, 68];         // COLORS[0] in pages/editor.js

/* ================= 1 · state stack ================= */
console.log('\n=== canvas2d: save / restore ===');
{
  const s = scene(40, 40, (ctx) => {
    ctx.save();
    ctx.fillStyle = '#ef4444'; ctx.strokeStyle = '#123456'; ctx.lineWidth = 9;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.35;
    ctx.font = '700 22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.setLineDash([6, 4]); ctx.imageSmoothingEnabled = false;
    ctx.translate(10, 10);
    ctx.restore();
  });
  ck(s, 'restore pops fillStyle', s.ctx && s.ctx.fillStyle === '#ffffff', s.ctx && s.ctx.fillStyle);
  ck(s, 'restore pops strokeStyle', s.ctx && s.ctx.strokeStyle === '#000000', s.ctx && s.ctx.strokeStyle);
  ck(s, 'restore pops lineWidth', s.ctx && s.ctx.lineWidth === 1, s.ctx && s.ctx.lineWidth);
  ck(s, 'restore pops lineCap', s.ctx && s.ctx.lineCap === 'butt', s.ctx && s.ctx.lineCap);
  ck(s, 'restore pops lineJoin', s.ctx && s.ctx.lineJoin === 'miter', s.ctx && s.ctx.lineJoin);
  ck(s, 'restore pops globalAlpha', s.ctx && s.ctx.globalAlpha === 1, s.ctx && s.ctx.globalAlpha);
  ck(s, 'restore pops font', s.ctx && s.ctx.font === '10px sans-serif', s.ctx && s.ctx.font);
  ck(s, 'restore pops textAlign', s.ctx && s.ctx.textAlign === 'start', s.ctx && s.ctx.textAlign);
  ck(s, 'restore pops textBaseline', s.ctx && s.ctx.textBaseline === 'alphabetic', s.ctx && s.ctx.textBaseline);
  ck(s, 'restore pops the line dash', probe(() => s.ctx.getLineDash().length, -1) === 0,
    JSON.stringify(probe(() => s.ctx.getLineDash(), null)));
  ck(s, 'restore pops imageSmoothingEnabled', s.ctx && s.ctx.imageSmoothingEnabled === true,
    s.ctx && s.ctx.imageSmoothingEnabled);
}
{
  // The transform is the one restore() is most often quietly wrong about.
  const s = scene(40, 40, (ctx) => {
    ctx.save();
    ctx.translate(10, 10);
    ctx.restore();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(0, 0, 4, 4);
  });
  ck(s, 'restore pops the transform (ink at 0,0)', inkAt(s, 1, 1), px(s.cv, 1, 1).join(','));
  ck(s, 'restore pops the transform (nothing at 10,10)', !inkAt(s, 11, 11), px(s.cv, 11, 11).join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.save(); ctx.translate(5, 0);
    ctx.save(); ctx.translate(0, 5);
    ctx.fillRect(0, 0, 3, 3);            // -> (5,5)
    ctx.restore();
    ctx.fillRect(0, 0, 3, 3);            // -> (5,0)
    ctx.restore();
    ctx.fillRect(0, 0, 3, 3);            // -> (0,0)
  });
  ck(s, 'nested save/restore unwinds one level at a time', inkAt(s, 6, 6) && inkAt(s, 6, 1) && inkAt(s, 1, 1),
    [inkAt(s, 6, 6), inkAt(s, 6, 1), inkAt(s, 1, 1)].join(','));
  ck(s, 'nested save/restore leaves nothing at (0,5)', !inkAt(s, 1, 6), px(s.cv, 1, 6).join(','));
}
{
  const s = scene(8, 8, (ctx) => { ctx.restore(); ctx.restore(); });
  ck(s, 'restore on an empty stack is a no-op', !s.err, s.err);
}

/* ================= 2 · transform ================= */
console.log('\n=== canvas2d: transform ===');
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.translate(8, 6);
    ctx.fillRect(0, 0, 4, 4);
    ctx.translate(10, 0);
    ctx.fillRect(0, 0, 4, 4);
  });
  ck(s, 'translate offsets fillRect', inkAt(s, 9, 7) && !inkAt(s, 7, 7), px(s.cv, 9, 7).join(','));
  ck(s, 'translate is cumulative', inkAt(s, 19, 7), px(s.cv, 19, 7).join(','));
}
{
  const img = makeImg(4, 4, () => [0, 128, 255]);
  const s = scene(40, 40, (ctx) => { ctx.translate(6, 9); ctx.drawImage(img, 0, 0); });
  ck(s, 'translate offsets drawImage', exact(px(s.cv, 7, 10), [0, 128, 255]), px(s.cv, 7, 10).join(','));
  ck(s, 'translate offsets drawImage (origin is clean)', !inkAt(s, 1, 1), px(s.cv, 1, 1).join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.scale(2, 2);
    ctx.fillRect(2, 2, 4, 4);            // -> device (4,4,8,8)
  });
  ck(s, 'scale(2,2) doubles the rect', inkAt(s, 5, 5) && inkAt(s, 11, 11), '');
  ck(s, 'scale(2,2) stops at the scaled edge', !inkAt(s, 12, 12) && !inkAt(s, 3, 3), '');
}
{
  const s = scene(60, 60, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.translate(30, 30);
    ctx.rotate(Math.PI / 2);
    ctx.fillRect(0, 0, 20, 4);           // wide in user space -> tall in device space
  });
  ck(s, 'rotate turns a wide rect into a tall one', inkAt(s, 28, 40) && !inkAt(s, 40, 31),
    [inkAt(s, 28, 40), inkAt(s, 40, 31)].join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.translate(9, 9);
    ctx.resetTransform();
    ctx.fillRect(0, 0, 3, 3);
  });
  ck(s, 'resetTransform clears the translate', inkAt(s, 1, 1) && !inkAt(s, 10, 10), '');
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.setTransform(1, 0, 0, 1, 12, 4);
    ctx.fillRect(0, 0, 3, 3);
  });
  ck(s, 'setTransform replaces the matrix', inkAt(s, 13, 5), px(s.cv, 13, 5).join(','));
}

/* ================= 3 · clearRect ================= */
console.log('\n=== canvas2d: clearRect ===');
{
  const s = scene(20, 20, (ctx) => { ctx.clearRect(4, 4, 6, 6); });
  ck(s, 'clearRect zeroes alpha inside', px(s.cv, 5, 5)[3] === 0, px(s.cv, 5, 5).join(','));
  ck(s, 'clearRect leaves the outside opaque', px(s.cv, 2, 2)[3] === 255, px(s.cv, 2, 2).join(','));
  ck(s, 'clearRect stops at its right edge', px(s.cv, 10, 5)[3] === 255, px(s.cv, 10, 5).join(','));
}
{
  const s = scene(20, 20, (ctx) => { ctx.translate(5, 5); ctx.clearRect(0, 0, 4, 4); });
  ck(s, 'clearRect honours the translate', px(s.cv, 6, 6)[3] === 0 && px(s.cv, 2, 2)[3] === 255,
    px(s.cv, 6, 6).join(',') + ' / ' + px(s.cv, 2, 2).join(','));
}

/* ================= 4 · path fill ================= */
console.log('\n=== canvas2d: beginPath / lineTo / closePath / fill ===');
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(20, 4); ctx.lineTo(34, 30); ctx.lineTo(6, 30);
    ctx.closePath(); ctx.fill();
  });
  ck(s, 'a closed triangle fills its interior', exact(px(s.cv, 20, 22), RED), px(s.cv, 20, 22).join(','));
  ck(s, 'a closed triangle leaves its corners clean', !inkAt(s, 7, 7) && !inkAt(s, 33, 7), '');
  ck(s, 'a closed triangle stops at its base', !inkAt(s, 20, 34), px(s.cv, 20, 34).join(','));
}
{
  // pages/editor.js render(): rect(outer) + rect(inner) + fill('evenodd') is
  // how the pending crop dims everything outside the selection.
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.rect(4, 4, 32, 32);
    ctx.rect(14, 14, 12, 12);
    ctx.fill('evenodd');
  });
  ck(s, "fill('evenodd') inks the outer ring", inkAt(s, 8, 20), px(s.cv, 8, 20).join(','));
  ck(s, "fill('evenodd') punches the inner hole", !inkAt(s, 20, 20), px(s.cv, 20, 20).join(','));
  ck(s, "fill('evenodd') leaves outside the outer rect clean", !inkAt(s, 1, 1), '');
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.rect(4, 4, 32, 32);
    ctx.rect(14, 14, 12, 12);
    ctx.fill();                          // default nonzero -> no hole
  });
  ck(s, 'fill() defaults to nonzero (no hole)', inkAt(s, 20, 20), px(s.cv, 20, 20).join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.rect(4, 4, 10, 10);
    ctx.beginPath(); ctx.rect(20, 20, 10, 10);
    ctx.fill();
  });
  ck(s, 'beginPath discards the previous subpaths', inkAt(s, 25, 25) && !inkAt(s, 8, 8),
    [inkAt(s, 25, 25), inkAt(s, 8, 8)].join(','));
}

/* ================= 5 · stroke ================= */
console.log('\n=== canvas2d: stroke ===');
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(6, 20); ctx.lineTo(34, 20); ctx.stroke();
  });
  ck(s, 'a horizontal stroke of lineWidth 8 covers 8 rows', inkRows(s, 20, 0, 40) === 8, inkRows(s, 20, 0, 40));
  ck(s, 'a horizontal stroke is centred on the line', inkAt(s, 20, 19) && inkAt(s, 20, 20), '');
  ck(s, 'a horizontal stroke paints its own colour', exact(px(s.cv, 20, 20), RED), px(s.cv, 20, 20).join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(6, 20); ctx.lineTo(34, 20); ctx.stroke();
  });
  ck(s, 'stroke honours lineWidth (2 -> 2 rows)', inkRows(s, 20, 0, 40) === 2, inkRows(s, 20, 0, 40));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(20, 6); ctx.lineTo(20, 34); ctx.stroke();
  });
  ck(s, 'a vertical stroke of lineWidth 6 covers 6 columns', inkCols(s, 20, 0, 40) === 6, inkCols(s, 20, 0, 40));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(34, 34); ctx.stroke();
  });
  ck(s, 'a diagonal stroke inks its midpoint', inkAt(s, 20, 20), px(s.cv, 20, 20).join(','));
  ck(s, 'a diagonal stroke leaves the off-diagonal clean', !inkAt(s, 30, 10), px(s.cv, 30, 10).join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(6, 10); ctx.lineTo(30, 10); ctx.lineTo(30, 34); ctx.stroke();
  });
  ck(s, 'a polyline inks both legs', inkAt(s, 15, 10) && inkAt(s, 30, 25), '');
  ck(s, 'a polyline inks the join', inkAt(s, 30, 10), px(s.cv, 30, 10).join(','));
}
{
  const round = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(12, 20); ctx.lineTo(28, 20); ctx.stroke();
  });
  const butt = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 10; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(12, 20); ctx.lineTo(28, 20); ctx.stroke();
  });
  ck(round, "lineCap 'round' paints past the endpoint", inkAt(round, 9, 20), px(round.cv, 9, 20).join(','));
  ck(butt, "lineCap 'butt' stops at the endpoint", !inkAt(butt, 9, 20), px(butt.cv, 9, 20).join(','));
  ck(butt, "lineCap 'butt' still paints the segment", inkAt(butt, 20, 20), '');
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
    ctx.translate(10, 10);
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(20, 5); ctx.stroke();
  });
  ck(s, 'stroke honours the transform', inkAt(s, 20, 15) && !inkAt(s, 20, 5), '');
}

/* ================= 6 · strokeRect ================= */
console.log('\n=== canvas2d: strokeRect ===');
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 24, 20);
  });
  ck(s, 'strokeRect inks the top edge', inkAt(s, 20, 8), px(s.cv, 20, 8).join(','));
  ck(s, 'strokeRect inks the bottom edge', inkAt(s, 20, 27), px(s.cv, 20, 27).join(','));
  ck(s, 'strokeRect inks the left edge', inkAt(s, 8, 18), px(s.cv, 8, 18).join(','));
  ck(s, 'strokeRect inks the right edge', inkAt(s, 31, 18), px(s.cv, 31, 18).join(','));
  ck(s, 'strokeRect leaves the middle clean', !inkAt(s, 20, 18), px(s.cv, 20, 18).join(','));
  ck(s, 'strokeRect inks all four corners', inkAt(s, 8, 8) && inkAt(s, 31, 8) && inkAt(s, 8, 27) && inkAt(s, 31, 27), '');
  ck(s, 'strokeRect edge thickness follows lineWidth', inkRows(s, 20, 0, 20) === 4, inkRows(s, 20, 0, 20));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444'; ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(4, 4, 8, 8);
    ctx.strokeRect(20, 20, 8, 8);
    ctx.fill();                          // must still see the rect(4,4,8,8) path
  });
  ck(s, 'strokeRect does not disturb the current path', exact(px(s.cv, 8, 8), RED), px(s.cv, 8, 8).join(','));
}

/* ================= 7 · arc / ellipse ================= */
console.log('\n=== canvas2d: arc / ellipse ===');
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(20, 20, 10, 0, Math.PI * 2); ctx.fill();
  });
  ck(s, 'arc + fill makes a solid disc', exact(px(s.cv, 20, 20), RED), px(s.cv, 20, 20).join(','));
  ck(s, 'the disc reaches its radius', inkAt(s, 28, 20) && inkAt(s, 20, 12), '');
  ck(s, 'the disc stops at its radius', !inkAt(s, 31, 20) && !inkAt(s, 20, 9), '');
  ck(s, 'the disc leaves the bbox corners clean', !inkAt(s, 11, 11) && !inkAt(s, 29, 29), '');
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(20, 20, 14, 8, 0, 0, Math.PI * 2); ctx.stroke();
  });
  ck(s, 'ellipse + stroke inks the left and right rim', inkAt(s, 6, 20) && inkAt(s, 33, 20),
    [inkAt(s, 6, 20), inkAt(s, 33, 20)].join(','));
  ck(s, 'ellipse + stroke inks the top and bottom rim', inkAt(s, 20, 12) && inkAt(s, 20, 27),
    [inkAt(s, 20, 12), inkAt(s, 20, 27)].join(','));
  ck(s, 'ellipse + stroke leaves the centre clean', !inkAt(s, 20, 20), px(s.cv, 20, 20).join(','));
  ck(s, 'ellipse respects rx != ry', !inkAt(s, 20, 5), px(s.cv, 20, 5).join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.fillStyle = '#ef4444';
    ctx.translate(10, 10);
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
  });
  ck(s, 'arc honours the transform', inkAt(s, 10, 10) && !inkAt(s, 1, 1), '');
}

/* ================= 8 · curves ================= */
console.log('\n=== canvas2d: quadraticCurveTo / bezierCurveTo ===');
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(5, 30); ctx.quadraticCurveTo(20, 2, 35, 30); ctx.stroke();
  });
  ck(s, 'quadraticCurveTo bows away from the chord', inkAt(s, 20, 16), px(s.cv, 20, 16).join(','));
  ck(s, 'quadraticCurveTo runs from end to end', inkAt(s, 6, 27) && inkAt(s, 33, 27),
    [inkAt(s, 6, 27), inkAt(s, 33, 27)].join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(5, 20); ctx.bezierCurveTo(15, 2, 25, 38, 35, 20); ctx.stroke();
  });
  ck(s, 'bezierCurveTo renders an S curve', inkAt(s, 11, 14) && inkAt(s, 28, 25),
    [inkAt(s, 11, 14), inkAt(s, 28, 25)].join(','));
  ck(s, 'bezierCurveTo crosses its own chord midpoint', inkAt(s, 20, 20), px(s.cv, 20, 20).join(','));
}

/* ================= 9 · line dash ================= */
console.log('\n=== canvas2d: setLineDash ===');
{
  const s = scene(60, 20, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(2, 10); ctx.lineTo(58, 10); ctx.stroke();
  });
  const on = inkCols(s, 9, 2, 58);
  ck(s, 'a dashed line leaves gaps', !s.err && on > 10 && on < 50, 'inked columns=' + on);
  ck(s, 'a dashed line starts with ink', inkAt(s, 3, 9), px(s.cv, 3, 9).join(','));
  ck(s, 'getLineDash reports the pattern',
    JSON.stringify(probe(() => s.ctx.getLineDash(), null)) === '[6,4]',
    JSON.stringify(probe(() => s.ctx.getLineDash(), null)));
}
{
  const s = scene(60, 20, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(2, 10); ctx.lineTo(58, 10); ctx.stroke();
  });
  ck(s, 'setLineDash([]) goes back to solid', inkCols(s, 9, 3, 57) === 54, inkCols(s, 9, 3, 57));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.strokeRect(8, 8, 24, 24);
  });
  const on = inkCols(s, 8, 8, 32);
  ck(s, 'a dashed strokeRect is dashed on its top edge', !s.err && on > 4 && on < 22, 'inked=' + on);
}

/* ================= 10 · globalAlpha ================= */
console.log('\n=== canvas2d: globalAlpha ===');
{
  const s = scene(20, 20, (ctx) => {
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#ff0000'; ctx.fillRect(2, 2, 10, 10);
  });
  ck(s, 'globalAlpha 0.5 blends fillRect over white', near(px(s.cv, 5, 5), [255, 128, 128], 1),
    px(s.cv, 5, 5).join(','));
}
{
  const s = scene(20, 20, (ctx) => {
    ctx.globalAlpha = 1; ctx.fillStyle = '#ef4444'; ctx.fillRect(2, 2, 10, 10);
  });
  ck(s, 'globalAlpha 1 writes the exact colour', exact(px(s.cv, 5, 5), RED), px(s.cv, 5, 5).join(','));
}
{
  const s = scene(40, 40, (ctx) => {
    ctx.globalAlpha = 0.5; ctx.strokeStyle = '#000000'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(5, 20); ctx.lineTo(35, 20); ctx.stroke();
  });
  ck(s, 'globalAlpha blends stroke too', near(px(s.cv, 20, 19), [128, 128, 128], 1),
    px(s.cv, 20, 19).join(','));
}
{
  // pages/editor.js highlighter: one stroke() at alpha 0.35 over a polyline that
  // doubles back. A per-primitive blend would darken the overlap; the mask must
  // be composited once.
  const s = scene(40, 40, (ctx) => {
    ctx.globalAlpha = 0.5; ctx.strokeStyle = '#000000'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(8, 20); ctx.lineTo(32, 20); ctx.lineTo(8, 20); ctx.stroke();
  });
  ck(s, 'one stroke() does not double-darken its own overlap',
    near(px(s.cv, 20, 20), [128, 128, 128], 1), px(s.cv, 20, 20).join(','));
}
{
  const s = scene(20, 20, (ctx) => {
    ctx.globalAlpha = 0; ctx.fillStyle = '#000000'; ctx.fillRect(2, 2, 10, 10);
  });
  ck(s, 'globalAlpha 0 paints nothing', !inkAt(s, 5, 5), px(s.cv, 5, 5).join(','));
}

/* ================= 11 · colour parsing ================= */
console.log('\n=== canvas2d: colours ===');
function colorScene(style) {
  return scene(10, 10, (ctx) => { ctx.fillStyle = style; ctx.fillRect(2, 2, 6, 6); });
}
{
  let s = colorScene('#ef4444');
  ck(s, "'#ef4444' is exact", exact(px(s.cv, 5, 5), RED), px(s.cv, 5, 5).join(','));
  s = colorScene('#08f');
  ck(s, "'#08f' expands to 00 88 ff", exact(px(s.cv, 5, 5), [0, 136, 255]), px(s.cv, 5, 5).join(','));
  s = colorScene('#fff');
  ck(s, "'#fff' is white (pages/result.js uses it)", exact(px(s.cv, 5, 5), [255, 255, 255]),
    px(s.cv, 5, 5).join(','));
  s = colorScene('rgb(1,2,3)');
  ck(s, "'rgb(1,2,3)' is exact", exact(px(s.cv, 5, 5), [1, 2, 3]), px(s.cv, 5, 5).join(','));
  s = colorScene('rgba(0,0,0,0.4)');
  ck(s, "'rgba(0,0,0,0.4)' over white is 153 (editor's crop dim)", near(px(s.cv, 5, 5), [153, 153, 153], 1),
    px(s.cv, 5, 5).join(','));
  s = colorScene('rgba(255,255,255,0.9)');
  ck(s, "'rgba(255,255,255,0.9)' keeps its alpha", px(s.cv, 5, 5)[3] === 255, px(s.cv, 5, 5).join(','));
  s = colorScene('papayawhip');
  ck(s, 'an unknown keyword still falls back to white', exact(px(s.cv, 5, 5), [255, 255, 255]),
    px(s.cv, 5, 5).join(','));
}

/* ================= 12 · text ================= */
console.log('\n=== canvas2d: fillText ===');
{
  const s = scene(120, 60, (ctx) => {
    ctx.fillStyle = '#ef4444'; ctx.font = '600 20px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('AB', 10, 10);
  });
  ck(s, 'fillText puts ink down', inkTotal(s) > 0, 'ink px=' + inkTotal(s));
  // (12,18) is the crossbar row of 'A' — row 0 of that glyph is '.#.'
  ck(s, 'fillText paints in fillStyle', !s.err && exact(px(s.cv, 12, 18), RED), px(s.cv, 12, 18).join(','));
  ck(s, "textBaseline 'top' keeps ink below y", inkCols(s, 9, 0, 120) === 0, inkCols(s, 9, 0, 120));
  ck(s, "textBaseline 'top' keeps ink inside the em box",
    inkCols(s, 31, 0, 120) === 0, inkCols(s, 31, 0, 120));
  ck(s, 'fillText advances 0.6em per character',
    !s.err && inkCols(s, 20, 0, 120) > 0 && inkCols(s, 20, 34, 120) === 0,
    'ink beyond 2 advances=' + inkCols(s, 20, 34, 120));
}
{
  const left = scene(120, 40, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.font = '20px system-ui'; ctx.textBaseline = 'top';
    ctx.fillText('88', 60, 10);
  });
  const centre = scene(120, 40, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.font = '20px system-ui'; ctx.textBaseline = 'top';
    ctx.textAlign = 'center'; ctx.fillText('88', 60, 10);
  });
  const right = scene(120, 40, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.font = '20px system-ui'; ctx.textBaseline = 'top';
    ctx.textAlign = 'right'; ctx.fillText('88', 60, 10);
  });
  ck(left, "textAlign default starts at x", inkCols(left, 15, 0, 60) === 0 && inkCols(left, 15, 60, 120) > 0, '');
  ck(centre, "textAlign 'center' straddles x", inkCols(centre, 15, 0, 60) > 0 && inkCols(centre, 15, 60, 120) > 0, '');
  ck(right, "textAlign 'right' ends at x", inkCols(right, 15, 0, 60) > 0 && inkCols(right, 15, 60, 120) === 0, '');
}
{
  const top = scene(60, 60, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.font = '20px system-ui'; ctx.textBaseline = 'top';
    ctx.fillText('8', 10, 30);
  });
  const mid = scene(60, 60, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.font = '20px system-ui'; ctx.textBaseline = 'middle';
    ctx.fillText('8', 10, 30);
  });
  ck(top, "textBaseline 'top' draws below y", inkCols(top, 25, 0, 60) === 0 && inkCols(top, 35, 0, 60) > 0, '');
  ck(mid, "textBaseline 'middle' straddles y", inkCols(mid, 25, 0, 60) > 0 && inkCols(mid, 35, 0, 60) > 0, '');
}
{
  const one = scene(60, 60, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.font = '700 24px system-ui'; ctx.textBaseline = 'top';
    ctx.fillText('1', 10, 10);
  });
  const eight = scene(60, 60, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.font = '700 24px system-ui'; ctx.textBaseline = 'top';
    ctx.fillText('8', 10, 10);
  });
  ck(one, "the glyphs for '1' and '8' differ (step badges are readable)",
    !one.err && !eight.err && inkTotal(one) !== inkTotal(eight),
    inkTotal(one) + ' vs ' + inkTotal(eight));
  ck(one, "'1' still puts ink inside its cell", inkTotal(one) > 0, inkTotal(one));
}
{
  const s = scene(60, 60, (ctx) => {
    ctx.font = '32px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText('\u{1F600}', 30, 30);
  });
  ck(s, 'an emoji renders as a solid block (no font engine)', inkAt(s, 30, 30), px(s.cv, 30, 30).join(','));
  ck(s, 'the emoji block stays inside its em box', !inkAt(s, 2, 2), px(s.cv, 2, 2).join(','));
}
{
  const s = scene(10, 10, () => {});
  const w = probe(() => s.ctx.measureText('abcde').width, -1);
  s.ctx.font = '20px system-ui';
  const w20 = probe(() => s.ctx.measureText('abcde').width, -1);
  ck(s, 'measureText scales with the font size', w20 === 5 * 20 * 0.6, w20);
  ck(s, 'measureText uses the default 10px font when unset', w === 5 * 10 * 0.6, w);
}
{
  const s = scene(60, 60, (ctx) => {
    ctx.strokeStyle = '#ef4444'; ctx.font = '24px system-ui'; ctx.textBaseline = 'top';
    ctx.strokeText('8', 10, 10);
  });
  ck(s, 'strokeText paints in strokeStyle', !s.err && inkTotal(s) > 0 && exact(px(s.cv, 12, 12), RED),
    px(s.cv, 12, 12).join(','));
}

/* ================= 13 · regression guards ================= */
console.log('\n=== canvas2d: pre-U-1a behaviour must not have moved ===');
{
  /* fillRect's edge rule is Math.round(x) .. Math.round(x+w) — NOT pixel-centre
     coverage. This guard is the ONLY thing watching it (see the note in the
     canvas2d.js header), so it has to separate round from BOTH neighbours on
     BOTH axes. A single rect cannot: at .4 edges round agrees with floor, at .6
     it agrees with ceil, and the guard this replaced sampled only .4/.6 corners
     where the x axis happened to agree — an x-only round->floor regression
     passed all eight tiers. Two rects, four edges each, x and y asserted
     separately so neither axis can hide behind the other. */
  const RECTS = [
    // x,   y,   w,  h,  first/last inked col, first/last inked row
    // .6 edges: round gives 11..20 and 6..15, where floor would give 10..19 / 5..14
    { r: [10.6, 5.6, 10, 10], x0: 11, x1: 20, y0: 6, y1: 15, vs: 'floor' },
    // .4 edges: round gives 10..19 and 5..14, where ceil would give 11..20 / 6..15
    { r: [10.4, 5.4, 10, 10], x0: 10, x1: 19, y0: 5, y1: 14, vs: 'ceil' }
  ];
  for (const t of RECTS) {
    const s = scene(40, 40, (ctx) => { ctx.fillStyle = '#ef4444'; ctx.fillRect(t.r[0], t.r[1], t.r[2], t.r[3]); });
    const my = t.y0 + 2, mx = t.x0 + 2;   // a row/column safely inside the rect
    ck(s, 'fillRect(' + t.r[0] + ',' + t.r[1] + ') keeps the round() LEFT edge, not ' + t.vs + '()',
      inkAt(s, t.x0, my) && !inkAt(s, t.x0 - 1, my), 'col ' + t.x0);
    ck(s, 'fillRect(' + t.r[0] + ',' + t.r[1] + ') keeps the round() RIGHT edge, not ' + t.vs + '()',
      inkAt(s, t.x1, my) && !inkAt(s, t.x1 + 1, my), 'col ' + t.x1);
    ck(s, 'fillRect(' + t.r[0] + ',' + t.r[1] + ') keeps the round() TOP edge, not ' + t.vs + '()',
      inkAt(s, mx, t.y0) && !inkAt(s, mx, t.y0 - 1), 'row ' + t.y0);
    ck(s, 'fillRect(' + t.r[0] + ',' + t.r[1] + ') keeps the round() BOTTOM edge, not ' + t.vs + '()',
      inkAt(s, mx, t.y1) && !inkAt(s, mx, t.y1 + 1), 'row ' + t.y1);
    ck(s, 'fillRect(' + t.r[0] + ',' + t.r[1] + ') writes alpha 255', px(s.cv, mx, my)[3] === 255, px(s.cv, mx, my)[3]);
  }
}
{
  const img = makeImg(4, 4, (x, y) => [x * 10, y * 10, 7]);
  const s = scene(20, 20, (ctx) => { ctx.drawImage(img, 2, 3); });
  ck(s, 'drawImage 1:1 copies pixel (0,0)', exact(px(s.cv, 2, 3), [0, 0, 7]), px(s.cv, 2, 3).join(','));
  ck(s, 'drawImage 1:1 copies pixel (3,3)', exact(px(s.cv, 5, 6), [30, 30, 7]), px(s.cv, 5, 6).join(','));
  ck(s, 'drawImage 1:1 does not overrun', !inkAt(s, 6, 6), px(s.cv, 6, 6).join(','));
}
{
  /* The sampling rule is floor(o * s / d) — nearest-neighbour anchored to the
     LEFT of each destination pixel. An even->even downscale cannot grade it:
     4->2 samples 0 and 2 under both floor and round, so the guard this replaced
     was structurally blind to the rule it named. 3->2 is the smallest ratio
     where they part company (floor picks source 1, round picks source 2), and
     both axes are exercised because syy and sxx carry the rule separately. */
  const cols = makeImg(3, 1, (x) => [x * 120, x * 120, x * 120]);
  const s = scene(20, 20, (ctx) => { ctx.drawImage(cols, 0, 0, 3, 1, 0, 0, 2, 1); });
  ck(s, 'drawImage 3->2 downscale samples with floor() across x, not round()',
    exact(px(s.cv, 0, 0), [0, 0, 0]) && exact(px(s.cv, 1, 0), [120, 120, 120]),
    px(s.cv, 0, 0).join(',') + ' / ' + px(s.cv, 1, 0).join(','));

  const rows = makeImg(1, 3, (x, y) => [y * 120, y * 120, y * 120]);
  const s2 = scene(20, 20, (ctx) => { ctx.drawImage(rows, 0, 0, 1, 3, 0, 0, 1, 2); });
  ck(s2, 'drawImage 3->2 downscale samples with floor() down y, not round()',
    exact(px(s2.cv, 0, 0), [0, 0, 0]) && exact(px(s2.cv, 0, 1), [120, 120, 120]),
    px(s2.cv, 0, 0).join(',') + ' / ' + px(s2.cv, 0, 1).join(','));

  // The even case still has to hold — the rule did not change, only the guard.
  const img = makeImg(4, 4, (x, y) => [x * 10, y * 10, 7]);
  const s3 = scene(20, 20, (ctx) => { ctx.drawImage(img, 0, 0, 4, 4, 0, 0, 2, 2); });
  ck(s3, 'drawImage 4->2 downscale keeps nearest-neighbour sampling',
    exact(px(s3.cv, 0, 0), [0, 0, 7]) && exact(px(s3.cv, 1, 1), [20, 20, 7]),
    px(s3.cv, 0, 0).join(',') + ' / ' + px(s3.cv, 1, 1).join(','));
}
{
  /* drawImage composites SOURCE-OVER, on every path. The identity/opaque fast
     path used to row-copy the source straight in, which destroys the
     destination wherever the source is transparent — the opposite of what a
     browser does, and the reason the white underlay six shipped call sites
     paint (pages/result.js:751, :797, :709, pages/beautify.js:104, :157,
     pages/scrollclip.js:86, pages/editor.js:645) could not be graded at all:
     deleting any of those fills was invisible to the sim. The pair of checks
     below is the point: the two paths must agree, and both must agree with the
     browser. globalAlpha 0.999 is what forces the slow path. */
  const clear = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 255, 0]) };
  const half = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 254, 128]) };

  const fast = scene(4, 4, (ctx) => { ctx.drawImage(clear, 0, 0); });
  ck(fast, 'a fully transparent source leaves the white underlay standing',
    exact(px(fast.cv, 0, 0), [255, 255, 255]) && px(fast.cv, 0, 0)[3] === 255, px(fast.cv, 0, 0).join(','));

  const slow = scene(4, 4, (ctx) => { ctx.globalAlpha = 0.999; ctx.drawImage(clear, 0, 0); });
  ck(slow, '...and the scaled/translucent path agrees with it',
    px(slow.cv, 0, 0).join(',') === px(fast.cv, 0, 0).join(','),
    px(fast.cv, 0, 0).join(',') + ' vs ' + px(slow.cv, 0, 0).join(','));

  /* alpha 128 over white: the rasterizer's un-premultiplied blend rounds to 127
     where a browser gives 128. That one step is the whole rasterizer's
     convention (_paint and fillRect share the formula), disclosed in the
     canvas2d.js header — it is asserted here exactly so it stays a known,
     single, documented step rather than drifting. */
  const fastH = scene(4, 4, (ctx) => { ctx.drawImage(half, 0, 0); });
  ck(fastH, 'a half-transparent source blends with what is under it',
    exact(px(fastH.cv, 0, 0), [127, 127, 254]) && px(fastH.cv, 0, 0)[3] === 255, px(fastH.cv, 0, 0).join(','));

  const slowH = scene(4, 4, (ctx) => { ctx.globalAlpha = 0.999; ctx.drawImage(half, 0, 0); });
  ck(slowH, '...and the fast and slow paths agree on it exactly',
    px(slowH.cv, 0, 0).join(',') === px(fastH.cv, 0, 0).join(','),
    px(fastH.cv, 0, 0).join(',') + ' vs ' + px(slowH.cv, 0, 0).join(','));

  // The opaque case is the hot path for the stitcher and must still be a copy.
  const opaque = makeImg(3, 3, (x, y) => [x * 30, y * 30, 9]);
  const o = scene(8, 8, (ctx) => { ctx.drawImage(opaque, 1, 1); });
  ck(o, 'an opaque source still replaces, byte for byte',
    exact(px(o.cv, 1, 1), [0, 0, 9]) && exact(px(o.cv, 3, 3), [60, 60, 9]) && !inkAt(o, 4, 4),
    px(o.cv, 1, 1).join(',') + ' / ' + px(o.cv, 3, 3).join(','));
}
{
  const s = scene(20, 20, (ctx) => { ctx.fillStyle = '#ef4444'; ctx.fillRect(4, 4, 4, 4); });
  const d = probe(() => s.ctx.getImageData(4, 4, 2, 2), null);
  ck(s, 'getImageData reads back what was written',
    !!d && d.width === 2 && d.height === 2 && d.data[0] === 239 && d.data[1] === 68 && d.data[2] === 68,
    d && Array.from(d.data.slice(0, 4)).join(','));
}
{
  /* A window that overhangs the canvas must pad with transparent black, as a
     browser does. Reading w pixels from the row start runs straight into the
     FOLLOWING row and hands back neighbouring pixels as if they were this
     row's — a silent wrong answer from the measuring instrument itself. No
     shipped call site overhangs today; this exists so none ever can. */
  const s = scene(4, 2, (ctx) => {
    ctx.fillStyle = '#ef4444'; ctx.fillRect(0, 0, 4, 1);        // row 0 red
    ctx.fillStyle = '#22c55e'; ctx.fillRect(0, 1, 4, 1);        // row 1 green
  });
  const d = probe(() => s.ctx.getImageData(0, 0, 6, 1), null);
  ck(s, 'getImageData pads past the right edge instead of reading the next row',
    !!d && d.data[16 + 3] === 0 && d.data[20 + 3] === 0 && d.data[0] === 239,
    d && [d.data[12], d.data[16], d.data[17], d.data[20]].join(','));
  const dl = probe(() => s.ctx.getImageData(-2, 0, 4, 1), null);
  ck(s, '...and pads past the left edge rather than reading backwards',
    !!dl && dl.data[3] === 0 && dl.data[7] === 0 && dl.data[8] === 239,
    dl && Array.from(dl.data.slice(0, 12)).join(','));
}
{
  // beautify.js FEATURE-DETECTS these to pick its shim path (beautify.js:93-156).
  // Defining any of them here silently reroutes beautify-sim onto the untested
  // browser path — C-3 owns that switch, not U-1a.
  const s = scene(4, 4, () => {});
  ck(s, 'ctx.clip stays undefined (beautify.js shim path)', typeof s.ctx.clip === 'undefined', typeof s.ctx.clip);
  ck(s, 'ctx.arcTo stays undefined (beautify.js shim path)', typeof s.ctx.arcTo === 'undefined', typeof s.ctx.arcTo);
  ck(s, 'ctx.createLinearGradient stays undefined', typeof s.ctx.createLinearGradient === 'undefined',
    typeof s.ctx.createLinearGradient);
  ck(s, 'shadowBlur stays absent', !('shadowBlur' in s.ctx) && typeof s.ctx.shadowBlur === 'undefined', '');
  ck(s, 'imageSmoothingQuality stays undefined', typeof s.ctx.imageSmoothingQuality === 'undefined',
    typeof s.ctx.imageSmoothingQuality);
}

/* ================= 14 · the editor's drawObject vocabulary =================
   The exact op sequence each pages/editor.js:287-382 branch issues, replayed by
   hand. This does NOT load editor.js — U-1b owns that — it only proves the
   rasterizer answers every call the editor makes. */
console.log('\n=== canvas2d: pages/editor.js drawObject op vocabulary ===');
const BASE = makeImg(200, 200, (x, y) => [(x * 3) & 255, (y * 3) & 255, 128]);

function drawScene(paint) {
  return scene(120, 120, (ctx) => { ctx.save(); ctx.translate(0, 0); paint(ctx); ctx.restore(); });
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    [[20, 20], [60, 40], [90, 90]].forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
    ctx.restore();
  });
  ck(s, "drawObject 'pen' renders", inkAt(s, 40, 30) && inkAt(s, 75, 65), '');
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 16; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(20, 60); ctx.lineTo(100, 60); ctx.stroke();
    ctx.restore();
  });
  ck(s, "drawObject 'hl' renders translucent", !s.err && isInk(px(s.cv, 60, 60)) &&
    px(s.cv, 60, 60)[1] > 150, px(s.cv, 60, 60).join(','));
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    ctx.strokeStyle = '#ef4444'; ctx.fillStyle = '#ef4444'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(20, 20); ctx.lineTo(90, 80); ctx.stroke();
    const ang = Math.atan2(60, 70), len = Math.max(12, 4 * 4);
    ctx.beginPath();
    ctx.moveTo(90, 80);
    ctx.lineTo(90 - len * Math.cos(ang - 0.45), 80 - len * Math.sin(ang - 0.45));
    ctx.lineTo(90 - len * Math.cos(ang + 0.45), 80 - len * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ck(s, "drawObject 'arrow' renders the shaft", inkAt(s, 55, 50), px(s.cv, 55, 50).join(','));
  // (78,74) is 3.2px off the shaft axis — only the filled head can reach it
  ck(s, "drawObject 'arrow' renders a filled head", inkAt(s, 78, 74), px(s.cv, 78, 74).join(','));
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 70, 60);
    ctx.restore();
  });
  ck(s, "drawObject 'rect' renders a frame", inkAt(s, 55, 20) && !inkAt(s, 55, 50), '');
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(55, 50, 35, 25, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  });
  ck(s, "drawObject 'ellipse' renders a ring", inkAt(s, 20, 50) && !inkAt(s, 55, 50), '');
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    ctx.fillStyle = '#ef4444'; ctx.font = '600 28px system-ui, sans-serif'; ctx.textBaseline = 'top';
    'AB\nCD'.split('\n').forEach((line, i) => ctx.fillText(line, 10, 10 + i * 28 * 1.25));
    ctx.restore();
  });
  ck(s, "drawObject 'text' renders both lines", inkCols(s, 20, 0, 120) > 0 && inkCols(s, 55, 0, 120) > 0,
    inkCols(s, 20, 0, 120) + ' / ' + inkCols(s, 55, 0, 120));
  ck(s, "drawObject 'text' leaves the line gap clean", inkCols(s, 34, 0, 120) === 0, inkCols(s, 34, 0, 120));
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    const o = { x: 20, y: 20, w: 60, h: 40 };
    const p = Math.max(6, Math.round(Math.min(o.w, o.h) / 10));
    const sw = Math.max(1, Math.round(o.w / p)), sh = Math.max(1, Math.round(o.h / p));
    const tmp = new FakeCanvas();
    tmp.width = sw; tmp.height = sh;
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(BASE, o.x, o.y, o.w, o.h, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, sw, sh, o.x, o.y, o.w, o.h);
    ctx.imageSmoothingEnabled = true;
    ctx.restore();
  });
  ck(s, "drawObject 'blur' renders a pixelated block", inkAt(s, 40, 40) && !inkAt(s, 10, 10), '');
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    ctx.font = 44.8 + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText('\u{1F600}', 60, 60);
    ctx.restore();
  });
  ck(s, "drawObject 'emoji' renders", inkAt(s, 60, 60), px(s.cv, 60, 60).join(','));
}
{
  const s = drawScene((ctx) => {
    ctx.save();
    const o = { x: 60, y: 60, n: 2, color: '#ef4444', size: 28 };
    const r = o.size * 0.8;
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.stroke();
    ctx.fillStyle = o.color === '#ffffff' ? '#111111' : '#ffffff';
    ctx.font = '700 ' + Math.round(r * (String(o.n).length > 1 ? 0.95 : 1.15)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(o.n), o.x, o.y + r * 0.05);
    ctx.restore();
  });
  ck(s, "drawObject 'num' fills the badge disc", !s.err && exact(px(s.cv, 60, 40), RED), px(s.cv, 60, 40).join(','));
  ck(s, "drawObject 'num' rims the badge in white", !s.err && near(px(s.cv, 60, 38), [255, 255, 255], 30),
    px(s.cv, 60, 38).join(','));
  ck(s, "drawObject 'num' draws the digit in white on the disc",
    !s.err && exact(px(s.cv, 60, 60), [255, 255, 255]), px(s.cv, 60, 60).join(','));
}
{
  // render(): the selection box is a dashed strokeRect under save/translate.
  const s = scene(120, 120, (ctx) => {
    ctx.save();
    ctx.translate(-10, -10);
    ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(30, 30, 50, 40);
    ctx.restore();
    ctx.fillStyle = '#ef4444'; ctx.fillRect(0, 0, 2, 2);
  });
  ck(s, 'the selection box lands at the translated position',
    inkCols(s, 20, 15, 75) > 0 && inkCols(s, 20, 0, 15) === 0, inkCols(s, 20, 15, 75));
  ck(s, 'the selection box is dashed', !s.err && inkCols(s, 20, 20, 70) < 46, inkCols(s, 20, 20, 70));
  ck(s, 'the selection box restores the transform for the next paint',
    exact(px(s.cv, 1, 1), RED), px(s.cv, 1, 1).join(','));
}

console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
process.exit(FAILS ? 1 : 0);
