'use strict';
// Gemeinsame Konstanten und Hilfen der Spiellogik (game.js und ihre Teilbereiche game_*.js).
const crypto = require('crypto');
const G = require('../shared/geom');
const B = require('./board');
const ST = require('./settings');
const AV = require('../shared/avatars');

const { RES, COLORS, COST } = require('../shared/rules');
const RES_DE = { holz: 'Holz', lehm: 'Lehm', wolle: 'Wolle', getreide: 'Getreide', erz: 'Erz' };
const TERR_DE = { wald: 'Wald', huegel: 'Hügel', weide: 'Weide', acker: 'Acker', gebirge: 'Gebirge', wueste: 'Wüste', gold: 'Goldfeld', meer: 'Meer' };
const DEV_DE = { ritter: 'Ritter', siegpunkt: 'Siegpunkt', strassenbau: 'Straßenbau', erfindung: 'Erfindung', monopol: 'Monopol' };
const MIN_P = 2, MAX_P = 6;
// Digitaler Spieltisch: Plätze am Rand (b/t = unten/oben Mitte, l/r = links/rechts Mitte, Ecken: bl, br, tl, tr) und ihre Reihenfolge im Uhrzeigersinn
// Spieltisch: acht Plätze – an den langen Bildschirmseiten (unten/oben) je drei, an den kurzen (links/rechts) einer – und ihre Reihenfolge im Uhrzeigersinn.
// Jeder Tischspieler wählt seinen Platz beim Spielstart.
const SEATS = ['bl', 'b', 'br', 'tl', 't', 'tr', 'l', 'r'];
const SEAT_CLOCK = ['br', 'b', 'bl', 'l', 'tl', 't', 'tr', 'r'];
const DEV_MIX = { ritter: 14, siegpunkt: 5, strassenbau: 2, erfindung: 2, monopol: 2 }; // Mischungsverhältnis
const UNLIMITED = 999; // so zeigt die Sicht unbegrenzte Vorräte an

class GameError extends Error {}
const fail = (m) => { throw new GameError(m); };
const emptyHand = () => ({ holz: 0, lehm: 0, wolle: 0, getreide: 0, erz: 0 });
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const fmt = (o) => Object.entries(o).filter(([, n]) => n > 0).map(([r, n]) => `${n}× ${RES_DE[r]}`).join(', ') || 'nichts';

function cleanCards(c, what) {
  const out = {};
  if (!c || typeof c !== 'object') fail('Ungültige Kartenangabe.');
  for (const r of RES) {
    const n = c[r] === undefined ? 0 : c[r];
    if (!Number.isInteger(n) || n < 0 || n > 99) fail('Ungültige Kartenanzahl.');
    if (n) out[r] = n;
  }
  return out;
}

module.exports = { crypto, G, B, ST, AV, RES, COLORS, COST, RES_DE, TERR_DE, DEV_DE, MIN_P, MAX_P, SEATS, SEAT_CLOCK, DEV_MIX, UNLIMITED, GameError, fail, emptyHand, sum, fmt, cleanCards };
