# Store listing — ⟨TOOL⟩

Every field the Chrome Web Store, Edge Add-ons and AMO dashboards ask for, in
one file, written once. Fill in every `⟨SLOT⟩`; `node publish/preflight.node.js`
is red while any survives.

This is not a nice-to-have document. Two of the three most common rejection
reasons in this family's category are decided entirely by what is written here:
the **single-purpose** paragraph and the **permission justifications**. They are
judged against what the item actually does, so write them from the code, not
from the pitch.

---

## 1. Identity

| Field | Value | Limit |
| --- | --- | --- |
| Extension name (`manifest.name`) | ⟨NAME⟩ | **≤ 75 hard** (Chrome refuses to load a longer one); the store display truncates near **45** |
| Short name (`manifest.short_name`) | ⟨SHORT⟩ | **≤ 12**, shown under the icon |
| Store summary | ⟨SUMMARY⟩ | **≤ 132**, plain text |
| Category | ⟨CATEGORY⟩ | one; pick the one a user would browse, not the one that sounds impressive |
| Language | ⟨PRIMARY_LANGUAGE⟩ | the listing's own language; the extension itself ships all 55 locales |
| Support email | ⟨SUPPORT_EMAIL⟩ | must match `publish/identity.json`; a real inbox someone reads |
| Homepage | ⟨HOMEPAGE_URL⟩ | optional |
| Privacy policy URL | ⟨PRIVACY_POLICY_URL⟩ | **required.** Where `publish/PRIVACY-POLICY.html` is hosted. No URL, no publish button |

**Naming rule, and it is a real one:** put the *keyword first and the brand
last* — "Table to CSV — ⟨Brand⟩", not "⟨Brand⟩ Table to CSV". The store truncates
around 45 characters in search results and in the install card, and the half
that survives should be the half that says what the thing does. A user scanning
a list has never heard of your brand.

**`manifest.description` and the store Summary are DIFFERENT FIELDS.** The
manifest one is capped at 132 and is what the browser shows; the dashboard
Summary is capped at 132 and is what the store shows. Keeping them identical is
fine and is one less thing to drift — but write them so the first sentence
survives alone, because in several surfaces that is all anyone sees.

---

## 2. Single purpose — one sentence

The dashboard has a mandatory single-purpose field, and "an extension must have
a single purpose that is narrow and easy to understand" is enforced against the
shipped item, not against this paragraph.

> **⟨TOOL⟩ ⟨does one specific thing⟩ on the page the user invokes it on, and
> saves the result to their own device.⟩**

Worked example of the shape (from the skeleton's own demo feature, which you are
deleting): *"Reads the title of the tab you are on and puts it on your
clipboard."* One verb, one object, one place.

Then the test, and it is the one that catches real rejections:

- [ ] Every button in `popup/popup.html` is an instance of that sentence
- [ ] Every row in `pages/options.html` is a setting *for* that sentence
- [ ] Every permission in `manifest.json` is needed *by* that sentence
- [ ] Nothing in the listing screenshots shows a feature the sentence does not cover

If a feature does not fit, it is a second product. Ship it as a second item —
that is cheaper than a single-purpose rejection, which costs a code change, a
listing rewrite, a resubmission, and a fresh review queue.

---

## 3. Description

The first **132 characters must stand alone**: they are the store Summary, the
search result, and the install card. Everything after them is for the person who
has already decided to read on.

```
⟨First sentence: what it does, in the user's words, under 132 characters.⟩

⟨What it does not do: no account, no tracking, nothing leaves your device.⟩

⟨How it works, in three or four bullets a non-technical user can follow.⟩

⟨What it cannot do — the blocked pages, the file: checkbox, anything that
surprises people. A limitation stated up front is a one-star review avoided.⟩
```

**Do not** put keyword lists, competitor names, "best/#1", or testimonials in
here. Keyword stuffing is its own rejection reason and it is assessed
mechanically.

---

## 4. Permission justifications

The dashboard asks for one per permission, and this is where "minimum
permissions" is won or lost. Each is judged on the same formula: **narrowest
scope that works · the least-privileged option you considered and why it was not
enough · tied explicitly to the single purpose.**

Every block below is pre-written in that shape. Keep the ones your manifest
declares, delete the rest, and replace `⟨TOOL⟩`/`⟨THE JOB⟩` with your own words.
`manifestGates()` in `publish/verify-package.node.js` fails the build if a
declared permission has no `### Permission:` heading here, or if the paragraph
under it is under 40 characters — so an empty heading is not a way past it.

### Permission: `activeTab`

⟨TOOL⟩ acts only on the tab the user is looking at, at the moment they click the
toolbar button. `activeTab` grants access to exactly that tab, only after that
click, and only until the tab navigates — so ⟨TOOL⟩ never has standing access to
any site. It is the narrowest thing that can do ⟨THE JOB⟩ at all: without it,
the extension cannot read the page the user just asked it to read. Broad host
permissions were considered and rejected; ⟨TOOL⟩ has none.

### Permission: `storage`

⟨TOOL⟩ remembers the user's own preferences (theme, whether to keep a local
history, how many rows to keep, how long to keep them) and, if they turn it on,
the results it has produced for them. Everything stored is listed on the options
page, exportable as a file, deletable one row at a time and deletable all at
once. Nothing stored is transmitted anywhere: the extension makes no network
calls at all. Without `storage`, ⟨TOOL⟩ would forget every setting on every
browser restart.

### Permission: `downloads`

⟨TOOL⟩ saves ⟨THE OUTPUT⟩ to a file the user chooses. The no-permission path (an
`<a download>` element) is what ⟨TOOL⟩ uses by default and it is genuinely tried
first; `downloads` is declared only because ⟨REASON: the user asked for a real
Save-As dialog / a subfolder / a filename the anchor path cannot set⟩. ⟨TOOL⟩
never downloads anything the user did not ask for, and never from the network —
the bytes come from the page they are on.

### Permission: `scripting`

⟨THE JOB⟩ requires reading structure that only exists in the page's own DOM, so
⟨TOOL⟩ injects a small script into the tab the user invoked it on. The injection
is scoped by `activeTab`, so it happens only after a click, only in that tab, and
only for as long as that grant lasts. Nothing is injected at page load, there is
no declarative content script, and the injected code makes no network calls.

### Permission: `unlimitedStorage`

⟨TOOL⟩ stores ⟨WHAT, and roughly HOW BIG⟩ on the user's own device, which
exceeds the default quota for ⟨REASON⟩. This raises the quota only; it does not
make anything durable and it does not send anything anywhere. Users can see the
current usage on the options page and delete any of it at any time.

### Permission: `optional_host_permissions`

⟨TOOL⟩ can optionally ⟨THE OPTIONAL FEATURE⟩ across pages the user nominates.
This is **optional** and **requested at run time** with
`chrome.permissions.request`, behind a setting that is off by default — it is
never granted at install, and the core feature works fully without it. Users can
revoke it in the browser's own extension settings and ⟨TOOL⟩ degrades back to
`activeTab` cleanly.

---

## 5. Remote code

**Remote code: none.**

⟨TOOL⟩ executes only the JavaScript inside the package. No `eval`, no
`new Function`, no string-bodied timer, no remote script tag, no CDN, no remote
font, no WebAssembly fetched at run time, and no `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource` or `sendBeacon` anywhere in shipped code. This is
enforced, not asserted: a static scan over every packaged script, plus a
real-browser run that fails if a single network request of any kind leaves the
browser.

---

## 6. Privacy practices (Chrome Web Store dashboard)

Fill these from `publish/COMPLIANCE-CHECKLIST.md` §"Privacy practices", which
carries the decision table and the reasoning. The short version, because the
tempting answer is the wrong one:

- **Data collected:** ⟨"Website content" for essentially every tool in this
  family — reading a page's title, URL, DOM text, a table or a screenshot IS
  "handling user data" under Google's User Data FAQ, even when it never leaves
  the device.⟩
- **Do NOT tick "This item does not collect user data"** if the tool reads any
  page content. A dashboard answer that contradicts what the code does is a
  policy strike, and strikes are account-level.
- **Limited Use affirmations:** all three, each true here because nothing is
  transmitted at all.

---

## 7. AMO (addons.mozilla.org) extras

- **Add-on id:** derived from `publish/identity.json` as `⟨slug⟩@⟨ownerDomain⟩`
  and written into `publish/manifest.firefox.json`. **AMO fixes the identity at
  first signing** — the packaging script refuses to build a Firefox package
  while the placeholder domain is present.
- **Data collection consent:** `browser_specific_settings.gecko.
  data_collection_permissions.required = ["none"]`, mandatory for new add-ons
  submitted since 2025-11-03.
- **Licence:** PolyForm Shield 1.0.0. Mozilla's licence dropdown has **no
  PolyForm entry**, so choose **"Custom license"** and paste the text of the
  root `LICENSE` file (or give a URL that serves it). It is a source-available,
  non-compete licence — not OSI open source — and saying so plainly avoids a
  reviewer question.
- **Source code:** if a reviewer asks, the package *is* the source. No build
  step, no bundler, no minifier, no transpiler: every file in the zip is the
  file that was written.

---

## 8. Assets

| Asset | Size | Note |
| --- | --- | --- |
| Store icon | 128×128 PNG | the same `icons/icon128.png` the manifest declares |
| Screenshots | 1280×800 or 640×400 | at least one; show the tool doing the single purpose, not a settings page |
| Small promo tile | 440×280 | optional, but items without one rank poorly in browse |
| Marquee promo | 1400×560 | only if you are pitching for featuring |

Screenshots must show the current UI. A screenshot of a feature you removed is a
listing that misrepresents the item.
