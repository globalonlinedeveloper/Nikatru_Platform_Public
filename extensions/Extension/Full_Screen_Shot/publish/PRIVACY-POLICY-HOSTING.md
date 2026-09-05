# PRIVACY-POLICY-HOSTING.md — getting the policy onto a URL, and answering the store's data questions

`PRIVACY-POLICY.html` (11.8 KB, self-contained, zero external requests) is
written. It is not published, and until it is, **no store submission can
proceed** — all three require a reachable policy for an item that handles user
data, and FullShot does handle user data under Google's definition even though
it transmits nothing.

Three parts:
1. Fill in the placeholders (§1)
2. Put the file on a public HTTPS URL (§2–§3)
3. Answer the store data declarations (§4 Chrome, §5 Edge, §6 Firefox)

Anything an agent could draft is drafted. Everything else is marked **OWNER**.

---

## 1. Fill in the placeholders first

Six placeholder tokens, eight occurrences. Search the file for `⟨`; when the
search finds nothing but the one in the HTML comment, you are done.

| Placeholder | Line | Occurrences | What to put |
|---|---|---|---|
| `⟨EFFECTIVE DATE⟩` | 40 | 1 | The date the policy goes live. Use ISO form, e.g. `2026-08-20`. **Not** a date before the URL is actually reachable. |
| `⟨DATE⟩` | 40 | 1 | "Last updated" — same date on first publication. |
| `⟨DEVELOPER / COMPANY NAME⟩` | 50 | 1 | **OWNER.** The same legal name as the LICENSE Required Notice and the EU DSA trader declaration. These three must agree; a reviewer comparing them is a normal thing that happens. |
| `⟨CONTACT EMAIL⟩` | 50, 127 | 4 (two `mailto:` hrefs + two visible) | **OWNER.** A monitored address. It becomes publicly visible; consider a role address (`privacy@…`) rather than a personal one. |
| `⟨DEVELOPER NAME⟩` | 130 | 1 | Same name as above. |
| `⟨…⟩` | 11 | 1 | Inside the HTML comment. Leave it — it is the instruction, not a field. |

Then delete the HTML comment block at the top (lines 7–12) before publishing.
It is developer instructions, not policy text, and it reads oddly in
View Source on a live page.

**Sanity check after editing** — no rendering, no browser needed:

```powershell
Select-String -Path .\publish\PRIVACY-POLICY.html -Pattern '⟨'
```

Only the line-11 comment match may remain (and nothing at all once you have
deleted the comment).

---

## 2. What the URL has to be

Non-negotiable, in every store:

- **HTTPS.** An `http://` URL is rejected.
- **Publicly reachable with no login, no paywall, no consent wall, no
  geo-block.** Reviewers are not in your country.
- **A direct link to the policy itself**, not a homepage with a "Privacy" link,
  and not a PDF download. Chrome's Limited Use rule wants the disclosure within
  one click of wherever the URL lands; landing *on* the policy satisfies that
  trivially, and §10 of the document carries the required affirmation.
- **Stable for the life of the listing.** A dead policy URL is grounds for
  removal, and it is discovered by an automated recheck months after you have
  stopped thinking about it. Pick hosting you will still control in three years.
- **The same URL in all three stores.** Divergent policies invite a
  policy-mismatch finding. One document, one URL, three dashboards.

Nice to have:

- A stable path you can keep across redesigns, e.g. `/fullshot/privacy/`.
- No trackers or third-party fonts on the page. `PRIVACY-POLICY.html` already
  has none — do not let a host inject analytics. A privacy policy served with a
  tracking pixel is the sort of thing people screenshot.

---

## 3. Where it can live

> ## ✅ DECIDED AND DONE — 2026-08-21 · option **3d, your own domain**
>
> **URL: `https://nikatru.com/fullshot/privacy`**
>
> The file is served from the platform repo at
> `Nikatru_Platform_Public/sites/nikatru/fullshot/privacy.html`, which Cloudflare
> Pages serves at that path as a **200, not a redirect** — the path was chosen so
> the store-facing URL needs no hop. It is in `sitemap.xml`, carries its own
> canonical, and passes `check-site-integrity.mjs`.
>
> **§1 placeholders are filled.** Effective/updated date `2026-08-21`; developer
> name **Rajasekar Selvam** (the legal name on GST and Udyam — see
> `nikatru/business/company-master.md`); contact **support@nikatru.com**, chosen by
> the owner on 2026-08-21 over `privacy@` and `grievance@` because it already
> exists, is already monitored, and is already the public address on the site and
> on the GST/Udyam registrations — which also satisfies §7's own done-check that
> the policy contact match the store support email. The developer-instruction
> comment at the top of the file was deleted, per §1.
>
> **One edit beyond §1**, and it is worth knowing about: the visible `<footer>`
> read *"This document is provided as a starting template; ⟨DEVELOPER NAME⟩ is
> responsible for its accuracy…"*. That sentence is addressed to the DEVELOPER, not
> the user, and unlike the top comment §1 tells you to delete, it **renders on the
> page** — a published policy telling a store reviewer it is a starting template
> undermines the document they opened to verify. Replaced with the publisher
> identification (`published by Rajasekar Selvam, trading as NIKATRU`). No
> substantive claim in §§1–12 was changed.
>
> 🔴 **STILL OPEN, and both are deliberate:**
> 1. **`identity.json`'s `privacyPolicyUrl` is STILL EMPTY.** Its own note says a
>    URL that 404s is worse than a blank because it reads as done — and the page is
>    committed but **not yet deployed**. Fill it once the URL actually answers.
> 2. **`LICENSE`'s `Required Notice:` was never filled in** — it still carries
>    PolyForm's template example (*"Copyright Yoyodyne, Inc."*). §7's done-check
>    requires *policy name == LICENSE Required Notice == EU DSA trader name*, and
>    that three-way agreement cannot hold while one of the three is a placeholder
>    from the template. Not changed here: editing a licence grant is an owner act.
>
> ⚠️ **THE COPY IS IN A DIFFERENT REPO FROM THE SOURCE, AND NO GUARD CAN SEE BOTH.**
> `assert-enforcement-index` prints *"no row carries kind cross-repo"* — there is no
> cross-repository enforcement anywhere in this platform. A provenance comment in
> the served file names this one as the source. Edit the source first, then re-copy.
>
> The five options below are left as written: they are the comparison that produced
> the decision, and 3a–3e remain the right menu if the domain is ever given up.

> ### 🔴 CORRECTION APPENDED 2026-08-22 — ITEM 1 OF "STILL OPEN" ABOVE IS CLOSED
>
> The blockquote above is a **dated snapshot of 2026-08-21** and is left exactly as
> written. This correction is appended rather than folded in, so that what the record
> claimed on the day stays legible.
>
> **Item 1 — `identity.json`'s `privacyPolicyUrl` "is STILL EMPTY" and the page is
> "committed but not yet deployed" — is FALSE, and both halves are false.** It was
> already false when that text was last read: the value was filled on 2026-08-21 by
> extensions **PR #17** (commit `6bd9330`, *"fullshot: fill privacyPolicyUrl, now that
> the URL actually answers"*), i.e. the condition the item set was met and the item was
> actioned, and no one came back to strike the line. Measured **2026-08-22**, not taken
> from a note:
>
> | What | Command | Result |
> | --- | --- | --- |
> | the value | `grep -n privacyPolicyUrl publish/identity.json` | `"privacyPolicyUrl": "https://nikatru.com/fullshot/privacy"` |
> | the page | `curl -s -o /dev/null -w '%{http_code} %{num_redirects} %{content_type} %{size_download}' https://nikatru.com/fullshot/privacy` | `200 · 0 redirect hops · text/html; charset=utf-8 · 13923 bytes` |
> | the pasteable copy | `head -1 store/_shared/privacy-policy-url.txt` | the same URL |
>
> So the page **is** deployed, the URL **does** answer, `identity.json` **is** filled,
> and `store/_shared/privacy-policy-url.txt` agrees with it — which
> `check-store-metadata.mjs` now enforces rather than merely checking the file is
> non-blank. Nothing here is owner work any more.
>
> **Item 2 — `LICENSE`'s `Required Notice:` — IS STILL OPEN and is still owner work.**
> Unchanged and correct as written above. For the exact line, read
> `tool.json` `NOTES."LICENSE Required Notice"` **before** opening the file:
> `grep -n 'Required Notice' Extension/Full_Screen_Shot/LICENSE` returns **five** lines
> and **four** of the five are PolyForm's verbatim text or prose about it. Only one is
> fillable, and filling it is an owner act.
>
> **Why this was missed for a day.** The value was filled in `identity.json`; the two
> records that describe it were not, and nothing in the tree can see that a prose
> sentence and a JSON value disagree. That is the whole reason the correction is
> appended here in the record itself rather than only in a commit message.


Five workable options, honestly compared. Any of them satisfies §2.

### 3a. GitHub Pages — free, but read the repo-visibility catch

The obvious choice, with one interaction worth understanding before you commit:
**GitHub Pages on a private repository requires a paid plan.** On a free
account, Pages means a public repo — which means publishing the source under
PolyForm Shield 1.0.0 (see `LICENSE`, and `GIT-SETUP.md` step 0b).

If you want the source private and the policy free to host, use **two
repositories**: this one private, and a separate tiny public one that contains
nothing but the policy page.

```
your-username.github.io/          <- new public repo, nothing else in it
└── fullshot/
    └── privacy/
        └── index.html            <- a copy of PRIVACY-POLICY.html
```

URL: `https://<your-username>.github.io/fullshot/privacy/`

Steps: create the public repo → add the file at that path → Settings → Pages →
Source: *Deploy from a branch*, branch `main`, folder `/ (root)` → wait a minute
→ open the URL and confirm it renders.

*Rename the file to `index.html`* so the URL has no `.html` on the end and stays
stable if you restructure later.

- Pros: free, no maintenance, HTTPS automatic, unlikely to disappear.
- Cons: the repo hosting it is public; the URL says `github.io`, which reads as
  hobbyist to some reviewers (not a policy problem, only a perception one).

### 3b. Cloudflare Pages — free, private source, custom domain

Connect a **private** repo; Cloudflare builds and serves it publicly. This is
the option that gives you a free public policy page *and* a private source repo,
which is what most people actually want here.

- Pros: free tier is generous, private repo supported, custom domain free,
  HTTPS automatic, no build step needed for a single HTML file.
- Cons: one more account; a build config to keep working.

### 3c. Netlify Drop — the 60-second option

Drag the folder onto <https://app.netlify.com/drop>. A live HTTPS URL, no
account needed to create it — but **claim it with an account immediately**, or
you cannot manage or renew it later.

- Pros: fastest path from file to URL.
- Cons: random subdomain unless you configure one; unclaimed sites are a
  disappearing-URL risk, which is the one failure mode §2 cares most about.

### 3d. Your own domain — best if you have one

If you already own a domain, serve it at `https://yourdomain.tld/fullshot/privacy/`.

- Pros: you control it permanently; matches the EU DSA trader details and the
  Firefox `gecko.id` domain, so the whole identity story is consistent — see
  `SUBMISSION-PACKET.md`.
- Cons: you are the one keeping it alive.

**Note the pleasant side effect:** the Firefox add-on id must be an email-style
string on a domain you control (`fullshot@yourdomain.tld`). If you buy or already
own a domain for the policy, it settles the `gecko.id` blocker at the same time.
Two OWNER items, one decision.

### 3e. Not recommended

- **Google Docs / Notion / a Gist "published" page** — works, but the URL is
  ugly, the host can change sharing semantics under you, and Notion pages have
  been known to render behind a loading state that a reviewer's fetch sees as
  empty.
- **A raw GitHub file URL** (`raw.githubusercontent.com/...`) — served as
  `text/plain`; the reviewer sees HTML source, not a policy.
- **A PDF** — several stores' guidance expects a web page.

---

## 4. Chrome Web Store — the exact answers

### 4a. Where each answer goes

| Answer | Location in the Developer Dashboard |
|---|---|
| Privacy policy URL | Item → **Privacy practices** tab → *Privacy policy* |
| Single purpose | Item → **Privacy practices** tab → *Single purpose* |
| One justification per permission | Item → **Privacy practices** tab → *Permission justification* |
| Remote code question | Item → **Privacy practices** tab → *Are you using remote code?* |
| Data usage checkboxes | Item → **Privacy practices** tab → *Data usage* |
| Three Limited Use certifications | Item → **Privacy practices** tab → *Data usage*, at the bottom |
| Verified contact email | **Account** page (account-level, not per item) |
| Trader / non-trader + address | **Account** page → *Trader status*. See `SUBMISSION-PACKET.md` §OWNER. |

### 4b. Read this before ticking "no data collected"

This is the single most consequential answer on the page and the intuitive one
is wrong.

Google's **User Data FAQ Q2** defines what counts as *handling* user data, and
its own worked example is *"Clipping or scraping content from a website that the
user visits, such as taking screenshots or capturing data from a web page."*
That is a literal description of FullShot's entire product.

**Q3** then closes the escape hatch: *"Yes. Extensions are required to disclose
how they handle user data, even when data is processed or stored locally on a
user's device and is not transmitted to external servers or third parties."*

So: **"zero network calls" exempts nothing.** The audited fact that FullShot
makes no `fetch`, no `XMLHttpRequest`, no `WebSocket`, no `sendBeacon` and no
`EventSource` is true, is worth stating in the policy, and is *not* an answer to
the question Google is asking. Google asks whether you *handle*; Mozilla asks
whether data *leaves the machine*. Same codebase, two different honest answers —
`COMPLIANCE-CHECKLIST.md` §C-FF explains why.

Declaring "no data collected" here would put the dashboard in conflict with the
extension's own described behaviour, and dashboard-versus-behaviour mismatch is
its own enforcement category. The honest, defensible, and *lower-risk* answer is
to disclose **Website content** and let the policy explain that it never leaves
the device.

### 4c. Data usage — the nine categories, answered

Google's fixed vocabulary, with the exact parentheticals the dashboard shows.
Tick exactly one.

| Category (as shown in the dashboard) | FullShot | Why |
|---|---|---|
| Personally identifiable information *(name, address, email address, age, or identification number)* | **NO** | No account, no sign-in, no identity of any kind is read, derived, or stored. A screenshot may of course *depict* someone's name — but FullShot does not extract, parse into fields, index, or retain it as PII. The opt-in redaction feature exists to **remove** such text from the image, not to collect it. |
| Health information | **NO** | Never touched. |
| Financial and payment information *(transactions, credit card numbers, credit ratings, financial statements, or payment history)* | **NO** | Same reasoning as PII. Card-number *patterns* are detected only in order to paint an opaque block over them; the matched value is never stored, indexed, or transmitted. |
| Authentication information *(passwords, credentials, security question, or PIN)* | **NO** | Never read. |
| Personal communications *(emails, texts, or chat messages)* | **NO** | FullShot does not read messages as messages. Capturing a page that happens to be an inbox produces an image, the same as any other page. |
| Location *(region, IP address, GPS coordinates, or information about things near the user's device)* | **NO** | No geolocation API, no IP handling — there is no network layer at all. |
| Web history *(the list of web pages a user has visited, as well as associated data such as page title and time of visit)* | **NO** | No `history` or `tabs` permission is declared. A page is touched only at the instant the user starts a capture on it. **One thing to be able to explain if asked:** the local capture History (IndexedDB) stores the captures the user chose to keep, and a stored capture carries the page's URL and timestamp. That is the user's own saved work on their own device, not a record of browsing — but know the distinction before a reviewer asks you to draw it. |
| User activity *(network monitoring, clicks, mouse position, scroll, or keystroke logging)* | **NO** | Nothing is logged. Programmatic scrolling happens *during* a capture to stitch the page; it is not recorded, and the user's own scrolling is never observed. |
| **Website content** *(text, images, sounds, videos, or hyperlinks)* | **YES** | The screenshot **is** website content. This is the one to tick, per FAQ Q2/Q3. |

**Then the three Limited Use certifications — tick all three. FullShot qualifies:**

- ☑ *I do not sell or transfer user data to third parties, outside of the approved use cases.* — FullShot transmits nothing to anyone.
- ☑ *I do not use or transfer user data for purposes that are unrelated to my item's single purpose.* — Captured content is used only to produce, edit, and export the screenshot the user asked for.
- ☑ *I do not use or transfer user data to determine creditworthiness or for lending purposes.* — Not applicable and not done.

### 4d. The remote code question

**Answer: "No, I am not using remote code."**

Audited and true: every `importScripts(...)` and `<script src>` is a local
relative path, and there is no `eval`, no `new Function`, no CDN, and no WASM.

### 4e. Free text fields

Single purpose, and one justification per permission (`activeTab`, `scripting`,
`downloads`, `storage`, `unlimitedStorage`, and the optional `<all_urls>` host
permission) are already drafted paste-ready in `STORE-LISTING.md` and collected
alongside every other field in `SUBMISSION-PACKET.md`.

---

## 5. Microsoft Edge Add-ons

Edge asks the same questions in different furniture, and it runs the identical
Chromium package.

- **Privacy policy URL** — Partner Center → your extension → *Properties* →
  *Privacy policy URL*. Required whenever the extension handles user data; use
  the same URL.
- **Data collection disclosure** — answer consistently with Chrome: website
  content, handled locally, never transmitted. Do not let the two dashboards
  disagree; both listings are public and comparable.
- **Publisher identity / trader details** — Partner Center verifies publisher
  identity at account level and collects the EU-facing details there. Treat the
  legal name and address as the same values used for Chrome's trader
  declaration. **OWNER**; confirm the current form at submission time.

## 6. Firefox (AMO)

Firefox asks its data question **in the manifest**, not in a dashboard, and it
asks a different question — see `COMPLIANCE-CHECKLIST.md` §C-FF.

- **The machine-readable half is already declared and correct:**
  `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]`
  in `manifest.firefox.json`. Mozilla defines the declaration as covering data
  handled *outside the add-on or the local browser*; nothing FullShot touches
  goes outside, so `none` is accurate, and `none` is exclusive — it cannot be
  listed alongside a data type.
- **The listing half:** Developer Hub → your add-on → *Manage Listing* →
  *Privacy Policy*. Historically AMO required the full policy text pasted into
  this field; since **August 2025** Mozilla accepts a link to a self-hosted
  policy instead. Paste the URL. If the form you are shown still insists on
  text, paste the rendered text of `PRIVACY-POLICY.html` — it is written to read
  fine as plain prose. **Confirm which form you get at submission time.**
- Keep the dashboard answer consistent with the manifest: the manifest says
  nothing leaves the machine, and the policy says the same thing at length.

---

## 7. Done-check before you submit anywhere

- [ ] Every `⟨…⟩` replaced; instruction comment deleted from the top of the file.
- [ ] URL is HTTPS, loads in a private/incognito window, and renders as a page (not source, not a download).
- [ ] URL opens from a phone / another network — no accidental LAN-only or geo-gated host.
- [ ] The same URL is pasted in all three dashboards.
- [ ] Developer name in the policy == LICENSE Required Notice == EU DSA trader name.
- [ ] Contact email in the policy is monitored and matches the store support email.
- [ ] Chrome *Data usage*: **Website content = YES**, all eight others = NO, three Limited Use boxes ticked, remote code = No.
- [ ] Nothing on the hosted page makes an outbound request. Open DevTools → Network → reload → the request list should contain exactly one entry: the document itself.

---

## Appendix — what changed in `PRIVACY-POLICY.html` while this document was written

The policy was Chrome-only in its wording but is going to be linked from three
stores, and one claim was stronger than the code can support. Both fixed:

1. **Header** — "(Chrome extension), version 1.9.11 and later" → the extension
   for Chrome, Edge and Firefox, version 1.10.1 and later.
2. **§3b, §3c, §6, §7, §8** — "Chrome's `storage.sync`", "Chrome Sync", "Chrome
   shows its own prompt", "Chrome's per-extension storage isolation", "Chrome's
   small default quota" → browser-neutral wording that names Google, Microsoft
   and Mozilla where the sync vendor actually matters. A Firefox user reading
   "Chrome's Sync" is being told something untrue about their own data.
3. **§3d — a new "What it cannot do" paragraph.** The policy described redaction
   finding PII and baking an opaque block, with no statement of the limit. The
   scan reads text the page exposes *as text*; a canvas-rendered editor, an
   embedded image or a scanned document holds no text to read, so nothing is
   blocked there **even with the feature on**. Promising a protection that a
   whole class of pages cannot receive is the exact failure this project is
   currently working to eliminate in the code; it does not belong in the legal
   document either.
4. **§10** — a one-line note that the Limited Use section is stated in the form
   the Chrome Web Store requires and applies equally in the other browsers.
5. **Top comment** — now names the field in all three dashboards.

No section was removed and no commitment was weakened. Item 3 is the one to
re-read if the redaction claim work lands differently — the wording was chosen
to stay true regardless of how the internal claim states are fixed, but it is
the sentence to check.
