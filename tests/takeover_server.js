'use strict';
// Startet einen Server mit vorbereitetem Spiel (ein Spieler hat verlassen, Infrastruktur grenzt an) für den Browser-Test der Übernahme.
// Aufruf: node tests/takeover_server.js <port>   → gibt eine JSON-Zeile {token} aus.
const { createServer } = require('../server/server');
const G = require('../shared/geom');
const { rng } = require('./sim');

const port = +process.argv[2] || 8195;
const server = createServer({ noSave: true, rnd: rng(3), graceMs: 600000 });
const hub = server.hub;
const a = hub.join({ name: 'Mensch', color: 'rot', create: true });
const b = hub.join({ name: 'Weggegangen', color: 'blau', game: a.game });
const room = hub.rooms.get(a.game), g = room.game, S = g.S;
g.act(0, { type: 'start' });
S.hexes = {}; S.harbors = {}; S.verts = {}; S.edges = {};
const types = ['wald', 'huegel', 'weide', 'acker', 'gebirge'];
for (let q = 0; q <= 4; q++) S.hexes[G.hk(q, 0)] = { t: types[q], n: [4, 5, 6, 8, 9][q] };
for (let q = -3; q <= 7; q++) for (let r = -3; r <= 3; r++) { const k = G.hk(q, r); if (!S.hexes[k]) S.hexes[k] = { t: 'meer', n: null }; }
S.robber = '9,9'; S.hexes['9,9'] = { t: 'wueste', n: null }; S.pirate = '-3,-3'; S.home = Object.keys(S.hexes).filter((k) => S.hexes[k].t !== 'meer');
S.phase = 'main'; S.setup = null; S.order = [0, 1];
// Spieler 0 (Mensch): Siedlung + Straße; Spieler 1: Siedlung + Straße direkt anschließend
const v0 = G.vertKey('0,0', '0,1', '-1,1'); S.verts[v0] = { p: 0, k: 's' };
const e0 = G.vertEdges(v0).find((e) => g.edgeFor(e, 'r')); S.edges[e0] = { p: 0, k: 'r', t: 0 };
const end = G.edgeVerts(e0).find((v) => v !== v0);
const e1 = G.vertEdges(end).find((e) => e !== e0 && g.edgeFor(e, 'r')); S.edges[e1] = { p: 1, k: 'r', t: 0 };
const far = G.edgeVerts(e1).find((v) => v !== end); S.verts[far] = { p: 1, k: 's' };
g.pl(0).hand = { holz: 1, lehm: 1, wolle: 1, getreide: 1, erz: 1 };
g.leave(b.token);
g.startTurn(0); S.ts.rolled = true;
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ token: a.token, e1, far })));
