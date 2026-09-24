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
