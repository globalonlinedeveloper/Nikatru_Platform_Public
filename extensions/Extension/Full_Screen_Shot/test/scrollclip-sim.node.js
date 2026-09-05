/* FullShot scroll-clip sim (no browser). Loads the REAL pure functions from
   pages/scrollclip.js and asserts (a) scroll-frame geometry, (b) a rendered
   frame pixel-sampled via the shared FakeCanvas shim, and (c) the from-scratch
   GIF89a encoder — structural validity PLUS a full LZW round-trip decode of the
   pixels (the strongest check possible without a browser). WebM (MediaRecorder)
   is browser-only and is verified on-device, not here (documented boundary). */
'use strict';
const { fsScrollFrames, fsRenderScrollFrame, fsEncodeGIF, fsEncodeGIFAsync } = require('../pages/scrollclip.js');
const { FakeCanvas } = require('./pixel-sim/canvas2d');

let FAILS = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra != null ? '  — ' + extra : ''));
  if (!ok) FAILS++;
}
const near = (c, rgb, t) => Math.abs(c[0]-rgb[0])<=t && Math.abs(c[1]-rgb[1])<=t && Math.abs(c[2]-rgb[2])<=t;
const pxAt = (cv,x,y) => { const o=(y*cv.width+x)*4; return [cv._data[o],cv._data[o+1],cv._data[o+2]]; };

/* ---- build an RGBA frame with horizontal color bands ---- */
function bandsImg(w, h, bands) { // bands: [{from,to,rgb}]
  const d = new Uint8ClampedArray(w*h*4);
  for (let y=0;y<h;y++){
    let rgb=[0,0,0];
    for (const b of bands) if (y>=b.from && y<b.to) rgb=b.rgb;
    for (let x=0;x<w;x++){ const o=(y*w+x)*4; d[o]=rgb[0]; d[o+1]=rgb[1]; d[o+2]=rgb[2]; d[o+3]=255; }
  }
  return { width:w, height:h, data:d };
}
function solidFrame(w,h,rgb){
  const d=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){ d[i*4]=rgb[0]; d[i*4+1]=rgb[1]; d[i*4+2]=rgb[2]; d[i*4+3]=255; }
  return d;
}

/* ============ GEOMETRY ============ */
console.log('\n=== scroll geometry: tall image pans top->bottom ===');
let g = fsScrollFrames(800, 3000, { outW: 800, fps: 10, speed: 1000, startHoldMs: 500, endHoldMs: 500, loop: true });
check('view width = 800', g.view.w === 800, g.view.w);
check('view height = 16:9 of width, clamped (450)', g.view.h === 450, g.view.h);
check('maxScroll = srcH - viewH (2550)', g.maxScroll === 2550, g.maxScroll);
check('frames produced', Array.isArray(g.frames) && g.frames.length > 10, g.frames && g.frames.length);
check('first frame at top (y=0)', g.frames[0].y === 0, g.frames[0] && g.frames[0].y);
check('last frame at bottom (y=maxScroll)', g.frames[g.frames.length-1].y === 2550, g.frames[g.frames.length-1] && g.frames[g.frames.length-1].y);
check('y is monotonic non-decreasing', g.frames.every((f,i)=> i===0 || f.y >= g.frames[i-1].y), '');
check('every y within [0,maxScroll]', g.frames.every(f=> f.y>=0 && f.y<=2550), '');
check('per-frame delay ~ 1000/fps (100ms)', g.frames[Math.floor(g.frames.length/2)].delayMs === 100, g.frames[Math.floor(g.frames.length/2)].delayMs);
const holdTop = g.frames.filter(f=>f.y===0).length;
const holdBot = g.frames.filter(f=>f.y===2550).length;
check('holds ~500ms at top (>=5 frames @100ms)', holdTop >= 5, holdTop);
check('holds ~500ms at bottom (>=5 frames)', holdBot >= 5, holdBot);

console.log('\n=== scroll geometry: short image (shorter than window) is static ===');
let s = fsScrollFrames(800, 300, { outW: 800, fps: 10, speed: 1000 });
check('short: maxScroll = 0', s.maxScroll === 0, s.maxScroll);
check('short: view height clamped to srcH (300)', s.view.h === 300, s.view.h);
check('short: at least one frame, all y=0', s.frames.length >= 1 && s.frames.every(f=>f.y===0), s.frames.length);

console.log('\n=== scroll geometry: bounce returns to top ===');
let b = fsScrollFrames(800, 3000, { outW: 800, fps: 10, speed: 2000, startHoldMs:0, endHoldMs:0, bounce: true });
const peak = Math.max.apply(null, b.frames.map(f=>f.y));
check('bounce reaches bottom (2550)', peak === 2550, peak);
check('bounce ends back at top (y=0)', b.frames[b.frames.length-1].y === 0, b.frames[b.frames.length-1].y);

/* ============ RENDER ============ */
console.log('\n=== render: the pan window shows the correct source band ===');
// 40x120 image: red[0,40) green[40,80) blue[80,120). Window 40x40, scale 1.
const img = bandsImg(40, 120, [
  { from:0,  to:40,  rgb:[255,0,0] },
  { from:40, to:80,  rgb:[0,255,0] },
  { from:80, to:120, rgb:[0,0,255] },
]);
const view = { w:40, h:40, scale:1, srcW:40, srcH:120, bg:'#000000' };
function renderAt(y){ const cv=new FakeCanvas(); cv.width=view.w; cv.height=view.h; fsRenderScrollFrame(cv.getContext('2d'), img, y, view); return cv; }
check('window@y=0 shows red band', near(pxAt(renderAt(0),20,20),[255,0,0],4), pxAt(renderAt(0),20,20).join(','));
check('window@y=40 shows green band', near(pxAt(renderAt(40),20,20),[0,255,0],4), pxAt(renderAt(40),20,20).join(','));
check('window@y=80 shows blue band', near(pxAt(renderAt(80),20,20),[0,0,255],4), pxAt(renderAt(80),20,20).join(','));

/* ============ GIF ENCODER ============ */
console.log('\n=== gif: structural validity ===');
const W=6,H=5;
const frames = [
  { data: solidFrame(W,H,[255,0,0]), delayMs: 80 },
  { data: solidFrame(W,H,[0,0,255]), delayMs: 80 },
];
const bytes = fsEncodeGIF(frames, W, H, { loop: 0 });
check('returns bytes', bytes && bytes.length > 20, bytes && bytes.length);
const hdr = String.fromCharCode.apply(null, Array.from(bytes.slice(0,6)));
check('header = GIF89a', hdr === 'GIF89a', hdr);
const lsdW = bytes[6] | (bytes[7]<<8), lsdH = bytes[8] | (bytes[9]<<8);
check('logical screen width = 6', lsdW === W, lsdW);
check('logical screen height = 5', lsdH === H, lsdH);
check('global color table flag set', (bytes[10] & 0x80) !== 0, '0x'+bytes[10].toString(16));
const asStr = String.fromCharCode.apply(null, Array.from(bytes));
check('NETSCAPE2.0 loop extension present', asStr.indexOf('NETSCAPE2.0') !== -1, '');
check('trailer byte = 0x3B', bytes[bytes.length-1] === 0x3B, '0x'+bytes[bytes.length-1].toString(16));

/* ---- full parse + LZW round-trip decode ---- */
const dec = decodeGif(bytes);
check('decoded 2 frames', dec.frames.length === 2, dec.frames.length);
check('decoded canvas 6x5', dec.width===W && dec.height===H, dec.width+'x'+dec.height);
if (dec.frames.length === 2) {
  const f0 = dec.frames[0], f1 = dec.frames[1];
  const c0 = f0.pixels[0], c1 = f1.pixels[0];
  check('frame0 round-trips to red', near(c0,[255,0,0],0), c0.join(','));
  check('frame1 round-trips to blue', near(c1,[0,0,255],0), c1.join(','));
  check('frame0 fully red (all pixels)', f0.pixels.every(p=>near(p,[255,0,0],0)), '');
  check('frame delay stored (8 cs = 80ms)', f0.delayCs === 8, f0.delayCs);
}

console.log('\n=== gif: many-color frame quantizes + decodes near source ===');
// 18x18 = 324 GENUINELY distinct colors on a 15-step grid (r,g unique per pixel)
// -> >256 forces the median-cut path; decoded must be close, not exact.
const MW=18, MH=18;
const md=new Uint8ClampedArray(MW*MH*4);
for(let i=0;i<MW*MH;i++){ md[i*4]=(i%18)*15; md[i*4+1]=Math.floor(i/18)*15; md[i*4+2]=((i*37)%18)*15; md[i*4+3]=255; }
const distinct = new Set(); for(let i=0;i<MW*MH;i++) distinct.add((md[i*4]<<16)|(md[i*4+1]<<8)|md[i*4+2]);
check('many-color: source really has >256 distinct colors', distinct.size > 256, distinct.size);
const gifM = fsEncodeGIF([{data:md, delayMs:100}], MW, MH, { loop:0 });
const decM = decodeGif(gifM);
check('many-color: valid GIF89a', String.fromCharCode.apply(null,Array.from(gifM.slice(0,6)))==='GIF89a', '');
check('many-color: 1 frame decoded', decM.frames.length===1, decM.frames.length);
if (decM.frames.length===1){
  let maxErr=0;
  for(let i=0;i<MW*MH;i++){
    const src=[md[i*4],md[i*4+1],md[i*4+2]], got=decM.frames[0].pixels[i];
    maxErr=Math.max(maxErr, Math.abs(src[0]-got[0]), Math.abs(src[1]-got[1]), Math.abs(src[2]-got[2]));
  }
  check('many-color: decoded within tolerance of source (<=48)', maxErr <= 48, 'maxErr='+maxErr);
}

/* ============ GIF: real LZW COMPRESSION (v1.9.1) ============ */
/* fail-first gate: a real growing-dictionary LZW collapses runs to a handful of
   codes; the clear-code-paced stream stays ~as large as the raw indices (or
   larger), so these size checks FAIL on the old encoder and PASS on the new. */
console.log('\n=== gif: LZW actually compresses a solid frame + exact round-trip ===');
(function(){
  const SW=160, SH=160, N=SW*SH;
  const solid = solidFrame(SW,SH,[10,20,240]);
  const gif = fsEncodeGIF([{data:solid, delayMs:100}], SW, SH, {loop:0});
  check('solid: compresses to <15% of raw indices', gif.length < N*0.15, gif.length+' B vs raw '+N);
  const d = decodeGif(gif);
  check('solid: 1 frame decoded', d.frames.length===1, d.frames.length);
  check('solid: exact round-trip (every pixel [10,20,240])',
        d.frames.length===1 && d.frames[0].pixels.every(p=>near(p,[10,20,240],0)), '');
})();

console.log('\n=== gif: LZW compresses banded content + exact round-trip ===');
(function(){
  const BW=120, BH=300, N=BW*BH;
  const im = bandsImg(BW,BH,[
    {from:0,to:100,rgb:[200,30,30]},
    {from:100,to:200,rgb:[30,200,30]},
    {from:200,to:300,rgb:[30,30,200]},
  ]);
  const gif = fsEncodeGIF([{data:im.data, delayMs:100}], BW, BH, {loop:0});
  check('banded: compresses to <25% of raw indices', gif.length < N*0.25, gif.length+' B vs raw '+N);
  const d = decodeGif(gif);
  let ok = d.frames.length===1;
  if (ok) for (let y=0;y<BH && ok;y++){ const want=y<100?[200,30,30]:y<200?[30,200,30]:[30,30,200];
    for(let x=0;x<BW;x++){ if(!near(d.frames[0].pixels[y*BW+x],want,0)){ ok=false; break; } } }
  check('banded: exact round-trip (all three bands correct)', ok, '');
})();

console.log('\n=== gif: dictionary reset (>4096 entries) still round-trips exactly ===');
(function(){
  // 160x160 HIGH-ENTROPY indices (xorshift32) over a 48-color EXACT palette
  // (<=256 so colors round-trip byte-exact). High entropy -> short matches ->
  // ~10k+ codes -> forces >=1 12-bit dictionary reset mid-stream. An exact
  // round-trip is only possible if that clear-on-full reset is handled
  // correctly (an un-cleared stream would need >12-bit codes and desync).
  const RW=160, RH=160, N=RW*RH, K=48;
  const pal=[]; for(let s=0;s<K;s++) pal.push([(s*6)%256,(s*11+30)%256,(s*17+70)%256]);
  let x=2463534242>>>0;
  const rnd=()=>{ x^=x<<13; x>>>=0; x^=x>>>17; x^=x<<5; x>>>=0; return x; };
  const d=new Uint8ClampedArray(N*4); const src=new Array(N);
  for(let i=0;i<N;i++){ const s=rnd()%K; src[i]=s; d[i*4]=pal[s][0]; d[i*4+1]=pal[s][1]; d[i*4+2]=pal[s][2]; d[i*4+3]=255; }
  const distinct=new Set(src);
  check('reset: high-entropy source spans the palette (>=40 distinct)', distinct.size>=40, distinct.size);
  const gif=fsEncodeGIF([{data:d, delayMs:100}], RW, RH, {loop:0});
  const dec=decodeGif(gif);
  let exact = dec.frames.length===1;
  if (exact) for(let i=0;i<N;i++){ const s=src[i]; if(!near(dec.frames[0].pixels[i],pal[s],0)){ exact=false; break; } }
  check('reset: exact round-trip across dictionary reset', exact, '');
})();

/* ============ geometry: DENSITY + extra SHAPES (v1.9.2) ============ */
console.log('\n=== scroll geometry: density scales OUTPUT, not the source-y schedule ===');
(function(){
  var base = fsScrollFrames(800, 3000, { outW: 400, aspect: 9/16, fps: 10, speed: 1000 });
  var d2   = fsScrollFrames(800, 3000, { outW: 400, aspect: 9/16, fps: 10, speed: 1000, density: 2 });
  var d3   = fsScrollFrames(800, 3000, { outW: 400, aspect: 9/16, fps: 10, speed: 1000, density: 3 });
  check('density default = 1', base.view.density === 1, base.view.density);
  check('density 2 recorded', d2.view.density === 2, d2.view.density);
  check('density 2 doubles view width (400 -> 800)', d2.view.w === base.view.w*2, d2.view.w+' vs '+base.view.w);
  check('density 2 doubles view height', d2.view.h === base.view.h*2, d2.view.h+' vs '+base.view.h);
  check('density 2 doubles scale', Math.abs(d2.view.scale - base.view.scale*2) < 1e-9, d2.view.scale+' vs '+base.view.scale);
  check('density 3 triples view width', d3.view.w === base.view.w*3, d3.view.w+' vs '+base.view.w);
  check('density does NOT change maxScroll (source px)', d2.maxScroll === base.maxScroll && d3.maxScroll === base.maxScroll, d2.maxScroll);
  check('density does NOT change frame count', d2.frames.length === base.frames.length, d2.frames.length+' vs '+base.frames.length);
  check('density leaves the source-y schedule identical', d2.frames.every(function(f,i){ return f.y === base.frames[i].y; }), 'identical');
  check('density clamps to <=3', fsScrollFrames(800,3000,{outW:400,density:9}).view.density === 3, fsScrollFrames(800,3000,{outW:400,density:9}).view.density);
  check('density clamps to >=1', fsScrollFrames(800,3000,{outW:400,density:0}).view.density === 1, fsScrollFrames(800,3000,{outW:400,density:0}).view.density);
})();

console.log('\n=== scroll geometry: extra shapes (square 1:1, story 9:16 portrait) ===');
(function(){
  var sq = fsScrollFrames(800, 3000, { outW: 800, aspect: 1, fps: 10, speed: 1000 });
  check('square: 1:1 window (h === w)', sq.view.h === sq.view.w, sq.view.w+'x'+sq.view.h);
  var st = fsScrollFrames(800, 3000, { outW: 720, aspect: 16/9, fps: 10, speed: 1000 });
  check('story: portrait window (h > w)', st.view.h > st.view.w, st.view.w+'x'+st.view.h);
  check('story: aspect ~ 16/9 (0.888.. wide:tall)', Math.abs(st.view.h/st.view.w - 16/9) < 0.02, (st.view.h/st.view.w).toFixed(3));
})();

console.log('\n=== gif: onProgress fires once per frame; output byte-identical ===');
(function(){
  var W=6,H=5;
  var fr=[ {data:solidFrame(W,H,[255,0,0]),delayMs:80}, {data:solidFrame(W,H,[0,0,255]),delayMs:80}, {data:solidFrame(W,H,[0,255,0]),delayMs:80} ];
  var calls=[];
  var withCb = fsEncodeGIF(fr, W, H, { loop:0, onProgress:function(done,total){ calls.push([done,total]); } });
  var noCb   = fsEncodeGIF(fr, W, H, { loop:0 });
  check('onProgress called once per frame (3)', calls.length===3, calls.length);
  check('onProgress reports total = frame count', calls.every(function(c){return c[1]===3;}), JSON.stringify(calls));
  check('onProgress done is monotonic 1..N', calls.every(function(c,i){return c[0]===i+1;}), JSON.stringify(calls.map(function(c){return c[0];})));
  check('onProgress does not change output bytes',
        withCb.length===noCb.length && withCb.every(function(b,i){return b===noCb[i];}), withCb.length+' vs '+noCb.length);
})();

console.log('\n=== gif: async-chunked encoder — mid-encode yields + byte-identical output (v1.9.3) ===');
async function fsAsyncEncoderChecks() {
  check('fsEncodeGIFAsync is exported as a function', typeof fsEncodeGIFAsync === 'function', typeof fsEncodeGIFAsync);
  if (typeof fsEncodeGIFAsync !== 'function') return;

  // 10 solid frames cycling 5 colors -> crosses several chunk boundaries.
  var AW = 8, AH = 6, NF = 10;
  var cols = [[255,0,0],[0,0,255],[0,255,0],[240,240,0],[0,240,240]];
  var afr = [];
  for (var i = 0; i < NF; i++) afr.push({ data: solidFrame(AW, AH, cols[i % cols.length]), delayMs: 90 });

  // (a) the NEW behavior: it yields between chunks so the browser can repaint
  //     MID-encode. Inject a counting yield; chunkSize 4 over 10 frames.
  var yields = 0, aProg = [];
  var abytes = await fsEncodeGIFAsync(afr, AW, AH, {
    loop: 0, chunkSize: 4,
    yield: function () { yields++; return Promise.resolve(); },
    onProgress: function (done, total) { aProg.push([done, total]); }
  });
  check('async: yields mid-encode (>=2 for 10 frames @ chunk 4)', yields >= 2, 'yields=' + yields);
  check('async: yields are chunked, not per-frame (<= N)', yields <= NF, 'yields=' + yields);

  // (b) onProgress contract identical to the sync encoder
  check('async: onProgress fires once per frame (10)', aProg.length === NF, aProg.length);
  check('async: onProgress reports total = frame count', aProg.every(function (c) { return c[1] === NF; }), JSON.stringify(aProg));
  check('async: onProgress done monotonic 1..N', aProg.every(function (c, i) { return c[0] === i + 1; }), JSON.stringify(aProg.map(function (c) { return c[0]; })));

  // (c) THE core invariant: byte-identical to the synchronous encoder
  var sbytes = fsEncodeGIF(afr, AW, AH, { loop: 0 });
  check('async: output byte-identical to sync fsEncodeGIF',
        abytes.length === sbytes.length && abytes.every(function (b, i) { return b === sbytes[i]; }),
        abytes.length + ' vs ' + sbytes.length);

  // (d) high-entropy frame (forces a mid-stream LZW dictionary reset): async
  //     output byte-identical to sync AND round-trips byte-exact through the
  //     independent decoder -> async chunking never corrupts the stream.
  var RW = 160, RH = 160, N = RW * RH, K = 48;
  var pal = []; for (var s = 0; s < K; s++) pal.push([(s*6)%256,(s*11+30)%256,(s*17+70)%256]);
  var x = 2463534242 >>> 0;
  var rnd = function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  var hd = new Uint8ClampedArray(N * 4), hsrc = new Array(N);
  for (var j = 0; j < N; j++) { var qq = rnd() % K; hsrc[j] = qq; hd[j*4] = pal[qq][0]; hd[j*4+1] = pal[qq][1]; hd[j*4+2] = pal[qq][2]; hd[j*4+3] = 255; }
  var asyncBig = await fsEncodeGIFAsync([{ data: hd, delayMs: 100 }], RW, RH, { loop: 0, chunkSize: 1, yield: function () { return Promise.resolve(); } });
  var syncBig = fsEncodeGIF([{ data: hd, delayMs: 100 }], RW, RH, { loop: 0 });
  check('async: high-entropy output byte-identical to sync',
        asyncBig.length === syncBig.length && asyncBig.every(function (b, i) { return b === syncBig[i]; }),
        asyncBig.length + ' vs ' + syncBig.length);
  var decA = decodeGif(asyncBig);
  var exact = decA.frames.length === 1;
  if (exact) for (var m = 0; m < N; m++) { if (!near(decA.frames[0].pixels[m], pal[hsrc[m]], 0)) { exact = false; break; } }
  check('async: high-entropy frame round-trips byte-exact (LZW reset path)', exact, '');
}

/* === sink ===
   As in beautify-sim: this tier requires scrollclip.js's PURE core, and its two
   failure sinks live in the DOM controller no sim boots — so they are graded
   statically, and said to be. The export sink is the one that matters: it wraps
   save() -> fsDownloadBlob, the only step on this page that hands the browser a
   NAME built from the captured page's {domain} and {title} and a PATH from the
   user's synced saveDirectory. The GIF/WebM encoders above it only ever fail
   about sizes. */
console.log('\n=== sink ===');
{
  var sinkSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'scrollclip.js'), 'utf8');
  var sinkRaw = sinkSrc.match(/e\s*&&\s*e\.message\s*\|\|\s*e/g) || [];
  check('no handler interpolates a raw exception', sinkRaw.length === 0,
    sinkRaw.length ? sinkRaw.length + ' site(s)' : 'none');
  var sinkReduced = (sinkSrc.match(/fsHumanReason\s*\(/g) || []).length;
  check('both failure sinks go through the shared reducer', sinkReduced === 2, sinkReduced + ' call(s)');
  check('the sinks still name the action that failed',
    /Export failed/.test(sinkSrc) && /Copy failed/.test(sinkSrc), '');
}

fsAsyncEncoderChecks().then(function () {
  console.log('\n' + (FAILS ? 'FAILURES: ' + FAILS : 'ALL PASS'));
  process.exit(FAILS ? 1 : 0);
}).catch(function (e) {
  console.log('FAIL  async encoder checks threw — ' + (e && (e.stack || e.message) || e));
  process.exit(1);
});

/* =================== self-contained GIF decoder (sim only) =================== */
function decodeGif(bytes){
  let p = 0;
  const rdU16 = () => { const v = bytes[p] | (bytes[p+1]<<8); p+=2; return v; };
  const sig = String.fromCharCode.apply(null, Array.from(bytes.slice(0,6))); p=6;
  const width = rdU16(), height = rdU16();
  const packed = bytes[p++]; p++; /*bg*/ p++; /*aspect*/
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);
  let gct = [];
  if (gctFlag){ for(let i=0;i<gctSize;i++){ gct.push([bytes[p],bytes[p+1],bytes[p+2]]); p+=3; } }
  const frames = [];
  let pendingDelay = 0;
  while (p < bytes.length){
    const sep = bytes[p++];
    if (sep === 0x3B) break;                 // trailer
    if (sep === 0x21){                        // extension
      const label = bytes[p++];
      if (label === 0xF9){                    // graphic control
        p++;                                  // block size (4)
        p++;                                  // packed
        pendingDelay = rdU16();
        p++;                                  // transparent index
        p++;                                  // block terminator
      } else {                                // skip other extensions
        while (bytes[p] !== 0){ p += bytes[p] + 1; } p++;
      }
      continue;
    }
    if (sep === 0x2C){                          // image descriptor
      rdU16(); rdU16();                          // x,y
      const iw = rdU16(), ih = rdU16();
      const ipacked = bytes[p++];
      let lct = gct;
      if (ipacked & 0x80){                       // local color table
        const lsz = 1 << ((ipacked & 0x07)+1);
        lct=[]; for(let i=0;i<lsz;i++){ lct.push([bytes[p],bytes[p+1],bytes[p+2]]); p+=3; }
      }
      const minCode = bytes[p++];
      const data = [];
      while (bytes[p] !== 0){ const n = bytes[p++]; for(let i=0;i<n;i++) data.push(bytes[p++]); }
      p++;                                       // block terminator
      const indices = lzwDecode(minCode, data, iw*ih);
      const pixels = indices.map(ix => lct[ix] || [0,0,0]);
      frames.push({ pixels, delayCs: pendingDelay, w:iw, h:ih });
      pendingDelay = 0;
      continue;
    }
    break; // unknown
  }
  return { sig, width, height, frames };
}

function lzwDecode(minCodeSize, data, expected){
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const reset = () => { dict = []; for(let i=0;i<clear;i++) dict.push([i]); dict.push(null); dict.push(null); };
  reset();
  let bitPos = 0;
  const readCode = () => {
    let code = 0;
    for (let i=0;i<codeSize;i++){
      const byteIndex = bitPos >> 3, bit = bitPos & 7;
      if (byteIndex >= data.length) return eoi;
      code |= ((data[byteIndex] >> bit) & 1) << i;
      bitPos++;
    }
    return code;
  };
  const out = [];
  let prev = null;
  while (out.length < expected){
    const code = readCode();
    if (code === eoi) break;
    if (code === clear){ reset(); codeSize = minCodeSize+1; prev = null; continue; }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code].slice();
    else if (prev) entry = prev.concat(prev[0]);
    else break;
    for (const v of entry) out.push(v);
    if (prev){
      dict.push(prev.concat(entry[0]));
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}
