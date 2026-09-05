# Compliance — the decisions, and who checks them

Two halves, and the split is the point.

- **What a script checks** is listed here only so you know it is covered. Do not
  re-check it by hand and do not record its result here as a claim. A compliance
  document that *asserts* a fact about the package is a document that goes stale
  and then lies — the reference implementation's checklist recorded "no `_*`
  paths in the zip" as PASSING, which was true, was the bug, and would have told
  the next maintainer that fixing it was a regression.
- **What only a human can decide** is written out with the reasoning attached,
  because the reasoning is what makes the answer re-derivable in a year.

Run, in this order, and read the output rather than the exit code:

```
node test/skeleton-sim.node.js            # every house rule, ~400 checks
node test/browser/smoke.mjs               # the same rules in a real browser
node _locales/make-locales.mjs --check    # 55 locales in step
node publish/pack.mjs                     # builds and grades both packages
node publish/verify-firefox-package.node.js
node publish/preflight.mjs                # the specialisation gate
```

---

## A. Privacy practices — the decision that earns a strike if you guess

This is the single most commonly wrong answer in this whole family, because the
cheapest wrong answer is the one the product's own copy suggests. The tool says
"no network calls, nothing leaves your device", which is true, and the tempting
conclusion — tick *"This item does not collect user data"* — is wrong.

**The decision table. Answer honestly and the rest follows.**

| Question | If yes |
| --- | --- |
| Does the tool read, receive or process **any page content** — the title, the URL, DOM text, a table, a screenshot, a selection? | Disclose **"Website content"**. This is essentially every tool in this family. |
| Does it read anything the user types into it that is not a setting? | Disclose the matching category too. |
| Does anything at all leave the device? | It does not. Nothing in this family transmits. |

**Why "yes" even though nothing is transmitted.** Google's User Data FAQ counts
*reading or capturing data from a web page* as **handling** user data, and it
requires local-only handling to be disclosed anyway. The disclosure is about
what the item touches, not about where it sends it. Ticking "does not collect"
on an item that reads page content is a mismatch between the dashboard and the
behaviour, and that is a **policy strike**, not a correction request. Strikes
attach to the developer account, so with 67 items on one account the blast
radius is every one of them.

The skeleton's own demo feature reads `tab.title` and `tab.url`. It is a
page-content reader on line one, and so is anything you build from it.

**Chrome Web Store — fill in exactly this:**

- [ ] **Do NOT tick "This item does not collect user data".** That is the
      tempting answer and it is the one that earns a strike
- [ ] Data collected: **Website content** (plus anything else your table says)
- [ ] Purpose: *App functionality* only
- [ ] **Not** sold to third parties · **Not** used for creditworthiness · **Not**
      used for any purpose unrelated to the single purpose
- [ ] Limited Use affirmations — all three, and each is true here **because
      nothing is transmitted at all**:
  - transfer only for the practices disclosed: no transfer occurs
  - no sale of user data: nothing to sell, nothing leaves the machine
  - no use for advertising or creditworthiness: no ads, no accounts, no profiles
- [ ] Privacy policy URL: the hosted `publish/PRIVACY-POLICY.html`

**AMO — fill in exactly this, and it is NOT a contradiction:**

- [ ] `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]`

Mozilla's question is **"what do you collect or transmit?"** Google's question
is **"what do you handle?"** This tool handles website content locally and
transmits nothing, so *"Website content"* and *"none"* are the same fact
answered under two different definitions. Write that sentence into the AMO
submission notes if there is anywhere to put it, so a reviewer comparing the two
listings does not read it as a developer contradicting themselves.

---

## B. Single purpose

- [ ] The paragraph in `publish/STORE-LISTING.md` §2 is written and is one sentence
- [ ] Every popup button, every options row and every permission is an instance of it
- [ ] The skeleton's demo feature (`read-title` / `copy-title` / `copyOnOpen`) is
      **gone**, not left in place beside the real feature — `publish/preflight.mjs`
      fails while any of it survives
- [ ] No screenshot in the listing shows a feature the sentence does not cover

## C. Permissions

- [ ] Every declared permission has a justification in `publish/STORE-LISTING.md`
      §4 (enforced: `manifestGates()` fails the build otherwise)
- [ ] There are **no static `host_permissions`** (enforced)
- [ ] Any broad access is `optional_host_permissions`, requested at run time,
      behind a setting that is off by default
- [ ] No `content_scripts` entry matches every url (enforced)
- [ ] The install warning a user will actually see has been read out loud. If it
      says "Read and change all your data on all websites", the listing has to
      earn that sentence in its first paragraph or the conversion rate will say so

## D. Remote code

- [ ] "Remote code: none" — see `publish/STORE-LISTING.md` §5
- [ ] Enforced by the packaged-script network scan, by the sim's static scan, and
      by a real-browser run that fails on a single outbound request

## E. The package

Everything in this section is enforced by `node publish/pack.mjs`; it is listed
so you know what the command covers, not so you can tick it by hand.

- Positive allowlist — only the files the browser loads
- `manifest.json` at the archive root, not nested inside a folder
- Every reference resolves inside the archive, **case-exact** (a case mismatch
  loads on Windows and 404s on the reviewer's Linux box, and it is reported as
  its own kind of failure so nobody goes looking for a file that is right there)
- `_locales/` **must ship** — all of it. Every other underscore-prefixed path
  must not. (This replaces the reference's "no `_*` in the zip" rule, which was
  the bug.)
- No `test/`, no `.md`, no build script, no `node_modules`, no scratch file
- The `LICENSE` **is** in the package, deliberately: PolyForm Shield's "Notices"
  section makes the terms travel with every copy
- Version parity across `manifest.json`, `publish/manifest.firefox.json`, the
  CHANGELOG heading and both filenames
- A diff against the previous release, so a silently dropped file is caught

## F. Firefox / AMO

Enforced by `node publish/verify-firefox-package.node.js`.

- [ ] `gecko.id` is derived from `publish/identity.json` and is **not** a
      placeholder. **AMO fixes the identity at first signing.** `pack.mjs`
      refuses to write a Firefox package while the placeholder is present, and
      that refusal is deliberate: an artifact that exists is an artifact someone
      uploads at 11pm
- [ ] `data_collection_permissions` declared (mandatory for new add-ons since
      2025-11-03)
- [ ] `background.scripts` alongside `service_worker` (its absence is the
      addons-linter **error** `BACKGROUND_SERVICE_WORKER_NOFALLBACK`), with the
      worker file **last** and every `importScripts` target listed before it
- [ ] `importScripts` guarded in `background.js` **source** — Firefox runs it as
      an event-page script where `importScripts` is undefined
- [ ] No `minimum_chrome_version`, `options_ui` instead of `options_page`
- [ ] Licence: PolyForm Shield 1.0.0 via **"Custom license"** — Mozilla's
      dropdown has no PolyForm entry

## G. Accessibility, i18n and data — already covered elsewhere

Not repeated here. `=== a11y ===` and `=== theme ===` in the node sim,
the keyboard/zoom/contrast passes in the browser tier, and
`node _locales/make-locales.mjs --check` for the 55 catalogues. If any of those
is red, nothing in this document matters yet.

---

## What a human still has to do

`publish/SUBMISSION.md`. Nothing in this file is a substitute for reading it.
