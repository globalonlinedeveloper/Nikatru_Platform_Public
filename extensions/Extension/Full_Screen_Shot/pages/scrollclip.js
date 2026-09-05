/* FullShot Scroll Clip — turn a tall capture into an animated scroll-through
   (GIF or WebM). Four PURE, node-testable functions carry the logic
   (test/scrollclip-sim.node.js):
     - fsScrollFrames(srcW, srcH, opts)  — the pan schedule (geometry only)
     - fsRenderScrollFrame(ctx, img, y, view) — paint one frame (fillRect+drawImage;
       runs identically in the node canvas shim)
     - fsEncodeGIF(frames, w, h, opts) — a dependency-free GIF89a encoder
       (global palette, exact when <=256 colors else median-cut; a
       clear-code-paced LZW stream that is valid for every decoder).
     - fsEncodeGIFAsync(frames, w, h, opts) — byte-identical async twin that
       awaits opts.yield() every opts.chunkSize frames for MID-encode browser
       progress (the sync encoder blocks the whole encode in one call).
   WebM export uses the browser's MediaRecorder over a canvas stream — a
   browser-only path (feature-detected, degrades to GIF), verified on-device
   like beautify's gradient/shadow. No dependencies, no build step.
   /* build 1.9.3 */
'use strict';

/* ===================== PURE: scroll-frame geometry ===================== */
/* Pans a viewport-shaped window down the stitched image. Returns the output
   view size + an ordered list of {y, delayMs} (y = source top of the window). */
function fsScrollFrames(srcW, srcH, opts) {
  opts = opts || {};
  srcW = Math.max(1, srcW | 0);
  srcH = Math.max(1, srcH | 0);
  var density = Math.min(3, Math.max(1, (opts.density || 1) | 0));
  var outW = Math.max(1, ((opts.outW || srcW) * density) | 0);
  var scale = outW / srcW;
  var aspect = opts.aspect || (9 / 16);              // window h : w
  var viewSrcH = Math.round(srcW * aspect);          // window height in SOURCE px
  if (viewSrcH > srcH) viewSrcH = srcH;
  if (viewSrcH < 1) viewSrcH = 1;
  var maxScroll = Math.max(0, srcH - viewSrcH);
  var fps = Math.min(50, Math.max(1, (opts.fps || 12) | 0));
  var delayMs = Math.round(1000 / fps);
  var startHold = Math.max(0, opts.startHoldMs == null ? 600 : opts.startHoldMs | 0);
  var endHold = Math.max(0, opts.endHoldMs == null ? 600 : opts.endHoldMs | 0);
  var bounce = !!opts.bounce;
  var viewH = Math.max(1, Math.round(viewSrcH * scale));
  var view = {
    w: outW, h: viewH, scale: scale, density: density,
    srcW: srcW, srcH: srcH, viewSrcH: viewSrcH,
    bg: opts.bg || '#0b0b0d'
  };
  var frames = [];
  function pushHold(y, ms) {
    var n = Math.round(ms / delayMs);
    for (var i = 0; i < n; i++) frames.push({ y: y, delayMs: delayMs });
  }

  if (maxScroll === 0) {                              // image shorter than window: static
    pushHold(0, Math.max(delayMs, startHold + endHold));
    if (frames.length === 0) frames.push({ y: 0, delayMs: delayMs });
    return { view: view, frames: frames, maxScroll: 0, totalMs: frames.length * delayMs };
  }

  var speed = Math.max(1, opts.speed || 800);        // source px / second
  var travelMs = opts.durationMs ? opts.durationMs : Math.round(maxScroll / speed * 1000);
  travelMs = Math.max(delayMs, travelMs);
  var steps = Math.max(1, Math.round(travelMs / delayMs));

  pushHold(0, startHold);
  for (var i = 1; i <= steps; i++) {
    var y = Math.round(maxScroll * i / steps);
    if (y > maxScroll) y = maxScroll;
    frames.push({ y: y, delayMs: delayMs });
  }
  pushHold(maxScroll, endHold);
  if (bounce) {
    for (var j = 1; j <= steps; j++) {
      var yb = Math.round(maxScroll * (1 - j / steps));
      if (yb < 0) yb = 0;
      frames.push({ y: yb, delayMs: delayMs });
    }
    pushHold(0, endHold);
  }
  return { view: view, frames: frames, maxScroll: maxScroll, totalMs: frames.length * delayMs };
}

/* ===================== PURE: paint one frame ===================== */
/* Fills the background then blits the source window [0, y, srcW, viewSrcH] into
   the output rect. Uses only fillRect + drawImage, so it runs in the shim. */
function fsRenderScrollFrame(ctx, img, frameY, view) {
  var w = view.w, h = view.h;
  ctx.fillStyle = view.bg || '#0b0b0d';
  ctx.fillRect(0, 0, w, h);
  var srcH = view.viewSrcH != null ? view.viewSrcH : Math.round(h / (view.scale || 1));
  var srcW = view.srcW || img.width;
  var totalH = view.srcH || img.height;
  var sy = frameY | 0;
  if (sy < 0) sy = 0;
  if (sy > totalH - srcH) sy = Math.max(0, totalH - srcH);
  ctx.drawImage(img, 0, sy, srcW, srcH, 0, 0, w, h);
}

/* ===================== PURE: GIF89a encoder ===================== */
function fsByteWriter() { this.a = []; }
fsByteWriter.prototype.byte = function (b) { this.a.push(b & 255); };
fsByteWriter.prototype.u16 = function (v) { this.a.push(v & 255); this.a.push((v >> 8) & 255); };
fsByteWriter.prototype.str = function (s) { for (var i = 0; i < s.length; i++) this.a.push(s.charCodeAt(i) & 255); };
fsByteWriter.prototype.bytes = function () { return Uint8Array.from(this.a); };

function fsBitWriter() { this.buf = []; this.cur = 0; this.n = 0; }
fsBitWriter.prototype.write = function (code, size) {
  for (var i = 0; i < size; i++) {
    if (code & (1 << i)) this.cur |= (1 << this.n);
    this.n++;
    if (this.n === 8) { this.buf.push(this.cur); this.cur = 0; this.n = 0; }
  }
};
fsBitWriter.prototype.flush = function () {
  if (this.n > 0) { this.buf.push(this.cur); this.cur = 0; this.n = 0; }
  return this.buf;
};

/* Full GIF-LZW: a growing dictionary (prefix-code + next symbol -> a new code),
   with the code width grown in lockstep with the decoder — one step BEFORE the
   code that first needs the extra bit is assigned — and a Clear Code emitted
   when the table fills (4096 = the 12-bit ceiling) so no code ever exceeds 12
   bits. This is the canonical GIF encoder timing; it decodes on every reader and
   is matched byte-for-byte to the LZW decoder in test/scrollclip-sim.node.js
   (a full round-trip, INCLUDING the 4096-entry reset, is asserted there). Real
   compression (runs collapse to a few codes), unlike the old clear-code-paced
   literal stream. */
function fsLzwStream(indices, minCodeSize) {
  var clear = 1 << minCodeSize, eoi = clear + 1;
  var bw = new fsBitWriter();
  var codeSize, next, dict;
  function reset() { codeSize = minCodeSize + 1; next = clear + 2; dict = new Map(); }
  reset();
  bw.write(clear, codeSize);
  if (indices.length === 0) { bw.write(eoi, codeSize); return bw.flush(); }
  var cur = indices[0] & 255;                      // running prefix, held as a code
  for (var i = 1; i < indices.length; i++) {
    var k = indices[i] & 255;
    var key = (cur << 8) | k;                      // prefixCode<<8 | symbol (symbol<=255)
    var found = dict.get(key);
    if (found !== undefined) { cur = found; continue; }
    bw.write(cur, codeSize);                        // emit the longest match at the OLD width
    if (next === (1 << codeSize) && codeSize < 12) codeSize++;  // grow BEFORE assigning the code that needs it
    if (next < 4096) {
      dict.set(key, next++);
    } else {
      bw.write(clear, codeSize);                    // table full -> reset, exactly like the decoder
      reset();
    }
    cur = k;
  }
  bw.write(cur, codeSize);
  bw.write(eoi, codeSize);
  return bw.flush();
}

function fsRangeOf(box) {
  var mn = [255, 255, 255], mx = [0, 0, 0];
  for (var i = 0; i < box.length; i++)
    for (var c = 0; c < 3; c++) {
      if (box[i][c] < mn[c]) mn[c] = box[i][c];
      if (box[i][c] > mx[c]) mx[c] = box[i][c];
    }
  var rr = mx[0] - mn[0], rg = mx[1] - mn[1], rb = mx[2] - mn[2];
  var range = Math.max(rr, rg, rb);
  return { range: range, channel: range === rr ? 0 : range === rg ? 1 : 2 };
}

function fsMedianCut(map, maxColors) {
  var pts = [];
  map.forEach(function (count, key) { pts.push([(key >> 16) & 255, (key >> 8) & 255, key & 255, count]); });
  if (pts.length <= maxColors) return pts.map(function (p) { return [p[0], p[1], p[2]]; });
  var boxes = [pts];
  while (boxes.length < maxColors) {
    var bi = -1, best = -1;
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      var r = fsRangeOf(boxes[i]).range;
      if (r > best) { best = r; bi = i; }
    }
    if (bi < 0) break;
    var box = boxes[bi];
    var ch = fsRangeOf(box).channel;
    box.sort(function (a, b) { return a[ch] - b[ch]; });
    var mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map(function (box) {
    var tr = 0, tg = 0, tb = 0, tw = 0;
    for (var i = 0; i < box.length; i++) {
      var wt = box[i][3];
      tr += box[i][0] * wt; tg += box[i][1] * wt; tb += box[i][2] * wt; tw += wt;
    }
    return [Math.round(tr / tw), Math.round(tg / tw), Math.round(tb / tw)];
  });
}

function fsBuildPalette(frames, w, h) {
  var map = new Map();
  var order = [];
  var CAP = 200000;
  outer:
  for (var f = 0; f < frames.length; f++) {
    var d = frames[f].data;
    for (var i = 0; i < w * h; i++) {
      var key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
      var c = map.get(key);
      if (c === undefined) { map.set(key, 1); order.push(key); if (order.length > CAP) break outer; }
      else map.set(key, c + 1);
    }
  }
  var colors;
  if (order.length <= 256) colors = order.map(function (k) { return [(k >> 16) & 255, (k >> 8) & 255, k & 255]; });
  else colors = fsMedianCut(map, 256);
  if (colors.length === 0) colors = [[0, 0, 0]];
  var cache = new Map();
  function indexOf(r, g, b) {
    var key = (r << 16) | (g << 8) | b;
    var hit = cache.get(key);
    if (hit !== undefined) return hit;
    var best = 0, bestD = Infinity;
    for (var i = 0; i < colors.length; i++) {
      var dr = colors[i][0] - r, dg = colors[i][1] - g, db = colors[i][2] - b;
      var dd = dr * dr + dg * dg + db * db;
      if (dd < bestD) { bestD = dd; best = i; if (dd === 0) break; }
    }
    cache.set(key, best);
    return best;
  }
  return { colors: colors, indexOf: indexOf };
}

/* Shared GIF assembly: fsGifSetup builds the palette + bit-depth once; the sync
   and async encoders then emit through fsGifWriteHeader + fsGifWriteFrame, so
   their byte streams are IDENTICAL by construction — the two paths differ ONLY
   in whether they await a yield between frames (asserted byte-identical in the
   sim). */
function fsGifSetup(frames, w, h, opts) {
  opts = opts || {};
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  var loop = opts.loop == null ? 0 : opts.loop | 0;   // 0 = infinite
  var pal = fsBuildPalette(frames, w, h);
  var colors = pal.colors;
  var bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, colors.length))));
  return { w: w, h: h, loop: loop, pal: pal, colors: colors, bits: bits };
}

function fsGifWriteHeader(out, w, h, colors, bits, loop) {
  var gctSize = 1 << bits;
  out.str('GIF89a');
  out.u16(w); out.u16(h);
  out.byte(0x80 | ((bits - 1) << 4) | (bits - 1));    // GCT flag + color res + GCT size
  out.byte(0); out.byte(0);                            // bg index, aspect
  for (var i = 0; i < gctSize; i++) {
    var c = colors[i] || [0, 0, 0];
    out.byte(c[0]); out.byte(c[1]); out.byte(c[2]);
  }
  out.byte(0x21); out.byte(0xFF); out.byte(0x0B);      // NETSCAPE loop
  out.str('NETSCAPE2.0');
  out.byte(0x03); out.byte(0x01); out.u16(loop); out.byte(0x00);
}

function fsGifWriteFrame(out, frame, w, h, pal, bits) {
  var delayCs = Math.max(2, Math.round((frame.delayMs || 100) / 10));
  out.byte(0x21); out.byte(0xF9); out.byte(0x04);
  out.byte(0x00); out.u16(delayCs); out.byte(0x00); out.byte(0x00); // GCE
  out.byte(0x2C); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.byte(0x00); // image descriptor
  var data = frame.data;
  var idx = new Array(w * h);
  for (var q = 0; q < w * h; q++) idx[q] = pal.indexOf(data[q * 4], data[q * 4 + 1], data[q * 4 + 2]);
  out.byte(bits);
  var lzw = fsLzwStream(idx, bits);
  for (var o = 0; o < lzw.length; o += 255) {
    var n = Math.min(255, lzw.length - o);
    out.byte(n);
    for (var k = 0; k < n; k++) out.byte(lzw[o + k]);
  }
  out.byte(0x00);
}

function fsEncodeGIF(frames, w, h, opts) {
  opts = opts || {};
  if (!frames || !frames.length) return new Uint8Array(0);
  var s = fsGifSetup(frames, w, h, opts);
  var out = new fsByteWriter();
  fsGifWriteHeader(out, s.w, s.h, s.colors, s.bits, s.loop);
  for (var f = 0; f < frames.length; f++) {
    fsGifWriteFrame(out, frames[f], s.w, s.h, s.pal, s.bits);
    if (opts.onProgress) opts.onProgress(f + 1, frames.length);
  }
  out.byte(0x3B);
  return out.bytes();
}

/* ===================== PURE: async-chunked GIF encoder ===================== */
/* A byte-identical twin of fsEncodeGIF (same fsGifSetup + fsGifWriteHeader +
   fsGifWriteFrame) that awaits opts.yield() after every opts.chunkSize frames
   (default 4), so a long encode hands control back to the browser and the
   #scProgress readout repaints MID-encode — the sync encoder blocks the whole
   encode in one call. opts.yield defaults to a macrotask (setTimeout 0); a
   microtask would NOT let the browser paint. onProgress fires once per frame,
   exactly like the sync path. */
async function fsEncodeGIFAsync(frames, w, h, opts) {
  opts = opts || {};
  if (!frames || !frames.length) return new Uint8Array(0);
  var s = fsGifSetup(frames, w, h, opts);
  var out = new fsByteWriter();
  fsGifWriteHeader(out, s.w, s.h, s.colors, s.bits, s.loop);
  var chunk = Math.max(1, (opts.chunkSize || 4) | 0);
  var doYield = typeof opts.yield === 'function'
    ? opts.yield
    : function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  for (var f = 0; f < frames.length; f++) {
    fsGifWriteFrame(out, frames[f], s.w, s.h, s.pal, s.bits);
    if (opts.onProgress) opts.onProgress(f + 1, frames.length);
    if ((f + 1) % chunk === 0 && f + 1 < frames.length) await doYield();
  }
  out.byte(0x3B);
  return out.bytes();
}

/* ===================== UI (browser only) ===================== */
if (typeof document !== 'undefined' && typeof window !== 'undefined' &&
    typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', fsScrollClipInit);
}

var FS_OUTW = { s: 480, m: 640, l: 800 };
var FS_ASPECT = { wide: 9 / 16, classic: 3 / 4, square: 1, tall: 5 / 4, story: 16 / 9 };

async function fsScrollClipInit() {
  var $ = function (id) { return document.getElementById(id); };
  if (!$('scStage')) return;                           // not the scroll-clip page

  var params = new URLSearchParams(location.search);
  var shotId = params.get('shot');
  var seg = Number(params.get('seg') || 0);
  var themeBtn = $('themeBtn'); if (themeBtn) themeBtn.addEventListener('click', fsToggleTheme);
  /* Escape dismisses the toast, the one transient overlay this page paints.
     The encoding progress line beside it is NOT dismissible on purpose: it
     reports work that is still running, and hiding it would hide the only
     thing saying so. Nothing here traps focus. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var t = document.getElementById('fs-toast');
    if (t) t.classList.remove('show');
  });
  var settings = await fsGetSettings();

  var shot = shotId ? await FSDB.get('shots', shotId) : null;
  if (!shot || !shot.segments || !shot.segments[seg]) {
    /* Built node by node rather than by assigning innerHTML: this panel's two
       sentences now come out of a message file, and a message is TEXT. The sink
       is what decides whether a translated string is content or markup — the
       same rule fsApplyI18n follows with textContent + setAttribute. */
    var lost = $('scLoading');
    lost.removeAttribute('data-i18n');            // no longer the "Loading…" line
    lost.textContent = '';
    var lostBox = document.createElement('div');
    lostBox.style.textAlign = 'center';
    var lostTitle = document.createElement('h2');
    lostTitle.textContent = fsMessage('editorNotFound', null, 'Screenshot not found');
    var lostLink = document.createElement('a');
    lostLink.className = 'btn primary';
    lostLink.href = 'history.html';
    lostLink.textContent = fsMessage('resultOpenHistory', null, 'Open history');
    lostBox.appendChild(lostTitle);
    lostBox.appendChild(lostLink);
    lost.appendChild(lostBox);
    return;
  }
  var backBtn = $('backBtn'); if (backBtn) backBtn.href = 'result.html?shot=' + encodeURIComponent(shot.id);
  var img = await createImageBitmap(shot.segments[seg].blob);

  var opts = { outW: 'm', aspect: 'wide', density: 1, fps: 12, speed: 800, bounce: false, loop: true, format: 'gif' };
  var preview = $('scCanvas');
  var pctx = preview.getContext('2d');
  var geom = null, view = null, playTimer = null, playIdx = 0;

  function rebuild() {
    view = null;
    geom = fsScrollFrames(img.width, img.height, {
      outW: FS_OUTW[opts.outW], aspect: FS_ASPECT[opts.aspect], density: opts.density,
      fps: opts.fps, speed: opts.speed, bounce: opts.bounce
    });
    view = geom.view;
    preview.width = view.w; preview.height = view.h;
    /* ONE plural-aware message, not four fragments joined with '·': the frame
       count needs the locale's own CLDR category (ja has one form, ru four, ar
       six), and several languages put the count after the noun, which a
       concatenation fixes into English word order for good.
       WIDTH and HEIGHT go in as raw digits — they are the capture's own pixel
       measurements, the same data fsDims() pins, and #scDims is pinned
       `direction: ltr` in CSS so the pair cannot reverse in an RTL locale.
       COUNT and SECONDS are quantities inside a sentence, so they take the
       locale's digits and decimal mark; the English file's own description of
       $SECONDS$ asks for exactly that ("10,7"). */
    var frameCount = geom.frames.length;
    $('scDims').textContent = fsPluralMessage('scrollclipDims', frameCount,
      [String(view.w), String(view.h), fsNumber(frameCount),
       fsNumber(Number((geom.totalMs / 1000).toFixed(1)))],
      '$WIDTH$ × $HEIGHT$ · $COUNT$ frames · $SECONDS$s');
    playIdx = 0;
    startPlay();
  }
  function startPlay() {
    if (playTimer) clearInterval(playTimer);
    if (!geom || !geom.frames.length) return;
    playTimer = setInterval(function () {
      var fr = geom.frames[playIdx % geom.frames.length];
      fsRenderScrollFrame(pctx, img, fr.y, view);
      playIdx++;
    }, geom.frames[0].delayMs);
  }

  bindGroup('scOutW', function (v) { opts.outW = v; rebuild(); });
  bindGroup('scShape', function (v) { opts.aspect = v; rebuild(); });
  bindGroup('scDensity', function (v) { opts.density = +v || 1; rebuild(); });
  bindGroup('scFormat', function (v) { opts.format = v; });
  var fpsIn = $('scFps'), spdIn = $('scSpeed');
  fpsIn.addEventListener('input', function () { opts.fps = +fpsIn.value; $('scFpsVal').textContent = fpsIn.value; rebuild(); });
  spdIn.addEventListener('input', function () { opts.speed = +spdIn.value; $('scSpeedVal').textContent = spdIn.value; rebuild(); });
  $('scBounce').addEventListener('change', function (e) { opts.bounce = !!e.target.checked; rebuild(); });
  $('scLoop').addEventListener('change', function (e) { opts.loop = !!e.target.checked; });

  function renderFrameData(fr) {
    var c = document.createElement('canvas');
    c.width = view.w; c.height = view.h;
    fsRenderScrollFrame(c.getContext('2d'), img, fr.y, view);
    return c.getContext('2d').getImageData(0, 0, view.w, view.h).data;
  }

  function fsProgress(msg) {
    var p = $('scProgress'); if (!p) return;
    if (msg) { p.hidden = false; p.textContent = msg; } else { p.hidden = true; p.textContent = ''; }
  }
  function fsYield() { return new Promise(function (r) { setTimeout(r, 0); }); }

  /* The format NAMES (GIF, WebM, PNG) are not substitutions: the English file
     declares them as fixed-content placeholders, because a file format is a
     proper noun no locale may translate. So these calls pass only the numbers,
     and the English fallbacks spell the names out. */
  function encodingMsg(percent) {
    return fsMessage('scrollclipProgressEncoding', [fsNumber(percent)], 'Encoding GIF… $PERCENT$%');
  }

  async function exportGif() {
    var total = geom.frames.length;
    var frames = [];
    for (var i = 0; i < geom.frames.length; i++) {
      frames.push({ data: renderFrameData(geom.frames[i]), delayMs: geom.frames[i].delayMs });
      if ((i & 7) === 0) {
        fsProgress(fsMessage('scrollclipProgressRendering',
          [fsNumber(Math.round(100 * (i + 1) / total))], 'Rendering frames… $PERCENT$%'));
        await fsYield();
      }
    }
    fsProgress(encodingMsg(0)); await fsYield();
    var bytes = await fsEncodeGIFAsync(frames, view.w, view.h, {
      loop: opts.loop ? 0 : 1,
      chunkSize: 4,
      yield: fsYield,
      onProgress: function (done, tot) {
        fsProgress(done < tot ? encodingMsg(Math.round(100 * done / tot))
          : fsMessage('scrollclipProgressFinalizing', null, 'Finalizing…'));
      }
    });
    fsProgress('');
    var blob = new Blob([bytes], { type: 'image/gif' });
    await save(blob, '.gif');
  }
  async function exportWebm() {
    var mime = fsPickWebmMime();
    if (!mime) {
      fsToast(fsMessage('scrollclipWebmUnsupported', null, 'WebM not supported here — exporting GIF'));
      return exportGif();
    }
    fsProgress(fsMessage('scrollclipProgressRecording', null, 'Recording WebM…'));
    fsToast(fsMessage('scrollclipToastRecording', null, 'Recording…'));
    var blob = await fsRecordWebM(img, geom, view, mime);
    fsProgress('');
    await save(blob, '.webm');
  }
  async function save(blob, ext) {
    /* The NAME is not translated and never will be: it is built from the
       captured page's {domain} and {title} and it is what lands on disk. Only
       the sentence around it is a message. */
    var name = fsBuildFilename(settings.filenameTemplate || 'fullshot-{date}-{time}',
      { title: (shot.title || 'shot') + '-scroll', url: shot.url || '', width: view.w, height: view.h }) + ext;
    await fsDownloadBlob(blob, name);
    fsToast(fsMessage('toastSavedFileSize', [name, fsFormatBytes(blob.size)],
      'Saved $FILENAME$  ·  $SIZE$'));
  }

  $('scDownload').addEventListener('click', async function () {
    var btn = $('scDownload'); btn.disabled = true;
    try { if (opts.format === 'webm') await exportWebm(); else await exportGif(); }
    // Wraps save() -> fsDownloadBlob: a name from the captured page's {domain}
    // and {title}, under the user's synced saveDirectory. One placeholdered
    // message rather than a prefix joined to a clause — the dash, the spacing
    // and the order of the two halves belong to the locale; fsHumanReason stays
    // the only thing allowed to describe the failure.
    catch (e) { fsToast(fsMessage('toastExportFailed', [fsHumanReason(e)], 'Export failed — $REASON$')); }
    finally { btn.disabled = false; fsProgress(''); }
  });
  $('scCopyFrame').addEventListener('click', async function () {
    try {
      var c = document.createElement('canvas'); c.width = view.w; c.height = view.h;
      fsRenderScrollFrame(c.getContext('2d'), img, 0, view);
      var blob = await fsCanvasToBlob(c, 'image/png');
      await fsCopyBlobToClipboard(blob, settings.clipboardFit);
      fsToast(fsMessage('scrollclipToastCopiedFrame', null, 'Copied poster frame'));
    } catch (e) { fsToast(fsMessage('toastCopyFailed', [fsHumanReason(e)], 'Copy failed — $REASON$')); }
  });

  /* The class and the attribute move together. Splitting them is how markup
     that is correct on load becomes wrong on the first click: the rail would
     keep painting the right button while telling every screen reader that the
     original default is still the selected one. */
  function bindGroup(id, cb) {
    var wrap = $(id); if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        cb(btn.dataset.v);
      });
    });
  }

  $('scLoading').hidden = true;
  $('scStage').hidden = false;
  rebuild();
}

function fsPickWebmMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  var cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (var i = 0; i < cands.length; i++) if (MediaRecorder.isTypeSupported(cands[i])) return cands[i];
  return null;
}

/* Browser-only: play the frames onto a canvas at wall-clock speed and let
   MediaRecorder capture the stream into a WebM blob. Not sim-testable (no
   browser) — verified on-device, like beautify's gradient/shadow. */
async function fsRecordWebM(img, geom, view, mime) {
  var canvas = document.createElement('canvas');
  canvas.width = view.w; canvas.height = view.h;
  var ctx = canvas.getContext('2d');
  var fps = Math.max(1, Math.round(1000 / geom.frames[0].delayMs));
  fsRenderScrollFrame(ctx, img, geom.frames[0].y, view);
  var stream = canvas.captureStream(fps);
  var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
  var chunks = [];
  rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  var done = new Promise(function (res) { rec.onstop = function () { res(new Blob(chunks, { type: mime })); }; });
  rec.start();
  for (var i = 0; i < geom.frames.length; i++) {
    fsRenderScrollFrame(ctx, img, geom.frames[i].y, view);
    await new Promise(function (r) { setTimeout(r, geom.frames[i].delayMs); });
  }
  await new Promise(function (r) { setTimeout(r, 150); });
  rec.stop();
  return done;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fsScrollFrames, fsRenderScrollFrame, fsEncodeGIF, fsEncodeGIFAsync };
}
