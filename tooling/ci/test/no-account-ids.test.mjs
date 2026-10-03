// ─────────────────────────────────────────────────────────────────────────────
// no-account-ids.test.mjs — tooling/scripts/assert-no-account-ids.mjs must be able
// to FAIL, and must never print what it found.
//
// ⏱ 2026-10-01 · O-STORE-ACCOUNT-IDS-IN-PUBLIC-TREE (rv2-business 009). Every value
// below is SYNTHETIC — the shape of a real id, the value of none. The real ids live
// in the business brain and nowhere else; the guard reads them from there at run
// time. The fixture is a throwaway git repository and a throwaway brain, so the
// guard's `git grep` over TRACKED files is exercised as it runs on the real tree.
//
// The real-tree red control (recorded in the PR): a brain built from the values at
// BASE, run against BASE → exit 1 naming five tracked lines; against this branch → 0.
//
// Run:  node --test tooling/ci/test/no-account-ids.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { ID_KINDS, readBrainIds } from '../../scripts/assert-no-account-ids.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(HERE, '..', '..', 'scripts', 'assert-no-account-ids.mjs');

const SELLER_LIVE = '91827364';
const SELLER_OLD = '91827999';
const PUBLISHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ENROLMENT = 'Z9Y8X7W6V5';
const TEAM = 'Q1W2E3R4T5';
const ALL = [SELLER_LIVE, SELLER_OLD, PUBLISHER, ENROLMENT];

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ids-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const write = (abs, body) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body); };
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};

const BRAIN_FILES = {
  'vendors/microsoft.md': `# Microsoft\n## APPENDED 2026-08-28\n- live seller ID: ${SELLER_LIVE}; the OLD seller id ${SELLER_OLD} authenticates nothing.\n- support case 1234567890123456\n`,
  'vendors/google.md': `# Google\n- Chrome Web Store publisher id \`${PUBLISHER}\`, LIVE 2026-08-12\n`,
  'vendors/apple.md': `# Apple\n- ENROLLMENT completed 2026-08-31. Enrollment ID: ${ENROLMENT} (Team ID ${TEAM})\n`,
};

/** A brain and a one-commit repo. `brain` overrides brain files (null deletes); `files`
 *  are the repo's tracked files; `untracked` are written and never added. */
function fixture({ brain = {}, files = {}, untracked = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  const brainDir = join(root, 'nikatru');
  for (const [rel, body] of Object.entries({ ...BRAIN_FILES, ...brain })) if (body !== null) write(join(brainDir, rel), body);
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  for (const [rel, body] of Object.entries({ 'README.md': 'a public repo\n', ...files })) write(join(repo, rel), body);
  git(repo, 'add', '-A');
  for (const [rel, body] of Object.entries(untracked)) write(join(repo, rel), body);
  return { brainDir, repo };
}

const run = ({ brainDir, repo }, env = {}) => spawnSync(process.execPath, [GUARD, '--repo', repo], {
  encoding: 'utf8',
  env: { ...process.env, NIKATRU_BUSINESS_ROOT: brainDir, ...env },
});
const out = (r) => `${r.stdout}${r.stderr}`;
const printsNoValue = (r) => { for (const v of ALL) assert.ok(!out(r).includes(v), 'the guard printed an id value'); };

describe('assert-no-account-ids — the baseline', () => {
  test('GREEN CONTROL: a tree with pointers only passes, every kind searched', () => {
    const r = run(fixture({ files: { 'notes.md': 'seller id: see nikatru/vendors/microsoft.md § APPENDED 2026-08-28\n' } }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /microsoft-seller-id \(2 value\(s\)\): no match · chrome-publisher-id \(1 value\(s\)\): no match · apple-enrollment-id \(1 value\(s\)\): no match/);
    printsNoValue(r);
  });

  test('the last four characters are not a full id', () => {
    const r = run(fixture({ files: { 'notes.md': `the live seller id ends …${SELLER_LIVE.slice(-4)}\n` } }));
    assert.equal(r.status, 0, out(r));
  });

  test('an UNTRACKED file is not the public tree', () => {
    const r = run(fixture({ untracked: { 'scratch.txt': `${PUBLISHER}\n` } }));
    assert.equal(r.status, 0, out(r));
  });
});

describe('assert-no-account-ids — RED: a full id put back fails, by kind, and prints no value', () => {
  test('the LIVE Microsoft seller id in a register note', () => {
    const r = run(fixture({ files: { 'tooling/channel-register.json': `{ "note": "seller ${SELLER_LIVE}, Company, LIVE" }\n` } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /tooling\/channel-register\.json:1 {2}microsoft-seller-id {2}match/);
    printsNoValue(r);
  });

  test('the OLD Microsoft seller id is kept out too', () => {
    const r = run(fixture({ files: { 'a.mjs': `// the other seller id, ${SELLER_OLD}, is the old one\n` } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /a\.mjs:1 {2}microsoft-seller-id {2}match/);
    printsNoValue(r);
  });

  test('the Chrome publisher id in a checklist', () => {
    const r = run(fixture({ files: { 'publish/CHECKLIST.md': `line one\npublisher id \`${PUBLISHER}\`\n` } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /publish\/CHECKLIST\.md:2 {2}chrome-publisher-id {2}match/);
    printsNoValue(r);
  });

  test('the Apple Enrollment ID in an audit', () => {
    const r = run(fixture({ files: { 'privacy-manifest.json': `{ "why": "enrolment completed (Enrollment ID ${ENROLMENT})" }\n` } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /privacy-manifest\.json:1 {2}apple-enrollment-id {2}match/);
    printsNoValue(r);
  });
});

describe('assert-no-account-ids — COVERAGE LOST, never a quiet pass', () => {
  test('the brain absent is exit 2', () => {
    const f = fixture();
    const r = run(f, { NIKATRU_BUSINESS_ROOT: join(f.brainDir, '..', 'no-such-brain') });
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — account ids: the business brain was not found/);
  });

  test('a vendor file missing from the brain is exit 2, naming the kind', () => {
    const r = run(fixture({ brain: { 'vendors/google.md': null } }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /chrome-publisher-id: vendors\/google\.md does not exist in the brain/);
  });

  test('a relabelled line that yields no value is exit 2 — a kind searching for nothing would pass forever', () => {
    const r = run(fixture({ brain: { 'vendors/apple.md': `# Apple\n- the membership number is ${ENROLMENT}\n` } }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /apple-enrollment-id: vendors\/apple\.md has no line matching/);
    printsNoValue(r);
  });
});

describe('assert-no-account-ids — what the brain reader takes', () => {
  test('the Enrollment ID is the token after the label: not the word ENROLLMENT, not the Team ID', () => {
    const f = fixture();
    const { ids, missing } = readBrainIds(f.brainDir);
    assert.deepEqual(missing, []);
    assert.deepEqual(ids.filter((i) => i.kind === 'apple-enrollment-id').map((i) => i.value), [ENROLMENT]);
  });

  test('the Enrollment ID written as a markdown table cell, as the real brain writes it', () => {
    const f = fixture({ brain: { 'vendors/apple.md': `# Apple\n| **Enrollment ID** | **\`${ENROLMENT}\`** — quote this to Apple support |\n` } });
    const { ids, missing } = readBrainIds(f.brainDir);
    assert.deepEqual(missing, []);
    assert.deepEqual(ids.filter((i) => i.kind === 'apple-enrollment-id').map((i) => i.value), [ENROLMENT]);
  });

  test('a seller id as a table cell after `(live)`, and not the phone number on a seller-contact row', () => {
    const f = fixture({
      brain: {
        'vendors/microsoft.md':
          `# Microsoft\n| **Seller ID (live)** | **\`${SELLER_LIVE}\`** |\n| Seller / approver / customer contact | \`+91 9876543210\` |\n`,
      },
    });
    const { ids } = readBrainIds(f.brainDir);
    assert.deepEqual(ids.filter((i) => i.kind === 'microsoft-seller-id').map((i) => i.value), [SELLER_LIVE]);
  });

  test('both seller ids, and not the 16-digit support case number', () => {
    const { ids } = readBrainIds(fixture().brainDir);
    assert.deepEqual(ids.filter((i) => i.kind === 'microsoft-seller-id').map((i) => i.value).sort(), [SELLER_LIVE, SELLER_OLD].sort());
  });

  test('three kinds, each naming its brain file', () => {
    assert.deepEqual(ID_KINDS.map((k) => `${k.kind}@${k.file}`), [
      'microsoft-seller-id@vendors/microsoft.md',
      'chrome-publisher-id@vendors/google.md',
      'apple-enrollment-id@vendors/apple.md',
    ]);
  });
});
