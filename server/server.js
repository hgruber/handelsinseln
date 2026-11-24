'use strict';
// HTTP(S)-Server: statische Dateien, SSE-Zustandsstrom, Aktions-API, Spieleverwaltung und WebRTC-Signalweg. Keine Abhängigkeiten.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Game = require('./game');
const { Hub } = require('./hub');
const selfsigned = require('./selfsigned');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const VERSION = (() => { try { return require('../package.json').version; } catch (e) { return null; } })();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8' };

function createServer(opts = {}) {
  const hub = opts.hub || new Hub({ graceMs: opts.graceMs ?? (+process.env.GRACE_MS || undefined), absentMs: opts.absentMs ?? (+process.env.ABSENT_MS || undefined), rnd: opts.rnd });
  const clients = new Map(); // token -> Set(res)
  const rate = new Map();    // token -> {n, t} für den Signalweg
  let saveTimer = null;

  const save = () => {
    if (opts.noSave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(hub.toJSON())); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); } catch (e) { console.error('Speichern fehlgeschlagen:', e.message); }
    }, 300);
  };
  const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (room) => {
    if (!hub.rooms.has(room.id)) return;
    for (const p of room.game.S.players) {
      const set = p.token && clients.get(p.token);
      if (!set || !set.size) continue;
      const v = room.game.view(p.id);
      for (const res of set) send(res, 'state', v);
    }
    // Digitaler Spieltisch: die Tisch-Verbindung des Spielleiters bekommt zusätzlich die Sicht aller Spieler
    const S = room.game.S, hostTok = S.players[S.host] && S.players[S.host].token, ts = hostTok && clients.get(hostTok);
    if (ts && S.settings.table && (S.phase === 'main' || S.phase === 'setup')) {
      const tabs = [...ts].filter((r) => r.tableMode);
      if (tabs.length) { const views = S.players.map((p) => room.game.view(p.id)); for (const res of tabs) send(res, 'table', { views }); }
    }
    // Zuschauer: nur die öffentliche Sicht
    if (room.watchers && room.watchers.size) {
      let wv = null;
      for (const tok of room.watchers.keys()) { const set = clients.get(tok); if (!set || !set.size) continue; wv = wv || room.game.watchView(); for (const res of set) send(res, 'state', wv); }
    }
    save();
  };
  const dropClients = (token, event) => {
    const set = clients.get(token);
    if (!set) return;
    for (const r of set) { if (event) send(r, event, {}); r.end(); }
    clients.delete(token);
  };
  const dropRoom = (room) => { for (const p of room.game.S.players) if (p.token) dropClients(p.token); if (room.watchers) for (const tok of room.watchers.keys()) dropClients(tok, 'closed'); save(); };

  const body = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 20000) { reject(new Error('Anfrage zu groß')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error('Ungültiges JSON')); } });
  });
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const guarded = (fn) => {
    try { fn(); return null; } catch (e) {
      if (e instanceof Game.GameError) return e;
      console.error(e); return new Error('Interner Fehler: ' + e.message);
    }
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/api/games' || url.pathname === '/api/lobby') return json(res, 200, { games: hub.list() });
      if (url.pathname === '/api/config') return json(res, 200, { stun: process.env.STUN_URL || null, httpsPort: opts.httpsPort || null, version: VERSION });
      if (url.pathname === '/api/events') {
        const token = url.searchParams.get('token');
        const f = hub.findByToken(token), wf = !f && hub.findWatcher(token);
        if (!f && !wf) { res.writeHead(401); return res.end(); }
        if (wf) { // Zuschauer: nur lesen
          const { room, watcher } = wf;
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('retry: 2000\n\n');
          if (!clients.has(token)) clients.set(token, new Set());
          clients.get(token).add(res);
          hub.watcherConnected(watcher, true);
          room.game.settle();
          send(res, 'state', room.game.watchView());
          const ping = setInterval(() => res.write('event: ping\ndata: 1\n\n'), 20000);
          req.on('close', () => {
            clearInterval(ping);
            const set = clients.get(token);
            if (set) { set.delete(res); if (!set.size) { clients.delete(token); hub.watcherConnected(watcher, false); } }
          });
          return;
        }
        const { room, player } = f;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n');
        if (!clients.has(token)) clients.set(token, new Set());
        res.tableMode = url.searchParams.get('table') === '1' && player.id === room.game.S.host;
        clients.get(token).add(res);
        hub.connected(room, player);
        room.game.settle();
        send(res, 'state', room.game.view(player.id));
        broadcast(room);
        const ping = setInterval(() => res.write('event: ping\ndata: 1\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          const set = clients.get(token);
          if (set) { set.delete(res); if (!set.size) { clients.delete(token); hub.disconnected(room, player); broadcast(room); } }
        });
        return;
      }
      if (req.method === 'POST' && ['/api/join', '/api/watch', '/api/act', '/api/leave', '/api/signal'].includes(url.pathname)) {
        const b = await body(req);
        if (url.pathname === '/api/watch') {
          let out;
          const err = guarded(() => { out = hub.watch(b); });
          if (err) return json(res, 400, { error: err.message });
          return json(res, 200, { token: out.token, game: out.game, watch: true });
        }
        const wf = hub.findWatcher(b.token);
        if (wf) { // Zuschauer dürfen nichts tun außer das Zuschauen beenden
          if (url.pathname !== '/api/leave') return json(res, 403, { error: 'Zuschauer können nicht mitspielen.' });
          hub.unwatch(wf.room, b.token); dropClients(b.token);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/join') {
          let out;
          const err = guarded(() => { out = hub.join(b); });
          if (err) return json(res, 400, { error: err.message, ...(err.games ? { games: err.games } : {}) });
          broadcast(out.room);
          return json(res, 200, { token: out.token, pid: out.pid, game: out.game });
        }
        const f = hub.findByToken(b.token);
        if (!f) return json(res, 401, { error: 'Unbekannte Sitzung – bitte neu anmelden.' });
        const { room, player } = f;
        if (url.pathname === '/api/leave') {
          const tok = player.token;
          room.game.leave(tok);
          dropClients(tok);
          if (!room.game.humans().length) { dropRoom(room); hub.deleteRoom(room.id); save(); } else broadcast(room);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/signal') {
          const now = Date.now(), r = rate.get(b.token) || { n: 0, t: now };
          if (now - r.t > 10000) { r.n = 0; r.t = now; }
          if (++r.n > 200) return json(res, 429, { error: 'Zu viele Signale.' });
          rate.set(b.token, r);
          if (JSON.stringify(b.data || {}).length > 16000) return json(res, 400, { error: 'Signal zu groß.' });
          const targets = b.to === 'all' ? room.game.S.players.filter((p) => p.id !== player.id) : [room.game.S.players[b.to]].filter((p) => p && p.id !== player.id);
          for (const p of targets) { const set = p.token && clients.get(p.token); if (set) for (const c of set) send(c, 'signal', { from: player.id, data: b.data }); }
          return json(res, 200, { ok: true });
        }
        const g = room.game;
        g.lastKicked = null;
        let actor = player.id;
        if (b.as !== undefined && b.as !== null && b.as !== player.id) { // Spieltisch: der Spielleiter handelt für einen Mitspieler
          if (!(g.S.settings.table && player.id === g.S.host && Number.isInteger(b.as) && g.S.players[b.as])) return json(res, 400, { error: 'Der digitale Spieltisch ist nicht aktiv.' });
          actor = b.as;
        }
        const err = guarded(() => g.act(actor, b));
        if (err) return json(res, 400, { error: err.message });
        if (g.lastKicked) dropClients(g.lastKicked, 'kicked');
        broadcast(room);
        return json(res, 200, { ok: true });
      }
      // statische Dateien
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const base = rel.startsWith('/shared/') ? path.join(ROOT, 'shared') : path.join(ROOT, 'public');
      if (rel.startsWith('/shared/')) rel = rel.slice('/shared'.length);
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  };
  const server = http.createServer(handler);
  if (opts.https) { // zusätzlich https (Mikrofon im Browser braucht einen sicheren Kontext): eigenes Zertifikat oder automatisch erzeugtes
    const creds = process.env.TLS_CERT && process.env.TLS_KEY
      ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }
      : selfsigned.loadOrCreate(path.join(DATA, 'tls'), process.env.TLS_HOSTS);
    server.httpsServer = https.createServer({ cert: creds.cert, key: creds.key }, handler);
    server.on('close', () => server.httpsServer.close());
  }

  // Pflege: Abwesende → Auto-Modus, verwaiste Spiele aufräumen
  const timer = setInterval(() => {
    const { changed, removed } = hub.tick();
    removed.forEach((r) => dropRoom(r));
    changed.forEach((r) => broadcast(r));
    if (removed.length) save();
    for (const room of hub.rooms.values()) { // Auto-Spieler könnten durch Zeitablauf am Zug sein
      const v0 = room.game.S.v; room.game.settle(); if (room.game.S.v !== v0) broadcast(room);
    }
  }, +process.env.TICK_MS || opts.tickMs || 2000);
  server.on('close', () => clearInterval(timer));
  timer.unref();
  // Bots ziehen im Takt (damit Menschen den Zügen folgen können)
  const botTimer = setInterval(() => { for (const room of hub.rooms.values()) if (hub.botStep(room)) broadcast(room); }, +process.env.BOT_MS || opts.botMs || 800);
  server.on('close', () => clearInterval(botTimer));
  botTimer.unref();
  server.hub = hub; server.broadcast = broadcast;
  return server;
}

function loadHub() {
  const hub = new Hub({ graceMs: +process.env.GRACE_MS || undefined, absentMs: +process.env.ABSENT_MS || undefined, maxGames: +process.env.MAX_GAMES || 3 });
  try {
    hub.load(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), 300000);
    console.log(`Spielstand geladen: ${hub.rooms.size} Spiel(e).`);
  } catch (e) { /* neuer Start */ }
  return hub;
}

if (require.main === module) {
  const hub = loadHub();
  const httpsPort = process.env.HTTPS_PORT !== undefined ? +process.env.HTTPS_PORT : 8443; // 0 = kein https
  const server = createServer({ hub, https: httpsPort > 0, httpsPort: httpsPort > 0 ? httpsPort : null });
  // LISTEN="Adresse:Port" (z. B. 127.0.0.1:8080 oder [::1]:8080) hat Vorrang vor PORT
  const m = /^(.*):(\d+)$/.exec(process.env.LISTEN || '');
  const host = m ? m[1].replace(/^\[(.*)\]$/, '$1') || undefined : undefined, port = m ? +m[2] : PORT;
  server.listen(port, host, () => console.log(`Handelsinseln läuft auf ${host ? host + ':' : 'Port '}${port} (http)`));
  if (server.httpsServer) server.httpsServer.listen(httpsPort, () => console.log(`und auf Port ${httpsPort} (https, für das Mikrofon im Browser)`));
  const bye = () => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(hub.toJSON())); } catch (e) { /* egal */ } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}

module.exports = { createServer };
