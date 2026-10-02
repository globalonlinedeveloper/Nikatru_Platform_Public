# CLUB club-rt-money (lead 7185eb, 2026-10-02): 4 roadmap lanes in ONE branch and ONE PR
Owner deadline: everything complete by 2026-10-04. Implement the members below IN THIS ORDER on one branch, one PR, at least one
commit per member whose subject starts with the member lane name. Where a member brief says "your deps have landed / STOP and report if
<dep> is missing" and <dep> is an EARLIER MEMBER of this club, that dep is satisfied by the earlier commits on this branch: do not stop.
A member that cannot go green after ONE root-cause fix is DROPPED: revert its commits, list it in the PR body under "Dropped", and the
rest still land. Prefer the smallest correct implementation of each member's done-definition; never skip its red controls.
PR title: "Club club-rt-money: train-st-ai-customer-pays, refund-finish, margin-dashboard, crash-rates". The PR body lists, per member, its Rows and Deploys lines.
This club is HELD for an independent review before landing (money path).

---

## MEMBER 1 of 4: train-st-ai-customer-pays (P3; original brief train-st-ai-customer-pays.md)
# Lane train-st-ai-customer-pays [Opus 5.5 · xhigh · Acct3 · CLI]: T17 · AI import and AI review, paid by the customer only: a metered credits ledger with hard caps and a kill switch, bring-your-own-key, a Pro allowance and credit packs priced above cost, explicit consent, and a guard row that proves it

Written by lane audit-st-every-page for lead db0cc7 on 2026-10-01. One PR in Public, branch `train/st-ai-customer-pays` from an up-to-date origin/main. **Money and user-data path: the PR is HELD for an independent review.** Deploys `platform` (migration ALONE first) and `subscriptiontracker-web`; merges alone. **GATED: launch only after the lead writes `lead-1m/lwld-gate-ai-owner.out` with `land exit=0`, i.e. after the owner's yes to the three owner steps below.** Local because the API key lives in the vault. Nobody can answer mid-run.

**Owner lock (2026-10-01, verbatim):** "If using AI ... it should come from customer pocket." Allowed shapes ONLY: the user's own key (BYOK), or OUR key on a PAID plan or paid credits, metered, hard-capped, priced above cost. **No free AI: no free tier, no free trial, no "first N free" — including during any Pro trial.**

**Why (priority 3; 6 gaps: IM-10, AI-01..05).** At origin/main 2cb56ac3 no code calls any AI (verified by five greps over apps, packages, services, extensions, sites, every wrangler config, every manifest and lockfile). On-device OCR would cover only Android, iOS and macOS; an AI import works the same on all seven targets, so it is the parity-correct way to "snap a receipt" — and it is a paid line with margin. The market puts every AI feature behind money (Rocket Money Premium+, Subby PRO) and meters none visibly.

## Preconditions (OWNER steps; an agent prepares each and performs none)
1. An Anthropic API key for the business, with a monthly spend limit set in the console, stored in the vault (`ANTHROPIC_API_KEY`, name only in code).
2. Store products for credit packs (consumables: App Store, Google Play; web through Paddle; India web through Razorpay when its adapter lands) at the ratified price.
3. Ratify the price: proposal 25 AI imports for $1.99 / ₹179, Pro allowance 20 per month (ADR no.NNN). Worst-case model cost at `claude-opus-5-5` is $0.022 per image import → 60-67 % margin after store or Paddle fees.
- After train T6 (the paid-calls guard) and train T13 (the Import hub's review list, which AI candidates join).
- Model: `claude-opus-5-5` by default, selectable in config; use the official Anthropic SDK for the platform Worker's language (TypeScript `@anthropic-ai/sdk`), structured outputs for the candidate rows; check `stop_reason` before reading content.

## Patches (each with a red control that fails without it)
1. **The meter (AI-01).** Platform D1 (migration ALONE): `ai_credits` (user, app, balance, monthly allowance, period) and `ai_calls` (reserve id, job, tokens in/out, cost, settled). Reserve one credit BEFORE any model call; settle with actual tokens after; refuse at zero; a per-user monthly cap; a global daily spend cap and a kill switch in config (`ai.enabled`, `ai.daily_usd_cap`). Red: a Free user → 402 `ai_requires_plan`; a Pro user in a trial → 402; cap reached → 402; kill switch → 503; no model call is made in any refusal (a counting stub sees 0).
2. **Bring your own key (AI-02).** Settings › AI: the user pastes their own key; stored only in the device secure store; calls go from the device directly to the provider (web: the provider's documented browser header); our server never sees the key or the content; available on any plan. Red: with a BYOK key set, no request reaches our AI route; the key never appears in logs, analytics or crash reports.
3. **AI import (AI-03, IM-10).** `POST /v1/ai/import` (authed, metered): an image or e-mail text in, structured candidate rows out (name, price, currency, cycle, next date, confidence) into the Import hub's review list — never auto-saved; the image is never stored. Red: a fixture receipt image (stubbed provider) yields one candidate; the request body is not persisted anywhere.
4. **Allowance and packs.** Pro gets the monthly allowance (hard cap, reset monthly, none during a trial); packs credit the ledger only on a verified purchase webhook / receipt (the existing `POST /v1/money/:provider` and `POST /v1/receipts/:store` paths), idempotent. Red: a replayed webhook credits once; a refunded pack removes its unspent credits.
5. **Consent and disclosure (AI-05).** Before the first call, an explicit opt-in that names the processor (Apple 5.1.2(i)), with a link to the privacy notice; data-safety (`store/android-play/data-safety.json`), App Store privacy answers and the privacy policy gain the rows; the listing guard from train T6 passes only with the customer-pays row. Red: no call without a recorded opt-in; the listing guard fails without the row.
6. **Review my subscriptions (AI-04).** One metered call over the user's own list (no browsing): keep / review / cancel suggestions with reasons; never acts on its own. Red: the call is metered like import; output is advisory only.
7. **The guard row.** `tooling/paid-calls.json`: `api.anthropic.com`, `kind: ai-inference`, `payer: customer`, `gate` anchors at the reserve call and the plan check. Red: removing the gate anchor makes `assert-paid-calls-metered.mjs` exit 1.
8. **Proven.** Worker tests with a stub provider for every refusal and success; client tests for BYOK isolation; E2E (web) with the stub: import an image as Pro, see the candidate, add it; a Free user sees the plan prompt.

## Rows
NEW O-ST-AI-CUSTOMER-PAYS-RAIL (closes here).

## Deploys
`platform` migration ALONE, then the Worker, then `subscriptiontracker-web`. Merges alone. Store products are the owner's.

## Dart parts
CI runs them; locally only if the pinned Flutter is present (trap O-HOST-FLUTTER-BELOW-THE-PIN).

## Traps (quoted; auto-memory is not loaded into a lane — trap agents-01 — so these lines are the traps you know)
- git-01: `git show <ref>:<path>` under Git Bash is mangled by MSYS path conversion and exits 128 with empty stdout, which reads as "absent" — prefix `MSYS_NO_PATHCONV=1`.
- git-09: any `flutter` command in a subdirectory rewrites the root `pubspec.lock`, and `git add -A` then commits it; run `flutter pub get` at the root on the pinned SDK; never commit a stray lock hunk.
- git-10: `flutter analyze` in one package is not the workspace and reports 0 errors on a tree that will not compile; run melos over the workspace.
- shell-01/02: `$?` after a pipe is the last stage's status, so a failing guard reads 0; capture `code=$?` on its own line.
- shell-10: a backtick inside `node -e "..."` is command substitution and runs first; write scripts to a file.
- grep-17: cite code by anchor (a quoted fragment you can grep), never by line number alone.
- agents-03: a parent's `cd` can move a relative path into a sibling's worktree; use absolute paths only.
- agents-21: do not spawn agents; a lane that fans out ends "completed" with its PR unwritten.

## Rules
- Headless: every command in the FOREGROUND with `timeout`. Never end a turn to wait; never `run_in_background` a push or a CI watch.
- Never `--no-verify`. Never print a secret. Never edit Private. Never merge, never touch the land lock. Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The evidence was read at Public `origin/main` 2cb56ac3 (2026-10-01); main moves. Re-find each anchor at your base first; skip an item already fixed and say so in the body.
- PIPELINE-FIRST (owner lock 2026-09-28): what applies to more than one app goes in `packages/*` or the brick, and the app adopts it; the PR body says why any applicable code stays app-only. The design programme owns colours, type and spacing: use existing design_system tokens and components; no new colour, size, radius or spacing constant.
- FEATURE PARITY (owner lock): a feature ships on all seven targets (web, Android, iOS, macOS, Windows, Linux, apps.gov.in) in this PR, or the body names the target that waits and the proof it waits for.
- CUSTOMER-PAYS (owner lock 2026-10-01): no AI and no per-call paid API on any path we pay for; only bring-your-own-key, or our key behind a paid plan or paid credits, metered, hard-capped, priced above cost.
- Goldens are Linux-only: regenerate through `.github/workflows/update-goldens.yml` after a deliberate visual change, never by hand on Windows.
- Work in a worktree under `.worktrees/`. Run `node tooling/scripts/affected-guards.mjs` before the push; LAST run `node tooling/ci/assert-guard-coverage.mjs` and commit any ratchet row it rewrites (`tooling/ci/test/coverage-manifest.json`).
- The PR body is complete before the first push: `Rows:`, `Deploys:`, one row per patch with its red control, the owner steps named, ending with the 🤖 line — and never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`. Watch ci-gate in the foreground (`gh run watch <id> --exit-status`). On the first red: save the log, ONE root-cause fix. A second red is a STOP.
- Done: ci-gate green, CodeQL green, `node tooling/ci/assert-paid-calls-metered.mjs` green. Report in at most 8 lines.

## LEAD ADDENDUM (2026-10-01 03:35Z): the owner delegated every AI decision to the lead; it is LOCKED as maximum margin
**Owner, verbatim:** "For the AI features ... You decide, work faster and intelligence, only this is max margin profits - lock this".
The owner gate is OPEN: `lwld-gate-ai-owner.out` is written. The lead's decisions:
- **Modes:**
  - bring-your-own key (the user's own provider key, stored only on the device and encrypted; we pay nothing);
  - OUR key, on a PAID plan or paid credit packs.

  There is NO free AI anywhere: no trial credits, no free tier, no "first N free".
- **Our key** is the vault's `NIKATRU_ANTHROPIC_API_KEY`, served ONLY from the server, through the secret manifest (fix-secrets-from-pipeline). It never reaches a client.
- **Price (maximum margin):**
  - credit packs priced at at least 4× our measured model cost per unit, AFTER the store commission (30% where it applies), the GST and the payment-rail fee;
  - the price ADR records the cost model per feature: tokens per call, times the model price, times the 4× floor;
  - choose the CHEAPEST model that meets the quality bar for each feature (a small model for parsing and import), and measure the quality in tests;
  - cache wherever repeat inputs allow.
- **Spend safety, in code, not trust:**
  - a hard per-user credit balance (no negative balance);
  - a per-user daily cap;
  - a GLOBAL daily spend circuit-breaker read from config. When it trips, the paid AI calls queue or refuse with a clear message, and ops-watch pages;
  - every call metered to the ledger before the response returns.
- **Provider portability:** the AI port has adapters (Anthropic first; others for bring-your-own key) behind the ports-and-adapters standard (lane plan-portability).
- **Store consumables** (credit packs): CREATE them through the store APIs where the pipeline can (Play Developer API in-app products; App Store Connect in-app purchases), as the pipeline's store config. They stay inactive or unpublished until the release. Never publish anything.
- **The Anthropic console spend limit:** set it through the Admin API if the vault has an admin key. Otherwise write the exact console step into the owner checklist for the final publish sitting; the code-side global breaker protects us until then.


## PORTABILITY ADDENDUM (lead 2026-10-01): from plan-portability, the owner's plug-and-play lock

# ADDENDUM to lane train-st-ai-customer-pays (T17) (from lane plan-portability, 2026-10-01): build the features and the meter on the AI port

For the lead to append to `st-every-page/dispatch/briefs/train-st-ai-customer-pays.md` under its LEAD ADDENDUM.

**Queue edit:** add the dep `lwld-apply-port-ai.out` (`dispatch/queue-edits.json`). The lead's addendum already says
"the AI port has adapters ... behind the ports-and-adapters standard (lane plan-portability)"; lane port-ai builds that
port first, with no feature and no meter.

**At your base:**
- the server port `services/_shared/src/ports/ai.ts` (`AiProvider`, `AiCostModel`, a `beforeCall` hook for the
  reservation);
- the Anthropic adapter on `@anthropic-ai/sdk`, our key by name `NIKATRU_ANTHROPIC_API_KEY`, server-only. With no
  `beforeCall` wired it refuses `unavailable`;
- the counting stub;
- the suite `services/_shared/test/conformance/ai.ts`;
- the client package `packages/ai_byok` (Anthropic, OpenAI and Gemini adapters, the key in `SecureStore` only);
- `tooling/ports/ai.json`, with the model per FEATURE deliberately null;
- `port-switch.mjs ai --dry-run`, which prints the minimum credit price per feature and channel.
Read `tooling/ports/README.md` first.

**Patch changes (the count stays at most 8):**
- **Patch 1, the meter:** wire `beforeCall` to the reserve-one-credit step. The suite's "a refused reservation makes no
  call" scenario is your red control: the counting stub sees 0.
- **Patch 2, bring-your-own-key:** use `packages/ai_byok` and its adapters; do not write provider HTTP in the app. The
  Settings › AI screen picks the provider from `ai.json`'s client half.
- **Patches 3 and 6, import and review:** call `aiFor('import')` and `aiFor('review')`, never a model constant. **Set the
  model per feature in `tooling/ports/ai.json` from a MEASUREMENT:**
  - run the quality bar test against the candidates `claude-haiku-4-5`, `claude-sonnet-5-5` and `claude-opus-5-5`,
    through recorded or stubbed fixtures;
  - choose the cheapest that passes;
  - record the result and the token counts in the price ADR.
  The lead's lock, "the CHEAPEST model that meets the quality bar ... measure the quality in tests", supersedes this
  brief's earlier default of `claude-opus-5-5`.
- **Patch 4, the price:** quote `port-switch.mjs ai --dry-run`'s floor (≥ 4× measured cost after the store commission,
  GST and the rail fee) in the price ADR. Never type a price below it.



## Lead addendum 2026-10-02 09:55Z: EU AI Act Art. 50 (verified obligation since 2026-08-02) — BOTH sections below apply to this lane (port-ai #1136 is the provider port; the disclosure belongs to the feature)

# ADDENDUM to lanes port-ai (port-ai-local, PR #1136) and train-st-ai-customer-pays (T17): EU AI Act Art. 50 transparency in every paid AI feature

Written by lead 7185eb on 2026-10-02 09:27Z. **Not a new lane.** The lead appends section A under the LEAD ADDENDUM of
`portability/dispatch/briefs/port-ai.md` and section B under the LEAD ADDENDUM of
`st-every-page/dispatch/briefs/train-st-ai-customer-pays.md` (both under `research/session-2026-09-23/`). Lane help-ai-chat already
carries Art. 50(1) in its own brief. No queue edit is needed: neither lane's deps change.

**Owner direction (2026-10-02):** "Always you need to take complete owner ship on everything", "i Approve, you always should do". The
AI decisions were delegated to the lead on 2026-10-01 ("You decide ... only this is max margin profits - lock this").

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- §3: "**EU AI Act Art. 50** (tell users they deal with AI; machine-readable marking of AI-generated output) | Applies **2 Aug 2026**.
  50(2) marking: systems already on the market get until **2 Dec 2026**. | **Yes once AI ships to EU users.** The EC FAQ says a company
  integrating a third-party model into its app is the **provider** of the resulting system. AI import/review is queued (T17, #1136). |
  **MISSING** from the T17 / port-ai briefs (no row names the AI Act; zero corpus hits) | **Verified**: [EC FAQ on Article
  50](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) ('Article 50 of the AI Act applies
  as from 2 August 2026'). Whether the 'assistive / standard editing' carve-out covers receipt parsing is **unverified** and needs the
  lead's or owner's reading."
- §2.1 below the line: "**EU AI Act Art. 50 disclosure + output marking.** S. Fold it into T17 / port-ai before any EU AI launch."

**The lead's reading (decided; do not re-open it):** our AI features are not yet on the market, so all of Art. 50 applies at their launch
(the 2 Dec 2026 grace is for systems already on the market). We are the provider. We do NOT rely on the carve-out for receipt parsing:
labelling and marking every AI output costs almost nothing, is honest, and removes the open question. Paid AI is sold to EU buyers
through Paddle and the stores, so this is in scope from the first sale. Re-read the article text and the EC FAQ at your base and record
`readAt`; if the Commission has published its code of practice on marking and labelling AI-generated content, cite it and align the
marker format with it; otherwise use the fields below.

## A. For port-ai (PR #1136; branch `port/ai`)
If #1136 is still OPEN when this is appended: one fix-forward commit on `port/ai` before merge (the independent review re-checks the
delta). If it has MERGED: section A moves into T17 as part of its patch 1, unchanged.
1. **Provenance on every outcome.** The server port's successful outcome carries `provenance: { generator: 'ai', provider, model, at }`
   (model from config, never a constant); the client `AiProvider` in `packages/core` and every `packages/ai_byok` adapter return the same.
   Red: a conformance-suite scenario "every successful outcome carries provenance"; a mutated stub that drops it fails (server and client
   suites both).
2. **No unlabelled path.** A refusal or a `max_tokens` stop stays an outcome with no rows (unchanged) and no provenance.
   Red: the existing refusal scenarios assert `provenance` is absent.

## B. For train T17 (branch `train/st-ai-customer-pays`)
Fold into the existing patches (the patch count stays at most 8): items 1-3 into patch 5 (consent and disclosure), item 4 into patch 3
and 6, items 5-6 into patch 7 (the guard row).
1. **Disclosure at the first interaction (Art. 50(1) and 50(5)).** The opt-in that names the processor also says, plainly, that the
   feature uses AI, that its results are AI-generated and can be wrong, and that nothing is saved without the user's review. Shown before
   the first call, on every target, announced to screen readers, never colour-only. Red: no call is possible before the disclosure is
   acknowledged (the counting stub sees 0); an accessibility test finds the disclosure in the semantics tree.
2. **A visible label on every AI output.** AI-import candidates in the Import hub's review list carry "Suggested by AI: check before
   saving"; AI review suggestions carry an "AI suggestion" label. Strings through the locale register like every other string.
   Red: a widget test fails when a candidate or suggestion renders without its label.
3. **The bring-your-own-key path is labelled the same.** We are the provider of the system whoever pays the model. Red: the BYOK widget
   test asserts the same label and disclosure.
4. **Machine-readable marking (Art. 50(2)).** A subscription saved from an AI candidate keeps `source: "ai_import"` plus the provenance
   (provider, model, date) in storage and in EVERY export and backup (CSV column, JSON field); review suggestions carry
   `generated_by: "ai"` plus provenance in the API response and in any share or export. Red: an export fixture of an AI-imported row
   carries the field; removing it fails the export test.
5. **The duty row.** `tooling/legal/duty-matrix.json` gains `eu-ai-act-art-50` (applies from 2026-08-02, the EC FAQ as `source`, `asOf`,
   a `verify` that re-reads it), with the lead's reading above as its note. Red: the duty-matrix guard fails the row without `source` and `asOf`.
6. **Enforced for every future AI feature.** Every `ai-inference` row in `tooling/paid-calls.json` names its feature's disclosure string
   key and its marker field; `assert-paid-calls-metered.mjs` (or a limb beside it) fails a row missing either, or whose string key does
   not exist. Red: a fixture `ai-inference` row with no disclosure key exits 1.
7. **Report path.** The existing AI-content report flag (`services/platform/src/routes/report.ts`, Play policy) is reachable from every
   AI output. Red: a widget test finds the report action on a suggestion.

## Rows
NEW O-AI-ACT-ART50-UNADDRESSED: port-ai advances it (provenance); T17 closes it (disclosure, labels, marking, duty row, guard). Each PR
keeps exactly one `Rows:` line; add this id to it.

## Unchanged
Customer-pays (no free AI anywhere: no free tier, no trial credits, no "first N free"); the cheapest model that meets the quality bar,
measured; credit packs at least 4x measured cost after fees; never call a live model in port-ai; T17 stays HELD for an independent
review and merges alone. Never print a key. Never edit Private from a lane.

---

## MEMBER 2 of 4: refund-finish (P1; original brief refund-finish-2026-10-02.md)
# Lane refund-finish [Opus 5.5 · high · Acct1 · Cloud]: the refund policy the owner ratified runs by itself: in-window refunds, prepared manual refunds, reasons shown, cancels executed

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `money/refund-finish`, one PR in Public, from an up-to-date origin/main.
**Money path: the PR is HELD for an independent money review before landing.** It deploys `platform` (a migration, if any, ALONE
first), so it MERGES ALONE. Checkout stays closed; never touch `paywall.enabled`.
Your deps have landed when you start: apply-port-pay (the outbound payments port: `RailOutbound` with `cancel`, optional `refund` and
`reconcile`, the fake rail and the conformance suite), apply-st-money (#1114: manage plan by where paid, delete-dialog billing),
apply-pay-idem (payments idempotency) and apply-india-rail (#1149: the Razorpay adapter). STOP and report if the port is not at your base.

**Owner direction (2026-10-02):** "Our main goal is maximum profits margins", "i Approve, you always should do". The lead decided:
finish refund automation, held for a money review.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 16: "ADR 100 (automated refund and cancel policy). #1064 (a Paddle cancel executes; a refund stays revoked). INV-514. F-23
  entitlement offline grace. `fix-store-rails-live` (P46 ...) is QUEUED and gated on owner A-20." Open rows with **no build lane**:
  "`O-REFUND-IN-WINDOW-UNAUTOMATED` (MF-5: 'NO ROUTE MAKES THE AUTOMATED IN-WINDOW REFUND ADR 100 RATIFIES'), `O-MANUAL-REFUND-UNPREPARED`
  (MF-6), `O-REVOCATION-REASON-UNSHOWN` (MF-7), `O-MONEY-EVENTS-ALERT-NOBODY` (MF-13), `O-CANCEL-EXECUTOR-UNBUILT`,
  `O-ACCOUNT-DELETE-KEEPS-BILLING`." (MF-13 is lane margin-dashboard's.)
- Ranked gap 3: "ADR 100 ratified automated refunds and no route makes one. That is a trust, chargeback and store-policy risk the day
  `paywall.enabled` flips."
- ADR 100 (sites audit, verbatim): "the written automated policy ... IS the published `sites/nikatru/refund.html`"; "That page is owner
  copy under [ADR 031] class B, and this record does not change it."
- 2026 obligation (unverified): EU "withdrawal button" (Directive 2023/2673, new CRD Art. 11a), 19 Jun 2026, "Probably not directly. EU
  consumer contracts run via Paddle (MoR) and the stores, which are the traders ... Confirm that Paddle provides it on its checkout."

## The policy is the page
Read `sites/nikatru/refund.html` at your base and implement EXACTLY what it says (window, eligibility, which rail, how). Never edit it,
`terms.html` or any refund wording: that is the OWNER's (ADR 031 class B, ADR 100). If the code cannot match the page, build the closest
behaviour that is never MORE generous or LESS generous than the page, and list the gap in the PR body as an owner item.

## Do (each with a red control that fails without it)
1. **In-window refund, automated (MF-5).** An authed request route on the platform Worker: checks the page's window and eligibility,
   then `railFor(provider).refund(...)` through the port, idempotent (Idempotency-Key, one refund per payment), revokes the entitlement
   as today and records a money event. Per rail: Paddle and Razorpay through their adapters; Google Play through its developer refund API
   if the port's Play adapter declares `refund`; Apple and the other stores: the app opens that store's own refund route (the store is the
   seller; we never promise a refund we cannot make). Red: a request one day past the window is refused; a replay refunds once; the fake
   rail's refund scenario passes the conformance suite; a rail without `refund` gets the store route, never a 500.
2. **Manual refund, prepared (MF-6).** `tooling/ops/refund.mjs` builds the exact refund for a goodwill case (rail, payment reference,
   amount, reason) and prints it as a dry run; it executes ONLY with `--execute` plus a confirmation token the lead types, never in CI, and
   records the money event. Red: without `--execute` no network call is made (stubbed fetch sees 0); under `GITHUB_ACTIONS=true` it exits 2.
3. **The revocation reason is shown (MF-7).** When an entitlement ends by refund, chargeback, cancel or expiry, the app's plan screen says
   which and when, from the normalised vocabulary (`lib/mor/contract.ts`), localised through the locale register (strings in the billing
   package's own ARB set). Red: a widget test per reason; a reason code with no string fails the l10n parity test.
4. **The cancel executor (`O-CANCEL-EXECUTOR-UNBUILT`, server half of `O-ACCOUNT-DELETE-KEEPS-BILLING`).** Queued cancels (a user's
   cancel, an account deletion) run through `railFor(provider).cancel({ when: 'period_end' })`, retried with backoff, idempotent, and
   alert after N failures; a deleted account never keeps billing on a rail we can cancel; for store rails the user is told where to cancel.
   Red: deleting an account with an active Paddle subscription produces exactly one cancel; a failing rail retries then alerts.
5. **The EU withdrawal button (evidence, not code).** Read Paddle's current checkout and buyer-terms documentation and record, with URL and
   date, whether Paddle provides the Art. 11a withdrawal function for EU buyers. Add a duty-matrix row `eu-withdrawal-button` with that
   evidence and the stores' position. Red: the duty-matrix guard fails a row without `source` and `asOf`.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- `sites/nikatru/{refund,terms,pricing}.html` and all published refund or terms wording (the OWNER's); `apps/*.html` text (India rail).
- Store webhook adapters and REFUND_REVERSED handling (fix-store-rails-live, port-store-direct); the payments port's shape (call it; if it
  must change, STOP and report); checkout and `paywall.enabled`.
- `sites/nikatru/privacy.html` and `legal/**` (lane dpdp-rights); AI files (port-ai #1136, T17); the i18n pipeline internals (branch
  `i18n/pipeline`); the merge orchestrator (branch `ci/merge-orchestrator`).

## Rows
O-REFUND-IN-WINDOW-UNAUTOMATED (closes here); O-MANUAL-REFUND-UNPREPARED (closes here); O-REVOCATION-REASON-UNSHOWN (closes here);
O-CANCEL-EXECUTOR-UNBUILT (closes here); O-ACCOUNT-DELETE-KEEPS-BILLING (closes its server half); NEW O-EU-WITHDRAWAL-BUTTON-UNCHECKED
(closes here with the evidence). Exactly one `Rows:` line.

## Deploys
`platform` (migration ALONE first if you add a column) and `subscriptiontracker-web`, as `tooling/ci/lane-map.json` names them; native
targets through CI builds. Say which Workers the merge redeploys (ci-07).

## Lead steps (not run here; list them in the PR body)
The independent money review; the first live refund is watched by the lead; any money action is the owner's per-action yes.

## Rules (every lane)
- Pipeline-first: refunds and cancels go through the payments port and its registry; no route names a vendor. The plan-screen reason lives
  in the shared billing package, so every app and the brick inherit it.
- Feature parity: all seven targets (web, Android, iOS, macOS, Windows, Linux, apps.gov.in) in this PR, or the body names the target that
  waits and the proof.
- Privacy-minimal: money events keep references, never card or UPI details. Adults only (ADR 068). AI is paid only.
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, any vendor dashboard, or dispatch a
  workflow from the cloud: tests use the fake rail and recorded fixtures; list live steps under "Lead steps". Never merge. Never
  `--no-verify`. Never edit Private. Generated files are regenerated with their generators (the rendered ports table: `render.mjs`).
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (`assert-ports.mjs`, the payments conformance suite, `assert-ops-register.mjs`). LAST: `assert-guard-coverage.mjs`; commit its row.
- The PR body is complete before the first push (`Rows:` once, `Deploys:`, one row per Do item with its red control, "HELD for review
  (money)", the owner items, the Lead steps, the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash. git-09/git-10: root `pubspec.lock`; use melos.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- vacuous-03: redden every new check. vacuous-10/11: match CALLS. grep-17: cite by anchor. ci-07: name the Workers redeployed.
- A D1 migration deploys ALONE and first (additive only; D1 never rolls back); say so in the body and keep the code tolerant of the
  column being absent until the migration has run.
- agents-03: absolute paths only. agents-21: do not spawn agents.

---

## MEMBER 3 of 4: margin-dashboard (P1; original brief margin-dashboard-2026-10-02.md)
# Lane margin-dashboard [Opus 5.5 · high · Acct1 · Cloud]: the owner sees net revenue and margin per channel, refunds and chargebacks page him, and every metered vendor has a usage alarm

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `ops/margin-dashboard`, one PR in Public, from an up-to-date origin/main.
Tooling and ops only; no product route changes. Your dep club-apply-platform has landed when you start (it carries train P15's Cloudflare
usage reader and train T4's Resend usage reader, both in ops-watch): STOP and report if either reader is missing at your base.

**Owner direction (2026-10-02, verbatim):** "Our main goal is maximum profits margins". The lead decided: an owner revenue + margin
dashboard (net per channel after fees and refunds, churn, cost per vendor and per lane), refund/chargeback alerts, and a usage-vs-plan
cost alarm for every metered vendor.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 19, "Revenue dashboard", MISSING: "surfaces `missing` 'Admin dashboard: absent; 5 SQL insight queries ... no UI'.
  `O-NET-PER-CHANNEL-BY-HAND` (per-channel net exists only as hand arithmetic in ADR 093 §3). `O-MONEY-EVENTS-ALERT-NOBODY`. Gate R14-12
  (90-day revenue tripwire)." Missing: "An owner-only, read-only money view: MRR/ARR, net per channel after fees, trials, churn, refunds
  and chargebacks, with alerts."
- Ranked gap 6: "Margin-first needs measured net per channel. Today it is hand arithmetic (`O-NET-PER-CHANNEL-BY-HAND`) and a chargeback
  alerts nobody."
- Row 28, "Cost monitoring": "`tooling/ceilings.json` plus `assert-ceiling-budget.mjs` (INV-413 ...); `assert-runner-budget.mjs`; D1 budget
  (#1108). INV-14-35 (polled usage vs ceiling) is suppressed: '**NOTHING RUNS THIS**'." Missing: "One usage-vs-plan alarm covering every
  metered vendor: Cloudflare, Resend, R2, GitHub minutes, Anthropic, Box disks."
- Ranked gap 10: "A breached free-tier ceiling is an outage, and paid tiers are a bill. INV-14-35 says 'NOTHING RUNS THIS'."
- The refund/support admin CONSOLE stays decided-against (not-built/02: "Building an internal tool before the first customer is the exact
  shape 39-CHASSIS §4 exists to refuse"). This lane is a read-only report, not a console.

## HARD RULE: money figures never reach a public log
The Public repo's Actions logs are PUBLIC. Revenue, refunds, chargebacks, prices paid and costs in currency are computed and written only
on the lead's laptop, into a directory outside every git work tree. In CI the readers print percentages of a plan ceiling only.
Red control: the report CLI exits 2 with empty stdout when `GITHUB_ACTIONS=true`, and refuses an `--out` inside a git work tree.

## Do (each with a red control that fails without it)
1. **Readers, read-only, behind one interface** in `tooling/ops/margin/`: D1 grants and money events (read-only query with the credential
   the laptop already uses for D1); Paddle (transactions, adjustments = refunds and chargebacks); RevenueCat (store revenue); Razorpay
   (payments, refunds, fees) when its adapter is on your base. Each reader takes only the keys the vault already holds, by name; a missing
   key makes that channel print `unreadable: <SECRET_NAME>` and the report still renders. Red: a fixture run with one reader's key absent
   renders every other channel and marks that one unreadable.
2. **The money model, from the registers, never typed:** gross per channel; fees from `tooling/catalog/fee-register.json` (store
   commission, Paddle, Razorpay, the RevenueCat cell if present, GST, the UPI merchant charge row if present); refunds and chargebacks;
   net per channel; MRR/ARR normalised by term; trials started and converted; logo and revenue churn per month; cost per vendor (plan
   prices from `tooling/ceilings.json` and the capability register's cost rows, plus measured usage); cost per lane (from an optional
   `--lanes <file>` the lead supplies, schema documented, no Private path in code); margin = net - vendor cost - lane cost. Close
   `O-NET-PER-CHANNEL-BY-HAND` by deriving ADR 093's per-channel net with the same function.
   Red: a fixture with known gross and fee cells produces the hand-computed net to the paise/cent; removing a fee cell exits 1.
3. **The owner view:** one self-contained HTML file plus JSON, written to `--out` (outside any repo): this month, last month, 90-day
   trend, per-channel table, refunds/chargebacks, cost per vendor and per lane, margin, and the R14-12 90-day revenue tripwire state.
   Aggregates only: no user id, no e-mail, no transaction id. Red: a test greps the output for e-mail and id patterns and finds none.
4. **Refund and chargeback alerts (`O-MONEY-EVENTS-ALERT-NOBODY`):** a duty that diffs money events since its last run and pages the owner
   through the existing owner-page path (the notifier the ops tooling already uses; never a new channel) with the count, the channel and
   the response deadline for a dispute. It runs on the laptop (lead-scheduled), not in public CI. Red: two runs over the same events page
   once; a new dispute pages with its deadline.
5. **One usage-vs-plan alarm for every metered vendor (finish INV-14-35):** a `vendor-usage` duty that walks every metered row of
   `tooling/ceilings.json` and calls that vendor's reader: reuse P15's Cloudflare reader and T4's Resend reader; add R2 (storage and
   operations), GitHub Actions (minutes and artifact/cache storage), Anthropic (spend against the limit, through an admin read if the vault
   holds one, else `unreadable`), the Box B/C disks (through the read-only boxes module, laptop only), and the self-hosted GoTrue and
   GlitchTip stores. Amber at 80 %, red at 95 %, and a distinct "next paid tier needed" state. In CI it prints percentages only.
   Red: a fixture at 85 % turns amber; a metered row with no reader fails the guard (coverage is the point: un-suppress INV-14-35 only
   when every metered row has one).

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- `tooling/paid-calls.json`, `assert-paid-calls-metered.mjs`, the RevenueCat fee cell and Resend plan rows: train T6
  (`train/st-margin-guards`, dormant since 2026-10-01). If T6's PR is open at your base, STOP and report; read its cells if present.
- Money routes and the payments port (port-pay-core, refund-finish, fix-store-rails-live, port-store-direct); prices in
  `services/platform/src/app-config-data.json` (India rail #1149); AI files (port-ai #1136, T17).
- `sites/nikatru/**`: nothing in this lane is published. The merge orchestrator (branch `ci/merge-orchestrator`).

## Rows
O-NET-PER-CHANNEL-BY-HAND (closes here); O-MONEY-EVENTS-ALERT-NOBODY (closes at the lead's first scheduled run, not at merge); NEW
O-VENDOR-USAGE-ALARM-PARTIAL (closes here); NEW O-OWNER-MARGIN-VIEW-UNBUILT (closes here). Exactly one `Rows:` line.

## Deploys
None (tooling and ops). If you add an ops-watch duty, it prints percentages only.

## Lead steps (not run here; list them in the PR body)
Schedule the report (weekly) and the money-events duty (hourly) on the laptop with the vault keys; choose the `--out` folder in the
Private research tree; any read key the vault lacks is the lead's call.

## Rules (every lane)
- Pipeline-first: one reader interface in `tooling/ops/`, used by every app's channels; nothing per app.
- Feature parity: every sales channel of all seven targets appears in the per-channel table (a channel with no sales shows zero, never vanishes).
- Privacy-minimal: aggregates only; nothing per user leaves the readers. Adults only (ADR 068). AI is paid only (the Anthropic line is a
  cost against credit revenue).
- Never print a secret or a money figure in CI. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, or
  dispatch a workflow from the cloud: tests use fixtures; list live steps under "Lead steps". Never merge. Never `--no-verify`. Never
  edit Private. Generated files are regenerated with their generators.
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (`assert-ceiling-budget.mjs`, `assert-ops-register.mjs`). LAST: `assert-guard-coverage.mjs`; commit its ratchet row.
- The PR body is complete before the first push (`Rows:` once, `Deploys: none`, one row per Do item with its red control, the Lead steps,
  the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- Every external call carries a ceiling (timeout and a request budget); an unbounded call kills the ops beat.
- Never enumerate the vault by splitting lines on `=`: it prints values. Read keys by name only.
- vacuous-03: redden every new check. grep-17: cite by anchor. agents-03: absolute paths only. agents-21: do not spawn agents.

---

## MEMBER 4 of 4: crash-rates (P2; original brief crash-rates-2026-10-02.md)
> LEAD OVERRIDE (dep flattening 2026-10-02): these deps no longer gate this member; any "STOP and report" line naming them is VOID: margin-dashboard (if it is in this branch, share tooling/ops/register.json).

# Lane crash-rates [Opus 5.5 · high · Acct1 · Cloud]: crash and ANR rates are read from the stores themselves and graded against the lead's thresholds

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `ops/crash-rates`, one PR in Public, from an up-to-date origin/main.
Tooling and ops only. Your dep margin-dashboard has landed when you start (both lanes add ops duties to the same registers): STOP and
report if its `vendor-usage` duty is missing at your base.

**The lead's thresholds (2026-10-02; the owner delegated: "i Approve, you always should do"):** crash-free users at least 99.5 %
(a user-perceived crash rate of at most 0.5 %), user-perceived ANR rate below 0.47 %. Amber inside 80 % of either limit, red past it.
These numbers settle gate R11-05.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 17: "GlitchTip with a PII scrub (`packages/telemetry`), `symbolication-proof.yml`, `tooling/ops/upload-native-symbols.mjs`,
  `upload-web-sourcemaps.mjs`, ADR 090. INV-1118: 'SDK auto-session-tracking is OFF', so **no crash-free rate exists**. Gate **R11-05 RED
  (owner)**: the crash-health threshold must sit below Play's '1.09 % crash, 0.47 % ANR'." Missing: "Cold-start, jank and ANR are measured
  nowhere. The cheapest route is **store-native vitals by API** (Play Developer Reporting API, App Store Connect metrics): aggregated by
  the stores, no new SDK, no personal data."
- Ranked gap 5: "Play's bad-behaviour thresholds cut visibility. There is no crash-free rate today (INV-1118). Store-aggregated data adds no
  SDK and no personal data."
- Cut whose trigger fired: "Per-app performance budgets ... 'A store or an owner decision that names a budget.' Play publishes
  bad-behaviour thresholds (R11-05 cites them)."

## Do (each with a red control that fails without it)
1. **A store-vitals reader, one interface, per store adapter** in `tooling/ops/vitals/`: Google Play Developer Reporting API
   (user-perceived crash rate, user-perceived ANR rate, and the slow-start metric if offered), App Store Connect (the crash and hang
   metrics its API exposes for iOS and macOS), and the Microsoft Store's health data if its API offers a rate; Snap and apps.gov.in print
   `no-source` with the reason. Read each API's current docs and record URL and `readAt` in the PR body; never assume a field name.
   Red: recorded fixtures per adapter parse to the same normalised shape; a fixture with an unknown field fails loudly, never as zero.
2. **No data is not green.** Before an app has enough users the stores return nothing: report `no-data` (grey), never a pass. Red: an
   empty fixture grades `no-data`, not green.
3. **The grade, from a register.** Thresholds live in one register row per metric (`{value, asOf, verify, source}`), with Play's own
   published thresholds recorded beside them for comparison. The duty prints, per app and channel: rate, threshold, grade. Red: a fixture
   at 0.6 % crash rate is red; at 0.42 % (inside 80 % of 0.5 %) amber; removing the register row exits 1.
4. **Wire it as an ops duty using only the credentials that already exist.** The Play service account the store lanes already use and the
   App Store Connect key the store lanes already use, by name from the secret manifest. If a key is not available to ops-watch today, the
   duty runs on the laptop (lead-scheduled) instead; never add a secret. If the Play Reporting API must be enabled on the Google Cloud
   project, that is a lead step; confirm from its docs that it is free (no billing): ADR 033 forbids metered APIs in that project, so if it
   is metered, STOP and report. Red: a missing credential grades `unreadable` with its secret name, never red and never green.
5. **A regression alert.** A channel whose grade worsens between two runs pages the owner through the existing owner-page path, once.
   Red: two identical runs page zero times; a worsening pages once.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- `packages/telemetry` and GlitchTip settings (session tracking stays OFF: INV-1118; this lane adds no SDK); the store submit tools and
  their credentials (store lanes, port-channels); release workflows (club-store-chain, build-provenance).
- The money report and its readers (margin-dashboard) beyond sharing the duty register; AI files; money files; `sites/**`; the i18n
  pipeline (branch `i18n/pipeline`); the merge orchestrator (branch `ci/merge-orchestrator`).

## Rows
NEW O-STORE-VITALS-UNREAD (closes here); gate R11-05 (the lead's thresholds recorded; it goes green on the first real reading).
Exactly one `Rows:` line.

## Deploys
None (ops tooling).

## Lead steps (not run here; list them in the PR body)
Enable the Play Developer Reporting API on the existing project if it is not on (and only if it is free); schedule the duty if it runs on
the laptop; record R11-05's numbers in the Private registers.

## Rules (every lane)
- Pipeline-first: one reader per store in `tooling/ops/vitals/`, every app and channel read by the same code; a new app needs no code.
- Feature parity: every target appears in the report (a store with no source says so), never silently missing.
- Privacy-minimal: store-aggregated rates only; no device, user or crash payload is fetched. Adults only (ADR 068). AI is paid only.
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, the store consoles, or dispatch a
  workflow from the cloud: tests use recorded fixtures; list live steps under "Lead steps". Never merge. Never `--no-verify`. Never edit
  Private. Generated files are regenerated with their generators.
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (`assert-ops-register.mjs`). LAST: `assert-guard-coverage.mjs`; commit its ratchet row.
- The PR body is complete before the first push (`Rows:` once, `Deploys: none`, one row per Do item with its red control, the Lead steps,
  the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- Every external call carries a ceiling (timeout and a request budget); an unbounded call kills the ops beat.
- vacuous-03: redden every new check. vacuous-08: a test asserting a vendor default proves nothing (set the opposite first).
- grep-17: cite by anchor. agents-03: absolute paths only. agents-21: do not spawn agents.
