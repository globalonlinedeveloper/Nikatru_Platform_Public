# Store screenshots — 1280x800

**Empty on purpose, and this file is the record of why.**

The directory is required by `check-store-metadata.mjs` even while it holds no images, for the
reason the platform repo already learned: losing the directory loses the record that this
listing needs screenshots at all.

## The specification

- **1280x800** — the one size Chrome, Edge and AMO all accept. Chrome also takes 640x400 and
  Edge also takes 640x480; shipping only 1280x800 keeps one set instead of three.
- **24-bit PNG, no alpha.** Square corners, full bleed, no padding.
- **1 to 5.** Chrome requires at least one and allows five; Edge allows six; AMO states no
  practical limit. Five satisfies all three.

## Why there are none

Three features — Batch URL capture, Beautify and Scroll to Clip — pass the sandbox sims but
have never been exercised by hand in a real browser. A screenshot taken before that pass would
advertise behaviour nobody has watched work. The QA pass comes first; these come from it.
