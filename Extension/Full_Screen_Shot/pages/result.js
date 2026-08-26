/* FullShot result page.
   Fresh capture (?id=): reads raw frames from IndexedDB, stitches them onto
   canvases (splitting when beyond canvas limits), saves the finished shot,
   and renders it. Existing shot (?shot=): loads and renders from history. */

(function () {
  'use strict';

  const MAX_DIM = 16000;          // safe canvas edge
  const MAX_AREA = 240 * 1e6;     // safe canvas area (px)

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  let shot = null;        // current shot record
  let settings = null;

  /* ---- strings -------------------------------------------------------------
     pages/common.js owns the pass — fsApplyI18n fills in everything result.html
     marks up, and fsMessage / fsPluralMessage resolve what this file builds at
     runtime. result.html loads common.js, so in a browser the real functions are
     always there. The two wrappers below exist for the one environment that has
     no common.js at all: test/pixel-sim/result-harness.js boots THIS FILE alone
     in a node vm to grade the stitching math, and calling straight into a
     missing global would take that tier down with a reference error instead of
     degrading to English. Same reason popup/popup.js keeps a copy of the pass;
     `typeof` on an undeclared name is safe, a call to one is not.

     Nothing on this page is concatenated into a sentence any more. A sentence
     built with + fixes English word order into the product, and both
     "Part $INDEX$ of $TOTAL$" and "$NAME$ · $WIDTH$×$HEIGHT$ px · $SIZE$" are
     sentences some of the 55 reorder — Japanese renders the first as
     "パート 1 / 2". The English travels beside the key as the fallback, exactly
     as it does in the markup. The three failure sentences are deliberately NOT
     quoted in this comment: test/pixel-sim/run.js greps this file for them to
     prove each sink still names what failed, and it reads the source with the
     comments in, so a comment that quoted one would answer the check for it. */

  /* Fills $TOKEN$ in an English fallback in order of first appearance, which is
     the order the message file declares them ($1, $2, $3). Chrome does this
     itself whenever the key resolved, and so does fsMessage; this is only the
     no-common.js path. */
  function subst(text, subs) {
    if (!subs || !subs.length) return String(text);
    const seen = new Map();
    return String(text).replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name) => {
      const n = name.toLowerCase();
      if (!seen.has(n)) seen.set(n, seen.size);
      const v = subs[seen.get(n)];
      return v == null ? whole : String(v);
    });
  }

  function msg(key, subs, english) {
    if (typeof fsMessage === 'function') return fsMessage(key, subs, english);
    return english == null ? null : subst(english, subs);
  }

  function plural(base, count, subs, english) {
    if (typeof fsPluralMessage === 'function') return fsPluralMessage(base, count, subs, english);
    return english == null ? null : subst(english, subs == null ? [String(count)] : subs);
  }

  /* A width and a height that a MESSAGE joins, rather than a pair this page
     builds. fsDims() cannot do it: the separator between them belongs to the
     message — Arabic writes "$WIDTH$ × $HEIGHT$ بكسل" — so the isolate has to
     open before the width and close after the height, with the message's own
     separator inside it. Without that the pair reverses in a right-to-left
     paragraph and a 1280-wide capture reads 4096 wide. Same two characters and
     the same reasoning as fsDims in pages/common.js, and spelled from char
     codes for the same reason: a literal U+2066 is invisible in every editor. */
  const LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069);
  function dimSubs(w, h) { return [LRI + String(w), String(h) + PDI]; }

  /* The capture-mode tables' shape, borrowed from popup.js: the paper name is a
     noun INSIDE "PDF: $PAPER$", so it is resolved first and handed in as a
     substitution. PAPER_KEY is what a translated page renders; PAPER_LABEL is
     the English each key resolves to when there is no message file to read. The
     option's `value` is untouched — it is the enum pdfPaper is stored as. */
  const PAPER_KEY = {
    auto: 'optionsPaperAuto', a4: 'optionsPaperA4',
    letter: 'optionsPaperLetter', legal: 'optionsPaperLegal'
  };
  const PAPER_LABEL = { auto: 'Image size', a4: 'A4', letter: 'Letter', legal: 'Legal' };

  /* The two strings a message file cannot finish on its own, because each one
     spends another message as a substitution. fsApplyI18n has already run by the
     time this does — common.js registers its DOMContentLoaded handler before
     this file is even parsed — so this refines what is already on screen, in the
     same synchronous dispatch. Nothing is painted in between. */
  function localizePage() {
    if (typeof document.querySelectorAll !== 'function') return;
    const opts = document.querySelectorAll('#paperSel option');
    for (let i = 0; i < opts.length; i++) {
      const key = PAPER_KEY[opts[i].value];
      if (!key) continue;
      const paper = msg(key, null, PAPER_LABEL[opts[i].value]);
      const text = msg('resultPaperOption', [paper], 'PDF: $PAPER$');
      if (text != null) opts[i].textContent = text;
    }
    const hint = document.querySelector('.hint');
    const tip = msg('resultTip', [msg('resultDownload', null, 'Download')],
      'Tip: drag the image straight to your desktop, or use $DOWNLOAD$.');
    if (hint && tip != null) hint.textContent = tip;
  }

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    localizePage();
    settings = await fsGetSettings();
    $('themeBtn').addEventListener('click', fsToggleTheme);
    $('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
    /* Escape dismisses the toast. It is the only transient overlay this page
       paints, and it sits over the bottom of a screenshot the user is trying
       to look at; nothing here traps focus, so there is nothing else for the
       key to answer for. */
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const t = document.getElementById('fs-toast');
      if (t) t.classList.remove('show');
    });
    $('paperSel').value = settings.pdfPaper;

    try {
      const captureId = params.get('id');
      const shotId = params.get('shot');
      if (captureId) {
        // Already stitched earlier (page reload)?
        const existing = await FSDB.get('shots', captureId);
        shot = existing || await stitch(captureId);
      } else if (shotId) {
        shot = await FSDB.get('shots', shotId);
      }
      if (!shot) return showEmpty(msg('resultEmptyBody', null, 'This screenshot no longer exists.'));
      render();

      if (params.get('id') && settings.autoDownload) downloadImages();
      if (params.get('id') && settings.autoOpenEditor && shot.segments.length === 1) {
        location.href = 'editor.html?shot=' + encodeURIComponent(shot.id) + '&seg=0';
      }
    } catch (e) {
      /* This block covers the IndexedDB reads AND the put that seals a record
         holding the captured page's title and url, so the rejection can be the
         engine talking about that write. It is also the only thing on screen
         when it fires — showEmpty hides the shot. */
      showEmpty(msg('resultSomethingWrong', [fsHumanReason(e)],
        'Something went wrong — $REASON$'));
    }
  }

  /* ---------------- stitching ---------------- */

  /* Map scroll positions (CSS px) to gapless destination offsets (device px).
     With fractional zoom/DPR (e.g. Windows 125% => 1.25), a viewport is a
     non-integer number of device pixels (730 css * 1.25 = 912.5). Rounding
     each frame's offset independently leaves 1px unpainted rows between
     frames — the visible "seam line". Fix: never let a frame start past the
     bottom of the previous one. Scroll steps are contiguous in CSS space by
     construction, so any positive gap is a rounding artifact — close it by
     anchoring the frame to the covered edge (sub-pixel content error, vs a
     bright unpainted line). */
  function fsGaplessMap(values, k, span) {
    const map = new Map();
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    let covered = null; // bottom (or right) edge painted so far
    for (const v of sorted) {
      let d = Math.round(v * k);
      if (covered !== null && d > covered) d = covered;
      map.set(v, d);
      covered = covered === null ? d + span : Math.max(covered, d + span);
    }
    return map;
  }

  async function stitch(captureId) {
    const cap = await FSDB.get('captures', captureId);
    if (!cap) return null;
    const frames = await FSDB.getFrames(captureId);
    if (!frames.length) return null;
    frames.sort((a, b) => a.index - b.index);
    // v1.4.0: frames of secondary side panes (rail unroll pass) are tagged
    // with the pane index — they must never feed the main placement maps.
    const mainFrames = frames.filter(f => f.pane == null && f.inline == null);
    const sideFrames = frames.filter(f => f.pane != null);
    const inlineFrames = frames.filter(f => f.inline != null);   // v1.6.1 inline unroll
    if (!mainFrames.length) return null;

    /* One key per CLDR category, chosen by the plural helper for the locale that
       actually loaded — "1 frame / 2 frames" is two forms in English, one in
       Japanese and four in Russian, and none of that is an "s" on the end. */
    setProgress(plural('resultProgressDecoding', frames.length, null,
      'Decoding $COUNT$ frames…'));
    const first = await fsLoadImage(mainFrames[0].dataUrl);

    let canvasW, canvasH, scale = 1, crop = null;

    /* Inner-pane capture (app-shell pages: Gmail, ChatGPT, dashboards…):
       every frame is a full-viewport shot of the SHELL with the pane at a
       different scroll offset. The output keeps the shell chrome where the
       user saw it and unrolls only the pane: chrome above/left/right of the
       pane stays at the top, chrome below it moves to the very bottom, and
       the pane's slot grows to its full content height. */
    const rr = cap.mode === 'full' && cap.meta.rootRect && cap.meta.winW
      ? cap.meta.rootRect : null;

    if (cap.mode === 'full' && rr) {
      scale = first.width / cap.meta.winW;                  // css px -> device px
      const chromeRight = Math.max(0, cap.meta.winW - rr.x - rr.w);
      const chromeBottom = Math.max(0, cap.meta.winH - rr.y - rr.h);
      canvasW = Math.round((rr.x + Math.max(cap.meta.totalW, rr.w) + chromeRight) * scale);
      canvasH = Math.round((rr.y + Math.max(cap.meta.totalH, rr.h) + chromeBottom) * scale);
    } else if (cap.mode === 'full') {
      scale = first.width / cap.meta.vw;                    // css px -> device px
      canvasW = Math.round(cap.meta.totalW * scale);
      canvasH = Math.round(cap.meta.totalH * scale);
    } else if (cap.mode === 'region' && cap.meta.cropRect) {
      const dpr = cap.meta.dpr || 1;
      crop = {
        sx: Math.max(0, Math.round(cap.meta.cropRect.x * dpr)),
        sy: Math.max(0, Math.round(cap.meta.cropRect.y * dpr)),
        sw: Math.round(cap.meta.cropRect.w * dpr),
        sh: Math.round(cap.meta.cropRect.h * dpr)
      };
      crop.sw = Math.min(crop.sw, first.width - crop.sx);
      crop.sh = Math.min(crop.sh, first.height - crop.sy);
      canvasW = crop.sw; canvasH = crop.sh;
    } else { // visible
      canvasW = first.width; canvasH = first.height;
    }

    // Cap width; scale everything down if the page is extremely wide.
    let outScale = 1;
    if (canvasW > MAX_DIM) {
      outScale = MAX_DIM / canvasW;
      canvasW = MAX_DIM;
      canvasH = Math.round(canvasH * outScale);
    }

    // Precompute gapless frame placement (full-page mode).
    let xMap = null, yMap = null, frameW = 0, frameH = 0;
    let pane = null; // device-px geometry of the inner pane, when unrolling one
    if (cap.mode === 'full' && rr) {
      const k = scale * outScale;
      // Pane band inside each captured frame (device px of the source bitmap).
      pane = {
        sx: Math.round(rr.x * scale), sy: Math.round(rr.y * scale),
        sw: Math.round(rr.w * scale), sh: Math.round(rr.h * scale),
        dx: Math.round(rr.x * k), dy: Math.round(rr.y * k),
        dw: Math.round(rr.w * k), dh: Math.round(rr.h * k),
        srcW: first.width, srcH: first.height
      };
      pane.sw = Math.min(pane.sw, first.width - pane.sx);
      pane.sh = Math.min(pane.sh, first.height - pane.sy);
      xMap = fsGaplessMap(mainFrames.map(f => f.x), k, pane.dw);
      yMap = fsGaplessMap(mainFrames.map(f => f.y), k, pane.dh);
      // Exact edges from the placement maps — no rounding slivers.
      let paneRight = pane.dx + pane.dw, paneBottom = pane.dy + pane.dh;
      for (const d of xMap.values()) paneRight = Math.max(paneRight, pane.dx + d + pane.dw);
      for (const d of yMap.values()) paneBottom = Math.max(paneBottom, pane.dy + d + pane.dh);
      pane.right = paneRight; pane.bottom = paneBottom;
      pane.chromeRightW = Math.max(0, Math.round(first.width * outScale) - pane.dx - pane.dw);
      pane.chromeBottomH = Math.max(0, Math.round(first.height * outScale) - pane.dy - pane.dh);
      canvasW = paneRight + pane.chromeRightW;
      canvasH = paneBottom + pane.chromeBottomH;
      if (canvasW > MAX_DIM) canvasW = MAX_DIM;
    } else if (cap.mode === 'full') {
      const k = scale * outScale;
      frameW = Math.round(first.width * outScale);
      frameH = Math.round(first.height * outScale);
      xMap = fsGaplessMap(mainFrames.map(f => f.x), k, frameW);
      yMap = fsGaplessMap(mainFrames.map(f => f.y), k, frameH);
      // Clamp the canvas to what the frames actually cover, so no white
      // sliver is left at the bottom/right edge after rounding.
      let maxX = 0, maxY = 0;
      for (const d of xMap.values()) maxX = Math.max(maxX, d + frameW);
      for (const d of yMap.values()) maxY = Math.max(maxY, d + frameH);
      canvasW = Math.min(canvasW, maxX);
      canvasH = Math.min(canvasH, maxY);
    }

    /* Secondary side panes (v1.4.0): each rail's frames are cropped to the
       rail's viewport rect and unrolled downward from the rail's top edge —
       the blank void that used to sit under a pinned rail now shows the
       rail's actual continued content. The canvas is never grown for a rail:
       the main pane dictates the story's height, rails are clipped to it. */
    let sideDraw = null;
    if (cap.mode === 'full' && cap.meta.sidePanes && sideFrames.length) {
      const k = scale * outScale;
      sideDraw = cap.meta.sidePanes.map((sp, i) => {
        const g = {
          sx: Math.round(sp.x * scale), sy: Math.round(sp.y * scale),
          sw: Math.round(sp.w * scale), sh: Math.round(sp.h * scale),
          dx: Math.round(sp.x * k), dy: Math.round(sp.y * k),
          dw: Math.round(sp.w * k), dh: Math.round(sp.h * k),
          idx: i,
          frames: sideFrames.filter(f => f.pane === i)
        };
        g.sw = Math.min(g.sw, first.width - g.sx);
        g.sh = Math.min(g.sh, first.height - g.sy);
        g.yMap = fsGaplessMap(g.frames.map(f => f.y), k, g.dh);
        return g;
      }).filter(g => g.frames.length && g.sw > 0 && g.sh > 0);
      if (sideDraw && !sideDraw.length) sideDraw = null;
    }

    /* Embedded virtualized list, INLINE UNROLL (v1.6.1). The list was captured
       as a stepped stack of windows (frames tagged inline:<i>). Inject them at
       the list's slot, growing the canvas there and pushing everything below
       downward. Doc-scroll 1:1 mode. v1.9.9: composes with fixed side rails too
       — a rail draws as an independent column (its own frames, clipped to the
       canvas height, painted last), so doc-column inline growth doesn't touch it.
       v1.9.10: composes with an app-shell PANE too — the slot lives in pane-
       content space (slotTop gains pane.dy), the pane frames draw region-clipped
       + shifted like the doc frames, and the pane's bottom chrome moves down by
       the growth (two growth systems in the pane's coordinate frame). */
    let inlineDraw = null, inlineRegions = null;
    if (cap.mode === 'full' &&
        cap.meta.inlinePanes && cap.meta.inlinePanes.length && inlineFrames.length) {
      const k = scale * outScale;
      inlineDraw = cap.meta.inlinePanes.map((ip, i) => {
        const g = {
          sx: Math.round(ip.x * scale), sy: Math.round(ip.y * scale),
          sw: Math.round(ip.w * scale), sh: Math.round(ip.h * scale),
          dx: Math.round(ip.x * k), dw: Math.round(ip.w * k),
          dh: Math.round(ip.h * outScale),          // dest height of one window
          slotTop: (pane ? pane.dy : 0) + Math.round(ip.docY * k),   // base-canvas Y of the slot top (pane: + pane.dy)
          slotVisH: Math.round(ip.clientH * k),     // compact slot height in base canvas
          fullH: Math.round(ip.fullH * k),          // full unrolled height (dest)
          idx: i,
          frames: inlineFrames.filter(f => f.inline === i)
        };
        g.sx = Math.max(0, Math.min(g.sx, first.width - 1));
        g.sy = Math.max(0, Math.min(g.sy, first.height - 1));
        g.sw = Math.min(g.sw, first.width - g.sx);
        g.sh = Math.min(g.sh, first.height - g.sy);
        g.yMap = fsGaplessMap(g.frames.map(f => f.y), k, g.dh);
        g.growth = Math.max(0, g.fullH - g.slotVisH);
        return g;
      }).filter(g => g.frames.length && g.sw > 0 && g.sh > 0 && g.growth > 0);
      inlineDraw.sort((a, b) => a.slotTop - b.slotTop);
      if (!inlineDraw.length) inlineDraw = null;
      else {
        // Base-canvas ranges NOT covered by a slot window, each with the final-Y
        // offset that the growth above it introduces; grow the canvas to match.
        inlineRegions = [];
        let prevBottom = 0, off = 0;
        for (const g of inlineDraw) {
          inlineRegions.push({ from: prevBottom, to: g.slotTop, off });
          g.finalTop = g.slotTop + off;
          off += g.growth;
          prevBottom = g.slotTop + g.slotVisH;
        }
        inlineRegions.push({ from: prevBottom, to: canvasH, off });
        canvasH += off;
      }
    }

        /* Semantic section tops (v1.5.0): content-space css px → canvas device
       px. Part boundaries and PDF page breaks snap to these first; pixel
       scanning is only the fallback. */
    let breakYs = null;
    if (cap.mode === 'full' && cap.meta.breakHints && cap.meta.breakHints.length) {
      const k = scale * outScale;
      const off = pane ? pane.dy : 0;
      breakYs = cap.meta.breakHints.map(y => off + Math.round(y * k))
        .filter(y => y > 0 && y < canvasH);
      if (!breakYs.length) breakYs = null;
    }
    if (breakYs && inlineRegions) {
      // Section tops below an injected slot move down by that slot's growth.
      breakYs = breakYs.map(y => {
        for (const rg of inlineRegions) if (y >= rg.from && y < rg.to) return y + rg.off;
        return y;   // inside a slot window (rare for a section top) — leave as-is
      }).filter(y => y > 0 && y < canvasH);
      if (!breakYs.length) breakYs = null;
    }

    /* Split tall results into parts that fit canvas limits. Part boundaries
       snap to a semantic section top when one is in range (v1.5.0 — "the
       next section starts the next part"), else UP to the nearest visually
       quiet gap (v1.4.0) so a line of text is never cut in half. */
    const segMaxH = Math.max(1000, Math.min(MAX_DIM, Math.floor(MAX_AREA / canvasW)));
    const estCount = Math.max(1, Math.ceil(canvasH / segMaxH));

    const type = fsMime(settings.imageFormat);
    const quality = settings.imageFormat === 'png' ? undefined : settings.jpegQuality;
    const segments = [];

    /* ---- the bake ledger (REDACTION-CLAIM-SPEC.md §2.1) --------------------
       Written by the composition loop, at each act. `blocksHanded` is what
       arrived, `blocksPainted` is what received paint at least once
       (DE-DUPLICATED across segments — a box that straddles a part boundary is
       painted twice and is one box), `blocksVerified` is what was READ BACK OUT
       OF THE FINISHED CANVAS.
       None of the counters is persisted (§2.2 — machinery left lying around is
       machinery someone re-derives a verdict from).

       EVERY COUNTER IN THIS BLOCK COUNTS BLOCKS, AND THE NAMES NOW SAY SO. A
       block is one client rect: `collectPIIBoxes` emits one per rect per match,
       so a token that WRAPS ACROSS A LINE arrives as two blocks for one match.
       These numbers are therefore the wrong unit to subtract from `matched`, and
       for one release they were subtracted from it anyway — a wrapped card
       number cancelled a genuinely uncovered email and the alarm never fired.
       The match-unit roll-up is `rollUpMatches` below, it is what `acts` reads,
       and the two are kept apart by their names because at the call site that
       is the only thing standing between them.

       The blocks are still counted, and they are still what the review dialog
       outlines: a person looking for the covered thing needs the rect, and a
       wrapped token really is two rectangles on the picture.

       `handed` IS AN ACT AND IS COUNTED AS ONE. It used to be written only
       `if (piiOn)`, where `piiOn` read `cap.settings.redactPII` — the SETTING,
       re-read by background.js at FS_DONE, minutes after the pass it is
       supposed to describe. The two reads can disagree: the engine is handed
       the setting at FS_START and writes `meta.piiPass` from the branch that
       decided, and anything that changes the stored setting in between — the
       user toggling it mid-capture, an options page save, a sync write landing
       — makes the later read describe a different capture. When it lands on
       `false`, this whole ledger collapses to zeros while blocks are painted
       into the image two hundred lines below: `matched 3, painted 0`, no boxes
       lost, nothing wrong with the picture, and an act ledger that says the
       protection never happened. That is the same class as the bug this file's
       whole history is about — AN OUTCOME INFERRED FROM AN INPUT — and the
       remedy is the same: count the boxes that ARRIVED. */
    const bake = { v: 1, blocksHanded: 0, blocksPainted: 0,
                   blocksVerified: 0, verifyFailed: 0, verifySkipped: 0, sealed: false,
                   /* EVERY PLACE THIS LOOP GIVES UP ON A BLOCK, COUNTED WHERE IT
                      GIVES UP. `blocksNoFrame` is the two `continue`s below — a
                      box measured inside a pane or an inline-unrolled list whose
                      frame does not exist in this composition, so there is
                      nowhere honest to put the paint. `blocksUnpainted` is the
                      total, written at the seal, and it also catches the box
                      that fell outside every segment. Both count BLOCKS and say
                      so; neither is ever subtracted from a match count.
                      A round of this feature's history was one of these
                      `continue`s discarding a rectangle that existed BECAUSE PII
                      was found there, and the only trace being a number that did
                      not move. */
                   blocksNoFrame: 0, blocksUnpainted: null,
                   /* BLOCKS THAT NEVER REACHED THIS LOOP AT ALL — the ones the
                      scan's box ceiling refused to emit. Filled by the roll-up
                      from the block production each box declares, `null` until
                      then and `null` for good if the boxes carry no match
                      identity: the absence of a measurement, never a zero. */
                   blocksLost: null,
                   /* MATCHES, filled once by rollUpMatches after the last
                      segment. `null` until then, and `null` for good if the
                      stitch threw or the boxes carry no match identity — the
                      absence of a measurement, never a zero.

                      A ledger still carrying the old bare `painted` / `verified`
                      names answers `null` here rather than handing a block count
                      to a field the renderer subtracts from `matched`, which is
                      the degradation the acts builder grades. */
                   matchesPainted: null, matchesVerifiedOpaque: null };
    const bakeBoxes = (cap.mode === 'full' && Array.isArray(cap.meta.piiBoxes))
      ? cap.meta.piiBoxes : [];
    bake.blocksHanded = bakeBoxes.length;
    /* Painted / verified state, per box index, carried ACROSS segments: a box
       cropped entirely into a discarded tail is neither verified nor failed in
       that segment — it stays pending and is verified in the next one. `mark`
       is filled by the read-back and only by the read-back (§3.3). */
    const bakeSeen = bakeBoxes.map(() => ({ painted: false, verified: false,
                                            failed: false, skipped: false,
                                            noFrame: false, mark: null }));

    let segTop = 0;
    while (segTop < canvasH) {
      const partNo = segments.length + 1;
      setProgress(estCount > 1
        ? msg('resultProgressStitchingOf', [partNo, estCount], 'Stitching part $INDEX$ of ~$TOTAL$…')
        : msg('resultProgressStitching', [partNo], 'Stitching part $INDEX$…'));
      let segH = Math.min(segMaxH, canvasH - segTop);
      let canvas = document.createElement('canvas');
      canvas.width = canvasW; canvas.height = segH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, segH);

      if (cap.mode === 'full' && pane) {
        ctx.imageSmoothingEnabled = outScale !== 1;
        // Shell chrome, from the first frame (the page exactly as the user
        // saw it): above, beside and below the pane's slot.
        const srcW = pane.srcW, srcH = pane.srcH;
        // v1.9.10: total growth introduced by inline-unrolled lists inside the pane.
        const growTotal = inlineRegions ? inlineRegions[inlineRegions.length - 1].off : 0;
        const band = (sx, sy, sw, sh, dx, dy, dw, dh) => {
          if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
          const y = dy - segTop;
          if (y + dh < 0 || y > segH) return;
          ctx.drawImage(first, sx, sy, sw, sh, dx, y, dw, dh);
        };
        // top chrome (full width)
        band(0, 0, srcW, pane.sy, 0, 0, Math.round(srcW * outScale), pane.dy);
        // left chrome beside the pane's first view
        band(0, pane.sy, pane.sx, pane.sh, 0, pane.dy, pane.dx, pane.dh);
        // right chrome beside the pane's first view
        band(pane.sx + pane.sw, pane.sy, srcW - pane.sx - pane.sw, pane.sh,
             pane.right, pane.dy, pane.chromeRightW, pane.dh);
        // bottom chrome (full width), moved below the unrolled pane (+ inline growth)
        band(0, pane.sy + pane.sh, srcW, srcH - pane.sy - pane.sh,
             0, pane.bottom + growTotal, Math.round(srcW * outScale), pane.chromeBottomH);
        // Side rails (v1.4.0): unroll each rail's content down its column,
        // overpainting the as-seen chrome band. Drawn BEFORE the pane so any
        // rounding-sliver overlap resolves in favor of the main story.
        if (sideDraw) {
          for (const g of sideDraw) {
            for (const f of g.frames) {
              const dy = g.dy + g.yMap.get(f.y) - segTop;
              if (dy + g.dh < 0 || dy > segH) continue;
              const img = await fsLoadImage(f.dataUrl);
              ctx.drawImage(img, g.sx, g.sy, g.sw, g.sh, g.dx, dy, g.dw, g.dh);
            }
          }
        }
        // The pane itself: each frame cropped to the pane's viewport band. When an
        // embedded list unrolls inline (v1.9.10), draw only the parts of each pane
        // frame that fall in a non-slot region, each shifted down by the growth above
        // it (the slot windows overpaint the excluded band next) — mirrors the doc path.
        const paneSrcScaleY = pane.sh / pane.dh;   // source px per dest px in the pane band
        for (const f of mainFrames) {
          const dx = pane.dx + xMap.get(f.x);
          const baseDy = pane.dy + yMap.get(f.y);
          const img = f === mainFrames[0] ? first : await fsLoadImage(f.dataUrl);
          if (!inlineRegions) {
            const dy = baseDy - segTop;
            if (dy + pane.dh < 0 || dy > segH) continue;
            ctx.drawImage(img, pane.sx, pane.sy, pane.sw, pane.sh, dx, dy, pane.dw, pane.dh);
          } else {
            for (const rg of inlineRegions) {
              const top = Math.max(baseDy, rg.from);
              const bot = Math.min(baseDy + pane.dh, rg.to);
              if (bot <= top) continue;
              const finalTop = top + rg.off - segTop;
              const bandH = bot - top;
              if (finalTop + bandH < 0 || finalTop > segH) continue;
              const sSy = pane.sy + Math.round((top - baseDy) * paneSrcScaleY);
              const sSh = Math.max(1, Math.round(bandH * paneSrcScaleY));
              ctx.drawImage(img, pane.sx, sSy, pane.sw, sSh, dx, finalTop, pane.dw, bandH);
            }
          }
        }
        // Inline virtualized list unrolled INSIDE the pane (v1.9.10): stack the
        // stepped windows in the grown slot, each cropped to the list's band.
        if (inlineDraw) {
          for (const g of inlineDraw) {
            for (const f of g.frames) {
              const dy = g.finalTop + g.yMap.get(f.y) - segTop;
              if (dy + g.dh < 0 || dy > segH) continue;
              const img = await fsLoadImage(f.dataUrl);
              ctx.drawImage(img, g.sx, g.sy, g.sw, g.sh, g.dx, dy, g.dw, g.dh);
            }
          }
        }
      } else if (cap.mode === 'full') {
        // No resampling at 1:1 — keeps frame edges pixel-exact.
        ctx.imageSmoothingEnabled = outScale !== 1;
        const srcScaleY = first.height / frameH;   // final px -> source px (≈1/outScale)
        for (const f of mainFrames) {
          const dx = xMap.get(f.x);
          const baseDy = yMap.get(f.y);
          const img = f === mainFrames[0] ? first : await fsLoadImage(f.dataUrl);
          if (!inlineRegions) {
            const dy = baseDy - segTop;
            if (dy + frameH < 0 || dy > segH) continue;
            ctx.drawImage(img, dx, dy, frameW, frameH);
          } else {
            // Draw only the parts of this frame that fall in non-slot regions,
            // each shifted to its final position; the slot windows overpaint next.
            for (const rg of inlineRegions) {
              const top = Math.max(baseDy, rg.from);
              const bot = Math.min(baseDy + frameH, rg.to);
              if (bot <= top) continue;
              const finalTop = top + rg.off - segTop;
              const bandH = bot - top;
              if (finalTop + bandH < 0 || finalTop > segH) continue;
              const sSy = Math.round((top - baseDy) * srcScaleY);
              const sSh = Math.max(1, Math.round(bandH * srcScaleY));
              ctx.drawImage(img, 0, sSy, first.width, sSh, dx, finalTop, frameW, bandH);
            }
          }
        }
        // Inline virtualized list (v1.6.1): stack the stepped windows in the
        // grown slot, each cropped to the list's viewport band.
        if (inlineDraw) {
          for (const g of inlineDraw) {
            for (const f of g.frames) {
              const dy = g.finalTop + g.yMap.get(f.y) - segTop;
              if (dy + g.dh < 0 || dy > segH) continue;
              const img = await fsLoadImage(f.dataUrl);
              ctx.drawImage(img, g.sx, g.sy, g.sw, g.sh, g.dx, dy, g.dw, g.dh);
            }
          }
        }
        // Fixed side rails on document captures (v1.5.0): drawn LAST — the
        // rail was hidden during the main grid, so its column shows page
        // background there; the unrolled rail overpaints it from its top.
        if (sideDraw) {
          for (const g of sideDraw) {
            for (const f of g.frames) {
              const dy = g.dy + g.yMap.get(f.y) - segTop;
              if (dy + g.dh < 0 || dy > segH) continue;
              const img = await fsLoadImage(f.dataUrl);
              ctx.drawImage(img, g.sx, g.sy, g.sw, g.sh, g.dx, dy, g.dw, g.dh);
            }
          }
        }
      } else if (crop) {
        ctx.drawImage(first, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvasW, segH);
      } else {
        ctx.drawImage(first, 0, 0, canvasW, segH);
      }

      // v1.7.0 -- auto-redact: bake an OPAQUE block over each detected PII rect
      // (solid, not blur -> can't be reversed). Painted per-segment so a box in
      // part 2 lands correctly. The offset matches the box's coordinate frame:
      // v1.9.4 app-shell PANE boxes are in pane-content space (pane.dx/dy);
      // v1.9.5 side-RAIL boxes (b.pane set) are in that rail's content space
      // (sideDraw[i].dx/dy); v1.9.8 inline-unrolled LIST boxes (b.inline set) are
      // in that list's content space, baked at the injected slot's final top
      // (inlineDraw[i].finalTop), and a plain doc box below a slot shifts down by
      // the growth above it (inlineRegions); a doc box with no slot has offset 0.
      const paintedHere = [];   // {i, dx, dy, dw, dh} — verified after the crop
      /* Once per BOX. The paint loop runs once per segment, so a box whose
         frame is absent meets its `continue` in every one of them, and a
         counter incremented there would report a two-part capture as having
         twice as many refusals as it had boxes. */
      const noFrame = bi => {
        if (bakeSeen[bi] && !bakeSeen[bi].noFrame) { bakeSeen[bi].noFrame = true; bake.blocksNoFrame++; }
      };
      if (cap.mode === 'full' &&
          cap.meta.piiBoxes && cap.meta.piiBoxes.length) {
        const rk = scale * outScale;
        ctx.fillStyle = FS_BLOCK_HEX;
        for (let bi = 0; bi < cap.meta.piiBoxes.length; bi++) {
          const b = cap.meta.piiBoxes[bi];
          let ox, oy, by = Math.round(b.y * rk);
          if (b.inline != null) {
            const g = inlineDraw && inlineDraw.find(s => s.idx === b.inline);
            /* The frame this box was measured in does not exist this run, so
               there is nowhere honest to put the block. It is not painted, and
               `painted < matched` is what says so — an arithmetic shortfall the
               reader is shown over the actual image. THE REFUSAL IS ALSO
               COUNTED, at the refusal: a shortfall tells the reader that
               something is uncovered, and this says which of the four possible
               reasons it was. Once per box, not once per segment. */
            if (!g) { noFrame(bi); continue; }
            ox = g.dx; oy = g.finalTop;    // inline-list box -> its injected slot
          } else if (b.pane != null) {
            const g = sideDraw && sideDraw.find(s => s.idx === b.pane);
            if (!g) { noFrame(bi); continue; }   // frame absent this run — counted, then never painted
            ox = g.dx; oy = g.dy;
          } else {
            ox = pane ? pane.dx : 0;       // pane boxes are in pane-content space
            oy = pane ? pane.dy : 0;
            if (inlineRegions) {           // doc/pane box below a slot -> shift by growth
              // inlineRegions bounds are CANVAS space (they include pane.dy), but a
              // pane box's `by` is pane-content space — test in canvas space so a box
              // in the pane.dy band just below the slot is shifted too (v1.9.11).
              const cy = oy + by;
              for (const rg of inlineRegions) if (cy >= rg.from && cy < rg.to) { by += rg.off; break; }
            }
          }
          const dx = ox + Math.round(b.x * rk) - 2;
          const dy = oy + by - segTop - 2;
          const dw = Math.round(b.w * rk) + 4;
          const dh = Math.round(b.h * rk) + 4;
          if (dy + dh <= 0 || dy >= segH) continue;
          ctx.fillRect(dx, dy, dw, dh);
          if (!bakeSeen[bi].painted) { bakeSeen[bi].painted = true; bake.blocksPainted++; }
          paintedHere.push({ i: bi, dx, dy, dw, dh });
        }
      }

      // Not the final part → cut at a section top when one is in range
      // (never shrinking the part below half); else at a quiet pixel gap.
      if (segTop + segH < canvasH) {
        let brk = 0;
        if (breakYs) {
          const lo = segTop + Math.floor(segH * 0.5);
          for (const y of breakYs) {
            if (y > lo && y <= segTop + segH && y - segTop > brk) brk = y - segTop;
          }
        }
        if (!brk) brk = findQuietRowInCanvas(canvas, segH);
        if (brk > 0 && brk < segH) {
          const c2 = document.createElement('canvas');
          c2.width = canvasW; c2.height = brk;
          c2.getContext('2d').drawImage(canvas, 0, 0, canvasW, brk, 0, 0, canvasW, brk);
          canvas.width = canvas.height = 0;
          canvas = c2;
          segH = brk;
        }
      }

      /* VERIFY AFTER THE CROP, AGAINST THE CANVAS THAT IS ABOUT TO BE ENCODED.
         Getting this order wrong is how the check becomes flaky: the segment is
         SHORTENED above, between paint and encode, and the discarded tail is
         re-rendered — and its boxes re-painted — in the next segment. Verify
         before the crop and every long page fails; verify per segment and the
         check is green on short pages and red on long ones, and the temptation
         is then to loosen it. So a box that fell into the cropped tail is
         neither verified nor failed HERE — it stays pending, and
         `verified === painted` is asserted once at the end over the
         de-duplicated set. */
      if (paintedHere.length) verifyBlocks(canvas, segH, segTop, paintedHere, bakeSeen, bake);

      segments.push({ blob: await fsCanvasToBlob(canvas, type, quality), w: canvasW, h: segH });
      canvas.width = canvas.height = 0; // free memory
      segTop += segH;
    }
    /* THE SEAL, after the last segment, on the normal path only. */
    bake.sealed = true;
    /* WHAT ARRIVED AND WAS NEVER DRAWN. A subtraction of two counts in the SAME
       unit — blocks handed in, blocks that received paint — which is the only
       kind §2.1 permits. It is written here rather than left to a consumer
       because a consumer given two numbers and no answer computes its own, and
       the next one computes it differently. */
    bake.blocksUnpainted = bake.blocksHanded - bake.blocksPainted;
    /* THE UNIT CONVERSION, once, over the de-duplicated set — not incrementally
       in the paint loop, because a box's verified state moves BETWEEN segments:
       one that fell into a cropped tail is pending in this segment and read in
       the next, and a skipped box is un-skipped when a later segment manages
       the read. A running per-match total would have to be corrected in three
       places and would be wrong in the fourth. */
    rollUpMatches(bakeBoxes, bakeSeen, bake);

    setProgress(msg('resultProgressSaving', null, 'Saving…'));
    const thumb = await makeThumb(segments[0]);
    const record = {
      id: captureId,
      title: cap.title, url: cap.url,
      createdAt: cap.createdAt || Date.now(),
      mode: cap.mode,
      w: canvasW, h: canvasH,
      format: settings.imageFormat,
      breakYs: breakYs || null,   // v1.5.0: section tops for PDF page breaks
      outScale,
      segments, thumb,
      /* v1.11 — everything below this line exists so the AI hand-off envelope
         can be built later (AI-HANDOFF-ENVELOPE.md §3). Until now the shot
         record was written HERE and the capture record was deleted two lines
         down, so what kind of capture this was, how big the page really was,
         and whether anything was redacted were destroyed at the moment of
         success. IndexedDB records are schemaless, so this is additive and
         needs no DB_VERSION bump; every reader must treat the fields as
         optional, because history is full of records written before today. */
      meta: aiMeta(cap),
      captureSettings: aiSettings(cap),
      redaction: aiRedaction(cap, bake, bakeSeen)
    };
    await FSDB.put('shots', record);
    await FSDB.deleteFrames(captureId);
    await FSDB.delete('captures', captureId);
    return record;
  }

  /* AN ACTS BLOCK THAT MEASURED NOTHING, IN ONE PLACE. Two call sites need it —
     the record written when common.js is absent, and a shot whose stored block
     this build will not read — and they used to hold a literal each. Two
     literals of a versioned shape is one literal that gets updated: the acts
     block grew five fields in v4 and a stale copy would have emitted a v3 block
     into a v4 gate, which fails closed and takes the Copy button with it.
     `fsRedactActs(null)` IS this answer, so it is asked wherever it can be, and
     the literal below exists only for test/pixel-sim's common.js-free vm. */
  function absentActs() {
    if (typeof fsRedactActs === 'function') return fsRedactActs(null);
    return { v: 4, matched: null, painted: null, verifiedOpaque: null,
             matchedComplete: null, walkComplete: null, truncatedBy: null,
             textRefused: null, blocksLost: null, blocksUnpainted: null,
             blocksUnread: null, ledger: 'absent' };
  }

  /* ---- blocks -> matches, the one place the unit changes -------------------
     REDACTION-CLAIM-SPEC.md §2.1. `matched` counts DETECTOR MATCHES and the
     bake counts BLOCKS, one per client rect, so a token that wraps across a
     line is one match and two blocks. Reading 3/2/2 as "one match is not
     covered" is a subtraction, and a subtraction across that boundary is how a
     wrapped card number came to cancel an uncovered email: 1 matched / 2
     painted, surplus of one, and the miss disappeared into it.

     A MATCH IS COVERED ONLY IF EVERY BLOCK IT PRODUCED WAS COVERED — all of
     them painted, all of them read back opaque. Not "at least one": half a card
     number is a card number, and the safe direction for a count of what is
     STILL EXPOSED is to under-claim coverage.

     PRODUCED, NOT ARRIVED, AND THAT IS THE WHOLE OF THE NINTH ROUND'S DEFECT.
     This function graded a match against the blocks it was HANDED. The box
     ceiling stops emission mid-match, so a match whose later rectangles were
     dropped arrived here as the subset that fitted — every one of them painted,
     every one read back opaque — and was counted covered, over an image with
     the tail of that number legible in it. The rule was never wrong. Its INPUT
     was silently partial, which is why nine rounds of fixing rules produced a
     tenth round: the fix is that the input must carry its own completeness.

     THE PROJECTION BELOW IS WHAT MAKES THAT UNAVOIDABLE. It is handed the raw
     boxes and returns one TALLY per match — produced, emitted, painted,
     verified as one value — and it is the only thing the roll-up can read. The
     old shape was a bare `matchId` on each box, which is exactly enough to
     group what arrived and not enough to know what was missing; you cannot ask
     this shape which match a block belongs to without being told how many
     blocks that match produced. Not discouraged: unavailable.

     `null`, NOT ZERO, WHEN THE BOXES CARRY NO IDENTITY — a record stitched from
     a capture an older build measured, whose boxes have no match value at all.
     A zero here would say "nothing was painted" about an image with blocks all
     over it. The counters stay null, the acts say `—`, and no sentence
     subtracts anything. */
  function matchTallies(boxes, seen) {
    const list = Array.isArray(boxes) ? boxes : [];
    const byId = new Map();
    for (let i = 0; i < list.length; i++) {
      const b = list[i], s = seen[i], m = b && b.match;
      if (!m || typeof m.id !== 'number' || !isFinite(m.id) ||
          typeof m.blocks !== 'number' || !isFinite(m.blocks) || m.blocks < 1 || !s) {
        return null;                                   // cannot say, for any of them
      }
      let t = byId.get(m.id);
      if (!t) { t = { produced: m.blocks, emitted: 0, painted: 0, verified: 0 }; byId.set(m.id, t); }
      /* Two blocks of one match disagreeing about that match's production is a
         corrupt input, not a smaller one, and there is no honest way to pick a
         winner: the whole roll-up refuses. */
      if (t.produced !== m.blocks) return null;
      t.emitted++;
      /* MORE BLOCKS THAN THE MATCH SAYS IT PRODUCED is the same impossibility as
         a covered count above a matched one, one level down, and it is refused
         for the same reason: it would make `produced - emitted` negative, and a
         negative loss added to a positive one on another match cancels a real
         one. An impossible input is refused whole, never reconciled. */
      if (t.emitted > t.produced) return null;
      if (s.painted) t.painted++;
      if (s.verified) t.verified++;
    }
    return byId;
  }
  function rollUpMatches(boxes, seen, bake) {
    const tallies = matchTallies(boxes, seen);
    if (!tallies) return;                              // the counters stay null
    let painted = 0, verified = 0, lost = 0;
    for (const t of tallies.values()) {
      /* THE BLOCKS THAT NEVER ARRIVED, counted here as well as at the drop, and
         deliberately: this number is derived from the same value the grading
         is derived from, so a roll-up that could see the loss and grade the
         match covered anyway is arithmetically impossible rather than merely
         unwritten. test/pixel-sim asserts it against the scan's own count. */
      lost += t.produced - t.emitted;
      /* `=== produced`, never `=== emitted`. A match is covered when every
         block it produced was covered, so a match the ceiling cut short can
         never satisfy either arm however solid its survivors are. */
      if (t.painted === t.produced) painted++;
      if (t.verified === t.produced) verified++;
    }
    bake.matchesPainted = painted;
    bake.matchesVerifiedOpaque = verified;
    bake.blocksLost = lost;
  }

  /* ---- what the record keeps about the capture -----------------------------
     Three small pickers, one rule each. They are NAMED PICKS, never a spread
     of cap.meta or cap.settings: a spread would carry whatever the engine adds
     next, and two of the things it carries today must never be persisted.

     THE RECTANGLES MUST NOT TRAVEL. cap.meta.piiBoxes is a map of where the
     secrets are, and persisting it next to an image in which they are blacked
     out hands back exactly what the bake removed. The COUNT is the useful part
     and the geometry is the leak, so the count is kept and the boxes are
     dropped in the same expression that reads them. */
  function aiMeta(cap) {
    const m = (cap && cap.meta) || {};
    const boxes = Array.isArray(m.piiBoxes) ? m.piiBoxes : [];
    const out = { piiCount: boxes.length };
    for (const k of ['totalW', 'totalH', 'vw', 'vh', 'dpr', 'winW', 'winH', 'virtualScrollers']) {
      if (typeof m[k] === 'number') out[k] = m[k];
    }
    if (m.sidePanes) out.sidePanes = m.sidePanes.length;
    if (m.inlinePanes) out.inlinePanes = m.inlinePanes.length;
    if (m.breakHints) out.breakHintCount = m.breakHints.length;
    /* A region capture's whole meta is {cropRect, dpr} (background.js writes
       it that way), so everything above is simply absent and that is fine. */
    if (m.cropRect) out.cropRect = { w: m.cropRect.w, h: m.cropRect.h };
    return out;
  }

  /* THE SETTINGS DIGEST IS A PICK, NOT A COPY. cap.settings is the whole of
     getSettings() — which includes filenameTemplate and saveDirectory, the two
     free-text settings where a person types a client name or a folder full of
     one. Those describe the USER, not the capture; the flags below describe
     what the engine did to the page, which is the only part a model or a bug
     report needs. */
  const AI_SETTING_KEYS = ['redactPII', 'hideFixed', 'preScroll', 'adaptiveWait',
    'hideOverlays', 'expandInner', 'unrollVirtual', 'expandInteractive', 'loadMore',
    'infiniteScroll', 'waitStable', 'captureDelay', 'maxPageHeight', 'imageFormat',
    'jpegQuality'];
  function aiSettings(cap) {
    const s = (cap && cap.settings) || {};
    const out = {};
    for (const k of AI_SETTING_KEYS) if (s[k] !== undefined) out[k] = s[k];
    return out;
  }

  /* WHAT HAPPENED, NEVER WHAT WAS ASKED FOR — AND NOTHING THAT SUMMARISES IT.

     Every previous version of this function ended in a WORD: `baked`,
     `read-no-match`, `unknown`. Six of them were defeated, each by a page shape
     nobody had enumerated, and the seventh would have been too, because the
     word was a claim about a PICTURE derived from a reading of the DOM. So the
     word is gone. What this returns is the three acts, the two facts about the
     walk, and the rectangles that were READ BACK OPAQUE OUT OF THE FINISHED
     IMAGE — nothing that can be read as a verdict, because there is nothing
     left to read.

     `requested` COMES FROM `meta.piiPass`, WHICH IS AN ACT. That is the second
     half of the fix described on the bake ledger above: `piiPass` is written by
     the branch in content/capture.js that DECIDED to run the pass, from the
     settings snapshot that capture was started with. `cap.settings` is a
     SEPARATE, LATER read of the same preference, taken by background.js at
     FS_DONE — a different instant, a different answer whenever anything wrote
     the preference in between, and the source of a record that says redaction
     was off over an image with three blocks painted into it. An absent
     `piiPass` is `null`, never `false`: "we cannot tell whether the pass ran"
     gates the review (§4), and `false` would waive it.

     THE UNVERIFIED RECTANGLES STILL DO NOT TRAVEL. Only `bakeSeen[i].mark` —
     written inside the read-back's success arm and nowhere else — reaches the
     record. A rect that failed or skipped verification describes the PAGE and
     is a map to something that may still be visible; it is discarded here, in
     the same expression that reads it.

     `typeof` guard for the same reason as aiReady(): test/pixel-sim boots this
     file alone in a node vm, and where common.js is genuinely absent the acts
     degrade to an absent ledger — which is honest and is also the safe one. */
  function aiRedaction(cap, bake, seen) {
    const m = (cap && cap.meta) || {};
    const boxes = Array.isArray(m.piiBoxes) ? m.piiBoxes : [];
    const kinds = {};
    for (const b of boxes) if (b && b.kind) kinds[b.kind] = (kinds[b.kind] || 0) + 1;

    const scan = (m.piiScan && typeof m.piiScan === 'object') ? m.piiScan : null;
    const requested = typeof m.piiPass === 'boolean' ? m.piiPass : null;
    const acts = typeof fsRedactActs === 'function'
      ? fsRedactActs({ scan, bake: bake || null })
      : absentActs();
    const marks = [];
    for (const s of (Array.isArray(seen) ? seen : [])) if (s && s.verified && s.mark) marks.push(s.mark);
    return { v: 3, requested, acts, kinds, marks };
  }

  async function makeThumb(segment) {
    const bmp = await createImageBitmap(segment.blob);
    const tw = 480;
    const th = Math.max(1, Math.min(600, Math.round(bmp.height * tw / bmp.width)));
    const sh = Math.min(bmp.height, Math.round(th * bmp.width / tw)); // top crop
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(bmp, 0, 0, bmp.width, sh, 0, 0, tw, th);
    bmp.close();
    return fsCanvasToBlob(c, 'image/jpeg', 0.8);
  }

  /* ---------------- rendering ---------------- */

  function setProgress(text) {
    $('progressText').textContent = text;
  }

  function showEmpty(text) {
    /* Was the keyboard inside the toolbar this is about to hide? It normally
       is: the ordinary way to reach this function is to press Delete, which
       lives in #actions. A hidden element cannot hold focus, so the browser
       drops it to <body> — the top of the document, with no announcement and
       nothing said about the screenshot having gone. */
    const actions = $('actions');
    /* `typeof … === 'function'` is not defensiveness, it is this file's second
       consumer: test/pixel-sim loads pages/result.js as a plain module against
       a deliberately minimal element stub with no contains(), no focus() and
       no activeElement. The sim exists to grade the stitcher, and teaching its
       stub three DOM methods so that a line about focus can run would be the
       sim growing to fit the page. Same idiom as the `typeof document` guards
       in pages/common.js. In a real browser the test is always taken, and the
       .focus() below is only ever reached when it passed. */
    const cameFromToolbar = typeof actions.contains === 'function' &&
      actions.contains(document.activeElement);
    $('progress').hidden = true;
    $('view').hidden = true;
    actions.hidden = true;
    $('emptyText').textContent = text;
    $('empty').hidden = false;
    /* The panel itself, not the link inside it: it holds the heading and the
       sentence that explain the empty page, and a screen reader reads from
       where focus lands. tabindex="-1" in the markup is what allows this. */
    if (cameFromToolbar) $('empty').focus();
  }

  function render() {
    $('progress').hidden = true;
    $('empty').hidden = true;
    $('view').hidden = false;
    $('actions').hidden = false;

    const size = shot.segments.reduce((a, s) => a + s.blob.size, 0);
    /* One message, not four fragments joined with ' · ': the separators, the
       word "px" and the order are the translator's, and Arabic writes
       "$WIDTH$ × $HEIGHT$ بكسل". The captured page's own title goes in as a
       substitution and is never translated; the dimension pair is isolated by
       dimSubs so it cannot reverse against a right-to-left sentence. */
    const untitled = msg('historyUntitled', null, 'Screenshot');
    $('metaText').textContent = msg('resultMeta',
      [shot.title || shot.url || untitled, ...dimSubs(shot.w, shot.h), fsFormatBytes(size)],
      '$NAME$  ·  $WIDTH$×$HEIGHT$ px  ·  $SIZE$');
    document.title = msg('resultDocumentTitle', [shot.title || untitled], '$TITLE$ — FullShot');

    const wrap = $('segments');
    wrap.innerHTML = '';
    shot.segments.forEach((seg, i) => {
      const div = document.createElement('div');
      div.className = 'seg-wrap';

      if (shot.segments.length > 1) {
        const head = document.createElement('div');
        head.className = 'seg-head';
        /* The one markup sink on this page — and it now interpolates nothing at
           all. The heading used to be assembled inside this string; it is a
           translated message now, and a message file is text that must never
           become markup, so the sink lays out the two empty spans and
           textContent fills the first one below. Two literals, one element
           each, so a reader sees the structure. */
        head.innerHTML = '<span></span>' +
                         '<span class="grow"></span>';
        head.firstChild.textContent = msg('resultPartHeading',
          [i + 1, shot.segments.length, ...dimSubs(seg.w, seg.h)],
          'Part $INDEX$ of $TOTAL$ · $WIDTH$×$HEIGHT$');
        /* The one thing the seg-head row could not do: copy. It could
           Download, Edit and Clip a part, so "just this part" was a download
           or two clicks through the editor. Labelled with the toolbar's own
           translated word, so no new string enters the product. */
        const cp = document.createElement('button');
        cp.type = 'button';
        cp.className = 'btn'; cp.textContent = msg('resultCopy', null, 'Copy');
        cp.addEventListener('click', () => copyHandoff(i));
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'btn'; dl.textContent = msg('resultDownloadPart', null, 'Download part');
        dl.addEventListener('click', () => downloadSegment(i));
        const ed = document.createElement('button');
        ed.type = 'button';
        ed.className = 'btn'; ed.textContent = msg('resultEditPart', null, 'Edit part');
        ed.addEventListener('click', () => openEditor(i));
        const cl = document.createElement('button');
        cl.type = 'button';
        cl.className = 'btn'; cl.textContent = msg('resultClipPart', null, 'Clip part');
        cl.addEventListener('click', () => openScrollClip(i));
        head.append(cp, dl, ed, cl);
        div.appendChild(head);
      }

      const img = document.createElement('img');
      img.className = 'shot-img';
      img.src = URL.createObjectURL(seg.blob);
      img.alt = msg('resultPartAlt', [i + 1], 'Screenshot part $INDEX$');
      div.appendChild(img);
      wrap.appendChild(div);
    });

    $('dlBtn').addEventListener('click', downloadImages);
    $('pdfBtn').addEventListener('click', downloadPdf);
    $('copyBtn').addEventListener('click', copyImage);
    $('editBtn').addEventListener('click', () => openEditor(0));
    $('beautifyBtn').addEventListener('click', () => openBeautify(0));
    $('clipBtn').addEventListener('click', () => openScrollClip(0));
    $('delBtn').addEventListener('click', deleteShot);
    showHandoffCost();
    warnRedaction();
  }

  /* ---- the half of this that a person reads --------------------------------
     A STATS LINE, NOT A SENTENCE ABOUT THE IMAGE. It says what FullShot did:
     how many patterns the detector matched in the text it was handed, how many
     blocks were painted, how many of those were read back opaque. It does not
     say whether the picture is clean, because this program cannot see the
     picture and the person can.

     There is no toast. A transient alarm was the old design's way of grading
     eight states by volume, and the grading is what has been removed; the line
     is permanent because a fact about a stored image should be there tomorrow
     too. The place a person is stopped is the review dialog (§3), and it is
     spent on exactly one action: handing the image to a machine.

     THE RECORD AS THIS BUILD IS ENTITLED TO READ IT. pages/db.js strips and
     translates on the way out of the store (§4), so `shot.redaction` here is
     either the v3 block this file writes or nothing at all. The old verdict is
     never read — not as an input, not as a fallback, not to seed a default. */
  function currentRedaction() {
    const r = shot.redaction;
    if (r && r.v === 3 && r.acts && typeof r.acts === 'object') return r;
    return { v: 3, requested: null, acts: absentActs(),
             kinds: (r && r.kinds) || {}, marks: [] };
  }

  /* HOW MANY MATCHES ARE NOT COVERED — asked of pages/common.js, and asked in
     exactly one place on this page. The sentence and the emphasis on that
     sentence used to be two different predicates: the text arm fired on
     `verifiedOpaque < painted` and the bold arm on `painted < matched`, so the
     one bolded line in the design was rendered unbolded on the very run that
     produced it. One function, two call sites, no way for them to disagree.

     The `typeof` guard is this file's second consumer again (see the msg /
     plural wrappers at the top): test/pixel-sim boots result.js alone in a node
     vm. `null` means "no honest subtraction is available", which renders the
     flat line — the three raw counts, unsummarised — and never a reassurance. */
  function shortfall(acts) {
    return typeof fsRedactShortfall === 'function' ? fsRedactShortfall(acts) : null;
  }

  /* The three numbers and the walk, in the reader's own locale. Every
     substitution is an integer this product computed; nothing from the captured
     page reaches this string, and it goes in through textContent regardless —
     the rule is that untrusted text never becomes markup, not that today's
     values happen to be safe. */
  function actsLine(r) {
    const a = (r && r.acts) || {};
    if (r && r.requested === false) return null;
    if (a.ledger === 'absent') {
      return msg('redactActsNoLedger', null,
        'This record carries no account of a redaction pass on this capture.');
    }
    const num = v => typeof v === 'number';
    const n = v => (num(v)
      ? (typeof fsNumber === 'function' ? fsNumber(v) : String(v))
      : msg('redactActsUnknownCount', null, '—'));
    let text;
    const short = shortfall(a);
    /* THREE VARIANTS, ALL ALLOWLISTED (REDACTION-CLAIM-SPEC.md §3.4), chosen by
       arithmetic on integers this product computed. None of them summarises: the
       third states the shortfall as a subtraction and stops.

       THE SHORTFALL ARM IS SELECTED BY THE SHORTFALL ITSELF, which is the fix
       for two defects at once. It used to be selected by `painted < matched ||
       verifiedOpaque < painted` — a pair of comparisons across a unit boundary,
       the first of them silenced by any wrapped token and the second able to
       open the arm on numbers whose subtraction is zero or negative. That arm
       then printed "Redaction matched 3 and covered 5. 0 matches are not
       covered in this image." A shortfall that is not a positive number is not
       a quieter alarm, it is an impossibility, and it renders NOTHING. */
    if (num(a.matched) && a.matched === 0) {
      text = msg('redactActsNone', null,
        'Redaction matched nothing in the text it read and painted no blocks. ' +
        'Nothing is outlined below.');
    } else if (short != null && short > 0) {
      const covered = a.matched - short;
      /* TWO SENTENCES, and the split is not cosmetic: the first states two
         counts and can agree with neither, the second states one and is a
         declared plural base. "1 matches are not covered" on the one line in
         this design that means something is where a reader stops believing the
         rest of it. */
      text = msg('redactActsShortfall', [n(a.matched), n(covered)],
        'Redaction matched $MATCHED$ and covered $COVERED$.');
      const rest = plural('redactActsUncovered', short, [n(short)],
        short === 1 ? '$COUNT$ match is not covered in this image.'
                    : '$COUNT$ matches are not covered in this image.');
      if (rest != null) text = (text == null ? '' : text + ' ') + rest;
    } else {
      text = msg('redactActsLine', [n(a.matched), n(a.painted), n(a.verifiedOpaque)],
        'Redaction on. $MATCHED$ matched, $PAINTED$ painted, $VERIFIED$ confirmed opaque in this image.');
    }
    if (a.walkComplete === false) {
      const more = msg('redactActsWalkTruncated', null,
        'FullShot did not finish walking this page.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    /* ---- THE COMPLETENESS THAT TRAVELS WITH THE COUNT --------------------
       §2.1.1: A COUNT WITHOUT ITS COMPLETENESS FLAG IS NOT A COUNT. The payload
       has always said "(PARTIAL count)" for this record; this screen said
       nothing, so the two surfaces described one capture and only one of them
       admitted the number might be short. The reader believes whichever they
       saw, and the silent one was the one with the picture next to it.

       APPENDED, NEVER AN ARM. It composes with all three arms above, including
       the zero arm — "matched nothing" over text the pass never read is exactly
       the sentence that most needs this beside it.

       IT IS NOT REDUNDANT WITH THE FOUR GAP SENTENCES, and that is why it is
       not gated on them being silent. Every gap counter can be zero while this
       is false: `declined.other` — a span the second measurement had no room to
       hold — and an unwalked same-origin frame both reach the seal and neither
       reaches `textRefused`, by design in both cases (the first because
       `textRefused` stays exact, the second because no leaf was refused at all).
       Gating this on "no other sentence rendered" would restore the silence on
       the two shapes it was written for. It carries no counts because the thing
       it reports is precisely the part that was not counted; the sentences
       below carry the parts that were. */
    if (a.matchedComplete === false) {
      const more = msg('redactActsCountPartial', null,
        'This count may be short: FullShot did not read some of the text in this capture.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    /* ---- WHERE THE PASS GAVE UP, AND ON WHAT ----------------------------
       Two sentences, appended to whichever arm rendered, and each one only
       when it has something to report. They exist because a shortfall tells a
       reader THAT something is uncovered and never WHY, and the four reasons
       are four different situations: text that was never read, blocks a cap
       refused to emit, blocks that had nowhere to be drawn, blocks that were
       drawn and never re-read. A single "something went wrong" flag would
       collapse all four, and a reader can act on them differently.

       Each carries TWO counts and is therefore not a plural base — the same
       rule §6 gives for the three-count stats line: a sentence with two counts
       can only agree with one of them. */
    const gap = v => (num(v) && v > 0);
    if (gap(a.textRefused) || gap(a.blocksLost)) {
      const more = msg('redactActsScanLimits', [n(a.textRefused || 0), n(a.blocksLost || 0)],
        'Pieces of text it did not read: $REFUSED$. Blocks it found and did not draw: $LOST$.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    if (gap(a.blocksUnpainted) || gap(a.blocksUnread)) {
      const more = msg('redactActsBakeLimits', [n(a.blocksUnpainted || 0), n(a.blocksUnread || 0)],
        'Blocks it could not place in this image: $UNPLACED$. Blocks it drew and did not read back: $UNREAD$.');
      if (more != null) text = (text == null ? '' : text + ' ') + more;
    }
    return text;
  }

  function warnRedaction() {
    const el = $('redactLine');
    const text = actsLine(currentRedaction());
    if (!el) return;
    if (text == null) { el.hidden = true; return; }
    el.textContent = text;
    el.hidden = false;
  }

  function baseFilename() {
    return fsBuildFilename(settings.filenameTemplate, {
      title: shot.title, url: shot.url, width: shot.w, height: shot.h
    });
  }

  function ext() { return fsExt(shot.format); }

  async function downloadSegment(i) {
    const name = baseFilename() + (shot.segments.length > 1 ? '-part' + (i + 1) : '') + ext();
    await fsDownloadBlob(shot.segments[i].blob, name);
    /* $FILENAME$ is built from the captured page and the user's own template —
       it goes in as a substitution and is never translated. */
    fsToast(msg('resultToastDownloading', [name], 'Downloading $FILENAME$'));
  }

  async function downloadImages() {
    for (let i = 0; i < shot.segments.length; i++) await downloadSegment(i);
  }

  function openEditor(i) {
    location.href = 'editor.html?shot=' + encodeURIComponent(shot.id) + '&seg=' + i;
  }

  function openBeautify(i) {
    location.href = 'beautify.html?shot=' + encodeURIComponent(shot.id) + '&seg=' + i;
  }

  function openScrollClip(i) {
    location.href = 'scrollclip.html?shot=' + encodeURIComponent(shot.id) + '&seg=' + i;
  }

  async function deleteShot() {
    if (!confirm(msg('resultConfirmDelete', null, 'Delete this screenshot permanently?'))) return;
    await FSDB.delete('shots', shot.id);
    showEmpty(msg('resultDeleted', null, 'Screenshot deleted.'));
  }

  /* ---------------- the AI hand-off ----------------
     AI-HANDOFF-ENVELOPE.md is the specification; pages/common.js is the
     implementation of it. Everything here is the wiring: what this page knows
     about the shot, handed to the builder, and what comes back put on the
     clipboard beside the picture.

     `typeof fsAiBundle === 'function'` is not defensiveness. It is the same
     guard, for the same reason, as the `typeof fsMessage` wrapper at the top of
     this file: test/pixel-sim boots result.js alone in a node vm to grade the
     stitching math, against a sandbox that has never heard of common.js. A
     bare call there would take that tier down with a reference error. */
  function aiReady() { return typeof fsAiBundle === 'function'; }

  function stackedHeight() {
    return shot.segments.reduce((a, s) => a + s.h, 0);
  }

  /* The shot as the envelope's `subject`. A record written before v1.11 has no
     meta at all, so every field here degrades to null rather than to a guess —
     and redaction degrades to 'unknown', which is the one that matters: a
     producer that cannot prove the pixels were baked must not say they were. */
  function handoffInput(part, reviewed) {
    const m = shot.meta || null;
    const h = stackedHeight();
    const r = currentRedaction();
    return {
      id: shot.id,
      producer: { tool: 'FullShot', version: appVersion(), surface: 'chrome-extension' },
      subject: {
        kind: 'web-page',
        mode: shot.mode || 'unknown',
        url: shot.url || '',
        title: shot.title || '',
        capturedAt: new Date(shot.createdAt || Date.now()).toISOString(),
        viewport: m && m.vw ? { w: m.vw, h: m.vh || 0, dpr: m.dpr || 1 } : null,
        content: m && m.totalW ? { w: m.totalW, h: m.totalH || 0 } : null,
        image: { w: shot.w, h: h }
      },
      redactRequested: r.requested,
      redactActs: r.acts,
      /* A PRECONDITION AND NEVER A PAYLOAD (§3.5). Exactly one function sets
         this — the one that showed the person the image and got the click — and
         fsAiBundle refuses without it whenever redaction was requested. It is
         passed here rather than checked at the button so a call site added next
         year cannot walk past it. */
      reviewed: reviewed === true,
      pixelKinds: r.kinds || {},
      /* Not produced yet — content/capture.js has no page-text pass (plan item
         AI-2). The envelope takes it the day it exists, already masked, and the
         legend starts naming what its arrows point at. */
      pageText: shot.pageText || null,
      /* Not persisted yet either: pages/editor.js does not write objects on
         save (plan item AI-11). Same shape, same day. */
      annotations: shot.annotations || null,
      breakYs: shot.breakYs || null,
      notes: handoffNotes(),
      part: part || null
    };
  }

  /* Version from the shipped manifest, never a literal: a number typed here
     would disagree with the package the first time somebody bumps one of them. */
  function appVersion() {
    try { return chrome.runtime.getManifest().version; } catch (_) { return '0'; }
  }

  /* What could not be read. Short, true for THIS capture, and never a recital
     of every caveat the product has — noise in the payload is what gets the
     payload trimmed by the next person. AI-HANDOFF-ENVELOPE.md §11. */
  function handoffNotes() {
    const out = [];
    if (shot.mode === 'visible') out.push('Only the visible area was captured; the page continues above or below.');
    if (shot.mode === 'region' || shot.mode === 'element') out.push('This is a crop of the page, not the whole page.');
    const m = shot.meta;
    if (m && m.virtualScrollers) out.push('The page uses virtualised lists; content outside the render window may be missing.');
    /* NO REDACTION SENTENCE HERE ANY MORE. fsAiText writes the acts line and
       the constant beside it, in the payload's own fixed ASCII, from the same
       block the envelope carries — one producer, one wording. A second copy
       assembled here would be a second place for the two to disagree, and this
       one used to travel as an ENGLISH sentence built by a renderer that the
       screen also used, which is how the payload and the page were kept in
       step by hand. */
    out.push('Video, canvas and WebGL are captured as painted and cannot be read as text.');
    return out;
  }

  /* One canvas, allocated at the size the image is GOING TO BE, with each
     segment drawn straight into its scaled destination rect.

     THE ORDERING IS LOAD-BEARING. Composing at full size and then downscaling
     would allocate exactly the canvas MAX_DIM and MAX_AREA exist to avoid — a
     40000px stack is not allocatable, which is the whole reason the stitcher
     split it into parts in the first place. Pre-scaled composition sidesteps
     both limits, and it is why "copy the whole capture" is possible at all. */
  async function composeScaled(fromY, toY, outW, outH) {
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    const span = Math.max(1, toY - fromY);
    let top = 0;
    for (const seg of shot.segments) {
      const bottom = top + seg.h;
      if (bottom > fromY && top < toY) {
        const sy = Math.max(0, fromY - top);
        const sh = Math.min(seg.h, toY - top) - sy;
        if (sh > 0) {
          const bmp = await createImageBitmap(seg.blob);
          const dy = Math.round((top + sy - fromY) * outH / span);
          const dh = Math.max(1, Math.round(sh * outH / span));
          ctx.drawImage(bmp, 0, sy, seg.w, sh, 0, dy, outW, dh);
          bmp.close();
        }
      }
      top = bottom;
    }
    const blob = await fsCanvasToBlob(canvas, 'image/png');
    canvas.width = canvas.height = 0;   // free it before the next one exists
    return blob;
  }

  /* THE EXPORT'S OWN ARITHMETIC, without building an envelope for it.
     `showHandoffCost` used to construct a whole bundle to read two numbers out
     of it, which is why the review precondition could not live at the producer
     until now — the tooltip would have tripped it on every render. Both callers
     want the same three facts (the fitted size, whether it is a reduced
     overview, and the token estimate), and all three come from the pure
     functions in pages/common.js. */
  function exportFit(segIndex) {
    if (typeof fsAiFitDims !== 'function') return null;
    const P = FS_AI_PROFILES[FS_AI_DEFAULT_PROFILE];
    let fromY = 0, toY = stackedHeight(), part = null;
    if (segIndex != null) {
      let top = 0;
      for (let i = 0; i < segIndex; i++) top += shot.segments[i].h;
      fromY = top; toY = top + shot.segments[segIndex].h;
      part = { index: segIndex + 1, count: shot.segments.length, fromY, toY };
    }
    const srcW = shot.w, srcH = Math.max(1, toY - fromY);
    let fit = fsAiFitDims(srcW, srcH, P);
    let tiles = 0;
    if (fit.needsTiling) {
      const plan = fsAiPlanTiles({ w: srcW, h: srcH, maxEdge: P.maxEdge, maxArea: P.maxArea,
                                   hardMaxEdge: P.hardMaxEdge, overlap: 64,
                                   breakYs: shot.breakYs || null });
      tiles = plan.tiles.length;
      fit = { w: plan.overview.w, h: plan.overview.h, scale: plan.overview.scale,
              limitedBy: plan.overview.limitedBy, needsTiling: true };
    }
    return { fromY, toY, part, fit, tiles, srcW, srcH,
             tokens: fsAiTokens(fit.w, fit.h, FS_AI_DEFAULT_PROFILE) };
  }

  /* The whole capture, or one part of it, plus the text that explains it.
     `blob` is passed in by the review path, which has already composed exactly
     the image it showed the person — recomposing here would put a second,
     unexamined encode on the clipboard, and "the thing you looked at is the
     thing that left" is the entire point of the dialog. */
  async function buildHandoff(segIndex, reviewed, blob) {
    const plan = exportFit(segIndex);
    const bundle = fsAiBundle(handoffInput(plan ? plan.part : null, reviewed));
    const fit = bundle.envelope.budget.fit;
    /* Both sides compute the fit from the same pure function and the same
       inputs, so they agree; the comparison is here because "agree" is a
       property somebody can break, and the safe answer to a disagreement is to
       ship the size the envelope declares. */
    const out = (blob && plan && plan.fit.w === fit.w && plan.fit.h === fit.h)
      ? blob : await composeScaled(plan ? plan.fromY : 0,
                                   plan ? plan.toY : stackedHeight(), fit.w, fit.h);
    return { blob: out, text: bundle.text, envelope: bundle.envelope };
  }

  /* The cost of a paste is a decision the user makes BEFORE making it, so the
     number goes on the button, not in the toast afterwards.

     It is the payload's own vocabulary rather than a translated sentence about
     it — the same reasoning as "shown is saved" in the worker's diagnostic
     bundle. What the user reads here is what the model will read there, which
     is why the terms are spelled `limitedBy=edge` and `tiles=12`. The button's
     LABEL and its translated tooltip are untouched; this is appended to them. */
  function showHandoffCost() {
    const plan = exportFit(null);
    if (!plan) return;
    /* Through fsDims: this line lands inside a TRANSLATED tooltip, so in an
       Arabic or Hebrew paragraph a bare pair reverses and a 1280-wide capture
       reads 3000 wide. */
    let line = fsDims(shot.w, stackedHeight()) + ' -> ' + fsDims(plan.fit.w, plan.fit.h);
    if (plan.fit.limitedBy) line += ' · limitedBy=' + plan.fit.limitedBy;
    if (plan.tiles) line += ' · tiles=' + plan.tiles;
    line += ' · ~' + plan.tokens.estimate + ' tokens (' + plan.tokens.rule + ', ' +
            plan.tokens.asOf + ')';
    const btn = $('copyBtn');
    const tip = btn.getAttribute('title');
    btn.setAttribute('title', (tip ? tip + ' — ' : '') + line);
  }

  /* ================= HALF TWO — the human is the oracle =====================
     REDACTION-CLAIM-SPEC.md §3. FullShot cannot see the picture. The person
     can. So before a bundle leaves the machine, the person is shown THE EXACT
     IMAGE THAT IS ABOUT TO GO — already composed, already downscaled to
     `budget.fit`, because that is the artifact, not the full-size capture —
     with every block that was read back opaque outlined on it.

     WHAT THIS IS NOT. It is not a warning, it is not a confirmation, and it is
     not a checkbox. An alarming dialog on every capture is wallpaper within a
     week and then protects nobody, so it fires on ONE action — handing the
     image to a machine — and only when redaction was requested. Saving a PNG is
     never interrupted.

     ONCE PER RECORD PER PAGE LOAD, AND NEVER PERSISTED. Two copies in one
     sitting, one dialog; come back tomorrow and the dialog returns, because
     tomorrow is a fresh look at a picture nobody remembers. There is no "don't
     show this again": the confirmation is the entire justification for emitting
     a bundle at all, and a checkbox that disables it disables the design. */
  const reviewedThisLoad = new Set();
  let reviewState = null;

  /* The magnification ceiling. `readK` below almost never approaches it — it is
     here so that a pathological fit (a 40 000 px strip reduced to a sliver)
     cannot ask the browser to paint an image several tens of thousands of CSS
     pixels wide. */
  const REVIEW_MAX_K = 8;
  /* A tenth of the viewport is kept as overlap between one step of the walk and
     the next, so a line of text is never cut in half by the boundary between
     two views. */
  const REVIEW_STEP = 0.9;

  function reviewKey(segIndex) { return segIndex == null ? 'all' : String(segIndex); }

  /* Marks that fall inside the exported band, moved into that band's own
     coordinates and scaled to the exported pixels. Full-image coordinates come
     off the record; everything after this is preview geometry. */
  function marksForExport(r, plan) {
    const out = [];
    const list = (r && Array.isArray(r.marks)) ? r.marks : [];
    const kx = plan.fit.w / Math.max(1, plan.srcW);
    const ky = plan.fit.h / Math.max(1, plan.srcH);
    for (const m of list) {
      if (!m || typeof m.x !== 'number') continue;
      if (m.y + m.h <= plan.fromY || m.y >= plan.toY) continue;
      out.push({ x: m.x * kx, y: (m.y - plan.fromY) * ky, w: m.w * kx, h: m.h * ky });
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out;
  }

  /* Resolves true when the person confirmed, false on Cancel or Escape. */
  function showReview(r, plan, blob) {
    const dlg = $('reviewDlg');
    if (!dlg || typeof document.createElement !== 'function') return Promise.resolve(true);
    const acts = (r && r.acts) || {};
    const marks = marksForExport(r, plan);

    /* THE COPY. Flat, specific, over in one read, and never the words safe,
       clean, secure, protected or done. The first paragraph is the SAME
       renderer the permanent line uses, so the dialog and the page cannot
       disagree about what happened. */
    $('reviewActs').textContent = actsLine(r) || '';
    $('reviewLimit').textContent = msg('reviewLimit', null,
      'FullShot reads the text a page exposes. It cannot see this image. Anything drawn ' +
      'as pixels — a canvas, an image, a PDF page, a video frame — was never read.');
    /* The one bolded line in the design, and it is bolded by a class rather
       than by markup built from a string. THE SAME PREDICATE THE SENTENCE USED,
       by construction: this used to test `painted < matched` while actsLine's
       shortfall arm tested `verifiedOpaque < painted` as well, so the two
       disagreed on exactly the run that mattered — the sentence appeared and
       the emphasis did not. */
    const short = shortfall(acts);
    $('reviewActs').className = (short != null && short > 0) ? 'review-short' : '';

    /* THE DIALOG'S OWN LINE, not the toast's. `resultAiOverviewOnly` names the
       Copy button — which was correct while it was a toast raised beside that
       button, and wrong inside a dialog whose own primary button reads "I have
       looked — copy". §2.2 moves the notice here; §6 names the key. */
    const reduced = $('reviewReduced');
    if (plan.fit.needsTiling) {
      reduced.textContent = msg('reviewReduced', null,
        'This capture is too tall to copy as one readable image, so the picture below is ' +
        'a shrunk overview of the whole page. Small text in it is not legible — here or ' +
        'on the clipboard.');
      reduced.hidden = false;
    } else { reduced.textContent = ''; reduced.hidden = true; }

    const listEl = $('reviewMarkList');
    listEl.innerHTML = '';
    $('reviewMarkCount').textContent = marks.length
      ? msg('reviewMarks', [fsNumber(marks.length)],
          '$COUNT$ blocks are outlined on the image below.')
      : msg('reviewNoMarks', null, 'No blocks are outlined on the image below.');

    const img = $('reviewImg');
    const layer = $('reviewMarkLayer');
    const wrap = $('reviewImgWrap');
    if (reviewState && reviewState.url) URL.revokeObjectURL(reviewState.url);
    const url = URL.createObjectURL(blob);
    img.src = url;
    img.alt = msg('reviewImgAlt', null, 'The image that is about to be copied');
    /* WHICH IMAGE, HOW BIG, AND WHAT THE KEYBOARD DOES HERE — on the scroll
       region, because that is what a keyboard or screen-reader user actually
       lands on. Not what is IN it: this program cannot read the picture, and a
       name that described its contents would be the verdict again, written in
       the one place only a blind reader would meet it.
       Finished here rather than by the load pass because it spends another
       value as a substitution — the same reason the paper-size options and the
       drag-and-drop tip are finished in script (see pages/result.html). */
    if (typeof wrap.setAttribute === 'function') {
      wrap.setAttribute('aria-label', msg('reviewImgRegion', [fsDims(plan.fit.w, plan.fit.h)],
        'The image that is about to be copied, $DIMS$ pixels — scroll it with the arrow keys'));
    }

    /* ---- HOW BIG TO SHOW IT --------------------------------------------
       THE DEFECT THIS REPLACES. The dialog fitted the export to the panel and
       could magnify nothing: the widest it would ever paint was 1:1 with the
       exported pixels. But the export is ITSELF a downscale — a 3,700 px
       capture leaves with its long edge fitted to 1,568, which puts every
       glyph in it under half the size it was captured at, and past the tiling
       floor it is a fifth. Fitted into a dialog on top of that, the person
       asked to confirm "I have looked" was looking at a grey smear. A review
       step that physically cannot show the thing being reviewed is theatre,
       and theatre is worse than nothing, because it moves the responsibility
       onto the person without giving them the means.

       `readK` UNDOES EXACTLY THAT DOWNSCALE and stops. One exported pixel
       drawn at srcW/fit.w CSS pixels puts the page back at the size it was
       captured at, and no larger. It is not a sharpening and it must never be
       mistaken for one: the detail the downscale destroyed is gone, and
       SEEING that it is gone is the useful part — if a word cannot be resolved
       here it cannot be resolved by whatever receives the image either.

       Four stops, ascending, deduplicated: fit, 1:1 with the export, readable,
       and twice readable for a person who needs it bigger than the page was.
       Stop 0 is always "fit", so `Zoom out` always leads back to the whole
       picture without a fifth control to explain. */
    const readK = Math.min(REVIEW_MAX_K,
      Math.max(1, plan.srcW / Math.max(1, plan.fit.w)));
    const fitK = () => Math.min(1, (wrap.clientWidth || plan.fit.w) / Math.max(1, plan.fit.w));
    const ladder = () => {
      const out = [];
      for (const v of [fitK(), 1, readK, Math.min(REVIEW_MAX_K, readK * 2)]) {
        if (!out.length || v > out[out.length - 1] * 1.02) out.push(v);
      }
      return out;
    };
    let zi = 0;
    const curK = () => { const L = ladder(); return L[Math.min(zi, L.length - 1)]; };
    const readStop = () => {
      const L = ladder();
      for (let i = 0; i < L.length; i++) if (L[i] >= readK - 1e-6) return i;
      return L.length - 1;
    };

    /* The marks are laid out in EXPORTED pixels and the layer is scaled with
       the image, so one geometry serves every zoom. */
    const layout = () => {
      const k = curK();
      const shown = Math.max(1, Math.round(plan.fit.w * k));
      img.style.width = shown + 'px';
      img.style.height = 'auto';
      layer.style.width = shown + 'px';
      layer.style.height = Math.round(plan.fit.h * k) + 'px';
      const kids = layer.children;
      for (let i = 0; i < kids.length; i++) {
        const m = marks[i];
        kids[i].style.left = Math.round(m.x * k) - 2 + 'px';
        kids[i].style.top = Math.round(m.y * k) - 2 + 'px';
        kids[i].style.width = Math.round(m.w * k) + 4 + 'px';
        kids[i].style.height = Math.round(m.h * k) + 4 + 'px';
      }
      $('reviewScale').textContent = msg('reviewScale', [fsNumber(Math.round(k * 100))],
        'Shown at $PERCENT$% of the size that will be copied.');
      showPos();
    };

    /* ---- WHERE IN THE PICTURE THE PERSON IS ----------------------------
       The image at the current zoom, divided into viewport-sized steps in
       reading order. This is the unit `Next` moves by and the unit the readout
       counts in, and both of them are derived from the SCROLL POSITION rather
       than from a click counter — so a wheel, a trackpad, a scrollbar drag and
       PageDown inside the region all move the readout too. The buttons are one
       way to look, never the only one. */
    const geom = () => {
      const k = curK();
      const vw = Math.max(1, wrap.clientWidth || 1), vh = Math.max(1, wrap.clientHeight || 1);
      const iw = plan.fit.w * k, ih = plan.fit.h * k;
      const stepX = Math.max(1, Math.round(vw * REVIEW_STEP));
      const stepY = Math.max(1, Math.round(vh * REVIEW_STEP));
      const maxX = Math.max(0, Math.round(iw - vw)), maxY = Math.max(0, Math.round(ih - vh));
      const cols = Math.max(1, Math.ceil(maxX / stepX) + 1);
      const rows = Math.max(1, Math.ceil(maxY / stepY) + 1);
      return { cols, rows, stepX, stepY, maxX, maxY, total: cols * rows };
    };
    /* THE LAST STEP IS SHORT, and both directions have to agree about that. The
       final row's target overshoots the scrollable range, the browser clamps it,
       and a position read back as `round(scrollTop / step)` then names the row
       BEFORE the last — so `Next` stays enabled at the foot of the image and
       moving does nothing, for ever. The stop positions are therefore clamped
       here, once, and the index is read against the same clamp. */
    const stopAt = (n, g) => ({
      x: Math.min((n % g.cols) * g.stepX, g.maxX),
      y: Math.min(Math.floor(n / g.cols) * g.stepY, g.maxY)
    });
    const viewAt = () => {
      const g = geom();
      const sx = wrap.scrollLeft || 0, sy = wrap.scrollTop || 0;
      const col = sx >= g.maxX - 1 ? g.cols - 1
        : Math.max(0, Math.min(g.cols - 1, Math.floor((sx + 1) / g.stepX)));
      const row = sy >= g.maxY - 1 ? g.rows - 1
        : Math.max(0, Math.min(g.rows - 1, Math.floor((sy + 1) / g.stepY)));
      return row * g.cols + col;
    };
    const goView = i => {
      const g = geom();
      const at = stopAt(Math.max(0, Math.min(g.total - 1, i)), g);
      wrap.scrollTop = at.y;
      wrap.scrollLeft = at.x;
      showPos();
    };

    let posShown = '';
    const showPos = () => {
      const g = geom();
      const i = Math.max(0, Math.min(g.total - 1, viewAt()));
      const text = msg('reviewViewPos', [fsNumber(i + 1), fsNumber(g.total)],
        'View $INDEX$ of $TOTAL$');
      const el = $('reviewPos');
      /* Written only when it CHANGES. This is a polite live region, and
         rewriting the same sentence on every scroll event is a screen reader
         saying "View 3 of 14" fourteen times while somebody drags a
         scrollbar. */
      if (el && text !== posShown) { posShown = text; el.textContent = text; }
      const L = ladder();
      $('reviewPrev').disabled = i <= 0;
      /* NEVER GATED ON MARKS, and that is the whole point of the rewrite. The
         controls used to be switched off when `marks.length` was 0 — i.e.
         exactly on the image where FullShot covered nothing and therefore
         exactly where every pixel has to be judged by eye. There is more to
         see while there is more picture below or more magnification left. */
      $('reviewNext').disabled = !(i < g.total - 1 || zi < readStop());
      $('reviewZoomOut').disabled = zi <= 0;
      $('reviewZoomIn').disabled = zi >= L.length - 1;
    };

    const setZoom = next => {
      const L = ladder();
      const n = Math.max(0, Math.min(L.length - 1, next));
      const k0 = curK();
      const vw = wrap.clientWidth || 0, vh = wrap.clientHeight || 0;
      /* Keep the middle of the viewport where it was, in the exported image's
         own coordinates. A zoom that jumps back to the top loses the place the
         person had just found, which is the one thing a review must not do. */
      const cx = ((wrap.scrollLeft || 0) + vw / 2) / Math.max(1e-6, k0);
      const cy = ((wrap.scrollTop || 0) + vh / 2) / Math.max(1e-6, k0);
      zi = n;
      layout();
      const k1 = curK();
      wrap.scrollLeft = Math.max(0, Math.round(cx * k1 - vw / 2));
      wrap.scrollTop = Math.max(0, Math.round(cy * k1 - vh / 2));
      showPos();
    };

    /* OUTLINE AND BADGE, NEVER A FILL: the mark must not cover any pixel of the
       thing being judged. Numbered and listed rather than distinguished by
       colour alone — test/a11y-sim asserts it. */
    layer.innerHTML = '';
    marks.forEach((m, i) => {
      const box = document.createElement('div');
      box.className = 'review-mark';
      const badge = document.createElement('span');
      badge.className = 'review-badge';
      badge.textContent = fsNumber(i + 1);
      box.appendChild(badge);
      layer.appendChild(box);
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'btn review-jump';
      jump.textContent = msg('reviewMarkLabel', [fsNumber(i + 1)], 'Block $INDEX$');
      /* WHERE IT IS, for a reader who cannot see where it is. "Block 3" tells
         a sighted person which outline lit up and tells everybody else
         nothing. The position is arithmetic on the mark's own geometry —
         nothing new is stored and nothing is disclosed that the outline beside
         it does not already show. */
      const down = Math.round((m.y + m.h / 2) / Math.max(1, plan.fit.h) * 100);
      jump.setAttribute('aria-label', msg('reviewMarkAt', [fsNumber(i + 1), fsNumber(down)],
        'Block $INDEX$, $PERCENT$% down the image'));
      jump.addEventListener('click', () => goTo(i));
      listEl.appendChild(jump);
    });

    /* NO FORCED SCROLL. On a 12 000 px page a mandatory scroll-to-bottom
       becomes a chore, the chore becomes a scrollbar drag, and the drag proves
       nothing. Looking is made CHEAP instead: one press of Next magnifies to a
       readable size, and every press after it moves one viewport down the
       picture — what a careful person would do by hand.

       AND IT STEPS THROUGH THE PICTURE, NOT BETWEEN THE MARKS. Prev/next used
       to jump mark to mark, which is a tour of the regions FullShot ALREADY
       COVERED — the one part of the image that needs no looking at. What a
       review is for is what was missed, and what was missed has no mark on it.
       The marks stay, as landmarks, in the numbered list beside the image. */
    let at = -1;
    const goTo = i => {
      if (!marks.length) return;
      at = ((i % marks.length) + marks.length) % marks.length;
      if (zi < readStop()) { zi = readStop(); layout(); }
      const k = curK();
      wrap.scrollTop = Math.max(0, Math.round(marks[at].y * k) - 80);
      wrap.scrollLeft = Math.max(0, Math.round(marks[at].x * k) - 80);
      showPos();
    };

    let done = null;
    let posTimer = null;
    const settle = ok => {
      if (!done) return;
      const fn = done; done = null;
      dlg.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      if (posTimer) { clearTimeout(posTimer); posTimer = null; }
      URL.revokeObjectURL(url);
      reviewState = null;
      if (returnTo && typeof returnTo.focus === 'function') returnTo.focus();
      fn(ok);
    };
    /* Focus trap, Esc cancels, and INITIAL FOCUS IS NOT ON THE PRIMARY BUTTON:
       a dialog that opens with the confirm key already armed is a dialog
       dismissed by an Enter the user had already pressed.

       THE HOLE THIS CLOSES, and it was a data-loss bug rather than a polish
       one. The trap used to ask only "are you standing on the first control,
       or on the last one?" — and the dialog deliberately opens on its HEADING,
       which carries tabindex="-1" and is therefore neither. So Shift+Tab from
       the very place the dialog put the keyboard was not trapped at all: it
       stepped out of the modal into the page behind it, four presses later it
       was on the Delete button, and Enter fired it. Forward Tab had the same
       hole from anywhere outside the ring.

       The question is RING MEMBERSHIP, because membership is the only test
       that has an answer for focus that is outside the ring altogether — which
       is also where focus is after a click on the backdrop. Outside, the next
       Tab pulls it back in; the direction decides which end it lands on.

       One mechanism, deliberately. Marking the page behind `inert` as well
       would be a second belt — and then test/e2e/review-keyboard.mjs would be
       green whether or not this trap works, which is the same as not testing
       it. */
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); return; }
      if (e.key !== 'Tab') return;
      const ring = [].slice.call(dlg.querySelectorAll('button:not([disabled]), [tabindex="0"]'));
      if (!ring.length) return;
      const first = ring[0], last = ring[ring.length - 1];
      const here = ring.indexOf(document.activeElement);
      if (here < 0) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && here === 0) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && here === ring.length - 1) { e.preventDefault(); first.focus(); }
    };
    const returnTo = document.activeElement;

    const onPrev = () => goView(viewAt() - 1);
    /* Two things in one press, and that IS the ergonomic argument: from the
       fitted overview the first press magnifies to a size where words resolve,
       and every press after it moves down the picture. */
    const onNext = () => {
      if (zi < readStop()) {
        setZoom(readStop());
        /* To the START of the row, not to the nearest view. The zoom keeps the
           middle of the viewport where it was, which at the top of a fitted
           overview leaves the picture scrolled half a screen to the right — so
           the first thing a person saw after asking to read was a left margin
           cut off. Reading starts at the margin. */
        const g = geom();
        goView(Math.floor(viewAt() / g.cols) * g.cols);
        return;
      }
      goView(viewAt() + 1);
    };
    const onIn = () => setZoom(zi + 1);
    const onOut = () => setZoom(zi - 1);
    const onScroll = () => {
      if (posTimer) clearTimeout(posTimer);
      posTimer = setTimeout(() => { posTimer = null; showPos(); }, 140);
    };
    const onOk = () => settle(true);
    const onNo = () => settle(false);
    bindOnce($('reviewPrev'), onPrev);
    bindOnce($('reviewNext'), onNext);
    bindOnce($('reviewZoomIn'), onIn);
    bindOnce($('reviewZoomOut'), onOut);
    bindOnce($('reviewConfirm'), onOk);
    bindOnce($('reviewCancel'), onNo);
    bindOnce(wrap, onScroll, 'scroll');

    dlg.hidden = false;
    reviewState = { url };
    /* The dialog element outlives one showing; its scroll position would
       otherwise be wherever the LAST review was left, on a different image. */
    wrap.scrollTop = 0;
    wrap.scrollLeft = 0;
    layout();
    document.addEventListener('keydown', onKey, true);
    const head = $('reviewHead');
    if (head && typeof head.focus === 'function') head.focus();

    return new Promise(res => { done = res; });
  }

  /* One listener per control per page load. The dialog is rebuilt on every
     open and a fresh addEventListener each time would stack handlers, which is
     how a Cancel starts resolving three promises. The event NAME is stored
     beside the handler because the scroll region is bound here too, and
     removing a 'scroll' listener as though it were a 'click' removes nothing
     at all. */
  const bound = new WeakMap();
  function bindOnce(el, fn, type) {
    if (!el || typeof el.addEventListener !== 'function') return;
    const t = type || 'click';
    const prev = bound.get(el);
    if (prev) el.removeEventListener(prev.type, prev.fn);
    bound.set(el, { type: t, fn: fn });
    el.addEventListener(t, fn);
  }

  /* ONE copy path and ONE failure sink, for the toolbar button and for every
     per-part button. `segIndex === null` is the whole capture — which is what
     the toolbar copies: a part is a CANVAS-limit artifact, not something a
     reader asked for, and pasting the top fifth of a page into a model and
     asking it about the page is the defect this whole item exists to remove. */
  async function copyHandoff(segIndex) {
    try {
      if (!aiReady()) {
        /* No common.js: the node tier that boots this file alone to grade the
           stitching math. Behave exactly as this page did before the envelope. */
        await fsCopyBlobToClipboard(shot.segments[segIndex || 0].blob, settings.clipboardFit);
      } else {
        const r = currentRedaction();
        let blob = null;
        /* §3.1 — the gate. `requested === false` never fires it, which keeps the
           dialog away from every user who leaves the setting off; `null` DOES
           fire it, because "we cannot tell whether redaction ran" resolves
           toward showing the person the picture. That costs a dialog. The
           opposite default costs them their data. */
        if (r.requested !== false && !reviewedThisLoad.has(reviewKey(segIndex))) {
          const plan = exportFit(segIndex);
          blob = await composeScaled(plan.fromY, plan.toY, plan.fit.w, plan.fit.h);
          const ok = await showReview(r, plan, blob);
          if (!ok) return;                 // Cancel: the clipboard is untouched
          reviewedThisLoad.add(reviewKey(segIndex));
        }
        const h = await buildHandoff(segIndex, true, blob);
        await fsCopyBlobToClipboard(h.blob, settings.clipboardFit, h.text);
      }
      fsToast(segIndex == null
        ? msg('toastCopiedClipboard', null, 'Copied to clipboard')
        : msg('resultToastCopiedPart', [segIndex + 1], 'Copied part $INDEX$ to clipboard'));
    } catch (e) {
      fsToast(msg('toastCopyFailed', [fsHumanReason(e)], 'Copy failed — $REASON$'));
    }
  }

  function copyImage() { return copyHandoff(null); }

  /* ---------------- PDF export ---------------- */

  function dataUrlToBytes(dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function segmentBitmaps() {
    const bmps = [];
    for (const s of shot.segments) bmps.push(await createImageBitmap(s.blob));
    return bmps;
  }

  /* Part-boundary pixel fallback (v1.5.0): prefer the bottom-most RUN of ≥3
     consecutive visually quiet rows — a real layout gap — and cut at its
     MIDDLE, so content gets breathing room on both sides of the boundary.
     A lone quiet row is used only when no run exists (v1.4.0 behavior).
     Returns the new part height, or segH when nothing quiet is in window. */
  /* The block colour, named once. It is read back out of the canvas by
     verifyBlocks, so the two must be the same literal or the verification
     grades a colour nobody painted. */
  const FS_BLOCK_HEX = '#111111';
  const FS_BLOCK_RGB = [0x11, 0x11, 0x11];
  const FS_VERIFY_MAX_PX = 4 * 1e6;   // per-segment read-back budget

  /* ---- §2.5: grade the artifact, not the log -------------------------------
     After the boxes are painted into a segment and after the segment is
     cropped, read each painted rect back out of the canvas and confirm it is
     uniformly the block colour.

     This is the same doctrine as the envelope's FS_ENVELOPE_UNREDACTED gate,
     which re-reads the strings it is about to hand over rather than trusting
     the call sites: A MISSING CALL SITE CANNOT TALK ITS WAY PAST A RE-READ.
     The redaction bake has never had that gate — every previous version of this
     claim graded the intention.

     BATCHED, because getImageData is a GPU read-back with a per-call stall and
     two thousand of them is seconds: one ImageData per BAND of boxes, capped by
     area. If the cap forces a box to go unread that box is NOT counted
     verified — it is counted `verifySkipped`, which breaks bakeOk. Refuse, do
     not degrade: a sampling shortcut that quietly counts as verification is the
     next proxy, and it would arrive wearing the word "verified".

     The interior is sampled rather than the padded edge, because the box is
     drawn with a 2px bleed and the outermost row can be antialiased against
     what was underneath. What is being asserted is "the glyphs are gone", and
     the glyphs were inside. */
  function verifyBlocks(canvas, segH, segTop, painted, seen, bake) {
    let ctx;
    try { ctx = canvas.getContext('2d', { willReadFrequently: true }); } catch (_) { ctx = null; }
    if (!ctx || typeof ctx.getImageData !== 'function') {
      for (const p of painted) {
        if (seen[p.i].verified || seen[p.i].failed || seen[p.i].skipped) continue;
        seen[p.i].skipped = true; bake.verifySkipped++;
      }
      return;
    }
    /* "This segment did not read that block." Declared before the loop that
       needs it, and it is a PER-SEGMENT statement: a later segment that manages
       the read clears it (see mark() below), so what survives to the seal is
       the set of blocks no segment ever read. */
    const skip = i => { const s = seen[i]; if (!s.skipped) { s.skipped = true; bake.verifySkipped++; } };
    /* The boxes this segment can still say something about, clipped to it and
       shrunk by the 2px bleed. Anything that fell entirely into the discarded
       tail is PENDING — neither verified nor failed here.
       PENDING IS STILL UNREAD, AND IT IS BOOKED AS UNREAD. This `continue` used
       to be the one silent give-up left in the read-back: a block clipped to
       nothing in this segment simply vanished from the batch, and if no later
       segment ever managed the read it ended up neither verified nor skipped —
       uncounted by every counter that exists to say what was not looked at.
       Booking it here is safe precisely because the flag is per-segment: the
       common case (a block in the cropped tail, read in the next segment)
       clears itself. */
    const todo = [];
    for (const p of painted) {
      const s = seen[p.i];
      if (s.verified || s.failed) continue;
      const x0 = Math.max(0, Math.floor(p.dx + 1));
      const y0 = Math.max(0, Math.floor(p.dy + 1));
      const x1 = Math.min(canvas.width, Math.ceil(p.dx + p.dw - 1));
      const y1 = Math.min(segH, Math.ceil(p.dy + p.dh - 1));
      if (x1 - x0 <= 0 || y1 - y0 <= 0) { skip(p.i); continue; }
      todo.push({ i: p.i, x0, y0, x1, y1, p });
    }
    if (!todo.length) return;
    todo.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

    /* THE ONE PLACE GEOMETRY IS ALLOWED TO TRAVEL (REDACTION-CLAIM-SPEC.md
       §3.3), and the reason it is allowed here and nowhere else is narrow: a
       rect CONFIRMED OPAQUE in the delivered image describes THE PICTURE — a
       region that is already a solid block in the file the user is holding.
       A rect that was not confirmed describes THE PAGE, and it is a map to
       something that may still be visible. So the mark is written inside the
       success arm of the read-back, in the same expression that decides it,
       and the failure arm writes nothing. Full-image coordinates: `dy` is
       relative to this segment's top, and `segTop` is that top in the stacked
       image. */
    const mark = (i, ok, p) => {
      const s = seen[i];
      if (s.skipped) { s.skipped = false; bake.verifySkipped--; }   // a later segment read what an earlier one could not
      if (ok) {
        s.verified = true; bake.blocksVerified++;
        /* CLIPPED TO THE IMAGE, NOT MOVED INTO IT. The painted rect carries a
           2 px bleed, so a block at the very top or left starts at a negative
           coordinate; clamping x and y while keeping w and h would slide the
           mark two pixels past the block and put its far edge over content the
           block never covered. A mark that points slightly beside the thing it
           describes is the stale-coordinate failure §3.3 names, in miniature. */
        const mx = Math.max(0, Math.round(p.dx));
        const my = Math.max(0, Math.round(p.dy + segTop));
        s.mark = { x: mx, y: my,
                   w: Math.max(1, Math.round(p.dx + p.dw) - mx),
                   h: Math.max(1, Math.round(p.dy + segTop + p.dh) - my) };
      } else { s.failed = true; bake.verifyFailed++; }
    };

    /* ONE ImageData PER BAND, not one per box. Each call is a GPU read-back
       with its own stall, so two thousand of them is seconds of stall for a
       total pixel count equal to the redacted area, which is small. Boxes are
       accumulated into a band until the band's bounding box would exceed the
       area cap, then the band is read once and every member is graded inside
       the buffer. A box that cannot fit a band on its own is REFUSED, not
       sampled: verifySkipped breaks bakeOk, and a sampling shortcut that
       quietly counted as verification would be the next proxy — wearing the
       word "verified", which is the worst place for one to hide. */
    let band = null;
    const flush = () => {
      if (!band) return;
      const w = band.x1 - band.x0, h = band.y1 - band.y0;
      let img = null;
      try { img = ctx.getImageData(band.x0, band.y0, w, h); } catch (_) { img = null; }
      if (!img) { for (const b of band.rows) skip(b.i); band = null; return; }
      const data = img.data;
      for (const b of band.rows) {
        let ok = true;
        for (let y = b.y0; y < b.y1 && ok; y++) {
          let o = ((y - band.y0) * w + (b.x0 - band.x0)) * 4;
          for (let x = b.x0; x < b.x1; x++, o += 4) {
            if (data[o] !== FS_BLOCK_RGB[0] || data[o + 1] !== FS_BLOCK_RGB[1] ||
                data[o + 2] !== FS_BLOCK_RGB[2] || data[o + 3] !== 255) { ok = false; break; }
          }
        }
        mark(b.i, ok, b.p);
      }
      band = null;
    };
    for (const b of todo) {
      if ((b.x1 - b.x0) * (b.y1 - b.y0) > FS_VERIFY_MAX_PX) { skip(b.i); continue; }
      const nx0 = band ? Math.min(band.x0, b.x0) : b.x0;
      const ny0 = band ? Math.min(band.y0, b.y0) : b.y0;
      const nx1 = band ? Math.max(band.x1, b.x1) : b.x1;
      const ny1 = band ? Math.max(band.y1, b.y1) : b.y1;
      if (band && (nx1 - nx0) * (ny1 - ny0) > FS_VERIFY_MAX_PX) flush();
      if (!band) band = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, rows: [] };
      else { band.x0 = nx0; band.y0 = ny0; band.x1 = nx1; band.y1 = ny1; }
      band.rows.push(b);
    }
    flush();
  }

  function findQuietRowInCanvas(canvas, segH) {
    const win = Math.min(900, Math.max(40, Math.floor(segH * 0.25)));
    const from = segH - win;
    const stripW = Math.min(400, canvas.width);
    const c = document.createElement('canvas');
    c.width = stripW; c.height = win;
    const sctx = c.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(canvas, 0, from, canvas.width, win, 0, 0, stripW, win);
    const data = sctx.getImageData(0, 0, stripW, win).data;
    c.width = c.height = 0;
    const rowQuiet = r => {
      const base = r * stripW * 4;
      const r0 = data[base], g0 = data[base + 1], b0 = data[base + 2];
      for (let x = 1; x < stripW; x++) {
        const i = base + x * 4;
        if (Math.abs(data[i] - r0) > 10 || Math.abs(data[i + 1] - g0) > 10 ||
            Math.abs(data[i + 2] - b0) > 10) return false;
      }
      return true;
    };
    let end = -1, firstQuiet = -1;
    for (let r = win - 1; r >= 0; r--) {
      if (rowQuiet(r)) {
        if (firstQuiet < 0) firstQuiet = r;
        if (end < 0) end = r;
        if (r === 0 && end + 1 >= 3) return from + (end >> 1) + 1;
      } else {
        if (end >= 0 && end - r >= 3) return from + ((r + 1 + end) >> 1) + 1;
        end = -1;
      }
    }
    if (firstQuiet >= 0) return from + firstQuiet + 1; // lone quiet row
    return segH;
  }

  /* Smart page splitting: instead of cutting the image at an arbitrary row
     (often straight through a line of text), look upward from the target
     break for the nearest visually quiet row — a row of near-uniform color,
     i.e. the gap between paragraphs/blocks — and cut there. */
  function findSmartBreak(bmps, segTops, yStart, targetEnd) {
    const win = Math.min(600, Math.max(40, Math.floor((targetEnd - yStart) * 0.25)));
    const from = targetEnd - win;
    const stripW = Math.min(400, shot.w);
    const c = document.createElement('canvas');
    c.width = stripW; c.height = win;
    const sctx = c.getContext('2d', { willReadFrequently: true });
    sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, stripW, win);
    for (let si = 0; si < bmps.length; si++) {
      const top = segTops[si], h = shot.segments[si].h;
      if (top + h <= from || top >= targetEnd) continue;
      const sy = Math.max(0, from - top);
      const sh = Math.min(h, targetEnd - top) - sy;
      if (sh <= 0) continue;
      sctx.drawImage(bmps[si], 0, sy, bmps[si].width, sh, 0, top + sy - from, stripW, sh);
    }
    const data = sctx.getImageData(0, 0, stripW, win).data;
    c.width = c.height = 0;
    for (let r = win - 1; r >= 0; r--) {
      const base = r * stripW * 4;
      const r0 = data[base], g0 = data[base + 1], b0 = data[base + 2];
      let quiet = true;
      for (let x = 1; x < stripW; x++) {
        const i = base + x * 4;
        if (Math.abs(data[i] - r0) > 10 || Math.abs(data[i + 1] - g0) > 10 ||
            Math.abs(data[i + 2] - b0) > 10) { quiet = false; break; }
      }
      if (quiet) return from + r + 1; // cut just below the quiet row
    }
    return targetEnd; // no quiet row found — cut at the normal place
  }

  async function downloadPdf() {
    $('pdfBtn').disabled = true;
    fsToast(msg('resultToastBuildingPdf', null, 'Building PDF…'));
    try {
      const paper = $('paperSel').value;
      const stampText = settings.pdfStamp
        ? (shot.url || '') + '  —  ' + new Date(shot.createdAt).toLocaleString()
        : null;
      const pages = [];

      if (paper === 'auto') {
        // One page per segment, sized to the image.
        for (const seg of shot.segments) {
          const bmp = await createImageBitmap(seg.blob);
          const c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          const jpeg = dataUrlToBytes(c.toDataURL('image/jpeg', 0.9));
          let wPt = seg.w * 0.75, hPt = seg.h * 0.75;   // 96px/in -> 72pt/in
          const fit = Math.min(1, 14400 / wPt, 14400 / hPt); // PDF max page = 14400pt
          wPt *= fit; hPt *= fit;
          pages.push({ jpeg, imgW: seg.w, imgH: seg.h, pageW: wPt, pageH: hPt, x: 0, y: 0, w: wPt, h: hPt, stamp: null });
          c.width = c.height = 0;
        }
      } else {
        // Fixed paper: flow the tall image across pages.
        let [pw, ph] = FSPDF.PAPERS[paper];
        if (settings.pdfOrientation === 'landscape') [pw, ph] = [ph, pw];
        const margin = 28;
        const footer = stampText ? 14 : 0;
        const contentW = pw - margin * 2;
        const contentH = ph - margin * 2 - footer;
        const pxPerPt = shot.w / contentW;
        const pageHpx = Math.floor(contentH * pxPerPt);

        const bmps = await segmentBitmaps();
        const segTops = [];
        let acc = 0;
        for (const s of shot.segments) { segTops.push(acc); acc += s.h; }
        const totalH = acc;

        let y = 0;
        while (y < totalH) {
          let end = Math.min(y + pageHpx, totalH);
          if (settings.pdfSmartSplit && end < totalH) {
            // Section tops first (v1.5.0) — the next post/section starts the
            // next page; pixel-quiet scanning only as fallback.
            let hint = 0;
            if (shot.breakYs) {
              const lo = y + Math.floor((end - y) * 0.45);
              for (const by of shot.breakYs) {
                if (by > lo && by <= end && by > hint) hint = by;
              }
            }
            end = hint || findSmartBreak(bmps, segTops, y, end);
          }
          const sliceH = end - y;
          const c = document.createElement('canvas');
          c.width = shot.w; c.height = sliceH;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          // Copy from every segment overlapping this slice.
          for (let si = 0; si < bmps.length; si++) {
            const top = segTops[si], h = shot.segments[si].h;
            if (top + h <= y || top >= y + sliceH) continue;
            ctx.drawImage(bmps[si], 0, top - y);
          }
          const jpeg = dataUrlToBytes(c.toDataURL('image/jpeg', 0.9));
          const drawH = sliceH / pxPerPt;
          pages.push({
            jpeg, imgW: c.width, imgH: sliceH,
            pageW: pw, pageH: ph,
            x: margin, y: ph - margin - drawH, w: contentW, h: drawH,
            stamp: stampText
          });
          c.width = c.height = 0;
          y = end;
        }
        bmps.forEach(b => b.close());
      }

      /* NOT localised, deliberately: this is the PDF's own /Title metadata,
         written into a file the user keeps. It is the captured page's title,
         and 'Screenshot' is the stand-in when that page had none — a document
         property, sibling to the /Producer string and the stamp, not a label on
         a screen. historyUntitled is documented as display-only. */
      const blob = FSPDF.build(pages, { title: shot.title || 'Screenshot' });
      await fsDownloadBlob(blob, baseFilename() + '.pdf');
      fsToast(plural('resultToastPdfDone', pages.length, null, 'PDF downloaded ($COUNT$ pages)'));
    } catch (e) {
      // Wraps fsDownloadBlob: the one call here that hands the browser a name
      // built from the captured page and a path the user's profile syncs.
      fsToast(msg('resultToastPdfFailed', [fsHumanReason(e)], 'PDF failed — $REASON$'));
    } finally {
      $('pdfBtn').disabled = false;
    }
  }
})();
