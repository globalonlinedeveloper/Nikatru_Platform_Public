// product-steps/pages-origin.mjs — step 2: the app's Cloudflare Pages origin is
// declared (G-a). Source: apps/<id>/app.yaml `hosts`, graded by the same pure
// function `pages-origin.mjs --check` runs. The origin is issued by Cloudflare at
// project creation, so it comes BEFORE the stamp: with no app.yaml yet it is
// still this step. The Cloudflare write is O-G1's go and the parent runs it; this
// reader only prints the command.
import { originFindings } from '../../web/pages-origin.mjs';
import { appYamlRel, readAppYaml } from './tree.mjs';

export const name = 'pages origin';
export const guard = 'node tooling/web/pages-origin.mjs --check <id>';

export function read(root, id) {
  const g = guard.replace('<id>', id);
  const next = (detail) => ({
    state: 'NEXT',
    detail,
    command: `node tooling/web/pages-origin.mjs --apply ${id}`,
    owner: "O-G1 — the owner's go for the Pages project (a Cloudflare write the parent runs, never this command); " +
      'the printed host is the stamp\'s pages_origin',
    guard: g,
  });
  const y = readAppYaml(root, id);
  if (!y.ok && y.missing) return next(`${appYamlRel(id)} does not exist yet, and the stamp needs the issued origin first`);
  if (!y.ok) return { lost: y.why };
  const findings = originFindings(y.doc, appYamlRel(id));
  if (findings.length) return next(findings[0]);
  return { state: 'DONE', detail: `hosts.pagesOrigin ${y.doc.hosts.pagesOrigin}`, guard: g };
}
