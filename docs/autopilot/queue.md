# The autopilot lane queue — Issues in the Private repo

The lane queue used to be one JSON file on the owner's laptop, so when the laptop was off
nothing could launch the next lane. Now every cloud lane is **one Issue in the PRIVATE repo**
whose body is the lane's whole, self-contained prompt. The laptop dispatcher (primary) and the
cloud runner routines (failover) both **claim** issues through the one protocol below, so the
issue is the single source of truth and nothing launches twice.

🔴 **A lane prompt is Private content.** It goes to the Private repo's issues and nowhere
else: never a Public issue, PR, file or test fixture. `queue-migrate.mjs --apply` refuses a
target repo the API does not report as private.

The names and thresholds are defined ONCE, in
[`tooling/autopilot/contract.json`](../../tooling/autopilot/contract.json); the code is
[`tooling/autopilot/issue-queue.mjs`](../../tooling/autopilot/issue-queue.mjs) (the pure
functions and a thin REST layer) and
[`tooling/autopilot/queue-migrate.mjs`](../../tooling/autopilot/queue-migrate.mjs) (the
laptop's one-off and per-lane migration). `tooling/ci/test/autopilot-queue-doc.test.mjs`
fails when this page names a label or threshold the contract does not hold, or the reverse.

## The issue

- **Title:** `lane: <lane>`.
- **Body, in order:**
  1. one HTML comment, `<!-- autopilot v1 {...} -->`, holding the JSON keys `lane`,
     `priority`, `lander`, `effort`, `model`, `ceil`, `acctPref`, `transport`;
  2. dependency lines, one per line:
     - `Depends on #N` — another lane issue; met when it is CLOSED as completed;
     - `Depends on PR: <regex>` — met when a Public PR whose head branch matches is MERGED;
     - `Depends on marker: <name> (laptop)` — never met in the cloud; only the laptop can
       read a marker, so only the laptop passes `markersMet` and only it can flip such a
       lane between `ready` and `blocked`. To hand one to the cloud once the marker reads
       `land exit=0`, rerun `queue-migrate.mjs --only <lane>`, which drops a satisfied
       marker's line;
  3. a `---` line;
  4. the prompt.
- **The body limit.** A body longer than the contract's `bodyLimit` (60,000 characters)
  continues in comments that each start `<!-- prompt-part k/n -->`, k from 2 to n; the issue
  body is part 1. A reader that finds a part missing refuses rather than launching half a
  prompt.

## Labels

| label | meaning |
| --- | --- |
| `cloud-lane` | every lane issue carries it |
| `prio:<p>` | the lane's priority, one of 0.5, 1, 1.5, 2, 2.5, 3 — lower launches first |
| `ready` | every dependency is met |
| `blocked` | at least one dependency is not met |
| `acct:<n>` | the preferred account, 1 or 3 |
| `claimed:<id>` | a runner holds (or is settling) a claim |
| `pr-open` | the lane's PR is open |
| `done` | the lane's PR merged; the issue is closed as completed |
| `failed` | the lane failed and needs the lead |
| `drill` | a drill issue, not a real lane |

## The claim protocol

Only comments **by the repository owner** count; every other author is ignored. Comment ids
are GitHub's total order and decide every race — wall time never does. A comment counts only
when its first line is EXACTLY one of the lines below (`PROGRESS` must carry `routine=`);
free text that merely starts with a verb is not a protocol line. Every reader goes through
one function, `claimState()`, so `nextReady()` and `claim()` never disagree.

1. **Read.** Read the comments first. A lane held by a fresh claim, or by one with a launch
   record, is left alone, unwritten.
2. **Claim.** Add `claimed:<id>` and comment `CLAIM runner=<id> at=<ISO> nonce=<8 hex>`.
3. **Settle.** Wait `CLAIM_SETTLE_S` (90 seconds) and re-read the comments. The window's
   **lowest comment id wins**, and a claimant wins only if that comment is **the one it
   posted** (by comment id, never by runner id: two dispatchers that share `laptop` cannot
   both win).
4. **Lose.** The loser comments `YIELD runner=<id>` and removes its `claimed:<id>` label
   (unless the winner shares its id).
5. **Freshness.** A claim is fresh while the newest of these is under `CLAIM_STALE_H`
   (6 hours) old: its window's CLAIM, RECLAIM or `PROGRESS` comments, or the `updated_at` of
   a Public PR whose head branch matches the issue's `lander` regex.
6. **Reclaim.** A stale claim is taken with `RECLAIM previous=<id> runner=<id> at=<ISO>`,
   then the same settle; `claim()` posts it on its own when the holder is stale. Every
   reader honours a RECLAIM only when `previous=` names the holder, the holder was stale by
   the comments' own clock at the RECLAIM's `created_at`, and the holder has **no launch
   record** (a `PROGRESS` after its claim). A valid RECLAIM opens a new window that it
   holds; an invalid one is a plain CLAIM in the current window and loses on id, so two
   reclaims of one holder resolve lowest-id-wins and a late one never evicts a holder. A
   launched lane is never reclaimed: the lead releases it or labels it `failed`.
7. **Release.** A holder that gives a lane up comments `RELEASE runner=<id>`, naming the
   holder; the claims after it start a new race. Anyone else's RELEASE is ignored.

The runners fail over only when the laptop's heartbeat is older than `HEARTBEAT_STALE_MIN`
(30 minutes).

### How the laptop dispatcher launches a lane

The laptop claims with the runner id `laptop` (the contract's `laptopRunner`), through
`claim()` in `issue-queue.mjs`, BEFORE it launches anything. Only after it wins does it start
the lane's `run_once` routine, then it comments `PROGRESS routine=<trigger id>`. From then on
the routine's own PR keeps that claim fresh: the PR's `updated_at` counts toward freshness, so
a working lane is never reclaimed while its PR moves.

## Closing

When the lane's PR is MERGED, any housekeeper — the laptop dispatcher or a runner — applies
`housekeepingPlan()`: it labels the issue `done` and closes it as completed (which in turn
meets every `Depends on #N` on it), labels a lane with an open PR `pr-open`, and flips
`blocked` to `ready` once the dependencies are met (never for a migration stub, and never on
a marker it cannot read). One run applies at most
`HOUSEKEEPING_MAX_OPS` (20) operations.

## Migrating the laptop queue

`queue-migrate.mjs` runs on the laptop, DRY by default (`--apply` writes, and refuses without
`--vault`), with every input a flag; its header lists them and the dependency translation.
Its first pass writes stubs that carry no `cloud-lane` label, a placeholder prompt and an
unmeetable marker, so a second pass that dies midway launches nothing. It refuses an item with no prompt
file, and any body holding a vault value, a token-shaped string or an un-rewritten Windows
user-profile path — naming the vault KEY, never the value. A rerun updates by title and never
duplicates.
