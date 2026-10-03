// play-data-safety.test.mjs — tooling/release/play-data-safety.mjs renders Play's
// Data safety CSV from the sworn data-safety.json, and declares it by API.
//
// The golden is the render of the REAL data-safety.json for the posture
// assert-play-declarations confirms against the .aab lane; a change to an answer,
// to PLAY_ID_MAP or to the template shows up as a diff against it. Every refusal
// has a red case beside a green control on the same input, and --apply runs with
// fetch stubbed (in-process and through the CLI) so no test reaches the network.
//
// Regenerate the golden after a deliberate change to the sworn answers:
//   node tooling/release/play-data-safety.mjs --app subscriptiontracker \
//        --out tooling/ci/test/fixtures/play-data-safety/subscriptiontracker.backend-live.csv

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  render,
  validate,
  toCsv,
  parseCsv,
  templateFromExport,
  resolveOut,
  applyDataSafety,
  PLAY_TEMPLATE,
  PLAY_ID_MAP,
  HEADER,
  Refusal,
} from '../../release/play-data-safety.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'tooling', 'release', 'play-data-safety.mjs');
const DS_PATH = join(ROOT, 'apps', 'subscriptiontracker', 'store', 'android-play', 'data-safety.json');
const GOLDEN = join(ROOT, 'tooling', 'ci', 'test', 'fixtures', 'play-data-safety', 'subscriptiontracker.backend-live.csv');
const realDs = () => JSON.parse(readFileSync(DS_PATH, 'utf8'));
const LIVE = realDs().buildPosture.current;
const lf = (s) => s.replace(/\r\n/g, '\n');
const answer = (ds, type) => ds.answers.find((a) => a.type === type);
const refusal = (fn) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Refusal) return e.problems.join('\n');
    throw e;
  }
  assert.fail('expected a Refusal and the render succeeded');
};
const run = (args, env = {}, extraNodeArgs = []) =>
  spawnSync(process.execPath, [...extraNodeArgs, SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });

describe('the template', () => {
  test('782 unique (Question ID, Response ID) pairs: 60 form rows + 38 data types × 19 usage rows', () => {
    assert.equal(PLAY_TEMPLATE.length, 60 + 38 * 19);
    assert.equal(new Set(PLAY_TEMPLATE.map((r) => `${r.question}|${r.response}`)).size, PLAY_TEMPLATE.length);
  });
  test('every PLAY_ID_MAP type and purpose is a pair in the template', () => {
    const pairs = new Set(PLAY_TEMPLATE.map((r) => `${r.question}|${r.response}`));
    for (const [q, r] of Object.values(PLAY_ID_MAP.types)) assert.ok(pairs.has(`${q}|${r}`), `${q} ${r}`);
    for (const id of Object.values(PLAY_ID_MAP.purposes)) assert.ok(pairs.has(`PSL_DATA_USAGE_RESPONSES:PSL_NAME:DATA_USAGE_COLLECTION_PURPOSE|${id}`), id);
  });
  test('every type data-safety.json can name has a PLAY_ID_MAP entry, and nothing more', () => {
    const vocab = Object.entries(realDs().vocabulary.categories).flatMap(([c, ts]) => ts.map((t) => `${c}/${t}`));
    assert.deepEqual(new Set(Object.keys(PLAY_ID_MAP.types)), new Set(vocab));
    assert.deepEqual(new Set(Object.keys(PLAY_ID_MAP.purposes)), new Set(realDs().vocabulary.purposes));
  });
});

describe('render — the real data-safety.json', () => {
  test(`golden: the "${LIVE}" render equals the committed CSV, line for line`, () => {
    const { csv } = render(realDs(), LIVE);
    assert.equal(lf(csv), lf(readFileSync(GOLDEN, 'utf8')));
  });
  test('RFC 4180: CRLF line ends, the 5-column header, every row 5 fields', () => {
    const { csv } = render(realDs(), LIVE);
    assert.ok(csv.endsWith('\r\n'));
    assert.equal(csv.split('\r\n').length - 1, PLAY_TEMPLATE.length + 1);
    const rows = parseCsv(csv);
    assert.deepEqual(rows[0], HEADER);
    for (const r of rows) assert.equal(r.length, 5);
  });
  test('it declares exactly what the sworn file collects in that posture, with its purposes', () => {
    const ds = realDs();
    const { rows, declared } = render(ds, LIVE);
    const sworn = ds.answers.filter((a) => a.collected[LIVE] || a.shared[LIVE]).map((a) => `${a.category}/${a.type}`);
    assert.deepEqual(declared.map((d) => d.type), sworn);
    const v = (q, r = '') => rows.find((x) => x.question === q && x.response === r)?.value;
    assert.equal(v('PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA'), 'true');
    assert.equal(v('PSL_DATA_TYPES_LOCATION', 'PSL_APPROX_LOCATION'), 'true');
    assert.equal(v('PSL_DATA_TYPES_LOCATION', 'PSL_PRECISE_LOCATION'), '');
    assert.equal(v('PSL_DATA_USAGE_RESPONSES:PSL_APPROX_LOCATION:DATA_USAGE_COLLECTION_PURPOSE', 'PSL_ANALYTICS'), 'true');
    assert.equal(v('PSL_DATA_USAGE_RESPONSES:PSL_APPROX_LOCATION:DATA_USAGE_USER_CONTROL', 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL'), 'true');
    assert.equal(v('PSL_DATA_USAGE_RESPONSES:PSL_EMAIL:DATA_USAGE_USER_CONTROL', 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED'), 'true');
    assert.equal(v('PSL_ACCOUNT_DELETION_URL'), ds.dataSecurity.deletionRequestSupported.webDeletionUrl);
    assert.equal(v('PSL_SUPPORT_DATA_DELETION_BY_USER', 'DATA_DELETION_YES'), 'true');
    // Not declared by the sworn file → blank, never guessed.
    for (const q of ['PSL_SUPPORTED_ACCOUNT_CREATION_METHODS', 'PSL_HAS_OUTSIDE_APP_ACCOUNTS', 'PSL_UPI_BADGE_OPT_IN', 'PSL_DATA_DELETION_URL']) {
      assert.ok(rows.filter((r) => r.question === q).every((r) => r.value === ''), q);
    }
    // The Families question is only for apps that target children; `false` is rendered as blank.
    assert.equal(ds.dataSecurity.playFamiliesPolicy.answer, false);
    assert.equal(v('PSL_DATA_COLLECTION_COMPLIES_FAMILY_POLICY'), '');
  });
  test('the other posture renders its own column (demo declares fewer types)', () => {
    const ds = realDs();
    const other = Object.keys(ds.buildPosture.postures).find((p) => p !== LIVE);
    const a = render(ds, LIVE).declared.length;
    const b = render(ds, other).declared.length;
    assert.ok(b < a, `${other} ${b} vs ${LIVE} ${a}`);
  });
});

describe('render — refusals (red) beside their green control', () => {
  test('an unknown ID in PLAY_ID_MAP is refused', () => {
    const typo = { ...PLAY_ID_MAP, types: { ...PLAY_ID_MAP.types, 'Location/Approximate location': ['PSL_DATA_TYPES_LOCATION', 'PSL_APPROXIMATE_LOCATION'] } };
    assert.ok(render(realDs(), LIVE, { idMap: { ...PLAY_ID_MAP } }).csv);
    assert.match(refusal(() => render(realDs(), LIVE, { idMap: typo })), /PSL_APPROXIMATE_LOCATION.*NOT a \(Question ID, Response ID\) pair/);
  });
  test('an answer naming a type with no Play ID is refused', () => {
    const ds = realDs();
    ds.answers.push({ ...answer(ds, 'Name'), type: 'Shoe size' });
    assert.match(refusal(() => render(ds, LIVE)), /Personal info\/Shoe size.*no entry in PLAY_ID_MAP/);
  });
  test('a null answer is refused, and named', () => {
    const ds = realDs();
    answer(ds, 'Approximate location').collected[LIVE] = null;
    assert.match(refusal(() => render(ds, LIVE)), /answers\["Location\/Approximate location"\]\.collected\["backend-live"\] is null/);
  });
  test('a null `required` on a collected type is refused (USER_CONTROL)', () => {
    const ds = realDs();
    answer(ds, 'Email address').required = null;
    assert.match(refusal(() => render(ds, LIVE)), /Email address"\]\.required is null/);
  });
  test('a null `ephemeral` on a collected type is refused', () => {
    const ds = realDs();
    answer(ds, 'Crash logs').ephemeral = null;
    assert.match(refusal(() => render(ds, LIVE)), /Crash logs"\]\.ephemeral is null/);
  });
  test('a null data-security answer is refused', () => {
    const ds = realDs();
    ds.dataSecurity.encryptedInTransit.answer = null;
    assert.match(refusal(() => render(ds, LIVE)), /encryptedInTransit\.answer is null/);
  });
  test('a declared type missing its purpose is refused', () => {
    const ds = realDs();
    answer(ds, 'User IDs').purposes = [];
    assert.match(refusal(() => render(ds, LIVE)), /User IDs"\]\.purposes is \[\]; a declared type must name at least one purpose/);
  });
  test('a purpose outside the vocabulary is refused', () => {
    const ds = realDs();
    answer(ds, 'User IDs').purposes = ['Account management', 'Growth hacking'];
    assert.match(refusal(() => render(ds, LIVE)), /"Growth hacking", which has no entry in PLAY_ID_MAP\.purposes/);
  });
  test('a shared type with no sworn sharing purposes is refused; with them it renders', () => {
    const ds = realDs();
    answer(ds, 'Crash logs').shared[LIVE] = true;
    assert.match(refusal(() => render(ds, LIVE)), /Crash logs"\]\.sharingPurposes is undefined/);
    answer(ds, 'Crash logs').sharingPurposes = ['Analytics'];
    const { rows } = render(ds, LIVE);
    const v = (q, r) => rows.find((x) => x.question === q && x.response === r).value;
    assert.equal(v('PSL_DATA_USAGE_RESPONSES:PSL_CRASH_LOGS:PSL_DATA_USAGE_COLLECTION_AND_SHARING', 'PSL_DATA_USAGE_ONLY_SHARED'), 'true');
    assert.equal(v('PSL_DATA_USAGE_RESPONSES:PSL_CRASH_LOGS:DATA_USAGE_SHARING_PURPOSE', 'PSL_ANALYTICS'), 'true');
  });
  test('an open `unresolved` question is refused', () => {
    const ds = realDs();
    ds.unresolved = [{ id: 'what-does-the-sdk-send' }];
    assert.match(refusal(() => render(ds, LIVE)), /what-does-the-sdk-send/);
  });
  test('a posture the file does not declare is refused', () => {
    assert.match(refusal(() => render(realDs(), 'staging')), /posture "staging" is not one of/);
  });
  test('a non-https deletion URL is refused', () => {
    const ds = realDs();
    ds.dataSecurity.deletionRequestSupported.webDeletionUrl = 'http://nikatru.com/delete-account';
    assert.match(refusal(() => render(ds, LIVE)), /webDeletionUrl .* is not an https URL/);
  });
});

describe('validate — the hard checks over a rendered row set', () => {
  const rows = () => render(realDs(), LIVE).rows.map((r) => ({ ...r }));
  const at = (rs, q, r = '') => rs.find((x) => x.question === q && x.response === r);
  test('green control: the real render validates clean', () => {
    assert.deepEqual(validate(rows()), []);
  });
  test('an unknown pair is refused', () => {
    const rs = rows();
    rs.push({ question: 'PSL_MADE_UP', response: '', requirement: 'OPTIONAL', label: '', value: 'true' });
    assert.match(validate(rs).join('\n'), /PSL_MADE_UP.*not in Play's template/);
  });
  test('a REQUIRED question left blank is refused', () => {
    const rs = rows();
    at(rs, 'PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA').value = '';
    assert.match(validate(rs).join('\n'), /REQUIRED question PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA is unanswered/);
  });
  test('an invented answer for an undeclared type is refused', () => {
    const rs = rows();
    at(rs, 'PSL_DATA_USAGE_RESPONSES:PSL_HEALTH:DATA_USAGE_COLLECTION_PURPOSE', 'PSL_ANALYTICS').value = 'true';
    assert.match(validate(rs).join('\n'), /PSL_HEALTH is not declared and 1 of its usage row\(s\) are answered/);
  });
  test('two answers to a SINGLE_CHOICE question are refused', () => {
    const rs = rows();
    at(rs, 'PSL_DATA_USAGE_RESPONSES:PSL_EMAIL:DATA_USAGE_USER_CONTROL', 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL').value = 'true';
    assert.match(validate(rs).join('\n'), /SINGLE_CHOICE question PSL_DATA_USAGE_RESPONSES:PSL_EMAIL:DATA_USAGE_USER_CONTROL has 2/);
  });
  test('a collected type with EPHEMERAL blank is refused', () => {
    const rs = rows();
    at(rs, 'PSL_DATA_USAGE_RESPONSES:PSL_EMAIL:PSL_DATA_USAGE_EPHEMERAL').value = '';
    assert.match(validate(rs).join('\n'), /PSL_EMAIL is collected and EPHEMERAL is unanswered/);
  });
  test('a chosen response whose value is not "true" is refused', () => {
    const rs = rows();
    at(rs, 'PSL_DATA_TYPES_PERSONAL', 'PSL_EMAIL').value = 'yes';
    assert.match(validate(rs).join('\n'), /PSL_EMAIL\) has value "yes"/);
  });
});

describe('--template: the lead\'s Play Console export', () => {
  test('our own CSV, round-tripped, is accepted as a template (green)', () => {
    const tpl = templateFromExport(render(realDs(), LIVE).csv);
    assert.equal(tpl.length, PLAY_TEMPLATE.length);
  });
  test('an export with a pair PLAY_TEMPLATE lacks is refused', () => {
    const csv = toCsv([...PLAY_TEMPLATE.map((r) => ({ ...r, value: '' })), { question: 'PSL_NEW_QUESTION', response: '', requirement: 'OPTIONAL', label: 'New, "quoted"', value: '' }]);
    assert.match(refusal(() => templateFromExport(csv)), /PSL_NEW_QUESTION.*Play's template has moved/);
  });
  test('an export missing a pair is refused', () => {
    const csv = toCsv(PLAY_TEMPLATE.slice(1).map((r) => ({ ...r, value: '' })));
    assert.match(refusal(() => templateFromExport(csv)), /PLAY_TEMPLATE has \(PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA, ∅\), which the export does not/);
  });
  test('labels from the export are used verbatim, RFC 4180 quoting intact', () => {
    const long = 'Which of the following methods of account creation does your app support? Select all that apply, "exactly"';
    const csv = toCsv(PLAY_TEMPLATE.map((r) => ({ ...r, value: '', label: r.response === 'PSL_ACM_NONE' ? long : r.label })));
    const tpl = templateFromExport(csv);
    const { rows } = render(realDs(), LIVE, { template: tpl });
    assert.equal(rows.find((r) => r.response === 'PSL_ACM_NONE').label, long);
  });
});

describe('--out on Windows', () => {
  test('a drive-absolute path is kept, a backslashed relative one lands under cwd', () => {
    assert.equal(resolveOut('C:\\Users\\lead\\ds.csv', 'D:\\repo', win32), 'C:\\Users\\lead\\ds.csv');
    assert.equal(resolveOut('out\\ds.csv', 'D:\\repo', win32), 'D:\\repo\\out\\ds.csv');
    assert.equal(resolveOut('out/ds.csv', 'D:\\repo', win32), 'D:\\repo\\out\\ds.csv');
  });
});

describe('--apply with fetch stubbed', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const TOKEN = 'ya29.TEST-TOKEN-must-never-be-printed';
  const sa = { type: 'service_account', client_email: 'ci@example.iam.gserviceaccount.com', private_key: privateKey };
  const stub = (dataSafetyStatus = 200) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, ...init });
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: TOKEN, token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
      return new Response(dataSafetyStatus === 200 ? '{}' : JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: `echo Bearer ${TOKEN}` } }), { status: dataSafetyStatus });
    };
    return { calls, fetchImpl };
  };

  test('the exact URL, method and body shape; a ceiling and no redirects; no token printed', async () => {
    const { csv } = render(realDs(), LIVE);
    const { calls, fetchImpl } = stub();
    const logs = [];
    const status = await applyDataSafety({ csv, packageName: 'com.nikatru.subscriptiontracker', serviceAccount: sa, fetchImpl, log: (l) => logs.push(l) });
    assert.equal(status, 200);
    assert.equal(calls.length, 2);
    const [tok, post] = calls;
    assert.equal(tok.url, 'https://oauth2.googleapis.com/token');
    assert.equal(tok.method, 'POST');
    assert.equal(new URLSearchParams(tok.body).get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    assert.equal(post.url, 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.nikatru.subscriptiontracker/dataSafety');
    assert.equal(post.method, 'POST');
    assert.equal(post.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(post.headers['content-type'], 'application/json');
    const body = JSON.parse(post.body);
    assert.deepEqual(Object.keys(body), ['safetyLabels']);
    assert.equal(body.safetyLabels, csv);
    for (const c of calls) {
      assert.equal(c.redirect, 'manual');
      assert.ok(c.signal instanceof AbortSignal);
    }
    const printed = logs.join('\n');
    assert.match(printed, /token exchange → HTTP 200/);
    assert.match(printed, /dataSafety .* → HTTP 200/);
    assert.ok(!printed.includes(TOKEN));
    assert.ok(!printed.includes('PRIVATE KEY'));
    assert.ok(!printed.includes(new URLSearchParams(tok.body).get('assertion')));
  });

  test('a refused POST prints the status and Google\'s status enum — never the body that echoes the token', async () => {
    const { calls, fetchImpl } = stub(403);
    const logs = [];
    await assert.rejects(
      applyDataSafety({ csv: 'x', packageName: 'com.nikatru.subscriptiontracker', serviceAccount: sa, fetchImpl, log: (l) => logs.push(l) }),
      (e) => /HTTP 403 PERMISSION_DENIED/.test(e.message) && !e.message.includes(TOKEN),
    );
    assert.equal(calls.length, 2);
    assert.match(logs.join('\n'), /HTTP 403 PERMISSION_DENIED/);
    assert.ok(!logs.join('\n').includes(TOKEN));
  });

  test('through the CLI: PLAY_SERVICE_ACCOUNT_FILE is read, the package comes from Gradle, nothing secret is printed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'play-ds-'));
    try {
      const saFile = join(dir, 'sa.json');
      writeFileSync(saFile, JSON.stringify(sa));
      const record = join(dir, 'calls.json');
      const preload = join(dir, 'stub-fetch.mjs');
      writeFileSync(
        preload,
        `import { writeFileSync } from 'node:fs';
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body, redirect: init.redirect, hasSignal: !!init.signal });
  writeFileSync(${JSON.stringify(record)}, JSON.stringify(calls));
  if (String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: ${JSON.stringify(TOKEN)} }), { status: 200 });
  return new Response('{}', { status: 200 });
};
`,
      );
      const out = join(dir, 'nested', 'ds.csv');
      const r = run(['--app', 'subscriptiontracker', '--out', out, '--apply'], { PLAY_SERVICE_ACCOUNT_FILE: saFile }, ['--import', pathToFileURL(preload).href]);
      const printed = r.stdout + r.stderr;
      assert.equal(r.status, 0, printed);
      assert.ok(!printed.includes(TOKEN));
      assert.ok(!printed.includes('PRIVATE KEY'));
      const calls = JSON.parse(readFileSync(record, 'utf8'));
      assert.equal(calls.length, 2);
      assert.equal(calls[1].url, 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.nikatru.subscriptiontracker/dataSafety');
      assert.equal(calls[1].method, 'POST');
      assert.deepEqual(JSON.parse(calls[1].body), { safetyLabels: readFileSync(out, 'utf8') });
      assert.ok(calls.every((c) => c.redirect === 'manual' && c.hasSignal));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the CLI, dry', () => {
  test('renders the guard-confirmed posture to --out and sends nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'play-ds-'));
    try {
      const out = join(dir, 'sub', 'ds.csv');
      const r = run(['--app', 'subscriptiontracker', '--out', out], { PLAY_SERVICE_ACCOUNT_FILE: '' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`posture "${LIVE}" — confirmed by tooling/ci/assert-play-declarations\\.mjs`));
      assert.match(r.stdout, /nothing was sent/);
      assert.equal(readFileSync(out, 'utf8'), render(realDs(), LIVE).csv);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('no --app is COVERAGE LOST (exit 2)', () => {
    const r = run(['--out', join(tmpdir(), 'never.csv')]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COVERAGE LOST — --app <id> and --out <file> are both required/);
  });
  test('--apply with no PLAY_SERVICE_ACCOUNT_FILE is refused before any network call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'play-ds-'));
    try {
      const r = run(['--app', 'subscriptiontracker', '--out', join(dir, 'ds.csv'), '--apply'], { PLAY_SERVICE_ACCOUNT_FILE: '' });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /PLAY_SERVICE_ACCOUNT_FILE is not set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
