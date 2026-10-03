#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gen-accessibility-statement.mjs — nikatru.com/accessibility, GENERATED from the
// exceptions register (lane a11y-statement, Do 2; rows O-A11Y-STATEMENT-
// UNPUBLISHED, O-WEB-A11Y-SCAN-MISSING).
//
//     tooling/a11y/exceptions.json ──(this script)──▶ sites/nikatru/accessibility.html
//
// WHY GENERATED. C-WCAG-22-AA calls a published accessibility claim a
// representation, and a failed one a misstatement. The page therefore says
// nothing the evidence does not: its exceptions are the register's rows, the
// same rows tooling/a11y/scan.mjs tolerates and nothing more, so a gap the scan
// finds cannot be missing from the page, and a gap fixed (the scan reports its
// row STALE) leaves the page in the same change. tooling/ci/assert-a11y-
// statement.mjs holds the page's `data-exception` ids equal to the register's,
// both ways.
//
// WHAT IT NEVER CLAIMS. Conformance. The page says what standard we work to,
// what is tested and how, and what is known to fall short — in that order. The
// absence of a manual screen-reader pass on Apple devices is a register row, so
// it is published like any other gap.
//
// The page is a CHROME page (tooling/sites/chrome.mjs): it is emitted with every
// chrome region filled by `applyChrome`, so generate-discovery.mjs's splice over
// it is a no-op and the footer, skip link and focus CSS are the site's own.
//
// Usage:  node tooling/sites/gen-accessibility-statement.mjs [repoRoot] [--check]
// Exit 0 = written, or (--check) equal · 1 = --check found the page missing or
// different · 2 = COVERAGE LOST: the register is unreadable or has no row shape.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChrome } from './chrome.mjs';

export const REGISTER = 'tooling/a11y/exceptions.json';
export const PAGE = 'sites/nikatru/accessibility.html';
const ROW_KEYS = ['id', 'surface', 'pages', 'criterion', 'what', 'why', 'owner', 'until', 'axe'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** The register's problems, or [] — a malformed row is COVERAGE LOST, never skipped. */
export function registerProblems(doc) {
  const out = [];
  if (!doc || !Array.isArray(doc.exceptions)) return [`${REGISTER}: no "exceptions" array`];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.reviewed ?? '')) out.push(`${REGISTER}: "reviewed" is not a YYYY-MM-DD date`);
  if (!Number.isInteger(doc.reviewEveryMonths) || doc.reviewEveryMonths < 1) out.push(`${REGISTER}: "reviewEveryMonths" is not a positive integer`);
  const ids = new Set();
  for (const [i, r] of doc.exceptions.entries()) {
    for (const k of ROW_KEYS) if (!(k in r)) out.push(`${REGISTER}: exceptions[${i}] has no "${k}"`);
    if (ids.has(r.id)) out.push(`${REGISTER}: id ${r.id} appears twice`);
    ids.add(r.id);
    if (!/^A11Y-EX-[A-Z0-9-]+$/.test(r.id ?? '')) out.push(`${REGISTER}: exceptions[${i}] id ${JSON.stringify(r.id)} is not A11Y-EX-…`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.until ?? '')) out.push(`${REGISTER}: ${r.id} "until" is not a YYYY-MM-DD date`);
    if (!Array.isArray(r.axe) || !Array.isArray(r.pages)) out.push(`${REGISTER}: ${r.id} "axe" and "pages" must be lists`);
  }
  return out;
}

/** The page body between the nav and the footer. */
function mainHtml(doc) {
  const rows = doc.exceptions
    .map(
      (r) => `    <li data-exception="${esc(r.id)}"><b>${esc(r.surface)}</b> (WCAG ${esc(r.criterion)}): ${esc(r.what)} ${esc(r.why)}</li>`,
    )
    .join('\n');
  return `<main id="main">
  <h1>Accessibility statement</h1>
  <p class="updated">Last reviewed: ${longDate(doc.reviewed)}. We review this statement every ${doc.reviewEveryMonths} months and whenever a gap below is fixed.</p>

  <h2>The standard we work to</h2>
  <p>We build to the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA. In the apps, every control is at least
  48 by 48 pixels, above the Level AAA size, with any exception named below. This is the standard we hold our work to;
  it is not a claim that every page already meets it. Where we know it does not, the gap is listed on this page.</p>

  <h2>What this statement covers</h2>
  <ul>
    <li>This website, nikatru.com.</li>
    <li>Our apps on the web, Android, iOS, iPadOS, Windows, macOS and Linux.</li>
    <li>Our browser extensions.</li>
  </ul>

  <h2>How we test</h2>
  <ul>
    <li>On every change, an automated scan (axe-core) checks every page of this website in light and dark colour schemes,
    on a 375-pixel phone screen and a 1280-pixel desktop screen, and the web version of each app with its accessibility
    tree turned on. A serious or critical problem that is not listed below stops the change.</li>
    <li>On every change, automated tests check each app's screens for labels, contrast and the size of everything you can
    tap, the way Android's and Apple's accessibility guidelines measure them.</li>
    <li>No one has yet tested the apps with a screen reader on an Apple device. That gap is listed below.</li>
  </ul>
  <p>Automated testing finds many problems, not all of them. If something does not work for you, please tell us.</p>

  <h2>Known gaps</h2>
  <ul class="gaps">
${rows}
  </ul>

  <h2>Tell us about a problem</h2>
  <p>Use the <a href="/support#report-a-problem">Report a problem</a> form and choose &ldquo;Accessibility&rdquo;, or
  write to <!--email_off--><a href="mailto:support@nikatru.com">support@nikatru.com</a><!--/email_off-->. Tell us the page
  or screen, what you were trying to do and any assistive technology you use. We reply within 2 business days, as our
  <a href="/support">support page</a> promises.</p>
</main>`;
}

/** The whole page, chrome applied. */
export function renderStatement(doc) {
  const shell = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Accessibility statement &mdash; Nikatru</title>
<meta name="description" content="The accessibility standard Nikatru builds to, how we test it, the gaps we know about, and how to report a problem.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="https://nikatru.com/accessibility">
<meta name="theme-color" content="#0B1220">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="manifest" href="/site.webmanifest">
<!-- GENERATED from ${REGISTER} by tooling/sites/gen-accessibility-statement.mjs. DO NOT EDIT THIS FILE. -->
<style>
  :root{
  /* CHROME:scale-css */
  /* /CHROME:scale-css */
  }
  /* CHROME:marks-css */
  /* /CHROME:marks-css */
  :root{--ink:#0B1220;--primary:#2563EB;--teal:#0F766E;--on-accent:#FFFFFF;--bg:#F6F8FC;--card:#FFFFFF;--text:#1E293B;--strong:#0B1220;--muted:#586275;--line:#E2E8F0;--soft:#F6F8FC}
  @media (prefers-color-scheme: dark){
    :root{--bg:#0B1220;--card:#111C33;--text:#C7D2E3;--strong:#F1F5F9;--muted:#93A1BC;--line:#22304D;--soft:#0E1830;--primary:#6E9BFF;--teal:#17C3A2;--on-accent:#0B1220}
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
  nav{background:rgba(11,18,32,.96);position:sticky;top:0;z-index:10;border-bottom:1px solid rgba(255,255,255,.06)}
  .nav-in{max-width:820px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:10px;text-decoration:none}
  .brand svg{width:30px;height:30px}
  .brand span{color:#fff;font-weight:800;letter-spacing:.14em;font-size:15px}
  a.back{color:#B6C2D9;text-decoration:none;font-size:14px}
  a.back:hover{color:#fff}
  main{background:var(--card);max-width:820px;margin:32px auto;padding:44px 48px;border:1px solid var(--line);border-radius:16px}
  h1{font-size:32px;color:var(--strong);letter-spacing:-.01em}
  .updated{color:var(--muted);font-size:14px;margin:8px 0 26px}
  h2{font-size:19px;color:var(--strong);margin:28px 0 8px}
  p,li{font-size:15.5px;margin-bottom:11px}
  ul{margin:0 0 12px 22px}
  a{color:var(--primary)}
  /* CHROME:a11y-css */
  /* /CHROME:a11y-css */
  /* CHROME:footer-css */
  /* /CHROME:footer-css */
  @media(max-width:640px){main{padding:28px 22px;margin:16px}}
</style>
</head>
<body>
<!-- CHROME:skiplink -->
<!-- /CHROME:skiplink -->
<nav>
  <div class="nav-in">
    <a class="brand" href="/">
      <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="nm" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2E6FF2"/><stop offset="0.55" stop-color="#2AA0D8"/><stop offset="1" stop-color="#17C3A2"/></linearGradient></defs>
        <rect width="1024" height="1024" rx="244" fill="#111C33"/>
        <path d="M 292 720 L 292 304 L 656 720 L 656 304 M 580 380 L 656 304 L 732 380" fill="none" stroke="url(#nm)" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Nikatru</span>
    </a>
    <a class="back" href="/">&larr; Back to site</a>
  </div>
</nav>
${mainHtml(doc)}

<!-- CHROME:footer -->
<!-- /CHROME:footer -->

</body>
</html>
`;
  return applyChrome(shell);
}

export function genA11yStatement(root, { check = false } = {}) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  } catch (e) {
    return { code: 2, lines: [`gen-accessibility-statement: COVERAGE LOST — ${REGISTER} could not be read (${e.code ?? e.message})`] };
  }
  const problems = registerProblems(doc);
  if (problems.length) return { code: 2, lines: problems.map((p) => `gen-accessibility-statement: COVERAGE LOST — ${p}`) };
  const html = renderStatement(doc);
  const abs = join(root, PAGE);
  if (!check) {
    writeFileSync(abs, html, 'utf8');
    return { code: 0, lines: [`ok  wrote ${PAGE} (${doc.exceptions.length} known gap(s) from ${REGISTER})`] };
  }
  let current = null;
  try {
    current = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    /* missing */
  }
  if (current !== html) {
    return { code: 1, lines: [`✗ ${PAGE} is ${current === null ? 'missing' : 'not what ' + REGISTER + ' renders to'}. Run: node tooling/sites/gen-accessibility-statement.mjs`] };
  }
  return { code: 0, lines: [`ok  ${PAGE} equals a fresh render of ${REGISTER} (${doc.exceptions.length} known gap(s))`] };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const root = resolve(args.find((a) => !a.startsWith('--')) ?? join(fileURLToPath(import.meta.url), '..', '..', '..'));
  const { code, lines } = genA11yStatement(root, { check: args.includes('--check') });
  for (const l of lines) console.log(l);
  process.exitCode = code;
}
