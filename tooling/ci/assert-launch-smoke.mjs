#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-launch-smoke.mjs — nothing is published without being launched once,
// BEFORE PUBLICATION.
//
// [pipeline 9]R-13 "Every artifact a release publishes has been started at least
//                  once on its target platform, before publication."
//
// 🔴 KEEP THE WORDS *BEFORE PUBLICATION*. `[14]O-7` smokes a LIVE ENVIRONMENT
// after a deploy and can roll it back. R-13 smokes the ARTIFACT before anything
// has shipped, where there is nothing to roll back because nothing is live.
// Duplicate D-14 was re-confirmed on exactly that distinction, and a future fold
// that loses these words moves the check to after the damage. The ordering rule
// below is those words expressed as something a build can fail on.
//
// ── THE CRITERION R-13 SHIPPED WITH HAD AN UNBOUNDED ESCAPE HATCH ────────────
// It read: *"…where no headless path exists, the check is a recorded human step
// for that channel."* Nothing defined *recorded*, nothing bounded *"where no
// headless path exists"*, and the register holds one served row — so the whole
// criterion resolved through the disjunction and every hard platform slid out.
// It is the shape `[8]K-7` was flagged for: a disjunction with one branch that
// is always satisfiable.
//
// So it is split by MECHANISM AVAILABILITY, because the two halves have
// different owners and only one of them may block a build:
//
//   (a) BUILD-FAILING — a register row that is `served: true` and whose every
//       platform has a launch mechanism CI can actually run. Its lane must
//       launch what it just built and assert a DEFINED READY SIGNAL, ordered
//       after the build and before the publish. Missing ⇒ red.
//
//   (b) PRINTS EVERY RUN, NEVER FAILS — everything else, with a dated
//       who / what / why record. iOS and macOS have no headless path at all
//       without an Apple device and Apple is DEFERRED BY OWNER DECISION
//       (OWNER_QUEUE A-4); a build-failing rule on owner-gated work blocks every
//       CI run on something only the owner can unblock. That is the posture
//       assert-seams-wired.mjs established for [pipeline C-6] and CLAUDE.md
//       states as a rule.
//
// ── THE (a) SET IS DERIVED FROM THE REGISTER, NEVER HAND-LISTED ──────────────
// Without that, (a) shrinks to nothing the moment somebody marks a channel
// unpublished and the printed half absorbs everything — so an EMPTY (a) set
// while the register holds a served channel is COVERAGE LOST, not a pass.
//
// ⚠️ THE REMAINING SHRINK — unserving EVERY channel, which would leave nothing
// for that rule to quantify over — is NOT re-checked here, and that is a
// decision rather than an oversight. `assert-channel-register.mjs` already owns
// it and already fails on it: mutation-proven 2026-08-03 against a scratch copy
// of the real tree, flipping the `web` row to `served: false` produces
// `COVERAGE LOST — tooling/channel-register.json has 8 channel(s) and NONE is
// served`. Re-implementing that floor here would be a second copy of one rule,
// and two copies of a rule drift in the direction that reports clean.
//
// What is NOT in the register is whether a runner can START a given platform's
// artifact: that is a fact about CI, not about the channel, and inventing a
// register field for it would put a CI capability in a document about
// distribution. It lives in LAUNCH_MECHANISM below — and every platform any row
// names must appear there, so the map cannot go stale by omission.
//
// Usage:  node tooling/ci/assert-launch-smoke.mjs [repoRoot]
// Exit 0 = every served, launchable channel launches its artifact before it ships.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, shellSegments } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = 'tooling/channel-register.json';

const problems = [];
const ok = (m) => console.log(`ok   ${m}`);
const note = (m) => console.log(`--   ${m}`);
const fail = (m) => problems.push(m);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-launch-smoke: FAILED');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAN CI START AN ARTIFACT OF THIS PLATFORM, AND WITH WHAT?
//
// `script: null` is not a waiver and not "someday" — it is a dated claim about
// what this CI can prove today, and it is PRINTED on every run so it cannot
// quietly become permanent. Two of these say "possible but not built" and say
// which half is missing; two say "no path exists at all" and name the owner.
// Nothing here invents a smoke for a platform CI cannot run.
// ─────────────────────────────────────────────────────────────────────────────
const LAUNCH_MECHANISM = new Map([
  [
    'web',
    {
      script: 'tooling/smoke/smoke-web-artifact.mjs',
      how: 'the built bundle is served on loopback and loaded in headless Chrome over the DevTools Protocol',
      since: '2026-08-03',
    },
  ],
  [
    'linux',
    {
      script: null,
      why:
        'STARTING one is available (an ubuntu runner can run the bundle under xvfb) but there is no DEFINED ' +
        'READY SIGNAL a Flutter GTK binary emits that this repo can assert, and "the process did not exit" is ' +
        'the zero-exit check R-13 explicitly rejects. Not built because both Linux rows are `served: false`.',
      since: '2026-08-03',
    },
  ],
  [
    'windows',
    {
      script: null,
      why:
        'same missing half as linux — no defined ready signal from a Flutter Windows binary — and the store ' +
        'artifact is an .msix, which must be INSTALLED before it can be started, needing a trusted signature ' +
        'the `windows-store` row records as `keyKind: none` because the Store re-signs. Both rows `served: false`.',
      since: '2026-08-03',
    },
  ],
  [
    'android',
    {
      script: null,
      why:
        'needs an emulator on the runner — minutes of runner time per run — and the artifact Play accepts is an ' +
        '.aab, which is not installable at all (Google re-splits it per device), so a launch would smoke the ' +
        '.apk and not the thing that ships. Row is `served: false` behind OWNER_QUEUE A-3.',
      since: '2026-08-03',
    },
  ],
  [
    'ios',
    {
      script: null,
      why:
        'NO headless path exists without an Apple device, and Apple is DEFERRED BY OWNER DECISION ' +
        '(OWNER_QUEUE A-4). This is the half that must never be build-failing: it would block every CI run on ' +
        'work only the owner can unblock.',
      since: '2026-08-03',
    },
  ],
  [
    'macos',
    {
      script: null,
      why:
        'a macOS runner could in principle open the .app, but the channel is `served: false` behind the same ' +
        'owner-deferred Apple enrolment (OWNER_QUEUE A-4) and no ready signal exists for a Flutter macOS ' +
        'binary either. Owner-gated work prints, never fails.',
      since: '2026-08-03',
    },
  ],
]);

// ── the register ────────────────────────────────────────────────────────────
const registerPath = join(ROOT, REGISTER);
if (!existsSync(registerPath)) {
  coverageLost([
    `${REGISTER} is missing under ${ROOT}, so the (a) set is empty and this guard would certify nothing.`,
  ]);
}
let channels;
try {
  channels = JSON.parse(readFileSync(registerPath, 'utf8')).channels;
} catch (e) {
  coverageLost([`${REGISTER} could not be parsed (${e.message}), so no channel could be graded.`]);
}
if (!Array.isArray(channels) || channels.length === 0) {
  coverageLost([`${REGISTER} declares no channels, so both halves of R-13 range over nothing.`]);
}

// Every platform any row names must be classified. A row carrying a platform
// this map has never heard of would otherwise fall out of BOTH halves — neither
// smoked nor printed — which is how a requirement stops covering something
// without anybody deciding that it should.
const unclassified = [...new Set(channels.flatMap((c) => c.platforms ?? []))].filter((p) => !LAUNCH_MECHANISM.has(p));
if (unclassified.length) {
  coverageLost([
    `${unclassified.length} platform(s) in ${REGISTER} are absent from LAUNCH_MECHANISM: ${unclassified.join(', ')}.`,
    'An unclassified platform is in neither the build-failing half nor the printed half, so its channel would',
    'ship without ever being launched and without anything saying so.',
  ]);
}

const launchable = (c) => (c.platforms ?? []).length > 0 && (c.platforms ?? []).every((p) => LAUNCH_MECHANISM.get(p)?.script);
const served = channels.filter((c) => c.served === true);
const mustSmoke = served.filter(launchable);

if (served.length > 0 && mustSmoke.length === 0) {
  coverageLost([
    `${served.length} channel(s) are \`served: true\` and NONE of them resolved into the build-failing half.`,
    'The (a) set is derived so that it cannot be quietly emptied; an empty one while something is being served',
    'means the printed half has absorbed everything and this guard asserts nothing at all.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) BUILD-FAILING
// ─────────────────────────────────────────────────────────────────────────────

/** A step that produces the artifact. Release is Flutter's DEFAULT build mode,
 *  so `--release` is not required — the same correction assert-release-provenance
 *  had to make after an ungated `flutter build appbundle` was invisible to it. */
const BUILD_CMD = /flutter\s+build\s+(?!web-server\b)\S+/;

/** A step that hands the artifact to something outside the run.
 *
 *  ⚠️ DELIBERATELY A SEPARATE, SMALLER LIST than assert-release-provenance.mjs's
 *  `PUBLISH`. That guard asks "was this publish gated and recorded", and counts
 *  a GitHub release upload and a store submission too. This one asks a narrower
 *  question — "what is the FIRST thing in this job that makes the artifact
 *  reachable by a user" — and it must not be satisfied by a step that publishes
 *  nothing. A shared list would have to serve both meanings and would end up
 *  serving neither. */
const PUBLISH_CMD = [
  { re: /wrangler[^\n]*\bdeploy\b|pages\s+deploy/, what: 'a Cloudflare deploy' },
  { re: /cloudflare\/wrangler-action/, what: 'the Cloudflare deploy action' },
];

const firstMatch = (job, test) => job.logical.find((l) => test(l.text)) ?? null;
const lastMatch = (job, test) => [...job.logical].reverse().find((l) => test(l.text)) ?? null;

for (const c of mustSmoke) {
  const mech = LAUNCH_MECHANISM.get(c.platforms[0]);
  const script = mech.script;

  // The ready signal must still BE a signal. A smoke reduced to "load the page
  // and exit 0" reads identically in a run log and proves what R-13's criterion
  // calls out by name: not merely a zero exit.
  const scriptPath = join(ROOT, script);
  if (!existsSync(scriptPath)) {
    fail(`channel \`${c.id}\` is served and launchable, but its launch mechanism ${script} does not exist.`);
    continue;
  }
  const src = readFileSync(scriptPath, 'utf8');
  const signalId = src.match(/id:\s*'([^']+)'/)?.[1] ?? '';
  const signalExpr = src.match(/expression:\s*'([^']*)'/)?.[1] ?? '';
  if (!/export const READY_SIGNAL\s*=/.test(src) || !signalId || !signalExpr.trim()) {
    fail(
      `${script} no longer declares an \`export const READY_SIGNAL\` with a non-empty \`id\` and \`expression\`. ` +
        'Without one the smoke step degrades to "the browser opened and exited 0", which R-13 rejects by name ' +
        'and which is indistinguishable from a working check in a run log.',
    );
  }

  const wfRel = c.lane?.workflow;
  const jobName = c.lane?.job;
  if (!wfRel || !jobName) {
    fail(
      `channel \`${c.id}\` is served and launchable but declares no \`lane.workflow\` + \`lane.job\`, so there ` +
        'is no job in which a launch could be required. A served channel with no lane is a channel nothing can smoke.',
    );
    continue;
  }
  const wf = parseWorkflow(ROOT, wfRel);
  if (!wf) {
    fail(`channel \`${c.id}\` names lane workflow ${wfRel}, which does not exist.`);
    continue;
  }
  const job = wf.jobs.get(jobName);
  if (!job) {
    fail(
      `channel \`${c.id}\` names job \`${jobName}\` in ${wfRel} and this scan could not find it, so the smoke ` +
        'step could be anywhere or nowhere.',
    );
    continue;
  }

  // 🔴 NO `#` BEFORE THE MATCH, PER SHELL SEGMENT. The define check in
  // assert-seams-wired.mjs learned this the hard way: a `#` inside a `run: >`
  // folded scalar is a SHELL comment that swallows the rest of the line, so a
  // smoke behind a comment marker is prose and not a step — and YAML
  // comment-blanking does not catch it, because the `#` is inside a run body.
  //
  // ⚠️ PER SEGMENT AND NOT PER LINE, or the rule over-fires. workflow-scan joins
  // a `run: |` block with ` ; ` because each of those lines is its own shell
  // command, so a `#` on an EARLIER command does not comment out a later one —
  // applying the rule to the joined line would report a perfectly live smoke as
  // commented out. A false red on a correct tree is how a guard gets switched off.
  const esc = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const runsScript = (t) => shellSegments(t).some((s) => new RegExp(`^[^#]*${esc}`).test(s));
  const smokeLine = firstMatch(job, runsScript);
  if (!smokeLine) {
    fail(
      `${wfRel} job \`${jobName}\` (the lane of served channel \`${c.id}\`) never runs ${script}, so the ` +
        'artifact it publishes has never been started. A build that completes and does not start is green in ' +
        'every other lane in this repository — a wrong base href, an asset declared and missing, an exception ' +
        'in main() before the first frame all fail at first launch and nowhere earlier.',
    );
    continue;
  }

  const lastBuild = lastMatch(job, (t) => BUILD_CMD.test(t));
  const firstPublish = firstMatch(job, (t) => PUBLISH_CMD.some((p) => p.re.test(t)));
  let ordered = true;

  if (!lastBuild) {
    ordered = false;
    fail(
      `${wfRel} job \`${jobName}\` runs ${script} but this scan found no \`flutter build\` in it, so the smoke ` +
        'has nothing of this run to launch and would be testing whatever happened to be on disk.',
    );
  } else if (smokeLine.n < lastBuild.n) {
    ordered = false;
    fail(
      `${wfRel} job \`${jobName}\` runs ${script} at :${smokeLine.n}, BEFORE its last build at :${lastBuild.n}. ` +
        'A smoke that runs before the build launches the previous artifact, or nothing at all.',
    );
  }
  if (firstPublish && smokeLine.n > firstPublish.n) {
    ordered = false;
    fail(
      `${wfRel} job \`${jobName}\` runs ${script} at :${smokeLine.n}, AFTER ${PUBLISH_CMD.find((p) => p.re.test(firstPublish.text))?.what ?? 'a publish'} at ` +
        `:${firstPublish.n}. R-13's subject is the artifact BEFORE publication — smoking it afterwards is [14]O-7's ` +
        'question, on a deployment that has already reached users.',
    );
  }
  if (!firstPublish) {
    // Not a failure: a lane may legitimately build and smoke without publishing
    // (a dry run, a proof lane). Said OUT LOUD, because "the launch is before
    // publication" must never be printed over a job where there was no
    // publication to be before.
    note(`${c.id} — ${wfRel}:${jobName} smokes the artifact and performs no publish in this job, so "before publication" is vacuous here`);
  } else if (ordered) {
    ok(
      `${c.id} — ${wfRel}:${jobName} builds at :${lastBuild.n}, launches it at :${smokeLine.n} (${mech.how}), ` +
        `publishes at :${firstPublish.n} — the launch is BEFORE publication`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) PRINTS EVERY RUN, NEVER FAILS
// ─────────────────────────────────────────────────────────────────────────────
const printed = channels.filter((c) => !mustSmoke.includes(c));
for (const c of printed) {
  const blockers = (c.platforms ?? []).filter((p) => !LAUNCH_MECHANISM.get(p)?.script);
  const why = blockers.length
    ? blockers.map((p) => `${p}: ${LAUNCH_MECHANISM.get(p).why}`).join(' | ')
    : 'the platform is launchable in CI, but the channel is not served, so there is nothing being published to gate';
  const when = blockers.length ? LAUNCH_MECHANISM.get(blockers[0]).since : LAUNCH_MECHANISM.get(c.platforms[0]).since;
  note(
    `${c.id} — NOT LAUNCH-SMOKED. what: ${(c.artifactFormats ?? []).join(', ') || 'no declared format'} on ` +
      `${(c.platforms ?? []).join(', ')}, served=${c.served === true}. who: ${c.ownerQueue ? `OWNER_QUEUE ${c.ownerQueue}` : 'no owner-queue row'}. ` +
      `recorded ${when}. why: ${why}`,
  );
}

console.log(
  `\n${mustSmoke.length} channel(s) must launch before publishing, ${printed.length} printed; ` +
    `${channels.length} row(s) in ${REGISTER}, ${LAUNCH_MECHANISM.size} platform(s) classified`,
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-launch-smoke: FAILED');
  process.exitCode = 1;
} else {
  console.log('assert-launch-smoke: ok');
}
