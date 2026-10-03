// ─────────────────────────────────────────────────────────────────────────────
// Types for money-dry-run.mjs, hand-written beside it.
//
// The same arrangement `contracts/entitlement/` already uses: one authored
// `.js`/`.mjs` that both runtimes execute, and a hand-written declaration file
// beside it so the TypeScript half is type-checked rather than cast away. The
// executable is plain ESM on purpose — it runs under bare `node` in a CI job
// with no `npm ci` — so this file is the only place its shape is written down.
//
// 🔴 THE INJECTED FUNCTIONS TAKE `never` PARAMETERS, AND THAT IS DELIBERATE.
// `replayOrder` is handed the REAL `persistNotification` and `deriveAndApply`,
// whose first parameter is `MoneyStoreDeps` — a type this file must not import,
// because `tooling/` declaring a dependency on `services/platform/src` would
// invert which tree owns which. `never` accepts any function contravariantly, so
// the driver stays agnostic about the deps object it is handed and simply passes
// it through. What is NOT loose is the RESULT shape, which is what the assertions
// read.
// ─────────────────────────────────────────────────────────────────────────────

/** One notification, ready to deliver: the bytes and the parsed form. */
export interface ReplayDelivery {
  source: string;
  notification: unknown;
  raw: string;
}

/** One stored payload, before any adapter has read it. */
export interface ReplayCorpusEvent {
  source: string;
  provider: string;
  raw: string;
}

/** What one delivery did, in the round it did it. */
export interface ReplayOutcome {
  round: number;
  event: string;
  outcome: string;
}

export interface ReplayRunResult {
  db: unknown;
  rows: Array<Record<string, unknown>>;
  /** Every entitlement row, key-sorted, volatile columns dropped, as one string. */
  canonical: string;
  outcomes: ReplayOutcome[];
  rounds: number;
}

export interface ReplayOrderResult extends ReplayRunResult {
  name: string;
}

export interface ReplayAllResult {
  runs: ReplayOrderResult[];
  baseline: ReplayOrderResult;
  identical: boolean;
  mismatches: Array<{ name: string; diff: string[] }>;
}

export interface ReplayOptions {
  deliveries: ReplayDelivery[];
  makeDb: () => unknown;
  persistNotification: (deps: never, notification: never, raw: string) => Promise<{ fresh: boolean }>;
  deriveAndApply: (deps: never, notification: never) => Promise<{ outcome: string }>;
  /** The store's attribution rule, injected (see MoneyStoreDeps.isKnownProduct). Required. */
  isKnownProduct: (id: string) => boolean;
  environment?: string;
  nowMs?: number;
  rounds?: number;
}

export interface RedControlResult {
  forward: ReplayRunResult;
  backward: ReplayRunResult;
  /** True when the two directions produced DIFFERENT final state, as they must. */
  orderDependent: boolean;
  diff: string[];
}

export const REPO_ROOT: string;
export const DEFAULT_CORPUS_REL: string;
export const MIGRATIONS_REL: string;
/** The resolve hook that lets bare node import services/ TypeScript (extensionless relative specifiers). */
export function registerTypeScriptResolution(): Promise<void>;
export function defaultCorpusDir(root?: string): string;
export const DEFAULT_NOW_MS: number;
export const RAIL_B_PROVIDER: string;
export const VOLATILE_COLUMNS: readonly string[];
export const RETRYABLE_OUTCOMES: ReadonlySet<string>;
export const ORDERS: ReadonlyArray<{ name: string; build: (d: ReplayDelivery[]) => ReplayDelivery[] }>;

export function loadCorpusDir(dir: string): ReplayCorpusEvent[] | null;
export function corpusFromExport(doc: unknown, source?: string): ReplayCorpusEvent[];
export function relabelAsSecondRail(deliveries: ReplayDelivery[], provider?: string): ReplayDelivery[];
export function normalizeRows(rows: Array<Record<string, unknown>>): string;
export function diffCanonical(nameA: string, a: string, nameB: string, b: string): string[];
export function replayOrder(opts: ReplayOptions): Promise<ReplayRunResult>;
export function replayAllOrders(opts: ReplayOptions): Promise<ReplayAllResult>;
export function redControlDeliveries(clock?: string): ReplayDelivery[];
export function runRedControl(opts: Omit<ReplayOptions, 'deliveries'>): Promise<RedControlResult>;
export function syntheticSubscription(o: {
  eventId: string;
  occurredAt: string;
  periodEnd: string | null;
  userId: string | null;
  appId?: string;
  subscriptionId?: string;
}): unknown;
export function makeOpsDb(root: string): unknown;
