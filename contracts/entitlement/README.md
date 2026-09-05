# `contracts/entitlement/`

The vocabulary of the money rail: which world a row belongs to, and why access
was taken away.

| File | What it is | Who reads it |
|---|---|---|
| `contract.js` | **the authored source.** Plain ES module, `// @ts-check`, JSDoc types, zero dependencies | a TypeScript Worker and a vanilla-JS extension import the *same bytes* |
| `contract.d.ts` | hand-written declarations beside it — a declaration file emits nothing | TypeScript, for both consumers |
| `contract.json` | **generated** from `contract.js` by `generate.mjs` | Dart code generation (Dart cannot import JavaScript) |
| `contract.schema.json` | JSON Schema (2020-12) that grades `contract.json` | a schema validator, and a reader |
| `generate.mjs` | writes `contract.json`; `--check` fails on drift | CI |
| `generate-dart.mjs` | writes `packages/purchases/lib/src/generated/entitlement_contract.g.dart`; `--check` fails on drift | CI |

```
node contracts/entitlement/generate.mjs           # rewrite contract.json
node contracts/entitlement/generate.mjs --check   # exit 1 if it would change
node contracts/entitlement/generate-dart.mjs        # rewrite the Dart table
node contracts/entitlement/generate-dart.mjs --check
```

## The failure this is shaped around

`tooling/ci/assert-entitlement-contract.mjs` limb 4 says it out loud:

> *"THE SET IN SQL EQUALS THE SET IN CODE … a set that lives in two places
> drifts in one of them, and the drift is invisible until a refund lands. (This
> is not hypothetical: the two were written minutes apart and were already out
> of step by one member.)"*

The member that matters is `chargeback_reversed`, the only one with
`restores: true`. A copy that loses that flag leaves a customer who raised a
dispute in error, and lost it, locked out forever — nothing else in this rail
gives access back.

## What is checked

Five copies of one vocabulary, and every one of them is compared against the SQL
seed rather than against its neighbour — four copies that agree with each other
and are all wrong about the database is a state a chain of comparisons cannot
see.

| Copy | Held to the seed by | Status |
|---|---|---|
| SQL seed rows (`services/platform/migrations/0004_money_rail.sql` §E) | — it IS the left-hand side | 🟢 |
| `contract.js` | `tooling/ci/assert-entitlement-contract.mjs` limb 4 | 🟢 checked |
| `contract.json` | limb 4, plus `generate.mjs --check` against `contract.js` | 🟢 checked |
| `extensions/core/entitlement-contract.js` | limb 4, by SET **and** byte-for-byte against `contract.js` | 🟢 checked |
| `packages/purchases/lib/src/generated/entitlement_contract.g.dart` | limb 4, plus `generate-dart.mjs --check` | 🟢 checked |
| `services/platform/src/lib/mor/contract.ts` | limb 4: it must IMPORT `contract.js`, and a re-declared `REVOCATION_REASONS` array in it is a FAILURE | 🟢 checked |

**Mutation-proven 2026-09-05**, six mutations against the real tree with a green
control before and after each: flipping `chargeback_reversed.restores` in
`contract.js`, in `contract.json`, in the vendored extension copy and in the
generated Dart each exits 1; re-declaring the array in `contract.ts` exits 1;
deleting the vendored copy exits 1 as COVERAGE LOST.

🔴 **`chargeback_reversed` is the member that matters.** It is the only one with
`restores: true`. A copy that loses that flag leaves a customer who raised a
dispute in error, and lost it, locked out forever — nothing else in this rail
gives access back.

## Why not a `.ts` file here

Compiling TypeScript to JavaScript is verbatim the fourth clause of Mozilla's
source-code submission policy — *"a custom tool that takes files, applies
pre-processing, and generates file(s) to include in the extension"*. Adopting it
for a file the extensions import would cost, per release, forever, an obligation
to ship reviewable sources to AMO. `// @ts-check` + `tsc --noEmit --checkJs`
gives the same checking, changes zero shipped bytes, and is reversible by
deleting three comment lines and a CI step.
