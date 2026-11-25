'use strict';
// Gleichheitstest der Spiellogik: Eine Partie wird im Node-Server gespielt und aufgezeichnet; der Rust-Server
// spielt dieselbe Aktionsfolge nach. Nach jeder Aktion wird ein kanonischer Zustands-Hash verglichen.
// Aufruf: node tests/diff/logic.js [--n=4] [--seed=1] [--variant=klassisch] [--settings='{...}'] [--max=4000]
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Game = require('../../server/game');
const { botAct } = require('../../server/bot');
const { botPlay } = require('../../server/botplay');
const { mulberry32 } = require('../../server/rng');

const ROOT = path.join(__dirname, '..', '..');
const BIN = process.env.TRACECHECK || path.join(ROOT, 'rust', 'target', 'release', 'tracecheck');
const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = /^--([^=]+)=?(.*)$/.exec(s);
  return m ? [m[1], m[2]] : [s, true];
}));
const n = +(args.n || 4);
const seed = +(args.seed || 1);
const maxSteps = +(args.max || 6000);
const botMode = args.bot === 'play';
const botSeed = (seed ^ 0x9e3779b9) >>> 0;
const fixedNow = 1000;
const personaFor = (pid) => ['baumeister', 'haendler', 'ritter'][pid % 3];
const settings = args.settings ? JSON.parse(args.settings) : (args.variant ? { variant: args.variant } : null);

// --- kanonischer Zustand (Objekt-Schlüssel sortiert, Tokens/Zeiten neutralisiert) ---
function canon(v, key) {
  if (key === 'token' || key === 'phone') return '"t"';
  if (key === 'startedAt' || key === 'endedAt' || key === 'durationSec') return '0';
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => canon(x)).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(v[k], k)).join(',') + '}';
}
function hashString(s) {
  let h = 0xcbf29ce484222325n;
  const buf = Buffer.from(s, 'utf8');
  for (const b of buf) { h ^= BigInt(b); h = BigInt.asUintN(64, h * 0x100000001b3n); }
  return h.toString(16).padStart(16, '0');
}
// Alle Sichten (jeder Spieler + öffentliche Zuschauer-Sicht) – der Vertrag zum Client.
function hashViews(g) {
  let s = '';
  for (let i = 0; i < g.S.players.length; i++) s += canon(g.view(i)) + '|';
  s += canon(g.watchView());
  return hashString(s);
}

// --- Node-Partie aufzeichnen ---
const gameRnd = mulberry32(seed);
const botRnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
const g = new Game({ rnd: gameRnd, meta: { id: 'test', name: 'Testspiel' } });
const players = [];
for (let i = 0; i < n; i++) {
  const r = g.join('Spieler' + (i + 1), COL[i]);
  players.push({ name: 'Spieler' + (i + 1), color: COL[i], token: r.token });
}
const trace = [{ kind: 'init', seed, players: players.map((p) => ({ name: p.name, color: p.color })), ...(settings ? { settings } : {}), ...(botMode ? { bot: true, botSeed, now: fixedNow, max: maxSteps } : {}) }];
const hashes = [];
let sent = null;
const origAct = g.act.bind(g);
g.act = (pid, a) => { sent = a; return origAct(pid, a); };
const record = (pid) => { hashes.push(hashViews(g)); trace.push({ kind: 'act', pid, action: sent }); };

if (settings) { g.act(0, { type: 'set_settings', settings }); record(0); }
g.act(0, { type: 'start' }); record(0);

let steps = 0, stuck = 0;
const t0 = Date.now();
while (g.S.phase !== 'ended' && g.S.turnNo < 1200 && steps < maxSteps && Date.now() - t0 < 120000) {
  let acted = false;
  for (let pid = 0; pid < n && g.S.phase !== 'ended'; pid++) {
    sent = null;
    let ok = false;
    try { ok = botMode ? botPlay(g, pid, { as: personaFor(pid), rnd: botRnd, now: () => fixedNow }) : botAct(g, pid, { rnd: botRnd }); } catch (e) { if (!(e instanceof Game.GameError)) throw e; ok = false; }
    if (ok) { steps++; acted = true; record(pid); }
  }
  if (!acted) {
    if (++stuck > 3) { console.log('  (Partie hängt in', g.stepOf(), ')'); break; }
  } else stuck = 0;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handelsinseln-trace-'));
const tracePath = path.join(tmp, 'trace.jsonl');
fs.writeFileSync(tracePath, trace.map((x) => JSON.stringify(x)).join('\n') + '\n');
const r = spawnSync(BIN, [tracePath], { encoding: 'utf8' });
if (r.error) { console.error('Rust-Tracecheck nicht startbar:', r.error.message, '– bitte cargo build --release --manifest-path rust/Cargo.toml'); process.exit(2); }
if (r.status !== 0) { console.error('Rust-Tracecheck Fehler:', r.stderr); process.exit(2); }
const rustHashes = r.stdout.trim().split('\n');
let bad = -1;
for (let i = 0; i < Math.max(hashes.length, rustHashes.length); i++) {
  if (hashes[i] !== rustHashes[i]) { bad = i; break; }
}
if (bad >= 0) {
  console.log(`✗ n=${n} seed=${seed}${settings ? ' ' + JSON.stringify(settings) : ''}: Abweichung nach Aktion ${bad}`);
  const act = trace.filter((x) => x.kind === 'act')[bad];
  console.log('  Aktion:', JSON.stringify(act));
  console.log('  Node:', hashes[bad], ' Rust:', rustHashes[bad]);
  console.log('  Trace:', tracePath);
  process.exit(1);
}
console.log(`✓ n=${n} seed=${seed}${settings ? ' ' + JSON.stringify(settings) : ''}: ${hashes.length} Aktionen gleich (Phase ${g.S.phase}, Züge ${g.S.turnNo})`);
fs.rmSync(tmp, { recursive: true, force: true });
