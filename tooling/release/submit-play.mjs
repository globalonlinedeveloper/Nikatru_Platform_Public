#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// submit-play.mjs — the repeatable submission path for the Google Play channel.
//
// [pipeline D-10] "For each store channel, the path from signed artifact to
//                  submitted release is scripted and repeatable … so submission
//                  #2 costs minutes, not archaeology."
//
// D-10's replacement acceptance has three re-checkable limbs. This file is
// limb (i) for `android-play` — "a submission script exists AND resolves to a
// step in a workflow, parsed not grepped". Limb (ii) is
// company/runbooks/store-submission-android.md. Limb (iii) — a submission record
// in the [10]D-9 ledger — needs a real submission and stays UNSATISFIED; it is
// the only one of the three that can prove the path was walked rather than
// merely written, and nothing here pretends otherwise.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the built .aab, the package name,
//              the signing posture and the service-account configuration, and
//              exits 0 WITHOUT one byte leaving the machine. This is the mode
//              CI runs on every push.
// `--submit`   performs the real Google Play Developer API edit lifecycle —
//              insert an edit, upload the bundle, assign it to a track, validate,
//              commit — behind the publish gate described below. Every endpoint,
//              payload shape and auth detail it uses was FETCHED FROM A PRIMARY
//              SOURCE on 2026-08-09; the URLs are in `PRIMARY_SOURCES` below and
//              each call site cites the one it came from.
//
// ── 🔴 THE `UNVERIFIED` REFUSAL THAT USED TO LIVE HERE IS GONE, AND WHY ──────
// From 2026-08-01 to 2026-08-09 `--submit` refused with a list of seven
// `UNVERIFIED:` facts about a remote API, on the stated ground that "an invented
// endpoint does not fail here, on a laptop — it fails against a LIVE Play
// account, mid-submission". That was the correct call at the time and it is not
// how you retire it: the refusal dies because THE VERIFICATION HAPPENED, not
// because somebody deleted it. Each of the seven is answered by a URL in
// `PRIMARY_SOURCES`, and the one that could NOT be settled from a primary source
// — which literal string names the internal testing track — is not guessed
// either. It is DISCOVERED from the API at submit time (`edits.tracks.list`),
// and the script refuses rather than picking when the answer is not in the list.
//
// ── ⚠️ THE HEADER THAT USED TO SIT HERE WAS THREE STALE BLOCKERS ─────────────
// It said, verbatim: "there is no publisher account (OWNER_QUEUE A-3), no upload
// key, and — for a personal account created after 2023-11-13 — a 12-tester ×
// 14-continuous-day closed test standing between any build and production."
// ALL THREE WERE FALSE, and tooling/channel-register.json's own android-play row
// said so:
//   · the Play **ORGANIZATION** account is `accountStatus.status: "verified"`,
//     asOf 2026-08-04, and the row's note records OWNER_QUEUE A-3 **CLOSED**;
//   · the upload key **exists** and its certificate SHA-256 is **pinned** in the
//     row (`signing.uploadCertificate.sha256`, asOf 2026-08-04), which is what
//     tooling/ci/assert-artifact-signed.mjs compares a built bundle against;
//   · the 12-tester / 14-day window **never applied to this account**. Google's
//     rule carries an affirmative scope — "Developers with personal accounts
//     created after November 13, 2023" — and a rule scoped to personal accounts
//     does not reach an Organization one. The register calls that reasoning out
//     explicitly because it held all three positions in turn.
// Same failure class as everything else in this tree: a note that was true when
// written, that nothing recomputes, in a header a reader takes as current.
//
// WHAT IS ACTUALLY OUTSTANDING, as of 2026-08-09: the register's android-play
// row is still `served: false` — deliberately, per its own note — and limb (iii)
// (a real submission in the [10]D-9 ledger) has never happened. `--submit` is
// the path that would produce it, and only an owner-approved dispatch can.
//
// ── THE PUBLISH GATE [ADR 031:117-124] ───────────────────────────────────────
// ADR 031 puts "promoting any release to the production track" in class **A**
// (irreversible external state, owner-only, per instance) and explicitly does
// NOT gate "testing-track uploads". It also records the enforcement mechanism as
// UNBUILT, names it — "a GitHub environment with a required reviewer" — and says
// to build it WITH the upload path rather than after. That is what `PG-1`…`PG-6`
// below are. See .github/workflows/submit-play.yml for the other half.
//
// Usage:
//   node tooling/release/submit-play.mjs --dry-run [--app <id>]
//   node tooling/release/submit-play.mjs --dry-run --allow-missing-artifact
//   node tooling/release/submit-play.mjs --submit --app <id> --confirm SUBMIT-TO-PLAY
//                                        [--track <id>] [--status draft|completed]
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable (or the submission committed).
//       1 = it is not, or a gate refused, or the API did.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, createSign } from 'node:crypto';
import { readGradleApplicationId } from '../ci/read-identity.mjs';
import { parseWorkflow } from '../ci/workflow-scan.mjs';

const CHANNEL_ID = 'android-play';
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY SOURCES — every remote fact `--submit` depends on, and where it came
// from. FETCHED 2026-08-09. This block is not decoration: the refusal it
// replaced demanded exactly this, in exactly this form ("Source them (URL +
// date, the way the D-5 limits table does), then write the calls"), and a fact
// whose URL is not written down here is a fact this script may not act on.
//
// ⚠️ TWO OF THESE RECORD A CONTRADICTION RATHER THAN AN ANSWER. They are kept in
// full because an unresolved source is information and a smoothed-over one is a
// guess wearing a citation. See `TRACK_PUBLICNESS` and `AAB_MEDIA_TYPE`.
// ─────────────────────────────────────────────────────────────────────────────
const PRIMARY_SOURCES = Object.freeze({
  editsInsert: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits/insert',
  editsResource: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits',
  editsGuide: 'https://developers.google.com/android-publisher/edits',
  bundlesUpload: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload',
  bundleResource: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles',
  uploadProtocol: 'https://developers.google.com/android-publisher/upload',
  tracksUpdate: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/update',
  tracksResource: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks',
  tracksList: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/list',
  tracksGuide: 'https://developers.google.com/android-publisher/tracks',
  editsValidate: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits/validate',
  editsCommit: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit',
  editsDelete: 'https://developers.google.com/android-publisher/api-ref/rest/v3/edits/delete',
  serviceAccountGrant: 'https://developers.google.com/identity/protocols/oauth2/service-account',
  githubEnvironments:
    'https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments',
  githubEnvironmentsApi: 'https://docs.github.com/en/rest/deployments/environments',
});

/** `editsInsert`, verbatim: "POST https://androidpublisher.googleapis.com/
 *  androidpublisher/v3/applications/{packageName}/edits". Every other endpoint
 *  on the resource hangs off the same origin. */
const PLAY_API_ORIGIN = 'https://androidpublisher.googleapis.com';
/** `serviceAccountGrant`, verbatim: the token endpoint is
 *  "https://oauth2.googleapis.com/token", and the `aud` claim "is always"
 *  that value — so `aud` is pinned to this constant and is NEVER taken from the
 *  override below, which would let a test seam change what we sign for. */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Named identically on all ten androidpublisher pages fetched:
 *  "https://www.googleapis.com/auth/androidpublisher". */
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const GITHUB_API_ORIGIN = 'https://api.github.com';

/** 🔴 THE ONE FACT NO PRIMARY SOURCE SETTLED, RECORDED RATHER THAN GUESSED.
 *  `tracksGuide` names four identifiers — "alpha", "beta", "production", and
 *  **"qa"**, which it calls "The internal testing track" — and adds that "Closed
 *  testing tracks are created manually and they have custom names", with form
 *  factor prefixes producing e.g. "wear:production", "wear:beta", "wear:qa".
 *  The string "internal" appears on that page as a DESCRIPTION and never as an
 *  identifier. Widely-deployed third-party tooling nevertheless uses `internal`.
 *
 *  Both are therefore listed at rank 0 — they are two names for THE SAME track
 *  and an app can only have one of them, so ranking both is not ambiguity, it is
 *  refusing to bet on which spelling a given account returns. The script does
 *  not pick from this table in the abstract: it intersects it with what
 *  `edits.tracks.list` says the app ACTUALLY has (`tracksList`, response field
 *  "All tracks (including tracks with no releases)") and takes the lowest rank
 *  present. A custom closed-test name is UNRANKED on purpose — Google publishes
 *  no ordering for it, so the script refuses and makes a human name the track
 *  rather than inventing a position for it. */
const TRACK_PUBLICNESS = Object.freeze({ qa: 0, internal: 0, alpha: 2, beta: 3, production: 4 });

/** `uploadProtocol` says Content-Type must be "set to one of the method's
 *  accepted media data types"; `bundlesUpload`'s rendering did not enumerate an
 *  accepted-types table, so the generic binary type is used and the gap is
 *  stated rather than papered over. If Play ever rejects on media type this is
 *  the line to revisit, and the error will name it. */
const AAB_MEDIA_TYPE = 'application/octet-stream';

/** `editsCommit` query parameter, verbatim options: "CANCEL_IN_REVIEW_AND_SUBMIT
 *  — cancel that review first and then send all the changes for publishing" and
 *  "ERROR_IF_IN_REVIEW — Returns error if changes are in review; won't
 *  invalidate the edit". The fail-closed one is chosen: cancelling a review a
 *  human started is not an act this script gets to take on its own, and the
 *  error leaves the edit intact so nothing is lost by refusing. */
const CHANGES_IN_REVIEW_BEHAVIOR = 'ERROR_IF_IN_REVIEW';

/** `tracksResource` Release.status enum, verbatim: "draft — The release's APKs
 *  are not being served to users", "inProgress — … served to a fraction of
 *  users, determined by 'userFraction'", "halted", "completed — The release will
 *  have no further changes". Only the two that involve NO staged rollout are
 *  offered: `userFraction` "Can only be set when status is 'inProgress' or
 *  'halted'", and ADR 031 class A names "changing a staged rollout percentage"
 *  as owner-only. A flag this script does not have cannot be set by accident. */
const ALLOWED_RELEASE_STATUS = Object.freeze(['draft', 'completed']);

const CONFIRM_TOKEN = 'SUBMIT-TO-PLAY';
const PUBLISH_ENVIRONMENT = 'store-publish';
const POSTURE_ENV = 'ANDROID_SIGNING_POSTURE';
const RELEASE_SIGNED = 'release-signed';
const SIGNATURE_GUARD = 'assert-artifact-signed.mjs';

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const DRY_RUN = flag('dry-run');
const SUBMIT = flag('submit');
const ALLOW_MISSING_ARTIFACT = flag('allow-missing-artifact');
const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const step = (m) => console.log(`→    ${m}`);
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null);

/** The scan cannot continue and reporting "clean" would be a lie about nothing. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nsubmit-play: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nsubmit-play: FAILED');
  process.exit(1);
}

if (DRY_RUN === SUBMIT) {
  die([
    'FAIL exactly one of --dry-run and --submit is required.',
    '     Defaulting either way is how a dry run becomes a submission (or a submission',
    '     silently becomes a no-op). The mode has to be said out loud.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PUBLISH GATE — PG-1 … PG-6, ALL BEFORE ANY OTHER WORK
//
// 🔴 AT THE TOP FOR THE SAME REASON THE OLD REFUSAL WAS: there must be no path
// on which a submission gets partway. What changed is that these are gates a
// correctly-authorised run PASSES, rather than a stop nothing could clear.
//
// PG-1 … PG-4 are pure local reads. PG-5 is one authenticated GET against
// GitHub — a read, never gated (ADR 031: "Reading is never gated") — and it is
// here rather than later because the gate's ABSENCE must cost nothing but a
// second. PG-6 is policy about the requested track.
// ─────────────────────────────────────────────────────────────────────────────

/** A test seam that can only ever point at this machine.
 *
 *  🔴 WHY LOOPBACK-ONLY AND NOT "SET IT TO WHATEVER YOU LIKE". The value this
 *  script sends to `PLAY_API_ORIGIN` includes a bearer token minted from a
 *  PRIVATE KEY and the whole signed bundle. An unconstrained base-URL override
 *  is therefore a one-environment-variable exfiltration path for both, in a
 *  process that already legitimately holds them — the cheapest possible supply
 *  chain attack on this repository. Constrained to loopback it is a test seam
 *  and nothing else, and the constraint is enforced here rather than documented
 *  in a comment somebody can not-read. */
function loopbackOr(envName, canonical) {
  const raw = (process.env[envName] ?? '').trim().replace(/\/+$/, '');
  if (raw === '' || raw === canonical) return canonical;
  let u;
  try {
    u = new URL(raw);
  } catch {
    die([`FAIL ${envName} is set and is not a URL: ${JSON.stringify(raw)}.`]);
  }
  const loopback = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  if (!loopback) {
    die([
      `FAIL ${envName} points at ${u.origin}, which is neither ${canonical} nor loopback.`,
      '     This variable exists so the tests can drive the real transport against a local server.',
      '     An unconstrained value would let one environment variable send a service-account bearer',
      '     token and a signed release bundle to any host on the internet, from a process that is',
      '     supposed to be holding them. Loopback or the real value — there is no third option.',
    ]);
  }
  console.log(`⬜   ${envName} override in effect: ${raw} — this is a LOOPBACK TEST SEAM, not the real service.`);
  return raw;
}

let PLAY_BASE = PLAY_API_ORIGIN;
let TOKEN_URL = GOOGLE_TOKEN_URL;
let GITHUB_BASE = GITHUB_API_ORIGIN;

if (SUBMIT) {
  PLAY_BASE = loopbackOr('PLAY_API_BASE_URL', PLAY_API_ORIGIN);
  TOKEN_URL = loopbackOr('PLAY_OAUTH_TOKEN_URL', GOOGLE_TOKEN_URL);
  GITHUB_BASE = loopbackOr('GITHUB_API_URL', GITHUB_API_ORIGIN);

  // ── PG-1 · the confirm token ───────────────────────────────────────────────
  // A dispatch input, mirrored here. The workflow ALSO guards the job with an
  // `if:` on the same input, and that redundancy is deliberate: the `if:` is one
  // deletable YAML line, and this repository's recorded failure mode is exactly
  // "a correct mechanism that nothing switched on". Whichever half survives an
  // edit, the other still refuses.
  const confirm = opt('confirm', '');
  if (confirm !== CONFIRM_TOKEN) {
    die([
      `FAIL --submit requires --confirm ${CONFIRM_TOKEN}; got ${JSON.stringify(confirm ?? '')}.`,
      '     This is the dispatch input a human types. It is not a formality: --submit uploads a bundle',
      '     to a live Play account and commits an edit, and Play binds an upload certificate at the',
      '     FIRST upload (a one-way door, ADR 031). A mode flag alone is one typo away from that.',
      `     .github/workflows/submit-play.yml passes it through from the \`confirm\` dispatch input.`,
    ]);
  }

  // ── PG-2 · you cannot submit an artifact you declined to look for ──────────
  if (ALLOW_MISSING_ARTIFACT) {
    die([
      'FAIL --allow-missing-artifact is a DRY-RUN flag and --submit refuses it.',
      '     It exists so the listing can be validated with no bundle on disk. Combined with --submit it',
      '     would mean "upload the bundle, and never mind whether there is one" — which resolves to a',
      '     half-created edit against a live account. The two flags are mutually exclusive by design.',
    ]);
  }

  // ── PG-3 · the lane ────────────────────────────────────────────────────────
  // 🔴 --submit REFUSES OUTSIDE GITHUB ACTIONS, and that is the gate, not a
  // limitation. The reviewer approval ADR 031 requires exists in exactly one
  // place — a GitHub environment on a job — so a submission that runs anywhere
  // else has, by construction, not passed it. A laptop run would be the whole
  // control bypassed by `cd tooling/release`.
  if ((process.env.GITHUB_ACTIONS ?? '') !== 'true' || (process.env.GITHUB_REPOSITORY ?? '').trim() === '') {
    die([
      'FAIL --submit runs only inside GitHub Actions (GITHUB_ACTIONS=true and GITHUB_REPOSITORY set).',
      `     [ADR 031:117-124] the publish gate is a GitHub environment ("${PUBLISH_ENVIRONMENT}") carrying a`,
      '     REQUIRED REVIEWER. That approval is recorded in a run\'s history and exists nowhere else, so a',
      '     submission from a laptop is not "the same thing without the paperwork" — it is the control',
      '     removed. Dispatch .github/workflows/submit-play.yml instead.',
    ]);
  }

  // ── PG-4 · the lane is SHAPED like a gated lane, read from its own YAML ────
  // 🔴 DERIVED, NEVER DECLARED — the same argument submit-play.yml already makes
  // about signing ("NOTHING BELOW SAYS 'signing is required here' AND THAT IS
  // THE POINT"). Two properties are read out of the workflow that invokes this
  // script, so removing either FAILS the submission instead of quietly widening
  // it:
  //   (a) the job carries `environment:` — without it GitHub has no gate to
  //       apply, and the reviewer never sees the run;
  //   (b) the SAME job runs assert-artifact-signed.mjs BEFORE the submit step.
  //       That guard reads the signature out of the .aab with keytool and
  //       compares it to the register's pinned certificate. It needs a JDK, so
  //       it cannot live in this script — but "did the lane read the artifact's
  //       signature" is a question this script can answer from the YAML, and
  //       must, because Play fixes the upload certificate at the first upload.
  {
    const registerPeek = read(REGISTER);
    let subWorkflowRel = '.github/workflows/submit-play.yml';
    try {
      const r = JSON.parse(registerPeek ?? '{}');
      const row = (r.channels ?? []).find((c) => c.id === CHANNEL_ID);
      if (typeof row?.submission?.workflow === 'string') subWorkflowRel = row.submission.workflow;
    } catch {
      /* the register is parsed properly, with its own COVERAGE LOST, below */
    }
    const wf = parseWorkflow(ROOT, subWorkflowRel);
    if (wf === null) {
      die([
        `FAIL the submission workflow ${subWorkflowRel} does not exist under ${ROOT}.`,
        '     PG-4 reads the gate\'s shape out of it. With the file gone there is nothing to read, and a',
        '     submission whose lane cannot be inspected is one whose gate cannot be shown to exist.',
      ]);
    }
    const jobsRunningSubmit = [...wf.jobs.values()].filter((j) =>
      j.logical.some((l) => /submit-play\.mjs/.test(l.text) && /--submit\b/.test(l.text)),
    );
    if (jobsRunningSubmit.length === 0) {
      die([
        `FAIL no job in ${subWorkflowRel} invokes \`submit-play.mjs --submit\`.`,
        '     This script is running with --submit, so it was invoked by SOMETHING the workflow does not',
        '     declare. Either the lane was edited out from under the gate, or the submission is being',
        '     driven from somewhere the gate does not reach. Both are the same refusal.',
      ]);
    }
    for (const job of jobsRunningSubmit) {
      const declaresEnvironment = job.lines.some((l) => /^ {4}environment:/.test(l.text));
      if (!declaresEnvironment) {
        die([
          `FAIL ${subWorkflowRel} job "${job.name}" runs \`--submit\` and declares no \`environment:\`.`,
          `     [ADR 031:117-124] the gate IS the environment. A job without one runs the moment it is`,
          '     dispatched, with no approval and no record of one — which is the posture this whole',
          '     increment exists to end.',
        ]);
      }
      const submitAt = job.logical.find((l) => /submit-play\.mjs/.test(l.text) && /--submit\b/.test(l.text));
      const signatureAt = job.logical.find((l) => l.text.includes(SIGNATURE_GUARD));
      if (!signatureAt) {
        die([
          `FAIL ${subWorkflowRel} job "${job.name}" uploads a bundle and never runs ${SIGNATURE_GUARD}.`,
          '     That guard is the only thing in this repository that reads the signature out of the built',
          '     .aab and compares it to the pinned upload certificate. Play accepts a given upload key',
          '     EXACTLY ONCE and binds it at the first upload, so an unread signature is a one-way door',
          '     taken blind. A configuration check cannot substitute: the configuration was already',
          '     correct on every run of the four weeks every .aab came out debug-signed.',
        ]);
      }
      if (signatureAt.n > submitAt.n) {
        die([
          `FAIL ${subWorkflowRel} job "${job.name}" runs ${SIGNATURE_GUARD} at line ${signatureAt.n}, AFTER the`,
          `     submit step at line ${submitAt.n}. A signature checked after the upload is a post-mortem.`,
        ]);
      }
    }
    ok(`PG-4 lane shape — ${subWorkflowRel} gates the submit job on an environment and reads the .aab signature first`);
  }

  // ── PG-5 · the environment EXISTS and carries a REQUIRED REVIEWER ──────────
  // 🔴 THIS IS THE LIMB WITHOUT WHICH `environment:` IS DECORATION, and the
  // reason is a documented GitHub behaviour, not a suspicion.
  //
  //   ${PRIMARY_SOURCES.githubEnvironments}, VERBATIM:
  //     "Running a workflow that references an environment that does not exist
  //      will create an environment with the referenced name."
  //
  // So a job that says `environment: store-publish` against a repository that
  // has no such environment does NOT fail, and does NOT wait. GitHub silently
  // creates one, and a freshly created environment has NO protection rules — so
  // the job proceeds immediately, unapproved, and the run history shows an
  // environment as if a gate had been honoured. A typo in the environment name
  // has exactly the same effect. `environment:` on its own therefore FAILS OPEN,
  // which is the precise opposite of what ADR 031 asked for.
  //
  // ⚠️ MEASURED, NOT ASSUMED. On 2026-08-09 this repository's three existing
  // environments — `platform`, `subly-api`, `subly-web`, all auto-created by
  // deploy lanes — each returned `"protection_rules": []`. That is the fail-open
  // state, observed, in this repo.
  //
  // The remedy is to ask the API what the environment actually carries.
  // Source: ${PRIMARY_SOURCES.githubEnvironmentsApi} — "GET /repos/{owner}/{repo}/
  // environments/{environment_name}", whose response carries `protection_rules`,
  // and "Anyone with read access to the repository can use this endpoint", which
  // is why the job's own `github.token` with `contents: read` is enough.
  //
  // 📌 THE ASSERTION IS ON A NON-EMPTY `reviewers` LIST, NOT ON A MAGIC STRING.
  // GitHub labels the rule `type: "required_reviewers"`, but that literal could
  // not be confirmed from a rendered example on the REST page, and an assertion
  // keyed to an unconfirmed string fails OPEN if the string is different. What
  // was confirmed — empirically, above — is that the fail-open state has NO
  // rules at all. So the check is: some rule must carry reviewers. That cannot
  // pass on an auto-created environment, and it does not depend on a word this
  // session could not source. The full `protection_rules` JSON is printed on
  // failure so the first run names its own fix.
  {
    const repo = process.env.GITHUB_REPOSITORY.trim();
    const ghToken = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '').trim();
    if (ghToken === '') {
      die([
        'FAIL --submit needs GITHUB_TOKEN to read the publish environment\'s protection rules.',
        `     Without it PG-5 cannot tell a gated environment from one GitHub auto-created when this`,
        '     workflow first named it, and those two look identical from inside the job. Pass',
        '     `GITHUB_TOKEN: ${{ github.token }}` on the submit step.',
      ]);
    }
    const envUrl = `${GITHUB_BASE}/repos/${repo}/environments/${PUBLISH_ENVIRONMENT}`;
    let res;
    try {
      res = await fetch(envUrl, {
        headers: {
          authorization: `Bearer ${ghToken}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'nikatru-submit-play',
        },
      });
    } catch (e) {
      die([`FAIL PG-5 could not reach ${envUrl} (${e.message}). A gate that cannot be read has not been shown to exist.`]);
    }
    if (res.status === 404) {
      die([
        `FAIL the "${PUBLISH_ENVIRONMENT}" environment does not exist in ${repo}.`,
        '     [ADR 031:117-124] the publish gate IS that environment plus a required reviewer. GitHub',
        '     documents that referencing a missing environment CREATES it — with no protection rules —',
        '     so relying on `environment:` alone would have let this run publish unapproved while looking',
        '     gated. Creating it is a repo-admin act and belongs to a human; the exact commands are in the',
        `     header of .github/workflows/submit-play.yml.`,
      ]);
    }
    if (!res.ok) {
      die([`FAIL PG-5 got HTTP ${res.status} from ${envUrl}. A gate that cannot be read has not been shown to exist.`]);
    }
    const envJson = await res.json().catch(() => ({}));
    const rules = Array.isArray(envJson.protection_rules) ? envJson.protection_rules : [];
    const reviewerRule = rules.find((r) => Array.isArray(r?.reviewers) && r.reviewers.length > 0);
    if (!reviewerRule) {
      die([
        `FAIL the "${PUBLISH_ENVIRONMENT}" environment exists in ${repo} and carries NO required reviewer.`,
        `     protection_rules = ${JSON.stringify(rules)}`,
        '     An environment with no rules does not pause anything — the job runs the instant it is',
        '     dispatched. That is the state GitHub leaves behind when a workflow auto-creates an',
        '     environment, and it is indistinguishable from a real gate anywhere except here.',
      ]);
    }
    ok(
      `PG-5 publish gate — "${PUBLISH_ENVIRONMENT}" carries ${reviewerRule.reviewers.length} required reviewer(s); this job only reached this line because one of them approved it`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// the register is the single declaration everything below reads
// ─────────────────────────────────────────────────────────────────────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The channel row, the artifact format and the metadata contract all live there. With it gone',
    'every validation below would range over undefined and pass by having nothing to check.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}

const channel = (register.channels ?? []).find((c) => c.id === CHANNEL_ID);
if (!channel) {
  coverageLost([
    `${REGISTER} declares no "${CHANNEL_ID}" channel.`,
    'This script exists to submit to exactly that row. Without it there is no artifact format, no',
    'metadata directory template and no signing posture to validate.',
  ]);
}
if (channel.submittable !== true) {
  die([
    `FAIL channel "${CHANNEL_ID}" is not marked \`submittable\` in ${REGISTER}.`,
    '     A store you cannot submit to has no submission path to run.',
  ]);
}

const contract = register.storeMetadataContract;
const requiredFiles = Array.isArray(contract?.requiredFiles) ? contract.requiredFiles : [];
if (requiredFiles.length === 0) {
  coverageLost([
    `${REGISTER} declares no \`storeMetadataContract.requiredFiles\`.`,
    'The metadata validation below iterates that list. Empty, it checks every file in zero seconds',
    'and reports the listing complete — which is exactly the shape [10]D-5 exists to remove.',
  ]);
}
const extraFiles = contract?.perChannel?.[CHANNEL_ID]?.additionalFiles ?? [];
const maxLines = contract?.perChannel?.[CHANNEL_ID]?.maxLines ?? {};
const maxChars = contract?.perChannel?.[CHANNEL_ID]?.maxChars ?? {};
const urlFiles = new Set(contract?.urlFiles ?? []);

/** Unicode CODE POINTS of the trimmed text — the same counting rule
 *  assert-store-metadata.mjs uses, and for the same reason (see
 *  storeMetadataContract._limitsWhy). `.length` is UTF-16 units and would count
 *  one emoji as two, rejecting copy that is inside Google's published limit. */
const charCount = (text) => [...text.trim()].length;

// ── which app ────────────────────────────────────────────────────────────────
const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — there is no app to submit.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);

const appId = opt('app') ?? apps[0]?.slug;
const app = apps.find((a) => a.slug === appId);
if (!app) {
  die([`FAIL no app "${appId}" in ${APPS}.`, `     Known: ${apps.map((a) => a.slug).join(', ')}`]);
}

console.log(`── Google Play submission path · app "${app.slug}" · channel "${CHANNEL_ID}" ──`);
console.log(`   mode: ${DRY_RUN ? 'DRY RUN (nothing leaves this machine)' : 'SUBMIT (the real Play Developer API edit lifecycle)'}`);
console.log('');

// ── 1. the metadata tree ─────────────────────────────────────────────────────
const metaDir = String(channel.storeMetadataDir ?? '').replace('{app}', app.slug);
if (metaDir === '') {
  coverageLost([`channel "${CHANNEL_ID}" declares no \`storeMetadataDir\` — there is no listing to submit.`]);
}
if (!existsSync(abs(metaDir)) || !statSync(abs(metaDir)).isDirectory()) {
  die([
    `FAIL the store metadata tree ${metaDir} does not exist.`,
    '     [10]D-5: the listing lives in the repo and the console is a copy of it. With no tree there',
    '     is nothing to submit but whatever somebody last typed into the Play Console.',
  ]);
}

let filesChecked = 0;
let limitsChecked = 0;
for (const rel of [...requiredFiles, ...extraFiles]) {
  const p = `${metaDir}/${rel}`;
  const text = read(p);
  if (text === null) {
    problems.push(`${p} is missing. ${REGISTER}'s storeMetadataContract requires it.`);
    continue;
  }
  if (text.trim() === '') {
    problems.push(`${p} is EMPTY. An empty listing field satisfies "the file exists" and submits a blank.`);
    continue;
  }
  filesChecked++;

  if (urlFiles.has(rel)) {
    const url = text.trim();
    if (!/^https:\/\/\S+$/.test(url) || /\s/.test(url)) {
      problems.push(
        `${p} is not a single absolute https URL: ${JSON.stringify(url)}. Play requires a reachable privacy policy URL on the store listing for any app that collects personal data, and a malformed one blocks the release rather than failing review later.`,
      );
    }
  }

  // A limit with no `source` is a FAULT, not a licence to enforce it anyway —
  // an unsourced number is indistinguishable from a remembered one, and a
  // remembered one fires on CORRECT input.
  const lineLimit = maxLines[rel];
  if (lineLimit && Number.isInteger(lineLimit.max)) {
    if (typeof lineLimit.source !== 'string' || lineLimit.source.trim() === '') {
      problems.push(`${REGISTER} maxLines["${rel}"] for "${CHANNEL_ID}" declares max ${lineLimit.max} with no \`source\`.`);
    } else {
      limitsChecked++;
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      if (lines.length > lineLimit.max) {
        problems.push(`${p} has ${lines.length} entries; the limit is ${lineLimit.max}. Source: ${lineLimit.source}`);
      }
    }
  }
  const charLimit = maxChars[rel];
  if (charLimit && Number.isInteger(charLimit.max)) {
    if (typeof charLimit.source !== 'string' || charLimit.source.trim() === '') {
      problems.push(`${REGISTER} maxChars["${rel}"] for "${CHANNEL_ID}" declares max ${charLimit.max} with no \`source\`.`);
    } else {
      limitsChecked++;
      const n = charCount(text);
      if (n > charLimit.max) {
        problems.push(`${p} is ${n} characters; Play caps this field at ${charLimit.max}. Source: ${charLimit.source}`);
      }
    }
  }
}
// A pass produced by reading nothing is the failure this repo keeps meeting.
if (filesChecked === 0) {
  coverageLost([
    `${metaDir} yielded ZERO readable metadata files out of ${requiredFiles.length + extraFiles.length} expected.`,
    'Every field check above ran over an empty set. The scan is broken or the tree was emptied;',
    'either way this is not a listing that can be submitted.',
  ]);
}
const declaredLimits = [maxLines, maxChars].reduce((n, o) => n + Object.keys(o).filter((k) => k !== '_why').length, 0);
if (declaredLimits > 0 && limitsChecked === 0) {
  coverageLost([
    `${declaredLimits} field limit(s) are declared for "${CHANNEL_ID}" and NOT ONE was evaluated.`,
    'Either the contract names files this tree does not carry, or every limit lost its `source`.',
    'Both report every listing field within its limit by never measuring one.',
  ]);
}
if (!problems.length) {
  ok(`metadata tree ${metaDir} — ${filesChecked} field(s) present and non-empty, ${limitsChecked} within a SOURCED Play limit`);
}

// ── [10]D-6 PREFLIGHT — the portfolio-safety gate, run by the RELEASE PATH ────
// 🔴 IN THE SCRIPT AND NOT ONLY IN CI, and the difference is the whole point.
// CI runs assert-submission-safety.mjs on every push in its PORTFOLIO mode; that
// proves the taglines are distinct across apps, and it proves nothing about the
// app somebody is submitting RIGHT NOW. The `--submitting` mode's
// web-prove-first rule can only be asked at the moment of a submission — so it
// is asked here, by the path that would do it, rather than by a lane that ran
// hours earlier on a different question.
//
// A strike attaches to the PUBLISHER, so the cost of getting this wrong is every
// other app in the portfolio losing distribution at once (L21).
{
  // Resolved from THIS FILE, never from ROOT: `--repo-root` points the CHECKS
  // at another tree (that is how the tests drive this script), and the guard
  // itself always lives beside the release scripts. Resolving it from ROOT
  // meant a fixture root had to contain a copy of tooling/ci to be testable.
  const safety = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-submission-safety.mjs');
  const r = spawnSync(process.execPath, [safety, ROOT, '--submitting', '--app', app.slug], { encoding: 'utf8' });
  if (r.status !== 0) {
    die([
      'FAIL the [10]D-6 submission-safety preflight refused this submission:',
      `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd(),
    ]);
  }
  ok('[10]D-6 preflight — distinct tagline, and the app is live on the web before a store sees it');
}

// ── 2. the package name ──────────────────────────────────────────────────────
// 🔴 IMMUTABLE AFTER THE FIRST UPLOAD. Play binds the listing to the
// applicationId permanently — there is no rename, only a second listing with a
// second review and a split of every rating and install count. [10]D-3 owns the
// general assertion across all platforms; this is the release path refusing to
// ship an artifact whose identity it did not check, which is not the same job.
const gradleRel = `apps/${app.slug}/android/app/build.gradle.kts`;
const gradleText = read(gradleRel);
if (gradleText === null) {
  die([
    `FAIL ${gradleRel} does not exist — nothing declares this app's Android package name or how it is signed.`,
  ]);
}
// 🔴 THE READER IS SHARED WITH tooling/ci/assert-store-identity.mjs since
// 2026-08-03 (tooling/ci/read-identity.mjs). It used to be a private regex
// here, which made this script the ONLY thing that ever read the Android
// package name — and only when somebody ran it with `--app subly`. A second
// implementation inherits none of the other's tests, and the failure mode of a
// duplicated identity reader is that it reports agreement between two things it
// read wrongly.
const idRead = readGradleApplicationId(gradleText, gradleRel);
if (idRead.missing) {
  coverageLost([
    idRead.missing,
    'Without it the package name this submission would claim is undefined, and both checks below',
    'would compare undefined to undefined and agree.',
  ]);
}
const packageName = idRead.value;
const expectedPackage = `com.nikatru.${app.slug}`;
if (packageName !== expectedPackage) {
  problems.push(
    `${gradleRel} declares applicationId "${packageName}" and architecture §24's canonical form for app "${app.slug}" is "${expectedPackage}". Play binds the package name at the FIRST upload and it can never be changed — a mismatch also silently splits one app into two in every analytics report, and the store half cannot be corrected.`,
  );
} else {
  ok(`package name ${packageName} — matches the canonical com.nikatru.<app_id> form`);
}

// ── 3. the signing posture ───────────────────────────────────────────────────
// The env var NAMES are PARSED OUT OF THE GRADLE FILE rather than repeated here.
// Two copies of that list is how they drift, and the drift is silent: this
// script would report "no keystore configured" forever while Gradle happily read
// a different variable. Parsing also means DELETING the signing block fails here
// instead of quietly reverting the shape to an unconditional debug config.
const envPairs = [...gradleText.matchAll(/"(\w+)"\s+to\s+"([A-Z0-9_]+)"/g)].map((m) => [m[1], m[2]]);
if (envPairs.length === 0) {
  coverageLost([
    `${gradleRel} declares no release-signing environment map.`,
    'The `releaseSigningEnv` block is the shape that lets a keystore be supplied as configuration',
    'rather than as a code change. With it gone the release build is unconditionally debug-signed and',
    'this script cannot tell — it would report the posture it expected instead of the one in the file.',
  ]);
}
if (!/signingConfigs\.getByName\("debug"\)/.test(gradleText)) {
  problems.push(
    `${gradleRel} no longer names the debug signing config as the fallback. That fallback is a RECORDED owner decision (the register's android-play notes): with no keystore supplied, the release build is a debug-signed BUILD PROOF. Removing it turns every keyless build into a failure rather than a proof.`,
  );
}

const suppliedEnv = envPairs.filter(([, env]) => (process.env[env] ?? '').trim() !== '');
const keyPropertiesRel = `apps/${app.slug}/android/key.properties`;
const hasKeyProperties = existsSync(abs(keyPropertiesRel));

if (hasKeyProperties) {
  prints.push(
    `SIGNING: ${keyPropertiesRel} is present, so Gradle reads the keystore from it and the environment is not consulted. Its CONTENTS are deliberately not read here — this script never touches key material. (The file is gitignored: .gitignore:57 and apps/${app.slug}/android/.gitignore:12.)`,
  );
} else if (suppliedEnv.length === 0) {
  // 🔴 A PRINT IN --dry-run AND A FAILURE IN --submit, and the asymmetry is the
  // point. A keyless dry run is a legitimate build proof; a keyless SUBMISSION
  // is an upload Play refuses, after the version code is spent.
  const line = `SIGNING POSTURE: DEBUG FALLBACK — none of ${envPairs.map(([, e]) => e).join(', ')} is set and there is no ${keyPropertiesRel}, so the release build is debug-signed and produces a build PROOF. 🔴 A debug-signed .aab CANNOT be uploaded to Play. ⚠️ THIS LINE IS A CLAIM ABOUT THE ENVIRONMENT, NOT ABOUT THE ARTIFACT, and until 2026-08-04 that distinction was the whole defect: an upload key existed, no workflow supplied it, and this printed the fallback as the recorded posture on every CI run. tooling/ci/android-signing.mjs now supplies the four variables in the release lanes and tooling/ci/assert-artifact-signed.mjs reads the real signer out of the bundle. Seeing this line inside a CI job means that step did not run.`;
  if (SUBMIT) problems.push(line);
  else prints.push(line);
} else if (suppliedEnv.length < envPairs.length) {
  problems.push(
    `signing is HALF configured — ${suppliedEnv.length} of ${envPairs.length} keystore variable(s) set (${suppliedEnv.map(([, e]) => e).join(', ')}). Gradle refuses this state on purpose and so does this script: falling back to debug with three of four values present produces a debug-signed artifact from a run that looked like a signing run, and Play accepts a given upload key exactly once.`,
  );
} else {
  ok(`signing posture — all ${envPairs.length} keystore variable(s) supplied (values never read or printed)`);
}

// ── 3b. the posture the lane EXPORTED, in --submit only ──────────────────────
// tooling/ci/android-signing.mjs writes ANDROID_SIGNING_POSTURE into $GITHUB_ENV
// and tooling/ci/assert-artifact-signed.mjs compares it to what actually signed
// the bundle — the guard PG-4 proved this lane runs, before this step. So by the
// time control reaches here, "release-signed" has been CORROBORATED against the
// artifact rather than merely asserted. Reading it is how this script inherits
// that verdict without needing a JDK of its own.
if (SUBMIT) {
  const posture = (process.env[POSTURE_ENV] ?? '').trim();
  if (posture !== RELEASE_SIGNED) {
    problems.push(
      `${POSTURE_ENV} is ${JSON.stringify(posture)} and --submit requires ${JSON.stringify(RELEASE_SIGNED)}. It is exported by tooling/ci/android-signing.mjs and corroborated against the bundle's real signature by ${SIGNATURE_GUARD}, which PG-4 proved this job runs first. An empty value means that step did not run or did not reach $GITHUB_ENV; "debug-signed-build-proof" means the bundle in hand is a build proof Play refuses at upload.`,
    );
  } else {
    ok(`${POSTURE_ENV} = ${RELEASE_SIGNED} — and ${SIGNATURE_GUARD} read the bundle before this step (PG-4)`);
  }
}

// ── 4. the artifact ──────────────────────────────────────────────────────────
// Flutter's app-bundle output path is fixed by the tool, not configurable in the
// pubspec the way `msix`'s output is, so it is derived rather than read.
const aabRel = `apps/${app.slug}/build/app/outputs/bundle/release/app-release.aab`;
const acceptedFormats = (channel.artifactFormats ?? []).filter((f) => typeof f === 'string');
if (!acceptedFormats.some((f) => aabRel.endsWith(f))) {
  problems.push(
    `the build output ${aabRel} matches none of the formats channel "${CHANNEL_ID}" accepts (${acceptedFormats.join(', ')}). The build lane and the register disagree about what this channel takes.`,
  );
}

let aabBytes = 0;
if (existsSync(abs(aabRel))) {
  aabBytes = statSync(abs(aabRel)).size;
  if (aabBytes === 0) {
    problems.push(`${aabRel} exists and is ZERO bytes. A truncated bundle uploads and fails processing, which costs a version code.`);
  } else {
    ok(`artifact ${aabRel} — ${(aabBytes / 1024 / 1024).toFixed(1)} MiB`);
  }
} else if (ALLOW_MISSING_ARTIFACT) {
  prints.push(
    `NO BUILT ARTIFACT — ${aabRel} is not on disk and --allow-missing-artifact was passed, so the listing, package name and signing posture were validated and the bundle was NOT. Build it with:  flutter build appbundle --release`,
  );
} else {
  problems.push(
    `${aabRel} does not exist. Run \`flutter build appbundle --release\` in apps/${app.slug} first, or pass --allow-missing-artifact to validate the listing alone (and say so in the output, which is what that flag does).`,
  );
}

// ── 5. the service account — presence and SHAPE, never values ────────────────
// The Play Developer API authenticates with a Google Cloud service account that
// has been granted access in the Play Console. Play needs exactly ONE secret,
// which is why this list is shorter than the Microsoft path's four: the package
// name is derived above and the track is a choice, not a credential.
//
// This validates that the JSON PARSES and carries the fields a service-account
// key has. A malformed or truncated secret is otherwise discovered at
// submission time, against a live account — and a secret that was pasted with a
// wrapping quote or a missing newline looks exactly like a present one to a
// bare presence check.
const SA_ENV = 'PLAY_SERVICE_ACCOUNT_JSON';
const SA_REQUIRED_KEYS = ['type', 'client_email', 'private_key'];
const saRaw = (process.env[SA_ENV] ?? '').trim();
let serviceAccount = null;
if (saRaw === '') {
  // Owner-gated gap in a dry run; a hard stop in a submission, which cannot
  // authenticate without it.
  const line = `SERVICE ACCOUNT NOT CONFIGURED — ${SA_ENV} is absent. The Play Developer account is verified (register accountStatus, 2026-08-04) and a Google Cloud service account was granted Admin on it (ADR 031), so this is now a WIRING gap rather than an account one: the key exists and the repository secret is what carries it into a job.`;
  if (SUBMIT) problems.push(`${line} --submit cannot mint an access token without it.`);
  else prints.push(line);
} else {
  let sa = null;
  try {
    sa = JSON.parse(saRaw);
  } catch (e) {
    // The message is the parser's, about STRUCTURE. No fragment of the value is
    // echoed: a service-account key is a private key.
    problems.push(
      `${SA_ENV} is set but is not valid JSON (${e.message}). A service-account key that does not parse fails at submission time against a live account; catching it here costs nothing. The value is never printed.`,
    );
  }
  if (sa !== null) {
    if (typeof sa !== 'object' || Array.isArray(sa)) {
      problems.push(`${SA_ENV} parses but is not a JSON object. A Google service-account key is an object with at least ${SA_REQUIRED_KEYS.join(', ')}.`);
    } else {
      const missing = SA_REQUIRED_KEYS.filter((k) => typeof sa[k] !== 'string' || sa[k].trim() === '');
      if (missing.length > 0) {
        problems.push(`${SA_ENV} parses but is missing ${missing.join(', ')}. Only the KEY NAMES are reported — no value from this secret is ever printed.`);
      } else if (sa.type !== 'service_account') {
        problems.push(`${SA_ENV} has type ${JSON.stringify(sa.type)}; the Play Developer API needs a service-account key (type "service_account"). An OAuth client secret is a different credential and fails at token exchange.`);
      } else {
        serviceAccount = sa;
        ok(`service account — ${SA_ENV} parses and carries ${SA_REQUIRED_KEYS.length} required field(s) (values never read or printed)`);
      }
    }
  }
}

// ── 6. the track ─────────────────────────────────────────────────────────────
// The track is a CHOICE, not a credential, and deliberately NOT validated
// against a vocabulary: Play supports custom closed-test track names alongside
// the standard ones, so an allowlist here would reject correct input — the exact
// failure mode the D-5 limits table exists to prevent. What IS enforced is
// POLICY, which is a different thing from a vocabulary.
const requestedTrack = (opt('track') ?? process.env.PLAY_TRACK ?? '').trim();
const releaseStatus = (opt('status') ?? 'completed').trim();

/** `tracksGuide` documents form-factor prefixes producing e.g. "wear:production",
 *  so a production track is not only the bare string. */
const isProductionTrack = (t) => t === 'production' || t.endsWith(':production');

if (SUBMIT) {
  // ── PG-6 · ADR 031 class A ─────────────────────────────────────────────────
  if (isProductionTrack(requestedTrack)) {
    die([
      `FAIL --submit refuses the production track (${JSON.stringify(requestedTrack)}).`,
      '     [ADR 031] class A — "promoting any release to the production track" is EXPLICITLY owner-only,',
      '     per instance, and never inferred from the agent holding the capability. The same ADR just as',
      '     explicitly does NOT gate testing-track uploads, which is what this path is for.',
      '     A production release is a Play Console act by a human. Append a row to company/OWNER_QUEUE.md.',
    ]);
  }
  if (!ALLOWED_RELEASE_STATUS.includes(releaseStatus)) {
    die([
      `FAIL --status ${JSON.stringify(releaseStatus)} is not one of ${ALLOWED_RELEASE_STATUS.join(', ')}.`,
      `     Source: ${PRIMARY_SOURCES.tracksResource} — "userFraction … Can only be set when status is`,
      '     \'inProgress\' or \'halted\'", and [ADR 031] class A names "changing a staged rollout percentage"',
      '     as owner-only. This script therefore has no rollout flag at all: a value it cannot express is',
      '     a value it cannot set by accident.',
    ]);
  }
} else {
  prints.push(
    `TRACK: ${requestedTrack === '' ? 'unset — --submit would DISCOVER the least-public track the API offers (edits.tracks.list)' : JSON.stringify(requestedTrack)}. Not validated against a vocabulary — Play allows custom closed-test track names, so an allowlist would reject correct input. The production track is refused by POLICY (ADR 031 class A), which is a different check.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nsubmit-play: FAILED');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('');
  console.log('submit-play: DRY RUN OK — nothing was sent to Google.');
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'company/runbooks/store-submission-android.md'}`);
  console.log('   ⬜ The 12-tester / 14-continuous-day closed test does NOT gate this account and never did.');
  console.log('      Google scopes that rule to "personal accounts created after November 13, 2023"');
  console.log('      (support.google.com/googleplay/android-developer/answer/14151465); NIKATRU is a verified');
  console.log('      ORGANIZATION account. A closed test is still good practice — it is simply not a gate.');
  console.log('   ⬜ What IS still true: the register keeps android-play `served: false`, and [10]D-9 has no');
  console.log('      submission record. Only an owner-approved dispatch of submit-play.yml can create one.');
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// --submit · THE GOOGLE PLAY DEVELOPER API EDIT LIFECYCLE
//
// Every request below cites the page its URL, method and payload came from.
// `editsGuide`, verbatim: "Changes made within an edit are not live until the
// edit is committed." and "Each user may have only a single edit open at a time.
// If you create a new edit, any existing edit you may have open is invalidated."
// and "If anyone commits an edit or makes changes to an app through the Play
// Console, _all_ other edits for the app (owned by any user) are invalidated."
// That last sentence is why every failure below deletes the edit it opened: an
// abandoned edit is the "half-created edit a human unpicks in a console" the old
// refusal named, and it also blocks the next run.
// ═════════════════════════════════════════════════════════════════════════════

/** Never log a token, an assertion, or one byte of the private key. Everything
 *  that reaches the console goes through here. */
const REDACT = (s) => String(s).replace(/(Bearer\s+)\S+/g, '$1«redacted»');

class ApiError extends Error {
  constructor(what, status, body) {
    super(`${what} → HTTP ${status}${body ? ` · ${REDACT(body).slice(0, 600)}` : ''}`);
    this.status = status;
  }
}

async function request(what, method, url, { token = null, body = null, headers = {}, expect = [200] } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers: h, body, redirect: 'manual' });
  if (!expect.includes(res.status)) {
    throw new ApiError(`${what} (${method} ${url})`, res.status, await res.text().catch(() => ''));
  }
  return res;
}
const asJson = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`the API answered 200 with a body that is not JSON (${e.message}): ${REDACT(text).slice(0, 300)}`);
  }
};

/** Mint an access token with the JWT-bearer grant.
 *  Source: ${PRIMARY_SOURCES.serviceAccountGrant} — header {"alg":"RS256",
 *  "typ":"JWT"}; claims iss (service-account email), scope (space-delimited),
 *  aud ("always https://oauth2.googleapis.com/token"), exp ("maximum of 1 hour
 *  after the issued time"), iat; grant_type
 *  "urn:ietf:params:oauth:grant-type:jwt-bearer"; response
 *  {access_token, scope, token_type, expires_in}. */
async function mintAccessToken(sa) {
  const b64 = (v) => Buffer.from(v).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(
    JSON.stringify({ iss: sa.client_email, scope: PLAY_SCOPE, aud: GOOGLE_TOKEN_URL, exp: now + 3600, iat: now }),
  )}`;
  let signature;
  try {
    signature = createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
  } catch (e) {
    // The message is about the KEY'S SHAPE and never quotes it.
    throw new Error(
      `the service-account private_key could not sign an RS256 assertion (${e.message}). The key material is never printed; check that ${SA_ENV} carries the JSON exactly as Google issued it, newlines included.`,
    );
  }
  const res = await request('token exchange', 'POST', TOKEN_URL, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${signingInput}.${b64(signature)}` }).toString(),
  });
  const json = await asJson(res);
  if (typeof json.access_token !== 'string' || json.access_token === '') {
    throw new Error('the token endpoint answered 200 with no access_token.');
  }
  return json.access_token;
}

const editsBase = `${PLAY_BASE}/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits`;
const uploadBase = `${PLAY_BASE}/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/edits`;

let editId = null;
let token = null;
let committed = false;
/** 🔴 NOTHING BELOW THIS POINT MAY CALL `process.exit()`, AND IT IS NOT A STYLE
 *  PREFERENCE — it aborts the process on Windows. Exiting while `fetch`'s
 *  connection pool still holds handles trips a libuv assertion
 *  (`!(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c`) and the process
 *  dies with 0xC0000409 AFTER printing "SUBMITTED", so the submission succeeded
 *  and the exit code says catastrophic failure. Observed on this box 2026-08-09,
 *  on a run whose every API call had already gone through. So the outcome is
 *  carried in a variable, `process.exitCode` is SET rather than forced, and the
 *  event loop is allowed to drain the pool on its own. */
let failure = null;

try {
  step('minting an access token (JWT-bearer, RS256) — the assertion and the token are never printed');
  token = await mintAccessToken(serviceAccount);
  ok('access token — the service-account assertion was accepted');

  // ── L1 · edits.insert ──────────────────────────────────────────────────────
  // Source: ${PRIMARY_SOURCES.editsInsert} — "POST .../applications/{packageName}/edits",
  // response "a newly created instance of the AppEdit object"; AppEdit is
  // {id, expiryTimeSeconds} (${PRIMARY_SOURCES.editsResource}).
  step(`POST ${editsBase}  (edits.insert)`);
  const edit = await asJson(await request('edits.insert', 'POST', editsBase, { token, headers: { 'content-type': 'application/json' }, body: '{}' }));
  if (typeof edit.id !== 'string' || edit.id === '') throw new Error('edits.insert returned no edit id.');
  editId = edit.id;
  const expiry = Number(edit.expiryTimeSeconds);
  ok(`edit ${editId} opened${Number.isFinite(expiry) ? ` — expires ${new Date(expiry * 1000).toISOString()}` : ''}`);

  // ── L2 · edits.tracks.list, and the track decision ─────────────────────────
  // Source: ${PRIMARY_SOURCES.tracksList} — "GET .../edits/{editId}/tracks",
  // response {kind, tracks[]} where tracks is "All tracks (including tracks with
  // no releases)".
  step(`GET ${editsBase}/${editId}/tracks  (edits.tracks.list)`);
  const listed = await asJson(await request('edits.tracks.list', 'GET', `${editsBase}/${editId}/tracks`, { token }));
  const available = (listed.tracks ?? []).map((t) => t?.track).filter((t) => typeof t === 'string' && t !== '');
  if (available.length === 0) {
    throw new Error(
      'edits.tracks.list returned ZERO tracks. Every Play app has at least the standard set, so an empty list means this service account cannot see this app (a permissions grant in the Play Console) or the package name is not one this account owns. Choosing a track from an empty list is how a submission goes to a track nobody is watching.',
    );
  }
  ok(`tracks the API reports for ${packageName}: ${available.join(', ')}`);

  let track;
  if (requestedTrack !== '') {
    if (!available.includes(requestedTrack)) {
      throw new Error(
        `--track ${JSON.stringify(requestedTrack)} is not one of the tracks this app has (${available.join(', ')}). A typo would create a release on nothing, or 404 halfway through the lifecycle; refusing here costs one run.`,
      );
    }
    track = requestedTrack;
    ok(`track ${JSON.stringify(track)} — named explicitly, and the API confirms the app has it`);
  } else {
    // THE LEAST-PUBLIC TRACK THE API OFFERS. Not "internal", not "qa" — whichever
    // of the RANKED names this account actually returns. See TRACK_PUBLICNESS
    // for why that indirection exists rather than a constant.
    const ranked = available
      .filter((t) => Object.hasOwn(TRACK_PUBLICNESS, t))
      .sort((a, b) => TRACK_PUBLICNESS[a] - TRACK_PUBLICNESS[b]);
    const candidate = ranked.find((t) => !isProductionTrack(t));
    if (!candidate) {
      throw new Error(
        `no default track could be chosen. The API offers ${available.join(', ')} and none of them is a name Google publishes an ordering for (${Object.keys(TRACK_PUBLICNESS).join(', ')}) other than production, which policy refuses. Custom closed-test tracks have names only a human can rank, so name one with --track rather than having this script invent a position for it.`,
      );
    }
    track = candidate;
    ok(`track ${JSON.stringify(track)} — the least-public track the API offers (no --track given)`);
  }
  if (isProductionTrack(track)) {
    // Belt and braces: PG-6 already refused an explicit production track, and
    // discovery skips it. A third check costs nothing and the thing it guards
    // is a one-way door.
    throw new Error(`resolved track ${JSON.stringify(track)} is a production track. [ADR 031] class A — owner-only, per instance.`);
  }

  // ── L3 · edits.bundles.upload (resumable) ──────────────────────────────────
  // Source: ${PRIMARY_SOURCES.bundlesUpload} — upload URI
  // "POST https://androidpublisher.googleapis.com/upload/androidpublisher/v3/
  //  applications/{packageName}/edits/{editId}/bundles", response a Bundle.
  // Source: ${PRIMARY_SOURCES.uploadProtocol} — resumable is "For reliable
  // transfer, especially important with larger files"; simple (uploadType=media)
  // is "for example, 5 MB or less", which an .aab is not. Initiate with
  // uploadType=resumable and the X-Upload-Content-* headers, read the session
  // URI from the "Location" header, then PUT the bytes.
  const bundleBytes = readFileSync(abs(aabRel));
  const localSha256 = createHash('sha256').update(bundleBytes).digest('hex');
  step(`POST ${uploadBase}/${editId}/bundles?uploadType=resumable  (initiate · ${(bundleBytes.length / 1024 / 1024).toFixed(1)} MiB)`);
  const initiate = await request('edits.bundles.upload (initiate)', 'POST', `${uploadBase}/${editId}/bundles?uploadType=resumable`, {
    token,
    headers: {
      'X-Upload-Content-Type': AAB_MEDIA_TYPE,
      'X-Upload-Content-Length': String(bundleBytes.length),
      'content-length': '0',
    },
  });
  const sessionUri = initiate.headers.get('location');
  if (!sessionUri) throw new Error('the resumable initiate returned 200 with no Location header, so there is no session URI to PUT to.');
  // 🔴 SAME ORIGIN OR NOTHING. The next request carries the entire signed bundle
  // and the bearer token. A Location header is attacker-influenceable in a way
  // the URL we composed is not, so it may relocate the upload WITHIN Google and
  // nowhere else.
  if (new URL(sessionUri, PLAY_BASE).origin !== new URL(PLAY_BASE).origin) {
    throw new Error(`the resumable session URI points at ${new URL(sessionUri, PLAY_BASE).origin}, not ${PLAY_BASE}. Refusing to send the bundle and the bearer token off-origin.`);
  }
  step('PUT «session URI»  (the bundle bytes)');
  const uploaded = await asJson(
    await request('edits.bundles.upload (transfer)', 'PUT', new URL(sessionUri, PLAY_BASE).toString(), {
      token,
      headers: { 'content-type': AAB_MEDIA_TYPE, 'content-length': String(bundleBytes.length) },
      body: bundleBytes,
    }),
  );
  const versionCode = uploaded.versionCode;
  if (!Number.isInteger(versionCode)) throw new Error(`the Bundle resource carried no integer versionCode (got ${JSON.stringify(uploaded.versionCode)}).`);
  // Source: ${PRIMARY_SOURCES.bundleResource} — Bundle.sha256 is "A sha256 hash
  // of the upload payload, encoded as a hex string and matching the output of
  // the sha256sum command". So the API hands back a checksum of what it received
  // and we can prove the bytes on disk are the bytes Play now holds. A truncated
  // upload that still returns 200 is otherwise invisible until processing fails.
  if (typeof uploaded.sha256 === 'string' && uploaded.sha256.toLowerCase() !== localSha256) {
    throw new Error(`the bundle Play received hashes to ${uploaded.sha256} and the file on disk hashes to ${localSha256}. The upload was corrupted in transit.`);
  }
  ok(`bundle uploaded — versionCode ${versionCode}${typeof uploaded.sha256 === 'string' ? `, sha256 confirmed byte-for-byte` : ', ⬜ the API returned no sha256 so the transfer is unverified'}`);

  // ── L4 · edits.tracks.update ───────────────────────────────────────────────
  // Source: ${PRIMARY_SOURCES.tracksUpdate} — "PUT .../edits/{editId}/tracks/{track}",
  // body a Track. Source: ${PRIMARY_SOURCES.tracksResource} — Track is
  // {track, releases[]}; Release.versionCodes is "Version codes of all APKs in
  // the release. Must include version codes to retain from previous releases."
  //
  // ⚠️ THAT LAST SENTENCE IS A FOOTGUN AND IT IS WHY THIS SENDS EXACTLY ONE CODE.
  // A track update REPLACES the track's releases. On a testing track that is the
  // intent — the new bundle is what testers get. It is also precisely why this
  // path refuses `production`: there, "must include version codes to retain"
  // means an incomplete list silently WITHDRAWS live releases.
  const releaseName = `${versionCode} (${new Date().toISOString().slice(0, 10)})`;
  step(`PUT ${editsBase}/${editId}/tracks/${encodeURIComponent(track)}  (edits.tracks.update · status ${releaseStatus})`);
  await request('edits.tracks.update', 'PUT', `${editsBase}/${editId}/tracks/${encodeURIComponent(track)}`, {
    token,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track, releases: [{ name: releaseName, versionCodes: [String(versionCode)], status: releaseStatus }] }),
  });
  ok(`track ${track} — release ${JSON.stringify(releaseName)} with versionCode ${versionCode}, status ${releaseStatus}`);

  // ── L5 · edits.validate, BEFORE commit ─────────────────────────────────────
  // Source: ${PRIMARY_SOURCES.editsValidate} — "Validates an app edit.",
  // "POST .../edits/{editId}:validate", empty request body, AppEdit response.
  // A separate call rather than trusting commit to report the same errors: a
  // failed validate leaves the edit deletable and costs nothing, and it is the
  // only step here that can say "this would not have worked" without trying.
  step(`POST ${editsBase}/${editId}:validate  (edits.validate)`);
  await request('edits.validate', 'POST', `${editsBase}/${editId}:validate`, { token, headers: { 'content-type': 'application/json' }, body: '' });
  ok('edit validated — Play reports no errors in it');

  // ── L6 · edits.commit ──────────────────────────────────────────────────────
  // Source: ${PRIMARY_SOURCES.editsCommit} — "POST .../edits/{editId}:commit",
  // empty request body, AppEdit response, query parameter
  // changesInReviewBehavior. See CHANGES_IN_REVIEW_BEHAVIOR for why the
  // fail-closed value is used.
  const commitUrl = `${editsBase}/${editId}:commit?changesInReviewBehavior=${CHANGES_IN_REVIEW_BEHAVIOR}`;
  step(`POST ${commitUrl}  (edits.commit)`);
  await request('edits.commit', 'POST', commitUrl, { token, headers: { 'content-type': 'application/json' }, body: '' });
  committed = true;
  ok(`edit ${editId} COMMITTED — versionCode ${versionCode} is on the ${track} track`);
} catch (err) {
  // ── the rollback the old refusal was afraid of not having ──────────────────
  // "leaving a half-created edit a human unpicks in a console" was the stated
  // fear. Source: ${PRIMARY_SOURCES.editsDelete} — "DELETE .../edits/{editId}",
  // "Deletes an app edit." An uncommitted edit changes nothing that was live
  // (editsGuide: "Changes made within an edit are not live until the edit is
  // committed"), so deleting it is the complete undo — but it also has to
  // HAPPEN, and whether it did is reported rather than assumed.
  const lines = [`FAIL the Play submission failed: ${REDACT(err.message)}`];
  if (editId !== null && !committed) {
    try {
      await request('edits.delete', 'DELETE', `${editsBase}/${editId}`, { token, expect: [200, 204] });
      lines.push(`     ROLLED BACK — edit ${editId} was DELETED. Nothing this run did is live, and the next run can open a fresh edit.`);
    } catch (cleanupErr) {
      lines.push(`     🔴 ROLLBACK FAILED — edit ${editId} could NOT be deleted (${REDACT(cleanupErr.message)}).`);
      lines.push('     An abandoned edit invalidates nothing that is live, but it does have to be discarded in the');
      lines.push('     Play Console before the next run, because "Each user may have only a single edit open at a');
      lines.push(`     time" (${PRIMARY_SOURCES.editsGuide}).`);
    }
  }
  failure = lines;
}

if (failure) {
  console.error('');
  for (const l of failure) console.error(l);
  console.error('\nsubmit-play: FAILED');
  process.exitCode = 1;
} else {
  console.log('');
  console.log('submit-play: SUBMITTED.');
  console.log(`   Track: ${requestedTrack === '' ? '(least-public the API offered)' : requestedTrack} · status ${releaseStatus} · package ${packageName}`);
  console.log('   ⬜ [10]D-9 LEDGER: this is the event limb (iii) of D-10 has been waiting for. Record it.');
  console.log('   ⬜ Promoting this to production is [ADR 031] class A — owner-only, per instance, in the Console.');
  process.exitCode = 0;
}
