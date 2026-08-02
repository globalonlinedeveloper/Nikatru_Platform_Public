// ─────────────────────────────────────────────────────────────────────────────
// worker-error-sink.test.mjs — assert-worker-error-sink.mjs must be able to FAIL.
//
// [pipeline 11]E-8 a Worker's unhandled error is captured, not console-only.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-02, FIVE).
// Every TypeScript mutation was `npx tsc --noEmit`-VERIFIED CLEAN in its own
// service before the guard was run — a compile error looks exactly like a caught
// mutation, and this repo has been fooled by that three times in one session.
// Every restore was byte-compared and re-run to the passing line.
//
//   ME1 the whole report block + import removed    -> caught: "`app.onError` does
//       from services/platform/src/index.ts's          not call `reportWorkerError(`"
//       onError (tsc clean)
//   ME2 the release switched back to               -> caught: "reads `API_VERSION`
//       `c.env.API_VERSION`, sink signature            … groups every error … into
//       widened to accept it (tsc clean)               one bucket"
//   ME3 `--var RELEASE:` deleted from the          -> caught: "the Worker reads a
//       platform deploy job                            variable no deploy sets"
//   ME4 `server_name` deleted from subly-api's     -> caught: "payload carries no
//       envelope (tsc clean)                           `server_name`"
//   ME5 the `platform` deploy job renamed          -> caught: COVERAGE LOST
//   None crashed; every one exited 1 with the intended message.
//
// 🔴 THE RED THIS RECORDS, measured at HEAD before the increment:
//   `grep -rn "sentry\|glitchtip\|toucan" services/` returned ZERO HITS while
//   the Flutter app's crashes had been reaching GlitchTip since July. Both
//   Workers' onError logged and returned 500 — and on Cloudflare Free,
//   `console.error` goes to `wrangler tail`, a LIVE STREAM with no searchable
//   history, so an unhandled error on the shared Worker (every stamped app's
//   analytics, consent, entitlement and merchant-of-record traffic) was
//   invisible the moment it happened.
//
// ⚠️ WHAT THIS FILE DOES **NOT** COVER, on purpose: the envelope's contents, its
//   privacy invariants and its fail-open paths. Those are asserted by
//   services/platform/test/error-sink.test.ts and
//   services/subly-api/test/error-sink.test.ts, which drive the REAL onError
//   through the REAL app (17 cases each). A source scan can say the wire is
//   connected and can never say what travels down it.
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
const GUARD = join(CI_DIR, 'assert-worker-error-sink.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-sink-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** An entrypoint whose onError reports. The COMMENT deliberately names both
 *  `reportWorkerError` and `API_VERSION` in prose: a scan that read raw text
 *  would be satisfied by the first and tripped by the second, and this guard
 *  strips comments precisely so neither happens. */
const INDEX = (service) => `
import { Hono } from 'hono';
import { reportWorkerError } from './lib/error-sink';
const app = new Hono();
// This Worker reports its unhandled errors with reportWorkerError, and it does
// NOT use API_VERSION as a release id. Both of those are prose.
app.get('/v1/health', (c) => c.json({ ok: true, version: c.env.API_VERSION }));
app.onError((err, c) => {
  console.error('[unhandled]', err);
  const report = reportWorkerError(
    err,
    { service: '${service}', release: c.env.RELEASE, method: c.req.method, path: new URL(c.req.url).pathname },
    c.env,
  );
  try { c.executionCtx.waitUntil(report); } catch { void report; }
  return c.json({ error: 'internal_error' }, 500);
});
export default { fetch: app.fetch };
`;

const SINK = `
export function parseDsn(dsn) { return dsn ? { endpoint: dsn, publicKey: 'k' } : null; }
export async function reportWorkerError(err, ctx, env) {
  const parsed = parseDsn(env.GLITCHTIP_DSN);
  if (!parsed) return false;
  const event = { server_name: ctx.service, release: ctx.release, level: 'error' };
  try {
    await fetch(parsed.endpoint, { method: 'POST', body: JSON.stringify(event) });
    return true;
  } catch { return false; }
}
`;

const DEPLOY_JOB = (name) => `  ${name}:
    name: Deploy ${name}
    runs-on: ubuntu-24.04
    steps:
      - uses: cloudflare/wrangler-action@abc # v3
        with:
          workingDirectory: services/${name}
          command: deploy --var GLITCHTIP_DSN:\${{ secrets.GLITCHTIP_DSN }} --var RELEASE:\${{ github.sha }}
`;

const DEPLOY = (...jobs) => `name: Deploy Workers\non: [push]\njobs:\n${jobs.join('')}`;

function makeRepo(edit = (f) => f) {
  const root = join(TMP, `r${seq++}`);
  const files = edit({
    'services/platform/src/index.ts': INDEX('platform'),
    'services/platform/src/lib/error-sink.ts': SINK,
    'services/subly-api/src/index.ts': INDEX('subly-api'),
    'services/subly-api/src/lib/error-sink.ts': SINK,
    '.github/workflows/deploy-workers.yml': DEPLOY(DEPLOY_JOB('platform'), DEPLOY_JOB('subly-api')),
  });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
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

describe('assert-worker-error-sink — the wire is connected', () => {
  test('PASSES when both Workers report and both deploys supply the vars', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2\/2 Worker\(s\) report unhandled errors to a declared sink/);
  });

  test('FAILS when a Worker has no onError at all', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/index.ts': f['services/platform/src/index.ts'].replace(/app\.onError\([\s\S]*?\n\}\);\n/, ''),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares no `app\.onError\(`/);
  });

  test('FAILS when onError logs but calls no sink — the original defect', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/subly-api/src/index.ts': f['services/subly-api/src/index.ts'].replace(
        /app\.onError\([\s\S]*?\n\}\);\n/,
        "app.onError((err, c) => {\n  console.error('[unhandled]', err);\n  return c.json({ error: 'internal_error' }, 500);\n});\n",
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`app\.onError` does not call `reportWorkerError\(`/);
  });

  test('a call OUTSIDE the handler does not satisfy the check', () => {
    // The wire must run to the handler, not merely exist in the file — the
    // "declaration counted as a caller" defect assert-seams-wired.mjs shipped
    // with, in the other direction.
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/index.ts': f['services/platform/src/index.ts']
        .replace(/app\.onError\([\s\S]*?\n\}\);\n/, "app.onError((err, c) => c.json({ error: 'internal_error' }, 500));\n")
        .concat('\nexport const unused = () => reportWorkerError(new Error("x"), {}, {});\n'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not call `reportWorkerError\(`/);
  });

  test('FAILS when the sink module is gone', () => {
    const r = run(makeRepo((f) => ({ ...f, 'services/subly-api/src/lib/error-sink.ts': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /error-sink\.ts does not exist/);
  });

  test('FAILS when the sink never leaves the isolate', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/lib/error-sink.ts': f['services/platform/src/lib/error-sink.ts'].replace(
        'await fetch(',
        'await logOnly(',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /performs no `fetch` — a sink that does not leave the isolate is a log line with more steps/);
  });
});

describe('assert-worker-error-sink — the report can be acted on', () => {
  test('FAILS when the envelope cannot say which Worker produced it', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/subly-api/src/lib/error-sink.ts': f['services/subly-api/src/lib/error-sink.ts'].replace(
        'server_name: ctx.service, ',
        '',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /payload carries no `server_name`/);
  });

  test('FAILS when the release is API_VERSION — the literal "v1" in both Workers', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/lib/error-sink.ts': f['services/platform/src/lib/error-sink.ts'].replace(
        'release: ctx.release',
        'release: env.API_VERSION',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reads `API_VERSION`/);
  });

  test('API_VERSION named only in a COMMENT is not a violation', () => {
    // The passing fixture's entrypoint comment says "does NOT use API_VERSION as
    // a release id", and its health route legitimately serves API_VERSION. If
    // either counted, the passing case could never be green.
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /reads `API_VERSION`/);
  });

  test('FAILS when the payload carries no release at all', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/src/lib/error-sink.ts': f['services/platform/src/lib/error-sink.ts'].replace(
        'release: ctx.release, ',
        '',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /payload carries no `release`/);
  });
});

describe('assert-worker-error-sink — the deploy end of the pipe', () => {
  test('FAILS when a deploy stops supplying the DSN', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      // `String.replace` with a string pattern hits the FIRST occurrence, which
      // is the `platform` job — so subly-api's stays intact and the assertion
      // below can tell the two apart.
      '.github/workflows/deploy-workers.yml': f['.github/workflows/deploy-workers.yml'].replace(
        ' --var GLITCHTIP_DSN:${{ secrets.GLITCHTIP_DSN }}',
        '',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /job `platform` does not pass `--var GLITCHTIP_DSN:`/);
    assert.doesNotMatch(r.out, /job `subly-api` does not pass `--var GLITCHTIP_DSN:`/);
  });

  test('FAILS when a deploy stops supplying the release', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      '.github/workflows/deploy-workers.yml': f['.github/workflows/deploy-workers.yml'].replaceAll(
        ' --var RELEASE:${{ github.sha }}',
        '',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not pass `--var RELEASE:`/);
  });

  test('a --var behind a `#` is prose, not a flag', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      '.github/workflows/deploy-workers.yml': f['.github/workflows/deploy-workers.yml'].replace(
        'command: deploy --var GLITCHTIP_DSN:${{ secrets.GLITCHTIP_DSN }} --var RELEASE:${{ github.sha }}',
        'command: >\n            deploy\n            # --var GLITCHTIP_DSN:${{ secrets.GLITCHTIP_DSN }}\n            --var RELEASE:${{ github.sha }}',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not pass `--var GLITCHTIP_DSN:`/);
  });

  test("the OTHER Worker's vars do not satisfy this one — the check is per job", () => {
    // The whole-file form would pass here: the workflow still contains both
    // vars, in subly-api's job.
    const r = run(makeRepo((f) => ({
      ...f,
      '.github/workflows/deploy-workers.yml': DEPLOY(
        `  platform:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: wrangler deploy\n`,
        DEPLOY_JOB('subly-api'),
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /job `platform` does not pass `--var GLITCHTIP_DSN:`/);
    assert.doesNotMatch(r.out, /job `subly-api` does not pass/);
  });
});

describe('assert-worker-error-sink — coverage self-checks', () => {
  test('COVERAGE LOST when fewer Workers are found than exist today', () => {
    const r = run(makeRepo((f) => ({ ...f, 'services/subly-api/src/index.ts': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — 1 Worker entrypoint\(s\) found/);
  });

  test('COVERAGE LOST when there is no services/ directory at all', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(root, { recursive: true });
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no services\/ directory/);
  });

  test('COVERAGE LOST when the deploy workflow is gone', () => {
    const r = run(makeRepo((f) => ({ ...f, '.github/workflows/deploy-workers.yml': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*deploy-workers\.yml does not exist/s);
  });

  test('COVERAGE LOST when a deploy job is renamed out from under the scan', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      '.github/workflows/deploy-workers.yml': f['.github/workflows/deploy-workers.yml'].replace(
        '\n  platform:\n',
        '\n  platform_deploy:\n',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*has no job named `platform`/s);
  });
});
