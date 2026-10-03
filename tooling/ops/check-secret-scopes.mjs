#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-secret-scopes.mjs — WHERE GITHUB ACTUALLY STORES EACH SECRET, READ BACK
// AGAINST tooling/channel-register.json. NAMES ONLY: no value is ever requested.
//
// ⏱ 2026-10-02 · train P17 (security-001 parts 1 and 6, security-022), lane
// fix-secrets-scope-readback. assert-channel-register 8c holds every WORKFLOW to
// the scope a row declares, and says in its own header that it cannot see where
// GitHub stores the value. Nothing compared GitHub's secret names per scope with
// the register, so a secret declared environment-scoped could sit at repository
// level, readable by every job, unseen. CI's GITHUB_TOKEN cannot list secrets
// (#1095), so this runs where a token that can list names exists: the lead's gh
// (the twice-daily ops check), and ops-watch's Monday code-scanning-age job when
// SECRETS_READ_TOKEN is set.
//
// What it reads: the repository's secret names, every environment's names, the
// register's environment-scoped rows (ciSecretRegister.nonSigning with an
// `environment`, and the signing names `signingScope.match` covers), and every
// `secrets.NAME` the workflows reference.
//
//   exit 1  a secret the register scopes to an environment ALSO exists at
//           repository level while its row says `storedAt: "environment"`, or
//           while it says "repository" and the move date (MOVE_BY, #1095's
//           2026-11-30) has passed; or a scoped secret exists NOWHERE.
//           Before MOVE_BY a "repository" row with a `moveStep` PRINTS as
//           pending (#1095's rule), never fails. A scoped secret stored
//           nowhere whose row carries a `firstDue` (YYYY-MM-DD, at most
//           FIRST_DUE_MAX_DAYS ahead) is KNOWN FAILING, NOT YET DUE: it prints
//           and does not block until that date, and blocks from it.
//   prints  stored-but-unreferenced names (security-022: candidates to delete,
//           an owner step) and referenced-but-unstored names; and each move the
//           names show as DONE, with the follow-up: `--write-flips`.
//   exit 2  the names could not be read. `--unreadable-until <YYYY-MM-DD>`
//           turns a MISSING token into a ::warning:: and exit 0 until that date
//           (ops-watch, until the owner mints SECRETS_READ_TOKEN); a token that
//           is present but refused is exit 2 always.
//
// --write-flips (the dated follow-up template, patch 4): for every row whose
// move the names show as done (absent at repository level, present in each of
// its environments), rewrites `"storedAt": "repository"` to "environment" and
// deletes its `"moveStep"` line in tooling/channel-register.json, in place, and
// nothing else. The lead runs it after the owner's moves; the diff is the PR.
//
// Usage: GH_TOKEN=… node tooling/ops/check-secret-scopes.mjs [--repo o/r] [--today YYYY-MM-DD]
//        [--unreadable-until YYYY-MM-DD] [--write-flips] [--names-file <json>] [--root <dir>]
// `--names-file` is a FIXTURE ({repository: [...], environments: {env: [...]}}) for the
// tests; it prints a banner that must never appear in a real log.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllWorkflows } from '../ci/workflow-scan.mjs';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';
import { PLATFORM_REPO_SLUG } from '../generated/codehost.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTER_REL = 'tooling/channel-register.json';
/** #1095's move date: CLOUDFLARE_API_TOKEN's repositoryFallback and every signing licence end on it. */
export const MOVE_BY = '2026-11-30';
const IGNORED = new Set(['GITHUB_TOKEN']);

const scopeOf = (env) => (typeof env === 'string' && env.trim() ? [env.trim()] : Array.isArray(env) ? env.filter((e) => typeof e === 'string' && e.trim()) : null);

/** The rows this read-back grades: every environment-scoped nonSigning row, plus each referenced signing name. PURE. */
export function scopedRows(register, referenced) {
  const reg = register?.ciSecretRegister ?? {};
  const rows = [];
  for (const r of reg.nonSigning ?? []) {
    const envs = scopeOf(r?.environment);
    if (envs && envs.length) rows.push({ name: r.name, envs, storedAt: r.storedAt ?? null, moveStep: r.moveStep ?? null, firstDue: r.firstDue ?? null, from: 'nonSigning' });
  }
  const sc = reg.signingScope;
  if (sc && typeof sc.environment === 'string') {
    const rx = (sc.match ?? []).map((p) => new RegExp(p));
    for (const n of [...referenced].sort()) {
      if (rx.some((r) => r.test(n)) && !rows.some((x) => x.name === n)) rows.push({ name: n, envs: [sc.environment], storedAt: sc.storedAt ?? null, moveStep: sc.moveStep ?? null, from: 'signingScope' });
    }
  }
  return rows;
}

/** Every `secrets.NAME` (and `secrets['NAME']`) the workflows reference, read through workflow-scan.mjs
 *  (comment-blanked). Null when no workflow could be read: the caller refuses, never "no references". */
export function referencedNames(root) {
  const out = new Set();
  const wfs = parseAllWorkflows(root);
  if (!wfs.length) return null;
  for (const wf of wfs) {
    const text = wf.lines.map((l) => l.text).join('\n');
    // Inside `${{ … }}` only: prose and file names (`worker-secrets.json`) are not references.
    for (const expr of text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      for (const m of expr[1].matchAll(/(?<![\w.-])secrets\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g)) out.add(m[1] ?? m[2]);
    }
  }
  for (const n of IGNORED) out.delete(n);
  return out;
}

/** The longest a `firstDue` may sit ahead of today: a pending state is bounded, never an open-ended waiver. */
export const FIRST_DUE_MAX_DAYS = 92;

/** ⏱ 2026-10-02 · #1135 review finding 2. A scoped secret declared before its channel exists
 *  (SNAPCRAFT_STORE_CREDENTIALS: the owner sets up Snap) was red on every read from the first
 *  one, which teaches readers to skip the check. The register's own pattern answers it
 *  (assert-ops-register.mjs, `recordQuery.firstDue`): the verdict stays FAILING and PRINTS, only
 *  the block is lifted, only while today < firstDue, only for a date within FIRST_DUE_MAX_DAYS,
 *  and it expires by arithmetic. It applies to "stored nowhere" alone; a repository-level copy
 *  is never pending. PURE: { notYetDue, days } or { problem } or {}. */
export function firstDueVerdict(firstDue, today) {
  if (firstDue === null || firstDue === undefined) return {};
  const due = Date.parse(`${firstDue}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(firstDue)) || Number.isNaN(due)) return { problem: `its firstDue ${JSON.stringify(firstDue)} is not a YYYY-MM-DD date, so it gates nothing` };
  const days = Math.round((due - now) / 86_400_000);
  if (days > FIRST_DUE_MAX_DAYS) return { problem: `its firstDue ${firstDue} is ${days} days ahead, past the ${FIRST_DUE_MAX_DAYS}-day bound: a pending state is dated, not open-ended` };
  if (days > 0) return { notYetDue: true, days };
  return { problem: `its firstDue ${firstDue} has PASSED, so it gates nothing: mint the secret, or drop the row's environment scope until the channel exists` };
}

/** The verdict over the names. PURE. `stored` = { repository: Set, environments: Map(env → Set) }. */
export function grade(rows, stored, referenced, today) {
  const findings = [];
  const pending = [];
  const notYetDue = [];
  const done = [];
  for (const r of rows) {
    const atRepo = stored.repository.has(r.name);
    const inEnvs = r.envs.filter((e) => stored.environments.get(e)?.has(r.name));
    if (!atRepo && inEnvs.length === 0) {
      const nowhere = `${r.name}: scoped to ${r.envs.join(' | ')} and stored NOWHERE — not at repository level, not in ${r.envs.join(' or ')}`;
      const due = firstDueVerdict(r.firstDue, today);
      if (due.notYetDue) notYetDue.push(`${nowhere}. KNOWN FAILING, NOT YET DUE: firstDue is ${r.firstDue}, ${due.days} day(s) from now, so this prints and does not block; it BLOCKS from that date, whether or not anybody edits the row`);
      else findings.push(due.problem ? `${nowhere}; ${due.problem}` : nowhere);
      continue;
    }
    if (atRepo) {
      if (r.storedAt === 'environment') findings.push(`${r.name}: the register says it is stored in ${r.envs.join(' | ')}, and a REPOSITORY-level copy exists, readable by every job — delete it`);
      else if (today > MOVE_BY) findings.push(`${r.name}: still stored at REPOSITORY level after the move date ${MOVE_BY} (${r.from}); the owner's step: ${r.moveStep ?? 'none written'}`);
      else pending.push(`${r.name}: at repository level, scoped to ${r.envs.join(' | ')}; move pending until ${MOVE_BY} — ${r.moveStep ?? 'NO moveStep written'}`);
      continue;
    }
    if (r.storedAt !== 'environment' && inEnvs.length === r.envs.length) done.push(r);
  }
  const allStored = new Set([...stored.repository, ...[...stored.environments.values()].flatMap((s) => [...s])]);
  const unreferenced = [...allStored].filter((n) => !referenced.has(n)).sort();
  const unstored = [...referenced].filter((n) => !allStored.has(n)).sort();
  return { findings, pending, notYetDue, done, unreferenced, unstored };
}

/** Rewrite each done row's storedAt and drop its moveStep, textually, in the row's own block. PURE. */
export function flipText(text, names) {
  let out = text;
  const flipped = [];
  for (const name of names) {
    const at = out.indexOf(`"name": "${name}"`);
    if (at < 0) continue;
    // The row's own object: from the `{` that opens it to the `}` that closes it, by brace depth
    // outside strings, so no indentation is assumed.
    const start = out.lastIndexOf('{', at);
    let end = -1;
    for (let i = start, depth = 0, inStr = false; i < out.length; i++) {
      const c = out[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = i; break; }
    }
    if (start < 0 || end < 0) continue;
    const block = out.slice(start, end);
    const next = block.replace(/"storedAt": "repository"/, '"storedAt": "environment"').replace(/,\r?\n\s*"moveStep": "(?:[^"\\]|\\.)*"(?=\r?\n|$)/, '').replace(/\r?\n\s*"moveStep": "(?:[^"\\]|\\.)*",/, '');
    if (next !== block) {
      out = out.slice(0, start) + next + out.slice(end);
      flipped.push(name);
    }
  }
  return { text: out, flipped };
}

/** Pages read per listing at most: 100 names a page, so 5,000 names; past that the read refuses, never truncates. */
export const MAX_PAGES = 50;

/** The `rel="next"` URL of a Link header, or null. PURE. */
export function nextLink(link) {
  const m = /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? '');
  return m ? m[1] : null;
}

/** Every secret NAME per scope, every page of every listing.
 *  ⏱ 2026-10-02 · #1135 review finding 3: each listing read ONE page of 100, so a repository-level
 *  copy on page 2 read as clean and a name there as "stored nowhere". It now follows `Link:
 *  rel="next"` to the end, and refuses (throws: exit 2) when the pages do not add up to the
 *  listing's own `total_count`, or run past MAX_PAGES. */
export async function readNames({ repo, token, fetchImpl = fetch }) {
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  // The shared reading of "a blip or an outage" (bounded-retry.mjs): a dropped wire, a 429 or a 5xx is
  // asked again within its ceiling; any other non-OK status is an answer.
  const getAll = async (first, key) => {
    const items = [];
    let url = first;
    let total = null;
    for (let page = 1; url; page++) {
      if (page > MAX_PAGES) throw new Error(`${first.replace(api, '')} runs past ${MAX_PAGES} pages; refusing to grade a truncated listing`);
      const path = url.replace(api, '');
      const res = await fetchWithBoundedRetry(({ signal }) => fetchImpl(url, { headers, signal }), { describe: (s) => `GET ${path}: ${s}` });
      if (!res.ok) throw new Error(`GET ${path} answered HTTP ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body?.[key])) throw new Error(`GET ${path} carried no ${key} array`);
      items.push(...body[key]);
      if (Number.isInteger(body.total_count)) total = body.total_count;
      url = nextLink(res.headers.get('link'));
    }
    if (total !== null && items.length !== total) throw new Error(`${first.replace(api, '')} listed ${items.length} of total_count ${total}; refusing to grade a partial listing`);
    return items;
  };
  const repository = new Set((await getAll(`${api}/actions/secrets?per_page=100`, 'secrets')).map((s) => s.name));
  const environments = new Map();
  for (const e of await getAll(`${api}/environments?per_page=100`, 'environments')) {
    environments.set(e.name, new Set((await getAll(`${api}/environments/${encodeURIComponent(e.name)}/secrets?per_page=100`, 'secrets')).map((s) => s.name)));
  }
  return { repository, environments };
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? '';
}

async function main() {
  const argv = process.argv.slice(2);
  const root = resolve(flag(argv, '--root') ?? DEFAULT_ROOT);
  const today = flag(argv, '--today') ?? new Date().toISOString().slice(0, 10);
  const until = flag(argv, '--unreadable-until');
  const repo = flag(argv, '--repo') ?? process.env.GITHUB_REPOSITORY ?? PLATFORM_REPO_SLUG;
  const namesFile = flag(argv, '--names-file');
  for (const [k, v] of [['--today', today], ['--unreadable-until', until]]) {
    if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { console.error(`COVERAGE LOST — ${k} "${v}" is not YYYY-MM-DD`); process.exitCode = 2; return; }
  }
  const register = JSON.parse(readFileSync(join(root, REGISTER_REL), 'utf8'));
  const referenced = referencedNames(root);
  if (referenced === null) { console.error('COVERAGE LOST — could not read any workflow under .github/workflows, so no secret reference is known'); process.exitCode = 2; return; }
  const rows = scopedRows(register, referenced);
  if (!rows.length) { console.error('COVERAGE LOST — the register scopes no secret to an environment, so there is nothing to read back'); process.exitCode = 2; return; }

  let stored;
  if (namesFile) {
    console.log('!!  FIXTURE NAMES — --names-file is set. This must NEVER appear in a real log.');
    const doc = JSON.parse(readFileSync(namesFile, 'utf8'));
    stored = { repository: new Set(doc.repository ?? []), environments: new Map(Object.entries(doc.environments ?? {}).map(([k, v]) => [k, new Set(v)])) };
  } else {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
    if (!token) {
      const why = 'no GH_TOKEN in the environment (ops-watch maps SECRETS_READ_TOKEN, which the owner mints: a token with Secrets and Environments read)';
      if (until && today <= until) {
        console.log(`::warning title=Secret scopes NOT READ (unreadable until ${until})::${why}. Nothing about where GitHub stores a secret was read.`);
        console.log(`check-secret-scopes: UNREADABLE inside its declared ceiling (until ${until}): ${why}`);
        return;
      }
      console.error(`COVERAGE LOST — ${why}${until ? `; the ceiling ended ${until}` : ''}`);
      process.exitCode = 2;
      return;
    }
    try {
      stored = await readNames({ repo, token });
    } catch (e) {
      console.error(`COVERAGE LOST — the secret NAMES could not be read: ${e.message}`);
      process.exitCode = 2;
      return;
    }
  }

  const g = grade(rows, stored, referenced, today);
  console.log(`read: ${stored.repository.size} repository name(s); ${[...stored.environments].map(([e, s]) => `${e} ${s.size}`).join(', ') || 'no environment'}; ${rows.length} scoped row(s) graded`);
  for (const p of g.pending) console.log(`PENDING MOVE  ${p}`);
  for (const p of g.notYetDue) console.log(`NOT YET DUE   ${p}`);
  for (const r of g.done) console.log(`MOVE DONE     ${r.name}: absent at repository level, present in ${r.envs.join(' and ')} — flip its storedAt (--write-flips)`);
  if (g.unreferenced.length) console.log(`STORED, REFERENCED BY NO WORKFLOW (security-022; deleting is an owner step): ${g.unreferenced.join(', ')}`);
  if (g.unstored.length) console.log(`REFERENCED, STORED NOWHERE (an owner step not yet taken, or a dead reference): ${g.unstored.join(', ')}`);
  if (argv.includes('--write-flips') && g.done.length) {
    const path = join(root, REGISTER_REL);
    const { text, flipped } = flipText(readFileSync(path, 'utf8'), g.done.filter((r) => r.from === 'nonSigning').map((r) => r.name));
    JSON.parse(text);
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
    console.log(`--write-flips: ${flipped.length ? flipped.join(', ') : 'nothing'} rewritten to storedAt "environment" in ${REGISTER_REL}`);
  }
  for (const f of g.findings) console.error(`FAIL  ${f}`);
  if (g.findings.length) process.exitCode = 1;
  else console.log(`check-secret-scopes: clean — ${g.pending.length} move(s) pending until ${MOVE_BY}, ${g.done.length} done`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
