'use strict';
// Spieleinstellungen: Standardwerte (= bisheriges Verhalten) und Validierung von Teiländerungen.
const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
const TERRAINS = ['wald', 'huegel', 'weide', 'acker', 'gebirge', 'gold', 'wueste', 'meer'];
const CHIPS = ['2', '3', '4', '5', '6', '8', '9', '10', '11', '12']; // (7 gibt es nicht)
const VARIANTS = ['klassisch', 'nebel', 'inseln', 'archipel'];

const nullMap = (keys) => Object.fromEntries(keys.map((k) => [k, null]));

function defaults() {
  return {
    variant: 'klassisch', plannedPlayers: 4,
    dice: 'manuell', robber: 'manuell',
    winPoints: 14, handLimit: 7, bankRate: 4, playerTrade: true,
    islandBonus: 2, islandBonusMax: 2, longestMin: 5, armyMin: 3,
    leaver: 'uebernahme', vanishRounds: 5,
    limits: {
      road: 15, ship: 15, settlement: 5, city: 4, dev: 'standard',
      bank: nullMap(RES), fogTerrain: nullMap(TERRAINS), fogChips: nullMap(CHIPS),
    },
  };
}

class SettingsError extends Error {}
const bad = (m) => { throw new SettingsError(m); };
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function int(v, lo, hi, what) {
  if (!Number.isInteger(v) || v < lo || v > hi) bad(`${what}: erlaubt sind ganze Zahlen von ${lo} bis ${hi}.`);
  return v;
}
const intOrNull = (v, lo, hi, what) => (v === null ? null : int(v, lo, hi, what));
const oneOf = (v, list, what) => { if (!list.includes(v)) bad(`${what}: ungültiger Wert.`); return v; };

// Mischt ein Teilobjekt `patch` geprüft in `cur` (Kopie) und liefert die neuen Einstellungen.
function merge(cur, patch) {
  if (!isObj(patch)) bad('Ungültige Einstellungen.');
  const s = JSON.parse(JSON.stringify(cur));
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    switch (k) {
      case 'variant': s.variant = oneOf(v, VARIANTS, 'Variante'); break;
      case 'plannedPlayers': s.plannedPlayers = int(v, 2, 6, 'Geplante Spielerzahl'); break;
      case 'dice': s.dice = oneOf(v, ['manuell', 'auto'], 'Würfeln'); break;
      case 'robber': s.robber = oneOf(v, ['manuell', 'auto'], 'Räuber'); break;
      case 'winPoints': s.winPoints = int(v, 3, 30, 'Siegpunkte'); break;
      case 'handLimit': s.handLimit = intOrNull(v, 3, 50, 'Handkarten-Limit'); break;
      case 'bankRate': s.bankRate = int(v, 2, 6, 'Bankkurs'); break;
      case 'playerTrade': if (typeof v !== 'boolean') bad('Spielerhandel: ja/nein erwartet.'); s.playerTrade = v; break;
      case 'islandBonus': s.islandBonus = int(v, 0, 5, 'Inselpunkte'); break;
      case 'islandBonusMax': s.islandBonusMax = int(v, 0, 20, 'Max. Inseln'); break;
      case 'longestMin': s.longestMin = int(v, 3, 15, 'Längster Handelsweg ab'); break;
      case 'armyMin': s.armyMin = int(v, 2, 10, 'Stärkste Schutzmacht ab'); break;
      case 'leaver': s.leaver = oneOf(v, ['uebernahme', 'verschwinden'], 'Verhalten bei Verlassen'); break;
      case 'vanishRounds': s.vanishRounds = int(v, 1, 30, 'Runden bis zum Verschwinden'); break;
      case 'limits': {
        if (!isObj(v)) bad('Limits: Objekt erwartet.');
        for (const lk of Object.keys(v)) {
          const lv = v[lk];
          if (['road', 'ship', 'settlement', 'city'].includes(lk)) s.limits[lk] = intOrNull(lv, 1, 99, 'Figurenlimit');
          else if (lk === 'dev') s.limits.dev = lv === 'standard' ? 'standard' : intOrNull(lv, 1, 99, 'Entwicklungskarten');
          else if (lk === 'bank' || lk === 'fogTerrain' || lk === 'fogChips') {
            if (!isObj(lv)) bad(`${lk}: Objekt erwartet.`);
            const keys = lk === 'bank' ? RES : lk === 'fogTerrain' ? TERRAINS : CHIPS;
            for (const x of Object.keys(lv)) {
              if (lk === 'fogChips' && x === '7') continue; // eine 7 gibt es nicht als Wertechip (Räuber-Wurf)
              if (!keys.includes(x)) bad(`${lk}: unbekannter Eintrag „${x}“.`);
              s.limits[lk][x] = intOrNull(lv[x], 0, 99, lk === 'bank' ? 'Bank-Vorrat' : lk === 'fogTerrain' ? 'Feld-Vorrat' : 'Chip-Vorrat');
            }
          } else bad(`Unbekanntes Limit „${lk}“.`);
        }
        break;
      }
      default: bad(`Unbekannte Einstellung „${k}“.`);
    }
  }
  return s;
}

module.exports = { defaults, merge, SettingsError, RES, TERRAINS, CHIPS, VARIANTS };
