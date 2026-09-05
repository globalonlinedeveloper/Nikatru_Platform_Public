#!/usr/bin/env node
/* FullShot PIXEL simulator — end-to-end without a browser.
   Loads the REAL content/capture.js into a vm realm against a fake DOM,
   renders every captured viewport to actual RGBA pixels (a synthetic
   captureVisibleTab), stitches them with the REAL pages/result.js, writes
   PNGs to test/pixel-sim/out/, and grades pixel + restore assertions.

   Scenarios:
     appshell        app-shell page (doc does NOT scroll, main pane does) — the
                     "internal scroll only captured current view" bug case
     appshell-banner same, plus 90px of document scroll and a pane whose bottom
                     is cut off by the viewport (reachable-height math)
     appshell-dpr125 the banner shell at devicePixelRatio 1.25 (Windows 125%):
                     fractional scroll quantization + gapless seam maps
     docscroll       classic document-scrolling page with expanded shadow-DOM
                     rail, inner panel and a mid-page sticky section header
                     (blank-band regression)

   Usage: node test/pixel-sim/run.js   [exit 0 = all pass] */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { El, Doc, gcs, hiddenNow, makeWindow } = require('./fakedom');
const { encodePng } = require('./png');
const { stitchWithRealResultJs } = require('./result-harness');
const { renderHistoryWithRealHistoryJs } = require('./history-harness');

const ROOT = process.env.FS_ROOT || path.join(__dirname, '..', '..');
const CAPTURE_SRC = fs.readFileSync(path.join(ROOT, 'content', 'capture.js'), 'utf8');
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VP_W = 1280, VP_H = 720;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- tiny raster helpers ---------------- */

function makeBuf(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  d.fill(255);
  return { width: w, height: h, data: d };
}
function fillRect(img, x, y, w, h, rgb) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w)), y1 = Math.min(img.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let off = (yy * img.width + x0) * 4;
    for (let xx = x0; xx < x1; xx++) {
      img.data[off] = rgb[0]; img.data[off + 1] = rgb[1]; img.data[off + 2] = rgb[2]; img.data[off + 3] = 255;
      off += 4;
    }
  }
}
function pxAt(seg, x, y) {
  const off = (Math.round(y) * seg.w + Math.round(x)) * 4;
  return [seg.data[off], seg.data[off + 1], seg.data[off + 2]];
}
function near(c, rgb, tol) {
  tol = tol == null ? 8 : tol;
  return Math.abs(c[0] - rgb[0]) <= tol && Math.abs(c[1] - rgb[1]) <= tol && Math.abs(c[2] - rgb[2]) <= tol;
}
function countRowsWithColor(seg, x, y0, y1, rgb, tol) {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(seg.h, y1); y++) {
    if (near(pxAt(seg, x, y), rgb, tol)) n++;
  }
  return n;
}
const WHITE = [255, 255, 255];

/* ---------------- colors ---------------- */
const C = {
  banner: [255, 215, 0], header: [51, 85, 238], footer: [68, 68, 80],
  sideEven: [200, 200, 210], sideOdd: [152, 152, 168],
  toolbar: [255, 51, 51], fab: [255, 0, 255],
  green: [0, 255, 136], blue: [0, 136, 255],
  navSentinel: [102, 51, 0]
};
const stripeA = i => [60 + i * 12, 120, 220 - i * 12];
const stripeB = i => [150, 80 + i * 7, 210];
const panelBand = i => [230, 120 + i * 12, 40];
const sideBand = i => (i % 2 ? C.sideOdd : C.sideEven);
const navBand = i => (i % 2 ? [255, 176, 80] : [255, 136, 0]);

/* ================= scenario: app shell ================= */

function buildAppShell({ bannerH = 0, dpr = 1 } = {}) {
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  let banner = null;
  if (bannerH > 0) { banner = body.appendChild(new El('div', doc, { clientH: bannerH, clientW: VP_W })); banner.id = 'banner'; }
  const header = body.appendChild(new El('header', doc, { clientH: 64, clientW: VP_W }));
  const row = body.appendChild(new El('div', doc, { clientH: 632, contentH: 632, clientW: VP_W }));

  const sidebar = row.appendChild(new El('aside', doc, { clientH: 632, clientW: 220, contentH: 1400 }));
  sidebar.id = 'sidebar';
  sidebar.setAttribute('style', 'overflow-y:auto');
  sidebar._rect = () => ({ left: 0, top: bannerH + 64 - win.scrollY, width: 220, height: 632 });

  const pane = row.appendChild(new El('main', doc, { clientH: 632, clientW: 1060 }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 220, top: bannerH + 64 - win.scrollY, width: 1060, height: 632 });

  const paneContent = pane.appendChild(new El('div', doc, { clientW: 1060 }));
  const toolbar = paneContent.appendChild(new El('div', doc, { clientH: 48, clientW: 1060 }));
  toolbar.id = 'toolbar';
  toolbar.setAttribute('style', 'position:sticky;top:0');
  paneContent.appendChild(new El('div', doc, { clientH: 1200, clientW: 1060 })); // stripes A
  const innerPanel = paneContent.appendChild(new El('div', doc, { clientH: 300, clientW: 900, contentH: 800 }));
  innerPanel.id = 'innerPanel';
  innerPanel.setAttribute('style', 'overflow-y:auto;height:300px');
  paneContent.appendChild(new El('div', doc, { clientH: 2000, clientW: 1060 })); // stripes B
  paneContent.appendChild(new El('div', doc, { clientH: 152, clientW: 1060 })); // bottom marker
  paneContent._base.contentH = () => 48 + 1200 + innerPanel.clientHeight + 2000 + 152;

  const footer = body.appendChild(new El('footer', doc, { clientH: 24, clientW: VP_W }));
  const fab = body.appendChild(new El('div', doc, { clientH: 64, clientW: 64 }));
  fab.id = 'fab';
  fab.setAttribute('style', 'position:fixed;right:26px;bottom:36px');

  body._base.contentH = () => bannerH + 64 + row.clientHeight + 24;
  html._base.contentH = () => body.clientHeight;

  /* user state */
  pane.scrollTop = 500;
  sidebar.scrollTop = dpr === 1 ? 260 : 130;   // 130*1.25 = 162.5 → quantizes
  innerPanel.scrollTop = 150;                  // 150*1.25 = 187.5 → quantizes
  win.scrollY = Math.min(bannerH, Math.max(0, html.scrollHeight - VP_H));

  /* what the tab looks like right now (synthetic captureVisibleTab) */
  function render() {
    const img = makeBuf(Math.round(VP_W * dpr), Math.round(VP_H * dpr));
    const S = (v) => v * dpr;
    const paneTop = bannerH + 64 - win.scrollY;

    const paneColorAt = (row) => {
      let r = row;
      if (r < 48) {
        // sticky toolbar: its flow slot is vacated while it rides the scroll;
        // neutralized (static) or unscrolled → it renders in the slot.
        if (hiddenNow(toolbar)) return WHITE;
        const stuck = gcs(toolbar).position === 'sticky' && pane.scrollTop > 0;
        return stuck ? WHITE : C.toolbar;
      }
      r -= 48;
      if (r < 1200) return stripeA(Math.floor(r / 100));
      r -= 1200;
      const ph = innerPanel.clientHeight;
      if (r < ph) {
        const pr = innerPanel.scrollTop + r;
        return pr >= 700 ? C.green : panelBand(Math.floor(pr / 100));
      }
      r -= ph;
      if (r < 2000) return stripeB(Math.floor(r / 100));
      r -= 2000;
      if (r < 152) return C.blue;
      return WHITE;
    };

    // pane content (device rows, clipped to viewport)
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + 632);
    for (let dy = Math.round(S(py0)); dy < Math.round(S(py1)); dy++) {
      const cssY = dy / dpr;
      const contentRow = pane.scrollTop + (cssY - paneTop);
      const col = paneColorAt(Math.floor(contentRow));
      fillRect(img, S(220), dy, S(1060), 1, col);
    }
    // sticky toolbar rides at the pane's top edge while scrolled AND sticky
    if (!hiddenNow(toolbar) && gcs(toolbar).position === 'sticky' && pane.scrollTop > 0) {
      fillRect(img, S(220), S(Math.max(0, paneTop)), S(1060), S(Math.min(48, py1 - py0)), C.toolbar);
    }
    // sidebar (never expanded — outside the pane)
    for (let dy = Math.round(S(py0)); dy < Math.round(S(py1)); dy++) {
      const cssY = dy / dpr;
      const srow = sidebar.scrollTop + (cssY - paneTop);
      if (srow < 1400) fillRect(img, 0, dy, S(220), 1, sideBand(Math.floor(srow / 40)));
    }
    // in-flow shell chrome
    if (banner) fillRect(img, 0, S(-win.scrollY), S(VP_W), S(bannerH), C.banner);
    fillRect(img, 0, S(bannerH - win.scrollY), S(VP_W), S(64), C.header);
    fillRect(img, 0, S(bannerH + 64 + 632 - win.scrollY), S(VP_W), S(24), C.footer);
    // fixed FAB (viewport anchored)
    if (!hiddenNow(fab)) fillRect(img, S(VP_W - 26 - 64), S(VP_H - 36 - 64), S(64), S(64), C.fab);
    return img;
  }

  return { name: 'appshell', doc, html, body, win, render, dpr, bannerH,
    refs: { pane, sidebar, innerPanel, toolbar, fab } };
}

/* ================= scenario: classic doc scroll ================= */

function buildDocScroll() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const grid = body.appendChild(new El('div', doc, { clientW: VP_W }));
  const rail = grid.appendChild(new El('fs-rail', doc, { clientW: 280 }));
  const r = rail.attachShadow();
  const wrap = new El('div', doc, { clientH: VP_H, clientW: 280 });
  wrap.id = 'wrap';
  wrap.setAttribute('style', 'position:sticky;top:0;height:100vh;overflow:hidden');
  r.appendChild(wrap);
  const nav = new El('div', doc, { clientW: 280 });
  nav.id = 'nav';
  nav.setAttribute('style', 'height:100%;overflow-y:auto');
  nav._base.clientH = () => (wrap._sv('height') === 'auto' ? Math.round(nav._contentH()) : wrap.clientHeight);
  nav._base.contentH = () => 2648;
  wrap.appendChild(nav);

  const main = grid.appendChild(new El('main', doc, { clientW: 1000 }));
  const innerPanel = main.appendChild(new El('div', doc, { clientH: 300, clientW: 900, contentH: 800 }));
  innerPanel.id = 'innerPanel';
  innerPanel.setAttribute('style', 'overflow-y:auto;height:300px');
  // mid-page sticky section header — the classic "blank band" trap
  const stickyHdr = main.appendChild(new El('div', doc, { clientH: 48, clientW: 1000 }));
  stickyHdr.id = 'stickyHdr';
  stickyHdr.setAttribute('style', 'position:sticky;top:0');
  main._base.clientH = () => 500 + innerPanel.clientHeight + 48 + 2000 + 152;
  main._base.contentH = main._base.clientH;

  rail._base.clientH = () => wrap.clientHeight;
  rail._base.contentH = rail._base.clientH;
  grid._base.clientH = () => Math.max(rail.clientHeight, main.clientHeight);
  grid._base.contentH = grid._base.clientH;

  const fab = body.appendChild(new El('div', doc, { clientH: 64, clientW: 64 }));
  fab.id = 'fab';
  fab.setAttribute('style', 'position:fixed;right:26px;bottom:36px');

  body._base.contentH = () => grid.clientHeight;
  html._base.contentH = () => body.clientHeight;

  nav.scrollTop = 150;
  innerPanel.scrollTop = 60;
  win.scrollY = 300;

  /* main-column layout (css rows): stripes 500 | panel | sticky 48 | stripes 2000 | blue 152 */
  const mainColorAt = (row) => {
    let m = row;
    if (m < 500) return stripeA(Math.floor(m / 100));
    m -= 500;
    const ph = innerPanel.clientHeight;
    if (m < ph) {
      const pr = innerPanel.scrollTop + m;
      return pr >= 700 ? C.green : panelBand(Math.floor(pr / 100));
    }
    m -= ph;
    if (m < 48) {
      // sticky header: flow slot vacated while stuck; rendered in-slot when
      // static (neutralized) or when the page hasn't reached it yet.
      if (hiddenNow(stickyHdr)) return WHITE;
      const flowTop = 500 + ph;
      const stuck = gcs(stickyHdr).position === 'sticky' && win.scrollY > flowTop;
      return stuck ? WHITE : C.toolbar;
    }
    m -= 48;
    if (m < 2000) return stripeB(Math.floor(m / 100));
    m -= 2000;
    if (m < 152) return C.blue;
    return WHITE;
  };

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const wrapStatic = gcs(wrap).position === 'static';
    for (let vy = 0; vy < VP_H; vy++) {
      const pageRow = win.scrollY + vy;
      // main column
      const col = pageRow < main.clientHeight ? mainColorAt(pageRow) : WHITE;
      fillRect(img, 280, vy, 1000, 1, col);
      // rail column
      if (!hiddenNow(nav)) {
        if (wrapStatic) {
          if (pageRow < nav.clientHeight) {
            const nr = nav.scrollTop + pageRow;
            fillRect(img, 0, vy, 280, 1, nr >= 2600 ? C.navSentinel : navBand(Math.floor(nr / 40)));
          }
        } else {
          const nr = nav.scrollTop + vy; // sticky: viewport-pinned
          if (nr < 2648) fillRect(img, 0, vy, 280, 1, nr >= 2600 ? C.navSentinel : navBand(Math.floor(nr / 40)));
        }
      }
    }
    // stuck sticky header rides at the viewport top over the main column
    if (!hiddenNow(stickyHdr) && gcs(stickyHdr).position === 'sticky' &&
        win.scrollY > 500 + innerPanel.clientHeight) {
      fillRect(img, 280, 0, 1000, 48, C.toolbar);
    }
    if (!hiddenNow(fab)) fillRect(img, VP_W - 26 - 64, VP_H - 36 - 64, 64, 64, C.fab);
    return img;
  }

  return { name: 'docscroll', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { nav, wrap, innerPanel, fab, stickyHdr } };
}

/* ================= scenario: tall multi-part page ================= */
/* 20000px of "text" (28px line rhythm: 6px quiet gap + 22 striped rows) —
   exceeds the 16000px canvas edge, so the stitcher must split into parts.
   The part boundary must snap to a gap row, never through a text line. */

function buildMultipart() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: 20000, clientW: VP_W }));
  body._base.contentH = () => 20000;
  html._base.contentH = () => 20000;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row >= 20000 || row % 28 < 6) continue;      // gap rows stay white
      // striped "glyphs": never horizontally uniform, so only real gaps
      // count as visually quiet rows
      for (let bx = 64; bx < VP_W; bx += 128) fillRect(img, bx, vy, 64, 1, [40, 40, 60]);
    }
    return img;
  }
  return { name: 'multipart', doc, html, body, win, render, dpr, bannerH: 0, refs: {} };
}

/* ================= scenario: wide inner table (merged right) ================= */
/* A 900px-wide panel scrolls sideways over 2400px of table. v1.4.0 widens it
   to full content, the page grows rightward, and the capture grid's extra
   columns stitch the hidden 1500px in — "merged right with the full scroll". */

const wideBand = i => (i % 2 ? [90, 170, 255] : [30, 110, 200]);

function buildDocWide() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const main = body.appendChild(new El('main', doc, { clientW: 1000 }));
  main.appendChild(new El('div', doc, { clientH: 800, clientW: 1000 }));   // stripes A
  const wide = main.appendChild(new El('div', doc, { clientH: 300, clientW: 900, contentW: 2400, contentH: 300 }));
  wide.id = 'widePanel';
  wide.setAttribute('style', 'overflow-x:auto;width:900px;height:300px');
  main.appendChild(new El('div', doc, { clientH: 1248, clientW: 1000 }));  // stripes B
  main.appendChild(new El('div', doc, { clientH: 152, clientW: 1000 }));   // blue marker
  main._base.clientH = () => 800 + wide.clientHeight + 1248 + 152;
  main._base.contentH = main._base.clientH;
  main._base.contentW = () => Math.max(1000, wide.clientWidth);

  body._base.contentH = () => main.clientHeight;
  body._base.contentW = () => 280 + main.scrollWidth;          // main sits at x=280
  html._base.contentH = () => body.clientHeight;
  html._base.contentW = () => Math.max(VP_W, body.scrollWidth);

  wide.scrollLeft = 300;   // user had scrolled the table a bit
  win.scrollY = 200;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const sxw = win.scrollX;
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 800) {
        fillRect(img, 280 - sxw, vy, 1000, 1, stripeA(Math.floor(row / 100)));
      } else if (row < 1100) {
        const w = wide.clientWidth, sl = wide.scrollLeft;
        for (let b = Math.floor(sl / 200); b * 200 < sl + w; b++) {
          const pc0 = b * 200;
          const x0 = 280 + Math.max(pc0 - sl, 0), x1 = 280 + Math.min(pc0 + 200 - sl, w);
          if (x1 <= x0) continue;
          fillRect(img, x0 - sxw, vy, x1 - x0, 1, pc0 >= 2200 ? C.green : wideBand(b));
        }
      } else if (row < 2348) {
        fillRect(img, 280 - sxw, vy, 1000, 1, stripeB(Math.floor((row - 1100) / 100)));
      } else if (row < 2500) {
        fillRect(img, 280 - sxw, vy, 1000, 1, C.blue);
      }
    }
    return img;
  }
  return { name: 'docwide', doc, html, body, win, render, dpr, bannerH: 0, refs: { wide } };
}

/* ================= scenario: reddit-like feed ================= */
/* Document scrolls; a FIXED left rail holds its own scroller (2200px of nav
   in a 640px box — Reddit's left sidebar); the feed is 24 media cards whose
   media rows are perfectly uniform (the pixel-quiet trap). Reproduces both
   reported bugs: the rail must be unrolled via the un-hide side pass, and
   the part boundary must land exactly on a card top via break hints — the
   pixel fallback alone would cut through the middle of a flat media block. */

const CARD = { header: [200, 80, 80], title: [30, 30, 40], media: [60, 60, 70], votes: [90, 90, 110] };
const EB_COL = [120, 200, 120];          // recommendation context bar ("Because you've visited…")
const BTN_COL = [255, 0, 255];           // rail collapse toggle (viewport-anchored)
const PITCH = 756, CARD_H = 740, FEED_TOP = 200, NCARDS = 24;
const EYEBROW_CARD = 20, EB_H = 36, EB_GAP = 8;

function buildRedditLike() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const pageHeader = body.appendChild(new El('div', doc, { clientH: FEED_TOP, clientW: VP_W }));
  pageHeader._rect = () => ({ left: 0, top: -win.scrollY, width: VP_W, height: FEED_TOP });

  const feed = body.appendChild(new El('div', doc, { clientW: 900 }));
  feed._rect = () => ({ left: 340, top: FEED_TOP - win.scrollY, width: 900, height: NCARDS * PITCH });
  for (let k = 0; k < NCARDS; k++) {
    const top = FEED_TOP + k * PITCH;
    if (k === EYEBROW_CARD) {
      // Reddit-like recommended post: a short context bar attached above the
      // card ("Because you've visited this community before") that must ride
      // WITH the card onto the next part, plus a gallery body whose sizable
      // inner images are hint TRAPS — the old collector emitted their tops
      // and the stitcher cut mid-post at the largest one.
      const eb = feed.appendChild(new El('div', doc, { clientH: EB_H, clientW: 900 }));
      eb._rect = () => ({ left: 340, top: top - win.scrollY, width: 900, height: EB_H });
      const cardTop = top + EB_H + EB_GAP;
      const cardH = CARD_H - EB_H - EB_GAP;
      const card = feed.appendChild(new El('div', doc, { clientH: cardH, clientW: 900 }));
      card._rect = () => ({ left: 340, top: cardTop - win.scrollY, width: 900, height: cardH });
      const kids = [40, 40, 200, 200, 176, 40]; // header, title, img×3, votes
      let off = 0;
      for (const kh of kids) {
        const kel = card.appendChild(new El('div', doc, { clientH: kh, clientW: 900 }));
        const o = off;
        kel._rect = () => ({ left: 340, top: cardTop + o - win.scrollY, width: 900, height: kh });
        off += kh;
      }
    } else {
      const card = feed.appendChild(new El('div', doc, { clientH: CARD_H, clientW: 900 }));
      card._rect = () => ({ left: 340, top: top - win.scrollY, width: 900, height: CARD_H });
    }
    const gap = feed.appendChild(new El('div', doc, { clientH: PITCH - CARD_H, clientW: 900 }));
    const gtop = top + CARD_H;
    gap._rect = () => ({ left: 340, top: gtop - win.scrollY, width: 900, height: PITCH - CARD_H });
  }
  body._base.contentH = () => FEED_TOP + NCARDS * PITCH;
  html._base.contentH = () => body.clientHeight;

  // fixed left rail (Reddit left nav): fixed wrapper, inner scroller
  const railWrap = body.appendChild(new El('div', doc, { clientH: 640, clientW: 300 }));
  railWrap.id = 'railWrap';
  railWrap.setAttribute('style', 'position:fixed;left:0;top:80px');
  railWrap._rect = () => ({ left: 0, top: 80, width: 300, height: 640 });
  const rail = railWrap.appendChild(new El('div', doc, { clientH: 640, clientW: 300, contentH: 2200 }));
  rail.id = 'rail';
  rail.setAttribute('style', 'overflow-y:auto;height:640px');
  rail._rect = () => ({ left: 0, top: 80, width: 300, height: 640 });
  // Collapse toggle: viewport-anchored INSIDE the fixed wrapper but OUTSIDE
  // the scroller — the real Reddit button that repeated once per rail band.
  const collapseBtn = railWrap.appendChild(new El('div', doc, { clientH: 32, clientW: 32 }));
  collapseBtn.id = 'collapseBtn';
  collapseBtn.setAttribute('style', 'position:absolute');
  collapseBtn._rect = () => ({ left: 284, top: 300, width: 32, height: 32 });

  rail.scrollTop = 500;    // user had scrolled the rail
  win.scrollY = 300;       // and the page

  const cardRow = cr => {
    if (cr < 40) return CARD.header;
    if (cr < 80) return null;          // title row: striped, drawn separately
    if (cr < 700) return CARD.media;   // flat — every row horizontally uniform
    if (cr < CARD_H) return null;      // votes row: striped
    return WHITE;                      // inter-card gap
  };

  function render() {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < FEED_TOP) { fillRect(img, 0, vy, VP_W, 1, [230, 230, 235]); continue; }
      const fr = row - FEED_TOP;
      if (fr >= NCARDS * PITCH) continue;
      const cr = fr % PITCH;
      const ci = Math.floor(fr / PITCH);
      if (ci === EYEBROW_CARD) {
        // eyebrow bar, small gap, then the card shifted 44px down
        let col2 = null, ink2 = null;
        if (cr < EB_H) col2 = EB_COL;
        else if (cr < EB_H + EB_GAP) col2 = WHITE;
        else {
          const c2 = cr - (EB_H + EB_GAP);
          if (c2 < 40) col2 = CARD.header;
          else if (c2 < 80) ink2 = CARD.title;
          else if (c2 < 656) col2 = CARD.media;   // gallery imgs, same shade
          else if (c2 < 696) ink2 = CARD.votes;
          else col2 = WHITE;
        }
        if (ink2) {
          for (let bx = 404; bx < 1240; bx += 128) fillRect(img, bx, vy, 64, 1, ink2);
        } else if (col2 !== WHITE) {
          fillRect(img, 340, vy, 900, 1, col2);
        }
        continue;
      }
      const col = cardRow(cr);
      if (col === null) {
        // striped "text" rows — never horizontally uniform
        const ink = cr < 80 ? CARD.title : CARD.votes;
        for (let bx = 404; bx < 1240; bx += 128) fillRect(img, bx, vy, 64, 1, ink);
      } else if (col !== WHITE) {
        fillRect(img, 340, vy, 900, 1, col);
      }
    }
    // fixed rail overlay (viewport-anchored), honors hide/unhide state
    if (!hiddenNow(rail)) {
      for (let vy = 80; vy < 720; vy++) {
        const nr = rail.scrollTop + (vy - 80);
        if (nr < 2200) fillRect(img, 0, vy, 300, 1, nr >= 2160 ? C.navSentinel : navBand(Math.floor(nr / 40)));
      }
    }
    // collapse toggle rides the viewport, honors its own + inherited hiding
    if (!hiddenNow(collapseBtn)) {
      fillRect(img, 284, 300, 32, 32, BTN_COL);
    }
    return img;
  }
  return { name: 'redditlike', doc, html, body, win, render, dpr, bannerH: 0, refs: { rail } };
}

/* ================= capture driver ================= */

function styleSnapshot(scn) {
  const m = new Map();
  (function walk(el) {
    m.set(el, el.getAttribute('style'));
    if (el._shadow) for (const c of el._shadow.children) walk(c);
    for (const c of el.children) walk(c);
  })(scn.html);
  return m;
}

async function runCapture(scn, settings) {
  const state = { done: false, error: null, meta: null, frames: [] };
  const bg = {
    async handle(msg) {
      switch (msg.type) {
        case 'FS_FRAME':
          state.frames.push({ index: msg.index, x: msg.x, y: msg.y,
                              pane: msg.pane == null ? null : msg.pane,
                              inline: msg.inline == null ? null : msg.inline, img: scn.render() });
          return { ok: true };
        case 'FS_DONE': state.meta = msg.meta; state.done = true; return { ok: true };
        case 'FS_ERROR': state.error = msg.error; state.done = true; return { ok: true };
        case 'FS_EXPAND_FRAMES': case 'FS_RESTORE_FRAMES': return { ok: true };
        default: return { ok: false, error: 'unknown ' + msg.type };
      }
    }
  };
  const listeners = [];
  const ctx = vm.createContext({
    window: scn.win, document: scn.doc,
    chrome: {
      runtime: {
        onMessage: { addListener: fn => listeners.push(fn) },
        sendMessage: msg => bg.handle(msg)
      }
    },
    getComputedStyle: gcs,
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 8),
    console
  });
  vm.runInContext(CAPTURE_SRC, ctx, { filename: 'capture.js' });
  for (const fn of listeners) fn({ type: 'FS_START', settings }, {}, () => {});

  const deadline = Date.now() + 30000;
  while (!state.done && Date.now() < deadline) await sleep(20);
  if (!state.done) state.error = 'capture timed out';
  await sleep(300); // settle restore
  return state;
}

/* ================= grading ================= */

let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}

async function runScenario(name, scn, expected, opts) {
  if (process.env.FS_ONLY && !process.env.FS_ONLY.split(',').includes(name)) return null;  // dev: run a subset (suite outgrew a single CI call)
  opts = opts || {};
  const wantSegs = opts.segments || 1;
  console.log('\n=== ' + name + ' ===');
  const pre = styleSnapshot(scn);
  const preScroll = {
    pane: scn.refs.pane ? scn.refs.pane.scrollTop : null,
    sidebar: scn.refs.sidebar ? scn.refs.sidebar.scrollTop : null,
    innerPanel: scn.refs.innerPanel ? scn.refs.innerPanel.scrollTop : null,
    nav: scn.refs.nav ? scn.refs.nav.scrollTop : null,
    winY: scn.win.scrollY,
    winX: scn.win.scrollX
  };

  const state = await runCapture(scn, Object.assign({
    captureDelay: 5, hideFixed: true, preScroll: false,
    maxPageHeight: 50000, expandInner: true, expandFrames: false, adaptiveWait: true
  }, opts.settings || {}));
  check('capture completed without error', !state.error, state.error);
  if (state.error) return null;

  /* The settings the STITCHER sees. They are the capture's own settings in the
     browser (background.js snapshots getSettings() into the captures row), so a
     scenario that turns redactPII on for the engine must hand the same flag to
     result.js — otherwise the sim would grade the bake against a page the
     record says was never asked to be redacted. */
  const cap = { id: 'sim', mode: 'full', meta: state.meta,
                settings: Object.assign({ imageFormat: 'png' }, opts.settings || {}) };
  let seg, segs, out = null;
  try {
    const res = await stitchWithRealResultJs(cap, state.frames);
    out = res;
    check('stitch produced exactly ' + wantSegs + ' segment' + (wantSegs > 1 ? 's' : ''),
      res.segments.length === wantSegs, res.segments.length + ' segments');
    segs = res.segments.map(s => ({ w: s.w, h: s.h, data: s.data }));
    seg = segs[0];
  } catch (e) {
    check('REAL result.js stitched the frames', false, String(e && e.message || e));
    return null;
  }
  segs.forEach((s, i) => {
    const fn = name + (segs.length > 1 ? '-part' + (i + 1) : '') + '.png';
    fs.writeFileSync(path.join(OUT_DIR, fn), encodePng(s.w, s.h, s.data));
    console.log('      → wrote test/pixel-sim/out/' + fn + '  (' + s.w + '×' + s.h + ', ' + state.frames.length + ' frames)');
  });

  /* The 4th argument is the SHOT RECORD and everything result.js said while
     producing it. Pixels are only half of what this page has to get right: the
     record is what the AI hand-off, the history row and any future consumer
     read, and a claim in it is believed exactly as far as a picture is. */
  expected(seg, state, segs, out);

  /* restore integrity */
  const post = styleSnapshot(scn);
  let diffs = 0, firstDiff = '';
  for (const [el, v] of pre) {
    if (post.get(el) !== v) { diffs++; if (!firstDiff) firstDiff = (el.id || el.tagName) + ': "' + v + '" → "' + post.get(el) + '"'; }
  }
  check('every style attribute byte-identical after restore', diffs === 0, firstDiff);
  const tol = 0.65;
  if (scn.refs.pane) check('pane scroll restored', Math.abs(scn.refs.pane.scrollTop - preScroll.pane) <= tol, preScroll.pane + ' → ' + scn.refs.pane.scrollTop);
  if (scn.refs.sidebar) check('sidebar scroll restored (unrolled rail)', Math.abs(scn.refs.sidebar.scrollTop - preScroll.sidebar) <= tol, preScroll.sidebar + ' → ' + scn.refs.sidebar.scrollTop);
  if (scn.refs.innerPanel) check('inner panel scroll restored (expanded panel, ±0.6 dpr tolerance)', Math.abs(scn.refs.innerPanel.scrollTop - preScroll.innerPanel) <= tol, preScroll.innerPanel + ' → ' + scn.refs.innerPanel.scrollTop);
  if (scn.refs.nav) check('nav scroll restored', Math.abs(scn.refs.nav.scrollTop - preScroll.nav) <= tol, preScroll.nav + ' → ' + scn.refs.nav.scrollTop);
  check('window scroll restored', Math.abs(scn.win.scrollY - preScroll.winY) <= tol, preScroll.winY + ' → ' + scn.win.scrollY);
  check('window horizontal scroll restored', Math.abs(scn.win.scrollX - preScroll.winX) <= tol, preScroll.winX + ' → ' + scn.win.scrollX);
  return seg;
}

/* ================= expected-pixel definitions ================= */

function expectAppShell(seg, state, { bannerH, dpr }) {
  const S = v => Math.round(v * dpr);
  const paneVisH = Math.min(632, VP_H - (bannerH + 64));
  const totalH = 4200 - (632 - paneVisH);           // reachable content
  const chromeBottom = Math.max(0, VP_H - (bannerH + 64) - paneVisH);
  const expW = S(VP_W);
  const expH = S(bannerH + 64) + S(totalH) + S(chromeBottom);

  check('rootRect present in meta (inner pane capture)', !!state.meta.rootRect,
    JSON.stringify(state.meta.rootRect));
  check('canvas ' + expW + '×~' + expH, seg.w === expW && Math.abs(seg.h - expH) <= 3, seg.w + '×' + seg.h);

  const top = S(bannerH + 64);                       // pane slot top in canvas
  const x = S(700);                                  // inside the pane
  if (bannerH > 0) {
    check('banner appears exactly once (~' + S(bannerH) + ' rows)',
      Math.abs(countRowsWithColor(seg, S(600), 0, seg.h, C.banner) - S(bannerH)) <= 3,
      countRowsWithColor(seg, S(600), 0, seg.h, C.banner) + ' rows');
  }
  check('header band at top', near(pxAt(seg, S(600), S(bannerH + 32)), C.header));
  check('header appears exactly once (~' + S(64) + ' rows)',
    Math.abs(countRowsWithColor(seg, S(600), 0, seg.h, C.header) - S(64)) <= 3,
    countRowsWithColor(seg, S(600), 0, seg.h, C.header) + ' rows');

  // sticky in-pane toolbar: once at the pane top, neutralized afterwards
  const redRows = countRowsWithColor(seg, x, 0, seg.h, C.toolbar);
  check('sticky toolbar appears exactly once (~' + S(48) + ' rows)', Math.abs(redRows - S(48)) <= 3, redRows + ' rows');

  check('stripe A band 5 at expected offset', near(pxAt(seg, x, top + S(48 + 550)), stripeA(5)),
    pxAt(seg, x, top + S(48 + 550)).join(','));
  check('inner panel expanded: orange band 0 present', near(pxAt(seg, x, top + S(48 + 1200 + 50)), panelBand(0)),
    pxAt(seg, x, top + S(48 + 1200 + 50)).join(','));
  const greenRows = countRowsWithColor(seg, x, 0, seg.h, C.green);
  check('inner panel DEEP MARKER (green) fully present (~' + S(100) + ' rows)', Math.abs(greenRows - S(100)) <= 3, greenRows + ' rows');
  const blueRows = countRowsWithColor(seg, x, 0, seg.h, C.blue);
  const expBlue = S(Math.max(0, totalH - (48 + 1200 + 800 + 2000)));
  check('pane BOTTOM MARKER (blue) present (~' + expBlue + ' rows)', Math.abs(blueRows - expBlue) <= 3, blueRows + ' rows');

  // FAB: exactly once, inside the first pane view
  const fabRows = countRowsWithColor(seg, S(VP_W - 26 - 32), 0, seg.h, C.fab);
  check('fixed FAB appears exactly once (~' + S(64) + ' rows)', Math.abs(fabRows - S(64)) <= 3, fabRows + ' rows');

  // sidebar rail (v1.4.0): unrolled from its top into its column — content
  // that used to hide behind the rail's inner fold is in the shot, and the
  // old blank void below the pinned rail is gone.
  const sTop = top;
  const railEnd = 1400 - (632 - paneVisH);   // rows that can pass the visible band
  check('side pass ran (meta.sidePanes present)',
    !!(state.meta.sidePanes && state.meta.sidePanes.length === 1 &&
       state.meta.sidePanes[0].x === 0 && state.meta.sidePanes[0].w === 220),
    JSON.stringify(state.meta.sidePanes));
  check('sidebar unrolled from its top (band 2 at row 100)',
    near(pxAt(seg, S(110), sTop + S(100)), sideBand(2)),
    pxAt(seg, S(110), sTop + S(100)).join(','));
  check('sidebar content continues below the first view (row ' + (paneVisH + 400) + ')',
    near(pxAt(seg, S(110), sTop + S(paneVisH + 400)), sideBand(Math.floor((paneVisH + 400) / 40))),
    pxAt(seg, S(110), sTop + S(paneVisH + 400)).join(','));
  check('sidebar deep content present (row 1300)',
    near(pxAt(seg, S(110), sTop + S(1300)), sideBand(Math.floor(1300 / 40))),
    pxAt(seg, S(110), sTop + S(1300)).join(','));
  const sideWhite = countRowsWithColor(seg, S(110), sTop, sTop + S(railEnd) - 2, WHITE, 4);
  check('no white seam rows in the unrolled rail', sideWhite <= 1, sideWhite + ' white rows');
  check('rail column blank below its content end', near(pxAt(seg, S(110), sTop + S(railEnd + 40)), WHITE),
    pxAt(seg, S(110), sTop + S(railEnd + 40)).join(','));

  if (chromeBottom > 0) {
    check('footer moved below the unrolled pane', near(pxAt(seg, S(600), seg.h - S(12)), C.footer),
      pxAt(seg, S(600), seg.h - S(12)).join(','));
    check('footer appears exactly once (~' + S(24) + ' rows)',
      Math.abs(countRowsWithColor(seg, S(600), 0, seg.h, C.footer) - S(24)) <= 3,
      countRowsWithColor(seg, S(600), 0, seg.h, C.footer) + ' rows');
  } else {
    check('cut-off footer correctly absent', countRowsWithColor(seg, S(600), 0, seg.h, C.footer) === 0,
      countRowsWithColor(seg, S(600), 0, seg.h, C.footer) + ' rows');
  }

  // seam check: not a single unpainted row through the whole pane column
  const whiteRows = countRowsWithColor(seg, x, top, top + S(totalH), WHITE, 4);
  check('no white seam rows anywhere in the pane', whiteRows === 0, whiteRows + ' white rows');
}

function expectDocScroll(seg, state) {
  const totalH = 3500; // 500 + 800 + 48 + 2000 + 152
  check('rootRect NOT set (document capture)', !state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  check('canvas 1280×' + totalH, seg.w === 1280 && seg.h === totalH, seg.w + '×' + seg.h);
  const x = 700;
  check('stripe A present', near(pxAt(seg, x, 250), stripeA(2)), pxAt(seg, x, 250).join(','));
  const greenRows = countRowsWithColor(seg, x, 0, seg.h, C.green);
  check('inner panel DEEP MARKER (green) fully present (~100 rows)', Math.abs(greenRows - 100) <= 3, greenRows + ' rows');
  // The classic blank-band trap: a mid-page sticky section header must appear
  // exactly once, at its natural flow slot — not blanked, not repeated at
  // the top of every frame.
  const redRows = countRowsWithColor(seg, x, 0, seg.h, C.toolbar);
  check('mid-page sticky header appears exactly once (~48 rows, no blank band)', Math.abs(redRows - 48) <= 3, redRows + ' rows');
  check('sticky header sits at its flow slot (y≈1300)', near(pxAt(seg, x, 1324), C.toolbar), pxAt(seg, x, 1324).join(','));
  const blueRows = countRowsWithColor(seg, x, 0, seg.h, C.blue);
  check('page BOTTOM MARKER (blue) present (~152 rows)', Math.abs(blueRows - 152) <= 3, blueRows + ' rows');
  const sentinelRows = countRowsWithColor(seg, 140, 0, seg.h, C.navSentinel);
  check('expanded nav bottom sentinel appears exactly once (~48 rows)', Math.abs(sentinelRows - 48) <= 3, sentinelRows + ' rows');
  const fabRows = countRowsWithColor(seg, VP_W - 26 - 32, 0, seg.h, C.fab);
  check('fixed FAB appears exactly once (~64 rows)', Math.abs(fabRows - 64) <= 3, fabRows + ' rows');
  const whiteMain = countRowsWithColor(seg, x, 0, totalH, WHITE, 4);
  check('no white seam rows in the main column', whiteMain === 0, whiteMain + ' white rows');
}

function expectMultipart(seg, state, segs) {
  const INK = [40, 40, 60];
  check('two parts, heights sum to 20000', segs.length === 2 && segs[0].h + segs[1].h === 20000,
    segs.map(s => s.h).join(' + '));
  const h1 = segs[0].h;
  check('part 1 boundary cut at the MIDDLE of a quiet gap (h % 28 === 3, not a raw 16000 cut)',
    h1 % 28 === 3 && h1 < 16000 && h1 >= 15400, 'part 1 h=' + h1);
  check('last row of part 1 is a gap row (white)', near(pxAt(segs[0], 100, h1 - 1), WHITE),
    pxAt(segs[0], 100, h1 - 1).join(','));
  check('part 2 opens with gap padding (white), text line intact below',
    near(pxAt(segs[1], 96, 0), WHITE) && near(pxAt(segs[1], 96, 3), INK),
    pxAt(segs[1], 96, 0).join(',') + ' / ' + pxAt(segs[1], 96, 3).join(','));
  const lineRows = countRowsWithColor(segs[1], 96, 3, 25, INK, 8);
  check('first text line of part 2 fully intact (22 rows)', lineRows === 22, lineRows + ' rows');
  const whiteMid = countRowsWithColor(segs[0], 96, 6, 28, INK, 8);
  check('line rhythm sane in part 1 (22 ink rows in first line)', whiteMid === 22, whiteMid + ' ink rows');
}

function expectDocWide(seg, state) {
  check('rootRect NOT set (document capture)', !state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  check('canvas 2680×2500 (wide table merged right)', seg.w === 2680 && seg.h === 2500, seg.w + '×' + seg.h);
  check('table band 0 at its left edge (unrolled from col 0)', near(pxAt(seg, 285, 950), wideBand(0)),
    pxAt(seg, 285, 950).join(','));
  check('table mid columns present (band 7 at content col 1500)', near(pxAt(seg, 280 + 1500, 950), wideBand(7)),
    pxAt(seg, 280 + 1500, 950).join(','));
  check('table RIGHT SENTINEL (green) present — full width captured', near(pxAt(seg, 280 + 2300, 950), C.green),
    pxAt(seg, 280 + 2300, 950).join(','));
  let whiteCols = 0;
  for (let x = 280; x < 280 + 2400; x++) if (near(pxAt(seg, x, 950), WHITE, 4)) whiteCols++;
  check('no white seam columns across the merged table', whiteCols === 0, whiteCols + ' white cols');
  check('stripe A above the table intact', near(pxAt(seg, 700, 250), stripeA(2)), pxAt(seg, 700, 250).join(','));
  check('area right of normal-width content stays white', near(pxAt(seg, 2000, 250), WHITE),
    pxAt(seg, 2000, 250).join(','));
  check('page BOTTOM MARKER (blue) present', near(pxAt(seg, 700, 2400), C.blue), pxAt(seg, 700, 2400).join(','));
}

function expectRedditLike(seg, state, segs) {
  check('two parts, heights sum to 18344', segs.length === 2 && segs[0].h + segs[1].h === 18344,
    segs.map(s => s.h).join(' + '));
  check('break hints reported in meta (~24)', !!(state.meta.breakHints && state.meta.breakHints.length >= 20),
    (state.meta.breakHints || []).length + ' hints');
  check('part boundary lands on the card GROUP top (15304) — eyebrow + divider carried over, ' +
        'gallery-image hint traps ignored (v1.5.1)',
    segs[0].h === 15304, 'part 1 h=' + segs[0].h);
  check('last row of part 1 is the previous card\'s vote row — nothing of the next post orphaned',
    near(pxAt(segs[0], 430, segs[0].h - 1), CARD.votes), pxAt(segs[0], 430, segs[0].h - 1).join(','));
  check('part 2 opens with the divider gap (white)', near(pxAt(segs[1], 400, 8), WHITE),
    pxAt(segs[1], 400, 8).join(','));
  check('part 2 carries the context bar ("Because you\'ve visited…" eyebrow)',
    near(pxAt(segs[1], 400, 30), EB_COL), pxAt(segs[1], 400, 30).join(','));
  check('card header right below its eyebrow in part 2', near(pxAt(segs[1], 400, 80), CARD.header),
    pxAt(segs[1], 400, 80).join(','));
  check('card title intact in part 2', near(pxAt(segs[1], 430, 120), CARD.title),
    pxAt(segs[1], 430, 120).join(','));
  check('card gallery intact in part 2 (not split at an inner image)',
    near(pxAt(segs[1], 400, 300), CARD.media), pxAt(segs[1], 400, 300).join(','));
  // fixed left rail: hidden during the grid, un-hidden and unrolled by its pass
  check('side pass ran on a DOC capture (fixed rail found)',
    !!(state.meta.sidePanes && state.meta.sidePanes.length === 1 &&
       state.meta.sidePanes[0].x === 0 && state.meta.sidePanes[0].y === 80),
    JSON.stringify(state.meta.sidePanes));
  check('rail unrolled from its top (band 2 at row 100)', near(pxAt(seg, 150, 80 + 100), navBand(2)),
    pxAt(seg, 150, 80 + 100).join(','));
  check('rail deep content present (row 1500)', near(pxAt(seg, 150, 80 + 1500), navBand(37)),
    pxAt(seg, 150, 80 + 1500).join(','));
  const sentinelRows = countRowsWithColor(seg, 150, 0, 3000, C.navSentinel);
  check('rail BOTTOM SENTINEL fully present (~40 rows) — the "remaining values"', Math.abs(sentinelRows - 40) <= 3,
    sentinelRows + ' rows');
  const railWhite = countRowsWithColor(seg, 150, 80, 80 + 2200 - 2, WHITE, 4);
  check('no white seam rows in the unrolled rail', railWhite <= 1, railWhite + ' white rows');
  check('rail column blank below its content end', near(pxAt(seg, 150, 2350), WHITE),
    pxAt(seg, 150, 2350).join(','));
  check('feed intact beside the rail (media row)', near(pxAt(seg, 400, 300), CARD.media),
    pxAt(seg, 400, 300).join(','));
  // v1.5.1: the collapse toggle (viewport-anchored in the fixed wrapper,
  // outside the scroller) must appear exactly ONCE, not once per rail band.
  const btnInner = countRowsWithColor(seg, 290, 0, 3000, BTN_COL);
  check('rail collapse button appears exactly once in the rail column (~32 rows)',
    Math.abs(btnInner - 32) <= 2, btnInner + ' rows');
  const btnOuter = countRowsWithColor(seg, 308, 0, 3000, BTN_COL);
  check('collapse button outer half appears exactly once beside the rail',
    Math.abs(btnOuter - 32) <= 2, btnOuter + ' rows');
}

/* ================= scenario: virtualized (render-window) list ================= */
/* An embedded react-window / TanStack-style virtualized list on a document-
   scrolling page. The list's outer box is a fixed 600px viewport (overflow
   auto) over a 6000px "sizer" spacer, but only a ~600px WINDOW of rows is ever
   realized in the DOM (a handful of position:absolute rows the app recycles as
   it scrolls — react-window renders for its fixed viewport height, NOT the
   element's CSS height). The OLD engine expands the panel to its scrollHeight
   (6000) and pins scrollTop=0 — but the app still realizes only the top window,
   so the panel balloons the page by ~5400px and leaves a blank spacer band,
   shoving the whole article that follows it miles down (and past the canvas
   split). The FIX: detect the render-window scroller and never expand it — the
   list is captured as-rendered (its current window) inline, page stays compact. */

const VL = {
  header: [70, 90, 170],
  row: i => (i % 2 ? [90, 160, 210] : [60, 130, 190]),
  sizerBg: [232, 236, 244],
  article: i => [200 - (i % 5) * 8, 120, 60 + (i % 5) * 8],
  deep: C.green, bottom: C.blue
};
const VL_HEADER = 120, VL_VIEW = 600, VL_OVER = 60, VL_TOTAL = 6000;
const VL_ARTICLE = 3000, VL_BOTTOM = 152, VL_DEEP_OFF = 1500, VL_ROWH = 40;

function buildVirtualList() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: VL_HEADER, clientW: VP_W })); // page header

  // The virtualized list: fixed 600px viewport (overflow auto) over a tall,
  // (near) empty sizer spacer; only a small set of absolutely-positioned rows
  // is realized — the render-window signature the engine must detect.
  const vlist = body.appendChild(new El('div', doc, { clientH: VL_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:600px');
  const sizer = vlist.appendChild(new El('div', doc, { clientH: VL_TOTAL, clientW: VP_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');   // total-size spacer (height from base = VL_TOTAL)
  const REALIZED = Math.ceil((VL_VIEW + 2 * VL_OVER) / VL_ROWH);     // window rows kept in DOM
  const vrows = [];
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: VL_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');                   // recycled, translated row
    vrows.push(r);
  }

  const article = body.appendChild(new El('div', doc, { clientH: VL_ARTICLE, clientW: VP_W }));
  const bottom = body.appendChild(new El('div', doc, { clientH: VL_BOTTOM, clientW: VP_W }));

  body._base.contentH = () => VL_HEADER + vlist.clientHeight + VL_ARTICLE + VL_BOTTOM;
  html._base.contentH = () => body.clientHeight;

  vlist.scrollTop = 1200;   // user had scrolled the list a bit
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - VL_OVER &&
                         cr < vlist.scrollTop + VL_VIEW + VL_OVER &&
                         cr >= 0 && cr < VL_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const boxH = vlist.clientHeight;            // 600 normally, 6000 if wrongly grown
    const artTop = VL_HEADER + boxH;
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 0) continue;
      if (row < VL_HEADER) { fillRect(img, 0, vy, VP_W, 1, VL.header); continue; }
      if (row < artTop) {                        // inside the virtualized list box
        const cr = vlist.scrollTop + (row - VL_HEADER);
        fillRect(img, 0, vy, VP_W, 1, VL.sizerBg);           // the spacer background
        if (realized(cr)) fillRect(img, 0, vy, VP_W, 1, VL.row(Math.floor(cr / VL_ROWH)));
        continue;
      }
      const ar = row - artTop;
      if (ar < VL_ARTICLE) {
        if (ar >= VL_DEEP_OFF && ar < VL_DEEP_OFF + 100) fillRect(img, 0, vy, VP_W, 1, VL.deep);
        else fillRect(img, 0, vy, VP_W, 1, VL.article(Math.floor(ar / 100)));
      } else if (ar < VL_ARTICLE + VL_BOTTOM) {
        fillRect(img, 0, vy, VP_W, 1, VL.bottom);
      }
    }
    return img;
  }
  return { name: 'virtuallist', doc, html, body, win, render, dpr, bannerH: 0, refs: { vlist } };
}

function expectVirtualList(seg, state, segs) {
  const EXP_H = VL_HEADER + VL_VIEW + VL_ARTICLE + VL_BOTTOM;   // 120+600+3000+152 = 3872
  const x = 640;
  check('render-window scroller detected (meta.virtualScrollers >= 1)',
    (state.meta.virtualScrollers || 0) >= 1, (state.meta.virtualScrollers || 0) + ' detected');
  check('page NOT ballooned by the virtualized panel — single ' + EXP_H + 'px part',
    segs.length === 1 && seg.h === EXP_H, segs.map(s => s.h).join('+'));
  check('virtual list window captured as-rendered (row band at its slot, not blank spacer)',
    !near(pxAt(seg, x, VL_HEADER + 60), VL.sizerBg, 4), pxAt(seg, x, VL_HEADER + 60).join(','));
  const ai = Math.floor((3000 - (VL_HEADER + VL_VIEW)) / 100);
  check('no ballooned spacer band — the article that follows is present at y3000 (not blank)',
    near(pxAt(seg, x, 3000), VL.article(ai), 10), pxAt(seg, x, 3000).join(','));
  check('article DEEP MARKER present at its compact position (y' + (VL_HEADER + VL_VIEW + VL_DEEP_OFF + 20) + ')',
    near(pxAt(seg, x, VL_HEADER + VL_VIEW + VL_DEEP_OFF + 20), VL.deep),
    pxAt(seg, x, VL_HEADER + VL_VIEW + VL_DEEP_OFF + 20).join(','));
  const blueRows = countRowsWithColor(seg, x, 0, seg.h, VL.bottom);
  check('page BOTTOM MARKER present (~' + VL_BOTTOM + ' rows)', Math.abs(blueRows - VL_BOTTOM) <= 3, blueRows + ' rows');
  const sizerRows = countRowsWithColor(seg, x, VL_HEADER + VL_VIEW + 40, seg.h, VL.sizerBg, 4);
  check('no render-window spacer band left anywhere below the list', sizerRows === 0, sizerRows + ' spacer rows');
}

/* ========== scenario: embedded virtualized list, INLINE UNROLL (v1.6.1) ========== */
/* Same render-window signature as `virtuallist`, but with the opt-in
   `unrollVirtual` setting ON. v1.6.0 captured an embedded render-window list
   as-rendered (its current ~600px window only) — its deep content never made
   the shot. v1.6.1 steps the panel through its full 6000px of content and the
   stitcher grows the page at the panel's slot (mid-page vertical injection),
   pushing the article below it downward. This scenario asserts the DEEP list
   content (mid rows + a bottom sentinel) is present inline and the following
   article is shoved down by exactly the growth — the gate the OLD engine fails. */

const VU = {
  header: [40, 60, 150],
  row: i => (i % 2 ? [120, 180, 230] : [80, 150, 200]),
  sizerBg: [235, 238, 245],
  deep: [255, 120, 0],                 // bottom sentinel — "the remaining rows"
  article: i => [190 - (i % 5) * 8, 110, 70 + (i % 5) * 8],
  bottom: [0, 180, 120]
};
const VU_HEADER = 120, VU_VIEW = 600, VU_OVER = 60, VU_TOTAL = 6000;
const VU_ARTICLE = 4000, VU_BOTTOM = 152, VU_ROWH = 40;
const VU_DEEP_FROM = VU_TOTAL - 200;    // 5800..6000 = the deep sentinel band

function buildVirtualUnroll() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: VU_HEADER, clientW: VP_W })); // page header

  const vlist = body.appendChild(new El('div', doc, { clientH: VU_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:600px');
  // real viewport rect (tracks page scroll) so the engine can locate the slot
  vlist._rect = () => ({ left: 0, top: VU_HEADER - win.scrollY, width: VP_W, height: VU_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: VU_TOTAL, clientW: VP_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((VU_VIEW + 2 * VU_OVER) / VU_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: VU_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');
  }

  const article = body.appendChild(new El('div', doc, { clientH: VU_ARTICLE, clientW: VP_W }));
  const bottom = body.appendChild(new El('div', doc, { clientH: VU_BOTTOM, clientW: VP_W }));

  body._base.contentH = () => VU_HEADER + vlist.clientHeight + VU_ARTICLE + VU_BOTTOM;
  html._base.contentH = () => body.clientHeight;

  vlist.scrollTop = 1200;   // user had scrolled the list to the middle
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - VU_OVER &&
                         cr < vlist.scrollTop + VU_VIEW + VU_OVER &&
                         cr >= 0 && cr < VU_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const boxH = vlist.clientHeight;              // 600 unless (wrongly) grown
    const artTop = VU_HEADER + boxH;
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 0) continue;
      if (row < VU_HEADER) { fillRect(img, 0, vy, VP_W, 1, VU.header); continue; }
      if (row < artTop) {                          // inside the virtualized list box
        const cr = vlist.scrollTop + (row - VU_HEADER);
        fillRect(img, 0, vy, VP_W, 1, VU.sizerBg);
        if (realized(cr)) {
          const col = cr >= VU_DEEP_FROM ? VU.deep : VU.row(Math.floor(cr / VU_ROWH));
          fillRect(img, 0, vy, VP_W, 1, col);
        }
        continue;
      }
      const ar = row - artTop;
      if (ar < VU_ARTICLE) fillRect(img, 0, vy, VP_W, 1, VU.article(Math.floor(ar / 100)));
      else if (ar < VU_ARTICLE + VU_BOTTOM) fillRect(img, 0, vy, VP_W, 1, VU.bottom);
    }
    return img;
  }
  return { name: 'virtualunroll', doc, html, body, win, render, dpr, bannerH: 0, refs: { vlist } };
}

function expectVirtualUnroll(seg, state, segs) {
  const EXP_H = VU_HEADER + VU_TOTAL + VU_ARTICLE + VU_BOTTOM;   // 120+6000+800+152 = 7072
  const x = 640;
  const slot = VU_HEADER;                          // list slot top in the final canvas
  check('embedded virtual list flagged inline (meta.inlinePanes length 1, docY=' + VU_HEADER + ')',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1 &&
       state.meta.inlinePanes[0].docY === VU_HEADER),
    JSON.stringify(state.meta.inlinePanes));
  check('page grown at the panel slot — single ' + EXP_H + 'px part (list unrolled inline)',
    segs.length === 1 && seg.h === EXP_H, segs.map(s => s.h).join('+'));
  check('list TOP window present inline (row 0 at slot top)',
    near(pxAt(seg, x, slot + 20), VU.row(0)), pxAt(seg, x, slot + 20).join(','));
  check('list MID content present inline (cr 3000 — beyond the visible window)',
    near(pxAt(seg, x, slot + 3000), VU.row(Math.floor(3000 / VU_ROWH))),
    pxAt(seg, x, slot + 3000).join(','));
  const deepY = slot + VU_DEEP_FROM + 40;
  check('list DEEP SENTINEL present inline (cr ' + (VU_DEEP_FROM + 40) + ' — the remaining rows)',
    near(pxAt(seg, x, deepY), VU.deep), pxAt(seg, x, deepY).join(','));
  const artY = slot + VU_TOTAL + 400;              // 400px into the article, now shoved down
  check('article shoved down below the unrolled list (present at y' + artY + ')',
    near(pxAt(seg, x, artY), VU.article(4), 12), pxAt(seg, x, artY).join(','));
  const blueRows = countRowsWithColor(seg, x, 0, seg.h, VU.bottom);
  check('page BOTTOM MARKER present (~' + VU_BOTTOM + ' rows)', Math.abs(blueRows - VU_BOTTOM) <= 3, blueRows + ' rows');
  const sizerRows = countRowsWithColor(seg, x, slot, slot + VU_TOTAL, VU.sizerBg, 4);
  check('no render-window spacer band left in the unrolled list', sizerRows <= 2, sizerRows + ' spacer rows');
  const deepRows = countRowsWithColor(seg, x, 0, seg.h, VU.deep);
  check('deep sentinel appears exactly once (~200 rows)', Math.abs(deepRows - 200) <= 4, deepRows + ' rows');
}

/* ========== scenario: interaction-gated content (v1.6.2) ========== */
/* A document page whose content is hidden behind interaction: a collapsed
   <details>, an inactive tab panel (role=tabpanel, aria-hidden, display:none)
   and an accordion item ([hidden] + display:none). A normal capture misses all
   of it. With the opt-in `expandInteractive` setting on, an "expand everything"
   pass opens the <details>, reveals the gated panels, captures, then restores
   every attribute + style byte-identically. */

const IX = {
  header: [60, 70, 90],
  summary: [180, 140, 40],       // <details> summary — always visible
  body: [240, 190, 60],          // <details> body — revealed on open  (assert)
  tabActive: [70, 130, 90],
  tabInactive: [120, 220, 150],  // inactive tab panel — revealed        (assert)
  accordion: [200, 90, 150],     // [hidden] accordion — revealed        (assert)
  bottom: [0, 150, 200]
};

function buildInteractive() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const header = body.appendChild(new El('div', doc, { clientH: 120, clientW: VP_W }));
  const details = body.appendChild(new El('details', doc, { clientW: VP_W }));
  details.id = 'details';
  details._base.clientH = () => (details.getAttribute('open') != null ? 540 : 40);  // 40 summary + 500 body
  const tabActive = body.appendChild(new El('div', doc, { clientH: 300, clientW: VP_W }));
  const tabInactive = body.appendChild(new El('div', doc, { clientH: 400, clientW: VP_W }));
  tabInactive.id = 'tabInactive';
  tabInactive.setAttribute('role', 'tabpanel');
  tabInactive.setAttribute('aria-hidden', 'true');
  tabInactive.setAttribute('style', 'display:none');
  const accordion = body.appendChild(new El('div', doc, { clientH: 350, clientW: VP_W }));
  accordion.id = 'accordion';
  accordion.setAttribute('hidden', '');
  accordion.setAttribute('style', 'display:none');
  body.appendChild(new El('div', doc, { clientH: 152, clientW: VP_W }));   // bottom marker

  html._base.contentH = () => body.clientHeight;   // body sums its children live
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const L = []; let y = 0;
    const push = (h, c) => { if (h > 0) { L.push([y, y + h, c]); y += h; } };
    push(120, IX.header);
    const open = details.getAttribute('open') != null;
    push(40, IX.summary);
    if (open) push(500, IX.body);
    push(300, IX.tabActive);
    push(tabInactive.clientHeight, IX.tabInactive);   // 0 when display:none
    push(accordion.clientHeight, IX.accordion);       // 0 when display:none
    push(152, IX.bottom);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      for (const seg of L) { if (row >= seg[0] && row < seg[1]) { fillRect(img, 0, vy, VP_W, 1, seg[2]); break; } }
    }
    return img;
  }
  return { name: 'interactive', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { details, tabInactive, accordion } };
}

function expectInteractive(seg, state, segs) {
  const EXP_H = 120 + 540 + 300 + 400 + 350 + 152;   // 1862 (all revealed)
  const x = 640;
  check('single part, height ' + EXP_H + ' (all interaction-gated content revealed)',
    segs.length === 1 && seg.h === EXP_H, segs.map(s => s.h).join('+'));
  check('collapsed <details> BODY revealed inline (y410)',
    near(pxAt(seg, x, 410), IX.body), pxAt(seg, x, 410).join(','));
  check('inactive TAB PANEL revealed inline (y1160)',
    near(pxAt(seg, x, 1160), IX.tabInactive), pxAt(seg, x, 1160).join(','));
  check('[hidden] ACCORDION revealed inline (y1535)',
    near(pxAt(seg, x, 1535), IX.accordion), pxAt(seg, x, 1535).join(','));
  const bmRows = countRowsWithColor(seg, x, 0, seg.h, IX.bottom);
  check('page BOTTOM MARKER present (~152 rows)', Math.abs(bmRows - 152) <= 3, bmRows + ' rows');
  check('details summary still present exactly once (~40 rows)',
    Math.abs(countRowsWithColor(seg, x, 0, seg.h, IX.summary) - 40) <= 3,
    countRowsWithColor(seg, x, 0, seg.h, IX.summary) + ' rows');
}

/* ========== scenario: multi-carousel page — merged-right MISFIRE (v1.6.3) ========== */
/* An Amazon-style homepage: the document scrolls only vertically, but it has
   several independent horizontal carousels (overflow-x:auto, content far wider
   than the viewport) plus a sticky top nav. v1.4.0 "merged right" widens EVERY
   sideways scroller, so widening the carousels balloons the whole page sideways
   into a huge horizontal grid — repeated nav furniture, misplaced columns. The
   fix: only merge-right a SINGLE dominant sideways scroller; a wall of carousels
   is captured as-seen (page width unchanged). */

const MC = { nav: [255, 51, 51], blockA: [200, 200, 210], blockB: [180, 180, 190],
             c1: [230, 140, 40], c2: [40, 180, 160], c3: [150, 80, 200],
             deep: [0, 255, 136], bottom: [0, 136, 255] };

function buildMultiCarousel() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const nav = body.appendChild(new El('div', doc, { clientH: 60, clientW: VP_W }));
  nav.id = 'nav';
  nav.setAttribute('style', 'position:sticky;top:0');

  const main = body.appendChild(new El('main', doc, { clientW: VP_W }));
  main.appendChild(new El('div', doc, { clientH: 400, clientW: VP_W }));                      // blockA
  const c1 = main.appendChild(new El('div', doc, { clientH: 220, clientW: VP_W, contentW: 4000, contentH: 220 }));
  const c2 = main.appendChild(new El('div', doc, { clientH: 220, clientW: VP_W, contentW: 3500, contentH: 220 }));
  const c3 = main.appendChild(new El('div', doc, { clientH: 220, clientW: VP_W, contentW: 3000, contentH: 220 }));
  [c1, c2, c3].forEach((c, i) => { c.id = 'carousel' + (i + 1); c.setAttribute('style', 'overflow-x:auto'); });
  main.appendChild(new El('div', doc, { clientH: 1500, clientW: VP_W }));                     // blockB (deep marker inside)
  main.appendChild(new El('div', doc, { clientH: 152, clientW: VP_W }));                      // bottom

  main._base.clientH = () => 400 + c1.clientHeight + c2.clientHeight + c3.clientHeight + 1500 + 152;
  main._base.contentH = main._base.clientH;
  main._base.contentW = () => Math.max(VP_W, c1.clientWidth, c2.clientWidth, c3.clientWidth);

  body._base.contentH = () => nav.clientHeight + main.clientHeight;
  body._base.contentW = () => Math.max(VP_W, main.scrollWidth);
  html._base.contentH = () => body.clientHeight;
  html._base.contentW = () => Math.max(VP_W, body.scrollWidth);

  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const navStatic = gcs(nav).position === 'static';
    for (let vy = 0; vy < VP_H; vy++) {
      const pageY = win.scrollY + vy;
      if (pageY < 60) {                                   // nav slot
        if (!hiddenNow(nav) && navStatic) fillRect(img, 0, vy, VP_W, 1, MC.nav);
        continue;
      }
      let m = pageY - 60;
      if (m < 400) { fillRect(img, 0, vy, VP_W, 1, MC.blockA); continue; } m -= 400;
      if (m < 220) { fillRect(img, 0, vy, VP_W, 1, MC.c1); continue; } m -= 220;
      if (m < 220) { fillRect(img, 0, vy, VP_W, 1, MC.c2); continue; } m -= 220;
      if (m < 220) { fillRect(img, 0, vy, VP_W, 1, MC.c3); continue; } m -= 220;
      if (m < 1500) { fillRect(img, 0, vy, VP_W, 1, (m >= 700 && m < 800) ? MC.deep : MC.blockB); continue; } m -= 1500;
      if (m < 152) { fillRect(img, 0, vy, VP_W, 1, MC.bottom); continue; }
    }
    // a still-sticky (un-neutralized) nav would ride the viewport top in every frame
    if (!hiddenNow(nav) && !navStatic) fillRect(img, 0, 0, VP_W, 60, MC.nav);
    return img;
  }
  return { name: 'multicarousel', doc, html, body, win, render, dpr, bannerH: 0, refs: { c1, c2, c3 } };
}

function expectMultiCarousel(seg, state, segs) {
  const x = 640;
  check('page NOT ballooned sideways — totalW == viewport (carousels as-seen)',
    state.meta.totalW === VP_W, 'totalW=' + state.meta.totalW);
  check('single vertical canvas at viewport width', segs.length === 1 && seg.w === VP_W, seg.w + '×' + seg.h);
  const nav = countRowsWithColor(seg, x, 0, seg.h, MC.nav);
  check('sticky nav appears exactly once (~60 rows, no striping)', Math.abs(nav - 60) <= 3, nav + ' rows');
  check('carousel 1 present as-seen', near(pxAt(seg, x, 60 + 400 + 100), MC.c1), pxAt(seg, x, 60 + 400 + 100).join(','));
  check('carousel 2 present as-seen', near(pxAt(seg, x, 60 + 620 + 100), MC.c2), pxAt(seg, x, 60 + 620 + 100).join(','));
  check('carousel 3 present as-seen', near(pxAt(seg, x, 60 + 840 + 100), MC.c3), pxAt(seg, x, 60 + 840 + 100).join(','));
  const deep = countRowsWithColor(seg, x, 0, seg.h, MC.deep);
  check('deep marker in lower block present (~100 rows)', Math.abs(deep - 100) <= 4, deep + ' rows');
  const bottom = countRowsWithColor(seg, x, 0, seg.h, MC.bottom);
  check('bottom marker present (~152 rows)', Math.abs(bottom - 152) <= 4, bottom + ' rows');
}

/* ========== scenario: late-painting image — black-frame gate (v1.6.4) ========== */
/* A hero image that is not decoded yet when its frame is grabbed captures as
   BLACK (the lazy-image / skeleton-loader blank; a common cause of Amazon's
   black tiles). With adaptiveWait on, the engine decodes not-complete images in
   view before snapping, so the real pixels are captured. Modeled deterministically:
   the fake <img> is black until decode() flips it complete. */

const LI = { header: [40, 60, 150], black: [0, 0, 0], img: [0, 255, 136], block: [180, 180, 190], bottom: [0, 136, 255] };

function buildLateImage() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: 120, clientW: VP_W }));   // header
  const hero = body.appendChild(new El('img', doc, { clientH: 200, clientW: VP_W }));
  hero.id = 'hero';
  hero._loaded = false;
  Object.defineProperty(hero, 'complete', { get() { return hero._loaded; }, configurable: true });
  hero.decode = () => { hero._loaded = true; return Promise.resolve(); };
  body.appendChild(new El('div', doc, { clientH: 1500, clientW: VP_W }));  // block
  body.appendChild(new El('div', doc, { clientH: 152, clientW: VP_W }));   // bottom

  body._base.contentH = () => 120 + 200 + 1500 + 152;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 120) fillRect(img, 0, vy, VP_W, 1, LI.header);
      else if (row < 320) fillRect(img, 0, vy, VP_W, 1, hero._loaded ? LI.img : LI.black);   // black until decoded
      else if (row < 1820) fillRect(img, 0, vy, VP_W, 1, LI.block);
      else if (row < 1972) fillRect(img, 0, vy, VP_W, 1, LI.bottom);
    }
    return img;
  }
  return { name: 'lateimage', doc, html, body, win, render, dpr, bannerH: 0, refs: { hero } };
}

function expectLateImage(seg, state, segs) {
  const x = 640;
  check('hero image decoded before capture (not a black frame)',
    !near(pxAt(seg, x, 120 + 100), LI.black, 6), pxAt(seg, x, 120 + 100).join(','));
  const green = countRowsWithColor(seg, x, 0, seg.h, LI.img);
  check('decoded hero image present (~200 rows)', Math.abs(green - 200) <= 4, green + ' rows');
  const blackRows = countRowsWithColor(seg, x, 0, seg.h, LI.black, 6);
  check('no black band where the image is', blackRows <= 2, blackRows + ' black rows');
  const blue = countRowsWithColor(seg, x, 0, seg.h, LI.bottom);
  check('bottom marker present (~152 rows)', Math.abs(blue - 152) <= 4, blue + ' rows');
}

/* ========== scenario: lazy-growing footer — bottom truncation (v1.6.5) ========== */
/* A page whose bottom "mega-footer" only finishes rendering once scrolled near
   the bottom (Amazon's AbeBooks/AWS/… grid). The engine measures totalH before
   scrolling down, so it stops ~one footer-tail short of the true bottom. The fix
   jumps to the bottom once to trigger the lazy render, re-measures, and extends. */

const LF = { header: [40, 60, 150], block: [190, 190, 200], titles: [80, 80, 90],
             lazy: [0, 255, 136], copyright: [0, 136, 255] };
const LF_HEADER = 120, LF_BLOCK = 2000, LF_TITLES = 100, LF_LAZY = 260, LF_COPY = 40;
const LF_THRESHOLD = LF_HEADER + LF_BLOCK - 720;   // footer enters view near here

function buildLazyFooter() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });
  let footerExpanded = false;

  body.appendChild(new El('div', doc, { clientH: LF_HEADER, clientW: VP_W }));   // header
  body.appendChild(new El('div', doc, { clientH: LF_BLOCK, clientW: VP_W }));    // tall block
  const footer = body.appendChild(new El('div', doc, { clientW: VP_W }));
  footer.id = 'footer';
  footer._base.clientH = () => footerExpanded ? (LF_TITLES + LF_LAZY + LF_COPY) : LF_TITLES;

  body._base.contentH = () => LF_HEADER + LF_BLOCK + footer.clientHeight;
  html._base.contentH = () => body.clientHeight;

  // lazy trigger: scrolling near the bottom expands the footer (grows the page)
  const origScrollTo = win.scrollTo.bind(win);
  win.scrollTo = (x, y) => { if ((Number(y) || 0) >= LF_THRESHOLD) footerExpanded = true; origScrollTo(x, y); };
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const footTop = LF_HEADER + LF_BLOCK;
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < LF_HEADER) fillRect(img, 0, vy, VP_W, 1, LF.header);
      else if (row < footTop) fillRect(img, 0, vy, VP_W, 1, LF.block);
      else {
        const fr = row - footTop;
        if (fr < LF_TITLES) fillRect(img, 0, vy, VP_W, 1, LF.titles);            // always-visible titles
        else if (footerExpanded && fr < LF_TITLES + LF_LAZY) fillRect(img, 0, vy, VP_W, 1, LF.lazy);
        else if (footerExpanded && fr < LF_TITLES + LF_LAZY + LF_COPY) fillRect(img, 0, vy, VP_W, 1, LF.copyright);
      }
    }
    return img;
  }
  return { name: 'lazyfooter', doc, html, body, win, render, dpr, bannerH: 0, refs: { footer } };
}

function expectLazyFooter(seg, state, segs) {
  const x = 640;
  const fullH = LF_HEADER + LF_BLOCK + LF_TITLES + LF_LAZY + LF_COPY;   // 2520
  check('page height extended to the true bottom (lazy footer measured)',
    Math.abs(seg.h - fullH) <= 3, seg.h + ' (want ' + fullH + ')');
  check('footer titles present (always-visible top)',
    near(pxAt(seg, x, LF_HEADER + LF_BLOCK + 40), LF.titles), pxAt(seg, x, LF_HEADER + LF_BLOCK + 40).join(','));
  const lazy = countRowsWithColor(seg, x, 0, seg.h, LF.lazy);
  check('lazy footer tail captured (~' + LF_LAZY + ' rows) — not truncated', Math.abs(lazy - LF_LAZY) <= 4, lazy + ' rows');
  const copy = countRowsWithColor(seg, x, 0, seg.h, LF.copyright);
  check('copyright line at the very bottom present (~' + LF_COPY + ' rows)', Math.abs(copy - LF_COPY) <= 4, copy + ' rows');
}

/* ========== scenario: scroll-lock + consent/modal overlays (v1.6.6) ========== */
/* A page pinned by a modal (html{overflow:hidden}), with a fixed cookie-consent
   banner and a fixed role=dialog modal covering the viewport, over tall real
   content. Without the opt-in hide-distractions pass the capture is stuck on the
   top view (scroll locked) and the banner/modal are in the shot. With it, scroll
   is unlocked and the overlays are hidden — a clean full-page capture. */

const OV = { header: [40, 60, 150], content: [190, 190, 200], deep: [0, 255, 136],
             footer: [0, 136, 255], banner: [255, 140, 0], modal: [150, 80, 200], dialog: [230, 120, 180], news: [200, 180, 40], widget: [60, 180, 220] };

function buildOverlay() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  html.setAttribute('style', 'overflow:hidden');          // scroll-lock from the modal
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: 120, clientW: VP_W }));    // header
  body.appendChild(new El('div', doc, { clientH: 2000, clientW: VP_W }));   // content (deep marker inside)
  body.appendChild(new El('div', doc, { clientH: 152, clientW: VP_W }));    // footer
  body._base.contentH = () => 120 + 2000 + 152;
  html._base.contentH = () => body.clientHeight;

  // fixed cookie-consent banner (bottom)
  const banner = body.appendChild(new El('div', doc, { clientH: 100, clientW: VP_W }));
  banner.id = 'cookie-consent-banner';
  banner.setAttribute('style', 'position:fixed;left:0;bottom:0;z-index:9999');
  banner._rect = () => ({ left: 0, top: VP_H - 100, width: VP_W, height: 100 });
  // fixed modal dialog covering most of the viewport
  const modal = body.appendChild(new El('div', doc, { clientH: 600, clientW: 1000 }));
  modal.id = 'promo-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('style', 'position:fixed;left:140px;top:60px;z-index:10000');
  modal._rect = () => ({ left: 140, top: 60, width: 1000, height: 600 });
  // native <dialog open> (not role=dialog, not full-cover) — caught by the tag rule
  const dlg = body.appendChild(new El('dialog', doc, { clientH: 300, clientW: 500 }));
  dlg.id = 'native-dialog';
  dlg.setAttribute('open', '');
  dlg.setAttribute('style', 'position:fixed;left:400px;top:200px;z-index:5000');
  dlg._rect = () => ({ left: 400, top: 200, width: 500, height: 300 });
  // fixed newsletter modal — only caught by the keyword rule (low z, small, no role)
  const news = body.appendChild(new El('div', doc, { clientH: 200, clientW: 400 }));
  news.id = 'newsletter-signup-modal';
  news.setAttribute('style', 'position:fixed;left:820px;top:300px;z-index:500');
  news._rect = () => ({ left: 820, top: 300, width: 400, height: 200 });
  // persistent chat widget (Intercom-style) — corner fixed, caught by vendor keyword
  const widget = body.appendChild(new El('div', doc, { clientH: 80, clientW: 80 }));
  widget.id = 'intercom-container';
  widget.setAttribute('style', 'position:fixed;left:1150px;top:600px;z-index:2147483000');
  widget._rect = () => ({ left: 1150, top: 600, width: 80, height: 80 });

  // scroll-lock: while html overflow is hidden, the window can't scroll
  const origScrollTo = win.scrollTo.bind(win);
  win.scrollTo = (x, y) => {
    const locked = /(hidden|clip)/.test((gcs(html).overflowY) || '');
    origScrollTo(x, locked ? 0 : y);
  };
  win.scrollY = 0;

  const shown = el => gcs(el).display !== 'none' && !hiddenNow(el);

  function render() {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 120) fillRect(img, 0, vy, VP_W, 1, OV.header);
      else if (row < 2120) {
        const c = row - 120;
        fillRect(img, 0, vy, VP_W, 1, (c >= 1500 && c < 1600) ? OV.deep : OV.content);
      } else if (row < 2272) fillRect(img, 0, vy, VP_W, 1, OV.footer);
    }
    if (shown(banner)) fillRect(img, 0, VP_H - 100, VP_W, 100, OV.banner);
    if (shown(modal)) fillRect(img, 140, 60, 1000, 600, OV.modal);
    if (shown(dlg)) fillRect(img, 400, 200, 500, 300, OV.dialog);
    if (shown(news)) fillRect(img, 820, 300, 400, 200, OV.news);
    if (shown(widget)) fillRect(img, 1150, 600, 80, 80, OV.widget);
    return img;
  }
  return { name: 'overlay', doc, html, body, win, render, dpr, bannerH: 0, refs: { html, banner, modal } };
}

function expectOverlay(seg, state, segs) {
  const x = 640;
  check('scroll unlocked — full page captured (canvas ~2272 tall)', Math.abs(seg.h - 2272) <= 4, seg.h + '');
  const deep = countRowsWithColor(seg, x, 0, seg.h, OV.deep);
  check('deep content past the lock captured (~100 rows)', Math.abs(deep - 100) <= 4, deep + ' rows');
  const banner = countRowsWithColor(seg, x, 0, seg.h, OV.banner);
  check('cookie-consent banner hidden (0 rows)', banner === 0, banner + ' rows');
  const modal = countRowsWithColor(seg, x, 0, seg.h, OV.modal);
  check('modal dialog hidden (0 rows)', modal === 0, modal + ' rows');
  const dlg = countRowsWithColor(seg, x, 0, seg.h, OV.dialog);
  check('native <dialog> modal hidden (0 rows)', dlg === 0, dlg + ' rows');
  const news = countRowsWithColor(seg, 940, 0, seg.h, OV.news);
  check('newsletter/keyword modal hidden (0 rows)', news === 0, news + ' rows');
  const widget = countRowsWithColor(seg, 1180, 0, seg.h, OV.widget);
  check('persistent chat widget hidden (0 rows)', widget === 0, widget + ' rows');
  const footer = countRowsWithColor(seg, x, 0, seg.h, OV.footer);
  check('footer present at the true bottom (~152 rows)', Math.abs(footer - 152) <= 4, footer + ' rows');
}

/* ========== scenario: network "load more" button (v1.6.11) ========== */
/* A document feed paged behind a "Load more" button: only the first PAGE items
   are in the DOM; the rest are appended by app JS (a network fetch in the real
   world) when the button is clicked. A normal capture — and even the declarative
   expandInteractive reveal — misses them, because they don't exist in the DOM
   until the click. With the opt-in `loadMore` setting on, the engine clicks the
   button and waits for the append, repeatedly, until the feed is exhausted (the
   button reads 0x0 and is treated as gone) — so the full feed is captured. The
   loaded content is left in place (honest boundary: it can't be un-fetched); the
   loop mutates no styles/attributes, so the byte-identical restore still holds.
   Modelled with zero style mutations: the item count is a closure counter the
   button click bumps, and every height is a live _base function of it. */

const LM = {
  header: [40, 60, 100],
  item:   [90, 160, 210],
  deep:   [0, 200, 120],    // item #18 — only realized after loading pages 2-4
  button: [230, 120, 40],   // "Load more" — present only while the feed has more
  footer: [70, 70, 85]
};

function buildLoadMore() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const TOTAL = 20, PAGE = 5, ITEM_H = 100, HEADER_H = 120, BTN_H = 60, FOOTER_H = 152, DEEP_IX = 17;
  let loaded = PAGE;   // app state: how many feed items are currently realized

  const header = body.appendChild(new El('div', doc, { clientH: HEADER_H, clientW: VP_W }));
  const list = body.appendChild(new El('div', doc, { clientW: VP_W }));
  list.id = 'feed';
  list._base.clientH = () => loaded * ITEM_H;
  const button = body.appendChild(new El('button', doc, {}));
  button.id = 'loadmore';
  button.textContent = 'Load more';
  button._base.clientW = () => (loaded < TOTAL ? 200 : 0);   // 0x0 == gone, with no style change
  button._base.clientH = () => (loaded < TOTAL ? BTN_H : 0);
  button._onClick = () => { if (loaded < TOTAL) loaded = Math.min(TOTAL, loaded + PAGE); };
  const footer = body.appendChild(new El('div', doc, { clientH: FOOTER_H, clientW: VP_W }));

  body._base.contentH = () => header.clientHeight + list.clientHeight + button.clientHeight + footer.clientHeight;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const L = []; let y = 0;
    const push = (h, c) => { if (h > 0) { L.push([y, y + h, c]); y += h; } };
    push(HEADER_H, LM.header);
    for (let i = 0; i < loaded; i++) push(ITEM_H, i === DEEP_IX ? LM.deep : LM.item);
    push(button.clientHeight, LM.button);   // 0 when the feed is exhausted
    push(FOOTER_H, LM.footer);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      for (const seg of L) { if (row >= seg[0] && row < seg[1]) { fillRect(img, 0, vy, VP_W, 1, seg[2]); break; } }
    }
    return img;
  }
  return { name: 'loadmore', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { button, feed: list, getLoaded: () => loaded } };
}

function expectLoadMore(seg, state, segs) {
  const EXP_H = 120 + 20 * 100 + 0 + 152;   // 2272 — header + 20 items + (button gone) + footer
  const x = 640;
  check('single part, height ' + EXP_H + ' (full feed loaded via the button)',
    segs.length === 1 && seg.h === EXP_H, segs.map(s => s.h).join('+'));
  const deep = countRowsWithColor(seg, x, 0, seg.h, LM.deep);
  check('deep feed item #18 present — appended by the load-more loop (~100 rows)',
    Math.abs(deep - 100) <= 3, deep + ' rows');
  const btn = countRowsWithColor(seg, x, 0, seg.h, LM.button);
  check('"Load more" button gone once the feed is exhausted (0 rows)', btn === 0, btn + ' rows');
  const items = countRowsWithColor(seg, x, 0, seg.h, LM.item);
  check('all 19 non-deep feed items present (~1900 rows)', Math.abs(items - 1900) <= 6, items + ' rows');
  const foot = countRowsWithColor(seg, x, 0, seg.h, LM.footer);
  check('footer present at the very bottom (~152 rows)', Math.abs(foot - 152) <= 3, foot + ' rows');
}

/* ========== scenario: infinite-scroll feed, NO button (v1.6.12) ========== */
/* A document feed with no "load more" button: an IntersectionObserver-style
   loader appends the next page whenever the viewport nears the bottom. totalH is
   measured before the feed grows, so a normal capture truncates; the adaptive
   bottom re-measure (v1.6.5) catches only ~one extra batch (bounded to 2vh), not
   an arbitrarily long feed. With the opt-in `infiniteScroll` setting on, the
   engine scrolls to the bottom and waits for the append, repeatedly, until the
   feed stops growing or a hard cap — so the whole feed is captured. Modelled with
   zero style mutations (a closure counter bumped by a window 'scroll' handler),
   so leave-no-trace holds; the loaded feed is left in place (honest boundary). */

const IS = {
  header: [30, 50, 90],
  item:   [70, 150, 200],
  deep:   [0, 210, 130],   // item #22 — reached only after several scroll-appends
  footer: [80, 70, 60]
};

function buildInfiniteScroll() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const TOTAL = 24, PAGE = 6, ITEM_H = 100, HEADER_H = 120, FOOTER_H = 152, DEEP_IX = 21, SENTINEL = 300;
  let loaded = PAGE;   // first page already realized

  const header = body.appendChild(new El('div', doc, { clientH: HEADER_H, clientW: VP_W }));
  const feed = body.appendChild(new El('div', doc, { clientW: VP_W }));
  feed.id = 'feed';
  feed._base.clientH = () => loaded * ITEM_H;
  const footer = body.appendChild(new El('div', doc, { clientH: FOOTER_H, clientW: VP_W }));

  body._base.contentH = () => header.clientHeight + feed.clientHeight + footer.clientHeight;
  html._base.contentH = () => body.clientHeight;

  // near-bottom loader: appends the next page when the viewport nears the bottom
  win.addEventListener('scroll', () => {
    if (loaded >= TOTAL) return;
    if (win.scrollY + win.innerHeight >= html.scrollHeight - SENTINEL) {
      loaded = Math.min(TOTAL, loaded + PAGE);
    }
  });
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const L = []; let y = 0;
    const push = (h, c) => { if (h > 0) { L.push([y, y + h, c]); y += h; } };
    push(HEADER_H, IS.header);
    for (let i = 0; i < loaded; i++) push(ITEM_H, i === DEEP_IX ? IS.deep : IS.item);
    push(FOOTER_H, IS.footer);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      for (const seg of L) { if (row >= seg[0] && row < seg[1]) { fillRect(img, 0, vy, VP_W, 1, seg[2]); break; } }
    }
    return img;
  }
  return { name: 'infinitescroll', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { feed, getLoaded: () => loaded } };
}

function expectInfiniteScroll(seg, state, segs) {
  const EXP_H = 120 + 24 * 100 + 152;   // 2672 — header + 24 items + footer
  const x = 640;
  check('single part, height ' + EXP_H + ' (full infinite feed scrolled in)',
    segs.length === 1 && seg.h === EXP_H, segs.map(s => s.h).join('+'));
  const deep = countRowsWithColor(seg, x, 0, seg.h, IS.deep);
  check('deep feed item #22 present — reached only by repeated scroll-append (~100 rows)',
    Math.abs(deep - 100) <= 3, deep + ' rows');
  const items = countRowsWithColor(seg, x, 0, seg.h, IS.item);
  check('all 23 non-deep feed items present (~2300 rows)', Math.abs(items - 2300) <= 8, items + ' rows');
  const foot = countRowsWithColor(seg, x, 0, seg.h, IS.footer);
  check('end footer present at the very bottom (~152 rows)', Math.abs(foot - 152) <= 3, foot + ' rows');
}

/* ========== scenario: infinite-scroll INSIDE an app-shell pane (v1.6.12) ========== */
/* Same no-button infinite feed as `infinitescroll`, but the dominant scroller is
   an inner app-shell PANE (root.isDoc === false), not the document. The engine's
   infiniteScrollPass already scrolls root.el for a pane; this locks that path in:
   the pane's near-bottom loader appends on pane scroll, the pass grows it before
   measuring, and the stitcher unrolls the pane (shell chrome kept) to the full feed. */

const PI = {
  header: [60, 40, 90],   // shell top chrome (kept once)
  item:   [80, 140, 190],
  deep:   [0, 220, 120],  // pane item #29 — reached only by scrolling the pane
  bottom: [0, 136, 255]
};

function buildPaneInfinite() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const TOTAL = 32, PAGE = 8, ITEM_H = 100, HEADER_H = 64, PANE_H = VP_H - HEADER_H, BOTTOM_H = 152, DEEP_IX = 28, SENTINEL = 200;
  let loaded = PAGE;   // first page already realized in the pane

  const header = body.appendChild(new El('header', doc, { clientH: HEADER_H, clientW: VP_W }));
  const pane = body.appendChild(new El('main', doc, { clientH: PANE_H, clientW: VP_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 0, top: HEADER_H - win.scrollY, width: VP_W, height: PANE_H });
  const paneContent = pane.appendChild(new El('div', doc, { clientW: VP_W }));
  paneContent._base.contentH = () => loaded * ITEM_H + BOTTOM_H;

  body._base.contentH = () => HEADER_H + pane.clientHeight;   // the document itself does not scroll
  html._base.contentH = () => body.clientHeight;

  // pane near-bottom loader: appends the next page when the PANE nears its bottom
  pane._onScroll = () => {
    if (loaded >= TOTAL) return;
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - SENTINEL) {
      loaded = Math.min(TOTAL, loaded + PAGE);
    }
  };
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = HEADER_H - win.scrollY;
    const colorAt = (row) => {
      const feedH = loaded * ITEM_H;
      if (row < feedH) { const i = Math.floor(row / ITEM_H); return i === DEEP_IX ? PI.deep : PI.item; }
      if (row < feedH + BOTTOM_H) return PI.bottom;
      return WHITE;
    };
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const contentRow = pane.scrollTop + (dy - paneTop);
      fillRect(img, 0, dy, VP_W, 1, colorAt(Math.floor(contentRow)));
    }
    fillRect(img, 0, -win.scrollY, VP_W, HEADER_H, PI.header);   // shell chrome, top (kept once)
    return img;
  }
  return { name: 'paneinfinite', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { pane, getLoaded: () => loaded } };
}

function expectPaneInfinite(seg, state, segs) {
  const EXP_H = 64 + (32 * 100 + 152);   // 3416 — shell header + full pane content
  const x = 640;
  check('rootRect present (app-shell pane capture)', !!state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  check('canvas 1280x~' + EXP_H + ' (pane infinite feed fully unrolled)',
    segs.length === 1 && seg.w === 1280 && Math.abs(seg.h - EXP_H) <= 3, seg.w + 'x' + seg.h);
  const deep = countRowsWithColor(seg, x, 0, seg.h, PI.deep);
  check('deep pane item #29 present — scrolled in inside the pane (~100 rows)', Math.abs(deep - 100) <= 3, deep + ' rows');
  const items = countRowsWithColor(seg, x, 0, seg.h, PI.item);
  check('full pane feed present (~3100 rows)', Math.abs(items - 3100) <= 12, items + ' rows');
  const bottom = countRowsWithColor(seg, x, 0, seg.h, PI.bottom);
  check('pane bottom marker at the very bottom (~152 rows)', Math.abs(bottom - 152) <= 3, bottom + ' rows');
  const hdr = countRowsWithColor(seg, x, 0, seg.h, PI.header);
  check('shell header chrome kept once (~64 rows)', Math.abs(hdr - 64) <= 3, hdr + ' rows');
}

/* ========== scenario: "load more" BUTTON inside an app-shell pane (v1.6.12) ========== */
/* The last untested append combo: a network "load more" button that lives INSIDE an
   app-shell PANE (root.isDoc === false), not the document. clickLoadMore already reads
   root.el.scrollHeight and findLoadMoreButton walks the whole composed tree, so the
   click-loop should grow the PANE before measuring; this scenario locks that in. Same
   honest boundary as `loadmore`: the appended content is the desired capture and is left
   in place; the loop sets no styles/attributes, so leave-no-trace holds. Modelled like
   buildPaneInfinite (shell header + overflow:auto pane) but the pane feed grows on a
   BUTTON click (_onClick bumps a closure counter), not on scroll. */

const PLM = {
  header: [55, 45, 95],    // shell top chrome (kept once)
  item:   [85, 145, 195],
  deep:   [0, 215, 125],   // pane item #29 — only realized after clicking through pages 2-4
  button: [235, 125, 45],  // "Load more" — present only while the pane feed has more
  bottom: [0, 136, 255]
};

function buildPaneLoadMore() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const TOTAL = 32, PAGE = 8, ITEM_H = 100, HEADER_H = 64, PANE_H = VP_H - HEADER_H,
        BTN_H = 60, BOTTOM_H = 152, DEEP_IX = 28;
  let loaded = PAGE;   // first page already realized in the pane

  const header = body.appendChild(new El('header', doc, { clientH: HEADER_H, clientW: VP_W }));
  const pane = body.appendChild(new El('main', doc, { clientH: PANE_H, clientW: VP_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 0, top: HEADER_H - win.scrollY, width: VP_W, height: PANE_H });
  // pane content: the feed list, then the load-more button, then a bottom marker.
  const list = pane.appendChild(new El('div', doc, { clientW: VP_W }));
  list.id = 'feed';
  list._base.clientH = () => loaded * ITEM_H;
  const button = pane.appendChild(new El('button', doc, {}));
  button.id = 'paneloadmore';
  button.textContent = 'Load more';
  button._base.clientW = () => (loaded < TOTAL ? 200 : 0);   // 0x0 == gone, with no style change
  button._base.clientH = () => (loaded < TOTAL ? BTN_H : 0);
  button._onClick = () => { if (loaded < TOTAL) loaded = Math.min(TOTAL, loaded + PAGE); };
  const bottom = pane.appendChild(new El('div', doc, { clientH: BOTTOM_H, clientW: VP_W }));

  body._base.contentH = () => HEADER_H + pane.clientHeight;   // the document itself does not scroll
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = HEADER_H - win.scrollY;
    const feedH = loaded * ITEM_H;
    const btnH = button.clientHeight;      // 0 once the feed is exhausted
    const colorAt = (row) => {
      if (row < feedH) { const i = Math.floor(row / ITEM_H); return i === DEEP_IX ? PLM.deep : PLM.item; }
      if (row < feedH + btnH) return PLM.button;
      if (row < feedH + btnH + BOTTOM_H) return PLM.bottom;
      return WHITE;
    };
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const contentRow = pane.scrollTop + (dy - paneTop);
      fillRect(img, 0, dy, VP_W, 1, colorAt(Math.floor(contentRow)));
    }
    fillRect(img, 0, -win.scrollY, VP_W, HEADER_H, PLM.header);   // shell chrome, top (kept once)
    return img;
  }
  return { name: 'paneloadmore', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { pane, button, feed: list, getLoaded: () => loaded } };
}

function expectPaneLoadMore(seg, state, segs) {
  const EXP_H = 64 + (32 * 100 + 152);   // 3416 — shell header + full pane content (button gone)
  const x = 640;
  check('rootRect present (app-shell pane capture)', !!state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  check('canvas 1280x~' + EXP_H + ' (pane feed fully loaded via the button, unrolled)',
    segs.length === 1 && seg.w === 1280 && Math.abs(seg.h - EXP_H) <= 3, seg.w + 'x' + seg.h);
  const deep = countRowsWithColor(seg, x, 0, seg.h, PLM.deep);
  check('deep pane item #29 present — appended by the in-pane load-more loop (~100 rows)',
    Math.abs(deep - 100) <= 3, deep + ' rows');
  const btn = countRowsWithColor(seg, x, 0, seg.h, PLM.button);
  check('"Load more" button gone once the pane feed is exhausted (0 rows)', btn === 0, btn + ' rows');
  const items = countRowsWithColor(seg, x, 0, seg.h, PLM.item);
  check('full pane feed present (~3100 rows)', Math.abs(items - 3100) <= 12, items + ' rows');
  const bot = countRowsWithColor(seg, x, 0, seg.h, PLM.bottom);
  check('pane bottom marker at the very bottom (~152 rows)', Math.abs(bot - 152) <= 3, bot + ' rows');
  const hdr = countRowsWithColor(seg, x, 0, seg.h, PLM.header);
  check('shell header chrome kept once (~64 rows)', Math.abs(hdr - 64) <= 3, hdr + ' rows');
}

/* ========== scenario: skeleton -> data mid-page swap (v1.6.13) ========== */
/* A mid-page region renders SKELETON placeholders immediately (aria-busy="true"),
   then a network fetch replaces them with the real (taller) content once it lands.
   A normal capture measures totalH while the region is still skeleton height, so the
   shot shows grey placeholders and the real content below the swap is truncated (its
   deep marker never captured). The opt-in `waitStable` pass polls the DOM before
   measuring and waits while aria-busy / skeleton markers are present (bounded), so the
   settled real content is captured. Pure read-only pass -> leave-no-trace. Honest
   boundary (like loadMore/infiniteScroll): the resolved data is the desired capture and
   is left in place; the region's own app resolves it, the pass mutates nothing.
   Sim contract: the region resolves after the stability pass has observed its aria-busy
   attribute RESOLVE_AFTER times (the pass's polling gives the app its event-loop turns);
   nothing else in the engine reads aria-busy, so without `waitStable` it never resolves
   -> a deterministic reproduction. The real async fetch->DOM seam is covered by e2e. */

const SK = {
  header:   [45, 55, 95],
  skeleton: [210, 210, 216],   // grey placeholder / shimmer box (present only pre-swap)
  real:     [80, 150, 120],    // settled real content
  deep:     [0, 210, 110],     // deep marker — lives only in the real (taller) content
  footer:   [70, 70, 85]
};

function buildSkeleton() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const HEADER_H = 120, SKEL_H = 600, REAL_H = 2400, FOOTER_H = 152, DEEP_OFF = 2200, DEEP_H = 100;
  const RESOLVE_AFTER = 2;   // resolves after the stability pass polls aria-busy this many times
  let resolved = false, reads = 0;

  const header = body.appendChild(new El('div', doc, { clientH: HEADER_H, clientW: VP_W }));
  const region = body.appendChild(new El('div', doc, { clientW: VP_W }));
  region.id = 'data';
  region.setAttribute('aria-busy', 'true');           // "still loading" — the loader marker
  region._base.clientH = () => (resolved ? REAL_H : SKEL_H);
  region._onAttrRead = (el, name) => {
    if (name === 'aria-busy' && !resolved && ++reads >= RESOLVE_AFTER) {
      resolved = true;
      el.setAttribute('aria-busy', 'false');          // app: data landed, clear the loader
    }
  };
  const footer = body.appendChild(new El('div', doc, { clientH: FOOTER_H, clientW: VP_W }));

  body._base.contentH = () => header.clientHeight + region.clientHeight + footer.clientHeight;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const L = []; let y = 0;
    const push = (h, c) => { if (h > 0) { L.push([y, y + h, c]); y += h; } };
    push(HEADER_H, SK.header);
    if (resolved) {
      push(DEEP_OFF, SK.real);
      push(DEEP_H, SK.deep);
      push(REAL_H - DEEP_OFF - DEEP_H, SK.real);
    } else {
      push(SKEL_H, SK.skeleton);
    }
    push(FOOTER_H, SK.footer);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      for (const seg of L) { if (row >= seg[0] && row < seg[1]) { fillRect(img, 0, vy, VP_W, 1, seg[2]); break; } }
    }
    return img;
  }
  return { name: 'skeleton', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { region, getResolved: () => resolved } };
}

function expectSkeleton(seg, state, segs) {
  const EXP_H = 120 + 2400 + 152;   // 2672 — header + settled real content + footer
  const x = 640;
  check('single part, height ' + EXP_H + ' (real data settled in, not skeleton height)',
    segs.length === 1 && seg.h === EXP_H, segs.map(s => s.h).join('+'));
  const deep = countRowsWithColor(seg, x, 0, seg.h, SK.deep);
  check('deep real-data marker present — appeared only after the DOM stabilized (~100 rows)',
    Math.abs(deep - 100) <= 3, deep + ' rows');
  const skel = countRowsWithColor(seg, x, 0, seg.h, SK.skeleton);
  check('no skeleton/placeholder pixels remain in the shot (0 rows)', skel === 0, skel + ' rows');
  const real = countRowsWithColor(seg, x, 0, seg.h, SK.real);
  check('full real content present (~2300 rows)', Math.abs(real - 2300) <= 6, real + ' rows');
  const foot = countRowsWithColor(seg, x, 0, seg.h, SK.footer);
  check('footer present at the very bottom (~152 rows)', Math.abs(foot - 152) <= 3, foot + ' rows');
}

/* ========== scenario: LOADMORE_RE label battery + destructive decoys (v1.6.14) ========== */
/* Sanity-checks the "load more" label heuristics against real-world button copy and,
   crucially, proves the loop never trips a DESTRUCTIVE / navigation / collapse control.
   One real load-more button whose label CYCLES through a battery of positive real-world
   variants on each successful click (so every variant must be recognized by the running
   loop for the feed to reach full), plus decoy <button>s carrying negative labels placed
   BEFORE it in the DOM (findLoadMoreButton scans them first) — each decoy records any
   click, and the test asserts every decoy counter stays 0. Reproduced a real gap first:
   the current regex MISSES number-infixed labels ("Show 20 more" / "Load 50 more"), so the
   loop stalls mid-battery — fixed in 1.6.14 by allowing an optional count between the verb
   and the quantity word (non-capturing, so no new false-positive surface). */

const LL = { header: [40, 60, 100], controls: [180, 180, 190], feed: [90, 160, 210], button: [230, 120, 40], footer: [70, 70, 85] };

function buildLoadMoreLabels() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const POSITIVE = ['Load more', 'Show more', 'Show 20 more', 'View more comments', 'Load older posts', 'See more replies', 'More results'];
  const NEGATIVE = ['Delete', 'Buy now', 'Submit', 'Next page', 'Sign out', 'Show less', 'Read more', 'More options', 'Remove', 'Cancel'];
  const HEADER_H = 100, ITEM_H = 60, PAGE = 3, BTN_H = 44, FOOTER_H = 120, DECOY_H = 36;
  const STRUCT_DECOYS = 2;   // matching-label but structurally blocked (nav anchor, disabled button)
  const CTRL_H = (NEGATIVE.length + STRUCT_DECOYS) * DECOY_H;
  let loaded = PAGE, stage = 0;
  const decoyClicks = {};

  const header = body.appendChild(new El('div', doc, { clientH: HEADER_H, clientW: VP_W }));
  // Decoy buttons FIRST (scanned before the real one) — must never be clicked.
  NEGATIVE.forEach(lbl => {
    const d = body.appendChild(new El('button', doc, { clientW: 120, clientH: DECOY_H }));
    d.textContent = lbl;
    decoyClicks[lbl] = 0;
    d._onClick = () => { decoyClicks[lbl]++; };
  });
  // structural safety decoys: MATCHING "load more" label, but must stay unclicked —
  // a navigating anchor (href guard) and a disabled button (disabled guard).
  const navA = body.appendChild(new El('a', doc, { clientW: 120, clientH: DECOY_H }));
  navA.textContent = 'Load more'; navA.setAttribute('href', '/page2');
  decoyClicks['a[href=/page2]:Load more'] = 0;
  navA._onClick = () => { decoyClicks['a[href=/page2]:Load more']++; };
  const disB = body.appendChild(new El('button', doc, { clientW: 120, clientH: DECOY_H }));
  disB.textContent = 'Load more'; disB.setAttribute('disabled', '');
  decoyClicks['button[disabled]:Load more'] = 0;
  disB._onClick = () => { decoyClicks['button[disabled]:Load more']++; };
  const feed = body.appendChild(new El('div', doc, { clientW: VP_W }));
  feed.id = 'feed';
  feed._base.clientH = () => loaded * ITEM_H;
  const button = body.appendChild(new El('button', doc, {}));
  button.id = 'loadmorelabels';
  button.textContent = POSITIVE[0];
  button._base.clientW = () => (stage < POSITIVE.length ? 180 : 0);   // 0x0 == gone
  button._base.clientH = () => (stage < POSITIVE.length ? BTN_H : 0);
  button._onClick = () => {
    if (stage < POSITIVE.length) {
      loaded += PAGE;
      stage++;
      if (stage < POSITIVE.length) button.textContent = POSITIVE[stage];   // relabel to the next variant
    }
  };
  const footer = body.appendChild(new El('div', doc, { clientH: FOOTER_H, clientW: VP_W }));

  body._base.contentH = () => HEADER_H + CTRL_H + feed.clientHeight + button.clientHeight + FOOTER_H;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const L = []; let y = 0;
    const push = (h, c) => { if (h > 0) { L.push([y, y + h, c]); y += h; } };
    push(HEADER_H, LL.header);
    push(CTRL_H, LL.controls);
    push(loaded * ITEM_H, LL.feed);
    push(button.clientHeight, LL.button);
    push(FOOTER_H, LL.footer);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      for (const seg of L) { if (row >= seg[0] && row < seg[1]) { fillRect(img, 0, vy, VP_W, 1, seg[2]); break; } }
    }
    return img;
  }
  return { name: 'loadmorelabels', doc, html, body, win, render, dpr, bannerH: 0,
    refs: { button, feed, getStage: () => stage, positiveCount: POSITIVE.length, getLoaded: () => loaded, decoyClicks } };
}

function expectLoadMoreLabels(seg, state, segs) {
  const EXP_H = 100 + 12 * 36 + 24 * 60 + 0 + 120;   // 2092 — header + controls (10 label + 2 structural decoys) + full feed + (button gone) + footer
  const x = 640;
  check('single part, height ' + EXP_H + ' (feed fully loaded through all label variants, button gone)',
    segs.length === 1 && seg.h === EXP_H, segs.map(s => s.h).join('+'));
  const feed = countRowsWithColor(seg, x, 0, seg.h, LL.feed);
  check('full feed present (~1440 rows across 7 label-driven load rounds)', Math.abs(feed - 1440) <= 6, feed + ' rows');
  const btn = countRowsWithColor(seg, x, 0, seg.h, LL.button);
  check('load-more button gone once every page is loaded (0 rows)', btn === 0, btn + ' rows');
}

/* ========== scenario: single DECORATIVE carousel merged-right mis-fire (v1.6.15) ========== */
/* Found on a real Reddit feed capture: "Suggested communities" is a lone horizontal
   carousel (overflow-x:auto, a short strip of community cards). v1.6.3 only gates the
   MULTI-carousel wall (2+ independent sideways scrollers); a SINGLE decorative carousel
   still hit the "merged right" pass and was widened to its full scrollWidth, ballooning
   the page sideways past the viewport (that one row sticks out wider than the rest).
   Reproduced here: header + one 12-card carousel strip + a tall vertical feed. Fix
   (v1.6.15): a single sideways scroller that is a decorative carousel (short strip, a row
   of >=3 similar-width cards, none dominating the width) is left as-seen too; only a
   genuine wide-content block (wide table/board/code) still merges right. */

const SC = { header: [40, 60, 100], card: [90, 160, 210], feed: [70, 150, 120], deep: [0, 210, 110], bottom: [70, 70, 85] };

function buildSingleCarousel(opts) {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const HEADER_H = 120, CAROUSEL_H = 220, FEED_H = 1800, BOTTOM_H = 152, NCARDS = 12, CARDW = 200;
  const header = body.appendChild(new El('div', doc, { clientH: HEADER_H, clientW: VP_W }));
  // the lone decorative carousel: short strip, overflow-x:auto, 12 equal-width cards (scrollWidth 2400 > viewport)
  const carousel = body.appendChild(new El('div', doc, { clientH: CAROUSEL_H, clientW: VP_W, contentW: NCARDS * CARDW, contentH: CAROUSEL_H }));
  carousel.id = 'suggested';
  carousel.setAttribute('style', 'overflow-x:auto');
  const cardParent = (opts && opts.shadow) ? carousel.attachShadow() : carousel;
  for (let i = 0; i < NCARDS; i++) cardParent.appendChild(new El('div', doc, { clientW: CARDW, clientH: 180 }));
  const feed = body.appendChild(new El('div', doc, { clientH: FEED_H, clientW: VP_W }));   // main vertical content
  const bottom = body.appendChild(new El('div', doc, { clientH: BOTTOM_H, clientW: VP_W }));

  body._base.contentH = () => header.clientHeight + carousel.clientHeight + feed.clientHeight + bottom.clientHeight;
  body._base.contentW = () => Math.max(VP_W, carousel.clientWidth);   // balloons IFF the carousel is widened
  html._base.contentH = () => body.clientHeight;
  html._base.contentW = () => Math.max(VP_W, body.scrollWidth);
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const sxw = win.scrollX;
    const L = []; let y = 0;
    const push = (h, c) => { L.push([y, y + h, c]); y += h; };
    push(HEADER_H, SC.header);
    push(CAROUSEL_H, SC.card);
    push(800, SC.feed); push(100, SC.deep); push(FEED_H - 900, SC.feed);
    push(BOTTOM_H, SC.bottom);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      for (const s of L) { if (row >= s[0] && row < s[1]) { fillRect(img, 0 - sxw, vy, VP_W, 1, s[2]); break; } }
    }
    return img;
  }
  return { name: 'singlecarousel', doc, html, body, win, render, dpr, bannerH: 0, refs: { carousel } };
}

function expectSingleCarousel(seg, state, segs) {
  const x = 640;
  check('page NOT ballooned sideways — totalW == viewport (single decorative carousel left as-seen)',
    state.meta.totalW === VP_W, 'totalW=' + state.meta.totalW);
  check('single vertical canvas at viewport width', segs.length === 1 && seg.w === VP_W, seg.w + 'x' + seg.h);
  const card = countRowsWithColor(seg, x, 0, seg.h, SC.card);
  check('carousel strip present as-seen (~220 rows)', Math.abs(card - 220) <= 4, card + ' rows');
  const deep = countRowsWithColor(seg, x, 0, seg.h, SC.deep);
  check('deep feed marker present (~100 rows)', Math.abs(deep - 100) <= 4, deep + ' rows');
  const bottom = countRowsWithColor(seg, x, 0, seg.h, SC.bottom);
  check('bottom marker present (~152 rows)', Math.abs(bottom - 152) <= 4, bottom + ' rows');
}

/* ============ shared grading for the redaction LEDGERS (v1.10.3) ============
   REDACTION-CLAIM-SPEC.md §2.1 / §2.4 / §2.6. Every scenario that turns
   redactPII on is graded through here, so a counter that stops being written
   reddens everywhere at once rather than in the one place someone remembered.

   What this tier can and cannot prove is settled in §6.2 and is worth saying at
   the call site: the sim grades ARITHMETIC, MAPPING and PLUMBING — the ledger's
   invariants hold, the counters reach the state function, the state function
   reaches the record and the sentence. It cannot grade LAYOUT: a fixture's text
   and its rect are two fields of the same literal, written by the same author,
   so the placement clauses here compare that author's assumption with itself.
   Real layout is the only independent second opinion, and it lives in
   test/e2e/. Nothing below should ever be read as proof that a clause works. */
/* A missing counter must READ as a failure, not crash the tier: an absent field
   is exactly what a regression looks like, and a TypeError three checks in
   hides the other forty. */
/* Source read for a STRUCTURAL check has to see code, not prose: a fix that
   explains what it stopped doing names the thing it stopped doing, and a grep
   that cannot tell the two apart grades the comment. */
function stripJsComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function q(o, dotted) {
  let n = o;
  for (const k of String(dotted).split('.')) { if (n == null) return undefined; n = n[k]; }
  return n;
}
function gradeScanLedger(label, scan) {
  check(label + ': scan ledger present and v2', !!scan && scan.v === 2, JSON.stringify(scan));
  if (!scan || scan.v !== 2) return;
  check(label + ': the pass reached its own last line (sealed)', scan.sealed === true, String(scan.sealed));
  /* §6.1 row 14. The invariant that stops a span being dropped from the
     evidence silently: every string handed to the detector is either placed or
     unplaced-for-exactly-one-reason. Under the first draft an unplaced span was
     simply removed from consideration while one placed span elsewhere carried
     the whole image. */
  const u = scan.unplaced || {};
  const sum = (u.offRegion || 0) + (u.degenerate || 0) + (u.hidden || 0) +
              (u.fontMismatch || 0) + (u.clipped || 0) + (u.faded || 0);
  check(label + ': Σ unplaced + placed === fed', sum + (scan.placed || 0) === scan.fed,
    sum + ' + ' + scan.placed + ' vs fed ' + scan.fed);
  check(label + ': unplaced.total agrees with its own parts', (u.total || 0) === sum,
    u.total + ' vs ' + sum);
  const d = scan.declined || {};
  check(label + ': declined.total agrees with its own parts',
    (d.total || 0) === (d.tooLong || 0) + (d.ceiling || 0) + (d.unmeasurable || 0) + (d.other || 0),
    JSON.stringify(d));
  check(label + ': every walk that was started is accounted for',
    scan.walksCompleted <= scan.walks && scan.walks >= 1,
    scan.walksCompleted + '/' + scan.walks);
  check(label + ': the ledger records the budget the pass was racing',
    typeof scan.budgetMs === 'number' && scan.budgetMs > 0, String(scan.budgetMs));
  check(label + ': the doors are counted even when they are not opened',
    !!scan.frames && typeof scan.frames.sameOrigin === 'number' &&
    typeof scan.frames.scanned === 'number' && typeof scan.frames.crossOrigin === 'number',
    JSON.stringify(scan.frames));
}
/* THE STANDING REGRESSION (REDACTION-CLAIM-SPEC.md §8.2). Every scenario in
   which the pass really ran and really baked boxes must keep painting and
   verifying what it paints. A ledger that is OVER-strict is not a safer ledger —
   it turns the feature off, silently, on the pages where it works, and a user
   warned on every capture is a user who reads no warning at all. That failure
   is not a lesser one than a false claim; it is the same failure with a better
   alibi, and these are the checks that catch it.

   There is no state to grade any more, and no `bake` on the record to read: the
   ledgers are consumed and dropped, and what is persisted is the three acts.
   `want` is each fixture's DECLARED GROUND TRUTH, and it is declared IN UNITS:
   a plain number means "this many matches, each of which produced exactly one
   block" — and that reading is not taken on trust, it is asserted against the
   scan's own `boxes` and `matched` — while `{ matches, blocks }` is the form a
   fixture uses when a token WRAPS and one match produces several blocks.

   THE UNITS ARE THE POINT. `matched`, `painted` and `verifiedOpaque` all count
   MATCHES, because §3.4 subtracts them from one another and two numbers may
   only be subtracted if they count the same thing. `marks` are BLOCKS — one
   outline per client rect — so the mark count is graded against the block
   figure and never against an act. A single `wantPainted` integer standing for
   both is exactly how a wrapped card number came to cancel an uncovered
   email. */
function gradeActs(label, rec, want, scan, segs) {
  const wantMatches = (want && typeof want === 'object') ? want.matches : want;
  const wantBlocks = (want && typeof want === 'object') ? want.blocks : want;
  if (want != null && typeof want !== 'object' && scan) {
    check(label + ': the fixture is one-block-per-match, so one number states both units',
      scan.boxes === scan.matched, scan.boxes + ' boxes / ' + scan.matched + ' matches');
  }
  const r = rec && rec.redaction;
  check(label + ': the record carries the v3 acts block', !!r && r.v === 3 && !!r.acts,
    JSON.stringify(r));
  if (!r || !r.acts) return;
  const a = r.acts;
  check(label + ': and no verdict of any kind survives beside it',
    r.pixels === undefined && r.state === undefined && r.severity === undefined &&
    r.scan === undefined && r.bake === undefined,
    JSON.stringify(Object.keys(r)));
  check(label + ': the ledger is present, so the counters are measurements',
    a.ledger === 'present', String(a.ledger));
  if (scan) {
    check(label + ': matched is the detector\'s own count, carried whole',
      a.matched === scan.matched, a.matched + ' vs scan ' + scan.matched);
  }
  if (wantMatches != null) {
    check(label + ': painted over exactly ' + wantMatches + ' match(es)', a.painted === wantMatches,
      String(a.painted));
    /* §2.5 — grade the ARTIFACT, not the log. `verifiedOpaque` is a re-read of
       the composed canvas, so a bake that fillRect'd into a canvas it then
       discarded cannot satisfy it. */
    check(label + ': every painted match was re-read opaque out of the finished canvas',
      a.verifiedOpaque === wantMatches, a.verifiedOpaque + '/' + a.painted);
    /* §3.3 — and each verified BLOCK, and only those, becomes a mark. Graded
       against the block figure: a match that wrapped is one match covered and
       two outlines to look at. */
    check(label + ': and only the verified rects travel as marks',
      Array.isArray(r.marks) && r.marks.length === wantBlocks &&
      r.marks.every(m => m.w > 0 && m.h > 0),
      JSON.stringify(r.marks && r.marks.length) + ' vs ' + wantBlocks + ' block(s)');
    /* GRADE THE ARTIFACT, NOT THE PROVENANCE. A mark is allowed to travel for
       exactly one reason — it describes a region that IS A SOLID BLOCK in the
       image the user is holding — so the check is to go and look at that region
       in the delivered pixels. A mark derived from anything else (the page-space
       rect the scan emitted, a box that was never painted, a stale coordinate
       from before a crop) lands on something that is not the block colour, and
       reddens here regardless of how it was computed. */
    if (segs && r.marks && r.marks.length) {
      const bad = [];
      for (const m of r.marks) {
        const cx = Math.round(m.x + m.w / 2), cy = Math.round(m.y + m.h / 2);
        let top = 0, hit = null;
        for (const g of segs) {
          if (cy >= top && cy < top + g.h) { hit = { g, y: cy - top }; break; }
          top += g.h;
        }
        if (!hit || cx < 0 || cx >= hit.g.w) { bad.push('off-image ' + cx + ',' + cy); continue; }
        const o = (hit.y * hit.g.w + cx) * 4;
        const px = [hit.g.data[o], hit.g.data[o + 1], hit.g.data[o + 2]];
        if (px[0] !== 0x11 || px[1] !== 0x11 || px[2] !== 0x11) {
          bad.push(cx + ',' + cy + ' -> rgb(' + px.join(',') + ')');
        }
      }
      check(label + ': every mark points at a solid block in the DELIVERED image',
        bad.length === 0, bad.join(' | ') || r.marks.length + ' marks re-read');
    }
  }
}
/* `requested` reports the SETTING as the engine was handed it, never a later
   re-read of the preference. */
function gradeRequested(label, rec, want) {
  const r = rec && rec.redaction;
  check(label + ': requested is ' + JSON.stringify(want),
    !!r && r.requested === want, r ? JSON.stringify(r.requested) : 'no redaction record');
}

/* ================= scenario: auto-redact PII (v1.7.0) ================= */
/* Opt-in `redactPII`. A document-scroll page with four leaf text elements:
   an email, a phone number, a Luhn-VALID card (all sensitive) and a
   Luhn-INVALID 16-digit decoy (must be left alone). capture.js scans the
   composed tree (pure read — leave-no-trace holds), reports each sensitive
   element's page-space rect in meta.piiBoxes, and result.js bakes an opaque
   block over each — solid, not blur, so it can't be reversed. The decoy locks
   in the Luhn/separator guards (low false-positive). Doc-scroll 1:1 -> page
   y == canvas y. */
const RC = {
  body:  [210, 214, 220], email: [255, 90, 90], phone: [90, 200, 120],
  card:  [90, 130, 255],  decoy: [245, 205, 45], block: [17, 17, 17]
};
function buildRedact() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const PAGE_H = 2000;
  const items = [
    { y: 400,  h: 40, color: RC.email, text: 'Email: jane.doe@example.com',  pii: true },
    { y: 900,  h: 40, color: RC.phone, text: 'Call +1 (555) 123-4567 today', pii: true },
    { y: 1400, h: 40, color: RC.card,  text: 'Card 4242 4242 4242 4242',     pii: true },
    { y: 1700, h: 40, color: RC.decoy, text: 'Order 1234 5678 9012 3456',    pii: false }
  ];
  for (const it of items) {
    const el = body.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.textContent = it.text;
    el._rect = () => ({ left: 40, top: it.y - win.scrollY, width: 600, height: it.h });
    it.el = el;
  }
  body._base.contentH = () => PAGE_H;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      const pageRow = win.scrollY + vy;
      fillRect(img, 0, vy, VP_W, 1, pageRow < PAGE_H ? RC.body : WHITE);
    }
    for (const it of items) fillRect(img, 40, it.y - win.scrollY, 600, it.h, it.color);
    return img;
  }
  return { name: 'redact', doc, html, body, win, render, dpr, bannerH: 0, refs: {}, items };
}
function expectRedact(seg, state, segs, out) {
  const x = 300;   // inside the 40..640 element band
  for (const [nm, color] of [['email', RC.email], ['phone', RC.phone], ['card', RC.card]]) {
    const leak = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check(nm + ' pixels redacted (0 of its colour visible)', leak === 0, leak + ' rows leaked');
  }
  const block = countRowsWithColor(seg, x, 0, seg.h, RC.block, 6);
  check('redaction blocks baked over the 3 sensitive items (~132 rows)', Math.abs(block - 132) <= 10, block + ' rows');
  const decoy = countRowsWithColor(seg, x, 0, seg.h, RC.decoy, 6);
  check('Luhn-invalid decoy left un-redacted (~40 rows)', Math.abs(decoy - 40) <= 6, decoy + ' rows');
  check('meta.piiBoxes reported exactly 3 sensitive items', !!state.meta.piiBoxes && state.meta.piiBoxes.length === 3,
    state.meta.piiBoxes ? state.meta.piiBoxes.length + ' boxes' : 'none');

  /* THE HONEST CASE MUST STAY HONEST. A fix that stops the product over-claiming
     on a canvas-rendered page is not a fix if it starts under-claiming on a page
     where the pass really did run and really did bake boxes. This page has four
     text leaves and three matches, and the record has to say exactly that. */
  const scan = state.meta.piiScan;
  const rec = (out && out.record) || {};
  gradeScanLedger('redact', scan);
  check('redact: the detector was handed all four text leaves',
    !!scan && scan.fed === 4, JSON.stringify({ fed: q(scan,'fed'), placed: q(scan,'placed') }));
  check('redact: all four were measured into the picture', !!scan && scan.placed === 4,
    JSON.stringify(q(scan,'unplaced')));
  check('redact: it counted the characters it actually read, not the page',
    !!scan && scan.chars === 27 + 28 + 24 + 25, String(scan && scan.chars));
  check('redact: three spans matched', !!scan && scan.matched === 3, String(scan && scan.matched));
  check('redact: none it declined to read', q(scan,'declined.total') === 0, JSON.stringify(q(scan,'declined')));
  check('redact: no match came from a span it could not see',
    q(scan,'boxesFromUnplaced') === 0, String(scan && scan.boxesFromUnplaced));
  check('redact: the walk ran to the end', !!q(scan,'truncated') && !q(scan,'truncated.walk') &&
    !q(scan,'truncated.time') && !q(scan,'truncated.ceiling'), JSON.stringify(q(scan,'truncated')));
  gradeActs('redact', rec, 3, scan, segs);
  gradeRequested('redact', rec, true);
  check('redact: the kinds travel beside the claim',
    q(rec,'redaction.kinds.email') === 1 && q(rec,'redaction.kinds.phone') === 1 &&
    q(rec,'redaction.kinds.card') === 1, JSON.stringify(q(rec,'redaction.kinds')));
  check('a page that WAS scanned gets no warning (a caveat everywhere is a caveat nowhere)',
    !!out && out.toasts.length === 0, JSON.stringify(out && out.toasts));
  /* §3.9.2 — the permanent line, not only the 12-second toast. A toast is for a
     decision about to be made; the line is for the person who comes back to the
     record tomorrow. The last attempt computed a counter, read it into a local
     and threw it away, so "persisted and surfaced" is graded, not assumed. */
  /* §3 — the counts are surfaced PERMANENTLY, under the meta, and there is no
     toast at all any more: a transient alarm was how the old design graded eight
     states by volume, and the grading is what has been removed. */
  check('redact: the three counts are on the page, permanently',
    !!out && /3 matched, 3 painted, 3 confirmed opaque/i.test(String(out.lines && out.lines.join(' '))),
    JSON.stringify(out && out.lines));
  check('redact: ...and the line does not tell the reader the image is clean',
    !!out && !/\b(safe|clean|secure|protected)\b/i.test(String(out.lines && out.lines.join(' '))),
    JSON.stringify(out && out.lines));
}


/* ====== scenario: page with NO TEXT LAYER, redaction ON (v1.10.2) ====== */
/* THE FAIL-OPEN CASE, and the reason the scan now reports what it EXAMINED
   rather than only what it found.

   Google Docs, Sheets, Slides and Figma paint their glyphs onto a canvas: the
   document is on screen, it is full of personal data, and there is not one text
   node in the tree to walk. collectPIIBoxes therefore returns nothing — the
   SAME answer it gives for a page that is genuinely clean — and the record used
   to turn that into "pixels: baked" purely because the user had switched the
   setting on. The safety feature failed open on exactly the documents most
   worth redacting, and said so in machine-readable metadata that a store
   reviewer, a compliance process or an assistant reads as fact.

   The fixture is that page: three bands of personal data painted straight into
   the raster, and no textContent on any element in the tree. The email, phone
   and card colours MUST still be in the finished image — nothing was found, so
   nothing could be hidden, and a check that expected them gone would be grading
   a fantasy. What has to change is what the product SAYS about the image, and
   whether it says anything to the person holding it. */
const KC = {
  body:  [206, 212, 222], email: [255, 90, 90], phone: [90, 200, 120],
  card:  [90, 130, 255],  block: [17, 17, 17]
};
function buildCanvasRedact() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const PAGE_H = 2000;
  /* The shape a canvas-rendered editor really has: structural elements the walk
     will visit, one drawing surface, and not a character of text anywhere. The
     wrapper matters — it proves the walk ran and came back empty, rather than
     never having had anything to walk. */
  const shell = body.appendChild(new El('div', doc, { clientH: PAGE_H, clientW: VP_W }));
  const surface = shell.appendChild(new El('canvas', doc, { clientH: PAGE_H, clientW: VP_W }));
  surface.id = 'kix-canvas';
  surface._rect = () => ({ left: 0, top: -win.scrollY, width: VP_W, height: PAGE_H });

  /* THESE TWO ARE THE POINT, and they are here because a REAL BROWSER put them
     there. The first version of this fixture was a clean tree — canvas, no text
     — and it passed while the shipped extension, driven through Playwright
     against a page of the same shape, still recorded "pixels: baked". Every
     real single-page app carries an inline <style> and an inline <script> in
     its body; both are element leaves with a fat textContent, so a counter that
     asks "did we read any text?" reads the developer's source code and answers
     yes. That is the same conflation as the one this scenario exists for,
     arriving one layer down, and no fake DOM was ever going to show it.
     capture.js excludes them BY TAG (FS_NON_TEXT_TAGS); this is the regression
     that keeps the exclusion honest. */
  const css = shell.appendChild(new El('style', doc, { clientH: 0, clientW: 0 }));
  css.textContent = 'html,body{margin:0;background:#ced4de}canvas{display:block}';
  const boot = shell.appendChild(new El('script', doc, { clientH: 0, clientW: 0 }));
  boot.textContent = 'var x=document.getElementById("kix-canvas").getContext("2d");' +
                     'x.fillText("Email: jane.doe@example.com",48,428);';

  body._base.contentH = () => PAGE_H;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  // Personal data as PAINT, exactly as the real editors emit it: no element
  // owns these, so there is nothing for a text walk to find.
  const items = [
    { y: 400,  h: 40, color: KC.email },
    { y: 900,  h: 40, color: KC.phone },
    { y: 1400, h: 40, color: KC.card }
  ];

  function render() {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      const pageRow = win.scrollY + vy;
      fillRect(img, 0, vy, VP_W, 1, pageRow < PAGE_H ? KC.body : WHITE);
    }
    for (const it of items) fillRect(img, 40, it.y - win.scrollY, 600, it.h, it.color);
    return img;
  }
  return { name: 'canvasredact', doc, html, body, win, render, dpr, bannerH: 0,
           refs: { surface }, items };
}
function expectCanvasRedact(seg, state, segs, out) {
  const x = 300;   // inside the 40..640 painted band
  const rec = (out && out.record) || {};
  const toasts = (out && out.toasts) || [];

  /* What is TRUE about this image: the personal data is still in it. The point
     of the item is not that FullShot can redact a picture of text — it cannot —
     it is that FullShot must not report that it did. */
  for (const [nm, color] of [['email', KC.email], ['phone', KC.phone], ['card', KC.card]]) {
    const rows = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check('canvas-painted ' + nm + ' is still in the image (~40 rows) — nothing was hidden',
      Math.abs(rows - 40) <= 6, rows + ' rows');
  }
  const block = countRowsWithColor(seg, x, 0, seg.h, KC.block, 6);
  check('no redaction block was baked, because nothing was found to bake', block === 0, block + ' rows');

  /* SITE 1 — content/capture.js. Graded off state.meta, which is what the
     ENGINE reported; pages/result.js cannot influence a byte of it. */
  const scan = state.meta.piiScan;
  gradeScanLedger('canvasredact', scan);
  check('canvasredact: the detector was handed nothing that occupies space',
    !!scan && scan.placed === 0, JSON.stringify({ fed: q(scan,'fed'), placed: q(scan,'placed') }));
  check('canvasredact: no box was emitted', !!scan && scan.boxes === 0, String(scan && scan.boxes));
  check('canvasredact: and nothing was declined, so "no text" is not "text we skipped"',
    q(scan,'declined.total') === 0, JSON.stringify(q(scan,'declined')));
  /* The inline <style> and <script> are still here, and they are still the
     reason this fixture exists — but the claim no longer turns on a tag list.
     §4.3: FS_NON_TEXT_TAGS is now an OPTIMISATION. Its count is reported so the
     saving is auditable, and deleting it tomorrow would change the runtime and
     not the state: both leaves are display:none with a 0x0 rect, so they fail
     the placement measurement at clause 2 whether or not the tag gate ran. */
  check('canvasredact: the tag gate is reported as the cost saving it now is',
    !!scan && scan.nonText === 2, String(scan && scan.nonText));

  /* SITE 2 — pages/result.js. Graded off the shot record, which is what the AI
     hand-off, history and every future consumer read. */
  gradeRequested('canvasredact', rec, true);
  /* 0 / 0 / 0 IS A FACT ABOUT THE READING and says nothing about the picture —
     which is the whole reduction. The old record called this
     `no-coverable-text` and mapped it to a verdict; there is no verdict now, so
     the page that paints its glyphs is simply a page where the detector matched
     nothing. */
  check('canvasredact: the acts are 0 / 0 / 0, stated and not summarised',
    q(rec,'redaction.acts.matched') === 0 && q(rec,'redaction.acts.painted') === 0 &&
    q(rec,'redaction.acts.verifiedOpaque') === 0 &&
    q(rec,'redaction.acts.ledger') === 'present',
    JSON.stringify(q(rec,'redaction.acts')));

  /* THE USER-FACING HALF. Metadata protects the next machine; this protects the
     person about to attach the image to an email. §3.4 retires the old sentence
     outright: "this page draws its text as a picture" is an INFERENCE ABOUT THE
     PAGE, which is exactly what this design stops making. The new one is about
     the act — what FullShot could read, and what it therefore did not hide. */
  const lines = String((out && out.lines || []).join(' '));
  check('the user is TOLD what the reading found, on the page, permanently',
    /matched nothing in the text it read/i.test(lines), JSON.stringify(out && out.lines));
  check('...and the product no longer claims to know how the page drew its text',
    !/text as a picture/i.test(lines) && !/(^|[.!?]\s+)this page\b/i.test(lines), lines);
  check('...and the sentence does not promise the image is safe',
    !/\b(safe|clean|protected|sanitis|sanitiz|secure)\b/i.test(lines), lines);
  /* NO TOAST. The place a person is stopped is the review dialog, and it is
     spent on exactly one action — handing the image to a machine. An alarm on
     every capture is wallpaper within a week and then protects nobody. */
  check('canvasredact: and it is not spent as a toast on every capture',
    toasts.length === 0, JSON.stringify(toasts));
}


/* ====== scenarios: the placement ledger, one clause each (v1.10.3) ======
   REDACTION-CLAIM-SPEC.md §2.2 clauses 1-6, §2.3(b), §5.4, §4.5.

   READ §6.3 BEFORE TRUSTING ANY OF THESE. In a fake DOM the fixture's text and
   the fixture's rect are two fields of the same object literal, written by the
   same author on the same line, so a check that compares text against geometry
   is comparing that author's assumption with itself and CAN NEVER DISAGREE.
   None of the five scenarios below proves that a clause detects anything in a
   real browser. What they prove is the half a browser cannot conveniently
   prove: that each clause has its own counter, that the counter is the one the
   state function reads, and that the state and the sentence move when it does.
   The layout half is test/e2e/ E13-E16, owned by another agent, deliberately
   written from the spec rather than from this file. */
const LG = { body: [214, 218, 226], text: [120, 130, 150], block: [17, 17, 17] };
function ledgerBase(PAGE_H) {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });
  body._base.contentH = () => PAGE_H;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;
  const render = () => {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      fillRect(img, 0, vy, VP_W, 1, (win.scrollY + vy) < PAGE_H ? LG.body : WHITE);
    }
    return img;
  };
  return { dpr, doc, html, body, win, render, bannerH: 0, refs: {} };
}
/* A visible, correctly-laid-out leaf: the "honest" span every one of these
   fixtures needs, because a page with NO placed span lands in
   `no-coverable-text` and would grade the wrong arm. */
function ledgerLeaf(parent, doc, win, y, text, style) {
  const el = parent.appendChild(new El('div', doc, { clientH: 40, clientW: 600 }));
  el.textContent = text;
  if (style) el.setAttribute('style', style);
  el._rect = () => ({ left: 40, top: y - win.scrollY, width: 600, height: 40 });
  return el;
}

/* (1) sr-only: the §7.3 escape walking through the POSITIVE arm. One 1x1
   clipped span holding an email, on a page whose only other text is clean.
   Under the first draft this reached `blocks-painted` — the STRONGEST state in
   the product — with "FullShot covered 1 place in this image", because every
   clause of bakeOk was satisfied: a box was emitted, painted and read back
   opaque. It was opaque over a 1x1 rect. */
function buildSrOnlyRedact() {
  const s = ledgerBase(1400);
  ledgerLeaf(s.body, s.doc, s.win, 200, 'Quarterly summary for the north region');
  const sr = s.body.appendChild(new El('span', s.doc, { clientH: 1, clientW: 1 }));
  /* The whole leaf is the token, so the emitted box is the whole 1x1 rect and
     the bake really does paint and verify it. That is the point: every clause
     of bakeOk is satisfied — handed 1, painted 1, verified opaque in the
     finished canvas — and the ONLY thing standing between this page and
     "FullShot covered 1 place in this image" is boxesFromUnplaced. */
  sr.textContent = 'jane.doe@example.com';
  sr.setAttribute('style', 'font-size:16px');
  sr._rect = () => ({ left: 0, top: 0 - s.win.scrollY, width: 1, height: 1 });
  return Object.assign(s, { name: 'sronlyredact' });
}
function expectSrOnlyRedact(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  gradeScanLedger('sronly', scan);
  check('sronly: both spans were fed to the detector', !!scan && scan.fed === 2, String(scan && scan.fed));
  check('sronly: one of them does not fit the text the DOM says is in it',
    q(scan,'unplaced.fontMismatch') === 1 && q(scan,'placed') === 1,
    JSON.stringify({ placed: q(scan,'placed'), unplaced: q(scan,'unplaced') }));
  check('sronly: the match came from a span FullShot cannot see, and the ledger says so',
    q(scan,'matched') === 1 && q(scan,'boxesFromUnplaced') === 1,
    JSON.stringify({ matched: q(scan,'matched'), bfu: q(scan,'boxesFromUnplaced') }));
  /* OVER-MASKING IS SAFE: the box is still emitted, still painted, still read
     back opaque out of the finished canvas — bakeOk is fully satisfied. This is
     graded explicitly, because if the box quietly stopped being emitted the
     state below would still be right and boxesFromUnplaced would stop being the
     thing that made it right (tooth #9 would then bite nothing). */
  gradeActs('sronly', rec, 1, scan, segs);
  gradeRequested('sronly', rec, true);
  /* THE CLAIM IS GONE, SO THIS FIXTURE IS UNINTERESTING — and that is the
     result, not a gap. Under the old design an sr-only email carried the whole
     capture to the strongest state in the product; now the record says one
     match, one block, one read back opaque, and the person is shown the image.
     What is still graded is that OVER-MASKING SURVIVED: the block is painted
     over the 1x1 rect, because covering a rect costs nothing and the opposite
     mistake costs the user their data. */
  check('sronly: the box is still emitted and still painted — over-masking is the safe direction',
    q(rec,'redaction.acts.painted') === 1 && q(scan,'boxesFromUnplaced') === 1,
    JSON.stringify({ painted: q(rec,'redaction.acts.painted'), bfu: q(scan,'boxesFromUnplaced') }));
  check('sronly: and no sentence anywhere tells the reader the image is clean',
    !!out && !/\b(safe|clean|secure|protected)\b/i.test(String((out.lines || []).join(' '))),
    JSON.stringify(out && out.lines));
}

/* (2) ancestor clipping and ancestor opacity — §7.1 B and C, the two families
   clause 4 alone was advertised as covering and does not: a leaf's own rect
   ignores ancestor clipping, and its own computed visibility ignores ancestor
   opacity, so both leaves below are full-size, 16px and perfectly consistent
   with themselves. */
function buildClipRedact() {
  const s = ledgerBase(1400);
  ledgerLeaf(s.body, s.doc, s.win, 200, 'Quarterly summary for the north region');
  const accordion = s.body.appendChild(new El('div', s.doc, { clientH: 0, clientW: 600 }));
  accordion.setAttribute('style', 'height:0px;overflow:hidden');
  accordion._rect = () => ({ left: 40, top: 400 - s.win.scrollY, width: 600, height: 0 });
  ledgerLeaf(accordion, s.doc, s.win, 400, 'Billing jane.doe@example.com');
  const faded = s.body.appendChild(new El('div', s.doc, { clientH: 40, clientW: 600 }));
  faded.setAttribute('style', 'opacity:0');
  faded._rect = () => ({ left: 40, top: 600 - s.win.scrollY, width: 600, height: 40 });
  ledgerLeaf(faded, s.doc, s.win, 600, 'Call +1 (555) 123-4567 today');
  return Object.assign(s, { name: 'clipredact' });
}
function expectClipRedact(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  gradeScanLedger('clip', scan);
  check('clip: the collapsed accordion\'s leaf is unplaced for CLIPPING, not for its own rect',
    q(scan,'unplaced.clipped') === 1, JSON.stringify(q(scan,'unplaced')));
  check('clip: the opacity:0 subtree\'s leaf is unplaced for FADING',
    q(scan,'unplaced.faded') === 1, JSON.stringify(q(scan,'unplaced')));
  check('clip: exactly one span was placed', !!scan && scan.placed === 1, String(scan && scan.placed));
  gradeRequested('clip', rec, true);
  /* Both refused leaves carry a match, and OVER-MASKING IS THE SAFE DIRECTION:
     the boxes are emitted anyway and painted anyway, because covering a rect
     the page says is invisible costs nothing and the opposite mistake costs the
     user their data. What has changed is that this no longer produces a
     verdict about it — 2 / 2 / 2, and the person looks at the picture. */
  check('clip: a match inside a refused span is still covered, and still not a claim',
    q(rec,'redaction.acts.matched') === 2 && q(rec,'redaction.acts.painted') === 2 &&
    q(scan,'boxesFromUnplaced') === 2 && q(rec,'redaction.acts.ledger') === 'present',
    JSON.stringify(q(rec,'redaction.acts')));
}

/* (3) the over-long leaf — §4.5's text/plain document, in the only form a fake
   DOM can hold it. The refusal increments AT THE REFUSAL and breaks scanOk. */
function buildDeclineRedact() {
  const s = ledgerBase(1400);
  ledgerLeaf(s.body, s.doc, s.win, 200, 'Quarterly summary for the north region');
  const pre = s.body.appendChild(new El('pre', s.doc, { clientH: 400, clientW: 600 }));
  pre.textContent = 'log line ' + 'x'.repeat(4200);
  pre._rect = () => ({ left: 40, top: 400 - s.win.scrollY, width: 600, height: 400 });
  return Object.assign(s, { name: 'declineredact' });
}
function expectDeclineRedact(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  gradeScanLedger('decline', scan);
  check('decline: the over-long leaf is counted at the refusal',
    q(scan,'declined.tooLong') === 1 && q(scan,'declined.total') === 1,
    JSON.stringify(q(scan,'declined')));
  check('decline: and the characters it covered are counted too, so the blind spot has a size',
    q(scan,'declinedChars') > 4000, String(scan && scan.declinedChars));
  check('decline: the span was NOT also counted as fed', !!scan && scan.fed === 1, String(scan && scan.fed));
  gradeRequested('decline', rec, true);
  /* NO SEVERITY, AND NO TOAST FOR ANYTHING. Severity split the unproven states
     by volume, and the states are gone; the alarm went with them. What is left
     is the same permanent line every capture gets. */
  check('decline: no toast is raised, on this or on any capture',
    !!out && out.toasts.length === 0, JSON.stringify(out && out.toasts));
  check('decline: and the permanent line reports the counts, not a grade',
    !!out && /matched/i.test(String((out.lines || []).join(' '))) &&
    !/could not finish/i.test(String((out.lines || []).join(' '))),
    JSON.stringify(out && out.lines));
  /* THE REFUSAL REACHES THE PERSON. It was counted at the refusal from the
     first version of this ledger and then read by nobody: the record said
     "0 matched, 0 painted, 0 confirmed opaque" over a page whose largest text
     node was never handed to the detector. The count of refused leaves is its
     own field, in its own unit, and the line states it — separately from
     "we stopped early", which did not happen here. */
  check('decline: the leaf whose text it refused to read is stated on the line, in leaves',
    q(rec, 'redaction.acts.textRefused') === 1 &&
    q(rec, 'redaction.acts.matchedComplete') === false &&
    /did not read: 1/.test(String((out.lines || []).join(' '))),
    JSON.stringify({ acts: q(rec, 'redaction.acts'), lines: out && out.lines }));
}

/* (4) the door that is not locked — §5.4 / §7.1 A. The capture pipeline GROWS a
   same-origin iframe to its full content height (capture.js:531) so its pixels
   are certainly in the image, and collectPIIBoxes walks document.body only.
   Counting the doors is what stops the outer nav bar carrying the whole capture
   to `read-no-match`. */
function buildFrameRedact() {
  const s = ledgerBase(1400);
  ledgerLeaf(s.body, s.doc, s.win, 100, 'Dashboard — north region');
  const idoc = new Doc();
  const ihtml = new El('html', idoc, { clientH: 600, clientW: 800 });
  const ibody = new El('body', idoc, { clientW: 800 });
  idoc.documentElement = ihtml; idoc.body = ibody; ihtml.appendChild(ibody);
  const inner = ibody.appendChild(new El('div', idoc, { clientH: 40, clientW: 600 }));
  inner.textContent = 'Statement for jane.doe@example.com';
  const fr = s.body.appendChild(new El('iframe', s.doc, { clientH: 600, clientW: 800 }));
  fr._contentDoc = idoc;
  fr._rect = () => ({ left: 40, top: 300 - s.win.scrollY, width: 800, height: 600 });
  return Object.assign(s, { name: 'frameredact' });
}
function expectFrameRedact(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  gradeScanLedger('frame', scan);
  check('frame: the same-origin door is counted', q(scan,'frames.sameOrigin') === 1,
    JSON.stringify(q(scan,'frames')));
  check('frame: and it is honestly reported as unopened', q(scan,'frames.scanned') === 0,
    JSON.stringify(q(scan,'frames')));
  /* The whole point: the shell's own nav text IS placed, so under the first
     draft this reached read-no-match -> pixels "baked" with the email visible
     in the PNG. It must not. */
  check('frame: the shell\'s own text was read and matched nothing',
    q(scan,'placed') >= 1 && q(scan,'matched') === 0,
    JSON.stringify({ placed: q(scan,'placed'), matched: q(scan,'matched') }));
  gradeRequested('frame', rec, true);
  /* THE DOOR IS STILL COUNTED — the ledger still records an unwalked
     same-origin frame — but it no longer feeds a verdict, because there is no
     verdict. What the reader gets is 0 matched over a page with an unread
     frame in it, and the image in front of them. */
  check('frame: the unwalked same-origin door is still counted in the scan ledger',
    q(scan,'frames.sameOrigin') === 1 && q(scan,'frames.scanned') === 0,
    JSON.stringify(q(scan,'frames')));
}

/* (5) deferred rendering — §2.3(b) / §7.1 D. A section that reports 0x0 when
   the scan measures it and is painted into the picture during the scroll loop.
   Without the re-measure this is `read-no-match` -> `baked` over a visible SSN. */
function buildLateTextRedact() {
  const s = ledgerBase(1400);
  ledgerLeaf(s.body, s.doc, s.win, 100, 'Quarterly summary for the north region');
  const lazy = s.body.appendChild(new El('div', s.doc, { clientH: 0, clientW: 600 }));
  lazy.textContent = 'SSN 123-45-6789 on file';
  lazy.setAttribute('style', 'font-size:16px');
  /* 0x0 while the scan runs; realised while the frames are being grabbed,
     exactly as content-visibility:auto does. Keyed off the FRAME COUNT rather
     than a timer or a scroll event, because the pre-scan pipeline
     (expandInner, waitStable, unrollVirtual) scrolls too — the section has to
     still be 0x0 at the moment collectPIIBoxes measures it, and the first frame
     is the earliest point that is guaranteed to be after that. */
  s.refs.frames = 0;
  const baseRender = s.render;
  s.render = () => { s.refs.frames++; return baseRender(); };
  lazy._rect = () => s.refs.frames >= 2
    ? { left: 40, top: 600 - s.win.scrollY, width: 600, height: 40 }
    : { left: 0, top: 0, width: 0, height: 0 };
  return Object.assign(s, { name: 'latetextredact' });
}
function expectLateTextRedact(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  gradeScanLedger('latetext', scan);
  check('latetext: the deferred section was 0x0 when it was measured',
    q(scan,'unplaced.degenerate') === 1, JSON.stringify(q(scan,'unplaced')));
  check('latetext: the re-measure after the last frame found it, and found the SSN in it',
    q(scan,'lateMatched') === 1, JSON.stringify({ lm: q(scan,'lateMatched'), lt: q(scan,'lateTextPlaced') }));
  gradeRequested('latetext', rec, true);
  /* The re-measure still runs and still books what it found; it simply no
     longer feeds a verdict. lateMatched is the fact, and the person looking at
     the image is the oracle. */
  check('latetext: the second measurement is still made and still recorded',
    q(scan,'lateMatched') === 1 && q(rec,'redaction.acts.ledger') === 'present',
    JSON.stringify({ lm: q(scan,'lateMatched'), acts: q(rec,'redaction.acts') }));
}

/* ===== scenario: A WRAPPED TOKEN CANCELS A REAL SHORTFALL (s36, v1.10.2) =====
   THE CASE THE WHOLE DESIGN EXISTS TO SURFACE, HIDDEN BY AN UNRELATED LINE WRAP.

   `matched` counts DETECTOR MATCHES. A box is one CLIENT RECT, and a token that
   wraps across a line has two. Every counter that subtracted a box count from a
   match count therefore read one too many covered on ordinary markup, and the
   surplus paid for a genuine miss somewhere else on the page:

     a card number wrapping to two lines   1 match  -> 2 boxes, both painted
     an email FullShot could not place     1 match  -> 0 boxes, never painted
     ------------------------------------------------------------------------
     matched 2 · boxes 2 · painted 2 · verified 2

   Both of §3.4's alarm conditions (`painted < matched`, `verifiedOpaque <
   painted`) are false, the flat line renders, and the email is legible in the
   delivered image. Drop the wrap and the same page reports 1/0/0 and fires
   correctly, which is what makes this a UNIT error and not a detection one.

   The email is unplaceable the way `sr-only` text is: a sub-pixel rect. The
   detector finds it — `matched` counts it — and no rect survives the width test,
   so `matchedNoBox` is 1 and there is nothing over it in the picture. */
const WC = { body: [214, 218, 226], block: [17, 17, 17] };
function buildWrapCancel() {
  const s = ledgerBase(1400);
  ledgerLeaf(s.body, s.doc, s.win, 100, 'Quarterly summary for the north region');
  /* THE WRAP. 'Card 4242 4242 4242 4242' broken after char 12, so the card
     token [5,24) straddles the break and getClientRects returns TWO rects —
     the shape a real browser produces for any token that meets a line end. */
  const card = ledgerLeaf(s.body, s.doc, s.win, 400, 'Card 4242 4242 4242 4242');
  card._wrapAt = [12];
  /* THE MISS. A 0.5x0.5 rect: the detector reads the email out of the text,
     and every rect it could draw over it is narrower than a pixel, so no box
     is emitted at all. */
  const hidden = s.body.appendChild(new El('span', s.doc, { clientH: 1, clientW: 1 }));
  hidden.textContent = 'Billing jane.doe@example.com';
  hidden.setAttribute('style', 'font-size:16px');
  hidden._rect = () => ({ left: 0, top: 800 - s.win.scrollY, width: 0.5, height: 0.5 });
  return Object.assign(s, { name: 'wrapcancel' });
}
function expectWrapCancel(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  const line = String((out && out.lines || []).join(' '));
  gradeScanLedger('wrapcancel', scan);
  /* The fixture's own premise, pinned first: without the wrap and without the
     miss the rest of this scenario grades nothing. */
  check('wrapcancel: two matches, and ONE of them emitted two boxes',
    q(scan,'matched') === 2 && q(scan,'boxes') === 2 && q(scan,'matchedNoBox') === 1,
    JSON.stringify({ matched: q(scan,'matched'), boxes: q(scan,'boxes'),
                     noBox: q(scan,'matchedNoBox') }));
  gradeRequested('wrapcancel', rec, true);
  /* THE UNITS. Two boxes came from one match, so the match count and the block
     count are DIFFERENT NUMBERS, and the acts carry the match one. */
  gradeActs('wrapcancel', rec, { matches: 1, blocks: 2 }, scan, segs);
  check('wrapcancel: a match that wrapped is ONE match covered, not two',
    q(rec,'redaction.acts.matched') === 2 && q(rec,'redaction.acts.painted') === 1 &&
    q(rec,'redaction.acts.verifiedOpaque') === 1,
    JSON.stringify(q(rec,'redaction.acts')));
  /* THE FAIL-FIRST. The one sentence in this design that means something. */
  check('wrapcancel: the uncovered match is REPORTED, not cancelled by the wrap',
    /1 match is not covered in this image/.test(line), line || '(no line)');
  check('wrapcancel: ...as a subtraction of two counts in the same unit',
    /Redaction matched 2 and covered 1\./.test(line), line || '(no line)');
  check('wrapcancel: and the flat "all three agree" line is NOT what renders',
    !/2 matched, 2 painted, 2 confirmed opaque/.test(line), line || '(no line)');
  check('wrapcancel: nothing on the line tells the reader the image is clean',
    !/\b(safe|clean|secure|protected)\b/i.test(line), line || '(no line)');
}

/* ===== scenario: ONE LINE OF A WRAPPED TOKEN GOES UNREAD (s38, v1.10.2) =====
   HALF A CARD NUMBER IS A CARD NUMBER.

   A match is covered only if EVERY block it produced was covered. The tempting
   relaxation is "at least one" — it makes the counters look better on exactly
   the pages where they should look worse — and the difference between the two
   rules is invisible until a match's blocks DISAGREE, which is what this page
   arranges.

   A card number wraps inside a very tall line box. `getClientRects` returns the
   tail of line one (narrow) and the head of line two (full width), and the
   second is large enough to exceed the read-back's per-box area budget
   (FS_VERIFY_MAX_PX), so it is painted and then refused rather than sampled —
   the product's own "refuse, do not degrade" arm. One block read back opaque,
   one block never read: the match is NOT covered, and saying otherwise would be
   a claim about pixels nobody looked at. */
function buildWrapUnread() {
  const s = ledgerBase(8000);
  ledgerLeaf(s.body, s.doc, s.win, 100, 'Quarterly summary for the north region');
  const card = s.body.appendChild(new El('div', s.doc, { clientH: 6400, clientW: VP_W }));
  card.textContent = 'Card 4242 4242 4242 4242';
  card.setAttribute('style', 'font-size:16px');
  /* Two lines of 3200: [0,7) and [7,24). The token is [5,24), so line one
     carries two characters of it and line two carries seventeen — one narrow
     block and one full-width one, both 3200 tall. */
  card._wrapAt = [7];
  card._rect = () => ({ left: 0, top: 400 - s.win.scrollY, width: VP_W, height: 6400 });
  return Object.assign(s, { name: 'wrapunread' });
}
function expectWrapUnread(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  const line = String((out && out.lines || []).join(' '));
  gradeScanLedger('wrapunread', scan);
  check('wrapunread: one match, two blocks, and they are different sizes',
    q(scan,'matched') === 1 && q(scan,'boxes') === 2 &&
    (state.meta.piiBoxes || []).length === 2 &&
    state.meta.piiBoxes[0].w !== state.meta.piiBoxes[1].w,
    JSON.stringify({ matched: q(scan,'matched'), boxes: q(scan,'boxes'),
                     w: (state.meta.piiBoxes || []).map(b => b.w) }));
  check('wrapunread: both blocks are painted, and exactly one is read back',
    q(rec,'redaction.marks.length') === 1, JSON.stringify(q(rec,'redaction.marks')));
  /* THE RULE. All of a match's blocks, or the match is not covered. */
  check('wrapunread: a match with one unread block is NOT a covered match',
    q(rec,'redaction.acts.matched') === 1 && q(rec,'redaction.acts.painted') === 1 &&
    q(rec,'redaction.acts.verifiedOpaque') === 0,
    JSON.stringify(q(rec,'redaction.acts')));
  check('wrapunread: and the line says so as a subtraction',
    /Redaction matched 1 and covered 0\./.test(line) &&
    /1 match is not covered in this image/.test(line), line || '(no line)');
  /* THE REASON, BESIDE THE SUBTRACTION. The shortfall says a match is not
     covered; it cannot say why, and the four reasons are four different
     situations. Here the block was drawn and then REFUSED by the read-back's
     area budget — "we did not look", which is not the same as "we looked and it
     was not covered" — and the counter that says so is in the block unit. */
  check('wrapunread: …and the block it drew and did not read back is stated, not left to be inferred',
    q(rec, 'redaction.acts.blocksUnread') === 1 &&
    /did not read back: 1/.test(line), line || '(no line)');
}

/* ===== scenario: A MATCH WHOSE BLOCKS STRADDLE THE BOX CEILING (s39) ========
   INCOMPLETENESS COMPUTED AND THEN THROWN AWAY — the shape all nine rounds of
   this feature's bugs share, in the one place the previous round's own fix
   could not see.

   `rollUpMatches` grades a match against the blocks that were EMITTED. The box
   ceiling (FS_PII_MAX_BOXES) stops emission MID-MATCH: a token that wraps over
   the ceiling has some of its rectangles pushed and the rest dropped by a
   `break`, and the dropped ones never reach the roll-up. Every block the
   roll-up can see was painted and read back opaque, so the match is graded
   COVERED — over an image in which the tail of that number is legible.

   The rule is not wrong. Its INPUT is silently partial, which is why patching
   the rule was never going to help: a match must be graded against the blocks
   it PRODUCED, and the production count has to travel with the block.

   The fixture is the smallest page that does it. One ordinary email, entirely
   inside the ceiling, so the fix cannot buy its correctness by declaring
   everything uncovered. Then one phone number 2,200 characters long — legal
   under the detector's own pattern, which bounds the DIGITS and not the
   separators — laid out one character per line inside a very tall block, so
   `getClientRects` returns 2,200 rectangles for ONE match and the ceiling
   falls in the middle of them. */
const CS = { body: [214, 218, 226], block: [17, 17, 17] };
const CS_LINES = 2200;                        // client rects the long match produces
const CS_EMITTED = 1999;                      // …of which the ceiling admits these
const CS_LOST = CS_LINES - CS_EMITTED;        // 201 blocks produced and never emitted
function buildCeilingStraddle() {
  const s = ledgerBase(5600);
  /* (a) THE HONEST MATCH. One leaf, one line, one block, well inside the
     ceiling: it must still be counted as covered afterwards. */
  ledgerLeaf(s.body, s.doc, s.win, 100, 'Billing jane.doe@example.com');
  /* (b) THE STRADDLER. `+1 555 123 4567` followed by 2,184 dots and a final
     digit: twelve digits (the validator's ceiling is fifteen) and 2,200
     characters, so the phone pattern matches the whole run as ONE token. */
  const many = s.body.appendChild(new El('div', s.doc, { clientH: 4400, clientW: 600 }));
  many.textContent = '+1 555 123 4567' + '.'.repeat(CS_LINES - 16) + '7';
  many.setAttribute('style', 'font-size:16px');
  /* One cut per character: 2,200 lines of one character each, in a 4,400 px
     tall box, so every line is a 600x2 rect — comfortably a block, and not one
     of them is dropped for being degenerate. */
  many._wrapAt = Array.from({ length: CS_LINES - 1 }, (_, i) => i + 1);
  many._rect = () => ({ left: 40, top: 400 - s.win.scrollY, width: 600, height: 4400 });
  return Object.assign(s, { name: 'ceilingstraddle' });
}
function expectCeilingStraddle(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  const line = String((out && out.lines || []).join(' '));
  gradeScanLedger('ceilingstraddle', scan);
  /* The fixture's own premise, pinned first: without the straddle the rest of
     this scenario grades nothing. */
  check('ceilingstraddle: two matches, and the second one alone produced more blocks than the ceiling admits',
    q(scan, 'matched') === 2 && q(scan, 'boxes') === 2000 &&
    (state.meta.piiBoxes || []).length === 2000 && q(scan, 'truncated.ceiling') === true,
    JSON.stringify({ matched: q(scan, 'matched'), boxes: q(scan, 'boxes'),
                     ceiling: q(scan, 'truncated.ceiling') }));
  /* THE FACT THAT USED TO BE COMPUTED AND DROPPED: how many blocks a match
     produced and never got to emit. Recorded at the `break` that drops them. */
  check('ceilingstraddle: the blocks the ceiling dropped are counted at the drop',
    q(scan, 'blocksLost') === CS_LOST && q(scan, 'matchesTruncated') === 1,
    JSON.stringify({ lost: q(scan, 'blocksLost'), truncated: q(scan, 'matchesTruncated') }));
  gradeRequested('ceilingstraddle', rec, true);
  /* THE FAIL-FIRST. A match whose later blocks were never drawn is not a
     covered match, however solid the blocks that survived the ceiling are. */
  check('ceilingstraddle: a match the ceiling cut in half is NOT a covered match',
    q(rec, 'redaction.acts.matched') === 2 && q(rec, 'redaction.acts.painted') === 1 &&
    q(rec, 'redaction.acts.verifiedOpaque') === 1,
    JSON.stringify(q(rec, 'redaction.acts')));
  /* …and the loss reaches the record, in the unit it happened in. */
  check('ceilingstraddle: the record carries the lost blocks as blocks, never as matches',
    q(rec, 'redaction.acts.blocksLost') === CS_LOST,
    JSON.stringify(q(rec, 'redaction.acts')));
  check('ceilingstraddle: and the count of matches is itself marked partial',
    q(rec, 'redaction.acts.matchedComplete') === false,
    JSON.stringify(q(rec, 'redaction.acts.matchedComplete')));
  /* THE SURFACE. Two sentences, and both have to be there: the subtraction the
     reader acts on, and the fact that FullShot ran out of room. */
  check('ceilingstraddle: the uncovered match is REPORTED as a subtraction',
    /Redaction matched 2 and covered 1\./.test(line) &&
    /1 match is not covered in this image/.test(line), line || '(no line)');
  check('ceilingstraddle: …and the blocks it never drew are stated, not left to be inferred',
    new RegExp('did not draw: ' + CS_LOST).test(line), line || '(no line)');
  check('ceilingstraddle: …and it says it stopped short',
    /did not finish walking/.test(line), line || '(no line)');
  check('ceilingstraddle: and the flat "all three agree" line is NOT what renders',
    !/2 matched, 2 painted, 2 confirmed opaque/.test(line), line || '(no line)');
  check('ceilingstraddle: nothing on the line tells the reader the image is clean',
    !/\b(safe|clean|secure|protected)\b/i.test(line), line || '(no line)');
}

/* ===== scenario: THE WALK STOPS MID-PAGE (s40) ==============================
   The same class at the other end of the pipeline. `forEachDeep` gives up at
   40,000 elements, and everything below that point is text the detector was
   never handed — so `matched` is not the number of matches on the page, it is
   the number of matches in the part of the page the walk reached.

   A COUNT WITHOUT ITS COMPLETENESS IS NOT A COUNT. The truncation was already
   recorded (`walkComplete`, `truncatedBy`) and the sentence already said the
   walk stopped, but nothing marked the COUNTERS themselves as partial: a
   consumer reading `acts.matched` — which AI-HANDOFF-ENVELOPE.md §5 invites
   them to subtract from — got a whole-looking number.

   The page carries a card number the walk reaches and an email 40,000 elements
   below it that it never does. The email's colour is still in the delivered
   image, which is what makes the partial count a fact rather than a flag. */
const WB = { body: [214, 218, 226], miss: [255, 90, 90], block: [17, 17, 17] };
function buildWalkBudget() {
  const s = ledgerBase(2400);
  ledgerLeaf(s.body, s.doc, s.win, 100, 'Card 4242 4242 4242 4242');
  /* The element budget, in the cheapest shape that reaches it: 40,010 empty
     divs. They hold no text, so the redaction walk does no work per element
     beyond the one the budget counts. */
  for (let i = 0; i < 40010; i++) s.body.appendChild(new El('div', s.doc, { clientH: 0, clientW: 0 }));
  ledgerLeaf(s.body, s.doc, s.win, 1200, 'Billing jane.doe@example.com');
  const base = s.render;
  s.render = () => {
    const img = base();
    fillRect(img, 40, 1200 - s.win.scrollY, 600, 40, WB.miss);
    return img;
  };
  return Object.assign(s, { name: 'walkbudget' });
}
function expectWalkBudget(seg, state, segs, out) {
  const scan = state.meta.piiScan, rec = (out && out.record) || {};
  const line = String((out && out.lines || []).join(' '));
  gradeScanLedger('walkbudget', scan);
  check('walkbudget: the walk ran out of elements before the foot of the page',
    q(scan, 'truncated.walk') === true && q(scan, 'matched') === 1 && q(scan, 'fed') === 1,
    JSON.stringify({ truncated: q(scan, 'truncated'), matched: q(scan, 'matched'), fed: q(scan, 'fed') }));
  gradeRequested('walkbudget', rec, true);
  /* THE PROOF THAT THE COUNT IS PARTIAL: the text the walk never reached is
     still in the picture, with nothing over it. */
  const leaked = countRowsWithColor(seg, 300, 0, seg.h, WB.miss, 6);
  check('walkbudget: the text below the cut is in the delivered image, uncovered',
    leaked >= 30, leaked + ' rows');
  /* THE FAIL-FIRST. The walk's truncation must reach the counters, not only the
     walk fields — a reader subtracting `matched` from anything is subtracting a
     number that stopped early. */
  check('walkbudget: `matched` is marked as a partial count',
    q(rec, 'redaction.acts.matchedComplete') === false &&
    q(rec, 'redaction.acts.matched') === 1,
    JSON.stringify(q(rec, 'redaction.acts')));
  check('walkbudget: …and the walk fields still name the budget that stopped it',
    q(rec, 'redaction.acts.walkComplete') === false &&
    q(rec, 'redaction.acts.truncatedBy') === 'elements',
    JSON.stringify(q(rec, 'redaction.acts')));
  check('walkbudget: …and the sentence a person reads says it stopped short',
    /did not finish walking/.test(line), line || '(no line)');
  check('walkbudget: nothing on the line tells the reader the image is clean',
    !/\b(safe|clean|secure|protected)\b/i.test(line), line || '(no line)');
}

/* ===== scenario: AN IMPOSSIBLE SUBTRACTION RENDERS NOTHING (s37, v1.10.2) =====
   The same unit error with the sign reversed, and it is the reason a guard has
   to survive the fix rather than be made unreachable by it.

   Reported from a real browser on an `sr-only` page: matched 3, painted 6,
   verified 5. `verifiedOpaque < painted` opened the shortfall arm, the arm
   computed `max(0, 3 - 5) = 0`, and the product printed

     "Redaction matched 3 and covered 5. 0 matches are not covered in this image."

   Covered above matched, a shortfall of zero, on the one line the design
   reserves for a real subtraction — and a reasonable person reads "0 not
   covered" as "this is clean". §0.1 forbids that sentence "however it is
   computed", and this one was computed.

   The record here is SEEDED, not stitched, because after the units are fixed
   the live pipeline can no longer produce these numbers — covered counts a
   subset of matched. What can still produce them, permanently, is pages/db.js's
   §4 lift of a v2 ledger, which reads BLOCK counters into the match-unit fields
   because those records predate any per-match identity. So the arithmetic is
   graded where it will actually arrive. */
function seededShotRecord(acts) {
  const w = 8, h = 8;
  const blob = { __w: w, __h: h, __data: Buffer.alloc(w * h * 4, 0xff), size: w * h * 4 };
  return {
    id: 'sim-seeded', title: 'Seeded record', url: 'https://example.com/',
    createdAt: 1600000000000, mode: 'full', w, h, format: 'png',
    breakYs: null, outScale: 1, segments: [{ blob, w, h }], thumb: blob,
    meta: { piiCount: 0 }, captureSettings: { redactPII: true },
    redaction: { v: 3, requested: true, acts, kinds: { email: 3 }, marks: [] }
  };
}
async function runImpossibleActs() {
  if (process.env.FS_ONLY && !process.env.FS_ONLY.split(',').includes('impossibleacts')) return;
  console.log('\n=== impossibleacts ===');
  const rec = seededShotRecord({ v: 3, matched: 3, painted: 6, verifiedOpaque: 5,
                                 walkComplete: true, truncatedBy: null, ledger: 'partial' });
  const out = await stitchWithRealResultJs(
    { id: rec.id, mode: 'full', meta: {}, settings: { imageFormat: 'png', redactPII: true } },
    [], { shots: [rec] });
  const line = String((out.lines || []).join(' '));
  check('impossibleacts: the page rendered the seeded record, not a fresh stitch',
    !!out.record && out.record.id === rec.id, JSON.stringify(out.record && out.record.id));
  /* THE FAIL-FIRST. A shortfall that is zero or negative is not a smaller
     alarm, it is an arithmetic impossibility, and the honest rendering of one
     is silence. */
  check('impossibleacts: no shortfall sentence is rendered at all',
    !/not covered in this image/.test(line), line || '(no line)');
  check('impossibleacts: and certainly not a shortfall of zero',
    !/\b0 match(es)? (is|are) not covered/.test(line), line || '(no line)');
  check('impossibleacts: what renders is the three counts, unsummarised',
    /3 matched, 6 painted, 5 confirmed opaque/.test(line), line || '(no line)');
  check('impossibleacts: and no sentence claims a covered count above the matched one',
    !/covered 5/.test(line), line || '(no line)');
}

/* ===== THE SAME RECORD, ON THE HISTORY PAGE (v1.10.2) =====================
   HISTORY IS THE THIRD SURFACE, AND IT WAS RENDERING ONE VARIANT OUT OF FOUR.

   §2.2 replaces the history verdict badge with "the acts line, shown for every
   record where `requested !== false`", and §3.4 defines FOUR sentences, not
   one. pages/history.js rendered the flat three-count line for every record it
   showed at all: a capture with an uncovered match fired the alarm on the
   result page and showed `Redaction on. 2 matched, 1 painted, 1 confirmed
   opaque` on its history card — the same numbers, arranged so that nobody has
   to read them, with the one sentence in this design that means something
   simply absent.

   That matters more on this page than on the result page, not less. History is
   where a person picks an OLD screenshot to share, days later, with no memory
   of what was on the page: the moment the shortfall line is most needed and
   least likely to be remembered. A user who checks history was being handed
   reassurance the result page would never have given them.

   GRADED BY RENDERING BOTH PAGES OVER ONE RECORD. Each fixture below is fed to
   the real pages/result.js and the real pages/history.js, and the sentence is
   compared. Two copies of a selection table is how the last round produced a
   dialog that bolded on one rule while the sentence chose on another, and a
   check that only asserted "history says something about redaction" would have
   passed on the flat line. What is compared is the STRING; the layout is not,
   because a card is a smaller thing than a page and is entitled to look
   different. It is not entitled to leave out the alarm. */
const HISTORY_VARIANTS = [
  { name: 'covered',    acts: { matched: 3, painted: 3, verifiedOpaque: 3, walkComplete: true,  truncatedBy: null, ledger: 'present' },
    want: /Redaction on\. 3 matched, 3 painted, 3 confirmed opaque in this image\./,
    not:  /not covered in this image|matched nothing/ },
  { name: 'shortfall1', acts: { matched: 2, painted: 1, verifiedOpaque: 1, walkComplete: true,  truncatedBy: null, ledger: 'present' },
    want: /Redaction matched 2 and covered 1\. 1 match is not covered in this image\./,
    not:  /Redaction on\./ },
  { name: 'shortfall3', acts: { matched: 5, painted: 2, verifiedOpaque: 2, walkComplete: true,  truncatedBy: null, ledger: 'present' },
    want: /Redaction matched 5 and covered 2\. 3 matches are not covered in this image\./,
    not:  /Redaction on\./ },
  { name: 'nomatch',    acts: { matched: 0, painted: 0, verifiedOpaque: 0, walkComplete: true,  truncatedBy: null, ledger: 'present' },
    want: /Redaction matched nothing in the text it read and painted no blocks\./,
    not:  /Redaction on\.|not covered in this image/ },
  { name: 'truncated',  acts: { matched: 1, painted: 1, verifiedOpaque: 1, walkComplete: false, truncatedBy: 'time', ledger: 'present' },
    want: /FullShot did not finish walking this page\./,
    not:  /not covered in this image/ },
  /* The alarm and the truncation compose: the walk sentence is APPENDED to
     whichever of the three arms rendered, never a fourth arm of its own. */
  { name: 'shortcut',   acts: { matched: 2, painted: 0, verifiedOpaque: 0, walkComplete: false, truncatedBy: 'ceiling', ledger: 'present' },
    want: /2 matches are not covered in this image\. FullShot did not finish walking this page\./,
    not:  /Redaction on\./ },
  /* A lift out of a v2 record: `matched` crosses in its own unit, the two
     match-unit counters cannot be recovered at all. An em dash, never a zero —
     and no subtraction, because there is nothing honest to subtract. */
  { name: 'lifted',     acts: { matched: 3, painted: null, verifiedOpaque: null, walkComplete: null, truncatedBy: null, ledger: 'partial' },
    want: /Redaction on\. 3 matched, — painted, — confirmed opaque in this image\./,
    not:  /not covered in this image|\b0 painted/ },
  /* The impossible subtraction, on the other screen. Covered above matched
     renders the three counts and NOTHING else — §0.1 forbids "0 matches are
     not covered in this image" however it is computed, on either page. */
  { name: 'impossible', acts: { matched: 3, painted: 6, verifiedOpaque: 5, walkComplete: true,  truncatedBy: null, ledger: 'partial' },
    want: /Redaction on\. 3 matched, 6 painted, 5 confirmed opaque in this image\./,
    not:  /not covered in this image|covered 5/ },
  { name: 'absent',     requested: null,
    acts: { matched: null, painted: null, verifiedOpaque: null, walkComplete: null, truncatedBy: null, ledger: 'absent' },
    want: /This record carries no account of a redaction pass on this capture\./,
    not:  /Redaction on\.|not covered in this image/ },
  /* §4's third population: a record with no redaction block at all. The result
     page answers it with the no-ledger sentence; a history card that answered
     it with silence would be the one shape in the table where the two screens
     disagree by construction. */
  { name: 'noblock',    strip: true,
    want: /This record carries no account of a redaction pass on this capture\./,
    not:  /Redaction on\./ },
  /* §3.1: redaction positively off. FullShot made no claim, so it has nothing
     to walk back, and the honest rendering is no line — on both screens. */
  { name: 'off',        requested: false,
    acts: { matched: null, painted: null, verifiedOpaque: null, walkComplete: null, truncatedBy: null, ledger: 'absent' },
    want: null, not: /Redaction|redaction pass/ }
];

function historyFixture(v) {
  const rec = seededShotRecord(v.acts ? Object.assign({ v: 3 }, v.acts) : null);
  rec.id = 'sim-history-' + v.name;
  rec.title = 'Record ' + v.name;
  if (v.strip) delete rec.redaction;
  else if ('requested' in v) rec.redaction.requested = v.requested;
  return rec;
}

async function runHistoryActs() {
  if (process.env.FS_ONLY && !process.env.FS_ONLY.split(',').includes('historyacts')) return;
  console.log('\n=== historyacts ===');
  const recs = HISTORY_VARIANTS.map(historyFixture);
  const out = await renderHistoryWithRealHistoryJs(recs);
  check('historyacts: the page rendered one card per seeded record',
    out.cards.length === recs.length, out.cards.length + ' of ' + recs.length);
  if (out.cards.length !== recs.length) return;

  for (let i = 0; i < HISTORY_VARIANTS.length; i++) {
    const v = HISTORY_VARIANTS[i], card = out.cards[i], acts = card.acts;
    if (v.want == null) {
      check('historyacts [' + v.name + ']: the card says nothing about redaction at all',
        acts == null && !v.not.test(card.text), JSON.stringify(acts != null ? acts : card.text));
    } else {
      check('historyacts [' + v.name + ']: the card renders its own variant',
        acts != null && v.want.test(acts), JSON.stringify(acts != null ? acts : card.text));
      check('historyacts [' + v.name + ']: ...and not one of the other three',
        acts != null && !v.not.test(acts), JSON.stringify(acts));
    }
  }

  /* THE ANTI-DRIFT CHECK, and the reason the two harnesses exist side by side.
     The same record, rendered by the real result.js and the real history.js,
     has to produce the SAME SENTENCE. Nothing else can catch a fifth variant
     added to one page and not the other, which is exactly the shape of the
     defect this section was written for. */
  for (let i = 0; i < HISTORY_VARIANTS.length; i++) {
    const v = HISTORY_VARIANTS[i], rec = recs[i];
    const r = await stitchWithRealResultJs(
      { id: rec.id, mode: 'full', meta: {}, settings: { imageFormat: 'png', redactPII: true } },
      [], { shots: [rec] });
    const resultLine = String((r.lines || []).join(' ')).replace(/\s+/g, ' ').trim();
    const historyLine = String(out.cards[i].acts == null ? '' : out.cards[i].acts).replace(/\s+/g, ' ').trim();
    check('historyacts [' + v.name + ']: history says exactly what the result page says',
      historyLine === resultLine,
      'result: ' + JSON.stringify(resultLine) + ' | history: ' + JSON.stringify(historyLine));
  }

  /* §0.1 on the surface it was never graded on. No word a reasonable person
     reads as "this image is safe to share", however it got there. */
  const blob = out.cards.map(c => c.text).join(' ');
  check('historyacts: no verdict vocabulary anywhere in the grid',
    !/\b(safe|clean|secure|protected|sanitis|sanitiz)\w*\b/i.test(blob),
    (blob.match(/\b(safe|clean|secure|protected)\w*\b/ig) || []).join(',') || 'none');
  check('historyacts: and no sentence about the captured page',
    !/(^|[.!?]\s+)this page\b/i.test(blob), blob.slice(0, 160));
  /* A badge is a verdict with the words taken out (§2.2), and it was shown for
     exactly the states the old design graded as bad. Nothing on a card may rank
     one record above another. */
  /* Spelled, never pasted: a literal glyph in a source file is invisible to
     grep and survives a copy-paste that mangles it. */
  const GLYPHS = new RegExp('[\\u2713\\u2714\\u2705\\u26A0\\u{1F512}\\u{1F6E1}]', 'u');
  check('historyacts: no tick, shield, padlock or warning glyph on any card',
    !GLYPHS.test(blob), blob.slice(0, 160));

  /* ---- the rest of the surface, read rather than rendered ----------------
     A behavioural check can only grade the records it was handed. These three
     grade what the page is CAPABLE of saying, which is the half that survives
     a fixture list nobody updated.

     Comments stripped first: this file's own note about the deleted badge names
     the deleted things, and a check that cannot tell a live reference from a
     note about its removal grades prose. */
  const hjs = stripJsComments(fs.readFileSync(path.join(ROOT, 'pages', 'history.js'), 'utf8'));
  const dead = ['pixels', 'severity', 'evidence', 'fsRedactionState', 'fsRedactClause',
                'redaction.state', 'redaction.scan', 'redaction.bake'];
  const alive = dead.filter(n => hjs.indexOf(n) >= 0);
  check('historyacts: history.js reads none of the fields §2.2 removed',
    alive.length === 0, alive.join(',') || dead.length + ' names gone');
  check('historyacts: and no glyph is spent anywhere in its source',
    !GLYPHS.test(hjs), (hjs.match(GLYPHS) || []).join(''));
  /* THE VERDICT ONE STYLESHEET AWAY. The acts line is found by a class, and a
     rule that gave it a colour, a weight or a border would be the deleted badge
     rendered in CSS — shown for exactly the records the old design graded as
     bad. §0.1 forbids that "however it is computed", and a stylesheet computes. */
  const hcss = fs.readFileSync(path.join(ROOT, 'pages', 'history.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const painted = (hcss.match(/\.redactline[^{}]*\{[^}]*\}/g) || [])
    .filter(r => /color|font-weight|border|background|outline/.test(r));
  check('historyacts: no stylesheet rule paints the acts line differently from any other',
    painted.length === 0, painted.join(' | ') || 'the class is a hook, not a style');
}

/* ========== scenario: auto-redact PII inside an app-shell PANE (v1.9.4) ========== */
/* Extends v1.7.0 auto-redaction to inner-scroll app-shell panes (Gmail/Slack/
   dashboard style): the PII lives inside an overflow:auto PANE, not the document.
   Before v1.9.4 collectPIIBoxes returned [] for a pane (root.isDoc===false) and
   the bake was guarded to doc captures, so PII inside a pane leaked through the
   unrolled shot. Now the boxes are collected in PANE-CONTENT space (mirroring
   collectBreakHints) and the stitcher bakes them at pane.dx/dy + b*k. The card
   and the Luhn-invalid decoy sit deep in the pane (reached only by scrolling it),
   so this also proves a box lands in the UNROLLED pane, not the as-seen slice. */
const PR = {
  header: [70, 50, 100],    // shell top chrome (kept once)
  body:   [214, 218, 224],  // pane background
  email:  [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255],
  decoy:  [245, 205, 45], block: [17, 17, 17]
};
function buildPaneRedact() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const HEADER_H = 64, PANE_H = VP_H - HEADER_H, PANE_CONTENT_H = 1800;
  const header = body.appendChild(new El('header', doc, { clientH: HEADER_H, clientW: VP_W }));
  const pane = body.appendChild(new El('main', doc, { clientH: PANE_H, clientW: VP_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 0, top: HEADER_H - win.scrollY, width: VP_W, height: PANE_H });
  const paneContent = pane.appendChild(new El('div', doc, { clientW: VP_W }));
  paneContent._base.contentH = () => PANE_CONTENT_H;

  body._base.contentH = () => HEADER_H + pane.clientHeight;   // the document itself does not scroll
  html._base.contentH = () => body.clientHeight;

  // PII leaf elements at pane-CONTENT positions (cy). email + phone are in the
  // first pane view; card + decoy are deep (reached only by scrolling the pane).
  const items = [
    { cy: 150,  h: 40, color: PR.email, text: 'Email: jane.doe@example.com',  pii: true },
    { cy: 560,  h: 40, color: PR.phone, text: 'Call +1 (555) 123-4567 today', pii: true },
    { cy: 1080, h: 40, color: PR.card,  text: 'Card 4242 4242 4242 4242',     pii: true },
    { cy: 1500, h: 40, color: PR.decoy, text: 'Order 1234 5678 9012 3456',    pii: false }
  ];
  for (const it of items) {
    const el = paneContent.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.textContent = it.text;
    el._rect = () => ({ left: 40, top: (HEADER_H - win.scrollY) + it.cy - pane.scrollTop, width: 600, height: it.h });
    it.el = el;
  }
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = HEADER_H - win.scrollY;
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const row = Math.floor(pane.scrollTop + (dy - paneTop));
      if (row < 0 || row >= PANE_CONTENT_H) { fillRect(img, 0, dy, VP_W, 1, WHITE); continue; }
      fillRect(img, 0, dy, VP_W, 1, PR.body);                    // pane background, full width
      for (const it of items) {                                  // item colour confined to its rect [40,640]
        if (row >= it.cy && row < it.cy + it.h) { fillRect(img, 40, dy, 600, 1, it.color); break; }
      }
    }
    fillRect(img, 0, -win.scrollY, VP_W, HEADER_H, PR.header);   // shell chrome, top (kept once)
    return img;
  }
  return { name: 'paneredact', doc, html, body, win, render, dpr, bannerH: 0, refs: { pane }, items };
}
function expectPaneRedact(seg, state, segs, out) {
  /* standing regression — see the banner above gradeScanLedger */
  gradeScanLedger('paneredact', state.meta.piiScan);
  gradeActs('paneredact', (out && out.record) || {}, 3, state.meta.piiScan, segs);
  gradeRequested('paneredact', (out && out.record) || {}, true);
  check('paneredact: the honest case gets the counts on the page and no toast at all',
    !!out && /matched, \d+ painted, \d+ confirmed opaque/i.test(String((out.lines || []).join(' '))) &&
    out.toasts.length === 0,
    JSON.stringify({ lines: out && out.lines, toasts: out && out.toasts }));
  check('rootRect present (app-shell pane capture)', !!state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  const x = 300;   // inside the 40..640 element band
  for (const [nm, color] of [['email', PR.email], ['phone', PR.phone], ['card', PR.card]]) {
    const leak = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check('pane ' + nm + ' pixels redacted (0 of its colour visible)', leak === 0, leak + ' rows leaked');
  }
  const block = countRowsWithColor(seg, x, 0, seg.h, PR.block, 6);
  check('pane redaction blocks baked over the 3 sensitive items (~132 rows)', Math.abs(block - 132) <= 12, block + ' rows');
  const decoy = countRowsWithColor(seg, x, 0, seg.h, PR.decoy, 6);
  check('pane Luhn-invalid decoy left un-redacted (~40 rows)', Math.abs(decoy - 40) <= 6, decoy + ' rows');
  check('meta.piiBoxes reported exactly 3 sensitive items (pane-content space)',
    !!state.meta.piiBoxes && state.meta.piiBoxes.length === 3,
    state.meta.piiBoxes ? state.meta.piiBoxes.length + ' boxes' : 'none');
  const hdr = countRowsWithColor(seg, x, 0, seg.h, PR.header);
  check('shell header chrome kept once (~64 rows)', Math.abs(hdr - 64) <= 4, hdr + ' rows');
}

/* ========== scenario: auto-redact PII inside a fixed SIDE RAIL (v1.9.5) ========== */
/* Extends v1.9.4 pane redaction to the LAST coordinate frame: a fixed side rail
   (Reddit-style left nav) captured by the side pass (cap.meta.sidePanes). Before
   v1.9.5 collectPIIBoxes scanned rail leaves in DOC-PAGE space and the bake used
   the doc offset, so with the rail scrolled (rail.scrollTop=450) the block landed
   450px off and the rail PII LEAKED through the unrolled rail column. Now rail
   leaves are collected in that rail's CONTENT space (mirroring the pane branch),
   tagged with the rail index, and the stitcher bakes them at sideDraw[i].dx/dy +
   b*k. card + decoy sit DEEP in the rail (reached only by scrolling it), so this
   also proves a box lands in the UNROLLED rail, not the as-seen slice. */
const RR = {
  body:   [220, 224, 228],   // main story column (no PII)
  railbg: [176, 184, 196],   // rail background
  email:  [255, 90, 90], phone: [90, 200, 120], card: [90, 130, 255],
  decoy:  [245, 205, 45], block: [17, 17, 17]
};
function buildRailRedact() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const MAIN_H = 1900, RAIL_TOP = 0, RAIL_H = 600, RAIL_CONTENT_H = 1800;
  const RAIL_W = 300, IT_L = 20, IT_W = 260;

  // main story column (no PII) dictates the canvas height so the rail unrolls fully
  body._base.contentH = () => MAIN_H;
  html._base.contentH = () => body.clientHeight;

  // fixed left rail (Reddit left nav): fixed wrapper + inner scroller
  const railWrap = body.appendChild(new El('div', doc, { clientH: RAIL_H, clientW: RAIL_W }));
  railWrap.id = 'railWrap';
  railWrap.setAttribute('style', 'position:fixed;left:0;top:0');
  railWrap._rect = () => ({ left: 0, top: RAIL_TOP, width: RAIL_W, height: RAIL_H });
  const rail = railWrap.appendChild(new El('div', doc, { clientH: RAIL_H, clientW: RAIL_W, contentH: RAIL_CONTENT_H }));
  rail.id = 'rail';
  rail.setAttribute('style', 'overflow-y:auto;height:' + RAIL_H + 'px');
  rail._rect = () => ({ left: 0, top: RAIL_TOP, width: RAIL_W, height: RAIL_H });

  // PII leaves at rail-CONTENT positions (cy). email + phone are in the first rail
  // view; card + decoy are DEEP (reached only by scrolling the rail).
  const items = [
    { cy: 120,  h: 40, color: RR.email, text: 'Email: jane.doe@example.com',  pii: true },
    { cy: 520,  h: 40, color: RR.phone, text: 'Call +1 (555) 123-4567 today', pii: true },
    { cy: 1080, h: 40, color: RR.card,  text: 'Card 4242 4242 4242 4242',     pii: true },
    { cy: 1500, h: 40, color: RR.decoy, text: 'Order 1234 5678 9012 3456',    pii: false }
  ];
  for (const it of items) {
    const el = rail.appendChild(new El('div', doc, { clientH: it.h, clientW: IT_W }));
    el.textContent = it.text;
    el._rect = () => ({ left: IT_L, top: RAIL_TOP + (it.cy - rail.scrollTop), width: IT_W, height: it.h });
    it.el = el;
  }

  rail.scrollTop = 450;   // user had scrolled the rail — makes doc-space coords WRONG
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    // main story column (no PII), beside the rail
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < MAIN_H) fillRect(img, 340, vy, VP_W - 340, 1, RR.body);
    }
    // fixed rail overlay (viewport-anchored), honors hide/unhide state
    if (!hiddenNow(rail)) {
      for (let vy = RAIL_TOP; vy < RAIL_TOP + RAIL_H; vy++) {
        const nr = rail.scrollTop + (vy - RAIL_TOP);   // rail content-y
        if (nr < 0 || nr >= RAIL_CONTENT_H) continue;
        fillRect(img, 0, vy, RAIL_W, 1, RR.railbg);
        for (const it of items) {
          if (nr >= it.cy && nr < it.cy + it.h) { fillRect(img, IT_L, vy, IT_W, 1, it.color); break; }
        }
      }
    }
    return img;
  }
  return { name: 'railredact', doc, html, body, win, render, dpr, bannerH: 0, refs: { rail }, items };
}
function expectRailRedact(seg, state, segs, out) {
  /* standing regression — see the banner above gradeScanLedger */
  gradeScanLedger('railredact', state.meta.piiScan);
  gradeActs('railredact', (out && out.record) || {}, 3, state.meta.piiScan, segs);
  gradeRequested('railredact', (out && out.record) || {}, true);
  check('railredact: the honest case gets the counts on the page and no toast at all',
    !!out && /matched, \d+ painted, \d+ confirmed opaque/i.test(String((out.lines || []).join(' '))) &&
    out.toasts.length === 0,
    JSON.stringify({ lines: out && out.lines, toasts: out && out.toasts }));
  check('side pass ran on a DOC capture (fixed rail found)',
    !!(state.meta.sidePanes && state.meta.sidePanes.length === 1 && state.meta.sidePanes[0].x === 0),
    JSON.stringify(state.meta.sidePanes));
  const x = 150;   // inside the rail column (0..300) and the item band (20..280)
  for (const [nm, color] of [['email', RR.email], ['phone', RR.phone], ['card', RR.card]]) {
    const leak = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check('rail ' + nm + ' pixels redacted (0 of its colour visible)', leak === 0, leak + ' rows leaked');
  }
  const block = countRowsWithColor(seg, x, 0, seg.h, RR.block, 6);
  check('rail redaction blocks baked over the 3 sensitive items (~132 rows)', Math.abs(block - 132) <= 12, block + ' rows');
  const decoy = countRowsWithColor(seg, x, 0, seg.h, RR.decoy, 6);
  check('rail Luhn-invalid decoy left un-redacted (~40 rows)', Math.abs(decoy - 40) <= 6, decoy + ' rows');
  check('meta.piiBoxes reported exactly 3 sensitive items (rail-content space, pane-tagged)',
    !!state.meta.piiBoxes && state.meta.piiBoxes.length === 3 &&
    state.meta.piiBoxes.every(b => b.pane === 0),
    state.meta.piiBoxes ? JSON.stringify(state.meta.piiBoxes.map(b => b.pane)) : 'none');
}

/* ========== scenario: token-PRECISE auto-redaction via Range.getClientRects (v1.9.6) ========== */
/* v1.7.0-1.9.5 redacted the whole LEAF element whose text contained PII. v1.9.6
   covers only the matched TOKEN's rect (Range.getClientRects on the [start,end)
   char span), and every token in a leaf (not just the first kind) -- so a label
   like "Contact <email> now" keeps "Contact"/"now" visible and only the address
   is blacked out, and "mail <email> or call <phone>" redacts BOTH with the "or
   call" gap intact. Modelled with a uniform char-width (rect.width / text len).
   Fail-first: on the whole-leaf code the prefix/suffix/gap are covered too. */
const TK = {
  body:  [222, 226, 230],
  pre:   [120, 170, 255], emailA: [255, 90, 90],  suf:  [80, 200, 140],   // leaf A: prefix | email(PII) | suffix
  bpre:  [200, 160, 60],  emailB: [255, 140, 140], gap:  [60, 200, 200],  // leaf B: prefix | email(PII) | gap(visible) |
  phoneB:[250, 180, 40],  bsuf:   [170, 110, 200],                        //          phone(PII) | suffix
  decoy: [245, 205, 45],  block:  [17, 17, 17]
};
function buildTokenRedact() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  const PAGE_H = 1200, LEFT = 40, LW = 640;
  // each leaf: y, text, and colour segments as [charStart, charEnd, colour].
  // The PII token char-ranges MUST match what capture.js's detectors find.
  const leaves = [
    { y: 200, text: 'Contact jane.doe@example.com now',
      segs: [[0, 8, TK.pre], [8, 28, TK.emailA], [28, 32, TK.suf]] },              // email at [8,28)
    { y: 500, text: 'mail a.b@c.io or call 555-123-4567 end',
      segs: [[0, 5, TK.bpre], [5, 13, TK.emailB], [13, 22, TK.gap],
             [22, 34, TK.phoneB], [34, 38, TK.bsuf]] },                            // email [5,13), phone [22,34)
    { y: 800, text: 'Order 1234 5678 9012 3456',
      segs: [[0, 25, TK.decoy]] }                                                  // Luhn-invalid -> no match
  ];
  for (const lf of leaves) {
    const el = body.appendChild(new El('div', doc, { clientH: 40, clientW: LW }));
    el.textContent = lf.text;
    el._rect = () => ({ left: LEFT, top: lf.y - win.scrollY, width: LW, height: 40 });
    lf.cw = LW / lf.text.length;
  }
  body._base.contentH = () => PAGE_H;
  html._base.contentH = () => body.clientHeight;
  win.scrollY = 0;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < PAGE_H) fillRect(img, 0, vy, VP_W, 1, TK.body);
    }
    for (const lf of leaves) {
      const vy = lf.y - win.scrollY;
      for (const [cs, ce, col] of lf.segs) {
        fillRect(img, LEFT + cs * lf.cw, vy, (ce - cs) * lf.cw, 40, col);
      }
    }
    return img;
  }
  return { name: 'tokenredact', doc, html, body, win, render, dpr, bannerH: 0, refs: {}, leaves };
}
function expectTokenRedact(seg, state, segs, out) {
  /* standing regression — see the banner above gradeScanLedger */
  gradeScanLedger('tokenredact', state.meta.piiScan);
  /* THREE MATCHES ACROSS TWO LEAVES, and the fixture declares it here rather
     than agreeing with whatever the code counted. `matched` is counted ONCE PER
     MATCH (§2.1): leaf B holds an email and a phone, so a per-LEAF count reads
     2 and a per-MATCH count reads 3. The difference only shows up on a fixture
     with two matches in one leaf, which is why this one carries the assertion —
     everywhere else the two spellings are indistinguishable. */
  check('tokenredact: matched counts MATCHES, not leaves (2 leaves, 3 matches)',
    q(state.meta.piiScan, 'matched') === 3, String(q(state.meta.piiScan, 'matched')));
  gradeActs('tokenredact', (out && out.record) || {}, 3, state.meta.piiScan, segs);
  gradeRequested('tokenredact', (out && out.record) || {}, true);
  check('tokenredact: the honest case gets the counts on the page and no toast at all',
    !!out && /matched, \d+ painted, \d+ confirmed opaque/i.test(String((out.lines || []).join(' '))) &&
    out.toasts.length === 0,
    JSON.stringify({ lines: out && out.lines, toasts: out && out.toasts }));
  const vis = (nm, x, color) => {
    const n = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check('token-precise: ' + nm + ' left VISIBLE (~40 rows)', Math.abs(n - 40) <= 6, n + ' rows');
  };
  const gone = (nm, x, color) => {
    const n = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check('token-precise: ' + nm + ' redacted (0 of its colour visible)', n === 0, n + ' rows leaked');
  };
  // Leaf A: only the email token is covered; the "Contact" prefix + " now" suffix stay.
  vis('leaf A prefix', 120, TK.pre);
  gone('leaf A email token', 400, TK.emailA);
  vis('leaf A suffix', 640, TK.suf);
  // Leaf B: BOTH tokens covered; the "or call" gap between them stays.
  gone('leaf B email token', 190, TK.emailB);
  vis('leaf B gap ("or call")', 330, TK.gap);
  gone('leaf B phone token', 510, TK.phoneB);
  // Decoy: Luhn-invalid -> untouched.
  const decoy = countRowsWithColor(seg, 300, 0, seg.h, TK.decoy, 6);
  check('Luhn-invalid decoy left un-redacted (~40 rows)', Math.abs(decoy - 40) <= 6, decoy + ' rows');
  // one box per TOKEN (leaf A email + leaf B email + leaf B phone = 3), not per leaf.
  check('meta.piiBoxes = 3 token rects (leaf A email + leaf B email + leaf B phone)',
    !!state.meta.piiBoxes && state.meta.piiBoxes.length === 3,
    state.meta.piiBoxes ? state.meta.piiBoxes.length + ' boxes' : 'none');
}

/* ========== scenario: auto-redact PII inside an INLINE-UNROLLED virtual list (v1.9.8) ========== */
/* The LAST redaction coordinate frame. v1.6.1 inline-unrolls an embedded
   virtualized list at its mid-page slot (growing the canvas there, pushing the
   rest of the page down); v1.7.0-1.9.6 redaction covered doc + pane + rail +
   token-precision, but pages/result.js SKIPPED the whole opaque-block bake
   whenever inlineRegions was set (the `!inlineRegions` guard) -- so PII inside an
   unrolled list, AND any plain-doc PII sharing the page, LEAKED. v1.9.8:
   collectPIIBoxes records each list's leaves in that list's CONTENT space tagged
   `inline:i` (and EXCLUDES them from the doc walk, like rails), the stitcher bakes
   them at inlineDraw[i].finalTop + b*k, and a plain doc box below the slot shifts
   down through the growth (mirroring the breakYs section-top remap). email sits in
   the list's first window, the card sits DEEP (only reached by unrolling the
   list), the decoy is Luhn-invalid, and a phone in DOC space BELOW the list must
   move down by exactly the slot growth. A tall doc tail keeps the DOCUMENT the
   scroll root (so the list stays an embedded inline slot, not the main pane). */
const IR = {
  header: [60, 40, 150],     // page header above the list
  listbg: [235, 238, 245],   // virtualized-list background
  belowbg: [200, 205, 212],  // document content below the list
  email: [255, 90, 90], card: [90, 130, 255], phone: [90, 200, 120],
  decoy: [245, 205, 45], block: [17, 17, 17]
};
const IR_HEADER = 120, IR_VIEW = 600, IR_OVER = 60, IR_TOTAL = 4000, IR_BELOW = 2000;
const IR_EMAIL_CY = 200, IR_CARD_CY = 3000, IR_PHONE_BY = 120;
function buildInlineRedact() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: IR_HEADER, clientW: VP_W }));  // page header

  const vlist = body.appendChild(new El('div', doc, { clientH: IR_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:600px');
  vlist._rect = () => ({ left: 0, top: IR_HEADER - win.scrollY, width: VP_W, height: IR_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: IR_TOTAL, clientW: VP_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');

  // PII leaves INSIDE the list, positioned absolutely at list-CONTENT y (cy).
  // email is in the first window; the card sits DEEP (only reached by unrolling
  // the list); the decoy is Luhn-invalid. Their live rect tracks the list scroll,
  // so collectPIIBoxes must record them in scroll-invariant list-content space.
  const listItems = [
    { cy: IR_EMAIL_CY, h: 40, color: IR.email, text: 'Email: jane.doe@example.com',  pii: true },
    { cy: 800,         h: 40, color: IR.decoy, text: 'Order 1234 5678 9012 3456',    pii: false },
    { cy: IR_CARD_CY,  h: 40, color: IR.card,  text: 'Card 4242 4242 4242 4242',     pii: true }
  ];
  for (const it of listItems) {
    const el = sizer.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.setAttribute('style', 'position:absolute');
    el.textContent = it.text;
    el._rect = () => ({ left: 40, top: (IR_HEADER - win.scrollY) + it.cy - vlist.scrollTop, width: 600, height: it.h });
    it.el = el;
  }

  // Document content BELOW the list, holding a phone PII leaf in DOC space, plus
  // a tall filler tail. The list unrolls from IR_VIEW to IR_TOTAL, so everything
  // below shifts down by the growth -- the box must land at the SHIFTED position,
  // not the compact one. The tail also keeps docRange >= list-range/2 so the
  // DOCUMENT wins findScrollRoot (the list stays an inline slot, not the pane).
  const below = body.appendChild(new El('div', doc, { clientH: IR_BELOW, clientW: VP_W }));
  const belowTop = IR_HEADER + IR_VIEW;   // compact-layout doc-Y where below-content starts
  const belowItems = [
    { by: IR_PHONE_BY, h: 40, color: IR.phone, text: 'Call +1 (555) 123-4567 today', pii: true }
  ];
  for (const it of belowItems) {
    const el = below.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.textContent = it.text;
    el._rect = () => ({ left: 40, top: (belowTop + it.by) - win.scrollY, width: 600, height: it.h });
    it.el = el;
  }

  body._base.contentH = () => IR_HEADER + vlist.clientHeight + IR_BELOW;
  html._base.contentH = () => body.clientHeight;

  vlist.scrollTop = 300;   // user scrolled the list -- proves content-space is scroll-invariant + restore
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - IR_OVER &&
                         cr < vlist.scrollTop + IR_VIEW + IR_OVER &&
                         cr >= 0 && cr < IR_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const boxH = vlist.clientHeight;          // 600 unless (wrongly) grown
    const belowY = IR_HEADER + boxH;
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 0) continue;
      if (row < IR_HEADER) { fillRect(img, 0, vy, VP_W, 1, IR.header); continue; }
      if (row < belowY) {                      // inside the virtualized list box
        const cr = vlist.scrollTop + (row - IR_HEADER);
        fillRect(img, 0, vy, VP_W, 1, IR.listbg);
        if (realized(cr)) {
          for (const it of listItems) {
            if (cr >= it.cy && cr < it.cy + it.h) { fillRect(img, 40, vy, 600, 1, it.color); break; }
          }
        }
        continue;
      }
      const br = row - belowY;                 // offset into below-document content
      if (br < IR_BELOW) {
        fillRect(img, 0, vy, VP_W, 1, IR.belowbg);
        for (const it of belowItems) {
          if (br >= it.by && br < it.by + it.h) { fillRect(img, 40, vy, 600, 1, it.color); break; }
        }
      }
    }
    return img;
  }
  return { name: 'inlineredact', doc, html, body, win, render, dpr, bannerH: 0, refs: { vlist }, listItems, belowItems };
}
function expectInlineRedact(seg, state, segs, out) {
  /* standing regression — see the banner above gradeScanLedger */
  gradeScanLedger('inlineredact', state.meta.piiScan);
  gradeActs('inlineredact', (out && out.record) || {}, 3, state.meta.piiScan, segs);
  gradeRequested('inlineredact', (out && out.record) || {}, true);
  check('inlineredact: the honest case gets the counts on the page and no toast at all',
    !!out && /matched, \d+ painted, \d+ confirmed opaque/i.test(String((out.lines || []).join(' '))) &&
    out.toasts.length === 0,
    JSON.stringify({ lines: out && out.lines, toasts: out && out.toasts }));
  const EXP_H = IR_HEADER + IR_TOTAL + IR_BELOW;   // 120 + 4000 + 2000 = 6120
  const x = 300;                                   // inside the 40..640 item band + each PII token
  check('single part, embedded list unrolled inline (height ~' + EXP_H + ')',
    segs.length === 1 && Math.abs(seg.h - EXP_H) <= 4, segs.map(s => s.h).join('+'));
  check('embedded virtual list flagged inline (meta.inlinePanes length 1)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1), JSON.stringify(state.meta.inlinePanes));
  for (const [nm, color] of [['email (list first window)', IR.email], ['card (list DEEP)', IR.card], ['phone (doc below)', IR.phone]]) {
    const leak = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check(nm + ' pixels redacted (0 of its colour visible)', leak === 0, leak + ' rows leaked');
  }
  const block = countRowsWithColor(seg, x, 0, seg.h, IR.block, 6);
  check('redaction blocks baked over the 3 sensitive items (~132 rows)', Math.abs(block - 132) <= 12, block + ' rows');
  const decoy = countRowsWithColor(seg, x, 0, seg.h, IR.decoy, 6);
  check('Luhn-invalid decoy (inside list) left un-redacted (~40 rows)', Math.abs(decoy - 40) <= 6, decoy + ' rows');
  // positions: email + card baked at the unrolled slot; phone shifted by the growth.
  const emailY = IR_HEADER + IR_EMAIL_CY;
  check('email block AT the unrolled slot position (y' + emailY + ')',
    countRowsWithColor(seg, x, emailY - 4, emailY + 44, IR.block, 6) >= 36, 'near email');
  const cardY = IR_HEADER + IR_CARD_CY;
  check('card block AT the DEEP unrolled position (y' + cardY + ')',
    countRowsWithColor(seg, x, cardY - 4, cardY + 44, IR.block, 6) >= 36, 'near card');
  const phoneY = IR_HEADER + IR_TOTAL + IR_PHONE_BY;   // belowTop shifted down by the growth
  check('phone block SHIFTED DOWN by the slot growth (y' + phoneY + ')',
    countRowsWithColor(seg, x, phoneY - 4, phoneY + 44, IR.block, 6) >= 36, 'near shifted phone');
  check('meta.piiBoxes = 3 sensitive (2 inline-tagged list + 1 doc)',
    !!state.meta.piiBoxes && state.meta.piiBoxes.length === 3 &&
    state.meta.piiBoxes.filter(b => b.inline != null).length === 2 &&
    state.meta.piiBoxes.filter(b => b.inline == null).length === 1,
    state.meta.piiBoxes ? JSON.stringify(state.meta.piiBoxes.map(b => ({ inline: b.inline, y: b.y }))) : 'none');
}

/* ========== scenario: inline-unroll virtual list CONCURRENT with a fixed side rail (v1.9.9) ========== */
/* v1.6.1 inline-unrolls an embedded mid-page virtual list, but pages/result.js
   guarded that path with `!sideDraw` -- so a doc page that ALSO has a fixed side
   rail (Reddit-style left nav, captured by the v1.5.0 side pass) fell back to
   as-rendered: the embedded list was NOT unrolled and its deep content never made
   the shot. Rails draw as an INDEPENDENT column (their own frames, clipped to the
   canvas height, painted last), so inline growth of the doc column and rail unroll
   don't interact -- the guard was over-conservative. v1.9.9 lifts it. This fixture
   has BOTH: a fixed left rail with a DEEP marker (only reached by scrolling the
   rail) and an embedded virtualized list with a DEEP sentinel (only reached by
   unrolling the list); a tall article tail keeps the DOCUMENT the scroll root. */
const RI = {
  header: [60, 40, 150], listbg: [235, 238, 245],
  row: i => (i % 2 ? [120, 180, 230] : [80, 150, 200]),
  deep: [255, 120, 0],                              // list bottom sentinel
  article: i => [190 - (i % 5) * 8, 110, 70 + (i % 5) * 8],
  bottom: [0, 180, 120],
  railbg: [176, 184, 196], raildeep: [255, 70, 200] // rail deep marker
};
const RI_HEADER = 120, RI_VIEW = 600, RI_OVER = 60, RI_TOTAL = 4000;
const RI_ARTICLE = 2000, RI_BOTTOM = 152, RI_ROWH = 40;
const RI_DEEP_FROM = RI_TOTAL - 200;                // 3800..4000 = list deep sentinel
const RAIL_H = 600, RAIL_CONTENT_H = 1800, RAIL_W = 300;
const RAIL_DEEP_CY = 1400;                          // rail marker only reached by scrolling the rail
function buildRailInline() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: RI_HEADER, clientW: VP_W }));   // page header

  // embedded virtualized list (react-window signature: tall sizer + absolute rows)
  const vlist = body.appendChild(new El('div', doc, { clientH: RI_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:600px');
  vlist._rect = () => ({ left: 0, top: RI_HEADER - win.scrollY, width: VP_W, height: RI_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: RI_TOTAL, clientW: VP_W }));
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((RI_VIEW + 2 * RI_OVER) / RI_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: RI_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');
  }

  const article = body.appendChild(new El('div', doc, { clientH: RI_ARTICLE, clientW: VP_W }));
  const bottom = body.appendChild(new El('div', doc, { clientH: RI_BOTTOM, clientW: VP_W }));

  // fixed left rail (Reddit left nav): fixed wrapper + inner scroller
  const railWrap = body.appendChild(new El('div', doc, { clientH: RAIL_H, clientW: RAIL_W }));
  railWrap.id = 'railWrap';
  railWrap.setAttribute('style', 'position:fixed;left:0;top:0');
  railWrap._rect = () => ({ left: 0, top: 0, width: RAIL_W, height: RAIL_H });
  const rail = railWrap.appendChild(new El('div', doc, { clientH: RAIL_H, clientW: RAIL_W, contentH: RAIL_CONTENT_H }));
  rail.id = 'rail';
  rail.setAttribute('style', 'overflow-y:auto;height:' + RAIL_H + 'px');
  rail._rect = () => ({ left: 0, top: 0, width: RAIL_W, height: RAIL_H });

  body._base.contentH = () => RI_HEADER + vlist.clientHeight + RI_ARTICLE + RI_BOTTOM;
  html._base.contentH = () => body.clientHeight;

  vlist.scrollTop = 300;   // user scrolled the list
  rail.scrollTop = 450;    // user scrolled the rail
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - RI_OVER &&
                         cr < vlist.scrollTop + RI_VIEW + RI_OVER &&
                         cr >= 0 && cr < RI_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const boxH = vlist.clientHeight;
    const artTop = RI_HEADER + boxH;
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 0) continue;
      if (row < RI_HEADER) { fillRect(img, 0, vy, VP_W, 1, RI.header); continue; }
      if (row < artTop) {                        // inside the virtualized list box
        const cr = vlist.scrollTop + (row - RI_HEADER);
        fillRect(img, 0, vy, VP_W, 1, RI.listbg);
        if (realized(cr)) {
          const col = cr >= RI_DEEP_FROM ? RI.deep : RI.row(Math.floor(cr / RI_ROWH));
          fillRect(img, 0, vy, VP_W, 1, col);
        }
        continue;
      }
      const ar = row - artTop;
      if (ar < RI_ARTICLE) fillRect(img, 0, vy, VP_W, 1, RI.article(Math.floor(ar / 100)));
      else if (ar < RI_ARTICLE + RI_BOTTOM) fillRect(img, 0, vy, VP_W, 1, RI.bottom);
    }
    // fixed rail overlay on the left (hidden after frame 0 via hideFixed)
    if (!hiddenNow(rail)) {
      for (let vy = 0; vy < RAIL_H; vy++) {
        const nr = rail.scrollTop + vy;            // rail content-y
        if (nr < 0 || nr >= RAIL_CONTENT_H) continue;
        const col = (nr >= RAIL_DEEP_CY && nr < RAIL_DEEP_CY + 40) ? RI.raildeep : RI.railbg;
        fillRect(img, 0, vy, RAIL_W, 1, col);
      }
    }
    return img;
  }
  return { name: 'railinline', doc, html, body, win, render, dpr, bannerH: 0, refs: { vlist, rail } };
}
function expectRailInline(seg, state, segs) {
  const EXP_H = RI_HEADER + RI_TOTAL + RI_ARTICLE + RI_BOTTOM;   // 120+4000+2000+152 = 6272
  const xL = 640;                                                // list/article column (clear of the rail)
  const xR = 150;                                                // inside the rail column (0..300)
  const slot = RI_HEADER;
  check('both frames captured (meta.inlinePanes=1 AND meta.sidePanes=1)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1 &&
       state.meta.sidePanes && state.meta.sidePanes.length === 1),
    'inline=' + JSON.stringify(state.meta.inlinePanes) + ' side=' + JSON.stringify(state.meta.sidePanes));
  check('page grown at the list slot despite the rail — single ' + EXP_H + 'px part',
    segs.length === 1 && Math.abs(seg.h - EXP_H) <= 4, segs.map(s => s.h).join('+'));
  check('list TOP window present inline (row 0 at slot top)',
    near(pxAt(seg, xL, slot + 20), RI.row(0)), pxAt(seg, xL, slot + 20).join(','));
  check('list MID content present inline (cr 3000 — beyond the visible window)',
    near(pxAt(seg, xL, slot + 3000), RI.row(Math.floor(3000 / RI_ROWH))), pxAt(seg, xL, slot + 3000).join(','));
  const deepY = slot + RI_DEEP_FROM + 40;
  check('list DEEP SENTINEL present inline (cr ' + (RI_DEEP_FROM + 40) + ' — only reached by unrolling)',
    near(pxAt(seg, xL, deepY), RI.deep), pxAt(seg, xL, deepY).join(','));
  const artY = slot + RI_TOTAL + 400;
  check('article shoved down below the unrolled list (present at y' + artY + ')',
    near(pxAt(seg, xL, artY), RI.article(4), 12), pxAt(seg, xL, artY).join(','));
  check('rail unrolled independently — DEEP rail marker present in its column (y~' + RAIL_DEEP_CY + ')',
    countRowsWithColor(seg, xR, RAIL_DEEP_CY - 4, RAIL_DEEP_CY + 44, RI.raildeep, 6) >= 36,
    'raildeep rows near ' + RAIL_DEEP_CY);
}

/* ===== scenario: very tall inline unroll crossing a canvas split (s29) ===== */
/* The embedded virtualized list unrolls so tall (17000px) that the grown canvas
   (29280px) exceeds the 16000px canvas edge, forcing a 2-PART split whose cut
   falls INSIDE the unrolled list. The straddling window frames + the deep
   sentinel must compose across the boundary: content above the cut lands in
   part 1, content below it in part 2, contiguous and once each — no gap, tear,
   or duplication. This is the "very tall unroll crossing a canvas split" edge. */
const TU = {
  header: [50, 40, 140],
  row: i => (i % 2 ? [120, 180, 230] : [80, 150, 200]),
  sizerBg: [235, 238, 245],
  deep: [255, 120, 0],                 // list bottom sentinel (only reached by unrolling)
  article: i => [190 - (i % 5) * 8, 110, 70 + (i % 5) * 8],
  bottom: [0, 180, 120]
};
const TU_HEADER = 120, TU_VIEW = 600, TU_OVER = 60, TU_TOTAL = 17000;
const TU_ARTICLE = 12000, TU_BOTTOM = 160, TU_ROWH = 40;  // tall doc tail: keeps the DOCUMENT the scroll root (docRange 12160 >= listRange/2=8200) so the list stays an INLINE slot, not the main pane
const TU_DEEP_FROM = TU_TOTAL - 200;   // 16800..17000 = the deep sentinel band

function buildTallUnroll() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('div', doc, { clientH: TU_HEADER, clientW: VP_W }));   // page header

  const vlist = body.appendChild(new El('div', doc, { clientH: TU_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:600px');
  vlist._rect = () => ({ left: 0, top: TU_HEADER - win.scrollY, width: VP_W, height: TU_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: TU_TOTAL, clientW: VP_W }));
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((TU_VIEW + 2 * TU_OVER) / TU_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: TU_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');
  }

  const article = body.appendChild(new El('div', doc, { clientH: TU_ARTICLE, clientW: VP_W }));
  const bottom = body.appendChild(new El('div', doc, { clientH: TU_BOTTOM, clientW: VP_W }));

  body._base.contentH = () => TU_HEADER + vlist.clientHeight + TU_ARTICLE + TU_BOTTOM;
  html._base.contentH = () => body.clientHeight;

  vlist.scrollTop = 300;   // user had scrolled the list
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - TU_OVER &&
                         cr < vlist.scrollTop + TU_VIEW + TU_OVER &&
                         cr >= 0 && cr < TU_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const boxH = vlist.clientHeight;
    const artTop = TU_HEADER + boxH;
    for (let vy = 0; vy < VP_H; vy++) {
      const row = win.scrollY + vy;
      if (row < 0) continue;
      if (row < TU_HEADER) { fillRect(img, 0, vy, VP_W, 1, TU.header); continue; }
      if (row < artTop) {                          // inside the virtualized list box
        const cr = vlist.scrollTop + (row - TU_HEADER);
        fillRect(img, 0, vy, VP_W, 1, TU.sizerBg);
        if (realized(cr)) {
          const col = cr >= TU_DEEP_FROM ? TU.deep : TU.row(Math.floor(cr / TU_ROWH));
          fillRect(img, 0, vy, VP_W, 1, col);
        }
        continue;
      }
      const ar = row - artTop;
      if (ar < TU_ARTICLE) fillRect(img, 0, vy, VP_W, 1, TU.article(Math.floor(ar / 100)));
      else if (ar < TU_ARTICLE + TU_BOTTOM) fillRect(img, 0, vy, VP_W, 1, TU.bottom);
    }
    return img;
  }
  return { name: 'tallunroll', doc, html, body, win, render, dpr, bannerH: 0, refs: { vlist } };
}

function expectTallUnroll(seg, state, segs) {
  const EXP_H = TU_HEADER + TU_TOTAL + TU_ARTICLE + TU_BOTTOM;   // 120+17000+12000+160 = 29280
  const x = 640;
  const slot = TU_HEADER;
  const abs = (ax, ay) => {                        // pixel at an absolute grown-canvas Y, across parts
    let y = ay;
    for (const s of segs) { if (y < s.h) return pxAt(s, ax, y); y -= s.h; }
    return WHITE;
  };
  const rowColAt = cr => (cr >= TU_DEEP_FROM ? TU.deep : TU.row(Math.floor(cr / TU_ROWH)));

  check('embedded virtual list flagged inline (meta.inlinePanes length 1, docY=' + TU_HEADER + ')',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1 &&
       state.meta.inlinePanes[0].docY === TU_HEADER),
    JSON.stringify(state.meta.inlinePanes));

  check('very tall unroll exceeded the canvas edge -> EXACTLY 2 parts summing to ' + EXP_H,
    segs.length === 2 && segs[0].h + segs[1].h === EXP_H, segs.map(s => s.h).join(' + '));

  const h1 = segs[0].h;
  check('part-1 cut falls INSIDE the unrolled list, not a raw 16000 cut (' + slot + ' < h1 < 16000)',
    h1 > 15000 && h1 < 16000 && h1 > slot && h1 < slot + TU_TOTAL, 'h1=' + h1);

  check('list TOP window present inline (row 0 at slot top)',
    near(abs(x, slot + 20), TU.row(0)), abs(x, slot + 20).join(','));
  check('list MID content present (cr 8000 — beyond the visible window)',
    near(abs(x, slot + 8000), rowColAt(8000)), abs(x, slot + 8000).join(','));

  // Straddle: fixed content rows bracketing the cut must each carry their correct
  // list colour, via whichever part contains them — proves nothing is lost,
  // torn, or shifted at the boundary.
  for (const cr of [14800, 15200, 15600, 16000]) {
    check('straddle: list content-Y ' + cr + ' correct across the split (canvasY ' + (slot + cr) + ')',
      near(abs(x, slot + cr), rowColAt(cr)), abs(x, slot + cr).join(',') + ' vs ' + rowColAt(cr).join(','));
  }
  check('straddle: part 2 opens on list ink, no white gap at the cut',
    !near(pxAt(segs[1], x, 0), WHITE) && !near(pxAt(segs[1], x, 3), WHITE),
    pxAt(segs[1], x, 0).join(','));

  // Directly sample the rows straddling the cut, computed from the REAL h1: the
  // last rows of part 1 and the first rows of part 2 must be the correct,
  // contiguous list colours. This is exactly where a naive "skip the straddling
  // frame" stitch leaves a white band (regression teeth).
  for (const d of [4, 40, 120]) {
    const crA = (h1 - d) - slot;             // just above the cut (part-1 bottom)
    check('straddle: part-1 row ' + d + 'px above the cut is the right list colour (cr ' + crA + ')',
      near(pxAt(segs[0], x, h1 - d), rowColAt(crA)), pxAt(segs[0], x, h1 - d).join(',') + ' vs ' + rowColAt(crA).join(','));
    const crB = (h1 + d) - slot;             // just below the cut (part-2 top)
    check('straddle: part-2 row ' + d + 'px below the cut is the right list colour (cr ' + crB + ')',
      near(pxAt(segs[1], x, d), rowColAt(crB)), pxAt(segs[1], x, d).join(',') + ' vs ' + rowColAt(crB).join(','));
  }

  // Deep sentinel (only reachable by unrolling) lands past the cut, exactly once.
  check('list DEEP SENTINEL present after the split (cr ' + (TU_DEEP_FROM + 40) + ')',
    near(abs(x, slot + TU_DEEP_FROM + 40), TU.deep), abs(x, slot + TU_DEEP_FROM + 40).join(','));
  const deepP1 = countRowsWithColor(segs[0], x, 0, segs[0].h, TU.deep, 8);
  const deepP2 = countRowsWithColor(segs[1], x, 0, segs[1].h, TU.deep, 8);
  check('deep sentinel appears EXACTLY once across both parts (~200 rows, no dup/loss)',
    Math.abs((deepP1 + deepP2) - 200) <= 4, (deepP1 + deepP2) + ' rows (p1 ' + deepP1 + ' + p2 ' + deepP2 + ')');

  // Article + bottom shoved below the unrolled list, present in part 2.
  check('article shoved below the unrolled list (present in part 2)',
    near(abs(x, slot + TU_TOTAL + 200), TU.article(2), 12), abs(x, slot + TU_TOTAL + 200).join(','));
  const botP2 = countRowsWithColor(segs[1], x, 0, segs[1].h, TU.bottom, 8);
  check('page BOTTOM MARKER present after the split (~' + TU_BOTTOM + ' rows, part 2)',
    Math.abs(botP2 - TU_BOTTOM) <= 3, botP2 + ' rows');

  // Fully unrolled: no render-window spacer band left in the list span, either part.
  const szP1 = countRowsWithColor(segs[0], x, slot, segs[0].h, TU.sizerBg, 4);
  const szP2 = countRowsWithColor(segs[1], x, 0, Math.max(0, slot + TU_TOTAL - h1), TU.sizerBg, 4);
  check('no render-window spacer band left in the unrolled list (both parts)',
    szP1 + szP2 <= 2, (szP1 + szP2) + ' spacer rows');
}


/* ========== scenario: embedded virtual list INSIDE an app-shell PANE, INLINE UNROLL (v1.9.10) ========== */
/* The last of session 15's three named inline-unroll edges. Same render-window
   list as `virtualunroll`, but the dominant scroller is an inner app-shell PANE
   (root.isDoc === false), not the document — so the inline slot injection must
   compose with the PANE's OWN unroll (two growth systems in the pane's
   coordinate frame). v1.9.9 gated the inline job on root.isDoc, so a
   pane-embedded list was captured AS-RENDERED (its ~500px window only) and its
   deep content never made the shot. This scenario drives the engine change: the
   list unrolls inline WITHIN the unrolled pane, its deep sentinel present, and
   the pane content below it (article + bottom) shoved down by the growth.
   A tall pane tail keeps the PANE the scroll root (paneRange 6196 > listRange
   3500) so the list stays an INLINE slot and is not itself picked as the pane. */

const PL = {
  shell:   [50, 40, 80],               // app-shell top chrome (kept once)
  paneHdr: [40, 60, 150],              // pane header, inside the pane, above the list
  row: i => (i % 2 ? [120, 180, 230] : [80, 150, 200]),
  sizerBg: [235, 238, 245],
  deep:    [255, 120, 0],              // list bottom sentinel — reached only by unroll
  article: i => [190 - (i % 5) * 8, 110, 70 + (i % 5) * 8],   // pane content below the list
  bottom:  [0, 180, 120]               // pane bottom marker, at the very end
};
const PL_HEADER_H = 64;                      // shell chrome
const PL_PANE_H = VP_H - PL_HEADER_H;        // 656 — pane viewport
const PL_PH = 200;                           // pane header (inside the pane, above the list)
const PL_VIEW = 500;                         // list compact window (clientH)
const PL_OVER = 60;                          // list overscan
const PL_TOTAL = 4000;                       // list full content (sizer)
const PL_ROWH = 40;
const PL_DEEP_FROM = PL_TOTAL - 200;         // 3800..4000 deep sentinel band
const PL_ARTICLE = 6000;                     // pane content below the list
const PL_BOTTOM = 152;                       // pane bottom marker
const PL_LIST0 = 1500;                       // user had scrolled the list to the middle

function buildPaneInline() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('header', doc, { clientH: PL_HEADER_H, clientW: VP_W }));   // shell chrome
  const pane = body.appendChild(new El('main', doc, { clientH: PL_PANE_H, clientW: VP_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 0, top: PL_HEADER_H - win.scrollY, width: VP_W, height: PL_PANE_H });

  // pane content: header, the embedded virtual list, an article, a bottom marker
  pane.appendChild(new El('div', doc, { clientH: PL_PH, clientW: VP_W }));   // pane header

  const vlist = pane.appendChild(new El('div', doc, { clientH: PL_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:500px');
  // list screen rect tracks BOTH window and pane scroll
  vlist._rect = () => ({ left: 0, top: (PL_HEADER_H - win.scrollY) + (PL_PH - pane.scrollTop), width: VP_W, height: PL_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: PL_TOTAL, clientW: VP_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((PL_VIEW + 2 * PL_OVER) / PL_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: PL_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');
  }

  pane.appendChild(new El('div', doc, { clientH: PL_ARTICLE, clientW: VP_W }));   // article below the list
  pane.appendChild(new El('div', doc, { clientH: PL_BOTTOM, clientW: VP_W }));    // bottom marker

  // the pane scrolls (its content >> its viewport); the document itself does not
  body._base.contentH = () => PL_HEADER_H + pane.clientHeight;
  html._base.contentH = () => body.clientHeight;

  pane.scrollTop = 0;
  vlist.scrollTop = PL_LIST0;   // user had scrolled the list to the middle
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - PL_OVER &&
                         cr < vlist.scrollTop + PL_VIEW + PL_OVER &&
                         cr >= 0 && cr < PL_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = PL_HEADER_H - win.scrollY;
    const artTop = PL_PH + PL_VIEW;                 // pane-content Y where the article begins (compact)
    const colorAt = (cy) => {
      if (cy < 0) return WHITE;
      if (cy < PL_PH) return PL.paneHdr;            // pane header
      if (cy < artTop) {                            // the list's compact viewport band
        const cr = vlist.scrollTop + (cy - PL_PH);  // list-content-Y shown at this pane row
        if (realized(cr)) return cr >= PL_DEEP_FROM ? PL.deep : PL.row(Math.floor(cr / PL_ROWH));
        return PL.sizerBg;
      }
      const a = cy - artTop;
      if (a < PL_ARTICLE) return PL.article(Math.floor(a / 100));
      if (a < PL_ARTICLE + PL_BOTTOM) return PL.bottom;
      return WHITE;
    };
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PL_PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const cy = pane.scrollTop + (dy - paneTop);
      fillRect(img, 0, dy, VP_W, 1, colorAt(Math.floor(cy)));
    }
    fillRect(img, 0, Math.max(0, -win.scrollY), VP_W, PL_HEADER_H, PL.shell);   // shell chrome, kept once
    return img;
  }
  return { name: 'paneinline', doc, html, body, win, render, dpr, bannerH: 0, refs: { pane, vlist } };
}

function expectPaneInline(seg, state, segs) {
  const EXP_H = PL_HEADER_H + PL_PH + PL_TOTAL + PL_ARTICLE + PL_BOTTOM;   // 64+200+4000+6000+152 = 10416
  const x = 640;
  const slot = PL_HEADER_H + PL_PH;               // list slot top in the final canvas (shell + pane header)

  check('app-shell pane capture (meta.rootRect present)', !!state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  check('embedded virtual list flagged inline (meta.inlinePanes length 1, docY=' + PL_PH + ' in pane space)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1 &&
       state.meta.inlinePanes[0].docY === PL_PH),
    JSON.stringify(state.meta.inlinePanes));
  check('pane grown at the list slot — single ' + EXP_H + 'px part (list unrolled inline in the pane)',
    segs.length === 1 && seg.w === VP_W && seg.h === EXP_H, seg.w + 'x' + segs.map(s => s.h).join('+'));

  check('shell chrome kept once at the top (~' + PL_HEADER_H + ' rows)',
    Math.abs(countRowsWithColor(seg, x, 0, seg.h, PL.shell) - PL_HEADER_H) <= 3,
    countRowsWithColor(seg, x, 0, seg.h, PL.shell) + ' rows');
  // Pane header sits fully between the shell and the list slot (pins slotTop —
  // if the injected slot loses the pane.dy offset it overpaints this band).
  check('pane header present between shell and list (~' + PL_PH + ' rows)',
    Math.abs(countRowsWithColor(seg, x, 0, seg.h, PL.paneHdr) - PL_PH) <= 3,
    countRowsWithColor(seg, x, 0, seg.h, PL.paneHdr) + ' rows');
  // The unrolled pane must be FULLY PACKED below the shell — no white band.
  // Article colour is periodic (i%5), so a position check alone can alias a
  // 500px-multiple misplacement; this + the "bottom at the very bottom" check
  // catch a growth-shift regression on the pane frames that a colour sample can't.
  const whiteRows = countRowsWithColor(seg, x, PL_HEADER_H, seg.h, WHITE, 2);
  check('unrolled pane fully packed below the shell — no white gap', whiteRows === 0, whiteRows + ' white rows');
  check('pane bottom marker sits at the very bottom of the grown canvas',
    near(pxAt(seg, x, seg.h - 20), PL.bottom), pxAt(seg, x, seg.h - 20).join(','));
  check('list TOP window present inline (row 0 at slot top)',
    near(pxAt(seg, x, slot + 20), PL.row(0)), pxAt(seg, x, slot + 20).join(','));
  check('list MID content present inline (cr 2000 — beyond the visible window)',
    near(pxAt(seg, x, slot + 2000), PL.row(Math.floor(2000 / PL_ROWH))),
    pxAt(seg, x, slot + 2000).join(','));
  const deepY = slot + PL_DEEP_FROM + 40;
  check('list DEEP SENTINEL present inline (cr ' + (PL_DEEP_FROM + 40) + ' — reached only by unrolling)',
    near(pxAt(seg, x, deepY), PL.deep), pxAt(seg, x, deepY).join(','));
  const artY = slot + PL_TOTAL + 400;             // 400px into the article, now shoved down
  check('pane article shoved down below the unrolled list (present at y' + artY + ')',
    near(pxAt(seg, x, artY), PL.article(4), 12), pxAt(seg, x, artY).join(','));
  const botRows = countRowsWithColor(seg, x, 0, seg.h, PL.bottom);
  check('pane BOTTOM MARKER present at the very end (~' + PL_BOTTOM + ' rows)',
    Math.abs(botRows - PL_BOTTOM) <= 3, botRows + ' rows');
  const sizerRows = countRowsWithColor(seg, x, slot, slot + PL_TOTAL, PL.sizerBg, 4);
  check('no render-window spacer band left in the unrolled list', sizerRows <= 2, sizerRows + ' spacer rows');
  const deepRows = countRowsWithColor(seg, x, 0, seg.h, PL.deep);
  check('deep sentinel appears exactly once (~200 rows)', Math.abs(deepRows - 200) <= 4, deepRows + ' rows');
}


/* ========== scenario: PII redaction INSIDE a pane-embedded inline-unrolled list (v1.9.11) ========== */
/* Combines paneinline (embedded virtual list inside an app-shell PANE, inline-
   unrolled) with redactPII. THREE coordinate frames meet on the bake:
   (a) PII INSIDE the list unrolls with the list and bakes at inlineDraw.finalTop
       (which already includes pane.dy) — email (mid window) + card (DEEP);
   (b) PII in the pane header ABOVE the slot bakes at pane.dy, region 0, no growth — ssn;
   (c) PII in the pane article BELOW the slot must shift DOWN by the list's growth —
       and the inlineRegions membership test must run in the SAME frame as the region
       bounds (canvas space, incl. pane.dy), not raw pane-content space. `phone` sits
       in the pane.dy-tall band just below the slot to PIN that frame; `phone2` sits
       deep in the article (far from the boundary) as the control that shifts either way. */

const PIR = {
  email:  [10, 200, 90],    // list mid-window PII  (inline box)
  card:   [220, 30, 140],   // list DEEP PII        (inline box)
  ssn:    [250, 210, 20],   // pane header PII      (non-inline pane box, ABOVE slot)
  phone:  [30, 210, 230],   // article PII in the pane.dy band just below the slot (frame-pin)
  phone2: [140, 90, 250],   // deep article PII     (below slot, far from the region boundary)
  block:  [17, 17, 17]      // redaction block (#111111)
};
const PIR_EMAIL_CY = 1520;   // list-content y (mid list, in the user's window)
const PIR_CARD_CY  = 3840;   // list-content y (deep sentinel band, reached only by unroll)
const PIR_SSN_PY   = 100;    // pane-content y (pane header, above the slot)
const PIR_PHONE_PY = 710;    // pane-content y (article, inside the pane.dy band below the slot)
const PIR_PHONE2_PY = 2000;  // pane-content y (deep article, below the slot)

function buildPaneInlineRedact() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('header', doc, { clientH: PL_HEADER_H, clientW: VP_W }));   // shell chrome
  const pane = body.appendChild(new El('main', doc, { clientH: PL_PANE_H, clientW: VP_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 0, top: PL_HEADER_H - win.scrollY, width: VP_W, height: PL_PANE_H });

  const paneHdr = pane.appendChild(new El('div', doc, { clientH: PL_PH, clientW: VP_W }));   // pane header (fixed height)

  const vlist = pane.appendChild(new El('div', doc, { clientH: PL_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:500px');
  vlist._rect = () => ({ left: 0, top: (PL_HEADER_H - win.scrollY) + (PL_PH - pane.scrollTop), width: VP_W, height: PL_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: PL_TOTAL, clientW: VP_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((PL_VIEW + 2 * PL_OVER) / PL_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: PL_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');
  }

  // list PII leaves (inside the list -> inline boxes). rect tracks win+pane+list scroll.
  const listPII = [
    { cy: PIR_EMAIL_CY, h: 40, color: PIR.email, text: 'Email: jane.doe@example.com' },
    { cy: PIR_CARD_CY,  h: 40, color: PIR.card,  text: 'Card 4242 4242 4242 4242' }
  ];
  for (const it of listPII) {
    const el = sizer.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.setAttribute('style', 'position:absolute');
    el.textContent = it.text;
    el._rect = () => ({ left: 40, top: (PL_HEADER_H - win.scrollY) + (PL_PH - pane.scrollTop) + it.cy - vlist.scrollTop, width: 600, height: it.h });
    it.el = el;
  }

  const article = pane.appendChild(new El('div', doc, { clientH: PL_ARTICLE, clientW: VP_W }));   // article below the list (fixed height)
  pane.appendChild(new El('div', doc, { clientH: PL_BOTTOM, clientW: VP_W }));    // bottom marker

  // pane-content PII leaves (NON-inline pane boxes). py is pane-content y (compact layout).
  const panePII = [
    { py: PIR_SSN_PY,    h: 40, color: PIR.ssn,    text: 'SSN 123-45-6789',       host: paneHdr },
    { py: PIR_PHONE_PY,  h: 40, color: PIR.phone,  text: 'Call +1 (555) 123-4567', host: article },
    { py: PIR_PHONE2_PY, h: 40, color: PIR.phone2, text: 'Tel +1 (555) 987-6543',  host: article }
  ];
  for (const it of panePII) {
    const el = it.host.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.setAttribute('style', 'position:absolute');
    el.textContent = it.text;
    el._rect = () => ({ left: 40, top: (PL_HEADER_H - win.scrollY) + (it.py - pane.scrollTop), width: 600, height: it.h });
    it.el = el;
  }

  body._base.contentH = () => PL_HEADER_H + pane.clientHeight;
  html._base.contentH = () => body.clientHeight;

  pane.scrollTop = 0;
  vlist.scrollTop = PL_LIST0;
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - PL_OVER &&
                         cr < vlist.scrollTop + PL_VIEW + PL_OVER &&
                         cr >= 0 && cr < PL_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = PL_HEADER_H - win.scrollY;
    const artTop = PL_PH + PL_VIEW;
    const colorAt = (cy) => {
      if (cy < 0) return WHITE;
      if (cy < PL_PH) return PL.paneHdr;
      if (cy < artTop) {
        const cr = vlist.scrollTop + (cy - PL_PH);
        if (realized(cr)) return cr >= PL_DEEP_FROM ? PL.deep : PL.row(Math.floor(cr / PL_ROWH));
        return PL.sizerBg;
      }
      const a = cy - artTop;
      if (a < PL_ARTICLE) return PL.article(Math.floor(a / 100));
      if (a < PL_ARTICLE + PL_BOTTOM) return PL.bottom;
      return WHITE;
    };
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PL_PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const cy = pane.scrollTop + (dy - paneTop);
      let col = colorAt(Math.floor(cy));
      for (const it of panePII) {                       // pane-content PII (header/article)
        if (cy >= it.py && cy < it.py + it.h) { col = it.color; break; }
      }
      if (cy >= PL_PH && cy < artTop) {                 // list-content PII (only in the realized window)
        const cr = vlist.scrollTop + (cy - PL_PH);
        if (realized(cr)) {
          for (const it of listPII) {
            if (cr >= it.cy && cr < it.cy + it.h) { col = it.color; break; }
          }
        }
      }
      fillRect(img, 0, dy, VP_W, 1, col);
    }
    fillRect(img, 0, Math.max(0, -win.scrollY), VP_W, PL_HEADER_H, PL.shell);   // shell chrome, kept once
    return img;
  }
  return { name: 'paneinlineredact', doc, html, body, win, render, dpr, bannerH: 0, refs: { pane, vlist }, listPII, panePII };
}

function expectPaneInlineRedact(seg, state, segs, out) {
  /* standing regression — see the banner above gradeScanLedger */
  gradeScanLedger('paneinlineredact', state.meta.piiScan);
  gradeActs('paneinlineredact', (out && out.record) || {}, 5, state.meta.piiScan, segs);
  gradeRequested('paneinlineredact', (out && out.record) || {}, true);
  check('paneinlineredact: the honest case gets the counts on the page and no toast at all',
    !!out && /matched, \d+ painted, \d+ confirmed opaque/i.test(String((out.lines || []).join(' '))) &&
    out.toasts.length === 0,
    JSON.stringify({ lines: out && out.lines, toasts: out && out.toasts }));
  const EXP_H = PL_HEADER_H + PL_PH + PL_TOTAL + PL_ARTICLE + PL_BOTTOM;   // 10416
  const x = 300;                                  // inside the 40..640 PII band
  const slot = PL_HEADER_H + PL_PH;               // 264 — list slot top in the canvas
  const growth = PL_TOTAL - PL_VIEW;              // 3500
  const B = PIR.block;

  check('single part, pane+list unrolled (height ~' + EXP_H + ')',
    segs.length === 1 && Math.abs(seg.h - EXP_H) <= 6, segs.map(s => s.h).join('+'));
  check('meta.piiBoxes = 5 (2 inline-tagged list + 3 pane)',
    !!state.meta.piiBoxes && state.meta.piiBoxes.length === 5 &&
    state.meta.piiBoxes.filter(b => b.inline != null).length === 2,
    state.meta.piiBoxes ? (state.meta.piiBoxes.length + ' boxes, ' + state.meta.piiBoxes.filter(b => b.inline != null).length + ' inline') : 'null');

  // Every one of the 5 sensitive items must be fully covered — 0 of its colour left.
  for (const [nm, color] of [['email (list window)', PIR.email], ['card (list DEEP)', PIR.card],
       ['ssn (pane header, above slot)', PIR.ssn], ['phone (article band just below slot)', PIR.phone],
       ['phone2 (deep article)', PIR.phone2]]) {
    const leak = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check(nm + ' fully redacted (0 of its colour visible)', leak === 0, leak + ' rows leaked');
  }

  // Blocks land at the correct FINAL canvas positions (frame composition).
  const emailY = slot + PIR_EMAIL_CY;                       // 1784 — inline slot + list-content y
  check('email block at the unrolled slot (y' + emailY + ')',
    countRowsWithColor(seg, x, emailY - 6, emailY + 46, B, 6) >= 34, 'near email');
  const cardY = slot + PIR_CARD_CY;                         // 4104 — deep inline
  check('card block at the DEEP unrolled position (y' + cardY + ')',
    countRowsWithColor(seg, x, cardY - 6, cardY + 46, B, 6) >= 34, 'near card');
  const ssnY = PL_HEADER_H + PIR_SSN_PY;                    // 164 — pane header (pane.dy + py, region 0)
  check('ssn block at the pane header (y' + ssnY + ', above slot, no growth)',
    countRowsWithColor(seg, x, ssnY - 6, ssnY + 46, B, 6) >= 34, 'near ssn');
  const phoneY = PL_HEADER_H + PIR_PHONE_PY + growth;       // 4274 — pane.dy + py + growth (THE frame-pin)
  check('phone block SHIFTED by the growth (article band just below slot, y' + phoneY + ')',
    countRowsWithColor(seg, x, phoneY - 6, phoneY + 46, B, 6) >= 34, 'near phone');
  const phone2Y = PL_HEADER_H + PIR_PHONE2_PY + growth;     // 5564 — deep article, shifted
  check('phone2 block SHIFTED by the growth (deep article, y' + phone2Y + ')',
    countRowsWithColor(seg, x, phone2Y - 6, phone2Y + 46, B, 6) >= 34, 'near phone2');
}


/* ===== scenario: pane-embedded inline list BESIDE a fixed rail, with redaction (s32) =====
   Combo (b). The paneinlineredact geometry (app-shell PANE = scroll root, holding a
   pane header + an inline-unrolled virtualized list + a tall article + a bottom
   marker) is now OFFSET to the right of a fixed left RAIL (Reddit-style nav with its
   own inner scroller). PII lives in ALL THREE coordinate frames: the RAIL (email in
   its first window + a card DEEP, reached only by unrolling the rail), the PANE (ssn
   in the header ABOVE the slot + phone in the article band just BELOW the slot), and
   the inline LIST (email in the window + a card DEEP). This pins the composition the
   session-15/17 edges left untested together: the rail draws as an INDEPENDENT column
   (its own frames, clipped to the canvas height, painted before the pane) and its
   redaction bakes via b.pane -> sideDraw[i] (never touching inlineRegions), so neither
   the rail draw NOR the rail redaction may move with the pane's 3500px inline growth,
   while the pane's own boxes still shift correctly (ssn above = no shift, phone below
   = shifted; the v1.9.11 canvas-space frame-pin, now with a rail present). Reuses the
   PL/PIR paneinline geometry; adds a rail. */
const PIRL_RAIL_W = 300;
const PIRL_PANE_X = PIRL_RAIL_W;               // 300 — pane sits to the RIGHT of the fixed rail
const PIRL_PANE_W = VP_W - PIRL_RAIL_W;        // 980
const PIRL_RAIL_H = 600, PIRL_RAIL_CONTENT_H = 1800, PIRL_IT_L = 20, PIRL_IT_W = 260;
const PIRL_RAIL0 = 450;                        // user had scrolled the rail — doc-space coords would be WRONG
const PIRL = {
  railbg:    [176, 184, 196],
  railEmail: [255, 90, 90],    // rail PII, in the first rail window
  railCard:  [90, 130, 255],   // rail PII, DEEP (reached only by unrolling the rail)
  railDecoy: [255, 0, 255]     // Luhn-invalid — must stay UN-redacted (and is DEEP, so it also proves the rail unrolled)
};
const PIRL_REMAIL_CY = 120, PIRL_RCARD_CY = 1080, PIRL_RDECOY_CY = 1480;

function buildPaneInlineRail() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('header', doc, { clientH: PL_HEADER_H, clientW: VP_W }));   // shell chrome (full width)

  // main pane (scroll root), OFFSET to the right of the fixed rail
  const pane = body.appendChild(new El('main', doc, { clientH: PL_PANE_H, clientW: PIRL_PANE_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: PIRL_PANE_X, top: PL_HEADER_H - win.scrollY, width: PIRL_PANE_W, height: PL_PANE_H });

  const paneHdr = pane.appendChild(new El('div', doc, { clientH: PL_PH, clientW: PIRL_PANE_W }));   // pane header (fixed height)

  const vlist = pane.appendChild(new El('div', doc, { clientH: PL_VIEW, clientW: PIRL_PANE_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:500px');
  vlist._rect = () => ({ left: PIRL_PANE_X, top: (PL_HEADER_H - win.scrollY) + (PL_PH - pane.scrollTop), width: PIRL_PANE_W, height: PL_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: PL_TOTAL, clientW: PIRL_PANE_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((PL_VIEW + 2 * PL_OVER) / PL_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: PL_ROWH, clientW: PIRL_PANE_W }));
    r.setAttribute('style', 'position:absolute');
  }

  // list PII leaves (inside the list -> inline boxes). rect tracks win+pane+list scroll.
  const listPII = [
    { cy: PIR_EMAIL_CY, h: 40, color: PIR.email, text: 'Email: jane.doe@example.com' },
    { cy: PIR_CARD_CY,  h: 40, color: PIR.card,  text: 'Card 4242 4242 4242 4242' }
  ];
  for (const it of listPII) {
    const el = sizer.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.setAttribute('style', 'position:absolute');
    el.textContent = it.text;
    el._rect = () => ({ left: PIRL_PANE_X + 40, top: (PL_HEADER_H - win.scrollY) + (PL_PH - pane.scrollTop) + it.cy - vlist.scrollTop, width: 600, height: it.h });
    it.el = el;
  }

  const article = pane.appendChild(new El('div', doc, { clientH: PL_ARTICLE, clientW: PIRL_PANE_W }));   // article below the list (fixed height)
  pane.appendChild(new El('div', doc, { clientH: PL_BOTTOM, clientW: PIRL_PANE_W }));    // bottom marker

  // pane-content PII leaves (NON-inline pane boxes), nested in fixed-height hosts so
  // absolute leaves don't inflate the pane's content height (session-18 tripwire).
  const panePII = [
    { py: PIR_SSN_PY,   h: 40, color: PIR.ssn,   text: 'SSN 123-45-6789',       host: paneHdr },
    { py: PIR_PHONE_PY, h: 40, color: PIR.phone, text: 'Call +1 (555) 123-4567', host: article }
  ];
  for (const it of panePII) {
    const el = it.host.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.setAttribute('style', 'position:absolute');
    el.textContent = it.text;
    el._rect = () => ({ left: PIRL_PANE_X + 40, top: (PL_HEADER_H - win.scrollY) + (it.py - pane.scrollTop), width: 600, height: it.h });
    it.el = el;
  }

  // fixed left rail (Reddit nav): fixed wrapper + inner scroller, BELOW the shell header.
  // Explicit contentH => absolute PII leaves don't inflate the rail's scrollHeight.
  const railTop = PL_HEADER_H;   // 64 — viewport-anchored, just below the header
  const railWrap = body.appendChild(new El('div', doc, { clientH: PIRL_RAIL_H, clientW: PIRL_RAIL_W }));
  railWrap.id = 'railWrap';
  railWrap.setAttribute('style', 'position:fixed;left:0;top:' + railTop + 'px');
  railWrap._rect = () => ({ left: 0, top: railTop, width: PIRL_RAIL_W, height: PIRL_RAIL_H });
  const rail = railWrap.appendChild(new El('div', doc, { clientH: PIRL_RAIL_H, clientW: PIRL_RAIL_W, contentH: PIRL_RAIL_CONTENT_H }));
  rail.id = 'rail';
  rail.setAttribute('style', 'overflow-y:auto;height:' + PIRL_RAIL_H + 'px');
  rail._rect = () => ({ left: 0, top: railTop, width: PIRL_RAIL_W, height: PIRL_RAIL_H });

  const railPII = [
    { cy: PIRL_REMAIL_CY, h: 40, color: PIRL.railEmail, text: 'Email: rae@example.com',    pii: true },
    { cy: PIRL_RCARD_CY,  h: 40, color: PIRL.railCard,  text: 'Card 4242 4242 4242 4242',   pii: true },
    { cy: PIRL_RDECOY_CY, h: 40, color: PIRL.railDecoy, text: 'Order 1234 5678 9012 3456',  pii: false }
  ];
  for (const it of railPII) {
    const el = rail.appendChild(new El('div', doc, { clientH: it.h, clientW: PIRL_IT_W }));
    el.textContent = it.text;
    el._rect = () => ({ left: PIRL_IT_L, top: railTop + (it.cy - rail.scrollTop), width: PIRL_IT_W, height: it.h });
    it.el = el;
  }

  body._base.contentH = () => PL_HEADER_H + pane.clientHeight;
  html._base.contentH = () => body.clientHeight;

  pane.scrollTop = 0;
  vlist.scrollTop = PL_LIST0;
  rail.scrollTop = PIRL_RAIL0;
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - PL_OVER &&
                         cr < vlist.scrollTop + PL_VIEW + PL_OVER &&
                         cr >= 0 && cr < PL_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = PL_HEADER_H - win.scrollY;
    const artTop = PL_PH + PL_VIEW;
    const colorAt = (cy) => {
      if (cy < 0) return WHITE;
      if (cy < PL_PH) return PL.paneHdr;
      if (cy < artTop) {
        const cr = vlist.scrollTop + (cy - PL_PH);
        if (realized(cr)) return cr >= PL_DEEP_FROM ? PL.deep : PL.row(Math.floor(cr / PL_ROWH));
        return PL.sizerBg;
      }
      const a = cy - artTop;
      if (a < PL_ARTICLE) return PL.article(Math.floor(a / 100));
      if (a < PL_ARTICLE + PL_BOTTOM) return PL.bottom;
      return WHITE;
    };
    // pane column (x >= PANE_X) — the offset scroll root
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PL_PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const cy = pane.scrollTop + (dy - paneTop);
      let col = colorAt(Math.floor(cy));
      for (const it of panePII) {                       // pane-content PII (header/article)
        if (cy >= it.py && cy < it.py + it.h) { col = it.color; break; }
      }
      if (cy >= PL_PH && cy < artTop) {                 // list-content PII (only in the realized window)
        const cr = vlist.scrollTop + (cy - PL_PH);
        if (realized(cr)) {
          for (const it of listPII) {
            if (cr >= it.cy && cr < it.cy + it.h) { col = it.color; break; }
          }
        }
      }
      fillRect(img, PIRL_PANE_X, dy, PIRL_PANE_W, 1, col);
    }
    // fixed left rail column (x in [0, PANE_X)), viewport-anchored, honors hide/unhide
    if (!hiddenNow(rail)) {
      for (let vy = 0; vy < PIRL_RAIL_H; vy++) {
        const nr = rail.scrollTop + vy;                 // rail content-y
        if (nr < 0 || nr >= PIRL_RAIL_CONTENT_H) continue;
        let col = PIRL.railbg;
        for (const it of railPII) {
          if (nr >= it.cy && nr < it.cy + it.h) { col = it.color; break; }
        }
        fillRect(img, 0, railTop + vy, PIRL_RAIL_W, 1, col);
      }
    }
    fillRect(img, 0, Math.max(0, -win.scrollY), VP_W, PL_HEADER_H, PL.shell);   // shell chrome, kept once (full width)
    return img;
  }
  return { name: 'paneinlinerail', doc, html, body, win, render, dpr, bannerH: 0, refs: { pane, vlist, rail }, listPII, panePII, railPII };
}

function expectPaneInlineRail(seg, state, segs, out) {
  /* standing regression — see the banner above gradeScanLedger */
  gradeScanLedger('paneinlinerail', state.meta.piiScan);
  gradeActs('paneinlinerail', (out && out.record) || {}, 6, state.meta.piiScan, segs);
  gradeRequested('paneinlinerail', (out && out.record) || {}, true);
  check('paneinlinerail: the honest case gets the counts on the page and no toast at all',
    !!out && /matched, \d+ painted, \d+ confirmed opaque/i.test(String((out.lines || []).join(' '))) &&
    out.toasts.length === 0,
    JSON.stringify({ lines: out && out.lines, toasts: out && out.toasts }));
  const EXP_H = PL_HEADER_H + PL_PH + PL_TOTAL + PL_ARTICLE + PL_BOTTOM;   // 10416 — the pane grows by the inline list
  const slot = PL_HEADER_H + PL_PH;               // 264 — list slot top in the canvas
  const growth = PL_TOTAL - PL_VIEW;              // 3500
  const B = PIR.block;
  const xPane = 640;                              // pane/list/article column (leaves span 340..940)
  const xRail = 150;                              // rail column (0..300), item band 20..280

  check('all three frames captured (inlinePanes=1 AND sidePanes=1 at x=0)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1 &&
       state.meta.sidePanes && state.meta.sidePanes.length === 1 && state.meta.sidePanes[0].x === 0),
    'inline=' + JSON.stringify(state.meta.inlinePanes) + ' side=' + JSON.stringify(state.meta.sidePanes));

  check('single part, pane grown by the inline list (height ~' + EXP_H + ')',
    segs.length === 1 && Math.abs(seg.h - EXP_H) <= 6, segs.map(s => s.h).join('+'));

  check('meta.piiBoxes = 6 (2 rail pane-tagged + 2 pane + 2 inline)',
    !!state.meta.piiBoxes && state.meta.piiBoxes.length === 6 &&
    state.meta.piiBoxes.filter(b => b.pane != null).length === 2 &&
    state.meta.piiBoxes.filter(b => b.inline != null).length === 2,
    state.meta.piiBoxes ? (state.meta.piiBoxes.length + ' boxes, ' +
      state.meta.piiBoxes.filter(b => b.pane != null).length + ' rail, ' +
      state.meta.piiBoxes.filter(b => b.inline != null).length + ' inline') : 'null');

  // 0-leak for every sensitive item across all THREE coordinate frames.
  for (const [nm, color, x] of [
       ['rail email', PIRL.railEmail, xRail], ['rail card (DEEP)', PIRL.railCard, xRail],
       ['pane ssn (above slot)', PIR.ssn, xPane], ['pane phone (article band below slot)', PIR.phone, xPane],
       ['list email (window)', PIR.email, xPane], ['list card (DEEP)', PIR.card, xPane]]) {
    const leak = countRowsWithColor(seg, x, 0, seg.h, color, 6);
    check(nm + ' fully redacted (0 of its colour visible)', leak === 0, leak + ' rows leaked');
  }

  // Rail composes as an INDEPENDENT column beside the grown pane: a DEEP Luhn-invalid
  // decoy (reached only by unrolling the rail past the user's window) is present AND
  // left un-redacted — proves the rail both unrolled and kept its non-PII content.
  const decoyRows = countRowsWithColor(seg, xRail, 0, seg.h, PIRL.railDecoy, 6);
  check('rail unrolled independently — DEEP Luhn decoy present in its column (~40 rows), un-redacted',
    Math.abs(decoyRows - 40) <= 8, decoyRows + ' rows');

  // Rail redaction blocks land at RAIL-content positions (sideDraw.dy + box·k) — NOT
  // shifted by the pane's 3500px inline growth (the rail is a separate column).
  const railEmailY = PL_HEADER_H + PIRL_REMAIL_CY;   // 184
  check('rail email block at its rail position (y' + railEmailY + ', NOT shifted by pane growth)',
    countRowsWithColor(seg, xRail, railEmailY - 6, railEmailY + 46, B, 6) >= 34, 'near rail email');
  const railCardY = PL_HEADER_H + PIRL_RCARD_CY;     // 1144 — DEEP rail, still unshifted
  check('rail card block at its DEEP rail position (y' + railCardY + ')',
    countRowsWithColor(seg, xRail, railCardY - 6, railCardY + 46, B, 6) >= 34, 'near rail card');

  // Pane + list blocks at their composed canvas positions (mirror paneinlineredact, now WITH a rail).
  const ssnY = PL_HEADER_H + PIR_SSN_PY;             // 164 — pane header, region 0, no growth
  check('pane ssn block at the pane header (y' + ssnY + ', above slot, no growth)',
    countRowsWithColor(seg, xPane, ssnY - 6, ssnY + 46, B, 6) >= 34, 'near ssn');
  const emailY = slot + PIR_EMAIL_CY;                // 1784 — inline slot + list y
  check('list email block at the unrolled slot (y' + emailY + ')',
    countRowsWithColor(seg, xPane, emailY - 6, emailY + 46, B, 6) >= 34, 'near list email');
  const cardY = slot + PIR_CARD_CY;                  // 4104 — deep inline
  check('list card block at the DEEP unrolled position (y' + cardY + ')',
    countRowsWithColor(seg, xPane, cardY - 6, cardY + 46, B, 6) >= 34, 'near list card');
  const phoneY = PL_HEADER_H + PIR_PHONE_PY + growth; // 4274 — pane box SHIFTED by growth (the frame-pin, WITH a rail present)
  check('pane phone block SHIFTED by the growth (article band just below slot, y' + phoneY + ')',
    countRowsWithColor(seg, xPane, phoneY - 6, phoneY + 46, B, 6) >= 34, 'near phone');

  // The list unrolled inside the pane (deep sentinel present), article shoved down,
  // bottom at the very end, no white gaps — the pane's own growth composition holds.
  const deepY = slot + PL_DEEP_FROM + 150;           // 4214 — deep list band, clear of the card box at 4104
  check('list DEEP sentinel present inline (cr ' + (PL_DEEP_FROM + 150) + ' — reached only by unrolling)',
    near(pxAt(seg, xPane, deepY), PL.deep), pxAt(seg, xPane, deepY).join(','));
  const artY = slot + PL_TOTAL + 400;                // 400px into the article, now shoved below the unrolled list
  check('article shoved down below the unrolled pane list (present at y' + artY + ')',
    near(pxAt(seg, xPane, artY), PL.article(4), 12), pxAt(seg, xPane, artY).join(','));
  const bottomRows = countRowsWithColor(seg, xPane, seg.h - PL_BOTTOM - 4, seg.h, PL.bottom, 8);
  check('pane bottom marker at the very end (~' + PL_BOTTOM + ' rows)',
    Math.abs(bottomRows - PL_BOTTOM) <= 10, bottomRows + ' rows');
  const whiteRows = countRowsWithColor(seg, xPane, PL_HEADER_H, seg.h, WHITE, 2);
  check('no white gaps in the unrolled pane column', whiteRows <= 4, whiteRows + ' white rows');
}

/* ========== scenario: pane-embedded inline list TALL enough to force a CANVAS SPLIT (combo (c), v1.9.11) ========== */
/* Composes paneinline (s30: an embedded virtual list INSIDE an app-shell PANE,
   inline-unrolled -- the pane is the scroll root, the list stays an inline slot)
   with tallunroll (s29: an inline unroll so tall the grown canvas exceeds the
   16000px edge, forcing a 2-part split whose cut lands INSIDE the unrolled list).
   The question combo (c) answers: does the PANE-branch region-clipped frame draw
   plus the inline-window injection compose ACROSS a part boundary? Both already
   draw at (finalTop - segTop) and clip to [0, segH] (result.js ~294-368), exactly
   like the doc split path -- so this is expected to be a test-only LOCK-IN, earned
   by teeth. A tall pane ARTICLE tail keeps paneRange (15404) > listRange (15200)
   so the PANE wins findScrollRoot and the list stays an inline slot; the list
   (15700) is tall enough that the grown canvas (31324) splits, the deterministic
   quiet-row cut landing at 15550 -- 414px above the list's bottom, INSIDE it. */

const PIS = {
  shell:   [50, 40, 80],               // app-shell top chrome (kept once)
  paneHdr: [40, 60, 150],              // pane header, inside the pane, above the list
  row: i => (i % 2 ? [120, 180, 230] : [80, 150, 200]),
  sizerBg: [235, 238, 245],
  deep:    [255, 120, 0],              // list bottom sentinel -- reached only by unroll
  article: i => [190 - (i % 5) * 8, 110, 70 + (i % 5) * 8],   // pane content below the list
  bottom:  [0, 180, 120]               // pane bottom marker, at the very end
};
const PIS_SHELL_H = 64;                      // shell chrome
const PIS_PANE_H = VP_H - PIS_SHELL_H;       // 656 -- pane viewport
const PIS_PH = 200;                          // pane header (inside the pane, above the list)
const PIS_VIEW = 500;                        // list compact window (clientH)
const PIS_OVER = 60;                         // list overscan
const PIS_TOTAL = 15700;                     // list full content (sizer) -- tall enough to force a split
const PIS_ROWH = 40;
const PIS_DEEP_FROM = PIS_TOTAL - 200;       // 15500..15700 deep sentinel band (lands in part 2)
const PIS_ARTICLE = 15200;                   // pane content below the list -- tall tail keeps the PANE the scroll root
const PIS_BOTTOM = 160;                      // pane bottom marker
const PIS_LIST0 = 1500;                      // user had scrolled the list to the middle

function buildPaneInlineSplit() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('header', doc, { clientH: PIS_SHELL_H, clientW: VP_W }));   // shell chrome
  const pane = body.appendChild(new El('main', doc, { clientH: PIS_PANE_H, clientW: VP_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 0, top: PIS_SHELL_H - win.scrollY, width: VP_W, height: PIS_PANE_H });

  // pane content: header, the embedded virtual list, a tall article, a bottom marker
  pane.appendChild(new El('div', doc, { clientH: PIS_PH, clientW: VP_W }));   // pane header

  const vlist = pane.appendChild(new El('div', doc, { clientH: PIS_VIEW, clientW: VP_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:500px');
  // list screen rect tracks BOTH window and pane scroll
  vlist._rect = () => ({ left: 0, top: (PIS_SHELL_H - win.scrollY) + (PIS_PH - pane.scrollTop), width: VP_W, height: PIS_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: PIS_TOTAL, clientW: VP_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((PIS_VIEW + 2 * PIS_OVER) / PIS_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: PIS_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');
  }

  pane.appendChild(new El('div', doc, { clientH: PIS_ARTICLE, clientW: VP_W }));   // article below the list
  pane.appendChild(new El('div', doc, { clientH: PIS_BOTTOM, clientW: VP_W }));    // bottom marker

  // the pane scrolls (its content >> its viewport); the document itself does not
  body._base.contentH = () => PIS_SHELL_H + pane.clientHeight;
  html._base.contentH = () => body.clientHeight;

  pane.scrollTop = 0;
  vlist.scrollTop = PIS_LIST0;   // user had scrolled the list to the middle
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - PIS_OVER &&
                         cr < vlist.scrollTop + PIS_VIEW + PIS_OVER &&
                         cr >= 0 && cr < PIS_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = PIS_SHELL_H - win.scrollY;
    const artTop = PIS_PH + PIS_VIEW;               // pane-content Y where the article begins (compact)
    const colorAt = (cy) => {
      if (cy < 0) return WHITE;
      if (cy < PIS_PH) return PIS.paneHdr;          // pane header
      if (cy < artTop) {                            // the list's compact viewport band
        const cr = vlist.scrollTop + (cy - PIS_PH); // list-content-Y shown at this pane row
        if (realized(cr)) return cr >= PIS_DEEP_FROM ? PIS.deep : PIS.row(Math.floor(cr / PIS_ROWH));
        return PIS.sizerBg;
      }
      const a = cy - artTop;
      if (a < PIS_ARTICLE) return PIS.article(Math.floor(a / 100));
      if (a < PIS_ARTICLE + PIS_BOTTOM) return PIS.bottom;
      return WHITE;
    };
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PIS_PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const cy = pane.scrollTop + (dy - paneTop);
      fillRect(img, 0, dy, VP_W, 1, colorAt(Math.floor(cy)));
    }
    fillRect(img, 0, Math.max(0, -win.scrollY), VP_W, PIS_SHELL_H, PIS.shell);   // shell chrome, kept once
    return img;
  }
  return { name: 'paneinlinesplit', doc, html, body, win, render, dpr, bannerH: 0, refs: { pane, vlist } };
}

function expectPaneInlineSplit(seg, state, segs) {
  const EXP_H = PIS_SHELL_H + PIS_PH + PIS_TOTAL + PIS_ARTICLE + PIS_BOTTOM;   // 64+200+15700+15200+160 = 31324
  const x = 640;
  const slot = PIS_SHELL_H + PIS_PH;             // 264 -- list slot top in the final canvas (shell + pane header)
  const abs = (ax, ay) => {                      // pixel at an absolute grown-canvas Y, across parts
    let y = ay;
    for (const s of segs) { if (y < s.h) return pxAt(s, ax, y); y -= s.h; }
    return WHITE;
  };
  const rowColAt = cr => (cr >= PIS_DEEP_FROM ? PIS.deep : PIS.row(Math.floor(cr / PIS_ROWH)));

  check('app-shell pane capture (meta.rootRect present)', !!state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  check('embedded virtual list flagged inline (meta.inlinePanes length 1, docY=' + PIS_PH + ' in pane space)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1 &&
       state.meta.inlinePanes[0].docY === PIS_PH),
    JSON.stringify(state.meta.inlinePanes));

  check('pane-embedded unroll exceeded the canvas edge -> EXACTLY 2 parts summing to ' + EXP_H,
    segs.length === 2 && segs[0].h + segs[1].h === EXP_H, segs.map(s => s.h).join(' + '));

  const h1 = segs[0].h;
  check('part-1 cut falls INSIDE the unrolled pane-embedded list (' + slot + ' < h1 < ' + (slot + PIS_TOTAL) + ')',
    h1 > 15000 && h1 < 16000 && h1 > slot && h1 < slot + PIS_TOTAL, 'h1=' + h1);

  // shell + pane header live in part 1, above the list slot (pins slotTop's pane.dy offset --
  // if the injected slot loses it, the list overpaints this band).
  check('shell chrome kept once at the top (~' + PIS_SHELL_H + ' rows, part 1)',
    Math.abs(countRowsWithColor(segs[0], x, 0, segs[0].h, PIS.shell) - PIS_SHELL_H) <= 3,
    countRowsWithColor(segs[0], x, 0, segs[0].h, PIS.shell) + ' rows');
  check('pane header present between shell and list (~' + PIS_PH + ' rows, part 1)',
    Math.abs(countRowsWithColor(segs[0], x, 0, segs[0].h, PIS.paneHdr) - PIS_PH) <= 3,
    countRowsWithColor(segs[0], x, 0, segs[0].h, PIS.paneHdr) + ' rows');

  check('list TOP window present inline (row 0 at slot top)',
    near(abs(x, slot + 20), PIS.row(0)), abs(x, slot + 20).join(','));
  check('list MID content present inline (cr 8000 -- beyond the visible window)',
    near(abs(x, slot + 8000), rowColAt(8000)), abs(x, slot + 8000).join(','));

  // Straddle: fixed list-content rows bracketing the cut must each carry their
  // correct list colour via whichever part contains them -- proves the
  // pane-embedded list survives the split with nothing lost, torn, or shifted.
  for (const cr of [15000, 15200, 15400]) {
    check('straddle: list content-Y ' + cr + ' correct across the split (canvasY ' + (slot + cr) + ')',
      near(abs(x, slot + cr), rowColAt(cr)), abs(x, slot + cr).join(',') + ' vs ' + rowColAt(cr).join(','));
  }
  check('straddle: part 2 opens on list ink, no white gap at the cut',
    !near(pxAt(segs[1], x, 0), WHITE) && !near(pxAt(segs[1], x, 3), WHITE),
    pxAt(segs[1], x, 0).join(','));
  // Directly sample the rows straddling the REAL cut: the last rows of part 1 and
  // the first rows of part 2 must be the correct, contiguous list colours -- exactly
  // where a naive "skip the straddling inline window" stitch leaves a white band.
  for (const d of [4, 40, 120]) {
    const crA = (h1 - d) - slot;             // just above the cut (part-1 bottom)
    check('straddle: part-1 row ' + d + 'px above the cut is the right list colour (cr ' + crA + ')',
      near(pxAt(segs[0], x, h1 - d), rowColAt(crA)), pxAt(segs[0], x, h1 - d).join(',') + ' vs ' + rowColAt(crA).join(','));
    const crB = (h1 + d) - slot;             // just below the cut (part-2 top)
    check('straddle: part-2 row ' + d + 'px below the cut is the right list colour (cr ' + crB + ')',
      near(pxAt(segs[1], x, d), rowColAt(crB)), pxAt(segs[1], x, d).join(',') + ' vs ' + rowColAt(crB).join(','));
  }

  // Deep sentinel (only reachable by unrolling) lands past the cut, exactly once.
  check('list DEEP SENTINEL present after the split (cr ' + (PIS_DEEP_FROM + 40) + ', part 2)',
    near(abs(x, slot + PIS_DEEP_FROM + 40), PIS.deep), abs(x, slot + PIS_DEEP_FROM + 40).join(','));
  const deepP1 = countRowsWithColor(segs[0], x, 0, segs[0].h, PIS.deep, 8);
  const deepP2 = countRowsWithColor(segs[1], x, 0, segs[1].h, PIS.deep, 8);
  check('deep sentinel appears EXACTLY once across both parts (~200 rows, no dup/loss)',
    Math.abs((deepP1 + deepP2) - 200) <= 4, (deepP1 + deepP2) + ' rows (p1 ' + deepP1 + ' + p2 ' + deepP2 + ')');

  // Pane content below the list (article + bottom) shoved down by the growth, present in part 2.
  const artY = slot + PIS_TOTAL + 400;           // 400px into the article, now shoved down
  check('pane article shoved below the unrolled list (present in part 2, y' + artY + ')',
    near(abs(x, artY), PIS.article(4), 12), abs(x, artY).join(','));
  const botP2 = countRowsWithColor(segs[1], x, 0, segs[1].h, PIS.bottom, 8);
  check('pane BOTTOM MARKER present at the very end (~' + PIS_BOTTOM + ' rows, part 2)',
    Math.abs(botP2 - PIS_BOTTOM) <= 3, botP2 + ' rows');
  check('pane bottom marker sits at the very bottom of the grown canvas',
    near(pxAt(segs[1], x, segs[1].h - 20), PIS.bottom), pxAt(segs[1], x, segs[1].h - 20).join(','));

  // Fully packed: no white band + no render-window spacer left in the list, either part
  // (a growth-shift regression on the pane frames or a dropped straddle leaves white here).
  const whiteP1 = countRowsWithColor(segs[0], x, PIS_SHELL_H, segs[0].h, WHITE, 2);
  check('part 1 fully packed below the shell -- no white gap', whiteP1 <= 1, whiteP1 + ' white rows');
  const whiteP2 = countRowsWithColor(segs[1], x, 0, segs[1].h, WHITE, 2);
  check('part 2 fully packed -- no white gap', whiteP2 <= 1, whiteP2 + ' white rows');
  const szP1 = countRowsWithColor(segs[0], x, slot, segs[0].h, PIS.sizerBg, 4);
  const szP2 = countRowsWithColor(segs[1], x, 0, Math.max(0, slot + PIS_TOTAL - h1), PIS.sizerBg, 4);
  check('no render-window spacer band left in the unrolled list (both parts)',
    szP1 + szP2 <= 2, (szP1 + szP2) + ' spacer rows');
}



/* ========== scenario: MULTI-LIST pane — TWO inline slots in ONE app-shell pane (v1.9.11) ==========
   Two embedded virtualized lists inside the SAME app-shell pane, BOTH inline-
   unrolled. This drives the stitcher's MULTI-slot growth ACCUMULATION in the pane
   coordinate frame: inlineRegions is built by sorting the slots by slotTop and
   carrying a CUMULATIVE offset (off += g.growth per slot), so list B's slot must
   land at slotTop_B + growth_A, and everything below list B (mid chrome, article,
   bottom) must shift by growth_A + growth_B. Every prior pane-inline scenario
   (s30-s33) had exactly ONE inline slot per pane, so N>1 accumulation across two
   slots in a pane was structurally covered but UNTESTED. The two lists have
   DIFFERENT totals (4000 / 3000 => growth 3500 / 2500) so a bug that doubles one
   growth instead of summing the two is caught. A tall pane tail (article 6000)
   keeps the PANE the scroll root — paneRange 6996 out-ranges BOTH lists
   (3500, 2500) — so both lists stay INLINE slots, not the main pane. Single part
   (grown canvas 13716 < 16000). Colours for the two lists (rows + deep sentinels
   + sizer backgrounds) are DISTINCT so each list's presence is verified separately
   and each deep sentinel is counted exactly once. */

const MLP = {
  shell:   [50, 40, 80],               // app-shell top chrome (kept once)
  paneHdr: [40, 60, 150],              // pane header, above list A
  rowA: i => (i % 2 ? [120, 180, 230] : [80, 150, 200]),   // list A rows
  sizerA:  [235, 238, 245],            // list A render-window spacer bg
  deepA:   [255, 120, 0],              // list A bottom sentinel (orange)
  mid:     [120, 40, 160],             // chrome band BETWEEN the two lists (single, non-periodic)
  rowB: i => (i % 2 ? [70, 200, 170] : [40, 160, 140]),    // list B rows (distinct greens/teals)
  sizerB:  [210, 250, 225],            // list B render-window spacer bg
  deepB:   [230, 20, 90],              // list B bottom sentinel (magenta — distinct from deepA)
  article: i => [190 - (i % 5) * 8, 110, 70 + (i % 5) * 8], // pane content below list B
  bottom:  [0, 180, 120]               // pane bottom marker, at the very end
};
const MLP_SHELL_H = PL_HEADER_H;             // 64  shell chrome
const MLP_PH      = PL_PH;                   // 200 pane header (above list A)
const MLP_VIEW    = PL_VIEW;                 // 500 each list compact window
const MLP_OVER    = PL_OVER;                 // 60  overscan
const MLP_ROWH    = PL_ROWH;                 // 40
const MLP_TOTAL_A = 4000;                    // list A full content (growth 3500)
const MLP_MID_H   = 300;                     // chrome band between the two lists
const MLP_TOTAL_B = 3000;                    // list B full content (growth 2500 — DIFFERENT from A)
const MLP_ARTICLE = 6000;                    // pane content below list B (keeps the pane the root)
const MLP_BOTTOM  = 152;                     // pane bottom marker
const MLP_DEEP_A_FROM = MLP_TOTAL_A - 200;   // 3800..4000 list A deep sentinel band
const MLP_DEEP_B_FROM = MLP_TOTAL_B - 200;   // 2800..3000 list B deep sentinel band
const MLP_LIST0_A = 1500;                    // list A initial scroll (user mid-scroll)
const MLP_LIST0_B = 900;                     // list B initial scroll (distinct — tests independent restore)
// pane-content Y layout (compact)
const MLP_A_TOP   = MLP_PH;                       // 200  list A slot top
const MLP_MID_TOP = MLP_A_TOP + MLP_VIEW;         // 700  mid chrome top
const MLP_B_TOP   = MLP_MID_TOP + MLP_MID_H;      // 1000 list B slot top
const MLP_ART_TOP = MLP_B_TOP + MLP_VIEW;         // 1500 article top
const MLP_BOT_TOP = MLP_ART_TOP + MLP_ARTICLE;    // 7500 bottom top
const MLP_PANE_CONTENT = MLP_BOT_TOP + MLP_BOTTOM;// 7652 pane content height

function mlpBuildList(pane, doc, win, id, topY, total) {
  const vlist = pane.appendChild(new El('div', doc, { clientH: MLP_VIEW, clientW: VP_W }));
  vlist.id = id;
  vlist.setAttribute('style', 'overflow-y:auto;height:500px');
  // list screen rect tracks BOTH window and pane scroll (the list's own scroll
  // moves content INSIDE the window, handled in render, not the rect top)
  vlist._rect = () => ({ left: 0, top: (MLP_SHELL_H - win.scrollY) + (topY - pane.scrollTop), width: VP_W, height: MLP_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: total, clientW: VP_W }));
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((MLP_VIEW + 2 * MLP_OVER) / MLP_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: MLP_ROWH, clientW: VP_W }));
    r.setAttribute('style', 'position:absolute');
  }
  return vlist;
}

function buildMultiListPane() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('header', doc, { clientH: MLP_SHELL_H, clientW: VP_W }));   // shell chrome
  const pane = body.appendChild(new El('main', doc, { clientH: PL_PANE_H, clientW: VP_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: 0, top: MLP_SHELL_H - win.scrollY, width: VP_W, height: PL_PANE_H });

  pane.appendChild(new El('div', doc, { clientH: MLP_PH, clientW: VP_W }));   // pane header
  const vlistA = mlpBuildList(pane, doc, win, 'vlistA', MLP_A_TOP, MLP_TOTAL_A);   // inline slot 1
  pane.appendChild(new El('div', doc, { clientH: MLP_MID_H, clientW: VP_W }));  // mid chrome between the lists
  const vlistB = mlpBuildList(pane, doc, win, 'vlistB', MLP_B_TOP, MLP_TOTAL_B);   // inline slot 2 (different total)
  pane.appendChild(new El('div', doc, { clientH: MLP_ARTICLE, clientW: VP_W }));   // article below list B
  pane.appendChild(new El('div', doc, { clientH: MLP_BOTTOM, clientW: VP_W }));    // bottom marker

  // the pane scrolls (its content >> its viewport); the document itself does not
  body._base.contentH = () => MLP_SHELL_H + pane.clientHeight;
  html._base.contentH = () => body.clientHeight;

  pane.scrollTop = 0;
  vlistA.scrollTop = MLP_LIST0_A;   // both lists start mid-scroll
  vlistB.scrollTop = MLP_LIST0_B;
  win.scrollY = 0;

  const realizedA = cr => cr >= vlistA.scrollTop - MLP_OVER && cr < vlistA.scrollTop + MLP_VIEW + MLP_OVER && cr >= 0 && cr < MLP_TOTAL_A;
  const realizedB = cr => cr >= vlistB.scrollTop - MLP_OVER && cr < vlistB.scrollTop + MLP_VIEW + MLP_OVER && cr >= 0 && cr < MLP_TOTAL_B;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = MLP_SHELL_H - win.scrollY;
    const colorAt = (cy) => {
      if (cy < 0) return WHITE;
      if (cy < MLP_A_TOP) return MLP.paneHdr;                 // pane header
      if (cy < MLP_MID_TOP) {                                 // list A viewport band
        const cr = vlistA.scrollTop + (cy - MLP_A_TOP);
        if (realizedA(cr)) return cr >= MLP_DEEP_A_FROM ? MLP.deepA : MLP.rowA(Math.floor(cr / MLP_ROWH));
        return MLP.sizerA;
      }
      if (cy < MLP_B_TOP) return MLP.mid;                     // mid chrome
      if (cy < MLP_ART_TOP) {                                 // list B viewport band
        const cr = vlistB.scrollTop + (cy - MLP_B_TOP);
        if (realizedB(cr)) return cr >= MLP_DEEP_B_FROM ? MLP.deepB : MLP.rowB(Math.floor(cr / MLP_ROWH));
        return MLP.sizerB;
      }
      if (cy < MLP_BOT_TOP) return MLP.article(Math.floor((cy - MLP_ART_TOP) / 100));
      if (cy < MLP_PANE_CONTENT) return MLP.bottom;
      return WHITE;
    };
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + PL_PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const cy = pane.scrollTop + (dy - paneTop);
      fillRect(img, 0, dy, VP_W, 1, colorAt(Math.floor(cy)));
    }
    fillRect(img, 0, Math.max(0, -win.scrollY), VP_W, MLP_SHELL_H, MLP.shell);   // shell chrome, kept once
    return img;
  }
  return { name: 'multilistpane', doc, html, body, win, render, dpr, bannerH: 0, refs: { pane, vlistA, vlistB } };
}

function expectMultiListPane(seg, state, segs) {
  const EXP_H = MLP_SHELL_H + MLP_PH + MLP_TOTAL_A + MLP_MID_H + MLP_TOTAL_B + MLP_ARTICLE + MLP_BOTTOM;  // 13716
  const x = 640;
  const growthA = MLP_TOTAL_A - MLP_VIEW;                 // 3500
  const growthB = MLP_TOTAL_B - MLP_VIEW;                 // 2500
  const slotA = MLP_SHELL_H + MLP_A_TOP;                  // 264  (no growth above list A)
  const slotB = MLP_SHELL_H + MLP_B_TOP + growthA;        // 4564 (list B shifted by growth_A — the cumulative step)

  check('app-shell pane capture (meta.rootRect present)', !!state.meta.rootRect, JSON.stringify(state.meta.rootRect));
  check('TWO embedded lists flagged inline (meta.inlinePanes length 2, docY ' + MLP_A_TOP + ' + ' + MLP_B_TOP + ' in pane space)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 2 &&
       state.meta.inlinePanes.some(p => p.docY === MLP_A_TOP) &&
       state.meta.inlinePanes.some(p => p.docY === MLP_B_TOP)),
    JSON.stringify(state.meta.inlinePanes));
  check('pane grown at BOTH slots — single ' + EXP_H + 'px part (both lists unrolled inline)',
    segs.length === 1 && seg.w === VP_W && seg.h === EXP_H, seg.w + 'x' + segs.map(s => s.h).join('+'));

  check('shell chrome kept once at the top (~' + MLP_SHELL_H + ' rows)',
    Math.abs(countRowsWithColor(seg, x, 0, seg.h, MLP.shell) - MLP_SHELL_H) <= 3,
    countRowsWithColor(seg, x, 0, seg.h, MLP.shell) + ' rows');
  check('pane header present between shell and list A (~' + MLP_PH + ' rows)',
    Math.abs(countRowsWithColor(seg, x, 0, seg.h, MLP.paneHdr) - MLP_PH) <= 3,
    countRowsWithColor(seg, x, 0, seg.h, MLP.paneHdr) + ' rows');

  // ---- list A unrolled at slotA (no growth above it) ----
  check('list A TOP window present inline (row 0 at slot A top)',
    near(pxAt(seg, x, slotA + 20), MLP.rowA(0)), pxAt(seg, x, slotA + 20).join(','));
  check('list A MID content present inline (cr 2000 — beyond the visible window)',
    near(pxAt(seg, x, slotA + 2000), MLP.rowA(Math.floor(2000 / MLP_ROWH))), pxAt(seg, x, slotA + 2000).join(','));
  const deepAY = slotA + MLP_DEEP_A_FROM + 40;           // 4104
  check('list A DEEP SENTINEL present inline (cr ' + (MLP_DEEP_A_FROM + 40) + ' — reached only by unrolling A)',
    near(pxAt(seg, x, deepAY), MLP.deepA), pxAt(seg, x, deepAY).join(','));

  // ---- mid chrome shifted DOWN by growth_A (first cumulative step; non-periodic colour, no alias) ----
  const midY = slotA + MLP_TOTAL_A + 40;                 // 4304 — just after list A's full unroll
  check('mid chrome present just below list A, shifted down by growth_A (y' + midY + ')',
    near(pxAt(seg, x, midY), MLP.mid), pxAt(seg, x, midY).join(','));

  // ---- list B unrolled at slotB = slotTop_B + growth_A (proves CUMULATIVE placement) ----
  check('list B TOP window present inline at slotB (row 0, shifted by growth_A)',
    near(pxAt(seg, x, slotB + 20), MLP.rowB(0)), pxAt(seg, x, slotB + 20).join(','));
  check('list B MID content present inline (cr 1500 — beyond the visible window)',
    near(pxAt(seg, x, slotB + 1500), MLP.rowB(Math.floor(1500 / MLP_ROWH))), pxAt(seg, x, slotB + 1500).join(','));
  const deepBY = slotB + MLP_DEEP_B_FROM + 40;           // 7404
  check('list B DEEP SENTINEL present inline (cr ' + (MLP_DEEP_B_FROM + 40) + ' — reached only by unrolling B)',
    near(pxAt(seg, x, deepBY), MLP.deepB), pxAt(seg, x, deepBY).join(','));

  // ---- article + bottom shifted by growth_A + growth_B (full cumulative offset) ----
  const artY = slotB + MLP_TOTAL_B + 400;                // 7964 — 400px into the article
  check('pane article shoved below BOTH unrolled lists (present at y' + artY + ')',
    near(pxAt(seg, x, artY), MLP.article(4), 12), pxAt(seg, x, artY).join(','));
  const botRows = countRowsWithColor(seg, x, 0, seg.h, MLP.bottom);
  check('pane BOTTOM MARKER present at the very end (~' + MLP_BOTTOM + ' rows)',
    Math.abs(botRows - MLP_BOTTOM) <= 3, botRows + ' rows');
  check('pane bottom marker sits at the very bottom of the grown canvas',
    near(pxAt(seg, x, seg.h - 20), MLP.bottom), pxAt(seg, x, seg.h - 20).join(','));

  // ---- fully packed + no spacer band left in either list ----
  const whiteRows = countRowsWithColor(seg, x, MLP_SHELL_H, seg.h, WHITE, 2);
  check('unrolled pane fully packed below the shell — no white gap', whiteRows === 0, whiteRows + ' white rows');
  const szA = countRowsWithColor(seg, x, slotA, slotA + MLP_TOTAL_A, MLP.sizerA, 4);
  check('no render-window spacer band left in list A', szA <= 2, szA + ' spacer rows');
  const szB = countRowsWithColor(seg, x, slotB, slotB + MLP_TOTAL_B, MLP.sizerB, 4);
  check('no render-window spacer band left in list B', szB <= 2, szB + ' spacer rows');

  // ---- each deep sentinel present EXACTLY once, distinct colours (catches dup/loss on either slot) ----
  const deepARows = countRowsWithColor(seg, x, 0, seg.h, MLP.deepA);
  check('list A deep sentinel appears exactly once (~200 rows)', Math.abs(deepARows - 200) <= 4, deepARows + ' rows');
  const deepBRows = countRowsWithColor(seg, x, 0, seg.h, MLP.deepB);
  check('list B deep sentinel appears exactly once (~200 rows)', Math.abs(deepBRows - 200) <= 4, deepBRows + ' rows');
}


/* ========== scenario: pane-embedded inline list BESIDE A FIXED RAIL and TALL enough to force a CANVAS SPLIT (compose s32 + s33, v1.9.11) ==========
   Composes paneinlinerail (s32: a pane-embedded inline-unrolled list beside a
   fixed side rail, with auto-redaction across all THREE coordinate frames --
   rail, pane, inline list) with paneinlinesplit (s33: the pane-embedded list
   unrolls so tall the grown canvas exceeds the 16000px edge, forcing a 2-part
   split whose cut lands INSIDE the unrolled list). The question this answers:
   does the fixed rail's INDEPENDENT-column draw plus its sideDraw-routed
   redaction compose with the canvas split WHILE the pane-frame region-clip and
   the inline-window injection straddle the cut? All four draw at (pos - segTop)
   clipped to [0, segH] (result.js pane branch ~320-368 plus the redaction bake
   ~437-468), so this is expected to be a test-only LOCK-IN, earned by teeth.

   Geometry constraints:
   (i) findScrollRoot dominance -- the PANE must out-range the list so the pane
       stays the scroll root and the list stays an inline slot: the article tail
       makes paneRange (15704) greater than listRange (15500), margin 204. The
       rail is a fixed side element (range 1200), never a root candidate.
   (ii) the rail sits LEFT of an OFFSET pane (x=300) -- the pane branch draws the
        rail BEFORE the pane, so a full-width pane would overpaint it.
   (iii) the cut: with a rail present, the quiet-row finder's strip
         (findQuietRowInCanvas SCALES the full canvas width into a 400px strip,
         it does NOT crop to the left 400px) is never uniform -- the white rail
         column and the striped pane column differ -- so NO quiet row is found
         near the target and the cut falls at the HARD 16000 edge. The list
         (16000 tall) spans canvas [264, 16264], so the 16000 cut lands 264px
         above the list bottom, INSIDE the list; the deep sentinel (list content
         15800..16000 -> canvas 16064..16264) and the article + bottom are shoved
         into part 2. Grown canvas 31924 -> parts 16000 + 15924.
   Reuses the s32 rail palette/constants (PIRL_*) + the s32 pane-PII palette
   (PIR) + its email/ssn/phone content-ys; only the tall list geometry (RIS_*)
   and the DEEP list-card content-y are new. */

const RIS = {
  shell:   [50, 40, 80],               // app-shell top chrome (kept once)
  paneHdr: [40, 60, 150],              // pane header, above the list
  row: i => (i % 2 ? [120, 180, 230] : [80, 150, 200]),
  sizerBg: [235, 238, 245],
  deep:    [255, 120, 0],              // list bottom sentinel -- reached only by unroll (part 2)
  article: i => [190 - (i % 5) * 8, 110, 70 + (i % 5) * 8],   // pane content below the list
  bottom:  [0, 180, 120]               // pane bottom marker, at the very end
};
const RIS_SHELL_H = 64;                      // shell chrome
const RIS_PANE_H  = VP_H - RIS_SHELL_H;      // 656 -- pane viewport
const RIS_PH      = 200;                     // pane header (inside the pane, above the list)
const RIS_VIEW    = 500;                     // list compact window (clientH)
const RIS_OVER    = 60;                      // list overscan
const RIS_TOTAL   = 16000;                   // list full content -- TALL: spans canvas [264,16264], straddles the 16000 cut
const RIS_ROWH    = 40;
const RIS_DEEP_FROM = RIS_TOTAL - 200;       // 15800..16000 deep sentinel band (canvas 16064..16264 -> part 2)
const RIS_ARTICLE = 15500;                   // pane content below the list -- tail keeps paneRange (15704) > listRange (15500)
const RIS_BOTTOM  = 160;                     // pane bottom marker
const RIS_LIST0   = 1500;                    // user had scrolled the list to the middle
const RIS_CARD_CY = 15000;                   // list DEEP PII content-y (part 1: canvas 15264, clear of the cut, straddle probes, and the deep band)

function buildRailInlineSplit() {
  const dpr = 1;
  const doc = new Doc();
  const html = new El('html', doc, { clientH: VP_H, clientW: VP_W });
  const body = new El('body', doc, { clientW: VP_W });
  doc.documentElement = html; doc.body = body; html.appendChild(body);
  const win = makeWindow(doc, { w: VP_W, h: VP_H, dpr });

  body.appendChild(new El('header', doc, { clientH: RIS_SHELL_H, clientW: VP_W }));   // shell chrome (full width)

  // main pane (scroll root), OFFSET to the right of the fixed rail
  const pane = body.appendChild(new El('main', doc, { clientH: RIS_PANE_H, clientW: PIRL_PANE_W }));
  pane.id = 'pane';
  pane.setAttribute('style', 'overflow-y:auto');
  pane._rect = () => ({ left: PIRL_PANE_X, top: RIS_SHELL_H - win.scrollY, width: PIRL_PANE_W, height: RIS_PANE_H });

  const paneHdr = pane.appendChild(new El('div', doc, { clientH: RIS_PH, clientW: PIRL_PANE_W }));   // pane header (fixed height)

  const vlist = pane.appendChild(new El('div', doc, { clientH: RIS_VIEW, clientW: PIRL_PANE_W }));
  vlist.id = 'vlist';
  vlist.setAttribute('style', 'overflow-y:auto;height:500px');
  vlist._rect = () => ({ left: PIRL_PANE_X, top: (RIS_SHELL_H - win.scrollY) + (RIS_PH - pane.scrollTop), width: PIRL_PANE_W, height: RIS_VIEW });
  const sizer = vlist.appendChild(new El('div', doc, { clientH: RIS_TOTAL, clientW: PIRL_PANE_W }));
  sizer.id = 'vlistSizer';
  sizer.setAttribute('style', 'position:relative');
  const REALIZED = Math.ceil((RIS_VIEW + 2 * RIS_OVER) / RIS_ROWH);
  for (let i = 0; i < REALIZED; i++) {
    const r = sizer.appendChild(new El('div', doc, { clientH: RIS_ROWH, clientW: PIRL_PANE_W }));
    r.setAttribute('style', 'position:absolute');
  }

  // list PII leaves (inside the list -> inline boxes): email in the user's window
  // (part 1) + a DEEP card (part 1, reached only by unrolling).
  const listPII = [
    { cy: PIR_EMAIL_CY, h: 40, color: PIR.email, text: 'Email: jane.doe@example.com' },
    { cy: RIS_CARD_CY,  h: 40, color: PIR.card,  text: 'Card 4242 4242 4242 4242' }
  ];
  for (const it of listPII) {
    const el = sizer.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.setAttribute('style', 'position:absolute');
    el.textContent = it.text;
    el._rect = () => ({ left: PIRL_PANE_X + 40, top: (RIS_SHELL_H - win.scrollY) + (RIS_PH - pane.scrollTop) + it.cy - vlist.scrollTop, width: 600, height: it.h });
    it.el = el;
  }

  const article = pane.appendChild(new El('div', doc, { clientH: RIS_ARTICLE, clientW: PIRL_PANE_W }));   // article below the list (fixed height)
  pane.appendChild(new El('div', doc, { clientH: RIS_BOTTOM, clientW: PIRL_PANE_W }));    // bottom marker

  // pane-content PII leaves (NON-inline pane boxes), nested in fixed-height hosts so
  // absolute leaves don't inflate the pane's content height (session-18 tripwire).
  // ssn: pane header (above the slot, region 0). phone: article band just below the
  // slot -- shifted by the growth, lands in PART 2 (the frame-pin across the split).
  const panePII = [
    { py: PIR_SSN_PY,   h: 40, color: PIR.ssn,   text: 'SSN 123-45-6789',       host: paneHdr },
    { py: PIR_PHONE_PY, h: 40, color: PIR.phone, text: 'Call +1 (555) 123-4567', host: article }
  ];
  for (const it of panePII) {
    const el = it.host.appendChild(new El('div', doc, { clientH: it.h, clientW: 600 }));
    el.setAttribute('style', 'position:absolute');
    el.textContent = it.text;
    el._rect = () => ({ left: PIRL_PANE_X + 40, top: (RIS_SHELL_H - win.scrollY) + (it.py - pane.scrollTop), width: 600, height: it.h });
    it.el = el;
  }

  // fixed left rail (identical to s32): fixed wrapper + inner scroller, BELOW the shell header.
  const railTop = RIS_SHELL_H;   // 64 -- viewport-anchored, just below the header (all rail content lands in part 1)
  const railWrap = body.appendChild(new El('div', doc, { clientH: PIRL_RAIL_H, clientW: PIRL_RAIL_W }));
  railWrap.id = 'railWrap';
  railWrap.setAttribute('style', 'position:fixed;left:0;top:' + railTop + 'px');
  railWrap._rect = () => ({ left: 0, top: railTop, width: PIRL_RAIL_W, height: PIRL_RAIL_H });
  const rail = railWrap.appendChild(new El('div', doc, { clientH: PIRL_RAIL_H, clientW: PIRL_RAIL_W, contentH: PIRL_RAIL_CONTENT_H }));
  rail.id = 'rail';
  rail.setAttribute('style', 'overflow-y:auto;height:' + PIRL_RAIL_H + 'px');
  rail._rect = () => ({ left: 0, top: railTop, width: PIRL_RAIL_W, height: PIRL_RAIL_H });

  const railPII = [
    { cy: PIRL_REMAIL_CY, h: 40, color: PIRL.railEmail, text: 'Email: rae@example.com',    pii: true },
    { cy: PIRL_RCARD_CY,  h: 40, color: PIRL.railCard,  text: 'Card 4242 4242 4242 4242',   pii: true },
    { cy: PIRL_RDECOY_CY, h: 40, color: PIRL.railDecoy, text: 'Order 1234 5678 9012 3456',  pii: false }
  ];
  for (const it of railPII) {
    const el = rail.appendChild(new El('div', doc, { clientH: it.h, clientW: PIRL_IT_W }));
    el.textContent = it.text;
    el._rect = () => ({ left: PIRL_IT_L, top: railTop + (it.cy - rail.scrollTop), width: PIRL_IT_W, height: it.h });
    it.el = el;
  }

  body._base.contentH = () => RIS_SHELL_H + pane.clientHeight;
  html._base.contentH = () => body.clientHeight;

  pane.scrollTop = 0;
  vlist.scrollTop = RIS_LIST0;
  rail.scrollTop = PIRL_RAIL0;
  win.scrollY = 0;

  const realized = cr => cr >= vlist.scrollTop - RIS_OVER &&
                         cr < vlist.scrollTop + RIS_VIEW + RIS_OVER &&
                         cr >= 0 && cr < RIS_TOTAL;

  function render() {
    const img = makeBuf(VP_W, VP_H);
    const paneTop = RIS_SHELL_H - win.scrollY;
    const artTop = RIS_PH + RIS_VIEW;
    const colorAt = (cy) => {
      if (cy < 0) return WHITE;
      if (cy < RIS_PH) return RIS.paneHdr;
      if (cy < artTop) {
        const cr = vlist.scrollTop + (cy - RIS_PH);
        if (realized(cr)) return cr >= RIS_DEEP_FROM ? RIS.deep : RIS.row(Math.floor(cr / RIS_ROWH));
        return RIS.sizerBg;
      }
      const a = cy - artTop;
      if (a < RIS_ARTICLE) return RIS.article(Math.floor(a / 100));
      if (a < RIS_ARTICLE + RIS_BOTTOM) return RIS.bottom;
      return WHITE;
    };
    // pane column (x >= PANE_X) -- the offset scroll root
    const py0 = Math.max(0, paneTop), py1 = Math.min(VP_H, paneTop + RIS_PANE_H);
    for (let dy = py0; dy < py1; dy++) {
      const cy = pane.scrollTop + (dy - paneTop);
      let col = colorAt(Math.floor(cy));
      for (const it of panePII) {                       // pane-content PII (header/article)
        if (cy >= it.py && cy < it.py + it.h) { col = it.color; break; }
      }
      if (cy >= RIS_PH && cy < artTop) {                // list-content PII (only in the realized window)
        const cr = vlist.scrollTop + (cy - RIS_PH);
        if (realized(cr)) {
          for (const it of listPII) {
            if (cr >= it.cy && cr < it.cy + it.h) { col = it.color; break; }
          }
        }
      }
      fillRect(img, PIRL_PANE_X, dy, PIRL_PANE_W, 1, col);
    }
    // fixed left rail column (x in [0, PANE_X)), viewport-anchored, honors hide/unhide
    if (!hiddenNow(rail)) {
      for (let vy = 0; vy < PIRL_RAIL_H; vy++) {
        const nr = rail.scrollTop + vy;                 // rail content-y
        if (nr < 0 || nr >= PIRL_RAIL_CONTENT_H) continue;
        let col = PIRL.railbg;
        for (const it of railPII) {
          if (nr >= it.cy && nr < it.cy + it.h) { col = it.color; break; }
        }
        fillRect(img, 0, railTop + vy, PIRL_RAIL_W, 1, col);
      }
    }
    fillRect(img, 0, Math.max(0, -win.scrollY), VP_W, RIS_SHELL_H, RIS.shell);   // shell chrome, kept once (full width)
    return img;
  }
  return { name: 'railinlinesplit', doc, html, body, win, render, dpr, bannerH: 0, refs: { pane, vlist, rail }, listPII, panePII, railPII };
}

function expectRailInlineSplit(seg, state, segs, out) {
  /* standing regression — see the banner above gradeScanLedger */
  gradeScanLedger('railinlinesplit', state.meta.piiScan);
  gradeActs('railinlinesplit', (out && out.record) || {}, 6, state.meta.piiScan, segs);
  gradeRequested('railinlinesplit', (out && out.record) || {}, true);
  check('railinlinesplit: the honest case gets the counts on the page and no toast at all',
    !!out && /matched, \d+ painted, \d+ confirmed opaque/i.test(String((out.lines || []).join(' '))) &&
    out.toasts.length === 0,
    JSON.stringify({ lines: out && out.lines, toasts: out && out.toasts }));
  const EXP_H = RIS_SHELL_H + RIS_PH + RIS_TOTAL + RIS_ARTICLE + RIS_BOTTOM;   // 64+200+16000+15500+160 = 31924
  const slot = RIS_SHELL_H + RIS_PH;               // 264 -- list slot top in the canvas
  const growth = RIS_TOTAL - RIS_VIEW;             // 15500
  const B = PIR.block;
  const xPane = 640;                               // pane/list/article column (leaves span 338..942)
  const xRail = 150;                               // rail column (0..300), item band 18..282
  const abs = (ax, ay) => { let y = ay; for (const s of segs) { if (y < s.h) return pxAt(s, ax, y); y -= s.h; } return WHITE; };
  const both = (ax, color, tol) => countRowsWithColor(segs[0], ax, 0, segs[0].h, color, tol) +
                                   countRowsWithColor(segs[1], ax, 0, segs[1].h, color, tol);
  const rowColAt = cr => (cr >= RIS_DEEP_FROM ? RIS.deep : RIS.row(Math.floor(cr / RIS_ROWH)));

  // ---- all three frames captured + the pane-embedded unroll forced a 2-part split ----
  check('all three frames captured (inlinePanes=1 AND sidePanes=1 at x=0)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes.length === 1 &&
       state.meta.sidePanes && state.meta.sidePanes.length === 1 && state.meta.sidePanes[0].x === 0),
    'inline=' + JSON.stringify(state.meta.inlinePanes) + ' side=' + JSON.stringify(state.meta.sidePanes));
  check('embedded list flagged inline (docY=' + RIS_PH + ' in pane space)',
    !!(state.meta.inlinePanes && state.meta.inlinePanes[0].docY === RIS_PH), JSON.stringify(state.meta.inlinePanes));
  check('pane-embedded unroll exceeded the canvas edge -> EXACTLY 2 parts summing to ' + EXP_H,
    segs.length === 2 && segs[0].h + segs[1].h === EXP_H, segs.map(s => s.h).join(' + '));
  const h1 = segs[0].h;
  check('part-1 cut falls INSIDE the unrolled pane-embedded list (' + slot + ' < h1 < ' + (slot + RIS_TOTAL) + ')',
    h1 > slot && h1 < slot + RIS_TOTAL && h1 > 15000, 'h1=' + h1);

  // ---- redaction meta: 6 boxes across all THREE frames (2 rail pane-tagged + 2 inline + 2 pane), matching s32 ----
  check('meta.piiBoxes = 6 (2 rail pane-tagged + 2 inline + 2 pane)',
    !!state.meta.piiBoxes && state.meta.piiBoxes.length === 6 &&
    state.meta.piiBoxes.filter(b => b.pane != null).length === 2 &&
    state.meta.piiBoxes.filter(b => b.inline != null).length === 2,
    state.meta.piiBoxes ? (state.meta.piiBoxes.length + ' boxes, ' +
      state.meta.piiBoxes.filter(b => b.pane != null).length + ' rail, ' +
      state.meta.piiBoxes.filter(b => b.inline != null).length + ' inline') : 'null');

  // ---- 0-leak for every sensitive item across BOTH parts + all THREE frames ----
  for (const [nm, color, x] of [
       ['rail email', PIRL.railEmail, xRail], ['rail card (DEEP)', PIRL.railCard, xRail],
       ['pane ssn (above slot)', PIR.ssn, xPane], ['pane phone (article band, part 2)', PIR.phone, xPane],
       ['list email (window)', PIR.email, xPane], ['list card (DEEP)', PIR.card, xPane]]) {
    const leak = both(x, color, 6);
    check(nm + ' fully redacted (0 of its colour visible across both parts)', leak === 0, leak + ' rows leaked');
  }

  // ---- rail composes as an INDEPENDENT column, ENTIRELY in part 1, unshifted by the pane's 15500 growth ----
  const decoyRows = both(xRail, PIRL.railDecoy, 6);
  check('rail unrolled independently -- DEEP Luhn decoy present (~40 rows), un-redacted',
    Math.abs(decoyRows - 40) <= 8, decoyRows + ' rows');
  const railEmailY = RIS_SHELL_H + PIRL_REMAIL_CY;   // 184 (part 1)
  check('rail email block at its rail position (y' + railEmailY + ', part 1, NOT shifted by pane growth)',
    countRowsWithColor(segs[0], xRail, railEmailY - 6, railEmailY + 46, B, 6) >= 34, 'near rail email');
  const railCardY = RIS_SHELL_H + PIRL_RCARD_CY;     // 1144 (part 1) -- DEEP rail, still unshifted
  check('rail card block at its DEEP rail position (y' + railCardY + ', part 1)',
    countRowsWithColor(segs[0], xRail, railCardY - 6, railCardY + 46, B, 6) >= 34, 'near rail card');

  // ---- pane + list blocks at their composed part-1 positions ----
  const ssnY = RIS_SHELL_H + PIR_SSN_PY;             // 164 (part 1, region 0, no growth)
  check('pane ssn block at the pane header (y' + ssnY + ', part 1, above slot)',
    countRowsWithColor(segs[0], xPane, ssnY - 6, ssnY + 46, B, 6) >= 34, 'near ssn');
  const emailY = slot + PIR_EMAIL_CY;                // 1784 (part 1) -- inline slot + list y
  check('list email block at the unrolled slot (y' + emailY + ', part 1)',
    countRowsWithColor(segs[0], xPane, emailY - 6, emailY + 46, B, 6) >= 34, 'near list email');
  const cardY = slot + RIS_CARD_CY;                  // 15264 (part 1) -- DEEP inline
  check('list card block at the DEEP unrolled position (y' + cardY + ', part 1)',
    countRowsWithColor(segs[0], xPane, cardY - 6, cardY + 46, B, 6) >= 34, 'near list card');

  // ---- pane phone block SHIFTED by the growth into PART 2 (the pane-box frame-pin, now across the split) ----
  const phoneAbsY = RIS_SHELL_H + PIR_PHONE_PY + growth;   // 64+710+15500 = 16274 (part 2)
  const phoneLocalY = phoneAbsY - h1;
  check('pane phone block SHIFTED by growth into part 2 (canvasY ' + phoneAbsY + ', localY ' + phoneLocalY + ')',
    countRowsWithColor(segs[1], xPane, phoneLocalY - 6, phoneLocalY + 46, B, 6) >= 34, 'near phone');

  // ---- the pane-embedded list STRADDLES the cut: content flows continuously across the 16000 edge ----
  check('list TOP window present inline (row 0 at slot top, part 1)',
    near(abs(xPane, slot + 20), RIS.row(0)), abs(xPane, slot + 20).join(','));
  check('list MID content present inline (cr 8000 -- beyond the visible window)',
    near(abs(xPane, slot + 8000), rowColAt(8000)), abs(xPane, slot + 8000).join(','));
  for (const d of [4, 40, 120]) {
    const crA = (h1 - d) - slot;             // just above the cut (part-1 bottom)
    check('straddle: part-1 row ' + d + 'px above the cut is the right list colour (cr ' + crA + ')',
      near(pxAt(segs[0], xPane, h1 - d), rowColAt(crA)), pxAt(segs[0], xPane, h1 - d).join(',') + ' vs ' + rowColAt(crA).join(','));
    const crB = (h1 + d) - slot;             // just below the cut (part-2 top)
    check('straddle: part-2 row ' + d + 'px below the cut is the right list colour (cr ' + crB + ')',
      near(pxAt(segs[1], xPane, d), rowColAt(crB)), pxAt(segs[1], xPane, d).join(',') + ' vs ' + rowColAt(crB).join(','));
  }
  check('straddle: part 2 opens on list ink, no white gap at the cut',
    !near(pxAt(segs[1], xPane, 0), WHITE) && !near(pxAt(segs[1], xPane, 3), WHITE), pxAt(segs[1], xPane, 0).join(','));

  // ---- deep sentinel (only reachable by unrolling) lands in part 2, exactly once ----
  check('list DEEP SENTINEL present after the split (cr ' + (RIS_DEEP_FROM + 40) + ', part 2)',
    near(abs(xPane, slot + RIS_DEEP_FROM + 40), RIS.deep), abs(xPane, slot + RIS_DEEP_FROM + 40).join(','));
  const deepRows = both(xPane, RIS.deep, 8);
  check('deep sentinel appears EXACTLY once across both parts (~200 rows, no dup/loss)',
    Math.abs(deepRows - 200) <= 6, deepRows + ' rows');

  // ---- pane content below the list (article + bottom) shoved into part 2 ----
  const artAbsY = slot + RIS_TOTAL + 400;            // 400px into the article, now shoved below the unrolled list
  check('pane article shoved below the unrolled list (present in part 2, canvasY ' + artAbsY + ')',
    near(abs(xPane, artAbsY), RIS.article(4), 12), abs(xPane, artAbsY).join(','));
  const botP2 = countRowsWithColor(segs[1], xPane, 0, segs[1].h, RIS.bottom, 8);
  check('pane BOTTOM MARKER present at the very end (~' + RIS_BOTTOM + ' rows, part 2)',
    Math.abs(botP2 - RIS_BOTTOM) <= 6, botP2 + ' rows');
  check('pane bottom marker sits at the very bottom of the grown canvas',
    near(pxAt(segs[1], xPane, segs[1].h - 20), RIS.bottom), pxAt(segs[1], xPane, segs[1].h - 20).join(','));

  // ---- fully packed, no render-window spacer, either part (the pane column) ----
  const whiteP1 = countRowsWithColor(segs[0], xPane, RIS_SHELL_H, segs[0].h, WHITE, 2);
  check('part 1 fully packed below the shell (pane column) -- no white gap', whiteP1 <= 1, whiteP1 + ' white rows');
  const whiteP2 = countRowsWithColor(segs[1], xPane, 0, segs[1].h, WHITE, 2);
  check('part 2 fully packed (pane column) -- no white gap', whiteP2 <= 1, whiteP2 + ' white rows');
  const szP1 = countRowsWithColor(segs[0], xPane, slot, segs[0].h, RIS.sizerBg, 4);
  const szP2 = countRowsWithColor(segs[1], xPane, 0, Math.max(0, slot + RIS_TOTAL - h1), RIS.sizerBg, 4);
  check('no render-window spacer band left in the unrolled list (both parts)', szP1 + szP2 <= 2, (szP1 + szP2) + ' spacer rows');
}


/* ================= main ================= */

(async () => {
  const only = n => !process.env.FS_ONLY || process.env.FS_ONLY.split(',').includes(n);
  const s1 = buildAppShell({ bannerH: 0, dpr: 1 });
  await runScenario('appshell', s1, (seg, state) => expectAppShell(seg, state, { bannerH: 0, dpr: 1 }));

  const s2 = buildAppShell({ bannerH: 90, dpr: 1 });
  await runScenario('appshell-banner', s2, (seg, state) => expectAppShell(seg, state, { bannerH: 90, dpr: 1 }));

  const s3 = buildAppShell({ bannerH: 90, dpr: 1.25 });
  await runScenario('appshell-dpr125', s3, (seg, state) => expectAppShell(seg, state, { bannerH: 90, dpr: 1.25 }));

  const s4 = buildDocScroll();
  await runScenario('docscroll', s4, expectDocScroll);

  const s5 = buildMultipart();
  await runScenario('multipart', s5, expectMultipart, { segments: 2 });

  const s6 = buildDocWide();
  await runScenario('docwide', s6, (seg, state) => {
    expectDocWide(seg, state);
    check('wide panel scrollLeft restored (300)', s6.refs.wide.scrollLeft === 300,
      'got ' + s6.refs.wide.scrollLeft);
  });

  const s7 = buildRedditLike();
  await runScenario('redditlike', s7, (seg, state, segs) => {
    expectRedditLike(seg, state, segs);
    check('rail scroll restored (500)', s7.refs.rail.scrollTop === 500,
      'got ' + s7.refs.rail.scrollTop);
  }, { segments: 2 });

  const s8 = buildVirtualList();
  await runScenario('virtuallist', s8, (seg, state, segs) => {
    expectVirtualList(seg, state, segs);
    check('vlist scroll restored (1200)', s8.refs.vlist.scrollTop === 1200, 'got ' + s8.refs.vlist.scrollTop);
  });

  const s9 = buildVirtualUnroll();
  await runScenario('virtualunroll', s9, (seg, state, segs) => {
    expectVirtualUnroll(seg, state, segs);
    check('vlist scroll restored (1200)', s9.refs.vlist.scrollTop === 1200, 'got ' + s9.refs.vlist.scrollTop);
  }, { settings: { unrollVirtual: true } });

  const s10 = buildInteractive();
  await runScenario('interactive', s10, (seg, state, segs) => {
    expectInteractive(seg, state, segs);
    check('<details> restored (open attr removed)', s10.refs.details.getAttribute('open') == null,
      String(s10.refs.details.getAttribute('open')));
    check('inactive tab panel restored (aria-hidden + display:none)',
      s10.refs.tabInactive.getAttribute('aria-hidden') === 'true' &&
      /display:\s*none/.test(s10.refs.tabInactive.getAttribute('style') || ''),
      s10.refs.tabInactive.getAttribute('aria-hidden') + ' / ' + s10.refs.tabInactive.getAttribute('style'));
    check('accordion restored ([hidden] + display:none)',
      s10.refs.accordion.getAttribute('hidden') != null &&
      /display:\s*none/.test(s10.refs.accordion.getAttribute('style') || ''),
      s10.refs.accordion.getAttribute('hidden') + ' / ' + s10.refs.accordion.getAttribute('style'));
  }, { settings: { expandInteractive: true } });

  const s11 = buildMultiCarousel();
  await runScenario('multicarousel', s11, expectMultiCarousel);

  const s12 = buildLateImage();
  await runScenario('lateimage', s12, expectLateImage);

  const s13 = buildLazyFooter();
  await runScenario('lazyfooter', s13, expectLazyFooter);

  const s14 = buildOverlay();
  await runScenario('overlay', s14, expectOverlay, { settings: { hideOverlays: true, hideFixed: false } });

  const s15 = buildLoadMore();
  await runScenario('loadmore', s15, expectLoadMore, { settings: { loadMore: true } });
  if (only('loadmore')) check('feed left fully loaded after capture (honest boundary — not un-fetched)',
    s15.refs.getLoaded() === 20, 'loaded=' + s15.refs.getLoaded());

  const s16 = buildInfiniteScroll();
  await runScenario('infinitescroll', s16, expectInfiniteScroll, { settings: { infiniteScroll: true } });
  if (only('infinitescroll')) check('infinite feed left loaded after capture (honest boundary — not un-scrolled)',
    s16.refs.getLoaded() === 24, 'loaded=' + s16.refs.getLoaded());

  const s17 = buildPaneInfinite();
  await runScenario('paneinfinite', s17, expectPaneInfinite, { settings: { infiniteScroll: true } });
  if (only('paneinfinite')) check('pane feed left loaded after capture (honest boundary)',
    s17.refs.getLoaded() === 32, 'loaded=' + s17.refs.getLoaded());

  const s18 = buildPaneLoadMore();
  await runScenario('paneloadmore', s18, expectPaneLoadMore, { settings: { loadMore: true } });
  if (only('paneloadmore')) check('pane feed left fully loaded after capture (honest boundary)',
    s18.refs.getLoaded() === 32, 'loaded=' + s18.refs.getLoaded());

  const s19 = buildSkeleton();
  await runScenario('skeleton', s19, expectSkeleton, { settings: { waitStable: true } });
  if (only('skeleton')) check('data left resolved after capture (honest boundary)',
    s19.refs.getResolved() === true, 'resolved=' + s19.refs.getResolved());

  const s20 = buildLoadMoreLabels();
  await runScenario('loadmorelabels', s20, expectLoadMoreLabels, { settings: { loadMore: true } });
  if (only('loadmorelabels')) {
    check('every real-world "load more" label variant was recognized (feed fully loaded)',
      s20.refs.getStage() === s20.refs.positiveCount, 'stage=' + s20.refs.getStage() + '/' + s20.refs.positiveCount);
    const wrong = Object.keys(s20.refs.decoyClicks).filter(k => s20.refs.decoyClicks[k] > 0);
    check('no destructive/navigation/collapse button was ever clicked (no false positives)',
      wrong.length === 0, wrong.length ? 'WRONGLY CLICKED: ' + wrong.join(', ') : 'none');
  }

  const s21 = buildSingleCarousel();
  await runScenario('singlecarousel', s21, expectSingleCarousel);
  if (only('singlecarousel')) check('carousel scrollLeft restored (0)', s21.refs.carousel.scrollLeft === 0, 'got ' + s21.refs.carousel.scrollLeft);

  const s22 = buildSingleCarousel({ shadow: true });   // cards nested in a shadow root (real-Reddit shape)
  await runScenario('shadowcarousel', s22, expectSingleCarousel);
  if (only('shadowcarousel')) check('carousel scrollLeft restored (0)', s22.refs.carousel.scrollLeft === 0, 'got ' + s22.refs.carousel.scrollLeft);

  const s23 = buildRedact();
  await runScenario('redact', s23, expectRedact, { settings: { redactPII: true } });

  const s23b = buildCanvasRedact();
  await runScenario('canvasredact', s23b, expectCanvasRedact, { settings: { redactPII: true } });

  /* The five placement/ledger scenarios. Plumbing only — see the banner on
     buildSrOnlyRedact for what a fake DOM can and cannot say about layout. */
  await runScenario('sronlyredact', buildSrOnlyRedact(), expectSrOnlyRedact, { settings: { redactPII: true } });
  await runScenario('clipredact', buildClipRedact(), expectClipRedact, { settings: { redactPII: true } });
  await runScenario('declineredact', buildDeclineRedact(), expectDeclineRedact, { settings: { redactPII: true } });
  await runScenario('frameredact', buildFrameRedact(), expectFrameRedact, { settings: { redactPII: true } });
  await runScenario('latetextredact', buildLateTextRedact(), expectLateTextRedact, { settings: { redactPII: true } });

  /* The two UNIT scenarios (s36, s37). One match, several blocks — in both
     directions of the error it caused. */
  await runScenario('wrapcancel', buildWrapCancel(), expectWrapCancel, { settings: { redactPII: true } });
  await runScenario('wrapunread', buildWrapUnread(), expectWrapUnread, { settings: { redactPII: true } });
  /* The two INCOMPLETENESS scenarios (s39, s40). A cap that cuts a match's
     blocks in half, and a budget that cuts the page in half. */
  await runScenario('ceilingstraddle', buildCeilingStraddle(), expectCeilingStraddle, { settings: { redactPII: true } });
  await runScenario('walkbudget', buildWalkBudget(), expectWalkBudget, { settings: { redactPII: true } });
  await runImpossibleActs();
  /* The same four sentences on the surface a person meets a week later. */
  await runHistoryActs();

  const s24 = buildPaneRedact();
  await runScenario('paneredact', s24, expectPaneRedact, { settings: { redactPII: true } });
  if (only('paneredact')) check('pane scroll restored after capture (leave-no-trace)',
    s24.refs.pane.scrollTop === 0, 'scrollTop=' + s24.refs.pane.scrollTop);

  const s25 = buildRailRedact();
  await runScenario('railredact', s25, expectRailRedact, { settings: { redactPII: true } });
  if (only('railredact')) check('rail scroll restored after capture (leave-no-trace)',
    s25.refs.rail.scrollTop === 450, 'scrollTop=' + s25.refs.rail.scrollTop);

  const s26 = buildTokenRedact();
  await runScenario('tokenredact', s26, expectTokenRedact, { settings: { redactPII: true } });

  const s27 = buildInlineRedact();
  await runScenario('inlineredact', s27, expectInlineRedact, { settings: { redactPII: true, unrollVirtual: true } });
  if (only('inlineredact')) check('vlist scroll restored (300) after inline-redact capture (leave-no-trace)',
    Math.abs(s27.refs.vlist.scrollTop - 300) <= 0.65, 'scrollTop=' + s27.refs.vlist.scrollTop);

  const s28 = buildRailInline();
  await runScenario('railinline', s28, expectRailInline, { settings: { unrollVirtual: true } });
  if (only('railinline')) {
    check('vlist scroll restored (300) after rail+inline capture (leave-no-trace)', Math.abs(s28.refs.vlist.scrollTop - 300) <= 0.65, 'scrollTop=' + s28.refs.vlist.scrollTop);
    check('rail scroll restored (450) after rail+inline capture (leave-no-trace)', Math.abs(s28.refs.rail.scrollTop - 450) <= 0.65, 'scrollTop=' + s28.refs.rail.scrollTop);
  }

  const s29 = buildTallUnroll();
  await runScenario('tallunroll', s29, expectTallUnroll, { settings: { unrollVirtual: true }, segments: 2 });
  if (only('tallunroll')) check('vlist scroll restored (300) after tall-unroll split capture (leave-no-trace)',
    Math.abs(s29.refs.vlist.scrollTop - 300) <= 0.65, 'scrollTop=' + s29.refs.vlist.scrollTop);

  const s30 = buildPaneInline();
  await runScenario('paneinline', s30, expectPaneInline, { settings: { unrollVirtual: true } });
  if (only('paneinline')) check('vlist scroll restored (' + PL_LIST0 + ') after pane-inline capture (leave-no-trace)',
    Math.abs(s30.refs.vlist.scrollTop - PL_LIST0) <= 0.65, 'scrollTop=' + s30.refs.vlist.scrollTop);

  const s31 = buildPaneInlineRedact();
  await runScenario('paneinlineredact', s31, expectPaneInlineRedact, { settings: { redactPII: true, unrollVirtual: true } });
  if (only('paneinlineredact')) {
    check('pane scroll restored after pane-inline-redact capture (leave-no-trace)', s31.refs.pane.scrollTop === 0, 'scrollTop=' + s31.refs.pane.scrollTop);
    check('vlist scroll restored (' + PL_LIST0 + ') after pane-inline-redact capture (leave-no-trace)',
      Math.abs(s31.refs.vlist.scrollTop - PL_LIST0) <= 0.65, 'scrollTop=' + s31.refs.vlist.scrollTop);
  }

  const s32 = buildPaneInlineRail();
  await runScenario('paneinlinerail', s32, expectPaneInlineRail, { settings: { redactPII: true, unrollVirtual: true } });
  if (only('paneinlinerail')) {
    check('pane scroll restored after pane-inline-rail capture (leave-no-trace)', s32.refs.pane.scrollTop === 0, 'scrollTop=' + s32.refs.pane.scrollTop);
    check('vlist scroll restored (' + PL_LIST0 + ') after pane-inline-rail capture (leave-no-trace)',
      Math.abs(s32.refs.vlist.scrollTop - PL_LIST0) <= 0.65, 'scrollTop=' + s32.refs.vlist.scrollTop);
    check('rail scroll restored (' + PIRL_RAIL0 + ') after pane-inline-rail capture (leave-no-trace)',
      Math.abs(s32.refs.rail.scrollTop - PIRL_RAIL0) <= 0.65, 'scrollTop=' + s32.refs.rail.scrollTop);
  }

  const s33 = buildPaneInlineSplit();
  await runScenario('paneinlinesplit', s33, expectPaneInlineSplit, { settings: { unrollVirtual: true }, segments: 2 });
  if (only('paneinlinesplit')) {
    check('pane scroll restored (0) after pane-inline-split capture (leave-no-trace)',
      Math.abs(s33.refs.pane.scrollTop - 0) <= 0.65, 'scrollTop=' + s33.refs.pane.scrollTop);
    check('vlist scroll restored (' + PIS_LIST0 + ') after pane-inline-split capture (leave-no-trace)',
      Math.abs(s33.refs.vlist.scrollTop - PIS_LIST0) <= 0.65, 'scrollTop=' + s33.refs.vlist.scrollTop);
  }

  const s34 = buildMultiListPane();
  await runScenario('multilistpane', s34, expectMultiListPane, { settings: { unrollVirtual: true } });
  if (only('multilistpane')) {
    check('pane scroll restored (0) after multi-list-pane capture (leave-no-trace)',
      Math.abs(s34.refs.pane.scrollTop - 0) <= 0.65, 'scrollTop=' + s34.refs.pane.scrollTop);
    check('list A scroll restored (' + MLP_LIST0_A + ') after multi-list-pane capture (leave-no-trace)',
      Math.abs(s34.refs.vlistA.scrollTop - MLP_LIST0_A) <= 0.65, 'scrollTop=' + s34.refs.vlistA.scrollTop);
    check('list B scroll restored (' + MLP_LIST0_B + ') after multi-list-pane capture (leave-no-trace)',
      Math.abs(s34.refs.vlistB.scrollTop - MLP_LIST0_B) <= 0.65, 'scrollTop=' + s34.refs.vlistB.scrollTop);
  }

  const s35 = buildRailInlineSplit();
  await runScenario('railinlinesplit', s35, expectRailInlineSplit, { settings: { redactPII: true, unrollVirtual: true }, segments: 2 });
  if (only('railinlinesplit')) {
    check('pane scroll restored (0) after rail-inline-split capture (leave-no-trace)',
      Math.abs(s35.refs.pane.scrollTop - 0) <= 0.65, 'scrollTop=' + s35.refs.pane.scrollTop);
    check('vlist scroll restored (' + RIS_LIST0 + ') after rail-inline-split capture (leave-no-trace)',
      Math.abs(s35.refs.vlist.scrollTop - RIS_LIST0) <= 0.65, 'scrollTop=' + s35.refs.vlist.scrollTop);
    check('rail scroll restored (' + PIRL_RAIL0 + ') after rail-inline-split capture (leave-no-trace)',
      Math.abs(s35.refs.rail.scrollTop - PIRL_RAIL0) <= 0.65, 'scrollTop=' + s35.refs.rail.scrollTop);
  }

  /* === sink ===
     This tier runs the real pages/result.js, but only its STITCHING path: the
     harness shims the buttons away, so result.js's three failure sinks are not
     reachable by execution here. They are graded statically instead, and this
     is the nearest sim to the file.

     Two of the three can carry a NAME rather than pixels, which is why they are
     worth reducing at all:
       init()        — its catch covers FSDB.get/getFrames AND the FSDB.put that
                       seals a record holding the captured page's title and url;
                       an IndexedDB rejection is the engine talking about that
                       write. It is also the only thing on screen when it fires
                       (showEmpty hides the shot).
       downloadPdf() — its catch wraps fsDownloadBlob, which hands
                       chrome.downloads a filename built from the captured
                       page's {domain} and {title} under the user's synced
                       saveDirectory path.
     The third (copyImage) is canvas and clipboard work only; it is reduced for
     one rule in one place, not because a leak was found in it. */
  /* === the acts builder ===
     REDACTION-CLAIM-SPEC.md §2.1. THE STATE FUNCTION IS GONE. What this section
     used to grade — eight states, two doors, one default — described machinery
     that turned two ledgers into a WORD, and the word is what six rounds of
     fixes kept getting wrong. fsRedactActs turns the same two ledgers into
     three integers and two facts about the walk, and there is nothing left for
     a page shape to be wrong about.

     Three properties, and the second is the one a future session will erode:

       TOTAL          — driven with a cross-product of counter values, no input
                        may produce anything but integers, booleans, null and
                        the four-value enum.
       NULL, NOT ZERO — a counter the ledger cannot supply is the ABSENCE of a
                        measurement. A zero is a measurement, and printing a
                        confident zero over a page nobody read is the failure
                        this whole design removes.
       NO WORDS       — Rule 2. Every value is graded by fsRedactActValueOk,
                        which is the same predicate the envelope's own re-read
                        uses, so the tier and the gate cannot disagree. */
  console.log('\n=== the acts builder ===');
  {
    const COMMON = require(path.join(ROOT, 'pages', 'common.js'));
    const fn = COMMON.fsRedactActs;
    check('the acts builder is exported from one place', typeof fn === 'function', typeof fn);
    if (typeof fn === 'function') {
      const mkScan = o => Object.assign({
        v: 2, fed: 0, chars: 0, placed: 0,
        unplaced: { offRegion: 0, degenerate: 0, hidden: 0, fontMismatch: 0, clipped: 0, faded: 0, total: 0 },
        unplacedChars: 0, inkPx: 0, nonText: 0,
        frames: { sameOrigin: 0, scanned: 0, crossOrigin: 0 },
        matched: 0, boxes: 0, boxesFromUnplaced: 0, matchedNoBox: 0,
        blocksLost: 0, matchesTruncated: 0, rectsSkipped: { degenerate: 0, offRegion: 0 },
        lateTextPlaced: 0, lateChars: 0, lateMatched: 0,
        declined: { tooLong: 0, ceiling: 0, unmeasurable: 0, other: 0, total: 0 },
        declinedChars: 0, truncated: { walk: false, time: false, ceiling: false, error: false },
        walks: 1, walksCompleted: 1, remeasured: 0, movedUncovered: 0,
        budgetMs: 1200, matchedComplete: true, sealed: true
      }, o || {});
      /* `handed`/`painted`/`verified` count BLOCKS — one per client rect — and
         `matchesPainted`/`matchesVerifiedOpaque` count MATCHES. A fixture that
         supplied only the first three would be exercising the unit error this
         version removes, so the default carries both and every override below
         states which unit it is moving. */
      const mkBake = o => Object.assign({
        v: 1, handed: 0, painted: 0, verified: 0, verifyFailed: 0, verifySkipped: 0, sealed: true,
        matchesPainted: 0, matchesVerifiedOpaque: 0,
        /* The block-unit giving-up counters. Named `blocks…` for the same
           reason the two above are named `matches…`: at the call site the name
           is the only thing standing between the two units. */
        blocksLost: 0, blocksUnpainted: 0
      }, o || {});

      /* Totality by brute force over every counter an arm reads. 3^5 = 243
         shapes plus the three truncation flags, most of which no page will ever
         produce — which is the point. */
      const vals = [0, 1, 2], flags = [false, true];
      let bad = 0, firstBad = '';
      for (const matched of vals) for (const painted of vals) for (const verified of vals)
      for (const walk of flags) for (const time of flags) for (const ceiling of flags) {
        const acts = fn({ scan: mkScan({ matched, truncated: { walk, time, ceiling } }),
                          bake: mkBake({ handed: painted, painted, verified,
                                         matchesPainted: painted, matchesVerifiedOpaque: verified }) });
        for (const k of Object.keys(acts)) {
          if (!COMMON.fsRedactActValueOk(k, acts[k])) {
            bad++;
            if (!firstBad) firstBad = k + '=' + JSON.stringify(acts[k]);
          }
        }
        if (Object.keys(acts).length !== 12) { bad++; if (!firstBad) firstBad = 'arity ' + Object.keys(acts).length; }
      }
      check('no counter combination produces a value outside integer / boolean / null / enum',
        bad === 0, firstBad || '216 shapes, all inside');
      /* THE FIVE v4 FIELDS ARE NOT OPTIONAL EXTRAS. Each one is a place the
         pipeline gives up, and the whole point of them is that a consumer
         cannot be handed a partial number with nothing to say so. The arity
         check above is what stops one being dropped in a later edit; these
         grade that they answer NULL rather than zero when nobody measured. */
      const V4 = ['matchedComplete', 'textRefused', 'blocksLost', 'blocksUnpainted', 'blocksUnread'];
      const noLedger = fn(null);
      check('every giving-up counter is null when there is no ledger to read',
        V4.every(k => noLedger[k] === null), JSON.stringify(noLedger));
      const scanOnly = fn({ scan: mkScan({ matched: 3, declined: { tooLong: 2, ceiling: 0, unmeasurable: 1, other: 0, total: 3 } }) });
      check('a scan ledger supplies the LEAF-unit refusals and none of the block-unit ones',
        scanOnly.textRefused === 3 && scanOnly.blocksLost === null &&
        scanOnly.blocksUnpainted === null && scanOnly.blocksUnread === null,
        JSON.stringify(scanOnly));
      /* A COUNT WITHOUT ITS COMPLETENESS IS NOT A COUNT — and a ledger that
         supplies the count and not the flag must answer "cannot tell", never
         "whole". A `true` invented here is the entire defect class in one
         field. */
      const noFlag = mkScan({ matched: 3 });
      delete noFlag.matchedComplete;
      check('a count whose completeness the ledger cannot supply is not reported as whole',
        fn({ scan: noFlag, bake: mkBake() }).matchedComplete === null &&
        fn({ scan: mkScan({ matched: 3, matchedComplete: false }), bake: mkBake() }).matchedComplete === false,
        JSON.stringify(fn({ scan: noFlag, bake: mkBake() })));
      /* The walk that no budget stopped: a subtree refused to enumerate. It is
         an incomplete walk with nothing to blame, and reporting it as the
         element budget was a true sentence wrapped around a false reason. */
      const errWalk = fn({ scan: mkScan({ truncated: { walk: false, time: false, ceiling: false, error: true } }), bake: mkBake() });
      check('a subtree that refused to enumerate is an incomplete walk that names no budget',
        errWalk.walkComplete === false && errWalk.truncatedBy === null, JSON.stringify(errWalk));

      /* NULL, NEVER ZERO. Three populations: no ledger at all, one ledger, and
         a lift out of a v2 record. Each says what it can and says nothing it
         cannot. */
      const none = fn(null);
      check('no ledger at all is an ABSENT ledger with every counter null',
        none.ledger === 'absent' && none.matched === null && none.painted === null &&
        none.verifiedOpaque === null && none.walkComplete === null && none.truncatedBy === null,
        JSON.stringify(none));
      const halfScan = fn({ scan: mkScan({ matched: 3 }) });
      check('one ledger of the two is PARTIAL, and the missing half stays null',
        halfScan.ledger === 'partial' && halfScan.matched === 3 && halfScan.painted === null,
        JSON.stringify(halfScan));
      const lifted = fn({ scan: mkScan({ matched: 3 }),
                          bake: mkBake({ painted: 3, verified: 2,
                                         matchesPainted: 3, matchesVerifiedOpaque: 2 }), legacy: true });
      check('a lift out of an old record is PARTIAL, so nobody mistakes it for a reading',
        lifted.ledger === 'partial' && lifted.verifiedOpaque === 2, JSON.stringify(lifted));
      /* THE UNITS, AT THE DOOR. A bake that can only count blocks cannot answer
         a question asked in matches, and the honest answer to a question you
         cannot answer is null — not the block count wearing the match count's
         name, which is what shipped and what a wrapped token then cancelled a
         real shortfall with. */
      const blocksOnly = fn({ scan: mkScan({ matched: 2, boxes: 3 }),
                              bake: { v: 1, handed: 3, painted: 3, verified: 3,
                                      verifyFailed: 0, verifySkipped: 0, sealed: true } });
      check('a bake that counted only BLOCKS cannot supply a MATCH count',
        blocksOnly.matched === 2 && blocksOnly.painted === null &&
        blocksOnly.verifiedOpaque === null, JSON.stringify(blocksOnly));
      const alien = fn({ scan: mkScan({ v: 99, matched: 9 }),
                         bake: mkBake({ painted: 9, verified: 9,
                                        matchesPainted: 9, matchesVerifiedOpaque: 9 }) });
      check('a ledger version this build has never met is not read at all',
        alien.matched === null && alien.ledger === 'partial', JSON.stringify(alien));

      /* THE ENUM. Most-binding first, because a pass that hit the box ceiling
         AND ran out of time was bounded by the ceiling. */
      const t = (o) => fn({ scan: mkScan({ truncated: o }), bake: mkBake() }).truncatedBy;
      check('truncatedBy names the binding limit, most-binding first',
        t({ walk: false, time: false, ceiling: false }) === null &&
        t({ walk: true, time: false, ceiling: false }) === 'elements' &&
        t({ walk: false, time: true, ceiling: false }) === 'time' &&
        t({ walk: true, time: true, ceiling: true }) === 'ceiling',
        [t({ walk: true, time: true, ceiling: true }), t({ walk: true, time: false, ceiling: false })].join(','));
      check('walkComplete is true only when nothing truncated and every walk finished',
        fn({ scan: mkScan(), bake: mkBake() }).walkComplete === true &&
        fn({ scan: mkScan({ walksCompleted: 0 }), bake: mkBake() }).walkComplete === false, '');

      /* NO SETTING REACHES THIS FUNCTION AT ALL. The old one took `settingOn`
         and the whole first escape was a preference becoming a claim; there is
         no parameter here that a preference could arrive through. Graded by
         reading the source, because a behavioural check cannot see a parameter
         that happens not to be passed today. */
      const csrc = fs.readFileSync(path.join(ROOT, 'pages', 'common.js'), 'utf8');
      const body = /function fsRedactActs\([^)]*\)\s*\{[\s\S]*?\n\}/.exec(csrc);
      const src = body ? body[0] : '';
      check('no preference can reach the acts builder — it reads ledgers only',
        src.length > 0 && !/redactPII|settingOn|settings/.test(src),
        (src.match(/redactPII|settingOn|settings/g) || []).join(',') || 'ledgers only');
      /* And result.js reads the ACT, not the later re-read of the preference.
         This is the race: `meta.piiPass` is written by the branch that decided
         to run the pass; `cap.settings.redactPII` is background.js re-reading
         the same preference at FS_DONE, minutes later. */
      /* Comments stripped: the fix's own explanation names the setting it
         stopped reading, and a check that cannot tell a live read from a note
         about its removal grades prose. */
      const rsrc2 = stripJsComments(fs.readFileSync(path.join(ROOT, 'pages', 'result.js'), 'utf8'));
      check('result.js derives `requested` from the act, never from the re-read setting',
        /typeof m\.piiPass === 'boolean' \? m\.piiPass : null/.test(rsrc2) &&
        !/cap\.settings[^\n]*redactPII/.test(rsrc2) && !/s\.redactPII/.test(rsrc2),
        (rsrc2.match(/[a-z.]*\.redactPII/g) || []).join(',') || 'piiPass only');
    }
  }


  console.log('\n=== sink ===');
  {
    const rsrc = fs.readFileSync(path.join(ROOT, 'pages', 'result.js'), 'utf8');
    const rraw = rsrc.match(/e\s*&&\s*e\.message\s*\|\|\s*e/g) || [];
    check('result.js never interpolates a raw exception', rraw.length === 0,
      rraw.length ? rraw.length + ' site(s)' : 'none');
    const rred = (rsrc.match(/fsHumanReason\s*\(/g) || []).length;
    check('all three failure sinks go through the shared reducer', rred === 3, rred + ' call(s)');
    check('the sinks still name what failed',
      /Something went wrong/.test(rsrc) && /Copy failed/.test(rsrc) && /PDF failed/.test(rsrc), '');
    /* The one markup sink on this page. It interpolates only numbers today —
       part index, part count, and two canvas dimensions — but "it is numbers
       today" is not a check, and the v1.9.12 bug WAS an innerHTML that grew an
       interpolated string. So the values are named: strip the string literals
       out of the assignment and every identifier left must be on this list.
       A title, a url or an exception added here is a foreign name and reddens.
       (Verified by re-injection: interpolating shot.title turns this red.) */
    /* fsDims joined the list when the RTL work landed: a bare "w + '×' + h"
       reverses to "h×w" inside a right-to-left paragraph, so the pair is now
       wrapped in U+2066/U+2069 by one shared formatter. It is admitted as a
       NAME, not as an escape hatch — every identifier handed to it is still
       scanned by the same filter, so fsDims(shot.title, x) reddens exactly as
       shot.title did before. What fsDims itself may do is pinned by the check
       immediately below. */
    const NUMERIC = ['innerHTML', 'i', 'shot.segments.length', 'seg.w', 'seg.h', 'fsDims'];
    const htmlAssigns = rsrc.match(/innerHTML\s*=\s*[^;]*/g) || [];
    const withText = htmlAssigns.filter(a => /\+/.test(a) && !/^\s*innerHTML\s*=\s*''/.test(a));
    check('result.js builds markup by concatenation in exactly one place',
      withText.length === 1, withText.length + ' site(s)');
    const code = (withText[0] || '').replace(/'(?:[^'\\]|\\.)*'/g, '§');
    const foreign = (code.match(/[A-Za-z_$][A-Za-z0-9_$.]*/g) || [])
      .filter(x => NUMERIC.indexOf(x) < 0);
    check('...and every value it interpolates is a number, never text',
      withText.length === 1 && foreign.length === 0, foreign.join(',') || 'numbers only');
    /* Admitting fsDims above only holds if fsDims cannot itself carry a name.
       Its whole body is graded here: it may stringify its arguments and join
       them with a separator, and it may not read a property off them, call a
       method on them, or reach any other identifier. A future edit that made it
       interpolate e.g. `w.title` would redden this instead of slipping through
       the widened allowlist. */
    const csrc = fs.readFileSync(path.join(ROOT, 'pages', 'common.js'), 'utf8');
    const fd = /function fsDims\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(csrc);
    const body = fd ? fd[1] : '';
    const ids = (body.match(/[A-Za-z_$][A-Za-z0-9_$.]*/g) || [])
      .filter(x => ['w', 'h', 'sep', 'String', 'return', 'null', 'FS_LRI', 'FS_PDI'].indexOf(x) < 0);
    check('the dimension formatter can only ever stringify numbers',
      body.length > 0 && ids.length === 0 && !/\.\w/.test(body),
      ids.join(',') || 'w, h, sep -> String() only');
    check('the isolate characters are spelled, not pasted (a literal is invisible to grep)',
      /String\.fromCharCode\(0x2066\)/.test(csrc) && /String\.fromCharCode\(0x2069\)/.test(csrc) &&
      !/[⁦-⁩‪-‮]/.test(csrc), 'FS_LRI / FS_PDI from char codes');
  }

  console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
  process.exit(FAILS ? 1 : 0);
})();
/* pixel-sim build 1.9.11 · +s33 paneinlinesplit (combo (c): a pane-embedded inline list TALL enough to force a canvas split) | +s34 multilistpane (TWO inline slots in ONE app-shell pane) | +s35 railinlinesplit (compose s32 paneinlinerail + s33 paneinlinesplit: a pane-embedded inline list BESIDE a fixed rail AND tall enough to force a canvas split -- the rail's independent-column draw + its sideDraw-routed redaction compose with the split WHILE the pane-frame region-clip + the inline-window injection straddle the cut; all draw at pos-segTop clipped to [0,segH], so test-only LOCK-IN, extension byte-unchanged, teeth-proven; note the rail column defeats the quiet-row finder so the cut falls at the hard 16000 edge, inside the 16000px list) */
