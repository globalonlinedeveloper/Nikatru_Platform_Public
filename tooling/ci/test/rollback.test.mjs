// ─────────────────────────────────────────────────────────────────────────────
// rollback.test.mjs — tooling/ops/rollback.mjs puts back only what the ledger
// recorded, only on the unit that recorded it, and never a database.
//
// Row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 4. Every GitHub and Cloudflare call
// is answered by a replay loaded with `--import` into the script's own process
// (the pattern deployment-record.test.mjs uses, for the same reason: spawnSync
// blocks this process, so no server here could answer). Anything the replay
// does not name throws — this file reaches no network.
//
// NOT covered here: the Worker path's real run. It spawns the wrangler island's
// binary, which would reach Cloudflare; its command is asserted through
// --dry-run instead.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveUnit,
  planRollback,
  payloadOf,
  commandFor,
  rollbackMessage,
  databaseNames,
  Refusal,
  SMOKE,
  SMOKE_SCRIPTS,
  smokeArgv,
  smokeFromEnv,
  floorsFor,
  floorVerdict,
  FLOORS_REL,
} from '../../ops/rollback.mjs';
import { PUBLISHED_ID_KEYS, PUBLISHED_ID_FLAGS, ROLLBACK_KINDS, rollbackRecord } from '../record-deployment.mjs';
import { parseWorkflow, workflowSteps } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'tooling', 'ops', 'rollback.mjs');
const REGISTER = JSON.parse(readFileSync(join(ROOT, 'tooling', 'channel-register.json'), 'utf8'));

const SHA = '0123456789abcdef0123456789abcdef01234567';
const PAGES_ID = '3f2b8c1a-5d4e-4f60-8a7b-9c0d1e2f3a4b';
const WORKER_ID = '5f0e7a52-1c3b-4d2e-9f60-7a8b9c0d1e2f';
/** Made-up values. The token is asserted on the wire, so it must be one. */
const CF_TOKEN = 'made-up-cloudflare-token';
const CF_ACCOUNT = '0123456789abcdef0123456789abcdef';

const webDeployment = (payload, environment = 'subscriptiontracker-web') => ({
  id: 9001,
  sha: SHA,
  environment,
  payload,
});
const WEB_PAYLOAD = {
  workflow: 'deploy-web.yml',
  run_id: 35700000101,
  run_attempt: 1,
  run_number: 101,
  pages_deployment_id: PAGES_ID,
  worker_version_id: null,
};
const WORKER_PAYLOAD = {
  workflow: 'deploy-workers.yml',
  run_id: 35700000202,
  run_attempt: 1,
  run_number: 202,
  pages_deployment_id: null,
  worker_version_id: WORKER_ID,
};
const WEB_STATUSES = [{ state: 'success', environment_url: 'https://nikatru.com/subscriptiontracker/' }];
const WORKER_STATUSES = [{ state: 'success', environment_url: 'https://platform.nikatru.com' }];
// ⏱ 2026-10-01 · PB-07: the apex site's record, as deploy-web.yml's `site` job now writes it.
const SITE_PAYLOAD = { ...WEB_PAYLOAD, run_number: 303, run_id: 35700000303 };
const SITE_STATUSES = [{ state: 'success', environment_url: 'https://nikatru.com' }];
const SHIELD_STATUSES = [{ state: 'success', environment_url: 'https://auth-api.nikatru.com' }];

let TMP;
let REPLAY;
let seq = 0;

/** Serialised into a file and loaded with `--import`, into the script's process. */
function rollbackReplay(appendFileSync) {
  const log = process.env.ROLLBACK_REPLAY_LOG;
  const json = (body, code) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const { host, pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    if (log) appendFileSync(log, `${JSON.stringify({ method, host, pathname, authorization: headers.authorization ?? null })}\n`);
    if (host === 'api.github.com' && method === 'GET' && /^\/repos\/x\/y\/deployments\/9001$/.test(pathname)) {
      return json(JSON.parse(process.env.ROLLBACK_REPLAY_DEPLOYMENT), 200);
    }
    if (host === 'api.github.com' && method === 'GET' && /^\/repos\/x\/y\/deployments\/9001\/statuses$/.test(pathname)) {
      return json(JSON.parse(process.env.ROLLBACK_REPLAY_STATUSES ?? '[]'), 200);
    }
    // PB-09: the project read that decides "already live". Its production deployment is
    // ANOTHER build unless the test names one.
    if (host === 'api.cloudflare.com' && method === 'GET' && /\/pages\/projects\/[^/]+$/.test(pathname)) {
      const project = JSON.parse(process.env.ROLLBACK_REPLAY_CF_PROJECT ?? '{"canonical_deployment":{"id":"00000000-0000-4000-8000-000000000000"}}');
      return json({ success: true, errors: [], result: project }, 200);
    }
    // ⏱ 2026-10-02 · the rollback floor asks `compare/<floor>...<sha>`; `ahead` unless a case says otherwise.
    if (host === 'api.github.com' && method === 'GET' && /^\/repos\/x\/y\/compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/.test(pathname)) {
      const status = process.env.ROLLBACK_REPLAY_COMPARE ?? 'ahead';
      return status === 'HTTP404' ? json({ message: 'Not Found' }, 404) : json({ status }, 200);
    }
    if (host === 'api.cloudflare.com' && method === 'POST' && /\/pages\/projects\/[^/]+\/deployments\/[^/]+\/rollback$/.test(pathname)) {
      const cf = JSON.parse(process.env.ROLLBACK_REPLAY_CF ?? '{"success":true,"errors":[],"result":{}}');
      return json(cf, cf.success ? 200 : 400);
    }
    throw new Error(`[replay] unreplayed request ${method} ${url} — this test file must reach no network`);
  };
}

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'rollback-test-'));
  REPLAY = join(TMP, 'rollback-replay.mjs');
  writeFileSync(REPLAY, `import { appendFileSync } from 'node:fs';\n(${rollbackReplay.toString()})(appendFileSync);\n`);
});
after(() => rmSync(TMP, { recursive: true, force: true }));

/** Run the real script against the replay; every request it made, and every
 *  output it wrote, is read back rather than described. */
function rollback(args, { deployment, statuses, cf, cfProject, env = {} } = {}) {
  const n = seq++;
  const log = join(TMP, `requests-${n}.log`);
  const output = join(TMP, `github-output-${n}`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(REPLAY).href, SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'x/y',
      GH_TOKEN: 'made-up-github-token',
      GITHUB_API_URL: '',
      GITHUB_RUN_ID: '35800000001',
      GITHUB_OUTPUT: output,
      CLOUDFLARE_API_TOKEN: CF_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT,
      ROLLBACK_REPLAY_LOG: log,
      ROLLBACK_REPLAY_DEPLOYMENT: JSON.stringify(deployment ?? webDeployment(WEB_PAYLOAD)),
      ROLLBACK_REPLAY_STATUSES: JSON.stringify(statuses ?? WEB_STATUSES),
      ...(cf ? { ROLLBACK_REPLAY_CF: JSON.stringify(cf) } : {}),
      ...(cfProject ? { ROLLBACK_REPLAY_CF_PROJECT: JSON.stringify(cfProject) } : {}),
      ...env,
    },
  });
  const requests = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const outputs = existsSync(output)
    ? Object.fromEntries(
        readFileSync(output, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    : {};
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, requests, outputs };
}

describe('rollback.mjs — refuses before it reads anything', () => {
  test('a DATABASE unit, by its database_name, is refused and named as revert.d1.schema — no request is made', () => {
    const { code, out, requests } = rollback(['--unit', 'platform_db', '--deployment', '9001']);
    assert.equal(code, 1, out);
    assert.match(out, /D1 schema is never rolled back/);
    assert.match(out, /revert\.d1\.schema/);
    assert.deepEqual(requests, []);
  });

  test('a DATABASE unit, by the word, is refused — no request is made', () => {
    const { code, out, requests } = rollback(['--unit', 'd1', '--deployment', '9001']);
    assert.equal(code, 1, out);
    assert.match(out, /D1 schema is never rolled back/);
    assert.deepEqual(requests, []);
  });

  test('a STORE channel is refused: the store holds that build, not this lane', () => {
    const { code, out, requests } = rollback(['--unit', 'subscriptiontracker-android-play', '--deployment', '9001']);
    assert.equal(code, 1, out);
    assert.match(out, /kind: store\), which is not re-promoted here/);
    assert.deepEqual(requests, []);
  });

  test('a unit no register row claims is refused', () => {
    const { code, out, requests } = rollback(['--unit', 'nonesuch', '--deployment', '9001']);
    assert.equal(code, 1, out);
    assert.match(out, /no row in tooling\/channel-register\.json claims the unit "nonesuch"/);
    assert.deepEqual(requests, []);
  });

  test('a --deployment that is not a whole number is refused', () => {
    const { code, out, requests } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', 'latest']);
    assert.equal(code, 1, out);
    assert.match(out, /--deployment "latest" is not a ledger Deployment id/);
    assert.deepEqual(requests, []);
  });

  test('a missing --deployment prints the usage and exits 1', () => {
    const { code, out } = rollback(['--unit', 'subscriptiontracker-web']);
    assert.equal(code, 1, out);
    assert.match(out, /usage: rollback\.mjs --unit/);
  });
});

describe('rollback.mjs — re-promotes only what the ledger recorded', () => {
  test('RC11: a record that names NO Pages deployment is "nothing to re-promote", exit 1, and Cloudflare is never called', () => {
    const { code, out, requests } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      deployment: webDeployment({ ...WEB_PAYLOAD, pages_deployment_id: null }),
    });
    assert.equal(code, 1, out);
    assert.match(out, /nothing to re-promote: ledger Deployment 9001 \(01234567 on subscriptiontracker-web\) names no pages_deployment_id/);
    assert.deepEqual(
      requests.map((r) => r.host),
      ['api.github.com', 'api.github.com'],
    );
  });

  test('a record written before the ids existed — no payload at all — is "nothing to re-promote"', () => {
    const { code, out } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      deployment: webDeployment(''),
    });
    assert.equal(code, 1, out);
    assert.match(out, /nothing to re-promote/);
  });

  test('a record on ANOTHER unit is refused: a Deployment goes back only onto the unit that recorded it', () => {
    const { code, out, requests } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      deployment: webDeployment(WEB_PAYLOAD, 'otherapp-web'),
    });
    assert.equal(code, 1, out);
    assert.match(out, /is on "otherapp-web", not "subscriptiontracker-web"/);
    assert.ok(!requests.some((r) => r.host === 'api.cloudflare.com'));
  });

  test('a record that is itself a re-promotion is refused: its run number is the rollback run, not the build', () => {
    const { code, out } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      deployment: webDeployment({ ...WEB_PAYLOAD, rollback: true, rollback_of: 8800 }),
    });
    assert.equal(code, 1, out);
    assert.match(out, /is itself a re-promotion, of ledger Deployment 8800. Name that one/);
  });

  test('a record with no success status is refused: it never went live, so it is not known-good', () => {
    const { code, out } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      statuses: [{ state: 'failure', environment_url: 'https://nikatru.com/subscriptiontracker/' }],
    });
    assert.equal(code, 1, out);
    assert.match(out, /has no success status/);
  });

  test('--dry-run on a WEB unit prints the exact call, writes the outputs, and never calls Cloudflare', () => {
    const { code, out, requests, outputs } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001', '--dry-run']);
    assert.equal(code, 0, out);
    assert.ok(
      out.includes(
        `$ curl -fsS -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" ` +
          `"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/subscriptiontracker/deployments/${PAGES_ID}/rollback"`,
      ),
      out,
    );
    assert.ok(!out.includes(CF_TOKEN) && !out.includes(CF_ACCOUNT), 'the printed command names variables, never values');
    assert.ok(!requests.some((r) => r.host === 'api.cloudflare.com'));
    assert.equal(outputs.dry_run, 'true');
    assert.equal(outputs.sha, SHA);
  });

  test('--dry-run on a SERVICE unit prints the exact wrangler rollback, run from the service directory', () => {
    const { code, out, outputs } = rollback(['--unit', 'platform', '--deployment', '9001', '--dry-run'], {
      deployment: { id: 9001, sha: SHA, environment: 'platform', payload: WORKER_PAYLOAD },
      statuses: WORKER_STATUSES,
    });
    assert.equal(code, 0, out);
    assert.ok(
      out.includes(
        `$ (cd services/platform && ../../tooling/wrangler/node_modules/.bin/wrangler rollback ${WORKER_ID} ` +
          '--message "rollback.yml run 35800000001: ledger Deployment 9001 (01234567)" --yes)',
      ),
      out,
    );
    assert.equal(outputs.id_flag, '--worker-version-id');
    assert.equal(outputs.id, WORKER_ID);
    assert.equal(outputs.smoke_script, 'tooling/ops/post-deploy-smoke.mjs');
    assert.deepEqual(JSON.parse(outputs.smoke_args), ['--url', 'https://platform.nikatru.com/v1/health', '--field', 'build', '--expect', SHA, '--require-ok']);
  });

  // ⏱ 2026-10-01 · PB-07 (row O-APEX-SITE-HAS-NO-ROLLBACK). RED without the patch: a `site`
  // unit was refused by kind, so the apex had no way back but the paused Git project.
  test('🔴 PB-07 — --dry-run on the SITE unit prints the Pages rollback on nikatru-apex and hands over the site\'s own smoke', () => {
    const { code, out, requests, outputs } = rollback(['--unit', 'nikatru-site', '--deployment', '9001', '--dry-run'], {
      deployment: webDeployment(SITE_PAYLOAD, 'nikatru-site'),
      statuses: SITE_STATUSES,
    });
    assert.equal(code, 0, out);
    assert.ok(
      out.includes(`/pages/projects/nikatru-apex/deployments/${PAGES_ID}/rollback"`),
      out,
    );
    assert.ok(!requests.some((r) => r.host === 'api.cloudflare.com'));
    assert.equal(outputs.unit, 'nikatru-site');
    assert.equal(outputs.kind, 'site');
    assert.equal(outputs.id_flag, '--pages-deployment-id');
    assert.equal(outputs.smoke_script, 'tooling/sites/smoke-site-deploy.mjs');
    assert.deepEqual(JSON.parse(outputs.smoke_args), ['--origin', 'https://nikatru.com', '--expect-sha', SHA]);
  });

  test('🔴 PB-07 — a SITE real run POSTs the rollback on the row\'s Direct Upload project, never the paused Git one', () => {
    const { code, out, requests } = rollback(['--unit', 'nikatru-site', '--deployment', '9001'], {
      deployment: webDeployment(SITE_PAYLOAD, 'nikatru-site'),
      statuses: SITE_STATUSES,
    });
    assert.equal(code, 0, out);
    assert.deepEqual(
      requests.filter((r) => r.host === 'api.cloudflare.com').map((r) => `${r.method} ${r.pathname}`),
      [
        `GET /client/v4/accounts/${CF_ACCOUNT}/pages/projects/nikatru-apex`,
        `POST /client/v4/accounts/${CF_ACCOUNT}/pages/projects/nikatru-apex/deployments/${PAGES_ID}/rollback`,
      ],
    );
  });

  // ⏱ 2026-10-01 · PB-08 (row O-EDGE-SHIELD-ROLLBACK-SMOKE-MISFIT). RED without the patch: the
  // shield was handed the service smoke, `/v1/health --field build`, which it has no route for.
  test('🔴 PB-08 — the EDGE SHIELD unit is handed ITS OWN smoke from the register, joined to the recorded SHA', () => {
    const { code, out, outputs } = rollback(['--unit', 'edge-shield', '--deployment', '9001', '--dry-run'], {
      deployment: { id: 9001, sha: SHA, environment: 'edge-shield', payload: WORKER_PAYLOAD },
      statuses: SHIELD_STATUSES,
    });
    assert.equal(code, 0, out);
    assert.match(out, /\(cd services\/edge-shield && \.\.\/\.\.\/tooling\/wrangler\/node_modules\/\.bin\/wrangler rollback /);
    assert.equal(outputs.smoke_script, 'tooling/ops/check-edge-shield.mjs');
    assert.deepEqual(JSON.parse(outputs.smoke_args), ['--settle', '--expect-release', SHA]);
  });

  test('a WEB real run POSTs the rollback of the recorded Pages deployment, with the token, and hands the smoke its build number', () => {
    const { code, out, requests, outputs } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001']);
    assert.equal(code, 0, out);
    const cf = requests.filter((r) => r.host === 'api.cloudflare.com');
    assert.deepEqual(cf, [
      {
        method: 'GET',
        host: 'api.cloudflare.com',
        pathname: `/client/v4/accounts/${CF_ACCOUNT}/pages/projects/subscriptiontracker`,
        authorization: `Bearer ${CF_TOKEN}`,
      },
      {
        method: 'POST',
        host: 'api.cloudflare.com',
        pathname: `/client/v4/accounts/${CF_ACCOUNT}/pages/projects/subscriptiontracker/deployments/${PAGES_ID}/rollback`,
        authorization: `Bearer ${CF_TOKEN}`,
      },
    ]);
    assert.deepEqual(outputs, {
      dry_run: 'false',
      unit: 'subscriptiontracker-web',
      kind: 'web',
      sha: SHA,
      id_flag: '--pages-deployment-id',
      id: PAGES_ID,
      environment_url: 'https://nikatru.com/subscriptiontracker',
      smoke_script: 'tooling/ops/post-deploy-smoke.mjs',
      smoke_args: JSON.stringify(['--url', 'https://nikatru.com/subscriptiontracker/version.json', '--field', 'build_number', '--expect', '101']),
    });
  });

  // ⏱ 2026-10-02 · PB-09 drill (row O-PAGES-REPROMOTE-OF-LIVE-BUILD-REFUSED). Runs 36970520119
  // (nikatru-site) and 36970542712 (subscriptiontracker-web) re-promoted the newest record and
  // went red on Cloudflare's 8000039. RED without the patch: the POST is made and refused.
  const LIVE_OUTPUTS = (unit, kind, environmentUrl, smokeScript, smokeArgs) => ({
    dry_run: 'false',
    unit,
    kind,
    sha: SHA,
    id_flag: '--pages-deployment-id',
    id: PAGES_ID,
    environment_url: environmentUrl,
    smoke_script: smokeScript,
    smoke_args: JSON.stringify(smokeArgs),
  });
  const WEB_LIVE_OUTPUTS = LIVE_OUTPUTS('subscriptiontracker-web', 'web', 'https://nikatru.com/subscriptiontracker', 'tooling/ops/post-deploy-smoke.mjs', [
    '--url', 'https://nikatru.com/subscriptiontracker/version.json', '--field', 'build_number', '--expect', '101',
  ]);
  const REFUSED_AS_LIVE = { success: false, errors: [{ code: 8000039, message: 'You cannot rollback to the deployment that is currently in production.' }] };

  test('🔴 PB-09 — a WEB target that is already the production deployment is "already live", makes NO POST, and writes the re-promotion\'s outputs', () => {
    const { code, out, requests, outputs } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      cfProject: { canonical_deployment: { id: PAGES_ID.toUpperCase() } },
      cf: REFUSED_AS_LIVE,
    });
    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`^already live: ${PAGES_ID}$`, 'm'));
    assert.deepEqual(requests.filter((r) => r.method === 'POST'), []);
    assert.deepEqual(outputs, WEB_LIVE_OUTPUTS);
  });

  test('🔴 PB-09 — the SITE unit already live on nikatru-apex is the same no-op, with the site\'s own smoke', () => {
    const { code, out, requests, outputs } = rollback(['--unit', 'nikatru-site', '--deployment', '9001'], {
      deployment: webDeployment(SITE_PAYLOAD, 'nikatru-site'),
      statuses: SITE_STATUSES,
      cfProject: { canonical_deployment: { id: PAGES_ID } },
      cf: REFUSED_AS_LIVE,
    });
    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`^already live: ${PAGES_ID}$`, 'm'));
    assert.deepEqual(
      requests.filter((r) => r.host === 'api.cloudflare.com').map((r) => `${r.method} ${r.pathname}`),
      [`GET /client/v4/accounts/${CF_ACCOUNT}/pages/projects/nikatru-apex`],
    );
    assert.deepEqual(outputs, LIVE_OUTPUTS('nikatru-site', 'site', 'https://nikatru.com', 'tooling/sites/smoke-site-deploy.mjs', ['--origin', 'https://nikatru.com', '--expect-sha', SHA]));
  });

  test('🔴 PB-09 — Cloudflare answering 8000039 (live between the read and the POST) is the same no-op success, never a failure', () => {
    const { code, out, requests, outputs } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      cf: REFUSED_AS_LIVE,
    });
    assert.equal(code, 0, out);
    assert.equal(requests.filter((r) => r.method === 'POST').length, 1, 'the read named another build, so the POST was made');
    assert.match(out, new RegExp(`^already live: ${PAGES_ID}$`, 'm'));
    assert.doesNotMatch(out, /Cloudflare refused/);
    assert.deepEqual(outputs, WEB_LIVE_OUTPUTS);
  });

  test('Cloudflare refusing the rollback is exit 1, its errors named, and no output is written', () => {
    const { code, out, outputs } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001'], {
      cf: { success: false, errors: [{ code: 8000009, message: 'made-up refusal' }] },
    });
    assert.equal(code, 1, out);
    assert.match(out, /Cloudflare refused the Pages rollback \(HTTP 400\): 8000009: made-up refusal\. Nothing was re-promoted\./);
    assert.deepEqual(outputs, {});
  });
});

describe('rollback.mjs — the pure helpers', () => {
  test('the id keys it reads are the ones the recorder writes', () => {
    assert.deepEqual(
      [resolveUnit(REGISTER, 'subscriptiontracker-web').idKey, resolveUnit(REGISTER, 'platform').idKey],
      [...PUBLISHED_ID_KEYS],
    );
  });

  test('payloadOf reads a JSON-string payload, and treats junk as empty', () => {
    assert.deepEqual(payloadOf({ payload: '{"run_number":7}' }), { run_number: 7 });
    assert.deepEqual(payloadOf({ payload: 'not json' }), {});
    assert.deepEqual(payloadOf({}), {});
  });

  test('planRollback: a WEB record with no run_number is refused — the smoke could not tell builds apart', () => {
    const target = resolveUnit(REGISTER, 'subscriptiontracker-web');
    const { run_number: _dropped, ...noRun } = WEB_PAYLOAD;
    assert.throws(() => planRollback(target, webDeployment(noRun), WEB_STATUSES, '9001'), Refusal);
  });

  test('planRollback: an id that is not an id is refused, not passed to Cloudflare', () => {
    const target = resolveUnit(REGISTER, 'subscriptiontracker-web');
    assert.throws(
      () => planRollback(target, webDeployment({ ...WEB_PAYLOAD, pages_deployment_id: 'latest' }), WEB_STATUSES, '9001'),
      /is not an id/,
    );
  });

  test('the smoke each kind runs is the one its deploy runs', () => {
    assert.deepEqual(SMOKE.web.args, ['--url', '{url}/version.json', '--field', 'build_number', '--expect', '{run_number}']);
    assert.deepEqual(SMOKE.service.args, ['--url', '{url}/v1/health', '--field', 'build', '--expect', '{sha}', '--require-ok']);
    assert.deepEqual(SMOKE.site.args, ['--origin', '{url}', '--expect-sha', '{sha}']);
    for (const k of Object.keys(SMOKE)) assert.ok(SMOKE_SCRIPTS.includes(SMOKE[k].script), k);
  });

  test('🔴 RED CONTROL — a per-unit smoke naming a script the lane does not run is refused, never run', () => {
    const plan = { url: 'https://auth-api.nikatru.com', sha: SHA, runNumber: 1 };
    assert.throws(() => smokeArgv({ script: 'tooling/ops/rollback.mjs', args: [] }, plan, '9001'), /is not one of/);
    assert.throws(() => smokeArgv({ script: SMOKE_SCRIPTS[0], args: ['{secret}'] }, plan, '9001'), /placeholder \{secret\}/);
    assert.throws(() => smokeArgv({ script: SMOKE_SCRIPTS[0], args: [7] }, plan, '9001'), /not a list of strings/);
    assert.throws(() => smokeArgv(SMOKE.service, { ...plan, sha: 'not a sha!' }, '9001'), /names no sha/);
  });

  test('--run-smoke reads back only an allow-listed script and a JSON list of strings', () => {
    assert.deepEqual(smokeFromEnv({ SMOKE_SCRIPT: SMOKE_SCRIPTS[2], SMOKE_ARGS: '["--settle"]' }), { script: SMOKE_SCRIPTS[2], args: ['--settle'] });
    assert.throws(() => smokeFromEnv({ SMOKE_SCRIPT: 'tooling/ops/rollback.mjs', SMOKE_ARGS: '[]' }), /nothing was run/);
    assert.throws(() => smokeFromEnv({ SMOKE_SCRIPT: SMOKE_SCRIPTS[0], SMOKE_ARGS: '--url x' }), /not a JSON list of strings/);
  });

  test('--run-smoke RUNS the unit\'s smoke and exits with ITS code (here 2: the shield probe could not look, before any request)', () => {
    const empty = join(TMP, 'no-edge-config');
    const { code, out } = rollback(['--run-smoke'], {
      env: { SMOKE_SCRIPT: 'tooling/ops/check-edge-shield.mjs', SMOKE_ARGS: JSON.stringify(['--root', empty, '--expect-release', SHA]) },
    });
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — services\/edge-shield\/wrangler\.jsonc does not exist/);
  });

  test('--run-smoke refuses a script outside the list, exit 1, and runs nothing', () => {
    const { code, out } = rollback(['--run-smoke'], { env: { SMOKE_SCRIPT: 'tooling/ops/rollback.mjs', SMOKE_ARGS: '[]' } });
    assert.equal(code, 1, out);
    assert.match(out, /is not one of .*nothing was run/);
  });

  test('🔴 PB-07 — a site row with no `pagesProject` is refused: there is nothing to put a deployment back on', () => {
    const register = structuredClone(REGISTER);
    delete register.siteEnvironments.find((r) => r.deploymentEnvironment === 'nikatru-site').pagesProject;
    assert.throws(() => resolveUnit(register, 'nikatru-site'), /names no `pagesProject`/);
  });

  test('🔴 PB-07 — the recorder takes the site\'s Pages deployment id, and records a re-promotion of a site', () => {
    assert.ok(ROLLBACK_KINDS.includes('site'));
    assert.deepEqual([...PUBLISHED_ID_FLAGS.site], ['pages-deployment-id']);
    assert.equal(rollbackRecord('site', '9001', SHA).refusal, null);
  });

  test('the Worker rollback message fits wrangler\'s 120 characters, even with a long run id', () => {
    const m = rollbackMessage('123456789012', SHA, '9'.repeat(200));
    assert.equal(m.length, 120);
    assert.equal(rollbackMessage('9001', SHA, undefined), 'rollback.yml: ledger Deployment 9001 (01234567)');
  });

  test('commandFor never writes a credential value into the web command', () => {
    const target = resolveUnit(REGISTER, 'subscriptiontracker-web');
    const cmd = commandFor(target, { id: PAGES_ID }, '');
    assert.match(cmd, /\$CLOUDFLARE_API_TOKEN/);
    assert.match(cmd, /\$CLOUDFLARE_ACCOUNT_ID/);
  });
});

// ⏱ 2026-10-02 · #1104 post-merge review, finding 1: no build before 117bd66e may go back live on
// platform, because it reads the sealed rows' '' as a token. The floor is DATA, asked of GitHub.
describe('rollback.mjs — the floor (tooling/ops/rollback-floors.json)', () => {
  const platformRun = (compare, extra = []) =>
    rollback(['--unit', 'platform', '--deployment', '9001', ...extra], {
      deployment: { id: 9001, sha: SHA, environment: 'platform', payload: WORKER_PAYLOAD },
      statuses: WORKER_STATUSES,
      env: compare === undefined ? {} : { ROLLBACK_REPLAY_COMPARE: compare },
    });

  test('GREEN CONTROL: a recorded commit AHEAD of the floor passes it, and says so', () => {
    const { code, out, requests } = platformRun('ahead', ['--dry-run']);
    assert.equal(code, 0, out);
    assert.match(out, /floor: 01234567 is at or after 117bd66e \(O-PROVIDER-REFRESH-TOKENS-STORED-PLAIN\) — compare says ahead/);
    assert.ok(requests.some((r) => /\/compare\/117bd66ecb846decb743426d80f5124b59131601\.\.\.0123456789abcdef/.test(r.pathname)));
  });

  /** One refused compare answer: exit 1 before any re-promotion, on a dry run and a real run alike. */
  const assertRefused = (status, said) => {
    for (const extra of [['--dry-run'], []]) {
      const { code, out, requests, outputs } = platformRun(status, extra);
      assert.equal(code, 1, out);
      assert.match(out, said);
      assert.match(out, /O-PROVIDER-REFRESH-TOKENS-STORED-PLAIN/);
      assert.doesNotMatch(out, /\$ \(cd services\/platform/, 'the rollback command was printed past a refused floor');
      assert.ok(!requests.some((r) => r.host === 'api.cloudflare.com'));
      assert.deepEqual(outputs, {}, 'outputs were written past a refused floor');
    }
  };
  test('🔴 RED CONTROL: compare "behind" (older than the floor) REFUSES, exit 1, before any re-promotion — a dry run included', () => {
    assertRefused('behind', /is OLDER than the floor 117bd66e/);
  });
  test('🔴 RED CONTROL: compare "diverged" REFUSES, exit 1, before any re-promotion — a dry run included', () => {
    assertRefused('diverged', /is not a descendant of the floor 117bd66e/);
  });
  test('🔴 RED CONTROL: an unreadable compare (HTTP 404) REFUSES, exit 1 — a floor it cannot prove is met is not met', () => {
    assertRefused('HTTP404', /could not be placed against the floor 117bd66e/);
  });

  test('a unit with no floor asks GitHub nothing about ancestry', () => {
    const { code, out, requests } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001', '--dry-run'], { env: { ROLLBACK_REPLAY_COMPARE: 'behind' } });
    assert.equal(code, 0, out);
    assert.ok(!requests.some((r) => /\/compare\//.test(r.pathname)));
  });

  test('the pure helpers: a malformed floor is a Refusal, never "no floor"; only ahead or identical pass', () => {
    assert.throws(() => floorsFor({}, 'platform'), Refusal);
    assert.throws(() => floorsFor({ floors: [{ unit: 'platform', sha: '117bd66e', why: 'a short sha is not a floor at all' }] }, 'platform'), /full commit "sha"/);
    const floor = { unit: 'platform', sha: 'a'.repeat(40), since: '2026-10-01', row: 'O-X', why: 'fixture floor with a reason' };
    assert.equal(floorVerdict(floor, SHA, 'ahead'), null);
    assert.equal(floorVerdict(floor, SHA, 'identical'), null);
    for (const s of ['behind', 'diverged', undefined, 'unreadable: boom']) assert.match(floorVerdict(floor, SHA, s), /floor aaaaaaaa/);
  });

  test('THE REAL FILE: platform\'s floor is 117bd66e, the first build that seals provider tokens', () => {
    const doc = JSON.parse(readFileSync(join(ROOT, FLOORS_REL), 'utf8'));
    const floors = floorsFor(doc, 'platform');
    assert.deepEqual(floors.map((f) => f.sha), ['117bd66ecb846decb743426d80f5124b59131601']);
  });
});

describe('rollback.mjs — THE REAL TREE', () => {
  test('every D1 database the services bind is refused by name', () => {
    const names = databaseNames(ROOT);
    assert.ok(names.has('platform_db') && names.has('subscriptiontracker_db'), [...names].join(', '));
    assert.ok(names.has('PLATFORM_DB') && names.has('APP_DB'), [...names].join(', '));
    assert.throws(() => resolveUnit(REGISTER, 'subscriptiontracker_db', names), /D1 schema is never rolled back/);
  });

  test('each service\'s wrangler config names the Worker its ledger environment names — the rollback runs from that directory with no --name', () => {
    const services = REGISTER.serviceEnvironments;
    assert.deepEqual(
      services.map((s) => s.deploymentEnvironment),
      // ⏱ 2026-09-27 (SHIELD-F6): the edge shield is a service unit too. It has no /v1/health;
      // since 2026-10-01 (PB-08) its register row names its own smoke, graded below.
      ['subscriptiontracker-api', 'platform', 'edge-shield'],
    );
    for (const s of services) {
      const target = resolveUnit(REGISTER, s.deploymentEnvironment);
      const config = readFileSync(join(ROOT, target.dir, 'wrangler.jsonc'), 'utf8');
      assert.match(config, new RegExp(`^\\s*"name"\\s*:\\s*"${s.deploymentEnvironment}"`, 'm'), target.dir);
    }
  });

  // PB-07/PB-08: a re-promotion is judged the way the unit's DEPLOY judges it. Read off the
  // deploy workflows, `${{ github.sha }}` read as `{sha}`: an edit to either side reds this.
  test('every site and per-unit smoke the lane runs is, argument for argument, the one its deploy job runs', () => {
    const deploySmoke = (wfRel, job, script) => {
      const wf = parseWorkflow(ROOT, wfRel);
      const step = workflowSteps(wf.jobs.get(job)).find((s) => (s.run?.text ?? '').includes(`node ${script} `));
      assert.ok(step, `${wfRel} job ${job} runs no ${script}`);
      return step.run.text.replace(/\$\{\{\s*github\.sha\s*\}\}/g, '{sha}').trim().split(/\s+/).slice(2);
    };
    const shield = resolveUnit(REGISTER, 'edge-shield').smoke;
    assert.deepEqual(shield.args, deploySmoke('.github/workflows/deploy-workers.yml', 'edge-shield', shield.script));
    const site = resolveUnit(REGISTER, 'nikatru-site').smoke;
    assert.deepEqual(
      site.args.map((a) => a.replace('{url}', 'https://nikatru.com')),
      deploySmoke('.github/workflows/deploy-web.yml', 'site', site.script),
    );
  });

  test('deploy-web.yml\'s `site` job records the Pages deployment it published, from the deploy step\'s output', () => {
    const wf = parseWorkflow(ROOT, '.github/workflows/deploy-web.yml');
    const record = workflowSteps(wf.jobs.get('site')).find((s) => /record-deployment\.mjs nikatru-site /.test(s.run?.text ?? ''));
    assert.ok(record, 'the site job records no nikatru-site Deployment');
    assert.match(record.run.text, /--pages-deployment-id "\$PAGES_DEPLOYMENT_ID"/);
    assert.match(record.env.get('PAGES_DEPLOYMENT_ID')?.value ?? '', /^\$\{\{\s*steps\.deploy\.outputs\.pages-deployment-id\s*\}\}$/);
  });

  test('rollback.yml runs the unit\'s own smoke through --run-smoke, from the re-promotion\'s outputs', () => {
    const wf = parseWorkflow(ROOT, '.github/workflows/rollback.yml');
    const steps = workflowSteps(wf.jobs.get('rollback'));
    const smoke = steps.find((s) => /node tooling\/ops\/rollback\.mjs --run-smoke\s*$/.test(s.run?.text ?? ''));
    assert.ok(smoke, 'rollback.yml has no `node tooling/ops/rollback.mjs --run-smoke` step');
    assert.match(smoke.env.get('SMOKE_SCRIPT')?.value ?? '', /^\$\{\{\s*steps\.rollback\.outputs\.smoke_script\s*\}\}$/);
    assert.match(smoke.env.get('SMOKE_ARGS')?.value ?? '', /^\$\{\{\s*steps\.rollback\.outputs\.smoke_args\s*\}\}$/);
    assert.equal(smoke.cond, "steps.rollback.outputs.dry_run == 'false'", 'the smoke runs only after a real re-promotion');
  });

  // No guard grades these two: workflow-scan.mjs's PUBLISH matches no rollback.mjs,
  // so assert-workflow-hardening.mjs limb 10 does not count rollback.yml — and it
  // must not, because a rollback re-promotes an already-gated build outside the
  // gate. The ref check is matched with limb 10's own REF_CHECK shape.
  test('rollback.yml holds limb 10\'s two halves: a job-level `environment: production`, and the ref check as the first step after checkout, before the re-promotion', () => {
    const wf = parseWorkflow(ROOT, '.github/workflows/rollback.yml');
    assert.ok(wf, '.github/workflows/rollback.yml is not on disk');
    const job = wf.jobs.get('rollback');
    assert.ok(job, 'rollback.yml has no job `rollback`');
    assert.ok(
      job.lines.some((l) => /^ {4}environment:\s*production\s*$/.test(l.text)),
      'job `rollback` declares no job-level `environment: production`: nothing holds it before a step runs',
    );
    const REF_CHECK = /(?:^|\s)node\s+(?:\.\/)?tooling\/ci\/assert-deploy-ref\.mjs(?=\s|$)/;
    const steps = workflowSteps(job);
    let k = 0;
    for (; k < steps.length && /^actions\/checkout@/.test(steps[k].uses ?? ''); k++);
    assert.ok(k >= 1, 'job `rollback` has no actions/checkout: the ref check is not on disk');
    const first = steps[k];
    assert.ok(first && REF_CHECK.test(first.run?.text ?? ''), `step ${k + 1} of job \`rollback\` is not the ref check`);
    assert.match(first.run.text, /\s--allow\s+main(?=\s|$)/, 'the ref check does not allow main, and main only');
    const repromote = steps.findIndex((s) => /(?:^|\s)node\s+(?:\.\/)?tooling\/ops\/rollback\.mjs(?=\s|$)/.test(s.run?.text ?? ''));
    assert.ok(repromote > k, `the re-promotion (step ${repromote + 1}) does not come after the ref check (step ${k + 1})`);
  });
});
