// ─────────────────────────────────────────────────────────────────────────────
// issue-queue.mjs — the autopilot lane queue as GitHub Issues in the PRIVATE repo,
// and the race-safe claim every launcher goes through.
//
// WHY. The queue was one JSON file on the owner's laptop, so when the laptop was
// off nothing could launch the next lane. Now every cloud lane is ONE issue whose
// body is its whole self-contained prompt, and the laptop dispatcher (primary) and
// the cloud runner routines (failover) both CLAIM through the protocol below. The
// issue is the single source of truth, so a lane launches once.
//
// The names and thresholds are tooling/autopilot/contract.json, imported here and
// never redefined; docs/autopilot/queue.md is the prose of the same contract.
//
// SHAPE. Everything that decides is a pure function (parse, render, split, deps,
// claim winner, freshness, the next ready lane, the housekeeping plan), tested in
// tooling/ci/test/autopilot-issue-queue.test.mjs. The REST layer at the bottom is
// thin: `fetch` only (no shell, no spawn — this runs on the Windows laptop), a
// token read from the environment and never printed, logged or put in an error.
//
// 🔴 PRIVATE CONTENT. A lane prompt is Private content. This module writes only to
// the repo it is given; queue-migrate.mjs refuses a target that is not private.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'contract.json'), 'utf8'),
);
const T = CONTRACT.thresholds;

const HEADER_RE = new RegExp(`^<!-- ${CONTRACT.headerTag.replace(/ /g, '\\s+')} (\\{.*\\}) -->$`);
const PART_RE = new RegExp(`^<!-- ${CONTRACT.partTag} (\\d+)/(\\d+) -->\\n`);

const labelName = (l) => (typeof l === 'string' ? l : l?.name ?? '');
const lf = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

// ── the issue: title, header, deps, prompt ──────────────────────────────────

/** The one dependency-line grammar, both ways. */
export function renderDep(d) {
  if (d.kind === 'issue') return `Depends on #${d.number}`;
  if (d.kind === 'pr') return `Depends on PR: ${d.regex}`;
  if (d.kind === 'marker') return `Depends on marker: ${d.name} (laptop)`;
  throw new Error(`unknown dependency kind ${JSON.stringify(d.kind)}`);
}

export function parseDep(line) {
  let m;
  if ((m = /^Depends on #(\d+)$/.exec(line))) return { kind: 'issue', number: Number(m[1]) };
  if ((m = /^Depends on PR: (.+)$/.exec(line))) return { kind: 'pr', regex: m[1] };
  if ((m = /^Depends on marker: (.+) \(laptop\)$/.exec(line))) return { kind: 'marker', name: m[1] };
  return null;
}

/**
 * `{lane, priority, lander, effort, model, ceil, acctPref, transport, deps, prompt}`
 * → `{title, body}`. The body is the WHOLE text, header to prompt end; splitPrompt
 * cuts it to the issue's body plus continuation comments.
 */
export function renderIssue(lane) {
  const meta = {};
  for (const k of CONTRACT.headerKeys) meta[k] = lane[k] ?? null;
  if (typeof meta.lane !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(meta.lane)) {
    throw new Error(`lane name ${JSON.stringify(meta.lane)} is not [A-Za-z0-9._-]`);
  }
  const json = JSON.stringify(meta);
  // `-->` inside the JSON would end the HTML comment early and leak the rest into the body.
  if (json.includes('-->')) throw new Error(`lane ${meta.lane}: a header value contains "-->"`);
  const deps = (lane.deps ?? []).map(renderDep);
  const prompt = lf(lane.prompt);
  return {
    title: `${CONTRACT.titlePrefix}${meta.lane}`,
    body: [`<!-- ${CONTRACT.headerTag} ${json} -->`, ...deps, '---', prompt].join('\n'),
  };
}

/**
 * A GitHub issue (REST shape, or `{title, body, labels}`) → the lane it carries.
 * `comments`, when given, are searched for `prompt-part` continuations (only the
 * owner's, when `owner` is given). Throws
 * on anything that is not a well-formed v1 lane issue, naming why.
 */
export function parseIssue(issue, comments = [], { owner } = {}) {
  const title = String(issue.title ?? '');
  if (!title.startsWith(CONTRACT.titlePrefix)) throw new Error(`#${issue.number}: title is not "${CONTRACT.titlePrefix}<lane>"`);
  const body = joinPrompt(lf(issue.body), comments, { owner });
  const lines = body.split('\n');
  const hm = HEADER_RE.exec(lines[0] ?? '');
  if (!hm) throw new Error(`#${issue.number}: first line is not the ${CONTRACT.headerTag} header`);
  let meta;
  try { meta = JSON.parse(hm[1]); } catch { throw new Error(`#${issue.number}: header JSON does not parse`); }
  const lane = title.slice(CONTRACT.titlePrefix.length);
  if (meta.lane !== lane) throw new Error(`#${issue.number}: header lane ${JSON.stringify(meta.lane)} is not the title's ${JSON.stringify(lane)}`);
  const deps = [];
  let i = 1;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    if (lines[i].trim() === '') continue;
    const d = parseDep(lines[i]);
    if (!d) throw new Error(`#${issue.number}: line ${i + 1} is neither a dependency line nor "---"`);
    deps.push(d);
  }
  if (i >= lines.length) throw new Error(`#${issue.number}: no "---" line before the prompt`);
  const out = { lane, deps, prompt: lines.slice(i + 1).join('\n') };
  for (const k of CONTRACT.headerKeys) if (k !== 'lane') out[k] = meta[k] ?? null;
  return {
    ...out,
    number: issue.number,
    state: issue.state ?? 'open',
    stateReason: issue.state_reason ?? null,
    labels: (issue.labels ?? []).map(labelName),
    updatedAt: issue.updated_at ?? null,
  };
}

// ── the body limit ──────────────────────────────────────────────────────────

const partHeader = (k, n) => `<!-- ${CONTRACT.partTag} ${k}/${n} -->\n`;

/**
 * Cut a whole body into the issue body (part 1) and continuation comments
 * (parts 2..n, each starting `<!-- prompt-part k/n -->`). Every part, marker
 * included, is at most `limit` characters; a surrogate pair is never split.
 */
export function splitPrompt(text, limit = CONTRACT.bodyLimit) {
  text = lf(text);
  if (text.length <= limit) return [text];
  // The marker's length depends on n's digit count; size for the widest n can reach.
  const room = limit - partHeader(99999, 99999).length;
  if (room < 1) throw new Error(`limit ${limit} leaves no room after the part marker`);
  const chunks = [];
  let at = 0;
  let first = true;
  while (at < text.length) {
    let end = Math.min(text.length, at + (first ? limit : room));
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    chunks.push(text.slice(at, end));
    at = end;
    first = false;
  }
  const n = chunks.length;
  return chunks.map((c, i) => (i === 0 ? c : partHeader(i + 1, n) + c));
}

/**
 * The inverse: issue body + its comments → the whole body. Continuations count
 * only from the owner when `owner` is given. Throws when a part is missing,
 * repeated or disagrees on n, rather than handing back a truncated prompt.
 */
export function joinPrompt(body, comments = [], { owner } = {}) {
  const parts = new Map();
  let n = null;
  for (const c of comments) {
    if (owner && !isOwner(c, owner)) continue;
    const text = lf(c.body);
    const m = PART_RE.exec(text);
    if (!m) continue;
    const k = Number(m[1]);
    const cn = Number(m[2]);
    if (n !== null && cn !== n) throw new Error(`prompt parts disagree on n (${n} vs ${cn})`);
    n = cn;
    if (k < 2 || k > cn) throw new Error(`prompt part ${k}/${cn} is out of range`);
    if (parts.has(k)) throw new Error(`prompt part ${k}/${cn} appears twice`);
    parts.set(k, text.slice(m[0].length));
  }
  if (n === null) return lf(body);
  const out = [lf(body)];
  for (let k = 2; k <= n; k++) {
    if (!parts.has(k)) throw new Error(`prompt part ${k}/${n} is missing`);
    out.push(parts.get(k));
  }
  return out.join('');
}

// ── dependencies ────────────────────────────────────────────────────────────

/**
 * facts = { closedIssues: number[] (closed AS COMPLETED), mergedBranches: string[]
 * (head branches of MERGED Public PRs) }. A marker dep is never met here: only
 * the laptop can read a marker. An unparsable regex is unmet, never met.
 */
export function depMet(d, facts) {
  if (d.kind === 'issue') return new Set(facts.closedIssues ?? []).has(d.number);
  if (d.kind === 'pr') {
    let re;
    try { re = new RegExp(d.regex); } catch { return false; }
    return (facts.mergedBranches ?? []).some((b) => re.test(b));
  }
  return false;
}

export const depsMet = (deps, facts) => (deps ?? []).every((d) => depMet(d, facts));

/** Issues (REST shape) + merged PRs → the facts depsMet reads. */
export function factsFrom({ issues = [], mergedPRs = [] }) {
  return {
    closedIssues: issues.filter((i) => i.state === 'closed' && (i.state_reason ?? i.stateReason) === 'completed').map((i) => i.number),
    mergedBranches: mergedPRs.map(prBranch).filter(Boolean),
  };
}

const prBranch = (pr) => (typeof pr === 'string' ? pr : pr?.head?.ref ?? pr?.headRefName ?? pr?.branch ?? null);

/** The lander regex against PRs → those whose head branch it matches. */
export function prsForLander(lander, prs) {
  if (!lander) return [];
  let re;
  try { re = new RegExp(lander); } catch { return []; }
  return (prs ?? []).filter((p) => { const b = prBranch(p); return b !== null && re.test(b); });
}

// ── the claim protocol ──────────────────────────────────────────────────────

/** True when a comment's author is the repository owner (the only author that counts). */
export function isOwner(c, owner) {
  const login = c?.user?.login ?? c?.author?.login ?? c?.author ?? '';
  return typeof login === 'string' && login.toLowerCase() === String(owner).toLowerCase();
}

const kv = (s) => Object.fromEntries([...s.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));

/** One comment → `{verb, runner, ...}` when its first line is a protocol line, else null. */
export function parseEvent(c) {
  const first = lf(c.body).split('\n')[0].trim();
  const m = /^(CLAIM|YIELD|RELEASE|RECLAIM|PROGRESS)\b(.*)$/.exec(first);
  if (!m) return null;
  const f = kv(m[2]);
  return { verb: m[1], runner: f.runner ?? null, fields: f, id: Number(c.id), createdAt: c.created_at ?? c.createdAt ?? null };
}

/** The owner's protocol events, in comment-id order (ids are GitHub's total order). */
function ownerEvents(comments, owner) {
  if (!owner) throw new Error('the claim protocol needs the repository owner login: only its comments count');
  return comments.filter((c) => isOwner(c, owner)).map(parseEvent).filter(Boolean).sort((a, b) => a.id - b.id);
}

/** The events after (and including) the newest RELEASE or RECLAIM. */
function currentWindow(events) {
  let start = 0;
  events.forEach((e, i) => { if (e.verb === 'RELEASE' || e.verb === 'RECLAIM') start = i; });
  const w = events.slice(start);
  return w.length && w[0].verb === 'RELEASE' ? w.slice(1) : w;
}

/**
 * Who holds the issue: among the CLAIMs after the newest RELEASE or RECLAIM, the
 * LOWEST comment id. A RECLAIM opens its window holding it, so it is that window's
 * lowest id and wins it. Wall time never decides: two runners that post seconds
 * apart agree after the settle because both read the same ids.
 * → `{runner, commentId, verb, createdAt}` or null when unclaimed.
 */
export function claimWinner(comments, { owner } = {}) {
  const w = currentWindow(ownerEvents(comments, owner));
  const c = w.find((e) => e.verb === 'CLAIM' || e.verb === 'RECLAIM');
  return c ? { runner: c.runner, commentId: c.id, verb: c.verb, createdAt: c.createdAt } : null;
}

/**
 * Is the current claim alive: the newest of its window's CLAIM / RECLAIM /
 * PROGRESS comments, or the lane PR's `updated_at`, is under CLAIM_STALE_H old.
 * False when there is no claim at all.
 */
export function claimFresh(comments, prUpdatedAt, now, { owner, staleH = T.CLAIM_STALE_H } = {}) {
  const w = currentWindow(ownerEvents(comments, owner));
  if (!w.some((e) => e.verb === 'CLAIM' || e.verb === 'RECLAIM')) return false;
  const times = w.filter((e) => e.verb !== 'YIELD').map((e) => Date.parse(e.createdAt)).filter(Number.isFinite);
  if (prUpdatedAt) times.push(Date.parse(prUpdatedAt));
  const newest = Math.max(...times.filter(Number.isFinite));
  if (!Number.isFinite(newest)) return false;
  return toMs(now) - newest < staleH * 3600_000;
}

const toMs = (now) => (now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now));

export const nonce8 = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
export const claimLine = (runner, at, nonce = nonce8()) => `CLAIM runner=${runner} at=${at} nonce=${nonce}`;
export const reclaimLine = (previous, runner, at) => `RECLAIM previous=${previous} runner=${runner} at=${at}`;
export const yieldLine = (runner) => `YIELD runner=${runner}`;
export const releaseLine = (runner) => `RELEASE runner=${runner}`;
export const progressLine = (fields) => `PROGRESS ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')}`;

// ── what to launch next, and what to tidy ───────────────────────────────────

const prioOf = (i) => {
  const p = Number(i.priority ?? (i.labels ?? []).find((l) => l.startsWith('prio:'))?.slice(5));
  return Number.isFinite(p) ? p : Infinity;
};

/**
 * issues = parsed issues, each with `.comments` (REST shape) — and facts as
 * depsMet takes them, plus `owner`, `now`, and `openPRs` (Public PRs, for the
 * claim's freshness). → the launchable lanes, best first: open, labelled
 * `cloud-lane` and `ready`, not `done`/`failed`, deps met, and unclaimed or
 * stale-claimed; ordered by priority (lower first), then issue number.
 */
export function nextReady(issues, facts) {
  const { owner, now = Date.now(), openPRs = [] } = facts;
  return issues
    .filter((i) => i.state === 'open')
    .filter((i) => i.labels.includes('cloud-lane') && i.labels.includes('ready'))
    .filter((i) => !i.labels.includes('done') && !i.labels.includes('failed'))
    .filter((i) => depsMet(i.deps, facts))
    .filter((i) => {
      const pr = prsForLander(i.lander, openPRs).map((p) => p.updated_at).filter(Boolean).sort().pop() ?? null;
      return !claimFresh(i.comments ?? [], pr, now, { owner });
    })
    .sort((a, b) => prioOf(a) - prioOf(b) || a.number - b.number);
}

/**
 * The tidy-up any housekeeper (laptop or runner) applies, at most `max` ops:
 *   · a lane whose lander matches a MERGED PR → label `done`, close as completed;
 *   · a lane with an OPEN PR → label `pr-open`;
 *   · `blocked` with deps met → `ready`; `ready` with deps unmet → `blocked`.
 * Ops: {op:'addLabel'|'removeLabel', number, label} | {op:'close', number, reason}.
 * Closes go first (they unblock other lanes), then by issue number.
 */
export function housekeepingPlan(issues, mergedPRs, facts = {}, { max = T.HOUSEKEEPING_MAX_OPS } = {}) {
  const merged = [...(facts.mergedBranches ?? []), ...(mergedPRs ?? []).map(prBranch).filter(Boolean)];
  const effective = { ...facts, mergedBranches: merged };
  const open = issues.filter((i) => i.state === 'open' && i.labels.includes('cloud-lane')).sort((a, b) => a.number - b.number);
  const closes = [];
  const rest = [];
  for (const i of open) {
    if (prsForLander(i.lander, merged).length) {
      if (!i.labels.includes('done')) closes.push({ op: 'addLabel', number: i.number, label: 'done' });
      closes.push({ op: 'close', number: i.number, reason: 'completed' });
      continue;
    }
    if (prsForLander(i.lander, facts.openPRs ?? []).length && !i.labels.includes('pr-open')) {
      rest.push({ op: 'addLabel', number: i.number, label: 'pr-open' });
    }
    const met = depsMet(i.deps, effective);
    if (met && i.labels.includes('blocked')) {
      rest.push({ op: 'removeLabel', number: i.number, label: 'blocked' }, { op: 'addLabel', number: i.number, label: 'ready' });
    } else if (!met && i.labels.includes('ready')) {
      rest.push({ op: 'removeLabel', number: i.number, label: 'ready' }, { op: 'addLabel', number: i.number, label: 'blocked' });
    }
  }
  return [...closes, ...rest].slice(0, max);
}

// ── the thin REST layer ─────────────────────────────────────────────────────

/** The token, from the environment only. Callers never see it in a message. */
export const tokenFromEnv = (env = process.env) => env.AUTOPILOT_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || null;

/**
 * A GitHub REST client for one repo. `fetchImpl` is injectable for tests. Errors
 * carry the method, path and status — never a header, so never the token.
 */
export function createClient({ repo, token = tokenFromEnv(), fetchImpl = globalThis.fetch, api = 'https://api.github.com' }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error(`--repo must be owner/name, got ${JSON.stringify(repo)}`);
  const call = async (method, path, body) => {
    const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'nikatru-autopilot' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetchImpl(`${api}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 204) return null;
    const text = await r.text();
    if (!r.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} → HTTP ${r.status}`);
    return text ? JSON.parse(text) : null;
  };
  const all = async (path) => {
    const out = [];
    for (let page = 1; ; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = await call('GET', `${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) return out;
    }
  };
  const R = `/repos/${repo}`;
  return {
    repo,
    owner: repo.split('/')[0],
    getRepo: () => call('GET', R),
    listIssues: (state = 'all', labels = 'cloud-lane') =>
      all(`${R}/issues?state=${state}${labels ? `&labels=${encodeURIComponent(labels)}` : ''}`).then((xs) => xs.filter((i) => !i.pull_request)),
    listComments: (n) => all(`${R}/issues/${n}/comments`),
    createIssue: (title, body, labels) => call('POST', `${R}/issues`, { title, body, labels }),
    updateIssue: (n, patch) => call('PATCH', `${R}/issues/${n}`, patch),
    closeIssue: (n, reason = 'completed') => call('PATCH', `${R}/issues/${n}`, { state: 'closed', state_reason: reason }),
    addLabels: (n, labels) => call('POST', `${R}/issues/${n}/labels`, { labels }),
    removeLabel: (n, label) => call('DELETE', `${R}/issues/${n}/labels/${encodeURIComponent(label)}`).catch((e) => {
      if (/HTTP 404/.test(e.message)) return null; // already gone is the goal
      throw e;
    }),
    comment: (n, body) => call('POST', `${R}/issues/${n}/comments`, { body }),
    updateComment: (id, body) => call('PATCH', `${R}/issues/comments/${id}`, { body }),
    deleteComment: (id) => call('DELETE', `${R}/issues/comments/${id}`),
    listLabels: () => all(`${R}/labels`),
    createLabel: (name, color = 'ededed') => call('POST', `${R}/labels`, { name, color }),
    listPulls: (state = 'all') => all(`${R}/pulls?state=${state}`),
  };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The whole claim, end to end: label + CLAIM (or RECLAIM over a stale holder),
 * wait CLAIM_SETTLE_S, re-read, and either win or YIELD and drop the label.
 * → `{won, winner}`. `sleep` and `now` are injectable so the race is testable.
 */
export async function claim(client, number, runner, { reclaimFrom = null, now = () => new Date(), sleep = sleepMs, settleS = T.CLAIM_SETTLE_S } = {}) {
  const at = now().toISOString();
  await client.addLabels(number, [`claimed:${runner}`]);
  await client.comment(number, reclaimFrom ? reclaimLine(reclaimFrom, runner, at) : claimLine(runner, at));
  await sleep(settleS * 1000);
  const winner = claimWinner(await client.listComments(number), { owner: client.owner });
  if (winner?.runner === runner) {
    if (reclaimFrom && reclaimFrom !== runner) await client.removeLabel(number, `claimed:${reclaimFrom}`);
    return { won: true, winner };
  }
  await client.comment(number, yieldLine(runner));
  await client.removeLabel(number, `claimed:${runner}`);
  return { won: false, winner };
}

/** Apply a housekeepingPlan through a client. → the ops applied. */
export async function applyHousekeeping(client, ops) {
  for (const o of ops) {
    if (o.op === 'addLabel') await client.addLabels(o.number, [o.label]);
    else if (o.op === 'removeLabel') await client.removeLabel(o.number, o.label);
    else if (o.op === 'close') await client.closeIssue(o.number, o.reason);
    else throw new Error(`unknown housekeeping op ${o.op}`);
  }
  return ops;
}
