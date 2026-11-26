// qr.js – kleiner QR-Encoder (Byte-Modus, Fehlerkorrektur M, Versionen 1–6).
// Reicht für die Kopplungs-URL (#k=…). Kein Fremdcode, kein Build.
(function (root) {
  'use strict';

  // GF(256) für Reed-Solomon
  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function genPoly(n) {
    let p = [1];
    for (let i = 0; i < n; i++) {
      const q = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) { q[j] ^= p[j]; q[j + 1] ^= mul(p[j], EXP[i]); }
      p = q;
    }
    return p;
  }
  function ecc(data, n) {
    const g = genPoly(n);
    const res = new Array(n).fill(0);
    for (const b of data) {
      const f = b ^ res[0];
      res.shift(); res.push(0);
      for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], f);
    }
    return res;
  }

  // Version → Datencodewörter, EC je Block, Blöcke, Byte-Kapazität, Alignment (Level M)
  const DATA_CW = [0, 16, 28, 44, 64, 86, 108];
  const ECC_CW = [0, 10, 16, 26, 18, 24, 16];
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
  const CAP = [0, 14, 26, 42, 62, 84, 106];
  const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

  function buildData(text, ver) {
    const bytes = new TextEncoder().encode(text);
    const total = DATA_CW[ver];
    const bits = [];
    const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    push(4, 4); // Byte-Modus
    push(bytes.length, 8);
    for (const b of bytes) push(b, 8);
    push(0, Math.min(4, total * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      out.push(v);
    }
    let pad = true;
    while (out.length < total) { out.push(pad ? 0xec : 0x11); pad = !pad; }
    return out;
  }

  function codewords(text, ver) {
    const data = buildData(text, ver);
    const nb = BLOCKS[ver], per = DATA_CW[ver] / nb, ne = ECC_CW[ver];
    const blocks = [];
    for (let i = 0; i < nb; i++) {
      const part = data.slice(i * per, i * per + per);
      blocks.push({ data: part, ec: ecc(part, ne) });
    }
    const out = [];
    for (let i = 0; i < per; i++) for (const b of blocks) out.push(b.data[i]);
    for (let i = 0; i < ne; i++) for (const b of blocks) out.push(b.ec[i]);
    return out;
  }

  function formatBits(mask) {
    const data = mask; // ECC-Level M = 0
    let d = data << 10;
    const g = 0x537;
    for (let i = 4; i >= 0; i--) if ((d >> (10 + i)) & 1) d ^= g << i;
    return (((data << 10) | d) ^ 0x5412) & 0x7fff;
  }

  const maskFn = (m, r, c) => {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  function base(ver) {
    const size = 17 + 4 * ver;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const res = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = !!v; };
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(r0 + r, c0 + c, on);
        if (r0 + r >= 0 && r0 + r < size && c0 + c >= 0 && c0 + c < size) res[r0 + r][c0 + c] = true;
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) {
      const on = i % 2 === 0;
      set(6, i, on); res[6][i] = true;
      set(i, 6, on); res[i][6] = true;
    }
    const al = ALIGN[ver];
    for (const r of al) for (const c of al) {
      if (res[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        res[r + dr][c + dc] = true;
      }
    }
    set(size - 8, 8, true); res[size - 8][8] = true; // Dark Module
    const info = (bits) => {
      for (let i = 0; i < 15; i++) {
        const on = ((bits >> i) & 1) === 1;
        // senkrecht, links oben
        if (i < 6) { set(i, 8, on); res[i][8] = true; }
        else if (i < 8) { set(i + 1, 8, on); res[i + 1][8] = true; }
        else { set(size - 15 + i, 8, on); res[size - 15 + i][8] = true; }
        // waagerecht, oben rechts/unten links (Spalte 6 ist das Timing-Muster)
        if (i < 8) { set(8, size - i - 1, on); res[8][size - i - 1] = true; }
        else if (i < 9) { set(8, 7, on); res[8][7] = true; }
        else { set(8, 15 - i - 1, on); res[8][15 - i - 1] = true; }
      }
    };
    info(0); // Platz reservieren; Werte setzt applyFormat
    return { size, m, res, set };
  }

  function placeData(g, words) {
    const { size, res, set } = g;
    let inc = -1, row = size - 1, bit = 7, byte = 0;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          if (!res[row][col - c]) {
            let dark = false;
            if (byte < words.length) dark = ((words[byte] >>> bit) & 1) === 1;
            set(row, col - c, dark);
            if (--bit === -1) { bit = 7; byte++; }
          }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
  }

  function applyFormat(g, mask) {
    const bits = formatBits(mask);
    const { size, set } = g;
    for (let i = 0; i < 15; i++) {
      const on = ((bits >> i) & 1) === 1;
      if (i < 6) set(i, 8, on);
      else if (i < 8) set(i + 1, 8, on);
      else set(size - 15 + i, 8, on);
      if (i < 8) set(8, size - i - 1, on);
      else if (i < 9) set(8, 7, on);
      else set(8, 15 - i - 1, on);
    }
    set(size - 8, 8, true);
  }

  function penalty(m) {
    const n = m.length;
    let p = 0;
    const line = (arr) => {
      let run = 1;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] === arr[i - 1]) run++;
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) p += 3 + (run - 5);
      for (let i = 0; i + 10 < arr.length; i++) {
        const w = arr.slice(i, i + 11).map((x) => (x ? 1 : 0)).join('');
        if (w === '10111010000' || w === '00001011101') p += 40;
      }
    };
    for (let r = 0; r < n; r++) line(m[r]);
    for (let c = 0; c < n; c++) line(m.map((row) => row[c]));
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const pct = (dark * 100) / (n * n);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  function matrix(text, forceMask) {
    const bytes = new TextEncoder().encode(text);
    let ver = 0;
    for (let v = 1; v <= 6; v++) if (bytes.length <= CAP[v]) { ver = v; break; }
    if (!ver) throw new Error('Text zu lang für diesen QR-Code.');
    const words = codewords(text, ver);
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      if (forceMask != null && mask !== forceMask) continue;
      const g = base(ver);
      placeData(g, words);
      for (let r = 0; r < g.size; r++) for (let c = 0; c < g.size; c++) {
        if (!g.res[r][c] && maskFn(mask, r, c)) g.m[r][c] = !g.m[r][c];
      }
      applyFormat(g, mask);
      const score = penalty(g.m);
      if (score < bestScore) { bestScore = score; best = g.m; }
    }
    return best;
  }

  function svg(text, opts) {
    const m = matrix(text);
    const q = 4, dim = m.length + q * 2, px = (opts && opts.px) || 220;
    let d = '';
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" width="' + px + '" height="' + px +
      '" shape-rendering="crispEdges" role="img" aria-label="QR-Code">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  root.QR = { svg, matrix };
})(typeof window !== 'undefined' ? window : globalThis);
