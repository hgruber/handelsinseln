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

function growBlob(count, rnd, avoid, startFn, shape) {
  const blob = new Set([startFn()]);
  while (blob.size < count) {
    const cand = [...ringNeighbors(blob)].filter((k) => !avoid(k));
    if (!cand.length) break;
    // bevorzugt kompakte Formen (viele Nachbarn im Blob), mit Zufall
    const scored = cand.map((k) => ({ k, s: G.neighbors(k).filter((n) => blob.has(n)).length + rnd() * 1.6 - (shape ? shape(k) : 0) }));
    scored.sort((a, b) => b.s - a.s);
    blob.add(scored[0].k);
  }
  return blob;
}

function drawNumber(S, rnd) {
  if (!S.numBag.length) S.numBag = shuffle(NUM_BAG, rnd);
  return S.numBag.pop();
}
// Goldfluss-Felder tragen nur schwache Zahlen (Fairness: Gold ist ein Joker-Rohstoff)
// Ertragsrate 1–5 = höchste erlaubte Zahl-Klasse (samt den schwächeren): 1: 2/12, 2: 3/11, 3: 4/10, 4: 5/9, 5: 6/8
const goldNums = (rate) => { const t = (rate || 3) + 1; return [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].filter((n) => Math.min(n, 14 - n) <= t); };
function drawGoldNumber(S, rnd, nums) {
  if (!S.numBag.length) S.numBag = shuffle(NUM_BAG, rnd);
  let i = S.numBag.findIndex((n) => nums.includes(n));
  if (i < 0) { S.numBag = [...S.numBag, ...shuffle(NUM_BAG, rnd)]; i = S.numBag.findIndex((n) => nums.includes(n)); }
  return S.numBag.splice(i, 1)[0];
}
function drawTerrain(S, rnd) {
  if (!S.landBag.length) S.landBag = shuffle(LAND_BAG, rnd);
  return S.landBag.pop();
}

// Startkarte je Variante
function placeIslands(S, n, rnd, variant, dense, asp) {
  const origin = '0,0';
  // Seitenverhältnis des Bildschirms (Breite/Höhe): außerhalb von etwa 1:1 bis 1,3:1 wird die Karte in x gestreckt und in y gestaucht
  // (gleiche Fläche), damit sie das Format füllt. Ohne Angabe bleibt die runde Standardkarte.
  const wide = !!asp && (asp < 1.0 || asp > 1.3);
  const sx = wide ? Math.sqrt(asp) : 1, sy = wide ? 1 / Math.sqrt(asp) : 1, SQ3 = Math.sqrt(3);
  const toXY = (k) => { const { q, r } = G.parseH(k); return { x: SQ3 * (q + r / 2), y: 1.5 * r }; };
  const fromXY = (x, y) => { const r = Math.round(y / 1.5); return G.hk(Math.round(x / SQ3 - r / 2), r); };
  const stretch = (k) => { if (!wide) return k; const p = toXY(k); return fromXY(p.x * sx, p.y * sy); };
  const rad = (k) => { if (!wide) return dist(k, origin); const p = toXY(k); return Math.hypot(p.x / sx, p.y / sy) / 1.5; };
  const shape = wide ? (k) => rad(k) * 0.3 : null;
  const land = new Set(), islands = [];
  const near = (k) => { for (const l of land) if (dist(k, l) < 2) return true; return false; };
  const add = (blob) => { blob.forEach((k) => land.add(k)); islands.push(blob); return blob; };
  if (variant === 'inseln') {
    const size = n <= 3 ? 7 : n === 4 ? 6 : 5;
    const R = dense ? Math.max(3, Math.ceil(4 / (2 * Math.sin(Math.PI / n)))) : Math.ceil(5 / (2 * Math.sin(Math.PI / n))) + 1;
    const ring = [], RR = wide ? Math.ceil(R * Math.max(sx, sy) * 1.3) + 2 : R;
    for (let q = -RR; q <= RR; q++) for (let r = -RR; r <= RR; r++) if (wide || dist(G.hk(q, r), origin) === R) ring.push(G.hk(q, r));
    const rot = rnd() * Math.PI * 2;
    const home = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i * 2 * Math.PI) / n;
      const tx = wide ? Math.cos(a) * R * 1.5 * sx : Math.cos(a) * R * Math.sqrt(3), ty = wide ? Math.sin(a) * R * 1.5 * sy : Math.sin(a) * R * 1.5;
      const start = ring.slice().sort((x, y) => { const px = G.hexCenter(x), py = G.hexCenter(y); return Math.hypot(px.x - tx, px.y - ty) - Math.hypot(py.x - tx, py.y - ty); })[0];
      home.push(add(growBlob(size, rnd, near, () => start)));
    }
    const center = add(growBlob(3, rnd, near, () => origin));
    // eine weitere kleine Insel weiter draußen
    for (let t = 0; t < 200; t++) {
      const M = wide ? RR + 4 : R + 4, q = Math.floor(rnd() * (2 * M + 1)) - M, r = Math.floor(rnd() * (2 * M + 1)) - M, st = G.hk(q, r);
      if (near(st) || rad(st) < R + 3 || (wide && rad(st) > R + 6)) continue;
      add(growBlob(1 + Math.floor(rnd() * 2), rnd, near, () => st)); break;
    }
    return { land, islands, home: new Set(home.flatMap((b) => [...b])), desertIn: center, exploredR: 2, neutral: islands.filter((b) => !home.includes(b)) };
  }
  if (variant === 'archipel') {
    // Viele kleine Inseln, gleichmäßig in einer Scheibe verstreut; jeder darf auf jeder Insel starten
    const K = 5 + 2 * n;
    const R = Math.ceil((dense ? 1.5 : 2) * Math.sqrt(K)) + 2;
    for (let i = 0; i < K; i++) {
      const w = rnd();
      const size = w < 0.3 ? 2 : w < 0.65 ? 3 : w < 0.9 ? 4 : 5;
      const M = wide ? Math.ceil(R * Math.max(sx, sy) * 1.4) + 1 : R;
      for (let t = 0; t < 400; t++) {
        const q = Math.floor(rnd() * (2 * M + 1)) - M, r = Math.floor(rnd() * (2 * M + 1)) - M, st = G.hk(q, r);
        if (rad(st) > R || near(st)) continue;
        const blob = growBlob(size, rnd, (k) => near(k) || rad(k) > R + 1, () => st);
        if (blob.size < 2 || [...blob].some(near)) continue;
        add(blob); break;
      }
    }
    const all = new Set(land);
    return { land, islands, home: all, desertIn: islands[Math.floor(rnd() * islands.length)], exploredR: 2, neutral: [] };
  }
  const mainCount = variant === 'nebel' ? 8 + 2 * n : 10 + 3 * n;
  const main = add(growBlob(mainCount, rnd, () => false, () => origin, shape));
  if (variant === 'klassisch') {
    const nSmall = n > 4 ? 4 : 3;
    for (let i = 0; i < nSmall; i++) {
      const size = 1 + Math.floor(rnd() * 3);
      for (let tries = 0; tries < 200; tries++) {
        const R = 6 + Math.floor(rnd() * 3);
        const q = Math.floor(rnd() * (2 * R + 1)) - R, r = Math.floor(rnd() * (2 * R + 1)) - R;
        const raw = G.hk(q, r);
        if (dist(raw, origin) > R + 1) continue;
        const start = stretch(raw);
        if (near(start)) continue;
        const blob = growBlob(size, rnd, near, () => start);
        if ([...blob].some(near)) continue;
        add(blob); break;
      }
    }
  }
  return { land, islands, home: new Set(main), desertIn: main, exploredR: variant === 'nebel' ? 1 : 2, neutral: islands.slice(1), mainCount };
}

function generateOnce(S, nPlayers, rnd, settings) {
  const variant = (settings && settings.variant) || 'klassisch';
  S.hexes = {}; S.harbors = {}; S.numBag = []; S.landBag = []; S.robber = null;
  const L = placeIslands(S, nPlayers, rnd, variant, !!(settings && settings.dense), settings && settings.aspect);
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
  const goldHome = !settings || settings.goldHome !== false;
  let goldLeft = goldHome && variant === 'klassisch' && L.mainCount >= 22 ? 1 : 0;
  islands.forEach((isl) => {
    const isHome = [...isl].every((k) => home.has(k));
    for (const k of shuffle([...isl], rnd)) {
      if (k === desert) types[k] = 'wueste';
      else if (isHome && goldLeft > 0 && homeCount > 0) { types[k] = 'gold'; goldLeft--; }
      else if (!goldHome && home.has(k)) types[k] = drawTerrain(S, rnd); // Startinsel ohne Goldfluss
      else if (variant === 'archipel' && rnd() < 0.10) types[k] = 'gold';
      else if (!isHome) types[k] = rnd() < 0.15 ? 'gold' : drawTerrain(S, rnd);
      else types[k] = drawTerrain(S, rnd);
    }
  });
  const landKeys = [...land];
  let best = null;
  for (let t = 0; t < 300; t++) {
    const nums = {}; S.numBag = [];
    const order = shuffle(landKeys, rnd).sort((a, c) => (types[c] === 'gold') - (types[a] === 'gold')); // Gold zuerst: bekommt sicher eine schwache Zahl
    for (const k of order) if (types[k] !== 'wueste') nums[k] = types[k] === 'gold' ? drawGoldNumber(S, rnd, goldNums(settings && settings.goldRate)) : drawNumber(S, rnd);
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

// ---- Ausgleich der Startecken ------------------------------------------------------------
const pipsOf = (n) => (n ? 6 - Math.abs(7 - n) : 0);

// Anfangssiedlungen dürfen nicht an ein Goldfluss-Feld grenzen
const touchesGold = (S, v) => G.vertHexes(v).some((h) => S.hexes[h] && S.hexes[h].t === 'gold');

// Wert einer Ecke: Wahrscheinlichkeitspunkte der angrenzenden Landfelder und die Rohstoffe (Gold = Joker).
function cornerInfo(S, v) {
  let pips = 0; const res = new Set();
  for (const h of G.vertHexes(v)) {
    const x = S.hexes[h];
    if (!x || !isLand(x.t)) continue;
    pips += pipsOf(x.n);
    if (x.t === 'gold') res.add('gold'); else if (TERRAIN_RES[x.t]) res.add(TERRAIN_RES[x.t]);
  }
  return { pips, res };
}

// Simuliert den Aufbau (Schlangenreihenfolge 1..n, n..1, jeder nimmt gierig die beste freie Ecke mit Blick auf neue Rohstoffe)
// und liefert eine Unausgewogenheit: je kleiner, desto fairer. Spielerzahl n, Heimatfelder S.home.
function startImbalance(S, n, variant, islands, goldStart) {
  const verts = new Map();
  for (const h of S.home) for (const v of G.hexCorners(h)) if (!verts.has(v) && (goldStart || !touchesGold(S, v))) { const c = cornerInfo(S, v); if (c.pips > 0) verts.set(v, c); }
  const taken = new Set(), blocked = new Set();
  const have = Array.from({ length: n }, () => new Set()), total = new Array(n).fill(0);
  const order = [...Array(n).keys(), ...[...Array(n).keys()].reverse()];
  for (const p of order) {
    let bestV = null, bestS = -1;
    for (const [v, c] of verts) {
      if (taken.has(v) || blocked.has(v)) continue;
      const sc = c.pips + 1.2 * [...c.res].filter((r) => !have[p].has(r)).length;
      if (sc > bestS) { bestS = sc; bestV = v; }
    }
    if (!bestV) return 1e9; // Platz reicht nicht für alle
    const c = verts.get(bestV);
    taken.add(bestV); G.vertNeighbors(bestV).forEach((x) => blocked.add(x));
    total[p] += c.pips; c.res.forEach((r) => have[p].add(r));
  }
  const score = total.map((t, p) => t + 2 * have[p].size);
  let cost = Math.max(...score) - Math.min(...score);
  cost += 4 * have.filter((h) => h.size < 3).length;          // wenig Rohstoffvielfalt
  cost += 0.5 * Math.max(0, 12 - Math.min(...total));          // sehr schwache Startpunkte
  if (variant === 'inseln') { // jede Heimatinsel soll ähnlich viel hergeben
    const val = islands.map((isl) => [...isl].reduce((a, k) => a + pipsOf(S.hexes[k] && S.hexes[k].n), 0));
    if (val.length) cost += 0.5 * (Math.max(...val) - Math.min(...val));
  }
  return cost;
}

// Würfelt mehrere Karten und nimmt die mit den ausgewogensten Startecken.
const TRIES = 40;
const BOARD_FIELDS = ['hexes', 'harbors', 'numBag', 'landBag', 'robber', 'home', 'pirate', 'harborKinds'];
function generate(S, nPlayers, rnd, settings) {
  const variant = (settings && settings.variant) || 'klassisch';
  let best = null, bestCost = Infinity;
  for (let t = 0; t < TRIES; t++) {
    generateOnce(S, nPlayers, rnd, settings);
    const hs = new Set(S.home);
    const islands = Object.keys(S.hexes).length ? homeIslands(S, hs) : [];
    const cost = startImbalance(S, nPlayers, variant, islands, !!(settings && settings.goldStart));
    if (cost < bestCost) { bestCost = cost; best = {}; for (const f of BOARD_FIELDS) best[f] = JSON.parse(JSON.stringify(S[f] === undefined ? null : S[f])); }
    if (cost <= (variant === 'inseln' ? 3.5 : 2)) break; // gut genug
  }
  for (const f of BOARD_FIELDS) S[f] = best[f];
}
// Zusammenhängende Heimatinseln (nur für die Inselbewertung)
function homeIslands(S, hs) {
  const seen = new Set(), out = [];
  for (const k of hs) {
    if (seen.has(k)) continue;
    const isl = island(S, k); isl.forEach((x) => seen.add(x));
    if ([...isl].every((x) => hs.has(x))) out.push(isl);
  }
  return out;
}

// Hafen auf Kante legen, wenn Land/Meer-Kante und Ecken noch frei von anderen Häfen
function tryHarbor(S, e, kind) {
  const [a, b] = G.edgeHexes(e);
  const A = S.hexes[a], B = S.hexes[b];
  if (!A || !B || isLand(A.t) === isLand(B.t)) return false;
  if (S.harbors[e]) return false;
  const vs = G.edgeVerts(e);
  for (const he in S.harbors) if (G.edgeVerts(he).some((v) => vs.includes(v))) return false;
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
function drawChip(S, rnd, only) {
  const ok = Object.keys(CHIP_W).filter((n) => avail(S.supply.chips, n) && (!only || only.includes(+n)));
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
  const landTypes = Object.keys(LAND_W).filter((t) => avail(sup.terrain, t) && (t === 'wueste' || chipsLeft) && (t !== 'gold' || goldNums(S.goldRate).some((n) => avail(sup.chips, n))));
  const seaOk = avail(sup.terrain, 'meer');
  let wantLand = rnd() < pLand;
  if (wantLand && !landTypes.length) wantLand = false;
  if (!wantLand && !seaOk && landTypes.length) wantLand = true; // Meer-Vorrat erschöpft
  let h;
  if (wantLand) {
    const boost = S.fogGold || 1;
    const t = weighted(landTypes, (x) => LAND_W[x] * (x === 'gold' ? boost : 1), rnd);
    take(sup.terrain, t);
    h = { t, n: t === 'wueste' ? null : drawChip(S, rnd, t === 'gold' ? goldNums(S.goldRate) : null) };
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

// Unentdeckter Rand. Wird für jede Sicht gebraucht, ändert sich aber nur, wenn Felder dazukommen (Entdeckung) oder das
// Brett neu entsteht (neues S.hexes-Objekt): darum je hexes-Objekt und Feldzahl zwischengespeichert (außerhalb von S).
const FOG = new WeakMap();
function fog(S) {
  const n = Object.keys(S.hexes).length, c = FOG.get(S.hexes);
  if (c && c.n === n) return c.out;
  const set = new Set();
  for (const k in S.hexes) for (const nb of G.neighbors(k)) if (!S.hexes[nb]) set.add(nb);
  const out = Object.freeze([...set]);
  FOG.set(S.hexes, { n, out });
  return out;
}

module.exports = { goldNums, touchesGold, RES, TERRAIN_RES, shuffle, isLand, dist, island, generate, generateOnce, startImbalance, homeIslands, discover, fog, drawNumber, tryHarbor };
