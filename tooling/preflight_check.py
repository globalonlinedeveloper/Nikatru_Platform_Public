#!/usr/bin/env python3
"""Pre-push integrity gate.

Run from a FRESH clone of origin (never the sandbox mount — its read cache can
serve TRUNCATED / NUL-damaged copies of freshly-written files). Flags the two
signatures that bit this project: NUL bytes, and unbalanced brackets (a tell of
a truncated tail). CI (flutter analyze + tsc) remains the authoritative gate.

    python3 tool/preflight_check.py
"""
import subprocess, sys

files = subprocess.run(
    ["git", "ls-files", "*.dart", "*.ts", "*.mjs", "*.yaml", "*.yml"],
    capture_output=True, text=True).stdout.split()

hard = 0
for f in files:
    data = open(f, "rb").read()
    if b"\x00" in data:
        print("CORRUPT (NUL bytes):", f); hard += 1; continue
    if f.endswith(".dart"):  # bracket balance is only reliable for Dart here
        t = data.decode("utf-8", "replace")
        for o, c in (("{", "}"), ("(", ")"), ("[", "]")):
            if t.count(o) != t.count(c):
                print(f"SUSPECT (unbalanced {o}{c}, may be a truncated tail):", f)
                break

print("preflight: no NUL corruption" if hard == 0 else f"PREFLIGHT FAILED: {hard} corrupt file(s)")
sys.exit(1 if hard else 0)
