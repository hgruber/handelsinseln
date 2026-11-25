'use strict';
// Vergleicht den laufenden Node-Server mit dem Rust-Server über HTTP/SSE:
// gleicher RNG-Seed, derselbe Treiber spielt dieselben Aktionen, nach jedem Schritt werden alle Sichten verglichen.
// Aufruf: node tests/diff/http.js [--n=4] [--seed=21] [--variant=klassisch] [--max=600] [--settings='{...}']
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BIN = process.env.RUST_SERVER || path.join(ROOT, 'rust', 'target', 'debug', 'handelsinseln');
const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];
const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)=?(.*)$/.exec(s);
  return m ? [m[1], m[2]] : [s, true];
}));
const N = +(args.n || 4);
const SEED = +(args.seed || 21);
const MAX = +(args.max || 600);
const settings = args.settings ? JSON.parse(args.settings) : (args.variant ? { variant: args.variant } : null);

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
async function waitPort(port, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { await new Promise((res, rej) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); res(); }); s.on('error', rej); }); return; } catch (e) { await sleep(40); } } throw new Error('Port ' + port + ' antwortet nicht'); }

function startNode(port, data) {
  return spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: data, HTTPS_PORT: '0', RNG_SEED: String(SEED), LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
}
function startRust(port, data) {
  return spawn(BIN, [], {
    env: { ...process.env, PORT: String(port), DATA_DIR: data, RNG_SEED: String(SEED), NO_SAVE: '1', LOG_LEVEL: 'error', ROOT_DIR: ROOT },
    stdio: 'ignore',
  });
}

async function post(base, p, body) {
  try {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  } catch (e) { return { status: 0, error: e.message }; }
}

function connect(base, token, table = false) {
  const c = { view: null, ctrl: new AbortController(), status: 0, events: [] };
  (async () => {
    const res = await fetch(base + '/api/events?token=' + encodeURIComponent(token) + (table ? '&table=1' : ''), { signal: c.ctrl.signal });
    c.status = res.status;
    if (res.status !== 200) return;
    const dec = new TextDecoder(); let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (block.match(/^event: (\w+)/m) || [])[1];
          const data = (block.match(/^data: (.*)$/m) || [])[1];
          if (ev === 'state' && data) { try { c.view = JSON.parse(data); } catch (e) { /* egal */ } }
          else if (ev) c.events.push(ev);
        }
      }
    } catch (e) { /* abgebrochen */ }
  })();
  return c;
}

// --- Vergleich ---
function firstDiff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${p || '.'}: node=${JSON.stringify(a)} rust=${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: array? node=${Array.isArray(a)} rust=${Array.isArray(b)}`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${p}.length: node=${a.length} rust=${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k)) return `${p}.${k}: fehlt im Rust-Objekt`;
  for (const k of kb) if (!Object.prototype.hasOwnProperty.call(a, k)) return `${p}.${k}: fehlt im Node-Objekt`;
  if (ka.join() !== kb.join()) return `${p}: Schlüssel ${ka} vs ${kb}`;
  for (const k of ka) { const d = firstDiff(a[k], b[k], `${dotted(p, k)}`); if (d) return d; }
  return null;
}
function dotted(p, k) { return p ? `${p}.${k}` : k; }

async function waitUntil(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(5); }
  throw new Error('Zeitüberschreitung: ' + what);
}

function half(hand, need) {
  const out = {}; let left = need;
  for (const r of RES) { const take = Math.min(hand[r] || 0, left); if (take > 0) { out[r] = take; left -= take; } if (!left) break; }
  return out;
}
function anyCards(view, need) {
  const out = {}; let left = need;
  for (const r of RES) {
    const st = view.bank.stock[r]; const cap = st === 999 ? left : st;
    const take = Math.min(cap, left);
    if (take > 0) { out[r] = take; left -= take; }
    if (!left) break;
  }
  return out;
}

// Aktion aus der Sicht des Spielers am Zug (deterministisch, ohne Zufall).
function actionFor(pid, v) {
  const step = v.step;
  const L = v.legal;
  if (v.pending.discard[pid]) return { type: 'discard', cards: half(v.me.hand, v.pending.discard[pid]) };
  if (v.pending.gold[pid]) return { type: 'gold_pick', cards: anyCards(v, v.pending.gold[pid]) };
  if (step === 'setup_seat') {
    const seat = ['bl', 'b', 'br', 'tl', 't', 'tr', 'l', 'r'].find((s) => !v.players.some((p) => p.seat === s));
    return { type: 'place_seat', seat };
  }
  if (step === 'setup_order') return { type: 'roll' };
  if (step === 'setup_settlement') return L.settlement.length ? { type: 'place_settlement', v: L.settlement[0] } : null;
  if (step === 'setup_road') {
    if (L.road.length) return { type: 'place_road', e: L.road[0] };
    if (L.ship.length) return { type: 'place_ship', e: L.ship[0] };
    return null;
  }
  if (step === 'roll') return { type: 'roll' };
  if (step === 'robber') {
    if (L.robber.length) {
      const mine = (h) => Object.keys(v.verts).some((k) => v.verts[k].p === pid && k.split('|').includes(h));
      const good = L.robber.filter((h) => !mine(h));
      return { type: 'move_robber', hex: (good.length ? good : L.robber)[0] };
    }
    if (L.pirate.length) return { type: 'move_pirate', hex: L.pirate[0] };
    return null;
  }
  if (step === 'steal') return L.steal.length ? { type: 'steal', target: L.steal[0] } : null;
  if (step === 'road_building') {
    if (L.road.length) return { type: 'build_road', e: L.road[0] };
    if (L.ship.length) return { type: 'build_ship', e: L.ship[0] };
    return { type: 'skip_roadbuilding' };
  }
  if (step !== 'main' && step !== 'sbp') return null;
  const h = v.me.hand, af = v.afford;
  if (step === 'main') {
    const dv = (t) => v.me.dev.find((d) => d.type === t && d.playable);
    if (dv('ritter')) return { type: 'play_knight' };
    if (dv('strassenbau') && (L.road.length || L.ship.length)) return { type: 'play_roadbuilding' };
    if (dv('erfindung')) {
      const ok = RES.filter((r) => v.bank.stock[r] >= 1);
      if (ok.length > 1) return { type: 'play_yop', a: ok[0], b: ok[1] };
      if (ok.length === 1 && v.bank.stock[ok[0]] >= 2) return { type: 'play_yop', a: ok[0], b: ok[0] };
    }
    if (dv('monopol')) return { type: 'play_monopoly', res: 'holz' };
  }
  if (af.city && L.city.length) return { type: 'build_city', v: L.city[0] };
  if (af.settlement && L.settlement.length) return { type: 'build_settlement', v: L.settlement[0] };
  if (af.dev) return { type: 'buy_dev' };
  if (af.road && L.road.length) return { type: 'build_road', e: L.road[0] };
  if (af.ship && L.ship.length) return { type: 'build_ship', e: L.ship[0] };
  if (L.takeover && L.takeover.edges.length) return { type: 'take_over', kind: 'edge', key: L.takeover.edges[0] };
  if (step === 'sbp') return { type: 'sbp_done' };
  // Banktausch, um ein Bauziel zu erreichen
  const need = L.city.length ? { getreide: 2, erz: 3 } : L.settlement.length ? { holz: 1, lehm: 1, wolle: 1, getreide: 1 } : { getreide: 1, erz: 1, wolle: 1 };
  const missing = RES.filter((r) => (h[r] || 0) < (need[r] || 0) && v.bank.stock[r] > 0);
  const spare = RES.filter((r) => (h[r] || 0) - (need[r] || 0) >= (v.rates[r] || 4));
  if (missing.length && spare.length) return { type: 'bank_trade', give: spare[0], get: missing[0] };
  return { type: 'end_turn' };
}

function choose(view, players) {
  if (view.phase === 'lobby') return { pid: view.host, action: { type: 'start' } };
  if (view.phase === 'ended') return null;
  for (const p of players) {
    const v = p.view;
    if (!v) continue;
    if (v.pending.discard[p.pid] || v.pending.gold[p.pid]) {
      const a = actionFor(p.pid, v);
      if (a) return { pid: p.pid, action: a };
    }
  }
  const active = view.turn;
  if (active === null || active === undefined) return null;
  const p = players[active];
  const a = p && p.view ? actionFor(active, p.view) : null;
  return a ? { pid: active, action: a } : null;
}

(async () => {
  if (!fs.existsSync(BIN)) { console.error('Rust-Server fehlt:', BIN, '– bitte cargo build'); process.exit(2); }
  const dirN = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-node-'));
  const dirR = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-rust-'));
  const [pN, pR] = [await freePort(), await freePort()];
  const procN = startNode(pN, dirN);
  const procR = startRust(pR, dirR);
  const baseN = `http://127.0.0.1:${pN}`, baseR = `http://127.0.0.1:${pR}`;
  const close = () => { try { procN.kill('SIGKILL'); } catch (e) {} try { procR.kill('SIGKILL'); } catch (e) {} };
  try {
    await waitPort(pN); await waitPort(pR);
    const gamesN = await (await fetch(baseN + '/api/lobby')).json();
    const gamesR = await (await fetch(baseR + '/api/lobby')).json();
    if (JSON.stringify(gamesN) !== JSON.stringify(gamesR)) throw new Error('Lobby-Liste unterscheidet sich');

    // Beitritt (erster eröffnet ein neues Spiel)
    const players = [];
    let gameN = null, gameR = null;
    for (let i = 0; i < N; i++) {
      const bodyN = { name: 'Spieler' + (i + 1), color: COL[i], ...(i === 0 ? { create: true } : { game: gameN }) };
      const bodyR = { name: 'Spieler' + (i + 1), color: COL[i], ...(i === 0 ? { create: true } : { game: gameR }) };
      const a = await post(baseN, '/api/join', bodyN);
      const b = await post(baseR, '/api/join', bodyR);
      if (a.status !== 200 || b.status !== 200) throw new Error('Beitritt fehlgeschlagen: ' + JSON.stringify([a, b]));
      if (a.pid !== b.pid) throw new Error('pid unterscheidet sich: ' + a.pid + ' vs ' + b.pid);
      gameN = a.game; gameR = b.game;
      players.push({ pid: a.pid, tokenN: a.token, tokenR: b.token, view: null, clientN: null, clientR: null });
    }
    for (const p of players) {
      p.clientN = connect(baseN, p.tokenN);
      p.clientR = connect(baseR, p.tokenR);
    }
    const watchers = {};
    await waitUntil(() => players.every((p) => p.clientN.view && p.clientR.view), 5000, 'erste Sichten');
    // Start
    if (settings) {
      const a = await post(baseN, '/api/act', { token: players[0].tokenN, type: 'set_settings', settings });
      const b = await post(baseR, '/api/act', { token: players[0].tokenR, type: 'set_settings', settings });
      if (!!a.ok !== !!b.ok || a.error !== b.error) throw new Error('set_settings ungleich: ' + JSON.stringify([a, b]));
    }
    let stepNo = 0;
    let before = players[0].clientN.view.v;
    const a0 = await post(baseN, '/api/act', { token: players[0].tokenN, type: 'start' });
    const b0 = await post(baseR, '/api/act', { token: players[0].tokenR, type: 'start' });
    if (!!a0.ok !== !!b0.ok) throw new Error('start ungleich: ' + JSON.stringify([a0, b0]));
    await waitUntil(() => players[0].clientN.view.v > before && players[0].clientR.view.v > before, 5000, 'Start');
    await sleep(30);

    // Zuschauer an beiden Servern
    const wN = await post(baseN, '/api/watch', { game: gameN });
    const wR = await post(baseR, '/api/watch', { game: gameR });
    if (wN.status !== wR.status || !!wN.token !== !!wR.token) throw new Error('watch ungleich: ' + JSON.stringify([wN, wR]));
    watchers.clientN = connect(baseN, wN.token);
    watchers.clientR = connect(baseR, wR.token);
    await waitUntil(() => watchers.clientN.view && watchers.clientR.view, 5000, 'Zuschauer-Sicht');

    const norm = (v) => {
      if (!v) return v;
      const o = { ...v, gameId: 'g' };
      if (o.stats) o.stats = { ...o.stats, durationSec: 0 };
      return o;
    };
    const compareAll = (label) => {
      for (const p of players) {
        const d = firstDiff(norm(p.clientN.view), norm(p.clientR.view));
        if (d) throw new Error(`${label}: Sicht von Spieler ${p.pid} unterscheidet sich: ${d}`);
      }
      const d = firstDiff(norm(watchers.clientN.view), norm(watchers.clientR.view));
      if (d) throw new Error(`${label}: Zuschauer-Sicht unterscheidet sich: ${d}`);
    };
    await waitUntil(
      () => players[0].clientN.view.display === true && players[0].clientR.view.display === true,
      5000,
      'display=true nach Zuschauer-Verbindung',
    );
    await sleep(20);
    compareAll('nach Start');

    for (; stepNo < MAX; stepNo++) {
      for (const p of players) p.view = p.clientN.view;
      const pick = choose(players[0].view, players);
      if (!pick) break;
      const beforeV = players[0].clientN.view.v;
      const bodyN = { token: players[pick.pid].tokenN, ...pick.action };
      const bodyR = { token: players[pick.pid].tokenR, ...pick.action };
      const a = await post(baseN, '/api/act', bodyN);
      const b = await post(baseR, '/api/act', bodyR);
      if (!!a.ok !== !!b.ok || a.error !== b.error) {
        throw new Error(`Schritt ${stepNo}: Antwort ungleich für ${JSON.stringify(pick)}: node=${JSON.stringify(a)} rust=${JSON.stringify(b)}`);
      }
      if (!a.ok) throw new Error(`Schritt ${stepNo}: gültige Aktion abgelehnt: ${a.error} ${JSON.stringify(pick)}`);
      await waitUntil(
        () => players[0].clientN.view.v > beforeV && players[0].clientR.view.v > beforeV,
        8000,
        `Schritt ${stepNo} (${pick.action.type}): keine neue Sicht`,
      );
      const target = players[0].clientN.view.v;
      await waitUntil(
        () => players.every((p) => p.clientN.view.v >= target) && players.every((p) => p.clientR.view.v >= target),
        8000,
        `Schritt ${stepNo}: Sichten nicht verteilt`,
      );
      await sleep(5);
      compareAll(`Schritt ${stepNo} (${pick.action.type})`);
    }
    const end = players[0].clientN.view;
    console.log(`✓ HTTP n=${N} seed=${SEED}${settings ? ' ' + JSON.stringify(settings) : ''}: ${stepNo} Aktionen gleich (Phase ${end.phase}, Züge ${end.stats ? end.stats.turns : '?'})`);
    players.forEach((p) => { p.clientN.ctrl.abort(); p.clientR.ctrl.abort(); });
    watchers.clientN.ctrl.abort(); watchers.clientR.ctrl.abort();
    close();
    process.exit(0);
  } catch (e) {
    console.error('✗', e.message);
    close();
    process.exit(1);
  }
})();
