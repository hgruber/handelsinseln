// Hex-Geometrie – Portierung von shared/geom.js (axial, pointy-top).
// Schlüssel: Hex "q,r", Kante "h1|h2", Ecke "h1|h2|h3" (jeweils sortiert).

pub const DIRS: [(i32, i32); 6] = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)];

pub fn hk(q: i32, r: i32) -> String {
    format!("{},{}", q, r)
}

pub fn parse_h(k: &str) -> (i32, i32) {
    let (a, b) = k.split_once(',').unwrap_or((k, "0"));
    (a.parse().unwrap_or(0), b.parse().unwrap_or(0))
}

/// Reihenfolge wie im Client: q, dann r.
pub fn cmp_hex(a: &str, b: &str) -> std::cmp::Ordering {
    let (qa, ra) = parse_h(a);
    let (qb, rb) = parse_h(b);
    qa.cmp(&qb).then(ra.cmp(&rb))
}

pub fn sort_keys(mut arr: Vec<String>) -> Vec<String> {
    arr.sort_by(|a, b| cmp_hex(a, b));
    arr
}

pub fn edge_key(a: &str, b: &str) -> String {
    sort_keys(vec![a.to_string(), b.to_string()]).join("|")
}

pub fn vert_key(a: &str, b: &str, c: &str) -> String {
    sort_keys(vec![a.to_string(), b.to_string(), c.to_string()]).join("|")
}

pub fn neighbors(k: &str) -> Vec<String> {
    let (q, r) = parse_h(k);
    DIRS.iter().map(|(dq, dr)| hk(q + dq, r + dr)).collect()
}

pub fn neighbor_at(k: &str, i: i64) -> String {
    let (q, r) = parse_h(k);
    let d = DIRS[(((i % 6) + 6) % 6) as usize];
    hk(q + d.0, r + d.1)
}

pub fn edge_hexes(e: &str) -> Vec<String> {
    e.split('|').map(|s| s.to_string()).collect()
}

pub fn vert_hexes(v: &str) -> Vec<String> {
    v.split('|').map(|s| s.to_string()).collect()
}

/// Zwei Endecken einer Kante.
pub fn edge_verts(e: &str) -> Vec<String> {
    let hs = edge_hexes(e);
    let (a, b) = (&hs[0], &hs[1]);
    let na = neighbors(a);
    let i = na.iter().position(|x| x == b).unwrap_or(0);
    vec![
        vert_key(a, b, &na[(i + 1) % 6]),
        vert_key(a, b, &na[(i + 5) % 6]),
    ]
}

/// Drei Kanten an einer Ecke.
pub fn vert_edges(v: &str) -> Vec<String> {
    let hs = vert_hexes(v);
    vec![
        edge_key(&hs[0], &hs[1]),
        edge_key(&hs[1], &hs[2]),
        edge_key(&hs[0], &hs[2]),
    ]
}

/// Drei Nachbarecken.
pub fn vert_neighbors(v: &str) -> Vec<String> {
    vert_edges(v)
        .iter()
        .map(|e| {
            edge_verts(e)
                .into_iter()
                .find(|x| x != v)
                .unwrap_or_default()
        })
        .collect()
}

/// Pixelposition (Hexgröße = Mittelpunkt-zu-Ecke-Radius). x/y wie in shared/geom.js.
pub fn hex_center(k: &str, size: f64) -> (f64, f64) {
    let (q, r) = parse_h(k);
    let s3 = 3f64.sqrt();
    (
        size * s3 * (q as f64 + r as f64 / 2.0),
        size * 1.5 * r as f64,
    )
}

pub fn vert_pos(v: &str, size: f64) -> (f64, f64) {
    let ps: Vec<(f64, f64)> = vert_hexes(v).iter().map(|h| hex_center(h, size)).collect();
    (
        (ps[0].0 + ps[1].0 + ps[2].0) / 3.0,
        (ps[0].1 + ps[1].1 + ps[2].1) / 3.0,
    )
}

pub fn edge_pos(e: &str, size: f64) -> (f64, f64) {
    let ps: Vec<(f64, f64)> = edge_hexes(e).iter().map(|h| hex_center(h, size)).collect();
    ((ps[0].0 + ps[1].0) / 2.0, (ps[0].1 + ps[1].1) / 2.0)
}

/// Ecken eines Hex in Zeichenreihenfolge.
pub fn hex_corners(k: &str) -> Vec<String> {
    let n = neighbors(k);
    (0..6).map(|i| vert_key(k, &n[i], &n[(i + 1) % 6])).collect()
}

pub fn hex_edges(k: &str) -> Vec<String> {
    neighbors(k).iter().map(|n| edge_key(k, n)).collect()
}
