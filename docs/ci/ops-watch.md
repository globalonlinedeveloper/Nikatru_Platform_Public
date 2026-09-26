# `ops-watch.yml`

The prose that used to live inside `.github/workflows/ops-watch.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

[pipeline O-4] The reader for the run records nothing was reading.

🔴 WHY THIS EXISTS. `platform_db.cron_heartbeat` carried `ok = 0` — "HTTP 401
— REJECTED … no SUPABASE_ANON_KEY configured" — for three consecutive nights,
and `grep -rn cron_heartbeat` across the whole tree returned the DDL, the
INSERT, two comments and a test comment. ZERO READERS. The instrument had
already been repaired and nobody had plugged anything into it. Four independent
duties were failing simultaneously the day this was written, every one of them
had a durable record, and not one of those records had a consumer.

🔴 A DIFFERENT PROVIDER, DELIBERATELY. This runs on GitHub Actions and watches
a Cloudflare cron. A watcher hosted inside the system it watches goes down with
it and reports nothing — which is indistinguishable from "everything is fine".
The one provably complete alarm chain in this portfolio (backup script →
GlitchTip heartbeat → alert rule → email) has exactly this shape; it is being
copied, not reinvented.

SCHEDULE: 07:30 + 19:30 UTC (+ a 08:50 slot). The watched cron runs 06:00 UTC, so this
reads a table that has had 90 minutes to settle — inside the 1.5x staleness
ceiling the reader applies, and far enough after that a slow run is not read as
a dead one.

Required repo secrets: CLOUDFLARE_API_TOKEN (D1 read), CLOUDFLARE_ACCOUNT_ID.
A MISSING SECRET IS A FAILED RUN, NOT A SKIPPED ONE. The reader fails closed on
an absent token, a non-200, or unparseable JSON: "I could not tell" must never
read as "it is fine", which is exactly how the claim it replaces became
unfalsifiable. There is no secretless audience to protect — this workflow has
no `push` or `pull_request` trigger, so it never runs on a fork PR.

### above `- cron: '45 7 * * 1' # Mondays, 15 minutes after the daily run has settled`

[pipeline O-2] The DIGEST slot. A second entry rather than a day-of-week
test inside the job, because `github.event.schedule` reports which cron
fired and that is a fact the workflow can read; deriving "is it Monday"
from a timestamp inside a shell step is a calculation that can be wrong.

### above `- cron: '50 8 * * *' # mid-morning slot (also healed the 2026-08-10 freeze same-day)`

DENSIFIED 2026-08-10 (owner "go", admin-merge #2): one red scheduled run froze every
merge ~18h across two 36h scheduled-only clocks. Two slots halve that worst case.

### above `- cron: '30 0 * * *' # fills the overnight hole`

── DENSIFIED AGAIN 2026-09-02, and the 2026-08-10 note above is the reason
this is a repeat rather than a new idea. The identical freeze recurred and
was WORSE: the last green scheduled run was 2026-08-31T23:15Z, so by
2026-09-02T21:11Z the three duties that read this workflow's run history
had been outside their 36h window for ~46h, and `assert-ops-register`
froze every merge — CI, Deploy Web and Deploy Workers all red — over a
register that was correct and a tree that was already fixed.

🔴 THE MEASURED FACT THAT MAKES FOUR SLOTS TOO FEW, and it is this repo's
own number: GitHub delivers only **10.1% of scheduled runs on time** (899
of 8,928, reproduced against Upptime's repo — research/76 §E). So a cron
slot is not a run; it is a chance at a run. On 2026-09-02 the 19:30 slot
was still undelivered 1h41m later, and the gap since the previous
scheduled fire had reached ~8h. Densifying does not make GitHub punctual —
nothing here can — it raises the number of chances inside the window.

The slots below fill the holes the original three left: the 10h40m gap
after 08:50 and the 12h gap after 19:30. Worst-case spacing goes from
~12h to **3h**, which is what actually shortens a freeze.

⚠️ THE SPACING IS COMPUTED, NOT EYEBALLED, AND THE FIRST ATTEMPT AT IT WAS
WRONG. The 2026-09-02 change claimed "~3h" while actually leaving a FIVE
hour hole at 19:30->00:30 — the number was asserted from a glance at the
list instead of from the arithmetic. Re-derived by sorting the slots into
minutes-of-day and taking the max circular difference; every gap below is
<= 3h. If you add or move a slot, RUN THAT SUM AGAIN — a schedule whose
claimed spacing is not its real spacing is worse than an honest sparse
one, because the next reader trusts the comment.
⚠️ This costs Actions minutes — 3 scheduled runs a day becomes 7. That is
deliberate and it is watched: `assert-runner-budget.mjs` gates MINUTES
against a $0.00 ceiling on every run of this very workflow, so the cost of
this change reports itself rather than being assumed harmless.
⛔ The real fix is NOT more slots. It is to stop depending on GitHub's
scheduler for the alarm clock at all — research/76 §C: a Cloudflare Worker
cron (1-minute granularity) -> D1 -> Resend, with Healthchecks.io as the
watcher-of-the-watcher. Until that exists, this is damage limitation and
should be described as nothing more.

## job `heartbeats`

### above `name: Every declared duty is fresh — the heartbeat rail AND the register`

⚠️ RENAMED 2026-09-04, AND THE OLD NAME WAS A PROMISE THIS JOB DID NOT KEEP.
It read "Every declared cron duty is fresh and reporting success" while
running only the HEARTBEAT readers — the Cloudflare Worker crons that write
platform_db.cron_heartbeat. The two duties that are GitHub SCHEDULES,
duty.workflow.e2e.yml and duty.workflow.build-platforms.yml, were never
examined here at all; they were enforced only in ci.yml's `platform` lane.

🔴 THE FAILURE THAT SHOWED IT: on 2026-09-04 this job reported GREEN at
00:17 while ci.yml reported duty.workflow.e2e.yml RED at 42.6h against its
own 36h window. Both were correct, because they were not the same check —
and the one whose NAME claimed to cover every cron duty was the one that
did not. A green run here read as "every cron duty is fresh" to anybody who
trusted the name.

Fixed in both directions: the register reader is now a step below, so the
schedule-backed duties ARE examined here, and the name says what runs.

### key `permissions:`

### above `permissions:`

assert-ops-register reads GitHub run history for the workflow duties and
the Renovate dashboard issue for duty.renovate's record. Without these two
it does not fail — it reports `unreadable`, which is worse, because the
ceiling absorbs a few and the job stays green while checking less.

## job `heartbeats`

### before step **The whole ops register — every duty, not just the heartbeat-backed ones**

── THE REGISTER ITSELF, ADDED 2026-09-04 ──────────────────────────────

🔴 WHY IT BELONGS HERE AND NOT ONLY IN ci.yml. The register is the one
document that enumerates EVERY duty, and two of them are GitHub
schedules — duty.workflow.e2e.yml and duty.workflow.build-platforms.yml.
Until today those were checked only on a PUSH, by ci.yml's `platform`
lane. A schedule that stops firing produces no push, so the surface most
likely to notice was the one surface not looking, and the watcher built
for exactly that question ran three heartbeat readers and called it
"every declared cron duty".

⚠️ `if: ${{ !cancelled() }}` for the same reason every sibling step
carries it: a failing heartbeat read must not silence the check that
would have told you something else. Its own exit code still fails the job.

⚠️ EXPECT THIS TO GO RED BEFORE ci.yml DOES, and that is the point. It
runs on a clock; ci.yml runs on a push. When a schedule dies, this is now
the one that says so first.

── 🔴 AND SINCE 2026-09-07 IT ALSO NOTICES A **FAILED** RUN, NOT ONLY A
   MISSING SUCCESSFUL ONE ─────────────────────────────────────────────

Coverage unit `alarm-on-red`, [ADR 067] decision 4, closing audit finding
N10 and TRAPS `ci-38`.

**What was wrong, measured in the guard's own source rather than inferred.**
`assert-ops-register.mjs` asked GitHub for `status=success`, and
`assert-platform-proof-fresh.mjs` still does. A failed run was therefore
not ignored by the verdict logic — **it never arrived**. The only thing
that could notice `main` going red was the staleness window quietly
expiring: `duty.workflow.build-platforms.yml` is a `7d` duty against a
`7d × 1.5 = 252h` window, so a failure was invisible for **up to ten and
a half days**, and even then surfaced as *"the newest SUCCESSFUL run is
old"* — which reads like a quiet week, not a broken build. It bit this
repository for three days in the week of 2026-09-01.

**The limb.** `[14]O-3b` in `assert-ops-register.mjs`. For every
`duty.workflow.*` row **on a clock** it reads two more answers at the
same width — the newest `status=success` **and** the newest
`status=failure` run on the row's own `headBranch`, **event filter
dropped on both** — and orders them. A failure newer than the success is
`RED SINCE <date>`, and it routes into the guard's `errors`, i.e. **the
duty is FAILING**, which is the register's own existing word for a record
that says the mechanism failed. The domain size prints beside the verdict
on every run, so `0 RED over 7 workflows` and `0 RED over 0 workflows`
can never read alike.

**Why the event filter is dropped for redness and kept for freshness.**
`duty.workflow.codeql.yml` reads `event: schedule` for its cadence, and
codeql also runs on `push` to `main`. Comparing a `push` failure at T2
against the newest **scheduled** success at T1 < T2 would report RED even
after a later `push` success at T3 > T2 had made `main` green again. A
false alarm on the merge queue is how a guard gets switched off, so both
halves of the redness comparison are read at the same width.

**Where the page comes from.** Nowhere new. A red limb fails this
`heartbeats` job, and on a scheduled run the `alert` job below
(`if: failure() && github.event_name == 'schedule'`) files it against the
durable issue *"Scheduled duty is not reporting healthy"* — within at
most one of the twelve daily slots. `tooling/ops/alarm-chains.json` is
**not** touched: it ledgers GlitchTip monitor → recipient chains, and
this finding does not travel a monitor.

**Why `ci.yml`, `deploy-web.yml`, `deploy-workers.yml` and
`site-drift-repair.yml` are OUT of the domain, stated rather than left to
be discovered.** They are `cadence: trigger` rows. `ci.yml`'s newest run
on `main` can be made green **only by merging**, so blocking merges on it
would be a deadlock with no exit — the `ci-18` bootstrap shape, and this
repository has already paid ~46h of frozen queue for a milder version of
it. Every workflow that IS in the domain accepts `workflow_dispatch`, and
the comparison accepts a success of **any** event, so one dispatched
green run on the branch clears the red without a merge. A red `ci.yml` on
`main` is looked at by the checks on the pull request that produced it; a
red nightly proof was looked at by nobody, and that is the gap this
closes.

**Exit 2 here, not 1.** If a watched workflow has failed runs and **no**
successful run at all, *"is the newest failure newer than the newest
success"* has one term. That is **COVERAGE LOST** — `process.exit(2)`,
per `AGENTS.md` and `C-COVERAGE-LOST-IS-NOT-PASS` — and never a pass and
never a RED. The duty is not unwatched while that holds: the sibling
`[14]O-3` limb still grades *"no successful run at all"* as FAILING.
⚠️ This file's older `coverageLost()` helper exits **1** at all of its
other call sites; that inconsistency predates this limb, is recorded
rather than silently repaired here, and both codes fail CI.

**And no second copy in `assert-platform-proof-fresh.mjs`.** It reads
`build-platforms.yml`'s history independently and also asks for
`status=success`, but `build-platforms.yml` **is**
`duty.workflow.build-platforms.yml`; this limb grades it, and both guards
run in the same `ci.yml` job with the same token. A second copy of the
rule is what `grep-10` forbids, and it would buy nothing.

### before step **Live D1 still runs every statement the Workers send it**

── [pipeline K-7] · DOES LIVE D1 STILL RUN THE SQL WE DEPLOYED? ────────

🔴 THE DEPLOY-TIME CHECK IS NOT ENOUGH ON ITS OWN, AND THAT IS THE WHOLE
REASON THIS COPY EXISTS. deploy-workers.yml runs the same script before
each deploy — but a Worker that is not redeployed for six weeks is a
Worker nothing has re-asked, and the authorizer is D1's, not ours. A
rule that tightens on Cloudflare's side would break every account
deletion in production and the next signal would be a user complaint.
That is precisely the shape the original defect had: 503 on every
deletion for months, every check green, nobody looking.

⚠️ `if: ${{ !cancelled() }}` IS LOAD-BEARING, for the same reason it is
on the step below: a failing heartbeat read must not silence the part
that would have told you. Its own exit code still fails the job.

Exit 1 = D1 refuses a statement we deploy (or a guarded write touched a
row). Exit 2 = nothing was judged, which fails too — an unexecuted sweep
prints the same "ok" as a complete one.

### before step **Judge whether the analytics rail's silence is a FAULT**

── [pipeline 11]E-13 · IS THE RAIL'S SILENCE A FAULT? ─────────────────

The step above asks whether the job RAN AND SUCCEEDED. This one asks the
different question [ADR 035] deliberately kept OUT of `ok`: the analytics
rail produced nothing — is there anything proving it should have? The
writer now records `consents=` beside `events=`, and a consent artifact
arrives on a different route, a different client transport and a
different table, so no break in the events path can silence it.

⚠️ `if: ${{ !cancelled() }}` IS LOAD-BEARING. Without it a failing
heartbeat read skips this step entirely, and "the part that would have
told you is the part that did not run" is the shape this whole file is
written against — the same reason `status` below is its own job. It runs
anyway and its own exit code still fails the job.

## job `status`

### above `status:`

── [pipeline O-2] "IS ANYTHING BROKEN NOW?" — ONE COMMAND, ON A CADENCE ────

🔴 THE THING IT REFUSES TO DO IS THE POINT. Every analytics surface in this
portfolio answers `{"ok":true}` while `events` and `consent_artifacts` hold
ZERO rows, and until 2026-08-11 three of the GlitchTip monitors were `Ping` —
a ping proves a socket opened. So "healthy" here means the surface produced
its EXPECTED OUTPUT, and a data-bearing surface additionally has to return a
non-vacuous body. A green tick over a broken pipe is the specific failure
this stage exists to make impossible.

The probed set is DERIVED from tooling/monitor-register.json — [11]E-9's
enumeration, which is strictly wider than anything restated here. No
hostname literal lives in this repo's ops layer.

⬜ It runs in its OWN job, not as a second step of `heartbeats`. A failing
heartbeat read would otherwise skip the status probe entirely, and "the part
that would have told you is the part that did not run" is the shape the whole
stage is written against. `alert` needs both, so it depends on both.

### before step **Probe every surface the register enumerates**

EXIT 2 IS NOT EXIT 1, AND THE DISTINCTION IS LOAD-BEARING: 1 means a
surface answered wrongly, 2 means nothing was probed at all. Both fail
the job — "I could not look" must never read as "I looked and it was
fine" — but the log has to say which, or the response is a guess.

## job `supabase-drift`

### above `supabase-drift:`

── [pipeline O-4] SUPABASE AUTH DRIFT — the half CI cannot see ─────────────

🔴 WHY THIS JOB EXISTS. tooling/ci/assert-supabase-templates.mjs proves the DR
copies exist and are structurally sound, and assert-mail-transport-claims.mjs
proves the corpus describes the transport consistently. NEITHER CAN SEE LIVE.
Both hold no credential, and both say so on every run. So the one question
that actually matters — "does the live project still match what we recorded?"
— was answered by a script only a human ever ran. A command nobody runs is a
command that does not exist, and this repository has the receipts: the DR
copies went two weeks unchecked and were load-bearing the day it mattered.

BOTH failures this watches are documented and both already happened:
  · 2026-08-04 — a one-field PATCH to /config/auth REPLACED the auth config,
    emptying the whole SMTP block, resetting rate_limit_email_sent 100 -> 2
    and reverting all three branded templates to Supabase defaults.
  · 2026-08-03 — seven repo documents claimed the project was on the
    provider's own sender when it was not, and one audit turned that into a
    false store-submission blocker.
The first is drift the repo can detect. The second is what a record checked
against live prevents from becoming believable.

⚠️ THE MISSING SECRET IS A FAILED RUN, NOT A SKIPPED ONE — and that was a
DELIBERATE REVERSAL of how this job was first written.

It originally tested whether SUPABASE_PAT was set and, when it was not,
printed a ::warning:: and exited 0, on the reasoning that supplying the
secret is an owner action and CI must not block on work only one person can
do. `tooling/ci/assert-green-means-ran.mjs` §B rejected exactly that shape,
correctly: *"A run that discovers it cannot do its job and then reports
success is a green tick over an untested tree — and a `failure()`-gated alert
job cannot fire on it."* That guard exists because e2e.yml gated all nine of
its real steps behind a secret-presence preflight and, once the secret was
rotated, ran one `echo` and concluded SUCCESS for six unattended nights.

The PRINT-DO-NOT-FAIL convention is real, but it belongs to ci.yml, which
gates every push: blocking a developer's build on an owner's console action
is what that convention prevents. THIS WORKFLOW IS SCHEDULED AND GATES
NOTHING. Failing here costs no one a merge; it files one durable issue that
names the owner action — which is the whole point of the `alert` job, and is
what this file's own header already says about the heartbeat reader four
jobs up: "A MISSING SECRET IS A FAILED RUN, NOT A SKIPPED ONE."

So there is NO secret-presence branch. The script is run unconditionally and
its three-valued exit is passed through: 0 in sync · 1 drift · 2 no
credential. The shell below branches on the EXIT CODE, never on the secret,
purely to annotate which of the two failures happened.

## job `prod-provenance`

### above `prod-provenance:`

── [pipeline B-17] PRODUCTION CARRIES NO UNATTRIBUTABLE ROWS ──────────────

🔴 THIS IS THE MONITOR LIMB, AND IT IS HERE BECAUSE IT CANNOT BE ANYWHERE
ELSE. B-17's falsifier is A ROW IN A DATABASE — outside the repository,
behind a credential. `ci.yml` gates every push including from forks, so it
holds no CLOUDFLARE_API_TOKEN and never can; its guard
(tooling/ci/assert-prod-provenance.mjs) can therefore only assert that every
table declares a provenance rule and that THIS job exists. Whether a row
actually fails one is answerable only here. Green here is the weaker claim:
"nothing has contradicted B-17 since the last run".

WHAT IT WAS BUILT AGAINST, MEASURED. On 2026-08-06 platform_db held ONE row
in `consent_artifacts` while 04-backend-platform.md's own B-17 evidence block
still recorded `consent_artifacts` 0, and `cron_heartbeat` 16 where the same
block said 3. Nothing was wrong with either number when it was written; the
defect is that nothing looked again, and a number in a document is not a
check. This job is what looks.

⚠️ IT DOES NOT READ ROWS. Every query is `SELECT <marker>, COUNT(*) … GROUP
BY <marker>` — one declared column and a tally. `provider_notifications`
stores merchant-of-record payloads verbatim (a buyer's name, email address
and billing country), and a monitor that pulled rows into a public log would
be a worse incident than the residue it hunts.

`actions: read` is for the RELEASED-BUILD SET: "traced to a released build"
is resolved against the actual successful runs of the served release lane,
not against a list in a file that would go stale the way B-17's own
four-table prose did.

### key `permissions:`

### above `permissions:`

`actions: read`      — the released-build set comes from the release lane's
                       own run history.
`deployments: read`  — ADDED 2026-08-09. The reader now consults the GitHub
                       Deployment ledger as the SECOND WITNESS for a build
                       whose run failed after its deploy step succeeded
                       (deploy-web run 144); it is also what the
                       manual-deploys.json attestations are validated
                       against. Naming any permission on a job sets every
                       unnamed one to `none`, so an unlisted scope here is
                       a REFUSAL, not a default — and this reader turns a
                       refused read into exit 2 ("I could not look"), which
                       would redden ops-watch every night rather than fail
                       quietly. Granting it is the least-privilege answer:
                       the job genuinely reads deployments now.

## job `prod-provenance`

### before step **Count the rows whose provenance does not resolve**

Same three-valued exit as the two readers above, for the same reason:
2 means the duty did not run, and a run that discovers it cannot do its
job and then reports success is a green tick over an unread database.

## job `runner-budget`

### above `runner-budget:`

── [pipeline F-4 · O-4] THE QUOTA THAT TURNS THE SCHEDULED PROOFS OFF ─────

🔴 assert-platform-proof-fresh.mjs's own header names this failure and then
detects it FOURTEEN DAYS LATE: "a schedule can quietly stop (GitHub disables
scheduled workflows in public repos after a long inactive stretch; a renamed
branch or a QUOTA CHANGE does the same)". When an account passes a spending
limit GitHub stops STARTING runs — the workflow file is unchanged, the cron
entry is unchanged, `gh run list` returns nothing, and that is precisely what
a quiet fortnight looks like. This job reads the CAUSE instead of waiting for
the age check to notice the symptom, by which point the 6-platform proof, the
nightly e2e proof and this alarm chain have all been dark for two weeks.

IT LIVES HERE AND NOT IN ci.yml, for the same reason `supabase-drift` does.
ci.yml gates every push including from forks, so it can hold no account-scoped
credential; and blocking a developer's merge on the owner's billing settings is
exactly what the print-do-not-fail convention exists to prevent. THIS WORKFLOW
IS SCHEDULED AND GATES NOTHING — a red here costs no one a merge and files one
durable issue naming the owner action, which is the whole point of `alert`.

⚠️ `actions: read` IS NOT KNOWN TO BE SUFFICIENT AND THIS JOB DOES NOT PRETEND
IT IS. The billing endpoints are ACCOUNT-scoped; GITHUB_TOKEN is an installation
token scoped to this repository, so `actions: read` has no plan dimension to
grant. It is declared and passed anyway so the FIRST REAL RUN settles the
question in a log rather than in a comment. GH_BILLING_TOKEN — a classic PAT
with `user`, or a fine-grained token with the account-level "Plan" read
permission — takes precedence when the owner creates it. Until it exists the
guard's dated tripwire PRINTS and exits 0; from 2026-09-08 it fails closed.

### before step **Read the Actions usage ledger and compare it to the declared ceiling**

The same three-valued exit as the three readers above, for the same
reason: 2 means the duty did not run, and a run that discovers it cannot
do its job and then reports success is a green tick over an unread ledger.

## job `glitchtip`

### above `glitchtip:`

── [pipeline 11]E-9 · [14]O-6 · THE LIVE HALF, NOW ON A CADENCE ────────────

🔴 THESE FOUR WERE SESSION-ONLY FOR ONE REASON, AND IT IS GONE.
`SESSION_BOOTSTRAP.md` step 7 called them "THE ONLY PLACE THEY WILL EVER RUN"
and both headers said so: automatable once `GLITCHTIP_TOKEN` is a repository
secret (OWNER_QUEUE `S-8`). It became one at 2026-08-11T16:55:34Z. Until
then the alarm chain of this entire portfolio was verified BY HAND, ON ONE
LAPTOP, which is the same shape as a guard that stopped guarding: it holds
only while somebody remembers to perform it, and nothing anywhere reports
that nobody did.

⚠️ WHY HERE AND NOT `ci.yml`. ci.yml gates every push, including from forks,
and holds no network credential — by its own design, not by omission. A limb
needing a token would have to SKIP there, and a skipped check reports ok,
which is the precise defect this repository keeps paying for. This workflow
is the opposite shape: scheduled, gating nothing, no `push` or
`pull_request` trigger so it never runs on a fork PR, and already trusted
with five credentials.

⚠️ NO SECRET-PRESENCE BRANCH, for the same reason `supabase-drift` has none
(see its note above, and its first scheduled run opening issue #151): a run
that discovers it cannot do its job and then reports success is a green tick
over an unchecked instance. Each script's exit 2 IS "I could not look", and
it fails.

⛔ NEVER ADD `--self-test` TO THIS JOB. Three of these MUTATE the live
instance and restore in a `finally` — an unattended run that dies mid-test
leaves a real alarm chain disarmed. Self-tests are for a human changing the
guard, at a keyboard.

### before step **The register still matches the live GlitchTip monitors**

🔴 EVERY STEP RUNS EVEN IF AN EARLIER ONE FAILED (`if: always()`), and
that is deliberate. These four check four unrelated things; stopping at
the first red would turn "monitors drifted" into "the other three were
never looked at", and a run that checked one thing reads on the summary
page exactly like a run that checked four.

### before step **The app's federated-provider declaration matches the live project**

Needs no GlitchTip token: it reads the publishable key, which is what the
app itself ships with. Catches an OAuth provider being switched on or off
in the Supabase dashboard while `AuthProviders.configured` says otherwise
— in EITHER direction. Declared-on/server-off ships a button that 400s;
declared-off/server-on hides a provider the owner paid to stand up.

### before step **The store service account is still powerless on GCP**

[ADR 033]'s fail-closed half. The key comes from the env here because a
runner has no `.claude/`; the script asserts the key's own
`client_email` is the account ADR 033 is about, so a swapped secret
fails loudly instead of proving a 403 about somebody else.

## job `alert`

### above `alert:`

── Alerting ────────────────────────────────────────────────────────────────
Copied from e2e.yml's `alert` job, which is the shape that works here: ONE
durable issue, reused, never auto-closed. A notification is read once and
gone; an open issue sits on the repo until a human closes it — and closing it
IS the disposition. [pipeline O-5]

🔴 AUTO-CLOSING IS FORBIDDEN. Teaching this job to close its own issue on a
later green run would satisfy any "every alert has a disposition" criterion
and DESTROY the requirement, because the only evidence anyone looked is a
human having looked.

SCHEDULED RUNS ONLY: a workflow_dispatch failure is attended by definition.

### key `needs:`

### above `needs:`

`supabase-drift` joins the two readers: drift in the live auth config is a
scheduled duty reporting unhealthy, which is exactly what this issue is
for.

🔴 AN OWNER GAP DOES OPEN AN ISSUE, AND THAT IS THE DESIGN. This comment
used to read "when the owner has not supplied the secret that job exits 0
with a ::warning::, so an owner gap never opens an issue nobody can close."
That described the job as FIRST written and was left behind by the
deliberate reversal documented 50 lines above: there is no secret-presence
branch any more, and exit code 2 ("I could not look") is a failure.

It is not hypothetical. The job's first-ever scheduled run, 2026-08-04
10:07Z (run 30899326549), failed with exit 2 because SUPABASE_PAT and
SUPABASE_PROJECT_REF were never created as repository secrets, and opened
issue #151. Nothing had drifted — the live config was verified in sync,
every field and all three templates — but the duty went unperformed, which
is the state this job exists to make visible. The issue IS closeable: the
owner adds the two secrets (Settings → Secrets and variables → Actions),
the next run goes green, and a human closes it.

`prod-provenance` joins them for the same reason `supabase-drift` did: an
unattributable row in production is a scheduled duty reporting unhealthy.
Leaving it out would have made B-17's monitor the one reader in this file
whose red nobody is told about — a check that runs, fails, and is read by
no one is the same as no check, which is B-17's own subject.

## job `alert`

### in step **File the failure against one durable issue**, above `TITLE: 'Scheduled duty is not reporting healthy'`

THE MARKER. Matched exactly, so rewording it means the next failure
opens a second issue next to the one already open.

## job `digest`

### above `digest:`

── [pipeline O-2] THE WEEKLY DIGEST — "delivered unasked on a cadence" ─────

🔴 A COMMAND NOBODY RUNS IS A COMMAND THAT DOES NOT EXIST. O-2 is two halves:
one command that answers "is anything broken now?", and that answer ARRIVING
without somebody remembering to ask. The daily jobs above are the alarm — they
speak only when something is wrong, which is correct and is also why a
portfolio can be quietly degrading with nothing red: every gap in this stage
PRINTS rather than fails, by design, and a print nobody reads is a note.

SCOPE IS PRE-CUT, and deliberately not widened here. MASTER_PLAN §10 says
"ship the 10-line version": a plaintext owner queue (exists) plus ONE weekly
digest. No scoreboard, no cadence file, no four cron agents.

⚠️ THIS JOB IS A DELIVERY MECHANISM, NOT AN ASSERTION, and it says so rather
than looking like a check that cannot fail. The verdicts are produced by the
two jobs above, which DO fail; this one collects what they printed — gaps
included — and puts it somewhere a person will see it. It exits 0 even when
the readers are red, because a digest that disappears exactly when there is
something to report is the failure mode it exists to remove.

ONE REUSED ISSUE, commented rather than reopened: a notification is read once
and gone; an issue keeps the history, so "when did this gap first appear" is
answerable. It is never auto-closed, for the same reason the alert issue is
not — closing it is a person saying they looked.

### in step **Deliver it to one durable issue**, above `TITLE: 'Weekly ops digest'`

THE MARKER. Matched exactly, so rewording it starts a second thread
next to the one already open.

