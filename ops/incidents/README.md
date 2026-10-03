# Incidents

One file per incident: `ops/incidents/<YYYY-MM-DD>-<slug>.md`, written by a person after (or
during) an outage. `tooling/status/build-status.mjs` renders them, newest first, as the history on
https://status.nikatru.com and as its Atom feed (`/feed.xml`).

```
---
title: Sign-in was unavailable
started: 2026-10-05T09:12:00Z
resolved: 2026-10-05T09:40:00Z
components: [Sign-in]
impact: major
---
**What broke.** …

**Impact.** …

**Timeline (UTC).**

- 09:12 …
- 09:40 …

**Fix.** …

**Follow-up.** …
```

`tooling/ci/assert-incidents.mjs` holds every file to that shape — `started` and `resolved` are UTC
timestamps, `impact` is `none`, `minor` or `major`, every component is one the status page shows —
and refuses an e-mail address, a phone- or card-like run of digits, or a link off nikatru.com. An
incident is public: it names what broke and what we did, never a person or a user's data.
