// woerter.js – Wortliste für den Spielerpass (4 Wörter ≈ 32 Bit).
// Kurz, ohne Umlaute und ß, damit der Pass gut abtippbar ist.
(function (root) {
  'use strict';
  const WOERTER = [
    'anker', 'boot', 'hafen', 'insel', 'kueste', 'meer', 'nebel', 'segel', 'ufer', 'welle', 'wind', 'sand', 'stein', 'muschel', 'krebs', 'tang',
    'fisch', 'wal', 'delfin', 'robbe', 'moewe', 'albatros', 'pinguin', 'koralle', 'riff', 'bucht', 'kap', 'leuchtturm', 'kompass', 'karte', 'ruder', 'mast',
    'deck', 'kabine', 'ladung', 'fracht', 'handel', 'markt', 'preis', 'geld', 'gold', 'silber', 'kupfer', 'ware', 'kiste', 'fass', 'netz', 'leine',
    'knoten', 'tau', 'boje', 'flagge', 'signal', 'horn', 'glocke', 'laterne', 'feuer', 'rauch', 'asche', 'holz', 'brett', 'planke', 'balken', 'nagel',
    'hammer', 'werkzeug', 'beil', 'axt', 'schaufel', 'eimer', 'seil', 'leiter', 'rad', 'wagen', 'karren', 'achse', 'speiche', 'kurbel', 'backofen', 'brot',
    'mehl', 'salz', 'zucker', 'honig', 'milch', 'butter', 'apfel', 'birne', 'pflaume', 'kirsche', 'traube', 'beere', 'nuss', 'eichel', 'tanne', 'eiche',
    'birke', 'ahorn', 'linde', 'weide', 'buche', 'erle', 'palme', 'banane', 'zitrone', 'orange', 'melone', 'gurke', 'tomate', 'zwiebel', 'knolle', 'kraut',
    'blatt', 'blume', 'rose', 'tulpe', 'nelke', 'distel', 'klee', 'gras', 'heide', 'moos', 'farne', 'vogel', 'adler', 'falke', 'eule', 'rabe',
    'taube', 'ente', 'gans', 'huhn', 'hahn', 'ziege', 'schaf', 'kuh', 'pferd', 'esel', 'hund', 'katze', 'maus', 'ratte', 'hase', 'fuchs',
    'wolf', 'luchs', 'hirsch', 'reh', 'eber', 'otter', 'dachs', 'igel', 'biene', 'sonne', 'mond', 'stern', 'wolke', 'regen', 'schnee', 'frost',
    'sturm', 'blitz', 'donner', 'eis', 'glut', 'schatten', 'licht', 'funke', 'rot', 'blau', 'gelb', 'schwarz', 'grau', 'braun', 'bunt', 'hell',
    'dunkel', 'blass', 'glanz', 'schimmer', 'strahl', 'farbe', 'farbig', 'haus', 'hof', 'garten', 'zaun', 'tor', 'wand', 'dach', 'fenster', 'treppe',
    'raum', 'kammer', 'keller', 'boden', 'stube', 'tisch', 'stuhl', 'bett', 'kissen', 'decke', 'lampe', 'spiegel', 'schrank', 'regal', 'schublade', 'besen',
    'topf', 'teller', 'tasse', 'gabel', 'messer', 'krug', 'stadt', 'dorf', 'weg', 'pfad', 'strasse', 'platz', 'turm', 'kirche', 'schule', 'laden',
    'werkstatt', 'scheune', 'stall', 'mauer', 'pforte', 'sommer', 'winter', 'herbst', 'tag', 'nacht', 'morgen', 'abend', 'stunde', 'woche', 'monat', 'jahr',
    'zeit', 'fest', 'feier', 'spiel', 'kralle', 'feder', 'flosse', 'schuppe', 'ranke', 'wurzel', 'stamm', 'ast',
    'nest', 'hoehle', 'pfote', 'bau',
  ];

  function zufall(n) {
    const b = new Uint8Array(n);
    const c = root.crypto;
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }

  function pass(n) {
    const k = n || 4;
    return Array.from(zufall(k), (x) => WOERTER[x % WOERTER.length]).join(' ');
  }

  root.Woerter = { list: WOERTER, pass };
})(typeof window !== 'undefined' ? window : globalThis);
