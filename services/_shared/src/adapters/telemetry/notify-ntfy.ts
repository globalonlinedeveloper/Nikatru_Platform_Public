// ─────────────────────────────────────────────────────────────────────────────
// adapters/telemetry/notify-ntfy.ts — the `ntfy` adapter of the telemetry port's
// `Notifier`: the owner-alert path the GlitchTip alert rules already page through
// (tooling/ops/alarm-chains.json, topic `nikatru-page` on the self-hosted ntfy).
//
// ONE POST to the topic URL (`NTFY_ALERT_URL`, e.g. `https://<ntfy host>/<topic>`),
// the alert body as the message, title / priority / tags as ntfy's own headers
// (https://docs.ntfy.sh/publish/). `NTFY_ALERT_TOKEN`, when set, is sent as a
// Bearer access token; a topic that needs none takes none.
//
// 🔴 ntfy RUNS ON BOX B, beside GlitchTip and the vault. An alert ABOUT Box B is
// exactly the one this adapter cannot deliver, which is why it is never the only
// route for `critical` (ports/telemetry.ts NOTIFIER_ROUTES). It answers that case
// honestly: an unreachable or 5xx ntfy is `unavailable`, and the composition
// root's `withFallback` hands the alert to the off-box channel once.
//
// Never rejects; no URL configured is `invalid` and sends nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { headerSafe, outcomeOfStatus, telemetryFailure } from '../../ports/telemetry';
import type { AlertSeverity, Notifier, OwnerAlert, TelemetryOutcome } from '../../ports/telemetry';

/** ntfy's priority scale: 5 is `urgent` (bypasses Do Not Disturb), 3 the default. */
export const NTFY_PRIORITY: Readonly<Record<AlertSeverity, string>> = { critical: '5', warning: '4', info: '3' };

/** A tag ntfy accepts: lowercase alphanumerics and hyphens. */
const tagOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

export function ntfyNotifier(env: { NTFY_ALERT_URL?: string; NTFY_ALERT_TOKEN?: string }): Notifier {
  return {
    id: 'ntfy',
    async notify(alert: OwnerAlert): Promise<TelemetryOutcome> {
      const url = (env.NTFY_ALERT_URL ?? '').trim();
      if (!/^https:\/\/[^/\s]+\/[^\s]+$/.test(url)) {
        return telemetryFailure('invalid', 'ntfy: NTFY_ALERT_URL is not set to an https topic URL; nothing sent', false);
      }
      const headers: Record<string, string> = {
        'content-type': 'text/plain; charset=utf-8',
        Title: headerSafe(alert.title),
        Priority: NTFY_PRIORITY[alert.severity],
        Tags: [tagOf(alert.severity), tagOf(alert.dedupeKey)].filter((t) => t.length > 0).join(','),
      };
      const token = (env.NTFY_ALERT_TOKEN ?? '').trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        const res = await fetch(url, { method: 'POST', headers, body: alert.body, signal: AbortSignal.timeout(10_000) });
        return outcomeOfStatus('ntfy', res.status);
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return telemetryFailure(timedOut ? 'timeout' : 'unavailable', `ntfy: no answer (${String(err).slice(0, 120)})`);
      }
    },
  };
}
