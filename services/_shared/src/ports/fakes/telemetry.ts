// ─────────────────────────────────────────────────────────────────────────────
// ports/fakes/telemetry.ts — the RECORDING FAKES of the telemetry port: an
// `ErrorSink` and a `Notifier` that keep every call in memory and answer as told.
// tooling/ports/telemetry.json lists both as `fake` adapters (test only, never
// live). No network, no clock, no vendor.
// ─────────────────────────────────────────────────────────────────────────────
import type { ErrorSink, Notifier, OwnerAlert, SinkContext, TelemetryOutcome } from '../telemetry';

export interface RecordedReport {
  err: unknown;
  ctx: SinkContext;
  at: Date;
}

/** An `ErrorSink` that records each report. `answer` decides the outcome. */
export function recordingErrorSink(answer: TelemetryOutcome = { ok: true, via: 'fake-sink' }): ErrorSink & { reports: RecordedReport[] } {
  const reports: RecordedReport[] = [];
  return {
    id: 'fake-sink',
    reports,
    async report(err: unknown, ctx: SinkContext, now: Date = new Date()): Promise<TelemetryOutcome> {
      reports.push({ err, ctx: { ...ctx }, at: now });
      return answer;
    },
  };
}

/** A `Notifier` that records each alert. `answer` decides the outcome. */
export function recordingNotifier(id = 'fake-notifier', answer: TelemetryOutcome = { ok: true, via: id }): Notifier & { alerts: OwnerAlert[] } {
  const alerts: OwnerAlert[] = [];
  return {
    id,
    alerts,
    async notify(alert: OwnerAlert): Promise<TelemetryOutcome> {
      alerts.push({ ...alert });
      return answer;
    },
  };
}
