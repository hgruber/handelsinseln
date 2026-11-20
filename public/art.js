// art.js – reine SVG-Zeichenfunktionen (Strings). Keine DOM-Zugriffe ausser Art.defs().
// Hexgroesse S = 100 (Mittelpunkt-zu-Ecke). Alle Hex-Motive sind lokal um (0,0) gezeichnet.
(function (root) {
  'use strict';
  const S = 100;
  const SQ3 = Math.sqrt(3);
  const f = (n) => +n.toFixed(1);

  const COLORS = { rot: '#dc3c3c', blau: '#2f78e0', orange: '#f2922a', weiss: '#f4f0e4', gruen: '#38a857', violett: '#9150cc' };
  const COLOR_NAMES = { rot: 'Rot', blau: 'Blau', orange: 'Orange', weiss: 'Weiß', gruen: 'Grün', violett: 'Violett' };
  const RES_COLORS = { holz: '#3f8a4e', lehm: '#c8622e', wolle: '#8fcf5a', getreide: '#e8b93c', erz: '#7d8aa0' };
  const RES_NAMES = { holz: 'Holz', lehm: 'Lehm', wolle: 'Wolle', getreide: 'Getreide', erz: 'Erz' };
  const TERRAIN_NAMES = { wald: 'Wald', huegel: 'Hügelland', weide: 'Weideland', acker: 'Ackerland', gebirge: 'Gebirge', wueste: 'Wüste', gold: 'Goldfluss', meer: 'Meer' };
  const DEV_NAMES = { ritter: 'Ritter', siegpunkt: 'Siegpunkt', strassenbau: 'Straßenbau', erfindung: 'Erfindung', monopol: 'Monopol' };

  function mix(a, b, t) {
    const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
    const c = (s) => Math.round(((A >> s) & 255) * (1 - t) + ((B >> s) & 255) * t);
    return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
  }
  const lighten = (c, t) => mix(c, '#ffffff', t);
  const darken = (c, t) => mix(c, '#000000', t);

  // ---- deterministischer Zufall --------------------------------------------------
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = typeof seed === 'string' ? hash(seed) : seed;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Hex-Geometrie ---------------------------------------------------------------
  const corner = (i, sc = 1) => { const a = -(30 + 60 * i) * Math.PI / 180; return [S * sc * Math.cos(a), S * sc * Math.sin(a)]; };
  const hexPts = (sc = 1) => { let s = []; for (let i = 0; i < 6; i++) { const c = corner(i, sc); s.push(f(c[0]) + ',' + f(c[1])); } return s.join(' '); };
  const TS = 0.93; // Terrain-Skalierung (Rest = Sandrand)

  // ---- Bildtexturen (public/img/<motiv><1|2>.webp, per Forge/Flux erzeugt) ---------------------------
  // Pro Motiv 2 Varianten; Wahl per Hex-Schluessel-Hash (+ optionale Spiegelung = 4 Looks).
  // Pattern werden nur EINMAL in defs() angelegt. Faellt das Bild aus (IMG_FAIL), greift die
  // prozedurale SVG-Zeichnung.
  const IMG_DIR = 'img/';
  const IMG_MOTIFS = ['wald', 'huegel', 'weide', 'acker', 'gebirge', 'wueste', 'gold', 'meer', 'nebel'];
  let IMG_FAIL = false;
  // Quadrat 200x200 um den Hex-Mittelpunkt (Eckradius 93 passt hinein); lokal je Hex, daher userSpaceOnUse.
  function imgFill(motif, k) {
    const h = hash('img' + k + motif);
    const flip = (h >> 3) & 1 ? ' transform="scale(-1,1)"' : '';
    return `<rect x="-100" y="-100" width="200" height="200" fill="url(#im-${motif}${1 + (h & 1)})"${flip}/>`;
  }
  // liegt (x,y) mit Rand m im Terrain-Hex?
  const inside = (x, y, m) => Math.abs(x) <= SQ3 / 2 * S * TS - m && Math.abs(y) + Math.abs(x) / SQ3 <= S * TS - m * 1.155;

  // Streut n Punkte (Poisson-aehnlich). avoid = Radius um die Mitte (Zahlenchip).
  function scatter(r, n, minD, m, avoid) {
    const pts = [];
    for (let tries = 0; tries < 400 && pts.length < n; tries++) {
      const x = (r() * 2 - 1) * 90, y = (r() * 2 - 1) * 95;
      if (!inside(x, y, m)) continue;
      if (avoid && Math.hypot(x, y + 6) < avoid) continue;
      if (pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < minD)) continue;
      pts.push([x, y]);
    }
    return pts.sort((a, b) => a[1] - b[1]);
  }

  // ---- Terrain-Motive ----------------------------------------------------------------
  const TERRAIN = {
    wald: ['#4b9a58', '#245a36'], huegel: ['#e08a55', '#a24c27'], weide: ['#b5e275', '#6fae44'],
    acker: ['#f8de72', '#d4a22d'], gebirge: ['#aab5c3', '#5d6978'], wueste: ['#f8e6b4', '#d9b872'], gold: ['#eec24e', '#9d6e14'],
  };

  const sparkle = (x, y, s, d) => `<path class="tw" style="--d:${d}s" transform="translate(${f(x)},${f(y)}) scale(${s})" d="M0,-6 L1.4,-1.4 L6,0 L1.4,1.4 L0,6 L-1.4,1.4 L-6,0 L-1.4,-1.4Z" fill="#fff8d0"/>`;

  function tree(x, y, s, r) {
    const g = ['#2f7a43', '#276b3a', '#3b8a4c', '#215c33'][Math.floor(r() * 4)];
    return `<g transform="translate(${f(x)},${f(y)}) scale(${f(s)})">` +
      `<ellipse cy="3" rx="9" ry="3" fill="#000" opacity=".28"/><rect x="-1.8" y="-4" width="3.6" height="8" rx="1" fill="#5d3d24"/>` +
      `<path d="M0,-17 L12,3 L-12,3Z" fill="${darken(g, .12)}"/><path d="M0,-17 L-12,3 L0,3Z" fill="#fff" opacity=".12"/>` +
      `<path d="M0,-29 L9,-8 L-9,-8Z" fill="${g}"/><path d="M0,-29 L-9,-8 L0,-8Z" fill="#fff" opacity=".16"/></g>`;
  }
  function sheep(x, y, s, flip) {
    return `<g transform="translate(${f(x)},${f(y)}) scale(${flip ? -s : s},${s})">` +
      `<ellipse cy="8" rx="13" ry="3.6" fill="#000" opacity=".25"/><path d="M-5,5 v5 M5,5 v5" stroke="#2f2a28" stroke-width="2.4" stroke-linecap="round"/>` +
      `<ellipse cx="11" cy="-1" rx="5.2" ry="4.4" fill="#37322f"/><ellipse cx="9" cy="-5" rx="2" ry="1.4" fill="#37322f"/>` +
      `<g fill="#fbf8ee"><circle cx="-6" cy="-1" r="6.8"/><circle cx="0" cy="-4.5" r="7.6"/><circle cx="6" cy="-1" r="6.2"/><circle cx="-1" cy="2" r="7"/></g>` +
      `<ellipse cy="5" rx="9" ry="3" fill="#000" opacity=".07"/></g>`;
  }
  function peak(x, y, w, h) {
    return `<g><path d="M${f(x)},${f(y - h)} L${f(x - w)},${f(y)} L${f(x + .1 * w)},${f(y)}Z" fill="url(#mtl)"/>` +
      `<path d="M${f(x)},${f(y - h)} L${f(x + w)},${f(y)} L${f(x + .1 * w)},${f(y)}Z" fill="url(#mtd)"/>` +
      `<path d="M${f(x)},${f(y - h)} L${f(x - .4 * w)},${f(y - .6 * h)} L${f(x - .17 * w)},${f(y - .68 * h)} L${f(x + .02 * w)},${f(y - .52 * h)} L${f(x + .17 * w)},${f(y - .66 * h)} L${f(x + .4 * w)},${f(y - .6 * h)}Z" fill="#f4f8ff"/>` +
      `<path d="M${f(x)},${f(y - h)} L${f(x + .4 * w)},${f(y - .6 * h)} L${f(x + .17 * w)},${f(y - .66 * h)} L${f(x + .02 * w)},${f(y - .52 * h)}Z" fill="#c4d4e8"/></g>`;
  }
  function nugget(x, y, s, r) {
    const n = 6, pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * 6.283 + r(), rr = (6 + r() * 4) * s; pts.push(f(x + Math.cos(a) * rr) + ',' + f(y + Math.sin(a) * rr * .8)); }
    return `<polygon points="${pts.join(' ')}" fill="url(#nug)" stroke="#8a5a08" stroke-width=".8" stroke-linejoin="round"/>` +
      `<ellipse cx="${f(x - 2 * s)}" cy="${f(y - 2.5 * s)}" rx="${f(2.4 * s)}" ry="${f(1.3 * s)}" fill="#fff" opacity=".65"/>`;
  }
  function brickPile(x, y) {
    const b = (bx, by) => `<rect x="${bx}" y="${by}" width="13" height="6.4" rx="1.2" fill="#d8683a" stroke="#7a3216" stroke-width=".8"/><rect x="${bx + 1}" y="${by + .6}" width="11" height="1.6" rx=".8" fill="#fff" opacity=".25"/>`;
    return `<g transform="translate(${f(x)},${f(y)})"><ellipse cy="6" rx="16" ry="3.5" fill="#000" opacity=".25"/>${b(-14, -2)}${b(0, -2)}${b(-7, -8.4)}</g>`;
  }

  const MOTIF = {
    wald(r, chip) {
      return scatter(r, 17, 21, 14, chip ? 38 : 0).map((p) => tree(p[0], p[1] + 8, 0.78 + r() * .3, r)).join('');
    },
    huegel(r, chip) {
      let o = '';
      const ms = scatter(r, 4, 40, 22, chip ? 40 : 0);
      for (const p of ms) {
        const w = 24 + r() * 10, h = 15 + r() * 8, x = p[0], y = p[1] + 12;
        o += `<ellipse cx="${f(x)}" cy="${f(y + 2)}" rx="${f(w)}" ry="5" fill="#000" opacity=".22"/>` +
          `<path d="M${f(x - w)},${f(y)} Q${f(x)},${f(y - h * 2)} ${f(x + w)},${f(y)}Z" fill="url(#hillg)"/>` +
          `<path d="M${f(x - w * .8)},${f(y - 2)} Q${f(x - w * .2)},${f(y - h * 1.6)} ${f(x + w * .2)},${f(y - h * 1.5)}" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>` +
          `<path d="M${f(x - w * .5)},${f(y - h * .45)} h${f(w)} M${f(x - w * .75)},${f(y - h * .08)} h${f(w * 1.5)}" stroke="#7a3216" stroke-opacity=".28" stroke-width="1.4"/>`;
      }
      for (const p of scatter(r, 3, 36, 18, chip ? 42 : 0)) o += brickPile(p[0], p[1] + 8);
      return o;
    },
    weide(r, chip) {
      let o = '';
      for (const p of scatter(r, 22, 14, 10, 0)) {
        o += `<path d="M${f(p[0])},${f(p[1])} q-2,-6 -4,-8 M${f(p[0])},${f(p[1])} v-9 M${f(p[0])},${f(p[1])} q2,-6 4,-8" stroke="#4d8a2c" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".75"/>`;
      }
      for (const p of scatter(r, 9, 18, 8, 0)) o += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="1.8" fill="${r() > .5 ? '#fff' : '#ffe58a'}" opacity=".9"/>`;
      for (const p of scatter(r, 3, 44, 20, chip ? 40 : 0)) o += sheep(p[0], p[1] + 6, 0.95, r() > .5);
      return o;
    },
    acker(r, chip) {
      const a = -20 * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      let o = '<g transform="rotate(-20)">';
      for (let y = -105; y <= 105; y += 15) {
        o += `<rect x="-125" y="${y - 3}" width="250" height="9" fill="#a8741a" opacity=".32"/><rect x="-125" y="${y - 3}" width="250" height="2" fill="#fff" opacity=".12"/>`;
        let stalks = '', heads = '';
        for (let x = -120; x <= 120; x += 13) {
          const px = x * ca - y * sa, py = x * sa + y * ca;
          if (Math.hypot(px, py) < (chip ? 35 : 0) || !inside(px, py, 4)) continue;
          stalks += `M${x},${y + 5} v-7 `; heads += `M${x},${y - 3} v-5 `;
        }
        if (stalks) o += `<path d="${stalks}" stroke="#b98a2b" stroke-width="1.4" fill="none"/><path d="${heads}" stroke="#fbe27c" stroke-width="4.4" stroke-linecap="round" fill="none"/><path d="${heads}" stroke="#c9922a" stroke-width="1" stroke-linecap="round" fill="none" opacity=".45" transform="translate(1.2,0)"/>`;
      }
      return o + '</g>';
    },
    gebirge(r, chip) {
      let o = '';
      const base = [[-44, 24, 34, 54], [46, 28, 30, 46], [-4, -28, 30, 46], [-62, -12, 18, 26], [66, -8, 18, 24]];
      for (const [x, y, w, h] of base) {
        if (chip && Math.hypot(x, y - h * .3) < 30 && y < 10) continue;
        const j = (r() - .5) * 6;
        o += `<ellipse cx="${f(x + 4)}" cy="${f(y + 3)}" rx="${f(w * 1.1)}" ry="6" fill="#000" opacity=".22"/>` + peak(x + j, y, w, h * (0.9 + r() * .2));
      }
      for (const p of scatter(r, 5, 20, 12, chip ? 36 : 0)) o += `<path d="M${f(p[0] - 4)},${f(p[1] + 14)} l3,-6 l5,0 l2,6z" fill="#7b8696" stroke="#4b5564" stroke-width=".6"/>`;
      return o;
    },
    wueste(r) {
      let o = '';
      const layers = [['#f1d794', -34, '#fff3c8'], ['#e8c882', -4, '#fbe8b0'], ['#dcb56a', 30, '#f3d690']];
      layers.forEach(([c, y, hi], i) => {
        const ph = r() * 20;
        o += `<path d="M-110,${y + 10} Q${-60 + ph},${y - 26} ${-10 + ph},${y} T${90},${y - 8} T130,${y + 6} V130 H-110Z" fill="${c}"/>` +
          `<path d="M-110,${y + 10} Q${-60 + ph},${y - 26} ${-10 + ph},${y} T${90},${y - 8} T130,${y + 6}" fill="none" stroke="${hi}" stroke-width="2.4" stroke-linecap="round"/>` +
          `<path d="M-110,${y + 13} Q${-60 + ph},${y - 22} ${-10 + ph},${y + 3} T${90},${y - 5}" fill="none" stroke="#b58a3e" stroke-opacity=".25" stroke-width="1.5"/>`;
        void i;
      });
      const cx = 44 + r() * 16, cy = 38;
      o += `<g transform="translate(${f(cx)},${cy})"><ellipse cy="4" rx="10" ry="3" fill="#000" opacity=".22"/><g stroke="#4f8d3c" stroke-width="5.4" stroke-linecap="round" fill="none"><path d="M0,3 V-18"/><path d="M0,-5 H-8 V-13"/><path d="M0,-8 H8 V-15"/></g></g>`;
      o += `<ellipse cx="-58" cy="46" rx="9" ry="5" fill="#a48a5c"/><ellipse cx="-60" cy="44" rx="6" ry="3" fill="#c9b280"/>`;
      return o;
    },
    gold(r, chip) {
      let o = '<path d="M-100,40 Q-40,0 10,28 T110,-6" fill="none" stroke="#fff3a0" stroke-opacity=".35" stroke-width="10"/><path d="M-100,-30 Q-30,-60 40,-30 T110,-44" fill="none" stroke="#fff3a0" stroke-opacity=".22" stroke-width="7"/>';
      for (const p of scatter(r, 9, 24, 14, chip ? 38 : 0)) o += `<ellipse cx="${f(p[0] + 3)}" cy="${f(p[1] + 7)}" rx="10" ry="3" fill="#000" opacity=".25"/>` + nugget(p[0], p[1], 0.9 + r() * .4, r);
      for (const p of scatter(r, 7, 26, 10, 0)) o += sparkle(p[0], p[1], .7 + r() * .8, f(r() * 3));
      return o;
    },
  };

  // ---- Hex (Terrain + Chip) ------------------------------------------------------------------
  function chip(n) {
    const red = n === 6 || n === 8;
    const dots = 6 - Math.abs(7 - n);
    let d = '';
    for (let i = 0; i < dots; i++) d += `<circle cx="${f((i - (dots - 1) / 2) * 4.8)}" cy="14.5" r="1.7"/>`;
    return `<g class="chip" data-n="${n}"><circle r="29" cy="3" fill="#000" opacity=".32"/><circle r="28" fill="url(#chipw)"/>` +
      `<circle r="24" fill="url(#chipi)" stroke="#b4a070" stroke-width=".8"/><circle r="24" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".8" transform="translate(-.6,-.6)"/>` +
      `<text y="${n >= 10 ? 7 : 8}" text-anchor="middle" font-family="Georgia,Palatino,serif" font-weight="700" font-size="${n >= 10 ? 21 : 24}" fill="${red ? '#c0262d' : '#2b2118'}">${n}</text>` +
      `<g fill="${red ? '#c0262d' : '#2b2118'}">${d}</g></g>`;
  }

  // Inhalt eines Land-/Meer-Hex (in <g class="in">).
  function hex(k, t, n) {
    const r = rng(k + t);
    const pts93 = hexPts(TS), pts100 = hexPts(1);
    const ring = `<polygon class="ring" points="${pts93}"/><polygon class="flash" points="${pts93}"/>`;
    if (t === 'meer') {
      let o = IMG_FAIL ? `<polygon points="${pts100}" fill="url(#shallow)"/>` :
        `<g clip-path="url(#hclip1)">${imgFill('meer', k)}</g><polygon points="${pts100}" fill="url(#shallow)" opacity=".35"/>`;
      o += `<polygon points="${hexPts(.9)}" fill="none" stroke="#bfe9ff" stroke-opacity=".10" stroke-width="1.5"/>`;
      for (let i = 0; i < 3; i++) {
        const p = scatter(r, 1, 0, 14, 0)[0] || [0, 0];
        o += `<path class="wv" style="--d:${f(r() * 6)}s" d="M${f(p[0] - 9)},${f(p[1])} q4.5,-4 9,0 t9,0" fill="none" stroke="#e8f8ff" stroke-width="1.6" stroke-linecap="round"/>`;
      }
      for (let i = 0; i < 2; i++) { const p = scatter(r, 1, 0, 14, 0)[0] || [0, 0]; o += sparkle(p[0], p[1], .55, f(r() * 4)); }
      return o + ring;
    }
    const [c1, c2] = TERRAIN[t] || TERRAIN.wald;
    void c1; void c2;
    const motif = IMG_FAIL || !IMG_MOTIFS.includes(t) ? (MOTIF[t] || (() => ''))(r, n != null) : imgFill(t, k);
    return `<polygon points="${pts100}" fill="url(#sandg)"/>` +
      `<g clip-path="url(#hclip)"><polygon points="${pts93}" fill="url(#tg-${t})"/>${motif}<polygon points="${pts93}" fill="url(#vig)"/>` +
      (t === 'gold' ? `<polygon class="shimmer" points="${pts93}" fill="url(#shim)"/>` : '') + `</g>` +
      `<polygon points="${pts93}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.4"/>` + ring +
      (n != null ? chip(n) : '');
  }

  function fog(k) {
    const r = rng('fog' + k);
    let blobs = '';
    for (let i = 0; i < 5; i++) {
      const x = (r() - .5) * 120, y = (r() - .5) * 120, rx = 50 + r() * 38;
      blobs += `<ellipse class="fb fb${i % 3}" style="--d:${f(-r() * 14)}s" cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(rx * .6)}" fill="url(#fogb)"/>`;
    }
    return `<polygon points="${hexPts(1)}" fill="url(#fogg)"/><g clip-path="url(#hclip1)">${IMG_FAIL ? '' : imgFill('nebel', k) + `<polygon points="${hexPts(1)}" fill="#f1f6fd" opacity=".38"/>`}${blobs}</g>` +
      `<polygon points="${hexPts(.94)}" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="5 7"/>` +
      `<text class="q" y="20" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="58" fill="#ffffff" stroke="#4a6385" stroke-opacity=".55" stroke-width="2" paint-order="stroke" opacity=".72">?</text>`;
  }

  // Schaum an Kuesten: Kanten zu Nachbarn ohne Land. mask: 6 Bits (Nachbar j).
  function foam(mask) {
    let d = '';
    for (let j = 0; j < 6; j++) if (mask & (1 << j)) {
      const a = corner((j + 5) % 6), b = corner(j);
      d += `M${f(a[0])},${f(a[1])} L${f(b[0])},${f(b[1])} `;
    }
    return `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3.2" stroke-linecap="round"/>` +
      `<path class="fo" d="${d}" fill="none" stroke="#d9f3ff" stroke-opacity=".5" stroke-width="7" stroke-linecap="round"/>`;
  }
  const shadow = () => `<polygon points="${hexPts(1)}" fill="#000" opacity=".30" transform="translate(0,7)"/>`;

  // ---- Haefen -----------------------------------------------------------------------------------
  // Lokal: Ursprung = Kantenmitte, +x zeigt zum Meer; Schild bleibt aufrecht (Gegenrotation).
  function harbor(kind, ang) {
    const any = kind === 'any';
    const sign = `<g transform="translate(48,0) rotate(${f(-ang)}) scale(1.18)"><circle r="22" cy="2.5" fill="#000" opacity=".3"/>` +
      `<circle r="21" fill="url(#signw)" stroke="#5a3a1c" stroke-width="2"/><circle r="17" fill="#f6ecd0" stroke="#b49560" stroke-width=".8"/>` +
      (any ? `<text y="3" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="14" fill="#3a2a16">3:1</text><text y="13" text-anchor="middle" font-size="6.5" fill="#6b5330" font-family="system-ui,sans-serif">ALLE</text>`
        : `<g transform="translate(-9,-14) scale(.37)">${resInner(kind)}</g><text y="13.5" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="11" fill="#3a2a16">2:1</text>`) + `</g>`;
    const planks = (y) => `<g stroke-linecap="round"><path d="M0,${y} L30,${y * .42}" stroke="#3a2412" stroke-width="7"/><path d="M0,${y} L30,${y * .42}" stroke="#a97c4a" stroke-width="5"/><path d="M0,${y} L30,${y * .42}" stroke="#d3a771" stroke-width="1.4" transform="translate(0,-1.2)"/></g>`;
    return `<g transform="rotate(${f(ang)})">${planks(-38)}${planks(38)}<circle cx="0" cy="-38" r="3.4" fill="#5a3a1c"/><circle cx="0" cy="38" r="3.4" fill="#5a3a1c"/>${sign}</g>`;
  }

  // ---- Figuren ----------------------------------------------------------------------------------
  const sh = (rx, ry, dy = 3) => `<ellipse cy="${dy}" rx="${rx}" ry="${ry}" fill="#000" opacity=".35"/>`;
  function settlement(c) {
    const o = `stroke="#000" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round"`;
    return `<g transform="scale(1.2)">` + sh(15, 5, 2) +
      `<path d="M-10,0 V-12 H10 V0Z" fill="url(#pg-${c})" ${o}/><path d="M-13,-11 L0,-25 L13,-11Z" fill="url(#pd-${c})" ${o}/>` +
      `<path d="M-10,-12 H-3 V0 H-10Z" fill="#fff" opacity=".18"/><rect x="-2.6" y="-8" width="5.2" height="8" rx="1" fill="#2b1d12" opacity=".7"/>` +
      `<path d="M-9,-13 L0,-23" stroke="#fff" stroke-opacity=".4" stroke-width="1.4" stroke-linecap="round"/></g>`;
  }
  function city(c) {
    const o = `stroke="#000" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round"`;
    return `<g transform="scale(1.12)">` + sh(22, 6, 2) +
      `<path d="M-3,0 V-15 H19 V0Z" fill="url(#pg-${c})" ${o}/><path d="M-6,-14 L8,-26 L22,-14Z" fill="url(#pd-${c})" ${o}/>` +
      `<path d="M-19,0 V-31 H-3 V0Z" fill="url(#pg-${c})" ${o}/><path d="M-22,-30 L-11,-45 L0,-30Z" fill="url(#pd-${c})" ${o}/>` +
      `<path d="M-19,-31 H-12 V0 H-19Z" fill="#fff" opacity=".18"/><rect x="-14" y="-24" width="5" height="7" rx="2.2" fill="#2b1d12" opacity=".7"/>` +
      `<rect x="4" y="-9" width="4.4" height="9" rx="1" fill="#2b1d12" opacity=".7"/><rect x="11" y="-10" width="4" height="4.4" fill="#ffe7a0" opacity=".85"/>` +
      `<path d="M-11,-43 L-11,-52" stroke="#222" stroke-width="1.2"/><path d="M-11,-52 L-3,-49 L-11,-46Z" fill="#fff"/></g>`;
  }
  function road(c) {
    return `<rect x="-31" y="-4" width="62" height="12" rx="4" fill="#000" opacity=".32"/>` +
      `<rect x="-31" y="-7" width="62" height="12.5" rx="4.5" fill="url(#pr-${c})" stroke="#000" stroke-opacity=".55" stroke-width="1.2"/>` +
      `<rect x="-27" y="-5.4" width="54" height="2.6" rx="1.3" fill="#fff" opacity=".4"/>`;
  }
  function ship(c) {
    return `<ellipse cy="9" rx="26" ry="5" fill="#000" opacity=".28"/><g class="bob">` +
      `<path class="wake" d="M-26,8 q6,-4 12,0 M-30,12 q8,-5 16,0" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="M-23,-1 H24 Q20,10 8,10 H-13 Q-20,9 -23,-1Z" fill="#6b4423" stroke="#000" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M-22,1.5 H22.5" stroke="url(#pg-${c})" stroke-width="3.4"/><path d="M-20,-1 H22" stroke="#fff" stroke-opacity=".3" stroke-width="1.2"/>` +
      `<path d="M0,0 V-34" stroke="#3a2412" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M2,-32 Q22,-18 20,-3 H2Z" fill="url(#pg-${c})" stroke="#000" stroke-opacity=".5" stroke-width="1.1" stroke-linejoin="round"/>` +
      `<path d="M-2,-30 Q-14,-18 -12,-5 H-2Z" fill="url(#pd-${c})" stroke="#000" stroke-opacity=".5" stroke-width="1.1" stroke-linejoin="round"/>` +
      `<path d="M0,-34 l9,3 l-9,3Z" fill="#fff"/></g>`;
  }
  function robber() {
    return `<g transform="scale(1.2)">` + sh(15, 5, 2) +
      `<path d="M-13,0 Q-13,-10 -6,-17 Q-9,-24 0,-30 Q9,-24 6,-17 Q13,-10 13,0Z" fill="url(#rob)" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M-6,-24 Q0,-30 6,-24 Q0,-21 -6,-24Z" fill="#000" opacity=".55"/><circle cx="-2.4" cy="-24" r="1.2" fill="#ff5a3c"/><circle cx="2.4" cy="-24" r="1.2" fill="#ff5a3c"/>` +
      `<path d="M-9,-6 Q-11,-12 -5,-17" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-linecap="round"/></g>`;
  }
  function pirate() {
    return `<ellipse cy="9" rx="28" ry="5.5" fill="#000" opacity=".35"/><g class="bob">` +
      `<path class="wake" d="M-26,8 q6,-4 12,0 M-30,12 q8,-5 16,0" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="M-25,-1 H26 Q22,11 8,11 H-14 Q-22,10 -25,-1Z" fill="#1c1a1f" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><path d="M-24,2 H24" stroke="#8c1c1c" stroke-width="2.4"/>` +
      `<path d="M0,0 V-40" stroke="#111" stroke-width="2.8" stroke-linecap="round"/>` +
      `<path d="M2,-36 Q26,-22 22,-4 H2Z" fill="#26232b" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/><path d="M-2,-34 Q-16,-22 -13,-6 H-2Z" fill="#17151a" stroke="#000" stroke-width="1.1"/>` +
      `<circle cx="11" cy="-17" r="4.2" fill="#f1ede0"/><rect x="8.4" y="-14" width="5.2" height="2.6" rx=".8" fill="#f1ede0"/><circle cx="9.6" cy="-17.4" r="1" fill="#17151a"/><circle cx="12.4" cy="-17.4" r="1" fill="#17151a"/>` +
      `<path d="M0,-40 l12,3.5 l-12,3.5Z" fill="#0c0c0e" stroke="#fff" stroke-opacity=".5" stroke-width=".6"/></g>`;
  }

  // Figur in kleinem Symbol (Bau-Buttons)
  function pieceIcon(kind, c, size = 36) {
    const body = { road: road(c), ship: ship(c), settlement: settlement(c), city: city(c) }[kind] || '';
    const vb = kind === 'road' ? '-36 -14 72 28' : kind === 'ship' ? '-34 -42 68 58' : kind === 'city' ? '-26 -54 52 62' : '-20 -30 40 36';
    return `<svg class="pi" viewBox="${vb}" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  }

  // ---- Ressourcen-Symbole (48x48) ---------------------------------------------------------------
  function resInner(r) {
    switch (r) {
      case 'holz': {
        const lg = (x, y) => `<circle cx="${x}" cy="${y}" r="10.5" fill="#6b4423"/><circle cx="${x}" cy="${y}" r="8.6" fill="#e0b27a"/><circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#b9803f" stroke-width="1.1"/><circle cx="${x}" cy="${y}" r="3" fill="none" stroke="#b9803f" stroke-width="1"/><path d="M${x - 6},${y - 5} a8,8 0 0 1 8,-3" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
        return `<ellipse cx="24" cy="43" rx="19" ry="3.2" fill="#000" opacity=".25"/>${lg(14, 33)}${lg(34, 33)}${lg(24, 16)}`;
      }
      case 'lehm': {
        const br = (x, y) => `<rect x="${x}" y="${y}" width="21" height="10" rx="2" fill="#c8622e" stroke="#6e2d10" stroke-width="1.4"/><rect x="${x + 2}" y="${y + 1.4}" width="17" height="2.6" rx="1.3" fill="#fff" opacity=".35"/><rect x="${x}" y="${y + 6.5}" width="21" height="3.5" rx="2" fill="#000" opacity=".14"/>`;
        return `<ellipse cx="24" cy="44" rx="20" ry="3" fill="#000" opacity=".25"/>${br(2, 33)}${br(25, 33)}${br(13.5, 22)}${br(2, 11)}${br(25, 11)}`;
      }
      case 'wolle':
        return `<ellipse cx="24" cy="43" rx="18" ry="3" fill="#000" opacity=".25"/><path d="M15,34 v7 M30,34 v7" stroke="#2f2a28" stroke-width="3.4" stroke-linecap="round"/>` +
          `<ellipse cx="38" cy="25" rx="6.5" ry="6" fill="#37322f"/><ellipse cx="36" cy="19" rx="3" ry="2" fill="#37322f"/><circle cx="40" cy="24" r="1.1" fill="#fff"/>` +
          `<g fill="#fbf8ee" stroke="#cdc6b0" stroke-width="1"><circle cx="13" cy="25" r="9"/><circle cx="22" cy="18" r="10"/><circle cx="31" cy="25" r="9"/><circle cx="22" cy="30" r="10"/></g><circle cx="17" cy="15" r="4" fill="#fff" opacity=".8"/>`;
      case 'getreide': {
        let g = '';
        for (let i = 0; i < 4; i++) { const y = 14 + i * 7.5; g += `<ellipse cx="17" cy="${y + 2}" rx="3.4" ry="6.6" transform="rotate(-38 17 ${y + 2})" fill="#f6cf52" stroke="#b07c14" stroke-width="1"/><ellipse cx="31" cy="${y + 2}" rx="3.4" ry="6.6" transform="rotate(38 31 ${y + 2})" fill="#f6cf52" stroke="#b07c14" stroke-width="1"/>`; }
        return `<ellipse cx="24" cy="44" rx="14" ry="2.6" fill="#000" opacity=".22"/><path d="M24,44 V12" stroke="#a97a1e" stroke-width="2.4" stroke-linecap="round"/>${g}<ellipse cx="24" cy="8.5" rx="3.4" ry="7" fill="#f6cf52" stroke="#b07c14" stroke-width="1"/><path d="M24,36 q-9,-1 -12,-8" stroke="#6fa33a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
      }
      case 'erz':
        return `<ellipse cx="24" cy="43" rx="20" ry="3.2" fill="#000" opacity=".25"/>` +
          `<path d="M5,40 L11,22 L22,14 L36,20 L44,40Z" fill="#7a8599" stroke="#3a4352" stroke-width="1.6" stroke-linejoin="round"/><path d="M11,22 L22,14 L26,28 L5,40Z" fill="#a1abbc"/><path d="M22,14 L36,20 L44,40 L26,28Z" fill="#59647a"/>` +
          `<path d="M24,26 L28,6 L33,26Z" fill="#8fd4ff" stroke="#2c6ea1" stroke-width="1.3" stroke-linejoin="round"/><path d="M28,6 L33,26 L29,26Z" fill="#fff" opacity=".4"/><path d="M13,32 L16,20 L20,32Z" fill="#8fd4ff" stroke="#2c6ea1" stroke-width="1.2" stroke-linejoin="round"/>`;
      default: return '';
    }
  }
  const res = (r, size = 32) => `<svg class="ri ri-${r}" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${resInner(r)}</svg>`;

  // ---- Entwicklungskarten-Symbole (48x48) --------------------------------------------------------
  function devInner(t) {
    switch (t) {
      case 'ritter': return `<path d="M10,8 H38 V26 Q38,38 24,44 Q10,38 10,26Z" fill="#8a97ad" stroke="#2a3342" stroke-width="2" stroke-linejoin="round"/><path d="M24,8 H38 V26 Q38,38 24,44Z" fill="#6b788f"/><path d="M24,13 V39 M14,22 H34" stroke="#f1d27a" stroke-width="3.4" stroke-linecap="round"/><path d="M13,12 H20" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`;
      case 'siegpunkt': return `<path d="M24,5 L29.5,17.5 L43,19 L33,28 L36,41.5 L24,34.5 L12,41.5 L15,28 L5,19 L18.5,17.5Z" fill="#f5c542" stroke="#8a5a08" stroke-width="2" stroke-linejoin="round"/><path d="M24,5 L29.5,17.5 L24,22Z M5,19 L18.5,17.5 L20,24Z" fill="#fff" opacity=".35"/>`;
      case 'strassenbau': return `<path d="M17,6 H31 L42,44 H6Z" fill="#59627a" stroke="#262d3d" stroke-width="2" stroke-linejoin="round"/><path d="M24,10 V16 M24,22 V30 M24,36 V43" stroke="#f1e2a0" stroke-width="3" stroke-linecap="round"/><path d="M17,6 L6,44" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>`;
      case 'erfindung': return `<path d="M24,5 a13,13 0 0 1 7,24 v5 H17 v-5 a13,13 0 0 1 7,-24Z" fill="#ffe27a" stroke="#8a6a10" stroke-width="2" stroke-linejoin="round"/><rect x="17" y="36" width="14" height="5" rx="2" fill="#8c95a8" stroke="#3a4352" stroke-width="1.4"/><path d="M19,15 a7,7 0 0 1 5,-4" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".8"/><path d="M6,12 l4,3 M42,12 l-4,3 M4,24 h5 M44,24 h-5" stroke="#ffe27a" stroke-width="2" stroke-linecap="round"/>`;
      case 'monopol': return `<ellipse cx="24" cy="36" rx="16" ry="6" fill="#b07c14"/><path d="M8,30 v6 a16,6 0 0 0 32,0 v-6Z" fill="#d9a21e"/><ellipse cx="24" cy="30" rx="16" ry="6" fill="#f5c542" stroke="#8a5a08" stroke-width="1.6"/><ellipse cx="24" cy="18" rx="16" ry="6" fill="#d9a21e"/><ellipse cx="24" cy="14" rx="16" ry="6" fill="#f8d65c" stroke="#8a5a08" stroke-width="1.6"/><text x="24" y="18" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="11" fill="#8a5a08">$</text>`;
      default: return '';
    }
  }
  const dev = (t, size = 32) => `<svg class="di" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${devInner(t)}</svg>`;

  // ---- kleine Protokoll-Symbole (16x16) ---------------------------------------------------------------
  function logIcon(kind) {
    const p = {
      roll: '<rect x="2" y="2" width="12" height="12" rx="3" fill="#f4efe2" stroke="#8a7a56"/><circle cx="5.5" cy="5.5" r="1.3" fill="#2b2118"/><circle cx="10.5" cy="10.5" r="1.3" fill="#2b2118"/><circle cx="8" cy="8" r="1.3" fill="#2b2118"/>',
      build: '<path d="M3,13 L9,7 M7,3 l4,-1 l3,3 l-1,4 l-3,-3z" stroke="#e8b95a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
      trade: '<path d="M2,5 H12 M9,2 l3,3 l-3,3 M14,11 H4 M7,8 l-3,3 l3,3" stroke="#7fd6a0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
      steal: '<path d="M3,13 L11,5 M10,3 l3,0 l0,3" stroke="#ef8a7a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="4" cy="12" r="1.6" fill="#ef8a7a"/>',
      award: '<path d="M8,1.5 l2,4.2 l4.5,.6 l-3.3,3.1 l.9,4.5 l-4.1,-2.3 l-4.1,2.3 l.9,-4.5 l-3.3,-3.1 l4.5,-.6z" fill="#f5c542" stroke="#8a5a08" stroke-width=".8"/>',
      sys: '<circle cx="8" cy="8" r="3" fill="#8fa3c0"/>',
      info: '<circle cx="8" cy="8" r="2.4" fill="#8fa3c0"/>',
    }[kind] || '<circle cx="8" cy="8" r="2.4" fill="#8fa3c0"/>';
    return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${p}</svg>`;
  }

  // ---- gemeinsame Defs (Gradienten etc.) --------------------------------------------------------------------
  function defs() {
    let o = '';
    for (const m of IMG_MOTIFS) for (const v of [1, 2]) o += `<pattern id="im-${m}${v}" patternUnits="userSpaceOnUse" x="-100" y="-100" width="200" height="200"><image href="${IMG_DIR}${m}${v}.webp" width="200" height="200" preserveAspectRatio="none"/></pattern>`;
    // Ausfall-Probe: ein Bild vorladen; schlaegt es fehl, nutzen spaetere Hex-Zeichnungen die SVG-Motive.
    if (typeof Image !== 'undefined') { const pr = new Image(); pr.onerror = () => { IMG_FAIL = true; }; pr.src = IMG_DIR + 'wald1.webp'; }
    o += `<clipPath id="hclip"><polygon points="${hexPts(TS)}"/></clipPath><clipPath id="hclip1"><polygon points="${hexPts(1)}"/></clipPath>`;
    for (const [t, [a, b]] of Object.entries(TERRAIN)) o += `<radialGradient id="tg-${t}" cx="42%" cy="35%" r="85%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
    o += `<radialGradient id="vig" cx="50%" cy="50%" r="60%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".30"/></radialGradient>` +
      `<linearGradient id="sandg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5e3b0"/><stop offset="1" stop-color="#c9a468"/></linearGradient>` +
      `<radialGradient id="shallow" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#5fc0d8" stop-opacity=".16"/><stop offset="1" stop-color="#2c88b4" stop-opacity=".30"/></radialGradient>` +
      `<radialGradient id="fogg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#d6e3f2"/><stop offset="1" stop-color="#8398b6"/></radialGradient>` +
      `<radialGradient id="fogb"><stop offset="0" stop-color="#f4f8ff" stop-opacity=".85"/><stop offset="1" stop-color="#f4f8ff" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="hillg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f09a64"/><stop offset="1" stop-color="#b4562c"/></linearGradient>` +
      `<linearGradient id="mtl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c3ccd8"/><stop offset="1" stop-color="#8591a2"/></linearGradient>` +
      `<linearGradient id="mtd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#76839a"/><stop offset="1" stop-color="#465266"/></linearGradient>` +
      `<radialGradient id="nug" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff2a6"/><stop offset=".5" stop-color="#f2bb2c"/><stop offset="1" stop-color="#b3770e"/></radialGradient>` +
      `<linearGradient id="shim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff6b8" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
      `<radialGradient id="chipw" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#c79a62"/><stop offset="1" stop-color="#6f4a26"/></radialGradient>` +
      `<radialGradient id="chipi" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#e6d6b0"/></radialGradient>` +
      `<radialGradient id="signw" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#c79a62"/><stop offset="1" stop-color="#6f4a26"/></radialGradient>` +
      `<linearGradient id="rob" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5b5f6e"/><stop offset=".5" stop-color="#2a2c36"/><stop offset="1" stop-color="#14151b"/></linearGradient>`;
    for (const [c, h] of Object.entries(COLORS)) {
      o += `<linearGradient id="pg-${c}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(h, .35)}"/><stop offset=".55" stop-color="${h}"/><stop offset="1" stop-color="${darken(h, .28)}"/></linearGradient>` +
        `<linearGradient id="pd-${c}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${darken(h, .05)}"/><stop offset="1" stop-color="${darken(h, .42)}"/></linearGradient>` +
        `<linearGradient id="pr-${c}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(h, .3)}"/><stop offset=".5" stop-color="${h}"/><stop offset="1" stop-color="${darken(h, .32)}"/></linearGradient>`;
    }
    return o;
  }

  root.Art = {
    S, COLORS, COLOR_NAMES, RES_COLORS, RES_NAMES, TERRAIN_NAMES, DEV_NAMES, mix, lighten, darken,
    hexPts, corner, hex, fog, foam, shadow, chip, harbor, settlement, city, road, ship, robber, pirate, pieceIcon,
    res, dev, logIcon, defs,
  };
})(typeof self !== 'undefined' ? self : this);
