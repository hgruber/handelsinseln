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

// Startkarte
function generate(S, nPlayers, rnd) {
  S.hexes = {}; S.harbors = {}; S.numBag = []; S.landBag = [];
  const mainCount = 10 + 3 * nPlayers;
  const origin = '0,0';
  const main = growBlob(mainCount, rnd, () => false, () => origin);
  const land = new Set(main);
  const islands = [main];
  const nSmall = nPlayers > 4 ? 4 : 3;
  for (let i = 0; i < nSmall; i++) {
    const size = 1 + Math.floor(rnd() * 3);
    for (let tries = 0; tries < 200; tries++) {
      const R = 6 + Math.floor(rnd() * 3);
      const q = Math.floor(rnd() * (2 * R + 1)) - R, r = Math.floor(rnd() * (2 * R + 1)) - R;
      const start = G.hk(q, r);
      if (dist(start, origin) > R + 1) continue;
      const near = (k) => { for (const l of land) if (dist(k, l) < 2) return true; return false; };
      if (near(start)) continue;
      const blob = growBlob(size, rnd, near, () => start);
      if ([...blob].some(near)) continue;
      blob.forEach((k) => land.add(k)); islands.push(blob); break;
    }
  }
  // Meer: alles bis Abstand 2 um Land ist aufgedeckt
  const sea = new Set();
  for (const l of land) for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) {
    const { q, r } = G.parseH(l); const k = G.hk(q + dq, r + dr);
    if (!land.has(k) && dist(k, l) <= 2) sea.add(k);
  }
  // Gelände + Zahlen
  const types = {};
  const mainArr = shuffle([...main], rnd);
  mainArr.forEach((k, i) => {
    if (i === 0) types[k] = 'wueste';
    else if (i === 1 && mainCount >= 22) types[k] = 'gold';
    else types[k] = drawTerrain(S, rnd);
  });
  islands.slice(1).forEach((isl) => isl.forEach((k) => { types[k] = rnd() < 0.4 ? 'gold' : drawTerrain(S, rnd); }));
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
  S.home = [...main];
  // Piraten auf ein Meerfeld in der Nähe der Hauptinsel
  const seaNear = [...sea].filter((k) => G.neighbors(k).some((n) => main.has(n)) === false && [...main].some((m) => dist(k, m) === 2));
  S.pirate = shuffle(seaNear.length ? seaNear : [...sea], rnd)[0];
  // Häfen
  const hcount = Math.round(mainCount / 3.2);
  const kinds = [];
  while (kinds.length < hcount + 4) kinds.push(...shuffle([...RES, 'any', 'any', 'any', 'any'], rnd));
  const edges = [];
  for (const k of main) for (const e of G.hexEdges(k)) {
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

// Neues Feld entdecken (Server wählt Zufallsfeld). Gibt das Hex-Objekt zurück.
function discover(S, k, rnd) {
  const ns = G.neighbors(k).map((n) => S.hexes[n]).filter(Boolean);
  const ln = ns.filter((h) => isLand(h.t)).length;
  const pLand = Math.min(0.62, 0.16 + 0.17 * ln);
  let h;
  if (rnd() < pLand) {
    const r = rnd();
    if (r < 0.1) h = { t: 'gold', n: drawNumber(S, rnd) };
    else if (r < 0.14) h = { t: 'wueste', n: null };
    else h = { t: drawTerrain(S, rnd), n: drawNumber(S, rnd) };
  } else h = { t: 'meer', n: null };
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
