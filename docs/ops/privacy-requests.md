# Privacy rights requests — how a DPDP request is received, answered and closed

Row `O-DPDP-RIGHTS-INTAKE-UNBUILT` (lane dpdp-rights). This file holds **no request content** and
never will: it is the procedure. Requests live in the private intake (the platform Worker,
table `privacy_requests` in platform_db), never in this repository.

## What arrives, and from where

A person asks through **"Your privacy rights"** — in every app (Settings › Privacy and data) and on
the web at `nikatru.com/privacy-rights`. Both post to the platform Worker's `POST /v1/feedback` with
`kind: "privacy-request"` (the site through its same-origin `/api/report` Pages Function). The
types are the rights the notice names (privacy.html §9):

| type | what it asks for | how it is answered |
|---|---|---|
| `access` | a copy of what we hold | signed in: the app downloads it at once from `GET /v1/account/export`; the request records that it was asked. Signed out: by hand, below |
| `correction` | a fix to something we hold | by hand, from what the person wrote |
| `erasure` | deletion | signed in: the app's own **Delete account** (the derived erasure); signed out: by hand, below |
| `nomination` | name or change the nominee | the app's nominee form (`PUT /v1/account/nominee`); a request is filed only from the web |
| `grievance` | a complaint | by the Grievance Officer (the contact page), inside 30 days and never past the statutory 90 |
| `withdraw-consent` | stop a consent-based processing | the app's own switch does it at once; a request is the written record |

## Identity — the session, or a proven address

A signed-in request is identified by its verified session; nothing new is collected. A signed-out
request (for example from a launch-list sign-up) names an address and is held `unverified` until the
person follows the one-time link mailed to it; with no address it is refused (`proof_required`).
An unproven request is deleted after 7 days. **Never act on an unverified request.**

## The clocks

From the moment a request is verified: **acknowledge within 48 hours, resolve within 30 days**, and a
grievance is never past the statutory **90 days**. The platform Worker's nightly `privacy` limb
(services/platform/src/feedback/cron.ts) grades every open request; one past a deadline turns its
heartbeat row red and **pages the owner** through the owner-page path, once a day while it stays red.
A request is amber from 3 days before its 30-day deadline.

## Moving a request

Only a person closes a rights request. The triage routine never sees `privacy_requests` and the cron
never moves one. The lead moves it with the same tool reports use:

    node tooling/feedback/move.mjs PR-XXXXXXXXXX acknowledged
    node tooling/feedback/move.mjs PR-XXXXXXXXXX resolved      # or: refused

`new -> acknowledged -> resolved | refused`; anything else is refused by the Worker. A closed request
is kept 400 days as the evidence it was answered, then purged.

## Stores no code can address for a person (`export.by: manual` in tooling/legal/data-inventory.json)

Answer these by hand, from the inventory row's `reason`, and say so in the reply:

- **Launch-list sign-up** (`platform_db.signups`) — keyed by the proven address; send the one row.
- **Unattributed payments** (`platform_db.unclaimed_payments`) — only on a question about a payment;
  the address is held as a digest, so match the digest of the proven address and send that row alone.
- **Report screenshots** (`r2:nikatru-feedback`) — the exported report rows name each screenshot's
  key; send those objects.
- **The signed-out-session list** (`SESSION_REVOKED` KV) — the account's own sign-out times.
- **The sign-up rate-limit counter** (`SIGNUPS` KV) — nothing in it can be found for a person; say so.

## The nominee (DPDP Act s.14)

A person names one nominee (a name and an address) in the app. The nominee is told nothing until
they act. A nominee who writes in is asked for evidence of the death or incapacity; on it, the lead
answers the nominee's request as the account holder's, under the clocks above, and records that in
the request's history. Deleting the account deletes the nomination.

## The Data Protection Board

A person whose grievance we do not resolve may complain to the Data Protection Board of India. The
notice says so (§9 "How to complain"); every grievance reply repeats it.
