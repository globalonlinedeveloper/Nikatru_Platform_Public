// autopilot-queue-migrate.test.mjs — tooling/autopilot/queue-migrate.mjs, the laptop's
// queue → Issues in the PRIVATE repo (lane autopilot-queue-issues).
//
// Every case drives main() over a throwaway queue/prompts/routines/markers tree and an
// in-memory GitHub (fetch is injected; nothing leaves the process). Red controls:
//   QM1  a 3-item queue — a chain, a satisfied marker, an alias — gives the expected plan,
//        and --apply writes it in two passes with the real #N in the dependent's body
//   QM2  a fake vault value in a body is refused, and the value is absent from every
//        line printed and every request sent; only the KEY is named
//   QM3  a rerun creates nothing (idempotent by title) and changes nothing
//   QM4  a 70,000-character prompt is written as the issue body plus 1 continuation
//        comment, and reads back whole
//   QM5  a missing prompt file is refused and listed (exit 1); the others still plan
//   QM6  Windows dep paths (backslashes, drive letters, upper-case LWLD) resolve; an
//        un-rewritten user-profile path or a token-shaped string in a body is refused
//   QM7  --apply refuses a target repo that is not private, and writes nothing
//   QM8  launched (a .routine) and already-merged lanes are skipped; no merged-PR facts
//        and no token is COVERAGE LOST (exit 2); --only narrows to one lane
//   QM9  Windows-safe by construction: no child_process, no shell, no shebang spawn
//
// Every lane name and prompt is invented. Token-shaped strings are assembled at run time
// so the repo's own secret scan never sees one in this file. Run:
//   node --test "tooling/ci/test/autopilot-queue-migrate.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, markerName, parseVault, secretFindings } from '../../autopilot/queue-migrate.mjs';
import { CONTRACT, parseIssue } from '../../autopilot/issue-queue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = 'acme-owner/queue-private';
const OWNER = 'acme-owner';

/** An in-memory GitHub for one private repo and one public repo's PRs. */
function fakeGitHub({ isPrivate = true, mergedBranches = [] } = {}) {
  const st = { issues: [], comments: [], labels: [], nextIssue: 1, nextComment: 9000, requests: [] };
  const json = (status, body) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    st.requests.push({ method, path: u.pathname + u.search, body: init.body ?? '' });
    const page = Number(u.searchParams.get('page') ?? '1');
    const paged = (xs) => json(200, page === 1 ? xs : []);
    const p = u.pathname;
    let m;
    if (p.endsWith('/pulls')) return paged(mergedBranches.map((b, i) => ({ number: i + 1, head: { ref: b }, merged_at: '2026-10-01T00:00:00Z' })));
    if (p === `/repos/${REPO}`) return json(200, { private: isPrivate });
    if (p === `/repos/${REPO}/labels`) {
      if (method === 'POST') { st.labels.push({ name: body.name }); return json(201, { name: body.name }); }
      return paged(st.labels);
    }
    if (p === `/repos/${REPO}/issues`) {
      if (method === 'POST') {
        const issue = { number: st.nextIssue++, title: body.title, body: body.body, labels: body.labels.map((name) => ({ name })), state: 'open', state_reason: null };
        st.issues.push(issue);
        return json(201, issue);
      }
      return paged(st.issues);
    }
    if ((m = /^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(p))) {
      const id = Number(m[1]);
      if (method === 'DELETE') { st.comments = st.comments.filter((x) => x.id !== id); return json(204); }
      const cm = st.comments.find((x) => x.id === id);
      cm.body = body.body;
      return json(200, cm);
    }
    if ((m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(p))) {
      const n = Number(m[1]);
      if (method === 'POST') {
        const cm = { id: st.nextComment++, issue: n, body: body.body, user: { login: OWNER }, created_at: '2026-10-02T00:00:00Z' };
        st.comments.push(cm);
        return json(201, cm);
      }
      return paged(st.comments.filter((x) => x.issue === n));
    }
    if ((m = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(p))) {
      const issue = st.issues.find((x) => x.number === Number(m[1]));
      if (body.body !== undefined) issue.body = body.body;
      if (body.labels) issue.labels = body.labels.map((name) => ({ name }));
      return json(200, issue);
    }
    return json(404, { message: 'no route' });
  };
  return { st, fetchImpl, bodyOf: (lane) => st.issues.find((i) => i.title === `lane: ${lane}`) };
}

/** A throwaway laptop tree: queue.json, prompts/, routines/, markers/. */
function laptop({ items, prompts = {}, routines = [], markers = {}, aliases = null, vault = null, state = { mergedBranches: [] } }) {
  const root = mkdtempSync(join(tmpdir(), 'queue-migrate-'));
  const d = (x) => { const p = join(root, x); mkdirSync(p, { recursive: true }); return p; };
  const dirs = { prompts: d('prompts'), routines: d('routines'), markers: d('markers') };
  writeFileSync(join(root, 'queue.json'), JSON.stringify({ items }));
  for (const [lane, text] of Object.entries(prompts)) writeFileSync(join(dirs.prompts, `${lane}.prompt.md`), text);
  for (const lane of routines) writeFileSync(join(dirs.routines, `${lane}.routine`), '{}');
  for (const [name, text] of Object.entries(markers)) writeFileSync(join(dirs.markers, `${name}.out`), text);
  const args = ['--queue', join(root, 'queue.json'), '--prompts-dir', dirs.prompts, '--routines-dir', dirs.routines, '--markers-dir', dirs.markers, '--repo', REPO, '--map-out', join(root, 'map.json')];
  if (aliases) { writeFileSync(join(root, 'aliases.json'), JSON.stringify(aliases)); args.push('--aliases', join(root, 'aliases.json')); }
  if (vault) { writeFileSync(join(root, 'vault.env'), vault); args.push('--vault', join(root, 'vault.env')); }
  if (state) { writeFileSync(join(root, 'state.json'), JSON.stringify(state)); args.push('--state', join(root, 'state.json')); }
  return { root, args };
}

async function run(args, { gh = null, token = 'tok-test-value-0001' } = {}) {
  const out = [];
  const code = await main(args, {
    env: token ? { GITHUB_TOKEN: token } : {},
    fetchImpl: gh ? gh.fetchImpl : async () => { throw new Error('no network in this case'); },
    log: (s) => out.push(String(s)),
    err: (s) => out.push(String(s)),
  });
  return { code, out: out.join('\n') };
}

const item = (lane, over = {}) => ({ lane, cloud: true, lander: `^autopilot/${lane}$`, priority: '1', effort: 'high', model: 'm', ceil: 2, acctPref: '3', transport: 'cloud', deps: [], ...over });
const MD = 'C:/lanes/state'; // an invented laptop root, written as the laptop would

test('QM1 a chain, a satisfied marker and an alias give the expected plan, and apply fills #N', async () => {
  const t = laptop({
    items: [
      item('alpha-one', { deps: [`${MD}/lwld-cloudroutine-gate-alpha.out`, `${MD}/lwld-finished-thing.out`] }),
      item('beta-two', { priority: '0.5', deps: [`${MD}/lwld-alpha-old-name.out`, `${MD}/lwld-laptop-step.out`] }),
      item('gamma-three', { priority: '2', acctPref: '1', deps: [`${MD}/lwld-beta-two.out`, `${MD}/lwld-delta-local.out`] }),
      { lane: 'delta-local', cloud: false, lander: '^autopilot/delta-local$' },
    ],
    prompts: { 'alpha-one': 'Invented prompt A.', 'beta-two': 'Invented prompt B.', 'gamma-three': 'Invented prompt C.' },
    markers: { 'lwld-finished-thing': 'start\nland exit=0\n', 'lwld-laptop-step': 'land exit=1\n' },
    aliases: { 'alpha-old-name': 'alpha-one' },
  });
  const dry = await run(t.args, { token: null });
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /create  lane: alpha-one {2}labels=cloud-lane,ready,prio:1,acct:3 {2}deps=\[\]/);
  assert.match(dry.out, /create  lane: beta-two {2}labels=cloud-lane,blocked,prio:0\.5,acct:3 {2}deps=\[#<alpha-one> marker:lwld-laptop-step\]/);
  assert.match(dry.out, /create  lane: gamma-three {2}labels=cloud-lane,blocked,prio:2,acct:1 {2}deps=\[#<beta-two> PR:\^autopilot\/delta-local\$\]/);
  assert.match(dry.out, /3 to create/);

  const gh = fakeGitHub();
  const applied = await run([...t.args, '--apply'], { gh });
  assert.equal(applied.code, 0, applied.out);
  const map = JSON.parse(readFileSync(join(t.root, 'map.json'), 'utf8'));
  assert.deepEqual(Object.keys(map).sort(), ['alpha-one', 'beta-two', 'gamma-three']);
  const beta = parseIssue(gh.bodyOf('beta-two'));
  assert.deepEqual(beta.deps, [{ kind: 'issue', number: map['alpha-one'] }, { kind: 'marker', name: 'lwld-laptop-step' }]);
  assert.equal(beta.prompt, 'Invented prompt B.');
  const gamma = parseIssue(gh.bodyOf('gamma-three'));
  assert.deepEqual(gamma.deps, [{ kind: 'issue', number: map['beta-two'] }, { kind: 'pr', regex: '^autopilot/delta-local$' }]);
  // two passes: every create is followed by an edit carrying the final body
  assert.equal(gh.st.requests.filter((r) => r.method === 'POST' && r.path === `/repos/${REPO}/issues`).length, 3);
  for (const i of gh.st.issues) assert.ok(!i.body.includes('migration in progress'), `#${i.number} still holds its stub`);
  const names = new Set(gh.st.labels.map((l) => l.name));
  for (const l of [...CONTRACT.labels.fixed, ...CONTRACT.priorities.map((p) => `prio:${p}`)]) assert.ok(names.has(l), `label ${l} created`);
});

test('QM2 a vault value in a body is refused, and the value appears nowhere', async () => {
  const secret = ['Zq9', 'fake', 'vault', 'value', String(Date.now())].join('-');
  const t = laptop({
    items: [item('leaky-lane'), item('clean-lane')],
    prompts: { 'leaky-lane': `Use the key ${secret} to deploy.`, 'clean-lane': 'Nothing secret.' },
    vault: `# invented\nDEPLOY_KEY=${secret}\nSHORT=ab\n`,
  });
  const gh = fakeGitHub();
  const r = await run([...t.args, '--apply'], { gh });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REFUSE {2}leaky-lane: refused by the secret guard: the body holds the value of vault key DEPLOY_KEY/);
  assert.ok(!r.out.includes(secret), 'the value is absent from every printed line');
  assert.ok(!gh.st.requests.some((q) => q.body.includes(secret) || q.path.includes(secret)), 'and from every request');
  assert.ok(gh.bodyOf('clean-lane'), 'the clean lane is still migrated');
  assert.equal(gh.bodyOf('leaky-lane'), undefined);
  assert.deepEqual(secretFindings('ab ab ab', parseVault('SHORT=ab')), [], 'a too-short value is not compared');
});

test('QM3 a rerun creates nothing and changes nothing', async () => {
  const t = laptop({
    items: [item('first-lane'), item('second-lane', { deps: [`${MD}/lwld-first-lane.out`] })],
    prompts: { 'first-lane': 'P1', 'second-lane': 'P2' },
  });
  const gh = fakeGitHub();
  assert.equal((await run([...t.args, '--apply'], { gh })).code, 0);
  const before = JSON.stringify(gh.st.issues);
  const writes = gh.st.requests.length;
  const again = await run([...t.args, '--apply'], { gh });
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /applied: 0 created · 0 updated · 2 unchanged/);
  assert.equal(gh.st.issues.length, 2);
  assert.equal(JSON.stringify(gh.st.issues), before);
  assert.ok(!gh.st.requests.slice(writes).some((q) => q.method !== 'GET'), 'the rerun only reads');
  // a changed prompt on rerun is an UPDATE of the same issue, not a second issue
  writeFileSync(join(t.root, 'prompts', 'first-lane.prompt.md'), 'P1 revised');
  const third = await run([...t.args, '--apply'], { gh });
  assert.match(third.out, /applied: 0 created · 1 updated · 1 unchanged/);
  assert.equal(parseIssue(gh.bodyOf('first-lane')).prompt, 'P1 revised');
});

test('QM4 a 70,000-character prompt is the body plus one continuation, and reads back whole', async () => {
  const long = Array.from({ length: 7000 }, (_, i) => `line ${String(i).padStart(4, '0')}`).join('\n').padEnd(70_000, '.');
  assert.equal(long.length, 70_000);
  const t = laptop({ items: [item('long-lane')], prompts: { 'long-lane': long } });
  const gh = fakeGitHub();
  assert.equal((await run([...t.args, '--apply'], { gh })).code, 0);
  const issue = gh.bodyOf('long-lane');
  const parts = gh.st.comments.filter((x) => x.issue === issue.number);
  assert.equal(parts.length, 1, 'two parts: the body and one comment');
  assert.match(parts[0].body, /^<!-- prompt-part 2\/2 -->\n/);
  assert.ok(issue.body.length <= CONTRACT.bodyLimit && parts[0].body.length <= CONTRACT.bodyLimit);
  assert.equal(parseIssue(issue, parts, { owner: OWNER }).prompt, long);
  // shrinking it below the limit on a rerun deletes the stale continuation
  writeFileSync(join(t.root, 'prompts', 'long-lane.prompt.md'), 'short now');
  await run([...t.args, '--apply'], { gh });
  assert.equal(gh.st.comments.filter((x) => x.issue === issue.number).length, 0);
});

test('QM5 a missing prompt file is refused and listed; the rest still plan', async () => {
  const t = laptop({ items: [item('has-prompt'), item('no-prompt')], prompts: { 'has-prompt': 'P' } });
  const r = await run(t.args, { token: null });
  assert.equal(r.code, 1);
  assert.match(r.out, /REFUSE {2}no-prompt: no prompt file: prepare it with the laptop's prompt builder first/);
  assert.match(r.out, /create  lane: has-prompt/);
});

test('QM6 Windows dep paths resolve; a user-profile path or token shape in a body is refused', async () => {
  assert.equal(markerName('D:\\lanes\\state\\LWLD-alpha.out'), 'LWLD-alpha');
  assert.equal(markerName('C:/lanes/state/lwld-beta.OUT'), 'lwld-beta');
  assert.equal(markerName('  E:\\x/mixed\\lwld-gamma.out  '), 'lwld-gamma');
  const profile = ['C:', 'Users', 'someone', 'Documents', 'x.md'].join('\\');
  const ghToken = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('');
  const t = laptop({
    items: [
      item('win-a', { deps: ['D:\\lanes\\state\\LWLD-win-b.out', 'D:\\lanes\\state\\lwld-done.out'] }),
      item('win-b'),
      item('leaks-path'),
      item('leaks-token'),
    ],
    prompts: { 'win-a': 'A', 'win-b': 'B', 'leaks-path': `read ${profile} first`, 'leaks-token': `use ${ghToken}` },
    markers: { 'lwld-done': 'land exit=0\r\n' },
  });
  const r = await run(t.args, { token: null });
  assert.match(r.out, /create  lane: win-a .*deps=\[#<win-b>\]/, 'the backslash path resolved, and the CRLF marker read as satisfied');
  assert.match(r.out, /REFUSE {2}leaks-path: .*un-rewritten Windows user-profile path/);
  assert.match(r.out, /REFUSE {2}leaks-token: .*GitHub classic token/);
  assert.ok(!r.out.includes(ghToken) && !r.out.includes(profile));
});

test('QM7 --apply refuses a repo that is not private, and writes nothing', async () => {
  const t = laptop({ items: [item('any-lane')], prompts: { 'any-lane': 'P' } });
  const gh = fakeGitHub({ isPrivate: false });
  const r = await run([...t.args, '--apply'], { gh });
  assert.equal(r.code, 1);
  assert.match(r.out, /not a private repository/);
  assert.ok(!gh.st.requests.some((q) => q.method !== 'GET'));
});

test('QM8 skips, COVERAGE LOST without merged facts, and --only', async () => {
  const t = laptop({
    items: [item('launched-lane'), item('merged-lane'), item('fresh-lane'), item('other-lane'), { lane: 'not-cloud', cloud: false }],
    prompts: { 'launched-lane': 'P', 'merged-lane': 'P', 'fresh-lane': 'P', 'other-lane': 'P' },
    routines: ['launched-lane'],
    state: { mergedBranches: ['autopilot/merged-lane'] },
  });
  const r = await run(t.args, { token: null });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /skip {4}launched-lane: already launched/);
  assert.match(r.out, /skip {4}merged-lane: its lander PR already merged/);
  assert.ok(!/not-cloud/.test(r.out));
  const only = await run([...t.args, '--only', 'fresh-lane'], { token: null });
  assert.match(only.out, /fresh-lane/);
  assert.ok(!/other-lane/.test(only.out));
  // merged facts from the Public repo when there is no --state
  const noState = laptop({ items: [item('merged-lane')], prompts: { 'merged-lane': 'P' }, state: null });
  assert.equal((await run(noState.args, { token: null })).code, 2, 'no --state and no token: COVERAGE LOST');
  const viaApi = await run(noState.args, { gh: fakeGitHub({ mergedBranches: ['autopilot/merged-lane'] }) });
  assert.match(viaApi.out, /skip {4}merged-lane/);
  assert.equal((await run(['--queue'], { token: null })).code, 2, 'bad flags: COVERAGE LOST');
  const empty = laptop({ items: [{ lane: 'x', cloud: false }] });
  assert.equal((await run(empty.args, { token: null })).code, 2, 'no cloud item: the wrong file, COVERAGE LOST');
});

test('QM9 laptop code spawns nothing: no child_process, no shell, no shebang', () => {
  for (const f of ['queue-migrate.mjs', 'issue-queue.mjs']) {
    const src = readFileSync(resolve(HERE, '..', '..', 'autopilot', f), 'utf8');
    assert.ok(!/['"](node:)?child_process['"]/.test(src), `${f} imports no child_process`);
    assert.ok(!/(?<![.\w])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\(/.test(src), `${f} spawns nothing`);
    assert.ok(!src.startsWith('#!'), `${f} has no shebang`);
    assert.ok(!/['"`][A-Za-z]:[\\/]/.test(src), `${f} hard-codes no drive path`);
  }
});
