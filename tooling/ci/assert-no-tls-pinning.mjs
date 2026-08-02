#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-tls-pinning.mjs — no client pins a TLS certificate or public key,
// and no client overrides certificate trust.
//
// [pipeline 9]R-8 "No shipped client pins a TLS certificate or public key."
//
// ── THE REAL REASON, BECAUSE THE WRONG ONE IS DISMISSIBLE ────────────────────
// The wrong reason is "pinning is bad practice". Somebody will disagree, and
// they will be half right.
//
// The reason that actually binds this factory: Cloudflare Universal SSL
// AUTO-RENEWS the edge certificate in front of every hostname we serve. The
// certificate — and the key inside it — changes underneath us on a schedule we
// neither control nor can observe from inside a shipped app. A pinned client
// does not degrade when that happens. It loses the backend ENTIRELY, on every
// installed copy, at the same moment, with no server-side error to see and no
// way to push a fix except a store release that the pinned app can no longer be
// told about. On the store channels that is days. On a direct-download channel
// it is however long it takes a user to notice a dead app and go looking.
//
// So this is not a style rule. It is the one client-side change that can brick
// every install at once with a correct, unremarkable, automatic action on
// somebody else's server.
//
// ── WHAT IS MATCHED, AND WHY IT IS THE APIS AND NOT THE PACKAGES ─────────────
// TRUST-OVERRIDE APIS, matched in COMMENT-STRIPPED Dart:
//   · `badCertificateCallback`             — the four-line version of "trust
//                                             this certificate whatever it is"
//   · `SecurityContext(...)` / `setTrustedCertificates*` — a private trust root
//   · `HttpClientAdapter` / `onHttpClientCreate` assigned a client whose
//     certificate handling is overridden (Dio's shape)
//
// Package names (`http_certificate_pinning`, `ssl_pinning_plugin`, …) are
// ADVISORY ONLY and are reported as notes. A blacklist over an open set cannot
// fail on the realistic path, which is four lines in a Dio adapter and no new
// dependency at all — and a guard that only catches the named packages reports
// "clean" over exactly the implementation somebody would actually write.
//
// ── THE FALSE-ALARM SURFACE IS REAL AND IT IS LARGE ──────────────────────────
// 🔴 `packages/core/lib/src/content/pack_verifier.dart` and its neighbours
// contain ~22 lines about PINNING an Ed25519 PUBLIC KEY. That is [ADR 016],
// LOCKED, and it is DESIRABLE: it pins the key that signs our CONTENT PACKS, a
// payload we publish ourselves and can re-sign at will. It has nothing to do
// with TLS and nothing renews it behind our back. A guard that matched the word
// "pin" would fire on it on day one and be switched off within the hour — so
// the match is on TLS trust APIs only, never on the vocabulary.
//
// TEST DOUBLES ARE ALSO EXCLUDED, and by path rather than by cleverness: an
// `implements HttpClientAdapter` fake under `test/` is how a network client is
// tested without a network. Two exist in this tree today
// (`apps/subly/test/api_client_test.dart`, `packages/api_client/test/
// rest_client_test.dart`). They ship to nobody.
//
// Scope is `apps/**`, `packages/**` and `tooling/bricks/**` — the code that
// SHIPS, plus the template every future app is born from. `build/` and
// `.dart_tool/` are excluded: an unfiltered scan of this tree matches compiled
// snapshots, which are neither source nor ours.
//
// Usage:  node tooling/ci/assert-no-tls-pinning.mjs [repoRoot]
// Exit 0 = no shipped client overrides TLS trust.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** The trees whose Dart SHIPS, plus the template every stamped app inherits. */
const SCOPE = ['apps', 'packages', 'tooling/bricks'];

/** Never walked: generated output and package caches are not our source. */
const SKIP_DIRS = new Set(['build', '.dart_tool', '.git', 'node_modules', 'ephemeral', 'Pods']);

/**
 * The TLS trust overrides. Each carries the sentence that has to be true for it
 * to be a real finding, because a message that only says "banned" teaches the
 * reader nothing about why the build is red.
 */
const TRUST_OVERRIDES = [
  {
    re: /\bbadCertificateCallback\b/,
    what: 'badCertificateCallback',
    why: 'assigns the app its own verdict on whether a certificate is acceptable. Whatever it returns today, the decision has left the platform trust store and now lives in a binary that ships.',
  },
  {
    re: /\bsetTrustedCertificatesBytes\b|\bsetTrustedCertificates\b/,
    what: 'SecurityContext.setTrustedCertificates',
    why: 'installs a private trust root. When Cloudflare rotates the edge certificate this client trusts nothing it can reach, on every installed copy at once.',
  },
  {
    re: /\bnew\s+SecurityContext\s*\(|\bSecurityContext\s*\(\s*withTrustedRoots\s*:/,
    what: 'a hand-built SecurityContext',
    why: 'replaces the platform trust configuration for this client. Only the platform store follows a CA rotation; a compiled-in one cannot.',
  },
  {
    re: /\bonHttpClientCreate\b/,
    what: 'onHttpClientCreate',
    why: "is Dio's hook for reaching the underlying HttpClient, and the only reason to reach it is to change how certificates are handled.",
  },
  {
    re: /\bcreateHttpClient\b\s*[:=]/,
    what: 'a createHttpClient override',
    why: 'hands the HTTP stack a client this code configured, which is where a pin goes when nobody wants to write the word.',
  },
];

/** Advisory only — reported, never failed on. See the header. */
const PINNING_PACKAGES = /\bhttp_certificate_pinning\b|\bssl_pinning_plugin\b|\bcertificate_pinning\b/;

const problems = [];
const notes = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-no-tls-pinning: FAILED');
  process.exit(1);
}

/** Every `.dart` under `dir`, skipping generated output. */
function dartFiles(dir, out = []) {
  for (const e of listDir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      dartFiles(join(dir, e.name), out);
    } else if (e.name.endsWith('.dart')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/** A test double is not a shipped client. Matched on the PATH, deliberately:
 *  "does this look like a fake" is a judgement a regex gets wrong, and a
 *  `test/` directory is a fact. */
const isTestFile = (rel) => {
  const parts = rel.split(/[\\/]/);
  return parts.includes('test') || parts.includes('integration_test') || /_test\.dart$/.test(parts[parts.length - 1]);
};

const files = [];
for (const s of SCOPE) {
  const abs = join(ROOT, s);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
  files.push(...dartFiles(abs));
}

if (files.length === 0) {
  coverageLost([
    `scanned ${SCOPE.join(', ')} under ${ROOT} and found no .dart file at all.`,
    'This guard states an ABSENCE — no client overrides TLS trust — and an absence over an empty set is',
    'true of every tree including one where the scan is broken. There is no weaker failure than this one.',
  ]);
}

// The false-alarm surface must still be IN the scan. If the pack verifier is no
// longer being read, the scan has narrowed and the day somebody does add a pin
// beside it, nothing will see that either.
const packVerifier = files.filter((f) => /pack_verifier\.dart$/.test(f));
let shipped = 0;
let testDoubles = 0;

for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join('/');
  const raw = readFileSync(abs, 'utf8');
  const code = stripSourceComments(raw, '.dart');

  if (isTestFile(rel)) {
    testDoubles++;
    continue;
  }
  shipped++;

  for (const rule of TRUST_OVERRIDES) {
    if (!rule.re.test(code)) continue;
    const lineNo = code.split('\n').findIndex((l) => rule.re.test(l)) + 1;
    problems.push(
      `${rel}:${lineNo} uses ${rule.what}, which ${rule.why} ` +
        'Cloudflare Universal SSL auto-renews the edge certificate in front of every hostname we serve, ' +
        'so this is the one client change that can take every installed copy off the backend at once, ' +
        'with nothing to see server side and no way to ship the fix to the clients it broke.',
    );
  }
  if (PINNING_PACKAGES.test(code)) {
    notes.push(`${rel} names a certificate-pinning package. Advisory only — a package list cannot fail on the realistic path, which needs no package at all.`);
  }
}

// Pubspecs are checked too: a dependency is a declaration of intent and it is
// the one place a pin announces itself before any code exists.
let pubspecs = 0;
for (const s of SCOPE) {
  const abs = join(ROOT, s);
  if (!existsSync(abs)) continue;
  const walk = (dir) => {
    for (const e of listDir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(join(dir, e.name));
      } else if (e.name === 'pubspec.yaml') {
        pubspecs++;
        const rel = relative(ROOT, join(dir, e.name)).split(sep).join('/');
        const y = stripSourceComments(readFileSync(join(dir, e.name), 'utf8'), '.yaml');
        if (PINNING_PACKAGES.test(y)) {
          notes.push(`${rel} declares a certificate-pinning dependency. Advisory — see the header.`);
        }
      }
    }
  };
  walk(abs);
}

if (shipped === 0) {
  coverageLost([
    `every one of the ${files.length} .dart file(s) found was classified as a test double.`,
    'The shipped set is what R-8 is about; if it is empty the exclusion rule has swallowed the subject.',
  ]);
}
if (packVerifier.length === 0) {
  notes.push(
    'could-not-establish — packages/core/lib/src/content/pack_verifier.dart was not in the scan. It is ' +
      'the LOUDEST false-alarm surface in this tree ([ADR 016] pins an Ed25519 pack-signing key on ' +
      'purpose), so its absence means either the file moved or the walk narrowed. Neither is "clean".',
  );
}

if (problems.length) {
  console.error(`✗ TLS trust overrides — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 9]R-8 — no shipped client pins a TLS certificate or public key.');
  console.error('  See the header of tooling/ci/assert-no-tls-pinning.mjs for the reason that actually binds.');
  process.exit(1);
}

if (notes.length) {
  console.log('⬜ notes, printed not hidden:');
  for (const n of notes) console.log(`    ${n}`);
}

console.log(
  `ok  no TLS pinning — ${shipped} shipped .dart file(s) scanned across ${SCOPE.join(', ')} ` +
    `(${testDoubles} test double(s) excluded by path, ${pubspecs} pubspec(s) read); ` +
    `${packVerifier.length} pack-verifier file(s) in scope and correctly NOT flagged ([ADR 016] pins a ` +
    'content-pack key, which is not TLS)',
);
