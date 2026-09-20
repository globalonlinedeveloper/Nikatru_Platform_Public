#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// capture-fallback-fonts.mjs — THE CAPTURED APP MUST HAVE A FONT TO DRAW TEXT
// WITH. The store frames had none, and nothing said so.
//
// ── 🔴 WHAT WAS MEASURED, 2026-09-20 ────────────────────────────────────────
// Every frame produced by `tooling/store/capture-play-screenshots.mjs` since
// 2026-09-12 contains NO TEXT AT ALL. Icons render; titles, labels, amounts and
// the nav captions are absent. Local and CI agree to within 0.5% on every byte
// size, so it is not a host font problem:
//
//                  committed (run 34202461387, 2026-09-08)   textless (run 35488534460)
//   01-home.png                      459549                          380700
//   02-calendar.png                  157296                           65225
//   03-insights.png                  129114                           73379
//   04-budget.png                    153442                           73304
//
// ── THE CAUSE: A FONT BASE URL THIS LANE CANNOT SERVE ───────────────────────
// `apps/<id>/web/flutter_bootstrap.js` (added 2026-09-12 by #676, commit
// 3e012242) moves the engine's text fallback fonts off Google's CDN and onto
// the app's own origin:
//
//     _flutter.loader.load({ config: { fontFallbackBaseUrl: "fallback-fonts/" } });
//
// `tooling/web/self-host-fallback-fonts.mjs` says what that setting is, exactly:
// "a RUNTIME setting that defaults to `https://fonts.gstatic.com/s/` whatever
// the build flag says". It governs ROBOTO — the engine's default text family —
// as well as the on-demand Noto set; `tooling/web/fallback-fonts.lock.json`
// carries `roboto/v32/KFOmCnqEu92Fr1Me4GZLCzYlKw.woff2` among its 725 files.
//
// 🔴 THE APP DECLARES NO FONTS OF ITS OWN. `apps/subscriptiontracker/pubspec.yaml`
// has its whole `fonts:` block commented out and no `assets/fonts/` directory —
// identical at c92bfb80, when the frames still had text. So EVERY text run in
// the app depends on that one downloaded Roboto, and the `fontFamily: 'Manrope'`
// / `'Space Grotesk'` call sites resolve to it too.
//
// ⚠️ ONLY `deploy-web.yml` EVER FILLS THAT DIRECTORY. It runs
// self-host-fallback-fonts.mjs against a finished `build/web`. This lane never
// builds one: `capture-play-screenshots.mjs` runs `flutter drive -d web-server`,
// whose dev server serves the SAME custom bootstrap (flutter_tools
// `web_asset_server.dart` → `_serveFlutterBootstrapJs` → `getWebTemplate(…,
// 'flutter_bootstrap.js', <default>)`) out of a directory tree that has no
// `fallback-fonts/` in it at all.
//
// ── 🔴 AND IT DOES NOT EVEN 404 — IT ANSWERS 200 text/html ──────────────────
// The dev server's last-resort branch (`web_asset_server.dart`) is:
//
//     if (!file.existsSync()) {
//       if (requestPath.startsWith('assets/') ||
//           requestPath.startsWith('packages/') ||
//           requestPath.startsWith('canvaskit/')) {
//         return shelf.Response.notFound('');
//       }
//       return _serveIndexHtml();          // ← `fallback-fonts/…` lands HERE
//     }
//
// `fallback-fonts/roboto/v32/….woff2` matches none of those three prefixes, so
// the engine asks for a font and is handed `index.html`. It cannot decode it and
// draws nothing. self-host-fallback-fonts.mjs's own header warns about precisely
// this shape one lane over — "the apex router answers an unknown app path with
// the SPA shell (HTTP 200, text/html), so a font that was never deployed does not
// 404 in production — the engine gets HTML, cannot decode it, and draws empty
// boxes. Nothing else would notice." The dev server has the same SPA fallback,
// and nothing noticed here either.
//
// THE ICONS SURVIVE FOR THE SAME REASON THE TEXT DIES: MaterialIcons is a real
// bundled asset, so it is requested under `assets/`, which the dev server DOES
// resolve. That asymmetry — icons yes, text no — falls straight out of the
// prefix list above, and is the fingerprint of this defect.
//
// ── THE FIX ─────────────────────────────────────────────────────────────────
// Put the fonts where the bootstrap says they are, for the duration of the
// drive: `apps/<id>/web/fallback-fonts/` is the dev server's documented
// last-resort static root (`<cwd>/web/<requestPath>`, and the capture spawns
// `flutter` with `cwd: appDir`). Files are byte-pinned by the SAME
// `fallback-fonts.lock.json` the deploy lane uses, cached outside the repo so a
// second run costs nothing, and removed again when the capture finishes.
//
// So the capture now renders with exactly the fonts production serves, verified
// against the same lock. Staging is NOT best-effort: a font the lock names and
// this module could not place is a hard failure, because the alternative is the
// silent 200-text/html above.
//
// ⚠️ WHY NOT "just let it reach fonts.gstatic.com for the capture". That would
// re-open, for this lane, the egress #676 closed, and it would photograph the
// app with fonts the shipping bundle does not serve. Staging the pinned set is
// both narrower and more faithful.
//
// Usage:
//   node tooling/store/capture-fallback-fonts.mjs --stage   apps/subscriptiontracker
//   node tooling/store/capture-fallback-fonts.mjs --unstage apps/subscriptiontracker
//   node tooling/store/capture-fallback-fonts.mjs --check   apps/subscriptiontracker
// Exit 0 = staged/clean. 1 = a defect (named). 2 = COVERAGE LOST (the app's
// bootstrap could not be read the way this module expects).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LOCK,
  FALLBACK_DIR,
  FONT_FALLBACK_BASE_URL,
  FONT_PATH,
  UPSTREAM,
  inspectBootstrap,
  sha256,
} from '../web/self-host-fallback-fonts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(join(HERE, '..', '..'));

/** The file's bytes, or `null` if it is not there.
 *
 * 🔴 IT EXISTS SO NOTHING HERE ASKS `existsSync` AND THEN READS. That pair is a
 * time-of-check/time-of-use race — CodeQL js/file-system-race, raised against
 * this module on 2026-09-20 — and the repair is not a tighter check, it is not
 * asking a question whose answer has expired by the time it is used.
 *
 * ⚠️ ONLY `ENOENT` BECOMES `null`. Every other error is rethrown, because a
 * permission failure or a bad disk read must not be quietly reported as "not
 * cached" — that would turn an unreadable cache into a silent re-download, and
 * an unreadable DESTINATION into a font this module believes it staged. */
function tryRead(path) {
  try {
    return readFileSync(path);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** COVERAGE LOST — the module cannot say anything about this app, so it must not
 *  say "fine". Separate from a plain defect on purpose (exit 2, not 1). */
export class CoverageLost extends Error {}

/** Where the dev server's last-resort static lookup (`<cwd>/web/<path>`) finds them. */
export const stagedDirFor = (appDir) => join(appDir, 'web', FALLBACK_DIR);

/** Outside the repo, so a second run is instant and no guard ever sees it.
 *  `NIKATRU_FALLBACK_FONT_CACHE` overrides it (CI points this at a cached path). */
export function cacheDir() {
  if (process.env.NIKATRU_FALLBACK_FONT_CACHE) return process.env.NIKATRU_FALLBACK_FONT_CACHE;
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local')
      : join(process.env.HOME ?? '.', '.cache');
  return join(base, 'nikatru', 'fallback-fonts-cache');
}

export function readLock(lockPath = DEFAULT_LOCK) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const files = lock?.files;
  if (!files || typeof files !== 'object') {
    throw new CoverageLost(`${lockPath} has no \`files\` map — nothing to stage.`);
  }
  // Every path is validated before it is ever joined: FONT_PATH admits no `/`
  // inside a segment and no leading dot, so a lock entry cannot climb out of
  // the staging directory.
  for (const p of Object.keys(files)) {
    if (!FONT_PATH.test(p)) throw new CoverageLost(`${lockPath}: refusing an unrecognised font path \`${p}\``);
  }
  return files;
}

/**
 * What the app's OWN bootstrap asks the engine to do. Read from source rather
 * than assumed, because an app whose bootstrap does not redirect the base URL
 * needs no staging at all and must not be given a directory it never asked for.
 */
export function bootstrapPosture(appDir) {
  const file = join(appDir, 'web', 'flutter_bootstrap.js');
  if (!existsSync(file)) return { needsStaging: false, why: 'the app has no web/flutter_bootstrap.js', baseUrl: null };
  const { fontFallbackBaseUrl } = inspectBootstrap(readFileSync(file, 'utf8'));
  if (!fontFallbackBaseUrl) {
    return { needsStaging: false, why: 'the bootstrap passes no fontFallbackBaseUrl (engine default)', baseUrl: null };
  }
  if (/^https?:\/\//i.test(fontFallbackBaseUrl)) {
    return { needsStaging: false, why: `the bootstrap points at an absolute URL (${fontFallbackBaseUrl})`, baseUrl: fontFallbackBaseUrl };
  }
  if (fontFallbackBaseUrl !== FONT_FALLBACK_BASE_URL) {
    // Staging writes to ONE fixed directory. A different relative base means the
    // fonts would be placed where nothing looks for them, and the run would go
    // textless again with this module reporting success.
    throw new CoverageLost(
      `${file} passes fontFallbackBaseUrl "${fontFallbackBaseUrl}", and this module only knows how to ` +
        `stage "${FONT_FALLBACK_BASE_URL}". Staging anywhere else would leave the capture textless while ` +
        `reporting success.`,
    );
  }
  return { needsStaging: true, why: `the bootstrap passes "${fontFallbackBaseUrl}"`, baseUrl: fontFallbackBaseUrl };
}

async function fetchPinned(path, want) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(UPSTREAM + path, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Verified BEFORE it is written anywhere — the cache must never hold bytes
      // the lock did not vouch for, or a poisoned cache outlives the run.
      if (buf.length !== want.bytes) throw new Error(`${buf.length} bytes, lock says ${want.bytes}`);
      const got = sha256(buf);
      if (got !== want.sha256) throw new Error(`sha256 ${got.slice(0, 12)}…, lock says ${want.sha256.slice(0, 12)}…`);
      return buf;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${UPSTREAM}${path}: ${last?.message ?? last}`);
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * Place every locked fallback font under `<appDir>/web/fallback-fonts/`.
 * Returns a summary; THROWS if any locked file could not be placed.
 */
export async function stageFallbackFonts({ appDir, lockPath = DEFAULT_LOCK, log = () => {} } = {}) {
  const posture = bootstrapPosture(appDir);
  if (!posture.needsStaging) return { staged: 0, skipped: true, ...posture };

  const files = readLock(lockPath);
  const dest = stagedDirFor(appDir);
  const cache = cacheDir();
  const paths = Object.keys(files);
  let fromCache = 0;
  let fetched = 0;

  await pool(paths, 8, async (p) => {
    const want = files[p];
    const out = join(dest, p);
    // ⚠️ READ AND HANDLE THE MISS, NEVER `existsSync` THEN READ. The pair is a
    // TOCTOU — the file can go between the two calls — which is CodeQL
    // js/file-system-race, and the honest repair is to stop asking a question
    // whose answer expires. `tryRead` returns null for a file that is not there;
    // any other error still throws, because "the disk refused" must not be
    // silently read as "not cached".
    if (tryRead(out)?.length === want.bytes) return;
    const cached = join(cache, want.sha256);
    // A cache entry is re-verified, never trusted for being present: it lives
    // outside the repo where nothing else guards it.
    let buf = tryRead(cached);
    if (buf && (buf.length !== want.bytes || sha256(buf) !== want.sha256)) buf = null;
    else if (buf) fromCache++;
    if (!buf) {
      buf = await fetchPinned(p, want);
      mkdirSync(cache, { recursive: true });
      writeFileSync(cached, buf);
      fetched++;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
  });

  // The whole point of this module is that a MISSING file is silent (200
  // text/html), so presence is asserted rather than assumed.
  const missing = paths.filter((p) => !existsSync(join(dest, p)));
  if (missing.length) {
    throw new Error(
      `${missing.length} of ${paths.length} fallback fonts were not staged into ${dest} ` +
        `(first: ${missing.slice(0, 3).join(', ')}). The capture would render without text.`,
    );
  }
  log(`fallback fonts: ${paths.length} staged into ${dest} (${fromCache} from cache, ${fetched} fetched)`);
  return { staged: paths.length, fromCache, fetched, dest, skipped: false };
}

/** Remove the staged directory. Safe to call when nothing was staged. */
export function unstageFallbackFonts(appDir) {
  const dest = stagedDirFor(appDir);
  if (!existsSync(dest)) return false;
  rmSync(dest, { recursive: true, force: true });
  return true;
}

/** Grade an app directory without fetching anything. */
export function checkStaged(appDir, lockPath = DEFAULT_LOCK) {
  const posture = bootstrapPosture(appDir);
  if (!posture.needsStaging) return { ok: true, ...posture, missing: [] };
  const files = readLock(lockPath);
  const dest = stagedDirFor(appDir);
  const missing = Object.keys(files).filter((p) => !existsSync(join(dest, p)));
  return { ok: missing.length === 0, ...posture, missing, dest };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const mode = ['--stage', '--unstage', '--check'].find((f) => argv.includes(f));
  const appArg = argv.find((a) => !a.startsWith('--'));
  if (!mode || !appArg) {
    console.error('usage: capture-fallback-fonts.mjs --stage|--unstage|--check <appDir>');
    process.exit(2);
  }
  const appDir = resolve(ROOT, appArg);
  try {
    if (mode === '--unstage') {
      console.log(unstageFallbackFonts(appDir) ? `removed ${stagedDirFor(appDir)}` : 'nothing staged');
    } else if (mode === '--check') {
      const r = checkStaged(appDir);
      console.log(r.ok ? `OK — ${r.why}` : `${r.missing.length} missing under ${r.dest}`);
      process.exit(r.ok ? 0 : 1);
    } else {
      await stageFallbackFonts({ appDir, log: (m) => console.log(m) });
    }
  } catch (e) {
    console.error(e instanceof CoverageLost ? `COVERAGE LOST: ${e.message}` : `${e.message}`);
    process.exit(e instanceof CoverageLost ? 2 : 1);
  }
}
