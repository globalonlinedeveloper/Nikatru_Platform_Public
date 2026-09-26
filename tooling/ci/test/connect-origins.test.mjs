// ─────────────────────────────────────────────────────────────────────────────
// connect-origins.test.mjs — deploy-web compares the origins the build calls
// with the `connect-src` its own `_headers` serves, both ways, before building.
//
// Row O-WEB-CSP-HAND-LIST-UNSMOKED, the derivation half. The subject is
// tooling/web/connect-origins.mjs; these cases red each of its refusals against
// COPIES OF THE REAL TREE (deploy-web.yml, apps/subscriptiontracker/web/_headers,
// apps/subscriptiontracker/lib/core/app_config.dart, and the composer the build
// step calls with every module it imports, its channel register and the app's
// app.yaml), each mutated once, with the unmutated tree as the green control
// beside them.
//
// ⏱ 2026-09-26 (O-FLUTTER-BUILD-TYPED-PER-LINE, lead ruling W37-R1): deploy-web
// types no `flutter build web` line; its build step calls
// tooling/ci/flutter-release-build.mjs. The module reads the defines through the
// composer's `--print` for that call, so the define cases mutate the composer or
// the call, and API_BASE_URL (the composer's rule value, no longer a secret) is
// mutated through the app's `hosts.api`. The retired literal-line reader is kept
// below ONLY as a red control: restored into a copy of the module, it must refuse
// the composed deploy-web.yml.
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
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { composerCallArgs, flutterReleaseBuilds, parseWorkflow, shellSegments, workflowSteps } from '../workflow-scan.mjs';
import { apiBaseUrl, appApiHost } from '../flutter-release-build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE_REL = 'tooling/web/connect-origins.mjs';
const MODULE = join(ROOT, 'tooling', 'web', 'connect-origins.mjs');
const {
  COMPOSER,
  URL_DEFINES,
  CONNECT_KEYS,
  LINK_KEYS,
  DECLARED,
  CoverageLost,
  originOf,
  connectSrcOf,
  listedOrigins,
  composerWebCall,
  printedDefines,
  composerPrint,
  composedBuildDefines,
  stripDartComments,
  dartConstants,
  resolveConstant,
  checkConnectOrigins,
} = await import(pathToFileURL(MODULE).href);

const APP = 'subscriptiontracker';
const WORKFLOW_REL = '.github/workflows/deploy-web.yml';
const HEADERS_REL = `apps/${APP}/web/_headers`;
const DART_REL = `apps/${APP}/lib/core/app_config.dart`;
const APP_YAML_REL = `apps/${APP}/app.yaml`;
const REGISTER_REL = 'tooling/channel-register.json';
const BRICK_HEADERS_REL = 'tooling/bricks/app/__brick__/apps/{{app_id}}/web/_headers';
const real = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const BARE_HTTPS = /^https:\/\/[a-z0-9.-]+$/;
/** deploy-web's build step, exactly as it calls the composer. */
const BUILD_CALL = 'run: node tooling/ci/flutter-release-build.mjs ${{ matrix.app }} web web\n';

/** A made-up DSN key. The output of every case that passes it is searched for it. */
const DSN_KEY = 'dsn0dsn0dsn0dsn0dsn0';
/** The two URL defines the composer leaves to the step's environment, as FIXTURE
 *  values — the public origins the app's `_headers` already names, never the
 *  secrets. API_BASE_URL is not here: the composer composes it. */
const FIXTURE_ENV = {
  SUPABASE_URL: 'https://lcrkiurkvzhkonjwhpiv.supabase.co',
  GLITCHTIP_DSN: `https://${DSN_KEY}@glitchtip.nikatru.com/7`,
};

/** The composer and every module it imports, read from the files' own import
 *  lines, so a new import joins every fixture by itself. */
function importClosure(rel, seen = new Set()) {
  if (seen.has(rel)) return seen;
  seen.add(rel);
  for (const m of real(rel).matchAll(/^import\s[^;]*?from\s+'(\.{1,2}\/[^']+)'/gm)) importClosure(posix.join(posix.dirname(rel), m[1]), seen);
  return seen;
}
const CLOSURE = [...importClosure(COMPOSER)];

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
const same = (t) => t;
/** A copy of the real inputs under a temp root, each passed through its transform;
 *  a path in `omit` is left out. */
function tree({ workflow = same, headers = same, dart = same, appYaml = same, composer = same, omit = [] } = {}) {
  const dir = join(TMP, `t${seq++}`);
  const files = new Map([
    [WORKFLOW_REL, workflow],
    [HEADERS_REL, headers],
    [DART_REL, dart],
    [APP_YAML_REL, appYaml],
    [REGISTER_REL, same],
    ...CLOSURE.map((rel) => [rel, rel === COMPOSER ? composer : same]),
  ]);
  for (const [rel, fn] of files) {
    if (omit.includes(rel)) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), fn(real(rel)));
  }
  return dir;
}

/** ONLY the given environment (no inherited secret can leak in). */
const cleanEnv = (env) =>
  Object.fromEntries(Object.entries({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env }).filter(([, v]) => v !== undefined));

const result = (r) => ({ code: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` });

/** The CLI, with ONLY the given environment. */
function run(root, env = FIXTURE_ENV, args = ['--check']) {
  const r = spawnSync(process.execPath, [MODULE, '--app', APP, ...args, ...(root ? ['--root', root] : [])], {
    env: cleanEnv(env),
    encoding: 'utf8',
    timeout: 60000,
  });
  return result(r);
}

/** A COPY of the module written into a fixture tree, run on that tree. */
function runCopy(copy, root) {
  return result(spawnSync(process.execPath, [copy, '--app', APP, '--check', '--root', root], { env: cleanEnv(FIXTURE_ENV), encoding: 'utf8', timeout: 60000 }));
}

const realInputs = () => ({
  headersText: real(HEADERS_REL),
  dartText: real(DART_REL),
  workflowText: real(WORKFLOW_REL),
  app: APP,
  compose: composerPrint(ROOT),
});

/** The step that asks the composer for the web build. */
const isWebBuild = (s) => shellSegments(s.run?.text ?? '').some((seg) => composerCallArgs(seg)?.target === 'web');

/**
 * RETIRED — the reader the module had while deploy-web typed its build (#986),
 * copied here unchanged but for `indentOf` moved inside. It is kept ONLY as the
 * red control of lead ruling W37-R1: it matches the literal `flutter build web`
 * line, and the composed deploy-web.yml has none. The module never imports it.
 */
function retiredBuildStepDefines(workflowText) {
  const indentOf = (l) => /^ */.exec(l)[0].length;
  const lines = String(workflowText).split(/\r?\n/);
  const at = lines.flatMap((l, i) => (!/^\s*#/.test(l) && /\bflutter\s+build\s+web\b/.test(l) ? [i] : []));
  if (at.length !== 1) {
    throw new CoverageLost(`deploy-web.yml has ${at.length} \`flutter build web\` command(s); the compare models exactly one.`);
  }
  const first = at[0];
  let style = null;
  for (let i = first; i >= 0; i--) {
    const m = /^\s*(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    style = /^[>|]/.test(m[1]) ? m[1][0] : 'inline';
    break;
  }
  if (style === null) throw new CoverageLost('the `flutter build web` command is not inside a `run:` step.');
  const command = [lines[first]];
  if (style === '>') {
    const indent = indentOf(lines[first]);
    for (let i = first + 1; i < lines.length && lines[i].trim() !== '' && indentOf(lines[i]) >= indent; i++) command.push(lines[i]);
  } else if (style === '|') {
    for (let i = first + 1; i < lines.length && /\\\s*$/.test(lines[i - 1]); i++) command.push(lines[i]);
  }
  const text = command.map((l) => l.replace(/\\\s*$/, '').trim()).join(' ');
  const live = text.split(/(?:^|\s)#/)[0];
  if (/--dart-define-from-file\b/.test(live)) {
    throw new CoverageLost('the web build reads defines from a file, which this compare cannot see.');
  }
  const defines = new Map();
  for (const m of live.matchAll(/--dart-define(?:=|\s+)([A-Za-z_][A-Za-z0-9_]*)=((?:\$\{\{[^}]*\}\}|\S)*)/g)) defines.set(m[1], m[2]);
  return { line: first + 1, defines };
}

describe('the connect-src parser', () => {
  test("reads the ONE Content-Security-Policy header line of the app's _headers, never its prose", () => {
    const src = real(HEADERS_REL);
    assert.ok(src.split('\n').some((l) => /^#.*connect-src/.test(l)), 'precondition: the prose names connect-src, so skipping it is exercised');
    const sources = connectSrcOf(src);
    assert.equal(sources[0], "'self'");
    const origins = listedOrigins(sources);
    assert.equal(origins.length, sources.length - 1);
    assert.ok(origins.some((o) => o === 'https://subscriptiontracker-api.nikatru.com'), origins.join(' '));
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
    assert.equal(r.out.split('glitchtip.nikatru.com/7').length, 1, 'the DSN path was printed');
  });

  test('a define value that is not an https URL is named, and its value is never printed', () => {
    const r = run(tree(), { ...FIXTURE_ENV, GLITCHTIP_DSN: 'http://k3yk3yk3y@glitchtip.nikatru.com/7' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /GLITCHTIP_DSN is not an https URL \(its value is not printed\)/);
    assert.ok(!r.out.includes('k3yk3yk3y'), 'the value was printed');
  });

  test('a host that is not a plain DNS name is refused unprinted: the emitted set reaches a run: line', () => {
    const r = run(tree(), { ...FIXTURE_ENV, SUPABASE_URL: 'https://a$(id).example.com' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /SUPABASE_URL names a host that is not a plain DNS name \(its origin is not printed\)/);
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

describe("the web build's defines, read through the composer", () => {
  test("a composed build: deploy-web's one composer call, asked for its --print, gives the census's define set", () => {
    const call = composerWebCall(real(WORKFLOW_REL));
    assert.deepEqual([call.app, call.target, call.channel, call.lane], ['${{matrix.app}}', 'web', 'web', null]);
    const mine = composedBuildDefines(real(WORKFLOW_REL), APP, composerPrint(ROOT)).defines;
    const census = flutterReleaseBuilds(ROOT).filter((b) => b.workflow === WORKFLOW_REL && b.target === 'web');
    assert.equal(census.length, 1, 'the census sees one web build in deploy-web.yml');
    assert.deepEqual([...mine.keys()].sort(), [...census[0].defines].sort());
    assert.equal(mine.get('SUPABASE_URL'), '$SUPABASE_URL');
    assert.equal(mine.get('GLITCHTIP_DSN'), '$GLITCHTIP_DSN');
    assert.equal(mine.get('API_BASE_URL'), apiBaseUrl(appApiHost(ROOT, APP)), "API_BASE_URL is the composer's rule value for the app");
  });

  test('a composed build on the CLI: API_BASE_URL is derived with none in the environment, and one set there changes nothing', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /https:\/\/subscriptiontracker-api\.nikatru\.com {2}← API_BASE_URL/);
    const stray = run(tree(), { ...FIXTURE_ENV, API_BASE_URL: 'https://elsewhere-api.example.com' });
    assert.equal(stray.code, 0, stray.out);
    assert.ok(!stray.out.includes('elsewhere-api'), `the environment's API_BASE_URL reached the compare:\n${stray.out}`);
  });

  test('the call: --print and --emit-env build nothing, a # comment is no call, ${{ matrix.app }} folds, --lane is read', () => {
    const wf = [
      '      - run: node tooling/ci/flutter-release-build.mjs --emit-env API_BASE_URL ${{ matrix.app }} >> "$GITHUB_ENV"',
      '      - run: node tooling/ci/flutter-release-build.mjs ${{ matrix.app }} web web --print',
      '      # node tooling/ci/flutter-release-build.mjs x web web',
      '      - run: echo hi # node tooling/ci/flutter-release-build.mjs y web web',
      '      - run: node tooling/ci/flutter-release-build.mjs x apk android-play',
      '      - run: node tooling/ci/flutter-release-build.mjs ${{  matrix.app  }} web web --lane pr',
    ].join('\n');
    assert.deepEqual(composerWebCall(wf), { line: 6, app: '${{matrix.app}}', target: 'web', channel: 'web', lane: 'pr' });
  });

  test('no composer web call, two, a hand-typed `flutter build web` beside one, or a call short of an argument is COVERAGE LOST', () => {
    const call = `      - ${BUILD_CALL}`;
    const lost = (text, re) => assert.throws(() => composerWebCall(text), (e) => e instanceof CoverageLost && re.test(e.message));
    lost('      - run: echo nothing\n', /has 0 composer web build call\(s\) and 0 hand-typed/);
    lost(call + call, /has 2 composer web build call\(s\)/);
    lost(`${call}      - run: flutter build web --release\n`, /1 hand-typed `flutter build web` line\(s\); the compare models exactly one composed build\./);
    lost('      - run: node tooling/ci/flutter-release-build.mjs ${{ matrix.app }} web\n', /names 2 of its three arguments/);
  });

  test('what the composer printed: one `flutter build web` line, else COVERAGE LOST, and never defines from a file', () => {
    assert.deepEqual([...printedDefines('flutter build web --release --dart-define=A=$A --dart-define B=https://b.example\n')], [
      ['A', '$A'],
      ['B', 'https://b.example'],
    ]);
    for (const text of ['', 'flutter build apk --release', 'flutter build web\nflutter build web', 'usage: nothing']) {
      assert.throws(() => printedDefines(text), CoverageLost, JSON.stringify(text));
    }
    assert.throws(() => printedDefines('flutter build web --dart-define-from-file=x.json'), /reads defines from a file/);
  });

  test('a failing or unreadable --print is COVERAGE LOST (exit 2), never a pass', () => {
    const refused = run(tree({ workflow: (t) => mutate(t, BUILD_CALL, BUILD_CALL.replace('web web', 'web no-such-channel')) }));
    assert.equal(refused.code, 2, refused.out);
    assert.match(refused.out, /FAIL COVERAGE LOST — connect-origins: `node tooling\/ci\/flutter-release-build\.mjs subscriptiontracker web no-such-channel --print` exited 1: FAIL "no-such-channel" is not a channel row/);
    const gone = run(tree({ omit: [COMPOSER] }));
    assert.equal(gone.code, 2, gone.out);
    assert.match(gone.out, /FAIL COVERAGE LOST — connect-origins: `node tooling\/ci\/flutter-release-build\.mjs subscriptiontracker web web --print` exited 1: Error: Cannot find module/);
    const junk = run(tree({ composer: (t) => mutate(t, 'console.log(printed(composed.argv));', "console.log('usage: nothing');") }));
    assert.equal(junk.code, 2, junk.out);
    assert.match(junk.out, /the composer's --print printed 1 line\(s\) and not one `flutter build web` command/);
    const thrown = checkConnectOrigins({ ...realInputs(), env: FIXTURE_ENV, compose: () => { throw new CoverageLost('asked nothing'); } });
    assert.deepEqual([thrown.lost, thrown.findings], [['asked nothing'], []]);
  });

  test('RED CONTROL (W37-R1): the retired literal-line reader, restored into a copy of the module, refuses the composed deploy-web.yml', () => {
    assert.throws(() => retiredBuildStepDefines(real(WORKFLOW_REL)), (e) => e instanceof CoverageLost && /has 0 `flutter build web` command\(s\)/.test(e.message));
    const dir = tree();
    const copy = join(dir, MODULE_REL);
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, real(MODULE_REL));
    const green = runCopy(copy, dir);
    assert.equal(green.code, 0, `green control: the unmodified copy must pass\n${green.out}`);
    const restored = mutate(real(MODULE_REL), 'build = composedBuildDefines(workflowText, app, compose);', 'build = retiredBuildStepDefines(workflowText);');
    writeFileSync(copy, `${restored}\n${retiredBuildStepDefines.toString()}\n`);
    const red = runCopy(copy, dir);
    assert.ok(red.code === 1 || red.code === 2, `the literal-line reader passed the composed deploy-web.yml:\n${red.out}`);
    assert.match(red.out, /FAIL COVERAGE LOST — connect-origins: deploy-web\.yml has 0 `flutter build web` command\(s\); the compare models exactly one\./);
  });
});

describe('the compare, on the real tree and on mutated copies of it (red controls)', () => {
  test('RC7 — the real tree, with the public origins as fixture define values, is green', () => {
    const listed = listedOrigins(connectSrcOf(real(HEADERS_REL)));
    const r = run(null);
    assert.equal(r.code, 0, r.out);
    assert.match(r.stdout, new RegExp(`ok {3}connect-src equals the derived set in both directions \\(${listed.length} origin\\(s\\)\\)`));
  });

  test("RC5 — the app's API host on an origin connect-src does not name is red, and the old API host is then unused", () => {
    const r = run(tree({ appYaml: (t) => mutate(t, '  api: subscriptiontracker-api.nikatru.com\n', '  api: elsewhere-api.example.com\n') }));
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

  test('RC10 — an API_BASE_URL composed empty is red: the build would compile the placeholder fallback', () => {
    const r = run(tree({ workflow: (t) => mutate(t, BUILD_CALL, BUILD_CALL.replace('web web', 'web web --lane pr')) }));
    assert.equal(r.code, 1, r.out);
    assert.match(
      r.out,
      /placeholder origin: a define is empty — API_BASE_URL is composed empty, so the build would compile app_config\.dart's fallback https:\/\/subscriptiontracker-api\.your_subdomain\.workers\.dev/,
    );
  });

  test('an empty SUPABASE_URL is red the same way: the build would compile its placeholder fallback', () => {
    const r = run(tree(), { ...FIXTURE_ENV, SUPABASE_URL: '' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /placeholder origin: a define is empty — SUPABASE_URL has no value in this job, so the build would compile app_config\.dart's fallback https:\/\/your_project\.supabase\.co/);
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

  test('a URL define the composer stops passing is COVERAGE LOST (exit 2)', () => {
    const r = run(tree({ composer: (t) => mutate(t, "  define('API_BASE_URL', apiBase);\n", '') }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /API_BASE_URL is not passed by the web build the composer composes for deploy-web\.yml:\d+: define renamed\?/);
  });

  test('a URL define composed as neither one $NAME nor a value is COVERAGE LOST (exit 2)', () => {
    const r = run(tree({ composer: (t) => mutate(t, "  define('API_BASE_URL', apiBase);\n", "  define('API_BASE_URL', 'https://$API_HOST');\n") }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /API_BASE_URL is composed as `https:\/\/\$API_HOST`, neither one \$NAME nor a value/);
  });

  test('a new define the composer passes to the web build, in neither define list, is red', () => {
    const r = run(tree({ composer: (t) => mutate(t, "    define('APP_ENV', 'production');\n", "    define('APP_ENV', 'production');\n    define('STATUS_URL', '$STATUS_URL');\n") }));
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
    const red = run(tree(), { ...FIXTURE_ENV, SUPABASE_URL: '' }, ['--check', '--emit-connect']);
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
  const EMIT = 'node tooling/ci/flutter-release-build.mjs --emit-env API_BASE_URL ${{ matrix.app }} >> "$GITHUB_ENV"';

  test('the compare step (id connect) runs before the web build and before the launch smoke', () => {
    const all = steps();
    const compare = all.findIndex((s) => s.run?.text.trim() === COMPARE);
    const build = all.findIndex(isWebBuild);
    const smoke = all.findIndex((s) => s.run?.text.includes('node tooling/smoke/smoke-web-artifact.mjs'));
    assert.ok(compare !== -1, `deploy-web.yml no longer runs: ${COMPARE}`);
    assert.equal(all[compare].id, 'connect');
    assert.ok(build !== -1 && smoke !== -1, 'the composed build or the smoke step is gone');
    assert.ok(compare < build, 'the compare must run BEFORE the web build');
    assert.ok(compare < smoke, 'the compare must run before the smoke that consumes its output');
  });

  test('the compare maps exactly the $NAMEs the composed URL defines read, each from the build step\'s own expression', () => {
    const all = steps();
    const compare = all.find((s) => s.run?.text.trim() === COMPARE);
    const build = all.find(isWebBuild);
    assert.ok(compare && build, 'the compare or the composed build step is gone');
    const defines = composedBuildDefines(real(WORKFLOW_REL), APP, composerPrint(ROOT)).defines;
    const names = URL_DEFINES.map((n) => /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(defines.get(n))?.[1]).filter(Boolean);
    assert.ok(names.length > 0 && !names.includes('API_BASE_URL'), names.join(' '));
    assert.deepEqual([...compare.env.keys()].sort(), [...names].sort());
    for (const name of names) assert.equal(compare.env.get(name).value, build.env.get(name)?.value, name);
  });

  test('API_BASE_URL reaches the job from the --emit-env step, BEFORE the build and under its gate; no secret names it', () => {
    const all = steps();
    const emit = all.findIndex((s) => s.run?.text.trim() === EMIT);
    const build = all.findIndex(isWebBuild);
    assert.ok(emit !== -1, `deploy-web.yml no longer runs: ${EMIT}`);
    assert.ok(emit < build, 'the --emit-env step must run BEFORE the web build');
    assert.ok(all[build].cond, 'the build step lost its if: gate');
    assert.equal(all[emit].cond, all[build].cond, 'the --emit-env step must carry the build step\'s own if:');
    assert.ok(!real(WORKFLOW_REL).includes('secrets.API_BASE_URL'), 'deploy-web.yml reads the retired API_BASE_URL secret again');
  });

  test('the module sits inside the web deploy unit, so editing it redeploys web', () => {
    // deploy-web.yml is a workflow_call callee of ci.yml (#947): lane-map's deployUnits is the trigger now.
    assert.ok(JSON.parse(real('tooling/ci/lane-map.json')).deployUnits['<app>-web'].includes('tooling/web/**'));
  });
});
