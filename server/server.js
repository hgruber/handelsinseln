'use strict';
// HTTP(S)-Server: statische Dateien, SSE-Zustandsstrom, Aktions-API, Spieleverwaltung und WebRTC-Signalweg. Keine Abhängigkeiten.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Game = require('./game');
const Arm = require('./arm');
const Handover = require('./handover');
const { Hub } = require('./hub');
const selfsigned = require('./selfsigned');
const log = require('./log');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const GAMES_FILE = path.join(DATA, 'partien.jsonl'); // Abschlussbericht je Partie, eine JSON-Zeile
// Version: package.json; liegen seit dem letzten Tag Commits vor, kommt ein Zusatz „+Anzahl.Hash“ dazu (aus git oder APP_VERSION, z. B. beim Container-Bau)
const VERSION = (() => {
  let base = null; try { base = require('../package.json').version; } catch (e) { /* ohne package.json */ }
  let d = process.env.APP_VERSION || '';
  if (!d) { try { d = require('child_process').execFileSync('git', ['describe', '--tags', '--long', '--dirty'], { cwd: ROOT, timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { d = ''; } }
  const m = /^v?(.+?)-(\d+)-g([0-9a-f]+)(-dirty)?$/.exec(d);
  return m && (+m[2] > 0 || m[4]) ? `${m[1]}${+m[2] > 0 ? '+' + m[2] + '.' + m[3] : ''}${m[4] ? ' (geändert)' : ''}` : (base || (m && m[1]) || null);
})();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8' };

function createServer(opts = {}) {
  const hub = opts.hub || new Hub({ graceMs: opts.graceMs ?? (+process.env.GRACE_MS || undefined), absentMs: opts.absentMs ?? (+process.env.ABSENT_MS || undefined), rnd: opts.rnd });
  const clients = new Map(); // token -> Set(res)
  const rate = new Map();    // token -> {n, t} für den Signalweg
  let saveTimer = null, saving = false, saveAgain = false;

  // Spielstand asynchron schreiben (blockiert die Ereignisschleife nicht); nie zwei Schreibvorgänge gleichzeitig –
  // kommt währenddessen eine Änderung, wird danach noch einmal geschrieben. Beim Beenden schreibt bye() synchron.
  const writeState = async () => {
    if (saving) { saveAgain = true; return; }
    saving = true;
    try {
      const data = JSON.stringify(hub.toJSON());
      await fs.promises.mkdir(DATA, { recursive: true });
      await fs.promises.writeFile(STATE_FILE + '.tmp', data);
      await fs.promises.rename(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { log.error('speichern_fehler', { fehler: e.message }); }
    saving = false;
    if (saveAgain) { saveAgain = false; writeState(); }
  };
  const save = () => {
    if (opts.noSave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeState, 300);
  };
  const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  // Ereignisstrom öffnen, gzip-komprimiert, wenn der Client es kann: Nach jedem Ereignis wird synchron geleert, das
  // Wörterbuch bleibt aber über den ganzen Strom erhalten – aufeinanderfolgende, fast gleiche Sichten kosten so nur noch
  // wenige hundert Bytes statt jeweils ~20 KB. Gibt ein Objekt mit write()/end() zurück (ohne gzip: res selbst).
  const openStream = (req, res) => {
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
    if (!gz) return res;
    const z = zlib.createGzip({ level: 6, memLevel: 7 });
    z.on('error', () => res.destroy());
    z.pipe(res);
    return { write: (s) => { z.write(s); z.flush(zlib.constants.Z_SYNC_FLUSH); }, end: () => z.end() };
  };
  // Sichten mit Zusätzen, die nicht zum Spielstand gehören: display = es ist eine Tisch-Anzeige (Zuschauer) verbunden, arm = Standortwahl am Tisch
  // Tisch-Anzeigen: verbundene Zuschauer und – bei laufendem digitalen Spieltisch – der Browser des Spielleiters
  const tableStream = (room) => { const S = room.game.S, tok = S.players[S.host] && S.players[S.host].token, set = tok && clients.get(tok); return !!(S.settings.table && set && [...set].some((r) => r.tableMode)); };
  const displays = (room) => (room.watchers ? [...room.watchers.keys()].filter((t) => clients.has(t)).length : 0) + (tableStream(room) ? 1 : 0);
  const pview = (room, pid, viaPhone) => { const v = room.game.view(pid); v.display = displays(room) > 0; v.arm = Arm.viewFor(room, pid); if (viaPhone) v.host = -1; return v; }; // Handy am Spielleiter-Platz: keine Spielleiter-Funktionen
  const wview = (room) => { const v = room.game.watchView(); v.arm = Arm.viewFor(room, 'watch'); return v; };
  const ipOf = (req) => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress);
  const kindOf = (p) => (p.bot ? 'bot:' + p.bot : p.tableGuest ? 'tisch' : 'mensch');
  // Abschlussbericht: eine Zeile je beendeter oder abgebrochener Partie in partien.jsonl (nach einer Fortsetzung ggf. eine weitere)
  const report = (room, reason) => {
    const g = room.game, S = g.S, st = S.stats;
    if (!st) return;
    const end = st.endedAt || Date.now(), result = S.phase !== 'ended' ? 'abgebrochen' : S.aborted ? 'beendet' : 'sieg';
    const rec = {
      room: room.id, version: VERSION, startedAt: new Date(st.startedAt).toISOString(), endedAt: new Date(end).toISOString(),
      minutes: Math.round((end - st.startedAt) / 60000), rounds: st.history.filter((h) => !h.end).length, result, reason: reason || null,
      winner: S.winner !== null && S.winner !== undefined && S.players[S.winner] ? S.players[S.winner].name : null, settings: S.settings,
      players: S.players.map((p) => ({ name: p.name, color: p.color, kind: kindOf(p), vp: g.vp(p.id) + g.hiddenVp(p.id), left: !!p.left, vanished: !!p.vanished, stats: st.players[p.id] || null })),
      history: st.history.map((h) => h.vp),
    };
    log.info('partie_ende', { raum: room.id, ergebnis: result, sieger: rec.winner, runden: rec.rounds, dauer: `${rec.minutes}min`, grund: reason });
    if (opts.noSave) return;
    fs.promises.mkdir(DATA, { recursive: true }).then(() => fs.promises.appendFile(GAMES_FILE, JSON.stringify(rec) + '\n'))
      .catch((e) => log.error('bericht_fehler', { raum: room.id, fehler: e.message }));
  };
  // Phasenwechsel einer Partie protokollieren (hier laufen alle Änderungen vorbei, auch die von Bots und Auto-Modus)
  const phaseLog = (room) => {
    const S = room.game.S, was = room.lastPhase, now = S.phase;
    room.lastPhase = now;
    if (was === undefined || was === now) return;
    if (was === 'lobby' && now === 'setup') log.info('partie_start', { raum: room.id, variante: S.settings.variant, ziel: S.settings.winPoints, tisch: !!S.settings.table, spieler: S.players.map((p) => p.name + (p.bot ? '(Bot)' : p.tableGuest ? '(Tisch)' : '')).join(',') });
    else if (now === 'ended') report(room);
    else if (was === 'ended' && now === 'lobby') log.info('neue_runde', { raum: room.id });
    else if (was === 'ended') log.info('partie_weiter', { raum: room.id, ziel: S.settings.winPoints });
  };
  // Raum ist weg: lief die Partie noch, gilt sie als abgebrochen
  const roomGone = (room) => { if (room.game.S.phase === 'setup' || room.game.S.phase === 'main') report(room, room.removedWhy); };
  const broadcast = (room) => {
    if (!hub.rooms.has(room.id)) return;
    phaseLog(room);
    for (const p of room.game.S.players) {
      for (const tok of [p.token, p.phone]) {
        const set = tok && clients.get(tok);
        if (!set || !set.size) continue;
        const v = pview(room, p.id, !!p.phone && tok === p.phone);
        for (const res of set) send(res, 'state', v);
      }
    }
    // Digitaler Spieltisch: die Tisch-Verbindung des Spielleiters bekommt zusätzlich die Sicht aller Spieler
    const S = room.game.S, hostTok = S.players[S.host] && S.players[S.host].token, ts = hostTok && clients.get(hostTok);
    if (ts && S.settings.table && (S.phase === 'main' || S.phase === 'setup')) {
      const tabs = [...ts].filter((r) => r.tableMode);
      if (tabs.length) { const pub = wview(room), views = S.players.map((p) => (room.game.isTablePlayer(p.id) ? pview(room, p.id) : pub)); for (const res of tabs) send(res, 'table', { views, requests: Handover.pending(room) }); } // Online-Spieler und Bots: am Tisch nur Öffentliches
    }
    // Zuschauer: nur die öffentliche Sicht
    if (room.watchers && room.watchers.size) {
      let wv = null;
      for (const tok of room.watchers.keys()) { const set = clients.get(tok); if (!set || !set.size) continue; wv = wv || wview(room); for (const res of set) send(res, 'state', wv); }
    }
    save();
  };
  const notify = (token, ev, data) => { const set = token && clients.get(token); if (set) for (const r of set) send(r, ev, data || {}); };
  const scheduleExpire = (room, ms) => {
    const t = setTimeout(() => {
      const gone = Handover.expire(room);
      for (const r of gone) notify(r.token, 'handover', { state: 'expired', pid: r.pid });
      if (gone.length) broadcast(room);
    }, ms + 60);
    t.unref();
  };
  const HOST_ACTS = new Set(['set_settings', 'end_game', 'resume_game', 'new_game', 'regen_board', 'close_seats', 'add_bot', 'add_table_player', 'kick', 'start']);
  const bad = (m) => { throw new Game.GameError(m); };
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
      log.error('interner_fehler', { fehler: e.message }); console.error(e.stack); return new Error('Interner Fehler: ' + e.message);
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
          const out = openStream(req, res);
          out.write('retry: 2000\n\n');
          if (!clients.has(token)) clients.set(token, new Set());
          clients.get(token).add(out);
          hub.watcherConnected(watcher, true);
          log.debug('verbunden', { raum: room.id, als: 'zuschauer' }, { token: log.tok(token), ip: ipOf(req) });
          room.game.settle();
          send(out, 'state', wview(room));
          broadcast(room); // die Spieler erfahren, dass eine Tisch-Anzeige da ist
          const ping = setInterval(() => out.write('event: ping\ndata: 1\n\n'), 20000);
          req.on('close', () => {
            clearInterval(ping);
            const set = clients.get(token);
            if (set) { set.delete(out); if (!set.size) { clients.delete(token); hub.watcherConnected(watcher, false); log.debug('getrennt', { raum: room.id, als: 'zuschauer' }, { token: log.tok(token) }); broadcast(room); } }
          });
          return;
        }
        const { room, player } = f;
        const out = openStream(req, res);
        out.write('retry: 2000\n\n');
        if (!clients.has(token)) clients.set(token, new Set());
        out.tableMode = !f.phone && url.searchParams.get('table') === '1' && player.id === room.game.S.host;
        clients.get(token).add(out);
        log.debug('verbunden', { raum: room.id, spieler: player.name, pid: player.id, als: f.phone ? 'handy' : out.tableMode ? 'spieltisch' : 'spieler' }, { token: log.tok(token), ip: ipOf(req) });
        if (!f.phone) hub.connected(room, player); // das Handy am Spielleiter-Platz ändert nichts an der Verbindung des Spielleiters
        room.game.settle();
        send(out, 'state', pview(room, player.id, !!f.phone));
        broadcast(room);
        const ping = setInterval(() => out.write('event: ping\ndata: 1\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          const set = clients.get(token);
          if (set) { set.delete(out); if (!set.size) { clients.delete(token); log.debug('getrennt', { raum: room.id, spieler: player.name, pid: player.id }, { token: log.tok(token) }); if (!f.phone) hub.disconnected(room, player); broadcast(room); } }
        });
        return;
      }
      if (req.method === 'POST' && ['/api/join', '/api/watch', '/api/pick', '/api/handover', '/api/act', '/api/leave', '/api/signal'].includes(url.pathname)) {
        const b = await body(req);
        if (url.pathname === '/api/watch') {
          let out;
          const err = guarded(() => { out = hub.watch(b); });
          if (err) return json(res, 400, { error: err.message });
          log.info('zuschauer', { raum: out.game, anzahl: out.room.watchers.size }, { token: log.tok(out.token), ip: ipOf(req) });
          return json(res, 200, { token: out.token, game: out.game, watch: true });
        }
        const wf = hub.findWatcher(b.token);
        if (url.pathname === '/api/pick') { // Tisch-Anzeige: ein Ziel antippen (gilt nur, wenn ein Spieler am Handy die Aktion freigegeben hat; führt sie dann sofort aus)
          const hf = !wf && hub.findByToken(b.token), tbl = hf && hf.player.id === hf.room.game.S.host && tableStream(hf.room) ? hf : null; // oder der laufende Spieltisch des Spielleiters
          const rm = wf ? wf.room : tbl && tbl.room;
          if (!rm) return json(res, 403, { error: 'Nur eine Tisch-Anzeige (Zuschauer oder Spieltisch) kann Ziele wählen.' });
          const err = guarded(() => Arm.pick(rm, String(b.t), String(b.k), String(b.kind)));
          if (err) return json(res, 400, { error: err.message });
          broadcast(rm);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/handover') { // Zuschauer-Handy: Kontrolle über einen Platz am Spieltisch anfragen (vierstellige Nummer)
          if (!wf) return json(res, 403, { error: 'Nur ein zusehendes Gerät kann Kontrolle anfragen.' });
          let out;
          const err = guarded(() => { out = Handover.request(wf.room, b.token, Number(b.pid)); });
          if (err) return json(res, 400, { error: err.message });
          if (out.replaced) notify(out.replaced.token, 'handover', { state: 'replaced', pid: out.replaced.pid });
          scheduleExpire(wf.room, out.ttl); broadcast(wf.room);
          return json(res, 200, { code: out.req.code, ttl: out.ttl, pid: out.req.pid });
        }
        if (wf) { // Zuschauer dürfen nichts tun außer das Zuschauen beenden
          if (url.pathname !== '/api/leave') return json(res, 403, { error: 'Zuschauer können nicht mitspielen.' });
          hub.unwatch(wf.room, b.token); dropClients(b.token);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/join') {
          let out;
          const err = guarded(() => { out = hub.join(b); });
          if (err) return json(res, 400, { error: err.message, ...(err.games ? { games: err.games } : {}) });
          { const p = out.room.game.S.players[out.pid]; (out.again ? log.debug : log.info)(out.again ? 'wieder_angemeldet' : 'beitritt', { raum: out.game, spieler: p.name, pid: out.pid, farbe: p.color }, { token: log.tok(out.token), ip: ipOf(req) }); }
          broadcast(out.room);
          return json(res, 200, { token: out.token, pid: out.pid, game: out.game });
        }
        const f = hub.findByToken(b.token);
        if (!f) return json(res, 401, { error: 'Unbekannte Sitzung – bitte neu anmelden.' });
        const { room, player } = f;
        if (url.pathname === '/api/leave' && player.handover && (f.phone || player.id !== room.game.S.host)) { // Platz, den ein Handy übernommen hat: „Kontrolle an den Spieltisch“ statt Verlassen
          const tok = f.phone ? player.phone : player.token;
          Handover.handBack(room, player.id); log.info('kontrolle_tisch', { raum: room.id, spieler: player.name, pid: player.id }); notify(tok, 'control_end'); dropClients(tok); broadcast(room);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/leave') {
          const tok = player.token;
          log.info('verlassen', { raum: room.id, spieler: player.name, phase: room.game.S.phase }, { token: log.tok(tok) });
          room.game.leave(tok);
          dropClients(tok);
          if (!room.game.humans().length) { hub.deleteRoom(room.id, 'alle Menschen haben verlassen'); roomGone(room); dropRoom(room); save(); } else broadcast(room);
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
        if (['arm', 'disarm'].includes(b.type)) { // Controller-Ansicht: Aktion am Tisch freigeben (die Freigabe ist die Bestätigung)
          const me = player.id;
          const err = guarded(() => {
            if (b.type === 'arm') Arm.arm(room, me, b.mode);
            else Arm.disarm(room, me);
          });
          if (err) return json(res, 400, { error: err.message });
          broadcast(room);
          return json(res, 200, { ok: true });
        }
        if (b.type === 'handover_answer') { // der Spieltisch beantwortet eine Kontrollanfrage (Nummer vergleichen)
          let out;
          const err = guarded(() => {
            if (f.phone || player.id !== g.S.host || !g.S.settings.table) bad('Nur der Spieltisch kann Kontrollanfragen beantworten.');
            out = Handover.answer(room, Number(b.pid), b.code, !!b.accept);
          });
          if (err) return json(res, 400, { error: err.message });
          if (out.accepted) { notify(out.req.token, 'control', { pid: out.req.pid, host: out.req.pid === g.S.host }); log.info('kontrolle_handy', { raum: room.id, spieler: g.S.players[out.req.pid].name, pid: out.req.pid }, { token: log.tok(out.req.token) }); }
          else notify(out.req.token, 'handover', { state: 'declined', pid: out.req.pid });
          broadcast(room);
          return json(res, 200, { ok: true });
        }
        if (b.type === 'handback') { // das Handy – oder der Tisch, falls das Handy weg ist – gibt den Platz an den Spieltisch zurück
          let tok;
          const err = guarded(() => {
            const table = !f.phone && player.id === g.S.host && g.S.settings.table;
            const pid = table && Number.isInteger(b.pid) ? b.pid : player.id, o = g.S.players[pid];
            if (!o || !o.handover) bad('Dieser Platz wird nicht von einem Handy gesteuert.');
            const ctl = pid === g.S.host ? o.phone : o.token;
            if (b.token !== ctl && !table) bad('Das darfst du nicht.');
            tok = Handover.handBack(room, pid);
          });
          if (err) return json(res, 400, { error: err.message });
          log.info('kontrolle_tisch', { raum: room.id, durch: player.name });
          notify(tok, 'control_end'); dropClients(tok); broadcast(room);
          return json(res, 200, { ok: true });
        }
        g.lastKicked = null;
        if (f.phone && HOST_ACTS.has(b.type)) return json(res, 403, { error: 'Das Handy hat keine Spielleiter-Rechte.' });
        let actor = player.id;
        if (b.as !== undefined && b.as !== null && b.as !== player.id) { // Spieltisch: der Spielleiter handelt für einen Mitspieler
          if (!(g.S.settings.table && player.id === g.S.host && Number.isInteger(b.as) && g.isTablePlayer(b.as))) return json(res, 400, { error: 'Der digitale Spieltisch ist nicht aktiv, oder der Spieler sitzt nicht am Tisch.' });
          actor = b.as;
        }
        if (actor === player.id && !f.phone && g.S.players[actor].phone && !HOST_ACTS.has(b.type) && b.type !== 'chat') return json(res, 400, { error: 'Dieser Platz wird gerade von einem Handy gesteuert.' });
        const kicked = b.type === 'kick' && g.S.players[b.pid] ? g.S.players[b.pid].name : undefined;
        const err = guarded(() => g.act(actor, b));
        if (err) return json(res, 400, { error: err.message });
        if (g.lastKicked) { log.info('entfernt', { raum: room.id, spieler: kicked, durch: player.name }); dropClients(g.lastKicked, 'kicked'); }
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
      // no-cache + ETag: der Browser fragt jedes Mal nach, bekommt bei unveränderter Datei aber nur 304 statt der ganzen Datei
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
        const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
        const head = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
        res.writeHead(200, head);
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
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
    removed.forEach((r) => { roomGone(r); dropRoom(r); });
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
    log.info('spielstand_geladen', { spiele: hub.rooms.size });
  } catch (e) { /* neuer Start */ }
  return hub;
}

if (require.main === module) {
  log.setLevel(process.env.LOG_LEVEL || 'info');
  const hub = loadHub();
  const httpsPort = process.env.HTTPS_PORT !== undefined ? +process.env.HTTPS_PORT : 8443; // 0 = kein https
  const server = createServer({ hub, https: httpsPort > 0, httpsPort: httpsPort > 0 ? httpsPort : null });
  // LISTEN="Adresse:Port" (z. B. 127.0.0.1:8080 oder [::1]:8080) hat Vorrang vor PORT
  const m = /^(.*):(\d+)$/.exec(process.env.LISTEN || '');
  const host = m ? m[1].replace(/^\[(.*)\]$/, '$1') || undefined : undefined, port = m ? +m[2] : PORT;
  server.listen(port, host, () => log.info('start', { version: VERSION, http: `${host ? host + ':' : ''}${port}`, https: server.httpsServer ? httpsPort : 'aus', daten: DATA }));
  if (server.httpsServer) server.httpsServer.listen(httpsPort);
  const bye = (sig) => { log.info('stop', { signal: sig }); try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(hub.toJSON())); } catch (e) { /* egal */ } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}

module.exports = { createServer };
