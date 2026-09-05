# FullShot — the redaction claim

**Status:** specification. Replaces the previous version of this file in full.
No product code is written by this document.
**Owns:** what the AI hand-off bundle may say about redaction, what the result
and history pages may say about it, and what has to be shown to a person before
a bundle leaves the machine.
**Amends:** `AI-HANDOFF-ENVELOPE.md` §5 (breaking — a field is removed),
`publish/STORE-LISTING.md`, `publish/PRIVACY-POLICY.html`.
**Supersedes:** the eight-state ladder, `fsRedactionState`, `severity`,
`redaction.pixels` and `redaction.evidence`. Those are deleted, not amended.
See §6 for the removal list.

---

## 0. Why this is shorter than what it replaces

Six rounds of fixes. Each one was competent, fixed a real bug, and was then
defeated by a page shape nobody had enumerated: no text layer, inline script,
off-screen accessibility text, `text/plain`, the box ceiling, walk timeouts,
shadow DOM, closed shadow roots, `content-visibility`, `<object>`/`<embed>`,
same-origin iframes, and text split across inline element boundaries — that last
one being every page on the web, not an exotic shape.

The doors are not running out because the approach is structurally wrong.
FullShot has been asking the DOM what is in a **picture**. The picture is
produced by the compositor. The DOM is a different instrument that usually
agrees with it and sometimes does not, and there is no finite list of the ways
they diverge. **The claim must not be larger than the instrument.**

So the promise changes. **FullShot no longer tells anyone whether the image is
clean.** It states what it did, and it makes the person look at the picture
before they hand it to a machine. The person can see the image. FullShot cannot.
That is the whole design.

This is a **reduction** in what the product claims, and that is the point.

### 0.1 The rule that keeps it reduced

> **No field, sentence, icon or colour that a reasonable person would read as
> "this image is safe to share." However it is computed.**

Two structural consequences, both mechanically checkable, both in §5's gates:

- **Rule 1 — no verdict vocabulary.** There is no field whose value summarises
  the counters into a judgement. `pixels: "baked"`, `state: "read-no-match"`,
  `severity: "unread"` are all gone, and a replacement for any of them is a
  change to this file, not a code change.
- **Rule 2 — the act block holds no words.** Every value in `redaction.acts` is
  an integer, a boolean, or `null`, with exactly one enum (`truncatedBy`, four
  values). **A word is where a verdict hides.** A future field whose value is a
  free string does not belong in that block.

---

## 1. What is kept from the old analysis

The evidence survives; the machinery does not. Two lists, both load-bearing
below — the first justifies the reduction, the second is the text the product
must keep saying.

**Shapes that defeated a DOM-side coverage claim** (each was found after a fix
shipped): no text layer · inline `<script>`/`<style>` read as page text ·
`sr-only` and other off-screen accessibility text · `text/plain` synthetic
`<pre>` · the 2000-box ceiling · the 40 000-element and 350 ms walk budgets ·
open shadow roots · closed shadow roots · `content-visibility: auto` subtrees
that render *after* the scan · `<object>`/`<embed>` · same-origin iframes the
walk never enters while the pipeline grows them to full height ·
`overflow:hidden` ancestors with `height:0` · ancestor `opacity:0` ·
`color: transparent`.

**Standing limits of the instrument** — not page shapes, the permanent width of
the tool. These feed `notCovered` (§2) and the copy in §3 and §7:

- The detector matches five shapes: email, phone, card (Luhn), SSN, API token.
  Not names, addresses, dates of birth, account nicknames, medical terms, or
  free-form secrets.
- `fsOwnLeafText` reads childless elements only, so `<p>Card <b>4111…</b> …</p>`
  contributes **none** of the paragraph's own text. That is the most common
  markup on the web. Any character count derived from it understates the page by
  an unknown factor — which is why §2 removes the character count rather than
  printing it.
- Attributes and form state are never read: `value`, `placeholder`, a chosen
  `<option>`, `::before` content.
- A number split across `<span>`s or `<tspan>`s is never seen whole.
- Text drawn as pixels — canvas, video, images, PDF viewers — is never read.

---

## 2. HALF ONE — the bundle states acts, never verdicts

### 2.1 The block

`AI-HANDOFF-ENVELOPE.md` §5's `redaction` object, in full. Nothing else in it.

```json
"redaction": {
  "requested": true,
  "detector": "fullshot/pii-regex@1",
  "acts": {
    "v": 4,
    "matched": 3,
    "painted": 3,
    "verifiedOpaque": 3,
    "matchedComplete": true,
    "walkComplete": true,
    "truncatedBy": null,
    "textRefused": 0,
    "blocksLost": 0,
    "blocksUnpainted": 0,
    "blocksUnread": 0,
    "ledger": "present"
  },
  "kinds": { "email": 2, "phone": 1 },
  "text": "masked",
  "markers": ["[email]", "[phone]", "[card]", "[ssn]", "[token]"],
  "surfaces": ["image", "text", "envelope"],
  "notCovered": [ … ]
}
```

| field | written by | means |
|---|---|---|
| `requested` | the setting, read once | the user asked for redaction. `false` = off, `null` = the record cannot say (§4) |
| `acts.matched` | the line after the detector returns, once **per match** | matches the detector returned in the text it was handed |
| `acts.painted` | the composition loop, rolled up **per match** after the last segment | matches every one of whose blocks FullShot drew into the finished image |
| `acts.verifiedOpaque` | the post-crop read-back of the composed canvas, rolled up **per match** | matches every one of whose blocks it then read back out of that image as uniformly the block colour |
| `acts.matchedComplete` | the scan's seal, from the facts recorded at each refusal | is `matched` the whole count — `false` when any budget, cap or per-item refusal stopped the pass short. `null` = the ledger cannot say |
| `acts.walkComplete` | `forEachDeep`'s stop reason, at the stop | the walk reached the end of the tree |
| `acts.truncatedBy` | same | `null` \| `"elements"` \| `"time"` \| `"ceiling"` |
| `acts.textRefused` | each refusal, at the refusal | **leaves** whose text was never handed to the detector: over the per-leaf cap, or a style or rect that could not be read |
| `acts.blocksLost` | the match-unit roll-up | **blocks** a match produced that the box ceiling never emitted |
| `acts.blocksUnpainted` | the composition loop's seal | **blocks** that arrived and were never drawn — no frame to draw them in, or outside every segment |
| `acts.blocksUnread` | the read-back | **blocks** that were drawn and never read back: the area budget refused them, or `getImageData` threw. Not the same as read and found wanting, which is what `verifiedOpaque` already says |
| `acts.ledger` | the assembler | `"present"` \| `"partial"` \| `"absent"` (§4). `"absent"` requires every counter above to be `null` |
| `kinds` | each emitted block | histogram of which patterns matched. Counts only — never a value, never a position |
| `text` | the masker, re-read by `FS_ENVELOPE_UNREDACTED` | what FullShot did to **its own text payload**. This is a statement about the bundle, not about the image, and it is the one word left in the block because a gate re-reads every string before emission |

Three numbers tell the whole story without anyone summarising them.
`3 / 3 / 3` says FullShot matched three things and covered all three.
`3 / 2 / 2` says one match is not covered — arithmetic, not judgement.
`0 / 0 / 0` says FullShot matched nothing in the text it read, which is a fact
about the reading and says nothing about the picture.

**All three count MATCHES, and the previous version of this table said `painted`
and `verifiedOpaque` counted BLOCKS.** That is the amendment, and it is one this
document had already contradicted itself about: reading `3 / 2 / 2` as "one match
is not covered" is a subtraction, and a block is one **client rect** — a token
that wraps across a line has two. A card number breaking over a line therefore
reported `1 matched / 2 painted`, and the surplus paid for a genuinely uncovered
email elsewhere on the same page: the alarm silent, the ledger a serene `2/2/2`,
the address legible in the delivered image. With the sign reversed it printed
*"Redaction matched 3 and covered 5. 0 matches are not covered in this image."*

> **Two numbers may only be subtracted if they count the same thing.**

A match is painted only when **every** block it produced was painted, and
verified only when every one of them was read back opaque — half a card number
is a card number, so the safe direction for a count of what is still exposed is
to under-claim coverage. A match that produced no block at all is counted by
`matched` and by neither of the others, which is the arithmetic §3.4 needs.
Relating a block to its match needs an identity on the block: `content/capture.js`
tags each emitted rect with the ordinal of the match it came from, and that
integer dies with `cap.meta` exactly as the rects do.

The blocks are still counted — by the bake ledger, under names that say
`blocks` — and they are what §3.3's outlines are drawn from: a wrapped token is
one match covered and two rectangles for a person to look at. A block count is
never subtracted from a match count.

### 2.1.1 v4 — INCOMPLETENESS IS DATA, NOT AN ABSENCE

**This is the amendment, and it is about the shape of the defects rather than
about any one of them.** Nine rounds of bugs in this feature share one form:
something the pipeline gave up on was computed and then dropped — a skipped-text
counter read into a local and discarded, a walk truncation never propagated, two
`continue` statements silently discarding rectangles that existed *because* PII
was found there, and a roll-up grading a match against the blocks that were
EMITTED rather than the blocks it PRODUCED, so a match the 2 000-box ceiling cut
in half was graded fully covered. Downstream then reasoned over a partial set
believing it complete. Patching each instance reliably produced the next.

> **Anywhere the pipeline gives up on something — a cap, a ceiling, a timeout, a
> `continue`, a refusal, a catch — that fact is recorded, carried, and reaches
> the surface. A count without its completeness flag is not a count.**

Five fields, and they are separate on purpose: *"we stopped early"* and *"we
refused this one item"* are different facts and a person can act on them
differently, so a single flag standing for both is forbidden. Each carries its
UNIT in its name, because §2.1's subtraction rule has to survive five more
counters. Each is an integer or a boolean, so §0.1's Rule 2 holds — a word is
where a verdict hides, and none of these is a word.

**A match is covered only if every block it PRODUCED was covered**, including
the ones no cap ever let it emit. That requires the block's identity and its
match's block production to travel as ONE value (`match: { id, blocks }` on each
emitted rect), so the roll-up cannot ask which match a block belongs to without
being told how many blocks that match produced. Where that pairing is absent —
every capture measured by an older build — the roll-up answers `null` for both
match-unit counters rather than grading what survived. **Ungradeable is a true
statement; "covered" is not.**

### 2.2 Removed — do not leave the old field beside the new one

| removed | where | why |
|---|---|---|
| `redaction.pixels` | envelope + record | The verdict field. Every value of it: `"baked"`, `"unknown"`, `"none"`. A consumer keyed on `pixels === "baked"` now reads `undefined`, which is the correct direction |
| `redaction.state` | envelope + record | All eight of `off` / `blocks-painted` / `read-no-match` / `no-coverable-text` / `incomplete` / `pass-not-run` / `derived` / `unknown` |
| `redaction.severity` | record | `exposed` / `unread` |
| `redaction.evidence` | envelope | The whole object. `painted` and `verified` reappear inside `acts` under the shape above; **`evidence` itself does not survive as a synonym** |
| `chars`, `spans`, `placed`, `unplacedSpans`, `unplacedChars` | evidence | Coverage inference. `chars` is additionally *wrong* — §1's `fsOwnLeafText` limit understates by an unknown factor, and a wrong number printed beside a claim is worse than no number |
| `inkPx`, `capturedPx` | evidence | Same: a coverage fraction is a verdict with the arithmetic left to the reader |
| `declined`, `moved`, `frames` | evidence | All existed to grade coverage. Nothing now consumes a grade |
| `scan`, `bake` ledgers | record | The five counters above are persisted; the ledgers are not. Machinery left lying around is machinery someone re-derives a verdict from |
| `fsRedactionState`, `fsRedactScanOk`, `fsRedactBakeOk` | `pages/common.js` | The ladder, both predicates, the severity expression |
| `FS_REDACT_LINE`, `FS_REDACT_CLAUSE`, `fsRedactClause` | `pages/common.js` | The state→sentence table and the ten shortfall clauses. §3.1 replaces them with five sentences |
| `data-proven` attribute | `pages/result.js` | A verdict as a CSS hook is a verdict one stylesheet away from being green |
| the history verdict badge | `pages/history.js` | Replaced by the acts line, shown for every record where `requested !== false` |
| `AI_FIT_NOTICE` / `resultAiOverviewOnly` toast | `pages/result.js` | Moves into the review dialog (§3.4), where the reduction it warns about is visible |

`AI-HANDOFF-ENVELOPE.md` §5 must be amended and the envelope id moved to
`ai-handoff/1.1`: removing a documented field is breaking, and §2 of that spec's
"ignore unknown keys" rule does not cover a key that disappears.

### 2.3 The text payload

Replaces the two `- Redaction:` lines. ASCII, never localised, per
`AI-HANDOFF-ENVELOPE.md` §4.

```
- Redaction: requested; 3 matched (whole count), 3 of them painted over, 3 read back opaque; walk complete.
- FullShot reads the text a page exposes. It cannot see this image. The line above
  counts what FullShot did, not what is in the picture.
```

*"of them"*, not *"blocks"*: all three numbers count matches (§2.1), and a
consumer reading them will subtract. The two words are what pin the reading to
one unit.

*"(whole count)"* — or *"(PARTIAL count)"*, or *"(completeness unknown)"* — is
§2.1.1's flag, and it is **inside the clause that states the number** rather than
appended to the line. The consumer this line exists for is a summariser, and a
qualifier at the end of a line is the part a summariser drops. When any of the
four gap counters is above zero a second line follows, stating each with its
unit and only when there is something to state:

```
- Redaction gaps: 2 pieces of text not read; 201 blocks found and never drawn.
```

The second line is a **constant**, emitted whenever `requested !== false`. It is
the only defence against a consumer turning `3/3/3` back into "clean" in its own
summary. With `ledger: "absent"` the first line reads
`- Redaction: no record of a redaction pass on this capture.`

---

## 3. HALF TWO — the human is the oracle

Before an AI bundle is exported, the person is shown **the image that is about
to leave**, with every block FullShot painted marked on it, and a list of what
matched. They confirm they have looked.

### 3.1 When it fires, and when it must not

| action | redaction requested | gate |
|---|---|---|
| Save / download PNG, JPEG, WebP, PDF | either | **no** |
| Editor, Beautify, Scroll clip, history browsing | either | **no** |
| Copy / AI hand-off (image + manifest to clipboard) | `false` | **no** |
| Copy / AI hand-off | `true` or `null` | **yes**, once per record per page load |

Three deliberate lines here.

- **It gates the bundle only.** A person saving a PNG for their own archive is
  never interrupted. Interrupting them teaches them to click through everything,
  and then the one dialog that matters is furniture.
- **It does not fire when redaction was never requested.** FullShot made no
  claim, so it has nothing to walk back. This alone keeps the dialog away from
  every user who leaves the setting off — which is the default.
- **Once per record per page load, and the flag is never persisted.** Two copies
  in one sitting, one dialog. Come back tomorrow and the dialog returns, because
  tomorrow is a fresh look at a picture they no longer remember. There is no
  "don't show this again": the confirmation is the entire justification for
  emitting a bundle at all, and a checkbox that disables it disables the design.

### 3.2 It shows the actual image

Not a summary, not a thumbnail sheet, not a description. The dialog renders
**the exact blob that `buildHandoff` is about to put on the clipboard** —
already composed, already downscaled to `budget.fit`. That is the artifact; the
full-resolution capture is not what leaves.

- Fit to the dialog by default, with the scale stated: *"Shown at 38% of the
  size that will be copied."*
- **A zoom that MAGNIFIES, not merely a 1:1 control.** This is the amendment,
  and the previous wording was the defect: `budget.fit` is itself a downscale,
  so 1:1 with the exported pixels is 1:1 with an image whose glyphs are already
  under half their captured size — and past the tiling floor, a fifth of it. A
  dialog whose largest setting is 1:1 cannot show a person a readable word on
  any capture over about 3 100 px, which is most full-page captures. The ladder
  is four stops — fit · 1:1 · **readable** · twice readable — where *readable* is
  `srcW / fit.w`, the scale that exactly undoes the export's own downscale and
  puts the page back at the size it was captured at. It recovers no detail; the
  detail is gone. Seeing that it is gone is the useful part.
- A scroll region for anything larger than the dialog, and it is a **keyboard
  tab stop**: without one, a keyboard user can reach every control that moves
  the picture and never the picture itself.
- **No forced scroll-to-bottom.** On a 12 000 px page it becomes a chore, the
  chore becomes a scrollbar drag, and the drag proves nothing. Make looking
  cheap instead of mandatory: **prev / next view** controls step the viewport
  through the WHOLE image in reading order, one screenful at a time with a
  tenth kept as overlap, and the first press magnifies to the readable stop —
  so looking is one key, repeated. A readout beside them says where in the
  picture the person is (*"View 3 of 14"*), derived from the scroll position so
  that a wheel, a trackpad and PageDown move it too.

  **These used to be prev / next BLOCK, and that was the deeper half of the same
  defect.** A block is by definition a region FullShot already covered, so a
  tour of the blocks walks a person around exactly the ground that is known to
  be solid — and what a review is FOR is what was missed, which has no mark on
  it. The marks stay, as landmarks: the numbered list beside the image still
  jumps to any of them. They are not the itinerary.

  Neither control may ever be gated on `marks.length`. An image with no marks is
  the image where every pixel has to be judged by eye, because the product
  covered none of it, and that was precisely the case in which the old controls
  switched themselves off.
- When the export is a reduced overview (`budget.fit.needsTiling`), the dialog
  says so — the line that is currently a toast. The person is judging a picture
  whose small text is illegible and must be told that is what they are judging.

### 3.3 The marks

Each block that was **read back opaque in the finished image** is drawn as a
2 px outline just outside the block, plus a numbered badge, keyed to a numbered
list beside the image (`1 email · 2 email · 3 phone`). Outline and badge, never
a fill: the mark must not cover any pixel of the thing being judged. Numbered
and listed, never colour alone — `test/a11y-sim` asserts it.

**The marks are drawn in the preview only and never in the exported image.**
An e2e check decodes the exported PNG and asserts the outline colour does not
occur in it.

**Only verified-opaque blocks are marked, and only verified-opaque blocks are
persisted.** This is the one place geometry is allowed to travel, and the reason
is narrow: a rect confirmed opaque in the delivered image describes **the
picture** — a region that is a solid block in the file the user already holds.
A rect that was *not* confirmed opaque describes the **page**, and it is a map
to something that may still be visible. Those are discarded at the moment the
read-back fails, in the same expression that fails it. The old absolute — *the
rectangles never travel* — held because the stored set included both kinds.

Marks are stored on the record as `redaction.marks: [{x,y,w,h}]` in full-image
coordinates and scaled to the preview. They are **dropped on any derivation**
(editor, beautify, scroll clip, crop): a mark drawn at a stale coordinate is
worse than no mark, because it actively points at the wrong place. A derived
image gets the dialog with no marks and the sentence in §3.5 that says so.

### 3.4 The copy

It states what FullShot did and what it cannot know. It never says *safe*,
*clean*, *secure*, *protected* or *done*. It also does not shout: an alarming
warning on every capture is wallpaper within a week and then protects nobody.
Flat, specific, and over in one read.

> **Before you copy**
>
> Redaction matched 3 patterns in the text it read and painted 3 blocks. All 3
> are outlined below. *(the outlines are not in the copy)*
>
> FullShot reads the text a page exposes. It cannot see this image. Anything
> drawn as pixels — a canvas, an image, a PDF page, a video frame — was never
> read.
>
> `[ 1 email ] [ 2 email ] [ 3 phone ]`   View 1 of 14  ‹ prev · next view ›  ‹ − · + ›
>
> — the image —
>
> **[ I have looked — copy ]**  [ Cancel ]

The primary button carries the statement, so the act and the assertion are one
click rather than a checkbox the eye learns to skip.

**Honest common case, walked.** Plain text page, three matches, three painted,
three verified. The person reads one sentence that says the feature worked and
gives the count, sees three outlines land where they expect, and clicks. That is
informed, not nagged, and the second paragraph is the only thing they did not
already know.

**Three variants, all allowlisted, none of them new machinery:**

| condition | first paragraph |
|---|---|
| `painted === matched === verifiedOpaque`, `> 0` | as above |
| `matched === 0` | *"Redaction matched nothing in the text it read and painted no blocks. Nothing is outlined below."* |
| `matched − covered > 0`, where `covered` is `verifiedOpaque` (or `painted` where there is no read-back) | *"Redaction matched 3 patterns and covered 2. **1 match is not covered in this image.**"* — the only bolded line in the design |

The condition was `painted < matched || verifiedOpaque < painted`: two
comparisons across the unit boundary §2.1 now closes, the first silenced by any
wrapped token and the second able to open the arm on counts whose subtraction is
zero or negative. **A shortfall that is not a positive number renders nothing at
all** — it is an arithmetic impossibility, not a quieter alarm, and §0.1 forbids
the sentence it used to produce "however it is computed". One predicate,
`fsRedactShortfall` in `pages/common.js`, answers for the sentence **and** for
the emphasis on it; two predicates disagreed, and the bolding was the half that
lost.

`walkComplete === false` appends one sentence: *"FullShot did not finish walking
this page."*

### 3.5 Where the gate lives

**At the producer, not at the button.** `fsAiBundle` throws
`FS_ENVELOPE_UNREVIEWED` when `requested !== false` and its input does not carry
an explicit `reviewed: true`. Exactly one function in `pages/result.js` sets
that flag, and it is the function that showed the dialog and got the click.
`reviewed` is a **precondition and never a payload** — it does not appear in the
emitted envelope, in the text, or on the record.

That placement is the same doctrine as the two existing envelope gates: a call
site added next year cannot talk its way past a re-read. It also means the
tooltip path stops building a whole envelope to read two numbers —
`showHandoffCost` calls `fsAiFitDims` / `fsAiPlanTiles` directly, which is what
it wanted anyway.

**Nothing about the review reaches the bundle.** Not a timestamp, not a boolean.
A consumer reading `reviewedByHuman: true` summarises it as *approved*, and a
human's "I looked" laundered into machine-readable assurance is the same verdict
this document removes, wearing a person as a costume.

---

## 4. Captures that carry an old-format record

Three populations exist in users' IndexedDB: v2 records with the eight-state
ladder (`state`, `severity`, `pixels`, `scan`, `bake`); ancient records whose
`pixels` came straight from the setting; and records with no redaction block.

**The stored verdict is never read, in any of them.** Not as an input, not as a
fallback, not to seed a default. Those words were written by machinery this
document deletes, and re-reading one carries a claim across the boundary on the
strength of a word — which is the whole disease.

| population | `requested` | `acts` | `marks` |
|---|---|---|---|
| v2 ledger present | `true` if the record positively records the setting as on | counters lifted from the surviving act fields **that are already in the match unit** — `scan.matched`, `scan.truncated.*`, `scan.walks*`. `painted` and `verifiedOpaque` are **`null`**: see below. Anything the ledger cannot supply is **`null`, never `0`** — a zero is a measurement and this is the absence of one. `ledger: "partial"` | none — geometry was never stored |
| ancient, `pixels: "none"` | `false` | all `null`, `ledger: "absent"` | none |
| ancient, anything else, or no block | `null` | all `null`, `ledger: "absent"` | none |

**`painted` and `verifiedOpaque` are `null` for every lifted record, and this is
the amendment.** The previous version of the row above named `bake.painted` and
`bake.verified` as the source, and those two count **blocks** — §2.1's whole
correction. Lifting them into the match-unit fields recreates the cancelled
shortfall in the one path the round's fix did not reach, and it does it silently
on every capture a user already has: a wrapped card number arrives as
`1 matched / 2 painted`, and the envelope, whose §5 tells consumers in as many
words that these three may be subtracted from one another, then states a covered
count above its matched one.

The match-unit roll-up needs a `matchId` on each block. **No record written
before this version carries one** — the blocks died with `cap.meta` at the seal,
by design — so the two counters are not merely missing from a v2 ledger, they are
**unknowable** from it. Prefer `null` over a plausible-looking number: a wrong
number is worse than an absent one, because a wrong number is actionable. The
lift is handed a projection of the old ledger with the block-unit fields removed,
so a block count is not discouraged from reaching a match-unit field, it is
unable to.

`requested: null` **gates** (§3.1): "we cannot tell whether redaction ran" resolves
toward showing the person the picture, which costs a dialog. The opposite default
costs them their data. `requested: false` is set only where the record positively
says the setting was off.

**Stripped on read, dropped on write.** The strip happens in `pages/db.js`, on
the way out of the `shots` store, and nowhere else. Five files call
`FSDB.get('shots', …)` or `FSDB.getShotsNewestFirst()` — result, history, editor,
beautify, scrollclip — and a strip written in any one of them is a strip the
other four do not have. Deleting `state`, `severity`, `pixels`, `scan` and `bake`
at the store boundary means no page can read them even by accident, and any
subsequent save persists the new shape. No bulk migration: rewriting every record
in a user's library to delete five fields is more risk than the fields are worth,
and the store boundary is the only door they can come through.

---

## 5. Gates

Three exist. The third changes shape; a fourth is added. All four keep the same
doctrine: **grade the output, refuse, do not degrade.**

| gate | throws |
|---|---|
| `FS_ENVELOPE_UNREDACTED` | unchanged — a carried string still matches a pattern |
| `FS_ENVELOPE_OVERSIZE` / `FS_ENVELOPE_NOCLAMP` | unchanged |
| `FS_ENVELOPE_NOEVIDENCE` | `requested !== false` and `redaction.acts` is absent, or `acts.ledger === "absent"` with a non-null counter beside it |
| **`FS_ENVELOPE_VERDICT`** | the envelope it just built contains a key named `pixels`, `state`, `severity` or `evidence` **at any depth**, or a value in `acts` that is not an integer, a boolean, `null`, or one of the four `truncatedBy` strings |
| **`FS_ENVELOPE_UNREVIEWED`** | `requested !== false` and the input does not carry `reviewed: true` (§3.5) |

`FS_ENVELOPE_VERDICT` is Rules 1 and 2 with teeth. It is a self re-read: the
builder scans its own output before returning it, so reintroducing the verdict
in a new costume fails on the first bundle rather than in a review six months
from now.

---

## 6. Strings

Every user-visible string goes through `chrome.i18n` with a key in
`_locales/en/messages.json`. **Read `_locales/make-locales.mjs` before touching
`_locales`** — the guard refuses a build that would overwrite translations, and
`--adopt` is the remedy. Add keys to the English file only; do not run a build
while the 38-locale translation-memory gap is an open owner decision.

**New keys** (English is owner-editable; the constraints below are not):
`redactActsLine` · `redactActsNone` · `redactActsShortfall` ·
`redactActsWalkTruncated` · `redactActsNoLedger` · `reviewTitle` ·
`reviewLimit` · `reviewMarks` · `reviewNoMarks` · `reviewScale` ·
`reviewReduced` · `reviewConfirm` · `reviewCancel` · `reviewPrevView` ·
`reviewNextView` · `reviewZoomIn` · `reviewZoomOut` · `reviewViewPos` ·
`reviewMarkLabel` · `reviewMarkAt` · `reviewImgAlt` · `reviewImgRegion` ·
`redactActsScanLimits` · `redactActsBakeLimits`.

The last two are §2.1.1's gaps on the human surface, appended to whichever arm
rendered and only when they have something to report. Each carries TWO counts
and is therefore **not** a plural base, by the same rule the three-count stats
line follows: a sentence with two counts can only agree with one of them. Both
are written label-then-number (*"Pieces of text it did not read: 1."*) so that a
count of one reads correctly without plural machinery.

`reviewPrevBlock` / `reviewNextBlock` / `reviewActualSize` were the previous
version of this list and are **retired**: the controls they named stepped
between marks and could not magnify, which is the defect §3.2 now describes.
All three were `AWAITING-TRANSLATION` with no memory behind them, so nothing
translated was lost. The last six above were always required by §3.3 and §3.4
and were simply missing from this list; they are named here so the suite that
grades §6 by key can stop reporting the gap.

**Editing the English of a key already built into the 54 locales is not free**,
even for one no locale has translated: the generator's guard reads the English
fallback on disk as content it cannot reproduce and refuses the whole build
(`--adopt` would then record that English as if a translator had chosen it,
which is the one thing `--adopt` exists to prevent). Adding a key and retiring a
key are both clean. Say a new thing in a new key.

- `redactActsLine` is a **stats line** — *"Redaction on. $MATCHED$ matched,
  $PAINTED$ painted, $VERIFIED$ confirmed opaque in this image."* — and carries
  no plural machinery, because a sentence with three counts can only agree with
  one of them and `fsPluralMessage` resolves against the first substitution.
  Sentences that do select on a count carry exactly one.
- Human-facing numbers go through `fsNumber` for locale grouping; the bundle
  payload's copies stay bare ASCII (`AI-HANDOFF-ENVELOPE.md` §4).
- Untrusted text never becomes markup: `textContent`, never `innerHTML`. Every
  substitution is an integer this product computed or a member of a closed set
  declared in `pages/common.js`. Allowlist only — never a regex over page text.

**Retired:** `resultRedactCoveredOne` / `…Other` · `resultRedactReadNoMatch` ·
`…ReadNoMatchBlind` · `…NoCoverableText` · `…Incomplete` · `…PassNotRun` ·
`…Derived` · `…Unknown` · the ten `resultRedactWhy*` clauses · and
`resultRedactNoTextLayer`, whose English ("This page draws its text as a
picture") is an inference about the page in 54 translations. Retire keys through
the generator's own path; a key that already carries real translations is
adopted before it is removed.

**Forbidden in any redaction string, English or translated:** *safe*, *clean*,
*secure*, *protected*, *done*, *nothing to hide*, and any sentence beginning
*"this page…"*. `test/i18n-sim` asserts the English; a translated string cannot
be machine-checked, so the key's `description` field must carry the constraint
for the translator.

---

## 7. Store listing and privacy policy

Both currently describe a protection guarantee the product will no longer make.
The ⚠️ owner-edit note at the top of `publish/STORE-LISTING.md` is resolved by
this rewrite rather than by adding a caveat to the old bullet.

**`STORE-LISTING.md`, the "MAKE IT USEFUL" bullet.** Currently: *"finds emails,
phone numbers, credit-card numbers, SSNs, and API keys **on the page** and bakes
a solid block over **each**"* — two completeness claims about the page. Replace
with an act, its limit, and the review:

> • Auto-redact PII (opt-in): scans the text a page exposes for emails, phone
> numbers, credit-card numbers, SSNs and API keys, and bakes a solid block over
> what it matches — not a blur, so it can't be reversed. It reads text, not
> pictures: anything drawn as pixels (canvas editors, images, PDFs, video) is
> never read. FullShot tells you what it covered and shows you the marked image
> before you hand it to an AI — it does not tell you the image is clean.
> 100% on-device.

The 132-char summary keeps "auto-redact PII" as the feature's name. The words
*protect*, *secure*, *safe* and *guarantee* must not appear near it anywhere in
the listing. The data-disclosure line's *"exists to remove PII, not gather it"*
becomes *"exists to cover matched patterns in the image, not to gather them"* —
"remove PII" is the same completeness claim in the section auditors read most
closely.

**`PRIVACY-POLICY.html` §3d.** The first paragraph is already act-language and
needs one word: *"over each match **it finds**"*. The second paragraph ("What it
cannot do") is close to right and gains two things — the list of standing limits
from §1 (form fields and attributes, text split across inline elements, not just
canvas), and the replacement of *"lowers the chance… is not a guarantee"* with
the plain version: **FullShot reports what it covered; it cannot tell you whether
the image is clean, because it never sees the image as a picture. Look at it
before you share it.**

**One new disclosure is required, because §3.3 stores something new.** Add to
§3d: FullShot stores, locally and on your device only, the position and size of
the blocks it confirmed opaque, so it can mark them for you when you review an
image before handing it to an AI. It stores no coordinates for anything it did
not cover, and it never stores the matched text itself.

`publish/COMPLIANCE-CHECKLIST.md` §D3-note and §C12 cross-reference the old
wording and must move with it.

---

## 8. Test strategy

**Doctrine, unchanged: FAIL-FIRST** (write the check, watch it go red on exactly
the predicted line, then fix) **and TEETH** (re-inject the defect, prove the
check bites, restore byte-identical, verify md5). Playwright + Chromium at
`test/e2e` for anything that depends on real layout, real encoding or real
clipboard.

### 8.1 Fail-first order

| # | check | predicted red |
|---|---|---|
| 1 | no `pixels` / `state` / `severity` / `evidence` key at any depth of a built envelope | all four present today |
| 2 | `FS_ENVELOPE_VERDICT` throws when one is reintroduced | no such gate |
| 3 | every `acts` value is an integer, boolean, `null`, or a `truncatedBy` enum | no `acts` block |
| 4 | `FS_ENVELOPE_UNREVIEWED` throws without `reviewed: true` | bundles emit unreviewed today |
| 5 | `fsRedactionState` / `FS_REDACT_LINE` / `FS_REDACT_CLAUSE` are absent from source | all three present |
| 6 | Copy with redaction on opens the dialog; Cancel leaves the clipboard untouched | no dialog |
| 7 | Save PNG with redaction on opens **nothing** | n/a — must stay green forever |
| 8 | a v2 record's stored `state` is absent from what the loader returns | returned verbatim today |
| 9 | an old record with no ledger emits a bundle with `ledger: "absent"` and all-null counters, and still gates | emits `pixels` from a re-derived state |
| 10 | the exported PNG contains no mark-outline pixels | no marks exist |
| 11 | only verified-opaque rects reach `redaction.marks` | no marks exist |
| 12 | no forbidden word in any English redaction string | `resultRedactNoTextLayer` and others |
| 13 | a match whose blocks straddle the box ceiling is not graded covered, and the blocks it never drew are stated | graded covered on the surviving blocks; the flat line renders |
| 14 | a walk stopped mid-page marks the COUNTERS partial, not only the walk | `matchedComplete` does not exist |

Both are §2.1.1, and both are fixtures rather than unit checks on purpose: the
defect was never in a rule, it was in what a rule was handed, so a check that
calls the rule with hand-made input grades the rule and misses the defect.
`test/pixel-sim`'s `ceilingstraddle` builds a real 2 200-rect match against the
real 2 000-box cap; `walkbudget` puts 40 010 elements in front of an email and
proves the count is partial by finding that email's colour still in the
delivered image. `test/e2e/privacy-verify`'s `wrap-covered` is the third: a
wrapped token with nothing uncovered anywhere, which is the page on which a
BLOCKS-versus-MATCHES check demands an alarm about a capture where nothing went
wrong — the shape that was live in check B4, in the file used to certify the
unit fix.

### 8.2 Tiers

- **`test/aihandoff-sim`** — 1–5, 9, 12. The envelope shape, the gates, the
  old-record translation, the deep key scan.
- **`test/pixel-sim`** — 11, and the standing regression: the existing 35
  scenarios keep painting and verifying what they paint. The acts counters equal
  each fixture's declared ground truth.
- **`test/background-sim`** — 8, and that `piiBoxes` geometry still never
  reaches storage except as verified-opaque marks.
- **`test/i18n-sim`** — 12, zero bare strings, `fsNumber` on human counts and
  bare ASCII in the payload, the retired keys gone from every locale.
- **`test/a11y-sim`** — the dialog is focus-trapped, Esc cancels, marks are
  numbered rather than conveyed by colour, and **initial focus is not on the
  primary button** — a dialog that opens with the confirm key already armed is a
  dialog that gets dismissed by an Enter the user had already pressed. Plus the
  shape of the answers §3.2 now requires: the dialog describes itself, the
  scroll region is a tab stop with a name, each jump control says where its
  block is, the walk is not gated on `marks.length`, and the trap decides on
  RING MEMBERSHIP rather than on the two ends.
- **`test/e2e`** — 6, 7, 10, plus: the dialog renders the downscaled export blob
  and not the full-size capture; marks land on the black blocks in the delivered
  image; the reduced-overview line appears on a 12 000 px page.
- **`test/e2e/review-keyboard.mjs`** — the two properties no static check can
  see, driven with real key events. **The focus trap is dynamic**: the hole was
  at the point the dialog itself opens on, every line of the trap read
  correctly, and Shift+Tab from there reached the Delete button behind the modal
  in four presses with Enter arming it. And **whether a person can read the
  picture is a layout fact**: the preview must come out larger than the exported
  pixels, large enough to put the page back at its captured size, and the walk
  must reach the foot of the image and cross ground with no mark on it. Both
  graded again on a tall capture where nothing matched, because no marks is the
  case the old dialog switched itself off in.

### 8.3 Teeth

1. Reintroduce `pixels: "baked"` in the envelope → check 2 bites; restore, md5.
2. Default `reviewed` to `true` → check 4 bites.
3. Move the gate from `fsAiBundle` to the Copy button and add a second call site
   → check 4 bites at the new call site. This is the tooth that proves the gate
   is at the producer.
4. Persist an unverified rect as a mark → check 11 bites.
5. Add `reviewedByHuman: true` to the envelope → check 1 bites on the deep scan
   only if the scan is by *shape* and not by a list of four names. If it does not
   bite, the scan is a denylist and the next verdict will simply be named
   something else.

---

## 9. What this still cannot promise

Stated here so nobody has to rediscover it, and so the copy in §3 and §7 stays
honest.

- **It cannot tell anyone the image is clean.** That is the point, not a gap.
- **The human is the oracle, and humans skim.** A person who clicks through
  without looking gets no protection. The design makes looking cheap and
  meaningful — the real image, the marks, jump-to-block — and then stops. There
  is no mechanism that verifies a human looked, and any that claimed to would be
  the next verdict.
- **Verification is of the composed canvas, not the encoded file.** A solid
  block survives JPEG and WebP, and no encoder reconstructs covered glyphs, but
  `verifiedOpaque` means opaque in the canvas. Decoding the produced blob and
  re-reading it is affordable and is the correct next increment.
- **The review shows the downscaled export.** §3.2's zoom magnifies it back to
  the size the page was captured at, which is the most that can honestly be
  done: it makes what survived the downscale big enough to look at and recovers
  nothing that the downscale destroyed. Small text that is illegible at that
  magnification is illegible to the person judging it and to whatever receives
  the image, which is why the reduced-overview line exists — a warning, not a
  fix.
- **Looking is cheap; it is not compelled, and it is not measured.** The walk is
  one key repeated, with a readout that says how much picture there is. Nothing
  records how far anybody got, and nothing may: a "reviewed 14 of 14 views"
  counter is the verdict again, computed out of a person's scrolling.
- **`matched` counts what the detector was handed**, and §1's limits say how
  much of a page that is not.
- **OCR of the delivered image** is the only mechanism that would let FullShot
  read the picture rather than the DOM. It stays blocked (Tesseract WASM plus an
  owner CSP decision). If it ever lands, it measures coverage for the first time
  — and it will be tempting to turn that measurement into a verdict. Do not.
