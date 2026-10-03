#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// build-status.mjs — the public status page, sites/status (status.nikatru.com),
// GENERATED from the registers and the readings the ops beat already takes
// (lane status-page; rows O-PUBLIC-STATUS-PAGE-MISSING, R11-02).
//
//   node tooling/status/build-status.mjs [repoRoot]           write sites/status
//   node tooling/status/build-status.mjs [repoRoot] --check   compare, write nothing
//   node tooling/status/build-status.mjs [repoRoot] --out <dir>
//        [--readings <status.mjs --json file>] [--prev <status.json file>]
//        [--github-output <file>]
//                                   build a deployable copy into <dir> and say
//                                   whether it is worth publishing (publish=true|false)
//   node tooling/status/build-status.mjs --smoke <origin> --built <dir>/status.json
//                                   after a deploy: the origin serves this build
//
// THE COMPONENTS are tooling/monitor-register.json's rows (hosts and their
// pathMonitors) that carry `statusPage: { public: true, component }` —
// tooling/ci/assert-status-components.mjs holds that every public component has a
// monitor and every row marked public has a component. A row without
// `statusPage` stays private. A new app's monitors join through the same field.
//
// NO SECOND CHECKER. A component's state is read from tooling/ops/status.mjs's
// own verdicts (`--json`), the probe ops-watch already runs: `ok` is
// operational, a graded failure is down. A component that run did not grade —
// no reading, a path monitor it does not probe, a surface it could not reach —
// is "not monitored", NEVER operational. The committed copy has no reading at
// all, so it says exactly that.
//
// ON CHANGE, NOT ON A TIMER. `shouldPublish` answers true only when a
// component's state differs from the last published status.json, or when the
// last publish was on an earlier UTC day (once a day, so "last checked" stays
// honest). Two identical beats publish once.
//
// INCIDENTS are written by people: ops/incidents/<YYYY-MM-DD>-<slug>.md
// (tooling/ci/assert-incidents.mjs), rendered as the page's history and an Atom
// feed. Nothing here reads a report or a user's data.
//
// The page has NO script, NO cookie and NO third-party request; its _headers
// CSP is `default-src 'none'` with a same-origin stylesheet. It never depends on
// the platform Worker or Box B to render: it is static bytes on its own Pages
// project. No child process but `git`, through tooling/sites/lastmod.mjs.
//
// Exit 0 written / current · 1 a finding (stale output, a bad incident) ·
// 2 COVERAGE LOST (the register unreadable, or no public component).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastmodFor } from '../sites/lastmod.mjs';
import { listDir } from '../ci/tree-walk.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REGISTER = 'tooling/monitor-register.json';
export const INCIDENTS = 'ops/incidents';
export const SITE = 'sites/status';
export const ORIGIN = 'https://status.nikatru.com';
export const STATES = Object.freeze({ up: 'operational', down: 'down', none: 'not monitored' });
/** The day the page first existed: the feed's `updated` while no incident has been written. */
export const LAUNCHED = '2026-10-03T00:00:00Z';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (root, rel) => path.join(root, ...rel.split('/'));
const utcDay = (iso) => String(iso ?? '').slice(0, 10);

/** The public components, in register order: [{ name, hostname, path|null }], or { lost }. */
export function readComponents(root) {
  let reg;
  try {
    reg = JSON.parse(readFileSync(abs(root, REGISTER), 'utf8'));
  } catch (e) {
    return { lost: `${REGISTER} could not be read (${e.code ?? e.message})` };
  }
  if (!Array.isArray(reg.hosts)) return { lost: `${REGISTER} declares no hosts array` };
  const out = [];
  for (const row of reg.hosts) {
    if (row?.statusPage?.public === true) out.push({ name: row.statusPage.component, hostname: row.hostname, url: row.monitor?.url ?? `https://${row.hostname}/`, path: null });
    for (const pm of row.pathMonitors ?? []) {
      if (pm?.statusPage?.public === true) out.push({ name: pm.statusPage.component, hostname: row.hostname, url: pm.url ?? null, path: pm.url ?? null });
    }
  }
  if (out.length === 0) return { lost: `${REGISTER} names no public component (statusPage.public), so the page would report on nothing` };
  return { components: out };
}

/**
 * The status document for `components` given a status.mjs reading (or null) and
 * the last published document (or null): every component's state, and since
 * when it has been in that state.
 */
export function statusDoc(components, readings, prev, now) {
  const prevBy = new Map((prev?.components ?? []).map((c) => [c.name, c]));
  const verdicts = readings?.surfaces ?? {};
  const list = components.map((c) => {
    // A path monitor is not a surface status.mjs probes: no reading, ever.
    const v = c.path === null ? verdicts[c.hostname] : undefined;
    const state = v === 'ok' ? STATES.up : v === 'unhealthy' ? STATES.down : STATES.none;
    const before = prevBy.get(c.name);
    const since = before && before.state === state ? before.since : readings?.checkedAt ?? null;
    return { name: c.name, state, since };
  });
  const states = list.map((c) => c.state);
  const overall = states.includes(STATES.down) ? 'degraded' : states.every((s) => s === STATES.up) ? 'operational' : 'partial';
  return { version: 1, checkedAt: readings?.checkedAt ?? null, publishedAt: now, overall, components: list };
}

/** Publish when a state changed, or once a UTC day; never twice for one picture. */
export function shouldPublish(prev, next) {
  if (!prev || !Array.isArray(prev.components)) return true;
  const was = new Map(prev.components.map((c) => [c.name, c.state]));
  if (next.components.length !== prev.components.length) return true;
  if (next.components.some((c) => was.get(c.name) !== c.state)) return true;
  return utcDay(prev.publishedAt) !== utcDay(next.publishedAt);
}

/** `--- … ---` front matter as a flat map; `[a, b]` is a list. */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    fm[kv[1]] = v;
  }
  return { fm, body: text.slice(m[0].length) };
}

/** Paragraphs and `- ` lists, with **bold**; everything escaped. */
export function renderText(body) {
  const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return body
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      if (lines.every((l) => /^- /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('\n');
}

/** Every incident, newest first: [{ slug, file, fm, html }]. */
export function readIncidents(root) {
  const dir = abs(root, INCIDENTS);
  if (!existsSync(dir)) return [];
  return listDir(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .reverse()
    .map((f) => {
      const parsed = frontMatter(readFileSync(path.join(dir, f), 'utf8'));
      return parsed ? { slug: f.slice(0, -3), file: `${INCIDENTS}/${f}`, fm: parsed.fm, html: renderText(parsed.body) } : null;
    })
    .filter(Boolean);
}

const fmtTime = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '');

/** The page. */
export function renderIndex(doc, incidents) {
  const rows = doc.components
    .map(
      (c) => `      <li class="component state-${c.state.replace(/\s+/g, '-')}">
        <span class="name">${esc(c.name)}</span>
        <span class="state">${esc(c.state === STATES.up ? 'Operational' : c.state === STATES.down ? 'Down' : 'Not monitored')}</span>${c.since && c.state !== STATES.none ? `\n        <span class="since">since ${esc(fmtTime(c.since))}</span>` : ''}
      </li>`,
    )
    .join('\n');
  const headline =
    doc.checkedAt === null
      ? 'No reading has been published yet.'
      : doc.overall === 'operational'
        ? 'All monitored services are operational.'
        : doc.overall === 'degraded'
          ? 'Some services are down.'
          : 'Some services are not monitored.';
  const history = incidents.length
    ? incidents
        .map(
          (i) => `    <article class="incident" id="${esc(i.slug)}">
      <h3>${esc(i.fm.title ?? i.slug)}</h3>
      <p class="when">${esc(fmtTime(i.fm.started))}${i.fm.resolved ? ` – ${esc(fmtTime(i.fm.resolved))}` : ' – ongoing'}${Array.isArray(i.fm.components) && i.fm.components.length ? ` · ${esc(i.fm.components.join(', '))}` : ''}</p>
${i.html.split('\n').map((l) => `      ${l}`).join('\n')}
    </article>`,
        )
        .join('\n')
    : '    <p class="none">No incidents recorded.</p>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nikatru status</title>
<meta name="description" content="Whether Nikatru's apps, sign-in and websites are working right now, and the history of past incidents.">
<link rel="canonical" href="${ORIGIN}/">
<link rel="alternate" type="application/atom+xml" title="Nikatru incidents" href="/feed.xml">
<link rel="stylesheet" href="/style.css">
<!-- GENERATED by tooling/status/build-status.mjs from tooling/monitor-register.json, the ops beat's readings and ops/incidents/. Never edit; run the generator. -->
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header><p class="brand"><a href="https://nikatru.com/">Nikatru</a> status</p></header>
<main id="main">
  <h1>${esc(headline)}</h1>
  <p class="checked">${doc.checkedAt === null ? 'Last checked: not yet.' : `Last checked ${esc(fmtTime(doc.checkedAt))}.`} This page is updated when a service changes state, and at least once a day.</p>
  <section aria-labelledby="now">
    <h2 id="now">Services</h2>
    <ul class="components">
${rows}
    </ul>
    <p class="note">"Not monitored" means our checks cannot see that service yet — never that it is fine.</p>
  </section>
  <section aria-labelledby="history">
    <h2 id="history">Incident history</h2>
${history}
    <p><a href="/feed.xml">Incident feed (Atom)</a></p>
  </section>
  <p>Something wrong that is not shown here? <a href="https://nikatru.com/support#report-a-problem">Report a problem</a> · <a href="https://nikatru.com/help/">Help centre</a></p>
</main>
</body>
</html>
`;
}

/** The Atom feed of incidents. Deterministic: no clock is read. */
export function renderFeed(incidents) {
  const stamp = (i) => (i.fm.resolved || i.fm.started || LAUNCHED);
  const updated = incidents.length ? incidents.map(stamp).sort().reverse()[0] : LAUNCHED;
  const entries = incidents
    .map(
      (i) => `  <entry>
    <title>${esc(i.fm.title ?? i.slug)}</title>
    <id>tag:status.nikatru.com,2026:${esc(i.slug)}</id>
    <link href="${ORIGIN}/#${esc(i.slug)}"/>
    <updated>${esc(stamp(i))}</updated>
    <content type="html">${esc(i.html)}</content>
  </entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Nikatru incidents</title>
  <id>${ORIGIN}/feed.xml</id>
  <link rel="self" href="${ORIGIN}/feed.xml"/>
  <link href="${ORIGIN}/"/>
  <updated>${updated}</updated>
  <author><name>Nikatru</name></author>
${entries ? `${entries}\n` : ''}</feed>
`;
}

export const STYLE = `:root{--ink:#0B1220;--primary:#2563EB;--bg:#F6F8FC;--card:#FFFFFF;--text:#1E293B;--strong:#0B1220;--muted:#586275;--line:#E2E8F0;--positive:#05694C;--danger:#B3123B}
@media (prefers-color-scheme: dark){:root{--bg:#0B1220;--card:#111C33;--text:#C7D2E3;--strong:#F1F5F9;--muted:#93A1BC;--line:#22304D;--primary:#6E9BFF;--positive:#34D399;--danger:#FF8A9E}}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--primary)}
header{background:var(--ink);padding:14px 24px}
header .brand{margin:0;color:#fff;font-weight:700}
header .brand a{color:#fff;text-decoration:none;display:inline-block;padding:4px 0}
main{max-width:760px;margin:24px auto;padding:28px;background:var(--card);border:1px solid var(--line);border-radius:16px}
h1{font-size:26px;color:var(--strong);margin:0 0 8px}
h2{font-size:19px;color:var(--strong);margin:28px 0 8px}
h3{font-size:16px;color:var(--strong);margin:16px 0 4px}
.checked,.note,.when,.since,.none{color:var(--muted);font-size:14px}
.components{list-style:none;padding:0;margin:0}
.component{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line)}
.component .name{font-weight:600;color:var(--strong)}
.state-operational .state{color:var(--positive);font-weight:600}
.state-down .state{color:var(--danger);font-weight:600}
.state-not-monitored .state{color:var(--muted)}
.since{flex-basis:100%}
.skip-link{position:absolute;left:-9999px;top:0;background:var(--primary);color:#fff;padding:10px 18px}
.skip-link:focus{left:0}
:focus-visible{outline:3px solid var(--primary);outline-offset:3px}
@media(max-width:640px){main{margin:12px;padding:20px}}
`;

/** Every committed output and its bytes, for `root`, with no reading. */
export function plan(root, { readings = null, prev = null, now = null } = {}) {
  const c = readComponents(root);
  if (c.lost) return { lost: [c.lost] };
  const incidents = readIncidents(root);
  const doc = statusDoc(c.components, readings, prev, now);
  const files = new Map();
  const index = renderIndex(doc, incidents);
  files.set(`${SITE}/index.html`, index);
  files.set(`${SITE}/status.json`, `${JSON.stringify(doc, null, 2)}\n`);
  files.set(`${SITE}/feed.xml`, renderFeed(incidents));
  files.set(`${SITE}/style.css`, STYLE);
  const lastmod = now ? utcDay(now) : lastmodFor(root, `${SITE}/index.html`, index);
  files.set(
    `${SITE}/sitemap.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${ORIGIN}/</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n</urlset>\n`,
  );
  return { files, doc, lost: [] };
}

function readJsonOrNull(file) {
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * After a deploy: the live status.json is the one just built (same publishedAt).
 * `fetchImpl` is injectable for tests. Returns an exit code.
 */
export async function smoke(origin, builtFile, { fetchImpl = fetch, log = console.log } = {}) {
  let built;
  try {
    built = JSON.parse(readFileSync(builtFile, 'utf8'));
  } catch (e) {
    log(`build-status smoke: COVERAGE LOST — ${builtFile} could not be read (${e.code ?? e.message})`);
    return 2;
  }
  let live;
  try {
    const res = await fetchImpl(`${origin}/status.json`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
    live = res.ok ? await res.json() : null;
  } catch {
    live = null;
  }
  if (!live) {
    log(`build-status smoke: ${origin}/status.json did not answer with a status document`);
    return 1;
  }
  if (live.publishedAt !== built.publishedAt) {
    log(`build-status smoke: ${origin} serves the document published ${live.publishedAt}, not this deploy's ${built.publishedAt}`);
    return 1;
  }
  log(`build-status smoke: ${origin} serves this deploy (${built.publishedAt}, ${built.components.length} component(s))`);
  return 0;
}

export function main(argv, log = console.log) {
  const at = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const valueFlags = new Set(['--out', '--readings', '--prev', '--github-output', '--smoke', '--built']);
  const rootArg = argv.find((a, i) => !a.startsWith('--') && !valueFlags.has(argv[i - 1]));
  const root = rootArg ? path.resolve(rootArg) : path.resolve(HERE, '..', '..');
  const out = at('--out');
  if (out) {
    const readings = readJsonOrNull(at('--readings'));
    const prev = readJsonOrNull(at('--prev'));
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const p = plan(root, { readings, prev, now });
    if (p.lost.length) {
      for (const l of p.lost) log(`build-status: COVERAGE LOST — ${l}`);
      return 2;
    }
    const publish = shouldPublish(prev, p.doc);
    for (const [rel, bytes] of p.files) {
      const file = path.join(path.resolve(out), rel.slice(SITE.length + 1));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    if (at('--github-output')) writeFileSync(at('--github-output'), `publish=${publish}\n`, { flag: 'a' });
    log(`build-status: ${p.doc.components.length} component(s), overall ${p.doc.overall}; ${prev ? 'a previous status.json was read' : 'no previous status.json'} → publish=${publish}`);
    return 0;
  }
  const check = argv.includes('--check');
  const p = plan(root);
  if (p.lost.length) {
    for (const l of p.lost) log(`build-status: COVERAGE LOST — ${l}`);
    return 2;
  }
  const stale = [];
  for (const [rel, want] of p.files) {
    const file = abs(root, rel);
    const have = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (have === want) continue;
    if (check) stale.push(rel);
    else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, want);
    }
  }
  if (stale.length) {
    for (const s of stale) log(`✗ stale ${s} — run node tooling/status/build-status.mjs`);
    return 1;
  }
  log(`build-status: ${check ? 'current' : 'written'} — ${p.files.size} output(s), ${p.doc.components.length} public component(s)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--smoke')) process.exit(await smoke(argv[argv.indexOf('--smoke') + 1], argv[argv.indexOf('--built') + 1]));
  process.exit(main(argv));
}
