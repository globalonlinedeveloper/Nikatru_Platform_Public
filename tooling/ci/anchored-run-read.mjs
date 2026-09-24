// ─────────────────────────────────────────────────────────────────────────────
// anchored-run-read.mjs — the ONE networked read of a workflow's run history
// behind a FRESHNESS proof: one page, under the shared per-request ceiling, the
// stale-page anchor applied to it, the cross-read when the page is old enough to
// move a verdict, the UNION the verdict is graded on, and the line that says
// what was read.
//
// NOT A GUARD. It sets no exit code and owns no verdict: each caller grades the
// runs with its own rule and turns a thrown `CouldNotLook` into its own COVERAGE
// LOST. It is split from run-page-anchor.mjs because that module is PURE (pages
// in, a verdict out, no network) and this one is the I/O around it.
//
// ── WHY IT EXISTS (trap ci-48, 2026-09-24) ──────────────────────────────────
// PR #913, CI run 35967342865 attempt 1 (~07:01Z): assert-e2e-proof-fresh.mjs
// failed "newest green scheduled run is 5.0 days old, ceiling is 3" while main
// carried green 35962444367 (06:06:58Z that day) and 35838102124 (2026-09-23);
// the same query re-run at 07:05:34Z returned 73 rows, newest 35962444367, and
// attempt 2 passed. That guard read ONE page with no anchor, no cross-read and
// no request ceiling, and its fail reason printed no run id, no row count and no
// query, so a stale page and a real five-day gap read identically. Its sibling
// in extensions/scripts read the same way. assert-platform-proof-fresh.mjs had
// the cross-read since 2026-09-18 (`anchoredRuns`, PR #806's page); that reader
// MOVED here, so the three graders read through one function.
//
// ── THE CALLERS, AND WHICH ANCHORS FIT EACH (measured at 403d7716) ───────────
//   tooling/ci/assert-e2e-proof-fresh.mjs       e2e.yml, branch=main&status=success
//   tooling/ci/assert-platform-proof-fresh.mjs  build-platforms.yml, status=success
//   extensions/scripts/assert-e2e-proof-fresh.mjs  extensions.yml, branch=main&event=schedule
// · CROSS-READ — all three. The cross-read repeats the caller's query with every
//   filter kept and `created>=<the page's newest>` added, so any run it returns
//   matches the query.
// · SELF-RUN — only where the running workflow IS the graded one AND the running
//   run is a row of the graded query. The two tooling/ci guards run in ci.yml and
//   grade another workflow: never. The extension guard runs in extensions.yml and
//   grades extensions.yml, but its query is `event=schedule` and its job's `if:`
//   excludes the schedule event, so the running run is never on the page; the
//   caller arms it only when GITHUB_EVENT_NAME is `schedule`.
// · BRANCH HEAD — none: `pushTriggersBranch` reads false for e2e.yml,
//   build-platforms.yml and extensions.yml (tag pushes only, or no push at all).
//   run-page-anchor.test.mjs pins that, so a push trigger added later reds there.
//
// ── THE UNION (decision E2) ─────────────────────────────────────────────────
// A replica can only OMIT runs that happened after its snapshot; it can never
// invent one. So every run on the page and every run on the cross-read EXISTS
// and matches the query, and the verdict is graded on both, de-duplicated by id:
//   union fresh                      → the caller's green, plus one line starting
//                                      `STALE PAGE, CROSS-READ CARRIED THE PROOF:`
//                                      when the page was proven stale;
//   page proven stale, union stale   → COVERAGE LOST (exit 2), as before;
//   page not proven stale, not fresh → the caller's finding (exit 1), as before.
// The residue run-page-anchor.mjs names is unchanged: a cross-read served by the
// same stale replica agrees with the page. `describeRead` prints both reads'
// newest run and row count on every run, which is what exposes that case.
//
// ── THE CEILING (decision E4) ───────────────────────────────────────────────
// Every request, the page and the cross-read, and an injected `read` too, runs
// under `readWithBoundedRetry` from tooling/ops/bounded-retry.mjs: its
// REQUEST_TIMEOUT_MS per attempt, READ_ATTEMPTS attempts, its backoff. No
// constant of that kind is declared here. A read that outlives the plan throws
// `CouldNotLook`, which every caller reports as COVERAGE LOST, never a finding.
//
// Failing cases: tooling/ci/test/run-page-anchor.test.mjs (the union, the
// ceiling, the wiring of all three callers and the class sweep) and
// tooling/ci/test/e2e-proof-fresh.test.mjs (the PR #913 page, through the CLI).
// ─────────────────────────────────────────────────────────────────────────────
import { judgeRunPage, needsCrossRead, crossReadTerm, newestById, CROSS_READ_AFTER_MS } from './run-page-anchor.mjs';
import {
  CouldNotLook,
  readWithBoundedRetry,
  classifyThrown,
  isTransientStatus,
  transientLook,
  retryAfterMs,
} from '../ops/bounded-retry.mjs';

export const GITHUB_API = 'https://api.github.com';

/** Rows the cross-read asks for. It is ordered newest first and filtered to
 *  runs created at or after the page's newest, so ten is room for a day of
 *  runs of any graded workflow; the newest is what anchors and what grades. */
export const CROSS_READ_PAGE = 10;

/** The token the carried-proof line starts with, so a log search finds all. */
export const STALE_PAGE_CARRIED = 'STALE PAGE, CROSS-READ CARRIED THE PROOF:';

/** PURE. The path and parameters of a request, never the host and never a
 *  credential (the token travels in a header, not in the URL). The host is
 *  stripped only when a `/` follows it, so a lookalike host
 *  (`api.github.com.example`) is printed whole, never passed off as GitHub's
 *  (CodeQL js/incomplete-url-substring-sanitization). */
export function queryOf(url) {
  const s = String(url ?? '');
  return s.startsWith(`${GITHUB_API}/`) ? s.slice(GITHUB_API.length) : s;
}

/** PURE. The `per_page` a query asks for, or null. */
export function perPageOf(url) {
  const m = /[?&]per_page=(\d+)/.exec(String(url ?? ''));
  return m ? Number(m[1]) : null;
}

/** PURE. The cross-read URL: the caller's query with every filter kept, the
 *  creation-date term added and the page shrunk. THROWS on a query with no
 *  `per_page` — a replace that matched nothing would re-send the SAME query,
 *  which is the same cache key and not a cross-read at all. */
export function crossReadUrl(url, term) {
  if (!/[?&]per_page=\d+/.test(String(url))) {
    throw new CouldNotLook(`${queryOf(url)} carries no per_page, so no cross-read can be built from it`);
  }
  return String(url).replace(/per_page=\d+/, `${term}&per_page=${CROSS_READ_PAGE}`);
}

/** PURE. An offline fixture, in either of its two shapes (decision E6): an array
 *  is a page with no cross-read; `{ "page": [...], "cross": [...] }` carries
 *  both. Anything else THROWS — a fixture that cannot be read is a record that
 *  was not read. */
export function fixtureReads(doc) {
  if (Array.isArray(doc)) return { page: doc, cross: null };
  if (doc && typeof doc === 'object' && Array.isArray(doc.page)) {
    if (doc.cross === undefined || doc.cross === null) return { page: doc.page, cross: null };
    if (Array.isArray(doc.cross)) return { page: doc.page, cross: doc.cross };
    throw new CouldNotLook('the fixture carries a `cross` that is not an array of runs');
  }
  throw new CouldNotLook('the fixture is neither an array of runs (a page) nor { "page": [...], "cross": [...] }');
}

/** PURE. Page first, then every cross-read run the page does not hold. A run on
 *  both keeps the copy with the later `updated_at`: the same run read twice can
 *  only have moved forward. Rows with no id are kept, never merged. */
export function unionById(page, cross) {
  const out = [];
  const at = new Map();
  for (const r of [...(page ?? []), ...(cross ?? [])]) {
    if (!r || r.id === undefined || r.id === null) {
      out.push(r);
      continue;
    }
    if (!at.has(r.id)) {
      at.set(r.id, out.length);
      out.push(r);
      continue;
    }
    const i = at.get(r.id);
    if (Date.parse(r.updated_at ?? '') > Date.parse(out[i]?.updated_at ?? '')) out[i] = r;
  }
  return out;
}

/** The default read: ONE GitHub GET, classified for the shared retry. A dropped
 *  wire, 429 and 5xx are worth asking again; every other status is an answer. */
export function githubRead(token, { label = 'the run history', userAgent = 'nikatru-ci' } = {}) {
  return async (url, { signal } = {}) => {
    if (!token) throw new CouldNotLook(`no token was handed to the read of ${label}`);
    let res;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': userAgent },
        signal,
      });
    } catch (e) {
      throw classifyThrown(e, `the request for ${label} did not answer (${e?.name ?? 'error'}: ${e?.message ?? e})`);
    }
    if (isTransientStatus(res.status)) {
      throw transientLook(`GitHub API returned ${res.status} for ${label}`, { retryAfterMs: retryAfterMs(res) });
    }
    if (!res.ok) throw new CouldNotLook(`GitHub API returned ${res.status} for ${label}`);
    try {
      return await res.json();
    } catch (e) {
      throw new CouldNotLook(`GitHub answered ${label} with a body that is not JSON (${e.message})`);
    }
  };
}

/** One bounded GET of a JSON body, for a caller's other reads of the same API
 *  (the extension guard's per-run jobs). Same ceiling, same classification. */
export async function githubJson(url, token, { label = queryOf(url), userAgent = 'nikatru-ci', retry = {} } = {}) {
  const get = githubRead(token, { label, userAgent });
  return readWithBoundedRetry((_attempt, { signal }) => get(url, { signal }), { note: noteRetry(label), ...retry });
}

const noteRetry = (label) => (m) => console.log(`      retry  ${label}: ${m}`);

/**
 * Read one page of a workflow's run history, anchored.
 *
 *   url      the caller's query, built by the caller (its filters are its own)
 *   token    for the default read; the caller checks for it first, in its own words
 *   read     injectable `(url, { signal }) => body`, for tests; still bounded
 *   fixture  an offline document (see fixtureReads); when set, nothing is fetched
 *   floor    a `selfRunFloor` result, or null; head: a `headAnchor` result, or null
 *   retry    options for readWithBoundedRetry (a test shortens `timeoutMs`)
 *
 * Returns { workflow, query, perPage, saturated, page, cross, crossWhyNot,
 * verdict, stale, union, fixture }. THROWS `CouldNotLook` when the page or the
 * cross-read could not be read; a stale page is returned, never thrown, and
 * `gradeUnion` decides what it means.
 */
export async function anchoredRunRead({
  workflow,
  url,
  token = null,
  read = null,
  fixture = undefined,
  nowMs = Date.now(),
  floor = null,
  head = null,
  what = `the run history of ${workflow}`,
  label = `${workflow} runs`,
  userAgent = 'nikatru-ci',
  retry = {},
} = {}) {
  const perPage = perPageOf(url);
  if (!perPage) throw new CouldNotLook(`${queryOf(url)} carries no per_page, so whether the page came back full cannot be told`);
  let page;
  let cross = null;
  let crossQuery = null;
  let term = null;
  let crossWhyNot = null;
  if (fixture !== undefined) {
    const f = fixtureReads(fixture);
    page = f.page;
    if (f.cross) {
      cross = f.cross;
      term = crossReadTerm(page) ?? 'the fixture cross-read';
    } else {
      crossWhyNot = 'fixture has none';
    }
  } else {
    const get = read ?? githubRead(token, { label, userAgent });
    const bounded = (u, l) => readWithBoundedRetry((_attempt, { signal }) => get(u, { signal }), { note: noteRetry(l), ...retry });
    const body = await bounded(url, label);
    page = body?.workflow_runs;
    if (!Array.isArray(page)) throw new CouldNotLook(`the ${label} list came back without a workflow_runs array`);
    const newest = newestById(page);
    if (!needsCrossRead(page, nowMs)) {
      crossWhyNot = newest
        ? `the page's newest run ${newest.id} is under ${CROSS_READ_AFTER_MS / 3_600_000}h old`
        : 'the page holds no run to anchor a creation-date window on';
    } else if (!(term = crossReadTerm(page))) {
      crossWhyNot = `the page's newest run ${newest?.id} carries no created_at to anchor a creation-date window on`;
    } else {
      const u = crossReadUrl(url, term);
      const again = await bounded(u, `${label} cross-read`);
      if (!Array.isArray(again?.workflow_runs)) throw new CouldNotLook(`the ${label} cross-read came back without a workflow_runs array`);
      cross = again.workflow_runs;
      crossQuery = queryOf(u);
    }
  }
  const verdict = judgeRunPage(page, {
    what,
    floor,
    head,
    cross: cross ? { runs: cross, why: 'a cross-read of the same question by creation date' } : null,
    nowMs,
  });
  return {
    workflow,
    query: queryOf(url),
    perPage,
    saturated: page.length >= perPage,
    page,
    cross: cross ? { term, query: crossQuery, runs: cross } : null,
    crossWhyNot,
    verdict,
    stale: !verdict.ok,
    union: unionById(page, cross),
    fixture: fixture !== undefined,
  };
}

const runText = (r) => (r ? `${r.id} (updated_at ${r.updated_at ?? 'absent'})` : 'none');

/** PURE. What was read, for the caller's OUTCOME line on every run, pass or
 *  fail (decision E3): the query, rows, per_page, saturation, the newest
 *  QUALIFYING run of what was graded (the caller's `newestOf`), and the
 *  cross-read or why there was none. */
export function describeRead(read, newestOf) {
  const src = read.fixture ? `fixture standing in for GET ${read.query}` : `GET ${read.query}`;
  const cross = read.cross
    ? `${safeDecode(read.cross.term)}: ${read.cross.runs.length} row(s), newest ${newestById(read.cross.runs)?.id ?? 'none'}`
    : `not run (${read.crossWhyNot})`;
  return (
    `${src} · ${read.page.length} row(s) returned, per_page ${read.perPage}, saturated ${read.saturated ? 'yes' : 'no'} · ` +
    `newest qualifying run ${runText(newestOf(read.union))} · cross-read ${cross}` +
    (read.stale ? ' · the page is PROVEN STALE' : '')
  );
}

function safeDecode(s) {
  try {
    return decodeURIComponent(String(s));
  } catch {
    return String(s);
  }
}

/** PURE. The carried-proof line: the page's newest qualifying run and the
 *  cross-read's, each with its `updated_at`, and both row counts. */
export function staleCarriedLine(read, newestOf) {
  const cross = read.cross
    ? `the cross-read's is ${runText(newestOf(read.cross.runs))} over ${read.cross.runs.length} row(s)`
    : `there was no cross-read (${read.crossWhyNot}), so the page's own runs carried it`;
  return (
    `${STALE_PAGE_CARRIED} the page's newest qualifying run is ${runText(newestOf(read.page))} over ${read.page.length} row(s); ` +
    `${cross}. GitHub served a page that ends before the present, and a replica can omit runs but never invent one, so the ` +
    `union of the reads was graded. Query: GET ${read.query}.`
  );
}

/**
 * PURE. Decision E2. `grade(runs)` is the caller's own freshness rule and
 * returns at least { ok, reason }. The union is always what is graded — on a
 * page that is not proven stale it differs from the page only by a run inside
 * the race window, which exists — and the stale flag decides what a red means.
 */
export function gradeUnion(read, grade, newestOf) {
  const g = grade(read.union);
  if (!read.stale) return g;
  if (g.ok) return { ...g, stalePageCarried: staleCarriedLine(read, newestOf) };
  return {
    ok: false,
    coverageLost: true,
    unreadable: true,
    stalePage: true,
    reason:
      `${read.verdict.why} The union of the page and its cross-read was graded too and is not fresh either ` +
      `(${g.reason}), so no verdict is available from either read: unreadable, not a finding.`,
  };
}
