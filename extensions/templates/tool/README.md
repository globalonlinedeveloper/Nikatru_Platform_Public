# `templates/tool` — the starting point for every tool in this family

Every tool in the catalogue is **copied** from this template — never linked, because a no-build-step
vanilla-JS extension cannot share modules at run time and each tool has to be free to diverge.

> ### The move has landed: this folder is the whole template
>
> The 132 tracked files that used to sit at `_skeleton/` in the repository root — `manifest.json`,
> `background.js`, `lib/`, `pages/`, `popup/`, `icons/`, 55 `_locales/` catalogues, `publish/`, `test/`,
> `tools/`, `TEMPLATE.md` and `skeleton.json` — **are here now**, moved as a git rename, path for path.
> `MIGRATION.md` is the record of that move, with the pre-move baseline so a red check can still be
> attributed correctly. Every path below resolves against **this directory**.
>
> `README-tour.md` beside this file is the template's original README: the long tour of what a tool gets
> for free, the house style, the test doctrine and the verification record. This file covers the stamp;
> that one covers everything else.
>
> ⚠️ **`tools/audit-fleet.mjs` now finds zero tools and still exits 0** — it locates the fleet by walking
> out of its own folder, which from `templates/tool/tools/` reaches only `templates/`. That is a drift
> audit reporting "nothing has drifted" because it looked at nothing. `MIGRATION.md §6` has the
> measurement and the one-line fix; until it is applied, pass the tool paths explicitly.

`TEMPLATE.md` is the full procedure, top to bottom. **This file covers one step of it: the stamp.**

---

## What stamping is

A copy of this folder is indistinguishable from the folder it came from. Stamping is the act of writing
down, at the moment you copy, the handful of facts that make the copy answerable later:

- *which* template version it came from, and when — so "which tools still have the old packager?" is a
  question a script can answer instead of a question that requires reading every tool;
- *who it is* — the identity the stores, the add-on id and the zip filenames are all derived from;
- *what the repository may do to it* — the tests to run, the files that may enter the package, the
  permissions it declares and why.

Three files carry those, and they are stamped in this order.

| # | File | Stamps | Read by |
|---|---|---|---|
| 1 | `skeleton.json` | provenance: `tool`, `copiedAt` | `tools/audit-fleet.mjs` |
| 2 | `publish/identity.json` | identity: `slug`, `ownerDomain`, `supportEmail`, `privacyPolicyUrl` | `publish/*.mjs`, the whole test tier |
| 3 | `tool.json` | the monorepo contract: `id`, `name`, `summary`, `targets`, permission rationale | eight scripts in `scripts/` — **see "What checks the stamp" below** |

### 1. `skeleton.json` — provenance, stamped first

```jsonc
{ "skeletonVersion": "1.1.0", "tool": "My_Tool", "copiedAt": "2026-08-14" }
```

Set `tool` and `copiedAt` **the moment you copy the folder, while you still know them**. Never edit
`skeletonVersion`: it records the version you copied *from*, which is the entire fact the fleet audit
exists to report. It is bumped in the template, and `CHANGELOG-skeleton.md` says what changed.
`scripts/new-tool.mjs` stamps both fields for you and deliberately leaves `skeletonVersion` alone.

### 2. `publish/identity.json` — identity, before any code

Four facts that otherwise get typed in five places and drift. Two of them are one-way doors:

- **`ownerDomain`** — the Firefox add-on id is derived as `<slug>@<ownerDomain>`, and **AMO fixes the
  add-on identity at first signing**. A placeholder that ships once is a permanently wrong identity, not
  a typo you fix in the next release. `publish/pack.mjs` refuses to write the Firefox package while the
  placeholder is still there — run it in the unstamped template and it says so, by name, and skips the
  AMO candidate while still writing the Chrome one. That gate is the last thing standing between a stamp
  you skipped and a listing you cannot rename.
- **`privacyPolicyUrl`** — where the policy is *hosted*. `publish/PRIVACY-POLICY.html` is the source of
  that page, not the published copy; the pages are served from `nikatru.com`. No URL, no publish button.

Then, once — never by hand:

```sh
node publish/bump-version.mjs --sync    # writes the derived gecko id into the Firefox manifest
```

### 3. `tool.json` — the contract with the repository

The one coupling surface between a tool and the monorepo. It carries the tool `id`, the product `name`,
the one-sentence `summary`, the store `targets`, the tests to run, the package allowlist, and **a
justification string for every permission the manifest declares**. Its own `NOTES` explain each field;
read them there rather than here, so there is one copy of that explanation rather than two.

Two rules that are not obvious from the file:

- **`tool.json.id` must equal `publish/identity.json.slug`.** The slug is already the single signal the
  node tier uses to decide whether this tree is still the template or has become a tool. A second,
  independently-edited copy of the same fact would let the two tiers give different answers to the same
  question.
- **The id is the stable public handle** — the tags, the zip names, the CI matrix entry and the release
  artifacts are all built from it. Directories can be renamed whenever you like; the id cannot.

| Identifier | Form | Example | Used by |
|---|---|---|---|
| Category directory | `Capitalized_Singular` | `Extension/` | the filesystem only |
| Tool directory | `Title_Snake_Case` | `Full_Screen_Shot/` | the filesystem only |
| **Tool id** | `lowercase-kebab` | `fullshot` | tags · zips · CI matrix · artifact names |
| Product name | free text | `FullShot` | manifest · stores · README |

---

## The one signal: while the slug says `skeleton`, this is the template

The node tier grades two different worlds from one file. In the template every placeholder must still be
**present**; in a tool every one of them must be **gone**. It decides which world it is in from exactly
one value — the `slug` in `publish/identity.json`.

That is why the order above is not a preference. Delete the template's own documents before you set the
identity and the tier goes red *for following the procedure*, which is how an author learns to delete
checks instead of reading them. Set the identity first; delete `TEMPLATE.md`, `CHANGELOG-skeleton.md`
and this README last. `node publish/preflight.mjs` counts down the remainder and cannot be talked into
skipping a step — in the unstamped template it reports **19 ready, 19 outstanding** and exits 1, which is
the checklist working, not a fault.

---

## What checks the stamp, and what does not

Worth knowing precisely, because a stamp nobody reads is decoration:

- `publish/preflight.mjs` reads `publish/identity.json`, the manifest, the version, the store assets and
  the documents — including whether this README has been rewritten for your tool. It decides that last
  one by looking for the sentence **"the starting point for every tool in this family"**, which is why
  the heading above still contains it. Rewrite this file for your tool and that check goes green; delete
  the sentence from the *template's* copy and the check goes green for every tool at once, forever.
- `tools/audit-fleet.mjs` reads `skeleton.json` in every tool and reports which are behind this template
  and which have diverged from its inherited files. **It finds tools by walking out of its own folder**,
  which makes it sensitive to exactly the move `MIGRATION.md` describes: run from `templates/tool/tools/`
  it currently finds **zero** tools and exits **0**, which reads like good news. `MIGRATION.md §6` has the
  measurement and the one-line fix; until then, pass the tool paths explicitly.
- **`tool.json` is read — but not this copy of it.** Eight scripts load it (`discover`, `policy-check`,
  `check-version`, `check-core-sync`, `lint`, `gen-catalog`, `sync-core`, `new-tool`), and for a real tool
  they turn its `package`, `policy` and `tests` blocks into build failures. They find tools by walking
  category directories, and `templates/` is not one — so **the template's own `tool.json` is graded by
  nothing**, deliberately. Read it twice at stamping time; there is no gate behind it here.
- `scripts/new-tool.mjs` **writes its own `tool.json`** into the new tool rather than copying this one,
  with every permission justification left as an empty string so `policy-check` is red until a human
  writes them. This file is therefore the documented reference and the hand-copy path — not the literal
  bytes your tool will start from.

---

## Two things to get right while you are still in the copy

- **`vendor/core/`, never `_core/`.** Chrome refuses to load any extension whose package has a root file
  or directory whose name begins with an underscore — `_locales` is the only exception it makes. If a
  shared core is ever vendored into a tool, that is where it goes.
- **Your listing text cannot be a sibling's listing text.** Microsoft certification 10.1.4 requires each
  listing to carry its own metadata, so a summary or description copied across from another tool in the
  catalogue is a rejection rather than a shortcut. Write the `summary` in `tool.json` for this tool only.
  Keep every locale's description at 132 characters or fewer while you are at it — the store rejects the
  upload rather than truncating, and it is nearly always a *translation* that grows past the limit.

---

## Copy it

The move has landed, so the default is correct and `--template` is no longer needed:

```sh
node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest \
  --dry-run     # prints what it would do; drop --dry-run to write it
```

The script prints which template it used, because "where did this tool come from" is the first question a
fleet audit asks. It still keeps a fallback and will refuse a template with no `manifest.json` rather than
stamping a partial one — the failure mode this directory caused while it was half-built.

By hand, if you prefer:

```sh
cp -r templates/tool  Extension/My_Tool
```

```powershell
robocopy templates\tool Extension\My_Tool /E
```

⚠️ `robocopy` exits **1** when it successfully copies files and **0** when there was nothing to copy, so
`if (-not $?)` after it reports failure on the successful case. Treat exit codes below 8 as success, or
use `Copy-Item -Recurse`.

Then stamp the three files above, in that order, and work through `TEMPLATE.md` from §0.
