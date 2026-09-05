# FullShot — Full Page Screen Capture

A complete, GoFullPage-style Chrome extension (Manifest V3). No external libraries, no build step, no special permissions beyond `activeTab`.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome (or Edge/Brave: `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`Tools_Full_Screen_Shot`).
4. Pin the FullShot icon to your toolbar. Done.

## Features

**Capture modes** (popup or shortcuts)
- **Full page** — scrolls the whole page and stitches every screen into one image. `Alt+Shift+P`
- **Visible area** — just the current viewport. `Alt+Shift+V`
- **Selected region** — drag a rectangle on the page (`Esc` cancels).
- **Element** — hover to highlight any element on the page, click to capture exactly it.
- **Delayed capture** — 3/5/10-second countdown (shown on the toolbar badge) before a full-page capture, for menus and hover states.

**Smart capture engine**
- Pixel-perfect, seam-free stitching at any display scaling (100% / 125% / 150% / browser zoom) — fractional device-pixel offsets are aligned so no gap lines appear between frames.
- **App-shell pages captured properly (v1.3.0)**: when the document itself doesn't scroll and the content lives in an internal pane (Gmail, ChatGPT, dashboards), FullShot finds the dominant scroller — even when the document scrolls a token amount around it — scrolls the pane, crops every frame to the pane's on-screen rectangle, and unrolls it to its full content height in the output. The app shell (header, side rails, footer) appears exactly once, right where you saw it.
- **Side rails unrolled (v1.4.0)**: on app-shell pages the shell's own rails (left nav, chat list) get a dedicated scroll pass after the main pane — each rail is unrolled from its top down its own column, so the content hidden behind the rail's inner fold is in the shot and the blank void that used to sit under a pinned rail is gone. The canvas never grows past the main story; rails are restored to exactly where you left them.
- **Fixed side rails unrolled on normal pages too (v1.5.0)**: pages that scroll the document but pin a fixed nav rail to the edge (Reddit-style) get the same rail treatment — the rail is temporarily revealed (fixed furniture is normally hidden after frame 1), scrolled through its full content (which also triggers lazy-rendered items), unrolled down its column, and restored to the exact scroll you left. Rail-shaped, edge-anchored scrollers only; centered fixed overlays still appear once, as seen. Viewport-anchored furniture inside the rail's wrapper (collapse toggles, edge buttons) is frozen after the rail's first frame (v1.5.1), so it appears exactly once instead of repeating in every unrolled band.
- **Splits at real section boundaries (v1.5.0)**: the capturer reports semantic break hints — the tops of feed cards, articles, and sections, detected from DOM rhythm — and multi-part boundaries and flowed-PDF page breaks cut exactly at a section top: the next post starts the next page, never mid-image. Since v1.5.1 the cut lands on the top of the whole card *group* — attached lead-ins (recommendation context bars, "suggested for you" eyebrows, thin dividers) move to the new page with their card instead of being orphaned, and elements *inside* a card (gallery images, title wrappers) never produce cuts. Pixel-quiet-row snapping remains the fallback when no hint is in range.
- **Wide content merged right (v1.4.0)**: panes that scroll sideways are captured in full width. A board/spreadsheet pane that is itself the dominant scroller is scrolled column by column and stitched rightward; wide tables and code blocks inside a page are widened to their full content and the page's extra columns are captured — nothing is lost off the right edge.
- Inner scrollable panels (nav drawers, chat lists) on document-scrolling pages are pinned to the exact scroll state you saw when you clicked capture — page scripts can't shift them mid-capture.
- **Expand scrollable content** (ON by default since v1.3.0): grows inner panels, textareas, and iframes to their full content height so nothing stays hidden below an inner fold. Same-site iframes work out of the box; frames from other sites ask once for an optional "read all websites" permission (decline and they're simply captured as seen). Everything is restored after the capture.
- Fixed headers/footers appear once instead of repeating on every screen; sticky elements are neutralized into normal flow (v1.3.0) so mid-page sticky section headers show up exactly once at their natural spot — no repeats, no blank bands (toggleable).
- Shadow-DOM aware: sticky bars, scroll panels, and iframes inside open shadow roots (Reddit-, YouTube-style web-component apps) are detected by every part of the engine — fixed-element hiding, scroll pinning, expansion, and scrollbar hiding all walk the composed tree.
- Hides scrollbars, pauses CSS animations/transitions, disables smooth scrolling and scroll anchoring during capture, restores everything after.
- **Scroll-snap neutralized + fonts settled (v1.5.2)**: CSS scroll-snap is switched off during capture so snap-paginated pages can't skip or duplicate sections, and the engine waits for `document.fonts.ready` (timeout-guarded) before measuring so late web-font reflow never opens a seam — both restored to normal after.
- **Virtualized (render-window) lists handled (v1.6.0)**: modern feeds and big tables (react-window, TanStack, react-virtualized) render only a small window of rows and give the scrollbar its range with a tall empty spacer. FullShot detects these render-window scrollers and never tries to "expand" them — so they no longer balloon the page or leave a giant blank band. A virtualized feed that *is* the main scroller is captured window-by-window as the engine steps it; embedded virtualized lists are captured exactly as rendered, with the rest of the page kept intact.
- Optional pre-scroll pass to trigger lazy-loaded images.
- Respects Chrome's screenshot rate limit with automatic retry.
- Pages too large for one canvas are automatically split into parts, each downloadable separately — part boundaries prefer semantic section tops (v1.5.0), then snap to the middle of visually quiet gaps (v1.4.0), so Part 2 never starts mid-line or mid-image.
- Height safety cap for infinite-scroll feeds (configurable).

**Result page**
- Download as PNG, JPEG, or WebP, drag the image straight to your desktop, or copy to clipboard (auto-fits huge copies to the 25MP Google Docs paste limit).
- **PDF export**: one page at exact image size, or flowed across A4/Letter/Legal pages (portrait/landscape), with optional URL + date stamp in the footer.
- **Smart page splitting** (free — competitors charge for this): page breaks land on section tops when the page reports them (v1.5.0), else snap to visual gaps — lines of text are never cut in half.
- Auto-download and auto-open-editor workflow options.

**Editor**
- Crop (lossless — undo restores the full image), pen, highlighter, line, arrow, rectangle, ellipse, text, pixelate/blur, numbered step badges (①②③ — auto-increment), 24 emoji stamps.
- Select tool to move or delete annotations, 8-color palette + custom color, 3 stroke widths, 4 text sizes.
- Undo/redo with step counters (Ctrl+Z / Ctrl+Y), tool hotkeys (V, C, P, H, L, A, R, O, T, B, N, E), zoom −/+ (25–400%) with fit toggle, keyboard-shortcut reference in the ⋮ menu.
- Save back to history, or export PNG/JPEG/WebP/PDF/clipboard.

**Privacy**
- **Auto-redact sensitive info** (opt-in): detects emails, phone numbers, credit-card numbers, SSNs and API keys in the page and bakes a solid opaque block over each in the saved image — fully local, nothing uploaded. Solid (not blur), so it can’t be reversed. Full-page (document-scroll) captures.

**Beautify**
- Turn any capture into a share-ready image: solid or gradient background, padding, rounded corners, drop shadow, optional macOS window frame, and size presets (Auto, Open Graph 1200×630, square, portrait, 16:9). Export PNG/JPEG/WebP or copy. Opens from the result page (**✨ Beautify**). Fully local.

**History**
- Every capture saved locally (IndexedDB), with thumbnails, instant search across titles and URLs, links back to the source page, batch download and batch delete.

**Options**
- Image format (PNG/JPEG/WebP) & quality, filename template (`{domain} {title} {date} {time} {width} {height}`), per-step capture delay, fixed-element handling, pre-scroll, expand scrollable content, max page height, PDF defaults + smart splitting, download subfolder & save-as dialog, clipboard fit limit, auto-redact sensitive info, light/dark/system theme.

## Project layout

```
manifest.json          MV3 manifest
background.js          Service worker: capture orchestration, rate limiting, badge, shortcuts
content/capture.js     Scroll & stitch driver (scroll root detection, fixed elements, lazy load)
content/frame-expand.js Per-frame helper for expand mode (panel growth, height reporting)
content/region.js      Drag-to-select overlay
popup/                 Toolbar popup (mode picker)
pages/db.js            IndexedDB helper (frames, in-flight captures, saved shots)
pages/common.*         Shared theme, settings, filename, download utilities
pages/pdf.js           Dependency-free PDF writer (JPEG/DCTDecode pass-through)
pages/result.*         Stitching, splitting, viewing, exporting
pages/editor.*         Annotation editor
pages/history.*        Saved screenshot gallery
pages/options.*        Settings page
icons/                 Toolbar icons
```

## How full-page capture works

1. The background worker injects `content/capture.js` (allowed by `activeTab` — granted when you click the icon or press the shortcut).
2. The content script finds what actually scrolls — the document, or the dominant internal pane on app-shell pages (compared by scrollable range on BOTH axes since v1.4.0, so a token 50px of document scroll never hides a 10,000px inner feed, and a sideways-only board pane can win too) — hides scrollbars, computes a grid of scroll positions (vertical *and* horizontal), and steps through them, recording semantic break hints (tops of cards/sections) for the stitcher along the way. Qualifying side rails then get their own scroll pass — in-flow rails on app-shell pages, and fixed edge-anchored rails on document-scrolling pages (temporarily revealed while their column is captured) — with frames tagged per rail.
3. At each stop it asks the background worker for a `captureVisibleTab` frame (throttled to Chrome's 2-per-second quota). Frames go into IndexedDB.
4. After the first frame, fixed elements are hidden and sticky elements are neutralized to normal flow, so neither repeats and nothing leaves a blank band.
5. The result page decodes the frames and places each at its true scroll offset on a canvas (split into parts if beyond canvas limits — part boundaries cut at the largest semantic section top in range, falling back to the middle of the bottom-most quiet gap). For internal-pane captures each frame is cropped to the pane's viewport rectangle and the pane's slot is unrolled to full content height, with the surrounding chrome kept in place (top chrome up top, bottom chrome moved below the unrolled pane); side-rail frames are cropped to each rail's rectangle and unrolled down the rail's column, clipped to the main story's height. The finished shot is saved and raw frames are cleaned up.

## Testing

```
node test/sim-torture.node.js   # engine-vs-fake-DOM simulator, 3 modes, 78 checks
node test/pixel-sim/run.js      # pixel simulator: REAL capture.js + REAL result.js
                                # stitching → PNGs in test/pixel-sim/out/, 8 scenarios
                                # / 161 checks (app shell ×3 incl. 125% DPR with side-rail
                                #  unroll, doc scroll, multi-part smart split, wide-table
                                #  horizontal merge, Reddit-like fixed rail + card-group
                                #  hint split + collapse-button freeze, and virtualized
                                #  render-window list detection)
```

Real-browser suite (loads the actual extension into Playwright Chromium, captures
`test/appshell.html` + `test/torture.html`, checks pixels and the pages' own
scoreboards): see `test/e2e/README.md`. This suite is green — 14/14 on real Chromium.
The two torture pages can also be opened manually in Chrome — they grade the capture
themselves on screen.

## Known limitations

- Browser-internal pages (`chrome://…`), the Chrome Web Store, and some DRM-protected content cannot be captured — Chrome blocks all extensions there, including GoFullPage.
- Cross-origin iframes are captured as rendered unless **Expand scrollable content** is on and the optional permission is granted.
- Expansion can't help virtualized lists (they only render what's near the visible area — expanded space may show blanks) or panels inside fixed sidebars (clipped to the viewport by definition). Expansion grows panels down *and* right (v1.4.0); the main pane on app-shell pages is deliberately *scrolled*, not expanded, so virtualized feeds still render every screenful.
- Side rails are unrolled from their top down their column and clipped to the main story's height: a rail longer than the story is cut at the canvas bottom, a shorter one leaves white below its last row. In-flow rails are unrolled on app-shell captures (v1.4.0); fixed edge-anchored rails are unrolled on document captures too (v1.5.0). Fixed elements that are *not* rail-shaped (centered overlays, FABs) still appear once, as seen. Virtualized rails that only render near the visible fold may show blanks in the expanded region — the scroll pass helps only rails that report a real scroll range. If a pane's bottom edge is cut off by the window, the few rows that can never be shown on screen are excluded rather than left as a white void.
- Horizontal capture is capped at 20,000 css px of width; output wider than the 16,000px canvas edge is scaled down to fit (height is split into parts instead — width cannot be).
- Closed shadow roots are invisible to all extensions — content inside them is captured as rendered but can't be expanded or pinned.
- Very long pages are intentionally split into parts (Chrome canvas size limit); each part downloads separately and PDF export still flows them into one document.
- Keyboard shortcuts can be remapped at `chrome://extensions/shortcuts`.
