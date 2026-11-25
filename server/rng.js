'use strict';
// Zufallsquelle des Servers. Ohne RNG_SEED wie bisher Math.random; mit RNG_SEED ein fester, reproduzierbarer
// Generator (mulberry32), den der Rust-Server bitgleich nachbildet – Grundlage für den Vergleich beider Server
// (tests/diff.js). Die Zahlen sind nicht kryptografisch; Tokens und Zertifikate kommen weiter aus crypto.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RNG_SEED=0 ist gültig; nur eine ungesetzte/leere Variable lässt Math.random stehen.
function fromEnv(env = process.env) {
  const s = env.RNG_SEED;
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? mulberry32(n) : undefined;
}

module.exports = { mulberry32, fromEnv };
