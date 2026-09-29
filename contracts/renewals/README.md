# `contracts/renewals/`

The renewal rule — "given a charge date and a cadence, when is the next one" —
as data that two runtimes are tested against.

| File | What it is | Who reads it |
|---|---|---|
| `vectors.json` | **the authored examples**: `advance` (one step) and `rollForward` (a past-due date rolled to today-or-later, with the charges it crossed) | `services/platform/test/renewals.test.ts` and `packages/core/test/recurrence_schedule_test.dart`, each iterating EVERY vector |
| `vectors.schema.json` | JSON Schema (2020-12) for `vectors.json` | documentation of the shape today — NO guard grades the file against it yet; what fails loudly on a malformed vector is each suite's coverage floor and its per-vector parse |

## Why vectors and not a generator

There are two implementations of the rule and there have to be: the platform
Worker's nightly fan-out (`services/platform/src/renewals.ts`) rolls
`next_renewal` and writes `payment_history` for every app database, and every
app shows due labels and a derived next renewal from
`packages/core/lib/src/dates/recurrence_schedule.dart` (`RecurrenceSchedule`),
offline and in seed mode where no Worker runs. A TypeScript function cannot be
called from Dart, so the thing that is shared is the ANSWERS: a vector edited
here reds whichever suite's implementation disagrees. The red control is to flip
one `to`/`expectNext` date — both suites go red.

## The rule

- Cadence is `(every, unit)`, `unit` ∈ `day | week | month | year`, `every` 1..366
  (the bound `services/subscriptiontracker-api` validates).
- `day`/`week` add `every` / `7·every` calendar days in UTC.
- `month`/`year` add `every` months / years and CLAMP to the month's last day,
  returning to `anchorDay` when a later month has it (Jan 31 → Feb 28 → Mar 31).
- `rollForward` crosses every date strictly before `today` (a charge due today
  has not happened yet), at most 240 crossings per call.
- The legacy `cycle` column maps `monthly` → (1, month) and `yearly` → (1, year).
