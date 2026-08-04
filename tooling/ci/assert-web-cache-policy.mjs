#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-web-cache-policy.mjs — every deployed bundle declares its own cache
// policy, and nothing whose NAME is stable is cached as though it were not.
//
// [pipeline 9]R-9, the CACHE limb. (The FLAG limb — "fail if
// `--pwa-strategy=none` is absent" — is DROPPED and must not be re-derived:
// [ADR 023], LOCKED 2026-07-31, records the flag as deliberate AND explicitly
// rejects guarding it in CI as over-encoding. Its `unless` antecedent could
// never be true either: a Flutter web template cannot contain a service
// worker, Flutter generates one at build time.)
//
// ── WHY THIS MATTERS ON EXACTLY THIS CHANNEL ─────────────────────────────────
// With no service worker there is no client-side update machinery at all, so
// the HTTP cache IS the update mechanism for the only channel this factory
// serves. Nothing in the repository was choosing a policy for it: `flutter
// build web` emits no `_headers`, and deploy-web.yml ships `build/web` straight
// to Cloudflare Pages, so whatever the platform defaults to is what a returning
// visitor gets.
//
// The consequence is not "updates are slow". A client served a stale
// `flutter_bootstrap.js` runs the PREVIOUS build and reports the previous
// version — honestly — so the CFG-1 force-update gate, which compares the
// version the client reports, cannot see it. The kill-switch is blind to
// exactly the clients the cache is hiding.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 2026-08-04 — TWO THINGS CHANGED, AND THE SECOND IS THE INTERESTING ONE.
//
// (1) THE EDGE DIVERGENCE IS GONE. This header used to record that
//     `/flutter_bootstrap.js` and `/main.dart.js` served `max-age=14400`
//     against a declared `max-age=0` — `_headers` deployed and applied, and
//     those two files alone overridden. The cause was the `nikatru.com` zone's
//     Browser Cache TTL (14400), which Cloudflare stamps over the origin's
//     value on anything it edge-caches, and .js is edge-cached by extension.
//     The zone is now on "Respect Existing Headers" and a fresh plain GET
//     returns `public, max-age=0, must-revalidate` on both. Re-measured, not
//     assumed. The zone setting itself remains INVISIBLE from here — see the
//     CANNOT-SEE list below.
//
// (2) THE DECLARATION ITSELF WAS WRONG, AND THIS GUARD WAS THE REASON NOBODY
//     NOTICED. `apps/subly/web/_headers` declared `/assets/*`, `/canvaskit/*`
//     and `/icons/*` as `immutable, max-age=31536000` under the comment
//     "content-addressed output: the name changes when the bytes do". Measured
//     against the live bundle, NOTHING a Flutter web build emits is
//     content-addressed: `flutter_bootstrap.js` names `main.dart.js`,
//     `canvaskit.js` and `canvaskit.wasm` plainly, a scan for a hash-shaped
//     token found NONE, and the only `?v=` in the whole bootstrap is on
//     `flutter_service_worker.js`, which `--pwa-strategy=none` never emits.
//     So `/icons/Icon-192.png` — the exact bytes PR #149 replaced — was being
//     served `immutable`, which suppresses revalidation even on a hard reload,
//     for a year.
//
//     This guard asked only about three entry points, so it was green
//     throughout. Worse, its own suite asserted the defect was correct:
//     "hashed output under assets/ staying immutable does NOT fire". A test
//     that encodes the author's belief protects the belief, not the tree.
//
//     THE REPAIR IS NOT ANOTHER HARDCODED PATH LIST. It is to derive the
//     question from the tree: `flutter build web` copies `web/` verbatim, so
//     EVERY file this repository ships under a web output keeps its name and
//     changes its content, and the rule governing its URL must revalidate. The
//     set is whatever is on disk, so it grows by itself.
// ─────────────────────────────────────────────────────────────────────────────
//
// ── WHAT IS ASSERTED ─────────────────────────────────────────────────────────
// Over TWO kinds of deployed bundle, discovered rather than listed:
//
//   FLUTTER-WEB   `apps/*/web`, plus the brick's template (a defect there is
//                 born into every future app at once).
//   STATIC-SITE   `sites/*` that ship an index.html — the deploy roots
//                 Cloudflare's Git integration publishes on every push to main,
//                 with no GitHub workflow in between. Same predicate
//                 check-site-integrity.mjs and assert-lane-coverage.mjs use.
//
// For every bundle:
//   · `_headers` exists, is non-empty, and declares at least one real rule;
//   · every STABLE-NAMED entry point has a rule whose `Cache-Control`
//     revalidates (`max-age=0`, `no-cache` or `no-store`).
//
// For FLUTTER-WEB additionally:
//   · every file the repository ships inside the bundle directory must be
//     governed by a revalidating rule. Derived from disk; this is the limb the
//     `/icons/*` defect walks into.
//
// For STATIC-SITE additionally:
//   · the `.css` and `.js` CLASSES are declared, at any depth. Not because
//     either site serves one today — measured 2026-08-04, neither does; every
//     page carries its styles inline and /assets/tokens.css 404s — but because
//     a policy file's whole job is to be there BEFORE the file is. Until the
//     `nikatru.com` zone was switched to "Respect Existing Headers" those two
//     classes were riding on a zone-level 4-hour TTL nobody in this repository
//     had chosen; the fix removed the accident and left the gap.
//
// The split is by NAME STABILITY, not by file type, and the guard says so: a
// name that changes when its bytes change may be immutable, and this repo
// currently ships exactly one such convention — the hand-versioned
// `founder-v4.webp` / `rajasekar-v4.webp` on the marketing sites.
//
// ── WHAT THIS GUARD CANNOT SEE, stated so nobody reads green as safe ─────────
//  · THE LIVE RESPONSE. Every assertion is against the DECLARED FILE. CI holds
//    no Cloudflare credential, so the zone's Browser Cache TTL, any Cache Rule,
//    and the header the edge actually returns are all invisible here — and it
//    was exactly that gap that let `max-age=14400` survive a green build. A
//    guard that fetched could not fail offline, could not fail on a fork, and
//    would turn a deploy-time property into a network dependency of every
//    build. The live assertion belongs in tooling/ops/post-deploy-smoke.mjs,
//    where a failure blocks a deploy rather than every push.
//  · BUILD-GENERATED PATHS. `/assets/*`, `/canvaskit/*` and `main.dart.js`
//    exist only in `build/web`, which is not in the tree. The shipped-file limb
//    ranges over the repository's `web/` directory only; those three are
//    declared by hand and reasoned in the `_headers` comment.
//  · WHICH RULE CLOUDFLARE ACTUALLY APPLIES when two match one path. The docs
//    say "an incoming request which matches multiple rules' URL patterns will
//    inherit all rules' headers", and that a header set twice is joined with a
//    comma — so two Cache-Controls become one self-contradicting header rather
//    than an override. This guard resolves ONE governing rule by specificity,
//    which models what the author MEANT, not what the edge computes. Overlaps
//    are therefore PRINTED, never failed: the claim is documented behaviour
//    this guard cannot verify offline, and a guard that fails on input it
//    cannot prove wrong is one somebody switches off.
//
// Usage:  node tooling/ci/assert-web-cache-policy.mjs [repoRoot] [claimedBundle...]
// Exit 0 = every deployed bundle declares a policy a deploy can be seen through.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const args = process.argv.slice(2);
const ROOT = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
/** Bundles the CALLER claims this run covers (ci.yml names the two Cloudflare
 *  Git-deployed sites). The same device check-site-integrity.mjs uses: a claim
 *  in a workflow comment satisfied a coverage check once already, so the claim
 *  is an ARGUMENT and this script fails when a claimed bundle is not among the
 *  ones it actually scanned. The claim cannot outlive the thing it claims. */
const claimed = args.slice(1).map((c) => c.replace(/[/\\]+$/, '').replaceAll('\\', '/'));

const BRICK_WEB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/web';

/** Stable names with changing content, per bundle kind. */
const ENTRY_POINTS = {
  // Every build rewrites these three under the same names.
  'flutter-web': ['/', '/index.html', '/flutter_bootstrap.js'],
  // A hand-written site has no build step, so its entry points are the
  // documents themselves. `/index.html` is checked as well as `/` because
  // Pages serves both and a rule written for one is not a rule for the other.
  'static-site': ['/', '/index.html'],
};

/** CLASS PROBES for a static site: synthetic paths, at three depths, standing
 *  in for "a stylesheet/script could land HERE". They are not files and are not
 *  expected to be — the point is that the rule set must cover the CLASS, so a
 *  directory-scoped rule (`/assets/*.css`) fails while `/*.css` passes. A
 *  rule-per-file policy reopens the gap the moment somebody adds `/style.css`. */
const CLASS_PROBES = {
  css: ['/probe.css', '/assets/probe.css', '/a/b/probe.css'],
  js: ['/probe.js', '/assets/probe.js', '/a/b/probe.js'],
};

/** A policy that lets a new deploy be seen. `must-revalidate` alone is not
 *  enough — it governs what happens once a response is STALE, and with a long
 *  `max-age` it never becomes stale inside the window that matters. */
const REVALIDATES = /(^|[,\s])max-age\s*=\s*0(\b|$)|no-cache|no-store/i;

/** Cloudflare Pages does not serve its own control files as assets. */
const NOT_SERVED = new Set(['_headers', '_redirects', '_routes.json', '_worker.js']);

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-web-cache-policy: FAILED');
  process.exit(1);
}

// ── discover the bundles ─────────────────────────────────────────────────────
const bundles = [];
const appsDir = join(ROOT, 'apps');
if (existsSync(appsDir)) {
  for (const a of listDir(appsDir)) {
    const w = join(appsDir, a, 'web');
    if (existsSync(w) && statSync(w).isDirectory()) bundles.push({ dir: `apps/${a}/web`, kind: 'flutter-web' });
  }
}
if (existsSync(join(ROOT, BRICK_WEB))) bundles.push({ dir: BRICK_WEB, kind: 'flutter-web' });

const sitesDir = join(ROOT, 'sites');
const sitesDirExists = existsSync(sitesDir);
if (sitesDirExists) {
  for (const s of listDir(sitesDir)) {
    const root = join(sitesDir, s);
    // A deploy root ships an index.html. `sites/_shared` is an Eleventy SOURCE
    // layer whose output is gitignored and deploys nowhere, and it is excluded
    // by that test rather than by a name this guard would have to remember.
    if (existsSync(join(root, 'index.html'))) bundles.push({ dir: `sites/${s}`, kind: 'static-site' });
  }
}

if (bundles.length === 0) {
  coverageLost([
    `found no deployed bundle under ${ROOT} (apps/*/web, ${BRICK_WEB}, sites/*/index.html).`,
    'Every assertion below is per bundle, so with none found this guard would report that every',
    'channel declares a cache policy — over nothing. The brick template alone is always one.',
  ]);
}
// The brick is the one directory whose absence is invisible in the app tree: a
// defect there is born into every future app at once, and apps/*/web can all be
// correct while the template that makes the next one is not.
if (!bundles.some((b) => b.dir === BRICK_WEB)) {
  coverageLost([
    `${BRICK_WEB} is not in the scan.`,
    'It is the template every stamped app inherits, so it is the only directory where one wrong line',
    'reaches fifty apps. Either the brick moved or this walk narrowed; neither is "clean".',
  ]);
}
// `sites/` present but yielding nothing is the shape this repo keeps hitting: a
// walk that stops matching reports "clean". Fixture roots have no sites/ at all
// and are legitimately unaffected.
if (sitesDirExists && !bundles.some((b) => b.kind === 'static-site')) {
  coverageLost([
    `${ROOT}/sites exists and produced ZERO static-site deploy roots.`,
    'Those roots are deployed by Cloudflare\'s Git integration on every push to main, with no workflow in',
    'between, so nothing else stands between a bad policy and production. A walk that quietly stops',
    'matching them prints ok forever.',
  ]);
}
// The caller's claim, made load-bearing at both ends: ci.yml names the two
// Git-deployed sites on the run line, and this fails if a named one is not
// really among the bundles scanned.
{
  const scanned = new Set(bundles.map((b) => b.dir));
  const dangling = claimed.filter((c) => !scanned.has(c));
  if (dangling.length) {
    coverageLost([
      `the caller claims ${dangling.join(', ')} as scanned bundle(s), and the scan found no such bundle.`,
      'The CI lane is promising coverage this script does not deliver.',
    ]);
  }
}

/**
 * A Cloudflare `_headers` file, as { path -> { header -> value } }.
 * Rules are `path` at column 0 followed by indented `Name: value` lines.
 * Comments are dropped — a commented-out rule is not a rule, and this repo has
 * shipped the opposite reading twice.
 */
function parseHeaders(text) {
  const rules = new Map();
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      current = line.trim();
      if (!rules.has(current)) rules.set(current, new Map());
      continue;
    }
    if (current === null) continue;
    const m = line.trim().match(/^([A-Za-z0-9-]+)\s*:\s*(.*)$/);
    if (m) rules.get(current).set(m[1].toLowerCase(), m[2].trim());
  }
  return rules;
}

/**
 * Compile a Cloudflare `_headers` path pattern to a matcher.
 *
 * 🔴 THIS REPLACED A `prefix + '*'` TEST THAT COULD NOT MATCH `/*.css`, AND THE
 * BLIND SPOT WAS LOAD-BEARING. Cloudflare documents a single greedy splat
 * ANYWHERE in the pattern and `:name` placeholders, and the marketing sites'
 * `_headers` have used the mid-path form (`/*.html`, `/*.png`) since they were
 * written. The old resolver saw only `/*` for `/index.html`, read its
 * security-headers-only rule, and would have reported "sets no Cache-Control"
 * on a file that declares one perfectly well — a guard failing on correct
 * input, which is how a check gets switched off.
 *
 * `literal` counts the characters that are not part of a wildcard, and is what
 * ranks two matching patterns: `/*.html` (6) beats `/*` (1).
 */
function compilePattern(pattern) {
  let re = '';
  let literal = 0;
  let wildcards = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      re += '.*';
      wildcards++;
      continue;
    }
    if (c === ':' && /[A-Za-z]/.test(pattern[i + 1] ?? '')) {
      let j = i + 1;
      while (j < pattern.length && /\w/.test(pattern[j])) j++;
      re += '[^/]+';
      wildcards++;
      i = j - 1;
      continue;
    }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    literal++;
  }
  return { test: (p) => new RegExp(`^${re}$`).test(p), literal, wildcards };
}

/** Every rule whose pattern matches `path`, most specific first. */
function matchingRules(rules, path) {
  const out = [];
  for (const [pattern, headers] of rules) {
    const c = compilePattern(pattern);
    if (c.test(path)) out.push({ pattern, headers, literal: c.literal, wildcards: c.wildcards });
  }
  return out.sort((a, b) => a.wildcards - b.wildcards || b.literal - a.literal || b.pattern.length - a.pattern.length);
}

/** The rule this guard treats as governing `path` — see the CANNOT-SEE list:
 *  the edge merges all matching rules, so this models intent, not the edge. */
const ruleFor = (rules, path) => matchingRules(rules, path)[0] ?? null;

/** Files the repository itself ships inside a bundle, as served URL paths. */
function shippedPaths(absDir) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = listDir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}${e.name}/`);
      else if (!NOT_SERVED.has(e.name)) out.push(`/${rel}${e.name}`);
    }
  };
  walk(absDir, '');
  return out.sort();
}

/** One place that answers "does this path have a rule that revalidates", so the
 *  entry-point limb, the shipped-file limb and the class-probe limb cannot
 *  drift into three different readings of the same question. */
function requireRevalidating(rel, rules, path, why) {
  const rule = ruleFor(rules, path);
  if (rule === null) {
    problems.push(`${rel} has no rule covering "${path}". ${why}`);
    return;
  }
  const cc = rule.headers.get('cache-control');
  if (!cc) {
    problems.push(`${rel} rule "${rule.pattern}" (covering "${path}") sets no Cache-Control. ${why}`);
    return;
  }
  if (!REVALIDATES.test(cc)) {
    problems.push(
      `${rel} rule "${rule.pattern}" (covering "${path}") is "${cc}". ${why} A stable name with changing ` +
        'content must be revalidated — `max-age=0`, `no-cache` or `no-store`. `must-revalidate` beside a ' +
        'long max-age governs what happens once the response is STALE, and inside the window that matters ' +
        'it never becomes stale. `immutable` is worse again: it suppresses revalidation even on a reload.',
    );
  }
}

let checked = 0;
let shippedChecked = 0;
let classProbes = 0;
const kinds = { 'flutter-web': 0, 'static-site': 0 };

for (const { dir, kind } of bundles) {
  const rel = `${dir}/_headers`;
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    problems.push(
      `${rel} does not exist. ${
        kind === 'flutter-web'
          ? 'Flutter copies web/ verbatim into build/web and Cloudflare Pages reads `_headers` from the deployed directory, so with no file here NOTHING in this repository chooses a cache policy'
          : 'Cloudflare Pages reads `_headers` from the deploy root and this site is published by the Git integration on every push to main, so with no file here NOTHING in this repository chooses a cache policy'
      } — the platform default does, and a returning visitor can run the previous build while reporting the ` +
        'previous version, which is precisely the client the CFG-1 force-update gate cannot see.',
    );
    continue;
  }
  const text = readFileSync(abs, 'utf8');
  if (text.trim() === '') {
    problems.push(`${rel} is empty. An empty policy file is the same as no policy file and looks like one that was written.`);
    continue;
  }
  const rules = parseHeaders(text);
  if (rules.size === 0) {
    problems.push(
      `${rel} declares no rule at all outside comments. A file of prose about caching is not a cache policy — ` +
        'the same shape as a commented-out build step keeping a guard green.',
    );
    continue;
  }
  checked++;
  kinds[kind]++;

  // ── the stable-named entry points ─────────────────────────────────────────
  for (const entry of ENTRY_POINTS[kind]) {
    requireRevalidating(
      rel,
      rules,
      entry,
      'That name never changes while its content changes on every deploy, so it is the one thing that must be revalidated.',
    );
  }

  if (kind === 'flutter-web') {
    // ── every file the REPO ships into the bundle ──────────────────────────
    // `flutter build web` copies web/ verbatim, so each of these reaches the
    // edge under the name it has here, with whatever bytes were last committed.
    // This is the limb `/icons/* immutable` walks into: PR #149 replaced those
    // exact bytes while the policy told browsers never to look again.
    for (const path of shippedPaths(join(ROOT, dir))) {
      shippedChecked++;
      requireRevalidating(
        rel,
        rules,
        path,
        `${dir}${path} is shipped by this repository and copied verbatim into the deployed bundle, so its ` +
          'name is fixed and its content is whatever was last committed.',
      );
    }
  } else {
    // ── the .css / .js CLASSES, declared before the first file exists ──────
    for (const [ext, probes] of Object.entries(CLASS_PROBES)) {
      for (const path of probes) {
        classProbes++;
        requireRevalidating(
          rel,
          rules,
          path,
          `Nothing in this repository declares a policy for .${ext} on this deploy root, so a stylesheet or ` +
            'script landing here would inherit whatever the platform or the Cloudflare zone happens to ' +
            'default to. Declare the CLASS at any depth (`/*.' +
            ext +
            '`), not one directory: the gap is a file arriving where nobody wrote a rule.',
        );
      }
    }

    // ── PRINTED, not failed: stable names declared immutable ───────────────
    // [pipeline C-6]. Re-cutting a brand image under a NEW name is what makes
    // `immutable` honest, and the sites already use that convention
    // (`founder-v4.webp`). Whether the remaining ones get re-cut is an owner
    // decision about the page's heaviest bytes, so failing the build on it
    // would block all CI on work an agent cannot do — and a guard that cries
    // wolf is one somebody switches off. Printed EVERY run so it cannot become
    // permanent by being invisible.
    // One line per deploy root, not per file: a print repeated a dozen times
    // with one word changed is a print people learn to scroll past, and this
    // one has to stay readable for as long as the gap is open.
    const frozen = [];
    for (const path of shippedPaths(join(ROOT, dir))) {
      const rule = ruleFor(rules, path);
      const cc = rule?.headers.get('cache-control') ?? '';
      // `-v4.` is the hand-versioning convention already in use on both sites,
      // and it is the thing that makes `immutable` honest: a new cut gets a new
      // name, so no cached copy can be the wrong one.
      if (/\bimmutable\b/i.test(cc) && !/-v\d+\./.test(path)) frozen.push(`${path} (via "${rule.pattern}")`);
    }
    if (frozen.length) {
      prints.push(
        `STABLE NAMES DECLARED IMMUTABLE on ${dir} — ${frozen.length} file(s): ${frozen.join(', ')}. None of ` +
          'those names carries a version or a content hash, so replacing the bytes under the same name would ' +
          'not reach a returning visitor for a year — `immutable` suppresses revalidation even on a reload. ' +
          'The fix is to re-cut under a versioned name, the convention these sites already use for their ' +
          '`-v4` images. PRINTED, NOT FAILED: which brand images get re-cut, and when, is an owner decision ' +
          'about the page\'s heaviest bytes, and failing every build on it would block CI on work an agent ' +
          'cannot do. Printed every run so it cannot become permanent by being invisible.',
      );
    }
  }

  // ── PRINTED: two rules setting Cache-Control on one path ──────────────────
  // Cloudflare documents that a request matching several patterns inherits ALL
  // their headers and that a repeated header is comma-joined, which makes two
  // Cache-Controls one self-contradicting value rather than an override. That
  // is documented behaviour this guard cannot verify offline, so it is a print:
  // an assertion built on an unverifiable claim fails on input nobody can prove
  // wrong, and gets disabled by whoever hits it first.
  {
    const probes = [
      ...ENTRY_POINTS[kind],
      ...(kind === 'flutter-web' ? shippedPaths(join(ROOT, dir)) : Object.values(CLASS_PROBES).flat()),
    ];
    for (const path of probes) {
      const withCc = matchingRules(rules, path).filter((r) => r.headers.has('cache-control'));
      if (withCc.length > 1) {
        prints.push(
          `OVERLAPPING RULES: ${dir} — "${path}" is matched by ${withCc.length} rules that each set ` +
            `Cache-Control (${withCc.map((r) => `"${r.pattern}"`).join(', ')}). Cloudflare Pages documents that a ` +
            'request matching multiple patterns inherits ALL their headers, and that a header set twice is ' +
            'joined with a comma — so the client would receive one self-contradicting Cache-Control rather ' +
            'than the more specific rule winning. Write the rules as disjoint classes. (PRINTED, not failed: ' +
            'this guard reads a file offline and cannot observe what the edge actually returns.)',
        );
      }
    }
  }
}

// ── coverage self-checks, BEFORE reporting clean ─────────────────────────────
// Each limb below quantifies over something that can EMPTY OUT, and an empty
// domain makes it vacuously true while printing ok — this repo's single most
// repeated failure.
if (checked === 0) {
  coverageLost([
    'ZERO bundles were evaluated — every one was missing, empty, or comment-only.',
    'Those are reported as problems above; this line exists so the run can never end in a pass having',
    'asserted nothing at all.',
  ]);
}
if (kinds['flutter-web'] === 0) {
  coverageLost([
    'no FLUTTER-WEB bundle was evaluated, so the entry-point and shipped-file limbs ran zero times.',
    'The brick template alone is always one, and it is checked for above — reaching here means its',
    '_headers stopped parsing as a policy rather than the directory going missing.',
  ]);
}
if (shippedChecked === 0) {
  coverageLost([
    'the shipped-file limb evaluated ZERO files across every flutter-web bundle.',
    'That limb is the one that catches a stable-named asset declared immutable (the 2026-08-04 /icons/*',
    'defect). A web/ directory holding only _headers, or a walk that stopped descending, empties it.',
  ]);
}
if (kinds['static-site'] > 0 && classProbes === 0) {
  coverageLost([
    'static-site deploy roots were found and the .css/.js class probes ran zero times.',
    'CLASS_PROBES is what makes the css/js declaration required; emptying it retires the check silently.',
  ]);
}

if (problems.length) {
  console.error(`✗ web cache policy — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 9]R-9 (cache limb) — with no service worker ([ADR 023]) the HTTP cache IS the');
  console.error('  update mechanism on the only served channel. See the header of');
  console.error('  tooling/ci/assert-web-cache-policy.mjs.');
  process.exit(1);
}

console.log(
  `ok  web cache policy — ${checked} bundle(s): ${kinds['flutter-web']} flutter-web (entry points + ` +
    `${shippedChecked} shipped file(s) must revalidate), ${kinds['static-site']} static-site (entry points + ` +
    `${classProbes} .css/.js class probe(s))`,
);
console.log(`    scanned: ${bundles.map((b) => b.dir).join(', ')}`);
console.log(
  '    NOT checked here: the header the edge actually returns. CI holds no Cloudflare credential, so the',
);
console.log(
  '    zone Browser Cache TTL and any Cache Rule are invisible — a green declaration is not a served header.',
);

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (see the guard header for why each is a print) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
