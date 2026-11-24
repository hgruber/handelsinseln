'use strict';
// Spiellogik, Teilbereich: Auto-Modus (abwesende/verlassene Spieler, Auto-Würfeln/-Räuber) und Übernahme verlassener Infrastruktur.
// Die Methoden werden in game.js an Game.prototype gehängt (this = das Spiel).
const { G, RES, SEATS, fail, emptyHand } = require('./game_common');

class GameAuto {
  // ---------- Auto-Modus, automatische Abläufe ----------
  // Führt alles aus, was ohne Menschen erledigt wird: Auto-Würfeln/-Räuber laut Einstellung sowie alle Züge von Auto-Spielern.
  settle() {
    const S = this.S;
    for (let guard = 0; guard < 400; guard++) {
      if (S.phase === 'ended' || S.phase === 'lobby') return;
      let acted = false;
      // offene Pflichten von Auto-Spielern
      for (const k of Object.keys(S.pend.discard)) {
        const q = this.pl(+k);
        if (q.auto) { this.discard(q.id, this.randomCards(q.id, S.pend.discard[k])); acted = true; }
      }
      for (const k of Object.keys(S.pend.gold)) {
        const q = this.pl(+k);
        if (q.auto) { this.autoGold(q.id); acted = true; }
      }
      if (S.phase === 'setup') {
        this.setupAdvanceIfReady();
        if (S.phase === 'setup' && this.noPending() && this.pl(S.turn).auto) { this.autoSetup(S.turn); acted = true; }
        if (acted) continue;
        return;
      }
      if (acted) { S.v++; continue; }
      if (!this.noPending()) return;
      const pid = S.sbp ? S.sbp.pid : S.turn, pl = this.pl(pid), ts = S.ts;
      if (S.sbp) { if (pl.auto) { this.sbpNext(); S.v++; continue; } return; }
      if (!ts.rolled && !ts.sub && (S.settings.dice === 'auto' || pl.auto)) { this.roll(pid); S.v++; continue; }
      if (ts.sub === 'robber' && (S.settings.robber === 'auto' || pl.auto)) { this.autoRobber(pid, pl.auto); S.v++; continue; }
      if (ts.sub === 'steal' && (S.settings.robber === 'auto' || pl.auto)) { this.steal(pid, ts.victims[Math.floor(this.rnd() * ts.victims.length)]); S.v++; continue; }
      if (pl.auto && ts.rolled && !ts.sub) { this.endTurn(pid); S.v++; if (S.phase === 'main') this.checkWin(); continue; }
      return;
    }
  }
  randomCards(pid, n) {
    const h = this.pl(pid).hand, pool = [];
    RES.forEach((r) => { for (let i = 0; i < h[r]; i++) pool.push(r); });
    const out = {};
    for (let i = 0; i < n && pool.length; i++) { const r = pool.splice(Math.floor(this.rnd() * pool.length), 1)[0]; out[r] = (out[r] || 0) + 1; }
    return out;
  }
  autoGold(pid) {
    const need = this.S.pend.gold[pid], c = {};
    let n = 0;
    for (let guard = 0; n < need && guard < 200; guard++) {
      const r = RES[Math.floor(this.rnd() * 5)];
      if ((c[r] || 0) < this.stock(r)) { c[r] = (c[r] || 0) + 1; n++; }
      else if (RES.every((x) => (c[x] || 0) >= this.stock(x))) break;
    }
    if (n < need) { delete this.S.pend.gold[pid]; return; } // Bank leer
    this.goldPick(pid, c);
  }
  // Räuber-Ziel: Auto-Spieler zufällig, sonst sinnvoll (Gegner treffen, eigene Felder schonen)
  autoRobber(pid, randomly) {
    const S = this.S;
    const cands = Object.keys(S.hexes).filter((k) => this.isLandHex(k) && k !== S.robber);
    let best = null, bestScore = -1e9;
    for (const k of cands) {
      let score = this.rnd();
      if (!randomly) {
        const pips = 6 - Math.abs(7 - (S.hexes[k].n || 7)) || 0;
        for (const v of G.hexCorners(k)) {
          const b = S.verts[v];
          if (!b) continue;
          score += (b.p === pid ? -3 : 1 + (this.handSize(b.p) > 0 ? 0.5 : 0)) * (b.k === 'c' ? 2 : 1) * (0.5 + pips / 3);
        }
      }
      if (score > bestScore) { bestScore = score; best = k; }
    }
    this.moveRobber(pid, best);
  }
  autoSetup(pid) {
    const S = this.S, su = S.setup;
    if (su.stage === 'seat') return this.setupAct(pid, { type: 'place_seat', seat: SEATS.find((x) => !S.players.some((p) => p.seat === x)) });
    if (su.stage === 'order') return this.setupAct(pid, { type: 'roll' });
    if (su.stage === 'settlement') {
      const spots = this.settlementSpots(pid);
      this.setupAct(pid, { type: 'place_settlement', v: spots[Math.floor(this.rnd() * spots.length)] });
    } else {
      const opts = [...this.setupPathSpots(pid, 'r').map((e) => ['place_road', e]), ...this.setupPathSpots(pid, 's').map((e) => ['place_ship', e])];
      const [type, e] = opts[Math.floor(this.rnd() * opts.length)];
      this.setupAct(pid, { type, e });
    }
  }
  // Verlassene Spieler: komplette Infrastruktur verschwindet
  vanish(pid) {
    const S = this.S, p = this.pl(pid);
    for (const e of Object.keys(S.edges)) if (S.edges[e].p === pid) delete S.edges[e];
    for (const v of Object.keys(S.verts)) if (S.verts[v].p === pid) delete S.verts[v];
    p.hand = emptyHand(); p.dev = []; p.vanished = true; p.svp = 0; p.knights = 0;
    this.log(`Die Siedlungen, Straßen und Schiffe von ${p.name} sind verschwunden.`, 'award', pid);
    this.updateAwards();
  }
  // Übernehmbare Infrastruktur verlassener Spieler: muss an eigene Teile angrenzen
  takeoverSpots(pid) {
    const S = this.S, out = { edges: [], verts: [] };
    if (S.settings.leaver !== 'uebernahme') return out;
    const gone = new Set(S.players.filter((q) => q.left && !q.vanished).map((q) => q.id));
    if (!gone.size) return out;
    const anchors = new Set();
    for (const v in S.verts) if (S.verts[v].p === pid) anchors.add(v);
    for (const e in S.edges) if (S.edges[e].p === pid) G.edgeVerts(e).forEach((v) => anchors.add(v));
    const L = this.left(pid);
    for (const e in S.edges) {
      const x = S.edges[e];
      if (!gone.has(x.p) || L[x.k === 'r' ? 'road' : 'ship'] <= 0) continue;
      if (G.edgeVerts(e).some((v) => anchors.has(v))) out.edges.push(e);
    }
    for (const v in S.verts) {
      const b = S.verts[v];
      if (!gone.has(b.p) || L[b.k === 'c' ? 'city' : 'settlement'] <= 0) continue;
      if (anchors.has(v)) out.verts.push(v);
    }
    return out;
  }
  takeOver(pid, a) {
    const S = this.S;
    if (S.ts.movedShip) fail('Du hast in diesem Zug schon ein Schiff versetzt oder etwas übernommen.');
    const sp = this.takeoverSpots(pid);
    if (a.kind === 'edge') {
      if (!sp.edges.includes(a.key)) fail('Diesen Weg kannst du nicht übernehmen (er muss an deine Infrastruktur grenzen und einem Verlassenen gehören).');
      const x = S.edges[a.key], from = this.name(x.p);
      x.p = pid; x.t = S.turnNo;
      this.log(`${this.name(pid)} übernimmt ${x.k === 'r' ? 'eine Straße' : 'ein Schiff'} von ${from}.`, 'build', pid);
    } else if (a.kind === 'vert') {
      if (!sp.verts.includes(a.key)) fail('Dieses Gebäude kannst du nicht übernehmen (es muss an deine Infrastruktur grenzen und einem Verlassenen gehören).');
      const b = S.verts[a.key], from = this.name(b.p);
      b.p = pid;
      const pl = this.pl(pid);
      this.islandAt(a.key).forEach((h) => { pl.claimed[h] = 1; });
      this.log(`${this.name(pid)} übernimmt ${b.k === 'c' ? 'eine Stadt' : 'eine Siedlung'} von ${from}.`, 'build', pid);
    } else fail('Unbekannte Übernahme.');
    S.ts.movedShip = true;
    this.updateAwards();
  }
}

module.exports = GameAuto;
