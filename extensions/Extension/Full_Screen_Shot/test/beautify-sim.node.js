/* FullShot beautify compose sim (no browser). Loads the REAL pure functions
   from pages/beautify.js and asserts layout geometry + a solid-background
   render pixel-sampled via the shared FakeCanvas shim. */
'use strict';
const { fsBeautifyLayout, fsRenderBeautified, FS_PRESETS } = require('../pages/beautify.js');
const { FakeCanvas } = require('./pixel-sim/canvas2d');

let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}
const near = (c, rgb, t) => Math.abs(c[0]-rgb[0])<=t && Math.abs(c[1]-rgb[1])<=t && Math.abs(c[2]-rgb[2])<=t;
function makeImg(w, h, rgb) {
  const d = new Uint8ClampedArray(w*h*4);
  for (let i=0;i<w*h;i++){ d[i*4]=rgb[0]; d[i*4+1]=rgb[1]; d[i*4+2]=rgb[2]; d[i*4+3]=255; }
  return { width:w, height:h, data:d };
}
const pxAt = (cv,x,y) => { const o=(y*cv.width+x)*4; return [cv._data[o],cv._data[o+1],cv._data[o+2]]; };

console.log('\n=== beautify: auto (fit to image + padding) ===');
let L = fsBeautifyLayout(800, 600, { preset:'auto', padding:64, radius:12 });
check('auto outW = img+2pad (928)', L.outW === 928, L.outW);
check('auto outH = img+2pad (728)', L.outH === 728, L.outH);
check('auto image rect = {64,64,800,600}', L.img.x===64&&L.img.y===64&&L.img.w===800&&L.img.h===600, JSON.stringify(L.img));
check('auto no window bar', L.bar === null, ''+(L.bar&&JSON.stringify(L.bar)));
check('auto scale = 1', L.scale === 1, L.scale);

console.log('\n=== beautify: OG preset 1200x630 (centered contain) ===');
L = fsBeautifyLayout(800, 600, { preset:'og', padding:64 });
check('og outW = 1200', L.outW === 1200, L.outW);
check('og outH = 630', L.outH === 630, L.outH);
check('og scale ~= 0.8367 (height-bound)', Math.abs(L.scale - 0.8367) < 0.004, L.scale);
check('og image fits inside the padding box', L.img.x>=64 && L.img.y>=64 && L.img.x+L.img.w<=1200-64+1 && L.img.y+L.img.h<=630-64+1, JSON.stringify(L.img));
check('og image horizontally centered', Math.abs(L.img.x - (1200-L.img.w)/2) <= 1, L.img.x);
check('og image vertically centered', Math.abs(L.img.y - (630-L.img.h)/2) <= 1, L.img.y);

console.log('\n=== beautify: window frame ===');
L = fsBeautifyLayout(800, 600, { preset:'auto', padding:64, frame:'window' });
check('window bar present (h=36)', !!L.bar && L.bar.h===36, L.bar&&JSON.stringify(L.bar));
check('window image sits below the bar', L.img.y === 64+36, L.img.y);
check('window outH includes the bar', L.outH === 600+36+128, L.outH);

console.log('\n=== beautify: solid-background render (pixel) ===');
const cv = new FakeCanvas();
L = fsBeautifyLayout(200, 150, { preset:'auto', padding:40 });
cv.width = L.outW; cv.height = L.outH;
fsRenderBeautified(cv.getContext('2d'), makeImg(200,150,[255,0,0]), L, { bg:{ type:'solid', color:'#334455' }, shadow:false });
check('background fills the corner (#334455)', near(pxAt(cv,2,2),[51,68,85],4), pxAt(cv,2,2).join(','));
check('padding margin shows background', near(pxAt(cv,10,Math.floor(L.outH/2)),[51,68,85],4), pxAt(cv,10,Math.floor(L.outH/2)).join(','));
const cx = L.img.x+Math.floor(L.img.w/2), cy = L.img.y+Math.floor(L.img.h/2);
check('screenshot drawn at the image rect (red)', near(pxAt(cv,cx,cy),[255,0,0],4), pxAt(cv,cx,cy).join(','));
check('image left edge inside padding (x=40)', L.img.x===40, L.img.x);

/* === sink ===
   This tier requires beautify.js's PURE core; its two failure sinks live in the
   DOM controller below that, which no sim boots. So they are graded HERE, and
   statically — stated plainly rather than left to look like execution coverage.
   Both sit in the export/copy handlers, and the export one wraps fsDownloadBlob:
   the only call on this page that hands the browser a NAME (built from the
   captured page's {domain} and {title}) and a PATH (the user's synced
   saveDirectory) rather than pixels. That is the string worth not printing. */
console.log('\n=== sink ===');
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'beautify.js'), 'utf8');
  const raw = src.match(/e\s*&&\s*e\.message\s*\|\|\s*e/g) || [];
  check('no handler interpolates a raw exception', raw.length === 0,
    raw.length ? raw.length + ' site(s)' : 'none');
  const reduced = (src.match(/fsHumanReason\s*\(/g) || []).length;
  check('both failure sinks go through the shared reducer', reduced === 2, reduced + ' call(s)');
  check('the export sink still names the action that failed',
    /Export failed/.test(src) && /Copy failed/.test(src), '');
}

console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
process.exit(FAILS ? 1 : 0);
