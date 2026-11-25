'use strict';
// Betriebslog: eine Zeile je Ereignis auf stdout (Rotation übernimmt journald bzw. der Container-Logtreiber).
// Format: <Zeit> <STUFE> <ereignis> feld=wert …  Stufen: error, warn, info, debug; LOG_LEVEL=silent schaltet ab.
// `dbg`-Felder (Tokens, IP-Adressen) erscheinen nur bei LOG_LEVEL=debug.
const LEVELS = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };
let level = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.warn; // eingebettet (Tests): nur Warnungen und Fehler; server.js setzt beim Start info

const fmt = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[\w.:\-/@+]+$/.test(s) ? s : JSON.stringify(s);
};
const line = (lv, ev, fields, dbg) => {
  if (LEVELS[lv] > level) return;
  const all = level >= LEVELS.debug && dbg ? { ...fields, ...dbg } : fields || {};
  const parts = [new Date().toISOString(), lv.toUpperCase().padEnd(5), ev];
  for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${fmt(v)}`);
  (lv === 'error' || lv === 'warn' ? console.error : console.log)(parts.join(' '));
};

module.exports = {
  setLevel(name) { if (name in LEVELS) level = LEVELS[name]; },
  isDebug: () => level >= LEVELS.debug,
  error: (ev, f, d) => line('error', ev, f, d),
  warn: (ev, f, d) => line('warn', ev, f, d),
  info: (ev, f, d) => line('info', ev, f, d),
  debug: (ev, f, d) => line('debug', ev, f, d),
  tok: (t) => (t ? String(t).slice(0, 8) : undefined), // gekürzt: reicht zum Zuordnen, taugt nicht als Zugangsschlüssel
};
