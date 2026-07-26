# windows-setup.ps1 - take a Windows host from bare to a working build environment,
# and then PROVE it works. [pipeline F-3]
#
# The WSL half of this already exists (tooling/wsl-setup.sh). The Windows half was
# prose in CLAUDE.md, followed by hand.
#
# WHY THE ASSERTIONS ARE THE POINT, not the installing: every Windows failure this
# project has actually hit reported the WRONG CAUSE.
#
#   "Cannot open include file: 'atlstr.h'"   really: the ATL sub-component is not
#                                            installed. VS2022 "Desktop C++" does
#                                            not include it, and `flutter doctor`
#                                            still prints a tick for Visual Studio.
#                                            (2026-07-25: first misdiagnosed as the
#                                            long-path gotcha - the path was 78.)
#
#   "No CMAKE_CXX_COMPILER could be found"   really: the base path was 183 chars.
#                                            The compiler was fine. A 27-char path
#                                            fixed it instantly.
#
#   a clone failing on some deep path        really: core.longpaths is unset. It is
#                                            a GLOBAL git config, so it is in no
#                                            repo and travels with no clone, while
#                                            tooling/bricks/ templates exceed 260.
#
# So: one check per known failure, each naming the REAL cause and the fix. That is
# the same bet wsl-setup.sh makes with its `Selector.open()` line - one assertion
# beats a six-minute build failure that blames the wrong component.
#
# WHY IT MATTERS NOW: F-7a/F-7b made the DATA recoverable (notes, vault, keystore,
# and the code itself as git bundles). This is what makes the ABILITY TO BUILD
# recoverable. Without it a restore hands you a complete repository you cannot
# compile, and you rediscover the ATL gap from scratch.
#
# Usage:
#   .\tooling\windows-setup.ps1              # check the current host
#   .\tooling\windows-setup.ps1 -Fix         # also apply what can be applied safely
#
# TESTABILITY SEAM (the -Override* params): the acceptance criterion for this
# requirement is "runs clean twice on a FRESH host", and a configured machine
# cannot produce that evidence - every check would pass trivially, which is an
# assertion that cannot fail. The overrides let each check be fed a KNOWN-BROKEN
# condition without touching the real machine, so the checks are proven able to
# fail. Real runs pass none of them.
#
# Exit 0 = every required check passed. 1 = at least one failed.

param(
    [switch]$Fix,
    [switch]$Quiet,
    [string]$OverrideRepoPath,
    [string]$OverrideLongPaths,
    [string]$OverrideVsRoot,
    [string]$OverrideFlutterVersion
)

$ErrorActionPreference = 'Stop'

$repoRoot = if ($OverrideRepoPath) { $OverrideRepoPath } else { Split-Path $PSScriptRoot -Parent }

$script:Failures = @()
$script:Warnings = @()

function Say([string]$m, [string]$colour = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $colour } }
function Pass([string]$name) { Say "  PASS  $name" 'Green' }
function Fail([string]$name, [string]$cause, [string]$fix) {
    Say "  FAIL  $name" 'Red'
    Say "        cause: $cause" 'DarkGray'
    Say "        fix:   $fix" 'DarkGray'
    $script:Failures += $name
}
function Warn([string]$name, [string]$why) {
    Say "  WARN  $name" 'Yellow'
    Say "        $why" 'DarkGray'
    $script:Warnings += $name
}

Say "windows-setup - checking this host" 'Cyan'

# ── 1. git core.longpaths (GLOBAL, so it is in no repo and no clone) ──────────
$longPaths = if ($PSBoundParameters.ContainsKey('OverrideLongPaths')) {
    $OverrideLongPaths
} else {
    (& git config --global core.longpaths) 2>$null
}
if ($longPaths -eq 'true') {
    Pass 'git core.longpaths is true (global)'
} elseif ($Fix -and -not $PSBoundParameters.ContainsKey('OverrideLongPaths')) {
    & git config --global core.longpaths true
    Pass 'git core.longpaths set to true (global)'
} else {
    Fail 'git core.longpaths' `
         "it is '$longPaths'. This is a GLOBAL setting, so it lives in no repo and arrives with no clone." `
         'git config --global core.longpaths true    (or re-run with -Fix)'
}

# ── 2. base path length ──────────────────────────────────────────────────────
# tooling/bricks/ template paths add ~180 chars on top of the repo root, and
# Windows' classic limit is 260. A 183-char root produced a CMake error naming
# the COMPILER; a 27-char root fixed it instantly.
$rootLen = $repoRoot.Length
if ($rootLen -le 100) {
    Pass "repo base path is $rootLen chars"
} else {
    Fail 'repo base path length' `
         "the root is $rootLen chars; brick template paths add ~180 on top, against a 260 limit. This surfaces as 'No CMAKE_CXX_COMPILER could be found', which blames the compiler." `
         'clone to a short base path, e.g. C:\dev\nikatru'
}

# ── 3. Visual Studio C++ AND the ATL sub-component ───────────────────────────
# The whole point: `flutter doctor` prints a tick for Visual Studio while ATL is
# missing, and the build then fails naming a header file.
$vsRoot = $OverrideVsRoot
if (-not $vsRoot) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vsRoot = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    }
}
if (-not $vsRoot -or -not (Test-Path $vsRoot)) {
    Fail 'Visual Studio C++ toolchain' `
         'no VS installation with the C++ tools was found.' `
         'install VS 2022 with "Desktop development with C++"'
} else {
    $atl = Get-ChildItem -Path $vsRoot -Filter 'atlstr.h' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($atl) {
        Pass 'ATL is installed (atlstr.h found in the VS tree)'
    } else {
        Fail 'ATL sub-component' `
             "atlstr.h exists nowhere under $vsRoot. VS2022 'Desktop development with C++' does NOT include ATL, and flutter doctor still reports Visual Studio as OK - so the build fails later naming a header instead of the missing component." `
             'install component Microsoft.VisualStudio.Component.VC.ATL (VS Installer > Modify > Individual components). Note: vs_installer DETACHES - exit code 0 then manifest cleanup in the log means DONE, not stuck.'
    }
}

# ── 4. Flutter pinned to the declared version ────────────────────────────────
$declared = $null
$versionsFile = Join-Path $repoRoot 'tooling\versions.json'
if (Test-Path $versionsFile) {
    $declared = (Get-Content $versionsFile -Raw | ConvertFrom-Json).flutter
}
$actual = if ($PSBoundParameters.ContainsKey('OverrideFlutterVersion')) {
    $OverrideFlutterVersion
} else {
    $v = (& flutter --version 2>$null | Select-Object -First 1)
    if ($v -match 'Flutter\s+(\S+)') { $Matches[1] } else { $null }
}
if (-not $declared) {
    Warn 'flutter version' "tooling/versions.json not found under $repoRoot - cannot compare."
} elseif ($actual -eq $declared) {
    Pass "flutter is $actual (matches versions.json)"
} else {
    Fail 'flutter version' `
         "this host has '$actual' but tooling/versions.json declares '$declared'. A different SDK builds a different app from the same commit." `
         "install Flutter $declared, or change tooling/versions.json if the bump is intended"
}

# ── 5. Advisory: things this host does NOT need, and why ─────────────────────
# Android and Linux build in WSL on purpose - java.nio.channels.Selector.open()
# fails for ALL Java on this Windows host (root-caused 2026-07-25), which kills
# Gradle at startup. That is a property of the host, not a gap to close here.
if (Get-Command wsl -ErrorAction SilentlyContinue) {
    Say '  note  WSL present - Android and Linux build there (Selector.open() fails on Windows)' 'DarkGray'
} else {
    Warn 'WSL not found' 'Android and Linux builds run in WSL. Windows-only is fine for web + windows targets.'
}
Say '  note  macOS and iOS are CI-only, permanently - Apple tooling runs only on Apple hardware' 'DarkGray'

# ── result ───────────────────────────────────────────────────────────────────
Say ''
if ($script:Failures.Count -gt 0) {
    Say "FAILED - $($script:Failures.Count) check(s): $($script:Failures -join ', ')" 'Red'
    exit 1
}
if ($script:Warnings.Count -gt 0) {
    Say "OK with $($script:Warnings.Count) warning(s): $($script:Warnings -join ', ')" 'Yellow'
} else {
    Say 'OK - this host can build web and windows targets' 'Green'
}
exit 0
