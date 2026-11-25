// Bot-Spieler mit Strategie – Portierung von server/botplay.js.
// Drei Persönlichkeiten (Baumeister, Händler, Ritter) auf einer gemeinsamen Bewertungslogik.
// Bots nutzen nur öffentliche Informationen (Sicht), nie fremde Handkarten.
use std::sync::{Arc, Mutex};

use indexmap::{IndexMap, IndexSet};
use serde_json::Value;

use crate::game::{cost_map, Game, GameError};
use crate::geom;
use crate::model::BotMemory;
use crate::rng::Rng;
use crate::rules::{terrain_res, RES};

struct Persona {
    res_w: [f64; 5],
    var_w: f64,
    port_w: f64,
    exp_w: f64,
    goals: [&'static str; 4],
    edge_min: f64,
    road_lust: bool,
    offers: u32,
    knight: &'static str,
    trust: bool,
}

fn persona(kind: &str) -> Persona {
    match kind {
        "haendler" => Persona {
            res_w: [1.0, 1.0, 1.0, 1.0, 1.0],
            var_w: 2.2,
            port_w: 2.4,
            exp_w: 0.3,
            goals: ["city", "settlement", "dev", "road"],
            edge_min: 2.6,
            road_lust: false,
            offers: 3,
            knight: "bedarf",
            trust: true,
        },
        "ritter" => Persona {
            res_w: [0.9, 0.9, 1.15, 1.2, 1.2],
            var_w: 1.0,
            port_w: 0.6,
            exp_w: 0.3,
            goals: ["settlement", "city", "dev", "road"],
            edge_min: 2.6,
            road_lust: false,
            offers: 1,
            knight: "immer",
            trust: false,
        },
        _ => Persona {
            res_w: [1.1, 1.1, 0.95, 1.05, 1.0],
            var_w: 1.4,
            port_w: 0.5,
            exp_w: 0.7,
            goals: ["settlement", "city", "road", "dev"],
            edge_min: 2.0,
            road_lust: true,
            offers: 1,
            knight: "bedarf",
            trust: false,
        },
    }
}

fn pips(n: Option<u32>) -> f64 {
    match n {
        Some(n) if n > 0 => {
            let d = 7f64 - n as f64;
            6.0 - d.abs()
        }
        _ => 0.0,
    }
}
fn r(rnd: &Arc<Mutex<Rng>>) -> f64 {
    rnd.lock().unwrap().next_f64()
}
fn below(rnd: &Arc<Mutex<Rng>>, n: usize) -> usize {
    rnd.lock().unwrap().below(n)
}
fn hget(h: &Value, r: &str) -> f64 {
    h.get(r).and_then(|v| v.as_f64()).unwrap_or(0.0)
}
fn total(h: &Value) -> f64 {
    RES.iter().map(|r| hget(h, r)).sum()
}
fn num(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0)
}
fn num_or_null(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}
fn sarr(m: &serde_json::Map<String, Value>, k: &str) -> Vec<String> {
    m.get(k)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}
fn narr(m: &serde_json::Map<String, Value>, k: &str) -> Vec<usize> {
    m.get(k)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_u64().map(|n| n as usize)).collect())
        .unwrap_or_default()
}
fn obj<'a>(v: &'a Value, k: &str) -> &'a serde_json::Map<String, Value> {
    v.get(k).and_then(|x| x.as_object()).unwrap()
}
fn opt_obj<'a>(v: &'a Value, k: &str) -> Option<&'a serde_json::Map<String, Value>> {
    v.get(k).and_then(|x| x.as_object())
}
fn best_of<T: Clone>(arr: &[T], f: impl Fn(&T) -> f64) -> Option<T> {
    let mut best = None;
    let mut bs = f64::NEG_INFINITY;
    for x in arr {
        let s = f(x);
        if s > bs {
            bs = s;
            best = Some(x.clone());
        }
    }
    best
}
fn commit(game: &mut Game, pid: usize, bm: &BotMemory) {
    game.pl_mut(pid).bm = Some(bm.clone());
}
fn act(game: &mut Game, pid: usize, bm: &BotMemory, a: Value) -> Result<bool, GameError> {
    commit(game, pid, bm);
    game.act(pid, &a)?;
    Ok(true)
}

pub fn bot_play(
    game: &mut Game,
    pid: usize,
    as_kind: Option<&str>,
    rnd: &Arc<Mutex<Rng>>,
    now: i64,
) -> Result<bool, GameError> {
    let (kind, left) = {
        let pl = match game.S.players.get(pid) {
            Some(p) => p,
            None => return Ok(false),
        };
        (pl.bot.clone().or_else(|| as_kind.map(|s| s.to_string())), pl.left)
    };
    let kind = match kind {
        Some(k) if !left => k,
        _ => return Ok(false),
    };
    if game.S.phase != "setup" && game.S.phase != "main" {
        return Ok(false);
    }
    let p = persona(&kind);
    let mut v = game.view(Some(pid));
    let win = num(&v, "winPoints");
    let turn_no = game.S.turn_no;
    let mut bm = game.pl(pid).bm.clone().unwrap_or_default();
    if bm.turn != turn_no {
        bm = BotMemory { turn: turn_no, bank: 0, offers: 0, offer_at: 0, tried: Vec::new() };
    }

    // ---------- Bewertung ----------
    let verts = obj(&v, "verts").clone();
    let mine_v: Vec<String> = verts
        .iter()
        .filter(|(_, b)| num(b, "p") as usize == pid)
        .map(|(k, _)| k.clone())
        .collect();
    let mut prod: IndexMap<String, f64> = RES.iter().map(|r| (r.to_string(), 0.0)).collect();
    for k in &mine_v {
        let city = verts.get(k).map(|b| b.get("k").and_then(|x| x.as_str()) == Some("c")).unwrap_or(false);
        for h in geom::vert_hexes(k) {
            if let Some(x) = game.S.hexes.get(&h) {
                if let Some(r) = terrain_res(&x.t) {
                    *prod.get_mut(r).unwrap() += pips(x.n) * if city { 2.0 } else { 1.0 };
                }
            }
        }
    }
    let has_res: IndexSet<String> = RES
        .iter()
        .filter(|r| prod.get(**r).copied().unwrap_or(0.0) > 0.0)
        .map(|r| r.to_string())
        .collect();
    let my_gold = mine_v.iter().any(|k| {
        geom::vert_hexes(k)
            .iter()
            .any(|h| game.S.hexes.get(h).map(|x| x.t == "gold").unwrap_or(false))
    });
    let mut harbor_at: IndexMap<String, String> = IndexMap::new();
    for (e, h) in &game.S.harbors {
        for x in geom::edge_verts(e) {
            harbor_at.insert(x, h.kind.clone());
        }
    }
    let hand = v.get("me").and_then(|m| m.get("hand")).cloned().unwrap_or_else(|| Value::Object(Default::default()));
    let stock = |r: &str| -> f64 {
        v.get("bank")
            .and_then(|b| b.get("stock"))
            .and_then(|s| s.get(r))
            .and_then(|x| x.as_f64())
            .unwrap_or(0.0)
    };
    let free_spot = |game: &Game, x: &str| -> bool {
        !game.S.verts.contains_key(x) && game.distance_ok(x) && game.vert_touches_land(x)
    };
    let vscore = |game: &Game, x: &str| -> f64 {
        let mut val = 0.0;
        let mut res: IndexSet<String> = IndexSet::new();
        let mut mypips: IndexMap<String, f64> = prod.clone();
        for h in geom::vert_hexes(x) {
            let hx = match game.S.hexes.get(&h) {
                Some(h) => h,
                None => continue,
            };
            if let Some(rr) = terrain_res(&hx.t) {
                let pp = pips(hx.n);
                let idx = RES.iter().position(|r| *r == rr).unwrap();
                let sc = pp * p.res_w[idx] * if prod.get(rr).copied().unwrap_or(0.0) < 3.0 { 1.25 } else { 1.0 };
                val += sc;
                res.insert(rr.to_string());
                *mypips.get_mut(rr).unwrap() += pp;
            } else if hx.t == "gold" {
                val += pips(hx.n) * 1.1;
                res.insert("gold".to_string());
            }
        }
        let fresh = res
            .iter()
            .filter(|r| if r.as_str() == "gold" { !my_gold } else { !has_res.contains(*r) })
            .count() as f64;
        val += p.var_w * fresh;
        if let Some(hk) = harbor_at.get(x) {
            val += p.port_w
                * if hk == "any" { 1.5 } else { 0.3 * mypips.get(hk).copied().unwrap_or(0.0) };
        }
        val += p.exp_w
            * geom::vert_neighbors(x)
                .iter()
                .filter(|n| !game.S.verts.contains_key(*n) && game.vert_touches_land(n))
                .count() as f64;
        val
    };
    let far_ends = |e: &str, from: &str| -> Vec<String> {
        geom::edge_verts(e).into_iter().filter(|x| x != from).collect()
    };
    let edge_value = |game: &Game, e: &str| -> f64 {
        let mut best: f64 = 0.0;
        for x in geom::edge_verts(e) {
            if game.S.verts.contains_key(&x) {
                continue;
            }
            let mut s = if free_spot(game, &x) { vscore(game, &x) * 0.5 } else { 0.0 };
            for n in geom::vert_neighbors(&x) {
                if free_spot(game, &n) && !game.S.verts.contains_key(&x) {
                    s = s.max(vscore(game, &n) * 0.3);
                }
            }
            best = best.max(s);
        }
        best
    };

    // ---------- Pflichten ----------
    let legal = obj(&v, "legal").clone();
    let left_fig = game.left(pid);
    let step = v.get("step").and_then(|s| s.as_str()).unwrap_or("").to_string();
    let goal = goal_info(&v, &p, &legal, &left_fig);
    let keep_need = |goal: &Option<(&'static str, IndexMap<String, u32>)>| -> IndexMap<String, u32> {
        goal.as_ref().map(|(_, c)| c.clone()).unwrap_or_default()
    };

    if let Some(n) = obj(&v, "pending").get("discard").and_then(|d| d.get(&pid.to_string())).and_then(|x| x.as_f64()) {
        let n = n as u32;
        let mut h = IndexMap::new();
        for r in RES {
            h.insert(r.to_string(), hget(&hand, r));
        }
        let keep = keep_need(&goal);
        let mut out: IndexMap<String, u32> = IndexMap::new();
        for _ in 0..n {
            let cands: Vec<String> = RES.iter().filter(|r| h.get(**r).copied().unwrap_or(0.0) > 0.0).map(|r| r.to_string()).collect();
            let best = best_of(&cands, |x| {
                h.get(x).copied().unwrap_or(0.0) - keep.get(x.as_str()).copied().unwrap_or(0) as f64
                    + if has_res.contains(x) { 0.0 } else { -0.5 }
            });
            if let Some(r) = best {
                *h.get_mut(&r).unwrap() -= 1.0;
                *out.entry(r).or_insert(0) += 1;
            }
        }
        let mut cards = serde_json::Map::new();
        for (k, x) in out {
            cards.insert(k, Value::from(x));
        }
        return act(game, pid, &bm, serde_json::json!({"type": "discard", "cards": cards}));
    }
    if let Some(n) = obj(&v, "pending").get("gold").and_then(|d| d.get(&pid.to_string())).and_then(|x| x.as_f64()) {
        let n = n as u32;
        let mut h = IndexMap::new();
        for r in RES {
            h.insert(r.to_string(), hget(&hand, r));
        }
        let keep = keep_need(&goal);
        let mut out: IndexMap<String, u32> = IndexMap::new();
        for _ in 0..n {
            let best = best_of(&RES, |x| {
                let i = RES.iter().position(|r| *r == *x).unwrap_or(0);
                keep.get(*x).copied().unwrap_or(0) as f64 - h.get(*x).copied().unwrap_or(0.0) + p.res_w[i] * 0.1
                    - if stock(x) > 0.0 { 0.0 } else { 99.0 }
            });
            if let Some(r) = best {
                *h.get_mut(r).unwrap() += 1.0;
                *out.entry(r.to_string()).or_insert(0) += 1;
            }
        }
        let mut cards = serde_json::Map::new();
        for (k, x) in out {
            cards.insert(k, Value::from(x));
        }
        return act(game, pid, &bm, serde_json::json!({"type": "gold_pick", "cards": cards}));
    }
    if step == "discard" || step == "gold" {
        return Ok(false);
    }

    // ---------- Handelsangebote anderer beantworten ----------
    if let Some(t) = opt_obj(&v, "trade").cloned() {
        let from = t.get("from").and_then(|x| x.as_u64()).unwrap_or(99) as usize;
        let responded = t
            .get("responses")
            .and_then(|r| r.get(&pid.to_string()))
            .is_some();
        if from != pid && !responded && game.S.sbp.is_none() {
            let keep = keep_need(&goal);
            let give = t.get("give").unwrap_or(&Value::Null);
            let want = t.get("want").unwrap_or(&Value::Null);
            let can_pay = RES.iter().all(|r| hget(want, r) <= hget(&hand, r));
            let proposer = v.get("players").and_then(|p| p.get(from));
            let pvp = proposer.map(|x| num(x, "vp")).unwrap_or(0.0);
            let mut ok = can_pay
                && total(give) >= total(want)
                && (pvp < win - 1.0 || (p.trust && pvp < win));
            if ok {
                let gains = RES.iter().any(|r| hget(give, r) > 0.0 && keep.get(*r).copied().unwrap_or(0) as f64 > hget(&hand, r));
                let hurts = RES.iter().any(|r| {
                    hget(want, r) > 0.0
                        && hget(&hand, r) - hget(want, r) < keep.get(*r).copied().unwrap_or(0) as f64
                });
                ok = !hurts && (gains || (p.trust && total(give) > total(want)));
            }
            return act(game, pid, &bm, serde_json::json!({"type": "trade_respond", "accept": ok}));
        }
    }

    let active = game.S.sbp.as_ref().and_then(|s| s.pid).unwrap_or(game.S.turn);
    if active != pid {
        return Ok(false);
    }

    // ---------- Aufbau ----------
    if step == "setup_order" {
        return act(game, pid, &bm, serde_json::json!({"type": "roll"}));
    }
    if step == "setup_settlement" {
        let spots = sarr(&legal, "settlement");
        let best = best_of(&spots, |x| vscore(game, x));
        if let Some(x) = best {
            return act(game, pid, &bm, serde_json::json!({"type": "place_settlement", "v": x}));
        }
        return Ok(false);
    }
    if step == "setup_road" {
        let last = game.S.setup.as_ref().and_then(|s| s.last.clone()).unwrap_or_default();
        let mut cand: Vec<(String, String)> = Vec::new();
        for e in sarr(&legal, "road") {
            cand.push(("place_road".into(), e));
        }
        for e in sarr(&legal, "ship") {
            cand.push(("place_ship".into(), e));
        }
        let best = best_of(&cand, |(ty, ed)| {
            let mut s: f64 = 0.0;
            for x in far_ends(ed, &last) {
                if free_spot(game, &x) {
                    s = s.max(vscore(game, &x));
                }
                for n in geom::vert_neighbors(&x) {
                    if free_spot(game, &n) {
                        s = s.max(vscore(game, &n) * 0.6);
                    }
                }
            }
            s * if ty == "place_ship" { 0.75 } else { 1.0 } + r(rnd) * 0.01
        });
        if let Some((ty, e)) = best {
            return act(game, pid, &bm, serde_json::json!({"type": ty, "e": e}));
        }
        return Ok(false);
    }

    // ---------- Schutzmacht, Räuber, Opfer ----------
    let holder = num_or_null(&v, "largestHolder").map(|x| x as usize);
    let mine_knights = v
        .get("players")
        .and_then(|p| p.get(pid))
        .map(|x| num(x, "knightsPlayed"))
        .unwrap_or(0.0);
    let hold = holder
        .and_then(|h| v.get("players").and_then(|p| p.get(h)))
        .map(|x| num(x, "knightsPlayed"))
        .unwrap_or(0.0);
    let army = holder != Some(pid)
        && mine_knights + 1.0 >= game.S.settings.army_min as f64
        && mine_knights + 1.0 > hold;
    let robber_hex = game.S.robber.clone().unwrap_or_default();
    let robber_on_me = mine_v.iter().any(|k| {
        geom::vert_hexes(k).contains(&robber_hex)
            && game
                .S
                .hexes
                .get(&robber_hex)
                .map(|h| pips(h.n) >= 4.0)
                .unwrap_or(false)
    });
    let dv = |t: &str| -> bool {
        v.get("me")
            .and_then(|m| m.get("dev"))
            .and_then(|d| d.as_array())
            .map(|a| {
                a.iter().any(|x| {
                    x.get("type").and_then(|z| z.as_str()) == Some(t)
                        && x.get("playable").and_then(|z| z.as_bool()) == Some(true)
                })
            })
            .unwrap_or(false)
    };
    let want_knight = dv("ritter") && (p.knight == "immer" || robber_on_me || army);

    if step == "roll" {
        if want_knight {
            return act(game, pid, &bm, serde_json::json!({"type": "play_knight"}));
        }
        return act(game, pid, &bm, serde_json::json!({"type": "roll"}));
    }
    if step == "robber" {
        let lead = |p_: usize| -> f64 {
            v.get("players").and_then(|a| a.get(p_)).map(|x| num(x, "vp") + 1.0).unwrap_or(1.0)
        };
        let score = |h: &str| -> f64 {
            let mut s: f64 = 0.0;
            for (k, b) in obj(&v, "verts").iter() {
                if !geom::vert_hexes(k).contains(&h.to_string()) {
                    continue;
                }
                let bp = num(b, "p") as usize;
                let city = b.get("k").and_then(|x| x.as_str()) == Some("c");
                let x = game.S.hexes.get(h).map(|z| pips(z.n)).unwrap_or(0.0)
                    * if city { 2.0 } else { 1.0 };
                s += if bp == pid {
                    -x * 2.5
                } else {
                    x * lead(bp).powf(1.4)
                        * (1.0
                            + v.get("players")
                                .and_then(|a| a.get(bp))
                                .map(|q| num(q, "resCount"))
                                .unwrap_or(0.0)
                                / 20.0)
                };
            }
            s
        };
        let robber_list = sarr(&legal, "robber");
        let land = best_of(&robber_list, |h| score(h) + r(rnd) * 0.01);
        let mut sea: Option<String> = None;
        let mut sea_score: f64 = 0.0;
        let pirate_list = sarr(&legal, "pirate");
        for h in &pirate_list {
            let mut s: f64 = 0.0;
            for e in geom::hex_edges(h) {
                if let Some(b) = game.S.edges.get(&e) {
                    if b.k == "s" {
                        s += if b.p == pid { -3.0 } else { 2.0 * lead(b.p) };
                    }
                }
            }
            if s > sea_score {
                sea_score = s;
                sea = Some(h.clone());
            }
        }
        if let (Some(sh), Some(l)) = (sea.clone(), land.clone()) {
            if sea_score > score(&l).max(0.0) + 3.0 {
                return act(game, pid, &bm, serde_json::json!({"type": "move_pirate", "hex": sh}));
            }
        }
        if let Some(l) = land {
            return act(game, pid, &bm, serde_json::json!({"type": "move_robber", "hex": l}));
        }
        return Ok(false);
    }
    if step == "steal" {
        let list = narr(&legal, "steal");
        let best = best_of(&list, |x| {
            v.get("players")
                .and_then(|a| a.get(*x))
                .map(|q| num(q, "resCount") * (num(q, "vp") + 1.0))
                .unwrap_or(0.0)
        });
        if let Some(t) = best {
            return act(game, pid, &bm, serde_json::json!({"type": "steal", "target": t}));
        }
        return Ok(false);
    }
    if step == "road_building" {
        let mut cand: Vec<(String, String)> = Vec::new();
        for e in sarr(&legal, "road") {
            cand.push(("build_road".into(), e));
        }
        for e in sarr(&legal, "ship") {
            cand.push(("build_ship".into(), e));
        }
        if cand.is_empty() {
            return act(game, pid, &bm, serde_json::json!({"type": "skip_roadbuilding"}));
        }
        let best = best_of(&cand, |(ty, ed)| {
            edge_value(game, ed) * if ty == "build_ship" { 0.8 } else { 1.0 }
        });
        if let Some((ty, e)) = best {
            return act(game, pid, &bm, serde_json::json!({"type": ty, "e": e}));
        }
        return Ok(false);
    }

    // ---------- Hauptphase ----------
    let sbp = step == "sbp";
    if step != "main" && !sbp {
        return Ok(false);
    }
    let afford = obj(&v, "afford").clone();
    let left = left_fig;
    let goal = goal_info(&v, &p, &legal, &left);
    let deficit: Vec<String> = match &goal {
        Some((_, need)) => RES
            .iter()
            .filter(|r| need.get(**r).copied().unwrap_or(0) as f64 > hget(&hand, r))
            .map(|r| r.to_string())
            .collect(),
        None => Vec::new(),
    };

    // Entwicklungskarten ausspielen (nicht in der Sonderbauphase)
    if !sbp {
        if want_knight {
            return act(game, pid, &bm, serde_json::json!({"type": "play_knight"}));
        }
        if dv("monopol") && !deficit.is_empty() {
            let need = goal.as_ref().map(|(_, n)| n.clone()).unwrap_or_default();
            let best = best_of(&deficit, |x| {
                let i = RES.iter().position(|r| r == x).unwrap();
                (need.get(x.as_str()).copied().unwrap_or(0) as f64 - hget(&hand, x)) * 3.0
                    + p.res_w[i]
            });
            let others: f64 = v
                .get("players")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter(|q| num(q, "id") as usize != pid).map(|q| num(q, "resCount")).sum())
                .unwrap_or(0.0);
            if let Some(r) = best {
                if others >= 7.0 {
                    return act(game, pid, &bm, serde_json::json!({"type": "play_monopoly", "res": r}));
                }
            }
        }
        if dv("erfindung") && !deficit.is_empty() {
            let ok: Vec<String> = RES.iter().filter(|r| stock(r) >= 1.0).map(|r| r.to_string()).collect();
            let need = goal.as_ref().map(|(_, n)| n.clone()).unwrap_or_default();
            let mut picks: Vec<String> = Vec::new();
            for r in &deficit {
                let mut i = 0.0;
                while i < need.get(r.as_str()).copied().unwrap_or(0) as f64 - hget(&hand, r) && picks.len() < 2 {
                    if ok.contains(r) {
                        picks.push(r.clone());
                    }
                    i += 1.0;
                }
            }
            while picks.len() < 2 && !ok.is_empty() {
                if let Some(x) = best_of(&ok, |x| {
                    let i = RES.iter().position(|r| r == x).unwrap();
                    p.res_w[i]
                }) {
                    picks.push(x);
                }
            }
            if picks.len() == 2
                && (picks[0] != picks[1] || stock(&picks[0]) >= 2.0)
            {
                return act(
                    game,
                    pid,
                    &bm,
                    serde_json::json!({"type": "play_yop", "a": picks[0], "b": picks[1]}),
                );
            }
        }
        if dv("strassenbau") && left.road + left.ship > 0 {
            let mut cand: Vec<String> = sarr(&legal, "road");
            cand.extend(sarr(&legal, "ship"));
            if cand.iter().any(|e| edge_value(game, e) >= p.edge_min) {
                return act(game, pid, &bm, serde_json::json!({"type": "play_roadbuilding"}));
            }
        }
    }

    // Bauen: Nutzen je Möglichkeit
    let mut opts: Vec<(String, Value, f64)> = Vec::new();
    if afford.get("city").and_then(|x| x.as_bool()) == Some(true) {
        let city = sarr(&legal, "city");
        if !city.is_empty() {
            let x = best_of(&city, |x| {
                let mut pp = 0.0;
                for h in geom::vert_hexes(x) {
                    if let Some(hx) = game.S.hexes.get(&h) {
                        pp += pips(hx.n)
                            * terrain_res(&hx.t)
                                .map(|r| {
                                    let i = RES.iter().position(|z| *z == r).unwrap();
                                    p.res_w[i]
                                })
                                .unwrap_or(0.5);
                    }
                }
                pp
            })
            .unwrap();
            opts.push(("build_city".into(), serde_json::json!({"v": x}), 10.0));
        }
    }
    if afford.get("settlement").and_then(|x| x.as_bool()) == Some(true) {
        let spots = sarr(&legal, "settlement");
        if !spots.is_empty() {
            if let Some(x) = best_of(&spots, |x| vscore(game, x)) {
                let u = 9.0 + vscore(game, &x) * 0.05;
                opts.push(("build_settlement".into(), serde_json::json!({"v": x}), u));
            }
        }
    }
    let late = v
        .get("players")
        .and_then(|a| a.get(pid))
        .map(|x| num(x, "vp") >= win - 3.0)
        .unwrap_or(false);
    let spoils = |cost: &IndexMap<String, u32>| -> bool {
        if late {
            return false;
        }
        match &goal {
            Some((kind, need)) if *kind != "dev" && *kind != "road" => RES
                .iter()
                .filter(|r| {
                    need.get(**r).copied().unwrap_or(0) as f64
                        > hget(&hand, r) - cost_get(&cost, r)
                })
                .count()
                > deficit.len(),
            _ => false,
        }
    };
    if afford.get("dev").and_then(|x| x.as_bool()) == Some(true)
        && (!spoils(&cost_map("dev")) || total(&hand) >= 8.0)
    {
        opts.push((
            "buy_dev".into(),
            serde_json::json!({}),
            if kind == "ritter" { 6.5 } else { 3.5 },
        ));
    }
    let mut edges: Vec<(String, String, String, f64)> = Vec::new();
    for e in sarr(&legal, "road") {
        if afford.get("road").and_then(|x| x.as_bool()) != Some(true) {
            continue;
        }
        edges.push(("build_road".into(), e.clone(), "road".into(), edge_value(game, &e)));
    }
    for e in sarr(&legal, "ship") {
        if afford.get("ship").and_then(|x| x.as_bool()) != Some(true) {
            continue;
        }
        edges.push(("build_ship".into(), e.clone(), "ship".into(), edge_value(game, &e) * 0.8));
    }
    let spots = !sarr(&legal, "settlement").is_empty() && left.settlement > 0;
    let crowded = total(&hand) >= 8.0;
    let best_edge = best_of(&edges, |x| x.3);
    let mine_len = v
        .get("players")
        .and_then(|a| a.get(pid))
        .map(|x| num(x, "longestRoute"))
        .unwrap_or(0.0);
    let holder_l = num_or_null(&v, "longestHolder");
    let holder_len = holder_l
        .and_then(|h| v.get("players").and_then(|a| a.get(h as usize)))
        .map(|x| num(x, "longestRoute"))
        .unwrap_or(0.0);
    let chase = (p.road_lust || late)
        && holder_l != Some(pid as f64)
        && mine_len + 2.0 >= game.S.settings.longest_min as f64
        && holder_len - mine_len <= 2.0;
    if let Some(be) = best_edge.clone() {
        let goalk = goal.as_ref().map(|(k, _)| *k);
        if chase || be.3 >= p.edge_min || (!spots && be.3 > 0.2 && goalk == Some("road")) || crowded {
            opts.push((be.0.clone(), serde_json::json!({"e": be.1}), 2.0 + be.3 * 0.3 + if chase { 4.0 } else { 0.0 }));
        }
    }
    if !opts.is_empty() {
        let best = best_of(&opts, |o| o.2).unwrap();
        let cheap = best.0 == "build_road" || best.0 == "build_ship";
        let cost = if cheap { cost_map(if best.0 == "build_road" { "road" } else { "ship" }) } else { IndexMap::new() };
        let worse = match &goal {
            Some((kind, need)) if *kind != "road" => RES
                .iter()
                .filter(|r| {
                    need.get(**r).copied().unwrap_or(0) as f64
                        > hget(&hand, r) - cost_get(&cost, r)
                })
                .count()
                > deficit.len(),
            _ => false,
        };
        let blocks = cheap && !crowded && worse && !chase;
        if !blocks {
            let mut obj = best.1.clone();
            if let Some(o) = obj.as_object_mut() {
                o.insert("type".into(), Value::from(best.0));
            }
            return act(game, pid, &bm, obj);
        }
    }

    // Tauschen: Bank (Kurse inkl. Hafen), danach Mitspieler
    let rates = obj(&v, "rates").clone();
    let rate = |r: &str| -> f64 { rates.get(r).and_then(|x| x.as_f64()).unwrap_or(4.0) };
    let bank_ok = |r: &str| stock(r) > 0.0;
    if goal.is_some() && !deficit.is_empty() && bm.bank < 8 {
        let need = goal.as_ref().map(|(_, n)| n.clone()).unwrap_or_default();
        let give_c: Vec<String> = RES
            .iter()
            .filter(|r| {
                !deficit.contains(&r.to_string())
                    && hget(&hand, r) - need.get(**r).copied().unwrap_or(0) as f64 >= rate(r)
            })
            .map(|r| r.to_string())
            .collect();
        let give = best_of(&give_c, |r| (hget(&hand, r) - need.get(r.as_str()).copied().unwrap_or(0) as f64) / rate(r));
        let get_c: Vec<String> = deficit.iter().filter(|r| bank_ok(r)).cloned().collect();
        let get = best_of(&get_c, |r| need.get(r.as_str()).copied().unwrap_or(0) as f64 - hget(&hand, r));
        if let (Some(g), Some(w)) = (give, get) {
            bm.bank += 1;
            return act(game, pid, &bm, serde_json::json!({"type": "bank_trade", "give": g, "get": w}));
        }
    }
    if crowded && bm.bank < 8 {
        let give_c: Vec<String> = RES.iter().filter(|r| hget(&hand, r) >= rate(r)).map(|r| r.to_string()).collect();
        let give = best_of(&give_c, |r| hget(&hand, r) / rate(r));
        if let Some(g) = give.clone() {
            let get_c: Vec<String> = RES
                .iter()
                .filter(|r| bank_ok(r) && **r != g)
                .map(|r| r.to_string())
                .collect();
            let get = best_of(&get_c, |r| -hget(&hand, r) + if has_res.contains(r.as_str()) { 0.0 } else { 1.0 });
            if let Some(w) = get {
                let need_g = goal.as_ref().and_then(|(_, n)| n.get(g.as_str()).copied()).unwrap_or(0) as f64;
                if hget(&hand, &g) - rate(&g) >= need_g {
                    bm.bank += 1;
                    return act(game, pid, &bm, serde_json::json!({"type": "bank_trade", "give": g, "get": w}));
                }
            }
        }
    }

    // eigenes Angebot auswerten / zurückziehen
    if let Some(t) = opt_obj(&v, "trade") {
        let from = t.get("from").and_then(|x| x.as_u64()).unwrap_or(99) as usize;
        if from == pid {
            let rs = t.get("responses").unwrap_or(&Value::Null);
            let others: Vec<usize> = v
                .get("players")
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|q| num(q, "id") as usize != pid && q.get("gone").and_then(|g| g.as_bool()) != Some(true))
                        .map(|q| num(q, "id") as usize)
                        .collect()
                })
                .unwrap_or_default();
            let acc = rs
                .as_object()
                .and_then(|o| o.iter().find(|(_, r)| r.get("s").and_then(|s| s.as_str()) == Some("accept")))
                .map(|(k, _)| k.parse::<usize>().unwrap_or(0));
            if let Some(w) = acc {
                return act(game, pid, &bm, serde_json::json!({"type": "trade_confirm", "with": w}));
            }
            let waiting = others.iter().any(|&id| {
                rs.get(&id.to_string()).is_none()
                    && game
                        .S
                        .players
                        .get(id)
                        .map(|p| p.bot.is_none() && p.connected && !p.auto)
                        .unwrap_or(false)
            });
            let everyone = others.iter().all(|id| rs.get(&id.to_string()).is_some());
            if everyone || !waiting || now - bm.offer_at > 25_000 {
                return act(game, pid, &bm, serde_json::json!({"type": "trade_cancel"}));
            }
            return Ok(false);
        }
    }
    if !sbp
        && v.get("settings").and_then(|s| s.get("playerTrade")).and_then(|x| x.as_bool()) == Some(true)
        && opt_obj(&v, "trade").is_none()
        && goal.is_some()
        && !deficit.is_empty()
        && bm.offers < p.offers
        && total(&hand) >= 2.0
    {
        let need = goal.as_ref().map(|(_, n)| n.clone()).unwrap_or_default();
        let want = best_of(&deficit, |r| need.get(r.as_str()).copied().unwrap_or(0) as f64 - hget(&hand, r));
        let give_c: Vec<String> = RES
            .iter()
            .filter(|r| {
                hget(&hand, r) - need.get(**r).copied().unwrap_or(0) as f64 >= 1.0
                    && Some(r.to_string()) != want
            })
            .map(|r| r.to_string())
            .collect();
        let give = best_of(&give_c, |r| hget(&hand, r) - need.get(r.as_str()).copied().unwrap_or(0) as f64);
        if let (Some(g), Some(w)) = (give, want) {
            let key = format!("{}>{}", g, w);
            if !bm.tried.contains(&key) {
                bm.tried.push(key);
                bm.offers += 1;
                bm.offer_at = now;
                let mut give_map = serde_json::Map::new();
                give_map.insert(g.clone(), Value::from(1));
                let mut want_map = serde_json::Map::new();
                want_map.insert(w.clone(), Value::from(1));
                return act(
                    game,
                    pid,
                    &bm,
                    serde_json::json!({"type": "trade_offer", "give": give_map, "want": want_map}),
                );
            }
        }
    }

    act(
        game,
        pid,
        &bm,
        serde_json::json!({"type": if sbp { "sbp_done" } else { "end_turn" }}),
    )
}

fn cost_get(c: &IndexMap<String, u32>, r: &&str) -> f64 {
    c.get(*r).copied().unwrap_or(0) as f64
}

fn goal_info(
    v: &Value,
    p: &Persona,
    legal: &serde_json::Map<String, Value>,
    left: &crate::game::Left,
) -> Option<(&'static str, IndexMap<String, u32>)> {
    let spots = !sarr(legal, "settlement").is_empty() && left.settlement > 0;
    for g in p.goals {
        if g == "settlement" && spots {
            return Some(("settlement", cost_map("settlement")));
        }
        if g == "city" && !sarr(legal, "city").is_empty() && left.city > 0 {
            return Some(("city", cost_map("city")));
        }
        if g == "dev"
            && v.get("bank")
                .and_then(|b| b.get("dev"))
                .and_then(|x| x.as_f64())
                .unwrap_or(0.0)
                > 0.0
        {
            return Some(("dev", cost_map("dev")));
        }
        if g == "road" && !spots && left.road > 0 && !sarr(legal, "road").is_empty() {
            return Some(("road", cost_map("road")));
        }
    }
    None
}
