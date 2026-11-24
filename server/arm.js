'use strict';
// Controller-Ansicht (Phase 2): Ein Spieler „schärft“ am Handy eine Aktion am Spielfeld (arm), die Tisch-Anzeige (Zuschauer) zeigt die Ziele,
// dort tippt jemand ein Ziel (pick), und erst die Bestätigung am Handy (confirm) führt die Aktion aus. So kann niemand sonst – weder Fremde
// noch Mitspieler – für den Spieler am Zug handeln. Der Zustand gehört zum Raum (room.arm), nicht zum Spielstand, und wird nicht gespeichert.
const Game = require('./game');
const G = require('../shared/geom');
const { GameError } = Game;

const fail = (m) => { throw new GameError(m); };
const MODES = ['settlement', 'city', 'road', 'ship', 'takeover', 'move']; // freie Bauaktionen im Hauptspiel
const FORCED = ['setup_settlement', 'setup_road', 'road_building', 'robber']; // Pflichtschritte: Modus ergibt sich aus dem Schritt
const TERR_DE = { wald: 'Wald', huegel: 'Hügel', weide: 'Weide', acker: 'Acker', gebirge: 'Gebirge', wueste: 'Wüste', gold: 'Goldfluss', meer: 'Meer' };
const LABEL = { settlement: 'Siedlung', city: 'Stadt', road: 'Straße', ship: 'Schiff', moveto: 'Schiff hierhin versetzen', takeover: 'Übernahme', robber: 'Räuber', pirate: 'Pirat' };

const actorOf = (g) => (g.S.sbp ? g.S.sbp.pid : g.S.turn);
const sigOf = (g) => `${g.S.phase}:${g.stepOf()}:${actorOf(g)}:${g.S.turnNo}`;

// Mögliche Ziele für den Spieler am Zug (wie die Klickziele im Browser). t: 'v' Ecke, 'e' Kante, 'h' Feld, 'sf' Schiff zum Versetzen
function targets(g, pid, mode, moveFrom) {
  const S = g.S, step = g.stepOf(), T = new Map();
  if (actorOf(g) !== pid) return [];
  const add = (t, k, kind) => { const id = t + ':' + k; const x = T.get(id) || { t, k, kinds: [] }; if (!x.kinds.includes(kind)) x.kinds.push(kind); T.set(id, x); };
  const Lg = g.legal(pid);
  if (step === 'setup_settlement') (Lg.settlement || []).forEach((k) => add('v', k, 'settlement'));
  else if (step === 'setup_road' || step === 'road_building') { (Lg.road || []).forEach((k) => add('e', k, 'road')); (Lg.ship || []).forEach((k) => add('e', k, 'ship')); }
  else if (step === 'robber') { if (S.settings.robber === 'auto') return []; (Lg.robber || []).forEach((k) => add('h', k, 'robber')); (Lg.pirate || []).forEach((k) => add('h', k, 'pirate')); }
  else if (step === 'main' || step === 'sbp') {
    if (moveFrom) { add('sf', moveFrom, 'sel'); ((Lg.shipTo || {})[moveFrom] || []).forEach((k) => add('e', k, 'moveto')); }
    else if (mode === 'takeover') { const t = Lg.takeover || {}; (t.edges || []).forEach((k) => add('e', k, 'takeover')); (t.verts || []).forEach((k) => add('v', k, 'takeover')); }
    else if (mode === 'settlement') (Lg.settlement || []).forEach((k) => add('v', k, 'settlement'));
    else if (mode === 'city') (Lg.city || []).forEach((k) => add('v', k, 'city'));
    else if (mode === 'road') (Lg.road || []).forEach((k) => add('e', k, 'road'));
    else if (mode === 'ship') (Lg.ship || []).forEach((k) => add('e', k, 'ship'));
    else if (mode === 'move') (Lg.shipFrom || []).forEach((k) => add('sf', k, 'pick'));
  }
  return [...T.values()];
}

// Aus einem gewählten Ziel die Spielaktion machen (wie im Browser)
function actionOf(g, arm, pick) {
  const step = g.stepOf(), { t, k, kind } = pick;
  if (kind === 'takeover') return { type: 'take_over', kind: t === 'e' ? 'edge' : 'vert', key: k };
  if (t === 'v') return { type: kind === 'city' ? 'build_city' : step === 'setup_settlement' ? 'place_settlement' : 'build_settlement', v: k };
  if (t === 'e') {
    if (kind === 'moveto') return { type: 'move_ship', from: arm.moveFrom, to: k };
    const setup = step === 'setup_road';
    return { type: kind === 'road' ? (setup ? 'place_road' : 'build_road') : (setup ? 'place_ship' : 'build_ship'), e: k };
  }
  if (t === 'h') return { type: kind === 'robber' ? 'move_robber' : 'move_pirate', hex: k };
  fail('Unbekanntes Ziel.');
}

// Beschreibung für die Rückfrage am Handy: was wird wo gebaut (angrenzende Felder)
function describe(g, pick) {
  const S = g.S, { t, k, kind } = pick;
  const hexes = t === 'v' ? G.vertHexes(k) : t === 'e' ? [...new Set(G.edgeVerts(k).flatMap((v) => G.vertHexes(v)))] : [k];
  const where = hexes.map((h) => S.hexes[h]).filter((x) => x && x.t !== 'meer').map((x) => TERR_DE[x.t] + (x.n ? ' ' + x.n : ''));
  const sea = hexes.some((h) => S.hexes[h] && S.hexes[h].t === 'meer');
  if (t === 'h') { const x = S.hexes[k]; return { label: LABEL[kind], where: x ? TERR_DE[x.t] + (x.n ? ' ' + x.n : '') : '' }; }
  return { label: LABEL[kind] || '', where: where.join(' · ') + (sea && where.length ? ' · Küste' : '') };
}

const current = (room) => {
  const a = room.arm;
  if (!a) return null;
  const g = room.game;
  if (a.sig !== sigOf(g) || (g.S.phase !== 'setup' && g.S.phase !== 'main')) { room.arm = null; return null; }
  return a;
};

// Spieler schärft eine Aktion: mode nur im Hauptspiel nötig
function arm(room, pid, mode) {
  const g = room.game, S = g.S;
  if (S.phase !== 'setup' && S.phase !== 'main') fail('Das Spiel läuft nicht.');
  if (actorOf(g) !== pid) fail('Du bist nicht am Zug.');
  const step = g.stepOf(), forced = FORCED.includes(step);
  if (!forced && step !== 'main' && step !== 'sbp') fail('Jetzt kannst du nichts auf dem Spielfeld wählen.');
  if (!forced && !MODES.includes(mode)) fail('Unbekannte Aktion.');
  const a = { pid, mode: forced ? null : mode, moveFrom: null, pick: null, sig: sigOf(g) };
  if (!targets(g, pid, a.mode, a.moveFrom).length) fail('Hier ist gerade nichts möglich.');
  room.arm = a;
  return a;
}
const disarm = (room, pid) => { const a = current(room); if (a && a.pid === pid) room.arm = null; };
const cancelPick = (room, pid) => { const a = current(room); if (a && a.pid === pid) a.pick = null; };

// Jemand tippt am Tisch ein Ziel an
function pick(room, t, k, kind) {
  const a = current(room);
  if (!a) fail('Am Handy ist gerade nichts zum Wählen freigegeben.');
  const g = room.game, ts = targets(g, a.pid, a.mode, a.moveFrom);
  const x = ts.find((y) => y.t === t && y.k === k && y.kinds.includes(kind));
  if (!x) fail('Dieses Ziel ist nicht wählbar.');
  if (t === 'sf') { a.moveFrom = a.moveFrom === k ? null : k; a.pick = null; return a; } // Schiff auswählen: noch keine Aktion
  a.pick = { t, k, kind };
  return a;
}

// Der Spieler bestätigt am Handy: erst jetzt wird gehandelt
function confirm(room, pid) {
  const a = current(room), g = room.game;
  if (!a || a.pid !== pid) fail('Es ist nichts zu bestätigen.');
  if (!a.pick) fail('Am Tisch wurde noch kein Ziel gewählt.');
  const action = actionOf(g, a, a.pick);
  try { g.act(pid, action); } catch (e) { a.pick = null; throw e; } // Fehler (z. B. Rohstoffe fehlen): Auswahl verwerfen, geschärft bleibt es
  room.arm = null;
}

// Sicht auf den Arm-Zustand: Zuschauer (Tisch) bekommen die Ziele, der Besitzer die Auswahl samt Beschreibung, alle anderen nur, dass gewählt wird
function viewFor(room, who) { // who: Spieler-Id oder 'watch'
  const a = current(room);
  if (!a) return null;
  const g = room.game;
  const base = { pid: a.pid, mode: a.mode, moveFrom: a.moveFrom, step: g.stepOf() };
  if (who === 'watch') return { ...base, targets: targets(g, a.pid, a.mode, a.moveFrom), pick: a.pick };
  if (who === a.pid) return { ...base, pick: a.pick ? { ...a.pick, ...describe(g, a.pick) } : null };
  return base;
}

module.exports = { arm, disarm, cancelPick, pick, confirm, viewFor, current, targets, describe, MODES, FORCED };
