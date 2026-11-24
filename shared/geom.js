// Gemeinsame Hex-Geometrie (Server + Client). Axial-Koordinaten, "pointy-top".
// Unbegrenzte Karte: Schlüssel entstehen rein aus Koordinaten, nicht aus einer festen Tabelle.
//   Hex     "q,r"
//   Kante   "h1|h2"        (zwei benachbarte Hexe, sortiert)
//   Ecke    "h1|h2|h3"     (drei Hexe um eine Ecke, sortiert)
(function (root) {
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const hk = (q, r) => q + ',' + r;
  // Schlüssel werden ständig zerlegt (Sortieren von Kanten/Ecken): Ergebnisse zwischenspeichern. Die Koordinaten sind
  // begrenzt, die Caches wachsen also nicht unbeschränkt. Rückgaben sind eingefroren, weil sie geteilt werden.
  const PARSED = new Map();
  const parseH = (k) => {
    let o = PARSED.get(k);
    if (!o) { const i = k.indexOf(','); o = Object.freeze({ q: +k.slice(0, i), r: +k.slice(i + 1) }); PARSED.set(k, o); }
    return o;
  };
  const cmp = (a, b) => { const A = parseH(a), B = parseH(b); return A.q - B.q || A.r - B.r; };
  const sortKeys = (arr) => arr.slice().sort(cmp);
  const edgeKey = (a, b) => sortKeys([a, b]).join('|');
  const vertKey = (a, b, c) => sortKeys([a, b, c]).join('|');
  const neighbors = (k) => { const { q, r } = parseH(k); return DIRS.map(([dq, dr]) => hk(q + dq, r + dr)); };
  const neighborAt = (k, i) => { const { q, r } = parseH(k); const d = DIRS[((i % 6) + 6) % 6]; return hk(q + d[0], r + d[1]); };
  const edgeHexes = (e) => e.split('|');
  const vertHexes = (v) => v.split('|');
  // Zwei Endecken einer Kante
  const EDGE_VERTS = new Map();
  function edgeVerts(e) {
    let out = EDGE_VERTS.get(e);
    if (!out) {
      const [a, b] = edgeHexes(e);
      const na = neighbors(a);
      const i = na.indexOf(b);
      out = Object.freeze([vertKey(a, b, na[(i + 1) % 6]), vertKey(a, b, na[(i + 5) % 6])]);
      EDGE_VERTS.set(e, out);
    }
    return out;
  }
  // Drei Kanten an einer Ecke
  function vertEdges(v) {
    const [a, b, c] = vertHexes(v);
    return [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)];
  }
  // Drei Nachbarecken
  function vertNeighbors(v) {
    return vertEdges(v).map((e) => edgeVerts(e).find((x) => x !== v));
  }
  // Pixelposition (Hexgröße = Mittelpunkt-zu-Ecke-Radius)
  const S3 = Math.sqrt(3);
  function hexCenter(k, size = 1) { const { q, r } = parseH(k); return { x: size * S3 * (q + r / 2), y: size * 1.5 * r }; }
  function vertPos(v, size = 1) {
    const ps = vertHexes(v).map((h) => hexCenter(h, size));
    return { x: (ps[0].x + ps[1].x + ps[2].x) / 3, y: (ps[0].y + ps[1].y + ps[2].y) / 3 };
  }
  function edgePos(e, size = 1) {
    const ps = edgeHexes(e).map((h) => hexCenter(h, size));
    return { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
  }
  // Ecken eines Hex in Zeichenreihenfolge
  function hexCorners(k) {
    const n = neighbors(k);
    return n.map((_, i) => vertKey(k, n[i], n[(i + 1) % 6]));
  }
  function hexEdges(k) { return neighbors(k).map((n) => edgeKey(k, n)); }
  const api = { DIRS, hk, parseH, edgeKey, vertKey, neighbors, neighborAt, edgeHexes, vertHexes, edgeVerts, vertEdges, vertNeighbors, hexCenter, vertPos, edgePos, hexCorners, hexEdges };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Geom = api;
})(typeof self !== 'undefined' ? self : this);
