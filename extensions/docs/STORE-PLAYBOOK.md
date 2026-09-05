# STORE-PLAYBOOK.md — browser extension store policy, verified against primary sources

**What this is.** A mechanism reference for publishing browser extensions to the Chrome Web Store,
the Microsoft Edge Add-ons website, and addons.mozilla.org (AMO). It records *what each store
requires and why*, with the official URL for every non-obvious claim.

**What this is not.** Not a strategy document, not a product plan, not legal advice. It contains no
catalogue, no roadmap and no commercial figures. It is a description of rules published by three
platform operators, plus an explicit register of the things nobody could confirm.

**Verification date: 2026-08-14.** Every URL below was fetched on that date. Where a page publishes
its own "last updated" value, it is stated. Where it does not, that is stated too — a policy page
with no date is a page you cannot age-check.

---

## 0. How to read this document

| Marker | Meaning |
| --- | --- |
| **CONFIRMED** | The rule is stated in the operator's own text, quoted here verbatim. |
| **NARROWER THAN OFTEN STATED** | The rule exists but is conditional or scoped; the common paraphrase overstates it. |
| **COULD NOT ESTABLISH** | No primary source found either way. This is a *finding*, not a gap to fill with a plausible answer. |
| **CHANGED** | A rule that moved recently enough that older notes are wrong. |

Three rules govern the content:

1. **Primary sources only.** developer.chrome.com, learn.microsoft.com, extensionworkshop.com,
   developer.mozilla.org, and the stores' own policy and support pages. A blog post or forum answer
   is a pointer to a primary source, never the source.
2. **Quote, don't paraphrase.** A policy summarised into a sentence loses its qualifiers, and the
   qualifiers are the part that decides cases. Where a fragment is quoted, it is marked as a
   fragment.
3. **"Could not establish" beats a confident guess.** An invented store rule costs a rejected
   submission at best and a terminated account at worst.

**Method note.** Pages were retrieved as rendered text. Quotations marked "verbatim" were taken from
a full-text retrieval of the page; a small number of shorter quotations come from targeted
extractions of the same pages and are labelled where that matters. Re-verify anything load-bearing
against the live page before relying on it — see §9.

---

## 1. The one-way doors — read this before the first submission

These are the decisions and events that cannot be undone, or that can only be undone once. They are
first because everything else in this document is recoverable and these are not.

| # | Door | Store | What locks | Source |
| --- | --- | --- | --- | --- |
| 1 | Developer-account identity | Chrome | Enforcement attaches to the account and can reach *related* accounts and other Google services | [repeat-abuse](https://developer.chrome.com/docs/webstore/program-policies/repeat-abuse) |
| 2 | The single appeal | Chrome | One appeal per violation decision, permanently | [notification-and-appeals](https://developer.chrome.com/docs/webstore/program-policies/notification-and-appeals) |
| 3 | Circumvention | Chrome | Immediate termination, not a warning | [enforcement](https://developer.chrome.com/docs/webstore/program-policies/enforcement) |
| 4 | The extra publisher | Chrome | One publisher activation per account lifetime; deleting does not restore it | [share-ownership](https://developer.chrome.com/docs/webstore/share-ownership) |
| 5 | Trader identity on the listing | Chrome, Microsoft | Legal name/address/phone published to users | [trader-disclosure](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure), [business verification](https://learn.microsoft.com/en-us/windows/apps/publish/store-business-verification-reqs) |
| 6 | Malware-tier takedown | Chrome | Extension disabled on all user devices and cannot be re-enabled | [review-process](https://developer.chrome.com/docs/webstore/review-process) |
| 7 | Account country/region | Microsoft (Partner Center) | Read-only after enrollment | [create-dev-account](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) |
| 8 | Account type (Individual vs Company) | Microsoft (Partner Center) | Cannot be changed after enrollment | same |
| 9 | The 7-day malware appeal | Microsoft Edge | Appeal window is 7 days; decisions are final | [Edge developer policies §1.2.2](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies) |
| 10 | The add-on ID | Firefox / AMO | Permanent once AMO signs the package | [add-on ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/) |
| 11 | The distribution right itself | Chrome | Terminable "for any reason", no notice or cure period granted to the developer | [terms](https://developer.chrome.com/webstore/terms) |

### 1.1 Enforcement attaches to the account, not the item (Chrome) — CONFIRMED

> "Serious or repeated violations of the Chrome Web Store Distribution Agreement or these Program
> Policies will result in the suspension of your developer account, and possibly related developer
> accounts. Additionally, you may be banned from using the Chrome Web Store. In extreme cases, this
> may also result in the suspension of related Google services associated with your Google account."
> — [Repeat Abuse](https://developer.chrome.com/docs/webstore/program-policies/repeat-abuse), last
> updated 2022-11-01 UTC

Mechanism: the unit of enforcement is the developer account and its linked set, not the offending
item. The final clause reaches beyond the store entirely, to "related Google services associated
with your Google account". That is the reason a store publisher identity and an identity that holds
unrelated business-critical services (mail, storage, cloud billing) are worth separating *before*
the account is created, not after.

Same account-scoping appears in the duplicate-functionality rule, which binds a developer, related
accounts and affiliates as one entity:

> "We don't allow any developer, related developer accounts, or their affiliates to submit multiple
> extensions that provide duplicate experiences or functionality on the Chrome Web Store."
> — [Spam and Abuse](https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse),
> last updated 2022-11-01 UTC

### 1.2 One appeal, forever (Chrome) — CONFIRMED

> "Developers are permitted to appeal a violation decision once. After the appeal has been reviewed
> and a decision rendered, no further appeals will be accepted for the same violation. Developers are
> encouraged to submit good faith appeals. Any attempts to submit frivolous appeals or misuse the
> appeal process may result in further action, including the forfeiture of future appeal rights."
> — [Notification and appeals](https://developer.chrome.com/docs/webstore/program-policies/notification-and-appeals),
> last updated 2022-11-01 UTC

Mechanism: the appeal is not a conversation. It is a single submission that terminates the process
whichever way it goes. A fast reflexive appeal spends the only one available. There is no published
second stage for most of the world — see §2.10 on the EU/UK-only mediation clause.

### 1.3 Circumvention is termination-grade (Chrome) — CONFIRMED

> "Any attempt to circumvent intended limitations or enforcement actions will result in the immediate
> termination of your developer account, and possibly related developer accounts."
> — [Enforcement circumvention](https://developer.chrome.com/docs/webstore/program-policies/enforcement),
> last updated 2022-11-01 UTC

Note the penalty tier: *immediate termination*, skipping suspension. Note also what is **COULD NOT
ESTABLISH** about it — see §7.1. The page carries no definition of "intended limitations" and no
examples, and it never mentions item caps or additional accounts. Republishing a taken-down item
under a second account is squarely an "enforcement action" being circumvented; whether a numeric
publishing cap is an "intended limitation" within the meaning of this sentence is *not stated
anywhere primary*, and this document does not assert it.

### 1.4 The publisher-activation quota (Chrome) — CONFIRMED, with an internal contradiction on the page

> "You can only create one publisher in your account lifetime. Deleting the publisher does not
> restore your lifetime quota of one publisher activation."
> — [Share ownership](https://developer.chrome.com/docs/webstore/share-ownership), last updated
> 2026-04-15 UTC

The same page also states that a publisher already exists before that quota is used:

> "Publishers own one or more items in the Chrome Web Store. A publisher is created when you first
> register as a developer, and you can create one additional publisher if needed."

**These two statements do not agree on the total.** Read together, the account gets the publisher
created automatically at developer registration *plus* one additional activation, i.e. two; read
alone, the Caution says one. Treat the total as unresolved and the *non-restoring* property as the
part that is certain: whatever the quota is, deleting a publisher does not give it back.

The same page also records a structural change worth knowing, because older material assumes
otherwise:

> "Previously, the Chrome Web Store distinguished between individual and group publishers. This is no
> longer the case and you can add members to any publisher you are an admin of."

### 1.5 Trader identity is published to users — CONFIRMED (Chrome and Microsoft)

Chrome collects trader status by self-declaration and publishes the result:

> "The verified information of traders is available to users of the Chrome Web Store."
> — [Trader disclosure](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure),
> last updated 2024-02-09 UTC

The same page defines the category, using the EU consumer-law wording:

> Trader: "Any natural person or any legal person, who is acting for purposes relating to his trade,
> business, craft or profession in relation to contracts on this marketplace."

and places the classification on the developer: *"It is the developer's responsibility to accurately
self-declare their trader/non-trader status."* Trader information collection began 2024-02-17.

Microsoft is more explicit about what "trader details" means in practice, and answers the obvious
question directly:

> "Due to regulatory requirements and Microsoft's commitment to customer experience, a phone number,
> physical address and email are required. We understand that you might not necessarily maintain all
> of these methods for the purposes of customer contact. Some developers have created post office
> (P.O.) boxes for physical addresses, a phone number with a voice mail, and/or an email alias with
> an automated response directing a customer to the preferred form of communication. Microsoft also
> accepts addresses for registered agents."
> — [Company account verification requirements](https://learn.microsoft.com/en-us/windows/apps/publish/store-business-verification-reqs),
> ms.date 2025-02-27, page updated 2026-03-09

Mechanism: for anyone trading as a natural person, the published address is a personal address unless
a deliverable alternative (P.O. box, registered agent) is arranged first. The address is attached to
the account, so it is chosen once and inherited by every listing under it. Microsoft also states the
consequence of not completing verification: *"All partners were required to enter in their DUNS IDs
or supporting documents by February 17, 2025. Partners who have not done so are blocked from making
edits to new or existing apps."*

Microsoft additionally publishes a disclaimer on every product detail page: *"This seller has
certified that it will only offer products or services that comply with all applicable laws."*

### 1.6 A malware-tier takedown is not reversible (Chrome) — CONFIRMED

> "The violating extension is disabled on all end user devices. Unlike standard takedowns, these
> extensions cannot be re-enabled."
> — [Review process](https://developer.chrome.com/docs/webstore/review-process), last updated
> 2021-12-10 UTC

Two properties of this tier make it different from every other enforcement path: there is no warning
stage, and the publisher is not emailed at takedown time — *"notification is not sent to the
publisher's email address when the extension(s) are taken down."* The page reserves permanent account
suspension for a subset: *"in more severe cases the developer's Chrome Web Store account will be
permanently suspended."* (Fragment quote — the governing qualifier "in more severe cases" is part of
the sentence and must not be dropped.)

### 1.7 Partner Center enrollment fields lock at enrollment (Microsoft) — CONFIRMED

> "In the **Account country/region** dropdown list, select either where you live, or where your
> business is located. **Important:** After enrollment, the value of this field is read-only."
>
> "In the **Account type** section, select the **Individual** or **Company** option button.
> **Important:** After enrollment, the value of this field can't be changed."
>
> "Switching from a company to an individual account is not supported."
> — [Register as a Microsoft Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account),
> ms.date 2025-12-12, page updated 2026-08-12

This matters more than it looks, because the Microsoft Store Policies push most commercial publishers
towards Company:

> "Company accounts must be used for organizations, businesses, and any person acting in relation to
> their trade or profession."
> — [Microsoft Store Policies §10.14](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies),
> version 7.19, publish date 2025-09-10, effective 2025-10-14

A Company account carries a longer verification path — *"The account verification process is longer,
and involves confirmation that you're authorized to create the account for your company. The duration
of the process can range from a few days to a few weeks. Your company might receive phone calls from
Microsoft verification partners."* — and requires the registered business name as the publisher
display name. Choosing Individual to move faster is a choice that cannot be reversed later.

### 1.8 The Edge malware appeal window is 7 days — CONFIRMED

> "If an extension is found to contain malware, the account will immediately be suspended. If you
> believe your account has been wrongly suspended, please contact the support team at
> ext_dev_support@microsoft.com to raise an appeal request within 7 days. Any request received after
> 7 days of account suspension will not be considered. All decisions made during the appeal process
> are final, and no further requests will be considered."
> — [Developer policies for the Microsoft Edge Add-ons website §1.2.2](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies),
> ms.date 2026-07-24, page updated 2026-08-13

This is the **only numeric appeal deadline found on any of the three stores** in this review. It is
short, it starts at suspension (not at notification), and the decision is final. It refutes the
common claim that Microsoft publishes no appeal window — see §6.

### 1.9 The Firefox add-on ID is permanent at signing — CONFIRMED (with a limit on what that proves)

> "When you have finished developing the extension, you can package it and submit it to AMO for
> review and signing. If the packaged extension you upload does not contain an ID, AMO generates one.
> It's only at this point that the add-on is assigned a permanent ID, which is embedded in the signed
> packaged extension. After the add-on is installed, the ID is shown in the `about:debugging`
> **Extension ID** field. This ID is the same for all users of the add-on."
> — [Extensions and the add-on ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/),
> page last updated 2026-01-05

Also confirmed on the same page and on MDN:

- Manifest V3: *"For Manifest V3 extensions you must add an ID to your extension's manifest.json file
  before it's submitted to AMO"*, and AMO does **not** assign one for you — *"You must create an ID
  for signing Manifest V3 extensions; AMO does not assign an ID."*
  ([browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings),
  last modified 2026-04-20)
- Uniqueness is checked at first signing: *"When signing extensions for the first time,
  addons.mozilla.org (AMO) checks that the ID is unique."* (same page)
- ID format is a GUID or an email-like string; MDN warns that a real email address there may attract
  spam.

**What is NOT established:** neither page states that changing the ID publishes a *different* add-on
rather than an update. That conclusion follows naturally from permanence plus uniqueness, but it is an
inference, and this document does not present it as policy text. See §7.4.

### 1.10 The contract layer is harsher than the policy pages (Chrome) — CONFIRMED

> "Google may suspend or terminate your right to publish Products on the Web Store for any reason,
> including but not limited to: (a) violation of the Agreement or the Google Chrome Web Store Program
> Policies, or (b) infringement upon any intellectual property rights"
> — [Chrome Web Store Developer Agreement](https://developer.chrome.com/webstore/terms), dated
> May 4, 2021

Mechanism: the dashboard appeal is a discretionary policy process, not a contractual entitlement. The
agreement grants no notice period, no cure period and no reinstatement right to the developer. Any
plan that treats store presence as a durable asset is mispricing it.

---

## 2. Chrome Web Store

### 2.1 The published-item limit — CONFIRMED, on a very old page

> "You cannot have more than 20 *extensions* published on the Chrome Web Store. There is no such
> limit on the number of themes. If you reach this limit, [you may request a limit increase]. The
> Chrome Web Store staff will review your existing items and your developer account history, and if
> approved, you will be granted an increase. Please note that if your developer account has been
> suspended in the past, or you have had items taken down previously for policy violations, or your
> items consistently receive low quality ratings, your request may be denied."
> — [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish), page
> footer: **Last updated 2014-02-28 UTC**

Mechanism, in four parts:

1. **The cap counts extensions only.** Themes are explicitly exempt. Write-ups that describe the 20 as
   a combined themes-plus-extensions total are wrong against this text.
2. **It counts *published* items**, not items ever created.
3. **An increase is discretionary**, granted after a staff review of both the existing items and the
   account history. There is no self-service raise.
4. **The denial grounds include a reputation test**, not only a compliance test: *"your items
   consistently receive low quality ratings"* is listed alongside suspensions and takedowns. Item
   quality is therefore an input to publishing capacity, not only to discovery.

**Freshness caveat, stated plainly:** this paragraph is the only place the number appears. It is not
in the Program Policies, not in the Developer Agreement, and not in the Help centre; the page footer
reads 2014-02-28 UTC while the surrounding policy corpus was revised in 2024, 2025 and 2026. Treat 20
as the documented figure and confirm the live value in the developer dashboard before relying on it.

**COULD NOT ESTABLISH:** whether items with *unlisted* or *private* visibility count toward the cap;
whether the cap applies per publisher or per account now that the individual/group publisher
distinction has been removed (§1.4). Neither is answered on any page read.

**COULD NOT ESTABLISH:** the increase-request route. The "request a limit increase" link resolves to
Google's generic [one-stop support form](https://support.google.com/chrome_webstore/contact/one_stop_support),
which, fetched anonymously, offers categories for an item, a developer account, another item, a
feature suggestion and general support — none of them a published-item-limit option. Whether a
dedicated option appears behind a signed-in account that has reached the cap was not established;
the form is behind a Google login. The form publishes no SLA.

### 2.2 Duplicate experiences and repetitive content

Chrome's constraint on a many-item catalogue is a **functionality** test, not a metadata test. The
governing sentence is quoted in §1.1. The Spam FAQ restates it with its qualifier intact:

> "Our developer policy prohibits the submission of repetitive content. In general, this means you
> cannot submit multiple extensions that provide the same experience."
> — [Spam FAQ](https://developer.chrome.com/docs/webstore/program-policies/spam-faq), last updated
> 2020-05-01 UTC

The same page prescribes the remedy and names the failure pattern:

> "Multiple extensions with highly similar functionality, content, and user experience. If these
> extensions are each small in content volume, and provide the same single purpose, developers should
> create a single extension that aggregates all the content." (fragment, as bulleted on the page)

Localisation-only variants are explicitly refused — the page's own example is a product listed
separately per country. **Three exemptions are enumerated, and they are narrow:**

| Exemption | Condition |
| --- | --- |
| Host-specific extensions | Each version "must request, in the manifest, access to permissions that are limited to that host" |
| Publish-to-Domain | "Extensions that are published privately within your domain" — and *"Extensions published as unlisted or public, even if distributed through a single domain, do not qualify for this Publish to Domain (PTD) exemption"* |
| Enterprise B2B / B2B2C | White-label / multi-instance versions, which "must be unlisted and distributed directly to your clients" |

Note the asymmetry that is easy to get backwards: **unlisted visibility disqualifies the domain
exemption and is required for the enterprise exemption.**

### 2.3 Minimum functionality — the rule a template-driven build most often meets

> "Click-baity template extensions that only vary slightly in functionality with negligible utility
> (e.g. a "Word of the Day" extension and a "Daily Inspirational Quotes" extension, which use the
> same general extension template)."
> — [Minimum functionality](https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality),
> last updated 2022-11-01 UTC

Mechanism: the test is not duplication. "Vary slightly in functionality" **plus** "negligible utility"
is enough on its own, and the worked example Google chose is two small, useful, non-malicious
utilities sharing a chassis. Sharing a build system is not what is being policed; shipping products a
reviewer reads as one product reskinned is.

The same policy bars two adjacent patterns:

- Launcher-only items: an extension whose single purpose is installing or launching another app,
  theme, webpage or extension.
- Hand-off items: *"Extensions with functionality that is not directly provided by the extension (e.g.
  file converters which only link to other file conversion services)."*

Calling your own backend is not what the second bullet targets — the target is an extension that
merely navigates the user elsewhere. But the extension must do real work in the browser: UI, state,
page interaction, rendering of results.

### 2.4 Single purpose

> "An extension must have a single purpose that is narrow and easy to understand. Don't create an
> extension that requires users to accept bundles of unrelated functionality."
> — [Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines),
> last updated 2024-07-10 UTC

The [quality guidelines FAQ](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq)
adds the two permitted ways to define that purpose — a narrow focus area or subject matter, or a
narrow browser function — and ties permissions to it: excessive permissions unrelated to the single
purpose are read as enabling unrelated functionality, and are therefore a violation in themselves.

### 2.5 Listing metadata and the quantified spam thresholds

Chrome polices metadata **accuracy and completeness**, and it publishes numeric thresholds:

> "We don't allow extensions with misleading, inaccurate, incomplete, improperly formatted,
> non-descriptive, out of date, or inappropriate metadata, including but not limited to the
> extension's description, category, developer name, title, icon, screenshots, and promotional
> images."
>
> "Unnatural repetition of the same keyword more than 5 times"
> — [Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements/),
> last updated 2024-07-10 UTC

Also prohibited: lists of sites, brands or keywords without substantial added value; lists of regional
locations; unattributed or anonymous testimonials. The Spam FAQ adds that supported sites/brands in a
description should be kept under five, with a link out for longer lists, and advises keeping instances
of any specific keyword under five. A blank description, or a missing icon or screenshots, is a
rejection on completeness alone.

Because these are counts, they are mechanically checkable before submission — a listing-copy linter
that counts keyword occurrences and enumerated brand names catches this class entirely.

**Important scope note:** Chrome has **no** rule requiring your listings to be distinct from *each
other*. Its metadata rules are about accuracy; its sameness rules are about the product experience.
Rewriting listing copy per item does not cure a Chrome duplicate-experience finding.

### 2.6 User data and the privacy policy — NARROWER THAN OFTEN STATED

The requirement is conditional, not universal:

> "If your Product handles any user data, then you must post an accurate and up to date privacy
> policy."
> — [User data policy](https://developer.chrome.com/docs/webstore/program-policies/privacy), last
> updated 2022-11-01 UTC

And the negative case is stated directly:

> "My Product DOES NOT handle user data. What do I need to do? You have no special or new obligations
> under the User Data Policy."
> — [User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), last
> updated 2016-04-23 UTC

Two qualifications matter more than the refutation. First, the threshold is low: disclosure obligations
attach even to data processed or stored only on the user's device, so most extensions with storage,
analytics or non-trivial permissions are in scope. Second, **COULD NOT ESTABLISH**: no page read states
that the privacy-policy URL must be *publicly reachable*. The policy requires posting it and linking it
in the designated dashboard field, which is a weaker and different statement.

Practical reading: publish and maintain a per-item privacy policy anyway, and expect the listing to be
enforceable against it — but do not record "every listing requires a public privacy-policy URL" as a
Chrome rule, because the text does not say that.

### 2.7 CHANGED — the 2026 data policy, enforceable since 2026-08-01

> "Any user data collected by an extension must now be strictly necessary to the extension's disclosed
> single purpose."
>
> "Enforcement for these updated policies will begin on August 1, 2026. Extensions found out of
> compliance after this date may face enforcement action from the Chrome Web Store."
> — [Chrome Web Store policy updates 2026](https://developer.chrome.com/blog/cws-policy-updates-2026),
> published 2026-07-01

Three changes, all live now:

1. Collected data must be strictly necessary to the **disclosed single purpose** — this couples the
   privacy surface to the single-purpose declaration, which was previously a listing concern.
2. **All** data collection must be prominently disclosed, whether or not it relates to the single
   purpose.
3. Changes to data handling after installation must be proactively disclosed to users.

Mechanism worth naming: a shared telemetry or analytics layer reused across several extensions is the
likeliest way to fail (1). A payload that is justified by one extension's declared purpose becomes a
violation in a sibling whose declared purpose does not need it. Under account-level enforcement
(§1.1), that is a correlated exposure, not an isolated one. Telemetry defaults therefore belong per
extension, keyed to its declared purpose, not in a chassis default.

### 2.8 Review, enforcement and timelines

**No fast lane exists.**

> "All submissions go through the same review system, regardless of the tenure of the developer or
> number of active users."
> — [Review process](https://developer.chrome.com/docs/webstore/review-process), last updated
> 2021-12-10 UTC

Signals that lengthen review, per the same page: new developers, new extensions, dangerous permission
requests, significant code changes, broad host permissions (`*://*/*`, `https://*/*`, `<all_urls>`) and
sheer code volume. Review times are stated to be longer than normal following a prior rejection or
warning.

**The enforcement ladder, in order:**

| Stage | What happens | Users told? |
| --- | --- | --- |
| Warning | *"A warning is sent to the developer about the violation. The developer has a set amount of time to address the violation before the item will be taken down."* — publishers get **7 to 30 days** | No — *"End users are not notified during the warning period."* |
| Takedown | Listing removed. *"In most situations takedowns are not permanent: the extension's publisher can return the extension to the web store by submitting a new version that resolves the policy violation."* | Not immediately — *"End users are not notified of the enforcement action immediately after takedown. If the violation remains unresolved for several weeks, Chrome will automatically disable the extension and notify the end user that the extension violates Chrome Web Store policy."* |
| Malware / egregious | No warning tier; disabled on all devices; cannot be re-enabled; no takedown email to the publisher; *"in more severe cases"* permanent account suspension | Yes, on disable |

Two consequences of the table. First, **7 days is the only safe reading of a warning email**, because
the range's floor is 7 and the email may not say which end applies. Second, **appealing does not pause
the damage** — the auto-disable clock runs while an appeal is pending, so the corrected revision is the
restoration path and the appeal is a separate, single-use track.

**Where appeals are filed (CHANGED, 2026-04-08):** item and account enforcement appeals moved into the
Chrome Web Store Developer Dashboard, with extension ID and violation details pre-populated and
duplicate appeals against the same moderation event blocked. One carve-out survives:

> "trader verification appeals are handled separately and still need to be filed using the One Stop
> Support form."
> — [A new appeals process](https://developer.chrome.com/blog/cws-new-appeals-process), published
> 2026-04-08

And the ordering constraint that makes account issues strictly first:

> "If your publisher account is suspended, item-level appeal buttons will be disabled."
> — same page

**Rejection codes worth recognising on sight** (from the
[troubleshooting guide](https://developer.chrome.com/docs/webstore/troubleshooting), last updated
2026-07-20 UTC): single purpose arrives as **Red Magnesium, Red Copper, Red Lithium, Red Argon**;
minimum functionality as **Yellow Potassium**; repetitive content as **Yellow Nickel**.

### 2.9 Appeal deadline — COULD NOT ESTABLISH

No Chrome Web Store primary source read states a deadline, window or day count for filing an appeal
against a takedown or an account suspension. Checked: the notification-and-appeals policy, the review
process page, the 2026 appeals blog, the troubleshooting guide, the Developer Agreement and the
one-stop support entry point.

**Absence of a published deadline is not evidence that appeals are accepted indefinitely.** Record
this as "no deadline is published", never as "there is no deadline". If a real deadline exists, the
termination email is the place it will appear.

### 2.10 The dispute route ends at the appeal for most publishers — CONFIRMED

> "If you are a business user based in the EU or the UK, you may also apply to resolve a dispute under
> this Agreement with mediation"
> — [Terms](https://developer.chrome.com/docs/webstore/program-policies/terms), dated May 4, 2021

The clause is expressly scoped to business users based in the EU or the UK, and is voluntary on both
sides even for them. No equivalent global or other-jurisdiction out-of-court route is published. For
publishers outside those jurisdictions the escalation ladder terminates at the single dashboard
appeal.

---

## 3. Microsoft: Edge Add-ons, and where the Microsoft Store Policies do and do not apply

### 3.1 Which document governs an extension — read this first

Two separate policy documents exist and they are routinely conflated:

| Document | Governs | Version / date |
| --- | --- | --- |
| [Developer policies for the Microsoft Edge Add-ons website](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies) | Browser extensions published at the Edge Add-ons website via Partner Center | ms.date 2026-07-24, page updated 2026-08-13 |
| [Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) | Apps, games, add-ons and in-product content in the Microsoft Store | Version 7.19, published 2025-09-10, effective 2025-10-14; ms.date 2026-07-30 |

Both are administered through Partner Center and both bind via the Microsoft Store App Developer
Agreement, which Edge registrants accept at enrollment. But their numbered clauses are **not the
same rules**, and citing a Store Policy number for an extension question points at text that does not
govern it. §3.5 shows where this bites hardest.

### 3.2 Edge: distinct value, distinct metadata, and bulk submissions — CONFIRMED

> "Your extension must have a single purpose with narrow functionality. For example, your extension
> cannot function as a simple calculator and as a code remote scanner simultaneously." (§1.1.1)
>
> "Your extension may not use a name or icon similar to that of other extensions, must not reference
> other browsers, and must not claim to represent a company, government body, or other entity if you
> don't have permission to make that representation." (§1.1.2)
>
> "There should be distinct and informative details about your extension and its functionality in the
> listing (metadata) for your extension." (§1.1.5)
>
> "Bulk submissions of extensions with the same functionality and code are not allowed." (§1.2)
>
> "Extensions with obfuscated code aren't allowed. This includes code within your extension package,
> as well as any external code or resource fetched from the web. You may be asked to refactor parts of
> your code, if it is not reviewable." (§1.1.7)
>
> "Search terms may not exceed seven unique terms, and should be relevant to your extension." (§1.1.4)
> — all from the [Edge developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)

Two mechanisms worth separating:

- **§1.1.5 is a metadata-quality rule** — the listing must carry distinct and informative detail.
- **§1.2 is a code-and-function rule** — same functionality *and* code submitted in bulk is refused
  regardless of how the listings read.

Note also that Edge's name/icon similarity rule (§1.1.2) carries **no "unless also published by you"
carve-out**, unlike the Microsoft Store analogue in §3.5. And the store reserves an open-ended
rejection right: *"The Microsoft Edge Add-ons website may reject or remove any extension that they
deem to be inappropriate, even if the extension doesn't violate any specific policy."* (§2.1)

Permissions are policed with an explicit ban on speculative ones:

> "Your extension must only request those permissions that are necessary for functioning and may not
> request permission for functionalities that go beyond the capabilities required to perform and
> function as declared. Requesting permissions or features solely for the purpose of 'future proofing'
> is not allowed." (§1.6)

### 3.3 Edge: personal information and the privacy policy — NARROWER THAN OFTEN STATED, and stricter in one respect

The section opens with its own scope: *"The following requirements apply to extensions that access
personal information."* Within that scope the obligations are strong:

> "Your extension may collect, access, use, or transmit personal information (including web browsing
> activity) only if required by and only for use in a prominently disclosed, user-facing feature. You
> must clearly state the data handling practices of your extension at the time of installation,
> including any transfer or use of user data. […] You must have a clear and comprehensive privacy
> policy that outlines your data handling practices, including the use of any third-party services."
> (§1.5.1)

Three Edge-specific mechanics that have no Chrome equivalent:

1. **The privacy policy must be yours and must be Edge-facing.** *"The privacy policy provided should
   be relevant to the product and should not use the Microsoft privacy statement unless the extension
   is an official Microsoft extension. Additionally, the privacy policy should primarily refer to the
   Microsoft Edge browser and not other browsers."* (§1.5.2) A single cross-browser policy document
   copied from a Chrome listing does not satisfy this as written.
2. **Third-party sharing is capped at processors doing product improvement and analytics** for that
   extension, under written confidentiality/security agreements — *"Any disclosure of user data to a
   third party outside these conditions is expressly prohibited."* (§1.5.3)
3. **Data brokering is banned regardless of consent.** *"Data brokering means any collection, sale,
   licensing, transfer, disclosure, sharing, or other making available of user data to any third
   party for monetary or other commercial benefit, or for any purposes beyond those permitted above,
   regardless of user consent."* (§1.5.3) Consent is not a cure here — this is a flat prohibition.

Opt-out must be immediate and total: *"When such an option is exercised by the user, the extension
must immediately and fully stop collecting, transmitting, or processing any user data."*

### 3.4 Microsoft Store §10.5.1 (apps) — also conditional

> "If your product accesses, collects or transmits Personal Information, or if otherwise required by
> law, you must maintain a privacy policy. You must provide users with access to your privacy policy
> by entering the privacy policy URL in Partner Center when you submit your product."
> — [Microsoft Store Policies §10.5.1](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)

The same clause names product types where it is unconditional in practice: *"Product types that
inherently have access to Personal Information must always have privacy policies. These include, but
are not limited to, Desktop Bridge and Win32 products."*

### 3.5 The 10.1.1 carve-out and 10.1.4 — CONFIRMED as a matter of text; enforcement behaviour unestablished

Verbatim, from [Microsoft Store Policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)
v7.19:

> **10.1.1** — "Your product must not use a name, images, or any other metadata that is the same as
> that of other products **unless the product is also published by you**." (emphasis added)
>
> **10.1.3** — "Search terms must adhere to the following guidelines: Not exceed seven unique terms or
> phrases. Be relevant to your product. Not include pricing terms. **Not use other product titles
> unless those products are also published by you.**"
>
> **10.1.4** — "Your product must have distinct and informative metadata and must provide a valuable
> and quality user experience. Your product must also have an active presence in the Store."

Mechanism: the "unless also published by you" carve-out appears **only** in 10.1.1 and 10.1.3. It is
absent from 10.1.4, which states its requirement unconditionally. Reading the carve-out into 10.1.4
would require importing an exception from a different clause, which the text does not do.

**COULD NOT ESTABLISH:** whether certification in practice treats 10.1.4 as independent of 10.1.1.
The textual structure supports it; no Microsoft page states the interaction. Record the text as
confirmed and the enforcement behaviour as unverified. Note also that for **extensions** the operative
rule is the Edge policy §1.1.5 (§3.2), not 10.1.4.

### 3.6 Financial transactions — the substance holds but the clause numbers are commonly misattributed

For Microsoft Store products (apps), **10.8.1** is the clause that permits a third-party purchase API:

> "Non-game products made available on PC devices may either use a secure third-party purchase API or
> the Microsoft Store in-product purchase API for in-app purchases of digital items or services that
> are consumed or used within the product."

But the **conditions** commonly attributed to 10.8.1 are in **10.8.2**:

> "In cases where your product's use of a secure third-party purchase API is allowed or required, the
> following requirements apply:
> - At the time of the transaction or when you collect any payment or financial information from the
>   customer, your product must identify the commerce transaction provider, authenticate the user, and
>   obtain the user's confirmation of the transaction.
> - […] If your product collects credit card information or uses a third-party payment processor that
>   collects credit card information, the payment processing must meet the current PCI Data Security
>   Standard (PCI DSS).
> - […] **You must note the use of a secure third-party purchase API in Partner Center during the
>   submission process.**"

Subscriptions for non-game PC products are covered separately by **10.8.6**, and **10.8.3** forces an
account-type consequence: *"If your product requires financial account information, you must submit
that product from a company account type. Products from individual accounts cannot require financial
information for primary functionality."* Given §1.7, that is a decision made at enrollment.

**For Edge extensions the rule is different again.** The Edge developer policies §1.8.1 do not
reference the Microsoft Store in-product purchase API at all:

> "You must use a secure third-party purchase API for purchases of physical goods or services. You
> must use a secure third-party purchase API for payments made in connection with any other services
> including real-world gambling or charitable contributions."

§1.8.2 requires the listing and the extension to disclose in-product purchase types and price ranges,
and to make it clear to the user that a purchase is being initiated. **COULD NOT ESTABLISH:** whether
the Partner Center declaration requirement from Store Policy 10.8.2 is applied to Edge extension
submissions — the Edge policy text does not restate it.

### 3.7 Trader / business verification (Microsoft)

Covered in §1.5. Additional mechanics from the same page:

- Trader is the EU Digital Services Act definition: *"a Trader is any natural or legal person acting
  in relation to his or her trade, company, business, or profession."*
- Verification is by DUNS ID or documentary evidence; documents must have been issued within the past
  12 months, and if they carry an expiry it must be at least two months beyond submission.
- Vetting is composite: *"The vetting status is based on 5 factors. If any of those factors have a
  failure, the publisher will show as rejected and cannot publish."*
- Domain verification rejects generic addresses: the contact must be an individual's work email, not a
  group alias, and plus-addressing is not accepted.
- Company accounts must display customer support contact information on the product detail page in
  certain regions ([Store Policies §10.14](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)).

### 3.8 Microsoft enforcement and appeals

- **Edge, malware:** immediate account suspension, 7-day appeal window, decisions final (§1.8).
- **Edge, general:** *"Non-compliance may result in extension removal and account suspension or
  termination."* (§2.8). Certification questions and appeals route through the
  [support request form](https://support.microsoft.com/supportrequestform/e7a381be-9c9a-fafb-ed76-262bc93fd9e4).
- **Microsoft Store:** the policy page directs certification questions to reportapp@microsoft.com and
  publishes **no appeal deadline** on that page. **COULD NOT ESTABLISH** whether a window exists for
  non-malware Microsoft Store enforcement.
- Both stores publish annual appeal statistics, which is unusual and useful as a base rate. For
  1 July 2025 – 30 June 2026: the Microsoft Store reports 12,626 total issues, of which 1,118 were app
  and/or account enforcement action appeals, 623 decisions overturned, average processing time 2.37
  days. The Edge Add-ons website reports 193 total issues, 50 enforcement appeals, 12 overturned,
  average processing time 3.03 days. (Sources: the two policy pages linked in §3.1.) Note the figures
  count *all* issue types, so "overturned" cannot be read as an appeal success rate.

**No published item-count limit was found for Edge.** Neither the Edge developer policies nor the
registration documentation states a maximum number of extensions per developer account. Recorded as
**COULD NOT ESTABLISH** rather than "no limit exists".

---

## 4. Firefox / addons.mozilla.org (AMO)

### 4.1 The add-on ID

Covered in §1.9. Practical mechanics from the same page:

- Setting the ID at the start of development is recommended for MV2 and required for MV3.
- An ID is needed during development for `storage.managed`, `storage.sync`,
  `identity.getRedirectURL`, native messaging, `pkcs11`, `runtime.onMessageExternal`,
  `runtime.onConnectExternal`, the `dictionaries` manifest key, and for installing an unsigned XPI
  rather than a temporary `about:debugging` load.
- Without an ID, `about:debugging` assigns a random temporary ID that survives a reload but **not** a
  browser restart — which silently breaks exactly the APIs listed above during testing.
- Other browsers ignore the key: *"If you do add the `browser_specific_settings` manifest key (to add
  an ID), Google Chrome ignores it, and Apple Safari ignores Firefox's `gecko` and `gecko_android`
  sub-keys."* So a single manifest can carry it safely.
- Updating an MV2 add-on through the AMO API without an ID in the manifest requires passing the ID in
  the request.

### 4.2 Privacy policy — conditional, same as the other two stores

> "This add-on has a privacy policy: if any data is being transmitted from the user's device, a
> privacy policy explaining what is being sent and how it's used is required."
> — [Submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/),
> page last updated 2026-05-10

### 4.3 Data handling and consent

> "Add-ons must limit data transmission to what is necessary for functionality, and must use the data
> only for the purpose for which it was transmitted."
>
> "Before an add-on may transmit personal information, it must clearly describe, and the user must
> affirmatively consent to the type of personal data being transmitted."
> — [Add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/), page last
> updated 2026-04-30

Developers must also give users a clear way to control the add-on's data transmission, either through
their own consent interface or Firefox's built-in system.

### 4.4 Similar add-ons, forks and duplicates

> "If the add-on is a fork of another add-on, the name must clearly distinguish it from the original
> and provide a significant difference in functionality and/or code."
>
> "Duplicate themes are not permitted."
> — same page

Mechanism note: AMO's published rule addresses **forks** and **themes**. **COULD NOT ESTABLISH:**
whether AMO enforces an equivalent of Chrome's duplicate-experience rule against multiple similar
*extensions* by the same developer. No such text was found in the policies read.

### 4.5 Blocking and account deletion

> "Mozilla reserves the right to block or delete any developer's account on addons.mozilla.org,
> thereby preventing further use of the service, for certain violations of Mozilla's policies."
>
> "Mozilla may attempt to contact the add-on's developer(s) and provide a reasonable time frame for
> the problems to be corrected before a block is deployed."
> — same page

Note the two hedges: *"may attempt"* and *"certain violations"*. No formal appeal process, appeal
deadline, or named contact channel is described in the policies read — **COULD NOT ESTABLISH**.

### 4.6 Trader details on AMO

Not present in the policies read. No trader or business-details publication requirement was found for
AMO listings. Recorded as **not found**, not as "not required" — an obligation could live in the
Mozilla Add-on Distribution Agreement rather than the policy page, which was not part of this review.

---

## 5. Cross-store comparison of mechanism

| Mechanism | Chrome Web Store | Microsoft Edge Add-ons | AMO (Firefox) |
| --- | --- | --- | --- |
| Published-item cap | 20 extensions; themes exempt; increase is discretionary | None found (COULD NOT ESTABLISH) | None found (COULD NOT ESTABLISH) |
| Sameness rule targets | The **experience/functionality**, across the developer, related accounts and affiliates | Both the **listing detail** (§1.1.5) and **bulk same-code submissions** (§1.2) | Forks (naming + significant difference) and duplicate **themes** |
| Distinct metadata *between your own listings* | Not required as such | Required to be "distinct and informative" per listing | Not found |
| Single purpose | Required, narrow and easy to understand | Required, "single purpose with narrow functionality" | Not found as a named rule |
| Privacy policy | Required **if** the product handles user data | Required **if** the extension accesses personal information; must be Edge-facing and not Microsoft's | Required **if** data is transmitted from the user's device |
| Data collection ceiling | Strictly necessary to the **disclosed single purpose** (since 2026-08-01) | Only for a "prominently disclosed, user-facing feature"; data brokering banned regardless of consent | Limited to what is necessary for functionality |
| Trader details published | Yes, to store users | Yes — phone, physical address, email on the PDP | Not found |
| Published appeal deadline | **None published** | **7 days for malware suspensions**; none published otherwise | **None published** |
| Appeal attempts | Exactly one per violation | Malware: one, final | Not stated |
| Enforcement scope | Account + related accounts + possibly other Google services | Extension removal and account suspension/termination | Block or delete the developer account |
| Identity that cannot be changed later | Publisher activation quota | Account country/region; account type | Add-on ID (per add-on) |

---

## 6. Commonly repeated claims that are wrong, or narrower than stated

Each of these is a claim seen in circulation — including in internal notes — that this verification
pass contradicts.

1. **"Google gives you 180 days to appeal."** That figure is a **Google Play** rule for Android
   developer accounts — *"Starting January 28, 2026 you must submit your appeal within 180 days of the
   date your account was terminated"*
   ([Play Console help](https://support.google.com/googleplay/android-developer/answer/16659089?hl=en);
   the page shows no last-updated date). It does not mention the Chrome Web Store, and Play and the
   Chrome Web Store are separate programs with separate policy sets. Chrome publishes no appeal window
   at all (§2.9). Do not carry the number across stores.
2. **"Chrome's 20 covers themes and extensions together."** It does not; themes are explicitly exempt
   (§2.1).
3. **"Microsoft publishes no appeal window."** Edge publishes a **7-day** window for malware-triggered
   account suspensions, with final decisions (§1.8). This is the shortest published deadline found
   anywhere in this review.
4. **"Every store listing requires a publicly reachable privacy-policy URL."** All three stores make
   it conditional on data handling (§2.6, §3.3, §3.4, §4.2), and none of the pages read imposes an
   explicit public-reachability test. The practical instruction — publish one per item — is still
   sound; the universal *rule* is not what the sources say.
5. **"Chrome's spam exemptions cover unlisted domain-published extensions."** Inverted. Unlisted
   visibility **disqualifies** the Publish-to-Domain exemption and is **required** for the enterprise
   B2B/B2B2C exemption (§2.2).
6. **"Chrome takedowns are permanent unless you appeal."** The page says the opposite emphasis: *"In
   most situations takedowns are not permanent"* and the restoration path is a corrected new version,
   not the appeal (§2.8). The malware tier is the exception that genuinely cannot be re-enabled.
7. **"Malware violations always mean permanent account suspension."** Permanent account suspension is
   reserved for *"more severe cases"* within that tier; the baseline is immediate takedown with no
   warning and no publisher email (§1.6).
8. **"Microsoft 10.8.1 requires you to declare the third-party purchase API in Partner Center."** The
   permission is in 10.8.1; the declaration and seller-identification duties are in **10.8.2**, and
   neither clause governs Edge **extensions**, which are covered by Edge §1.8 (§3.6).
9. **"A Chrome account gets exactly one publisher, ever."** The share-ownership page contradicts
   itself: registration creates one and *"you can create one additional publisher if needed"*, while
   the Caution says one per lifetime. The reliable part is that deletion does not restore the quota
   (§1.4).
10. **"Building a track record gets you faster review on Chrome."** It does not — all submissions use
    the same review system regardless of tenure or user count (§2.8).

---

## 7. COULD NOT ESTABLISH — the register

Consolidated so it cannot be lost in the prose. Each of these is an open question, not an implied
answer.

1. **Whether Chrome's 20-extension cap is an "intended limitation"** within the meaning of the
   enforcement-circumvention policy. The policy defines nothing and gives no examples; the section
   heading points at evading *enforcement actions*. The downside of guessing wrong is immediate
   termination of the account and possibly related accounts, so this is a question to settle with the
   operator in writing rather than by inference (§1.3).
2. **Whether unlisted or private items count toward the Chrome cap**, and whether the cap is applied
   per publisher or per account after the individual/group publisher merge (§2.1, §1.4).
3. **Whether a dedicated limit-increase flow exists** behind a signed-in Chrome developer account. The
   public link resolves to a generic support form with no such category, and no SLA is published
   (§2.1).
4. **Whether changing a Firefox add-on's ID publishes a different add-on** rather than an update.
   Permanence at signing and uniqueness at first signing are both confirmed; the consequence is not
   stated on the pages read (§1.9).
5. **Whether any Chrome appeal deadline exists** but is unpublished (§2.9).
6. **Whether Microsoft applies Store Policy 10.1.4 independently of the 10.1.1 carve-out** in practice
   (§3.5).
7. **Whether Edge extension submissions inherit the Store Policy 10.8.2 Partner Center declaration
   duty** for third-party purchase APIs (§3.6).
8. **Whether Chrome requires the privacy-policy URL to be publicly reachable** (§2.6).
9. **Whether any Edge or AMO item-count limit exists** (§3.8).
10. **Whether AMO enforces a duplicate-experience rule against similar extensions** by the same
    developer (§4.4).
11. **Whether AMO publishes any appeal route or deadline** for a block or account deletion (§4.5).
12. **Whether AMO requires trader details** anywhere outside the policy page read (§4.6).

---

## 8. Source freshness — the corpus disagrees with itself

The rules above carry last-updated dates spanning twelve years. When two sources conflict, prefer the
more recently dated page and the operator's blog announcements over old documentation pages — but do
not discard the old ones, because some rules exist nowhere else.

| Source | Last updated (as published) |
| --- | --- |
| Chrome: [publish / 20-item limit](https://developer.chrome.com/docs/webstore/publish) | 2014-02-28 UTC |
| Chrome: [user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) | 2016-04-23 UTC |
| Chrome: [spam FAQ](https://developer.chrome.com/docs/webstore/program-policies/spam-faq) | 2020-05-01 UTC |
| Chrome: [Developer Agreement](https://developer.chrome.com/webstore/terms) / [terms](https://developer.chrome.com/docs/webstore/program-policies/terms) | May 4, 2021 |
| Chrome: [review process](https://developer.chrome.com/docs/webstore/review-process) | 2021-12-10 UTC |
| Chrome: [spam-and-abuse](https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse), [minimum-functionality](https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality), [repeat-abuse](https://developer.chrome.com/docs/webstore/program-policies/repeat-abuse), [enforcement](https://developer.chrome.com/docs/webstore/program-policies/enforcement), [notification-and-appeals](https://developer.chrome.com/docs/webstore/program-policies/notification-and-appeals), [privacy](https://developer.chrome.com/docs/webstore/program-policies/privacy) | 2022-11-01 UTC |
| Chrome: [trader disclosure](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure) | 2024-02-09 UTC |
| Chrome: [listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements/), [quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) | 2024-07-10 UTC |
| Chrome: [share ownership](https://developer.chrome.com/docs/webstore/share-ownership) | 2026-04-15 UTC |
| Chrome: [new appeals process](https://developer.chrome.com/blog/cws-new-appeals-process) | published 2026-04-08 |
| Chrome: [2026 policy updates](https://developer.chrome.com/blog/cws-policy-updates-2026) | published 2026-07-01, enforced from 2026-08-01 |
| Chrome: [troubleshooting](https://developer.chrome.com/docs/webstore/troubleshooting) | 2026-07-20 UTC |
| Microsoft: [business verification](https://learn.microsoft.com/en-us/windows/apps/publish/store-business-verification-reqs) | ms.date 2025-02-27, page updated 2026-03-09 |
| Microsoft: [Edge registration](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account) | ms.date 2025-12-12, page updated 2026-08-12 |
| Microsoft: [Store Policies v7.19](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies) | published 2025-09-10, effective 2025-10-14; ms.date 2026-07-30 |
| Microsoft: [Edge developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies) | ms.date 2026-07-24, page updated 2026-08-13 |
| Microsoft: [Edge curation and review](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/add-ons-curation) | ms.date 2023-10-13, page updated 2026-08-12 |
| Mozilla: [add-on ID](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/) | 2026-01-05 |
| Mozilla: [add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) | 2026-04-30 |
| Mozilla: [browser_specific_settings (MDN)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings) | 2026-04-20 |
| Mozilla: [submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) | 2026-05-10 |

Two dating hazards observed and worth repeating: Chrome's trader FAQ page reported a footer date that
**predates the requirement it describes**, so a stale-looking footer is not proof the content is
stale; and the 2014-dated publish page carries the only statement of the item cap, so a fresh-looking
corpus is not proof the number was reviewed.

---

## 9. How to re-verify

Policy text changes without notice, and several of the pages above changed within days of this
review. Before relying on any single claim:

1. **Open the URL in the table above and read the clause, not a summary of it.** Check the page's own
   last-updated value against the one recorded here.
2. **Prefer the operator's own dashboard over documentation for numeric limits.** The published-item
   cap is the clearest case: the live developer dashboard answers it directly and the documentation
   page is twelve years old.
3. **Re-read the two blog feeds for changes**, since substantive changes are announced there before
   the policy pages are edited: the [Chrome for Developers blog](https://developer.chrome.com/blog)
   and the ms.date/updated_at values on the learn.microsoft.com pages.
4. **When a claim cannot be found, write "could not establish" and the date you looked.** A negative
   result with a date is a usable fact. A plausible-sounding invention is not.
