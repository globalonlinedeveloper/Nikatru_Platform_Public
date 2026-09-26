#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-prod-provenance.mjs — [pipeline B-17] THE GATE LIMB.
//
// ⚠️ READ THIS FIRST: THIS GUARD CANNOT SEE PRODUCTION, AND THAT IS NOT A
// SHORTCOMING TO BE FIXED HERE. B-17's falsifying observation is A ROW IN A
// DATABASE — outside the repository, behind a credential. ci.yml gates every
// push including from forks, so it holds no CLOUDFLARE_API_TOKEN and never can.
// A guard that claims GATE while its falsifier lives outside the repo is the
// defect this repository named on 2026-08-05, so this file asserts ONLY what is
// decidable from the tree:
//
//   1. COVERAGE — the table set is ENUMERATED from each database's migrations,
//      never listed. Zero tables enumerated is a broken parse, not a small
//      schema, and it fails. Limbs 2–7 and 9 run once PER DATABASE.
//   2. Every enumerated table has a provenance rule in tooling/prod-provenance
//      .json. THIS IS THE REGRESSION THE WHOLE FILE EXISTS FOR: a migration that
//      adds a table without adding a rule must be RED, because a rule set that
//      silently covers 4 of 9 tables reports "0 unattributable rows" over the
//      five it never looked at.
//   3. …and the other direction. A rule for a table no migration creates is a
//      rule nobody applies, and it inflates apparent coverage exactly like an
//      assertion that cannot fail.
//   4. Every rule's `marker` is a REAL COLUMN of that table (CREATE TABLE bodies
//      AND `ALTER TABLE … ADD COLUMN`, which is how `entitlements` got its whole
//      provider half). A rule naming a phantom column resolves nothing.
//   5. A table that HAS an `app_version` column MUST use `released-build`. This
//      is the anti-downgrade limb: without it, the strongest marker in the
//      schema could be swapped for a weaker one on the two tables that have it,
//      and every count would still print.
//   6. `migration-seed` requires the migrations to actually seed that column.
//      An empty seed set is the empty predicate — the precise defect that got
//      B-17's original acceptance criterion replaced.
//   7. Every rule carries a WRITTEN REASON, and every non-`released-build` rule
//      must say what it is standing in for. Seven of the nine tables have no
//      `app_version` column and never will; each of those exemptions has to
//      survive being read aloud.
//   8. THE MONITOR IS WIRED. This limb is what stops the pair degenerating into
//      a gate that quietly claims the monitor's job: the row query must be
//      invoked by a job in ops-watch.yml, and ops-watch.yml must still have no
//      `push`/`pull_request` trigger (the reason it is allowed to hold the
//      credential at all).
//   9. ⏱ 2026-09-25 · A TABLE WAITING FOR ITS MIGRATION IS WAITED FOR, 24 H AND
//      NO LONGER. The monitor keeps its pending-migration path, the ops-watch job
//      running it keeps whole git history, and deploy-workers keeps applying the
//      migrations before the deploy it records — each held by text, comments
//      stripped.
//  10. ⏱ 2026-09-26 · THE DATABASES ARE THE WORKERS' OWN
//      (O-PROVENANCE-WALKS-ONE-DATABASE). prod-provenance.json's `databases`
//      must name exactly the D1 databases tooling/platform-register.json's
//      Workers own — every TOP-LEVEL binding carrying `migrations_dir`, read by
//      tooling/ci/migration-tables.mjs `registeredD1Databases`, the reading the
//      monitor uses. A database with no entry is COVERAGE LOST (its tables
//      would have no rule and no reader); an entry no Worker owns, or one whose
//      `wrangler`/`migrationsDir` is not its owner's, is a finding. Until this
//      limb both halves read services/platform alone, and a table added to
//      subscriptiontracker_db was seen by neither. An `exempt` rule (no marker
//      any resolver reads) declares no marker and names every column.
//
// Every limb has a recorded failing case in tooling/ci/test/prod-provenance
// .test.mjs or tooling/ci/test/prod-provenance-databases.test.mjs, and limb 2
// has one against the REAL TREE: adding a CREATE TABLE to a real migration
// turns this red.
//
// LANE-BOUND: ops-watch.yml — this binding is the POINT of limb 8 rather than an oversight inside it, because ops-watch.yml is the ONLY workflow allowed to hold the credential the monitor needs.
// assert-release-lane-generic.mjs is right to stop a guard that
// names one workflow and reports ok for every other; that is how
// assert-seams-wired.mjs printed ok while build-platforms.yml shipped two
// artifact lanes with no crash sink. Here the single named workflow is not a
// release lane at all and appears in no row of tooling/channel-register.json:
// ops-watch.yml is THE ONE workflow permitted to hold CLOUDFLARE_API_TOKEN,
// precisely because it has no push/pull_request trigger. That is what makes it
// the only place the monitor half CAN run, so "the monitor is wired" is a
// question about that workflow and no other — deriving the name from the channel
// register would be deriving it from the wrong set.
//   The subject set that IS derived here is the TABLES (every CREATE TABLE in
// each registered database's migrations, floored by REQUIRED_COVERAGE), so a new table
// acquires the obligation automatically. What cannot be derived is the single
// credentialled workflow. If a second such workflow is ever added, this constant
// must be widened deliberately — and limb 8's no-push-trigger assertion is what
// makes that a considered act rather than a silent one. [pipeline 9]R-1 limb B.
//
// Usage:  node tooling/ci/assert-prod-provenance.mjs [repoRoot]
// Exit 0 = every table declares how its rows are attributed, and the reader that
//          can actually look is wired. 1 = it is not. 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { enumerateMigrationTables, registeredD1Databases, databaseLock, exemptionProblem, EXEMPT, PLATFORM_REGISTER_REL } from './migration-tables.mjs';
import { stripSourceComments } from './text-reductions.mjs';
import { parseWorkflow } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER_REL = 'tooling/prod-provenance.json';
const MONITOR_REL = 'tooling/ops/check-prod-provenance.mjs';
const OPS_WATCH_REL = '.github/workflows/ops-watch.yml';
/** ⚠️ THE CATALOGUE IS `catalog/apps.json`, NOT the channel register.
 *  The channel register has no `apps` key at all — assert-channel-register.mjs
 *  reads this same path into its own `apps` and compares the two. Pointing here
 *  is what keeps this guard and that one speaking about one portfolio. (The
 *  first draft of this limb read `channel-register.json.apps`, got an empty set,
 *  and limb 6b failed it as COVERAGE LOST rather than passing every row — which
 *  is the only reason the mistake was visible at all.) */
const CATALOGUE_REL = 'catalog/apps.json';

const appSlugs = new Set();
try {
  const cat = JSON.parse(readFileSync(join(ROOT, CATALOGUE_REL), 'utf8'));
  for (const a of Array.isArray(cat) ? cat : []) {
    if (typeof a?.slug === 'string' && a.slug.trim() !== '') appSlugs.add(a.slug.trim());
  }
} catch {
  // Left empty on purpose: limb 6b turns an empty catalogue into COVERAGE LOST
  // rather than into a silently permissive check.
}

/** The minimum a `reason` has to be before it counts as written down. A rule
 *  reading "n/a" is an exemption with no argument behind it. */
const MIN_REASON = 80;

const problems = [];

const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  // ⏱ 2026-09-16 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
};

// ── the register ────────────────────────────────────────────────────────────
const regPath = join(ROOT, REGISTER_REL);
if (!existsSync(regPath)) {
  coverageLost([
    `${REGISTER_REL} does not exist.`,
    'It is the left-hand side of every limb below — the declaration each table makes about how its rows',
    'are attributed. Absent, "every table has a rule" compares the schema against nothing and the',
    'monitor has no rules to apply, so BOTH limbs of B-17 go quiet at once.',
  ]);
}
let register;
try {
  register = JSON.parse(readFileSync(regPath, 'utf8'));
} catch (err) {
  coverageLost([`${REGISTER_REL} is not valid JSON (${err.message}), so no rule could be read.`]);
}

const resolvers = register.resolvers ?? {};
if (Object.keys(resolvers).length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no \`resolvers\`.`,
    'Every rule below names one. With the set empty, "the resolver is a declared one" is unfalsifiable',
    'and any string at all would pass as a rule — including one the monitor cannot execute.',
  ]);
}

// ── LIMB 10 · ⏱ 2026-09-26 · THE DATABASES ARE THE WORKERS' OWN ────────────
// Read, never listed: tooling/platform-register.json's Workers, each one's
// TOP-LEVEL D1 bindings carrying `migrations_dir` — the one reading the monitor
// uses (tooling/ci/migration-tables.mjs). `env.*` blocks are not production.
const registeredDbs = register.databases;
if (registeredDbs === null || typeof registeredDbs !== 'object' || Array.isArray(registeredDbs) || Object.keys(registeredDbs).length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no \`databases\`.`,
    'Every rule lives under `databases.<database_name>.tables`. Without that map no table has a rule, and',
    '"every table has a rule" would compare the schema against nothing.',
  ]);
}
const derived = registeredD1Databases(ROOT);
if (derived.problems.length) {
  coverageLost([`the D1 databases could not be derived from ${PLATFORM_REGISTER_REL} and its Workers' wrangler configs.`, ...derived.problems]);
}
const lock = databaseLock(derived.databases, registeredDbs);
if (lock.unregistered.length) {
  coverageLost([
    `${lock.unregistered.length} database(s) a Worker in ${PLATFORM_REGISTER_REL} owns have no entry in ${REGISTER_REL} \`databases\`: ${lock.unregistered.join(', ')}.`,
    'Every table in them would go without a rule, and the monitor would never enumerate them — the state',
    'O-PROVENANCE-WALKS-ONE-DATABASE was opened for.',
  ]);
}
for (const n of lock.stale) {
  problems.push(
    `${REGISTER_REL} declares \`databases.${n}\`, and no Worker in ${PLATFORM_REGISTER_REL} owns a database of that name ` +
      '(a top-level D1 binding carrying `migrations_dir`). Its rules are applied to nothing.',
  );
}
for (const m of lock.mismatched) problems.push(`${REGISTER_REL} \`databases.${m}\` — the register must name the files the owning Worker applies.`);

/** Per database, for the ok line: what was enumerated and which rules cover it. */
const walked = [];
for (const db of derived.databases) {
  const rules = registeredDbs[db.name]?.tables ?? {};
  const migrationsRel = db.migrationsDir;
  /** Every finding in this loop names its database. */
  const flag = (line) => problems.push(`${db.name}: ${line}`);

  // ── the domain, DERIVED ─────────────────────────────────────────────────────
  const migrationsDir = join(ROOT, migrationsRel);
  const { tables, filesRead, problems: parseProblems } = enumerateMigrationTables(migrationsDir);
  for (const p of parseProblems) flag(`${migrationsRel}/${p}`);

  if (filesRead === 0) {
    coverageLost([
      `not one .sql file was read under ${migrationsRel} (${db.name}).`,
      'The table set would be EMPTY, "every table has a rule" would be vacuously true, and this guard',
      'would print ok over a database it never opened.',
    ]);
  }
  if (tables.size === 0) {
    coverageLost([
      `${filesRead} migration file(s) were read under ${migrationsRel} and NOT ONE table was found in them.`,
      'The CREATE TABLE pattern stopped matching, so every limb below ranges over an empty set. A shared',
      'database with no tables is a broken parse, not a schema.',
    ]);
  }

  // ── LIMB 2 · every enumerated table has a rule ──────────────────────────────
  for (const [name, t] of tables) {
    if (Object.prototype.hasOwnProperty.call(rules, name)) continue;
    flag(
      `\`${name}\` is created by ${migrationsRel}/${t.createdIn} and has NO rule in ${REGISTER_REL}. ` +
        'Rows can land in it and nothing declares how they are attributed, so the monitor will not count ' +
        'them and will still print a clean total — the shape where a check silently stops checking. ' +
        `Declare a marker column and the reason it is the honest provenance for this table.`,
    );
  }

  // ── LIMB 3 · every rule names a table that exists ───────────────────────────
  for (const name of Object.keys(rules)) {
    if (tables.has(name)) continue;
    flag(
      `${REGISTER_REL} carries a rule for \`${name}\`, and no migration in ${migrationsRel} creates that table. ` +
        'A rule nobody applies inflates apparent coverage without checking anything. Either the table was ' +
        'dropped and the rule should go with it, or the name is misspelled and one real table is uncovered.',
    );
  }

  // ── LIMBS 4–7 · each rule is executable and argued for ──────────────────────
  for (const [name, rule] of Object.entries(rules)) {
    const t = tables.get(name);
    if (!t) continue; // already reported by limb 3

    const marker = rule?.marker;
    if (rule?.resolver === EXEMPT) {
      // ⏱ 2026-09-26 — no marker any resolver reads: the rule is an argument
      // about this exact column set (limb 10's register, migration-tables.mjs).
      const why = exemptionProblem(name, rule, t.columns);
      if (why) flag(why);
    } else if (typeof marker !== 'string' || marker.length === 0) {
      flag(`\`${name}\` declares no \`marker\`. There is no column to read, so its rows can never be resolved either way.`);
    } else if (!t.columns.has(marker)) {
      flag(
        `\`${name}\` declares marker \`${marker}\` and its schema has no such column (it has: ${[...t.columns].join(', ')}). ` +
          'The monitor would read undefined on every row — which resolves to "unattributable" for all of them, or to ' +
          'nothing at all, and neither is a measurement.',
      );
    }

    const resolverId = rule?.resolver;
    if (typeof resolverId !== 'string' || !Object.prototype.hasOwnProperty.call(resolvers, resolverId)) {
      flag(
        `\`${name}\` declares resolver ${JSON.stringify(resolverId)}, which ${REGISTER_REL} does not define. ` +
          `Declared resolvers: ${Object.keys(resolvers).join(', ')}. The monitor cannot execute a resolver it has never heard of.`,
      );
    }

    // ⏱ 2026-09-23 · the SECOND resolvers are held to the same rule. An `alsoResolves` id the register
    // does not declare was caught only at monitor runtime (a CouldNotLook in ops-watch, a day late and on a
    // different workflow); here it is caught on the push that introduces it.
    for (const alt of Array.isArray(rule?.alsoResolves) ? rule.alsoResolves : []) {
      if (typeof alt !== 'string' || !Object.prototype.hasOwnProperty.call(resolvers, alt)) {
        flag(
          `\`${name}\` lists ${JSON.stringify(alt)} in \`alsoResolves\`, which ${REGISTER_REL} does not define. ` +
            `Declared resolvers: ${Object.keys(resolvers).join(', ')}. The monitor would refuse to run the census over a ` +
            'second resolver it cannot execute.',
        );
      }
    }

    // LIMB 5 · anti-downgrade.
    if (t.columns.has('app_version') && resolverId !== 'released-build') {
      flag(
        `\`${name}\` HAS an \`app_version\` column and declares resolver ${JSON.stringify(resolverId)}. ` +
          'app_version is the strongest marker in this schema — it names the build that wrote the row — so a table ' +
          'that carries it may not be attributed by anything weaker. The per-table rules exist because seven tables ' +
          'genuinely lack this column, not as a menu for the two that have it.',
      );
    }

    // LIMB 6 · a seed resolver needs seeds.
    if (resolverId === 'migration-seed') {
      const seeded = typeof marker === 'string' ? t.seeds.get(marker) : undefined;
      if (!seeded || seeded.size === 0) {
        flag(
          `\`${name}\` declares resolver \`migration-seed\` on \`${marker}\`, and no INSERT in ${migrationsRel} seeds that column. ` +
            'The allowed set is EMPTY, so every row in the table is unattributable and the count is the table size — or, ' +
            'read the other way round, the predicate matches nothing, which is exactly the empty-predicate defect that got ' +
            "B-17's original acceptance criterion replaced.",
        );
      }
    }

    // LIMB 6b · a catalogue resolver needs a catalogue, and a marker that could
    // fail against it.
    //
    // 🔴 THIS LIMB EXISTS BECAUSE THE RESOLVER IT CHECKS WAS ALMOST WRITTEN AS AN
    // ASSERTION THAT CANNOT FAIL. `events_daily` is DERIVED — every row is
    // computed from `events` by the rollup — so the tempting rule is "its
    // provenance is inherited from its source table", which no row could ever
    // violate and which would inflate the covered-table count while checking
    // nothing. `app-catalogue` is falsifiable instead: an `app_id` naming an app
    // the factory does not ship is residue or a probe, and that is a real state
    // this repository has produced before (C-6's `c6-localprobe` rows).
    if (resolverId === 'app-catalogue') {
      if (typeof marker !== 'string' || marker.trim() === '') {
        flag(`\`${name}\` declares resolver \`app-catalogue\` with no \`marker\` column to resolve.`);
      } else if (!t.columns.has(marker)) {
        flag(
          `\`${name}\` declares resolver \`app-catalogue\` on \`${marker}\`, which is not a column of the table as the ` +
            'migrations create it. A marker the schema does not have resolves nothing and the monitor would count every row.',
        );
      } else if (appSlugs.size === 0) {
        flag(
          `\`${name}\` declares resolver \`app-catalogue\` and the app catalogue derived from ${CATALOGUE_REL} is EMPTY, ` +
            'so the allowed set matches nothing and every row would be unattributable. COVERAGE LOST — this is the ' +
            'empty-predicate defect, not a clean run.',
        );
      }
    }

    // LIMB 6c · ⏱ 2026-09-15 · [ADR 087]. `not-reserved-address` reads an EMAIL
    // column through a count-only projection; on any other column its buckets mean
    // nothing and every row would quietly resolve as "unreserved".
    if (resolverId === 'not-reserved-address' && marker !== 'email') {
      flag(
        `\`${name}\` declares resolver \`not-reserved-address\` on \`${marker}\`. That resolver asks whether an EMAIL ADDRESS is at a ` +
          'domain reserved for testing, so its marker must be the `email` column: on any other column every row reads ' +
          '"unreserved" and the count is an assertion that cannot fail.',
      );
    }

    // LIMB 7 · the written reason.
    const reason = rule?.reason;
    if (typeof reason !== 'string' || reason.trim().length < MIN_REASON) {
      flag(
        `\`${name}\` carries no written \`reason\` of substance (${MIN_REASON}+ characters required; found ` +
          `${typeof reason === 'string' ? reason.trim().length : 0}). Every rule is a claim about how this table's rows ` +
          'are attributed, and for the seven tables with no `app_version` it is also an exemption from the strongest ' +
          'marker available. An exemption with no argument behind it is a waiver.',
      );
    } else if (resolverId !== 'released-build' && typeof marker === 'string' && !/app_version/i.test(reason)) {
      flag(
        `\`${name}\` uses resolver \`${resolverId}\` instead of \`released-build\` and its reason never mentions \`app_version\`. ` +
          'The reason for a non-`released-build` rule has to say what it is standing in for and why that column is absent — ' +
          'otherwise the next person reading it cannot tell a considered substitution from an oversight.',
      );
    }
  }
  walked.push({ db, tables: tables.size, filesRead, rules });
}

// ── LIMB 8 · THE MONITOR IS WIRED ───────────────────────────────────────────
// Without this limb the pair degenerates the way B-17's first draft did: a
// green push gate, no reader, and a production row nobody has ever counted.
if (!existsSync(join(ROOT, MONITOR_REL))) {
  problems.push(
    `${MONITOR_REL} does not exist. This guard is the GATE limb and cannot see a single row; the monitor is the ` +
      'only limb that can. Without it B-17 has no limb that touches its own subject.',
  );
}

const opsWatch = parseWorkflow(ROOT, OPS_WATCH_REL);
if (opsWatch === null) {
  problems.push(
    `${OPS_WATCH_REL} does not exist, so the monitor has no scheduled home. A reader nobody runs is a reader that ` +
      'does not exist, and this repository has the receipts.',
  );
} else {
  const invokingJobs = [...opsWatch.jobs.values()].filter((j) =>
    j.logical.some((l) => (l.text ?? l).includes(MONITOR_REL)),
  );
  if (invokingJobs.length === 0) {
    problems.push(
      `no job in ${OPS_WATCH_REL} runs ${MONITOR_REL}. The row count is the ONLY limb of B-17 that can observe its own ` +
        'falsifier, and it is unwired — so this gate would be green while production carried rows nothing had ever read. ' +
        'That is the exact state B-17 was written against.',
    );
  }

  // The whole reason a credential is allowed here: no push trigger, so no fork
  // PR can ever reach the token. If that changes, the monitor must move — and
  // this guard must be the thing that says so.
  const header = opsWatch.lines.slice(0, opsWatch.jobsAt ?? opsWatch.lines.length);
  const triggers = header.filter((l) => /^ {2}(push|pull_request|pull_request_target):/.test(l.text));
  if (triggers.length) {
    problems.push(
      `${OPS_WATCH_REL} has acquired a ${triggers.map((l) => l.text.trim().replace(':', '')).join('/')} trigger ` +
        `(line ${triggers.map((l) => l.n).join(', ')}). It holds CLOUDFLARE_API_TOKEN, and it is allowed to only because ` +
        'no untrusted push can start it. Either revert the trigger or move the monitor.',
    );
  }
}

// ── LIMB 9 · ⏱ 2026-09-25 · A TABLE ITS MIGRATION HAS NOT REACHED IS WAITED FOR — 24 H, NOT LONGER ──
// On 2026-09-25 #930 merged 0017, deploy-workers #186 was refused (CI #3828 was
// red over ops-watch #484), and ops-watch #485 read `ext_devices` from a
// production that did not have it yet: a D1 400, so COULD NOT LOOK, so red —
// over a deploy that simply had not happened. The monitor now takes such a
// table as zero rows and says so, until 24 h after the merge. That rests on
// three things in three files, and this limb holds each by text, comments
// stripped, so a comment describing one never stands in for it:
//   (a) the monitor still HAS the pending path: the 24 h limit, the ⬜ line,
//       the sqlite_master read and the shallow-clone refusal;
//   (b) the job that runs it checks out whole history (`fetch-depth: 0`) —
//       the merge time is read from git, and a shallow clone has none;
//   (c) deploy-workers applies the migrations BEFORE the deploy and records the
//       Deployment only after it, into the environment the monitor reads — the
//       premise under "a Deployment at a commit containing M means the applier
//       has run M", which is what turns a pending table red before 24 h.
const PENDING_TOKENS = [
  [/\bPENDING_LIMIT_HOURS\s*=\s*24\b/, 'the 24 h limit (`PENDING_LIMIT_HOURS = 24`)'],
  [/not yet migrated: /, 'the `⬜ not yet migrated:` line'],
  [/sqlite_master/, 'the schema read (`sqlite_master`)'],
  // the ARGV, not the flag's name: the refusal's own error text spells the flag too
  [/\[\s*'rev-parse'\s*,\s*'--is-shallow-repository'\s*\]/, "the shallow-clone refusal (`git(dir, ['rev-parse', '--is-shallow-repository'])`)"],
];
if (existsSync(join(ROOT, MONITOR_REL))) {
  const code = stripSourceComments(readFileSync(join(ROOT, MONITOR_REL), 'utf8'), '.mjs');
  const lost = PENDING_TOKENS.filter(([re]) => !re.test(code)).map(([, what]) => what);
  if (lost.length) {
    problems.push(
      `${MONITOR_REL} has lost its pending-migration path — missing outside a comment: ${lost.join('; ')}. Without it a ` +
        'table whose migration has not deployed yet is a failed read again, and a migration that never deploys is ' +
        'never named: the 2026-09-25 freeze (ops-watch #485 over `ext_devices` before 0017 applied).',
    );
  }
}
if (opsWatch !== null) {
  for (const j of [...opsWatch.jobs.values()].filter((x) => x.logical.some((l) => (l.text ?? l).includes(MONITOR_REL)))) {
    if (!j.lines.some((l) => /^\s*fetch-depth:\s*0\s*$/.test(l.text))) {
      problems.push(
        `${OPS_WATCH_REL} job \`${j.name}\` runs ${MONITOR_REL} from a shallow checkout (no \`fetch-depth: 0\`). The monitor ` +
          'reads when a pending migration merged from git history; a shallow clone has none, so it refuses (exit 2) on the ' +
          'first day a migration waits for its deploy.',
      );
    }
  }
}
const DEPLOY_WORKERS_REL = '.github/workflows/deploy-workers.yml';
const CHANNELS_REL = 'tooling/channel-register.json';
const deployWorkers = parseWorkflow(ROOT, DEPLOY_WORKERS_REL);
// ⏱ 2026-09-26 — once per walked database: its owner's applier job, in the
// directory of the wrangler file that owns it (limb 10).
for (const db of derived.databases) {
  /** Every finding in this loop names its database. */
  const flag = (line) => problems.push(`${db.name}: ${line}`);
  const workerDir = db.wrangler.split('/').slice(0, -1).join('/');
  if (!workerDir) {
    flag('no owning wrangler file, so the job that applies its migrations cannot be found.');
  } else if (deployWorkers === null) {
    flag(`${DEPLOY_WORKERS_REL} does not exist, so nothing applies ${db.migrationsDir} — and a pending migration would wait for an applier that is not there.`);
  } else {
    const esc = workerDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const appliers = [...deployWorkers.jobs.values()].filter(
      (j) => j.lines.some((l) => /\bd1 migrations apply\b.*--remote\b/.test(l.text)) && j.lines.some((l) => new RegExp(`^\\s*workingDirectory:\\s*${esc}\\s*$`).test(l.text)),
    );
    if (appliers.length !== 1) {
      flag(
        `${DEPLOY_WORKERS_REL} has ${appliers.length} job(s) that run \`d1 migrations apply … --remote\` in ${workerDir}; the ` +
          `monitor treats a ${db.worker} Deployment as proof the ONE applier ran, so there must be exactly one.`,
      );
    } else {
      const j = appliers[0];
      const at = (re) => j.lines.find((l) => re.test(l.text)) ?? null;
      const apply = at(/\bd1 migrations apply\b.*--remote\b/);
      const deploy = at(/^\s*id:\s*deploy\s*$/);
      const record = at(/record-deployment\.mjs\s/);
      const stepOf = (line) => {
        const starts = j.lines.filter((l) => /^ {6}- /.test(l.text)).map((l) => l.n);
        const from = Math.max(...starts.filter((n) => n <= line.n));
        const to = Math.min(...starts.filter((n) => n > line.n), Infinity);
        return j.lines.filter((l) => l.n >= from && l.n < to);
      };
      const where = `${DEPLOY_WORKERS_REL} job \`${j.name}\``;
      if (!deploy || !record) {
        flag(`${where} applies the migrations but has ${!deploy ? 'no `id: deploy` step' : 'no `record-deployment.mjs` step'}, so a ${db.worker} Deployment no longer proves the applier ran.`);
      } else if (!(apply.n < deploy.n && deploy.n < record.n)) {
        flag(
          `${where}: the migrations apply at line ${apply.n}, the deploy at ${deploy.n}, the Deployment is recorded at ${record.n}. ` +
            `Only apply → deploy → record makes a ${db.worker} Deployment proof that its migrations ran.`,
        );
      } else {
        // ⏱ 2026-09-25 [PD2B-3] The migration step may carry an `if:` only when every
        // `if:` line in it is byte-equal, trimmed, to the `id: deploy` step's one `if:`:
        // then both run on the one condition, and a failed migration still stops the deploy.
        const ifsOf = (line) => stepOf(line).filter((l) => /^\s*if:/.test(l.text)).map((l) => l.text.trim());
        const applyIfs = ifsOf(apply);
        const deployIfs = ifsOf(deploy);
        if (applyIfs.length && !(deployIfs.length === 1 && applyIfs.every((t) => t === deployIfs[0]))) {
          flag(
            `${where}: the migration step (line ${apply.n}) carries \`${applyIfs.join('` and `')}\` and the \`id: deploy\` step (line ${deploy.n}) carries ` +
              `${deployIfs.length ? `\`${deployIfs.join('` and `')}\`` : 'no `if:`'}. The migration may carry an \`if:\` only when it is byte-equal to the deploy's, or a deploy can happen without it running.`,
          );
        }
        if (!stepOf(record).some((l) => /^\s*if:.*steps\.deploy\.outcome\s*==\s*'success'/.test(l.text))) {
          flag(`${where}: the Deployment record (line ${record.n}) is not conditioned on \`steps.deploy.outcome == 'success'\`.`);
        }
        if (j.continueOnError !== null) {
          flag(`${where}: \`continue-on-error: true\` at line ${j.continueOnError.n} lets the deploy and its record run past a failed migration.`);
        }
        let envs = [];
        try {
          envs = (JSON.parse(readFileSync(join(ROOT, CHANNELS_REL), 'utf8')).serviceEnvironments ?? []).filter((s) => s?.source === workerDir).map((s) => s.deploymentEnvironment);
        } catch {
          // an unreadable register is reported below as "no environment", never skipped
        }
        const recorded = record.text.match(/record-deployment\.mjs\s+(\S+)/)?.[1];
        if (envs.length !== 1 || envs[0] !== recorded) {
          flag(
            `${where} records its Deployment into \`${recorded}\`, and ${CHANNELS_REL} gives ${workerDir} ` +
              `${envs.length === 1 ? `\`${envs[0]}\`` : `${envs.length} environment(s)`} — the monitor reads ${db.name}'s Deployment ledger from the latter.`,
          );
        }
      }
    }
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) with the production-provenance rules:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline B-17] Every artifact a live verification writes to production must be provably');
  console.error('  removed. The rule set is what makes "provably" mechanical instead of remembered.');
  process.exit(1);
}

for (const w of walked) {
  const byResolver = new Map();
  for (const [name, rule] of Object.entries(w.rules)) {
    if (!byResolver.has(rule.resolver)) byResolver.set(rule.resolver, []);
    byResolver.get(rule.resolver).push(name);
  }
  console.log(
    `ok  prod provenance — ${w.db.name}: ${w.tables} table(s) enumerated from ${w.db.migrationsDir} ` +
      `(${w.filesRead} migration file(s)), ${Object.keys(w.rules).length} rule(s), 0 uncovered`,
  );
  for (const [r, names] of [...byResolver].sort()) {
    console.log(`    ${r}: ${names.sort().join(', ')}`);
  }
}
console.log(`ok  prod provenance — ${walked.length} database(s), the set ${PLATFORM_REGISTER_REL}'s Workers own: ${walked.map((w) => w.db.name).join(', ')}`);
console.log(
  '⬜  THIS IS THE GATE LIMB AND IT HAS NOT LOOKED AT PRODUCTION. It holds no credential and ci.yml can never',
);
console.log(
  `    give it one. Whether any row FAILS its rule is answerable only by ${MONITOR_REL}, which runs daily in`,
);
console.log(
  `    ${OPS_WATCH_REL} — a MONITOR, a weaker rung: green there means "nothing has contradicted this since the`,
);
console.log('    last run", never "this holds". [pipeline B-17]');
