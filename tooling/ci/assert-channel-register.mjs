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
//
// ⚠️ DEFERRED-ROW GAPS PRINT, THEY DO NOT FAIL. Apple's Xcode 26 floor is real
// and unpinned, and the channel is owner-deferred (OWNER_QUEUE A-4). Per the
// standing rule (assert-seams-wired.mjs, [pipeline C-6]) a guard on owner-gated
// work prints the gap on every run rather than blocking all CI on work only the
// owner can do. A known gap nobody sees becomes permanent.
//
// 🔴 CI CANNOT SEE company/ OR knowledge/. Both are gitignored (.gitignore:14-15)
// and absent from the public checkout. Two consequences, and the second one bit
// this guard on its own first CI run:
//   · [10]D-4's OWNER_QUEUE limbs are NOT implementable in CI at all. The
//     register carries the row ids as data; asserting on them is local-only.
//   · every ADR path a guard cites is unresolvable in CI. This guard's
//     disqualified-channel check failed on run 30609219162 for exactly that
//     reason — a correct check reporting a fault that did not exist.
// The fix is NOT to drop the check and it is NOT a silent skip ("silence is not
// success"). It is to decide from the HARNESS ROOT: if knowledge/ is present the
// full check runs and a deleted or downgraded ADR fails; if knowledge/ is absent
// ENTIRELY the guard says so, loudly, on every run. A single missing ADR inside a
// present knowledge/ is still a failure — which is the case that matters, and it
// is the one a blanket existsSync() skip would have thrown away.
//
// Usage:  node tooling/ci/assert-channel-register.mjs [repoRoot]
// Exit 0 = the register, the apps and the workflows agree. 1 = they do not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
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
    // stay uncheckable in CI by design (company/ is gitignored, and the _readme
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
// .github/, which is in the public repo, so there is no company/ mode to handle.
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

// ── 7. disqualified channels ─────────────────────────────────────────────────
// The ADR check is MODE-AWARE, and the mode is decided by the harness ROOT, not
// by the individual file. `knowledge/` is gitignored, so in a CI checkout every
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
      `   └─ ADR UNVERIFIABLE IN THIS CHECKOUT — \`${adrRoot(d.adr)}/\` is not present (it is gitignored, .gitignore:14-15). The citation's CONTENT is checked only where the harness is checked out, i.e. locally. This is a stated limit, not a pass.`,
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
for (const s of register.nonChannelSigningIdentities ?? []) {
  if (!KEY_KINDS.has(s.keyKind)) {
    problems.push(`signing identity "${s.id ?? '(unnamed)'}" has keyKind "${s.keyKind}"; expected one of ${[...KEY_KINDS].join(', ')}.`);
    continue;
  }
  const drill = s.restoreDrill ?? {};
  if (drill.required !== false && !/^\d{4}-\d{2}-\d{2}$/.test(String(drill.date ?? ''))) {
    prints.push(`UNDRILLED IDENTITY: ${s.id} — no dated restore drill on record.`);
  }
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
