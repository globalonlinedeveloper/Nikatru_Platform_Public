#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-provenance.mjs — every file a release publishes carries a GitHub
// build-provenance attestation this lane can VERIFY, before the release is
// described, checksummed or published.
//
// ⏱ ADDED 2026-10-03 (O-RELEASES-HAVE-NO-PROVENANCE, build-provenance). The
// release jobs (build-platforms.yml `release`, extensions.yml `release`) run
// actions/attest-build-provenance over their release directory; this wrapper
// then runs `gh attestation verify <file> --repo <owner/repo> --signer-workflow
// <owner/repo>/.github/workflows/<lane>.yml --format json` for EVERY file in
// that directory and does not take gh's exit 0 as the answer: it hashes the
// file itself and requires a verified SLSA provenance statement whose subject
// names that sha256. A verify that answered for some other bytes is a finding.
//
// The record it writes (`--out`, outside the release directory, which is flat
// and published whole) is what `release-manifest.mjs --emit-release-json
// --provenance <file>` reads: each artefact in release.json then carries the
// attestation that THIS run signed for it, and SHA256SUMS, written after,
// names that release.json.
//
// How anyone verifies a download by hand: VERIFY_DOC below (`--help` prints it).
//
// Usage:
//   node tooling/ci/verify-provenance.mjs --dir <release dir> --repo <owner/repo>
//     --signer-workflow <owner/repo>/.github/workflows/<file>.yml
//     --attestation-id <id> --attestation-url <url> --out <file> [--gh <path>]
//   node tooling/ci/verify-provenance.mjs --help
// Exit 0 = every file verified. 1 = a file did not verify, a digest mismatch, or
// a bad invocation. 2 = COVERAGE LOST (an empty release directory, or no `gh`
// to verify with).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

export const VERIFY_DOC = 'docs/release/verify-a-download.md';
export const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1';
export const RECORD_SCHEMA = 'nikatru.provenance/1';
const GH_TIMEOUT_MS = 120_000;

const USAGE = [
  'Usage: node tooling/ci/verify-provenance.mjs --dir <release dir> --repo <owner/repo>',
  '         --signer-workflow <owner/repo>/.github/workflows/<file>.yml',
  '         --attestation-id <id> --attestation-url <url> --out <file> [--gh <path>]',
  '',
  `How anyone verifies a download by hand: ${VERIFY_DOC}`,
].join('\n');

function coverageLost(...lines) {
  console.error(`✗ COVERAGE LOST — ${lines.join('\n  ')}`);
  process.exit(2);
}

/** PURE. The verdict for one file, from gh's exit and its `--format json` output. */
export function gradeVerify({ name, sha256, status, stdout, stderr }) {
  if (status !== 0) {
    return { ok: false, why: `gh attestation verify exited ${status} for ${name}: ${String(stderr ?? '').trim().slice(0, 400)}` };
  }
  let results;
  try {
    results = JSON.parse(stdout);
  } catch {
    return { ok: false, why: `gh attestation verify printed no JSON for ${name}, so nothing says which bytes it verified.` };
  }
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, why: `gh attestation verify returned no verified attestation for ${name}.` };
  }
  const digests = [];
  for (const r of results) {
    const st = r?.verificationResult?.statement;
    if (st?.predicateType !== SLSA_PROVENANCE) continue;
    for (const s of st?.subject ?? []) if (typeof s?.digest?.sha256 === 'string') digests.push(s.digest.sha256);
  }
  if (digests.includes(sha256)) return { ok: true };
  return {
    ok: false,
    why:
      `DIGEST MISMATCH for ${name}: the file is sha256 ${sha256}, and the verified provenance names ` +
      `${digests.length ? digests.join(', ') : 'no SLSA provenance subject at all'}. The attestation is for other bytes.`,
  };
}

/** Every file of the flat release directory, hashed: [{ name, path, sha256 }]. */
export function releaseFiles(dir) {
  return listDir(dir)
    .sort()
    .map((name) => ({ name, path: join(dir, name) }))
    .filter((f) => statSync(f.path).isFile())
    .map((f) => ({ ...f, sha256: createHash('sha256').update(readFileSync(f.path)).digest('hex') }));
}

/** Runs gh for one file. A `.mjs` gh is a node script (the tests' stub), run with this node. */
function runGh(gh, args) {
  const [cmd, argv] = gh.endsWith('.mjs') ? [process.execPath, [gh, ...args]] : [gh, args];
  return spawnSync(cmd, argv, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
}

function main(argv) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i === -1 || i + 1 >= argv.length || argv[i + 1].startsWith('--') ? null : argv[i + 1];
  };
  const dir = opt('dir');
  const repo = opt('repo');
  const signer = opt('signer-workflow');
  const attestationId = opt('attestation-id');
  const attestationUrl = opt('attestation-url');
  const out = opt('out');
  const gh = opt('gh') ?? 'gh';
  const bad = [];
  if (!dir) bad.push('--dir');
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) bad.push('--repo <owner/repo>');
  if (!signer || !signer.startsWith(`${repo}/.github/workflows/`)) bad.push('--signer-workflow <owner/repo>/.github/workflows/<file>.yml');
  if (!attestationId || !/^[0-9]+$/.test(attestationId)) bad.push('--attestation-id <digits>');
  if (!attestationUrl || !attestationUrl.startsWith('https://')) bad.push('--attestation-url <https url>');
  if (!out) bad.push('--out');
  if (bad.length) {
    console.error(`✗ verify-provenance: missing or malformed ${bad.join(', ')}.\n${USAGE}`);
    return 1;
  }
  let files;
  try {
    files = releaseFiles(dir);
  } catch (e) {
    coverageLost(`${dir} cannot be read (${e.code ?? e.message}).`);
  }
  if (files.length === 0) coverageLost(`${dir} holds no file, so there is nothing to verify and "every file verified" would be a claim about nothing.`);

  const failures = [];
  const record = { schema: RECORD_SCHEMA, repo, signerWorkflow: signer, attestationId, attestationUrl, files: {} };
  for (const f of files) {
    const r = runGh(gh, ['attestation', 'verify', f.path, '--repo', repo, '--signer-workflow', signer, '--format', 'json']);
    if (r.error?.code === 'ENOENT') coverageLost(`\`${gh}\` is not on this runner, so no attestation was verified.`);
    const v = gradeVerify({ name: f.name, sha256: f.sha256, status: r.status, stdout: r.stdout, stderr: r.stderr ?? r.error?.message });
    if (v.ok) {
      console.log(`ok   ${f.name}  sha256 ${f.sha256}  provenance verified (${signer})`);
      record.files[f.name] = { sha256: f.sha256 };
    } else {
      console.error(`✗    ${v.why}`);
      failures.push(f.name);
    }
  }
  if (failures.length) {
    console.error(`✗ verify-provenance: ${failures.length} of ${files.length} file(s) in ${dir} did not verify; the release is not described.`);
    return 1;
  }
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`ok   ${files.length} file(s) in ${dir} carry verified build provenance (attestation ${attestationId}); recorded in ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
