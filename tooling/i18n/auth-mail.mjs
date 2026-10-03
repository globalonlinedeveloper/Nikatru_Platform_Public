#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// auth-mail.mjs — the three GoTrue auth-mail templates, one per type, speaking
// every register locale that has copy in tooling/i18n/messages/email.json.
// [lane i18n-pipeline, item 5]
//
// GoTrue renders a template with Go's text/template and hands it the account's
// user_metadata as `.Data`. So ONE template per type can choose its language:
//
//   {{- $l := "" -}}{{- with .Data -}}{{- with .locale -}}{{- $l = printf "%v" . -}}…
//   {{- if eq $l "ta" -}} Tamil rows {{- else if eq $l "hi" -}} Hindi rows
//   {{- else -}} English rows {{- end -}}
//
// `with` guards a missing user_metadata and a missing key alike (no nil
// comparison reaches `eq`), and English is the `else`: an account with no
// locale, or one the register has no copy for, gets English. The English rows
// are rendered from the same strings as the other locales and are
// BYTE-IDENTICAL to the template this replaced (the test renders English alone
// and compares it with the committed DR copy before any branch was added).
//
// The locales come from tooling/i18n/locales.json (supported rows, register
// order); a supported locale with no `authMail` block is reported and falls
// back to English. Writes the DISASTER-RECOVERY sources under
// docs/platform/supabase/email-templates/; `node tooling/sites/gen-auth-mail.mjs`
// then byte-copies them to the served sites/nikatru/auth-mail/ (the guard
// assert-supabase-templates holds the two equal).
//
// ⚠️ Changing these files changes what the hosted project must hold: the
// restore/verify step (`node tooling/ops/verify-supabase-templates.mjs`, PAT
// required) is a lead step after merge.
//
// Usage: node tooling/i18n/auth-mail.mjs [--check] [--root <dir>]
// Exit 0 = current (or written). 1 = --check found drift.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegister, supportedCodes } from './locales.mjs';

export const MESSAGES = 'tooling/i18n/messages/email.json';
export const SOURCE_DIR = 'docs/platform/supabase/email-templates';
export const TEMPLATES = Object.freeze([
  { file: 'confirm-signup.html', title: 'Supabase "Confirm signup" template' },
  { file: 'magic-link.html', title: 'Supabase "Magic Link" template' },
  { file: 'reset-password.html', title: 'Supabase "Reset Password" (recovery) template' },
]);
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HEAD = `<div style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
        <tr><td style="background:#101418;border-radius:12px 12px 0 0;padding:28px 32px;text-align:left;">
          <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.3px;">Nikatru</span>
          <span style="font-size:13px;color:#8b93a1;margin-left:8px;">by Nikatru</span>
        </td></tr>
`;
const TAIL = `      </table>
    </td></tr>
  </table>
</div>
`;

/** The body and footer rows of one template in one locale. */
export function rows(m, t) {
  const c = m[t];
  return `        <tr><td style="background:#ffffff;padding:32px;border:1px solid #e6e8ec;border-top:0;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#101418;">${c.heading}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3c4350;">
            ${c.body}
          </p>
          <p style="margin:0 0 24px;">
            <a href="{{ .ConfirmationURL }}"
               style="display:inline-block;background:#101418;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">
              ${c.button}</a>
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#8b93a1;">
            ${m.copyLink}<br>
            <a href="{{ .ConfirmationURL }}" style="color:#3c4350;word-break:break-all;">{{ .ConfirmationURL }}</a>
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#8b93a1;">
            ${m.sentBy} · <a href="https://nikatru.com" style="color:#8b93a1;">nikatru.com</a><br>
            ${c.ignore}
          </p>
        </td></tr>
`;
}

/** The locales (register order) that carry a complete authMail block, and the
 *  supported ones that do not (they get English). */
export function localesWithCopy(reg, msgs) {
  const want = supportedCodes(reg).filter((c) => c !== reg.sourceLocale);
  const complete = (b) => b && b.copyLink && b.sentBy && TEMPLATES.every((t) => {
    const k = t.file.replace(/\.html$/, '');
    return b[k] && b[k].heading && b[k].body && b[k].button && b[k].ignore;
  });
  return {
    branches: want.filter((c) => complete(msgs.authMail[c])),
    missing: want.filter((c) => !complete(msgs.authMail[c])),
  };
}

/** One whole template. `locales` are the non-source codes to branch on. */
export function renderTemplate(t, msgs, locales, source = 'en') {
  const key = t.file.replace(/\.html$/, '');
  const header =
    `<!-- ${t.title} — Nikatru-branded (portfolio-shared).\n` +
    `     Variables: {{ .ConfirmationURL }} {{ .SiteURL }} {{ .Email }}` +
    (locales.length
      ? ` (and user_metadata.locale)\n     GENERATED by \`node tooling/i18n/auth-mail.mjs\` from tooling/i18n/messages/email.json:\n` +
        `     one branch per locale (${locales.join(', ')}), English when the account has none. -->\n`
      : ' -->\n');
  const en = rows(msgs.authMail[source], key);
  if (!locales.length) return header + HEAD + en + TAIL;
  const pick = '{{- $l := "" -}}{{- with .Data -}}{{- with .locale -}}{{- $l = printf "%v" . -}}{{- end -}}{{- end -}}\n';
  let body = pick;
  locales.forEach((code, i) => {
    body += `${i === 0 ? '{{- if' : '{{- else if'} eq $l "${code}" }}\n` + rows(msgs.authMail[code], key);
  });
  body += '{{- else }}\n' + en + '{{- end }}\n';
  return header + HEAD + body + TAIL;
}

export function plan(root = DEFAULT_ROOT) {
  const reg = loadRegister(root);
  const msgs = JSON.parse(readFileSync(join(root, MESSAGES), 'utf8'));
  const { branches, missing } = localesWithCopy(reg, msgs);
  const items = TEMPLATES.map((t) => {
    const path = `${SOURCE_DIR}/${t.file}`;
    let have = null;
    try {
      have = readFileSync(join(root, path), 'utf8');
    } catch {
      /* absent is drift */
    }
    return { path, want: renderTemplate(t, msgs, branches, reg.sourceLocale), have };
  });
  return { items, branches, missing };
}

function main(argv) {
  const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : DEFAULT_ROOT;
  const check = argv.includes('--check');
  const { items, branches, missing } = plan(root);
  if (missing.length) console.log(`note  no authMail copy for ${missing.join(', ')} — those accounts get English`);
  let drift = 0;
  for (const it of items) {
    if (it.want === it.have) continue;
    if (check) {
      console.error(`✗ ${it.path} is not what ${MESSAGES} renders — run \`node tooling/i18n/auth-mail.mjs\` then \`node tooling/sites/gen-auth-mail.mjs\`.`);
      drift++;
    } else {
      writeFileSync(join(root, it.path), it.want);
      console.log(`wrote ${it.path}`);
    }
  }
  if (!drift) console.log(`ok  auth mail — ${items.length} template(s), branches: ${branches.join(', ') || 'none'} (English otherwise)`);
  return drift ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
