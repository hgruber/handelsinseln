// Stub-Server fuer den Sprachchat-Test: node tests/mock/signal_stub.js  (Port 8098)
// Liefert public/ + shared/ aus und implementiert nur das Noetigste: /api/games, /api/join, /api/events (SSE), /api/signal, /api/act, /api/config, /api/leave.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const COLORS = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];
const players = []; // {name,color,token,res}
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (_) { ok({}); } }); });
const view = (you) => ({ v: Date.now(), phase: 'lobby', step: 'lobby', gameName: 'Stub', you, host: 0, minPlayers: 2, maxPlayers: 6, winPoints: 14, closed: false,
  players: players.map((p, i) => ({ id: i, name: p.name, color: p.color, connected: true })), log: [], chat: [], hexes: [], fog: [], harbors: [], verts: {}, edges: {}, settings: { variant: 'klassisch', plannedPlayers: 2 } });
const push = () => players.forEach((p, i) => { if (p.res) p.res.write(`event: state\ndata: ${JSON.stringify(view(i))}\n\n`); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p === '/api/games') {
    const g = { id: 'g1', name: 'Stub', host: players[0] ? players[0].name : '?', phase: 'lobby', closed: false, joinable: players.length > 0 && players.length < 6, variant: 'klassisch', players: players.map((x) => ({ name: x.name, color: x.color })), plannedPlayers: 2, maxPlayers: 6 };
    return json(res, 200, { games: g.joinable ? [g] : [] });
  }
  if (p === '/api/config') return json(res, 200, { stun: null });
  if (p === '/api/join') {
    const b = await body(req); const pid = players.length;
    players.push({ name: b.name, color: b.color || COLORS[pid], token: 'tok' + pid + Math.random().toString(36).slice(2), res: null });
    return json(res, 200, { token: players[pid].token, pid, game: 'g1' });
  }
  if (p === '/api/events') {
    const i = players.findIndex((x) => x.token === u.searchParams.get('token')); if (i < 0) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); players[i].res = res; push();
    req.on('close', () => { players[i].res = null; }); return;
  }
  if (p === '/api/signal') {
    const b = await body(req), from = players.findIndex((x) => x.token === b.token); if (from < 0) return json(res, 401, { error: 'unbekannt' });
    players.forEach((x, i) => { if (i !== from && x.res && (b.to === 'all' || b.to === i)) x.res.write(`event: signal\ndata: ${JSON.stringify({ from, data: b.data })}\n\n`); });
    return json(res, 200, { ok: true });
  }
  if (p === '/api/act' || p === '/api/leave') { await body(req); return json(res, 200, { ok: true }); }
  const f = p === '/' ? '/index.html' : p;
  const file = f.startsWith('/shared/') ? path.join(root, f) : path.join(root, 'public', f);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(d); });
}).listen(8098, () => console.log('Signal-Stub auf http://localhost:8098'));
