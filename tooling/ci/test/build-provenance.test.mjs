// build-provenance.test.mjs — every release file is attested and verified before it is described
// (O-RELEASES-HAVE-NO-PROVENANCE): tooling/ci/assert-build-provenance.mjs (the static half),
// tooling/ci/verify-provenance.mjs (the verify wrapper, against a stubbed `gh`), and
// tooling/ci/release-manifest.mjs --emit-release-json --provenance (the record).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeProvenance } from '../assert-build-provenance.mjs';
import { gradeVerify, VERIFY_DOC, SLSA_PROVENANCE } from '../verify-provenance.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling/ci/assert-build-provenance.mjs');
const WRAPPER = join(REPO, 'tooling/ci/verify-provenance.mjs');
const EMITTER = join(REPO, 'tooling/ci/release-manifest.mjs');
const PIN = 'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const run = (file, args) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', cwd: REPO });
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

// ── the static guard ────────────────────────────────────────────────────────
const RELEASE_JOB = ({ grants = '      id-token: write\n      attestations: write\n', attest = true, verify = true, provenance = true, attestAfter = false, uses = PIN } = {}) => {
  const attestStep = `      - name: Attest\n        id: attest\n        uses: ${uses}\n        with:\n          subject-path: dist/*\n`;
  const verifyStep = '      - name: Verify\n        run: node tooling/ci/verify-provenance.mjs --dir dist --repo o/r\n';
  const emitStep = `      - name: Describe\n        run: >\n          node tooling/ci/release-manifest.mjs --emit-release-json dist\n          --app x${provenance ? '\n          --provenance p.json' : ''}\n`;
  return [
    '  release:',
    '    runs-on: ubuntu-24.04',
    '    permissions:',
    '      contents: write',
    grants.replace(/\n$/, ''),
    '    steps:',
    (attest && !attestAfter ? attestStep : '') + (verify ? verifyStep : '') + emitStep + (attest && attestAfter ? attestStep : '') +
      '      - name: Publish\n        run: gh release create "$T" $assets',
  ].filter((l) => l !== '').join('\n');
};
function grade(...jobs) {
  const root = tmp('provenance-wf-');
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/rel.yml'), `name: rel\non:\n  push:\n    tags: ['x-v*']\n${jobs[0].startsWith('permissions') ? `${jobs.shift()}\n` : ''}jobs:\n${jobs.join('\n')}\n`);
  const out = gradeProvenance([parseWorkflow(root, '.github/workflows/rel.yml')]);
  rmSync(root, { recursive: true, force: true });
  return out;
}
const limbs = (r) => r.findings.map((f) => f.slice(0, 1)).sort().join('');

describe('assert-build-provenance.mjs — a release job attests, verifies and records; nothing else can sign', () => {
  test('GREEN CONTROL — attest, verify, describe with --provenance, both scopes granted: no finding', () => {
    const r = grade(RELEASE_JOB());
    assert.deepEqual(r.findings, []);
    assert.equal(r.releaseJobs.length, 1);
  });
  test('A RED — no attest step before the describe', () => assert.match(limbs(grade(RELEASE_JOB({ attest: false }))), /A/));
  test('A RED — the attest step comes AFTER the describe', () => assert.match(limbs(grade(RELEASE_JOB({ attestAfter: true }))), /A/));
  test('A RED — the attest action pinned by a tag, not a SHA', () => assert.match(limbs(grade(RELEASE_JOB({ uses: 'actions/attest-build-provenance@v4' }))), /A/));
  test('B RED — no verify step between the attest and the describe', () => assert.equal(limbs(grade(RELEASE_JOB({ verify: false }))), 'B'));
  test('C RED — the describe passes no --provenance', () => assert.equal(limbs(grade(RELEASE_JOB({ provenance: false }))), 'C'));
  test('D RED — the release job grants no id-token: write', () => {
    assert.equal(limbs(grade(RELEASE_JOB({ grants: '      attestations: write\n' }))), 'D');
  });
  test('E RED — a job publishes a Release and describes nothing', () => {
    const r = grade(RELEASE_JOB(), '  other:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: gh release create v1 a.zip');
    assert.equal(limbs(r), 'E');
  });
  test('F RED — ANOTHER job gains id-token: write and attests nothing', () => {
    const r = grade(RELEASE_JOB(), '  build:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      id-token: write\n    steps:\n      - run: echo hi');
    assert.equal(limbs(r), 'F');
    assert.match(r.findings[0], /rel\.yml#build: grants `id-token: write` and attests nothing/);
  });
  test('F RED — a workflow-level id-token: write reaches every job', () => {
    const r = grade('permissions:\n  contents: read\n  id-token: write', RELEASE_JOB());
    assert.equal(limbs(r), 'F');
  });
  test('the REAL tree is clean, and grades both release lanes', () => {
    const r = run(GUARD, []);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /build-platforms\.yml#release \(dist\)/);
    assert.match(r.stdout, /extensions\.yml#release \(extensions\/dist\)/);
  });
  test('COVERAGE LOST — a tree with workflows and no release job exits 2, never 0', () => {
    const root = tmp('provenance-none-');
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: ci\non: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n');
    const r = run(GUARD, ['--root', root]);
    rmSync(root, { recursive: true, force: true });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST/);
  });
});

// ── the verify wrapper, against a stubbed gh ────────────────────────────────
const verified = (digest, predicateType = SLSA_PROVENANCE) =>
  JSON.stringify([{ verificationResult: { statement: { predicateType, subject: [{ name: 'f', digest: { sha256: digest } }] } } }]);
/** A `gh` stand-in: a node script the wrapper runs for `--gh <x>.mjs`. `mode` match|mismatch|fail. */
function stubGh(dir, mode) {
  const p = join(dir, 'gh-stub.mjs');
  writeFileSync(
    p,
    [
      "import { createHash } from 'node:crypto';",
      "import { readFileSync } from 'node:fs';",
      'const file = process.argv[4];',
      `const mode = ${JSON.stringify(mode)};`,
      "if (mode === 'fail') { console.error('no attestations found'); process.exit(1); }",
      "const digest = mode === 'match' ? createHash('sha256').update(readFileSync(file)).digest('hex') : '0'.repeat(64);",
      `console.log(JSON.stringify([{ verificationResult: { statement: { predicateType: ${JSON.stringify(SLSA_PROVENANCE)}, subject: [{ name: file, digest: { sha256: digest } }] } } }]));`,
    ].join('\n'),
  );
  return p;
}
const wrap = (dir, gh, out) =>
  run(WRAPPER, [
    '--dir', dir, '--repo', 'o/r', '--signer-workflow', 'o/r/.github/workflows/build-platforms.yml',
    '--attestation-id', '123', '--attestation-url', 'https://github.com/o/r/attestations/123', '--out', out, '--gh', gh,
  ]);

describe('verify-provenance.mjs — every release file verifies, and as its own bytes', () => {
  test('gradeVerify GREEN — a verified SLSA statement naming this sha256', () => {
    assert.equal(gradeVerify({ name: 'a', sha256: 'a'.repeat(64), status: 0, stdout: verified('a'.repeat(64)) }).ok, true);
  });
  test('gradeVerify RED — gh exit 0 with a statement for OTHER bytes is a DIGEST MISMATCH', () => {
    const v = gradeVerify({ name: 'a', sha256: 'a'.repeat(64), status: 0, stdout: verified('b'.repeat(64)) });
    assert.equal(v.ok, false);
    assert.match(v.why, /DIGEST MISMATCH for a/);
  });
  test('gradeVerify RED — a statement that is not SLSA provenance names no subject this check accepts', () => {
    assert.equal(gradeVerify({ name: 'a', sha256: 'a'.repeat(64), status: 0, stdout: verified('a'.repeat(64), 'https://example/other') }).ok, false);
  });
  test('gradeVerify RED — a non-zero gh exit, and output that is not JSON', () => {
    assert.equal(gradeVerify({ name: 'a', sha256: 'a', status: 1, stdout: '', stderr: 'x' }).ok, false);
    assert.equal(gradeVerify({ name: 'a', sha256: 'a', status: 0, stdout: 'ok' }).ok, false);
  });
  test('THE RED CONTROL — a stubbed gh that reports a digest mismatch FAILS the release step, and writes no record', () => {
    const dir = tmp('provenance-dist-');
    const work = tmp('provenance-work-');
    writeFileSync(join(dir, 'x-1.0.0.apk'), 'apk bytes');
    const out = join(work, 'provenance.json');
    const r = wrap(dir, stubGh(work, 'mismatch'), out);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /DIGEST MISMATCH for x-1\.0\.0\.apk/);
    assert.equal(existsSync(out), false);
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  test('RED — a gh that finds no attestation fails the step', () => {
    const dir = tmp('provenance-dist-');
    const work = tmp('provenance-work-');
    writeFileSync(join(dir, 'a.zip'), 'zip');
    const r = wrap(dir, stubGh(work, 'fail'), join(work, 'p.json'));
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  test('GREEN — every file verifies as its own bytes; the record names each with its sha256', () => {
    const dir = tmp('provenance-dist-');
    const work = tmp('provenance-work-');
    writeFileSync(join(dir, 'a.zip'), 'zip a');
    writeFileSync(join(dir, 'b.tar.gz'), 'tar b');
    const out = join(work, 'p.json');
    const r = wrap(dir, stubGh(work, 'match'), out);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const rec = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(rec.schema, 'nikatru.provenance/1');
    assert.equal(rec.attestationId, '123');
    assert.deepEqual(rec.files, { 'a.zip': { sha256: sha256('zip a') }, 'b.tar.gz': { sha256: sha256('tar b') } });
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  test('COVERAGE LOST — an empty release directory exits 2', () => {
    const dir = tmp('provenance-empty-');
    const r = wrap(dir, 'gh', join(dir, '..', 'never.json'));
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    rmSync(dir, { recursive: true, force: true });
  });
  test('the doc --help names exists at that path (deleting it fails this)', () => {
    const r = run(WRAPPER, ['--help']);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes(VERIFY_DOC), r.stdout);
    assert.ok(existsSync(join(REPO, VERIFY_DOC)), `${VERIFY_DOC} is missing`);
    assert.match(readFileSync(join(REPO, VERIFY_DOC), 'utf8'), /gh attestation verify/);
  });
});

// ── release.json records the attestation per artefact ───────────────────────
describe('release-manifest.mjs --emit-release-json --provenance', () => {
  const emit = (dir, extra) =>
    run(EMITTER, [
      '--emit-release-json', dir, '--app', 'fullshot', '--tag', 'fullshot-v1.0.0',
      '--sha', 'a'.repeat(40), '--run-url', 'https://x/1', '--notes-url', 'https://x/2',
      '--released-at', '2026-09-22T10:00:00Z', '--version', '1.0.0', '--repo-root', REPO, ...extra,
    ]);
  const record = (files) => ({ schema: 'nikatru.provenance/1', repo: 'o/r', signerWorkflow: 'o/r/.github/workflows/extensions.yml', attestationId: '77', attestationUrl: 'https://github.com/o/r/attestations/77', files });

  test('GREEN — each artefact carries the attestation the verify step recorded for its bytes', () => {
    const dir = tmp('provenance-emit-');
    const work = tmp('provenance-rec-');
    writeFileSync(join(dir, 'fullshot-chromium.zip'), 'chromium bytes');
    writeFileSync(join(work, 'p.json'), JSON.stringify(record({ 'fullshot-chromium.zip': { sha256: sha256('chromium bytes') } })));
    const r = emit(dir, ['--provenance', join(work, 'p.json')]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const rel = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
    assert.deepEqual(rel.artefacts[0].provenance, { attestationId: '77', attestationUrl: 'https://github.com/o/r/attestations/77' });
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  test('RED — a file the verify step did not name is refused, and no release.json is written', () => {
    const dir = tmp('provenance-emit-');
    const work = tmp('provenance-rec-');
    writeFileSync(join(dir, 'fullshot-chromium.zip'), 'chromium bytes');
    writeFileSync(join(dir, 'fullshot-firefox.zip'), 'firefox bytes');
    writeFileSync(join(work, 'p.json'), JSON.stringify(record({ 'fullshot-chromium.zip': { sha256: sha256('chromium bytes') } })));
    const r = emit(dir, ['--provenance', join(work, 'p.json')]);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /fullshot-firefox\.zip carries no verified build provenance/);
    assert.equal(existsSync(join(dir, 'release.json')), false);
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
  test('RED — a file changed after it was verified (another sha256) is refused', () => {
    const dir = tmp('provenance-emit-');
    const work = tmp('provenance-rec-');
    writeFileSync(join(dir, 'fullshot-chromium.zip'), 'chromium bytes, swapped');
    writeFileSync(join(work, 'p.json'), JSON.stringify(record({ 'fullshot-chromium.zip': { sha256: sha256('chromium bytes') } })));
    const r = emit(dir, ['--provenance', join(work, 'p.json')]);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /it was verified as sha256/);
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });
});
