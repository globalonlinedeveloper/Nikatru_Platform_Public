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

// The served-copy premise: sites/nikatru/_headers sends noindex for the bodies.
const GOOD_HEADERS = `/*
  X-Content-Type-Options: nosniff

# auth mail bodies — fragments, never pages
/auth-mail/*
  X-Robots-Tag: noindex
`;

const GOOD_SUBJECTS = {
  confirmation: 'Confirm your email — Nikatru',
  magic_link: 'Your sign-in link — Nikatru',
  recovery: 'Reset your password — Nikatru',
};
const transportWith = (subjects) =>
  `${JSON.stringify({ supabaseAuth: { smtp_host: 'smtp.example.com', ...(subjects === undefined ? {} : { subjects }) } }, null, 2)}\n`;

/**
 * `served`: the files under sites/nikatru/auth-mail/ — defaults to a BYTE copy of
 * `files` (what gen-auth-mail.mjs writes); `null` writes no served directory.
 * `headers` / `transport`: the _headers text and the mail-transport.json text;
 * `null` writes no file.
 */
function makeRoot({ files, readme, served, headers, transport } = {}) {
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
  if (served !== null) {
    const sdir = join(root, 'sites', 'nikatru', 'auth-mail');
    mkdirSync(sdir, { recursive: true });
    for (const [f, body] of Object.entries(served ?? set)) writeFileSync(join(sdir, f), body);
  }
  if (headers !== null) {
    mkdirSync(join(root, 'sites', 'nikatru'), { recursive: true });
    writeFileSync(join(root, 'sites', 'nikatru', '_headers'), headers ?? GOOD_HEADERS);
  }
  if (transport !== null) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'mail-transport.json'), transport ?? transportWith(GOOD_SUBJECTS));
  }
  return root;
}

// The three DR sources as makeRoot writes them by default — the served-copy
// tests start from these so exactly one byte differs.
const DEFAULT_SET = () => ({
  'confirm-signup.html': GOOD('Confirm your email'),
  'magic-link.html': GOOD('Your sign-in link'),
  'reset-password.html': GOOD('Reset your password'),
});

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
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the directory exists but holds no .html at all', () => {
    const r = run(makeRoot({ files: {} }));
    assert.equal(r.status, 2, out(r));
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

// ── The served copies self-hosted GoTrue fetches (sites/nikatru/auth-mail/) ──
describe('assert-supabase-templates — the served copy is the source, byte for byte', () => {
  test('the happy path says 3/3 served copies are byte-equal', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /served copies 3\/3 byte-equal/);
  });

  test('FAILS when one served copy differs by a single word', () => {
    const served = DEFAULT_SET();
    served['magic-link.html'] = served['magic-link.html'].replace('Continue', 'Continu3');
    assert.notEqual(served['magic-link.html'], DEFAULT_SET()['magic-link.html'], 'the mutation must change bytes');
    const r = run(makeRoot({ served }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /SERVED DRIFT: sites\/nikatru\/auth-mail\/magic-link\.html differs/);
  });

  test('FAILS on a CRLF-only difference — equal text is not equal bytes', () => {
    const served = DEFAULT_SET();
    served['reset-password.html'] = served['reset-password.html'].replace(/\n/g, '\r\n');
    assert.notEqual(served['reset-password.html'], DEFAULT_SET()['reset-password.html'], 'the mutation must change bytes');
    const r = run(makeRoot({ served }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /reset-password\.html differs from its source/);
  });

  test('FAILS when a served copy is missing', () => {
    const served = DEFAULT_SET();
    delete served['confirm-signup.html'];
    const r = run(makeRoot({ served }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /auth-mail\/confirm-signup\.html is missing/);
  });

  test('FAILS when the served directory does not exist at all', () => {
    const r = run(makeRoot({ served: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /SERVED DRIFT/);
    assert.doesNotMatch(out(r), /assert-supabase-templates: OK/);
  });

  test('FAILS on a stray served .html that no source produces', () => {
    const served = { ...DEFAULT_SET(), 'invite.html': GOOD('Invite') };
    const r = run(makeRoot({ served }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /auth-mail\/invite\.html is served but no source template produces it/);
  });

  test('FAILS when _headers stops sending noindex for /auth-mail/*', () => {
    const r = run(makeRoot({ headers: '/*\n  X-Content-Type-Options: nosniff\n' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no `\/auth-mail\/\*` block with `X-Robots-Tag: noindex`/);
  });

  test('a noindex under a DIFFERENT path does not count for /auth-mail/*', () => {
    const r = run(makeRoot({ headers: '/auth-mail/*\n  Cache-Control: no-store\n/other/*\n  X-Robots-Tag: noindex\n' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /X-Robots-Tag: noindex/);
  });

  test('FAILS when _headers is missing entirely', () => {
    const r = run(makeRoot({ headers: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /_headers missing/);
  });
});

describe('assert-supabase-templates — the subjects record has exactly the three keys', () => {
  test('the happy path says 3/3 subjects', () => {
    const r = run(makeRoot());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /subjects 3\/3 present and non-empty/);
  });

  test('FAILS when supabaseAuth.subjects is absent', () => {
    const r = run(makeRoot({ transport: transportWith(undefined) }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /no supabaseAuth\.subjects object/);
  });

  test('FAILS when one subject key is missing', () => {
    const { recovery, ...two } = GOOD_SUBJECTS;
    assert.ok(recovery);
    const r = run(makeRoot({ transport: transportWith(two) }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /subjects is missing recovery/);
  });

  test('FAILS on an extra subject key no template sends', () => {
    const r = run(makeRoot({ transport: transportWith({ ...GOOD_SUBJECTS, invite: 'You are invited' }) }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /unknown key\(s\) invite/);
  });

  test('FAILS on an empty (whitespace) subject — GoTrue would fall back to its default', () => {
    const r = run(makeRoot({ transport: transportWith({ ...GOOD_SUBJECTS, magic_link: '   ' }) }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /empty or non-string value for magic_link/);
  });

  test('FAILS on a non-string subject', () => {
    const r = run(makeRoot({ transport: transportWith({ ...GOOD_SUBJECTS, confirmation: 42 }) }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /non-string value for confirmation/);
  });

  test('FAILS when mail-transport.json does not parse', () => {
    const r = run(makeRoot({ transport: '{ "supabaseAuth": ' }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /does not parse/);
  });

  test('COVERAGE LOST (exit 2, never a pass) when mail-transport.json does not exist', () => {
    const r = run(makeRoot({ transport: null }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST: tooling\/mail-transport\.json does not exist/);
    assert.doesNotMatch(out(r), /assert-supabase-templates: OK/);
  });

  test('a FINDING outranks a could-not-look: missing transport + served drift exits 1', () => {
    const served = DEFAULT_SET();
    served['magic-link.html'] += ' ';
    const r = run(makeRoot({ served, transport: null }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /SERVED DRIFT/);
    assert.match(out(r), /COVERAGE LOST: tooling\/mail-transport\.json/);
  });
});
