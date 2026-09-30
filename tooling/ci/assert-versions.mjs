#!/usr/bin/env node
// -----------------------------------------------------------------------------
// assert-versions.mjs - every pin in tooling/versions.json carries its REASON,
// and every retire condition is re-checked at the `flutter` pin it names.
//
// Finding B-8 of the round-2 review (2026-09-29). tooling/versions.json is "THE
// SINGLE DECLARATION of every version the build depends on", and two guards read
// it already: assert-version-consistency.mjs holds every call site to a value,
// and assert-update-coverage.mjs holds every key to an update mechanism. Neither
// asks WHY a value is what it is, and two things had gone unread:
//
//   1. `java` and `melos` were pinned with no reason anywhere in the file. A pin
//      with no reason cannot be judged when a bot proposes to move it, which is
//      exactly the moment it is judged.
//   2. The native_stack_traces key's retire condition named Flutter 3.47.4 while
//      the `flutter` pin had already moved to 3.47.5. The condition ("when the
//      Flutter pin moves to a tool that pins >= 0.7.0, this key can retire") is a
//      claim about THE CURRENT PIN, so a pin that moved silently orphaned it:
//      nobody re-read whether 3.47.5's tool still pins 0.6.1 (it does - measured
//      2026-09-29 at packages/flutter_tools/pubspec.yaml, tag 3.47.5).
//
// -- LIMB R (REASON) -----------------------------------------------------------
// A PIN is a top-level key that does not start with `$` and holds a string. A
// pin is REASONED by exactly one of:
//   a. its own `$<key>_comment` (a non-empty string or array of strings);
//   b. an `$updateExemptions` entry for it whose `why` is at least 40 characters
//      (the digests and the owner-advanced floors carry their reason there);
//   c. a listing in `$reasonsIn` under the group comment that holds its reason,
//      e.g. `"$scanners_comment": ["gitleaks", ...]`. The named comment must
//      exist AND name the key (as written, or with `_` read as `-`): a pointer at
//      prose that never mentions the pin is a reason that survived its subject.
// A `$reasonsIn` listing for a key that is not a pin, that is already reasoned
// by (a), or that is listed twice, is a finding too: a waiver must not outlive
// the thing it waived, and two pointers drift.
// 🔴 `$reasonsIn` is keyed by the COMMENT, never `"<pin>": "<comment>"`:
// renovate.json's customManagers match `"<pin>":\s*"<value>"` anywhere in the
// file, and that shape handed them a bogus second copy of four pins on the first
// draft (update-coverage.test.mjs U13 caught it).
//
// -- LIMB T (RETIRE) -----------------------------------------------------------
// A pin that exists only until a toolchain moves carries a `$<key>_retire`
// record: { when, atFlutter, checked, verify }. `atFlutter` is the `flutter`
// pin the condition was LAST RE-READ at, and it must EQUAL the current pin; any
// `Flutter X.Y.Z` inside `when` must equal it too. So a Flutter bump reds here
// until someone re-reads the condition at the new pin and either retires the key
// or re-dates the record. That is deliberate and costs nothing new: a Flutter
// bump already needs a person (the $flutter_comment block records why - Renovate
// cannot regenerate pubspec.lock for that pin). The field is `atFlutter`, never
// `flutter`, so renovate.json's `"flutter": "<ver>"` matcher cannot reach it.
// A `$<key>_comment` that STATES a retire condition ("can retire", "retires
// when") with no `$<key>_retire` record beside it is a finding: that is the
// shape the orphaned 3.47.4 sentence had.
//
// Exit: 0 green · 1 a finding · 2 COVERAGE LOST (the file is unreadable, holds
// no pins, or has no `flutter` pin for limb T to compare against).
//
// Usage: node tooling/ci/assert-versions.mjs [root]
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSIONS_REL = 'tooling/versions.json';
/** Shorter than this is a label, not a reason. The same 40 renovate-backlog-floor.json's basis uses. */
export const MIN_REASON_CHARS = 40;
/** A comment sentence that states a retire condition. */
export const RETIRE_CONDITION = /\bcan (?:be )?retire\b|\bretires? (?:when|once|after)\b|\bretire (?:it|this key) (?:when|once|after)\b/i;
const FLUTTER_VERSION = /\bFlutter\s+(\d+\.\d+\.\d+)\b/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const textOf = (v) => (Array.isArray(v) ? v.filter((l) => typeof l === 'string').join('\n') : typeof v === 'string' ? v : '');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Does `text` name `key` as a whole token (letters, digits and `_` are token characters)? */
export function namesKey(text, key) {
  return [key, key.replaceAll('_', '-')].some((k) => new RegExp(`(^|[^A-Za-z0-9_])${escape(k)}([^A-Za-z0-9_]|$)`).test(text));
}

/** PURE. The whole verdict over one parsed versions.json. */
export function judgeVersions(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { code: 2, lines: ['✗ COVERAGE LOST — tooling/versions.json is not a JSON object, so no pin was read.'] };
  }
  const pins = Object.keys(doc).filter((k) => !k.startsWith('$') && typeof doc[k] === 'string');
  if (pins.length === 0) {
    return { code: 2, lines: ['✗ COVERAGE LOST — tooling/versions.json holds no pin (no top-level string key without `$`); a reason check over nothing is not a pass.'] };
  }
  const flutter = doc.flutter;
  if (typeof flutter !== 'string' || !/^\d+\.\d+\.\d+$/.test(flutter)) {
    return { code: 2, lines: [`✗ COVERAGE LOST — tooling/versions.json has no \`flutter\` pin of the form X.Y.Z (read ${JSON.stringify(flutter)}), so no retire condition can be compared against it.`] };
  }
  const findings = [];
  const exemptions = Array.isArray(doc.$updateExemptions) ? doc.$updateExemptions : [];
  const reasonsIn = doc.$reasonsIn && typeof doc.$reasonsIn === 'object' && !Array.isArray(doc.$reasonsIn) ? doc.$reasonsIn : {};
  const how = new Map();

  // pin -> the group comment its reason is listed under
  const listed = new Map();
  for (const [comment, keys] of Object.entries(reasonsIn)) {
    if (comment.startsWith('_')) continue;
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
      findings.push(`✗ $reasonsIn[${JSON.stringify(comment)}] — not an array of pin names.`);
      continue;
    }
    for (const key of keys) {
      if (listed.has(key)) findings.push(`✗ $reasonsIn lists ${key} under both ${listed.get(key)} and ${comment}; two pointers drift. Keep one.`);
      else listed.set(key, comment);
    }
  }

  // -- limb R --------------------------------------------------------------
  for (const key of pins) {
    const own = textOf(doc[`$${key}_comment`]).trim();
    if (own.length > 0) {
      how.set(key, 'own comment');
      continue;
    }
    const ex = exemptions.find((e) => e?.key === key);
    if (ex && typeof ex.why === 'string' && ex.why.trim().length >= MIN_REASON_CHARS) {
      how.set(key, '$updateExemptions');
      continue;
    }
    const target = listed.get(key);
    if (target !== undefined) {
      const body = textOf(doc[target]);
      if (!target.startsWith('$') || body.trim().length === 0) {
        findings.push(`✗ ${key} — $reasonsIn lists it under ${JSON.stringify(target)}, which is not a comment in this file.`);
      } else if (!namesKey(body, key)) {
        findings.push(`✗ ${key} — $reasonsIn lists it under ${target}, which never names \`${key}\`: a pointer at prose that does not mention the pin is not its reason.`);
      } else {
        how.set(key, target);
      }
      continue;
    }
    findings.push(
      `✗ ${key} = ${JSON.stringify(doc[key])} HAS NO REASON: no $${key}_comment, no $updateExemptions entry with a why, and no $reasonsIn listing. ` +
        'Write why this value is the value, beside it.',
    );
  }
  for (const [key, target] of listed) {
    if (!pins.includes(key)) findings.push(`✗ $reasonsIn[${JSON.stringify(target)}] lists ${key}, which is not a pin in this file; the listing outlived its subject. Delete it.`);
    else if (textOf(doc[`$${key}_comment`]).trim().length > 0) findings.push(`✗ $reasonsIn[${JSON.stringify(target)}] lists ${key}, which has its own $${key}_comment; a second reason can drift. Delete it.`);
  }

  // -- limb T --------------------------------------------------------------
  const retires = Object.keys(doc).filter((k) => /^\$.+_retire$/.test(k));
  for (const rk of retires) {
    const key = rk.slice(1, -'_retire'.length);
    const r = doc[rk];
    if (!pins.includes(key)) {
      findings.push(`✗ ${rk} — ${key} is not a pin in this file; a retire record for a key that is gone has done its job. Delete it.`);
      continue;
    }
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      findings.push(`✗ ${rk} — not an object { when, atFlutter, checked, verify }.`);
      continue;
    }
    for (const f of ['when', 'verify']) {
      if (typeof r[f] !== 'string' || r[f].trim().length < MIN_REASON_CHARS) findings.push(`✗ ${rk}.${f} — missing or shorter than ${MIN_REASON_CHARS} characters.`);
    }
    if (typeof r.checked !== 'string' || !ISO_DATE.test(r.checked)) findings.push(`✗ ${rk}.checked — not a YYYY-MM-DD date.`);
    if (r.atFlutter !== flutter) {
      findings.push(
        `✗ ${rk} — its retire condition was last read at Flutter ${JSON.stringify(r.atFlutter)} and the \`flutter\` pin is ${flutter}. ` +
          `Re-read it at ${flutter} (${typeof r.verify === 'string' ? r.verify : 'its verify command'}), then retire ${key} or set atFlutter and checked.`,
      );
    }
    for (const m of String(r.when ?? '').matchAll(FLUTTER_VERSION)) {
      if (m[1] !== flutter) findings.push(`✗ ${rk}.when — names Flutter ${m[1]}, and the \`flutter\` pin is ${flutter}: the condition is about a toolchain this build no longer uses.`);
    }
  }
  for (const key of pins) {
    const comment = textOf(doc[`$${key}_comment`]);
    if (RETIRE_CONDITION.test(comment) && !retires.includes(`$${key}_retire`)) {
      findings.push(
        `✗ $${key}_comment states a retire condition and there is no $${key}_retire record, so nothing re-reads it when the \`flutter\` pin moves. ` +
          'Add { when, atFlutter, checked, verify } beside it.',
      );
    }
  }

  const tally = [...how.values()].reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map());
  const summary =
    `${pins.length} pin(s), ${how.size} reasoned (${[...tally].map(([k, n]) => `${n} by ${k}`).join(', ')}); ` +
    `${retires.length} retire record(s) read at the flutter pin ${flutter}`;
  if (findings.length > 0) return { code: 1, lines: [...findings, `assert-versions: FAILED — ${summary}`] };
  return { code: 0, lines: [`ok  assert-versions: ${summary}`] };
}

function coverageLost(message) {
  console.error(`✗ COVERAGE LOST — ${message}`);
  console.error('assert-versions: FAILED — the file was not read, so nothing about its reasons is known. That is exit 2, never a pass.');
  process.exitCode = 2;
}

function main(argv) {
  const root = resolve(argv[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  let raw;
  try {
    raw = readFileSync(join(root, VERSIONS_REL), 'utf8');
  } catch (e) {
    coverageLost(`${VERSIONS_REL} could not be read under ${root} (${e.code ?? e.message}).`);
    return;
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    coverageLost(`${VERSIONS_REL} is not JSON (${e.message}).`);
    return;
  }
  const v = judgeVersions(doc);
  for (const line of v.lines) (v.code === 0 ? console.log : console.error)(line);
  process.exitCode = v.code;
}

if (process.argv[1] && process.argv[1].endsWith('assert-versions.mjs')) main(process.argv.slice(2));
