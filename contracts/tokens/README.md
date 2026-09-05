# `contracts/tokens/` — a pointer, not a copy

**Nothing has moved here yet, and that is deliberate.** This file records where
the tokens live today and what the intended move is, so the pointer is a
pointer rather than a fourth palette.

## Where the source of truth is right now

```
packages/tokens/tokens/*.json        ← hand-authored DTCG JSON (color, color.dark, font, size)
        │  Style Dictionary v5, deterministic, no timestamps
        ▼
sites/_shared/assets/tokens.css      ← the ONE committed output
```

`packages/tokens/README.md` is explicit about the shape of the gap, in its own
words: there is *"no `build/` directory and no Dart output"*, and **"Changing a
token here cannot affect the Flutter apps."** A design-token package with no
Dart emitter, in a portfolio whose products are Flutter apps, is a source of
truth for one of three runtimes.

The CSS is checked against drift by `ci.yml`'s `tokens` lane — delete the
artefact, rebuild, `git diff --exit-code` — which works precisely because the
build is deterministic.

## Why the move is not made in this change

Moving `tokens/*.json` under `contracts/` means re-pointing the Style Dictionary
config, the `tokens` CI lane and the drift check in one change. That is a change
to `packages/`, `.github/workflows/ci.yml` and `tooling/` — three areas owned by
other work in flight at the time this directory was created, and a token move
smuggled inside a 542-file repository merge is a change nobody reviews.

## The intended move, written down so it is not re-derived

1. `git mv packages/tokens/tokens contracts/tokens/dtcg` — the DTCG JSON becomes
   the shared artefact; `packages/tokens` keeps the **emitter**, which is where
   the Style Dictionary dependency belongs.
2. Re-point the Style Dictionary `source` glob at `contracts/tokens/dtcg/*.json`.
3. Keep the single committed output at `sites/_shared/assets/tokens.css` and the
   existing delete-rebuild-diff drift check unchanged.
4. **Add the two emitters the move exists to make possible:**
   - a Dart emitter, so a token change can reach the apps at all — today it
     provably cannot;
   - a JS/JSON emitter for `extensions/`, whose one hard-coded palette lives in
     `sites/nikatru/fullshot/privacy.html`'s `:root` block with a comment
     already begging the reader not to edit it there.
5. Only then delete this file, and say in the commit which runtimes a token
   change now reaches.

🔴 **Step 4 is the point of the move, not a follow-up to it.** Relocating JSON
from one directory to another buys nothing on its own; what buys something is
one source with three emitters. If step 4 is not being done, do not do steps 1–3
either — a `contracts/tokens/` holding files nothing new reads would be the same
package with a better address.
