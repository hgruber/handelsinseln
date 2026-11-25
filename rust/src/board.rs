// Kartengenerierung – Portierung von server/board.js (Startinseln + unbegrenzt nachwachsende, entdeckbare Felder).
use indexmap::{IndexMap, IndexSet};

use crate::geom;
use crate::model::{Harbor, Hex, State};
use crate::rng::Rng;
use crate::rules::{self, RES};
use crate::settings::Settings;

pub const LAND_BAG: [&str; 18] = [
    "wald", "wald", "wald", "wald", "weide", "weide", "weide", "weide", "acker", "acker", "acker", "acker",
    "huegel", "huegel", "huegel", "gebirge", "gebirge", "gebirge",
];
pub const NUM_BAG: [u32; 18] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

pub fn shuffle<T: Clone>(a: &[T], rnd: &mut Rng) -> Vec<T> {
    let mut a = a.to_vec();
    let mut i = a.len();
    while i > 1 {
        i -= 1;
        let j = rnd.below(i + 1);
        a.swap(i, j);
    }
    a
}

pub fn is_land(t: &str) -> bool {
    !t.is_empty() && t != "meer"
}

fn red(n: u32) -> bool {
    n == 6 || n == 8
}

pub fn dist(a: &str, b: &str) -> i32 {
    let (aq, ar) = geom::parse_h(a);
    let (bq, br) = geom::parse_h(b);
    let dq = aq - bq;
    let dr = ar - br;
    (dq.abs() + dr.abs() + (dq + dr).abs()) / 2
}

fn ring_neighbors(set: &IndexSet<String>) -> IndexSet<String> {
    let mut out = IndexSet::new();
    for k in set {
        for n in geom::neighbors(k) {
            if !set.contains(&n) {
                out.insert(n);
            }
        }
    }
    out
}

/// Zusammenhängende Landfläche um ein Hex (Einfügereihenfolge wie im Original).
pub fn island(S: &State, k: &str) -> IndexSet<String> {
    let mut seen = IndexSet::new();
    let land = S.hexes.get(k).map(|h| is_land(&h.t)).unwrap_or(false);
    if !land {
        return seen;
    }
    let mut st = vec![k.to_string()];
    seen.insert(k.to_string());
    while let Some(c) = st.pop() {
        for n in geom::neighbors(&c) {
            if !seen.contains(&n) && S.hexes.get(&n).map(|h| is_land(&h.t)).unwrap_or(false) {
                seen.insert(n.clone());
                st.push(n);
            }
        }
    }
    seen
}

fn grow_blob(
    count: usize,
    rnd: &mut Rng,
    avoid: & dyn Fn(&str) -> bool,
    start: String,
    shape: Option<& dyn Fn(&str) -> f64>,
) -> IndexSet<String> {
    let mut blob: IndexSet<String> = IndexSet::new();
    blob.insert(start);
    while blob.len() < count {
        let cand: Vec<String> = ring_neighbors(&blob)
            .into_iter()
            .filter(|k| !avoid(k))
            .collect();
        if cand.is_empty() {
            break;
        }
        let mut scored: Vec<(String, f64)> = cand
            .into_iter()
            .map(|k| {
                let s = geom::neighbors(&k).iter().filter(|n| blob.contains(*n)).count() as f64
                    + rnd.next_f64() * 1.6
                    - shape.map(|f| f(&k)).unwrap_or(0.0);
                (k, s)
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        blob.insert(scored[0].0.clone());
    }
    blob
}

fn draw_number(S: &mut State, rnd: &mut Rng) -> u32 {
    if S.num_bag.is_empty() {
        S.num_bag = shuffle(&NUM_BAG, rnd);
    }
    S.num_bag.pop().unwrap_or(2)
}

pub fn gold_nums(rate: u32) -> Vec<u32> {
    let t = (rate + 1) as i32;
    [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
        .iter()
        .copied()
        .filter(|n| (*n as i32).min(14 - *n as i32) <= t)
        .collect()
}

fn draw_gold_number(S: &mut State, rnd: &mut Rng, nums: &[u32]) -> u32 {
    if S.num_bag.is_empty() {
        S.num_bag = shuffle(&NUM_BAG, rnd);
    }
    if let Some(i) = S.num_bag.iter().position(|n| nums.contains(n)) {
        return S.num_bag.remove(i);
    }
    let extra = shuffle(&NUM_BAG, rnd);
    S.num_bag.extend(extra);
    if let Some(i) = S.num_bag.iter().position(|n| nums.contains(n)) {
        return S.num_bag.remove(i);
    }
    2
}

fn draw_terrain(S: &mut State, rnd: &mut Rng) -> String {
    if S.land_bag.is_empty() {
        S.land_bag = shuffle(&LAND_BAG, rnd).iter().map(|s| s.to_string()).collect();
    }
    S.land_bag.pop().unwrap_or_else(|| "wald".to_string())
}

struct Placed {
    land: IndexSet<String>,
    islands: Vec<IndexSet<String>>,
    home: IndexSet<String>,
    desert_in: IndexSet<String>,
    explored_r: i32,
    main_count: Option<usize>,
}

fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn place_islands(
    n: usize,
    rnd: &mut Rng,
    variant: &str,
    dense: bool,
    asp: Option<f64>,
) -> Placed {
    let origin = "0,0";
    let wide = matches!(asp, Some(a) if a < 1.0 || a > 1.3);
    let sx = if wide { asp.unwrap().sqrt() } else { 1.0 };
    let sy = if wide { 1.0 / asp.unwrap().sqrt() } else { 1.0 };
    let sq3 = 3f64.sqrt();
    let to_xy = |k: &str| -> (f64, f64) {
        let (q, r) = geom::parse_h(k);
        (sq3 * (q as f64 + r as f64 / 2.0), 1.5 * r as f64)
    };
    let from_xy = |x: f64, y: f64| -> String {
        let r = js_round(y / 1.5);
        geom::hk(js_round(x / sq3 - r / 2.0) as i32, r as i32)
    };
    let stretch = |k: &str| -> String {
        if !wide {
            return k.to_string();
        }
        let p = to_xy(k);
        from_xy(p.0 * sx, p.1 * sy)
    };
    let rad = |k: &str| -> f64 {
        if !wide {
            return dist(k, origin) as f64;
        }
        let p = to_xy(k);
        f64::hypot(p.0 / sx, p.1 / sy) / 1.5
    };
    let shape = |k: &str| -> f64 { rad(k) * 0.3 };
    let shape_ref: Option<& dyn Fn(&str) -> f64> = if wide { Some(&shape) } else { None };

    let mut land: IndexSet<String> = IndexSet::new();
    let mut islands: Vec<IndexSet<String>> = Vec::new();
    let mut home_blobs: Vec<usize> = Vec::new();
    let near = |k: &str, land: &IndexSet<String>| -> bool {
        land.iter().any(|l| dist(k, l) < 2)
    };

    if variant == "inseln" {
        let size = if n <= 3 { 7 } else if n == 4 { 6 } else { 5 };
        let base = if dense { 4.0 } else { 5.0 };
        let r_f = (base / (2.0 * (std::f64::consts::PI / n as f64).sin())).ceil();
        let r = if dense {
            r_f.max(3.0) as i32
        } else {
            (r_f + 1.0) as i32
        };
        let rr = if wide {
            (r as f64 * sx.max(sy) * 1.3).ceil() as i32 + 2
        } else {
            r
        };
        let mut ring: Vec<String> = Vec::new();
        for q in -rr..=rr {
            for rr2 in -rr..=rr {
                if wide || dist(&geom::hk(q, rr2), origin) == r {
                    ring.push(geom::hk(q, rr2));
                }
            }
        }
        let rot = rnd.next_f64() * std::f64::consts::PI * 2.0;
        for i in 0..n {
            let a = rot + (i as f64 * 2.0 * std::f64::consts::PI) / n as f64;
            let tx = if wide {
                a.cos() * r as f64 * 1.5 * sx
            } else {
                a.cos() * r as f64 * 3f64.sqrt()
            };
            let ty = if wide {
                a.sin() * r as f64 * 1.5 * sy
            } else {
                a.sin() * r as f64 * 1.5
            };
            let mut sorted = ring.clone();
            sorted.sort_by(|x, y| {
                let px = geom::hex_center(x, 1.0);
                let py = geom::hex_center(y, 1.0);
                let dx = f64::hypot(px.0 - tx, px.1 - ty);
                let dy = f64::hypot(py.0 - tx, py.1 - ty);
                dx.partial_cmp(&dy).unwrap_or(std::cmp::Ordering::Equal)
            });
            let start = sorted[0].clone();
            let blob = grow_blob(size, rnd, &|k| near(k, &land), start, None);
            for k in &blob {
                land.insert(k.clone());
            }
            home_blobs.push(islands.len());
            islands.push(blob);
        }
        let center = grow_blob(3, rnd, &|k| near(k, &land), origin.to_string(), None);
        for k in &center {
            land.insert(k.clone());
        }
        islands.push(center.clone());
        // eine weitere kleine Insel weiter draußen
        for _ in 0..200 {
            let m = if wide { rr + 4 } else { r + 4 };
            let q = (rnd.next_f64() * (2 * m + 1) as f64).floor() as i32 - m;
            let r2 = (rnd.next_f64() * (2 * m + 1) as f64).floor() as i32 - m;
            let st = geom::hk(q, r2);
            if near(&st, &land) || rad(&st) < (r + 3) as f64 || (wide && rad(&st) > (r + 6) as f64) {
                continue;
            }
            let size = 1 + (rnd.next_f64() * 2.0).floor() as usize;
            let blob = grow_blob(size, rnd, &|k| near(k, &land), st, None);
            for k in &blob {
                land.insert(k.clone());
            }
            islands.push(blob);
            break;
        }
        let mut home: IndexSet<String> = IndexSet::new();
        for b in &home_blobs {
            for k in &islands[*b] {
                home.insert(k.clone());
            }
        }
        return Placed {
            land,
            islands,
            home,
            desert_in: center,
            explored_r: 2,
            main_count: None,
        };
    }

    if variant == "archipel" {
        let k = 5 + 2 * n;
        let r = ((if dense { 1.5 } else { 2.0 }) * (k as f64).sqrt()).ceil() as i32 + 2;
        for _ in 0..k {
            let w = rnd.next_f64();
            let size = if w < 0.3 {
                2
            } else if w < 0.65 {
                3
            } else if w < 0.9 {
                4
            } else {
                5
            };
            let m = if wide {
                (r as f64 * sx.max(sy) * 1.4).ceil() as i32 + 1
            } else {
                r
            };
            for _ in 0..400 {
                let q = (rnd.next_f64() * (2 * m + 1) as f64).floor() as i32 - m;
                let r2 = (rnd.next_f64() * (2 * m + 1) as f64).floor() as i32 - m;
                let st = geom::hk(q, r2);
                if rad(&st) > r as f64 || near(&st, &land) {
                    continue;
                }
                let blob = grow_blob(
                    size,
                    rnd,
                    &|x| near(x, &land) || rad(x) > (r + 1) as f64,
                    st,
                    None,
                );
                if blob.len() < 2 || blob.iter().any(|x| near(x, &land)) {
                    continue;
                }
                for x in &blob {
                    land.insert(x.clone());
                }
                islands.push(blob);
                break;
            }
        }
        let all: IndexSet<String> = land.clone();
        let di = if islands.is_empty() {
            IndexSet::new()
        } else {
            let idx = (rnd.next_f64() * islands.len() as f64).floor() as usize;
            islands[idx].clone()
        };
        return Placed {
            land,
            islands,
            home: all,
            desert_in: di,
            explored_r: 2,
            main_count: None,
        };
    }

    let main_count = if variant == "nebel" { 8 + 2 * n } else { 10 + 3 * n };
    let main = grow_blob(
        main_count,
        rnd,
        &|_| false,
        origin.to_string(),
        shape_ref,
    );
    for x in &main {
        land.insert(x.clone());
    }
    islands.push(main.clone());
    if variant == "klassisch" {
        let n_small = if n > 4 { 4 } else { 3 };
        for _ in 0..n_small {
            let size = 1 + (rnd.next_f64() * 3.0).floor() as usize;
            for _ in 0..200 {
                let rr = 6 + (rnd.next_f64() * 3.0).floor() as i32;
                let q = (rnd.next_f64() * (2 * rr + 1) as f64).floor() as i32 - rr;
                let r2 = (rnd.next_f64() * (2 * rr + 1) as f64).floor() as i32 - rr;
                let raw = geom::hk(q, r2);
                if dist(&raw, origin) > rr + 1 {
                    continue;
                }
                let start = stretch(&raw);
                if near(&start, &land) {
                    continue;
                }
                let blob = grow_blob(size, rnd, &|x| near(x, &land), start, None);
                if blob.iter().any(|x| near(x, &land)) {
                    continue;
                }
                for x in &blob {
                    land.insert(x.clone());
                }
                islands.push(blob);
                break;
            }
        }
    }
    let home: IndexSet<String> = main.iter().cloned().collect();
    Placed {
        land,
        islands,
        home,
        desert_in: main,
        explored_r: if variant == "nebel" { 1 } else { 2 },
        main_count: Some(main_count),
    }
}

fn generate_once(S: &mut State, n_players: usize, rnd: &mut Rng, settings: &Settings) {
    let variant = settings.variant.as_str();
    S.hexes.clear();
    S.harbors.clear();
    S.num_bag.clear();
    S.land_bag.clear();
    S.robber = None;
    let placed = place_islands(n_players, rnd, variant, settings.dense, settings.aspect);
    let Placed {
        land,
        islands,
        home,
        desert_in,
        explored_r,
        main_count,
    } = placed;

    // Meer: alles bis zum Aufdeckungsradius um Land ist bekannt
    let mut sea: IndexSet<String> = IndexSet::new();
    let r = explored_r;
    for l in &land {
        let (q, rr) = geom::parse_h(l);
        for dq in -r..=r {
            for dr in -r..=r {
                let k = geom::hk(q + dq, rr + dr);
                if !land.contains(&k) && dist(&k, l) <= r {
                    sea.insert(k);
                }
            }
        }
    }

    // Gelände + Zahlen
    let mut types: IndexMap<String, String> = IndexMap::new();
    let desert_arr = shuffle(&desert_in.iter().cloned().collect::<Vec<String>>(), rnd);
    let desert = desert_arr.first().cloned();
    let home_count = home.len();
    let gold_home = settings.gold_home;
    let mut gold_left: i32 = if gold_home && variant == "klassisch" && main_count.unwrap_or(0) >= 22 {
        1
    } else {
        0
    };
    for isl in &islands {
        let is_home = isl.iter().all(|k| home.contains(k));
        for k in shuffle(&isl.iter().cloned().collect::<Vec<String>>(), rnd) {
            let t = if Some(&k) == desert.as_ref() {
                "wueste".to_string()
            } else if is_home && gold_left > 0 && home_count > 0 {
                gold_left -= 1;
                "gold".to_string()
            } else if !gold_home && home.contains(&k) {
                draw_terrain(S, rnd)
            } else if variant == "archipel" && rnd.next_f64() < 0.10 {
                "gold".to_string()
            } else if !is_home {
                if rnd.next_f64() < 0.15 {
                    "gold".to_string()
                } else {
                    draw_terrain(S, rnd)
                }
            } else {
                draw_terrain(S, rnd)
            };
            types.insert(k, t);
        }
    }
    let land_keys: Vec<String> = land.iter().cloned().collect();
    let mut best: Option<IndexMap<String, u32>> = None;
    for _ in 0..300 {
        let mut nums: IndexMap<String, u32> = IndexMap::new();
        S.num_bag.clear();
        let mut order = shuffle(&land_keys, rnd);
        order.sort_by(|a, c| {
            let ca = (types.get(c).map(|x| x == "gold").unwrap_or(false)) as i8;
            let aa = (types.get(a).map(|x| x == "gold").unwrap_or(false)) as i8;
            ca.cmp(&aa)
        });
        for k in order {
            let t = types.get(&k).cloned().unwrap_or_default();
            if t == "wueste" {
                continue;
            }
            let num = if t == "gold" {
                draw_gold_number(S, rnd, &gold_nums(settings.gold_rate))
            } else {
                draw_number(S, rnd)
            };
            nums.insert(k, num);
        }
        let bad = nums.keys().any(|k| {
            red(*nums.get(k).unwrap_or(&0))
                && geom::neighbors(k).iter().any(|n| {
                    nums.get(n).map(|v| red(*v)).unwrap_or(false)
                })
        });
        let done = !bad;
        best = Some(nums);
        if done {
            break;
        }
    }
    let best = best.unwrap_or_default();
    for k in &land {
        let t = types.get(k).cloned().unwrap_or_default();
        let n = best.get(k).copied();
        S.hexes.insert(k.clone(), Hex { t: t.clone(), n });
        if t == "wueste" {
            S.robber = Some(k.clone());
        }
    }
    for k in &sea {
        S.hexes
            .insert(k.clone(), Hex { t: "meer".to_string(), n: None });
    }
    S.home = home.iter().cloned().collect();

    // Pirat auf ein Meerfeld in der Nähe der Heimatinseln
    let home_arr: Vec<String> = home.iter().cloned().collect();
    let sea_near: Vec<String> = sea
        .iter()
        .filter(|k| {
            home_arr.iter().any(|m| dist(k, m) == 2) && !home_arr.iter().any(|m| dist(k, m) < 2)
        })
        .cloned()
        .collect();
    let sea_list: Vec<String> = if !sea_near.is_empty() {
        sea_near
    } else {
        sea.iter().cloned().collect()
    };
    S.pirate = shuffle(&sea_list, rnd).into_iter().next();

    // Häfen
    let hcount = (js_round(home_count as f64 / 3.2) as usize).max(4);
    let mut kinds: Vec<String> = Vec::new();
    let harbor_bag: Vec<String> = RES
        .iter()
        .map(|x| x.to_string())
        .chain(["any", "any", "any", "any"].iter().map(|x| x.to_string()))
        .collect();
    while kinds.len() < hcount + 4 {
        kinds.extend(shuffle(&harbor_bag, rnd));
    }
    let mut edges: Vec<String> = Vec::new();
    for k in &home {
        for e in geom::hex_edges(k) {
            let o = geom::edge_hexes(&e).into_iter().find(|x| x != k);
            if let Some(hx) = o.and_then(|x| S.hexes.get(&x)) {
                if hx.t == "meer" {
                    edges.push(e);
                }
            }
        }
    }
    let mut placed_harbors = 0usize;
    for e in shuffle(&edges, rnd) {
        if placed_harbors >= hcount {
            break;
        }
        if try_harbor(S, &e, &kinds[placed_harbors]) {
            placed_harbors += 1;
        }
    }
    S.harbor_kinds = Some(kinds[placed_harbors..].to_vec());
}

// ---- Ausgleich der Startecken ------------------------------------------------------------

fn pips_of(n: Option<u32>) -> u32 {
    match n {
        Some(n) if n > 0 => {
            let d = 7i32 - n as i32;
            6 - d.abs() as u32
        }
        _ => 0,
    }
}

pub fn touches_gold(S: &State, v: &str) -> bool {
    geom::vert_hexes(v)
        .iter()
        .any(|h| S.hexes.get(h).map(|x| x.t == "gold").unwrap_or(false))
}

fn corner_info(S: &State, v: &str) -> (u32, IndexSet<String>) {
    let mut pips = 0u32;
    let mut res: IndexSet<String> = IndexSet::new();
    for h in geom::vert_hexes(v) {
        let x = match S.hexes.get(&h) {
            Some(x) => x,
            None => continue,
        };
        if !is_land(&x.t) {
            continue;
        }
        pips += pips_of(x.n);
        if x.t == "gold" {
            res.insert("gold".to_string());
        } else if let Some(r) = rules::terrain_res(&x.t) {
            res.insert(r.to_string());
        }
    }
    (pips, res)
}

fn start_imbalance(
    S: &State,
    n: usize,
    variant: &str,
    islands: &[IndexSet<String>],
    gold_start: bool,
) -> f64 {
    let mut verts: IndexMap<String, (u32, IndexSet<String>)> = IndexMap::new();
    for h in &S.home {
        for v in geom::hex_corners(h) {
            if !verts.contains_key(&v) && (gold_start || !touches_gold(S, &v)) {
                let c = corner_info(S, &v);
                if c.0 > 0 {
                    verts.insert(v, c);
                }
            }
        }
    }
    let mut taken: IndexSet<String> = IndexSet::new();
    let mut blocked: IndexSet<String> = IndexSet::new();
    let mut have: Vec<IndexSet<String>> = vec![IndexSet::new(); n];
    let mut total: Vec<u32> = vec![0; n];
    let mut order: Vec<usize> = (0..n).collect();
    order.extend((0..n).rev());
    for p in order {
        let mut best_v: Option<String> = None;
        let mut best_s = -1.0f64;
        for (v, c) in &verts {
            if taken.contains(v) || blocked.contains(v) {
                continue;
            }
            let sc = c.0 as f64
                + 1.2 * c.1.iter().filter(|r| !have[p].contains(*r)).count() as f64;
            if sc > best_s {
                best_s = sc;
                best_v = Some(v.clone());
            }
        }
        let best_v = match best_v {
            Some(v) => v,
            None => return 1e9, // Platz reicht nicht für alle
        };
        let c = verts.get(&best_v).unwrap().clone();
        taken.insert(best_v.clone());
        for x in geom::vert_neighbors(&best_v) {
            blocked.insert(x);
        }
        total[p] += c.0;
        for r in c.1 {
            have[p].insert(r);
        }
    }
    let score: Vec<f64> = (0..n).map(|p| total[p] as f64 + 2.0 * have[p].len() as f64).collect();
    let mut cost = score.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
        - score.iter().cloned().fold(f64::INFINITY, f64::min);
    cost += 4.0 * have.iter().filter(|h| h.len() < 3).count() as f64;
    let min_total = total.iter().copied().min().unwrap_or(0);
    cost += 0.5 * (12.0 - min_total as f64).max(0.0);
    if variant == "inseln" {
        let val: Vec<f64> = islands
            .iter()
            .map(|isl| {
                isl.iter()
                    .map(|k| pips_of(S.hexes.get(k).and_then(|x| x.n)) as f64)
                    .sum()
            })
            .collect();
        if !val.is_empty() {
            cost += 0.5
                * (val.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
                    - val.iter().cloned().fold(f64::INFINITY, f64::min));
        }
    }
    cost
}

#[derive(Clone)]
struct BoardParts {
    hexes: IndexMap<String, Hex>,
    harbors: IndexMap<String, Harbor>,
    num_bag: Vec<u32>,
    land_bag: Vec<String>,
    robber: Option<String>,
    home: Vec<String>,
    pirate: Option<String>,
    harbor_kinds: Option<Vec<String>>,
}

impl BoardParts {
    fn take(S: &State) -> Self {
        BoardParts {
            hexes: S.hexes.clone(),
            harbors: S.harbors.clone(),
            num_bag: S.num_bag.clone(),
            land_bag: S.land_bag.clone(),
            robber: S.robber.clone(),
            home: S.home.clone(),
            pirate: S.pirate.clone(),
            harbor_kinds: S.harbor_kinds.clone(),
        }
    }
    fn apply(self, S: &mut State) {
        S.hexes = self.hexes;
        S.harbors = self.harbors;
        S.num_bag = self.num_bag;
        S.land_bag = self.land_bag;
        S.robber = self.robber;
        S.home = self.home;
        S.pirate = self.pirate;
        S.harbor_kinds = self.harbor_kinds;
    }
}

/// Zusammenhängende Heimatinseln (nur für die Inselbewertung).
fn home_islands(S: &State, hs: &IndexSet<String>) -> Vec<IndexSet<String>> {
    let mut seen: IndexSet<String> = IndexSet::new();
    let mut out: Vec<IndexSet<String>> = Vec::new();
    for k in hs {
        if seen.contains(k) {
            continue;
        }
        let isl = island(S, k);
        for x in &isl {
            seen.insert(x.clone());
        }
        if isl.iter().all(|x| hs.contains(x)) {
            out.push(isl);
        }
    }
    out
}

/// Würfelt mehrere Karten und nimmt die mit den ausgewogensten Startecken.
pub fn generate(S: &mut State, n_players: usize, rnd: &mut Rng, settings: &Settings) {
    let variant = settings.variant.as_str();
    let mut best: Option<BoardParts> = None;
    let mut best_cost = f64::INFINITY;
    for _ in 0..40 {
        generate_once(S, n_players, rnd, settings);
        let hs: IndexSet<String> = S.home.iter().cloned().collect();
        let islands = if !S.hexes.is_empty() {
            home_islands(S, &hs)
        } else {
            Vec::new()
        };
        let cost = start_imbalance(S, n_players, variant, &islands, settings.gold_start);
        if cost < best_cost {
            best_cost = cost;
            best = Some(BoardParts::take(S));
        }
        if cost <= (if variant == "inseln" { 3.5 } else { 2.0 }) {
            break; // gut genug
        }
    }
    if let Some(b) = best {
        b.apply(S);
    }
}

/// Hafen auf Kante legen, wenn Land/Meer-Kante und Ecken noch frei von anderen Häfen.
pub fn try_harbor(S: &mut State, e: &str, kind: &str) -> bool {
    let hs = geom::edge_hexes(e);
    let (a, b) = (S.hexes.get(&hs[0]), S.hexes.get(&hs[1]));
    let (a, b) = match (a, b) {
        (Some(a), Some(b)) => (a, b),
        _ => return false,
    };
    if is_land(&a.t) == is_land(&b.t) {
        return false;
    }
    if S.harbors.contains_key(e) {
        return false;
    }
    let vs = geom::edge_verts(e);
    for (he, _) in &S.harbors {
        if geom::edge_verts(he).iter().any(|v| vs.contains(v)) {
            return false;
        }
    }
    S.harbors.insert(
        e.to_string(),
        Harbor {
            kind: kind.to_string(),
        },
    );
    true
}

// ---- Nachwachsende Felder ---------------------------------------------------------------

pub fn land_w(t: &str) -> f64 {
    match t {
        "wald" => 4.0,
        "weide" => 4.0,
        "acker" => 4.0,
        "huegel" => 3.0,
        "gebirge" => 3.0,
        "gold" => 1.3,
        "wueste" => 0.5,
        _ => 0.0,
    }
}

pub fn chip_w(n: u32) -> f64 {
    match n {
        2 | 12 => 1.0,
        3 | 11 => 2.0,
        4 | 10 => 3.0,
        5 | 9 => 4.0,
        6 | 8 => 5.0,
        _ => 0.0,
    }
}

fn avail(map: &IndexMap<String, Option<u32>>, key: &str) -> bool {
    match map.get(key) {
        None => true,
        Some(None) => true,
        Some(Some(n)) => *n > 0,
    }
}

fn take(map: &mut IndexMap<String, Option<u32>>, key: &str) {
    if let Some(Some(n)) = map.get_mut(key) {
        if *n > 0 {
            *n -= 1;
        }
    }
}

fn weighted<T: Clone>(items: &[T], w: impl Fn(&T) -> f64, rnd: &mut Rng) -> T {
    let tot: f64 = items.iter().map(&w).sum();
    let mut x = rnd.next_f64() * tot;
    for k in items {
        x -= w(k);
        if x <= 0.0 {
            return k.clone();
        }
    }
    items[items.len() - 1].clone()
}

fn draw_chip(S: &mut State, rnd: &mut Rng, only: Option<&[u32]>) -> Option<u32> {
    let sup = S.supply.as_ref()?;
    let ok: Vec<u32> = crate::settings::CHIP_KEYS
        .iter()
        .map(|k| k.parse::<u32>().unwrap_or(0))
        .filter(|n| {
            sup.chips
                .get(&n.to_string())
                .map(|v| match v {
                    None => true,
                    Some(x) => *x > 0,
                })
                .unwrap_or(true)
                && only.map(|o| o.contains(n)).unwrap_or(true)
        })
        .collect();
    if ok.is_empty() {
        return None;
    }
    let n = weighted(&ok, |k| chip_w(*k), rnd);
    take(&mut S.supply.as_mut().unwrap().chips, &n.to_string());
    Some(n)
}

/// Neues Feld entdecken (Server wählt Zufallsfeld unter Beachtung der Vorräte).
pub fn discover(S: &mut State, k: &str, rnd: &mut Rng) -> Hex {
    let ns: Vec<String> = geom::neighbors(k)
        .into_iter()
        .filter(|n| S.hexes.contains_key(n))
        .collect();
    let ln = ns
        .iter()
        .filter(|n| S.hexes.get(*n).map(|h| is_land(&h.t)).unwrap_or(false))
        .count();
    let p_land = 0.62f64.min(0.16 + 0.17 * ln as f64);
    let (chips_left, sea_ok) = {
        let sup = S.supply.as_ref();
        let chips_left = sup
            .map(|sup| crate::settings::CHIP_KEYS.iter().any(|n| avail(&sup.chips, n)))
            .unwrap_or(true);
        let sea_ok = sup.map(|sup| avail(&sup.terrain, "meer")).unwrap_or(true);
        (chips_left, sea_ok)
    };
    let gold_rate = S.gold_rate.unwrap_or(3);
    let golds = gold_nums(gold_rate);
    let land_types: Vec<&str> = ["wald", "weide", "acker", "huegel", "gebirge", "gold", "wueste"]
        .iter()
        .copied()
        .filter(|t| {
            let terrain_ok = S
                .supply
                .as_ref()
                .map(|sup| avail(&sup.terrain, t))
                .unwrap_or(true);
            terrain_ok
                && (*t == "wueste" || chips_left)
                && (*t != "gold"
                    || golds.iter().any(|n| {
                        S.supply
                            .as_ref()
                            .map(|sup| avail(&sup.chips, &n.to_string()))
                            .unwrap_or(true)
                    }))
        })
        .collect();
    let mut want_land = rnd.next_f64() < p_land;
    if want_land && land_types.is_empty() {
        want_land = false;
    }
    if !want_land && !sea_ok && !land_types.is_empty() {
        want_land = true;
    }
    let h = if want_land {
        let boost = S.fog_gold;
        let t = weighted(&land_types, |x| land_w(x) * if *x == "gold" { boost } else { 1.0 }, rnd);
        let t = t.to_string();
        {
            let sup = S.supply.as_mut().unwrap();
            take(&mut sup.terrain, &t);
        }
        let n = if t == "wueste" {
            None
        } else {
            draw_chip(S, rnd, if t == "gold" { Some(&golds) } else { None })
        };
        Hex { t, n }
    } else {
        if sea_ok {
            if let Some(sup) = S.supply.as_mut() {
                take(&mut sup.terrain, "meer");
            }
        }
        Hex {
            t: "meer".to_string(),
            n: None,
        }
    };
    S.hexes.insert(k.to_string(), h.clone());
    // gelegentlich ein Hafen an der neuen Küste
    if rnd.next_f64() < 0.3 {
        let es = shuffle(&geom::hex_edges(k), rnd);
        for e in es {
            let kinds_empty = S.harbor_kinds.as_ref().map(|v| v.is_empty()).unwrap_or(true);
            let kind = if !kinds_empty {
                S.harbor_kinds.as_mut().unwrap().pop().unwrap_or_default()
            } else {
                RES[rnd.below(5)].to_string()
            };
            if try_harbor(S, &e, &kind) {
                break;
            }
        }
    }
    h
}

/// Unentdeckter Rand.
pub fn fog(S: &State) -> Vec<String> {
    let mut set: IndexSet<String> = IndexSet::new();
    for k in S.hexes.keys() {
        for nb in geom::neighbors(k) {
            if !S.hexes.contains_key(&nb) {
                set.insert(nb);
            }
        }
    }
    set.into_iter().collect()
}
