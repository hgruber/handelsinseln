'use strict';
// Kontrollübergabe (Phase 4): Ein Handy, das als Zuschauer zusieht, fragt die Kontrolle über einen Platz am Spieltisch an (Tischspieler oder Bot).
// Die Anfrage trägt eine vierstellige Nummer; der Tisch zeigt sie am Platz, und erst wenn dort bestätigt wird, übernimmt das Handy den Platz.
// Anfragen liegen im Raum (room.handovers), nicht im Spielstand, und verfallen nach HANDOVER_MS (Standard 15 s).
const crypto = require('crypto');
const Game = require('./game');
const { GameError } = Game;

const fail = (m) => { throw new GameError(m); };
const TTL = () => +process.env.HANDOVER_MS || 15000;

const map = (room) => room.handovers || (room.handovers = new Map());

// Ein Zuschauer-Handy fragt einen Platz an. Gibt { code, ttl } zurück; der Aufrufer setzt den Verfallstimer (expire).
function request(room, token, pid, now = Date.now()) {
  const g = room.game, p = g.S.players[pid];
  if (!room.watchers || !room.watchers.has(token)) fail('Nur zusehende Geräte können Kontrolle anfragen.');
  if (!p || !g.takeable().includes(pid)) fail('Diesen Platz kann ein Handy nicht übernehmen.');
  const m = map(room);
  for (const [k, r] of m) if (r.token === token) m.delete(k); // ein Handy, eine Anfrage
  let code; do { code = String(1000 + crypto.randomInt(9000)); } while ([...m.values()].some((r) => r.code === code));
  const req = { pid, code, token, until: now + TTL() };
  const old = m.get(pid);
  m.set(pid, req);
  return { req, replaced: old && old.token !== token ? old : null, ttl: TTL() };
}

// Offene Anfragen für den Tisch (Nummer und Restzeit)
function pending(room, now = Date.now()) {
  const out = [];
  for (const r of map(room).values()) if (r.until > now) out.push({ pid: r.pid, code: r.code, ms: r.until - now });
  return out;
}

// Der Tisch beantwortet die Anfrage für einen Platz. accept: Kontrolle abgeben; sonst ablehnen. Gibt { req, accepted } zurück.
function answer(room, pid, code, accept, now = Date.now()) {
  const m = map(room), r = m.get(pid);
  if (!r || r.until <= now) { m.delete(pid); fail('Es liegt keine Kontrollanfrage vor (sie ist abgelaufen).'); }
  if (String(code) !== r.code) fail('Die Nummer passt nicht zur Anfrage.');
  m.delete(pid);
  if (!accept) return { req: r, accepted: false };
  const g = room.game;
  if (!g.takeable().includes(pid)) fail('Dieser Platz ist nicht mehr übernehmbar.');
  g.handTo(pid, r.token);
  if (pid !== g.S.host && room.absent) room.absent.set(r.token, Date.now()); // das Handy muss sich gleich melden, sonst übernimmt der Auto-Modus
  if (room.watchers) room.watchers.delete(r.token); // aus dem Zuschauer wird der Spieler
  return { req: r, accepted: true };
}

// Das Handy gibt die Kontrolle zurück (Menü „Kontrolle an den Spieltisch“): der Platz ist wieder ein Tischspieler
function handBack(room, pid) {
  const g = room.game, p = g.S.players[pid];
  if (!p || !p.handover) fail('Dieser Platz wird nicht von einem Handy gesteuert.');
  const token = pid === g.S.host ? p.phone : p.token;
  if (room.absent && token) room.absent.delete(token);
  g.handBack(pid);
  return token;
}

// Abgelaufene Anfragen entfernen; Rückgabe: die entfernten
function expire(room, now = Date.now()) {
  const gone = [];
  for (const [k, r] of map(room)) if (r.until <= now) { map(room).delete(k); gone.push(r); }
  return gone;
}

const drop = (room, pid) => map(room).delete(pid);

module.exports = { request, pending, answer, handBack, expire, drop };
