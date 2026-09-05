#!/usr/bin/env node
/* FullShot accessibility sim (no browser) — the NON-EDITOR pages.
   pages/options · result · beautify · scrollclip · history · batch, plus the
   stylesheet five of them share, pages/common.css.

   WHY A STATIC TIER AND NOT A BROWSER RUN.
   Almost everything an accessibility review gets wrong is wrong in the SOURCE:
   a control with no label, a <div> wearing a click handler, a focus ring that
   was never declared, a colour pair nobody multiplied out. A browser can show
   you those too, but only for the states you happened to click into, and only
   on the day someone runs it. Every check here is a claim about text that is
   checked into the repository, so it holds for every state and every locale at
   once — including the 55 the reviewer does not read.

   WHAT THIS TIER DELIBERATELY DOES NOT CLAIM.
   It cannot see a live accessibility tree, so "the screen reader said the right
   thing" is not in here — only "the markup can only produce one name". It does
   not measure layout, so 200% zoom is graded as the CSS that makes reflow
   possible (wrap, min-width:0, a stacking breakpoint), never as a screenshot.
   Contrast is computed from the tokens, which is exact for a flat fill and is
   NOT the same as a rendered pixel where a shadow or a translucency sits
   between; the two places this product composites (the danger hover tint) are
   composited here by hand rather than waved past. */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}

/* The six pages this item owns. The editor and the popup are another owner's
   surface and are deliberately absent: a check that graded them would go red in
   someone else's working tree for a reason they did not cause. */
const PAGES = [
  { html: 'pages/options.html',    js: 'pages/options.js',    common: true  },
  { html: 'pages/result.html',     js: 'pages/result.js',     common: true  },
  { html: 'pages/beautify.html',   js: 'pages/beautify.js',   common: true  },
  { html: 'pages/scrollclip.html', js: 'pages/scrollclip.js', common: true  },
  { html: 'pages/history.html',    js: 'pages/history.js',    common: true  },
  /* batch.html deliberately shares neither common.css nor common.js — see the
     note at the top of that file — so it has to carry its own palette, its own
     focus ring and its own reduced-motion answer, and it is graded that way. */
  { html: 'pages/batch.html',      js: 'pages/batch.js',      common: false }
];
const COMMON_CSS = 'pages/common.css';

/* ---------- tiny helpers over the source text ---------- */

const stripCssComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripHtmlComments = s => s.replace(/<!--[\s\S]*?-->/g, ' ');
/* Line comments only. A block-comment stripper would also eat the slash-star
   pair inside a regular expression literal, and these files hold several. */
const stripJsLineComments = s => s.replace(/^[ \t]*\/\/.*$/gm, ' ');
/* Block comments as well, for the handful of checks that look for a CALL and
   would otherwise be satisfied by prose. Found the hard way in the teeth pass:
   deleting the .focus() from result.js left the tier green, because the
   comment above it explains what .focus() is for. A check a comment can
   satisfy is a check that grades the documentation.
   Not the default, because it does eat the slash-star inside a regex literal;
   used only where the loss can make a check fail, never pass. */
const stripJsComments = s => stripJsLineComments(s).replace(/\/\*[\s\S]*?\*\//g, ' ');

/* Every <style> block of a page, concatenated. These pages carry their layout
   inline rather than in a second stylesheet, so this IS the page's CSS. */
function pageCss(file) {
  const html = read(file);
  return (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [])
    .map(b => b.replace(/<\/?style[^>]*>/gi, '')).join('\n');
}

function tagAttrs(body) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = m[2] == null ? '' : m[2].replace(/^["']|["']$/g, '');
  return out;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/* A tag walker, the same shape test/i18n-sim.node.js uses and for the same
   reason: this product's markup is hand-written, so a real parser would be a
   dependency bought to re-read text a 30-line loop already reads correctly.
   Returns one record per element with its attributes, its depth, the stack of
   open ancestors, and the raw inner text it encloses. */
function elements(file) {
  const html = stripHtmlComments(read(file));
  const out = [];
  const stack = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m, last = 0;
  const pushText = raw => {
    const t = raw.trim();
    if (!t) return;
    for (const f of stack) f.text.push(t);
    if (stack.length) stack[stack.length - 1].own.push(t);
  };
  while ((m = re.exec(html))) {
    pushText(html.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    const body = m[2] || '';
    if (m[0][1] === '/') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack[i].end = m.index; stack.length = i; break; }
      }
      continue;
    }
    const rec = {
      tag, attrs: tagAttrs(body), start: m.index, end: -1,
      ancestors: stack.slice(), text: [], own: [], children: []
    };
    if (stack.length) stack[stack.length - 1].children.push(rec);
    out.push(rec);
    if (/\/\s*$/.test(body) || VOID_TAGS.has(tag)) continue;
    stack.push(rec);
  }
  pushText(html.slice(last));
  return out;
}

/* ============================================================================
   1. COLOUR — computed, never eyeballed
   ==========================================================================*/
console.log('\n=== contrast: computed from the tokens in pages/common.css ===');

const hexBytes = h => {
  h = h.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
/* WCAG 2.x relative luminance and contrast ratio, verbatim from the spec. Not
   a perceptual model and not trying to be one: the threshold this product is
   graded against is defined in these exact terms, so the arithmetic has to be
   these exact terms too. */
const chan = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = hex => { const [r, g, b] = hexBytes(hex); return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b); };
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
/* srgb compositing for the one translucent fill this product paints:
   `color-mix(in srgb, var(--danger) 10%, transparent)` laid over a surface. A
   ratio computed against the surface underneath it would be a different
   (and flattering) number. */
const over = (fg, bg, alpha) => {
  const A = hexBytes(fg), B = hexBytes(bg);
  return '#' + [0, 1, 2].map(i => Math.round(A[i] * alpha + B[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
};

function cssBlock(css, selector) {
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return open < 0 || close < 0 ? null : css.slice(open + 1, close);
}
function customProps(text) {
  const out = {};
  if (text == null) return out;
  const re = /--([a-z0-9-]+)\s*:\s*([^;}]+)/gi;
  let m;
  while ((m = re.exec(text))) out['--' + m[1].toLowerCase()] = m[2].trim();
  return out;
}

const commonCss = stripCssComments(read(COMMON_CSS));
const LIGHT = customProps(cssBlock(commonCss, ':root {'));
const DARK_ATTR = customProps(cssBlock(commonCss, ':root[data-theme="dark"]'));
const DARK_MEDIA = customProps(cssBlock(commonCss, ':root:not([data-theme])'));
const DARK = Object.assign({}, LIGHT, DARK_ATTR);

/* Two ways into the dark theme — the explicit attribute the theme toggle sets,
   and the OS preference for a profile that never touched the toggle — and they
   are two separate blocks in the file. A token added to one and forgotten in
   the other is a page that is AA under the toggle and not AA out of the box,
   which is the harder bug to notice because nobody clicks anything to see it. */
{
  const missing = Object.keys(DARK_ATTR).filter(k => k !== '--shadow' && !(k in DARK_MEDIA));
  const disagree = Object.keys(DARK_ATTR).filter(k =>
    k !== '--shadow' && k in DARK_MEDIA &&
    DARK_MEDIA[k].replace(/\s+/g, '') !== DARK_ATTR[k].replace(/\s+/g, ''));
  check('the two dark blocks declare the same tokens (toggle vs prefers-color-scheme)',
    missing.length === 0, missing.length ? 'missing from the media block: ' + missing.join(', ') : Object.keys(DARK_ATTR).length + ' tokens');
  check('...with the same values in both', disagree.length === 0,
    disagree.length ? disagree.join(', ') : 'identical');
}

/* Left: the token pair. Right: the minimum WCAG AA asks of it, and the place
   on screen where the pair actually meets. A row with no call site is a row
   that reads like coverage, so every one of these names a surface that exists.
   4.5 is AA for body text; 3 is AA for a non-text boundary or state
   indicator (SC 1.4.11) — no row is 3 because the text happened to be big. */
const PAIRS = [
  ['--fg',          '--bg',            4.5, 'page copy'],
  ['--fg',          '--panel',         4.5, 'topbar, cards, option sections'],
  ['--fg',          '--bg2',           4.5, 'a .btn label while hovered'],
  ['--fg2',         '--bg',            4.5, '#progress, #empty, .hint'],
  ['--fg2',         '--panel',         4.5, '.topbar .meta, .opt small, .card .sub'],
  ['--fg2',         '--bg2',           4.5, 'muted text over a hovered surface'],
  ['--accent-fg',   '--accent',        4.5, '.btn.primary, .seg button.active'],
  ['--accent-fg',   '--accent-hover',  4.5, '.btn.primary:hover'],
  ['--accent-text', '--panel',         4.5, 'the captured page\'s link on a history card'],
  ['--accent-text', '--bg',            4.5, 'accent-coloured text on the page'],
  ['--accent-text', '--bg2',           4.5, 'accent-coloured text over a hovered surface'],
  ['--danger',      '--panel',         4.5, '.btn.danger in a topbar or on a card'],
  ['--danger',      '--bg',            4.5, '.btn.danger over the page'],
  ['--ok-fg',       '--ok',            4.5, '#saveNote on options.html'],
  ['--bg',          '--fg',            4.5, '#fs-toast, which inverts the pair'],
  ['--accent',      '--bg',            3,   'the focus ring over the page'],
  ['--accent',      '--panel',         3,   'the focus ring over a topbar or a card'],
  ['--accent',      '--bg2',           3,   'the focus ring over a hovered button'],
  ['--control-line', '--panel',        3,   'the border that IS the boundary of a .btn / select / input'],
  ['--control-line', '--bg',           3,   'the same border over the page'],
  ['--control-line', '--bg2',          3,   'the same border on a hovered control']
];

for (const [themeName, theme] of [['light', LIGHT], ['dark', DARK]]) {
  const bad = [];
  const rows = [];
  for (const [fg, bg, min, where] of PAIRS) {
    if (!theme[fg] || !theme[bg]) { bad.push(fg + '/' + bg + ' undefined'); continue; }
    const r = ratio(theme[fg], theme[bg]);
    rows.push('    ' + (fg + ' on ' + bg).padEnd(30) + r.toFixed(2).padStart(6) +
      '  (needs ' + min.toFixed(1) + ')  ' + where);
    if (r < min) bad.push(fg + ' on ' + bg + ' = ' + r.toFixed(2) + ' < ' + min);
  }
  console.log('  -- ' + themeName + ' --');
  for (const r of rows) console.log(r);
  check(themeName + ': every token pair the product actually paints meets WCAG AA',
    bad.length === 0, bad.join(' | ') || rows.length + ' pairs');
}

/* The one composited fill. `.btn.danger:hover` tints the surface with 10% of
   --danger, so the label sits on a colour that appears nowhere in the token
   list; the ratio has to be computed against what is actually painted. */
{
  const bad = [];
  for (const [themeName, theme] of [['light', LIGHT], ['dark', DARK]]) {
    const tint = over(theme['--danger'], theme['--panel'], 0.10);
    const r = ratio(theme['--danger'], tint);
    console.log('    ' + (themeName + ': --danger on its own 10% hover tint').padEnd(46) +
      r.toFixed(2).padStart(6) + '  (needs 4.5)  ' + tint);
    if (r < 4.5) bad.push(themeName + ' = ' + r.toFixed(2));
  }
  check('.btn.danger keeps AA against the tint its own hover paints underneath it',
    bad.length === 0, bad.join(' | ') || 'both themes');
}

/* batch.html shares no stylesheet, and it declares `color-scheme: light dark`
   — which means the browser flips Canvas/CanvasText underneath it whether or
   not the page brought colours for the flipped state. Hard-coded light-theme
   greys under that declaration are not a style opinion, they are text that
   disappears. Both of the browser's own surfaces are graded. */
console.log('\n=== contrast: pages/batch.html, which carries its own palette ===');
{
  const css = stripCssComments(pageCss('pages/batch.html'));
  const light = customProps(cssBlock(css, ':root {'));
  const darkBlock = cssBlock(css, 'prefers-color-scheme: dark');
  const dark = Object.assign({}, light, customProps(darkBlock));
  /* Chromium's own values for the two system colours this page leans on when
     `color-scheme: light dark` is honoured. Spelled out because the page never
     paints a background of its own and these ARE its background. */
  const CANVAS = { light: '#ffffff', dark: '#121212' };
  const ROWS = [
    ['--bq-sub',    4.5, 'the intro paragraph under the heading'],
    ['--bq-label',  4.5, 'panel headings, row numbers, the permission hint'],
    ['--bq-link',   4.5, 'the derived filename and the "open" link'],
    ['--bq-skip',   4.5, 'the skipped-URLs line'],
    ['--bq-done',   4.5, 'a finished row'],
    ['--bq-error',  4.5, 'a failed row'],
    ['--bq-busy',   4.5, 'the row being captured'],
    ['--bq-line',   3,   'the textarea border, which is its only boundary']
  ];
  check('batch.html declares a palette rather than hard-coding one theme\'s greys',
    Object.keys(light).length >= ROWS.length, Object.keys(light).length + ' tokens');
  check('...and answers the dark half of its own color-scheme declaration',
    darkBlock != null && Object.keys(customProps(darkBlock)).length >= ROWS.length,
    darkBlock == null ? 'no prefers-color-scheme: dark block' : Object.keys(customProps(darkBlock)).length + ' tokens');
  for (const [scheme, theme] of [['light', light], ['dark', dark]]) {
    const bad = [];
    for (const [tok, min, where] of ROWS) {
      if (!theme[tok]) { bad.push(tok + ' undefined'); continue; }
      const r = ratio(theme[tok], CANVAS[scheme]);
      console.log('    ' + (scheme + ': ' + tok).padEnd(30) + r.toFixed(2).padStart(6) +
        '  (needs ' + min.toFixed(1) + ')  ' + where);
      if (r < min) bad.push(tok + ' = ' + r.toFixed(2) + ' < ' + min);
    }
    if (theme['--bq-btn'] && theme['--bq-btn-fg']) {
      const r = ratio(theme['--bq-btn-fg'], theme['--bq-btn']);
      console.log('    ' + (scheme + ': --bq-btn-fg on --bq-btn').padEnd(30) + r.toFixed(2).padStart(6) +
        '  (needs 4.5)  the Capture all button');
      if (r < 4.5) bad.push('--bq-btn-fg on --bq-btn = ' + r.toFixed(2));
    }
    check('batch.html in ' + scheme + ': every colour it paints meets WCAG AA',
      bad.length === 0, bad.join(' | ') || ROWS.length + 1 + ' colours');
  }
}

/* A var() with no definition is not a style bug that shows up as the wrong
   colour — for an inherited property it is "invalid at computed-value time",
   which silently resolves to the PARENT's value, so the element renders
   something plausible and the token is simply never applied. That is exactly
   how a muted caption ends up painted in the body colour and nobody notices. */
console.log('\n=== every custom property a page spends is a property something defines ===');
for (const p of PAGES) {
  const own = stripCssComments(pageCss(p.html));
  const defined = new Set(Object.keys(customProps(own)));
  if (p.common) for (const k of Object.keys(LIGHT)) defined.add(k);
  for (const k of Object.keys(DARK_ATTR)) if (p.common) defined.add(k);
  /* Inline style="" in the markup and any style string the page's script
     writes count as that page's CSS too — history.js styles its card link from
     JavaScript, and a token that only exists there is just as undefined. */
  const surfaces = own + '\n' + read(p.html).match(/style="[^"]*"/g)?.join('\n') + '\n' + read(p.js);
  const used = new Set();
  const re = /var\(\s*(--[a-z0-9-]+)\s*([,)])/gi;
  let m;
  while ((m = re.exec(surfaces))) if (m[2] === ')') used.add(m[1].toLowerCase());  // a fallback makes it safe
  const orphans = [...used].filter(k => !defined.has(k));
  check(p.html + ': no var() names a token nothing declares', orphans.length === 0,
    orphans.join(', ') || used.size + ' tokens used');
}

/* ============================================================================
   2. FOCUS — visible, and never taken away
   ==========================================================================*/
console.log('\n=== a visible focus ring ===');
{
  const hasRing = /:focus-visible\b[^{]*\{[^}]*outline:\s*\d+px\s+solid/.test(commonCss);
  check('pages/common.css declares a solid outline on :focus-visible', hasRing,
    hasRing ? '' : 'no :focus-visible outline rule');
  check('...offset from the control, so the ring on a filled button lands on the page behind it',
    /:focus-visible\b[^{]*\{[^}]*outline-offset:/.test(commonCss), '');
  /* An input at opacity:0 cannot show a ring — opacity applies to the outline
     too. The options switch is exactly that shape, so its ring has to be drawn
     on the track element the input sits on top of. */
  const optCss = stripCssComments(pageCss('pages/options.html'));
  check('the options switch draws its ring on the track (its input is opacity:0)',
    /\.switch\s+input:focus-visible\s*\+\s*\.track\s*\{[^}]*outline:/.test(optCss), '');
}
{
  /* Removing an outline without putting one back is the single most common way
     a keyboard user loses their place. Allowed only where the very next
     declaration replaces it. */
  const bad = [];
  for (const p of PAGES) {
    const css = stripCssComments(pageCss(p.html));
    const re = /outline:\s*(none|0)\b/g;
    let m;
    while ((m = re.exec(css))) {
      const rule = css.slice(Math.max(0, m.index - 400), m.index + 400);
      if (!/box-shadow:|outline:\s*\d/.test(rule)) bad.push(p.html);
    }
  }
  check('no page removes a focus outline without drawing a replacement',
    bad.length === 0, [...new Set(bad)].join(', ') || PAGES.length + ' pages');
}
{
  /* batch.html has no shared stylesheet to inherit a ring from. */
  const css = stripCssComments(pageCss('pages/batch.html'));
  check('pages/batch.html brings its own focus ring',
    /:focus-visible\b[^{]*\{[^}]*outline:\s*\d+px\s+solid/.test(css), '');
}

console.log('\n=== focus is never left on an element the page just removed ===');
/* Three places on these pages destroy or hide the element the user was
   standing on. Focus does not move with it — it falls to <body>, and a screen
   reader user is returned to the top of the document with no announcement.
   Each of the three has to put focus somewhere deliberate. The window after
   the anchor is bounded so the check cannot be satisfied by a .focus() call
   somewhere else entirely in the file. */
const FOCUS_SITES = [
  ['pages/result.js',  /function showEmpty\([\s\S]{0,1200}?\.focus\(/,
    'showEmpty() hides #actions, which is where the Delete button the user just pressed lives'],
  ['pages/history.js', /async function refresh\([\s\S]{0,900}?\.focus\(/,
    'refresh() rebuilds every card, destroying the row button that triggered the delete'],
  ['pages/options.js', /async function refreshExpandPermRow\([\s\S]{0,1600}?\.focus\(/,
    'the Allow button hides itself the moment the permission is granted']
];
for (const [file, re, why] of FOCUS_SITES) {
  /* Comments stripped: each of these three sites is documented with a note
     that names .focus(), and a check the prose can satisfy grades the prose. */
  check(file + ': focus is placed after the trigger disappears',
    re.test(stripJsComments(read(file))), why);
}

console.log('\n=== Escape dismisses what can be dismissed ===');
/* These pages have no modal dialog — nothing traps focus and nothing needs a
   focus loop. What they DO have is transient overlay text (the toast, the
   options save pill) and, on history, a filter that hides most of the page.
   Escape is the one key a user tries on all three. */
for (const p of PAGES) {
  const js = stripJsLineComments(read(p.js));
  const dismissible = /fsToast\(/.test(js) || /saveNote/.test(js);
  if (!dismissible) { check(p.js + ': nothing dismissible to wire Escape to', true, 'skipped'); continue; }
  check(p.js + ': Escape is wired', /['"]Escape['"]/.test(js) && /keydown/.test(js), '');
}

/* ============================================================================
   3. SEMANTICS
   ==========================================================================*/
console.log('\n=== real controls, not clickable decorations ===');
{
  /* A click handler on an <img> or a <div> is a control that a keyboard cannot
      reach and a screen reader does not announce. Paired by variable name
      rather than by guessing: the element is created on one line and wired on
      another, and the tag is the whole question. */
  const OPERABLE = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'label']);
  for (const p of PAGES) {
    const js = stripJsLineComments(read(p.js));
    const tagOf = new Map();
    let m;
    const mk = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*['"]([a-z]+)['"]/g;
    while ((m = mk.exec(js))) tagOf.set(m[1], m[2]);
    const bad = [];
    const wire = /([A-Za-z_$][\w$]*)\.addEventListener\(\s*['"]click['"]/g;
    while ((m = wire.exec(js))) {
      const tag = tagOf.get(m[1]);
      if (tag && !OPERABLE.has(tag)) bad.push(m[1] + ' is a <' + tag + '>');
    }
    check(p.js + ': every click handler lands on a real control', bad.length === 0,
      bad.join(', ') || tagOf.size + ' elements built');
  }
  const inline = PAGES.filter(p => /\son[a-z]+\s*=/i.test(stripHtmlComments(read(p.html))));
  check('no page wires behaviour through an on* attribute', inline.length === 0,
    inline.map(p => p.html).join(', ') || PAGES.length + ' pages');
}

console.log('\n=== tab order is the reading order ===');
{
  /* A positive tabindex does not move one control forward, it moves it in
     front of EVERY control on the page that has none — and the next person to
     add a button inherits an order nobody can predict. -1 (unreachable by Tab,
     reachable by script) is the only value worth writing. */
  const bad = [];
  for (const p of PAGES) {
    for (const m of stripHtmlComments(read(p.html)).matchAll(/tabindex\s*=\s*["']?(-?\d+)/gi))
      if (Number(m[1]) > 0) bad.push(p.html + ' tabindex=' + m[1]);
    for (const m of stripJsLineComments(read(p.js)).matchAll(/tabIndex\s*=\s*(-?\d+)/g))
      if (Number(m[1]) > 0) bad.push(p.js + ' tabIndex=' + m[1]);
    for (const m of stripJsLineComments(read(p.js)).matchAll(/setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]?(-?\d+)/gi))
      if (Number(m[1]) > 0) bad.push(p.js + ' tabindex=' + m[1]);
  }
  check('no positive tabindex anywhere on these six pages', bad.length === 0,
    bad.join(', ') || 'DOM order only');
}

console.log('\n=== every control has a name a screen reader can read ===');
{
  const NAMED_BY = ['aria-label', 'aria-labelledby'];
  for (const p of PAGES) {
    const html = stripHtmlComments(read(p.html));
    const els = elements(p.html);
    const bad = [];
    for (const el of els) {
      if (!['input', 'select', 'textarea'].includes(el.tag)) continue;
      const a = el.attrs;
      if ((a.type || '').toLowerCase() === 'hidden') continue;
      if (NAMED_BY.some(n => a[n])) continue;
      if ((a['data-i18n-attr'] || '').includes('aria-label')) continue;
      if (a.id && new RegExp('<label[^>]*\\bfor\\s*=\\s*["\']' + a.id + '["\']').test(html)) continue;
      /* Wrapped in a <label> that has words in it — the shape beautify and
         scrollclip use for their checkboxes. A <label> holding nothing but the
         control names it "": that is not a label, it is a hit target. */
      const wrap = el.ancestors.filter(x => x.tag === 'label').pop();
      if (wrap && (wrap.attrs['data-i18n'] || wrap.children.some(c => c.attrs['data-i18n']) ||
          wrap.text.some(t => /\p{L}/u.test(t)))) continue;
      bad.push('<' + el.tag + (a.id ? ' id=' + a.id : '') + (a.type ? ' type=' + a.type : '') + '>');
    }
    check(p.html + ': every form control is labelled', bad.length === 0,
      bad.join(', ') || els.filter(e => ['input', 'select', 'textarea'].includes(e.tag)).length + ' controls');
  }
}

console.log('\n=== an icon button is named by its label, not by its glyph ===');
{
  /* The accessible name of a <button> is its CONTENT, and content beats title.
     `<button title="Options">⚙</button>` is therefore announced as the name of
     the gear character, in whatever language the screen reader's emoji
     dictionary is in — the title is never reached. Two ways out, and the page
     has to take one: give the button an aria-label (which replaces the
     content), or hide the glyph from the tree so the real label is all that is
     left. */
  /* Digits are a LABEL — "480", "16:9", "2×" are what those rail buttons are
     called, and a screen reader reads them correctly. Only punctuation and
     symbols with no digit and no letter beside them are nameless. */
  const SYMBOLS = /^[\s\p{P}\p{S}]+$/u;
  for (const p of PAGES) {
    const bad = [];
    for (const el of elements(p.html)) {
      if (el.tag !== 'button' && !(el.tag === 'a' && /\bbtn\b/.test(el.attrs.class || ''))) continue;
      const a = el.attrs;
      const labelled = !!a['aria-label'] || !!a['aria-labelledby'] ||
        (a['data-i18n-attr'] || '').includes('aria-label');
      if (labelled) continue;
      const words = el.text.filter(t => /[\p{L}\p{N}]/u.test(t));
      const glyphs = el.own.filter(t => SYMBOLS.test(t));
      /* Glyphs nested in a child are only safe if that child is hidden. */
      const nestedGlyphs = el.children.filter(c =>
        c.own.some(t => SYMBOLS.test(t)) && c.attrs['aria-hidden'] !== 'true');
      if (!words.length) { bad.push((a.id || el.tag) + ': symbols only and no aria-label'); continue; }
      if (glyphs.length) bad.push((a.id || el.tag) + ': bare glyph ' + JSON.stringify(glyphs[0]) + ' in the name');
      else if (nestedGlyphs.length) bad.push((a.id || el.tag) + ': glyph child is not aria-hidden');
    }
    check(p.html + ': no button is named by a symbol', bad.length === 0,
      bad.join(' | ') || 'clean');
  }
}

console.log('\n=== state that is painted is also state that is exposed ===');
{
  /* The preset / format / density / shape rails paint the chosen button with a
     class. A class is invisible to everything except the stylesheet: without
     aria-pressed a screen reader reads five identical buttons and no way to
     tell which one is on. */
  for (const file of ['pages/beautify.html', 'pages/scrollclip.html']) {
    const els = elements(file);
    const segs = els.filter(e => /\bseg\b/.test(e.attrs.class || ''));
    const bad = [];
    for (const seg of segs) {
      if (seg.attrs.role !== 'group') bad.push('#' + seg.attrs.id + ' has no role="group"');
      if (!seg.attrs['aria-labelledby']) bad.push('#' + seg.attrs.id + ' is not tied to its field label');
      for (const b of seg.children.filter(c => c.tag === 'button')) {
        if (b.attrs['aria-pressed'] == null) bad.push('#' + seg.attrs.id + ' button has no aria-pressed');
        if ((b.attrs.type || '') !== 'button') bad.push('#' + seg.attrs.id + ' button has no type');
      }
    }
    check(file + ': each rail is a labelled group of pressable buttons',
      segs.length > 0 && bad.length === 0, bad.slice(0, 3).join(' | ') || segs.length + ' rails');
  }
  /* And the class the click handler toggles has to be joined by the attribute,
     or the markup is right exactly until the first click. BOTH writes, not
     one: clearing every button to false and then forgetting to set the pressed
     one to true leaves a rail that reports nothing selected — which is what
     the teeth pass produced when this check only looked for the string. */
  for (const file of ['pages/beautify.js', 'pages/scrollclip.js']) {
    const js = stripJsComments(read(file));
    const body = (js.match(/function bindGroup\([\s\S]{0,900}/) || [''])[0];
    check(file + ': bindGroup moves aria-pressed with the class, in both directions',
      /aria-pressed'\s*,\s*'false'/.test(body) && /aria-pressed'\s*,\s*'true'/.test(body), '');
  }
  {
    const sw = (stripJsComments(read('pages/beautify.js'))
      .match(/FS_BG_PRESETS\.forEach\([\s\S]{0,1600}/) || [''])[0];
    check('pages/beautify.js: the background swatches expose their pressed state too',
      /aria-pressed'\s*,\s*'false'/.test(sw) && /aria-pressed'\s*,\s*'true'/.test(sw), '');
  }
}

console.log('\n=== a live region, so finishing and failing are not silent ===');
{
  /* fsToast() reuses an element with this id if the page already declares one,
     and only builds a bare <div> when it does not. A toast built by script is
     inserted with its text already in place, which is the one case an
     assistive technology is entitled to ignore — the region has to be in the
     document, and empty, BEFORE the text arrives. Declaring it in the markup
     is therefore not decoration; it is the difference between an announcement
     and silence. */
  for (const p of PAGES) {
    if (!/fsToast\(/.test(stripJsLineComments(read(p.js)))) {
      check(p.html + ': raises no toast, so needs no toast region', true, 'skipped');
      continue;
    }
    const toast = elements(p.html).find(e => e.attrs.id === 'fs-toast');
    check(p.html + ': declares #fs-toast up front as a polite live region',
      !!toast && toast.attrs.role === 'status' && toast.attrs['aria-live'] === 'polite',
      toast ? 'role=' + toast.attrs.role + ' aria-live=' + toast.attrs['aria-live'] : 'no #fs-toast in the markup');
  }
  const live = (file, id) => {
    const el = elements(file).find(e => e.attrs.id === id);
    return el && el.attrs.role === 'status' && el.attrs['aria-live'] === 'polite';
  };
  check('result.html: the assembling progress line is a live region', live('pages/result.html', 'progress'), '');
  /* THE ACTS LINE IS NOT A TOAST (REDACTION-CLAIM-SPEC.md §3, §8.2).
     Four separate properties, and the last two are the ones a sighted-developer
     review would miss:

       announced — it appears after the stitch, so it has to be a live region
                   declared empty in the markup, exactly like the toast;
       permanent — a toast is gone in twelve seconds and a screen-reader user
                   who was reading the image when it fired never had it. The
                   whole point of this line is the reader who comes back
                   tomorrow, and "we told them" must not be satisfiable by the
                   transient surface alone;
       reachable — it is in the document flow above the image, not an overlay
                   pinned outside the reading order;
       not colour — there is now ONE appearance and no variants at all. The old
                   line had two, and the heavier border was a verdict rendered
                   in CSS; a reader who cannot see it lost nothing then and has
                   nothing to lose now. What is graded is that the styling has
                   no state left to encode. */
  check('result.html: the permanent redaction line is a polite live region',
    live('pages/result.html', 'redactLine'), '');
  {
    const rjs = stripJsComments(read('pages/result.js'));
    check('result.js writes the acts line into that element',
      /redactLine[\s\S]{0,600}?textContent\s*=/.test(rjs) && /function actsLine\(/.test(rjs), '');
    /* THERE IS NO TOAST LEFT TO BE THE ONLY SURFACE. The transient alarm was
       how the old design graded eight states by volume, and the grading is what
       was removed; a warning that fires on every capture is wallpaper within a
       week and then protects nobody. The one place a person is stopped is the
       review dialog, and it is spent on a single action. */
    const fn = /function warnRedaction\(\)[\s\S]*?\n  \}/.exec(rjs);
    const body = fn ? fn[0] : '';
    check('...and it raises no toast at all',
      body.length > 0 && !/fsToast/.test(body) && /textContent/.test(body),
      body ? 'no toast in warnRedaction' : 'warnRedaction not found');
    const html = read('pages/result.html');
    check('...and the line lives in the reading order, inside #view',
      /<div id="view"[\s\S]{0,600}?id="redactLine"/.test(html), '');
    /* ONE APPEARANCE, NO VARIANTS. A second colour or a heavier border for the
       "worse" case would be a verdict rendered in CSS — the same claim wearing a
       stylesheet — so the check is that no such rule exists. */
    check('...and the line has no state-dependent styling to convey anything by colour',
      !/\.redactline\[data-/.test(html) && !/data-severity/.test(rjs) && !/data-proven/.test(rjs),
      (html.match(/\.redactline\[[^\]]*\]/g) || []).join(',') || 'one appearance');
  }

  /* ---- the review step (REDACTION-CLAIM-SPEC.md §3, §8.2) ----------------
     A modal that gates the one irreversible-ish action on this page. Four
     properties, and the last is the one a sighted review never catches. */
  {
    const html = read('pages/result.html');
    const rjs = stripJsComments(read('pages/result.js'));
    const els = elements('pages/result.html');
    const dlg = els.find(e => e.attrs.id === 'reviewDlg');
    check('result.html: the review step is a labelled modal dialog',
      !!dlg && dlg.attrs.role === 'dialog' && dlg.attrs['aria-modal'] === 'true' &&
      !!dlg.attrs['aria-labelledby'],
      dlg ? 'role=' + dlg.attrs.role + ' modal=' + dlg.attrs['aria-modal'] : 'no #reviewDlg');
    check('...and the element it names as its label exists',
      !!dlg && !!els.find(e => e.attrs.id === dlg.attrs['aria-labelledby']),
      dlg ? String(dlg.attrs['aria-labelledby']) : '');
    check('...and it describes itself, so entering it says what it is about',
      !!dlg && !!dlg.attrs['aria-describedby'] &&
      dlg.attrs['aria-describedby'].split(/\s+/).filter(Boolean)
        .every(id => !!els.find(e => e.attrs.id === id)),
      dlg ? String(dlg.attrs['aria-describedby']) : '');
    check('...Escape cancels it, and Tab is trapped inside it',
      /Escape[\s\S]{0,200}?settle\(false\)/.test(rjs) && /e\.key !== 'Tab'/.test(rjs) &&
      /shiftKey/.test(rjs), '');
    /* THE HOLE THE TRAP USED TO HAVE, AND WHY IT IS GRADED HERE AS WELL AS IN A
       BROWSER. This dialog deliberately opens on its HEADING, which carries
       tabindex="-1" and is therefore not a member of the ring of focusable
       controls. A trap written only as "if you are on the first, wrap to the
       last" says nothing about an element that is neither — so Shift+Tab from
       the very place the dialog chose to open on walked out of the modal, four
       steps later reached the Delete button behind it, and Enter fired it.

       That is a dynamic fact and test/e2e/review-keyboard.mjs is what actually
       proves it, with real key events. What is graded HERE is the shape of the
       answer: the handler must decide on RING MEMBERSHIP of the focused
       element, not on equality with the two ends, because membership is the
       only test that has an answer for focus that is outside the ring
       altogether — which is also where focus is after a click on the backdrop.
       A static check cannot see the hole; it can refuse to let the branch that
       closed it be deleted. */
    check('...and the trap answers for focus that is not in its ring at all',
      /ring\.indexOf\(document\.activeElement\)/.test(rjs) &&
      /here < 0[\s\S]{0,160}?focus\(\)/.test(rjs), '');
    /* INITIAL FOCUS IS NOT ON THE PRIMARY BUTTON. A dialog that opens with the
       confirm key already armed is a dialog dismissed by an Enter the user had
       already pressed — and the whole design rests on that click meaning "I
       looked". */
    check('...and initial focus lands on the heading, never on the confirm button',
      /reviewHead[\s\S]{0,120}?focus\(\)/.test(rjs) &&
      !/reviewConfirm[\s\S]{0,60}?\.focus\(\)/.test(rjs), '');
    const head = els.find(e => e.attrs.id === 'reviewHead');
    check('...and that heading can hold focus',
      !!head && head.attrs.tabindex === '-1', head ? 'tabindex=' + head.attrs.tabindex : 'no #reviewHead');
    /* THE MARKS ARE NUMBERED, NOT COLOURED. A reader who cannot distinguish the
       outline colour still gets a numbered badge on each block and a numbered
       button that jumps to it. */
    check('...and each mark carries a number, so it is not conveyed by colour alone',
      /review-badge/.test(rjs) && /reviewMarkLabel/.test(rjs) && /review-badge/.test(html),
      '');
    /* The outline layer is decoration over an image the person is judging; the
       information is in the numbered list beside it. */
    const layer = els.find(e => e.attrs.id === 'reviewMarkLayer');
    check('...and the outline layer itself is hidden from assistive technology',
      !!layer && layer.attrs['aria-hidden'] === 'true',
      layer ? 'aria-hidden=' + layer.attrs['aria-hidden'] : 'no #reviewMarkLayer');
    /* ...AND THE JUMP CONTROL SAYS WHERE THE BLOCK IS. "Block 3" tells a
       sighted reader which outline lit up. It tells a reader who cannot see the
       outlines nothing whatever. The position is arithmetic on the mark's own
       geometry — no new stored data — and it is the difference between a list
       of three identical nouns and a description of the picture. */
    check('...and each jump control says where in the image its block is',
      /reviewMarkAt/.test(rjs) && /setAttribute\('aria-label'/.test(rjs), '');

    /* ---- CAN THE THING BEING REVIEWED ACTUALLY BE SEEN? ------------------
       The dialog fits the EXPORT to the panel, and the export is itself a
       downscale of the capture — on a page past about 3,100 px the budget
       fits the long edge to 1,568 and every glyph in it lands under half its
       captured size. Fitted into a dialog on top of that, a person confirming
       "I have looked" is looking at a grey smear. A review step that cannot
       show the thing being reviewed is theatre, and theatre is worse than
       nothing, because it moves the responsibility onto the person without
       giving them the means.

       Graded here as the two properties the markup and the source can carry;
       whether the pixels actually come out bigger is measured in a real
       browser by test/e2e/review-keyboard.mjs. */
    check('...and the preview can be magnified, not merely fitted',
      !!els.find(e => e.attrs.id === 'reviewZoomIn') &&
      !!els.find(e => e.attrs.id === 'reviewZoomOut'), '');
    check('...to a scale that undoes the export downscale',
      /plan\.srcW \/ Math\.max\(1, plan\.fit\.w\)/.test(rjs), '');
    /* THE MARKS ARE LANDMARKS, NOT THE ITINERARY. Prev/next used to jump
       between MARKS — and a mark is by definition a region FullShot already
       covered, so the tour walked a person around exactly the ground that is
       known to be safe and never once past what was missed. What was missed
       has no mark on it. The controls step through the PICTURE now, and the
       one thing that must never come back is gating them on marks existing:
       an image with no marks is the image where everything has to be judged
       by eye, because the product covered none of it. */
    check('...and the walk controls are never gated on there being marks',
      !/disabled\s*=\s*!marks\.length/.test(rjs), '');
    check('...and a readout says where in the picture the person is',
      live('pages/result.html', 'reviewPos'), '');
    /* The scroll region is a control: without a tab stop, a keyboard user can
       reach the buttons that move the picture but never the picture itself,
       and PageDown/arrow scrolling — the cheapest way there is to look — is
       unavailable to them. */
    const wrap = els.find(e => e.attrs.id === 'reviewImgWrap');
    check('...and the image region is a keyboard tab stop with a name',
      !!wrap && wrap.attrs.tabindex === '0' &&
      ((wrap.attrs['data-i18n-attr'] || '').includes('aria-label') || !!wrap.attrs['aria-label']),
      wrap ? 'tabindex=' + wrap.attrs.tabindex : 'no #reviewImgWrap');
    /* THE CONFIRM BUTTON HAS TO BE ON THE SCREEN. The number of marks is bounded
       only by the 2000-box ceiling, and one landmark control per mark pushed the
       image and the whole footer out of the panel — `test/e2e/reduction-corpus`
       records it against the `ceiling` fixture: neither Cancel nor Confirm could
       be reached by pointer. Two independent bounds, because either alone can be
       defeated by a short window: the landmark list may not grow without limit,
       and the panel scrolls rather than pushing its own footer off. */
    const rcss = stripCssComments(pageCss('pages/result.html'));
    check('...and the landmark list is bounded, so it cannot displace the image',
      /\.review-jumps\s*\{[^}]*max-height:/.test(rcss) &&
      /\.review-jumps\s*\{[^}]*overflow-y:\s*auto/.test(rcss), '');
    check('...and the panel scrolls rather than pushing its own confirm button off',
      /\.review-panel\s*\{[^}]*overflow:\s*auto/.test(rcss), '');
  }
  check('history.html: the "N screenshots" count is a live region', live('pages/history.html', 'countText'), '');
  check('options.html: the Saved pill is a live region', live('pages/options.html', 'saveNote'), '');
  check('scrollclip.html: the encoding progress line is a live region', live('pages/scrollclip.html', 'scProgress'), '');
  check('batch.html: the plan count is a live region', live('pages/batch.html', 'bqPlanCount'), '');
  check('batch.html: the progress count is a live region', live('pages/batch.html', 'bqProgressCount'), '');
  /* A live region only fires on a CHANGE. options.js used to toggle a class on
     a pill whose text never moved, which announces nothing at all — the text
     has to be written each time the pill is shown. */
  check('options.js writes the pill\'s text each save, so the region actually fires',
    /function save\([\s\S]{0,1200}?saveNote[\s\S]{0,400}?textContent\s*=/.test(stripJsLineComments(read('pages/options.js'))), '');
  /* The batch counts are re-rendered from script, and if the script keeps
     BUILDING a fresh element the declared region is orphaned — the browser is
     watching a node the page no longer uses. Naming the ids is not enough
     (the teeth pass satisfied that with the lookup line alone): the writes
     have to be there, and the old `el('div', 'bq-count', …)` construction has
     to be gone. */
  {
    const js = stripJsComments(read('pages/batch.js'));
    check('batch.js writes into the declared count regions rather than rebuilding them',
      /planCountEl\.textContent\s*=/.test(js) && /progCountEl\.textContent\s*=/.test(js) &&
      !/createElement\(\s*['"]div['"]|el\(\s*'div'\s*,\s*'bq-count'/.test(js), '');
  }
}

console.log('\n=== landmarks ===');
{
  /* One <header> and one <main> per page is the whole of it: it is what lets a
     screen reader jump past a topbar that is identical on six pages. */
  for (const p of PAGES) {
    const els = elements(p.html);
    const header = els.filter(e => e.tag === 'header');
    const main = els.filter(e => e.tag === 'main');
    /* batch.html has no topbar at all — it is a single form. */
    const wantHeader = p.html !== 'pages/batch.html';
    /* CLOSED, not merely opened. The walker records where each element ended,
       and an unbalanced landmark is worse than none: everything after the
       missing </main> is swallowed into it. The teeth pass turned one closing
       tag into a </div> and the count-only version of this check never
       noticed. */
    const ok = main.length === 1 && main[0].end >= 0 &&
      (!wantHeader || (header.length === 1 && header[0].end >= 0));
    check(p.html + ': content sits in a <main>' + (wantHeader ? ' below a <header>' : ''),
      ok, 'header=' + header.length + (header[0] && header[0].end < 0 ? ' (unclosed)' : '') +
          ' main=' + main.length + (main[0] && main[0].end < 0 ? ' (unclosed)' : ''));
  }
}

/* ============================================================================
   4. MOTION
   ==========================================================================*/
console.log('\n=== prefers-reduced-motion ===');
{
  const MOVES = /(?:^|[;{\s])(?:transition|animation)\s*:\s*(?!none)/;
  for (const p of PAGES) {
    const own = stripCssComments(pageCss(p.html));
    const moves = MOVES.test(own) || (p.common && MOVES.test(commonCss));
    const answered = /@media[^{]*prefers-reduced-motion:\s*reduce/.test(own) ||
      (p.common && /@media[^{]*prefers-reduced-motion:\s*reduce/.test(commonCss));
    check(p.html + (moves ? ': its motion is answered by a reduce query' : ': declares no motion'),
      !moves || answered, moves ? '' : 'nothing to reduce');
  }
  const block = commonCss.slice(commonCss.indexOf('prefers-reduced-motion'));
  check('the reduce block neutralises transitions and animations wholesale',
    /transition-duration:\s*[\d.]+m?s\s*!important/.test(block) &&
    /animation-duration:\s*[\d.]+m?s\s*!important/.test(block), '');
  /* Freezing the spinner is the wrong answer: it is the only thing on the page
     that says work is still happening, and a still ring says the opposite.
     Reduced motion means less motion, not a lie. */
  check('...but the busy spinner is slowed rather than stopped',
    /\.spin\s*\{[^}]*animation-duration:\s*[\d.]+s\s*!important/.test(block), '');
}

/* ============================================================================
   5. REFLOW — 200% zoom, and 55 locales' worth of word length
   ==========================================================================*/
console.log('\n=== reflow at 200% zoom and under a long translation ===');
{
  /* The two side rails are the only fixed-width columns left in the product.
     At 200% zoom a 1280px window is 640 CSS px, and a 300px rail beside a
     canvas is most of it; the rail has to be able to stop being a rail. */
  for (const file of ['pages/beautify.html', 'pages/scrollclip.html']) {
    const css = stripCssComments(pageCss(file));
    const bp = css.slice(css.search(/@media[^{]*max-width/));
    check(file + ': the fixed side rail stacks at a narrow width',
      /@media[^{]*max-width/.test(css) && /\.controls\s*\{[^}]*width:\s*auto/.test(bp),
      /@media[^{]*max-width/.test(css) ? '' : 'no breakpoint');
    check(file + ': ...and the page may scroll once it has stacked',
      /body\s*\{[^}]*overflow:\s*auto/.test(bp), '');
    /* "Einzelbild kopieren", "பதிவிறக்கம்", "Kuvakaappaus" — a rail button that
       may not wrap is a rail button that overflows its rail. */
    check(file + ': rail buttons may wrap their label',
      !/\.seg\s+button\s*\{[^}]*white-space:\s*nowrap/.test(css), '');
    check(file + ': ...and the rail itself never paints outside its own box',
      /\.controls\s*\{[^}]*overflow:\s*auto/.test(css), '');
  }
  /* options.html's save pill is position:fixed, so nothing reflows it — at
     200% zoom a long translation simply runs off the edge unless it is capped. */
  check('options.html: the Saved pill is capped so a long translation wraps instead of leaving the page',
    /#saveNote\s*\{[^}]*max-width:/.test(stripCssComments(pageCss('pages/options.html'))), '');
}

console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
process.exit(FAILS ? 1 : 0);
