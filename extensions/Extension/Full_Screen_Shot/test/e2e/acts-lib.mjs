/* ============================================================================
   acts-lib.mjs — the CURRENT-SPEC grading kit shared by redaction-claim.mjs and
   adversarial-claim.mjs. A library, not a suite: the e2e workflow classifies any
   .mjs another file imports as a library and never runs it on its own.

   WRITTEN 2026-09-19 when both suites were rewritten against the reduced design
   in REDACTION-CLAIM-SPEC.md (O-FULLSHOT-CLAIM-SUITES-STALE). Their previous
   bodies graded the eight-state ladder that §2.2 deletes; they are in git
   history, and their fixtures are what survived.

   WHAT IT GRADES, and the section each part comes from:
     - the record's redaction block (§2.1 keys, §0.1 Rule 2, the §2.2 removal
       list at any depth, the match-unit chain matched >= painted >=
       verifiedOpaque, kinds as a bare histogram, §3.3's marks);
     - the DELIVERED image (§2.1 verifiedOpaque = "read back out of that image
       as uniformly the block colour"; §3.3 marks are "a region that is a solid
       block in the file the user already holds");
     - the text payload built by the shipped producer (§2.3's first line with
       the record's own counts and completeness, the constant limit sentence,
       §5's FS_ENVELOPE_VERDICT and §3.5's FS_ENVELOPE_UNREVIEWED);
     - the picture against the ledger, both directions: a marker colour that
       vanished is a block the ledger must account for, and a ledger that
       claims more covered matches than the picture shows covered tokens is a
       claim larger than the instrument (§0).

   It does NOT read extension source to decide what is correct. It reads
   `FSDB` and `fsAiBundle` to DRIVE the product, as reduction-corpus.mjs does.
   ========================================================================== */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OUT_DIR, setSettings, check, open, note } from './claim-lib.mjs';

/* ---- the spec, transcribed ---------------------------------------------- */
/* §2.1 — the acts block, in full, v4. */
export const ACTS_KEYS = ['v', 'matched', 'painted', 'verifiedOpaque', 'matchedComplete',
  'walkComplete', 'truncatedBy', 'textRefused', 'blocksLost',
  'blocksUnpainted', 'blocksUnread', 'ledger'];
export const TRUNCATED_BY = [null, 'elements', 'time', 'ceiling'];
export const LEDGER_VALUES = ['present', 'partial', 'absent'];
/* §2.1 envelope keys; the record adds §3.3's marks and a version. */
export const RECORD_REDACTION_KEYS = ['requested', 'detector', 'acts', 'kinds', 'text',
  'markers', 'surfaces', 'notCovered', 'v', 'marks'];
/* §5 names, and the rest of §2.2's removal table. */
export const VERDICT_NAMES = ['pixels', 'state', 'severity', 'evidence'];
export const REMOVED_NAMES = VERDICT_NAMES.concat(['chars', 'spans', 'placed',
  'unplacedSpans', 'unplacedChars', 'inkPx', 'capturedPx', 'declined', 'moved',
  'frames', 'scan', 'bake']);
/* §2.3 — the constant, verbatim ASCII (AI-HANDOFF-ENVELOPE.md §4). */
export const PAYLOAD_CONSTANT_A = 'FullShot reads the text a page exposes. It cannot see this image.';
export const PAYLOAD_CONSTANT_B = 'counts what FullShot did, not what is in the picture';
/* §2.3's first line. The completeness phrase sits INSIDE the clause. */
export const PAYLOAD_LINE = /^- Redaction: requested; (\d+) matched \((whole count|PARTIAL count|completeness unknown)\), (\d+) of them painted over, (\d+) read back opaque; walk (complete|incomplete)/;
/* §6 — forbidden in any redaction string. Graded on FullShot's own lines only. */
export const FORBIDDEN = /\b(safe|clean|secure|protected|done|nothing to hide)\b/i;

/* The block colour the bake paints. Used ONLY to count rows of block colour in
   an image, the fixtures' own rule being that no text colour sits within
   tolerance of it (test/e2e/README.md). The UNIFORMITY probe on marks does not
   assume it: it reads whatever colour is there and demands it be uniform. */
export const BLOCK = [17, 17, 17];

export const isInt = v => typeof v === 'number' && Number.isInteger(v);

export function deepEntries(o, base = '', out = [], d = 0) {
  if (!o || typeof o !== 'object' || d > 14) return out;
  if (Array.isArray(o)) { o.forEach((v, i) => deepEntries(v, base + '[' + i + ']', out, d + 1)); return out; }
  for (const k of Object.keys(o)) {
    out.push({ path: base ? base + '.' + k : k, key: k, value: o[k] });
    deepEntries(o[k], base ? base + '.' + k : k, out, d + 1);
  }
  return out;
}

/* ---- the browser -------------------------------------------------------- */
export async function launch(testExt, tag) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-' + tag + '-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-extensions-except=' + testExt, '--load-extension=' + testExt]
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  /* Written and PROVEN (claim-lib.mjs setSettings throws if it never sticks),
     so no capture below can run with redaction off while the suite believes it
     is on. */
  await setSettings(sw, { redactPII: true });
  return { ctx, sw };
}

/* One full-page capture. The result page is left OPEN: every read below goes
   through it, and it is closed by the caller. */
export async function capture(ctx, sw, url, opts = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(opts.settleMs || 1000);
  const wait = ctx.waitForEvent('page', {
    predicate: p => p.url().includes('pages/result.html'), timeout: 300000
  });
  wait.catch(() => {});
  await sw.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === pageUrl) || tabs.find(t => (t.url || '').startsWith('http'));
    if (!tab) throw new Error('test tab not found');
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
    const res = await startCapture(tab, 'full', 0);
    if (!res || !res.ok) throw new Error('startCapture failed: ' + (res && res.error));
  }, url);
  const result = await wait;
  await result.waitForSelector('#view:not([hidden])', { timeout: 300000 });
  await result.waitForTimeout(opts.lineSettleMs || 1500);
  /* What the fixture itself reported (the late fixtures record when they fired). */
  let fixture = null;
  try {
    fixture = await page.evaluate(() => {
      try { return JSON.parse(JSON.stringify(window.__fsFixture || null)); } catch (_) { return null; }
    });
  } catch (_) {}
  return { page, result, fixture };
}

/* The record, as the store hands it out (§4's strip lives at that boundary). */
export const readRecord = (result) => result.evaluate(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  return JSON.parse(JSON.stringify({
    id, topKeys: Object.keys(shot), redaction: shot.redaction ?? null,
    w: shot.w, h: shot.segments ? shot.segments.reduce((a, s) => a + s.h, 0) : 0
  }));
});

/* Rows of the delivered image in which a colour occurs, across every segment. */
export const colourRows = (result, colours, tol = 18) => result.evaluate(async ({ names, list, tol }) => {
  if (!names.length) return {};
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const rows = {}; names.forEach(n => rows[n] = 0);
  for (const seg of shot.segments) {
    const bmp = await createImageBitmap(seg.blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    for (let y = 0; y < bmp.height; y++) {
      const hit = new Array(list.length).fill(false);
      let left = list.length;
      for (let x = 0; x < bmp.width && left > 0; x += 2) {
        const o = (y * bmp.width + x) * 4;
        for (let i = 0; i < list.length; i++) {
          if (hit[i]) continue;
          const c = list[i];
          if (Math.abs(d[o] - c[0]) <= tol && Math.abs(d[o + 1] - c[1]) <= tol &&
              Math.abs(d[o + 2] - c[2]) <= tol) { hit[i] = true; left--; }
        }
      }
      for (let i = 0; i < list.length; i++) if (hit[i]) rows[names[i]]++;
    }
    bmp.close();
  }
  return rows;
}, { names: Object.keys(colours), list: Object.values(colours), tol });

/* Each stored mark, probed at five points in the DELIVERED image. */
export const probeMarks = (result, marks) => result.evaluate(async (ms) => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const segs = []; let top = 0;
  for (const s of shot.segments) {
    const bmp = await createImageBitmap(s.blob);
    segs.push({ bmp, top, h: bmp.height }); top += bmp.height;
  }
  const px = (bmp, x, y) => {
    const cv = new OffscreenCanvas(1, 1);
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(bmp, x, y, 1, 1, 0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const bad = []; let colour = null;
  for (const m of ms) {
    const pts = [[0.5, 0.5], [0.25, 0.35], [0.75, 0.35], [0.25, 0.65], [0.75, 0.65]];
    let first = null, uniform = true, off = false;
    for (const [fx, fy] of pts) {
      const X = Math.round(m.x + m.w * fx), Y = Math.round(m.y + m.h * fy);
      const seg = segs.find(s => Y >= s.top && Y < s.top + s.h);
      if (!seg || X < 0 || X >= seg.bmp.width) { off = true; break; }
      const c = px(seg.bmp, X, Y - seg.top);
      if (!first) first = c;
      else if (c[0] !== first[0] || c[1] !== first[1] || c[2] !== first[2]) uniform = false;
    }
    if (off) bad.push('off-image ' + JSON.stringify(m));
    else if (!uniform) bad.push('not uniform at ' + JSON.stringify(m) + ' first=' + first.join(','));
    else colour = colour || first;
  }
  const W = segs[0] ? segs[0].bmp.width : 0, H = top;
  for (const s of segs) s.bmp.close();
  return { bad, colour, w: W, h: H };
}, marks);

/* The bundle, built through the shipped producer (§3.5 puts the gate there). */
export const buildBundle = (result, over) => result.evaluate(async (o) => {
  const id = new URLSearchParams(location.search).get('id');
  const shot = await FSDB.get('shots', id);
  const r = shot.redaction || {};
  const input = {
    id: shot.id,
    producer: { tool: 'FullShot', version: '0', surface: 'chrome-extension' },
    subject: { kind: 'web-page', mode: shot.mode || 'full', url: shot.url || '',
      title: shot.title || '', capturedAt: new Date(shot.createdAt || Date.now()).toISOString(),
      image: { w: shot.w, h: shot.segments.reduce((a, s) => a + s.h, 0) } },
    redactRequested: r.requested === undefined ? null : r.requested,
    redactActs: r.acts, pixelKinds: r.kinds || {}, notes: [], reviewed: true
  };
  Object.assign(input, (o && o.input) || {});
  if (o && o.deleteReviewed) delete input.reviewed;
  try {
    const b = fsAiBundle(input);
    return { ok: true, envelope: JSON.parse(JSON.stringify(b.envelope)), text: b.text };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}, over || {});

export async function saveFirstSegment(result, file) {
  try {
    const b64 = await result.evaluate(async () => {
      const id = new URLSearchParams(location.search).get('id');
      const shot = await FSDB.get('shots', id);
      const bytes = new Uint8Array(await shot.segments[0].blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
      return btoa(s);
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(b64, 'base64'));
  } catch (_) { /* a diagnostic, never an assertion */ }
}

/* ==========================================================================
   U — THE UNIVERSALS, asked of every shape. Returns the acts block and marks.
   ========================================================================== */
export async function gradeUniversal(result, rec) {
  const r = rec.redaction;
  const a = (r && r.acts) || null;

  check('U1 the record carries redaction.acts (§2.1)', !!r && !!a && typeof a === 'object',
    r ? Object.keys(r).join(',') : 'no redaction block');
  check('U2 redaction was requested, and the record says so (§2.1 requested)',
    !!r && r.requested === true, 'requested=' + JSON.stringify(r && r.requested));

  const entries = deepEntries(r);
  const removed = entries.filter(e => REMOVED_NAMES.indexOf(e.key) >= 0);
  check('U3 no §2.2-removed field at any depth of the record',
    removed.length === 0, removed.map(e => e.path).join(',') || entries.length + ' keys read');
  const unknown = r ? Object.keys(r).filter(k => RECORD_REDACTION_KEYS.indexOf(k) < 0) : [];
  check('U4 the record\'s redaction block holds only fields §2.1/§3.3 name (an allowlist, §8.3 tooth 5)',
    unknown.length === 0, unknown.join(',') || 'ok');

  if (a) {
    const missing = ACTS_KEYS.filter(k => !(k in a));
    const extra = Object.keys(a).filter(k => ACTS_KEYS.indexOf(k) < 0);
    check('U5 acts holds exactly the twelve fields of §2.1 v4',
      !missing.length && !extra.length,
      (missing.length ? 'missing ' + missing.join(',') + ' ' : '') + (extra.length ? 'extra ' + extra.join(',') : '') || 'ok');
    const bad = Object.keys(a).filter(k => {
      const v = a[k];
      if (k === 'truncatedBy') return TRUNCATED_BY.indexOf(v) < 0;
      if (k === 'ledger') return LEDGER_VALUES.indexOf(v) < 0;
      return !(v === null || typeof v === 'boolean' || isInt(v));
    });
    check('U6 every acts value is an integer, boolean, null or one of the two closed enums (§0.1 Rule 2)',
      !bad.length, bad.map(k => k + '=' + JSON.stringify(a[k])).join(' ') || 'ok');
    /* A capture this build just took has a ledger. partial/absent are §4's
       populations, old records only. */
    check('U7 a fresh capture carries a present ledger (§2.1, §4)', a.ledger === 'present',
      'ledger=' + JSON.stringify(a.ledger));
    check('U8 the three counts are one unit and read as a chain: matched >= painted >= verifiedOpaque (§2.1)',
      isInt(a.matched) && isInt(a.painted) && isInt(a.verifiedOpaque) &&
      a.matched >= a.painted && a.painted >= a.verifiedOpaque,
      [a.matched, a.painted, a.verifiedOpaque].map(String).join('/'));
  }

  const kinds = r && r.kinds;
  const kindsOk = kinds && typeof kinds === 'object' && !Array.isArray(kinds) &&
    Object.keys(kinds).every(k => isInt(kinds[k]) && kinds[k] >= 0);
  check('U9 kinds is a histogram of non-negative integers — never a value, never a position (§2.1)',
    !!kindsOk, JSON.stringify(kinds));

  const marks = (r && Array.isArray(r.marks)) ? r.marks : [];
  const shapeOk = marks.every(m => m && ['x', 'y', 'w', 'h'].every(k => typeof m[k] === 'number' && isFinite(m[k])) &&
    Object.keys(m).every(k => ['x', 'y', 'w', 'h'].indexOf(k) >= 0));
  check('U10 marks are bare {x,y,w,h} and nothing else (§3.3)', shapeOk,
    JSON.stringify(marks).slice(0, 160));
  if (a && isInt(a.verifiedOpaque)) {
    /* A mark is a BLOCK, verifiedOpaque counts MATCHES; every verified match
       has every one of its blocks marked, so the floor is an inequality. */
    check('U11 at least one mark per verified-opaque match (§2.1, §3.3)',
      marks.length >= a.verifiedOpaque, marks.length + ' marks vs verifiedOpaque ' + a.verifiedOpaque);
  }
  let probe = { bad: [], colour: null, w: rec.w, h: rec.h };
  if (marks.length) {
    probe = await probeMarks(result, marks);
    check('U12 every stored mark is a uniform solid region of the DELIVERED image (§2.1, §3.3)',
      probe.bad.length === 0, probe.bad.join(' | ') ||
      marks.length + ' mark(s), rgb(' + (probe.colour || []).join(',') + ')');
    const oob = marks.filter(m => m.x < 0 || m.y < 0 || m.w <= 0 || m.h <= 0 ||
      m.x + m.w > probe.w + 1 || m.y + m.h > probe.h + 1);
    check('U13 every mark lies inside the image it describes (§3.3)', oob.length === 0,
      oob.length ? JSON.stringify(oob[0]) : probe.w + 'x' + probe.h);
  }
  return { r, a, marks };
}

/* ==========================================================================
   P — THE PAYLOAD, through the shipped producer.
   ========================================================================== */
export async function gradePayload(result, a) {
  const unreviewed = await buildBundle(result, { deleteReviewed: true });
  check('P1 the producer refuses an unreviewed bundle when redaction was requested (§3.5 FS_ENVELOPE_UNREVIEWED)',
    !unreviewed.ok && /FS_ENVELOPE_UNREVIEWED/.test(unreviewed.error || ''),
    unreviewed.ok ? 'it built one' : unreviewed.error);
  const b = await buildBundle(result);
  check('P2 the bundle builds once the review precondition holds', b.ok, b.error || 'built');
  if (!b.ok) return null;
  const all = deepEntries(b.envelope);
  const verdicts = all.filter(e => VERDICT_NAMES.indexOf(e.key) >= 0);
  check('P3 the envelope carries no verdict key at any depth (§5)', verdicts.length === 0,
    verdicts.map(e => e.path).join(',') || all.length + ' keys read');
  const first = (b.text.split('\n').find(l => /^- Redaction:/.test(l)) || '').trim();
  const m = PAYLOAD_LINE.exec(first);
  check('P4 the payload\'s redaction line has §2.3\'s shape and order', !!m, JSON.stringify(first));
  if (m && a) {
    check('P5 ...and states the record\'s own three counts (§2.3)',
      +m[1] === a.matched && +m[3] === a.painted && +m[4] === a.verifiedOpaque,
      [m[1], m[3], m[4]].join('/') + ' vs record ' + [a.matched, a.painted, a.verifiedOpaque].join('/'));
    const want = a.matchedComplete === true ? 'whole count'
      : a.matchedComplete === false ? 'PARTIAL count' : 'completeness unknown';
    check('P6 ...with the record\'s own completeness inside the clause that states the number (§2.1.1, §2.3)',
      m[2] === want, m[2] + ' vs matchedComplete=' + JSON.stringify(a.matchedComplete));
    check('P7 ...and the record\'s own walk flag (§2.3)',
      (m[5] === 'complete') === (a.walkComplete === true),
      'walk ' + m[5] + ' vs walkComplete=' + JSON.stringify(a.walkComplete));
  }
  check('P8 the payload carries §2.3\'s constant limit sentence',
    b.text.indexOf(PAYLOAD_CONSTANT_A) >= 0 && b.text.indexOf(PAYLOAD_CONSTANT_B) >= 0,
    JSON.stringify(first).slice(0, 120));
  const own = b.text.split('\n').filter(l => /Redaction|FullShot reads the text|counts what FullShot did/.test(l)).join(' ');
  const hits = own.match(FORBIDDEN) || [];
  check('P9 no §6-forbidden word in the redaction lines FullShot wrote', hits.length === 0,
    hits.join(',') || 'ok');
  return b;
}

/* ==========================================================================
   L — THE LEDGER AGAINST THE PICTURE.
   `tokens` names the PII tokens the fixture paints in a marker colour and that
   a human reads in the delivered image. `gone` are those the spec expects
   covered, `kept` those a §1 standing limit says are never read. Every token
   on the page that can reach the picture must be in one of the two maps, or
   L3 has nothing to count against.
   ========================================================================== */
export const VANISHED_AT = 2;   /* <= this many rows = the colour is gone */
export const PRESENT_AT = 6;    /* >= this many rows = the colour survived */

export function gradePicture(shape, rows, a) {
  const gone = Object.keys(shape.gone || {});
  const kept = Object.keys(shape.kept || {});
  for (const n of gone) {
    check('L1 ' + n + ' is covered in the delivered image (' + (shape.goneWhy || '§3.4 honest common case') + ')',
      rows[n] <= VANISHED_AT, n + ' marker rows=' + rows[n]);
  }
  for (const n of kept) {
    check('L2 ' + n + ' is still in the picture — ' + (shape.keptWhy || 'a §1 standing limit, never read'),
      rows[n] >= PRESENT_AT, n + ' marker rows=' + rows[n]);
  }
  if (!a || !isInt(a.painted) || !isInt(a.verifiedOpaque)) return;
  const all = gone.concat(kept);
  const vanished = all.filter(n => rows[n] <= VANISHED_AT);
  /* Direction 1 — nothing disappeared from the picture that the ledger does
     not account for: one match per token, so a vanished token is at least one
     painted match. */
  check('L3 every token that vanished from the picture is accounted for by a painted match (§2.1 painted)',
    vanished.length <= a.painted, vanished.length + ' vanished (' + (vanished.join(',') || '-') +
    ') vs painted ' + a.painted);
  /* Direction 2 — the claim is not larger than the picture. A match read back
     opaque whose token is still legible is a covered count the image
     contradicts. Only asked where the fixture accounts for every token. */
  if (shape.allTokens) {
    check('L4 the ledger claims no more covered matches than the picture shows covered tokens (§0, §2.1)',
      a.verifiedOpaque <= vanished.length, 'verifiedOpaque ' + a.verifiedOpaque + ' vs ' +
      vanished.length + ' token(s) actually covered');
  }
}

/* BLOCKS PAINTED WHERE THE MATCHED TEXT IS NOT IN THE PICTURE — RECORDED, NOT
   GRADED, and the reason is written here because the first draft of this file
   graded it and the spec does not support that.
   For a shape whose every match sits in content the renderer does not draw, a
   block computed from that content lands on whatever IS drawn there, and §3.3's
   numbered list then labels a region of ordinary prose "1 email". The acts are
   still TRUE — §2.1 counts a match painted when its blocks were drawn, and
   verified when they read back opaque, and both happened — and §3.3 lets a mark
   travel because it is "a region that is a solid block in the file", which it
   is. The spec says nothing about WHERE a block may land relative to the text
   it was measured from. content/capture.js clause 3b makes exactly this
   argument for content-visibility subtrees and suppresses the box; the
   ancestor-clip and ancestor-opacity clauses (5 and 6) deliberately do not
   ("over-masking is safe"). That is a disagreement inside the implementation
   and a silence in the spec, so it is an OPEN with its evidence, and a finding
   for whoever owns capture.js and the spec — not a red this suite can justify. */
export function reportOverMask(rows, marks, a, why) {
  const blockRows = rows.block || 0;
  if (blockRows === 0 && marks.length === 0) {
    note('over-mask: none — no block and no mark where the matched text is not in the picture (' + why + ')');
    return;
  }
  open('O1 a block is painted, and a mark kept, where the matched text is not in the picture (' + why +
    '); the spec is silent on block placement',
    blockRows + ' rows of block colour, ' + marks.length + ' mark(s) ' +
    JSON.stringify(marks).slice(0, 120) + ', acts ' +
    (a ? [a.matched, a.painted, a.verifiedOpaque].join('/') : '-'));
}

export { open, note };
