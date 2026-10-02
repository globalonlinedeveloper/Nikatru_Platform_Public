#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-web-cache-policy.mjs — every deployed bundle declares its own cache
// policy, and nothing whose NAME is stable is cached as though it were not.
//
// [pipeline 9]R-9, the CACHE limb. (The FLAG limb — "fail if
// `--pwa-strategy=none` is absent" — is DROPPED and must not be re-derived:
// [ADR 023], RECORDED 2026-07-31 ("LOCKED" here until 2026-10-01), records the flag as deliberate AND explicitly
// rejects guarding it in CI as over-encoding. Its `unless` antecedent could
// never be true either: a Flutter web template cannot contain a service
// worker, Flutter generates one at build time.)
//
// ── WHY THIS MATTERS ON EXACTLY THIS CHANNEL ─────────────────────────────────
// Our worker (sw.js, the limb at the end) is network-first and has no update machinery, so
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
//     NOTICED. `apps/subscriptiontracker/web/_headers` declared `/assets/*`, `/canvaskit/*`
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
import { createHash } from 'node:crypto';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
// Pages' own control files, which it never serves as assets — one set, shared
// with the apex router and assert-retired-names-visible.
import { PAGES_CONTROL_FILES } from '../sites/served.mjs';

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

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-web-cache-policy: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
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
// 🔴 THE MIRROR OF THE `sites/` FLOOR BELOW, AND IT WAS MISSING UNTIL 2026-08-17.
// The two checks above are a floor over a UNION plus an anchor on the ONE member
// of that union that is a constant — so the brick satisfies both of them ALONE,
// and every real app's web bundle can leave the scan while this guard still
// prints ok. The `bundles.length === 0` note four lines up says "The brick
// template alone is always one" and that sentence was the whole defect: it is
// true, which is exactly why the union floor can never fall.
//
// MEASURED, not reasoned — a copy of this repository with `apps/` emptied and
// the directory kept, run the way ci.yml runs it
// (`assert-web-cache-policy.mjs . sites/nikatru sites/rajasekarselvam`):
//   EXIT 0, "ok  web cache policy — 3 bundle(s): 1 flutter-web (entry points +
//   2 shipped file(s) must revalidate), 2 static-site".
// The entry-point limb, the shipped-file limb and the icons limb had all fallen
// back to the template; nothing else in the run said so. The caller-claim check
// below does not cover this either — ci.yml claims the two SITES, never an app.
//
// So this is a floor on the apps ROOT, not another number over the union.
//
// ⚠️ AND IT IS DELIBERATELY *NOT* GATED ON `apps/` EXISTING, which is where the
// first draft of this check was wrong. Written as `existsSync(appsDir) && …` it
// copied the `sitesDirExists` device one line down, and that device is only
// sound for a check whose subject may legitimately be absent. This one's is
// not: the BRICK ANCHOR immediately above has already refused any tree that
// does not ship `tooling/bricks/app/__brick__/apps/{{app_id}}/web`, so by the
// time control reaches here the tree is known to carry this repository's
// app-factory layout — and such a tree with NO `apps/` directory at all is not
// a smaller subject, it is a missing one. Caught by accident while measuring:
// the same mirror that exited 1 with `apps/` empty exited 0, "1 flutter-web",
// once the empty directory itself went away. Absence and emptiness are
// different bugs and a gated floor only ever saw the second.
if (!bundles.some((b) => b.kind === 'flutter-web' && b.dir !== BRICK_WEB)) {
  coverageLost([
    `${ROOT}/apps produced ZERO flutter-web bundles of its own; only ${BRICK_WEB} was scanned.`,
    'The template is not evidence about the apps this repo actually ships: it has its own `_headers`, and a',
    'correct one there says nothing about apps/*/web. Every per-bundle assertion below would then be',
    'answered by the brick and reported as full coverage.',
    'Either an app tree stopped matching `apps/*/web`, or the last app left — and the second is not a state',
    'this factory reaches quietly.',
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
      else if (!PAGES_CONTROL_FILES.has(e.name)) out.push(`/${rel}${e.name}`);
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

// ── PAGES FUNCTIONS: `_headers` STRUCTURALLY CANNOT REACH THEM ───────────────
//
// 🔴 THE GAP THIS CLOSES, MEASURED 2026-08-21. Every limb above reads `_headers`.
// Cloudflare says twice, in its own docs, that the file does not apply to a
// Function: "Custom headers defined in the `_headers` file are not applied to
// responses generated by Pages Functions"
// (developers.cloudflare.com/pages/configuration/headers/, 2026-08-20) and the
// same sentence for `_redirects` (…/configuration/redirects/, same date).
//
// So on 2026-08-21 the origin's six security headers were live on all fifteen
// static pages and absent from `/api/subscribe` — the ONE route that accepts a
// POST body and writes a real email address to KV. Nothing could see it: a
// `_headers` reader is looking at a file that, for this route, is decoration.
//
// WHAT IS ASSERTED, and why it is this and not a header-by-header parse of every
// construction site: a Function file gets ONE Response choke-point. That is a
// property a regex can actually establish, and it is the exact shape of the
// regression — somebody adds a second `new Response(...)` for an early return and
// it ships bare while the helper below it still looks correct. One choke-point,
// and that choke-point carries the set.
//
// ⚠️ WHAT THIS CANNOT SEE, stated so nobody reads green as safe: the header the
// edge actually returns. Same blindness the cache limbs declare above — CI holds
// no Cloudflare credential. A declaration in source is not a served header.

// ── THE INLINE-SCRIPT HASH IN A FLUTTER BUNDLE'S CSP IS RECOMPUTED, NEVER TRUSTED
//
// 🔴 WHY THIS LIMB EXISTS. Since [ADR 075] the app is served from the same origin
// as the marketing site, the pricing page and the frozen consent archive, so
// `apps/<id>/web/_headers` acquired a real Content-Security-Policy — and its
// `script-src` carries a `'sha256-…'` for the one inline <script> in
// `web/index.html`, the boot loader. A hash is the right mechanism and it has one
// failure mode: EDIT THE SCRIPT, FORGET THE HEADER, and the loader silently stops
// executing. It does not error and it does not 404. It leaves a full-viewport
// overlay with a near-maximal z-index sitting over a working app, which is the
// exact regression that element's own comment calls "the difference between this
// being an improvement and a regression".
//
// So the hash is RECOMPUTED here from the bundle's own index.html and required to
// be present in the declared policy. The two are then incapable of drifting
// without this run saying so.
//
// ⚠️ HASHING THE REPOSITORY'S BYTES IS CORRECT, and that is measured rather than
// assumed: `flutter build web` substitutes only `$FLUTTER_BASE_HREF` in the <base>
// tag, which is outside every <script> element. Confirmed 2026-09-09 — the value
// computed from `apps/subscriptiontracker/web/index.html` was byte-identical to the hash a
// browser reported for the DEPLOYED page.
//
// ⚠️ AN INLINE EVENT HANDLER CANNOT BE HASHED AT ALL. `onclick=` and
// `href="javascript:"` need `'unsafe-hashes'`, which re-opens what the hash list
// closes, so their presence is a finding rather than something the header quietly
// accommodates.
/** The four directives every bundle policy must carry, and why each one.
 *  Kept as data so the failure message can name the reason rather than repeat
 *  the directive back at the reader. */
const CSP_FLOOR = [
  ["default-src 'self'", /default-src[^;]*'self'/i],
  ["object-src 'none'", /object-src[^;]*'none'/i],
  ["base-uri 'self'", /base-uri[^;]*'self'/i],
  ["frame-ancestors 'none'", /frame-ancestors[^;]*'none'/i],
];
const CSP_FLOOR_WHY = {
  "default-src 'self'":
    'Without it every fetch directive this policy does not name is UNRESTRICTED, so the policy only ' +
    'covers what somebody remembered to list.',
  "object-src 'none'":
    "<embed> and <object> are not covered by default-src in CSP3, so a policy without this line still " +
    'permits a plugin document to run in the page.',
  "base-uri 'self'":
    'An injected <base href> silently re-points every RELATIVE url in the document, including the ' +
    'script the loader fetches, and no other directive constrains it.',
  "frame-ancestors 'none'":
    'Same-origin framing between paths on one apex is otherwise unrestricted, so another app on ' +
    'nikatru.com could frame this one and drive it ([ADR 075]).',
};

/** Transport headers a bundle must set beside the policy. `_headers` is the only
 *  place they can be set for an app the apex router proxies to. */
const BUNDLE_SECURITY_HEADERS = [
  { name: 'X-Content-Type-Options', why: 'Without nosniff a response the edge types as text can still be executed as script.' },
  { name: 'X-Frame-Options', why: 'The pre-CSP framing control, still honoured by browsers that ignore frame-ancestors.' },
  { name: 'Referrer-Policy', why: 'The default leaks the full in-app URL, path and all, to every host the app calls.' },
  { name: 'Strict-Transport-Security', why: 'Without it the first request of a session can still be made over http and stripped.' },
];

// ⏱ 2026-10-01 · rv2-security-021 — A PERMISSIONS-POLICY, FLOORED. The static site
// has carried one since it was first written; the app bundle, served on the SAME
// origin, carried none, so a script injected into an app could ask for the camera,
// the microphone or the location from a page whose user had never been asked for
// any of them by this product. Each bundle's own `_headers` is the only place it
// can be set (the apex router proxies the app, and sites/nikatru/_headers does not
// reach a proxied response — see the CSP limb's message above).
// THE FLOOR IS THE THREE FEATURES NO APP HERE USES AND EVERY BROWSER PROMPTS FOR.
// The rest of each bundle's list is chosen in its `_headers`, from what the app
// does: `payment=()` there was checked against the checkout, which opens the
// hosted page in a NEW browsing context (packages/purchases UrlCheckoutLauncher,
// LaunchMode.externalApplication), never in a frame of this document.
const PERMISSIONS_FLOOR = ['camera', 'microphone', 'geolocation'];
/** `feature=(allowlist), …` → Map(feature → allowlist text). */
function parsePermissionsPolicy(value) {
  const out = new Map();
  for (const item of value.split(',')) {
    const m = item.trim().match(/^([a-z0-9-]+)\s*=\s*(.*)$/i);
    if (m) out.set(m[1].toLowerCase(), m[2].trim());
  }
  return out;
}

// ⏱ 2026-10-01 · rv2-security-021 — EVERY THIRD-PARTY SCRIPT HOST CARRIES ITS REASON.
// A host in `script-src` is code this origin runs that this repository does not
// hold, and the usual control for that — Subresource Integrity — is not always
// available: Turnstile's api.js is served unversioned and changed by Cloudflare
// without notice, so a pinned integrity hash would break the sign-up gate on
// Cloudflare's next push. The CSP host-pin is the control instead, and THAT is a
// decision, so it is written down where the host is: a comment line in the same
// `_headers`, of the shape
//     # script-src-host: <source exactly as in script-src> — <reason naming SRI>
// Both ways: a host with no such line ⇒ finding; a line for a host the policy no
// longer names ⇒ finding (a reason outliving its host reads as a live exception).
const SCRIPT_HOST_REASON = /^#\s*script-src-host:\s*(\S+)\s+—\s+(.*)$/;
const SCRIPT_HOST_MIN_REASON = 30;
let scriptHostsGraded = 0;
let permissionsPoliciesGraded = 0;

let cspBundlesChecked = 0;
let cspHashesChecked = 0;
let cspBundlesWithInline = 0;
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const INLINE_HANDLER = /(\son[a-z]+\s*=\s*["'])|(["']javascript:)/i;
for (const b of bundles.filter((x) => x.kind === 'flutter-web')) {
  const headersAbs = join(ROOT, ...b.dir.split('/'), '_headers');
  const indexAbs = join(ROOT, ...b.dir.split('/'), 'index.html');
  if (!existsSync(headersAbs) || !existsSync(indexAbs)) continue;
  const headersSrc = readFileSync(headersAbs, 'utf8');
  // Comment lines are stripped first: this file is mostly prose, and the prose
  // quotes the very directive being looked for.
  const declared = headersSrc
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  const cspMatch = declared.match(/Content-Security-Policy:\s*(.+)/i);
  const html = readFileSync(indexAbs, 'utf8');
  const bodies = [...html.matchAll(INLINE_SCRIPT)].map((m) => m[1]).filter((x) => x.trim() !== '');
  // ⏱ 2026-09-12 · A MISSING POLICY IS THE FINDING, INLINE SCRIPT OR NOT. This
  // limb used to fire only when index.html carried an inline <script>, so a bundle
  // with no inline script and NO CSP passed in silence — which is exactly what
  // `tooling/bricks/app/__brick__/apps/{{app_id}}/web/_headers` was: the template
  // shipped no security headers at all, so every app stamped from it was born with
  // none, while `apps/subscriptiontracker` had carried a real policy since
  // 2026-09-09 ([ADR 075]). Found by the factory-vs-app drift audit
  // (research/factory-drift-2026-09-12/), not by this guard, and the near-miss is
  // the lesson: a guard that scans the brick and still cannot see the brick's gap
  // reads as coverage without being it.
  if (!cspMatch) {
    problems.push(
      `${b.dir}/_headers declares no Content-Security-Policy` +
        (bodies.length > 0 ? ` while ${b.dir}/index.html carries ${bodies.length} inline <script> block(s)` : '') +
        `. Since [ADR 075] an app is published at nikatru.com/<id> — the SAME ORIGIN as the marketing ` +
        `site, the pricing page and every other app, with the session token in that origin's web storage, ` +
        `so an XSS in one reaches all of it. A bundle with no policy inherits nothing: _headers is applied ` +
        `by the asset-serving stage, so sites/nikatru/_headers never reaches a response the apex router ` +
        `returns from a proxy fetch. Copy the block from the app template's web/_headers.`,
    );
    continue;
  }
  cspBundlesChecked++;
  if (bodies.length > 0) cspBundlesWithInline++;
  const csp = cspMatch[1];

  // 🔴 THE FLOOR, NOT THE WHOLE POLICY. Each directive below closes a hole that
  // costs nothing to close and that a hand-written policy forgets in a
  // recognisable order: an absent `default-src` makes every unlisted fetch
  // directive unrestricted; `object-src` still governs <embed>/<object>, which
  // `default-src` does NOT cover in CSP3; `base-uri` is how an injected <base>
  // re-points every relative URL in the document; and `frame-ancestors` is the
  // only one of the four that same-origin framing between app paths on one apex
  // makes load-bearing. This limb does not grade the rest of the policy · the
  // hash limb below and the transport-header limb do their own parts.
  for (const [want, re] of CSP_FLOOR) {
    if (!re.test(csp)) {
      problems.push(
        `${b.dir}/_headers has a Content-Security-Policy that does not declare ${want}. ` +
          `${CSP_FLOOR_WHY[want]}`,
      );
    }
  }
  for (const h of BUNDLE_SECURITY_HEADERS) {
    if (!new RegExp(`^\\s*${h.name}\\s*:`, 'im').test(declared)) {
      problems.push(`${b.dir}/_headers declares no ${h.name}. ${h.why}`);
    }
  }
  const ppMatch = declared.match(/^\s*Permissions-Policy:\s*(.+)$/im);
  if (!ppMatch) {
    problems.push(
      `${b.dir}/_headers declares no Permissions-Policy. The app is served on the nikatru.com origin, where the ` +
        'static site already denies the device features; a bundle without one leaves a script injected into the app ' +
        `free to ask for ${PERMISSIONS_FLOOR.join(', ')}. Choose the list from the features the app uses.`,
    );
  } else {
    permissionsPoliciesGraded++;
    const pp = parsePermissionsPolicy(ppMatch[1]);
    const open = PERMISSIONS_FLOOR.filter((f) => pp.get(f) !== '()');
    if (open.length) {
      problems.push(
        `${b.dir}/_headers Permissions-Policy does not deny ${open.map((f) => `${f}=()`).join(', ')}. No app on this ` +
          'origin uses them, and each is a prompt an injected script could put in front of a user in this product\'s name.',
      );
    }
  }
  // Every host source in script-src carries a recorded reason (see SCRIPT_HOST_REASON).
  {
    const scriptSrc = csp.match(/(?:^|;)\s*script-src\s+([^;]*)/i)?.[1] ?? '';
    const hosts = scriptSrc.split(/\s+/).filter((s) => s !== '' && !s.startsWith("'"));
    const reasons = new Map();
    for (const l of headersSrc.split('\n')) {
      const m = l.trim().match(SCRIPT_HOST_REASON);
      if (m) reasons.set(m[1], m[2].trim());
    }
    for (const h of hosts) {
      scriptHostsGraded++;
      const why = reasons.get(h);
      if (why === undefined) {
        problems.push(
          `${b.dir}/_headers script-src admits ${h} and records no reason for it. A third-party script host is code ` +
            'this origin runs and this repository does not hold; write `# script-src-host: ' + h + ' — <reason>` beside ' +
            'the policy, saying why it carries no Subresource Integrity hash and what pins it instead.',
        );
      } else if (why.length < SCRIPT_HOST_MIN_REASON || !/\bSRI\b/.test(why)) {
        problems.push(
          `${b.dir}/_headers records a reason for script-src host ${h} that does not say why it carries no SRI ` +
            `(at least ${SCRIPT_HOST_MIN_REASON} characters, naming SRI): ${JSON.stringify(why)}.`,
        );
      }
    }
    for (const h of reasons.keys()) {
      if (!hosts.includes(h)) {
        problems.push(
          `${b.dir}/_headers records a script-src-host reason for ${h}, and script-src no longer admits it. Remove the ` +
            'reason with the host; one that outlives it reads as a live exception nobody is taking.',
        );
      }
    }
  }
  if (/script-src[^;]*'unsafe-inline'/i.test(csp)) {
    problems.push(
      `${b.dir}/_headers declares script-src 'unsafe-inline'. On one shared origin that lets an injected ` +
        `script on ANY path of the apex execute, including the pages that have never had a script of their ` +
        `own, and it reaches every app's session token in shared web storage. Use a 'sha256-…' per block.`,
    );
  }
  if (INLINE_HANDLER.test(html)) {
    problems.push(
      `${b.dir}/index.html carries an inline event handler or a javascript: URL. Neither can be covered by a ` +
        `CSP hash — they need 'unsafe-hashes', which reopens exactly what the hash list closes.`,
    );
  }
  for (const body of bodies) {
    const want = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    cspHashesChecked++;
    if (!csp.includes(want)) {
      problems.push(
        `${b.dir}/_headers script-src does not carry ${want}, the hash of an inline <script> in ` +
          `${b.dir}/index.html. That block will be BLOCKED at runtime — silently: no error page, no 404, ` +
          `just a script that never runs. Recompute the hash into the header in the same commit as the edit.`,
      );
    }
  }
}
// ⏱ 2026-09-12 · THE FLOOR IS BUNDLES WITH AN INLINE SCRIPT, NOT BUNDLES WITH A
// POLICY. It read `cspBundlesChecked > 0 && cspHashesChecked === 0`, which was right
// only while a CSP implied an inline script to hash. Every bundle owes a policy now,
// and the app template legitimately has NO inline script (its index.html loads
// `flutter_bootstrap.js` by src alone), so the old condition made a correct tree
// exit 2. The claim worth defending is unchanged: if a bundle HAS inline blocks and
// none were hashed, the matcher has stopped matching and this limb is printing ok
// about a policy it did not check.
if (cspBundlesWithInline > 0 && cspHashesChecked === 0) {
  console.error(
    'assert-web-cache-policy: COVERAGE LOST — a flutter-web bundle carries inline <script> block(s) and a\n' +
      '    CSP, but this run hashed ZERO of them. Either the inline-script matcher has stopped matching or\n' +
      '    index.html moved; both leave this limb printing ok about a policy it did not check.',
  );
  process.exit(2);
}

// ── THE nikatru.com STATIC-SITE CSP, EVERY LINE OF IT, AND EVERY PER-PATH OVERRIDE
//
// ⏱ 2026-09-30 · rv2-security-005 (O-EXT-CONNECT-CSP-HAS-NO-READER). The limb above
// reads flutter-web bundles only, so the static site that shares the nikatru.com
// origin with every app's session had NO reader of its policy. The discovery
// generator (tooling/sites/generate-discovery.mjs) rewrites the script-src of the
// FIRST CSP line of sites/nikatru/_headers at deploy and touches nothing else, so:
//   · the /ext/connect block — the signed-in page that hands an extension its link
//     code — detaches the global policy (`! Content-Security-Policy`) and restates
//     it. Deleting the restated line while keeping the detach served that page with
//     NO policy at all, and CI stayed green;
//   · the non-script floor (default-src, object-src, base-uri, frame-ancestors,
//     form-action) was held by nothing on either line.
// 🔄 2026-10-01 · rv2-security-021 — APPENDED: the generator now splices the
// script-src of EVERY CSP line of that file, the /ext/connect override included
// (`CSP_LINE_RE` is global), so an override's hash list is computed, not copied.
// What it splices is script-src only; every other directive of an override is
// still a hand-written line, and this limb is still the one reader of it.
//
// WHAT IS ASSERTED, over the static sites tooling/ci/site-csp.json puts IN SCOPE
// (the nikatru.com origin; every static deploy root must be declared in scope or
// out of it, with a reason, both ways — so a new site cannot arrive unassessed):
//   1. the `/*` rule carries a Content-Security-Policy, and it meets the floor;
//   2. every OTHER rule that sets or detaches (`! Content-Security-Policy`) a CSP
//      is an OVERRIDE, and an override must be DECLARED with a reason. Undeclared
//      ⇒ finding;
//   3. a declared override whose block no longer sets a CSP ⇒ finding (the
//      override silently lost its policy — the detach-without-restate case);
//   4. each override's CSP meets the same floor, and its script-src admits no
//      source the global line's script-src does not (hashes aside): an override may
//      widen connect-src, never script execution;
//   5. RESOLVED THE WAY CLOUDFLARE DOES IT: at every override path and at the entry
//      points, the policies that SURVIVE the detaches (a value from rule R survives
//      unless another matching rule detaches the header) must be non-empty.
//   A declared override or scoped site the tree no longer has ⇒ COVERAGE LOST: the
//   declaration promises a check this run cannot make.
//
// ⚠️ OUT OF SCOPE BY DECLARATION, NOT BY OMISSION: sites/rajasekarselvam is its own
// origin and carries script-src 'unsafe-inline'; site-csp.json says so and why.
const SITE_CSP_DECLARATION = 'tooling/ci/site-csp.json';
const SITE_CSP_MIN_WHY = 20;
const SITE_CSP_ANCHOR = 'sites/nikatru';
/** The floor every in-scope CSP line must hold — read off the global line of
 *  sites/nikatru/_headers as it stood on 2026-09-30, which holds all of it. */
const SITE_CSP_FLOOR = [
  { dir: 'default-src', ok: (v) => v.length > 0 && v.every((s) => s === "'self'" || s === "'none'"), want: "default-src 'self' (or 'none'), and nothing broader" },
  { dir: 'object-src', ok: (v) => v.length === 1 && v[0] === "'none'", want: "object-src 'none'" },
  { dir: 'base-uri', ok: (v) => v.length > 0 && v.every((s) => s === "'self'" || s === "'none'"), want: "base-uri 'self' (or 'none')" },
  { dir: 'frame-ancestors', ok: (v) => v.length === 1 && v[0] === "'none'", want: "frame-ancestors 'none'" },
  { dir: 'form-action', ok: (v) => v.length > 0 && v.every((s) => s === "'self'" || s === "'none'"), want: "form-action 'self' (or 'none')" },
];
/** script-src sources no in-scope line may carry: each re-opens what the hash list closes. */
const SCRIPT_SRC_FORBIDDEN = /^('unsafe-inline'|'unsafe-eval'|'unsafe-hashes'|'wasm-unsafe-eval'|\*|[a-z][a-z0-9+.-]*:)$/i;
const HASH_SOURCE = /^'(sha256|sha384|sha512)-[A-Za-z0-9+/=_-]+'$/;

/** CSP value → Map(directive → sources[]). The FIRST occurrence of a directive
 *  wins, as the CSP spec says a repeated directive is ignored. */
function parseCsp(value) {
  const out = new Map();
  for (const part of value.split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    const name = toks[0].toLowerCase();
    if (!out.has(name)) out.set(name, toks.slice(1));
  }
  return out;
}

/**
 * A Cloudflare `_headers` file as an ORDERED list of blocks, keeping what
 * parseHeaders() drops: a header set twice, and the `! Name` DETACH lines
 * (developers.cloudflare.com/pages/configuration/headers/ — "Detach a header").
 */
function parseHeaderBlocks(text) {
  const blocks = [];
  let cur = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      cur = { pattern: line.trim(), line: i + 1, sets: [], detaches: [] };
      blocks.push(cur);
      continue;
    }
    if (cur === null) continue;
    const t = line.trim();
    const d = t.match(/^!\s*([A-Za-z0-9-]+)\s*$/);
    if (d) {
      cur.detaches.push({ name: d[1].toLowerCase(), line: i + 1 });
      continue;
    }
    const m = t.match(/^([A-Za-z0-9-]+)\s*:\s*(.*)$/);
    if (m) cur.sets.push({ name: m[1].toLowerCase(), value: m[2].trim(), line: i + 1 });
  }
  return blocks;
}

/** The CSP values that SURVIVE at `path`: every matching block's value, minus the
 *  values of any block that ANOTHER matching block detaches the header from. */
function effectiveCsps(blocks, path) {
  const matching = blocks.filter((b) => compilePattern(b.pattern).test(path));
  const out = [];
  for (const b of matching) {
    const detachedByOther = matching.some((o) => o !== b && o.detaches.some((d) => d.name === 'content-security-policy'));
    if (detachedByOther) continue;
    for (const s of b.sets) if (s.name === 'content-security-policy') out.push({ block: b, value: s.value });
  }
  return out;
}

/** The floor findings for one CSP line; `globalScript` is the global line's
 *  script-src (null when grading the global line itself). */
function gradeSiteCsp(where, value, globalScript) {
  const found = [];
  const csp = parseCsp(value);
  for (const f of SITE_CSP_FLOOR) {
    const v = csp.get(f.dir);
    if (!v || !f.ok(v)) found.push(`${where} does not hold ${f.want} (it has ${v ? `"${f.dir} ${v.join(' ')}"` : 'no ' + f.dir}).`);
  }
  const script = csp.get('script-src') ?? csp.get('default-src') ?? [];
  const bad = script.filter((s) => SCRIPT_SRC_FORBIDDEN.test(s));
  if (bad.length) {
    found.push(
      `${where} script-src admits ${bad.join(', ')}. On the one origin every app's session lives on, that lets an ` +
        'injected script execute; the site runs on per-block hashes and must keep doing so.',
    );
  }
  if (globalScript) {
    const allowed = new Set(globalScript.filter((s) => !HASH_SOURCE.test(s)));
    const wider = script.filter((s) => !HASH_SOURCE.test(s) && !SCRIPT_SRC_FORBIDDEN.test(s) && !allowed.has(s));
    if (wider.length) {
      found.push(
        `${where} script-src admits ${wider.join(', ')}, which the global /* policy does not. An override exists ` +
          'to widen what ONE page may connect to, never where script may come from.',
      );
    }
  }
  return found;
}

// ⏱ 2026-10-02 · #1095 review finding 3. Rule 4 bounded an override's script-src only, so
// `connect-src *` on /ext/connect — the page that holds a fresh GoTrue session — passed: the very
// directive the override exists to widen was the one nobody bounded. Now EVERY directive of an
// override is a subset of the global line's (a fetch directive the global line omits inherits its
// default-src) plus the sources site-csp.json declares for that override under `adds`, and each
// declared addition is one concrete https origin: no `*`, no wildcard host, no bare scheme.
const CSP_FETCH_DIRECTIVES = new Set([
  'child-src', 'connect-src', 'font-src', 'frame-src', 'img-src', 'manifest-src', 'media-src', 'object-src',
  'prefetch-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'worker-src',
]);
const CSP_ADD_SOURCE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/;
/** Findings for an override's sources beyond the global line's plus its declared `adds`. */
function gradeOverrideSources(where, value, globalValue, adds) {
  const found = [];
  const own = parseCsp(value);
  const global = parseCsp(globalValue);
  for (const [dir, sources] of own) {
    const base = global.get(dir) ?? (CSP_FETCH_DIRECTIVES.has(dir) ? global.get('default-src') ?? [] : []);
    const allowed = new Set([...base, ...(Array.isArray(adds?.[dir]) ? adds[dir] : [])]);
    const extra = sources.filter((s) => !allowed.has(s) && !HASH_SOURCE.test(s));
    if (extra.length) {
      found.push(
        `${where} ${dir} admits ${extra.join(', ')}, which neither the global /* policy nor the override's declared ` +
          `\`adds.${dir}\` in ${SITE_CSP_DECLARATION} allows. An override widens exactly the origins it declares, nothing else.`,
      );
    }
  }
  return found;
}

let siteCspLines = 0;
let siteCspSites = 0;
let siteCspOverrides = 0;
{
  const staticSites = bundles.filter((b) => b.kind === 'static-site').map((b) => b.dir);
  const declAbs = join(ROOT, ...SITE_CSP_DECLARATION.split('/'));
  if (staticSites.length > 0 && !existsSync(declAbs)) {
    coverageLost([
      `${SITE_CSP_DECLARATION} is absent, and ${staticSites.length} static deploy root(s) were scanned (${staticSites.join(', ')}).`,
      'That file says which static sites are on the nikatru.com origin and which per-path CSP overrides are',
      'intended. Without it the site CSP limb has no subject, and would print ok about a policy it never read.',
    ]);
  }
  if (existsSync(declAbs)) {
    let decl;
    try {
      decl = JSON.parse(readFileSync(declAbs, 'utf8'));
    } catch (e) {
      coverageLost([`${SITE_CSP_DECLARATION} does not parse as JSON: ${e.message}`]);
    }
    const inScope = Array.isArray(decl.inScope) ? decl.inScope : [];
    const outOfScope = Array.isArray(decl.outOfScope) ? decl.outOfScope : [];
    const overrides = Array.isArray(decl.overrides) ? decl.overrides : [];
    for (const e of [...inScope, ...outOfScope, ...overrides]) {
      if (typeof e?.site !== 'string' || typeof e?.why !== 'string' || e.why.trim().length < SITE_CSP_MIN_WHY) {
        problems.push(
          `${SITE_CSP_DECLARATION}: entry ${JSON.stringify(e)} needs a "site" and a "why" of at least ${SITE_CSP_MIN_WHY} ` +
            'characters. A declaration without its reason is an allow-list entry nobody can review.',
        );
      }
    }
    const declaredSites = new Set([...inScope, ...outOfScope].map((e) => e?.site));
    // BOTH WAYS: a scanned root nobody assessed is a finding; a declared root the
    // scan never found is a promise this run cannot keep.
    for (const s of staticSites) {
      if (!declaredSites.has(s)) {
        problems.push(
          `${s} is a static deploy root that ${SITE_CSP_DECLARATION} neither puts in scope nor out of scope. ` +
            'Declare whether it is served on the nikatru.com origin (its CSP is then graded here) or why it is not.',
        );
      }
    }
    const staleSites = [...declaredSites].filter((s) => typeof s === 'string' && !staticSites.includes(s));
    if (staleSites.length) {
      coverageLost([
        `${SITE_CSP_DECLARATION} declares ${staleSites.join(', ')}, and the scan found no such static deploy root.`,
        'The declaration is stale: it promises a site CSP check this run did not make.',
      ]);
    }
    const inScopeSites = new Set(inScope.map((e) => e?.site));
    // THE ANCHOR, the mirror of BRICK_WEB above: the both-ways check lets the one
    // site this limb exists for be moved to outOfScope with a plausible reason, and
    // every line below would then grade nothing while printing ok.
    if (staticSites.includes(SITE_CSP_ANCHOR) && !inScopeSites.has(SITE_CSP_ANCHOR)) {
      coverageLost([
        `${SITE_CSP_ANCHOR} is scanned and ${SITE_CSP_DECLARATION} does not put it in scope.`,
        'It is the nikatru.com deploy root, served on the origin beside every app\'s session (ADR 075); it is the',
        'subject this limb exists for, and declaring it out of scope retires the limb silently.',
      ]);
    }
    for (const o of overrides) {
      if (typeof o?.path !== 'string' || !inScopeSites.has(o.site)) {
        problems.push(
          `${SITE_CSP_DECLARATION}: override ${JSON.stringify(o)} needs a "path" and a "site" that is declared in scope.`,
        );
      }
      const adds = o?.adds ?? {};
      if (typeof adds !== 'object' || adds === null || Array.isArray(adds)) {
        problems.push(`${SITE_CSP_DECLARATION}: override ${o?.path} has an \`adds\` that is not a {directive: [origin, …]} object.`);
        continue;
      }
      for (const [dir, list] of Object.entries(adds)) {
        const bad = Array.isArray(list) ? list.filter((s) => typeof s !== 'string' || !CSP_ADD_SOURCE.test(s)) : [list];
        if (bad.length) {
          problems.push(
            `${SITE_CSP_DECLARATION}: override ${o?.path} declares \`adds.${dir}\` ${JSON.stringify(bad)}; each addition is ONE ` +
              'concrete https origin (https://host[:port]) — never `*`, a wildcard host or a bare scheme, which would admit every origin.',
          );
        }
      }
    }

    for (const site of staticSites.filter((s) => inScopeSites.has(s))) {
      const rel = `${site}/_headers`;
      const abs = join(ROOT, ...rel.split('/'));
      if (!existsSync(abs)) continue; // the cache limb already reported the missing file
      const blocks = parseHeaderBlocks(readFileSync(abs, 'utf8'));
      siteCspSites++;
      const setsCsp = (b) => b.sets.some((s) => s.name === 'content-security-policy');
      const detachesCsp = (b) => b.detaches.some((d) => d.name === 'content-security-policy');

      // 1. the global line
      const globals = blocks.filter((b) => b.pattern === '/*' && setsCsp(b));
      let globalScript = null;
      let globalValue = null;
      if (globals.length === 0) {
        problems.push(
          `${rel} has no Content-Security-Policy on its /* rule. That is the policy every page of the nikatru.com ` +
            'site runs under, beside every app\'s session on the same origin.',
        );
      }
      for (const g of globals) {
        for (const s of g.sets.filter((x) => x.name === 'content-security-policy')) {
          siteCspLines++;
          problems.push(...gradeSiteCsp(`${rel}:${s.line} (the /* policy)`, s.value, null));
          globalScript ??= parseCsp(s.value).get('script-src') ?? parseCsp(s.value).get('default-src') ?? [];
          globalValue ??= s.value;
        }
      }
      // ⏱ 2026-10-01 · rv2-security-021 — the site's /* rule holds the same
      // Permissions-Policy floor the app bundles are held to (PERMISSIONS_FLOOR).
      const pps = blocks.filter((b) => b.pattern === '/*').flatMap((b) => b.sets.filter((s) => s.name === 'permissions-policy'));
      if (pps.length === 0) {
        problems.push(`${rel} has no Permissions-Policy on its /* rule; every page of the site would let a script ask for ${PERMISSIONS_FLOOR.join(', ')}.`);
      }
      for (const s of pps) {
        permissionsPoliciesGraded++;
        const open = PERMISSIONS_FLOOR.filter((f) => parsePermissionsPolicy(s.value).get(f) !== '()');
        if (open.length) problems.push(`${rel}:${s.line} the /* Permissions-Policy does not deny ${open.map((f) => `${f}=()`).join(', ')}.`);
      }
      for (const g of blocks.filter((b) => b.pattern === '/*' && detachesCsp(b))) {
        problems.push(`${rel}:${g.line} the /* rule detaches Content-Security-Policy, which leaves every page of the site with none.`);
      }

      // 2. every other block that sets or detaches a CSP is an override
      const declared = overrides.filter((o) => o?.site === site);
      const declaredPaths = new Set(declared.map((o) => o.path));
      for (const b of blocks.filter((x) => x.pattern !== '/*' && (setsCsp(x) || detachesCsp(x)))) {
        if (!declaredPaths.has(b.pattern)) {
          problems.push(
            `${rel}:${b.line} "${b.pattern}" ${detachesCsp(b) ? 'detaches' : 'sets'} a Content-Security-Policy and is not ` +
              `declared in ${SITE_CSP_DECLARATION}. A per-path policy on the origin every app's session lives on must be ` +
              'declared with its reason — the discovery generator splices only the script-src of each CSP line, so ' +
              'nothing else keeps the rest of an override honest.',
          );
        }
      }
      // 3 + 4. each declared override: present, still carrying a CSP, and floored
      const stale = [];
      for (const o of declared) {
        const own = blocks.filter((b) => b.pattern === o.path);
        if (own.length === 0) {
          stale.push(o.path);
          continue;
        }
        siteCspOverrides++;
        const lines = own.flatMap((b) => b.sets.filter((s) => s.name === 'content-security-policy'));
        if (lines.length === 0) {
          problems.push(
            `${rel} "${o.path}" is a declared CSP override whose block no longer sets a Content-Security-Policy` +
              (own.some(detachesCsp) ? ' while it still DETACHES the global one — that page is served with NO policy' : '') +
              '. Restate the whole policy in the block, or remove the override and its declaration together.',
          );
        }
        for (const s of lines) {
          siteCspLines++;
          problems.push(...gradeSiteCsp(`${rel}:${s.line} (the "${o.path}" override)`, s.value, globalScript));
          if (globalValue !== null) problems.push(...gradeOverrideSources(`${rel}:${s.line} (the "${o.path}" override)`, s.value, globalValue, o.adds));
        }
      }
      if (stale.length) {
        coverageLost([
          `${SITE_CSP_DECLARATION} declares CSP override(s) ${stale.join(', ')} on ${site}, and ${rel} has no such block.`,
          'The declaration is stale: it promises a check on an override this run could not find. Remove it with the block.',
        ]);
      }
      // 5. resolved: what survives the detaches at each override and entry point
      const EMPTY_PROBES = [...ENTRY_POINTS['static-site'], ...declared.map((o) => o.path).filter((p) => !/[*:]/.test(p))];
      for (const p of EMPTY_PROBES) {
        if (effectiveCsps(blocks, p).length === 0) {
          problems.push(
            `${rel}: a request for "${p}" is served with NO Content-Security-Policy once Cloudflare applies the ` +
              '`! Content-Security-Policy` detaches (a value survives unless another matching rule detaches it).',
          );
        }
      }
    }
    // NO "zero lines graded" floor, deliberately: an in-scope site either grades its
    // /* line or reports that line missing as a FINDING, so such a floor could never
    // fire (measured: it pre-empted that finding with exit 2 and was otherwise
    // unreachable). The emptiable domain is the SET of in-scope sites, and the
    // SITE_CSP_ANCHOR check above is its floor.
  }
}

const FUNCTION_SECURITY_HEADERS = [
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'strict-transport-security',
  'content-security-policy',
];

let functionFilesChecked = 0;
let functionDirsFound = 0;
if (sitesDirExists) {
  for (const site of listDir(sitesDir)) {
    const fnDir = join(sitesDir, site, 'functions');
    if (!existsSync(fnDir)) continue;
    functionDirsFound++;
    const stack = [fnDir];
    const files = [];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of listDir(dir, { withFileTypes: true })) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (/\.(js|mjs|ts)$/i.test(e.name)) files.push(abs);
      }
    }
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8');
      // 🔴 STRIP COMMENTS FIRST. The first version of this limb counted the
      // sentence "a second `new Response(...)` added later is the way this
      // regresses" — a comment in subscribe.js WARNING about the very defect —
      // as a second construction site, and failed the build on its own prose.
      // CLAUDE.md's recorded rule, one file over: assert on structure, never by
      // grepping prose.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const constructions = (code.match(/new\s+Response\s*\(/g) ?? []).length;
      if (constructions === 0) continue;
      functionFilesChecked++;
      const rel = relative(ROOT, abs).split(sep).join('/');

      if (constructions > 1) {
        problems.push(
          `${rel} constructs a Response ${constructions} times. A Pages Function receives NONE of the ` +
            `deploy root's _headers, so every Response it builds carries only the headers written at that ` +
            `construction site. Route them all through one helper, so there is one place the security ` +
            `header set can be read off and one place it can go missing.`,
        );
        continue;
      }
      const missing = FUNCTION_SECURITY_HEADERS.filter((h) => !new RegExp(`["']${h}["']\\s*:`, 'i').test(code));
      if (missing.length) {
        problems.push(
          `${rel} builds a Response without ${missing.join(', ')}. _headers does not apply to Pages ` +
            `Functions (developers.cloudflare.com/pages/configuration/headers/), so this route answers with ` +
            `no header policy at all while every static page on the same origin carries the full set.`,
        );
      }
    }
  }
}

// The floor is conditioned on a functions/ directory EXISTING, not on a static
// root existing: a Pages site with no Functions is an ordinary, correct site, and
// a floor that demanded one would fail every fixture that is merely static. What
// must never happen is a functions/ directory that the walk enters and comes back
// from empty — that is the shape that reports "clean" about the one endpoint
// `_headers` can never cover.
if (functionDirsFound > 0 && functionFilesChecked === 0) {
  coverageLost([
    `${functionDirsFound} sites/*/functions/ director(ies) exist and the Pages-Function limb evaluated ZERO files.`,
    'sites/nikatru/functions/api/subscribe.js is the one Function this repo deploys, and it is the only',
    'route on the origin that accepts a POST body. A walk that stops descending, or a file-extension',
    'filter that stops matching, empties this limb while every line above it still prints a result.',
  ]);
}

// ── THE OFFLINE SHELL: OUR OWN WORKER, RUN RATHER THAN READ ─────────────────
//
// ⏱ 2026-10-01 · [ADR 023] as amended 2026-09-30 (row
// O-WEB-OFFLINE-COLD-LOAD-IS-BROWSER-ERROR). Every flutter-web bundle ships
// `web/sw.js`, registered by `web/sw-register.js`, and the amendment binds it to
// five rules. The ones a file can be held to are held here:
//
//   1. OUR OWN WORKER: index.html loads sw-register.js, which registers `sw.js`,
//      and no bundle file names Flutter's `flutter_service_worker` or hands its
//      loader a `serviceWorkerSettings`.
//   2. NETWORK-FIRST: with the network answering, the worker returns the
//      NETWORK's response, never a copy it holds; with the network failing, it
//      returns the copy it holds.
//   3. ONE CACHE PER BUILD: installed as `sw.js?build=41` and as `?build=42`, it
//      opens disjoint caches, each naming its build, and activating 42 deletes
//      41's.
//   4. THE SHARED ORIGIN: every cache (and any IndexedDB) name carries
//      `nikatru-<id>-`; activating never deletes another app's cache; a scope
//      other than /<id>/ is refused at install; and `Service-Worker-Allowed` is
//      declared NOWHERE — not in any bundle's `_headers`, not in a Pages Function.
//   It also never stores an API response, a request carrying credentials, a
//   `no-store` response, an out-of-scope path or version.json.
//
// 🔴 WHY THE WORKER IS EXECUTED AND NOT GREPPED. "Network-first" is a property of
// control flow — which of `fetch()` and `caches.match()` decides the answer — and
// a regex over source cannot tell `try { fetch } catch { cache }` from a
// stale-while-revalidate that reads the cache first and fetches behind it. So
// the file is run in a `node:vm` context standing in for a
// ServiceWorkerGlobalScope: a fake Cache Storage, a network that answers or
// rejects on command, and the install/activate/fetch events dispatched the way a
// browser dispatches them. Each finding is what the worker DID.
//
// ⚠️ WHAT THIS CANNOT SEE: a real browser's worker lifecycle (update checks,
// clients.claim timing, what a real reload falls back to). That is
// tooling/smoke/smoke-web-artifact.mjs's offline leg, run on the built bundle in
// headless Chrome before every deploy — with its red control.
// Imported HERE, not at the top: a line added above :508 would move the span
// sites/nikatru/_headers cites (assert-web-cache-policy.mjs:508-517).
const { runInNewContext } = await import('node:vm');
const WORKER_FILE = 'sw.js';
const REGISTER_FILE = 'sw-register.js';
const SIM_ORIGIN = 'https://nikatru.com';
const SIM_API = 'https://subscriptiontracker-api.nikatru.com/v1/subscriptions';
const SIM_SETTLE_MS = 3000;
const FLUTTER_WORKER_NAMES = /flutter_service_worker|serviceWorkerSettings/;

/** A file's text, or null when it is absent: read, never checked-then-read (CodeQL js/file-system-race). */
const readOrNull = (abs) => {
  try {
    return readFileSync(abs, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
};
const stripJsComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/** A promise that rejects, naming `what`, when `p` has not settled in time. */
function settle(p, what) {
  let timer;
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not settle within ${SIM_SETTLE_MS} ms`)), SIM_SETTLE_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** One Cache: request URL -> Response. */
class SimCache {
  constructor(storage) {
    this.storage = storage;
    this.entries = new Map();
  }
  key(r) {
    return typeof r === 'string' ? new URL(r, this.storage.base).href : r.url;
  }
  async match(r) {
    return this.entries.get(this.key(r))?.clone();
  }
  async put(r, response) {
    this.entries.set(this.key(r), response);
  }
  async add(r) {
    const response = await this.storage.fetch(typeof r === 'string' ? new Request(this.key(r)) : r);
    if (!response.ok) throw new TypeError(`cache.add: ${response.status} for ${this.key(r)}`);
    this.entries.set(this.key(r), response);
  }
  async addAll(rs) {
    for (const r of rs) await this.add(r);
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(r) {
    return this.entries.delete(this.key(r));
  }
}

/** The origin's Cache Storage — shared, like the real one, by every app on it. */
class SimCacheStorage {
  constructor(base, fetchImpl) {
    this.base = base;
    this.fetch = fetchImpl;
    this.stores = new Map();
    this.opened = new Set();
  }
  async open(name) {
    const n = String(name);
    this.opened.add(n);
    if (!this.stores.has(n)) this.stores.set(n, new SimCache(this));
    return this.stores.get(n);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async has(name) {
    return this.stores.has(String(name));
  }
  async delete(name) {
    return this.stores.delete(String(name));
  }
  async match(r) {
    for (const c of this.stores.values()) {
      const hit = await c.match(r);
      if (hit) return hit;
    }
    return undefined;
  }
  /** Every URL any cache holds. */
  heldUrls() {
    return [...this.stores.values()].flatMap((c) => [...c.entries.keys()]);
  }
}

/**
 * Boot `src` as a worker registered at `<scope>sw.js?build=<build>`.
 * Returns the harness, or { error } when the script does not evaluate.
 */
function bootWorker(src, { scope, build, storage }) {
  const listeners = new Map();
  const net = { online: true };
  const fetchImpl = async (input) => {
    const url = typeof input === 'string' ? new URL(input, scope).href : input.url;
    if (!net.online) throw new TypeError('Failed to fetch');
    const noStore = url.includes('no-store-probe');
    const response = new Response(`NETWORK ${url}`, {
      status: 200,
      headers: { 'content-type': 'text/plain', 'cache-control': noStore ? 'no-store' : 'public, max-age=0, must-revalidate' },
    });
    Object.defineProperty(response, 'type', { value: new URL(url).origin === SIM_ORIGIN ? 'basic' : 'cors' });
    return response;
  };
  const caches = storage ?? new SimCacheStorage(scope, fetchImpl);
  caches.base = scope;
  caches.fetch = fetchImpl;
  const idbNames = [];
  const script = new URL(`sw.js?build=${encodeURIComponent(build)}`, scope);
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    structuredClone,
    caches,
    fetch: fetchImpl,
    indexedDB: { open: (name) => { idbNames.push(String(name)); return {}; }, deleteDatabase: (name) => { idbNames.push(String(name)); return {}; } },
    location: script,
    registration: { scope },
    clients: { claim: async () => {}, matchAll: async () => [] },
    skipWaiting: async () => {},
    importScripts: () => {
      throw new Error('importScripts is not part of the offline shell');
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  try {
    runInNewContext(src, sandbox, { filename: 'sw.js', timeout: 1000 });
  } catch (e) {
    return { error: e };
  }

  /** Dispatch an extendable event; resolves once every waitUntil settled. */
  async function lifecycle(type) {
    const waits = [];
    const event = { type, waitUntil: (p) => waits.push(Promise.resolve(p)) };
    for (const fn of listeners.get(type) ?? []) fn(event);
    await settle(Promise.all(waits), `the ${type} event`);
  }

  /** Dispatch a fetch event. Resolves to { responded, body } — body null when no respondWith. */
  async function request(req) {
    const waits = [];
    let answer = null;
    const event = {
      type: 'fetch',
      request: req,
      clientId: '',
      waitUntil: (p) => waits.push(Promise.resolve(p)),
      respondWith: (p) => {
        if (answer) throw new Error('respondWith called twice');
        answer = Promise.resolve(p);
      },
    };
    for (const fn of listeners.get('fetch') ?? []) fn(event);
    if (!answer) {
      await settle(Promise.all(waits), 'a fetch event');
      return { responded: false, body: null };
    }
    let body;
    try {
      const response = await settle(answer, `the answer to ${req.url}`);
      body = await response.text();
    } catch (e) {
      body = null;
      await settle(Promise.allSettled(waits), 'a fetch event');
      return { responded: true, body, error: e };
    }
    await settle(Promise.all(waits), 'a fetch event');
    return { responded: true, body };
  }

  return { listeners, caches, net, lifecycle, request, idbNames };
}

/** A navigation request, which `new Request` cannot construct (mode is forbidden). */
const navigation = (url) => ({
  url,
  method: 'GET',
  mode: 'navigate',
  headers: new Headers({ accept: 'text/html' }),
  clone() {
    return this;
  },
});

/** Run the worker through the amendment's rules. Returns findings, each a sentence. */
async function exerciseWorker(src, appId) {
  const found = [];
  const scope = new URL(`/${appId}/`, SIM_ORIGIN).href;
  const prefix = `nikatru-${appId}-`;

  // ── rule 3 · one cache per build, and rule 4 · the prefix ────────────────
  const namesFor = async (build) => {
    const w = bootWorker(src, { scope, build });
    if (w.error) throw new Error(`does not evaluate as a worker script: ${w.error.message}`);
    for (const t of ['install', 'activate', 'fetch']) {
      if (!w.listeners.has(t)) throw new Error(`registers no \`${t}\` listener, so it cannot be the offline shell`);
    }
    await w.lifecycle('install');
    return [...w.caches.opened];
  };
  let n41;
  let n42;
  try {
    n41 = await namesFor('41');
    n42 = await namesFor('42');
  } catch (e) {
    return [`${e.message}.`];
  }
  if (n41.length === 0) {
    found.push('opens no cache at install, so a first online visit leaves nothing to start from offline.');
  }
  const wrongPrefix = [...n41, ...n42].filter((n) => !n.startsWith(prefix));
  if (wrongPrefix.length) {
    found.push(
      `names cache(s) ${wrongPrefix.map((n) => JSON.stringify(n)).join(', ')} without the per-app prefix ` +
        `"${prefix}" (ADR 023 rule 4). Cache Storage is ONE list for the whole nikatru.com origin — the ` +
        'marketing site and every other app — so an unprefixed name can collide with, or be deleted by, a neighbour.',
    );
  }
  const shared = n41.filter((n) => n42.includes(n));
  const unnamed = [...n41.filter((n) => !n.includes('41')), ...n42.filter((n) => !n.includes('42'))];
  if (shared.length || unnamed.length) {
    found.push(
      `has no per-build cache name (ADR 023 rule 3): installed as build 41 it opened ${JSON.stringify(n41)}, ` +
        `as build 42 ${JSON.stringify(n42)}. A cache that outlives its build serves one build's shell with ` +
        "another's bundle offline, and nothing ever retires it.",
    );
  }

  // ── rule 4 · a scope other than /<id>/ is refused ────────────────────────
  {
    const w = bootWorker(src, { scope: new URL('/', SIM_ORIGIN).href, build: '42' });
    let installed = true;
    try {
      await w.lifecycle('install');
    } catch {
      installed = false;
    }
    if (installed) {
      found.push(
        `installs under the ORIGIN ROOT scope as readily as under /${appId}/ (ADR 023 rule 4). On the shared ` +
          'origin a worker at the root would answer the marketing site and every other app; it must refuse any ' +
          'scope but its own.',
      );
    }
  }

  // ── rule 3 · activate retires the older build, and nobody else's ─────────
  const storage = new SimCacheStorage(scope, null);
  const neighbour = `nikatru-${appId === 'otherapp' ? 'another' : 'otherapp'}-shell-7`;
  for (const n of [...n41, neighbour, 'nikatru-site-pages']) await storage.open(n);
  storage.opened.clear();
  const w = bootWorker(src, { scope, build: '42', storage });
  try {
    await w.lifecycle('install');
    await w.lifecycle('activate');
  } catch (e) {
    return [...found, `fails to install and activate as build 42 under its own scope: ${e.message}.`];
  }
  const left = await storage.keys();
  const stale = n41.filter((n) => !n42.includes(n) && left.includes(n));
  if (stale.length) {
    found.push(
      `leaves the previous build's cache(s) ${JSON.stringify(stale)} in place when the next build activates ` +
        '(ADR 023 rule 3: older caches are deleted on activate).',
    );
  }
  const trampled = [neighbour, 'nikatru-site-pages'].filter((n) => !left.includes(n));
  if (trampled.length) {
    found.push(
      `deleted ${JSON.stringify(trampled)} on activate — cache(s) belonging to ANOTHER tenant of the shared ` +
        'origin. caches.keys() lists the whole origin; only names under this app\'s prefix are its to delete.',
    );
  }

  // ── rule 2 · network-first ───────────────────────────────────────────────
  const asset = `${scope}main.dart.js`;
  const current = await storage.open(n42[0] ?? `${prefix}42`);
  for (const url of [asset, scope]) {
    await current.put(new Request(url), new Response(`CACHED ${url}`));
  }
  w.net.online = true;
  for (const [what, req] of [['the bundle (main.dart.js)', new Request(asset)], ['the shell (a navigation to the scope)', navigation(scope)]]) {
    let r;
    try {
      r = await w.request(req);
    } catch (e) {
      found.push(`does not settle a request for ${what} with the network answering: ${e.message}.`);
      continue;
    }
    if (!r.responded) {
      found.push(`does not answer ${what} at all, so it can never serve it offline.`);
    } else if (r.body === `CACHED ${req.url}`) {
      found.push(
        `serves a CACHED copy of ${what} while the network answers (ADR 023 rule 2: online, the network always ` +
          'wins). Cache-first hides a new deploy from a returning visitor, which is the one client the CFG-1 ' +
          'kill-switch cannot see.',
      );
    } else if (r.body !== `NETWORK ${req.url}`) {
      found.push(`answers ${what} with something other than the network's response while the network answers (got ${JSON.stringify(String(r.body).slice(0, 60))}).`);
    }
  }
  // Offline: whatever it answers, it can only have come from what it holds.
  w.net.online = false;
  for (const [what, req] of [['the bundle (main.dart.js)', new Request(asset)], ['the shell (a navigation to the scope)', navigation(scope)]]) {
    let r;
    try {
      r = await w.request(req);
    } catch (e) {
      found.push(`does not settle a request for ${what} with the network off: ${e.message}.`);
      continue;
    }
    if (!r.responded || r.body === null) {
      found.push(
        `with the network off, does not serve the copy of ${what} it holds — the cold load is the browser's error ` +
          'page, which is the defect this worker exists to end.',
      );
    }
  }

  // ── never stored: the API, credentials, no-store, out of scope, version.json
  w.net.online = true;
  const before = new Set(storage.heldUrls());
  const mustNotStore = [
    ['an API response (another origin)', new Request(SIM_API)],
    ['a same-origin path outside its scope', new Request(`${SIM_ORIGIN}/api/subscribe`)],
    ['version.json (the deploy marker the post-deploy probe reads)', new Request(`${scope}version.json`)],
    ['a request carrying credentials', new Request(`${scope}assets/with-auth.json`, { headers: { authorization: 'Bearer probe' } })],
    ['a `no-store` response', new Request(`${scope}assets/no-store-probe.json`)],
    ['a POST', new Request(`${scope}assets/post.json`, { method: 'POST', body: 'x' })],
  ];
  for (const [what, req] of mustNotStore) {
    try {
      await w.request(req);
    } catch {
      // settling is not the question here; storing is
    }
    if (storage.heldUrls().some((u) => u === req.url && !before.has(u))) {
      found.push(`stores ${what} (${req.url}). The offline shell holds the static bundle only; user data is #1075's cache, never this one's.`);
    }
  }
  const strays = [...storage.opened].filter((n) => !n.startsWith(prefix));
  if (strays.length && !wrongPrefix.length) {
    found.push(`opens cache(s) ${JSON.stringify(strays)} outside its prefix "${prefix}" while answering requests (ADR 023 rule 4).`);
  }
  const badIdb = w.idbNames.filter((n) => !n.startsWith(prefix));
  if (badIdb.length) {
    found.push(`opens IndexedDB database(s) ${JSON.stringify(badIdb)} without the per-app prefix "${prefix}" (ADR 023 rule 4).`);
  }
  return found;
}

let workersRun = 0;
let swAllowedScanned = 0;
for (const b of bundles) {
  // Rule 4: `Service-Worker-Allowed` widens a worker's scope past its own
  // directory. On a shared origin that is how /<id>/sw.js claims the site, so it
  // is refused on EVERY bundle, flutter-web or static.
  const headersAbs = join(ROOT, b.dir, '_headers');
  const headersSrc = readOrNull(headersAbs);
  if (headersSrc !== null) {
    swAllowedScanned++;
    for (const [pattern, headers] of parseHeaders(headersSrc)) {
      if (headers.has('service-worker-allowed')) {
        problems.push(
          `${b.dir}/_headers rule "${pattern}" declares Service-Worker-Allowed ("${headers.get('service-worker-allowed')}"). ` +
            '[ADR 023] rule 4: NEVER. The app worker lives at /<id>/sw.js and its scope is /<id>/, which needs no ' +
            'header; this one exists only to let a worker claim more of the shared nikatru.com origin — the ' +
            'marketing site, the checkout return, every other app.',
        );
      }
    }
  }
  if (b.kind !== 'flutter-web') continue;
  const appId = b.dir === BRICK_WEB ? '{{app_id}}' : b.dir.split('/')[1];
  const swAbs = join(ROOT, b.dir, WORKER_FILE);
  const swSrc = readOrNull(swAbs);
  if (swSrc === null) {
    problems.push(
      `${b.dir}/${WORKER_FILE} does not exist. [ADR 023] as amended 2026-09-30 gives every web app our own ` +
        'network-first worker; without it a cold load with the network off is the browser\'s error page, while the ' +
        'data the app could have shown is sitting in its own cache.',
    );
    continue;
  }
  // Rule 1: registered by OUR script, and Flutter's worker is named nowhere.
  const regAbs = join(ROOT, b.dir, REGISTER_FILE);
  const regRaw = readOrNull(regAbs);
  const regSrc = regRaw === null ? null : stripJsComments(regRaw);
  if (regSrc === null) {
    problems.push(`${b.dir}/${REGISTER_FILE} does not exist, so nothing registers ${WORKER_FILE}: the worker ships and never runs.`);
  } else if (!/serviceWorker\s*\.\s*register\s*\(/.test(regSrc) || !/['"]sw\.js['"]/.test(regSrc)) {
    problems.push(`${b.dir}/${REGISTER_FILE} does not call navigator.serviceWorker.register on '${WORKER_FILE}'.`);
  }
  const indexAbs = join(ROOT, b.dir, 'index.html');
  const html = (readOrNull(indexAbs) ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
  const regTag = html.search(/<script\s+src=["']sw-register\.js["']\s*>/);
  const bootTag = html.search(/<script[^>]*\ssrc=["']flutter_bootstrap\.js["']/);
  if (regTag === -1 || bootTag === -1 || regTag > bootTag) {
    problems.push(
      `${b.dir}/index.html does not load <script src="${REGISTER_FILE}"> (not async, not defer) ABOVE the ` +
        'flutter_bootstrap.js tag. Below it, or async, its first-frame listener can miss the event, and the files ' +
        'loaded before the worker took control are never held for offline.',
    );
  }
  for (const f of ['index.html', 'flutter_bootstrap.js', REGISTER_FILE]) {
    const raw = readOrNull(join(ROOT, b.dir, f));
    if (raw === null) continue;
    const code = f.endsWith('.html') ? raw.replace(/<!--[\s\S]*?-->/g, ' ') : stripJsComments(raw.replace(/<%![\s\S]*?%>/, ' '));
    if (FLUTTER_WORKER_NAMES.test(code)) {
      problems.push(
        `${b.dir}/${f} names Flutter's own service worker (${code.match(FLUTTER_WORKER_NAMES)[0]}). [ADR 023] rule 1: ` +
          "our own worker, never Flutter's offline-first one — it serves a cached bundle while the network answers.",
      );
    }
  }
  // Rules 2-4, by running it.
  const findings = await exerciseWorker(swSrc, appId);
  workersRun++;
  for (const f of findings) problems.push(`${b.dir}/${WORKER_FILE} ${f}`);
}
if (sitesDirExists) {
  for (const site of listDir(sitesDir)) {
    const fnDir = join(sitesDir, site, 'functions');
    if (!existsSync(fnDir)) continue;
    const stack = [fnDir];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of listDir(dir, { withFileTypes: true })) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (/\.(js|mjs|ts)$/i.test(e.name) && /service-worker-allowed/i.test(stripJsComments(readFileSync(abs, 'utf8')))) {
          problems.push(
            `${relative(ROOT, abs).split(sep).join('/')} sets Service-Worker-Allowed. The apex router proxies every ` +
              'app, so a header it adds reaches every app path. [ADR 023] rule 4: never.',
          );
        }
      }
    }
  }
}
// No floor of its own: this loop walks the same `bundles` the floors above already
// refuse to see empty of flutter-web, and a bundle without a worker is a finding.
// A floor here could not fire on any input, so it would only look like coverage.

if (problems.length) {
  console.error(`✗ web cache policy — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 9]R-9 (cache limb) — our worker is network-first ([ADR 023] as amended 2026-09-30), so');
  console.error('  online the HTTP cache is still the update mechanism on the only served channel. See the header of');
  console.error('  tooling/ci/assert-web-cache-policy.mjs.');
  process.exit(1);
}

console.log(
  `ok  web cache policy — ${checked} bundle(s): ${kinds['flutter-web']} flutter-web (entry points + ` +
    `${shippedChecked} shipped file(s) must revalidate), ${kinds['static-site']} static-site (entry points + ` +
    `${classProbes} .css/.js class probe(s))`,
);
console.log(
  `    Pages Functions — ${functionFilesChecked} file(s) building a Response, each asserted to have ONE ` +
    `construction site carrying ${FUNCTION_SECURITY_HEADERS.length} security header(s); _headers reaches none of them`,
);
console.log(
  `    site CSP (nikatru.com origin, ${SITE_CSP_DECLARATION}) — ${siteCspSites} in-scope site(s), ${siteCspLines} ` +
    `policy line(s) floored, ${siteCspOverrides} declared per-path override(s) resolved through the \`!\` detach`,
);
console.log(
  `    Permissions-Policy — ${permissionsPoliciesGraded} policy(ies) deny ${PERMISSIONS_FLOOR.join(', ')}; ` +
    `${scriptHostsGraded} third-party script-src host(s), each with a recorded no-SRI reason`,
);
console.log(
  `    offline shell ([ADR 023] as amended 2026-09-30) — ${workersRun} worker(s) RUN in a simulated scope: ` +
    `network-first, one cache per build, per-app names, nothing but the bundle stored; ` +
    `Service-Worker-Allowed refused on ${swAllowedScanned} _headers and every Pages Function`,
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
