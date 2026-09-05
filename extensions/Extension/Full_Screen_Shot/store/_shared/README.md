# Listing material every store accepts

Kept once, on purpose. Two builds, three stores — and these are the fields where all three
stores agree, so a per-store copy would be three places for one fact to go stale.

| File | Why it is shared |
|---|---|
| `screenshots/` | **1280x800 is the only screenshot size Chrome, Edge and AMO all accept.** Chrome requires 1-5 and treats them as mandatory; Edge allows up to 6 and treats them as optional; AMO recommends 1280x800 as its maximum display size. |
| `privacy-policy-url.txt` | All three require a reachable policy for an item that handles user data. |
| `support-url.txt` | All three ask for it. |

## The 440x280 and 1400x560 promo tiles

Byte-identical between Chrome and Edge (required by Chrome, optional for Edge; AMO has no
equivalent). They belong here when they exist. **They do not exist yet** — see below.

## 🔴 What is missing, and it is a hard blocker

**No store accepts a listing without at least one screenshot, and there are none.**
`Reference/*.png` are development comparison shots at the wrong dimensions and are explicitly
disqualified by `publish/SUBMISSION-PACKET.md`. Capturing them is owner work and is gated
behind the on-device QA pass, so that the screenshots depict behaviour somebody has actually
seen work.
