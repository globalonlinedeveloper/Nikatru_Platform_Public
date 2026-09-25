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
} from '../../ops/rollback.mjs';
import { PUBLISHED_ID_KEYS } from '../record-deployment.mjs';
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
function rollback(args, { deployment, statuses, cf, env = {} } = {}) {
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
    assert.equal(outputs.smoke_url, 'https://platform.nikatru.com/v1/health');
    assert.equal(outputs.smoke_expect, SHA);
    assert.equal(outputs.smoke_require_ok, 'true');
  });

  test('a WEB real run POSTs the rollback of the recorded Pages deployment, with the token, and hands the smoke its build number', () => {
    const { code, out, requests, outputs } = rollback(['--unit', 'subscriptiontracker-web', '--deployment', '9001']);
    assert.equal(code, 0, out);
    const cf = requests.filter((r) => r.host === 'api.cloudflare.com');
    assert.deepEqual(cf, [
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
      smoke_url: 'https://nikatru.com/subscriptiontracker/version.json',
      smoke_field: 'build_number',
      smoke_expect: '101',
      smoke_require_ok: 'false',
    });
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
    assert.deepEqual({ ...SMOKE.web }, { path: '/version.json', field: 'build_number', expectFrom: 'run_number', requireOk: false });
    assert.deepEqual({ ...SMOKE.service }, { path: '/v1/health', field: 'build', expectFrom: 'sha', requireOk: true });
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
      ['subscriptiontracker-api', 'platform'],
    );
    for (const s of services) {
      const target = resolveUnit(REGISTER, s.deploymentEnvironment);
      const config = readFileSync(join(ROOT, target.dir, 'wrangler.jsonc'), 'utf8');
      assert.match(config, new RegExp(`^\\s*"name"\\s*:\\s*"${s.deploymentEnvironment}"`, 'm'), target.dir);
    }
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
