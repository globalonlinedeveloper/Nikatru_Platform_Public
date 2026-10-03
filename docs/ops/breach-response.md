# Personal data breach — the 72-hour procedure, and the CERT-In 6-hour report

Rows `O-DPDP-BREACH-72H-PROCEDURE-MISSING` (closes with this procedure; INV-14-43's drill closes at the
lead's first drill) and `O-CERTIN-6H-AND-180D-LOGS` (the route stays the owner's). This file holds **no
incident content and no secret**: it is the procedure. An incident's record lives with the lead, never in
this repository.

Two clocks start when we become aware of an incident that may involve personal data:

| clock | to whom | by when | basis |
|---|---|---|---|
| **6 hours** | CERT-In, `incident@cert-in.org.in` | 6 h from noticing a reportable cyber incident | CERT-In Directions of 28 April 2022 (IT Act s.70B(6)) |
| **without delay**, then the full account within **72 hours** | the Data Protection Board of India | 72 h from becoming aware | DPDP Rules 2025, rule 7(1)–(2) |
| **without delay** | every affected person | as soon as the facts above are known | DPDP Rules 2025, rule 7(1) |

## 1. Detect

The sources that page a person: **GlitchTip** (errors and the heartbeat monitors; Box B), **ops-watch**
(the scheduled workflow's issues), **ntfy** (the `nikatru-page` topic), the **owner page** the platform
Worker mails straight from Cloudflare (services/platform/src/lib/owner-page.ts), and a person's own report
(a problem report, a rights request, an email to support). Whoever sees it first writes the time it was
noticed: **that is the CERT-In clock's start**.

## 2. Contain

Stop the leak before describing it: revoke the credential, turn off the public binding, take the
deployment back, block the route. Write each action and its time into the decision log (§5). Preserve, do
not delete: the boxes keep their ICT logs 180 days, minimised (`docs/ops/boxes/ict-log-retention.sh`), and
the Workers' logs and D1's time travel cover the Cloudflare side.

## 3. Assess

Is personal data involved, whose, how much, since when, and what could follow for the people affected?
`tooling/legal/data-inventory.json` says what each store holds and the itemised notice says why. If no
personal data is involved, the DPDP clock does not run; the CERT-In clock may still (the Directions' list
of reportable incident types).

## 4. Draft (within 1 hour of noticing) — nothing is sent by a script

Write the incident record — the shape of `tooling/legal/breach/drill-incident.json`, with `"drill": false`
— and run:

    node tooling/legal/breach-draft.mjs <incident.json> --out <dir>

It drafts `certin-report.md`, `board-intimation.md` and `affected-user-notice.md` from the record and
the entity source (the Grievance Officer, the address, the support mail), and **refuses** (exit 1,
naming the field) while any required field is missing: a half-filled statutory notice reads as complete.
It sends nothing.

- **CERT-In (6 hours).** The owner reads `certin-report.md`, checks its fields against CERT-In's current
  incident form, and **presses Send** from the support mailbox. Which mailbox and who signs is the owner's
  ruling (`O-CERTIN-6H-AND-180D-LOGS` stays owner-gated).
- **The Board (72 hours).** Send the "without delay" part as soon as the breach is confirmed; the full
  intimation (`board-intimation.md`) by the 72-hour mark the draft prints, through the Board's channel.
- **Each affected person.** `affected-user-notice.md`, to each person, through the mail port's
  transactional stream; fill in the date sent in the Board intimation.

## 5. The decision log

Every decision — breach or not, who is affected, what was contained, what was sent and when — goes into the
record's `decisions[]` with its time and who made it. The Board intimation prints it.

## 6. Drill (fake data)

    node tooling/legal/breach-draft.mjs --drill

drafts all three documents from the fake record, each marked **DRILL — FAKE DATA. NOT FOR SENDING.**
`tooling/ci/test/breach-draft.test.mjs` holds that every required field lands and that a missing one stops
the run. The lead runs the drill once and records `lastDrill` (INV-14-43); repeat it whenever this file or
the script changes.

## 7. The 180-day ICT logs (CERT-In)

`docs/ops/boxes/ict-log-retention.sh` runs daily on Box B and Box C (Mumbai) and keeps the last day of each
container's log **minimised** — no network address, no email address, no account id — for 180 days, then
deletes it. It FAILS (and withholds its heartbeat) on a container it cannot find, on an address that
survived minimisation, on no fresh archive, and on any archive older than 180 days still present. The
duties are `duty.ict-log-retention-boxb` and `duty.ict-log-retention-boxc` in `tooling/ops/register.json`.
