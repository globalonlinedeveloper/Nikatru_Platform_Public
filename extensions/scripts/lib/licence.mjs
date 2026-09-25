// ─────────────────────────────────────────────────────────────────────────────
// licence.mjs — read a tool's LICENSE `Required Notice:` line, and refuse a
// placeholder standing in for the licensor.
//
// PolyForm Shield's Notices section makes the `Required Notice:` line travel
// with every copy of the software, so an unfilled one ships an unnamed licensor
// in every store zip. Until 2026-09-24 FullShot's LICENSE carried
// `<OWNER LEGAL NAME OR COMPANY>` there and the template's carried `⟨LICENSOR⟩`
// (O-EXTENSION-LICENSE-NOTICE-UNFILLED). Two readers need the same answer:
// check-store-metadata.mjs grades it on every tool, and amo-metadata.mjs refuses
// to build AMO's Custom License from a placeholder.
//
// The notice is the one `Required Notice:` line that starts at column 0. The
// PolyForm text quotes an example of one (`> Required Notice: Copyright Yoyodyne,
// Inc.`) in its own Notices section, and FullShot's explanation below the rule
// echoes it indented; neither is the licensor's line. Two unindented lines are
// refused rather than chosen between.
// ─────────────────────────────────────────────────────────────────────────────

/** A token that stands in for a value instead of being one. */
const PLACEHOLDER = /<[^>]*>|⟨[^⟩]*⟩|\bOWNER ACTION\b|\bPLACEHOLDER\b/;

/**
 * @param {string} text the LICENSE file's contents
 * @returns {{ ok: true, line: string } | { ok: false, why: string }}
 */
export function requiredNotice(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const notices = lines.filter((l) => /^Required Notice:\s*\S/.test(l)).map((l) => l.trim());
  if (notices.length === 0) {
    return { ok: false, why: 'carries no unindented `Required Notice:` line, so the licensor is unnamed in every copy.' };
  }
  if (notices.length > 1) {
    return { ok: false, why: `carries ${notices.length} unindented \`Required Notice:\` lines; the licensor supplies one.` };
  }
  const line = notices[0];
  if (PLACEHOLDER.test(line)) {
    return { ok: false, why: `its Required Notice is still a placeholder: ${JSON.stringify(line)}.` };
  }
  const action = lines.find((l) => /\bOWNER ACTION\b|PLACEHOLDER\(licensor\)/.test(l));
  if (action !== undefined) {
    return { ok: false, why: `it still carries an unfilled-licensor instruction: ${JSON.stringify(action.trim())}.` };
  }
  return { ok: true, line };
}
