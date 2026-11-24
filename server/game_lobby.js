'use strict';
// Spiellogik, Teilbereich: Lobby, Spieler, Einstellungen, Spielstart und Spielende.
// Die Methoden werden in game.js an Game.prototype gehängt (this = das Spiel).
const { crypto, B, ST, AV, COLORS, MIN_P, MAX_P, SEATS, SEAT_CLOCK, DEV_MIX, UNLIMITED, fail, emptyHand } = require('./game_common');

class GameLobby {
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
    S.goldRate = set.goldRate;
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
}

module.exports = GameLobby;
