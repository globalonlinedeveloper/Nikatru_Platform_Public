// ─────────────────────────────────────────────────────────────────────────────
// tooling/ops/vitals/grade.mjs — A RATE AGAINST ITS THRESHOLD ROW, AND WHAT GOT
// WORSE SINCE THE LAST RUN (crash-rates).
//
//   green | amber | red  — a READ rate against the metric's row in
//                          thresholds.json: red past the limit (`redWhen`),
//                          amber from `amberFraction` of it, green below;
//   no-data              — the store answered with nothing: GREY, never a pass;
//   unreadable           — the credential is missing or refused: never red, never green;
//   no-source            — the store exposes no such data;
//   no-threshold         — read, but no row grades this metric (reported, not judged).
// ─────────────────────────────────────────────────────────────────────────────

/** Ordered: a higher rank is worse. Only these three are comparable between runs. */
export const RANK = { green: 0, amber: 1, red: 2 };

/** The grade of one reading, given the thresholds register. Throws when a graded metric has no row. */
export function gradeReading(r, register) {
  if (r.status === 'no-data' || r.status === 'unreadable' || r.status === 'no-source') return r.status;
  const row = register.metrics?.[r.metric];
  if (!row) {
    if (r.metric === 'crash' || r.metric === 'anr') throw new Error(`thresholds.json has no row for the graded metric \`${r.metric}\``);
    return 'no-threshold';
  }
  if (typeof row.value !== 'number' || !(row.value > 0) || typeof row.asOf !== 'string' || typeof row.verify !== 'string' || typeof row.source !== 'string') {
    throw new Error(`thresholds.json row \`${r.metric}\` needs {value, asOf, verify, source}`);
  }
  const amberFrom = row.value * (typeof register.amberFraction === 'number' ? register.amberFraction : 0.8);
  const red = row.redWhen === 'atOrAbove' ? r.value >= row.value : r.value > row.value;
  if (red) return 'red';
  return r.value >= amberFrom ? 'amber' : 'green';
}

/**
 * The channels whose grade WORSENED since `prev` (a map key → last KNOWN grade):
 * a comparable grade above the previous known one, or a first amber/red where
 * nothing was known. An unreadable, no-data or no-source run does not erase
 * what was known, so a red → unreadable → red sequence pages once, not twice.
 */
export function worsened(prev, now) {
  const out = [];
  for (const [key, grade] of Object.entries(now)) {
    if (!(grade in RANK)) continue;
    const before = prev[key];
    const b = before in RANK ? RANK[before] : RANK.green;
    if (RANK[grade] > b) out.push({ key, from: before ?? 'unknown', to: grade });
  }
  return out;
}

/** The next state: every comparable grade now, every key not read keeping its last known grade. */
export function nextState(prev, now) {
  const out = { ...prev };
  for (const [key, grade] of Object.entries(now)) if (grade in RANK) out[key] = grade;
  return out;
}
