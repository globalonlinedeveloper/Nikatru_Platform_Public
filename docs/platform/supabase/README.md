# Supabase auth — portfolio branding (Cross_Platform_Auth · lcrkiurkvzhkonjwhpiv)

One Supabase project authenticates every app in the portfolio. Branding it once brands all apps.

## What's configured via the Management API (session-applied, re-runnable)
- **Site URL — TARGET:** `https://nikatru.com/subscriptiontracker` (app #1's web home; OAuth/email links
  default here). The web build is compiled with `--base-href /<app id>/`, so the app is served
  under a **path prefix on the shared apex**, not at an origin of its own — and the Site URL is
  the app's base path, not `https://nikatru.com`. ⬜ **Not yet applied:** read live on
  **2026-09-09** it still holds `https://subly.nikatru.com`. The cutover PATCHes it; this file
  says what it is being PATCHed to.
- **Redirect allow-list — TARGET:** `https://nikatru.com/subscriptiontracker/**`,
  `https://subscriptiontracker-7qg.pages.dev/**`, `http://localhost:3000/**`, `http://localhost:8080/**`
  (web + local dev), **plus the native auth callback** (⏱ 2026-09-23):
  `com.nikatru.subscriptiontracker://auth-callback` and the same URL with each marker the app
  sends — `?nk_auth=confirm`, `?nk_auth=oauth`, `?nk_auth=link`, `?nk_auth=reset`,
  `?nk_auth=email-change`, each an EXACT entry, no wildcard. Add per-app web paths as apps ship.
  The recorded value, entry for entry and in PATCH order, is `supabaseAuth.uri_allow_list` in
  `tooling/mail-transport.json`; `site_url` sits beside it.
  - **The scheme is `com.nikatru.<app id>`, reverse-DNS, one per app.** This file used to propose
    `subscriptiontracker://auth-callback`. Superseded: a bare word is a scheme any other app on the
    device can also claim, and RFC 8252 §7.1 asks native apps for a reverse-DNS scheme under a
    domain they control for exactly that reason. One derivation writes it —
    `authCallbackScheme()` in `packages/auth_supabase/lib/src/auth_redirect.dart` — and
    `tooling/ci/assert-auth-callbacks.mjs` holds every native registration and this list to it.
  - **Why each marker is its own entry.** gotrue matches `redirect_to` against each allow-list
    glob with only the `#fragment` cut off — the query string is part of what must match
    (`IsRedirectURLValid`, supabase/auth `internal/utilities/request.go`, read 2026-09-23). So the bare
    `…://auth-callback` entry does NOT admit `…://auth-callback?nk_auth=reset`; without the exact
    entries every native link would be substituted with the Site URL (below) and open the web app.
  - ⚠️ **The same file also shows a redirect whose host, scheme and port equal the Site URL's is
    accepted WITHOUT consulting this list.** With the Site URL on `https://nikatru.com/…`, every
    `https://nikatru.com/<path>` is accepted whatever the list says, so the per-app `/<app id>/**`
    rule below keeps the LIST honest but is not the boundary for the apex host itself.
  - 🔴 **PER APP, `/<app id>/**` — NEVER the bare apex `https://nikatru.com/**`.** Every app now
    shares ONE origin, and one Supabase project authenticates all of them. An apex wildcard
    would make **every path on nikatru.com** a legal post-auth redirect target: any other app,
    the marketing pages, and anything a future deploy puts there. The wildcard is the boundary
    between apps, so it has to be drawn where the boundary now is — at the path, not the host.
  - Live on **2026-09-09** the list reads `https://subly.nikatru.com/**`,
    `https://subly-9cp.pages.dev/**`, `http://localhost:3000/**`, `http://localhost:8080/**` —
    the two localhost entries and the Pages entry are already correct and are carried over
    unchanged; only the first entry moves.
  - 📌 **Correction, 2026-09-09:** this file used to say `https://subscriptiontracker.pages.dev/**`. The LIVE
    config was right and the DOC was wrong — the Cloudflare Pages project is named `subscriptiontracker` and
    its production alias is **`subly-9cp.pages.dev`**. A reader who "fixed" the live list to
    match this file would have deleted the only entry that lets a preview deployment complete a
    sign-in.
  - 📌 **Correction, 2026-09-23:** the Pages entry is **`https://subscriptiontracker-7qg.pages.dev/**`**.
    That has been the live production alias since the slug rename moved the app to its own Pages
    project. `subly-9cp.pages.dev` is the pre-rename origin; it was retired on 2026-09-11, when it
    left both Workers' CORS lists (`tooling/ci/assert-cors-allowlist.mjs`, which refuses to re-add
    it). So the 2026-09-09 line above ("carried over unchanged") no longer holds for the Pages entry.
    A live GET on 2026-09-23 read the four web entries with `-7qg` second, which is what
    `supabaseAuth.uri_allow_list` records.

### 🔴 gotrue does not reject a bad redirect. It SILENTLY SUBSTITUTES the Site URL.
A `redirect_to` that is not on the allow-list produces **no error and no warning**: gotrue
answers with the project's **Site URL** instead. Mail sends, the link resolves, a page loads —
so a wrong list, an absent entry and a correct one are indistinguishable from inside the app.
Under the old per-app subdomain the substitute was the same host, which made it invisible;
under path routing it lands the user on the **apex** instead of in the app.

**Operational rule — the read-back, and it is the only evidence there is:**

1. `PATCH` the config (whole `smtp_*` block and all `mailer_*` fields — see "THAT ENDPOINT
   REPLACES" below).
2. **`GET https://api.supabase.com/v1/projects/{ref}/config/auth` and compare `site_url` and
   `uri_allow_list` string-for-string against the target above.** Not "spot-check" — compare.
3. Only then treat the change as applied.

⚠️ **"The reset flow works" is NEVER evidence that the list is correct** — a substituted redirect
still completes a working-looking flow. The only way to tell an ACCEPTED redirect from a
SUBSTITUTED one from outside is that the accepted one comes back carrying the query and fragment
it was handed (measured 2026-08-11: `…/?nk_auth=reset#/reset-password` accepted vs. the bare Site
URL substituted). The composition of that URL, and the same warning at the point of use, is
`packages/auth_supabase/lib/src/auth_redirect.dart` (was `password_reset_redirect.dart` until 2026-09-23).
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
**ADR 029** ([`Private/decisions/029-email-sending-architecture.md`][adr029], local-only tree):

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
| `tooling/ops/verify-supabase-templates.mjs` | the files still equal the LIVE fields, and **every field recorded in `supabaseAuth`** still matches live | `ops-watch.yml`, when `SUPABASE_PAT` is a repo secret; by hand otherwise |

## Password-reset hardening, and the probe that proves it — 2026-09-16

Owner ruling 2026-09-15 (`O-AUTH-PASSWORD-RESET-HARDENING`): a password change
requires reauthentication, a reset ends the other sessions, the security
notification emails are on, and the minimum length is 8. Those ten fields were
PATCHed onto the hosted project on 2026-09-16 and are now recorded in
`tooling/mail-transport.json`'s `supabaseAuth`, which is what the live checker
above compares — so a silent revert shows up as DRIFT on the next ops-watch tick.

⚠️ **The comparison used to be a hardcoded list** and would have ignored all ten
while printing green over eight. It is derived from the record now; the reasoning
is in `verify-supabase-templates.mjs`'s own header.

`tooling/ops/verify-password-reset-revokes.mjs` is the separate, **by-hand**
probe for the one clause a config field cannot answer: it creates a throwaway
user, opens two sessions, resets the password through a real recovery link, and
requires the other session's refresh token to be **rejected afterwards and
accepted before** — a run whose "before" leg fails is `UNKNOWN` (exit 2), never
a pass. It provisions a real account, so it is wired into no workflow; run it
when the auth backend changes, and read its exit code, not its prose.

What it does **not** assert, deliberately: an access token already issued stays
valid until `jwt_exp` (3600 s live), because GoTrue's JWTs are stateless. The
ruling asks about refresh tokens; closing the access-token window is separate
work in `services/_shared/src/auth.ts`.

**Signed-out sessions (AUTH-REVOKE-AT-WORKERS, 2026-09-25):** every Worker now refuses a token whose session is on the `SESSION_REVOKED` list. `services/platform/src/routes/sessions.ts` lists and ends sessions through two service-role RPCs in [`sql/sessions-rpc.sql`](sql/sessions-rpc.sql). That file is **not** a migration: the parent applies it by hand after review, and its header carries the two read-backs and the rollback. Until then `GET /v1/sessions`, `DELETE /v1/sessions/:id` and `POST /v1/sessions/revoke-others` answer 503 `sessions_unavailable`; `POST /v1/sessions/revoke-all` calls neither function and works from the deploy.

[adr029]: ../../../knowledge/decisions/029-email-sending-architecture.md
