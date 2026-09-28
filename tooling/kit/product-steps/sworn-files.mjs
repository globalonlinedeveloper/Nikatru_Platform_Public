// product-steps/sworn-files.mjs — step 8: the app's sworn store declarations are
// answered and sworn (NP-3a/3b). Sources: every apps/<id>/store/<channel>/*.json
// carrying a top-level boolean `"sworn"`, and apps/<id>/app.yaml
// `stores.<channel>.declaredOn`. The brick stamps each file `"sworn": false`: a
// template cannot know what an app does. Both halves are the owner's word, and
// `assert-sworn-store-files.mjs --for-submission=<channel> --app <id>` refuses a
// preview file (with --real-submission, an undeclared channel too).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readAppYaml } from './tree.mjs';

export const name = 'sworn files';
export const guard = 'node tooling/ci/assert-sworn-store-files.mjs --for-submission=<channel> --app <id> --real-submission';

/** `[{ channel, rel, sworn }]` for every store file of `id` that carries a boolean `sworn`. */
export function swornFilesOf(root, id) {
  const store = join(root, 'apps', id, 'store');
  if (!existsSync(store)) return [];
  const out = [];
  for (const channel of readdirSync(store).sort()) {
    const dir = join(store, channel);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.json')) continue;
      const rel = `apps/${id}/store/${channel}/${f}`;
      let doc;
      try {
        doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch (e) {
        return { lost: `${rel} is not valid JSON (${e.message})` };
      }
      if (typeof doc?.sworn === 'boolean') out.push({ channel, rel, sworn: doc.sworn });
    }
  }
  return out;
}

export function read(root, id) {
  const g = guard.replace('<id>', id);
  const y = readAppYaml(root, id);
  if (!y.ok && y.missing) return { state: 'NEXT', detail: 'no app.yaml yet: the stamp writes the sworn files as previews', command: 'the stamp step above', guard: g };
  if (!y.ok) return { lost: y.why };
  const files = swornFilesOf(root, id);
  if (files.lost) return { lost: files.lost };
  if (files.length === 0) return { lost: `apps/${id}/store/ holds no file with a boolean "sworn", so there is no declaration to read` };
  const preview = files.filter((f) => !f.sworn);
  const channels = [...new Set(files.map((f) => f.channel))];
  const undeclared = channels.filter((c) => (y.doc?.stores?.[c]?.declaredOn ?? null) === null);
  if (preview.length === 0 && undeclared.length === 0) {
    return { state: 'DONE', detail: `${files.length} sworn file(s) across ${channels.join(', ')}, each channel declared`, guard: g };
  }
  const parts = [];
  if (preview.length) parts.push(`${preview.length} of ${files.length} preview ("sworn": false): ${preview.map((f) => f.rel).join(', ')}`);
  if (undeclared.length) parts.push(`declaredOn null on ${undeclared.join(', ')}`);
  return {
    state: 'OWNER',
    detail: parts.join('; '),
    owner: 'O-A2 — answer and swear each declaration ("sworn": true), submit it in the store console, ' +
      'and record that date as stores.<channel>.declaredOn',
    guard: g,
  };
}
