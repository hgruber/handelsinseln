// background.js – Hintergründe für #sea (nur Anzeige, nichts davon geht an den Server).
// Vier Szenen, jede aus den Gelände-Tiles des Spiels (img/<motiv><1|2>.webp):
//   erde   – die Tile-Fläche als gekrümmte Erde bis zum Dunsthorizont (Vorgabe)
//   tisch  – die Tiles als Plättchen auf einer dunklen Tischplatte
//   karte  – die Tiles als gemalte Seekarte auf Pergament
//   nacht  – Inseln und Lichter im Nebelmeer bei Nacht
// Die Wahl gilt nur für dieses Gerät (localStorage 'handelsinseln.bg').
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'handelsinseln.bg';
  const SQ3 = Math.sqrt(3);
  const TAU = Math.PI * 2;

  // ======================================================================================
  // Zufall, Rauschen, Farbe
  // ======================================================================================
  const lerp = (a, b, t) => a + (b - a) * t;
  function h2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise2(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, s, oct) {
    let t = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < (oct || 4); i++) { t += a * noise2(x * f, y * f, s + i * 131); n += a; f *= 2; a *= 0.5; }
    return t / n;
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function mix(a, b, t) {
    const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
    const c = (s) => Math.round(((A >> s) & 255) * (1 - t) + ((B >> s) & 255) * t);
    return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
  }

  // ======================================================================================
  // Tiles
  // ======================================================================================
  const MOTIFS = ['wald', 'huegel', 'weide', 'acker', 'gebirge', 'wueste', 'gold', 'meer', 'nebel'];
  const BASE = { wald: '#3f8a4e', huegel: '#c8763f', weide: '#8fcf5a', acker: '#e8c34a', gebirge: '#8c96a4', wueste: '#e8d49a', gold: '#d8ac3a', meer: '#2f6f95', nebel: '#aab8c4' };
  const TEXN = 384, TEXC = TEXN / 2, TEXR = 186;
  const tex = {};

  function hexPath(g, x, y, r, rotDeg) {
    const a0 = (rotDeg || 0) * Math.PI / 180;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = a0 + Math.PI / 2 + i * TAU / 6;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
  }
  function hexPoints(x, y, r, rotDeg) {
    const a0 = (rotDeg || 0) * Math.PI / 180, pts = [];
    for (let i = 0; i < 6; i++) {
      const a = a0 + Math.PI / 2 + i * TAU / 6;
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return pts;
  }
  // Bild mittig und aufrecht ins Hex, gleichmäßig skaliert – wie im Spiel (nur gespiegelt).
  // Keine Drehung und keine Scherung: Sonst kippen die Motive schief in der Kachel.
  function drawTexturedHex(g, image, pts, mir) {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0] / 6; cy += p[1] / 6; }
    let rad = 0;
    for (const p of pts) rad += Math.hypot(p[0] - cx, p[1] - cy) / 6;
    const s = rad / TEXR;
    g.save();
    g.translate(cx, cy);
    g.scale(mir ? -s : s, s);
    g.drawImage(image, -TEXC, -TEXC);
    g.restore();
  }

  function buildTexture(motif, variant, img) {
    const c = document.createElement('canvas');
    c.width = c.height = TEXN;
    const g = c.getContext('2d');
    hexPath(g, TEXC, TEXC, TEXR);
    g.save(); g.clip();
    g.drawImage(img, TEXC - TEXR * 0.98, TEXC - TEXR * 0.98, TEXR * 1.96, TEXR * 1.96);
    g.restore();
    const vg = g.createRadialGradient(TEXC, TEXC, TEXR * 0.35, TEXC, TEXC, TEXR * 1.02);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.28)');
    g.save(); hexPath(g, TEXC, TEXC, TEXR); g.clip(); g.fillStyle = vg; g.fillRect(0, 0, TEXN, TEXN); g.restore();
    tex[motif + variant] = c;
  }
  function loadTextures() {
    MOTIFS.forEach((m) => [1, 2].forEach((v) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { buildTexture(m, v, img); schedule(); };
      img.src = 'img/' + m + v + '.webp';
    }));
  }
  const texOf = (m, v) => tex[m + v] || null;
  // Spiegelung je Tile (wie im Spiel); gedreht wird nicht, damit die Motive aufrecht bleiben
  function lookOf(q, k, seed) {
    return { mir: h2(q, k, seed + 22) > 0.5 };
  }

  // Gelände aus dem Rauschen: offenes Meer, Sandstrand, Weide, Acker, Wald, Hügel, Gebirge
  function terrainAt(q, k, seed, water, extra) {
    let h = fbm(q * 0.048 + 11.3, k * 0.048 + 4.7, seed, 4);
    if (extra) h = extra(q, k, h);
    const w = water == null ? 0.40 : water;
    let m;
    if (h < w) m = 'meer';
    else if (h < w + 0.032) m = 'wueste';
    else if (h < 0.49) m = 'weide';
    else if (h < 0.555) m = 'acker';
    else if (h < 0.625) m = 'wald';
    else if (h < 0.695) m = 'huegel';
    else m = 'gebirge';
    if (m !== 'meer' && h2(q * 3 + 7, k * 5 + 2, seed + 9) > 0.988) m = 'gold';
    return { m, v: h2(q, k, seed + 3) > 0.5 ? 2 : 1, h };
  }

  // ======================================================================================
  // Gemeinsame Bildelemente
  // ======================================================================================
  function glow(g, x, y, r, color, alpha) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, alpha));
    gr.addColorStop(0.55, rgba(color, alpha * 0.35));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function vignette(g, W, H, strength) {
    const gr = g.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.26, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, `rgba(0,0,0,${strength})`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  function grain(g, W, H, amount) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const q = c.getContext('2d'), d = q.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    q.putImageData(d, 0, 0);
    const pat = g.createPattern(c, 'repeat');
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = amount; g.fillStyle = pat; g.fillRect(0, 0, W, H); g.restore();
  }

  // ======================================================================================
  // Szene: Erdkrümmung
  // ======================================================================================
  function sceneErde(g, W, H) {
    const seed = 23;
    const R = 115, HC = 4.4;                 // Kugelradius und Augenhöhe (in Hex-Radien)
    const PITCH = 0.36;                      // Neigung der Kamera nach unten
    const F = Math.max(W * 0.56, H * 0.78);  // Brennweite (Weitwinkel)
    const hy = H * 0.405;                    // gewünschte Horizonthöhe in der Bildmitte
    const alpha = Math.acos(R / (R + HC));
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const cx = W * 0.5, cy = hy - F * Math.tan(alpha - PITCH);
    // Die Kugel wölbt sich: der Horizont fällt zu den Rändern ab, statt ein gerader Streifen zu sein.
    const BEND = H * 0.085;
    const bend = (x) => BEND * Math.pow((x - cx) / (W * 0.5), 2);
    const proj = (u, v) => {
      const ph = u / R, th = v / R;
      const X = R * Math.sin(ph) * Math.cos(th);
      const y0 = R * Math.cos(ph) * Math.cos(th) - (R + HC), z0 = R * Math.sin(th);
      const Y = y0 * cp + z0 * sp, Z = -y0 * sp + z0 * cp;
      if (Z < 0.03) return null;
      const px = cx + F * X / Z;
      return [px, cy - F * Y / Z + bend(px), Z];
    };

    // ---- Himmel ----
    g.fillStyle = '#e8ad7c'; g.fillRect(0, 0, W, H); // warmer Grund, falls unten Lücken bleiben
    const sky = tex.__sky;
    const skyBottom = hy + BEND + H * 0.06;
    if (sky) {
      const s = Math.max(W / sky.width, skyBottom / sky.height);
      const dw = sky.width * s, dh = sky.height * s;
      g.drawImage(sky, (W - dw) * 0.5, skyBottom - dh, dw, dh);
    } else {
      const gr = g.createLinearGradient(0, 0, 0, skyBottom);
      gr.addColorStop(0, '#101a33');
      gr.addColorStop(0.35, '#33314f');
      gr.addColorStop(0.62, '#7a5f6e');
      gr.addColorStop(0.82, '#c98a6c');
      gr.addColorStop(1, '#f2b982');
      g.fillStyle = gr; g.fillRect(0, 0, W, skyBottom);
      // lockere Wolkenbänder, warm von unten beleuchtet
      const band = (yy, hh, col, al, sd) => {
        for (let i = 0; i < 16; i++) {
          const x = h2(i, sd, 3) * W, w = W * (0.10 + h2(i, sd, 5) * 0.34);
          glow(g, x, yy + (h2(i, sd, 9) - 0.5) * hh, w * 0.55, col, al * (0.35 + h2(i, sd, 11) * 0.65));
        }
      };
      band(hy * 0.26, H * 0.13, '#7d7ba8', 0.26, 4);
      band(hy * 0.44, H * 0.11, '#b98a8e', 0.34, 8);
      band(hy * 0.62, H * 0.09, '#e8a978', 0.46, 12);
      // ein paar Sterne ganz oben
      for (let i = 0; i < 90; i++) {
        const x = h2(i, 1, 31) * W, y = h2(i, 2, 31) * hy * 0.45, a = h2(i, 3, 31);
        g.fillStyle = `rgba(230,236,255,${0.15 + a * 0.5})`;
        g.beginPath(); g.arc(x, y, 0.4 + a * 0.9, 0, TAU); g.fill();
      }
    }
    glow(g, W * 0.58, hy + H * 0.01, H * 0.5, '#ffc98a', 0.5);
    glow(g, W * 0.58, hy + H * 0.01, H * 0.16, '#ffe6b8', 0.8);

    // ---- Erdfläche als Untergrund bis zur Horizontkurve (füllt Lücken hinter den Tiles) ----
    const hz = [], uMaxH = R * alpha * 0.999;
    for (let i = 0; i <= 220; i++) {
      const u = -uMaxH + 2 * uMaxH * i / 220;
      const cph = Math.cos(u / R), cosT = R / ((R + HC) * cph);
      if (cosT >= 1) continue;
      const p = proj(u, R * Math.acos(cosT));
      if (p) hz.push(p);
    }
    g.beginPath();
    if (hz.length) { g.moveTo(hz[0][0], hz[0][1]); for (let i = 1; i < hz.length; i++) g.lineTo(hz[i][0], hz[i][1]); }
    else { g.moveTo(0, hy); g.lineTo(W, hy); }
    g.lineTo(W + 8, H + BEND + 80); g.lineTo(-8, H + BEND + 80); g.closePath();
    const bg = g.createLinearGradient(0, hy - H * 0.02, 0, H);
    bg.addColorStop(0, '#c99a68'); bg.addColorStop(0.12, '#7d7548');
    bg.addColorStop(0.5, '#4c5c34'); bg.addColorStop(1, '#2b3a26');
    g.fillStyle = bg; g.fill();

    // ---- Tiles auf der Kugel ----
    // Die Komposition: eine Insel unter der Kamera, dahinter offenes Meer und ferne Eilande.
    // Sanftes Plateau statt Summe: vor der Kamera liegt Land, dahinter offenes Meer.
    const island = (q, k, h) => {
      const u = SQ3 * (q + k / 2), v = k * 1.5 - 1;
      const near = Math.exp(-((u * u + (v - 5) * (v - 5)) / 150));
      const far = 0.85 * Math.exp(-(((u + 24) ** 2 + (v - 26) ** 2) / 320));
      const m = Math.min(1, near + far);
      return h * (1 - m) + (0.505 + 0.04 * Math.sin(u * 0.7 + v * 0.5) + 0.035 * Math.sin(u * 0.31 - v * 0.23)) * m;
    };
    const vMax = R * alpha * 0.99;
    const uMax = R * alpha;
    for (let k = Math.floor(vMax / 1.5); k >= 0; k--) {
      const v = k * 1.5;
      if (v > vMax) continue;
      const umax = Math.min(uMax, v * 1.5 + 24);
      const q0 = Math.floor(-umax / SQ3 - k / 2) - 1, q1 = Math.ceil(umax / SQ3 - k / 2) + 1;
      for (let q = q0; q <= q1; q++) {
        const u = SQ3 * (q + k / 2);
        if (Math.abs(u) > umax) continue;
        const t = terrainAt(q, k, seed, 0.41, island);
        const pts = [];
        let ok = true;
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 2 + i * TAU / 6;
          const p = proj(u + Math.cos(a), v + Math.sin(a));
          if (!p) { ok = false; break; }
          pts.push(p);
        }
        if (!ok) continue;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
        if (x1 < -40 || x0 > W + 40 || y1 < -40 || y0 > H + 40) continue;
        const size = Math.max(x1 - x0, y1 - y0);
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.closePath();
        g.fillStyle = BASE[t.m]; g.fill();
        const image = texOf(t.m, t.v);
        if (image && size > 4.5) {
          const lk = lookOf(q, k, seed);
          g.save(); g.clip();
          if (size > H * 0.42) g.filter = 'blur(0.8px)';
          drawTexturedHex(g, image, pts, lk.mir);
          g.restore();
        }
        // leichte Helligkeitsstreuung, damit die Wiederholung nicht auffällt
        if (size > 7) {
          const sd = h2(q, k, seed + 31);
          g.fillStyle = sd > 0.5 ? `rgba(0,0,0,${(sd - 0.5) * 0.15})` : `rgba(255,242,206,${(0.5 - sd) * 0.11})`;
          g.fill();
        }
        // feine Naht, hält die Waben auch in der Ferne lesbar
        if (size > 9) { g.strokeStyle = 'rgba(16,26,20,.16)'; g.lineWidth = Math.max(0.6, size * 0.012); g.stroke(); }
      }
    }

    // ---- Atmosphäre: der Dunst folgt der Wölbung des Horizonts ----
    const fogBand = (o1, o2, col, a) => {
      g.beginPath();
      for (let x = -10; x <= W + 10; x += 8) {
        const y = hy + bend(x) + o1 * H;
        x > -10 ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      for (let x = W + 10; x >= -10; x -= 8) g.lineTo(x, hy + bend(x) + o2 * H);
      g.closePath(); g.fillStyle = rgba(col, a); g.fill();
    };
    for (let i = 0; i < 18; i++) {
      const t = i / 18, t2 = (i + 1) / 18;
      const o0 = -0.11 + 0.56 * t, o1 = -0.11 + 0.56 * t2, om = (o0 + o1) / 2;
      const a = 0.62 * Math.exp(-Math.pow((om - 0.03) / 0.13, 2)) + 0.02;
      fogBand(o0, o1, mix('#f6cba0', '#a8835f', Math.min(1, Math.max(0, om / 0.55))), a * 0.10);
    }
    g.save(); g.globalCompositeOperation = 'soft-light';
    glow(g, W * 0.34, H * 0.2, H * 0.95, '#ffd6a0', 0.5);
    g.restore();
    vignette(g, W, H, 0.52);
  }

  // ======================================================================================
  // Szene: Spieltisch (Tiles als Plättchen auf dunklem Holz)
  // ======================================================================================
  function sceneTisch(g, W, H) {
    const seed = 37;
    const wood = tex.__wood;
    if (wood) {
      const s = Math.max(W / wood.width, H / wood.height);
      g.drawImage(wood, (W - wood.width * s) / 2, (H - wood.height * s) / 2, wood.width * s, wood.height * s);
    } else {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#4b2f1b'); gr.addColorStop(0.5, '#3a2414'); gr.addColorStop(1, '#241509');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = `rgba(255,200,130,${0.02 + Math.random() * 0.05})`;
        g.lineWidth = 1 + Math.random() * 3.5;
        g.beginPath();
        const y = Math.random() * H;
        g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + 26, W * 0.6, y - 24, W, y + 8); g.stroke();
      }
    }
    g.save(); g.globalCompositeOperation = 'soft-light';
    glow(g, W * 0.6, H * 0.16, Math.max(W, H) * 0.72, '#ffcf8c', 0.55);
    g.restore();

    const T = Math.min(W, H) * 0.125, stepX = SQ3 * T, stepY = 1.5 * T;
    const ox = W * 0.5, oy = H * 0.54;
    for (let k = Math.floor(-oy / stepY) - 2; k <= Math.ceil((H - oy) / stepY) + 2; k++) {
      const q0 = Math.floor(-ox / stepX - k / 2) - 2, q1 = Math.ceil((W - ox) / stepX - k / 2) + 2;
      for (let q = q0; q <= q1; q++) {
        const x = ox + SQ3 * (q + k / 2) * T, y = oy + k * stepY;
        const t = terrainAt(q, k, seed, 0.385);
        const rot = (h2(q, k, seed + 5) - 0.5) * 6, r = T * 0.87;
        const pts = hexPoints(x, y, r, rot);
        // Schatten
        g.save(); g.translate(4, 8); g.filter = 'blur(5px)';
        g.fillStyle = 'rgba(0,0,0,.5)'; hexPath(g, x, y, r, rot); g.fill();
        g.restore();
        // Plättchen
        hexPath(g, x, y, r, rot);
        g.fillStyle = BASE[t.m]; g.fill();
        const image = texOf(t.m, t.v);
        if (image) { g.save(); hexPath(g, x, y, r, rot); g.clip(); drawTexturedHex(g, image, pts, lookOf(q, k, seed).mir); g.restore(); }
        // Rand und Glanzkante
        g.strokeStyle = 'rgba(28,14,4,.8)'; g.lineWidth = 2.6; hexPath(g, x, y, r, rot); g.stroke();
        g.strokeStyle = 'rgba(255,226,176,.20)'; g.lineWidth = 1.1; hexPath(g, x, y, r * 0.93, rot); g.stroke();
      }
    }
    g.save(); g.globalCompositeOperation = 'multiply';
    const warm = g.createLinearGradient(0, 0, W, H);
    warm.addColorStop(0, 'rgba(255,238,204,1)'); warm.addColorStop(1, 'rgba(196,150,108,1)');
    g.fillStyle = warm; g.fillRect(0, 0, W, H);
    g.restore();
    vignette(g, W, H, 0.7);
    grain(g, W, H, 0.055);
  }

  // ======================================================================================
  // Szene: Seekarte (Land-Tiles auf Pergament, Meer als Tusche)
  // ======================================================================================
  function sceneKarte(g, W, H) {
    const seed = 59;
    const paper = tex.__paper;
    if (paper) {
      const s = Math.max(W / paper.width, H / paper.height);
      g.drawImage(paper, (W - paper.width * s) / 2, (H - paper.height * s) / 2, paper.width * s, paper.height * s);
    } else {
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, '#f0e2c0'); gr.addColorStop(0.5, '#e7d3a8'); gr.addColorStop(1, '#d9c08c');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 26; i++) glow(g, h2(i, 1, 77) * W, h2(i, 2, 77) * H, H * (0.05 + h2(i, 3, 77) * 0.16), '#b08a52', 0.05);
    }
    g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(255,247,222,1)'; g.fillRect(0, 0, W, H); g.restore();

    const T = Math.min(W, H) * 0.135, stepX = SQ3 * T, stepY = 1.5 * T;
    const ox = W * 0.5, oy = H * 0.54;
    const water = 0.425;
    const inFrame = (x, y) => x > W * 0.035 && x < W * 0.965 && y > H * 0.055 && y < H * 0.945;
    const isLand = (q, k) => terrainAt(q, k, seed, water).m !== 'meer';
    const land = [];
    for (let k = Math.floor(-oy / stepY) - 2; k <= Math.ceil((H - oy) / stepY) + 2; k++) {
      const q0 = Math.floor(-ox / stepX - k / 2) - 2, q1 = Math.ceil((W - ox) / stepX - k / 2) + 2;
      for (let q = q0; q <= q1; q++) {
        const x = ox + SQ3 * (q + k / 2) * T, y = oy + k * stepY;
        const t = terrainAt(q, k, seed, water);
        if (!inFrame(x, y)) continue;
        if (t.m === 'meer') continue;
        land.push([x, y, t, q, k]);
      }
    }
    // Meer: blasse Tusche und feine Wellenlinien
    g.save(); g.fillStyle = 'rgba(150,164,150,.16)'; g.fillRect(0, 0, W, H); g.restore();
    g.save(); g.strokeStyle = 'rgba(82,62,34,.22)'; g.lineWidth = 1.2;
    for (let i = 0; i < 210; i++) {
      const x = h2(i, 4, 91) * W, y = h2(i, 5, 91) * H, len = 8 + h2(i, 6, 91) * 24;
      g.beginPath(); g.moveTo(x - len / 2, y); g.quadraticCurveTo(x, y - 3.5, x + len / 2, y); g.stroke();
    }
    g.restore();
    // Land-Tiles als gemalte Flecken
    for (const [x, y, t, q, k] of land) {
      const rot = (h2(q, k, seed + 5) - 0.5) * 5, r = T * 0.99;
      const pts = hexPoints(x, y, r, rot);
      hexPath(g, x, y, r, rot);
      g.fillStyle = mix('#a28a5c', BASE[t.m], 0.3); g.fill();
      const image = texOf(t.m, t.v);
      if (image) {
        const lk = lookOf(q, k, seed);
        g.save(); g.globalAlpha = 0.62; drawTexturedHex(g, image, pts, lk.mir); g.restore();
      }
      // Küstenlinie zu Wasser hin
      g.strokeStyle = 'rgba(66,46,22,.42)'; g.lineWidth = 1.3; hexPath(g, x, y, r * 0.985, rot); g.stroke();
      const nb = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      g.strokeStyle = 'rgba(44,30,14,.9)'; g.lineWidth = 3.6; g.beginPath();
      for (let i = 0; i < 6; i++) {
        if (isLand(q + nb[i][0], k + nb[i][1])) continue;
        g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[(i + 1) % 6][0], pts[(i + 1) % 6][1]);
      }
      g.stroke();
    }
    // Sepia
    g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(222,198,148,1)'; g.fillRect(0, 0, W, H); g.restore();
    g.save(); g.globalCompositeOperation = 'color'; g.fillStyle = 'rgba(124,92,48,.28)'; g.fillRect(0, 0, W, H); g.restore();

    // Routen, Windrose, Ränder
    const route = (pts) => {
      g.save(); g.setLineDash([8, 10]); g.strokeStyle = 'rgba(92,56,24,.5)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(pts[0][0] * W, pts[0][1] * H);
      for (let i = 1; i < pts.length; i++) g.quadraticCurveTo(pts[i][0] * W, pts[i][1] * H, pts[i][0] * W, pts[i][1] * H);
      g.stroke(); g.restore();
    };
    route([[0.05, 0.9], [0.3, 0.66], [0.54, 0.56], [0.86, 0.3]]);
    route([[0.08, 0.14], [0.3, 0.3], [0.6, 0.38], [0.94, 0.72]]);
    // Windrose auf einer kleinen Pergamentscheibe, damit sie auch über Land lesbar bleibt
    g.save(); g.fillStyle = 'rgba(244,231,202,.96)';
    g.beginPath(); g.arc(W * 0.115, H * 0.79, Math.min(W, H) * 0.075, 0, TAU); g.fill(); g.restore();
    compass(g, W * 0.115, H * 0.79, Math.min(W, H) * 0.06);
    g.strokeStyle = 'rgba(92,64,30,.5)'; g.lineWidth = 2; g.strokeRect(W * 0.016, H * 0.022, W * 0.968, H * 0.956);
    g.strokeStyle = 'rgba(92,64,30,.28)'; g.lineWidth = 1; g.strokeRect(W * 0.028, H * 0.036, W * 0.944, H * 0.928);
    vignette(g, W, H, 0.4);
    grain(g, W, H, 0.07);
  }
  function compass(g, x, y, r) {
    g.save(); g.translate(x, y);
    g.fillStyle = 'rgba(96,64,30,.10)'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(76,48,20,.7)'; g.lineWidth = 1.8;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.8, 0, TAU); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8, L = i % 2 ? r * 0.52 : r * 0.84;
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a + 0.16) * L * 0.3, Math.sin(a + 0.16) * L * 0.3);
      g.lineTo(Math.cos(a) * L, Math.sin(a) * L);
      g.closePath();
      g.fillStyle = i === 0 ? 'rgba(116,52,22,.92)' : 'rgba(64,42,20,.72)'; g.fill();
    }
    g.restore();
  }

  // ======================================================================================
  // Szene: Nebelmeer bei Nacht
  // ======================================================================================
  function sceneNacht(g, W, H) {
    const seed = 83;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#040a18'); gr.addColorStop(0.5, '#071327'); gr.addColorStop(1, '#081a2e');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);

    const T = Math.min(W, H) * 0.115, stepX = SQ3 * T, stepY = 1.5 * T;
    const ox = W * 0.5, oy = H * 0.56;
    const lichter = [];
    for (let k = Math.floor(-oy / stepY) - 2; k <= Math.ceil((H - oy) / stepY) + 2; k++) {
      const q0 = Math.floor(-ox / stepX - k / 2) - 2, q1 = Math.ceil((W - ox) / stepX - k / 2) + 2;
      for (let q = q0; q <= q1; q++) {
        const x = ox + SQ3 * (q + k / 2) * T, y = oy + k * stepY;
        const t = terrainAt(q, k, seed, 0.43);
        const r = T * 0.97;
        hexPath(g, x, y, r);
        g.fillStyle = t.m === 'meer' ? '#071a2c' : mix('#0a1727', BASE[t.m], 0.16); g.fill();
        const image = texOf(t.m, t.v);
        if (image) {
          const lk = lookOf(q, k, seed);
          g.save(); hexPath(g, x, y, r); g.clip(); g.globalAlpha = t.m === 'meer' ? 0.22 : 0.34;
          drawTexturedHex(g, image, hexPoints(x, y, r), lk.mir);
          g.restore();
        }
        g.strokeStyle = 'rgba(104,148,198,.12)'; g.lineWidth = 1; hexPath(g, x, y, r * 0.99); g.stroke();
        if (t.m !== 'meer' && t.m !== 'wueste' && h2(q, k, seed + 12) > 0.89) lichter.push([x, y, r]);
      }
    }
    // Nachtblau über die ganze Fläche
    g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(76,108,168,.5)'; g.fillRect(0, 0, W, H); g.restore();
    // Mondlicht auf dem Wasser: ein breites, weiches Band von rechts oben
    const moon = g.createLinearGradient(W * 0.95, 0, W * 0.25, H);
    moon.addColorStop(0, 'rgba(150,186,250,.20)');
    moon.addColorStop(0.45, 'rgba(120,160,230,.07)');
    moon.addColorStop(1, 'rgba(90,130,200,0)');
    g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = moon; g.fillRect(0, 0, W, H); g.restore();
    // Lichter an den Siedlungen
    for (const [x, y, r] of lichter) {
      glow(g, x, y, r * 1.35, '#ffc46e', 0.52);
      g.fillStyle = '#ffe6b0'; g.beginPath(); g.arc(x, y, Math.max(1.1, r * 0.05), 0, TAU); g.fill();
    }
    // Nebelschwaden in mehreren Schichten
    for (let i = 0; i < 36; i++) {
      const x = h2(i, 7, 3) * W, y = H * (0.18 + h2(i, 8, 3) * 0.95);
      glow(g, x, y, Math.min(W, H) * (0.10 + h2(i, 9, 3) * 0.26), '#c8dcff', 0.035 + h2(i, 10, 3) * 0.055);
    }
    glow(g, W * 0.5, H * 1.05, H * 0.55, '#9fc0ff', 0.16);
    vignette(g, W, H, 0.7);
    grain(g, W, H, 0.05);
  }

  // ======================================================================================
  // Szenen-Registry und Rendering
  // ======================================================================================
  const SCENES = {
    erde: { name: 'Erdkrümmung', desc: 'Die Tiles wölben sich als Erde bis zum Dunsthorizont.', draw: sceneErde, tint: '#12233f' },
    tisch: { name: 'Spieltisch', desc: 'Die Tiles liegen als Plättchen auf dunklem Holz.', draw: sceneTisch, tint: '#2a170c' },
    karte: { name: 'Seekarte', desc: 'Die Tiles als gemalte Karte auf altem Pergament.', draw: sceneKarte, tint: '#c9b184' },
    nacht: { name: 'Nebelmeer', desc: 'Inseln und Lichter im Nebelmeer bei Nacht.', draw: sceneNacht, tint: '#071226' },
  };
  const ORDER = ['erde', 'tisch', 'karte', 'nacht'];

  let cur = localStorage.getItem(KEY) || 'erde';
  if (!SCENES[cur]) cur = 'erde';
  let cv = null, g = null, W = 0, H = 0, RS = 1, timer = 0, raf = 0;

  function sizeCanvas() {
    const el = $('sea');
    if (!el) return false;
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const s = Math.min(dpr, Math.sqrt(6.2e6 / (w * h)));
    if (cv && cv.width === Math.round(w * s) && cv.height === Math.round(h * s)) return false;
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'sea-bg';
      cv.setAttribute('aria-hidden', 'true');
      el.prepend(cv);
      g = cv.getContext('2d');
    }
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    W = w; H = h; RS = s;
    return true;
  }

  function render() {
    if (!cv || !g) return;
    g.setTransform(RS, 0, 0, RS, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    const sc = SCENES[cur] || SCENES.erde;
    g.fillStyle = sc.tint; g.fillRect(0, 0, W, H);
    try { sc.draw(g, W, H); } catch (e) { /* der Hintergrund darf nie das Spiel stören */ }
    g.setTransform(RS, 0, 0, RS, 0, 0);
    const el = $('sea'); if (el) el.dataset.bg = cur;
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  }
  function onResize() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (sizeCanvas()) schedule(); }, 180);
  }

  // ======================================================================================
  // Auswahl-Dialog
  // ======================================================================================
  let dlg = null;
  function previewFor(id) {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 270;
    const pg = c.getContext('2d');
    const sc = SCENES[id];
    pg.fillStyle = sc.tint; pg.fillRect(0, 0, 480, 270);
    try { sc.draw(pg, 480, 270); } catch (e) { /* Vorschau ist optional */ }
    return c;
  }
  function openChooser() {
    if (dlg) return;
    const back = document.activeElement;
    dlg = document.createElement('div');
    dlg._back = back;
    dlg.className = 'bgdlg';
    dlg.innerHTML = `<div class="bgdlg-back"></div><div class="bgdlg-card glass" role="dialog" aria-modal="true" aria-label="Hintergrund wählen">
      <h2>Hintergrund</h2><p class="bgdlg-sub">Gilt nur für dieses Gerät – jede Mitspielerin und jeder Mitspieler sieht den eigenen.</p>
      <div class="bgdlg-grid">${ORDER.map((id) => `<button type="button" class="bgopt${id === cur ? ' on' : ''}" data-bg="${id}" aria-pressed="${id === cur}"><span class="bgpv"></span><b>${SCENES[id].name}</b><small>${SCENES[id].desc}</small></button>`).join('')}</div>
      <div class="bgdlg-act"><button type="button" class="btn gold" data-bgclose data-focus>Fertig</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bg]');
      if (b) { set(b.dataset.bg); return; }
      if (e.target.closest('[data-bgclose]') || e.target.classList.contains('bgdlg-back')) closeChooser();
    });
    const boxes = [...dlg.querySelectorAll('.bgpv')];
    const paint = () => { const box = boxes.shift(); if (!box) return; box.appendChild(previewFor(box.parentElement.dataset.bg)); setTimeout(paint, 16); };
    setTimeout(paint, 30);
    const f = dlg.querySelector('[data-focus]'); if (f) f.focus();
  }
  function closeChooser() {
    if (!dlg) return;
    const b = dlg._back; dlg.remove(); dlg = null;
    if (b && b.focus) b.focus();
  }

  // ======================================================================================
  // Öffentliche Schnittstelle
  // ======================================================================================
  function set(id) {
    if (!SCENES[id]) return;
    cur = id;
    localStorage.setItem(KEY, id);
    if (dlg) dlg.querySelectorAll('.bgopt').forEach((b) => { const on = b.dataset.bg === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    render();
  }

  function init() {
    sizeCanvas();
    loadTextures();
    ['__sky', '__wood', '__paper'].forEach((n) => {
      const img = new Image(); img.decoding = 'async';
      img.onload = () => { tex[n] = img; schedule(); };
      img.src = 'img/bg/' + n.slice(2) + '.webp';
    });
    // Einstiegsknopf (im Spiel liegt die Wahl im Spielmenü)
    if (!$('bgBtn')) {
      const b = document.createElement('button');
      b.id = 'bgBtn'; b.type = 'button';
      b.title = 'Hintergrund wählen'; b.setAttribute('aria-label', 'Hintergrund wählen');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12,3 a9,9 0 1 0 0,18 a2,2 0 0 0 1.5,-3.3 a2,2 0 0 1 1.5,-3.3 h2 A4,4 0 0 0 21,10 A9,9 0 0 0 12,3Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="7.5" cy="10" r="1.4" fill="currentColor"/><circle cx="10" cy="6.6" r="1.4" fill="currentColor"/><circle cx="14.5" cy="6.4" r="1.4" fill="currentColor"/><circle cx="17" cy="9.6" r="1.4" fill="currentColor"/></svg>';
      b.addEventListener('click', openChooser);
      document.body.appendChild(b);
    }
    const hud = $('hud');
    if (hud) {
      const sync = () => document.body.classList.toggle('in-game', !hud.hidden);
      new MutationObserver(sync).observe(hud, { attributes: true, attributeFilter: ['hidden'] });
      sync();
    }
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg) { e.stopPropagation(); closeChooser(); } }, true);
    addEventListener('resize', onResize, { passive: true });
    addEventListener('orientationchange', onResize, { passive: true });
    schedule();
  }

  root.Bg = {
    init, set, choose: openChooser, close: closeChooser,
    current: () => cur, scenes: () => ORDER.map((id) => ({ id, name: SCENES[id].name, desc: SCENES[id].desc })),
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init);
  else init();
})(typeof self !== 'undefined' ? self : this);
