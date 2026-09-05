/**
 * Nikatru brand tokens - Style Dictionary v5 configuration.
 *
 * SOURCE: ../../contracts/tokens/dtcg/*.json - the DTCG JSON moved out of this
 * package on 2026-09-05 ([ADR 067] decision 1). The JSON is a CONTRACT more than
 * one runtime agrees about; this package is the EMITTER, which is where the
 * Style Dictionary dependency belongs. Nothing else about the build changed:
 * `contracts/tokens/README.md` recorded the intended move and this is it.
 *
 * THREE PLATFORMS, THREE COMMITTED OUTPUTS, ONE SOURCE:
 *
 *   css  -> ../../sites/_shared/assets/tokens.css
 *           CSS custom properties, with dark values in a
 *           `@media (prefers-color-scheme: dark)` block.
 *   dart -> ../design_system/lib/src/tokens/brand_tokens.dart
 *           `BrandTokens` / `BrandTokensDark` constants for the Flutter apps.
 *   json -> ../../extensions/core/tokens.json
 *           a plain JSON table the build-free extension subtree can read
 *           without a bundler, a transpiler or an install step.
 *
 * All three are COMMITTED and all three are drift-checked the same way -
 * ci.yml's `site-tokens` lane deletes them, rebuilds, and `git diff
 * --exit-code`s all three - which works precisely because the build carries no
 * timestamps. `tooling/ci/assert-palette-consistent.mjs` additionally holds all
 * three equal to the DTCG source itself, so a hand edit to any generated file is
 * caught by a guard that does not need `npm ci` to run.
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
 * ── THE DART OUTPUT, REMOVED 2026-07-26 AND BACK 2026-09-05 ON NARROWER TERMS ─
 * The 2026-07-26 removal was RIGHT and its reasoning still stands, so it is kept
 * here rather than deleted: a Dart token class encodes ONE fixed palette, the app
 * factory is explicitly MULTI-BRAND (the Mason brick takes a per-app `seed_hex`
 * and `design_system/build_app_theme.dart` derives the whole Material 3 scheme
 * via `ColorScheme.fromSeed`), so a generated palette could only ever be the
 * PAINT of every app if all 50 apps shared one brand — which contradicts the
 * brick. The old `build/nikatru_tokens.dart` had zero consumers for exactly that
 * reason.
 *
 * What is emitted now is narrower and is not the apps' paint. `BrandTokens` is
 * the NIKATRU COMPANY brand — the same palette the two company websites declare
 * — plus the two font families and the corner radius. Its live consumer is
 * `app_text.dart`, which had `'Space Grotesk'` and `'Manrope'` typed into six
 * `TextStyle`s; those are company-brand facts, they are in the DTCG already, and
 * they are now read from the generated file instead of retyped. That is the
 * whole claim being made: a token change reaches the Flutter apps. It is not the
 * claim that an app's colours come from here, and it must not become that.
 *
 * 🔴 `app_colors.dart` IS NOT GENERATED AND MUST NOT BE. Research 01 §8.2 item 4
 * proposed generating it and "delet[ing] the hand-written app_colors.dart
 * values"; that proposal is DECLINED, with the reason recorded so it is not
 * re-proposed. `AppColors` is SUBLY's palette, not this one — bg #F4F4F8 against
 * #F6F8FC, ink #141420 against #0B1220, seed #6459F5 which has no counterpart
 * here at all — and it additionally holds `positive`/`warn`/`danger`,
 * `heroA..C`, an eight-colour category ramp and two `LinearGradient`s that are
 * Flutter composition rather than tokens. Overwriting it from this source would
 * repaint every screen of the shipping app, and it would silently discard the
 * measured WCAG derivations its doc comments carry (`muted` #6F6F7B and
 * `accent2` #8950FF were each moved for SC 1.4.3 on 2026-08-13) — against a
 * PUBLISHED WCAG 2.2 AA claim. "Two palettes that nothing compares" was a
 * correct observation about the tree; the remedy is not to make one of them
 * overwrite the other, because they are two BRANDS, not two copies.
 *
 * Genuinely cross-app values that are NOT colour (spacing, type scale) live in
 * `packages/design_system` as hand-written Dart constants and belong there.
 *
 * ── WHY THERE IS A JSON OUTPUT (added 2026-09-05) ───────────────────────────
 * `extensions/` ships build-free by decision ([ADR 067] decision 1, enforced by
 * `tooling/ci/assert-extensions-build-free.mjs`), so an extension cannot consume
 * a token source that needs compiling. A committed JSON table is the one shape
 * that crosses that boundary: it is data, `fetch`/`import` reads it with no
 * tooling, and the guard that forbids build steps has nothing to object to.
 * `sites/nikatru/fullshot/privacy.html` is the page this exists for — its
 * `:root` hand-codes `--ink`, `--muted` and `--line` from this palette under a
 * fourth name for `primary` (`--accent`).
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

/** Where the DTCG source lives, quoted into every generated file's header so a
 *  reader who opens an output is told where to edit instead. One constant, so
 *  the three headers cannot disagree with each other or with `source` below. */
const SOURCE_REL = 'contracts/tokens/dtcg/*.json';
/** How to regenerate, likewise quoted into all three headers. */
const BUILD_CMD = 'cd packages/tokens && npm run build';

const HEADER_CSS = `/**
 * Nikatru brand tokens - generated by Style Dictionary. DO NOT EDIT BY HAND.
 * Edit ${SOURCE_REL} and run \`${BUILD_CMD}\`.
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

/**
 * `ink-2` -> `ink2`, `card-2` -> `card2`, `font-display` -> `fontDisplay`.
 *
 * Deliberately NOT a general kebab->camel helper with a rename table beside it:
 * a rename table is the thing this file already deleted once (see the header on
 * `--brand-ink`). The token name goes out verbatim everywhere a target permits
 * it, and Dart is the one target that does not permit a hyphen in an identifier,
 * so the transformation here is mechanical and total rather than per-token.
 */
const dartName = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** `#0B1220` -> `0xFF0B1220`. Refuses anything that is not a 6-digit hex, because
 *  a silently-passed-through `rgb()` or a 3-digit shorthand would emit Dart that
 *  does not compile — and the build failing loudly here is cheaper than the
 *  workspace gate failing on a generated file nobody edited. */
function dartColor(value, name) {
  const t = String(value).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(t)) {
    throw new Error(
      `[@nikatru/tokens] "${name}" is "${t}", which the Dart emitter cannot express as a Color literal. ` +
        `Colours in ${SOURCE_REL} must be 6-digit hex.`,
    );
  }
  return `0xFF${t.slice(1).toUpperCase()}`;
}

/**
 * The Flutter-side output. `BrandTokens` is the NIKATRU COMPANY brand and the two
 * font families; `BrandTokensDark` is the dark-scheme override set.
 *
 * ⚠️ This is NOT an app's palette and the header emitted into the file says so.
 * See the `app_colors.dart` note at the top of this config before adding a
 * consumer that paints a surface with one of these.
 */
function formatDart({ dictionary }) {
  const light = groupMap(dictionary, 'color');
  const dark = groupMap(dictionary, 'dark');
  const font = groupMap(dictionary, 'font');
  const size = groupMap(dictionary, 'size');

  assertEmitsEveryToken(light, LIGHT_COLORS, 'color');
  assertEmitsEveryToken(dark, DARK_COLORS, 'dark');

  const radiusCss = dimToCss(must(size, 'radius', 'size'));
  const radiusNum = Number(String(radiusCss).replace(/px$/, ''));
  if (!Number.isFinite(radiusNum)) {
    throw new Error(`[@nikatru/tokens] size.radius "${radiusCss}" is not a px length the Dart emitter can express.`);
  }

  const lines = [
    '// GENERATED BY packages/tokens - DO NOT EDIT BY HAND.',
    `// Edit ${SOURCE_REL} and run \`${BUILD_CMD}\`.`,
    '//',
    "// This is the NIKATRU COMPANY brand - the palette the company's own websites",
    '// declare - plus the two brand font families and the corner radius. It is NOT',
    "// an app's palette: the app factory is multi-brand and every stamped app",
    '// derives its Material 3 scheme from its own `seed_hex` via',
    '// `ColorScheme.fromSeed`. Do not repaint a screen from these constants; see',
    '// packages/tokens/style-dictionary.config.mjs for why `app_colors.dart` is',
    '// hand-written and is a different palette on purpose.',
    '',
    "import 'package:flutter/material.dart';",
    '',
    '/// The NIKATRU company brand tokens, light scheme.',
    'class BrandTokens {',
    '  BrandTokens._();',
    '',
  ];
  for (const name of LIGHT_COLORS) {
    lines.push(`  /// \`--${name}\` in the light palette.`);
    lines.push(`  static const Color ${dartName(name)} = Color(${dartColor(must(light, name, 'color'), `color.${name}`)});`);
    lines.push('');
  }
  lines.push('  /// The display face, used for numerals and headings.');
  lines.push(`  static const String fontDisplay = '${must(font, 'display', 'font')}';`);
  lines.push('');
  lines.push('  /// The body face.');
  lines.push(`  static const String fontBody = '${must(font, 'body', 'font')}';`);
  lines.push('');
  lines.push('  /// The brand corner radius, in logical pixels.');
  lines.push(`  static const double radius = ${radiusNum};`);
  lines.push('}');
  lines.push('');
  lines.push('/// The NIKATRU company brand tokens, dark-scheme overrides.');
  lines.push('///');
  lines.push('/// Only surfaces and text change; [BrandTokens.ink], [BrandTokens.ink2],');
  lines.push('/// [BrandTokens.primary] and [BrandTokens.teal] are shared with the light');
  lines.push('/// palette and are deliberately absent here.');
  lines.push('class BrandTokensDark {');
  lines.push('  BrandTokensDark._();');
  lines.push('');
  for (const name of DARK_COLORS) {
    lines.push(`  /// \`--${name}\` in the dark palette.`);
    lines.push(`  static const Color ${dartName(name)} = Color(${dartColor(must(dark, name, 'dark'), `dark.${name}`)});`);
    lines.push('');
  }
  lines[lines.length - 1] = '}';
  return lines.join('\n') + '\n';
}

/**
 * The extension-side output: a plain JSON table.
 *
 * JSON has no comment syntax, so the "do not edit" notice is a `$generated` key
 * rather than a header - which is also the shape a reader of the DTCG source
 * already expects, since `$type`/`$value`/`$description` are DTCG's own
 * dollar-prefixed metadata convention.
 *
 * Two spaces and a trailing newline, matching every other JSON file in the tree,
 * so a rebuild produces a byte-identical file and the drift check means
 * something.
 */
function formatJson({ dictionary }) {
  const light = groupMap(dictionary, 'color');
  const dark = groupMap(dictionary, 'dark');
  const font = groupMap(dictionary, 'font');
  const size = groupMap(dictionary, 'size');

  assertEmitsEveryToken(light, LIGHT_COLORS, 'color');
  assertEmitsEveryToken(dark, DARK_COLORS, 'dark');

  const out = {
    $generated: `by packages/tokens from ${SOURCE_REL}. DO NOT EDIT BY HAND - edit the source and run \`${BUILD_CMD}\`.`,
    $note:
      'The NIKATRU company brand. Key names are the CSS custom-property names without the leading --, ' +
      'so light.ink is --ink. Read this file directly: extensions/ ships build-free and nothing here needs compiling.',
    light: Object.fromEntries(LIGHT_COLORS.map((n) => [n, must(light, n, 'color')])),
    dark: Object.fromEntries(DARK_COLORS.map((n) => [n, must(dark, n, 'dark')])),
    font: { display: must(font, 'display', 'font'), body: must(font, 'body', 'font') },
    size: { radius: dimToCss(must(size, 'radius', 'size')) },
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/* ------------------------------------------------------------------ */

export default {
  /* Relative to this package (the CWD `npm run build` runs in), and pointing OUT
     of it on purpose: the JSON is a contract, this package is the emitter. */
  source: ['../../contracts/tokens/dtcg/**/*.json'],
  hooks: {
    formats: {
      'nikatru/css': formatCss,
      'nikatru/dart': formatDart,
      'nikatru/json': formatJson,
    },
  },
  platforms: {
    css: {
      transforms: ['name/kebab'],
      buildPath: '../../sites/_shared/assets/',
      files: [{ destination: 'tokens.css', format: 'nikatru/css' }],
    },
    dart: {
      transforms: ['name/kebab'],
      buildPath: '../design_system/lib/src/tokens/',
      files: [{ destination: 'brand_tokens.dart', format: 'nikatru/dart' }],
    },
    json: {
      transforms: ['name/kebab'],
      buildPath: '../../extensions/core/',
      files: [{ destination: 'tokens.json', format: 'nikatru/json' }],
    },
  },
};
