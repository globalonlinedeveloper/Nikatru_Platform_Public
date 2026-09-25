// ─────────────────────────────────────────────────────────────────────────────
// house-identity.test.mjs — assert-house-identity.mjs must be able to FAIL, must
// refuse to pass over nothing, and must be green on the tree it guards.
//
// Row: O-NEW-TOOL-HAS-NO-FIREFOX-IDENTITY. RC-F3 of the extension-kit design is the
// "house ownerDomain changed" case below: it copies the REAL house file and the
// REAL FullShot tool.json and identity.json into a temp directory, changes only
// the house, and expects exit 1 naming FullShot's identity.json.
//
// Fixtures live in os.tmpdir() only (ADR 072); nothing here writes into the tree.
//
// Run:  node --test tooling/ci/test/house-identity.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-house-identity.mjs');

const HOUSE_REL = 'tooling/house-identity.json';
const FS_TOOL_REL = 'extensions/Extension/Full_Screen_Shot/tool.json';
const FS_ID_REL = 'extensions/Extension/Full_Screen_Shot/publish/identity.json';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-houseid-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const realJson = (rel) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));

/** A tree holding the real house file and the real FullShot tool.json and
 *  identity.json, each optionally replaced (an object) or omitted (null). */
function build({ house, tool, identity, extra = {} } = {}) {
  const root = join(TMP, `t${++seq}`);
  const files = {
    [HOUSE_REL]: house === undefined ? realJson(HOUSE_REL) : house,
    [FS_TOOL_REL]: tool === undefined ? realJson(FS_TOOL_REL) : tool,
    [FS_ID_REL]: identity === undefined ? realJson(FS_ID_REL) : identity,
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

test('green on the real repository: one tool read, equal to the house', () => {
  const r = run(REPO);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 tool\(s\) read/);
});

test('green on a copy of the real house and FullShot files (the control for every case below)', () => {
  const r = run(build());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 tool\(s\) read/);
});

test('RC-F3: the house ownerDomain changed → exit 1, naming FullShot\'s identity.json', () => {
  const house = realJson(HOUSE_REL);
  house.ownerDomain.value = 'other-domain.com';
  const r = run(build({ house }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /extensions\/Extension\/Full_Screen_Shot\/publish\/identity\.json {2}ownerDomain is "nikatru\.com"/);
});

test('(a) a placeholder ownerDomain in the house file → exit 1, naming the house field', () => {
  const house = realJson(HOUSE_REL);
  house.ownerDomain.value = 'REPLACE-WITH-YOUR-DOMAIN.example';
  const r = run(build({ house }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /tooling\/house-identity\.json {2}ownerDomain is a placeholder/);
});

test('(a) a .example support address in the house file is a placeholder even without REPLACE → exit 1', () => {
  const house = realJson(HOUSE_REL);
  house.supportEmail.value = 'support@shop.example';
  const r = run(build({ house }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /supportEmail is a placeholder/);
});

test('(a) a house privacy pattern without {slug} → exit 1', () => {
  const house = realJson(HOUSE_REL);
  house.privacyPolicyUrlPattern.value = 'https://nikatru.com/privacy';
  const r = run(build({ house }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /privacyPolicyUrlPattern carries no \{slug\}/);
});

test('(a) a house field without its why → exit 1', () => {
  const house = realJson(HOUSE_REL);
  delete house.homepageUrl.why;
  const r = run(build({ house }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /homepageUrl\.why is missing/);
});

test('(a) a house field written as a bare string, not { value, why } → exit 1', () => {
  const house = realJson(HOUSE_REL);
  house.homepageUrl = 'https://nikatru.com/';
  const r = run(build({ house }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /homepageUrl is not a \{ value, why \} object/);
});

test('(b) a tool slug that is not its tool.json id → exit 1', () => {
  const identity = realJson(FS_ID_REL);
  identity.slug = 'fullshot-old';
  const r = run(build({ identity }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /slug is "fullshot-old", and tool\.json's id is "fullshot"/);
});

test('(b) a privacy URL that is not the pattern with the slug put in → exit 1', () => {
  const identity = realJson(FS_ID_REL);
  identity.privacyPolicyUrl = 'https://nikatru.com/privacy';
  const r = run(build({ identity }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /privacyPolicyUrl is "https:\/\/nikatru\.com\/privacy"; the house value is "https:\/\/nikatru\.com\/fullshot\/privacy"/);
});

test('(b) a tool still carrying the template placeholder domain → exit 1', () => {
  const identity = realJson(FS_ID_REL);
  identity.ownerDomain = 'REPLACE-WITH-YOUR-DOMAIN.example';
  const r = run(build({ identity }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ownerDomain is "REPLACE-WITH-YOUR-DOMAIN\.example"; the house value is "nikatru\.com"/);
});

test('(b) a second tool with no identity.json is printed as not graded, and the run stays green', () => {
  const r = run(build({ extra: { 'extensions/Extension/Other/tool.json': { id: 'other' } } }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /not graded: extensions\/Extension\/Other \(no publish\/identity\.json\)/);
  assert.match(r.out, /1 tool\(s\) read/);
});

test('(d) zero identities read → exit 2, COVERAGE LOST, never a pass', () => {
  const r = run(build({ identity: null }));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /COVERAGE LOST — no extensions\/Extension\/<tool>\/publish\/identity\.json was read/);
});

test('(d) no house file → exit 2, COVERAGE LOST', () => {
  const r = run(build({ house: null }));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /COVERAGE LOST — tooling\/house-identity\.json does not exist/);
});

test('(d) a house file that does not parse → exit 2, COVERAGE LOST', () => {
  const r = run(build({ house: '{ not json' }));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /COVERAGE LOST — tooling\/house-identity\.json is not a JSON object/);
});

test('(d) no extensions/Extension directory → exit 2, COVERAGE LOST', () => {
  const r = run(build({ tool: null, identity: null }));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /COVERAGE LOST — extensions\/Extension\/ is not a directory/);
});
