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
//   1. COVERAGE — the table set is ENUMERATED from services/platform/migrations,
//      never listed. Zero tables enumerated is a broken parse, not a small
//      schema, and it fails.
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
//
// Every limb has a recorded failing case in tooling/ci/test/prod-provenance
// .test.mjs, and limb 2 has one against the REAL TREE: adding a CREATE TABLE to
// a real migration turns this red.
//
// Usage:  node tooling/ci/assert-prod-provenance.mjs [repoRoot]
// Exit 0 = every table declares how its rows are attributed, and the reader that
//          can actually look is wired. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { enumerateMigrationTables } from './migration-tables.mjs';
import { parseWorkflow } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER_REL = 'tooling/prod-provenance.json';
const MONITOR_REL = 'tooling/ops/check-prod-provenance.mjs';
const OPS_WATCH_REL = '.github/workflows/ops-watch.yml';

/** The minimum a `reason` has to be before it counts as written down. A rule
 *  reading "n/a" is an exemption with no argument behind it. */
const MIN_REASON = 80;

const problems = [];

const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
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

const rules = register.tables ?? {};
const resolvers = register.resolvers ?? {};
if (Object.keys(resolvers).length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no \`resolvers\`.`,
    'Every rule below names one. With the set empty, "the resolver is a declared one" is unfalsifiable',
    'and any string at all would pass as a rule — including one the monitor cannot execute.',
  ]);
}

const migrationsRel = register.migrationsDir;
if (typeof migrationsRel !== 'string' || migrationsRel.length === 0) {
  coverageLost([
    `${REGISTER_REL} declares no \`migrationsDir\`.`,
    'The table set is DERIVED from that directory. Without it there is nothing to derive from, and a',
    'hardcoded list is exactly what this guard exists to prevent: B-17\'s prose named four shared tables',
    'while the migrations created nine.',
  ]);
}

// ── the domain, DERIVED ─────────────────────────────────────────────────────
const migrationsDir = join(ROOT, migrationsRel);
const { tables, filesRead, problems: parseProblems } = enumerateMigrationTables(migrationsDir);
for (const p of parseProblems) problems.push(`${migrationsRel}/${p}`);

if (filesRead === 0) {
  coverageLost([
    `not one .sql file was read under ${migrationsRel}.`,
    'The table set would be EMPTY, "every table has a rule" would be vacuously true, and this guard',
    'would print ok over a database it never opened.',
  ]);
}
if (tables.size === 0) {
  coverageLost([
    `${filesRead} migration file(s) were read and NOT ONE table was found in them.`,
    'The CREATE TABLE pattern stopped matching, so every limb below ranges over an empty set. A shared',
    'database with no tables is a broken parse, not a schema.',
  ]);
}

// ── LIMB 2 · every enumerated table has a rule ──────────────────────────────
for (const [name, t] of tables) {
  if (Object.prototype.hasOwnProperty.call(rules, name)) continue;
  problems.push(
    `\`${name}\` is created by ${migrationsRel}/${t.createdIn} and has NO rule in ${REGISTER_REL}. ` +
      'Rows can land in it and nothing declares how they are attributed, so the monitor will not count ' +
      'them and will still print a clean total — the shape where a check silently stops checking. ' +
      `Declare a marker column and the reason it is the honest provenance for this table.`,
  );
}

// ── LIMB 3 · every rule names a table that exists ───────────────────────────
for (const name of Object.keys(rules)) {
  if (tables.has(name)) continue;
  problems.push(
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
  if (typeof marker !== 'string' || marker.length === 0) {
    problems.push(`\`${name}\` declares no \`marker\`. There is no column to read, so its rows can never be resolved either way.`);
  } else if (!t.columns.has(marker)) {
    problems.push(
      `\`${name}\` declares marker \`${marker}\` and its schema has no such column (it has: ${[...t.columns].join(', ')}). ` +
        'The monitor would read undefined on every row — which resolves to "unattributable" for all of them, or to ' +
        'nothing at all, and neither is a measurement.',
    );
  }

  const resolverId = rule?.resolver;
  if (typeof resolverId !== 'string' || !Object.prototype.hasOwnProperty.call(resolvers, resolverId)) {
    problems.push(
      `\`${name}\` declares resolver ${JSON.stringify(resolverId)}, which ${REGISTER_REL} does not define. ` +
        `Declared resolvers: ${Object.keys(resolvers).join(', ')}. The monitor cannot execute a resolver it has never heard of.`,
    );
  }

  // LIMB 5 · anti-downgrade.
  if (t.columns.has('app_version') && resolverId !== 'released-build') {
    problems.push(
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
      problems.push(
        `\`${name}\` declares resolver \`migration-seed\` on \`${marker}\`, and no INSERT in ${migrationsRel} seeds that column. ` +
          'The allowed set is EMPTY, so every row in the table is unattributable and the count is the table size — or, ' +
          'read the other way round, the predicate matches nothing, which is exactly the empty-predicate defect that got ' +
          "B-17's original acceptance criterion replaced.",
      );
    }
  }

  // LIMB 7 · the written reason.
  const reason = rule?.reason;
  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON) {
    problems.push(
      `\`${name}\` carries no written \`reason\` of substance (${MIN_REASON}+ characters required; found ` +
        `${typeof reason === 'string' ? reason.trim().length : 0}). Every rule is a claim about how this table's rows ` +
        'are attributed, and for the seven tables with no `app_version` it is also an exemption from the strongest ' +
        'marker available. An exemption with no argument behind it is a waiver.',
    );
  } else if (resolverId !== 'released-build' && typeof marker === 'string' && !/app_version/i.test(reason)) {
    problems.push(
      `\`${name}\` uses resolver \`${resolverId}\` instead of \`released-build\` and its reason never mentions \`app_version\`. ` +
        'The reason for a non-`released-build` rule has to say what it is standing in for and why that column is absent — ' +
        'otherwise the next person reading it cannot tell a considered substitution from an oversight.',
    );
  }
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

// ── verdict ─────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) with the production-provenance rules:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline B-17] Every artifact a live verification writes to production must be provably');
  console.error('  removed. The rule set is what makes "provably" mechanical instead of remembered.');
  process.exit(1);
}

const byResolver = new Map();
for (const [name, rule] of Object.entries(rules)) {
  if (!byResolver.has(rule.resolver)) byResolver.set(rule.resolver, []);
  byResolver.get(rule.resolver).push(name);
}
console.log(
  `ok  prod provenance — ${tables.size} table(s) enumerated from ${migrationsRel} ` +
    `(${filesRead} migration file(s)), ${Object.keys(rules).length} rule(s), 0 uncovered`,
);
for (const [r, names] of [...byResolver].sort()) {
  console.log(`    ${r}: ${names.sort().join(', ')}`);
}
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
