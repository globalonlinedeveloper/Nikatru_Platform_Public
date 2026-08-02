// ─────────────────────────────────────────────────────────────────────────────
// inert.mjs — [pipeline 7]P-7: a pack is provably inert DATA.
//
// 🔴 THE WHOLE PACK IS ENUMERATED, not two paths inside it. The original
// criterion scoped the scan to `content.json` and `assets/`, which lets a
// root-level `.js` — the criterion's OWN worked example — walk straight past,
// because a root-level file is in neither. So the check is a MEMBER WHITELIST
// over every file found by walking the directory: anything outside
// {manifest.json, manifest.sig, content.json, PROVENANCE.json, assets/**} fails.
//
// 🔴 BYTES, NEVER EXTENSIONS. An extension is a claim a file makes about itself.
// The realistic off-format asset is LINEAR16/WAV — it arrives because nobody set
// `audioEncoding` and LINEAR16 is Chirp's default — and it arrives named `.mp3`
// as often as not.
//
// COVERAGE LOST when the enumeration returns fewer files than `manifest.assets`
// declares: a walk that stopped early looks exactly like a clean pack.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyAsset, isAllowedMember } from './formats.mjs';
import { walk } from './pack.mjs';
import { sha256Hex } from './canonical.mjs';

/** `{ members, assetVerdicts, problems, coverageLost }` for a pack on disk. */
export function inspectPack(packDir, manifest) {
  const problems = [];
  const members = walk(packDir);
  const assetMembers = members.filter((m) => m.startsWith('assets/'));
  const declared = manifest?.assets ?? [];

  if (assetMembers.length < declared.length) {
    return {
      members,
      assetVerdicts: [],
      problems,
      coverageLost:
        `the pack walk found ${assetMembers.length} file(s) under assets/ and manifest.assets declares ${declared.length}. ` +
        'A walk that stopped early is indistinguishable from a clean pack, so this is COVERAGE LOST rather than a missing-asset failure.',
    };
  }

  for (const m of members) {
    if (!isAllowedMember(m)) {
      problems.push(
        `${m} is not a member a pack may carry. Allowed: manifest.json, manifest.sig, content.json, PROVENANCE.json, assets/**. ` +
          'Anything else is a file a client would download and nothing in the format accounts for.',
      );
    }
  }

  const assetVerdicts = [];
  for (const m of assetMembers) {
    const rel = m.slice('assets/'.length);
    const bytes = readFileSync(join(packDir, m));
    const verdict = classifyAsset(rel, bytes);
    assetVerdicts.push({ path: rel, ...verdict, sha256: sha256Hex(bytes) });
    if (!verdict.ok) problems.push(`assets/${rel}: ${verdict.reason}`);
    const row = declared.find((a) => a.path === rel);
    if (!row) problems.push(`assets/${rel} is in the pack and manifest.assets does not declare it — it has no integrity hash and no provenance row`);
    else if (row.sha256 !== sha256Hex(bytes)) problems.push(`assets/${rel}: manifest sha256 ${row.sha256} does not match the bytes on disk`);
  }
  for (const a of declared) {
    if (!assetMembers.includes(`assets/${a.path}`)) problems.push(`manifest.assets declares "${a.path}" and it is not in the pack`);
  }
  return { members, assetVerdicts, problems, coverageLost: null };
}
