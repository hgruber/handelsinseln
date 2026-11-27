// Autopilot (nur Pflichten) und Testspieler – Portierung von server/bot.js.
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::game::{Game, GameError};
use crate::rng::Rng;
use crate::rules::RES;

fn pick(a: &[String], rnd: &Arc<Mutex<Rng>>) -> Option<String> {
    if a.is_empty() {
        return None;
    }
    let i = rnd.lock().unwrap().below(a.len());
    Some(a[i].clone())
}
fn hget(h: &Value, r: &str) -> f64 {
    h.get(r).and_then(|v| v.as_f64()).unwrap_or(0.0)
}
fn total(h: &Value) -> f64 {
    RES.iter().map(|r| hget(h, r)).sum()
}
fn random_cards(hand: &Value, n: u32, rnd: &Arc<Mutex<Rng>>) -> Value {
    let mut pool: Vec<String> = Vec::new();
    for r in RES {
        for _ in 0..hget(hand, r) as u32 {
            pool.push(r.to_string());
        }
    }
    let mut out = serde_json::Map::new();
    for _ in 0..n {
        if pool.is_empty() {
            break;
        }
        let i = rnd.lock().unwrap().below(pool.len());
        let r = pool.remove(i);
        let c = out.get(&r).and_then(|v| v.as_u64()).unwrap_or(0) + 1;
        out.insert(r, Value::from(c));
    }
    Value::Object(out)
}
fn any_cards(n: u32, rnd: &Arc<Mutex<Rng>>) -> Value {
    let mut out = serde_json::Map::new();
    for _ in 0..n {
        let i = rnd.lock().unwrap().below(5);
        let r = RES[i].to_string();
        let c = out.get(&r).and_then(|v| v.as_u64()).unwrap_or(0) + 1;
        out.insert(r, Value::from(c));
    }
    Value::Object(out)
}
fn r(rnd: &Arc<Mutex<Rng>>) -> f64 {
    rnd.lock().unwrap().next_f64()
}
fn rbelow(rnd: &Arc<Mutex<Rng>>, n: usize) -> usize {
    rnd.lock().unwrap().below(n)
}
fn num(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0)
}
fn sarr(v: &Value, k: &str) -> Vec<String> {
    v.get(k)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}
fn narr(v: &Value, k: &str) -> Vec<usize> {
    v.get(k)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_u64().map(|n| n as usize)).collect())
        .unwrap_or_default()
}

pub fn bot_act(
    game: &mut Game,
    pid: usize,
    rnd: &Arc<Mutex<Rng>>,
    minimal: bool,
) -> Result<bool, GameError> {
    let full = !minimal;
    if game.S.phase == "lobby" || game.S.phase == "ended" {
        return Ok(false);
    }
    let v = game.view(Some(pid));
    let legal = v.get("legal").and_then(|x| x.as_object()).cloned().unwrap_or_default();
    let step = v.get("step").and_then(|s| s.as_str()).unwrap_or("").to_string();
    let hand = v.get("me").and_then(|m| m.get("hand")).cloned().unwrap_or_else(|| Value::Object(Default::default()));
    let pending = v.get("pending").and_then(|x| x.as_object()).cloned().unwrap_or_default();
    let act = |game: &mut Game, a: Value| -> Result<bool, GameError> {
        game.act(pid, &a)?;
        Ok(true)
    };
    if let Some(n) = pending.get("discard").and_then(|d| d.get(&pid.to_string())).and_then(|x| x.as_u64()) {
        return act(game, json!({"type": "discard", "cards": random_cards(&hand, n as u32, rnd)}));
    }
    if let Some(n) = pending.get("gold").and_then(|d| d.get(&pid.to_string())).and_then(|x| x.as_u64()) {
        return act(game, json!({"type": "gold_pick", "cards": any_cards(n as u32, rnd)}));
    }
    if step == "discard" || step == "gold" {
        return Ok(false);
    }
    // Handelsangebote beantworten (nur Testspieler)
    if full {
        if let Some(t) = v.get("trade").and_then(|x| x.as_object()) {
            let from = t.get("from").and_then(|x| x.as_u64()).unwrap_or(99) as usize;
            let responded = t.get("responses").and_then(|x| x.get(&pid.to_string())).is_some();
            if from != pid && !responded && game.S.sbp.is_none() {
                let want = t.get("want").cloned().unwrap_or_else(|| json!({}));
                let can_give = RES.iter().all(|x| hget(&hand, x) >= hget(&want, x));
                let rr = r(rnd);
                if can_give && rr < 0.5 {
                    return act(game, json!({"type": "trade_respond", "accept": true}));
                }
                if rr < 0.6 && total(&hand) > 2.0 {
                    let w = pick(&RES.iter().map(|x| x.to_string()).collect::<Vec<_>>(), rnd);
                    let have: Vec<String> = RES
                        .iter()
                        .filter(|x| hget(&hand, x) > 0.0 && Some(x.to_string()) != w)
                        .map(|x| x.to_string())
                        .collect();
                    if let (Some(w), Some(h0)) = (w, have.first()) {
                        let mut give = serde_json::Map::new();
                        give.insert(w, Value::from(1));
                        let mut want2 = serde_json::Map::new();
                        want2.insert(h0.clone(), Value::from(1));
                        return act(
                            game,
                            json!({"type": "trade_respond", "counter": {"give": give, "want": want2}}),
                        );
                    }
                }
                return act(game, json!({"type": "trade_respond", "accept": false}));
            }
        }
    }
    if num(&v, "turn") as usize != pid {
        return Ok(false);
    }
    match step.as_str() {
        "setup_order" => act(game, json!({"type": "roll"})),
        "setup_settlement" => {
            if let Some(x) = pick(&sarr(&Value::Object(legal.clone()), "settlement"), rnd) {
                act(game, json!({"type": "place_settlement", "v": x}))
            } else {
                Ok(false)
            }
        }
        "setup_road" => {
            let mut opts: Vec<(String, String)> = Vec::new();
            for e in sarr(&Value::Object(legal.clone()), "road") {
                opts.push(("place_road".into(), e));
            }
            for e in sarr(&Value::Object(legal.clone()), "ship") {
                opts.push(("place_ship".into(), e));
            }
            if let Some((t, e)) = pick(&opts.iter().map(|(t, e)| format!("{}|{}", t, e)).collect::<Vec<_>>(), rnd)
                .and_then(|s| s.split_once('|').map(|(a, b)| (a.to_string(), b.to_string())))
            {
                act(game, json!({"type": t, "e": e}))
            } else {
                Ok(false)
            }
        }
        "roll" => {
            let has_knight = v
                .get("me")
                .and_then(|m| m.get("dev"))
                .and_then(|d| d.as_array())
                .map(|a| {
                    a.iter().any(|x| {
                        x.get("type").and_then(|z| z.as_str()) == Some("ritter")
                            && x.get("playable").and_then(|z| z.as_bool()) == Some(true)
                    })
                })
                .unwrap_or(false);
            if full && has_knight && rnd.lock().unwrap().next_f64() < 0.3 {
                return act(game, json!({"type": "play_knight"}));
            }
            act(game, json!({"type": "roll"}))
        }
        "robber" => {
            let pirate = sarr(&Value::Object(legal.clone()), "pirate");
            if !pirate.is_empty() && r(rnd) < 0.25 {
                if let Some(h) = pick(&pirate, rnd) {
                    return act(game, json!({"type": "move_pirate", "hex": h}));
                }
            }
            let robber = sarr(&Value::Object(legal.clone()), "robber");
            let verts = v.get("verts").and_then(|x| x.as_object()).cloned().unwrap_or_default();
            let mine = |h: &str| -> bool {
                verts.iter().any(|(k, b)| num(b, "p") as usize == pid && k.split('|').any(|x| x == h))
            };
            let good: Vec<String> = robber.iter().filter(|h| !mine(h)).cloned().collect();
            let list = if good.is_empty() { robber } else { good };
            if let Some(h) = pick(&list, rnd) {
                act(game, json!({"type": "move_robber", "hex": h}))
            } else {
                Ok(false)
            }
        }
        "steal" => {
            let list = narr(&Value::Object(legal.clone()), "steal");
            if let Some(t) = pick(&list.iter().map(|x| x.to_string()).collect::<Vec<_>>(), rnd) {
                act(game, json!({"type": "steal", "target": t.parse::<usize>().unwrap_or(0)}))
            } else {
                Ok(false)
            }
        }
        "road_building" => {
            let mut all: Vec<(String, String)> = Vec::new();
            for e in sarr(&Value::Object(legal.clone()), "road") {
                all.push(("build_road".into(), e));
            }
            for e in sarr(&Value::Object(legal.clone()), "ship") {
                all.push(("build_ship".into(), e));
            }
            if all.is_empty() {
                return act(game, json!({"type": "skip_roadbuilding"}));
            }
            if let Some((t, e)) = pick(&all.iter().map(|(t, e)| format!("{}|{}", t, e)).collect::<Vec<_>>(), rnd)
                .and_then(|s| s.split_once('|').map(|(a, b)| (a.to_string(), b.to_string())))
            {
                act(game, json!({"type": t, "e": e}))
            } else {
                Ok(false)
            }
        }
        "sbp" | "main" => {
            let sbp = step == "sbp";
            if !full {
                return act(game, json!({"type": if sbp { "sbp_done" } else { "end_turn" }}));
            }
            let affordable = |k: &str| v.get("afford").and_then(|a| a.get(k)).and_then(|b| b.as_bool()) == Some(true);
            if affordable("city") && !sarr(&Value::Object(legal.clone()), "city").is_empty() {
                if let Some(x) = pick(&sarr(&Value::Object(legal.clone()), "city"), rnd) {
                    return act(game, json!({"type": "build_city", "v": x}));
                }
            }
            if affordable("settlement") && !sarr(&Value::Object(legal.clone()), "settlement").is_empty() {
                if let Some(x) = pick(&sarr(&Value::Object(legal.clone()), "settlement"), rnd) {
                    return act(game, json!({"type": "build_settlement", "v": x}));
                }
            }
            let playable: Vec<Value> = v
                .get("me")
                .and_then(|m| m.get("dev"))
                .and_then(|d| d.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|x| x.get("playable").and_then(|z| z.as_bool()) == Some(true))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            if !sbp && !playable.is_empty() && r(rnd) < 0.5 {
                let i = rbelow(rnd, playable.len());
                let d = &playable[i];
                let ty = d.get("type").and_then(|x| x.as_str()).unwrap_or("");
                if ty == "ritter" {
                    return act(game, json!({"type": "play_knight"}));
                }
                if ty == "strassenbau" {
                    return act(game, json!({"type": "play_roadbuilding"}));
                }
                if ty == "erfindung" {
                    let ok: Vec<String> = RES
                        .iter()
                        .filter(|x| {
                            v.get("bank").and_then(|b| b.get("stock")).and_then(|s| s.get(*x)).and_then(|z| z.as_f64()).unwrap_or(0.0) >= 2.0
                        })
                        .map(|x| x.to_string())
                        .collect();
                    if ok.is_empty() {
                        return act(game, json!({"type": "end_turn"}));
                    }
                    return act(game, json!({"type": "play_yop", "a": ok[0], "b": ok[0]}));
                }
                if ty == "monopol" {
                    if let Some(x) = pick(&RES.iter().map(|x| x.to_string()).collect::<Vec<_>>(), rnd) {
                        return act(game, json!({"type": "play_monopoly", "res": x}));
                    }
                }
            }
            if affordable("dev") && r(rnd) < 0.6 {
                return act(game, json!({"type": "buy_dev"}));
            }
            // Rohstoffe passend tauschen (Bank)
            let need: Vec<(&str, f64)> = if !sarr(&Value::Object(legal.clone()), "city").is_empty() {
                vec![("getreide", 2.0), ("erz", 3.0)]
            } else {
                vec![("holz", 1.0), ("lehm", 1.0), ("wolle", 1.0), ("getreide", 1.0)]
            };
            let need_of = |r: &str| need.iter().find(|(x, _)| *x == r).map(|(_, n)| *n).unwrap_or(0.0);
            let missing: Vec<String> = RES.iter().filter(|x| hget(&hand, x) < need_of(x)).map(|x| x.to_string()).collect();
            let spare: Vec<String> = RES
                .iter()
                .filter(|x| hget(&hand, x) - need_of(x) >= num(v.get("rates").unwrap_or(&Value::Null), x))
                .map(|x| x.to_string())
                .collect();
            let missing_ok: Vec<String> = missing
                .iter()
                .filter(|x| {
                    v.get("bank").and_then(|b| b.get("stock")).and_then(|s| s.get(*x)).and_then(|z| z.as_f64()).unwrap_or(0.0) > 0.0
                })
                .cloned()
                .collect();
            if !sbp && !missing_ok.is_empty() && !spare.is_empty() && r(rnd) < 0.8 {
                let g = pick(&spare, rnd).unwrap();
                let w = pick(&missing_ok, rnd).unwrap();
                return act(game, json!({"type": "bank_trade", "give": g, "get": w}));
            }
            // Spielerhandel anbieten
            if !sbp
                && v.get("settings").and_then(|s| s.get("playerTrade")).and_then(|x| x.as_bool()) == Some(true)
                && v.get("trade").map(|t| t.is_null()).unwrap_or(true)
                && !missing.is_empty()
                && total(&hand) >= 2.0
                && r(rnd) < 0.25
            {
                let give_c: Vec<String> = RES
                    .iter()
                    .filter(|x| hget(&hand, x) > 0.0 && !missing.contains(&x.to_string()))
                    .map(|x| x.to_string())
                    .collect();
                if let (Some(g), Some(w)) = (pick(&give_c, rnd), pick(&missing, rnd)) {
                    let mut gm = serde_json::Map::new();
                    gm.insert(g, Value::from(1));
                    let mut wm = serde_json::Map::new();
                    wm.insert(w, Value::from(1));
                    return act(game, json!({"type": "trade_offer", "give": gm, "want": wm}));
                }
            }
            if let Some(t) = v.get("trade").and_then(|x| x.as_object()) {
                let from = t.get("from").and_then(|x| x.as_u64()).unwrap_or(99) as usize;
                if from == pid {
                    let rs = t.get("responses").and_then(|x| x.as_object()).cloned().unwrap_or_default();
                    let acc = rs
                        .iter()
                        .find(|(_, r)| r.get("s").and_then(|s| s.as_str()) != Some("decline"))
                        .map(|(k, _)| k.parse::<usize>().unwrap_or(0));
                    if let Some(w) = acc {
                        return match game.act(pid, &json!({"type": "trade_confirm", "with": w})) {
                            Ok(()) => Ok(true),
                            Err(_) => act(game, json!({"type": "trade_cancel"})),
                        };
                    }
                    let players = v.get("players").and_then(|p| p.as_array()).map(|a| a.len()).unwrap_or(0);
                    if rs.len() >= players.saturating_sub(1) {
                        return act(game, json!({"type": "trade_cancel"}));
                    }
                }
            }
            if affordable("road") && !sarr(&Value::Object(legal.clone()), "road").is_empty() {
                let p = if sarr(&Value::Object(legal.clone()), "settlement").is_empty() { 0.5 } else { 0.1 };
                if r(rnd) < p {
                    if let Some(e) = pick(&sarr(&Value::Object(legal.clone()), "road"), rnd) {
                        return act(game, json!({"type": "build_road", "e": e}));
                    }
                }
            }
            if affordable("ship") && !sarr(&Value::Object(legal.clone()), "ship").is_empty() && r(rnd) < 0.5 {
                if let Some(e) = pick(&sarr(&Value::Object(legal.clone()), "ship"), rnd) {
                    return act(game, json!({"type": "build_ship", "e": e}));
                }
            }
            let ship_from = sarr(&Value::Object(legal.clone()), "shipFrom");
            if !sbp && !ship_from.is_empty() && r(rnd) < 0.15 {
                let f = pick(&ship_from, rnd).unwrap();
                let tos = legal
                    .get("shipTo")
                    .and_then(|x| x.get(&f))
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect::<Vec<_>>())
                    .unwrap_or_default();
                if let Some(t) = pick(&tos, rnd) {
                    return act(game, json!({"type": "move_ship", "from": f, "to": t}));
                }
            }
            if let Some(t) = v.get("trade").and_then(|x| x.as_object()) {
                let from = t.get("from").and_then(|x| x.as_u64()).unwrap_or(99) as usize;
                let empty = t.get("responses").and_then(|x| x.as_object()).map(|o| o.is_empty()).unwrap_or(true);
                if from == pid && empty {
                    return Ok(false);
                }
            }
            act(game, json!({"type": if sbp { "sbp_done" } else { "end_turn" }}))
        }
        _ => Ok(false),
    }
}
