# The five decision numbers — `[pipeline 11]E-11`

The taxonomy in `company/requirements/analytics-events.md` exists to produce **five numbers**.
Until now nothing in the tree could produce any of them: `services/platform/src/routes/` holds
`config.ts` and `events.ts` only, so **nothing reads the `events` table**, and the four indexes
shipped in advance for these very queries (`migrations/0002_analytics.sql:58-63`, whose comment
already says *"the ~5 dashboard numbers"*) had never served one.

This directory is the answer, in the cheapest durable form: **five checked-in `.sql` files and a
test that runs them against the real migrations on a real SQL engine and asserts an exact number**.
Queries, not a dashboard product — deliberately not reversing the Evidence.dev cut
(`39-CHASSIS` §4 cut 15). A `/insights` route can be built on top of these later; the requirement is
satisfied by the tested query set alone.

## The five decision numbers

> 🔴 **THIS LIST IS PARSED BY A TEST.** `test/insights-queries.test.ts` reads the numbered items
> below and requires each one to have a `.sql` file *and* an asserted expected value. The trailing
> `` → `file` (`id`) `` on every line is machine-read, so keep the shape. **Do not "simplify" the
> list by deleting an entry** — the test's floor is `REQUIRED_COVERAGE.length`, derived from this
> list, precisely so that a shrinking set of questions is `COVERAGE LOST` rather than a smaller
> green run. This repo has already shipped a scanner that silently dropped from 5 files to 4 and
> reported PASS.

1. **Activation rate** — % of the new-install cohort that emits `activation` (taxonomy stage 3, the
   per-app "aha"). → `01-activation-rate.sql` (`activation_rate`)
2. **Retention** — the D1 / D7 / D30 `return_visit` curve for a first-launch cohort (stage 6).
   → `02-retention-d1-d7-d30.sql` (`retention_d1_d7_d30`)
3. **Paywall conversion** — `paywall_viewed` → `checkout_started` → `purchase_success` (stage 5).
   → `03-paywall-conversion.sql` (`paywall_conversion`)
4. **Notification lift** — return rate of installs that opened a notification vs installs that did
   not, alongside the `notif_opt_out` counterweight (stage 6).
   → `04-notification-lift.sql` (`notification_lift`)
5. **Feature adoption** — the `feature_used{name}` distribution across active installs (stage 4).
   → `05-feature-adoption.sql` (`feature_adoption`)

The wording and the ORDER above mirror `company/requirements/analytics-events.md`
§ *"The ~5 numbers these roll up into (the actual dashboard)"*. That document is the SSoT and it is
**gitignored** — it never reaches CI — so this file is its public mirror and the test enforces the
mirror in both directions **whenever the private tree is present** (i.e. on every developer machine,
never on a runner). Read `test/insights-queries.test.ts`'s `NOTICE` line to see which of the two
checks actually ran.

## Calling convention

Every file is a single `SELECT` taking the same three positional parameters, in this order:

| # | Parameter | Meaning |
|---|---|---|
| `?1` | `app_id` | one app. These are **per-app** numbers; a portfolio total is a different question |
| `?2` | `window_start` | **inclusive** ISO-8601 UTC, e.g. `2026-01-01T00:00:00.000Z` |
| `?3` | `window_end` | **exclusive** |

`server_ts` is the edge receipt clock and the authoritative cohort clock — `client_ts` is
user-settable, offline-queued and skewed, so no query here touches it. ISO-8601 UTC strings sort
lexicographically, which is why `>=` / `<` on TEXT is a correct time comparison and no date parsing
happens on the hot path (the same reason `src/scheduled.ts:264` compares `server_ts >= ?` directly).

`?1` appears more than once in most files. That is SQLite's numbered-parameter form and D1 binds it
positionally exactly as `node:sqlite` does — three bound values, however many times each is
referenced.

## 🔴 What a green test here does and does not prove

It proves the SQL is **correct**: given known rows, each query returns the number a human computed
by hand from those rows, against the schema that actually ships (`?raw` imports of the real
migrations).

It does **not** prove the numbers are **meaningful**. `platform_db.events` holds **0 rows in
production** (E-4a). Every query in this directory returns `NULL` for its rates and `0` for its
counts against that table today, and the test asserts exactly that as its first case — a `0%`
activation rate would be a claim that nobody activated, which is a different and false statement
from "there is no cohort". Making the rail carry traffic is **E-4a**, and noticing when it stops is
**E-13**. Neither is this file's job, and neither is implied by it passing.
