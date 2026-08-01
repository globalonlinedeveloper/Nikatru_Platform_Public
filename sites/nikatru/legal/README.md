# Policy archive — every version of the notice that has ever been in force

`sites/nikatru/privacy.html` is one URL that is edited in place. A consent record
that says *"the user agreed to policy version 2026-07-26"* is worth exactly as
much as our ability to produce the bytes of 2026-07-26. This directory is that
ability.

## Layout

```
sites/nikatru/legal/<version>/<locale>/privacy.html
```

`<version>` is the `data-policy-version` the document declares — the same string
`kPrivacyPolicyVersion` carries in the apps, which `assert-seams-wired.mjs`
already pins to the published page.

**The key is `<version>/<locale>`, never `<version>` alone.** A notice will exist
in more than one language (the app already ships two locales). If the archive were
keyed on version only, the first Tamil notice would make every earlier Tamil
reader's consent record resolve to English bytes — the exact defect this directory
exists to prevent, reopened by our own schema. The locale segment costs one
directory now and cannot be retrofitted onto records already collected.

## What differs from the bytes that were published

An archived copy is the published document with **three changes, none of them to
text a reader saw**:

1. `<meta name="robots">` → `noindex,follow`. A superseded policy that is still
   indexable is a second live policy, and a reader arriving from a search has no
   way to know it was replaced.
2. `<link rel="canonical">` removed. Left pointing at `/privacy.html` it would
   tell a crawler the archived version and the current one are the same document.
3. Same-site `.html` links rewritten to the root-relative form
   (`href="terms.html"` → `href="/terms.html"`). The 2026-07-26 page wrote its
   footer links document-relative; under `/legal/<version>/<locale>/` those
   resolve to files that do not exist. A dead link in the one document that has to
   still work is a worse fidelity failure than a rewritten `href`.

`tooling/ci/assert-policy-archive.mjs` compares the **visible text** of the
snapshot for the currently published version against the live page, so any change
to what a reader actually reads fails the build. It also fails if a snapshot is
still indexable, still carries a canonical, or is filed under a version its own
`data-policy-version` does not match.

## Adding a version

Publish the archive copy **in the same commit as the version bump**. The bytes are
only trivially recoverable while they are still the live page; after the bump they
survive in git history only, and the guard's "every version ever in force has a
snapshot" limb will already be red by then.

The `2026-07-26` snapshot here was recovered from history after exactly that
happened.
