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
  // No value may end the HTML comment early (`-->`, or the `--!>` browsers also accept)
  // and leak the rest into the body: `<` and `>` are written as JSON escapes, which
  // JSON.parse reads back unchanged, so the header holds no `>` but its own closing one.
  const json = JSON.stringify(meta).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
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
 * (head branches of MERGED Public PRs), markersMet?: string[] (marker names that read
 * `land exit=0` — ONLY the laptop can read a marker, so only the laptop passes it) }.
 * → true (met), false (unmet) or null (UNKNOWN: a marker dep where `markersMet` was
 * not supplied, i.e. in the cloud). An unparsable regex is unmet, never met.
 */
export function depStatus(d, facts) {
  if (d.kind === 'issue') return new Set(facts.closedIssues ?? []).has(d.number);
  if (d.kind === 'pr') {
    let re;
    try { re = new RegExp(d.regex); } catch { return false; }
    return (facts.mergedBranches ?? []).some((b) => re.test(b));
  }
  if (d.kind === 'marker') return Array.isArray(facts.markersMet) ? facts.markersMet.includes(d.name) : null;
  return false;
}

/** Met for LAUNCHING: an unknown marker is unmet, so the cloud never launches past one. */
export const depMet = (d, facts) => depStatus(d, facts) === true;

export const depsMet = (deps, facts) => (deps ?? []).every((d) => depMet(d, facts));

/** → true (all met), false (one is known unmet) or null (none unmet, but one is unknown). */
function depsStatus(deps, facts) {
  const st = (deps ?? []).map((d) => depStatus(d, facts));
  if (st.includes(false)) return false;
  return st.includes(null) ? null : true;
}

/**
 * The prompt queue-migrate.mjs's first pass writes into a stub before the second pass
 * writes the real body. A stub is never launched and never flipped to `ready`.
 */
export const MIGRATION_STUB_PROMPT = '(migration in progress: this body is rewritten in the second pass)';
export const MIGRATION_STUB_MARKER = 'migration-in-progress';

/** Throws when a parsed lane must not be launched: a migration stub or an empty prompt. */
export function assertLaunchable(i) {
  if (i.prompt === MIGRATION_STUB_PROMPT || (i.deps ?? []).some((d) => d.kind === 'marker' && d.name === MIGRATION_STUB_MARKER)) {
    throw new Error(`#${i.number}: a migration stub, not a lane: its body is rewritten by queue-migrate's second pass`);
  }
  if (typeof i.prompt !== 'string' || i.prompt.trim() === '') throw new Error(`#${i.number}: the prompt is empty`);
  return i;
}
const isLaunchablePrompt = (i) => { try { assertLaunchable(i); return true; } catch { return false; } };

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

// The exact machine syntax of each verb, and nothing looser: the owner is also the human,
// so "PROGRESS looks slow" or "RELEASE notes …" in a free-text comment must not count.
const ID = '[A-Za-z0-9._:-]+';
const VERB_RES = {
  CLAIM: new RegExp(`^CLAIM runner=(?<runner>${ID}) at=(?<at>\\S+) nonce=(?<nonce>[0-9a-f]{8})$`),
  YIELD: new RegExp(`^YIELD runner=(?<runner>${ID})$`),
  RELEASE: new RegExp(`^RELEASE runner=(?<runner>${ID})$`),
  RECLAIM: new RegExp(`^RECLAIM previous=(?<previous>${ID}) runner=(?<runner>${ID}) at=(?<at>\\S+)$`),
  PROGRESS: /^PROGRESS(?<rest>(?: [A-Za-z_]\w*=\S+)+)$/,
};

/** One comment → `{verb, runner, fields, id, createdAt}` when its first line is a protocol line, else null. */
export function parseEvent(c) {
  const first = lf(c.body).split('\n')[0].trim();
  const verb = /^[A-Z]+/.exec(first)?.[0];
  const m = verb && Object.hasOwn(VERB_RES, verb) ? VERB_RES[verb].exec(first) : null;
  if (!m) return null;
  const fields = verb === 'PROGRESS' ? Object.fromEntries([...m.groups.rest.matchAll(/ (\w+)=(\S+)/g)].map((x) => [x[1], x[2]])) : { ...m.groups };
  if (verb === 'PROGRESS' && !fields.routine) return null;
  return { verb, runner: fields.runner ?? null, fields, id: Number(c.id), createdAt: c.created_at ?? c.createdAt ?? null };
}

/** The owner's protocol events, in comment-id order (ids are GitHub's total order). */
function ownerEvents(comments, owner) {
  if (!owner) throw new Error('the claim protocol needs the repository owner login: only its comments count');
  if (!Array.isArray(comments)) throw new Error('the claim protocol needs the issue\'s comments array: none was attached');
  return comments.filter((c) => isOwner(c, owner)).map(parseEvent).filter(Boolean).sort((a, b) => a.id - b.id);
}

const msOf = (t) => (t === null || t === undefined ? NaN : Date.parse(t));

/**
 * THE one reading of an issue's protocol comments; every reader (claimWinner,
 * claimFresh, nextReady, claim) goes through it, so they cannot disagree.
 *
 * Walk the owner's events in id order, keeping the current window and its holder
 * (the window's FIRST claim — lowest id wins; wall time never decides a race):
 *   · CLAIM  joins the window; it holds it only if the window had no holder.
 *   · RECLAIM is honoured (opens a new window, which it holds) only when it is valid:
 *     the window has a holder, `previous=` names that holder, the holder is provably
 *     stale by the comments' own clock — its window's newest CLAIM / RECLAIM /
 *     PROGRESS is at least CLAIM_STALE_H older than the RECLAIM's `created_at` — and
 *     the holder has no launch record (`PROGRESS` after its claim: a launched lane may
 *     still be running, so it is never reclaimed; the lead RELEASEs it instead).
 *     An invalid RECLAIM is a plain CLAIM in the current window, where it loses on id;
 *     so two concurrent reclaims of one holder resolve lowest-id-wins, like claims.
 *   · RELEASE by the holder's runner id empties the window; anyone else's is ignored.
 *   · PROGRESS is activity (and, after the holder, its launch record); YIELD is neither.
 *   · A CLAIM (or an invalid RECLAIM) is activity only when its runner is the holder's:
 *     another claimant's losing line says nothing about whether the holder is alive.
 * The lane PR's `updated_at` is only known as it is NOW, so it counts toward `fresh`
 * (read at `now`) but never toward a RECLAIM's validity, which every reader must judge
 * the same way forever.
 *
 * → `{holder, fresh, launched, reclaimable}`; holder = `{runner, commentId, verb, createdAt}` or null.
 */
export function claimState(comments, { owner, prUpdatedAt = null, now = Date.now(), staleH = T.CLAIM_STALE_H } = {}) {
  const staleMs = staleH * 3600_000;
  let w = { holder: null, activity: [], launched: false };
  for (const e of ownerEvents(comments, owner)) {
    if (e.verb === 'RELEASE') {
      if (w.holder && e.runner === w.holder.runner) w = { holder: null, activity: [], launched: false };
      continue;
    }
    if (e.verb === 'YIELD') continue;
    if (e.verb === 'RECLAIM' && w.holder && !w.launched && e.fields.previous === w.holder.runner) {
      const newest = Math.max(...w.activity.map(msOf));
      const at = msOf(e.createdAt);
      if (w.activity.every((t) => Number.isFinite(msOf(t))) && Number.isFinite(at) && at - newest >= staleMs) {
        w = { holder: e, activity: [e.createdAt], launched: false };
        continue;
      }
    }
    if (e.verb === 'PROGRESS') {
      if (w.holder) w.launched = true;
      w.activity.push(e.createdAt);
      continue;
    }
    // CLAIM, or a RECLAIM that was not valid: a plain claim inside the current window.
    // Only the HOLDER's own claims are activity (review of #1163, minor 1): a losing
    // CLAIM or an invalid RECLAIM — posted by a claimant whose local clock judged the
    // holder stale early — must not keep a dead, never-launched holder fresh.
    if (!w.holder) w.holder = e;
    if (e.runner === w.holder.runner) w.activity.push(e.createdAt);
  }
  if (!w.holder) return { holder: null, fresh: false, launched: false, reclaimable: false };
  const times = w.activity.map(msOf).filter(Number.isFinite);
  if (prUpdatedAt) times.push(msOf(prUpdatedAt));
  const newest = Math.max(...times.filter(Number.isFinite));
  const fresh = Number.isFinite(newest) && toMs(now) - newest < staleMs;
  const h = w.holder;
  return {
    holder: { runner: h.runner, commentId: h.id, verb: h.verb, createdAt: h.createdAt },
    fresh,
    launched: w.launched,
    reclaimable: !fresh && !w.launched,
  };
}

/** Who holds the issue (see claimState) → `{runner, commentId, verb, createdAt}` or null. */
export const claimWinner = (comments, { owner } = {}) => claimState(comments, { owner }).holder;

/**
 * Is the current claim alive: the newest of its window's CLAIM / RECLAIM /
 * PROGRESS comments, or the lane PR's `updated_at`, is under CLAIM_STALE_H old.
 * False when there is no claim at all.
 */
export const claimFresh = (comments, prUpdatedAt, now, { owner, staleH = T.CLAIM_STALE_H } = {}) =>
  claimState(comments, { owner, prUpdatedAt, now, staleH }).fresh;

/** May a runner take this lane now: unclaimed, or held by a reclaimable (stale, never launched) claim. */
export const launchable = (st) => !st.holder || st.reclaimable;

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

/** The newest `updated_at` among the open PRs the lane's lander matches, or null. */
export const lanePrUpdatedAt = (lander, openPRs) =>
  prsForLander(lander, openPRs).map((p) => p.updated_at).filter(Boolean).sort().pop() ?? null;

/**
 * issues = parsed issues, each with `.comments` (REST shape; an issue without a
 * comments ARRAY throws — never read as unclaimed) — and facts as depsMet takes them,
 * plus `owner`, `now`, and `openPRs` (Public PRs, for the claim's freshness).
 * → the launchable lanes, best first: open, labelled `cloud-lane` and `ready`, not
 * `done`/`failed`, not a migration stub, deps met, and launchable by claimState (the
 * same predicate claim() uses); ordered by priority (lower first), then issue number.
 * Each is returned with `prUpdatedAt`, to hand to claim().
 */
export function nextReady(issues, facts) {
  const { owner, now = Date.now(), openPRs = [] } = facts;
  for (const i of issues) {
    if (!Array.isArray(i.comments)) throw new Error(`#${i.number}: no comments array attached; nextReady cannot tell whether it is claimed`);
  }
  return issues
    .filter((i) => i.state === 'open')
    .filter((i) => i.labels.includes('cloud-lane') && i.labels.includes('ready'))
    .filter((i) => !i.labels.includes('done') && !i.labels.includes('failed'))
    .filter(isLaunchablePrompt)
    .filter((i) => depsMet(i.deps, facts))
    .map((i) => ({ ...i, prUpdatedAt: lanePrUpdatedAt(i.lander, openPRs) }))
    .filter((i) => launchable(claimState(i.comments, { owner, prUpdatedAt: i.prUpdatedAt, now })))
    .sort((a, b) => prioOf(a) - prioOf(b) || a.number - b.number);
}

/**
 * The tidy-up any housekeeper (laptop or runner) applies, at most `max` ops:
 *   · a lane whose lander matches a MERGED PR → label `done`, close as completed;
 *   · a lane with an OPEN PR → label `pr-open`;
 *   · `blocked` with deps met → `ready`; `ready` with a dep KNOWN unmet → `blocked`.
 *     A marker dep is unknown unless `facts.markersMet` is given (the laptop only),
 *     and an unknown dep flips nothing either way: a housekeeper never undoes a state
 *     the laptop set from markers it alone can read. A migration stub never → `ready`.
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
    const met = depsStatus(i.deps, effective);
    if (met === true && i.labels.includes('blocked') && isLaunchablePrompt(i)) {
      rest.push({ op: 'removeLabel', number: i.number, label: 'blocked' }, { op: 'addLabel', number: i.number, label: 'ready' });
    } else if (met === false && i.labels.includes('ready')) {
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
    getIssue: (n) => call('GET', `${R}/issues/${n}`),
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
 * The whole claim, end to end. Read the comments first, through claimState (the
 * predicate nextReady uses): a lane held by a live or launched claim is refused
 * without a write; a stale, never-launched holder is taken with a RECLAIM naming it;
 * an unclaimed lane with a CLAIM. Then label, post, wait CLAIM_SETTLE_S, re-read,
 * and win ONLY if the holder is the very comment this call posted (its comment id,
 * not its runner id: two dispatchers sharing the id `laptop` cannot both win). A
 * loser YIELDs, and drops the `claimed:` label unless the winner shares its id.
 * → `{won, winner, posted}`. `prUpdatedAt` is the lane PR's (nextReady returns it);
 * `sleep` and `now` are injectable so the race is testable. Throws, having written
 * nothing, when the issue is not launchable (assertLaunchable).
 */
export async function claim(client, number, runner, { prUpdatedAt = null, now = () => new Date(), sleep = sleepMs, settleS = T.CLAIM_SETTLE_S } = {}) {
  const owner = client.owner;
  const comments = await client.listComments(number);
  // A migration stub or an empty prompt is never launched: refused here, before any
  // write, on a parse of the issue itself (review of #1163, nit 3) — nextReady only
  // FILTERS stubs out, and a caller that skips it must still be stopped.
  assertLaunchable(parseIssue(await client.getIssue(number), comments, { owner }));
  const before = claimState(comments, { owner, prUpdatedAt, now: now() });
  if (!launchable(before)) return { won: false, winner: before.holder, posted: false };
  const at = now().toISOString();
  const previous = before.holder?.runner ?? null;
  await client.addLabels(number, [`claimed:${runner}`]);
  const mine = await client.comment(number, previous ? reclaimLine(previous, runner, at) : claimLine(runner, at));
  if (!Number.isFinite(Number(mine?.id))) throw new Error(`#${number}: the claim comment came back without an id, so the win cannot be decided`);
  await sleep(settleS * 1000);
  const winner = claimWinner(await client.listComments(number), { owner });
  if (winner?.commentId === Number(mine.id)) {
    if (previous && previous !== runner) await client.removeLabel(number, `claimed:${previous}`);
    return { won: true, winner, posted: true };
  }
  await client.comment(number, yieldLine(runner));
  if (winner?.runner !== runner) await client.removeLabel(number, `claimed:${runner}`);
  return { won: false, winner, posted: true };
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
