#!/usr/bin/env node
// [pipeline C-16] The rule: no chassis requirement lands without an assertion in
// the stamped app's own property test.
//
// WHY. CI's `app_brick` lane stamps a throwaway app, compiles it and runs its
// tests — and that is all. So a capability that is merely ABSENT passes: before
// this landed, `themeMode` appeared zero times repo-wide, `Semantics(` zero
// times, and the account-delete button called `Navigator.pop` and nothing else.
// All three were green.
//
// The assertions themselves live in the BRICK TEMPLATE (owner decision
// 2026-07-27) so every stamped app inherits them and keeps checking itself for
// life. This guard defends that file: if it is deleted, emptied, or stops
// covering a declared property, the build fails. Without it the property test is
// one careless commit from vanishing, and vanishing looks exactly like passing.
//
// TO ADD A PROPERTY: land its assertion in the template test, then add its key
// here. The list is the contract; the file is the implementation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.cwd();
let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const PROP_TEST = `${BRICK}/test/chassis_properties_test.dart`;
const APP_ROOT = `${BRICK}/lib/app.dart`;

// REQUIRED_COVERAGE. Each entry is a property the stamped app must assert about
// itself. `group` is the marker the test file must declare; `source` is the line
// in the app that the property is about, so a deleted implementation is caught
// even if somebody leaves a hollow test behind.
const REQUIRED_COVERAGE = [
  {
    key: 'theme-mode-persisted',
    group: /group\(\s*'property: theme-mode-persisted'/,
    why: 'a stored light/dark choice must survive a restart',
  },
  {
    key: 'theme-triplet-supplied',
    group: /group\(\s*'property: theme-triplet-supplied'/,
    source: { file: APP_ROOT, re: /themeMode:\s*ref\.watch\(themeModeProvider\)/, what: 'app.dart must pass themeMode to MaterialApp' },
    why: 'theme + darkTheme + themeMode must all reach MaterialApp',
  },
  {
    key: 'analytics-consent-gated',
    group: /group\(\s*'property: analytics-consent-gated'/,
    source: { file: `${BRICK}/lib/state/providers.dart`, re: /ConsentPurpose\.analytics\s*,[\s\S]{0,200}?granted:\s*granted/, what: 'the template must really call ConsentController.record' },
    why: 'a stamped app must refuse without consent AND deliver with it',
  },
  {
    key: 'analytics-on-switch-mounted',
    // NOT /AnalyticsGate\(/ — that matches the constructor DECLARATION, so the
    // check passed with the gate deleted from app.dart. Same declaration-vs-caller
    // trap that shipped in assert-seams-wired.mjs earlier today; caught here by
    // mutating the real tree rather than a fixture.
    group: /group\(\s*'property: analytics-on-switch-mounted'/,
    source: { file: APP_ROOT, re: /child:\s*AnalyticsGate\(/, what: 'app.dart must mount AnalyticsGate — the analytics on-switch' },
    why: 'the rail is fail-closed: with nothing calling record() it goes silent and no test goes red',
  },
];

let test;
try {
  test = readFileSync(join(repo, PROP_TEST), 'utf8');
} catch {
  fail(`${PROP_TEST} is MISSING. Every stamped app inherits its property assertions from this file; without it a stamped app asserts nothing about its own behaviour.`);
  console.error('\nassert-stamp-properties: FAILED');
  process.exit(1);
}

// COVERAGE SELF-CHECK. A file that still exists but has been emptied of tests
// would satisfy every `group` regex below only if they were also removed — but a
// file gutted down to one token would otherwise pass the "exists" check alone.
const blocks = (test.match(/\b(?:test|testWidgets)\(/g) ?? []).length;
const MIN_BLOCKS = 12;
if (blocks < MIN_BLOCKS) {
  fail(`COVERAGE LOST — ${PROP_TEST} declares only ${blocks} test block(s), expected >= ${MIN_BLOCKS}. The file exists but has stopped asserting.`);
} else {
  ok(`property test declares ${blocks} assertion block(s)`);
}

for (const p of REQUIRED_COVERAGE) {
  if (!p.group.test(test)) {
    fail(`property '${p.key}' is NOT asserted in ${PROP_TEST} — ${p.why}`);
    continue;
  }
  if (p.source) {
    let src = '';
    try {
      src = readFileSync(join(repo, p.source.file), 'utf8');
    } catch {
      fail(`property '${p.key}': ${p.source.file} could not be read`);
      continue;
    }
    if (!p.source.re.test(src)) {
      fail(`property '${p.key}' is asserted but its IMPLEMENTATION is gone — ${p.source.what}`);
      continue;
    }
  }
  ok(`property '${p.key}' asserted${p.source ? ' and implemented' : ''}`);
}

if (failed) {
  console.error('\nassert-stamp-properties: FAILED');
  process.exitCode = 1;
} else {
  console.log(`\nassert-stamp-properties: ok — ${REQUIRED_COVERAGE.length} property/properties enforced`);
}
