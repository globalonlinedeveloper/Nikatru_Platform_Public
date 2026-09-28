// ─────────────────────────────────────────────────────────────────────────────
// run-page-anchor.mjs — the ONE answer to "is this page of GitHub Actions run
// history CURRENT, or a stale replica's page?", asked with an ANCHOR the stale
// page cannot satisfy. Pure functions: pages, env and a commit in, a verdict out.
// No network, no filesystem, no exit.
//
// ── THE DEFECT, MEASURED (2026-09-18, three times, then twice more live) ────
// GitHub's runs-list API sometimes answers from a replica that is days or weeks
// behind. `reconcileRunReads` (assert-ops-register.mjs, 2026-09-09) catches it
// when two concurrent reads at two `per_page` widths DISAGREE. It cannot catch
// it when both reads are served the SAME stale page, because they agree:
//   (1) ops-watch run 35369631763 (16:38Z): ops-watch.yml's newest scheduled
//       success read as run 33228655039 of 2026-08-29 (494h) while successes
//       existed at 12:17, 13:10 and 14:44Z. Three duties read "NO SUCCESSFUL
//       RUN AT ALL". The rerun passed.
//   (2) PR #806 CI (14:56Z): assert-platform-proof-fresh read the newest green
//       scheduled build-platforms.yml run as 32003607931 of 2026-08-17 (32.3
//       days) while run 35215254802 of 2026-09-17 existed. The rerun passed.
//   (3) the platform Worker's watchdog (12:00Z) read ci.yml's newest completed
//       run on main as 35117703012 of 2026-09-16 while 35340873024 of 11:41Z
//       existed.
//   (4) and (5), while this module was being written (~17:10Z): two plain
//       `gh api .../ci.yml/runs?branch=main` reads answered pages ending
//       2026-09-16T04:48Z while main HEAD 19b6eb99 (17:04Z) had its run; the
//       next read of the same URL was current.
// A second read of the same history is not evidence. Evidence is something the
// stale page CANNOT contain.
//
// ── THE THREE ANCHORS ────────────────────────────────────────────────────────
// Run ids are allocated in increasing order across the repository (every id
// above is older than every larger one), and a replica can only OMIT runs that
// happened after its snapshot — it can never invent one. So each anchor is a
// run the page MUST hold, or MUST NOT be outrun by:
//
//   SELF-RUN  — inside GitHub Actions, GITHUB_RUN_ID is a run of THIS workflow
//               that exists right now. A page of that workflow's history on the
//               running ref whose largest id is below it ends before the
//               present: stale. Catches (1).
//   BRANCH HEAD — for a workflow whose `on.push.branches` names the branch with
//               no path filter, main HEAD (read from the COMMITS endpoint — git
//               storage, not the Actions replica) has a run of it. Measured
//               2026-09-18: all 60 newest main commits carry a ci.yml push run.
//               A page without a run for HEAD is stale, once HEAD is older than
//               HEAD_RUN_GRACE_MS and carries no skip marker. Catches (3)-(5).
//   CROSS-READ — the same question asked through a DIFFERENT query: the
//               freshness readers (anchored-run-read.mjs) re-ask by creation date
//               (`created=>=<the page's newest run>`, `crossReadTerm`); the
//               ops-register reader, which holds ten workflow pages, reads the
//               repository-wide run list ONCE and filters it by `path` (one
//               request instead of one per workflow). Either way a different
//               cache key. Any run it returns that is newer than everything on
//               the page proves the page behind (one-way: a staler cross-read
//               can never make a fresh page look stale). Catches (2) when the
//               cross-read is served fresh. Measured 2026-09-18: all 60 newest
//               main commits also carry a codeql.yml push run, the other
//               workflow `pushTriggersBranch` accepts today.
//
// A violated anchor is UNREADABLE — never a finding. A stale page invents reds
// (freshness) and hides them (red-since); the honest verdict for "GitHub served
// me an old history" is "no verdict", printed, on every run.
//
// ⏱ APPENDED 2026-09-24 (trap ci-48, PR #913 CI run 35967342865): still never a
// finding, and now GREEN when the cross-read itself holds the proof. A replica
// can only omit runs, so every run on the page and on the cross-read exists and
// matches the query; the three FRESHNESS readers (anchored-run-read.mjs, which
// now holds the platform reader's cross-read) grade the UNION of the two. Union
// fresh: green, with a line starting `STALE PAGE, CROSS-READ CARRIED THE PROOF:`.
// Page proven stale and the union still not fresh: COVERAGE LOST, as before.
// assert-ops-register.mjs's `anchoredBranchPage` keeps the refusal unchanged —
// its red-since use is not a freshness claim, and a union cannot answer it.
//
// ⬜ NAMED, NOT CLOSED: a status-filtered history read OUTSIDE Actions, for a
// workflow that is not push-triggered, has only the cross-read, and a
// cross-read served by the same stale replica agrees with the page. That
// residue is stated here rather than implied away. What exposes it is the
// read line each freshness reader prints on every run (anchored-run-read.mjs
// `describeRead`): the query, the row count and the newest run of each read,
// so two reads that agree on an old answer can be told from a real gap by
// asking the same query once more by hand.
// ─────────────────────────────────────────────────────────────────────────────

/** A run that completed within this many ms of now may genuinely have landed
 *  between two concurrent requests — the same window reconcileRunReads uses. */
export const ANCHOR_RACE_MS = 120_000;

/** How long after a commit lands on the branch its push-triggered run may still
 *  be missing without that meaning staleness (GitHub creates it in seconds). */
export const HEAD_RUN_GRACE_MS = 10 * 60_000;

/** A page whose newest run is younger than this is not cross-read: a replica
 *  that far behind cannot move any verdict that reads in hours or days, and
 *  the cross-read costs one request of a shared, rate-limited token. */
export const CROSS_READ_AFTER_MS = 3 * 3_600_000;

/** The token every refusal carries, so a log search finds all of them. */
export const STALE_PAGE = 'stale page';

/** GitHub's own skip markers — a head commit carrying one has no push run. */
const SKIP_MARKER = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i;

const isId = (v) => Number.isSafeInteger(v) && v > 0;

/** PURE. The largest run id on a page, or -Infinity for a page with none. */
export function maxRunId(runs) {
  let m = -Infinity;
  for (const r of runs ?? []) if (isId(r?.id) && r.id > m) m = r.id;
  return m;
}

/** PURE. The newest run on a page BY ID (creation order), never `runs[0]`. */
export function newestById(runs) {
  let best = null;
  for (const r of runs ?? []) if (isId(r?.id) && (!best || r.id > best.id)) best = r;
  return best;
}

/**
 * PURE. The SELF-RUN anchor: when this process runs inside a GitHub Actions run
 * of `workflow` on `branch`, the id of that run. null when it does not apply —
 * outside Actions, another repository, another workflow, or another ref (a PR
 * run's GITHUB_REF is refs/pull/N/merge and its runs are not on main's page).
 */
export function selfRunFloor(env, { repo = null, workflow, branch = null }) {
  if (env?.GITHUB_ACTIONS !== 'true') return null;
  const id = Number(env.GITHUB_RUN_ID);
  if (!isId(id)) return null;
  if (repo && env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY !== repo) return null;
  const ref = String(env.GITHUB_WORKFLOW_REF ?? '');
  const at = ref.indexOf('@');
  const path = at === -1 ? ref : ref.slice(0, at);
  if (!workflow || !path.endsWith(`/.github/workflows/${workflow}`)) return null;
  if (branch && env.GITHUB_REF !== `refs/heads/${branch}`) return null;
  return {
    id,
    why: `this process runs inside run ${id} of ${workflow}${branch ? ` on ${branch}` : ''}, which exists now, so its history cannot end before it`,
  };
}

/**
 * PURE. Does this workflow's `on:` block run it on EVERY push to `branch`?
 * Conservative by construction: anything it cannot read plainly — a scalar or
 * list `on:`, a path filter, a branches-ignore — answers false, which only
 * withholds the BRANCH HEAD anchor and can never produce a false "stale".
 */
export function pushTriggersBranch(yamlText, branch) {
  if (typeof yamlText !== 'string' || !branch) return false;
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^(?:on|'on'|"on"):\s*(?:#.*)?$/.test(l));
  if (start === -1) return false;
  const block = [];
  for (let i = start + 1; i < lines.length && !/^\S/.test(lines[i]); i++) block.push(lines[i]);
  const pushAt = block.findIndex((l) => /^\s+push:\s*(?:#.*)?$/.test(l));
  if (pushAt === -1) return false;
  const indent = block[pushAt].match(/^\s*/)[0].length;
  const body = [];
  for (let i = pushAt + 1; i < block.length; i++) {
    const l = block[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (l.match(/^\s*/)[0].length <= indent) break;
    body.push(l.replace(/\s+#.*$/, ''));
  }
  if (body.some((l) => /^\s*(?:paths|paths-ignore|branches-ignore):/.test(l))) return false;
  const bi = body.findIndex((l) => /^\s*branches:/.test(l));
  if (bi === -1) return false;
  const inline = body[bi].match(/branches:\s*\[([^\]]*)\]/);
  const names = inline
    ? inline[1].split(',')
    : body.slice(bi + 1).filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s*/, ''));
  return names.map((n) => n.trim().replace(/^['"]|['"]$/g, '')).includes(branch);
}

/**
 * PURE. The BRANCH HEAD anchor from a `GET /repos/{o}/{r}/commits/{branch}`
 * body. null when it does not apply: HEAD too young for its run to be required
 * yet, or a skip marker in its message. THROWS on a body without a 40-hex sha
 * and a committer date — an anchor that cannot be read is not an absent one.
 */
export function headAnchor(commit, nowMs, branch = 'main') {
  const sha = String(commit?.sha ?? '');
  const date = commit?.commit?.committer?.date;
  const at = Date.parse(date ?? '');
  if (!/^[0-9a-f]{40}$/.test(sha) || Number.isNaN(at)) {
    throw new Error(`the head of ${branch} came back without a 40-hex sha and a committer date, so the branch-head anchor could not be read`);
  }
  if (SKIP_MARKER.test(String(commit?.commit?.message ?? ''))) return null;
  if (nowMs - at < HEAD_RUN_GRACE_MS) return null;
  return {
    sha,
    why: `${branch} HEAD ${sha.slice(0, 8)} landed at ${date} and every push to ${branch} runs this workflow, so a current page holds a run of ${sha.slice(0, 8)}`,
  };
}

/** PURE. Should this page be cross-read? Only when its newest run is old enough
 *  for a stale replica to move a verdict (see CROSS_READ_AFTER_MS). */
export function needsCrossRead(runs, nowMs) {
  const n = newestById(runs);
  if (!n) return false;
  const at = Date.parse(n.updated_at ?? n.created_at ?? '');
  return Number.isNaN(at) || nowMs - at > CROSS_READ_AFTER_MS;
}

/** PURE. The cross-read's query term: every run created at or after the page's
 *  newest. A current answer holds that run and anything newer. null for a page
 *  with no dated run (nothing to anchor the window on). */
export function crossReadTerm(runs) {
  const n = newestById(runs);
  if (!n?.created_at || Number.isNaN(Date.parse(n.created_at))) return null;
  return `created=${encodeURIComponent(`>=${n.created_at}`)}`;
}

/**
 * PURE. The verdict. `anchors` holds any of:
 *   floor: { id, why }              — from selfRunFloor
 *   head:  { sha, why }             — from headAnchor
 *   cross: { runs, why }            — a cross-read's workflow_runs
 * Returns { ok: true, anchored: [names] } or { ok: false, why } — and `why`
 * always starts with STALE_PAGE so the caller's "unreadable: …" says so.
 */
export function judgeRunPage(runs, { what = 'this run history', floor = null, head = null, cross = null, nowMs = Date.now() } = {}) {
  const top = maxRunId(runs);
  const ends = top === -Infinity ? 'holds NO run at all' : `ends at run ${top}`;
  const refuse = (because) => ({
    ok: false,
    why:
      `${STALE_PAGE} — ${what} ${ends}, but ${because}. GitHub served a history that ends before the present, ` +
      'so NO verdict is available from it: not a pass, not a finding.',
  });
  if (floor && !(top >= floor.id)) return refuse(floor.why);
  if (head && !(runs ?? []).some((r) => r?.head_sha === head.sha)) return refuse(head.why);
  if (cross) {
    let beyond = null;
    for (const c of cross.runs ?? []) {
      if (!isId(c?.id) || c.id <= top) continue;
      const at = Date.parse(c.updated_at ?? c.created_at ?? '');
      if (!Number.isNaN(at) && nowMs - at <= ANCHOR_RACE_MS) continue; // a real race, not staleness
      if (!beyond || c.id > beyond.id) beyond = c;
    }
    if (beyond) {
      return refuse(
        `${cross.why ?? 'a cross-read of the same question'} answered run ${beyond.id} ` +
          `(${beyond.updated_at ?? beyond.created_at ?? 'undated'}), newer than anything on the page`,
      );
    }
  }
  return { ok: true, anchored: [floor && 'self-run', head && 'branch-head', cross && 'cross-read'].filter(Boolean) };
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ APPENDED 2026-09-28 · THE CROSS-READ WAS STALE TOO — a SECOND SOURCE, and a
// page proven stale is REPLACED by the fresh source rather than believed.
//
// ── THE DEFECT, MEASURED ────────────────────────────────────────────────────
// Main CI 36409128416 attempt 2 (on 0c29df69, ~10:35Z) failed guards-platform
// on six duties of tooling/ops/register.json, every one reading ops-watch.yml's
// newest success as run 35422355154 of 2026-09-19 (221.7h) while ops-watch had
// succeeded at 00:00Z, 01:04Z and 02:17Z that day; attempt 1, 14 minutes
// earlier, read fresh data. No anchor refused: the one cross-read ops-register
// asked — `/actions/runs?branch=main` — came back as stale as the page. Measured
// by hand at the same minute:
//   GET …/actions/workflows/ops-watch.yml/runs?per_page=5&branch=main  → newest 2026-09-25 (STALE)
//   GET …/actions/workflows/ops-watch.yml/runs?…&status=success         → 2026-09-28T02:17Z (fresh)
//   GET …/actions/runs?per_page=100, filtered by name                   → 2026-09-28T08:50Z (fresh)
// and `gh run list -w ci.yml -b main` answered week-old runs that day. At
// 10:44Z all of them answered 08:50Z again; at 11:06Z it was back, and this
// time EVERY listing was measured, newest run of each (per_page=100):
//   …/ops-watch.yml/runs?branch=main              35477612056  2026-09-20  STALE
//   …/ops-watch.yml/runs                          36412660595  10:56Z      fresh
//   …/ops-watch.yml/runs?status=completed         36412660595  10:56Z      fresh
//   …/ops-watch.yml/runs?event=schedule           36399752579  08:50Z      fresh
//   …/ops-watch.yml/runs?branch=main&status=success  36369228689  02:17Z   fresh
//   /actions/runs?branch=main                     35477612056  2026-09-20  STALE
//   /actions/runs                                 36413577030  11:05Z      fresh
//   …/ci.yml/runs?branch=main                     35946652352  2026-09-24  STALE
//   …/ci.yml/runs                                 36413577030  11:05Z      fresh
// THE `branch=` FILTER IS THE STALE VECTOR, on both endpoints. The same
// workflow's listing WITHOUT it was fresh every time, and it holds that
// workflow's newest 100 runs (2.5 days of ops-watch) where the repository list
// holds ~9 hours of everything.
//
// ── THE RULE (lead ruling 2026-09-28) ───────────────────────────────────────
// Every reader that grades freshness from a `branch=` listing ALSO reads the
// SAME listing without `branch=` (`withoutBranch`), and a reader whose query has
// no branch reads the unfiltered repository list (`repoWideRunsPath`) instead;
// assert-ops-register.mjs, which holds ten pages, reads both. The query's own
// filters are applied HERE (`runQueryPredicate`): head_branch, event, status —
// and `path`, for the repository list. A query carrying a filter this cannot
// apply faithfully gets no such window, never a guessed one.
//   · page not proven stale → the page, as before: both sources agreeing that
//                             the run is old is still the caller's RED;
//   · page proven stale     → the FRESH source is graded (`spliceFreshWindows`):
//       – the windows reach back to the page's newest run: the union is one
//         contiguous history, and every question is answered from it;
//       – they do not: only the fresh window is known. A question it answers
//         is answered; one it cannot is UNREAD (coverage lost), never FAILING.
// A window is COMPLETE between its oldest row and its newest — a replica omits
// runs after its snapshot, never between two it serves — which is what lets its
// bottom edge (`floorId`) bound what it can vouch for.
//
// ⏱ 2026-09-28 · THE WORKER COPY. The platform Worker cannot import this module,
// so services/platform/src/ops-watchdog.ts carries its own `judgeMainPage` (the
// HEAD and CROSS-READ anchors) and `spliceCrossRead` (the splice above, for its
// one window: the creation-date cross-read). A change to the rule here is a
// change there: run-page-anchor.test.mjs "THE WORKER COPY" asks both copies
// every case and reds when they answer differently.
// ─────────────────────────────────────────────────────────────────────────────

/** The prefix of a run's `path` FIELD in the API's answer, matched against —
 *  never a file this module opens. Kept a bare prefix on purpose: the full
 *  `<prefix><file>` literal is what tooling/ci/assert-workflow-readers.mjs
 *  (R1) reads as "reads a workflow by text", and this reads no workflow. */
const RUN_PATH_PREFIX = '.github/workflows/';

/** Rows of the unfiltered repository-wide run list: the API maximum. */
export const REPO_WIDE_PAGE = 100;

/** PURE. The unfiltered repository-wide run list — no `branch=`, `status=` or
 *  `event=`: the one listing that answered fresh on 2026-09-28. */
export function repoWideRunsPath(repo) {
  return `/repos/${repo}/actions/runs?per_page=${REPO_WIDE_PAGE}`;
}

/** The API's `status=` values that name a run STATE; every other is a CONCLUSION. */
const RUN_STATES = new Set(['completed', 'in_progress', 'queued', 'requested', 'waiting', 'pending']);
/** Query keys that filter nothing this window must reproduce. */
const NON_FILTER_KEYS = new Set(['per_page', 'page']);

/** PURE. The client-side twin of a run-list query: `(run) => boolean` applying
 *  its `branch`, `event`, `status` and `head_sha`, or null when it carries any
 *  other filter — a window filtered LESS than the page could let a run the page
 *  would not hold make a stale page look fresh, so none is built. */
export function runQueryPredicate(query) {
  const s = String(query ?? '');
  const qs = s.includes('?') ? s.slice(s.indexOf('?') + 1) : s;
  const want = {};
  for (const [k, v] of new URLSearchParams(qs)) {
    if (NON_FILTER_KEYS.has(k)) continue;
    if (!['branch', 'event', 'status', 'head_sha'].includes(k) || k in want) return null;
    want[k] = v;
  }
  return (r) => {
    if (!r || typeof r !== 'object') return false;
    if (want.branch !== undefined && r.head_branch !== want.branch) return false;
    if (want.event !== undefined && r.event !== want.event) return false;
    if (want.head_sha !== undefined && r.head_sha !== want.head_sha) return false;
    if (want.status !== undefined && (RUN_STATES.has(want.status) ? r.status : r.conclusion) !== want.status) return false;
    return true;
  };
}

/** PURE. `query` (a URL or a query string) with its `branch=` removed, or null
 *  when it has none — the one listing that was fresh on 2026-09-28. */
export function withoutBranch(query) {
  const s = String(query ?? '');
  const at = s.indexOf('?');
  const head = at === -1 ? '' : s.slice(0, at + 1);
  const sp = new URLSearchParams(at === -1 ? s : s.slice(at + 1));
  if (!sp.has('branch')) return null;
  sp.delete('branch');
  return head + sp.toString();
}

/** PURE. One listing as a window onto ONE workflow's question: the rows the
 *  predicate accepts (of `workflow`, by `path`, when the listing is the
 *  repository's; every row, when `workflow` is null because the listing is that
 *  workflow's own), and the id range the WHOLE listing spans — every run in it
 *  exists, and every run of the workflow between `floorId` and `topId` is in it.
 *  THROWS on a body without a workflow_runs array: an unread window is not an
 *  empty one. */
export function repoWideWindow(body, { workflow = null, predicate, why = 'the repository-wide run list' }) {
  if (!Array.isArray(body?.workflow_runs)) throw new Error(`${why} came back without a workflow_runs array`);
  const path = RUN_PATH_PREFIX + workflow;
  let floorId = Infinity;
  let topId = -Infinity;
  for (const r of body.workflow_runs) {
    if (!isId(r?.id)) continue;
    if (r.id < floorId) floorId = r.id;
    if (r.id > topId) topId = r.id;
  }
  const runs = body.workflow_runs.filter((r) => isId(r?.id) && (workflow === null || r.path === path) && predicate(r));
  return { runs, floorId, topId, why };
}

/**
 * PURE. A page `judgeRunPage` proved stale, joined to the windows that proved
 * it. The freshest window is the present; any other window that reaches it
 * extends it downward. When the result reaches the page's newest run the union
 * is ONE contiguous history (`gapBelow: null`). When it does not, the runs
 * between the page and the window are unknown, so only the window's runs are
 * returned and `gapBelow` says where knowledge stops: a caller that cannot find
 * its answer at or above `floorId` has NO answer — UNREAD, never a finding.
 */
export function spliceFreshWindows(page, windows, { what = 'this run history' } = {}) {
  const ws = (windows ?? []).filter((w) => w && Number.isFinite(w.floorId) && Number.isFinite(w.topId));
  if (ws.length === 0) throw new Error(`${STALE_PAGE} — ${what} was proven stale, and no fresh window came back to grade instead`);
  // Coverage starts at the DEEPEST window that proves the page stale (holds a
  // run newer than the page) — a workflow's own listing reaches days back where
  // the repository list reaches hours — and any window overlapping it extends it.
  const top0 = maxRunId(page);
  const proving = ws.filter((w) => w.runs.some((r) => r.id > top0));
  const primary = (proving.length ? proving : ws).reduce((a, b) => (proving.length ? (b.floorId < a.floorId ? b : a) : b.topId > a.topId ? b : a));
  let lo = primary.floorId;
  for (let grew = true; grew; ) {
    grew = false;
    for (const w of ws) if (w.topId >= lo && w.floorId < lo) { lo = w.floorId; grew = true; }
  }
  const byId = new Map();
  const keep = (r) => {
    const had = byId.get(r.id);
    if (!had || Date.parse(r.updated_at ?? '') > Date.parse(had.updated_at ?? '')) byId.set(r.id, r);
  };
  for (const w of ws) for (const r of w.runs) if (r.id >= lo) keep(r);
  const top = maxRunId(page);
  if (top !== -Infinity && top >= lo) {
    for (const r of page ?? []) if (isId(r?.id)) keep(r);
    return { runs: [...byId.values()], gapBelow: null };
  }
  return {
    runs: [...byId.values()],
    gapBelow: {
      floorId: lo,
      why:
        `${STALE_PAGE} — ${what} ends at run ${top === -Infinity ? 'none' : top}, and the fresh repository-wide window that ` +
        `proved it stale reaches back only to run ${lo}: the answer is not in that window, and the runs between the two ` +
        'were served by neither read, so NO verdict is available — not a pass, not a finding.',
    },
  };
}
