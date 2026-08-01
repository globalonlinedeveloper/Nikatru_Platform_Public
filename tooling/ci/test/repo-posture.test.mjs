// ─────────────────────────────────────────────────────────────────────────────
// repo-posture.test.mjs — assert-repo-posture.mjs must be able to FAIL.
//
// [pipeline K-12] The guard's third limb protects the one decision in this
// repository with no undo — a licence grant cannot be un-granted — so "it printed
// ok" is not evidence it looked.
//
// Fixture trees, because the real tree is compliant by construction. ⚠️ The real
// mutation record for this guard is against a COPY OF THE REAL TREE, not against
// these fixtures: two of the ten mutations here were originally written as
// single-occurrence string swaps and the guard correctly stayed GREEN, because
// the address and the posture token each appear more than once in the real
// documents. A fixture agrees with whatever misunderstanding wrote it; the real
// tree does not.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-repo-posture.mjs');

const ADDR = 'support@example.test';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-posture-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A minimal tree with every surface the guard reads. Each option below is the
 *  ONE thing a given test breaks, so a failure names the limb. */
function repo({
  brickEmail = ADDR,
  securityEmail = ADDR,
  contactEmail = ADDR,
  appEmails = [ADDR],
  notice = 'This repository is source-visible. It is not open-source.',
  security = true,
  noticeFile = true,
  brickConfig = true,
  contactPage = true,
  rootFiles = {},
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const brickDir = join(root, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib', 'core');
  mkdirSync(brickDir, { recursive: true });
  if (brickConfig) {
    writeFileSync(
      join(brickDir, 'app_config.dart'),
      `class AppConfig {\n  static const String supportEmail = '${brickEmail}';\n}\n`,
    );
  }

  const siteDir = join(root, 'sites', 'nikatru');
  mkdirSync(siteDir, { recursive: true });
  if (contactPage) {
    writeFileSync(
      join(siteDir, 'contact.html'),
      `<html><head><style>@media print { a { color: #000 } }</style></head>` +
        `<body><p>Write to ${contactEmail}</p></body></html>\n`,
    );
  }

  appEmails.forEach((email, i) => {
    const d = join(root, 'apps', `app${i}`, 'lib', 'core', 'config');
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, 'app_config.dart'),
      email === null
        ? "class AppConfig {\n  static const String contactUrl = 'https://example.test/contact.html';\n}\n"
        : `class AppConfig {\n  static const String supportEmail = '${email}';\n}\n`,
    );
  });
  if (appEmails.length === 0) mkdirSync(join(root, 'apps'), { recursive: true });

  if (security) {
    writeFileSync(join(root, 'SECURITY.md'), `# Security policy\n\nEmail ${securityEmail}.\n`);
  }
  if (noticeFile) writeFileSync(join(root, 'NOTICE.md'), `# Notice\n\n${notice}\n`);
  for (const [name, body] of Object.entries(rootFiles)) writeFileSync(join(root, name), body);
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

describe('assert-repo-posture', () => {
  test('a compliant tree passes and says what it checked', () => {
    const r = run(repo());
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 app config\(s\) all name support@example\.test/);
    assert.match(r.stdout, /no LICENCE grant at the root/);
  });

  // ── LIMB 1 · one contact address, three surfaces ───────────────────────────
  test("SECURITY.md naming a DIFFERENT address than the chassis FAILS", () => {
    const r = run(repo({ securityEmail: 'suport@example.test' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SECURITY\.md names "suport@example\.test"/);
    // The message must say where the truth lives, or the fix goes in the wrong file.
    assert.match(r.stderr, /AppConfig\.supportEmail/);
  });

  test('SECURITY.md naming NO address at all FAILS — a process with no way to start it', () => {
    const root = repo();
    writeFileSync(join(root, 'SECURITY.md'), '# Security policy\n\nPlease report responsibly.\n');
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /names no email address at all/);
  });

  test('a missing SECURITY.md FAILS', () => {
    const r = run(repo({ security: false }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SECURITY\.md is missing/);
  });

  test('a contact page that no longer publishes the address FAILS', () => {
    const r = run(repo({ contactEmail: 'hello@example.test' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /contact\.html does not show "support@example\.test"/);
  });

  test('an address hidden inside a <style> block does NOT count as published', () => {
    // visibleText, not a raw substring search: an address that only survives in
    // inert markup is an address no visitor can read.
    const root = repo({ contactEmail: 'hello@example.test' });
    writeFileSync(
      join(root, 'sites', 'nikatru', 'contact.html'),
      `<html><head><style>/* ${ADDR} */</style></head><body><p>hello@example.test</p></body></html>\n`,
    );
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not show "support@example\.test" in its visible text/);
  });

  test('an app that declares NO supportEmail FAILS — the chassis has one and it does not', () => {
    const r = run(repo({ appEmails: [null] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares no supportEmail/);
  });

  test('an app compiling in a DIFFERENT address FAILS', () => {
    const r = run(repo({ appEmails: [ADDR, 'legacy@example.test'] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /compiles in "legacy@example\.test"/);
    assert.match(r.stderr, /one mailbox nobody reads/);
  });

  // ── LIMB 2 · the posture tokens (the weakest limb, and it says so) ─────────
  test('NOTICE.md losing "not open-source" FAILS', () => {
    const r = run(repo({ notice: 'This repository is source-visible.' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no longer says "not open-source"/);
    // The guard must admit this limb's weakness where the failure is read.
    assert.match(r.stderr, /weakest check in this guard/);
  });

  test('NOTICE.md losing "source-visible" FAILS', () => {
    const r = run(repo({ notice: 'This repository is not open-source.' }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no longer says "source-visible"/);
  });

  test('a missing NOTICE.md FAILS', () => {
    const r = run(repo({ noticeFile: false }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /NOTICE\.md is missing/);
  });

  // ── LIMB 3 · the irreversible one ─────────────────────────────────────────
  test('a LICENSE file at the root FAILS, and the message says why it cannot be undone', () => {
    const r = run(repo({ rootFiles: { LICENSE: 'MIT License\n' } }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /LICENSE exists at the repository root/);
    assert.match(r.stderr, /no undo/);
  });

  test('a grant under ANY of its usual names FAILS, not just LICENSE', () => {
    // GitHub detects LICENSE, LICENCE, LICENSE.md, COPYING and friends alike, so
    // a check that only knew one spelling would let the badge appear anyway.
    for (const name of ['LICENCE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'copying.lesser']) {
      const r = run(repo({ rootFiles: { [name]: 'GNU GENERAL PUBLIC LICENSE\n' } }));
      assert.equal(r.status, 1, `${name} was not caught`);
      assert.match(r.stderr, new RegExp(`${name.replace('.', '\\.')} exists at the repository root`, 'i'));
    }
  });

  test('a DIRECTORY named licenses at the root is not a grant and passes', () => {
    // Otherwise the guard cries wolf on a perfectly ordinary folder, and a guard
    // that cries wolf is one somebody switches off.
    const root = repo();
    mkdirSync(join(root, 'LICENSES'), { recursive: true });
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
  });

  test('an unrelated root file passes — the list is grants, not everything', () => {
    const r = run(repo({ rootFiles: { 'README.md': '# hi\n', 'CONTRIBUTING.md': 'no\n' } }));
    assert.equal(r.status, 0, r.stderr);
  });

  // ── COVERAGE — a scan that stopped reaching must say so, not report clean ──
  test('COVERAGE: a missing brick app_config is COVERAGE LOST, not a pass', () => {
    const r = run(repo({ brickConfig: false }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — cannot read/);
    assert.match(r.stderr, /where the support address is DECIDED/);
  });

  test('COVERAGE: a brick app_config with no supportEmail is COVERAGE LOST', () => {
    const root = repo();
    writeFileSync(
      join(root, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib', 'core', 'app_config.dart'),
      'class AppConfig {\n  static const String appId = "x";\n}\n',
    );
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares no AppConfig\.supportEmail/);
  });

  test('COVERAGE: zero app configs is COVERAGE LOST — an empty domain is vacuously true', () => {
    const r = run(repo({ appEmails: [] }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — no apps/);
    assert.match(r.stderr, /ranged over nothing/);
  });

  test('COVERAGE: a missing contact page is COVERAGE LOST, not a silent skip', () => {
    const r = run(repo({ contactPage: false }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — cannot read sites\/nikatru\/contact\.html/);
  });
});
