#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-retention-coverage.mjs — EVERY store the portfolio holds carries a
// declared retention rule. Not every store "with a rule".
//
// [pipeline O-17] The drafted acceptance read: "for every store WITH A RETENTION
// RULE, no row is older than that rule." A store with no rule is outside that
// domain — so the criterion EXCLUDED THE ONE STORE IT WAS WRITTEN ABOUT. The
// `nikatru-signups` KV holds an email address and a timestamp per signup,
// written with no `expirationTtl`, and it was invisible to its own requirement.
//
// So the domain is ENUMERATED FROM THE TREE, never from the register:
//
//   stores  =  { every D1 (database, table) reachable from a wrangler
//                `migrations_dir` and the CREATE TABLEs under it }
//           ∪  { every `kv_namespaces[].binding` in every live wrangler config }
//           ∪  _requiredCoverage — the external stores no tree walk can see
//
//   retention rows  ≡  stores          ← BOTH DIRECTIONS
//
// ⚠️ BOTH DIRECTIONS IS THE WHOLE POINT. Checking only "every store has a rule"
// makes DELETING A BINDING the way to make this guard pass: the store leaves the
// domain, the loop runs over a smaller set, and the output still says ok. That
// is exactly how `check-migrations.mjs` silently dropped from five files to four
// and reported PASS. A rule whose store is gone is therefore COVERAGE LOST, not
// a harmless stale line.
//
// ⚠️ THE PERIOD LIMB IS DELIBERATELY NOT ROW-DRIVEN. `events` and
// `consent_artifacts` hold ZERO rows, so any "no rows older than the period"
// query is VACUOUSLY GREEN today. That is a fact about traffic, not about
// retention. A zero is also the most common reading of a broken pipe. Coverage
// here is therefore a relationship over ENUMERATED STORES, and a query result is
// never allowed to stand in for it.
//
// FOUR RULES, and each costs something:
//   `keep`               requires a WRITTEN `keepWhy`. Without that, "we never
//                        got round to deleting it" and "we deliberately retain
//                        this" are the same word.
//   `period`             requires a positive `periodDays`.
//   `ttl`                requires the TTL to be IN THE CODE at the row's anchor,
//                        AND requires `mechanism.ttlSource` — the exact source
//                        text that sets THIS store's expiry — to appear verbatim
//                        there. One anchor can hold several puts under several
//                        rules (subscribe.js holds two), so "the file mentions
//                        expirationTtl" is a fact about the file, not the row.
//   `cache`             re-fetchable, holds no personal data.
//   `period-undeclared`  requires `ownerGated` + an `ownerGap`, and PRINTS on
//                        every run. Declaring a retention period is a POLICY
//                        decision — the published privacy policy says "as long
//                        as necessary", and an agent picking 180 or 365 days
//                        would be writing policy under the appearance of fixing
//                        a bug. So the gap is named and counted, not filled.
//
// (The per-row shape of every rule is validated by assert-ops-register.mjs; this
// guard owns the DOMAIN — which stores exist, and whether each one is covered.)
//
// Usage:  node tooling/ci/assert-retention-coverage.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/ops/register.json';

const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Live wrangler configs. `bricks/` is a mustache TEMPLATE, not a deployed
 *  surface — excluded by name, and the exclusion is REPORTED rather than
 *  silent, because a silent exclusion is how a domain shrinks unnoticed. */
export function findWranglerConfigs(root) {
  const found = [];
  const excluded = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = listDir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'build') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (/^wrangler\.(jsonc|json|toml)$/.test(e.name)) (r.includes('bricks/') ? excluded : found).push(r);
    }
  };
  walk(root, '');
  return { found: found.sort(), excluded: excluded.sort() };
}

/**
 * SQL is stripped of comments AND string literals before the CREATE TABLE scan.
 * A `-- CREATE TABLE …` in a header comment, or a table name inside a quoted
 * string, would otherwise enter the domain as a store that does not exist — the
 * same class as the grep that matched the comment explaining why there is no
 * r2_buckets.
 */
export function tablesIn(sql) {
  let s = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return [...s.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)].map((m) => m[1]);
}

/** The enumerated store set. Keys are the `store` values a register row must
 *  carry: `d1:<database>:<table>` and `kv:<worker>:<binding>`. */
export function enumerateStores(root) {
  const { found, excluded } = findWranglerConfigs(root);
  if (found.length === 0) {
    coverageLost([
      `no live wrangler config found under ${root} (${excluded.length} template config(s) excluded).`,
      'Every store in the domain derives from these files. An empty set makes the whole relationship',
      'vacuously true while this guard still prints ok — the exact shape it exists to refuse.',
    ]);
  }
  const stores = new Map();
  let d1Bindings = 0;
  for (const rel of found) {
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(join(root, rel), 'utf8'));
    } catch (e) {
      coverageLost([`${rel} could not be parsed (${e.message}), so its bindings are invisible to this scan.`]);
    }
    const worker = cfg?.name ?? rel;
    for (const kv of cfg?.kv_namespaces ?? []) {
      if (kv?.binding) stores.set(`kv:${worker}:${kv.binding}`, `${rel} → kv_namespaces`);
    }
    for (const db of cfg?.d1_databases ?? []) {
      d1Bindings++;
      // Only the config that OWNS the migrations enumerates the tables. A DB
      // bound read/write elsewhere for a fan-out is the same store, not a second
      // one — counting it twice would inflate coverage with duplicates.
      if (!db?.migrations_dir || !db?.database_name) continue;
      const migDir = join(root, dirname(rel), db.migrations_dir);
      if (!existsSync(migDir)) {
        coverageLost([
          `${rel} declares \`migrations_dir: ${db.migrations_dir}\` for ${db.database_name} and that directory does not exist.`,
          'Every table in that database would silently leave the domain.',
        ]);
      }
      const sqls = listDir(migDir).filter((f) => f.endsWith('.sql'));
      if (sqls.length === 0) {
        coverageLost([`${rel}'s migrations directory ${db.migrations_dir} contains no .sql file, so ${db.database_name} contributes no tables.`]);
      }
      for (const f of sqls) {
        for (const t of tablesIn(readFileSync(join(migDir, f), 'utf8'))) {
          stores.set(`d1:${db.database_name}:${t}`, `${rel} → ${db.migrations_dir}/${f}`);
        }
      }
    }
  }
  if (d1Bindings === 0) {
    coverageLost([`the ${found.length} live wrangler config(s) declare no D1 binding at all, so the D1 half of the domain is empty.`]);
  }
  return { stores, configs: found, excluded };
}

function main() {
  const registerPath = join(ROOT, REGISTER_REL);
  if (!existsSync(registerPath)) {
    coverageLost([`${REGISTER_REL} does not exist, so there are no retention rules to compare the enumerated stores against.`]);
  }
  let reg;
  try {
    reg = JSON.parse(readFileSync(registerPath, 'utf8'));
  } catch (e) {
    coverageLost([`${REGISTER_REL} could not be parsed (${e.message}).`]);
  }

  const rows = (reg.rows ?? []).filter((r) => r.kind === 'retention');
  if (rows.length === 0) {
    coverageLost([
      `${REGISTER_REL} declares no \`retention\` rows.`,
      'The comparison below would range over nothing and report every enumerated store as uncovered — or,',
      'read the other way round, would report perfect coverage of an empty rule set.',
    ]);
  }

  const { stores, configs, excluded } = enumerateStores(ROOT);

  // The external half: stores that exist in the account and that no tree walk
  // will ever reach. Taken from the register's own _requiredCoverage, filtered
  // to the retention ids, so the two lists cannot drift apart.
  const requiredIds = (reg._requiredCoverage?.ids ?? []).filter((id) => id.startsWith('retention.'));
  if (requiredIds.length === 0) {
    coverageLost([
      '`_requiredCoverage.ids` names no `retention.*` id.',
      'The external stores — the Pages KV holding signups, and the namespace no wrangler config binds — are',
      'exactly the ones a tree walk cannot see, and exactly the ones holding a contactable identity.',
    ]);
  }

  const byStore = new Map();
  const errors = [];
  const prints = [];
  for (const r of rows) {
    if (byStore.has(r.store)) errors.push(`two retention rows claim the same store \`${r.store}\` — one of them is never read.`);
    byStore.set(r.store, r);
  }

  // (i) every enumerated store has a rule
  for (const [store, whence] of stores) {
    if (!byStore.has(store)) {
      errors.push(
        `\`${store}\` (${whence}) has NO retention row. A store with no declared rule is precisely what the drafted ` +
          'acceptance excluded from its own domain, which is how the un-TTL\'d signup store became invisible to the requirement written about it.',
      );
    }
  }

  // (ii) THE OTHER DIRECTION: a rule whose store is gone
  for (const r of rows) {
    const isExternal = requiredIds.includes(r.id);
    if (!stores.has(r.store) && !isExternal) {
      coverageLost([
        `${r.id} declares a rule for \`${r.store}\`, which is not among the ${stores.size} store(s) enumerated from the tree.`,
        'Either a binding or a table was removed and this rule is now describing nothing, or this scan has stopped',
        'reaching part of the tree. Both make the domain smaller while every remaining check still prints ok —',
        'so the domain SHRINKING is a failure here, not a smaller amount of work.',
      ]);
    }
  }

  // (iii) the external half is present
  const ids = new Set(rows.map((r) => r.id));
  for (const id of requiredIds) {
    if (!ids.has(id)) errors.push(`_requiredCoverage names \`${id}\` and no retention row has that id.`);
  }

  // (iv) a `ttl` rule must be true IN THE CODE, not merely claimed
  //
  // 🔴 TWO ROWS SHARING ONE ANCHOR IS WHY `ttlSource` EXISTS, and it is not a
  // hypothetical: sites/nikatru/functions/api/subscribe.js writes TWO KV values
  // with two different retention rules — the rate-limit key and the signup
  // record — so `anchor contains "expirationTtl"` is satisfied for the signup
  // row by the RATE-LIMIT's TTL. Under that check alone the signup row's period
  // could be deleted from the code, or the register could claim 365 days while
  // the file wrote 30, and this guard would print ok. An assertion that cannot
  // fail is worse than none, because it inflates apparent coverage.
  //
  // So a `ttl` row names the LINE that makes its own claim true, and that string
  // must appear VERBATIM in the anchor. The register's number is then READ OFF
  // the code rather than asserted beside it.
  for (const r of rows) {
    if (r.rule !== 'ttl') continue;
    const anchor = r?.mechanism?.anchor;
    const ttlSource = r?.mechanism?.ttlSource;
    const p = anchor ? join(ROOT, anchor) : null;
    if (typeof ttlSource !== 'string' || ttlSource.trim() === '') {
      errors.push(
        `${r.id} — \`rule: ttl\` with no \`mechanism.ttlSource\`. Name the exact source text that sets THIS store's ` +
          'expiry: an anchor can hold several puts under several rules, so "the file mentions expirationTtl somewhere" ' +
          'is a fact about the file, not about this row.',
      );
      continue;
    }
    if (!p || !existsSync(p)) {
      errors.push(`${r.id} — \`rule: ttl\` whose anchor \`${anchor}\` does not exist, so the claim cannot be checked against anything.`);
      continue;
    }
    const src = readFileSync(p, 'utf8');
    if (!src.includes('expirationTtl')) {
      errors.push(
        `${r.id} — \`rule: ttl\` and \`${anchor}\` contains no \`expirationTtl\`. The rule is a claim about the code; ` +
          'reading the code is the only thing that makes it a rule rather than an intention.',
      );
    } else if (!src.includes(ttlSource)) {
      errors.push(
        `${r.id} — \`rule: ttl\` declares \`ttlSource: ${JSON.stringify(ttlSource)}\` and \`${anchor}\` does not contain that text. ` +
          'Either the code stopped setting this expiry, or it now sets a DIFFERENT one and this row is still asserting the ' +
          'old period — a register that states a retention period the code does not implement is the exact drift this limb exists to catch.',
      );
    }
  }

  for (const r of rows) {
    if (r.rule === 'period-undeclared') prints.push(`${r.id} — PERIOD UNDECLARED (owner): ${r.ownerGap ?? ''}`);
  }

  console.log(
    `⬜  ${stores.size} store(s) enumerated from ${configs.length} live wrangler config(s) ` +
      `(${excluded.length} brick template(s) excluded) + ${requiredIds.length} external`,
  );
  for (const p of prints) console.log(`⬜  ${p}`);

  if (errors.length) {
    console.error(`✗ retention coverage — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`    ${e}`);
    process.exit(1);
  }

  console.log(`ok  every enumerated store carries a declared retention rule — ${rows.length} rule(s) over ${stores.size} tree-derived + ${requiredIds.length} external store(s) [pipeline O-17]`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
