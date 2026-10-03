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
other vendor is placed in `tooling/ports/_non-port.json`. Payments also carries its CLIENT half (`client`: the Dart
`PurchaseRail` and `IapBridge` seams, at L3 since port-pay-client). `tooling/ports/mail.json` (TS `MailTransport`, port-mail) is at
L3 as well: Resend and a fake conformant, an Amazon SES draft passing the same suite to prove the port is not
Resend-shaped. `tooling/ports/ai.json` (port-ai) is the first TWO-SIDED port, at L3: a server half (TS `AiProvider`:
Anthropic on OUR key, behind T17's meter, plus a counting stub) and a client half (Dart `AiProvider`: three
bring-your-own-key adapters on the USER's key, plus a fake), selected per call by FEATURE.

`tooling/ports/channels.json` (port-channels) is a port selected PER CHANNEL: one adapter per `kind: store` row of
`tooling/channel-register.json`, each a `ChannelSubmitter` (`tooling/release/submit-common.mjs`: `validate` · `plan` ·
`upload` · `status`) that passes `submitterConformance` dry, with no network
(`tooling/release/test/submitters.contract.test.mjs`). Adding a store is a row, an adapter and a submitter —
`node tooling/kit/new-channel.mjs --id <id> --dry-run` prints the three. Its switch is not a margin switch between
rails: `port-switch.mjs`'s C8 has no fee model for moving a channel, and prints LOST rather than a guess.

`tooling/ports/boxes.json` (port-boxes) makes each box an adapter: its declaration is `tooling/boxes/<box>.json`, its
role is selected one box per role by `tooling/boxes/roles.json`, it is read back by
`tooling/ops/check-box-declared.mjs` and its move is rehearsed by `tooling/ops/box-move.mjs --dry-run`, the box
equivalent of §4's phase 3. Backup destinations and their restore drills are `tooling/boxes/backups.json` and
`tooling/ops/restore-drill.mjs`.

## 1. Levels

| Level | Means | Earned when (assert-ports limb 6) |
|---|---|---|
| **L0** | Hard-coded at call sites. | — |
| **L1** | Centralised, but vendor-shaped. | The registry validates and its `interface` symbols are declared where it says. |
| **L2** | Behind a port (an interface), one adapter, chosen by config; no caller imports an adapter. | L1, plus a `selection` (a `source` or a `default`), at least one built non-fake adapter, limb 4 clean for the port, and no fake selectable in live. |
| **L3** | L2, plus a conformance suite any adapter must pass, at least two conformant adapters (one may be a fake) with zero pending cases, a switch runbook, and a dry-run command. | L2, plus `conformance.suite` whose runner is declared in its file, two or more adapters — never a `draft` or `retired` one — whose `conformance.file` **calls** that runner and have no `pending` case, a `switch.runbook`, and `tooling/ops/port-switch.mjs` present. |

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
| `interface.ts` / `interface.dart` / `interface.js` | `{file, symbols}` — at least one. Each symbol must be **declared** in the file (comment-stripped). `js` is a node module under `tooling/` for a port that is operated rather than imported (the boxes). |
| `adapters[].id` | The wire id: the value the selection names and the code keys on. |
| `adapters[].vendor` | A `tooling/capability-register.json` `vendors` key or a `tooling/legal/provider-register.json` `providers` id; `null` only for a fake. Two adapters of ONE port may share a vendor (two boxes at one provider); two ports may not. |
| `adapters[].status` | `draft` · `built` · `live` · `standby` · `retired` · `fake` · `external`. |
| `adapters[].half` | Optional, for a two-sided port: `server` (a Worker adapter on OUR credential) or `client` (an app adapter on the USER's own credential). |
| `adapters[].impl` | `{file, symbol}`; for `external` (e.g. a self-hosted GoTrue configured by env) `{configAt, verify}`. |
| `adapters[].outbound` | Optional `{file, symbol, modules}` — the adapter's outbound half (e.g. `RailOutbound`) and its further private modules. Limb 2 holds the symbol declared; limb 4 protects `file` and every `modules` path exactly as it protects `impl.file`. |
| `adapters[].capabilities` | The port's own verbs (e.g. `verify`, `parse`, `cancel-api`). Capability verbs, never vendor nouns. |
| `adapters[].secrets` | Secret **names** only — rows of `tooling/worker-secrets.json` once it exists, until then members of a Worker's `interface Env`. |
| `adapters[].identity` | Field **paths** into `tooling/house-identity.json` (the entity source) that the vendor account carries. Never the values. |
| `adapters[].environments` | Which of `test`, `sandbox`, `live` it may serve. A fake never lists `live`. Empty only for a `draft` or `retired` adapter: selectable nowhere. |
| `adapters[].cost` | `feeCells` — `tooling/catalog/fee-register.json` cell ids applied per sale; `unit` — `{usd, per, asOf, verify}` or null; `models` — for a port billed per token, each model's price per million tokens (input, output, cache read, cache write) with `asOf`, `source` and `verify`, and its refusal-fallback chain (`fallbacks`), every model of which limb 1 requires priced in the same `models`. |
| `adapters[].conformance` | `{file}` — the adapter's test that **calls** the suite's runner; null until it exists. |
| `adapters[].exportDuty` | What leaves with us, what must be exported, what cannot move. |
| `adapters[].readAt` | `{url, on}` — the vendor page the adapter's facts were read from, and when; null if none was read. |
| `adapters[].delivery` | Mail only: `{rail, dnsNeeded, domainVerification, warming, suppression: {export, import}}` — the `tooling/mail-transport.json` rail whose `authRecords` it sends under (or, with none yet, the records to publish), the verification step, the warm-up, and how the suppression list leaves and enters it (null until the runbook names the method). Read by the mail dry run (C9–C14). |
| `adapters[].channel` | Optional, for a port selected per channel (`channels.json`): a `tooling/channel-register.json` row id. The store is that row's, so `vendor` is null and the store stays placed once in `_non-port.json`. Limb 8 resolves it, and one channel has one adapter. |
| `adapters[].account` | Optional, `{kind, source}`: the KIND of store account the channel binds to (`individual` · `organization` · `none` · `unrecorded`) and where that is recorded — what an entity change has to move. Never the account's values. |
| `adapters[].c8Seam` | Optional, a **declared, printed** divergence: the vendor's C-8 `seam.file` is not this port's interface. Names the C-8 file exactly, with `why` and `until`. |
| `streams` | For `selection.by: stream`: `{<stream>: {adapter, secrets, from, to?, why}}` — the adapter, its secret NAMES in preference order (the first one set wins), and the From (and a fixed recipient) as entity-source PATHS. Each adapter is one of the port's and each secret one that adapter declares (limb 1); each path resolves (limb 9). |
| `features` | For `selection.by: per-call`: `{<feature>: {adapter, model, effort, maxInputTokens, candidates, tokensPerCall, why}}` — the adapter and the model a feature runs on (null until measured), its input cap (every call is reserved at it, and an input over it is refused before the wire; null refuses every call), the models it may be set to (each priced in its adapter's `cost.models`), and the tokens one call takes (`{input, output, basis: declared | measured, asOf, why}`, or null). Limb 1 holds each to its adapter and its candidates; the AI dry run (C15–C17) prices it. |
| `selection.by` | `single` · `environment` · `stream` · `channel-market` · `per-call`. |
| `selection.source` | `<file>#<pointer>` when another register (or one code site) holds the answer — e.g. `tooling/channel-register.json#purchaseRails`; null when `default` is the whole answer. |
| `selection.default` | `{live, sandbox, test}` adapter ids or null. Null in every slot is honest for a port selected per channel. |
| `selection.canary` | Reserved; null. |
| `generated` | `true` once code reads a **rendered** table instead of a hand array. The render tool is `tooling/ports/render.mjs [--check]` (port-pay-core); assert-ports limb 3 runs its check on every build, so a hand edit of a rendered table fails whether or not `generated` is claimed yet. |
| `handTables[]` | `{file, anchor, until, why}` — a declared, printed waiver for a hand-written table (or a pre-port import) that the port will replace. The anchor must still exist. |
| `conformance.suite` | `{file, runner}` or null. |
| `conformance.clientSuite` | Optional `{file, runner}`: the suite a client (Dart) adapter of a two-sided port calls. Each adapter is graded against the suite in its own file's language. |
| `conformance.pending[]` | `{adapter, case, row}` — a scenario an adapter cannot pass yet. Names its `O-` row, prints on every run, and blocks L3 for that adapter. |
| `switch.runbook` | `Private/runbooks/switch-vendor.md#<port>`. |
| `switch.dryRun` | `node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run`. |
| `client` | Optional: the CLIENT (Dart) half of a port whose seams live in an app package — `{level, seams, adapters, pending, _why}`. `seams[]` is `{interface, suite: {file, runner}}` (each `interface` a symbol of `interface.dart`); `adapters[]` is `{id, seam, status, impl: {file, symbol}, conformance: {file} \| null, waits?}` (`waits` says why an adapter with no conformance test has none, printed on every run). Its level is earned by limb 10 the way limb 6 earns the port's, and prints as `<port>/client`. Payments' client half: `PurchaseRail` and `IapBridge` (port-pay-client). |
| `candidates[]` | Optional. A store not built because an owner step stands first: `{id, name, submittable: false, deferral {reason, source, ownerSteps}, commission {cell, asOf, verify}, exportDuty}`. It has no impl and no register row; limb 8 refuses one that has a row (it is an adapter then) and PRINTS every candidate. Its commission is null until the store's terms are read and dated. `tooling/kit/new-channel.mjs` turns a candidate into a row, an adapter and a submitter skeleton. |
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
- **No business fact is a literal in Worker source.** An address is an entity-source field, rendered into the Worker's
  `src/generated/entity.ts` (`tooling/ports/render-entity.mjs`, `--check`); limb 9 refuses an owner-domain address
  anywhere else in `services/*/src`.

### Dart ports (apps)

- The seams stay in `packages/core` — or, for a seam that only one capability's apps speak, in that capability's
  package (payments: `packages/purchases`, whose library file is `interface.dart`; limb 2 follows its relative
  `export`s). Each seam package exports `lib/testing.dart`: the fake plus `run<Seam>Conformance` (a `package:test`
  `group` per adapter). No `lib/` file of an app or a package imports it (limb 10).
- **A channel's rail is rendered, never switched on.** `tooling/ports/render.mjs` writes
  `packages/purchases/lib/src/generated/rails.dart` (channel → `hosted` | a store rail | `none`) from
  `channel-register.json#purchaseRails`; `PurchaseRailKind.forChannel` reads it. A hosted page is `hosted` whichever
  vendor serves it — the client names none.
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
| AI | Nothing: no data of ours is held at the provider (the server adapter stores nothing there; the provider's own retention of API traffic is recorded in the registry). A bring-your-own-key account is the user's | The prompt cache; the measured quality bar per model | Server: a registry edit plus a deploy, after the quality bar is re-measured. Client: a new adapter ships in an app release |
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
Limbs: 1 schema · 2 symbols · 3 waivers · 4 imports · 5 secrets · 6 level · 7 fakes · 8 cross-register · 9 literals ·
10 client (a port's Dart half: each adapter's conformance test CALLS its seam's runner; every class in `packages/*/lib`
implementing a seam is a registered adapter; no lib imports the shared fakes; the half's level, printed `<port>/client`).
Every limb has a recorded mutation in `tooling/ci/test/ports.test.mjs`. Limb 8 places a vendor once per port: mail's
Resend HTTP adapter and its SMTP relay (auth mail) are one vendor in one port.

`node tooling/ops/port-switch.mjs <port> --to <adapter> --dry-run [--env live|sandbox|test] [--from <adapter>]` —
one line per check, `PASS | FAIL | LOST C<n> <name>: <detail>`; exit 1 on any FAIL, 2 on any LOST, 0 only when all
pass. A port with `streams` (mail) adds C9 dns (SPF include, DKIM, return-path, DMARC alignment), C10 domain
verification, C11 streams and their secret names, **C12 the suppression-list export and import — FAIL until the runbook
names the method**, C13 warming, and C14 the per-stream cost from `tooling/ceilings.json` (LOST while it records none). Without `--dry-run` it refuses. Tests: `tooling/ci/test/port-switch.test.mjs`.
For `payments` it adds C9 the
webhook URL to register and the secrets by name, C10 the price ids still to create per offering, C11 the channels whose
`purchaseRails` would change (a channel moves only to an adapter of its billing kind — a store-billed channel never to a web rail, a web-billed one never to a store biller — and C8 nets only what moves), and C12 the run-off note; each pending conformance case prints as its own `FAIL` line.
A port with `features` (ai) takes a MODEL as `--to` as well as an adapter, and adds C15 the target's model prices, C16
each feature's tokens per call × price, input priced as cache writes (LOST while a feature has no model or no tokens —
never a guess), and C17 the MINIMUM credit-pack price per unit per selling channel: at least 4× the cost (owner lock,
2026-10-01) after the store commission (the rail's highest cell, 30% on the App Store), the tax — the HIGHEST rate in
`fee-register.json` `taxRegions`, so the floor holds in every region (IN's on the India web book) — and the rail fee; a
subscription-only cell never prices a one-time pack.

`node tooling/ports/render.mjs [--check]` renders the tables code reads (today
`services/platform/src/generated/ports.ts` from `payments.json`, and `packages/purchases/lib/src/generated/rails.dart`
from `channel-register.json` and the store-billed rails `payments.json` derives); `--check` exits 1 on any difference,
and limb 3 runs the same check on every build. ⏱ 2026-10-01 · fix-india-rail-tax-data: `ports.ts` also carries
`CHECKOUT_RAIL_BY_MARKET` — the web checkout rail per BUYER-DECLARED market, from the register `selection.source`
cites (`tooling/channel-register.json`, the `web` row's `purchaseRail.rail` and `regionRails`, restricted to adapters
declaring `checkout`); an unreadable one is LOST (exit 2). The Worker reads it only through
`services/platform/src/ports.ts` `checkoutRailFor(market)`; never `cf.country`.
