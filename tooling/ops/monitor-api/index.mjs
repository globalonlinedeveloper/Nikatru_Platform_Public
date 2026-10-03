// ─────────────────────────────────────────────────────────────────────────────
// monitor-api/index.mjs — THE ops MONITOR API: what ensure-monitors.mjs,
// verify-monitors.mjs and set-monitor-thresholds.mjs import to read and write
// uptime monitors. The `glitchtip` adapter (./glitchtip.mjs) is the one built;
// `./fake.mjs` is the loopback fake their tests run against.
//
// Switching the monitor vendor is a new adapter beside glitchtip.mjs with the same
// exports, re-exported here; tooling/monitor-register.json stays the data either
// way, and `node tooling/ops/port-switch.mjs telemetry --to <adapter> --dry-run`
// lists the monitors it would have to recreate.
//
// 🔴 NO OPS SCRIPT CALLS THE MONITOR API ANY OTHER WAY. tooling/ci/assert-ports.mjs
// limb 9 fails a tooling/ops script outside this directory whose `fetch(` names
// a monitor route, and prints the declared exceptions.
// ─────────────────────────────────────────────────────────────────────────────
export { ADAPTER, api, BASE, listMonitors, monitorsPath, ORG, POLICY, requestBodyFrom, vaultToken } from './glitchtip.mjs';
