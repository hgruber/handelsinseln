'use strict';
// Spiellogik "Die Handelsinseln" (Grundspiel + Erweiterung). Zustand ist reines JSON (speicherbar).
const crypto = require('crypto');
const G = require('../shared/geom');
const B = require('./board');
const ST = require('./settings');
const AV = require('../shared/avatars');

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
const MIN_P = 2, MAX_P = 6;
// Digitaler Spieltisch: Plätze am Rand (b/t = unten/oben Mitte, l/r = links/rechts Mitte, Ecken: bl, br, tl, tr) und ihre Reihenfolge im Uhrzeigersinn
// Spieltisch: acht Plätze – an den langen Bildschirmseiten (unten/oben) je drei, an den kurzen (links/rechts) einer – und ihre Reihenfolge im Uhrzeigersinn.
// Jeder Tischspieler wählt seinen Platz beim Spielstart.
const SEATS = ['bl', 'b', 'br', 'tl', 't', 'tr', 'l', 'r'];
const SEAT_CLOCK = ['br', 'b', 'bl', 'l', 'tl', 't', 'tr', 'r'];
const DEV_MIX = { ritter: 14, siegpunkt: 5, strassenbau: 2, erfindung: 2, monopol: 2 }; // Mischungsverhältnis
const UNLIMITED = 999; // so zeigt die Sicht unbegrenzte Vorräte an

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
    this.meta = opts.meta || { id: 'lokal', name: 'Spiel' };
    this.S = null;
    this.reset();
  }
  static fromJSON(json, opts) { const g = new Game(opts); g.S = json; return g; }
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

  // ---------- Lobby ----------
  newPlayer(name, color, avatar, bot) {
    return { id: this.S.players.length, name, color, avatar, bot: bot || null, token: bot ? null : crypto.randomBytes(16).toString('hex'), connected: !!bot, hand: emptyHand(), dev: [], claimed: {}, knights: 0, svp: 0, islandBonus: 0, auto: false, left: false, autoTurns: 0, vanished: false };
  }
  // Freier Avatar: der gewünschte, falls gültig und unvergeben, sonst ein zufälliger (Bot-Avatare sind nie wählbar)
  pickAvatar(want) {
    const taken = new Set(this.S.players.map((p) => p.avatar));
    if (AV.HUMAN_IDS.includes(want) && !taken.has(want)) return want;
    const free = AV.HUMAN_IDS.filter((a) => !taken.has(a));
    return free[Math.floor(this.rnd() * free.length)] || AV.HUMAN_IDS[0];
  }
  join(name, color, token, avatar) {
    const S = this.S;
    if (token) {
      const p = S.players.find((x) => x.token === token);
      if (p) return { token, pid: p.id };
    }
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 16) fail('Bitte einen Namen mit 1–16 Zeichen angeben.');
    if (!COLORS.includes(color)) fail('Bitte eine Farbe wählen.');
    if (S.phase !== 'lobby') fail('Das Spiel läuft bereits. Nur angemeldete Spieler können zurückkehren.');
    if (S.closed) fail('Der Spielleiter hat die Plätze als besetzt erklärt.');
    if (S.players.length >= MAX_P) fail('Das Spiel ist voll (maximal 6 Spieler).');
    if (S.players.some((p) => p.color === color)) fail('Diese Farbe ist schon vergeben.');
    if (S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('Dieser Name ist schon vergeben.');
    if (Object.values(AV.BOTS).some((b) => b.name.toLowerCase() === name.toLowerCase())) fail('Dieser Name gehört einem Bot.');
    const p = this.newPlayer(name, color, this.pickAvatar(avatar));
    S.players.push(p);
    this.log(`${name} ist dem Spiel beigetreten.`, 'sys', p.id);
    if (S.players.length > S.settings.plannedPlayers) { S.settings.plannedPlayers = S.players.length; this.regen(); this.log(`Das Spielfeld wurde für ${S.players.length} Spieler neu erzeugt.`, 'sys'); }
    S.v++;
    return { token: p.token, pid: p.id };
  }
  // Spielleiter setzt einen Bot (je Sorte höchstens einer: feste Namen und Avatare)
  addBot(pid, kind) {
    this.hostOnly(pid, 'Bots hinzufügen');
    const S = this.S, B0 = AV.BOTS[kind];
    if (!B0) fail('Diesen Bot gibt es nicht.');
    if (S.closed) fail('Die Plätze sind als besetzt erklärt.');
    if (S.players.length >= MAX_P) fail('Das Spiel ist voll (maximal 6 Spieler).');
    if (S.players.some((p) => p.bot === kind)) fail(`${B0.name} ist schon dabei.`);
    if (S.players.some((p) => p.name.toLowerCase() === B0.name.toLowerCase())) fail('Dieser Name ist schon vergeben.');
    const color = COLORS.find((c) => !S.players.some((p) => p.color === c));
    const p = this.newPlayer(B0.name, color, B0.avatar, kind);
    S.players.push(p);
    this.log(`${p.name} (Bot: ${B0.label}) ist dem Spiel beigetreten.`, 'sys', p.id);
    if (S.players.length > S.settings.plannedPlayers) { S.settings.plannedPlayers = S.players.length; this.regen(); this.log(`Das Spielfeld wurde für ${S.players.length} Spieler neu erzeugt.`, 'sys'); }
    S.v++;
  }
  // Digitaler Spieltisch: Tischspieler werden nur vom Spielleiter angelegt (nur Lobby). Der erste schaltet den Tisch ein, der letzte aus.
  // Beim Spielstart wird jeder Spieler (Spielleiter zuerst, dann in Anlegereihenfolge) nach seinem Platz am Tisch gefragt.
  addTablePlayer(pid, a) {
    this.hostOnly(pid, 'Tischspieler anlegen');
    const S = this.S;
    const name = String((a && a.name) || '').trim().replace(/\s+/g, ' ');
    const color = a && a.color;
    if (name.length < 1 || name.length > 16) fail('Bitte einen Namen mit 1–16 Zeichen angeben.');
    if (!COLORS.includes(color)) fail('Bitte eine Farbe wählen.');
    if (S.closed) fail('Die Plätze sind als besetzt erklärt.');
    if (S.players.length >= MAX_P) fail('Das Spiel ist voll (maximal 6 Spieler).');
    if (S.players.some((p) => p.color === color)) fail('Diese Farbe ist schon vergeben.');
    if (S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('Dieser Name ist schon vergeben.');
    if (Object.values(AV.BOTS).some((b) => b.name.toLowerCase() === name.toLowerCase())) fail('Dieser Name gehört einem Bot.');
    const p = Object.assign(this.newPlayer(name, color, this.pickAvatar(a.avatar)), { token: null, connected: true, tableGuest: true });
    S.players.push(p);
    this.log(`${name} sitzt am Spieltisch.`, 'sys', p.id);
    if (S.players.length > S.settings.plannedPlayers) { S.settings.plannedPlayers = S.players.length; this.regen(); this.log(`Das Spielfeld wurde für ${S.players.length} Spieler neu erzeugt.`, 'sys'); }
    this.syncTable();
    S.v++;
  }
  // Tischspieler: der Spielleiter (er bedient den Tisch) und die am Tisch angelegten Gäste – sobald der Tisch läuft. Online-Spieler und Bots sind keine Tischspieler.
  isTablePlayer(pid) {
    const S = this.S, p = S.players[pid];
    return !!p && !!S.settings.table && !p.phone && (pid === S.host || !!p.tableGuest);
  }
  // Kontrollübergabe (nur Tisch-Partien im Spiel): Plätze, die ein Handy übernehmen kann – Tischspieler und Bots (nicht Online-Spieler, nicht schon übergebene)
  takeable() {
    const S = this.S;
    if (!S.settings.table || (S.phase !== 'setup' && S.phase !== 'main')) return [];
    return S.players.filter((p) => !p.left && !p.phone && !p.handover && (this.isTablePlayer(p.id) || p.bot)).map((p) => p.id);
  }
  // Ein Handy übernimmt den Platz. Der Spielleiter-Platz behält sein Token (der Tisch bleibt Spielleiter), das Handy steuert über `phone`;
  // jeder andere Platz wird zum Online-Spieler mit dem Token des Handys (aus einem Bot wird ein Mensch – er wird nie wieder zum Bot).
  handTo(pid, token) {
    const S = this.S, p = S.players[pid];
    if (pid === S.host) p.phone = token;
    else { p.token = token; p.bot = null; p.tableGuest = false; p.auto = false; p.connected = false; }
    p.handover = true;
    this.log(`${p.name} wird jetzt von einem Handy gesteuert.`, 'sys', pid);
    S.v++;
  }
  // Das Handy gibt die Kontrolle an den Spieltisch zurück: der Platz ist wieder ein Tischspieler (auch wenn er vorher ein Bot war)
  handBack(pid) {
    const S = this.S, p = S.players[pid];
    if (pid === S.host) p.phone = null;
    else { p.token = null; p.tableGuest = true; p.connected = true; p.auto = false; }
    p.handover = false;
    this.log(`${p.name} wird wieder am Spieltisch gesteuert.`, 'sys', pid);
    S.v++;
  }
  // Tisch ein, sobald ein Tischspieler existiert; aus, wenn keiner mehr da ist. Die Plätze werden erst beim Spielstart abgefragt.
  syncTable() {
    const S = this.S;
    S.settings.table = S.players.some((p) => p.tableGuest);
    S.players.forEach((p) => { p.seat = null; });
  }
  removeFromLobby(p) {
    const S = this.S, hostTok = S.players[S.host] && S.players[S.host].token;
    S.players.splice(p.id, 1);
    S.players.forEach((q, i) => { q.id = i; });
    const ni = hostTok ? S.players.findIndex((q) => q.token === hostTok) : -1;
    S.host = ni >= 0 ? ni : Math.max(0, S.players.findIndex((q) => q.connected && !q.bot && !q.tableGuest));
    if (S.host < 0 || S.host >= S.players.length) S.host = 0;
  }
  // Menüpunkt „Spiel verlassen“. Gibt true zurück, wenn der Spieler endgültig weg ist.
  leave(token) {
    const S = this.S;
    const p = S.players.find((x) => x.token === token);
    if (!p) return false;
    if (S.phase === 'lobby') {
      this.removeFromLobby(p);
      this.log(`${p.name} hat die Lobby verlassen.`, 'sys');
    } else {
      p.left = true; p.auto = true; p.connected = false; p.token = null; p.autoTurns = 0;
      this.log(`${p.name} hat das Spiel verlassen${S.phase === 'ended' ? '' : ' – der Auto-Modus spielt für diesen Spieler weiter'}.`, 'sys', p.id);
      if (S.trade && S.trade.from === p.id) S.trade = null;
      this.settle();
    }
    S.v++;
    return true;
  }
  humans() { return this.S.players.filter((p) => !p.left && !p.bot && !p.tableGuest); }
  setConnected(pid, c) {
    const p = this.pl(pid);
    if (p && p.connected !== c) { p.connected = c; if (c && !p.left && p.auto) { p.auto = false; this.log(`${p.name} ist zurück und spielt wieder selbst.`, 'sys', pid); } this.S.v++; }
  }
  // Abwesender Spieler: Auto-Modus ein/aus (Hub ruft das nach Ablauf der Wartezeit)
  setAbsentAuto(pid, on) {
    const p = this.pl(pid);
    if (!p || p.left || p.auto === on) return false;
    p.auto = on;
    this.log(on ? `${p.name} ist abwesend – der Auto-Modus übernimmt vorübergehend.` : `${p.name} spielt wieder selbst.`, 'sys', pid);
    this.S.v++;
    if (on) this.settle();
    return true;
  }

  hostOnly(pid, what) {
    if (pid !== this.S.host) fail(`Nur der Spielleiter kann ${what}.`);
    if (this.S.phase !== 'lobby') fail('Das geht nur vor Spielbeginn.');
  }
  setSettings(pid, patch) {
    const S = this.S;
    if (S.phase !== 'lobby') return this.changeSettings(pid, patch);
    this.hostOnly(pid, 'die Einstellungen ändern');
    let ns;
    try { ns = ST.merge(S.settings, patch); } catch (e) { if (e instanceof ST.SettingsError) fail(e.message); throw e; }
    if (ns.plannedPlayers < S.players.length) ns.plannedPlayers = S.players.length;
    const boardChanged = ns.variant !== S.settings.variant || ns.plannedPlayers !== S.settings.plannedPlayers || ns.dense !== S.settings.dense || ns.goldHome !== S.settings.goldHome || Math.abs((ns.aspect || 0) - (S.settings.aspect || 0)) > 0.12;
    S.settings = ns;
    if (boardChanged) this.regen();
    S.v++;
  }
  // Im laufenden Spiel (und nach Spielende) darf der Spielleiter alles außer dem Spielfeld ändern
  changeSettings(pid, patch) {
    const S = this.S, old = S.settings;
    if (pid !== S.host) fail('Nur der Spielleiter kann die Einstellungen ändern.');
    if (!patch || typeof patch !== 'object') fail('Ungültige Einstellungen.');
    if (['variant', 'plannedPlayers', 'dense', 'aspect', 'goldHome'].some((k) => k in patch)) fail('Das Spielfeld lässt sich im Spiel nicht mehr ändern.');
    let ns;
    try { ns = ST.merge(old, patch); } catch (e) { if (e instanceof ST.SettingsError) fail(e.message); throw e; }
    if (S.phase !== 'ended' && ns.winPoints !== old.winPoints) {
      const top = Math.max(...S.players.filter((p) => !p.left).map((p) => this.vp(p.id) + this.hiddenVp(p.id)));
      if (ns.winPoints <= top) fail(`Das Siegpunktziel muss über dem höchsten Stand (${top}) liegen.`);
    }
    S.settings = ns;
    // Vorräte der laufenden Partie an die neuen Grenzen anpassen
    for (const [lk, sk] of [['fogTerrain', 'terrain'], ['fogChips', 'chips']]) {
      for (const x of Object.keys(ns.limits[lk])) {
        const a = old.limits[lk][x], b = ns.limits[lk][x];
        if (a === b || !S.supply) continue;
        S.supply[sk][x] = b === null ? null : a === null ? b : Math.max(0, (S.supply[sk][x] || 0) + b - a);
      }
    }
    if (old.limits.dev !== ns.limits.dev && S.stats) {
      const drawn = S.stats.players.reduce((a, p) => a + (p.built.dev || 0), 0);
      this.buildDeck(S.players.length);
      if (!S.deckUnlimited) S.deck = S.deck.slice(0, Math.max(0, S.deck.length - drawn));
    }
    const msg = 'Der Spielleiter hat die Spieleinstellungen geändert.';
    const last = S.log[S.log.length - 1];
    if (!last || last.text !== msg) this.log(msg, 'sys');
    S.v++; if (S.phase !== 'ended') this.settle();
  }
  kick(pid, target) {
    this.hostOnly(pid, 'Spieler entfernen');
    const t = this.S.players[target];
    if (!t) fail('Diesen Spieler gibt es nicht.');
    if (target === pid) fail('Du kannst dich nicht selbst entfernen (nutze „Spiel verlassen“).');
    const tok = t.token;
    this.removeFromLobby(t);
    this.syncTable();
    this.log(`${t.name} wurde vom Spielleiter entfernt.`, 'sys');
    this.S.v++;
    return tok;
  }

  // Vorrat an Entwicklungskarten nach Einstellung
  buildDeck(n) {
    const S = this.S, d = S.settings.limits.dev;
    S.deckUnlimited = false; S.deck = [];
    const mk = (t, c) => { for (let i = 0; i < c; i++) S.deck.push(t); };
    if (d === 'standard') {
      if (n >= 5) { mk('ritter', 20); mk('siegpunkt', 5); mk('strassenbau', 3); mk('erfindung', 3); mk('monopol', 3); }
      else { mk('ritter', 14); mk('siegpunkt', 5); mk('strassenbau', 2); mk('erfindung', 2); mk('monopol', 2); }
    } else if (d === null) S.deckUnlimited = true;
    else {
      const tot = 25, keys = Object.keys(DEV_MIX);
      const raw = keys.map((k) => ({ k, x: (d * DEV_MIX[k]) / tot }));
      raw.forEach((r) => { r.c = Math.floor(r.x); });
      let rest = d - raw.reduce((a, r) => a + r.c, 0);
      raw.sort((a, b) => (b.x - b.c) - (a.x - a.c));
      for (let i = 0; rest > 0; i = (i + 1) % raw.length, rest--) raw[i].c++;
      raw.forEach((r) => mk(r.k, r.c));
    }
    S.deck = B.shuffle(S.deck, this.rnd);
  }
  drawDev() {
    const S = this.S;
    if (S.deckUnlimited) { const keys = Object.keys(DEV_MIX); let x = this.rnd() * 25; for (const k of keys) { x -= DEV_MIX[k]; if (x <= 0) return k; } return 'ritter'; }
    return S.deck.pop();
  }
  devLeft() { return this.S.deckUnlimited ? UNLIMITED : this.S.deck.length; }

  start(pid) {
    const S = this.S;
    if (S.phase !== 'lobby') fail('Das Spiel läuft bereits.');
    if (pid !== S.host) fail('Nur der Spielleiter kann das Spiel starten.');
    if (S.players.length < MIN_P) fail(`Es braucht mindestens ${MIN_P} Spieler.`);
    const n = S.players.length, set = S.settings;
    // Vorrat für aufgedeckte Felder (Nebel)
    S.supply = { terrain: { ...set.limits.fogTerrain }, chips: { ...set.limits.fogChips } };
    S.fogGold = set.variant === 'nebel' ? 1.3 : set.variant === 'archipel' ? 1.6 : 1;
    this.buildDeck(n);
    // Am Spieltisch bestimmt die Sitzordnung (im Uhrzeigersinn) die Reihenfolge; Würfeln legt nur fest, wer beginnt
    S.order = B.shuffle([...Array(n).keys()], this.rnd);
    S.phase = 'setup'; S.dice = null;
    S.stats = { startedAt: Date.now(), endedAt: null, rolls: {}, history: [], players: S.players.map(() => ({ built: { road: 0, ship: 0, settlement: 0, city: 0, dev: 0 }, produced: { holz: 0, lehm: 0, wolle: 0, getreide: 0, erz: 0 }, tradesPlayer: 0, tradesBank: 0, stolenFrom: 0, stolenBy: 0, discarded: 0, robberMoves: 0, sevens: 0, discovered: 0, maxRoute: 0 })) };
    this.log(`Das Spiel beginnt! Erster mit ${set.winPoints} Punkten gewinnt.`, 'sys');
    this.log('Aufbau: Jeder setzt zwei Siedlungen samt Straße oder Schiff (die zweite in umgekehrter Reihenfolge) und erhält dafür Startrohstoffe.', 'sys');
    if (set.table) { // Spieltisch: erst wählt jeder Spieler seinen Platz (Spielleiter zuerst), danach steht die Reihenfolge fest
      const ask = [S.host, ...S.players.map((p) => p.id).filter((i) => i !== S.host && this.isTablePlayer(i))]; // nur Tischspieler wählen selbst; Online-Spieler und Bots bekommen einen freien Platz
      S.order = ask.slice();
      S.players.forEach((p) => { p.seat = null; });
      S.setup = { seq: null, i: 0, stage: 'seat', last: null, ask, askIdx: 0 };
      S.turn = ask[0];
      this.log('Am Spieltisch wählt jetzt jeder Tischspieler seinen Platz.', 'sys');
    } else if (set.dice === 'auto') this.orderDone();
    else {
      // manueller Ablauf: die Reihenfolge wird ausgewürfelt (Gleichstände würfeln unter sich neu)
      S.setup = { seq: null, i: 0, stage: 'order', last: null, ord: { table: !!set.table, groups: [S.order.slice()], cur: S.order.slice(), rolled: {}, idx: 0 } };
      S.turn = S.order[0];
      this.log(set.table ? 'Es wird gewürfelt, wer beginnt: Die höchste Augenzahl fängt an, danach geht es im Uhrzeigersinn weiter.' : 'Die Reihenfolge wird ausgewürfelt: Wer die höchste Augenzahl wirft, beginnt.', 'sys');
    }
    S.v++;
    this.settle();
  }
  // Spieltisch: alle sitzen – die Reihenfolge ergibt sich aus den Plätzen im Uhrzeigersinn, gewürfelt wird nur, wer beginnt
  afterSeating() {
    const S = this.S, set = S.settings, n = S.players.length;
    // Online-Spieler und Bots sitzen auf den noch freien Plätzen (Reihenfolge der Plätze: unten, oben, links, rechts, dann die Ecken)
    const free = ['b', 't', 'l', 'r', 'bl', 'br', 'tl', 'tr'].filter((x) => !S.players.some((p) => p.seat === x));
    S.players.filter((p) => !p.seat).forEach((p) => { p.seat = free.shift(); this.log(`${p.name} sitzt am Tisch.`, 'sys', p.id); });
    S.order = S.players.map((p) => p.id).sort((x, y) => SEAT_CLOCK.indexOf(S.players[x].seat) - SEAT_CLOCK.indexOf(S.players[y].seat));
    if (set.dice === 'auto') { this.startWith(S.order[Math.floor(this.rnd() * n)]); this.orderDone(); return; }
    S.setup = { seq: null, i: 0, stage: 'order', last: null, ord: { table: true, groups: [S.order.slice()], cur: S.order.slice(), rolled: {}, idx: 0 } };
    S.turn = S.order[0];
    this.log('Es wird gewürfelt, wer beginnt: Die höchste Augenzahl fängt an, danach geht es im Uhrzeigersinn weiter.', 'sys');
  }
  // Platzwahl am Tisch: der Spieler, der gefragt wird, setzt sich auf einen freien Platz
  placeSeat(pid, a) {
    const S = this.S, su = S.setup;
    if (pid !== S.turn) fail(`${this.name(S.turn)} wählt gerade seinen Platz.`);
    if (!SEATS.includes(a.seat)) fail('Bitte einen Platz am Tisch wählen.');
    const taken = S.players.find((p) => p.seat === a.seat);
    if (taken) fail(`Dieser Platz ist schon von ${taken.name} besetzt.`);
    this.pl(pid).seat = a.seat;
    this.log(`${this.name(pid)} sitzt am Tisch.`, 'sys', pid);
    su.askIdx++;
    if (su.askIdx < su.ask.length) S.turn = su.ask[su.askIdx];
    else this.afterSeating();
  }
  // Reihenfolge steht fest: allen anzeigen und mit dem Aufbau beginnen
  orderDone() {
    const S = this.S;
    const seq = [...S.order, ...S.order.slice().reverse()];
    S.setup = { seq, i: 0, stage: 'settlement', last: null };
    S.turn = seq[0];
    S.orderSeq = (S.orderSeq || 0) + 1; S.orderShown = { id: S.orderSeq, order: S.order.slice() };
    this.log(`Reihenfolge: ${S.order.map((i) => this.name(i)).join(' → ')}.`, 'sys');
  }
  // Spieltisch: die Sitzordnung so drehen, dass `first` beginnt
  startWith(first) {
    const S = this.S, i = S.order.indexOf(first);
    S.order = S.order.slice(i).concat(S.order.slice(0, i));
  }
  orderRoll(pid) {
    const S = this.S, o = S.setup.ord;
    const a = 1 + Math.floor(this.rnd() * 6), b = 1 + Math.floor(this.rnd() * 6);
    S.dice = [a, b]; S.diceSeq++;
    o.rolled[pid] = a + b; o.idx++;
    this.log(`${this.name(pid)} würfelt ${a + b} (${a}+${b}) um die Reihenfolge.`, 'roll', pid);
    if (o.idx < o.cur.length) { S.turn = o.cur[o.idx]; return; }
    if (o.table) { // Spieltisch: nur der Beginner wird ermittelt, Gleichstand der Höchsten würfelt neu
      const top = Math.max(...o.cur.map((p) => o.rolled[p])), best = o.cur.filter((p) => o.rolled[p] === top);
      if (best.length > 1) { o.cur = best; o.rolled = {}; o.idx = 0; S.turn = o.cur[0]; this.log(`Gleichstand zwischen ${best.map((p) => this.name(p)).join(', ')} – sie würfeln noch einmal.`, 'sys'); return; }
      this.startWith(best[0]); this.orderDone(); return;
    }
    // Runde vollständig: Gruppe nach Augenzahl aufteilen
    const byVal = {}; o.cur.forEach((p) => { (byVal[o.rolled[p]] = byVal[o.rolled[p]] || []).push(p); });
    const parts = Object.keys(byVal).map(Number).sort((x, y) => y - x).map((k) => byVal[k]);
    const gi = o.groups.findIndex((g) => g === o.cur || (g.length === o.cur.length && g.every((p) => o.cur.includes(p))));
    o.groups.splice(gi, 1, ...parts);
    const next = o.groups.find((g) => g.length > 1);
    if (!next) { S.order = o.groups.flat(); this.orderDone(); return; }
    o.cur = next.slice(); o.rolled = {}; o.idx = 0; S.turn = o.cur[0];
    this.log(`Gleichstand zwischen ${o.cur.map((p) => this.name(p)).join(', ')} – sie würfeln noch einmal.`, 'sys');
  }

  endGame(pid) {
    const S = this.S;
    if (pid !== S.host) fail('Nur der Spielleiter kann das Spiel beenden.');
    if (S.phase !== 'setup' && S.phase !== 'main') fail('Das Spiel läuft nicht.');
    this.finish(null, 'host');
    this.log('Der Spielleiter hat das Spiel beendet.', 'sys');
  }
  finish(winner, by) {
    const S = this.S;
    S.endedFrom = S.phase; S.phase = 'ended'; S.winner = winner; S.endedBy = by; S.aborted = by === 'host'; S.trade = null;
    if (S.stats) S.stats.endedAt = Date.now();
  }

  // Zurück ins laufende Spiel: mit neuem Siegpunktziel (winPoints) weiterspielen
  resumeGame(pid, winPoints) {
    const S = this.S;
    if (pid !== S.host) fail('Nur der Spielleiter kann das Spiel fortsetzen.');
    if (S.phase !== 'ended') fail('Das Spiel ist noch nicht beendet.');
    let wp; try { wp = ST.merge(S.settings, { winPoints }).winPoints; } catch (e) { if (e instanceof ST.SettingsError) fail(e.message); throw e; }
    const top = Math.max(...S.players.filter((p) => !p.left).map((p) => this.vp(p.id) + this.hiddenVp(p.id)));
    if (wp <= top) fail(`Das neue Siegpunktziel muss über dem höchsten Stand (${top}) liegen.`);
    S.settings.winPoints = wp;
    S.phase = S.endedFrom || 'main'; S.winner = null; S.endedBy = null; S.aborted = false;
    if (S.stats) S.stats.endedAt = null;
    this.log(`Das Spiel geht weiter – neues Siegpunktziel: ${wp}.`, 'sys');
    S.v++; this.settle();
  }

  newGame(pid) {
    if (pid !== this.S.host) fail('Nur der Spielleiter kann ein neues Spiel beginnen.');
    if (this.S.phase !== 'ended') fail('Das Spiel ist noch nicht beendet.');
    // Verlassene Spieler bleiben draußen
    const hostTok = this.S.players[this.S.host].token;
    this.S.players = this.S.players.filter((p) => !p.left);
    this.S.host = Math.max(0, this.S.players.findIndex((p) => p.token === hostTok));
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
    if (t === 'chat') return this.chat(pid, a.text);
    if (t === 'start') return this.start(pid);
    if (t === 'new_game') return this.newGame(pid);
    if (t === 'resume_game') return this.resumeGame(pid, a.winPoints);
    if (t === 'set_settings') return this.setSettings(pid, a.settings);
    if (t === 'regen_board') { this.hostOnly(pid, 'das Spielfeld neu würfeln'); this.regen(); this.S.v++; return; }
    if (t === 'close_seats') { this.hostOnly(pid, 'die Plätze schließen'); this.S.closed = !!a.closed; this.log(this.S.closed ? 'Die Plätze sind besetzt – niemand kann mehr beitreten.' : 'Die Plätze sind wieder offen.', 'sys'); this.S.v++; return; }
    if (t === 'add_bot') return this.addBot(pid, a.kind);
    if (t === 'add_table_player') return this.addTablePlayer(pid, a);
    if (t === 'kick') { this.lastKicked = this.kick(pid, a.pid); return; }
    if (t === 'end_game') return this.endGame(pid);
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
    // Ertragsgrenze Goldfluss: je Spieler und Wurf höchstens `goldMax` freie Wahlen
    const gmax = S.settings.goldMax || 6;
    for (const p of Object.keys(S.pend.gold)) {
      if (S.pend.gold[p] <= gmax) continue;
      const cut = S.pend.gold[p] - gmax;
      S.pend.gold[p] = gmax;
      const g = entries[p].filter((e) => e.res === null);
      if (g.length) g[g.length - 1].desc += ` – begrenzt auf ${gmax} je Wurf (−${cut})`;
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
    const x = S.edges[from]; delete S.edges[from];
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

  // ---------- Handel ----------
  bankTrade(pid, a) {
    if (!RES.includes(a.give) || !RES.includes(a.get)) fail('Wähle zwei Rohstoffe.');
    if (a.give === a.get) fail('Gleiche Rohstoffe lassen sich nicht tauschen.');
    const times = a.n === undefined ? 1 : a.n;
    if (!Number.isInteger(times) || times < 1 || times > 20) fail('Ungültige Anzahl.');
    const rate = this.ratesFor(pid)[a.give];
    if (this.pl(pid).hand[a.give] < rate * times) fail(`Für diesen Tausch brauchst du ${rate * times}× ${RES_DE[a.give]} (Kurs ${rate}:1).`);
    if (this.stock(a.get) < times) fail(`Die Bank hat nur noch ${this.stock(a.get)}× ${RES_DE[a.get]}.`);
    this.bump(pid, 'tradesBank');
    this.pl(pid).hand[a.give] -= rate * times; this.pl(pid).hand[a.get] += times;
    this.fx('p:' + pid, 'bank', { [a.give]: rate * times }, true, 'bank'); this.fx('bank', 'p:' + pid, { [a.get]: times }, true, 'bank');
    this.log(`${this.name(pid)} tauscht mit der Bank ${rate * times}× ${RES_DE[a.give]} gegen ${times}× ${RES_DE[a.get]} (${rate}:1).`, 'trade', pid);
  }
  tradeOffer(pid, a) {
    const S = this.S;
    if (S.sbp) fail('In der Sonderbauphase ist kein Handel mit Spielern erlaubt.');
    if (!S.settings.playerTrade) fail('In diesem Spiel ist nur der Handel mit der Bank erlaubt.');
    const give = cleanCards(a.give), want = cleanCards(a.want);
    if (!sum(give) || !sum(want)) fail('Ein Angebot braucht Karten auf beiden Seiten.');
    if (RES.some((r) => give[r] && want[r])) fail('Gib nicht dieselbe Ressource, die du verlangst.');
    if (!this.isTablePlayer(pid) && !this.canPay(pid, give)) fail('Du besitzt diese Karten nicht.');
    S.trade = { id: ++S.tradeSeq, from: pid, give, want, responses: {} };
    this.log(`${this.name(pid)} bietet ${fmt(give)} gegen ${fmt(want)}.`, 'trade', pid);
    // Auto-Spieler nehmen jedes 1:1-Angebot an, wenn sie die verlangte Karte besitzen
    if (sum(give) === 1 && sum(want) === 1) {
      for (const q of S.players) if (q.id !== pid && q.auto && this.canPay(q.id, want)) { S.trade.responses[q.id] = { s: 'accept' }; this.log(`${q.name} (Auto) nimmt das 1:1-Angebot an.`, 'trade', q.id); }
    }
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
    this.fx('p:' + pid, 'p:' + a.with, give, true, 'trade'); this.fx('p:' + a.with, 'p:' + pid, want, true, 'trade');
    this.bump(pid, 'tradesPlayer'); this.bump(a.with, 'tradesPlayer');
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
  statsView() {
    const S = this.S, st = S.stats;
    if (!st || S.phase !== 'ended') return null;
    return {
      durationSec: Math.round(((st.endedAt || Date.now()) - st.startedAt) / 1000), turns: S.turnNo, aborted: S.aborted,
      rolls: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 2), st.rolls[i + 2] || 0])),
      history: st.history,
      players: S.players.map((p) => {
        const x = st.players[p.id];
        return { id: p.id, name: p.name, color: p.color, vp: this.vp(p.id) + this.hiddenVp(p.id), svp: p.svp, built: x.built,
          produced: { ...x.produced, total: RES.reduce((a, r) => a + x.produced[r], 0) }, tradesPlayer: x.tradesPlayer, tradesBank: x.tradesBank,
          stolenFrom: x.stolenFrom, stolenBy: x.stolenBy, discarded: x.discarded, knights: p.knights, maxRoute: x.maxRoute,
          discovered: x.discovered, robberMoves: x.robberMoves, sevens: x.sevens };
      }),
    };
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
      me: { hand: me.hand, dev: me.dev.map((d) => ({ id: d.id, type: d.type, playable: d.type !== 'siegpunkt' && d.bought < S.turnNo && !S.ts.devPlayed && S.phase === 'main' && !S.sbp && pid === S.turn, fresh: d.bought >= S.turnNo })), hiddenVp: this.hiddenVp(pid) },
      afford: { road: false, ship: false, settlement: false, city: false, dev: false },
      legal: this.legal(pid),
      rates: this.ratesFor(pid),
      trade: S.trade ? { id: S.trade.id, from: S.trade.from, give: S.trade.give, want: S.trade.want, responses: S.trade.responses } : null,
      prompt: this.prompt(pid, step),
      pending: S.pend,
      log: S.log, chat: S.chat, winner: S.winner, fx: this.fxFor(pid),
      bank: { dev: this.devLeft(), stock: Object.fromEntries(RES.map((r) => [r, this.stock(r) === Infinity ? UNLIMITED : this.stock(r)])) }, longestHolder: S.longest, largestHolder: S.largest, sbp: !!S.sbp,
    };
    if (S.phase === 'main' || S.phase === 'ended') {
      const L = this.left(pid);
      v.afford = { road: L.road > 0 && this.canPay(pid, COST.road), ship: L.ship > 0 && this.canPay(pid, COST.ship), settlement: L.settlement > 0 && this.canPay(pid, COST.settlement), city: L.city > 0 && this.canPay(pid, COST.city), dev: this.devLeft() > 0 && this.canPay(pid, COST.dev) };
    }
    return v;
  }
  // Öffentliche Sicht für Zuschauer (und den Spieltisch als Anzeige): wie view(), aber ohne Hand, Entwicklungskarten, Chat und ohne Aktionsmöglichkeiten.
  // `you` und `host` sind -1: niemand ist „ich“, es gibt keine Spielleiter-Funktionen.
  watchView() {
    const S = this.S;
    const v = this.view(S.players[S.host] ? S.host : 0); // Platzhalter für die Berechnung, alles Persönliche wird unten ersetzt
    v.watch = true; v.host = -1; v.you = -1; v.takeable = this.takeable();
    v.me = { hand: {}, dev: [], hiddenVp: 0 };
    v.afford = { road: false, ship: false, settlement: false, city: false, dev: false };
    v.legal = this.legal(-1);
    v.rates = this.ratesFor(-1);
    v.prompt = this.prompt(-1, this.stepOf());
    v.fx = this.fxFor(-1);
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

Game.SEATS = SEATS; Game.COST = COST; Game.COLORS = COLORS; Game.GameError = GameError;
module.exports = Game;
