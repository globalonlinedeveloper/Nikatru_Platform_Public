# `contracts/entitlement/`

The vocabulary of the money rail: which world a row belongs to, and why access
was taken away.

| File | What it is | Who reads it |
|---|---|---|
| `contract.js` | **the authored source.** Plain ES module, `// @ts-check`, JSDoc types, zero dependencies | a TypeScript Worker and a vanilla-JS extension import the *same bytes* |
| `contract.d.ts` | hand-written declarations beside it — a declaration file emits nothing | TypeScript, for both consumers |
| `contract.json` | **generated** from `contract.js` by `generate.mjs` | Dart code generation (Dart cannot import JavaScript) |
| `contract.schema.json` | JSON Schema (2020-12) for `contract.json` | limb 11 of `tooling/ci/assert-entitlement-contract.mjs`, which grades `contract.json` against it through `tooling/app-yaml/schema-validate.mjs` |
| `generate.mjs` | writes `contract.json`; `--check` fails on drift | CI - `extensions.yml`, job `contracts`, step *contract.json is what contract.js derives* |
| `bundle.js` | **the authored BUNDLE source** — how a bundle grant came to exist (`bundle_sources`), and what kinds of product a bundle may span. Separate from `contract.js` on purpose: the extension runtime decides revocation strings and never decides a bundle source, so folding these tables in would push a second copy into every extension zip and into the generated Dart, where nothing reads them | the platform Worker, `tooling/bundle-availability.mjs`, and `tooling/ops/check-prod-provenance.mjs` |
| `bundle.d.ts` | hand-written declarations beside `bundle.js`, same arrangement as `contract.d.ts` — a declaration file emits nothing, so it does not make an importer a "built" artefact | TypeScript, in the Worker twin `services/platform/src/lib/bundle/availability.ts` |
| `bundle.json` | **generated** from `bundle.js` by `generate-bundle.mjs` | limb 9 of `assert-entitlement-contract.mjs`, which holds it and the SQL seed equal in BOTH directions, and limb 11, which grades it against `bundle.schema.json` |
| `bundle.schema.json` | JSON Schema (2020-12) for `bundle.json` | limb 11 of `tooling/ci/assert-entitlement-contract.mjs`, which grades `bundle.json` against it through `tooling/app-yaml/schema-validate.mjs` |
| `generate-bundle.mjs` | writes `bundle.json`; `--check` fails on drift. **No Dart generator, deliberately** — nothing in Dart reads a bundle source ([ADR 057] §6: the client contract does not change), and a fourth copy with no reader is a file that can drift without any consumer noticing | CI - `extensions.yml`, job `contracts`, step *bundle.json is what bundle.js derives* |
| `generate-dart.mjs` | writes `packages/purchases/lib/src/generated/entitlement_contract.g.dart`; `--check` fails on drift | CI - `extensions.yml`, job `contracts`, step *the generated Dart is what contract.js derives* |

```
node contracts/entitlement/generate.mjs           # rewrite contract.json
node contracts/entitlement/generate.mjs --check   # exit 1 if it would change
node contracts/entitlement/generate-dart.mjs        # rewrite the Dart table
node contracts/entitlement/generate-dart.mjs --check
node contracts/entitlement/generate-bundle.mjs         # rewrite bundle.json
node contracts/entitlement/generate-bundle.mjs --check
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
| `extensions/core/v1/entitlement-contract.js` | limb 4, by SET **and** byte-for-byte against `contract.js` | 🟢 checked |
| `packages/purchases/lib/src/generated/entitlement_contract.g.dart` | limb 4, plus `generate-dart.mjs --check` in `extensions.yml`'s `contracts` job | 🟢 checked |
| `services/platform/src/lib/mor/contract.ts` | limb 4: it must IMPORT `contract.js`, and a re-declared `REVOCATION_REASONS` array in it is a FAILURE | 🟢 checked |

**Mutation-proven 2026-09-05**, six mutations against the real tree with a green
control before and after each: flipping `chargeback_reversed.restores` in
`contract.js`, in `contract.json`, in the vendored extension copy and in the
generated Dart each exits 1; re-declaring the array in `contract.ts` exits 1;
deleting the vendored copy exits 1 as COVERAGE LOST.

⏱ **CORRECTED 2026-09-06 — the 🟢 on the generated Dart row was half true, and
the half that was missing was the CI half.** `generate-dart.mjs --check` existed
and was invoked by NO workflow: `grep -rn "generate-dart" .github/` answered zero
lines, and `git log --all -S "generate-dart.mjs --check" -- .github/` returned
nothing, so it had never been wired on any commit. Limb 4 grades the reason set
and the `restores` flag; every other byte of that generated file was held by
nothing that runs. Measured, with two hand-typed lines appended to the generated
Dart:

```
node tooling/ci/assert-no-clone-tells.mjs              EXIT 0
node tooling/ci/assert-entitlement-contract.mjs        EXIT 0
node contracts/entitlement/generate-dart.mjs --check   EXIT 1   <- the only one
```

It is a step in `.github/workflows/extensions.yml`'s `contracts` job now, and it
is pinned in two places so it cannot be quietly unwired again: a case in
`tooling/ci/test/entitlement-contract.test.mjs` asserts a workflow really invokes
it (with a synthetic control proving that check can fail), and [ADR 070]'s fact
(d) in `tooling/ci/assert-no-clone-tells.mjs` refuses the generated file's
exemption unless a workflow invokes its generator with `--check`. Delete the step
and both go red.

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
