// ─────────────────────────────────────────────────────────────────────────────
// ledger.mjs — the PURE half of the autopilot watch (tooling/autopilot/watch.mjs,
// run by .github/workflows/autopilot-watch.yml). Every decision is here and
// unit-tested in tooling/ci/test/autopilot-ledger.test.mjs; watch.mjs only reads
// GitHub and makes the writes these functions name.
//
// ⏱ 2026-10-02 · lane autopilot-watch, row O-WATCH-RUNS-ON-THE-LAPTOP. Three laptop
// daemons (the cloud-lane watch, the run ledger, E2E-after-deploy) read only GitHub
// facts, so they run on GitHub Actions in both modes, laptop up or not.
//
// 🔴 PUBLIC FACTS ONLY. The ledger is an issue body in the PUBLIC repo: run ids,
// branches, PR numbers, job and step names, label names. Never a lane brief, a prompt
// or Private text; `assertPublic` refuses a body with a C:/Users path or a
// secret-shaped string, and the watch then writes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { CONTRACT } from './cli.mjs';
import { gateVerdict } from '../ops/land-rules.mjs';
import { gateRuns } from '../ci/land-next.mjs';

const W = CONTRACT.watch;
const [FRESH, STALE, HANDOVER, DRILL_STALE] = CONTRACT.heartbeat.states;
const [LAND_OK, LAND_HOLD, NEEDS_REVIEW, REVIEW_APPROVE, REVIEW_CHANGES, FIX_FIRST] = CONTRACT.publicLabels.pr;
const [, LAPTOP_OFF, E2E_HOLD] = CONTRACT.publicLabels.issue;
export const WATCH_LABELS = Object.freeze({ LAPTOP_OFF, E2E_HOLD });
const BOARD_LABELS = [LAND_OK, LAND_HOLD, NEEDS_REVIEW, REVIEW_APPROVE, REVIEW_CHANGES, FIX_FIRST];
const H = 3_600_000;
const MIN = 60_000;

export const LAPTOP_OFF_TITLE = 'Laptop off — cloud autopilot active';
export const LEDGER_TITLE = 'Autopilot ledger';
export const RED_CONCLUSIONS = Object.freeze(['failure', 'cancelled', 'timed_out', 'startup_failure']);
/** Workflows a person dispatches and watches: flagged, never chased. */
export const ATTENDED = [/^Rollback\b/, /^Native auth proof\b/, /^Store submit/];

// ── (a) laptop state → the one `laptop-off` issue ───────────────────────────

/**
 * `state` from heartbeat.mjs; `open` the open `laptop-off` issue or null. The issue
 * itself is the memory of the last transition, so three stale passes open ONE issue
 * and edit it twice; `unknown` changes nothing.
 * Returns { act: 'open' | 'edit' | 'close' | 'none', title?, body?, comment? }.
 */
export function laptopIssueAction({ state, beat, open, now }) {
  const off = [STALE, HANDOVER, DRILL_STALE].includes(state);
  const since = beat?.at ?? 'unknown';
  const ageH = beat?.at ? ((now - Date.parse(beat.at)) / H).toFixed(1) : '?';
  const body = [
    `<!-- autopilot laptop-off -->`,
    `The laptop heartbeat (ref \`${CONTRACT.heartbeat.ref}\`) reads **${state}**: newest beat at ${since}, ${ageH} h ago (mode ${beat?.mode ?? '?'}).`,
    '',
    `While it is not fresh, the cloud routines (${CONTRACT.routines.map((r) => r.id).join(', ')}) act; merges are made by land.yml. This issue is edited, not commented, on every watch pass, and closed when a fresh beat returns.`,
    '',
    `Last watch pass: ${new Date(now).toISOString()}.`,
  ].join('\n');
  if (off && !open) return { act: 'open', title: `${state === DRILL_STALE ? '[DRILL] ' : ''}${LAPTOP_OFF_TITLE}`, body };
  if (off && open) return { act: 'edit', body };
  if (state === FRESH && open) return { act: 'close', comment: `Laptop heartbeat fresh again (newest beat ${since}). Closing: the laptop is primary.` };
  return { act: 'none' };
}

// ── (b) the PR board ────────────────────────────────────────────────────────

/** One open same-repo PR → its board row. `checks` are ci-gate check-runs on the head; `runs` the head's runs. */
export function boardRow(pr, now) {
  const labels = (pr.labels ?? []).filter((l) => BOARD_LABELS.includes(l));
  const g = gateVerdict(pr.checks ?? [], { runs: gateRuns(pr.runs) });
  const ageH = (now - Date.parse(pr.createdAt)) / H;
  const stall = !pr.draft && g.verdict === 'GREEN' && ageH > W.STALL_H && !labels.includes(LAND_OK);
  return { number: pr.number, draft: Boolean(pr.draft), labels, gate: g.verdict, ageH, stall };
}

// ── (c) the run ledger ──────────────────────────────────────────────────────

/**
 * Every run that ENDED red in the last LEDGER_WINDOW_H. `runs` are REST workflow
 * runs; `jobs` maps a run id to its jobs (with steps) when read; `prByBranch` maps a
 * head branch to its PR number. Returns rows, newest first.
 */
export function runLedger({ runs, jobs = {}, prByBranch = {}, now }) {
  const since = now - W.LEDGER_WINDOW_H * H;
  const all = runs ?? [];
  const rows = [];
  for (const r of all) {
    if (r.status !== 'completed' || !RED_CONCLUSIONS.includes(r.conclusion)) continue;
    const ended = Date.parse(r.updated_at ?? r.created_at ?? '');
    if (!(ended >= since)) continue;
    const owner = r.head_branch === 'main' ? 'main' : prByBranch[r.head_branch] ? `#${prByBranch[r.head_branch]}` : r.pull_requests?.[0]?.number ? `#${r.pull_requests[0].number}` : `branch ${r.head_branch}`;
    let cause;
    if (r.conclusion === 'cancelled') {
      const newer = all.filter((x) => x.workflow_id === r.workflow_id && x.head_sha === r.head_sha && Number(x.id) > Number(r.id)).sort((a, b) => Number(a.id) - Number(b.id))[0];
      cause = newer ? `superseded by #${newer.id}` : 'cancelled, no reason recorded';
    } else {
      const js = jobs[String(r.id)];
      const job = (js ?? []).find((j) => ['failure', 'timed_out', 'startup_failure'].includes(j.conclusion));
      const step = job?.steps?.find((s) => ['failure', 'timed_out'].includes(s.conclusion));
      cause = js === undefined ? `${r.conclusion} (jobs not read)` : job ? `${job.name}${step ? ` › ${step.name}` : ''}` : `${r.conclusion} (no failed job listed)`;
    }
    rows.push({ id: r.id, workflow: r.name, branch: r.head_branch, sha: String(r.head_sha ?? '').slice(0, 8), conclusion: r.conclusion, endedAt: new Date(ended).toISOString(), owner, cause, attended: ATTENDED.some((re) => re.test(String(r.name ?? ''))) });
  }
  return rows.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt) || Number(b.id) - Number(a.id));
}

// ── publish ─────────────────────────────────────────────────────────────────

const SECRET = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** A body that must never be published → the reason, or null. */
export function assertPublic(body) {
  if (/C:[\\/]+Users/i.test(body)) return 'it carries a C:/Users path';
  if (SECRET.test(body)) return 'it carries a secret-shaped string';
  return null;
}

// Markdown table cell: backslashes first (CodeQL js/incomplete-sanitization, alert 581),
// then the cell delimiter, then newlines.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The ledger issue body, capped at LEDGER_BODY_CAP: the OLDEST ledger rows are dropped first. */
export function renderLedger({ now, laptop, board, ledger, freeze, cap = W.LEDGER_BODY_CAP }) {
  const head = [
    '<!-- autopilot ledger: edited by .github/workflows/autopilot-watch.yml; never commented on -->',
    `# ${LEDGER_TITLE}`,
    '',
    `Updated ${new Date(now).toISOString()} · laptop **${laptop.state}**${laptop.beat ? ` (beat ${laptop.beat.at}, seq ${laptop.beat.seq})` : ''} · freeze: ${freeze ? `#${freeze.number} open ${((now - Date.parse(freeze.createdAt)) / H).toFixed(1)} h` : 'none'}`,
    '',
    '## Pull requests',
    '',
    '| PR | state | ci-gate | labels | age | stall |',
    '|---|---|---|---|---|---|',
    ...board.map((b) => `| #${b.number} | ${b.draft ? 'draft' : 'ready for review'} | ${b.gate} | ${b.labels.map((l) => `\`${l}\``).join(' ') || '—'} | ${b.ageH.toFixed(1)} h | ${b.stall ? `**STALL** (> ${W.STALL_H} h, green, no \`${LAND_OK}\`)` : ''} |`),
    ...(board.length ? [] : ['| — | no open same-repo PR | | | | |']),
    '',
    `## Runs that ended red in the last ${W.LEDGER_WINDOW_H} h`,
    '',
    '| run | workflow | owner | conclusion | cause | ended |',
    '|---|---|---|---|---|---|',
  ];
  const row = (r) => `| ${r.id} | ${esc(r.workflow)}${r.attended ? ' _(attended)_' : ''} | ${r.owner} | ${r.conclusion} | ${esc(r.cause)} | ${r.endedAt} |`;
  const tail = (dropped) => ['', dropped ? `_${dropped} older row(s) dropped to stay under ${cap} characters._` : `_${ledger.length} row(s)._`];
  let rows = ledger.map(row);
  let dropped = 0;
  const text = () => [...head, ...rows, ...(rows.length ? [] : ['| — | none | | | | |']), ...tail(dropped)].join('\n');
  while (text().length > cap && rows.length) {
    rows = rows.slice(0, -1); // newest first, so the last row is the oldest
    dropped++;
  }
  return text();
}

// ── E2E after a web deploy ──────────────────────────────────────────────────

/** Paths whose deploy needs an E2E proof (land-next's E2E paths plus the shared auth/UI packages). */
export const E2E_DEPLOY_PATH = /^(?:apps\/[^/]+\/(?:lib|web|assets)|packages\/[^/]+\/lib|packages\/(?:auth_supabase|design_system|chassis_screens|core)\/)/;

/**
 * deployedSha: main's head whose CI run deployed web successfully; provenSha: the head
 * of the newest successful E2E live run on main; files: the compare between them (null
 * if unreadable → an app diff is assumed); lastDispatchAt: ms of the newest E2E
 * dispatch; hold: an open `e2e-hold` issue exists. Returns { dispatch, why }.
 */
export function e2eDecision({ deployedSha, provenSha, files, lastDispatchAt, hold, now }) {
  if (!deployedSha) return { dispatch: false, why: 'no successful web deploy on main to prove' };
  if (deployedSha === provenSha) return { dispatch: false, why: `the deployed head ${deployedSha.slice(0, 8)} is already E2E-proven` };
  if (hold) return { dispatch: false, why: `an open \`${E2E_HOLD}\` issue holds E2E (a known red being fixed)` };
  if (Number.isFinite(lastDispatchAt) && now - lastDispatchAt < W.E2E_DISPATCH_MIN_GAP_MIN * MIN) return { dispatch: false, why: `an E2E run was dispatched ${Math.round((now - lastDispatchAt) / MIN)} min ago (< ${W.E2E_DISPATCH_MIN_GAP_MIN})` };
  if (Array.isArray(files) && !files.some((f) => E2E_DEPLOY_PATH.test(f))) return { dispatch: false, why: `the ${files.length} file(s) since the proven head touch no app or shared UI path` };
  return { dispatch: true, why: `deployed ${deployedSha.slice(0, 8)} is not E2E-proven (last proven ${String(provenSha ?? 'none').slice(0, 8)})${Array.isArray(files) ? '' : '; the diff was unreadable, so it is assumed to touch the app'}` };
}
