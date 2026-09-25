// ─────────────────────────────────────────────────────────────────────────────
// store-environment.mjs — a store publish runs only inside the `store-publish`
// GitHub environment, and only once that environment is shown to carry a
// required reviewer.
//
// [ADR 031] class A: a store publish is owner-only, per instance. The gate is a
// GitHub environment with a required reviewer, and `environment:` on a job FAILS
// OPEN on its own — GitHub documents that "Running a workflow that references an
// environment that does not exist will create an environment with the referenced
// name", with no protection rules. So the publisher reads the environment back
// at run time, immediately before its first store call. This is the shape
// tooling/release/submit-play.mjs (PG-5) already takes for Play, lifted into one
// helper the three extension publishers call (EXT-3, 2026-09-24).
//
// assert-release-provenance.mjs limb 4 holds every store publish job to
// `environment:` AND its publisher to a call of requireStorePublishEnvironment().
// ─────────────────────────────────────────────────────────────────────────────

export const STORE_PUBLISH_ENVIRONMENT = 'store-publish';
const GITHUB_BASE = 'https://api.github.com';

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true, lines: string[] } | { ok: false, lines: string[] }>}
 */
export async function requireStorePublishEnvironment({ env = process.env, fetchImpl = fetch } = {}) {
  if ((env.GITHUB_ACTIONS ?? '') !== 'true' || (env.GITHUB_REPOSITORY ?? '').trim() === '') {
    return {
      ok: false,
      lines: [
        'FAIL a store publish runs only inside GitHub Actions (GITHUB_ACTIONS=true and GITHUB_REPOSITORY set).',
        `     [ADR 031] the gate is the "${STORE_PUBLISH_ENVIRONMENT}" environment with a required reviewer, and it exists only there.`,
      ],
    };
  }
  const repo = env.GITHUB_REPOSITORY.trim();
  const token = (env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '').trim();
  if (token === '') {
    return {
      ok: false,
      lines: [
        `FAIL a store publish needs GITHUB_TOKEN to read the "${STORE_PUBLISH_ENVIRONMENT}" environment's protection rules.`,
        '     Without it an environment GitHub auto-created (no rules) cannot be told from a gated one. Pass',
        '     `GITHUB_TOKEN: ${{ github.token }}` on the publish step.',
      ],
    };
  }
  const envUrl = `${GITHUB_BASE}/repos/${repo}/environments/${STORE_PUBLISH_ENVIRONMENT}`;
  let res;
  try {
    res = await fetchImpl(envUrl, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'nikatru-store-publish',
      },
    });
  } catch (e) {
    return { ok: false, lines: [`FAIL could not reach ${envUrl} (${e.message}). A gate that cannot be read has not been shown to exist.`] };
  }
  if (res.status === 404) {
    return {
      ok: false,
      lines: [
        `FAIL the "${STORE_PUBLISH_ENVIRONMENT}" environment does not exist in ${repo}.`,
        '     GitHub creates a referenced environment with NO protection rules, so this job would have run',
        '     unapproved while looking gated. Creating it is the owner\'s act.',
      ],
    };
  }
  if (!res.ok) {
    return { ok: false, lines: [`FAIL HTTP ${res.status} from ${envUrl}. A gate that cannot be read has not been shown to exist.`] };
  }
  const body = await res.json().catch(() => ({}));
  const rules = Array.isArray(body.protection_rules) ? body.protection_rules : [];
  const reviewerRule = rules.find((r) => Array.isArray(r?.reviewers) && r.reviewers.length > 0);
  if (!reviewerRule) {
    return {
      ok: false,
      lines: [
        `FAIL the "${STORE_PUBLISH_ENVIRONMENT}" environment exists in ${repo} and carries NO required reviewer.`,
        `     protection_rules = ${JSON.stringify(rules)}`,
        '     An environment with no rules pauses nothing: the job runs the instant it is dispatched.',
      ],
    };
  }
  const bypass = body.can_admins_bypass !== false;
  return {
    ok: true,
    lines: [
      `ok   "${STORE_PUBLISH_ENVIRONMENT}" carries ${reviewerRule.reviewers.length} required reviewer(s)` +
        (bypass
          ? '; ⚠️ can_admins_bypass is true, so reaching this line does NOT prove one of them approved.'
          : ' and can_admins_bypass is false, so this job reached this line through an approval.'),
    ],
  };
}
