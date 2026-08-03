// ─────────────────────────────────────────────────────────────────────────────
// supabase-templates.test.mjs — assert-supabase-templates.mjs must be able to FAIL.
//
// RECORDED MUTATION RUN, against a scratch COPY of the REAL tree: **11/11 caught**,
// baseline PASS on the unmutated copy, restored from in-memory originals and
// byte-compared, final run PASS.
//
// 🔬 THAT RUN FOUND THREE BUGS — one in the guard, two in the mutation harness,
// and all three are the same shape: something that looked like a result but was
// not one.
//   1. GUARD BUG, caught on the very first baseline run: the README documents the
//      field family as the GLOB `mailer_templates_*_content`, and the guard
//      demanded `\w+`, which rejects a literal asterisk. So the guard FAILED on
//      the correct real tree. A guard that fires on correct input is worse than
//      no guard — the next person to hit it deletes it.
//   2+3. HARNESS BUGS: two mutations were NO-OPS and therefore reported
//      "NOT CAUGHT" for changes that never happened. `.replace('</body>', …)`
//      does nothing because these templates are FRAGMENTS with no </body>, and
//      `mailer_templates_\w+_content` does not match the glob in the README.
//      **A no-op mutation is not a weak guard; it is a broken test.** Both
//      mutations now assert they actually changed bytes before running the guard.
//
// ⚠️ A FIXTURE AGREES WITH WHATEVER MISUNDERSTANDING WROTE IT. These are the
// regression net; the mutation run against the real tree is the proof.
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
const GUARD = join(CI_DIR, 'assert-supabase-templates.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-sbtmpl-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// A template body that satisfies every structural rule, so each test can break
// exactly one thing and attribute the failure.
const GOOD = (name) => `<div>
  <h1>${name} — Nikatru</h1>
  <p>Hello {{ .Email }},</p>
  <a href="{{ .ConfirmationURL }}">Continue</a>
  <p><a href="{{ .SiteURL }}">Nikatru</a></p>
</div>`;

const GOOD_README = `# Supabase platform
Config is applied via the Management API: \`PATCH /v1/projects/{ref}/config/auth\`.
Fields used: \`mailer_subjects_*\`, \`mailer_templates_*_content\`, \`smtp_*\`.
`;

function makeRoot({ files, readme } = {}) {
  const root = join(TMP, `r${seq++}`);
  const dir = join(root, 'docs', 'platform', 'supabase', 'email-templates');
  mkdirSync(dir, { recursive: true });
  const set = files ?? {
    'confirm-signup.html': GOOD('Confirm your email'),
    'magic-link.html': GOOD('Your sign-in link'),
    'reset-password.html': GOOD('Reset your password'),
  };
  for (const [f, body] of Object.entries(set)) writeFileSync(join(dir, f), body);
  if (readme !== null) writeFileSync(join(root, 'docs', 'platform', 'supabase', 'README.md'), readme ?? GOOD_README);
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-supabase-templates — the happy path really passes', () => {
  test('a complete DR set with a documenting README passes', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /checked 3\/3/);
  });

  test('it says out loud that DRIFT is NOT checked — green must not be mistaken for safe', () => {
    const r = run(makeRoot());
    assert.match(out(r), /DRIFT vs live Supabase is NOT checked/);
  });
});

describe('assert-supabase-templates — each required file is load-bearing', () => {
  for (const missing of ['confirm-signup.html', 'magic-link.html', 'reset-password.html']) {
    test(`FAILS when ${missing} is deleted`, () => {
      const files = {
        'confirm-signup.html': GOOD('Confirm'),
        'magic-link.html': GOOD('Magic'),
        'reset-password.html': GOOD('Reset'),
      };
      delete files[missing];
      const r = run(makeRoot({ files }));
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), new RegExp(`MISSING: ${missing.replace('.', '\\.')}`));
    });
  }

  test('the failure names the live field the file restores, not just the filename', () => {
    const files = { 'confirm-signup.html': GOOD('C'), 'magic-link.html': GOOD('M') };
    const r = run(makeRoot({ files }));
    assert.match(out(r), /mailer_templates_recovery_content/);
  });
});

describe('assert-supabase-templates — structure, not size', () => {
  test('FAILS when {{ .ConfirmationURL }} is gone — the mail would be unactionable', () => {
    const files = {
      'confirm-signup.html': GOOD('C'),
      'magic-link.html': GOOD('M'),
      'reset-password.html': '<div><h1>Reset — Nikatru</h1><a href="https://example.com">Go</a></div>',
    };
    const r = run(makeRoot({ files }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /nothing to click/);
  });

  test('FAILS when the Nikatru branding is gone — a default template is not a restore', () => {
    const files = {
      'confirm-signup.html': '<div><a href="{{ .ConfirmationURL }}">Go</a></div>',
      'magic-link.html': GOOD('M'),
      'reset-password.html': GOOD('R'),
    };
    const r = run(makeRoot({ files }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no "Nikatru" branding/);
  });

  test('FAILS on a remote image src — client safety and no tracking-pixel surface', () => {
    const files = {
      'confirm-signup.html': GOOD('C'),
      'magic-link.html': GOOD('M') + '\n<img src="https://tracker.example.com/p.gif">',
      'reset-password.html': GOOD('R'),
    };
    const r = run(makeRoot({ files }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /remote image src/);
  });

  test('a LOCAL or data: image is allowed — the rule is about remote fetches', () => {
    const files = {
      'confirm-signup.html': GOOD('C') + '\n<img src="data:image/gif;base64,R0lGOD">',
      'magic-link.html': GOOD('M'),
      'reset-password.html': GOOD('R'),
    };
    const r = run(makeRoot({ files }));
    assert.equal(r.status, 0, out(r));
  });

  test('a LONG file with no ConfirmationURL still FAILS — size is not the test', () => {
    const files = {
      'confirm-signup.html': GOOD('C'),
      'magic-link.html': GOOD('M'),
      'reset-password.html': `<div><h1>Nikatru</h1>${'<p>padding</p>'.repeat(400)}</div>`,
    };
    const r = run(makeRoot({ files }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /nothing to click/);
  });
});

describe('assert-supabase-templates — coverage self-checks', () => {
  test('COVERAGE LOST when the templates directory does not exist', () => {
    const root = join(TMP, `r${seq++}`);
    mkdirSync(join(root, 'docs', 'platform', 'supabase'), { recursive: true });
    writeFileSync(join(root, 'docs', 'platform', 'supabase', 'README.md'), GOOD_README);
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the directory exists but holds no .html at all', () => {
    const r = run(makeRoot({ files: {} }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /COVERAGE LOST: no \.html templates/);
  });

  test('an empty directory is never reported as a pass', () => {
    const r = run(makeRoot({ files: {} }));
    assert.doesNotMatch(out(r), /assert-supabase-templates: OK/);
  });
});

describe('assert-supabase-templates — the restore procedure must stay findable', () => {
  test('FAILS when the README is missing entirely', () => {
    const r = run(makeRoot({ readme: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /README\.md missing/);
  });

  test('FAILS when the README stops naming the config/auth endpoint', () => {
    const r = run(makeRoot({ readme: 'Fields: `mailer_templates_*_content`. No endpoint named.\n' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /config\/auth/);
  });

  test('FAILS when the README stops naming the mailer_templates_* fields', () => {
    const r = run(makeRoot({ readme: 'Applied via `PATCH /v1/projects/{ref}/config/auth`.\n' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /mailer_templates_\*_content/);
  });

  test('the GLOB form is accepted — a \\w+ pattern rejected the real README and failed the baseline', () => {
    const r = run(makeRoot({ readme: 'PATCH /v1/projects/{ref}/config/auth with `mailer_templates_*_content`.\n' }));
    assert.equal(r.status, 0, out(r));
  });

  test('a CONCRETE field name is accepted too, not only the glob', () => {
    const r = run(makeRoot({ readme: 'PATCH config/auth sets mailer_templates_confirmation_content.\n' }));
    assert.equal(r.status, 0, out(r));
  });
});
