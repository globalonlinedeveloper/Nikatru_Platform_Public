# FullShot e2e — real Chromium + the real extension

Runs the actual extension in Playwright Chromium, captures the two torture
pages, saves the stitched PNGs to `test/e2e/out/`, and grades ~14 assertions
(page self-checks + pixel-marker checks on the finished images).

## Setup (once)

```bash
cd test/e2e
npm install
npx playwright install chromium
```

## Run

```bash
npm test          # headless
HEADFUL=1 npm test   # watch the browser do it (PowerShell: $env:HEADFUL=1; npm test)
```

Exit code 0 = all pass. Inspect the stitched images in `test/e2e/out/`.

## What it covers

- `appshell.html` — app-shell page where the DOCUMENT doesn't scroll and all
  content lives in an internal pane (the Gmail/ChatGPT layout). Verifies the
  pane is fully unrolled, shell chrome appears exactly once, sticky toolbar is
  neutralized (once, no blank band), FAB once, sidebar pinned, scrolls restored.
- `torture.html` — shadow-DOM sticky rail (Reddit pattern), 25k-element walk
  budget, sticky-bottom bar with visibility override, inner panel + iframes,
  deep + bottom markers, restore integrity.

## The redact block captures the page TWICE — on purpose

`redact-e2e.html` is captured once with `redactPII` **off** (`out/redact-baseline.png`)
and once with it on (`out/redact.png`), and every assertion grades the *difference*.
Do not "optimise away" the baseline capture: it is the whole instrument.

Until v1.10.1 this block counted row colours — "the red row's colour is gone from
>=120 of its 140 rows". That measures WHOLE-ROW occlusion, which is what v1.7.0 did.
v1.9.6 made the bake token-precise: it paints the matched substring's rect, so a 140px
row keeps its background everywhere outside a ~24px block. Four assertions therefore
sat red against working code, and the two that still passed were worse than useless —
"decoy left un-redacted (>=60 yellow rows)" reads 140 whether or not the decoy is
redacted, so it could not fail.

Diffing against the baseline removes almost all of the calibration: what redaction did
*is* the set of pixels it changed. The two captures are byte-identical outside the
blocks (verified across independent runs), so the block geometry, its placement, the
fact that it covered rendered glyphs, and the fact that the decoy row is untouched are
all read straight off the diff. The few bounds that remain are quoted in fixture units
(140px row, 21px line box) next to where they are used, never as observed pixel counts.

Each check was verified to bite by re-injecting a defect into the real product source
and re-running: the redaction pass yielding zero boxes, the bake never painting, a
v1.7.0-style whole-row bake, and a defeated Luhn check that redacts the decoy.

Note: `npm test` uses a throwaway browser profile; the extension's defaults
(expand inner content = ON) are seeded on install.

The runner loads a temporary COPY of the extension whose manifest holds
`tabs` + `<all_urls>` statically. The shipped extension uses `activeTab`,
which is granted by your click/shortcut gesture — a test driver has no
gesture, so without this the browser reports every page as protected. The
engine code under test is byte-identical to the shipped one; only the
manifest differs. (This also enables the cross-origin iframe expansion path,
so the test covers it.)

## The redaction-claim suite (`npm run test:claim`) — QUARANTINED, RED

> **This suite does not run in CI and does not pass locally.** Measured
> 2026-08-25 and re-measured 2026-08-26 on the same tree, alone: **exit 1,
> 151 pass / 199 fail / 30 open**, unmoved between the two runs. It grades the
> eight-state ladder — `redaction.state`, `redaction.pixels`, `redaction.severity`
> and the `scan` / `bake` ledgers — every one of which `REDACTION-CLAIM-SPEC.md`
> §2.2 deletes. The § numbers each check cites (§2.6, §3.7, §5.4, §6.1, §7.1,
> E8, E13) are sections of the **pre-reduction** `REDACTION-CLAIM-SPEC.md`,
> rewritten in place; none of them exists in the file today, so the suite has
> nothing left to be graded against.
> **It cannot be repaired into green, only replaced, and the replacement already
> exists**: `reduction-corpus.mjs` grades the identical `fixtures/` directory —
> all seventeen shapes — against the current spec, is wired, and is green.
> Its quarantine entry in `.github/workflows/e2e.yml` carries the measurement.
> `npm run test:claim` still works and is left deliberately: read it as a
> historical record, not as a gate.

A second, independent real-browser suite written **from `REDACTION-CLAIM-SPEC.md`**,
not from the implementation. Seventeen adversarial page shapes plus a locale pass,
each captured with `redactPII` on, graded against the spec's own states, sentences
and invariants.

```bash
npm run test:claim                       # the whole corpus
HEADFUL=1 npm run test:claim             # watch it
ONLY=control-pii,sr-only npm run test:claim
```

Fixtures live in `fixtures/` and are served over HTTP from the extension root, so
`plaintext-long.txt` arrives with a real `text/plain` content-type and Chromium
builds the synthetic `<pre>` — a tree no hand-written fixture can contain.

Three verdicts, on purpose:

- **PASS / FAIL** — the spec says what must happen. Graded.
- **OPEN** — the spec is silent or ambiguous for this shape. Printed with its
  evidence, never graded. A check that quietly downgrades itself to "skipped"
  is the same disease as a claim that quietly downgrades itself to "baked".

`U1`–`U16` run on every fixture (closed state set, the §3.7 mapping table, the
two entrances to `baked`, `Σ unplaced + placed === fed`, `painted + unplaced +
outOfRange === handed`, the permanent line, the retired phrasings, the toast
column, no geometry on the record). The rest are per-shape and cite their
section. `E11`, the state census, prints at the end.

Two things to know before editing a fixture:

1. **The bake paints the matched substring's rect, not the element's.** A marker
   colour must therefore ride on an inline span wrapping the PII token alone,
   with `line-height: 1`. Put it on the padded row and "colour gone" measures
   the padding, which is green for the wrong reason.
2. **No text colour may sit within tolerance of the block colour** `rgb(17,17,17)`.
   `#001` does, and silently inflates the black-rows count.

## The batch-artifact suite (`npm run test:batch`)

Answers one question that no simulator can: **does a batch job that says "done"
have a screenshot behind it?**

```bash
npm run test:batch
HEADFUL=1 npm run test:batch     # watch the queue open, capture and close tabs
```

It drives the real `runBatch` over two fixtures and then asks the database: one
`shots` row per job, real pixels in each, no frames or `captures` rows left
behind, no tab left open — and finally opens `result.html?shot=<id>`, which is
the exact link `pages/batch.js` renders, to see the screenshot appear.

**This suite exists because two of its findings are invisible to a fake DOM.**

1. `V2-FEATURE-COMPLETE-PLAN.md` P-5 attaches a *mandatory* on-device caveat to
   the fix: the result page is opened with `active: false`, and Chrome throttles
   background tabs while the stitcher does canvas work across awaits. Whether
   the row ever appears is a question about a real browser. (It does — a queue
   of two drains in about eleven seconds.)
2. `chrome.tabs.create` answers **before the navigation commits**, so the `Tab`
   it hands back carries `pendingUrl` and an **empty** `url`. `runBatch` reused
   that snapshot, and the first thing `startCapture` asks is whether the url is
   one the browser reserves — where an empty url counts as reserved. Every job
   in every queue was refused with *"This page is protected by the browser and
   cannot be captured."* before it took a frame. `test/background-sim.node.js`
   could not see it: its fake `tabs.create` answered with the url already in
   place. Both halves are fixed — the worker re-reads the tab after the load,
   and the fake now models what Chromium actually returns.

## The reduction corpus (`npm run test:corpus`)

`reduction-corpus.mjs` grades the design in `REDACTION-CLAIM-SPEC.md` — the one that
replaced the eight-state ladder — over **the whole corpus of shapes that defeated the
previous six fixes**, plus the two controls. Seventeen page shapes, ~1100 graded
assertions, written from the spec rather than from the implementation.

```bash
npm run test:corpus
HEADFUL=1 npm run test:corpus
ONLY=control-pii,sr-only npm run test:corpus
SKIPOLD=1 npm run test:corpus          # skip the §4 old-record populations
```

It supersedes the **assertions** of `redaction-claim.mjs` and `adversarial-claim.mjs`
(both grade fields §2.2 deletes) and overlaps `claim-reduction.mjs`, which runs eight of
the same shapes. Both are kept: the fixtures are the accumulated record of what beat six
fixes, and two independent readings of the same corpus is the point rather than
duplication.

**It does not supersede their SHAPES, and this is a live hole — do not read the two
quarantine entries as saying otherwise.** `redaction-claim.mjs` runs `fixtures/`, which
this suite runs whole, so retiring it costs nothing. `adversarial-claim.mjs` runs
`fixtures-adv/`, a *different* corpus built by combining features rather than exercising
them one at a time — thirteen shapes in the directory, eleven of which that suite runs —
and only **five** of the thirteen reach a wired suite: `details-closed`, `object-door`,
`split-token`, `wrapped-token` and `mixed-owntext` here (three of those five again in
`claim-reduction.mjs`). **`canvas-combo`, `cv-tabs`, `frame-pii`, `honest-article`,
`honest-pii`, `late-frame`, `late-swap` and `shadow-closed-frame` are graded by no wired
suite today** — and `frame-pii` is not even in `adversarial-claim.mjs`'s own list, so it
has never had one. Closing that needs a suite written from the current spec over
`fixtures-adv/`; it does not need, and must not be answered by, un-quarantining a suite
that reads deleted fields.

**Why almost every check is an invariant.** Under the old design each of these shapes
could make the product say something false about the picture, so each needed its own
expectation. Under this one there is no verdict field left to be wrong: the record
states three integers and the person is shown the image. So the suite asks the same
questions of every shape — no verdict at any depth, the acts block holds no words, the
arithmetic is monotone, the payload states the record's own counts, the dialog fires for
the bundle and never for a PNG save — and a shape that produces something a reader would
take as a verdict is the design leaking. Only three fixtures carry a graded per-shape
expectation (the two controls and the ceiling); inventing one anywhere else would be the
deleted design creeping back in through the tests.

**Three things it deliberately does not read off the implementation.**

1. The dialog is found by `role="dialog"` + `aria-modal`, never by id — §8.2 asks for
   focus trapping and Esc, both of which presuppose one.
2. Copy and Save are found through their `data-i18n` keys, and every sentence is graded
   by asking the extension for its own `chrome.i18n` template and checking the product
   rendered *that one*, with the numbers the record holds. §6 says the English is
   owner-editable, so a suite that hard-codes English grades the wrong thing.
3. The mark-outline colour is read out of the live dialog's computed styles. A hard-coded
   colour retires itself silently the day someone changes the palette.

**`OPEN` is not `skip`.** Where the spec is silent or self-contradictory the suite prints
the question with its evidence and does not grade it. Four such questions are standing as
of this writing, including §5's gate refusing the `acts.ledger` value that §2.1 requires
in the same block.

## Can the review step actually be performed? (`npm run test:review`)

`review-keyboard.mjs` grades the two properties of `REDACTION-CLAIM-SPEC.md` §3.2
that **no static check can see**, with real key events on a real capture.

```bash
npm run test:review
HEADFUL=1 npm run test:review
```

1. **The focus trap is dynamic.** The dialog opens on its heading, which carries
   `tabindex="-1"` and is therefore not a member of the ring of focusable
   controls. A trap written as "if you are on the first, wrap to the last" says
   nothing about an element that is neither — so Shift+Tab from the very place
   the dialog put the keyboard walked out of the modal, reached the Delete
   button behind it in four presses, and Enter fired it. Every line of the trap
   read correctly; only pressing the key found it. The suite records the whole
   escape path in its failure message, and its `dialog` handler **dismisses**
   the delete confirmation rather than accepting it: a suite that destroys the
   record to demonstrate the bug has reproduced it rather than graded it.
2. **Whether a person can read the picture is a layout fact.** `budget.fit` is a
   downscale, so 1:1 with the exported pixels is 1:1 with an image whose glyphs
   are already under half their captured size. The suite asserts the preview
   comes out *larger* than the exported pixels, large enough to put the page
   back at its captured size, that the walk reaches the foot of the image, and —
   the check that encodes the design — that the walk **crosses ground with no
   mark on it**. A tour of the marks visits only what was already covered.

Both fixtures are ~3,200–3,700 px tall, past the point where a 1,280-wide
capture crosses the tiling floor and what leaves is a reduced overview.
`review-tall-clean.html` is the same page with nothing the detector can match:
no marks at all, which is the case the old dialog switched its own navigation
off in, and the case where every pixel has to be judged by eye.

## No-browser simulators (run anywhere, no setup)

```bash
node test/sim-torture.node.js    # engine logic vs fake DOM, 3 modes
node test/pixel-sim/run.js       # real capture.js + real result.js stitching
                                 # → actual PNGs in test/pixel-sim/out/
```
