// build-provenance.test.mjs — every release file is attested and verified by an attest-only job
// (O-RELEASES-HAVE-NO-PROVENANCE (absent from open.json until the next Private pass records it)): tooling/ci/assert-build-provenance.mjs (the static half) and
// tooling/ci/verify-provenance.mjs (the verify wrapper, against a stubbed `gh`).
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
const PIN = 'actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8';
const UP = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const DOWN = 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const run = (file, args) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', cwd: REPO });
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

// ── the static guard ────────────────────────────────────────────────────────
/** The release job: describe, --write, then hand the directory over (or not, or too early). */
const RELEASE_JOB = ({ handOver = 'after', releaseGrants = '' } = {}) => {
  const up = `      - name: Hand over\n        uses: ${UP}\n        with:\n          name: release-dist-\${{ matrix.app }}\n          path: dist\n`;
  return [
    '  release:',
    '    runs-on: ubuntu-24.04',
    '    permissions:',
    '      contents: write',
    releaseGrants.replace(/\n$/, ''),
    '    steps:',
    (handOver === 'before' ? up : '') +
      '      - name: Describe\n        run: >\n          node tooling/ci/release-manifest.mjs --emit-release-json dist\n          --app x\n' +
      '      - name: Checksums\n        run: >\n          node tooling/ci/release-manifest.mjs --write dist\n          --app x\n' +
      (handOver === 'after' ? up : '') +
      '      - name: Publish\n        run: gh release create "$T" $assets',
  ].filter((l) => l !== '').join('\n');
};
/** The attest-only job that needs it. */
const ATTEST_JOB = ({ grants = '      id-token: write\n      attestations: write\n', needs = 'release', attest = true, verify = true, verifyFirst = false, uses = PIN, into = 'dist', subject = 'dist/*' } = {}) => {
  const att = `      - name: Attest\n        id: attest\n        uses: ${uses}\n        with:\n          subject-path: ${subject}\n`;
  const ver = `      - name: Verify\n        run: node tooling/ci/verify-provenance.mjs --dir ${into} --repo o/r\n`;
  return [
    '  attest:',
    `    needs: [${needs}]`,
    '    runs-on: ubuntu-24.04',
    '    permissions:',
    '      contents: read',
    grants.replace(/\n$/, ''),
    '    steps:',
    `      - name: Take it\n        uses: ${DOWN}\n        with:\n          name: release-dist-\${{ matrix.app }}\n          path: ${into}\n` +
      (verify && verifyFirst ? ver : '') + (attest ? att : '') + (verify && !verifyFirst ? ver : ''),
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

describe('assert-build-provenance.mjs — an attest-only job signs and verifies every release file; nothing else can sign', () => {
  test('GREEN CONTROL — the release job hands its whole directory over after --write; the attest job attests and verifies it', () => {
    const r = grade(RELEASE_JOB(), ATTEST_JOB());
    assert.deepEqual(r.findings, []);
    assert.equal(r.releaseJobs.length, 1);
  });
  test('C RED — the directory is handed over BEFORE --write, so release.json and SHA256SUMS are not in what is signed', () => {
    assert.match(limbs(grade(RELEASE_JOB({ handOver: 'before' }), ATTEST_JOB())), /C/);
  });
  test('C RED — the release job hands nothing over', () => assert.match(limbs(grade(RELEASE_JOB({ handOver: 'none' }), ATTEST_JOB())), /C/));
  test('A RED — no job attests the directory', () => assert.match(limbs(grade(RELEASE_JOB(), ATTEST_JOB({ attest: false, verify: false, grants: '' }))), /^A+$/));
  test('A RED — the attest job does not need the release job', () => assert.match(limbs(grade(RELEASE_JOB(), ATTEST_JOB({ needs: 'other' }), '  other:\n    runs-on: x\n    steps:\n      - run: echo')), /A/));
  test('A RED — the attest step signs another path than the download', () => assert.match(limbs(grade(RELEASE_JOB(), ATTEST_JOB({ subject: 'elsewhere/*' }))), /A/));
  test('A RED — the attest action pinned by a tag, not a SHA', () => assert.match(limbs(grade(RELEASE_JOB(), ATTEST_JOB({ uses: 'actions/attest-build-provenance@v4' }))), /A/));
  test('B RED — no verify after the attest', () => assert.equal(limbs(grade(RELEASE_JOB(), ATTEST_JOB({ verify: false }))), 'B'));
  test('B RED — the verify runs BEFORE the attest', () => assert.equal(limbs(grade(RELEASE_JOB(), ATTEST_JOB({ verifyFirst: true }))), 'B'));
  test('D RED — the attest job grants no id-token: write', () => {
    assert.equal(limbs(grade(RELEASE_JOB(), ATTEST_JOB({ grants: '      attestations: write\n' }))), 'D');
  });
  test('F RED — the RELEASE job holds id-token: write (the review\'s finding 3)', () => {
    const r = grade(RELEASE_JOB({ releaseGrants: '      id-token: write\n' }), ATTEST_JOB());
    assert.equal(limbs(r), 'F');
    assert.match(r.findings[0], /rel\.yml#release: grants `id-token: write` and attests nothing/);
  });
  test('E RED — a job publishes a Release and describes nothing', () => {
    assert.equal(limbs(grade(RELEASE_JOB(), ATTEST_JOB(), '  other:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: gh release create v1 a.zip')), 'E');
  });
  test('F RED — ANOTHER job gains id-token: write and attests nothing', () => {
    const r = grade(RELEASE_JOB(), ATTEST_JOB(), '  build:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: read\n      id-token: write\n    steps:\n      - run: echo hi');
    assert.equal(limbs(r), 'F');
    assert.match(r.findings[0], /rel\.yml#build: grants `id-token: write` and attests nothing/);
  });
  test('F RED — a workflow-level id-token: write reaches every job', () => {
    assert.equal(limbs(grade('permissions:\n  contents: read\n  id-token: write', RELEASE_JOB(), ATTEST_JOB())), 'F');
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

