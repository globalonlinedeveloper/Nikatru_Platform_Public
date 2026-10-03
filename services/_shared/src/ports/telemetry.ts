// ─────────────────────────────────────────────────────────────────────────────
// ports/telemetry.ts — THE WORKER HALF OF THE TELEMETRY PORT: where a Worker's
// unhandled error goes (`ErrorSink`) and how the owner is told something is
// wrong (`Notifier`). The standard is tooling/ports/README.md §3; the registry is
// tooling/ports/telemetry.json, which names every adapter behind these two
// interfaces and the level each half earns.
//
// TYPES AND PURE HELPERS ONLY. No vendor import, no `fetch`: an adapter lives in
// services/_shared/src/adapters/telemetry/, a fake in ./fakes/, and the only
// module that imports an adapter is a Worker's composition root,
// services/<w>/src/ports.ts (assert-ports limb 4).
//
// OUTCOMES, NEVER THROWS ACROSS THE PORT. Both verbs FAIL OPEN: a sink or an
// alert channel that is down must never turn a 500 into a hang or a cron into a
// crash. The outcome is a REPORT of what happened, for a test or a log line; no
// caller branches its own work on it.
//
// 🔴 WHY A NOTIFIER HAS A FALLBACK. ntfy, GlitchTip and the vault all run on Box B
// (services/platform/src/scheduled.ts BOXB_REACH_JOB), so an alert ABOUT Box B
// carried only BY Box B is never delivered — the outage silences its own alarm.
// `NOTIFIER_ROUTES` names, per severity, a primary and a fallback on a different
// host; `withFallback` tries the second exactly once when the first does not
// accept the alert.
// ─────────────────────────────────────────────────────────────────────────────

/** Why a port call did not succeed. `retryable` says whether the same call could
 *  succeed later; nothing here retries on its own. */
export type TelemetryFailureKind = 'refused' | 'unavailable' | 'invalid' | 'timeout';

export type TelemetryOutcome =
  | { ok: true; via: string }
  | { ok: false; kind: TelemetryFailureKind; retryable: boolean; detail: string };

/** One Worker error's context. Vendor-neutral: what failed, where, in which
 *  deploy — never who. Field rules are on the Sentry-envelope adapter, which is
 *  the only reader that serialises it. */
export interface SinkContext {
  /** The Worker this error came from. A COMPILE-TIME constant supplied by the
   *  caller, never `env.APP_ID`: a report that cannot say which Worker produced
   *  it is a report nobody can act on, and an env var can be blanked by a
   *  deploy. */
  service: string;
  /** The commit this Worker was deployed from (`--var RELEASE:<sha>`).
   *  🔴 DELIBERATELY NOT `API_VERSION` — the literal "v1" in both Workers, which
   *  would put every error ever reported into one bucket named after a URL
   *  prefix. */
  release: string | undefined;
  /** [pipeline B-16] The app this request was for, when the route got far
   *  enough to resolve and validate one. ABSENT otherwise — an absent tag is
   *  honest, a placeholder is a second app called "unknown". */
  appId?: string;
  requestId: string | undefined;
  method: string;
  /** PATHNAME ONLY, never the full URL — the query string is where personal
   *  data hides. Pass it through `reportablePath`. */
  path: string;
}

/** Where a Worker's unhandled error is reported. */
export interface ErrorSink {
  /** The adapter's wire id, a tooling/ports/telemetry.json `adapters[].id`. */
  readonly id: string;
  /** Report one error. Never rejects; an unconfigured or unreachable sink is
   *  `{ ok: false }`, and the caller hands the promise to `waitUntil`. */
  report(err: unknown, ctx: SinkContext, now?: Date): Promise<TelemetryOutcome>;
}

/** How loud an owner alert is. A severity picks the route, never the wording. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

export const ALERT_SEVERITIES: readonly AlertSeverity[] = ['critical', 'warning', 'info'];

/** One owner alert. `dedupeKey` is stable across repeats of the SAME condition
 *  (`boxb-unreachable`), so a channel that groups or replaces by key can. */
export interface OwnerAlert {
  severity: AlertSeverity;
  title: string;
  body: string;
  dedupeKey: string;
}

/** A channel that can put an alert in front of the owner. */
export interface Notifier {
  /** The adapter's wire id, a tooling/ports/telemetry.json `adapters[].id`. */
  readonly id: string;
  /** Deliver one alert. Never rejects. */
  notify(alert: OwnerAlert): Promise<TelemetryOutcome>;
}

/** The wire ids of the notifier adapters (tooling/ports/telemetry.json). */
export type NotifierId = 'ntfy' | 'mail' | 'webhook';

/**
 * THE NOTIFIER SELECTION: per severity, a primary and a fallback, chosen so that
 * the fallback is NOT on Box B. tooling/ports/telemetry.json
 * `selection.byInterface.ts.source` cites this table; changing a vendor for
 * alerts is an edit here plus the adapter, never a caller change.
 *
 * `mail` is not a fallback yet: it is declared `pending` until the mail port
 * lands (`mailFor('alerts')`), so `webhook` carries the off-box leg.
 * `info` has no fallback on purpose: an informational note lost in an outage
 * costs nothing, and a second channel for it is noise.
 */
export const NOTIFIER_ROUTES: Readonly<Record<AlertSeverity, { primary: NotifierId; fallback: NotifierId | null }>> = {
  critical: { primary: 'ntfy', fallback: 'webhook' },
  warning: { primary: 'ntfy', fallback: 'webhook' },
  info: { primary: 'ntfy', fallback: null },
};

/** A failure outcome, so every adapter phrases one the same way. */
export function telemetryFailure(kind: TelemetryFailureKind, detail: string, retryable = kind === 'unavailable' || kind === 'timeout'): TelemetryOutcome {
  return { ok: false, kind, retryable, detail: detail.slice(0, 200) };
}

/** An HTTP status, graded: 2xx delivered; 408/429/5xx unavailable and retryable;
 *  any other 4xx refused. One rule for every HTTP adapter of this port. */
export function outcomeOfStatus(via: string, status: number): TelemetryOutcome {
  if (status >= 200 && status < 300) return { ok: true, via };
  if (status === 408 || status === 429 || status >= 500) return telemetryFailure('unavailable', `${via}: HTTP ${status}`, true);
  return telemetryFailure('refused', `${via}: HTTP ${status}`, false);
}

/**
 * The primary, then — only when it did not accept the alert — the fallback,
 * EXACTLY ONCE. A thrown adapter is graded `unavailable` rather than allowed
 * across the port. With no fallback this is the primary alone.
 */
export function withFallback(primary: Notifier, fallback: Notifier | null): Notifier {
  const attempt = async (n: Notifier, alert: OwnerAlert): Promise<TelemetryOutcome> => {
    try {
      return await n.notify(alert);
    } catch (err) {
      return telemetryFailure('unavailable', `${n.id} threw: ${String(err)}`);
    }
  };
  return {
    id: fallback ? `${primary.id}+${fallback.id}` : primary.id,
    async notify(alert: OwnerAlert): Promise<TelemetryOutcome> {
      const first = await attempt(primary, alert);
      if (first.ok || !fallback) return first;
      const second = await attempt(fallback, alert);
      if (second.ok) return second;
      return telemetryFailure(second.kind, `${primary.id}: ${first.ok ? '' : first.detail}; ${fallback.id}: ${second.detail}`, second.retryable);
    },
  };
}

/** A header-safe single line: no CR/LF (header injection), printable ASCII only,
 *  bounded. Used for every value an adapter puts in a header. */
export function headerSafe(value: string, max = 200): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '?').slice(0, max).trim();
}
