<!--
BRANCH NAME — `feat|fix|chore/<slug>`.

`ci.yml` no longer keys on the prefix: it triggers on `push` to `main` and on
`pull_request` for every branch, so a branch called anything at all still gets
one full run. That is deliberate — the old push filter listed three prefixes and
missed `chip/`, `refactor/`, `docs/`, `test/`, `guard/`, `wave*/` and about 79
bare slugs, which is what a list that has to be remembered always does.

So the convention is a convention now. Keep it anyway; it is what makes
`gh pr list --json headRefName` readable.

TITLE — name the DEFECT that was closed, in the present tense, not the change
that was made. This repo's best documentation is its PR titles:

  Subly silently stopped sending reminders past 64 subscriptions on iOS
  The seam-forks guard could not fail at all if packages/ went missing
  CI was reading aloud three false statements about its own state
-->

<!-- ROWS — replace the line below with the register rows this PR closes or
     advances, by id, comma-separated:   Rows: O-ROW-ID, O-ROW-ID
     A PR that moves no row says why, in at least 10 characters:
                                         Rows: none — why no row moves
     tooling/ci/assert-pr-rows.mjs reads exactly one such line, outside comments
     and code fences, on every pull_request event. Left as written it is red;
     editing the body re-runs the check. -->
Rows: <O-ROW-ID, … | none — why>

## What was wrong

<!-- The defect, not the diff. If there was no defect — a new capability — say
     what could not be done before. -->

## What this changes

<!-- The diff, in one or two sentences per file group. -->

## How it was verified

<!-- REAL OUTPUT, not intent. Which guards you ran, against what, and what they
     said. "Should work" is not a verification, and a guard that went green
     after a refactor is evidence of nothing until it has been run against a
     mutation with a green control first. -->

```
# the whole guard set, with the token exported or four guards fail closed
GITHUB_TOKEN="$(gh auth token)" node tooling/scripts/guard-sweep.mjs

# everything ci-gate would run, on the machine that will not be a runner
GITHUB_TOKEN="$(gh auth token)" node tooling/scripts/preflight.mjs
```

- [ ] `git diff --name-only origin/main..HEAD` matches what this body claims.
- [ ] Any `<file>:NNN` citation to a file this change touched was **re-measured**
      after the last edit, not offset.
- [ ] If a `tooling/` file gained an `ADR NNN` in its header, the enforcement
      index was regenerated: `node tooling/ci/build-enforcement-index.mjs --write`.
- [ ] If this adds a workflow FILE, it carries a `duty` row in
      `tooling/ops/register.json` and an owner in
      `tooling/ci/assert-release-lane-generic.mjs` — both, or the build is red.

## If this touches `extensions/`

<!-- ⏱ ADDED 2026-09-08, FOLDED FORWARD FROM A TEMPLATE GITHUB NEVER READ.
     `extensions/.github/pull_request_template.md` arrived in the 2026-09-05
     subtree merge and was inert from the moment it landed: GitHub reads only
     <root>/.github/PULL_REQUEST_TEMPLATE.md. It was not merely a duplicate —
     it carried the four ADR 067 decision-1 promises below, and its "No
     network" checkbox is CITED BY NAME as a store-compliance control at
     extensions/Extension/Full_Screen_Shot/publish/COMPLIANCE-CHECKLIST.md.
     Deleting it without this block would have silently dropped a stated
     control. The whole superseded template, including the manifest,
     permission and store-listing sections not reproduced here, is at
     `ref/pre-prune-2026-09-08:extensions/.github/pull_request_template.md`. -->

- [ ] **No build step.** Clone → load unpacked → it runs. (A per-tool bundler is
      an opt-in with its own `tool.json` `build` block, never a repo-wide
      requirement.)
- [ ] **No runtime dependency.** Nothing from npm ends up inside a shipped zip.
- [ ] **No network.** No `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` /
      remote `src` in any packaged file. These extensions collect no analytics;
      `tool.json` → `policy.networkAllowlist` is the machine-readable form of that
      claim, and the gate must read the packaged BYTES rather than grep the prose.
      On **Chromium** the manifest CSP (`connect-src 'none'`) additionally backs
      this for extension pages and the service worker, but **not** for the three
      `content/` scripts — `extension_pages` does not govern them. On **Firefox**
      neither half is browser-backed: the Gecko package ships no CSP at all, by
      design, so the claim there rests on the source scan alone.
- [ ] **Nothing forbidden committed:** secrets, `.pem`/`.key`, `node_modules/`,
      generated `out/`, built zips, third-party screenshots.
- [ ] If a tool id was added or renamed, both `.github/ISSUE_TEMPLATE/bad-page.yml`
      and `.github/ISSUE_TEMPLATE/bug.yml` name it — the `discover` job of
      `extensions.yml` greps the ROOT copies and goes red otherwise.

## What is still open

<!-- Anything this deliberately does not do, and who it is waiting on. -->
