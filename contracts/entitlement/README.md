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

```
node contracts/entitlement/generate.mjs           # rewrite contract.json
node contracts/entitlement/generate.mjs --check   # exit 1 if it would change
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

## What is checked, and what is still not

| Pair | Held equal by | Status |
|---|---|---|
| SQL seed rows ↔ `services/platform/src/lib/mor/contract.ts` | `assert-entitlement-contract.mjs` limb 4 | 🟢 checked |
| `contract.js` ↔ `contract.json` | `generate.mjs --check` | 🟢 checked (mutation-proven 2026-09-05: flipping `chargeback_reversed.restores` to `false` gives exit 1 naming the drift; regenerating returns exit 0) |
| `contract.js` ↔ `contract.ts` / the SQL seed | **nothing** | 🔴 **open** |

🔴 **That last row is the whole reason this directory says "seed" at the top.**
The one-line fix is to add `contracts/entitlement/contract.js` to
`assert-entitlement-contract.mjs`'s limb-4 target list, which is possible *only*
because the two files are now in one tree — and it is deliberately not made in
the same change as the repository merge, so that a guard change and a 542-file
move are reviewable separately. Until it is made, treat `contract.ts` as the
source of truth and this file as a copy that agrees with it today.

## Why not a `.ts` file here

Compiling TypeScript to JavaScript is verbatim the fourth clause of Mozilla's
source-code submission policy — *"a custom tool that takes files, applies
pre-processing, and generates file(s) to include in the extension"*. Adopting it
for a file the extensions import would cost, per release, forever, an obligation
to ship reviewable sources to AMO. `// @ts-check` + `tsc --noEmit --checkJs`
gives the same checking, changes zero shipped bytes, and is reversible by
deleting three comment lines and a CI step.
