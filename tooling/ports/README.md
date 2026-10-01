# Ports and adapters — the standard

Every external capability (payments, auth, telemetry, mail, storage, SQL, the code host, the boxes) is a **port**: an
interface the product speaks, a **registry** that names the adapters behind it and selects one by configuration, a
**conformance suite** any adapter must pass, and a **dry-run switch**. Swapping a vendor is then a registry edit plus
an adapter, rehearsed before it is done, never a rewrite.

This file is normative and stands alone: later trains read the standard from here. The shape is
[`port.schema.json`](port.schema.json); the guard is `tooling/ci/assert-ports.mjs`; the switch rehearsal is
`tooling/ops/port-switch.mjs`. Row `O-NO-PORT-SELECTS-AN-ADAPTER-BY-CONFIG` tracks the trains that close it.

The first subjects, at their honest levels: `tooling/ports/payments.json` (both halves — `RailInbound`, which is
[ADR 004]'s `MoRWebhookVerifier`, and `RailOutbound` — at L3 since port-pay-core), `tooling/ports/auth.json` (Dart
`AuthRepository`) and `tooling/ports/telemetry.json` (Dart `TelemetryClient`), each claiming L2 with target L3; every
other vendor is placed in `tooling/ports/_non-port.json`.

## 1. Levels

| Level | Means | Earned when (assert-ports limb 6) |
|---|---|---|
| **L0** | Hard-coded at call sites. | — |
| **L1** | Centralised, but vendor-shaped. | The registry validates and its `interface` symbols are declared where it says. |
| **L2** | Behind a port (an interface), one adapter, chosen by config; no caller imports an adapter. | L1, plus a `selection` (a `source` or a `default`), at least one built non-fake adapter, limb 4 clean for the port, and no fake selectable in live. |
| **L3** | L2, plus a conformance suite any adapter must pass, at least two conformant adapters (one may be a fake) with zero pending cases, a switch runbook, and a dry-run command. | L2, plus `conformance.suite` whose runner is declared in its file, two or more adapters whose `conformance.file` **calls** that runner and have no `pending` case, a `switch.runbook`, and `tooling/ops/port-switch.mjs` present. |

A claim above the earned level fails the build. The guard prints `port · claimed · earned · target` on every run, so
the distance to target is never hidden.

## 2. The registry, field by field

One file per capability: `tooling/ports/<capability>.json`, validated strictly (`additionalProperties: false`
wherever the shape can hold it).

| Field | Meaning |
|---|---|
| `$schema` | `./port.schema.json`. |
| `port` | The capability; equals the file name. |
| `level.claimed` / `level.target` | 0–3. Claimed is checked against earned; target is where the trains are taking it. |
| `interface.ts` / `interface.dart` | `{file, symbols}` — either or both. Each symbol must be **declared** in the file (comment-stripped). |
| `adapters[].id` | The wire id: the value the selection names and the code keys on. |
| `adapters[].vendor` | A `tooling/capability-register.json` `vendors` key or a `tooling/legal/provider-register.json` `providers` id; `null` only for a fake. |
| `adapters[].status` | `draft` · `built` · `live` · `standby` · `retired` · `fake` · `external`. |
| `adapters[].impl` | `{file, symbol}`; for `external` (e.g. a self-hosted GoTrue configured by env) `{configAt, verify}`. |
| `adapters[].outbound` | Optional `{file, symbol, modules}` — the adapter's outbound half (e.g. `RailOutbound`) and its further private modules. Limb 2 holds the symbol declared; limb 4 protects `file` and every `modules` path exactly as it protects `impl.file`. |
| `adapters[].capabilities` | The port's own verbs (e.g. `verify`, `parse`, `cancel-api`). Capability verbs, never vendor nouns. |
| `adapters[].secrets` | Secret **names** only — rows of `tooling/worker-secrets.json` once it exists, until then members of a Worker's `interface Env`. |
| `adapters[].identity` | Field **paths** into `tooling/house-identity.json` (the entity source) that the vendor account carries. Never the values. |
| `adapters[].environments` | Which of `test`, `sandbox`, `live` it may serve. A fake never lists `live`. |
| `adapters[].cost` | `feeCells` — `tooling/catalog/fee-register.json` cell ids applied per sale; `unit` — `{usd, per, asOf, verify}` or null. |
| `adapters[].conformance` | `{file}` — the adapter's test that **calls** the suite's runner; null until it exists. |
| `adapters[].exportDuty` | What leaves with us, what must be exported, what cannot move. |
| `adapters[].readAt` | `{url, on}` — the vendor page the adapter's facts were read from, and when; null if none was read. |
| `adapters[].c8Seam` | Optional, a **declared, printed** divergence: the vendor's C-8 `seam.file` is not this port's interface. Names the C-8 file exactly, with `why` and `until`. |
| `selection.by` | `single` · `environment` · `stream` · `channel-market` · `per-call`. |
| `selection.source` | `<file>#<pointer>` when another register (or one code site) holds the answer — e.g. `tooling/channel-register.json#purchaseRails`; null when `default` is the whole answer. |
| `selection.default` | `{live, sandbox, test}` adapter ids or null. Null in every slot is honest for a port selected per channel. |
| `selection.canary` | Reserved; null. |
| `generated` | `true` once code reads a **rendered** table instead of a hand array. The render tool is `tooling/ports/render.mjs [--check]` (port-pay-core); assert-ports limb 3 runs its check on every build, so a hand edit of a rendered table fails whether or not `generated` is claimed yet. |
| `handTables[]` | `{file, anchor, until, why}` — a declared, printed waiver for a hand-written table (or a pre-port import) that the port will replace. The anchor must still exist. |
| `conformance.suite` | `{file, runner}` or null. |
| `conformance.pending[]` | `{adapter, case, row}` — a scenario an adapter cannot pass yet. Names its `O-` row, prints on every run, and blocks L3 for that adapter. |
| `switch.runbook` | `Private/runbooks/switch-vendor.md#<port>`. |
| `switch.dryRun` | `node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run`. |
| `_why` | Prose: the honest state and its reasons. |

`tooling/ports/_non-port.json` (`$defs.nonPortRegister`) places every vendor that is **not** an adapter: each row a
`vendor`, the `registers` it is in, a `reason`, and exactly one of `until: <train>` or `nonPort: true`.

### The rules

- **A registry cites other registers and never restates them.** Secrets by name; business facts by entity-source field
  path; the rail per channel from `channel-register.json#purchaseRails`; fees as `fee-register.json` cells.
- **No secret value and no business-fact literal** may appear in a registry (limb 1 refuses vendor key prefixes, JWTs,
  private-key blocks, long high-entropy tokens and e-mail addresses).
- **A `fake` is never in `live`** — neither in its `environments` nor as `selection.default.live`.
- **A `pending` case names its row**, prints on every run, and blocks L3 for that adapter.

## 3. Conventions

### TypeScript ports (Workers)

- The port lives in `services/_shared/src/ports/<port>.ts`: types and pure helpers only, **no vendor import**.
- Capability verbs, never vendor nouns. **Outcomes, never throws across the port:**
  `{ ok: true, ... } | { ok: false, kind: 'refused' | 'unavailable' | 'invalid' | 'timeout', retryable, detail }`.
- Capabilities are declared; secrets are named; **a missing secret fails closed** on money and auth.
- **One composition root per Worker** — `services/<worker>/src/ports.ts`, exporting `portFor(port, env)` — is the only
  module that imports an adapter. Limb 4 walks the import graph of `services/*/src` to hold it (tests are not modules
  of a Worker bundle and may import adapters to test them). Until a port is `generated`, a file named in its
  `handTables` is the declared exception.
- Fakes live in `services/_shared/src/ports/fakes/`.

### Dart ports (apps)

- The seams stay in `packages/core`. Each seam package exports `lib/testing.dart`: the fake plus
  `run<Seam>Conformance`.
- **The client never names a payment vendor.** C-5 (`assert-package-boundaries.mjs`) already refuses an app importing a
  vendor SDK around its adapter; limb 4 is TS-only for that reason.

### Conformance

- A suite is a **scenario list** plus a **per-adapter fixture encoder** (the adapter's own bytes for each scenario).
- **The runner throws when a scenario has no fixture for the adapter under test** — a missing fixture is never a skip.
- Suites run in the existing Worker vitest and melos jobs; no new job.
- The guard matches the runner as a **CALL** in each adapter's test file — not an import, not a bare identifier, and
  never in the file that declares it.

## 4. The switch playbook

Six phases, each with an exit test. `Private/runbooks/switch-vendor.md#<port>` carries the per-port detail.

1. **Decide** — an ADR names the target, the reason and the margin delta (§6). The target is an adapter row.
2. **Build** — the adapter, its conformance fixtures and its registry row (`status: built`); conformance green, no
   `pending` for it.
3. **Dry run** — `node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run` exits 0. It is read-only: target
   row, status, secrets declared, identity present, conformance called with nothing pending, export duty written, a
   standby path, and the per-channel net (§6).
4. **Dual run** — both adapters receive (shadow or canary); the outcomes are compared, the old one still decides.
5. **Cutover** — the selection moves to the target. **Rollback** is one config change: the old adapter is `standby`,
   and a runtime kill switch returns traffic to it without a release.
6. **Retire** — after the run-off window, the old adapter becomes `retired`, its secrets are revoked, its export duty
   is discharged and recorded.

## 5. Export duty

| Capability | What leaves with us | What cannot move | So the switch is |
|---|---|---|---|
| Payments | Our entitlement rows and the verbatim webhook bodies; customer and subscription lists exported for the run-off | **Card and UPI mandates** — they belong to the processor that took them | **RUN-OFF**: new sales on the target, existing subscribers renew on the old rail until they lapse |
| Store billing (via an aggregator) | The aggregator's customer list and user-id mapping | The store subscriptions themselves | Only the aggregator can change, never the store |
| Auth | `auth.users` (ids, emails, identities) — the ids are every row's foreign key and must move unchanged | Password hashes outside a compatible target; live sessions | A re-sign-in at cutover |
| Mail | **The suppression list (bounces, complaints, unsubscribes) MUST move** — sending to it from a new provider is a deliverability and a legal failure | Sender reputation | Warm-up on the target |
| Telemetry | Nothing required (short-retention, PII-scrubbed); the monitor configuration is already ours | — | Repoint the DSN |
| Storage / SQL | Every object and row, by export | — | Copy, verify, cut over |

## 6. The margin rule

- Every adapter carries `cost`: its fee-register cells, or a unit cost with `asOf` and `verify`.
- The dry run prints, for every channel the switch touches, the **net per price** under the current adapter and under
  the target (`fee-register.json` cells × `services/platform/src/app-config-data.json` prices). A missing or
  unapplicable cell is LOST, never a guess.
- **A switch that lowers the net must say why in its ADR.** The dry run says when it does.
- The model applies each adapter's cells for the channel's rail (or all of its cells when it does not serve that rail),
  a threshold cell under its threshold in place of the base cell, and USD prices only; INR and store tax are outside
  it, as they are in the net sheet (`render-rail-prices.mjs --net-sheet`). Use `--from <adapter>` to scope a switch to
  the channels that adapter serves.

## 7. Deliberately not ported

These are platform, not vendors to swap; a port around them would cost more than it could ever save:

- **GitHub Actions** — the CI runtime (the public repo's free minutes are the reason it is public).
- **The Cloudflare Workers runtime** and **Cloudflare Pages** — the execution and hosting substrate.
- **The domain registrar.**
- **Signing custody** — store signing keys and their custody chain.
- **The brand.**
- **Beszel** — the box monitor.
- **The platform authorities** — Apple and Google (stores, Sign in with Apple/Google, App Attest, Play Integrity) and the
  captcha authority (Turnstile): they answer for their own platforms and cannot be replaced by another vendor.

Where one of these appears as a vendor in a register, `_non-port.json` carries it with `nonPort: true` and the reason.

## 8. The guard and the tool

`node tooling/ci/assert-ports.mjs` — exit 0 green, 1 a finding, 2 coverage lost; the first line names the deciding limb.
Limbs: 1 schema · 2 symbols · 3 waivers · 4 imports · 5 secrets · 6 level · 7 fakes · 8 cross-register. Every limb has a
recorded mutation in `tooling/ci/test/ports.test.mjs`.

`node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run [--env live|sandbox|test] [--from <adapter>]` —
one line per check, `PASS | FAIL | LOST C<n> <name>: <detail>`; exit 1 on any FAIL, 2 on any LOST, 0 only when all
pass. Without `--dry-run` it refuses. Tests: `tooling/ci/test/port-switch.test.mjs`. For `payments` it adds C9 the
webhook URL to register and the secrets by name, C10 the price ids still to create per offering, C11 the channels whose
`purchaseRails` would change, and C12 the run-off note; each pending conformance case prints as its own `FAIL` line.

`node tooling/ports/render.mjs [--check]` renders the tables code reads (today
`services/platform/src/generated/ports.ts` from `payments.json`); `--check` exits 1 on any difference, and limb 3
runs the same check on every build.
