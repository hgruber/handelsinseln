'use strict';
// Bot-Turnier: Baumeister, Händler und Ritter spielen vollständige Partien (Brett-Varianten, 3–4 Spieler) gegen einen
// Zufallsspieler (botAct) bzw. gegeneinander. Prüft: keine Aussetzer/Hänger, Spielende, Siegverteilung (kein Typ dominiert).
//   node tests/bots.js [Partien je Variante, Standard 12] [Seed] [Varianten, kommagetrennt]
const assert = require('assert');
const Game = require('../server/game');
const { botAct } = require('../server/bot');
const { botPlay } = require('../server/botplay');
const { rng } = require('./sim');

const KINDS = ['baumeister', 'haendler', 'ritter'];
const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];

// Eine Partie. seats: Liste aus 'zufall' | Bot-Sorte | 'as:<Sorte>' (Mensch-Platz mit Persönlichkeit)
function play(seats, variant, seed, maxTurns = 600) {
  const rnd = rng(seed);
  const g = new Game({ rnd });
  g.join('Mensch', COL[0]);
  const hostSeat = seats[0];
  let humans = [{ pid: 0, seat: hostSeat }];
  for (const s of seats.slice(1)) {
    if (KINDS.includes(s)) g.addBot(0, s);
    else { const r = g.join('Zufall' + humans.length, COL[g.S.players.length]); humans.push({ pid: r.pid, seat: s }); }
  }
  g.setSettings(0, { variant, plannedPlayers: seats.length });
  g.act(0, { type: 'start' });
  const n = g.S.players.length;
  let steps = 0, stuck = 0;
  while (g.S.phase !== 'ended' && g.S.turnNo <= maxTurns && steps < 200000) {
    let acted = false;
    for (let pid = 0; pid < n; pid++) {
      if (g.S.phase === 'ended') break;
      const p = g.S.players[pid];
      let did = false;
      if (p.bot) did = botPlay(g, pid, { rnd });
      else {
        const seat = humans.find((h) => h.pid === pid).seat;
        did = seat.startsWith('as:') ? botPlay(g, pid, { rnd, as: seat.slice(3) }) : botAct(g, pid, { rnd });
      }
      if (did) { acted = true; steps++; }
    }
    if (!acted) { if (++stuck > 4) throw new Error(`Hänger: Variante ${variant} Seed ${seed} Zug ${g.S.turnNo} Schritt ${g.stepOf()} am Zug ${g.S.turn} Handel ${JSON.stringify(g.S.trade)}`); } else stuck = 0;
  }
  const vp = g.S.players.map((p) => g.vp(p.id) + g.hiddenVp(p.id));
  return { ended: g.S.phase === 'ended', winner: g.S.winner, turns: g.S.turnNo, vp, names: g.S.players.map((p) => p.bot || (humans.find((h) => h.pid === p.id) || {}).seat || '?') };
}

function tournament(label, seats, variants, count, seed0) {
  const wins = {}, vps = {}, cnt = {}; let ended = 0, turns = 0, total = 0;
  for (const variant of variants) for (let i = 0; i < count; i++) {
    const r = play(seats, variant, seed0 + i * 7 + variant.length * 1000);
    if (!r.ended) console.log(`  unbeendet: ${variant} Zug ${r.turns} Punkte ${r.names.map((n, k) => n + ':' + r.vp[k]).join(' ')}`);
    total++; if (r.ended) { ended++; wins[r.names[r.winner]] = (wins[r.names[r.winner]] || 0) + 1; }
    turns += r.turns;
    r.names.forEach((nm, k) => { vps[nm] = (vps[nm] || 0) + r.vp[k]; cnt[nm] = (cnt[nm] || 0) + 1; });
  }
  console.log(`\n${label}: ${total} Partien, ${ended} beendet, Ø ${(turns / total).toFixed(0)} Züge`);
  for (const nm of Object.keys(cnt)) console.log(`  ${nm.padEnd(11)} Siege ${String(wins[nm] || 0).padStart(3)} (${(100 * (wins[nm] || 0) / total).toFixed(0)} %)  Ø Punkte ${(vps[nm] / cnt[nm]).toFixed(1)}`);
  return { wins, vps, cnt, ended, total };
}

if (require.main === module) {
  const count = +process.argv[2] || 12, seed = +process.argv[3] || 100;
  const variants = (process.argv[4] || 'klassisch,nebel,inseln,archipel').split(',');
  const A = tournament('3 Bots + Zufallsspieler', ['zufall', 'baumeister', 'haendler', 'ritter'], variants, count, seed);
  const Bt = tournament('Drei Bots untereinander (Mensch-Platz als Persönlichkeit)', ['as:baumeister', 'haendler', 'ritter'], variants, count, seed + 5);
  // Erwartung: keine Hänger (play() wirft), Bots schlagen den Zufallsspieler klar, kein Typ dominiert die Dreierrunde.
  // Unbeendete Partien sind echte Patts der Regeln (alle Figuren und Entwicklungskarten verbraucht, niemand erreicht die Siegpunkte).
  assert(A.ended >= A.total * 0.6, `zu viele Patts/unbeendete Partien (${A.ended}/${A.total})`);
  const botWins = KINDS.reduce((a, k) => a + (A.wins[k] || 0), 0);
  assert(botWins >= A.ended * 0.8, `Bots gewinnen zu selten gegen den Zufallsspieler (${botWins}/${A.ended})`);
  if (Bt.total >= 24) for (const k of KINDS) { const w = (Bt.wins[k] || 0) + (Bt.wins['as:' + k] || 0); assert(w <= Bt.ended * 0.65, `${k} dominiert (${w}/${Bt.ended})`); }
  console.log('\nBot-Turnier bestanden');
}

module.exports = { play, tournament };
