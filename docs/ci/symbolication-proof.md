# `symbolication-proof.yml` — does GlitchTip put an obfuscated Flutter Android crash on the right line?

Row `O-GLITCHTIP-FLUTTER-SYMBOLICATION-UNPROVEN`. Dispatch-only. Script:
`tooling/ops/symbolication-proof.mjs`; test: `tooling/ci/test/symbolication-proof.test.mjs`; probe:
`apps/subscriptiontracker/live_probe/symbolication_crash_probe.dart`.

## What one run does

1. Builds the probe with the release lanes' flags (`--obfuscate --split-debug-info`), for
   `android-x64` only, debug-signed. The probe is an alternate entrypoint in `live_probe/`; no store
   build compiles it.
2. Keeps the probe's symbols as `symbols-symbolication-probe-android-x64`, then uploads them to
   GlitchTip through `tooling/ops/upload-native-symbols.mjs` (symbolication happens at ingest, so
   the debug file must be stored before the event arrives).
3. Boots an emulator from the runner's preinstalled SDK (no third-party action: the repository
   allows `selected` actions only), runs the probe, and captures logcat. The probe initialises the
   real `TelemetryBootstrap`, throws at the line marked `SYMBOLICATION-PROBE-THROW-SITE`, reports it,
   and prints the raw non-symbolic trace between `SYMPROBE|` sentinels.
4. **Ground truth:** `native_stack_traces`' `decode translate` over that raw trace against the
   build's own `.symbols` file (version: `tooling/versions.json` `native_stack_traces`). NOT
   `flutter symbolize`: Flutter 3.47.4's tool pins native_stack_traces 0.6.1, which cannot read the
   single-text-section snapshot (`_kDartSnapshotText`, `vm_dso_base: 0`) its own engine writes
   (run 35463786607: "Cannot locate isolate instructions section in snapshot").
5. **Sink:** the GlitchTip event carrying this run's marker, read back through the API; the frame at
   the throw's address is compared with the marked line. This step runs even when step 4 failed
   (`always()`, once the marker was extracted): a sink MISMATCH exits 1, and a sink MATCH with no
   ground truth exits 2, never 0.

## Run history

| run | outcome | cause, from the kept evidence |
|---|---|---|
| 35451496350 | boot timed out (124) | `emulator.log`: `Unknown AVD name [probe]` — avdmanager and the emulator used different AVD homes. Fixed by pinning `ANDROID_AVD_HOME`. |
| 35458257697 | no BEGIN line | sentry_flutter's `DebugPrintIntegration` replaces `debugPrint` with a breadcrumb sink in release builds. Fixed by printing through `Zone.root.print`. |
| 35463786607 | ground truth exit 1; no event in GlitchTip | `flutter symbolize` too old for the 3.47.4 snapshot (above). The trace's `build_id` `bf7ded9a01540a5738031d8d50b5dd60` equals the kept `app.android-x64.symbols` note, arch x64 on both; the 0.7.0 decoder, run offline on the kept files, gives `probeThrowSite (…/symbolication_crash_probe.dart:36:3)` — the marked line. Separately, neither this run's event nor the previous one ever reached GlitchTip: the probe called `close()` right after `captureException`, cutting off the native SDK's asynchronous send. The probe no longer closes. |

Exit 0: both match. Exit 1: a mismatch (the finding). Exit 2: coverage lost (no trace, no event, no
token). Evidence is uploaded as `symbolication-proof-evidence` either way.

## Why the sink is expected to FAIL on GlitchTip 6.2.6 (source read 2026-09-19, not yet run)

- The live instance reports `"version": "6.2.6"` (`GET /api/settings/`).
- `sentry_flutter` 9.26.0 (`packages/dart/lib/src/sentry_stack_trace_factory.dart` at tag 9.26.0)
  sends each Dart AOT frame as `instructionAddr: 0x<absolute pc>, platform: native` with **no
  per-frame `image_addr`**; the isolate base goes into one `debug_meta.images` entry.
- GlitchTip v6.2.6 `apps/difs/tasks.py` picks the right debug file by `debug_id`, but
  `apps/difs/stacktrace_processor.py::resolve_native_stacktrace` never reads debug_meta's
  `image_addr`. A frame without its own `image_addr` gets `_estimate_image_base()`: the first frame's
  address slid across 4 KiB-aligned offsets, stopping at the first base under which half the sampled
  frames resolve to *any* symbol. The true offset is not in general a 4 KiB multiple, so frames land
  on real but unrelated functions: the GlitchTip issue 491 symptom (expected
  `NetworkManager.handleError()` line 156, displayed `ColorFloat64.lerp()` line 92).
- Upstream MR !2474 *"fix(difs): Use debug_meta image_addr for native symbolication"* merged
  2026-08-15, after v6.2.6 was tagged (2026-08-07); no release tag exists after v6.2.6 as of
  2026-09-19. Issue 491 is still open.

Measured on the live instance the same day: no native (Android, iOS or desktop) Flutter event has
ever reached it. Every stack-bearing issue is from the web build. So no Android trace has been read
wrongly yet; none has been checked either.

## When to dispatch it

After every GlitchTip upgrade and every `sentry_flutter` bump. Until the sink half is green, triage a
native Flutter crash from the kept `symbols-*` artefact with
`dart pub global run native_stack_traces:decode translate -d <app.android-*.symbols> -i <trace>`
(the pinned version; `flutter symbolize` on Flutter 3.47.4 cannot read the trace), not from the
GlitchTip frame. Step 4 of this workflow proves that path on every run.

```
gh workflow run symbolication-proof.yml --ref <branch>
```
