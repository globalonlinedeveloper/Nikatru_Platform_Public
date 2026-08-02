# tooling/content_pipeline — the producer half of the content-pack rail

The consumer half shipped under stage 2 and is real: `packages/core/lib/src/content/` holds the
two-tier loader, the Ed25519 verifier, the pinned `k1` and — since PR #104 — the identity binding that
makes a signature answer *"is this the pack I asked for"* as well as *"who made this"*.

Nothing produced a pack. This directory is what does.

```
recipe.json ──validate──▶ pack ──sign──▶ gates ──publish
                            │              │
                            │              └─ QA report · review.jsonl · licence clearance
                            │                 · inertness report · round-trip result
                            └─ manifest.json · content.json · assets/ · manifest.sig · PROVENANCE.json
```

## Why plain `.mjs` and not TypeScript

`00-RECONCILIATION-DECISIONS.md` #23 settled the language question as **Node/TS** — against Python and
against Dart. It did not settle transpilation, and the rest of this repo's tooling
(`tooling/ci/*.mjs`, `tooling/release/*.mjs`, `tooling/scripts/*.mjs`) is plain ESM run directly by
`node`. Adding a build step here would mean the CI lane runs *emitted* code while every guard beside it
runs source, and a stale `dist/` is exactly the "green over the wrong bytes" shape this repo keeps
deleting. So: Node, ESM, zero dependencies, no build.

## The commands

| command | what it does | refuses when |
|---|---|---|
| `validate` | parses a recipe against `src/schema/recipe.schema.json` | any `required[]` field is absent; a declared modality is not in `IMPLEMENTED_MODALITIES`; an audio recipe names a TTS endpoint that is not `batch`; a locale shard is short a key |
| `generate` | **not implemented** — the industrial runs are owner-gated (a Gemini console + a metered Chirp 3 HD project). What IS implemented is the pre-submission refusal: `prompts.mjs` refuses an IP-steering prompt template *before* anything is spent | a prompt template steers toward existing IP ([ADR 019]) |
| `pack` | emits the [ADR 007] layout: `manifest.json` · `content.json` · `assets/` · `PROVENANCE.json` | an asset's bytes are outside the locked format allowlist; an item has no provenance row |
| `sign` | Ed25519 over **the exact manifest bytes written** | the `key_id` is a production key with no dated restore-drill record ([ADR 022]) |
| `build` | `validate` + `pack` + `sign` in one pass — what CI runs | any of the above |
| `publish` | **gate only.** The upload target is `[4]B-18`'s (one shared R2 bucket, `packs.nikatru.com`) and does not exist; `publish` refuses before it would need one | any of the five gate artifacts is missing, or names a different `content_hash` |

## Two rules that are load-bearing rather than tidy

**The signer signs the bytes it writes.** `pack.mjs` serialises the manifest exactly once, through
`canonicalJson()`, and hands those bytes to both `writeFileSync` and the signer. A re-serialisation
with different key order or whitespace produces a pack that verifies on this machine and fails on every
client, and nothing but a real-loader round-trip catches it — see `assert-pack-roundtrip.mjs` and
`packages/core/test/content_pack_fixture_test.dart`, which load the *committed* pack through the real
`ContentPackLoader`.

**Signing is isolated from generation.** Generated content is untrusted data until it has passed the
gates; nothing in a generation context may reach the signing seed. `sign.mjs` takes the seed from the
environment or a file path and never from a recipe, an asset, or anything under `content/`.

## The example pack is REAL INPUT, not a fixture

`examples/lingo-phrases/` is a hand-authored travel-phrase set — [ADR 019]'s 🟢 near-zero risk tier
(short functional phrases and facts are not copyrightable by anyone), and hand-authored precisely so
this repository carries no model output it cannot account for. `packages/core/test/fixtures/pack/v1/`
is the pack the pipeline produces from it, committed byte-for-byte. Ed25519 is deterministic, so the
committed signature is reproducible from the same seed: `assert-pack-roundtrip.mjs` rebuilds the pack
on every push and fails on any drift, which is what makes the frozen fixture a *frozen format* rather
than a snapshot nobody re-derives.

The two binary assets in that pack are described in `packages/core/test/fixtures/pack/README.md`. They
are hand-constructed container headers, not third-party works and not model output — so they carry no
licence exposure and make no marking claim they cannot support.
