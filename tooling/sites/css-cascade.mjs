// ─────────────────────────────────────────────────────────────────────────────
// css-cascade.mjs — what an inline <style> block ACTUALLY resolves to, per
// colour scheme and viewport, and the contrast of the pairs a page declares.
//
// 🔴 THE DEFECT THIS EXISTS FOR (rajasekarselvam.com audit, 2026-10-02, §2.8).
// The contact button's dark-mode override
//     @media (prefers-color-scheme: dark){ .mail{background:linear-gradient(…)} }
// sat ABOVE the base rule `.mail{background:var(--ink)…}`. Same selector, same
// specificity, so the LATER base rule won and the override never applied: in
// dark mode the page's most important call to action rendered as bare text on
// a background the colour of the page. The #572 contrast method measured the
// foreground/background pairs DECLARED IN ONE RULE, so it read the override's
// gradient as the button's background and passed it — a measurement of a rule
// the browser never used. And had the cascade been fixed as written, white on
// that gradient measures 2.24–2.69:1, a failure nobody had measured either.
//
// So this module answers both halves from the cascade, never from one rule:
//   · `deadDeclarations` — every declaration inside a colour-scheme block that a
//     LATER same-selector declaration of the same property overrides in that
//     scheme. A scheme override that cannot win is the declaration-order loss,
//     whatever colours it names.
//   · `contrastFindings` — each declared pair resolved through the cascade (the
//     winning declaration, its var() chain, every gradient stop, any alpha
//     composited over the declared backdrop) in each scheme, against a floor.
//
// ── WHAT IT MODELS, AND WHAT IT REFUSES TO PRETEND ───────────────────────────
// Specificity is NOT computed. Two rules compete here only when their selector
// text is IDENTICAL, which is exactly the case where source order decides and
// specificity cannot. A pair whose winner depends on specificity between
// different selectors is outside this model, and the caller names its pairs by
// the selector that paints them. `@media` is evaluated for the features these
// pages use — prefers-color-scheme, min-/max-width, prefers-reduced-motion
// (never reduced: the default experience is the one graded) — and a query with
// any other feature is treated as NOT matching and reported in `unknownMedia`,
// so a rule this model cannot place is visible rather than silently applied.
// ─────────────────────────────────────────────────────────────────────────────

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The text of every inline <style> element in `html`, joined in source order. */
export function inlineCss(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
}

/** Split `a,b , c` on top-level commas (none of these selectors nest parens with commas). */
const splitSelectors = (prelude) => prelude.split(',').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

function parseDecls(body) {
  const decls = [];
  for (const raw of body.split(';')) {
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const prop = raw.slice(0, i).trim().toLowerCase();
    let value = raw.slice(i + 1).trim();
    if (!prop || !value) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    decls.push({ prop, value, important });
  }
  return decls;
}

/**
 * Every style rule in `css`, in source order, as
 * `{ selectors, decls: [{prop, value, important}], media: string|null, order }`.
 * One level of `@media` nesting is read; any other at-rule body is skipped.
 */
export function parseRules(css) {
  const src = stripComments(css);
  const rules = [];
  let order = 0;
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      // find the matching close brace
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (/^@media\b/i.test(prelude)) {
        const q = prelude.replace(/^@media\s*/i, '').trim();
        walk(body, media ? `${media} and ${q}` : q);
      } else if (prelude.startsWith('@')) {
        // @keyframes, @supports …: not style rules this model places
      } else if (prelude) {
        rules.push({ selectors: splitSelectors(prelude), decls: parseDecls(body), media, order: order++ });
      }
      i = j;
    }
  };
  walk(src, null);
  return rules;
}

/**
 * Does `media` match the context `{ scheme: 'light'|'dark', width: number }`?
 * Returns `null` for a query naming a feature this model does not evaluate.
 */
export function mediaMatches(media, { scheme = 'light', width = 1280 } = {}) {
  if (media === null) return true;
  const parts = media.split(/\band\b/i).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = /^\(?\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)?$/i.exec(part);
    if (!m) {
      if (/^(screen|all)$/i.test(part)) continue;
      return null;
    }
    const [, feature, value] = m;
    const f = feature.toLowerCase();
    if (f === 'prefers-color-scheme') { if (value.trim().toLowerCase() !== scheme) return false; continue; }
    if (f === 'prefers-reduced-motion') { if (value.trim().toLowerCase() !== 'no-preference') return false; continue; }
    const px = /^(\d+(?:\.\d+)?)px$/i.exec(value.trim());
    if ((f === 'max-width' || f === 'min-width') && px) {
      const n = Number(px[1]);
      if (f === 'max-width' ? width > n : width < n) return false;
      continue;
    }
    return null;
  }
  return true;
}

/** `background-color` and `background` paint the same thing; one cascade slot. */
const slotOf = (prop) => (prop === 'background-color' ? 'background' : prop);

/**
 * The winning declaration of `prop` for the exact selector text `selector`, in
 * `ctx`. Later wins; `!important` beats normal. Null when nothing declares it.
 */
export function winning(rules, selector, prop, ctx) {
  const slot = slotOf(prop);
  let best = null;
  for (const r of rules) {
    if (!r.selectors.includes(selector)) continue;
    if (mediaMatches(r.media, ctx) !== true) continue;
    for (const d of r.decls) {
      if (slotOf(d.prop) !== slot) continue;
      if (best && best.important && !d.important) continue;
      best = { ...d, order: r.order, media: r.media };
    }
  }
  return best;
}

/** Every custom property `:root` resolves to in `ctx`. */
export function customProps(rules, ctx) {
  const out = new Map();
  for (const r of rules) {
    if (!r.selectors.includes(':root')) continue;
    if (mediaMatches(r.media, ctx) !== true) continue;
    for (const d of r.decls) if (d.prop.startsWith('--')) out.set(d.prop, d.value);
  }
  return out;
}

/** `value` with every var() substituted from `vars` (fallbacks honoured). */
export function resolveVars(value, vars, depth = 0) {
  if (depth > 10) return value;
  const re = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/;
  let out = value;
  let m;
  while ((m = re.exec(out))) {
    const sub = vars.has(m[1]) ? vars.get(m[1]) : (m[2] ?? '').trim();
    out = out.slice(0, m.index) + resolveVars(sub, vars, depth + 1) + out.slice(m.index + m[0].length);
  }
  return out;
}

/** Every colour named in a resolved value, as `{r,g,b,a}` (0–255, alpha 0–1). */
export function colours(value) {
  const out = [];
  for (const m of value.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(([^)]*)\)|\b(white|black|transparent)\b/gi)) {
    if (m[1]) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map((c) => c + c).join('');
      out.push({ r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 });
    } else if (m[2] !== undefined) {
      const p = m[2].split(/[\s,/]+/).filter(Boolean).map(Number);
      out.push({ r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 });
    } else {
      const w = m[3].toLowerCase();
      out.push(w === 'white' ? { r: 255, g: 255, b: 255, a: 1 } : w === 'black' ? { r: 0, g: 0, b: 0, a: 1 } : { r: 0, g: 0, b: 0, a: 0 });
    }
  }
  return out;
}

/** `top` composited over the opaque `under`. */
export const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** WCAG 2.x contrast ratio of two opaque colours. */
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const hex = ({ r, g, b }) => `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/**
 * Declarations inside a colour-scheme block that never win in that scheme,
 * because a later declaration of the same property for the same selector text
 * overrides them. `[{selector, prop, media, scheme}]`.
 */
export function deadDeclarations(rules, { width = 1280 } = {}) {
  const dead = [];
  for (const r of rules) {
    if (!r.media || !/prefers-color-scheme/i.test(r.media)) continue;
    for (const scheme of ['light', 'dark']) {
      const ctx = { scheme, width };
      if (mediaMatches(r.media, ctx) !== true) continue;
      for (const sel of r.selectors) {
        for (const d of r.decls) {
          const w = winning(rules, sel, d.prop, ctx);
          if (w && w.order !== r.order) dead.push({ selector: sel, prop: d.prop, media: r.media, scheme, lostTo: w.value });
        }
      }
    }
  }
  return dead;
}

/**
 * Grade each declared pair in both schemes.
 *
 * A pair is `{ label, fg: {selector, prop}, bg: {selector, prop} | {value},
 * backdrop: string, min }`: the foreground colour is the winning `fg.prop` of
 * `fg.selector`; the background is the winning `bg.prop` of `bg.selector`, or a
 * fixed `bg.value`; every gradient stop is graded and the worst is reported;
 * any translucent colour is composited over `backdrop` (itself resolved).
 *
 * @returns {{findings: string[], graded: Array<{label, scheme, ratio}>}}
 */
export function contrastFindings(rules, pairs, { width = 1280 } = {}) {
  const findings = [];
  const graded = [];
  for (const scheme of ['light', 'dark']) {
    const ctx = { scheme, width };
    const vars = customProps(rules, ctx);
    const read = (spec) => {
      if (spec.value !== undefined) return resolveVars(spec.value, vars);
      const w = winning(rules, spec.selector, spec.prop, ctx);
      return w ? resolveVars(w.value, vars) : null;
    };
    for (const p of pairs) {
      const fgText = read(p.fg);
      const bgText = read(p.bg);
      const backdrop = colours(resolveVars(p.backdrop ?? '#FFFFFF', vars))[0] ?? { r: 255, g: 255, b: 255, a: 1 };
      const fgs = fgText ? colours(fgText) : [];
      const bgs = bgText ? colours(bgText) : [];
      if (!fgs.length || !bgs.length) {
        findings.push(`${p.label} (${scheme}): the cascade resolves no colour for the ${!fgs.length ? 'foreground' : 'background'} (${!fgs.length ? fgText : bgText}), so the pair cannot be graded`);
        continue;
      }
      let worst = Infinity;
      let at = null;
      for (const b of bgs) {
        const bgc = over(b, backdrop);
        for (const f of fgs) {
          const r = contrast(over(f, bgc), bgc);
          if (r < worst) { worst = r; at = { f: over(f, bgc), b: bgc }; }
        }
      }
      graded.push({ label: p.label, scheme, ratio: worst });
      if (worst < p.min) {
        findings.push(`${p.label} (${scheme}): ${worst.toFixed(2)}:1 (${hex(at.f)} on ${hex(at.b)}), under the ${p.min}:1 floor`);
      }
    }
  }
  return { findings, graded };
}
