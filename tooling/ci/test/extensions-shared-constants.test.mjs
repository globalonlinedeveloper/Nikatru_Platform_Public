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
//      templates/tool/publish/pack.mjs import it, and since 2026-09-20
//      Full_Screen_Shot's CommonJS packager `require()`s it too, so there is no
//      longer a value to compare. The three cases below grade the three things
//      that replaced the comparison: the packager reads that module and defines
//      neither constant itself; the BYTES its writeZip stamps into a real
//      archive are the module's values; and the node majors extensions-ci.yml runs
//      the sims on are all high enough for a CommonJS file to require an ES
//      module at all (22.12.0 and up), because that is what the first two rest
//      on and it is written in a workflow matrix nothing else reads.
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
import { createRequire } from 'node:module';
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
const ZIP_TIME = join(EXT, 'scripts', 'lib', 'zip-time.mjs');
const FULLSHOT_PKG = 'Extension/Full_Screen_Shot/publish/package.node.js';

describe('the zip timestamp is ONE constant', () => {
  const IMPORTERS = ['scripts/pack.mjs', 'templates/tool/publish/pack.mjs'];

  test('scripts/pack.mjs and the template packager import DOS_TIME/DOS_DATE from lib/zip-time.mjs and define no copy', () => {
    for (const rel of IMPORTERS) {
      const code = stripSourceComments(readFileSync(join(EXT, rel), 'utf8'), '.mjs');
      const imp = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]*zip-time\.mjs)['"]/.exec(code);
      assert.ok(imp, `${rel} does not import from zip-time.mjs`);
      assert.equal(resolve(dirname(join(EXT, rel)), imp[2]), ZIP_TIME, `${rel} imports a different zip-time.mjs`);
      for (const n of ['DOS_TIME', 'DOS_DATE']) {
        assert.match(imp[1], new RegExp(`\\b${n}\\b`), `${rel} does not import ${n}`);
        assert.doesNotMatch(code, new RegExp(`(?:const|let|var)\\s[^;]*\\b${n}\\s*=`), `${rel} defines its own ${n}`);
      }
    }
  });

  test('Full_Screen_Shot\'s CommonJS packager requires DOS_TIME/DOS_DATE from lib/zip-time.mjs and defines neither', () => {
    const code = stripSourceComments(readFileSync(join(EXT, FULLSHOT_PKG), 'utf8'), '.js');
    const req = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]*zip-time\.mjs)['"]\s*\)/.exec(code);
    assert.ok(req, `${FULLSHOT_PKG} does not require zip-time.mjs`);
    assert.equal(resolve(dirname(join(EXT, FULLSHOT_PKG)), req[2]), ZIP_TIME, `${FULLSHOT_PKG} requires a different zip-time.mjs`);
    for (const n of ['DOS_TIME', 'DOS_DATE']) {
      assert.match(req[1], new RegExp(`\\b${n}\\b`), `${FULLSHOT_PKG} does not destructure ${n} from zip-time.mjs`);
    }
    // The destructure above spells both names with a `,` or a `}` after them, so
    // ANY `DOS_TIME =` / `DOS_DATE =` left in comment-free code is a second
    // definition — which is how this constant came to be written three times.
    assert.doesNotMatch(code, /\bDOS_(?:TIME|DATE)\s*=/, `${FULLSHOT_PKG} assigns DOS_TIME/DOS_DATE itself`);
  });

  test('the bytes Full_Screen_Shot\'s writeZip stamps ARE lib/zip-time.mjs\'s values', async () => {
    // The case above is about the source text; this one opens an archive the
    // packager just wrote and reads the two header fields out of it. A literal
    // spliced back into writeZip, or a zip-time.mjs value that no longer
    // reaches the writer, fails HERE even if the require line still reads right.
    const { DOS_TIME, DOS_DATE } = await mod('scripts/lib/zip-time.mjs');
    const PKG = createRequire(import.meta.url)(join(EXT, FULLSHOT_PKG));
    assert.equal(typeof PKG.writeZip, 'function', `${FULLSHOT_PKG} no longer exports writeZip`);

    const zip = join(TMP, `ziptime${seq++}.zip`);
    // One tiny entry: deflate would not pay, so the writer takes its `store`
    // branch and the archive is small enough to read field by field. Both
    // branches write the same two timestamp fields, so either would do.
    PKG.writeZip(zip, [{ name: 'a.txt', data: Buffer.from('x') }]);
    const buf = readFileSync(zip);

    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'the first record is not a zip local header');
    assert.equal(buf.readUInt16LE(10), DOS_TIME, 'the local header carries a different DOS time');
    assert.equal(buf.readUInt16LE(12), DOS_DATE, 'the local header carries a different DOS date');

    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(cd > 0, 'no central-directory record in the archive');
    assert.equal(buf.readUInt16LE(cd + 12), DOS_TIME, 'the central directory carries a different DOS time');
    assert.equal(buf.readUInt16LE(cd + 14), DOS_DATE, 'the central directory carries a different DOS date');
  });

  test('extensions-ci.yml runs the Full_Screen_Shot sims only on node majors that can require() an ES module', () => {
    // THE FLOOR THE TWO CASES ABOVE REST ON. `require()` of an .mjs is enabled
    // by default from node 22.12.0; below it the packager — and therefore
    // test/i18n-sim.node.js, which requires it — throws ERR_REQUIRE_ESM at load.
    // The majors are written in ONE place, the sims matrix, and no other guard
    // reads them: tooling/ci/assert-version-consistency.mjs's Node rule matches
    // `node-version:` literals, and that step installs `${{ matrix.node }}`.
    // A bare major is safe because setup-node resolves it to the newest release
    // of that line, which for 22 can never again be below 22.12.
    const MIN_MAJOR = 22;
    const wf = parseWorkflow(REPO, '.github/workflows/extensions-ci.yml');
    assert.ok(wf, 'extensions-ci.yml could not be read');
    const sims = wf.jobs.get('sims');
    assert.ok(sims, 'extensions-ci.yml has no `sims` job — the sims moved and this floor is now unguarded');

    const lines = sims.lines.map((l) => l.text);
    const matrix = lines.find((t) => /^\s+node:\s*\[/.test(t));
    assert.ok(matrix, 'the `sims` job no longer carries a `node:` matrix list');
    const majors = [...matrix.matchAll(/'([0-9]+)(?:\.[0-9.]+)?'/g)].map((m) => Number(m[1]));
    assert.ok(majors.length >= 2, `the sims matrix names ${majors.length} node version(s): ${matrix.trim()}`);
    for (const m of majors) {
      assert.ok(m >= MIN_MAJOR, `the sims run on node ${m}; Extension/Full_Screen_Shot/publish/package.node.js requires an ES module and needs ${MIN_MAJOR}.12 or newer`);
    }
    // ...and the matrix is what gets installed, or the majors above are decoration.
    assert.ok(lines.some((t) => /node-version:\s*'\$\{\{\s*matrix\.node\s*\}\}'/.test(t)),
      'the sims job no longer installs `${{ matrix.node }}`, so its matrix is not the node the sims run on');
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

// ── 4 ───────────────────────────────────────────────────────────────────────
// G3, 2026-09-24. publish/package.node.js's main() and verifyPackage() were a
// second packer no workflow ran, and they were retired. Two things they graded
// had no other reader, and these cases are those readers now: its NET regex was
// the only list naming RTCPeerConnection and SharedWorker, and its main() was the
// only thing comparing its mergePatch with scripts/pack.mjs's.
const NETWORK_SAMPLES = {
  'fetch(': 'fetch(url)',
  XMLHttpRequest: 'const x = new XMLHttpRequest();',
  WebSocket: 'const s = new WebSocket(url);',
  EventSource: 'const e = new EventSource(url);',
  sendBeacon: 'navigator.sendBeacon(url, data);',
  RTCPeerConnection: 'const pc = new RTCPeerConnection();',
  SharedWorker: "const w = new SharedWorker('w.js');",
};

/** policy-check.mjs's NETWORK table, evaluated from its own source: the gate is a
 *  script that runs when imported, so the table is read rather than imported. */
function policyCheckNetwork() {
  const src = readFileSync(join(EXT, 'scripts', 'policy-check.mjs'), 'utf8');
  const m = /\nconst NETWORK = (\[[\s\S]*?\n\]);/.exec(src);
  assert.ok(m, 'scripts/policy-check.mjs no longer declares `const NETWORK = [ ... ];` at column 0');
  const table = new Function(`return ${m[1]};`)();
  assert.ok(Array.isArray(table) && table.length >= 7, `NETWORK has ${table && table.length} row(s)`);
  return table;
}
const flaggedBy = (table, line) => table.filter(({ re }) => new RegExp(re.source, re.flags.replace('g', '')).test(line)).map((r) => r.name);

describe('one network-API list, and it names what the retired packer named', () => {
  test('policy-check NETWORK flags each of the seven network APIs, RTCPeerConnection and SharedWorker among them', () => {
    const table = policyCheckNetwork();
    const missed = Object.entries(NETWORK_SAMPLES).filter(([, line]) => flaggedBy(table, line).length === 0).map(([api]) => api);
    assert.deepEqual(missed, [], `policy-check.mjs NETWORK does not flag: ${missed.join(', ')}`);
  });

  test('policy-check NETWORK does not flag a line that names no network API', () => {
    const table = policyCheckNetwork();
    assert.deepEqual(flaggedBy(table, 'const peer = makePeer(); const worker = new Worker("w.js");'), []);
  });

  test('the template verify-package NET regex flags the same seven APIs', () => {
    const src = readFileSync(join(EXT, 'templates', 'tool', 'publish', 'verify-package.node.js'), 'utf8');
    const m = /\nconst NET = (\/.+\/g);\n/.exec(src);
    assert.ok(m, 'templates/tool/publish/verify-package.node.js no longer declares `const NET = /.../g;`');
    const NET = new Function(`return ${m[1]};`)();
    const missed = Object.entries(NETWORK_SAMPLES).filter(([, line]) => !new RegExp(NET.source).test(line)).map(([api]) => api);
    assert.deepEqual(missed, [], `the template NET regex does not flag: ${missed.join(', ')}`);
  });

  /* ⏱ 2026-09-25 (F-b): scripts/pack.mjs's mergePatch moved to scripts/lib/merge-patch.mjs, which
     pack.mjs now imports, so the comparison reads the lib. */
  test('Full_Screen_Shot\'s package.node.js mergePatch is scripts/lib/merge-patch.mjs\'s mergePatch', () => {
    const PKG = createRequire(import.meta.url)(join(EXT, FULLSHOT_PKG));
    assert.equal(typeof PKG.mergePatchDrift, 'function', `${FULLSHOT_PKG} no longer exports mergePatchDrift`);
    const drift = PKG.mergePatchDrift();
    assert.notEqual(drift, null, 'scripts/lib/merge-patch.mjs is not reachable from the packager, so nothing was compared');
    assert.equal(drift, '', drift);
  });
});
