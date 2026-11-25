'use strict';
// Vergleicht Node- und Rust-Server für Tisch-Partien: Tischspieler, Platzwahl, Handeln „als“,
// Controller-Ansicht (arm/pick) und Kontrollübergabe an ein Handy.
// Aufruf: node tests/diff/table.js [--seed=41]
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BIN = process.env.RUST_SERVER || path.join(ROOT, 'rust', 'target', 'release', 'handelsinseln');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)=?(.*)$/.exec(s); return m ? [m[1], m[2]] : [s, true];
}));
const SEED = +(args.seed || 41);
const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
async function waitPort(port, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { await new Promise((res, rej) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); res(); }); s.on('error', rej); }); return; } catch (e) { await sleep(40); } } throw new Error('Port antwortet nicht'); }
function startNode(port, data) { return spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: data, HTTPS_PORT: '0', RNG_SEED: String(SEED), LOG_LEVEL: 'error' }, stdio: 'ignore' }); }
function startRust(port, data) { return spawn(BIN, [], { env: { ...process.env, PORT: String(port), DATA_DIR: data, RNG_SEED: String(SEED), NO_SAVE: '1', LOG_LEVEL: 'error', ROOT_DIR: ROOT, HTTPS_PORT: '0' }, stdio: 'ignore' }); }
async function post(base, p, body) { try { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; } catch (e) { return { status: 0, error: e.message }; } }

function connect(base, token, table = false) {
  const c = { view: null, table: null, events: [], ctrl: new AbortController() };
  (async () => {
    const res = await fetch(base + '/api/events?token=' + encodeURIComponent(token) + (table ? '&table=1' : ''), { signal: c.ctrl.signal });
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
          if (!ev) continue;
          c.events.push(ev);
          if (data) { try { const j = JSON.parse(data); if (ev === 'state') c.view = j; else if (ev === 'table') c.table = j; } catch (e) { /* egal */ } }
        }
      }
    } catch (e) { /* abgebrochen */ }
  })();
  return c;
}

function firstDiff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${p || '.'}: node=${JSON.stringify(a)} rust=${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: array?`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${p}.length: node=${a.length} rust=${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  for (const k of Object.keys(a)) if (!Object.prototype.hasOwnProperty.call(b, k)) return `${p}.${k}: fehlt bei Rust`;
  for (const k of Object.keys(b)) if (!Object.prototype.hasOwnProperty.call(a, k)) return `${p}.${k}: fehlt bei Node`;
  for (const k of Object.keys(a)) { const d = firstDiff(a[k], b[k], p ? `${p}.${k}` : k); if (d) return d; }
  return null;
}
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const k of Object.keys(v)) {
    if (k === 'gameId') o[k] = 'g';
    else if (k === 'durationSec') o[k] = 0;
    else o[k] = norm(v[k]);
  }
  return o;
}
async function waitUntil(fn, ms, what) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return; await sleep(5); } throw new Error('Zeitüberschreitung: ' + what); }

function half(hand, need) { const out = {}; let left = need; for (const r of RES) { const take = Math.min(hand[r] || 0, left); if (take) { out[r] = take; left -= take; } if (!left) break; } return out; }
function anyCards(view, need) { const out = {}; let left = need; for (const r of RES) { const st = view.bank.stock[r]; const take = Math.min(st === 999 ? left : st, left); if (take) { out[r] = take; left -= take; } if (!left) break; } return out; }

const pipsOf = (n) => (n ? 6 - Math.abs(7 - n) : 0);
function spotScore(v, vert) {
  let s = 0;
  for (const h of vert.split('|')) { const hx = v.hexes.find((x) => x.k === h); if (hx) s += pipsOf(hx.n); }
  return s;
}
function bestSpot(v, list) {
  let best = null, bs = -1;
  for (const x of list) { const s = spotScore(v, x); if (s > bs) { bs = s; best = x; } }
  return best;
}
function actionFor(pid, v) {
  const L = v.legal;
  if (v.pending.discard[pid]) return { type: 'discard', cards: half(v.me.hand, v.pending.discard[pid]) };
  if (v.pending.gold[pid]) return { type: 'gold_pick', cards: anyCards(v, v.pending.gold[pid]) };
  switch (v.step) {
    case 'setup_seat': {
      // Host nimmt „br“ (erster Platz im Uhrzeigersinn) – so beginnt er nach dem Aufbau.
      const free = ['bl', 'b', 'br', 'tl', 't', 'tr', 'l', 'r'].find((s) => !v.players.some((p) => p.seat === s));
      const seat = pid === 0 && !v.players.some((p) => p.seat === 'br') ? 'br' : free;
      return { type: 'place_seat', seat };
    }
    case 'setup_order': return { type: 'roll' };
    case 'setup_settlement': return L.settlement.length ? { type: 'place_settlement', v: bestSpot(v, L.settlement) } : null;
    case 'setup_road': return L.road.length ? { type: 'place_road', e: L.road[0] } : L.ship.length ? { type: 'place_ship', e: L.ship[0] } : null;
    case 'roll': return { type: 'roll' };
    case 'robber': return L.robber.length ? { type: 'move_robber', hex: L.robber[0] } : L.pirate.length ? { type: 'move_pirate', hex: L.pirate[0] } : null;
    case 'steal': return L.steal.length ? { type: 'steal', target: L.steal[0] } : null;
    case 'road_building': return L.road.length ? { type: 'build_road', e: L.road[0] } : L.ship.length ? { type: 'build_ship', e: L.ship[0] } : { type: 'skip_roadbuilding' };
    case 'main':
    case 'sbp': {
      if (v.afford.city && L.city.length) return { type: 'build_city', v: L.city[0] };
      if (v.afford.settlement && L.settlement.length) return { type: 'build_settlement', v: bestSpot(v, L.settlement) };
      if (v.afford.dev) return { type: 'buy_dev' };
      if (v.afford.road && L.road.length) return { type: 'build_road', e: L.road[0] };
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

(async () => {
  if (!fs.existsSync(BIN)) { console.error('Rust-Server fehlt:', BIN, '– bitte cargo build --release --manifest-path rust/Cargo.toml'); process.exit(2); }
  const dirN = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-tn-'));
  const dirR = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-tr-'));
  const [pN, pR] = [await freePort(), await freePort()];
  const procN = startNode(pN, dirN), procR = startRust(pR, dirR);
  const baseN = `http://127.0.0.1:${pN}`, baseR = `http://127.0.0.1:${pR}`;
  const close = () => { try { procN.kill('SIGKILL'); } catch (e) {} try { procR.kill('SIGKILL'); } catch (e) {} };
  try {
    await waitPort(pN); await waitPort(pR);
    const hostN = await post(baseN, '/api/join', { name: 'Anna', color: 'rot', create: true });
    const hostR = await post(baseR, '/api/join', { name: 'Anna', color: 'rot', create: true });
    const gameN = hostN.game, gameR = hostR.game;
    // Tischspieler anlegen
    const tN = await post(baseN, '/api/act', { token: hostN.token, type: 'add_table_player', name: 'Bob', color: 'orange' });
    const tR = await post(baseR, '/api/act', { token: hostR.token, type: 'add_table_player', name: 'Bob', color: 'orange' });
    if (!!tN.ok !== !!tR.ok) throw new Error('add_table_player ungleich: ' + JSON.stringify([tN, tR]));
    const hostC = connect(baseN, hostN.token, true), rustHostC = connect(baseR, hostR.token, true);
    await waitUntil(() => hostC.view && rustHostC.view, 5000, 'Sichten nach Tischspieler');

    const cmp = (label) => {
      for (const [n, r, what] of [[hostC.view, rustHostC.view, 'Host-Sicht'], [hostC.table, rustHostC.table, 'Tisch-Event'], [watchN.view, watchR.view, 'Zuschauer-Sicht']]) {
        if (!n || !r) continue;
        const d = firstDiff(norm(n), norm(r));
        if (d) throw new Error(`${label}: ${what} unterscheidet sich: ${d}`);
      }
    };
    const actBoth = async (pid, action) => {
      const bodyN = { token: hostN.token, ...(pid === 0 ? {} : { as: pid }), ...action };
      const bodyR = { token: hostR.token, ...(pid === 0 ? {} : { as: pid }), ...action };
      const a = await post(baseN, '/api/act', bodyN);
      const b = await post(baseR, '/api/act', bodyR);
      if (!!a.ok !== !!b.ok || a.error !== b.error) throw new Error('Antwort ungleich für ' + JSON.stringify(action) + ': ' + JSON.stringify([a, b]));
      if (!a.ok) throw new Error('Aktion abgelehnt: ' + a.error + ' ' + JSON.stringify(action));
    };
    const settleViews = async (label) => {
      await sleep(30);
      await waitUntil(() => hostC.table && rustHostC.table, 5000, label + ': Tisch-Event');
      cmp(label);
    };

    // Start
    await actBoth(0, { type: 'start' });
    const wN = await post(baseN, '/api/watch', { game: gameN });
    const wR = await post(baseR, '/api/watch', { game: gameR });
    if (!!wN.token !== !!wR.token) throw new Error('watch ungleich: ' + JSON.stringify([wN, wR]));
    const watchN = connect(baseN, wN.token);
    const watchR = connect(baseR, wR.token);
    await waitUntil(() => hostC.table && rustHostC.table && watchN.view && watchR.view, 5000, 'Tisch-Sichten nach Start');
    await settleViews('nach Start');
    const viewOf = (pid) => hostC.table.views[pid];

    const dutyFor = () => {
      for (let p = 0; p < 2; p++) {
        const vv = viewOf(p);
        if (!vv) continue;
        if (vv.pending && (vv.pending.discard[p] || vv.pending.gold[p])) return { pid: p, action: actionFor(p, vv) };
      }
      return null;
    };
    // Aufbau bis zur Hauptphase
    for (let i = 0; i < 60; i++) {
      const vh = viewOf(0);
      if (vh.phase === 'main') break;
      const duty = dutyFor();
      if (duty) { await actBoth(duty.pid, duty.action); await settleViews('Pflicht ' + duty.action.type); continue; }
      const active = vh.turn;
      const v = viewOf(active);
      const action = actionFor(active, v);
      if (!action) throw new Error('keine Aufbauaktion für ' + JSON.stringify({ active, step: v.step }));
      await actBoth(active, action);
      await settleViews('Aufbau ' + action.type + ' pid ' + active);
    }
    if (viewOf(0).phase !== 'main') throw new Error('Aufbau nicht beendet');

    // Würfeln (der aktive Spieler), ggf. Pflichten erledigen
    for (let i = 0; i < 20; i++) {
      const vh = viewOf(0);
      if (vh.step === 'main') break;
      const duty = dutyFor();
      if (duty) { await actBoth(duty.pid, duty.action); await settleViews('Pflicht ' + duty.action.type); continue; }
      const active = vh.turn;
      const v = viewOf(active);
      const action = actionFor(active, v);
      if (!action) break;
      await actBoth(active, action);
      await settleViews('Zug ' + action.type);
    }

    // Controller-Ansicht: Spieler am Zug gibt eine Aktion frei, der Zuschauer tippt das Ziel an.
    // Dafür so lange normale Züge spielen, bis eine Aktion bezahlbar ist.
    let pickDone = false;
    for (let round = 0; round < 400 && !pickDone; round++) {
      const vh = viewOf(0);
      if (vh.phase !== 'main') break;
      const duty = dutyFor();
      if (duty) { await actBoth(duty.pid, duty.action); await settleViews('Pflicht ' + duty.action.type); continue; }
      const active = vh.turn;
      const v = viewOf(active);
      if (active === 0 && v.step === 'main') {
        const mode = ['settlement', 'city', 'road', 'ship'].find((m) => vh.afford[m] && (vh.legal[m] || []).length);
        if (mode) {
          const aN = await post(baseN, '/api/act', { token: hostN.token, type: 'arm', mode });
          const aR = await post(baseR, '/api/act', { token: hostR.token, type: 'arm', mode });
          if (!!aN.ok !== !!aR.ok) throw new Error('arm ungleich: ' + JSON.stringify([aN, aR]));
          if (aN.ok) {
            await settleViews('nach arm ' + mode);
            await waitUntil(() => watchN.view.arm && watchN.view.arm.targets && watchR.view.arm, 3000, 'arm in der Zuschauer-Sicht');
            const t = watchN.view.arm.targets[0];
            const pN2 = await post(baseN, '/api/pick', { token: wN.token, t: t.t, k: t.k, kind: t.kinds[0] });
            const pR2 = await post(baseR, '/api/pick', { token: wR.token, t: t.t, k: t.k, kind: t.kinds[0] });
            if (!!pN2.ok !== !!pR2.ok || pN2.error !== pR2.error) throw new Error('pick ungleich: ' + JSON.stringify([pN2, pR2]));
            if (!pN2.ok) throw new Error('pick abgelehnt: ' + pN2.error);
            await settleViews('nach pick ' + t.t + ':' + t.k);
            pickDone = true;
            break;
          }
        }
      }
      const action = actionFor(active, v);
      if (!action) { console.log('  (keine Aktion mehr:', v.step, 'pid', active + ')'); break; }
      await actBoth(active, action);
      await settleViews('Zug ' + action.type + ' pid ' + active);
      if (round === 399) console.log('  (nach 400 Aktionen nichts bezahlbar)');
    }
    if (!pickDone) console.log('  (keine bezahlbare Aktion zum Freigeben gefunden)');

    // Kontrollübergabe an ein Handy (Zuschauer übernimmt Bob)
    const bobPid = 1;
    const hn = await post(baseN, '/api/handover', { token: wN.token, pid: bobPid });
    const hr = await post(baseR, '/api/handover', { token: wR.token, pid: bobPid });
    if (!!hn.code !== !!hr.code || hn.status !== hr.status) throw new Error('handover-Anfrage ungleich: ' + JSON.stringify([hn, hr]));
    const an = await post(baseN, '/api/act', { token: hostN.token, type: 'handover_answer', pid: bobPid, code: hn.code, accept: true });
    const ar = await post(baseR, '/api/act', { token: hostR.token, type: 'handover_answer', pid: bobPid, code: hr.code, accept: true });
    if (!!an.ok !== !!ar.ok) throw new Error('handover_answer ungleich: ' + JSON.stringify([an, ar]));
    await settleViews('nach Kontrollübergabe');
    await waitUntil(() => watchN.view && watchR.view && watchN.view.you === bobPid && watchR.view.you === bobPid, 5000, 'Handy ist Spieler');
    const dHandy = firstDiff(norm(watchN.view), norm(watchR.view));
    if (dHandy) throw new Error('Handy-Sicht unterscheidet sich: ' + dHandy);

    // Zurück an den Spieltisch
    const bn = await post(baseN, '/api/act', { token: wN.token, type: 'handback' });
    const br = await post(baseR, '/api/act', { token: wR.token, type: 'handback' });
    if (!!bn.ok !== !!br.ok) throw new Error('handback ungleich: ' + JSON.stringify([bn, br]));
    if (!bn.ok) throw new Error('handback abgelehnt: ' + bn.error);
    await settleViews('nach Rückgabe');

    console.log(`✓ Tisch n=${SEED}: Plätze, „als“, arm/pick, Übergabe und Rückgabe gleich (Phase ${viewOf(0).phase})`);
    hostC.ctrl.abort(); rustHostC.ctrl.abort(); watchN.ctrl.abort(); watchR.ctrl.abort();
    close();
    process.exit(0);
  } catch (e) {
    console.error('✗', e.message);
    close();
    process.exit(1);
  }
})();
