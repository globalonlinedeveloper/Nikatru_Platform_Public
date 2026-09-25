<!--
  fullshot-privacy.md — THE TEXT of FullShot's published privacy policy, held
  once.

  🔴 THIS FILE IS THE SOURCE, AND IT IS RENDERED. The two copies that ship are
  HTML, not Markdown, and both are written from this file by
  contracts/legal/render-fullshot-privacy.mjs:

      sites/nikatru/fullshot/privacy.html                             (served at
                                                     nikatru.com/fullshot/privacy)
      extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html
                                                     (submitted to three stores)

  Change the text HERE, then run
      node contracts/legal/render-fullshot-privacy.mjs
  and commit both copies. Its --check, and tooling/ci/assert-legal-text-parity.mjs
  in CI, fail when either copy differs from this file or from its sibling. This
  leading comment is not rendered into either copy.

  Until 2026-09-25 this comment said the file was a seed that nothing rendered,
  which stopped being true when the renderer landed. The history before that —
  two hand-kept copies joined only by a comment in the served one — is in git
  and in README.md in this directory.
-->

# FullShot — Privacy Policy

<!-- render: class=meta nbsp-dots -->
Effective date: 2026-08-21 · Last updated: 2026-09-05 · Applies to: FullShot – Full Page Screen Capture, the browser extension for Google Chrome, Microsoft Edge, and Mozilla Firefox, version 1.10.1 and later.

<!-- render: class=lead when=free -->
FullShot is a screenshot tool that runs entirely on your own computer. It does not have accounts, does not send your data anywhere, and does not track you. This policy explains exactly what that means.

<!-- render: class=lead when=pro -->
FullShot is a screenshot tool that runs on your own computer. Capturing needs no account, sends nothing anywhere, and does not track you. This policy explains exactly what that means.

<!-- render: when=free callout=In one line -->
Your screenshots and settings stay on your device. FullShot has no servers, collects no analytics, shows no ads, and never sells or transmits your data.

<!-- render: when=pro callout=In one line -->
Your screenshots and settings stay on your device. Capturing collects no analytics, shows no ads, and never sells or transmits your data.

<!-- render: when=pro -->
FullShot Pro is optional. It adds watermark and logo images, brand kits, and annotation and redaction presets, and it is tied to a Nikatru account, which the Nikatru privacy policy covers. Capturing, annotating, redacting and exporting stay free and need no account, and nothing else this policy says about them changes.

## 1. Who we are

FullShot ("the extension", "we") is developed by Rajasekar Selvam. For any privacy question you can reach us at [support@nikatru.com](mailto:support@nikatru.com).

## 2. What FullShot does

FullShot captures screenshots of web pages you choose to capture — the full page, the visible area, a region you select, or an element you click — and lets you annotate, redact, beautify, and export them. Everything happens locally in your browser.

## 3. What data FullShot handles

Google classifies taking a screenshot as "handling user data," so we disclose it plainly even though nothing leaves your device.

### a. Screenshots (website content)

- **What:** When you start a capture, FullShot reads the content of the page in the active tab and produces an image of it. That image is *website content*.
- **Where it goes:** The screenshot is held in your browser's memory during capture and, if you keep it, saved to a local database (IndexedDB) on your device as your capture *History*. It is also saved to your **Downloads** folder or copied to your clipboard only when you choose to export or copy it.
- **What we do <u>not</u> do:** We do not upload, transmit, back up, share, or sell your screenshots. They never reach us or any third party. We cannot see them.

### b. Settings

- Your preferences — image format, capture options, filename template, PDF options, and theme — are stored using your browser's extension settings storage (the `storage.sync` API). These are preference values only; **no screenshots or page content are stored in settings.**
- Because that API is the browser's own sync mechanism, if you are signed in with sync enabled these small preference values may sync across your own profiles of that browser — through Google in Chrome, Microsoft in Edge, or Mozilla in Firefox. It is the browser's mechanism, not ours; FullShot neither controls nor receives that sync, and it never includes your screenshots.

### c. The last-failure note

- **What:** When a capture fails, FullShot keeps a one-line note so the popup can tell you why the next time you open it. The note holds a short fixed sentence chosen from a list built into the extension, the *origin* of the page (scheme and host only — never the path, query string or any credentials in the address), which capture mode you tried, the tab number, and the time.
- **Where it goes:** the browser's `storage.session` API — deliberately not `storage.local` and not `storage.sync`. It lives in memory for the current browser session, is erased when you quit the browser, never syncs to any other device, and never leaves this machine.
- **What it never holds:** no screenshot, no page content, and no text written by the browser or by a website. Only sentences FullShot itself wrote.

### d. Automatic PII redaction (optional, off by default)

If you turn on "Redact PII," FullShot scans the captured page's text **on your device** for patterns that look like emails, phone numbers, credit-card numbers, Social Security numbers, and API keys, and paints a solid opaque block over each match **it finds** in the image (a permanent block, not a reversible blur). This detection runs entirely locally. FullShot does not collect, store separately, index, or transmit the detected values — the feature exists to *cover* what it matched, not to gather it.

**What it cannot do.** The scan reads text that the page exposes *as text*, and it does not read all of that. Anything the page draws as pixels — a canvas-rendered editor such as Google Docs or Figma, an embedded image, a scanned document, a video frame — holds no text for the scan to read, so nothing is blocked there even with the feature switched on. Nor does it read what you have typed into a form field, or text held in an attribute, or a number split across styled fragments of a sentence, or text inside a frame it did not enter. It matches five shapes and no others: not names, not postal addresses, not dates of birth, not account nicknames, not free-form secrets.

**FullShot reports what it covered; it cannot tell you whether the image is clean, because it never sees the image as a picture. Look at it before you share it.** Before a screenshot and its description are copied for an AI assistant, FullShot shows you the exact image that is about to leave, with the blocks it covered marked on it, and asks you to confirm you have looked.

**What this stores.** To mark those blocks for you, FullShot stores — locally, on your device, alongside the screenshot and nowhere else — the position and size of each block it confirmed to be solid in the finished image. It stores no coordinates for anything it did not cover, and it never stores the matched text itself. Those positions are deleted with the screenshot, and are dropped entirely if the image is edited, beautified or clipped, because they would no longer describe it.

## 4. What FullShot does NOT collect

- No account, sign-in, name, or email is required or collected.
- No analytics, telemetry, usage tracking, crash reporting, or advertising identifiers.
- No browsing history. FullShot does not record the sites you visit; it only reads a page when you explicitly capture it.
- No cookies set by the extension. No fingerprinting.

## 5. Data sharing and transmission

<!-- render: when=free -->
None. FullShot makes no network requests to any server, ours or a third party's. There is no cloud component. Because nothing is transmitted, there is nothing for us to share, sell, or hand over. (Files you deliberately save to Downloads or copy to the clipboard are then in your control, like any other file.)

<!-- render: when=pro -->
**If you sign in to FullShot Pro.** Pro is optional. If you sign in with a Nikatru account, FullShot contacts Nikatru's server when you sign in and from time to time afterwards, to confirm that your account has Pro. It sends a sign-in token and the product name, and nothing else: never your screenshots, the pages you capture or your browsing history. If you use Pro's brand features, the watermark and logo images, brand kits and presets you create are stored with your account so they follow you to any browser you sign in on. Cloudflare (which hosts Nikatru's server) and Supabase (which runs account sign-in) process this data for us. You can sign out at any time; the free features keep working without an account.

<!-- render: when=sells ADR 094 -->
If you buy FullShot Pro, Paddle handles the payment, or Razorpay for buyers in India. We receive a record of the purchase, never your card details.

## 6. Permissions and why they are used

- **activeTab** — lets FullShot read the current tab only at the moment you start a capture. No standing access to any site.
- **scripting** — injects the capture engine into the active tab on demand to measure, scroll, and stitch the page.
- **downloads** — saves a finished screenshot or exported GIF/WebM to your Downloads folder when you choose to save.
- **storage** — stores your preferences (see §3b).
- **unlimitedStorage** — lets your local capture History hold large images without hitting the browser's small default storage quota. Local only.
- **Optional broad site access (`<all_urls>`)** — *not* requested at install. FullShot asks for it only if you switch on expanding scrollable cross-origin iframes or Batch URL capture, and your browser shows its own prompt. Decline and the rest of FullShot still works.

FullShot contains no remotely hosted code; all code ships inside the extension (Manifest V3).

## 7. Data retention and how to delete your data

- **History:** Screenshots you keep live in local IndexedDB until you remove them. Delete individual captures from the History page, or clear them all there. Removing the extension also removes its local storage.
- **Settings:** Stored until you change them or uninstall. If your browser's sync is on, clearing synced data is done through the browser.
- **The last-failure note:** Dismiss it from the popup, or quit the browser — `storage.session` does not survive a restart. A capture that succeeds also clears it.
- **Downloaded / copied files:** These are ordinary files under your control; delete them like any other file.
- Because we hold none of your data, there is nothing to request from us to access, correct, or delete — you already have full local control.

## 8. Security

<!-- render: when=free -->
Your data stays on your device and is never transmitted by FullShot, which removes the main network exposure. Local data is protected by your operating system and the browser's per-extension storage isolation. We ship no remote code that could later change this behavior.

<!-- render: when=pro -->
Local data is protected by your operating system and the browser's per-extension storage isolation. We ship no remote code that could later change this behavior.

## 9. Age requirement

FullShot is for adults. You must be at least 18 years old to install or use it, and it is not designed for or directed to anyone younger. India's Digital Personal Data Protection Act, 2023 treats every person under 18 as a child, and 18 is the single floor Nikatru applies everywhere it operates. FullShot collects no personal information from anyone, at any age.

## 10. Limited Use disclosure

<!-- render: class=meta -->
This section is required by the Chrome Web Store and is stated in the form it requires. The practices it describes are the same in every browser FullShot ships to.

FullShot's use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements. Specifically: FullShot uses on-device data only to provide its single, user-facing purpose — capturing and working with screenshots you choose to take; it does not transfer that data except as part of a user-initiated save/export you perform; it does not use the data for advertising; and no human at FullShot reads your data (we have no access to it).

## 11. Changes to this policy

If our data practices ever change, we will update this policy and revise the "Last updated" date before the change takes effect, and — as required by Chrome Web Store policy — disclose material changes to users. Continued use after an update means you accept the revised policy.

## 12. Contact

Questions about this policy or FullShot's privacy practices: [support@nikatru.com](mailto:support@nikatru.com).

---

FullShot processes all data locally on your device and transmits nothing. FullShot is published by Rajasekar Selvam, trading as NIKATRU.
