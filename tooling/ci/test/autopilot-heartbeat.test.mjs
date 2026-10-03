// autopilot-heartbeat.test.mjs — the laptop heartbeat (tooling/autopilot/heartbeat.mjs)
// and the Windows-safe CLI helpers it spawns through (tooling/autopilot/cli.mjs).
// Lane autopilot-outage, row O-LAPTOP-OUTAGE-READS-AS-RED. Every case is a red control:
// the boundary, the mode or the garbage that would read the laptop's state wrong.
//
// Run:  node --test "tooling/ci/test/autopilot-heartbeat.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { laptopState, parseBeat, nextBeat, stateLine, writeBeat, ghApi, readBeatApi, readBeatGit, isBranchOrTag, assertBeatRef, REF_PATH, STALE_MIN, STATE_EXIT, HB } from '../../autopilot/heartbeat.mjs';
import { isMain, samePath, ghSpawnSpec, redact } from '../../autopilot/cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', '..', 'autopilot', 'heartbeat.mjs');
const NOW = Date.parse('2026-10-02T12:00:00Z');
const MIN = 60_000;
const beat = (ageMin, mode = 'primary', seq = 7) => ({ v: 1, at: new Date(NOW - ageMin * MIN).toISOString(), seq, mode, host: 'laptop' });
const stateOf = (b) => laptopState(parseBeat(JSON.stringify(b)), NOW).state;

describe('laptopState — the one reading of a beat', () => {
  test('STALE_MIN is the contract’s 30', () => assert.equal(STALE_MIN, 30));
  test('🔴 29 min → fresh; 31 min → stale (the boundary both ways)', () => {
    assert.equal(stateOf(beat(29)), 'fresh');
    assert.equal(stateOf(beat(31)), 'stale');
    assert.equal(stateOf(beat(30)), 'fresh', 'exactly STALE_MIN is not yet stale');
  });
  test('🔴 handover at age 0 → handover (the laptop said it is leaving, however fresh)', () => {
    assert.equal(stateOf(beat(0, 'handover')), 'handover');
    assert.equal(stateOf(beat(120, 'handover')), 'handover');
  });
  test('🔴 a drill beat: stale → drill-stale, fresh → fresh', () => {
    assert.equal(stateOf(beat(45, 'drill')), 'drill-stale');
    assert.equal(stateOf(beat(5, 'drill')), 'fresh');
  });
  test('🔴 garbled JSON, a missing beat and an off-schema beat → unknown', () => {
    assert.equal(laptopState(parseBeat('{"v":1,"at":'), NOW).state, 'unknown');
    assert.equal(laptopState(parseBeat(null), NOW).state, 'unknown');
    assert.equal(laptopState(null, NOW).state, 'unknown');
    for (const bad of [{ ...beat(1), v: 2 }, { ...beat(1), host: 'cloud' }, { ...beat(1), mode: 'sleep' }, { ...beat(1), seq: -1 }, { ...beat(1), seq: 1.5 }, { ...beat(1), at: '2026-10-02 11:00' }]) {
      assert.equal(stateOf(bad), 'unknown', JSON.stringify(bad));
    }
  });
  test('🔴 a beat more than FUTURE_SKEW_MIN in the future → unknown; inside the skew → fresh', () => {
    assert.equal(stateOf(beat(-(HB.FUTURE_SKEW_MIN + 1))), 'unknown');
    assert.equal(stateOf(beat(-(HB.FUTURE_SKEW_MIN - 1))), 'fresh');
  });
  test('the read line and the exit map', () => {
    assert.equal(stateLine(laptopState(parseBeat(JSON.stringify(beat(45))), NOW)), `stale age=45 at=${beat(45).at} mode=primary seq=7`);
    assert.match(stateLine(laptopState(null, NOW)), /^unknown age=\? at=\? mode=\? seq=\? \(no readable beat\)$/);
    assert.deepEqual(STATE_EXIT, { fresh: 0, stale: 10, handover: 11, 'drill-stale': 12, unknown: 2 });
  });
});

describe('the writer — tree, parentless commit, forced ref; seq from the previous beat', () => {
  const fakeGh = (prev, { refMissing = false } = {}) => {
    const calls = [];
    const gh = (method, path, body = null) => {
      calls.push({ method, path, body });
      if (method === 'GET') {
        if (prev === undefined) throw new Error('gh api GET …: HTTP 404');
        if (path.includes('/git/ref/')) return { object: { sha: 'b'.repeat(40) } };
        return { content: Buffer.from(typeof prev === 'string' ? prev : JSON.stringify(prev)).toString('base64') };
      }
      if (path.endsWith('/git/trees')) return { sha: 't'.repeat(40) };
      if (path.endsWith('/git/commits')) return { sha: 'c'.repeat(40) };
      if (method === 'PATCH' && refMissing) throw new Error('gh api PATCH …: Reference does not exist (HTTP 422)');
      return {};
    };
    return { gh, calls };
  };
  test('seq = previous + 1; the tree holds beat.json inline; the commit has NO parent; the ref is forced', () => {
    const { gh, calls } = fakeGh(beat(10, 'primary', 41));
    const r = writeBeat({ repo: 'o/r', mode: 'primary', now: new Date(NOW), gh });
    assert.equal(r.beat.seq, 42);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`), ['GET repos/o/r/git/ref/lead/heartbeat', 'GET repos/o/r/contents/beat.json', 'POST repos/o/r/git/trees', 'POST repos/o/r/git/commits', 'PATCH repos/o/r/git/refs/lead/heartbeat']);
    assert.equal(calls[1].path, `repos/o/r/contents/beat.json?ref=${'b'.repeat(40)}`, 'the previous beat is read at the sha the ref names');
    calls.splice(0, 1);
    const content = JSON.parse(calls[1].body.tree[0].content);
    assert.deepEqual(content, { v: 1, at: '2026-10-02T12:00:00.000Z', seq: 42, mode: 'primary', host: 'laptop' });
    assert.equal(parseBeat(JSON.stringify(content)).seq, 42, 'the writer writes what the reader reads');
    assert.deepEqual(calls[2].body.parents, []);
    assert.equal(calls[3].body.force, true);
  });
  test('🔴 the first beat (no ref) and a garbled previous beat restart at seq 1; a missing ref is CREATED', () => {
    const first = fakeGh(undefined, { refMissing: true });
    assert.equal(writeBeat({ repo: 'o/r', mode: 'drill', now: new Date(NOW), gh: first.gh }).beat.seq, 1);
    assert.deepEqual(first.calls.at(-1), { method: 'POST', path: 'repos/o/r/git/refs', body: { ref: 'refs/lead/heartbeat', sha: 'c'.repeat(40) } });
    assert.equal(writeBeat({ repo: 'o/r', mode: 'primary', now: new Date(NOW), gh: fakeGh('{garbage').gh }).beat.seq, 1);
  });
  test('🔴 a PATCH refused for any other reason is not papered over with a create', () => {
    const gh = (method, path) => {
      if (method === 'GET') throw new Error('404');
      if (method === 'PATCH') throw new Error('gh api PATCH …: HTTP 403 Resource not accessible');
      return { sha: 'x'.repeat(40) };
    };
    assert.throws(() => writeBeat({ repo: 'o/r', mode: 'primary', gh }), /403/);
  });
  test('🔴 an unknown mode is refused', () => assert.throws(() => nextBeat(null, { mode: 'nap' }), /--mode/));
  test('🔴 writeBeat NEVER targets refs/heads/ (a moving branch starts a Cloudflare Pages build every beat)', () => {
    for (const run of [fakeGh(beat(10, 'primary', 41)), fakeGh(undefined, { refMissing: true })]) {
      writeBeat({ repo: 'o/r', mode: 'primary', now: new Date(NOW), gh: run.gh });
      const writes = run.calls.filter((c) => c.method !== 'GET');
      assert.ok(writes.some((c) => /\/git\/refs/.test(c.path)), 'the ref write was made');
      for (const c of run.calls) {
        assert.doesNotMatch(c.path, /refs\/heads\/|\/git\/refs?\/heads\//, `${c.method} ${c.path} targets a branch`);
        assert.doesNotMatch(JSON.stringify(c.body ?? {}), /refs\/(?:heads|tags)\//, `${c.method} ${c.path} body names a branch or tag`);
      }
    }
    assert.equal(HB.ref, 'refs/lead/heartbeat');
    assert.equal(REF_PATH, 'lead/heartbeat');
    assert.equal(isBranchOrTag(HB.ref), false);
    assert.equal(isBranchOrTag('refs/heads/lead/heartbeat'), true, 'the guard would refuse a branch');
    assert.equal(isBranchOrTag('refs/tags/heartbeat'), true);
  });
});

describe('Windows: the spawn and the entry point', () => {
  test('🔴 gh is spawned as a FILE with an argv array, shell:false, a 60 s ceiling, JSON on stdin', () => {
    let seen;
    const run = (file, args, options) => {
      seen = { file, args, options };
      return '{"sha":"abc"}';
    };
    assert.deepEqual(ghApi('POST', 'repos/o/r/git/trees', { tree: [] }, { run }), { sha: 'abc' });
    assert.equal(seen.file, 'gh', 'no shell, no .sh/.cmd helper, no shebang script');
    assert.deepEqual(seen.args, ['api', '--method', 'POST', 'repos/o/r/git/trees', '--input', '-']);
    assert.equal(seen.options.shell, false);
    assert.equal(seen.options.timeout, 60_000);
    assert.equal(seen.options.input, '{"tree":[]}');
    assert.ok(!seen.args.some((a) => /\\|\.sh$|\.cmd$|^\/bin\//.test(a)), 'no path or helper in the argv');
  });
  test('🔴 a gh failure is rethrown with the token REDACTED', () => {
    const run = () => {
      const e = new Error('x');
      // Built at run time so no secret-shaped literal sits in the tree (gitleaks).
      e.stderr = `HTTP 401 bad credentials ${['ghp', 'a1'.repeat(18)].join('_')}`;
      throw e;
    };
    assert.throws(() => ghApi('GET', 'repos/o/r', null, { run }), (e) => /\[redacted\]/.test(e.message) && !/ghp_/.test(e.message));
    assert.equal(redact(['github', 'pat', 'B2'.repeat(12)].join('_')), '[redacted]');
  });
  test('🔴 git is spawned the same way when reading', () => {
    const seen = [];
    const run = (file, args, options) => {
      seen.push({ file, args, shell: options.shell });
      return file === 'git' && args[0] === 'show' ? JSON.stringify(beat(3)) : '';
    };
    const got = readBeatGit({ run });
    assert.equal(parseBeat(got.text).seq, 7);
    assert.deepEqual(seen.map((s) => `${s.file} ${s.args[0]} shell=${s.shell}`), ['git fetch shell=false', 'git show shell=false']);
    assert.equal(seen[0].args.at(-1), '+refs/lead/heartbeat:refs/lead/heartbeat', 'fetched by its full name into the same non-branch name');
  });
  test('🔴 the entry point matches a Windows argv whatever the drive letter’s case or slash direction', () => {
    const url = 'file:///C:/Users/owner/Nikatru_Platform_Public/tooling/autopilot/heartbeat.mjs';
    assert.equal(isMain(url, 'c:\\users\\owner\\Nikatru_Platform_Public\\tooling\\autopilot\\heartbeat.mjs', 'win32'), true);
    assert.equal(isMain(url, 'C:/Users/owner/Nikatru_Platform_Public/tooling/autopilot/heartbeat.mjs', 'win32'), true);
    assert.equal(isMain(url, 'C:\\Users\\owner\\Nikatru_Platform_Public\\tooling\\autopilot\\cli.mjs', 'win32'), false);
    assert.equal(isMain('file:///home/u/r/x.mjs', '/home/u/r/X.mjs', 'linux'), false, 'POSIX stays case-sensitive');
    assert.equal(samePath('C:\\a\\b', 'c:/A/B', 'win32'), true);
    assert.equal(isMain(url, undefined, 'win32'), false);
  });
  test('the default ceiling is the contract’s CALL_CEILING_S', () => {
    assert.equal(ghSpawnSpec(['api', 'x']).options.timeout, HB.CALL_CEILING_S * 1000);
  });
});

describe('the reader over the contents API', () => {
  test('raw content with an optional token; a non-200 or a throw is "no beat" (→ unknown), never a guess', async () => {
    let auth;
    const urls = [];
    const ok = await readBeatApi({ repo: 'o/r', token: 't0k', fetchImpl: async (url, init) => {
      auth = init.headers.authorization;
      urls.push(url);
      if (url.includes('/git/ref/')) return { ok: true, json: async () => ({ object: { sha: 'd'.repeat(40) } }) };
      return { ok: true, text: async () => JSON.stringify(beat(1)) };
    } });
    assert.equal(auth, 'Bearer t0k');
    assert.equal(parseBeat(ok.text).seq, 7);
    assert.match(urls[0], /\/repos\/o\/r\/git\/ref\/lead\/heartbeat$/);
    assert.match(urls[1], new RegExp(`/repos/o/r/contents/beat\\.json\\?ref=${'d'.repeat(40)}$`));
    assert.ok(!urls.some((u) => /heads/.test(u)), 'never read as a branch');
    const anon = await readBeatApi({ repo: 'o/r', fetchImpl: async (url, init) => (url.includes('/git/ref/') ? { ok: true, json: async () => ({ object: { sha: 'd'.repeat(40) } }) } : { ok: true, text: async () => String(init.headers.authorization) }) });
    assert.equal(anon.text, 'undefined', 'no token → no authorization header');
    assert.equal((await readBeatApi({ repo: 'o/r', fetchImpl: async () => ({ ok: false, status: 404 }) })).text, null);
    // A ref that names no sha is no beat, and no contents URL is built from it: the fake can
    // answer `text()`, so only the SHA_SHAPE refusal stops the second request.
    const calls = [];
    const noSha = await readBeatApi({ repo: 'o/r', fetchImpl: async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ object: { sha: '../x' } }), text: async () => JSON.stringify(beat(1)) }; } });
    assert.equal(noSha.text, null, 'a ref that names no sha is no beat');
    assert.match(noSha.why, /does not name a commit sha/);
    assert.equal(calls.length, 1, `one request (the ref), no contents URL: ${calls.join(' | ')}`);
    assert.equal((await readBeatApi({ repo: 'o/r', fetchImpl: async () => { throw new Error('ECONNRESET'); } })).text, null);
  });
  test('🔴 a repo outside owner/name never reaches a request (CodeQL 582)', async () => {
    let called = false;
    const r = await readBeatApi({ repo: 'evil.example/x/y', fetchImpl: async () => { called = true; return { ok: true, text: async () => '' }; } });
    assert.equal(r.text, null);
    assert.equal(called, false);
  });
  test('🔴 assertBeatRef refuses a branch or a tag, and passes the contract’s ref', () => {
    assert.throws(() => assertBeatRef('refs/heads/x'), /is a branch or a tag/);
    assert.throws(() => assertBeatRef('refs/tags/x'), /is a branch or a tag/);
    assert.doesNotThrow(() => assertBeatRef(HB.ref));
  });
  test('🔴 the module REFUSES TO LOAD when its contract names a branch (the load-time call)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hb-'));
    try {
      const src = resolve(HERE, '..', '..', 'autopilot');
      // One directory per contract: cli.mjs (which reads contract.json) is cached per URL.
      const copy = (name, ref) => {
        const dir = join(tmp, name);
        mkdirSync(dir);
        for (const f of ['heartbeat.mjs', 'cli.mjs']) copyFileSync(join(src, f), join(dir, f));
        const contract = JSON.parse(readFileSync(join(src, 'contract.json'), 'utf8'));
        contract.heartbeat.ref = ref;
        writeFileSync(join(dir, 'contract.json'), JSON.stringify(contract));
        return pathToFileURL(join(dir, 'heartbeat.mjs')).href;
      };
      const ok = await import(copy('green', HB.ref));
      assert.equal(ok.HB.ref, HB.ref, 'green control: the copy loads on the real contract');
      await assert.rejects(import(copy('branch', 'refs/heads/x')), /refs\/heads\/x is a branch or a tag/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  test('the CLI refuses bad usage with exit 2', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'write'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /usage: write --once \| --loop/);
    const m = spawnSync(process.execPath, [SCRIPT, 'write', '--once', '--mode', 'nap'], { encoding: 'utf8' });
    assert.equal(m.status, 2);
  });
});
