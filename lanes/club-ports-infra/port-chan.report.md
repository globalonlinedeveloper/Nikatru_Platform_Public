I couldn't do everything the brief named: `publish-catalog.mjs` doesn't follow the contract (reasons below) and there was no Dart work. Everything else is drafted, and every test, guard and red control I ran came out as the brief expects. Nothing was uploaded, submitted or published, and no store terms were accepted.

BASE: 92dd961a1bed271b122e5b6515019cbd357f37ea
HEAD: 5e0758bcff320be734cde0a23061c2e2a6189cec (three local WIP commits, sandbox only)

| # | Check | Command | Exit | Expected |
|---|---|---|---|---|
| 1 | Contract suite (29 tests) | `node --import ./tooling/scripts/spawn-ceiling.mjs --test-timeout=600000 --test "tooling/release/test/*.test.mjs"` | 0 | green ✅ |
| 2 | Kit test (8) | `node --test tooling/ci/test/new-channel.test.mjs` | 0 | green ✅ |
| 3 | Port guard tests (45, 5 new reds) | `node --test tooling/ci/test/ports.test.mjs` | 0 | green ✅ |
| 4 | Port guard | `node tooling/ci/assert-ports.mjs` (channels claims L2, earns L3; candidate printed) | 0 | green ✅ |
| 5 | Port switch dry run | `node tooling/ops/port-switch.mjs channels --to amo --dry-run` | 2 | C8 margin is LOST: there is no fee model for moving a channel. Recorded in the README ⚠️ |
| 6 | Port switch tests | `node --test tooling/ci/test/port-switch.test.mjs` | 0 | green ✅ |
| 7 | Preflight coverage test | `node --test tooling/ci/test/preflight-ci-gate-coverage.test.mjs` | 0 | green ✅ |
| 8 | affected-guards (1st run) | `node tooling/scripts/affected-guards.mjs --base 92dd961a… --jobs 6` | 1 | 3 real findings, fixed in rows 9–11. 10 environmental (red at base too). 25 skipped for budget, run in row 12 |
| 9 | ↳ enforcement index | `build-enforcement-index.mjs --write`, then `assert-enforcement-index.mjs` | 0 / 0 | green after the regenerate ✅ |
| 10 | ↳ `windows-store-submission.test.mjs` | its copied temp tree lacked `contracts/`; I made the vocabulary import lazy | 0 (row 12) | green ✅ |
| 11 | ↳ coverage manifest rewritten | committed the ratchet (`new-channel` 8, `ports` 40→45) | — | ✅ |
| 12 | The 25 budget-skipped tests + 2 that failed | `node --test --test-concurrency=6 <27 files>` | 0 | 1,209 passed, 0 failed ✅ |
| 13 | Other guards | `assert-channel-register`, `assert-release-provenance`, `assert-vendor-portability`, `assert-ports`, extensions `selftest.node.js` | 0 each | green ✅ |
| 14 | Dry-run output compared with base, 12 invocations | the 5 CI dry runs; play with no mode; snap/windows/appstore `--submit`; cws, edge, amo dry run | same codes (0×6, 1×6) | output byte-identical to base ✅ |
| 15 | RED: `plan` removed from `snapSubmitter` | contract suite | 1 | red ✅ (reverted) |
| 16 | RED: `snapSubmitter.plan` calls `fetch` | contract suite | 1 | red ✅ (reverted) |
| 17 | RED: kit dry run writes | `new-channel.test.mjs` | 1 | red ✅ (reverted) |
| 18 | RED: AMO `gecko.id` rule removed | contract suite | 1 | red, 2 tests ✅ (reverted) |
| 19 | Green after the reverts | contract suite + kit test | 0 | green ✅ |
| 20 | LAST: guard coverage | `node tooling/ci/assert-guard-coverage.mjs` | 0 | green ✅ |

**Deviations and what I couldn't do:**
- **The submit scripts' CLI:** each one ran its whole CLI the moment it was imported, so the test couldn't import it. The body is now `cli()`, called only when the file is run directly. I deliberately did not re-indent the body, so patches from fix-store-rehearsals and fix-release-bytes-r2 still apply.
- **`publish-catalog.mjs` does not follow the contract.** It writes `catalog/extensions.json` and never talks to a store. The extension stores' real submitters are `publish-cws.mjs`, `publish-edge.mjs` and `publish-amo.mjs`, and those three now follow it.
- **`channels.json` needed small changes to the port standard.** The store vendors can't be adapters: the Apple vendor would be placed twice, and five stores aren't in any vendor register. So each adapter names its `channel` row and leaves `vendor` null. I added optional `channel`, `account` and `candidates` to the schema and README, and changed `assert-ports` limbs 1 and 8 (tests added).
- **apps-gov-in is `external`:** it has no submission API, so it has no code submitter.
- **`claimed: 2` stays.** The guard says it earns L3, but no upload has ever run.
- **The Indus candidate lives only in `channels.json`.** It has no `channel-register.json` row, because a row would need facts nobody has read yet. The kit's `--write` adds the row later.
- **`port-switch.mjs`:** I changed only the C1 label, which wrongly said "a fake" for channel adapters.
- **CI wiring:** I added a step to ci.yml `app-dryrun` and to preflight's dry-run leg, so the contract test actually runs.
- **Hooks:** my first local WIP commit used `--no-verify`. No hooks are installed here; the later commits didn't use it.
- **`--submit` refusal paths:** in row 14 I ran `--submit` with no confirm word, no credentials and no GitHub Actions environment. All three refused before any network call.
- **No Dart and no `pubspec.lock` changes.**
- Every anchor in the brief matched the base.
- **Files shared with the other release lanes:** `tooling/release/submit-common.mjs`, `submit-play.mjs`, `submit-snap.mjs`, `submit-windows-store.mjs` and `submit-appstore.mjs`, plus `.github/workflows/ci.yml`.

**PR body, for the local writer.** The draft body is at `scratchpad/pr-body.md`. Its key content, the custody runbook for the Private pass, is this:

| Channel | Key kind | What a sole proprietorship → Pvt Ltd change does |
|---|---|---|
| ios / macos | distribution-certificate | Individual → Organization needs a D-U-N-S number and a team change; certificates and profiles are reissued; bundle ids stay |
| android-play | upload-key | An app transfer keeps the package id and the upload key |
| windows-store / edge-addons | none | The Partner Center account type changes; never edit an API-created submission in Partner Center (stores-07) |
| chrome-webstore | none | The verified publisher (the proprietor's legal name) changes; the item id stays |
| amo | none | `gecko.id` is unchanged — it is permanent (stores-01) |
| apps-gov-in | app-signing-key | The profile owner changes; the signing key must be kept safe through the change |
| linux-snap | none | The snap name's publisher account moves |

The body also carries `Rows: O-CHANNELS-HAVE-NO-SUBMIT-CONTRACT (NEW, closes here)` and `Deploys: none`.

```
 .github/workflows/ci.yml                          |   4 +
 extensions/scripts/publish-amo.mjs                |  35 ++
 extensions/scripts/publish-cws.mjs                |  22 +-
 extensions/scripts/publish-edge.mjs               |  22 +-
 tooling/ci/assert-ports.mjs                       |  35 +-
 tooling/ci/test/coverage-manifest.json            |   5 +-
 tooling/ci/test/new-channel.test.mjs              | 118 +++++++
 tooling/ci/test/ports.test.mjs                    |  42 ++-
 tooling/enforcement-index.json                    |   1 +
 tooling/kit/new-channel.mjs                       | 239 +++++++++++++
 tooling/ops/port-switch.mjs                       |   2 +-
 tooling/ports/README.md                           |  10 +
 tooling/ports/channels.json                       | 389 ++++++++++++++++++++++
 tooling/ports/port.schema.json                    |  52 +++
 tooling/release/submit-appstore.mjs               |  34 +-
 tooling/release/submit-common.mjs                 | 303 ++++++++++++++++-
 tooling/release/submit-play.mjs                   |  38 ++-
 tooling/release/submit-snap.mjs                   |  30 +-
 tooling/release/submit-windows-store.mjs          |  39 ++-
 tooling/release/test/fixtures/submitters.json     | 182 ++++++++++
 tooling/release/test/submitters.contract.test.mjs | 252 ++++++++++++++
 tooling/scripts/preflight.mjs                     |   3 +-
 22 files changed, 1842 insertions(+), 15 deletions(-)
```

