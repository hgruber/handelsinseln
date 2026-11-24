'use strict';
// Ende-zu-Ende über echtes HTTP/SSE: mehrere "Browser", parallele Spiele, Lobby-Funktionen, Verlassen, Signalweg, dann ganze Partien.
const assert = require('assert');
const { createServer } = require('../server/server');
const Game = require('../server/game');
const { botAct } = require('../server/bot');
const { rng } = require('./sim');

const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(seed, opts = {}) {
  const server = createServer({ noSave: true, rnd: rng(seed), ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  const get = async (path) => (await fetch(base + path)).json();
  const connect = async (token) => {
    const c = { token, view: null, events: [], signals: [], kicked: false, ctrl: new AbortController() };
    const res = await fetch(base + '/api/events?token=' + token, { signal: c.ctrl.signal });
    c.status = res.status;
    if (res.status !== 200) return c;
    (async () => {
      const dec = new TextDecoder(); let buf = '';
      try {
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = (block.match(/event: (\w+)/) || [])[1], data = (block.match(/data: (.*)/) || [])[1];
            if (ev === 'state') c.view = JSON.parse(data); else if (ev === 'signal') c.signals.push(JSON.parse(data)); else if (ev === 'kicked') c.kicked = true;
          }
        }
      } catch (e) { /* abgebrochen */ }
    })();
    return c;
  };
  const close = () => { server.close(); server.closeAllConnections && server.closeAllConnections(); };
  return { server, base, post, get, connect, close, hub: server.hub };
}

async function lobbyAndFeatures() {
  const T = await boot(21);
  const { post, get, connect, hub } = T;
  // Statische Auslieferung und Sicherheit
  assert.equal((await fetch(T.base + '/shared/geom.js')).status, 200);
  // Caching: ETag + 304 bei unveränderter Datei
  const img = await fetch(T.base + '/img/logo.webp'); const etag = img.headers.get('etag'); await img.arrayBuffer();
  assert(etag && img.status === 200, 'statische Datei mit ETag');
  const again = await fetch(T.base + '/img/logo.webp', { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304); assert.equal((await again.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(T.base + '/nichtda.js')).status, 404);
  assert.equal((await fetch(T.base + '/../server/game.js')).status === 200, false);
  assert.equal((await fetch(T.base + '/%2e%2e/server/game.js')).status === 200, false);
  assert.deepEqual((await get('/api/games')).games, []);
  assert.equal((await get('/api/config')).stun, null);

  // Spiel A eröffnen: ohne Angabe → automatisch neues Spiel
  const a1 = await post('/api/join', { name: 'Anna', color: 'rot' });
  assert(a1.token && a1.game, JSON.stringify(a1));
  const cA1 = await connect(a1.token);
  await sleep(60);
  assert.equal(cA1.view.phase, 'lobby'); assert.equal(cA1.view.host, 0);
  assert(cA1.view.hexes.length > 20, 'Vorschau-Brett kommt per SSE');
  assert.equal(cA1.view.settings.winPoints, 14);
  // Ben tritt (einziges offenes Spiel) automatisch bei, Farbe belegt → Fehler
  assert.equal((await post('/api/join', { name: 'Ben', color: 'rot' })).status, 400);
  const a2 = await post('/api/join', { name: 'Ben', color: 'blau' });
  assert.equal(a2.game, a1.game);
  const cA2 = await connect(a2.token);
  // Cleo eröffnet ausdrücklich ein zweites, paralleles Spiel mit derselben Farbe wie Anna
  const b1 = await post('/api/join', { name: 'Cleo', color: 'rot', create: true });
  assert.notEqual(b1.game, a1.game);
  const cB1 = await connect(b1.token);
  const games = (await get('/api/games')).games;
  assert.equal(games.length, 2); assert(games.every((g) => g.joinable));
  // Dora ohne Wahl → Auswahl
  const amb = await post('/api/join', { name: 'Dora', color: 'gruen' });
  assert.equal(amb.status, 400); assert.equal(amb.games.length, 2);
  const b2 = await post('/api/join', { name: 'Dora', color: 'gruen', game: b1.game });
  const cB2 = await connect(b2.token);
  await sleep(80);
  assert.equal(cA1.view.players.length, 2); assert.equal(cB1.view.players.length, 2);
  assert(cA1.view.players.every((p) => ['Anna', 'Ben'].includes(p.name)), 'Spiele sind isoliert');
  assert.notEqual(cA1.view.gameId, cB1.view.gameId);

  // Einstellungen: nur Host; alle sehen die Änderung live
  assert.equal((await post('/api/act', { token: a2.token, type: 'set_settings', settings: { winPoints: 10 } })).status, 400);
  assert.equal((await post('/api/act', { token: a1.token, type: 'set_settings', settings: { winPoints: 10, dice: 'auto', variant: 'nebel' } })).ok, true);
  await sleep(60);
  assert.equal(cA2.view.settings.winPoints, 10); assert.equal(cA2.view.settings.variant, 'nebel');
  assert.equal(cB1.view.settings.winPoints, 14, 'anderes Spiel unberührt');
  const prev = JSON.stringify(cA2.view.hexes);
  assert.equal((await post('/api/act', { token: a1.token, type: 'regen_board' })).ok, true);
  await sleep(60);
  assert.notEqual(JSON.stringify(cA2.view.hexes), prev, 'Brett neu');

  // Signalweg (Sprachchat) nur innerhalb des Spiels
  assert.equal((await post('/api/signal', { token: a1.token, to: 'all', data: { t: 'hello' } })).ok, true);
  assert.equal((await post('/api/signal', { token: a2.token, to: 0, data: { t: 'offer', sdp: 'x' } })).ok, true);
  await sleep(60);
  assert.equal(cA2.signals.length, 1); assert.equal(cA2.signals[0].from, 0);
  assert.equal(cA1.signals.length, 1); assert.equal(cA1.signals[0].data.t, 'offer');
  assert.equal(cB1.signals.length, 0, 'Signale bleiben im Spiel');
  assert.equal((await post('/api/signal', { token: 'nope', to: 'all', data: {} })).status, 401);

  // Plätze schließen → Spiel nicht mehr in der Liste; Entfernen eines Spielers
  assert.equal((await post('/api/act', { token: b1.token, type: 'close_seats', closed: true })).ok, true);
  assert.equal((await get('/api/games')).games.filter((g) => g.joinable).length, 1);
  assert.equal((await post('/api/join', { name: 'Emil', color: 'violett', game: b1.game })).status, 400);
  assert.equal((await post('/api/act', { token: b1.token, type: 'kick', pid: 1 })).ok, true);
  await sleep(80);
  assert.equal(cB2.kicked, true, 'Entfernter bekommt kicked');
  assert.equal((await connect(b2.token)).status, 401, 'Token des Entfernten ungültig');
  assert.equal(cB1.view.players.length, 1);
  // Spiel B: Host verlässt → Spiel verschwindet
  assert.equal((await post('/api/leave', { token: b1.token })).ok, true);
  await sleep(60);
  assert.equal(hub.rooms.has(b1.game), false, 'leeres Spiel wird beendet');
  assert.equal((await get('/api/games')).games.length, 1);

  // Spiel A starten, einer verlässt mitten im Spiel → Auto-Modus
  assert.equal((await post('/api/act', { token: a1.token, type: 'start' })).ok, true);
  await sleep(60);
  assert.equal(cA1.view.phase, 'setup');
  assert.equal((await post('/api/leave', { token: a2.token })).ok, true);
  await sleep(100);
  assert.equal(cA1.view.players[1].gone, true); assert.equal(cA1.view.players[1].auto, true);
  assert.equal((await post('/api/act', { token: a2.token, type: 'chat', text: 'x' })).status, 401);
  // Letzter Mensch weg → Spiel weg
  cA1.ctrl.abort();
  assert.equal((await post('/api/leave', { token: a1.token })).ok, true);
  await sleep(60);
  assert.equal(hub.rooms.size, 0);
  T.close();
}

async function httpsAndConfig() {
  const T = await boot(23, { https: true, httpsPort: 0 });
  T.server.httpsServer.listen(0, '127.0.0.1');
  await sleep(300);
  const port = T.server.httpsServer.address().port;
  const https = require('https');
  const body = await new Promise((res, rej) => https.get({ host: '127.0.0.1', port, path: '/api/config', rejectUnauthorized: false }, (r) => { let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => res(s)); }).on('error', rej));
  assert.equal(JSON.parse(body).stun, null);
  const cert = await new Promise((res, rej) => { const s = require('tls').connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => { res(s.getPeerX509Certificate()); s.end(); }); s.on('error', rej); });
  assert(cert.subjectAltName.includes('localhost') && cert.subjectAltName.includes('127.0.0.1'), 'Zertifikat deckt localhost ab');
  T.close();
}

async function tabCloseAndAuto() {
  // Tab schließen: Kulanzzeit, Auto-Modus bei Abwesenheit, Rückkehr; Spielende nach letztem Tab
  const T = await boot(22, { graceMs: 400, absentMs: 500, tickMs: 100 });
  const { post, connect, hub } = T;
  const a = await post('/api/join', { name: 'Anna', color: 'rot' });
  const b = await post('/api/join', { name: 'Ben', color: 'blau' });
  const cA = await connect(a.token); let cB = await connect(b.token);
  assert.equal((await post('/api/act', { token: a.token, type: 'start' })).ok, true);
  await sleep(100);
  cB.ctrl.abort();           // Ben schließt den Tab
  await sleep(250);
  assert.equal(cA.view.players[1].connected, false); assert.equal(cA.view.players[1].auto, false, 'noch Kulanz');
  await sleep(700);
  assert.equal(cA.view.players[1].auto, true, 'nach Abwesenheit Auto-Modus');
  cB = await connect(b.token); // Ben kommt zurück
  await sleep(100);
  assert.equal(cB.view.players[1].auto, false, 'Rückkehr beendet Auto-Modus'); assert.equal(cB.view.you, 1);
  cA.ctrl.abort(); cB.ctrl.abort();
  await sleep(900);
  assert.equal(hub.rooms.size, 0, 'letzter Tab geschlossen → Spiel beendet');
  T.close();
}

async function fullGame(n, seed, settings) {
  const rnd = rng(seed);
  const T = await boot(seed);
  const { post, connect, hub } = T;
  const clients = [];
  let gameId;
  for (let i = 0; i < n; i++) {
    const j = await post('/api/join', { name: 'Spieler' + (i + 1), color: COL[i], ...(i === 0 ? { create: true } : { game: gameId }) });
    assert(j.token, JSON.stringify(j));
    gameId = j.game;
    const c = await connect(j.token); c.pid = j.pid; clients.push(c);
  }
  await sleep(80);
  if (settings) assert.equal((await post('/api/act', { token: clients[0].token, type: 'set_settings', settings })).ok, true);
  assert.equal((await post('/api/act', { token: clients[0].token, type: 'start' })).ok, true);
  await sleep(80);
  assert(['setup', 'main'].includes(clients[0].view.phase));
  assert(!('hand' in clients[0].view.players[1]), 'fremde Karten bleiben verborgen');
  const game = hub.rooms.get(gameId).game;
  let steps = 0;
  const t0 = Date.now();
  while (clients[0].view.phase !== 'ended' && game.S.turnNo < 1000 && steps < 40000 && Date.now() - t0 < 400000) {
    let acted = false;
    for (const c of clients) {
      const probe = Game.fromJSON(structuredClone(game.S), { rnd });
      let sent = null; const orig = probe.act.bind(probe);
      probe.act = (pid, a) => { sent = a; orig(pid, a); };
      try { if (!botAct(probe, c.pid, { rnd })) continue; } catch (e) { continue; }
      const r = await post('/api/act', { token: c.token, ...sent });
      if (!r.ok) throw new Error('Server lehnte gültige Aktion ab: ' + r.error + ' ' + JSON.stringify(sent));
      acted = true; steps++;
    }
    if (!acted) await sleep(5);
  }
  await sleep(100);
  const end = clients[0].view;
  if (end.phase === 'ended') {
    assert(end.stats && end.stats.players.length === n && Object.keys(end.stats.rolls).length === 11);
    assert(end.winner !== null && end.players[end.winner].vp >= (settings ? settings.winPoints || 14 : 14));
    assert(clients.every((c) => c.view.v === end.v), 'Clients nicht synchron');
    assert.equal((await post('/api/act', { token: clients[0].token, type: 'new_game' })).ok, true);
    await sleep(100);
    assert.equal(clients[1].view.phase, 'lobby'); assert.equal(clients[1].view.players.length, n);
  } else console.log('  (Patt der Zufalls-Testspieler nach', game.S.turnNo, 'Zügen – ohne Fehler)');
  clients.forEach((c) => c.ctrl.abort());
  T.close();
  return { steps, winner: end.winner, vps: end.players.map((p) => p.vp), ended: end.phase === 'ended' };
}

(async () => {
  await lobbyAndFeatures(); console.log('E2E Lobby/Spiele/Verlassen/Signal ✓');
  await httpsAndConfig(); console.log('E2E https/Zertifikat ✓');
  await tabCloseAndAuto(); console.log('E2E Tab schließen/Auto-Modus/Spielende ✓');
  for (const [n, s, set] of [[3, 11, { variant: 'archipel' }], [4, 12, { variant: 'nebel', dice: 'auto', robber: 'auto', winPoints: 10 }], [5, 15, { variant: 'inseln', limits: { dev: 12 } }], [6, 16, { winPoints: 12, handLimit: 5 }]]) {
    const r = await fullGame(n, s, set);
    console.log(`E2E n=${n}: ${r.steps} Aktionen über HTTP, Sieger ${r.winner}, VP ${r.vps}`);
  }
  console.log('E2E bestanden');
  process.exit(0);
})().catch((e) => { console.error('E2E FEHLER', e); process.exit(1); });
