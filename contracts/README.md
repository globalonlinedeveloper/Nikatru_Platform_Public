# `contracts/` — the things more than one runtime has to agree about

**Status: WIRED (2026-09-05).** The entitlement contract is read by the platform
Worker, vendored into the extension runtime, generated into Dart, and held
together by one guard. The legal text is rendered into both published copies and
held together by a second. What is still open is listed at the bottom.

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
| `entitlement/` | the revocation-reason set, the money environments, and the JSON Schema that grades them | `services/platform` imports `contract.js` directly; `extensions/core/entitlement-contract.js` is a byte-identical vendored copy; `packages/purchases` exports generated Dart |
| `tokens/` | a pointer, for now — see `tokens/README.md` | — |
| `legal/` | the shared text of a published legal document | `sites/nikatru/fullshot/privacy.html` and `extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html`, both RENDERED from it |

## Who reads what, and what stops it drifting

| Pair | Held equal by | Runs in |
|---|---|---|
| SQL seed ↔ `entitlement/contract.js` ↔ `contract.json` ↔ the vendored extension copy ↔ the generated Dart | `tooling/ci/assert-entitlement-contract.mjs` limb 4 — every copy against the SEED, never in a chain | `ci.yml` · guards-legal |
| `services/platform/src/lib/mor/contract.ts` ↔ `entitlement/contract.js` | the same limb: the import must be present AND a restated array is a failure | `ci.yml` · guards-legal |
| `extensions/core/entitlement-contract.js` ↔ `entitlement/contract.js` | byte-identical, checked twice — limb 4 above, and `extensions/scripts/check-contracts-sync.mjs` at authoring time | `ci.yml` · guards-legal |
| `contract.js` ↔ `contract.json` | `entitlement/generate.mjs --check` | the guard above reads the result |
| `contract.js` ↔ the generated Dart | `entitlement/generate-dart.mjs --check` | the guard above reads the result |
| `legal/fullshot-privacy.md` ↔ both published HTML copies | `tooling/ci/assert-legal-text-parity.mjs` — two assertions, a 2,000-character floor, a printed count | `ci.yml` · guards-legal |

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
`packages/tokens` already uses to generate `sites/_shared/assets/tokens.css`
from DTCG JSON.

## What is still open

- 🔴 **`tokens/` is still a pointer.** `packages/tokens/tokens/*.json` has not
  moved here and the Style Dictionary build still reads it there — see
  `tokens/README.md`.
- 🟡 **`extensions/scripts/check-contracts-sync.mjs` is not invoked by
  `.github/workflows/extensions.yml`** yet. The property it checks is gated in CI
  anyway: `assert-entitlement-contract.mjs` limb 4 byte-compares the vendored
  copy on every run of `ci.yml`. That script and
  `extensions/scripts/test/contracts-sync.test.mjs` are the authoring path and
  its faster message.
- 🟡 **The vendored contract sits at `extensions/core/entitlement-contract.js`,
  not on the `core/v1/` VENDORED SURFACE.** `sync-core.mjs` copies `core/v1/**`
  into each tool's `vendor/core/`, so a tool's zip does not yet carry the
  contract. Promoting it is a core version bump, a `core.json` module entry, a
  sim, and a re-sync of every tool — a separate, reviewable change.

## Order of work — what was done, and what is left

1. ✅ `assert-entitlement-contract.mjs` limb 4 reads `contracts/entitlement/
   contract.js` alongside the SQL seed — and the generated JSON, the vendored
   extension copy and the generated Dart.
2. ✅ `services/platform/src/lib/mor/contract.ts` imports the enums from here
   instead of restating them, and keeps the interfaces, `decideSubscription` and
   `decideAdjustment` as the TypeScript-only surface.
3. ⬜ Move `packages/tokens/tokens/*.json` under `contracts/tokens/` and re-point
   the Style Dictionary build (see `tokens/README.md`).
4. ✅ `sites/nikatru/fullshot/privacy.html` and
   `extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html` are
   rendered from `legal/fullshot-privacy.md` by
   `legal/render-fullshot-privacy.mjs`, and `tooling/ci/
   assert-legal-text-parity.mjs` holds all three together.
