# tooling/legal — the compliance registers CI can actually read

Stage 8 (`COMPLIANCE & LEGAL`) is built out of *registers*: declared facts that a guard compares to the
tree, to the published pages, or to both. This directory is where those registers live.

## Why here and not under `company/legal/`

The stage-8 plan specified every register under `company/legal/**`. That is wrong, and the previous
increment (PR #114) stopped rather than build on it.

`company/` is **gitignored** (`.gitignore` line 15) — it is the private business SSoT and it is not in the
public repository at all. A guard that reads `company/legal/data-inventory.json` in CI reads *nothing*:
`existsSync` returns false, the row set is empty, and the guard reports a clean tree over an empty domain.
That is this repository's single most-repeated failure mode, and building four more guards on it would have
been building four more instances of it deliberately.

`tooling/channel-register.json` had already met the same wall and already recorded the answer, in prose:

> `ownerQueue` IDS ARE DATA, NOT AN ASSERTION. `OWNER_QUEUE.md` moved to `nikatru/` ([ADR 054]) — a
> SEPARATE private repo, not on the CI checkout at all, so no CI guard can read it.

So: **the in-tree home is `tooling/legal/`**, and the registers here are public files in a public repo.

## The public/private split, and the rule for applying it

Some of what a legal register wants to record is genuinely private — anything carrying personal data, bank
or payment credentials, government identifiers, or the owner's own documents. The rule is the one
`tooling/channel-register.json` already uses for signing custody:

> **Record the structural fact a guard needs, in public. Keep the sensitive value private, and point at the
> private record by name rather than by content.**

Concretely, `channel-register.json` says *that* the Play upload key's custody is recorded, and where the
record lives (`OWNER_QUEUE S-4`) — never where the key is, or how it is protected. A guard can assert
"custody is recorded"; nobody reading the public repo learns anything they could use.

Applied here, per register:

| register | public part (here) | private part (stays out of this repo — `nikatru/` or `company/`) |
|---|---|---|
| `provider-register.json` | the provider's name, role, the route or page that names it, whether it is disclosed | the seller account itself: merchant IDs, KYC state, bank/payout details, contract terms |
| `data-inventory.json` | which stores exist, what CATEGORY of data each holds, its declared retention, which code writes it | the data itself, and any per-subject record. No row names a person, an address, or a key |
| `asset-register.json` | every bundled asset, its licence, and the SOURCE URL + date for the licence claim | nothing — a licence claim with no public source is not a licence claim |
| `duty-matrix.json` | the duty, its status, its trigger condition, and a primary-source URL | the owner's filings and identifiers that discharge a duty (GST, Udyam, PAN) |
| `policy-claims.json` | the published claim and what in the tree asserts it | nothing — every row quotes a page anyone can already read |

Two fields are the split made concrete, and they are the ones to copy when a new register needs one:

- `privateRecord` — a **non-actionable pointer**: the name of the private document that holds the detail
  (`nikatru/business/company-master.md`, `OWNER_QUEUE O-1`). Never a value, never a path to a secret.
- `ownerItem` — the owner-queue id that unblocks a row. A guard can assert the id is present and
  well-formed; it cannot read `OWNER_QUEUE.md`, and it does not pretend to.

## Print vs fail

Every guard here uses the split `assert-seams-wired.mjs` established: a gap an **agent** can close is a
build failure; a gap only the **owner** can close is PRINTED on every run, keyed to its owner item, and
never silently exempted. Failing CI on work only the owner can do blocks everything else and teaches people
to switch the guard off — and each printed gap is written so that it flips to a failure (or to a
"PROMOTE ME" notice) the moment its reason stops being true.

## The registers and their guards

| register | guard | requirement |
|---|---|---|
| `policy-claims.json` | `tooling/ci/assert-policy-claims.mjs` | K-3 — every published claim is paired to the tree |
| `provider-register.json` | `tooling/ci/assert-policy-claims.mjs` | K-5 — the commercial surface names the actual seller and payment path |
| `data-inventory.json` | `tooling/ci/assert-data-inventory.mjs` | K-8 — one declared personal-data inventory behind every disclosure |
| `duty-matrix.json` | `tooling/ci/assert-legal-tripwires.mjs` | K-13 — the per-market duty matrix cannot silently rot |
| `asset-register.json` | `tooling/ci/assert-licence-register.mjs` | K-10 / K-11 — rights evidence for every third-party asset shipped |
| `content-licence-register.json` | `tooling/ci/assert-content-licences.mjs` | [7]P-5 / G-36 — no asset ships in a CONTENT PACK without a cleared licence row |
| `pack-key-drills.json` | `tooling/ci/assert-publish-gate.mjs` | [7]P-10 — no production pack is signed before key custody is drill-proven |

`content-licence-register.json` is a different question from `asset-register.json` and the two are
deliberately not merged: the asset register covers what a **built app bundle** ships (fonts, shaders,
images inside the binary); the content register covers what the **pipeline consumes to produce a pack**
(generator models, TTS voices, QA models, and any third-party asset family a pack carries). An app can
ship a font it never generated with, and a pack can carry a voice the app binary never sees.

🔴 **AND THE TWO REGISTERS CROSS-ASSERT, since 2026-08-13** — `tooling/ci/licence-cross-assert.mjs`,
imported by **both** guards above, so a disagreement turns both red. A family can legitimately be in
both files (Noto is the worked example: cleared as a pack-rendering input today, and it would owe an
asset row the day a Noto face ships inside a binary), and until this landed nothing compared what the
two files said about one. Every `asset-register.json` row therefore answers `contentFamily` — a
content-register family name, or `null` — with a `contentFamilyWhy` sentence; where a row names a
family, both registers must record the **same licence identity** and the **same attribution duty**.
The field is required and `null` is a real answer: an optional cross-link cannot fail on the input
that actually causes a seam, which is nobody writing the link. ⚠️ The overlap is **empty today**
(6 families, 6 asset rows, 0 in both) and the guard prints that on every run, so "0 compared" can
never be read as "0 disagreements". 📌 The sentence above is a **paraphrase**; the canonical wording
lives in `content-licence-register.json` (`_readme`), is quoted verbatim by `[7]P-5` and `[8]K-10`,
and the guard fails if that copy is edited without re-syncing them.

`pack-key-drills.json` is a register with no third party in it at all — it records whether the
content-pack signing key's stored copies have been **read back**. It lives here because it is the same
shape: a declared fact a guard compares to the tree, with the sensitive value (the seed) named rather
than held. Its `drilled_on` is `null` today and the pipeline refuses to sign a production `key_id`
while it stays that way; CI **prints** the gap rather than failing, because restoring a printed seed is
physical owner work and a guard that blocks every run on it is a guard somebody switches off.

## What these registers are NOT

They are **not legal advice and not a legal opinion**, and no row was written by a lawyer. Rows record what
this repository can *observe*: which file writes which store, which provider a route path reaches, which
sentence a page publishes today. Where a duty, a retention period or a licence could not be established from
a primary source, the row says `UNVERIFIED` and names what would have to be read — it is never given a
plausible-looking number. An invented number in a compliance rule fires on correct input while looking
authoritative, and this repo has already deleted one for exactly that reason.
