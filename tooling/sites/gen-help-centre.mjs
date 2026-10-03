#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gen-help-centre.mjs — the help centre's place in the site chain (lane
// help-search). tooling/help/build-index.mjs is the generator: it builds the
// search index from content/help/ and writes the /help/ pages, the apps' Dart
// table, the extensions' bundles and the conformance fixture. This file is its
// tooling/sites/regen.mjs ORDER entry, so the stamp, the regen chain and
// ci.yml's `regen --check` reach it the way they reach every site generator.
//
// Usage:  node tooling/sites/gen-help-centre.mjs [repoRoot] [--check]
// Exits exactly as build-index.mjs does: 0 current/written · 1 a finding · 2
// COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../help/build-index.mjs';

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
