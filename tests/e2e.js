'use strict';
// Ende-zu-Ende über echtes HTTP/SSE: mehrere "Browser" melden sich an, der Host startet, Testspieler spielen bis zum Sieg.
const assert = require('assert');
const { createServer } = require('../server/server');
const Game = require('../server/game');
const { rng } = require('./sim');

const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];
const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];

async function run(n, seed) {
  const rnd = rng(seed);
  const game = new Game({ rnd });
  const server = createServer(game, { noSave: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };

  // Statische Auslieferung
  assert.equal((await fetch(base + '/shared/geom.js')).status, 200);
  assert.equal((await fetch(base + '/../server/game.js')).status === 200, false);
  assert.equal((await fetch(base + '/%2e%2e/server/game.js')).status === 200, false);
  const lobby0 = await (await fetch(base + '/api/lobby')).json();
  assert.equal(lobby0.players.length, 0);

  const clients = [];
  for (let i = 0; i < n; i++) {
    const j = await post('/api/join', { name: 'Spieler' + (i + 1), color: COL[i] });
    assert(j.token, JSON.stringify(j));
    const dup = await post('/api/join', { name: 'Spieler' + (i + 1), color: COL[(i + 1) % 6] });
    assert.equal(dup.status, 400);
    const c = { token: j.token, pid: j.pid, view: null, ctrl: new AbortController(), errors: [] };
    const res = await fetch(base + '/api/events?token=' + j.token, { signal: c.ctrl.signal });
    assert.equal(res.status, 200);
    (async () => {
      const dec = new TextDecoder(); let buf = '';
      try { for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i2; while ((i2 = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i2); buf = buf.slice(i2 + 2);
          if (block.includes('event: state')) c.view = JSON.parse(block.split('data: ')[1]);
        }
      } } catch (e) { /* abgebrochen */ }
    })();
    clients.push(c);
  }
  const bad = await fetch(base + '/api/events?token=nope'); assert.equal(bad.status, 401);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(clients[1].view.phase, 'lobby');
  assert.equal(clients[0].view.players.length, n);
  assert.equal((await post('/api/act', { token: clients[1].token, type: 'start' })).status, 400); // Nicht-Host
  assert.equal((await post('/api/act', { token: clients[0].token, type: 'start' })).ok, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(clients[2 % n].view.phase, 'setup');
  // Fremde Sicht darf keine fremden Karten enthalten
  const v0 = clients[0].view; assert(!('hand' in v0.players[1]));

  // Spielen: jeder Client entscheidet nur anhand seiner eigenen View (wie ein Browser)
  const { botAct } = require('../server/bot');
  let steps = 0, rejected = 0;
  const t0 = Date.now();
  while (clients[0].view.phase !== 'ended' && steps < 40000 && Date.now() - t0 < 500000) {
    let acted = false;
    for (const c of clients) {
      // Aktion über das Spielobjekt vorbereiten, aber über HTTP senden: Bot-Entscheidung auf Kopie des Spiels
      const probe = Game.fromJSON(structuredClone(game.S), { rnd });
      let sent = null;
      const orig = probe.act.bind(probe);
      probe.act = (pid, a) => { sent = a; orig(pid, a); };
      try { if (!require('../server/bot').botAct(probe, c.pid, { rnd })) continue; } catch (e) { continue; }
      const r = await post('/api/act', { token: c.token, ...sent });
      if (r.ok) { acted = true; steps++; } else { rejected++; throw new Error('Server lehnte gültige Aktion ab: ' + r.error + ' ' + JSON.stringify(sent)); }
    }
    if (!acted) await new Promise((r) => setTimeout(r, 5));
    if (!acted && Date.now() - t0 > 450000) break;
  }
  await new Promise((r) => setTimeout(r, 100));
  const end = clients[0].view;
  assert.equal(end.phase, 'ended', 'Spiel nicht beendet nach ' + steps + ' Aktionen');
  assert(end.winner !== null);
  assert(clients.every((c) => c.view.v === end.v), 'Clients nicht synchron');
  assert.equal(end.players[end.winner].vp >= 14, true);
  // Neues Spiel
  assert.equal((await post('/api/act', { token: clients[0].token, type: 'new_game' })).ok, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(clients[1].view.phase, 'lobby'); assert.equal(clients[1].view.players.length, n);
  clients.forEach((c) => c.ctrl.abort());
  server.close(); server.closeAllConnections && server.closeAllConnections();
  return { steps, winner: end.winner, vps: end.players.map((p) => p.vp) };
}

(async () => {
  for (const [n, s] of [[3, 11], [4, 12], [6, 13]]) {
    const r = await run(n, s);
    console.log(`E2E n=${n}: ${r.steps} Aktionen über HTTP, Sieger ${r.winner}, VP ${r.vps}`);
  }
  console.log('E2E bestanden');
  process.exit(0);
})().catch((e) => { console.error('E2E FEHLER', e); process.exit(1); });
