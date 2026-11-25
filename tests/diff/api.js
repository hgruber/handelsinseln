'use strict';
// Vergleicht die HTTP-Randwege: Signalweg (Sprachchat), Kick und Verlassen.
// Aufruf: node tests/diff/api.js [--seed=77]
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BIN = process.env.RUST_SERVER || path.join(ROOT, 'rust', 'target', 'release', 'handelsinseln');
const seed = (process.argv.find((a) => a.startsWith('--seed=')) || '--seed=77').split('=')[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
async function waitPort(port) {
  for (let i = 0; i < 300; i++) {
    try {
      await new Promise((res, rej) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); res(); }); s.on('error', rej); });
      return;
    } catch (e) { await sleep(30); }
  }
  throw new Error('Port antwortet nicht');
}
function start(kind, port, data) {
  const cmd = kind === 'node' ? process.execPath : BIN;
  const args = kind === 'node' ? [path.join(ROOT, 'server', 'server.js')] : [];
  return spawn(cmd, args, {
    env: { ...process.env, PORT: String(port), DATA_DIR: data, HTTPS_PORT: '0', RNG_SEED: seed, NO_SAVE: '1', LOG_LEVEL: 'error', ROOT_DIR: ROOT },
    stdio: 'ignore',
  });
}
async function post(base, p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
}
function connect(base, token) {
  const st = { view: null, signals: [], events: [], ctrl: new AbortController() };
  (async () => {
    const res = await fetch(base + '/api/events?token=' + encodeURIComponent(token), { signal: st.ctrl.signal });
    st.status = res.status;
    if (res.status !== 200) return;
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const ch of res.body) {
        buf += dec.decode(ch, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const b = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (b.match(/^event: (\w+)/m) || [])[1];
          const da = (b.match(/^data: (.*)$/m) || [])[1];
          if (!ev) continue;
          st.events.push(ev);
          if (da) {
            try {
              const j = JSON.parse(da);
              if (ev === 'signal') st.signals.push(j);
              if (ev === 'state') st.view = j;
            } catch (e) { /* egal */ }
          }
        }
      }
    } catch (e) { /* abgebrochen */ }
  })();
  return st;
}

async function scenario(kind) {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-api-'));
  const proc = start(kind, port, data);
  const base = 'http://127.0.0.1:' + port;
  try {
    await waitPort(port);
    const A = await post(base, '/api/join', { name: 'Anna', color: 'rot', create: true });
    const B = await post(base, '/api/join', { name: 'Ben', color: 'blau', game: A.game });
    const ca = connect(base, A.token);
    const cb = connect(base, B.token);
    await sleep(150);
    const s1 = await post(base, '/api/signal', { token: A.token, to: 'all', data: { t: 'hello' } });
    await sleep(150);
    const sigOK = s1.ok === true && cb.signals.length === 1 && cb.signals[0].from === 0 && cb.signals[0].data.t === 'hello';
    const s2 = await post(base, '/api/signal', { token: 'nope', to: 'all', data: {} });
    const kick = await post(base, '/api/act', { token: A.token, type: 'kick', pid: 1 });
    await sleep(200);
    const kicked = cb.events.includes('kicked');
    const bAfter = await post(base, '/api/act', { token: B.token, type: 'chat', text: 'x' });
    const leave = await post(base, '/api/leave', { token: A.token });
    await sleep(250);
    const lobby = await (await fetch(base + '/api/lobby')).json();
    ca.ctrl.abort();
    cb.ctrl.abort();
    return {
      sigOK,
      sigUnauthorized: s2.status === 401,
      kickOk: kick.ok === true,
      kicked,
      bStatusAfterKick: bAfter.status,
      leaveOk: leave.ok === true,
      roomsAfter: lobby.games.length,
    };
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(data, { recursive: true, force: true });
  }
}

(async () => {
  if (!fs.existsSync(BIN)) { console.error('Rust-Server fehlt:', BIN, '– bitte cargo build --release --manifest-path rust/Cargo.toml'); process.exit(2); }
  const n = await scenario('node');
  const r = await scenario('rust');
  const keys = Object.keys(n);
  const bad = keys.filter((k) => n[k] !== r[k]);
  if (bad.length) {
    console.error('✗ Signal/Kick/Verlassen unterscheiden sich:', bad.map((k) => `${k}: node=${n[k]} rust=${r[k]}`).join(', '));
    process.exit(1);
  }
  console.log('✓ Signalweg, Kick und Verlassen gleich');
})();
