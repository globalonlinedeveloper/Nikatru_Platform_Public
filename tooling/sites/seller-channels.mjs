#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seller-channels.mjs — the legal pages' list of WHERE a rail sells, generated
// from tooling/channel-register.json instead of typed into three pages.
//
// ⏱ 2026-10-03 · rv2-business 021. terms.html
// said Paddle is the seller for "our direct downloads for Windows, macOS and Linux",
// refund.html for "our Windows, macOS and Linux downloads", privacy.html for "our
// direct downloads". The register says otherwise: `windows-direct` is ruled out by
// C-WINDOWS-STORE-ONLY (`deferral.ruledOutBy`), and no macOS direct-download channel
// exists at all. Three pages, three hand-typed lists, and the register they described
// was the one place the answer was kept. Each page now carries the list between
//     <!-- SELLER-CHANNELS:<rail> --> … <!-- /SELLER-CHANNELS:<rail> -->
// and the text between them is RENDERED here from the register's rows whose
// `purchaseRail.rail` is that rail and which carry no `deferral.ruledOutBy`.
//
// WHO READS IT. tooling/ci/assert-policy-claims.mjs §3b: a `seller-by-rail` row in
// tooling/legal/policy-claims.json that carries `channelList: true` requires each of
// its pages to hold exactly one block for its rail, equal to `renderChannelList`.
// A ruled-out channel typed into a block, or a channel added to the rail without
// re-rendering, FAILS there.
//
// ⚠️ THE PHRASES ARE LEGAL COPY, so they are written out per channel id in
// LEGAL_PHRASES below rather than derived from the register's `name` (which says
// "Web (Cloudflare Pages, app subdomain)"). A channel the rail sells on that has no
// phrase is a finding, never a silent omission: the list would be short by one
// channel and read as complete.
//
// Usage:  node tooling/sites/seller-channels.mjs [--write] [repoRoot]
//   default: check, exit 1 on any page whose block differs; --write re-renders.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How a legal page names a channel. Keyed by tooling/channel-register.json `id`. */
export const LEGAL_PHRASES = Object.freeze({
  web: 'this website',
  'windows-store': 'the Microsoft Store',
  'windows-direct': 'our Windows download',
  'linux-snap': 'the Snap Store',
  'linux-appimage': 'our Linux download (AppImage)',
  'chrome-webstore': 'the Chrome Web Store',
  'edge-addons': 'Microsoft Edge Add-ons',
  amo: 'Firefox Add-ons',
});

export const openMarker = (rail) => `<!-- SELLER-CHANNELS:${rail} -->`;
export const closeMarker = (rail) => `<!-- /SELLER-CHANNELS:${rail} -->`;

/** The channels a rail sells on: `purchaseRail.rail === rail`, not ruled out.
 *  Returns `{ channels, ruledOut, unphrased }`, register order. */
export function channelsOnRail(channelReg, rail) {
  const rows = Array.isArray(channelReg?.channels) ? channelReg.channels : [];
  const onRail = rows.filter((c) => c?.purchaseRail?.rail === rail);
  const ruledOut = onRail.filter((c) => typeof c?.deferral?.ruledOutBy === 'string').map((c) => c.id);
  const channels = onRail.filter((c) => !ruledOut.includes(c.id)).map((c) => c.id);
  const unphrased = channels.filter((id) => !Object.prototype.hasOwnProperty.call(LEGAL_PHRASES, id));
  return { channels, ruledOut, unphrased };
}

/** "a", "a and b", "a, b and c". */
const joinList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The text a page carries between the markers for `rail`, or null when a channel
 *  on the rail has no phrase (the caller reports `unphrased`). */
export function renderChannelList(channelReg, rail) {
  const { channels, unphrased } = channelsOnRail(channelReg, rail);
  if (unphrased.length || channels.length === 0) return null;
  return joinList(channels.map((id) => LEGAL_PHRASES[id]));
}

/** Every block for `rail` in `html`: the raw text between the markers. */
export function blocksIn(html, rail) {
  const re = new RegExp(`${escapeRe(openMarker(rail))}([\\s\\S]*?)${escapeRe(closeMarker(rail))}`, 'g');
  return [...html.matchAll(re)].map((m) => m[1]);
}
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `html` with every block for `rail` replaced by `text`. */
export function rewriteBlocks(html, rail, text) {
  const re = new RegExp(`(${escapeRe(openMarker(rail))})[\\s\\S]*?(${escapeRe(closeMarker(rail))})`, 'g');
  return html.replace(re, (_, a, b) => `${a}${text}${b}`);
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const root = resolve(argv.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const channelReg = JSON.parse(readFileSync(join(root, 'tooling', 'channel-register.json'), 'utf8'));
  const claims = JSON.parse(readFileSync(join(root, 'tooling', 'legal', 'policy-claims.json'), 'utf8'));
  const siteRoot = join(root, ...String(claims.siteRoot ?? 'sites/nikatru').split('/'));
  const rows = (claims.claims ?? []).filter((r) => r?.type === 'seller-by-rail' && r.channelList === true);
  if (rows.length === 0) {
    console.error('✗ COVERAGE LOST — no seller-by-rail row in tooling/legal/policy-claims.json carries `channelList: true`, so no page list was rendered.');
    process.exit(2);
  }
  const drift = [];
  for (const row of rows) {
    const text = renderChannelList(channelReg, row.rail);
    if (text === null) {
      const { unphrased } = channelsOnRail(channelReg, row.rail);
      console.error(`✗ rail ${row.rail}: ${unphrased.length ? `channel(s) ${unphrased.join(', ')} have no entry in LEGAL_PHRASES` : 'sells on no channel'} — nothing rendered.`);
      process.exit(1);
    }
    for (const page of row.pages) {
      const abs = join(siteRoot, page);
      const html = readFileSync(abs, 'utf8');
      const blocks = blocksIn(html, row.rail);
      if (blocks.length !== 1) {
        drift.push(`${page}: ${blocks.length} ${openMarker(row.rail)} block(s); exactly one is required (add the markers by hand, once).`);
        continue;
      }
      if (blocks[0] === text) continue;
      if (write) writeFileSync(abs, rewriteBlocks(html, row.rail, text));
      else drift.push(`${page}: the ${row.rail} block reads "${blocks[0]}"; the register renders "${text}".`);
    }
  }
  if (drift.length) {
    for (const d of drift) console.error(`✗ ${d}`);
    console.error('  Re-render with: node tooling/sites/seller-channels.mjs --write');
    process.exit(1);
  }
  console.log(`ok  seller channels — ${rows.map((r) => `${r.rail}: ${r.pages.length} page(s)`).join(' · ')}${write ? ' (written)' : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
