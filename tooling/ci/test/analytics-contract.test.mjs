// ─────────────────────────────────────────────────────────────────────────────
// analytics-contract.test.mjs — assert-analytics-contract.mjs must be able to FAIL.
//
// [pipeline E-1 · E-2 · E-3] one locked envelope, the privacy invariants at the
// edge, and an append-only consent trail.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-02, EIGHT).
// A fixture you wrote encodes the same misunderstanding as the guard you wrote;
// only breaking the actual tree can show otherwise. Every TypeScript mutation
// was `npx tsc --noEmit`-VERIFIED CLEAN in services/platform BEFORE the guard
// was run, because a compile error looks exactly like a caught mutation. Every
// restore was byte-compared with `git diff --stat` (empty) and re-run to green.
//
//   MU1  0002_analytics.sql: events gains `tenant TEXT`  -> caught: "`events` declares
//        and nothing else changes                            column(s) the route never
//                                                            writes: tenant"
//   MU2  events.ts: `city` deleted from the INSERT       -> caught, TWICE: "declares
//        column list only (tsc clean)                        column(s) the route never
//                                                            writes: city" AND "names 13
//                                                            column(s) and supplies 14
//                                                            placeholder(s)"
//   MU3  0002_analytics.sql: consent_artifacts gains     -> caught: "`consent_artifacts.ip`
//        `ip TEXT`                                           is a network-address column"
//   MU4  events.ts: a FILTERED `UPDATE consent_artifacts -> caught: "UPDATE on
//        SET granted = 0 WHERE consent_id = ?` added         `consent_artifacts` — the
//        to the /v1/consent handler (tsc clean)               consent trail is APPEND-ONLY"
//        🔴 `node tooling/ci/check-migrations.mjs` on the SAME tree printed
//           "8 migration file(s) clean — additive-only holds" and exited 0. That
//           is the gap this limb exists for, measured rather than argued: the
//           migrations guard reads migrations only, and exempts WHERE-filtered
//           statements by design.
//   MU5  analytics.dart: `if (consentId != null)          -> caught: COVERAGE LOST — "the
//        'consent_id': consentId,` deleted from toJson()      client parse yielded no key
//        (dart analyze clean)                                 for: consent_id"
//   MU6  0002_analytics.sql: `CREATE TABLE … events`      -> caught: COVERAGE LOST — "no
//        renamed to `events_v2`                               columns were parsed for
//                                                            `events`"
//   MU7  events.ts: `geo.city ?? null,` deleted from the  -> caught: "names 14 column(s)
//        `.bind(…)` argument list ONLY (tsc clean — this      and binds 13 value(s)"
//        is the mutation TypeScript cannot see, and the
//        one that writes WRONG rows rather than none)
//   MU8  the BRICK's `envelope:` literal gains            -> caught: "the client sends
//        `'device_model': 'unknown'`                          key(s) `events` has no
//                                                            column for: device_model"
//   None crashed; every one exited 1 with the intended message.
//
// 🔴 AND THE RED THIS GUARD RECORDS ON TODAY'S TREE: none. The envelope is
//   consistent in all four places right now — which is exactly when the parity
//   is free to enforce, and exactly when nothing else in the tree would notice
//   it stopping being true. `services/platform/test/events.test.ts:141`/`:663`
//   assert "no ip column" by searching the INSERT STRING; MU3 adds the column to
//   the SCHEMA, where neither can look.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-analytics-contract.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-analytics-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

// ── the fixture, modelled on the real four files ────────────────────────────
// Deliberately carries the shapes that have fooled a scan before: a SQL comment
// naming DELETE FROM consent_artifacts, a TypeScript comment naming UPDATE, and
// a Dart ternary whose string literal is followed by a colon.

const MIGRATION = `
-- The consent trail is append-only: never an UPDATE, and no
-- DELETE FROM consent_artifacts. Prose must not satisfy a check.
CREATE TABLE IF NOT EXISTS events (
  event_id     TEXT NOT NULL,
  app_id       TEXT NOT NULL,
  anon_id      TEXT NOT NULL,
  session_id   TEXT,
  platform     TEXT,
  app_version  TEXT,
  event        TEXT NOT NULL,
  params       TEXT NOT NULL DEFAULT '{}',
  client_ts    TEXT,
  server_ts    TEXT NOT NULL,
  country      TEXT,
  region       TEXT,
  city         TEXT,
  consent_id   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON events (event_id);

CREATE TABLE IF NOT EXISTS consent_artifacts (
  consent_id     TEXT NOT NULL,
  app_id         TEXT NOT NULL,
  anon_id        TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  granted        INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  app_version    TEXT,
  platform       TEXT,
  client_ts      TEXT,
  server_ts      TEXT NOT NULL
);
`;

const ROUTE = `
import { Hono } from 'hono';
const events = new Hono();
// A comment mentioning UPDATE consent_artifacts SET granted = 0, in prose.
events.post('/events', async (c) => {
  const stmt = c.env.PLATFORM_DB.prepare(
    \`INSERT INTO events (
       event_id, app_id, anon_id, session_id, platform, app_version,
       event, params, client_ts, server_ts, country, region, city, consent_id
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(event_id) DO NOTHING\`,
  );
  const row = stmt.bind(
    e.event_id, appId, e.anon_id, str(e.session_id, 64), str(e.platform, 32),
    str(e.app_version, 32), name, sanitizeParams(e.params), str(e.ts, 40),
    serverTs, geo.country ?? null, geo.region ?? null, geo.city ?? null,
    str(e.consent_id, 64),
  );
  await c.env.PLATFORM_DB.batch([row]);
  return c.json({ ok: true });
});
events.post('/consent', async (c) => {
  await c.env.PLATFORM_DB.prepare(
    \`INSERT INTO consent_artifacts (
       consent_id, app_id, anon_id, purpose, granted,
       policy_version, app_version, platform, client_ts, server_ts
     ) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(consent_id) DO NOTHING\`,
  )
    .bind(consentId, appId, anonId, purpose, 1, policyVersion, null, null, null, nowIso())
    .run();
  return c.json({ ok: true });
});
export default events;
`;

const ANALYTICS_DART = `
class AnalyticsEvent {
  /// A doc comment naming 'consent_id': in prose, which is not a map key.
  Map<String, Object?> toJson() => <String, Object?>{
        'event_id': eventId,
        'event': event,
        'ts': ts.toUtc().toIso8601String(),
        'session_id': sessionId,
        if (params.isNotEmpty) 'params': params,
        if (consentId != null) 'consent_id': consentId,
      };
}
`;

const TRANSPORT_DART = `
class DioEventTransport implements core.EventTransport {
  Future<void> send() async {
    // A Dart conditional expression whose literal is followed by a colon. The
    // first draft of the client limb read this as a map key called 'true' and
    // failed the build saying the client sends a column of that name.
    final String flag = ok ? 'true' : 'false';
    await _dio.post<dynamic>(
      '\$_base/v1/events',
      data: <String, Object?>{
        'app_id': appId,
        ...envelope,
        'events': events.map((e) => <String, Object?>{'anon_id': anonId, ...envelope, ...e}).toList(),
      },
    );
  }
}
`;

const APP_PROVIDERS = `
final recorder = core.AnalyticsRecorder(
  envelope: <String, Object?>{
    'platform': _platformName(),
    'app_version': AppConfig.appVersion,
  },
);
`;

const BRICK_PROVIDERS = `
final recorder = core.AnalyticsRecorder(
  envelope: <String, Object?>{
    'platform': analyticsPlatformName(),
    'app_version': kAnalyticsAppVersion,
  },
);
`;

const BRICK_REL = join(
  'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib', 'state', 'providers.dart',
);

// ── limb 5's fixture is the REAL TREE, copied ───────────────────────────────
// [pipeline 4]B-14. Every other fixture in this file is hand-written, and that
// is correct for limbs 1-4: the shapes there (a SQL comment naming a DELETE, a
// Dart ternary read as a map key) are shapes the real tree does not contain and
// a scan has to be shown surviving. Limb 5 is the opposite case. Its subject is
// the ACTUAL wire shape of eight actual routes, and a hand-written stand-in
// would encode whatever this file's author believed those shapes to be — which
// is precisely the failure `assert-seams-wired.mjs` shipped with, where all six
// fixture tests passed against a guard whose caller check matched the function's
// own declaration. So the limb-5 inputs are COPIED FROM THE REPO and mutated in
// place: a test that says "renaming this key goes red" is renaming the key that
// is really there, in the file that really serves it.
const REPO = resolve(CI_DIR, '..', '..');
const LIMB5_FILES = [
  'tooling/platform-register.json',
  'services/platform/src/index.ts',
  'services/subly-api/src/index.ts',
  '.github/workflows/deploy-workers.yml',
  'services/platform/test/config.test.ts',
  'apps/subly/test/config_default_test.dart',
  // The config route's client half, in the BRICK's test tree — [4]B-14's last
  // open clause. Copied, not written: the whole point of the clause is that the
  // pin a STAMPED app inherits is the real one.
  'tooling/bricks/app/__brick__/apps/{{app_id}}/test/config_contract_test.dart',
  'packages/core/lib/src/config/app_config.dart',
  'services/platform/src/routes/account.ts',
  'services/subly-api/src/routes/account.ts',
  'packages/core/lib/src/auth/account_deletion.dart',
  'services/platform/src/routes/entitlements.ts',
  'packages/core/lib/src/models/entitlement.dart',
  'services/platform/src/routes/cancellation.ts',
  'packages/core/lib/src/cancellation_transport.dart',
  'packages/api_client/lib/src/dio_cancellation_transport.dart',
];

const realFiles = () =>
  Object.fromEntries(LIMB5_FILES.map((rel) => [rel, readFileSync(join(REPO, ...rel.split('/')), 'utf8')]));

/** Replace `from` with `to` in one fixture file, REFUSING if `from` is not there.
 *  A mutation helper that silently no-ops produces a test asserting the guard is
 *  red about an unchanged tree — which it would not be, so the test would fail
 *  for a reason nobody could read. */
const mutate = (files, rel, from, to) => {
  const src = files[rel];
  assert.ok(src !== undefined, `${rel} is not in the fixture`);
  assert.ok(src.includes(from), `${rel} does not contain the text this mutation replaces:\n${from}`);
  return { ...files, [rel]: src.replace(from, to) };
};

/** A fixture repo, with `edit` applied to the default file map. */
function makeRepo(edit = (f) => f) {
  const root = join(TMP, `r${seq++}`);
  const files = edit({
    'services/platform/migrations/0002_analytics.sql': MIGRATION,
    'services/platform/src/routes/events.ts': ROUTE,
    'packages/core/lib/src/analytics/analytics.dart': ANALYTICS_DART,
    'packages/api_client/lib/src/dio_event_transport.dart': TRANSPORT_DART,
    'apps/subly/lib/state/analytics_providers.dart': APP_PROVIDERS,
    [BRICK_REL.replaceAll('\\', '/')]: BRICK_PROVIDERS,
    ...realFiles(),
  });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue; // an omitted file
    const p = join(root, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-analytics-contract — the envelope is one contract in four places', () => {
  test('PASSES on a fixture where schema, route and client agree', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /schema and route agree exactly/);
    assert.match(r.out, /append-only holds/);
  });

  test('FAILS when the DDL declares a column the route never writes', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0002_analytics.sql':
        f['services/platform/migrations/0002_analytics.sql'].replace(
          '  consent_id   TEXT\n);',
          '  consent_id   TEXT,\n  tenant       TEXT\n);',
        ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares column\(s\) the route never writes: tenant/);
  });

  test('FAILS when the route INSERTs a column the schema does not declare', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/routes/events.ts': f['services/platform/src/routes/events.ts']
        .replace('city, consent_id\n', 'city, consent_id, tenant\n')
        .replace('VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .replace('str(e.consent_id, 64),', 'str(e.consent_id, 64), tenantId,'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /INSERTs column\(s\) `events` does not declare: tenant/);
  });

  test('FAILS when the placeholder count does not match the column count', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/routes/events.ts': f['services/platform/src/routes/events.ts']
        .replace('VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names 14 column\(s\) and supplies 13 placeholder\(s\)/);
  });

  test('FAILS when a bound argument is dropped — the mutation TypeScript accepts', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/routes/events.ts': f['services/platform/src/routes/events.ts']
        .replace('geo.city ?? null,\n', ''),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /names 14 column\(s\) and binds 13 value\(s\)/);
  });

  test('FAILS when the INSERT has no .bind( this scan can find', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/routes/events.ts': f['services/platform/src/routes/events.ts']
        .replaceAll('.bind(', '.boundElsewhere('),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has no `\.bind\(` this scan could find/);
  });
});

describe('assert-analytics-contract — the privacy invariants, read from the schema', () => {
  test('FAILS on an ip column added to `events` by a migration', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0002_analytics.sql':
        `${f['services/platform/migrations/0002_analytics.sql']}\nALTER TABLE events ADD COLUMN ip TEXT;\n`,
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`events\.ip` is a network-address column/);
  });

  test('FAILS on an address column under another spelling on consent_artifacts', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0002_analytics.sql':
        f['services/platform/migrations/0002_analytics.sql'].replace(
          '  server_ts      TEXT NOT NULL\n);',
          '  server_ts      TEXT NOT NULL,\n  remote_addr    TEXT\n);',
        ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`consent_artifacts\.remote_addr` is a network-address column/);
  });

  test('PASSES a column merely CONTAINING the letters ip — `recipient_id` is not an address', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0002_analytics.sql':
        f['services/platform/migrations/0002_analytics.sql'].replace(
          '  consent_id   TEXT\n);',
          '  consent_id   TEXT,\n  recipient_id TEXT\n);',
        ),
    })));
    // It still fails the PARITY limb (the route does not write it) — which is
    // the point: it must not fail as an ADDRESS column.
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /network-address column/);
    assert.match(r.out, /the route never writes: recipient_id/);
  });
});

describe('assert-analytics-contract — the consent trail is append-only', () => {
  test('FAILS on a FILTERED DELETE — check-migrations exempts those, this does not', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/routes/events.ts':
        `${f['services/platform/src/routes/events.ts']}\nconst purge = 'DELETE FROM consent_artifacts WHERE consent_id = ?';\n`,
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DELETE on `consent_artifacts` — the consent trail is APPEND-ONLY/);
    assert.match(r.out, /A WHERE clause does not make this acceptable/);
  });

  test('FAILS on an UPDATE in a migration as well as in route code', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0003_fix.sql':
        'UPDATE consent_artifacts SET granted = 0 WHERE consent_id = \'x\';\n',
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /0003_fix\.sql:\d+ UPDATE on `consent_artifacts`/);
  });

  test('does NOT fire on prose — a comment saying DELETE FROM consent_artifacts passes', () => {
    // The default fixture already carries that comment in the migration AND an
    // UPDATE mention in the route's TypeScript comment. If either counted, the
    // passing case above could never have been green — asserted explicitly here
    // so that reading is not an accident of the other test.
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /APPEND-ONLY/);
  });

  test('does NOT fire on a SQL string literal that merely contains the words', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0003_note.sql':
        "INSERT INTO audit (note) VALUES ('DELETE FROM consent_artifacts is forbidden');\n",
    })));
    assert.equal(r.code, 0, r.out);
  });
});

describe('assert-analytics-contract — the client half', () => {
  test('FAILS when the client sends a key `events` has no column for', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      [BRICK_REL.replaceAll('\\', '/')]: f[BRICK_REL.replaceAll('\\', '/')].replace(
        "'app_version': kAnalyticsAppVersion,",
        "'app_version': kAnalyticsAppVersion,\n    'device_model': 'unknown',",
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the client sends key\(s\) `events` has no column for: device_model/);
  });

  test('FAILS when a REQUIRED column (NOT NULL, no DEFAULT) is supplied by nobody', () => {
    // ⚠️ THE ONLY REACHABLE FORM OF THIS FAILURE, and finding that out is why
    // this test is written the way it is. Dropping one of today's four required
    // columns from the client trips COVERAGE LOST first — all four are in
    // REQUIRED_COVERAGE — so the limb would have looked unfallible. It is not:
    // a NEW required column that the SCHEMA and the ROUTE both carry and the
    // client does not is exactly the shape that reaches it, and exactly the
    // shape a "just add a NOT NULL column at the edge" change has.
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0002_analytics.sql':
        f['services/platform/migrations/0002_analytics.sql'].replace(
          '  consent_id   TEXT\n);',
          '  consent_id   TEXT,\n  tenant       TEXT NOT NULL\n);',
        ),
      'services/platform/src/routes/events.ts': f['services/platform/src/routes/events.ts']
        .replace('city, consent_id\n', 'city, consent_id, tenant\n')
        .replace('VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .replace('str(e.consent_id, 64),', 'str(e.consent_id, 64), tenantId,'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /REQUIRES column\(s\) no client source supplies: tenant/);
    // The parity limb must NOT be what failed — the schema and the route agree.
    assert.doesNotMatch(r.out, /the route never writes: tenant/);
  });

  test('a NOT NULL column WITH a DEFAULT is not treated as required', () => {
    // `params` is `NOT NULL DEFAULT '{}'` and the client omits it when empty.
    // Demanding it would be an assertion that only holds by accident.
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/analytics/analytics.dart':
        f['packages/core/lib/src/analytics/analytics.dart'].replace(
          "if (params.isNotEmpty) 'params': params,\n",
          '',
        ),
    })));
    // Still COVERAGE LOST — `params` is in REQUIRED_COVERAGE — but explicitly
    // NOT the "REQUIRES column(s) no client source supplies" failure.
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /REQUIRES column\(s\) no client source supplies/);
  });

  test('a Dart ternary is not read as a map key', () => {
    // The transport fixture carries `ok ? 'true' : 'false'`. The first version
    // of this limb reported the client sending a column called `true`.
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /no column for: true/);
  });
});

describe('assert-analytics-contract — coverage self-checks', () => {
  test('COVERAGE LOST when the events table is renamed out of the scan', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/migrations/0002_analytics.sql':
        f['services/platform/migrations/0002_analytics.sql']
          .replace('CREATE TABLE IF NOT EXISTS events (', 'CREATE TABLE IF NOT EXISTS events_v2 ('),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no columns were parsed for `events`/);
  });

  test('COVERAGE LOST when a client source loses the literal this guard reads', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'apps/subly/lib/state/analytics_providers.dart':
        f['apps/subly/lib/state/analytics_providers.dart']
          .replace('envelope: <String, Object?>', 'envelope: buildEnvelope'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*no longer contains `envelope: <String, Object\?>`/s);
  });

  test('COVERAGE LOST when the client stops emitting one of the ten envelope fields', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/analytics/analytics.dart':
        f['packages/core/lib/src/analytics/analytics.dart']
          .replace("if (consentId != null) 'consent_id': consentId,\n", ''),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — the client parse yielded no key for: consent_id/);
  });

  test('COVERAGE LOST when the migrations directory holds no .sql at all', () => {
    const r = run(makeRepo((f) => ({ ...f, 'services/platform/migrations/0002_analytics.sql': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the route has no parseable INSERT for a table', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/routes/events.ts': f['services/platform/src/routes/events.ts']
        .replace('INSERT INTO consent_artifacts (', 'INSERT INTO consent_log ('),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*no parseable `INSERT INTO consent_artifacts/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMB 5 — [pipeline 4]B-14, the shared server's wire contract.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THESE TESTS EXISTED (2026-08-06, THREE).
// Every one was `npx tsc --noEmit`-VERIFIED CLEAN in services/platform BEFORE
// the guard ran, because a compile error looks exactly like a caught mutation —
// this repo has three recorded "catches" that were really compile errors. Every
// restore was `git status --porcelain services/`-confirmed empty and re-run to
// green.
//
//   MW1  entitlements.ts: the ITEM key `trial_end`      -> caught: "the server SENDS
//        renamed to `trial_end_at` (tsc clean)              key(s) no client reads and
//                                                           that are not declared
//                                                           server-only: trial_end_at"
//        services/platform's own suite: 1 of 309 failed — this route's row shape
//        is the one unpinned shape a test already happened to cover.
//   MW2  index.ts: `/v1/health`'s `build` renamed to    -> caught: "does not answer
//        `release` (tsc clean)                              field(s) the deploy smoke
//                                                           joins on: build"
//        🔴 ALL 309 services/platform TESTS STILL PASSED. Nothing in the tree
//           connected the handler's key to the `--field build` the deploy smoke
//           joins on, so the rename would have shipped and failed the deploy
//           AFTER the Worker was live — which is what a wire contract breaking a
//           released consumer looks like from the inside.
//   MW3  account.ts: a `503` refusal changed to `409`   -> caught: "the server can
//        (tsc clean — 409 is a valid Hono status)           answer status(es) 409 that
//                                                           the released client does
//                                                           not map"
//        🔴 ALL 309 TESTS STILL PASSED. `forStatus` resolves 409 to `unknown`,
//           whose message tells the user we cannot tell how much was deleted.
//
// The two directions a SERVER-ONLY mutation cannot reach — a client that starts
// reading a key nobody sends, and a client that stops mapping 502 — are exercised
// below against the same real files, copied.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-analytics-contract — limb 5, every shared route has a wire pin', () => {
  test('PASSES on the real tree: 8 routes, 7 pinned, 1 printed gap', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /wire health — deploy-smoke fields/);
    assert.match(r.out, /wire account — status set pinned/);
    assert.match(r.out, /wire entitlements — body pinned/);
    assert.match(r.out, /wire plan-cancel — body pinned/);
    assert.match(r.out, /GAP {2}wire money-webhook/);
    assert.match(r.out, /8 shared route\(s\) from tooling\/platform-register\.json: 7 pinned, 1 printed gap/);
    // [4]B-14's last clause: the config route's client half resolves in the
    // BRICK, so the count above is about apps that do not exist yet too.
    assert.match(r.out, /wire config — .*client half INHERITED by every stamped app: 10 key\(s\) in tooling\/bricks\//);
  });

  test('FAILS when the server adds a response key nobody declared — MW1 replayed', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'services/platform/src/routes/entitlements.ts',
        'trial_end: r.trial_end,', 'trial_end_at: r.trial_end,')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /server SENDS key\(s\) no client reads and that are not declared server-only: trial_end_at/);
  });

  test('FAILS when the RELEASED CLIENT reads a key the server does not send', () => {
    // The direction that breaks a shipped app rather than a build. There is no
    // forced-update mechanism on Windows, macOS or Linux, so the installed build
    // goes on asking for `verified_when` forever.
    const r = run(makeRepo((f) =>
      mutate(f, 'packages/core/lib/src/models/entitlement.dart',
        "j['verified_at']", "j['verified_when']")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /released client READS key\(s\) the server does not send: verified_when/);
  });

  test('COVERAGE LOST when a declared floor key leaves the server response', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'services/platform/src/routes/entitlements.ts',
        'is_pro: rows.some(grants),', 'pro: rows.some(grants),')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — entitlements: key\(s\) is_pro/);
  });

  test('FAILS when a route answers a status the released client does not map — MW3 replayed', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'services/platform/src/routes/account.ts',
        "return c.json({ error: 'account_deletion_failed' }, 503);",
        "return c.json({ error: 'account_deletion_failed' }, 409);")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /server can answer status\(es\) 409 that the released client does not map/);
  });

  test('COVERAGE LOST when the client stops mapping 502 — data gone, login alive', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'packages/core/lib/src/auth/account_deletion.dart',
        'case 502:', 'case 5020:')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no longer maps status\(es\) 502/);
  });

  test('COVERAGE LOST when a status-pinned route answers a COMPUTED status', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'services/platform/src/routes/account.ts',
        "return c.json({ error: 'identity_delete_failed' }, 502);",
        "return c.json({ error: 'identity_delete_failed' }, refusalStatus);")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /answer a COMPUTED status/);
  });

  test('FAILS when a health handler renames the field the deploy smoke joins on — MW2 replayed', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'services/platform/src/index.ts',
        'build: c.env.RELEASE ?? null,', 'release: c.env.RELEASE ?? null,')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not answer field\(s\) the deploy smoke joins on: build/);
  });

  test('and the OTHER health handler is pinned too — one Worker renaming it is enough', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'services/subly-api/src/index.ts',
        'build: c.env.RELEASE ?? null,', 'release: c.env.RELEASE ?? null,')));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /services\/subly-api\/src\/index\.ts does not answer field\(s\)/);
  });

  test('COVERAGE LOST when the workflow stops smoking /v1/health at all', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      '.github/workflows/deploy-workers.yml':
        f['.github/workflows/deploy-workers.yml'].replaceAll('/v1/health', '/v1/ping'),
    })));
    assert.equal(r.code, 1, r.out);
    // The guard now scans EVERY workflow rather than naming deploy-workers.yml
    // (it tripped assert-release-lane-generic's single-workflow rule, and a
    // hardcoded consumer would empty this limb the day the smoke moved). The
    // BEHAVIOUR under test is unchanged — no workflow smokes /v1/health, so the
    // field pin would range over nothing — only the wording of the diagnostic.
    assert.match(r.out, /NO workflow under \.github\/workflows invokes post-deploy-smoke\.mjs against \/v1\/health/);
  });

  test('COVERAGE LOST when the workflow stops joining on `build`', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      '.github/workflows/deploy-workers.yml':
        f['.github/workflows/deploy-workers.yml'].replaceAll('--field build', '--field version'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /deploy smoke no longer reads field\(s\) build/);
  });

  test('COVERAGE LOST when a ninth route is mounted with no wire contract', () => {
    const r = run(makeRepo((f) => {
      const reg = JSON.parse(f['tooling/platform-register.json']);
      reg.routes.push({ id: 'exports', method: 'POST', path: '/v1/exports', auth: 'required' });
      return { ...f, 'tooling/platform-register.json': JSON.stringify(reg, null, 2) };
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Mounted with NO wire contract: exports/);
  });

  test('COVERAGE LOST when the register itself is gone', () => {
    const r = run(makeRepo((f) => ({ ...f, 'tooling/platform-register.json': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /platform-register\.json does not exist/);
  });

  test('the printed GAP is a checked claim: a Dart client for /v1/money fails it', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/api_client/lib/src/dio_money_transport.dart':
        "final res = await _dio.post<dynamic>('${'$'}_base/v1/money/paddle');\n",
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /money-webhook is declared to have no in-repo client/);
  });

  test('…and a COMMENT naming /v1/money does not fail it — prose is not a client', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/api_client/lib/src/notes.dart':
        '// The money rail is POST /v1/money/:provider and we deliberately never call it.\n',
    })));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /GAP {2}wire money-webhook/);
  });

  test('COVERAGE LOST when a delegated pin loses the marker it points at', () => {
    // replaceAll, not replace: the marker occurs three times in that file, and
    // a mutation that removed only the first would leave the guard correctly
    // green and this test red for a reason that has nothing to do with the guard.
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/test/config.test.ts':
        f['services/platform/test/config.test.ts'].replaceAll('REQUIRED_KEYS', 'EXPECTED_KEYS'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no longer contains `REQUIRED_KEYS`/);
  });

  // ── [4]B-14's last open clause: the client half must be INHERITED ──────────
  // Real-tree mutations first, as always, and all six restored byte-identical
  // (md5 compared against a copy taken before the first one):
  //
  //   MB1  the brick test file moved out of the brick     -> COVERAGE LOST: "the inherited
  //        test tree entirely                                 client half … does not exist"
  //   MB2  the SAME pin, rendered for subly, placed in    -> COVERAGE LOST: "is declared at
  //        apps/subly/test/ and the pointer moved to it       apps/subly/test/… which is not
  //        — i.e. exactly the state B-14 was held at         under tooling/bricks/…/test/"
  //        🔴 THE POINTER RESOLVED AND THE MARKER WAS FOUND. That is the state this
  //           clause exists to reject: `pinned` printed for eight routes while a
  //           freshly stamped app inherited none of the config contract.
  //   MB3  every USE of kConfigWireKeys deleted, the      -> COVERAGE LOST: "DECLARED …
  //        declaration left intact (dart format clean         and used nowhere else in it"
  //        on the rendered file, so it still parses)
  //        🔴 This is the assert-seams-wired defect replayed on purpose.
  //   MB4  'support_url' added to the server's            -> FAIL: "On the server … and NOT
  //        REQUIRED_KEYS only                                 in the brick: support_url"
  //   MB5  'copy' deleted from the brick list only        -> FAIL: the mirror image
  //   MB6  'update_url' deleted from the brick list       -> COVERAGE LOST: the declared floor
  //   MB7  `json['update_url']` renamed to                -> FAIL: "pinned on both sides and
  //        `json['update_link']` in core's                    …/app_config.dart never reads
  //        AppConfig.fromJson (3 reads)                       them off `json`"
  //        🔴 `dart analyze packages/core/lib/src/config/app_config.dart` printed
  //           "No issues found!" on the mutated tree AND on the baseline. A compile
  //           error looks identical to a caught mutation; this one is not that.
  test('COVERAGE LOST when the config client half is not in the brick test tree', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'tooling/bricks/app/__brick__/apps/{{app_id}}/test/config_contract_test.dart': null,
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the inherited client half .*config_contract_test\.dart does not exist/);
  });

  test('COVERAGE LOST when the pinned list is DECLARED and never used', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'tooling/bricks/app/__brick__/apps/{{app_id}}/test/config_contract_test.dart',
        'for (final String key in kConfigWireKeys) {',
        'for (final String key in _serverBody().keys) {')));
    // The equality assertion is the OTHER use, so this alone must not be enough
    // to make the list unused — the guard is red only when every use is gone.
    assert.equal(r.code, 0, r.out);
    const gone = run(makeRepo((f) => {
      const stripped = mutate(f, 'tooling/bricks/app/__brick__/apps/{{app_id}}/test/config_contract_test.dart',
        'for (final String key in kConfigWireKeys) {',
        'for (final String key in _serverBody().keys) {');
      return mutate(stripped, 'tooling/bricks/app/__brick__/apps/{{app_id}}/test/config_contract_test.dart',
        'expect(_serverBody().keys.toSet(), kConfigWireKeys.toSet());',
        'expect(_serverBody().keys.toSet(), _serverBody().keys.toSet());');
    }));
    assert.equal(gone.code, 1, gone.out);
    assert.match(gone.out, /`kConfigWireKeys` is DECLARED in .* and used nowhere else in it/);
  });

  test('FAILS when the server gains a config key the brick does not carry', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'services/platform/test/config.test.ts',
        "    'update_url',\n  ] as const;", "    'update_url',\n    'support_url',\n  ] as const;")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /On the server \(services\/platform\/test\/config\.test\.ts\) and NOT in the brick: support_url/);
    // and the route stops counting as pinned — the number moves, honestly
    assert.match(r.out, /6 pinned, 1 printed gap/);
  });

  test('FAILS when the brick drops a key the server still requires', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'tooling/bricks/app/__brick__/apps/{{app_id}}/test/config_contract_test.dart',
        "  'copy',\n  'min_supported_version',", "  'min_supported_version',")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /and NOT in the brick: copy/);
  });

  test('COVERAGE LOST when the floor key `update_url` leaves either side', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'tooling/bricks/app/__brick__/apps/{{app_id}}/test/config_contract_test.dart',
        "  'max_promos_per_week',\n  'update_url',\n];", "  'max_promos_per_week',\n];")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /key\(s\) update_url are the declared floor of the config contract/);
  });

  test('FAILS when the released client stops READING a pinned key — MB7 replayed', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'packages/core/lib/src/config/app_config.dart':
        f['packages/core/lib/src/config/app_config.dart'].replaceAll("json['update_url']", "json['update_link']"),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /key\(s\) update_url are pinned on both sides and .*never reads them off `json`/);
  });

  test('FAILS when the cancel REQUEST key is renamed on the client', () => {
    const r = run(makeRepo((f) =>
      mutate(f, 'packages/api_client/lib/src/dio_cancellation_transport.dart',
        "data: <String, Object?>{'app_id': appId},",
        "data: <String, Object?>{'application_id': appId},")));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the request literal sends \{application_id\}, the pinned shape is \{app_id\}/);
  });
});
