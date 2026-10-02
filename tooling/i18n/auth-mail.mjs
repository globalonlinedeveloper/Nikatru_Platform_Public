// ─────────────────────────────────────────────────────────────────────────────
// auth-mail.mjs — the three auth e-mails (confirm sign-up, magic link, password
// reset) rendered PER LOCALE from tooling/i18n/auth-mail-copy.json and the locale
// register. Pure: it returns the bytes; tooling/ci/assert-locale-register.mjs L2
// compares them with docs/platform/supabase/email-templates/<file> (the disaster-
// recovery copy of the live templates) and sites/nikatru/auth-mail/<file> (the
// served copy self-hosted GoTrue fetches), and `--write` writes both.
//
// ── HOW ONE TEMPLATE SPEAKS SEVERAL LANGUAGES ────────────────────────────────
// GoTrue (hosted and self-hosted) gives the template ONE body per mail type and
// passes the user's metadata as `.Data`. So the body carries one Go-template
// branch per SUPPORTED locale of the register, chosen by the metadata key
// `locale`, and the English body in the final `else`: an unset key, an unknown
// language, a nil `.Data` all read English. The branch value is read through
// `with`, never by a bare field access, because a field access on a nil `.Data`
// is a TEMPLATE ERROR — and a template error is no mail at all.
// `printf "%v"` turns a non-string metadata value into a string, so `eq` never
// compares incompatible types (also an error).
//
// A locale with a block missing a slot gets the ENGLISH slot (and L7 of the guard
// fails on the gap, so the fallback is a runtime safety net, not a policy).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supportedCodes } from './locales.mjs';

export const AUTH_MAIL_COPY_REL = 'tooling/i18n/auth-mail-copy.json';
export const AUTH_MAIL_OUT_DIRS = ['docs/platform/supabase/email-templates', 'sites/nikatru/auth-mail'];
const SLOTS = ['heading', 'intro', 'button', 'ignore'];
const SHARED_SLOTS = ['fallback', 'sentBy'];

export const readAuthMailCopy = (root) => JSON.parse(readFileSync(join(root, AUTH_MAIL_COPY_REL), 'utf8'));

/** Every gap in [copy] against the register's supported set: a missing locale
 *  block, a missing slot, an intro without `{email}`. Pure. */
export function authMailCopyProblems(reg, copy) {
  const out = [];
  const codes = supportedCodes(reg);
  const check = (where, block, slots) => {
    for (const s of slots) {
      const v = block?.[s];
      const ok = s === 'intro' ? Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && x.trim()) : typeof v === 'string' && v.trim();
      if (!ok) out.push(`${where}: \`${s}\` is missing or empty`);
    }
  };
  for (const c of codes) check(`shared.${c}`, copy?.shared?.[c], SHARED_SLOTS);
  const templates = copy?.templates ?? {};
  if (Object.keys(templates).length === 0) out.push('`templates` is empty');
  for (const [file, t] of Object.entries(templates)) {
    for (const c of codes) {
      check(`templates["${file}"].${c}`, t[c], SLOTS);
      if (Array.isArray(t[c]?.intro) && !t[c].intro.join(' ').includes('{email}')) {
        out.push(`templates["${file}"].${c}: \`intro\` never says {email} — the reader cannot tell which account the link is for`);
      }
    }
    for (const k of Object.keys(t)) {
      if (k !== 'title' && !codes.includes(k)) out.push(`templates["${file}"] has a block for ${k}, which the register does not list as supported`);
    }
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const withEmail = (s) => esc(s).replace('{email}', '<strong>{{ .Email }}</strong>');

function rows(t, shared, lang) {
  const attr = lang ? ` lang="${lang}"` : '';
  return [
    `        <tr><td style="background:#ffffff;padding:32px;border:1px solid #e6e8ec;border-top:0;"${attr}>`,
    `          <h1 style="margin:0 0 12px;font-size:20px;color:#101418;">${esc(t.heading)}</h1>`,
    '          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3c4350;">',
    `            ${withEmail(t.intro[0])}`,
    `            ${withEmail(t.intro[1])}`,
    '          </p>',
    '          <p style="margin:0 0 24px;">',
    '            <a href="{{ .ConfirmationURL }}"',
    '               style="display:inline-block;background:#101418;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">',
    `              ${esc(t.button)}</a>`,
    '          </p>',
    '          <p style="margin:0;font-size:13px;line-height:1.6;color:#8b93a1;">',
    `            ${esc(shared.fallback)}<br>`,
    '            <a href="{{ .ConfirmationURL }}" style="color:#3c4350;word-break:break-all;">{{ .ConfirmationURL }}</a>',
    '          </p>',
    '        </td></tr>',
    `        <tr><td style="padding:20px 32px;text-align:center;"${attr}>`,
    '          <p style="margin:0;font-size:12px;color:#8b93a1;">',
    `            ${esc(shared.sentBy)} · <a href="https://nikatru.com" style="color:#8b93a1;">nikatru.com</a><br>`,
    `            ${esc(t.ignore)}`,
    '          </p>',
    '        </td></tr>',
  ];
}

/** Every template's bytes: `file -> text`. Deterministic: register order. */
export function renderAuthMail(reg, copy) {
  const source = reg.source;
  const codes = supportedCodes(reg).filter((c) => c !== source);
  const out = new Map();
  for (const [file, t] of Object.entries(copy.templates)) {
    const en = t[source];
    const sharedEn = copy.shared[source];
    const pick = (block, sharedBlock) => ({
      t: Object.fromEntries(SLOTS.map((s) => [s, block?.[s] ?? en[s]])),
      shared: Object.fromEntries(SHARED_SLOTS.map((s) => [s, sharedBlock?.[s] ?? sharedEn[s]])),
    });
    const lines = [
      `<!-- Supabase ${t.title} template — Nikatru-branded (portfolio-shared).`,
      '     Variables: {{ .ConfirmationURL }} {{ .SiteURL }} {{ .Email }}, and the user metadata key `locale`.',
      `     GENERATED by tooling/i18n/auth-mail.mjs from ${AUTH_MAIL_COPY_REL} and the locale register`,
      '     (tooling/i18n/locales.json): one branch per supported locale, English for any other. Regenerate with',
      '     `node tooling/ci/assert-locale-register.mjs --write`; never hand-edit. -->',
      '{{- $locale := "" }}{{ with .Data }}{{ with .locale }}{{ $locale = printf "%v" . }}{{ end }}{{ end }}',
      `<div style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`,
      '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">',
      '    <tr><td align="center">',
      '      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">',
      '        <tr><td style="background:#101418;border-radius:12px 12px 0 0;padding:28px 32px;text-align:left;">',
      '          <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.3px;">Nikatru</span>',
      '          <span style="font-size:13px;color:#8b93a1;margin-left:8px;">by Nikatru</span>',
      '        </td></tr>',
    ];
    codes.forEach((c, n) => {
      const p = pick(t[c], copy.shared[c]);
      lines.push(`{{- ${n === 0 ? 'if' : 'else if'} eq $locale "${c}" }}`, ...rows(p.t, p.shared, c));
    });
    const p = pick(en, sharedEn);
    if (codes.length) lines.push('{{- else }}');
    lines.push(...rows(p.t, p.shared, null));
    if (codes.length) lines.push('{{- end }}');
    lines.push('      </table>', '    </td></tr>', '  </table>', '</div>', '');
    out.set(file, lines.join('\n'));
  }
  return out;
}
