'use strict';
// Spiellogik "Die Handelsinseln". Zustand ist reines JSON (speicherbar).
const crypto = require('crypto');
const G = require('../shared/geom');
const B = require('./board');

const RES = B.RES;
const COLORS = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];
const RES_DE = { holz: 'Holz', lehm: 'Lehm', wolle: 'Wolle', getreide: 'Getreide', erz: 'Erz' };
const TERR_DE = { wald: 'Wald', huegel: 'Hügel', weide: 'Weide', acker: 'Acker', gebirge: 'Gebirge', wueste: 'Wüste', gold: 'Goldfeld', meer: 'Meer' };
const DEV_DE = { ritter: 'Ritter', siegpunkt: 'Siegpunkt', strassenbau: 'Straßenbau', erfindung: 'Erfindung', monopol: 'Monopol' };
const COST = {
  road: { lehm: 1, holz: 1 }, ship: { wolle: 1, holz: 1 },
  settlement: { lehm: 1, holz: 1, wolle: 1, getreide: 1 },
  city: { getreide: 2, erz: 3 }, dev: { erz: 1, wolle: 1, getreide: 1 },
};
const LIMIT = { road: 15, ship: 15, settlement: 5, city: 4 };
const WIN = 14, MIN_P = 2, MAX_P = 6;
const MAX_ISLAND_BONUS = 2; // höchstens so viele "neue Inseln" bringen Sonderpunkte

class GameError extends Error {}
const fail = (m) => { throw new GameError(m); };
const emptyHand = () => ({ holz: 0, lehm: 0, wolle: 0, getreide: 0, erz: 0 });
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const fmt = (o) => Object.entries(o).filter(([, n]) => n > 0).map(([r, n]) => `${n}× ${RES_DE[r]}`).join(', ') || 'nichts';

function cleanCards(c, what) {
  const out = {};
  if (!c || typeof c !== 'object') fail('Ungültige Kartenangabe.');
  for (const r of RES) {
    const n = c[r] === undefined ? 0 : c[r];
    if (!Number.isInteger(n) || n < 0 || n > 99) fail('Ungültige Kartenanzahl.');
    if (n) out[r] = n;
  }
  return out;
}

class Game {
  constructor(opts = {}) {
    this.rnd = opts.rnd || Math.random;
    this.S = null;
    this.reset();
  }
  static fromJSON(json, opts) { const g = new Game(opts); g.S = json; return g; }
  toJSON() { return this.S; }

  reset(keepPlayers) {
    const old = keepPlayers && this.S ? this.S.players : [];
    this.S = {
      v: 0, phase: 'lobby', players: old.map((p) => ({ ...p, hand: emptyHand(), dev: [], claimed: {}, knights: 0, svp: 0, islandBonus: 0 })),
      host: 0, log: [], chat: [], logId: 0, seq: 0,
      hexes: {}, harbors: {}, verts: {}, edges: {}, robber: null, pirate: null,
      order: [], turn: 0, turnNo: 0, ts: {}, pend: { discard: {}, gold: {} }, trade: null,
      dice: null, diceSeq: 0, deck: [], setup: null, sbp: null, winner: null, longest: null, largest: null, tradeSeq: 0,
    };
    this.S.players.forEach((p, i) => { p.id = i; });
  }

  // ---------- Hilfen ----------
  get P() { return this.S.players; }
  log(text, kind = 'info', p = null) {
    const S = this.S;
    S.log.push({ id: ++S.logId, p, text, kind });
    if (S.log.length > 100) S.log.shift();
  }
  pl(pid) { return this.S.players[pid]; }
  name(pid) { return this.S.players[pid].name; }
  count(pid, kind) {
    let n = 0;
    for (const v in this.S.verts) if (this.S.verts[v].p === pid && this.S.verts[v].k === kind) n++;
    return n;
  }
  countE(pid, kind) {
    let n = 0;
    for (const e in this.S.edges) if (this.S.edges[e].p === pid && this.S.edges[e].k === kind) n++;
    return n;
  }
  left(pid) {
    return {
      road: LIMIT.road - this.countE(pid, 'r'), ship: LIMIT.ship - this.countE(pid, 's'),
      settlement: LIMIT.settlement - this.count(pid, 's') - this.count(pid, 'c'), city: LIMIT.city - this.count(pid, 'c'),
    };
  }
  canPay(pid, cost) { const h = this.pl(pid).hand; return Object.keys(cost).every((r) => h[r] >= cost[r]); }
  pay(pid, cost) { const h = this.pl(pid).hand; for (const r in cost) h[r] -= cost[r]; }
  give(pid, cost) { const h = this.pl(pid).hand; for (const r in cost) h[r] += cost[r]; }
  handSize(pid) { return sum(this.pl(pid).hand); }
  hexT(k) { return this.S.hexes[k] ? this.S.hexes[k].t : null; }
  isLandHex(k) { return B.isLand(this.hexT(k)); }
  isSeaHex(k) { return this.hexT(k) === 'meer'; }

  // ---------- Lobby ----------
  join(name, color, token) {
    const S = this.S;
    if (token) {
      const p = S.players.find((x) => x.token === token);
      if (p) return { token, pid: p.id };
    }
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 16) fail('Bitte einen Namen mit 1–16 Zeichen angeben.');
    if (!COLORS.includes(color)) fail('Bitte eine Farbe wählen.');
    if (S.phase !== 'lobby') fail('Das Spiel läuft bereits. Nur angemeldete Spieler können zurückkehren.');
    if (S.players.length >= MAX_P) fail('Das Spiel ist voll (maximal 6 Spieler).');
    if (S.players.some((p) => p.color === color)) fail('Diese Farbe ist schon vergeben.');
    if (S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('Dieser Name ist schon vergeben.');
    const t = crypto.randomBytes(16).toString('hex');
    const p = { id: S.players.length, name, color, token: t, connected: false, hand: emptyHand(), dev: [], claimed: {}, knights: 0, svp: 0, islandBonus: 0 };
    S.players.push(p);
    this.log(`${name} ist dem Spiel beigetreten.`, 'sys', p.id);
    S.v++;
    return { token: t, pid: p.id };
  }
  leave(token) {
    const S = this.S;
    const p = S.players.find((x) => x.token === token);
    if (!p) return;
    if (S.phase === 'lobby') {
      S.players.splice(p.id, 1);
      S.players.forEach((q, i) => { q.id = i; });
      if (S.host >= S.players.length) S.host = 0;
      else if (p.id === S.host) S.host = 0;
      this.log(`${p.name} hat die Lobby verlassen.`, 'sys');
      S.v++;
    }
  }
  setConnected(pid, c) { const p = this.pl(pid); if (p && p.connected !== c) { p.connected = c; this.S.v++; } }

  start(pid) {
    const S = this.S;
    if (S.phase !== 'lobby') fail('Das Spiel läuft bereits.');
    if (pid !== S.host) fail('Nur der Spielleiter kann das Spiel starten.');
    if (S.players.length < MIN_P) fail(`Es braucht mindestens ${MIN_P} Spieler.`);
    const n = S.players.length;
    B.generate(S, n, this.rnd);
    const bigGame = n >= 5;
    const mk = (t, c) => { for (let i = 0; i < c; i++) S.deck.push(t); };
    S.deck = [];
    if (bigGame) { mk('ritter', 20); mk('siegpunkt', 5); mk('strassenbau', 3); mk('erfindung', 3); mk('monopol', 3); }
    else { mk('ritter', 14); mk('siegpunkt', 5); mk('strassenbau', 2); mk('erfindung', 2); mk('monopol', 2); }
    S.deck = B.shuffle(S.deck, this.rnd);
    S.order = B.shuffle([...Array(n).keys()], this.rnd);
    S.phase = 'setup';
    const seq = [...S.order, ...S.order.slice().reverse()];
    S.setup = { seq, i: 0, stage: 'settlement', last: null };
    S.turn = seq[0];
    this.log(`Das Spiel beginnt! Reihenfolge: ${S.order.map((i) => this.name(i)).join(' → ')}. Erster zu 14 Punkten gewinnt.`, 'sys');
    this.log('Aufbau: Jeder setzt zwei Siedlungen samt Straße oder Schiff (die zweite in umgekehrter Reihenfolge) und erhält dafür Startrohstoffe.', 'sys');
    S.v++;
  }

  newGame(pid) {
    if (pid !== this.S.host) fail('Nur der Spielleiter kann ein neues Spiel beginnen.');
    if (this.S.phase !== 'ended') fail('Das Spiel ist noch nicht beendet.');
    this.reset(true);
    this.log('Neue Runde – wartet in der Lobby auf den Start.', 'sys');
    this.S.v++;
  }

  // ---------- Geometrie / Legalität ----------
  buildingAt(v) { return this.S.verts[v] || null; }
  vertTouchesLand(v) { return G.vertHexes(v).some((h) => this.isLandHex(h)); }
  distanceOk(v) { return !this.buildingAt(v) && G.vertNeighbors(v).every((n) => !this.buildingAt(n)); }
  edgeHexesKnown(e) { return G.edgeHexes(e).every((h) => this.S.hexes[h]); }
  edgeFor(e, kind) {
    // strukturelle Eignung: Straße braucht Land an der Kante, Schiff braucht Meer an der Kante
    if (!this.edgeHexesKnown(e)) return false;
    const hs = G.edgeHexes(e);
    if (kind === 'r') return hs.some((h) => this.isLandHex(h));
    return hs.some((h) => this.isSeaHex(h)) && !(this.S.pirate && hs.includes(this.S.pirate));
  }
  // Ist die Ecke v für Spieler pid von einem Wegstück der Art `kind` aus (oder über ein Gebäude) erreichbar?
  connectedAt(pid, v, kind) {
    const b = this.buildingAt(v);
    if (b) return b.p === pid;
    return G.vertEdges(v).some((e) => { const x = this.S.edges[e]; return x && x.p === pid && x.k === kind; });
  }
  settlementSpots(pid) {
    const S = this.S, out = new Set();
    if (S.phase === 'setup') {
      for (const h of S.home) for (const v of G.hexCorners(h)) if (this.distanceOk(v) && this.vertTouchesLand(v)) out.add(v);
      return [...out];
    }
    for (const e in S.edges) {
      if (S.edges[e].p !== pid) continue;
      for (const v of G.edgeVerts(e)) if (!out.has(v) && this.distanceOk(v) && this.vertTouchesLand(v)) out.add(v);
    }
    return [...out];
  }
  citySpots(pid) {
    return Object.keys(this.S.verts).filter((v) => this.S.verts[v].p === pid && this.S.verts[v].k === 's');
  }
  pathSpots(pid, kind) {
    const S = this.S, out = new Set(), starts = new Set();
    for (const v in S.verts) if (S.verts[v].p === pid) starts.add(v);
    for (const e in S.edges) if (S.edges[e].p === pid) G.edgeVerts(e).forEach((v) => starts.add(v));
    for (const v of starts) {
      if (!this.connectedAt(pid, v, kind)) continue;
      for (const e of G.vertEdges(v)) if (!S.edges[e] && this.edgeFor(e, kind)) out.add(e);
    }
    return [...out];
  }
  setupPathSpots(pid, kind) {
    const v = this.S.setup.last;
    return G.vertEdges(v).filter((e) => !this.S.edges[e] && this.edgeFor(e, kind));
  }
  shipMoves(pid) {
    const S = this.S, from = [], to = {};
    if (S.ts.movedShip) return { from, to };
    for (const e of Object.keys(S.edges)) { // Schnappschuss: unten wird temporär gelöscht/neu gesetzt
      const x = S.edges[e];
      if (x.p !== pid || x.k !== 's' || x.t === S.turnNo) continue;
      if (S.pirate && G.edgeHexes(e).includes(S.pirate)) continue;
      const open = G.edgeVerts(e).some((v) => {
        const b = this.buildingAt(v);
        if (b && b.p === pid) return false;
        return !G.vertEdges(v).some((o) => o !== e && S.edges[o] && S.edges[o].p === pid);
      });
      if (!open) continue;
      delete S.edges[e];
      const spots = this.pathSpots(pid, 's').filter((s) => s !== e);
      S.edges[e] = x;
      if (spots.length) { from.push(e); to[e] = spots; }
    }
    return { from, to };
  }
  ratesFor(pid) {
    const r = {}; RES.forEach((x) => { r[x] = 4; });
    for (const e in this.S.harbors) {
      const h = this.S.harbors[e];
      if (!G.edgeVerts(e).some((v) => { const b = this.buildingAt(v); return b && b.p === pid; })) continue;
      if (h.kind === 'any') RES.forEach((x) => { r[x] = Math.min(r[x], 3); });
      else r[h.kind] = Math.min(r[h.kind], 2);
    }
    return r;
  }
  // Insel (zusammenhängendes Land) um Ecke v
  islandAt(v) {
    const h = G.vertHexes(v).find((x) => this.isLandHex(x));
    return h ? B.island(this.S, h) : new Set();
  }

  // ---------- Entdeckung ----------
  discoverAround(pid, e, reward) {
    const S = this.S;
    for (const v of G.edgeVerts(e)) for (const h of G.vertHexes(v)) {
      if (S.hexes[h]) continue;
      const hex = B.discover(S, h, this.rnd);
      if (hex.t === 'meer') { this.log(`${this.name(pid)} entdeckt offenes Meer.`, 'info', pid); continue; }
      let text = `${this.name(pid)} entdeckt neues Land: ${TERR_DE[hex.t]}${hex.n ? ' (' + hex.n + ')' : ''}!`;
      if (reward && hex.t !== 'wueste') {
        if (hex.t === 'gold') { S.pend.gold[pid] = (S.pend.gold[pid] || 0) + 1; text += ' Als Belohnung darf ein beliebiger Rohstoff gewählt werden.'; }
        else { const r = B.TERRAIN_RES[hex.t]; this.pl(pid).hand[r]++; text += ` Belohnung: 1× ${RES_DE[r]}.`; }
      }
      this.log(text, 'build', pid);
    }
  }

  // ---------- Bauen ----------
  placeSettlement(pid, v, free) {
    const S = this.S;
    S.verts[v] = { p: pid, k: 's' };
    const isl = this.islandAt(v);
    const pl = this.pl(pid);
    const known = [...isl].some((h) => pl.claimed[h]);
    if (!known) {
      const bonus = !free && pl.islandBonus < MAX_ISLAND_BONUS;
      isl.forEach((h) => { pl.claimed[h] = 1; });
      if (bonus) {
        pl.svp += 2; pl.islandBonus++;
        this.log(`${pl.name} gründet die erste Siedlung auf einer neuen Insel: +2 Sonderpunkte!`, 'award', pid);
      }
    } else isl.forEach((h) => { pl.claimed[h] = 1; });
  }

  // ---------- Aktionen ----------
  act(pid, a) {
    const S = this.S;
    if (!a || typeof a.type !== 'string') fail('Unbekannte Aktion.');
    const t = a.type;
    if (t === 'chat') return this.chat(pid, a.text);
    if (t === 'start') return this.start(pid);
    if (t === 'new_game') return this.newGame(pid);
    if (S.phase === 'lobby') fail('Das Spiel hat noch nicht begonnen.');
    if (S.phase === 'ended') fail('Das Spiel ist beendet.');
    // Pflichten, die jeder gleichzeitig erledigt
    if (t === 'discard') this.discard(pid, a.cards);
    else if (t === 'gold_pick') this.goldPick(pid, a.cards);
    else if (S.phase === 'setup') this.setupAct(pid, a);
    else this.mainAct(pid, a);
    S.v++;
    if (S.trade && !this.canPay(S.trade.from, S.trade.give)) { // Anbieter hat die Karten inzwischen ausgegeben
      S.trade = null; this.log('Das Angebot wurde automatisch zurückgezogen (Karten nicht mehr vorhanden).', 'trade');
    }
    if (S.phase === 'main') this.checkWin();
  }

  chat(pid, text) {
    text = String(text || '').trim().slice(0, 200);
    if (!text) return;
    this.S.chat.push({ id: ++this.S.seq, p: pid, text });
    if (this.S.chat.length > 60) this.S.chat.shift();
    this.S.v++;
  }

  noPending() { return !Object.keys(this.S.pend.discard).length && !Object.keys(this.S.pend.gold).length; }

  discard(pid, cards) {
    const S = this.S;
    const need = S.pend.discard[pid];
    if (!need) fail('Du musst gerade nichts abwerfen.');
    const c = cleanCards(cards);
    if (sum(c) !== need) fail(`Bitte genau ${need} Karten abwerfen.`);
    if (!this.canPay(pid, c)) fail('Du besitzt diese Karten nicht.');
    this.pay(pid, c);
    delete S.pend.discard[pid];
    this.log(`${this.name(pid)} wirft ${need} Karten ab.`, 'steal', pid);
  }
  goldPick(pid, cards) {
    const S = this.S;
    const need = S.pend.gold[pid];
    if (!need) fail('Du hast gerade keine Gold-Wahl.');
    const c = cleanCards(cards);
    if (sum(c) !== need) fail(`Bitte genau ${need} Rohstoff${need > 1 ? 'e' : ''} wählen.`);
    this.give(pid, c);
    delete S.pend.gold[pid];
    this.log(`${this.name(pid)} wählt für Gold: ${fmt(c)}.`, 'info', pid);
    if (S.phase === 'setup') this.setupAdvanceIfReady();
  }

  setupAct(pid, a) {
    const S = this.S, su = S.setup;
    if (!this.noPending()) fail('Zuerst müssen alle ihre Goldwahl treffen.');
    if (pid !== S.turn) fail(`${this.name(S.turn)} ist beim Aufbau an der Reihe.`);
    if (su.stage === 'settlement') {
      if (a.type !== 'place_settlement') fail('Setze zuerst eine Siedlung.');
      if (!this.settlementSpots(pid).includes(a.v)) fail('Hier darf keine Siedlung stehen (Abstandsregel: mindestens zwei Wege Abstand; Aufbau nur auf der Startinsel).');
      this.placeSettlement(pid, a.v, true);
      su.last = a.v; su.stage = 'road';
      const second = su.i >= S.order.length;
      this.log(`${this.name(pid)} setzt eine Siedlung.`, 'build', pid);
      if (second) {
        const got = emptyHand(); let gold = 0; const parts = [];
        for (const h of G.vertHexes(a.v)) {
          const hx = S.hexes[h];
          if (!hx) continue;
          if (hx.t === 'gold') gold++;
          else if (B.TERRAIN_RES[hx.t]) { got[B.TERRAIN_RES[hx.t]]++; parts.push(`${RES_DE[B.TERRAIN_RES[hx.t]]} (${TERR_DE[hx.t]})`); }
        }
        this.give(pid, got);
        if (gold) S.pend.gold[pid] = gold;
        if (parts.length || gold) this.log(`Startrohstoffe für ${this.name(pid)}: ${parts.join(', ')}${gold ? (parts.length ? ' und ' : '') + gold + '× freie Wahl (Gold)' : ''}.`, 'info', pid);
      }
      return;
    }
    // Straße oder Schiff direkt an der neuen Siedlung
    if (a.type !== 'place_road' && a.type !== 'place_ship') fail('Setze jetzt eine Straße oder ein Schiff an deine neue Siedlung.');
    const kind = a.type === 'place_road' ? 'r' : 's';
    if (!this.setupPathSpots(pid, kind).includes(a.e)) fail(kind === 'r' ? 'Die Straße muss an die neue Siedlung angrenzen und an Land liegen.' : 'Das Schiff muss an die neue Siedlung angrenzen und Meer berühren.');
    S.edges[a.e] = { p: pid, k: kind, t: 0 };
    this.log(`${this.name(pid)} legt ${kind === 'r' ? 'eine Straße' : 'ein Schiff'}.`, 'build', pid);
    this.discoverAround(pid, a.e, false);
    this.updateAwards(true);
    su.stage = 'done';
    this.setupAdvanceIfReady();
  }
  setupAdvanceIfReady() {
    const S = this.S, su = S.setup;
    if (su.stage !== 'done' || !this.noPending()) return;
    su.i++;
    if (su.i >= su.seq.length) {
      S.phase = 'main'; S.setup = null;
      this.startTurn(S.order[0]);
      this.log('Der Aufbau ist beendet – die Hauptphase beginnt!', 'sys');
      return;
    }
    su.stage = 'settlement'; su.last = null; S.turn = su.seq[su.i];
  }

  startTurn(pid) {
    const S = this.S;
    S.turn = pid; S.turnNo++; S.ts = { rolled: false, movedShip: false, devPlayed: false, sub: null, rb: 0 };
    S.trade = null; S.sbp = null; S.dice = null;
    this.log(`${this.name(pid)} ist an der Reihe.`, 'sys', pid);
  }

  mainAct(pid, a) {
    const S = this.S, t = a.type;
    const sbp = S.sbp;
    if (t === 'trade_respond') return this.tradeRespond(pid, a);
    if (!this.noPending()) fail('Zuerst müssen alle Pflichten (Abwerfen/Goldwahl) erledigt sein.');
    if (sbp) {
      if (pid !== sbp.pid) fail(`${this.name(sbp.pid)} baut gerade in der Sonderbauphase.`);
      const ok = ['build_road', 'build_ship', 'build_settlement', 'build_city', 'buy_dev', 'bank_trade', 'sbp_done'];
      if (!ok.includes(t)) fail('In der Sonderbauphase kannst du nur bauen, Entwicklungskarten kaufen oder mit der Bank tauschen.');
      if (t === 'sbp_done') { this.sbpNext(); return; }
    } else if (pid !== S.turn) fail(`${this.name(S.turn)} ist am Zug.`);
    const ts = S.ts;
    if (ts.sub === 'robber') {
      if (t === 'move_robber') return this.moveRobber(pid, a.hex);
      if (t === 'move_pirate') return this.movePirate(pid, a.hex);
      fail('Zuerst muss der Räuber oder der Pirat versetzt werden.');
    }
    if (ts.sub === 'steal') {
      if (t !== 'steal') fail('Wähle, wen du bestehlen möchtest.');
      return this.steal(pid, a.target);
    }
    if (ts.sub === 'road_building') {
      if (t === 'skip_roadbuilding') { this.endRoadBuilding(); return; }
      if (t !== 'build_road' && t !== 'build_ship') fail('Setze deine beiden kostenlosen Wege oder überspringe.');
      return this.build(pid, t === 'build_road' ? 'road' : 'ship', a.e, true);
    }
    switch (t) {
      case 'roll': return this.roll(pid);
      case 'build_road': this.needRolled(); return this.build(pid, 'road', a.e);
      case 'build_ship': this.needRolled(); return this.build(pid, 'ship', a.e);
      case 'build_settlement': this.needRolled(); return this.build(pid, 'settlement', a.v);
      case 'build_city': this.needRolled(); return this.build(pid, 'city', a.v);
      case 'move_ship': this.needRolled(); return this.moveShip(pid, a.from, a.to);
      case 'buy_dev': this.needRolled(); return this.buyDev(pid);
      case 'play_knight': return this.playDev(pid, 'ritter', a);
      case 'play_roadbuilding': return this.playDev(pid, 'strassenbau', a);
      case 'play_yop': return this.playDev(pid, 'erfindung', a);
      case 'play_monopoly': return this.playDev(pid, 'monopol', a);
      case 'bank_trade': this.needRolled(); return this.bankTrade(pid, a);
      case 'trade_offer': this.needRolled(); return this.tradeOffer(pid, a);
      case 'trade_confirm': return this.tradeConfirm(pid, a);
      case 'trade_cancel': return this.tradeCancel(pid);
      case 'end_turn': return this.endTurn(pid);
      default: fail('Unbekannte Aktion.');
    }
  }
  needRolled() { if (!this.S.ts.rolled && !this.S.sbp) fail('Würfle zuerst.'); }

  roll(pid) {
    const S = this.S;
    if (S.ts.rolled) fail('Du hast schon gewürfelt.');
    const a = 1 + Math.floor(this.rnd() * 6), b = 1 + Math.floor(this.rnd() * 6), n = a + b;
    S.dice = [a, b]; S.diceSeq++; S.ts.rolled = true; S.trade = null;
    this.log(`${this.name(pid)} würfelt ${n} (${a}+${b}).`, 'roll', pid);
    if (n === 7) {
      let any = false;
      for (const p of S.players) {
        const sz = this.handSize(p.id);
        if (sz > 7) { S.pend.discard[p.id] = Math.floor(sz / 2); any = true; }
      }
      this.log(any ? 'Eine 7! Wer mehr als 7 Karten hat, wirft die Hälfte ab. Dann versetzt der Würfler Räuber oder Pirat.' : 'Eine 7! Niemand muss abwerfen. Der Würfler versetzt Räuber oder Pirat.', 'roll');
      S.ts.sub = 'robber';
      return;
    }
    this.produce(n);
  }
  produce(n) {
    const S = this.S, got = {}, texts = {};
    let blocked = null;
    for (const k in S.hexes) {
      const h = S.hexes[k];
      if (h.n !== n) continue;
      const isGold = h.t === 'gold';
      const res = B.TERRAIN_RES[h.t];
      if (!res && !isGold) continue;
      for (const v of G.hexCorners(k)) {
        const b = S.verts[v];
        if (!b) continue;
        if (S.robber === k) { blocked = k; continue; }
        const amt = b.k === 'c' ? 2 : 1;
        if (isGold) S.pend.gold[b.p] = (S.pend.gold[b.p] || 0) + amt;
        else {
          (got[b.p] = got[b.p] || emptyHand())[res] += amt;
        }
        (texts[b.p] = texts[b.p] || []).push(isGold ? `${amt}× freie Wahl (${TERR_DE.gold} ${n})` : `${amt}× ${RES_DE[res]} (${TERR_DE[h.t]} ${n}${b.k === 'c' ? ', Stadt' : ''})`);
      }
    }
    const who = Object.keys(texts);
    if (!who.length && !blocked) this.log(`Niemand besitzt ein Feld mit der ${n}.`, 'info');
    for (const p of who) { if (got[p]) this.give(+p, got[p]); this.log(`${this.name(+p)} erhält ${texts[p].join(', ')}.`, 'roll', +p); }
    if (blocked) this.log(`Der Räuber blockiert ${TERR_DE[S.hexes[blocked].t]} ${n}: dort gibt es nichts.`, 'info');
  }

  build(pid, what, where, free) {
    const S = this.S;
    const L = this.left(pid);
    const cost = COST[what];
    if (!free && !this.canPay(pid, cost)) fail(`Dir fehlen Rohstoffe (${fmt(cost)}).`);
    if (what === 'road' || what === 'ship') {
      if (L[what] <= 0) fail(`Du hast keine ${what === 'road' ? 'Straßen' : 'Schiffe'} mehr.`);
      const kind = what === 'road' ? 'r' : 's';
      if (S.edges[where]) fail('Hier liegt schon ein Weg.');
      if (!this.pathSpots(pid, kind).includes(where)) {
        if (kind === 's' && S.pirate && G.edgeHexes(where || '').includes(S.pirate)) fail('Der Pirat blockiert diese Küste.');
        fail(kind === 'r' ? 'Straßen müssen an Land liegen und an deine Straße/Siedlung anschließen.' : 'Schiffe müssen Meer berühren und an dein Schiff/deine Küstensiedlung anschließen.');
      }
      if (!free) this.pay(pid, cost);
      S.edges[where] = { p: pid, k: kind, t: S.turnNo };
      this.log(`${this.name(pid)} baut ${kind === 'r' ? 'eine Straße' : 'ein Schiff'}${free ? ' (Straßenbau)' : ''}.`, 'build', pid);
      this.discoverAround(pid, where, true);
      this.updateAwards();
      if (free) { S.ts.rb--; if (S.ts.rb <= 0 || !this.rbPossible(pid)) this.endRoadBuilding(); }
      return;
    }
    if (what === 'settlement') {
      if (L.settlement <= 0) fail('Du hast keine Siedlungen mehr (erst Städte bauen).');
      if (!this.settlementSpots(pid).includes(where)) fail('Siedlungen brauchen Anschluss an deinen Weg und zwei Wege Abstand zu jedem Gebäude.');
      this.pay(pid, cost);
      this.placeSettlement(pid, where, false);
      this.log(`${this.name(pid)} baut eine Siedlung.`, 'build', pid);
      this.updateAwards();
      return;
    }
    if (what === 'city') {
      if (L.city <= 0) fail('Du hast keine Städte mehr.');
      if (!this.citySpots(pid).includes(where)) fail('Städte werden nur aus eigenen Siedlungen ausgebaut.');
      this.pay(pid, cost);
      S.verts[where].k = 'c';
      this.log(`${this.name(pid)} baut eine Stadt.`, 'build', pid);
    }
  }
  rbPossible(pid) { return this.pathSpots(pid, 'r').length > 0 && this.left(pid).road > 0 || this.pathSpots(pid, 's').length > 0 && this.left(pid).ship > 0; }
  endRoadBuilding() { const ts = this.S.ts; ts.sub = null; ts.rb = 0; }

  moveShip(pid, from, to) {
    const S = this.S;
    const mv = this.shipMoves(pid);
    if (S.ts.movedShip) fail('Du hast in diesem Zug schon ein Schiff versetzt.');
    if (!mv.from.includes(from)) fail('Dieses Schiff kann nicht versetzt werden (es muss ein offenes Ende haben, darf nicht neu gebaut sein und der Pirat darf nicht daneben liegen).');
    if (!(mv.to[from] || []).includes(to)) fail('Dorthin kann das Schiff nicht fahren.');
    const x = S.edges[from]; delete S.edges[from];
    S.edges[to] = { p: pid, k: 's', t: S.turnNo };
    S.ts.movedShip = true;
    this.log(`${this.name(pid)} versetzt ein Schiff.`, 'build', pid);
    this.discoverAround(pid, to, true);
    this.updateAwards();
  }

  buyDev(pid) {
    const S = this.S;
    if (!S.deck.length) fail('Der Entwicklungskartenstapel ist leer.');
    if (!this.canPay(pid, COST.dev)) fail(`Dir fehlen Rohstoffe (${fmt(COST.dev)}).`);
    this.pay(pid, COST.dev);
    const type = S.deck.pop();
    this.pl(pid).dev.push({ id: ++S.seq, type, bought: S.turnNo });
    this.log(`${this.name(pid)} kauft eine Entwicklungskarte.`, 'build', pid);
  }
  playDev(pid, type, a) {
    const S = this.S, p = this.pl(pid);
    if (S.sbp) fail('In der Sonderbauphase dürfen keine Entwicklungskarten gespielt werden.');
    if (S.ts.devPlayed) fail('Du darfst nur eine Entwicklungskarte pro Zug ausspielen.');
    const card = p.dev.find((d) => d.type === type && d.bought < S.turnNo);
    if (!card) fail(p.dev.some((d) => d.type === type) ? 'Diese Karte hast du in diesem Zug gekauft – sie ist erst im nächsten Zug spielbar.' : `Du besitzt keine Karte „${DEV_DE[type]}“.`);
    if (type === 'erfindung') {
      if (!RES.includes(a.a) || !RES.includes(a.b)) fail('Wähle zwei Rohstoffe.');
    }
    if (type === 'monopol' && !RES.includes(a.res)) fail('Wähle einen Rohstoff.');
    p.dev.splice(p.dev.indexOf(card), 1);
    S.ts.devPlayed = true; S.trade = null;
    if (type === 'ritter') {
      p.knights++;
      this.log(`${p.name} spielt einen Ritter und versetzt Räuber oder Pirat.`, 'steal', pid);
      S.ts.sub = 'robber';
      this.updateAwards();
    } else if (type === 'strassenbau') {
      this.log(`${p.name} spielt Straßenbau: zwei kostenlose Wege (Straßen und/oder Schiffe).`, 'build', pid);
      S.ts.sub = 'road_building'; S.ts.rb = 2;
      if (!this.rbPossible(pid)) { this.endRoadBuilding(); this.log('Es gibt keinen freien Platz für Wege – Karte verfällt.', 'info'); }
    } else if (type === 'erfindung') {
      const c = emptyHand(); c[a.a]++; c[a.b]++;
      this.give(pid, c);
      this.log(`${p.name} spielt Erfindung und nimmt ${RES_DE[a.a]} und ${RES_DE[a.b]} von der Bank.`, 'info', pid);
    } else if (type === 'monopol') {
      let tot = 0;
      for (const q of S.players) if (q.id !== pid) { tot += q.hand[a.res]; p.hand[a.res] += q.hand[a.res]; q.hand[a.res] = 0; }
      this.log(`${p.name} spielt Monopol auf ${RES_DE[a.res]} und erhält ${tot} Karten.`, 'steal', pid);
    }
  }

  // ---------- Räuber / Pirat ----------
  moveRobber(pid, hex) {
    const S = this.S;
    if (!S.hexes[hex] || !this.isLandHex(hex)) fail('Der Räuber kann nur auf ein Landfeld gestellt werden.');
    if (hex === S.robber) fail('Der Räuber muss auf ein anderes Feld ziehen.');
    S.robber = hex;
    this.log(`${this.name(pid)} stellt den Räuber auf ${TERR_DE[S.hexes[hex].t]}${S.hexes[hex].n ? ' ' + S.hexes[hex].n : ''}.`, 'steal', pid);
    const victims = [...new Set(G.hexCorners(hex).map((v) => S.verts[v]).filter((b) => b && b.p !== pid && this.handSize(b.p) > 0).map((b) => b.p))];
    this.afterMove(pid, victims);
  }
  movePirate(pid, hex) {
    const S = this.S;
    if (!S.hexes[hex] || !this.isSeaHex(hex)) fail('Der Pirat kann nur auf ein Meerfeld gestellt werden.');
    if (hex === S.pirate) fail('Der Pirat muss auf ein anderes Feld ziehen.');
    S.pirate = hex;
    this.log(`${this.name(pid)} stellt den Piraten auf ein Meerfeld.`, 'steal', pid);
    const victims = [...new Set(G.hexEdges(hex).map((e) => S.edges[e]).filter((x) => x && x.k === 's' && x.p !== pid && this.handSize(x.p) > 0).map((x) => x.p))];
    this.afterMove(pid, victims);
  }
  afterMove(pid, victims) {
    const S = this.S;
    S.ts.victims = victims;
    if (!victims.length) { S.ts.sub = null; this.log('Es gibt niemanden zum Bestehlen.', 'info'); }
    else if (victims.length === 1) { this.steal(pid, victims[0]); }
    else S.ts.sub = 'steal';
  }
  steal(pid, target) {
    const S = this.S;
    if (!(S.ts.victims || []).includes(target)) fail('Diesen Spieler kannst du nicht bestehlen.');
    const h = this.pl(target).hand;
    const pool = []; RES.forEach((r) => { for (let i = 0; i < h[r]; i++) pool.push(r); });
    if (pool.length) {
      const r = pool[Math.floor(this.rnd() * pool.length)];
      h[r]--; this.pl(pid).hand[r]++;
      this.log(`${this.name(pid)} stiehlt ${this.name(target)} eine Karte.`, 'steal', pid);
      this.pl(pid).lastStolen = null;
    }
    S.ts.sub = null; S.ts.victims = [];
  }

  // ---------- Handel ----------
  bankTrade(pid, a) {
    if (!RES.includes(a.give) || !RES.includes(a.get)) fail('Wähle zwei Rohstoffe.');
    if (a.give === a.get) fail('Gleiche Rohstoffe lassen sich nicht tauschen.');
    const times = a.n === undefined ? 1 : a.n;
    if (!Number.isInteger(times) || times < 1 || times > 20) fail('Ungültige Anzahl.');
    const rate = this.ratesFor(pid)[a.give];
    if (this.pl(pid).hand[a.give] < rate * times) fail(`Für diesen Tausch brauchst du ${rate * times}× ${RES_DE[a.give]} (Kurs ${rate}:1).`);
    this.pl(pid).hand[a.give] -= rate * times; this.pl(pid).hand[a.get] += times;
    this.log(`${this.name(pid)} tauscht mit der Bank ${rate * times}× ${RES_DE[a.give]} gegen ${times}× ${RES_DE[a.get]} (${rate}:1).`, 'trade', pid);
  }
  tradeOffer(pid, a) {
    const S = this.S;
    if (S.sbp) fail('In der Sonderbauphase ist kein Handel mit Spielern erlaubt.');
    const give = cleanCards(a.give), want = cleanCards(a.want);
    if (!sum(give) || !sum(want)) fail('Ein Angebot braucht Karten auf beiden Seiten.');
    if (RES.some((r) => give[r] && want[r])) fail('Gib nicht dieselbe Ressource, die du verlangst.');
    if (!this.canPay(pid, give)) fail('Du besitzt diese Karten nicht.');
    S.trade = { id: ++S.tradeSeq, from: pid, give, want, responses: {} };
    this.log(`${this.name(pid)} bietet ${fmt(give)} gegen ${fmt(want)}.`, 'trade', pid);
  }
  tradeRespond(pid, a) {
    const S = this.S, tr = S.trade;
    if (!tr) fail('Es gibt kein offenes Angebot.');
    if (pid === tr.from) fail('Das ist dein eigenes Angebot.');
    if (S.sbp || S.phase !== 'main') fail('Gerade ist kein Handel möglich.');
    if (a.counter) {
      const give = cleanCards(a.counter.give), want = cleanCards(a.counter.want);
      if (!sum(give) || !sum(want)) fail('Ein Gegenangebot braucht Karten auf beiden Seiten.');
      if (RES.some((r) => give[r] && want[r])) fail('Gib nicht dieselbe Ressource, die du verlangst.');
      if (!this.canPay(pid, want)) fail('Du besitzt die Karten deines Gegenangebots nicht.');
      tr.responses[pid] = { s: 'counter', give, want };
      this.log(`${this.name(pid)} macht ein Gegenangebot: bekommt ${fmt(want)}, gibt ${fmt(give)}.`, 'trade', pid);
    } else if (a.accept) {
      if (!this.canPay(pid, tr.want)) fail('Dir fehlen die verlangten Karten.');
      tr.responses[pid] = { s: 'accept' };
      this.log(`${this.name(pid)} nimmt das Angebot an.`, 'trade', pid);
    } else {
      tr.responses[pid] = { s: 'decline' };
      this.log(`${this.name(pid)} lehnt ab.`, 'trade', pid);
    }
    S.v++;
  }
  tradeConfirm(pid, a) {
    const S = this.S, tr = S.trade;
    if (!tr || tr.from !== pid) fail('Du hast kein offenes Angebot.');
    const r = tr.responses[a.with];
    if (!r || (r.s !== 'accept' && r.s !== 'counter')) fail('Dieser Spieler hat nicht zugesagt.');
    const give = r.s === 'counter' ? r.give : tr.give, want = r.s === 'counter' ? r.want : tr.want;
    if (!this.canPay(pid, give)) fail('Du besitzt die angebotenen Karten nicht mehr.');
    if (!this.canPay(a.with, want)) fail(`${this.name(a.with)} besitzt die Karten nicht mehr.`);
    this.pay(pid, give); this.give(a.with, give);
    this.pay(a.with, want); this.give(pid, want);
    this.log(`Handel: ${this.name(pid)} gibt ${fmt(give)} an ${this.name(a.with)} und erhält ${fmt(want)}.`, 'trade', pid);
    S.trade = null;
  }
  tradeCancel(pid) {
    const S = this.S;
    if (!S.trade || S.trade.from !== pid) fail('Du hast kein offenes Angebot.');
    S.trade = null;
    this.log(`${this.name(pid)} zieht das Angebot zurück.`, 'trade', pid);
  }

  // ---------- Zugende / Sonderbauphase ----------
  endTurn(pid) {
    const S = this.S;
    if (!S.ts.rolled) fail('Würfle zuerst, bevor du den Zug beendest.');
    S.trade = null;
    const i = S.order.indexOf(pid), next = S.order[(i + 1) % S.order.length];
    if (S.players.length >= 5) {
      const queue = []; for (let k = 1; k < S.order.length; k++) queue.push(S.order[(i + k) % S.order.length]);
      S.sbp = { queue, pid: null, after: next };
      this.log('Sonderbauphase: Die anderen Spieler dürfen reihum bauen (kein Handel mit Spielern).', 'sys');
      this.sbpNext();
    } else this.startTurn(next);
  }
  // Wer in der Sonderbauphase überhaupt etwas tun könnte (sonst wird automatisch übersprungen)
  canDoSomething(pid) {
    const h = this.pl(pid).hand, rates = this.ratesFor(pid), L = this.left(pid);
    const spots = { road: this.pathSpots(pid, 'r').length > 0 && L.road > 0, ship: this.pathSpots(pid, 's').length > 0 && L.ship > 0,
      settlement: this.settlementSpots(pid).length > 0 && L.settlement > 0, city: this.citySpots(pid).length > 0 && L.city > 0, dev: this.S.deck.length > 0 };
    for (const k of Object.keys(COST)) {
      if (!spots[k]) continue;
      let deficit = 0, spare = 0;
      for (const r of RES) {
        const need = COST[k][r] || 0;
        if (h[r] < need) deficit += need - h[r]; else spare += Math.floor((h[r] - need) / rates[r]);
      }
      if (spare >= deficit) return true;
    }
    return false;
  }
  sbpNext() {
    const S = this.S, sb = S.sbp;
    while (sb.queue.length) {
      const p = sb.queue.shift();
      if (this.canDoSomething(p)) { sb.pid = p; this.log(`Sonderbauphase: ${this.name(p)} darf bauen.`, 'sys', p); return; }
    }
    S.sbp = null;
    this.startTurn(sb.after);
  }

  // ---------- Auszeichnungen / Siegpunkte ----------
  routeLen(pid) {
    const S = this.S, own = {};
    for (const e in S.edges) if (S.edges[e].p === pid) {
      for (const v of G.edgeVerts(e)) (own[v] = own[v] || []).push(e);
    }
    const edgesOwn = Object.keys(S.edges).filter((e) => S.edges[e].p === pid);
    if (!edgesOwn.length) return 0;
    let best = 0, budget = 400000; // Obergrenze gegen Explosion bei sehr dichten Netzen
    const used = new Set();
    const ends = {}; edgesOwn.forEach((e) => { ends[e] = G.edgeVerts(e); });
    const dfs = (v, prev, len) => {
      if (len > best) best = len;
      if (best >= edgesOwn.length || --budget < 0) return;
      const b = S.verts[v];
      if (b && b.p !== pid) return; // fremde Siedlung unterbricht
      for (const e of own[v] || []) {
        if (used.has(e)) continue;
        // Straße ↔ Schiff nur über eigene Siedlung/Stadt
        if (S.edges[e].k !== S.edges[prev].k && !(b && b.p === pid)) continue;
        used.add(e);
        const w = ends[e][0] === v ? ends[e][1] : ends[e][0];
        dfs(w, e, len + 1);
        used.delete(e);
      }
    };
    for (const e of edgesOwn) for (const v of ends[e]) {
      if (budget < 0 || best >= edgesOwn.length) break;
      used.add(e);
      const w = ends[e][0] === v ? ends[e][1] : ends[e][0];
      dfs(w, e, 1);
      used.delete(e);
    }
    return best;
  }
  updateAwards(quiet) {
    const S = this.S;
    const lens = S.players.map((p) => this.routeLen(p.id));
    this.lens = lens;
    const max = Math.max(...lens);
    const cands = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
    let nl = S.longest;
    if (max < 5) nl = null;
    else if (nl === null || !cands.includes(nl)) nl = cands.length === 1 ? cands[0] : (nl !== null && lens[nl] >= 5 && lens[nl] === max ? nl : null);
    if (nl !== S.longest) {
      if (nl !== null) this.log(`${this.name(nl)} hat jetzt den Längsten Handelsweg (${lens[nl]})! +2 Punkte.`, 'award', nl);
      else if (S.longest !== null) this.log('Der Längste Handelsweg ist unterbrochen – niemand hat ihn.', 'award');
      S.longest = nl;
    }
    const k = S.players.map((p) => p.knights), kmax = Math.max(...k);
    let na = S.largest;
    if (kmax >= 3) {
      const kc = k.map((x, i) => (x === kmax ? i : -1)).filter((i) => i >= 0);
      if (na === null || !kc.includes(na)) na = kc.length === 1 ? kc[0] : na;
    }
    if (na !== S.largest) { S.largest = na; this.log(`${this.name(na)} hat jetzt die Stärkste Schutzmacht (${k[na]} Ritter)! +2 Punkte.`, 'award', na); }
  }
  vp(pid) {
    const S = this.S, p = this.pl(pid);
    return this.count(pid, 's') + 2 * this.count(pid, 'c') + p.svp + (S.longest === pid ? 2 : 0) + (S.largest === pid ? 2 : 0);
  }
  hiddenVp(pid) { return this.pl(pid).dev.filter((d) => d.type === 'siegpunkt').length; }
  checkWin() {
    const S = this.S;
    this.updateAwards();
    const pid = S.sbp ? S.sbp.pid : S.turn;
    if (pid === null || pid === undefined) return;
    if (this.vp(pid) + this.hiddenVp(pid) >= WIN) {
      S.phase = 'ended'; S.winner = pid; S.trade = null;
      this.log(`🏆 ${this.name(pid)} gewinnt mit ${this.vp(pid) + this.hiddenVp(pid)} Siegpunkten!`, 'award', pid);
    }
  }

  // ---------- Sicht für einen Spieler ----------
  legal(pid) {
    const S = this.S, L = { settlement: [], city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: [], pirate: [], steal: [] };
    if (S.phase === 'setup') {
      if (pid === S.turn && this.noPending()) {
        if (S.setup.stage === 'settlement') L.settlement = this.settlementSpots(pid);
        else if (S.setup.stage === 'road') { L.road = this.setupPathSpots(pid, 'r'); L.ship = this.setupPathSpots(pid, 's'); }
      }
      return L;
    }
    if (S.phase !== 'main' || !this.noPending()) return L;
    const active = S.sbp ? S.sbp.pid : S.turn;
    if (pid !== active) return L;
    const ts = S.ts, left = this.left(pid);
    if (ts.sub === 'robber') {
      L.robber = Object.keys(S.hexes).filter((k) => this.isLandHex(k) && k !== S.robber);
      L.pirate = Object.keys(S.hexes).filter((k) => this.isSeaHex(k) && k !== S.pirate);
      return L;
    }
    if (ts.sub === 'steal') { L.steal = ts.victims || []; return L; }
    if (ts.sub === 'road_building') { if (left.road > 0) L.road = this.pathSpots(pid, 'r'); if (left.ship > 0) L.ship = this.pathSpots(pid, 's'); return L; }
    if (!ts.rolled && !S.sbp) return L;
    if (left.road > 0) L.road = this.pathSpots(pid, 'r');
    if (left.ship > 0) L.ship = this.pathSpots(pid, 's');
    if (left.settlement > 0) L.settlement = this.settlementSpots(pid);
    if (left.city > 0) L.city = this.citySpots(pid);
    if (!S.sbp) { const m = this.shipMoves(pid); L.shipFrom = m.from; L.shipTo = m.to; }
    return L;
  }
  stepOf() {
    const S = this.S;
    if (S.phase === 'lobby') return 'lobby';
    if (S.phase === 'ended') return 'ended';
    if (Object.keys(S.pend.discard).length) return 'discard';
    if (Object.keys(S.pend.gold).length) return 'gold';
    if (S.phase === 'setup') return S.setup.stage === 'settlement' ? 'setup_settlement' : 'setup_road';
    if (S.sbp) return 'sbp';
    if (S.ts.sub) return S.ts.sub;
    return S.ts.rolled ? 'main' : 'roll';
  }
  prompt(pid, step) {
    const S = this.S;
    const turn = S.sbp ? S.sbp.pid : S.turn;
    const me = pid === turn;
    const tn = turn !== null && turn !== undefined ? this.name(turn) : '';
    switch (step) {
      case 'lobby': return pid === S.host ? 'Warte auf Mitspieler – starte, sobald alle da sind.' : 'Warte, bis der Spielleiter das Spiel startet.';
      case 'ended': return `${S.winner !== null ? this.name(S.winner) : ''} hat gewonnen!`;
      case 'discard': return S.pend.discard[pid] ? `Eine 7! Wirf ${S.pend.discard[pid]} Karten ab.` : 'Warte, bis alle Karten abgeworfen haben …';
      case 'gold': return S.pend.gold[pid] ? `Gold! Wähle ${S.pend.gold[pid]} beliebige${S.pend.gold[pid] > 1 ? '' : 'n'} Rohstoff${S.pend.gold[pid] > 1 ? 'e' : ''}.` : 'Warte auf die Goldwahl der anderen …';
      case 'setup_settlement': return me ? `Setze deine ${S.setup.i >= S.order.length ? 'zweite' : 'erste'} Siedlung.` : `${tn} setzt eine Siedlung.`;
      case 'setup_road': return me ? 'Setze eine Straße oder (an der Küste) ein Schiff an deine neue Siedlung.' : `${tn} setzt eine Straße oder ein Schiff.`;
      case 'roll': return me ? 'Du bist dran – würfle! (Vorher darfst du eine Entwicklungskarte spielen.)' : `${tn} ist am Zug.`;
      case 'robber': return me ? 'Versetze den Räuber (auf ein Landfeld) oder den Piraten (aufs Meer).' : `${tn} versetzt Räuber oder Pirat.`;
      case 'steal': return me ? 'Wähle, wen du bestehlen willst.' : `${tn} wählt ein Opfer.`;
      case 'road_building': return me ? `Straßenbau: Setze noch ${S.ts.rb} kostenlose${S.ts.rb > 1 ? '' : 'n'} Weg${S.ts.rb > 1 ? 'e' : ''}.` : `${tn} baut mit Straßenbau.`;
      case 'sbp': return me ? 'Sonderbauphase: Du darfst bauen oder kaufen. Klicke „Fertig“, wenn du nichts mehr tun willst.' : `Sonderbauphase: ${tn} baut.`;
      case 'main': return me ? 'Handeln, bauen oder Zug beenden.' : `${tn} handelt und baut.`;
      default: return null;
    }
  }
  view(pid) {
    const S = this.S, step = this.stepOf();
    const me = this.pl(pid);
    const lens = S.phase === 'main' || S.phase === 'ended' ? (this.updateAwardsView()) : [];
    const turn = S.sbp ? S.sbp.pid : S.turn;
    const v = {
      v: S.v, phase: S.phase, you: pid, host: S.host, minPlayers: MIN_P, maxPlayers: MAX_P, winPoints: WIN,
      players: S.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, connected: p.connected,
        vp: S.phase === 'lobby' ? 0 : this.vp(p.id) + (S.phase === 'ended' ? this.hiddenVp(p.id) : 0), svp: p.svp,
        resCount: this.handSize(p.id), devCount: p.dev.length, knightsPlayed: p.knights, longestRoute: lens[p.id] || 0,
        hasLongest: S.longest === p.id, hasLargest: S.largest === p.id,
        left: S.phase === 'lobby' ? { road: 15, ship: 15, settlement: 5, city: 4 } : this.left(p.id),
        ...(S.pend.discard[p.id] ? { discarding: S.pend.discard[p.id] } : {}), ...(S.pend.gold[p.id] ? { pickingGold: S.pend.gold[p.id] } : {}),
      })),
      order: S.order, turn, step, dice: S.dice, diceSeq: S.diceSeq,
      hexes: Object.keys(S.hexes).map((k) => ({ k, t: S.hexes[k].t, n: S.hexes[k].n })),
      fog: S.phase === 'lobby' ? [] : B.fog(S),
      harbors: Object.keys(S.harbors).map((e) => {
        const [a, b] = G.edgeHexes(e); const land = this.isLandHex(a) ? a : b;
        return { e, kind: S.harbors[e].kind, land, sea: land === a ? b : a };
      }),
      verts: S.verts, edges: S.edges, robber: S.robber, pirate: S.pirate,
      me: { hand: me.hand, dev: me.dev.map((d) => ({ id: d.id, type: d.type, playable: d.type !== 'siegpunkt' && d.bought < S.turnNo && !S.ts.devPlayed && S.phase === 'main' && !S.sbp && pid === S.turn, fresh: d.bought >= S.turnNo })), hiddenVp: this.hiddenVp(pid) },
      afford: { road: false, ship: false, settlement: false, city: false, dev: false },
      legal: this.legal(pid),
      rates: this.ratesFor(pid),
      trade: S.trade ? { id: S.trade.id, from: S.trade.from, give: S.trade.give, want: S.trade.want, responses: S.trade.responses } : null,
      prompt: this.prompt(pid, step),
      pending: S.pend,
      log: S.log, chat: S.chat, winner: S.winner,
      bank: { dev: S.deck.length }, longestHolder: S.longest, largestHolder: S.largest, sbp: !!S.sbp,
    };
    if (S.phase === 'main' || S.phase === 'ended') {
      const L = this.left(pid);
      v.afford = { road: L.road > 0 && this.canPay(pid, COST.road), ship: L.ship > 0 && this.canPay(pid, COST.ship), settlement: L.settlement > 0 && this.canPay(pid, COST.settlement), city: L.city > 0 && this.canPay(pid, COST.city), dev: S.deck.length > 0 && this.canPay(pid, COST.dev) };
    }
    return v;
  }
  updateAwardsView() {
    // Längen nur für die Anzeige (ohne Zustandsänderung)
    const key = this.S.v + ':' + Object.keys(this.S.edges).length;
    if (this._lenKey !== key) { this._lens = this.S.players.map((p) => this.routeLen(p.id)); this._lenKey = key; }
    return this._lens;
  }
}

Game.COST = COST; Game.COLORS = COLORS; Game.GameError = GameError; Game.WIN = WIN;
module.exports = Game;
