---
title: Fix missing images or repeated headers
summary: Lazy images, sticky headers, pop-ups and inner scroll areas each have an option.
platforms: [chrome, edge, firefox]
minVersion: 1.10.0
updated: 2026-10-03
gate:
  - ext:Full_Screen_Shot:optionsHideFixed
  - ext:Full_Screen_Shot:optionsPreScroll
asked:
  - Why is the header repeated in my screenshot?
  - Why are some images blank or black?
  - How do I remove the cookie banner from the screenshot?
  - The screenshot is cut off inside a scrolling panel
  - Why is my capture missing content further down?
---
Open **Options**, under **Capture**:

- **Hide fixed & sticky elements** — stops headers repeating on every screen.
- **Pre-scroll to load lazy content** and **Wait for images to decode** — for blank or black images.
- **Hide banners & pop-ups** — removes cookie banners and newsletter pop-ups first.
- **Expand scrollable content** — grows inner panels and frames to their full content.
- **Click "load more" buttons** and **Scroll to load infinite feeds** — for feeds.
- **Extra delay per step** — raise it for slow, animated pages.
