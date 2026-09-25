# What is public, what is private, and how to tell

This subtree is public. It lives at `extensions/` inside `Nikatru_Platform_Public`. Its private half is a subtree too. Until 2026-08-20 the only statement of
where a file belongs lived in `.gitignore` comments — legible to somebody reading the whole ignore
file, and to nobody else. This is that rule, written where a contributor will find it.

> 🔴 **Repointed 2026-09-06.** Until 2026-09-05 the two halves were their own repositories,
> `globalonlinedeveloper/Nikatru_Extensions_Public` and `…_Private`. Under [ADR 067] decision 1 they
> were merged into `Nikatru_Platform_Public/extensions/` and `Nikatru_Platform_Private/pre-minimal-2026-09-08:extensions/`,
> and **both old repositories were then DELETED on GitHub** — measured 2026-09-06, `gh api
> repos/globalonlinedeveloper/Nikatru_Extensions_Public` exits non-zero. Frozen local snapshots are at
> `Projects/_archived-2026-09-05/`. Every old name below has been repointed; the old names resolve to
> nothing, not to a redirect.

## The three tiers

| Tier | Repository | Holds |
|---|---|---|
| **Public** | `Nikatru_Platform_Public` → `extensions/` (this one) | Source, tests, build tooling, the gates — and **everything a store publishes**: listing copy, store assets, submission paperwork. |
| **Private** | `Nikatru_Platform_Private` → `extensions/` | The specification (`pipeline/`, ten numbered stages), the roadmap, market analysis, revenue model, competitor teardowns, audit findings, session logs. |
| **Business** | `nikatru/` | Legal identity, GST, store **publisher accounts**, the owner queue. Shared by every product, not just this one. |

## The test, in the order to apply it

1. **Would a second product need this fact?** → `nikatru/`. Legal identity, a vendor account, a tax
   deadline. One home, read by everything.
2. **Is it published to a store, or visible to a user, anyway?** → **public**. Listing copy, screenshots,
   permission justifications, the privacy policy. These are the least secret material the project owns;
   hiding them from CI buys nothing and costs the gates their subject.
3. **Is it about what we plan to build, what it will cost, or who we are competing with?** → **private**.
4. **Otherwise it is source or tooling** → public.

## 🔴 The lesson that produced this rule, and it is the part to keep

On 2026-08-14 four internal planning documents were committed and pushed to the public remote. They were
titled *"Roadmap & Business Plan"*, *"Implementation Plan"* and *"session handoff"*. Not one of them
contained a catalogue keyword, which is exactly why a keyword sweep passed them.

> **Sensitivity lives in a document's SUBJECT, not its vocabulary.** A sweep that reads words will pass
> every one of these documents every time, because they are written in the same technical English as the
> code they plan.

So the rule above is about subject matter, and the `.gitignore` patterns that enforce it are globbed
rather than listed — `*-PLAN.md`, `*-PROMPT.md`, `SESSION-*.md` — because the leak was a document nobody
had thought to list.

⚠️ **Auditing `.gitignore` by reading it proves nothing; the tracked list is the authority.** Use
`git ls-files`, not the ignore file, to answer "is this published?".

## An ignore rule is a net, not a home

A file that is ignored is still on disk and one `git add -f` from being public. Ignoring is the last line
of defence, not the design. Anything genuinely private belongs in the private repository, not in this
working tree behind a pattern.

**Exception, stated rather than hidden:** `.claude/` holds the local credential vault and is blanket-ignored
in full. That is the same arrangement every repository in this workspace uses, and it is deliberate — a
narrow rule protects the one secret somebody thought of, a directory rule protects the next one nobody has
added yet. It is not a licence to keep other private material here.

## [D10], amended 2026-08-20

`TOOLS-PIPELINE.md`'s decision **D10** originally read that `HANDOFF.md`, `ROADMAP.md` and
`CAPTURE-GATES.md` *"do get published — publishing the engineering diary is on-brand for a project whose
pitch is 'audit us.'"*

**Only `CAPTURE-GATES.md` is published, and that is now the decision.** D10 predates the 2026-08-14 leak
and its own lesson. Measured against the test above:

- `CAPTURE-GATES.md` — a capture gate matrix. Engineering behaviour a user can verify. **Public**, as D10 said.
- `ROADMAP.md` — subtitled *Roadmap & Business Plan*, and carries a competitor feature matrix. Strategy by
  subject. **Private.**
- `HANDOFF.md` — a session log with owner gates and an internal work queue. **Private.**

The `.gitignore` had already been enforcing this since 2026-08-14; what was missing was anybody writing
down that the decision had changed. A rule enforced in one place and contradicted in another is a rule
that will be "fixed" in the wrong direction by whoever finds the contradiction next.

## Where each private document actually lives

Root-level strategy (`TOOLS-PIPELINE.md`, `DISTRIBUTION.md`, `DECISIONS.md`, `APP-STACK.md`, `NAMING.md`,
`I18N-LESSONS.md`, `OPERATIONS.md`, `FULLSHOT-RESEARCH-2026.md`, `MARKET-ANALYSIS.md`) and the per-extension
planning set (`ROADMAP.md`, `HANDOFF.md`, `GIT-SETUP.md`, `V2-FEATURE-COMPLETE-PLAN.md`,
`RESUME-PROMPT.md`) were all in `Nikatru_Platform_Private/pre-minimal-2026-09-08:extensions/`, at the same relative paths.
**That directory was removed on 2026-09-08.** Its live half moves into the private corpus’s own `decisions/` and `requirements/` trees
(the extension ADRs, and the pipeline requirements register). Everything else is at the tag above: `git show pre-minimal-2026-09-08:<path>` in the private
checkout.

They are **not** also kept here. Four of them were, byte-identical, until 2026-08-20 — two copies of one
document, and whichever was edited the other went stale with no signal. One copy, in the private repo.

## The two halves are sibling SUBTREES, not nested

`.gitignore` carries `private/` and describes it as "that repository, cloned in place". **No such directory
exists**, and the arrangement it describes is not in effect. The two halves sit in sibling repositories, each under `extensions/`, both directly under
`Projects/`. The ignore rule is kept because a future clone-in-place must not become committable by
accident, but do not read it as a description of the layout.

⚠️ **A consequence worth knowing: `rg` from this root cannot see the private repo.** A negation cannot
reach outside the search root, so a single-root sweep returns a confident, clean, wrong "no matches". Name
both roots when sweeping:

```
rg "<pattern>" . ../Nikatru_Platform_Private/
```
