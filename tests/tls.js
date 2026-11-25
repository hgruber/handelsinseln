'use strict';
// TLS des Rust-Servers: HTTPS, /api/config, Zertifikats-SANs (TLS_HOSTS), SSE über TLS.
// Aufruf: node tests/tls.js   (setzt das Release-Binary voraus)
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const tls = require('tls');

const ROOT = path.join(__dirname, '..');
const BIN = process.env.RUST_SERVER || path.join(ROOT, 'rust', 'target', 'release', 'handelsinseln');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (cond, msg) => { console.log('  ' + (cond ? '✓' : '✗'), msg); if (!cond) problems.push(msg); };

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function httpsGet(port, p, onData) {
  return new Promise((resolve, reject) => {
    const r = https.get({ host: '127.0.0.1', port, path: p, rejectUnauthorized: false }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; if (onData) onData(res, c); });
      res.on('end', () => resolve({ status: res.statusCode, body: s, headers: res.headers }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.setTimeout(5000, () => { r.destroy(new Error('Zeitüberschreitung')); });
  });
}

(async () => {
  if (!fs.existsSync(BIN)) { console.error('Rust-Server fehlt:', BIN, '– bitte cargo build --release'); process.exit(2); }
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-tls-'));
  const [pHttp, pTls] = [await freePort(), await freePort()];
  const proc = spawn(BIN, [], {
    env: {
      ...process.env, PORT: String(pHttp), HTTPS_PORT: String(pTls), TLS_HOSTS: 'handelsinseln.test,192.0.2.10',
      DATA_DIR: data, NO_SAVE: '1', LOG_LEVEL: 'error', ROOT_DIR: ROOT,
    },
    stdio: 'ignore',
  });
  try {
    let cfg = null;
    for (let i = 0; i < 300 && !cfg; i++) {
      try { cfg = JSON.parse((await httpsGet(pTls, '/api/config')).body); } catch (e) { await sleep(30); }
    }
    check(cfg && cfg.httpsPort === pTls, '/api/config meldet httpsPort');
    const lobby = await httpsGet(pTls, '/api/lobby');
    check(lobby.status === 200 && Array.isArray(JSON.parse(lobby.body).games), '/api/lobby über HTTPS');
    const index = await httpsGet(pTls, '/');
    check(index.status === 200 && index.body.toLowerCase().includes('<!doctype html'), 'index.html über HTTPS');

    const san = await new Promise((resolve, reject) => {
      const s = tls.connect({ host: '127.0.0.1', port: pTls, rejectUnauthorized: false }, () => {
        const c = s.getPeerX509Certificate();
        resolve(c && c.subjectAltName ? c.subjectAltName : '');
        s.end();
      });
      s.on('error', reject);
      s.setTimeout(5000, () => s.destroy(new Error('Zeitüberschreitung')));
    });
    check(san.includes('DNS:localhost'), 'Zertifikat enthält localhost');
    check(san.includes('IP Address:127.0.0.1'), 'Zertifikat enthält 127.0.0.1');
    check(san.includes('DNS:handelsinseln.test'), 'Zertifikat enthält TLS_HOSTS-Namen');
    check(san.includes('IP Address:192.0.2.10'), 'Zertifikat enthält TLS_HOSTS-IP');

    const join = await new Promise((resolve, reject) => {
      const r = https.request({ host: '127.0.0.1', port: pTls, path: '/api/join', method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' } }, (res) => {
        let s = '';
        res.on('data', (c) => { s += c; });
        res.on('end', () => resolve({ status: res.statusCode, ...JSON.parse(s) }));
      });
      r.on('error', reject);
      r.end(JSON.stringify({ name: 'Anna', color: 'rot', create: true }));
    });
    check(join.status === 200 && join.token, 'Beitritt über HTTPS');

    const state = await new Promise((resolve, reject) => {
      const r = https.get({ host: '127.0.0.1', port: pTls, path: '/api/events?token=' + encodeURIComponent(join.token), rejectUnauthorized: false }, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          const m = buf.match(/event: state\ndata: (.*)\n/);
          if (m) { resolve(JSON.parse(m[1])); r.destroy(); }
        });
      });
      r.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
      r.setTimeout(5000, () => { r.destroy(new Error('Zeitüberschreitung')); });
    });
    check(state && state.phase === 'lobby' && state.you === 0, 'SSE-Zustand über HTTPS');

    const httpLobby = await new Promise((resolve, reject) => {
      const r = require('http').get({ host: '127.0.0.1', port: pHttp, path: '/api/lobby' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      r.on('error', reject);
    });
    check(httpLobby === 200, 'HTTP bleibt parallel erreichbar');

    const certFile = path.join(data, 'tls', 'tls.json');
    const rec = JSON.parse(fs.readFileSync(certFile, 'utf8'));
    check(rec.hosts.includes('handelsinseln.test') && rec.hosts.includes('192.0.2.10'), 'Zertifikat gespeichert (tls.json)');
    check((fs.statSync(certFile).mode & 0o777) === 0o600, 'tls.json nur für den Besitzer lesbar');
  } catch (e) {
    console.error('✗', e.message);
    problems.push(e.message);
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(data, { recursive: true, force: true });
  }
  console.log(problems.length ? `TLS: ${problems.length} Problem(e)` : 'TLS bestanden');
  process.exit(problems.length ? 1 : 0);
})();
