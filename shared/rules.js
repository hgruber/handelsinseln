// Gemeinsame Spielkonstanten (Server + Client): Rohstoffe, Gelände, Wertechips, Farben, Entwicklungskarten, Baukosten.
// Im Browser als window.Rules (vor den anderen Skripten laden), im Server per require. Alles eingefroren.
(function (root) {
  const deepFreeze = (o) => { Object.values(o).forEach((x) => { if (x && typeof x === 'object') deepFreeze(x); }); return Object.freeze(o); };
  const api = deepFreeze({
    RES: ['holz', 'lehm', 'wolle', 'getreide', 'erz'],
    TERRAINS: ['wald', 'huegel', 'weide', 'acker', 'gebirge', 'gold', 'wueste', 'meer'],
    TERRAIN_RES: { wald: 'holz', huegel: 'lehm', weide: 'wolle', acker: 'getreide', gebirge: 'erz' },
    CHIPS: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12], // es gibt keinen Wertechip 7
    COLORS: ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'],
    DEV: ['ritter', 'siegpunkt', 'strassenbau', 'erfindung', 'monopol'],
    COST: {
      road: { lehm: 1, holz: 1 }, ship: { wolle: 1, holz: 1 },
      settlement: { lehm: 1, holz: 1, wolle: 1, getreide: 1 },
      city: { getreide: 2, erz: 3 }, dev: { erz: 1, wolle: 1, getreide: 1 },
    },
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Rules = api;
})(typeof self !== 'undefined' ? self : this);
