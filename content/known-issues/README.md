# Known issues

One file per confirmed, public problem: `<slug>.md`. The help centre renders them (lane
help-search); when this directory holds none, it says "No known issues".

The feedback triage routine PROPOSES an entry from reports; the lead opens it as a normal PR. A
known issue is a public page, so it carries no personal data — `tooling/ci/assert-known-issues.mjs`
refuses an e-mail address, a report id, any quoted report text (a blockquote or a fenced block), a
phone- or card-like run of digits, and a link off nikatru.com. The procedure is
`docs/ops/feedback-triage.md`.

```
---
title: Short title of the problem
apps: [subscriptiontracker]
versions: 1.4.0 to 1.4.2
status: open            # or: fixed, with fixedIn
fixedIn: 1.4.3
updated: 2026-10-03
---
What happens, in plain words, and what a person can do until the fix ships.
```
