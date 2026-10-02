// ─────────────────────────────────────────────────────────────────────────────
// queue-migrate.mjs — the laptop's lane queue → one Issue per cloud lane in the
// PRIVATE repo, in the shape tooling/autopilot/contract.json fixes.
//
// RUNS ON THE LAPTOP (Windows) as a lead step. DRY by default: it prints the plan
// and writes nothing. `--apply` writes. No path is hard-coded; every input is a flag:
//
//   node tooling/autopilot/queue-migrate.mjs --queue <queue.json> --prompts-dir <dir>
//     --routines-dir <dir> --markers-dir <dir> --repo <owner/Private-repo>
//     [--state <state.json>] [--aliases <aliases.json>] [--vault <KEY=VALUE file>]
//     [--map-out <map.json>] [--public-repo <owner/name>] [--only <lane>] [--apply]
//
// WHICH ITEMS. `cloud: true` items with no `<routines-dir>/<lane>.routine` (not yet
// launched) and no merged Public PR matching their `lander` regex. The body is
// `<prompts-dir>/<lane>.prompt.md`, verbatim; an item without one is REFUSED and
// listed — prompts are built by the laptop's prompt builder, never here.
//
// MERGED PRs come from `--state` (JSON `{"mergedBranches": [...]}`, optional
// `"launched": [lane...]`) or, without it, from the Public repo's closed PRs read
// with the environment's token. Neither → exit 2: a plan that cannot tell what
// merged would re-queue finished lanes.
//
// DEPENDENCY TRANSLATION. A dep path `.../lwld-<lane>.out` → its basename (Windows or
// POSIX separators) → the lane, through `--aliases` ({lane: lane}). Then, in order:
//   lwld-cloudroutine-gate-*              → dropped
//   its marker's last line `land exit=0`, or its lander already merged → dropped
//   a lane migrated in this run, or already an issue → `Depends on #N`
//   a lane with a `lander` regex in the queue        → `Depends on PR: <regex>`
//   anything else                                    → `Depends on marker: <name> (laptop)`
// `ready` when every dep is met, else `blocked`.
//
// WRITES (--apply). Labels created idempotently; issues in TWO passes (create a
// `blocked` stub, then edit to the final body once every `#N` is known); idempotent
// by title, so a rerun updates and never duplicates; `--map-out` gets lane → issue.
//
// 🔴 THE SECRET GUARD. A body is refused when it holds any VALUE of `--vault` (compared
// in memory; only the NAME is ever reported), a token-shaped string, or an un-rewritten
// Windows user-profile path. 🔴 THE TARGET GUARD: --apply refuses a repo the API does
// not report as private. Lane prompts are Private content.
//
// Exit 0 = planned / applied. 1 = a finding: at least one item refused (the rest are
// still planned/applied). 2 = COVERAGE LOST: bad flags, an unreadable input, no merged-PR
// facts, or a queue with no cloud items. Windows-safe: fetch only, no shell, no spawn.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT, createClient, depMet, isOwner, renderIssue, splitPrompt, tokenFromEnv,
} from './issue-queue.mjs';

const VALUE_FLAGS = ['queue', 'prompts-dir', 'state', 'routines-dir', 'aliases', 'markers-dir', 'repo', 'vault', 'map-out', 'only', 'public-repo'];
const MIN_VAULT_VALUE = 8;
const STUB_PROMPT = '(migration in progress: this body is rewritten in the second pass)';

class CoverageLost extends Error {}

export function parseArgs(argv) {
  const o = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') { o.apply = true; continue; }
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (!name || !VALUE_FLAGS.includes(name)) throw new CoverageLost(`unknown argument ${JSON.stringify(a)}`);
    if (i + 1 >= argv.length) throw new CoverageLost(`--${name} needs a value`);
    o[name] = argv[++i];
  }
  for (const f of ['queue', 'prompts-dir', 'routines-dir', 'markers-dir', 'repo']) {
    if (!o[f]) throw new CoverageLost(`--${f} is required`);
  }
  return o;
}

// ── inputs ──────────────────────────────────────────────────────────────────

const readJson = (p, what) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new CoverageLost(`${what} ${p} is unreadable or not JSON (${e.code ?? 'parse error'})`); }
};

/** One queue item → the fields this tool reads; the key spellings tolerated are listed here and nowhere else. */
export function normaliseItem(it) {
  const deps = it.deps ?? it.dependsOn ?? it.after ?? [];
  return {
    lane: it.lane ?? it.id ?? it.name ?? null,
    cloud: it.cloud === true,
    lander: it.lander ?? null,
    priority: it.priority ?? it.prio ?? null,
    effort: it.effort ?? null,
    model: it.model ?? null,
    ceil: it.ceil ?? null,
    acctPref: it.acctPref ?? it.acct ?? null,
    transport: it.transport ?? null,
    deps: (Array.isArray(deps) ? deps : [deps]).map(String),
  };
}

export function queueItems(doc) {
  const arr = Array.isArray(doc) ? doc : doc?.items ?? doc?.queue ?? null;
  if (!Array.isArray(arr)) throw new CoverageLost('the queue is neither an array nor {items:[...]}');
  return arr.map(normaliseItem);
}

/** A KEY=VALUE file → Map(name → value). `#` comments, blank lines, `export ` and quotes tolerated. */
export function parseVault(text) {
  const out = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out.set(m[1], m[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

const TOKEN_SHAPES = [
  ['a GitHub classic token', /\bghp_[A-Za-z0-9]{16,}/],
  ['a GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{16,}/],
  ['an Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['a PEM block', /-----BEGIN [A-Z0-9 ]+-----/],
  ['a Slack token', /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/],
  ['an un-rewritten Windows user-profile path', /\b[A-Za-z]:(?:\\|\/)+Users(?:\\|\/)/i],
];

/**
 * → the reasons a body is unsafe to publish, each naming a vault KEY or a shape,
 * never the matched text. Vault values shorter than MIN_VAULT_VALUE are not
 * compared (a one-character value matches every body) and are counted instead.
 */
export function secretFindings(body, vault = new Map()) {
  const out = [];
  for (const [name, value] of vault) {
    if (value.length >= MIN_VAULT_VALUE && body.includes(value)) out.push(`holds the value of vault key ${name}`);
  }
  for (const [what, re] of TOKEN_SHAPES) if (re.test(body)) out.push(`holds ${what}`);
  return out;
}

/** A dep path (Windows or POSIX) → its marker name: `lwld-x` from a `…\lwld-x.out` path. */
export const markerName = (dep) => win32.basename(String(dep).trim()).replace(/\.out$/i, '');

/** The marker's last non-empty line is `land exit=0`. */
export function markerSatisfied(markersDir, name) {
  const p = join(markersDir, `${name}.out`);
  if (!existsSync(p)) return false;
  const lines = readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) === 'land exit=0';
}

const landerMerged = (lander, merged) => {
  if (!lander) return false;
  let re;
  try { re = new RegExp(lander); } catch { return false; }
  return merged.some((b) => re.test(b));
};

// ── the plan (pure, given its readers) ─────────────────────────────────────

/**
 * inputs:
 *   items          normalised queue items
 *   aliases        {lane: lane}
 *   prompt(lane)   → the prompt text, or null when there is no prompt file
 *   launched(lane) → true when a routine exists for it
 *   satisfied(name)→ true when that marker reads `land exit=0`
 *   mergedBranches Public PR head branches that merged
 *   existing       Map(lane → {number, state, body, labels}) — issues already there
 *   vault          Map(name → value)
 *   only           restrict to one lane
 * → { lanes: [{lane, action, deps, labels, render(numbers), meta}], refused: [{lane, reason}], skipped: [{lane, reason}] }
 */
export function planMigration({ items, aliases = {}, prompt, launched, satisfied, mergedBranches, existing = new Map(), vault = new Map(), only = null }) {
  const byLane = new Map(items.filter((i) => i.lane).map((i) => [i.lane, i]));
  const refused = [];
  const skipped = [];
  const chosen = [];
  for (const it of items) {
    if (!it.cloud || !it.lane) continue;
    if (only && it.lane !== only) continue;
    if (launched(it.lane)) { skipped.push({ lane: it.lane, reason: 'already launched (a routine exists)' }); continue; }
    if (landerMerged(it.lander, mergedBranches)) { skipped.push({ lane: it.lane, reason: 'its lander PR already merged' }); continue; }
    const ex = existing.get(it.lane);
    if (ex?.duplicate) { refused.push({ lane: it.lane, reason: `more than one issue is titled "${CONTRACT.titlePrefix}${it.lane}"` }); continue; }
    if (it.priority !== null && !CONTRACT.priorities.includes(String(it.priority))) { refused.push({ lane: it.lane, reason: `priority ${JSON.stringify(it.priority)} is not one of ${CONTRACT.priorities.join(', ')}` }); continue; }
    if (it.acctPref !== null && !CONTRACT.accounts.includes(String(it.acctPref))) { refused.push({ lane: it.lane, reason: `acctPref ${JSON.stringify(it.acctPref)} is not one of ${CONTRACT.accounts.join(', ')}` }); continue; }
    const text = prompt(it.lane);
    if (text === null) { refused.push({ lane: it.lane, reason: 'no prompt file: prepare it with the laptop\'s prompt builder first' }); continue; }
    chosen.push({ it, text });
  }
  // The secret guard reads the whole rendered body; a dep line is generated, so a stub render covers it.
  const safe = [];
  for (const c of chosen) {
    let body;
    try { body = renderIssue({ ...c.it, deps: [], prompt: c.text }).body; } catch (e) { refused.push({ lane: c.it.lane, reason: e.message }); continue; }
    const f = secretFindings(body + '\n' + c.it.deps.join('\n'), vault);
    if (f.length) { refused.push({ lane: c.it.lane, reason: `refused by the secret guard: the body ${f.join('; ')}` }); continue; }
    safe.push(c);
  }
  const migrating = new Set(safe.map((c) => c.it.lane));
  const lanes = safe.map(({ it, text }) => {
    const deps = [];
    for (const raw of it.deps) {
      const name = markerName(raw);
      if (/^lwld-cloudroutine-gate-/i.test(name)) continue;
      const base = name.replace(/^lwld-/i, '');
      const lane = aliases[base] ?? base;
      const target = byLane.get(lane);
      if (satisfied(name) || (lane !== base && satisfied(`lwld-${lane}`))) continue;
      if (target && landerMerged(target.lander, mergedBranches)) continue;
      if (migrating.has(lane) || existing.has(lane)) { deps.push({ kind: 'lane', lane }); continue; }
      if (target?.lander) { deps.push({ kind: 'pr', regex: target.lander }); continue; }
      deps.push({ kind: 'marker', name });
    }
    const ex = existing.get(it.lane) ?? null;
    const facts = { mergedBranches, closedIssues: [...existing.values()].filter((e) => e.state === 'closed' && e.stateReason === 'completed').map((e) => e.number) };
    const met = deps.every((d) => (d.kind === 'lane' ? existing.get(d.lane)?.state === 'closed' && existing.get(d.lane)?.stateReason === 'completed' : depMet(d, facts)));
    const labels = ['cloud-lane', met ? 'ready' : 'blocked'];
    if (it.priority !== null) labels.push(`prio:${it.priority}`);
    if (it.acctPref !== null) labels.push(`acct:${it.acctPref}`);
    const render = (numbers) => renderIssue({
      ...it,
      prompt: text,
      deps: deps.map((d) => {
        if (d.kind !== 'lane') return d;
        const n = numbers.get(d.lane);
        if (!Number.isInteger(n)) throw new Error(`lane ${it.lane}: no issue number for its dependency ${d.lane}`);
        return { kind: 'issue', number: n };
      }),
    });
    let action = 'create';
    if (ex) action = ex.state === 'closed' ? 'closed' : 'update';
    return { lane: it.lane, action, deps, labels, render, meta: it };
  });
  return { lanes, refused, skipped };
}

/** The labels a migration owns on an issue; every other label (claims, pr-open, drill…) is kept. */
const managed = (l) => ['cloud-lane', 'ready', 'blocked'].includes(l) || l.startsWith('prio:') || l.startsWith('acct:');

export const desiredLabels = (current, wanted) => [...new Set([...current.filter((l) => !managed(l)), ...wanted])].sort();

const allContractLabels = () => [
  ...CONTRACT.labels.fixed,
  ...CONTRACT.priorities.map((p) => `prio:${p}`),
  ...CONTRACT.accounts.map((a) => `acct:${a}`),
];

// ── the GitHub side ─────────────────────────────────────────────────────────

/** Issues already titled `lane: <x>` → Map(lane → {number, state, stateReason, labels, body, partComments}). */
export async function readExisting(client) {
  const out = new Map();
  for (const i of await client.listIssues('all', null)) {
    if (!String(i.title).startsWith(CONTRACT.titlePrefix)) continue;
    const lane = i.title.slice(CONTRACT.titlePrefix.length);
    if (out.has(lane)) { out.get(lane).duplicate = true; continue; }
    out.set(lane, {
      number: i.number,
      state: i.state,
      stateReason: i.state_reason ?? null,
      labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
      body: i.body ?? '',
    });
  }
  return out;
}

const PART_LINE = new RegExp(`^<!-- ${CONTRACT.partTag} (\\d+)/(\\d+) -->`);

/** Make the issue's body + continuation comments equal `parts`; → the number of writes. */
async function syncParts(client, number, parts) {
  let writes = 0;
  const comments = (await client.listComments(number)).filter((c) => isOwner(c, client.owner) && PART_LINE.test(String(c.body ?? '')));
  const byK = new Map(comments.map((c) => [Number(PART_LINE.exec(c.body)[1]), c]));
  for (let k = 2; k <= parts.length; k++) {
    const have = byK.get(k);
    if (!have) { await client.comment(number, parts[k - 1]); writes++; }
    else if (String(have.body).replace(/\r\n?/g, '\n') !== parts[k - 1]) { await client.updateComment(have.id, parts[k - 1]); writes++; }
    byK.delete(k);
  }
  for (const c of byK.values()) { await client.deleteComment(c.id); writes++; }
  return writes;
}

/**
 * Two passes: (1) create a `blocked` stub per new lane to learn its number; (2) write
 * every final body, its labels and its continuation comments. → {numbers, counts}.
 */
export async function applyPlan(client, plan, existing, { log = () => {} } = {}) {
  const have = new Set((await client.listLabels()).map((l) => l.name));
  const wantLabels = new Set([...allContractLabels(), ...plan.lanes.flatMap((l) => l.labels)]);
  let labelsCreated = 0;
  for (const name of [...wantLabels].sort()) {
    if (!have.has(name)) { await client.createLabel(name); labelsCreated++; }
  }
  const numbers = new Map([...existing].map(([lane, e]) => [lane, e.number]));
  let created = 0;
  for (const l of plan.lanes.filter((x) => x.action === 'create')) {
    const stub = renderIssue({ ...l.meta, deps: [], prompt: STUB_PROMPT });
    const issue = await client.createIssue(stub.title, stub.body, ['cloud-lane', 'blocked']);
    numbers.set(l.lane, issue.number);
    created++;
    log(`  created #${issue.number}  ${stub.title}`);
  }
  let updated = 0;
  let unchanged = 0;
  for (const l of plan.lanes.filter((x) => x.action === 'create' || x.action === 'update')) {
    const n = numbers.get(l.lane);
    const parts = splitPrompt(l.render(numbers).body);
    const ex = existing.get(l.lane);
    const labels = desiredLabels(ex?.labels ?? [], l.labels);
    const bodySame = ex && ex.body.replace(/\r\n?/g, '\n') === parts[0];
    const labelsSame = ex && JSON.stringify([...ex.labels].sort()) === JSON.stringify(labels);
    if (!bodySame || !labelsSame) await client.updateIssue(n, { body: parts[0], labels });
    const partWrites = await syncParts(client, n, parts);
    if (l.action === 'update') (bodySame && labelsSame && partWrites === 0 ? unchanged++ : updated++);
    log(`  wrote  #${n}  ${CONTRACT.titlePrefix}${l.lane}  parts=${parts.length}  labels=${labels.join(',')}`);
  }
  return { numbers, counts: { labelsCreated, created, updated, unchanged } };
}

/** Public PRs that merged → their head branches. */
async function mergedBranchesFrom(client) {
  return (await client.listPulls('closed')).filter((p) => p.merged_at).map((p) => p.head?.ref).filter(Boolean);
}

// ── main ────────────────────────────────────────────────────────────────────

export async function main(argv, { env = process.env, fetchImpl = globalThis.fetch, log = console.log, err = console.error } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { err(`COVERAGE LOST — ${e.message}`); return 2; }
  try {
    const items = queueItems(readJson(o.queue, 'the queue'));
    if (!items.some((i) => i.cloud)) throw new CoverageLost(`the queue ${o.queue} holds no cloud:true item, so there is nothing to migrate (the wrong file?)`);
    const aliases = o.aliases ? readJson(o.aliases, 'the aliases file') : {};
    let vault = new Map();
    if (o.vault) {
      try { vault = parseVault(readFileSync(o.vault, 'utf8')); } catch (e) { throw new CoverageLost(`the vault ${o.vault} is unreadable (${e.code ?? 'error'})`); }
    }
    const state = o.state ? readJson(o.state, 'the state file') : null;
    const token = tokenFromEnv(env);
    const client = token ? createClient({ repo: o.repo, token, fetchImpl }) : null;
    let mergedBranches = state?.mergedBranches ?? null;
    if (!Array.isArray(mergedBranches)) {
      if (!token) throw new CoverageLost('no merged-PR facts: pass --state {"mergedBranches":[...]} or set a token so the Public repo can be read');
      mergedBranches = await mergedBranchesFrom(createClient({ repo: o['public-repo'] ?? 'globalonlinedeveloper/Nikatru_Platform_Public', token, fetchImpl }));
    }
    const launchedSet = new Set(state?.launched ?? []);
    if (o.apply && !client) throw new CoverageLost('--apply needs a token in AUTOPILOT_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN');
    if (o.apply) {
      const repo = await client.getRepo();
      if (repo?.private !== true) { err(`🔴 REFUSED — ${o.repo} is not a private repository; lane prompts are Private content and go nowhere else.`); return 1; }
    }
    const existing = client ? await readExisting(client) : new Map();
    if (!client) log('(no token: planned as if the repo held no lane issues yet)');
    const plan = planMigration({
      items,
      aliases,
      prompt: (lane) => { const p = join(o['prompts-dir'], `${lane}.prompt.md`); return existsSync(p) ? readFileSync(p, 'utf8') : null; },
      launched: (lane) => launchedSet.has(lane) || existsSync(join(o['routines-dir'], `${lane}.routine`)),
      satisfied: (name) => markerSatisfied(o['markers-dir'], name),
      mergedBranches,
      existing,
      vault,
      only: o.only ?? null,
    });
    log(`${o.apply ? 'APPLY' : 'DRY RUN'} → ${o.repo}`);
    for (const l of plan.lanes) {
      const deps = l.deps.map((d) => (d.kind === 'lane' ? (existing.has(d.lane) ? `#${existing.get(d.lane).number}` : `#<${d.lane}>`) : d.kind === 'pr' ? `PR:${d.regex}` : `marker:${d.name}`));
      log(`  ${l.action.padEnd(7)} ${CONTRACT.titlePrefix}${l.lane}  labels=${l.labels.join(',')}  deps=[${deps.join(' ')}]`);
    }
    for (const s of plan.skipped) log(`  skip    ${s.lane}: ${s.reason}`);
    for (const r of plan.refused) log(`  REFUSE  ${r.lane}: ${r.reason}`);
    if (o.apply) {
      const { numbers, counts } = await applyPlan(client, plan, existing, { log });
      if (o['map-out']) {
        const prior = existsSync(o['map-out']) ? readJson(o['map-out'], 'the existing map') : {};
        for (const l of plan.lanes) prior[l.lane] = numbers.get(l.lane);
        writeFileSync(o['map-out'], JSON.stringify(prior, null, 2) + '\n');
      }
      log(`applied: ${counts.created} created · ${counts.updated} updated · ${counts.unchanged} unchanged · ${counts.labelsCreated} labels created`);
    } else {
      const c = plan.lanes.filter((l) => l.action === 'create').length;
      log(`plan: ${c} to create · ${plan.lanes.length - c} existing · ${plan.skipped.length} skipped · ${plan.refused.length} refused (dry: nothing written; --apply writes)`);
    }
    return plan.refused.length ? 1 : 0;
  } catch (e) {
    err(e instanceof CoverageLost ? `COVERAGE LOST — ${e.message}` : `FAILED — ${e.message}`);
    return 2;
  }
}

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const isMain = process.argv[1] !== undefined && samePath(resolve(process.argv[1]), resolve(fileURLToPath(import.meta.url)));
if (isMain) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
