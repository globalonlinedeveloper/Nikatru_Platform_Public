# The build environment — what this machine can and cannot do

Referenced from [`AGENTS.md`](../AGENTS.md), which keeps only the rules that bite on every command.
The root instruction doc is capped at 8 KiB by `check-agent-docs` limb A-SIZE; a fact about the
toolchain that changes once a year is reference, not standing instruction.

Environment traps live in the private corpus, ONE place, and are queried by class rather than read:

    node ../Nikatru_Platform_Private/requirements/tooling/state.mjs --traps windows

What is on THIS page is what is not in there: properties of this checkout and this host.

The thirteen trap classes, for the `--traps` argument: `shell` `grep` `git` `ci` `auth` `agents`
`docker` `windows` `flutter` `flutter-worktrees` `backup` `vacuous` `stores`. A class returns six to
ten rows; reading `TRAPS.md` whole costs 105 KiB and its generated `traps.json` another 69 KiB of
the same 190 rows, which is how a cold session came to learn the same thing twice. The count is not
a digit written down anywhere in prose: it is `traps.json`'s own `count` fact, whose `verify` is
`grep -c '^- ' TRAPS.md`.

## Build and resolve, per toolchain

- **Dart / Flutter (Melos workspace):** `melos run gate` is analyze + test over the whole tree in
  ONE resolution. Resolve with `flutter pub get` (Flutter members need the Flutter tool); `dart
  analyze` and `dart test` work for the pure-Dart packages.
- **JS / TS:** each unit installs on its own — `npm ci` in its directory, from its committed
  `package-lock.json` — which is what CI runs. There is no root install: pnpm was retired on
  2026-09-27 because nothing ran it (`pnpm-workspace.yaml` stays as a root anchor; its header says why).
- **Workers:** deployed by `wrangler` from CI; see `services/*`.

## The checkout

- **OS:** Windows 11 Pro. Shell **PowerShell** (a Bash tool is available for POSIX scripts).
  Local-first, **no sandbox** — the guardrail is permission prompts, not isolation, so a mistake
  hits real files.
- **Long paths:** `git config --global core.longpaths true` is required. The Mason brick templates
  under `tooling/bricks/` exceed 260 characters, so a checkout without it fails part-way and leaves
  a tree that looks complete. Keep the checkout at a short base path.
- **Line endings:** the repo stores **LF** (`.gitattributes` carries `* text=auto eol=lf`). Do not
  fight it, and do not "fix" a diff that is only line endings.
- **`melos` and `mason` are not callable by their bare names from bash here** — see `CLAUDE.md`,
  which is machine-local and gitignored, for the PATH and `.bat` details.

## Local build capability is 4 of 6

**web · windows (host) · linux · android.** Android and Linux build **in WSL, never on the Windows
host**; `tooling/wsl-setup.sh` already encodes the SDK, JDK and heap gotchas, so start there rather
than re-deriving them.

**macOS and iOS are CI-only, permanently.** Apple's toolchain runs only on Apple hardware. That is a
property of the platform, not a gap to close, and no amount of local configuration changes it.

### 🔴 The Windows host genuinely cannot build Android, and it is NOT a Flutter or Gradle problem

`java.nio.channels.Selector.open()` fails for **all Java** on this host —
`SocketException: Invalid argument: connect` — proven with a six-line program and no Gradle in the
picture at all. Gradle dies in 3.7 seconds; the same build ran 192 seconds of real work in WSL.

**Do not re-diagnose this as a Gradle, Flutter or SDK problem.** It has been re-diagnosed that way
before, and every remedy aimed at the build tool leaves the JVM defect exactly where it was.
