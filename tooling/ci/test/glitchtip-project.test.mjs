// ─────────────────────────────────────────────────────────────────────────────
// glitchtip-project.test.mjs — assert-glitchtip-project.mjs must be able to FAIL,
// and must fail on the shapes that actually occurred.
//
// The guard holds one rule: every GlitchTip `--project` argument in
// .github/workflows resolves to the ONE declaration in
// tooling/ops/glitchtip-project.json, and never to the app slug.
//
// ⚠️ REAL-TREE NEGATIVE CONTROL FIRST, THEN FIXTURES. R1 is not invented: it is
// `origin/main` at a7b92d8e — the tree as it stood before this change —
// extracted and handed to the guard. That tree carried both defects at once:
// five call sites derived from the app slug (`--project "$APP"`,
// `--project "${env:APP}"`) and seven literals spelling the retired slug. A
// fixture the test author wrote would encode the same misunderstanding as the
// guard the test author wrote; the pre-fix tree cannot, because it predates
// both. Results, each exit code captured on its OWN LINE, never after a pipe and
// never after a trailing echo:
//   G   the repaired tree (the real .github/workflows)  -> exit 0, 12 call sites
//   R1  origin/main's workflows, unmodified             -> exit 1, app-derived
//   R2  the flag renamed away                           -> exit 1 COVERAGE LOST
//   R3  a literal reverted to the retired slug          -> exit 1, names it
//   R4  a variable whose step never reads the file      -> exit 1
//   R5  the declaration file deleted                    -> exit 1
//
// 🔴 THE POSITIVE CONTROL IS NOT OPTIONAL. Without a case that runs the guard
// against the REAL .github/workflows and demands exit 0, every refusal below is
// equally consistent with a guard that refuses everything it is shown.
//
// ── WHY THIS FILE SPELLS NEITHER SLUG ────────────────────────────────────────
// The declared project is read from the declaration the guard reads, so a rename
// moves both sides of every comparison at once and this file does not go red for
// a reason that has nothing to do with what it tests. The retired name appears
// only where a case must produce a value that is DIFFERENT from the declared
// one, and there it is composed, not typed.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-glitchtip-project.mjs');
const WORKFLOWS = join(REPO, '.github', 'workflows');
const DECL_REL = 'tooling/ops/glitchtip-project.json';
const DECL = JSON.parse(readFileSync(join(REPO, ...DECL_REL.split('/')), 'utf8'));
const DECLARED = DECL.project;
/** A project name that is definitely NOT the declared one, composed rather than
 *  typed, so this file never becomes the second declaration. */
const OTHER = `${DECLARED}-not`;

/** Run the guard. The exit code is read from the returned object on its own
 *  line — never through a pipe, and never after a trailing command, both of
 *  which report the LAST thing that ran rather than the guard. */
function run(dir, extra = []) {
  const r = spawnSync(process.execPath, [GUARD, '--workflows', dir, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'glitchtip-project-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A workflow directory built from the REAL files, optionally mutated. */
function stage(name, mutate = null) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
    let body = readFileSync(join(WORKFLOWS, f), 'utf8');
    if (mutate) body = mutate(f, body);
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

describe('the repaired tree passes', () => {
  test('G — the real .github/workflows: exit 0, and every call site is named', () => {
    const r = run(WORKFLOWS);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /call site\(s\)/);
    assert.match(r.out, new RegExp(`reads? ${DECL_REL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    // A FLOOR, not an equality: a new lane that uploads symbols must not fail
    // this test, but a rewrite that deletes every call site must not pass it.
    // Twelve on 2026-09-09.
    const named = r.out.split('\n').filter((l) => /^\s+\S+\.ya?ml:\d+/.test(l));
    assert.ok(named.length >= 12, `only ${named.length} call site(s) named:\n${r.out}`);
  });

  test('at least one call site actually reads the declaration in its own step', () => {
    const r = run(WORKFLOWS);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\(reads the declaration\)/);
  });
});

describe('an app-derived project name is refused', () => {
  test('R1 — `--project "$APP"`: exit 1, and the line is quoted back', () => {
    const dir = stage('app-derived', (f, body) =>
      f === 'build-platforms.yml' ? body.replace('--project "$gt_project"', '--project "$APP"') : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /derived from the APP SLUG/);
    assert.match(r.out, /--project "\$APP"/);
  });

  test('R1b — a `${{ matrix.app }}` expression is refused the same way', () => {
    const dir = stage('matrix-expr', (f, body) =>
      f === 'submit-play.yml'
        ? body.replace(`--project ${DECLARED}`, '--project ${{ matrix.app }}')
        : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /derived from the APP SLUG/);
  });

  test('R1c — the windows lane\'s `${env:APP}` form is refused', () => {
    const dir = stage('env-app', (f, body) =>
      f === 'build-platforms.yml' ? body.replace('--project $gt.project', '--project "${env:APP}"') : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /derived from the APP SLUG/);
  });
});

describe('a literal that is not the declaration is refused', () => {
  test('R3 — one lane spelling a different project: exit 1, and it is named', () => {
    const dir = stage('drift', (f, body) =>
      f === 'submit-snap.yml' ? body.replaceAll(`--project ${DECLARED}`, `--project ${OTHER}`) : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /do not name the declared project/);
    assert.match(r.out, new RegExp(OTHER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

describe('a variable whose step never reads the declaration is refused', () => {
  test('R4 — the read line deleted, the variable left behind: exit 1', () => {
    const dir = stage('unread-var', (f, body) =>
      f === 'deploy-web.yml'
        ? body
            .split('\n')
            .filter((l) => !l.includes('glitchtip-project.json'))
            .join('\n')
        : body,
    );
    const r = run(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /pass a VARIABLE whose step never reads/);
  });
});

describe('no call sites is COVERAGE LOST, never a pass', () => {
  test('R2 — the flag renamed away: exit 2 (COVERAGE LOST)', () => {
    const dir = stage('renamed-flag', (f, body) => body.replaceAll('--project ', '--gtproject '));
    const r = run(dir);
    assert.equal(r.code, 2, r.out); // COVERAGE LOST alone is exit 2, not a finding (O-EXIT2-CONVENTION-GAP)
    assert.match(r.out, /ZERO GlitchTip --project call sites/);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('an empty directory is also exit 2, not a silent pass', () => {
    const dir = join(TMP, 'empty');
    mkdirSync(dir, { recursive: true });
    const r = run(dir);
    assert.equal(r.code, 2, r.out); // COVERAGE LOST alone is exit 2, not a finding (O-EXIT2-CONVENTION-GAP)
    assert.match(r.out, /ZERO GlitchTip --project call sites/);
  });
});

describe('the declaration itself is graded', () => {
  test('R5 — a repo with no declaration file: exit 2 (COVERAGE LOST), naming the file', () => {
    // A whole shadow repo, so the guard resolves its own REPO root to a tree
    // that genuinely lacks the declaration rather than to this one.
    const shadow = join(TMP, 'shadow');
    mkdirSync(join(shadow, 'tooling', 'ci'), { recursive: true });
    mkdirSync(join(shadow, 'tooling', 'ops'), { recursive: true });
    cpSync(GUARD, join(shadow, 'tooling', 'ci', 'assert-glitchtip-project.mjs'));
    cpSync(join(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(shadow, 'tooling', 'ci', 'tree-walk.mjs'));
    const r = spawnSync(
      process.execPath,
      [join(shadow, 'tooling', 'ci', 'assert-glitchtip-project.mjs'), '--workflows', WORKFLOWS],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`); // COVERAGE LOST alone is exit 2, not a finding (O-EXIT2-CONVENTION-GAP)
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST — tooling\/ops\/glitchtip-project\.json does not exist/);
  });

  test('a declaration with no project is refused', () => {
    const shadow = join(TMP, 'shadow-empty');
    mkdirSync(join(shadow, 'tooling', 'ci'), { recursive: true });
    mkdirSync(join(shadow, 'tooling', 'ops'), { recursive: true });
    cpSync(GUARD, join(shadow, 'tooling', 'ci', 'assert-glitchtip-project.mjs'));
    cpSync(join(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(shadow, 'tooling', 'ci', 'tree-walk.mjs'));
    writeFileSync(join(shadow, 'tooling', 'ops', 'glitchtip-project.json'), JSON.stringify({ org: 'nikatru' }));
    const r = spawnSync(
      process.execPath,
      [join(shadow, 'tooling', 'ci', 'assert-glitchtip-project.mjs'), '--workflows', WORKFLOWS],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /non-empty string/);
  });

  /** A shadow repo holding a copy of the guard, every local module it imports
   *  (transitively), and the given declaration, so the guard's REPO root is this tree. */
  function shadowWith(name, declaration) {
    const shadow = join(TMP, name);
    const ci = join(shadow, 'tooling', 'ci');
    mkdirSync(ci, { recursive: true });
    mkdirSync(join(shadow, 'tooling', 'ops'), { recursive: true });
    const pending = ['assert-glitchtip-project.mjs'];
    const copied = new Set();
    while (pending.length) {
      const f = pending.pop();
      if (copied.has(f)) continue;
      copied.add(f);
      const body = readFileSync(join(REPO, 'tooling', 'ci', f), 'utf8');
      writeFileSync(join(ci, f), body);
      for (const m of body.matchAll(/from '\.\/([\w.-]+\.mjs)'/g)) pending.push(m[1]);
    }
    writeFileSync(join(shadow, 'tooling', 'ops', 'glitchtip-project.json'), JSON.stringify(declaration, null, 2));
    return join(ci, 'assert-glitchtip-project.mjs');
  }

  /** spawn, not spawnSync: the recording server below lives in THIS process and must
   *  be able to answer while the guard runs. */
  function runAsync(args, env) {
    return new Promise((done) => {
      const child = spawn(process.execPath, args, { env });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ code, out }));
    });
  }

  test('an instance that is not the pinned host is refused OFFLINE — the PR that edits it is red in CI (CodeQL #293)', () => {
    const guard = shadowWith('shadow-lookalike', { ...DECL, instance: 'https://glitchtip.nikatru.com.evil.test' });
    const r = spawnSync(process.execPath, [guard, '--workflows', WORKFLOWS], { encoding: 'utf8' });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /only ever sent to https:\/\/glitchtip\.nikatru\.com\./);
  });

  test('🔴 --live never sends GLITCHTIP_TOKEN to a host the declaration names (CodeQL #293)', async () => {
    const seen = [];
    const server = createServer((req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization ?? null });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    try {
      const guard = shadowWith('shadow-foreign-host', { ...DECL, instance: `http://127.0.0.1:${server.address().port}` });
      const env = { ...process.env, GLITCHTIP_TOKEN: 'a-token-that-must-not-leave' };
      delete env.GLITCHTIP_URL;
      const r = await runAsync([guard, '--workflows', WORKFLOWS, '--live'], env);
      assert.deepEqual(seen, [], `the token was sent to the host the declaration named: ${JSON.stringify(seen)}`);
      assert.equal(r.code, 1, r.out);
    } finally {
      server.close();
    }
  });

  test('the real declaration names the pinned host — the refusal above does not refuse the repository', () => {
    assert.equal(new URL(DECL.instance).hostname, 'glitchtip.nikatru.com');
    const r = run(WORKFLOWS);
    assert.equal(r.code, 0, r.out);
  });
});

describe('the boundary against Cloudflare Pages is deliberate', () => {
  test('`--project-name=` is a Pages project and is NOT read as a GlitchTip one', () => {
    // deploy-web.yml carries `pages deploy --project-name=${{ matrix.app }}`,
    // which IS derived from the app slug and is CORRECT that way: the Pages
    // project is one per app. Reading it as a GlitchTip call site would make
    // this guard demand a change that would break the deployment.
    const r = run(WORKFLOWS);
    assert.equal(r.code, 0, r.out);
    assert.ok(
      readFileSync(join(WORKFLOWS, 'deploy-web.yml'), 'utf8').includes('--project-name='),
      'deploy-web.yml no longer carries --project-name=; this boundary case has stopped testing anything.',
    );
  });
});

describe('--live refuses to report a pass it did not make', () => {
  test('with no GLITCHTIP_TOKEN, --live is exit 2 (COVERAGE LOST) and names the secret', () => {
    const env = { ...process.env };
    delete env.GLITCHTIP_TOKEN;
    const r = spawnSync(process.execPath, [GUARD, '--live'], { encoding: 'utf8', env });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /GLITCHTIP_TOKEN/);
  });
});

// ── O-EXIT2-CONVENTION-GAP: --live against a STUBBED instance, never the real one ────────────────
// GLITCHTIP_URL points the one GET at a server in THIS process (an operator's per-run choice the
// guard already honours), so every answer the network can give is produced on demand. What could
// not be ASKED is exit 2; what the instance ANSWERED no to (404) is exit 1; 200 is 0.
describe('--live: could-not-ask is exit 2, an answered no is exit 1', () => {
  /** spawn, not spawnSync: the stub server lives in THIS process and must answer while the guard runs. */
  function liveAgainst(baseUrl, token = 'stub-token') {
    const env = { ...process.env, GLITCHTIP_URL: baseUrl };
    if (token === null) delete env.GLITCHTIP_TOKEN;
    else env.GLITCHTIP_TOKEN = token;
    return new Promise((done) => {
      const child = spawn(process.execPath, [GUARD, '--live'], { env });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ code, out }));
    });
  }
  async function withStub(status, body, fn) {
    const server = createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    try {
      return await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.close();
    }
  }

  test('green control: the stub answers 200 with the project — exit 0', async () => {
    const r = await withStub(200, JSON.stringify({ slug: DECLARED, id: 1 }), (u) => liveAgainst(u));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /live check OK/);
  });

  test('401 — the credential is refused: exit 2 COVERAGE LOST, never a finding', async () => {
    const r = await withStub(401, '{"detail":"Invalid token."}', (u) => liveAgainst(u));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the live instance answers 401: it refused the credential/);
  });

  test('403 — the credential cannot see the project: exit 2 COVERAGE LOST', async () => {
    const r = await withStub(403, '{}', (u) => liveAgainst(u));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the live instance answers 403/);
  });

  test('503 — the instance could not answer: exit 2 COVERAGE LOST', async () => {
    const r = await withStub(503, 'down', (u) => liveAgainst(u));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the live instance answers 503: it could not answer/);
  });

  test('200 with a body that is not JSON: exit 2 COVERAGE LOST, not a crash', async () => {
    const r = await withStub(200, '<html>login</html>', (u) => liveAgainst(u));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — the live instance answered 200 with a body that is not JSON/);
  });

  test('404 — the instance ANSWERED that the project does not exist: exit 1, a finding', async () => {
    const r = await withStub(404, '{"detail":"Not found."}', (u) => liveAgainst(u));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the live instance answers 404/);
  });

  test('an UNREACHABLE instance (nothing listening) is exit 2 COVERAGE LOST, naming the host', async () => {
    const server = createServer();
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    const port = server.address().port;
    await new Promise((closed) => server.close(closed));
    const r = await liveAgainst(`http://127.0.0.1:${port}`);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, new RegExp(`COVERAGE LOST — could not reach http://127\\.0\\.0\\.1:${port}`));
  });

  test('an EMPTY GLITCHTIP_TOKEN is the same as none — exit 2, and nothing is sent', async () => {
    let asked = 0;
    const server = createServer((req, res) => { asked++; res.writeHead(200); res.end('{}'); });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    try {
      const r = await liveAgainst(`http://127.0.0.1:${server.address().port}`, '');
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /COVERAGE LOST — --live needs GLITCHTIP_TOKEN/);
      assert.equal(asked, 0);
    } finally {
      server.close();
    }
  });
});

describe('the offline inputs: could-not-read is exit 2', () => {
  test('a workflow directory that does not exist: exit 2, naming it', () => {
    const r = run(join(TMP, 'no-such-workflows-dir'));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — no workflow directory at .*no-such-workflows-dir/);
  });

  test('a declaration that is not JSON: exit 2, naming the file', () => {
    const shadow = join(TMP, 'shadow-badjson');
    mkdirSync(join(shadow, 'tooling', 'ci'), { recursive: true });
    mkdirSync(join(shadow, 'tooling', 'ops'), { recursive: true });
    cpSync(GUARD, join(shadow, 'tooling', 'ci', 'assert-glitchtip-project.mjs'));
    cpSync(join(REPO, 'tooling', 'ci', 'tree-walk.mjs'), join(shadow, 'tooling', 'ci', 'tree-walk.mjs'));
    writeFileSync(join(shadow, 'tooling', 'ops', 'glitchtip-project.json'), '{ "org": ');
    const r = spawnSync(
      process.execPath,
      [join(shadow, 'tooling', 'ci', 'assert-glitchtip-project.mjs'), '--workflows', WORKFLOWS],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST — tooling\/ops\/glitchtip-project\.json is not valid JSON/);
  });
});

describe('an unknown flag is exit 2, never a quiet default', () => {
  test('--nope: exit 2', () => {
    const r = spawnSync(process.execPath, [GUARD, '--nope'], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  });
});

describe('the guard is reachable from CI', () => {
  test('ci.yml invokes it', () => {
    const ci = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8');
    assert.ok(
      ci.includes('tooling/ci/assert-glitchtip-project.mjs'),
      'assert-glitchtip-project.mjs is not invoked by ci.yml — an unwired guard is not a guard.',
    );
  });
  test('the enforcement index carries it as WIRED', () => {
    const idx = JSON.parse(readFileSync(join(REPO, 'tooling', 'enforcement-index.json'), 'utf8'));
    const rows = Array.isArray(idx) ? idx : (idx.entries ?? []);
    const row = rows.find((e) => e.ref === 'tooling/ci/assert-glitchtip-project.mjs');
    assert.ok(row, 'no enforcement-index row for assert-glitchtip-project.mjs');
    assert.equal(row.state, 'WIRED');
  });
});

test('the guard file exists where the index says it does', () => {
  assert.ok(existsSync(GUARD));
});
