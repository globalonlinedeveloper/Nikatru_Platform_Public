// ─────────────────────────────────────────────────────────────────────────────
// breach-draft.test.mjs — the 72-hour breach procedure's drafts (lane
// dpdp-rights, Do 7; tooling/legal/breach-draft.mjs, docs/ops/breach-response.md).
//
// The red controls the brief names: the DRILL fixture produces both statutory
// drafts (and the CERT-In report) with every required field; a record missing a
// field exits 1 and drafts nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRILL_RECORD, REQUIRED, drafts, missingFields } from '../../legal/breach-draft.mjs';
import { loadContext } from '../../entity/facts.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'legal', 'breach-draft.mjs');
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
const drill = () => JSON.parse(readFileSync(DRILL_RECORD, 'utf8'));

describe('breach-draft.mjs — drafts, never sends', () => {
  test('🔴 the DRILL record drafts all three documents, each carrying every field it requires', () => {
    const out = mkdtempSync(join(tmpdir(), 'breach-'));
    const r = run('--drill', '--out', out);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(readdirSync(out).sort(), ['affected-user-notice.md', 'board-intimation.md', 'certin-report.md']);
    const record = drill();
    for (const [file, fields] of Object.entries(REQUIRED)) {
      const body = readFileSync(join(out, file), 'utf8');
      assert.match(body, /DRILL — FAKE DATA/, `${file} is not marked as a drill`);
      for (const f of fields) {
        const v = record[f];
        for (const piece of Array.isArray(v) ? v : [v]) assert.ok(body.includes(String(piece)), `${file} lost ${f}`);
      }
    }
    assert.match(r.stdout, /nothing was sent/);
  });

  test('the drafts name the deadlines and the contacts from the entity source, never typed', () => {
    const ctx = loadContext();
    const d = drafts(drill(), ctx);
    assert.match(d['board-intimation.md'], /due by 2026-10-06T06:10:00\.000Z \(72 hours\)/);
    assert.match(d['certin-report.md'], /^To: incident@cert-in\.org\.in/m);
    assert.match(d['certin-report.md'], /due by 2026-10-03T12:10:00\.000Z/);
    for (const doc of Object.values(d)) assert.ok(doc.includes(ctx.supportEmail));
    assert.match(d['affected-user-notice.md'], /Data Protection Board of India/);
  });

  test('🔴 a record missing a required field exits 1, names it, and drafts NOTHING', () => {
    const dir = mkdtempSync(join(tmpdir(), 'breach-'));
    const record = drill();
    delete record.principalSafetySteps;
    record.systems = [];
    const file = join(dir, 'incident.json');
    writeFileSync(file, JSON.stringify(record));
    const out = join(dir, 'out');
    const r = run(file, '--out', out);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /affected-user-notice\.md: principalSafetySteps/);
    assert.match(r.stderr, /certin-report\.md: systems/);
    assert.throws(() => readdirSync(out));
  });

  test('every required field of every draft is present in the drill record (the fixture stays complete)', () => {
    assert.deepEqual(missingFields(drill()), []);
  });

  test('an unreadable record is COVERAGE LOST, not a pass', () => {
    const r = run(join(tmpdir(), 'no-such-incident.json'));
    assert.equal(r.status, 2, r.stderr);
  });
});
