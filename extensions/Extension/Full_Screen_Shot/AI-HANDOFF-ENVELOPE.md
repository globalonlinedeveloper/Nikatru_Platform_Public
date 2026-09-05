# The AI hand-off envelope — `ai-handoff/1.1`

**Status:** normative for FullShot 1.11+. Written to be implemented by sibling tools without
reading FullShot's source.
**Reference implementation:** `pages/common.js` (`fsAi*`), consumed by `pages/result.js`.
**Grading tier:** `test/aihandoff-sim.node.js`.

---

## 0. Why this document exists

The loop the whole tool family serves is:

> capture something → hand it to a language model → the model understands what it is looking at.

A screenshot alone loses that loop's most valuable half. The model gets pixels and has to guess the
URL, the date, the viewport, whether anything was cropped, what the red arrow points at, and whether
the black rectangle over the email address means the text beside it is also safe. Every one of those
answers already exists in the producing tool at the moment of capture, and every one of them is
thrown away by a `.png`.

The **envelope** is the agreed shape for keeping them. It is not a file format in the sense of a new
codec; it is JSON plus files, deliberately boring, deliberately readable by a person in a text editor
and by a model in a paste.

Sixty-seven tools implementing sixty-seven private shapes is the outcome this document exists to
prevent. The bar for adding a field is therefore: *would a model's answer change if this were
missing?* If not, leave it out.

---

## 1. What is skeleton and what is product

This split is load-bearing. A sibling tool copies section A wholesale and rewrites section B.

### A. SKELETON — identical in every tool

| Piece | Rule |
|---|---|
| The envelope JSON shape (§3) | Same keys, same types, same enums. New keys only per §2. |
| The `contents` manifest (§3.4) | One row per payload, whatever the payloads are. |
| **INV-R, the redaction coupling (§5)** | Non-negotiable. A producer that cannot satisfy it must not emit a text payload at all. |
| The role vocabulary (§3.4) | `image` · `text` · `legend` · `envelope`. Extend by adding, never by redefining. |
| Fit + tiling contracts (§6, §7) | `fitDims` / `planTiles` signatures and their invariants. |
| The budget block (§8) | Including: an estimate is always stamped with the rule that produced it and the date a human last checked that rule. |
| Clipboard shape (§9) | One `ClipboardItem`, `image/png` + `text/plain`. |
| Versioning (§2) | |

### B. PRODUCT-SPECIFIC — FullShot's answers, yours will differ

| Piece | FullShot's answer |
|---|---|
| `subject.kind` | `web-page` |
| What `subject` carries | URL, title, viewport, DPR, content size, capture mode |
| The detector behind the mask | FullShot's regex PII detector (`content/capture.js` `fsPiiMatches`), mirrored in `pages/common.js` `fsAiPiiSpans` |
| Where the payloads come from | Stitched canvas segments in IndexedDB |
| The annotation vocabulary (§10) | FullShot's editor object types |
| `notes` (§11) | FullShot's own capture gates |

A tool that captures a terminal session, a PDF page or an app window keeps section A byte-for-byte
and answers section B differently. `subject.kind` is what tells a consumer which section B it is
reading.

---

## 2. Versioning

```
"envelope": "ai-handoff/1.1"
```

One string. `MAJOR` before the dot, `MINOR` after.

- **MINOR** — additive only. New optional keys, new enum members, new `role` values. A `1.0` consumer
  must ignore keys it does not know and must not fail on an unknown enum member; it may report the
  member verbatim.
- **MAJOR** — anything a `1.x` consumer would misread: a key removed, a type changed, a unit changed,
  an existing enum member given a new meaning.

**Never silently repurpose a key.** Renaming `text` to `markdown` is a MAJOR change even though
nothing "broke"; a consumer that reads the old key reads nothing and reports success.

A consumer parses the major with a split on `/` and `.`, and refuses a major it does not know rather
than guessing.

---

## 3. The envelope

One JSON object. UTF-8. When written to disk it is `envelope.json` at the bundle root.

```jsonc
{
  "envelope": "ai-handoff/1.1",
  "id": "c7f0e1b2-3a44-4f10-9e2b-8d4f8c2a1e77",
  "createdAt": "2026-08-13T09:41:22.010Z",

  "producer": {
    "tool": "FullShot",
    "version": "1.10.1",
    "surface": "chrome-extension"
  },

  "subject": {
    "kind": "web-page",
    "mode": "full",
    "url": "https://acme.example/orders?session=[token]",
    "title": "Orders — Acme",
    "capturedAt": "2026-08-13T09:40:58.000Z",
    "viewport": { "w": 1280, "h": 730, "dpr": 1.25 },
    "content":  { "w": 1280, "h": 15000 },
    "image":    { "w": 1600, "h": 18750 }
  },

  "contents": [
    { "path": "image/page-1.png", "role": "image", "type": "image/png",
      "w": 107, "h": 1568, "scale": 0.0836,
      "index": 1, "count": 1, "fromY": 0, "toY": 18750, "overlapPx": 0 },
    { "path": "text/context.md",  "role": "text",   "type": "text/markdown", "chars": 812 },
    { "path": "legend/annotations.json", "role": "legend", "type": "application/json",
      "count": 3, "inline": true }
  ],

  "legend": [ /* §10 — inline, so a clipboard hand-off is self-contained */ ],

  "tiles": {
    "count": 12, "overlapPx": 64,
    "rows": [ { "index": 1, "count": 12, "fromY": 0, "toY": 1520,
                "overlapPx": 0, "cutOn": "break" } ]
  },

  "redaction": {
    "requested": true,
    "detector": "fullshot/pii-regex@1",
    "acts": { "v": 4, "matched": 3, "painted": 3, "verifiedOpaque": 3,
               "matchedComplete": true, "walkComplete": true, "truncatedBy": null,
               "textRefused": 0, "blocksLost": 0, "blocksUnpainted": 0, "blocksUnread": 0,
               "ledger": "present" },
    "text": "masked",
    "surfaces": ["image", "text", "legend", "envelope"],
    "kinds": { "email": 2, "token": 1 },
    "markers": ["[email]", "[phone]", "[card]", "[ssn]", "[token]"],
    "notCovered": ["names", "postal addresses", "free-form secrets",
                   "text drawn inside images, canvas or video"]
  },

  "budget": {
    "source":  { "w": 1280, "h": 18750 },
    "fit":     { "w": 107, "h": 1568, "scale": 0.0836,
                 "limitedBy": "edge", "needsTiling": true },
    "tokens":  { "estimate": 220, "rule": "area-750", "asOf": "2026-05", "exact": false },
    "profile": "generic"
  },

  "notes": [
    "Video, canvas and WebGL are captured as painted and cannot be read as text."
  ]
}
```

**`budget.fit` describes the image this bundle actually carries.** When the capture needs tiling,
that image is the **overview** (§7), not the floored full-size render — quoting a cost for an image
nobody is going to paste is worse than quoting none. `tiles.rows` then says what the legible
alternative would be.

**The envelope's own frame is ASCII.** Keys, punctuation, units and separators: `1280x18750`, not
`1280×18750`. A `×` is a bidi-weak run — it reverses inside a right-to-left paragraph — and the
Unicode isolate characters that fix that on a rendered page would be invisible junk inside a file a
model reads and a manifest a script greps. Removing the hazard beats annotating it. **Text that came
from the subject keeps whatever script it was written in**: a Japanese page title travels verbatim.
It is the *frame* that is ASCII, not the content.

### 3.1 `id`, `createdAt`

`id` is unique per **bundle**, not per capture — copying the same screenshot twice produces two
envelopes with two ids and one `subject.capturedAt`. `createdAt` is when the envelope was built.
Both are ISO-8601 UTC / an opaque string respectively; a consumer must not parse structure out of
`id`.

### 3.2 `producer`

`tool` and `version` are what a bug report needs. `surface` distinguishes the same tool's browser
extension from its CLI. Never a user agent string: it carries the device model and the OS build, and
this object is designed to be pasted to a stranger.

### 3.3 `subject`

What was captured, in its own coordinate system.

| Key | Meaning |
|---|---|
| `kind` | Which section B applies. `web-page` · `file` · `app-window` · `terminal` · `document` |
| `mode` | Producer-specific capture mode |
| `url` / `title` | May carry PII. Subject to §5 like any other text. |
| `viewport` | What the user could see at once, plus `dpr` |
| `content` | The full logical size of the thing captured (CSS px for a web page) |
| `image` | The device-pixel size of the produced image, before any model fit |

`viewport` vs `content` vs `image` are three different sizes and models reason with all three: a
1280×15000 `content` inside a 1280×730 `viewport` tells the model that what it is looking at is
twenty screens of scroll, which is why the type looks small and why a UI element it can see was
never on screen at the same time as another.

### 3.4 `contents` — the manifest

One row per payload, in the order a reader should take them.

| Key | Required | Meaning |
|---|---|---|
| `path` | yes | Bundle-relative POSIX path. For a clipboard hand-off, the notional path — the manifest still describes what was offered. |
| `role` | yes | `image` · `text` · `legend` · `envelope` |
| `type` | yes | MIME |
| `bytes` | when known | |
| `w`,`h` | images | Pixel size of *this* payload |
| `index`,`count` | images | 1-based. A single whole-capture image is `1 of 1`. |
| `fromY`,`toY` | images | In `subject.image` coordinates, so a model can place the piece on the page |
| `overlapPx` | images | Rows this piece repeats from the **previous** one; `0` for the first |
| `scale` | images | Multiplier from `subject.image` to this payload |
| `chars` | text | |
| `inline` | any | `true` when the payload is carried inside the envelope rather than as a file — how a clipboard hand-off stays self-contained |

The manifest is what makes the bundle self-describing. A consumer must be able to answer "what am I
holding, and is any of it missing?" from `contents` alone, without opening a payload.

**`role: "envelope"` is not a row.** It appears only in `redaction.surfaces`, and it means the
envelope JSON *itself* — which carries `subject.url`, `subject.title` and `notes`, all of them text
that can carry PII. Forgetting that the manifest is itself a payload is the most common way to leak
after doing everything else right.

---

## 4. The text payload

Markdown, not JSON, and addressed to a model rather than to a person.

```markdown
# Screenshot context

- Source: https://acme.example/orders?session=[token]
- Title: Orders — Acme
- Captured: 2026-08-13T09:40:58.000Z
- Mode: full page
- Viewport: 1280×730 at 1.25 dpr
- Page content: 1280×15000 CSS px
- Image: 1600×18750 device px
- Redaction: pixels baked, text masked (email ×2, token ×1)

## Annotations
1. [1] numbered step at 12%, 34% — near "Create invoice"
2. arrow from 40%, 20% to 44%, 26% — pointing at "Submit"

## Page text
…
```

Rules:

1. **The order is fixed:** context, then annotations, then page text. A consumer that truncates
   truncates the least valuable part.
2. **The context block is always present**, even when there is no page-text sidecar. It is the half
   that costs nothing and answers the most.
3. **The envelope's own language is fixed** — English keys, ISO dates, digits. It is addressed to a
   model, not rendered as UI, and it must read the same in every locale so that a consumer written
   in one country parses a bundle produced in another. Translating `Source:` would be the same class
   of mistake as translating a filename template. *UI chrome around the payload is localised as
   normal; the payload is not.*
4. **Nothing enters the text that the user did not see.** No `outerHTML`, no DOM dump, no request
   log. If a producer adds such a thing it is opt-in, capped, and masked like everything else.

---

## 5. INV-R — the redaction coupling

> **A text sidecar carrying the PII that the image blacks out is worse than no redaction at all,
> because the user believes they are protected.**

### The three answers

**BREAKING AT 1.1: `redaction.pixels`, `.state`, `.severity` and `.evidence` are REMOVED.**
See `REDACTION-CLAIM-SPEC.md` §2.2. §2's "ignore unknown keys" rule covers a key that appears; it
does not cover one that disappears, so a consumer keyed on `pixels === "baked"` now reads
`undefined` — which is the correct direction. **The envelope no longer says anything about whether
the image is clean.** It states what the producer DID, and the producer cannot see the image.

`redaction.requested` is `true` (the user asked for redaction), `false` (they did not) or
`null` (this record cannot say). `redaction.acts` carries the counts, and every value in it
is an integer, a boolean, `null`, or one of `"elements"` / `"time"` / `"ceiling"` —
**a word is where a verdict hides**. `redaction.text` is `"masked"` or `"none"`, and it is a
statement about the BUNDLE'S OWN TEXT PAYLOAD, never about the image.

**`acts.v` is 4 as of `ai-handoff/1.1`, and the five fields it added are all about what the
producer GAVE UP ON.** `matchedComplete` is the completeness of `matched` itself — `false` when a
budget, a cap or a per-item refusal stopped the scan short, `null` when the record cannot say — and
a consumer subtracting `matched` from anything is subtracting a number that may have stopped early
unless this is `true`. `textRefused` counts **leaves** whose text was never handed to the detector.
`blocksLost`, `blocksUnpainted` and `blocksUnread` count **blocks** — produced and never emitted,
emitted and never drawn, drawn and never re-read — and their names carry the unit because they must
never be subtracted from a match count. Unknown keys are still ignorable per §2; a consumer that
ignores these reads exactly what it read before, one degree less informed.

`matched`, `painted` and `verifiedOpaque` all count **matches**, so a consumer may subtract them
from one another and `matched − verifiedOpaque` is the number of matches not covered. They do not
count the solid blocks in the picture: one match needs one block per line it occupies, and a
token that wraps across a line has two. See `REDACTION-CLAIM-SPEC.md` §2.1 — a producer that fills
these fields with a block count reintroduces a defect in which one wrapped token cancelled an
entirely different uncovered match.

### The invariant

```
redaction.requested !== false            ⟹   redaction.text === "masked"
                                         ∧   every role in contents ∈ redaction.surfaces
                                         ∧   "envelope" ∈ redaction.surfaces
                                         ∧   redaction.acts is present
redaction.requested === false            ⟹   redaction.text === "none"
```

`null` masks: the producer cannot tell whether redaction ran, so it must over-mask rather than
under-mask, and over-masking is the safe direction. The only cost is that a date in a URL can come back
as `[phone]` — visible, harmless, and the opposite mistake is a leak.

The second line matters as much as the first. Masking unconditionally would look safer and is
worse: it corrupts every URL for the majority who never asked for redaction, and it decouples the
two halves so that the state of one stops telling you anything about the other.

A producer that cannot satisfy the invariant **must throw and emit nothing**. Emitting the image
alone is not an acceptable degradation either — the user asked for a hand-off and got a silent half.

### Grade the output, not the path

The reference implementation records every foreign string as it embeds it and, before returning,
re-runs the detector over what it is about to hand over. A missing call site cannot talk its way
past a re-read, and a caller that *claims* it masked earlier is trusted at the point of use and
verified at the gate — which is the only order that catches a lie.

Scan the recorded strings, **not** the serialized JSON: an ISO-8601 timestamp is phone-shaped, and
a gate that throws on every bundle is a gate somebody deletes.

### What this means in practice

- The **same detector** masks the text that boxed the pixels. Two detectors that "agree" are two
  detectors that will disagree after the next edit to one of them. If the pixel detector lives in a
  place the text path cannot reach (a content script, a different process), the two copies must be
  pinned to each other by a test that compares them, not by a comment.
- The mask is applied **as early as the raw string can be dropped** — ideally in the same process
  that read it, so the unmasked value never crosses a message boundary.
- The **URL and the title are text.** A session token in a query string is the single most common
  real leak in this class, and it is on screen in the address bar, not in the page, so a
  page-text-only masker misses it entirely.
- **Annotation text is text.** A user who typed a customer's email into a callout has typed PII into
  the legend.
- Masking replaces each span with a **kind marker** — `[email]`, `[phone]`, `[card]`, `[ssn]`,
  `[token]` — never with a fixed-width blob. The marker is what lets a model reason ("the form field
  contains an email address") without knowing the value, and it is what lets a search index find the
  record later without storing the secret.
- `notCovered` is **required** and must be honest. A regex detector does not find names, postal
  addresses or free-form secrets. Saying so in the payload is what stops a reader trusting it too
  far.

### The test that cannot pass on half

Write **one** check with all of these conjuncts, not five checks:

1. the raw secret string appears in **no** member of the bundle — envelope JSON, every text payload,
   the legend, and the manifest — searched as one serialized blob;
2. `redaction.requested === true` and `redaction.acts` is present;
3. `redaction.text === "masked"`;
4. `redaction.surfaces` covers every role present in `contents`, plus `envelope`;
5. the corresponding kind marker is present in the text.

Removing either half of the implementation fails at least one conjunct, and because it is one check
there is no way to land a change that turns four of them green and leaves the fifth red-but-known.

---

## 6. Fitting for a model consumer

```
fitDims(w, h, { maxEdge, maxArea, minScale }) -> { w, h, scale, limitedBy, needsTiling }
```

Rules:

1. **Two criteria, and the binding one wins.** Consumers publish long-edge limits; area alone lets
   a 1280×15000 strip through untouched — 19.2 MP is under every area threshold in use — and then
   something downstream squashes it without telling anyone. Each clamp is computed from the
   original size, so the result is `min(maxEdge/edge, sqrt(maxArea/area))` whichever order they are
   written in; the *order* is not load-bearing and an implementation should not claim it is. What
   matters is that the edge criterion exists at all. *(This wording is the result of a teeth pass:
   swapping the two statements reddened nothing, and an ordering claim nothing can violate is a
   comment that lies.)*
2. Never upscale. `scale <= 1` always, and an input already inside both limits returns `scale === 1`
   and the input dimensions unchanged — the no-op path must stay a byte-for-byte no-op.
3. **A legibility floor.** Below `minScale` (default `0.5`) body text stops being readable, and a
   picture of unreadable text is worse than no picture. Return `needsTiling: true` and let §7 take
   over rather than shipping a squash.
4. `limitedBy` is `"edge"`, `"area"` or `null` — the reason, so a UI can explain the number.

**Compose pre-scaled, never scale a composite.** Building the full-size image first and then
downscaling allocates exactly the canvas the limits exist to avoid; a 40000px stack is not
allocatable. Compute the fit from the stacked dimensions, allocate one canvas at the *already
scaled* size, and draw each source piece into its scaled destination rect.

---

## 7. Tiling a tall capture

```
planTiles({ w, h, maxEdge, overlap, breakYs, minTile }) -> { tiles: [ … ], overview }
```

A tile row is `{ index, count, fromY, toY, overlapPx, cutOn }`, 1-based, in source-image
coordinates.

Invariants:

1. **Coverage.** `tiles[0].fromY === 0`, `tiles[n-1].toY === h`, and every consecutive pair
   satisfies `next.fromY <= prev.toY` — the union is the whole image with no gap.
2. **Overlap.** Consecutive tiles share `overlapPx` rows, so a line of text cut at a boundary appears
   whole in one of the two. Each row's `overlapPx` is what it repeats from the tile *before* it, so
   the first is always `0`. `overlap: 0` is legal and means the caller accepts cut lines.
3. **Semantic cuts.** When the producer knows where sections start (`breakYs`), a cut moves to the
   nearest one within range rather than landing mid-paragraph — but never shrinks a tile below
   `minTile` (default: half the stride). `cutOn` records `"break"`, `"stride"` or `"end"` so the
   choice is auditable. `minTile` constrains where a cut may be *moved to*; it does not constrain
   the final remainder, which is whatever is left of the page.
4. **An index, always.** A tile with no `index`/`count`/`fromY` is a fragment; a model given four
   images with no ordering will invent one.
5. **An overview.** `overview` is the whole capture fitted to the floor — the one image that answers
   "what is this?" when the tiles answer "what does it say?". A clipboard, which holds one image,
   takes the overview.

Render one tile at a time and release it. The memory profile of the naive version is exactly the
page this feature exists for.

---

## 8. The budget block — what a paste will cost

```jsonc
"budget": {
  "source":  { "w": 1280, "h": 18750 },
  "fit":     { "w": 1280, "h": 18750, "scale": 1, "limitedBy": "edge", "needsTiling": true },
  "tokens":  { "estimate": 32000, "rule": "area-750", "asOf": "2026-05", "exact": false },
  "profile": "generic"
}
```

**A token estimate is a hand-maintained approximation of somebody else's billing rule, and it
ages.** Three properties keep it honest:

1. **It is stamped.** `rule` names the arithmetic, `asOf` is the month a human last checked that
   arithmetic against published guidance. A consumer — or a user — can see that a number is two
   years stale without knowing anything about the producer.
2. **`exact` is always `false`.** There is no path in the code that sets it true.
3. **It is rounded to two significant figures.** `32000`, never `31847`. A precise-looking number
   from an imprecise rule is a lie told by formatting.

Rule shapes in common use, named by mechanism rather than by vendor, because vendors rename products
and the arithmetic outlives the name:

| `rule` | Arithmetic |
|---|---|
| `area-750` | `ceil(w*h / 750)` after the fit |
| `tiles-512` | `base + perTile * ceil(w/512) * ceil(h/512)` after the fit |

The profile table is a **single declared constant at the top of the implementation**, with a comment
saying it is a moving target and must be maintained by hand. That comment is the maintenance
contract; without it the table silently becomes folklore.

The number is shown to the user **before** the paste, not in the toast after it.

---

## 9. Clipboard

One `ClipboardItem` carrying two types:

```js
new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([text], { type: 'text/plain' }) })
```

Measured in Chromium 149 on Windows, headless **and** headful through the real OS clipboard
(`§13`): **the clipboard drops nothing — the receiving editor chooses.** The paste event carries
`types: ["text/plain", "Files"]` with the PNG in `files[0]`, and which one lands is decided entirely
by the target's own handler:

| Target | Result |
|---|---|
| Default `contenteditable` (no handler) | **image** — Chromium's own paste prefers it, text discarded |
| Handler that checks `files` first | **image** — the standard chat-UI shape |
| Handler that reads `getData('text/plain')` first and `preventDefault()`s | **text**, image silently lost |
| `<textarea>` / `<input>` | **text** — correct; an image cannot land there anyway |

So: offering text alongside is safe in the default and in the common chat-UI shape, and lossy only
in an editor that prefers text — which is nearly always an editor that could not have shown the
image anyway. Two further measured facts worth carrying into every implementation:

- **Key order in the `ClipboardItem` does not matter.** Chromium normalises it; `read()` reports
  `["text/plain","image/png"]` whichever order was written.
- **The PNG is re-encoded on the way through the clipboard** (206 bytes in, 202 out in the probe).
  Never assume byte-identity, and never put anything load-bearing in PNG metadata.

An image-only copy must remain **byte-identical to what it was before the text existed**. Pass the
text as an optional third argument; a caller that does not pass it gets exactly one type.

**Keep an image-only route.** Because the lossy case is real, at least one surface should still copy
the picture alone, so a user whose editor eats the image has somewhere to go. In FullShot that is
free: the editor, beautify and scroll-clip pages all call the same writer without a text argument,
so *Edit → Copy to clipboard* is the image-only path and needs no setting to switch between them.
A tool with only one copy button should think about this before shipping the sidecar on by default.

---

## 10. The annotation legend

An arrow in a screenshot means nothing to a model. The legend is the sentence the arrow was standing
in for.

```jsonc
[
  { "id": 1, "kind": "num", "label": "1",
    "at": { "xPct": 12.4, "yPct": 34.0 }, "near": "Create invoice" },
  { "id": 2, "kind": "arrow",
    "from": { "xPct": 40.0, "yPct": 20.0 }, "at": { "xPct": 44.0, "yPct": 26.0 },
    "near": "Submit" },
  { "id": 3, "kind": "rect",
    "box": { "xPct": 10, "yPct": 50, "wPct": 30, "hPct": 8 }, "near": "Total due" },
  { "id": 4, "kind": "blur", "box": { … }, "note": "content deliberately hidden" }
]
```

Rules:

1. **Percentages, not pixels.** The image gets fitted, tiled and cropped between the editor and the
   model; a pixel coordinate is wrong the moment any of that happens. Percentages of the exported
   image survive all three. One decimal place is plenty.
2. **An arrow has two ends.** `at` is the *tip* — what it points at. `from` is the tail. A legend
   that gives one point for an arrow has thrown away the only thing the arrow was for.
3. **`near`** is the nearest known text to the anchor, when the producer has a text layer. This is
   what turns "an arrow at 44%, 26%" into "an arrow pointing at Submit", and it is the single
   highest-signal field in the whole legend. Omit it rather than guess when there is no text layer.
4. **`blur` and any other concealing mark declare themselves.** A model told "this region is
   deliberately hidden" stops trying to read it and stops treating the smear as data.
5. **Annotation text is user-typed and goes through the mask** (§5).
6. Order is the order the marks were made — for numbered steps that *is* the meaning.

---

## 11. `notes` — what could not be read

A short array of plain sentences naming the honest gaps: surfaces the producer cannot capture,
content it captured as painted rather than as text, anything clamped by a cap. A model that is told
"video frames are not captured" stops hallucinating the video's contents; a model that is not told
does not.

Keep it to what is true for *this* capture. A fixed list of every caveat the tool has is noise, and
noise in the payload is the thing that gets the payload trimmed by the next person.

---

## 12. Implementation checklist for a sibling tool

1. Copy §3's shape. Fill `subject` from what your tool already knows at capture time — do not add a
   discovery pass to fill a field.
2. Emit the **context block even with no text layer**. It is most of the value for a tenth of the work.
3. Implement INV-R and its single test **before** the text payload exists, so the text payload cannot
   land without it.
4. Long-edge fit, floor, tile. Compose pre-scaled.
5. Stamp the budget with the rule and the date.
6. Two types on the clipboard; the image-only path stays byte-identical.
7. Percentages in the legend. Two ends on an arrow.
8. Say what you could not read.

---

## 13. Provenance of the measured claims

Everything in §9 was measured in Chromium 149.0.7827.55 on Windows 11, twice: headless (in-process
clipboard) and headful (the real Win32 clipboard), via Playwright, with a real `Ctrl+V` into four
paste-handler shapes. Both runs agreed on every row of the table. Also measured: 2 MB of text
alongside a PNG writes without error, and a 4000×16000 PNG (1.27 MB encoded) writes without error —
no clipboard size ceiling was reached at the sizes this product can produce.

The probes are not in the repository; they are reproducible from §9's table, which is the part that
matters.

---

## 14. FullShot's own conformance, as of this document

| Part | State |
|---|---|
| Envelope, manifest, budget, INV-R and its gate | shipped in `pages/common.js`, exercised by `pages/result.js`, graded by 79 checks in `test/aihandoff-sim.node.js` |
| Capture context on the shot record | shipped — `pages/result.js` `stitch()` now keeps `meta`, `captureSettings` and `redaction`. It kept none of them before; the capture record was deleted two lines later, so what kind of capture it was died at the moment of success. |
| Context text payload | shipped — source, title, capture time, mode, viewport, content size, image size, redaction state, budget, notes |
| Page-text sidecar (the page's body text) | **not yet produced.** Needs the `collectPageText` pass in `content/capture.js` (plan item AI-2), masked at source. The envelope accepts it the day it exists: `shot.pageText` → the `## Page text` section. |
| Legend | shipped and graded, and **empty in production** until `pages/editor.js` persists `shot.annotations` on save (plan item AI-11). |
| `near` on legend rows | shipped and graded; silent until the page-text layer above exists, because there is nothing to be near. |
| Tiles | planner shipped and graded; the renderer is `composeScaled()` in `pages/result.js`, which the clipboard path drives for the overview. The on-page control that writes tile *files* needs a button in `pages/result.html`, which was not this change's file. One call: `composeScaled(row.fromY, row.toY, w, h)` per row of `envelope.tiles.rows`, then `fsDownloadBlob`. |
| Clipboard two-type | shipped on the result page's Copy, and on a new per-part Copy. Verified end to end in Chromium 149 against the real OS clipboard. |
| Download-a-bundle (zip) | not shipped. Needs a zip writer and a button; the envelope is already the right shape for it — `contents[].path` is the member list. |
