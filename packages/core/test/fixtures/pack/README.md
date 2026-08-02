# packages/core/test/fixtures/pack — the frozen packs

`v1/` is a real content pack in the [ADR 007] layout, produced by
`tooling/content_pipeline` from `tooling/content_pipeline/examples/lingo-phrases/`.

**Written once, never edited.** Two things depend on that:

- `tooling/ci/assert-pack-roundtrip.mjs` rebuilds it from the recipe on every push and fails on any
  byte of drift. Ed25519 is deterministic and the test signing key is *derived* rather than committed
  (`src/sign.mjs`), so the signature is reproducible on any machine — which is what makes this a frozen
  **format** rather than a snapshot nobody re-derives.
- `packages/core/test/content_pack_fixture_test.dart` loads it through the **real**
  `ContentPackLoader.loadFrom(requireSignature: true)` against a test-pinned key. That is the only
  place in this repository where a produced pack meets the client that has to read it, and it is what
  catches a signer that signs different bytes than it writes — a class of failure that verifies
  perfectly on the pipeline machine and fails on every installed app.

`[pipeline 7]P-11` — a pack-format change must never strand a shipped binary — is why the count of
directories here matters. `assert-pack-roundtrip.mjs` fires COVERAGE LOST when the frozen-fixture count
drops below the number of manifest formats ever shipped. When the manifest grows a field, add `v2/`;
do not edit `v1/`, because `v1/` **is** the evidence that the current parser still loads the old shape.

## The signing key is not real, and cannot become real

`v1/manifest.json` names `key_id: "test-k1"`. `kContentPackPublicKeys` in
`packages/core/lib/src/content/pack_verifier.dart` pins only `k1`, so the production loader **rejects
this pack** — an unpinned `key_id` is a refusal, never a skipped check ([ADR 016]). The Dart test pins
the test key explicitly, through the same injection point the loader documents as existing only so a
test can prove the open path. `cli.mjs --test-key` refuses to sign as anything but `test-k1`.

## The two binary assets

Neither is third-party work and neither is model output. Both are container structure assembled by
`tooling/content_pipeline/examples/lingo-phrases/make-assets.mjs`, which is committed so the bytes are
accountable:

| file | what it is | verified |
|---|---|---|
| `assets/badge/streak.webp` | 34 bytes — `RIFF` container, `WEBP` form type, one `VP8L` (lossless) chunk holding a single literal pixel | RIFF size field = file length − 8; form type `WEBP`; chunk `VP8L`, size 14 |
| `assets/tone/confirm.mp3` | 417 bytes — one MPEG-1 Layer III frame header (`FF FB 90 64`: 128 kbps, 44.1 kHz, joint stereo) followed by a zeroed payload | frame length = ⌊144 × 128000 / 44100⌋ = 417; sync bits present |

Their contract in this pipeline is **magic bytes and extension agreement** (`src/formats.mjs`), and the
structure above is what makes them a real subject for that check rather than a placeholder. They are
not audible and not viewable, and `PROVENANCE.json` says so rather than claiming a generator that never
ran: `generator_model_id: "none/hand-constructed"`, `marking: "none"`, with the reason recorded.
