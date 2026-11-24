'use strict';
// Spiellogik "Die Handelsinseln" (Grundspiel + Erweiterung). Zustand ist reines JSON (speicherbar).
// Kern: Zustand, Aufbau, Würfeln/Erträge, Bauen, Karten, Räuber, Zugablauf, Auszeichnungen. Weitere Teilbereiche in game_*.js.
const { G, B, ST, RES, COLORS, COST, RES_DE, TERR_DE, DEV_DE, SEATS, UNLIMITED, GameError, fail, emptyHand, sum, fmt, cleanCards } = require('./game_common');

// Aktionen, die in jeder Phase gehen (Chat, Lobby, Spielleiter-Funktionen); alles andere läuft über setupAct/mainAct
const ANYTIME = {
  chat: (g, pid, a) => g.chat(pid, a.text),
  start: (g, pid) => g.start(pid),
  new_game: (g, pid) => g.newGame(pid),
  resume_game: (g, pid, a) => g.resumeGame(pid, a.winPoints),
  set_settings: (g, pid, a) => g.setSettings(pid, a.settings),
  regen_board: (g, pid) => { g.hostOnly(pid, 'das Spielfeld neu würfeln'); g.regen(); g.S.v++; },
  close_seats: (g, pid, a) => {
    g.hostOnly(pid, 'die Plätze schließen'); g.S.closed = !!a.closed;
    g.log(g.S.closed ? 'Die Plätze sind besetzt – niemand kann mehr beitreten.' : 'Die Plätze sind wieder offen.', 'sys'); g.S.v++;
  },
  add_bot: (g, pid, a) => g.addBot(pid, a.kind),
  add_table_player: (g, pid, a) => g.addTablePlayer(pid, a),
  kick: (g, pid, a) => { g.lastKicked = g.kick(pid, a.pid); },
  end_game: (g, pid) => g.endGame(pid),
};

class Game {
  constructor(opts = {}, state = null) {
    this.rnd = opts.rnd || Math.random;
    this.meta = opts.meta || { id: 'lokal', name: 'Spiel' };
    this.S = state;
    if (!state) this.reset();
  }
  // Wiederherstellen ohne reset(): sonst würde jedes Mal ein Vorschau-Brett erzeugt und gleich verworfen
  static fromJSON(json, opts) { return new Game(opts, json); }
  toJSON() { return this.S; }

  reset(keepPlayers) {
    const old = keepPlayers && this.S ? this.S.players : [];
    const settings = keepPlayers && this.S ? this.S.settings : ST.defaults();
    const host = keepPlayers && this.S ? this.S.host : 0;
    this.S = {
      v: 0, fx: [], fxId: (this.S && this.S.fxId) || 0, phase: 'lobby', players: old.map((p) => ({ ...p, hand: emptyHand(), dev: [], claimed: {}, knights: 0, svp: 0, islandBonus: 0, auto: false, autoTurns: 0, vanished: false })),
      settings, closed: false, endedBy: null, aborted: false, stats: null, supply: null, deckUnlimited: false, fogGold: 1,
      host, log: [], chat: [], logId: 0, seq: 0,
      hexes: {}, harbors: {}, verts: {}, edges: {}, robber: null, pirate: null,
      order: [], turn: 0, turnNo: 0, ts: {}, pend: { discard: {}, gold: {} }, trade: null,
      dice: null, diceSeq: 0, deck: [], setup: null, sbp: null, winner: null, longest: null, largest: null, tradeSeq: 0,
    };
    this.S.players.forEach((p, i) => { p.id = i; });
    this.regen();
  }
  // Neues Vorschau-Brett für die Lobby
  regen() {
    const S = this.S;
    S.verts = {}; S.edges = {};
    B.generate(S, Math.max(S.settings.plannedPlayers, S.players.length, 2), this.rnd, S.settings);
  }
  lim(kind) { const v = this.S.settings.limits[kind]; return v === null || v === undefined ? Infinity : v; }

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
    const f = (x) => (x === Infinity ? UNLIMITED : x);
    return {
      road: f(this.lim('road') - this.countE(pid, 'r')), ship: f(this.lim('ship') - this.countE(pid, 's')),
      settlement: f(this.lim('settlement') - this.count(pid, 's')), city: f(this.lim('city') - this.count(pid, 'c')),
    };
  }
  canPay(pid, cost) { const h = this.pl(pid).hand; return Object.keys(cost).every((r) => h[r] >= cost[r]); }
  pay(pid, cost) { const h = this.pl(pid).hand; for (const r in cost) h[r] -= cost[r]; }
  give(pid, cost) { const h = this.pl(pid).hand; for (const r in cost) h[r] += cost[r]; }
  handSize(pid) { return sum(this.pl(pid).hand); }
  // Vorrat der Bank (Infinity = unbegrenzt): Limit minus Karten in Spielerhand
  stock(res) {
    const l = this.S.settings.limits.bank[res];
    if (l === null || l === undefined) return Infinity;
    return Math.max(0, l - this.S.players.reduce((a, p) => a + p.hand[res], 0));
  }
  // Kartenbewegungen für die Animation im Browser: von/nach 'bank', 'p:<Spieler>' oder 'h:<Feld>'. pub = für alle sichtbar (sonst sehen Unbeteiligte nur die Kartenrücken)
  fx(from, to, cards, pub, why) {
    const c = {}; let n = 0;
    for (const r of RES) if (cards && cards[r] > 0) { c[r] = cards[r]; n += cards[r]; }
    if (!n) return;
    const S = this.S; S.fx = S.fx || []; S.fxId = S.fxId || 0;
    S.fx.push({ id: ++S.fxId, f: from, t: to, c, n, pub: !!pub, why });
    if (S.fx.length > 40) S.fx.shift();
  }
  fxFor(pid) {
    const me = 'p:' + pid;
    return (this.S.fx || []).map((e) => (e.pub || e.f === me || e.t === me ? e : { id: e.id, f: e.f, t: e.t, n: e.n, pub: false, why: e.why }));
  }
  payBank(pid, cost) { this.pay(pid, cost); this.fx('p:' + pid, 'bank', cost, true, 'build'); }
  bankGive(pid, cost) { // gibt, was die Bank hergeben kann; Rückgabe: tatsächlich ausgegebene Karten
    const out = {};
    for (const r of RES) if (cost[r]) { const n = Math.min(cost[r], this.stock(r)); if (n > 0) { this.pl(pid).hand[r] += n; out[r] = n; } }
    return out;
  }
  bump(pid, key, n = 1, sub) {
    const st = this.S.stats && this.S.stats.players[pid];
    if (!st) return;
    if (sub) st[key][sub] += n; else st[key] += n;
  }
  hexT(k) { return this.S.hexes[k] ? this.S.hexes[k].t : null; }
  isLandHex(k) { return B.isLand(this.hexT(k)); }
  isSeaHex(k) { return this.hexT(k) === 'meer'; }

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
      for (const h of S.home) for (const v of G.hexCorners(h)) if (this.distanceOk(v) && this.vertTouchesLand(v) && (S.settings.goldStart || !B.touchesGold(S, v))) out.add(v);
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
    const r = {}; RES.forEach((x) => { r[x] = this.S.settings.bankRate; });
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
      this.bump(pid, 'discovered');
      let text = `${this.name(pid)} entdeckt neues Land: ${TERR_DE[hex.t]}${hex.n ? ' (' + hex.n + ')' : ''}!`;
      if (reward && hex.t !== 'wueste') {
        if (hex.t === 'gold') { S.pend.gold[pid] = (S.pend.gold[pid] || 0) + 1; text += ' Als Belohnung darf ein beliebiger Rohstoff gewählt werden.'; }
        else {
          const r = B.TERRAIN_RES[hex.t];
          if (Object.keys(this.bankGive(pid, { [r]: 1 })).length) { this.fx('bank', 'p:' + pid, { [r]: 1 }, true, 'gold'); text += ` Belohnung: 1× ${RES_DE[r]}.`; } else text += ` (Die Bank hat kein ${RES_DE[r]} mehr.)`;
        }
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
      const bonus = !free && pl.islandBonus < S.settings.islandBonusMax && S.settings.islandBonus > 0;
      isl.forEach((h) => { pl.claimed[h] = 1; });
      if (bonus) {
        pl.svp += S.settings.islandBonus; pl.islandBonus++;
        this.log(`${pl.name} gründet die erste Siedlung auf einer neuen Insel: +${S.settings.islandBonus} Sonderpunkte!`, 'award', pid);
      }
    } else isl.forEach((h) => { pl.claimed[h] = 1; });
  }

  // ---------- Aktionen ----------
  act(pid, a) {
    const S = this.S;
    if (!a || typeof a.type !== 'string') fail('Unbekannte Aktion.');
    const t = a.type;
    if (Object.hasOwn(ANYTIME, t)) return ANYTIME[t](this, pid, a);
    if (S.phase === 'lobby') fail('Das Spiel hat noch nicht begonnen.');
    if (S.phase === 'ended') fail('Das Spiel ist beendet.');
    // Pflichten, die jeder gleichzeitig erledigt
    if (t === 'discard') this.discard(pid, a.cards);
    else if (t === 'gold_pick') this.goldPick(pid, a.cards);
    else if (S.phase === 'setup') this.setupAct(pid, a);
    else this.mainAct(pid, a);
    S.v++;
    this.afterAction();
  }
  afterAction() {
    const S = this.S;
    if (S.trade && !this.isTablePlayer(S.trade.from) && !this.canPay(S.trade.from, S.trade.give)) { // Anbieter hat die Karten inzwischen ausgegeben
      S.trade = null; this.log('Das Angebot wurde automatisch zurückgezogen (Karten nicht mehr vorhanden).', 'trade');
    }
    if (S.phase === 'main') this.checkWin();
    this.settle();
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
    this.pay(pid, c); this.fx('p:' + pid, 'bank', c, false, 'discard');
    delete S.pend.discard[pid];
    this.bump(pid, 'discarded', need);
    this.log(`${this.name(pid)} wirft ${need} Karten ab.`, 'steal', pid);
  }
  goldPick(pid, cards) {
    const S = this.S;
    let need = S.pend.gold[pid];
    if (!need) fail('Du hast gerade keine Gold-Wahl.');
    const total = RES.reduce((a, r) => a + Math.min(99, this.stock(r)), 0);
    if (total < need) need = total; // Bank hat nicht mehr genug
    const c = cleanCards(cards);
    if (sum(c) !== need) fail(need ? `Bitte genau ${need} Rohstoff${need > 1 ? 'e' : ''} wählen.` : 'Die Bank hat keine Rohstoffe mehr.');
    for (const r of RES) if (c[r] && c[r] > this.stock(r)) fail(`Die Bank hat nur noch ${this.stock(r)}× ${RES_DE[r]}.`);
    this.give(pid, c); this.fx('bank', 'p:' + pid, c, true, 'gold');
    delete S.pend.gold[pid];
    this.log(`${this.name(pid)} wählt für Gold: ${fmt(c)}.`, 'info', pid);
    if (S.phase === 'setup') this.setupAdvanceIfReady();
  }

  setupAct(pid, a) {
    const S = this.S, su = S.setup;
    if (su.stage === 'seat') {
      if (a.type !== 'place_seat') fail('Zuerst wählt jeder Spieler seinen Platz am Tisch.');
      return this.placeSeat(pid, a);
    }
    if (su.stage === 'order') {
      if (pid !== S.turn) fail(`${this.name(S.turn)} würfelt gerade um die Reihenfolge.`);
      if (a.type !== 'roll') fail('Zuerst wird die Reihenfolge ausgewürfelt.');
      return this.orderRoll(pid);
    }
    if (!this.noPending()) fail('Zuerst müssen alle ihre Goldwahl treffen.');
    if (pid !== S.turn) fail(`${this.name(S.turn)} ist beim Aufbau an der Reihe.`);
    if (su.stage === 'settlement') {
      if (a.type !== 'place_settlement') fail('Setze zuerst eine Siedlung.');
      if (!this.settlementSpots(pid).includes(a.v)) fail(`Hier darf keine Siedlung stehen (Abstandsregel: mindestens zwei Wege Abstand; Aufbau nur auf der Startinsel${S.settings.goldStart ? '' : ' und nicht an einem Goldfluss'}).`);
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
        const out = this.bankGive(pid, got);
        for (const h of G.vertHexes(a.v)) { const rs = S.hexes[h] && B.TERRAIN_RES[S.hexes[h].t]; if (rs && out[rs] > 0) { out[rs]--; this.fx('h:' + h, 'p:' + pid, { [rs]: 1 }, true, 'setup'); } }
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
    if (S.stats && pid === S.order[0]) S.stats.history.push({ round: S.stats.history.length + 1, vp: S.players.map((q) => this.vp(q.id)) });
    const pl = this.pl(pid);
    if (pl.left && !pl.vanished && S.settings.leaver === 'verschwinden') {
      pl.autoTurns = (pl.autoTurns || 0) + 1;
      if (pl.autoTurns > S.settings.vanishRounds) this.vanish(pid);
    }
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
      case 'roll': if (S.settings.dice === 'auto') fail('In diesem Spiel würfelt der Server automatisch.'); return this.roll(pid);
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
      case 'take_over': this.needRolled(); return this.takeOver(pid, a);
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
    if (S.stats) S.stats.rolls[n] = (S.stats.rolls[n] || 0) + 1;
    if (n === 7) {
      this.bump(pid, 'sevens');
      let any = false;
      const lim = S.settings.handLimit;
      for (const p of S.players) {
        const sz = this.handSize(p.id);
        if (lim !== null && sz > lim) { S.pend.discard[p.id] = Math.floor(sz / 2); any = true; }
      }
      const who = S.settings.robber === 'auto' ? 'wird der Räuber automatisch versetzt' : 'versetzt der Würfler Räuber oder Pirat';
      this.log(any ? `Eine 7! Wer mehr als ${lim} Karten hat, wirft die Hälfte ab. Dann ${who}.` : `Eine 7! Niemand muss abwerfen. ${who[0].toUpperCase() + who.slice(1)}.`, 'roll');
      S.ts.sub = 'robber';
      return;
    }
    this.produce(n);
  }
  produce(n) {
    const S = this.S, got = {}, entries = {};
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
        if (isGold) { S.pend.gold[b.p] = (S.pend.gold[b.p] || 0) + amt; (entries[b.p] = entries[b.p] || []).push({ res: null, amt, desc: `${amt}× freie Wahl (${TERR_DE.gold} ${n})` }); }
        else {
          (got[b.p] = got[b.p] || emptyHand())[res] += amt;
          (entries[b.p] = entries[b.p] || []).push({ res, amt, hex: k, label: `${TERR_DE[h.t]} ${n}${b.k === 'c' ? ', Stadt' : ''}` });
        }
      }
    }
    // Bank-Vorrat: reicht er nicht, bekommt ein einzelner Empfänger den Rest, bei mehreren niemand
    for (const r of RES) {
      const holders = Object.keys(got).filter((p) => got[p][r] > 0);
      const owed = holders.reduce((a, p) => a + got[p][r], 0), st = this.stock(r);
      if (owed <= st) continue;
      if (holders.length === 1) { got[holders[0]][r] = st; this.log(`Die Bank hat nur noch ${st}× ${RES_DE[r]}.`, 'info'); }
      else { holders.forEach((p) => { got[p][r] = 0; }); this.log(`Die Bank hat nicht genug ${RES_DE[r]} für alle (${st} von ${owed}): niemand erhält welches.`, 'info'); }
    }
    for (const p of Object.keys(entries)) {
      const left = got[p] ? { ...got[p] } : {};
      const parts = [];
      for (const e of entries[p]) {
        if (e.res === null) { parts.push(e.desc); continue; }
        const a = Math.min(e.amt, left[e.res] || 0); left[e.res] -= a;
        if (a > 0) { parts.push(`${a}× ${RES_DE[e.res]} (${e.label})`); this.fx('h:' + e.hex, 'p:' + p, { [e.res]: a }, true, 'roll'); }
      }
      if (got[p]) { this.give(+p, got[p]); RES.forEach((r) => this.bump(+p, 'produced', got[p][r], r)); }
      if (parts.length) this.log(`${this.name(+p)} erhält ${parts.join(', ')}.`, 'roll', +p);
    }
    if (!Object.keys(entries).length && !blocked) this.log(`Niemand besitzt ein Feld mit der ${n}.`, 'info');
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
      if (!free) this.payBank(pid, cost);
      S.edges[where] = { p: pid, k: kind, t: S.turnNo };
      this.bump(pid, 'built', 1, kind === 'r' ? 'road' : 'ship');
      this.log(`${this.name(pid)} baut ${kind === 'r' ? 'eine Straße' : 'ein Schiff'}${free ? ' (Straßenbau)' : ''}.`, 'build', pid);
      this.discoverAround(pid, where, true);
      this.updateAwards();
      if (free) { S.ts.rb--; if (S.ts.rb <= 0 || !this.rbPossible(pid)) this.endRoadBuilding(); }
      return;
    }
    if (what === 'settlement') {
      if (L.settlement <= 0) fail('Du hast keine Siedlungen mehr (baue eine zur Stadt aus, dann wird wieder eine frei).');
      if (!this.settlementSpots(pid).includes(where)) fail('Siedlungen brauchen Anschluss an deinen Weg und zwei Wege Abstand zu jedem Gebäude.');
      this.payBank(pid, cost);
      this.placeSettlement(pid, where, false);
      this.bump(pid, 'built', 1, 'settlement');
      this.log(`${this.name(pid)} baut eine Siedlung.`, 'build', pid);
      this.updateAwards();
      return;
    }
    if (what === 'city') {
      if (L.city <= 0) fail('Du hast keine Städte mehr.');
      if (!this.citySpots(pid).includes(where)) fail('Städte werden nur aus eigenen Siedlungen ausgebaut.');
      this.payBank(pid, cost);
      S.verts[where].k = 'c';
      this.bump(pid, 'built', 1, 'city');
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
    delete S.edges[from];
    S.edges[to] = { p: pid, k: 's', t: S.turnNo };
    S.ts.movedShip = true;
    this.log(`${this.name(pid)} versetzt ein Schiff.`, 'build', pid);
    this.discoverAround(pid, to, true);
    this.updateAwards();
  }

  buyDev(pid) {
    const S = this.S;
    if (!this.devLeft()) fail('Der Entwicklungskartenstapel ist leer.');
    if (!this.canPay(pid, COST.dev)) fail(`Dir fehlen Rohstoffe (${fmt(COST.dev)}).`);
    this.payBank(pid, COST.dev);
    const type = this.drawDev();
    this.bump(pid, 'built', 1, 'dev');
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
      const need2 = {}; need2[a.a] = (need2[a.a] || 0) + 1; need2[a.b] = (need2[a.b] || 0) + 1;
      for (const r of Object.keys(need2)) if (need2[r] > this.stock(r)) fail(`Die Bank hat nicht genug ${RES_DE[r]}.`);
    }
    if (type === 'monopol' && !RES.includes(a.res)) fail('Wähle einen Rohstoff.');
    p.dev.splice(p.dev.indexOf(card), 1);
    S.ts.devPlayed = true; S.trade = null;
    S.devShown = { id: (S.devShown ? S.devShown.id : 0) + 1, type, by: pid }; // für die Großanzeige bei allen Spielern
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
      this.give(pid, c); this.fx('bank', 'p:' + pid, c, true, 'dev');
      this.log(`${p.name} spielt Erfindung und nimmt ${RES_DE[a.a]} und ${RES_DE[a.b]} von der Bank.`, 'info', pid);
    } else if (type === 'monopol') {
      let tot = 0;
      for (const q of S.players) if (q.id !== pid) { tot += q.hand[a.res]; this.fx('p:' + q.id, 'p:' + pid, { [a.res]: q.hand[a.res] }, true, 'dev'); p.hand[a.res] += q.hand[a.res]; q.hand[a.res] = 0; }
      this.log(`${p.name} spielt Monopol auf ${RES_DE[a.res]} und erhält ${tot} Karten.`, 'steal', pid);
    }
  }

  // ---------- Räuber / Pirat ----------
  moveRobber(pid, hex) {
    const S = this.S;
    if (!S.hexes[hex] || !this.isLandHex(hex)) fail('Der Räuber kann nur auf ein Landfeld gestellt werden.');
    if (hex === S.robber) fail('Der Räuber muss auf ein anderes Feld ziehen.');
    S.robber = hex;
    this.bump(pid, 'robberMoves');
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
      h[r]--; this.pl(pid).hand[r]++; this.fx('p:' + target, 'p:' + pid, { [r]: 1 }, false, 'steal');
      this.bump(pid, 'stolenBy'); this.bump(target, 'stolenFrom');
      this.log(`${this.name(pid)} stiehlt ${this.name(target)} eine Karte.`, 'steal', pid);
      this.pl(pid).lastStolen = null;
    }
    S.ts.sub = null; S.ts.victims = [];
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
    if (this.pl(pid).auto) return false;
    const h = this.pl(pid).hand, rates = this.ratesFor(pid), L = this.left(pid);
    const spots = { road: this.pathSpots(pid, 'r').length > 0 && L.road > 0, ship: this.pathSpots(pid, 's').length > 0 && L.ship > 0,
      settlement: this.settlementSpots(pid).length > 0 && L.settlement > 0, city: this.citySpots(pid).length > 0 && L.city > 0, dev: this.devLeft() > 0 };
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
    if (S.stats) lens.forEach((l, i) => { if (l > S.stats.players[i].maxRoute) S.stats.players[i].maxRoute = l; });
    const max = Math.max(...lens);
    const cands = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
    let nl = S.longest;
    const LM = S.settings.longestMin;
    if (max < LM) nl = null;
    else if (nl === null || !cands.includes(nl)) nl = cands.length === 1 ? cands[0] : (nl !== null && lens[nl] >= LM && lens[nl] === max ? nl : null);
    if (nl !== S.longest) {
      if (nl !== null) this.log(`${this.name(nl)} hat jetzt den Längsten Handelsweg (${lens[nl]})! +2 Punkte.`, 'award', nl);
      else if (S.longest !== null) this.log('Der Längste Handelsweg ist unterbrochen – niemand hat ihn.', 'award');
      S.longest = nl;
    }
    const k = S.players.map((p) => p.knights), kmax = Math.max(...k);
    let na = S.largest;
    if (kmax >= S.settings.armyMin) {
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
    if (this.vp(pid) + this.hiddenVp(pid) >= S.settings.winPoints) {
      this.finish(pid, 'win');
      this.log(`🏆 ${this.name(pid)} gewinnt mit ${this.vp(pid) + this.hiddenVp(pid)} Siegpunkten!`, 'award', pid);
    }
  }

  stepOf() {
    const S = this.S;
    if (S.phase === 'lobby') return 'lobby';
    if (S.phase === 'ended') return 'ended';
    if (Object.keys(S.pend.discard).length) return 'discard';
    if (Object.keys(S.pend.gold).length) return 'gold';
    if (S.phase === 'setup') return S.setup.stage === 'seat' ? 'setup_seat' : S.setup.stage === 'order' ? 'setup_order' : S.setup.stage === 'settlement' ? 'setup_settlement' : 'setup_road';
    if (S.sbp) return 'sbp';
    if (S.ts.sub) return S.ts.sub;
    return S.ts.rolled ? 'main' : 'roll';
  }
}

// Teilbereiche: Methoden der Klassen in game_*.js an Game hängen
for (const part of [require('./game_lobby'), require('./game_trade'), require('./game_auto'), require('./game_view')]) {
  for (const k of Object.getOwnPropertyNames(part.prototype)) {
    if (k === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Game.prototype, k)) throw new Error('Methode doppelt: ' + k);
    Object.defineProperty(Game.prototype, k, Object.getOwnPropertyDescriptor(part.prototype, k));
  }
}

Game.SEATS = SEATS; Game.COST = COST; Game.COLORS = COLORS; Game.GameError = GameError;
module.exports = Game;
