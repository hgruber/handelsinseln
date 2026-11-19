'use strict';
// HTTP-Server: statische Dateien, SSE-Zustandsstrom und Aktions-API. Keine Abhängigkeiten.
const http = require('http');
const fs = require('fs');
const path = require('path');
const Game = require('./game');
const { botAct } = require('./bot');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const ABSENT_MS = +process.env.ABSENT_MS || 60000; // so lange wartet das Spiel auf einen getrennten Spieler

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function loadGame() {
  try {
    const g = Game.fromJSON(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    g.S.players.forEach((p) => { p.connected = false; });
    console.log(`Spielstand geladen (Phase ${g.S.phase}, ${g.S.players.length} Spieler).`);
    return g;
  } catch (e) { return new Game(); }
}

function createServer(game = new Game(), opts = {}) {
  const clients = new Map(); // pid -> Set(res)
  const absentSince = new Map();
  let saveTimer = null;

  const save = () => {
    if (opts.noSave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(game.toJSON())); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); } catch (e) { console.error('Speichern fehlgeschlagen:', e.message); }
    }, 300);
  };
  const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = () => {
    for (const [token, set] of clients) {
      const p = playerByToken(token);
      if (!p) { for (const r of set) r.end(); clients.delete(token); continue; }
      if (!set.size) continue;
      const v = game.view(p.id);
      for (const res of set) send(res, 'state', v);
    }
    save();
  };
  const playerByToken = (t) => game.S.players.find((p) => p.token === t);
  const body = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 20000) { reject(new Error('zu groß')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new Error('Ungültiges JSON')); } });
  });
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  const guarded = (fn) => {
    try { fn(); return null; } catch (e) {
      if (e instanceof Game.GameError) return e.message;
      console.error(e); return 'Interner Fehler: ' + e.message;
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/api/lobby') {
        const S = game.S;
        return json(res, 200, { phase: S.phase, players: S.players.map((p) => ({ name: p.name, color: p.color })), takenColors: S.players.map((p) => p.color), maxPlayers: 6 });
      }
      if (url.pathname === '/api/events') {
        const p = playerByToken(url.searchParams.get('token'));
        if (!p) { res.writeHead(401); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n');
        if (!clients.has(p.token)) clients.set(p.token, new Set());
        clients.get(p.token).add(res);
        absentSince.delete(p.token);
        game.setConnected(p.id, true);
        send(res, 'state', game.view(p.id));
        broadcast();
        const ping = setInterval(() => res.write('event: ping\ndata: 1\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          const set = clients.get(p.token);
          const q = playerByToken(p.token);
          if (set) { set.delete(res); if (!set.size && q) { game.setConnected(q.id, false); absentSince.set(p.token, Date.now()); broadcast(); } }
        });
        return;
      }
      if (req.method === 'POST' && (url.pathname === '/api/join' || url.pathname === '/api/act' || url.pathname === '/api/leave')) {
        const b = await body(req);
        if (url.pathname === '/api/join') {
          let out;
          const err = guarded(() => { out = game.join(b.name, b.color, b.token); });
          if (err) return json(res, 400, { error: err });
          broadcast();
          return json(res, 200, out);
        }
        const p = playerByToken(b.token);
        if (!p) return json(res, 401, { error: 'Unbekannte Sitzung – bitte neu anmelden.' });
        if (url.pathname === '/api/leave') {
          game.leave(b.token);
          broadcast();
          return json(res, 200, { ok: true });
        }
        const err = guarded(() => game.act(p.id, b));
        if (err) return json(res, 400, { error: err });
        broadcast();
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
  });

  // Abwesende Spieler: nach ABSENT_MS übernimmt ein Autopilot nur ihre Pflichten, damit niemand das Spiel blockiert.
  const watchdog = setInterval(() => {
    const S = game.S;
    // Verwaiste Lobby-Plätze (Tab zu) werden nach 2 Minuten frei; ein beendetes, verlassenes Spiel wird zurückgesetzt.
    if (S.phase === 'lobby' || S.phase === 'ended') {
      const gone = S.players.filter((p) => !p.connected && absentSince.has(p.token) && Date.now() - absentSince.get(p.token) > (S.phase === 'lobby' ? 120000 : 600000));
      if (S.phase === 'lobby' && gone.length) { gone.forEach((p) => game.leave(p.token)); broadcast(); }
      else if (S.phase === 'ended' && gone.length === S.players.length) { game.reset(false); absentSince.clear(); broadcast(); }
      return;
    }
    let changed = false;
    for (let guard = 0; guard < 50; guard++) {
      const view0 = game.stepOf();
      const waiting = new Set();
      if (view0 === 'discard') Object.keys(S.pend.discard).forEach((k) => waiting.add(+k));
      else if (view0 === 'gold') Object.keys(S.pend.gold).forEach((k) => waiting.add(+k));
      else waiting.add(S.sbp ? S.sbp.pid : S.turn);
      let acted = false;
      for (const pid of waiting) {
        const t = absentSince.get(S.players[pid].token);
        if (S.players[pid].connected || t === undefined || Date.now() - t < ABSENT_MS) continue;
        const err = guarded(() => { acted = botAct(game, pid, { minimal: true }) || acted; });
        if (err) console.error('Autopilot:', err);
        if (acted) { changed = true; break; }
      }
      if (!acted) break;
    }
    if (changed) broadcast();
  }, 5000);
  server.on('close', () => clearInterval(watchdog));
  watchdog.unref();
  server.game = game; server.broadcast = broadcast; server.absentSince = absentSince;
  return server;
}

if (require.main === module) {
  const game = loadGame();
  const server = createServer(game);
  // Leeres Spiel (alle weg) nach Neustart: Lobby bleibt bestehen; niemand ist verbunden → Platz freigeben
  server.listen(PORT, () => console.log(`Handelsinseln läuft auf Port ${PORT}`));
  const bye = () => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(game.toJSON())); } catch (e) { /* egal */ } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}

module.exports = { createServer };
