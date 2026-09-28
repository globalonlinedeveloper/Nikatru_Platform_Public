// A temporary listing tree for derived-sets.test.mjs and finish-capture.test.mjs
// (O-CAPTURE-LEAVES-DERIVED-SETS-STALE, AR-D3b): a register with the apps-gov-in
// `derivedFrom` declarations and nothing else a listing guard would read, a
// captured Play phone set of four synthetic 180x320 frames (the 9:16 shape at a
// sixth of the size, as apps-gov-in-media.test.mjs draws them), its CAPTURE.json,
// the Play store icon, and an apps-gov-in directory holding only its README.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { encodeRgba } from '../../../store/png-codec.mjs';

export const APP = 'demo';
export const SHOTS = ['01-home.png', '02-calendar.png', '03-insights.png', '04-budget.png'];
export const DERIVER = 'tooling/ci/assert-apps-gov-in-media.mjs';
export const PLAY = `apps/${APP}/store/android-play`;
export const AGI = `apps/${APP}/store/apps-gov-in`;

export function image(width, height, fn) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      rgba.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}
export const frame = (seed) => encodeRgba(image(180, 320, (x, y) => [(x + seed * 40) % 256, (y * 3) % 256, (x * y + seed) % 256]), { opaque: true });

/** The register the fixture carries; `edit` mutates it before it is written. */
export function register(edit = () => {}) {
  const r = {
    channels: [
      { id: 'android-play', kind: 'store', storeMetadataDir: 'apps/{app}/store/android-play' },
      { id: 'apps-gov-in', kind: 'store', storeMetadataDir: 'apps/{app}/store/apps-gov-in' },
      { id: 'linux-snap', kind: 'store', storeMetadataDir: 'apps/{app}/store/linux-snap' },
    ],
    storeMetadataContract: {
      perChannel: {
        'android-play': {
          graphicAssets: {
            assets: { 'store-icon-512.png': { generatedBy: 'tooling/store/render-play-graphics.mjs' } },
            screenshots: { dir: 'screenshots', provenanceFile: 'CAPTURE.json', deviceTypeCoverage: { sets: { phone: { dir: 'screenshots' } } } },
          },
        },
        'linux-snap': {
          graphicAssets: { screenshots: { dir: 'screenshots', provenanceFile: 'CAPTURE.json', deviceTypeCoverage: { sets: { desktop: { dir: 'screenshots' } } } } },
        },
        'apps-gov-in': {
          graphicAssets: {
            assets: { 'store-icon-512.png': { derivedFrom: { channel: 'android-play', set: 'store-icon-512.png', deriver: DERIVER } } },
            derivedScreenshots: { dir: 'screenshots', derivedFrom: { channel: 'android-play', set: 'screenshots', deriver: DERIVER } },
          },
        },
      },
    },
  };
  edit(r);
  return r;
}

/** A fresh tree: the capture made, nothing derived yet. Returns its root. */
export function makeTree({ edit } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nk-derived-sets-'));
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'channel-register.json'), `${JSON.stringify(register(edit), null, 2)}\n`);
  mkdirSync(join(root, PLAY, 'screenshots'), { recursive: true });
  mkdirSync(join(root, AGI, 'screenshots'), { recursive: true });
  SHOTS.forEach((n, i) => writeFileSync(join(root, PLAY, 'screenshots', n), frame(i)));
  writeFileSync(join(root, PLAY, 'screenshots', 'CAPTURE.json'), `${JSON.stringify({ posture: 'live', deviceType: 'phone', viewport: '360x640@3', pixels: '1080x1920', count: 4 }, null, 2)}\n`);
  writeFileSync(join(root, PLAY, 'screenshots', 'README.md'), '# Play phone set\n\nCaptured by the Store screenshots lane; finished by tooling/store/finish-capture.mjs.\n');
  writeFileSync(join(root, PLAY, 'store-icon-512.png'), encodeRgba(image(8, 8, (x, y) => [x * 30, y * 30, 99, 255])));
  writeFileSync(join(root, AGI, 'screenshots', 'README.md'), '# apps.gov.in set\n\nDerived; see CAPTURE.json.\n');
  return root;
}

/** Every file under `root`, as { relPath: sha256 }, sorted. */
export function snapshot(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const n of readdirSync(dir).sort()) {
      const abs = join(dir, n);
      const r = rel ? `${rel}/${n}` : n;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else out[r] = createHash('sha256').update(readFileSync(abs)).digest('hex');
    }
  };
  walk(root, '');
  return out;
}
