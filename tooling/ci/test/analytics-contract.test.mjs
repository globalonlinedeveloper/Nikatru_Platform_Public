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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
