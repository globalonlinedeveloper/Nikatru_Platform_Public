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
// ⏱ 2026-09-24 — THE ONE-APP LIMB (O-MAIL-TEMPLATES-NAME-ONE-APP). The guard now
// refuses every catalog/apps.json name in a template or a recorded subject
// (`supabaseAuth.subjects`). Day-zero red on the real tree, before the copy fix: exit 1
// at exactly six sites (confirm-signup.html:8 and :14, magic-link.html:8, :14 and
// :20, reset-password.html:8), measured again on 2026-09-25 at main 1cb7c630.
// X1 below mutates a COPY of the real tree and restores it; the guard as it stood
// before the limb exits 0 on X1's mutated copy, so the limb is what makes it red.
// Every fixture root now carries a catalog by default too, because the limb reads it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-supabase-templates.mjs');
const REPO = resolve(CI_DIR, '..', '..');

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

// What the one-app limb reads besides the templates and the subjects above:
// catalog/apps.json, a top-level array of apps with a `name`.
const APP = 'Nikatru Subscription Tracker';
const GOOD_CATALOG = `${JSON.stringify([{ slug: 'subscriptiontracker', name: APP }], null, 2)}\n`;

/**
 * `served`: the files under sites/nikatru/auth-mail/ — defaults to a BYTE copy of
 * `files` (what gen-auth-mail.mjs writes); `null` writes no served directory.
 * `headers` / `transport` / `catalog`: the _headers text, the mail-transport.json
 * text and the catalog/apps.json text; `null` writes no file.
 */
function makeRoot({ files, readme, served, headers, transport, catalog } = {}) {
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
  if (catalog !== null) {
    mkdirSync(join(root, 'catalog'), { recursive: true });
    writeFileSync(join(root, 'catalog', 'apps.json'), catalog ?? GOOD_CATALOG);
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

/** A scratch root holding byte copies of the REAL files the guard reads: the DR
 *  templates, their served copies and `_headers`, the README, the catalog and the register. */
function copyOfRealTree() {
  const root = join(TMP, `real${seq++}`);
  const rels = [
    'docs/platform/supabase/email-templates/confirm-signup.html',
    'docs/platform/supabase/email-templates/magic-link.html',
    'docs/platform/supabase/email-templates/reset-password.html',
    'docs/platform/supabase/README.md',
    'sites/nikatru/auth-mail/confirm-signup.html',
    'sites/nikatru/auth-mail/magic-link.html',
    'sites/nikatru/auth-mail/reset-password.html',
    'sites/nikatru/_headers',
    'catalog/apps.json',
    'tooling/mail-transport.json',
  ];
  for (const rel of rels) {
    const to = join(root, ...rel.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(join(REPO, ...rel.split('/'))));
  }
  return root;
}

/** The same body in all three templates. */
const allThree = (body) => ({
  'confirm-signup.html': body,
  'magic-link.html': body,
  'reset-password.html': body,
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

describe('assert-supabase-templates — the shared mail names the house, never one app (O-MAIL-TEMPLATES-NAME-ONE-APP)', () => {
  test('X1 — "Subscription Tracker" re-inserted at confirm-signup.html:8 of a copy of the REAL tree: exit 1; restored: exit 0', () => {
    const root = copyOfRealTree();
    const target = join(root, 'docs', 'platform', 'supabase', 'email-templates', 'confirm-signup.html');
    const servedCopy = join(root, 'sites', 'nikatru', 'auth-mail', 'confirm-signup.html');
    const original = readFileSync(target, 'utf8');
    const control = run(root);
    assert.equal(control.status, 0, `green control first — the unmutated copy must pass:\n${out(control)}`);

    const lines = original.split('\n');
    const mutated = lines[7].replace('>Nikatru</span>', '>Nikatru Subscription Tracker</span>');
    assert.notEqual(mutated, lines[7], 'the mutation changed no bytes: a no-op mutation is a broken test');
    lines[7] = mutated;
    // The served copy gets the same bytes, as gen-auth-mail.mjs would write them, so the
    // one-app limb is the only thing left to turn the run red.
    writeFileSync(target, lines.join('\n'));
    writeFileSync(servedCopy, lines.join('\n'));
    const red = run(root);
    assert.equal(red.status, 1, out(red));
    assert.match(out(red), /confirm-signup\.html:8 — "Nikatru Subscription Tracker" — the shared templates name the house, not one app \(O-MAIL-TEMPLATES-NAME-ONE-APP\)/);
    assert.doesNotMatch(out(red), /SERVED DRIFT/);

    writeFileSync(target, original);
    writeFileSync(servedCopy, original);
    assert.equal(readFileSync(target, 'utf8'), original);
    const restored = run(root);
    assert.equal(restored.status, 0, out(restored));
  });

  test('X2 — "Nikatru" alone passes: the house name is not an app name, though the app name starts with it', () => {
    const body = `<div>
  <span>Nikatru</span><span>by Nikatru</span>
  <p>Tap the button below to sign in to Nikatru as {{ .Email }}.</p>
  <a href="{{ .ConfirmationURL }}">Sign in to Nikatru</a>
</div>`;
    const r = run(makeRoot({ files: allThree(body) }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 catalog\/apps\.json name\(s\) refused in 3 template\(s\)/);
  });

  test('X3 — an EMPTY catalog is COVERAGE LOST (exit 2), never a pass', () => {
    const r = run(makeRoot({ catalog: '[]\n' }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST: catalog\/apps\.json lists no app/);
    assert.doesNotMatch(out(r), /assert-supabase-templates: OK/);
  });

  test('X3b — a MISSING catalog is COVERAGE LOST (exit 2)', () => {
    const r = run(makeRoot({ catalog: null }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST: catalog\/apps\.json does not exist/);
  });

  test('X3c — a catalog entry with no name is COVERAGE LOST (exit 2): that app could not be refused', () => {
    const r = run(makeRoot({ catalog: JSON.stringify([{ name: APP }, { slug: 'second' }]) }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST: catalog\/apps\.json entry 1 has no `name`/);
  });

  test('X4 — a recorded supabaseAuth.subjects.confirmation naming the app: exit 1, at its line in the register', () => {
    const transport = transportWith({ ...GOOD_SUBJECTS, confirmation: 'Confirm your Subscription Tracker account' });
    const r = run(makeRoot({ transport }));
    assert.equal(r.status, 1, out(r));
    // transportWith writes `"subjects": {` at line 4; "confirmation" is its first key, line 5.
    assert.match(out(r), /tooling\/mail-transport\.json:5 — "Nikatru Subscription Tracker" — the shared templates name the house, not one app/);
  });

  test('X4b — control for X4: a subject naming only the house passes, and all three are counted as read', () => {
    const transport = transportWith({ ...GOOD_SUBJECTS, confirmation: 'Confirm your Nikatru account' });
    const r = run(makeRoot({ transport }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /in 3 recorded subject\(s\) \(`supabaseAuth\.subjects`\)/);
  });

  test('X5 — a MISSING register is COVERAGE LOST (exit 2): no recorded subject could be read', () => {
    const r = run(makeRoot({ transport: null }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST: tooling\/mail-transport\.json does not exist/);
    assert.match(out(r), /tooling\/mail-transport\.json does not exist, so the one-app limb checked no recorded subject/);
  });

  test('X5b — no supabaseAuth.subjects object, or one holding no string: the limb says COVERAGE LOST, and the subjects finding keeps the exit at 1', () => {
    const none = run(makeRoot({ transport: '{ "rails": [] }\n' }));
    assert.equal(none.status, 1, out(none));
    assert.match(out(none), /COVERAGE LOST: tooling\/mail-transport\.json has no `supabaseAuth\.subjects` object, so the one-app limb checked no recorded subject/);
    const noString = run(makeRoot({ transport: transportWith({ confirmation: 1, magic_link: null, recovery: false }) }));
    assert.equal(noString.status, 1, out(noString));
    assert.match(out(noString), /COVERAGE LOST: tooling\/mail-transport\.json `supabaseAuth\.subjects` holds no string value, so the one-app limb checked no recorded subject/);
  });

  test('X6 — the names are READ from the catalog: a second app added there is refused in a template', () => {
    const catalog = JSON.stringify([{ name: APP }, { name: 'Nikatru Habit Garden' }]);
    const files = {
      'confirm-signup.html': GOOD('Welcome to Habit Garden'),
      'magic-link.html': GOOD('M'),
      'reset-password.html': GOOD('R'),
    };
    const r = run(makeRoot({ files, catalog }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /confirm-signup\.html:2 — "Nikatru Habit Garden"/);
  });

  test('X7 — case does not hide a name: "the subscription tracker by Nikatru" is refused', () => {
    const files = {
      'confirm-signup.html': GOOD('Welcome, from the subscription tracker by Nikatru'),
      'magic-link.html': GOOD('M'),
      'reset-password.html': GOOD('R'),
    };
    const r = run(makeRoot({ files }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /confirm-signup\.html:2 — "Nikatru Subscription Tracker"/);
  });

  test('X8 — a name split across a line break or by &nbsp; is refused, at the line where it starts', () => {
    const files = {
      'confirm-signup.html': GOOD('C'),
      'magic-link.html': `${GOOD('M')}\n<p>Sign in to Nikatru Subscription\n  Tracker</p>`,
      'reset-password.html': `${GOOD('R')}\n<p>Subscription&nbsp;Tracker</p>`,
    };
    const r = run(makeRoot({ files }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /magic-link\.html:7 — "Nikatru Subscription Tracker"/);
    assert.match(out(r), /reset-password\.html:7 — "Nikatru Subscription Tracker"/);
  });

  test('X9 — a name inside a longer word is not that name: "Notes" is refused, "footnotes" is not', () => {
    const catalog = JSON.stringify([{ name: 'Nikatru Notes' }]);
    const inWord = run(makeRoot({ catalog, files: allThree(`${GOOD('C')}\n<p>See the footnotes.</p>`) }));
    assert.equal(inWord.status, 0, out(inWord));
    const alone = run(makeRoot({ catalog, files: allThree(`${GOOD('C')}\n<p>Open Notes.</p>`) }));
    assert.equal(alone.status, 1, out(alone));
    assert.match(out(alone), /confirm-signup\.html:7 — "Nikatru Notes"/);
  });
});
