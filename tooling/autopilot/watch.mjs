#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// watch.mjs — the I/O half of the autopilot watch. Every decision is ledger.mjs
// (pure, unit-tested); this reads GitHub with the workflow's GITHUB_TOKEN and makes
// the writes it names. Run by .github/workflows/autopilot-watch.yml.
//
// ⏱ 2026-10-02 · lane autopilot-watch, row O-WATCH-RUNS-ON-THE-LAPTOP.
//
// A PASS (default):
//   (a) the laptop heartbeat → open / edit / close the ONE `laptop-off` issue
//   (b) the open same-repo PR board (newest ci-gate RUN on each head decides; a
//       head unchanged since the last ledger reuses its GREEN/RED for up to
//       BOARD_CACHE_MIN, and at most BOARD_READS_PER_PASS PRs are read per pass)
//   (c) the run ledger: every run that ended red in the last LEDGER_WINDOW_H (the
//       jobs of the newest JOB_READS_PER_PASS failed runs are read)
//   every request counted against REQUEST_CEILING (ledger.mjs requestBudget)
//   (d) the open `land-freeze` issue, if any
//   then EDIT the body of the ONE issue titled `Autopilot ledger` (created once,
//   never commented on). A body ledger.mjs's assertPublic refuses is NOT written.
// --e2e: E2E after a web deploy (ledger.mjs e2eDecision) — dispatch e2e.yml on main.
//
// 🔴 It cannot write to the PRIVATE repo (no credential is allowed), so everything
// it publishes is a public fact: run ids, branches, PR numbers, job and label names.
//
// Usage: node tooling/autopilot/watch.mjs [--e2e]   (GITHUB_TOKEN, GITHUB_REPOSITORY)
// Exit 0 = done. 1 = a write was refused. 2 = could not look (nothing written).
// ─────────────────────────────────────────────────────────────────────────────
import { envToken, isMain, redact, CONTRACT } from './cli.mjs';
import { laptopState, parseBeat, readBeatApi } from './heartbeat.mjs';
import { restClient } from './review-paths.mjs';
import { laptopIssueAction, boardRow, runLedger, renderLedger, assertPublic, e2eDecision, requestBudget, parseBoardCache, boardPlan, jobReadIds, LEDGER_TITLE, WATCH_LABELS } from './ledger.mjs';

const FREEZE = CONTRACT.publicLabels.issue[0];
const H = 3_600_000;

async function get(call, path) {
  const r = await call('GET', path);
  if (!r.ok) throw new Error(`GET ${path} → HTTP ${r.status}`);
  return r.json;
}

async function issuesLabelled(call, label) {
  return ((await get(call, `/issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`)) ?? []).filter((i) => !i.pull_request);
}

/**
 * One watch pass. `call` is a REST client's call; `now` ms. Every request — the beat's
 * two included — is counted against `budget` (REQUEST_CEILING): the one past it throws,
 * and main() reports COULD NOT LOOK. Returns { code, lines }.
 */
export async function pass({ call: rawCall, repo, token, now = Date.now(), fetchImpl = globalThis.fetch, budget = requestBudget() }) {
  const call = async (method, path, body) => {
    budget.take(`${method} ${path}`);
    return rawCall(method, path, body);
  };
  const lines = [];
  let code = 0;
  const write = async (method, path, body, what) => {
    const r = await call(method, path, body);
    lines.push(r.ok ? what : `${what} — REFUSED HTTP ${r.status} ${redact(String(r.text).slice(0, 160))}`);
    if (!r.ok) code = 1;
    return r;
  };
  // (a)
  const countedFetch = (...a) => {
    budget.take('GET the heartbeat');
    return fetchImpl(...a);
  };
  const got = await readBeatApi({ repo, token, fetchImpl: countedFetch });
  const laptop = laptopState(parseBeat(got.text), now);
  const offIssues = await issuesLabelled(call, WATCH_LABELS.LAPTOP_OFF);
  const a = laptopIssueAction({ state: laptop.state, beat: laptop.beat, open: offIssues[0] ?? null, now });
  lines.push(`laptop: ${laptop.state} — ${a.act}`);
  if (a.act === 'open' && !assertPublic(a.body)) await write('POST', '/issues', { title: a.title, body: a.body, labels: [WATCH_LABELS.LAPTOP_OFF] }, 'opened the laptop-off issue');
  if (a.act === 'edit') await write('PATCH', `/issues/${offIssues[0].number}`, { body: a.body }, `edited laptop-off #${offIssues[0].number}`);
  if (a.act === 'close') {
    await write('POST', `/issues/${offIssues[0].number}/comments`, { body: a.comment }, `commented on laptop-off #${offIssues[0].number}`);
    await write('PATCH', `/issues/${offIssues[0].number}`, { state: 'closed', state_reason: 'completed' }, `closed laptop-off #${offIssues[0].number}`);
  }
  // The ledger issue first: its body carries the board cache this pass reuses.
  const mine = ((await get(call, '/issues?state=open&per_page=100&creator=github-actions%5Bbot%5D')) ?? []).find((i) => !i.pull_request && i.title === LEDGER_TITLE);
  // (b) — check-runs only for a PR whose head moved or whose cached verdict is stale.
  const open = ((await get(call, '/pulls?state=open&per_page=100')) ?? []).filter((p) => p.head?.repo?.full_name === repo);
  const plan = boardPlan({ prs: open.map((p) => ({ number: p.number, headSha: p.head?.sha })), cache: parseBoardCache(mine?.body), now });
  const board = [];
  let read = 0;
  for (const p of open) {
    const base = { number: p.number, draft: p.draft, labels: (p.labels ?? []).map((l) => l.name), createdAt: p.created_at, headSha: p.head.sha };
    const step = plan.get(p.number);
    if (!step.read) {
      board.push(boardRow({ ...base, gate: step.gate, readAt: step.at }, now));
      continue;
    }
    read++;
    const checks = (await get(call, `/commits/${p.head.sha}/check-runs?check_name=ci-gate&per_page=100`))?.check_runs ?? [];
    const runs = (await get(call, `/actions/runs?head_sha=${p.head.sha}&per_page=100`))?.workflow_runs ?? [];
    board.push(boardRow({ ...base, checks, runs }, now));
  }
  // (c)
  const since = new Date(now - CONTRACT.watch.LEDGER_WINDOW_H * H).toISOString();
  const runs = [];
  for (let page = 1; page <= 5; page++) {
    const rows = (await get(call, `/actions/runs?created=%3E%3D${since}&per_page=100&page=${page}`))?.workflow_runs ?? [];
    runs.push(...rows);
    if (rows.length < 100) break;
  }
  const jobs = {};
  for (const id of jobReadIds(runs)) jobs[id] = (await get(call, `/actions/runs/${id}/jobs?filter=latest&per_page=100`))?.jobs ?? [];
  const prByBranch = Object.fromEntries(open.map((p) => [p.head.ref, p.number]));
  const ledger = runLedger({ runs, jobs, prByBranch, now });
  // (d)
  const freezes = await issuesLabelled(call, FREEZE);
  const freeze = freezes[0] ? { number: freezes[0].number, createdAt: freezes[0].created_at } : null;
  const body = renderLedger({ now, laptop, board, ledger, freeze });
  const refused = assertPublic(body);
  if (refused) return { code: 1, lines: [...lines, `ledger NOT written: ${refused}`] };
  if (mine) await write('PATCH', `/issues/${mine.number}`, { body }, `edited the ledger #${mine.number} (${board.length} PR(s), ${read} read, ${ledger.length} red run(s), ${budget.used()}/${budget.ceiling} requests)`);
  else await write('POST', '/issues', { title: LEDGER_TITLE, body }, 'created the ledger issue');
  return { code, lines };
}

/** E2E after a web deploy. Returns { code, lines }. */
export async function e2ePass({ call, now = Date.now() }) {
  const ci = (await get(call, '/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=10'))?.workflow_runs ?? [];
  let deployedSha = null;
  for (const r of ci) {
    const js = (await get(call, `/actions/runs/${r.id}/jobs?filter=latest&per_page=100`))?.jobs ?? [];
    const web = js.filter((j) => /^deploy-web \/ /.test(j.name));
    if (web.length && web.every((j) => j.conclusion === 'success' || j.conclusion === 'skipped') && web.some((j) => j.conclusion === 'success')) {
      deployedSha = r.head_sha;
      break;
    }
  }
  const e2e = (await get(call, '/actions/workflows/e2e.yml/runs?branch=main&per_page=30'))?.workflow_runs ?? [];
  const provenSha = e2e.find((r) => r.status === 'completed' && r.conclusion === 'success')?.head_sha ?? null;
  const lastDispatch = e2e.find((r) => r.event === 'workflow_dispatch');
  const hold = (await issuesLabelled(call, WATCH_LABELS.E2E_HOLD)).length > 0;
  let files = null;
  if (deployedSha && provenSha && deployedSha !== provenSha) {
    const cmp = await call('GET', `/compare/${provenSha}...${deployedSha}`);
    files = cmp.ok && (cmp.json?.files ?? []).length < 300 ? cmp.json.files.map((f) => f.filename) : null;
  }
  const d = e2eDecision({ deployedSha, provenSha, files, lastDispatchAt: lastDispatch ? Date.parse(lastDispatch.created_at) : NaN, hold, now });
  const lines = [`e2e: ${d.dispatch ? 'DISPATCH' : 'no dispatch'} — ${d.why}`];
  if (!d.dispatch) return { code: 0, lines };
  const r = await call('POST', '/actions/workflows/e2e.yml/dispatches', { ref: 'main' });
  return r.status === 204 ? { code: 0, lines: [...lines, 'dispatched e2e.yml on main'] } : { code: 1, lines: [...lines, `dispatch answered HTTP ${r.status}`] };
}

async function main(argv) {
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const token = envToken();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !token) {
    console.log('COULD NOT LOOK — GITHUB_REPOSITORY and GITHUB_TOKEN are required');
    return 2;
  }
  const { call } = restClient({ repo, token });
  try {
    const r = argv.includes('--e2e') ? await e2ePass({ call }) : await pass({ call, repo, token });
    for (const l of r.lines) console.log(l);
    return r.code;
  } catch (e) {
    console.log(`COULD NOT LOOK — ${redact(e.message)}`);
    return 2;
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
