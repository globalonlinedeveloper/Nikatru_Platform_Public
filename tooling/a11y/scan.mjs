#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scan.mjs — the automated accessibility scan (lane a11y-statement, Do 3).
//
//   node tooling/a11y/scan.mjs --site [sites/nikatru]          every indexable page
//   node tooling/a11y/scan.mjs --flutter apps/<id>/build/web    the built web app
//   node tooling/a11y/scan.mjs --site <dir> --page <rel.html>  one page (fixtures)
//   … --register <file>   judge against another register (the red control that
//                         deletes a row for a real exception)
//
// WHAT IT RUNS. axe-core (pinned in _playwright/package.json, injected from
// the local install as a script — no request leaves the runner) through the
// fleet Playwright install, over:
//   · the site: every indexable `.html` under the deploy root (no `noindex`,
//     the same reading generate-discovery.mjs's sitemap uses), in BOTH colour
//     schemes (light, dark) at BOTH widths (375 px, 1280 px);
//   · the Flutter web build: its landing route with semantics enabled, at both
//     widths, light scheme (the app follows the system scheme; dark is the
//     same tree).
// Plus ONE rule axe does not have: `focus-not-obscured-sticky` (WCAG 2.2 SC
// 2.4.11). A `position: sticky|fixed` nav taller than the page's
// `scroll-padding-top` hides every in-page target it scrolls to — the 375 px
// homepage nav was 145 px over an 84 px padding (the 2026-10-02 audit, §2i).
//
// THE VERDICT. A `serious` or `critical` violation fails the scan UNLESS a row
// of tooling/a11y/exceptions.json names it: the same rule (`axe`), on the same
// page (`pages`, repo-relative, or "*"). The statement page is generated from
// the same register, and tooling/ci/assert-a11y-statement.mjs holds the page's
// gaps equal to the register's rows. A register row that no violation used is reported STALE and
// fails too, so a fixed gap must leave the register (and the statement) in the
// same change. `moderate` and `minor` findings print and never fail.
//
// Exit 0 clean · 1 a finding (an unregistered serious/critical violation, or a
// stale row) · 2 COVERAGE LOST (no page scanned, the browser or axe could not
// be loaded, a page did not load).
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTER = 'tooling/a11y/exceptions.json';
export const SITE = 'sites/nikatru';
export const WIDTHS = [375, 1280];
export const SCHEMES = ['light', 'dark'];
export const FAILING_IMPACTS = new Set(['serious', 'critical']);
const PLAYWRIGHT_HOME = path.join(ROOT, '_playwright');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain', '.xml': 'application/xml',
};

/** A page that asks not to be indexed (the sitemap's own reading). */
export const isNoindex = (html) => /<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex/i.test(html);

/** Every indexable `.html` under `siteDir`, repo-relative, sorted. A page with no
 *  `<head>` (a mail-body fragment) is not a page. */
export function indexablePages(root, siteDir) {
  const out = [];
  const walk = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.html')) {
        const html = readFileSync(p, 'utf8');
        if (!/<head[\s>]/i.test(html) || isNoindex(html)) continue;
        out.push(toPosix(path.relative(root, p)));
      }
    }
  };
  walk(path.join(root, siteDir));
  return out.sort();
}

/** A path as the register spells it: forward slashes, whatever the host. A
 *  Windows `--site sites\\nikatru` must match the register's `sites/nikatru/…`. */
export const toPosix = (p) => p.split('\\').join('/');

/** The URL path a page is served at (clean URLs, as Pages serves them). */
export function urlPathFor(siteDir, rel) {
  const inSite = toPosix(rel).slice(toPosix(siteDir).replace(/\/+$/, '').length + 1);
  if (inSite === 'index.html') return '/';
  if (inSite.endsWith('/index.html')) return `/${inSite.slice(0, -'index.html'.length)}`;
  return `/${inSite.replace(/\.html$/i, '')}`;
}

/** A static server over `dir` with Pages' clean-URL resolution. */
export function serveStatic(dir) {
  const server = createServer((req, res) => {
    let p = path.posix.normalize(decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    const candidates = p.endsWith('/') ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`];
    for (const c of candidates) {
      const abs = path.join(dir, ...c.split('/').filter(Boolean));
      let body;
      try {
        body = readFileSync(abs); // read once: a missing path or a directory is the next candidate
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR') continue;
        throw err;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

export function loadRegister(file = path.join(ROOT, REGISTER)) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(doc.exceptions)) throw new Error(`${REGISTER}: no exceptions array`);
  return doc;
}

/** Does register row `row` cover a violation of `rule` on `page`? */
export const covers = (row, rule, page) =>
  Array.isArray(row.axe) && row.axe.includes(rule) && Array.isArray(row.pages) && (row.pages.includes('*') || row.pages.includes(page));

/**
 * The verdict over every finding: { failing[], tolerated[], advisory[], stale[] }.
 * A finding is { page, rule, impact, width, scheme, targets }.
 */
export function judge(findings, register, scannedPages) {
  const failing = [];
  const tolerated = [];
  const advisory = [];
  const used = new Set();
  for (const f of findings) {
    if (!FAILING_IMPACTS.has(f.impact)) {
      advisory.push(f);
      continue;
    }
    const row = register.exceptions.find((r) => covers(r, f.rule, f.page));
    if (row) {
      used.add(row.id);
      tolerated.push({ ...f, exception: row.id });
    } else failing.push(f);
  }
  // A row is stale only when every page it names was scanned and none showed its rule.
  const scanned = new Set(scannedPages);
  const stale = register.exceptions.filter(
    (r) => Array.isArray(r.axe) && r.axe.length > 0 && !used.has(r.id) && Array.isArray(r.pages) && r.pages.length > 0 && r.pages.every((p) => p === '*' || scanned.has(p)),
  );
  return { failing, tolerated, advisory, stale };
}

/** The in-page rule axe has no rule for: SC 2.4.11 under a sticky header. */
export function stickyOverlapProbe() {
  const nav = document.querySelector('body > nav, header nav, nav');
  if (!nav) return null;
  const pos = getComputedStyle(nav).position;
  if (pos !== 'sticky' && pos !== 'fixed') return null;
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const h = nav.getBoundingClientRect().height;
  return h > pad + 1 ? { height: Math.round(h), padding: Math.round(pad) } : null;
}

async function loadPlaywright() {
  const req = createRequire(path.join(PLAYWRIGHT_HOME, 'package.json'));
  return { chromium: req('playwright').chromium, axeSource: readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8') };
}

/** Chrome for the scan: the A11Y_CHROME override, else Playwright's own
 *  install (`npx playwright install chromium` in _playwright/, as CI does). */
function launchOptions() {
  const exe = process.env.A11Y_CHROME;
  return exe ? { executablePath: exe } : {};
}

/** axe over one loaded page: its serious/critical/moderate/minor violations, flat. */
async function axeOn(page, axeSource, meta) {
  // Evaluated over DevTools, never as a <script>: a page's own CSP (the Flutter
  // bundle's _headers refuses inline script and eval) must not stop the scan.
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.map((v) => ({ rule: v.id, impact: v.impact, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
  });
  return result.map((v) => ({ ...meta, ...v }));
}

/** Scan the static site. Returns { findings, pages, lost }. */
export async function scanSite(root, siteDir, { only = null, browser, axeSource, log = () => {} } = {}) {
  const pages = only ?? indexablePages(root, siteDir);
  const findings = [];
  const lost = [];
  if (pages.length === 0) return { findings, pages, lost: [`no indexable page under ${siteDir}`] };
  const { server, origin } = await serveStatic(path.join(root, siteDir));
  try {
    for (const width of WIDTHS) {
      for (const scheme of SCHEMES) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, javaScriptEnabled: true });
        const page = await ctx.newPage();
        for (const rel of pages) {
          const url = origin + urlPathFor(siteDir, rel);
          const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch((e) => ({ status: () => 0, err: e }));
          if (!res || res.status() !== 200) {
            lost.push(`${rel} did not load (${res?.status?.() ?? 'no answer'}) at ${width}px ${scheme}`);
            continue;
          }
          const meta = { page: rel, width, scheme };
          findings.push(...(await axeOn(page, axeSource, meta)));
          const sticky = await page.evaluate(stickyOverlapProbe);
          if (sticky) {
            findings.push({ ...meta, rule: 'focus-not-obscured-sticky', impact: 'serious', targets: [`nav ${sticky.height}px over scroll-padding-top ${sticky.padding}px`] });
          }
          log(`  scanned ${rel} @${width} ${scheme}`);
        }
        await ctx.close();
      }
    }
  } finally {
    server.close();
  }
  return { findings, pages, lost };
}

/** Scan the built Flutter web app's landing route, semantics on. */
export async function scanFlutter(bundleDir, { browser, axeSource, label, log = () => {} }) {
  const { basePrefix, readBundleHeaders, serveBundle, READY_SIGNAL } = await import('../smoke/smoke-web-artifact.mjs');
  const server = serveBundle(bundleDir, () => {}, readBundleHeaders(bundleDir) ?? []);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const findings = [];
  const lost = [];
  const pageName = label;
  try {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
      const page = await ctx.newPage();
      // The smoke's own ready signal: installed before navigation, polled after.
      await page.addInitScript(READY_SIGNAL.install);
      await page.goto(`http://127.0.0.1:${port}${basePrefix(bundleDir)}`, { waitUntil: 'load', timeout: 60_000 });
      // A FUNCTION, not READY_SIGNAL.expression: Playwright evaluates a string
      // predicate with eval, which the bundle's CSP refuses.
      const booted = await page.waitForFunction(() => window.__nikatruFirstFrame === true, null, { timeout: 60_000 }).then(() => true, () => false);
      if (!booted) {
        lost.push(`the Flutter bundle never reached ${READY_SIGNAL.id} at ${width}px`);
        await ctx.close();
        continue;
      }
      // Semantics on: the app force-enables them; the placeholder is clicked only if it is still there.
      await page.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click());
      await page.waitForSelector('flt-semantics', { timeout: 30_000 }).catch(() => {});
      // An empty semantics tree gives axe nothing to judge: that is COVERAGE LOST, not a pass.
      const nodes = await page.evaluate(() => document.querySelectorAll('flt-semantics').length);
      if (nodes === 0) {
        lost.push(`the Flutter bundle exposed no flt-semantics node at ${width}px, so axe would have judged an empty tree`);
        await ctx.close();
        continue;
      }
      findings.push(...(await axeOn(page, axeSource, { page: pageName, width, scheme: 'light' })));
      log(`  scanned ${pageName} @${width} (${nodes} semantics node(s))`);
      await ctx.close();
    }
  } finally {
    server.close();
  }
  return { findings, pages: [pageName], lost };
}

export function report(verdict, lost, log = console.log) {
  for (const f of verdict.failing) log(`✗ ${f.impact} ${f.rule} on ${f.page} @${f.width} ${f.scheme}: ${f.targets.join(' | ')}`);
  for (const r of verdict.stale) log(`✗ STALE register row ${r.id}: none of its rules (${r.axe.join(', ')}) fired on its pages — the gap is fixed; remove the row (and the statement regenerates)`);
  for (const l of lost) log(`COVERAGE LOST — ${l}`);
  const advisoryRules = [...new Set(verdict.advisory.map((f) => `${f.rule}(${f.impact})`))];
  if (advisoryRules.length) log(`  advisory (moderate/minor, never failing): ${advisoryRules.join(', ')}`);
  if (verdict.tolerated.length) log(`  tolerated by the register: ${[...new Set(verdict.tolerated.map((f) => `${f.exception}:${f.rule}`))].join(', ')}`);
  if (lost.length) return 2;
  return verdict.failing.length || verdict.stale.length ? 1 : 0;
}

async function main(argv) {
  const at = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  let register;
  try {
    register = loadRegister(at('--register') ? path.resolve(at('--register')) : undefined);
  } catch (e) {
    console.log(`COVERAGE LOST — the exceptions register could not be read: ${e.message}`);
    return 2;
  }
  let pw;
  try {
    pw = await loadPlaywright();
  } catch (e) {
    console.log(`COVERAGE LOST — Playwright or axe-core is not installed in _playwright/ (npm ci there): ${e.code ?? e.message}`);
    return 2;
  }
  let browser;
  try {
    browser = await pw.chromium.launch(launchOptions());
  } catch (e) {
    console.log(`COVERAGE LOST — no browser could be launched (set A11Y_CHROME to a Chrome binary): ${String(e.message).split('\n')[0]}`);
    return 2;
  }
  try {
    let res;
    if (argv.includes('--flutter')) {
      const dir = path.resolve(at('--flutter'));
      res = await scanFlutter(dir, { browser, axeSource: pw.axeSource, label: `flutter:${path.basename(path.resolve(dir, '..', '..'))}` });
    } else {
      const site = toPosix(at('--site') ?? SITE);
      const only = argv.includes('--page') ? [toPosix(at('--page'))] : null;
      res = await scanSite(ROOT, site, { only, browser, axeSource: pw.axeSource, log: argv.includes('--verbose') ? console.log : () => {} });
    }
    if (res.pages.length === 0) res.lost.push('nothing was scanned');
    const verdict = judge(res.findings, register, res.pages);
    const code = report(verdict, res.lost);
    console.log(`a11y scan: ${res.pages.length} page(s) × ${WIDTHS.length} widths${argv.includes('--flutter') ? '' : ` × ${SCHEMES.length} schemes`}: ${verdict.failing.length} failing, ${verdict.tolerated.length} tolerated, ${verdict.advisory.length} advisory, ${verdict.stale.length} stale → exit ${code}`);
    return code;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
