# `contracts/` — the things more than one runtime has to agree about

**Status: WIRED (2026-09-05).** The entitlement contract is read by the platform
Worker, vendored into the extension runtime, generated into Dart, and held
together by one guard. The brand tokens are authored here and emitted into three
runtimes. The legal text is rendered into both published copies and held together
by a second guard. What is still open is listed at the bottom.

[ADR 067] decision 1 created this directory: *"a top-level `contracts/`
directory holds tokens, legal text, the entitlement contract and store
vocabulary, read by Dart, the Workers and the extensions."*

## Why a directory, and not a package

The owner's requirement, stated twice: *"common features must carry forward to
every app; a feature added once should reflect everywhere."*

There are five ways to share a definition across runtimes — a directory, a git
submodule, a git subtree, a published package, and a publish-and-vendor pipeline
— and the 2026-09-05 monorepo research (report 16 §5.3, private corpus) costs all
five for a one-person company. The column that decides it is *when is drift
caught*:

| Mechanism | Drift caught |
|---|---|
| **this directory** | **at edit time, by a guard that already exists** |
| submodule / subtree | only if you add a guard |
| npm or pub package | at consumer-update time — whenever someone gets round to it |
| publish + vendor + hash gate | at sync time, in whichever repo pushes next |

That is not a theoretical ranking. `tooling/ci/assert-entitlement-contract.mjs`
exists because the revocation-reason set was written into SQL and into
TypeScript minutes apart **and was already out of step by one member**, inside a
single repository. The failure this directory prevents has happened here once.

## What is in it

| Path | What it is | Consumed by |
|---|---|---|
| `entitlement/` | the revocation-reason set, the money environments, and the JSON Schema that grades them | `services/platform` imports `contract.js` directly; `extensions/core/v1/entitlement-contract.js` is a byte-identical copy on the extensions' vendored surface; `packages/purchases` exports generated Dart |
| `tokens/` | the DTCG brand-token source in `tokens/dtcg/` — see `tokens/README.md` | `sites/**` (generated CSS), the Flutter apps (generated Dart), `extensions/**` (generated JSON) |
| `legal/` | the shared text of a published legal document | `sites/nikatru/fullshot/privacy.html` and `extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html`, both RENDERED from it |
| `store/` | the store VOCABULARY — the closed sets of words the store pipeline spells, including the one listing-field table four arrays used to be typed from. Words, never rows: the channel rows stay in `tooling/channel-register.json`. See `store/README.md` | `tooling/app-yaml/render.mjs` and `extensions/scripts/check-store-metadata.mjs` import it; `vocabulary.json` is generated for readers that cannot import JavaScript |
| `release.schema.json` | the shape of the `release.json` a GitHub Release carries: what was built, at which commit, with a version and a channel list PER ARTEFACT. There is deliberately no top-level version — one number across the portfolio would renumber FullShot the day the app ships, and a store refuses a version that goes backwards. `minSupported` on the app surface is the served floor, read from `services/platform/src/app-config-data.json` (the emitter refuses `--min-supported` there); the extension surface passes it | `tooling/ci/release-manifest.mjs --emit-release-json` writes the record, `tooling/ci/assert-release-json.mjs` grades it against the bytes and against `tooling/channel-register.json` |

## Who reads what, and what stops it drifting

| Pair | Held equal by | Runs in |
|---|---|---|
| SQL seed ↔ `entitlement/contract.js` ↔ `contract.json` ↔ the vendored extension copy ↔ the generated Dart | `tooling/ci/assert-entitlement-contract.mjs` limb 4 — every copy against the SEED, never in a chain | `ci.yml` · guards-legal |
| `services/platform/src/lib/mor/contract.ts` ↔ `entitlement/contract.js` | the same limb: the import must be present AND a restated array is a failure | `ci.yml` · guards-legal |
| `extensions/core/v1/entitlement-contract.js` ↔ `entitlement/contract.js` | byte-identical, checked twice — limb 4 above, and `extensions/scripts/check-contracts-sync.mjs` | `ci.yml` · guards-legal, and `extensions.yml` |
| the vendored surface ↔ each tool's `vendor/core/` | `extensions/scripts/check-core-sync.mjs`, the existing `sync-core.mjs` route | `extensions.yml` |
| `contract.js` ↔ `contract.json` | `entitlement/generate.mjs --check` | `extensions.yml` · job `contracts` |
| `contract.js` ↔ the generated Dart | `entitlement/generate-dart.mjs --check` | `extensions.yml` · job `contracts` |
| `tokens/dtcg/*.json` ↔ the three generated outputs | `tooling/ci/assert-palette-consistent.mjs`, plus `ci.yml`'s `site-tokens` lane which deletes all three and re-derives them | `ci.yml` |
| `legal/fullshot-privacy.md` ↔ both published HTML copies | `tooling/ci/assert-legal-text-parity.mjs` — two assertions, a 2,000-character floor, a printed count | `ci.yml` · guards-legal |
| `store/vocabulary.js` ↔ `tooling/channel-register.json` ↔ every listing tree ↔ the two re-pointed consumers | `tooling/ci/assert-store-vocabulary.mjs` — both directions on every axis, and a restated array literal is a failure | `ci.yml`'s `node --test "tooling/ci/test/*.test.mjs"` step, whose green control runs the guard against the REAL tree. ⚠️ **not yet its own named step in `ci.yml`** — see `store/README.md` |
| `store/vocabulary.js` ↔ `store/vocabulary.json` | `store/generate.mjs --check`, asserted by the same suite | same |
| `release.json` ↔ the files beside it ↔ `tooling/channel-register.json` | `tooling/ci/assert-release-json.mjs` — eight limbs, both directions on the file set, and `--self-test` which breaks one thing at a time and requires the guard to name it | `build-platforms.yml` and `extensions.yml` on every release run (`--dir`), `ci.yml` · guards-store on every commit (`--self-test`); `tooling/ci/test/assert-release-json.test.mjs` on every PR EXECUTES each workflow's `--emit-release-json` step and grades what it would emit, so a lane passing a malformed value is red before a branch build. A step is found when it names the mode ANYWHERE (the emitter's own `has()` predicate, not "right after the script path"), and every line of `.github/` that names it must sit inside a step the test executed, or it is red |

**The platform Worker redeploys when the contract changes.** `contract.ts`
imports `contract.js`, esbuild inlines it, so the bundle changes with no file
under `services/` moving. `.github/workflows/deploy-workers.yml` names
`contracts/entitlement/*.js` and `*.json` in BOTH its trigger list and the
`platform` filter — scoped to those two extensions rather than `**`, because
that filter once matched a README and redeployed a production Worker.

## The one rule about the form these take

🔴 **Nothing in this directory may require a build step to consume.** The
extensions are build-free by decision ([ADR 067] decision 1, enforced by
`tooling/ci/assert-extensions-build-free.mjs`), and a shared artefact that has
to be compiled before an extension can read it would forfeit that property from
the outside. So the entitlement contract is authored as a plain ES module with
`// @ts-check` JSDoc types and a hand-written `.d.ts`: the TypeScript Worker
imports it and gets full types, the extension imports **the same file, byte for
byte**, and no tool touches either.

Dart is the exception and is honest about it: Dart cannot import JavaScript, so
Dart consumes **generated** Dart from the same JSON table — the pattern
`contracts/tokens` already uses to generate `sites/_shared/assets/tokens.css`
from DTCG JSON.

## What is still open

- ✅ **DONE 2026-09-20 — store vocabulary is here.** `store/vocabulary.js` is the
  one declaration of the words the store pipeline spells: channel ids, surfaces,
  kinds, platforms, storefront and extension-store keys, artifact formats,
  screenshot device classes, the listing-field table and the listing categories.
  The channel ROWS stay in `tooling/channel-register.json` and always will — see
  `store/README.md`, "Words, not rows". `tooling/ci/assert-store-vocabulary.mjs`
  holds the two together in both directions.
- 🟡 **Most consumers still type the vocabulary.** Two are re-pointed
  (`tooling/app-yaml/render.mjs`, `extensions/scripts/check-store-metadata.mjs`);
  the rest are listed with their citations at the bottom of `store/README.md`,
  the largest being `packages/purchases`'s Dart `PurchaseChannel` enum, which
  needs a generated-Dart emitter, and the `submit-*.yml` lanes, which need the
  generated JSON rather than the module.

## Order of work — what was done, and what is left

1. ✅ `assert-entitlement-contract.mjs` limb 4 reads `contracts/entitlement/
   contract.js` alongside the SQL seed — and the generated JSON, the vendored
   extension copy and the generated Dart.
2. ✅ `services/platform/src/lib/mor/contract.ts` imports the enums from here
   instead of restating them, and keeps the interfaces, `decideSubscription` and
   `decideAdjustment` as the TypeScript-only surface.
3. ✅ **DONE 2026-09-05.** `packages/tokens/tokens/*.json` moved to
   `contracts/tokens/dtcg/`, the Style Dictionary build re-pointed, and the two
   emitters the move existed to make possible added — Dart constants for the
   apps and a JSON table for the extensions. See `tokens/README.md` for what a
   token change now reaches and what it deliberately does not.
4. ✅ `sites/nikatru/fullshot/privacy.html` and
   `extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html` are
   rendered from `legal/fullshot-privacy.md` by
   `legal/render-fullshot-privacy.mjs`, and `tooling/ci/
   assert-legal-text-parity.mjs` holds all three together.
5. ✅ **DONE 2026-09-06.** The vendored contract sits on the `core/v1/`
   VENDORED SURFACE — core `0.1.0` → `0.2.0`, a module row in `core/core.json`,
   and a 22-assertion sim at `core/test/entitlement-contract.node.js`, which is
   the price that surface charges — so `sync-core.mjs` carries it into any tool
   that adopts core. ⚠️ **No tool adopts core yet** (both `tool.json` files say
   `"core": null` on purpose), so no submitted zip carries it today; what
   changed is that the first one will, with no further work. And
   `extensions/scripts/check-contracts-sync.mjs` is now invoked by
   `.github/workflows/extensions.yml`, beside its own twelve-case suite.
