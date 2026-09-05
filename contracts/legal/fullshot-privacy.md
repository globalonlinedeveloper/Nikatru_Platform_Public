<!--
  fullshot-privacy.md — THE TEXT of FullShot's published privacy policy, held
  once.

  🔴 THIS FILE IS A SEED AND NOTHING RENDERS IT YET. Two copies of this text
  ship today and they are HTML, not Markdown:

      sites/nikatru/fullshot/privacy.html                             (served at
                                                     nikatru.com/fullshot/privacy)
      extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html
                                                     (submitted to three stores)

  Measured 2026-09-05, with the markup stripped from both: THE TWO ARE
  CHARACTER-FOR-CHARACTER IDENTICAL IN TEXT. The only difference between the
  files is their HTML comments — one names the other as its source, and the two
  palette notes are worded differently. They agree today. What has never
  existed is anything that would notice if they stopped.

  What joins them today is the served copy's own comment, which says so:

      "No guard in either repo can see across the repository boundary …
       so THIS COMMENT is the only thing joining the two copies."

  That sentence was true when it was written and it is the reason this file
  exists. Both copies are now in one tree, so a guard CAN see them both. See
  README.md in this directory for the guard that has to be written and the two
  facts it must assert.
-->

# FullShot — Privacy Policy

Effective date: 2026-08-21 · Last updated: 2026-08-21 · Applies to: FullShot – Full Page Screen Capture, the browser extension for Google Chrome, Microsoft Edge, and Mozilla Firefox, version 1.10.1 and later.

FullShot is a screenshot tool that runs entirely on your own computer. It does not have accounts, does not send your data anywhere, and does not track you. This policy explains exactly what that means.

Your screenshots and settings stay on your device. FullShot has no servers, collects no analytics, shows no ads, and never sells or transmits your data.

## 1. Who we are

FullShot ("the extension", "we") is developed by Rajasekar Selvam. For any privacy question you can reach us at [support@nikatru.com](mailto:support@nikatru.com).

## 2. What FullShot does

FullShot captures screenshots of web pages you choose to capture — the full page, the visible area, a region you select, or an element you click — and lets you annotate, redact, beautify, and export them. Everything happens locally in your browser.

## 3. What data FullShot handles

Google classifies taking a screenshot as "handling user data," so we disclose it plainly even though nothing leaves your device.

### a. Screenshots (website content)

- **What:** When you start a capture, FullShot reads the content of the page in the active tab and produces an image of it. That image is *website content*.
- **Where it goes:** The screenshot is held in your browser's memory during capture and, if you keep it, saved to a local database (IndexedDB) on your device as your capture *History*. It is also saved to your **Downloads** folder or copied to your clipboard only when you choose to export or copy it.
- **What we do not do:** We do not upload, transmit, back up, share, or sell your screenshots. They never reach us or any third party. We cannot see them.

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

None. FullShot makes no network requests to any server, ours or a third party's. There is no cloud component. Because nothing is transmitted, there is nothing for us to share, sell, or hand over. (Files you deliberately save to Downloads or copy to the clipboard are then in your control, like any other file.)

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

Your data stays on your device and is never transmitted by FullShot, which removes the main network exposure. Local data is protected by your operating system and the browser's per-extension storage isolation. We ship no remote code that could later change this behavior.

## 9. Children's privacy

FullShot is a general-purpose utility and is not directed to children. It collects no personal information from anyone, including children.

## 10. Limited Use disclosure

This section is required by the Chrome Web Store and is stated in the form it requires. The practices it describes are the same in every browser FullShot ships to.

FullShot's use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements. Specifically: FullShot uses on-device data only to provide its single, user-facing purpose — capturing and working with screenshots you choose to take; it does not transfer that data except as part of a user-initiated save/export you perform; it does not use the data for advertising; and no human at FullShot reads your data (we have no access to it).

## 11. Changes to this policy

If our data practices ever change, we will update this policy and revise the "Last updated" date before the change takes effect, and — as required by Chrome Web Store policy — disclose material changes to users. Continued use after an update means you accept the revised policy.

## 12. Contact

Questions about this policy or FullShot's privacy practices: [support@nikatru.com](mailto:support@nikatru.com).

---

FullShot processes all data locally on your device and transmits nothing. FullShot is published by Rajasekar Selvam, trading as NIKATRU.
