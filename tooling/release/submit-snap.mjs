#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// submit-snap.mjs — the repeatable submission path for the Snap Store channel.
//
// [pipeline D-10] "For each store channel, the path from signed artifact to
//                  submitted release is scripted and repeatable … so submission
//                  #2 costs minutes, not archaeology."
//
// This file is limb (i) — "a submission script exists AND resolves to a step in
// a workflow, parsed not grepped". Limb (ii) is
// Private/company/runbooks/store-submission-snap.md. Limb (iii) — a submission record in
// the [10]D-9 ledger — needs a real submission and stays UNSATISFIED.
//
// ── THERE IS NO FASTLANE PATH FOR SNAP ───────────────────────────────────────
// fastlane's `deliver` covers ios+mac and `supply` covers android; Snap, like
// Microsoft Store and Web, has none (D-5, verified against fastlane's own action
// pages 2026-07-29). So this script is the only thing that will ever stand
// between this repo and the Snap Store.
//
// ── 🔴 THE SEVEN-LINE `UNVERIFIED` REFUSAL IS GONE. FIVE OF SEVEN WERE SOURCED ─
// From 2026-08-01 to 2026-08-11 `--submit` refused outright with seven
// `UNVERIFIED:` facts, on the stated ground that "a guessed `release` verb does
// not produce a failed API call, it produces a wrong build on somebody's
// desktop". That was right, and it is not retired by deleting it: it is retired
// by FETCHING the facts. Five of the seven now have a URL in `PRIMARY_SOURCES`
// below, every one fetched 2026-08-11, and each call site cites the page it came
// from. The two that could NOT be settled are in `UNSOURCED` below and each one
// still REFUSES — the limb it blocks is named there, not silently approximated.
//
// ── 🔴 WHY THIS SPEAKS TO A CLI AND submit-play.mjs SPEAKS HTTP ──────────────
// Not preference — sourcing. The Snap Store's own REST API is documented
// (`storeApiV1`, `storeApiV2`, `storeApiMacaroon` below) and its upload verb is
// `POST /dev/api/snap-push/`, whose REQUIRED body field is `updown_id` — an
// identifier the binary must already have been transferred somewhere else to
// obtain. That transfer's host and protocol are NOT on any page fetched here,
// and neither is the mapping from the credential blob this repo holds to the
// `Authorization: Macaroon root=…, discharge=…` header those endpoints require.
// Two missing links, both of them the load-bearing ones. `snapcraft` already
// holds both — it is the documented, supported client, the register already
// names it in `minimumToolchain`, and the lane already installs it — so the
// transport is `snapcraft` and the raw-HTTP path stays refused with its gaps
// named. An invented endpoint that 404s on submission day converts a known gap
// into a surprise at the worst possible moment.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the artifact, the recipe source, the
//              channel spec and the credential CONFIGURATION, and exits 0
//              WITHOUT one byte leaving the machine and WITHOUT invoking
//              `snapcraft`. This is the mode ci.yml runs on every push.
// `--submit`   performs the real upload — `snapcraft whoami` to prove the
//              credential is live, then `snapcraft upload <file> --release
//              <channels>` — behind the publish gate PG-1…PG-6 below.
//              It CANNOT reach the `stable` risk on any track: that is where
//              installs land by default and Snap refreshes silently, which is
//              [ADR 031] class A wearing a Snap Store hat.
//
// ── WHAT IS OWNER-GATED HERE IS A NAME, NOT AN ACCOUNT ───────────────────────
// 🔴 The snap name is a GLOBAL namespace across the entire Snap Store, claimed
// once with `snapcraft register <name>` and shared with nobody. That claim is the
// whole of OWNER_QUEUE A-6 — there is no publisher-account application, no
// business verification and no fee, which makes this the cheapest store channel
// on paper and the one with the sharpest irreversible edge: the name is either
// available or it is somebody else's, and finding out is the same action as
// taking it. `register` is a SEPARATE COMMAND from `upload` (PRIMARY_SOURCES
// .register and .upload), so nothing on this path can claim a name by accident —
// an upload against an unregistered name fails at the store and costs a run. So
// the name we intend to claim lives in the metadata tree (`snap-name.txt`) where
// it can be reviewed and diffed BEFORE it is claimed, and this script never
// shells out to `register` at all.
//
// ── WE HOLD NO KEY ON THIS PATH ──────────────────────────────────────────────
// The register's signing.keyKind for this row is "none" because CANONICAL signs
// the binary, and its restoreDrill is `required: false` for the same reason.
// There is nothing of ours to lose here — the opposite of the Android upload key.
// That is also why PG-5 has no signature limb the way submit-play.yml's does:
// there is no signature of ours to read. What it checks instead is that the same
// job GENERATED, GRADED and PACKED the artifact it is about to send.
//
// Usage:
//   node tooling/release/submit-snap.mjs --dry-run [--app <id>]
//   node tooling/release/submit-snap.mjs --dry-run --allow-missing-artifact
//   node tooling/release/submit-snap.mjs --submit --app <id> --confirm SUBMIT-TO-SNAP-STORE
//                                        [--channel latest/edge]
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable (or the upload was accepted).
//       1 = it is not, or a gate refused, or `snapcraft` did.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseWorkflow } from '../ci/workflow-scan.mjs';

const CHANNEL_ID = 'linux-snap';
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY SOURCES — every remote fact `--submit` depends on, and where it came
// from. ALL FETCHED 2026-08-11. This block is not decoration: the refusal it
// replaced demanded exactly this, in exactly this form ("Source them (URL +
// date, the way the D-5 limits table does), then write the calls"), and a fact
// whose URL is not written down here is a fact this script may not act on.
//
// ⚠️ documentation.ubuntu.com/snapcraft/* 301-REDIRECTS TO ubuntu.com/docs/
// snapcraft/*, and the ubuntu.com forms are what was actually fetched. The
// canonical-looking URL is recorded nowhere here on purpose — a citation that
// was not the page read is a citation to a page nobody read.
// ─────────────────────────────────────────────────────────────────────────────
const PRIMARY_SOURCES = Object.freeze({
  upload: 'https://ubuntu.com/docs/snapcraft/stable/reference/commands/upload/',
  release: 'https://ubuntu.com/docs/snapcraft/stable/reference/commands/release/',
  register: 'https://ubuntu.com/docs/snapcraft/stable/reference/commands/register/',
  status: 'https://ubuntu.com/docs/snapcraft/stable/reference/commands/status/',
  whoami: 'https://ubuntu.com/docs/snapcraft/stable/reference/commands/whoami/',
  exportLogin: 'https://ubuntu.com/docs/snapcraft/stable/reference/commands/export-login/',
  authenticate: 'https://ubuntu.com/docs/snapcraft/stable/how-to/publishing/authenticate/',
  publishASnap: 'https://ubuntu.com/docs/snapcraft/stable/how-to/publishing/publish-a-snap/',
  manageRevisions: 'https://ubuntu.com/docs/snapcraft/stable/how-to/publishing/manage-revisions-and-releases/',
  channels: 'https://ubuntu.com/docs/snapcraft/stable/reference/channels/',
  snapcraftYaml: 'https://ubuntu.com/docs/snapcraft/stable/reference/snapcraft-yaml/',
  autoUpdate: 'https://snapcraft.io/docs/how-to-guides/manage-snaps/manage-updates/',
  classicReview: 'https://snapcraft.io/docs/reference/administration/reviewing-classic-confinement-snaps/',
  storeApiV1: 'https://dashboard.snapcraft.io/docs/reference/v1/snap.html',
  storeApiV2: 'https://dashboard.snapcraft.io/docs/reference/v2/en/snaps.html',
  storeApiMacaroon: 'https://dashboard.snapcraft.io/docs/reference/v1/macaroon.html',
  githubEnvironments:
    'https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments',
  githubEnvironmentsApi: 'https://docs.github.com/en/rest/deployments/environments',
});

/** 🔴 WHAT IS STILL NOT SOURCED, AND EXACTLY WHICH LIMB REFUSES BECAUSE OF IT.
 *  Two of the original seven survive the 2026-08-11 fetch. Each is written as
 *  {gap, limb} rather than as prose, because a gap with no named consequence is
 *  a note and a gap with one is a decision somebody can overturn with a URL. */
const UNSOURCED = Object.freeze([
  {
    gap: 'the MACHINE-READABLE revision id of an upload. `upload` documents no structured output — only that "the channel map will be displayed after the operation takes place" when --release is used — and `manageRevisions` says a number "can be obtained with the `snapcraft revisions` command", whose output FORMAT is documented nowhere fetched.',
    limb: 'the TWO-STEP path (`snapcraft release <name> <revision> <channels>`, and any later promotion between risks) is NOT implemented. What is implemented is the one-step `upload --release`, which needs no revision id at all — the gap removes exactly one limb and leaves the first submission whole.',
    sources: ['upload', 'release', 'manageRevisions', 'status'],
  },
  {
    gap: 'how the SNAPCRAFT_STORE_CREDENTIALS blob maps onto the store API\'s `Authorization: Macaroon root=…, discharge=…` header, and which host the snap BINARY is transferred to in order to obtain the `updown_id` that `POST /dev/api/snap-push/` requires. The endpoints and their bodies are sourced; these two links between them are not.',
    limb: 'the RAW-HTTP transport is NOT implemented — no request in this file goes to dashboard.snapcraft.io. Everything that touches the store goes through `snapcraft`, which already holds both links. The same gap keeps LISTING SYNC refused: `POST /dev/api/snaps/{snap_id}/metadata` and `.../binary-metadata` are sourced and would push title/summary/description/licence/screenshots, but they need that header and a snap_id. Until then the listing is a console act, per the runbook.',
    sources: ['storeApiV1', 'storeApiV2', 'storeApiMacaroon', 'authenticate'],
  },
]);

// ── the closed, PUBLISHED channel vocabulary ─────────────────────────────────
/** `PRIMARY_SOURCES.channels`, verbatim: a channel is "<track>/<risk>/<branch>";
 *  "The preset risk levels are: stable, candidate, beta, and edge"; and — the
 *  one sentence the whole policy below rests on — "Snaps are installed to a
 *  user's system with the stable risk level by default." `PRIMARY_SOURCES.
 *  release` states the same grammar as `[<track>/]<risk>[/<branch>]` with risk
 *  "mandatory and must be one of stable, candidate, beta or edge" and track
 *  "implicitly set to latest".
 *
 *  🔴 THIS IS WHY A VOCABULARY IS SAFE HERE AND WAS NOT SAFE ON PLAY.
 *  submit-play.mjs deliberately refuses to hold an allowlist of tracks, because
 *  Play lets a human invent closed-test track names and an allowlist would
 *  reject correct input. Snap's RISK set is closed and published — four values,
 *  enumerated on two pages — while its TRACK set is open (custom tracks need a
 *  forum request). So the risk is validated and the track is not. */
const RISKS = Object.freeze(['stable', 'candidate', 'beta', 'edge']);
const DEFAULT_TRACK = 'latest';
/** The least-public risk, chosen rather than discovered. Play's default track is
 *  DISCOVERED from the API because its names are open-ended; Snap's are not, so
 *  the default can be named here — and the only policy-load-bearing fact is the
 *  verbatim one above about where installs land, which `edge` is not. */
const DEFAULT_CHANNEL = `${DEFAULT_TRACK}/edge`;
/** 🔴 REFUSED BY POLICY, NOT BY THE STORE. `PRIMARY_SOURCES.channels`: installs
 *  take `stable` by default. `PRIMARY_SOURCES.autoUpdate`, verbatim: "Snaps
 *  update automatically, and by default, the snapd daemon checks for updates 4
 *  times a day." `PRIMARY_SOURCES.manageRevisions`: a non-progressive release is
 *  "available to 100% of devices with the snap installed". Put together, a
 *  release to `stable` reaches every existing installation within hours, with no
 *  user action — which is [ADR 031] class A ("promoting any release to the
 *  production track") on a channel that does it more quietly than Play does. */
const REFUSED_RISK = 'stable';

const CONFIRM_TOKEN = 'SUBMIT-TO-SNAP-STORE';
const PUBLISH_ENVIRONMENT = 'store-publish';
/** ONE gate for the factory, not one per channel. submit-play.yml already names
 *  this environment and documents the exact `gh api` calls that create it with a
 *  required reviewer. A second environment would be a second thing to configure
 *  and a second thing to be silently missing. */
const CREDENTIAL_ENV = 'SNAPCRAFT_STORE_CREDENTIALS';
const RECIPE_GUARD = 'assert-snapcraft-generable.mjs';
const PACK_VERB = 'snapcraft pack';

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
  console.error('\nsubmit-snap: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nsubmit-snap: FAILED');
  process.exit(1);
}

if (DRY_RUN === SUBMIT) {
  die([
    'FAIL exactly one of --dry-run and --submit is required.',
    '     Defaulting either way is how a dry run becomes a submission (or a submission',
    '     silently becomes a no-op). The mode has to be said out loud.',
  ]);
}

// ── the channel, parsed before anything else can use it ──────────────────────
/** Grammar from `PRIMARY_SOURCES.release`: `[<track>/]<risk>[/<branch>]`.
 *
 *  ⚠️ THE TWO-PART FORM IS GENUINELY AMBIGUOUS AND IS NOT RESOLVED BY GUESSING.
 *  `x/y` could be track/risk or risk/branch, and no page fetched states a
 *  precedence. So the risk is LOCATED rather than positioned: exactly one part
 *  must be a published risk name. Zero is a refusal, and two (`stable/beta`) is
 *  a refusal that asks for the explicit three-part form — which is the only
 *  shape with no ambiguity left in it. */
function parseChannel(spec) {
  const parts = String(spec).trim().split('/');
  if (parts.some((p) => p === '')) return { error: `${JSON.stringify(spec)} has an empty component.` };
  if (parts.length > 3) return { error: `${JSON.stringify(spec)} has ${parts.length} components; a channel is at most <track>/<risk>/<branch>.` };
  const at = parts.map((p, i) => (RISKS.includes(p) ? i : -1)).filter((i) => i !== -1);
  if (at.length === 0) {
    return {
      error: `${JSON.stringify(spec)} names no risk. Risk is mandatory and must be one of ${RISKS.join(', ')} (${PRIMARY_SOURCES.release}).`,
    };
  }
  if (at.length > 1) {
    return {
      error: `${JSON.stringify(spec)} contains ${at.length} risk names, so which component is the risk is ambiguous and no primary source settles it. Write the full <track>/<risk>/<branch> form.`,
    };
  }
  const i = at[0];
  if (parts.length === 3 && i !== 1) {
    return { error: `${JSON.stringify(spec)} is three components with the risk at position ${i + 1}; the documented order is <track>/<risk>/<branch>.` };
  }
  return {
    track: parts.length === 1 ? DEFAULT_TRACK : i === 1 ? parts[0] : DEFAULT_TRACK,
    risk: parts[i],
    branch: parts.length === 3 ? parts[2] : parts.length === 2 && i === 0 ? parts[1] : null,
  };
}

const channelSpecs = String(opt('channel') ?? process.env.SNAP_CHANNEL ?? DEFAULT_CHANNEL)
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '');
if (channelSpecs.length === 0) die([`FAIL --channel was given and resolved to no channel at all.`]);
const parsedChannels = [];
for (const spec of channelSpecs) {
  const parsed = parseChannel(spec);
  if (parsed.error) die([`FAIL --channel ${parsed.error}`, `     Source: ${PRIMARY_SOURCES.channels}`]);
  parsedChannels.push({ spec, ...parsed });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PUBLISH GATE — PG-1 … PG-6, ALL BEFORE ANY OTHER WORK
//
// 🔴 AT THE TOP FOR THE SAME REASON THE OLD REFUSAL WAS: there must be no path
// on which a submission gets partway. What changed on 2026-08-11 is that these
// are gates a correctly-authorised run PASSES, rather than a stop nothing could
// clear.
//
// ⚠️ THE NUMBERING DELIBERATELY DIFFERS FROM submit-play.mjs's, AND THE REASON
// IS TESTABILITY. There, the class-A policy refusal is PG-6 and therefore sits
// BEHIND an authenticated GitHub read — which means the single most important
// refusal on the path cannot be exercised without a token and a network. Here
// the risk policy is PG-3: five pure-local reads first, the one network call
// last. A gate you cannot cheaply prove refuses is a gate nobody proves refuses.
// ─────────────────────────────────────────────────────────────────────────────
if (SUBMIT) {
  // ── PG-1 · the confirm token ───────────────────────────────────────────────
  // A dispatch input, mirrored here. The workflow ALSO guards the job with an
  // `if:` on the same input, and that redundancy is deliberate: the `if:` is one
  // deletable YAML line, and this repository's recorded failure mode is exactly
  // "a correct mechanism that nothing switched on".
  const confirm = opt('confirm', '');
  if (confirm !== CONFIRM_TOKEN) {
    die([
      `FAIL --submit requires --confirm ${CONFIRM_TOKEN}; got ${JSON.stringify(confirm ?? '')}.`,
      '     This is the dispatch input a human types. It is not a formality: --submit sends a real',
      '     package to a real store, and on this channel the consequence of a wrong send is quieter',
      '     than anywhere else — Snap refreshes installs automatically, four times a day',
      `     (${PRIMARY_SOURCES.autoUpdate}). A mode flag alone is one typo away from that.`,
    ]);
  }

  // ── PG-2 · you cannot submit an artifact you declined to look for ──────────
  if (ALLOW_MISSING_ARTIFACT) {
    die([
      'FAIL --allow-missing-artifact is a DRY-RUN flag and --submit refuses it.',
      '     It exists so the listing can be validated with no package on disk. Combined with --submit it',
      '     would mean "upload the snap, and never mind whether there is one". The two flags are',
      '     mutually exclusive by design.',
    ]);
  }

  // ── PG-3 · the risk this run may reach ─────────────────────────────────────
  // 🔴 THE CLASS-A REFUSAL, AND IT IS THIRD BECAUSE IT IS FREE. Pure local
  // reads, no token, no network — so it is the gate a test can prove refuses in
  // one spawn, and it refuses before anything has been looked up.
  const toStable = parsedChannels.filter((c) => c.risk === REFUSED_RISK);
  if (toStable.length > 0) {
    die([
      `FAIL --submit refuses the "${REFUSED_RISK}" risk (${toStable.map((c) => JSON.stringify(c.spec)).join(', ')}).`,
      `     ${PRIMARY_SOURCES.channels}, verbatim: "Snaps are installed to a user's system with the stable`,
      '     risk level by default."',
      `     ${PRIMARY_SOURCES.autoUpdate}, verbatim: "Snaps update automatically, and by default, the snapd`,
      '     daemon checks for updates 4 times a day."',
      `     ${PRIMARY_SOURCES.manageRevisions}: a non-progressive release is "available to 100% of devices`,
      '     with the snap installed."',
      '     So a stable release reaches every existing install within hours, with no user action. That is',
      '     [ADR 031] class A — owner-only, per instance, never inferred from the agent holding the',
      `     capability. Use ${DEFAULT_CHANNEL} or another non-stable risk; promotion is a human act.`,
    ]);
  }
  ok(`PG-3 risk policy — ${parsedChannels.map((c) => `${c.track}/${c.risk}${c.branch ? `/${c.branch}` : ''}`).join(', ')}; none is "${REFUSED_RISK}"`);

  // ── PG-4 · the lane ────────────────────────────────────────────────────────
  // 🔴 --submit REFUSES OUTSIDE GITHUB ACTIONS, and that is the gate, not a
  // limitation. The reviewer approval ADR 031 requires exists in exactly one
  // place — a GitHub environment on a job — so a submission that runs anywhere
  // else has, by construction, not passed it. It is also the only place
  // `snapcraft` exists: the owner's box is Windows and generate-snapcraft.mjs
  // already records that `snapcraft` does not run there.
  if ((process.env.GITHUB_ACTIONS ?? '') !== 'true' || (process.env.GITHUB_REPOSITORY ?? '').trim() === '') {
    die([
      'FAIL --submit runs only inside GitHub Actions (GITHUB_ACTIONS=true and GITHUB_REPOSITORY set).',
      `     [ADR 031:117-124] the publish gate is a GitHub environment ("${PUBLISH_ENVIRONMENT}") carrying a`,
      '     REQUIRED REVIEWER. That approval is recorded in a run\'s history and exists nowhere else, so a',
      '     submission from a laptop is not "the same thing without the paperwork" — it is the control',
      '     removed. Dispatch .github/workflows/submit-snap.yml instead.',
    ]);
  }

  // ── PG-5 · the lane is SHAPED like a gated lane, read from its own YAML ────
  // 🔴 DERIVED, NEVER DECLARED. Three properties are read out of the workflow
  // that invokes this script, so removing any of them FAILS the submission
  // instead of quietly widening it:
  //   (a) the job carries `environment:` — without it GitHub has no gate to
  //       apply, and the reviewer never sees the run;
  //   (b) the SAME job runs assert-snapcraft-generable.mjs BEFORE the submit
  //       step. That guard is the only thing that grades the GENERATED recipe —
  //       the recipe is never committed, so there is no reviewed file to fall
  //       back on, and two of its rules (the SPDX licence, the launcher's icon
  //       path) were learned from a real `snapcraft pack` refusing;
  //   (c) the SAME job PACKS, before the submit step. The one thing this channel
  //       cannot tolerate is submitting a package some other run produced: there
  //       is no signature on a .snap to compare (keyKind "none"), so provenance
  //       here is "this job built the bytes it is sending" or it is nothing.
  {
    const registerPeek = read(REGISTER);
    let subWorkflowRel = '.github/workflows/submit-snap.yml';
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
        '     PG-5 reads the gate\'s shape out of it. With the file gone there is nothing to read, and a',
        '     submission whose lane cannot be inspected is one whose gate cannot be shown to exist.',
      ]);
    }
    const jobsRunningSubmit = [...wf.jobs.values()].filter((j) =>
      j.logical.some((l) => /submit-snap\.mjs/.test(l.text) && /--submit\b/.test(l.text)),
    );
    if (jobsRunningSubmit.length === 0) {
      die([
        `FAIL no job in ${subWorkflowRel} invokes \`submit-snap.mjs --submit\`.`,
        '     This script is running with --submit, so it was invoked by SOMETHING the workflow does not',
        '     declare. Either the lane was edited out from under the gate, or the submission is being',
        '     driven from somewhere the gate does not reach. Both are the same refusal.',
      ]);
    }
    for (const job of jobsRunningSubmit) {
      if (!job.lines.some((l) => /^ {4}environment:/.test(l.text))) {
        die([
          `FAIL ${subWorkflowRel} job "${job.name}" runs \`--submit\` and declares no \`environment:\`.`,
          '     [ADR 031:117-124] the gate IS the environment. A job without one runs the moment it is',
          '     dispatched, with no approval and no record of one.',
        ]);
      }
      const submitAt = job.logical.find((l) => /submit-snap\.mjs/.test(l.text) && /--submit\b/.test(l.text));
      for (const [needle, why] of [
        [
          RECIPE_GUARD,
          'That guard is the only thing that grades the recipe this package was built from. The recipe is GENERATED and never committed, so there is no reviewed file behind it — an ungraded recipe is an unreviewed one.',
        ],
        [
          PACK_VERB,
          'A .snap carries no signature of ours to check (this row\'s keyKind is "none" — Canonical signs). "This job packed the bytes it is sending" is the only provenance this channel has, and it is readable only from the YAML.',
        ],
      ]) {
        const at = job.logical.find((l) => l.text.includes(needle));
        if (!at) {
          die([`FAIL ${subWorkflowRel} job "${job.name}" runs \`--submit\` and never runs \`${needle}\`.`, `     ${why}`]);
        }
        if (at.n > submitAt.n) {
          die([
            `FAIL ${subWorkflowRel} job "${job.name}" runs \`${needle}\` at line ${at.n}, AFTER the submit step at`,
            `     line ${submitAt.n}. ${why}`,
          ]);
        }
      }
    }
    ok(`PG-5 lane shape — ${subWorkflowRel} gates the submit job on an environment, and grades and packs before it sends`);
  }

  // ── PG-6 · the environment EXISTS and carries a REQUIRED REVIEWER ──────────
  // 🔴 THIS IS THE LIMB WITHOUT WHICH `environment:` IS DECORATION.
  //   ${PRIMARY_SOURCES.githubEnvironments}, VERBATIM:
  //     "Running a workflow that references an environment that does not exist
  //      will create an environment with the referenced name."
  // A freshly created environment has NO protection rules, so the job proceeds
  // immediately, unapproved, and the run history shows an environment as if a
  // gate had been honoured. `environment:` on its own FAILS OPEN.
  //
  // ⚠️ MEASURED, NOT ASSUMED: on 2026-08-09 this repository's three existing
  // environments each returned `"protection_rules": []`.
  //
  // The remedy is the same read submit-play.mjs makes, against the same
  // environment. Source: ${PRIMARY_SOURCES.githubEnvironmentsApi} — "GET
  // /repos/{owner}/{repo}/environments/{environment_name}", whose response
  // carries `protection_rules`, and "Anyone with read access to the repository
  // can use this endpoint". The assertion is on a NON-EMPTY `reviewers` list
  // rather than on the label `required_reviewers`, which could not be confirmed
  // from a rendered example — an assertion keyed to an unconfirmed string fails
  // OPEN if the string is different.
  {
    const repo = process.env.GITHUB_REPOSITORY.trim();
    const ghToken = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '').trim();
    if (ghToken === '') {
      die([
        'FAIL --submit needs GITHUB_TOKEN to read the publish environment\'s protection rules.',
        '     Without it PG-6 cannot tell a gated environment from one GitHub auto-created when this',
        '     workflow first named it, and those two look identical from inside the job. Pass',
        '     `GITHUB_TOKEN: ${{ github.token }}` on the submit step.',
      ]);
    }
    const envUrl = `https://api.github.com/repos/${repo}/environments/${PUBLISH_ENVIRONMENT}`;
    let res;
    try {
      res = await fetch(envUrl, {
        headers: {
          authorization: `Bearer ${ghToken}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'nikatru-submit-snap',
        },
      });
    } catch (e) {
      die([`FAIL PG-6 could not reach ${envUrl} (${e.message}). A gate that cannot be read has not been shown to exist.`]);
    }
    if (res.status === 404) {
      die([
        `FAIL the "${PUBLISH_ENVIRONMENT}" environment does not exist in ${repo}.`,
        '     [ADR 031:117-124] the publish gate IS that environment plus a required reviewer, and GitHub',
        '     documents that referencing a missing environment CREATES it — with no protection rules — so',
        '     relying on `environment:` alone would have let this run publish unapproved while looking',
        '     gated. Creating it is a repo-admin act and belongs to a human; the exact `gh api` commands',
        '     are in the header of .github/workflows/submit-play.yml, and this channel uses the SAME',
        '     environment rather than a second one.',
      ]);
    }
    if (!res.ok) die([`FAIL PG-6 got HTTP ${res.status} from ${envUrl}. A gate that cannot be read has not been shown to exist.`]);
    const envJson = await res.json().catch(() => ({}));
    const rules = Array.isArray(envJson.protection_rules) ? envJson.protection_rules : [];
    const reviewerRule = rules.find((r) => Array.isArray(r?.reviewers) && r.reviewers.length > 0);
    if (!reviewerRule) {
      die([
        `FAIL the "${PUBLISH_ENVIRONMENT}" environment exists in ${repo} and carries NO required reviewer.`,
        `     protection_rules = ${JSON.stringify(rules)}`,
        '     An environment with no rules does not pause anything — the job runs the instant it is',
        '     dispatched. That is the state GitHub leaves behind when a workflow auto-creates one, and it',
        '     is indistinguishable from a real gate anywhere except here.',
      ]);
    }
    ok(
      `PG-6 publish gate — "${PUBLISH_ENVIRONMENT}" carries ${reviewerRule.reviewers.length} required reviewer(s); this job only reached this line because one of them approved it`,
    );
  }

}

// ── the register is the single declaration everything below reads ────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The channel row and the metadata contract both live there. With it gone every validation below',
    'would range over undefined and pass by having nothing to check.',
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
    'This script exists to submit to exactly that row. Without it there is no artifact format and no',
    'metadata directory template to validate.',
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
    'and reports the listing complete — exactly the shape [10]D-5 exists to remove.',
  ]);
}
const extraFiles = contract?.perChannel?.[CHANNEL_ID]?.additionalFiles ?? [];
const maxLines = contract?.perChannel?.[CHANNEL_ID]?.maxLines ?? {};
const maxChars = contract?.perChannel?.[CHANNEL_ID]?.maxChars ?? {};
const urlFiles = new Set(contract?.urlFiles ?? []);

/** Unicode CODE POINTS of the trimmed text — the same counting rule
 *  assert-store-metadata.mjs and submit-play.mjs use, and for the same reason
 *  (storeMetadataContract.perChannel._why). `.length` is UTF-16 units and would
 *  score one astral character as two, rejecting copy the store accepts. */
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

console.log(`── Snap Store submission path · app "${app.slug}" · channel "${CHANNEL_ID}" ──`);
console.log(`   mode: ${DRY_RUN ? 'DRY RUN (nothing leaves this machine, and `snapcraft` is not invoked)' : 'SUBMIT (a real `snapcraft upload`)'}`);
console.log('');

// ── 1. the metadata tree ─────────────────────────────────────────────────────
const metaDir = String(channel.storeMetadataDir ?? '').replace('{app}', app.slug);
if (metaDir === '') {
  coverageLost([`channel "${CHANNEL_ID}" declares no \`storeMetadataDir\` — there is no listing to submit.`]);
}
if (!existsSync(abs(metaDir)) || !statSync(abs(metaDir)).isDirectory()) {
  die([
    `FAIL the store metadata tree ${metaDir} does not exist.`,
    '     [10]D-5: the listing lives in the repo and the dashboard is a copy of it. With no tree there',
    '     is nothing to submit but whatever somebody last typed into snapcraft.io.',
  ]);
}

// 🔴 THIS BLOCK REPLACED A CHECK THAT ONLY WATCHED FOR A LIMIT IT COULD NOT
// ENFORCE. Until 2026-08-11 this script FAILED if the register grew a maxChars
// or maxLines for this channel, on the correct ground that "a limit that looks
// enforced would not be". The right end of that trade is to enforce them, using
// the same reader submit-play.mjs uses — including the rule that a limit
// arriving without a `source` is a FAULT rather than a licence to enforce a
// remembered number. An invented limit fires on CORRECT input; this repo has
// already rejected its own fixture at 129 characters against a made-up "120".
//
// ⚠️ THE REGISTER STILL DECLARES NO NUMBER FOR THIS CHANNEL, so nothing below
// fires today, and that remains the finding rather than an oversight. What IS
// now sourced and would belong there, in the increment that adds it with its
// citation: ${PRIMARY_SOURCES.snapcraftYaml} gives `summary` — the key
// generate-snapcraft.mjs emits FROM short-description.txt — as "A short
// description of the project. Maximum length 78 characters." The same page
// gives `title` no maximum at all, so the widely-repeated "40" stays UNVERIFIED
// and unenforced. Two fields, one number: that asymmetry is the whole discipline.
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
      problems.push(`${p} is not a single absolute https URL: ${JSON.stringify(url)}.`);
    }
  }

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
        problems.push(`${p} is ${n} characters; the Snap Store caps this field at ${charLimit.max}. Source: ${charLimit.source}`);
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
  ok(`metadata tree ${metaDir} — ${filesChecked} field(s) present and non-empty, ${limitsChecked} within a SOURCED Snap Store limit`);
}

// ── [10]D-6 PREFLIGHT — the portfolio-safety gate, run by the RELEASE PATH ────
// 🔴 IN THE SCRIPT AND NOT ONLY IN CI, and the difference is the whole point.
// CI runs assert-submission-safety.mjs on every push in its PORTFOLIO mode; that
// proves the taglines are distinct across apps, and it proves nothing about the
// app somebody is submitting RIGHT NOW. The `--submitting` mode's
// web-prove-first rule can only be asked at the moment of a submission.
//
// A strike attaches to the PUBLISHER, so the cost of getting this wrong is every
// other app in the portfolio losing distribution at once (L21).
{
  // Resolved from THIS FILE, never from ROOT: `--repo-root` points the CHECKS
  // at another tree (that is how the tests drive this script), and the guard
  // itself always lives beside the release scripts.
  const safety = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-submission-safety.mjs');
  const r = spawnSync(process.execPath, [safety, ROOT, '--submitting', '--app', app.slug], { encoding: 'utf8' });
  if (r.status !== 0) {
    die(['FAIL the [10]D-6 submission-safety preflight refused this submission:', `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd()]);
  }
  ok('[10]D-6 preflight — distinct tagline, and the app is live on the web before a store sees it');
}

// ── 2. the snap name — the one irreversible field ────────────────────────────
// It is not validated against the store (that would BE the claim). What is
// checked is that the repo holds a single, syntactically usable name, because
// `snapcraft register` takes it verbatim and the namespace is global.
//
// ⚠️ THE CHARACTER RULES ARE UNVERIFIED. ${PRIMARY_SOURCES.register} states that
// `register` takes "the snap name to register" and says nothing about its
// alphabet. The shape below (lowercase letters, digits and hyphens; not starting
// or ending with a hyphen) is what every published snap name observably looks
// like, and it is applied as a SHAPE check with that caveat rather than as a
// sourced limit — it can only reject a name no snap has ever had, so it cannot
// fire on correct input the way a guessed LENGTH limit would.
const NAME_FILE = 'snap-name.txt';
let snapName = null;
const snapNameRaw = read(`${metaDir}/${NAME_FILE}`);
if (snapNameRaw === null) {
  problems.push(
    `${metaDir}/${NAME_FILE} is missing. It holds the GLOBAL Snap Store namespace this app intends to claim, and it exists precisely so that name is reviewable before \`snapcraft register\` takes it.`,
  );
} else {
  const candidate = snapNameRaw.trim();
  if (candidate.includes('\n')) {
    problems.push(`${metaDir}/${NAME_FILE} contains more than one line. A snap has exactly one name; two candidates means nobody decided.`);
  } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(candidate)) {
    problems.push(
      `${metaDir}/${NAME_FILE} is ${JSON.stringify(candidate)}, which is not the shape a snap name takes (lowercase letters, digits and hyphens; not leading or trailing a hyphen). ⚠️ The authoritative character rules are UNVERIFIED — this is a shape check, not a sourced limit.`,
    );
  } else {
    snapName = candidate;
    ok(`snap name "${snapName}" — one line, usable shape (availability is UNVERIFIED and cannot be checked without claiming it)`);
    prints.push(
      `SNAP NAME REGISTRATION IS UNVERIFIABLE FROM HERE — "${snapName}" is the name this repo intends to claim. ${PRIMARY_SOURCES.publishASnap} makes registration a PRECONDITION of uploading ("register your snap's name"), and ${PRIMARY_SOURCES.register} makes it a SEPARATE command, so nothing on this path can claim it by accident: an upload against an unregistered name fails at the store and costs one run. \`snapcraft register ${snapName}\` is the entirety of OWNER_QUEUE A-6 and is an owner action.`,
    );
  }
}

// ── 3. the artifact ──────────────────────────────────────────────────────────
// ⚠️ THIS PATH IS OURS, NOT A SNAPCRAFT CONTRACT. snapcraft writes
// `<name>_<version>_<arch>.snap` into its working directory; where this repo
// collects it is a convention this repo chooses, and submit-snap.yml's pack step
// MOVES the file here rather than guessing. The register's artifactFormats is
// what decides whether the file is even the right KIND.
const artifactRel = `apps/${app.slug}/build/linux/snap/${app.slug}.snap`;
const acceptedFormats = (channel.artifactFormats ?? []).filter((f) => typeof f === 'string');
if (!acceptedFormats.some((f) => artifactRel.endsWith(f))) {
  problems.push(
    `the configured output ${artifactRel} matches none of the formats channel "${CHANNEL_ID}" accepts (${acceptedFormats.join(', ')}). The packaging convention and the register disagree about what this channel takes.`,
  );
}

let artifactBytes = 0;
if (existsSync(abs(artifactRel))) {
  artifactBytes = statSync(abs(artifactRel)).size;
  if (artifactBytes === 0) {
    problems.push(`${artifactRel} exists and is ZERO bytes. A truncated snap uploads and fails review.`);
  } else {
    ok(`artifact ${artifactRel} — ${(artifactBytes / 1024 / 1024).toFixed(1)} MiB`);
  }
} else if (ALLOW_MISSING_ARTIFACT) {
  prints.push(`NO PACKAGED ARTIFACT — ${artifactRel} is not on disk and --allow-missing-artifact was passed, so the listing was validated and the package was not.`);
} else {
  problems.push(
    `${artifactRel} does not exist. .github/workflows/submit-snap.yml packs one immediately before running this script — a run reaching here from that lane means the pack step produced nothing while exiting 0. Pass --allow-missing-artifact to validate the listing alone, which is a weaker claim and is not what the lane makes.`,
  );
}

// ── 4. where the recipe comes from ───────────────────────────────────────────
// 🔴 THIS SECTION PRINTED "NO SNAPCRAFT RECIPE — nothing in this repo can build a
// .snap today" ON EVERY RUN UNTIL 2026-08-09, AND BY THEN IT WAS FALSE. The
// recipe landed on 2026-08-08 — GENERATED by the register's declared
// `submission.recipeScript`, never committed, because a committed snapcraft.yaml
// is a second copy of five facts that already have one home each. This section
// only ever looked for a COMMITTED file, so the arrangement that closed the gap
// was invisible to the check that reported it.
const RECIPE_CANDIDATES = [`apps/${app.slug}/snap/snapcraft.yaml`, `apps/${app.slug}/snapcraft.yaml`];
const recipe = RECIPE_CANDIDATES.find((r) => existsSync(abs(r)));
const recipeScript = typeof channel.submission?.recipeScript === 'string' ? channel.submission.recipeScript : null;
if (recipe) {
  ok(`snapcraft recipe ${recipe}`);
} else if (recipeScript !== null && existsSync(abs(recipeScript))) {
  // ⚠️ THE RECIPE IS NOT VALIDATED HERE, and saying so is the point. This script
  // sees the packaging INPUT declared and present; whether it still derives a
  // complete recipe from the tree is tooling/ci/assert-snapcraft-generable.mjs's
  // question — and PG-5 above refuses a --submit whose lane did not ask it.
  ok(
    `recipe generator ${recipeScript} — the recipe is DERIVED at build time and never committed, so none of ` +
      `${RECIPE_CANDIDATES.join(', ')} exists BY DESIGN. Its contents are graded by tooling/ci/${RECIPE_GUARD}, not here.`,
  );
} else {
  prints.push(
    `NO SNAPCRAFT RECIPE — none of ${RECIPE_CANDIDATES.join(', ')} exists and ${REGISTER} names no \`submission.recipeScript\` that does, so nothing in this repo can build a .snap. ` +
      'The register\'s row already records the shape it must take ([ADR 015] §3): ingest the prebuilt CI artifact via `plugin: dump`, bundle libmpv via `stage-packages: [libmpv2]`, and declare `plugs: [opengl, wayland, x11, audio-playback]`.',
  );
}

// ── 5. credentials — presence only, never values ─────────────────────────────
// `snapcraft` authenticates non-interactively from an exported credential blob
// held in ONE environment variable. Source: ${PRIMARY_SOURCES.authenticate} —
// "To authenticate using exported credentials, place the file contents into an
// environment variable: export SNAPCRAFT_STORE_CREDENTIALS=$(cat
// <credentials-filename>)". The blob itself comes from
// ${PRIMARY_SOURCES.exportLogin} — `snapcraft export-login [options]
// <login-file>` — whose reach can be narrowed at issue time with `--snaps`,
// `--channels`, `--acls` and `--expires` ("Date/time (in ISO 8601) when this
// exported login expires"). Nothing here reads or prints the value.
//
// 🔴 THE CREDENTIAL SHOULD BE ISSUED NARROW, AND THE SCRIPT CANNOT CHECK THAT.
// A blob issued with no flags "will have access to all snaps, channels, and
// ACLs associated with your account" (${PRIMARY_SOURCES.authenticate}). Which
// ACLs a given blob carries is readable only by `snapcraft whoami`, whose OUTPUT
// FORMAT is not documented on ${PRIMARY_SOURCES.whoami} — so --submit runs
// `whoami` as a liveness proof and does NOT parse it. Issue it with
// `--snaps <name> --channels <non-stable> --expires <date>`; that is a runbook
// instruction, not something this file can enforce.
const credentialPresent = (process.env[CREDENTIAL_ENV] ?? '').trim() !== '';
if (credentialPresent) {
  ok(`credentials — ${CREDENTIAL_ENV} present (value never read or printed)`);
} else {
  const line = `CREDENTIALS NOT CONFIGURED — ${CREDENTIAL_ENV} absent. It is the exported store credential \`snapcraft\` reads for a non-interactive upload, and it cannot exist before OWNER_QUEUE A-6.`;
  if (SUBMIT) problems.push(`${line} --submit cannot authenticate without it.`);
  else prints.push(line);
}

// ── 6. the channel this run would use ────────────────────────────────────────
if (DRY_RUN) {
  prints.push(
    `CHANNEL: ${parsedChannels.map((c) => `${c.track}/${c.risk}${c.branch ? `/${c.branch}` : ''}`).join(', ')}${opt('channel') === null && !process.env.SNAP_CHANNEL ? ` (default — no --channel given)` : ''}. The RISK is validated against the published closed set ${RISKS.join('/')} (${PRIMARY_SOURCES.channels}); the TRACK is not, because custom tracks exist and an allowlist would reject correct input.`,
  );
  // A dry run that silently accepts a channel --submit would refuse teaches the
  // wrong lesson: the person reads "DRY RUN OK" and learns the spec is fine.
  const wouldRefuse = parsedChannels.filter((c) => c.risk === REFUSED_RISK);
  if (wouldRefuse.length > 0) {
    prints.push(
      `🔴 THIS CHANNEL SPEC WOULD BE REFUSED BY --submit — ${wouldRefuse.map((c) => JSON.stringify(c.spec)).join(', ')} names the "${REFUSED_RISK}" risk, which is where installs land by default (${PRIMARY_SOURCES.channels}) on a store that refreshes them automatically (${PRIMARY_SOURCES.autoUpdate}). [ADR 031] class A. The dry run still exits 0 because it validated a listing, not a decision.`,
    );
  }
}

// ── what a green run here still does NOT prove ───────────────────────────────
// 🔴 PRINTED ON EVERY RUN, INCLUDING SUCCESSFUL ONES. The store's own review is
// the step nothing in this repository can anticipate:
// ${PRIMARY_SOURCES.publishASnap}, verbatim: "After receiving the upload, the
// store performs an automated review of the snap file. If no errors are found,
// the store makes the snap immediately available to users." So review is
// automatic and happens ON UPLOAD, and `--release` only takes effect "if the
// store review passes" (${PRIMARY_SOURCES.upload}).
// ${PRIMARY_SOURCES.storeApiV1} enumerates the build-status codes and one of
// them is `need_manual_review`, so an automatic pass is not guaranteed.
// ${PRIMARY_SOURCES.classicReview}: "the review process in the snap store will
// flag for human review snaps that specify classic confinement" — the recipe
// this repo generates is `confinement: strict` (generate-snapcraft.mjs exports
// CONFINEMENT), so that particular trigger does not apply to us. Whether a
// first submission of a CLOSED-SOURCE snap draws a manual review for any OTHER
// reason is NOT stated on any page fetched, and is not asserted here.
prints.push(
  `STORE REVIEW IS AUTOMATIC AND IS NOT THIS SCRIPT'S VERDICT — an accepted upload is not a published snap. ${PRIMARY_SOURCES.publishASnap} · ${PRIMARY_SOURCES.storeApiV1} (status code \`need_manual_review\` exists).`,
);
for (const u of UNSOURCED) {
  prints.push(`UNSOURCED: ${u.gap}  → ${u.limb}`);
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
  console.error('\nsubmit-snap: FAILED');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('');
  console.log('submit-snap: DRY RUN OK — nothing was sent to the Snap Store, and `snapcraft` was not invoked.');
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'Private/company/runbooks/store-submission-snap.md'}`);
  console.log('   ⬜ The register keeps linux-snap `served: false`, and [10]D-9 has no submission record.');
  console.log('      Only an owner-approved dispatch of submit-snap.yml --submit can create one.');
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// --submit · THE SNAP STORE UPLOAD, THROUGH `snapcraft`
//
// Two invocations, both from ${PRIMARY_SOURCES.upload}, ${PRIMARY_SOURCES.whoami}
// and ${PRIMARY_SOURCES.authenticate}. No HTTP request is made from this file to
// the Snap Store — see `UNSOURCED` for why that is a decision and not an
// omission.
// ═════════════════════════════════════════════════════════════════════════════
const snapAbs = abs(artifactRel);
const channelArg = parsedChannels.map((c) => `${c.track}/${c.risk}${c.branch ? `/${c.branch}` : ''}`).join(',');

/** Run `snapcraft`.
 *
 *  🔴 TWO OUTPUT POSTURES, AND THE DIFFERENCE IS PII, NOT STYLE.
 *  `discardOutput: false` (the upload) inherits the runner's stdio, so
 *  snapcraft's own diagnosis reaches the log unmodified — that output is about
 *  the PACKAGE and is exactly what a reader needs. `discardOutput: true`
 *  (`whoami`) captures and THROWS AWAY: ${PRIMARY_SOURCES.authenticate} says
 *  that command "displays your email, username, account ID, permissions,
 *  channel restrictions, and expiration timestamp", and a workflow log on a
 *  PUBLIC repository is not a place to put the owner's email address. Only the
 *  exit code crosses back, which is all the liveness check ever needed. No
 *  `--verbosity debug` on either: it is the one flag that could plausibly echo
 *  more of the credential context than the default does. */
function snapcraft(args, what, { discardOutput = false } = {}) {
  step(`snapcraft ${args.join(' ')}${discardOutput ? '   (output discarded — it carries account identifiers)' : ''}`);
  const r = spawnSync('snapcraft', args, { stdio: discardOutput ? 'ignore' : 'inherit', cwd: ROOT });
  if (r.error && r.error.code === 'ENOENT') {
    return {
      failed: [
        `FAIL \`snapcraft\` is not on PATH, so ${what} could not run.`,
        '     The lane installs it with `sudo snap install snapcraft --classic` before this step.',
        `     The register names it in this row's minimumToolchain; ${REGISTER}'s notes record that no`,
        '     version track for it has been sourced, so the lane takes whatever latest/stable holds.',
      ],
    };
  }
  if (r.error) return { failed: [`FAIL ${what} could not be started: ${r.error.message}`] };
  if (r.status !== 0) {
    return {
      failed: [
        `FAIL ${what} exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}.`,
        '     snapcraft printed its own diagnosis above; this script does not paraphrase it, because a',
        '     paraphrase of a store error is the thing that gets read instead of the error.',
      ],
    };
  }
  return { failed: null };
}

let failure = null;

// ── S1 · prove the credential is live BEFORE sending a package ───────────────
// Source: ${PRIMARY_SOURCES.authenticate} — "Verify your exported credentials
// work by executing: snapcraft whoami". It is a READ, never gated (ADR 031:
// "Reading is never gated"), and it is first because the alternative is
// discovering an expired credential halfway through a transfer.
//
// ⚠️ ITS OUTPUT IS NEITHER PARSED NOR PRINTED, for two different reasons.
// Not parsed: the format is undocumented (${PRIMARY_SOURCES.whoami} lists no
// fields), so reading a field out of it would be inventing a contract — which
// is why this script cannot check the credential's EXPIRY or its ACL scope even
// though ${PRIMARY_SOURCES.authenticate} says both are in there. Not printed:
// the same sentence says it "displays your email, username, account ID,
// permissions, channel restrictions, and expiration timestamp", and this
// repository is PUBLIC. Exit code only.
{
  const r = snapcraft(['whoami'], 'the credential liveness check (`snapcraft whoami`)', { discardOutput: true });
  if (r.failed) {
    failure = [
      ...r.failed,
      `     Nothing was uploaded. Re-issue the credential with \`snapcraft export-login\` and reinstall it as the`,
      `     ${CREDENTIAL_ENV} repository secret (${PRIMARY_SOURCES.exportLogin}).`,
    ];
  } else {
    ok('credential accepted by the Snap Store (`snapcraft whoami` exited 0; its output was not parsed)');
  }
}

// ── S2 · upload, and release in the SAME call ────────────────────────────────
// Source: ${PRIMARY_SOURCES.upload} — "snapcraft upload [options] <snap-file>";
// `<snap-file>` is "Snap to upload."; `--release` is "Optional comma-separated
// list of channels to release to."; and, verbatim, "By passing --release with a
// comma-separated list of channels the snap would be released to the selected
// channels if the store review passes." ${PRIMARY_SOURCES.publishASnap} shows
// the same one-step form: `snapcraft upload --release=stable <my-snap>.snap`.
//
// 🔴 ONE STEP, ON PURPOSE, AND IT IS THE GAP THAT CHOSE IT. The two-step form
// (`snapcraft release <name> <revision> <channels>`) needs a REVISION ID, and
// no page fetched documents a machine-readable one — see UNSOURCED[0]. Rather
// than scrape snapcraft's human output for a number, this path uses the form
// that never needs it. `--release` is also the only half that is CONDITIONAL on
// the store review passing, which is the correct place for the risk to sit.
if (failure === null) {
  const r = snapcraft(['upload', snapAbs, `--release=${channelArg}`], `the upload of ${artifactRel} to ${channelArg}`);
  if (r.failed) {
    // 🔴 THERE IS NO ROLLBACK TO OFFER AND SAYING SO IS THE HONEST ANSWER.
    // submit-play.mjs deletes its half-created edit because the Play API has an
    // edit lifecycle to unwind. Snap has none: a revision that reached the store
    // exists, and the only reverse verb documented anywhere fetched is closing a
    // channel (`POST /dev/api/snaps/{snap_id}/close`,
    // ${PRIMARY_SOURCES.storeApiV1}) — which needs the header UNSOURCED[1]
    // names. So the failure is reported with what is and is not known about
    // where it stopped, rather than with a cleanup that did not happen.
    failure = [
      ...r.failed,
      '     ⚠️ NO ROLLBACK WAS ATTEMPTED, AND NONE IS AVAILABLE FROM THIS SCRIPT. If the failure came after',
      '     the transfer, a revision may exist in the store even though no channel points at it — which is',
      '     inert, not live. Read the state at https://snapcraft.io/snaps/ (or `snapcraft status`,',
      `     ${PRIMARY_SOURCES.status}) before re-running: a second upload creates a second revision.`,
    ];
  }
}

if (failure) {
  console.error('');
  for (const l of failure) console.error(l);
  console.error('\nsubmit-snap: FAILED');
  process.exitCode = 1;
} else {
  console.log('');
  console.log('submit-snap: UPLOADED.');
  console.log(`   Package ${artifactRel} · snap name ${snapName ?? '(unread)'} · channels ${channelArg}`);
  console.log(`   ⬜ RELEASED ONLY IF THE STORE REVIEW PASSED — "the snap would be released to the selected`);
  console.log(`      channels if the store review passes" (${PRIMARY_SOURCES.upload}). snapcraft printed the`);
  console.log('      channel map above; this script does not parse it and makes no claim from it.');
  console.log(`   ⬜ The revision id is UNSOURCED (see UNSOURCED[0]), so no promotion between risks is possible`);
  console.log(`      from here. Promoting to "${REFUSED_RISK}" is [ADR 031] class A — owner-only, per instance.`);
  console.log('   ⬜ [10]D-9 LEDGER: this is the event limb (iii) of D-10 has been waiting for. Record it.');
  process.exitCode = 0;
}
