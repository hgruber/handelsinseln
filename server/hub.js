'use strict';
// Verwaltung mehrerer paralleler Spiele („Räume“): Anlegen, Beitreten, Aufräumen, Abwesenheit.
const crypto = require('crypto');
const Game = require('./game');
const { botPlay } = require('./botplay');
const { botAct } = require('./bot');

class Hub {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.counter = 0;
    this.graceMs = opts.graceMs ?? 20000;       // so lange darf ein Spiel ohne verbundenen Menschen weiterleben (Tab neu laden …)
    this.absentMs = opts.absentMs ?? 60000;     // nach so langer Abwesenheit übernimmt der Auto-Modus
    this.lobbyAbsentMs = opts.lobbyAbsentMs ?? 120000;
    this.maxGames = opts.maxGames ?? Infinity;   // Obergrenze gleichzeitiger Spiele
    this.rnd = opts.rnd;
    this.now = opts.now || Date.now;
  }

  newRoom() {
    const id = crypto.randomBytes(4).toString('hex');
    const room = { id, game: new Game({ rnd: this.rnd, meta: { id, name: `Spiel ${++this.counter}` } }), absent: new Map(), emptySince: this.now(), createdAt: this.now() };
    this.rooms.set(id, room);
    return room;
  }
  deleteRoom(id) { this.rooms.delete(id); }

  findByToken(token) {
    if (!token) return null;
    for (const room of this.rooms.values()) {
      const p = room.game.S.players.find((x) => x.token === token);
      if (p) return { room, player: p };
    }
    return null;
  }

  summary(room) {
    const S = room.game.S;
    return {
      id: room.id, name: S.players.length ? `Spiel von ${S.players[S.host] ? S.players[S.host].name : S.players[0].name}` : room.game.meta.name,
      host: S.players[S.host] ? S.players[S.host].name : '', phase: S.phase, closed: S.closed, variant: S.settings.variant,
      plannedPlayers: S.settings.plannedPlayers, maxPlayers: 6,
      players: S.players.filter((p) => !p.left).map((p) => ({ name: p.name, color: p.color, avatar: p.avatar || null, bot: p.bot || null })),
      table: !!S.settings.table,
      joinable: S.phase === 'lobby' && !S.closed && S.players.length < 6 && !S.settings.table,
    };
  }
  list() { return [...this.rooms.values()].map((r) => this.summary(r)); }
  joinable() { return this.list().filter((g) => g.joinable); }

  // Beitritt. Rückgabe {token,pid,game,room}; Fehler als Game.GameError (ggf. mit .games)
  join(b) {
    const found = this.findByToken(b.token);
    if (found) return { token: found.player.token, pid: found.player.id, game: found.room.id, room: found.room };
    let room;
    if (b.game) {
      room = this.rooms.get(String(b.game));
      if (!room) throw new Game.GameError('Dieses Spiel gibt es nicht mehr.');
    } else if (b.create) room = null;
    else {
      const j = this.joinable();
      if (j.length === 1) room = this.rooms.get(j[0].id);
      else if (j.length > 1) { const e = new Game.GameError('Bitte wähle ein Spiel, dem du beitreten möchtest.'); e.games = j; throw e; }
      else room = null;
    }
    const fresh = !room;
    if (fresh) {
      if (this.rooms.size >= this.maxGames) throw new Game.GameError(`Es laufen schon ${this.maxGames} Spiele – bitte warte, bis eines endet, oder tritt einem bei.`);
      room = this.newRoom();
    }
    try {
      const r = room.game.join(b.name, b.color, undefined, b.avatar);
      room.emptySince = this.now();
      return { ...r, game: room.id, room };
    } catch (e) {
      if (fresh) this.deleteRoom(room.id);
      throw e;
    }
  }

  // Verbindung geöffnet/geschlossen (aus dem SSE-Handler)
  connected(room, player) { room.absent.delete(player.token); room.game.setConnected(player.id, true); room.emptySince = null; }
  disconnected(room, player) {
    if (!this.rooms.has(room.id) || !room.game.S.players.includes(player)) return;
    room.absent.set(player.token, this.now());
    room.game.setConnected(player.id, false);
    if (!room.game.S.players.some((p) => !p.left && p.connected)) room.emptySince = this.now();
  }

  // Regelmäßige Pflege. Gibt die Räume zurück, deren Zustand sich geändert hat, und die gelöschten.
  tick() {
    const t = this.now(), changed = new Set(), removed = [];
    for (const room of [...this.rooms.values()]) {
      const g = room.game, S = g.S;
      // Lobby: lange Abwesende verlieren ihren Platz
      if (S.phase === 'lobby') {
        for (const p of S.players.slice()) {
          const since = room.absent.get(p.token);
          if (!p.connected && since !== undefined && t - since > this.lobbyAbsentMs && S.players.length > 1) { g.leave(p.token); room.absent.delete(p.token); changed.add(room); }
        }
      } else if (S.phase !== 'ended') {
        for (const p of S.players) {
          const since = room.absent.get(p.token);
          if (!p.left && !p.connected && !p.auto && since !== undefined && t - since >= this.absentMs) { if (g.setAbsentAuto(p.id, true)) changed.add(room); }
        }
      }
      const connectedHumans = S.players.filter((p) => !p.left && !p.bot && !p.tableGuest && p.connected).length;
      const humans = g.humans().length;
      if (!humans) { this.deleteRoom(room.id); removed.push(room); continue; }
      if (connectedHumans) room.emptySince = null;
      else {
        if (room.emptySince === null) room.emptySince = t;
        if (t - room.emptySince >= (room.graceMs ?? this.graceMs)) { this.deleteRoom(room.id); removed.push(room); }
      }
    }
    return { changed: [...changed], removed };
  }

  // Bots: jeder macht höchstens eine Aktion je Aufruf. Gibt true zurück, wenn sich etwas geändert hat.
  botStep(room) {
    const g = room.game, S = g.S;
    if (S.phase !== 'setup' && S.phase !== 'main') return false;
    let changed = false;
    for (const p of S.players) {
      if (!p.bot || p.left) continue;
      try { if (botPlay(g, p.id, { rnd: this.rnd })) changed = true; } catch (e) {
        if (!(e instanceof Game.GameError)) throw e;
        // Eine abgelehnte Bot-Aktion darf das Spiel nicht blockieren: Notlauf über die Pflichten (Zug beenden o. Ä.)
        console.error(`Bot ${p.name}: Aktion abgelehnt (${e.message})`);
        try { if (botAct(g, p.id, { rnd: this.rnd, minimal: true })) changed = true; } catch (e2) { if (!(e2 instanceof Game.GameError)) throw e2; }
      }
    }
    return changed;
  }

  // ---------- Persistenz ----------
  toJSON() { return { counter: this.counter, rooms: [...this.rooms.values()].map((r) => ({ id: r.id, meta: r.game.meta, S: r.game.S })) }; }
  load(data, loadGraceMs) {
    this.counter = data.counter || 0;
    for (const r of data.rooms || []) {
      if (!r.S || !r.S.settings) continue; // alter Spielstand ohne Einstellungen
      const game = Game.fromJSON(r.S, { rnd: this.rnd, meta: r.meta });
      game.S.players.forEach((p) => { p.connected = !!p.bot || !!p.tableGuest; });
      this.rooms.set(r.id, { id: r.id, game, absent: new Map(game.S.players.filter((p) => !p.bot && !p.tableGuest).map((p) => [p.token, this.now()])), emptySince: this.now(), createdAt: this.now(), graceMs: loadGraceMs });
    }
  }
}

module.exports = { Hub };
