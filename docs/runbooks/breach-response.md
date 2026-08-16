# Personal-data breach — the response, with the clock in force

> **[pipeline 14]O-18.** Owned by `tooling/ops/register.json` row `recovery.breach-response`,
> which carries the rehearsal cadence. If the drill date goes stale, `assert-ops-register.mjs`
> says so — that is the only thing keeping this file from becoming a document nobody has read.

## Why this lives in the public repo and not in `Private/`

The same reason the operations register does: **CI cannot read `Private/`**, so a procedure that
lives there is a procedure no mechanism can hold to a cadence. This file contains obligations,
clocks and a sequence — no credentials, no business identifiers, no personal data. The two facts
that *are* owner-private (who files, and from which address) are deliberately **not** written here;
they are declared as an open gap in the register, printed on every CI run.

---

## 🔴 The clock in force is SIX HOURS, not seventy-two

A procedure rehearsed against a 72-hour clock is not a procedure that works at 6. The two
obligations are separate, run concurrently, and only one of them is live today.

| Obligation | Clock | Commencement | Status |
|---|---|---|---|
| CERT-In direction under s.70B(6) of the IT Act, 2000 | **6 hours** from noticing | claimed live since 2022-06-27 | ⚠️ **UNVERIFIED** |
| DPDP Act Rule 7 (intimation to the Board and to affected persons) | **72 hours** | claimed 2027-05-14 | ⚠️ **UNVERIFIED** |

⚠️ **BOTH ROWS ARE UNVERIFIED AND MUST BE READ AS UNVERIFIED.** The CERT-In direction was
corroborated only by secondary legal summaries — the primary PDF would not parse. The DPDP Rule 7
commencement rests on two secondary sources; the gazette text could not be opened. **Do not restate
either as fact, and confirm against the regulator's own published text before this procedure is used
in anger.** They are recorded here because a procedure written against no clock is worse than one
written against an unconfirmed clock; they are not recorded as established law.

The planning consequence, which does not depend on resolving either: **assume the shorter clock.**
Six hours is not enough time to decide who files, from which address, or what the notice says. All
three have to exist before the incident.

---

## Step 0 — Start the clock and write down the time

The clock runs from **noticing**, not from confirming. Record, in the incident issue, the UTC
timestamp of the first signal and what it was. Everything below is measured from that line.

## Step 1 — Contain, without destroying the evidence

Rotate or revoke the credential in the blast radius. **Do not delete logs, rows, or the compromised
artifact** — the filing needs them and so does the post-mortem.

## Step 2 — Determine the notifiable population, from measurement

⚠️ **The stores do not have one answer, and assuming they do is the mistake this section exists to
prevent.** They fall into two groups with genuinely different obligations:

**Pseudonymous — notifiable by public notice, not individually.**
`platform_db.events` and `platform_db.consent_artifacts` carry `anon_id` and `consent_id`. Neither
has an `ip` column. There is no route from a row to a person, so there is nobody to write to.

**Contactable — a specific set of people.**
- **Supabase auth** — email addresses of every account across the portfolio.
- **the `nikatru-signups` KV namespace** — the newsletter signups. ⚠️ **Its population is still
  *everyone who ever signed up*, which is a different and larger set than "current users" — and a
  declared retention period does NOT change that yet.** A period exists as of 2026-08-09 (365 days,
  `SIGNUP_RETENTION_DAYS` in `sites/nikatru/functions/api/subscribe.js`), but Workers KV fixes a
  key's expiry **at write time**: every key written before that date carries no expiry and never
  will. So the set shrinks only for signups taken after 2026-08-09, and only after a year has
  passed. 🔴 **Do not assume the retention period bounds this list.** Enumerate the namespace
  (`wrangler kv key list --binding SIGNUPS`, prefix `sub:`) and count what is actually there —
  ageing the old keys out is an operator action nobody has performed yet.

**And the crash rail is neither.** GlitchTip fills `user.ip_address` **server-side** despite
`sendDefaultPii = false`, so a breach of the telemetry host has a different notifiable population
from a breach of `platform_db`. Do not let one determination cover both. (Carving out or removing
that IP capture belongs to `[11]E-2`/`E-3`, not here.)

## Step 3 — File, inside the clock

⬜ **OWNER-GATED, AND IT IS THE STEP THE CLOCK IS TIGHTEST ON.** Two sentences do not yet exist and
cannot be written by an agent:

1. **Who files the CERT-In report, and from which address.** This is an irreversible statutory filing
   made in the proprietor's name. Deciding it inside a six-hour window, during an incident, is not a
   decision — it is a guess with a signature on it.
2. **What the public notice says** for the pseudonymous stores, and where it is published.

Until both are recorded, this procedure is **incomplete at its most time-critical step**, and
`assert-ops-register.mjs` prints that on every run rather than letting the gap sit in a document.

## Step 4 — Tell the affected people

Only for the contactable population in Step 2. ⚠️ **This factory has no bulk email channel.**
`[4]B-12` owns transactional auth mail and is itself blocked on owner-only credentials, and stage 13
deliberately cut a marketing channel. So the mechanism for reaching newsletter signups **does not
exist today** — that is a fact about the current stack, not a step somebody forgot, and it is
recorded here so it is discovered now rather than at hour four.

## Step 5 — Record the disposition

The incident issue is closed by a person, never automatically. Closing it *is* the statement that
somebody looked, the same rule the ops-watch and E2E alert issues carry.

## Step 6 — Re-date the drill

Update `lastDrill` on `recovery.breach-response` in `tooling/ops/register.json`. A rehearsal that is
not dated is a rehearsal nobody can tell has expired.

---

## Rehearsing this

Rehearse **against the clock in force on the rehearsal date** — today, six hours. The rehearsal is
a tabletop walk of Steps 0–5 against one named store, ending with a written answer to: *what was the
notifiable population, and could we have reached it inside the clock?* If the answer to the second
half is no, that is the finding, and it is the same finding Step 4 predicts.
