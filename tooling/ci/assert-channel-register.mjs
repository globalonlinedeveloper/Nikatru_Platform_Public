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
//   2. schema — every row is complete enough to be quantified over
//   3. SERVED rows carry what R-3/R-4/R-6/D-9 need: an artifact format, an
//      identity with a restore drill, a lane resolving to a real workflow JOB,
//      a deployment-environment template, and a pinned toolchain floor
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
// ⚠️ NOTHING HERE READS company/. It is gitignored (.gitignore:15) and absent
// from the public repo, so [10]D-4's OWNER_QUEUE limbs are not implementable in
// CI. The register carries the row ids as data; asserting on them is local-only.
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

const KEY_KINDS = new Set([
  'none',
  'upload-key',
  'app-signing-key',
  'distribution-certificate',
  'code-signing-certificate',
  'own-signing-key',
]);
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
    const stripped = raw.replace(/^\s*#.*$/gm, '');
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
  req(
    Array.isArray(c.artifactFormats) && c.artifactFormats.length > 0,
    'declares no `artifactFormats`. [9]R-3 fails a lane that emits a format its channel refuses, and [9]R-4 compares a release asset set to it — both need this field to be non-empty.',
  );
  const signingOk = req(c.signing !== null && typeof c.signing === 'object', 'has no `signing` block.');
  if (signingOk) {
    req(KEY_KINDS.has(c.signing.keyKind), `signing.keyKind is "${c.signing.keyKind}"; expected one of ${[...KEY_KINDS].join(', ')}. An upload key and an app signing key have different loss consequences and the register must say which it holds.`);
    req(
      c.signing.restoreDrill !== null && typeof c.signing.restoreDrill === 'object',
      'has no `signing.restoreDrill` record. [9]R-3 requires a DATED restore drill per published channel.',
    );
  }
  req(Array.isArray(c.minimumToolchain), 'has no `minimumToolchain` array (names tooling/versions.json KEYS, never values — [pipeline F-2]).');
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
  }

  // ── what SERVED additionally means ────────────────────────────────────────
  if (c.served === true) {
    const lane = c.lane;
    if (lane === null || typeof lane !== 'object' || typeof lane.workflow !== 'string' || typeof lane.job !== 'string') {
      problems.push(`${where} is SERVED but names no \`lane\` {workflow, job}. [9]R-6 resolves the gated commit from the lane, and [9]R-2 derives the version there — neither has a subject without it.`);
    } else {
      const wf = workflow(lane.workflow);
      if (wf === null) {
        problems.push(`${where} is SERVED and its lane names ${lane.workflow}, which does not exist.`);
      } else if (wf.rawTopLevel > 0 && wf.jobs.size === 0) {
        coverageLost([
          `${lane.workflow} has ${wf.rawTopLevel} top-level key(s) and ZERO parsed jobs.`,
          'The workflow parser has stopped reaching the file, so every "does this job exist" answer',
          'below is being read off an empty map and would print ok.',
        ]);
      } else if (!wf.jobs.has(lane.job)) {
        problems.push(
          `${where} is SERVED and claims lane job "${lane.job}" in ${lane.workflow}, which declares [${[...wf.jobs.keys()].join(', ')}]. A lane naming a job that does not exist is a lane that runs nothing.`,
        );
      }
    }

    if (typeof c.deploymentEnvironment !== 'string' || !c.deploymentEnvironment.includes('{app}')) {
      problems.push(
        `${where} is SERVED but has no \`deploymentEnvironment\` template containing {app}. [10]D-9 derives the required environment set from this register × apps.json, so without the template "what is live on which channel" has no query.`,
      );
    }

    if (signingOk && c.signing.keyKind !== 'none') {
      const drill = c.signing.restoreDrill ?? {};
      if (drill.required !== false && !/^\d{4}-\d{2}-\d{2}$/.test(String(drill.date ?? ''))) {
        problems.push(
          `${where} is SERVED with keyKind "${c.signing.keyKind}" and has no DATED restore drill. [9]R-3: a published channel carries an identity, a format and a dated restore-drill record. An undrilled key is a key we only find out is unrestorable on the day we need it.`,
        );
      }
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
for (const c of served) {
  const orphan = (c.platforms ?? []).filter((p) => !claimed.has(p));
  if (orphan.length === (c.platforms ?? []).length && orphan.length > 0) {
    problems.push(
      `channel "${c.id}" is SERVED but no app in ${APPS} claims ${orphan.map((p) => `"${p}"`).join(' or ')}. A served channel the factory ships nothing to is cut 5's corollary growing back as data: "remove 'six platforms' from site copy until it is true".`,
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
    // The aggregate must fail on CANCELLED as well as FAILURE. A cancelled job
    // has not succeeded, and `if: always()` means the aggregate still runs.
    for (const verdict of ['failure', 'cancelled']) {
      if (!body.includes(`'${verdict}'`) && !body.includes(`"${verdict}"`)) {
        problems.push(
          `${agg.workflow}: job "${agg.job}" never tests for '${verdict}'. A ${verdict} platform job is not a green one, and with \`if: always()\` the aggregate runs anyway and reports success.`,
        );
      }
    }
    if (!missing.length && !ghost.length) {
      ok(`aggregating job "${agg.job}" needs all ${others.length} other job(s) in ${agg.workflow}`);
    }
  }
}

// ── 7. disqualified channels ─────────────────────────────────────────────────
const disqualified = Array.isArray(register.disqualified) ? register.disqualified : [];
for (const d of disqualified) {
  const id = d.id ?? '(unnamed)';
  if (seenIds.has(id)) {
    problems.push(`"${id}" is both a live channel and a disqualified one. One of the two entries is a lie and nothing says which.`);
  }
  if (typeof d.adr !== 'string' || !existsSync(abs(d.adr))) {
    problems.push(`disqualified channel "${id}" names ADR "${d.adr}", which is not on disk. A channel killed by a decision nobody can open is a channel that comes back.`);
    continue;
  }
  const adr = read(d.adr) ?? '';
  if (!/LOCKED/.test(adr)) {
    problems.push(`disqualified channel "${id}" cites ${d.adr}, which does not record itself as LOCKED. Only a locked decision disqualifies a channel.`);
  } else {
    prints.push(`DISQUALIFIED: ${id} (${(d.platforms ?? []).join(', ')}) — ${d.adr}, ${d.date ?? 'undated'}${d.ownerQueue ? ` · OWNER_QUEUE ${d.ownerQueue}` : ''}`);
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
