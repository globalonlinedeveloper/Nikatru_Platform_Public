# Store listing metadata — Subly · Snap Store (`linux-snap`)

`[pipeline D-5]` — *"store listing metadata is generated from the spec and lives
in the repo … so a listing can be regenerated, audited, localized and diffed,
and is never hand-typed into a store console as the only copy."*

**This directory is the source of truth for the listing.** snapcraft.io is a copy
of it, not the other way round.

## 🔴 Why the repo-native tree is the source of truth here

There is **no fastlane path for Snap** at all (D-5, verified against fastlane's
own action pages 2026-07-29: `deliver` is `ios, mac`, `supply` is `android`).
Snap is one of the three channels fastlane cannot reach, so without this tree the
listing would exist only in the Snap Store dashboard — the exact outcome D-5
exists to prevent.

## Why Snap and not Flathub or `.deb`

`[ADR 015]` — **Flathub is DISQUALIFIED**, not deprioritised: its policy forbids
applications containing AI-generated or AI-assisted code, rejection is without
review, and repeats earn a **permanent ban** covering the app *and* the
submission. This repo's public history carries co-author trailers, so it cannot
comply. `.deb` was rejected for failing on Fedora and Arch. Snap ranks first for
native Linux: a real store link, discovery, silent auto-update, it accepts closed
source, and it has **no** AI-code policy.

## Where every field comes from — the derivation map

"Checked" means `tooling/ci/assert-store-metadata.mjs` verifies it on every CI
run, so drift is a build failure rather than a discovery at submission time.

| File | Snap Store field | Derived from | Checked |
|---|---|---|---|
| `snap-name.txt` | the registered snap **name** (global namespace) | chosen once; claimed by `snapcraft register` | non-empty |
| `title.txt` | Title | `sites/_shared/_data/apps.json` → `name` | ✅ exact match |
| `short-description.txt` | Summary (`snapcraft.yaml` → `summary`) | `sites/_shared/_data/apps.json` → `tagline` | ✅ exact match |
| `long-description.txt` | Description (`snapcraft.yaml` → `description`) | the app's differentiation line (`app_brick` var `description`), expanded | non-empty |
| `category.txt` | Category | `app_brick` var `category` | non-empty |
| `license.txt` | License | SPDX identifier | non-empty |
| `privacy-policy-url.txt` | Privacy policy link | `apps/subly/lib/core/config/app_config.dart` → `privacyUrl` | ✅ exact match |
| `support-url.txt` | Contact / support link | `apps/subly/lib/core/config/app_config.dart` → `contactUrl` | ✅ exact match |
| `screenshots/` | Media | not derivable — see that directory's README | slot must exist |

### 🔴 `snap-name.txt` is the one field with irreversible consequences

The snap name is a **global namespace across the whole Snap Store**, claimed once
with `snapcraft register <name>` and shared with nobody. It is carried here so
the name we intend to claim is **reviewable and diffable before it is claimed**,
rather than being decided at a terminal prompt at 11pm. Claiming it is
`OWNER_QUEUE A-6` and is the entirety of that item — there is no "publisher
account" step for Snap beyond an Ubuntu One login.

⚠️ `subly` is the name this repo *intends*. **Whether it is available is
UNVERIFIED** — the store was not queried, and it cannot be reserved without
claiming it. If it is taken, change this file and the runbook's step 2 together.

## Field limits — nothing is enforced, and that is the finding

| Field | Limit | Status |
|---|---|---|
| Title | — | ⚠️ **UNVERIFIED** — no Snap Store limit fetched from a primary source |
| Summary | — | ⚠️ **UNVERIFIED** |
| Description | — | ⚠️ **UNVERIFIED** |
| Category vocabulary (the exact list the store accepts) | — | ⚠️ **UNVERIFIED** — `Productivity` is the obvious fit; the authoritative list was not fetched |
| License identifier vocabulary | — | ⚠️ **UNVERIFIED** — SPDX is the expected form; `proprietary` is used because the app is closed source |
| Snap name character rules | — | ⚠️ **UNVERIFIED** |
| Screenshot dimensions, counts, formats | — | ⚠️ **COULD-NOT-ESTABLISH** — see `screenshots/README.md` |

🔴 **No number appears above and that is deliberate.** D-5's rule: *"an invented
limit fires on correct input"* — a made-up *"120 characters or fewer"* once
rejected this repo's own fixture at 129. The register declares **no** `maxChars`
or `maxLines` for this channel, so `assert-store-metadata.mjs` enforces none. Add
one only with a URL and a date; the guard **refuses to enforce a `max` that
arrives without a `source`**.

## Packaging facts this channel owns (recorded, not built)

From the register's `linux-snap` row, `[ADR 015]` §3 — **none of this exists in
the tree yet**; native Linux is deferred until revenue and the web build already
serves Linux users at $0:

- ingests the prebuilt CI artifact via `plugin: dump` (no in-snap Flutter build);
- bundles libmpv via `stage-packages: [libmpv2]`;
- must declare `plugs: [opengl, wayland, x11, audio-playback]`.

⬜ There is **no `snapcraft.yaml` in this repo**, so there is nothing that builds
a `.snap` today. `tooling/release/submit-snap.mjs` PRINTS that gap on every run
rather than failing, because writing it is deferred work and not a regression.

Full ordered console procedure: `company/runbooks/store-submission-snap.md`.

## Regenerating / validating

```
node tooling/ci/assert-store-metadata.mjs                  # the D-5 guard
node tooling/release/submit-snap.mjs --dry-run --app subly
```

The dry run validates this tree, the artifact and the credential configuration,
and exits 0 **without contacting the Snap Store**. `--submit` refuses with
`UNVERIFIED:` lines rather than guessing at the upload/release verbs.

## ⬜ What is still owner-gated

**OWNER_QUEUE A-6** — registering the snap name, and exporting store credentials
from an authenticated `snapcraft` session. Canonical signs the binary, so there
is **no key of ours** on this path and nothing to lose: the register's
`signing.keyKind` for this row is `"none"` and its restore drill is `required:
false` for that reason.
