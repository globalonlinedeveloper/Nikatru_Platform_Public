# `contracts/` — the things more than one runtime has to agree about

**Status: SEEDED, NOT YET WIRED.** Read the "What is not true yet" section before
you rely on anything here.

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
| `entitlement/` | the revocation-reason set, the money environments, and the JSON Schema that grades them | `services/platform` (TS), `extensions/**` (vanilla JS), `packages/purchases` (generated Dart) |
| `tokens/` | a pointer, for now — see `tokens/README.md` | — |
| `legal/` | the shared text of a published legal document | `sites/nikatru/**`, `extensions/**/publish/**` |

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

## What is not true yet

This directory is a **seed landed with the repo merge**, and saying so is the
whole point of this section — a `contracts/` that looked authoritative while
nothing read it would be a fourth copy of every fact in it, which is worse than
no directory at all.

- 🔴 **Nothing imports these files yet.** `services/platform` still reads its own
  `src/lib/mor/contract.ts`; no extension imports anything from here.
- 🔴 **`tooling/ci/assert-entitlement-contract.mjs` does not know this directory
  exists.** Its limb 4 holds the SQL seed rows equal to `contract.ts` and to
  nothing else. Until its target list names `contracts/entitlement/contract.js`,
  a change made here and not there is invisible. That one-line extension is the
  next step and it is owned by whoever owns that guard — it is deliberately not
  made in the same change as the merge.
- 🟡 What *is* already checked here: `contracts/entitlement/contract.json` is
  generated from `contract.js` and `node contracts/entitlement/generate.mjs
  --check` fails on drift between those two. So the copies inside this directory
  cannot diverge from each other; it is the copy in `services/` that is still
  joined by nothing.

## Order of work, so the next session does not have to rediscover it

1. Extend `assert-entitlement-contract.mjs` limb 4 to read
   `contracts/entitlement/contract.js` alongside `contract.ts` and the SQL seed.
2. Re-point `services/platform/src/lib/mor/contract.ts` to import the enums from
   here rather than restate them, leaving it as the TypeScript-only surface
   (interfaces, `decideSubscription`, `decideAdjustment`).
3. Move `packages/tokens/tokens/*.json` under `contracts/tokens/` and re-point
   the Style Dictionary build (see `tokens/README.md`).
4. Make `sites/nikatru/fullshot/privacy.html` and
   `extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html` renderings
   of `legal/fullshot-privacy.md`, and add the guard that holds them equal (see
   `legal/README.md`).
