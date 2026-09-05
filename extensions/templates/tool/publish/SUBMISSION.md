# Submission — only the things a human must do

Everything a script can do is done by a script. What is left is here, in order,
and nothing on this list can be automated: it is a judgement, a credential, a
click in someone else's dashboard, or a sentence only you can write.

**Before you start, run this and read it:**

```
node publish/preflight.mjs
```

While that prints TODOs, stop and do them. It is the specialisation checklist
with the guessing removed. When it is green:

```
node test/skeleton-sim.node.js            # ALL PASS
node test/browser/smoke.mjs               # ALL PASS
node _locales/make-locales.mjs --check    # ALL PASS
node publish/bump-version.mjs minor       # then fill in the CHANGELOG stanza
node publish/pack.mjs                     # writes and grades both packages
node publish/verify-firefox-package.node.js
```

---

## 1. Decide the sentence (30 minutes, once)

Write the single-purpose sentence in `publish/STORE-LISTING.md` §2 and then
delete anything the tool does that is not an instance of it. No script can tell
you that a second feature is a second product; a reviewer can, and does, and
charges you a resubmission for it.

## 2. Host the privacy policy

- Fill in every `⟨SLOT⟩` in `publish/PRIVACY-POLICY.html`, then **read the whole
  thing against your own code**. It describes the storage architecture the
  skeleton ships; if you added a store, a permission or an export, the policy is
  now wrong, and a policy that overclaims is a disclosure event rather than a
  patch.
- Put it at a public https URL with no login and no cookie wall.
- Put that URL in `publish/identity.json` → `privacyPolicyUrl`.
- **There is no publish button without it.**

## 3. Answer the privacy-practices questions yourself

`publish/COMPLIANCE-CHECKLIST.md` §A has the decision table and the reasoning.
The short version: if your tool reads any page content — and it does — you
disclose **"Website content"** to Google and declare **`["none"]`** to Mozilla,
and those two answers agree. Do **not** tick "does not collect user data".

This is the item on this page most likely to be got wrong in a hurry, and the
only one whose penalty lands on your whole developer account.

## 4. Make the assets

`publish/STORE-LISTING.md` §8. At least one screenshot, showing the tool doing
the single purpose. Not the options page.

## 5. Chrome Web Store (chrome.google.com/webstore/devconsole)

1. Pay the one-time developer registration fee if this is your first item.
2. New item → upload `publish/<slug>-<version>.zip`.
3. Paste the listing fields from `publish/STORE-LISTING.md` §1 and §3.
4. Paste the permission justifications from §4, one per field. **Paste them; do
   not summarise them.** The formula in those paragraphs — narrowest scope, the
   less-privileged option you rejected and why, tied to the single purpose — is
   what the minimum-permission policy is judged against.
5. Privacy practices tab: §A of the compliance checklist. All three Limited Use
   affirmations.
6. Distribution: public, all regions unless you have a reason.
7. Submit. Review is typically days; a resubmission restarts it from scratch.

## 6. Microsoft Edge Add-ons (partner.microsoft.com)

The **same zip**. Edge takes the Chromium MV3 package unchanged. The listing
fields are the same text; the privacy answers are the same answers. The only
thing to watch is that Edge's own review is separate and slower.

## 7. Firefox / AMO (addons.mozilla.org)

1. `publish/identity.json` → `ownerDomain` must be a domain **you control**, and
   it must be right the first time: **AMO fixes the add-on identity at first
   signing.** `pack.mjs` will not build a Firefox package until it is set.
2. Upload `publish/<slug>-<version>-firefox.zip`.
3. Licence: Mozilla's dropdown has **no PolyForm entry**. Choose **"Custom
   license"** and paste the root `LICENSE` text, or give a URL that serves it.
   Say plainly that it is source-available and non-compete, not OSI open source.
4. Data collection consent: the manifest already declares
   `data_collection_permissions.required = ["none"]`. The submission form asks
   the same question again — answer it the same way.
5. If a reviewer asks for source: **the package is the source.** No build step,
   no bundler, no minifier, no transpiler. Say exactly that.

## 8. After it is live

- Tag or record the release. The zip in `publish/` is the golden master: it is
  the exact artifact the store received, and the next build diffs against it.
- Install the published item yourself, on a profile that is not your development
  one, and do the thing the single-purpose sentence says.
- Write the first line of the next CHANGELOG entry while you still remember.

---

## Things that will bite, listed once

- **Never reuse a version number.** Two different packages under one version is
  unrecoverable in public: the store keeps whichever it received first and no
  diff afterwards tells you which one a user has. `bump-version.mjs` refuses to
  bump to the current number for this reason.
- **A resubmission restarts the review queue.** Getting the listing right the
  first time is worth an hour.
- **Do not hand-zip.** Right-clicking the folder in Windows Explorer nests
  everything under `My_Tool/` and the store answers "Manifest file is missing or
  unreadable". It is the most common first-upload failure there is, and it is
  the reason `pack.mjs` exists.
- **Do not upload from a folder that has `test/` in it.** This family's test
  fixtures deliberately contain an exfiltration-shaped URL and five network
  APIs, inside an item whose listing claim is "zero network calls". An automated
  scan finding those is a malware-review referral, not a warning. The allowlist
  makes it impossible; hand-zipping makes it likely.
