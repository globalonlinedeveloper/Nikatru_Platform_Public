// ─────────────────────────────────────────────────────────────────────────────
// no-do-alarms.test.mjs — assert-no-do-alarms.mjs must be able to FAIL.
//
// [pipeline 13]T-10 forbids TWO things in one sentence: "never a per-app cron
// AND never Durable Object Alarms". The cron half is assert-clone-contract.mjs's
// `[3]S-6` limb. This is the other half, which did not exist until 2026-08-06 —
// `rg -i alarm tooling/ci/*.mjs` found only the words "false alarms" in three
// unrelated guards and a DST comment in a fourth.
//
// 🔴 THE CASE AT THE TOP OF THIS FILE IS THE ONE THAT MATTERS, AND IT IS HERE
// BECAUSE THE REAL TREE FOUND IT, NOT BECAUSE THIS FILE DID. The guard's first
// handler pattern ended `\)\s*\{` and so did not match
// `async alarm(): Promise<void> {` — the ordinary TypeScript spelling. Planting
// a real Durable Object in services/subly-api/src/index.ts still turned the
// guard RED, because three sibling rules fired on the same class, so the exit
// code hid the miss completely; it showed only as "3 problems" where 4 were
// expected. A fixture written by the same hand as the pattern would have
// encoded the same blind spot and passed. That is this repo's recorded
// assert-seams-wired defect — six fixture tests green against a broken guard —
// and the reason the acceptance for a guard here is a mutation of the REAL
// TREE, with these cases as the regression net afterwards.
//
// Every case builds a fake repo in a temp dir and runs the real guard against it
// with the fixture as argv[2]. Nothing is stubbed.
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
const GUARD = join(CI_DIR, 'assert-no-do-alarms.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-doalarm-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A minimal, legitimate Worker config. `main` is present because the coverage
 *  limb keys off it: a Worker that declares an entrypoint HAS source, so one
 *  that yielded no source file means the walk broke. */
const config = (extra = '') => `{
  // A wrangler config's comments are a trap by design in this repo — a guard
  // that greps has already matched the comment explaining why a binding was
  // ABSENT. This one is parsed.
  "name": "svc",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01"${extra ? `,\n${extra}` : ''}
}
`;

/** The anchor every fixture needs: services/platform is the one Worker each
 *  tree of this repository has, and the guard treats its absence as COVERAGE
 *  LOST rather than as a clean scan of a small tree. */
const ANCHOR = {
  'services/platform/wrangler.jsonc': config(),
  'services/platform/src/index.ts': 'export default { fetch: () => new Response("ok") };\n',
};

function mk(files) {
  const dir = join(TMP, `t${seq++}`);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(files) {
  const dir = mk(files);
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, dir };
}

/** Green with the anchor plus whatever the case adds. */
const withAnchor = (extra) => run({ ...ANCHOR, ...extra });

describe('assert-no-do-alarms — the alarm surface in source', () => {
  // ── THE REGRESSION CASE. See the header. ──────────────────────────────────
  test('an `alarm(): Promise<void> {` handler — the TypeScript spelling the first pattern missed', () => {
    const { code, out } = withAnchor({
      'services/subly-api/wrangler.jsonc': config(),
      'services/subly-api/src/index.ts':
        'export class R {\n  async alarm(): Promise<void> {\n    return;\n  }\n}\n',
    });
    assert.equal(code, 1);
    assert.match(out, /declares an `alarm\(\)` handler/);
    assert.match(out, /services\/subly-api\/src\/index\.ts:2/);
  });

  test('a plain `async alarm() {` handler, with no return type', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts': 'export class R {\n  async alarm() {\n    return;\n  }\n}\n',
    });
    assert.equal(code, 1);
    assert.match(out, /declares an `alarm\(\)` handler/);
  });

  test('the class-property form `alarm = async () => {}` — Cloudflare calls obj.alarm() either way', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts': 'export class R {\n  alarm = async () => {\n    return;\n  };\n}\n',
    });
    assert.equal(code, 1);
    assert.match(out, /declares an `alarm\(\)` handler/);
  });

  test('`state.storage.setAlarm(t)` — a dotted receiver must still match', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts': 'export const s = (st, t) => st.storage.setAlarm(t);\n',
    });
    assert.equal(code, 1);
    assert.match(out, /calls `setAlarm\(`/);
  });

  test('getAlarm and deleteAlarm — managing a schedule proves one exists', () => {
    for (const call of ['getAlarm', 'deleteAlarm']) {
      const { code, out } = withAnchor({
        'services/a-api/wrangler.jsonc': config(),
        'services/a-api/src/index.ts': `export const s = (st) => st.storage.${call}();\n`,
      });
      assert.equal(code, 1, call);
      assert.match(out, /calls `getAlarm\(` or `deleteAlarm\(`/);
    }
  });

  test('`extends DurableObject` — the on-ramp, stricter than T-10s letter on purpose', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts': 'export class R extends DurableObject {\n}\n',
    });
    assert.equal(code, 1);
    assert.match(out, /defines a Durable Object class/);
  });

  test('the DurableObject runtime type names, wherever they appear', () => {
    for (const t of ['DurableObjectNamespace', 'DurableObjectState', 'DurableObjectStub']) {
      const { code, out } = withAnchor({
        'services/a-api/wrangler.jsonc': config(),
        'services/a-api/src/types.ts': `export interface Env {\n  R: ${t};\n}\n`,
      });
      assert.equal(code, 1, t);
      assert.match(out, /names a Durable Object runtime type/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FALSE-ALARM SIDE, and half the point of the guard. This repo has already
// shipped a check that matched the template comment explaining why a binding was
// absent, and any file documenting T-10 necessarily contains the spellings T-10
// bans. If these go red the guard is unusable: the correct code and the
// documentation of the rule both fail the build.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-no-do-alarms — prose and strings cannot fail a build', () => {
  test('a comment naming setAlarm, alarm() and durable_objects is not a violation', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts':
        '// NO durable_objects here. There is no alarm() handler and nothing calls\n' +
        '// setAlarm(), getAlarm() or deleteAlarm(): scheduled work rides the one cron.\n' +
        '/* class R extends DurableObject { async alarm(): Promise<void> {} } */\n' +
        'export default { fetch: () => new Response("ok") };\n',
    });
    assert.equal(code, 0, out);
    assert.match(out, /ok  no Durable Object alarms/);
  });

  test('a string literal quoting the API name is not a violation', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts':
        'export const deny = ["setAlarm(", "alarm() {", "DurableObjectState"];\n' +
        'export const msg = "this Worker must never call setAlarm(x)";\n',
    });
    assert.equal(code, 0, out);
  });

  test('a wrangler config whose COMMENT names durable_objects and new_classes parses clean', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': `{
  // NO "durable_objects" HERE ON PURPOSE, and no "migrations" with
  // "new_classes" / "new_sqlite_classes" either. Scheduled work is one cron.
  "name": "a-api",
  "main": "src/index.ts"
}
`,
      'services/a-api/src/index.ts': 'export default { fetch: () => new Response("ok") };\n',
    });
    assert.equal(code, 0, out);
  });

  test('identifiers that merely contain the word alarm are not the alarm API', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts':
        'const alarmCount = 0;\nexport const bump = (o) => o.alarms.length + alarmCount;\n' +
        'export const falseAlarm = (x) => x;\n',
    });
    assert.equal(code, 0, out);
  });

  test('a `https://` URL inside a config string does not eat the rest of the config', () => {
    // The one way a naive JSONC stripper breaks: reading `//` inside a string as
    // a line comment and deleting everything after it — which would silently
    // hide a durable_objects block written below it.
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': `{
  "name": "a-api",
  "main": "src/index.ts",
  "vars": { "SUPABASE_URL": "https://example.supabase.co" },
  "durable_objects": { "bindings": [{ "name": "R", "class_name": "R" }] }
}
`,
      'services/a-api/src/index.ts': 'export default { fetch: () => new Response("ok") };\n',
    });
    assert.equal(code, 1, out);
    assert.match(out, /declares 1 durable_objects binding/);
  });
});

describe('assert-no-do-alarms — the config limbs', () => {
  test('a durable_objects binding fails', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config('  "durable_objects": { "bindings": [{ "name": "REMINDERS", "class_name": "S" }] }'),
      'services/a-api/src/index.ts': 'export default { fetch: () => new Response("ok") };\n',
    });
    assert.equal(code, 1);
    assert.match(out, /declares 1 durable_objects binding\(s\) \("REMINDERS"\)/);
  });

  test('a top-level migrations entry with new_classes / new_sqlite_classes fails', () => {
    for (const key of ['new_classes', 'new_sqlite_classes', 'renamed_classes', 'transferred_classes']) {
      const { code, out } = withAnchor({
        'services/a-api/wrangler.jsonc': config(`  "migrations": [{ "tag": "v1", "${key}": ["S"] }]`),
        'services/a-api/src/index.ts': 'export default { fetch: () => new Response("ok") };\n',
      });
      assert.equal(code, 1, key);
      assert.match(out, new RegExp(`\`${key}\``));
      assert.match(out, /DURABLE OBJECT class migration/);
    }
  });

  test('a d1 migrations_dir is NOT a Durable Object migration', () => {
    // The false-alarm side of the limb above: every real config here carries
    // `migrations_dir`, and confusing the two would fail every Worker in the repo.
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(
        '  "d1_databases": [{ "binding": "APP_DB", "database_name": "a_db", "migrations_dir": "migrations" }]',
      ),
      'services/a-api/src/index.ts': 'export default { fetch: () => new Response("ok") };\n',
    });
    assert.equal(code, 0, out);
  });

  test('an empty migrations array and empty bindings are not violations', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config('  "migrations": [{ "tag": "v1", "new_classes": [] }]'),
      'services/a-api/src/index.ts': 'export default { fetch: () => new Response("ok") };\n',
    });
    assert.equal(code, 0, out);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DOMAIN. T-10's acceptance says "ANY wrangler config", and the cron limb it
// shares a requirement with cannot deliver that: listDir('services') cannot see
// a config at the repo root, under sites/ or under apps/. These are the cases
// that would have passed vacuously under that enumeration.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-no-do-alarms — the enumeration reaches outside services/', () => {
  for (const where of ['sites/edge/wrangler.jsonc', 'apps/subly/worker/wrangler.jsonc', 'infra/x/wrangler.jsonc']) {
    test(`a Durable Object under ${dirname(where)}/ is seen`, () => {
      const src = `${dirname(where)}/src/index.ts`;
      const { code, out } = withAnchor({
        [where]: config('  "durable_objects": { "bindings": [{ "name": "R", "class_name": "S" }] }'),
        [src]: 'export default { fetch: () => new Response("ok") };\n',
      });
      assert.equal(code, 1, out);
      assert.match(out, /declares 1 durable_objects binding/);
    });
  }

  test('a Mustache-braced brick path — the segments are not glob syntax', () => {
    // The brick's Worker lives under `{{#needs_backend}}services{{/needs_backend}}`
    // and the `/` in the close tag IS a path separator, so on disk that is two
    // directories. Braces are glob syntax; feeding such a path back to a matcher
    // does not mean what it looks like.
    const base = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';
    const { code, out } = withAnchor({
      [`${base}/wrangler.jsonc`]: config(),
      [`${base}/src/index.ts`]: 'export class R {\n  async alarm(): Promise<void> {}\n}\n',
    });
    assert.equal(code, 1, out);
    assert.match(out, /needs_backend/);
    assert.match(out, /declares an `alarm\(\)` handler/);
  });

  test('a config inside node_modules is not this tree', () => {
    const { code, out } = withAnchor({
      'node_modules/dep/wrangler.jsonc': config('  "durable_objects": { "bindings": [{ "name": "R" }] }'),
    });
    assert.equal(code, 0, out);
  });
});

describe('assert-no-do-alarms — COVERAGE LOST rather than a vacuous pass', () => {
  test('zero wrangler configs fails', () => {
    const { code, out } = run({ 'README.md': 'no workers here\n' });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /found ZERO wrangler configs/);
  });

  test('the anchor config missing fails, even with other configs present', () => {
    const { code, out } = run({
      'services/subly-api/wrangler.jsonc': config(),
      'services/subly-api/src/index.ts': 'export default {};\n',
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /never reached services\/platform\/wrangler\.jsonc/);
  });

  test('a Worker that declares `main` but yields no source file fails', () => {
    const { code, out } = withAnchor({ 'services/a-api/wrangler.jsonc': config() });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /declares `main`/);
  });

  test('an unparseable config is unknown, not clean', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': '{ "name": "a-api", oops }\n',
      'services/a-api/src/index.ts': 'export default {};\n',
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /not parseable/);
  });

  test('a durable_objects key of an unrecognised shape is unknown, not absent', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config('  "durable_objects": "see the dashboard"'),
      'services/a-api/src/index.ts': 'export default {};\n',
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /is not an array/);
  });

  test('a wrangler.toml is a hard failure, never a silent skip', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.toml': 'name = "a-api"\nmain = "src/index.ts"\n',
      'services/a-api/src/index.ts': 'export default {};\n',
    });
    assert.equal(code, 1);
    assert.match(out, /is a wrangler\.toml/);
    assert.match(out, /Convert it to wrangler\.jsonc/);
  });
});

describe('assert-no-do-alarms — it prints what it scanned', () => {
  test('the clean run names every config and counts the sources per Worker root', () => {
    const { code, out } = withAnchor({
      'services/a-api/wrangler.jsonc': config(),
      'services/a-api/src/index.ts': 'export default {};\n',
      'services/a-api/src/lib/util.ts': 'export const x = 1;\n',
    });
    assert.equal(code, 0, out);
    // A silently shrinking domain has to be visible in the passing output, not
    // only in the failing one — nobody reads a guard's stdout on the day it is
    // still right.
    assert.match(out, /2 wrangler config\(s\) parsed/);
    assert.match(out, /services\/platform\/wrangler\.jsonc/);
    assert.match(out, /services\/a-api\/wrangler\.jsonc=2/);
    assert.match(out, /3 Worker source file\(s\) scanned across 2 Worker root\(s\)/);
  });
});
