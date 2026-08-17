/**
 * Nikatru brand tokens - Style Dictionary v5 configuration.
 *
 * SCOPE: THE WEBSITES ONLY. One platform, one output:
 *
 *   css -> ../../sites/_shared/assets/tokens.css
 *          CSS custom properties, with dark values in a
 *          `@media (prefers-color-scheme: dark)` block.
 *
 * ── WHY THERE IS NO LONGER AN ink -> --brand-ink RENAME (dropped 2026-08-17) ─
 * This header used to justify the rename as mirroring the live nikatru.com
 * :root "exactly (incl. --brand-ink)". THAT PREMISE WAS FALSE, and measurably
 * so: of the 18 static pages across both sites, 17 declare `--ink` and exactly
 * ONE declared `--brand-ink` — sites/nikatru/index.html. The generator had been
 * modelled on that single page, which was not the page that set the convention
 * but the one page that fell behind its own twin: sites/rajasekarselvam/
 * index.html is the same :root shape and already used `--ink`.
 *
 * So the rename encoded the outlier as the rule. The `cssVar()` mapping function
 * is GONE (not left as an identity function, which would only invite a fresh
 * rename), and the emitted name is the token name: `--ink`. Nothing asserted the
 * string `brand-ink` anywhere in CI, so dropping it was mechanically free.
 *
 * ⚠️ 17 of 18 pages declared `--ink` when this was measured; the 18th — the
 * nikatru homepage, the same page the rename had been modelled on — was brought
 * to `--ink` in the same change, so it is 18 of 18 now. The "17 of 18" figure is
 * kept above ONLY as the measurement that motivated the fix, and is not a
 * description of the tree. A count in a comment is true on the day it is written
 * and nothing recomputes it; this one was made stale by its own repair inside the
 * same commit, which is as short a half-life as this class gets.
 *
 * The general lesson, which is why this is written down rather than just fixed:
 * a comment claiming a generator "mirrors the live site exactly" is a claim
 * about 18 files that nothing re-checks. It was true of the page it was written
 * against and false of the corpus, and it stayed false for as long as nobody
 * counted.
 *
 * ── WHY THERE IS NO LONGER A DART OUTPUT (removed 2026-07-26) ──────────────
 * A Dart token class encodes ONE fixed palette. The app factory is explicitly
 * MULTI-BRAND: the Mason brick takes a per-app `seed_hex` and
 * `design_system/build_app_theme.dart` derives the whole Material 3 scheme via
 * `ColorScheme.fromSeed`. So a single generated palette could only ever be
 * correct if all 50 apps shared one brand — which contradicts the brick.
 * `build/nikatru_tokens.dart` had zero consumers for exactly that reason.
 *
 * The websites are the opposite case: nikatru.com and rajasekarselvam.com are
 * ONE company brand, so generated tokens are precisely right for them, and
 * that is the whole remit of this package now.
 *
 * Genuinely cross-app values that are NOT colour (spacing, type scale, radii)
 * live in `packages/design_system` as Dart constants and belong there.
 *
 * ── WHY IT WRITES STRAIGHT INTO sites/_shared ──────────────────────────────
 * It previously emitted to `build/`, which nothing read, while
 * `sites/_shared/assets/tokens.css` was a hand-maintained snapshot whose own
 * header said it "will be REPLACED by the generated output of packages/tokens".
 * That left THREE copies of the brand palette and made the generated one a
 * decoy: editing tokens/color.json changed nothing and CI still passed.
 * Emitting directly to this path collapses that to one source of truth.
 *
 * ⚠️ BUT DO NOT READ THAT AS "the sites serve this file" — THEY DO NOT.
 * Measured 2026-08-17: zero `rel="stylesheet"` tags exist across the 18 static
 * pages; every page inlines its own `:root`. `sites/nikatru/_headers` records
 * that `/assets/tokens.css` returns 404, and the only `<link>` to it is
 * `sites/_shared/_includes/base.njk`, whose Eleventy output lands in a
 * gitignored `_site/` that deploys nowhere. The CI `tokens` lane therefore
 * guards a REFERENCE palette, not served bytes — which is worth knowing before
 * concluding that a green lane means the live sites are consistent. Keeping it
 * correct still matters: it is the value source a palette guard would compare
 * the 18 inline blocks against.
 *
 * ── WHY `soft` IS A LITERAL AND NOT AN ALIAS ───────────────────────────────
 * `soft` is a recessed panel tint used INSIDE a card. It equals `bg` in light
 * (#F6F8FC) but NOT in dark (#0E1830 vs #0B1220), and equals `card-2` in dark
 * exactly but NOT in light (#F6F8FC vs #F8FAFD). It is an alias of neither, so
 * a DTCG reference to either token would encode a coupling that is false on one
 * side — and invisible in review, because the two values are equal today.
 *
 * OPEN QUESTION, deliberately not decided here: `soft` and `card-2` are the same
 * design ROLE under two names, and they are DISJOINT across the corpus — the 13
 * pages declaring `--soft` declare no `--card-2`, and the 2 declaring `--card-2`
 * declare no `--soft`. Dark values are identical; light values differ by
 * (2,2,1)/255, i.e. invisibly. Collapsing them into one token is the obvious
 * cleanup, but it changes rendered bytes on 13 pages, so it is its own decision
 * and not a side effect of adding this token.
 *
 * A custom format is used (instead of the built-in `css/variables`) so that:
 *   - the CSS variable names match the names the pages actually declare,
 *   - the dark palette ships as a prefers-color-scheme override block,
 *   - output carries no timestamps, keeping rebuilds byte-identical
 *     (which is what makes the CI drift check meaningful).
 */

/* --------------------------------------------------------------------- */
/* Canonical ordering - locked so output is deterministic and reviewable. */

const LIGHT_COLORS = [
  'ink', 'ink-2', 'primary', 'teal', 'bg', 'card', 'card-2',
  'text', 'strong', 'muted', 'line', 'soft',
];
const DARK_COLORS = ['bg', 'card', 'card-2', 'text', 'strong', 'muted', 'line', 'soft'];

const HEADER_CSS = `/**
 * Nikatru brand tokens - generated by Style Dictionary. DO NOT EDIT BY HAND.
 * Edit packages/tokens/tokens/*.json and run \`npm run build\`.
 *
 * Each CSS custom-property name is the token name verbatim, matching the names
 * the static pages declare (--ink, --text, --soft). Never rename on the way out.
 */`;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */

const raw = (token) => token.$value ?? token.value;

/** Collect one top-level token group into `name -> value` (path minus group, kebab-joined). */
function groupMap(dictionary, group) {
  const map = new Map();
  for (const token of dictionary.allTokens) {
    if (token.path[0] === group) map.set(token.path.slice(1).join('-'), raw(token));
  }
  return map;
}

/** Fail the build loudly if a required token disappears or is renamed. */
function must(map, key, group) {
  if (!map.has(key)) throw new Error(`[@nikatru/tokens] missing required token "${group}.${key}"`);
  return map.get(key);
}

/**
 * Fail the build loudly if a token exists in the JSON but is NOT in the emit
 * order above - i.e. the OPPOSITE hole to `must()`.
 *
 * `must()` catches "listed here, missing from JSON" by throwing. Nothing caught
 * "present in JSON, missing from the list": the token was simply never emitted,
 * the build stayed green, and the author's new token silently did not exist.
 * That is this repo's most-repeated failure shape - a check that quietly stops
 * covering what it thinks it covers - so the ordering arrays are now asserted
 * to be COMPLETE, not merely valid.
 *
 * Negative test (run before trusting this): add `"zzz": { "$value": "#000000" }`
 * to tokens/color.json without touching LIGHT_COLORS. The build must exit
 * non-zero naming `color.zzz`. Verified 2026-08-17.
 */
function assertEmitsEveryToken(map, order, group) {
  const missing = [...map.keys()].filter((k) => !order.includes(k));
  if (missing.length) {
    throw new Error(
      `[@nikatru/tokens] token(s) defined in "${group}" but absent from the emit order, ` +
        `so they would be silently dropped from tokens.css: ` +
        missing.map((k) => `"${group}.${k}"`).join(', ') +
        `. Add them to ${group === 'dark' ? 'DARK_COLORS' : 'LIGHT_COLORS'} in style-dictionary.config.mjs.`,
    );
  }
}

/*
 * NOTE: there is deliberately NO name-mapping function here. A `cssVar()` that
 * rewrote `ink` -> `brand-ink` lived at this spot until 2026-08-17; the token
 * name IS the CSS custom-property name. See the header for why that rename was
 * wrong (it encoded a 1-of-18 outlier). Do not reintroduce a per-token rename
 * without first counting how many pages actually declare the target name.
 */

/** DTCG dimension -> CSS string ('16px' or {value:16, unit:'px'} -> '16px'). */
const dimToCss = (v) => (typeof v === 'object' && v !== null ? `${v.value}${v.unit}` : String(v));

/* ------------------------------------------------------------------ */
/* Formats                                                            */

function formatCss({ dictionary }) {
  const light = groupMap(dictionary, 'color');
  const dark = groupMap(dictionary, 'dark');
  const font = groupMap(dictionary, 'font');
  const size = groupMap(dictionary, 'size');

  assertEmitsEveryToken(light, LIGHT_COLORS, 'color');
  assertEmitsEveryToken(dark, DARK_COLORS, 'dark');

  const lines = [HEADER_CSS, '', ':root {'];
  for (const name of LIGHT_COLORS) {
    lines.push(`  --${name}: ${must(light, name, 'color')};`);
  }
  lines.push(`  --radius: ${dimToCss(must(size, 'radius', 'size'))};`);
  lines.push(`  --font-display: "${must(font, 'display', 'font')}";`);
  lines.push(`  --font-body: "${must(font, 'body', 'font')}";`);
  lines.push('}', '', '@media (prefers-color-scheme: dark) {', '  :root {');
  for (const name of DARK_COLORS) {
    lines.push(`    --${name}: ${must(dark, name, 'dark')};`);
  }
  lines.push('  }', '}');
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */

export default {
  source: ['tokens/**/*.json'],
  hooks: {
    formats: {
      'nikatru/css': formatCss,
    },
  },
  platforms: {
    css: {
      transforms: ['name/kebab'],
      buildPath: '../../sites/_shared/assets/',
      files: [{ destination: 'tokens.css', format: 'nikatru/css' }],
    },
  },
};
