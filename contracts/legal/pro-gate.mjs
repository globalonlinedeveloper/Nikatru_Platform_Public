// ─────────────────────────────────────────────────────────────────────────────
// pro-gate.mjs — which paragraphs of a legal Markdown source are published.
//
// ⏱ 2026-09-25 (EXT-4, coordinator decision Q2). FullShot Pro text renders on
// the privacy page only when FullShot TRANSMITS (tool.json
// policy.networkAllowlist is non-empty) or SELLS (app-config-data holds a
// recurring offering for it) — the same two facts, read by the same functions,
// that gate the store listings (extensions/scripts/render-listing.mjs).
//
// A paragraph opts in with a directive on the line above it:
//
//     <!-- render: when=pro -->       published only while FullShot transmits or sells
//     <!-- render: when=sells -->     published only while it sells (a recurring offering)
//     <!-- render: class=lead when=free -->   published only while it does neither
//
// Both readers of the Markdown call dropGated() first — the renderer
// (render-fullshot-privacy.mjs) and the parity guard
// (tooling/ci/assert-legal-text-parity.mjs) — so a paragraph that is not
// published is absent from BOTH sides of the comparison, and one that is
// published is compared like any other. The `when=` key is removed from a kept
// directive, so neither reader has to know it exists.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FULLSHOT_TOOL_REL = 'extensions/Extension/Full_Screen_Shot/tool.json';
export const APP_CONFIG_REL = 'services/platform/src/app-config-data.json';
const RECURRING = new Set(['month', 'year']);

/** A tool TRANSMITS when its policy allows it to reach any network destination.
 *  The ONE definition: extensions/scripts/render-listing.mjs imports it. */
export function transmits(toolRaw) {
  const allow = toolRaw?.policy?.networkAllowlist;
  return Array.isArray(allow) && allow.length > 0;
}

/** The recurring offerings app-config-data holds for a tool id. A `one_time`
 *  offering is never read (ADR 093). */
export function recurringOfferings(appConfig, id) {
  const offers = appConfig?.apps?.[id]?.paywall?.offerings;
  return Array.isArray(offers) ? offers.filter((o) => o && RECURRING.has(o.term)) : [];
}

/** { pro, transmits, sells } for FullShot, read from the tree (or the paths given). */
export function fullshotPro(root, { toolJson, appConfig } = {}) {
  const toolAbs = toolJson || join(root, FULLSHOT_TOOL_REL);
  const cfgAbs = appConfig || join(root, APP_CONFIG_REL);
  if (!existsSync(toolAbs)) throw new Error(`${toolAbs} does not exist, so whether FullShot transmits cannot be decided`);
  if (!existsSync(cfgAbs)) throw new Error(`${cfgAbs} does not exist, so whether FullShot sells cannot be decided`);
  const tool = JSON.parse(readFileSync(toolAbs, 'utf8'));
  const cfg = JSON.parse(readFileSync(cfgAbs, 'utf8'));
  const t = transmits(tool);
  const s = recurringOfferings(cfg, tool.id).length > 0;
  return { pro: t || s, transmits: t, sells: s };
}

const DIRECTIVE = /^(<!--\s*render:\s*)(.*?)(\s*--!?>)$/;

/** The Markdown with every gated-off paragraph (directive + its lines) removed.
 *  `gate` is fullshotPro()'s result: `{ pro, sells }`. */
export function dropGated(md, gate) {
  const { pro, sells } = gate ?? {};
  if (typeof pro !== 'boolean' || typeof sells !== 'boolean') {
    throw new Error('dropGated needs { pro, sells } as booleans, got ' + JSON.stringify(gate));
  }
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DIRECTIVE.exec(lines[i]);
    const when = m && /(?:^|\s)when=(pro|sells|free)(?=\s|$)/.exec(m[2]);
    if (!when) { out.push(lines[i]); continue; }
    const on = when[1] === 'pro' ? pro : when[1] === 'sells' ? sells : !pro;
    if (on) {
      const rest = m[2].replace(/(?:^|\s)when=(?:pro|sells|free)(?=\s|$)/, '').trim();
      if (rest) out.push(m[1] + rest + m[3]);
      continue;
    }
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
  }
  return out.join('\n');
}
