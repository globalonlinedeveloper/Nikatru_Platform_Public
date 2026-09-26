// ─────────────────────────────────────────────────────────────────────────────
// regen-chain.test.mjs — tooling/sites/regen.mjs runs the site surface's
// generators in one order, and its --check can FAIL.
//
// What is pinned here, and why each matters:
//   · ORDER holds every site generator in the tree, once, producer before
//     reader — a generator outside the list is one somebody runs from memory;
//   · write mode propagates an input change through the whole chain, and the
//     chain's own --check then agrees with what it wrote;
//   · --check writes NOTHING, and spawns no generator without its --check;
//   · a generator's exit 2 (COVERAGE LOST) is the chain's exit 2, named;
//   · a stale landing payload is named by --check, and discovery's skip is a
//     line of its own, never a silent omission;
//   · ci.yml's stamp probe names the same generators as ORDER, both ways. The
//     probe re-derives the site surface by naming each generator itself, so
//     that dropping one from ORDER turns it red; this case is what keeps its
//     list and ORDER from parting silently.
//
// THE FIXTURE is a tmpdir copy of the committed inputs the generators read,
// built ONCE in `before`; each case works on its own copy of it. No case spawns
// mason and none writes into this checkout. No test is declared inside a loop
// (assert-no-loop-cases.mjs): each case is written out so a failure names
// exactly one behaviour.
//
// Run:  node --single-threaded --test tooling/ci/test/regen-chain.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../app-yaml/yaml.mjs';
import { ORDER } from '../../sites/regen.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGEN = join(REPO, 'tooling', 'sites', 'regen.mjs');

/** The committed inputs the seven generators read. Tracked files only, so a
 *  local build directory or a locally stamped app never enters the fixture. */
const INPUT_ROOTS = [
  'apps',
  'catalog',
  'sites',
  'docs/platform/supabase/email-templates',
  'services/platform/src/app-config-data.json',
  'tooling/channel-register.json',
  'tooling/legal',
  'extensions/Extension/Full_Screen_Shot/publish',
  'extensions/templates/tool/publish',
];
const PRIVACY_DECLARATIONS = ['apps/subscriptiontracker/privacy.yaml', 'extensions/Extension/Full_Screen_Shot/publish/privacy.yaml'];

const SITE_FEED = 'sites/_shared/_data/apps.json';
const LANDING = 'catalog/apps-landing.json';
const APP_YAML = 'apps/subscriptiontracker/app.yaml';

const CI_YML = '.github/workflows/ci.yml';
const PROBE_STEP = 'A stamp leaves the site surface and the tag filter clean';
/** The probe step runs it too, and it is not a site generator: it writes the
 *  release lanes' `tags:` filters, so ORDER never lists it. */
const TAG_OWNER = 'tooling/ci/tag-owner.mjs';

let TMP;
let PRISTINE;
let seq = 0;

const copyIn = (root, rel) => {
  mkdirSync(join(root, dirname(rel)), { recursive: true });
  cpSync(join(REPO, rel), join(root, rel));
};

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-regen-'));
  PRISTINE = join(TMP, 'pristine');
  const listed = spawnSync('git', ['-C', REPO, 'ls-files', '-z', '--', ...INPUT_ROOTS], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(listed.status, 0, `git ls-files failed: ${listed.stderr}`);
  const files = listed.stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 50, `the fixture would hold ${files.length} tracked file(s); expected the site surface's inputs`);
  for (const rel of files) copyIn(PRISTINE, rel);
  // render-privacy refuses a declaration whose `source` file does not exist, so
  // every repository path the two declarations name comes along. Read off the
  // declarations, so a re-pointed source brings its new file with it.
  for (const decl of PRIVACY_DECLARATIONS) {
    const doc = parseYaml(readFileSync(join(REPO, decl), 'utf8'));
    const rows = [...(doc.collects ?? []), ...(doc.storeDisclosures ?? []), ...(doc.processors ?? []), doc.limitedUse ?? {}];
    for (const src of rows.map((r) => r?.source)) {
      if (typeof src !== 'string' || src.startsWith('https://') || existsSync(join(PRISTINE, src))) continue;
      copyIn(PRISTINE, src);
    }
  }
});

after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** A fresh copy of the pristine fixture for one case. */
function tree() {
  const root = join(TMP, `case-${++seq}`);
  cpSync(PRISTINE, root, { recursive: true });
  return root;
}

const regen = (root, ...flags) => {
  const r = spawnSync(process.execPath, [REGEN, root, ...flags], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status === null ? -1 : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** Path → sha256 of every file under `root`: the whole fixture, byte for byte.
 *  Each entry is READ once and a directory is known by EISDIR, never stat-then-
 *  read: the kind and the bytes are one observation (render-privacy.mjs readIf). */
function snapshot(root) {
  const out = new Map();
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      let bytes;
      try {
        bytes = readFileSync(a);
      } catch (e) {
        if (e && e.code === 'EISDIR') {
          walk(a, r);
          continue;
        }
        throw e;
      }
      out.set(r, createHash('sha256').update(bytes).digest('hex'));
    }
  };
  walk(root, '');
  return out;
}

const read = (root, rel) => readFileSync(join(root, ...rel.split('/')), 'utf8');
const put = (root, rel, text) => writeFileSync(join(root, ...rel.split('/')), text);

/** The lines of the workflow step whose `- name:` is `name`: every line after
 *  it that is blank or indented deeper than its `-`. Null when no step carries
 *  the name, so a renamed step is a failure and never an empty list. */
function stepBody(text, name) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*- name: /.test(l) && l.replace(/^\s*- name: /, '').trim() === name);
  if (at === -1) return null;
  const indent = lines[at].indexOf('-');
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() !== '' && l.search(/\S/) <= indent) break;
    body.push(l);
  }
  return body;
}

/** Every `tooling/…/*.mjs` a step body runs with `node`, repo-relative, in the
 *  order it runs them. Comment lines run nothing and are skipped. */
function nodeScripts(body) {
  const scripts = [];
  for (const l of body) {
    if (/^\s*#/.test(l)) continue;
    for (const m of l.matchAll(/\bnode\s+(?:--\S+\s+)*(tooling\/[\w./-]+\.mjs)\b/g)) scripts.push(m[1]);
  }
  return scripts;
}

describe('regen.mjs — one ordered chain over the site surface', () => {
  test('ORDER holds every site generator in the tree once, each producer before the entries that read its output', () => {
    const inTree = [
      ...readdirSync(join(REPO, 'tooling', 'sites')).filter((f) => /^gen(erate)?-[a-z-]+\.mjs$/.test(f)).map((f) => `tooling/sites/${f}`),
      ...readdirSync(join(REPO, 'tooling', 'app-yaml')).filter((f) => /^render(-[a-z]+)?\.mjs$/.test(f)).map((f) => `tooling/app-yaml/${f}`),
    ].sort();
    const listed = ORDER.map((e) => e.script);
    assert.deepEqual([...listed].sort(), inTree, 'ORDER and the generator files in tooling/sites + tooling/app-yaml differ');
    assert.equal(new Set(listed).size, listed.length, 'ORDER names a generator twice');
    const at = (script) => listed.indexOf(script);
    // catalog/apps.json is render's output and the input of the three below it.
    assert.ok(at('tooling/app-yaml/render.mjs') < at('tooling/sites/generate-apps-data.mjs'), 'render must precede apps-data');
    assert.ok(at('tooling/app-yaml/render.mjs') < at('tooling/sites/generate-landing-payload.mjs'), 'render must precede landing-payload');
    assert.ok(at('tooling/app-yaml/render.mjs') < at('tooling/sites/generate-well-known.mjs'), 'render must precede well-known');
    // The site feed is apps-data's output and discovery's registry.
    assert.ok(at('tooling/sites/generate-apps-data.mjs') < at('tooling/sites/generate-discovery.mjs'), 'apps-data must precede discovery');
    // Discovery walks sites/nikatru, the tree auth-mail and render-privacy write into.
    assert.ok(at('tooling/sites/gen-auth-mail.mjs') < at('tooling/sites/generate-discovery.mjs'), 'auth-mail must precede discovery');
    assert.ok(at('tooling/app-yaml/render-privacy.mjs') < at('tooling/sites/generate-discovery.mjs'), 'render-privacy must precede discovery');
    assert.deepEqual(
      ORDER.map((e) => `${e.id}:${e.kind}`),
      ['render:check', 'render-privacy:check', 'apps-data:check', 'landing-payload:check', 'auth-mail:check', 'discovery:git-dated', 'well-known:plan'],
    );
  });

  test('write mode carries a declaration change through the chain, and --check --with-discovery then agrees', () => {
    const root = tree();
    const tagline = 'A regen-chain fixture tagline that exists nowhere else';
    const before = read(root, APP_YAML);
    const after = before.replace(/^tagline: .*$/m, `tagline: "${tagline}"`);
    assert.notEqual(after, before, `${APP_YAML} carries no top-level tagline line to change`);
    put(root, APP_YAML, after);

    const wrote = regen(root);
    assert.equal(wrote.code, 0, wrote.out);
    assert.ok(read(root, 'catalog/apps.json').includes(tagline), 'render did not carry the tagline into the catalogue');
    assert.ok(read(root, SITE_FEED).includes(tagline), 'apps-data ran over the catalogue as it was BEFORE render');

    const checked = regen(root, '--check', '--with-discovery');
    assert.equal(checked.code, 0, checked.out);
    assert.match(checked.out, /ok {3}discovery — planDiscovery matches the disk/);
  });

  test('--check writes nothing, even over a stale site feed', () => {
    const root = tree();
    put(root, SITE_FEED, `${read(root, SITE_FEED)}\n`);
    const beforeBytes = snapshot(root);

    const r = regen(root, '--check');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /STALE apps-data/);
    assert.deepEqual(snapshot(root), beforeBytes, '--check changed a byte of the tree it was only asked to compare');
  });

  test('a generator that exits 2 makes the chain exit 2, and the chain names it', () => {
    const root = tree();
    rmSync(join(root, 'tooling', 'channel-register.json'));

    const r = regen(root, '--check');
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /✗ COVERAGE LOST render — tooling\/app-yaml\/render\.mjs --check exited 2/);
    assert.match(r.out, /regen --check: COVERAGE LOST — render exited 2/);
  });

  test('--check names a stale landing payload, and names the discovery skip on its own line', () => {
    const root = tree();
    put(root, LANDING, read(root, LANDING).replace('"slug"', '"slug" '));

    const r = regen(root, '--check');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /✗ STALE landing-payload/);
    assert.ok(r.out.includes(LANDING), `the output never names ${LANDING}`);
    assert.match(r.out, /^skip discovery — git-dated/m);
  });

  test('the ci.yml probe step names every ORDER script, and ORDER names every generator the probe step runs', () => {
    const body = stepBody(readFileSync(join(REPO, ...CI_YML.split('/')), 'utf8'), PROBE_STEP);
    assert.ok(body !== null, `${CI_YML} has no step named "${PROBE_STEP}"; the stamp probe is gone or renamed`);
    const probe = new Set(nodeScripts(body).filter((s) => s !== TAG_OWNER));
    const order = new Set(ORDER.map((e) => e.script));
    assert.deepEqual(
      [...order].filter((s) => !probe.has(s)),
      [],
      `ORDER runs generator(s) the "${PROBE_STEP}" step never runs, so a stamp that left their output stale stays green`,
    );
    assert.deepEqual(
      [...probe].filter((s) => !order.has(s)),
      [],
      `the "${PROBE_STEP}" step runs script(s) ORDER does not list, so the probe checks a surface the stamp's own chain never writes`,
    );
  });
});
