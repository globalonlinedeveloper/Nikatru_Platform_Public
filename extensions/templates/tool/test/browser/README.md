# Real-browser smoke test

`smoke.mjs` loads this extension unpacked into a real Chromium and asks the browser
itself whether the thing works. It is the only tier in this family that runs in a
browser; every other tier is a simulation of one.

It is **generic**. Copy it into a new tool unchanged — it reads that tool's
`manifest.json` to find the popup, the options page and the icons. There is
nothing to edit, ever.

## Run it

```sh
node test/browser/smoke.mjs        # headless, ~10 seconds
HEADFUL=1 node test/browser/smoke.mjs   # same run, in a window you can watch
```

Exit code is 0 only when every check passes, so it drops straight into a
pre-publish script. Output matches the node sims: one `PASS`/`FAIL`/`SKIP` line per
check, then `ALL PASS` or `FAILURES: n`.

The harness loads the extension folder **as it is on disk** — the shipped
manifest, no test-only edits — so what Chrome accepts here is what Chrome accepts
from a user. It writes nothing into the extension: the browser profile and log go
to a temp directory that is deleted at the end. (Chrome ignores `test/` when
loading unpacked; keep it out of the published zip anyway.)

Environment:

| variable | what it does |
| --- | --- |
| `HEADFUL=1` | show the browser instead of running headless |
| `SMOKE_EXT_DIR=<dir>` | test a different copy of the extension (this is how you prove a check bites — see below) |
| `SMOKE_PLAYWRIGHT=<dir>` | a `playwright` package directory, or a `node_modules` containing one, if the search below fails |

### One Playwright for the whole fleet

No `npm install` per tool, no `node_modules` in this folder, no `package.json` —
a no-build-step family should not carry 67 copies of a dependency tree. There is
**one** install, in **one** place:

```
Tools/_playwright/node_modules/playwright
```

Set it up once, ever:

```sh
mkdir Tools/_playwright && cd Tools/_playwright
npm init -y && npm i -D playwright && npx playwright install chromium
```

The harness looks, in order, at:

1. `SMOKE_PLAYWRIGHT` — an explicit override
2. **`<ancestor>/_playwright/`** — the fleet location, found by walking up from
   `test/browser/` and matching the directory *by name*, so it works wherever in
   the tree your tool sits
3. normal node resolution
4. a fallback walk over ancestor directories and their tool folders

**Step 4 is a fallback, not the answer.** Before the fleet location existed it
*was* the answer, and what it actually resolved to was one particular tool's
`test/e2e/node_modules` — so renaming that tool (its store name is under review
for a collision) or deleting it would stop 67 browser tiers on the same
afternoon, and upgrading it would silently change what graded every release.
When the harness lands there it prints a warning saying so.

Every run prints the **path and the version** it settled on:

```
playwright  C:\...\_playwright\node_modules\playwright\index.mjs  v1.61.1
```

Record that line with a release. When a check starts failing and nothing in the
extension changed, the browser build is the first thing you want to know.

If nothing is found it prints every place it looked and exits 1. It never
installs anything.

## What it checks

| # | Check | Why a browser is required |
| --- | --- | --- |
| 1 | Chrome loads the extension from this folder, logs no load error, and enables it | **The big one.** A manifest that names a file that isn't there, or a version string like `01.02`, makes Chrome reject the *entire extension*. Node cannot see this. Chrome's own reason is read out of its log and printed. |
| 2 | The service worker registers and reaches `activated` | A top-level throw in `background.js` leaves it `redundant`, never `activated` |
| 3 | The popup renders non-empty visible text | Proves the HTML, CSS and scripts actually painted something — chars, visible element count and height are all reported |
| 4 | Zero console errors, zero uncaught exceptions, zero unhandled rejections | Across the worker and every extension page, for the whole run |
| 5 | **Zero network requests left the browser** | The family's central privacy claim, proven instead of asserted. Every request is inspected; anything not `chrome-extension:`/`data:`/`blob:`/`about:`/`chrome:` fails the run and is printed with its origin |
| 6 | The options page renders | As (3) |
| 7 | Every declared icon exists, decodes as a real image, and is the size its manifest key claims | A corrupt or wrong-size PNG passes `fs.existsSync` and fails in the browser |

Extras that come free from being in a browser: the name and version Chrome parsed
match the file on disk; every declared permission was actually *recognised* by
Chrome (a typo like `"tabss"` is silently dropped, and `chrome://extensions-internals`
is the only place that shows it); and the packaged manifest is really served from
the extension origin.

### Check 5 is armed on every run

"We saw no network traffic" is worthless if the listener was never attached. So
before judging, the harness fires one `fetch()` from an extension page and one
from the service worker at a **closed loopback port** (`127.0.0.1:49222`), and
fails if it does not observe both. Nothing leaves the machine — the connection is
refused instantly — and the two sentinels are excluded from the verdict by URL, so
they can neither hide a real leak nor create a fake one.

## What it does NOT prove

Be honest about this. A green run means *Chrome accepts and runs this extension*.
It does not mean the tool works.

- **It does not test the tool on a real website.** No content script is injected
  into a real page, no capture/parse/transform is exercised. That is what the node
  sims and a page-driving e2e harness are for (see the reference implementation's
  `test/e2e/run.mjs`, which drives the worker against torture pages and grades
  pixels).
- **It opens the popup as a normal tab**, not as a real action popup. Popup
  sizing, the 25-second popup lifetime, and anything that depends on being
  invoked by a user gesture are not covered.
- **`activeTab` is not granted** — there is no user click. A tool whose real work
  needs `activeTab` will show its "cannot read this page" path here, and that is
  correct: the check is that it renders and does not throw, not that it succeeds.
  (The reference e2e harness solves this by loading a *copy* whose manifest holds
  statically what `activeTab` grants at click time. Do that in the page-driving
  tier, not here — this tier must test the manifest you actually ship.)
- **Install *warnings* are invisible.** An unrecognised manifest key produces a
  yellow warning in `chrome://extensions`, not a load error, and Chrome does not
  log it. Bad *permissions* are caught (check above); bad *keys* are not.
- **Only this Chromium, this platform.** One browser build, one OS, one fresh
  profile with no other extensions, no enterprise policy, no proxy.
- **Nothing about how it looks.** Text is non-empty and elements have boxes. That
  is not the same as legible, aligned, or right. **Look at it yourself** —
  `HEADFUL=1` exists for that, and it is not optional before publishing.

## Proving a check bites

House doctrine: a test that does not bite is not a test. `SMOKE_EXT_DIR` makes
this a two-minute job that never touches your source — copy the extension to a
temp folder, break one thing, and watch the predicted check go red:

```sh
cp -r . /tmp/broken && rm /tmp/broken/icons/icon128.png
SMOKE_EXT_DIR=/tmp/broken node test/browser/smoke.mjs   # expect exit 1
```

This harness was built that way. Fourteen bugs were injected into copies of the
skeleton, one at a time; every one produced a red line and exit 1:

| injected bug | the check that bit |
| --- | --- |
| `manifest.json` is not JSON | `manifest.json parses` (run stops there) |
| `background.js` deleted | *Chrome refused it — Could not load background script ''* |
| `"notAPermission"` added to `permissions` | `every declared permission was recognised by Chrome — DROPPED: notAPermission` |
| `icons/icon128.png` deleted | disk check, **and** *Chrome refused it — Could not load icon 'icons/icon128.png' specified in 'icons'* |
| `icon48.png` replaced with junk bytes | `icon48.png FAILED TO DECODE` |
| `icon32.png` replaced with the 16px file | `icons/icon32.png is 16x16, declared 32` |
| `throw` at the top of `background.js` | `the service worker reached "activated" — state=redundant` |
| `console.error` in the worker | `zero console errors from the worker and the pages` |
| `fetch()` in the worker | `ZERO network requests left the browser — https://telemetry.example/… <- service worker` |
| `fetch()` in the popup | same, `<- chrome-extension://…/popup/popup.html`, plus the console error |
| popup body emptied | `0 chars, 0 visible elements, 0px tall` |
| undefined call in `popup.js` | `zero uncaught exceptions in the pages` |
| `version` set to `01.02` | *Chrome refused it — Required value 'version' is missing or invalid* |
| `pages/options.html` deleted | *Chrome refused it — Could not load options page* |

Four of those fourteen make Chrome reject the whole extension. That class of bug
is invisible to every other tier, and it is exactly why this harness exists.

## Troubleshooting

**`CANNOT RUN — Playwright not found`** — set `SMOKE_PLAYWRIGHT` to a directory
containing `node_modules/playwright`, or install Playwright somewhere on the
search path.

**`Executable doesn't exist … npx playwright install chromium`** — the package is
there but the browser binary is not. Install it once, per machine:
`npx playwright install chromium`. `channel: 'chromium'` in the harness is
load-bearing: Playwright's default headless build is the *headless shell*, which
cannot load extensions at all.

**Every check after the first fails** — read the `Chrome refused it — …` line.
That is Chrome's own sentence about your manifest, and it names the offending
file or field.

**It passes but the tool is broken** — expected. Re-read "What it does NOT prove",
then go build the page-driving tier.
