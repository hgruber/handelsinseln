'use strict';
// Kartengenerierung: zufällige Startinseln + unbegrenzt nachwachsende, entdeckbare Felder.
const G = require('../shared/geom');

const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
const TERRAIN_RES = { wald: 'holz', huegel: 'lehm', weide: 'wolle', acker: 'getreide', gebirge: 'erz' };
const LAND_BAG = ['wald', 'wald', 'wald', 'wald', 'weide', 'weide', 'weide', 'weide', 'acker', 'acker', 'acker', 'acker',
  'huegel', 'huegel', 'huegel', 'gebirge', 'gebirge', 'gebirge'];
const NUM_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

function shuffle(a, rnd) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const isLand = (t) => t && t !== 'meer';
const red = (n) => n === 6 || n === 8;

// Abstand zweier Hexe (axial)
function dist(a, b) {
  const A = G.parseH(a), B = G.parseH(b);
  const dq = A.q - B.q, dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function ringNeighbors(set) { // alle Hexe um eine Menge herum
  const out = new Set();
  for (const k of set) for (const n of G.neighbors(k)) if (!set.has(n)) out.add(n);
  return out;
}

// Zusammenhängende Landfläche um ein Hex
function island(S, k) {
  const seen = new Set();
  if (!isLand(S.hexes[k] && S.hexes[k].t)) return seen;
  const st = [k]; seen.add(k);
  while (st.length) {
    const c = st.pop();
    for (const n of G.neighbors(c)) if (!seen.has(n) && S.hexes[n] && isLand(S.hexes[n].t)) { seen.add(n); st.push(n); }
  }
  return seen;
}

function growBlob(count, rnd, avoid, startFn) {
  const blob = new Set([startFn()]);
  while (blob.size < count) {
    const cand = [...ringNeighbors(blob)].filter((k) => !avoid(k));
    if (!cand.length) break;
    // bevorzugt kompakte Formen (viele Nachbarn im Blob), mit Zufall
    const scored = cand.map((k) => ({ k, s: G.neighbors(k).filter((n) => blob.has(n)).length + rnd() * 1.6 }));
    scored.sort((a, b) => b.s - a.s);
    blob.add(scored[0].k);
  }
  return blob;
}

function drawNumber(S, rnd) {
  if (!S.numBag.length) S.numBag = shuffle(NUM_BAG, rnd);
  return S.numBag.pop();
}
function drawTerrain(S, rnd) {
  if (!S.landBag.length) S.landBag = shuffle(LAND_BAG, rnd);
  return S.landBag.pop();
}

// Startkarte je Variante
function placeIslands(S, n, rnd, variant) {
  const origin = '0,0';
  const land = new Set(), islands = [];
  const near = (k) => { for (const l of land) if (dist(k, l) < 2) return true; return false; };
  const add = (blob) => { blob.forEach((k) => land.add(k)); islands.push(blob); return blob; };
  if (variant === 'inseln') {
    const size = n <= 3 ? 7 : n === 4 ? 6 : 5;
    const R = Math.ceil(5 / (2 * Math.sin(Math.PI / n))) + 1;
    const ring = [];
    for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) if (dist(G.hk(q, r), origin) === R) ring.push(G.hk(q, r));
    const rot = rnd() * Math.PI * 2;
    const home = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i * 2 * Math.PI) / n;
      const tx = Math.cos(a) * R * Math.sqrt(3), ty = Math.sin(a) * R * 1.5;
      const start = ring.slice().sort((x, y) => { const px = G.hexCenter(x), py = G.hexCenter(y); return Math.hypot(px.x - tx, px.y - ty) - Math.hypot(py.x - tx, py.y - ty); })[0];
      home.push(add(growBlob(size, rnd, near, () => start)));
    }
    const center = add(growBlob(3, rnd, near, () => origin));
    // eine weitere kleine Insel weiter draußen
    for (let t = 0; t < 200; t++) {
      const q = Math.floor(rnd() * (2 * R + 9)) - R - 4, r = Math.floor(rnd() * (2 * R + 9)) - R - 4, st = G.hk(q, r);
      if (near(st) || dist(st, origin) < R + 3) continue;
      add(growBlob(1 + Math.floor(rnd() * 2), rnd, near, () => st)); break;
    }
    return { land, islands, home: new Set(home.flatMap((b) => [...b])), desertIn: center, exploredR: 2, neutral: islands.filter((b) => !home.includes(b)) };
  }
  const mainCount = variant === 'nebel' ? 8 + 2 * n : 10 + 3 * n;
  const main = add(growBlob(mainCount, rnd, () => false, () => origin));
  if (variant === 'klassisch') {
    const nSmall = n > 4 ? 4 : 3;
    for (let i = 0; i < nSmall; i++) {
      const size = 1 + Math.floor(rnd() * 3);
      for (let tries = 0; tries < 200; tries++) {
        const R = 6 + Math.floor(rnd() * 3);
        const q = Math.floor(rnd() * (2 * R + 1)) - R, r = Math.floor(rnd() * (2 * R + 1)) - R;
        const start = G.hk(q, r);
        if (dist(start, origin) > R + 1 || near(start)) continue;
        const blob = growBlob(size, rnd, near, () => start);
        if ([...blob].some(near)) continue;
        add(blob); break;
      }
    }
  }
  return { land, islands, home: new Set(main), desertIn: main, exploredR: variant === 'nebel' ? 1 : 2, neutral: islands.slice(1), mainCount };
}

function generate(S, nPlayers, rnd, settings) {
  const variant = (settings && settings.variant) || 'klassisch';
  S.hexes = {}; S.harbors = {}; S.numBag = []; S.landBag = []; S.robber = null;
  const L = placeIslands(S, nPlayers, rnd, variant);
  const { land, islands, home } = L;
  // Meer: alles bis zum Aufdeckungsradius um Land ist bekannt
  const sea = new Set();
  const R = L.exploredR;
  for (const l of land) {
    const { q, r } = G.parseH(l);
    for (let dq = -R; dq <= R; dq++) for (let dr = -R; dr <= R; dr++) {
      const k = G.hk(q + dq, r + dr);
      if (!land.has(k) && dist(k, l) <= R) sea.add(k);
    }
  }
  // Gelände + Zahlen
  const types = {};
  const desertArr = shuffle([...L.desertIn], rnd);
  const desert = desertArr[0];
  const homeCount = home.size;
  let goldLeft = variant === 'klassisch' && L.mainCount >= 22 ? 1 : 0;
  islands.forEach((isl) => {
    const isHome = [...isl].every((k) => home.has(k));
    for (const k of shuffle([...isl], rnd)) {
      if (k === desert) types[k] = 'wueste';
      else if (isHome && goldLeft > 0 && homeCount > 0) { types[k] = 'gold'; goldLeft--; }
      else if (!isHome) types[k] = rnd() < (variant === 'inseln' ? 0.55 : 0.4) ? 'gold' : drawTerrain(S, rnd);
      else types[k] = drawTerrain(S, rnd);
    }
  });
  const landKeys = [...land];
  let best = null;
  for (let t = 0; t < 300; t++) {
    const nums = {}; S.numBag = [];
    for (const k of shuffle(landKeys, rnd)) if (types[k] !== 'wueste') nums[k] = drawNumber(S, rnd);
    const bad = Object.keys(nums).some((k) => red(nums[k]) && G.neighbors(k).some((n) => nums[n] && red(nums[n])));
    best = nums; if (!bad) break;
  }
  land.forEach((k) => { S.hexes[k] = { t: types[k], n: best[k] || null }; if (types[k] === 'wueste') S.robber = k; });
  sea.forEach((k) => { S.hexes[k] = { t: 'meer', n: null }; });
  S.home = [...home];
  // Pirat auf ein Meerfeld in der Nähe der Heimatinseln
  const homeArr = [...home];
  const seaNear = [...sea].filter((k) => homeArr.some((m) => dist(k, m) === 2) && !homeArr.some((m) => dist(k, m) < 2));
  S.pirate = shuffle(seaNear.length ? seaNear : [...sea], rnd)[0];
  // Häfen
  const hcount = Math.max(4, Math.round(homeCount / 3.2));
  const kinds = [];
  while (kinds.length < hcount + 4) kinds.push(...shuffle([...RES, 'any', 'any', 'any', 'any'], rnd));
  const edges = [];
  for (const k of home) for (const e of G.hexEdges(k)) {
    const o = G.edgeHexes(e).find((x) => x !== k);
    if (S.hexes[o] && S.hexes[o].t === 'meer') edges.push(e);
  }
  let placed = 0;
  for (const e of shuffle(edges, rnd)) {
    if (placed >= hcount) break;
    if (tryHarbor(S, e, kinds[placed])) placed++;
  }
  S.harborKinds = kinds.slice(placed);
}

// Hafen auf Kante legen, wenn Land/Meer-Kante und Ecken noch frei von anderen Häfen
function tryHarbor(S, e, kind) {
  const [a, b] = G.edgeHexes(e);
  const A = S.hexes[a], B = S.hexes[b];
  if (!A || !B || isLand(A.t) === isLand(B.t)) return false;
  if (S.harbors[e]) return false;
  const vs = G.edgeVerts(e);
  for (const he in S.harbors) if (G.edgeVerts(he).some((v) => vs.includes(v))) return false;
  const land = isLand(A.t) ? a : b;
  S.harbors[e] = { kind };
  return true;
}

// Vorrat: null = unbegrenzt, Zahl = verbleibend
const LAND_W = { wald: 4, weide: 4, acker: 4, huegel: 3, gebirge: 3, gold: 1.3, wueste: 0.5 };
const CHIP_W = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const avail = (map, key) => map[key] === undefined || map[key] === null || map[key] > 0;
const take = (map, key) => { if (map[key] !== undefined && map[key] !== null) map[key]--; };
function weighted(items, w, rnd) {
  const tot = items.reduce((a, k) => a + w(k), 0);
  let x = rnd() * tot;
  for (const k of items) { x -= w(k); if (x <= 0) return k; }
  return items[items.length - 1];
}
function drawChip(S, rnd) {
  const ok = Object.keys(CHIP_W).filter((n) => avail(S.supply.chips, n));
  if (!ok.length) return null;
  const n = weighted(ok, (k) => CHIP_W[k], rnd);
  take(S.supply.chips, n);
  return +n;
}

// Neues Feld entdecken (Server wählt Zufallsfeld unter Beachtung der Vorräte). Gibt das Hex-Objekt zurück.
function discover(S, k, rnd) {
  const sup = S.supply;
  const ns = G.neighbors(k).map((n) => S.hexes[n]).filter(Boolean);
  const ln = ns.filter((h) => isLand(h.t)).length;
  const pLand = Math.min(0.62, 0.16 + 0.17 * ln);
  const chipsLeft = Object.keys(CHIP_W).some((n) => avail(sup.chips, n));
  const landTypes = Object.keys(LAND_W).filter((t) => avail(sup.terrain, t) && (t === 'wueste' || chipsLeft));
  const seaOk = avail(sup.terrain, 'meer');
  let wantLand = rnd() < pLand;
  if (wantLand && !landTypes.length) wantLand = false;
  if (!wantLand && !seaOk && landTypes.length) wantLand = true; // Meer-Vorrat erschöpft
  let h;
  if (wantLand) {
    const boost = S.fogGold || 1;
    const t = weighted(landTypes, (x) => LAND_W[x] * (x === 'gold' ? boost : 1), rnd);
    take(sup.terrain, t);
    h = { t, n: t === 'wueste' ? null : drawChip(S, rnd) };
  } else {
    if (seaOk) take(sup.terrain, 'meer');
    h = { t: 'meer', n: null }; // erschöpfte Vorräte: es bleibt (unbegrenzt) Meer
  }
  S.hexes[k] = h;
  // gelegentlich ein Hafen an der neuen Küste
  if (rnd() < 0.3) {
    const es = shuffle(G.hexEdges(k), rnd);
    for (const e of es) if (tryHarbor(S, e, S.harborKinds.length ? S.harborKinds.pop() : RES[Math.floor(rnd() * 5)])) break;
  }
  return h;
}

// Unentdeckter Rand
function fog(S) {
  const out = new Set();
  for (const k in S.hexes) for (const n of G.neighbors(k)) if (!S.hexes[n]) out.add(n);
  return [...out];
}

module.exports = { RES, TERRAIN_RES, shuffle, isLand, dist, island, generate, discover, fog, drawNumber, tryHarbor };
