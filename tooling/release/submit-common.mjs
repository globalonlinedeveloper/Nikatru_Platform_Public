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
// `appOf(apps, rel)` is the one reading of `--app`, which every submit script
// requires (O-STORE-RECORDS-ARE-ONE-PER-CHANNEL, 9b).
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
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
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

  /**
   * The app this run submits: `--app`, REQUIRED, and one of `apps` (the parsed
   * catalog). ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): every store id is per
   * app now (apps/<id>/app.yaml `stores`), so a run with no `--app` has no record
   * to read. The fallback to the catalog's first entry is gone: it answered "which
   * app" by position, and a second app dispatched without the flag would have been
   * graded, and submitted, as the first. No `--app` is COVERAGE LOST (2); an app
   * the catalog does not list is a refused invocation (1).
   */
  function appOf(apps, appsRel) {
    const appId = opt('app');
    if (appId === null || appId.startsWith('--')) {
      coverageLost([
        `--app is required: ${name} submits ONE app, and there is no default.`,
        `Known: ${apps.map((a) => a.slug).join(', ')}. Each app's store record lives in apps/<id>/app.yaml \`stores\`,`,
        'so a run that does not say which app has no record to read.',
      ]);
    }
    const app = apps.find((a) => a.slug === appId);
    if (!app) die([`FAIL no app "${appId}" in ${appsRel}.`, `     Known: ${apps.map((a) => a.slug).join(', ')}`]);
    return app;
  }

  return { argv, flag, opt, root, ok, step, abs, read, coverageLost, die, appOf };
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

// ─────────────────────────────────────────────────────────────────────────────
// THE ChannelSubmitter CONTRACT — one shape every store submitter exports.
//
// ⏱ ADDED 2026-10-01 (port-channels, O-CHANNELS-HAVE-NO-SUBMIT-CONTRACT). Each
// store had its own submit script and each script its own shape: four here,
// three extension publishers, and a runbook for apps.gov.in. No test ran every
// one of them dry, so "adding a store" meant reading all of them to learn what
// a submitter is. The answer is now this block, and tooling/ports/channels.json
// is the port registry that names one adapter per store channel:
//
//   { channel,                                   a tooling/channel-register.json row id
//     validate(record, { root }) → findings,     pure: the listing record against its contract
//     plan(artifact, { dryRun: true }) → steps,  pure and deterministic: what `upload` WOULD do
//     upload(artifact, { dryRun: false, … }),    the real path — the script's own CLI, every gate kept
//     status({ root }) → { served, submittable, account, asOf } }   read from the register, never the store
//
// 🔴 `plan` NEVER CALLS A WRITE API, AND NEVER CALLS ANY API. It describes the
// calls and does not make them; `submitterConformance` below runs it under a
// fetch stub and a child_process stub and refuses a single call. It throws
// unless `dryRun` is literally `true`, so a caller that forgot the flag gets an
// error rather than a plan it might mistake for a run.
//
// 🔴 `upload` IS THE SCRIPT ITSELF, NOT A SECOND IMPLEMENTATION. It spawns the
// submit script's own `--submit` path, so the publish environment, the typed
// confirm word and every PG-n gate stay in exactly one place. It refuses unless
// `dryRun` is literally `false`. Nothing in this repository's tests calls it.
//
// ⚠️ ONE SURFACE PER PLAN (TRAPS stores-07): once the Microsoft Store API has
// created a submission, editing that submission in Partner Center burns it. So a
// plan's WRITE steps all speak one surface — the API (or a CLI over it) or the
// console, never both — and the conformance runner refuses a plan that mixes them.
// ─────────────────────────────────────────────────────────────────────────────

const requireBuiltin = createRequire(import.meta.url);

/** The repository this file sits in. Every contract read defaults to it; tests pass `root`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The four methods, in the order the contract lists them. */
export const SUBMITTER_METHODS = Object.freeze(['validate', 'plan', 'upload', 'status']);

/** What a plan step may speak. `api` and `cli` reach the store programmatically,
 *  `console` is a human in the store's web console, `local` touches only this machine. */
export const PLAN_SURFACES = Object.freeze(['api', 'cli', 'console', 'local']);

/** The register a submitter's row is read from. */
export const CHANNEL_REGISTER = 'tooling/channel-register.json';

/** Why a ChannelSubmitter fails the shape: [] when it has every member. Never throws,
 *  so a submitter missing `plan` is a finding a test can print, not an import error. */
export function submitterProblems(s) {
  if (s === null || typeof s !== 'object') return [`is ${s === null ? 'null' : typeof s}, not a ChannelSubmitter object`];
  const out = [];
  if (typeof s.channel !== 'string' || s.channel.trim() === '') out.push('names no `channel` (a tooling/channel-register.json row id)');
  for (const m of SUBMITTER_METHODS) if (typeof s[m] !== 'function') out.push(`has no \`${m}\` function`);
  return out;
}

/** The contract's one declaration: its members and its shape check. Named in
 *  tooling/ports/channels.json `interface`. */
export const ChannelSubmitter = Object.freeze({ methods: SUBMITTER_METHODS, problemsOf: submitterProblems });

/** True when the module at `metaUrl` is the process entry point. Paths are compared
 *  after realpath, so a symlinked or differently-cased invocation still runs the CLI
 *  rather than silently doing nothing and exiting 0. */
export function invokedAsScript(metaUrl, argv1 = process.argv[1]) {
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(resolve(argv1)) === real(fileURLToPath(metaUrl));
}

/** The register and the channel's row. Throws when either is missing: a contract
 *  read with no row has nothing to answer from. */
export function channelRowOf(channelId, root = REPO_ROOT) {
  const register = JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8'));
  const row = (register.channels ?? []).find((c) => c?.id === channelId);
  if (!row) throw new Error(`${CHANNEL_REGISTER} has no channel "${channelId}"`);
  return { register, row };
}

/** A limit block (`maxChars` / `maxLines`) as { file: max }, dropping `_why` keys
 *  and any entry without a sourced number — the register refuses an unsourced max. */
const limitsOf = (block) =>
  Object.fromEntries(
    Object.entries(block ?? {})
      .filter(([k, v]) => !k.startsWith('_') && Number.isInteger(v?.max) && typeof v?.source === 'string')
      .map(([k, v]) => [k, v.max]),
  );

/**
 * The listing contract a channel's record is validated against. An APP row
 * reads `storeMetadataContract` (requiredFiles + its perChannel additionalFiles
 * and sourced limits); an EXTENSION row reads contracts/store/vocabulary.js,
 * the one declaration extensions/scripts/check-store-metadata.mjs also reads —
 * the per-store files plus the `_shared` ones, flattened into one record.
 *
 * ⚠️ The vocabulary is PASSED IN, never imported here: this file is the preamble
 * of every submit script, and the tests that walk a script in a copied tree copy
 * its imports by hand. An import here that only extension rows use would break
 * every one of those copies; the extension publishers import it themselves.
 */
export function listingContractOf(channelId, root = REPO_ROOT, vocabulary = null) {
  const { register, row } = channelRowOf(channelId, root);
  const contract = register.storeMetadataContract ?? {};
  if (row.surface === 'extension') {
    if (vocabulary === null) throw new Error(`${channelId} is an extension row; its listing contract is contracts/store/vocabulary.js, and none was passed`);
    return {
      required: [...vocabulary.extensionPerStoreListingFiles(), ...vocabulary.extensionSharedListingFiles()],
      urlFiles: vocabulary.urlListingFiles(),
      maxChars: {},
      maxLines: {},
    };
  }
  const per = contract.perChannel?.[channelId] ?? {};
  const required = [...(Array.isArray(contract.requiredFiles) ? contract.requiredFiles : []), ...(per.additionalFiles ?? [])];
  return { required, urlFiles: contract.urlFiles ?? [], maxChars: limitsOf(per.maxChars), maxLines: limitsOf(per.maxLines) };
}

/**
 * The findings for a listing record `{ fields: { '<file>': '<text>' } }` against a
 * contract from `listingContractOf`. Each finding is `{ field, message }`; [] is
 * a record the store would accept as far as this repository can tell. A required
 * list of zero is itself a finding: it would accept anything.
 */
export function listingFindings(record, contract) {
  const out = [];
  const fields = record?.fields;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return [{ field: null, message: 'the record carries no `fields` object' }];
  if (!Array.isArray(contract?.required) || contract.required.length === 0) return [{ field: null, message: 'the listing contract names no required field, so it would accept anything' }];
  for (const f of contract.required) {
    const v = fields[f];
    if (typeof v !== 'string' || v.trim() === '') out.push({ field: f, message: `${f} is required by the listing contract and is ${v === undefined ? 'missing' : 'empty'}` });
  }
  for (const f of contract.urlFiles ?? []) {
    const v = fields[f];
    if (typeof v === 'string' && v.trim() !== '' && !/^https:\/\/\S+$/.test(v.trim())) out.push({ field: f, message: `${f} must be one https:// URL` });
  }
  for (const [f, max] of Object.entries(contract.maxChars ?? {})) {
    const v = fields[f];
    if (typeof v === 'string' && [...v.trim()].length > max) out.push({ field: f, message: `${f} is ${[...v.trim()].length} characters; the store's limit is ${max}` });
  }
  for (const [f, max] of Object.entries(contract.maxLines ?? {})) {
    const v = fields[f];
    const n = typeof v === 'string' ? v.split('\n').filter((l) => l.trim() !== '').length : 0;
    if (n > max) out.push({ field: f, message: `${f} has ${n} entries; the store's limit is ${max}` });
  }
  return out;
}

/** The status every submitter answers from its row: no store is asked. */
export function channelStatus(channelId, root = REPO_ROOT) {
  const { row } = channelRowOf(channelId, root);
  return {
    channel: channelId,
    served: row.served === true,
    submittable: row.submittable === true,
    account: row.accountStatus?.status ?? null,
    asOf: row.accountStatus?.asOf ?? null,
  };
}

/**
 * Build a ChannelSubmitter from the pieces a store differs in. `steps(artifact)`
 * returns the plan's steps as `{ does, surface, call, writes }`; `extraFindings`
 * adds the store's own rules to the listing contract; `uploadArgv(artifact, opts)`
 * is the argv of the script's own `--submit` path, run from `cwd` (repo-relative).
 * An extension channel passes `vocabulary` (contracts/store/vocabulary.js).
 */
export function storeSubmitter({ channel, script, cwd = '.', steps, extraFindings = () => [], uploadArgv, vocabulary = null }) {
  return Object.freeze({
    channel,
    validate(record, { root = REPO_ROOT } = {}) {
      return [...listingFindings(record, listingContractOf(channel, root, vocabulary)), ...extraFindings(record)];
    },
    plan(artifact, opts) {
      if (opts?.dryRun !== true) throw new Error(`${channel}: plan() is dry-run only — pass { dryRun: true }. It describes the upload and never performs it.`);
      return steps(artifact).map((s, i) => Object.freeze({ step: i + 1, ...s }));
    },
    upload(artifact, opts) {
      if (opts?.dryRun !== false) throw new Error(`${channel}: upload() runs ${script} --submit and needs { dryRun: false }. Use plan() to see what it would do.`);
      return spawnSync(process.execPath, [join(REPO_ROOT, script), ...uploadArgv(artifact, opts)], { cwd: join(REPO_ROOT, cwd), stdio: 'inherit' });
    },
    status({ root = REPO_ROOT } = {}) {
      return channelStatus(channel, root);
    },
  });
}

/**
 * THE CONFORMANCE RUNNER (tooling/ports/channels.json `conformance.suite`). Runs
 * one submitter, dry, against its recorded fixture `{ good, artifact }` and
 * returns every finding as a sentence; [] is conformant. It asks that:
 *   1. the shape is whole (submitterProblems);
 *   2. `validate` passes the good record;
 *   3. `validate` refuses the record with each required field removed, NAMING it;
 *   4. `plan` is non-empty, well-formed, one write surface, and identical twice;
 *   5. `plan` without `{ dryRun: true }` throws;
 *   6. `status` answers for the submitter's own channel;
 *   7. none of the above made a network call or spawned a process — a fetch stub
 *      and a child_process stub count them, and any count above zero is a finding.
 */
export async function submitterConformance(submitter, fixture, { root = REPO_ROOT, stubs } = {}) {
  const shape = submitterProblems(submitter);
  if (shape.length) return shape.map((p) => `the submitter ${p}`);
  const out = [];
  const ch = submitter.channel;
  const calls = await underNetworkStubs(stubs, async () => {
    const good = fixture?.good;
    const okFindings = await submitter.validate(good, { root });
    if (!Array.isArray(okFindings)) out.push(`${ch}: validate() returned ${typeof okFindings}, not a findings array`);
    else if (okFindings.length) out.push(`${ch}: validate() refused the good fixture: ${okFindings.map((f) => f.message).join('; ')}`);
    const required = listingContractOf(ch, root, await import('../../contracts/store/vocabulary.js')).required;
    if (required.length === 0) out.push(`${ch}: the listing contract names no required field, so the refusal limb would check nothing`);
    for (const f of required) {
      const fields = { ...(good?.fields ?? {}) };
      delete fields[f];
      const found = await submitter.validate({ ...good, fields }, { root });
      if (!Array.isArray(found) || !found.some((x) => x?.field === f)) out.push(`${ch}: validate() accepted a record with no ${f}, which the listing contract requires`);
    }
    const p1 = await submitter.plan(fixture?.artifact, { dryRun: true });
    const p2 = await submitter.plan(fixture?.artifact, { dryRun: true });
    if (!Array.isArray(p1) || p1.length === 0) out.push(`${ch}: plan() returned no steps`);
    else {
      if (JSON.stringify(p1) !== JSON.stringify(p2)) out.push(`${ch}: plan() is not deterministic — two dry runs over one artifact differ`);
      for (const s of p1) {
        if (typeof s?.does !== 'string' || s.does.trim() === '') out.push(`${ch}: plan step ${s?.step} says nothing about what it does`);
        if (!PLAN_SURFACES.includes(s?.surface)) out.push(`${ch}: plan step ${s?.step} has surface ${JSON.stringify(s?.surface)}, not one of ${PLAN_SURFACES.join(', ')}`);
        if (typeof s?.writes !== 'boolean') out.push(`${ch}: plan step ${s?.step} does not say whether it writes`);
      }
      const writeSurfaces = new Set(p1.filter((s) => s?.writes === true && s.surface !== 'local').map((s) => (s.surface === 'cli' ? 'api' : s.surface)));
      if (writeSurfaces.size > 1) out.push(`${ch}: plan() writes through both the API and the console (stores-07: a console edit of an API-created submission burns it)`);
    }
    let threw = false;
    try {
      await submitter.plan(fixture?.artifact, {});
    } catch {
      threw = true;
    }
    if (!threw) out.push(`${ch}: plan() ran without { dryRun: true }; it must refuse`);
    const st = await submitter.status({ root });
    if (st?.channel !== ch) out.push(`${ch}: status() answered for ${JSON.stringify(st?.channel)}`);
  });
  if (calls.fetch) out.push(`${ch}: ${calls.fetch} network call(s) during validate/plan/status — the dry-run contract allows none`);
  if (calls.spawn) out.push(`${ch}: ${calls.spawn} process spawn(s) during validate/plan/status — the dry-run contract allows none`);
  return out;
}

/** Run `fn` with `fetch` and every child_process launcher replaced by counting
 *  stubs that refuse; restore them after. `stubs` lets a caller pass its own
 *  { install, restore, counts } (the tests do, to prove the count is read). */
async function underNetworkStubs(stubs, fn) {
  const s = stubs ?? defaultStubs();
  s.install();
  try {
    await fn();
  } finally {
    s.restore();
  }
  return s.counts;
}

function defaultStubs() {
  const counts = { fetch: 0, spawn: 0 };
  const cp = requireBuiltin('node:child_process');
  const LAUNCHERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  let saved = null;
  return {
    counts,
    install() {
      saved = { fetch: globalThis.fetch, cp: Object.fromEntries(LAUNCHERS.map((k) => [k, cp[k]])) };
      globalThis.fetch = async () => {
        counts.fetch++;
        throw new Error('network refused: the dry-run contract makes no call');
      };
      for (const k of LAUNCHERS) {
        cp[k] = () => {
          counts.spawn++;
          throw new Error('spawn refused: the dry-run contract launches nothing');
        };
      }
      // An ESM `import { spawnSync } from 'node:child_process'` is a live binding to
      // the builtin's exports, refreshed only by this call — without it the stub
      // would count the CJS callers and miss every module in this tree.
      syncBuiltinESMExports();
    },
    restore() {
      globalThis.fetch = saved.fetch;
      Object.assign(cp, saved.cp);
      syncBuiltinESMExports();
    },
  };
}
