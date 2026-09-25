# `e2e.yml`

The prose that used to live inside `.github/workflows/e2e.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

Full-stack end-to-end test of the deployed Subly app against LIVE Supabase auth
+ the live Cloudflare Worker + D1. A throwaway user is provisioned (confirmed)
before the run and purged after, so prod is left pristine.

Runs nightly + on demand — NOT on every push (it writes to live prod and takes
a few minutes). To also run per-push, add `push: { branches: [main] }` below.

Required repo secrets — ALL of them, on every run:
  SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL,
  CLOUDFLARE_API_TOKEN (needs D1 read+write), CLOUDFLARE_ACCOUNT_ID,
  SUPABASE_SERVICE_ROLE_KEY

🔴 A MISSING SECRET IS A FAILED RUN, NOT A SKIPPED ONE — changed 2026-08-01.
This header used to read "if SUPABASE_SERVICE_ROLE_KEY is absent the job
green-skips (degrades gracefully)", and every real step carried
`if: steps.pre.outputs.run == 'true'`. The graceful degradation was a fully
green nightly run that executed one `echo` and tested nothing — and the `alert`
job below, gated on `failure()`, could not fire on it by construction. So the
day that secret was rotated, renamed or expired, the only end-to-end proof the
factory has against live Supabase + the live Worker + live D1 would have gone
dark reporting success, in the same workflow whose header memorialises six
unattended red nights nobody saw. Silence is not success, and neither is a
green tick over an empty run.

There is no secretless audience to protect: this workflow has no `push` or
`pull_request` trigger, so it never runs on a fork PR, and both triggers it
does have (schedule, workflow_dispatch) only ever run in this repository where
the secrets exist. Failing closed costs a contributor nothing and buys the
owner a red run — which the `alert` job turns into a durable GitHub issue.

tooling/ci/assert-green-means-ran.mjs §B enforces this structurally: the
preflight must exit non-zero, and no step may be `if:`-gated on its output.

🔴 HOW THIS WORKFLOW'S FRESHNESS IS GRADED — CHANGED 2026-09-06.
`tooling/ci/assert-e2e-proof-fresh.mjs` runs on every push and blocks merges,
and until today it required the newest green run to carry `event: schedule`.
That single filter carried TWO claims at once — the timer fired, and the run
passed — and GitHub delivers this repository's scheduled runs 10.1% on time, so
the timer half froze the merge queue three times while the workflow itself was
healthy (~18h 2026-08-10, ~46h 2026-09-02, and again 2026-09-03 into 09-04).

The claims are now SPLIT across two records, and BOTH must be inside the same
derived three-day ceiling:

  · the OUTCOME — the newest green run whose `head_branch` is `main`. The
    event filter is gone; the branch is now named explicitly, because it used to
    ride on that filter for free (GitHub fires schedules only on the default
    branch) and this workflow does hold green runs on feature branches.
  · the TIMER — the `cron_heartbeat` row the platform Worker writes when it
    dispatches this workflow: job `github_dispatch`, target
    `Nikatru_Platform_Public/e2e.yml`, in D1. Only a timer writes that row.

⛔ SO A HAND-PRESSED `workflow_dispatch` CANNOT MAKE THIS GUARD GREEN. It can
satisfy the outcome limb — correctly, because the Cloudflare Worker's dispatch
is a `workflow_dispatch` and it IS the nightly now — and it cannot satisfy the
timer limb, which is where the cadence claim moved.

⚠️ THE `schedule:` TRIGGER BELOW STAYS, for two reasons. It is the rollback: if
the Worker rail is reverted, the old evidence is still being written. And
`MAX_AGE_DAYS = 3` is DERIVED from that cron's daily cadence — the guard
re-reads it on every run and fails if it stops being daily — so deleting the
cron would break the ceiling as well as the fallback.

The guard reads D1 through the SAME reader ops-watch uses
(`tooling/ops/check-heartbeats.mjs`), imported rather than copied, and it needs
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` alongside `GITHUB_TOKEN` in
`ci.yml`. Every unreadable path — no token, a non-200, an answer that is not
JSON, no heartbeat row at all — exits 2 (COVERAGE LOST), never 0.

⛔ AND A GREEN VERDICT IS NOT A PROOF THAT THE LIVE PATH WORKS. That guard
grades the FRESHNESS of the evidence. `O-E2E-UNPROVEN` stays open.

⚠️ ONE ASYMMETRY IS LEFT OPEN AND NAMED. The `alert` job at the bottom of this
file still gates on `github.event_name == 'schedule'`, so a Worker-DISPATCHED
nightly that fails files no durable issue — and the Worker-dispatched run is now
the unattended one. The reader was fixed by the unit that owned it; the alerter
was not, because that unit did not own this workflow.

### above `inputs:` — the `auth_target` axis

🟢 **ONE SUITE, TWO AUTH STACKS, AND THE NIGHTLY NEVER MOVES.** Added 2026-09-07
([ADR 067] decision 6, unit `cutover-blockers`) to remove the first of the two
Phase-5 blockers `runbooks/auth-cutover.md` records.

⏱ **2026-09-25 — THE TARGETS NAME SECRET SETS, AND WHAT A RUN EXPECTS IS DERIVED.**
`hosted` / `boxa` hard-coded two facts each — the stack's captcha posture AND
whether the Workers trust its issuer — and the Phase 5 cutover moves those two at
different moments: the repo secrets rotate to Box C first (C6), the switch commit
moves `vars.SUPABASE_URL` after (C7). In between, the default run is on a
captcha-ON stack the Workers do not trust yet, which neither old target expected.
So the targets are now:

- `production` (the default) resolves to `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`;
- `selfhosted` resolves to `SELFHOSTED_SUPABASE_URL` / `SELFHOSTED_SUPABASE_ANON_KEY`
  / `SELFHOSTED_SUPABASE_SERVICE_ROLE_KEY` (Box C). No `BOXA_*` secret is read any
  more;

and the step **Derive what this run expects** (`tooling/e2e/derive_expectation.mjs`
over `auth_target_expectation.mjs` `deriveExpectation`) writes two facts to
`$GITHUB_ENV`: `E2E_STACK` (`hosted` for a `https://<ref>.supabase.co` origin,
else `selfhosted`) and `E2E_WORKERS_TRUST` (`yes` when the URL's origin is
`tooling/platform-register.json` `vars.SUPABASE_URL` at the checked-out sha, else
`no`). Every consumer reads the fact it needs and exits 2 on an unset or unknown
one; `app_test.dart` takes them as the REQUIRED defines `E2E_EXPECT_CAPTCHA_GATE`
and `E2E_EXPECT_WORKERS_TRUST`. `E2E_AUTH_TARGET` is retired. Any target but
`production` is refused on `main`, and a rehearsal is now dispatched as
`git push origin main:rehearse-selfhosted && gh workflow run e2e.yml --ref rehearse-selfhosted -f auth_target=selfhosted`.
The paragraphs below are the record as it was written for `hosted` / `boxa`.

Until this input existed, the live suite could only ever describe the auth
project it happened to be pointed at, so *"does the live end-to-end path still
pass on Box A?"* was a question that could first be asked **inside** the cutover
window — the one window that must not carry a surprise, because there is no
dual-issuer path and a mistake there 401s the whole portfolio. Now it is asked on
demand, from the same code, before the window.

- `hosted` (the default) resolves to `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`.
- `boxa` resolves to `BOXA_SUPABASE_URL` / `BOXA_SUPABASE_ANON_KEY` /
  `BOXA_SUPABASE_SERVICE_ROLE_KEY`.

⚠️ **THE SCHEDULE CARRIES NO INPUT AT ALL**, so `inputs.auth_target` is empty on
a scheduled run and the `|| 'hosted'` fallback takes it. The unattended proof
keeps grading production; nothing about the nightly's meaning changed.

✅ **THE `BOXA_*` SECRETS EXIST SINCE 2026-09-12 02:39Z.** All three were read off
Box A's own `/opt/supabase/.env` (`API_EXTERNAL_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`)
and piped straight into the repository, so no value passed through a transcript. Read
back before use: the URL is `auth-api.nikatru.com`, the anon key's `role` claim is
`anon` with `iss=supabase`, and `GET $URL/auth/v1/settings` carrying that key answered
**200**. The preflight's fail-closed limb is unchanged and still ends the job on an
empty one; what changed is that it now passes.

🔴 **A `boxa` DISPATCH MUST NOT BE MADE ON `main`, AND THE WORKFLOW NOW REFUSES ONE.**
`tooling/ops/register.json`'s `duty.workflow.e2e.yml` grades the newest run of this
workflow **on main** as production health — its own words are "Treat as production
until proven otherwise". A `boxa` run is the opposite of that claim: it drives a stack
the deployed Workers deliberately refuse. Measured 2026-09-12: run `34668296014`
(boxa, on main) failed at 02:43:21Z, the next push read `duty.workflow.e2e.yml — RED
SINCE`, `ci-gate` went red on `0d3e61a8`, and **`Deploy web` and `Deploy workers` both
refused** at their "Require ci-gate to have passed for this commit" step — while the
hosted control run on the same commit (`34668924212`) passed 11 minutes later. Nothing
was wrong with the deployed system; a rehearsal had been mistaken for it.

Dispatch a rehearsal on a BRANCH at the same commit instead. The duty query already
narrows by `headBranch: main`, so a branch run is invisible to it while staying fully
visible to whoever asked for it — and a HOSTED failure on main still blocks every
deploy, exactly as before:

```bash
git push origin main:rehearse-boxa && gh workflow run e2e.yml --ref rehearse-boxa -f auth_target=boxa
```

⚫ **THIS IS NOT THE CUTOVER.** No Worker `SUPABASE_URL` moves, no KV key is
purged and no web deploy is aimed at Box A. Phase 5 stays the owner's, at
execution, with `auth.users` still 0.

### above `permissions:`

Least privilege, and this is the DEFAULT for every job that does not override
it. The e2e job below only reads the repo — it publishes nothing through
GITHUB_TOKEN. Without this every job ran at the repository-default scope, which
on a public repo is a standing hand-out to any compromised action. [pipeline F-11]

The `alert` job needs `issues: write` and declares that AT THE JOB LEVEL, which
REPLACES this block for that job alone rather than merging into it. That is the
whole reason alerting is a separate job: the job that holds
SUPABASE_SERVICE_ROLE_KEY and CLOUDFLARE_API_TOKEN must not also be handed a
token that can write to the issue tracker.

## job `prepare`

### above `prepare:`

── which apps does this factory hold? ──────────────────────────────────────
[pipeline 9]R-1: "adding an app requires no new or edited workflow file."
The nightly proof is a MATRIX over this output, so the set of apps driven
against live Supabase is the root pubspec's `workspace:` list and nothing
else. Identical to build-platforms.yml's `prepare`, and deliberately reading
through the SAME emitter — `assert-release-lane-generic.mjs --emit-apps` is
the guard that grades both lanes, so the set they iterate and the set they
are graded against cannot diverge. A second pubspec reader inlined here would
be the copy that quietly stops reading what it thinks it reads.

It has NO secret-presence preflight and needs none: it touches no secret, and
the `e2e` job below still fails closed on SUPABASE_SERVICE_ROLE_KEY for every
leg. It emits nothing on an empty workspace — it exits 1 — because a matrix
of `[]` runs zero legs and reports success, which is the exact green-over-
nothing this workflow's header was rewritten to remove.

## job `strategy`

### above `strategy:`

`fail-fast: false` — each app's nightly run is its own proof against live
production, and cancelling app #1's leg because app #2 regressed destroys
the evidence that would have told a real outage from one app's bug. It also
keeps the `always()` purge below reachable on every leg. With one app in the
workspace this changes nothing.

## job `with`

### above `with:`

persist-credentials: false — actions/checkout otherwise writes GITHUB_TOKEN
into .git/config and LEAVES it there for the whole job. Any later step that
packages the workspace (or anything containing .git/) ships the token inside
the artifact, and on a PUBLIC repo artifacts are downloadable. Nothing here
does git push/tag/commit, so none of these checkouts need the credential.
[zizmor artipacked] Verified 2026-07-27: no current artifact path includes
.git/ — so this closes a FUTURE mistake, not a live leak.

## job `e2e`

### before step **Preflight — the chosen auth target's secrets must be present**

THE RUN IS EITHER POSSIBLE OR IT IS RED. Nothing downstream is gated on
this step's output — the job simply stops here, which is what makes the
`alert` job below reachable when the secret goes missing unattended.

🔄 **REWRITTEN 2026-09-07 — IT NOW RESOLVES THE TARGET AS WELL AS CHECKING IT**
([ADR 067] decision 6, unit `cutover-blockers`). The step reads both secret sets,
picks the one `auth_target` names, refuses if ANY of that set's three names is
empty, and ends the job naming the ones that are missing.

🔄 **CORRECTED 2026-09-07 (second pass) — IT NO LONGER HANDS THE VALUES ON.** The
first pass wrote the three chosen values to `$GITHUB_ENV` under the plain names
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. That is
**job-wide**: every step after it inherits them, including
`nanasess/setup-chromedriver` and `actions/upload-artifact`, neither of which ever
saw `SUPABASE_SERVICE_ROLE_KEY` before — and `tooling/channel-register.json`'s own
row for that name calls it *the key that bypasses the Turnstile gate*, which is
exactly why the harness and never the browser holds it. On `origin/main` it was
bound **per step**, at five places.

It is bound per step again, at the **eight** steps that consume it, and the ONLY
thing the preflight writes to `$GITHUB_ENV` is `E2E_AUTH_TARGET` — a literal
`hosted` or `boxa`, which is not a credential. The binding each of those steps
carries is three-armed:

```
${{ (inputs.auth_target || 'hosted') == 'boxa'   && secrets.BOXA_SUPABASE_URL
 || (inputs.auth_target || 'hosted') == 'hosted' && secrets.SUPABASE_URL
 || '' }}
```

🔴 **THE THIRD ARM IS THE WHOLE POINT AND IT IS NOT DECORATION.** A two-armed
ternary — `cond && BOXA || HOSTED` — is wrong in the one case that matters: an
**empty** `BOXA_*` secret is falsey, so it falls through to the hosted value and
the run reports `boxa` in its own name while grading production. Written this way
the second arm is a POSITIVE `== 'hosted'` test rather than a bare else, so a
`boxa` run whose secret is empty resolves to the EMPTY STRING and the step dies on
its own `need()` — never on the wrong stack. The preflight still fails first, and
with the secret's NAME in the message; the shape is what makes that message the
only way through rather than the only thing in the way.

The suite `tooling/ci/test/e2e-auth-target.test.mjs` holds all three properties
with a green control and a mutation each: re-adding the `$GITHUB_ENV` write,
dropping one step's binding, and weakening the ternary back to two arms.

🔴 **WHY THE *REFUSAL* IS MADE IN SHELL AND NOT IN A GITHUB EXPRESSION.**
(Reworded 2026-09-07 second pass: the *resolution* is now an expression, per the
block above; what stays in shell is the refusal, because only shell can name the
missing secret in the error.) The obvious spelling is a ternary in the job's `env:` —
`${{ inputs.auth_target == 'boxa' && secrets.BOXA_SUPABASE_URL || secrets.SUPABASE_URL }}`.
It is wrong in the one case that matters: an **empty** `BOXA_*` secret is falsey,
so the ternary falls through to the hosted value, and the run reports `boxa` in
its own name while grading the hosted project. A false green with a label on it
is worse than a red, and this lane's history is failures that looked like passes.
In shell each of the three names is tested for emptiness by itself and the job
ENDS naming the ones that are missing.

⚠️ **AND THE SHAPE IS LOAD-BEARING FOR `assert-green-means-ran` SECTION B.** That
guard recognises a secret-presence check by finding `-z "$VAR"` for a variable
this step's own `env:` bound to `secrets.*`. Indirecting through a shell alias
first (`key="$HOSTED_KEY"`, then `-z "$key"`) makes the preflight INVISIBLE to it
— which is not a failure, it is a silent loss of the coverage that exists because
e2e.yml green-skipped its own body once already. Measured 2026-09-07: written
that way the guard exited 1 with "contains no secret-presence check this scan can
see". The three `-z "$HOSTED_*"` / `-z "$BOXA_*"` tests are written out longhand
for that reason, and the secret-presence count stays at 1.

### before step **Measure the target's captcha posture (ignores it, or enforces it)**

🟢 **THIS IS THE ANSWER TO `runbooks/auth-cutover.md` §4.6's "expected, NOT YET
MEASURED", AND IT IS RE-TAKEN EVERY RUN.** Shipping `TURNSTILE_SITE_KEY` into the
web build ahead of the cutover — so the Phase 5 window carries three acts and not
four — rests entirely on the claim that a hosted GoTrue IGNORES a captcha token
it never asked for. That was reasoning about somebody else's server, and §4.5 is
the record of what reasoning about this particular server cost: three variables
set in the right-looking place, a green stack, and a wide-open signup that only a
NEGATIVE test caught.

`tooling/e2e/captcha_posture.mjs` sends one `token?grant_type=password` for an
address that does not exist, carrying a deliberately invalid captcha token, and
asserts the answer that belongs to this run's target:

| target | required answer | what it proves |
|---|---|---|
| `hosted` | `400 invalid_credentials` | the token was ignored and the password was really checked, so the `deploy-web.yml` define is safe |
| `boxa` | `400 captcha_failed` | the gate is on and refuses before the password, so the magic-link login path is load-bearing rather than optional |

⏱ 2026-09-25: the row is chosen by `E2E_STACK` (`hosted` / `selfhosted`), not by
the target, and whether the Workers trust the stack never enters this step. An
unset or unknown `E2E_STACK` is exit 2 before the probe is sent.

⚬ **IT CREATES NOTHING.** GoTrue makes no user on that route, so `auth.users` is
untouched whatever the answer is — which is what makes it safe to run against
production auth on every nightly. Its failing cases are exercised by
`tooling/ci/test/e2e-auth-target.test.mjs` against a loopback server, green
control first.

### before step **The Workers trust exactly one issuer (positive, both targets)**

🔴 **THE LEGS THAT CANNOT PASS AGAINST BOX A, ASSERTED RATHER THAN SKIPPED.**
`runbooks/auth-cutover.md` Phase 5: *"there is no dual-issuer path in the code —
the Workers trust exactly one issuer"*, and until Phase 5 runs that issuer is the
hosted project. So against `boxa` every Worker-dependent leg is refused by
construction, and a suite that SKIPPED them would report a green tick over a
question nobody asked.

`tooling/e2e/assert_one_issuer.mjs` mints its own magic-link token for the
already-provisioned throwaway user — `admin/generate_link` is re-callable, the
token it returns is the single-use half, so this does not spend the one the
browser needs — exchanges it at `/verify`, and presents the session to the
deployed Worker. `hosted` must be answered **200**; `boxa` must be answered
**401**, and that refusal IS the pass. If `boxa` is ever answered 200 the Workers
have gained a second issuer that nothing in `services/` implements and nobody
decided: the step says so in those words, because it is a security finding and
not a test failure.

⚠️ It runs on BOTH targets on purpose. The `boxa` expectation is then exercised
code rather than a comment, and the `hosted` expectation is a second, independent
reading of the fact Phase 5 is going to move.

⏱ 2026-09-25: the direction is `E2E_WORKERS_TRUST`, not the target. `yes` must be
answered **200** and a 401 names "the Workers refuse the production issuer";
`no` must be answered **401**. From the switch commit on, the register names the
self-hosted GoTrue and the production run expects 200 from it with no edit here.

🔴 **ADDED 2026-09-22 — IT NOW READS THE `iss` CLAIM BACK, AS COMPARISONS.**
Until then the step printed `token issuer: the Box A auth stack`, a fixed string
built from the target: no run had ever read the issuer the box actually mints,
which is what `O-PHASE5-ISSUER-SUFFIX` was left open on. It now base64url-decodes
the access token's payload (no signature check — the Worker does that) and prints
three more lines: `iss path`, `iss host equals SUPABASE_URL host: yes|no` and
`iss equals SUPABASE_URL + /auth/v1: yes|no`. **They compare rather than print
because the value cannot be printed**: `SUPABASE_URL` and `BOXA_SUPABASE_URL` are
repository secrets, so Actions masks them in every log line and a raw `iss` reads
`***/auth/v1` — unreadable by eye, exactly as `GET ***/v1/subscriptions -> HTTP
401` reads in run 35704944906. A yes/no computed in-process, and a path, survive
the mask. The comparison is byte-for-byte against `${SUPABASE_URL}/auth/v1`,
which is the string `services/_shared/src/auth.ts` hands `jwtVerify` as its
`issuer` — a trailing slash there is a different issuer.

⚬ **A "no" REPORTS; IT DOES NOT FAIL.** The 401/200 verdict above is the
assertion and is unchanged: a wrong issuer suffix is what the row expects to
find, and hiding that reading behind a red run would be worth less than the
reading. The one new way this step CAN fail is a token that does not decode at
all — not three segments, a payload that is not JSON, or no `iss` — which exits
**2**, the same code Public #869 gave the verifiers for "could not decide what to
expect": exit 1 here means the one-issuer fact is wrong, exit 2 means the reading
could not be taken. Both halves are exercised by
`tooling/ci/test/e2e-auth-target.test.mjs` (T1–T4), including one case that holds
every printed line clear of the token, the payload and the service key.

### in step **Run integration tests (headless Chrome)**, the two defines added 2026-09-07

`--dart-define=TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY` comes from the repository
**variable** `vars.TURNSTILE_SITE_KEY`, never from a secret. A Turnstile SITE key
is the public half of the pair: it ships inside every web bundle and is
meaningless without the secret half, which lives only on the auth box as
`CAPTCHA_SECRET` and never reaches this repository. Passing it from a variable is
how that is said out loud.

🔴 **CORRECTED 2026-09-07 (second pass) — AN EMPTY SITEKEY NOW REFUSES THE RUN.**
The first pass said the variable is unset today, so the define arrives EMPTY,
`TurnstileGate` renders `SizedBox.shrink()` and the suite behaves exactly as it
did before the line existed. All true — and that is precisely the problem the
phase-3 brief refuses at §7.4.9: *a green run with an empty sitekey is not
acceptance*. Run `34068306612` was that run. A suite that signs in with no captcha
token proves the gate is not needed, not that it works, and Box A ENFORCES
Turnstile on `signup`, `token?grant_type=password`, `recover`, `otp`,
`magiclink` and `resend` for **every** client (runbook §4.7) — so an empty sitekey
makes the whole `boxa` rehearsal meaningless.

A second preflight, **Preflight — the Turnstile sitekey must be present**, now
tests `-z "$TURNSTILE_SITE_KEY"` and exits 1 printing the owner step. The
repository variable does not exist yet, so **every run of this workflow is refused
today, including the nightly** — that is the designed behaviour and it is recorded
as such. The owner step is one field (Settings → Secrets and variables → Actions →
Variables), the value is public, and it can be unset again in seconds.

⚠️ **IT IS A SEPARATE STEP, AND THAT IS NOT TIDINESS.**
`assert-green-means-ran.mjs` section B1 asks whether a step that reads a SECRET and
branches on its emptiness contains ANY `exit <n>`; it cannot tell WHICH branch
exits. Folding a third refusal into the secrets preflight therefore makes that
guard's own mutation case (`green-means-ran.test.mjs`, *"a secret-presence
preflight that does not exit non-zero fails"*) pass with both secret refusals
removed — measured on this branch: EXIT 0 where the case expects 1. Splitting the
sitekey out keeps that net at full strength and leaves the secrets preflight in
the exact shape the guard recognises (the secret-presence count stays at **1**).
The coarseness of B1 is reported, not edited around: that guard and its suite
belong to the `store-lanes` unit.

`--dart-define=E2E_AUTH_TARGET=$E2E_AUTH_TARGET` carries the resolved target into
the suite, which uses it to pick between two POSITIVE expectations rather than to
skip anything — see `apps/subscriptiontracker/integration_test/app_test.dart`. Both names carry
an entry in `tooling/publishable-inputs.json`, because that register is checked
for SET EQUALITY in both directions and a define nobody wrote a reason for is
refused.

### before step **Stamp this run's build identity (APP_VERSION)**

── THIS LANE'S BUILD IDENTITY, DERIVED ONCE ────────────────────────────
🔴 WITHOUT THIS THE NIGHTLY WROTE `dev` INTO PRODUCTION. e2e.yml passes
SUPABASE_URL, SUPABASE_ANON_KEY and API_BASE_URL, which is enough to make
`AppConfig.isBackendLive` true and open the REAL consent transport — but
it passed no APP_VERSION, so app_config.dart fell back to its compile-time
default `'dev'` and every row this lane wrote was indistinguishable from a
developer laptop's. Six such rows sat in platform_db from 2026-08-27 until
ops-watch run 33139423096 found them; record:
Private/pre-minimal-2026-09-08:notes/EVIDENCE-consent-artifacts-dev-rows-2026-08-28.md.

⛔ AND THE FIX IS NOT `PLATFORM_BASE_URL`. There is no staging Worker and
creating one is rejected: this workflow exists to prove the golden path
against LIVE Supabase + the LIVE Worker + LIVE D1, and ci.yml / assert-e2e
-proof-fresh.mjs treat that liveness as the thing asserted. B-17 states
verification against production is permitted and EXPECTED; what is
required is that it cleans up, and that a row it writes SAYS who wrote it.

⚠️ THE VALUE HAS TO FIT IN 32 CHARACTERS, and overflowing is WORSE than
`dev`. services/platform/src/routes/events.ts:378 binds it as
`str(body?.app_version, 32)`, and that helper returns NULL — not a
truncation — for anything longer, so an over-long stamp lands as a row
that fails the resolver carrying NO information at all.
  "e2e-" 4 + run_number + "-" 1 + sha7 7
  = 12 + len(run_number). Today's run numbers are 3 digits → 15 chars.
  At the 9-digit ceiling assert-app-versioning.mjs budgets for → 21 chars.
  Both are inside 32. A FULL 40-CHAR SHA WOULD RENDER 4+9+1+40 = 54 AND
  BE STORED AS NULL, which is why `${GITHUB_SHA::7}` and not `github.sha`.

DERIVED ONCE, ON THE ONE SHELL THAT HAS THE EXPANSION — the same rule
build-platforms.yml's `prepare` states, and for the same reason: GitHub
expressions have no substring, so a short sha can only come from bash, and
two hand-copied compositions are two things free to drift. Written to
$GITHUB_ENV so BOTH consumers read one string: the `flutter drive` define
below, and tooling/e2e/purge.mjs, whose failure message points a human at
exactly the rows this run could have written.

### before step **Set up ChromeDriver**

🔴 REPINNED 2026-09-03, AND THE OLD PIN WAS FROZEN RATHER THAN MERELY OLD.
It read `@ef5c64a9 # v2` — a real commit, but an UNTAGGED one (16 minutes
past v2.4.0, i.e. what the floating `v2` tag pointed at), and upstream has
since DELETED the `v2` tag entirely. Renovate cannot resolve a tag that no
longer exists, so it reported `Could not determine new digest for update`
and proposed nothing: this action had been receiving no updates at all
since March, silently, with the pin looking perfectly healthy in the diff.
⚠️ THAT IS THE FAILURE MODE SHA-PINNING BUYS AND `helpers:pinGitHubActionDigests`
is supposed to pay for — and it went unnoticed because nothing in this tree
checks that the `# vN` comment names a tag that still exists. The detector
is Renovate itself, which found it in its FIRST self-hosted run.
v3.0.0 is a TypeScript rewrite that states behavioural parity (same install
locations, same PATH resolution) and this repo passes it no inputs at all,
so the depended-on surface is unchanged. It also carries the download
retry/backoff and the `qs` DoS fix.

### before step **Provision the throwaway user the delete leg destroys**

🔴 A SECOND USER, BECAUSE LEG 6 DESTROYS THE ONE IT SIGNS IN WITH.
[pipeline N-6] leg 6 is "account delete purges", and the only honest way
to prove it is to let the app really delete a real account. That cannot
be the user above: `verify_row.mjs` asserts `COUNT(*) >= 1` for that id
AFTER the drive, so erasing it would turn leg 2's server-side proof red
for the exact reason leg 6 passed — one suite, two claims, and they must
not be able to falsify each other.

Same script, no arguments: `provision_user.mjs` writes `email`,
`password` and `user_id` to $GITHUB_OUTPUT, and step outputs are
per-step, so this `id:` is the whole separation. It needs no new secret.

### before step **Surface the failing assertion**

WHAT BROKE, ON THE RUN PAGE — not on line 370 of a 549-line log.

`flutter drive` reports an integration_test failure as one enormous
single-line JSON blob with the stack traces \n-escaped inside it. The
2026-08-01 failure ("Found 0 widgets with text \"Welcome back\"") was
fully present in the log of all six red nights and read by nobody,
because nothing carried it up to where a person looks. An `::error::`
annotation shows at the top of the run page and in the failure email; the
step summary keeps it after the log rotates.

Never gated on success: `if: failure()` only, so it cannot fire on a
green run and cannot itself turn one red (`|| true` on the extraction).

### before step **Verify the row landed in live D1**

⬜ `SUBSCRIPTIONTRACKER_D1_DATABASE_ID` IS STILL APP-SPECIFIC, AND IS LEFT THAT WAY ON
PURPOSE. [9]R-1's acceptance is about hard-coded app PATHS, and every one
of those is now a matrix value — but this is a different animal: the app
id is in the VARIABLE NAME, because `tooling/e2e/verify_row.mjs` and
`purge.mjs` read `SUBSCRIPTIONTRACKER_D1_DATABASE_ID` by that literal name, and the
value is a real per-app D1 database that only exists once an app has a
backend. Making it generic means changing those two scripts to take the
database id as an argument (and a per-app place to hold the id — the
channel register or the app's own config, not this file). That is a
different change with a different blast radius, in files this refactor
does not own. Forcing `${{ matrix.app }}` into an env-var name here would
produce `PROBE_D1_DATABASE_ID` that no script reads: a lane that LOOKS
generic and silently verifies nothing, which is worse than the honest
literal. App #2's leg will fail loudly on a missing id — the correct
outcome, and the thing that will force the real fix.

### before step **Verify the in-app deletion really purged (leg 6)**

── LEG 6's SERVER-SIDE HALF ────────────────────────────────────────────
The suite above tapped Delete account inside the running app and asserted
the app said "Account deleted". That is the app's own account of what
happened, and a server that deleted nothing and answered `{ ok: true }`
produces the identical green screen — the one failure a user can never
detect and never recover from. So the claim is re-read here, server-side,
with no app in the loop: the identity must be unresolvable through the
GoTrue admin API, and every schema-derived user-owned table in subly_db
must hold zero rows for it.

BEFORE the purge below, necessarily. `purge.mjs` would delete exactly the
rows this step exists to find, so running it first would make the audit
pass on a deletion that never happened.

NOT `if: always()` — a run that failed earlier never reached the delete
walk, and auditing a purge nobody performed reports a failure whose cause
is somewhere else entirely. The teardown below is what keeps prod clean
on that path.

### before step **Verify the consent artifact landed in platform_db**

── THE CONSENT LEG'S SERVER-SIDE HALF ──────────────────────────────────
The suite proves the DPDP prompt comes up on a fresh live launch and
answers it. It cannot prove the artifact ARRIVED, and the reason is in
the app by design: `_ConsentPrompt._answer` does not await the record
call, and `applyConsentDecision` treats the consent upload as best-effort
— a user's choice must not look rejected because the network is down.
So a `POST /v1/consent` that 404s, is shed by the rate limiter or never
leaves the browser gives the identical green run with an EMPTY §6(3)
trail, and nothing anywhere says so. This step is what says so.

⬜ `PLATFORM_D1_DATABASE_ID` IS A LITERAL FOR THE SAME REASON THE TWO
SUBLY IDS ABOVE ARE, and a weaker one besides: this database is SHARED by
the whole portfolio, so it is not even app-specific — there is exactly one
of it, named in services/platform/wrangler.jsonc, and a `${{ matrix.app }}`
in the variable NAME would produce something no script reads. `E2E_APP_ID`
is the matrix value, so the ROW is looked up per app even though the
database is not.

BEFORE the purges below, necessarily: the teardown deletes exactly the row
this step exists to find. NOT `if:`-gated, per the workflow header — a
step that can green-skip is a step that can go dark unnoticed.

### before step **Upload per-page screenshots**

`steps.user.outcome != 'skipped'` = "provisioning was ATTEMPTED", which is
the honest trigger for both cleanup steps: it is true when the run got far
enough to touch production (including when provisioning itself failed
halfway and may have left a user behind), and false when the job stopped
at the preflight — where there is nothing to purge and no screenshots to
collect. It replaces the old `steps.pre.outputs.run == 'true'` gate
without inheriting its green-skip.

### in step **Upload per-page screenshots**, above `name: e2e-screenshots-${{ matrix.app }}`

Per-app, and not for tidiness: `upload-artifact@v4` HARD-FAILS on a
second upload under a name that already exists in the run, so a fixed
name turns app #2's leg red on a step that is `if: always()` — i.e.
it would break the purge's own run. The `alert` job's body still says
"the e2e-screenshots artifact"; that prefix is what a reader matches.

### before step **Purge test data (always — keep prod pristine)**

🔴 THE CONSENT ENV IS ON THIS STEP AND NOT ON THE DELETE-LEG ONE BELOW,
and that asymmetry is the point rather than an oversight. The consent
artifact belongs to the BROWSER PROFILE, not to either throwaway user:
all three tests share one profile, the prompt is answered once, and one
row is written for the whole run. Handing the same anon_id to both purge
steps would issue the identical DELETE twice and print a confusing
`0 row(s)` the second time, as if something had gone missing.

Why it is deleted at all is in tooling/e2e/purge.mjs's header: left to
accumulate, these CI rows feed `analyticsLiveness` in
services/platform/src/scheduled.ts, which reads a consent row as evidence
that a HUMAN used a shipped build.

### before step **Purge the delete-leg user too (already gone on a green run)**

The delete-leg user gets the SAME teardown, and it is not redundant with
the app having deleted it. The deletion is the last thing the suite does,
so every earlier failure — a broken sign-in, a red assertion, a cancelled
run — leaves that account and its rows live in production. On the happy
path this is a no-op that reports `0 row(s)` and HTTP 404; on every other
path it is the only thing that cleans up. `purge.mjs` already tolerated
both (the D1 deletes are unconditional, 404 has always been forgiven), so
nothing was loosened to make this safe.

## job `alert`

### above `alert:`

── Alerting ────────────────────────────────────────────────────────────────
A test suite nobody watches is not a test suite. This workflow FAILED on 19,
20, 21, 22, 23 and 24 July 2026 — six consecutive unattended nights against
live Supabase, the live Worker and live D1 — and nothing responded, because
the only record of a red run was a line in a list nobody opens. Silence is
not success.

The signal is a GitHub issue. It is the only channel that costs nothing, adds
no service to the stack, and PERSISTS: a notification is read once and gone,
whereas an open issue sits on the repo until a human closes it — and closing
it is the acknowledgement that someone actually looked.

ONE issue, reused. Six failures must not become six issues; that is the noise
that gets a channel muted, which is the original bug wearing a different hat.
A new issue is opened only when no matching one is already open; otherwise the
failure is added as a comment (a comment still notifies subscribers, so the
escalation is not lost). The issue is deliberately NOT auto-closed on a later
green run — a human closing it is the only evidence anyone saw it.

SCHEDULED RUNS ONLY. A workflow_dispatch failure is attended by definition:
somebody is sitting there watching the run they just started. The defect is
specifically the unattended path, and alerting on manual runs would file an
issue every time someone iterates on a fix.

No `uses:` is added: `gh` is preinstalled on GitHub-hosted runners, so this
introduces no third-party action to SHA-pin and nothing new can go stale.

Since 2026-08-01 this also covers the MISSING-SECRET case: the preflight now
fails the job instead of green-skipping it, so the one condition under which
the nightly used to go dark silently is now a `failure()` this job reports.

### in step **File the failure against one durable issue**, above `TITLE: 'Nightly E2E (live) is failing against production'`

THE MARKER. Matched exactly, so rewording it means the next failure
opens a second issue next to the one already open.

