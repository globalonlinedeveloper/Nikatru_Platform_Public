/* SPDX-License-Identifier: MPL-2.0
   core/dev/canvas2d.js — NODE-SIDE TEST HELPER. NEVER SHIPPED.

   core/dev/ is OUTSIDE the vendored surface, and that is a rule rather than an
   accident: vendoring copies core/v1/** only, no package allowlist may include
   dev/, and nothing inside an extension may require this file.

   PROMOTED, NOT WRITTEN. Source: Extension/Full_Screen_Shot/test/pixel-sim/canvas2d.js
   sha256 of that source at promotion: 14197e20f7f6fd852b78903fc6340b0a4d91e65533cbcd32eb5e1f9e46948488
   Promoted 2026-08-14. Everything below this header is that file byte for byte;
   the header is the only addition.

   THE ORIGINAL IS STILL THERE, AND THAT IS DELIBERATE. FullShot's sims require
   it by relative path (test/pixel-sim/run.js and five *.node.js suites), and
   FullShot's import contract is zero file moves and zero source changes. So two
   copies exist today. The sha256 above is the whole defence against them
   drifting — there is no CI check on it yet — and re-pointing FullShot's sims
   at this copy is what removes the second one.

   Licence: core/ is MPL-2.0 (core/LICENSE), which is not the licence on the
   tree this came from. Both are the same copyright holder, which is what makes
   that possible; the copy still under Extension/Full_Screen_Shot/ keeps that
   tool's licence.

   Exports: FakeCanvas — a buffer-backed 2d context subset. No dependencies.
*/
/* Buffer-backed <canvas> + 2d context subset used by pages/result.js and — since
   U-1a — by the annotation vocabulary pages/editor.js draws with.
   Sources for drawImage are "image-like" objects: { width, height, data }
   (Uint8ClampedArray RGBA). Nearest-neighbour sampling — exact for the 1:1
   blits the stitcher uses, adequate for thumbnails.

   The rasterizer is ADEQUATE, NOT ACCURATE. No anti-aliasing: a pixel is either
   fully painted or untouched, decided by whether its CENTRE is covered. Joins
   are discs whatever lineJoin says, and text is a 3x5 block font. That is on
   purpose — these tests grade "ink is here, background is there", a hard edge is
   far easier to assert than a blended one, and block glyphs are identical on
   every machine where a real font engine would not be.

   fillRect and drawImage keep a fast path for the identity-scale case, which is
   what the stitcher does all day. WHAT GRADES THEM, precisely — an earlier
   version of this header claimed the 35 pixel-sim scenarios lock fillRect's
   Math.round(x)..Math.round(x+w) edge rule "byte for byte", and that was NOT
   true: every fillRect in those scenarios has integer edges, where round, floor
   and ceil all agree, so run.js reported ALL PASS with the rule replaced. The
   real net is the named regression guards in test/canvas2d-sim.node.js section
   13, and they had to be rewritten to be one: the fillRect guard sampled only
   .4/.6 corners where the x axis agreed under floor, and the drawImage guard
   used a 4->2 downscale, whose two sampled points agree under floor AND round.
   Both now separate round from each neighbour on each axis (two rects, .4 and
   .6 edges) and use a 3->2 downscale, the smallest ratio where the sampling
   rules part company. Do not weaken them: nothing else is watching.

   Nor is either body "verbatim" pre-U-1a any more, and the claim should not be
   made again. fillRect's fast path calls parseColor, which U-1a rewrote (#rgb
   and rgba() branches the old #rrggbb-or-white version did not have), and
   drawImage's now proves opacity before it memcpys.

   ALPHA: every path composites SOURCE-OVER, as canvas does. The unscaled row
   copy is an optimisation, legal only where the source run is fully opaque —
   replacing bytes under a transparent source would destroy the destination and
   made the defensive white underlay at six shipped call sites (pages/result.js,
   pages/beautify.js, pages/scrollclip.js, pages/editor.js) impossible to grade.
   The blend is un-premultiplied and rounds one step below a browser at exactly
   alpha 128 (127 where Chrome gives 128); that step is asserted, not accidental.

   KNOWN DIVERGENCES between the fast and slow paths, both recorded in
   V2-FEATURE-COMPLETE-PLAN.md rather than fixed here:
     - at exactly .5 coordinates the two disagree by a WHOLE PIXEL of
       translation, not by a fractional edge — Math.round(v) in the fast path vs
       Math.ceil(v - 0.5) in scanFill. Any transform at all takes the slow path,
       not only a scale.
     - negative width/height: the fast paths drop the rect, the slow paths
       normalise it, and a browser normalises. drawImage returns early on a
       negative rect on BOTH paths (a browser mirrors), which is why an editor
       blur dragged right-to-left renders nothing here.

   The rasterizer is a measuring instrument, so getImageData clamps rather than
   overhangs: a window past the right edge pads with transparent black instead
   of reading the following row.

   Deliberately ABSENT: clip, arcTo, createLinearGradient, shadowBlur,
   imageSmoothingQuality. pages/beautify.js feature-detects exactly those
   (beautify.js:93-156) to choose between its browser path and its shim path;
   defining any one of them here would silently move beautify-sim onto the
   untested browser path. C-3 owns that switch, not U-1a. */
'use strict';

const TAU = Math.PI * 2;

function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 255];
  const s = c.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255];
  }
  m = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',').map(v => parseFloat(v));
    return [clamp255(p[0]), clamp255(p[1]), clamp255(p[2]),
            p.length > 3 ? clamp255(Math.min(1, Math.max(0, p[3])) * 255) : 255];
  }
  return [255, 255, 255, 255];        // unknown keyword -> white (pre-U-1a fallback)
}

/* ---------------- affine transform ---------------- */

function matMul(m, n) {                // returns m applied AFTER n
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}
function matInv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [1, 0, 0, 1, 0, 0];
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det
  ];
}
const mapX = (m, x, y) => m[0] * x + m[2] * y + m[4];
const mapY = (m, x, y) => m[1] * x + m[3] * y + m[5];

/* ---------------- source-over ----------------
   Canvas composites; it does not assign. A transparent source pixel must leave
   the destination exactly as it found it, and a partly transparent one must
   blend with it. Replacing destination bytes is the same operation ONLY when
   the source pixel is fully opaque — which is why drawImage's row copy below
   has to prove opacity before it is allowed to memcpy. */
function srcOver(d, dOff, src, sOff, a) {
  if (!(a > 0)) return;
  if (a >= 1) {
    d[dOff] = src[sOff]; d[dOff + 1] = src[sOff + 1];
    d[dOff + 2] = src[sOff + 2]; d[dOff + 3] = src[sOff + 3];
    return;
  }
  d[dOff] = Math.round(src[sOff] * a + d[dOff] * (1 - a));
  d[dOff + 1] = Math.round(src[sOff + 1] * a + d[dOff + 1] * (1 - a));
  d[dOff + 2] = Math.round(src[sOff + 2] * a + d[dOff + 2] * (1 - a));
  d[dOff + 3] = Math.round(255 * a + d[dOff + 3] * (1 - a));
}

/* n pixels from sOff, all alpha 255? Then source-over writes exactly the bytes
   a copy would, and the copy is allowed. Cheap next to the memcpy it guards,
   and it keeps the stitcher's opaque full-width blits on the fast path. */
function runOpaque(src, sOff, n) {
  for (let i = 0, o = sOff + 3; i < n; i++, o += 4) if (src[o] !== 255) return false;
  return true;
}

/* ---------------- polygon scanline ----------------
   Writes 1s into `mask` for every pixel whose CENTRE (x+0.5, y+0.5) is inside
   the subpaths under `rule`. Subpaths are implicitly closed, as canvas fill is. */
function scanFill(mask, W, H, subpaths, rule) {
  const ex = [];
  let minY = Infinity, maxY = -Infinity;
  for (const sp of subpaths) {
    const p = sp.pts, n = p.length >> 1;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const y0 = p[i * 2 + 1], y1 = p[j * 2 + 1];
      if (y0 === y1) continue;         // horizontal edges never cross a scanline
      ex.push(p[i * 2], y0, p[j * 2], y1);
      if (y0 < minY) minY = y0;
      if (y1 < minY) minY = y1;
      if (y0 > maxY) maxY = y0;
      if (y1 > maxY) maxY = y1;
    }
  }
  if (!ex.length) return;
  const yA = Math.max(0, Math.floor(minY)), yB = Math.min(H - 1, Math.ceil(maxY));
  const hits = [];
  for (let y = yA; y <= yB; y++) {
    const yc = y + 0.5;
    hits.length = 0;
    for (let e = 0; e < ex.length; e += 4) {
      const y0 = ex[e + 1], y1 = ex[e + 3];
      if ((yc >= y0 && yc < y1) || (yc >= y1 && yc < y0)) {
        hits.push([ex[e] + (yc - y0) / (y1 - y0) * (ex[e + 2] - ex[e]), y1 > y0 ? 1 : -1]);
      }
    }
    if (hits.length < 2) continue;
    hits.sort((a, b) => a[0] - b[0]);
    const row = y * W;
    let wind = 0;
    for (let i = 0; i + 1 < hits.length; i++) {
      wind += hits[i][1];
      if (rule === 'evenodd' ? (i & 1) : wind === 0) continue;
      let x0 = Math.ceil(hits[i][0] - 0.5), x1 = Math.ceil(hits[i + 1][0] - 0.5) - 1;
      if (x0 < 0) x0 = 0;
      if (x1 > W - 1) x1 = W - 1;
      for (let x = x0; x <= x1; x++) mask[row + x] = 1;
    }
  }
}

/* ---------------- dashes ----------------
   Splits a flat device-space polyline into the "on" runs of `pattern`. */
function dashRuns(pts, pattern, offset) {
  let total = 0;
  for (const v of pattern) total += v;
  if (!(total > 0)) return [pts];
  let idx = 0, rem = pattern[0], on = true;
  let skip = offset % total;
  if (skip < 0) skip += total;
  while (skip > 1e-9) {
    const take = Math.min(skip, rem);
    rem -= take; skip -= take;
    if (rem <= 1e-9) { idx = (idx + 1) % pattern.length; rem = pattern[idx]; on = !on; }
  }
  const out = [];
  let cur = on ? [pts[0], pts[1]] : null;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    let x0 = pts[i], y0 = pts[i + 1];
    const x1 = pts[i + 2], y1 = pts[i + 3];
    let left = Math.hypot(x1 - x0, y1 - y0);
    while (left > 1e-9) {
      const take = Math.min(left, rem);
      const t = take / left;
      const nx = x0 + (x1 - x0) * t, ny = y0 + (y1 - y0) * t;
      if (on) { if (!cur) cur = [x0, y0]; cur.push(nx, ny); }
      x0 = nx; y0 = ny; left -= take; rem -= take;
      if (rem <= 1e-9) {
        if (on && cur) { if (cur.length >= 4) out.push(cur); cur = null; }
        idx = (idx + 1) % pattern.length; rem = pattern[idx]; on = !on;
        if (on) cur = [x0, y0];
      }
    }
  }
  if (on && cur && cur.length >= 4) out.push(cur);
  return out;
}

/* ---------------- 3x5 block font ----------------
   Not a font engine: just enough shape that a test can tell '1' from '8' and
   assert where the ink of a step badge or a text object landed. Anything with
   no entry (emoji included) is a solid block — "there is a glyph here". */
const GLYPHS = {
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'], '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'], '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '###'],
  'A': ['.#.', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '##.', '#.#', '##.'],
  'C': ['###', '#..', '#..', '#..', '###'], 'D': ['##.', '#.#', '#.#', '#.#', '##.'],
  'E': ['###', '#..', '###', '#..', '###'], 'F': ['###', '#..', '###', '#..', '#..'],
  'G': ['###', '#..', '#.#', '#.#', '###'], 'H': ['#.#', '#.#', '###', '#.#', '#.#'],
  'I': ['###', '.#.', '.#.', '.#.', '###'], 'J': ['..#', '..#', '..#', '#.#', '###'],
  'K': ['#.#', '#.#', '##.', '#.#', '#.#'], 'L': ['#..', '#..', '#..', '#..', '###'],
  'M': ['#.#', '###', '###', '#.#', '#.#'], 'N': ['#.#', '###', '###', '###', '#.#'],
  'O': ['###', '#.#', '#.#', '#.#', '###'], 'P': ['###', '#.#', '###', '#..', '#..'],
  'Q': ['###', '#.#', '#.#', '###', '..#'], 'R': ['###', '#.#', '##.', '#.#', '#.#'],
  'S': ['###', '#..', '###', '..#', '###'], 'T': ['###', '.#.', '.#.', '.#.', '.#.'],
  'U': ['#.#', '#.#', '#.#', '#.#', '###'], 'V': ['#.#', '#.#', '#.#', '#.#', '.#.'],
  'W': ['#.#', '#.#', '###', '###', '#.#'], 'X': ['#.#', '#.#', '.#.', '#.#', '#.#'],
  'Y': ['#.#', '#.#', '.#.', '.#.', '.#.'], 'Z': ['###', '..#', '.#.', '#..', '###'],
  ' ': ['...', '...', '...', '...', '...'], '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'], ':': ['...', '.#.', '...', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'], '_': ['...', '...', '...', '...', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'], '=': ['...', '###', '...', '###', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'], '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['###', '..#', '.##', '...', '.#.'], '(': ['..#', '.#.', '.#.', '.#.', '..#'],
  ')': ['#..', '.#.', '.#.', '.#.', '#..'], '#': ['#.#', '###', '#.#', '###', '#.#'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'], '@': ['###', '#.#', '###', '#..', '###'],
  '*': ['#.#', '.#.', '#.#', '...', '...'], "'": ['.#.', '.#.', '...', '...', '...']
};
const BLOCK = ['###', '###', '###', '###', '###'];

class Ctx2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.lineDashOffset = 0;
    this.globalAlpha = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'start';
    this.textBaseline = 'alphabetic';
    this.imageSmoothingEnabled = true;
    this._m = [1, 0, 0, 1, 0, 0];
    this._dash = [];
    this._stack = [];
    this._path = [];
  }

  /* ---------------- state ---------------- */

  save() {
    this._stack.push({
      m: this._m.slice(), dash: this._dash.slice(),
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
      lineCap: this.lineCap, lineJoin: this.lineJoin, lineDashOffset: this.lineDashOffset,
      globalAlpha: this.globalAlpha, font: this.font,
      textAlign: this.textAlign, textBaseline: this.textBaseline,
      imageSmoothingEnabled: this.imageSmoothingEnabled
    });
  }
  restore() {
    const s = this._stack.pop();
    if (!s) return;                    // canvas ignores an unbalanced restore
    this._m = s.m; this._dash = s.dash;
    this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; this.lineWidth = s.lineWidth;
    this.lineCap = s.lineCap; this.lineJoin = s.lineJoin; this.lineDashOffset = s.lineDashOffset;
    this.globalAlpha = s.globalAlpha; this.font = s.font;
    this.textAlign = s.textAlign; this.textBaseline = s.textBaseline;
    this.imageSmoothingEnabled = s.imageSmoothingEnabled;
  }
  translate(tx, ty) { this._m = matMul(this._m, [1, 0, 0, 1, tx, ty]); }
  scale(sx, sy) { this._m = matMul(this._m, [sx, 0, 0, sy, 0, 0]); }
  rotate(a) {
    const c = Math.cos(a), s = Math.sin(a);
    this._m = matMul(this._m, [c, s, -s, c, 0, 0]);
  }
  transform(a, b, c, d, e, f) { this._m = matMul(this._m, [a, b, c, d, e, f]); }
  setTransform(a, b, c, d, e, f) { this._m = [a, b, c, d, e, f]; }
  resetTransform() { this._m = [1, 0, 0, 1, 0, 0]; }
  setLineDash(arr) {
    let a = Array.isArray(arr) ? arr.map(Number).filter(v => isFinite(v) && v >= 0) : [];
    if (a.length & 1) a = a.concat(a);  // odd patterns are doubled, as in canvas
    this._dash = a;
  }
  getLineDash() { return this._dash.slice(); }

  /* ---------------- paths ---------------- */

  beginPath() { this._path = []; }
  moveTo(x, y) {
    this._path.push({ pts: [mapX(this._m, x, y), mapY(this._m, x, y)], closed: false });
  }
  lineTo(x, y) {
    const sp = this._open(mapX(this._m, x, y), mapY(this._m, x, y));
    sp.pts.push(mapX(this._m, x, y), mapY(this._m, x, y));
  }
  closePath() {
    const sp = this._path[this._path.length - 1];
    if (sp && sp.pts.length >= 4) sp.closed = true;
  }
  rect(x, y, w, h) {
    const m = this._m;
    this._path.push({ closed: true, pts: [
      mapX(m, x, y), mapY(m, x, y), mapX(m, x + w, y), mapY(m, x + w, y),
      mapX(m, x + w, y + h), mapY(m, x + w, y + h), mapX(m, x, y + h), mapY(m, x, y + h)
    ] });
  }
  arc(cx, cy, r, a0, a1, ccw) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) {
    let sweep = ccw ? a0 - a1 : a1 - a0;
    if (sweep < 0) sweep = TAU - ((-sweep) % TAU);
    if (sweep > TAU) sweep = TAU;
    if (ccw) sweep = -sweep;
    const rr = Math.max(Math.abs(rx), Math.abs(ry));
    const steps = Math.max(12, Math.min(720,
      Math.ceil(Math.abs(sweep) / TAU * Math.max(24, Math.ceil(rr * 2)))));
    const cr = Math.cos(rot || 0), sr = Math.sin(rot || 0);
    const m = this._m;
    for (let i = 0; i <= steps; i++) {
      const t = a0 + sweep * i / steps;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      const ux = cx + ex * cr - ey * sr, uy = cy + ex * sr + ey * cr;
      const dx = mapX(m, ux, uy), dy = mapY(m, ux, uy);
      if (i === 0) this._open(dx, dy).pts.push(dx, dy);
      else this._path[this._path.length - 1].pts.push(dx, dy);
    }
  }
  quadraticCurveTo(cpx, cpy, x, y) {
    const m = this._m;
    this._curve(24, [mapX(m, cpx, cpy), mapY(m, cpx, cpy)], null,
      [mapX(m, x, y), mapY(m, x, y)]);
  }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    const m = this._m;
    this._curve(24, [mapX(m, c1x, c1y), mapY(m, c1x, c1y)],
      [mapX(m, c2x, c2y), mapY(m, c2x, c2y)], [mapX(m, x, y), mapY(m, x, y)]);
  }
  /* An affine map commutes with a Bezier, so flattening in device space with
     transformed control points is exact. Fixed step count = deterministic. */
  _curve(steps, c1, c2, end) {
    const sp = this._open(end[0], end[1]);
    const n = sp.pts.length;
    const x0 = sp.pts[n - 2], y0 = sp.pts[n - 1];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      let x, y;
      if (c2) {
        x = u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0];
        y = u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1];
      } else {
        x = u * u * x0 + 2 * u * t * c1[0] + t * t * end[0];
        y = u * u * y0 + 2 * u * t * c1[1] + t * t * end[1];
      }
      sp.pts.push(x, y);
    }
  }
  /* The subpath a path command should extend. closePath leaves the pen on the
     subpath's start point, so a following command begins a new subpath there. */
  _open(dx, dy) {
    let sp = this._path[this._path.length - 1];
    if (!sp || sp.closed) {
      const from = sp ? [sp.pts[0], sp.pts[1]] : [dx, dy];
      sp = { pts: [from[0], from[1]], closed: false };
      this._path.push(sp);
    }
    return sp;
  }

  /* ---------------- painting ---------------- */

  fill(rule) {
    const c = this.canvas;
    const mask = new Uint8Array(c.width * c.height);
    scanFill(mask, c.width, c.height, this._path, rule === 'evenodd' ? 'evenodd' : 'nonzero');
    this._paint(mask, parseColor(this.fillStyle));
  }
  stroke() { this._paint(this._strokeMask(this._path), parseColor(this.strokeStyle)); }

  /* One mask for the whole stroke, composited once — a per-segment blend would
     darken every join and every doubled-back highlighter stroke. */
  _strokeMask(path) {
    const c = this.canvas;
    const mask = new Uint8Array(c.width * c.height);
    const hw = Math.max(1, this.lineWidth * this._scale()) / 2;
    for (const sp of path) {
      let pts = sp.pts;
      if (pts.length < 4) {
        if (pts.length === 2 && this.lineCap === 'round') this._disc(mask, pts[0], pts[1], hw);
        continue;
      }
      if (sp.closed && (pts[0] !== pts[pts.length - 2] || pts[1] !== pts[pts.length - 1])) {
        pts = pts.concat([pts[0], pts[1]]);
      }
      const runs = this._dash.length ? dashRuns(pts, this._dash, this.lineDashOffset) : [pts];
      for (const run of runs) this._strokeRun(mask, run, hw, sp.closed && run === pts);
    }
    return mask;
  }
  _strokeRun(mask, pts, hw, closed) {
    const c = this.canvas, n = pts.length >> 1;
    for (let i = 0; i + 1 < n; i++) {
      const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], y1 = pts[i * 2 + 3];
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = -dy / len * hw, ny = dx / len * hw;
      let ax = x0, ay = y0, bx = x1, by = y1;
      if (!closed && this.lineCap === 'square') {
        const ex = dx / len * hw, ey = dy / len * hw;
        if (i === 0) { ax -= ex; ay -= ey; }
        if (i === n - 2) { bx += ex; by += ey; }
      }
      scanFill(mask, c.width, c.height,
        [{ pts: [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny] }],
        'nonzero');
    }
    for (let i = 1; i + 1 < n; i++) this._disc(mask, pts[i * 2], pts[i * 2 + 1], hw);
    if (closed) this._disc(mask, pts[0], pts[1], hw);
    else if (this.lineCap === 'round') {
      this._disc(mask, pts[0], pts[1], hw);
      this._disc(mask, pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], hw);
    }
  }
  _disc(mask, cx, cy, r) {
    const c = this.canvas;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(c.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(c.height - 1, Math.ceil(cy + r));
    const rr = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, row = y * c.width;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= rr) mask[row + x] = 1;
      }
    }
  }
  _scale() { return Math.sqrt(Math.abs(this._m[0] * this._m[3] - this._m[1] * this._m[2])) || 1; }
  _paint(mask, rgba) {
    const c = this.canvas, d = c._data;
    const a = Math.max(0, Math.min(1, this.globalAlpha)) * (rgba[3] / 255);
    if (!(a > 0)) return;
    for (let i = 0, n = c.width * c.height; i < n; i++) {
      if (!mask[i]) continue;
      const o = i * 4;
      if (a >= 1) { d[o] = rgba[0]; d[o + 1] = rgba[1]; d[o + 2] = rgba[2]; d[o + 3] = 255; }
      else {
        d[o] = Math.round(rgba[0] * a + d[o] * (1 - a));
        d[o + 1] = Math.round(rgba[1] * a + d[o + 1] * (1 - a));
        d[o + 2] = Math.round(rgba[2] * a + d[o + 2] * (1 - a));
        d[o + 3] = Math.round(255 * a + d[o + 3] * (1 - a));
      }
    }
  }

  strokeRect(x, y, w, h) {
    const keep = this._path;          // strokeRect must not disturb the current path
    this._path = [];
    this.rect(x, y, w, h);
    this.stroke();
    this._path = keep;
  }

  fillRect(x, y, w, h) {
    const m = this._m;
    const alpha = Math.max(0, Math.min(1, this.globalAlpha));
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) {
      // Pure translation: the pre-U-1a body, verbatim. With m[4]=m[5]=0 and
      // globalAlpha 1 this is bit-for-bit what the 35 pixel-sim scenarios grade.
      const c = this.canvas, [r, g, b, a] = parseColor(this.fillStyle);
      const ga = alpha * (a / 255);
      if (!(ga > 0)) return;
      const x0 = Math.max(0, Math.round(x + m[4])), y0 = Math.max(0, Math.round(y + m[5]));
      const x1 = Math.min(c.width, Math.round(x + w + m[4]));
      const y1 = Math.min(c.height, Math.round(y + h + m[5]));
      for (let yy = y0; yy < y1; yy++) {
        let off = (yy * c.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++) {
          if (ga >= 1) {
            c._data[off] = r; c._data[off + 1] = g; c._data[off + 2] = b; c._data[off + 3] = a;
          } else {
            c._data[off] = Math.round(r * ga + c._data[off] * (1 - ga));
            c._data[off + 1] = Math.round(g * ga + c._data[off + 1] * (1 - ga));
            c._data[off + 2] = Math.round(b * ga + c._data[off + 2] * (1 - ga));
            c._data[off + 3] = Math.round(255 * ga + c._data[off + 3] * (1 - ga));
          }
          off += 4;
        }
      }
      return;
    }
    const c = this.canvas;
    const mask = new Uint8Array(c.width * c.height);
    scanFill(mask, c.width, c.height, [{ pts: [
      mapX(m, x, y), mapY(m, x, y), mapX(m, x + w, y), mapY(m, x + w, y),
      mapX(m, x + w, y + h), mapY(m, x + w, y + h), mapX(m, x, y + h), mapY(m, x, y + h)
    ] }], 'nonzero');
    this._paint(mask, parseColor(this.fillStyle));
  }

  clearRect(x, y, w, h) {
    const c = this.canvas, m = this._m;
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) {
      const x0 = Math.max(0, Math.round(x + m[4])), y0 = Math.max(0, Math.round(y + m[5]));
      const x1 = Math.min(c.width, Math.round(x + w + m[4]));
      const y1 = Math.min(c.height, Math.round(y + h + m[5]));
      for (let yy = y0; yy < y1; yy++) c._data.fill(0, (yy * c.width + x0) * 4, (yy * c.width + x1) * 4);
      return;
    }
    const mask = new Uint8Array(c.width * c.height);
    scanFill(mask, c.width, c.height, [{ pts: [
      mapX(m, x, y), mapY(m, x, y), mapX(m, x + w, y), mapY(m, x + w, y),
      mapX(m, x + w, y + h), mapY(m, x + w, y + h), mapX(m, x, y + h), mapY(m, x, y + h)
    ] }], 'nonzero');
    for (let i = 0, n = c.width * c.height; i < n; i++) if (mask[i]) c._data.fill(0, i * 4, i * 4 + 4);
  }

  /* ---------------- text ---------------- */

  _fontPx() {
    const m = /(-?[\d.]+)px/.exec(this.font || '');
    const v = m ? parseFloat(m[1]) : 10;
    return isFinite(v) && v > 0 ? v : 10;
  }
  /* Matches bounds() in pages/editor.js, which estimates 0.6em per character. */
  measureText(t) { return { width: String(t == null ? '' : t).length * this._fontPx() * 0.6 }; }

  fillText(t, x, y) { this._text(t, x, y, parseColor(this.fillStyle)); }
  strokeText(t, x, y) { this._text(t, x, y, parseColor(this.strokeStyle)); }
  _text(t, x, y, rgba) {
    const chars = Array.from(String(t == null ? '' : t));   // keep astral emoji whole
    if (!chars.length) return;
    const size = this._fontPx(), adv = size * 0.6;
    let penX = x;
    if (this.textAlign === 'center') penX -= chars.length * adv / 2;
    else if (this.textAlign === 'right' || this.textAlign === 'end') penX -= chars.length * adv;

    // ink box: 0.7em tall sitting on the baseline, 0.5em wide inside the advance
    let base = y;
    if (this.textBaseline === 'top' || this.textBaseline === 'hanging') base = y + size * 0.8;
    else if (this.textBaseline === 'middle') base = y + size * 0.35;
    else if (this.textBaseline === 'bottom' || this.textBaseline === 'ideographic') base = y - size * 0.2;

    const gw = size * 0.5, gh = size * 0.7, cw = gw / 3, ch = gh / 5;
    const top = base - gh, m = this._m;
    const quads = [];
    for (let i = 0; i < chars.length; i++) {
      const rows = GLYPHS[chars[i].toUpperCase()] || BLOCK;
      const left = penX + i * adv + size * 0.05;
      for (let r = 0; r < 5; r++) {
        for (let col = 0; col < 3; col++) {
          if (rows[r][col] !== '#') continue;
          const gx = left + col * cw, gy = top + r * ch;
          quads.push({ pts: [
            mapX(m, gx, gy), mapY(m, gx, gy), mapX(m, gx + cw, gy), mapY(m, gx + cw, gy),
            mapX(m, gx + cw, gy + ch), mapY(m, gx + cw, gy + ch), mapX(m, gx, gy + ch), mapY(m, gx, gy + ch)
          ] });
        }
      }
    }
    if (!quads.length) return;
    const c = this.canvas;
    const mask = new Uint8Array(c.width * c.height);
    scanFill(mask, c.width, c.height, quads, 'nonzero');
    this._paint(mask, rgba);
  }

  /* ---------------- images ---------------- */

  /* (img,dx,dy) | (img,dx,dy,dw,dh) | (img,sx,sy,sw,sh,dx,dy,dw,dh) */
  drawImage(img, ...args) {
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx, dy, dw, dh;
    if (args.length === 2) { [dx, dy] = args; dw = sw; dh = sh; }
    else if (args.length === 4) { [dx, dy, dw, dh] = args; }
    else if (args.length === 8) { [sx, sy, sw, sh, dx, dy, dw, dh] = args; }
    else throw new Error('drawImage: bad arity ' + args.length);
    const c = this.canvas, src = img.data || img._data;
    if (!src) throw new Error('drawImage: source has no pixel data');
    const m = this._m;
    const ga = Math.max(0, Math.min(1, this.globalAlpha));
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && ga >= 1) {
      // Pure translation, opaque: the pre-U-1a body, verbatim.
      dx += m[4]; dy += m[5];
      sx = Math.round(sx); sy = Math.round(sy); sw = Math.round(sw); sh = Math.round(sh);
      dx = Math.round(dx); dy = Math.round(dy); dw = Math.round(dw); dh = Math.round(dh);
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
      for (let oy = 0; oy < dh; oy++) {
        const ty = dy + oy;
        if (ty < 0 || ty >= c.height) continue;
        const syy = sy + Math.min(sh - 1, Math.floor(oy * sh / dh));
        if (syy < 0 || syy >= img.height) continue;
        if (dw === sw) {
          // unscaled row: memcpy when the whole run is opaque (the stitcher's
          // case, and bit-for-bit the pre-U-1a body), blend when it is not.
          let copyW = dw, fromX = sx, toX = dx;
          if (toX < 0) { fromX -= toX; copyW += toX; toX = 0; }
          copyW = Math.min(copyW, c.width - toX, img.width - fromX);
          if (copyW <= 0) continue;
          const sOff = (syy * img.width + fromX) * 4;
          const dOff = (ty * c.width + toX) * 4;
          if (runOpaque(src, sOff, copyW)) {
            c._data.set(src.subarray(sOff, sOff + copyW * 4), dOff);
          } else {
            for (let i = 0, so = sOff, dof = dOff; i < copyW; i++, so += 4, dof += 4) {
              srcOver(c._data, dof, src, so, src[so + 3] / 255);
            }
          }
        } else {
          for (let ox = 0; ox < dw; ox++) {
            const tx = dx + ox;
            if (tx < 0 || tx >= c.width) continue;
            const sxx = sx + Math.min(sw - 1, Math.floor(ox * sw / dw));
            if (sxx < 0 || sxx >= img.width) continue;
            const sOff = (syy * img.width + sxx) * 4;
            srcOver(c._data, (ty * c.width + tx) * 4, src, sOff, src[sOff + 3] / 255);
          }
        }
      }
      return;
    }
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    // Scaled/rotated or translucent: walk the destination and sample backwards.
    const inv = matInv(m);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [ux, uy] of [[dx, dy], [dx + dw, dy], [dx + dw, dy + dh], [dx, dy + dh]]) {
      const px = mapX(m, ux, uy), py = mapY(m, ux, uy);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const xA = Math.max(0, Math.floor(minX)), xB = Math.min(c.width - 1, Math.ceil(maxX));
    const yA = Math.max(0, Math.floor(minY)), yB = Math.min(c.height - 1, Math.ceil(maxY));
    for (let y = yA; y <= yB; y++) {
      for (let x = xA; x <= xB; x++) {
        const ux = mapX(inv, x + 0.5, y + 0.5), uy = mapY(inv, x + 0.5, y + 0.5);
        if (ux < dx || ux >= dx + dw || uy < dy || uy >= dy + dh) continue;
        const sxx = Math.round(sx) + Math.min(Math.round(sw) - 1, Math.floor((ux - dx) * sw / dw));
        const syy = Math.round(sy) + Math.min(Math.round(sh) - 1, Math.floor((uy - dy) * sh / dh));
        if (sxx < 0 || sxx >= img.width || syy < 0 || syy >= img.height) continue;
        const sOff = (syy * img.width + sxx) * 4;
        srcOver(c._data, (y * c.width + x) * 4, src, sOff, ga * (src[sOff + 3] / 255));
      }
    }
  }

  getImageData(x, y, w, h) {
    const c = this.canvas;
    const out = new Uint8ClampedArray(w * h * 4);
    // Clamped on x, not merely offset. A window that overhangs the right edge
    // must read as transparent black, the way a browser pads it — copying w
    // pixels from the row start runs into the FOLLOWING row and returns
    // neighbouring pixels as if they belonged to this one. Nothing shipped
    // overhangs today; the clamp is here so that stays a fact rather than luck.
    const xA = Math.max(0, -x), xB = Math.min(w, c.width - x);
    if (xB <= xA) return { data: out, width: w, height: h };
    for (let yy = 0; yy < h; yy++) {
      const sy = y + yy;
      if (sy < 0 || sy >= c.height) continue;
      const sOff = (sy * c.width + x + xA) * 4;
      out.set(c._data.subarray(sOff, sOff + (xB - xA) * 4), (yy * w + xA) * 4);
    }
    return { data: out, width: w, height: h };
  }
}

class FakeCanvas {
  constructor() { this._w = 0; this._h = 0; this._data = new Uint8ClampedArray(0); this._ctx = new Ctx2D(this); }
  get width() { return this._w; }
  set width(v) { this._w = Math.max(0, v | 0); this._realloc(); }
  get height() { return this._h; }
  set height(v) { this._h = Math.max(0, v | 0); this._realloc(); }
  _realloc() { this._data = new Uint8ClampedArray(this._w * this._h * 4); }
  getContext() { return this._ctx; }
  get data() { return this._data; }             // image-like for drawImage
  toDataURL() { return 'data:image/png;base64,'; }
}

module.exports = { FakeCanvas };
