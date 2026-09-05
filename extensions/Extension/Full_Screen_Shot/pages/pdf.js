/* FSPDF — minimal dependency-free PDF writer.
   Builds a PDF from pre-rendered JPEG page images (DCTDecode pass-through).
   Exposes global FSPDF.build(pages, opts) -> Blob.

   pages: [{
     jpeg: Uint8Array,          // JPEG bytes for this page's image
     imgW, imgH,                // JPEG pixel dimensions
     pageW, pageH,              // page size in PDF points
     x, y, w, h,                // image placement rect in points (PDF origin = bottom-left)
     stamp: string | null       // optional footer text
   }]
*/

(function (root) {
  'use strict';

  const enc = new TextEncoder();

  function escPdfText(s) {
    // PDF string escaping; non-Latin-1 chars are replaced.
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (c >= 32 && c <= 126) out += ch; // keep streams single-byte safe
      else out += '?';
    }
    return out;
  }

  function build(pages, opts = {}) {
    const chunks = [];      // Uint8Array pieces
    const offsets = [];     // byte offset of each object (1-based ids)
    let pos = 0;

    function push(data) {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      pos += bytes.length;
    }

    function beginObj(id) {
      offsets[id] = pos;
      push(id + ' 0 obj\n');
    }

    push('%PDF-1.4\n%âãÏÓ\n');

    const n = pages.length;
    const catalogId = 1;
    const pagesId = 2;
    const fontId = 3;
    // Per page i (0-based): page obj = 4 + i*3, content = 5 + i*3, image = 6 + i*3
    const pageObjId = i => 4 + i * 3;
    const infoId = 4 + n * 3;
    const total = infoId;

    beginObj(catalogId);
    push('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>\nendobj\n');

    beginObj(pagesId);
    push('<< /Type /Pages /Count ' + n + ' /Kids [' +
      pages.map((_, i) => pageObjId(i) + ' 0 R').join(' ') + '] >>\nendobj\n');

    beginObj(fontId);
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');

    pages.forEach((p, i) => {
      const pid = pageObjId(i), cid = pid + 1, iid = pid + 2;

      beginObj(pid);
      push('<< /Type /Page /Parent ' + pagesId + ' 0 R ' +
        '/MediaBox [0 0 ' + num(p.pageW) + ' ' + num(p.pageH) + '] ' +
        '/Resources << /XObject << /Im' + i + ' ' + iid + ' 0 R >> ' +
        '/Font << /F1 ' + fontId + ' 0 R >> ' +
        '/ProcSet [/PDF /ImageC /Text] >> ' +
        '/Contents ' + cid + ' 0 R >>\nendobj\n');

      let content = 'q\n' + num(p.w) + ' 0 0 ' + num(p.h) + ' ' + num(p.x) + ' ' + num(p.y) + ' cm\n/Im' + i + ' Do\nQ\n';
      if (p.stamp) {
        content += 'BT\n0.45 g\n/F1 8 Tf\n1 0 0 1 ' + num(p.x) + ' 6 Tm\n(' + escPdfText(p.stamp) + ') Tj\nET\n';
      }
      const cBytes = enc.encode(content);
      beginObj(cid);
      push('<< /Length ' + cBytes.length + ' >>\nstream\n');
      push(cBytes);
      push('\nendstream\nendobj\n');

      beginObj(iid);
      push('<< /Type /XObject /Subtype /Image ' +
        '/Width ' + p.imgW + ' /Height ' + p.imgH + ' ' +
        '/ColorSpace /DeviceRGB /BitsPerComponent 8 ' +
        '/Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n');
      push(p.jpeg);
      push('\nendstream\nendobj\n');
    });

    beginObj(infoId);
    push('<< /Producer (FullShot) /Title (' + escPdfText(opts.title || 'Screenshot') + ') ' +
      '/CreationDate (D:' + pdfDate(new Date()) + ') >>\nendobj\n');

    const xrefPos = pos;
    let xref = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
    for (let id = 1; id <= total; id++) {
      xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (total + 1) + ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\n' +
      'startxref\n' + xrefPos + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  function num(v) {
    return (Math.round(v * 100) / 100).toString();
  }

  function pdfDate(d) {
    const p = x => String(x).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // Paper sizes in points (72/in)
  const PAPERS = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    legal: [612, 1008]
  };

  root.FSPDF = { build, PAPERS };
})(typeof self !== 'undefined' ? self : this);
