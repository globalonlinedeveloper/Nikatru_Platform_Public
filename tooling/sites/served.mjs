// ─────────────────────────────────────────────────────────────────────────────
// WHAT A DEPLOY ROOT DOES NOT SERVE — one list, read by every reader that needs
// to know which committed file a visitor can actually fetch.
//
// [ADR 064] one list, several readers. Until 2026-09-22 the only copy was a
// private `NOT_SERVED` set inside tooling/ci/assert-web-cache-policy.mjs, and the
// next reader (the customer-visible retired-name guard) would have needed a
// second copy that could drift from the first.
//
// ── TWO DIFFERENT REASONS A FILE IS NOT SERVED ──────────────────────────────
//   1. PAGES ITSELF never serves its control files or the Functions source.
//      MEASURED 2026-09-22 against https://nikatru.com: `/_headers`,
//      `/_redirects` and `/functions/_middleware.js` answer 404.
//   2. THE APEX ROUTER refuses a pattern. The same day `/README.md` and
//      `/legal/README.md` answered 200 — a maintainer's notes, published. The
//      owner's answer (2026-09-22) was that nikatru.com serves no Markdown, so
//      sites/nikatru/functions/_middleware.js answers 404 for every `*.md` the
//      static site would otherwise serve, using `refusedByRouter` below.
//
// ── ITS READERS ──────────────────────────────────────────────────────────────
//   · sites/nikatru/functions/_middleware.js — `refusedByRouter`, at request time.
//   · tooling/ci/assert-web-cache-policy.mjs — `PAGES_CONTROL_FILES`.
//   · tooling/ci/assert-retired-names-visible.mjs — `servedAt`.
//
// 🔴 THIS FILE RUNS IN THE WORKERS RUNTIME TOO. The apex router imports it, and
// the Pages Functions bundler inlines it. So: no `node:` import, no top-level
// side effect, nothing but constants and pure functions.
// ─────────────────────────────────────────────────────────────────────────────

/** Files Cloudflare Pages reads as configuration and never serves as assets. */
export const PAGES_CONTROL_FILES = new Set(['_headers', '_redirects', '_routes.json', '_worker.js']);

/** The Pages Functions source directory, relative to a deploy root. Compiled
 *  into the Functions bundle, never served as a file. */
export const PAGES_FUNCTIONS_DIR = 'functions';

/** Extensions the apex router answers 404 for when the static site would serve
 *  them. Lower case; matched case-insensitively against the last path segment. */
export const ROUTER_REFUSED_EXTENSIONS = Object.freeze(['.md']);

/** Wrangler config files: the apex job deploys FROM the directory it uploads, so its filled
 *  wrangler.jsonc sits among the assets, and wrangler 4.135.0 uploads it (IGNORE_LIST has no
 *  config name). Refused by name, at any depth. */
export const ROUTER_REFUSED_NAMES = Object.freeze(['wrangler.json', 'wrangler.jsonc', 'wrangler.toml']);

/**
 * True when the apex router refuses to let the static site serve `pathname`.
 * Percent-encoding is decoded first, so `/README%2Emd` is the same refusal as
 * `/README.md`; a malformed escape is matched as written.
 */
export function refusedByRouter(pathname) {
  let p = String(pathname);
  try {
    p = decodeURIComponent(p);
  } catch {
    // matched as written
  }
  const last = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  return ROUTER_REFUSED_NAMES.includes(last) || ROUTER_REFUSED_EXTENSIONS.some((ext) => last.endsWith(ext));
}

/**
 * True when the file at `rel` (a path relative to its deploy root, `/`-separated)
 * is fetchable by a visitor.
 *
 * `router: true` is for the apex root, where the router's refusals apply on top
 * of what Pages itself withholds. An app's own web bundle is proxied, not routed
 * through the static site, so it is read with `router: false`.
 */
export function servedAt(rel, { router = false } = {}) {
  const parts = String(rel).split('/').filter(Boolean);
  if (parts.length === 0) return false;
  if (PAGES_CONTROL_FILES.has(parts[parts.length - 1])) return false;
  if (parts[0] === PAGES_FUNCTIONS_DIR && parts.length > 1) return false;
  if (router && refusedByRouter(`/${parts.join('/')}`)) return false;
  return true;
}
