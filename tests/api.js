'use strict';
// Schnelle Tests des Rust-Servers über echtes HTTP/SSE: Spiele, Lobby, Rechte, Signalweg,
// Verlassen/Auto-Modus und ganze Partien (Aktionen aus der Sicht gewählt).
// Aufruf: node tests/api.js   (setzt das Release-Binary voraus)
const assert = require('assert');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = process.env.RUST_SERVER || path.join(ROOT, 'rust', 'target', 'release', 'handelsinseln');
const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];
const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
async function waitPort(port, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      await new Promise((res, rej) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); res(); }); s.on('error', rej); });
      return;
    } catch (e) { await sleep(30); }
  }
  throw new Error('Port antwortet nicht');
}

async function boot(extra = {}) {
  if (!fs.existsSync(BIN)) throw new Error('Rust-Server fehlt: ' + BIN + ' – bitte cargo build --release');
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-api-'));
  const env = {
    ...process.env, PORT: String(port), DATA_DIR: data, HTTPS_PORT: '0', NO_SAVE: '1',
    LOG_LEVEL: 'error', ROOT_DIR: ROOT, RNG_SEED: '11',
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
  };
  const proc = spawn(BIN, [], { env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  await waitPort(port);
  return {
    base,
    proc,
    dataDir: data,
    close: () => { try { proc.kill('SIGKILL'); } catch (e) {} fs.rmSync(data, { recursive: true, force: true }); },
    post: async (p, body) => {
      const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, ...(await r.json()) };
    },
    get: async (p) => (await fetch(base + p)).json(),
    connect: (token) => {
      const c = { view: null, events: [], signals: [], ctrl: new AbortController() };
      (async () => {
        try {
          const res = await fetch(base + '/api/events?token=' + encodeURIComponent(token), { signal: c.ctrl.signal });
          c.status = res.status;
          if (res.status !== 200) return;
          const dec = new TextDecoder();
          let buf = '';
          for await (const chunk of res.body) {
            buf += dec.decode(chunk, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const ev = (block.match(/^event: (\w+)/m) || [])[1];
              const data = (block.match(/^data: (.*)$/m) || [])[1];
              if (!ev) continue;
              c.events.push(ev);
              if (data) {
                try {
                  const j = JSON.parse(data);
                  if (ev === 'state') c.view = j;
                  else if (ev === 'signal') c.signals.push(j);
                } catch (e) { /* egal */ }
              }
            }
          }
        } catch (e) { /* abgebrochen */ }
      })();
      return c;
    },
  };
}

async function waitUntil(fn, ms = 5000, what = 'Zustand') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(10); }
  throw new Error('Zeitüberschreitung: ' + what);
}
async function waitFor(fn, ms = 5000, what = 'Zustand') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(30); }
  throw new Error('Zeitüberschreitung: ' + what);
}

const half = (hand, need) => {
  const out = {}; let left = need;
  for (const r of RES) { const t = Math.min(hand[r] || 0, left); if (t) { out[r] = t; left -= t; } if (!left) break; }
  return out;
};
const anyCards = (view, need) => {
  const out = {}; let left = need;
  for (const r of RES) { const st = view.bank.stock[r]; const t = Math.min(st === 999 ? left : st, left); if (t) { out[r] = t; left -= t; } if (!left) break; }
  return out;
};
const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);
function bestSpot(v, list) {
  let best = null, bs = -1;
  for (const x of list) {
    let s = 0;
    for (const h of x.split('|')) { const hx = v.hexes.find((z) => z.k === h); if (hx) s += pips(hx.n); }
    if (s > bs) { bs = s; best = x; }
  }
  return best;
}
function actionFor(pid, v) {
  const L = v.legal;
  if (v.pending.discard[pid]) return { type: 'discard', cards: half(v.me.hand, v.pending.discard[pid]) };
  if (v.pending.gold[pid]) return { type: 'gold_pick', cards: anyCards(v, v.pending.gold[pid]) };
  switch (v.step) {
    case 'setup_seat': return { type: 'place_seat', seat: ['bl', 'b', 'br', 'tl', 't', 'tr', 'l', 'r'].find((s) => !v.players.some((p) => p.seat === s)) };
    case 'setup_order': return { type: 'roll' };
    case 'setup_settlement': return L.settlement.length ? { type: 'place_settlement', v: bestSpot(v, L.settlement) } : null;
    case 'setup_road': return L.road.length ? { type: 'place_road', e: L.road[0] } : L.ship.length ? { type: 'place_ship', e: L.ship[0] } : null;
    case 'roll': return { type: 'roll' };
    case 'robber': {
      if (L.robber.length) {
        const mine = (h) => Object.keys(v.verts).some((k) => v.verts[k].p === pid && k.split('|').includes(h));
        const good = L.robber.filter((h) => !mine(h));
        return { type: 'move_robber', hex: (good.length ? good : L.robber)[0] };
      }
      return L.pirate.length ? { type: 'move_pirate', hex: L.pirate[0] } : null;
    }
    case 'steal': return L.steal.length ? { type: 'steal', target: L.steal[0] } : null;
    case 'road_building': return L.road.length ? { type: 'build_road', e: L.road[0] } : L.ship.length ? { type: 'build_ship', e: L.ship[0] } : { type: 'skip_roadbuilding' };
    case 'main':
    case 'sbp': {
      if (v.afford.city && L.city.length) return { type: 'build_city', v: L.city[0] };
      if (v.afford.settlement && L.settlement.length) return { type: 'build_settlement', v: bestSpot(v, L.settlement) };
      if (v.afford.dev) return { type: 'buy_dev' };
      if (v.afford.road && L.road.length) return { type: 'build_road', e: L.road[0] };
      if (v.afford.ship && L.ship.length) return { type: 'build_ship', e: L.ship[0] };
      const h = v.me.hand;
      const need = L.city.length ? { getreide: 2, erz: 3 } : L.settlement.length ? { holz: 1, lehm: 1, wolle: 1, getreide: 1 } : { getreide: 1, erz: 1, wolle: 1 };
      const missing = RES.filter((r) => (h[r] || 0) < (need[r] || 0) && v.bank.stock[r] > 0);
      const spare = RES.filter((r) => (h[r] || 0) - (need[r] || 0) >= (v.rates[r] || 4));
      if (missing.length && spare.length) return { type: 'bank_trade', give: spare[0], get: missing[0] };
      return { type: v.step === 'sbp' ? 'sbp_done' : 'end_turn' };
    }
    default: return null;
  }
}
function choose(views) {
  for (let p = 0; p < views.length; p++) {
    const v = views[p];
    if (v && (v.pending.discard[p] || v.pending.gold[p])) return { pid: p, action: actionFor(p, v) };
  }
  const first = views.find((v) => v);
  if (!first) return null;
  const pid = first.turn;
  const v = views[pid];
  if (!v) return null;
  const a = actionFor(pid, v);
  return a ? { pid, action: a } : null;
}

async function testStatic() {
  const T = await boot();
  try {
    const img = await fetch(T.base + '/img/logo.webp');
    const etag = img.headers.get('etag');
    await img.arrayBuffer();
    assert(etag && img.status === 200, 'statische Datei mit ETag');
    assert.equal((await fetch(T.base + '/img/logo.webp', { headers: { 'If-None-Match': etag } })).status, 304, '304 bei unveränderter Datei');
    assert.equal((await fetch(T.base + '/nichtda.js')).status, 404);
    assert.equal((await fetch(T.base + '/../server/game.rs')).status === 200, false, 'kein Pfadausbruch');
    assert.equal((await fetch(T.base + '/shared/geom.js')).status, 200);
  } finally { T.close(); }
  console.log('  ✓ statische Dateien, ETag, 304, Pfadschutz');
}

async function testLobbyAndRechte() {
  const T = await boot();
  try {
    assert.deepEqual((await T.get('/api/lobby')).games, []);
    const a = await T.post('/api/join', { name: 'Anna', color: 'rot', create: true });
    assert(a.token && a.game);
    const ca = T.connect(a.token);
    await waitUntil(() => ca.view, 3000, 'erste Sicht');
    assert.equal(ca.view.host, 0);
    assert.equal((await T.post('/api/join', { name: 'Ben', color: 'rot', game: a.game })).status, 400);
    const b = await T.post('/api/join', { name: 'Ben', color: 'blau', game: a.game });
    const cb = T.connect(b.token);
    const c1 = await T.post('/api/join', { name: 'Cleo', color: 'rot', create: true });
    assert.notEqual(c1.game, a.game);
    const d = await T.post('/api/join', { name: 'Dora', color: 'gruen' });
    assert.equal(d.status, 400); assert.equal(d.games.length, 2);
    assert.equal((await T.post('/api/act', { token: b.token, type: 'set_settings', settings: { winPoints: 10 } })).status, 400);
    assert.equal((await T.post('/api/act', { token: a.token, type: 'set_settings', settings: { winPoints: 10, dice: 'auto', variant: 'nebel' } })).ok, true);
    await waitUntil(() => cb.view && cb.view.settings.winPoints === 10, 3000, 'Einstellungen');
    const before = JSON.stringify(cb.view.hexes);
    assert.equal((await T.post('/api/act', { token: a.token, type: 'regen_board' })).ok, true);
    await waitUntil(() => JSON.stringify(cb.view.hexes) !== before, 3000, 'neues Brett');
    assert.equal((await T.post('/api/signal', { token: a.token, to: 'all', data: { t: 'hello' } })).ok, true);
    await waitUntil(() => cb.signals.length === 1, 3000, 'Signal');
    assert.equal(cb.signals[0].from, 0);
    assert.equal((await T.post('/api/signal', { token: 'nope', to: 'all', data: {} })).status, 401);
    assert.equal((await T.post('/api/act', { token: a.token, type: 'close_seats', closed: true })).ok, true);
    assert.equal((await T.post('/api/join', { name: 'Emil', color: 'violett', game: a.game })).status, 400);
    assert.equal((await T.post('/api/act', { token: a.token, type: 'kick', pid: 1 })).ok, true);
    await waitUntil(() => cb.events.includes('kicked'), 3000, 'kicked');
    assert.equal((await T.post('/api/leave', { token: a.token })).ok, true);
    await waitFor(async () => (await T.get('/api/lobby')).games.length === 1, 3000, 'Spiel A weg');
    ca.ctrl.abort(); cb.ctrl.abort();
  } finally { T.close(); }
  console.log('  ✓ Lobby, Rechte, Einstellungen, Signalweg, Kick, Verlassen');
}

async function testAutoModus() {
  const T = await boot({ ABSENT_MS: 300, GRACE_MS: 400, TICK_MS: 80, BOT_MS: 100, SSE_PING_MS: 100 });
  try {
    const a = await T.post('/api/join', { name: 'Anna', color: 'rot', create: true });
    const b = await T.post('/api/join', { name: 'Ben', color: 'blau', game: a.game });
    const ca = T.connect(a.token);
    let cb = T.connect(b.token);
    await waitUntil(() => ca.view && cb.view, 3000, 'Sichten');
    assert.equal((await T.post('/api/act', { token: a.token, type: 'start' })).ok, true);
    await sleep(100);
    cb.ctrl.abort();
    await sleep(700);
    assert.equal(ca.view.players[1].connected, false, 'getrennt');
    assert.equal(ca.view.players[1].auto, true, 'Auto-Modus nach Abwesenheit');
    cb = T.connect(b.token);
    await waitUntil(() => cb.view && cb.view.players[1].auto === false, 3000, 'Rückkehr');
    ca.ctrl.abort(); cb.ctrl.abort();
    await waitFor(async () => (await T.get('/api/lobby')).games.length === 0, 4000, 'letzter Tab → Spiel weg');
  } finally { T.close(); }
  console.log('  ✓ Abwesenheit → Auto-Modus, Rückkehr, Spielende ohne Menschen');
}

async function testKopplung() {
  const T = await boot();
  try {
    const j1 = await T.post('/api/join', { name: 'Anna', color: COL[0], create: true });
    assert(j1.token, JSON.stringify(j1));
    const j2 = await T.post('/api/join', { name: 'Bert', color: COL[1], game: j1.game });
    assert(j2.token, JSON.stringify(j2));

    // PC → Handy: das anzeigende Gerät hat die Sitzung, das Handy löst ohne Sitzung ein.
    const p1 = await T.post('/api/pair', { token: j1.token });
    assert(p1.nonce && p1.secret && !p1.code, JSON.stringify(p1));
    assert.equal(p1.game, j1.game);
    assert.equal(p1.pid, j1.pid);

    let r = await T.post('/api/pair/check', { nonce: p1.nonce, secret: 'falsch' });
    assert.equal(r.status, 403, 'check ohne secret abgelehnt');
    r = await T.post('/api/pair/check', { nonce: p1.nonce, secret: p1.secret });
    assert.equal(r.claimed, false, 'noch nicht eingelöst');

    r = await T.post('/api/pair/claim', { nonce: p1.nonce });
    assert.equal(r.role, 'receiver', JSON.stringify(r));
    assert.equal(r.token, j1.token, 'Handy bekommt den Raum-Token');
    assert.equal(r.pid, j1.pid);

    r = await T.post('/api/pair/claim', { nonce: p1.nonce });
    assert.equal(r.status, 400, 'Angebot nur einmal einlösbar');
    r = await T.post('/api/pair/claim', { nonce: '0'.repeat(32) });
    assert.equal(r.status, 400, 'unbekannter Nonce abgelehnt');

    r = await T.post('/api/pair/check', { nonce: p1.nonce, secret: p1.secret });
    assert.equal(r.claimed, true);
    assert.equal(r.token, j1.token);

    // Der übertragene Token funktioniert als Sitzung.
    const c = T.connect(r.token);
    await waitUntil(() => c.view && c.view.players.length === 2, 3000, 'Sicht mit übertragenem Token');
    c.ctrl.abort();

    // Handy → PC: der PC zeigt ohne Sitzung, das Handy löst mit Sitzung ein.
    const p2 = await T.post('/api/pair', { game: j1.game });
    assert.equal(p2.pid, null, 'offenes Angebot');
    r = await T.post('/api/pair/claim', { nonce: p2.nonce, token: j2.token });
    assert.equal(r.role, 'giver', JSON.stringify(r));
    assert.equal(r.pid, j2.pid);
    r = await T.post('/api/pair/check', { nonce: p2.nonce, secret: p2.secret });
    assert.equal(r.claimed, true);
    assert.equal(r.pid, j2.pid);
    assert.equal(r.token, j2.token, 'PC bekommt den Token des Handys');

    // Ein Gerät ohne Sitzung kann ein offenes Angebot nicht einlösen.
    const p3 = await T.post('/api/pair', { game: j1.game });
    r = await T.post('/api/pair/claim', { nonce: p3.nonce });
    assert.equal(r.status, 400, 'offenes Angebot braucht ein Gerät mit Sitzung');

    // Bot über die Kopplung übernehmen: er hat keinen Token und bekommt beim Koppeln einen.
    assert.equal((await T.post('/api/act', { token: j1.token, type: 'add_table_player', name: 'Tisch', color: COL[2] })).ok, true);
    assert.equal((await T.post('/api/act', { token: j1.token, type: 'add_bot', kind: 'baumeister' })).ok, true);
    const g = (await T.get('/api/lobby')).games.find((x) => x.id === j1.game);
    const botIdx = (g.players || []).findIndex((p) => p.bot);
    assert(botIdx >= 0, 'Bot im Spiel');
    const p4 = await T.post('/api/pair', { token: j1.token, pid: botIdx });
    assert.equal(p4.pid, botIdx, 'Angebot für den Bot-Platz');
    r = await T.post('/api/pair/claim', { nonce: p4.nonce });
    assert.equal(r.role, 'receiver');
    assert(r.token, 'Bot-Platz bekommt beim Koppeln einen Token');
    const cb = T.connect(r.token);
    await waitUntil(() => cb.view && cb.view.players[botIdx] && cb.view.players[botIdx].bot == null, 3000, 'gekoppelter Bot-Platz');
    cb.ctrl.abort();

    console.log('  ✓ Gerätekopplung (PC → Handy, Handy → PC und Bot-Übernahme)');
  } finally { T.close(); }
}

async function testPerson() {
  const T = await boot();
  try {
    const id = 'a'.repeat(64);
    const cfg = await T.get('/api/config');
    assert(cfg.serverId && cfg.serverId.length > 0, 'serverId vorhanden');

    const j1 = await T.post('/api/join', { name: 'Anna', color: COL[0], create: true });
    const j2 = await T.post('/api/join', { name: 'Bert', color: COL[1], game: j1.game });
    assert(j1.token && j2.token, 'zwei Spieler');

    assert.equal((await T.post('/api/person/link', { personId: id })).status, 401, 'ohne Sitzung kein Verknüpfen');
    assert.equal((await T.post('/api/person/link', { token: 'falsch', personId: id })).status, 401, 'falscher Token');
    assert.equal((await T.post('/api/person/link', { token: j1.token, personId: 'zz' })).status, 400, 'ungültige ID');
    assert.equal((await T.post('/api/person/link', { token: j1.token, personId: id })).ok, true);

    let r = await T.post('/api/person', { personId: id });
    assert.equal(r.status, 200);
    assert.equal(r.partien.length, 1, 'genau die eigene Partie');
    assert.equal(r.partien[0].game, j1.game);
    assert.equal(r.partien[0].running, true);
    assert.equal(r.partien[0].token, j1.token, 'laufende Partie liefert den Token');

    fs.appendFileSync(path.join(T.dataDir, 'partien.jsonl'), JSON.stringify({
      room: 'alt', players: [{ name: 'Anna', vp: 9, personId: id }, { name: 'Bert', vp: 4 }],
      result: 'sieg', winner: 'Anna', rounds: 10, minutes: 30, endedAt: '2026-01-01T00:00:00Z',
    }) + '\n');
    r = await T.post('/api/person', { personId: id });
    assert.equal(r.partien.length, 2, 'laufende und beendete Partie');
    const alt = r.partien.find((p) => p.game === 'alt');
    assert(alt && alt.running === false && alt.vp === 9, 'beendete Partie aus dem Archiv');

    assert.equal((await T.post('/api/person', { personId: 'b'.repeat(64) })).partien.length, 0, 'fremde ID sieht nichts');

    console.log('  ✓ Spielerpass: Verknüpfen, laufende und beendete Partien');
  } finally { T.close(); }
}

async function testPause() {
  const T = await boot();
  try {
    const id = 'c'.repeat(64);
    // Solo gegen einen Bot, mit Spielerpass: Verlassen pausiert.
    const j = await T.post('/api/join', { name: 'Cora', color: COL[0], create: true });
    assert.equal((await T.post('/api/act', { token: j.token, type: 'add_bot', kind: 'baumeister' })).ok, true);
    assert.equal((await T.post('/api/act', { token: j.token, type: 'start' })).ok, true);
    assert.equal((await T.post('/api/person/link', { token: j.token, personId: id })).ok, true);
    assert.equal((await T.post('/api/leave', { token: j.token })).ok, true);

    let r = await T.post('/api/person', { personId: id });
    assert.equal(r.partien.length, 1, 'pausierte Partie sichtbar');
    assert.equal(r.partien[0].paused, true, 'Partie ist pausiert');
    assert.equal(r.partien[0].token, null, 'pausierte Partie liefert keinen Token');
    const games = (await T.get('/api/lobby')).games.map((x) => x.id);
    assert(!games.includes(j.game), 'pausierte Partie steht nicht in der Spieleliste');

    assert.equal((await T.post('/api/person/resume', { personId: 'd'.repeat(64), game: j.game })).status, 400, 'fremder Pass setzt nicht fort');
    r = await T.post('/api/person/resume', { personId: id, game: j.game });
    assert(r.token, 'Fortsetzen liefert einen Token');
    assert.equal(r.game, j.game);
    const c = T.connect(r.token);
    await waitUntil(() => c.view && (c.view.phase === 'setup' || c.view.phase === 'main'), 4000, 'pausierte Partie läuft nach dem Fortsetzen');
    c.ctrl.abort();
    r = await T.post('/api/person', { personId: id });
    assert.equal(r.partien[0].paused, false, 'Partie läuft wieder');

    // Ohne Spielerpass wird wie bisher abgeräumt.
    const k = await T.post('/api/join', { name: 'Dora', color: COL[2], create: true });
    await T.post('/api/act', { token: k.token, type: 'add_bot', kind: 'baumeister' });
    await T.post('/api/act', { token: k.token, type: 'start' });
    await T.post('/api/leave', { token: k.token });
    const ids = (await T.get('/api/lobby')).games.map((x) => x.id);
    assert(!ids.includes(k.game), 'ohne Pass wird die Partie abgeräumt');

    // Gemischte Runde: ein Pass reicht nicht – ohne Pass für alle wird abgeräumt.
    const m = await T.post('/api/join', { name: 'Emil', color: COL[0], create: true });
    const n = await T.post('/api/join', { name: 'Frida', color: COL[1], game: m.game });
    await T.post('/api/person/link', { token: m.token, personId: 'e'.repeat(64) });
    await T.post('/api/act', { token: m.token, type: 'start' });
    await T.post('/api/leave', { token: m.token });
    await T.post('/api/leave', { token: n.token });
    const ids2 = (await T.get('/api/lobby')).games.map((x) => x.id);
    assert(!ids2.includes(m.game), 'gemischt ohne Pass: abgeräumt');

    // Beide mit Pass: A setzt fort, B kommt danach ebenfalls zurück.
    const z = await T.post('/api/join', { name: 'Gustav', color: COL[0], create: true });
    const y = await T.post('/api/join', { name: 'Hanna', color: COL[1], game: z.game });
    await T.post('/api/person/link', { token: z.token, personId: 'f'.repeat(64) });
    await T.post('/api/person/link', { token: y.token, personId: '0'.repeat(64) });
    await T.post('/api/act', { token: z.token, type: 'start' });
    await T.post('/api/leave', { token: z.token });
    await T.post('/api/leave', { token: y.token });
    let rz = await T.post('/api/person', { personId: 'f'.repeat(64) });
    assert.equal(rz.partien[0].paused, true, 'beide Pass-Inhaber: Partie pausiert');
    rz = await T.post('/api/person/resume', { personId: 'f'.repeat(64), game: z.game });
    assert(rz.token, 'erster Spieler setzt fort');
    let ry = await T.post('/api/person', { personId: '0'.repeat(64) });
    assert.equal(ry.partien.length, 1, 'zweiter Spieler sieht die Partie weiterhin');
    assert.equal(ry.partien[0].paused, true, 'sein Platz wartet auf Rückkehr');
    ry = await T.post('/api/person/resume', { personId: '0'.repeat(64), game: z.game });
    assert(ry.token, 'zweiter Spieler kommt ebenfalls zurück');

    // Ratenschutz: nach 300 Pass-Anfragen im Fenster kommt 429.
    for (let i = 0; i < 300; i++) await T.post('/api/person', { personId: 'zz' });
    assert.equal((await T.post('/api/person', { personId: 'zz' })).status, 429, 'Pass-Anfragen sind mengenbegrenzt');

    console.log('  ✓ Pause: Verlassen mit Pass, Fortsetzen, Abräumen ohne Pass');
  } finally { T.close(); }
}

async function testGanzePartie(n, winPoints) {
  const T = await boot();
  try {
    const players = [];
    let game = null;
    for (let i = 0; i < n; i++) {
      const j = await T.post('/api/join', { name: 'Spieler' + (i + 1), color: COL[i], ...(i === 0 ? { create: true } : { game }) });
      assert(j.token, JSON.stringify(j));
      game = j.game;
      players.push({ pid: j.pid, token: j.token, client: T.connect(j.token), view: null });
    }
    await waitUntil(() => players.every((p) => p.client.view), 3000, 'Sichten');
    assert.equal((await T.post('/api/act', { token: players[0].token, type: 'set_settings', settings: { winPoints } })).ok, true);
    assert.equal((await T.post('/api/act', { token: players[0].token, type: 'start' })).ok, true);
    let steps = 0;
    const t0 = Date.now();
    while (steps < 4000 && Date.now() - t0 < 60000) {
      const views = players.map((p) => p.client.view);
      if (views[0] && views[0].phase === 'ended') break;
      const pick = choose(views);
      if (!pick) { await sleep(5); continue; }
      const beforeV = (players[0].client.view && players[0].client.view.v) || 0;
      const r = await T.post('/api/act', { token: players[pick.pid].token, ...pick.action });
      assert(r.ok, `Aktion abgelehnt: ${r.error} ${JSON.stringify(pick.action)}`);
      steps++;
      await waitUntil(() => players[0].client.view.v > beforeV, 4000, 'Sicht nach Aktion');
      const target = players[0].client.view.v;
      await waitUntil(() => players.every((p) => p.client.view.v >= target), 4000, 'Sichten verteilt');
    }
    await sleep(50);
    const end = players[0].client.view;
    assert(end.phase === 'ended', 'Partie endet (Schritte ' + steps + ')');
    assert(end.stats && end.stats.players.length === n, 'Statistik vorhanden');
    assert(end.winner !== null && end.players[end.winner].vp >= winPoints, 'Sieger mit Zielpunkten');
    players.forEach((p) => p.client.ctrl.abort());
    console.log(`  ✓ ganze Partie n=${n} (${steps} Aktionen, Sieger VP ${end.players[end.winner].vp})`);
  } finally { T.close(); }
}

(async () => {
  try {
    await testStatic();
    await testLobbyAndRechte();
    await testAutoModus();
    await testKopplung();
    await testPerson();
    await testPause();
    await testGanzePartie(2, 6);
    await testGanzePartie(3, 8);
    console.log('API-Tests bestanden');
    process.exit(0);
  } catch (e) {
    console.error('API-TEST FEHLER:', e.message);
    process.exit(1);
  }
})();
