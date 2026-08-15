# Supabase auth — portfolio branding (Cross_Platform_Auth · lcrkiurkvzhkonjwhpiv)

One Supabase project authenticates every app in the portfolio. Branding it once brands all apps.

## What's configured via the Management API (session-applied, re-runnable)
- **Site URL:** `https://subly.nikatru.com` (app #1's web home; OAuth/email links default here).
- **Redirect allow-list:** `https://subly.nikatru.com/**`, `https://subly.pages.dev/**`,
  `http://localhost:3000/**`, `http://localhost:8080/**` (web + local dev). Add per-app web
  origins as apps ship; add a custom-scheme deep link (e.g. `subly://auth-callback`) once the
  desktop/mobile apps register one.
- **Email templates** (`email-templates/*.html`): Nikatru-branded confirm-signup, magic-link,
  reset-password. Inline-CSS table layout (email-client-safe), no remote images (no logo
  hosting dependency, no tracking flags). Variables: `{{ .ConfirmationURL }}`, `{{ .Email }}`.
  **Applied and live** — the branded subjects and bodies were read back off the live project.
  These files are **disaster-recovery material**, not documentation; see "DR" below.

## Mail transport — CUSTOM SMTP, LIVE. Not the provider default.
**Auth mail leaves this project through Resend, from our own domain.** Read from
`GET /v1/projects/{ref}/config/auth` on **2026-08-04**:

```
smtp_host  smtp.resend.com     smtp_port  465        smtp_user  resend
smtp_pass  SET                 smtp_sender_name  Nikatru
smtp_admin_email  auth@mail.nikatru.com
external_email_enabled  true   rate_limit_email_sent  100   mailer_autoconfirm  false
```

The architecture is recorded once, machine-readably, in
[`tooling/mail-transport.json`](../../../tooling/mail-transport.json), and in full in
**ADR 029** ([`Private/knowledge/decisions/029-email-sending-architecture.md`][adr029], local-only tree):

> **Workspace = the owner's mailbox · Resend = everything a machine sends.**
> `nikatru.com` is Google Workspace and carries **human mail only**.
> `mail.nikatru.com` is Resend and carries **all machine mail, for all apps** —
> `auth@` for signup confirm and password reset, `alerts@` for GlitchTip, later `receipts@`
> and `news@`. App identity goes in the **display name**, never in the domain, so the whole
> factory sends from one identifier that can actually earn a reputation.

⚠️ **`rate_limit_email_sent` is PROJECT-WIDE.** Every app in the portfolio shares that one
hourly budget. It reads `100`; the Supabase default for a project on custom SMTP is 30.

### 🔻 What this section used to say, and why the correction is kept next to it
Until 2026-08-04 this file claimed *"Custom SMTP — NEEDS OWNER"*, that the free tier's
**default mailer** rejected template edits (`400: Email template modification is not available
for free tier projects using the default email provider`), and that the **built-in mailer**
was rate-limited to a few messages an hour. **All of that was stale.** Custom SMTP had been
configured all along — `smtp_host` reads **`smtp.resend.com`**, the sender is
**`auth@mail.nikatru.com`** — and the branded templates had been applied. See **ADR 029**.

It did real damage: an audit agent read this file plus three others in the local-only trees,
found that all four agreed, and escalated *"no real user can sign up"* to a 🔴🔴 blocker on the
first store submission — **while `SUPABASE_PAT`, which answers the question in one GET, sat in
the vault**. 📌 **Four agreeing documents are not evidence. They are one stale fact copied four
times.** `tooling/ci/assert-mail-transport-claims.mjs` now fails the build when a document
restates the superseded transport without the current one beside it, which is why this
paragraph and the block above it are in the same section.

## Custom auth domain (auth.nikatru.com) — PAID, decision pending
Supabase custom domains: **$10/mo add-on**, requires **Pro plan ($25/mo)** → ~$35/mo total
(project is currently FREE tier). Pure vanity/deliverability win (auth URLs show
auth.nikatru.com instead of lcrkiurkvzhkonjwhpiv.supabase.co). Recommendation: defer until
revenue; custom SMTP + templates deliver most of the branding value for $0.

⬜ **Unsettled:** whether a Supabase branding footer persists on Free + custom SMTP + custom
templates. Undocumented by Supabase — settle it by looking at one delivered message, not by
reading. (Removing the branding is what Pro buys; the templates themselves are not gated.)

## Re-apply / extend (any session)
Management API: `PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` with
`Authorization: Bearer $SUPABASE_PAT`. Fields used: `site_url`, `uri_allow_list` (comma-joined
string), `mailer_subjects_*`, `mailer_templates_*_content`, `smtp_*`. Templates live in this
folder as the source of truth — edit here, re-PATCH.

### 🔴 THAT ENDPOINT REPLACES. IT DOES NOT MERGE.
On **2026-08-04** a one-field `PATCH` carrying only `smtp_admin_email` emptied `smtp_host`,
`smtp_port`, `smtp_user`, `smtp_pass` and `smtp_sender_name`, reset `rate_limit_email_sent`
**100 → 2**, and reverted **all three branded templates** to Supabase defaults. For a few
minutes auth mail was back on the provider's own sender.

Rules for anyone touching it again:
1. **GET the full config first and keep it.**
2. **Send the COMPLETE `smtp_*` block and all `mailer_*` fields**, even to change one value.
3. **PowerShell 5.1 trap:** `Get-Content -Raw` returns a String carrying PSObject properties and
   `ConvertTo-Json` serialises it as `{"value": "..."}`, which the API rejects with *"expected
   string, received object"*. Cast `[string]` explicitly.

### DR — the `email-templates/` files are the only restore path
The 2026-08-04 wipe recovered **byte-for-byte** only because `email-templates/*.html` happened
to match the live bodies exactly (2313 / 2333 / 2269 chars). Nothing required that. Two checks
now do:

| Check | Sees | Runs |
|---|---|---|
| `tooling/ci/assert-supabase-templates.mjs` | the files exist and are structurally sound | every CI run — **cannot see live drift, holds no PAT** |
| `tooling/ops/verify-supabase-templates.mjs` | the files still equal the LIVE fields, and the live transport still matches the register | `ops-watch.yml`, when `SUPABASE_PAT` is a repo secret; by hand otherwise |

[adr029]: ../../../knowledge/decisions/029-email-sending-architecture.md
