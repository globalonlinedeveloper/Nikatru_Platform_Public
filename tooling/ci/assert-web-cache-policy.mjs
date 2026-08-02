#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-web-cache-policy.mjs — the web channel declares its own cache policy,
// and the entry points a deploy rewrites are revalidated.
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
// ⚠️ THE MOTIVATING MEASUREMENT IS CARRIED, NOT RE-VERIFIED. The stage document
// records `max-age=14400` measured live on `flutter_bootstrap.js` and
// `main.dart.js` on 2026-07-29. That is UNVERIFIED here — it was not
// re-measured — so it is motivation only. Every assertion below is written
// against the DECLARED FILE and not against a live response, on purpose: a
// guard that fetches cannot fail offline, cannot fail on a fork, and turns a
// deploy-time property into a network dependency of every build.
//
// ── WHAT IS ASSERTED ─────────────────────────────────────────────────────────
// For every web output directory in the tree (`apps/*/web`, and the brick's
// template, because a defect there is born into every future app):
//   · `_headers` exists and is non-empty;
//   · every STABLE-NAMED entry point — `/`, `/index.html`,
//     `/flutter_bootstrap.js` — has a rule, and that rule's `Cache-Control`
//     carries `max-age=0` (or `no-cache`/`no-store`). A stable name with
//     changing content is the whole hazard; a hashed name is not.
//
// The split is by NAME STABILITY, not by file type, and the guard says so:
// `assets/*` may be immutable because a new build asks for different names.
//
// Usage:  node tooling/ci/assert-web-cache-policy.mjs [repoRoot]
// Exit 0 = every web output declares a policy that lets a deploy be seen.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const BRICK_WEB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/web';

/** The paths whose NAME never changes while their CONTENT does, every build. */
const ENTRY_POINTS = ['/', '/index.html', '/flutter_bootstrap.js'];

/** A policy that lets a new deploy be seen. `must-revalidate` alone is not
 *  enough — it governs what happens once a response is STALE, and with a long
 *  `max-age` it never becomes stale inside the window that matters. */
const REVALIDATES = /(^|[,\s])max-age\s*=\s*0(\b|$)|no-cache|no-store/i;

const problems = [];
const notes = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-web-cache-policy: FAILED');
  process.exit(1);
}

/** Every `web/` directory that becomes a deployed bundle. */
const webDirs = [];
const appsDir = join(ROOT, 'apps');
if (existsSync(appsDir)) {
  for (const a of listDir(appsDir)) {
    const w = join(appsDir, a, 'web');
    if (existsSync(w) && statSync(w).isDirectory()) webDirs.push(`apps/${a}/web`);
  }
}
if (existsSync(join(ROOT, BRICK_WEB))) webDirs.push(BRICK_WEB);

if (webDirs.length === 0) {
  coverageLost([
    `found no web output directory under ${ROOT} (apps/*/web, ${BRICK_WEB}).`,
    'Every assertion below is per web directory, so with none found this guard would report that every',
    'web channel declares a cache policy — over nothing. The brick template alone is always one.',
  ]);
}
// The brick is the one directory whose absence is invisible in the app tree: a
// defect there is born into every future app at once, and apps/*/web can all be
// correct while the template that makes the next one is not.
if (!webDirs.includes(BRICK_WEB)) {
  coverageLost([
    `${BRICK_WEB} is not in the scan.`,
    'It is the template every stamped app inherits, so it is the only directory where one wrong line',
    'reaches fifty apps. Either the brick moved or this walk narrowed; neither is "clean".',
  ]);
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

/** The rule that governs `path`: an exact match, else the longest `prefix/*`. */
function ruleFor(rules, path) {
  if (rules.has(path)) return { pattern: path, headers: rules.get(path) };
  let best = null;
  for (const [pattern, headers] of rules) {
    if (!pattern.endsWith('*')) continue;
    const prefix = pattern.slice(0, -1);
    if (!path.startsWith(prefix)) continue;
    if (best === null || prefix.length > best.prefix.length) best = { prefix, pattern, headers };
  }
  return best ? { pattern: best.pattern, headers: best.headers } : null;
}

let checked = 0;
for (const dir of webDirs) {
  const rel = `${dir}/_headers`;
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    problems.push(
      `${rel} does not exist. Flutter copies web/ verbatim into build/web and Cloudflare Pages reads ` +
        '`_headers` from the deployed directory, so with no file here NOTHING in this repository chooses a ' +
        'cache policy — the platform default does, and a returning visitor can run the previous build while ' +
        'reporting the previous version, which is precisely the client the CFG-1 force-update gate cannot see.',
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
  for (const entry of ENTRY_POINTS) {
    const rule = ruleFor(rules, entry);
    if (rule === null) {
      problems.push(
        `${rel} has no rule covering "${entry}". That name never changes while its content changes on every ` +
          'deploy, so it is the one thing that must be revalidated; without a rule it inherits whatever the ' +
          'platform defaults to.',
      );
      continue;
    }
    const cc = rule.headers.get('cache-control');
    if (!cc) {
      problems.push(`${rel} rule "${rule.pattern}" (covering "${entry}") sets no Cache-Control.`);
      continue;
    }
    if (!REVALIDATES.test(cc)) {
      problems.push(
        `${rel} rule "${rule.pattern}" (covering "${entry}") is "${cc}". A stable name with changing content ` +
          'must be revalidated — `max-age=0`, `no-cache` or `no-store`. `must-revalidate` beside a long ' +
          'max-age governs what happens once the response is STALE, and inside the window that matters it ' +
          'never becomes stale. Hashed output under assets/ is the opposite case and may be immutable.',
      );
    }
  }
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

if (notes.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  web cache policy — ${checked} web output directory(ies) (${webDirs.join(', ')}), each declaring ` +
    `a _headers policy that revalidates ${ENTRY_POINTS.join(', ')}`,
);
