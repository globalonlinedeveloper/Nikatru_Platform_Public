// ─────────────────────────────────────────────────────────────────────────────
// gen-auth-mail.test.mjs — the served auth mail bodies are a BYTE copy of the
// DR templates, and the generator's --check can FAIL.
//
// What is pinned here, and why each matters:
//   · write mode copies bytes, not text — a CRLF source stays CRLF, because
//     self-hosted GoTrue sends whatever bytes it fetches;
//   · --check writes NOTHING (CI and the guard run it; a check that repairs
//     would hide the drift it exists to report);
//   · a missing source is COVERAGE LOST (exit 2), never a pass or a finding;
//   · a stray served .html is named and NOT deleted;
//   · the three served URLs are exactly the ones the self-hosted env holds.
//
// No test is declared inside a loop (assert-no-loop-cases.mjs): each case is
// written out so a failure names exactly one behaviour.
//
// Run:  node --test tooling/ci/test/gen-auth-mail.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AUTH_MAIL_PREFIX,
  AUTH_MAIL_SERVED_DIR,
  AUTH_MAIL_SOURCE_DIR,
  AUTH_MAIL_TEMPLATES,
  genAuthMail,
  isAuthMailPath,
} from '../../sites/gen-auth-mail.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GEN = join(REPO, 'tooling', 'sites', 'gen-auth-mail.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-authmail-')); });
after(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const BODY = {
  'confirm-signup.html': '<div>\n  <h1>Confirm — Nikatru</h1>\n  <a href="{{ .ConfirmationURL }}">Go</a>\n</div>\n',
  'magic-link.html': '<div>\n  <h1>Sign in — Nikatru</h1>\n  <a href="{{ .ConfirmationURL }}">Go</a>\n</div>\n',
  'reset-password.html': '<div>\n  <h1>Reset — Nikatru</h1>\n  <a href="{{ .ConfirmationURL }}">Go</a>\n</div>\n',
};

/** A scratch repo with the given sources (default: all three) and served files. */
function makeRoot({ sources = BODY, served } = {}) {
  const root = join(TMP, `r${seq++}`);
  const src = join(root, ...AUTH_MAIL_SOURCE_DIR.split('/'));
  mkdirSync(src, { recursive: true });
  for (const [f, b] of Object.entries(sources)) writeFileSync(join(src, f), b);
  if (served) {
    const out = join(root, ...AUTH_MAIL_SERVED_DIR.split('/'));
    mkdirSync(out, { recursive: true });
    for (const [f, b] of Object.entries(served)) writeFileSync(join(out, f), b);
  }
  return root;
}
const servedPath = (root, f) => join(root, ...AUTH_MAIL_SERVED_DIR.split('/'), f);
const cli = (args) => spawnSync(process.execPath, [GEN, ...args], { encoding: 'utf8' });

describe('gen-auth-mail — the list of templates', () => {
  test('the three served URLs are exactly the ones the self-hosted GoTrue env names', () => {
    assert.deepEqual(
      AUTH_MAIL_TEMPLATES.map((t) => [t.gotrueEnv, t.url]),
      [
        ['GOTRUE_MAILER_TEMPLATES_CONFIRMATION', 'https://nikatru.com/auth-mail/confirm-signup.html'],
        ['GOTRUE_MAILER_TEMPLATES_MAGIC_LINK', 'https://nikatru.com/auth-mail/magic-link.html'],
        ['GOTRUE_MAILER_TEMPLATES_RECOVERY', 'https://nikatru.com/auth-mail/reset-password.html'],
      ],
    );
  });

  test('each template maps to its hosted field and its subject key', () => {
    assert.deepEqual(
      AUTH_MAIL_TEMPLATES.map((t) => [t.file, t.hostedField, t.subjectKey]),
      [
        ['confirm-signup.html', 'mailer_templates_confirmation_content', 'confirmation'],
        ['magic-link.html', 'mailer_templates_magic_link_content', 'magic_link'],
        ['reset-password.html', 'mailer_templates_recovery_content', 'recovery'],
      ],
    );
  });

  test('the list cannot be mutated by a caller', () => {
    assert.ok(Object.isFrozen(AUTH_MAIL_TEMPLATES));
    assert.ok(Object.isFrozen(AUTH_MAIL_TEMPLATES[0]));
  });

  test('isAuthMailPath matches the served directory and nothing that merely starts like it', () => {
    assert.equal(AUTH_MAIL_PREFIX, 'sites/nikatru/auth-mail/');
    assert.equal(isAuthMailPath('sites/nikatru/auth-mail/magic-link.html'), true);
    assert.equal(isAuthMailPath('sites/nikatru/auth-mail-old/magic-link.html'), false);
    assert.equal(isAuthMailPath('sites/nikatru/index.html'), false);
    assert.equal(isAuthMailPath('docs/platform/supabase/email-templates/magic-link.html'), false);
  });
});

describe('gen-auth-mail — write mode copies BYTES', () => {
  test('writes all three served copies equal to their sources', () => {
    const root = makeRoot();
    const r = genAuthMail(root);
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(readFileSync(servedPath(root, 'confirm-signup.html')), Buffer.from(BODY['confirm-signup.html']));
    assert.deepEqual(readFileSync(servedPath(root, 'magic-link.html')), Buffer.from(BODY['magic-link.html']));
    assert.deepEqual(readFileSync(servedPath(root, 'reset-password.html')), Buffer.from(BODY['reset-password.html']));
    assert.match(r.lines.at(-1), /3 written, 0 already equal/);
  });

  test('a CRLF source is served as CRLF — no newline normalisation', () => {
    const crlf = BODY['magic-link.html'].replace(/\n/g, '\r\n');
    const root = makeRoot({ sources: { ...BODY, 'magic-link.html': crlf } });
    assert.equal(genAuthMail(root).code, 0);
    const got = readFileSync(servedPath(root, 'magic-link.html'));
    assert.deepEqual(got, Buffer.from(crlf));
    assert.ok(got.includes(0x0d), 'the CR bytes must survive the copy');
  });

  test('a second run writes nothing and reports all three already equal', () => {
    const root = makeRoot();
    genAuthMail(root);
    const r = genAuthMail(root);
    assert.equal(r.code, 0);
    assert.match(r.lines.at(-1), /0 written, 3 already equal/);
  });

  test('write mode repairs a drifted served copy', () => {
    const root = makeRoot({ served: { ...BODY, 'reset-password.html': 'stale' } });
    assert.equal(genAuthMail(root).code, 0);
    assert.equal(readFileSync(servedPath(root, 'reset-password.html'), 'utf8'), BODY['reset-password.html']);
  });
});

describe('gen-auth-mail — --check can FAIL and never writes', () => {
  test('--check passes when every served copy equals its source', () => {
    const r = genAuthMail(makeRoot({ served: BODY }), { check: true });
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.match(r.lines.at(-1), /3\/3 served copies equal their sources byte for byte/);
  });

  test('--check FAILS (1) on a missing served copy and writes nothing', () => {
    const root = makeRoot();
    const r = genAuthMail(root, { check: true });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /auth-mail\/confirm-signup\.html is missing/);
    assert.equal(existsSync(servedPath(root, 'confirm-signup.html')), false, '--check must not write');
  });

  test('--check FAILS (1) on a one-byte difference and leaves the served file as it was', () => {
    const drifted = `${BODY['magic-link.html']} `;
    const root = makeRoot({ served: { ...BODY, 'magic-link.html': drifted } });
    const r = genAuthMail(root, { check: true });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /magic-link\.html differs from its source/);
    assert.equal(readFileSync(servedPath(root, 'magic-link.html'), 'utf8'), drifted);
  });

  test('--check FAILS (1) on a CRLF-only difference', () => {
    const root = makeRoot({ served: { ...BODY, 'reset-password.html': BODY['reset-password.html'].replace(/\n/g, '\r\n') } });
    const r = genAuthMail(root, { check: true });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /reset-password\.html differs/);
  });

  test('a stray served .html FAILS (1) in both modes and is never deleted', () => {
    const root = makeRoot({ served: { ...BODY, 'invite.html': '<p>x</p>' } });
    const c = genAuthMail(root, { check: true });
    assert.equal(c.code, 1);
    assert.match(c.lines.join('\n'), /invite\.html is served but no source template produces it/);
    const w = genAuthMail(root);
    assert.equal(w.code, 1);
    assert.equal(existsSync(servedPath(root, 'invite.html')), true, 'a stray is named, never deleted');
  });
});

describe('gen-auth-mail — a missing source is COVERAGE LOST', () => {
  test('exit 2 when a source template is missing, and nothing is written', () => {
    const { 'reset-password.html': gone, ...two } = BODY;
    assert.ok(gone);
    const root = makeRoot({ sources: two });
    const r = genAuthMail(root);
    assert.equal(r.code, 2);
    assert.match(r.lines[0], /COVERAGE LOST — source template\(s\) missing .*reset-password\.html/);
    assert.equal(existsSync(servedPath(root, 'confirm-signup.html')), false);
  });

  test('exit 2 when the source directory holds nothing', () => {
    const r = genAuthMail(makeRoot({ sources: {} }), { check: true });
    assert.equal(r.code, 2);
  });
});

describe('gen-auth-mail — the CLI carries the exit codes', () => {
  test('CLI --check exits 1 on drift and names it on stderr', () => {
    const r = cli([makeRoot(), '--check']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /gen-auth-mail: DRIFT/);
  });

  test('CLI write then --check exits 0', () => {
    const root = makeRoot();
    assert.equal(cli([root]).status, 0);
    const r = cli([root, '--check']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /gen-auth-mail: OK/);
  });

  test('CLI exits 2 on a missing source', () => {
    const r = cli([makeRoot({ sources: {} })]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COVERAGE LOST/);
  });
});
