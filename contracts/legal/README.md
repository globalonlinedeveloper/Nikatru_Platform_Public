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

## What is deliberately NOT done here

- 🔴 **Nothing renders this file.** Both HTML copies are still hand-maintained
  and are still what ships. Making them renderings of this Markdown is a change
  to `sites/` and to an extension's `publish/` directory, and it is a separate,
  reviewable piece of work.
- 🔴 **The provenance comment in `privacy.html` is left exactly as it is.** It
  is currently the only real control, and deleting it in favour of a guard that
  does not exist yet would remove the control and leave the claim.

## Order of work

1. Write the guard described above (two assertions, a coverage floor, a printed
   count) and land it green over the copies as they stand.
2. Then, and only then, make both HTML copies renderings of
   `fullshot-privacy.md`, and replace `privacy.html`'s provenance comment with a
   pointer to the guard by name.
3. The extension's `publish/` copy is graded by
   `extensions/scripts/check-store-metadata.mjs` today; that gate and the new
   guard must not disagree about which file is the source.
