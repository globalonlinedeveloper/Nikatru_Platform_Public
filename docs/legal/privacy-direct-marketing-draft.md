# DRAFT for signature — privacy.html: legal basis for first-party promotion, and the objection right

**Status: DRAFT. Nothing in this file is published.** It is the ready-to-sign diff [ADR 040] decision 3
asks for: *"the agent produces the ready-to-sign diff; the section goes live only on owner signature. It
remains THE gate on any promo surface rendering."*

- **Decision record:** `Private/knowledge/decisions/040-cross-promo-v1-lock.md` (LOCKED 2026-08-10), decision 3.
- **Reasoning:** `Private/knowledge/research/44-CROSS-PROMOTION-HOUSE-ADS-OFFERS.md` §3 V2 / V3 / V4 and §4.
- **Duty row:** `first-party-promotion-legal-basis` in `tooling/legal/duty-matrix.json` (K-3, owner-gated,
  prints on every CI run until this is signed or the programme is dropped).
- **Class:** [ADR 031] class B — published legal copy. An agent may propose the wording; only the owner
  publishes it.

---

## 0. Why this is a document and not an edit to the live page

`sites/nikatru/privacy.html` is inside the **policy-version surface**, and three guards make a partial
application impossible rather than merely inadvisable:

| guard | what it does the moment privacy.html's visible text changes |
|---|---|
| `tooling/ci/assert-policy-archive.mjs` | compares the live page's visible text to `sites/nikatru/legal/<published-version>/en/privacy.html`. Any edit without a version bump **fails**: *"one of them was edited without a version bump, so the exact text the user consented to is now two different documents wearing one version number."* |
| `tooling/ci/assert-seams-wired.mjs` | pins `data-policy-version` on the page to `kPrivacyPolicyVersion` in **two** Dart files. Bump the page alone and it **fails** with `policy version DRIFT`. |
| `tooling/ci/assert-policy-claims.mjs` | requires set-equality between the page's `<b>`/`<strong>` spans and `tooling/legal/policy-claims.json`. A new emphasised sentence with no row **fails**; a row with no sentence **fails**. |

So there is no half-state to land: either the whole act (page + two constants + archive snapshot + register
rows) or nothing. Bumping the version **is** the signature. This file holds the whole act so it lands in one
commit.

## 🔴 1. HARD PRECONDITION — do not sign this before the switch exists

The section below tells a reader *"open the app's Settings and turn Offers and promotions off."* **That
control does not exist today.** Publishing this section first would publish a claim about a control a user
cannot find — the same defect class the register was built to catch, committed deliberately.

`knowledge/research/44` §7 rungs **2, 3 and 4** must be on `main` first:

2. `PromoGate` — the pure decision primitive in `packages/core`, including the `suppressed` latch the
   chassis never clears. That latch *is* the Art 21 objection mechanism.
3. `PromoCard` in `packages/design_system` + the same-app upgrade card in the brick **and** `apps/subly`.
4. The objection surface + a `promo` value on `ConsentPurpose`
   (`packages/core/lib/src/analytics/consent.dart` — today `analytics` and `sync_backup`), surfaced **in or
   beside the first promotional card** and not only in Settings (Art 21(4): *"presented clearly and
   separately from any other information"*), with GPC precedence extended to it.

Ordering rule, stated once: **rungs 2–4 ship unsigned and dormant; this section is signed after them and
before any promo surface renders to a real user.** Rung 1 (the Play declarations + format-keyed guard) is
independent and should land first regardless.

## 2. The new section — exact text to insert

Insert as **§3**, immediately after the existing §2 *"How we use information"*, and renumber the sections
below it. It goes there rather than at the end because a legal basis belongs beside the description of the
processing it justifies.

```html
  <h2>3. Offers and promotions inside our apps</h2>
  <p>Some of our apps show occasional messages about our own products &mdash; a paid upgrade to the app you
  are already using, or another Nikatru app. These are <b>first-party promotions</b>: we write them, we show
  them ourselves, and no advertising network, ad exchange or advertising SDK is involved. Nobody pays us to
  show them to you.</p>

  <p><b>The legal basis we rely on.</b> Where the law where you live requires us to state one, we rely on
  our <b>legitimate interest</b> in promoting our own products to the people who already use them (GDPR
  Article 6(1)(f)). The interest is narrow and we would rather name it than gesture at it: telling someone
  who already uses one of our apps that a paid version exists, or that the same small publisher makes
  another app, is how a business with no advertising budget reaches the people it already serves. We
  weighed that against your interests. These messages appear only inside an app you chose to open, they are
  chosen from what you have already paid for and from nothing else, and you can switch them off in one tap.</p>

  <p><b>What we use to decide what to show you.</b> Your entitlement state &mdash; whether you have a paid
  plan for the app you are using &mdash; and nothing else. That decision is made <b>on your device</b>. We
  do not build a profile of you, we do not use your behaviour inside the app to choose these messages, we do
  not use any advertising identifier, and we never look at which other apps are installed on your device.</p>

  <p><b>Your right to object, and how to use it.</b> You can object at any time to your information being
  used for direct marketing, and that right is absolute: if you object, we stop. There is nothing for us to
  weigh and no reason we could give for carrying on (GDPR Article 21(2)). You do not have to write to us.
  Open the app's <b>Settings</b> and turn <b>Offers and promotions</b> off &mdash; promotions stop
  immediately, and they stay off, because we record that you objected so that nothing can turn them back on.
  You can also object by emailing <a href="mailto:support@nikatru.com">support@nikatru.com</a>. Objecting
  costs you nothing else: no feature is removed, no content is withheld, and nothing you have paid for
  changes.</p>

  <p>These messages are about <b>Nikatru apps only</b>. We do not promote anyone else's products, we are not
  paid to show you anything, and we do not share any information with anyone else in order to show them.</p>
```

**Renumbering that rides with it** (headings only; the `<a href="/refund.html">`-style links in the page are
unaffected because no section is linked by number):

| today | after |
|---|---|
| 3. Third-party services | **4.** |
| 4. Sharing of information | **5.** |
| 5. Data retention | **6.** |
| 6. Security | **7.** |
| 7. Children's privacy | **8.** |
| 8. Your rights | **9.** |
| 9. International users | **10.** |
| 10. Changes to this Policy | **11.** |
| 11. Contact us | **12.** |

⚠️ Nothing deep-links a privacy section by number: `grep -rn "privacy.html#" sites/ apps/*/store` returned
**no matches** when this draft was written (2026-08-10). Re-run it at signature time rather than trusting
this sentence — a store listing added since would not know about it.

## 3. The advertising sentence — before and after

This is the sentence [research/44] V3 shows is **blind**: it is registered as a `code` row whose assertion
walks every `pubspec.yaml` for advertising SDKs, and *a house-ad surface adds no dependency*, so the row
stays green while the sentence it defends becomes false.

**Today** (`sites/nikatru/privacy.html` §3, second paragraph):

```html
  <p><b>We do not use advertising networks or advertising SDKs, we do not share data with data brokers, and
  no Nikatru app carries advertising.</b> Usage statistics and crash reports are likewise <b>not</b> sent to
  a third-party analytics product: they are received and stored by software we run ourselves, on
  infrastructure provided by <b>Cloudflare</b> as our hosting provider.</p>
```

**After** (one `<b>` span in, one `<b>` span out — same shape, so the register keeps exactly one row for it):

```html
  <p><b>We do not use advertising networks or advertising SDKs, we do not sell or share data with data
  brokers or advertisers, and no Nikatru app carries third-party advertising.</b> The only promotional
  messages in our apps are our own, about our own products; section 3 explains how they work and how to turn
  them off. Usage statistics and crash reports are likewise <b>not</b> sent to a third-party analytics
  product: they are received and stored by software we run ourselves, on infrastructure provided by
  <b>Cloudflare</b> as our hosting provider.</p>
```

What changed and why each word moved:

- **`carries advertising` → `carries third-party advertising`.** The narrowing is the whole point. Play's
  own ads declaration counts *"House ads: my app renders a small ad banner, interstitial ad, ad wall, and/or
  widget"* as advertising, decided by **format, not by ownership and not by SDK presence**
  (support.google.com/googleplay/android-developer/answer/9859455, quoted in [research/44] V2). So the
  unqualified word becomes false the day a promo surface renders, while the pubspec walk that defends it
  stays green.
- **`share data with data brokers` → `sell or share data with data brokers or advertisers`.** Strictly
  wider, and it is the sentence a Californian reader is looking for. It uses `sell`/`share`, which
  `assert-sink-disclosure.mjs` deliberately excludes from its denial verbs (those are claims about a
  *relationship*, not about possession) — so it introduces no new denial to scope.
- **The added sentence is outside the `<b>`**, so it creates no new register row while making the narrowed
  claim readable rather than lawyerly.

⚠️ **This paragraph still contains the `crash-reports-infrastructure` defect** (crash reports run on Oracle
Cloud, not Cloudflare — `tooling/legal/provider-register.json` disclosureGaps). Do not fix it in the block
above and do not forget it: it rides the *same* signature. See §6.

## 4. The `policy-claims.json` rows — same commit as the prose they swear

`tooling/ci/assert-policy-claims.mjs` enforces set-equality in both directions, so these are not optional
paperwork: without them the build is red the moment the prose lands. All rows are `page: "privacy.html"`.

### 4a. REPLACE the existing advertising row

Only `claim` and `assert.why` change; the walk, the floor and the pattern are untouched, because what they
prove is still exactly true of the narrowed sentence.

```json
    {
      "page": "privacy.html",
      "claim": "We do not use advertising networks or advertising SDKs, we do not sell or share data with data brokers or advertisers, and no Nikatru app carries third-party advertising.",
      "type": "code",
      "assert": {
        "kind": "absent",
        "walk": { "root": ".", "filenameRe": "^pubspec\\.yaml$", "minFiles": 10 },
        "pattern": "(?im)^\\s*(google_mobile_ads|firebase_admob|admob_flutter|applovin_max|unity_ads_plugin|facebook_audience_network|ironsource_mediation|appodeal_flutter|adjust_sdk|appsflyer_sdk|facebook_app_events)\\s*:",
        "why": "A package manifest can refute the THIRD-PARTY half of this sentence outright: an advertising or attribution SDK cannot enter this workspace without appearing as a dependency. 🔴 THE WORD `third-party` IS LOAD-BEARING AND WAS ADDED DELIBERATELY. The sentence used to read 'no Nikatru app carries advertising', and this walk could never have refuted THAT: Google Play's own ads declaration counts a house ad — 'a small ad banner, interstitial ad, ad wall, and/or widget' promoting our own apps — as advertising, keyed on FORMAT rather than on ownership or SDK presence (support.google.com/googleplay/android-developer/answer/9859455). A first-party promo surface adds no dependency, so the old claim would have gone false while this row stayed green — the exact silent-failure class this register exists to catch. The claim is now scoped to what the walk can actually see, and the first-party half is disclosed in §3 and asserted by the two rows below. ⚠️ A NAMED LIST IS STILL NOT EXHAUSTIVE; the standing trigger 'the day an ad SDK enters a pubspec' is the `global-privacy-control` row in tooling/legal/duty-matrix.json, and the trigger for the FORMAT question is `first-party-promotion-legal-basis` in the same file."
      }
    },
```

### 4b. ADD — eight new rows for the eight new emphasised spans in §3

`Settings` is **not** in this list: privacy.html already emphasises it in the withdrawal paragraph and the
guard de-duplicates spans within a page, so the existing row covers both occurrences.

```json
    {
      "page": "privacy.html",
      "claim": "first-party promotions",
      "type": "code",
      "assert": {
        "kind": "absent",
        "walk": { "root": ".", "filenameRe": "^pubspec\\.yaml$", "minFiles": 10 },
        "pattern": "(?im)^\\s*(google_mobile_ads|firebase_admob|admob_flutter|applovin_max|unity_ads_plugin|facebook_audience_network|ironsource_mediation|appodeal_flutter|adjust_sdk|appsflyer_sdk|facebook_app_events)\\s*:",
        "why": "'we show them ourselves, and no advertising network, ad exchange or advertising SDK is involved' is the half of the section a dependency walk CAN refute, and it is the same walk the advertising row uses. Kept as its own row rather than folded into that one because the two sentences are in different sections and either could be edited without the other."
      }
    },
    {
      "page": "privacy.html",
      "claim": "The legal basis we rely on.",
      "type": "descriptive",
      "why": "A lead-in, and a required disclosure: GDPR Art 13(1)(c) wants the purpose AND the basis. Descriptive because nothing in this tree can prove a legal basis is correctly chosen — that is a lawyer's judgement, and this register does not pretend otherwise (see its preamble)."
    },
    {
      "page": "privacy.html",
      "claim": "legitimate interest",
      "type": "descriptive",
      "why": "The basis itself, GDPR Art 6(1)(f), with the SPECIFIC interest named in the same paragraph as Art 13(1)(d) requires. [research/44] V4 records why this is the basis rather than consent: Recital 47 treats direct marketing as capable of being a legitimate interest, and adding a consent gate would be legally unnecessary friction that wrongly implies the processing becomes unlawful when refused. ⚠️ THE ROW IS `descriptive` AND THAT IS NOT A DODGE — the balancing test is the substance and no guard can perform it. What IS mechanical is the objection control, and it is asserted two rows below."
    },
    {
      "page": "privacy.html",
      "claim": "What we use to decide what to show you.",
      "type": "descriptive",
      "why": "A lead-in to the targeting-inputs disclosure. The substantive claim under it — entitlement state only, decided on the device — is carried by the `on your device` row."
    },
    {
      "page": "privacy.html",
      "claim": "on your device",
      "type": "code",
      "assert": {
        "kind": "absent",
        "files": ["<PromoGate source path, filled in when rung 2 lands>"],
        "pattern": "(?i)(http|fetch|Dio|Client\\(|analytics|record\\()",
        "why": "🔴 FILL THIS IN AT SIGNATURE, DO NOT SHIP THE PLACEHOLDER. 'the decision is made on your device' is the one sentence in §3 that a file can refute: [research/44] §4.3 specifies PromoGate as a PURE function over persisted counters — no UI, no config read, no I/O — so the decision must reach no network and emit no event. Point this at the real PromoGate file when rung 2 lands and negative-test it by adding a network call. ⚠️ A `code` row whose `files` do not exist FAILS rather than being skipped (assert-policy-claims.mjs §2), so this placeholder CANNOT ship green — which is the intended behaviour and is why it is written this way rather than as a `descriptive` row that would ship quietly."
      }
    },
    {
      "page": "privacy.html",
      "claim": "Your right to object, and how to use it.",
      "type": "descriptive",
      "why": "GDPR Art 21(4): the objection right must be 'explicitly brought to the attention of the data subject and presented clearly and separately from any other information', at the latest at the time of the first communication. This lead-in plus the in-card control required by [research/44] §7 rung 4 are the two halves of that; a Settings-only control would satisfy neither the 'separately' limb nor 'at the time of the first communication'."
    },
    {
      "page": "privacy.html",
      "claim": "Offers and promotions",
      "type": "code",
      "assert": {
        "kind": "present",
        "files": ["apps/subly/lib/features/settings/settings_screen.dart"],
        "pattern": "<the promo-consent call rung 4 introduces, e.g. recordPromoConsent\\(>",
        "why": "🔴 FILL THIS IN AT SIGNATURE, DO NOT SHIP THE PLACEHOLDER. The page names a control and tells the reader where it is; this row is what makes that a promise rather than an intention. It is modelled exactly on the existing 'Usage statistics can be withdrawn without contacting us.' row, which asserts `recordAnalyticsConsent\\(` in the same screen file — delete the row from Settings and the claim goes red. THE LABEL STRING ITSELF IS ALSO THE l10n KEY the brick's no-hardcoded-strings guard owns; the page and the app must use one name for one thing."
      }
    },
    {
      "page": "privacy.html",
      "claim": "Nikatru apps only",
      "type": "descriptive",
      "why": "The scope limit, and the sentence a store reviewer reads to decide whether the surface is an ad network. Descriptive today because v1 is SAME-APP ONLY ([ADR 040] decision 2) and there is no second app to promote — so nothing in the tree can yet be pointed at that would refute it. 🔴 IT BECOMES ASSERTABLE THE DAY A CROSS-APP SURFACE SHIPS ([research/44] §7 rung 6): the payload's app ids must all resolve to rows in sites/_shared/_data/apps.json, and that is the row to re-point this at rather than a new one."
    },
```

## 5. What this draft deliberately does NOT do

- **It does not name RevenueCat, Supabase or Oracle Cloud**, and it does not name Paddle in §3. Those are
  four separate outstanding privacy.html corrections carried as `disclosureGaps` in
  `tooling/legal/provider-register.json`. They are listed in §6 because they should ride the same signature
  — but merging them into this section would mix two reviews into one block of prose.
- **It does not add a consent gate.** [research/44] V4: *"Do NOT add a consent gate for first-party in-app
  promotion. It is legally unnecessary friction and wrongly implies the processing becomes unlawful when
  refused. Do add the toggle."*
- **It does not mention email.** [ADR 040] decision 5 keeps marketing email deferred; V7 records that
  cross-app promotional email cannot ride the EU/UK soft opt-in. A privacy notice that describes a channel
  we do not operate is a claim we would have to keep true for nothing.
- **It does not describe measurement.** [ADR 040] decision 4 ships v1 unmeasured. If that reverses, §3 gains
  a sentence and this register gains a row, in the same commit as the taxonomy change.
- **It does not translate.** K-14 (`notice-per-supported-locale`) is owner-gated on O-4 and an unreviewed
  machine translation of a statutory notice is itself an exposure. DPDP s.5 wants the notice available in an
  Eighth Schedule language on request; that is the same open item, not a new one.

## 6. Signature checklist — one commit, in this order

1. **Confirm the precondition in §1.** Rungs 2–4 are on `main` and the Settings control exists. If not,
   stop: the section makes a claim about a control that is not there.
2. Fill in the two placeholder patterns in §4b (`on your device`, `Offers and promotions`) against the real
   files rungs 2–4 landed. **Negative-test both** — mutate the real tree, watch the guard go red, restore.
3. Apply §2 (new section + renumbering) and §3 (the reworded advertising sentence) to
   `sites/nikatru/privacy.html`.
4. **Ride the other four privacy.html corrections in the same edit** — one signature, one snapshot, rather
   than five:
   - `crash-reports-infrastructure` — split the sentence so crash reports name their own host (Oracle
     Cloud), which the §3 block above deliberately leaves untouched;
   - `merchant-of-record-unnamed` — name **Paddle** in §3's third-party list, matching terms.html and
     refund.html, which already name it;
   - `iap-aggregator-unnamed` — name the IAP aggregator (**RevenueCat**, [ADR 039] D5) as a processor, never
     as a seller;
   - `identity-provider-unnamed` — name the identity provider (**Supabase**) or record that accounts are not
     offered.
   Each has a `stillTrue` probe, so `assert-policy-claims.mjs` **fails** until its gap row is retired in this
   same commit. That is the mechanism, not an inconvenience.
5. Apply §4a and §4b to `tooling/legal/policy-claims.json`, and retire the four gap rows in
   `tooling/legal/provider-register.json` that step 4 closed.
6. Pick the new version string `<YYYY-MM-DD>` and set it in **three** places:
   - `sites/nikatru/privacy.html` — `data-policy-version="<v>"` **and** the visible "Last updated" line;
   - `apps/subly/lib/state/analytics_providers.dart` — `kPrivacyPolicyVersion`;
   - `tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart` — `kPrivacyPolicyVersion`.
7. Add the archive snapshot `sites/nikatru/legal/<v>/en/privacy.html` — a copy of the new live page with the
   three differences `sites/nikatru/legal/README.md` specifies: `robots` → `noindex,follow`,
   `<link rel="canonical">` removed, same-site `.html` links rewritten root-relative.
8. Regenerate discovery: `node tooling/sites/generate-discovery.mjs`. The sitemap's `<lastmod>` is a
   function of git state, and `check-site-integrity.mjs` also asserts the policy version is not ahead of its
   sitemap `lastmod`.
9. Record the **material-change decision** under the [research/43] doctrine, and record it either way. The
   reading this draft was written to: adding a NEW purpose with its own objection control does **not**
   materially change the analytics purpose a user already consented to, so it is a notification and not a
   re-consent — *"re-consent only when purposes/processing materially change beyond what was consented; a
   version bump otherwise requires notification, not re-collection."* The owner decides; the point is that
   the decision is written down rather than implied by the absence of a re-prompt.
10. Update the `first-party-promotion-legal-basis` row in `tooling/legal/duty-matrix.json` from
    `owner-gated` to `implemented`, naming `sites/nikatru/privacy.html` as its artefact — the guard requires
    an `implemented` row to name an artefact that exists.
11. Run the full gate. The four legal guards specifically:
    `assert-policy-claims.mjs`, `assert-policy-archive.mjs`, `assert-sink-disclosure.mjs`,
    `assert-legal-tripwires.mjs`, plus `check-site-integrity.mjs` and `assert-seams-wired.mjs`.

## 7. Sources, so every sentence above can be re-checked

Primary text, quoted in `Private/knowledge/research/44-CROSS-PROMOTION-HOUSE-ADS-OFFERS.md` §3 with its citations:

- **GDPR Recital 47** — *"The processing of personal data for direct marketing purposes may be regarded as
  carried out for a legitimate interest"*, qualified by reasonable expectation and *"a relevant and
  appropriate relationship between the data subject and the controller."*
- **GDPR Art 21(2)/(3)** — the objection right for direct marketing is absolute: *"the data subject shall
  have the right to object at any time"* and *"the personal data shall no longer be processed for such
  purposes."*
- **GDPR Art 21(4)** — the right must be *"explicitly brought to the attention of the data subject and…
  presented clearly and separately from any other information"*, at the latest at the first communication.
- **GDPR Art 21(5)** — permits automated objection signals, which is why GPC precedence in
  `packages/core/lib/src/analytics/consent.dart` is the pattern rung 4 extends.
- **Google Play ads declaration** — support.google.com/googleplay/android-developer/answer/9859455: house
  ads are a YES trigger, decided by format; *"if you misrepresent the presence of ads in your app(s), it's
  considered a violation of the Google Play policies and may result in your app(s) being suspended."*
- **Apple 5.1.2(iv)** — *"don't collect information about which other apps are installed on a user's device
  for the purposes of analytics or advertising/marketing"*, which is why §3 says we never do.

⚠️ These are quoted from the research document, which recorded them against those sources. Nobody here is a
lawyer, and this draft asserts the same limitation `tooling/legal/README.md` does: it records what can be
observed and where an external rule was read from. Re-read the primary text at signature time — that is
cheap, and a stale quotation in a published notice is not.
