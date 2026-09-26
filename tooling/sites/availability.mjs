// ─────────────────────────────────────────────────────────────────────────────
// availability.mjs — the ONE rendering of "where can you get this app", built
// from tooling/channel-register.json ∩ catalog/apps.json `listings` and from
// nothing else.
//
// 🔴 THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE. Every store-badge row on every
// marketing site in the world starts as hand-written markup, and hand-written
// markup cannot be wrong in a way anybody notices — it can only be STALE. The
// design canvas that specified this component shipped a placeholder that built
// its tiles by slicing a hand-ordered array and marking the first N live, and on
// the real data that rendered **"App Store" as LIVE when the only live channel
// is `web`**. A false availability claim on a page that also hosts the store-
// required legal pages is the worst class of copy this site can carry.
//
// So: no badge row is ever written by hand, the order comes from the register,
// the state comes from the catalogue, and **the count is the length of a list**.
// `tooling/ci/assert-availability.mjs` fails the build if any served page grows
// a hand-written one.
//
// ── DERIVATION LIVES NEXT DOOR, ON PURPOSE ───────────────────────────────────
// `availabilityRow` is in tooling/ci/channel-arming.mjs, which is this
// repository's ONE reading of "does the register say this channel can reach a
// user today" (see its NOT_A_SCANNER entry in assert-guard-coverage.mjs). This
// file is PRESENTATION only — it decides nothing about state and cannot, because
// it is handed the verdicts. Splitting them is what lets the release seams and
// the website disagree about nothing.
//
// ⚠️ WHERE THIS DELIBERATELY DEPARTS FROM THE CANVAS, and it is a truth fix.
// The canvas's third state reads "Submitted for review". `submittable: true`
// means THE FACTORY HAS A REPEATABLE SUBMISSION PATH — it does not mean anything
// has been submitted, and on 2026-09-09 nothing had been. Printing "Submitted
// for review" under five channels would be a false claim of the same family as
// the "App Store is live" one above. The state label is "Coming soon", which is
// what the register actually supports.
//
// ⚠️ AND THERE IS NO FACTS LINE UNLESS FACTS ARE SUPPLIED. Version, download size
// and minimum OS are the "boring facts under the button" the research ranks as
// disproportionately credible — and NONE of them exists in any file in this
// repository today. The renderer takes them as an optional per-channel argument
// and omits the line entirely when they are absent. It does NOT emit
// "[SIZE] MB": a bracketed placeholder is fine on a design canvas and is a
// defect on a served page, because nothing ever fails on it.
// ─────────────────────────────────────────────────────────────────────────────
import { availabilityRow } from '../ci/channel-arming.mjs';
// The ONE HTML escape that is already exported for reuse. tooling/sites/
// generate-discovery.mjs carries a file-local copy of the same four rules; a
// third would be the shipped-copy shape this repository keeps deleting.
import { esc } from '../app-yaml/render-privacy.mjs';

export { availabilityRow };

/**
 * The user-facing label for a channel, DERIVED from the register's own `name`
 * and never from a map in this file.
 *
 * A hardcoded `{ 'ios-appstore': 'App Store' }` table is the same defect as a
 * hardcoded badge row, one level down: it goes stale silently and it lets a
 * channel be renamed on the page without being renamed in the register. So the
 * only transformation applied is dropping a TRAILING PARENTHETICAL, and only
 * when doing so leaves a label that is still unique among the tiles being
 * rendered. Measured against the register on 2026-09-09:
 *
 *   "Web (Cloudflare Pages, app subdomain)"        → "Web"          (unique)
 *   "apps.gov.in (Mobile Seva AppStore, Govt…)"    → "apps.gov.in"  (unique)
 *   "Apple App Store (iOS)"                        → unchanged, because
 *   "Apple App Store (macOS)"                      → unchanged: stripping both
 *                                                    collides, and two tiles
 *                                                    reading "Apple App Store"
 *                                                    is worse than a long label
 *
 * If the owner wants shorter storefront names than the register's descriptions,
 * the fix is a `storefrontLabel` field ON THE REGISTER ROW — one line of data,
 * read here — not a table in this file.
 */
export function channelLabels(tiles) {
  const shortOf = (name) => {
    const m = /^(.*?)\s*\([^()]*\)\s*$/.exec(name);
    const short = m ? m[1].trim() : name;
    return short === '' ? name : short;
  };
  const shorts = tiles.map((t) => shortOf(t.name));
  const counts = new Map();
  for (const s of shorts) counts.set(s, (counts.get(s) ?? 0) + 1);
  return tiles.map((t, i) => (counts.get(shorts[i]) === 1 ? shorts[i] : t.name));
}

/**
 * How many columns the tile grid uses for `n` tiles — BALANCED, capped at four.
 *
 * 🔴 THIS EXISTS BECAUSE THE CANVAS'S STATED MECHANIC DOES NOT HOLD. The design
 * spec says the tiles are `flex: 1 1 200px; max-width: 252px` and that seven
 * "wrap 4 + 3 … filling the 1032px measure with no ragged gap". Worked through
 * on the real measure (1080px container − 48px gutters = 1032px, 12px gaps):
 *
 *   row 1 fits 4 tiles (4×200 + 3×12 = 836 ≤ 1032), which then stretch to 249px
 *   row 2 holds the remaining 3, each capped at 252px = 780px
 *   → a 252px hole at the end of row 2, and at SIX tiles (today's real count)
 *     a 4 + 2 split leaving a ~500px hole
 *
 * A wrap cannot balance rows, because flex-wrap greedily fills each line. The
 * fix is to let the GENERATOR pick the column count — it is the only party that
 * knows how many tiles there are — and to cap the grid's own width so the tiles
 * fill it exactly. The count is still derived from the register; nothing is
 * typed. Measured results:
 *
 *   1 tile  → 1 column, grid capped at 252px  → one tile at its cap, left-aligned
 *   6 tiles → 3 columns, grid capped at 780px → 3 + 3, every cell filled
 *   7 tiles → 4 columns, grid capped at 1032px → 4 + 3, one aligned empty cell
 *
 * @param {number} n the number of tiles
 * @returns {number} 1–4
 */
export function availabilityColumns(n) {
  if (!Number.isFinite(n) || n <= 1) return 1;
  if (n <= 4) return n;
  return Math.ceil(n / Math.ceil(n / 4));
}

/** The one-line count under the heading. Both numbers are list lengths. */
export function availabilitySummary({ shown, live }) {
  if (shown === 0) return 'No channel is published for this app yet.';
  const chan = shown === 1 ? 'channel' : 'channels';
  return `${live} of ${shown} ${chan} live`;
}

/**
 * Render the availability row.
 *
 * @param {object[]} rows      the register's `channels` array
 * @param {object}   listings  the app's `listings` block
 * @param {object}   o
 * @param {string}   o.heading      the section heading text
 * @param {string}   o.headingId    id the section is labelled by
 * @param {object}   o.facts        optional `{ [channelId]: 'version · size · min OS' }`.
 *                                  A channel with no entry renders no facts line.
 * @returns {{ html: string, shown: number, live: number, lost: string[] }}
 *   `lost` is COVERAGE LOST raised to the caller — a renderable register row the
 *   catalogue has no opinion about at all. The caller PRINTS and REFUSES; this
 *   file does not exit, because a renderer that calls process.exit cannot be
 *   tested and cannot be reused.
 */
export function renderAvailability(rows, listings, { heading = 'Available on', headingId = 'availability', facts = {} } = {}) {
  const row = availabilityRow(rows, listings);
  const labels = channelLabels(row.tiles);

  const items = row.tiles.map((t, i) => {
    const label = labels[i];
    const fact = typeof facts?.[t.id] === 'string' && facts[t.id].trim() !== '' ? facts[t.id].trim() : null;

    // 🔴 THE STATE IS IN THE TEXT, NOT ONLY IN THE COLOUR. WCAG 1.4.1: a tile
    // whose only difference is a teal square versus a dashed one conveys its
    // meaning by colour and shape alone. Every non-live tile says "Coming soon"
    // in words, and every live tile is the only kind that is a link — so the
    // state survives a screen reader, a monochrome display and forced colors.
    const stateText = t.state === 'live' ? null : 'Coming soon';
    const lines = [];
    if (stateText) lines.push(`<span class="avail-state">${esc(stateText)}</span>`);
    if (fact) lines.push(`<span class="avail-facts">${esc(fact)}</span>`);
    const body =
      `<span class="avail-top">` +
      `<span class="mark mark-${t.state === 'live' ? 'served' : 'soon'}" aria-hidden="true"></span>` +
      `<span class="avail-name">${esc(label)}</span>` +
      `</span>` +
      (lines.length ? `<span class="avail-meta">${lines.join('')}</span>` : '');

    // A "coming soon" tile is NOT a link and NOT a disabled link. There is no
    // destination, so there is nothing for a keyboard or a screen reader to
    // land on, and a focusable element that does nothing is a 2.4.3 trap in
    // waiting. Both states wrap their content in `.avail-inner` so ONE rule set
    // pads and lays out the tile — a live tile styled through `a` and a soon
    // tile styled through `li` is how the two drift apart by a pixel.
    return t.state === 'live'
      ? `      <li class="avail-tile is-live"><a class="avail-inner" href="${esc(t.url)}">${body}</a></li>`
      : `      <li class="avail-tile is-soon"><span class="avail-inner">${body}</span></li>`;
  });

  const html =
    `  <section class="avail" aria-labelledby="${esc(headingId)}">\n` +
    `    <div class="avail-head">\n` +
    `      <h2 id="${esc(headingId)}">${esc(heading)}</h2>\n` +
    `      <p class="avail-count fig">${esc(availabilitySummary(row))}</p>\n` +
    `    </div>\n` +
    (items.length
      ? `    <ul class="avail-tiles" style="--avail-cols:${availabilityColumns(row.shown)}">\n${items.join('\n')}\n    </ul>\n`
      : '') +
    `  </section>`;

  return { html, shown: row.shown, live: row.live, lost: row.lost };
}

/**
 * THE COMPONENT'S CSS, exported as a string so the page that renders the row
 * INLINES it.
 *
 * 🔴 WHY INLINE AND NOT A SERVED STYLESHEET. The obvious move is to link
 * `/assets/availability.css`, and it is the wrong one for this site. Measured
 * 2026-09-09: nikatru.com is ONE 34 KB document with zero external CSS or JS,
 * system fonts and TTFB ~0.57 s. The audience is a mid-range Android on 4G
 * (~65% of Indian mobile users are not on 5G), where the binding constraint is
 * round trips and main-thread time, not bytes. A stylesheet for a component that
 * appears once costs an extra RTT on the critical path to save ~1 KB — that
 * trades an LCP regression for a tidiness win. The site also has NO BUILD STEP
 * (Cloudflare serves the repo directly), so "one shared stylesheet" would have
 * to be a served file anyway.
 *
 * One source, inlined at generation time, is therefore both the fastest and the
 * only no-build shape. This constant is that source; nothing hand-writes these
 * rules into a page.
 *
 * ⚠️ EVERY COLOUR HERE IS A TOKEN, never a hex. The palette lives in
 * contracts/tokens/dtcg/ and reaches a page through its `:root` block. A literal
 * hex in this string would be a second visual language, and it would be the one
 * that does not follow `prefers-color-scheme` — which is exactly how the design
 * canvas ended up with light-mode hexes that collapse to 1.5:1 in dark.
 */
export const AVAILABILITY_CSS = `
  .avail-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 16px}
  .avail-head h2{margin:0}
  .avail-count{margin:0;color:var(--muted);font-variant-numeric:tabular-nums}
  /* THE LAYOUT MECHANIC. \`--avail-cols\` is written by the generator from the
     tile count (see availabilityColumns) and the grid is capped to exactly the
     width those columns need, so the tiles FILL it instead of leaving a hole:
       1 tile  → 1 col, 252px  · 6 tiles → 3 cols, 780px (3+3, no gap)
       7 tiles → 4 cols, 1032px (4+3, one aligned empty cell)
     A flex-wrap cannot do this — it fills each line greedily, which is what
     leaves a ~500px hole at six tiles. Every tile shares a min-height so rows
     align whatever the label length. */
  .avail-tiles{display:grid;grid-template-columns:repeat(var(--avail-cols,3),1fr);gap:12px;list-style:none;margin:0;padding:0;max-width:calc(var(--avail-cols,3) * 252px + (var(--avail-cols,3) - 1) * 12px)}
  .avail-tile{min-height:78px;border-radius:12px;display:flex}
  .avail-inner{display:flex;flex-direction:column;gap:6px;justify-content:center;flex:1;padding:14px 16px;text-decoration:none;color:inherit}
  .avail-tile.is-live{border:1px solid var(--line);background:var(--card)}
  .avail-tile.is-live .avail-inner:hover{text-decoration:none}
  .avail-tile.is-live:hover{border-color:var(--muted)}
  /* The third state: dashed border on a transparent ground, muted label, no
     link. It occupies the SAME grid slot as a live tile, so the block does not
     reflow the day a channel goes live. */
  .avail-tile.is-soon{border:1px dashed var(--line);background:transparent;color:var(--muted)}
  .avail-top{display:flex;align-items:center;gap:9px}
  .avail-name{font-family:var(--font-display,inherit);font-weight:600;color:var(--strong);line-height:1.25}
  .avail-tile.is-soon .avail-name{color:var(--muted)}
  .avail-meta{display:flex;flex-direction:column;gap:2px;font-size:var(--type-sm,13.5px);color:var(--muted);padding-left:18px}
  /* The mark rules (.mark, .mark-served, .mark-soon) are NOT declared here. That is the
     STATUS MARK - the design one status device - and it appears in two
     densities: labelled, inside these tiles, and bare, in the homepage register
     row beside "1 of 6 channels live". Two densities of one mark must not be two
     rule sets: they would drift by a pixel and by a colour, and no guard could
     see it, because a CSS rule is not a custom property and the palette guard
     compares only custom properties. So the mark is MARK_CSS in tooling/sites/
     chrome.mjs, emitted once as the shared marks-css region onto every page. */
  /* The generator's column count is a DESKTOP answer; below the collapse points
     the viewport decides instead, and the cap is released so a tile fills the
     width rather than leaving a 252px column against a 358px screen. */
  @media (max-width:860px){ .avail-tiles{grid-template-columns:repeat(2,1fr);max-width:none} }
  @media (max-width:520px){ .avail-tiles{grid-template-columns:1fr} }
`;
