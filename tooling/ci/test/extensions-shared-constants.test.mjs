// ─────────────────────────────────────────────────────────────────────────────
// extensions-shared-constants.test.mjs — three facts in extensions/scripts that
// several readers must agree on, each now held in ONE place and graded here.
//
// Until 2026-09-19 each was a copy with a comment beside it claiming the copies
// stayed in step, and nothing compared them (tooling/mechanism-claims.json,
// O-UNGRADED-MECHANISM-CLAIMS). The copies were replaced by imports; these
// cases are what fails if a reader goes back to its own copy and disagrees.
//
//   1. the CHANGELOG version-heading pattern — lib/toolinfo.mjs exports it;
//      changelogTop() and changelog-section.mjs both read it. Graded by
//      BEHAVIOUR: each heading spelling is fed to both readers, and they must
//      agree on every one.
//   2. the zip DOS timestamp — lib/zip-time.mjs; scripts/pack.mjs and
//      templates/tool/publish/pack.mjs import it. Full_Screen_Shot's CommonJS
//      packager keeps a copy, whose VALUE is compared here.
//   3. the Chrome Web Store service-account env var — publish-cws-token.mjs's
//      CWS_SA_ENV, imported by the callers and the preflight. extensions.yml
//      cannot import it, so the workflow's CWS_* secret names must equal the
//      preflight's.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripSourceComments } from '../text-reductions.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const EXT = join(REPO, 'extensions');
const mod = (rel) => import(pathToFileURL(join(EXT, rel)).href);

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ext-shared-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

// ── 1 ───────────────────────────────────────────────────────────────────────
/** A minimal tool tree changelog-section.mjs accepts: the scripts self-test's
 *  own "goodtool" shape (extensions/scripts/test/selftest.node.js buildBase). */
function toolTree(changelog) {
  const root = join(TMP, `cl${seq++}`);
  const TOOL = 'Extension/Good_Tool';
  const w = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  w(`${TOOL}/manifest.json`, JSON.stringify({ manifest_version: 3, name: 'Good Tool', version: '2.0.0', background: { service_worker: 'background.js' } }, null, 2));
  w(`${TOOL}/background.js`, "'use strict';\n");
  w(`${TOOL}/test/smoke.node.js`, "'use strict';\n");
  w(`${TOOL}/CHANGELOG.md`, changelog);
  w(`${TOOL}/tool.json`, JSON.stringify({
    $schema: '../../scripts/schema/tool.schema.json',
    id: 'goodtool', name: 'Good Tool', surface: 'extension', status: 'wip',
    summary: 'A fixture extension for the shared-constants test.',
    manifest: 'manifest.json',
    package: { include: ['manifest.json', 'background.js'], exclude: ['**/test/**', '**/*.md'] },
    targets: { chromium: { stores: ['chrome', 'edge'] } },
    tests: ['test/smoke.node.js'],
    policy: { permissions: {}, optionalHostPermissions: {}, networkAllowlist: [] },
    listings: { chrome: null, edge: null, firefox: null },
  }, null, 2));
  return root;
}
const section = (root, version) =>
  spawnSync(process.execPath, [join(EXT, 'scripts', 'changelog-section.mjs'), 'goodtool', version, '--repo-root', root], { encoding: 'utf8' });

describe('the CHANGELOG version heading is ONE pattern', () => {
  const NOTES = '- the notes for this release\n';
  const doc = (heading) => `# Changelog\n\n## [Unreleased]\n\n${heading}\n\n### Added\n\n${NOTES}\n## [1.0.0] - 2026-08-14\n\n- first\n`;
  const HEADINGS = ['## [2.0.0] - 2026-09-19', '##[2.0.0]', '##   [2.0.0] — 2026-09-19', '## [ 2.0.0 ] – x', '### [2.0.0]', '# [2.0.0]'];

  test('changelogTop() and changelog-section.mjs agree on every heading spelling', async () => {
    const { changelogTop, RE_CHANGELOG_VERSION_HEADING } = await mod('scripts/lib/toolinfo.mjs');
    assert.ok(RE_CHANGELOG_VERSION_HEADING instanceof RegExp, 'toolinfo.mjs no longer exports the heading pattern');
    const verdicts = [];
    for (const h of HEADINGS) {
      const text = doc(h);
      const topSees = changelogTop(text) === '2.0.0';
      const r = section(toolTree(text), '2.0.0');
      const sectionSees = r.status === 0 && r.stdout.includes('the notes for this release');
      verdicts.push(`${JSON.stringify(h)}: changelogTop ${topSees} · changelog-section ${sectionSees} (exit ${r.status})`);
      assert.equal(sectionSees, topSees, `the two readers disagree:\n${verdicts.join('\n')}\n${r.stderr}`);
    }
    // Both halves of the vocabulary are exercised, or agreement is vacuous.
    assert.ok(verdicts.some((v) => v.includes('changelogTop true')), verdicts.join('\n'));
    assert.ok(verdicts.some((v) => v.includes('changelogTop false')), verdicts.join('\n'));
  });
});

describe('changelog-section.mjs never hands release.yml an empty release note', () => {
  // selftest.node.js's NO_CASE_RECORDED held this gate as an OPEN GAP ("a release
  // note that silently comes out empty is caught by nobody"). The gate is right —
  // measured 2026-09-19 — and these cases are what fails if it stops being right.
  test('a version heading with nothing under it exits 1 and prints nothing', () => {
    const r = section(toolTree('# Changelog\n\n## [2.0.0] - 2026-09-19\n\n## [1.0.0] - 2026-08-14\n\n- first\n'), '2.0.0');
    assert.equal(r.status, 1, `an EMPTY section must be refused, got exit ${r.status}\n${r.stderr}`);
    assert.equal(r.stdout, '', 'a refused section must print no release body');
  });

  test('a version the CHANGELOG does not carry exits 1 and prints nothing', () => {
    const r = section(toolTree('# Changelog\n\n## [1.0.0] - 2026-08-14\n\n- first\n'), '2.0.0');
    assert.equal(r.status, 1, `a MISSING section must be refused, got exit ${r.status}\n${r.stderr}`);
    assert.equal(r.stdout, '');
  });

  test('a CHANGELOG with no heading the reader recognises exits 2, not 0', () => {
    const r = section(toolTree('# Changelog\n\n### [2.0.0]\n\n- notes\n'), '2.0.0');
    assert.equal(r.status, 2, `an unreadable CHANGELOG is COVERAGE LOST, got exit ${r.status}\n${r.stderr}`);
    assert.equal(r.stdout, '');
  });
});

// ── 2 ───────────────────────────────────────────────────────────────────────
/** The value of `const NAME = <expr>` in a file's comment-free code, when the
 *  expression is integer arithmetic only. */
function constValue(code, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*([^,;]+)`).exec(code);
  assert.ok(m, `no \`${name} =\` in code`);
  const expr = m[1].trim();
  assert.match(expr, /^[\s\d()xXa-fA-F<>|&+\-*]+$/, `\`${name}\` is not a plain integer expression: ${expr}`);
  return Function(`"use strict"; return (${expr});`)();
}

describe('the zip timestamp is ONE constant', () => {
  const IMPORTERS = ['scripts/pack.mjs', 'templates/tool/publish/pack.mjs'];

  test('scripts/pack.mjs and the template packager import DOS_TIME/DOS_DATE from lib/zip-time.mjs and define no copy', () => {
    for (const rel of IMPORTERS) {
      const code = stripSourceComments(readFileSync(join(EXT, rel), 'utf8'), '.mjs');
      const imp = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]*zip-time\.mjs)['"]/.exec(code);
      assert.ok(imp, `${rel} does not import from zip-time.mjs`);
      assert.equal(resolve(dirname(join(EXT, rel)), imp[2]), join(EXT, 'scripts', 'lib', 'zip-time.mjs'), `${rel} imports a different zip-time.mjs`);
      for (const n of ['DOS_TIME', 'DOS_DATE']) {
        assert.match(imp[1], new RegExp(`\\b${n}\\b`), `${rel} does not import ${n}`);
        assert.doesNotMatch(code, new RegExp(`(?:const|let|var)\\s[^;]*\\b${n}\\s*=`), `${rel} defines its own ${n}`);
      }
    }
  });

  test('Full_Screen_Shot\'s CommonJS packager carries the same VALUE as lib/zip-time.mjs', async () => {
    const { DOS_TIME, DOS_DATE } = await mod('scripts/lib/zip-time.mjs');
    const rel = 'Extension/Full_Screen_Shot/publish/package.node.js';
    const code = stripSourceComments(readFileSync(join(EXT, rel), 'utf8'), '.js');
    assert.equal(constValue(code, 'DOS_TIME'), DOS_TIME, `${rel} DOS_TIME differs from lib/zip-time.mjs`);
    assert.equal(constValue(code, 'DOS_DATE'), DOS_DATE, `${rel} DOS_DATE differs from lib/zip-time.mjs`);
  });
});

// ── 3 ───────────────────────────────────────────────────────────────────────
describe('the Chrome Web Store secret name is ONE constant', () => {
  test('extensions.yml\'s CWS_* secret names equal the Chrome preflight\'s, which include CWS_SA_ENV', async () => {
    const { CWS_SA_ENV } = await mod('scripts/publish-cws-token.mjs');
    const { LANES } = await mod('scripts/publish-arming.mjs');
    const preflight = new Set(LANES['chrome-webstore'].secrets.map((s) => s.name));
    assert.ok(preflight.has(CWS_SA_ENV), `the Chrome preflight does not require ${CWS_SA_ENV}`);

    const wf = parseWorkflow(REPO, '.github/workflows/extensions.yml');
    assert.ok(wf, 'extensions.yml could not be read');
    const mapped = [];
    for (const job of wf.jobs.values()) {
      for (const { text } of job.lines) {
        const m = /^\s+([A-Z][A-Z0-9_]*):\s*\$\{\{\s*secrets\.(CWS_[A-Z0-9_]+)\s*\}\}/.exec(text);
        if (m) mapped.push({ env: m[1], secret: m[2] });
      }
    }
    assert.ok(mapped.length >= 3, `found only ${mapped.length} CWS secret mapping(s) in extensions.yml; the scan is not reaching the steps`);
    for (const { env, secret } of mapped) assert.equal(env, secret, `extensions.yml maps secrets.${secret} into env ${env}; the scripts read process.env[name]`);
    assert.deepEqual([...new Set(mapped.map((m) => m.secret))].sort(), [...preflight].sort());
  });
});
