// ─────────────────────────────────────────────────────────────────────────────
// entity-change.test.mjs — tooling/kit/entity-change.mjs --dry-run, over the REAL
// tree: it plans, it writes nothing, and it never prints a value.
//
//   1. a proposal equal to the source changes nothing and lists no surface;
//   2. a changed Udyam number lists the pages that print it, and the run exits 0;
//   3. a private-limited proposal exits 1, naming the sentences no wording exists
//      for — the property that makes a form change plannable rather than silent;
//   4. without --dry-run it refuses: the tool only plans.
//
// Run:  node --test tooling/ci/test/entity-change.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const TOOL = join(REPO, 'tooling', 'kit', 'entity-change.mjs');
const SOURCE = JSON.parse(readFileSync(join(REPO, 'tooling', 'house-identity.json'), 'utf8'));
let DIR;

/** Every value the tool must never print, read from the source. */
const values = () => {
  const e = SOURCE.entity;
  return [e.legalName.value, e.registrations.udyam.value, e.phone.value, e.registeredOffice.street.value].filter(Boolean);
};

function plan(mutate, args = ['--dry-run']) {
  const doc = JSON.parse(JSON.stringify(SOURCE));
  mutate?.(doc);
  const p = join(DIR, `proposed-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(doc));
  const r = spawnSync(process.execPath, [TOOL, ...args, ...(args.includes('--dry-run') ? [p] : [])], { cwd: REPO, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  for (const v of values()) assert.ok(!out.includes(v), 'the dry run printed a fact value; it names fields and files only');
  return { code: r.status, out };
}

before(() => { DIR = mkdtempSync(join(tmpdir(), 'nikatru-entity-change-')); });
after(() => rmSync(DIR, { recursive: true, force: true }));

test('a proposal equal to the source changes nothing', () => {
  const r = plan();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1\. FACTS THAT CHANGE \(0\)/);
  assert.match(r.out, /2\. GENERATED SURFACES THAT WOULD CHANGE \(0\)/);
});

test('a new Udyam number lists the pages that print it, footer pages included', () => {
  const r = plan((d) => { d.entity.registrations.udyam.value = 'UDYAM-XX-00-0000002'; });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /· entity\.registrations\.udyam\.value/);
  assert.match(r.out, /· sites\/nikatru\/terms\.html/);
  assert.match(r.out, /· sites\/nikatru\/404\.html/, 'the footer carries the number, so every served page is listed');
  assert.match(r.out, /9\. UNCHANGED/);
});

test('a private-limited proposal exits 1 and names each sentence with no wording for the form', () => {
  const r = plan((d) => { d.entity.form.value = 'private-limited'; d.entity.legalName.value = 'Proposed Fixture Private Limited'; });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sole-proprietorship → private-limited/);
  assert.match(r.out, /CANNOT RENDER/);
  assert.match(r.out, /has no wording for the entity form "private-limited"/);
  assert.match(r.out, /4\. STORES/);
  assert.match(r.out, /D-U-N-S/);
});

test('without --dry-run the tool refuses: it only plans', () => {
  const r = spawnSync(process.execPath, [TOOL], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(`${r.stdout}${r.stderr}`, /this tool only plans/);
});
