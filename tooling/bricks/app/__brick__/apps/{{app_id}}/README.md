# {{{display_name}}}

A NIKATRU Cross Platform App, stamped from `tooling/bricks/app`.

Pre-wired to the shared spine: `nikatru_core`, `nikatru_api_client`,
`nikatru_design_system` (tokens + `buildAppTheme` + adaptive `AppScaffold`) and
`nikatru_telemetry` (GlitchTip facade, no-op until a DSN is supplied).

## Run

```sh
flutter pub get
flutter run \
  --dart-define=SUPABASE_URL=... \
  --dart-define=SUPABASE_ANON_KEY=...{{#needs_backend}} \
  --dart-define=API_BASE_URL={{{api_base_url}}}{{/needs_backend}}
```
{{^needs_backend}}
This app is **client-only**: it has no Worker and no database of its own and
talks to the shared platform Worker, so there is no `API_BASE_URL` to set. Only
override it if this app later gains its own backend.
{{/needs_backend}}

Left unconfigured, the app boots in demo mode. Brand seed: `#{{seed_hex}}`.
