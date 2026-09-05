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
//   `period`             requires a positive `periodDays` AND — limb (v) — that
//                        it equal the number declared in
//                        tooling/legal/data-inventory.json, which is its HOME.
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
// 🔴 ONE NUMBER, ONE HOME (added 2026-08-13). `rule: period` above required only
// "a positive `periodDays`" — a property of the register ALONE. The same number
// also lives in tooling/legal/data-inventory.json, which is what the privacy
// notice is generated from, and in the constants in
// services/platform/src/scheduled.ts, which is what actually deletes rows. Three
// homes, zero cross-checks between the first two: changing one left the others
// printing the old figure while every guard stayed green. tooling/ops/register.json
// :1915 and :1941 BOTH already said "Stage 8 owns the PERIOD; stage 14 owns the
// job" — and then carried the period anyway, which is a comment describing an
// intention rather than a rule anything enforced.
//
// The decision (2026-08-13) makes that comment true:
//   · tooling/legal/data-inventory.json  = THE HOME. [8]K-8's own wording names
//                                          "purpose, retention, legal basis,
//                                          processor", and the notice is
//                                          generated from this file.
//   · tooling/ops/register.json          = the rule KIND and the `deletingJob`.
//                                          Its `periodDays` is a DERIVED COPY and
//                                          limb (v) below is what makes "derived"
//                                          mean something.
//
// Limb (v) is deliberately BOTH DIRECTIONS, for the same reason limb (ii) is:
// checking only "the inventory's number appears in the register" makes DELETING
// the inventory row the way to pass. And a data-inventory row that declares a
// period whose id this guard cannot JOIN to a register store is a FAILURE, not a
// skip — a silent skip is exactly how a domain shrinks unnoticed.
//
// ⚠️ THE THIRD HOME IS NOT THIS GUARD'S — services/platform/src/scheduled.ts is
// paired with the register by services/platform/test/retention-sweep.test.ts,
// which is where it belongs: that pairing needs the compiled constants, and this
// guard reads files. The chain is therefore
//   data-inventory.json  ≡  register.json   ← limb (v), here
//   register.json        ≡  scheduled.ts    ← retention-sweep.test.ts
// and equality composes, so all three agree.
//
// 📌 ~~"Its `EVENTS_DAILY_RETENTION_DAYS` is read into the `shipped` map and then
// never asserted, so the code's 1100 can drift from both registers with nothing
// red."~~ — TRUE WHEN WRITTEN, FIXED THE SAME DAY (2026-08-13). It was MEASURED,
// not inferred: setting that constant to 37 while both registers said 1100 left
// 40 tests passing and every retention guard green. The cause was that the test's
// `stores` array — not its `shipped` map — is what the assertions range over, so
// a value that was read, used and type-checked was never actually compared. The
// array now names all three stores, and the same mutation is caught.
//
// Usage:  node tooling/ci/assert-retention-coverage.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/ops/register.json';
const INVENTORY_REL = 'tooling/legal/data-inventory.json';

/** A three-line sample carrying a comment in EVERY style text-reductions.mjs knows
 *  (`//` C-family, `--` SQL, `#` hash). If `stripSourceComments` hands it back
 *  unchanged, the extension is one the module does not know and the "read as code"
 *  guarantee of the `ttl` limb below is not in force. Measured 2026-08-21:
 *  .js .ts .sql .jsonc .yaml .dart all REDUCE it; .md, .py and "" do not. */
const REDUCTION_PROBE = 'x // c\nx -- c\nx # c\n';

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

/**
 * The 1-based line where `field` is declared inside the JSON object whose
 * `"<id>"` line comes first. A disagreement between two files is only actionable
 * if it names WHERE in each — "the register says 730" sends a reader to a
 * 2,400-line file. Best-effort by construction: `null` degrades the citation to
 * a bare filename rather than failing, because a missing line number must never
 * be the reason a real disagreement goes unreported.
 */
export function lineOfField(text, id, field, window = 80) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes(`"${id}"`));
  if (start < 0) return null;
  for (let i = start; i < Math.min(lines.length, start + window); i++) {
    if (lines[i].includes(`"${field}"`)) return i + 1;
  }
  return null;
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
  /** bucket_name -> the enumerated store key for the binding pointing at it. */
  const bucketKeys = new Map();
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
    // 🔴 R2 WAS OUTSIDE THIS DOMAIN UNTIL 2026-09-05, AND THE DAY IT MATTERED IT
    // SAID SO. The nightly D1/KV export bound the first bucket any Worker in this
    // repo has ever held, `nikatru-backups`, and that bucket holds a copy of every
    // personal-data store in tooling/legal/data-inventory.json. Its 30-day period
    // was declared in the inventory and this guard REFUSED it — "no rule for
    // joining that id shape" — rather than skipping it, which is why the gap was
    // one message rather than a silent hole. A bucket is a place data goes; two
    // lines is what it cost to make it a place a rule has to exist for.
    for (const r2 of cfg?.r2_buckets ?? []) {
      if (!r2?.binding) continue;
      const key = `r2:${worker}:${r2.binding}`;
      stores.set(key, `${rel} → r2_buckets`);
      // tooling/legal/data-inventory.json ids a bucket by its NAME (that is what
      // assert-data-inventory derives) while this domain keys it by its BINDING.
      // Recording the pair HERE, in the walk, is what lets the period cross-check
      // join the two without a second list to keep in step.
      if (r2.bucket_name) bucketKeys.set(r2.bucket_name, key);
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
  return { stores, bucketKeys, configs: found, excluded };
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

  const { stores, bucketKeys, configs, excluded } = enumerateStores(ROOT);

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
    // 🔴 THE ANCHOR IS READ AS CODE, NOT AS TEXT (added 2026-08-21). Both limbs
    // below ask `src.includes(...)`, and `src` was the RAW file — so a comment that
    // merely DISCUSSED the TTL satisfied a rule whose own failure text below says
    // "reading the code is the only thing that makes it a rule rather than an intention".
    //
    // THIS WAS LATENT, NOT LIVE. Re-measured 2026-08-21 through `stripSourceComments`
    // in sites/nikatru/functions/api/subscribe.js — the anchor BOTH `ttl` rows share:
    // `expirationTtl` appears at lines 204, 231, 315 in COMMENTS and at 245, 301 in
    // CODE, and both `ttlSource` strings (`expirationTtl: RATE_WINDOW_SECONDS` at 301,
    // `const SIGNUP_RETENTION_DAYS = 400;` at 225) are code. Nothing was passing on
    // prose today and the guard's exit code is unchanged by this edit. What changes is
    // that the limb can now FAIL for the right reason — proven by fixture, not assumed:
    // an anchor whose only `expirationTtl` sits in a line comment, or in a block
    // comment, or whose `ttlSource` sits in a comment while a SIBLING row's real put
    // supplies `expirationTtl`, each passed before and each is reported now. That third
    // shape is the two-rows-one-anchor case named above, reopened one level down at the
    // `ttlSource` check. Held by tooling/ci/test/retention-coverage.test.mjs.
    //
    // 📌 THE REDUCTION IS `stripSourceComments` FROM tooling/ci/text-reductions.mjs —
    // the ONE implementation 37 of the 144 files directly under tooling/ci import
    // (measured 2026-08-21; 39 import something from it, 2 of those take only the HTML
    // reductions). ⚠️ A LINE-BASED `grep -l "import.*stripSourceComments"` ANSWERS 35, NOT 37,
    // because two of the import blocks span lines — that wrong number stood in this very
    // comment for an hour. Count by parsing the brace group, and use `:(glob)tooling/ci/*.mjs`:
    // a bare `tooling/ci/*.mjs` pathspec crosses `/` and sweeps test/ in as well. ~~An earlier draft of this paragraph
    // named a SECOND stripper module instead~~ — one written and then deleted on
    // 2026-08-21, because it duplicated a reduction this repository already had. The
    // name is corrected rather than left dangling at a file that does not exist, and
    // it is not repeated here: a dead module named in prose is the drift this whole
    // pass exists to remove.
    //
    // WHAT THIS DOES NOT CATCH, and must not be described as caught:
    //   · String literals pass through VERBATIM (`stripSourceComments` blanks comments
    //     only — `stripStringLiterals` is the separate, composable tool, deliberately
    //     NOT composed here because other guards match on string contents). So a log
    //     line or an error message containing `expirationTtl` satisfies the FIRST limb —
    //     and, if it spells the declared `ttlSource` out, the SECOND one too. MEASURED
    //     2026-08-21, not reasoned about: an anchor whose only occurrence of both is
    //     `console.log("expirationTtl: 600")` exits 0 here. ~~An earlier draft of this
    //     bullet scoped the hole to "the first limb"~~ — that understated it, and the
    //     second limb is the one that makes the check row-specific at all (see the
    //     `ttlSource` note above). subscribe.js holds no such literal today: the
    //     stripped matches are 245 and 301 only, both code. Pinned by the fixture
    //     named KNOWN GAP in tooling/ci/test/retention-coverage.test.mjs.
    //
    // Comment spans are blanked to spaces with newlines kept, so the string stays the
    // same length and any line number derived from it still points where it did —
    // measured on this anchor today: 17734 characters in, 17734 out.
    //
    // 🔴 AND THE REDUCTION MUST ACTUALLY REDUCE. `stripSourceComments` dispatches on
    // EXTENSION and returns an UNKNOWN one VERBATIM, saying nothing — text-reductions.mjs's
    // own header records that trap costing `.kts` a whole scan before the map learned it.
    // An anchor's extension is REGISTER DATA, not something this file reads off the tree:
    // both are `.js` today, and a future row anchored at a `.py`, a `.md` or an
    // extensionless file would silently revert this limb to the raw-read semantics the
    // paragraph above exists to end. So it is asserted, the way assert-no-do-alarms.mjs:226
    // and assert-android-target-sdk.mjs:322 assert it, rather than assumed. It is asserted
    // on a PROBE rather than on the anchor's own before/after, because an anchor is allowed
    // to contain no comments at all — comparing the real read to its input would then call
    // a perfectly good `.js` file unreduced. The probe carries a comment in every style the
    // module knows, so only the extension can decide the answer.
    const ext = extname(anchor).toLowerCase();
    if (stripSourceComments(REDUCTION_PROBE, ext) === REDUCTION_PROBE) {
      errors.push(
        `${r.id} — \`rule: ttl\` anchored at \`${anchor}\`, whose extension \`${ext}\` is one text-reductions.mjs does ` +
          'not know: it returns an unknown extension VERBATIM and says nothing, so the two limbs below would read ' +
          'this file\'s COMMENTS as code and a rule could be satisfied by prose about it. Teach COMMENT_STYLES the ' +
          'extension or move the anchor — a reduction that silently did not happen reads exactly like one that did.',
      );
      continue;
    }
    const src = stripSourceComments(readFileSync(p, 'utf8'), ext);
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

  // ── (v) ONE NUMBER, ONE HOME ────────────────────────────────────────────────
  // tooling/legal/data-inventory.json DECLARES the period (the privacy notice is
  // generated from it); the register's `periodDays` is a DERIVED COPY. Before
  // this limb, `rule: period` required only "a positive periodDays" — a property
  // of the register alone — so changing one file left the other printing the old
  // figure with every guard green.
  const inventoryPath = join(ROOT, INVENTORY_REL);
  if (!existsSync(inventoryPath)) {
    coverageLost([
      `${INVENTORY_REL} does not exist.`,
      'It is the HOME of every retention period. Without it the register\'s `periodDays` is a number with nothing to',
      'agree with, and this limb would pass by having nothing to compare. A missing home is not a smaller check.',
    ]);
  }
  const inventoryRaw = readFileSync(inventoryPath, 'utf8');
  let inventory;
  try {
    inventory = JSON.parse(inventoryRaw);
  } catch (e) {
    coverageLost([`${INVENTORY_REL} could not be parsed (${e.message}), so no declared period has a home to be checked against.`]);
  }
  const registerRaw = readFileSync(registerPath, 'utf8');
  const cite = (file, raw, id, field) => {
    const n = lineOfField(raw, id, field);
    return `${file}${n ? `:${n}` : ''}`;
  };

  /** inventory id → the register `store` key it names. Anything with no rule is
   *  an ERROR rather than a skip: a skipped row is an unchecked number that reads
   *  exactly like a checked one.
   *
   *  `table:<db>.<table>` was the only shape until 2026-09-05, when the nightly
   *  export gave this repository its first R2 bucket with a declared period. The
   *  bucket's inventory id is `r2:<bucket_name>` (assert-data-inventory derives it
   *  from `bucket_name`) while the enumerated store key is `r2:<worker>:<binding>`
   *  (derived from the BINDING, like every kv key here) — so the join cannot be a
   *  rename and has to be a lookup. `r2Keys` is built from the same walk the
   *  domain comes from, which is what stops it becoming a second hand-kept list. */
  const storeKeyFor = (id) => {
    const s = typeof id === 'string' ? id : '';
    const table = /^table:([^.]+)\.(.+)$/.exec(s);
    if (table) return `d1:${table[1]}:${table[2]}`;
    const bucket = /^r2:(.+)$/.exec(s);
    // The inventory names the BUCKET; the enumerated key names the BINDING that
    // points at it. `bucketKeys` is built by the same walk the domain comes from,
    // so it cannot become a second hand-kept list that agrees until it does not.
    if (bucket) return bucketKeys.get(bucket[1]) ?? null;
    return null;
  };

  const invPeriods = new Map();
  for (const s of inventory.stores ?? []) {
    const days = s?.retention?.periodDays;
    if (typeof days !== 'number') continue;
    const key = storeKeyFor(s.id);
    if (!key) {
      errors.push(
        `${INVENTORY_REL} → \`${s.id}\` declares \`periodDays: ${days}\` and this guard has no rule for joining that id shape ` +
          'to a register `store`, so that number is cross-checked against NOTHING while every other one is. Teach the join or ' +
          'move the row — an unjoined period must not pass as a covered one.',
      );
      continue;
    }
    invPeriods.set(key, { id: s.id, days });
  }

  // The floor is taken on the HOME, not on the pairs: a floor over pairs could be
  // satisfied to zero by deleting register rows, and would then fire INSTEAD of
  // the errors that describe the actual damage.
  if (invPeriods.size === 0) {
    coverageLost([
      `${INVENTORY_REL} declares no \`retention.periodDays\` for any store, so limb (v) compares nothing.`,
      'It would then print ok whatever the register said, and emptying the home would be the way to make it pass.',
      'An assertion that cannot fail is worse than none, because it inflates apparent coverage.',
    ]);
  }

  // (v-a) the home declares it → the register must carry the same copy
  let periodPairs = 0;
  for (const [store, inv] of invPeriods) {
    const row = byStore.get(store);
    if (!row) {
      errors.push(
        `${cite(INVENTORY_REL, inventoryRaw, inv.id, 'periodDays')} declares \`periodDays: ${inv.days}\` for \`${store}\` and ` +
          `${REGISTER_REL} carries no retention row for that store — the period the privacy notice is generated from names no deleting job.`,
      );
      continue;
    }
    if (row.rule !== 'period') {
      errors.push(
        `${cite(INVENTORY_REL, inventoryRaw, inv.id, 'periodDays')} declares \`periodDays: ${inv.days}\` for \`${store}\` while ` +
          `${cite(REGISTER_REL, registerRaw, row.id, 'rule')} calls it \`rule: ${JSON.stringify(row.rule)}\`. Only \`period\` obliges a ` +
          '`deletingJob`, so under any other rule nothing is required to enforce the number users are shown.',
      );
      continue;
    }
    periodPairs++;
    if (row.periodDays !== inv.days) {
      errors.push(
        `RETENTION PERIODS DISAGREE for \`${store}\` — ${cite(INVENTORY_REL, inventoryRaw, inv.id, 'periodDays')} says ` +
          `${inv.days} and ${cite(REGISTER_REL, registerRaw, row.id, 'periodDays')} says ${row.periodDays}. ` +
          `${INVENTORY_REL} is the HOME (the privacy notice is generated from it) and ${REGISTER_REL} carries a DERIVED copy: ` +
          'change the home and copy it across, never reconcile by editing the register alone.',
      );
    }
  }

  // (v-b) THE OTHER DIRECTION — a derived copy with no home. Without this, the
  // way to pass limb (v-a) is to delete the inventory row, and the register would
  // go on declaring a period the disclosure knows nothing about.
  for (const r of rows) {
    if (r.rule !== 'period' || invPeriods.has(r.store)) continue;
    errors.push(
      `${cite(REGISTER_REL, registerRaw, r.id, 'periodDays')} declares \`periodDays: ${r.periodDays}\` for \`${r.store}\` and ` +
        `${INVENTORY_REL} declares no period for it. The register's number is a DERIVED copy, and a copy with no home is a ` +
        'period the privacy notice will never state — the direction that lets the two files drift apart in silence.',
    );
  }

  for (const r of rows) {
    if (r.rule === 'period-undeclared') prints.push(`${r.id} — PERIOD UNDECLARED (owner): ${r.ownerGap ?? ''}`);
  }

  console.log(
    `⬜  ${stores.size} store(s) enumerated from ${configs.length} live wrangler config(s) ` +
      `(${excluded.length} brick template(s) excluded) + ${requiredIds.length} external`,
  );
  console.log(
    `⬜  ${periodPairs} declared period(s) cross-checked home→copy: ${INVENTORY_REL} (home) ≡ ${REGISTER_REL} (derived), ` +
      `${invPeriods.size} declared in the home`,
  );
  for (const p of prints) console.log(`⬜  ${p}`);

  if (errors.length) {
    console.error(`✗ retention coverage — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`    ${e}`);
    process.exit(1);
  }

  console.log(
    `ok  every enumerated store carries a declared retention rule — ${rows.length} rule(s) over ${stores.size} tree-derived + ` +
      `${requiredIds.length} external store(s), and ${periodPairs} declared period(s) agree between their home and the register [pipeline O-17]`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
