# CLUB club-rt-store (lead 7185eb, 2026-10-02): 5 roadmap lanes in ONE branch and ONE PR
Owner deadline: everything complete by 2026-10-04. Implement the members below IN THIS ORDER on one branch, one PR, at least one
commit per member whose subject starts with the member lane name. Where a member brief says "your deps have landed / STOP and report if
<dep> is missing" and <dep> is an EARLIER MEMBER of this club, that dep is satisfied by the earlier commits on this branch: do not stop.
A member that cannot go green after ONE root-cause fix is DROPPED: revert its commits, list it in the PR body under "Dropped", and the
rest still land. Prefer the smallest correct implementation of each member's done-definition; never skip its red controls.
PR title: "Club club-rt-store: club-store-chain, build-provenance, aso-listings, release-notes, app2-dryrun". The PR body lists, per member, its Rows and Deploys lines.


---

## MEMBER 1 of 5: club-store-chain (P2; original brief club-store-chain-2026-10-01.md)
# Lane club-store-chain [Opus 5.5 · high · Acct3 · CLI]: store: rehearsals, then release bytes r2 on top, in one PR

Written by lead db0cc7 at 2026-10-02T05:53:52Z (mk-club.mjs). The owner asked to CLUB the queue so it finishes sooner: 2 queue items, one session, one PR. Headless: nobody can answer mid-run; the lead lands it.

## Members (in order)
1. **apply-store-rehears** (P2): APPLY the reviewed cloud draft `origin/lead/patches:lanes/club-rt-store/store-rehears.diff` (verify `patch.sha256` first; report `origin/lead/patches:lanes/club-rt-store/store-rehears.report.md`; drafted on BASE `31b0e65d413639259026ccc28253733f1dd9ddf4`). Original brief, authoritative for its rows, tests, red controls and Do/Rules: `C:/Users/localuserwin11/Documents/Claude/Projects/Nikatru_Platform_Private/research/session-2026-09-23/full-review-r2/dispatch/briefs/fix-store-rehearsals.md`.
2. **apply-rel-bytes-r2** (P2): APPLY the reviewed cloud draft `origin/lead/patches:lanes/club-rt-store/rel-bytes-r2.diff` (verify `patch.sha256` first; report `origin/lead/patches:lanes/club-rt-store/rel-bytes-r2.report.md`; drafted on BASE `31b0e65d413639259026ccc28253733f1dd9ddf4`). Original brief, authoritative for its rows, tests, red controls and Do/Rules: `C:/Users/localuserwin11/Documents/Claude/Projects/Nikatru_Platform_Private/research/session-2026-09-23/full-review-r2/dispatch/briefs/fix-release-bytes-r2.md`.

## How
- **ONE branch `club/store-chain`, ONE PR, ONE CI cycle.** Each member brief names its own branch and PR: IGNORE that, and use this club branch. Worktree `.worktrees/club-store-chain` from origin/main.
- **Order:** members in the order listed. For an APPLY member: `git apply --3way` its patch, resolve every seam against CURRENT main (later trains landed after its BASE; never revert their lines), and run ONLY what its draft report marks NOT RUN or failing. For a BUILD member: do its brief. Commit per member, the subject prefixed with the member lane.
- **Shared registers** (enforcement-index.json, guard-yield.json, chassis-ledger, channel/monitor/dod registers): never hand-merge generated output; re-run the generator (`tooling/**/gen-*.mjs`) after the last member and commit its output.
- **FIRST PUSH MUST GO GREEN (owner 2026-10-01: a red CI run wastes ~40 runner jobs and a cycle, and blocks other deployments).** Before the FIRST push:
  - run `node --test` on EVERY `tooling/ci/test/*.test.mjs` that names a file you changed (`grep -l` your changed paths across tooling/ci/test);
  - run `node tooling/scripts/affected-guards.mjs` and fix every finding (and commit any count or manifest it rewrites);
  - for Dart changes, run `flutter analyze` on each touched package (from the repo root with `--` paths; never a subdirectory pub get);
  - for new JS/TS in tooling/ or services/, avoid what CodeQL blocks: no exists-then-read (file-system race; read in try/catch), no `new RegExp(<input>)` (regex injection; allowlist or escape), no comparison between values of different types, no unvalidated path joins;
  - for PR bodies: exactly one `Rows:` line, and `Deploys:` naming every unit your paths trigger (`tooling/ci/lane-map.json`).
- **Guards BY NAME** before the push: every tooling/ci guard whose inputs any member touched, plus affected-guards. Never `--no-verify`.
- **The PR body, complete before the FIRST push, never edited after:** exactly ONE line starting `Rows:` (the union of the members' rows, or `Rows: none — <reason of 10+ chars>`), and NO other line anywhere that starts with `Rows:` after bullets and bold are stripped (write "Register rows" in prose; #1112 lost a CI cycle to this on 2026-10-01). Exactly ONE `Deploys:` line, the union. Then one section per member: what it changes, its red control, its row ids.
- **Push** with `timeout 900` in the FOREGROUND, then `git ls-remote`; watch CI with a foreground `gh run watch <id> --exit-status` until done (never run_in_background a push or a wait: ending your turn ends the session).
- **Red handling:** first red = ONE root-cause fix for the whole club. If a single member cannot be made green, DROP it (revert its commits; CI must be green for the rest), list it in the final report as `dropped: <lane> — <verbatim error>`, and append its lane name to `C:/Users/localuserwin11/Documents/Claude/Projects/Nikatru_Platform_Private/research/session-2026-09-23/lead-1m/clubs/club-store-chain.dropped` so the lead requeues it. A second red after the fix = STOP and report.
- **🔒 Owner locks that bind every member:** pipeline-first (build once in packages/tooling, apps adopt); everything from the pipeline (names, entity facts, secrets via the vault and manifests); plug-and-play vendors; AI is paid only (customer pays); privacy minimised; every environment release-ready; a pause must be resumable (commit early, per member).
- **Rules:** never print a secret or a vault value; never cd (git -C, absolute paths); never merge; never `--no-verify`; `timeout` on every external call. Final message (at most 6 lines: one per member, landed/dropped, plus the PR) also goes to `C:/Users/localuserwin11/Documents/Claude/Projects/Nikatru_Platform_Private/research/session-2026-09-23/lead-1m/clubs/club-store-chain-report.md`.

---

## MEMBER 2 of 5: build-provenance (P2.5; original brief build-provenance-2026-10-02.md)
# Lane build-provenance [Opus 5.5 · high · Acct1 · Cloud]: every release artifact carries a free GitHub build-provenance attestation, verified in the release lane

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `ci/build-provenance`, one PR in Public, from an up-to-date origin/main.
No deploy; the next release carries it. Your dep club-store-chain (release bytes to R2, scheduled store rehearsals; both edit the release
workflows) has landed when you start: STOP and report if it is still open at your base.

**Owner direction (2026-10-02):** "full packed features till 2026". The lead decided: build-provenance attestations (free); SBOM stays deferred.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 26: "**SBOM**, not-built/04 'Semgrep, and Syft for SBOM': 'Syft has no driver for this stack yet; **free GitHub artifact
  attestations cover the provenance need first**', reversed by 'an SBOM being required by a distribution channel or a customer'. The
  apps.gov.in form has NO SBOM field (`O-APPS-GOV-IN-SBOM`, confirmed 2026-09-22)." Missing: "**Build-provenance attestations are not
  wired** (zero `actions/attest*` in `.github/`), although the cut itself names them as the first step."
- Ranked gap 11: "Free on public repos. The SBOM cut names it as 'first'. Cheap supply-chain evidence for apps.gov.in and stores."
- Existing: "zizmor; SHA-pinned actions; `SHA256SUMS` plus `release.json` (P4-5). Signing: ADR 097, signed Apple builds, Ed25519 packs."

## Do (each with a red control that fails without it)
1. **Attest every release artifact.** In the release workflow(s), after the artifacts and `SHA256SUMS` exist, run
   `actions/attest-build-provenance` (SHA-pinned; read its README at your base for the current inputs) over every artifact the release
   publishes (Android bundles and APKs including the apps.gov.in build, Windows packages, macOS and iOS archives where they are release
   artifacts, the Linux snap, the web bundle archive, extension zips). The attest job alone gets `id-token: write` and
   `attestations: write`; everything else keeps least privilege. Red: a static guard fails when an artifact named in the release manifest
   has no attestation step, or when another job gains `id-token: write`.
2. **Verify in the release lane.** Before a release is marked done, `gh attestation verify <artifact> --repo <owner/repo>` (with the
   workflow's token) for every artifact; record the attestation reference per artifact in `release.json`. Red: a unit test of the verify
   wrapper with a stubbed `gh` that reports a digest mismatch fails the release step.
3. **Say it where it helps.** A short `docs/release/verify-a-download.md` on how anyone verifies a download with
   `gh attestation verify`, named in the apps.gov.in evidence pack. Leave `SECURITY.md` alone: it regenerates the apex site's
   `security-policy.txt`, which would make this a site deploy. Red: the verify wrapper's test asserts the doc exists at the path the
   wrapper's `--help` prints; deleting the doc fails it.
4. **SBOM stays deferred**: write nothing for SBOM; note the reversal trigger in the PR body.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- The release bytes, R2 upload and store rehearsal steps (club-store-chain, landed): add the attest and verify steps beside them only.
- `tooling/release/` scripts other than a new verify wrapper (lane release-notes adds a notes check there after you).
- ci.yml's push/dispatch handling and `land.yml` (gh-merge-orchestrator); deploy workflows (web-previews, club-apply-ci).
- `sites/**`, money files, AI files (port-ai #1136, T17), the i18n pipeline internals (branch `i18n/pipeline`).

## Rows
NEW O-RELEASES-HAVE-NO-PROVENANCE (closes here; the first real release proves it). Exactly one `Rows:` line.

## Deploys
None.

## Lead steps (not run here; list them in the PR body)
The next release run (a dispatch) proves the attestations; the lead runs one `gh attestation verify` by hand on a downloaded artifact.

## Rules (every lane)
- Pipeline-first: the attest and verify steps are shared by every app's and extension's release path; a new app gets them by stamping.
- Feature parity: every target's release artifact is attested in this PR, or the body names the one that waits and why.
- Privacy-minimal. Adults only (ADR 068). AI is paid only.
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, or dispatch a workflow from the
  cloud: list each under "Lead steps". Never merge. Never `--no-verify`. Never edit Private. Generated files are regenerated with their
  generators (`--check` makes a hand edit red).
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (the workflow-permission and action-pinning guards, zizmor). LAST: `assert-guard-coverage.mjs`; commit its ratchet row.
- The PR body is complete before the first push (`Rows:` once, `Deploys: none`, one row per Do item with its red control, the Lead steps,
  the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- Actions are SHA-pinned (a tag pin fails CI); BSD `sha256sum` on macOS runners has no `--check` (use `shasum -a 256 -c`).
- MSYS mangles refspecs; `gh api` paths take no leading slash.
- vacuous-03: redden every new check. grep-17: cite by anchor. agents-03: absolute paths only. agents-21: do not spawn agents.

---

## MEMBER 3 of 5: aso-listings (P1; original brief aso-listings-2026-10-02.md)
# Lane aso-listings [Opus 5.5 · high · Acct1 · Cloud]: researched, per-locale store listings and screenshots for every channel, generated from one tree and the locale register

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `store/aso-listings`, one PR in Public, from an up-to-date origin/main.
**Nothing is published by this lane: every store publish is the owner's final approval.** Your deps have landed when you start:
i18n-pipeline (the ONE locale register, branch `i18n/pipeline`) and prep-play-first-release (the Play release files). STOP and report if
the locale register is missing at your base.

**Owner direction (2026-10-02, verbatim):** "Our main goal is maximum profits margins", "full packed features till 2026". The lead
decided: ASO research plus per-locale store listing text and screenshots, wired to the locale register. The language decision (lane
priv-site-buildout-adr's second ADR, landing in Private) REVERSES the cut on "localized store metadata", targets 27 locales from ONE
register, and makes an INDEPENDENT agent review (a second model run: back-translation, fluency, placeholder and length checks) the review.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 24: "Per-channel tree `apps/<id>/store/<channel>/` (title, subtitle, `keywords.txt` iOS/macOS, `search-terms.txt` Windows,
  `promotional-text.txt`); INV-1011 (brick emits the full tree); #1144 (screenshot ink classes, every channel); ... not-built/03 'Writing
  ASO best-practice requirements now', reversed by '**A store submission being scheduled**'. That trigger has fired: `prep-play-first-release`,
  and apps.gov.in submits by 10 Oct." Missing: "No keyword research pass. No Play custom store listings or Apple custom product pages. No
  promotional-text cadence. `O-STORE-SCREENSHOTS` RED ... `O-LISTING-COPY-HAND-KEPT-PER-CHANNEL`."
- Ranked gap 8: "Conversion at first publish is the cheapest revenue there is."
- i18n audit §3.4 (verbatim): "`apps/subscriptiontracker/store/{android-play,apps-gov-in,ios-appstore,linux-snap,macos-appstore,windows-store}`:
  flat `title.txt`, `short-description.txt`, `long-description.txt`, `keywords.txt` and so on. **There is no locale level in the folder
  layout.** ... Screenshots are English only (captured from the app in en). `tooling/release/submit-play.mjs:194` sets
  `const LISTING_LANGUAGE = 'en-US'` and refuses if the app's default language differs (`:1234`)."

## Do (each with a red control that fails without it)
1. **A locale axis in the store tree.** `apps/<id>/store/<channel>/<store-locale>/...` with `en-US` as today's flat files moved (git mv,
   so history follows); the brick emits the same shape (INV-1011); every guard and tool that reads the flat paths moves in the SAME commit
   (store-metadata guards, `submit-*.mjs`, the screenshot pipeline). The store locale codes map from the ONE locale register through a
   per-channel table (each store's supported listing languages, read from its docs with URL and `readAt`; an unsupported locale is skipped
   with its reason). Red: a register locale with no mapping and no skip reason fails; `LISTING_LANGUAGE` as a literal fails.
2. **Research, cited.** `apps/<id>/store/aso/research-<date>.md`: per channel and locale, the jobs users search for, keyword candidates
   from the app's own feature register and strings, and competitors' public listing pages (URL and date per quote; facts only; never a
   competitor's price without its date). No paid tool, no scraping of private APIs. Then per channel and locale the chosen title,
   subtitle/short description, keywords or search terms and promotional text.
3. **Limits and claims, guarded.** Every field within its store's documented limit (from the docs, `readAt` recorded); no web price and no
   word about commission in any store text or screenshot (ADR 078: the store listing mentioning the web price is "never"); no AI claim
   unless a customer-pays row exists (the paid-calls register); never "free AI"; adults-only category choices (ADR 068: never a kids or
   family category); no competitor names in Apple keywords. Red: a fixture keyword field one character over fails; a fixture listing
   naming a web price fails; a fixture "AI import" claim with no customer-pays row fails.
4. **Per-locale text, agent-translated and agent-reviewed.** Translate the English listing into every supported register locale inside this
   session (no translation API: ADR 033), then run the i18n pipeline's translation-QA harness and commit its review sheet per locale (an
   independent pass; mark it machine-assisted). A locale whose sheet fails stays `pending`. Red: a locale with listing files and no passing
   review sheet fails the guard.
5. **Per-locale screenshots.** Extend the store-screenshot pipeline (#1144) to capture per supported locale (the capture driver sets the
   app's locale; same seeded board; each set with its `CAPTURE.json`), never showing a web price. Capturing runs in CI or on the sandbox
   (a lead dispatch); this lane builds the driver and the per-locale manifests. Red: a locale with listing text and no screenshot manifest
   is reported `pending`, never silently English.
6. **Custom listings and cadence, as data.** Play custom store listings and Apple custom product pages as config (audience, locale,
   text, screenshot set), plus a promotional-text calendar; the submit tools' dry runs print the exact payloads. Creating or publishing
   them is a lead step plus the owner's publish approval. Red: a dry run that would publish exits non-zero without the publish flag.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- Release notes / "What's New" text: lane release-notes owns it next (move today's `release-notes.txt` into the locale axis unchanged).
- The locale register and the translation harness themselves (i18n-pipeline): use them; if they need a change, STOP and report.
- Data-safety, privacy manifests and age-rating files (privacy and consent lanes); `sites/**`; money files; AI files (port-ai #1136, T17);
  the merge orchestrator (branch `ci/merge-orchestrator`). Terms and refund wording is the OWNER's (ADR 031 class B, ADR 100).

## Rows
O-LISTING-COPY-HAND-KEPT-PER-CHANNEL (closes, or name what is left); NEW O-STORE-LISTINGS-ENGLISH-ONLY (closes here); NEW
O-ASO-RESEARCH-NEVER-RUN (closes here); O-STORE-SCREENSHOTS (advances: per-locale capture). Exactly one `Rows:` line.

## Deploys
None. Nothing is published.

## Lead steps (not run here; list them in the PR body)
Dispatch the per-locale screenshot capture; create custom listings / product pages in the consoles; every store publish is the owner's
final approval at the publish sitting.

## Rules (every lane)
- Pipeline-first: the locale axis, the limits guard and the per-locale capture live in `tooling/` and the brick; a new app gets them by stamping.
- Feature parity: every channel of the seven targets (Play, App Store, Mac App Store, Microsoft Store, Snap, apps.gov.in, and the web
  page's metadata) gets the axis in this PR, or the body names the channel that waits and why.
- Privacy-minimal (screenshots use the seeded board, never real data). Adults only (ADR 068). AI is paid only, and never advertised free.
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, the store consoles, or dispatch a
  workflow from the cloud: list each under "Lead steps". Never merge. Never `--no-verify`. Never edit Private. Generated files are
  regenerated with their generators.
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (the store-metadata guards, the stamp property and fidelity guards). LAST: `assert-guard-coverage.mjs`; commit its ratchet row.
- The PR body is complete before the first push (`Rows:` once, `Deploys: none`, one row per Do item with its red control, the Lead steps,
  the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- Moved code silences guards: when you move the store tree, run the OLD guards against the new layout and prove each still fails on a mutation.
- vacuous-03: redden every new check. grep-17: cite by anchor. agents-03: absolute paths only. agents-21: do not spawn agents.

---

## MEMBER 4 of 5: release-notes (P2; original brief release-notes-2026-10-02.md)
> LEAD OVERRIDE (dep flattening 2026-10-02): these deps no longer gate this member; any "STOP and report" line naming them is VOID: lifecycle-mail; build-provenance (still: edit no workflow YAML).

# Lane release-notes [Opus 5.5 · high · Acct1 · Cloud]: one release-notes source feeds every store's "What's New", an in-app what's-new sheet, and a site changelog with a feed

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `release/notes-one-source`, one PR in Public, from an up-to-date origin/main.
It deploys the apex site and the web app, so it MERGES ALONE. Your deps have landed when you start: aso-listings (the per-locale store
tree), lifecycle-mail (the last chassis/Settings and privacy edit before you) and build-provenance (the last edit to the release
workflows and `tooling/release/` before you). STOP and report if the store tree has no locale axis at your base.

**Owner direction (2026-10-02):** "full packed features till 2026". The lead decided: one release-notes source -> store What's New,
in-app what's-new, site changelog + feed. The site half is also decided by the site ADR (lane priv-site-buildout-adr): "REVERSE the cut on
a changelog + RSS/Atom feed for nikatru.com, generated from release notes (no CMS, no blog platform)". Store submission stays the owner's
publish approval.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 23: "Extensions: `extensions/*/CHANGELOG.md` and `extensions/scripts/changelog-section.mjs`. Play:
  `apps/subscriptiontracker/store/android-play/release-notes.txt` only. **ADR 103 (2026-10-02) reverses stage-12 cut 7:** 'a generated
  changelog and Atom feed' for the sites. surfaces `missing` 'Changelog / what's-new: absent' (in-app)." Missing: "No in-app what's-new
  sheet. **No 'What's New' source for iOS/macOS/Windows/Snap.** App Store requires that field on every update. No single release-notes
  source feeding stores, site and app."
- Ranked gap 7: "App Store needs the field on every update. Only Play has a file."
- nikatru.com audit D1: "**Changelog / release notes** (`/changelog`) + **RSS/Atom** ... Generate from
  `apps/subscriptiontracker/store/android-play/release-notes.txt`, `extensions/Extension/Full_Screen_Shot/CHANGELOG.md` and release tags."

## Do (each with a red control that fails without it)
1. **ONE source per product**: `apps/<id>/release-notes/<version>.yaml` (and the same for each extension): version, date, items (each with
   kind: new / improved / fixed, the platforms it applies to, optional `fixes` report ids for lane feedback-triage's notices), and a
   per-locale text block whose locales come from the ONE locale register. The extensions' `CHANGELOG.md` becomes GENERATED from it (keep
   `changelog-section.mjs` working). Red: a release record without a source entry fails the release lane's check.
2. **Store "What's New", every channel.** A generator writes each channel's field per locale into the store tree (Play, App Store, Mac App
   Store, Microsoft Store; Snap and apps.gov.in where their listing has such a field; say which do not), within each store's documented
   limit (docs URL and `readAt` recorded), filtered by platform. No web price, no commission wording (ADR 078), no AI claim without a
   customer-pays row. Red: an item tagged `ios` only never appears in the Play text; a text one character over a limit fails.
3. **In-app what's-new sheet**, in a shared package adopted through the chassis: shown once after an update to a version with
   user-visible items, dismissible, reachable again from Settings > Help; never shown on first install; localised; accessible. Red: a
   widget test shows it once after an upgrade and never on first run.
4. **Site changelog and feed.** Generated `/changelog` page(s) on nikatru.com (a generator in `tooling/sites/regen.mjs` ORDER, `--check`),
   an Atom feed at a stable URL, `<link rel="alternate">` from the page, the sitemap row and `llms.txt` key pages via
   `generate-discovery.mjs`, a footer link through `chrome.mjs`; git-true `lastmod`. Red: `check-site-integrity` fails if the feed does not
   parse or a released version is missing from it.
5. **Per-locale text, agent-translated and agent-reviewed** through the i18n pipeline's translation-QA harness (no translation API);
   a locale whose review sheet fails ships English for that release and says so. Red: a locale text without a passing sheet fails.
6. **Release wiring, in tooling only.** The release tooling the workflows already run (under `tooling/release/`) reads the source for the
   version it builds and refuses a store-bound release whose notes are missing for any channel it targets; the submit tools' dry runs
   print the What's New payload. Edit no workflow YAML (lane build-provenance edits the release workflows). Red: a dry run for a version
   with no notes exits 1.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- Listing text, keywords, screenshots (aso-listings, landed); every `.github/workflows/*` file (build-provenance edits the release
  workflows; club-store-chain the release bytes; the merge orchestrator ci.yml).
- `sites/nikatru/{privacy,terms,refund,pricing}.html` and `apps/*.html` text (privacy lanes; the OWNER's wording; the India rail).
- Money files; AI files (port-ai #1136, T17); the i18n pipeline internals (branch `i18n/pipeline`); the merge orchestrator (branch
  `ci/merge-orchestrator`); `sites/rajasekarselvam/**` (its writing/feed is site-rs-wave2's, from the owner's posts).

## Rows
NEW O-RELEASE-NOTES-NO-SINGLE-SOURCE (closes here); NEW O-APP-STORE-WHATS-NEW-MISSING (closes here); NEW O-IN-APP-WHATS-NEW-MISSING
(closes here); NEW O-SITE-CHANGELOG-MISSING (closes here). Exactly one `Rows:` line.

## Deploys
The apex site unit (`nikatru-site`) and `subscriptiontracker-web`, as `tooling/ci/lane-map.json` names them; native targets through CI
builds; nothing is submitted to a store.

## Lead steps (not run here; list them in the PR body)
Every store submission that carries the generated text is the owner's publish approval.

## Rules (every lane)
- Pipeline-first: one source schema, one generator per surface, in `tooling/`; the brick stamps an empty source for a new app.
- Feature parity: all seven targets get their what's-new path in this PR (store field or in-app sheet), or the body names the one that waits.
- Privacy-minimal: the sheet's "seen" state is local only. Adults only (ADR 068). AI is paid only.
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, the store consoles, or dispatch a
  workflow from the cloud: list each under "Lead steps". Never merge. Never `--no-verify`. Never edit Private. Generated files are
  regenerated with their generators (`--check` makes a hand edit red).
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (store-metadata guards, `check-site-integrity`, the extension policy check). LAST: `assert-guard-coverage.mjs`; commit its row.
- The PR body is complete before the first push (`Rows:` once, `Deploys:`, one row per Do item with its red control, the Lead steps,
  the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash. git-09/git-10: root `pubspec.lock`; use melos.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- ci-49 (sites): after any `sites/**` change run `node tooling/sites/generate-discovery.mjs`, then
  `node tooling/ci/check-site-integrity.mjs . sites/nikatru sites/rajasekarselvam`, and commit what they write. Sitemap `lastmod` is the
  git date (ci-49), never typed.
- vacuous-03: redden every new check. grep-17: cite by anchor. agents-03: absolute paths only. agents-21: do not spawn agents.

---

## MEMBER 5 of 5: app2-dryrun (P2.5; original brief app2-dryrun-2026-10-02.md)
# Lane app2-dryrun [Opus 5.5 · high · Acct1 · Cloud]: a scheduled rehearsal stamps a throwaway app #2 from the brick, runs every lane dry, and measures time-to-ship

Written by lead 7185eb on 2026-10-02 09:27Z. One branch `kit/app2-dryrun`, one PR in Public, from an up-to-date origin/main.
No deploy. Your deps have landed when you start: club-store-chain (scheduled store rehearsals and release bytes), club-worker-kit-followers
(the brick Worker at parity, the worker-kit ports) and i18n-pipeline (the brick at locale parity). STOP and report if one is missing.

**Owner direction (2026-10-02):** "Our main goal is maximum profits margins" (the business is a portfolio of apps; the second app's
cost is the margin lever). The lead decided: an app #2 dry run that measures time-to-ship from the brick.

**Why (pipeline capability audit, 2026-10-02, verbatim):**
- Row 31, "New-app time-to-ship (brick -> store-ready app #2)", PARTIAL, **unmeasured**: "`tooling/kit/stamp-app.mjs`,
  `tooling/kit/new-product.mjs` (`plan <id> --check`, #1036), `new-channel.mjs`, `entity-change.mjs`; ci.yml stamp probe;
  `O-NEW-APP-IS-NOT-ONE-COMMAND` done (#976). **28 open register rows name 'app #2', 2 of them red**: `O-STORE-RECORDS-ARE-ONE-PER-CHANNEL`,
  `O-NATIVE-AUTH-CALLBACK-UNBUILT`. Others: `O-BRICK-STAMPS-WEB-ONLY`, `O-CI-AND-WORKER-LANES-NAME-ONE-APP`, `O-STORE-LANES-HARD-WIRE-ONE-APP`,
  `O-E2E-LANE-WIRED-TO-ONE-APP`, `O-SCREENSHOT-DRIVER-IS-ONE-APPS`, `O-PRODUCT-RECORD-UNBUILT` and more." Missing: "**No measured stamp ->
  store-ready time and no rehearsal.** No row or metric holds 'hours to app #2'."
- Ranked gap 14: "Scheduled: stamp a throwaway app, run every lane in dry-run, record wall-clock and every manual step as a
  `{value, asOf, verify}` fact ... The business model is a portfolio. 28 open rows say app #2 is not yet one command, and nothing measures it."
- Also: "`O-BACKUP-AND-FANOUT-SETS-HAND-LISTED` (an app #2 DB is never exported)" (row 27). Note that registers lag merges: re-measure
  each row's claim at your base before you rely on it.

## Do (each with a red control that fails without it)
1. **`tooling/kit/rehearse-app2.mjs`**: in a temporary work tree (never committed), plan and stamp a throwaway app id (`rehearsal-<date>`)
   with the existing kit, then run every lane in its dry-run mode: analyze and tests for the stamped app, the web build, the native build
   configs (CI legs only where the runner allows), the brick Worker, the legal and privacy generators, the site landing and catalogue
   generators on a temp copy, the store tree and every channel submitter's dry run, the E2E lane's target selection, the backup and
   erasure fan-out sets, the release lane's plan. Nothing is deployed, published or created anywhere. Red: a deliberately broken step in
   a fixture brick is reported as that step's failure, never as an overall pass.
2. **Every step timed, every manual step named.** The output is one JSON: per step `{name, seconds, result, manual: bool, why, row}`; a
   step needs a human, a console, a credential or a hand edit -> `manual: true` with the register row that owns it (map the 28 app #2 rows
   above to steps; an unmapped manual step is a finding). Totals: automated minutes, manual steps count, and the estimated time-to-ship
   as a `{value, asOf, verify}` fact. Red: a step that hand-edits a file the kit should own is flagged `manual`, and the run exits 1 when a
   manual step has no row.
3. **Scheduled, on GitHub-hosted runners, no secrets.** A weekly workflow (`workflow_dispatch` plus `schedule`) that runs the rehearsal
   with least-privilege permissions, uploads the JSON as an artifact and prints the totals; it reads no secret and writes nothing to the
   repo. Red: the workflow guard fails if the job declares a secret or a write permission.
4. **A trend, not a snapshot.** A small reader compares the newest run with the previous artifact and prints what got faster, slower, newly
   manual or newly automated. Red: a fixture pair where one manual step became automated prints it.

## Do NOT touch (owned by lanes in flight; a conflict is a STOP)
- **Standing list (in flight on 2026-10-02; applies to every lane):** the `sites/nikatru` pages five lanes edit (club-identity-boxc
  PR #1140, the privacy bump; apply-india-rail PR #1149; club-apply-ci, the site set and discovery; apply-public-registers-hygie, the
  seller sentences; port-auth, `js/signin.js`; plus site-nk-shots PR #1151, the screenshots); `sites/nikatru/privacy.html` (#1140, until
  it merges); `sites/nikatru/{pricing,terms}.html` and the product pages `sites/nikatru/apps/*.html` (India rail #1149); the AI lanes
  (port-ai PR #1136, train-st-ai-customer-pays T17); the payments money lanes (port-pay-core, fix-payments-idempotency,
  train-st-money-ready #1114, fix-store-rails-live, port-store-direct); the i18n pipeline lane (branch `i18n/pipeline`); the merge
  orchestrator (branch `ci/merge-orchestrator`). Where your deps put you after one of them, edit only what this brief names of theirs.
- The kit's and the brick's behaviour (read and run them; a fix you find is a finding in the PR body, not a change here); store submit
  tools and their credentials; release workflows (build-provenance; club-store-chain).
- `sites/**`, money files, AI files (port-ai #1136, T17), the i18n pipeline internals (branch `i18n/pipeline`), the merge orchestrator
  (branch `ci/merge-orchestrator`).

## Rows
NEW O-TIME-TO-SHIP-UNMEASURED (closes at the first scheduled run's recorded fact, not at merge). Exactly one `Rows:` line.

## Deploys
None.

## Lead steps (not run here; list them in the PR body)
Dispatch the first run; copy its time-to-ship fact into the Private registers; turn each unmapped manual step into a row or a lane.

## Rules (every lane)
- Pipeline-first: the rehearsal uses only the kit and the lanes' own dry-run modes; it adds no parallel path.
- Feature parity: the rehearsal covers all seven targets (web, Android, iOS, macOS, Windows, Linux, apps.gov.in) and the extensions'
  template; a target it cannot exercise on a hosted runner is listed with the reason.
- Privacy-minimal: fixtures only, no real data. Adults only (ADR 068). AI is paid only.
- Never print a secret. Never touch live systems, the vault, Box B/C, the Cloudflare dashboard or API, the store consoles, or dispatch a
  workflow from the cloud: list each under "Lead steps". Never merge. Never `--no-verify`. Never edit Private. Generated files are
  regenerated with their generators.
- The evidence was read at Public `origin/main` e10239a1 (2026-10-02); main moves. Re-find each anchor at your base.
- Headless: every command in the FOREGROUND with `timeout`; never background a push or a CI watch.
- Work in a worktree under `.worktrees/`. Before the push: `node tooling/scripts/affected-guards.mjs` AND every guard that reads a file you
  touched (the workflow guards, `assert-guard-set.mjs`). LAST: `assert-guard-coverage.mjs`; commit its ratchet row.
- The PR body is complete before the first push (`Rows:` once, `Deploys: none`, one row per Do item with its red control, the Lead steps,
  the 🤖 line) and is never edited after.
- Push in the FOREGROUND (`timeout 900`), then `git ls-remote`; watch ci-gate in the foreground; first red: ONE root-cause fix; second red: STOP.
- Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Final message (at most 8 lines).

## Traps (quoted; auto-memory is not loaded into a lane)
- git-01: prefix `MSYS_NO_PATHCONV=1` on `git show <ref>:<path>` under Git Bash. git-09: a `flutter` command in a subdirectory rewrites
  the root `pubspec.lock`; the rehearsal's temp tree must never touch the real one.
- shell-01/02: capture `code=$?` on its own line. shell-10: write scripts to files.
- Actions are SHA-pinned; workflows declare least-privilege `permissions:` (zizmor runs in CI).
- vacuous-03: redden every new check. grep-17: cite by anchor. agents-03: absolute paths only. agents-21: do not spawn agents.
