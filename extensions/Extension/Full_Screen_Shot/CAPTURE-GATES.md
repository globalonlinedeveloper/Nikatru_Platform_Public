# FullShot — Capture Gate Matrix
*The map of "hard cases" a full-page capture engine meets across the web, and how FullShot handles each. Every ✅ row names the sim scenario that asserts it in the Sim column, and `test/pixel-sim/run.node.js` fails when one does not. The session history this line used to carry is git history.*

## The honest answer

You asked: *the scroll gate was one hard case — what other gates come on every website, and will our tool intelligently handle them?*

Three truths:

1. **The gates are finite and knowable.** The gates below are the ones this record holds, and a ✅ is only as good as the scenario named beside it.
2. **FullShot handles the ✅ rows below, and each one names the scenario that asserts it** (scroll architecture, rails, sticky/fixed furniture, horizontal, semantic splits, DPI seams, shadow DOM).
3. **A handful of gates are genuine open work, and a few are hard browser limits nobody can beat** (closed shadow DOM, `chrome://`, DRM). Honesty about these is part of the product — we say "captured as rendered" instead of pretending.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Handled intelligently today — asserted by the sims |
| ◑ | Partial — works in common cases, known edges remain |
| ✗ | Open gap — not handled yet, but addressable (plan below) |
| ⛔ | Hard browser limit — no extension can beat it |

---

## Family 1 — Scroll architecture (what actually scrolls)

| Gate | Status | Handling / plan | Sim |
|---|---|---|---|
| Classic document scroll | ✅ | Baseline; grid of scroll stops, stitched at true offsets. | docscroll |
| App-shell inner-pane scroll (Gmail, ChatGPT, dashboards) | ✅ | Dominant-scroller detection by scrollable range on both axes (v1.3.0); pane cropped per frame, unrolled to full height, chrome kept once. | appshell, appshell-banner, appshell-dpr125 |
| Fixed edge-anchored side rails (Reddit nav) | ✅ | Rail revealed, scrolled through its full content, unrolled down its column, restored (v1.5.0/1.5.1). | redditlike |
| Horizontal scroll (boards, wide tables, Trello) | ✅ | Sideways-only panes can win the scroller vote; stitched "merged right" (v1.4.0). v1.6.3: merged-right fires only for a **single dominant** sideways scroller — a page with a *wall of carousels* (Amazon homepage) is captured as-seen instead of ballooning into a broken wide grid. | docwide |
| Nested / multiple independent scrollers | ◑ | Dominant scroller wins; other inner panels are *pinned* to as-seen state. **v1.6.3** stops the Amazon-style failure where many independent *horizontal* carousels were all widened and ballooned the page into a broken diagonal-striped wide grid — 2+ independent sideways scrollers are now left as-seen. Deep multi-unroll of many scrollers (each stepped to full content) is still future work → **plan:** generalize the side-pass loop to an ordered list of qualifying sub-scrollers. | — |
| Bi-directional giant canvas/board (both axes huge) | ◑ | One axis unrolled, the other stitched; a truly 2-D infinite canvas (Figma/Miro) is bounded by canvas limits. | — |
| CSS scroll-snap / paginated full-screen sections | ✅ | v1.5.2: capture CSS sets `scroll-snap-type:none !important` on all elements (page + shadow roots), removed after → snapping can't skip/duplicate sections. Engine sim asserts it. | test/sim-torture.node.js |

## Family 2 — Lazy & dynamic content (does it exist when we look?)

| Gate | Status | Handling / plan | Sim |
|---|---|---|---|
| Lazy images (`loading=lazy`, IntersectionObserver) | ✅ | Optional pre-scroll pass + the stepped scroll itself trips them in; **v1.6.4** decodes any not-complete `<img>` in view before each frame is grabbed (`img.decode()`, bounded) so a late image is never captured black/blank. | lateimage |
| Virtualized lists (react-window / TanStack / recycled rows) | ◑ | **The single biggest gate on modern apps (X, Slack, big tables).** v1.6.0 **detects render-window scrollers** (`isVirtualized`: a tall empty "sizer" spacer + a handful of absolutely-positioned recycled rows covering a fraction of the range, node-count capped) and **never expands them** — so they no longer balloon the page or leave a blank spacer band. A *dominant* virtualized feed is captured correctly by the stepped grid (root is never grown); *embedded* virtual lists are captured as-rendered (their current window) with the page kept compact. v1.6.1 adds an **opt-in inline unroll** (`unrollVirtual`): the engine steps an embedded mid-page list window-by-window and the stitcher injects the windows at the panel's slot, growing the page there (mid-page vertical injection) so the full content lands inline. Sims: **`virtuallist`** (compact as-rendered, v1.6.0) + **`virtualunroll`** (full inline unroll, v1.6.1), both green. **v1.9.9** composes the inline unroll with **fixed side rails** — a rail draws as an independent column (its own frames, clipped to canvas height, painted last), so the over-conservative `!sideDraw` guard was lifted; sim **`railinline`** (a doc with both a fixed rail and an embedded virtual list, both unrolled). **v1.9.10** composes the inline unroll with an **app-shell pane** — the capture-side `root.isDoc` gate and the stitcher `!pane` gate were both lifted so a list embedded INSIDE a pane unrolls composed with the pane's own unroll (the slot lives in pane-content space, pane frames draw region-clipped + shifted by the growth, the pane's bottom chrome moves down by it); sim **`paneinline`** (an app-shell pane holding an embedded virtual list with a deep sentinel + article/bottom below it, a tall pane tail keeping the pane the scroll root so the list stays an inline slot). **All three named inline-unroll edges are now CLOSED** (`railinline` alongside a fixed rail, `tallunroll` crossing a canvas split, `paneinline` inside an app-shell pane). **Session 19 lock-in `paneinlinerail`:** a pane-embedded inline list BESIDE a fixed rail, with auto-redaction, composes across all three coordinate frames with NO code change — the rail draws as its own independent column and bakes via `sideDraw`, never touching the pane's inline growth; probed all-pass against the shipped stitcher then teeth-proven ×3 (extension byte-unchanged). | — |
| Virtualized *rails* (render only near the fold) | ◑ | Fixed render-window rails are already unrolled correctly by the stepped side pass (they are never expanded — the pass steps the scroller and each window renders). v1.6.0 detection additionally stops non-fixed virtualized rails from being ballooned by expansion. A pure render-window rail taller than the story is still clipped to story height (shared rail known-gap). | — |
| Interaction-gated content (accordions, tabs, "load more", "read more", `<details>`) | ✅ | v1.6.2 opt-in "expand everything" pass (`expandInteractive`): opens collapsed `<details>`, reveals `role=tabpanel` / `aria-hidden` / `[hidden]` panels and `[aria-expanded=false]` disclosures before capture, then restores every attribute + style byte-identically. Sim: **`interactive`** (green). **v1.6.11** adds the opt-in `loadMore` click-loop for **network "load more"/"show more"** buttons (content the app only appends on click): finds a tight-matched button (`<button>`/`[role=button]`/non-navigating `<a>`), clicks it, waits for the page to grow, and repeats until the feed is exhausted / the button is gone / a hard cap (20 clicks or `maxPageHeight`). Appended content is **left in place** (honest boundary — can't be un-fetched; the loop mutates no styles/attributes itself, so leave-no-trace still holds). Sims: **`loadmore`** pixel-sim + `loadmore-e2e.html`. **v1.6.12** adds the sibling opt-in `infiniteScroll` for **no-button** feeds that append the next page automatically on scroll (IntersectionObserver / scroll handler): the engine scrolls to the bottom and waits for the append, repeatedly, until the feed stops growing — bounded (two dead rounds / `maxPageHeight` / 30 rounds) so an endless feed isn't chased. Sims: **`infinitescroll`** pixel-sim (doc) + **`paneinfinite`** pixel-sim (the same no-button feed inside an **app-shell pane** — the engine grows `root.el` before measuring and the stitcher unrolls the pane, shell chrome kept) + `infinitescroll-e2e.html`. **v1.6.12 (test-only lock-in):** a "load more" *button* inside an app-shell pane is now covered too by the **`paneloadmore`** sim — `clickLoadMore` already drives `root.el` and `findLoadMoreButton` walks the composed tree, so it greened with **no engine change**. Every button/scroll × doc/pane append combo now has a scenario. | interactive, loadmore |
| Skeleton loaders / late network content slower than the step delay | ✅ | Per-step delay is configurable; **v1.6.4** adds adaptive `img.decode()` settle before each frame (default on). **v1.6.5** adds an adaptive bottom re-measure — a lazy "mega-footer" (Amazon's AbeBooks/AWS/… grid, which only renders when scrolled near the bottom) no longer truncates the capture: the engine jumps to the bottom once, re-measures, and extends (bounded to footer-sized growth so infinite feeds aren't chased). **v1.6.13** adds the opt-in `waitStable` DOM-stability pass: before measuring, it waits while `aria-busy`/skeleton/shimmer markers are present and until the page height is stable (bounded 3s cap), so a skeleton→data swap is captured as the settled real content, not grey placeholders — pure read-only, leave-no-trace. Sim: **`skeleton`** (872px skeleton → 2672px real) + `skeleton-e2e.html`. | skeleton, lazyfooter |
| Web-font late load causing reflow mid-capture (FOUT/FOIT) | ✅ | v1.5.2: `await document.fonts.ready`, raced with a 1500 ms cap, before measuring & stepping → text settled, no font-reflow seam; a font that never settles cannot hang the capture. | latefont, neverfont |
| Responsive `srcset` swapping image on resize/scroll | ◑ | Rare seam risk; mitigated by not resizing the viewport during capture. | — |

## Family 3 — Layout & positioning (does it stay put?)

| Gate | Status | Handling / plan | Sim |
|---|---|---|---|
| Fixed headers / footers | ✅ | Hidden after frame 1 → appear exactly once. | appshell, docscroll |
| `position: sticky` mid-page section headers | ✅ | Neutralized into normal flow (v1.3.0) — once, no blank band. | docscroll |
| Sticky/viewport-anchored furniture *inside* a scroller/rail (collapse toggles) | ◑ | Rail collapse toggle frozen after the rail's first band (v1.5.1); broader sticky-in-rail furniture is the next increment. | — |
| CSS `transform` / `zoom` / `scale` on page or containers | ✗ | Breaks offset math (element box ≠ painted box). **Plan:** read the computed transform matrix and invert it into the placement math. (Roadmap.) | — |
| Parallax / scroll-linked animation (`scroll-timeline`, JS scroll handlers) | ✗ | Elements move *as* you scroll → ghosting/duplication. **Plan:** neutralize scroll-driven animation the way sticky is neutralized (freeze transforms, disable scroll-timelines) during capture. | — |
| `backdrop-filter` glass headers | ◑ | Captured as rendered; fine once the element is hidden after frame 1. | — |
| RTL / vertical `writing-mode` pages | ◑ | Vertical stitch is axis-correct; confirm horizontal-merge origin flips for RTL → **plan:** add an RTL sim scenario. | — |

## Family 4 — Overlays & scroll-lock (can we even scroll?)

| Gate | Status | Handling / plan | Sim |
|---|---|---|---|
| Cookie/GDPR consent banners, newsletter modals, "get the app" interstitials | ✅ | v1.6.6 opt-in "hide distractions" pass (`hideOverlays`): known consent-framework selectors (OneTrust/Usercentrics/Cookiebot/Didomi/cc-window…), `role=dialog`/`aria-modal` overlays, and fixed high-z full-cover interstitials are hidden before capture and restored after. Sim: **`overlay`** (green). | overlay |
| Scroll-locking modal (`body{overflow:hidden}` / `position:fixed`) | ✅ | v1.6.6 `hideOverlays` neutralizes the lock (html/body `overflow:hidden`/`position:fixed` → static/visible) BEFORE the scroll root is chosen, so the full page captures instead of one screen. Restored after. Asserted by the `overlay` sim (720px locked → 2272px full). | overlay |
| Persistent chat widgets / floating FABs (Intercom, etc.) | ◑ | Centered/corner fixed overlays already appear once (not per frame); "hide distractions" would remove them entirely. | — |

## Family 5 — Rendering tech (can the pixels be read?)

| Gate | Status | Handling / plan | Sim |
|---|---|---|---|
| Open shadow DOM (web-component apps: Reddit, YouTube) | ✅ | Every engine pass walks the composed tree — fixed-hiding, pinning, expansion, scrollbar-hiding. | docscroll, shadowcarousel |
| Closed shadow roots | ⛔ | Invisible to all extensions; captured as rendered, can't be expanded/pinned. | — |
| Same-origin iframes | ✅ | Expanded to full content height, restored. | test/sim-torture.node.js |
| Cross-origin iframes | ◑ | Captured as seen unless "Expand scrollable content" + the optional all-sites grant; decline = as rendered. The real-Chromium e2e (which loads a test build with `<all_urls>` static, exercising the cross-origin expansion path) now runs green; the same-origin iframe deep-marker is asserted end-to-end. | — |
| `<canvas>` / WebGL-heavy (maps, charts, Figma, games) | ◑ | Captured as rendered per frame; some GL contexts blank without `preserveDrawingBuffer`. v1.6.4 adaptive-decode helps late-painting *images*, but a hardware-composited GL surface is unreadable by `captureVisibleTab`. **Plan:** optional CDP capture path (`Page.captureScreenshot`). | — |
| `<video>` frames | ◑ | Captured at whatever frame is showing. A hardware-composited video plane reads back **black** via `captureVisibleTab` (Reddit/Amazon video tiles). | — |

**The record ends here.** This file was cut off mid-row at this line (O-CAPTURE-GATES-RECORD-TRUNCATED, 2026-09-25); the row above is cut at its last complete clause and nothing after it is re-typed from memory. A gate missing from these tables is a gate nobody has graded, not a gate FullShot handles.
