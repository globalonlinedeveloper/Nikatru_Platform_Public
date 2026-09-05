/* Runs the REAL pages/result.js stitching code in a node vm against
   simulated frames, and returns the stitched segments as raw RGBA buffers.
   Everything result.js touches at init/render time is shimmed; the math
   under test (fsGaplessMap, canvas sizing, pane cropping, segment split)
   is the genuine shipped code. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FakeCanvas } = require('./canvas2d');

const ROOT = process.env.FS_ROOT || path.join(__dirname, '..', '..');
const RESULT_SRC = fs.readFileSync(path.join(ROOT, 'pages', 'result.js'), 'utf8');
/* The REAL reducer. result.js's init() catch calls it, so if stitching ever
   throws in here the failure text is the shipped one — a stub would make the
   harness disagree with the browser about what a user sees. */
const COMMON = require(path.join(ROOT, 'pages', 'common.js'));

/* cap: { id, mode:'full', meta, settings }; frames: [{index,x,y,img}] where
   img = { width, height, data }.  Returns { record, toasts, lines, segments } —
   segments as [{ w, h, data }].

   `toasts` is every string result.js put on screen during the run. It exists
   because one thing this page says is not about pixels at all: when redaction
   was on and the page had no text layer to scan, the user is TOLD so before
   they hand the image to anyone. A stub that swallowed that would let the
   sentence be deleted with every pixel check still green.

   `lines` is the PERMANENT half of the same sentence (REDACTION-CLAIM-SPEC.md
   §3.9.2). A toast is for a decision about to be made and it is gone in twelve
   seconds; the line under the meta is for the person who comes back to the
   record tomorrow, and for a screen reader that was not listening at the moment
   it fired. Collected separately from `toasts` precisely so a check can insist
   on both, and so "we told them" cannot be satisfied by the transient one. */
/* `opts.shots` PRE-SEEDS THE SHOTS STORE, which is how a fixture grades what
   the page SAYS about a record it did not stitch. result.js's init asks
   `FSDB.get('shots', id)` first — "already stitched earlier (page reload)?" —
   so a record sitting there is rendered verbatim and no stitch runs.

   That is the only way to grade the acts line over a record whose counters are
   internally IMPOSSIBLE (verifiedOpaque above matched), and such records are a
   real population, not a hypothetical: pages/db.js's §4 lift reads a v2
   ledger's BLOCK counts into the match-unit counters, forever, because those
   records predate any per-match identity. The renderer has to survive them
   without printing a shortfall of zero. */
async function stitchWithRealResultJs(cap, frames, opts) {
  const o = opts || {};
  const toasts = [];
  const store = {
    captures: new Map([[cap.id, cap]]),
    shots: new Map((o.shots || []).map(r => [r.id, r])),
    frames: frames.map(f => ({ captureId: cap.id, index: f.index, x: f.x, y: f.y,
                               pane: f.pane == null ? null : f.pane,
                               inline: f.inline == null ? null : f.inline, dataUrl: f.img }))
  };

  const elStubs = new Map();
  function elStub(id) {
    if (!elStubs.has(id)) {
      /* setAttribute/removeAttribute are here because their ABSENCE was a
         silent hole: result.js set a textContent, then threw a TypeError on
         the next line, and init()'s catch swallowed it — so a check that read
         the textContent passed while the toast after it never fired. A stub
         that is missing a method the page uses does not fail the tier, it
         truncates the page. */
      const attrs = new Map();
      elStubs.set(id, {
        id, addEventListener() {}, appendChild() {}, append() {},
        textContent: '', innerHTML: '', hidden: false, value: 'auto',
        disabled: false, className: '', style: {}, dataset: {}, src: '', alt: '',
        setAttribute(n, v) { attrs.set(String(n), String(v)); },
        getAttribute(n) { return attrs.has(String(n)) ? attrs.get(String(n)) : null; },
        removeAttribute(n) { attrs.delete(String(n)); },
        setAttributeNS() {}, focus() {}, remove() {},
        /* A multi-part render sets `head.firstChild.textContent`. Without a
           firstChild that throws, init()'s catch swallows it, and every check
           that reads anything rendered AFTER the segment list silently passes
           by never running — which is how the redaction line looked fine on
           one-part captures and was simply absent on two-part ones. */
        firstChild: { textContent: '' }, lastChild: { textContent: '' },
        querySelector() { return null; }, querySelectorAll() { return []; }
      });
    }
    return elStubs.get(id);
  }

  let domReady = null;
  const documentStub = {
    title: '',
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') domReady = fn; },
    getElementById: elStub,
    createElement(tag) { return tag === 'canvas' ? new FakeCanvas() : elStub('el-' + Math.random()); }
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout,
    document: documentStub,
    location: { search: '?id=' + cap.id, href: '' },
    URLSearchParams,
    URL: { createObjectURL: () => 'blob:sim' },
    confirm: () => false,
    chrome: { runtime: { openOptionsPage() {} } },
    FSDB: {
      async get(storeName, key) { return store[storeName].get(key); },
      async put(storeName, value) { store[storeName].set(value.id || value.k, value); },
      async delete() {}, async deleteFrames() {},
      async getFrames() { return store.frames.slice(); },
      frameKey: (c, i) => c + ':' + i
    },
    fsGetSettings: async () => Object.assign({
      imageFormat: 'png', jpegQuality: 0.92, pdfPaper: 'auto', pdfOrientation: 'portrait',
      pdfStamp: false, pdfSmartSplit: true, filenameTemplate: 'shot', clipboardFit: true,
      autoDownload: false, autoOpenEditor: false, theme: 'light'
    }, cap.settings || {}),
    fsToggleTheme() {}, fsToast(text) { toasts.push(String(text == null ? '' : text)); },
    fsHumanReason: COMMON.fsHumanReason,
    /* THE REAL ONE, not a stub. fsRedactActs is the single place either ledger
       is turned into the three counts, and a stub of it would let this tier
       grade the stub while the shipped page said something else. Same reasoning
       as the real reducer above. */
    fsRedactActs: COMMON.fsRedactActs,
    /* THE REAL ONE, for the same reason and one more: this is the single
       predicate behind BOTH the shortfall sentence and the emphasis on it, and
       a stub here would let the tier grade a page that renders whatever the
       stub decided. Absent, result.js degrades to the flat line — which is the
       honest degradation, and precisely why it must not be the one graded. */
    fsRedactShortfall: COMMON.fsRedactShortfall,
    fsMessage: COMMON.fsMessage,
    fsPluralMessage: COMMON.fsPluralMessage,
    fsNumber: COMMON.fsNumber,
    fsMime: f => f === 'jpeg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : 'image/png',
    fsExt: f => f === 'jpeg' ? '.jpg' : f === 'webp' ? '.webp' : '.png',
    fsFormatBytes: n => n + ' B',
    fsBuildFilename: () => 'shot',
    fsDownloadBlob: async () => {}, fsCopyBlobToClipboard: async () => {},
    fsLoadImage: async img => img,                       // frames carry the buffer
    fsCanvasToBlob: async (canvas) => ({
      __w: canvas.width, __h: canvas.height,
      __data: canvas._data.slice(),
      size: canvas.width * canvas.height * 4
    }),
    createImageBitmap: async blob => ({
      width: blob.__w, height: blob.__h, data: blob.__data, close() {}
    }),
    FSPDF: { PAPERS: { a4: [595, 842], letter: [612, 792], legal: [612, 1008] }, build: () => ({ size: 0 }) }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(RESULT_SRC, sandbox, { filename: 'result.js' });
  if (!domReady) throw new Error('result.js never registered DOMContentLoaded');
  await domReady();

  // stitch() stores the finished record in the shots store
  /* init()'s catch is a SINK: it replaces the whole page with one sentence and
     returns normally. In a browser that is correct behaviour; here it means a
     TypeError halfway through render() looks exactly like a clean run whose
     later checks happen to pass vacuously. Surfaced as a hard failure, because
     a tier that cannot tell "rendered" from "stopped rendering" grades nothing
     downstream of wherever it stopped. */
  const sunk = elStubs.get('emptyText');
  if (sunk && sunk.textContent) throw new Error('result.js hit its failure sink: ' + sunk.textContent);

  const record = store.shots.get(cap.id);
  if (!record) throw new Error('stitch() produced no shot record');
  /* Read back off the element the page actually wrote to, by its id, rather
     than off a spy the page was handed: the check is "the sentence reached the
     DOM node a reader looks at", and a spy would answer for a call site instead. */
  const lines = [];
  for (const id of ['redactLine']) {
    const el = elStubs.get(id);
    if (el && el.textContent) lines.push(String(el.textContent));
  }
  return {
    record, toasts, lines,
    segments: record.segments.map(s => ({ w: s.blob.__w, h: s.blob.__h, data: s.blob.__data }))
  };
}

module.exports = { stitchWithRealResultJs };
