# Principles

Eight rules. Every extension in this repository obeys all eight, or it does not ship.

They are numbered so that a failing gate can name one. When a build check refuses, it should say
which principle it is defending — `P1`, `P3` — rather than only what it found, because the finding
tells you what broke and the principle tells you why it is not negotiable away.

**Status column, read it before you trust it.** A principle is not a gate. Some of these are
mechanically enforced today by scripts in this tree; some are still rules a human has to keep. Both
are listed honestly below, because a rule that claims machine enforcement it does not have is worse
than one that admits it is on the honour system: the first one gets trusted.

There are two enforcement tiers and they are not interchangeable. **Repo-level:** `scripts/*.mjs`,
run by `ci.yml` for every tool that has a `tool.json`, reading `tool.json`. **Per-tool:** the graders
inside a tool's own `publish/`, inherited from `templates/tool/`, which read the finished zip. FullShot
predates the skeleton and carries its own equivalents under different names; where that matters it is
said out loud rather than smoothed over.

| | Principle | Enforcement today |
|---|---|---|
| **P1** | Nothing leaves your machine | Gate (repo-level + per-tool, static). Runtime audit: **absent** |
| **P2** | No remote code | Gate (repo-level + per-tool, static) |
| **P3** | The fewest permissions the job allows, each justified in writing | Gate (repo-level, against `tool.json`). Listing-copy half: skeleton-derived tools only |
| **P4** | Processing happens on the device | Follows from P1; no separate gate |
| **P5** | No build step — the bytes ship readable | Rule + packaging allowlist |
| **P6** | The package is the artifact, and the package is what gets graded | Gate (per tool) |
| **P7** | Every listing is its own product | Partial gate; the cross-listing half is a rule |
| **P8** | Identifiers are permanent — set them once, before the first submission | Gate (fails closed, in the submission grader) |

---

## P1 — Nothing leaves your machine

No analytics. No accounts. No servers. No error reporting, no crash pings, no "anonymous usage
statistics", no ads, no remote fonts, no CDN, no update check of our own. A shipped extension makes
zero network calls, and the number of hosts it may contact is zero rather than small.

**Why it is not negotiable.** It is the only claim in the listing that a stranger can verify for
themselves, and it is verifiable only while it is absolute. "We only send anonymous counters" cannot
be checked by a reviewer without trusting us; "the package contains no network API at all" can be
checked by anyone with an unzip tool in about a minute. The moment there is one permitted host, the
promise becomes a policy document, and the audit becomes an argument.

**How it fails.** A convenience: a font from a CDN, a telemetry SDK added "temporarily to see if
anyone uses this", an image loaded from a URL, a version check.

**Enforced by, statically, in two places that do not share code.** Repo-level,
`scripts/policy-check.mjs` scans the packaged file set — the paths `tool.json` selects, plus every
`_locales` catalogue — for `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` and
`importScripts()` of an `http(s)` URL, and fails unless every hit is covered by
`tool.json.policy.networkAllowlist` (empty, so any hit fails). Per-tool,
`templates/tool/publish/verify-package.node.js` and `Extension/Full_Screen_Shot/publish/package.node.js`
run the same class of scan over a wider list — the six above plus `RTCPeerConnection` and
`SharedWorker` — and the skeleton's grader reads the bytes back out of the finished archive rather
than trusting the list the builder meant to write. Both strip comments and string literals first: a
scan that reads the banner promising there is no `fetch` as a `fetch` teaches people to disable it.

**That difference is a hole, and it is stated rather than papered over.** The repo-level gate — the
one CI runs on every tool — does not look for `RTCPeerConnection` or `SharedWorker`. A tool whose
only network reach was a WebRTC data channel would pass CI and be caught only by its own package
grader. Widen `scripts/policy-check.mjs` to the same list; until then, do not describe the CI gate as
complete.

**Not yet enforced at runtime — say so out loud.** The intended second half is a real-browser pass
that intercepts every request the extension's contexts make and asserts the only schemes seen are
`chrome-extension:`, `data:` and `blob:`. **No such check exists in this repository today.** Do not be
misled by the filename: FullShot's `test/e2e/privacy-verify.mjs` is a redaction-claim verifier — it
grades what the delivered image and the delivered envelope assert about covered text — and it
intercepts no requests. A static scan proves no network *API* is present in the shipped bytes, which
is strong, but it is a claim about source text and not an observation of behaviour. Until the runtime
audit is written, treat P1 as "gated at the package, unverified at run time" — and do not let a
listing say otherwise.

---

## P2 — No remote code

Nothing is fetched and executed. No `eval`, no `new Function`, no string-bodied `setTimeout`, no
`<script src="https://…">` or protocol-relative `//` reference in packaged HTML, no `@import url(http…)`.
Everything that runs is in the package a reviewer downloaded.

**Why it is not negotiable.** It is also store law — Manifest V3 forbids remotely hosted code. Do not
overstate what the store publishes about the consequence, though: Chrome's ladder is a warning with 7
to 30 days to fix, then a takedown that *"in most situations"* is not permanent and is cured by
submitting a corrected new version rather than by appealing. Only the malware tier skips the warning
and cannot be re-enabled — and which tier a remotely-hosted-code finding lands in is not something
the store-policy verification establishes, so do not assert one. Beyond the rule: an extension that
can fetch code can become a different extension after review, on someone else's schedule. That is the
exact shape of the compromised-extension stories that make people distrust the whole category, and
the only defence that survives an acquisition offer or a stolen publisher account is not having the
capability in the first place.

**Enforced by.** `scripts/policy-check.mjs` fails on `eval(`, `new Function(`, string-form
`setTimeout`/`setInterval`, and any packaged-HTML subresource with an `http:`, `https:` or
protocol-relative URL; the per-tool graders catch `importScripts()` of a URL in the same pass as P1.
Behind all of it sits the packaging allowlist in `templates/tool/publish/pack.mjs` (FullShot: the `ALLOW`
table in `publish/package.node.js`), which decides what may enter the zip rather than what must be
kept out of it.

---

## P3 — The fewest permissions the job allows, each justified in writing

Every permission a tool's `manifest.json` declares has a written justification, in prose, in that
tool's `tool.json` under `policy.permissions` — and the same text, in the same voice, in the listing
copy the store dashboard receives. Broad host access is requested at run time from the user, or not at
all: no static `host_permissions`. A permission that is declared but unused is removed, not explained.

**Why it is not negotiable.** The permission list is the install prompt, and the install prompt is
the product's first sentence. It is also the review surface: a capture tool asking for `<all_urls>`
up front and a credential stealer asking for `<all_urls>` up front look identical to a reviewer, and
the reviewer's job is to assume the worse of the two. Optional-at-runtime access converts an
irreversible install decision into a reversible one the user makes for a reason they can see.

**Enforced by, repo-level.** `scripts/policy-check.mjs` fails when a manifest permission has no
non-placeholder justification in `tool.json.policy.permissions`, warns on a justification for a
permission the manifest never asks for, and fails on any static `host_permissions` that lacks an
explicit `broadHostJustification`. `optional_host_permissions` is fine and is warned about only when
unexplained. A tool scaffolded by `scripts/new-tool.mjs` starts with those justification strings
**empty**, so it is red from the moment it exists; that is the design, because a justification a
script could have written explains nothing.

**The listing-copy half is gated only in skeleton-derived tools, and FullShot is not one.**
`templates/tool/publish/verify-package.node.js` additionally requires a `### Permission: \`<name>\`` section
in `publish/STORE-LISTING.md` for every declared permission. FullShot predates that script, keeps its
justifications under `## Permission justifications (one per dashboard field)` in a different shape,
and owns no script that compares that text to its manifest — so for FullShot the listing text and the
`tool.json` text are kept in step by hand. The host-permission half holds everywhere: FullShot
declares `optional_host_permissions` and no static `host_permissions`, and `policy-check` passes it.

The justification is graded for existence, not for quality — writing a bad one is still your job to
avoid.

---

## P4 — Processing happens on the device

Detection, redaction, extraction, encoding, whatever the tool does to the user's page: it runs in the
browser, on the user's machine, on data that never travels. There is no "send it to our API for the
hard part".

**Why it is not negotiable.** The material these tools touch is whatever the user happened to have on
screen — an invoice, a medical portal, a private repository, a chat. A tool that ships that
off-device has not made a trade-off, it has changed category. It would also make P1 impossible, and
P1 is the one users can check.

**Enforced by.** Nothing separately, and it does not need to be: with P1 gated, there is nowhere else
for the processing to happen. This is stated as its own principle because it is a *product* promise
that must survive a future feature request ("could it call a model to name the file?"), not because
it needs its own scanner.

---

## P5 — No build step — the bytes ship readable

Clone the repository, load the extension folder unpacked, and it runs. No bundler, no transpiler, no
minifier, no runtime npm dependency inside a package. Development-only tools (a browser driver for
the end-to-end tier, an icon generator) live outside the shipped file set and never enter the zip.

**Why it is not negotiable.** Extension source ships inside every installed copy, so the code is
readable whether or not we intend it to be. Given that, minified output buys nothing and costs the
one thing this catalogue trades on — that a suspicious user can read what they installed. It also
keeps the audit honest: the file a reviewer greps is the file that runs, with no build step in
between where a claim could stop being true.

**Enforced by.** The packaging allowlist — `ALLOW` in `templates/tool/publish/pack.mjs`, and the `ALLOW`
table in `Extension/Full_Screen_Shot/publish/package.node.js`. It is positive and pinned per
directory: `icons/` admits `.png` and nothing else, `pages/` admits `.html`, `.js`, `.css`. An npm
package, a generator script or a stray `.md` therefore has no path into a zip, because packages are
built from an allowlist of source paths rather than from a directory sweep. The absence of a build
step is a rule; the absence of `node_modules` in the artifact is a gate.

---

## P6 — The package is the artifact, and the package is what gets graded

Every gate that can run against the zip runs against the zip. Not the working folder, not a copy of
the source, not a mock. Reference integrity (every path the manifest and the HTML name resolves,
case-exactly), leak checks (no `test/`, no `node_modules`, no `.md`, no credentials), version
agreement between manifest, changelog and package, and a file-count diff against the previous
release.

**Why it is not negotiable.** A file that loads fine unpacked and 404s inside the archive is
invisible to every other check: the node simulations read the tree, the developer loaded the tree,
the browser test loaded the tree. This is not hypothetical — a build in this repository's history
omitted `background.js` from the allowlist and would have shipped an extension that could not start.
Case-mismatch is the same class: Windows and macOS resolve `icons/Icon128.PNG` against
`icons/icon128.png` and load happily, and a Linux reviewer's machine does not.

**Enforced by.** `templates/tool/publish/verify-package.node.js`, which reads entries back out of the
finished archive and reports `CASE MISMATCH` separately from `MISSING`, because those two answers
send you to different places. FullShot predates those script names and carries its own equivalents:
`publish/package.node.js` and `publish/verify-firefox-package.node.js`.

**The flag is `--verify`.** `package.node.js` decides with `process.argv.includes('--verify')` and
nothing else, so *any other spelling — `--check`, `--dry-run`, `-v` — silently means build*, and
rewrites both zips instead of grading the ones you meant to inspect. An unknown flag here is not a
usage error; it is a different command that looks like it worked.

---

## P7 — Every listing is its own product

No listing ships a title, short description, description body, screenshot set or store copy inherited
unchanged from the skeleton or duplicated from a sibling. Each one is written for the tool it
describes.

**Why it is not negotiable.** For an extension the clause that governs is Edge developer policy
§1.1.5 — *"There should be distinct and informative details about your extension and its
functionality in the listing (metadata)"* — not Microsoft Store policy 10.1.4, which governs apps,
games, add-ons and in-product content in the Microsoft Store and not the Edge Add-ons website. 10.1.4
is still worth knowing, because it states its distinct-metadata requirement without 10.1.1's "unless
also published by you" carve-out; but whether certification applies it independently of 10.1.1 is
stated on no Microsoft page, so it is a reason to write each listing properly, not a rejection anyone
can predict. Because every tool here is stamped from one skeleton, identical metadata is this
repository's *default output*, not an accident that might happen. The stakes are higher than one
rejection: the Chrome Web Store documents a cap of 20 published extensions — themes exempt — on a
page whose footer reads 2014, and whether that cap counts per publisher or per account is not
answered on any Chrome page read; increases are discretionary, and a request *may* be denied where
the account has prior suspensions, prior takedowns, or items that consistently receive low quality
ratings. Enforcement attaches to the developer account rather than the item: Google's repeat-abuse
policy suspends the developer account "and possibly related developer accounts", and in extreme cases
related Google services associated with that Google account. One lazy listing is charged to every
other listing that shares the account.

**Enforced by.** Half of it. `templates/tool/publish/preflight.mjs` fails a tool that still carries
skeleton-inherited strings (any surviving `PLACEHOLDER(…)` tag in a file that ships), placeholder
identity fields, the demo feature or the skeleton's `0.0.1` version — that catches *inheritance*.
**Nothing here compares one live listing against another**, so the sibling-duplication half is a rule
a human keeps, and it is the weakest link on this page. Do not read the green preflight as proof of
P7 — and note that FullShot has no `preflight.mjs` at all, so for the one tool that exists today even
the inheritance half is unautomated.

---

## P8 — Identifiers are permanent — set them once, before the first submission

Identifiers are write-once. A tool's id, the Firefox `browser_specific_settings.gecko.id`, a version
number a store has accepted: none of these can be recalled or corrected afterwards. Anything else
this catalogue ever issues to a user falls under the same rule by default, and the burden is on
whoever claims an exception to prove it.

**Why it is not negotiable.** AMO fixes an add-on's identity at first signing. An id set by accident
is not a typo you fix later: AMO embeds it in the signed package and checks it for uniqueness at
first signing, so it is spent either way. What Mozilla does *not* publish is the consequence of
changing it — whether a new id ships a different add-on rather than an update follows from permanence
plus uniqueness but is stated on no page read. Plan for the worst reading, a second add-on and an
installed base that never gets the update, and do not write it down as a rule. A version number, once
a store has accepted it, can never be reused. A tool id is embedded in package filenames, tags and
store paperwork the moment it is used once — directories can be renamed, ids cannot.

**Enforced by, and know which script actually refuses.** In a skeleton-derived tool the packager
itself fails closed: `templates/tool/publish/pack.mjs` will not write the Firefox package while the add-on
id is a placeholder or disagrees with `publish/identity.json`, and the id is derived from a single
field (`slug` + `ownerDomain`) so it cannot be typed twice and differ.

**FullShot's own packager is softer, and the difference is the point.**
`Extension/Full_Screen_Shot/publish/package.node.js:735` prints `BLOCK  gecko.id is still the
placeholder` and a named owner action, then **exits 0** — by design, so a packaging defect and an
owner decision are not the same red. The gate that refuses is `publish/verify-firefox-package.node.js`,
which treats a placeholder id as a hard failure (`gate('gecko.id is NOT the placeholder', …)`), and
`scripts/pack.mjs` refuses to write the Firefox package on the same condition. That split still
stands, re-read in all three files on 2026-08-25.

⚠️ **CORRECTED 2026-08-25 — FullShot's id is set, and it is `fullshot@nikatru.com`.** This paragraph
used to end: *"FullShot's packaged Firefox manifest carries `fullshot@REPLACE-WITH-YOUR-DOMAIN.example`
right now, so that submission gate is red on purpose, and it stays red until the owner picks a domain."*
That is false, and the placeholder string is left above only so the correction is legible next to it.
Measured, bare, exit code on its own line:

- `publish/manifest.firefox.json` → `browser_specific_settings.gecko.id` is **`fullshot@nikatru.com`**,
  set on 2026-08-18 in commit `088b4e3` and derived from `publish/identity.json`.
- `node scripts/pack.mjs fullshot --target firefox --out <scratch> --release` → **0**, printing
  `firefox manifest — publish/manifest.firefox.json applied as a merge patch — gecko.id
  fullshot@nikatru.com`.
- `node Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js` → **0** bare
  (`SOURCE PASSES — NO PACKAGE WAS GRADED.`), and **0** again with `--zip` against a freshly built
  package (`ALL PASS`). The AMO submission gate is **not red**, and has not been since 2026-08-18.
- `node scripts/policy-check.mjs fullshot` → **0**, `the Firefox add-on id is set — fullshot@nikatru.com
  -- and agrees with publish/identity.json`.

**The principle is unchanged, and filling the id is what made it binding rather than what retired it.**
AMO fixes the add-on identity at first signing; `fullshot@nikatru.com` is now the value that cannot be
walked back, on a domain the owner actually controls. Nobody else could have picked it, and no gate
could have picked it for them — which is exactly why the packager printed a BLOCK and exited 0 instead
of failing, and why the submission gate refused. Both behaved correctly; the difference between them is
still the thing to copy into the next tool.

---

## How these are cited

A gate that refuses should name the principle it is defending, in the failure text, next to the
finding:

```
FAIL  no packaged script can reach the network        [P1]
      pages/history.js: fetch( ×1
```

The finding is what you fix. The identifier is what stops the fix from being "delete the check".

## Changing a principle

These are not style preferences and they are not settled in a pull request comment. A change to any
of the eight — including narrowing one, or adding an exception "just for this tool" — is a decision
that gets recorded as a decision, with the reasoning and what it costs, before any code moves. If a
principle is genuinely wrong, that record is how it gets to be wrong on purpose instead of by
erosion.

Adding a ninth is cheaper than weakening one of the eight.
