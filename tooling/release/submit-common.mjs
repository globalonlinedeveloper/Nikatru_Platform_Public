// ─────────────────────────────────────────────────────────────────────────────
// submit-common.mjs — the preamble every tooling/release/submit-*.mjs runs.
//
// ⏱ ADDED 2026-09-25 (O-SUBMIT-SCRIPTS-SHARE-NO-MODULE). The argument reader,
// the repo root, the ok/step printers and the two stops were a byte-identical
// block in each submit script. Four copies of a stop is four places its exit
// code can be wrong, and all four WERE: every `coverageLost` exited 1, which the
// exit-code convention (AGENTS.md, O-EXIT2-CONVENTION-GAP) reserves for a
// finding. Here it exits 2, once.
//
// NOT a release script: no channel row names it, and assert-channel-register's
// orphan check admits it by name through RELEASE_LIBRARIES, which refuses the
// entry the day no submit script imports it.
//
// Exit convention of the two stops:
//   coverageLost(lines) → 2  the script could not look, so "clean" would be a lie
//   die(lines)          → 1  a finding, or a refused invocation
//
// ⏱ C4b, 2026-09-25: THE ENVIRONMENT READ LIVES HERE TOO. `requirePublishEnvironment`
// is the one run-time read of the `store-publish` environment's protection rules.
// submit-play, submit-snap and submit-windows-store call it, and
// extensions/scripts/lib/store-environment.mjs re-exports it to the three
// extension publishers. Until this change there were four copies of it, and they
// did not even agree on the reviewer rule (see the function). It RETURNS a
// verdict and never exits, so each caller stops in its own style — windows by
// `process.exitCode`, which TRAPS shell-12 needs there. assert-release-provenance
// limb 4(b) credits a caller that imports it from this file AND calls it, and
// grades this file's own code for the read, so deleting the read here un-credits
// every caller at once.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubApiBase } from '../ci/record-deployment.mjs';

/** The COVERAGE LOST exit. A finding is 1; a guard that could not look is 2. */
export const EXIT_COVERAGE_LOST = 2;

/**
 * The shared preamble for the submit script called `name` (its basename without
 * `.mjs`; it is the word on every FAILED line).
 *
 * `root` is `--repo-root` when given (tests point it at a fixture tree), else
 * the repository this file sits in, two levels up — the same directory every
 * submit script computed from its own location, since they live beside it.
 */
export function submitCli(name) {
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(`--${f}`);
  const opt = (o, fallback = null) => {
    const i = argv.indexOf(`--${o}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const root = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const ok = (m) => console.log(`ok   ${m}`);
  const step = (m) => console.log(`→    ${m}`);
  const abs = (rel) => join(root, rel);
  // One read, no existsSync first (CodeQL js/file-system-race): a missing file is null.
  const read = (rel) => {
    try {
      return readFileSync(abs(rel), 'utf8');
    } catch (e) {
      if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return null;
      throw e;
    }
  };

  /** The scan cannot continue and reporting "clean" would be a lie about nothing. */
  function coverageLost(lines) {
    console.error('');
    console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
    for (const l of lines.slice(1)) console.error(`     ${l}`);
    console.error(`\n${name}: FAILED`);
    process.exit(2);
  }

  function die(lines) {
    console.error('');
    for (const l of lines) console.error(l);
    console.error(`\n${name}: FAILED`);
    process.exit(1);
  }

  return { argv, flag, opt, root, ok, step, abs, read, coverageLost, die };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PUBLISH ENVIRONMENT — [ADR 031] class A: a store publish is owner-only,
// per instance, and the gate is a GitHub environment carrying a required
// reviewer.
// ─────────────────────────────────────────────────────────────────────────────

/** ONE gate for every store, not one per channel. A second environment would be
 *  a second thing to configure and a second thing to be silently missing. The
 *  `gh api` calls that create it with its reviewer are in docs/ci/submit-play.md. */
export const PUBLISH_ENVIRONMENT = 'store-publish';

/** The source for the read: "GET /repos/{owner}/{repo}/environments/{environment_name}",
 *  whose response carries `protection_rules`, and "Anyone with read access to the
 *  repository can use this endpoint" — which is why the job's own `github.token`
 *  is enough. */
export const GITHUB_ENVIRONMENTS_API = 'https://docs.github.com/en/rest/deployments/environments';

/** The token the read sends. submit-play.mjs PG-5b makes a second GET with it. */
export const githubToken = (env = process.env) => (env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '').trim();

/**
 * The run-time read without which `environment:` is decoration.
 *
 * 🔴 `environment:` ON A JOB FAILS OPEN. GitHub documents that "Running a
 * workflow that references an environment that does not exist will create an
 * environment with the referenced name", with no protection rules, so the job
 * runs at once, unapproved, and the run history shows an environment as if a
 * gate had been honoured. A typo in the name has the same effect. MEASURED on
 * this repository 2026-08-09: its three deploy-lane environments, all
 * auto-created, each returned `"protection_rules": []`. So the publisher asks the
 * API what the environment carries, immediately before its first store call.
 *
 * 📌 THE RULE IS A `required_reviewers` RULE WITH A NON-EMPTY `reviewers` LIST.
 * GitHub labels the rule `type: "required_reviewers"` and puts `reviewers` only
 * on that rule. What was measured is that the fail-open state has NO rules at
 * all, so a rule that carries reviewers cannot be present on an auto-created
 * environment. The full `protection_rules` JSON is printed on a refusal so the
 * first run names its fix.
 *
 * Each of the four copies this function replaced required ONE of the two
 * conditions: submit-play PG-5, submit-snap PG-6 and store-environment.mjs a
 * non-empty `reviewers` list, submit-windows-store PG-6 the `required_reviewers`
 * type. This read requires BOTH (parent ruling PC4B-1, the strict intersection),
 * so it refuses everything any of the four refused: a `required_reviewers` rule
 * whose `reviewers` list is empty names nobody to approve (windows accepted it),
 * and a non-empty `reviewers` list under another `type` is not a reviewer rule
 * (the other three accepted it).
 *
 * It RETURNS a verdict and never exits. `lines` are ready to print: the refusal
 * lines start `FAIL`, the success lines `ok` (and `⬜` for the loopback seam).
 * `label` names the caller's gate ("PG-5") on both. On success `body` is the
 * environment JSON and `url` the address it came from, for a caller that reads
 * more of it (submit-play.mjs PG-5b, the deployment branch policy).
 *
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, label?: string | null, userAgent?: string }} [opts]
 * @returns {Promise<{ ok: true, lines: string[], url: string, body: object } | { ok: false, lines: string[] }>}
 */
export async function requirePublishEnvironment({ env = process.env, fetchImpl = fetch, label = null, userAgent = 'nikatru-store-publish' } = {}) {
  const who = label === null ? '' : `${label} · `;
  if ((env.GITHUB_ACTIONS ?? '') !== 'true' || (env.GITHUB_REPOSITORY ?? '').trim() === '') {
    return {
      ok: false,
      lines: [
        `FAIL ${who}a store publish runs only inside GitHub Actions (GITHUB_ACTIONS=true and GITHUB_REPOSITORY set).`,
        `     [ADR 031] the gate is the "${PUBLISH_ENVIRONMENT}" environment with a required reviewer, and it exists only there.`,
      ],
    };
  }
  const repo = env.GITHUB_REPOSITORY.trim();
  const token = githubToken(env);
  if (token === '') {
    return {
      ok: false,
      lines: [
        `FAIL ${who}a store publish needs GITHUB_TOKEN to read the publish environment's protection rules ("${PUBLISH_ENVIRONMENT}").`,
        '     Without it an environment GitHub auto-created (no rules) cannot be told from a gated one: the',
        '     two look identical from inside the job. Pass `GITHUB_TOKEN: ${{ github.token }}` on the publish step.',
        `     ${GITHUB_ENVIRONMENTS_API}`,
      ],
    };
  }
  // The GitHub origin goes through the one loopback rule the deploy recorder
  // uses, so a test can answer this read from a local server. Anything but the
  // real origin or http loopback refuses: this request carries the job's token.
  const gh = githubApiBase(env);
  if (gh.error !== undefined) return { ok: false, lines: [`FAIL ${who}${gh.error}`] };
  const envUrl = `${gh.base}/repos/${repo}/environments/${PUBLISH_ENVIRONMENT}`;
  let res;
  try {
    res = await fetchImpl(envUrl, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': userAgent,
      },
    });
  } catch (e) {
    return { ok: false, lines: [`FAIL ${who}could not reach ${envUrl} (${e.message}). A gate that cannot be read has not been shown to exist.`] };
  }
  if (res.status === 404) {
    return {
      ok: false,
      lines: [
        `FAIL ${who}the "${PUBLISH_ENVIRONMENT}" environment does not exist in ${repo}.`,
        '     [ADR 031:117-124] the publish gate IS that environment plus a required reviewer. GitHub',
        '     documents that referencing a missing environment CREATES it — with no protection rules — so',
        '     relying on `environment:` alone would have let this run publish unapproved while looking',
        '     gated. Creating it is a repo-admin act and belongs to a human; the `gh api` calls are in',
        '     docs/ci/submit-play.md, and every store publishes through this one environment.',
      ],
    };
  }
  if (!res.ok) {
    return { ok: false, lines: [`FAIL ${who}got HTTP ${res.status} from ${envUrl}. A gate that cannot be read has not been shown to exist.`] };
  }
  // An unreadable body is an environment with no rules shown, and is refused below.
  const body = await res.json().catch(() => ({}));
  const rules = Array.isArray(body?.protection_rules) ? body.protection_rules : [];
  const reviewerRule = rules.find((r) => r?.type === 'required_reviewers' && Array.isArray(r?.reviewers) && r.reviewers.length > 0);
  if (!reviewerRule) {
    return {
      ok: false,
      lines: [
        `FAIL ${who}the "${PUBLISH_ENVIRONMENT}" environment exists in ${repo} and carries NO required reviewer.`,
        `     protection_rules = ${JSON.stringify(rules)}`,
        '     An environment with no rules does not pause anything — the job runs the instant it is',
        '     dispatched. That is the state GitHub leaves behind when a workflow auto-creates an',
        '     environment, and it is indistinguishable from a real gate anywhere except here.',
      ],
    };
  }
  // 🔴 `can_admins_bypass` COMES FROM THE SAME GET. Where it is not false an
  // administrator can dispatch straight past the reviewer, and MEASURED on this
  // repository it is true. Bypass is a legitimate setting and turning it off is
  // a repo-admin act, so this does not refuse — it stops claiming an approval it
  // did not observe. The requirement is verified; that it was exercised is not.
  const bypass = body.can_admins_bypass !== false;
  return {
    ok: true,
    url: envUrl,
    body,
    lines: [
      ...(gh.override ? [`⬜   GITHUB_API_URL override in effect: ${gh.base} — this is a LOOPBACK TEST SEAM, not the real service.`] : []),
      `ok   ${label === null ? '' : `${label} `}publish gate — "${PUBLISH_ENVIRONMENT}" carries ${reviewerRule.reviewers.length} required reviewer(s)` +
        (bypass
          ? '. ⚠️ `can_admins_bypass` is true, so reaching this line does NOT prove one of them approved: an administrator can dispatch straight past the gate. The requirement is verified; the approval is not.'
          : ' and `can_admins_bypass` is false, so this job only reached this line because one of them approved it.'),
    ],
  };
}
