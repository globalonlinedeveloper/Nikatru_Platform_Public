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
>
> **2026-08-26 — "all seventeen shapes" in the paragraph above is wrong, and the
> sentence stays only as the record of what was believed.** `reduction-corpus.mjs`
> grades **13** of these 17, and three of the rest — `clipped-ancestor`,
> `input-values`, `svg-text` — are graded by nothing else in this directory at all.
> Retiring this file orphans them. The full measurement is under
> [the reduction corpus](#the-reduction-corpus-npm-run-testcorpus), below.

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
   `#001` does, and silently inflates the black-rows count. `fixtures-adv/cv-tabs.html`
   breaks this rule too — its tab-button labels antialias through the block colour and
   leave **10 rows** behind. That residue is *measured*, not assumed:
   `adversarial-claim.mjs` carries the no-extension recipe and both its numbers
   (`cv-tabs` 10 rows, `details-closed` 0 rows, the control), so the claim that those
   rows are the fixture's fault and not the product's can be re-run instead of trusted.

## The give-up suite (`npm run test:giveup`) — WIRED as of 2026-08-26

`giveup-verify.mjs` grades one rule of `REDACTION-CLAIM-SPEC.md` §2.1.1: **anywhere the
pipeline gives up on something, that fact is recorded, carried, and reaches the surface.**
Incompleteness is data, not an absence — the failure it hunts is a person believing more
was covered than was.

```bash
npm run test:giveup
PORT=8331 npm run test:giveup    # its port is overridable; see "Ports, and the
                                 # orphan that holds one" below
```

**It was quarantined and it no longer is, and this paragraph is why.** Its entry in
`.github/workflows/e2e.yml` recorded *2026-08-25, exit 1, 107 pass 5 fail* — `iframe-door`
reporting one readable-but-unentered frame while `matchedComplete` stayed true, and
`defercap` printing a `(PARTIAL count)` payload under a whole-count sentence. Re-measured
**three times** on `6ee4c73`, alone, with nothing else driving a browser:

```
exit 0 · 112 pass / 0 fail / 3 note   (×3, 113s on the timed run)
```

Both shapes that reddened it now pass by name. It came off the array and it is **wired**.

**The dated entry itself was not paraphrased into the comment block — it was moved into it
verbatim, and the correction appended beneath.** That distinction is the whole discipline
and it is worth stating plainly: a summary of a measurement is not the measurement. It
drops the evidence the finding rested on (the address, the phone and the card still legible
in the delivered PNG) and it leaves a later reader nothing to check the correction
*against*. The `redaction-claim.mjs` and `adversarial-claim.mjs` entries in the same array
do exactly this in place — original text untouched, `APPENDED 2026-08-26` beneath — and
this entry now matches them. Confirm it with `git show 6ee4c73:.github/workflows/e2e.yml`:
the passage is byte-identical.

The record has to be kept somewhere a reader reaches, because the workflow's stale-entry
check fails the job when a note outlives its **file**, and **nothing at all catches a note
that outlives its measurement**. So a green re-measurement that is only *implied* — by the
entry vanishing — is indistinguishable from quietly dropping a skip. That asymmetry is
named in the workflow comment and is deliberately **not** closed there; closing it needs a
new guard clause and a decision about what makes a measurement stale.

**The three that remain are `NOTE`, and `NOTE` is not graded.** Two are verdict-shaped
*strings* that survive `FS_ENVELOPE_VERDICT` — which closes the acts block by allowlist and
booleans by shape, but grades no string in a scope §5 leaves open. **The two are not the
same case, and the suite's own labels are what say so:**

| patch | where the string lands | the label the suite prints |
|---|---|---|
| `kindsWord` | `redaction.kinds.assessment="clean"` — **inside** the redaction block | *"a summary string in kinds, which is not an allowlisted scope"* |
| `topWord` | `notes[0]="This image is safe to share."` — **outside** the redaction block | *"a summary string at the top level of the envelope"* |

Only `notes[0]` is genuinely outside the redaction block. `redaction.kinds.assessment` is
**inside** it, in `kinds`; what it sits outside of is the **allowlisted scope**, which is a
different fence and the one the suite's label actually names. An earlier version of this
paragraph put both strings outside the redaction block, which reads as a wider hole in
`FS_ENVELOPE_VERDICT` than the one that exists.

> The note's own trailing clause — *"a STRING outside the redaction block is not graded by
> it"* — is loose in the same direction for the `kindsWord` case. The **label** above it is
> the precise statement, and it is the label this paragraph now follows.
> `giveup-verify.mjs` is not this branch's file to edit; the discrepancy is recorded rather
> than silently harmonised.

The third is a `canvas-pii` reference line. They print with their evidence; none is a red.
That is the same three-verdict discipline the corpus suites use, and a `NOTE` silently
counted as a pass would be the disease this whole directory exists to catch.

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

### 2026-08-26 — re-measured. The paragraph above stands; one clause in it is wrong

The sentences above stay as written. This block is the correction, dated, beneath them.

**Confirmed unchanged: the eight `fixtures-adv/` shapes still have no grader.** Re-derived
by parsing the fixture registration of every `.mjs` in this directory — the union of the
`fixture('name', …)` and `{ name: 'name', … }` idioms, plus literal filenames, rather than
a grep, which counts prose. `fixtures-adv/` holds thirteen `.html` shapes. Five of them
reach a wired suite. **These eight reach none, and nothing in this directory grades them:**

| shape | in `adversarial-claim.mjs`? | graded by a wired suite? |
|---|---|---|
| `canvas-combo` | yes | **no — nothing grades it** |
| `cv-tabs` | yes | **no — nothing grades it** |
| `frame-pii` | **no** | **no — and it never has had one** |
| `honest-article` | yes | **no — nothing grades it** |
| `honest-pii` | yes | **no — nothing grades it** |
| `late-frame` | yes | **no — nothing grades it** |
| `late-swap` | yes | **no — nothing grades it** |
| `shadow-closed-frame` | yes | **no — nothing grades it** |

Wiring `giveup-verify.mjs` on the same day did **not** shrink this list: that suite reads
`fixtures-giveup/` and `fixtures/`, and touches no `fixtures-adv/` shape. Eight before,
eight after. Nothing here was closed by assertion, and nothing should be — a hole that is
written down is one somebody can still fix; a hole closed by retiring the entry that names
it is one nobody can see.

**🔴 Wrong clause: "`redaction-claim.mjs` runs `fixtures/`, which this suite runs whole, so
retiring it costs nothing."** It does not run it whole, and retiring it does not cost
nothing. Measured the same way:

- `redaction-claim.mjs` registers **17** `fixtures/` shapes.
- `reduction-corpus.mjs` reaches **13** of those 17.
- The four it misses are `before-content`, `clipped-ancestor`, `input-values`, `svg-text`.
- `before-content` is covered by `batch-artifact.mjs`, which is wired.
- **`clipped-ancestor`, `input-values` and `svg-text` appear in no other suite in this
  directory, wired or quarantined.** Retiring `redaction-claim.mjs` orphans those three
  outright.

So the cost of retiring it is three page shapes, not zero. It is recorded here, in
`redaction-claim.mjs`'s own header, and in its quarantine entry in `.github/workflows/e2e.yml`,
because this measurement has now been derived three times from scratch.

> ⚠️ Commit `5121633`'s message lists `reduction-corpus.mjs` as covering `clipped-ancestor`.
> It does not — the name occurs in no `.mjs` in this directory except `redaction-claim.mjs`.
> Trust the parse over the prose.

**Also off by the same kind of counting:** "`claim-reduction.mjs` … runs eight of the same
shapes" (above). Its corpus is eight shapes, but three of them (`object-door`,
`split-token`, `mixed-owntext`) come from `fixtures-adv/`. It overlaps `fixtures/` by
**five** of the seventeen, not eight.

### Both quarantined claim suites cite a spec that was rewritten under them

`REDACTION-CLAIM-SPEC.md` was reduced **in place**, so the § numbers in the two quarantined
suites do not resolve. Counted against the current headings:

| suite | distinct § cited | no longer a heading | E-refs cited | E-refs in spec today |
|---|---|---|---|---|
| `redaction-claim.mjs` | 35 | **27** | E1–E16 (13 distinct) | **none — no E list exists** |
| `adversarial-claim.mjs` | 24 | **17** | E8, E12, E13, E16 | **none — no E list exists** |

The handful that still resolve (`§2.1 §2.2 §2.3 §3 §3.2 §3.3 §3.4 §3.5`) are numbers
**reused for different content**, not sections that stayed put. `§3.3` is the clearest
case, and it matters:

**One failure is red because the product is now RIGHT.** `adversarial-claim.mjs` `U9` reads:

```js
/* §3.9.1 — counts and areas, NEVER geometry */
check('U9 no rectangle geometry travels on the record (§3.9.1)',
  !/"piiBoxes"|"boxesXY"|"rects"/.test(flat) &&
  !/\{"x":\s*-?\d+,\s*"y":/.test(flat), flat.length + ' bytes of ledger');
```

There is no §3.9.1 in the spec any more. What replaced it is §3.3, *The marks*:

> **Only verified-opaque blocks are marked, and only verified-opaque blocks are persisted.**
> This is the one place geometry is allowed to travel … The old absolute — *the rectangles
> never travel* — held because the stored set included both kinds.

So the spec now **requires** the geometry U9 forbids, and on `honest-pii` the record duly
carries it:

```
acts  matched 3 · painted 3 · verifiedOpaque 3 · matchedComplete true
marks [{x:24,y:165,w:189,h:23},{x:132,y:253,w:145,h:23},{x:175,y:392,w:171,h:23}]
```

U9 fails on `honest-pii` **and on no other fixture of the eleven** — the other ten produce
no verified-opaque block, so no marks are persisted and U9 passes. A check that is red on
exactly the one shape where the product does the newly-required thing is grading a retired
rule. **Do not delete the suite to make that red go away**; the red is information.

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

## Ports, and the orphan that holds one

Every suite serves the extension root over plain HTTP on a **fixed** localhost port and
loads its fixtures from it. The numbers are spread so the set can be run back to back on
one machine — with one deliberate collision, recorded below.

| suite | port | `PORT=` override |
|---|---|---|
| `run.mjs` | 8907 | no |
| `redaction-claim.mjs` | 8911 | no |
| `claim-reduction.mjs` | 8913 | **no** |
| `adversarial-claim.mjs` | 8913 | **yes** |
| `review-keyboard.mjs` | 8915 | no |
| `reduction-corpus.mjs` | 8917 | no |
| `batch-artifact.mjs` | 8921 | no |
| `privacy-verify.mjs` | 8127 | no |
| `giveup-verify.mjs` | 8131 | **yes** |
| `v3acts-probe.mjs` | 8145 | **yes** |

`claim-reduction.mjs` and `adversarial-claim.mjs` share **8913**, so those two can never be
in flight at the same moment. That collision is one of the reasons `.github/workflows/e2e.yml`
runs this directory in **one step, sequentially**, rather than as a matrix leg per suite.

**But the collision is not the failure you will actually hit — an orphan of the suite's own
previous run is.** A run killed mid-flight (Ctrl-C at the wrong moment, a timed-out CI step,
an editor restart while Playwright still has a browser up) leaves the static server
listening. The next attempt then dies on `EADDRINUSE` against *itself*, and while the port
was a bare literal the only way out was to find and kill the process.

> ⚠️ **This is not hypothetical.** The first attempt at re-measuring `giveup-verify.mjs` for
> the 2026-08-26 numbers above was blocked by exactly this, which is why two more suites can
> now read `PORT` and why this section exists.

Cheapest escape, on a suite that reads `PORT` — any free port will do, nothing else in the
tree cares which one it is:

```bash
PORT=8331 npm run test:giveup
PORT=8332 node adversarial-claim.mjs
PORT=8333 node v3acts-probe.mjs
```

Find and kill the orphan when the suite has **no** override — or when you simply want the
default port back:

```bash
# Windows (Git Bash / PowerShell) — last column of the LISTENING row is the PID
netstat -ano | grep 8913
taskkill //PID <pid> //F

# macOS / Linux
lsof -i :8913            # or: ss -lptn 'sport = :8913'
kill <pid>
```

**Why the defaults are not simply randomised.** A fixed port is greppable, it is written in
each suite's own header beside its neighbours, and a collision is then a fact you can read
instead of a flake you cannot reproduce. The override exists so a *stuck* port costs one
environment variable rather than an investigation — not so the port stops being a known
number. A suite that still hard-codes its port is a suite that has not needed the escape
yet; add the `Number(process.env.PORT || <default>)` line when it does, and leave the
default where it is.

## No-browser simulators (run anywhere, no setup)

```bash
node test/sim-torture.node.js    # engine logic vs fake DOM, 3 modes
node test/pixel-sim/run.js       # real capture.js + real result.js stitching
                                 # → actual PNGs in test/pixel-sim/out/
```
