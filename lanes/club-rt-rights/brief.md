# CLUB club-rt-rights (lead 7185eb, 2026-10-02): 4 roadmap lanes in ONE branch and ONE PR
Owner deadline: everything complete by 2026-10-04. Implement the members below IN THIS ORDER on one branch, one PR, at least one
commit per member whose subject starts with the member lane name. Where a member brief says "your deps have landed / STOP and report if
<dep> is missing" and <dep> is an EARLIER MEMBER of this club, that dep is satisfied by the earlier commits on this branch: do not stop.
A member that cannot go green after ONE root-cause fix is DROPPED: revert its commits, list it in the PR body under "Dropped", and the
rest still land. Prefer the smallest correct implementation of each member's done-definition; never skip its red controls.
PR title: "Club club-rt-rights: dpdp-rights, growth-codes, lifecycle-mail, help-ai-chat". The PR body lists, per member, its Rows and Deploys lines.
This club is HELD for an independent review before landing (user data + money (privacy notice, codes, mail)).

---

## MEMBER 1 of 4: dpdp-rights (P1; original brief dpdp-rights-2026-10-02.md)
> LEAD OVERRIDE (dep flattening 2026-10-02): these deps no longer gate this member; any "STOP and report" line naming them is VOID: help-search.

# Lane dpdp-rights [Opus 5.5 · high · Acct1 · Cloud]: India's DPDP rights machinery: a rights-request intake with clocks, a published contact, an itemised notice, a server-data export and a 72-hour breach procedure

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `privacy/dpdp-rights`, one PR in Public, from an up-to-date origin/main.
**User-data path: the PR is HELD for an independent review.** It deploys Workers and the apex site, so it MERGES ALONE.
Your deps have landed when you start: club-identity-boxc (PR #1140, the 2026-10-02 privacy bump), apply-public-registers-hygie (the
seller sentences and the grievance duty rows), feedback-intake and feedback-triage (the private intake, its statuses and clocks) and
help-search (the Help screen in Settings). STOP and report if #1140 is still open at your base: privacy.html is its file until it merges.

**Owner direction:** the privacy policy is the AGENT's (owner, 2026-10-01: "Always you can update Privacy"); terms and refund wording stay
the OWNER's (ADR 031 class B, ADR 100): never edit them. 2026-10-02: "Always you need to take complete owner ship on everything".

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Ranked gap 2: "**DPDP Rules machinery.** Rights-request intake for access, correction, erasure, nomination and grievance, with clocks
  (90-day grievance per PIB). A published contact. The itemised notice (Rule 3). A server-side personal-data export. A 72-hour breach
  runbook plus the R14-09 sentences." "The only statutory deadline aimed at this business: 13 May 2027, and MeitY has floated 13 Nov 2026."
- Row 25: "Consent: F-05, INV-1106 (append-only artifacts). Erasure: F-08, F-32, ADR 081 retry. Retention: `C-RETENTION-PERIODS`
  400/730/1100 days ... `tooling/legal/data-inventory.json`." Missing: "**DPDP Rules machinery** ... Gate **R14-09 RED (owner)** and
  INV-14-43 suppressed (breach drill `lastDrill: null`). `O-CERTIN-6H-AND-180D-LOGS` RED (owner). F-05 'no re-prompt on a policy-version
  bump'. No server-side DSAR export."
- Row 7: "The export of **server-held** personal data (consent artifacts, events, account) for a DPDP access request is missing."
- §3: "**India DPDP Rules 2025**, phased. Notified 13/14 Nov 2025. Rule 4 (Consent Managers) **13 Nov 2026**. Substantive rules (notice,
  security, 72-h breach intimation, erasure, data-principal rights, grievance in 90 days) **13 May 2027**." **Verified** (PIB note):
  "Consent Manager ... within 12 months ... other provisions within 18 months", breach "not later than 72 hours", grievances "90 days".
  **Unverified:** "MeitY's Jan 2026 proposal to compress to 12 months (substantive rules by 13 Nov 2026)". Consent Managers bind only those
  who register as one. Build as if 13 Nov 2026 were the date.
- nikatru.com audit C3 (verbatim): "The main policy's §9 lists access, correction, deletion and withdrawal, but it does **not** name the
  Grievance Officer, the Data Protection Board escalation or the right to nominate ... There is no cookies / local-storage section
  (measured: the site sets 0 cookies; `/pricing` writes `nikatru.checkout.app` to `localStorage`, `pricing.html:348`; what the Flutter app
  stores in the browser was **not measured**, so read it before writing the line)." "Add §9 'How to complain' (Grievance Officer from the
  `FACT:grievance-officer` region, 48 h / 30 d, DPB) ... **No separate cookie page and no banner are needed** while there are no cookies."

## Do (each with a red control that fails without it)
1. **Rights requests ride the private intake.** A `privacy-request` kind in `services/feedback` with a type (access, correction, erasure,
   nomination, grievance, withdraw consent) and clocks: acknowledge within the published 48 hours, resolve within the published 30 days,
   never past the statutory 90 days for a grievance; overdue states page the owner through the existing owner-page path. Identity: the
   signed-in session (collect no new ID); signed-out requesters (for example launch-list sign-ups) verify by an e-mailed link. The triage
   routine never auto-closes a rights request. Red: a request at day 29 is amber, day 31 red; an unauthenticated access request without
   the e-mail proof is refused.
2. **The entry points.** In-app: Settings > Privacy and data > "Your privacy rights" (adopted through the chassis; every app and the brick
   inherit it), next to the existing deletion. Web app: the same route. nikatru.com: a short `/privacy-rights` page with the same choices
   posting to the same-origin `/api/report` function, plus the grievance e-mail fallback. Red: `check-site-integrity` fails if the page or
   its footer link is missing; a widget test opens each request type.
3. **Server-held data export (access).** An authed export that assembles, as one JSON file, everything we hold server-side about the
   user across Workers (account, consent artifacts, preferences, subscriptions, reminders, grants, feedback and rights requests, event
   rows keyed to the user), driven by `tooling/legal/data-inventory.json` (every inventory row names its reader; a row with no reader fails).
   Red: adding an inventory row without a reader fails the guard; the export of a seeded user contains a row from every store.
4. **Nomination (DPDP s.14).** The user records one nominee (name and e-mail, nothing more) to act if they die or become incapacitated;
   the nominee is told only when they act. Add it to the inventory, the export and erasure. Red: erasure removes the nominee.
5. **The itemised notice (Rule 3), generated.** A sentinel region in `sites/nikatru/privacy.html` and in each app's notice
   (`apps/<id>/privacy.yaml` -> `render-privacy.mjs`) rendered from `data-inventory.json`: each item of personal data, its purpose, its
   retention, how to withdraw consent, how to exercise each right, and how to complain to the Data Protection Board. Add §9 "How to
   complain" (Grievance Officer from the entity source's FACT region, the 48 h / 30 d promise, the Board) and a short "Cookies and local
   storage" section (read what the web app stores before you write it). Version bump plus snapshot in the same commit
   (`assert-policy-archive.mjs`). Red: an inventory row missing from the rendered notice fails; a hand edit inside the region fails `--check`.
6. **Re-prompt on a notice change (F-05).** Each consent artifact records the notice version; a material version bump re-asks consent for
   the purposes it changed, once, and never blocks the app's core use. Red: bumping the version in a fixture re-prompts once; an unchanged
   version never re-prompts.
7. **The 72-hour breach procedure.** `docs/ops/breach-response.md` (Public; no secrets): detect, contain, assess, the Board intimation
   within 72 hours and the affected-user notice (both drafted by `tooling/legal/breach-draft.mjs` from a template; it sends nothing), the
   log of decisions, and a drill mode on fake data. Name the CERT-In 6-hour report as a step whose route is the OWNER's ruling
   (`O-CERTIN-6H-AND-180D-LOGS` stays owner). Red: the drill fixture produces both drafts with every required field; a missing field exits 1.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- Terms and refund wording, `sites/nikatru/{terms,refund,pricing}.html`, `apps/*.html` text (the OWNER's; the India rail #1149).
- The seller-per-channel sentences and the grievance duty rows (apply-public-registers-hygie) beyond reading them.
- Money files (the payments port, money routes, refund-finish); AI files (port-ai #1136, T17); the i18n pipeline internals (branch
  `i18n/pipeline`); the merge orchestrator (branch `ci/merge-orchestrator`); `sites/rajasekarselvam/**`.
- Translated legal text: English is the only binding legal text; never publish a translated notice.

## Rows
NEW O-DPDP-RIGHTS-INTAKE-UNBUILT (closes here); NEW O-DPDP-ITEMISED-NOTICE-MISSING (closes here); NEW O-SERVER-DATA-EXPORT-MISSING
(closes here); NEW O-DPDP-BREACH-72H-PROCEDURE-MISSING (closes here; INV-14-43's drill closes at the lead's first drill); NEW
O-CONSENT-NO-REPROMPT-ON-NOTICE-BUMP (closes here); O-CERTIN-6H-AND-180D-LOGS (stays owner). Exactly one `Rows:` line.

## Deploys
`platform`, `subscriptiontracker-api` (export), the feedback Worker's unit, the apex site unit (`nikatru-site`) and
`subscriptiontracker-web`, as `tooling/ci/lane-map.json` names them. Say which Workers the merge redeploys (ci-07).

## Lead steps (not run here; list them in the PR body)
Run the breach drill once on fake data and record `lastDrill`; the owner's CERT-In ruling (only if it stays owner-gated).

## Rules (every lane)
- Pipeline-first: the rights screen, the export and the notice renderer are shared; every app and the brick inherit them.
- Feature parity: all seven targets (web, Android, iOS, macOS, Windows, Linux, apps.gov.in) in this PR, or the body names the target that
  waits and the proof.
- Privacy-minimal: no new identifiers to verify identity; the export holds only what we already hold. Adults only (ADR 068): no age
  gate, no guardian flow. AI is paid only.
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, or dispatch a workflow from the
  cloud: list live steps under "Lead steps". Never merge. Never `--no-verify`. Never edit Private. Generated files are regenerated with
  their generators (`--check` makes a hand edit red).
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (`assert-policy-archive.mjs`, `assert-policy-claims.mjs`, `assert-retention-coverage.mjs`, the deletion and consent guards). LAST:
  `assert-guard-coverage.mjs`; commit its ratchet row.
- The PR body is complete before the first push (`Rows:` once, `Deploys:`, one row per Do item with its red control, "HELD for review
  (user data)", the Lead steps, the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash. git-09/git-10: root `pubspec.lock`; use melos.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- ci-49 (sites): after any `sites/**` change run `node tooling/sites/generate-discovery.mjs`, then
  `node tooling/ci/check-site-integrity.mjs . sites/nikatru sites/rajasekarselvam`, and commit what they write.
- Frozen records: `sites/nikatru/legal/<version>/<locale>/privacy.html` snapshots are never edited; a new one lands with the bump.
- Entity facts (grievance officer, address) render from `tooling/house-identity.json` through FACT regions; never type them.
- vacuous-03: redden every new check. grep-17: cite by anchor. ci-07: name the Workers redeployed.
- agents-03: absolute paths only. agents-21: do not spawn agents.

## Lead addendum 2026-10-02 10:05Z: CERT-In (decided by the lead; ADR in Private)
- 180-day ICT log retention on the Mumbai boxes (India jurisdiction): a retention job that keeps minimised logs (no raw IP) 180 days and deletes after; a heartbeat duty for it in the ops register (pattern of the other box duties). Red: a log older than 180 days survives -> the check fails.
- The 6-hour incident path as a runbook + script: detection sources (GlitchTip, ops-watch, ntfy), a script that drafts the CERT-In report (incident@cert-in.org.in, the Annexure fields) from an incident record, ready within 1 hour; the owner presses Send. The live box job install is a "Lead step (not run here)".

---

## MEMBER 2 of 4: growth-codes (P1.5; original brief growth-codes-2026-10-02.md)
# Lane growth-codes [Opus 5.5 · high · Acct1 · Cloud]: promo and offer codes on every channel, and invite-a-friend (a free Pro month for both, abuse-limited), never below cost

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `money/growth-codes`, one PR in Public, from an up-to-date origin/main.
**Money path: the PR is HELD for an independent money review.** It deploys `platform` (a migration, if any, ALONE first) and the web
app, so it MERGES ALONE. Your deps have landed when you start: refund-finish (the money routes and the payments port in use) and
dpdp-rights (the privacy notice and the Settings privacy screen). STOP and report if either is missing at your base.

**Owner direction (2026-10-02, verbatim):** "Our main goal is maximum profits margins". **The lead decided the discount policy (it is
the lead's):** never below cost; never "free AI". Promo and offer codes plus invite-a-friend: a free Pro month for both, abuse-limited.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 11, "Promo codes / offers", PARTIAL: "Grant schema: `services/platform/migrations/0009_bundle_grants.sql:237-238` (`promo_code`: 'An
  operator-issued promotional code ... nobody paid'; `owner_comp`); ADR 099 rules promo_code term = subscription (0018)." Missing: "**No
  redeem route or UI and no code issuance.** No Paddle discount codes. No App Store offer codes or Play promo codes. No win-back offers."
- Ranked gap 12: "Launch, press and reviewer codes plus win-back offers. The schema already exists, so this is mostly a route and a screen."
- Row 10, "Referral / invite", DECIDED-AGAINST (incentives): "'The '+30-50%' basis for two-sided referral is on MASTER_PLAN §3's refuted
  list'." **The lead reverses that cut today on the owner's 2026-10-02 direction**, with the abuse limits below; record the reversal in
  the PR body (the lead records it in Private).

## The policy (the lead's; encode it, never relax it)
- **Never below cost.** A paid discount is allowed only while net revenue after the store or rail fee, GST and our per-user running cost
  stays at or above cost; the floor is computed from `tooling/catalog/fee-register.json` and the ceilings/cost registers, never typed.
- **Never free AI.** A promo, offer or invite month grants Pro WITHOUT the monthly AI allowance and without AI credits; AI credit packs
  are never discounted below their 4x-cost floor.
- **Invite-a-friend:** both people get one free Pro month. The reward is granted when the invitee's account is at least 7 days old, has a
  verified e-mail and has reached the app's activation event (`services/platform/queries/insights/01-activation-rate.sql` defines it).
  At most 5 rewarded invites per inviter per calendar year; one reward per invitee account ever; no reward if the invitee ever had Pro or
  a trial; no self-invite (same account, or the same canonicalised e-mail). No device fingerprint and no address stored.
- **Stacking:** a free month never stacks with an active trial (it starts when the trial ends or when no trial runs); one free month at
  a time per account.

## Do (each with a red control that fails without it)
1. **Codes as data.** An offers register (with the rail config, so prices still come from ONE source) for operator codes (press,
   reviewers, launch: `promo_code` grants, term per ADR 099) and paid discounts (percentage, duration, channel, cap, expiry), checked by a
   guard against the cost floor. Red: a fixture discount that drops net below cost fails; a free month carrying AI allowance fails.
2. **Redeem on the server.** An authed, rate-limited redeem route writing the grant, idempotent, with per-code caps and expiry; codes are
   stored hashed. Red: a replay grants once; an expired or exhausted code is refused; 6 wrong codes in a minute are throttled.
3. **The right mechanism per channel (store rules first).** Read each store's current rules (cite URL and date): Apple forbids unlocking
   features with our own codes in App Store builds (guideline 3.1.1), so App Store builds open Apple's offer-code redemption (through the
   billing package) and never show our code field; Play builds use Play promo codes / offers where Play's rules require them; web,
   Windows, Linux and apps.gov.in redeem our codes; Paddle discount codes apply at web checkout. A per-channel capability row decides what
   each build shows. Red: an App Store build fixture renders no own-code field; a capability row missing for a channel fails.
4. **Invite-a-friend.** A per-user invite link (opens the app or `nikatru.com/<app>/` on the web), the reward rules above enforced on the
   server, a "your invites" list (count only, no invitee details beyond "joined" / "rewarded"). Red: one test per abuse rule (account
   age, unverified e-mail, no activation, sixth reward in a year, invitee who had a trial, self-invite) grants nothing.
5. **Win-back offers, ready for mail.** An offer kind for lapsed paid users (a paid discount above the floor) that lane lifecycle-mail
   will attach to its win-back e-mail. Red: a win-back offer below the floor fails the guard.
6. **Disclosure.** The privacy notice's itemised region gains the invite relation (who invited whom, kept until the reward settles plus
   the retention class you choose and register) through `data-inventory.json` and the renderer; nothing about prices in the policy.
   Red: the inventory row without a retention class fails `assert-retention-coverage.mjs`.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- Terms, refund and pricing wording and `sites/nikatru/{terms,refund,pricing}.html` (the OWNER's; the India rail #1149). If a code
  needs a terms sentence, list it as an owner item; never write it.
- Store webhook adapters (fix-store-rails-live, port-store-direct); the payments port's shape (call it; if it must change, STOP).
- AI credits, packs and the meter (T17); AI files (port-ai #1136); the i18n pipeline internals (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`).

## Rows
NEW O-PROMO-CODES-NO-REDEEM-ROUTE (closes here); NEW O-INVITE-REWARD-UNBUILT (closes here); NEW O-DISCOUNT-FLOOR-UNGUARDED (closes
here). Exactly one `Rows:` line.

## Deploys
`platform` (migration ALONE first if you add a column or table) and `subscriptiontracker-web`, as `tooling/ci/lane-map.json` names them;
native targets through CI builds. Say which Workers the merge redeploys (ci-07).

## Lead steps (not run here; list them in the PR body)
Create Paddle discount codes, App Store offer codes and Play promo codes from the register's dry-run output (vendor and store consoles);
issue the first press and reviewer codes; the independent money review.

## Rules (every lane)
- Pipeline-first: codes, redemption and invites live in shared packages and the platform Worker; every app and the brick inherit them.
- Feature parity: every target gets a compliant way to redeem in this PR (the mechanism may differ per store; the body names each).
- Privacy-minimal: hashed codes, no fingerprint, no address. Adults only (ADR 068). AI is paid only (never in a free month).
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, any vendor or store console, or
  dispatch a workflow from the cloud: list each under "Lead steps". Never merge. Never `--no-verify`. Never edit Private. Generated files
  are regenerated with their generators.
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (the price guards, `assert-ports.mjs`, the retention and policy guards). LAST: `assert-guard-coverage.mjs`; commit its row.
- The PR body is complete before the first push (`Rows:` once, `Deploys:`, one row per Do item with its red control, "HELD for review
  (money)", the owner items, the Lead steps, the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash. git-09/git-10: root `pubspec.lock`; use melos.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- Prices only from the rail config; never type a price into code, a page or a test expectation that a generator owns.
- A D1 migration deploys ALONE and first (additive only); keep code tolerant of the column being absent until it has run.
- vacuous-03: redden every new check. grep-17: cite by anchor. ci-07: name the Workers redeployed.
- agents-03: absolute paths only. agents-21: do not spawn agents.

---

## MEMBER 3 of 4: lifecycle-mail (P1.5; original brief lifecycle-mail-2026-10-02.md)
# Lane lifecycle-mail [Opus 5.5 · high · Acct1 · Cloud]: opted-in users get an activation nudge and lapsed users a win-back e-mail, on the existing mail rail, inside the plan

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `mail/lifecycle`, one PR in Public, from an up-to-date origin/main.
**User-data path (who gets mailed): the PR is HELD for an independent review.** It deploys `platform`, so it MERGES ALONE.
Your deps have landed when you start: club-apply-platform (train T4: reminder mail off the sign-in quota, the mail budget sized from the
plan register, the Resend usage reader) and growth-codes (win-back offers). STOP and report if T4's budget code is missing at your base.

**Owner direction (2026-10-02):** "Our main goal is maximum profits margins". The lead decided: activation and win-back e-mails on the
existing mail rail; no mail-plan upgrade unless the volume demands it (the upgrade is money: the owner's yes at that moment).

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 9: "Renewal-reminder **email** plus a private **calendar feed**: #1033 ... `services/platform/src/routes/reminders.ts` (RFC 8058
  one-click unsubscribe) ... Mail port: #1128." "Onboarding/activation and win-back email: **MISSING**. ADR 029's listmonk was planned and
  never built ... Dunning and win-back are DECIDED-AGAINST: not-built/02, 'the merchant of record is the legal seller and sends the
  transactional payment mail', reversed by 'Retention work being scheduled (stage 13)'."
- Ranked gap 9: "**Lifecycle email.** Activation nudge (day 1/3), lapsed-user win-back, plus the T-11 notices already queued. Runs on the
  mail port (#1128) with `ConsentPurpose.promo` and gates R13-03/R13-04 ... Retention. not-built/02 says the dunning/win-back cut reverses
  when 'retention work being scheduled', and reminders are now that work." That trigger has fired.
- ADR 041 (sites audit, verbatim): "**Nothing may send to a campaign recipient** until ... the site's three unbacked *'unsubscribe anytime'*
  promises ... and the **owner-signed privacy marketing section**." The privacy policy is now the agent's (owner delegation 2026-10-01),
  so this lane writes that section itself, after lane dpdp-rights' bump (your deps put you after it).

## Do (each with a red control that fails without it)
1. **Consent first.** Lifecycle mail goes only to account holders who opted in to the promotional purpose (`ConsentPurpose.promo`), with
   GPC honoured; the opt-in is a Settings toggle (off by default) through the chassis, recorded as a consent artifact. Never the
   launch list (ADR 087's sign-ups are a separate list). Red: a user without the promo consent gets nothing; a GPC signal blocks it.
2. **Activation nudge.** Day 1 and day 3 after sign-up, only if the user has not reached the app's activation event
   (`services/platform/queries/insights/01-activation-rate.sql` defines it), each pointing at the one next step; stop as soon as they
   activate. Red: an activated user on day 3 gets no mail; a non-activated one gets exactly two over the window.
3. **Win-back.** Lapsed users (no authenticated use for 30 days, or a cancelled paid plan) get at most two mails 30 and 60 days apart;
   lapsed PAID users may carry a growth-codes win-back offer (above the cost floor; never AI credits). Use a "last seen" signal the system
   already keeps; if none exists without new tracking, add the least one (a date, no events) with a migration ALONE and say so.
   Red: a third win-back mail is never sent; an offer below the floor is refused by growth-codes' guard.
4. **Inside the plan, behind the reminders.** Lifecycle mail draws from the same mail budget as reminders but only from what reminders
   leave: a renewal reminder is never delayed or dropped for a lifecycle mail; at 80 % of the plan's monthly budget lifecycle mail pauses
   and the usage alarm pages the owner. Never upgrade the plan from code. Red: a fixture day where reminders use 95 % sends zero lifecycle mails.
5. **Every mail: localised, honest, stoppable.** The user's stored locale through the per-locale e-mail templates (English fallback); the
   user's local hour rule from T4; one-click unsubscribe (RFC 8058, the reminders route's mechanism) and the suppression list through the
   mail port; the sender from the entity source; no tracking pixels and no click tracking. Red: a sent fixture has the List-Unsubscribe
   headers and no remote image; an unsubscribed address is never mailed again.
6. **The privacy marketing section.** A short section in `sites/nikatru/privacy.html` (and each app's notice through `privacy.yaml` and the
   renderer): what lifecycle mail is, that it is opt-in, how to stop it; inventory rows in `data-inventory.json`; version bump plus snapshot
   in the same commit. Red: the inventory row without the notice line fails the itemised-notice guard.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- Reminder delivery, the weekly digest and Pro channels (T4 landed; T19 `train/st-pro-channels` may be open: if its PR is open at your
  base, STOP and report so the lead orders the two); the mail port's shape (call it).
- Terms and refund wording (the OWNER's, ADR 031 class B, ADR 100); `sites/nikatru/{terms,refund,pricing}.html`; money routes and the
  offers register (growth-codes); AI files; the i18n pipeline internals (branch `i18n/pipeline`); the merge orchestrator (branch
  `ci/merge-orchestrator`).

## Rows
NEW O-LIFECYCLE-MAIL-UNBUILT (closes here). Exactly one `Rows:` line.

## Deploys
`platform` (migration ALONE first if any), the apex site unit (`nikatru-site`, the privacy section) and `subscriptiontracker-web` (the
toggle), as `tooling/ci/lane-map.json` names them. Say which Workers the merge redeploys (ci-07).

## Lead steps (not run here; list them in the PR body)
Turn the lifecycle schedule on after the review; a mail-plan upgrade, if the volume ever demands it, is the owner's money yes at that moment.

## Rules (every lane)
- Pipeline-first: the lifecycle engine is platform-level and per-app by configuration; a new app gets it by stamping.
- Feature parity: the opt-in toggle is on all seven targets (web, Android, iOS, macOS, Windows, Linux, apps.gov.in) in this PR.
- Privacy-minimal: no pixels, no click tracking, the least "last seen" signal. Adults only (ADR 068). AI is paid only.
- Never print a secret or an address. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, the mail vendor's
  console, or dispatch a workflow from the cloud: list each under "Lead steps". Never merge. Never `--no-verify`. Never edit Private.
  Generated files are regenerated with their generators.
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (the consent, policy-archive, retention and ceiling guards). LAST: `assert-guard-coverage.mjs`; commit its ratchet row.
- The PR body is complete before the first push (`Rows:` once, `Deploys:`, one row per Do item with its red control, "HELD for review
  (user data)", the Lead steps, the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash. git-09/git-10: root `pubspec.lock`; use melos.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- Frozen records: privacy snapshots under `sites/nikatru/legal/` are never edited; a new one lands with the bump.
- ci-49 (sites): after any `sites/**` change run `node tooling/sites/generate-discovery.mjs`, then
  `node tooling/ci/check-site-integrity.mjs . sites/nikatru sites/rajasekarselvam`, and commit what they write.
- vacuous-03: redden every new check. grep-17: cite by anchor. ci-07: name the Workers redeployed.
- agents-03: absolute paths only. agents-21: do not spawn agents.

---

## MEMBER 4 of 4: help-ai-chat (P2.5; original brief help-ai-chat-2026-10-02.md)
> LEAD ADDITION: It comes LAST in this club so its privacy-notice rows follow dpdp-rights, growth-codes and lifecycle-mail (dep-flatten gap 1).

# Lane help-ai-chat [Opus 5.5 · high · Acct1 · Cloud]: a help chat for Pro users that the customer pays for, grounded in the help articles and labelled as AI

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `help/ai-chat`, one PR in Public, from an up-to-date origin/main.
**Paid-API and money path: the PR is HELD for an independent review.** It deploys `platform` and the web app, so it MERGES ALONE.
Your deps have landed when you start: lane help-search (the `HelpAssistant` seam, the help index) and train T17
`train-st-ai-customer-pays` (the AI credits meter, bring-your-own-key, consent). STOP and report if either is missing at your base.

**Owner direction (2026-10-02):** "Our main goal is maximum profits margins". Owner lock 2026-10-01: "If using AI ... it should come
from customer pocket." Lead lock 2026-10-01 (AI decisions delegated): "There is NO free AI anywhere: no trial credits, no free tier, no
'first N free'"; "choose the CHEAPEST model that meets the quality bar for each feature ... measure the quality in tests"; "cache
wherever repeat inputs allow"; credit packs priced "at least 4x our measured model cost per unit, AFTER the store commission (30% where it
applies), the GST and the payment-rail fee".

**Why:** help-search answers most questions at $0. A conversational answer is worth paying for to some Pro users; it earns margin on the
credits meter and costs us nothing for everyone else.

**EU AI Act Art. 50 (pipeline capability audit, 2026-10-02, verbatim):** "Applies **2 Aug 2026** ... **Yes once AI ships to EU users.**
The EC FAQ says a company integrating a third-party model into its app is the **provider** of the resulting system ... **Verified**: [EC FAQ
on Article 50](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) ('Article 50 of the AI Act
applies as from 2 August 2026')." A chat is the plainest case of Art. 50(1): people must be told they are interacting with an AI system.
Re-read the article text and the FAQ at your base and record `readAt` in the PR body.

## Do (each with a red control that fails without it)
1. **`AiChatAssistant` behind the seam**, shown only when the config flag is on AND (the user has Pro AND AI credits, OR has set their own
   key). A Free user without their own key sees search only. Red: Free without a key -> no chat entry; Pro with zero credits -> the plan
   or credit-pack prompt, never a call.
2. **The server route `POST /v1/ai/help-chat`** on the AI port (`aiFor('help')`; add `help` to the per-feature model map in
   `tooling/ports/ai.json`), metered exactly like T17's features: reserve one credit BEFORE the model call, settle with actual tokens,
   refuse at zero, per-user daily cap, the global daily spend breaker and the kill switch. Red: the counting stub sees 0 calls for every
   refusal (no plan, no credits, cap, kill switch).
3. **Grounded answers.** The server retrieves the top articles from the same help index for the user's locale and app, sends only those
   as context (stable system prefix cached), and the answer cites the article links. Out-of-scope questions get a short refusal with the
   "ask us" button. The model never gets tools, never acts on the account, never follows links. Red: a stubbed answer without a citation
   is rejected by the response validator; a prompt-injection question ("ignore your rules ...") yields the scoped refusal.
4. **Cheapest model that passes, measured.** A quality-bar test over at least 30 recorded question/answer fixtures (citation correct,
   no invented feature, no price, no refund or terms restatement) run against the candidate models through recorded fixtures; set the
   cheapest that passes in `tooling/ports/ai.json` and record tokens per call. The credit price for a chat message comes from
   `port-switch.mjs ai --dry-run`'s floor; never type a price below it. Red: the dry-run fixture's floor matches a hand computation.
5. **Art. 50 transparency.** At the first interaction, a clear notice that this is an AI assistant, that answers can be wrong, and how to
   reach a person (the report-a-problem sheet); every AI message carries a visible "AI" label and a machine-readable marker
   (`generated_by: "ai"`, provider, model) in the response and in any copied or exported transcript. Both are accessible (announced to
   screen readers, not colour-only). Red: a widget test fails without the first-use notice; a response without the marker fails the
   route test.
6. **Bring your own key works too** (through `packages/ai_byok`, the key only in the device's secure store, the same grounding with the
   bundled index; our server never sees the key or the content). Red: with a key set, no request reaches our chat route.
7. **Privacy.** Chat content is not stored server-side and never logged; the meter keeps token counts only; the opt-in naming the processor
   (T17's consent) is required before the first call; data-safety, App Store privacy answers and the privacy policy rows follow T17's.
   Red: a log-capture test finds no message text after a chat call.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- The meter, the ledger, credit packs and their prices, the consent screen (T17's); the port's shape and the Anthropic adapter (port-ai):
  call them, never change them; if a change is needed, STOP and report it.
- `sites/nikatru/**` (no site chat), terms and refund wording (the OWNER's, ADR 031 class B, ADR 100), money routes, the i18n pipeline
  internals (branch `i18n/pipeline`), the merge orchestrator (branch `ci/merge-orchestrator`).

## Rows
NEW O-HELP-AI-CHAT-UNBUILT (closes here). Exactly one `Rows:` line.

## Deploys
`platform` and `subscriptiontracker-web` (as `tooling/ci/lane-map.json` names them); native targets through CI builds. Say which Workers
the merge redeploys (ci-07).

## Lead steps (not run here; list them in the PR body)
Turn the `help.aiChat` flag on per channel after the independent review; the console spend limit stays as T17 set it.

## Rules (every lane)
- Pipeline-first: the chat lives in `packages/help` and the server port, so every app and the brick inherit it. No new colour, size,
  radius or spacing constant.
- Feature parity: all seven targets (web, Android, iOS, macOS, Windows, Linux, apps.gov.in) in this PR, or the body names the target that
  waits and the proof (web bring-your-own-key needs each provider's documented browser access; otherwise `unsupported`).
- Privacy-minimal. Adults only (ADR 068). AI is paid only: bring-your-own-key, or our key on paid credits or a paid plan, metered,
  hard-capped, priced at least 4x measured cost after fees; never a free tier, trial credits or "first N free", including during a trial.
- **Never call a live model in this lane:** recorded fixtures and the stub only.
- Never print a secret or a key. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, or dispatch a workflow
  from the cloud: list each such step under "Lead steps". Never merge. Never `--no-verify`. Never edit Private.
- Generated files are regenerated with their generators (`--check` makes a hand edit red).
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (including `assert-paid-calls-metered.mjs` and `assert-ports.mjs` if present). LAST: `assert-guard-coverage.mjs`; commit its row.
- The PR body is complete before the first push (`Rows:` once, `Deploys:`, one row per Do item with its red control, "HELD for review
  (paid API)", the Lead steps, the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash. git-09/git-10: root `pubspec.lock`; use melos.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- vacuous-03: redden every new check. vacuous-08: a test asserting a vendor default proves nothing (set the opposite first).
- vacuous-10/11: match CALLS, not imports. grep-17: cite by anchor. ci-07: name the Workers redeployed.
- Claude API: use only the exact model ids the port registry lists; check `stop_reason` before reading content; structured outputs, not
  forced tool choice.
- agents-03: absolute paths only. agents-21: do not spawn agents.

---

## LEAD ADDENDUM (2026-10-02 20:30Z): two English-notice gaps + Tamil for the new version
- The lead's Tamil legal review (research/session-2026-10-02/tamil-legal-review-2026-10-02.md, section "gaps in the English notice")
  found 2 DPDP gaps in sites/nikatru/legal/2026-09-26/en/privacy.html. dpdp-rights fixes both in the new notice version it creates.
- When this club bumps the notice version, it ALSO adds the Tamil (ta) and Hindi (hi) files for that version, translated clause by
  clause from the new English (the lead reviews them at the delta review), so no supported locale falls back to an older notice.

### The English-notice observations (inlined from the lead review, section 5)
## 5. English-source observations (not translation findings; a faithful Tamil inherits them)

**E1. Consent by use.** Three English sentences treat use as consent:
- "By using our Services you agree to this Policy"
- "By using the Services you consent to this processing" (section 10)
- "Continued use … means you accept the updated Policy" (section 11)

DPDP s.6(1) requires consent to be given by a clear affirmative action. A notice is something a person is
informed by, not something they agree to by using a service. The Tamil above translates these sentences
faithfully. If the lead changes them, change the English first and bump the version.

**E2. DPDP notice contents that are missing.** The English names access, correction, deletion and withdrawal. It
does not name:
- grievance redressal with the fiduciary (s.13)
- the right to nominate (s.14)
- how to complain to the Data Protection Board of India

DPDP Rules 2025, rule 3, ask the notice to describe how a Data Principal may withdraw consent, exercise rights and
complain to the Board. The support@nikatru.com address does serve as the s.8(9) business contact.

---


## LEAD ADDENDUM 2 (2026-10-02 21:30Z): make the translation-lag limb FAIL
PR #1173 left `tooling/ci/assert-policy-archive.mjs`'s lag limb (an English notice version with no reviewed ta translation) as a PRINT
("TRANSLATION BEHIND") pending the lead's decision. LEAD DECISION: in THIS club, in the same commit that adds the ta and hi notices for
your new notice version, flip the lag limb to FAIL for every supported notice locale (ta, hi), with its red control (an English bump
without the translation -> exit 1). After that, no English bump can silently leave a locale on an older notice.
