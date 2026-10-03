// ─────────────────────────────────────────────────────────────────────────────
// brick-auth-config-names.test.mjs — A STAMPED APP NAMES ITS IDENTITY CONFIG FOR
// WHAT IT IS, NOT FOR THE VENDOR THAT SERVES IT.
//
// ⏱ 2026-10-03 · port-auth (tooling/ports/auth.json). `AppConfig.authEndpoint`
// and `AppConfig.authPublicKey` replaced `supabaseUrl` and `supabaseAnonKey`;
// the old names stay one release as `@Deprecated` aliases of the new ones, and
// NOTHING in the brick may read them (pipeline-first: the template is what
// every future app is stamped from). The brick's own
// test/backend_liveness_test.dart walks `isBackendLive` to the new names once
// stamped; this is the unstamped half, run on every build.
//
// RED CONTROL (below): the template with `isBackendLive` or `main.dart` back on
// an old name fails, naming the file.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { listDir } from '../tree-walk.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BRICK = 'tooling/bricks/app/__brick__';
const CONFIG = `${BRICK}/apps/{{app_id}}/lib/core/app_config.dart`;
const OLD = ['supabaseUrl', 'supabaseAnonKey'];
const NEW = ['authEndpoint', 'authPublicKey'];

/** Every .dart file under `rel`, repo-relative. */
function dartFiles(rel, out = []) {
  for (const e of listDir(join(REPO, rel), { withFileTypes: true })) {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) dartFiles(p, out);
    else if (e.name.endsWith('.dart')) out.push(p);
  }
  return out;
}

/** The lines of `text` (comments dropped) that READ an old name: anything but its alias declaration. */
export function oldNameReads(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const name of OLD) {
      if (!new RegExp(`\\b${name}\\b`).test(code)) continue;
      if (new RegExp(`static const String ${name} = auth(?:Endpoint|PublicKey);`).test(code)) continue;
      hits.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

describe('the brick names the identity config by port, not by vendor', () => {
  const files = dartFiles(BRICK);

  test('the scan reaches the brick (a scan of nothing proves nothing)', () => {
    assert.ok(files.includes(CONFIG), `${CONFIG} was not walked`);
    assert.ok(files.length > 20, `only ${files.length} brick .dart file(s) walked`);
  });

  test('AppConfig declares the new names from the SAME dart-defines', () => {
    const src = readFileSync(join(REPO, CONFIG), 'utf8');
    for (const [name, define] of [['authEndpoint', 'SUPABASE_URL'], ['authPublicKey', 'SUPABASE_ANON_KEY']]) {
      assert.match(src, new RegExp(`static const String ${name} = String\\.fromEnvironment\\(\\s*'${define}'`));
    }
    for (const name of OLD) assert.match(src, new RegExp(`@Deprecated\\([^)]*\\)\\s*static const String ${name} = auth`), `${name} is not a deprecated alias`);
  });

  test('no brick file reads an old name', () => {
    const offenders = files.flatMap((f) => oldNameReads(readFileSync(join(REPO, f), 'utf8')).map((h) => `${f}:${h}`));
    assert.deepEqual(offenders, []);
  });

  test('isBackendLive and main.dart read the new names', () => {
    const src = readFileSync(join(REPO, CONFIG), 'utf8');
    const live = /static bool get isBackendLive =>([^;]*);/.exec(src)?.[1] ?? '';
    for (const name of NEW) assert.match(live, new RegExp(`\\b${name}\\b`));
    const main = readFileSync(join(REPO, `${BRICK}/apps/{{app_id}}/lib/main.dart`), 'utf8');
    for (const name of NEW) assert.match(main, new RegExp(`AppConfig\\.${name}\\b`));
  });

  test('🔴 RED CONTROL: the template back on an old name is named', () => {
    const src = readFileSync(join(REPO, CONFIG), 'utf8');
    const mutated = src.replace('authEndpoint.isNotEmpty && authPublicKey.isNotEmpty', 'supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty');
    assert.notEqual(mutated, src, 'the mutation found nothing to change');
    assert.equal(oldNameReads(mutated).length, 2);
    assert.deepEqual(oldNameReads('          url: AppConfig.supabaseUrl,').length, 1);
    assert.deepEqual(oldNameReads('  static const String supabaseUrl = authEndpoint;'), []);
  });
});
