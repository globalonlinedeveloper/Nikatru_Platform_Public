BASE: 31b0e65d413639259026ccc28253733f1dd9ddf4
HEAD: d65978ebb740a095638be5dd3c4a00ad7400eb7b (a local sandbox commit; nothing was pushed)

The patch is complete and every node test and guard is green, but no box or backup destination was actually read. The sandbox has no SSH access and no vault, so each read-back exits 2 (unreachable) and four of the five drills exit 2 (no file named yet). The local writer has to run both, fill the declarations, and record the results.

| # | Check | Command | Exit | Expected → result |
|---|---|---|---|---|
| 1 | Box tests with real restic 0.18.1 (downloaded to scratch) | `RESTIC_BIN=<scratch>/restic node --test tooling/ci/test/boxes.test.mjs` | 0 | green (47/47) |
| 2 | Box tests as CI runs them, without restic | `node --test tooling/ci/test/boxes.test.mjs` | 0 | green (46 pass, the real-restic case skipped with a stated reason) |
| 3 | Ports tests | `node --test tooling/ci/test/ports.test.mjs` | 0 | green (44/44) |
| 4 | Port-switch tests | `node --test tooling/ci/test/port-switch.test.mjs` | 0 | green (21/21) |
| 5 | assert-ports on the tree | `node tooling/ci/assert-ports.mjs` | 0 | green; boxes claims L2 and earns L2 |
| 6 | RED patch 3: `hostinger` put back in `_non-port.json` (real tree, reverted) | `node tooling/ci/assert-ports.mjs` | 1 | red, limb 8 placed 2 times (boxes/boxb, _non-port) ✓ |
| 7 | RED patch 3: the base `assert-ports.mjs` run over the new tree (reverted) | `node tooling/ci/assert-ports.mjs` | 1 | red, hostinger placed twice (boxb, boxc) ✓, so the limb-8 change is needed |
| 8 | RED patch 2: the real boxb declaration plus one undeclared running container | `node tooling/ops/check-box-declared.mjs boxb --observed <stray.json>` | 1 | red, DRIFT names `miner-1` ✓ |
| 9 | Read-back of the real boxb with a matching observation | `… boxb --observed <match.json>` | 2 | LOST, because the declaration still has fields not yet read (null until the first read-back) ✓ |
| 10 | Read-back of boxa, boxb and boxc (no SSH settings here) | `node tooling/ops/check-box-declared.mjs <box>` | 2 / 2 / 2 | unreachable ✓ (no address printed) |
| 11 | RED patch 4: `--dry-run` omitted | `node tooling/ops/box-move.mjs --from boxb --to kvm8.json` | 2 | refused ✓ |
| 12 | RED patch 4: real boxb with one measured use, moved to a target too small (reverted) | `… --from boxb --to tiny.json --dry-run` | 1 | FAIL C1 capacity ✓ (fixture case in the tests as well) |
| 13 | box-move of the real boxes to a KVM 8 spec | `… --from boxb/boxc/boxa --to kvm8.json --dry-run` | 1 / 2 / 2 | boxb: FAIL C3 (API Setu whitelist is an owner step); boxc and boxa: LOST C4 (drill not runnable) and C7 (cost) |
| 14 | RED patch 5: corrupted object, manifest fixture | inside boxes.test | test 0 | drill exits 1 ✓ |
| 15 | RED patch 5: real restic repo, corrupted data pack, then corrupted tree pack | inside boxes.test (with restic) | test 0 | drill exits 1 both times ✓ |
| 16 | Mutation: drop `--no-cache` from the drill (reverted) | `RESTIC_BIN=… node --test --test-name-pattern="restic: green" …boxes.test.mjs` | 1 | red: the drill PASSed on a corrupted tree ✓ |
| 17 | Drill each real set | `node tooling/ops/restore-drill.mjs <set> --to <scratch>` | 2 ×5 | LOST: four name no file; d1-kv-export needs `R2_RCLONE_REMOTE` |
| 18 | No test cases declared inside loops | `node tooling/ci/assert-no-loop-cases.mjs` | 1, then 0 | found looped cases; unrolled, green |
| 19 | Enforcement index | `node tooling/ci/build-enforcement-index.mjs --write` / `assert-enforcement-index.mjs` | 0 / 0 | no diff |
| 20 | C-8 portability | `node tooling/ci/assert-vendor-portability.mjs` | 0 | green |
| 21 | affected-guards | `node tooling/scripts/affected-guards.mjs --base 31b0e65d…` | 0 | 55 green, 0 findings; 4 red but red at the base too (assert-app-dod#2, assert-ops-register, lane-verdict, worker:platform) |
| 22 | assert-guard-coverage, run last | `node tooling/ci/assert-guard-coverage.mjs` | 0 | green; coverage manifest regenerated and in the patch (boxes 47, ports 40→44) |

**Deviations and what could not be done**
- **Restic cache bug, measured.** With its local cache on, restic restored a file correctly from a repository whose tree pack I had corrupted, so the drill passed (row 16). The drill and the read-back now run restic with `--no-cache`, and `assertReadOnly` refuses any restic command without it. On a box, the cache would also be a write.
- **Read-backs and drills not recorded.** Every field the public tree does not state is null, and the read-back reports it as LOST. The writer should run `check-box-declared.mjs <box> --print-observed` per box (names only), fill the declarations, then name a drill file per set.
- **Guesses to verify:**
  - Box B and Box C as 8 CPU / 32 GiB / 400 GiB (the KVM 8 plan); the read-back checks it within 15%.
  - The images for GlitchTip's database and cache (`postgres`, `valkey/valkey`) and Box C's envoy and studio.
  - Which box the API Setu whitelist pins (I put it on boxb, `confirmedOn: null`).
  - The `boxc-admits-boxb` and pg_hba allow-lists.
  - Secret names that follow product convention.
- **Private cost file shape unknown.** box-move reads `platform-state/identity.json` loosely (a monthly USD field under the vendor id); if the real shape differs, C7 stays LOST.
- **Shared with port-foundation:**
  - `assert-ports.mjs` limb 8 now counts placements per port, so two Hostinger boxes are one placement.
  - `port.schema.json` and `ports/README.md` gain an `interface.js` key, so the port's interface can be a node module.
  - Also touched: `ports.test.mjs`, `_non-port.json` (hostinger and oracle-cloud rows removed), and `coverage-manifest.json` (generated).
- **port-switch** on `boxes` exits 1 at C5 (no conformance suite), like the other L2 ports. A box's real dry run is `box-move.mjs`.
- **Skipped per the cloud rules:** patch 6 (the PR-body runbook drafts), the Private O-row, pushing and the PR.
- **Done outside the patch:** `npm ci` in three Worker directories for affected-guards (node_modules not in the patch).
- No Dart in this brief; Flutter was not attempted. Every seam's text matched.
- Minor: the header comment of `check-box-declared.mjs` mentions only `--no-lock`; the code enforces `--no-cache` too.

```
 tooling/boxes/backups.json             |  74 +++++
 tooling/boxes/boxa.json                |  26 ++
 tooling/boxes/boxb.json                |  60 ++++
 tooling/boxes/boxc.json                |  46 +++
 tooling/boxes/roles.json               |  12 +
 tooling/ci/assert-ports.mjs            |  11 +-
 tooling/ci/test/boxes.test.mjs         | 493 +++++++++++++++++++++++++++++++++
 tooling/ci/test/coverage-manifest.json |   5 +-
 tooling/ci/test/ports.test.mjs         |  44 ++-
 tooling/ops/box-declaration.mjs        | 472 +++++++++++++++++++++++++++++++
 tooling/ops/box-move.mjs               | 223 +++++++++++++++
 tooling/ops/check-box-declared.mjs     | 158 +++++++++++
 tooling/ops/restore-drill.mjs          | 235 ++++++++++++++++
 tooling/ports/README.md                |  10 +-
 tooling/ports/_non-port.json           |   2 -
 tooling/ports/boxes.json               |  64 +++++
 tooling/ports/port.schema.json         |   3 +-
 17 files changed, 1926 insertions(+), 12 deletions(-)
```

