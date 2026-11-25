'use strict';
// Spiellogik, Teilbereich: Sichten: Statistik, erlaubte Ziele, Hinweistexte, Spieler- und Zuschauersicht.
// Die Methoden werden in game.js an Game.prototype gehängt (this = das Spiel).
const { G, B, RES, COST, MIN_P, MAX_P, UNLIMITED } = require('./game_common');

class GameView {
  // Siegpunkte nach Quellen (für den Hinweis an Punktestand und Rangliste); Siegpunktkarten nur, wenn sie sichtbar sein dürfen (eigene, Spielende)
  vpParts(pid, cards) {
    const S = this.S, p = this.pl(pid);
    return { settlements: this.count(pid, 's'), cities: this.count(pid, 'c'), islands: p.svp, islandCount: p.islandBonus || 0, longest: S.longest === pid ? 2 : 0, largest: S.largest === pid ? 2 : 0, cards: cards ? this.hiddenVp(pid) : null };
  }
  statsView() {
    const S = this.S, st = S.stats;
    if (!st || S.phase !== 'ended') return null;
    return {
      durationSec: Math.round(((st.endedAt || Date.now()) - st.startedAt) / 1000), turns: S.turnNo, rounds: st.history.filter((h) => !h.end).length, aborted: S.aborted,
      rolls: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 2), st.rolls[i + 2] || 0])),
      history: st.history,
      players: S.players.map((p) => {
        const x = st.players[p.id];
        return { id: p.id, name: p.name, color: p.color, vp: this.vp(p.id) + this.hiddenVp(p.id), svp: p.svp, vpParts: this.vpParts(p.id, true), built: x.built,
          produced: { ...x.produced, total: RES.reduce((a, r) => a + x.produced[r], 0) }, tradesPlayer: x.tradesPlayer, tradesBank: x.tradesBank,
          stolenFrom: x.stolenFrom, stolenBy: x.stolenBy, discarded: x.discarded, knights: p.knights, maxRoute: x.maxRoute,
          discovered: x.discovered, robberMoves: x.robberMoves, sevens: x.sevens };
      }),
    };
  }

  // ---------- Sicht für einen Spieler ----------
  legal(pid) {
    const S = this.S, L = { settlement: [], city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: [], pirate: [], steal: [], takeover: { edges: [], verts: [] } };
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
    if (!S.sbp) { const m = this.shipMoves(pid); L.shipFrom = m.from; L.shipTo = m.to; if (!ts.movedShip) L.takeover = this.takeoverSpots(pid); }
    return L;
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
      case 'setup_seat': return me ? 'Wo sitzt du?' : `${tn} wählt seinen Platz am Tisch.`;
      case 'setup_order': return me ? 'Würfle um die Reihenfolge – die höchste Augenzahl beginnt.' : `${tn} würfelt um die Reihenfolge.`;
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
  // Sicht eines Spielers; pid = -1 (kein Spieler) ergibt die öffentliche Sicht ohne Hand, Karten und Aktionsmöglichkeiten
  view(pid) {
    const S = this.S, step = this.stepOf();
    const me = this.pl(pid);
    const lens = S.phase === 'main' || S.phase === 'ended' ? (this.updateAwardsView()) : [];
    const turn = S.sbp ? S.sbp.pid : S.turn;
    const v = {
      v: S.v, phase: S.phase, you: pid, host: S.host, minPlayers: MIN_P, maxPlayers: MAX_P, winPoints: S.settings.winPoints,
      gameId: this.meta.id, gameName: this.meta.name, settings: S.settings, closed: S.closed, endedBy: S.endedBy, stats: this.statsView(),
      players: S.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, avatar: p.avatar || null, bot: p.bot || null, seat: p.seat == null ? null : p.seat, tableGuest: !!p.tableGuest, connected: p.connected, auto: !!p.auto, gone: !!p.left, handover: !!p.handover,
        vp: S.phase === 'lobby' ? 0 : this.vp(p.id) + (S.phase === 'ended' ? this.hiddenVp(p.id) : 0), svp: p.svp,
        vpParts: S.phase === 'lobby' ? null : this.vpParts(p.id, S.phase === 'ended' || p.id === pid),
        resCount: this.handSize(p.id), devCount: p.dev.length, knightsPlayed: p.knights, longestRoute: lens[p.id] || 0,
        hasLongest: S.longest === p.id, hasLargest: S.largest === p.id,
        left: S.phase === 'lobby' ? { road: this.lim('road') === Infinity ? UNLIMITED : this.lim('road'), ship: this.lim('ship') === Infinity ? UNLIMITED : this.lim('ship'), settlement: this.lim('settlement') === Infinity ? UNLIMITED : this.lim('settlement'), city: this.lim('city') === Infinity ? UNLIMITED : this.lim('city') } : this.left(p.id),
        ...(S.pend.discard[p.id] ? { discarding: S.pend.discard[p.id] } : {}), ...(S.pend.gold[p.id] ? { pickingGold: S.pend.gold[p.id] } : {}),
      })),
      order: S.order, turn, step, dice: S.dice, diceSeq: S.diceSeq, devShown: S.devShown || null, orderShown: S.orderShown || null, orderRolls: S.setup && S.setup.ord ? S.setup.ord.rolled : null,
      hexes: Object.keys(S.hexes).map((k) => ({ k, t: S.hexes[k].t, n: S.hexes[k].n })),
      fog: B.fog(S),
      harbors: Object.keys(S.harbors).map((e) => {
        const [a, b] = G.edgeHexes(e); const land = this.isLandHex(a) ? a : b;
        return { e, kind: S.harbors[e].kind, land, sea: land === a ? b : a };
      }),
      verts: S.verts, edges: S.edges, robber: S.robber, pirate: S.pirate,
      me: me ? { hand: me.hand, dev: me.dev.map((d) => ({ id: d.id, type: d.type, playable: d.type !== 'siegpunkt' && d.bought < S.turnNo && !S.ts.devPlayed && S.phase === 'main' && !S.sbp && pid === S.turn, fresh: d.bought >= S.turnNo })), hiddenVp: this.hiddenVp(pid) } : { hand: {}, dev: [], hiddenVp: 0 },
      afford: { road: false, ship: false, settlement: false, city: false, dev: false },
      legal: this.legal(pid),
      rates: this.ratesFor(pid),
      trade: S.trade ? { id: S.trade.id, from: S.trade.from, give: S.trade.give, want: S.trade.want, responses: S.trade.responses } : null,
      prompt: this.prompt(pid, step),
      pending: S.pend,
      log: S.log, chat: S.chat, winner: S.winner, fx: this.fxFor(pid),
      bank: { dev: this.devLeft(), stock: Object.fromEntries(RES.map((r) => [r, this.stock(r) === Infinity ? UNLIMITED : this.stock(r)])) }, longestHolder: S.longest, largestHolder: S.largest, sbp: !!S.sbp,
    };
    if (me && (S.phase === 'main' || S.phase === 'ended')) {
      const L = this.left(pid);
      v.afford = { road: L.road > 0 && this.canPay(pid, COST.road), ship: L.ship > 0 && this.canPay(pid, COST.ship), settlement: L.settlement > 0 && this.canPay(pid, COST.settlement), city: L.city > 0 && this.canPay(pid, COST.city), dev: this.devLeft() > 0 && this.canPay(pid, COST.dev) };
    }
    return v;
  }
  // Öffentliche Sicht für Zuschauer (und den Spieltisch als Anzeige): wie view(), aber ohne Hand, Entwicklungskarten, Chat und ohne Aktionsmöglichkeiten.
  // `you` und `host` sind -1: niemand ist „ich“, es gibt keine Spielleiter-Funktionen.
  watchView() {
    const v = this.view(-1);
    v.watch = true; v.host = -1; v.takeable = this.takeable();
    v.chat = [];
    // Plätze am Tisch: ohne feste Sitzordnung (Online-Spiele) reihum im Uhrzeigersinn verteilen
    const WS = { 2: ['b', 't'], 3: ['b', 'tl', 'tr'], 4: ['b', 'l', 't', 'r'], 5: ['b', 'l', 'tl', 'tr', 'r'], 6: ['bl', 'l', 'tl', 'tr', 'r', 'br'] };
    const ord = (v.order && v.order.length ? v.order : v.players.map((p) => p.id)).filter((id) => v.players[id] && !v.players[id].gone);
    if (ord.length && ord.some((id) => !v.players[id].seat)) {
      const slots = WS[Math.max(2, Math.min(6, ord.length))];
      ord.forEach((id, i) => { v.players[id].seat = slots[i] || null; });
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

module.exports = GameView;
