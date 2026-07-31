#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# patch-flutter-macos-aot.py — SDK-side workaround for flutter/flutter#188060.
#
# `flutter build macos --release` aborts in gen_snapshot with
#   Unexpected object (Class with illegal cid, full-aot):
#   Library:'package:flutter/src/widgets/_window_macos.dart' Class: _Rect
# — an upstream Flutter 3.44.x regression (VM failure class dart-lang/sdk#50540):
# the AOT tree shaker drops the private FFI-struct classes in _window_macos.dart
# while instances survive in the snapshot's object graph. Established in-repo by
# eleven probe runs (see tooling/versions.json $flutter_comment): triggered by
# any compile-reachable showDialog/ConsumerState construct, macOS target only.
#
# The workaround marks the five structs @pragma('vm:entry-point') so the tree
# shaker must keep them. It patches the RUNNER'S SDK copy, so it must run before
# every macOS build and be IDEMPOTENT — the SDK cache persists between runs and
# a flutter upgrade silently reverts it.
#
# FAILS LOUDLY on anything unexpected: a missing file, zero classes found, or a
# class list that no longer matches the SDK means the SDK moved and this patch
# must be re-derived, not skipped — silence here would resurrect the abort with
# no diff in this repo. Drop this script the day upstream fixes #188060.
#
# Usage:  python3 tooling/ci/patch-flutter-macos-aot.py <path-to-flutter-root>
# ─────────────────────────────────────────────────────────────────────────────
import re
import sys
from pathlib import Path

CLASSES = ['_WindowCreationRequest', '_Size', '_Offset', '_Rect', '_Constraints']
PRAGMA = "@pragma('vm:entry-point')"

if len(sys.argv) != 2:
    sys.exit('usage: patch-flutter-macos-aot.py <flutter-root>')

target = Path(sys.argv[1]) / 'packages/flutter/lib/src/widgets/_window_macos.dart'
if not target.is_file():
    sys.exit(f'FAIL: {target} does not exist — the SDK layout moved; re-derive this patch.')

src = target.read_text(encoding='utf-8')
patched, already, missing = 0, 0, []

for name in CLASSES:
    # The declaration line, with optional modifiers (final/base/sealed).
    decl = re.compile(r'^((?:final |base |sealed )*class %s[\s({<])' % re.escape(name), re.M)
    m = decl.search(src)
    if not m:
        missing.append(name)
        continue
    before = src[:m.start()].rstrip('\n')
    if before.endswith(PRAGMA):
        already += 1
        continue
    src = src[:m.start()] + PRAGMA + '\n' + src[m.start():]
    patched += 1

if missing:
    sys.exit(
        f'FAIL: class(es) {missing} not found in {target}. The SDK changed shape — '
        're-derive this patch against the new file rather than building without it.'
    )

target.write_text(src, encoding='utf-8')
print(f'ok  {target}: {patched} class(es) newly pragma-marked, {already} already marked')
