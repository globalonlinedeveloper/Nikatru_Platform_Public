# Core policy

What may become shared code, what may not, and what happens to a copy after it is made.

Shared code in this repository is **copied into every tool that uses it** — MV3 has no runtime module
system and there is no build step, so a link is not available (see
[ARCHITECTURE.md](ARCHITECTURE.md#2-why-shared-code-is-vendored-into-each-tool)). A copy is cheap to
make and expensive to change: a bad abstraction is now present in every tool that took it, and removing
it costs one edit per consumer. So the bar for entry is high, and the rules below are meant to be
applied at review time, out loud.

**Shared code with one consumer is not shared code.** It is a second copy of one tool's private module,
in a location where changing it now requires thinking about tools that do not exist yet.

---

## 1. The four admission tests

A module is admissible only if it passes all four.

### 1.1 Two shipping consumers, and a third that credibly wants it

Not two planned consumers. Two **shipping** ones. Until then the code lives in the tool that has it.

Copying code into the second tool and deleting the duplicate later is cheaper than deleting a wrong
abstraction: the duplicate is visible, local and safe to change, while a wrong shared API is invisible,
global, and changing it means retesting every consumer.

The most tempting candidates are exactly the ones this rule is for — the module that is *obviously*
going to be needed everywhere. With one consumer its shape is still a guess, and a guess frozen behind a
shared API is the hardest thing here to undo.

### 1.2 Mechanism, not policy — no tool-specific vocabulary

Shared code owns **how**; the tool owns **what it means**.

- Shared: how to write a file to disk, revoke the blob URL afterwards, and sanitise a filename for a
  platform with reserved names.
- Tool: what that filename should say.

The usable test at review time: **could you write this module's documentation without naming any
product, or any noun from one product's problem domain?** If a function signature, an option name, a
default value or an error string contains a word that belongs to one tool's subject matter, it fails.
Rename it into mechanism or leave it where it is.

Where a capability has a universal half and a specific half, **split at the seam rather than sharing the
whole thing**. Detecting a pattern in text is mechanism and can be shared; deciding what to do about a
hit is policy — one tool paints over pixels, another masks a string, a third refuses to proceed — and
belongs to the tool. Sharing across that seam produces a shared module with a switch for every consumer,
which is the same coupling with more indirection.

### 1.3 No network calls. Ever.

Shared code makes no network requests of any kind, under any flag, with any allowlist. This is not a
default that a tool may override — it is the property that makes a single build gate able to prove the
claim for every tool that carries the copy. The packaged-script scan fails a build on a network API in a
packaged file, and no extension in this repository collects analytics.

A diagnostic or reporting module is held to the same rule: it may build a report **for the user to copy**,
and it may not send one anywhere. That is what makes it a replacement for analytics rather than analytics
under another name.

### 1.4 Zero npm runtime dependencies. Forever.

No package may end up inside a shipped zip. A dependency is a supply-chain risk in an artifact whose
entire pitch is that it can be read, and it is a source-submission problem with AMO. Development-only
tools are fine where they belong (a browser driver in a test directory, a linter run through `npx`); they
never cross into shipped code.

---

## 2. Four more constraints that are easy to violate accidentally

1. **Loadable in four places.** A shared module must load in a Chrome service worker, a Firefox event
   page, an extension page, and a bare Node simulation. That means **no DOM access at load time and no
   top-level side effects** beyond attaching to the namespace. A module that touches `document` when it
   loads cannot be imported by the worker, and a module that starts a timer at load has already made a
   decision for every consumer.
2. **Additive-only within a channel.** A breaking change means a new channel directory beside the old one
   (`v2/` next to `v1/`), not an edit. Old tools keep running unchanged and adopt on their own schedule.
   Directory-as-major-version is how one maintainer avoids a coordinated migration across every tool on a
   single afternoon.
3. **Every module ships with a Node simulation.** Shared code has N consumers, so a regression is N
   outages. The simulation must load the real shipped source and grade its behaviour — and it must have a
   recorded failing case, because an assertion that cannot fail inflates coverage without adding any.
4. **No tool-visible global surface beyond the agreed namespace.** Shared files are classic scripts that
   attach to one namespace object; a second global is a name collision waiting for the tool that defines
   it too.

---

## 3. What does not enter, as categories

- **A tool's engine.** The thing a tool is *for* is single-consumer by decision, and freezing it behind a
  shared API would ossify the part that most needs to keep changing.
- **Rendering and presentation decisions** on top of a shared mechanism (see the seam rule, §1.2).
- **Large, opinionated single-consumer subsystems** — an exporter, an encoder, an editor. If a second
  tool genuinely needs one, promote it *then*, with both consumers in hand.
- **Anything with exactly one consumer today**, however obviously catalogue-wide it looks. Build it inside
  the tool; promote it when tool number two arrives and the shape stops being a guess.

---

## 4. The copy, after it is made

The copy is committed with the tool. That is what makes a tool directory load unpacked with no setup,
makes adopting a shared change a visible diff in the pull request that adopts it, and lets one tool stay
on an older version while another moves ahead.

The rules that keep a copy honest:

- **The vendored directory is `vendor/core/`, never `_core/`.** Chrome refuses to load an extension with
  a root file or directory starting with an underscore; `_locales` is the only exception, and it is not
  negotiable — the extension does not load at all.
- **Record what was copied.** A copy carries the channel, the source version, the date, and a hash per
  file. Without the hashes, "has this copy drifted?" is answered by reading every file.
- **A hand-edit of a copied file is a check failure, not a fork.** Fix it upstream and re-copy, or make
  the divergence an explicit, visible decision.
- **Adoption is deliberate.** Taking a new shared version is a one-line change plus a re-copy, in its own
  commit, with the tool's tests run afterwards — which is exactly the ceremony you want when one person
  owns all of the blast radius.

---

## 5. Status: what exists today

**`core/core.json` is the status record, and this page does not restate it.** It carries the
`version` (with a `versionNote` on why it is below 1.0.0), a per-module `status` for every specified
module with what exists instead where one is partial or absent, the `counts`, and its own `gaps` list.
`core/test/coverage.node.js` recomputes the counts from that map and the tree on every CI run. A copy of
those figures on this page went stale without any run noticing (O-PUBLIC-DOCS-HAND-WRITTEN-FACTS), so
the figures are read there and only the reasoning behind them is kept here.

What the record does not say, and a reader should not have to infer:

- **The version stays below 1.0.0 on purpose.** `v1` is the *directory*, and the directory is the major
  version. The number is a claim about how much of that channel exists. It becomes 1.0.0 when the surface
  is real, not when the folder was created.
- **Everything in it was promoted from code that already ran**, byte for byte, with the source path and
  the sha256 of the source recorded in the header. Nothing there was written from a description.
- **Until a tool vendors a verified copy, the hash gate of §4 is written down and exercised by nothing**
  (`core.json` `gaps` records whether one does). The substrate a stamped tool inherits meanwhile is the
  template's own files, copied wholesale, with two weaker mechanisms standing in: `skeleton.json` declares
  the inherited files a tool is expected not to edit, and `tools/audit-fleet.mjs` reports what has
  drifted. That is copy-with-provenance, not copy-with-verification.
- **A module the architecture never listed may still earn a place** under these rules, when it solves a
  platform problem rather than a product one. `core.json` labels such a file `"specified": false` rather
  than folding it into the list; the plan being wrong about which modules land first is a fact worth
  keeping.

**Do not read a "partial" status in `core.json` as "nearly done".** Each is real code that covers part of
a specified module's job, in a copied file, without the boundary, the namespace, the sim, or the hash gate
the policy above requires. Promoting one is a piece of work with a review attached, not a file move.
