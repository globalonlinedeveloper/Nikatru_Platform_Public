// ─────────────────────────────────────────────────────────────────────────────
// new-tool-chain.test.mjs — extensions/scripts/new-tool.mjs runs the chain a new
// tool needs (O-NEW-TOOL-IS-A-COPIER-NOT-THE-COMMAND), on a copy of the
// repository in os.tmpdir() (ADR 072: never the checkout, never without
// --repo-root).
//
// Graded here, each case written out by hand:
//   - the probe: a scratch tool stamped with --tagline exits 0, and in that root
//     check-catalog, tag-owner --check, gen-issue-forms --check and
//     publish-arming --plan (SKIPPED: not a release run, add-on id derived) are
//     green — the same commands the extensions-ci templates job runs;
//   - RC-F7: the same stamp with `--skip tag-owner` (NIKATRU_PROBE_RC=1) exits
//     1 naming tag-owner --check, and tag-owner --check in that root exits 1;
//   - `--skip` without NIKATRU_PROBE_RC=1 exits 2 and writes nothing;
//   - the checkout's `git status --porcelain` is the same after every case.
//
// Run:  node --test tooling/ci/test/new-tool-chain.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'new-tool-chain-'));
const STAMP = ['--category', 'Extension', '--name', 'Probe Tool', '--id', 'probetool', '--tagline', 'Probe tool.'];

const gitStatus = () => spawnSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
let statusBefore = null;
before(() => { statusBefore = gitStatus(); });
after(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
/** A copy of HEAD in its own tmpdir, as the probe step makes it (git archive HEAD | tar -x). */
function copyOfHead() {
  const root = join(TMP, 'probe-' + (++n));
  mkdirSync(root, { recursive: true });
  const archive = spawnSync('git', ['-C', REPO, 'archive', '--format=tar', 'HEAD'], { maxBuffer: 1 << 30 });
  assert.equal(archive.status, 0, 'git archive HEAD failed: ' + String(archive.stderr));
  const tar = spawnSync('tar', ['-x', '-C', root], { input: archive.stdout, maxBuffer: 1 << 30 });
  assert.equal(tar.status, 0, 'tar -x failed: ' + String(tar.stderr));
  return root;
}
const node = (root, rel, argv, env = {}) => {
  const r = spawnSync(process.execPath, [join(root, rel), ...argv], {
    encoding: 'utf8', cwd: root, timeout: 300000, env: { ...process.env, NIKATRU_PROBE_RC: '', ...env },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const newTool = (root, extra = [], env = {}) =>
  node(root, 'extensions/scripts/new-tool.mjs', ['--repo-root', join(root, 'extensions'), ...STAMP, ...extra], env);

describe('the probe', () => {
  let root;
  let stamped;
  before(() => {
    root = copyOfHead();
    stamped = newTool(root);
  });
  test('new-tool --tagline stamps the scratch tool and exits 0, every chain step green', () => {
    assert.equal(stamped.code, 0, stamped.out);
    assert.match(stamped.out, /PASS {2}chain · tag-owner --check/);
    assert.match(stamped.out, /PASS {2}chain · gen-issue-forms --check/);
    assert.match(stamped.out, /PASS {2}chain · publish-arming --plan/);
  });
  test('check-catalog is green in the probe root', () => {
    const r = node(root, 'extensions/scripts/check-catalog.mjs', ['--repo-root', join(root, 'extensions')]);
    assert.equal(r.code, 0, r.out);
  });
  test('tag-owner --check is green in the probe root, owning probetool\'s tags', () => {
    const r = node(root, 'tooling/ci/tag-owner.mjs', ['--check', '--root', root]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /extensions\.yml ← fullshot, probetool/);
  });
  test('gen-issue-forms --check is green in the probe root, over two tool ids', () => {
    const r = node(root, 'tooling/ci/gen-issue-forms.mjs', ['--check', '--root', root]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /graded against 2 tool id\(s\)/);
  });
  test('publish-arming --plan skips with a reason, and the add-on id is derived from the house identity', () => {
    const r = node(root, 'extensions/scripts/publish-arming.mjs', ['--channel', 'amo', '--tool', 'probetool', '--plan', '--repo-root', root]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SKIPPED: not a release run/);
    assert.match(r.out, /"probetool@nikatru\.com" — derived/);
  });
  test('the stamped tool.json carries the tagline as its summary', () => {
    const t = JSON.parse(readFileSync(join(root, 'extensions', 'Extension', 'Probe_Tool', 'tool.json'), 'utf8'));
    assert.equal(t.summary, 'Probe tool.');
  });
});

describe('RC-F7: the chain with tag-owner skipped', () => {
  let root;
  let stamped;
  before(() => {
    root = copyOfHead();
    stamped = newTool(root, ['--skip', 'tag-owner'], { NIKATRU_PROBE_RC: '1' });
  });
  test('new-tool exits 1, naming tag-owner --check', () => {
    assert.equal(stamped.code, 1, stamped.out);
    assert.match(stamped.out, /chain · tag-owner SKIPPED/);
    assert.match(stamped.out, /FAIL {2}chain · tag-owner --check exited 1/);
  });
  test('tag-owner --check exits 1 in that root, naming the tag list the registers now derive', () => {
    const r = node(root, 'tooling/ci/tag-owner.mjs', ['--check', '--root', root]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /probetool-v1\.10\.1 reaches no lane/);
  });
});

describe('the red-control flag is refused outside a red control', () => {
  test('--skip without NIKATRU_PROBE_RC=1 exits 2 and stamps nothing', () => {
    const root = copyOfHead();
    const r = newTool(root, ['--skip', 'tag-owner']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /refused unless NIKATRU_PROBE_RC=1/);
    assert.equal(existsSync(join(root, 'extensions', 'Extension', 'Probe_Tool')), false);
  });
});

describe('the checkout', () => {
  test('git status --porcelain is what it was before these cases ran', () => {
    assert.equal(gitStatus(), statusBefore);
  });
});
