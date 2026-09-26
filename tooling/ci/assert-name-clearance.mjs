#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-name-clearance.mjs — every declared app name carries a CURRENT,
// NON-BLOCKED clearance record, and the record still describes this tree.
//
// [pipeline 10]D-5 store listing metadata is generated from the spec and lives
// in the repo — a name is the first field of every listing this factory emits,
// and `tooling/app-yaml/render.mjs:252` (`'title.txt': doc.name`) makes ONE
// `name:` feed every channel's title, catalog/apps.json and the site feed.
// [pipeline 10]D-3 one `app_id` derives every store identity — a rename that
// updates four of five identity files is exactly the defect that rule exists to
// catch, so this guard re-reads the identities through
// `tooling/ci/read-identity.mjs` and compares them against the record.
//
// 🔴 THIS GUARD NEVER TOUCHES THE NETWORK. The measurement that settles the
// split, MEASURED ON THIS MACHINE 2026-09-09, wall clock including node start:
// the probe that WRITES the record — `tooling/store/name-clearance.mjs` — takes
// 15,365 ms / 13,726 ms over ~20 external calls (two samples, warm), and this
// guard takes 297 / 285 / 269 ms reading JSON (three samples, warm). Fourteen
// seconds on
// every commit gets bypassed inside a week, and a guard that is skipped is worth
// less than no guard because it also carries the belief that something was
// checked. So the slow part is a tool you run and the fast offline part is the
// thing that blocks the build — which is also why this one can live in CI, where
// `assert-platform-state` cannot: its subject is `apps/<app>/` and
// `contracts/`, both of which a runner clones.
//
// ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
//   1  no record for a declared app
//   2  a record whose `name.value` is not the name `app.yaml` declares
//   3  a record whose red controls FAILED — it is not evidence, whatever it says
//   4  a record whose channel set is not the register's channel set
//   5  a SELF-COLLISION-free catalogue check: a DIFFERENT app declaring this name
//   6  a PROVEN-TAKEN on a channel that refuses duplicates AND IS ARMED
//   7  `trademark.ruling: null` past its dated, bounded owner gate, or with an
//      `ownerItem` outside the owner-id grammar; a ruling outside null /
//      PROCEED / DO-NOT-PROCEED; a PROCEED or DO-NOT-PROCEED with no `ruledBy`,
//      no dated `ruledOn` or no `basis`
//   8  an identifier in the record that the tree no longer declares
//   9  (--execute) an `asOf` past the 30-day ceiling
//  10  (--for-submission=<channel id>) that channel's verdict is anything but
//      PROVEN-FREE, or HELD with a `storeRecordId`, `heldBy: "owner"` and a
//      dated `heldOn`; and limb 7's owner gate is a finding, not a print
//  11  a `_why` that is not exactly `whyLines(record)` from
//      tooling/store/name-clearance-why.mjs — the prose is generated from the
//      record's own fields, and a hand edit or a field changed without
//      regenerating is refused, naming the offline command that fixes it
//
// ── WHY --for-submission=<channel> IS A MODE AND NOT A LIMB OF THE BARE RUN ──
// The bare run (ci.yml) asks "is anything WRONG with the record"; UNDETERMINED
// is not wrong there — it is the honest answer for most stores, and limb 6 only
// ever grades a wall. A submit lane asks the other question: "may THIS name go
// to THIS store today". There UNDETERMINED is "could not check", which is never
// a pass, so the lane names its channel and only two answers get through: the
// probe proved the name free, or the owner reserved it in that store's console
// and recorded the store's id with `tooling/store/name-clearance.mjs --hold`.
// The trademark gate stops being a gate in this mode for the same reason the
// IAP screenshot guard's deferrals turn fatal under its own flag: a date in the
// future bounds a BUILD, and a submission under an unruled name is the harm the
// gate was only ever deferring. A bare flag, or a channel the register does not
// declare, is COVERAGE LOST (the precedent is assert-play-device-coverage.mjs).
//
// ── WHY (6) ASKS `channel-arming.mjs` RATHER THAN BLOCKING ON EVERY HIT ──────
// The property worth enforcing is "no build ships under a name a REACHABLE
// channel would refuse". `tooling/ci/channel-arming.mjs` is already the ONE
// reading of "does the register say this channel can reach a user today?"
// (`served: true`, or `submittable: true` with a real lane), and the three
// signing seams already turn on it. Reusing it makes this limb DERIVED: nothing
// can be typed into a list to silence it, and the day a lane lands for
// `ios-appstore` the same unchanged record turns this guard red. That is the
// opposite of a waiver — it is a finding with its own arming date, computed from
// the register on every run. Proven by mutation: flip the blocked channel's
// `served` in a fixture register and the exit goes 0 → 1.
//
// ── WHY (7) HAS A DATE ───────────────────────────────────────────────────────
// Software cannot clear a trademark, so `ruling: null` reads as QUALIFIED and
// never as a pass — it PRINTS AS FAILING on every run. What is bounded is the
// BLOCK, through the same owner-gated channel `assert-ops-register.mjs` uses for
// a duty whose first slot has not arrived: the verdict stays FAILING, the line
// prints every run, and only the block is lifted, and only while a NAMED owner
// item and a DATED `gatedUntil` both stand and that date is still in the future.
// The probe PRESERVES that block rather than rewriting it, so a re-run cannot
// extend its own gate — a waiver that can renew itself is a waiver that outlives
// its reason.
//
// ⏱ 2026-09-24 (apps-review F1, O-NAME-CLEARANCE-WAITS-ON-A-MISSING-ROW). The gate
// above held for fifteen days on an owner id whose row was never
// opened: this limb read `ownerItem` for PRESENCE and nothing read it for
// EXISTENCE. And any ruling other than null or DO-NOT-PROCEED fell through the
// limb as a pass, dated or not. So the limb now checks SHAPE — the ruling is one
// of three readable values, a non-null ruling carries `ruledBy`, a dated
// `ruledOn` and a `basis`, and a null one names an `ownerItem` in the owner-id
// grammar of `tooling/scripts/owner-ids.mjs`. Whether that id is a LIVE row is a
// question about the private corpus, which a runner cannot read, so it is asked
// by the ID CITATIONS class of `tooling/scripts/assert-public-citations.mjs`,
// in the hooks.
//
// ⏱ 2026-09-24, later (the PR 913 review, L1 and L2). "Grammar" above now reads
// SHAPE: `isOwnerId` is a non-empty string with no whitespace and a capital, and
// which register carries the id is a lookup the citations guard makes in both.
// The completeness test for a non-null ruling is `rulingOwed` in
// `tooling/scripts/name-ruling.mjs`, which `rollUp` in the probe calls too, so the
// probe can no longer roll a ruling up to CLEAR that this limb refuses.
//
// ── THE COVERAGE FLOOR ───────────────────────────────────────────────────────
// If no app had a record, a naive guard would pass over an empty set. The
// expected set is DERIVED — every app in `catalog/apps.json` — so a missing
// record is a FINDING against a named app rather than a silence. The floor
// underneath it catches the other case: a walk that graded nothing AND had
// nothing to say about why, which is the scan itself under-reaching.
//
// EXIT CODES:  0 = every declared name is cleared, or owner-gated and printed;
//                  under --for-submission=<channel>, also PROVEN-FREE or HELD there
//              1 = a finding
//              2 = COVERAGE LOST — the subject or the register was unreadable,
//                  so nothing was checked, and nothing is not a pass
//
// USAGE:  node tooling/ci/assert-name-clearance.mjs [--repo <path>] [--execute] [--for-submission=<channel id>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveIdentity } from './read-identity.mjs';
import { armingOf } from './channel-arming.mjs';
import { validate, assertSchemaUnderstood, isIsoDate } from '../app-yaml/schema-validate.mjs';
import { isOwnerId } from '../scripts/owner-ids.mjs';
import { rulingOwed } from '../scripts/name-ruling.mjs';
import { whyLines } from '../store/name-clearance-why.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flagValue = (n, d) => {
  const i = argv.indexOf(n);
  return i === -1 ? d : argv[i + 1];
};
const ROOT = resolve(flagValue('--repo', resolve(HERE, '..', '..')));
const EXECUTE = argv.includes('--execute');
// `=` and not a separate argv slot, as assert-play-device-coverage.mjs parses it:
// a bare `--for-submission` names no channel, and is refused below, not ignored.
const SUBMIT_ARG = argv.find((a) => a === '--for-submission' || a.startsWith('--for-submission='));
const FOR_SUBMISSION = SUBMIT_ARG !== undefined;
const SUBMITTING = FOR_SUBMISSION && SUBMIT_ARG.includes('=') ? SUBMIT_ARG.slice(SUBMIT_ARG.indexOf('=') + 1).trim() : null;

const REGISTER_REL = 'tooling/channel-register.json';
const CATALOG_REL = 'catalog/apps.json';
const SCHEMA_REL = 'contracts/name-clearance.schema.json';
const recordRel = (app) => `apps/${app}/name-clearance.json`;
const appYamlRel = (app) => `apps/${app}/app.yaml`;

/** 30 DAYS, and it is 30 for the reason `assert-platform-state.mjs` records for
 *  the same ceiling rather than a picked one: the observed re-derivation cadence
 *  of a clearance is days, so 30 is an order of magnitude of headroom — long
 *  enough that ordinary lag never speaks, short enough that nothing survives a
 *  quarter. The mechanism is not a second one: it is that file's, verbatim,
 *  including "age is a WARNING in the hook and a FINDING in --execute", which is
 *  there because every record shares a birthday and a hook that refuses every
 *  commit on the day the window closes is a hook this corpus has recorded itself
 *  skipping. */
const MAX_AGE_DAYS = 30;

/** ONE DAY OF LEGITIMATE SKEW, AND IT IS GEOGRAPHY RATHER THAN SLOP. The probe
 *  stamps the LOCAL date deliberately — `toISOString()` is UTC, this factory's
 *  machine sits at +05:30, and an evening run there would otherwise stamp
 *  YESTERDAY and give a day of the 30-day ceiling away before the record was
 *  even written. CI runs in UTC. So a record written at 02:51 IST reads as
 *  TOMORROW to a runner five and a half hours behind, and this limb refused a
 *  correct record on its first CI run for precisely that reason — measured, not
 *  guessed: local 2026-09-09 02:51 IST, UTC 2026-09-08 21:21. One day is the
 *  whole width of the effect for any writer east of UTC; beyond it, `asOf` is a
 *  clock no ceiling can be computed against and the finding stands. */
const CLOCK_SKEW_DAYS = 1;

const problems = [];
const notes = [];
const gated = [];
const submittable = [];

const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

const readJson = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return { missing: true };
  try {
    return { value: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (e) {
    return { bad: e.message };
  }
};

const today = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Limb 7's three readable states. The schema's enum says the same, and limb 7
 *  checks it anyway: a schema edit that widened the enum would otherwise let an
 *  unreadable ruling fall through this limb as a pass. */
const RULINGS = new Set([null, 'PROCEED', 'DO-NOT-PROCEED']);

/** The top-level `name:` of an app declaration. ANCHORED AT COLUMN ZERO on
 *  purpose: `name:` is a plausible key under `hosts:`, under a store block or
 *  under any future nesting, and a reader that took the first match would
 *  compare the clearance against somebody else's field and agree with itself —
 *  the same trap `readMsixIdentityName` records for `identity_name`. */
export function readDeclaredName(text) {
  const m = text.match(/^name:[ \t]*(\S.*?)[ \t]*$/m);
  if (!m) return { missing: true };
  return { value: m[1].replace(/^['"]|['"]$/g, '') };
}

const norm = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase();

// ── the register and the catalogue: the two things that define the subject ───
const register = readJson(REGISTER_REL);
if (register.missing || register.bad) {
  coverageLost([
    `${REGISTER_REL} is ${register.missing ? 'absent' : `unparseable (${register.bad})`}.`,
    'It is the channel set every record is measured against, so with it unreadable this guard could not tell a',
    'complete clearance from one written against half the channels.',
  ]);
}
const channels = register.value.channels;
if (!Array.isArray(channels) || channels.length === 0) {
  coverageLost([`${REGISTER_REL} holds no \`channels\` array.`, 'Judging a record against zero channels is the vacuous pass this guard exists to refuse.']);
}
const registerIds = new Set(channels.map((c) => c.id));
const rowById = new Map(channels.map((c) => [c.id, c]));
if (FOR_SUBMISSION && !registerIds.has(SUBMITTING)) {
  coverageLost([
    SUBMITTING
      ? `--for-submission names channel "${SUBMITTING}", which ${REGISTER_REL} does not declare.`
      : '--for-submission was given without a channel: pass --for-submission=<channel id>, e.g. --for-submission=android-play.',
    'The submission mode grades ONE channel, so it has to be told which; grading every channel would let one store\'s',
    `UNDETERMINED refuse an upload to another. Channels: ${[...registerIds].join(', ')}.`,
  ]);
}

const catalog = readJson(CATALOG_REL);
if (catalog.missing || catalog.bad || !Array.isArray(catalog.value)) {
  coverageLost([
    `${CATALOG_REL} is ${catalog.missing ? 'absent' : catalog.bad ? `unparseable (${catalog.bad})` : 'not an array'}.`,
    'It is where the EXPECTED set of apps comes from. Without it this guard would range over whatever records',
    'happen to exist, which passes over an empty set.',
  ]);
}
const expectedApps = catalog.value.map((a) => a.slug).filter((s) => typeof s === 'string' && s.length > 0);
if (expectedApps.length === 0) {
  coverageLost([`${CATALOG_REL} declares no app with a \`slug\`.`, 'The expected set is empty, so every record below would be checked against nothing.']);
}

const schema = readJson(SCHEMA_REL);
if (schema.missing || schema.bad) {
  coverageLost([
    `${SCHEMA_REL} is ${schema.missing ? 'absent' : `unparseable (${schema.bad})`}.`,
    'It is the shape every record is graded against; without it a malformed record would read as a clearance.',
  ]);
}
try {
  assertSchemaUnderstood(schema.value, SCHEMA_REL);
} catch (e) {
  coverageLost([`${SCHEMA_REL} uses a keyword this validator does not implement: ${e.message}`, 'An unimplemented keyword is a constraint the schema claims and nothing enforces.']);
}

const NOW = today();
let checked = 0;

for (const app of expectedApps) {
  const rel = recordRel(app);
  const rec = readJson(rel);
  if (rec.missing) {
    problems.push(
      `${app} — no ${rel}. \`${CATALOG_REL}\` declares this app and nothing has ever asked whether its name is ` +
        'available on the channels this factory releases to. Run: ' +
        `node tooling/store/name-clearance.mjs "<Name>" --app ${app} --execute`,
    );
    continue;
  }
  if (rec.bad) {
    coverageLost([`${rel} did not parse (${rec.bad}).`, 'A record that cannot be read has been checked by nobody, and nothing is not a pass.']);
  }
  const r = rec.value;

  const schemaProblems = validate(r, schema.value, rel);
  if (schemaProblems.length) {
    for (const p of schemaProblems) problems.push(`${rel} — ${p}`);
    continue;
  }
  checked += 1;

  // 1. the record belongs to this app
  if (r.app !== app) problems.push(`${rel} — declares \`app: "${r.app}"\` while sitting in apps/${app}/. A record filed under the wrong app is a clearance for somebody else's name.`);

  // 2. the record is for the name this app actually declares
  const yamlAbs = join(ROOT, appYamlRel(app));
  if (!existsSync(yamlAbs)) {
    coverageLost([`${appYamlRel(app)} is absent, so the name the record must match could not be read.`, 'A clearance compared against nothing agrees with itself.']);
  }
  const declared = readDeclaredName(readFileSync(yamlAbs, 'utf8'));
  if (declared.missing) {
    coverageLost([`${appYamlRel(app)} declares no top-level \`name:\`.`, 'There is nothing for the clearance to be a clearance OF, so this limb checked nothing.']);
  }
  if (norm(declared.value) !== norm(r.name.value)) {
    problems.push(
      `${rel} — clears the name "${r.name.value}" while ${appYamlRel(app)} declares "${declared.value}". ` +
        'render.mjs feeds ONE `name:` into every channel\'s title.txt, catalog/apps.json and the site feed, so a ' +
        'clearance for a different string is a clearance for nothing this factory would ship.',
    );
  }

  // 3. a record whose controls failed is not evidence
  if (r.controls.failed.length) {
    problems.push(
      `${rel} — ${r.controls.failed.length} red control(s) FAILED on the run that wrote it (${r.controls.failed.join(', ')}). ` +
        'A "no hit" from an endpoint that is down is indistinguishable from a "no hit" from an endpoint that is up, ' +
        'so every verdict in this record is worth less than it looks. Re-run the probe.',
    );
  }

  // 4. the record's channel set IS the register's channel set
  const recorded = new Set(Object.keys(r.channels));
  const missingChannels = [...registerIds].filter((id) => !recorded.has(id));
  const strangers = [...recorded].filter((id) => !registerIds.has(id));
  if (missingChannels.length || strangers.length) {
    coverageLost([
      `${rel} was written against a different channel set than ${REGISTER_REL} declares today.`,
      missingChannels.length ? `Never asked about: ${missingChannels.join(', ')} — a channel this factory can release to and this record is silent on.` : '',
      strangers.length ? `Recorded but not in the register: ${strangers.join(', ')}.` : '',
      'Re-run the probe: a clearance over a stale channel set under-reports by exactly the channels it never saw.',
    ].filter(Boolean));
  }

  // 5. SELF IS NOT A COLLISION — but a different app is
  const clash = catalog.value.filter((a) => norm(a.name) === norm(r.name.value) && norm(a.slug) !== norm(app));
  if (clash.length) {
    problems.push(
      `${rel} — a DIFFERENT app in ${CATALOG_REL} already declares this name: ${clash.map((a) => `${a.slug} ("${a.name}")`).join(', ')}. ` +
        'Two apps cannot share one name on the one namespace this factory owns.',
    );
  }

  // 6. a wall, weighed against whether the channel can reach a user today
  for (const [id, ch] of Object.entries(r.channels)) {
    if (ch.verdict !== 'PROVEN-TAKEN') continue;
    if (ch.uniqueness !== 'global' && id !== 'web') continue;
    const row = rowById.get(id);
    const arming = armingOf(row);
    const head = `${rel} — "${r.name.value}" is PROVEN-TAKEN on ${id}, which refuses duplicates. ${ch.why}`;
    if (arming.armed) {
      problems.push(`${head} That channel is ARMED (${arming.reasons.join('; ')}), so a build under this name would be refused by a channel that can reach a user today.`);
    } else {
      gated.push(
        `${head}\n      ⬜ NOT BLOCKING TODAY: ${id} is UNARMED — ${arming.blockers.join('; ')}. This becomes a build ` +
          'failure the moment that channel arms, and nothing has to be remembered for it to: the verdict is ' +
          `computed from ${REGISTER_REL} on every run.` +
          (ch.evidence?.length ? `\n      evidence: ${ch.evidence.join(' | ')}` : ''),
      );
    }
  }

  // 7. the trademark ruling — QUALIFIED, never a pass
  const tm = r.trademark;
  if (!RULINGS.has(tm.ruling)) {
    problems.push(
      `${rel} — \`trademark.ruling\` is ${JSON.stringify(tm.ruling)}, and a ruling is null, "PROCEED" or "DO-NOT-PROCEED". ` +
        'A ruling this guard cannot read is not a ruling, whatever the schema let through.',
    );
  } else if (tm.ruling !== null) {
    const owed = rulingOwed(tm);
    if (owed.length) {
      problems.push(
        `${rel} — \`trademark.ruling\` is ${tm.ruling} and lacks ${owed.join(', ')}. A ruling is a dated act by a named ` +
          'person on a stated basis; missing any of the three, nobody can check it, so it is not counted as one.',
      );
    }
    if (tm.ruling === 'DO-NOT-PROCEED') {
      problems.push(`${rel} — the owner RULED DO-NOT-PROCEED on this name (${tm.ruledBy ?? 'unattributed'}, ${tm.ruledOn ?? 'undated'}). Nothing ships under it.`);
    }
  } else {
    const signals = tm.signals?.length ?? 0;
    const line = `${rel} — QUALIFIED, NOT CLEAR: \`trademark.ruling\` is null with ${signals} advisory signal(s) recorded. Software cannot clear a trademark; an owner must rule, and the ruling carries a date.`;
    if (!tm.ownerItem) {
      problems.push(`${line} No \`trademark.ownerItem\` names the open item that owes it, so this is a finding nobody owns.`);
    } else if (!isOwnerId(tm.ownerItem)) {
      problems.push(
        `${line} Its \`trademark.ownerItem\` ${JSON.stringify(tm.ownerItem)} is not an owner id (a non-empty string with no ` +
          'whitespace and at least one upper-case letter, carried by a row of open.json or owner-queue.json), so nothing can look up who owes it.',
      );
    } else if (!tm.gatedUntil || daysBetween(NOW, tm.gatedUntil) <= 0) {
      problems.push(`${line} Its owner gate (${tm.ownerItem}) ${tm.gatedUntil ? `EXPIRED on ${tm.gatedUntil}` : 'carries no `gatedUntil` date'}, so the block is no longer lifted.`);
    } else if (FOR_SUBMISSION) {
      problems.push(
        `${line} Its owner gate (${tm.ownerItem}, until ${tm.gatedUntil}) bounds a BUILD, not a submission: under ` +
          `--for-submission=${SUBMITTING} an unruled name is the harm the gate was deferring, so it is fatal here.`,
      );
    } else {
      gated.push(`${line}\n      ⬜ FAILING, owner-gated until ${tm.gatedUntil} under ${tm.ownerItem} — ${daysBetween(NOW, tm.gatedUntil)} day(s) left, after which this blocks.`);
    }
  }

  // 8. the identifiers the record names are the identifiers the tree declares
  for (const entry of r.identifiers) {
    const row = rowById.get(entry.channel);
    const decl = row?.identity ?? null;
    if (!decl) {
      problems.push(`${rel} — records an identifier for channel "${entry.channel}", which declares no \`identity\` block in ${REGISTER_REL}. The record and the register disagree about where identity lives.`);
      continue;
    }
    const live = resolveIdentity(ROOT, app, decl);
    if (live.lost) {
      coverageLost([`${entry.channel}: ${live.lost}`, `The identity reader cannot see what it is meant to see, so ${rel}'s claim about it was compared against nothing.`]);
    }
    if (live.absent) continue; // the app does not carry this platform — the record says NOT-APPLICABLE
    const now = live.value ?? null;
    if (now !== (entry.value ?? null)) {
      problems.push(
        `${rel} — records ${entry.channel} identifier "${entry.value ?? '(none)'}" and ${entry.declaredIn ?? decl.declaredIn.replace('{app}', app)} now declares ` +
          `"${now ?? '(none)'}". [10]D-3: one app_id derives every store identity, and a rename that updates four of five ` +
          'files is exactly what that rule exists to catch. Re-run the probe against the tree as it stands.',
      );
    }
  }

  // 9. age — a warning in the hook, a finding in --execute
  const age = daysBetween(r.asOf, NOW);
  if (age > MAX_AGE_DAYS) {
    const line = `${rel} — the clearance is ${age} days old and the ceiling is ${MAX_AGE_DAYS}. A clearance is a measurement with a date; names get taken. Re-run: ${r.name.verify}`;
    if (EXECUTE) problems.push(line);
    else notes.push(`${line} (a WARNING here and a FINDING under --execute: every record shares a birthday, and a hook that refuses every commit on the day the window closes is a hook that gets skipped.)`);
  } else if (age < -CLOCK_SKEW_DAYS) {
    problems.push(
      `${rel} — \`asOf\` is ${r.asOf} and today is ${NOW}, ${-age} days ahead. More than a day is more than ` +
        'geography can explain, so this is a clock no staleness ceiling can be computed against.',
    );
  }

  // 10. --for-submission=<channel>: only a proven or an owner-held name passes.
  // Limb 4 has already refused a record whose channel set is not the register's,
  // and SUBMITTING was checked against the register above, so the entry exists.
  if (FOR_SUBMISSION) {
    const ch = r.channels[SUBMITTING];
    const holdCmd = `node tooling/store/name-clearance.mjs --hold ${SUBMITTING} --record <store record id> --app ${app}`;
    if (ch.verdict === 'PROVEN-FREE') {
      submittable.push(`${app} PROVEN-FREE`);
    } else if (ch.verdict === 'HELD') {
      // The schema requires all three on a HELD; checked here anyway, as limb 7
      // checks RULINGS, so a widened schema cannot turn an empty hold into a pass.
      const owed = [];
      if (typeof ch.storeRecordId !== 'string' || ch.storeRecordId.trim() === '') owed.push('a `storeRecordId`');
      if (ch.heldBy !== 'owner') owed.push('`heldBy: "owner"`');
      if (!isIsoDate(ch.heldOn)) owed.push('a dated `heldOn`');
      if (owed.length) {
        problems.push(
          `${rel} — --for-submission=${SUBMITTING}: ${SUBMITTING} is HELD and lacks ${owed.join(', ')}. A hold is the owner's word ` +
            `with the store's own record id and a date; missing any of them nobody can look it up, so it does not pass. Record it: ${holdCmd}`,
        );
      } else {
        submittable.push(`${app} HELD (store record ${ch.storeRecordId}, ${ch.heldOn})`);
      }
    } else {
      problems.push(
        `${rel} — --for-submission=${SUBMITTING}: "${r.name.value}" is ${ch.verdict} on ${SUBMITTING}, and a submission passes only on ` +
          `PROVEN-FREE, or on HELD with the store's record id.${ch.verdict === 'UNDETERMINED' ? ' UNDETERMINED is "could not check", never a pass.' : ''} ` +
          `Reserve the name in that store's console, then record the hold: ${holdCmd}`,
      );
    }
  }

  // 11. the prose is the record's fields, regenerated — never typed
  const want = whyLines(r);
  const have = Array.isArray(r._why) ? r._why : null;
  if (JSON.stringify(have) !== JSON.stringify(want)) {
    let at = 0;
    while (have && at < Math.max(have.length, want.length) && have[at] === want[at]) at += 1;
    problems.push(
      `${rel} — \`_why\` ${have ? `differs from whyLines() at line ${at}` : 'is absent'}: the lines are generated from this record's own fields ` +
        'by tooling/store/name-clearance-why.mjs, and a hand edit, or a field changed without regenerating, leaves them describing a ' +
        `state the record no longer has. Regenerate offline: node tooling/store/name-clearance.mjs --why --app ${app}`,
    );
  }
}

// ── THE COVERAGE FLOOR ──────────────────────────────────────────────────────
// A guard that checked fewer apps than the catalogue declares has not proved
// anything about the ones it skipped. Missing records are a FINDING above; this
// is the other case — the walk itself under-reaching.
// A MISSING record is a FINDING (it is named above, per app) and not a lost
// scan — the two must not be conflated, or the one-app case would report
// COVERAGE LOST for a defect it had correctly identified. This fires only when
// the walk graded nothing AND had nothing to say about why.
if (checked === 0 && problems.length === 0) {
  console.error(`✗ COVERAGE LOST — ${expectedApps.length} app(s) in ${CATALOG_REL} and NOT ONE readable clearance record was graded, with nothing to report about why.`);
  console.error('  Passing over an empty set is the vacuous green this floor exists to refuse.');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(2);
}

for (const n of notes) console.log(`⚠️  ${n}`);
for (const g of gated) console.log(`⬜ ${g}`);

if (problems.length) {
  console.error(`✗ ${problems.length} finding(s) over ${checked} clearance record(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log(
  `✔ ${checked} of ${expectedApps.length} declared app(s) carry a current clearance over all ${registerIds.size} register channel(s)` +
    `${gated.length ? `, ${gated.length} owner-gated finding(s) PRINTED and still owed` : ''}${notes.length ? `, ${notes.length} ageing warning(s)` : ''}` +
    `${FOR_SUBMISSION ? `; --for-submission=${SUBMITTING}: ${submittable.join(', ')}` : ''}.`,
);
