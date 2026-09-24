# Captured Apple tool output — run 35741818599

The three `.txt` files here are REAL output from the `apple` job of
`.github/workflows/build-platforms.yml`, captured from one run. The two Apple
guards' suites feed them through each guard's `main({ run })`, the same path CI
takes. This README is the only place the citation lives, because the fixture
files have to stay byte-equal to the log.

| | |
|---|---|
| Run | 35741818599 |
| Job | 106795445283 |
| Commit on main | f0e85f99 |
| Date | 2026-09-22 |
| Capture | `Private/research/session-2026-09-21/apple-real-output-run-35741818599.txt` |

| File | What ran | Capture lines | Job-log lines | Lines |
|---|---|---|---|---|
| `xcodebuild-version.txt` | `xcodebuild -version` | 13-14 | 414-415 | 2 |
| `codesign-ipa-payload.txt` | `codesign -dv --verbose=4` over the `.ipa`'s `Payload/Runner.app` | 57-84 | 1162-1189 | 28 |
| `codesign-macos-app.txt` | `codesign -dv --verbose=4` over the `.app` the `.pkg` wraps | 98-124 | 1224-1250 | 27 |

## The two substitutions, and nothing else

1. The runner's leading timestamp (`YYYY-MM-DDTHH:MM:SS.fffffffZ `) is stripped
   from every line.
2. Every `***` is replaced by `A1B2C3D4E5`. GitHub printed `***` because the
   team identifier is the `APPLE_TEAM_ID` secret, and `A1B2C3D4E5` is the
   placeholder team the tests already use (`TEAM` in
   `artifact-signed-apple.test.mjs`).

The leaf certificate's personal name already reads `<PERSONAL-NAME>` in the
capture and is kept as it is. No real name and no real team identifier appears
in this directory.

The `.ipa` payload's report prints `Executable=` twice, once first and once
after `Executable Segment flags=0x1`. That is the tool's output, and both lines
are kept; the `.app` report prints it once, which is why it is a line shorter.

Each `Signed Time=` line carries a U+202F NARROW NO-BREAK SPACE before `PM`, as
the runner's macOS printed it. It is kept; an editor that turns it into a plain
space makes the file differ from the log.

The capture holds no `pkgutil --check-signature` output, so there is no `.pkg`
fixture here.

Row: O-APPLE-GUARDS-PARSE-HAND-WRITTEN-OUTPUT.
