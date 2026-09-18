// precommit-pii.test.mjs — the pre-commit hook scans the STAGED diff with the
// repo's own .gitleaks.toml before a commit exists (O-PAN-IN-PUBLIC-HISTORY).
//
// The proprietor's real PAN reached this public repo in a test fixture; CI's
// gitleaks job only sees it after the push. These cases drive the REAL
// .githooks/pre-commit in a throwaway git repo with a STUB `gitleaks` first on
// PATH, so they run on a CI runner that has no gitleaks installed and assert the
// hook's own wiring: it calls gitleaks on the staged diff with the repo config,
// and a finding refuses the commit.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = join(REPO, '.githooks', 'pre-commit');

/** A throwaway repo carrying the real hook, a runner stub that passes, and a
 *  gitleaks stub that logs its argv and exits with STUB_EXIT. */
function sandbox({ withConfig = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'precommit-pii-'));
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(root, '.githooks'));
  copyFileSync(HOOK, join(root, '.githooks', 'pre-commit'));
  mkdirSync(join(root, 'tooling', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'scripts', 'spec-guards.mjs'), 'process.exit(0);\n');
  if (withConfig) writeFileSync(join(root, '.gitleaks.toml'), '# stub config\n');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const stub = join(bin, 'gitleaks');
  writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$@" > "$STUB_LOG"\nexit "${STUB_EXIT:-0}"\n');
  chmodSync(stub, 0o755);
  writeFileSync(join(root, 'staged.txt'), 'hello\n');
  git('add', 'staged.txt');
  return { root, bin, log: join(root, 'stub.log') };
}

function runHook(box, stubExit) {
  const r = spawnSync('sh', ['.githooks/pre-commit'], {
    cwd: box.root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${box.bin}${delimiter}${process.env.PATH}`, STUB_LOG: box.log, STUB_EXIT: String(stubExit) },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('a gitleaks finding on the staged diff REFUSES the commit', () => {
  const box = sandbox();
  try {
    const { code, out } = runHook(box, 1);
    assert.equal(code, 1, out);
    assert.match(out, /gitleaks found a secret or Indian PII in the staged diff/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test('GREEN CONTROL — a clean scan passes, and the scan was the staged diff with the repo config', () => {
  const box = sandbox();
  try {
    const { code, out } = runHook(box, 0);
    assert.equal(code, 0, out);
    const argv = readFileSync(box.log, 'utf8').split('\n');
    assert.ok(argv.includes('--pre-commit') && argv.includes('--staged'), `argv: ${argv.join(' ')}`);
    const cfg = argv[argv.indexOf('--config') + 1] ?? '';
    assert.match(cfg.replace(/\\/g, '/'), /\.gitleaks\.toml$/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test('a repo with no .gitleaks.toml (Private shares this hook) is not scanned', () => {
  const box = sandbox({ withConfig: false });
  try {
    const { code, out } = runHook(box, 1);
    assert.equal(code, 0, out);
    assert.equal(existsSync(box.log), false, 'gitleaks must not be called without a config');
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});
