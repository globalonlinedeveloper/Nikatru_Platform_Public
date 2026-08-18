#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// resolve-slot.mjs — THE PARAMETERISER. This is the only reason there is one
// pipeline template instead of fifteen hand-written copies.
//
// It answers, for the checkout it is standing in: WHICH SLOT IS THIS, and
// therefore what does this repository build, with what toolchain, on what
// runner, into what artifact format, signed with what kind of key, and through
// what submission path — every one of those DERIVED from two registers that
// already exist, and none of them typed here.
//
//   catalog/store-matrix.json     — the slot rows (store × target × type). The
//                                   primary key of the whole matrix.
//   tooling/channel-register.json — the per-channel facts: artifactFormats,
//                                   signing, minimumToolchain, lane, submission.
//   catalog/copy-origins.json     — targetPlatformDirs: which Flutter platform
//                                   directory is this target's own.
//
// 🔴 NOT ONE STORE NAME IS SPELLED IN THIS FILE. Grep it: there is no
// `Google_Play_Store`, no `android-play`, no `ubuntu-24.04`. Every such string
// is read out of a register at run time. That is the whole design: a new store
// is A ROW, and this script is what makes that true of the pipeline as well as
// of the registry. The day a store needs a line added here, this file has
// failed and the failure is this file's, not the row's.
//
// ── HOW THE SLOT IS IDENTIFIED, AND WHY IT REFUSES RATHER THAN GUESSES ───────
// A slot repository is one checkout. Nothing inside it says "I am the Microsoft
// Store / Windows / Games slot" — and NOTHING SHOULD, because a `slot: …` file
// committed into each repo is fifteen typed copies of a fact the registry
// already holds, i.e. exactly the duplication this template exists to avoid.
//
// So the slot is identified by matching the checkout against the registry, from
// as many independent signals as are available, and REQUIRING THEM TO AGREE:
//
//   1. `--slot <dir>`            explicit, printed, always wins the tie-break
//                                only by being the sole signal considered.
//   2. `SLOT_PUBLIC_DIR`         env, for callers that cannot pass argv.
//   3. git origin URL            vs each row's repos.<side>.boundRemote.
//   4. `GITHUB_REPOSITORY`       its name half, vs publicDir / privateDir.
//   5. checkout directory name   vs publicDir / privateDir.
//
// Signals 4 and 5 rest on `naming.repoNameRule`, which store-matrix.json itself
// records as PROPOSED AND NOT SETTLED. That does not make them unsafe here: a
// name either matches exactly one row or it does not. It does mean they are
// printed as what they are, so a reader can see which unsettled rule a
// resolution leaned on.
//
// 🔴 ZERO SIGNALS -> REFUSE. TWO SIGNALS THAT DISAGREE -> REFUSE. There is no
// fallback to "the only live slot", and that absence is the single most
// important line in this script. Fourteen of the fifteen slots are empty; a
// resolver that quietly answered "subly's slot" when it could not tell would
// make every one of those fourteen pipelines pass, building the flagship, while
// reporting the name of a store it has never shipped to.
//
// ── EXIT CODES: FOUR DIFFERENT ABSENCES, FOUR DIFFERENT ANSWERS ──────────────
// STORE-MATRIX-PLAN.md section 4.3 states the rule this obeys: two absences with
// different causes must never be answered by the same test. Here there are four.
//
//   0  RESOLVED. Slot known, channel known, and a product is present.
//   1  FINDINGS. Everything resolved and something is wrong with it — e.g. two
//      submittable channels claim one target, so "the store for this slot" is
//      ambiguous and no pipeline may pick one.
//   2  COVERAGE LOST. The slot could not be identified at all, or a register
//      could not be read. This script checked NOTHING. Never 0.
//   3  NO PRODUCT IN THIS SLOT. The slot resolved perfectly; there is simply no
//      source here to build. This is the NORMAL, EXPECTED state of 14 of the 15
//      slots today, and it is a distinct code precisely so that "empty slot" can
//      never be mistaken in a log for "misconfigured slot" or for "built fine".
//   4  NO CHANNEL. The slot resolved and tooling/channel-register.json has no
//      row covering its target, so there is no artifact format, no signing
//      story and no submission path to derive. True today of all three
//      extension stores. Reported, never invented.
//
// Usage:
//   node tooling/store-pipeline/resolve-slot.mjs [--slot <publicDir>] [--json]
//        [--require-product] [--github-output] [--root <dir>]
//
//   --require-product   turn code 3 from a printed statement into a failure.
//                       The build job passes it; the plan job does not.
//   --github-output     append the resolved plan to $GITHUB_OUTPUT so the
//                       workflow's later jobs can be parameterised by it.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ARTIFACT_BUILD } from './artifact-build.mjs';

const ARGV = process.argv.slice(2);
const has = (n) => ARGV.includes(n);
const val = (n) => {
  const i = ARGV.indexOf(n);
  return i >= 0 && i + 1 < ARGV.length ? ARGV[i + 1] : null;
};

const WANT_JSON = has('--json');
const REQUIRE_PRODUCT = has('--require-product');
const WANT_GH_OUTPUT = has('--github-output');

const out = [];
const say = (s = '') => out.push(s);

/** Every refusal goes through here so the marker, the code and the shape of the
 *  message cannot drift apart between limbs. Mirrors assert-store-matrix.mjs. */
function coverageLost(lines) {
  for (const l of out) console.log(l);
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
}

// ── the registers ────────────────────────────────────────────────────────────
const SELF = fileURLToPath(import.meta.url);
const MATRIX_REL = 'catalog/store-matrix.json';
const CHANNELS_REL = 'tooling/channel-register.json';
const ORIGINS_REL = 'catalog/copy-origins.json';
const APPS_REL = 'catalog/apps.json';
const PARSER_REL = 'tooling/ci/workflow-scan.mjs';

/** Repo root = the nearest ancestor holding BOTH registers. Both, not either:
 *  a tree with only one of them is a tree this script cannot answer from, and
 *  answering from half a tree is how a derived value becomes a guess. */
function findRoot(start) {
  const walked = [];
  let dir = resolve(start);
  for (;;) {
    walked.push(dir);
    if (existsSync(join(dir, MATRIX_REL)) && existsSync(join(dir, CHANNELS_REL))) return { root: dir, walked };
    const up = dirname(dir);
    if (up === dir) return { root: null, walked };
    dir = up;
  }
}

const ROOT_OVERRIDE = val('--root');
const found = findRoot(ROOT_OVERRIDE ? resolve(ROOT_OVERRIDE) : dirname(SELF));
if (!found.root) {
  coverageLost([
    `neither ${MATRIX_REL} nor ${CHANNELS_REL} was found in any ancestor of ${ROOT_OVERRIDE ?? dirname(SELF)}`,
    ...found.walked.map((d) => `walked: ${d}`),
    'This template is PARAMETERISED BY THOSE TWO REGISTERS. Without them it has',
    'no store, no target, no artifact format and no signing story to report, and',
    'a pipeline that reports those from nowhere is a pipeline reporting fiction.',
    'STORE-MATRIX-PLAN.md section 5.6 — whether tooling/ is copied per slot — is',
    'OPEN, and this is the failure that decision produces if it is answered "no"',
    'without also deciding where a slot repo reads its registers from.',
  ]);
}
const ROOT = found.root;
if (ROOT_OVERRIDE) say(`⚠️  --root OVERRIDDEN: ${ROOT}  (not the real checkout unless you meant it)`);

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch (e) {
    coverageLost([`${rel} is unreadable or is not JSON: ${e.message}`, `root: ${ROOT}`]);
  }
}

const matrix = readJson(MATRIX_REL);
const register = readJson(CHANNELS_REL);
const origins = existsSync(join(ROOT, ORIGINS_REL)) ? readJson(ORIGINS_REL) : null;

if (!Array.isArray(matrix.slots) || matrix.slots.length === 0) {
  coverageLost([
    `${MATRIX_REL} declares no slots`,
    '`slots: []` is valid JSON and satisfies every derivation below vacuously.',
    'A resolver that answered over zero rows would report a clean plan for a',
    'registry that declares nothing.',
  ]);
}
if (!Array.isArray(register.channels) || register.channels.length === 0) {
  coverageLost([`${CHANNELS_REL} declares no channels`, 'Same floor, same reason.']);
}

// ── derivations, exactly as catalog/store-matrix.json's `derivations` block ───
const privateOf = (publicDir) => publicDir.replace(/_Public$/, '_Private');
const slotPath = (s) => `${s.store}/${s.target}/${s.type}`;
const rowLabel = (s) => `${slotPath(s)} (${s.publicDir})`;

// ── WHICH SLOT IS THIS? ──────────────────────────────────────────────────────
/** Each signal returns { signal, value, rows } — rows being every registry row
 *  the value matches. A signal that matches nothing contributes nothing; a
 *  signal that matches more than one row is itself a finding. */
const signals = [];

function addSignal(name, value, note) {
  if (!value) return;
  const rows = matrix.slots.filter((s) => s.publicDir === value || privateOf(s.publicDir) === value);
  signals.push({ name, value, note: note ?? null, rows });
}

addSignal('--slot', val('--slot'), 'explicit');
addSignal('SLOT_PUBLIC_DIR', process.env.SLOT_PUBLIC_DIR ?? null, 'environment');

// git origin -> boundRemote. The one signal that does NOT rest on the unsettled
// repo-naming rule: a bound remote is a measured fact recorded in the row.
let originUrl = null;
try {
  originUrl = execFileSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  originUrl = null;
}
if (originUrl) {
  const norm = (u) => String(u).replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  const rows = matrix.slots.filter((s) =>
    ['public', 'private'].some((side) => {
      const bound = s.repos?.[side]?.boundRemote;
      return bound && norm(bound) === norm(originUrl);
    }),
  );
  if (rows.length) signals.push({ name: 'git origin', value: originUrl, note: 'boundRemote', rows });
  else say(`ℹ️  git origin is ${originUrl} and NO row declares it as a boundRemote — this signal contributed nothing.`);
}

// GITHUB_REPOSITORY -> name half. Rests on naming.repoNameRule, which the
// registry itself records as PROPOSED. Printed as such.
const ghRepo = process.env.GITHUB_REPOSITORY ?? null;
if (ghRepo) addSignal('GITHUB_REPOSITORY', ghRepo.split('/').pop(), 'repo name == directory name — naming.repoNameRule, PROPOSED not settled');

// checkout directory name. Same unsettled rule, one step further removed.
addSignal('checkout dir', basename(ROOT), 'directory name — naming.repoNameRule, PROPOSED not settled');

// 🔴 AN EXPLICIT SIGNAL IS A DECLARATION, AND IT IS THE ONLY ONE CONSIDERED.
// `--slot` / `SLOT_PUBLIC_DIR` exist so the fourteen slots that have no checkout
// of their own can still be resolved — from inside this one repo, by name. If
// they were merely added to the pile, every such call would disagree with the
// directory it is standing in and refuse, which is the same as not having them.
// The disagreement is not swallowed, though: it is PRINTED, in capitals, so an
// overridden run can never be mistaken in a log for a run against this checkout.
// (Same convention as assert-store-matrix.mjs's --projects / --registry.)
const EXPLICIT = new Set(['--slot', 'SLOT_PUBLIC_DIR']);

// 🔴 AN EXPLICIT NAME THAT MATCHES NOTHING REFUSES HERE, AND THIS LINE EXISTS
// BECAUSE ITS ABSENCE WAS A LIVE DEFECT. Without it, `--slot
// Nikatru_Typo_Apps_Public` matched no row, contributed no signal, and the
// resolution fell through to the checkout directory — so a run that named a
// slot it could not find silently resolved to the flagship and reported exit 0.
// That is precisely the fallback this script's header promises does not exist,
// reached by the one path nobody looks at: a typo. Caught by
// test/slot-pipeline.test.mjs on its first run.
const explicitGiven = signals.filter((s) => EXPLICIT.has(s.name));
for (const s of explicitGiven) {
  if (s.rows.length === 0) {
    coverageLost([
      `${s.name} = ${s.value} names no slot in the registry`,
      `${matrix.slots.length} rows were available to match against; none has that publicDir or its`,
      '_Public -> _Private swap.',
      '',
      'REFUSING rather than falling back to whatever this checkout looks like. A run',
      'that names a slot it cannot find and then answers about a different one is',
      'worse than a run that stops.',
    ]);
  }
}

const explicit = explicitGiven.filter((s) => s.rows.length > 0);
const implicit = signals.filter((s) => !EXPLICIT.has(s.name) && s.rows.length > 0);
let contributing = signals.filter((s) => s.rows.length > 0);

let OVERRIDDEN = false;
if (explicit.length > 0) {
  const declared = new Set(explicit.flatMap((s) => s.rows.map((r) => r.publicDir)));
  const observed = new Set(implicit.flatMap((s) => s.rows.map((r) => r.publicDir)));
  for (const o of observed) {
    if (!declared.has(o)) {
      OVERRIDDEN = true;
      say(`⚠️  SLOT OVERRIDDEN: this checkout looks like ${o}; the run was told ${[...declared].join(', ')}.`);
      say('    Proceeding with what was declared. Nothing below describes this checkout.');
    }
  }
  contributing = explicit;
}

if (contributing.length === 0) {
  coverageLost([
    'no signal identified this checkout as any slot in the registry',
    ...signals.map((s) => `  tried ${s.name} = ${s.value} -> matched no row`),
    signals.length === 0 ? '  no signal produced a value at all' : '',
    `${matrix.slots.length} rows were available to match against.`,
    '',
    '🔴 THERE IS DELIBERATELY NO FALLBACK. The obvious one — "assume the only',
    'live slot" — would make all fourteen empty slots resolve to the flagship,',
    'build it, and print the name of a store this repository has never shipped',
    'to. Pass --slot <publicDir> if you know which slot you meant.',
  ].filter(Boolean));
}

const distinct = new Map();
for (const s of contributing) for (const r of s.rows) distinct.set(r.publicDir, r);

if (distinct.size > 1) {
  coverageLost([
    `signals disagree: ${distinct.size} different slots matched`,
    ...contributing.map((s) => `  ${s.name} = ${s.value} -> ${s.rows.map((r) => r.publicDir).join(', ')}`),
    'Two answers is not one answer. Nothing is picked; pass --slot to say which.',
  ]);
}

const SLOT = [...distinct.values()][0];
say('── SLOT ────────────────────────────────────────────────────────────────');
say(`  ${rowLabel(SLOT)}`);
say(`  store=${SLOT.store}  target=${SLOT.target}  type=${SLOT.type}  state=${SLOT.state}`);
say(`  public=${SLOT.publicDir}   private=${privateOf(SLOT.publicDir)}`);
for (const s of contributing) say(`  identified by ${s.name} = ${s.value}${s.note ? `  [${s.note}]` : ''}`);

// ── WHICH CHANNEL(S)? Derived from platforms, never from a typed table. ──────
// The join is `channel.platforms` contains `target` lower-cased. It holds for
// every target the register covers, and where it does not hold the answer is
// the empty set — which is reported as code 4, not papered over.
const lower = (x) => String(x).toLowerCase();
const candidates = register.channels.filter((ch) => (ch.platforms ?? []).map(lower).includes(lower(SLOT.target)));
const submittable = candidates.filter((ch) => ch.submittable === true);

say('');
say('── CHANNEL ─────────────────────────────────────────────────────────────');
if (candidates.length === 0) {
  say(`  ✗ NO CHANNEL covers target "${SLOT.target}".`);
  say(`    ${CHANNELS_REL} has ${register.channels.length} channels and none of them lists`);
  say(`    "${lower(SLOT.target)}" among its platforms.`);
  say('    This is TRUE, not a bug in this script, and it is true today of every');
  say('    browser-extension slot: the extensions live in a different repository');
  say('    pair entirely (see catalog/store-matrix.json backing.products[fullshot])');
  say('    and this register has never described them.');
  say('    🔴 Nothing here invents a lane for them. STORE-MATRIX-PLAN.md section 2.3');
  say('    is why that restraint matters: the AMO add-on id is fixed permanently at');
  say('    first signing, so a guessed submission path is a guess with no undo.');
  for (const l of out) console.log(l);
  process.exit(4);
}

const channelIds = candidates.map((c) => c.id);
say(`  candidate channel(s) for target "${SLOT.target}": ${channelIds.join(', ')}`);

if (submittable.length > 1) {
  say(`  ✗ AMBIGUOUS: ${submittable.length} channels claim to be submittable for this target`);
  say(`    (${submittable.map((c) => c.id).join(', ')}). "The store for this slot" has two`);
  say('    answers, so no pipeline may pick one. Fix the register, not this script.');
  for (const l of out) console.log(l);
  process.exit(1);
}

const store = submittable[0] ?? null;
if (store) {
  say(`  store channel: ${store.id}  (kind=${store.kind}, served=${store.served})`);
} else {
  say(`  store channel: NONE — no candidate is submittable.`);
  say(`    Not a gap. ${candidates.map((c) => `${c.id} is kind=${c.kind}/submittable=${c.submittable}`).join('; ')}.`);
  say('    A slot whose only channel is a deploy has no third-party store to submit');
  say('    to, and its pipeline must therefore have no submission job at all.');
}

// ── PER-STORE FACTS: every one of them READ, none typed ──────────────────────
const artifactFormats = [...new Set(candidates.flatMap((c) => c.artifactFormats ?? []))];
const toolchain = [...new Set(candidates.flatMap((c) => c.minimumToolchain ?? []))];
const signing = store?.signing ?? candidates[0]?.signing ?? null;
const signingSecrets = signing?.ciSecrets?.names ?? [];
const submission = store?.submission ?? null;
const account = store?.accountStatus ?? null;

say('');
say('── WHAT IS GENUINELY PER-STORE (read from the register, never typed here) ─');
say(`  artifact format(s) : ${artifactFormats.length ? artifactFormats.join(', ') : '(none declared)'}`);
say(`  toolchain          : ${toolchain.length ? toolchain.join(', ') : '(none declared)'}`);
say(`  signing key kind   : ${signing ? signing.keyKind : '(no channel row)'}`);
say(`  signing secrets    : ${signingSecrets.length ? signingSecrets.join(', ') : '(none — this channel signs nothing of ours)'}`);
say(`  submission script  : ${submission?.script ?? '(none — nothing in this repo submits to this channel)'}`);
say(`  submission workflow: ${submission?.workflow ?? '(none)'}${submission?.job ? `#${submission.job}` : ''}`);
say(`  publisher account  : ${account ? `${account.status} (as of ${account.asOf})` : '(not declared)'}`);
if (store?.storeMetadataDir) say(`  listing metadata   : ${store.storeMetadataDir}`);

// ── THE ONE TABLE IN THIS TEMPLATE ──────────────────────────────────────────
// Imported, not declared here, so that assert-slot-pipeline.mjs can hold it to
// the register in both directions without importing a script that exits.
// See artifact-build.mjs for why the fact needs a home at all.
const buildVerbs = artifactFormats.map((f) => ({ format: f, ...(ARTIFACT_BUILD[f] ?? { flutterTarget: null, packagedBy: null }) }));
const unmappedFormats = buildVerbs.filter((b) => b.flutterTarget === null).map((b) => b.format);

say('');
say('── BUILD VERB ──────────────────────────────────────────────────────────');
if (unmappedFormats.length) {
  say(`  ✗ no build verb is declared for format(s): ${unmappedFormats.join(', ')}`);
  say('    A format the register names and this template cannot build is a slot');
  say('    whose pipeline would run and produce nothing the store accepts.');
}
for (const b of buildVerbs.filter((b) => b.flutterTarget)) {
  say(`  ${b.format.padEnd(14)} <- flutter build ${b.flutterTarget}`);
  say(`  ${''.padEnd(14)}    packaging: ${b.packagedBy ?? 'none needed — flutter emits this format directly'}`);
}

// ── THE BUILD LANE AND ITS RUNNER, PARSED OUT OF THE LANE THE REGISTER NAMES ─
// The runner label is NOT a table in this directory. `channel.lane` names a
// workflow and a job; that job's `runs-on` is the authority. One fact, one
// place — and the place is the lane that already builds this target.
let lane = null;
let runner = null;
const laneEnv = {};
const laneChannel = candidates.find((c) => c.lane?.workflow && c.lane?.job) ?? null;
say('');
say('── BUILD LANE ──────────────────────────────────────────────────────────');
if (!laneChannel) {
  say(`  ✗ NO BUILD LANE. None of ${channelIds.join(', ')} declares lane.workflow + lane.job.`);
  say('    Stated plainly because it is a real hole and not a formatting quirk:');
  say('    this repository has no job that emits this target\'s store artifact.');
} else {
  lane = laneChannel.lane;
  const parserAbs = join(ROOT, PARSER_REL);
  if (!existsSync(parserAbs)) {
    coverageLost([
      `${PARSER_REL} is missing, so the lane's runner cannot be parsed`,
      'This template deliberately does NOT carry its own workflow parser.',
      'tooling/ci/assert-guard-coverage.mjs records what four copies of a workflow',
      'parser cost: they drift in the one way that reports clean — WHICH LINES',
      'THEY CAN SEE. So the parser is imported, and its absence is loud.',
      'STORE-MATRIX-PLAN.md section 5.6 (is tooling/ copied per slot?) is the',
      'decision that produces this failure, and this is where it lands.',
    ]);
  }
  const { parseWorkflow } = await import(`file://${parserAbs.replace(/\\/g, '/')}`);
  const wf = parseWorkflow(ROOT, lane.workflow);
  if (!wf) {
    say(`  ✗ lane workflow ${lane.workflow} is declared by channel ${laneChannel.id} and is NOT in this checkout.`);
  } else {
    const job = wf.jobs.get(lane.job);
    if (!job) {
      say(`  ✗ lane job "${lane.job}" is declared and does not exist in ${lane.workflow}.`);
    } else {
      const m = job.lines.map((l) => l.text).find((t) => /^ {4}runs-on:\s*\S/.test(t));
      const label = m ? m.replace(/^\s*runs-on:\s*/, '').trim() : null;
      if (!label) say(`  ⚠️  ${lane.workflow}#${lane.job} declares no literal runs-on.`);
      else if (/\$\{\{/.test(label)) say(`  ⚠️  ${lane.workflow}#${lane.job} runs-on is an expression (${label}); not resolved here rather than guessed.`);
      else runner = label;
      say(`  lane   : ${lane.workflow}#${lane.job}`);
      say(`  runner : ${runner ?? '(unresolved — see above)'}   [read from that job, not typed here]`);
    }
    // The toolchain VERSION is a fact the lane already pins. Re-typing it in a
    // template that ships to fifteen repositories is fifteen copies of a number
    // that will one day disagree with the lane that actually builds. So it is
    // read out of the lane workflow's own top-level `env:` block.
    let inEnv = false;
    for (const { text } of wf.lines) {
      if (/^env:\s*$/.test(text)) { inEnv = true; continue; }
      if (inEnv && /^\S/.test(text)) break;
      const m = inEnv && text.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*['"]?([^'"\s]+)['"]?\s*$/);
      if (m) laneEnv[m[1]] = m[2];
    }
    const pinned = Object.entries(laneEnv).filter(([k]) => /VERSION$/.test(k));
    if (pinned.length) say(`  pinned : ${pinned.map(([k, v]) => `${k}=${v}`).join('  ')}   [read from ${lane.workflow}, not typed here]`);
    else say(`  pinned : (${lane.workflow} declares no top-level *_VERSION)`);
  }
}

// ── IS THERE A PRODUCT IN THIS SLOT AT ALL? ──────────────────────────────────
// The question this whole template exists to keep honest. A pipeline for a slot
// with no source is a pipeline that has never run.
const platformDirs = origins?.targetPlatformDirs?.[SLOT.target] ?? null;
const apps = existsSync(join(ROOT, APPS_REL)) ? readJson(APPS_REL) : [];
const slugs = Array.isArray(apps) ? apps.map((a) => a.slug).filter(Boolean) : [];

say('');
say('── PRODUCT ─────────────────────────────────────────────────────────────');
let productState = 'present';
const productNotes = [];

if (OVERRIDDEN) {
  // 🔴 CAPABILITY IS NOT BACKING, AND THIS IS WHERE THE TWO GET CONFUSED.
  // Run from inside the flagship checkout with `--slot Nikatru_iOS_Apps_Public`,
  // the directory test below would find apps/subly/ios — because this ONE app
  // carries all six Flutter platform directories — and answer "product present"
  // for a slot whose repository pair is EMPTY. catalog/store-matrix.json's
  // `backing.rule` names that mistake exactly: "counting capability instead of
  // existence is exactly how fourteen empty directories start reading as a
  // portfolio." So the question is refused rather than answered from the wrong
  // tree. To measure a slot's product, stand in that slot.
  productState = 'not-measurable-here';
  productNotes.push('this run was overridden onto a slot that is not this checkout, so the');
  productNotes.push('question "is there a product in that slot" is about a tree not present.');
  productNotes.push(`this checkout can only say what THIS repository carries; the ${SLOT.publicDir}`);
  productNotes.push('pair is where that slot\'s product would have to be, and it is not here.');
  productNotes.push('CAPABILITY IS NOT BACKING — see catalog/store-matrix.json `backing.rule`.');
} else if (platformDirs === null) {
  productState = 'unknown';
  productNotes.push(`${ORIGINS_REL} has no targetPlatformDirs entry for target "${SLOT.target}",`);
  productNotes.push('so what a product for this slot would even LOOK like is undeclared.');
} else if (platformDirs.length === 0) {
  productState = 'inexpressible';
  productNotes.push(`target "${SLOT.target}" maps to NO platform directory — a declared answer,`);
  productNotes.push('not a missing one: an extension has no Flutter platform directory. Nothing');
  productNotes.push('in this repository can currently tell whether an extension product is here.');
} else if (slugs.length === 0) {
  productState = 'absent';
  productNotes.push(`${APPS_REL} declares no apps, so nothing claims to be built here.`);
} else {
  const built = [];
  const missing = [];
  for (const slug of slugs) {
    for (const pd of platformDirs) {
      const rel = `apps/${slug}/${pd}`;
      const abs = join(ROOT, rel);
      const nonEmpty = existsSync(abs) && readdirSync(abs).length > 0;
      (nonEmpty ? built : missing).push(rel);
    }
  }
  if (built.length === 0) {
    productState = 'absent';
    productNotes.push(`no app in ${APPS_REL} carries this target's platform directory:`);
    for (const r of missing) productNotes.push(`  missing/empty: ${r}`);
  } else {
    for (const r of built) productNotes.push(`  present: ${r}`);
    for (const r of missing) productNotes.push(`  missing/empty: ${r}`);
  }
}

for (const n of productNotes) say(`  ${n}`);

// The registry's own summary of this slot and what the tree just showed must
// agree. Two copies of one fact, and this is the thing that checks them.
let stateDisagreement = null;
if (!OVERRIDDEN) {
  if (SLOT.state === 'live' && productState !== 'present') {
    stateDisagreement = `registry says state="live" and no product was found in this checkout`;
  } else if (SLOT.state !== 'live' && productState === 'present') {
    stateDisagreement = `registry says state="${SLOT.state}" and a product IS present in this checkout`;
  }
}
if (stateDisagreement) {
  say('');
  say(`  ✗ ${stateDisagreement}.`);
  say('    The row and the tree disagree. Nothing here rewrites the row to match —');
  say('    a registry that edits itself to agree with reality can never report that');
  say('    reality drifted. A human decides which is wrong.');
}

if (productState !== 'present') {
  say('');
  say(`  ✗ NO PRODUCT IN THIS SLOT (${productState}).`);
  say('    The slot resolved correctly. The registry row is fine. The channel is');
  say('    fine. There is simply nothing here to build, which is the ORDINARY,');
  say('    EXPECTED state of most of this matrix today — 14 of 15 slot pairs are');
  say('    empty shells. It is a separate exit code from every other failure so');
  say('    that "empty slot" can never be read in a log as "slot built fine".');
  if (!REQUIRE_PRODUCT) {
    say('    Reported, not failed: --require-product was not passed.');
  }
}

// ── OUTPUT ───────────────────────────────────────────────────────────────────
const plan = {
  store: SLOT.store,
  target: SLOT.target,
  type: SLOT.type,
  publicDir: SLOT.publicDir,
  privateDir: privateOf(SLOT.publicDir),
  path: slotPath(SLOT),
  state: SLOT.state,
  channels: channelIds,
  storeChannel: store?.id ?? null,
  submittable: Boolean(store),
  artifactFormats,
  toolchain,
  signingKeyKind: signing?.keyKind ?? null,
  signingSecrets,
  submissionScript: submission?.script ?? null,
  submissionWorkflow: submission?.workflow ?? null,
  submissionJob: submission?.job ?? null,
  storeMetadataDir: store?.storeMetadataDir ?? null,
  laneWorkflow: lane?.workflow ?? null,
  laneJob: lane?.job ?? null,
  runner,
  flutterVersion: laneEnv.FLUTTER_VERSION ?? null,
  // De-duplicated: a target matched by two channels (Windows -> windows-store
  // and windows-direct; Linux -> linux-snap and linux-appimage) yields the same
  // flutter verb twice, and building it twice is a build the second half of
  // which proves nothing.
  flutterTargets: [...new Set(buildVerbs.filter((b) => b.flutterTarget).map((b) => b.flutterTarget))],
  unmappedFormats,
  platformDirs,
  productState,
};

if (WANT_JSON) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  for (const l of out) console.log(l);
}

if (WANT_GH_OUTPUT) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) {
    console.error('✗ --github-output was passed and $GITHUB_OUTPUT is unset. Refusing to');
    console.error('  drop the plan on the floor: a later job parameterised by an empty');
    console.error('  output builds nothing and says nothing about it.');
    process.exit(2);
  }
  const kv = Object.entries(plan).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(' ') : v === null ? '' : v}`);
  appendFileSync(f, kv.join('\n') + '\n');
}

if (stateDisagreement) process.exit(1);
if (productState !== 'present' && REQUIRE_PRODUCT) process.exit(3);
process.exit(0);
