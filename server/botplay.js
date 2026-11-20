'use strict';
// Bot-Spieler mit Strategie: drei Persönlichkeiten (Baumeister, Händler, Ritter) auf einer gemeinsamen Bewertungslogik.
// botPlay(game, pid) führt höchstens EINE Aktion aus und gibt true zurück, wenn etwas geschah (wie botAct in bot.js).
// Bots nutzen nur öffentliche Informationen (Sicht view(pid), Brett, Gebäude, Kartenzahlen der Gegner), nie fremde Handkarten.
const G = require('../shared/geom');
const B = require('./board');

const RES = B.RES;
const COST = {
  road: { lehm: 1, holz: 1 }, ship: { wolle: 1, holz: 1 },
  settlement: { lehm: 1, holz: 1, wolle: 1, getreide: 1 },
  city: { getreide: 2, erz: 3 }, dev: { erz: 1, wolle: 1, getreide: 1 },
};
const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// Gewichte je Persönlichkeit
const PERSONA = {
  baumeister: {
    resW: { holz: 1.1, lehm: 1.1, wolle: 0.95, getreide: 1.05, erz: 1 }, varW: 1.4, portW: 0.5, expW: 0.7,
    goals: ['settlement', 'city', 'road', 'dev'], edgeMin: 2.0, roadLust: true, offers: 1, knight: 'bedarf', trust: 0,
  },
  haendler: {
    resW: { holz: 1, lehm: 1, wolle: 1, getreide: 1, erz: 1 }, varW: 2.2, portW: 2.4, expW: 0.3,
    goals: ['city', 'settlement', 'dev', 'road'], edgeMin: 2.6, roadLust: false, offers: 3, knight: 'bedarf', trust: 1,
  },
  ritter: {
    resW: { holz: 0.9, lehm: 0.9, wolle: 1.15, getreide: 1.2, erz: 1.2 }, varW: 1, portW: 0.6, expW: 0.3,
    goals: ['settlement', 'city', 'dev', 'road'], edgeMin: 2.6, roadLust: false, offers: 1, knight: 'immer', trust: 0,
  },
};

function botPlay(game, pid, opts = {}) {
  const S = game.S, pl = S.players[pid];
  const kind = pl && (pl.bot || opts.as); // opts.as: auch einen Menschenplatz mit einer Persönlichkeit steuern (Turniere in Tests)
  if (!pl || !kind || pl.left) return false;
  if (S.phase !== 'setup' && S.phase !== 'main') return false;
  const P = PERSONA[kind] || PERSONA.baumeister;
  const rnd = opts.rnd || game.rnd;
  const v = game.view(pid), L = v.legal, hand = v.me.hand;
  const act = (a) => { game.act(pid, a); return true; };
  if (!pl.bm || pl.bm.turn !== S.turnNo) pl.bm = { turn: S.turnNo, bank: 0, offers: 0, offerAt: 0 };
  const bm = pl.bm;
  const win = v.winPoints;

  // ---------- Bewertung ----------
  const mineV = Object.keys(v.verts).filter((k) => v.verts[k].p === pid);
  const prod = Object.fromEntries(RES.map((r) => [r, 0]));
  for (const k of mineV) for (const h of G.vertHexes(k)) {
    const x = S.hexes[h]; if (x && B.TERRAIN_RES[x.t]) prod[B.TERRAIN_RES[x.t]] += pips(x.n) * (v.verts[k].k === 'c' ? 2 : 1);
  }
  const hasRes = new Set(RES.filter((r) => prod[r] > 0));
  const myGold = mineV.some((k) => G.vertHexes(k).some((h) => S.hexes[h] && S.hexes[h].t === 'gold'));
  const harborAt = {}; // Ecke -> Hafenart
  for (const e in S.harbors) for (const x of G.edgeVerts(e)) harborAt[x] = S.harbors[e].kind;
  const freeSpot = (x) => !S.verts[x] && game.distanceOk(x) && game.vertTouchesLand(x);

  function vscore(x) {
    let val = 0; const res = new Set(); const mypips = { ...prod };
    for (const h of G.vertHexes(x)) {
      const hx = S.hexes[h]; if (!hx) continue;
      const r = B.TERRAIN_RES[hx.t];
      if (r) { const sc = pips(hx.n) * P.resW[r] * (prod[r] < 3 ? 1.25 : 1); val += sc; res.add(r); mypips[r] += pips(hx.n); }
      else if (hx.t === 'gold') { val += pips(hx.n) * 1.1; res.add('gold'); }
    }
    const fresh = [...res].filter((r) => (r === 'gold' ? !myGold : !hasRes.has(r))).length;
    val += P.varW * fresh;
    const hk = harborAt[x];
    if (hk) val += P.portW * (hk === 'any' ? 1.5 : 0.3 * (mypips[hk] || 0));
    val += P.expW * G.vertNeighbors(x).filter((n) => !S.verts[n] && game.vertTouchesLand(n)).length;
    return val;
  }
  const bestOf = (arr, fn) => { let b = null, bs = -Infinity; for (const x of arr) { const s = fn(x); if (s > bs) { bs = s; b = x; } } return b; };
  const farEnds = (e, from) => G.edgeVerts(e).filter((x) => x !== from);
  // Wert einer Kante: wohin führt sie (freie Siedlungsecke am Ende bzw. dahinter)?
  function edgeValue(e) {
    let best = 0;
    for (const x of G.edgeVerts(e)) {
      if (S.verts[x]) continue;
      let s = freeSpot(x) ? vscore(x) * 0.5 : 0;
      for (const n of G.vertNeighbors(x)) if (freeSpot(n) && !S.verts[x]) s = Math.max(s, vscore(n) * 0.3);
      best = Math.max(best, s);
    }
    return best;
  }
  const isShip = (e) => L.ship.includes(e);

  // ---------- Pflichten ----------
  const goalInfo = () => {
    const left = game.left(pid), spots = L.settlement.length > 0 && left.settlement > 0;
    for (const g of P.goals) {
      if (g === 'settlement' && spots) return { kind: 'settlement', need: COST.settlement };
      if (g === 'city' && L.city.length && left.city > 0) return { kind: 'city', need: COST.city };
      if (g === 'dev' && v.bank.dev > 0) return { kind: 'dev', need: COST.dev };
      if (g === 'road' && !spots && left.road > 0 && L.road.length) return { kind: 'road', need: COST.road };
    }
    return null;
  };
  const keepNeed = () => { const g = goalInfo(); return g ? g.need : {}; };

  if (v.pending.discard[pid]) {
    const n = v.pending.discard[pid], h = { ...hand }, keep = keepNeed(), out = {};
    for (let i = 0; i < n; i++) {
      const r = bestOf(RES.filter((x) => h[x] > 0), (x) => h[x] - (keep[x] || 0) + (hasRes.has(x) ? 0 : -0.5));
      h[r]--; out[r] = (out[r] || 0) + 1;
    }
    return act({ type: 'discard', cards: out });
  }
  if (v.pending.gold[pid]) {
    const n = v.pending.gold[pid], h = { ...hand }, keep = keepNeed(), out = {};
    for (let i = 0; i < n; i++) {
      const r = bestOf(RES, (x) => (keep[x] || 0) - h[x] + P.resW[x] * 0.1 - (v.bank.stock[x] > 0 ? 0 : 99));
      h[r]++; out[r] = (out[r] || 0) + 1;
    }
    return act({ type: 'gold_pick', cards: out });
  }
  if (v.step === 'discard' || v.step === 'gold') return false;

  // ---------- Handelsangebote anderer beantworten ----------
  if (v.trade && v.trade.from !== pid && !v.trade.responses[pid] && !v.sbp) {
    const t = v.trade, keep = keepNeed();
    const canPay = RES.every((r) => (t.want[r] || 0) <= hand[r]);
    const proposer = v.players[t.from];
    let ok = canPay && total(t.give) >= total(t.want) && (proposer.vp < win - 1 || (P.trust && proposer.vp < win));
    if (ok) {
      // bringt mir etwas Fehlendes und nimmt nichts, das ich für mein Ziel brauche?
      const gainsNeed = RES.some((r) => (t.give[r] || 0) > 0 && (keep[r] || 0) > hand[r]);
      const hurts = RES.some((r) => (t.want[r] || 0) > 0 && hand[r] - t.want[r] < (keep[r] || 0));
      ok = !hurts && (gainsNeed || (P.trust && total(t.give) > total(t.want)));
    }
    return act({ type: 'trade_respond', accept: !!ok });
  }

  const active = S.sbp ? S.sbp.pid : S.turn;
  if (active !== pid) return false;

  // ---------- Aufbau ----------
  if (v.step === 'setup_settlement') return act({ type: 'place_settlement', v: bestOf(L.settlement, vscore) });
  if (v.step === 'setup_road') {
    const last = S.setup.last;
    const cand = [...L.road.map((e) => ['place_road', e]), ...L.ship.map((e) => ['place_ship', e])];
    const [type, e] = bestOf(cand, ([ty, ed]) => {
      let s = 0;
      for (const x of farEnds(ed, last)) { if (freeSpot(x)) s = Math.max(s, vscore(x)); for (const n of G.vertNeighbors(x)) if (freeSpot(n)) s = Math.max(s, vscore(n) * 0.6); }
      return s * (ty === 'place_ship' ? 0.75 : 1) + rnd() * 0.01;
    });
    return act({ type, e });
  }

  // ---------- Schutzmacht, Räuber, Opfer ----------
  const army = () => {
    const holder = v.largestHolder, mine = v.players[pid].knightsPlayed, hold = holder == null ? 0 : v.players[holder].knightsPlayed;
    return holder !== pid && mine + 1 >= game.S.settings.armyMin && mine + 1 > hold;
  };
  const robberOnMe = () => mineV.some((k) => G.vertHexes(k).includes(S.robber) && pips((S.hexes[S.robber] || {}).n) >= 4);
  const wantKnight = () => v.me.dev.some((d) => d.type === 'ritter' && d.playable) && (P.knight === 'immer' || robberOnMe() || army());

  if (v.step === 'roll') {
    if (wantKnight()) return act({ type: 'play_knight' });
    return act({ type: 'roll' });
  }
  if (v.step === 'robber') {
    const lead = (p) => v.players[p].vp + 1;
    const score = (h) => {
      let s = 0;
      for (const k of Object.keys(v.verts)) {
        if (!G.vertHexes(k).includes(h)) continue;
        const b = v.verts[k], x = pips((S.hexes[h] || {}).n) * (b.k === 'c' ? 2 : 1);
        s += b.p === pid ? -x * 2.5 : x * Math.pow(lead(b.p), 1.4) * (1 + v.players[b.p].resCount / 20);
      }
      return s;
    };
    const land = bestOf(L.robber, (h) => score(h) + rnd() * 0.01);
    // Pirat nur, wenn er fremde Schiffe deutlich härter trifft
    let sea = null, seaScore = 0;
    if (L.pirate.length) {
      for (const h of L.pirate) {
        let s = 0; for (const e of G.hexEdges(h)) { const b = v.edges[e]; if (b && b.k === 's') s += b.p === pid ? -3 : 2 * lead(b.p); }
        if (s > seaScore) { seaScore = s; sea = h; }
      }
    }
    if (sea && seaScore > Math.max(0, score(land)) + 3) return act({ type: 'move_pirate', hex: sea });
    return act({ type: 'move_robber', hex: land });
  }
  if (v.step === 'steal') return act({ type: 'steal', target: bestOf(L.steal, (p) => v.players[p].resCount * (v.players[p].vp + 1)) });
  if (v.step === 'road_building') {
    const cand = [...L.road.map((e) => ['build_road', e]), ...L.ship.map((e) => ['build_ship', e])];
    if (!cand.length) return act({ type: 'skip_roadbuilding' });
    const [type, e] = bestOf(cand, ([ty, ed]) => edgeValue(ed) * (ty === 'build_ship' ? 0.8 : 1));
    return act({ type, e });
  }

  // ---------- Hauptphase ----------
  const sbp = v.step === 'sbp';
  if (v.step !== 'main' && !sbp) return false;
  const af = v.afford, left = game.left(pid);
  const goal = goalInfo();
  const deficit = goal ? RES.filter((r) => (goal.need[r] || 0) > hand[r]) : [];

  // Entwicklungskarten ausspielen (nicht in der Sonderbauphase)
  if (!sbp) {
    const dv = (t) => v.me.dev.some((d) => d.type === t && d.playable);
    if (wantKnight()) return act({ type: 'play_knight' });
    if (dv('monopol') && deficit.length) {
      const r = bestOf(deficit, (x) => (goal.need[x] - hand[x]) * 3 + P.resW[x]);
      const others = v.players.reduce((a, p) => a + (p.id === pid ? 0 : p.resCount), 0);
      if (others >= 7) return act({ type: 'play_monopoly', res: r });
    }
    if (dv('erfindung') && deficit.length) {
      const ok = RES.filter((r) => v.bank.stock[r] >= 1);
      const picks = [];
      for (const r of deficit) for (let i = 0; i < goal.need[r] - hand[r] && picks.length < 2; i++) if (ok.includes(r)) picks.push(r);
      while (picks.length < 2 && ok.length) picks.push(bestOf(ok, (x) => P.resW[x]));
      if (picks.length === 2 && (picks[0] !== picks[1] || v.bank.stock[picks[0]] >= 2)) return act({ type: 'play_yop', a: picks[0], b: picks[1] });
    }
    if (dv('strassenbau') && left.road + left.ship > 0) {
      const cand = [...L.road, ...L.ship].filter((e) => edgeValue(e) >= P.edgeMin);
      if (cand.length) return act({ type: 'play_roadbuilding' });
    }
  }

  // Bauen: Nutzen je Möglichkeit
  const opts2 = [];
  if (af.city && L.city.length) opts2.push({ t: 'build_city', arg: { v: bestOf(L.city, (x) => { let p = 0; for (const h of G.vertHexes(x)) p += pips((S.hexes[h] || {}).n) * (B.TERRAIN_RES[(S.hexes[h] || {}).t] ? P.resW[B.TERRAIN_RES[S.hexes[h].t]] : 0.5); return p; }) }, u: 10 });
  if (af.settlement && L.settlement.length) { const x = bestOf(L.settlement, vscore); opts2.push({ t: 'build_settlement', arg: { v: x }, u: 9 + vscore(x) * 0.05 }); }
  // Eine Karte kaufen nur, wenn das Bauziel (Stadt/Siedlung) dadurch nicht schlechter erreichbar wird
  const late = v.players[pid].vp >= win - 3; // kurz vor dem Ziel zählt jeder Punkt: Karten kaufen, Wege für den Längsten Handelsweg bauen
  const spoils = (cost) => !late && goal && goal.kind !== 'dev' && goal.kind !== 'road' && RES.filter((r) => (goal.need[r] || 0) > hand[r] - (cost[r] || 0)).length > deficit.length;
  if (af.dev && (!spoils(COST.dev) || total(hand) >= 8)) opts2.push({ t: 'buy_dev', arg: {}, u: kind === 'ritter' ? 6.5 : 3.5 });
  const edges = [...L.road.map((e) => ['build_road', e, 'road']), ...L.ship.map((e) => ['build_ship', e, 'ship'])]
    .filter(([, , k]) => af[k]).map(([t, e, k]) => ({ t, e, k, val: edgeValue(e) * (k === 'ship' ? 0.8 : 1) }));
  const spots = L.settlement.length > 0 && left.settlement > 0;
  const crowded = total(hand) >= 8;
  const bestEdge = bestOf(edges, (x) => x.val);
  // Baumeister: Längster Handelsweg in Reichweite? Dann lohnt jeder Weg
  const mineLen = v.players[pid].longestRoute, holderLen = v.longestHolder == null ? 0 : v.players[v.longestHolder].longestRoute;
  const chase = (P.roadLust || late) && v.longestHolder !== pid && mineLen + 2 >= S.settings.longestMin && holderLen - mineLen <= 2;
  if (bestEdge && (chase || bestEdge.val >= P.edgeMin || (!spots && bestEdge.val > 0.2 && goal && goal.kind === 'road') || crowded)) {
    opts2.push({ t: bestEdge.t, arg: { e: bestEdge.e }, u: 2 + bestEdge.val * 0.3 + (chase ? 4 : 0) });
  }
  if (opts2.length) {
    const best = bestOf(opts2, (o) => o.u);
    // sparen: ein Weg soll nicht die Rohstoffe für ein höher bewertetes Ziel wegnehmen
    const cheap = best.t === 'build_road' || best.t === 'build_ship';
    const cost = cheap ? COST[best.t === 'build_road' ? 'road' : 'ship'] : {};
    const worse = goal && goal.kind !== 'road' && RES.filter((r) => (goal.need[r] || 0) > hand[r] - (cost[r] || 0)).length > deficit.length;
    const blocks = cheap && !crowded && worse && !chase;
    if (!blocks) return act({ type: best.t, ...best.arg });
  }

  // Tauschen: Bank (Kurse inkl. Hafen), danach Mitspieler
  const rates = v.rates;
  const bankOk = (r) => v.bank.stock[r] > 0;
  if (goal && deficit.length && bm.bank < 8) {
    const give = bestOf(RES.filter((r) => !deficit.includes(r) && hand[r] - (goal.need[r] || 0) >= rates[r]), (r) => (hand[r] - (goal.need[r] || 0)) / rates[r]);
    const get = bestOf(deficit.filter(bankOk), (r) => goal.need[r] - hand[r]);
    if (give && get) { bm.bank++; return act({ type: 'bank_trade', give, get }); }
  }
  if (crowded && bm.bank < 8) { // zu viele Karten: größten Haufen gegen das Schwächste tauschen
    const give = bestOf(RES.filter((r) => hand[r] >= rates[r]), (r) => hand[r] / rates[r]);
    const get = bestOf(RES.filter((r) => bankOk(r) && r !== give), (r) => -hand[r] + (hasRes.has(r) ? 0 : 1));
    if (give && get && hand[give] - rates[give] >= (goal && goal.need[give] ? goal.need[give] : 0)) { bm.bank++; return act({ type: 'bank_trade', give, get }); }
  }

  // eigenes Angebot auswerten / zurückziehen
  if (v.trade && v.trade.from === pid) {
    const rs = v.trade.responses, others = v.players.filter((p) => p.id !== pid && !p.gone);
    const acc = Object.keys(rs).find((k) => rs[k].s === 'accept');
    if (acc !== undefined) { try { return act({ type: 'trade_confirm', with: +acc }); } catch (e) { return act({ type: 'trade_cancel' }); } }
    const waiting = others.some((p) => !rs[p.id] && S.players[p.id] && !S.players[p.id].bot && S.players[p.id].connected && !S.players[p.id].auto);
    const everyone = others.every((p) => rs[p.id]);
    if (everyone || !waiting || (opts.now || Date.now)() - bm.offerAt > 25000) return act({ type: 'trade_cancel' });
    return false;
  }
  if (!sbp && v.settings.playerTrade && !v.trade && goal && deficit.length && bm.offers < P.offers && total(hand) >= 2) {
    const want = bestOf(deficit, (r) => goal.need[r] - hand[r]);
    const give = bestOf(RES.filter((r) => hand[r] - (goal.need[r] || 0) >= 1 && r !== want), (r) => hand[r] - (goal.need[r] || 0));
    if (give && want) {
      bm.offers++; bm.offerAt = (opts.now || Date.now)();
      return act({ type: 'trade_offer', give: { [give]: 1 }, want: { [want]: 1 } });
    }
  }

  return act({ type: sbp ? 'sbp_done' : 'end_turn' });
}

module.exports = { botPlay, PERSONA };
