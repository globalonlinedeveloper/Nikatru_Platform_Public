#!/usr/bin/env node
// -----------------------------------------------------------------------------
// check-tech-currency.mjs - the reader of the LOCKED owner constraint
// C-PIPELINE-ADAPTS-AND-STAYS-CURRENT: the pipeline stays current with what its
// vendors retire, and it is TOLD when something it runs on is going away.
//
// Findings B-9 and B-11 of the round-2 review (2026-09-29). The constraint was
// locked with no reader and no row: "a technology-currency reader item; it is
// not built". Renovate proposes NEW versions; nothing read the vendors'
// RETIREMENTS, and nothing re-read the pages our store deadlines came from.
//
// -- WHAT IT READS ---------------------------------------------------------------
//   1. THE TREE (pure, no network). Every `uses: owner/repo[/path]@ref` in
//      .github/workflows/*.yml and .github/actions/*/action.yml, and what each
//      one RUNS ON (`runs.using`, read from the action's own action.yml at the
//      pinned ref; a composite is followed into its own `uses:`). Plus the
//      toolchain pins of tooling/versions.json a vendor can retire: `node`,
//      `java`, `xcode` and the three `runner_*` labels.
//   2. THE GITHUB CHANGELOG, Actions label (github.blog/changelog/label/actions/
//      feed/), paged back LOOKBACK_DAYS. An entry RETIRES a subject when one
//      sentence of it (the title counts) carries a retirement phrase and names
//      the subject as what is going away - not as where to migrate TO ("update
//      to node24" names node24 as the target, and is not a retirement of it).
//   3. THE NODE.JS RELEASE SCHEDULE (nodejs/Release schedule.json): every Node
//      major the tree runs on - the `node` pin and every nodeNN action runtime -
//      against its end-of-life date, EOL_LEAD_DAYS ahead.
//   4. THE DUTY MATRIX'S SOURCES (tooling/legal/duty-matrix.json, finding B-11).
//      Every `primary-source` row's page is re-read. A page whose VENDOR dates
//      it (VENDOR_DATES: developer.android.com's "Last updated", learn.microsoft
//      .com's ms.date) and whose date is AFTER the row's `fetched` changed since
//      we read it. An `enforced` date (inForceFrom, extensionAvailableTo - the
//      EOL dates of a store requirement) that has PASSED since the row was
//      fetched means the page we hold describes a requirement now in force, and
//      the vendor publishes the NEXT one around that date. A dated vendor's page
//      that stops carrying its date is COULD NOT LOOK, never "unchanged".
//
// -- WHAT IT SAYS ----------------------------------------------------------------
// Each finding is a PROPOSAL: the subject, the evidence (the changelog entry,
// the EOL date, the vendor date), and who in the tree uses it. It changes
// nothing. The response is a person's: move the pin, re-read the page and
// advance the duty row, or record why not.
//
// -- FAIL-CLOSED, AND WHAT EACH EXIT MEANS ---------------------------------------
//   0 - everything above was read and nothing proposes a change.
//   1 - at least one proposal. Each is named with its evidence. A proposal read
//       from what WAS read stands even when another read failed (both print).
//   2 - COULD NOT LOOK: a read failed after the shared bounded plan, the feed
//       grammar changed (no item parsed), the paged feed never reached the
//       lookback window, an action's metadata or runtime could not be read, the
//       schedule lacks a Node major the tree runs on, or a dated vendor page
//       carried no date. NEVER 0.
//
// -- IT MUST NOT FREEZE THE MERGE THAT ANSWERS IT ------------------------------
// A retirement is answered by merging a pin move. So this reader runs in
// ops-watch.yml's `tech-currency` job on the Monday slot, under the page-only row
// duty.freshness.tech-currency (liveVerdictScope), the shape
// duty.freshness.renovate-backlog already has.
//
// Usage:  node tooling/ops/check-tech-currency.mjs [--json] [root]
// Env:    none. Every source is public; no token is read or needed.
//
// `process.exit()` IS BANNED IN THIS FILE, the same rule its neighbours in
// tooling/ops carry: set `process.exitCode`.
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouldNotLook, fetchWithBoundedRetry } from './bounded-retry.mjs';

export { CouldNotLook } from './bounded-retry.mjs';

export const DAY_MS = 86_400_000;
export const CHANGELOG_FEED = 'https://github.blog/changelog/label/actions/feed/';
export const NODE_SCHEDULE = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';
export const RAW = 'https://raw.githubusercontent.com';
/** How far back the changelog is read. A retirement is announced months ahead of
 *  its date and stays a proposal until the tree moves, so a weekly reader reads a
 *  season, not a week. Judgement: GitHub announced the Node 20 removal (the entry
 *  of 2026-09-23 is its FINAL notice) across several months of posts. */
export const LOOKBACK_DAYS = 120;
/** Feed pages read at most. The Actions label posts about ten entries a page and
 *  reached 2026-06-25 on page 2 (read 2026-09-29), so 120 days is about four
 *  pages; a feed that has not reached the window by this page is COULD NOT LOOK. */
export const CHANGELOG_PAGES = 8;
/** A Node major this close to its end of life is a proposal now: a runtime move
 *  in actions and in the toolchain pin takes more than one Monday. */
export const EOL_LEAD_DAYS = 120;
/** An `enforced` duty date this close is printed (not a proposal): the guard that
 *  reads the row already enforces its value. */
export const DEADLINE_LEAD_DAYS = 60;
/** How deep a composite action is followed into the actions it uses. */
export const COMPOSITE_DEPTH = 3;

/** Hosts that DATE their pages, and where. A dated host whose page carries no
 *  date is COULD NOT LOOK: the date is how this reader sees a change. */
export const VENDOR_DATES = Object.freeze([
  { host: 'developer.android.com', re: /Last updated (\d{4}-\d{2}-\d{2}) UTC/, what: '"Last updated YYYY-MM-DD UTC."' },
  { host: 'learn.microsoft.com', re: /<meta name="ms\.date" content="(\d{4}-\d{2}-\d{2})/, what: '<meta name="ms.date">' },
]);

/** A phrase that says something is going away. */
export const RETIRE_PHRASE =
  /\b(?:deprecat\w*|retir(?:e|es|ed|ing|ement)|sunset\w*|end[- ]of[- ](?:life|support)|EOL|no longer (?:be )?(?:available|supported)|(?:is|are|was|were|will be|is being|are being|to be|being) removed|removal of|brownouts?|shut(?:ting)? down)\b/i;
/** The words before a subject that name it as the migration TARGET, not the thing retired. */
const TARGET_BEFORE = /\b(?:to|use|uses|using|with|onto|into|towards|supports?|require[sd]?)\s+(?:the\s+)?$/i;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const decode = (s) =>
  String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;|&rsquo;|&#39;|&#x27;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8230;|&hellip;/g, '...')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const tag = (item, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
  return m ? m[1] : '';
};
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ── the tree ────────────────────────────────────────────────────────────────

/** PURE. Every `uses:` reference in one YAML text, as written. */
export function usesIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/^\s*(?:-\s+)?uses:\s*['"]?([^\s'"#]+)['"]?[ \t]*(?:#[ \t]*(\S+))?/gm)) out.push({ ref: m[1], tag: m[2] ?? null });
  return out;
}

/** PURE. A remote action reference, or null for a local path, a docker image or a
 *  reusable workflow (those carry no action.yml `runs.using`). */
export function parseActionRef(ref) {
  if (/^(?:\.\/|docker:\/\/)/.test(ref)) return null;
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)((?:\/[^@]+)?)@([^@\s]+)$/.exec(ref);
  if (!m) return null;
  const path = m[3].replace(/^\//, '');
  if (/\.ya?ml$/.test(path)) return null;
  return { owner: m[1], repo: m[2], path, at: m[4], id: `${m[1]}/${m[2]}${path ? `/${path}` : ''}@${m[4]}` };
}

/** PURE. What an action.yml runs on: `node24`, `composite`, `docker`, or null. */
export function runsUsing(actionYml) {
  const text = String(actionYml ?? '');
  const runs = /^runs:\s*$/m.exec(text);
  if (!runs) return null;
  const m = /^[ \t]+using:\s*['"]?([A-Za-z0-9._-]+)['"]?/m.exec(text.slice(runs.index));
  return m ? m[1] : null;
}

/** Every workflow and local composite action, with the `uses:` each holds. */
export function readTree(root) {
  const files = [];
  const wfDir = join(root, '.github', 'workflows');
  const acDir = join(root, '.github', 'actions');
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x)).sort()) files.push({ rel: `.github/workflows/${f}`, text: readFileSync(join(wfDir, f), 'utf8') });
  }
  if (existsSync(acDir)) {
    for (const d of readdirSync(acDir).sort()) {
      for (const n of ['action.yml', 'action.yaml']) {
        const p = join(acDir, d, n);
        if (existsSync(p)) files.push({ rel: `.github/actions/${d}/${n}`, text: readFileSync(p, 'utf8') });
      }
    }
  }
  let versions = null;
  try {
    versions = JSON.parse(readFileSync(join(root, 'tooling', 'versions.json'), 'utf8'));
  } catch {
    versions = null;
  }
  let duties = null;
  try {
    duties = JSON.parse(readFileSync(join(root, 'tooling', 'legal', 'duty-matrix.json'), 'utf8'));
  } catch {
    duties = null;
  }
  return { files, versions, duties };
}

/** PURE. Every remote action the tree pins, with the files that use it. */
export function pinnedActions(files) {
  const byId = new Map();
  for (const { rel, text } of files) {
    for (const u of usesIn(text)) {
      const a = parseActionRef(u.ref);
      if (!a) continue;
      const cur = byId.get(a.id) ?? { ...a, tag: u.tag, usedBy: new Set() };
      cur.usedBy.add(rel);
      byId.set(a.id, cur);
    }
  }
  return [...byId.values()].map((a) => ({ ...a, usedBy: [...a.usedBy].sort() }));
}

/** PURE. The subjects a vendor can retire, each with a matcher and its users.
 *  `runtimes` is Map actionId -> `runs.using`. */
export function subjectsOf({ versions, actions, runtimes }) {
  const subjects = new Map();
  const add = (id, label, re, user) => {
    const s = subjects.get(id) ?? { id, label, re, users: [] };
    if (!s.users.includes(user)) s.users.push(user);
    subjects.set(id, s);
  };
  const nodeRe = (n) => new RegExp(`\\bnode(?:\\.js|js)?[\\s-]?${n}\\b`, 'i');
  for (const a of actions) {
    const using = runtimes.get(a.id);
    const m = /^node(\d+)$/.exec(using ?? '');
    if (m) add(`node${m[1]}`, `Node ${m[1]}`, nodeRe(m[1]), `${a.owner}/${a.repo}${a.path ? `/${a.path}` : ''}@${a.at.slice(0, 12)}${a.tag ? ` (${a.tag})` : ''} runs on node${m[1]}`);
  }
  const v = versions ?? {};
  if (/^\d+$/.test(String(v.node ?? ''))) add(`node${v.node}`, `Node ${v.node}`, nodeRe(v.node), `tooling/versions.json node = ${v.node}`);
  if (/^\d+$/.test(String(v.java ?? ''))) add(`java${v.java}`, `Java ${v.java}`, new RegExp(`\\b(?:java|jdk|openjdk|temurin)[\\s-]?${v.java}\\b`, 'i'), `tooling/versions.json java = ${v.java}`);
  if (/^\d+$/.test(String(v.xcode ?? ''))) add(`xcode${v.xcode}`, `Xcode ${v.xcode}`, new RegExp(`\\bxcode[\\s-]?${v.xcode}\\b`, 'i'), `tooling/versions.json xcode = ${v.xcode}`);
  for (const key of Object.keys(v).filter((k) => /^runner_/.test(k))) {
    const m = /^([a-z]+)-(.+)$/.exec(String(v[key]));
    if (!m) continue;
    const ver = m[2].replace(/\./g, '\\.');
    const fam = m[1] === 'windows' ? 'windows(?:[\\s-]server)?' : m[1];
    add(`runner:${v[key]}`, `the ${v[key]} runner image`, new RegExp(`\\b${fam}[\\s-]${ver}\\b`, 'i'), `tooling/versions.json ${key} = ${v[key]}`);
  }
  return [...subjects.values()];
}

// ── the changelog ───────────────────────────────────────────────────────────

/** PURE. The items of one RSS page. */
export function parseFeed(xml) {
  const items = [];
  for (const m of String(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const date = Date.parse(decode(tag(it, 'pubDate')));
    items.push({
      title: decode(tag(it, 'title')),
      link: decode(tag(it, 'link')),
      date: Number.isFinite(date) ? isoDay(date) : null,
      at: Number.isFinite(date) ? date : null,
      text: decode(tag(it, 'content:encoded') || tag(it, 'description')),
    });
  }
  return items;
}

/** PURE. The sentences of one entry, title first. */
export function sentencesOf(item) {
  return [item.title, ...String(item.text ?? '').split(/(?<=[.!?])\s+/)].filter((s) => s && s.trim().length > 0);
}

/** PURE. Does this sentence say `subject` is going away? */
export function retiresIn(sentence, subject) {
  if (!RETIRE_PHRASE.test(sentence)) return false;
  const re = new RegExp(subject.re.source, subject.re.flags.includes('g') ? subject.re.flags : `${subject.re.flags}g`);
  for (const m of sentence.matchAll(re)) {
    if (!TARGET_BEFORE.test(sentence.slice(Math.max(0, m.index - 24), m.index))) return true;
  }
  return false;
}

/** PURE. Every (entry, subject) pair in which the entry retires a subject the tree uses. */
export function retirements(items, subjects) {
  const out = [];
  for (const item of items) {
    for (const s of subjects) {
      const hit = sentencesOf(item).find((x) => retiresIn(x, s));
      if (hit) out.push({ item, subject: s, sentence: hit.length > 220 ? `${hit.slice(0, 217)}...` : hit });
    }
  }
  return out;
}

// ── the duty matrix ─────────────────────────────────────────────────────────

/** PURE. The date a dated vendor printed on its page, `null` when the host is
 *  undated, or `{ missing }` when a dated host's page carries no date. */
export function vendorDate(url, html) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  const v = VENDOR_DATES.find((d) => d.host === host);
  if (!v) return null;
  const m = v.re.exec(String(html ?? ''));
  return m ? { date: m[1], what: v.what } : { missing: v.what };
}

/** PURE. The duty rows whose sources this reader re-reads. */
export function sourcedDuties(duties) {
  return (Array.isArray(duties?.duties) ? duties.duties : []).filter(
    (d) => d?.verification === 'primary-source' && typeof d?.source?.url === 'string' && typeof d?.source?.fetched === 'string',
  );
}

/** PURE. The verdict on one duty row, given what its page said. */
export function judgeDuty(d, page, now) {
  const today = isoDay(now);
  const fetched = d.source.fetched;
  const out = { proposals: [], lost: [], notes: [] };
  if (!ISO.test(fetched)) {
    out.lost.push(`duty ${d.id} - source.fetched ${JSON.stringify(fetched)} is not a YYYY-MM-DD date, so nothing can be compared with it.`);
    return out;
  }
  if (page.status === 404 || page.status === 410) {
    out.proposals.push(`⚑ SOURCE GONE - duty ${d.id}: ${d.source.url} answers HTTP ${page.status}. The rule this row cites has moved; re-find it on its vendor and re-read it.`);
  } else if (page.html !== undefined) {
    const vd = vendorDate(d.source.url, page.html);
    if (vd?.missing) {
      out.lost.push(`duty ${d.id} - ${d.source.url} is on a host that dates its pages (${vd.missing}) and this page carried no date, so a change since ${fetched} cannot be seen.`);
    } else if (vd?.date && vd.date > fetched) {
      out.proposals.push(
        `⚑ SOURCE CHANGED - duty ${d.id}: its vendor dated ${d.source.url} ${vd.date}, after it was read on ${fetched}. ` +
          'Re-read the page; if the rule still says what the row quotes, set source.fetched; if not, update the row and the guard that reads it.',
      );
    } else if (vd?.date) {
      out.notes.push(`duty ${d.id} - vendor date ${vd.date} <= fetched ${fetched}: unchanged since it was read.`);
    } else {
      out.notes.push(`duty ${d.id} - ${new URL(d.source.url).host} does not date its pages; read, not compared.`);
    }
  }
  for (const [k, v] of Object.entries(d.enforced ?? {})) {
    if (typeof v !== 'string' || !ISO.test(v)) continue;
    if (v <= today && fetched < v) {
      out.proposals.push(
        `⚑ DEADLINE PASSED SINCE THE SOURCE WAS READ - duty ${d.id}: enforced.${k} ${v} has passed, and ${d.source.url} was last read on ${fetched}. ` +
          'The vendor publishes the NEXT requirement around this date; re-read the page and advance `enforced` (or set source.fetched if nothing moved).',
      );
    } else if (v > today && (Date.parse(v) - now) / DAY_MS <= DEADLINE_LEAD_DAYS) {
      out.notes.push(`duty ${d.id} - enforced.${k} ${v} is in ${Math.ceil((Date.parse(v) - now) / DAY_MS)} day(s).`);
    }
  }
  return out;
}

// ── the verdict ─────────────────────────────────────────────────────────────

/** PURE. The whole verdict, from what the reads returned. Every input that did
 *  not come back arrives as a `lost` line from the reader. */
export function judge({ subjects, feed, schedule, dutyPages, lost = [], now }) {
  const proposals = [];
  const notes = [];
  const lostLines = [...lost];

  // the changelog
  if (feed) {
    for (const r of retirements(feed.items, subjects)) {
      proposals.push(
        `⚑ RETIRED - ${r.subject.label}: the GitHub changelog of ${r.item.date} ("${r.item.title}") says: "${r.sentence}"  ${r.item.link}\n` +
          r.subject.users.map((u) => `      used by: ${u}`).join('\n'),
      );
    }
    notes.push(`changelog - ${feed.items.length} entr(ies) since ${feed.since} read over ${feed.pages} page(s); ${subjects.length} subject(s) matched against them.`);
  }

  // the Node schedule
  if (schedule) {
    for (const s of subjects.filter((x) => /^node\d+$/.test(x.id))) {
      const n = s.id.slice(4);
      const row = schedule[`v${n}`];
      if (!row || !ISO.test(String(row.end ?? ''))) {
        lostLines.push(`the Node.js release schedule has no end date for v${n}, which the tree runs on (${s.users.join('; ')}).`);
        continue;
      }
      const days = Math.ceil((Date.parse(row.end) - now) / DAY_MS);
      if (days <= EOL_LEAD_DAYS) {
        proposals.push(
          `⚑ END OF LIFE - Node ${n} ${days < 0 ? `reached end of life on ${row.end}` : `reaches end of life on ${row.end}, in ${days} day(s)`} (nodejs/Release schedule.json).\n` +
            s.users.map((u) => `      used by: ${u}`).join('\n'),
        );
      } else {
        notes.push(`Node ${n} - end of life ${row.end}, ${days} day(s) away.`);
      }
    }
  }

  // the duty matrix
  for (const { duty, page } of dutyPages ?? []) {
    const v = judgeDuty(duty, page, now);
    proposals.push(...v.proposals);
    lostLines.push(...v.lost);
    notes.push(...v.notes);
  }

  const lines = [];
  if (proposals.length > 0) lines.push(`x ${proposals.length} TECH-CURRENCY PROPOSAL(S) (C-PIPELINE-ADAPTS-AND-STAYS-CURRENT):`, ...proposals.map((p) => `  ${p}`));
  if (lostLines.length > 0) lines.push(`x COULD NOT LOOK - ${lostLines.length} read(s) did not give an answer, and "could not look" is never a pass:`, ...lostLines.map((l) => `    ${l}`));
  lines.push(...notes.map((n) => `  ⬜ ${n}`));
  const code = proposals.length > 0 ? 1 : lostLines.length > 0 ? 2 : 0;
  if (code === 0) lines.unshift(`ok  tech currency - nothing the tree runs on is retired, near end of life, or cited from a page that changed since it was read`);
  return { code, lines, proposals: proposals.length, lost: lostLines.length };
}

// ── the reads ───────────────────────────────────────────────────────────────

/**
 * ONE GET on the shared bounded plan (tooling/ops/bounded-retry.mjs). A 404 is
 * an ANSWER and comes back as one (the caller decides what it means); a 429 or
 * 5xx is re-asked; a failure that outlives the plan throws CouldNotLook.
 *
 * `doFetch` IS A TEST SEAM (vacuous-10), and the per-request ceiling arrives as
 * `signal` from the shared plan: this file arms no timer of its own.
 */
export async function readText(url, { doFetch = fetch, sleep, note } = {}) {
  // accept-language is load-bearing: developer.android.com answers a request that
  // names no language with a machine-translated page picked at random (measured
  // 2026-09-29: bn, pt-BR and es on three reads in a row), and a translated page
  // carries no "Last updated" line - a dated vendor that looks undated.
  const headers = { 'user-agent': 'nikatru-tech-currency', 'accept-language': 'en-US,en;q=0.9' };
  const res = await fetchWithBoundedRetry(({ signal }) => doFetch(url, { headers, redirect: 'follow', signal }), {
    describe: (s) => `${url}: ${s}`,
    sleep,
    note,
  });
  let text;
  try {
    text = await res.text();
  } catch (e) {
    throw new CouldNotLook(`${url}: answered HTTP ${res.status} and then dropped mid-body (${e?.message ?? e})`);
  }
  return { status: res.status, ok: res.ok, text };
}

/** Read one action's action.yml (then action.yaml) at its pinned ref. */
async function readActionYml(a, opts) {
  for (const name of ['action.yml', 'action.yaml']) {
    const url = `${RAW}/${a.owner}/${a.repo}/${a.at}/${a.path ? `${a.path}/` : ''}${name}`;
    const r = await readText(url, opts);
    if (r.ok) return r.text;
    if (r.status !== 404) throw new CouldNotLook(`${url}: answered HTTP ${r.status}`);
  }
  throw new CouldNotLook(`${a.id}: neither action.yml nor action.yaml exists at the pinned ref`);
}

/** Every action's runtime, following composites into the actions they use. */
export async function readRuntimes(actions, opts) {
  const runtimes = new Map();
  const lost = [];
  const seen = new Set();
  /** Every action read, the nested ones included, so a composite's inner runtime is a subject too. */
  const all = new Map();
  let frontier = actions.map((a) => ({ a, via: null }));
  for (let depth = 0; frontier.length > 0 && depth <= COMPOSITE_DEPTH; depth += 1) {
    const next = [];
    await Promise.all(
      frontier.map(async ({ a, via }) => {
        if (seen.has(a.id)) return;
        seen.add(a.id);
        all.set(a.id, a);
        let yml;
        try {
          yml = await readActionYml(a, opts);
        } catch (e) {
          lost.push(`the runtime of ${a.id}${via ? ` (used inside ${via})` : ''} was not read: ${e instanceof CouldNotLook ? e.message : `${e?.name}: ${e?.message}`}`);
          return;
        }
        const using = runsUsing(yml);
        if (!using) {
          lost.push(`${a.id}'s action.yml carries no \`runs.using\` this reader can parse; its runtime is unknown.`);
          return;
        }
        runtimes.set(a.id, using);
        if (using === 'composite') {
          for (const u of usesIn(yml)) {
            const inner = parseActionRef(u.ref);
            if (inner) next.push({ a: { ...inner, tag: u.tag, usedBy: [...(a.usedBy ?? []).map((f) => `${f} via ${a.id}`)] }, via: a.id });
          }
        }
      }),
    );
    frontier = next;
  }
  if (frontier.length > 0) lost.push(`composite actions nest deeper than ${COMPOSITE_DEPTH}; ${frontier.length} action(s) below that depth were not read.`);
  return { runtimes, lost, all: [...all.values()] };
}

/** The Actions changelog, paged back to `now - LOOKBACK_DAYS`. */
export async function readChangelog(now, opts) {
  const since = isoDay(now - LOOKBACK_DAYS * DAY_MS);
  const items = [];
  for (let page = 1; page <= CHANGELOG_PAGES; page += 1) {
    const url = page === 1 ? CHANGELOG_FEED : `${CHANGELOG_FEED}?paged=${page}`;
    const r = await readText(url, opts);
    if (!r.ok) {
      if (page > 1 && r.status === 404) return { items, since, pages: page - 1 }; // the whole feed was read
      throw new CouldNotLook(`${url}: answered HTTP ${r.status}`);
    }
    const got = parseFeed(r.text);
    if (got.length === 0 || got.some((i) => i.at === null)) {
      throw new CouldNotLook(`${url}: ${got.length === 0 ? 'no <item> parsed' : 'an <item> with no readable <pubDate>'} - the feed grammar changed, and zero entries would be a false clean.`);
    }
    items.push(...got.filter((i) => i.date >= since));
    if (got.some((i) => i.date < since)) return { items, since, pages: page };
  }
  throw new CouldNotLook(`${CHANGELOG_FEED}: ${CHANGELOG_PAGES} page(s) read and the feed had not reached ${since}; the window was not covered.`);
}

/** Every read, gathered; a failed read becomes a `lost` line, never a throw. */
export async function readAll({ root, now, doFetch = fetch, sleep, note }) {
  const opts = { doFetch, sleep, note };
  const tree = readTree(root);
  const lost = [];
  if (!tree.versions) lost.push(`${join(root, 'tooling', 'versions.json')} could not be read, so no toolchain pin was matched.`);
  if (!tree.duties) lost.push(`${join(root, 'tooling', 'legal', 'duty-matrix.json')} could not be read, so no duty source was re-read.`);
  const actions = pinnedActions(tree.files);
  if (tree.files.length === 0 || actions.length === 0) lost.push(`no workflow under ${join(root, '.github')} pins a remote action; the tree walk read nothing.`);
  const guard = async (what, fn) => {
    try {
      return await fn();
    } catch (e) {
      lost.push(`${what}: ${e instanceof CouldNotLook ? e.message : `${e?.name}: ${e?.message}`}`);
      return null;
    }
  };
  const duties = sourcedDuties(tree.duties);
  if (tree.duties && duties.length === 0) lost.push('tooling/legal/duty-matrix.json has no primary-source row with a url and a fetched date; the B-11 limb read nothing.');
  const [rt, feed, scheduleText, dutyPages] = await Promise.all([
    readRuntimes(actions, opts),
    guard('the GitHub changelog', () => readChangelog(now, opts)),
    guard('the Node.js release schedule', async () => {
      const r = await readText(NODE_SCHEDULE, opts);
      if (!r.ok) throw new CouldNotLook(`${NODE_SCHEDULE}: answered HTTP ${r.status}`);
      return r.text;
    }),
    Promise.all(
      duties.map(async (duty) => {
        const page = await guard(`duty ${duty.id}'s source`, async () => {
          const r = await readText(duty.source.url, opts);
          if (!r.ok && r.status !== 404 && r.status !== 410) throw new CouldNotLook(`${duty.source.url}: answered HTTP ${r.status}`);
          return r.ok ? { status: r.status, html: r.text } : { status: r.status };
        });
        return page ? { duty, page } : null;
      }),
    ),
  ]);
  lost.push(...rt.lost);
  let schedule = null;
  if (scheduleText !== null) {
    try {
      schedule = JSON.parse(scheduleText);
    } catch (e) {
      lost.push(`the Node.js release schedule is not JSON (${e.message}).`);
    }
  }
  const subjects = subjectsOf({ versions: tree.versions, actions: rt.all, runtimes: rt.runtimes });
  return { subjects, feed, schedule, dutyPages: dutyPages.filter(Boolean), lost, actions, read: rt.all, runtimes: rt.runtimes };
}

async function main(argv) {
  const json = argv.includes('--json');
  const rootArg = argv.find((a) => !a.startsWith('--'));
  const root = resolve(rootArg ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const now = Date.now();
  console.log(`check-tech-currency - what the pipeline runs on, against what its vendors retire   (C-PIPELINE-ADAPTS-AND-STAYS-CURRENT, duty.freshness.tech-currency)`);
  const read = await readAll({ root, now, note: (l) => console.error(`    ${l}`) });
  const runtimes = [...read.runtimes.values()].reduce((m, u) => m.set(u, (m.get(u) ?? 0) + 1), new Map());
  console.log(
    `  read: ${read.actions.length} pinned action(s), ${read.read.length} with the ones composites use (runtimes: ${[...runtimes].map(([u, n]) => `${n} ${u}`).join(', ') || 'none read'}), ` +
      `${read.subjects.length} subject(s), ${read.dutyPages.length} duty source(s)`,
  );
  const v = judge({ ...read, now });
  for (const line of v.lines) (v.code === 0 || line.startsWith('  ⬜') ? console.log : console.error)(line);
  if (json) console.log(JSON.stringify({ code: v.code, proposals: v.proposals, lost: v.lost, subjects: read.subjects.map((s) => s.id) }));
  if (v.code === 2) console.error('    Nothing above is a pass. That is exit 2 (COVERAGE LOST).');
  process.exitCode = v.code;
}

if (process.argv[1] && process.argv[1].endsWith('check-tech-currency.mjs')) {
  await main(process.argv.slice(2));
}
