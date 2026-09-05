# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

**<https://github.com/globalonlinedeveloper/Nikatru_Extensions_Public/security/advisories/new>**

The report is visible only to you and the maintainer, it lets you attach a proof of concept without
publishing it, and it is the same link the issue chooser offers. Please do not open a public issue
for a security problem — an issue is a disclosure, and it is public from the second it is filed.

**No security email address is published, deliberately.** Publishing an alias nobody monitors is
worse than publishing none: reports vanish into an inbox that does not exist and the reporter
reasonably concludes they were ignored. If the advisory form above is unavailable to you, open an
issue that contains *only* the sentence "I have a security report and need a private channel" — no
details, no reproduction — and a channel will be arranged in the reply.

Include as much of this as you have:

- Which extension, and its version (`chrome://extensions` shows it, or the manifest inside the package).
- Browser and operating system.
- What an attacker gains, concretely. "A malicious page can read the contents of a capture the user
  took on a different site" is actionable; "XSS in the options page" needs a paragraph more.
- The smallest reproduction you can manage — a fixture page, a sequence of clicks, a diff.

Please do **not** include real personal data, real credentials, or a copy of anything sensitive you
captured while testing. A redacted screenshot or a synthetic fixture makes the report easier to act
on, not harder.

No PGP key is published. If a report genuinely needs to be encrypted, say so in the advisory with no
details in it and a channel will be arranged.

## What to expect

This catalogue is maintained by one person, so the honest version:

- **Acknowledgement within 72 hours.** Three days, not three working days — but a report that lands
  on a Friday may well be acknowledged before it is understood. If you have heard nothing in that
  window, assume it went astray and send it again.
- An assessment, and a plain answer about whether it will be fixed and roughly when. A "this is real
  but it is going to take a while" is a possible answer, and you will get the reasoning.
- Credit in the changelog entry for the fix, if you want it. Say so in your report; anonymous is fine
  too.
- A request that you hold public disclosure until the fix has shipped **and** the stores have
  published it. Store review is not instant and it is not under our control, which is the part of the
  timeline that usually needs the patience.

**There is no bug bounty.** No payment, no swag, no rewards programme, and none is planned. If a paid
programme is what you are looking for, this is not one — reports are still very welcome, and they
will be treated seriously, but nobody should spend time here expecting to be paid for it.

## Scope

**In scope:** the extensions in this repository, the packages built from them, and anything in the
build or packaging tooling that could put unintended code or data into a shipped package.

**Also worth reporting**, even though it is not strictly a vulnerability: any way to make one of these
extensions contact the network, execute code that was not in its package, or write data outside the
browser storage it declares. Those are product promises before they are security properties, and
breaking one is a report we want.

**Out of scope:** the Chrome Web Store, Microsoft Edge Add-ons, and addons.mozilla.org themselves —
report those to the vendor. Bugs in the browser rather than the extension go to the browser vendor.
Social engineering, physical access, and reports produced by a scanner with no demonstrated impact
are also out of scope.

## What these extensions actually hold

Useful for judging severity, and true of every extension here:

- **No servers, no accounts, no analytics.** There is no backend to breach and no collected dataset
  to leak: the shipped packages contain no network API at all, gated at build time by a scan of the
  packaged files. See [`PRINCIPLES.md`](PRINCIPLES.md) (P1, P2) — including its note that the scan is
  static, that no runtime network audit exists yet, and which API names the CI-level scan does not
  yet cover.
- **Data stays in the browser.** What an extension keeps, it keeps in that browser's own storage on
  that machine, and uninstalling removes it. The user's exposure is the machine they are sitting at.
- **Legal notices** — privacy policy, terms — are published on nikatru.com and linked from each store
  listing.

That shifts the threat model. The interesting attacks here are not "steal the database"; they are a
hostile page reaching data an extension holds, an extension leaking one site's content to another, a
package containing something it should not, or a supply-chain path into what gets published.

## What cannot be undone

Stated up front so nobody has to discover it mid-incident: **a published add-on identity is
permanent.** Firefox fixes an add-on's identity at first signing, and it cannot be reassigned — so a
compromise of the publishing identity is not something re-registering repairs. The same is true of
any identifier or artefact already delivered to users: the remedy for a flaw in something already
issued applies to future builds, never retroactively. That does not make such a report less
important. It makes it more urgent, because the window in which it is cheap to fix is before the
first release, not after.

## If you think a published package is malicious

Report it here first if you can — but you are also entitled to report it directly to whichever store
you installed it from, and doing that will not offend anyone. A user who suspects an extension should
never feel their only route is through its author.
