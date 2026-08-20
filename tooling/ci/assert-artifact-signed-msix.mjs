#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-artifact-signed-msix.mjs — the .msix that was BUILT carries the
// identity the register DECLARES, and carries no signature.
//
// Pipeline requirement: Private/requirements/ → F-2.
//
// ── THE LOOP THIS CLOSES ─────────────────────────────────────────────────────
// 🔴 TWO GUARDS ALREADY COMPARE THE IDENTITY AND NEITHER HAS EVER OPENED THE
// PACKAGE. tooling/ci/assert-store-metadata.mjs compares
// channel-register.json's `packageIdentity` against apps/*/pubspec.yaml's
// `msix_config` — declaration against declaration, which is worth doing and is
// not this. Between the second declaration and the shipped bytes sits
// `dart run msix:create`, and nothing in this repository has ever asked what it
// actually wrote.
//
// That is the gap assert-artifact-shape.mjs's own header names in a different
// lane: "every guard that reads a workflow reads its TEXT … the failure is that
// no step ever compared the declaration to the disk". Same shape, one artifact
// over. A package built under the wrong Identity submits cleanly and is
// UNRECOVERABLE once published — Partner Center binds the identity to the
// product, not to the upload.
//
// ── AND THE ABSENT SIGNATURE IS A POSITIVE ASSERTION, NOT A SKIPPED ONE ──────
// apps/*/pubspec.yaml sets `store: true`, which makes `msix` skip signing
// entirely because the Store re-signs on submission. The observable consequence
// is that the package contains NO `AppxSignature.p7x`. So its absence is
// EVIDENCE THAT store MODE TOOK EFFECT — the one cheap positive proof available
// that the package was built for submission rather than with a test certificate
// nobody owns. `store: false` silently re-introduces such a certificate, and
// this is what notices.
//
// ⚠️ SO THIS GUARD IS NOT THE WINDOWS TWIN OF assert-artifact-signed.mjs. That
// one proves a signature is present and pinned. This one proves a signature is
// ABSENT and an identity matches. Reading the name as "the Android check, for
// Windows" and adding a signature requirement would fail every correct package
// this factory can currently produce.
//
// ── THE SENTINEL IS THE ANSWER TODAY, AND IT IS STILL AN ASSERTION ───────────
// All three identity fields are assigned by Partner Center (OWNER_QUEUE A-2)
// and carry `notYetConfiguredSentinel` until it completes. This guard does NOT
// treat the sentinel as "skip": it requires the package to carry EXACTLY what
// the register declares, sentinel included. A package built with a plausible
// invented identity while the register still says PARTNER-CENTER-PENDING is
// precisely the unrecoverable case, and it is what this catches today.
//
// Usage:
//   node tooling/ci/assert-artifact-signed-msix.mjs [--repo-root <path>] <pkg.msix>…
// Exit 0 = every package carries the declared identity and no signature.
//      1 = one does not, or the question could not be asked.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from './apple-signing.mjs';

export const REGISTER_REL = 'tooling/channel-register.json';
export const CHANNEL_ID = 'windows-store';
export const MANIFEST_MEMBER = 'AppxManifest.xml';
export const SIGNATURE_MEMBER = 'AppxSignature.p7x';

/**
 * Identity out of an AppxManifest.xml, or null.
 *
 * Pure, and an XML ATTRIBUTE READ rather than a parse: the three values sit on
 * two well-known elements and the alternative is a dependency this repository
 * does not carry. Anchored to the element name so a `Name=` on some other
 * element cannot answer for `Identity`.
 */
export function readIdentity(xml) {
  if (typeof xml !== 'string') return null;
  const identityEl = /<Identity\b([^>]*)\/?>/.exec(xml);
  if (!identityEl) return null;
  const attr = (source, name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(source);
    return m ? m[1] : null;
  };
  const propsEl = /<Properties\b[^>]*>([\s\S]*?)<\/Properties>/.exec(xml);
  const displayName = propsEl
    ? (/<PublisherDisplayName\s*>([\s\S]*?)<\/PublisherDisplayName>/.exec(propsEl[1]) ?? [])[1] ?? null
    : null;
  return {
    identityName: attr(identityEl[1], 'Name'),
    publisher: attr(identityEl[1], 'Publisher'),
    version: attr(identityEl[1], 'Version'),
    publisherDisplayName: displayName === null ? null : displayName.trim(),
  };
}

/** Pure. The register field each manifest field must equal. */
export const IDENTITY_FIELDS = Object.freeze([
  ['identityName', 'identityName', 'Package/Identity/@Name'],
  ['publisher', 'publisher', 'Package/Identity/@Publisher'],
  ['publisherDisplayName', 'publisherDisplayName', 'Package/Properties/PublisherDisplayName'],
]);

function coverageLost(first, ...more) {
  console.error(`✗ COVERAGE LOST — ${first}`);
  for (const m of more) console.error(`    ${m}`);
  console.error('  A package nobody opened is not a package anybody checked.');
  console.error('assert-artifact-signed-msix: FAILED');
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--repo-root');
  const ROOT = resolve(rootIdx === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..', '..') : argv[rootIdx + 1]);
  const packages = argv.filter((a, i) => !a.startsWith('--') && i !== rootIdx + 1);

  // No package given is COVERAGE LOST, never a pass. The whole defect class
  // here is a check that ranged over nothing while printing a verdict.
  if (packages.length === 0) {
    coverageLost(
      'no .msix path was given, so this guard would certify the empty set.',
      'It is invoked from build-platforms.yml after `Package MSIX`. Reaching this line means the packaging',
      'step produced no path to hand over, which is itself the finding.',
    );
  }

  const registerAbs = join(ROOT, REGISTER_REL);
  if (!existsSync(registerAbs)) coverageLost(`${REGISTER_REL} does not exist under ${ROOT}, so no identity is declared to compare against.`);
  let register;
  try {
    register = JSON.parse(readFileSync(registerAbs, 'utf8'));
  } catch (e) {
    coverageLost(`${REGISTER_REL} is not valid JSON (${e.message}).`);
  }
  const row = (register.channels ?? []).find((c) => c && c.id === CHANNEL_ID);
  if (!row) coverageLost(`${REGISTER_REL} declares no channel "${CHANNEL_ID}", so the identity this package must carry is unknown.`);
  const declared = row.packageIdentity;
  if (!declared || typeof declared !== 'object') {
    coverageLost(
      `channel "${CHANNEL_ID}" declares no \`packageIdentity\`.`,
      'It is the SINGLE declaration of this identity. With it absent every comparison below would pass by',
      'having nothing to disagree with.',
    );
  }
  for (const [regField] of IDENTITY_FIELDS) {
    if (typeof declared[regField] !== 'string' || declared[regField].trim() === '') {
      coverageLost(`${REGISTER_REL} packageIdentity.${regField} is missing or empty — a hole, not a placeholder.`);
    }
  }

  const problems = [];
  const prints = [];
  let opened = 0;

  for (const rel of packages) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) {
      problems.push(`${rel} — no such file. The packaging step is declared to have produced it.`);
      continue;
    }
    const entries = unzip(readFileSync(abs));
    if (entries === null) {
      // "Could not open" and "is wrong" must never share an exit code, but this
      // one IS a failure: an .msix that is not a readable zip is not a package.
      problems.push(`${rel} — could not be read as a zip. An .msix IS a zip; one that will not open is not a package a store can accept.`);
      continue;
    }
    opened++;

    const unsupported = entries.filter((e) => e.unsupportedMethod !== undefined);
    for (const u of unsupported) {
      prints.push(`${rel} — member "${u.name}" uses compression method ${u.unsupportedMethod}, which the reader does not decode. It is named rather than skipped.`);
    }

    // ── the signature must be ABSENT, and that is the positive proof ────────
    const signature = entries.find((e) => e.name.split('/').pop() === SIGNATURE_MEMBER);
    if (signature) {
      problems.push(
        `${rel} — carries ${SIGNATURE_MEMBER}. apps/*/pubspec.yaml sets \`store: true\`, under which \`msix\` ` +
          'skips signing because the Store re-signs. A signature here means store mode did NOT take effect, and ' +
          'the likeliest cause is the test certificate `store: false` re-introduces — one nobody owns and the ' +
          'Store will reject.',
      );
    }

    const manifest = entries.find((e) => e.name.split('/').pop() === MANIFEST_MEMBER && e.bytes !== null);
    if (!manifest) {
      problems.push(`${rel} — holds ${entries.length} member(s) and no readable ${MANIFEST_MEMBER}. Every .msix carries one; without it the identity is unreadable.`);
      continue;
    }
    const seen = readIdentity(manifest.bytes.toString('utf8'));
    if (seen === null) {
      problems.push(`${rel} — ${MANIFEST_MEMBER} carries no <Identity> element, so the packaged identity cannot be read.`);
      continue;
    }

    for (const [regField, seenField, where] of IDENTITY_FIELDS) {
      const want = declared[regField];
      const got = seen[seenField];
      if (got === null) {
        problems.push(`${rel} — ${where} is absent from ${MANIFEST_MEMBER}; ${REGISTER_REL} declares ${JSON.stringify(want)}.`);
      } else if (got !== want) {
        problems.push(
          `${rel} — ${where} is ${JSON.stringify(got)} and ${REGISTER_REL} declares ${JSON.stringify(want)}. ` +
            'Partner Center binds the identity to the PRODUCT, not to the upload, so a package submitted under the ' +
            'wrong one is unrecoverable rather than re-uploadable.',
        );
      }
    }

    if (seen.version) prints.push(`${rel} — Package/Identity/@Version is ${JSON.stringify(seen.version)}, read and printed; nothing in the register declares it, so it is reported rather than compared.`);
    if (declared.notYetConfiguredSentinel && seen.identityName === declared.notYetConfiguredSentinel) {
      prints.push(
        `${rel} — the packaged identity is the NOT-YET-CONFIGURED sentinel ${JSON.stringify(declared.notYetConfiguredSentinel)}, ` +
          'which matches the register and is the correct state until OWNER_QUEUE A-2 assigns the real values. ' +
          'This package cannot be submitted, and it is not pretending it can.',
      );
    }
  }

  if (opened === 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    coverageLost(
      `${packages.length} package path(s) were given and NOT ONE opened as a zip.`,
      'Every assertion above ranged over an empty set, which looks exactly like a clean run.',
    );
  }

  if (prints.length) {
    console.log('   ── printed, not failed ──');
    for (const p of prints) console.log(`   ⬜ ${p}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('assert-artifact-signed-msix: FAILED');
    process.exit(1);
  }
  console.log(
    `ok  msix identity — ${opened} package(s) opened; each carries the ${IDENTITY_FIELDS.length} identity field(s) ` +
      `${REGISTER_REL} declares for "${CHANNEL_ID}" and NO ${SIGNATURE_MEMBER}, which is the positive evidence that ` +
      '`store: true` took effect and the Store will re-sign [pipeline F-2]',
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
