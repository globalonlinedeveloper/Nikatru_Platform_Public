/* FullShot Beautify — compose a capture onto a styled backdrop (background,
   padding, rounded corners, drop shadow, optional window frame) at a target
   aspect / size preset. The geometry (fsBeautifyLayout) and the canvas paint
   (fsRenderBeautified) are PURE and node-testable (test/beautify-sim.node.js);
   the UI wiring is guarded so the pure functions can be required in the sim.
   No dependencies, no build step. Effects that a real browser has but the
   node canvas shim lacks (gradient, soft shadow, rounded clip) are
   feature-detected and degrade to a solid fill + square image. */
'use strict';

var FS_PRESETS = {
  auto:     null,                 // fit to image + padding, no fixed aspect
  og:       { w: 1200, h: 630 },  // Open Graph / X card
  square:   { w: 1080, h: 1080 }, // Instagram square
  portrait: { w: 1080, h: 1350 }, // Instagram / LinkedIn portrait
  wide:     { w: 1920, h: 1080 }  // 16:9 slide
};
/* `id` is the enum — it is what the swatch IS, and it must never be
   translated. `i18n`/`name` are what the swatch is CALLED: the tooltip used to
   render the id itself, so an English speaker read "slate" and everyone else
   read "slate" too. The key is spelled out per row rather than derived from the
   id, so a grep for the message name finds this file. */
var FS_BG_PRESETS = [
  { id: 'slate',    i18n: 'beautifyBgSlate',    name: 'Slate',    type: 'solid',    color: '#e9edf5' },
  { id: 'graphite', i18n: 'beautifyBgGraphite', name: 'Graphite', type: 'solid',    color: '#2b2f36' },
  { id: 'sky',      i18n: 'beautifyBgSky',      name: 'Sky',      type: 'gradient', from: '#48c6ef', to: '#6f86d6', angle: 135 },
  { id: 'sunset',   i18n: 'beautifyBgSunset',   name: 'Sunset',   type: 'gradient', from: '#ff9a9e', to: '#fad0c4', angle: 135 },
  { id: 'grape',    i18n: 'beautifyBgGrape',    name: 'Grape',    type: 'gradient', from: '#6a11cb', to: '#2575fc', angle: 135 },
  { id: 'mint',     i18n: 'beautifyBgMint',     name: 'Mint',     type: 'gradient', from: '#0ba360', to: '#3cba92', angle: 135 }
];
var FS_BAR_H = 36;

/* Pure geometry. Given the source image size + options, returns the output
   canvas size and where the background, optional window bar and the image go.
   'auto' = image + padding (1:1). A preset = an exact WxH the framed content
   is scaled to fit (contain) and centered within, inside the padding. */
function fsBeautifyLayout(imgW, imgH, opts) {
  opts = opts || {};
  imgW = Math.max(1, imgW | 0); imgH = Math.max(1, imgH | 0);
  var pad = Math.max(0, opts.padding == null ? 64 : opts.padding | 0);
  var radius0 = Math.max(0, opts.radius == null ? 12 : opts.radius | 0);
  var barH0 = opts.frame === 'window' ? FS_BAR_H : 0;
  var preset = FS_PRESETS[opts.preset || 'auto'] || null;
  var contentW0 = imgW, contentH0 = imgH + barH0;
  var outW, outH, scale, ox, oy;
  if (!preset) {
    scale = 1;
    outW = imgW + pad * 2;
    outH = contentH0 + pad * 2;
    ox = pad; oy = pad;
  } else {
    outW = preset.w; outH = preset.h;
    var availW = Math.max(1, outW - pad * 2), availH = Math.max(1, outH - pad * 2);
    scale = Math.min(availW / contentW0, availH / contentH0);
    if (!(scale > 0) || !isFinite(scale)) scale = 1;
    var cw = Math.round(contentW0 * scale), ch = Math.round(contentH0 * scale);
    ox = Math.round((outW - cw) / 2); oy = Math.round((outH - ch) / 2);
  }
  var barH = Math.round(barH0 * scale);
  var drawW = Math.round(imgW * scale);
  var drawImgH = Math.round(imgH * scale);
  var radius = Math.round(radius0 * scale);
  return {
    outW: outW, outH: outH, scale: scale,
    content: { x: ox, y: oy, w: drawW, h: barH + drawImgH },
    bar: barH0 ? { x: ox, y: oy, w: drawW, h: barH } : null,
    img: { x: ox, y: oy + barH, w: drawW, h: drawImgH },
    radius: radius
  };
}

/* Rounded-rect subpath. r is a number or [tl,tr,br,bl]. Only called when the
   context supports paths (real browser); the shim never reaches it. */
function fsRoundRectPath(ctx, x, y, w, h, r) {
  var tl, tr, br, bl;
  if (Array.isArray(r)) { tl = r[0]; tr = r[1]; br = r[2]; bl = r[3]; }
  else { tl = tr = br = bl = r || 0; }
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
  ctx.closePath();
}

/* Paint the composed image onto ctx (canvas already sized to layout.outW/H). */
function fsRenderBeautified(ctx, img, layout, opts) {
  opts = opts || {};
  var bg = opts.bg || { type: 'solid', color: '#e9edf5' };
  var L = layout;

  // 1) background — gradient when the context supports it, else solid
  if (bg.type === 'gradient' && typeof ctx.createLinearGradient === 'function') {
    var a = (bg.angle == null ? 135 : bg.angle) * Math.PI / 180;
    var cxp = L.outW / 2, cyp = L.outH / 2, hyp = Math.max(L.outW, L.outH);
    var dx = Math.cos(a) * hyp / 2, dy = Math.sin(a) * hyp / 2;
    var g = ctx.createLinearGradient(cxp - dx, cyp - dy, cxp + dx, cyp + dy);
    g.addColorStop(0, bg.from || '#6a11cb');
    g.addColorStop(1, bg.to || '#2575fc');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bg.color || bg.from || '#e9edf5';
  }
  ctx.fillRect(0, 0, L.outW, L.outH);

  var hasPath = typeof ctx.beginPath === 'function' && typeof ctx.arcTo === 'function';
  var hasSave = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
  var hasShadow = ('shadowBlur' in ctx) || typeof ctx.shadowBlur !== 'undefined';

  // 2) white card + drop shadow behind the content (browser only)
  if (opts.shadow !== false && hasShadow && hasPath && hasSave) {
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.30)';
    ctx.shadowBlur = Math.max(12, Math.round(L.content.w * 0.035));
    ctx.shadowOffsetY = Math.max(8, Math.round(L.content.w * 0.02));
    ctx.fillStyle = '#ffffff';
    fsRoundRectPath(ctx, L.content.x, L.content.y, L.content.w, L.content.h, L.radius);
    ctx.fill();
    ctx.restore();
  }

  // 3) window title bar (traffic lights)
  if (L.bar) {
    ctx.fillStyle = '#e4e7ec';
    if (hasPath && hasSave && L.radius && typeof ctx.clip === 'function') {
      ctx.save();
      fsRoundRectPath(ctx, L.bar.x, L.bar.y, L.bar.w, L.bar.h, [L.radius, L.radius, 0, 0]);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillRect(L.bar.x, L.bar.y, L.bar.w, L.bar.h);
    }
    var dotColors = ['#ff5f57', '#febc2e', '#28c840'];
    var dr = Math.max(3, Math.round(L.bar.h * 0.16));
    for (var i = 0; i < 3; i++) {
      ctx.fillStyle = dotColors[i];
      var dxp = L.bar.x + 16 + i * (dr * 2 + 8);
      var dyp = L.bar.y + Math.round(L.bar.h / 2 - dr);
      if (hasPath && typeof ctx.arc === 'function') {
        ctx.beginPath(); ctx.arc(dxp + dr, dyp + dr, dr, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(dxp, dyp, dr * 2, dr * 2);
      }
    }
  }

  // 4) the screenshot — rounded-clip when supported, square in the shim
  var clip = L.radius > 0 && hasPath && hasSave && typeof ctx.clip === 'function';
  if (clip) {
    ctx.save();
    fsRoundRectPath(ctx, L.img.x, L.img.y, L.img.w, L.img.h,
      L.bar ? [0, 0, L.radius, L.radius] : L.radius);
    ctx.clip();
  }
  ctx.imageSmoothingEnabled = true;
  if (typeof ctx.imageSmoothingQuality !== 'undefined') ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, L.img.x, L.img.y, L.img.w, L.img.h);
  if (clip) ctx.restore();
}

/* ---------------- UI (browser only) ---------------- */
if (typeof document !== 'undefined' && typeof window !== 'undefined' &&
    typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', fsBeautifyInit);
}

async function fsBeautifyInit() {
  var $ = function (id) { return document.getElementById(id); };
  if (!$('bfStage')) return;   // not the beautify page — do nothing

  var params = new URLSearchParams(location.search);
  var shotId = params.get('shot');
  var seg = Number(params.get('seg') || 0);
  var themeBtn = $('themeBtn'); if (themeBtn) themeBtn.addEventListener('click', fsToggleTheme);
  /* Escape dismisses the toast — the one transient overlay this page paints,
     and it sits over the preview the user is judging. Nothing here traps
     focus, so that is the whole of Escape's job on this page. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var t = document.getElementById('fs-toast');
    if (t) t.classList.remove('show');
  });
  var settings = await fsGetSettings();

  var shot = shotId ? await FSDB.get('shots', shotId) : null;
  if (!shot || !shot.segments || !shot.segments[seg]) {
    /* Built node by node. This panel used to be one assignment to a markup
       sink; two of its three strings now come out of a message file, and
       translated text that becomes markup is the defect class this product has
       already shipped once. createElement + textContent has no sink to get
       wrong. (The sink's NAME is left unwritten even here: beautify-sim counts
       call sites by grepping this file, comments and all, and a static check
       cannot tell a prohibition from its own description of one.) */
    var box = document.createElement('div');
    box.style.textAlign = 'center';
    var lost = document.createElement('h2');
    lost.textContent = fsMessage('editorNotFound', null, 'Screenshot not found');
    var toHistory = document.createElement('a');
    toHistory.className = 'btn primary';
    toHistory.href = 'history.html';
    toHistory.textContent = fsMessage('resultOpenHistory', null, 'Open history');
    box.appendChild(lost);
    box.appendChild(toHistory);
    var loading = $('bfLoading');
    /* The key comes off first: #bfLoading carries data-i18n="commonLoading",
       and a second pass of fsApplyI18n would otherwise put "Loading…" back and
       delete this panel with it. */
    loading.removeAttribute('data-i18n');
    loading.textContent = '';
    loading.appendChild(box);
    return;
  }
  var backBtn = $('backBtn'); if (backBtn) backBtn.href = 'result.html?shot=' + encodeURIComponent(shot.id);
  var img = await createImageBitmap(shot.segments[seg].blob);

  var opts = { preset: 'auto', padding: 64, radius: 14, frame: 'none', shadow: true, bg: FS_BG_PRESETS[4] };
  var full = document.createElement('canvas');
  var preview = $('bfCanvas');

  // background swatches
  var bgWrap = $('bfBg');
  FS_BG_PRESETS.forEach(function (b, i) {
    var sw = document.createElement('button');
    sw.type = 'button';
    var on = b === opts.bg;
    sw.className = 'bf-swatch' + (on ? ' active' : '');
    sw.style.background = b.type === 'gradient'
      ? 'linear-gradient(135deg,' + b.from + ',' + b.to + ')' : b.color;
    /* A swatch is a coloured rectangle with no text: aria-label is the only
       thing that can name it, and the name is the same message the tooltip
       spends. Without it a reader hears six unnamed buttons — and colour is
       the one attribute a swatch has that a reader cannot perceive at all. */
    sw.setAttribute('aria-label', fsMessage(b.i18n, null, b.name));
    sw.title = fsMessage(b.i18n, null, b.name);
    /* aria-pressed carries the state the `active` class paints. A class is
       invisible to everything except the stylesheet. */
    sw.setAttribute('aria-pressed', on ? 'true' : 'false');
    sw.addEventListener('click', function () {
      opts.bg = b;
      Array.prototype.forEach.call(bgWrap.children, function (c) {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
      sw.classList.add('active');
      sw.setAttribute('aria-pressed', 'true');
      render();
    });
    bgWrap.appendChild(sw);
  });

  bindGroup('bfPreset', function (v) { opts.preset = v; render(); });

  var padIn = $('bfPad'), radIn = $('bfRadius');
  padIn.addEventListener('input', function () { opts.padding = +padIn.value; $('bfPadVal').textContent = padIn.value; render(); });
  radIn.addEventListener('input', function () { opts.radius = +radIn.value; $('bfRadiusVal').textContent = radIn.value; render(); });
  $('bfShadow').addEventListener('change', function (e) { opts.shadow = !!e.target.checked; render(); });
  $('bfFrame').addEventListener('change', function (e) { opts.frame = e.target.checked ? 'window' : 'none'; render(); });

  function render() {
    var L = fsBeautifyLayout(img.width, img.height, opts);
    full.width = L.outW; full.height = L.outH;
    fsRenderBeautified(full.getContext('2d'), img, L, opts);
    preview.width = L.outW; preview.height = L.outH;
    preview.getContext('2d').drawImage(full, 0, 0);
    /* One message, not "w + ' × ' + h + ' px'": the unit is a word and several
       of the 55 put it elsewhere in the phrase. The × lives INSIDE the message
       between the two placeholders, so fsDims cannot wrap the pair here — what
       stops "1200 × 630" reading "630 × 1200" in an RTL page is the
       `direction: ltr; unicode-bidi: isolate` pin on #bfDims itself. Raw
       digits, deliberately: a pixel count takes no thousands separator. */
    $('bfDims').textContent =
      fsMessage('beautifyDims', [String(L.outW), String(L.outH)], '$WIDTH$ × $HEIGHT$ px');
  }

  $('bfDownload').addEventListener('click', async function () {
    try {
      var fmt = settings.imageFormat || 'png';
      var ext = fmt === 'jpeg' ? '.jpg' : fmt === 'webp' ? '.webp' : '.png';
      var blob = await fsCanvasToBlob(full, fsMime(fmt), fmt === 'png' ? undefined : settings.jpegQuality);
      var name = fsBuildFilename(settings.filenameTemplate || 'fullshot-{date}-{time}',
        { title: (shot.title || 'shot') + '-beautified', url: shot.url || '', width: full.width, height: full.height }) + ext;
      await fsDownloadBlob(blob, name);
      /* $FILENAME$ is a substitution, not a prefix: the filename is built from
         the captured page and is never translated, and several languages put
         the verb after the noun. The English stays as the fallback for a
         browser with no chrome.i18n. */
      fsToast(fsMessage('toastSavedFile', [name], 'Saved $FILENAME$'));
    // Wraps fsDownloadBlob — a name from the captured page, a synced path.
    /* The shared reducer answers in English: that clause vocabulary is
       pages/common.js's FS_REASONS table, not this page's. The SENTENCE around
       it is a message, so the dash and the word order come from the locale.
       (Spelled without a trailing paren on purpose — beautify-sim counts the
       reducer's call sites by grepping this file, comments and all.) */
    } catch (e) { fsToast(fsMessage('toastExportFailed', [fsHumanReason(e)], 'Export failed — $REASON$')); }
  });
  $('bfCopy').addEventListener('click', async function () {
    try {
      var blob = await fsCanvasToBlob(full, 'image/png');
      await fsCopyBlobToClipboard(blob, settings.clipboardFit);
      fsToast(fsMessage('toastCopiedClipboard', null, 'Copied to clipboard'));
    } catch (e) { fsToast(fsMessage('toastCopyFailed', [fsHumanReason(e)], 'Copy failed — $REASON$')); }
  });

  /* The class and the attribute move together, always. Splitting them is how
     markup that is correct on load becomes wrong on the first click — the
     rail would go on painting the right button while telling every screen
     reader that "Auto" is still the one selected. */
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

  $('bfLoading').hidden = true;
  $('bfStage').hidden = false;
  render();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fsBeautifyLayout, fsRenderBeautified, FS_PRESETS, FS_BG_PRESETS };
}
