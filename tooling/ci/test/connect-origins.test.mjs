// ─────────────────────────────────────────────────────────────────────────────
// connect-origins.test.mjs — deploy-web compares the origins the build calls
// with the `connect-src` its own `_headers` serves, both ways, before building.
//
// Row O-WEB-CSP-HAND-LIST-UNSMOKED, the derivation half. The subject is
// tooling/web/connect-origins.mjs; these cases red each of its refusals against
// COPIES OF THE REAL TREE (deploy-web.yml, apps/subscriptiontracker/web/_headers,
// apps/subscriptiontracker/lib/core/app_config.dart), each mutated once, with the
// unmutated tree as the green control beside them.
//
// The define values are repository secrets. Every case uses FIXTURE values: the
// public origins the app's own `_headers` already names, and a made-up DSN key
// that the output is then searched for.
//
// Run:  node --test tooling/ci/test/connect-origins.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseWorkflow, workflowSteps, flutterReleaseBuilds } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE = join(ROOT, 'tooling', 'web', 'connect-origins.mjs');
const {
  URL_DEFINES,
  CONNECT_KEYS,
  LINK_KEYS,
  DECLARED,
  CoverageLost,
  originOf,
  connectSrcOf,
  listedOrigins,
  buildStepDefines,
  stripDartComments,
  dartConstants,
  resolveConstant,
  checkConnectOrigins,
} = await import(pathToFileURL(MODULE).href);

const APP = 'subscriptiontracker';
const WORKFLOW_REL = '.github/workflows/deploy-web.yml';
const HEADERS_REL = `apps/${APP}/web/_headers`;
const DART_REL = `apps/${APP}/lib/core/app_config.dart`;
const BRICK_HEADERS_REL = 'tooling/bricks/app/__brick__/apps/{{app_id}}/web/_headers';
const real = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const BARE_HTTPS = /^https:\/\/[a-z0-9.-]+$/;

/** A made-up DSN key. The output of every case that passes it is searched for it. */
const DSN_KEY = 'dsn0dsn0dsn0dsn0dsn0';
/** The build's three URL defines as FIXTURE values — the public origins the app's
 *  `_headers` already names, never the secrets. */
const FIXTURE_ENV = {
  SUPABASE_URL: 'https://lcrkiurkvzhkonjwhpiv.supabase.co',
  API_BASE_URL: 'https://subscriptiontracker-api.nikatru.com',
  GLITCHTIP_DSN: `https://${DSN_KEY}@glitchtip.nikatru.com/7`,
};

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-connect-origins-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** `src` with the ONE occurrence of `from` replaced — a mutation that matched
 *  nothing, or matched twice, fails the case instead of passing it. */
function mutate(src, from, to) {
  assert.equal(src.split(from).length - 1, 1, `the mutation target must occur exactly once: ${JSON.stringify(from)}`);
  return src.replace(from, to);
}

let seq = 0;
/** A copy of the three real inputs under a temp root, each passed through its transform. */
function tree({ workflow = (t) => t, headers = (t) => t, dart = (t) => t } = {}) {
  const dir = join(TMP, `t${seq++}`);
  for (const [rel, fn] of [
    [WORKFLOW_REL, workflow],
    [HEADERS_REL, headers],
    [DART_REL, dart],
  ]) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), fn(real(rel)));
  }
  return dir;
}

/** The CLI, with ONLY the given environment (no inherited secret can leak in). */
function run(root, env = FIXTURE_ENV, args = ['--check']) {
  const clean = Object.fromEntries(
    Object.entries({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env }).filter(([, v]) => v !== undefined),
  );
  const r = spawnSync(process.execPath, [MODULE, '--app', APP, ...args, ...(root ? ['--root', root] : [])], {
    env: clean,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}

const realInputs = () => ({ headersText: real(HEADERS_REL), dartText: real(DART_REL), workflowText: real(WORKFLOW_REL) });

describe('the connect-src parser', () => {
  test("reads the ONE Content-Security-Policy header line of the app's _headers, never its prose", () => {
    const src = real(HEADERS_REL);
    assert.ok(src.split('\n').some((l) => /^#.*connect-src/.test(l)), 'precondition: the prose names connect-src, so skipping it is exercised');
    const sources = connectSrcOf(src);
    assert.equal(sources[0], "'self'");
    const origins = listedOrigins(sources);
    assert.equal(origins.length, sources.length - 1);
    assert.ok(origins.includes('https://subscriptiontracker-api.nikatru.com'));
    for (const o of origins) assert.match(o, BARE_HTTPS);
  });

  test("accepts the brick's _headers: section tags vanish, the backend host stays a template source", () => {
    const sources = connectSrcOf(real(BRICK_HEADERS_REL));
    assert.equal(sources[0], "'self'");
    assert.ok(sources.includes('https://{{{api_domain}}}'), sources.join(' '));
    assert.ok(sources.every((s) => !/\{\{[#^/]/.test(s)), sources.join(' '));
    for (const s of sources.slice(1).filter((x) => x !== 'https://{{{api_domain}}}')) assert.match(s, BARE_HTTPS);
    assert.throws(() => listedOrigins(sources), /`https:\/\/\{\{\{api_domain\}\}\}` is not a bare https origin/);
  });

  test('a comment line shaped like a policy is never read', () => {
    const text =
      "# Content-Security-Policy: default-src 'self'; connect-src https://evil.example\n" +
      "/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' https://a.example; img-src 'self'\n";
    assert.deepEqual(connectSrcOf(text), ["'self'", 'https://a.example']);
  });

  test('no policy line, two policy lines, or no connect-src directive is COVERAGE LOST', () => {
    assert.throws(() => connectSrcOf('/*\n  X-Frame-Options: DENY\n'), (e) => e instanceof CoverageLost && /carries 0 Content-Security-Policy/.test(e.message));
    const two = "/*\n  Content-Security-Policy: connect-src 'self'\n/x\n  Content-Security-Policy: connect-src 'self'\n";
    assert.throws(() => connectSrcOf(two), (e) => e instanceof CoverageLost && /carries 2 Content-Security-Policy/.test(e.message));
    assert.throws(() => connectSrcOf("/*\n  Content-Security-Policy: default-src 'self'\n"), (e) => e instanceof CoverageLost && /no connect-src directive/.test(e.message));
  });

  test('a wildcard, a bare scheme or a path in connect-src cannot be graded and is COVERAGE LOST', () => {
    assert.throws(() => listedOrigins(["'self'", 'https://*.nikatru.com']), CoverageLost);
    assert.throws(() => listedOrigins(["'self'", 'wss:']), CoverageLost);
    assert.throws(() => listedOrigins(["'self'", 'https://a.example/path']), CoverageLost);
    assert.deepEqual(listedOrigins(["'self'", 'https://a.example', 'https://b.example:8443']), ['https://a.example', 'https://b.example:8443']);
  });
});

describe('origins, and the DSN key that must never be printed', () => {
  test("originOf keeps scheme, host and port, and drops a DSN's key and path", () => {
    assert.equal(originOf(`https://${DSN_KEY}@GlitchTip.Nikatru.com/7`), 'https://glitchtip.nikatru.com');
    assert.equal(originOf('https://a.example:8443/x?y#z'), 'https://a.example:8443');
    assert.equal(originOf('not a url'), null);
  });

  test("the report prints the DSN's origin and never its key or its path", () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /https:\/\/glitchtip\.nikatru\.com {2}← GLITCHTIP_DSN/);
    assert.ok(!r.out.includes(DSN_KEY), 'the DSN key was printed');
    assert.ok(!r.out.includes('@'), 'a user part was printed');
    assert.doesNotMatch(r.out, /glitchtip\.nikatru\.com\/7/);
  });

  test('a define value that is not an https URL is named, and its value is never printed', () => {
    const r = run(tree(), { ...FIXTURE_ENV, GLITCHTIP_DSN: 'http://k3yk3yk3y@glitchtip.nikatru.com/7' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /GLITCHTIP_DSN is not an https URL \(its value is not printed\)/);
    assert.ok(!r.out.includes('k3yk3yk3y'), 'the value was printed');
  });

  test('a host that is not a plain DNS name is refused unprinted: the emitted set reaches a run: line', () => {
    const r = run(tree(), { ...FIXTURE_ENV, API_BASE_URL: 'https://a$(id).example.com' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /API_BASE_URL names a host that is not a plain DNS name \(its origin is not printed\)/);
    assert.ok(!r.out.includes('$(id)'), 'the host was printed');
  });
});

describe('app_config.dart', () => {
  test("comments go and string literals stay: a URL's // is not a comment", () => {
    const code = stripDartComments(
      "static const String a = 'https://x.example'; // https://y.example\n/* https://z.example /* nested */ still */ const b = \"//kept\";\n",
    );
    assert.ok(code.includes("'https://x.example'"), code);
    assert.ok(code.includes('"//kept"'), code);
    assert.ok(!code.includes('y.example') && !code.includes('z.example') && !code.includes('still'), code);
  });

  test('the real file: CONNECT_KEYS and LINK_KEYS resolve to https, and each URL-define constant falls back to a placeholder', () => {
    const constants = dartConstants(real(DART_REL));
    for (const key of CONNECT_KEYS) assert.match(originOf(resolveConstant(constants, key)) ?? '', BARE_HTTPS, key);
    for (const key of LINK_KEYS) assert.match(resolveConstant(constants, key) ?? '', /^https:\/\//, `LINK_KEYS names ${key}, which the real app_config.dart does not declare as an https URL`);
    assert.equal(resolveConstant(constants, 'updateUrl'), resolveConstant(constants, 'companyUrl'), 'a defaultValue reference is followed');
    assert.equal(constants.get('apiBaseUrl').define, 'API_BASE_URL');
    assert.match(originOf(resolveConstant(constants, 'apiBaseUrl')), /your_/);
    assert.equal(constants.get('supabaseUrl').define, 'SUPABASE_URL');
    assert.match(originOf(resolveConstant(constants, 'supabaseUrl')), /your_/);
  });
});

describe("the web build's defines", () => {
  test('read by this module and by the release-build census, they are the same set, each URL define from its own secret', () => {
    const mine = buildStepDefines(real(WORKFLOW_REL)).defines;
    const census = flutterReleaseBuilds(ROOT).filter((b) => b.workflow === WORKFLOW_REL && b.target === 'web');
    assert.equal(census.length, 1, 'the census sees one web build in deploy-web.yml');
    assert.deepEqual([...mine.keys()].sort(), [...census[0].defines].sort());
    for (const name of URL_DEFINES) assert.equal(mine.get(name), '${{ secrets.' + name + ' }}', name);
  });

  test('a define behind a shell comment is not passed, and a | block continues only past a backslash', () => {
    const folded =
      '    steps:\n      - name: Build\n        run: >\n          flutter build web --release\n' +
      '          --dart-define=A=1 # --dart-define=B=2\n          --dart-define=C=3\n';
    assert.deepEqual([...buildStepDefines(folded).defines.keys()], ['A']);
    const literal =
      '    steps:\n      - name: Build\n        run: |\n          flutter build web \\\n' +
      '            --dart-define=A=1\n          echo --dart-define=Z=9\n';
    assert.deepEqual([...buildStepDefines(literal).defines.keys()], ['A']);
  });

  test('two web builds, none, or defines read from a file is COVERAGE LOST', () => {
    const step = (cmd) => `      - run: ${cmd}\n`;
    assert.throws(() => buildStepDefines('    steps:\n' + step('flutter build web') + step('flutter build web')), /has 2 `flutter build web`/);
    assert.throws(() => buildStepDefines('    steps:\n' + step('echo nothing')), /has 0 `flutter build web`/);
    assert.throws(() => buildStepDefines('    steps:\n' + step('flutter build web --dart-define-from-file=x.json')), /reads defines from a file/);
  });
});

describe('the compare, on the real tree and on mutated copies of it (red controls)', () => {
  test('RC7 — the real tree, with the public origins as fixture define values, is green', () => {
    const listed = listedOrigins(connectSrcOf(real(HEADERS_REL)));
    const r = run(null);
    assert.equal(r.code, 0, r.out);
    assert.match(r.stdout, new RegExp(`ok {3}connect-src equals the derived set in both directions \\(${listed.length} origin\\(s\\)\\)`));
  });

  test('RC5 — API_BASE_URL on an origin connect-src does not name is red, and the old API host is then unused', () => {
    const r = run(tree(), { ...FIXTURE_ENV, API_BASE_URL: 'https://elsewhere-api.example.com/v1' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL connect-origins: missing from connect-src: https:\/\/elsewhere-api\.example\.com \(API_BASE_URL\)/);
    assert.match(r.out, /FAIL connect-origins: unused in connect-src: https:\/\/subscriptiontracker-api\.nikatru\.com/);
  });

  test('RC6 — an extra origin in connect-src that no define, constant or DECLARED entry names is red (unused)', () => {
    const r = run(tree({ headers: (t) => mutate(t, "connect-src 'self'", "connect-src 'self' https://extra.nikatru.com") }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL connect-origins: unused in connect-src: https:\/\/extra\.nikatru\.com — no URL define/);
  });

  test('RC8 — a pre-stage that a define now derives is red until its DECLARED entry is deleted', () => {
    const r = run(tree(), { ...FIXTURE_ENV, SUPABASE_URL: 'https://auth-api.nikatru.com' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /pre-stage is now derived: delete its DECLARED entry — https:\/\/auth-api\.nikatru\.com is derived from SUPABASE_URL/);
  });

  test('RC9 — a new app_config.dart constant naming an https origin, in neither list, is red', () => {
    const r = run(
      tree({
        dart: (t) =>
          mutate(t, "  static const String _phSupabaseUrl =", "  static const String statusUrl = 'https://status.nikatru.com';\n\n  static const String _phSupabaseUrl ="),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /unclassified origin constant statusUrl \(https:\/\/status\.nikatru\.com\) in app_config\.dart: add it to CONNECT_KEYS or LINK_KEYS/);
  });

  test('RC10 — an empty API_BASE_URL is red: the build would compile the placeholder fallback', () => {
    const r = run(tree(), { ...FIXTURE_ENV, API_BASE_URL: '' });
    assert.equal(r.code, 1, r.out);
    assert.match(
      r.out,
      /placeholder origin: a define is empty — API_BASE_URL has no value in this job, so the build would compile app_config\.dart's fallback https:\/\/subscriptiontracker-api\.your_subdomain\.workers\.dev/,
    );
  });

  test('an empty GLITCHTIP_DSN is red too, though app_config.dart gives it no fallback', () => {
    const r = run(tree(), { ...FIXTURE_ENV, GLITCHTIP_DSN: undefined });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a define is empty — GLITCHTIP_DSN has no value in this job, and app_config\.dart gives it no fallback/);
  });

  test('a CONNECT_KEYS constant renamed in app_config.dart is COVERAGE LOST (exit 2), never a pass', () => {
    const r = run(tree({ dart: (t) => mutate(t, 'static const String configBaseUrl', 'static const String configHostUrl') }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /FAIL COVERAGE LOST — connect-origins: CONNECT_KEYS names configBaseUrl, and app_config\.dart declares no such constant: key renamed\?/);
  });

  test('a URL define dropped from the build step is COVERAGE LOST (exit 2)', () => {
    const r = run(tree({ workflow: (t) => mutate(t, '          --dart-define=API_BASE_URL=${{ secrets.API_BASE_URL }}\n', '') }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /API_BASE_URL is not passed by the `flutter build web` step \(deploy-web\.yml:\d+\): define renamed\?/);
  });

  test('a new define in the build step, in neither define list, is red', () => {
    const r = run(
      tree({
        workflow: (t) =>
          mutate(t, '          --dart-define=APP_ENV=production\n', '          --dart-define=APP_ENV=production\n          --dart-define=STATUS_URL=${{ secrets.STATUS_URL }}\n'),
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /unclassified define STATUS_URL in the web build: add it to URL_DEFINES or VALUE_DEFINES/);
  });

  test('a DECLARED rollback that a define derives again is no finding, and a malformed entry is one', () => {
    const rollback = { origin: FIXTURE_ENV.SUPABASE_URL, kind: 'rollback', reason: 'the hosted project, until Phase 6', retire: 'Phase 6' };
    const green = checkConnectOrigins({ ...realInputs(), env: FIXTURE_ENV, declared: [...DECLARED, rollback] });
    assert.deepEqual([green.lost, green.findings], [[], []]);
    const bad = checkConnectOrigins({ ...realInputs(), env: FIXTURE_ENV, declared: [{ ...DECLARED[0], origin: 'https://auth-api.nikatru.com/path' }] });
    assert.ok(bad.findings.some((f) => /^DECLARED entry #1 is malformed/.test(f)), bad.findings.join('\n'));
  });

  test('a CONNECT_KEYS constant left on a placeholder host is red', () => {
    const dartText = mutate(real(DART_REL), "defaultValue: 'https://config.nikatru.com'", "defaultValue: 'https://config.YOUR_SUBDOMAIN.workers.dev'");
    const r = checkConnectOrigins({ ...realInputs(), dartText, env: FIXTURE_ENV });
    assert.ok(r.findings.some((f) => /^placeholder origin: a define is empty — https:\/\/config\.your_subdomain\.workers\.dev \(configBaseUrl\)/.test(f)), r.findings.join('\n'));
  });

  test('--emit-connect prints one connect= line of exactly the derived origins, and nothing on a red compare', () => {
    const r = run(tree(), FIXTURE_ENV, ['--check', '--emit-connect']);
    assert.equal(r.code, 0, r.out);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1, r.stdout);
    assert.match(lines[0], /^connect=(--connect https:\/\/[a-z0-9.-]+ ?)+$/);
    const emitted = lines[0].slice('connect='.length).split(' ').filter((w) => w !== '--connect');
    assert.deepEqual(emitted.sort(), listedOrigins(connectSrcOf(real(HEADERS_REL))).sort());
    assert.match(r.stderr, /ok {3}connect-src equals the derived set/);
    const red = run(tree(), { ...FIXTURE_ENV, API_BASE_URL: '' }, ['--check', '--emit-connect']);
    assert.equal(red.code, 1, red.out);
    assert.equal(red.stdout, '');
  });

  test('an unrecognised flag is COVERAGE LOST (exit 2), not a compare', () => {
    const r = run(tree(), FIXTURE_ENV, ['--chek']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /unrecognised argument\(s\): --chek/);
  });
});

describe('deploy-web.yml runs the compare, before the build, and feeds the smoke from it', () => {
  const steps = () => {
    const wf = parseWorkflow(ROOT, WORKFLOW_REL);
    assert.ok(wf, 'deploy-web.yml was not found');
    return workflowSteps(wf.jobs.get('deploy-web'));
  };
  const COMPARE = 'node tooling/web/connect-origins.mjs --app ${{ matrix.app }} --check --emit-connect >> "$GITHUB_OUTPUT"';

  test('the compare step (id connect) runs before the web build and before the launch smoke', () => {
    const all = steps();
    const compare = all.findIndex((s) => s.run?.text.trim() === COMPARE);
    const build = all.findIndex((s) => /\bflutter build web\b/.test(s.run?.text ?? ''));
    const smoke = all.findIndex((s) => s.run?.text.includes('node tooling/smoke/smoke-web-artifact.mjs'));
    assert.ok(compare !== -1, `deploy-web.yml no longer runs: ${COMPARE}`);
    assert.equal(all[compare].id, 'connect');
    assert.ok(build !== -1 && smoke !== -1, 'the build or the smoke step is gone');
    assert.ok(compare < build, 'the compare must run BEFORE the web build');
    assert.ok(compare < smoke, 'the compare must run before the smoke that consumes its output');
  });

  test('the compare reads each URL define from the same expression the build passes it, and nothing else', () => {
    const compare = steps().find((s) => s.run?.text.trim() === COMPARE);
    assert.ok(compare, `deploy-web.yml no longer runs: ${COMPARE}`);
    const build = buildStepDefines(real(WORKFLOW_REL)).defines;
    assert.deepEqual([...compare.env.keys()].sort(), [...URL_DEFINES].sort());
    for (const name of URL_DEFINES) assert.equal(compare.env.get(name).value, build.get(name), name);
  });

  test("the module sits inside the web deploy unit, so editing it redeploys web", () => {
    // deploy-web.yml is a workflow_call callee of ci.yml (#947): lane-map's deployUnits is the trigger now.
    assert.ok(JSON.parse(real('tooling/ci/lane-map.json')).deployUnits['<app>-web'].includes('tooling/web/**'));
  });
});
