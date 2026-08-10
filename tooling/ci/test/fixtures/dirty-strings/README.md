# `dirty-strings` — the canary tree for `assert-no-hardcoded-strings.mjs`

**This is not an application, and nothing here is ever built, analysed or shipped.**
It is input to one CI guard, and every string in it is deliberate.

## Why a fixture at all

`assert-no-hardcoded-strings.mjs` enforces on the brick template and on `apps/subly/lib`,
and **both are clean**. Every enforcement assertion therefore passes over an empty result set — which is
indistinguishable from a scanner that has quietly stopped matching. This stage has
already shipped three checks that ranged over nothing and printed `ok`. So the matchers
are proven against a tree **known** to contain violations, and the clean result only
means something because the dirty result came back dirty.

## Why it moved off `apps/subly` (2026-08-08)

That known-dirty tree used to be `apps/subly/lib`, which made the guard's coverage claim
hostage to a **product** decision. Subly's l10n retrofit — Phase 4 of
`knowledge/plans/subly-restamp-execution.md` — cleans exactly the literals the canary
counts, so the guard would have gone **red by improvement**: the build breaks *because*
somebody did the right thing, and the rational response to that is to weaken the guard.

A fixture owned by the guard cannot be cleaned by product work. `apps/subly/lib` was kept
as a **second** canary until the retrofit landed, and then changed sides entirely: from
2026-08-11 it is an **enforced** tree, not a canary. The retrofit that would have turned
the old arrangement red by improvement is exactly what made enforcement affordable —
59 hits when it stopped being a canary, 5 when it became a subject.

## The three parts, all asserted

| Path | Holds | The guard asserts |
| --- | --- | --- |
| `dirty/` | ≥ 20 hardcoded user-facing strings, in **both** matcher families | the floor, and per-family evidence — a family that stops matching is caught even when the total stays high |
| `quiet/` | one near miss per `NOT_USER_FACING` exemption | **zero** enforced hits, and that every exemption has a near miss — an exemption you cannot write the input for is a hole, not a filter |
| `expected-families.txt` | the matcher families this fixture covers | an identity with the guard's matcher list, in both directions, so a **deleted** matcher is caught too |

## If you are here because CI told you to be

- **"the matchers found only N …"** — somebody edited `dirty/` and took the tree below the
  floor. Put the strings back. Cleaning this tree is deleting the guard's only evidence.
- **"the … matcher found NOTHING"** — a matcher regex stopped matching, or its evidence
  was removed from `dirty/`.
- **"declares evidence for a family no matcher provides"** — a matcher family was deleted
  from the guard. That is the change to review, not this file.
- **"an exemption has no near miss"** — you added an entry to `NOT_USER_FACING`. Add the
  literal it is meant to exempt to `quiet/` in the same change.
- **"quiet/ yielded N enforced hit(s)"** — an exemption was narrowed or removed, and a
  string that used to be silent now counts. Either the change is wrong, or the near miss
  moves to `dirty/` and this file's table gets updated with it.
