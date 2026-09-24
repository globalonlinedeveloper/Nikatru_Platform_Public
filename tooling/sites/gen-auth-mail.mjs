#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gen-auth-mail.mjs — the auth mail templates, SERVED from the apex so a
// self-hosted GoTrue can fetch them.
//
//     docs/platform/supabase/email-templates/<name>.html
//         ──(this script, a BYTE copy)──▶  sites/nikatru/auth-mail/<name>.html
//
// ── WHY A SERVED COPY EXISTS AT ALL ──────────────────────────────────────────
// Hosted Supabase stores a template's body in its config (`mailer_templates_*_
// content`, set through the Management API). Self-hosted GoTrue has no such
// field: it takes a URL per template (`GOTRUE_MAILER_TEMPLATES_CONFIRMATION`,
// `_RECOVERY`, `_MAGIC_LINK`) and FETCHES the body from it. So the self-hosted
// auth server needs the same bytes at a public address, and the apex site is the
// only static host this portfolio already deploys on every push. The three URLs
// are fixed by the cutover plan and exported below as `AUTH_MAIL_TEMPLATES`, so
// the verifier and the switch preflight read ONE list instead of re-typing it.
//
// ── WHY A BYTE COPY AND NOT A RENDER ─────────────────────────────────────────
// The source is the disaster-recovery copy that `assert-supabase-templates.mjs`
// keeps restorable and that `verify-supabase-templates.mjs` compares with the
// hosted project. If the served copy were REFORMATTED (a newline normalised, a
// comment stripped), the hosted and the self-hosted server would send different
// mail from "the same" template and no comparison would say which one is right.
// Bytes in, bytes out: the served file is a function of the source file alone.
// `assert-supabase-templates.mjs` holds the equality on every push.
//
// ── WHY THESE PAGES ARE NOT PAGES ────────────────────────────────────────────
// They are mail-body FRAGMENTS carrying `{{ .ConfirmationURL }}` placeholders:
// no <html>, no <head>, no canonical, no chrome. They must never be indexed,
// listed in the sitemap or llms.txt, or have site chrome spliced into them
// (which would change the bytes GoTrue sends). `AUTH_MAIL_PREFIX` is the one
// path both tooling/sites/chrome.mjs and tooling/ci/check-site-integrity.mjs
// read to leave them out; `sites/nikatru/_headers` sends `X-Robots-Tag: noindex`
// for `/auth-mail/*` because the bytes cannot carry a robots meta themselves.
//
// Usage:  node tooling/sites/gen-auth-mail.mjs [repoRoot] [--check]
//         --check   compares in memory and writes NOTHING.
// Exit 0 = the served copies equal the sources (written, or already equal).
// Exit 1 = --check found drift: a served copy missing, different, or a stray
//          .html in the served directory that no source produces.
// Exit 2 = COVERAGE LOST: a source template is missing, so there is nothing to
//          copy and nothing to compare against. Never a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';

/** Repo-relative, POSIX-separated. */
export const AUTH_MAIL_SOURCE_DIR = 'docs/platform/supabase/email-templates';
export const AUTH_MAIL_SERVED_DIR = 'sites/nikatru/auth-mail';
/** The served directory as the chrome and discovery tools test a repo-relative
 *  page path against it (trailing slash, so `auth-mail-x/` is not a match). */
export const AUTH_MAIL_PREFIX = `${AUTH_MAIL_SERVED_DIR}/`;
export const AUTH_MAIL_ORIGIN = 'https://nikatru.com';

/**
 * The three templates, and everything each is known by. `source` is the tracked
 * body, written out in full so the dead-files guard reaches it from this, its real
 * consumer (a bare `file` stopped being unique once the served copies existed,
 * #921). `hostedField` is the
 * hosted Management API field (verify-supabase-templates.mjs), `gotrueEnv` the
 * self-hosted GoTrue variable that must hold `url`, and `subjectKey` the key of
 * `supabaseAuth.subjects` in tooling/mail-transport.json.
 */
export const AUTH_MAIL_TEMPLATES = Object.freeze([
  Object.freeze({
    file: 'confirm-signup.html',
    source: 'docs/platform/supabase/email-templates/confirm-signup.html',
    hostedField: 'mailer_templates_confirmation_content',
    gotrueEnv: 'GOTRUE_MAILER_TEMPLATES_CONFIRMATION',
    subjectKey: 'confirmation',
    url: `${AUTH_MAIL_ORIGIN}/auth-mail/confirm-signup.html`,
  }),
  Object.freeze({
    file: 'magic-link.html',
    source: 'docs/platform/supabase/email-templates/magic-link.html',
    hostedField: 'mailer_templates_magic_link_content',
    gotrueEnv: 'GOTRUE_MAILER_TEMPLATES_MAGIC_LINK',
    subjectKey: 'magic_link',
    url: `${AUTH_MAIL_ORIGIN}/auth-mail/magic-link.html`,
  }),
  Object.freeze({
    file: 'reset-password.html',
    source: 'docs/platform/supabase/email-templates/reset-password.html',
    hostedField: 'mailer_templates_recovery_content',
    gotrueEnv: 'GOTRUE_MAILER_TEMPLATES_RECOVERY',
    subjectKey: 'recovery',
    url: `${AUTH_MAIL_ORIGIN}/auth-mail/reset-password.html`,
  }),
]);

/** Is this repo-relative, POSIX-separated path one of the served mail bodies? */
export function isAuthMailPath(rel) {
  return String(rel).startsWith(AUTH_MAIL_PREFIX);
}

/**
 * Compare (and, unless `check`, write) the served copies under `root`.
 * Returns `{ code, lines }` so a test can drive it without a child process.
 */
export function genAuthMail(root, { check = false } = {}) {
  const lines = [];
  const out = join(root, ...AUTH_MAIL_SERVED_DIR.split('/'));

  // Read, never check-then-read: an existsSync() before the read (and the write
  // below) is a file-system race CodeQL grades high (js/file-system-race, #921).
  const readOrNull = (p) => {
    try {
      return readFileSync(p);
    } catch (e) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  };
  // The table names each source in full (for the dead-files guard); it must still
  // be the one file of that name in the source directory, or the copy is not a copy.
  const astray = AUTH_MAIL_TEMPLATES.filter((t) => t.source !== `${AUTH_MAIL_SOURCE_DIR}/${t.file}`);
  if (astray.length) {
    lines.push(
      `gen-auth-mail: TABLE — each source must be ${AUTH_MAIL_SOURCE_DIR}/<file>; ` +
        `these are not: ${astray.map((t) => t.file).join(', ')}. Never a pass.`,
    );
    return { code: 2, lines };
  }
  const wants = new Map(AUTH_MAIL_TEMPLATES.map((t) => [t.file, readOrNull(join(root, ...t.source.split('/')))]));
  const missing = AUTH_MAIL_TEMPLATES.filter((t) => wants.get(t.file) === null);
  if (missing.length) {
    lines.push(
      `gen-auth-mail: COVERAGE LOST — source template(s) missing under ${AUTH_MAIL_SOURCE_DIR}/: ` +
        `${missing.map((t) => t.file).join(', ')}. There is nothing to serve and nothing to compare; never a pass.`,
    );
    return { code: 2, lines };
  }

  const drift = [];
  let written = 0;
  for (const t of AUTH_MAIL_TEMPLATES) {
    const want = wants.get(t.file);
    const dest = join(out, t.file);
    const have = readOrNull(dest);
    if (have && have.equals(want)) {
      lines.push(`ok   ${AUTH_MAIL_SERVED_DIR}/${t.file} == ${AUTH_MAIL_SOURCE_DIR}/${t.file} (${want.length} B)`);
      continue;
    }
    if (check) {
      drift.push(
        have
          ? `${AUTH_MAIL_SERVED_DIR}/${t.file} differs from its source (${have.length} B served vs ${want.length} B source)`
          : `${AUTH_MAIL_SERVED_DIR}/${t.file} is missing`,
      );
      continue;
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(dest, want);
    written++;
    lines.push(`wrote ${AUTH_MAIL_SERVED_DIR}/${t.file} (${want.length} B)`);
  }

  // A stray .html in the served directory is a page nobody generates — served,
  // unchecked, and invisible to every comparison above. Named, never deleted.
  const known = new Set(AUTH_MAIL_TEMPLATES.map((t) => t.file));
  let entries = [];
  try {
    entries = listDir(out, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.html') && !known.has(e.name)) {
      drift.push(`${AUTH_MAIL_SERVED_DIR}/${e.name} is served but no source template produces it — remove it or add its source`);
    }
  }

  if (drift.length) {
    for (const d of drift) lines.push(`✗ ${d}`);
    lines.unshift(
      `gen-auth-mail: DRIFT — ${drift.length} problem(s). Run \`node tooling/sites/gen-auth-mail.mjs\` ` +
        '(a stray file must be removed by hand).',
    );
    return { code: 1, lines };
  }
  lines.push(
    check
      ? `gen-auth-mail: OK — ${AUTH_MAIL_TEMPLATES.length}/${AUTH_MAIL_TEMPLATES.length} served copies equal their sources byte for byte.`
      : `gen-auth-mail: OK — ${written} written, ${AUTH_MAIL_TEMPLATES.length - written} already equal.`,
  );
  return { code: 0, lines };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const root = resolve(args.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const { code, lines } = genAuthMail(root, { check: args.includes('--check') });
  for (const l of lines) (code === 0 ? console.log : console.error)(l);
  process.exitCode = code;
}
