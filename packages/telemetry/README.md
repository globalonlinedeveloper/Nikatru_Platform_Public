# nikatru_telemetry

GlitchTip/Sentry telemetry facade for NIKATRU apps (Step 1 of the
app-factory platform hardening; additive, no live impact).

## What it is

- `TelemetryConfig` + `TelemetryBootstrap` - the ONLY two symbols app code
  names. An app builds one config and hands it to `init`; that is the whole
  surface. Measured 2026-09-05: `TelemetryClient` appears ZERO times in
  `apps/` and zero times in `tooling/bricks/`.
- `TelemetryClient` - the INTERNAL seam (`captureException`,
  `captureMessage`, `addBreadcrumb`, `setUser`, `close`). This line used to
  call it "the only interface app code talks to", which was false in both
  trees. It is what `NoOpTelemetryClient` and `SentryTelemetryClient`
  implement and what `init` returns, and it is exported so a caller CAN hold
  one - not because one does.
- `TelemetryBootstrap.init(config, appRunner: ...)` - one-shot wiring.
  Empty DSN returns a `NoOpTelemetryClient` (telemetry fully off; the
  `appRunner` still runs).
- `PiiScrubber` - pure-Dart, deterministic redaction of PAN, Aadhaar,
  emails, Indian phone numbers, IPv4/IPv6 literals and long digit runs,
  applied to every outgoing event via Sentry's `beforeSend` hook. Group
  separators are format-tolerant: `1234-5678-9012` and `98765 43210` redact
  exactly like their unseparated forms.

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

### No IP address, anywhere, in any form

Owner ruling 2026-09-15 (O-CRASH-EVENT-IP-DROP): a crash report carries **no IP
address at all**, truncated or not. `sendDefaultPii = false` keeps the SDK from
attaching the structured `user.ip_address`, and the self-hosted ingest is
starved of every client-IP header so it cannot infer one either - but both of
those match on a FIELD, and an address typed into an exception value or a log
line is free text. Rules 5 and 6 of the scrubber close that half:
`198.18.7.9`, `2001:db8::1` and `::1` are redacted wherever they appear in the
text of an event.

The same fail-closed trade applies and both directions are pinned by tests: a
four-part dotted version `1.2.3.4` **is** redacted (accepted - nothing here
numbers a release in four parts), while a wall-clock `12:30:45` is **not** - the
IPv6 rule matches only the full 8-group form or a `::`-compressed one, precisely
so it cannot eat every timestamp in the log.

## Isolation rule

`sentry_flutter` is a dependency of THIS package only. No other package or
app may import it - everything goes through this package, behind the
`TelemetryClient` seam. That keeps
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
    dist: AppConfig.releaseChannel, // '' => no dist is sent at all
  ),
  appRunner: () async => runApp(const App()),
);
```

### `dist`, and what it is actually for

`dist` is the build VARIANT of `release`: the same commit built for `web` and
for `windows-store` produces two artifacts that differ in nothing else. The apps
pass `AppConfig.releaseChannel`, so the value is the compile-time
`RELEASE_CHANNEL` define and every value it can take already resolves to a row
in `tooling/channel-register.json`.

⚠️ **It is metadata, not the lookup key on this backend, and the difference is
worth knowing before you debug a failed symbolication.** GlitchTip resolves a
minified web stack trace against a `DebugSymbolBundle`, which is keyed on
`(organization, debug_id)` or on `(release, file name)` - there is no `dist`
column, and `apps/files/assemble.py` carries the line *"Sentry OSS would add
dist to release here"* over nothing (read from glitchtip-backend on 2026-09-03).
So `dist` is sent because it is correct Sentry-protocol metadata and costs
nothing; what actually makes the trace readable is
`.github/workflows/deploy-web.yml` uploading the maps, via
`tooling/ops/upload-web-sourcemaps.mjs`.

⚠️ **Empty means "no variant declared" and the SDK then sends nothing.** An
empty `dist` is not the absence of one - it is a value that matches no uploaded
bundle, so `TelemetryBootstrap` sets `options.dist` only when the string is
non-empty.

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
