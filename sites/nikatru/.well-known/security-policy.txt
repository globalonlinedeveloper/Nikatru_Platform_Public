# Security policy

This repository is public. Its code builds the apps NIKATRU publishes, the browser
extensions under `extensions/`, and the Cloudflare Workers under `services/` that
those apps talk to. If you have found a way to reach data you should not reach, we
want to hear about it before anybody else does.

## Reporting a vulnerability

**Email `support@nikatru.com`.** That is the same address published on
<https://nikatru.com/contact.html> and compiled into every app we ship as
`AppConfig.supportEmail`, so there is exactly one address to get wrong, and
`tooling/ci/assert-repo-posture.mjs` fails the build if these three ever
disagree.

Please include:

- what you can reach that you should not be able to reach,
- the smallest sequence of steps that reproduces it,
- the commit SHA, deployed URL or app version you tested against,
- for a browser extension: which extension and its version (`chrome://extensions`
  shows it, or the manifest inside the package), plus your browser and OS.

Concrete beats general. "A malicious page can read the contents of a capture the
user took on a different site" is actionable; "XSS in the options page" needs a
paragraph more.

**Please do not include real personal data, real credentials, or a copy of
anything sensitive you captured while testing.** A redacted screenshot or a
synthetic fixture makes a report easier to act on, not harder.

**Please do not open a public GitHub issue for a security report.** An issue is
readable by everyone the moment it is filed, including before we have read it.

No PGP key is published. If a report genuinely needs to be encrypted, say so with
no details in the first message and a channel will be arranged.

## What happens next

NIKATRU is a sole proprietorship — one person reads this mailbox. So, honestly:

- **Acknowledgement within 72 hours.** Three days, not three working days — but a
  report that lands on a Friday may well be acknowledged before it is understood.
  If you have heard nothing in that window, assume it went astray and send it
  again.
- An assessment, and a plain answer about whether it will be fixed and roughly
  when. "This is real but it is going to take a while" is a possible answer, and
  you will get the reasoning.
- We will tell you what we found, what we changed, and when the change shipped.
  We will credit you if you want to be credited and stay quiet if you do not.
- **A request that you hold public disclosure until the fix has shipped *and* the
  stores have published it.** Store review is not instant and it is not under our
  control, which is the part of the timeline that usually needs the patience.

We do **not** run a paid bug bounty, and we will not pretend otherwise: there is
no payout waiting at the end of a report. No payment, no swag, no rewards
programme, and none is planned. Reports are still very welcome and will be taken
seriously — nobody should spend time here expecting to be paid for it.

## Scope

In scope:

- this repository's source, including the Cloudflare Workers in `services/` and
  the Cloudflare Pages Functions under `sites/*/functions/`,
- the sites deployed from `sites/` (`nikatru.com`, `rajasekarselvam.com`),
- the published apps built from `apps/`,
- the browser extensions in `extensions/`, the packages built from them, and
  anything in the build or packaging tooling that could put unintended code or
  data into a shipped package.

**Also worth reporting**, even though it is not strictly a vulnerability: any way
to make one of the extensions contact the network, execute code that was not in
its package, or write data outside the browser storage it declares. Those are
product promises before they are security properties, and breaking one is a
report we want.

Out of scope, because they are not ours to fix and reporting them here only
delays the person who can:

- vulnerabilities in third-party services we consume (report those to the
  vendor),
- the Chrome Web Store, Microsoft Edge Add-ons and addons.mozilla.org themselves,
  and bugs in a browser rather than in our extension — those go to that vendor,
- findings that require a compromised device or a physically present attacker,
- social engineering,
- volumetric denial of service,
- scanner output with no demonstrated impact.

## What the extensions actually hold

Useful for judging severity, and true of every extension here:

- **No servers, no accounts, no analytics.** There is no backend to breach and no
  collected dataset to leak: the shipped packages contain no network API at all,
  gated at build time by a scan of the packaged files. See
  [`extensions/PRINCIPLES.md`](extensions/PRINCIPLES.md) (P1, P2) — including its
  note that the scan is static, that no runtime network audit exists yet, and
  which API names the CI-level scan does not yet cover.
- **Data stays in the browser.** What an extension keeps, it keeps in that
  browser's own storage on that machine, and uninstalling removes it. The user's
  exposure is the machine they are sitting at.

That shifts the threat model. The interesting attacks there are not "steal the
database"; they are a hostile page reaching data an extension holds, an extension
leaking one site's content to another, a package containing something it should
not, or a supply-chain path into what gets published.

## What cannot be undone

Stated up front so nobody has to discover it mid-incident: **a published add-on
identity is permanent.** Firefox fixes an add-on's identity at first signing and
it cannot be reassigned, so a compromise of the publishing identity is not
something re-registering repairs. The same is true of any identifier or artefact
already delivered to users: the remedy for a flaw in something already issued
applies to future builds, never retroactively. That does not make such a report
less important. It makes it more urgent, because the window in which it is cheap
to fix is before the first release, not after.

## If you think a published package is malicious

Report it here first if you can — but you are also entitled to report it directly
to whichever store you installed it from, and doing that will not offend anyone.
A user who suspects an app or an extension should never feel their only route is
through its author.

## Secrets

No credential belongs in this repository. `tooling/ci/scan-secrets.mjs` runs on
every push and self-tests before it scans. If you find a live credential in the
history, that is a security report — send it to the address above rather than
demonstrating it.

---

<!--
⏱ 2026-09-08 — THIS FILE ABSORBED A SECOND, CONTRADICTORY SECURITY POLICY.

Until today the repository carried TWO security policies stating OPPOSITE
reporting rules, and only this one was reachable: GitHub surfaces the root
SECURITY.md and nothing else. The other arrived in the 2026-09-05 extensions
subtree merge and is recoverable at
`ref/pre-prune-2026-09-08:extensions/SECURITY.md`.

WHERE THEY DISAGREED, precisely:
  · CHANNEL — this file publishes `support@nikatru.com`; that one directed
    reporters to GitHub private vulnerability reporting and said, in as many
    words, "No security email address is published, deliberately."
  · That sentence is the one thing NOT carried forward. This file's address is
    bound by `tooling/ci/assert-repo-posture.mjs` to the published contact page
    and to `AppConfig.supportEmail`, so it is the address every app already sends
    people to, and it is the one the world can reach.
  · The advisory-form URL is deliberately NOT imported either, and the reason is
    already written down in `.github/ISSUE_TEMPLATE/config.yml`: that form only
    exists once private vulnerability reporting is switched on, and a link that
    404s is how a reporter files the public issue we are asking them not to file.

WHAT WAS MERGED IN rather than lost — every commitment the other file made that
this one did not:
  · the 72-HOUR ACKNOWLEDGEMENT WINDOW (this file previously promised only "a
    human reply", with no timeline at all)
  · the COORDINATED-DISCLOSURE ASK — hold public disclosure until the fix has
    shipped AND the stores have published it
  · SCOPE: the extensions, the packages built from them, and the build/packaging
    tooling. This file's scope list did not mention `extensions/` at all, three
    days after that tree became part of this repository
  · the "also worth reporting" clause — network contact, out-of-package code
    execution, writing outside declared storage — product promises stated as
    reportable
  · OUT OF SCOPE: the stores and the browsers themselves, social engineering,
    scanner output with no demonstrated impact
  · the request NOT to send real personal data or credentials in a report
  · the "no PGP key, ask and a channel will be arranged" line
  · the extensions threat model (no servers/accounts/analytics; data stays in the
    browser) and the PRINCIPLES.md pointer, repointed to `extensions/`
  · the permanence of a published add-on identity
  · a reporter's right to go straight to the store

Nothing was dropped except the contradiction itself.
-->
