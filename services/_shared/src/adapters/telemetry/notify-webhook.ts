// ─────────────────────────────────────────────────────────────────────────────
// adapters/telemetry/notify-webhook.ts — the `webhook` adapter of the telemetry
// port's `Notifier`: the OFF-BOX leg of an owner alert.
//
// ONE POST of `{ severity, title, body, dedupeKey, source }` as JSON to
// `ALERT_WEBHOOK_URL` — any endpoint the owner points it at that is NOT on Box B
// (a chat incoming-webhook, a hosted ntfy topic's JSON publish, a relay). The URL
// is the credential, so it is a Worker SECRET, never a var; nothing here logs it.
//
// It exists so a Box B outage — which takes ntfy, GlitchTip and the vault down
// together — still reaches the owner: ports/telemetry.ts NOTIFIER_ROUTES makes it
// the fallback for `critical` and `warning`.
//
// Never rejects; no URL configured is `invalid` and sends nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { outcomeOfStatus, telemetryFailure } from '../../ports/telemetry';
import type { Notifier, OwnerAlert, TelemetryOutcome } from '../../ports/telemetry';

export function webhookNotifier(env: { ALERT_WEBHOOK_URL?: string }, source = 'nikatru-platform'): Notifier {
  return {
    id: 'webhook',
    async notify(alert: OwnerAlert): Promise<TelemetryOutcome> {
      const url = (env.ALERT_WEBHOOK_URL ?? '').trim();
      if (!/^https:\/\/[^/\s]+/.test(url)) {
        return telemetryFailure('invalid', 'webhook: ALERT_WEBHOOK_URL is not set to an https URL; nothing sent', false);
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            severity: alert.severity,
            title: alert.title.slice(0, 200),
            body: alert.body.slice(0, 4000),
            dedupeKey: alert.dedupeKey,
            source,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        return outcomeOfStatus('webhook', res.status);
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return telemetryFailure(timedOut ? 'timeout' : 'unavailable', `webhook: no answer (${String(err).slice(0, 120)})`);
      }
    },
  };
}
