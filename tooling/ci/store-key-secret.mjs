#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// store-key-secret.mjs — the NAME of the repository secret that holds one app's
// RevenueCat PUBLIC SDK key for one store rail. A name, never a value.
//
// O-BRICK-SELLS-NOTHING-IN-A-STORE (12a). A RevenueCat public key belongs to ONE
// RevenueCat app, and the store builds are one matrix over every app, so the key
// cannot be one secret per rail: a second app would compile in the first app's
// key and its purchases would be granted to the first app. The name is per app,
// `apps/<id>/app.yaml` `billing.mobileIap.publicKeySecrets.<field>`, and the field
// a rail reads is tooling/channel-register.json
// `purchaseRails.storeKeyDefine.secretFieldByRail.<rail>`.
//
// A store-build job runs this as a step before its builds: the refusal path, since
// an app with no billing.mobileIap stops here. Each build step maps the key from the
// STATIC named secret, `${{ secrets.<NAME> }}` (a `secrets[...]` index would hand the
// job every repository secret: LEAD RULING W46-R1). assert-channel-register limb
// 6b-iii holds NAME to what every opted-in app.yaml declares for the rail, and this
// step's `--app` to the build's own app expression.
//
// 🔴 IT NEVER READS A SECRET. It reads two declarations and prints one NAME.
//
// Usage:
//   node tooling/ci/store-key-secret.mjs --app <id> --rail <rail> [--root <dir>]
//     prints `name=<SECRET NAME>` on stdout (append it to $GITHUB_OUTPUT)
// Exit 0 = the name is printed. 1 = the app declares no billing.mobileIap, so it
// has no store key to build with. 2 = COVERAGE LOST: the app is not in this
// workspace, the rail is not one the register keys, or a declaration is unusable.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../app-yaml/yaml.mjs';

const REGISTER = 'tooling/channel-register.json';
const NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Pure over its inputs: the secret NAME for (app, rail), or a refusal.
 * → { name } | { finding } (exit 1) | { lost } (exit 2)
 */
export function storeKeySecretName(root, app, rail) {
  if (typeof app !== 'string' || !/^[a-z][a-z0-9-]*$/.test(app)) return { lost: `--app ${JSON.stringify(app ?? null)} is not an app id.` };
  let register;
  try {
    register = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  } catch (e) {
    return { lost: `${REGISTER} could not be read (${e.message}), so no rail can be resolved to a key field.` };
  }
  const byRail = register?.purchaseRails?.storeKeyDefine?.secretFieldByRail;
  if (byRail === null || typeof byRail !== 'object' || Array.isArray(byRail)) {
    return { lost: `${REGISTER} purchaseRails.storeKeyDefine.secretFieldByRail is not a { rail: field } map.` };
  }
  if (!Object.hasOwn(byRail, rail)) {
    return { lost: `--rail ${JSON.stringify(rail ?? null)} is not a rail ${REGISTER} keys (${Object.keys(byRail).join(', ')}). Only a store rail has a store SDK key.` };
  }
  const field = byRail[rail];
  const rel = `apps/${app}/app.yaml`;
  if (!existsSync(join(root, rel))) return { lost: `${rel} does not exist: "${app}" is not an app of this workspace.` };
  let doc;
  try {
    doc = parseYaml(readFileSync(join(root, rel), 'utf8'));
  } catch (e) {
    return { lost: `${rel} does not parse (${String(e.message).split('\n')[0]}).` };
  }
  const iap = doc?.billing?.mobileIap;
  if (!iap || typeof iap !== 'object') {
    return {
      finding:
        `${rel} declares no billing.mobileIap, so app "${app}" has no ${rail} store key. A store build of it would compile ` +
        'no RevenueCat key; declare the block (state: pending is enough) before its store builds run.',
    };
  }
  const name = iap.publicKeySecrets?.[field];
  if (typeof name !== 'string' || !NAME.test(name)) {
    return { lost: `${rel} billing.mobileIap.publicKeySecrets.${field} is ${JSON.stringify(name ?? null)}, not a secret name (${NAME}).` };
  }
  return { name };
}

function main(argv) {
  const opt = (o) => {
    const i = argv.indexOf(`--${o}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const root = resolve(opt('root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const r = storeKeySecretName(root, opt('app'), opt('rail'));
  if (r.lost) {
    console.error(`store-key-secret: COVERAGE LOST — ${r.lost}`);
    return 2;
  }
  if (r.finding) {
    console.error(`store-key-secret: FAIL ${r.finding}`);
    return 1;
  }
  console.log(`name=${r.name}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
