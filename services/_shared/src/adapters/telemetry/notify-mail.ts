// ─────────────────────────────────────────────────────────────────────────────
// adapters/telemetry/notify-mail.ts — the `mail` adapter of the telemetry port's
// `Notifier`. ⬜ DRAFT, DECLARED PENDING.
//
// Mail is the owner-alert channel that does not depend on Box B at all, and the
// GlitchTip alert rule already carries an e-mail recipient beside the ntfy hop
// (tooling/ops/alarm-chains.json). It belongs behind the MAIL port —
// `mailFor('alerts')` — so the Resend facts stay in one place; that port has not
// landed (tooling/ports/_non-port.json `resend`, until port-mail). Until it does,
// this adapter REFUSES every alert and says why, rather than growing a second
// Resend client here. tooling/ports/telemetry.json lists it `draft` with a
// `pending` conformance case, so it can neither be selected nor counted.
// ─────────────────────────────────────────────────────────────────────────────
import { telemetryFailure } from '../../ports/telemetry';
import type { Notifier, OwnerAlert, TelemetryOutcome } from '../../ports/telemetry';

export function mailNotifier(): Notifier {
  return {
    id: 'mail',
    async notify(_alert: OwnerAlert): Promise<TelemetryOutcome> {
      return telemetryFailure('unavailable', 'mail: pending port-mail (mailFor(\'alerts\')); nothing sent', false);
    },
  };
}
