# nikatru_telemetry

GlitchTip/Sentry telemetry facade for NIKATRU apps (Step 1 of the
app-factory platform hardening; additive, no live impact).

## What it is

- `TelemetryClient` - the only interface app code talks to
  (`captureException`, `captureMessage`, `addBreadcrumb`, `setUser`,
  `close`).
- `TelemetryBootstrap.init(config, appRunner: ...)` - one-shot wiring.
  Empty DSN returns a `NoOpTelemetryClient` (telemetry fully off; the
  `appRunner` still runs).
- `PiiScrubber` - pure-Dart, deterministic redaction of PAN, Aadhaar,
  emails, Indian phone numbers and long digit runs, applied to every
  outgoing event via Sentry's `beforeSend` hook. Group separators are
  format-tolerant: `1234-5678-9012` and `98765 43210` redact exactly like
  their unseparated forms.

## What "every outgoing event" means

`TelemetryBootstrap.scrubEvent` is the ONE choke point, and it covers the
message and its template, exception values, breadcrumb messages, and the
three map-bearing surfaces - `tags`, `extra` and `breadcrumb.data`. The maps
were missed until 2026-08-01, which is why the rule is now stated as a rule:
**a new user-controlled field on the event is not covered until it is routed
through `scrubEvent`.** Flat strings go through `scrubText`, anything
map-shaped through `scrubMap`.

The scrubber is deliberately **fail-closed**: a 12-digit order id is redacted
even though it is not an Aadhaar. One unreadable field in a crash report beats
leaking a government identifier. Ordinary log numerics - short ids, ISO dates,
durations, build numbers - are unaffected and pinned by tests.

## Isolation rule

`sentry_flutter` is a dependency of THIS package only. No other package or
app may import it - everything goes through `TelemetryClient`. That keeps
the vendor SDK swappable (GlitchTip today, anything Sentry-compatible
tomorrow) and enforces the PII policy in exactly one place.

## Configuration

DSN, release and environment always come from runtime CFG - never hardcode
them in source, never commit them. `dsn: ''` disables telemetry.

```dart
final telemetry = await TelemetryBootstrap.init(
  TelemetryConfig(
    dsn: cfg.glitchtipDsn, // '' => NoOpTelemetryClient
    release: cfg.release,
    environment: cfg.env,
  ),
  appRunner: () async => runApp(const App()),
);
```

## Testing

`test/pii_scrubber_test.dart` covers the scrubber (PAN; Aadhaar spaced,
unspaced, hyphenated and mixed; email; +91, bare and 5-5 grouped phones; an
over-long digit run that must not leave a stray digit) **and the
false-positive direction** - control strings of ordinary log numerics that
must come back byte-identical, plus a pinned test for the accepted 12-digit
over-redaction.

`test/telemetry_bootstrap_test.dart` drives `scrubEvent` with hand-built
`SentryEvent`s whose `tags`, `extra` and `breadcrumb.data` are POPULATED.
That shape is load-bearing: asserting via a `TelemetryClient` call instead
would pass against a scrubber that ignores all three maps, because
`captureMessage`/`addBreadcrumb` never populate them.

CI (`flutter analyze` + `flutter test`) is the gate.
