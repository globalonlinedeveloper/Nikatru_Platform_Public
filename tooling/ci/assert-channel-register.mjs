#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-channel-register.mjs — the factory releases only to channels it has
// declared, and never a partial set.
//
// [pipeline R-5] "One declaration names every channel the factory can release
//                to; a release either produces the complete artifact set for its
//                declared channels or produces nothing."
//
// WHY. Nine acceptance criteria across stages 9 and 10 quantify over "the served
// set", and the served set did not exist. An undefined right-hand side cannot
// reject anything, so all nine reported clean over nothing — the identical
// empty-domain shape C-1 found for capabilities and S-3 found for platforms.
//
// The criterion R-5 shipped with was itself vacuous in BOTH directions: "a guard
// fails if a release job exists for a channel absent from the register (or vice
// versa)" — zero release jobs on one side, one uncontested row on the other.
// Neither direction could ever produce a mismatch. So this guard is written to
// the replacement acceptance: anchor the register to a set that already exists
// and is already maintained, `sites/_shared/_data/apps.json`.
//
// Checks, in order:
//   1. COVERAGE self-check — the register exists, is non-empty, and something in
//      it is SERVED. D-1 requires the missing-register case to be the LOUD one,
//      because it is the case that was true for the whole life of the spec.
//   2. schema — every row is complete enough to be quantified over, ELEMENT
//      types included, against the key vocabulary the REGISTER declares (never a
//      second copy in here), and a store row names the OWNER_QUEUE id [10]D-4
//      maps it to
//   3. SERVED rows carry what R-3/R-4/R-6/D-9 need: an artifact format, an
//      identity with a restore drill, a lane, a deployment-environment template,
//      and a pinned toolchain floor. HAVING a lane is served-only; a lane that IS
//      named must resolve to a real workflow JOB whether the row is served or not
//      — deferred rows build their lane before their account exists ([10]D-5/D-10)
//   3b. the lane's OUTPUT is compared to the formats its channel accepts —
//      served rows FAIL a mismatch, deferred rows PRINT one, which is how the
//      recorded ".aab required, `flutter build apk` shipped" gap becomes visible
//      on every run instead of living in a note
//   4. direction A — every apps.json `platforms` value resolves to a SERVED row
//   5. direction B — every SERVED row is claimed by a real app. Without this the
//      way to pass is to declare channels nobody ships to, which is cut 5's
//      corollary ("remove 'six platforms' from site copy until it is true")
//      growing back as data instead of prose.
//   6. the AGGREGATING JOB's `needs` equals every other job in its workflow —
//      the "never a partial set" half. Parsed structurally, comments stripped.
//   7. disqualified channels name a LOCKED ADR that exists on disk
//   6d. a `signing.*` block carrying a `notYetConfiguredSentinel` — a pinned
//      certificate fingerprint or public key — is complete, dated and sourced.
//      Every field still on the sentinel means NOT YET CONFIGURED: a SERVED row
//      FAILS, a deferred row PRINTS. SOME fields real and some still sentinel
//      FAILS either way, because a half-filled identity ships cleanly under the
//      wrong name. Added 2026-08-08 with the windows-direct and linux-appimage
//      pins, so that neither landed as a field nothing reads — the defect this
//      register records catching on `uploadCertificate.alias`.
//   8. [9]R-3 LIMB 2 — every `${{ secrets.X }}` a workflow names is DECLARED in
//      the register, as signing material on a row or as non-signing with a
//      reason. An undeclared name FAILS; a declared name no lane uses PRINTS.
//      This was the open clause: until 2026-08-06 nothing in the tree read
//      `signing.ciSecrets`, so the register documented the secrets without
//      being an authority over them.
//   8b. and every DECLARED signing secret carries a written `why`, the same
//      requirement `ciSecretRegister.nonSigning` entries have always had. The
//      partition had the rule on one side only, so for any row §9 cannot reach
//      — every non-Android row — pasting a name into `signing.ciSecrets.names`
//      silenced limb 2 with no reason recorded and nothing to review.
//   9. [9]R-3 REGISTER ↔ GRADLE — the same declaration compared to the REAL
//      `apps/*/android/app/build.gradle.kts`, which is where the signing
//      identity is actually read. Section 8 compares the register to the
//      WORKFLOWS and stopped there, and its own header recorded the hole: "a
//      rename in Gradle alone is still silent". It is not, now.
//
// ⚠️ DEFERRED-ROW GAPS PRINT, THEY DO NOT FAIL. Apple's Xcode 26 floor is real
// and unpinned, and the channel is owner-deferred (OWNER_QUEUE A-4). Per the
// standing rule (assert-seams-wired.mjs, [pipeline C-6]) a guard on owner-gated
// work prints the gap on every run rather than blocking all CI on work only the
// owner can do. A known gap nobody sees becomes permanent.
//
// 🔴 CI CANNOT SEE Private/ — ONE directory since the 2026-08-15 flatten merged
// company/ + knowledge/ into it. It is gitignored (.gitignore:22-23) and absent
// from the public checkout. Two consequences, and the second one bit this guard
// on its own first CI run:
//   · [10]D-4's OWNER_QUEUE limbs are NOT implementable in CI at all. The
//     register carries the row ids as data; asserting on them is local-only.
//   · every ADR path a guard cites is unresolvable in CI. This guard's
//     disqualified-channel check failed on run 30609219162 for exactly that
//     reason — a correct check reporting a fault that did not exist.
// The fix is NOT to drop the check and it is NOT a silent skip ("silence is not
// success"). It is to decide from the HARNESS ROOT: if Private/ is present the
// full check runs and a deleted or downgraded ADR fails; if Private/ is absent
// ENTIRELY the guard says so, loudly, on every run. A single missing ADR inside a
// present Private/ is still a failure — which is the case that matters, and it
// is the one a blanket existsSync() skip would have thrown away.
//
// Usage:  node tooling/ci/assert-channel-register.mjs [repoRoot]
// Exit 0 = the register, the apps and the workflows agree. 1 = they do not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
/** No argument means CI's own invocation against the real repository, where the
 *  Android row MUST exist. A fixture root is a weaker situation and says so
 *  (section 9) instead of quietly accepting a register with nothing to check.
 *  Same idiom, same reason, as assert-android-target-sdk.mjs. */
const scanningRealRepo = process.argv[2] === undefined;
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';
const VERSIONS = 'tooling/versions.json';

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null);

/** COVERAGE LOST is fatal on the spot: every check below quantifies over the
 *  thing that is missing, so continuing would report "clean" over nothing —
 *  which is the exact defect this guard exists to remove. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-channel-register: FAILED');
  process.exit(1);
}

/** The signing-key vocabulary is DERIVED from the register below, never declared
 *  here. It used to be a private literal in this file listing the same six kinds
 *  the register declares with their loss consequences one directory away — the
 *  second declaration [pipeline F-2] exists to forbid. Assigned after the parse. */
let KEY_KINDS;
const KINDS = new Set(['web', 'store', 'direct']);
/** Flutter's platform names — the vocabulary apps.json `platforms` speaks. A
 *  register row claiming a value outside this set can never be resolved against
 *  an app, so it would sit here forever looking like coverage. */
const PLATFORMS = new Set(['android', 'ios', 'linux', 'macos', 'web', 'windows']);

// ── 1. COVERAGE ──────────────────────────────────────────────────────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'Nine acceptance criteria across stages 9 and 10 quantify over the served-channel set:',
    '[9]R-3, [9]R-4, [9]R-5, [9]R-6, [10]D-1, [10]D-4, [10]D-5, [10]D-9, [10]D-10.',
    'With no register they all range over an undefined set and report clean forever.',
    'This must be the loud case: it was true for the entire life of the spec.',
  ]);
}

let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`, 'Nothing downstream can be checked.']);
}

const channels = Array.isArray(register.channels) ? register.channels : null;
if (channels === null) {
  coverageLost([`${REGISTER} has no \`channels\` array.`, 'The register is the wrong shape; every check below has no domain.']);
}
if (channels.length === 0) {
  coverageLost([
    `${REGISTER} declares ZERO channels.`,
    'An empty register makes "every claim resolves to a row" vacuously true, so a catalogue could',
    'claim any platform at all and this guard would still print ok.',
  ]);
}

const served = channels.filter((c) => c.served === true);
if (served.length === 0) {
  coverageLost([
    `${REGISTER} has ${channels.length} channel(s) and NONE is served.`,
    'The factory would be declaring that it releases nowhere, while apps.json claims a live platform.',
    'If a channel is genuinely being retired, retire the app claim in the same increment.',
  ]);
}

// 🔴 THE SIGNING-KEY VOCABULARY IS THE REGISTER'S, NOT THIS GUARD'S.
// Review 2026-07-31 (mutation-proven): the six key kinds were a private literal
// in this file while `keyKinds` sat in the register declaring the same six with
// their loss consequences, read by nothing. Deleting the whole dictionary exited
// 0 "ok", and so did renaming `app-signing-key` out from under the eight rows
// still using that name — rows validating against a vocabulary the register no
// longer documents is exactly the drift [pipeline F-2] exists to prevent, in the
// file whose own prose says a second declaration is the first to drift.
const keyKindDefs = register.keyKinds;
if (
  keyKindDefs === null ||
  typeof keyKindDefs !== 'object' ||
  Array.isArray(keyKindDefs) ||
  Object.keys(keyKindDefs).length === 0
) {
  coverageLost([
    `${REGISTER} declares no \`keyKinds\` vocabulary.`,
    'Every signing check below asks whether a row\'s keyKind is IN that vocabulary, and the vocabulary is',
    'this file. With the dictionary gone the question ranges over an empty set: it would reject every row',
    'for the wrong reason, and a permissive rewrite would accept every typo. [9]R-3 quantifies over signing',
    'identities — the dictionary that names their kinds cannot be optional.',
  ]);
}
KEY_KINDS = new Set(Object.keys(keyKindDefs));
for (const [k, v] of Object.entries(keyKindDefs)) {
  if (typeof v !== 'string' || v.trim() === '') {
    problems.push(
      `${REGISTER} keyKinds."${k}" has no definition text. An emptied definition still satisfies every \`KEY_KINDS.has(...)\` check while telling a reader nothing — and the difference between the kinds IS the loss consequence, which is the only reason the field exists.`,
    );
  }
}

const appsRaw = read(APPS);
if (appsRaw === null) {
  coverageLost([`${APPS} does not exist — the register has nothing to be checked against.`]);
}
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) {
  coverageLost([
    `${APPS} carries no app entries.`,
    'Both directions below compare the register to the app catalogue. With no apps, direction A has',
    'nothing to check and direction B fails every served row for the wrong reason.',
  ]);
}

ok(`${channels.length} channel(s) declared, ${served.length} served; ${apps.length} app(s) in the catalogue`);

// ── 2 + 3. schema, and what a SERVED row must carry ──────────────────────────
const versionsRaw = read(VERSIONS);
let versions = {};
if (versionsRaw === null) {
  problems.push(`${VERSIONS} is missing — no toolchain floor can be resolved.`);
} else {
  try {
    versions = JSON.parse(versionsRaw);
  } catch (e) {
    problems.push(`${VERSIONS} is not valid JSON — ${e.message}`);
  }
}
/** A pinned key is one with a real scalar value. `$comment` arrays are prose. */
const isPinned = (k) => Object.hasOwn(versions, k) && typeof versions[k] === 'string' && versions[k] !== '';

const seenIds = new Set();
const workflowCache = new Map();
/** Where CI's committed manifest lives. Declared HERE, beside the parser that
 *  reads it, because the `submission.recipeScript` check below names it and runs
 *  hundreds of lines before section 8 — where this used to be declared. */
const WORKFLOW_DIR = '.github/workflows';
/** [10]D-10 limb (i): how many `submission` blocks were resolved all the way to
 *  a job that actually runs the named script. Zero, with blocks declared, means
 *  the resolution stopped reaching them — see the self-check after the loop. */
let submissionsResolved = 0;
/** The same accounting for `submission.recipeScript` — a packaging step that is
 *  declared and actually invoked by a workflow. */
let packagingResolved = 0;

/** Parse a workflow's job names structurally. Comments are stripped first: this
 *  repo has shipped the "matched the prose describing the check" defect twice,
 *  most recently in assert-stamp-platforms.mjs, whose own header records it. */
function workflow(rel) {
  if (workflowCache.has(rel)) return workflowCache.get(rel);
  const raw = read(rel);
  let parsed = null;
  if (raw !== null) {
    // Full-line AND trailing comments. Review 2026-07-31 (mutation-proven):
    // stripping only full-line comments meant `wasm:   # experimental` was
    // invisible as a JOB to this parser — while assert-release-provenance.mjs
    // parsed it fine — so an inline-commented job silently escaped the
    // never-a-partial-set check. The two parsers now strip identically.
    const stripped = raw.replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '');
    const lines = stripped.split('\n');
    const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    const jobs = new Map();
    if (jobsAt !== -1) {
      let current = null;
      for (let i = jobsAt + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\S/.test(line)) break; // back to top level — jobs: is over
        const m = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
        if (m) {
          current = m[1];
          jobs.set(current, []);
        } else if (current !== null) {
          jobs.get(current).push(line);
        }
      }
    }
    // Coverage self-check on the parse itself. A workflow with top-level keys
    // but no jobs means the stripper or the matcher has eaten the file, and
    // every "does this job exist" question below would be asked of an empty map.
    const rawTopLevel = (raw.match(/^[a-z]+:/gm) ?? []).length;
    parsed = { jobs, rawTopLevel, strippedLines: lines.length };
  }
  workflowCache.set(rel, parsed);
  return parsed;
}

/** Which tracked workflows actually invoke `scriptRel`, anywhere in any job.
 *
 *  Comments are blanked first, both full-line and trailing — the same reduction
 *  `workflow()` above performs, and for the same reason this file has already
 *  paid for twice: a commented-out step and a comment ABOUT a step read
 *  identically to a bare text scan, so prose would satisfy the check. The match
 *  is on the path as written, which is how every workflow in this repo invokes a
 *  tooling script; a computed path would not be comparable to the register at
 *  all, which is the same objection section 8 raises against `secrets[…]`. */
function workflowsInvoking(scriptRel) {
  const dir = abs(WORKFLOW_DIR);
  if (!existsSync(dir)) return [];
  const hits = [];
  for (const entry of listDir(dir)) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const rel = `${WORKFLOW_DIR}/${entry}`;
    const raw = read(rel);
    if (raw === null) continue;
    const stripped = raw.replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '');
    if (stripped.includes(scriptRel)) hits.push(rel);
  }
  return hits;
}

for (const c of channels) {
  const id = typeof c.id === 'string' ? c.id : '(unnamed)';
  const where = `channel "${id}"`;
  const req = (cond, msg) => {
    if (!cond) problems.push(`${where} — ${msg}`);
    return cond;
  };

  req(typeof c.id === 'string' && /^[a-z][a-z0-9-]*$/.test(c.id), 'has no lower-kebab `id`.');
  if (seenIds.has(id)) problems.push(`${where} — duplicate id. Two rows for one channel means one of them is never consulted.`);
  seenIds.add(id);

  const platformsOk = req(
    Array.isArray(c.platforms) && c.platforms.length > 0,
    'declares no `platforms`. A row nothing can resolve to is coverage that does not exist.',
  );
  if (platformsOk) {
    for (const p of c.platforms) {
      req(PLATFORMS.has(p), `names platform "${p}", which is not one of ${[...PLATFORMS].join(', ')} — no apps.json claim can ever resolve to it.`);
    }
  }
  req(KINDS.has(c.kind), `has kind "${c.kind}"; expected one of ${[...KINDS].join(', ')}.`);
  req(typeof c.served === 'boolean', 'has no boolean `served` flag — the published/unpublished flag [9]R-3 and [9]R-4 both read.');
  req(typeof c.submittable === 'boolean', 'has no boolean `submittable` flag ([10]D-10 quantifies over it).');
  const formatsOk = req(
    Array.isArray(c.artifactFormats) && c.artifactFormats.length > 0,
    'declares no `artifactFormats`. [9]R-4 compares a release asset set to it, and the lane-vs-format comparison in section 3b below reads it to decide whether the lane emits anything this channel accepts — both need this field to be non-empty.',
  );
  // 🔴 ELEMENT TYPES, not just the array. Review 2026-07-31 (mutation-proven):
  // `[null]` satisfies Array.isArray + length > 0, so the served web row could
  // declare a format that is not a format and this guard printed ok. Worse since
  // #83 made assert-channel-claims.mjs DERIVE its public-surface scan patterns
  // from this same field: a non-string element reached `fmt.startsWith('.')` and
  // CRASHED that guard with a raw TypeError, which is not a complaint. Same
  // element treatment `platforms` already gets above.
  if (formatsOk) {
    for (const f of c.artifactFormats) {
      req(
        typeof f === 'string' && f.trim() !== '',
        `declares artifactFormat ${JSON.stringify(f)}, which is not a non-empty string. A format that is not a string cannot be compared to a lane's output, cannot be turned into a scan pattern, and satisfies a length check while meaning nothing.`,
      );
    }
  }
  const signingOk = req(c.signing !== null && typeof c.signing === 'object', 'has no `signing` block.');
  if (signingOk) {
    req(KEY_KINDS.has(c.signing.keyKind), `signing.keyKind is "${c.signing.keyKind}"; expected one of ${[...KEY_KINDS].join(', ')}. An upload key and an app signing key have different loss consequences and the register must say which it holds.`);
    req(
      c.signing.restoreDrill !== null && typeof c.signing.restoreDrill === 'object',
      'has no `signing.restoreDrill` record. [9]R-3 requires a DATED restore drill per published channel.',
    );
  }
  const toolchainOk = req(
    Array.isArray(c.minimumToolchain),
    'has no `minimumToolchain` array (names tooling/versions.json KEYS, never values — [pipeline F-2]).',
  );
  // Same element-type gap as artifactFormats: a non-string key can never be
  // pinned in versions.json, so the isPinned() check below would compare it to
  // nothing and the row would look like it carried a floor.
  if (toolchainOk) {
    for (const k of c.minimumToolchain) {
      req(
        typeof k === 'string' && k.trim() !== '',
        `names toolchain key ${JSON.stringify(k)}, which is not a non-empty string. ${VERSIONS} can never pin it, so the floor this row claims to have is unresolvable by construction.`,
      );
    }
  }
  req(
    c.storeMetadataDir === null || typeof c.storeMetadataDir === 'string',
    '`storeMetadataDir` must be a path template or null ([10]D-5 reads it).',
  );
  if (c.kind === 'store') {
    req(
      typeof c.storeMetadataDir === 'string' && c.storeMetadataDir.includes('{app}'),
      'is a store channel with no `storeMetadataDir` template. [10]D-5 requires one metadata directory per declared channel, per app.',
    );
    req(c.submittable === true, 'is a store channel but is not `submittable`. A store you cannot submit to is not a store channel.');
    // [10]D-4 "every store channel has a publisher account" is mapped by the
    // register's own _readme onto `kind=store + ownerQueue`. The id's CONTENTS
    // stay uncheckable in CI by design (Private/ is gitignored, and the _readme
    // says so) — but its PRESENCE needs nothing private, and without this check
    // the mapping was decorative: found 2026-07-31 with linux-snap already
    // shipping `kind: "store"` + `ownerQueue: null`, and nulling the ids on ALL
    // FIVE store rows still exited 0 "ok". A shape check is the half of D-4 that
    // is implementable here, so it is the half that must actually run.
    req(
      typeof c.ownerQueue === 'string' && c.ownerQueue.trim() !== '',
      'is a store channel with no `ownerQueue` id. [10]D-4 maps "every store channel has a publisher account" onto kind=store + ownerQueue; a store row naming no queue row is an account nobody is accountable for opening, and CI cannot read the queue itself to notice.',
    );
  }

  // ── a lane, WHENEVER ONE IS NAMED, resolves to a real workflow job ────────
  // 🔴 NOT ONLY ON SERVED ROWS. Hardened 2026-08-01: lane resolution used to
  // live entirely inside the `served === true` branch, so a DEFERRED row could
  // name any workflow and any job at all and nothing looked. That was harmless
  // while every deferred lane was `null` — and stopped being harmless the moment
  // [10]D-5/D-10 started building a channel's path BEFORE its account exists,
  // which is the whole point of those requirements: windows-store's lane emits
  // the .msix today with `served: false`. A lane naming a job nobody wrote is a
  // lane that runs nothing whether or not the channel ships, and the register's
  // own §3b comparison silently reads an EMPTY job body for it and concludes
  // "nothing to compare" — a gap that prints as a pass.
  //
  // The requirement to HAVE a lane stays served-only: a deferred channel with no
  // lane yet is the correct, expected state (five of the eight rows).
  const laneNamed = c.lane !== null && c.lane !== undefined;
  const laneShaped =
    laneNamed && typeof c.lane === 'object' && typeof c.lane.workflow === 'string' && typeof c.lane.job === 'string';
  if (c.served === true && !laneShaped) {
    problems.push(`${where} is SERVED but names no \`lane\` {workflow, job}. [9]R-6 resolves the gated commit from the lane, and [9]R-2 derives the version there — neither has a subject without it.`);
  } else if (laneNamed && !laneShaped) {
    problems.push(
      `${where} names a \`lane\` that is not {workflow: string, job: string}. A malformed lane resolves to nothing and is skipped by every check that reads it, so it looks exactly like coverage.`,
    );
  } else if (laneShaped) {
    const lane = c.lane;
    const state = c.served === true ? 'SERVED' : 'deferred';
    const wf = workflow(lane.workflow);
    if (wf === null) {
      problems.push(`${where} is ${state} and its lane names ${lane.workflow}, which does not exist.`);
    } else if (wf.rawTopLevel > 0 && wf.jobs.size === 0) {
      coverageLost([
        `${lane.workflow} has ${wf.rawTopLevel} top-level key(s) and ZERO parsed jobs.`,
        'The workflow parser has stopped reaching the file, so every "does this job exist" answer',
        'below is being read off an empty map and would print ok.',
      ]);
    } else if (!wf.jobs.has(lane.job)) {
      problems.push(
        `${where} is ${state} and claims lane job "${lane.job}" in ${lane.workflow}, which declares [${[...wf.jobs.keys()].join(', ')}]. A lane naming a job that does not exist is a lane that runs nothing.`,
      );
    }
  }

  // ── a `submission` block, WHENEVER ONE IS NAMED, actually resolves ────────
  // 🔴 [10]D-10 limb (i) IS "a submission script exists AND RESOLVES TO A STEP IN
  // A WORKFLOW, parsed not grepped" — and until this block landed, nothing parsed
  // it. Both submission blocks in this register asserted that property in their
  // own `_why` prose while no line of any guard read `submission` at all
  // (measured 2026-08-01: one grep hit in this file, inside a comment). A
  // requirement that documents its own enforcement and is not enforced is the
  // exact shape D-10's replacement acceptance was written to remove — a claim
  // about a past event that can never re-fail.
  //
  // Deferred rows are checked too, for the same reason lanes are: D-5/D-10 build
  // a channel's path BEFORE its account exists, so the path has to be real while
  // `served` is still false or the whole exercise proves nothing.
  //
  // HAVING a submission block stays optional — three submittable rows legitimately
  // have none (no account, no work started). Those PRINT, because a submittable
  // store channel with no scripted path is [10]D-10's open gap and a gap nobody
  // sees becomes permanent.
  const sub = c.submission;
  if (sub !== null && sub !== undefined) {
    if (typeof sub !== 'object' || Array.isArray(sub)) {
      problems.push(`${where} has a \`submission\` that is not an object. Every check below reads fields off it and would silently skip.`);
    } else {
      const script = sub.script;
      if (typeof script !== 'string' || script.trim() === '') {
        problems.push(`${where} declares a \`submission\` with no \`script\`. [10]D-10 limb (i) is precisely "a submission script exists"; a block naming none satisfies nothing.`);
      } else if (!existsSync(join(ROOT, script))) {
        problems.push(
          `${where} names submission script "${script}", which does not exist. The register would keep pointing at a release path somebody deleted, and the first person to find out is the one submitting.`,
        );
      }
      // ── an OPTIONAL packaging step, when a channel needs one before it can
      //    submit anything at all ──────────────────────────────────────────────
      // `script` is the submission verb; `recipeScript` is the packaging input
      // that verb consumes, and it exists because the Snap channel's recipe is
      // GENERATED rather than committed. It is checked in the same two ways —
      // it must be there, and something must RUN it — but the workflow it has to
      // be run by is deliberately NOT the submission one: the recipe is produced
      // in the build lane beside the bundle it describes, and the upload happens
      // somewhere else entirely. Requiring `sub.job` to invoke it would demand a
      // wiring that would be wrong.
      //
      // 🔴 THE "SOMETHING RUNS IT" HALF IS THE POINT. Without it this field
      // would be a way to SILENCE the orphan check below — declare the path,
      // never call it, and a release script nothing exercises reads as wired.
      // That is the failure this whole section exists to prevent, so the field
      // that could reintroduce it carries the stronger of the two checks.
      const recipeScript = sub.recipeScript;
      if (recipeScript !== null && recipeScript !== undefined) {
        if (typeof recipeScript !== 'string' || recipeScript.trim() === '') {
          problems.push(`${where} declares a \`submission.recipeScript\` that is not a non-empty path.`);
        } else if (!existsSync(join(ROOT, recipeScript))) {
          problems.push(
            `${where} names packaging script "${recipeScript}", which does not exist. The register would keep pointing at a release path somebody deleted, and the first person to find out is the one submitting.`,
          );
        } else {
          const runners = workflowsInvoking(recipeScript);
          if (runners.length === 0) {
            problems.push(
              `${where} names packaging script "${recipeScript}" and no workflow in ${WORKFLOW_DIR} invokes it. A packaging step nothing runs cannot fail a build, so the recipe it produces is never exercised and the submission path is wired to a script that has only ever run by hand.`,
            );
          } else {
            packagingResolved++;
          }
        }
      }
      if (typeof sub.workflow !== 'string' || typeof sub.job !== 'string') {
        problems.push(
          `${where} declares a \`submission\` with no {workflow, job}. "Resolves to a step in a workflow" is the half of limb (i) that stops a script from existing in a directory nobody runs.`,
        );
      } else {
        const wf = workflow(sub.workflow);
        if (wf === null) {
          problems.push(`${where} names submission workflow ${sub.workflow}, which does not exist.`);
        } else if (!wf.jobs.has(sub.job)) {
          problems.push(
            `${where} claims submission job "${sub.job}" in ${sub.workflow}, which declares [${[...wf.jobs.keys()].join(', ')}].`,
          );
        } else if (typeof script === 'string' && script.trim() !== '') {
          // The last link, and the one that makes the other three mean something:
          // the named JOB must actually RUN the named SCRIPT. Without this a row
          // can name a real script and a real job that have nothing to do with
          // each other, and all three checks above pass.
          const body = (wf.jobs.get(sub.job) ?? []).join('\n');
          if (!body.includes(script)) {
            problems.push(
              `${where} names submission script "${script}" and job "${sub.job}" in ${sub.workflow}, and that job never invokes that script. Both halves exist and they are not connected — which reads as a wired submission path and is not one.`,
            );
          } else {
            submissionsResolved++;
          }
        }
      }
    }
  } else if (c.kind === 'store' && c.submittable === true) {
    prints.push(
      `NO SUBMISSION PATH: channel "${c.id}" is a submittable store channel with no \`submission\` block — [10]D-10 limb (i) is unbuilt for it. Blocked on OWNER_QUEUE ${c.ownerQueue ?? '(unnamed)'}; printed rather than failed because starting that work is owner-gated.`,
    );
  }

  // ── what SERVED additionally means ────────────────────────────────────────
  if (c.served === true) {
    if (typeof c.deploymentEnvironment !== 'string' || !c.deploymentEnvironment.includes('{app}')) {
      problems.push(
        `${where} is SERVED but has no \`deploymentEnvironment\` template containing {app}. [10]D-9 derives the required environment set from this register × apps.json, so without the template "what is live on which channel" has no query.`,
      );
    }

    // 🔴 THE DRILL REQUIREMENT IS DERIVED FROM keyKind, NEVER FROM THE ROW.
    // Review 2026-07-31 (mutation-proven): the old check honoured
    // `restoreDrill.required: false`, so the audited row's own boolean decided
    // whether the audit applied — a served channel holding a real key could
    // self-certify its drill away with one word. `required` is now ignored
    // here entirely: a real key on a served channel needs a dated drill, full
    // stop; keyKind "none" needs nothing. The JSON field survives only as
    // documentation of intent.
    if (signingOk && c.signing.keyKind !== 'none') {
      const drill = c.signing.restoreDrill ?? {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(drill.date ?? ''))) {
        problems.push(
          `${where} is SERVED with keyKind "${c.signing.keyKind}" and has no DATED restore drill. [9]R-3: a published channel carries an identity, a format and a dated restore-drill record — and the row's own \`required\` flag cannot waive that, or the audited object decides whether the audit applies.`,
        );
      }
      // [9]R-3's headline is "every signing identity is ENUMERATED" — so the
      // identity must actually be named. Review found `signing.identity` was
      // never read anywhere: the enumeration guarantee enforced nothing.
      if (typeof c.signing.identity !== 'string' || c.signing.identity.trim() === '') {
        problems.push(
          `${where} is SERVED with keyKind "${c.signing.keyKind}" and no \`signing.identity\`. [9]R-3 requires the identity be ENUMERATED — a row that names the kind of key but not the key is a register entry about nothing.`,
        );
      }
    }
    if (signingOk && c.signing.keyKind === 'none' && c.signing.identity !== null) {
      problems.push(
        `${where} has keyKind "none" but a non-null \`signing.identity\`. Either the channel holds a key (name its kind) or it does not (identity must be null) — a named identity on a keyless channel is a contradiction nobody will notice until custody matters.`,
      );
    }

    if (Array.isArray(c.minimumToolchain)) {
      if (c.minimumToolchain.length === 0) {
        problems.push(`${where} is SERVED with an EMPTY toolchain floor. Every real lane depends on some pinned tool; an empty array makes the per-key check below range over nothing.`);
      }
      for (const k of c.minimumToolchain) {
        if (!isPinned(k)) {
          problems.push(
            `${where} is SERVED and its toolchain floor names "${k}", which ${VERSIONS} does not pin. A served channel building on whatever is newest that day is the drift [pipeline F-2] exists to remove.`,
          );
        }
      }
    }
  } else if (Array.isArray(c.minimumToolchain)) {
    // Deferred rows PRINT their unpinned floors. Apple's Xcode 26 requirement is
    // already in force and the channel is owner-deferred — failing here would
    // block all CI on OWNER_QUEUE A-4, which is not ours to close.
    const unpinned = c.minimumToolchain.filter((k) => !isPinned(k));
    if (unpinned.length) {
      prints.push(`${where} (deferred) needs a pinned ${unpinned.map((k) => `\`${k}\``).join(', ')} and ${VERSIONS} has no such key.`);
    }
  }
}

// ── the other direction: a release script no row can reach ───────────────────
// 🔴 THE ASYMMETRY, ONE LEVEL UP. Above, a submittable store row with no
// `submission` block PRINTS, because BUILDING a submission path is owner-gated
// work. Here, a script sitting in tooling/release/ that NO row names FAILS,
// because KEEPING one is not owner-gated — it is the same rule the metadata
// trees follow, and the same orphan check assert-store-metadata.mjs runs against
// apps/*/store/.
//
// Without this, deleting a row's whole `submission` block is invisible: the row
// falls back to the deferred PRINT above and the script it abandoned keeps
// sitting in the release directory looking maintained, wired to nothing, until
// somebody tries to submit with it.
//
// ⚠️ This replaces a COVERAGE-LOST self-check that was written here first and
// then removed for being UNREACHABLE: every path through the block above pushes
// a problem, so "blocks declared, none resolved, nothing complained" could not
// be constructed. An assertion that cannot fail is worse than none — it inflates
// apparent coverage — so it was re-pointed at something that can.
const RELEASE_DIR = 'tooling/release';
if (existsSync(join(ROOT, RELEASE_DIR))) {
  // BOTH declared script fields. `recipeScript` is admitted here only because
  // the block above holds it to a STRONGER standard than `script` — a workflow
  // has to actually invoke it — so it cannot be used as a way to declare a path
  // into silence. Admitting it on the strength of the declaration alone would
  // turn this orphan check into an opt-out, which is precisely what it exists
  // to refuse.
  const declaredScripts = new Set(
    channels
      .flatMap((c) => [c.submission?.script, c.submission?.recipeScript])
      .filter((s) => typeof s === 'string' && s.trim() !== ''),
  );
  for (const entry of listDir(join(ROOT, RELEASE_DIR))) {
    if (!entry.endsWith('.mjs')) continue;
    const rel = `${RELEASE_DIR}/${entry}`;
    if (declaredScripts.has(rel)) continue;
    problems.push(
      `${rel} is a release script that NO channel row names in its \`submission.script\`. [10]D-10 limb (i) makes the register the one place a submission path is declared; an unreferenced script is a path nobody can reach from the register and nothing keeps working. Declare it on its channel or delete it.`,
    );
  }
}
if (submissionsResolved > 0) {
  ok(`${submissionsResolved} submission path(s) resolve to a workflow job that runs the named script [10]D-10 limb (i)`);
}
if (packagingResolved > 0) {
  ok(`${packagingResolved} packaging script(s) declared on a submission block and invoked by a workflow`);
}

// ── 3b. what the lane EMITS vs what the channel ACCEPTS ──────────────────────
// 🔴 THE FIELD WAS ASSERTED NON-EMPTY AND NOTHING MORE. Review 2026-07-31
// (mutation-proven): no line in this guard read `artifactFormats` past the
// length check, so android-play could declare `.banana` and every run printed
// ok — while the register's own notes recorded, in prose, that Play requires
// .aab and the only android lane in the tree runs `flutter build apk`. A
// contradiction the register KNOWS about and no build can fail on is a note,
// not a guard.
//
// SERVED rows FAIL a mismatch. DEFERRED rows PRINT it — the standing rule for
// owner-gated work ([pipeline C-6]): Play submission is deferred by 39-CHASSIS
// §4 cut 5, so failing here would block all CI on work nobody has licensed,
// while staying silent would make the gap permanent. Everything read here is
// .github/, which is in the public repo, so there is no Private/ mode to handle.
//
// What a target leaves on disk, per platform. Deliberately conservative: only
// PACKAGED FILE artifacts are listed, because those are the things a channel
// accepts or refuses. `flutter build linux` produces a bundle DIRECTORY and the
// Linux rows are packaged from it by design ([ADR 015] §3: snap "ingests the
// prebuilt CI artifact via `plugin: dump`"), so claiming a gap there would be
// crying wolf — it contributes no format and therefore no comparison.
const BUILD_TARGETS = new Map([
  ['web', { platform: 'web', formats: ['static-bundle'] }],
  ['apk', { platform: 'android', formats: ['.apk'] }],
  ['appbundle', { platform: 'android', formats: ['.aab'] }],
  ['ios', { platform: 'ios', formats: ['.app'] }],
  ['ipa', { platform: 'ios', formats: ['.ipa'] }],
  ['macos', { platform: 'macos', formats: ['.app'] }],
  ['windows', { platform: 'windows', formats: ['.exe'] }],
  ['linux', { platform: 'linux', formats: [] }],
]);
/** Flutter's output layout, which is how an upload glob names its platform. */
const PATH_PLATFORM = [
  [/build\/app\/outputs|flutter-apk|build\/app\/intermediates/, 'android'],
  [/build\/ios\b/, 'ios'],
  [/build\/macos\b/, 'macos'],
  [/build\/windows\b/, 'windows'],
  [/build\/linux\b/, 'linux'],
  [/build\/web\b/, 'web'],
];
const unknownTargets = new Set();

/** `path:` values of a job's upload steps, scalar and block-scalar forms. */
function uploadPaths(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)path:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const rest = m[2].trim();
    if (rest !== '' && !rest.startsWith('|') && !rest.startsWith('>')) {
      out.push(rest.replace(/^['"]|['"]$/g, ''));
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].search(/\S/) <= indent) break;
      out.push(lines[j].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return out;
}

/** platform -> { formats:Set, where:Set } for one job body. */
function jobEmits(lines, label) {
  const out = new Map();
  const add = (p, f) => {
    if (!PLATFORMS.has(p)) return;
    if (!out.has(p)) out.set(p, { formats: new Set(), where: new Set() });
    out.get(p).formats.add(f);
    out.get(p).where.add(label);
  };
  for (const m of lines.join('\n').matchAll(/flutter\s+build\s+([a-z]+)/g)) {
    const t = BUILD_TARGETS.get(m[1]);
    if (!t) {
      unknownTargets.add(m[1]);
      continue;
    }
    for (const f of t.formats) add(t.platform, f);
  }
  for (const p of uploadPaths(lines)) {
    const ext = p.match(/(\.[A-Za-z][A-Za-z0-9]*)$/);
    if (!ext) continue;
    const hit = PATH_PLATFORM.find(([re]) => re.test(p));
    if (hit) add(hit[1], ext[1]);
  }
  return out;
}

const emitCache = new Map();
function emitsFor(wfRel, jobName) {
  const key = `${wfRel}::${jobName}`;
  if (!emitCache.has(key)) {
    const wf = workflow(wfRel);
    const lines = wf?.jobs.get(jobName) ?? [];
    emitCache.set(key, jobEmits(lines, `${wfRel}:${jobName}`));
  }
  return emitCache.get(key);
}

/** Every job of every workflow the register names — the domain a DEFERRED row's
 *  platform is looked up in ("does anything in this tree already build it?"). */
const allEmits = new Map();
const registerWorkflows = new Set(
  [register.aggregatingJob?.workflow, ...channels.map((c) => c.lane?.workflow)].filter((w) => typeof w === 'string'),
);
for (const rel of registerWorkflows) {
  const wf = workflow(rel);
  if (!wf) continue;
  for (const [jobName] of wf.jobs) {
    for (const [p, e] of emitsFor(rel, jobName)) {
      if (!allEmits.has(p)) allEmits.set(p, { formats: new Set(), where: new Set() });
      for (const f of e.formats) allEmits.get(p).formats.add(f);
      for (const w of e.where) allEmits.get(p).where.add(w);
    }
  }
}

const fmtList = (xs) => [...xs].map((f) => `"${f}"`).join(', ');
let servedLanesChecked = 0;
let servedLanesDetermined = 0;
for (const c of channels) {
  const declared = (c.artifactFormats ?? []).filter((f) => typeof f === 'string' && f.trim() !== '');
  if (declared.length === 0) continue; // already a schema failure above

  if (c.served === true) {
    const lane = c.lane;
    if (!lane || typeof lane.workflow !== 'string' || typeof lane.job !== 'string') continue;
    const wf = workflow(lane.workflow);
    if (wf === null || !wf.jobs.has(lane.job)) continue; // already a failure above
    servedLanesChecked++;
    const emits = emitsFor(lane.workflow, lane.job);
    const seen = new Set();
    for (const p of c.platforms ?? []) for (const f of emits.get(p)?.formats ?? []) seen.add(f);
    if (seen.size === 0) {
      prints.push(
        `LANE ARTIFACTS UNDETERMINED: channel "${c.id}" is SERVED, accepts ${fmtList(declared)}, and its lane ${lane.workflow}:${lane.job} shows no recognisable build step or upload path for ${fmtList(c.platforms ?? [])}. The comparison had nothing to compare — which is a stated gap, not a pass.`,
      );
      continue;
    }
    servedLanesDetermined++;
    if (!declared.some((f) => seen.has(f))) {
      problems.push(
        `channel "${c.id}" is SERVED and accepts ${fmtList(declared)}, but its lane ${lane.workflow}:${lane.job} emits ${fmtList(seen)}. [9]R-3: a lane that emits a format its channel refuses is a green build over an artifact the channel rejects — the same shape as the .apk/.aab gap this register records for Play, except on a channel that is actually live.`,
      );
    }
  } else {
    const seen = new Set();
    const where = new Set();
    for (const p of c.platforms ?? []) {
      const e = allEmits.get(p);
      if (!e) continue;
      for (const f of e.formats) seen.add(f);
      for (const w of e.where) where.add(w);
    }
    if (seen.size === 0) continue; // nothing in the tree builds this platform yet
    if (declared.some((f) => seen.has(f))) continue;
    prints.push(
      `FORMAT GAP (deferred): channel "${c.id}" accepts ${fmtList(declared)} and ${[...where].join(', ')} builds ${fmtList(seen)} for ${fmtList(c.platforms ?? [])}. The green "it builds" tick is a proof about an artifact this channel does not take.`,
    );
  }
}
// A comparison that can no longer read ANY lane is the failure mode this guard
// keeps meeting: it still prints ok while checking nothing.
if (servedLanesChecked > 0 && servedLanesDetermined === 0) {
  coverageLost([
    `${servedLanesChecked} served channel(s) resolve to a real lane job and NOT ONE yielded a readable artifact.`,
    'The build-step and upload-path extraction has stopped reaching the workflows, so every format',
    'comparison above compared a declared format to an empty set and passed by having nothing to check.',
  ]);
}
if (unknownTargets.size) {
  prints.push(
    `UNMAPPED BUILD TARGET(S): ${fmtList(unknownTargets)} — a \`flutter build\` target this guard has no artifact mapping for, so any channel accepting its output is compared against nothing. Add it to BUILD_TARGETS.`,
  );
}

// ── 4. direction A: every claim resolves to a SERVED row ─────────────────────
const servedPlatforms = new Map(); // platform -> [channel ids]
for (const c of served) {
  for (const p of c.platforms ?? []) {
    if (!servedPlatforms.has(p)) servedPlatforms.set(p, []);
    servedPlatforms.get(p).push(c.id);
  }
}
const declaredRows = new Map(); // platform -> [channel ids], served or not
for (const c of channels) {
  for (const p of c.platforms ?? []) {
    if (!declaredRows.has(p)) declaredRows.set(p, []);
    declaredRows.get(p).push(c.id);
  }
}

let claims = 0;
const claimed = new Set();
for (const app of apps) {
  const slug = app.slug ?? '(unnamed app)';
  const platforms = Array.isArray(app.platforms) ? app.platforms : [];
  if (platforms.length === 0) {
    problems.push(
      `${APPS} entry "${slug}" claims NO platforms. An app that reaches nobody is either unpublished — in which case say so — or the claim was dropped, and an empty array makes every per-platform check below pass by having nothing to iterate.`,
    );
    continue;
  }
  for (const p of platforms) {
    claims++;
    claimed.add(p);
    if (servedPlatforms.has(p)) continue;
    const rows = declaredRows.get(p);
    if (rows) {
      problems.push(
        `${APPS} entry "${slug}" claims "${p}", and the register declares ${rows.map((r) => `"${r}"`).join(' and ')} for it — but NOT SERVED. A channel counts only once its row carries an identity and format ([9]R-3), a lane ([9]R-2/R-6), and served: true. Until then the claim is a promise made to a public catalogue with no artifact behind it.`,
      );
    } else {
      problems.push(
        `${APPS} entry "${slug}" claims "${p}" and the register has no row for it at all. Add the channel — with its artifact format, signing identity and lane — or remove the claim.`,
      );
    }
  }
}
if (claims === 0) {
  coverageLost([
    `${APPS} has ${apps.length} entr(ies) and ZERO platform claims between them.`,
    'Direction A would then range over nothing and pass. This is S-3\'s recorded failure exactly:',
    'a requirement about building was satisfied by building none.',
  ]);
}

// ── 5. direction B: no served channel is fiction ─────────────────────────────
// 🔴 PER PLATFORM, not per row. Review 2026-07-31 (mutation-proven): the first
// version fired only when EVERY platform of a served row was orphaned, so
// adding "windows" to the served web row's platforms passed clean — "web" was
// still claimed — and the register's own headline guarantee ("adding windows
// fails the build") was false from the register side. Each platform a served
// row declares must be claimed by some app, individually.
for (const c of served) {
  for (const p of c.platforms ?? []) {
    if (claimed.has(p)) continue;
    problems.push(
      `channel "${c.id}" is SERVED and declares platform "${p}", which no app in ${APPS} claims. A served platform the factory ships nothing to is cut 5's corollary growing back as data: "remove 'six platforms' from site copy until it is true".`,
    );
  }
}

if (!problems.length) {
  ok(`${claims} platform claim(s) across ${apps.length} app(s), every one resolving to a served channel`);
  ok(`every served channel is claimed by a real app`);
}

// ── 6. the aggregating job — "never a partial set" ───────────────────────────
const agg = register.aggregatingJob;
if (agg === null || typeof agg !== 'object' || typeof agg.workflow !== 'string' || typeof agg.job !== 'string') {
  problems.push(
    `${REGISTER} declares no \`aggregatingJob\` {workflow, job}. [9]R-5's second half — a release produces the complete set or nothing — has no subject without it.`,
  );
} else {
  const wf = workflow(agg.workflow);
  if (wf === null) {
    problems.push(`the aggregating job names ${agg.workflow}, which does not exist.`);
  } else if (wf.rawTopLevel > 0 && wf.jobs.size === 0) {
    coverageLost([
      `${agg.workflow} has ${wf.rawTopLevel} top-level key(s) and ZERO parsed jobs.`,
      'The aggregation check below would compare an empty set to an empty set and pass.',
    ]);
  } else if (!wf.jobs.has(agg.job)) {
    problems.push(
      `${agg.workflow} declares [${[...wf.jobs.keys()].join(', ')}] and none of them is "${agg.job}". The aggregating job named by the register does not exist, so nothing requires every platform to be green.`,
    );
  } else {
    const body = wf.jobs.get(agg.job).join('\n');
    const others = [...wf.jobs.keys()].filter((j) => j !== agg.job);
    // `needs:` in either flow ([a, b]) or block (- a) form.
    const flow = body.match(/needs:\s*\[([^\]]*)\]/);
    let needs = [];
    if (flow) {
      needs = flow[1].split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      const at = body.split('\n').findIndex((l) => /^\s*needs:\s*$/.test(l));
      if (at !== -1) {
        for (const line of body.split('\n').slice(at + 1)) {
          const m = line.match(/^\s*-\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/);
          if (!m) break;
          needs.push(m[1]);
        }
      }
    }
    const missing = others.filter((j) => !needs.includes(j));
    const ghost = needs.filter((j) => !wf.jobs.has(j));
    if (missing.length) {
      problems.push(
        `${agg.workflow}: job "${agg.job}" does not \`need\` ${missing.map((j) => `"${j}"`).join(', ')}. Those job(s) can fail while the aggregate goes green — "a release either produces the complete artifact set or produces nothing" silently stops covering the platform somebody just added.`,
      );
    }
    if (ghost.length) {
      problems.push(`${agg.workflow}: job "${agg.job}" needs ${ghost.map((j) => `"${j}"`).join(', ')}, which the workflow does not declare.`);
    }
    // The aggregate must fail on FAILURE, CANCELLED **and SKIPPED** — none of
    // the three is a green build, and `if: always()` means the aggregate runs
    // over all of them. 'skipped' was missing until review 2026-07-31: a
    // job-level `if:` on any platform job would have let the weekly cron print
    // "All 6 platforms built" over a platform that never built.
    //
    // 🔴 STRUCTURAL, not substring. The first version did body.includes("'failure'"),
    // which an `echo` merely MENTIONING the verdicts satisfied — mutation-proven:
    // an aggregator that printed the words and exited 0 passed. The check now
    // requires the actual `contains(needs.*.result, '<verdict>')` expression
    // AND an `exit 1` in the job body, so prose about the check cannot be the check.
    for (const verdict of ['failure', 'cancelled', 'skipped']) {
      const expr = new RegExp(`contains\\(\\s*needs\\.\\*\\.result\\s*,\\s*['"]${verdict}['"]\\s*\\)`);
      if (!expr.test(body)) {
        problems.push(
          `${agg.workflow}: job "${agg.job}" never evaluates contains(needs.*.result, '${verdict}'). A ${verdict} platform job is not a green one, and with \`if: always()\` the aggregate runs anyway and reports success. (A line merely SAYING '${verdict}' does not count — the expression must be there.)`,
        );
      }
    }
    if (!/\bexit\s+1\b/.test(body)) {
      problems.push(
        `${agg.workflow}: job "${agg.job}" tests verdicts but never \`exit 1\`s. An aggregate that detects a failed platform and exits 0 anyway is a green tick over a broken set.`,
      );
    }
    if (!missing.length && !ghost.length) {
      ok(`aggregating job "${agg.job}" needs all ${others.length} other job(s) in ${agg.workflow}`);
    }
  }
}

// ── 6b. every RELEASE_CHANNEL a workflow stamps resolves to a row ────────────
// [9]R-10 limb 3. `--dart-define=RELEASE_CHANNEL=<id>` is compiled into the
// artifact — it is a fact ABOUT the binary, in the same class as the version
// string, and unlike `update_url` (runtime, owner decision #19) a value fetched
// at runtime could not distinguish two artifacts built from one commit for two
// channels.
//
// A free-text define has exactly one failure mode: a typo, which produces an
// artifact that reports a channel nobody serves and that no query will ever
// group correctly. `=webb` deploys perfectly and is wrong forever. This is the
// check that makes it a build failure instead.
//
// Comments are stripped, and the workflow set is DERIVED from the directory —
// a new lane acquires the obligation by existing.
{
  const wfDir = '.github/workflows';
  const wfAbs = abs(wfDir);
  const rowIds = new Set(channels.map((c) => c.id));
  const stamps = [];
  let scanned = 0;
  if (existsSync(wfAbs)) {
    for (const f of listDir(wfAbs).filter((x) => /\.ya?ml$/.test(x)).sort()) {
      const raw = read(`${wfDir}/${f}`);
      if (raw === null) continue;
      scanned++;
      const stripped = raw.replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '');
      stripped.split('\n').forEach((line, i) => {
        const m = /--dart-define(?:=|\s+)RELEASE_CHANNEL=(\S+)/.exec(line);
        if (m) stamps.push({ at: `${wfDir}/${f}:${i + 1}`, value: m[1].replace(/^['"]|['"]$/g, '') });
      });
    }
  }
  if (scanned === 0) {
    coverageLost([
      `no workflow file was read under ${wfDir}, so the RELEASE_CHANNEL check ranged over nothing.`,
      'A stamp that resolves to no row would then pass, which is the whole failure mode this limb has.',
    ]);
  }
  for (const s of stamps) {
    if (rowIds.has(s.value)) continue;
    problems.push(
      `${s.at} stamps --dart-define=RELEASE_CHANNEL=${s.value}, and ${REGISTER} declares no channel with that id (it has: ${[...rowIds].join(', ')}). The value is compiled into the artifact, so a typo here deploys perfectly and produces a binary that reports a channel nobody serves — for the life of that build.`,
    );
  }
  if (!problems.length && stamps.length) {
    ok(`${stamps.length} RELEASE_CHANNEL stamp(s) across ${scanned} workflow(s), each resolving to a register row`);
  } else if (!stamps.length) {
    prints.push(
      `NO RELEASE_CHANNEL STAMP: ${scanned} workflow(s) scanned and none passes --dart-define=RELEASE_CHANNEL. Every artifact this factory builds therefore reports the compiled-in default ('dev'), so a crash or an analytics row cannot be attributed to the channel it came from. [9]R-10 limb 3.`,
    );
  }
}

// ── 6c. the channel↔account status, published into the tree ──────────────────
// [10]D-4's AGENT SLICE. The register already maps every store row to its
// OWNER_QUEUE id, and CI can never read OWNER_QUEUE.md ([ADR 054] moved it to the
// sibling `nikatru/` brain, which is not on the disk CI checks out) — so the
// mapping was data with no status beside it, and "which of these accounts
// exists?" had no answer any machine could give.
//
// `accountStatus` is an OWNER-ASSERTED, DATED claim: `none | applied |
// verified`. It cannot be derived — no API this repo can reach knows whether a
// Partner Center verification has completed — so it is a value a human writes
// and this guard holds to a relationship:
//
//   · served: true  + accountStatus != verified  ⇒ FAIL. A channel cannot be
//     SERVED through an account that does not exist; that state is the register
//     claiming a distribution path nobody can publish through.
//   · every other gap                            ⇒ PRINT, never fail. Failing
//     the build on work only the owner can do blocks every merge on something
//     no agent can unblock — the standing posture, and the reason
//     assert-seams-wired.mjs prints rather than fails.
{
  const STATUSES = new Set(['none', 'applied', 'verified']);
  // 90 days. Chosen to be longer than any enrolment flow here has taken (the
  // Play account went pending → verified in about a day, Microsoft quotes five
  // business days), so a row inside the horizon is genuinely fresh rather than
  // merely recent. Both real staleness incidents — windows-store at 7 days and
  // android-play at 2 — are BELOW it, which is worth stating plainly: this
  // horizon would not have caught either one on time. It is a backstop against
  // a claim rotting for a quarter, not a substitute for correcting a row when
  // the fact changes. What catches a two-day-old lie is a human checking the
  // artefact, which is how both of these were actually found.
  const ACCOUNT_STATUS_STALE_DAYS = 90;
  const storeRows = channels.filter((c) => c.kind === 'store');
  if (storeRows.length === 0) {
    coverageLost([
      `${REGISTER} declares no \`kind: "store"\` row, so the account-status check has no domain.`,
      'Five store rows exist today; a register with none is a scan that has lost its subject, not a',
      'portfolio that stopped needing publisher accounts.',
    ]);
  }
  for (const c of storeRows) {
    const st = c.accountStatus;
    if (st === undefined || st === null || typeof st !== 'object') {
      problems.push(
        `channel "${c.id}" is kind:"store" and carries no \`accountStatus\` {status, asOf, note}. The register maps it to OWNER_QUEUE ${c.ownerQueue ?? '(none)'} and CI cannot open that file, so without this field "does a publisher account exist for this channel?" has no answer anywhere a machine can read.`,
      );
      continue;
    }
    if (!STATUSES.has(st.status)) {
      problems.push(
        `channel "${c.id}" has accountStatus.status "${st.status}"; expected one of ${[...STATUSES].join(', ')}. A free-text status is a status nobody can compare.`,
      );
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.asOf ?? ''))) {
      problems.push(
        `channel "${c.id}" has accountStatus.status "${st.status}" with no \`asOf\` date. An undated claim about an external account is a claim nobody can tell has gone stale — the same defect the restore-drill dates exist to avoid.`,
      );
      continue;
    }
    if (c.served === true && st.status !== 'verified') {
      problems.push(
        `channel "${c.id}" is SERVED and its accountStatus is "${st.status}" (as of ${st.asOf}). A served channel is one this factory publishes through; publishing needs the account. One of the two fields is wrong and the register cannot say which.`,
      );
      continue;
    }
    // ── THE CLAIM'S AGE, PRINTED FOR EVERY STORE ROW INCLUDING `verified` ────
    //
    // 🔴 WHY THIS EXISTS, AND IT IS NOT THE OBVIOUS REASON. On 2026-08-05 the
    // android-play row still read `status: "none"` / "No Play Console account"
    // two days after the account was verified. It was NOT unguarded: the block
    // below printed `ACCOUNT NONE: android-play … as of 2026-08-03` on every
    // single run, faithfully, in a message character-identical to the one it
    // had printed correctly for weeks. A gap-printer prints the gap; nothing in
    // it can notice the gap CLOSED, and a line that repeats an expected message
    // is wallpaper. The windows-store row failed the same way for seven days.
    //
    // And a `verified` row printed NOTHING, so the one status whose staleness is
    // most expensive — an enrolment that has since lapsed — was the one status
    // with no output at all. The field's own `_why` calls it "OWNER-ASSERTED AND
    // DATED"; dating a claim nothing ever ages is decoration.
    //
    // So: every store row prints its age, and past the threshold the line says
    // RE-ASSERT rather than repeating the status. It PRINTS and never FAILS —
    // re-confirming an external enrolment is owner work, and failing the build
    // on it would block every merge on something no agent can unblock. The
    // threshold is a staleness horizon, NOT a mandate that anything change: a
    // row re-confirmed and re-dated with the same value is the correct outcome.
    const ageDays = Math.floor((Date.now() - Date.parse(`${st.asOf}T00:00:00Z`)) / 86_400_000);
    const stale = ageDays > ACCOUNT_STATUS_STALE_DAYS;
    if (st.status !== 'verified') {
      prints.push(
        `ACCOUNT ${st.status.toUpperCase()}: ${c.id} — OWNER_QUEUE ${c.ownerQueue ?? '(none)'}, asserted ${ageDays}d ago (${st.asOf})${stale ? ' ⚠️ RE-ASSERT — older than the staleness horizon; confirm it is still true rather than re-reading it' : ''}${st.note ? ` · ${st.note}` : ''}`,
      );
    } else if (stale) {
      prints.push(
        `ACCOUNT VERIFIED but ASSERTED ${ageDays}d AGO: ${c.id} (${st.asOf}) ⚠️ RE-ASSERT — a verified enrolment can lapse, and this row is the only machine-readable answer to "does an account exist for this channel?"`,
      );
    }
  }
}

// ── 6d. SIGNING-MATERIAL PINS: the fingerprint a row commits to ──────────────
//
// 🔴 WHY A PIN NEEDS A GUARD AT ALL, IN THIS REGISTER'S OWN WORDS. The Play row
// pins its upload certificate's SHA-256 and says what that buys: "a secret
// quietly swapped for a different-but-valid keystore — a copy-paste between
// repositories, a half-applied rotation, a restore from the wrong backup —
// passes every other check and fails AT THE STORE". The Windows-direct and
// AppImage rows have the same exposure and worse recovery (a purchased
// certificate cannot be reissued by a gatekeeper; an `own-signing-key` has no
// gatekeeper at all), so on 2026-08-08 they acquired the same kind of pin.
//
// 🔴 AND WHY THE PIN NEEDS ITS OWN READER. This file already records what an
// unread field costs: `uploadCertificate._aliasNote` describes the `alias` field
// drifting to a stale value with NOTHING NOTICING, because the only consumer
// (assert-artifact-signed.mjs) reads `.sha256` alone. "A value with no reader
// drifts silently and its `asOf` date goes on looking fresh." Landing two more
// unread fields would have been that defect, committed knowingly.
//
// SUBJECT SET, DERIVED NOT LISTED: every object under a row's `signing` that
// carries a `notYetConfiguredSentinel`. A new pin block acquires these checks by
// declaring a sentinel, which is the same field assert-store-metadata.mjs
// already requires of `packageIdentity` and for the same reason — "without it
// nothing can tell a Partner-Center placeholder from a real value".
//
// THE THREE STATES, and the middle one is the expensive one:
//   · every value field still the sentinel → NOT YET CONFIGURED. A SERVED row
//     FAILS (a channel cannot ship through an identity that does not exist); a
//     deferred row PRINTS ([pipeline C-6] — the blocker is a purchase or a key
//     ceremony, which is owner work, and failing would block every merge on it).
//   · SOME fields real and some still the sentinel → FAILS in either state.
//     `packageIdentity`'s own _why names this case: "the moment a real value
//     lands on one side and not the other, it FAILS". A half-configured identity
//     is the one that packages and ships cleanly under the wrong name.
//   · no field on the sentinel → configured; counted and reported.
{
  /** Bookkeeping fields, not values. `alias` is here because the Play row's
   *  `uploadCertificate` carries one and it names a keystore ENTRY rather than
   *  identifying the certificate — treating it as a pinned value would demand a
   *  sentinel for something whose authority is a repository secret. */
  const PIN_META = new Set(['_why', 'notYetConfiguredSentinel', 'asOf', 'source', 'declaredIn', 'alias', 'algorithm']);
  let pinBlocks = 0;
  let pinsConfigured = 0;
  for (const c of channels) {
    const signing = c.signing;
    if (signing === null || typeof signing !== 'object' || Array.isArray(signing)) continue;
    for (const [blockName, block] of Object.entries(signing)) {
      if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
      if (!Object.hasOwn(block, 'notYetConfiguredSentinel')) continue;
      pinBlocks++;
      const at = `channel "${c.id ?? '(unnamed)'}" signing.${blockName}`;

      const sentinel = block.notYetConfiguredSentinel;
      if (typeof sentinel !== 'string' || sentinel.trim() === '') {
        problems.push(
          `${at} declares a \`notYetConfiguredSentinel\` that is not a non-empty string. Nothing can then tell a placeholder from a real fingerprint, so a placeholder validates as configured — which is how an artifact gets signed, shipped and trusted under an identity that does not exist.`,
        );
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(block.asOf ?? ''))) {
        problems.push(
          `${at} carries no \`asOf\` date. A pinned fingerprint is a claim about an external artefact — a certificate, a keypair — and an undated claim is one nobody can tell has gone stale. Same requirement \`accountStatus\` and the restore drills already carry.`,
        );
      }
      if (typeof block.source !== 'string' || block.source.trim().length < 20) {
        problems.push(
          `${at} carries no \`source\`. Every pinned value in this tree names where it was read from — ceilings.json refuses a limit with no citation, the store metadata refuses a \`max\` with no \`source\` — because a value that arrived from nowhere cannot be re-derived when it is questioned, and this one is compared against a real signature.`,
        );
      }

      const valueFields = Object.entries(block).filter(([k, v]) => !PIN_META.has(k) && typeof v === 'string');
      if (valueFields.length === 0) {
        problems.push(
          `${at} declares a sentinel and NO value field for it to stand in for. An empty pin block satisfies every check below by having nothing to check — the empty-domain pass this whole guard exists to remove.`,
        );
        continue;
      }
      const onSentinel = valueFields.filter(([, v]) => v === sentinel);
      if (onSentinel.length === valueFields.length) {
        const fieldList = valueFields.map(([k]) => `\`${k}\``).join(', ');
        const verb = valueFields.length === 1 ? 'still reads' : 'all still read';
        const summary = `${at} is NOT YET CONFIGURED — ${fieldList} ${verb} "${sentinel}" (as of ${block.asOf ?? 'undated'})`;
        if (c.served === true) {
          problems.push(
            `${summary}. The row is SERVED. A channel cannot publish through a signing identity that does not exist, so one of the two facts is wrong and the register cannot say which.`,
          );
        } else {
          prints.push(
            `SIGNING PIN NOT CONFIGURED: ${summary}. Owner-gated (a purchase or a key ceremony), so this prints rather than failing — but the day the row is served it becomes a build failure.`,
          );
        }
      } else if (onSentinel.length > 0) {
        problems.push(
          `${at} is HALF CONFIGURED: ${onSentinel.map(([k]) => `\`${k}\``).join(', ')} still read the sentinel while ${valueFields.filter(([, v]) => v !== sentinel).map(([k]) => `\`${k}\``).join(', ')} carry real values. A partially-filled identity is the state that packages and ships cleanly under the wrong name — unrecoverable once published, which is why \`packageIdentity\` fails on it too rather than waiting for the second half.`,
        );
      } else {
        pinsConfigured++;
      }
    }
  }
  // COVERAGE. Two rows in this repository declare a pin block; a tree with none
  // means the blocks were deleted or the `signing.*` walk stopped reaching them,
  // and either way every check above ranged over nothing and printed ok. Held to
  // the real repo only — a fixture legitimately has none, and firing there would
  // force every fixture to model signing pins to say anything about anything.
  if (scanningRealRepo && pinBlocks === 0) {
    coverageLost([
      `no \`signing.*\` block in ${REGISTER} carries a \`notYetConfiguredSentinel\`.`,
      'The pinned-signing-material check then has no subject: a placeholder would validate as a real',
      'fingerprint, and the SERVED-row rule above could never fire. Two rows (windows-direct,',
      'linux-appimage) declare one today; if a pin was retired, retire this check in the same change.',
    ]);
  }
  if (pinBlocks > 0) {
    ok(`${pinBlocks} pinned signing-material block(s), ${pinsConfigured} configured, ${pinBlocks - pinsConfigured} on their declared sentinel [9]R-3`);
  }
}

// ── 7. disqualified channels ─────────────────────────────────────────────────
// The ADR check is MODE-AWARE, and the mode is decided by the harness ROOT, not
// by the individual file. `Private/` is gitignored, so in a CI checkout every
// ADR path is unresolvable — reporting that as "the decision is missing" is a
// false fault, and skipping it silently is worse. Decide once, say which.
const disqualified = Array.isArray(register.disqualified) ? register.disqualified : [];
const adrRoot = (p) => String(p ?? '').split('/')[0];
const rootsPresent = new Map();
const harnessPresent = (root) => {
  if (!rootsPresent.has(root)) rootsPresent.set(root, root !== '' && existsSync(abs(root)));
  return rootsPresent.get(root);
};

for (const d of disqualified) {
  const id = d.id ?? '(unnamed)';
  if (seenIds.has(id)) {
    problems.push(`"${id}" is both a live channel and a disqualified one. One of the two entries is a lie and nothing says which.`);
  }
  // Checkable in EVERY mode: the citation has to be a well-formed path.
  if (typeof d.adr !== 'string' || d.adr === '' || !d.adr.includes('/')) {
    problems.push(`disqualified channel "${id}" cites no ADR path. A channel killed by a decision nobody can name is a channel that comes back.`);
    continue;
  }
  const summary = `${id} (${(d.platforms ?? []).join(', ')}) — ${d.adr}, ${d.date ?? 'undated'}${d.ownerQueue ? ` · OWNER_QUEUE ${d.ownerQueue}` : ''}`;

  if (!harnessPresent(adrRoot(d.adr))) {
    // The whole harness directory is absent — this is the public checkout, not a
    // missing decision. Say so on every run rather than passing quietly.
    prints.push(`DISQUALIFIED: ${summary}`);
    prints.push(
      `   └─ ADR UNVERIFIABLE IN THIS CHECKOUT — \`${adrRoot(d.adr)}/\` is not present (it is gitignored, .gitignore:23). The citation's CONTENT is checked only where the harness is checked out, i.e. locally. This is a stated limit, not a pass.`,
    );
    continue;
  }
  // Harness IS present, so a missing or unlocked ADR is a real fault.
  if (!existsSync(abs(d.adr))) {
    problems.push(`disqualified channel "${id}" names ADR "${d.adr}", which is not on disk although \`${adrRoot(d.adr)}/\` is. A channel killed by a decision nobody can open is a channel that comes back.`);
    continue;
  }
  const adr = read(d.adr) ?? '';
  if (!/LOCKED/.test(adr)) {
    problems.push(`disqualified channel "${id}" cites ${d.adr}, which does not record itself as LOCKED. Only a locked decision disqualifies a channel.`);
  } else {
    prints.push(`DISQUALIFIED: ${summary}`);
  }
}

// ── non-channel signing identities: shape only, printed ──────────────────────
//
// The ADR limb here is the same one `disqualified` rows carry, extended to
// these entries on 2026-08-03. It is the MECHANICAL half of the doc-rot sweep:
// this file's pack-key entry cited [ADR 022] three times IN PROSE and named no
// path, so nothing could tell whether the decision it rests on still says what
// the entry claims. A citation nobody can open is a citation that rots.
//
// MODE-AWARE, exactly as the disqualified check is: where `Private/` is
// checked out the ADR must exist and record itself LOCKED; in a CI checkout the
// harness is gitignored, so the limit is PRINTED rather than passed over.
for (const s of register.nonChannelSigningIdentities ?? []) {
  if (!KEY_KINDS.has(s.keyKind)) {
    problems.push(`signing identity "${s.id ?? '(unnamed)'}" has keyKind "${s.keyKind}"; expected one of ${[...KEY_KINDS].join(', ')}.`);
    continue;
  }
  if (typeof s.adr !== 'string' || s.adr === '' || !s.adr.includes('/')) {
    problems.push(
      `signing identity "${s.id ?? '(unnamed)'}" cites no \`adr\` path. Its custody model is a DECISION, and a decision cited only in prose is one nobody can open to check it still says what this row claims.`,
    );
  } else if (!harnessPresent(adrRoot(s.adr))) {
    prints.push(
      `IDENTITY ADR UNVERIFIABLE IN THIS CHECKOUT: ${s.id} — ${s.adr}; \`${adrRoot(s.adr)}/\` is not present (gitignored, .gitignore:14-15). The citation's CONTENT is checked only where the harness is checked out. A stated limit, not a pass.`,
    );
  } else if (!existsSync(abs(s.adr))) {
    problems.push(`signing identity "${s.id}" names ADR "${s.adr}", which is not on disk although \`${adrRoot(s.adr)}/\` is.`);
  } else if (!/LOCKED/.test(read(s.adr) ?? '')) {
    problems.push(`signing identity "${s.id}" cites ${s.adr}, which does not record itself as LOCKED. A custody model resting on an unlocked decision is one that can change under the key.`);
  }
  const drill = s.restoreDrill ?? {};
  if (drill.required !== false && !/^\d{4}-\d{2}-\d{2}$/.test(String(drill.date ?? ''))) {
    prints.push(`UNDRILLED IDENTITY: ${s.id} — no dated restore drill on record.`);
  }
}

// ── 8. [9]R-3 limb 2 — a lane may name only secrets the register declares ────
//
// 🔴 THE CLAUSE NOTHING READ. [9]R-3's acceptance has two limbs: a release target
// must not resolve to a debug or absent identity (covered on the Android lane by
// assert-artifact-signed.mjs, which reads the signer off the built .aab), AND it
// must not "name a secret that is not in the declared signing-identity register".
// Measured 2026-08-06: `grep -rl ciSecrets` returned tooling/channel-register.json
// and NOTHING ELSE. The four Play secret names sat in the register as prose while
// android-signing.mjs parsed its names out of build.gradle.kts, so the register
// was documentation, not an authority — a workflow could name any secret at all
// and no check in the tree compared it to a declaration.
//
// WHY THE COMPARISON NEEDS BOTH SIDES IN THE REGISTER. A release workflow names
// ~20 secrets that are not signing identities (API_BASE_URL, SUPABASE_ANON_KEY, a
// store's upload credentials). Compare the lanes against the SIGNING names alone
// and every workflow in the tree fails; compare against a hardcoded "looks like a
// key" list in here and the guard becomes a private classifier that silently
// mis-files the next secret somebody adds — the second declaration [pipeline F-2]
// exists to forbid, and the exact shape KEY_KINDS was refactored out of. So the
// register carries a PARTITION and this reads it: a secret a lane names is either
// signing material on a row (`signing.ciSecrets.names`) or is declared in
// `ciSecretRegister.nonSigning` with a kind and a reason. Anything else FAILS.
// The undecided case is the failing one, which is the direction that matters — a
// new signing secret cannot enter a lane by nobody noticing it.
//
// DIRECTION, AND WHY THE CONVERSE ONLY PRINTS. The acceptance sentence is
// one-directional: it fails a LANE that names an undeclared secret. It makes the
// register a CEILING on what a lane may name, not a floor on what a lane must
// name. The floor — "actually applied" — is proved by reading the signature off
// the artifact (assert-artifact-signed.mjs) and by android-signing.mjs failing a
// release lane with no secrets; a name appearing in YAML proves nothing about
// application, so failing on an unused declaration would swap a real proof for a
// textual one. And the rows that would fail it are ios/macos-appstore, whose
// identities do not exist because no Apple account does (OWNER_QUEUE A-4) —
// blocking all CI on owner-gated work, against the standing rule ([pipeline C-6]).
// So a declared-but-unnamed secret PRINTS on every run instead.
//
// ⚠️ WHAT THIS SECTION DOES NOT CLOSE, stated rather than implied: it compares
// the register to the WORKFLOWS only. Gradle remains the authority
// android-signing.mjs derives its names from, and until 2026-08-06 a rename in
// Gradle alone was silent — SECTION 9 below is that half, and this paragraph is
// kept as the record of where the boundary was rather than deleted. [9]R-3 stays
// PARTIAL for the Apple, Windows-direct and AppImage rows, which have no signing
// identity and no lane to check at all (owner-gated, OWNER_QUEUE S-5).
//
// (`WORKFLOW_DIR` is declared beside the `workflow()` parser near the top of this
// file rather than here. It used to live on this line, and it was hoisted when
// the `submission.recipeScript` check — hundreds of lines ABOVE this point —
// needed to name the directory in its failure message. A `const` referenced
// before its declaration is a ReferenceError at run time, not a lint warning.)

/** REQUIRED_COVERAGE — the floor that stops this ranging over nothing.
 *
 *  An assertion whose domain is empty passes for the wrong reason, and this file
 *  already carries one recorded case (section 1's whole reason for existing). The
 *  ways this check can go blind are all the same shape: the scan finds no
 *  workflows, the `${{ … }}` extractor breaks, the register's `ciSecrets` names
 *  drift out of the namespace the lanes speak. Every one of them collapses the
 *  INTERSECTION of "declared signing secrets" and "secrets a lane names" to zero,
 *  so that intersection is the floor — checked whenever anything is declared.
 *
 *  `androidGradleFilesCrossChecked` is section 9's equivalent floor and it is the
 *  same shape one level over: a row can declare a Gradle contract whose
 *  `declaredIn` template resolves to nothing on disk, and a comparison against a
 *  file that was never read agrees with everything. */
const REQUIRED_COVERAGE = { declaredSigningSecretsNamedByALane: 1, androidGradleFilesCrossChecked: 1 };

const secretRegister =
  register.ciSecretRegister !== null && typeof register.ciSecretRegister === 'object' ? register.ciSecretRegister : {};
const secretKinds = new Set(Object.keys(secretRegister.kinds ?? {}));

/** The declared NOT-signing half of the partition. */
const nonSigningSecrets = new Map();
for (const e of Array.isArray(secretRegister.nonSigning) ? secretRegister.nonSigning : []) {
  const name = typeof e?.name === 'string' ? e.name.trim() : '';
  if (name === '') {
    problems.push('`ciSecretRegister.nonSigning` has an entry with no `name`. An unnamed classification classifies nothing.');
    continue;
  }
  if (nonSigningSecrets.has(name)) {
    problems.push(`\`ciSecretRegister.nonSigning\` declares "${name}" twice. Two entries for one secret are two answers to "is this a signing identity?".`);
  }
  if (!secretKinds.has(e?.kind)) {
    problems.push(
      `\`ciSecretRegister.nonSigning\` entry "${name}" has kind "${e?.kind}", which \`ciSecretRegister.kinds\` does not declare (${[...secretKinds].join(', ') || 'nothing is declared'}). The vocabulary is derived from the register, never held here.`,
    );
  }
  if (typeof e?.why !== 'string' || e.why.trim().length < 20) {
    problems.push(
      `\`ciSecretRegister.nonSigning\` entry "${name}" carries no \`why\`. Without one the cheapest way to silence a [9]R-3 failure is to paste the name into this array, which turns a classification decision into a copy-paste and re-opens the hole limb 2 closes.`,
    );
  }
  nonSigningSecrets.set(name, e);
}

/** The SIGNING half, collected off the rows. A row whose identity EXISTS and has
 *  a LANE must say which secrets carry that identity into CI — that is what stops
 *  the intersection floor below from being satisfiable by deleting the names. A
 *  row whose identity does not exist yet has nothing to declare and PRINTS. */
const signingSecrets = new Map();
const collectSigning = (label, signing, hasLane) => {
  const keyKind = signing?.keyKind;
  const names = Array.isArray(signing?.ciSecrets?.names) ? signing.ciSecrets.names : null;
  const identityExists = typeof signing?.identity === 'string' && signing.identity.trim() !== '';
  if (names === null) {
    if (keyKind !== undefined && keyKind !== 'none' && identityExists && hasLane) {
      problems.push(
        `${label} holds a "${keyKind}" identity (${signing.identity}) and has a lane, but declares no \`signing.ciSecrets.names\`. [9]R-3 limb 2 makes the register the authority on which secrets carry a signing identity into CI; a row with a key, a lane and no declared secrets leaves that authority empty, and an empty authority accepts every name.`,
      );
    } else if (keyKind !== undefined && keyKind !== 'none' && !identityExists) {
      // ⚠️ TWO DIFFERENT FACTS, AND CONFLATING THEM WOULD PUT A FALSE CLAIM IN
      // THE OUTPUT. `identity: null` is a row saying its identity does not exist
      // yet (the Apple rows, owner-gated on A-4). A row with NO `identity` field
      // is saying nothing about existence — content-pack-k1's key demonstrably
      // exists, it is pinned in packages/core/lib/src/content/pack_verifier.dart.
      // Both are uncovered by limb 2; only one of them is uncovered because the
      // key is missing.
      const why = Object.hasOwn(signing ?? {}, 'identity')
        ? 'its identity does not exist yet, so there is no secret to declare (owner-gated)'
        : 'it names no `identity` this guard can resolve to a CI lane — which is not a claim that no key exists';
      prints.push(
        `NO CI SECRETS TO CHECK: ${label} — keyKind "${keyKind}"; ${why}. [9]R-3 limb 2 is UNENFORCEABLE on this row: it is uncovered, not covered.`,
      );
    }
    return;
  }
  if (keyKind === 'none') {
    problems.push(
      `${label} declares \`signing.ciSecrets\` with keyKind "none" — the register's own vocabulary says that kind means "the channel signs for us". A row cannot both hold no key and need secrets to use one.`,
    );
  }
  if (names.length === 0) {
    problems.push(`${label} declares \`signing.ciSecrets.names\` as an empty list. Declaring nothing is not declaring.`);
  }
  for (const n of names) {
    if (typeof n !== 'string' || n.trim() === '') {
      problems.push(`${label} declares a non-string entry in \`signing.ciSecrets.names\`.`);
      continue;
    }
    if (nonSigningSecrets.has(n)) {
      problems.push(
        `"${n}" is declared BOTH as signing material on ${label} and as non-signing in \`ciSecretRegister.nonSigning\`. One of the two is wrong and nothing says which — which is worse than either answer.`,
      );
    }
    if (!signingSecrets.has(n)) signingSecrets.set(n, label);
  }

  // ── 8b. A WRITTEN REASON PER DECLARED SIGNING SECRET ──────────────────────
  //
  // 🔴 THE HOLE THE PARTITION HAD ON ONE SIDE ONLY. `ciSecretRegister.nonSigning`
  // has required a `why` per entry since it was written, on its own stated
  // ground: "without it the cheapest way to silence a [9]R-3 failure is to paste
  // the name into this array, which converts a classification decision into a
  // copy-paste and re-opens exactly the hole limb 2 closes." That argument is
  // about the PARTITION, and a partition has two sides. The signing side had no
  // such requirement — so for any row §9 does not reach (every non-Android row:
  // Apple, Windows-direct, AppImage) the cheapest way to silence the SAME
  // failure was to paste the name into `signing.ciSecrets.names` instead, with
  // no reason recorded and nothing for a reviewer to disagree with.
  //
  // It is not symmetry for its own sake. §9 makes the Android row's list
  // falsifiable by comparing it, name for name, to the build file that actually
  // reads the values. The four rows added on 2026-08-08 have no build file to
  // compare against — their lanes do not exist yet, which is the whole reason
  // the names are being registered ahead of the seam — so a sentence a human
  // wrote is the only check those declarations can carry. That makes this limb
  // strongest exactly where the mechanical one is absent.
  //
  // FAILS RATHER THAN PRINTS, and that is not a C-6 violation: writing the
  // reason is not owner-gated work. Nothing here waits on an Apple account or a
  // certificate purchase — it waits on whoever added the name saying what it is.
  //
  // 20 characters is `nonSigning`'s own floor, reused deliberately rather than
  // re-chosen: two thresholds for one property is the second declaration
  // [pipeline F-2] exists to forbid, in miniature.
  const whyMap = signing?.ciSecrets?.why;
  if (whyMap === undefined || whyMap === null || typeof whyMap !== 'object' || Array.isArray(whyMap)) {
    problems.push(
      `${label} declares \`signing.ciSecrets.names\` and no \`signing.ciSecrets.why\` map. Every \`ciSecretRegister.nonSigning\` entry carries a written reason for exactly this: an unreasoned name is a copy-paste, not a classification, and pasting a name into \`names\` silences [9]R-3 limb 2 just as effectively as pasting it into \`nonSigning\` would.`,
    );
  } else {
    for (const n of names) {
      if (typeof n !== 'string' || n.trim() === '') continue; // already failed above
      const w = whyMap[n];
      if (typeof w !== 'string' || w.trim().length < 20) {
        problems.push(
          `${label} declares signing secret "${n}" with no \`signing.ciSecrets.why["${n}"]\` (a string of at least 20 characters). The register is [9]R-3's authority on which secrets carry a signing identity into CI; an entry nobody had to justify is one nobody reviewed.`,
        );
      }
    }
    // The converse. A reason for a name that is no longer declared is a stale
    // justification sitting where a reviewer will read it as current — the same
    // failure `$updateExemptions` catches from the other end ("a waiver
    // outliving the thing it waived is how a list stops describing the tree").
    for (const k of Object.keys(whyMap)) {
      if (k.startsWith('_')) continue; // `_why` and friends are this file's prose namespace
      if (names.includes(k)) continue;
      problems.push(
        `${label} records \`signing.ciSecrets.why["${k}"]\` and does not declare "${k}" in \`names\` (which lists ${names.join(', ') || 'nothing'}). A reason for a secret the row no longer names reads as a live classification and justifies nothing.`,
      );
    }
  }
};
for (const c of channels) collectSigning(`channel "${c.id ?? '(unnamed)'}"`, c.signing, c.lane != null);
for (const s of register.nonChannelSigningIdentities ?? []) collectSigning(`signing identity "${s.id ?? '(unnamed)'}"`, s, false);

/** What the workflows actually name. A secret reference in GitHub Actions is only
 *  valid inside a `${{ … }}` expression, so the expressions are extracted first
 *  and the name matched inside them — parsed context, not a bare text grep. The
 *  bare grep is not a hypothetical: `node tooling/ci/scan-secrets.mjs` contains
 *  the literal `secrets.mjs` and a text scan reports it as a secret named `mjs`.
 *  Comments are stripped first, the same way `workflow()` above strips them. */
const workflowFiles = [];
if (existsSync(abs(WORKFLOW_DIR))) {
  for (const entry of listDir(abs(WORKFLOW_DIR))) {
    if (/\.ya?ml$/.test(entry)) workflowFiles.push(`${WORKFLOW_DIR}/${entry}`);
  }
}
const observedSecrets = new Map();
for (const rel of workflowFiles) {
  const raw = read(rel);
  if (raw === null) continue;
  const stripped = raw.replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '');
  for (const expr of stripped.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (/\bsecrets\s*\[/.test(expr[1])) {
      problems.push(
        `${rel} names a secret by EXPRESSION (\`secrets[…]\`). A name computed at run time cannot be compared to the register, so [9]R-3 limb 2 cannot be enforced on it — the whole check would be one indirection away from vacuous. Name the secret literally.`,
      );
    }
    for (const m of expr[1].matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!observedSecrets.has(m[1])) observedSecrets.set(m[1], new Set());
      observedSecrets.get(m[1]).add(rel);
    }
  }
}

// COVERAGE (a): the lanes the register names must be INSIDE the scanned set, or
// the scan and the register are describing different directories and the
// comparison below is between a set and an unrelated one.
const scannedSet = new Set(workflowFiles);
for (const c of channels) {
  for (const w of [c.lane?.workflow, c.submission?.workflow, register.aggregatingJob?.workflow]) {
    if (typeof w !== 'string' || w === '' || !existsSync(abs(w)) || scannedSet.has(w)) continue;
    coverageLost([
      `the register names ${w} as a lane, it exists on disk, and it is NOT in the ${WORKFLOW_DIR} scan.`,
      'The [9]R-3 limb-2 comparison would then range over workflows that are not the lanes,',
      'and report clean about the ones that are. Point the scan at the lanes or move the lane.',
    ]);
  }
}
// COVERAGE (b): the two sides must share at least one name, or they are disjoint
// namespaces and the comparison proves nothing about signing at all.
const signingSecretsNamedByALane = [...signingSecrets.keys()].filter((n) => observedSecrets.has(n));
if (signingSecrets.size > 0 && signingSecretsNamedByALane.length < REQUIRED_COVERAGE.declaredSigningSecretsNamedByALane) {
  coverageLost([
    `${signingSecrets.size} signing secret(s) are declared in the register and NONE of them is named by any of the ${workflowFiles.length} workflow(s) scanned.`,
    `Declared: ${[...signingSecrets.keys()].join(', ')}.`,
    `Observed across the lanes: ${observedSecrets.size === 0 ? '(none at all — the scan found no `${{ secrets.X }}` reference anywhere)' : [...observedSecrets.keys()].sort().join(', ')}.`,
    'The register and the lanes are speaking about disjoint sets of names, so every check below',
    'would range over an empty intersection and report clean. This is COVERAGE, not a mismatch:',
    'it fires whether the register was renamed, the workflows moved, or the extractor broke.',
  ]);
}

// The failing direction: a lane naming a secret nothing declares.
for (const [name, wfs] of [...observedSecrets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (signingSecrets.has(name) || nonSigningSecrets.has(name)) continue;
  problems.push(
    `${[...wfs].sort().join(', ')} name(s) \`secrets.${name}\`, which the register does not declare. [9]R-3: a release lane may name only secrets the register enumerates — either as signing material on a channel row (\`signing.ciSecrets.names\`) or in \`ciSecretRegister.nonSigning\` with a kind and a reason it is not a signing identity. An unclassified secret is exactly the case limb 2 names: nobody can say whether a signing identity just entered CI unenumerated.`,
  );
}
// The converse PRINTS — see the header for why the acceptance sentence is a
// ceiling and not a floor.
for (const [name, owner] of signingSecrets) {
  if (observedSecrets.has(name)) continue;
  prints.push(
    `SIGNING SECRET DECLARED, NO LANE NAMES IT: ${name} (${owner}). Declared as signing material and no workflow references it — the identity is enumerated but not applied. Printed, not failed: the acceptance sentence bounds what a lane MAY name, and "actually applied" is proved by reading the signer off the artifact, not by a name in YAML.`,
  );
}
for (const name of nonSigningSecrets.keys()) {
  if (observedSecrets.has(name)) continue;
  prints.push(
    `DECLARED SECRET NO WORKFLOW NAMES: ${name} — classified in \`ciSecretRegister.nonSigning\` and referenced nowhere. A stale classification is a pre-authorisation for a name nobody uses; delete it when the lane that needed it is gone.`,
  );
}
if (observedSecrets.size > 0) {
  ok(
    `${observedSecrets.size} secret(s) named across ${workflowFiles.length} workflow(s), all declared; ${signingSecrets.size} signing, ${signingSecretsNamedByALane.length} of those named by a lane [9]R-3 limb 2`,
  );
}

// ── 9. [9]R-3 — the register's signing declaration vs the REAL Gradle build ──
//
// 🔴 THE HALF SECTION 8 LEFT OPEN, IN ITS OWN WORDS: "it compares the register to
// the WORKFLOWS, never to apps/*/android/app/build.gradle.kts … a rename in Gradle
// alone is still silent." That silence is not a small one. build.gradle.kts is
// where the four signing values are actually READ, and everything upstream —
// tooling/ci/android-signing.mjs, tooling/release/submit-play.mjs — deliberately
// PARSES its names out of that file rather than repeating them, precisely so the
// two cannot drift. The register did repeat them, and nothing compared the copy
// to the original. Rename a value in Gradle and: the register goes on naming the
// old one, the workflows go on passing the old one, android-signing.mjs exports
// the NEW one because it derives from Gradle, and the build takes the debug
// fallback with every check in the tree green. That is the exact defect shape
// recorded at the top of android-signing.mjs, one level up.
//
// WHAT IS ASSERTED: the register and the build file agree about WHICH FOUR VALUES
// CARRY THE SIGNING IDENTITY. Not their contents — no secret is read here — the
// NAMES, as a set, in both directions. A rename on either side breaks the set
// equality and goes red naming which side moved.
//
// ⚠️ ANCHORED ON USE, NOT ON THE MAP'S OWN DECLARATION, because this repository
// has shipped that mistake: assert-seams-wired.mjs matched a function's own
// declaration, so deleting every caller left it green. `val releaseSigningEnv =
// mapOf(…)` sitting in the file proves nothing — a build whose signing config
// reads none of it is unconditionally debug-signed with the declaration intact.
// So three uses are required beside it: the symbol is referenced somewhere other
// than its own declaration, every key it declares is ASSIGNED inside the named
// signing config, and the release build type reaches that config through
// `signingConfigs.getByName(…)`.
//
// 🔒 THE DEBUG FALLBACK IS DELIBERATELY NOT RE-ASSERTED HERE. It is a recorded
// owner decision (build-platforms.yml's weekly keyless run is a build PROOF) and
// tooling/release/submit-play.mjs already fails its removal. A second copy of
// that assertion is the [pipeline F-2] sin this file removed KEY_KINDS to avoid,
// and the two copies would drift the day the fallback's shape changes. Nothing in
// this section requires `getByName("release")` to be UNCONDITIONAL — the real
// file reaches it from inside `if (hasReleaseSigning)`, and the `else` branch
// that yields the debug config is none of this section's business.
//
// STRUCTURE, NEVER PROSE. The build file's header is 60 lines of comment naming
// ANDROID_KEYSTORE_BASE64, `signingConfigs.getByName("debug")` and the whole
// mechanism — a text scan would match its own documentation, which is the defect
// `grep '"r2_buckets"'` found. Comments go first (the shared reduction), then
// string CONTENTS are blanked for the brace/paren arithmetic only.
const ANDROID = 'android';
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Non-space character count — the measure that proves a reduction REDUCED. */
const dense = (s) => s.replace(/ /g, '').length;

/** End of the balanced run opening at `open`, or -1.
 *
 *  Run over the SKELETON: comments blanked by `stripSourceComments` and string
 *  contents blanked by `stripStringLiterals`, so no delimiter can be hiding
 *  inside a literal and a plain depth count is exact. Both reductions replace
 *  with spaces rather than deleting, so byte offsets are preserved and an index
 *  found here indexes the comment-stripped text too — a property asserted below
 *  rather than assumed.
 *
 *  ⚠️ KNOWN LIMIT, and its direction is the safe one: Kotlin's `"""raw"""` is not
 *  understood by `stripStringLiterals`, so a brace inside one would be counted.
 *  No build file in this tree uses one, and the failure it would cause is a FALSE
 *  RED somebody investigates — never a silent pass. */
function balanced(skeleton, open, l, r) {
  let depth = 0;
  for (let i = open; i < skeleton.length; i++) {
    if (skeleton[i] === l) depth++;
    else if (skeleton[i] === r) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const androidRows = channels.filter((c) => Array.isArray(c.platforms) && c.platforms.includes(ANDROID));
let gradleFilesCrossChecked = 0;
let gradleNamesAgreed = 0;

for (const c of channels) {
  const label = `channel "${c.id ?? '(unnamed)'}"`;
  const ciSecrets = c.signing?.ciSecrets;
  const contract = ciSecrets?.gradleContract;
  const isAndroid = Array.isArray(c.platforms) && c.platforms.includes(ANDROID);
  const names = Array.isArray(ciSecrets?.names) ? ciSecrets.names.filter((n) => typeof n === 'string') : null;

  if (!isAndroid) {
    if (contract !== undefined) {
      problems.push(
        `${label} declares \`signing.ciSecrets.gradleContract\` but ships to ${JSON.stringify(c.platforms ?? null)}, not "${ANDROID}". A Gradle contract on a row with no Android module points this comparison at a file that channel never builds, and a comparison against an absent file agrees with everything.`,
      );
    }
    continue;
  }
  // A row with no `ciSecrets` at all has already been FAILED or PRINTED by
  // section 8 on the stronger ground that it declares no secrets whatsoever.
  // Speaking again here would attach two messages to one fault.
  if (names === null) continue;

  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    problems.push(
      `${label} ships to "${ANDROID}" and declares \`signing.ciSecrets.names\`, but no \`signing.ciSecrets.gradleContract\`. [9]R-3: apps/{app}/android/app/build.gradle.kts is where those four values are actually READ, and without this block nothing compares the register's copy of the names to the original. A rename in Gradle alone then leaves the register naming the old value, the lane passing the old value, and the build silently taking the debug fallback with every check green.`,
    );
    continue;
  }

  const declaredIn = typeof contract.declaredIn === 'string' ? contract.declaredIn.trim() : '';
  const envMap = typeof contract.envMap === 'string' ? contract.envMap.trim() : '';
  const signingConfig = typeof contract.signingConfig === 'string' ? contract.signingConfig.trim() : '';
  const buildType = typeof contract.buildType === 'string' ? contract.buildType.trim() : '';
  const transportName = typeof contract.transport?.name === 'string' ? contract.transport.name.trim() : '';
  const substitutes = typeof contract.transport?.substitutes === 'string' ? contract.transport.substitutes.trim() : '';
  const transportWhy = typeof contract.transport?.why === 'string' ? contract.transport.why.trim() : '';

  const shape = [];
  if (!declaredIn.includes('{app}')) {
    shape.push('`declaredIn` must be a path TEMPLATE containing `{app}`. One register row covers every app the factory stamps, so a literal path would check the flagship and silently miss the next module');
  }
  if (envMap === '') shape.push('`envMap` names nothing. It is the Kotlin symbol whose `mapOf` carries the value→variable names, and naming it in the register rather than in here is what stops this guard from being a second declaration of Gradle\'s shape');
  if (signingConfig === '') shape.push('`signingConfig` names nothing. It is the AGP signing config the release build type must reach, and it is the anchor that makes this a check on USE');
  if (buildType === '') shape.push('`buildType` names nothing. It is the build type whose artifact goes to the store — the one whose signing config decides what the .aab is signed with');
  if (transportName === '') shape.push('`transport.name` names nothing. Exactly one declared secret is NOT one of Gradle\'s variables (Gradle wants a path, and a path cannot travel through a repository secret), and an unnamed exception makes the set comparison below fail on a correct register');
  if (substitutes === '') shape.push('`transport.substitutes` names nothing. It is the Gradle key the transport stands in for, and without it nothing says WHICH of Gradle\'s variables is produced rather than passed through');
  if (transportWhy.length < 20) {
    shape.push('`transport.why` carries no reason. A name exempted from this comparison with no reason recorded is an exemption anybody can add to silence a failure — the same cost `ciSecretRegister.nonSigning` entries pay for the same reason');
  }
  if (shape.length) {
    for (const s of shape) problems.push(`${label}'s \`signing.ciSecrets.gradleContract\`: ${s}.`);
    continue;
  }

  const tried = [];
  let readForThisRow = 0;
  for (const a of apps) {
    const slug = typeof a?.slug === 'string' && a.slug.trim() !== '' ? a.slug.trim() : null;
    if (slug === null) continue;
    const rel = declaredIn.split('{app}').join(slug);
    tried.push(rel);
    const raw = read(rel);
    // An app with no Android module yet is not a fault — `tooling/bricks/app`
    // ships no android/ template. The REQUIRED_COVERAGE floor below is what
    // stops "no module anywhere" from reading as agreement.
    if (raw === null) continue;
    readForThisRow++;

    // ── the reductions, each one asserted rather than trusted ────────────────
    const code = stripSourceComments(raw, '.kts');
    if (raw.includes('//') && dense(code) >= dense(raw)) {
      coverageLost([
        `${rel} contains \`//\` comments and \`stripSourceComments(…, '.kts')\` removed none of them.`,
        'That reduction returns an UNKNOWN EXTENSION VERBATIM, so dropping .kts from its map turns this',
        'whole section into a scan of the build file\'s 60-line header — which names ANDROID_KEYSTORE_BASE64,',
        'the signing configs and the whole mechanism, and would satisfy every check below out of prose.',
      ]);
    }
    const skeleton = stripStringLiterals(code);
    if (skeleton.length !== code.length) {
      coverageLost([
        `${rel}: \`stripStringLiterals\` changed the text LENGTH (${code.length} → ${skeleton.length}).`,
        'Every index below is found in the skeleton and used to slice the comment-stripped text, so the',
        'two must stay byte-aligned. They no longer are, and the slices would be off by an unknown amount.',
      ]);
    }

    // ── the map, anchored on the symbol the REGISTER names ──────────────────
    const decl = new RegExp(`\\bval\\s+${rx(envMap)}\\s*=\\s*mapOf\\s*\\(`).exec(code);
    if (decl === null) {
      coverageLost([
        `${rel} declares no \`val ${envMap} = mapOf(…)\` outside its comments.`,
        `The register's gradleContract names ${envMap} as the map that carries the signing value names.`,
        'With it gone (or renamed, or moved into a comment) the release build reads no keystore variables',
        'at all and is unconditionally debug-signed — and comparing the register against nothing agrees.',
      ]);
    }
    const openParen = decl.index + decl[0].length - 1;
    const closeParen = balanced(skeleton, openParen, '(', ')');
    if (closeParen === -1) {
      coverageLost([`${rel}: the \`${envMap}\` mapOf( at offset ${openParen} is never closed. The file does not parse and nothing below can be trusted.`]);
    }
    const pairs = [...code.slice(openParen + 1, closeParen).matchAll(/"([A-Za-z_]\w*)"\s+to\s+"([A-Za-z_]\w*)"/g)].map((x) => [x[1], x[2]]);
    if (pairs.length === 0) {
      coverageLost([
        `${rel}'s \`${envMap}\` map declares no "key" to "VARIABLE" pairs.`,
        'An empty map is a release signing config that reads nothing, and an empty comparison passes.',
      ]);
    }

    // ── USE, not declaration ────────────────────────────────────────────────
    const usedElsewhere = [...code.matchAll(new RegExp(`\\b${rx(envMap)}\\b`, 'g'))].filter(
      (u) => u.index < decl.index || u.index > closeParen,
    );
    if (usedElsewhere.length === 0) {
      problems.push(
        `${rel} declares \`${envMap}\` and NOTHING outside that declaration reads it. The map existing is not the signing identity being read: a build whose config consults none of it takes the debug fallback with the declaration sitting there intact. This repository shipped exactly that shape once already — assert-seams-wired.mjs anchored on a function's own declaration and stayed green after every caller was deleted.`,
      );
    }
    if (!new RegExp(`signingConfigs\\s*\\.\\s*getByName\\s*\\(\\s*"${rx(signingConfig)}"\\s*\\)`).test(code)) {
      problems.push(
        `${rel} never reaches the "${signingConfig}" signing config through \`signingConfigs.getByName("${signingConfig}")\`. The register's gradleContract says the "${buildType}" build type is signed by it; with that wiring gone the build type falls to whatever AGP defaults to and the four values are read into a config nothing applies. (This does NOT require the call to be unconditional — the recorded debug fallback branch is deliberately none of this check's business.)`,
      );
    }
    const create = new RegExp(`\\bcreate\\s*\\(\\s*"${rx(signingConfig)}"\\s*\\)\\s*\\{`).exec(code);
    if (create === null) {
      problems.push(
        `${rel} declares no \`create("${signingConfig}") { … }\` signing config, which the register's gradleContract names as the one carrying this channel's identity.`,
      );
    } else {
      const openBrace = create.index + create[0].length - 1;
      const closeBrace = balanced(skeleton, openBrace, '{', '}');
      if (closeBrace === -1) {
        coverageLost([`${rel}: the \`create("${signingConfig}")\` block at offset ${openBrace} is never closed.`]);
      }
      const body = code.slice(openBrace + 1, closeBrace);
      for (const [key] of pairs) {
        if (!new RegExp(`\\b${rx(key)}\\s*=`).test(body)) {
          problems.push(
            `${rel}: \`${envMap}\` declares the value "${key}" and the \`create("${signingConfig}")\` block never assigns it. A value the map names and the signing config ignores is a value that carries nothing — the map would still list four names while three reached the signer.`,
          );
        }
      }
    }

    // ── the agreement itself, both directions ───────────────────────────────
    const substituted = pairs.find(([k]) => k === substitutes);
    if (substituted === undefined) {
      problems.push(
        `${rel}: the register's \`transport.substitutes\` names Gradle key "${substitutes}", and \`${envMap}\` declares ${pairs.map(([k]) => `"${k}"`).join(', ')}. The transport declaration is stale, so the one name that is legitimately NOT a Gradle variable can no longer be identified and every comparison below would be against the wrong set.`,
      );
      continue;
    }
    /** name → how the build file justifies it. The transport is the single
     *  declared secret that is not one of Gradle's variables. */
    const expected = new Map([[transportName, `the declared transport for Gradle's "${substitutes}" (${transportWhy})`]]);
    for (const [k, v] of pairs) if (k !== substitutes) expected.set(v, `Gradle's "${k}"`);
    const declared = new Set(names);

    for (const [n, why] of expected) {
      if (declared.has(n)) continue;
      problems.push(
        `${rel} carries the signing identity in ${n} (${why}) and ${label} does not declare it in \`signing.ciSecrets.names\` (which lists ${names.join(', ') || 'nothing'}). [9]R-3: the register is the authority on which secrets carry a signing identity into CI, and it is naming a set the build no longer reads. tooling/ci/android-signing.mjs derives from the BUILD, so this drift ends with the lane exporting one set of names while the register documents another and the .aab silently debug-signed.`,
      );
    }
    for (const n of declared) {
      if (expected.has(n)) continue;
      problems.push(
        n === substituted[1]
          ? `${label} declares "${n}" in \`signing.ciSecrets.names\`, and ${rel} reads it as Gradle's "${substitutes}" — the value the register's own \`transport\` says is PRODUCED at run time (${transportWhy}) rather than supplied as a repository secret. Declaring it as a secret invites somebody to create one, and tooling/ci/android-signing.mjs overwrites it on every run.`
          : `${label} declares "${n}" in \`signing.ciSecrets.names\` and ${rel} never reads it. Either the build was renamed and the register was not, or the register names a secret that carries no signing identity — and an authority that over-declares accepts names nothing uses, which is the empty-authority failure limb 2 closes from the other side.`,
      );
    }
    gradleNamesAgreed += [...expected.keys()].filter((n) => declared.has(n)).length;
    gradleFilesCrossChecked++;
  }

  // The floor, and it is REQUIRED_COVERAGE's only reader on purpose. An earlier
  // draft of this line also tested the cross-checked total and read
  // `total > 0 && total < 1` — a condition no input can satisfy. An assertion
  // that cannot fail is worse than none: it inflates apparent coverage. Raising
  // the constant to 2 changes this guard's behaviour, which is the test that it
  // is still connected to something.
  if (readForThisRow < REQUIRED_COVERAGE.androidGradleFilesCrossChecked) {
    coverageLost([
      `${label} declares a \`gradleContract\` whose \`declaredIn\` template reached ${readForThisRow} file(s) on disk; REQUIRED_COVERAGE is ${REQUIRED_COVERAGE.androidGradleFilesCrossChecked}.`,
      `Tried: ${tried.join(', ') || '(no app slugs in ' + APPS + ')'}.`,
      'A comparison against a file that was never read agrees with everything — so moving or renaming the',
      'build file is COVERAGE LOST here rather than a silent pass. Point `declaredIn` at the module.',
    ]);
  }
}

if (scanningRealRepo && androidRows.length === 0) {
  coverageLost([
    `${REGISTER} declares no channel row whose \`platforms\` includes "${ANDROID}".`,
    'Section 9 then has nothing to cross-check against apps/*/android/app/build.gradle.kts and reports',
    'clean over the empty set — which is how deleting the row becomes the cheapest way to pass. The',
    'Android module is in this tree and it is signed; a register that does not mention it is wrong.',
  ]);
}
if (gradleFilesCrossChecked > 0) {
  ok(
    `${gradleFilesCrossChecked} Android build file(s) cross-checked against the register — ${gradleNamesAgreed} signing value name(s) agree, read from the config that actually applies them [9]R-3`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated or deferred; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-channel-register: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-channel-register: ok');
}
