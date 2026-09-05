# HANDOFF — ⟨TOOL⟩

**This is a template. Rewrite the header, delete this paragraph, and append one
section per working session — newest at the top.**

## Why this file exists, and why it is not optional

One person maintains this fleet, and most sessions are run by an agent that
starts with no memory of the last one. Everything that is not written down here
is re-derived, and re-derived usually means re-decided differently — or the same
bug injected a second time because nobody knew it had already been paid for.

The reference implementation's `HANDOFF.md` reached 154 KB over 25 sessions, and
it is the only reason any of those decisions survived. Its own retros name the
things that would otherwise have been lost: why the sentence allowlist replaced
a regex (twice), why the failure note carries an origin and never a url, which
teeth were actually run and which were assumed.

Decisions are the part that does not retrofit at any price. Code can be read;
the reason it is that way cannot.

## What goes in a session entry

Five headings, always, in this order. An entry missing one is an entry that
will cost somebody an afternoon.

**What shipped.** The files touched and what changed in them. Not a diff — a
sentence per change that says what is now true that was not before.

**What was verified, and how.** The exact commands and their exact output.
"Tests pass" is not a verification; `538 checks / ALL PASS` is.

**Teeth.** Every bug you injected, one at a time, and the check that went red
for it. Restore byte-identical and say so — the md5 is the proof. **A check
first seen green has never been observed to work.** If a check did NOT bite,
that is the most valuable line in the whole entry: write down why it was green
over nothing, because the reason is nearly always "true by construction" or
"a second guard was doing the work", and the same shape will be in the next
check you write.

**Known gaps.** Everything you saw and did not fix, with enough detail that the
next session can pick it up cold. A gap you noticed and did not record is a gap
that gets discovered again from scratch.

**Next action.** One sentence. What the next person should do first.

## Ground rules for every session

- Both tiers green before you finish: `node test/skeleton-sim.node.js` and
  `node test/browser/smoke.mjs`, plus `node _locales/make-locales.mjs --check`.
- The submission gates (`preflight`, `pack`, `verify-firefox-package`) are RED
  until the tool is genuinely submittable. That is correct. Do not "fix" them.
- Never weaken a check to make a change fit. If a check is wrong, say so in the
  entry and say what replaced it.
- If you change a file listed in `skeleton.json`'s `inherited` array, record it
  here — the fleet audit will report the tool as DIVERGED and this is where
  somebody looks to find out whether that was on purpose.

---

## Session ⟨N⟩ — ⟨DATE⟩ — ⟨one-line summary⟩

**What shipped**

-

**What was verified, and how**

```
$ node test/skeleton-sim.node.js
…
$ node test/browser/smoke.mjs
…
```

**Teeth**

| Bug re-injected | Check that went red |
|---|---|
|  |  |

Restored byte-identical; the clean run went back to the numbers above.

**Known gaps**

-

**Next action**

-
