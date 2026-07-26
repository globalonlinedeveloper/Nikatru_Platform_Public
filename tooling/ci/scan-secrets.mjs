#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scan-secrets.mjs — a repo-side secret scanner that proves itself first.
//
// GitHub's push protection only matches KNOWN PROVIDER PATTERNS — a GitHub
// token, an AWS key, a Stripe key. The secrets this project actually holds are
// not that shape: the rclone crypt password is just a string, and
// `non_provider_patterns` (generic high-entropy detection) is off. So the exact
// class of credential we carry is the class push protection cannot see. And a
// service is not evidence: nothing in the repo scanned at all, so there was
// nothing to run locally and nothing to negative-test.
//
// ⚠️ THE SELF-TEST IS THE POINT, not a nicety. Before scanning the repo this
// plants a known secret in a temp directory and asserts the scanner flags it. A
// scanner that silently stopped detecting — wrong binary, broken config, a flag
// whose meaning changed between versions — would otherwise report "clean"
// forever, which is this repo's single most repeated failure mode.
//
// Scope, deliberately: scans the WORKING TREE, not full git history (CI checks
// out shallow, and history scanning is heavier separate work). Nothing private
// has ever entered this repo's history — verified 2026-07-26.
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-6.
//
// Usage:  node tooling/ci/scan-secrets.mjs [repoRoot] [--gitleaks <path>]
// Exit 0 = clean, 1 = a finding, a broken scanner, or a failed self-test.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const glIdx = args.indexOf('--gitleaks');
const gitleaks = glIdx >= 0 ? args[glIdx + 1] : 'gitleaks';
const positional = args.filter((a, i) => !a.startsWith('--') && i !== glIdx + 1);
const repoRoot = positional[0] ?? process.cwd();

/** A PEM header trips gitleaks' `private-key` rule. Chosen over a fake cloud key
 *  because provider rules get allowlisted and revised between releases, whereas
 *  this one is structural and stable. It is not a real key. */
const CANARY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAxGZlNotARealKeyJustAStructuralCanaryForTheSelfTest0000',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

/** TESTABILITY SEAM, and the only reason it exists: the behaviour that matters
 *  most here is "the wrapper FAILS when the scanner stops detecting", and that
 *  cannot be exercised with the real binary — a working gitleaks always detects.
 *  So a `.mjs`/`.js` value for --gitleaks is executed with node, letting the
 *  tests substitute a scanner that detects nothing. Real CI passes a real
 *  binary path and never takes this branch. */
const asJs = /\.m?js$/.test(gitleaks);
const exe = asJs ? process.execPath : gitleaks;
const lead = asJs ? [gitleaks] : [];

function runGitleaks(sourceDir, extra = []) {
  return spawnSync(exe, [...lead, 'detect', '--no-git', '--redact', '--source', sourceDir, ...extra], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
}

// ── 0. the scanner must exist at all ─────────────────────────────────────────
const version = spawnSync(exe, [...lead, 'version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error(`✗ gitleaks not runnable at "${gitleaks}" — ${version.error?.message ?? `exit ${version.status}`}`);
  console.error('  Install it in the job, or pass --gitleaks <path>.');
  process.exit(1);
}
console.log(`gitleaks ${(version.stdout ?? '').trim()}`);

// ── 1. SELF-TEST: prove the scanner still detects ────────────────────────────
const canaryDir = mkdtempSync(join(tmpdir(), 'nikatru-canary-'));
try {
  writeFileSync(join(canaryDir, 'planted.key'), `${CANARY}\n`);
  const probe = runGitleaks(canaryDir);
  if (probe.status === 0) {
    console.error('✗ SELF-TEST FAILED — the scanner did not flag a planted private key.');
    console.error('  It would have reported this repository "clean" while detecting nothing.');
    console.error('  Do not trust a passing scan until this is fixed.');
    process.exit(1);
  }
  console.log('ok  self-test — a planted secret is still detected');
} finally {
  rmSync(canaryDir, { recursive: true, force: true });
}

// ── 2. the real scan ─────────────────────────────────────────────────────────
if (!existsSync(repoRoot)) {
  console.error(`✗ repo root does not exist: ${repoRoot}`);
  process.exit(1);
}

const cfg = join(repoRoot, '.gitleaks.toml');
const reportDir = mkdtempSync(join(tmpdir(), 'nikatru-scan-'));
const reportPath = join(reportDir, 'findings.json');

const real = runGitleaks(repoRoot, [
  '--report-format',
  'json',
  '--report-path',
  reportPath,
  ...(existsSync(cfg) ? ['--config', cfg] : []),
]);

if (real.status !== 0) {
  console.error('✗ secret scan found something:');
  // Report WHERE, never WHAT. `--redact` hides the value; without a parsed
  // report gitleaks' console output says only "leaks found: N", which is not
  // actionable — you cannot judge a false positive you cannot locate.
  try {
    const findings = JSON.parse(readFileSync(reportPath, 'utf8'));
    for (const f of findings) {
      console.error(`    ${f.File}:${f.StartLine}  rule=${f.RuleID}  ${f.Description ?? ''}`);
    }
  } catch {
    console.error(real.stdout ?? '');
    console.error(real.stderr ?? '');
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
  console.error('  If this is a false positive, allowlist it in .gitleaks.toml — but note that');
  console.error('  every allowlist entry is a hole in the net, so make it as narrow as possible.');
  process.exit(1);
}
rmSync(reportDir, { recursive: true, force: true });

console.log('ok  secret scan — no findings in the working tree');
