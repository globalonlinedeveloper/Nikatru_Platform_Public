// ─────────────────────────────────────────────────────────────────────────────
// business-facts.test.mjs — tooling/scripts/assert-business-facts.mjs, over a
// fixture workspace: a public repo, and a business brain beside it.
//
// The brief's two red controls are cases 2 and 3: a footer whose Udyam number is
// wrong exits 1, and a run with no brain exits 2. The rest prove each limb can
// fail on its own input, and that no finding ever prints a value.
//
// Every value here is a FIXTURE value (an `.test` domain, a 0-padded number):
// this file is tracked, so the real guard scans it, and a real fact typed here
// would be the defect the guard refuses.
//
// Run:  node --test tooling/ci/test/business-facts.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { renderEntity } from '../../ports/render-entity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'scripts', 'assert-business-facts.mjs');

const NAME = 'Ada Fixture';
const UDYAM = 'UDYAM-XX-00-0000001';
const WRONG_UDYAM = 'UDYAM-XX-00-0000009';
const PHONE = '9000000001';
const OFFICE = { floor: '1', building: 'Fixture Tower', street: 'Fixture Street', area: 'Fixture Area', locality: 'Testpet', city: 'Testcity', state: 'Teststate', postalCode: '600999', country: 'Testland' };
const VALUES = [NAME, UDYAM, PHONE, OFFICE.street, OFFICE.building, OFFICE.area, OFFICE.postalCode];

let BASE, PUB, BRAIN_FILE;

const writeJson = (abs, v) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, `${JSON.stringify(v, null, 2)}\n`); };
const write = (rel, text) => { const abs = join(PUB, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); };
const git = (...args) => {
  const r = spawnSync('git', ['-C', PUB, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

function source() {
  const office = Object.fromEntries(Object.entries(OFFICE).map(([k, v]) => [k, { value: v, brain: `publicAddress.${k}.value` }]));
  return {
    supportEmail: { value: 'support@example.test' },
    mail: { from: { reports: { value: 'Fixture reports <alerts@example.test>' } } },
    entity: {
      form: { value: 'sole-proprietorship', label: 'Sole proprietorship', brain: { label: 'form.value' }, allowed: ['sole-proprietorship', 'private-limited'], wording: { noun: 'proprietorship', longNoun: 'sole proprietorship', roleNoun: 'sole proprietor', roleTitle: 'Proprietor' } },
      legalName: { value: NAME, brain: 'legalName.value' },
      tradeName: { value: 'FIXTURE', brain: 'tradeName.value' },
      registrations: { udyam: { value: UDYAM, brain: 'udyam.value' }, gstin: { value: null } },
      registeredOffice: office,
      phone: { value: PHONE, countryCode: '+91', brain: { value: 'phone.value', countryCode: 'phone.countryCode' } },
      storeAccounts: {},
      copyright: { holder: { value: 'FIXTURE' }, firstYear: { value: 2026 } },
    },
    people: { founder: { name: { value: NAME }, url: { value: 'https://example.test' } } },
  };
}

function brain() {
  return {
    legalName: { value: NAME }, tradeName: { value: 'FIXTURE' }, form: { value: 'Sole proprietorship' }, udyam: { value: UDYAM },
    publicAddress: Object.fromEntries(Object.entries(OFFICE).map(([k, v]) => [k, { value: v }])),
    phone: { value: PHONE, countryCode: '+91' }, supportEmail: { value: 'support@example.test' },
  };
}

const SURFACES = {
  facts: { udyam: { template: '{{udyam}}' }, 'legal-name': { template: '{{legalName}}' }, 'entity-of': { byForm: { 'sole-proprietorship': 'proprietorship of {{legalName}}' } } },
  anchored: [],
  files: [],
  literals: {
    values: [
      { class: 'legal name', path: 'entity.legalName.value' },
      { class: 'Udyam number', path: 'entity.registrations.udyam.value' },
      { class: 'phone number', path: 'entity.phone.value', match: 'digits' },
      { class: 'registered-office street', path: 'entity.registeredOffice.street.value' },
      { class: 'registered-office building', path: 'entity.registeredOffice.building.value' },
      { class: 'registered-office area', path: 'entity.registeredOffice.area.value' },
      { class: 'registered-office PIN', path: 'entity.registeredOffice.postalCode.value', match: 'word' },
    ],
    formWords: { paths: ['entity.form.wording.noun', 'entity.form.wording.longNoun'], surfaces: ['sites/nikatru/'], ignore: [] },
  },
  exempt: [{ path: 'docs/history/', kind: 'dated-history', why: 'fixture: a dated record' }],
  floors: { files: 2, regions: 1, anchored: 0 },
};

const F = (n, body) => `<!-- FACT:${n} -->${body}<!-- /FACT:${n} -->`;
const PAGE = (udyam) => `<!doctype html><title>t</title><main><p>Fixture is a ${F('entity-of', `proprietorship of ${NAME}`)}, Udyam ${F('udyam', udyam)}.</p></main>\n`;

function reset() {
  writeJson(join(PUB, 'tooling', 'house-identity.json'), source());
  writeJson(join(PUB, 'tooling', 'entity', 'surfaces.json'), SURFACES);
  writeJson(join(PUB, 'tooling', 'channel-register.json'), { channels: [] });
  write('services/platform/src/generated/entity.ts', renderEntity(source()).text);
  write('sites/nikatru/footer-page.html', PAGE(UDYAM));
  write('docs/notes.md', '# notes\n\nNothing to see.\n');
  write('docs/history/2026-01-01.md', `# a dated record\n\nOn that day the name was ${NAME}.\n`);
  writeJson(BRAIN_FILE, brain());
}

function run(args = [], env = {}) {
  const e = { ...process.env, ...env };
  delete e.NIKATRU_BUSINESS_ROOT;
  if (env.NIKATRU_BUSINESS_ROOT) e.NIKATRU_BUSINESS_ROOT = env.NIKATRU_BUSINESS_ROOT;
  const r = spawnSync(process.execPath, [GUARD, '--root', PUB, ...args], { cwd: PUB, env: e, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  for (const v of VALUES) assert.ok(!out.includes(v), `a run printed a fact value — findings name the class, never the value:\n${out}`);
  return { code: r.status, out };
}

before(() => {
  BASE = mkdtempSync(join(tmpdir(), 'nikatru-business-facts-'));
  PUB = join(BASE, 'Projects', 'Fixture_Public');
  BRAIN_FILE = join(BASE, 'nikatru', 'business', 'public-facts.json');
  mkdirSync(PUB, { recursive: true });
  reset();
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture', '--no-gpg-sign');
});
after(() => rmSync(BASE, { recursive: true, force: true }));
beforeEach(() => reset());

describe('assert-business-facts over a fixture workspace', () => {
  test('green control: the source equals the brain, every surface is rendered, nothing is typed', () => {
    const r = run();
    assert.equal(r.code, 0, `green control first, or every red case proves nothing:\n${r.out}`);
    assert.match(r.out, /BRAIN\s+\d+ source leaf\(s\) compared/);
    assert.match(r.out, /1 FACT region\(s\)|2 FACT region\(s\)/);
  });

  test('RED CONTROL: a footer whose Udyam number is wrong exits 1, naming the page', () => {
    write('sites/nikatru/footer-page.html', PAGE(WRONG_UDYAM));
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /GENERATED\s+sites\/nikatru\/footer-page\.html\s+is not what tooling\/house-identity\.json renders/);
  });

  test('RED CONTROL: no brain is UNREAD, exit 2 — never a pass', () => {
    rmSync(BRAIN_FILE);
    const r = run();
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /BRAIN UNREAD/);
  });

  test('--ci declares the brain not a subject and grades everything else', () => {
    rmSync(BRAIN_FILE);
    const ok = run(['--ci']);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /not a subject of this run/);
    write('sites/nikatru/footer-page.html', PAGE(WRONG_UDYAM));
    assert.equal(run(['--ci']).code, 1, 'with the brain out of scope, a stale page still fails');
  });

  test('BRAIN: a source value the brain does not hold exits 1, naming the leaf and printing no value', () => {
    const b = brain();
    b.udyam.value = WRONG_UDYAM;
    writeJson(BRAIN_FILE, b);
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /BRAIN\s+tooling\/house-identity\.json entity\.registrations\.udyam\.value\s+differs from the brain's `udyam\.value`: no match/);
  });

  test('LITERALS: a fact typed outside the source exits 1, naming file and line; the same text under an exempt path does not', () => {
    write('docs/notes.md', `# notes\n\nCall ${PHONE.slice(0, 5)} ${PHONE.slice(5)} or write to ${OFFICE.street}.\n`);
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /LITERALS\s+docs\/notes\.md:3\s+carries the phone number/);
    assert.match(r.out, /LITERALS\s+docs\/notes\.md:3\s+carries the registered-office street/);
    assert.doesNotMatch(r.out, /docs\/history\//, 'the exempt dated record is not scanned');
  });

  test('LITERALS: a name wrapped across a line break is still found', () => {
    const [first, last] = NAME.split(' ');
    write('docs/notes.md', `# notes\n\nBuilt by ${first}\n  ${last}.\n`);
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /docs\/notes\.md:3\s+carries the legal name/);
  });

  test('FORM WORDS: the form named on a printed surface outside a FACT region exits 1', () => {
    write('sites/nikatru/other.html', '<main><p>We are a sole proprietorship.</p></main>\n');
    git('add', 'sites/nikatru/other.html');
    const r = run();
    git('rm', '-q', '--cached', 'sites/nikatru/other.html');
    rmSync(join(PUB, 'sites', 'nikatru', 'other.html'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FORM WORDS\s+sites\/nikatru\/other\.html:1\s+names the entity form \("sole proprietorship"\)/);
  });

  test('SHAPE: a public GSTIN slot that holds a value is refused', () => {
    const s = source();
    s.entity.registrations.gstin.value = 'held-elsewhere';
    writeJson(join(PUB, 'tooling', 'house-identity.json'), s);
    const r = run();
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /entity\.registrations\.gstin\s+holds a value/);
  });
});
