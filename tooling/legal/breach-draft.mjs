#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// breach-draft.mjs — the 72-hour personal-data-breach procedure's DRAFTS (lane
// dpdp-rights, Do 7; O-DPDP-BREACH-72H-PROCEDURE-MISSING; the CERT-In addendum).
//
// From ONE incident record (a JSON file, shaped like tooling/legal/breach/
// drill-incident.json) it drafts three documents, as Markdown, and SENDS NOTHING:
//
//   board-intimation.md       DPDP Rules 2025 rule 7(1)-(2): the intimation to the
//                             Data Protection Board — without delay, and the full
//                             account within 72 hours of becoming aware;
//   affected-user-notice.md   rule 7(1): the notice to each affected data principal;
//   certin-report.md          CERT-In Directions of 28 April 2022 (s.70B(6) IT Act):
//                             the report to incident@cert-in.org.in within 6 hours of
//                             noticing, in the Annexure's fields. The ROUTE (who
//                             sends, from which mailbox) is the owner's ruling
//                             (O-CERTIN-6H-AND-180D-LOGS); this only drafts it.
//
// A field a draft needs and the record lacks is a FINDING: exit 1, naming the field
// and the draft, and nothing is written. A half-filled statutory notice is worse
// than none, because it reads as complete.
//
// The contact details (the entity, the Grievance Officer, the address, the support
// mail) come from the entity source (tooling/entity/facts.mjs loadContext), never
// from the record and never typed here.
//
// Usage:
//   node tooling/legal/breach-draft.mjs <incident.json> [--out <dir>]
//   node tooling/legal/breach-draft.mjs --drill [--out <dir>]   (the fake record)
// Exit 0 drafted · 1 a required field missing · 2 the record or the entity
// source unreadable. Pure Node; no shell, no network (runs as-is on Windows).
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext } from '../entity/facts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DRILL_RECORD = join(HERE, 'breach', 'drill-incident.json');

/** The CERT-In address (Directions of 28 April 2022, para (ii)). */
export const CERTIN_EMAIL = 'incident@cert-in.org.in';
/** @ceiling none — statutory: hours from noticing to the CERT-In report. */
export const CERTIN_HOURS = 6;
/** @ceiling none — statutory: hours from awareness to the Board's full intimation (DPDP Rules 2025 rule 7(2)). */
export const BOARD_HOURS = 72;

/** Each draft and the record fields it cannot be written without. */
export const REQUIRED = Object.freeze({
  'board-intimation.md': ['id', 'detectedAt', 'nature', 'extent', 'location', 'likelyImpact', 'rootCause', 'personResponsible', 'mitigation', 'remediation', 'principalsAffected'],
  'affected-user-notice.md': ['id', 'detectedAt', 'nature', 'extent', 'location', 'consequencesForPrincipals', 'mitigation', 'principalSafetySteps'],
  'certin-report.md': ['id', 'detectedAt', 'occurredAt', 'detectionSource', 'certinType', 'nature', 'systems', 'symptoms', 'certinActions'],
});

const present = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');
const list = (v) => (Array.isArray(v) ? v.map((x) => `  - ${x}`).join('\n') : `  - ${v}`);
const hoursAfter = (iso, h) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

/** Every missing field, as `<draft>: <field>`. */
export function missingFields(record) {
  const out = [];
  for (const [draft, fields] of Object.entries(REQUIRED)) {
    for (const f of fields) if (!present(record?.[f])) out.push(`${draft}: ${f}`);
  }
  return out;
}

function contactBlock(ctx) {
  const o = ctx.office;
  const address = [o.floor, o.building, o.street, o.area, o.locality, o.city, o.state, o.postalCode, o.country].filter(Boolean).join(', ');
  return [
    `- Data Fiduciary: ${ctx.tradeName} (${ctx.legalName})`,
    `- Grievance Officer and contact for this matter: ${ctx.grievance.name}, ${ctx.grievance.title}`,
    `- Email: ${ctx.supportEmail}`,
    `- Phone: ${ctx.phone.display}`,
    `- Address: ${address}`,
  ].join('\n');
}

/** The three drafts for `record`, as { file: markdown }. Call missingFields first. */
export function drafts(record, ctx) {
  const drill = record.drill === true ? '> **DRILL — FAKE DATA. NOT FOR SENDING.**\n\n' : '';
  const log = (record.decisions ?? []).map((d) => `- ${d.at} · ${d.by}: ${d.decision}`).join('\n') || '- (none recorded)';
  return {
    'board-intimation.md': `${drill}# Intimation of a personal data breach to the Data Protection Board of India

Incident ${record.id}. Prepared under the Digital Personal Data Protection Rules, 2025, rule 7(1) and (2).
Became aware: ${record.detectedAt}. The full intimation is due by ${hoursAfter(record.detectedAt, BOARD_HOURS)} (${BOARD_HOURS} hours).

## Data Fiduciary
${contactBlock(ctx)}

## The breach
- Nature: ${record.nature}
- Extent: ${record.extent}
- Timing: occurred ${record.occurredAt ?? 'unknown'}; became aware ${record.detectedAt}
- Location: ${record.location}
- Data principals affected: ${record.principalsAffected}
- Likely impact: ${record.likelyImpact}

## Within 72 hours: the broad facts and what was done
- Events, circumstances and reasons leading to the breach: ${record.rootCause}
- Measures implemented or proposed to mitigate the risk: ${record.mitigation}
- Findings about the person who caused the breach: ${record.personResponsible}
- Remedial measures to prevent a recurrence: ${record.remediation}
- Intimations given to affected data principals: see affected-user-notice.md, sent to ${record.principalsAffected} principal(s) on ____ (fill in when sent).

## Decision log
${log}
`,
    'affected-user-notice.md': `${drill}Subject: A problem affecting your data at ${ctx.tradeName} (${record.id})

We are writing to tell you about a security incident that affected personal data we hold about you.

What happened: ${record.nature}
How much, when and where: ${record.extent} It happened ${record.occurredAt ?? 'at a time we are still establishing'}, and we became aware of it on ${record.detectedAt}. Location: ${record.location}

What this may mean for you: ${record.consequencesForPrincipals}

What we have done, and are doing: ${record.mitigation}

What you can do: ${record.principalSafetySteps}

Who to ask: ${ctx.grievance.name}, ${ctx.grievance.title} and Grievance Officer, at ${ctx.supportEmail} or ${ctx.phone.display}. If we do not resolve a complaint about this, you can complain to the Data Protection Board of India.
`,
    'certin-report.md': `${drill}To: ${CERTIN_EMAIL}
Subject: Cyber security incident report — ${ctx.tradeName} — ${record.id}

Reported under the CERT-In Directions of 28 April 2022 (section 70B(6), Information Technology Act, 2000), within ${CERTIN_HOURS} hours of noticing (due by ${hoursAfter(record.detectedAt, CERTIN_HOURS)}).
⚠️ Check these fields against the incident reporting form on cert-in.org.in before sending; the owner sends it (O-CERTIN-6H-AND-180D-LOGS).

## Reporting organisation
${contactBlock(ctx)}

## Incident
- Type (from the Directions' Annexure I list): ${record.certinType}
- Date and time of occurrence: ${record.occurredAt}
- Date and time of detection: ${record.detectedAt}
- How it was detected: ${record.detectionSource}
- Description: ${record.nature}
- Symptoms observed: ${record.symptoms}
- Affected systems:
${list(record.systems)}
- Actions taken: ${record.certinActions}
- Logs: ICT system logs are kept 180 days, minimised (no network address, no email address, no account id), on the boxes in India (docs/ops/boxes/ict-log-retention.sh).
`,
  };
}

function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? resolve(args[outAt + 1] ?? '') : null;
  const file = args.includes('--drill') ? DRILL_RECORD : args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
  if (!file) {
    console.error('usage: node tooling/legal/breach-draft.mjs <incident.json> | --drill [--out <dir>]');
    process.exit(2);
  }
  let record;
  let ctx;
  try {
    record = JSON.parse(readFileSync(file, 'utf8'));
    ctx = loadContext();
  } catch (err) {
    console.error(`✗ COVERAGE LOST — cannot read the incident record or the entity source: ${err.message}`);
    process.exit(2);
  }
  const missing = missingFields(record);
  if (missing.length) {
    console.error(`✗ breach drafts — ${missing.length} required field(s) missing; nothing drafted:`);
    for (const m of missing) console.error(`    ${m}`);
    process.exit(1);
  }
  const docs = drafts(record, ctx);
  for (const [name, body] of Object.entries(docs)) {
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, name), body);
      console.log(`drafted ${join(out, name)}`);
    } else {
      console.log(`──── ${name} ────\n${body}`);
    }
  }
  console.log(`ok  breach drafts — ${Object.keys(docs).length} draft(s) for ${record.id}; nothing was sent.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
