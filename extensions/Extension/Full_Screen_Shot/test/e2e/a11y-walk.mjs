/* ============================================================================
   a11y-walk.mjs — a REAL-KEY accessibility walk over the popup, the Options
   page and the editor, read from the browser's own accessibility tree
   (EXB-05, 2026-09-29).

   WHY. test/a11y-sim.node.js and test/editor-sim.node.js grade the SOURCE and a
   fake DOM; the first says of itself that "it cannot see a live accessibility
   tree". review-keyboard.mjs was the only tier that pressed real keys, and it
   covers one dialog on the result page. So the popup and the editor — the two
   surfaces a keyboard user touches on every capture — had never been walked by
   a keyboard in a browser, and no accessible name on them had ever been READ
   rather than inferred. This file presses Tab through each page, and at every
   stop asks the browser (CDP Accessibility.getPartialAXTree on
   document.activeElement) for the computed role and name.

   WHAT IS GRADED, per page:
     W1 the walk reaches at least one control (zero stops is COVERAGE LOST);
     W2 every Tab stop has an accessible name that is a WORD — a run of two or
        more letters, or a CJK/kana/hangul character. A glyph is not a name:
        the editor's tool buttons are ➤ ⛶ ▭ ◯ 😀 and carry their names in
        aria-label, so a stripped aria-label leaves a button a screen reader
        reads as "black rightwards arrowhead". (That is the red control.)
     W3 every Tab stop has a role other than generic/none — focus never lands
        on something that is not a control;
     W4 every focusable control the page's accessibility tree exposes as
        interactive and not disabled is REACHED by the walk — a control Tab
        cannot get to is a control a keyboard user does not have. A radio is
        reached when ANY radio of its radiogroup is a Tab stop: a group is one
        stop with the arrows inside it (roving tabindex), which is the ARIA
        pattern, not a gap.
   The editor is walked with a real shot in it (seeded into the extension's own
   IndexedDB through pages/db.js), so its toolbar is the toolbar a user sees.

   The channel comes from channel-lib.mjs, so this suite also runs on the
   branded leg (Edge and Chrome, Windows); the next line opts it in:
   e2e-branded:

   Exit: 0 green · 1 a finding · 2 coverage lost.
   Run:  node a11y-walk.mjs   (FS_E2E_CHROMIUM=<path>, FS_E2E_CHANNEL=msedge|chrome)
   ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchWithExtension } from './channel-lib.mjs';
import { prepareTestExtension } from './claim-lib.mjs';

let passes = 0;
const fails = [];
const check = (label, ok, extra) => {
  if (ok) passes++; else fails.push(label + (extra != null ? '  — ' + extra : ''));
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra != null ? '  — ' + extra : ''));
};
const lost = (msg) => { console.log('COVERAGE LOST — ' + msg); process.exit(2); };

/* A word, in any script: two letters in a row, or one CJK / kana / hangul
   character (a single ideograph is a whole word). */
const WORD = /\p{L}{2}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/* A colour code has letters in it and is still not a word: "#ef4444" is read
   "number e f 4 4 4 4". Measured on the editor's swatches on the first run. */
const COLOUR_CODE = /^#?[0-9a-f]{3,8}$/i;
const isName = n => WORD.test(n) && !COLOUR_CODE.test(n.trim());
const NOT_A_CONTROL = new Set(['generic', 'none', 'presentation', 'RootWebArea', 'WebArea', 'StaticText', 'paragraph']);
const INTERACTIVE = new Set(['button', 'checkbox', 'combobox', 'link', 'menuitem', 'radio', 'slider',
  'spinbutton', 'switch', 'tab', 'textbox', 'searchbox', 'listbox', 'menuitemcheckbox', 'menuitemradio']);

const prop = (node, name) => {
  const p = (node.properties || []).find(x => x.name === name);
  return p ? p.value && p.value.value : undefined;
};

/* The computed role and name of whatever holds focus, as the browser's own
   accessibility tree has it. */
async function focusedAx(page, cdp) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement' });
  if (!result || !result.objectId) return null;
  const desc = await page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return null;
    return a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') +
      (a.dataset && a.dataset.tool ? '[data-tool=' + a.dataset.tool + ']' : '') +
      (a.dataset && a.dataset.mode ? '[data-mode=' + a.dataset.mode + ']' : '');
  });
  if (!desc) { await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {}); return null; }
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
  const n = (nodes || []).find(x => !x.ignored) || (nodes || [])[0];
  return {
    desc,
    backend: n && n.backendDOMNodeId,
    role: n && n.role ? n.role.value : '',
    name: n && n.name ? String(n.name.value || '') : ''
  };
}

async function walk(ctx, label, url, prep) {
  console.log('\n=== ' + label + ' ===');
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'load' });
  if (prep) await prep(page);
  await page.waitForTimeout(600);           // common.js's i18n pass and the page's own boot
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Accessibility.enable');

  /* W4's subject: every interactive, focusable, enabled node in the tree. */
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  const groupOf = n => {
    for (let p = byId.get(n.parentId); p; p = byId.get(p.parentId)) {
      if (p.role && p.role.value === 'radiogroup') return p.nodeId;
    }
    return null;
  };
  const want = new Map();
  const groups = new Map();                  // radiogroup nodeId -> backend ids of its radios
  for (const n of nodes) {
    if (n.ignored || !n.backendDOMNodeId) continue;
    const role = n.role ? n.role.value : '';
    if (!INTERACTIVE.has(role)) continue;
    if (prop(n, 'focusable') !== true || prop(n, 'disabled') === true || prop(n, 'hidden') === true) continue;
    const g = role === 'radio' ? groupOf(n) : null;
    want.set(n.backendDOMNodeId, { d: role + ' "' + (n.name ? n.name.value : '') + '"', g });
    if (g) (groups.get(g) || groups.set(g, []).get(g)).push(n.backendDOMNodeId);
  }

  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.focus(); });
  const stops = [];
  const seen = new Set();
  const limit = want.size + 12;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const f = await focusedAx(page, cdp);
    if (!f) { if (stops.length) break; else continue; }   // focus left the document: the cycle is done
    if (seen.has(f.backend)) break;                      // wrapped back to the first stop
    seen.add(f.backend);
    stops.push(f);
  }
  console.log('  ' + stops.length + ' Tab stop(s): ' + stops.map(s => s.desc + ' ' + s.role + ' "' + s.name + '"').join(' | '));

  if (!stops.length) lost(label + ': Tab reached no control at all, so nothing on this page was walked');
  check(label + ' W1: the walk reaches the page\'s controls', stops.length >= 2, stops.length + ' stop(s)');
  const nameless = stops.filter(s => !isName(s.name));
  check(label + ' W2: every Tab stop has an accessible name that is a word, not a glyph',
    nameless.length === 0, nameless.map(s => s.desc + ' -> "' + s.name + '"').join(', ') || stops.length + ' named');
  const roleless = stops.filter(s => !s.role || NOT_A_CONTROL.has(s.role));
  check(label + ' W3: every Tab stop is a control (a role other than generic/none)',
    roleless.length === 0, roleless.map(s => s.desc + ' role=' + s.role).join(', ') || 'all roles are controls');
  const reached = (id, w) => seen.has(id) || (w.g !== null && groups.get(w.g).some(r => seen.has(r)));
  const missed = [...want.entries()].filter(([id, w]) => !reached(id, w)).map(([, w]) => w.d);
  check(label + ' W4: every enabled, focusable control in the accessibility tree is reached by Tab',
    missed.length === 0, missed.join(', ') || want.size + ' of ' + want.size + ' reached');
  await cdp.detach().catch(() => {});
  await page.close();
}

/* A real shot in the extension's own IndexedDB, written through pages/db.js
   from an extension page, so the editor boots with its toolbar and canvas. */
async function seedShot(page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#e8eef8'; g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#3b82f6'; g.fillRect(40, 40, 160, 90);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await FSDB.put('shots', {
      id: 'a11y-walk', title: 'Accessibility walk', url: 'http://127.0.0.1/a11y-walk',
      format: 'png', w: 400, h: 300, created: Date.now(), segments: [{ blob, w: 400, h: 300 }]
    });
  });
}

const TEST_EXT = prepareTestExtension();
let launched;
try {
  launched = await launchWithExtension(TEST_EXT, {
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-a11y-')),
    headless: !process.env.HEADFUL,
    viewport: { width: 1280, height: 800 }
  });
} catch (e) {
  lost('the extension never started, so nothing was walked: ' + (e && e.message || e));
}
const { ctx, sw } = launched;
const base = 'chrome-extension://' + new URL(sw.url()).host;   // URL.origin is 'null' for this scheme
let exitCode = 0;
try {
  await walk(ctx, 'popup/popup.html', base + '/popup/popup.html');
  await walk(ctx, 'pages/options.html', base + '/pages/options.html');
  const seeder = await ctx.newPage();
  await seeder.goto(base + '/pages/editor.html', { waitUntil: 'load' });
  await seedShot(seeder);
  await seeder.close();
  await walk(ctx, 'pages/editor.html', base + '/pages/editor.html?shot=a11y-walk', async (page) => {
    await page.waitForSelector('#stage:not([hidden])', { timeout: 20000 });
  });
  exitCode = fails.length ? 1 : 0;
  console.log('\n' + passes + ' pass · ' + fails.length + ' fail');
  if (fails.length) console.log('FINDINGS:\n  ' + fails.join('\n  '));
} catch (e) {
  console.log('COVERAGE LOST — the walk did not complete: ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await ctx.close().catch(() => {});
}
process.exit(exitCode);
