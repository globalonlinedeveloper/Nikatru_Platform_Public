# `contracts/legal/` — text that is published in more than one place

| File | The text of |
|---|---|
| `fullshot-privacy.md` | FullShot's privacy policy |

## The reason this directory exists, in the served copy's own words

`sites/nikatru/fullshot/privacy.html` carries a provenance comment that says
what is holding the two published copies together:

> *"Source of truth:
> Nikatru_Extensions_Public/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html
> … No guard in either repo can see across the repository boundary —
> assert-enforcement-index prints "no row carries kind cross-repo" — so **THIS
> COMMENT is the only thing joining the two copies**. Edit the source first, then
> re-copy; never edit this file alone."*

That comment was accurate. It is also a legal document held together by a
request. The copies are:

- `sites/nikatru/fullshot/privacy.html` — served at `nikatru.com/fullshot/privacy`,
  which is the URL the store listings point at;
- `extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html` — the copy
  submitted to Chrome, Edge and AMO.

**Measured 2026-09-05**, markup stripped from both: the two are identical in
text; the only differences in the files are their HTML comments. So this is not
a repair of a divergence. It is closing the gap while there is nothing in it.

## Why a guard is now possible, and what it must assert

The comment's reason — *"no guard in either repo can see across the repository
boundary"* — stopped being true the moment `extensions/` became a subtree of
this repository. Both files are in one tree; one guard can read both.

The guard that has to be written must assert **two** things, and the second is
the one that is easy to leave out:

1. **The two published copies agree.** Strip markup, normalise whitespace,
   compare. They are equal today, so the guard lands green and its first red is
   a real finding.
2. **Neither published copy has drifted from `fullshot-privacy.md`.** Without
   this, the pair can be edited in step and this file quietly becomes a third,
   stale copy — which is the failure mode of every "source of truth" that
   nothing generates from.

⚠️ **And it must not pass vacuously.** A comparison that finds one file, or
zero, must be COVERAGE LOST rather than "no differences" — the shape this
corpus names first. The count of copies compared belongs in the guard's own
output line, for the same reason `check-store-packages.mjs` prints its package
count: *"so '0 packages, clean' cannot be misread as '12 clean'."*

## What was done (2026-09-05)

- ✅ **The guard exists**: `tooling/ci/assert-legal-text-parity.mjs`, wired into
  `ci.yml`'s guards-legal lane. Two assertions, a 2,000-character floor, a
  minimum of two copies per document, and the count of copies compared printed on
  every run.
- ✅ **Both HTML copies are RENDERED** from `fullshot-privacy.md` by
  `render-fullshot-privacy.mjs`, whose `--check` fails on drift. The rendering
  changed **not one visible byte** of either published file: `diff` against the
  copies as they stood shows only the HTML comment, where the provenance note
  below is replaced by a pointer to the generator and the guard.
- ✅ **The provenance comment is replaced, not deleted.** It was the only real
  control and is now superseded by one that fails a build.
- ⬜ **`extensions/scripts/check-store-metadata.mjs` was not changed.** It grades
  the extension's `publish/` copy; the new guard grades the same file against the
  Markdown. The two do not disagree about which file is the source — the store
  gate reads the published copy, this one reads where it came from.

## How the renderer is scoped, and why that is stated

It understands exactly the constructs this policy uses and REFUSES anything else
rather than guessing — a general Markdown implementation would be a dependency,
and nothing under `contracts/` may need an install to be consumed ([ADR 067]
decision 1). Presentation that is not text lives in the Markdown as a directive
comment on the line above:

```
<!-- render: class=meta nbsp-dots -->
<!-- render: class=lead -->
<!-- render: callout=In one line -->
```

A Markdown reader ignores HTML comments, so the source still reads as prose. ⚠️
`callout=` carries **published text** — "In one line" is rendered as a visible
tag — so the guard's Markdown reduction lifts that value out before it drops
comments. Treating every directive as metadata would let that string change with
the guard reporting a clean run.

## Mutation proof, 2026-09-05

Five mutations against the real tree, green control before and after each:

| Mutation | Result |
|---|---|
| one sentence changed in `PRIVACY-POLICY.html` | exit 1, naming the pair and the first differing character |
| a different sentence changed in the served copy | exit 1 — neither copy is the privileged one |
| **both copies changed IN STEP, the Markdown left alone** | exit 1 — this is the assertion that is easy to leave out |
| `PRIVACY-POLICY.html` deleted | exit 1, COVERAGE LOST |
| the Markdown changed, the copies not re-rendered | exit 1, and `render-fullshot-privacy.mjs --check` exits 1 too |
