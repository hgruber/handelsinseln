#!/usr/bin/env node
// Testhilfe: setzt den Rohstoffvorrat eines Spielers auf je 20 (alle begonnenen Partien, in denen er mitspielt).
//   node scripts/rohstoffe.js <Spielername>
// Datenverzeichnis wie beim Server über DATA_DIR, Standard /tmp/handelsinseln-dev (= npm run dev).
// Läuft ein Server mit diesem Datenverzeichnis, wird er zuerst beendet (SIGTERM: er speichert dabei seinen Stand),
// sonst würde er die Änderung beim nächsten Speichern überschreiben. Danach den Server neu starten (npm run dev).
// Linux (liest /proc). Die Bank wird nicht angepasst.
'use strict';
const fs = require('fs'), path = require('path');
const { RES } = require('../shared/rules');

const MENGE = 20;
const name = process.argv.slice(2).join(' ').trim();
if (!name) { console.error('Aufruf: node scripts/rohstoffe.js <Spielername>'); process.exit(2); }
const DATA = path.resolve(process.env.DATA_DIR || '/tmp/handelsinseln-dev');
const STATE = path.join(DATA, 'state.json');
const ROOT = path.resolve(__dirname, '..');

// Server-Prozesse (Rust-Binary) finden, die in dieses Datenverzeichnis speichern
function serverPids() {
  const pids = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d) || +d === process.pid) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0');
      if (!/(^|\/)handelsinseln$/.test(cmd[0])) continue;
      const env = fs.readFileSync(`/proc/${d}/environ`, 'utf8').split('\0').find((e) => e.startsWith('DATA_DIR='));
      const cwd = fs.readlinkSync(`/proc/${d}/cwd`);
      const dir = env ? path.resolve(cwd, env.slice(9)) : path.join(ROOT, 'data');
      if (dir === DATA) pids.push(+d);
    } catch (e) { /* Prozess weg oder nicht lesbar */ }
  }
  return pids;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const pids = serverPids();
if (pids.length) {
  console.log(`Server läuft (PID ${pids.join(', ')}) – wird beendet …`);
  for (const p of pids) { try { process.kill(p, 'SIGTERM'); } catch (e) { /* schon weg */ } }
  const bis = Date.now() + 10000;
  while (pids.some(alive) && Date.now() < bis) sleep(200);
  const rest = pids.filter(alive);
  if (rest.length) { console.error(`Server reagiert nicht (PID ${rest.join(', ')}) – abgebrochen, nichts geändert.`); process.exit(1); }
  console.log('Server beendet, Stand gespeichert.');
}

let state;
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { console.error(`${STATE} nicht lesbar: ${e.message}`); process.exit(1); }
const treffer = [];
for (const r of state.rooms || []) {
  const S = r.S || {};
  if (!S.players || S.phase === 'lobby') continue; // in der Lobby gibt es noch keine Handkarten
  for (const p of S.players) if (p && p.name === name) { p.hand = Object.fromEntries(RES.map((k) => [k, MENGE])); treffer.push(r.id); }
}
if (!treffer.length) {
  const namen = [...new Set((state.rooms || []).flatMap((r) => ((r.S && r.S.phase !== 'lobby' && r.S.players) || []).map((p) => p && p.name).filter(Boolean)))];
  console.error(`Kein Spieler „${name}“ in einer begonnenen Partie. Vorhanden: ${namen.join(', ') || '–'}`);
  process.exit(1);
}
fs.copyFileSync(STATE, STATE + '.bak');
fs.writeFileSync(STATE + '.tmp', JSON.stringify(state));
fs.renameSync(STATE + '.tmp', STATE);
console.log(`${name}: je ${MENGE} ${RES.join(', ')} in Raum ${treffer.join(', ')}. Sicherung: ${STATE}.bak`);
console.log(pids.length ? 'Jetzt den Server neu starten (npm run dev).' : 'Beim nächsten Serverstart wird der Stand geladen.');
