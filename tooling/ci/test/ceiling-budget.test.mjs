// ─────────────────────────────────────────────────────────────────────────────
// ceiling-budget.test.mjs — assert-ceiling-budget.mjs must be able to FAIL.
//
// [pipeline B-6] every free-tier ceiling recorded once, with its SOURCE, and
// every hard cap in the Worker source derives from it.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-01, EIGHTEEN).
// A fixture you wrote encodes the same misunderstanding as the guard you wrote;
// only breaking the actual tree can show otherwise (assert-seams-wired.mjs
// shipped with all six of its fixture tests passing against a broken version).
// Eleven ran against a scratch COPY of services/ + tooling/ + .github/; the
// seven that touch TypeScript ran in the real worktree so each could be
// TSC-VERIFIED FIRST — a compile error looks exactly like a caught mutation,
// and this repo has been fooled by that three times in one session. Every
// restore was byte-compared AND re-run to green.
//
//   MC1  MAX_EVENTS_PER_BATCH 50 -> 51          -> caught: "EXCEEDS its declared ceiling"
//   MC2  its `@ceiling` reference deleted       -> caught: "NO `@ceiling` annotation"
//   MC3  d1.queriesPerInvocation loses `source` -> caught: "with NO `source` https URL"
//   MC4  ...loses `verifiedOn`                  -> caught: "no valid `verifiedOn`"
//   MC5  ...`value` set to null (unverified)    -> caught: "is UNVERIFIED"
//   MC6  brick template gains 5 cron triggers   -> caught: "against the ceiling
//        (6 > the 5-per-account Free ceiling)       \"workers.cronTriggersPerAccount\""
//   MC7  a new `.batch(` in routes/config.ts    -> caught: "`batchCallSites` does not name it"
//   MC8  MAX_ENTITLEMENT_IDS renamed, so its    -> caught: "no constant of that name exists"
//        batchCallSites `boundedBy` dangles
//   MC9  EVENTS_LIMITER period 60 -> 30         -> caught: "accepts only [10,60]"
//   MC10 no ceiling names `triggers.crons`      -> caught: "vendor surface \"triggers.crons\""
//   MC13 batchCallSites gains an entry for a    -> caught: "this scan finds no `.batch(` there"
//        file that calls no batch
//   MC14 d1.databasesPerAccount loses           -> caught: "no `sourceText`"
//        `sourceText`
//   MC15 the `ceilings` array emptied           -> caught: COVERAGE LOST
//   MC16 `configCeilings.checks` emptied        -> caught: COVERAGE LOST
//   MC17 capability-register's cloudflare        -> caught: COVERAGE LOST
//        `surfaces` emptied
//   MC18 MAX_ENTITLEMENT_IDS 50 -> 51 (the      -> caught: "EXCEEDS its declared ceiling"
//        constant sitting EXACTLY on the ceiling)
//   MC19 a brand-new unannotated numeric const  -> caught: "is a numeric constant with
//                                                  NO `@ceiling` annotation"
//   MC20 MAX_CATEGORIES keeps 200 but loses     -> caught: "EXCEEDS its declared ceiling"
//        its `@ceiling-exceeds` declaration
//   None crashed; every one exited 1 with the intended message; every TS
//   mutation compiled clean first; every restore was verified.
//
// ⚠️ LIMB 6 (write amplification) — THREE MORE REAL-TREE MUTATIONS, 2026-08-06,
// again BEFORE the fixtures below existed. The subject is the actual
// services/platform/migrations/0002_analytics.sql, restored byte-identical after
// each (`git hash-object` back to 94ca9f4f11d9c9dfaa83feda459d9fcb3a5422be).
//
//   MR1  a FIFTH real index added to the real 0002_analytics.sql:
//          CREATE INDEX idx_events_mutation_probe ON events (platform, server_ts);
//        -> caught, BOTH stored numbers at once and exit 1:
//          "`writeAmplification.rowsWrittenPerEvent` = 5, and the SCHEMA SAYS 6
//           — 1 base row + 5 index row(s) on `events` (…:58, :60, :61, :63, :64)"
//          "`writeAmplification.eventsPerDayWithinCeiling` = 20000, and the
//           derivation gives 16666 = ⌊100000 … ÷ 6⌋"
//        That second line IS E-14's sentence — the headroom moved by itself.
//   MR2  the same CREATE INDEX line added to the real migration INSIDE A `--`
//        COMMENT -> NOT counted, guard stayed green at 4 indexes / 5 rows per
//        event. The mutation that must NOT fire, and the one a grep fails: 0002's
//        real header already names "UNIQUE INDEX" and "write amplification" in a
//        paragraph describing a shape it does not use.
//   MR3  the real tooling/ceilings.json edited to the pre-research figures
//        (rowsWrittenPerEvent 5 -> 1, eventsPerDayWithinCeiling 20000 -> 100000)
//        -> caught: "the SCHEMA SAYS 5" and "the derivation gives 20000".
//
// 🔴 AND THE RED LIMB 6 WAS BUILT TO RECORD, on the tree as it stood 2026-08-06:
//   the ceiling E-14's whole arithmetic binds on — `d1.rowsWrittenPerDay` — was
//   NOT IN THE REGISTER AT ALL. Fifteen ceiling ids, none of them the one the
//   capacity model divides by, and `grep -n "rows_written_per_event\|amplif"
//   tooling/ceilings.json` returned nothing. The 5× correction lived in prose in
//   company/pipeline/11-measurement.md and in no file any guard could reach.
//
// 🔴 AND THE RED THIS GUARD WAS BUILT TO RECORD, on the tree as it stood:
//   services/platform/src/routes/events.ts declared `MAX_EVENTS_PER_BATCH = 100`
//   naming no ceiling at all, while D1 documents FIFTY queries per Worker
//   invocation on Free. The handler issues one `PLATFORM_DB.batch()` holding one
//   INSERT per event, so a full batch asked for double the documented limit on
//   the shared database every app in the portfolio depends on. Run against that
//   tree the guard said, verbatim:
//     "services/platform/src/routes/events.ts:29 `MAX_EVENTS_PER_BATCH` is a
//      numeric constant with NO `@ceiling` annotation."
//   and, once annotated but not lowered:
//     "`MAX_EVENTS_PER_BATCH = 100` EXCEEDS its declared ceiling
//      \"d1.queriesPerInvocation\" = 50".
//   The cap was then lowered to 50 (the client flushes at 20, so nothing
//   observable changed) and the batch call site was registered.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-ceiling-budget.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ceil-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const BRICK_CFG =
  'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/wrangler.jsonc';

/** The fixture Worker source. Deliberately carries a constant whose comment
 *  MENTIONS a ceiling id in prose without the `@ceiling` marker, so the passing
 *  case exercises the difference between naming a thing and annotating it. */
const EVENTS_TS = `
import { Hono } from 'hono';

/**
 * Bounded by d1.queriesPerInvocation in the prose sense only — the line below is
 * the one that counts.
 * @ceiling d1.queriesPerInvocation lte
 */
const MAX_EVENTS_PER_BATCH = 50;
/** @ceiling none — a column width, not a platform resource. */
const MAX_ID_LEN = 64;

const events = new Hono();
events.post('/events', async (c) => {
  const rows = new Array(MAX_EVENTS_PER_BATCH).fill(c.env.PLATFORM_DB.prepare('INSERT INTO events DEFAULT VALUES'));
  await c.env.PLATFORM_DB.batch(rows.slice(0, MAX_ID_LEN));
  return c.json({ ok: true });
});
export default events;
`;

const CONFIG_TS = `
import { Hono } from 'hono';
const app = new Hono();
// A comment that says ".batch(" in prose. A guard that grepped raw text would
// find a call site here and demand it be registered; this one strips comments.
app.get('/:app', async (c) => c.json(await c.env.CONFIG_KV.get('config:x')));
export default app;
`;

const PLATFORM_CFG = `{
  // A comment naming "triggers" and "crons" so comment-stripping is exercised by
  // the PASSING case rather than assumed.
  "name": "platform",
  "main": "src/index.ts",
  "d1_databases": [{ "binding": "PLATFORM_DB", "database_name": "platform_db" }],
  "kv_namespaces": [{ "binding": "CONFIG_KV", "id": "k1" }],
  "ratelimits": [
    { "name": "EVENTS_LIMITER", "namespace_id": "1001", "simple": { "limit": 120, "period": 60 } },
  ],
  "triggers": { "crons": ["0 6 * * *"] },
}`;

const BRICK_CFG_BODY = `{
  "name": "{{app_id}}-api",
  "main": "src/index.ts",
  "d1_databases": [{ "binding": "APP_DB", "database_name": "{{app_id}}_db" }],
}`;

/** The migration fixture limb 6 counts indexes out of. Deliberately carries, in
 *  the PASSING case, all three shapes a text scan gets wrong:
 *    · a COMMENT containing the words CREATE INDEX … ON events — 0002's real
 *      header does exactly this, explaining a shape it does not use;
 *    · indexes on a DIFFERENT table, which must not raise the events factor;
 *    · an index whose `ON <table>` sits on the NEXT line — 0002:85-86 is that,
 *      and it is the one a line-oriented scan attributes to the wrong table. */
const MIGRATION_SQL = `
-- SHAPE DECISIONS: a ROWID table + a UNIQUE INDEX on event_id, NOT a text PK.
-- Rejected, and written out so a grep-based counter reads it as schema:
--   CREATE INDEX IF NOT EXISTS idx_events_city ON events (city);
CREATE TABLE IF NOT EXISTS events (
  event_id   TEXT NOT NULL,
  app_id     TEXT NOT NULL,
  server_ts  TEXT NOT NULL,
  params     TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events (event_id);
CREATE INDEX IF NOT EXISTS idx_events_app_ts ON events (app_id, server_ts);

CREATE TABLE IF NOT EXISTS consent_artifacts (
  consent_id TEXT NOT NULL,
  app_id     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_id ON consent_artifacts (consent_id);
CREATE INDEX IF NOT EXISTS idx_consent_lookup
  ON consent_artifacts (app_id, consent_id);
`;

const MIGRATIONS_DIR = 'services/platform/migrations';
const MIGRATION = `${MIGRATIONS_DIR}/0002_analytics.sql`;

const CAP_REGISTER = () => ({
  vendors: {
    cloudflare: {
      surfaces: ['PLATFORM_DB', 'CONFIG_KV', 'EVENTS_LIMITER', 'triggers.crons'],
    },
  },
});

const baseCeilings = () => ({
  ceilings: [
    {
      id: 'd1.queriesPerInvocation',
      value: 50,
      unit: 'queries',
      scope: 'per-invocation',
      surfaces: ['PLATFORM_DB'],
      source: 'https://developers.cloudflare.com/d1/platform/limits/',
      sourceText: 'Queries per Worker invocation: 1000 (Workers Paid) / 50 (Free)',
      verifiedOn: '2026-08-01',
      ambiguity: 'Whether batch() spends 1 or N is undocumented; worst case assumed.',
    },
    {
      id: 'kv.readsPerDay',
      value: 100000,
      unit: 'reads',
      scope: 'per-account-per-day',
      surfaces: ['CONFIG_KV'],
      source: 'https://developers.cloudflare.com/kv/platform/limits/',
      sourceText: 'Reads: 100,000 reads per day',
      verifiedOn: '2026-08-01',
      ambiguity: 'None.',
    },
    {
      id: 'workers.cronTriggersPerAccount',
      value: 5,
      unit: 'triggers',
      scope: 'per-account',
      surfaces: ['triggers.crons'],
      source: 'https://developers.cloudflare.com/workers/platform/limits/',
      sourceText: 'Cron Triggers per account: 5 (Free) / 250 (Paid)',
      verifiedOn: '2026-08-01',
      ambiguity: 'None.',
    },
    {
      id: 'd1.databasesPerAccount',
      value: 10,
      unit: 'databases',
      scope: 'per-account',
      surfaces: ['PLATFORM_DB'],
      source: 'https://developers.cloudflare.com/d1/platform/limits/',
      sourceText: 'Databases per account: 50,000 (Workers Paid) / 10 (Free)',
      verifiedOn: '2026-08-01',
      ambiguity: 'None.',
    },
    {
      id: 'd1.rowsWrittenPerDay',
      value: 100000,
      unit: 'rows',
      scope: 'per-account-per-day',
      surfaces: ['PLATFORM_DB'],
      source: 'https://developers.cloudflare.com/d1/platform/pricing/',
      sourceText: 'Rows written | 100,000 / day',
      verifiedOn: '2026-08-06',
      ambiguity: 'The factor is the worst case for a full-row INSERT.',
    },
    {
      id: 'ratelimit.allowedPeriods',
      value: null,
      allowedValues: [10, 60],
      unit: 'seconds',
      scope: 'per-binding',
      surfaces: ['EVENTS_LIMITER'],
      source: 'https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/',
      sourceText: 'Must be either 10 or 60 [seconds].',
      verifiedOn: '2026-08-01',
      ambiguity: 'An enumeration, not a magnitude.',
    },
  ],
  batchCallSites: {
    sites: [
      { file: 'services/platform/src/routes/events.ts', boundedBy: 'MAX_EVENTS_PER_BATCH' },
    ],
  },
  // The fixture schema carries TWO indexes on `events`, so the derived factor is
  // 1 + 2 = 3 and the headroom is ⌊100000 ÷ 3⌋ = 33333. Both are the guard's
  // EXPECTED answers, never its inputs.
  writeAmplification: {
    ceiling: 'd1.rowsWrittenPerDay',
    migrationsDir: MIGRATIONS_DIR,
    table: 'events',
    rowsWrittenPerEvent: 3,
    eventsPerDayWithinCeiling: 33333,
  },
  configCeilings: {
    checks: [
      { id: 'crons', ceiling: 'workers.cronTriggersPerAccount', counts: 'triggers.crons', relation: 'lte' },
      { id: 'd1Databases', ceiling: 'd1.databasesPerAccount', counts: 'database_name', relation: 'lte' },
      { id: 'ratelimitPeriods', ceiling: 'ratelimit.allowedPeriods', counts: 'simple.period', relation: 'memberOf' },
    ],
  },
});

/** A repo fixture. `ceilings`/`cap`/`files` override the defaults. */
function tree({ ceilings = baseCeilings(), cap = CAP_REGISTER(), files = {} } = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (relPath, body) => {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const all = {
    'services/platform/src/routes/events.ts': EVENTS_TS,
    'services/platform/src/routes/config.ts': CONFIG_TS,
    'services/platform/wrangler.jsonc': PLATFORM_CFG,
    [BRICK_CFG]: BRICK_CFG_BODY,
    [MIGRATION]: MIGRATION_SQL,
    ...files,
  };
  for (const [p, body] of Object.entries(all)) if (body !== null) write(p, body);
  if (ceilings !== null) write('tooling/ceilings.json', JSON.stringify(ceilings, null, 2));
  if (cap !== null) write('tooling/capability-register.json', JSON.stringify(cap, null, 2));
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-ceiling-budget — a cap without a sourced ceiling is the failure', () => {
  test('the passing shape exits 0, and REPORTS WHAT IT MEASURED', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    // Not merely "ok". A guard that passes without saying how many comparisons
    // it ran is indistinguishable from one that ran none.
    assert.match(r.out, /REQUIRED_COVERAGE/);
    assert.match(r.out, /compared to a sourced ceiling/);
  });

  // ── LIMB 1: the citation ───────────────────────────────────────────────────
  test('FAILS on a ceiling that declares a value with no `source` [MC3]', () => {
    const c = baseCeilings();
    delete c.ceilings[0].source;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /with NO `source` https URL/);
  });

  test('FAILS on a `source` that is not an https URL', () => {
    const c = baseCeilings();
    c.ceilings[0].source = 'the Cloudflare docs, I think';
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /with NO `source` https URL/);
  });

  test('FAILS on a sourced ceiling with no `verifiedOn` date [MC4]', () => {
    const c = baseCeilings();
    delete c.ceilings[0].verifiedOn;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no valid `verifiedOn`/);
  });

  test('FAILS on a `verifiedOn` that is not a date', () => {
    const c = baseCeilings();
    c.ceilings[0].verifiedOn = 'recently';
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no valid `verifiedOn`/);
  });

  test('FAILS on a cited ceiling with no quoted `sourceText` [MC14]', () => {
    const c = baseCeilings();
    delete c.ceilings[3].sourceText;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no `sourceText`/);
  });

  test('FAILS on a ceiling row with no `ambiguity` field', () => {
    // "None." is a legitimate answer. Having nowhere to write it is not: the
    // batch()-spends-1-or-N question is the difference between a correct cap and
    // one at double the limit, and a register with no field for it loses it.
    const c = baseCeilings();
    delete c.ceilings[1].ambiguity;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no `ambiguity`/);
  });

  test('an UNVERIFIED ceiling PRINTS and does not fail the build', () => {
    const c = baseCeilings();
    c.ceilings.push({
      id: 'ratelimit.accountingAccuracy',
      value: null,
      surfaces: ['EVENTS_LIMITER'],
      source: 'https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/',
      verifiedOn: '2026-08-01',
      ambiguity: 'The vendor states there is no accurate number to have.',
    });
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /UNVERIFIED ceiling "ratelimit\.accountingAccuracy"/);
  });

  test('FAILS when a cap DERIVES from an unverified ceiling [MC5]', () => {
    // The asymmetry is the point. Recording "we could not source this" is free;
    // deriving a hard cap from it is an invented limit wearing a citation.
    const c = baseCeilings();
    c.ceilings[0].value = null;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is UNVERIFIED/);
  });

  test('FAILS on two ceiling rows sharing one id', () => {
    const c = baseCeilings();
    c.ceilings.push({ ...c.ceilings[0] });
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /TWICE/);
  });

  // ── LIMB 2: the vendor-surface relationship ────────────────────────────────
  test('FAILS on a bound vendor surface no ceiling row names [MC10]', () => {
    const c = baseCeilings();
    for (const row of c.ceilings) row.surfaces = (row.surfaces ?? []).filter((s) => s !== 'triggers.crons');
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /vendor surface "triggers\.crons"/);
  });

  test('FAILS on a ceiling naming a surface the capability register does not list', () => {
    // The other direction. A stale row inflates limb 2's apparent coverage.
    const c = baseCeilings();
    c.ceilings[1].surfaces = ['EXPORTS'];
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /names surface "EXPORTS"/);
  });

  // ── LIMB 3: the annotation and the arithmetic ──────────────────────────────
  test('FAILS on an unannotated numeric constant [MC2, MC19]', () => {
    const r = run(tree({
      files: {
        'services/platform/src/routes/events.ts': EVENTS_TS.replace(' * @ceiling d1.queriesPerInvocation lte\n', ''),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /`MAX_EVENTS_PER_BATCH` is a numeric constant with NO `@ceiling` annotation/);
  });

  test('FAILS on a constant that EXCEEDS its declared ceiling [MC1, MC18]', () => {
    const r = run(tree({
      files: {
        'services/platform/src/routes/events.ts': EVENTS_TS.replace(
          'const MAX_EVENTS_PER_BATCH = 50;',
          'const MAX_EVENTS_PER_BATCH = 51;',
        ),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /EXCEEDS its declared ceiling/);
    // The message must carry the citation, not just the number — a reviewer
    // cannot check a bound whose source is not in front of them.
    assert.match(r.out, /developers\.cloudflare\.com\/d1\/platform\/limits/);
  });

  test('an over-ceiling constant with `@ceiling-exceeds` PRINTS instead [MC20 inverse]', () => {
    const r = run(tree({
      files: {
        'services/platform/src/routes/events.ts': EVENTS_TS
          .replace('const MAX_EVENTS_PER_BATCH = 50;', 'const MAX_EVENTS_PER_BATCH = 201;')
          .replace(' * @ceiling d1.queriesPerInvocation lte',
            ' * @ceiling d1.queriesPerInvocation lte\n * @ceiling-exceeds a product decision routed rather than made here'),
      },
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OVER CEILING \(declared\)/);
    assert.match(r.out, /routed rather than made here/);
  });

  test('FAILS on a constant referencing a ceiling id that does not exist', () => {
    const r = run(tree({
      files: {
        'services/platform/src/routes/events.ts': EVENTS_TS.replace(
          '@ceiling d1.queriesPerInvocation lte',
          '@ceiling d1.thisWasNeverARealCeiling lte',
        ),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no ceiling row with id "d1\.thisWasNeverARealCeiling"/);
  });

  test('COVERAGE LOST when annotations exist but no arithmetic ran', () => {
    // Every annotation becomes `none`: the guard would otherwise report every
    // cap within its ceiling by measuring none.
    const r = run(tree({
      files: {
        'services/platform/src/routes/events.ts': EVENTS_TS.replace(
          ' * @ceiling d1.queriesPerInvocation lte',
          ' * @ceiling none — reclassified',
        ),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /NOT ONE arithmetic comparison ran/);
  });

  // ── LIMB 4: the batch call sites, in both directions ───────────────────────
  test('FAILS on a `.batch(` call site the register does not name [MC7]', () => {
    const r = run(tree({
      files: {
        'services/platform/src/routes/config.ts': CONFIG_TS.replace(
          'const app = new Hono();',
          'const app = new Hono();\nasync function warm(db) { await db.batch([db.prepare("SELECT 1")]); }\n',
        ),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /`batchCallSites` does not name it/);
  });

  test('FAILS on a batchCallSites entry whose file has no `.batch(` [MC13]', () => {
    const c = baseCeilings();
    c.batchCallSites.sites.push({ file: 'services/platform/src/routes/config.ts', unboundedReason: 'invented' });
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /this scan finds no `\.batch\(` there/);
  });

  test('FAILS when a batch `boundedBy` names a constant that does not exist [MC8]', () => {
    const c = baseCeilings();
    c.batchCallSites.sites[0].boundedBy = 'MAX_EVENTS_PER_BATCH_RENAMED';
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /no constant of that name exists/);
  });

  test('FAILS on a batch entry with neither a bound nor a reason', () => {
    const c = baseCeilings();
    c.batchCallSites.sites[0] = { file: 'services/platform/src/routes/events.ts' };
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /neither a `boundedBy` constant nor a non-empty `unboundedReason`/);
  });

  test('an `unboundedReason` PRINTS on every run', () => {
    const c = baseCeilings();
    c.batchCallSites.sites[0] = {
      file: 'services/platform/src/routes/events.ts',
      unboundedReason: 'chunking belongs with the cron increment',
    };
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /UNBOUNDED BATCH \(declared\)/);
  });

  // ── LIMB 5: the deployed configs ───────────────────────────────────────────
  test('FAILS when the account-wide cron ceiling is crossed — INCLUDING BY THE BRICK [MC6]', () => {
    // 🔴 THE BRICK IS THE CONFIG THAT MULTIPLIES BY THE NUMBER OF APPS, and
    // assert-clone-contract.mjs only ever inspects the throwaway CI probe stamp
    // — which is exactly how a per-app R2 bucket stayed live for two weeks with
    // every guard green. A cron ceiling checked only against services/ would let
    // the template add one per stamped app and never fire.
    const r = run(tree({
      files: {
        [BRICK_CFG]: BRICK_CFG_BODY.replace(
          '"main"',
          '"triggers": { "crons": ["0 1 * * *", "0 2 * * *", "0 3 * * *", "0 4 * * *", "0 5 * * *"] },\n  "main"',
        ),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /against the ceiling "workers\.cronTriggersPerAccount"/);
  });

  test('FAILS when the account-wide D1 database ceiling is crossed', () => {
    const extra = Array.from({ length: 12 }, (_, i) => `{ "binding": "DB${i}", "database_name": "db_${i}" }`).join(',\n    ');
    const r = run(tree({
      files: {
        'services/platform/wrangler.jsonc': PLATFORM_CFG.replace(
          '"d1_databases": [{ "binding": "PLATFORM_DB", "database_name": "platform_db" }],',
          `"d1_databases": [\n    ${extra}\n  ],`,
        ),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /d1Databases:/);
  });

  test('FAILS on a rate-limiter period outside the documented set [MC9]', () => {
    const r = run(tree({
      files: {
        'services/platform/wrangler.jsonc': PLATFORM_CFG.replace('"period": 60', '"period": 30'),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /accepts only \[10,60\]/);
  });

  test('a jsonc comment mentioning `crons` does not count as a cron', () => {
    // The comment-stripping is string-AWARE: the passing fixture's config
    // carries a comment naming both words, and the count must still be 1. A
    // naive `//` strip would also eat the `//` inside every https URL in this
    // repo's configs and turn valid jsonc into garbage.
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /account-wide config ceiling\(s\) counted/);
  });

  // ── LIMB 6: the write-amplification factor is COUNTED, never typed ─────────
  test('the passing shape REPORTS the derivation, not just its verdict', () => {
    // 2 indexes on `events` ⇒ 3 rows/event ⇒ ⌊100000 ÷ 3⌋ = 33333. Printed with
    // the file:line of every index counted, because a factor a reviewer cannot
    // re-derive from the output is the defect E-14 was re-opened for.
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /write amplification DERIVED, not read/);
    assert.match(r.out, /2 of them on `events`/);
    assert.match(r.out, /3 rows written per event/);
    assert.match(r.out, /33333 events\/day/);
  });

  test('FAILS when a FIFTH index lands and the stored factor does not move [MR1]', () => {
    // E-14, verbatim: "Adding a fifth index then changes the headroom number
    // automatically, and a model whose stored value disagrees with the count
    // fails." This is that sentence as an executable.
    const r = run(tree({
      files: {
        [MIGRATION]: `${MIGRATION_SQL}\nCREATE INDEX idx_events_params ON events (params);\n`,
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /`writeAmplification\.rowsWrittenPerEvent` = 3, and the SCHEMA SAYS 4/);
    // The headroom must move with it, or only half the model is derived.
    assert.match(r.out, /`writeAmplification\.eventsPerDayWithinCeiling` = 33333, and the derivation gives 25000/);
  });

  test('FAILS when the stored factor is edited to disagree with the schema [MR3]', () => {
    // The direction that actually happened: 1 row per event, which is what E-14
    // sized against before its research pass and was wrong by 5×.
    const c = baseCeilings();
    c.writeAmplification.rowsWrittenPerEvent = 1;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /the SCHEMA SAYS 3/);
    assert.match(r.out, /COUNTED, never typed/);
  });

  test('FAILS when the stored headroom is edited to disagree with its own inputs', () => {
    const c = baseCeilings();
    c.writeAmplification.eventsPerDayWithinCeiling = 100000;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /the derivation gives 33333/);
  });

  test('FAILS when the stored factor is deleted rather than wrong', () => {
    // Absence must not be quieter than disagreement: with nothing stored there
    // is nothing for the count to contradict.
    const c = baseCeilings();
    delete c.writeAmplification.rowsWrittenPerEvent;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no numeric `rowsWrittenPerEvent`/);
  });

  test('FAILS when the stored headroom is deleted rather than wrong', () => {
    const c = baseCeilings();
    delete c.writeAmplification.eventsPerDayWithinCeiling;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no numeric `eventsPerDayWithinCeiling`/);
  });

  test('a COMMENTED-OUT index is not counted [MR2]', () => {
    // The passing fixture's migration already carries `CREATE INDEX … ON events`
    // inside a comment — 0002_analytics.sql's real header does the same, listing
    // a shape it deliberately does NOT use. A grep counts 3 indexes there and
    // derives 4. This is the repo's recorded rule (strip comments AND string
    // literals before scanning SQL) with a case that can show it.
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 of them on `events`/);
  });

  test('indexes on ANOTHER table do not raise the factor', () => {
    // Three of the fixture's five indexes are on consent_artifacts, and one of
    // them puts its `ON <table>` on the NEXT line. A scan that read table names
    // per-line would attribute it to whatever came before.
    const r = run(tree({
      files: {
        [MIGRATION]: `${MIGRATION_SQL}\nCREATE INDEX idx_consent_extra\n  ON consent_artifacts (app_id);\n`,
      },
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 of them on `events`/);
  });

  test('a DROPPED index is subtracted from the count', () => {
    const c = baseCeilings();
    c.writeAmplification.rowsWrittenPerEvent = 2;
    c.writeAmplification.eventsPerDayWithinCeiling = 50000;
    const r = run(tree({
      ceilings: c,
      files: { [MIGRATION]: `${MIGRATION_SQL}\nDROP INDEX IF EXISTS idx_events_app_ts;\n` },
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 of them on `events`/);
  });

  test('FAILS on a CREATE INDEX whose target table cannot be read', () => {
    // Not skipped, because a failed parse only ever moves the factor DOWN —
    // towards the 1-row-per-event answer that was already wrong by 5×.
    const r = run(tree({
      files: { [MIGRATION]: `${MIGRATION_SQL}\nCREATE INDEX idx_events_q ON "events" (app_id);\n` },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /whose target table this scan could NOT read/);
  });

  test('FAILS when the amplification ceiling is unverified', () => {
    const c = baseCeilings();
    c.ceilings.find((x) => x.id === 'd1.rowsWrittenPerDay').value = null;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /derives its headroom from ceiling "d1\.rowsWrittenPerDay"/);
  });

  test('COVERAGE LOST when the writeAmplification block is deleted', () => {
    // The vacuity that matters most: no block, no limb, and the register looks
    // exactly as clean as one whose numbers agree.
    const c = baseCeilings();
    delete c.writeAmplification;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /declares no `writeAmplification` block/);
  });

  test('COVERAGE LOST when the block names no table', () => {
    const c = baseCeilings();
    delete c.writeAmplification.table;
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /names no `migrationsDir` and\/or no `table`/);
  });

  test('COVERAGE LOST when the migrations directory holds no .sql', () => {
    const r = run(tree({ files: { [MIGRATION]: null } }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /holds NO \.sql file/);
  });

  test('COVERAGE LOST when no migration creates the sized table', () => {
    // The rename case. The index count would then range over a table nobody
    // writes to and quietly report 1 row per event.
    const c = baseCeilings();
    c.writeAmplification.table = 'analytics_events';
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /creates the table `analytics_events`/);
  });

  test('COVERAGE LOST when the schema has the table but no index on it', () => {
    // Zero indexes derives a factor of 1 — the exact pre-research number. A
    // parser that has stopped matching looks identical to a table with no index,
    // so this is a failure rather than a result.
    const r = run(tree({
      files: {
        [MIGRATION]: MIGRATION_SQL.replace(/CREATE (UNIQUE )?INDEX[^;]*ON events[^;]*;/g, ''),
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /ZERO `CREATE INDEX … ON events` statements/);
  });

  // ── the scans must still be reaching the tree ──────────────────────────────
  test('COVERAGE LOST when tooling/ceilings.json is absent', () => {
    const r = run(tree({ ceilings: null }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /does not exist/);
  });

  test('COVERAGE LOST when the ceilings array is emptied [MC15]', () => {
    const r = run(tree({ ceilings: { ceilings: [], batchCallSites: { sites: [] }, configCeilings: { checks: [] } } }));
    assert.equal(r.code, 1);
    assert.match(r.out, /declares ZERO ceilings/);
  });

  test('COVERAGE LOST when configCeilings.checks is emptied [MC16]', () => {
    const c = baseCeilings();
    c.configCeilings.checks = [];
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /no `configCeilings\.checks`/);
  });

  test('COVERAGE LOST when batchCallSites.sites is emptied', () => {
    const c = baseCeilings();
    c.batchCallSites.sites = [];
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the capability register lists no cloudflare surfaces [MC17]', () => {
    const r = run(tree({ cap: { vendors: { cloudflare: { surfaces: [] } } } }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /surfaces is missing or empty/);
  });

  test('COVERAGE LOST when no source file is found under services/*/src/', () => {
    const r = run(tree({
      files: {
        'services/platform/src/routes/events.ts': null,
        'services/platform/src/routes/config.ts': null,
      },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when no wrangler config is found', () => {
    const r = run(tree({
      files: { 'services/platform/wrangler.jsonc': null, [BRICK_CFG]: null },
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /no wrangler config was found/);
  });

  test('a declared configCeilings check with no counter in the guard FAILS', () => {
    // An assertion that cannot fail is worse than none — it inflates apparent
    // coverage. A check nobody implemented must say so rather than pass.
    const c = baseCeilings();
    c.configCeilings.checks.push({ id: 'r2BucketsPerAccount', ceiling: 'kv.readsPerDay', counts: 'buckets', relation: 'lte' });
    const r = run(tree({ ceilings: c }));
    assert.equal(r.code, 1);
    assert.match(r.out, /has no counter in this guard/);
  });
});
