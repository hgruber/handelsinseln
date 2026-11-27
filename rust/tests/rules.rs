// Gezielte Regeltests mit handgebautem Brett – Portierung der früheren Node-Tests.
// Sie treiben die öffentliche Game-API wie ein Client und prüfen Zustand und Meldungen.
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use handelsinseln::board;
use handelsinseln::game::{Game, GameError};
use handelsinseln::game_lobby::SEAT_CLOCK;
use handelsinseln::geom;
use handelsinseln::model::*;
use handelsinseln::rng::Rng;
use handelsinseln::settings::{self, Settings};
use handelsinseln::table_offer;
use serde_json::{json, Value};

const COLORS: [&str; 6] = ["rot", "blau", "orange", "weiss", "gruen", "violett"];

fn new_game(n: usize, seed: u32) -> Game {
    let mut g = Game::new(Arc::new(Mutex::new(Rng::seeded(seed))), "test", "Test");
    for i in 0..n {
        g.join(&format!("P{i}"), COLORS[i], None, None).unwrap();
    }
    g
}

/// Flaches Testbrett: Land in Reihe (0..4,0), darum Meer; Nebel außerhalb.
fn hand_board(n: usize) -> Game {
    let mut g = new_game(n, 7);
    g.act(0, &json!({ "type": "start" })).unwrap();
    {
        let s = &mut g.S;
        s.hexes.clear();
        s.harbors.clear();
        s.verts.clear();
        s.edges.clear();
        let types = ["wald", "huegel", "weide", "acker", "gebirge"];
        let nums = [4, 5, 6, 8, 9];
        let mut land = Vec::new();
        for q in 0..=4i32 {
            let k = geom::hk(q, 0);
            land.push(k.clone());
            s.hexes.insert(
                k,
                Hex { t: types[q as usize].to_string(), n: Some(nums[q as usize]) },
            );
        }
        for q in -3..=7i32 {
            for r in -3..=3i32 {
                s.hexes
                    .entry(geom::hk(q, r))
                    .or_insert(Hex { t: "meer".to_string(), n: None });
            }
        }
        s.robber = Some("9,9".to_string());
        s.hexes
            .insert("9,9".to_string(), Hex { t: "wueste".to_string(), n: None });
        s.pirate = Some("-3,-3".to_string());
        s.home = land;
        s.phase = "main".to_string();
        s.setup = None;
        s.order = (0..n).collect();
    }
    g.start_turn(0);
    g.S.ts.rolled = true;
    g
}

fn v(a: &str, b: &str, c: &str) -> String {
    geom::vert_key(a, b, c)
}

fn hand(g: &mut Game, pid: usize, holz: u32, lehm: u32, wolle: u32, getreide: u32, erz: u32) {
    g.pl_mut(pid).hand = Hand { holz, lehm, wolle, getreide, erz };
}

fn building(p: usize, k: &str) -> Building {
    Building { p, k: k.to_string(), t: None }
}

fn act_err(g: &mut Game, pid: usize, a: Value) -> String {
    match g.act(pid, &a) {
        Ok(()) => panic!("Aktion sollte scheitern: {a}"),
        Err(GameError(m)) => m,
    }
}

fn expect_act_err(g: &mut Game, pid: usize, a: Value, needle: &str) {
    let m = act_err(g, pid, a);
    assert!(m.contains(needle), "Meldung {m:?} enthält {needle:?} nicht");
}

#[test]
fn karten_wuerfelertrag_siedlung_stadt_raeuber() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,1", "-1,1"); // an Wald (4)
    g.S.verts.insert(a, building(1, "s"));
    g.S.verts.insert(v("0,0", "1,-1", "1,0"), building(2, "c"));
    g.produce(4);
    assert_eq!(g.pl(1).hand.holz, 1);
    assert_eq!(g.pl(2).hand.holz, 2);
    g.S.robber = Some("0,0".to_string());
    g.produce(4);
    assert_eq!(g.pl(1).hand.holz, 1);
}

#[test]
fn gold_ertrag_wird_zur_freien_wahl() {
    let mut g = hand_board(3);
    g.S.hexes.insert("2,0".to_string(), Hex { t: "gold".to_string(), n: Some(6) });
    g.S.verts.insert(v("2,0", "2,-1", "3,-1"), building(1, "c"));
    g.produce(6);
    assert_eq!(g.S.pend.gold.get(&1), Some(&2));
    expect_act_err(&mut g, 0, json!({ "type": "end_turn" }), "Pflichten");
    g.act(1, &json!({ "type": "gold_pick", "cards": { "erz": 2 } })).unwrap();
    assert_eq!(g.pl(1).hand.erz, 2);
    assert!(g.S.pend.gold.is_empty());
}

#[test]
fn siedlung_abstandsregel_und_anschluss() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,1", "-1,1");
    let b = geom::vert_neighbors(&a)[0].clone();
    g.S.verts.insert(a, building(0, "s"));
    hand(&mut g, 0, 5, 5, 5, 5, 0);
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "build_settlement", "v": b }),
        "Anschluss",
    );
    let far = v("3,0", "3,1", "2,1");
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "build_settlement", "v": far }),
        "Anschluss",
    );
}

#[test]
fn strasse_nur_am_eigenen_netz_und_nicht_ueber_fremde_siedlung() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,1", "-1,1");
    g.S.verts.insert(a.clone(), building(0, "s"));
    let e1 = geom::vert_edges(&a)
        .into_iter()
        .find(|e| g.edge_for(e, "r"))
        .expect("Landkante");
    hand(&mut g, 0, 5, 5, 0, 0, 0);
    g.act(0, &json!({ "type": "build_road", "e": e1 })).unwrap();
    let far = geom::vert_edges(&v("3,0", "3,1", "2,1"))
        .into_iter()
        .find(|e| g.edge_for(e, "r"))
        .unwrap();
    expect_act_err(&mut g, 0, json!({ "type": "build_road", "e": far }), "anschließen");
    let end = geom::edge_verts(&e1)
        .into_iter()
        .find(|x| x != &a)
        .unwrap();
    g.S.verts.insert(end.clone(), building(1, "s"));
    let next: Vec<String> = geom::vert_edges(&end)
        .into_iter()
        .filter(|e| e != &e1 && g.edge_for(e, "r"))
        .collect();
    for e in next {
        expect_act_err(&mut g, 0, json!({ "type": "build_road", "e": e }), "anschließen");
    }
}

#[test]
fn schiff_nur_auf_wasserkanten_strasse_nicht_ins_wasser() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,-1", "1,-1");
    g.S.verts.insert(a, building(0, "s"));
    hand(&mut g, 0, 5, 5, 5, 0, 0);
    let sea_edge = geom::edge_key("0,-1", "1,-1");
    assert!(g.edge_for(&sea_edge, "s") && !g.edge_for(&sea_edge, "r"));
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "build_road", "e": sea_edge }),
        "an Land",
    );
    g.act(0, &json!({ "type": "build_ship", "e": sea_edge })).unwrap();
    assert_eq!(g.S.edges.get(&sea_edge).unwrap().k, "s");
}

/// Erster Seed, dessen erster Zufallswert unter der Landchance am Nebelrand (0,16) liegt.
fn land_seed() -> u32 {
    for s in 0..100_000u32 {
        let mut r = Rng::seeded(s);
        if r.next_f64() < 0.16 {
            return s;
        }
    }
    panic!("kein Seed für Land gefunden");
}

#[test]
fn entdeckung_schiff_am_nebelrand_deckt_feld_auf() {
    let mut g = hand_board(3);
    let fog = "0,-3".to_string();
    g.S.hexes.shift_remove(&fog);
    let edge = {
        let s = &g.S;
        geom::hex_edges("0,-2")
            .into_iter()
            .find(|e| {
                geom::edge_hexes(e).iter().all(|h| s.hexes.contains_key(h))
                    && geom::edge_verts(e)
                        .iter()
                        .any(|v| geom::vert_hexes(v).contains(&fog))
            })
            .expect("Kante am Nebel")
    };
    let own = geom::edge_verts(&edge)[0].clone();
    g.S.verts.insert(own, building(0, "s")); // künstlicher Anschluss (auf Wasser, nur Test)
    hand(&mut g, 0, 1, 0, 1, 0, 0);
    g.S.pirate = Some("5,5".to_string());
    g.S.hexes.insert("5,5".to_string(), Hex { t: "meer".to_string(), n: None });
    g.rnd = Arc::new(Mutex::new(Rng::seeded(land_seed())));
    g.act(0, &json!({ "type": "build_ship", "e": edge })).unwrap();
    let h = g.S.hexes.get(&fog).expect("Nebel aufgedeckt");
    assert_ne!(h.t, "meer");
}

#[test]
fn schiffe_neu_nicht_versetzbar_offen_schon() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,-1", "1,-1");
    g.S.verts.insert(a.clone(), building(0, "s"));
    let e1 = geom::vert_edges(&a)
        .into_iter()
        .find(|e| g.edge_for(e, "s"))
        .unwrap();
    let tn = g.S.turn_no;
    g.S.edges.insert(e1.clone(), Building { p: 0, k: "s".to_string(), t: Some(tn) });
    let (from, _) = g.ship_moves(0);
    assert!(from.is_empty(), "neu gebautes Schiff darf nicht versetzbar sein");
    g.S.turn_no += 1;
    let (from, to) = g.ship_moves(0);
    assert!(from.contains(&e1));
    let to0 = to.get(&e1).unwrap()[0].clone();
    g.act(0, &json!({ "type": "move_ship", "from": e1, "to": to0 })).unwrap();
    assert!(g.S.ts.moved_ship);
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "move_ship", "from": to0, "to": e1 }),
        "schon",
    );
}

#[test]
fn pirat_blockiert_schiffsbau() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,-1", "1,-1");
    g.S.verts.insert(a.clone(), building(0, "s"));
    let e1 = geom::vert_edges(&a)
        .into_iter()
        .find(|e| g.edge_for(e, "s"))
        .unwrap();
    let sea = geom::edge_hexes(&e1)
        .into_iter()
        .find(|h| g.S.hexes.get(h).map(|x| x.t == "meer").unwrap_or(false))
        .unwrap();
    g.S.pirate = Some(sea);
    hand(&mut g, 0, 2, 0, 2, 0, 0);
    expect_act_err(&mut g, 0, json!({ "type": "build_ship", "e": e1 }), "Pirat");
}

#[test]
fn raeuber_abwerfen_versetzen_stehlen() {
    let mut g = hand_board(3);
    g.S.ts.rolled = false;
    hand(&mut g, 1, 4, 4, 0, 0, 0);
    hand(&mut g, 2, 0, 0, 0, 0, 2);
    g.S.verts.insert(v("1,0", "1,-1", "0,0"), building(2, "s"));
    g.S.dice = Some((3, 4));
    g.S.ts.rolled = true;
    g.S.ts.sub = Some("robber".to_string());
    g.S.pend.discard.insert(1, 4);
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "move_robber", "hex": "1,0" }),
        "Pflichten",
    );
    expect_act_err(
        &mut g,
        1,
        json!({ "type": "discard", "cards": { "holz": 1 } }),
        "genau 4",
    );
    g.act(1, &json!({ "type": "discard", "cards": { "holz": 2, "lehm": 2 } }))
        .unwrap();
    assert_eq!(g.hand_size(1), 4);
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "move_robber", "hex": "9,9" }),
        "anderes",
    );
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "move_robber", "hex": "0,5" }),
        "Landfeld",
    );
    g.act(0, &json!({ "type": "move_robber", "hex": "1,0" })).unwrap();
    assert_eq!(g.S.robber.as_deref(), Some("1,0"));
    assert_eq!(g.pl(0).hand.erz, 1);
    assert_eq!(g.pl(2).hand.erz, 1);
    assert!(g.S.ts.sub.is_none());
}

#[test]
fn pirat_stiehlt_von_spieler_mit_schiff_am_feld() {
    let mut g = hand_board(3);
    g.S.ts.sub = Some("robber".to_string());
    let sea = "2,-1";
    let e = geom::hex_edges(sea)
        .into_iter()
        .find(|x| g.edge_for(x, "s"))
        .unwrap();
    g.S.edges.insert(e, Building { p: 1, k: "s".to_string(), t: Some(0) });
    hand(&mut g, 1, 3, 0, 0, 0, 0);
    g.act(0, &json!({ "type": "move_pirate", "hex": sea })).unwrap();
    assert_eq!(g.S.pirate.as_deref(), Some(sea));
    assert_eq!(g.pl(0).hand.holz, 1);
}

#[test]
fn laengster_handelsweg_ab_fuenf_und_unterbrechung() {
    let mut g = hand_board(3);
    let mut path = Vec::new();
    let mut cur = v("0,0", "0,1", "-1,1");
    g.S.verts.insert(cur.clone(), building(0, "s"));
    let mut seen = vec![cur.clone()];
    for i in 0..5 {
        let e = geom::vert_edges(&cur)
            .into_iter()
            .find(|x| {
                !g.S.edges.contains_key(x)
                    && g.edge_for(x, "r")
                    && !seen.contains(&geom::edge_verts(x).into_iter().find(|y| y != &cur).unwrap())
            })
            .unwrap_or_else(|| panic!("Kante {i}"));
        g.S.edges.insert(e.clone(), Building { p: 0, k: "r".to_string(), t: Some(0) });
        cur = geom::edge_verts(&e).into_iter().find(|y| y != &cur).unwrap();
        seen.push(cur.clone());
        path.push(e);
    }
    g.update_awards(true);
    assert_eq!(g.route_len(0), 5);
    assert_eq!(g.S.longest, Some(0));
    assert_eq!(g.vp(0), 3);
    let ends1 = geom::edge_verts(&path[1]);
    let mid = geom::edge_verts(&path[2])
        .into_iter()
        .find(|x| !ends1.contains(x))
        .unwrap();
    g.S.verts.insert(mid, building(1, "s"));
    g.update_awards(true);
    assert!(g.route_len(0) < 5);
    assert!(g.S.longest.is_none());
}

#[test]
fn strasse_und_schiff_verbinden_nur_ueber_eigene_siedlung() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,-1", "1,-1");
    let sea = geom::edge_key("0,-1", "1,-1");
    let road = geom::edge_key("0,0", "0,-1");
    g.S.edges.insert(sea, Building { p: 0, k: "s".to_string(), t: Some(0) });
    g.S.edges.insert(road, Building { p: 0, k: "r".to_string(), t: Some(0) });
    assert_eq!(g.route_len(0), 1);
    g.S.verts.insert(a, building(0, "s"));
    assert_eq!(g.route_len(0), 2);
}

#[test]
fn staerkste_schutzmacht_ab_drei_rittern_und_mehrheit() {
    let mut g = hand_board(3);
    g.pl_mut(0).knights = 3;
    g.update_awards(true);
    assert_eq!(g.S.largest, Some(0));
    g.pl_mut(1).knights = 3;
    g.update_awards(true);
    assert_eq!(g.S.largest, Some(0));
    g.pl_mut(1).knights = 4;
    g.update_awards(true);
    assert_eq!(g.S.largest, Some(1));
}

#[test]
fn inselbonus_erste_siedlung_auf_neuer_insel() {
    let mut g = hand_board(3);
    g.S.hexes.insert("9,0".to_string(), Hex { t: "wald".to_string(), n: Some(3) });
    g.S.hexes.insert("10,0".to_string(), Hex { t: "weide".to_string(), n: Some(5) });
    g.pl_mut(0).claimed.insert("0,0".to_string(), 1);
    g.place_settlement(0, &v("9,0", "9,-1", "10,-1"), false);
    assert_eq!(g.pl(0).svp, 2);
    g.place_settlement(0, &v("10,0", "10,1", "9,1"), false);
    assert_eq!(g.pl(0).svp, 2);
}

#[test]
fn punkte_nach_quellen_und_verdeckte_karten() {
    let mut g = hand_board(3);
    g.S.hexes.insert("9,0".to_string(), Hex { t: "wald".to_string(), n: Some(3) });
    g.S.hexes.insert("10,0".to_string(), Hex { t: "weide".to_string(), n: Some(5) });
    g.pl_mut(0).claimed.insert("0,0".to_string(), 1);
    g.place_settlement(0, &v("9,0", "9,-1", "10,-1"), false);
    g.pl_mut(0).knights = 3;
    g.update_awards(true);
    g.pl_mut(0).dev.push(DevCard { id: 1, kind: "siegpunkt".to_string(), bought: 0 });
    let vp = g.vp(0);
    let view = g.view(Some(0));
    let x = &view["players"][0]["vpParts"];
    let sum = x["settlements"].as_i64().unwrap()
        + 2 * x["cities"].as_i64().unwrap()
        + x["islands"].as_i64().unwrap()
        + x["longest"].as_i64().unwrap()
        + x["largest"].as_i64().unwrap();
    assert_eq!(sum, vp);
    assert_eq!(x["islands"], 2);
    assert_eq!(x["largest"], 2);
    assert_eq!(x["cards"], 1);
    assert!(g.view(Some(1))["players"][0]["vpParts"]["cards"].is_null());
    assert!(g.view(None)["players"][0]["vpParts"]["cards"].is_null());
}

#[test]
fn bankhandel_mit_hafenkursen() {
    let mut g = hand_board(3);
    let e = geom::hex_edges("0,0")
        .into_iter()
        .find(|x| {
            geom::edge_hexes(x)
                .iter()
                .any(|h| g.S.hexes.get(h).map(|x| x.t == "meer").unwrap_or(false))
        })
        .unwrap();
    g.S.harbors.insert(e.clone(), Harbor { kind: "holz".to_string() });
    g.S.verts.insert(geom::edge_verts(&e)[0].clone(), building(0, "s"));
    let rates = g.rates_for(0);
    assert_eq!(rates.get("holz"), Some(&2));
    assert_eq!(rates.get("lehm"), Some(&4));
    hand(&mut g, 0, 4, 4, 0, 0, 0);
    g.act(0, &json!({ "type": "bank_trade", "give": "holz", "get": "erz", "n": 2 }))
        .unwrap();
    assert_eq!(g.pl(0).hand.holz, 0);
    assert_eq!(g.pl(0).hand.erz, 2);
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "bank_trade", "give": "lehm", "get": "erz", "n": 2 }),
        "brauchst",
    );
    g.S.harbors.insert(e, Harbor { kind: "any".to_string() });
    assert_eq!(g.rates_for(0).get("lehm"), Some(&3));
}

#[test]
fn spielerhandel_angebot_zusage_gegenangebot_abschluss() {
    let mut g = hand_board(3);
    hand(&mut g, 0, 2, 0, 0, 0, 0);
    hand(&mut g, 1, 0, 0, 0, 0, 1);
    hand(&mut g, 2, 0, 1, 3, 0, 0);
    g.act(
        0,
        &json!({ "type": "trade_offer", "give": { "holz": 2 }, "want": { "erz": 1 } }),
    )
    .unwrap();
    expect_act_err(&mut g, 2, json!({ "type": "trade_respond", "accept": true }), "fehlen");
    g.act(
        2,
        &json!({
            "type": "trade_respond",
            "counter": { "give": { "holz": 1 }, "want": { "wolle": 2 } }
        }),
    )
    .unwrap();
    g.act(1, &json!({ "type": "trade_respond", "accept": true })).unwrap();
    expect_act_err(
        &mut g,
        1,
        json!({ "type": "trade_confirm", "with": 2 }),
        "kein offenes Angebot",
    );
    g.act(0, &json!({ "type": "trade_confirm", "with": 2 })).unwrap();
    assert_eq!(g.pl(0).hand.holz, 1);
    assert_eq!(g.pl(0).hand.wolle, 2);
    assert_eq!(g.pl(2).hand.holz, 1);
    assert!(g.S.trade.is_none());
    g.act(
        0,
        &json!({ "type": "trade_offer", "give": { "holz": 1 }, "want": { "erz": 1 } }),
    )
    .unwrap();
    g.act(1, &json!({ "type": "trade_respond", "accept": true })).unwrap();
    g.act(0, &json!({ "type": "trade_confirm", "with": 1 })).unwrap();
    assert_eq!(g.pl(0).hand.erz, 1);
    assert_eq!(g.pl(1).hand.holz, 1);
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "trade_offer", "give": { "holz": 1 }, "want": { "holz": 1 } }),
        "dieselbe",
    );
}

#[test]
fn sonderbauphase_fragt_nur_sofort_baubare_spieler() {
    let mut g = hand_board(5);
    g.S.verts.insert(v("0,0", "0,-1", "1,-1"), building(1, "s"));
    g.S.verts.insert(v("2,0", "2,-1", "3,-1"), building(2, "s"));
    // Spieler 1 könnte nur nach einem Banktausch bauen (Holz im Überfluss, kein Lehm),
    // Spieler 2 hat die Rohstoffe für eine Straße sofort.
    hand(&mut g, 1, 5, 0, 0, 0, 0);
    hand(&mut g, 2, 1, 1, 0, 0, 0);
    g.act(0, &json!({ "type": "end_turn" })).unwrap();
    assert_eq!(g.S.sbp.as_ref().and_then(|s| s.pid), Some(2), "Spieler 1 wird übersprungen");
    // In der Sonderbauphase wird nicht gehandelt – auch nicht mit der Bank.
    expect_act_err(
        &mut g,
        2,
        json!({ "type": "bank_trade", "give": "lehm", "get": "erz" }),
        "Sonderbauphase",
    );
    expect_act_err(
        &mut g,
        2,
        json!({ "type": "trade_offer", "give": { "holz": 1 }, "want": { "erz": 1 } }),
        "kein Handel",
    );
}

#[test]
fn wuerfelhinweis_nur_mit_spielbarer_entwicklungskarte() {
    let mut g = hand_board(3);
    let txt = |g: &Game| g.prompt(Some(0), "roll").as_str().unwrap().to_string();
    assert_eq!(txt(&g), "Du bist dran – würfle!");
    g.pl_mut(0).dev.push(DevCard { id: 1, kind: "siegpunkt".to_string(), bought: 0 });
    assert_eq!(txt(&g), "Du bist dran – würfle!");
    let turn_no = g.S.turn_no;
    g.pl_mut(0).dev.push(DevCard { id: 2, kind: "ritter".to_string(), bought: turn_no });
    assert_eq!(txt(&g), "Du bist dran – würfle!", "frisch gekaufte Karten zählen nicht");
    g.pl_mut(0).dev.push(DevCard { id: 3, kind: "ritter".to_string(), bought: 0 });
    assert!(txt(&g).contains("Entwicklungskarte spielen"));
}

#[test]
fn angebot_als_mitspieler_auch_vor_dem_wurf_des_spielenden() {
    let mut g = hand_board(3);
    hand(&mut g, 0, 0, 0, 0, 0, 1);
    hand(&mut g, 1, 1, 0, 0, 0, 0);
    // Mitspieler darf dem Spielenden jederzeit ein Angebot machen – dessen Wurf ist nicht nötig.
    g.S.ts.rolled = false;
    g.act(1, &json!({ "type": "trade_offer", "give": { "holz": 1 }, "want": { "erz": 1 } }))
        .unwrap();
    assert_eq!(g.S.trade.as_ref().unwrap().from, 1);
    // Solange ein Angebot läuft, kann kein zweites eröffnet werden.
    hand(&mut g, 2, 1, 0, 0, 0, 0);
    expect_act_err(
        &mut g,
        2,
        json!({ "type": "trade_offer", "give": { "holz": 1 }, "want": { "erz": 1 } }),
        "bereits ein Angebot",
    );
    // Der Spielende nimmt an, der Mitspieler bestätigt auch außer der Reihe.
    g.act(0, &json!({ "type": "trade_respond", "accept": true })).unwrap();
    g.act(1, &json!({ "type": "trade_confirm", "with": 0 })).unwrap();
    assert_eq!(g.pl(1).hand.erz, 1);
    assert_eq!(g.pl(0).hand.holz, 1);
    assert!(g.S.trade.is_none());
    // Der Spielende selbst bietet erst nach dem Würfeln.
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "trade_offer", "give": { "holz": 1 }, "want": { "erz": 1 } }),
        "Würfle zuerst",
    );
    // Die Bank bleibt dem Spielenden im eigenen Zug vorbehalten.
    hand(&mut g, 0, 4, 0, 0, 0, 0);
    expect_act_err(
        &mut g,
        1,
        json!({ "type": "bank_trade", "give": "holz", "get": "erz" }),
        "am Zug",
    );
}

#[test]
fn entwicklungskarten_nicht_gleiche_runde_eine_pro_zug_monopol() {
    let mut g = hand_board(3);
    hand(&mut g, 0, 0, 0, 1, 1, 1);
    g.S.deck = vec!["erfindung".to_string(), "monopol".to_string()];
    g.act(0, &json!({ "type": "buy_dev" })).unwrap();
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "play_monopoly", "res": "holz" }),
        "nächsten Zug",
    );
    g.S.turn_no += 1;
    hand(&mut g, 1, 3, 0, 0, 0, 0);
    hand(&mut g, 2, 2, 0, 0, 0, 0);
    g.act(0, &json!({ "type": "play_monopoly", "res": "holz" })).unwrap();
    assert_eq!(g.pl(0).hand.holz, 5);
    g.pl_mut(0)
        .dev
        .push(DevCard { id: 99, kind: "erfindung".to_string(), bought: 0 });
    expect_act_err(
        &mut g,
        0,
        json!({ "type": "play_yop", "a": "erz", "b": "erz" }),
        "Entwicklungskarte",
    );
}

#[test]
fn strassenbau_karte_zwei_kostenlose_wege_auch_schiff() {
    let mut g = hand_board(3);
    let a = v("0,0", "0,-1", "1,-1");
    g.S.verts.insert(a, building(0, "s"));
    g.pl_mut(0)
        .dev
        .push(DevCard { id: 5, kind: "strassenbau".to_string(), bought: 0 });
    g.S.turn_no = 3;
    g.act(0, &json!({ "type": "play_roadbuilding" })).unwrap();
    assert_eq!(g.S.ts.sub.as_deref(), Some("road_building"));
    let sea = g.legal(Some(0))["ship"][0].as_str().unwrap().to_string();
    g.act(0, &json!({ "type": "build_ship", "e": sea })).unwrap();
    assert_eq!(g.S.ts.rb, 1);
    g.act(0, &json!({ "type": "skip_roadbuilding" })).unwrap();
    assert!(g.S.ts.sub.is_none());
    assert_eq!(g.pl(0).hand.holz, 0);
}

#[test]
fn sieg_bei_14_punkten_inklusive_verdeckter_karten() {
    let mut g = hand_board(3);
    for i in 0..4i32 {
        let a = format!("{},0", i * 20);
        let b = format!("{},1", i * 20);
        let c = format!("{},1", i * 20 - 1);
        g.S.verts.insert(v(&a, &b, &c), building(0, "c"));
    }
    g.pl_mut(0).svp = 4;
    assert_eq!(g.vp(0), 12);
    g.pl_mut(0).dev.push(DevCard { id: 1, kind: "siegpunkt".to_string(), bought: 0 });
    g.pl_mut(0).dev.push(DevCard { id: 2, kind: "siegpunkt".to_string(), bought: 0 });
    hand(&mut g, 0, 0, 0, 0, 0, 0);
    g.act(0, &json!({ "type": "chat", "text": "hi" })).unwrap();
    g.check_win();
    assert_eq!(g.S.phase, "ended");
    assert_eq!(g.S.winner, Some(0));
}

#[test]
fn sonderbauphase_ueberspringt_spieler_ohne_moeglichkeiten() {
    let mut g = hand_board(5);
    g.S.verts.insert(v("0,0", "0,1", "-1,1"), building(1, "s"));
    hand(&mut g, 1, 1, 1, 1, 1, 0);
    for p in [0usize, 2, 3, 4] {
        hand(&mut g, p, 0, 0, 0, 0, 0);
    }
    g.act(0, &json!({ "type": "end_turn" })).unwrap();
    assert_eq!(g.S.sbp.as_ref().unwrap().pid, Some(1));
    expect_act_err(&mut g, 2, json!({ "type": "sbp_done" }), "baut gerade");
    expect_act_err(
        &mut g,
        1,
        json!({ "type": "trade_offer", "give": { "holz": 1 }, "want": { "erz": 1 } }),
        "Sonderbauphase",
    );
    g.act(1, &json!({ "type": "sbp_done" })).unwrap();
    assert!(g.S.sbp.is_none());
    assert_eq!(g.S.turn, 1);
}

#[test]
fn lobby_farbe_name_max_sechs_host_und_reconnect() {
    let mut g = Game::new(Arc::new(Mutex::new(Rng::seeded(1))), "test", "Test");
    let (token, pid) = g.join("Anna", "rot", None, None).unwrap();
    assert_eq!(pid, 0);
    assert!(g.join("Anna", "blau", None, None).unwrap_err().0.contains("Name"));
    assert!(g.join("Ben", "rot", None, None).unwrap_err().0.contains("Farbe"));
    assert!(g.join("", "blau", None, None).unwrap_err().0.contains("Namen"));
    for (n, c) in [
        ("B", "blau"),
        ("C", "orange"),
        ("D", "weiss"),
        ("E", "gruen"),
        ("F", "violett"),
    ] {
        g.join(n, c, None, None).unwrap();
    }
    assert!(g.join("G", "rot", None, None).unwrap_err().0.contains("voll"));
    // Spielname: nur der Spielleiter, nur vor Spielbeginn, höchstens 40 Zeichen; leer = Standardname
    expect_act_err(&mut g, 1, json!({ "type": "rename", "name": "Abendrunde" }), "Spielleiter");
    assert!(g.act(0, &json!({ "type": "rename", "name": "x".repeat(41) })).is_err());
    g.act(0, &json!({ "type": "rename", "name": "  Abendrunde  " })).unwrap();
    assert_eq!(g.meta_name, "Abendrunde");
    g.act(0, &json!({ "type": "rename", "name": "" })).unwrap();
    assert_eq!(g.meta_name, "Test");
    expect_act_err(&mut g, 1, json!({ "type": "start" }), "Spielleiter");
    assert_eq!(g.join("x", "rot", Some(&token), None).unwrap().1, 0);
    g.act(0, &json!({ "type": "start" })).unwrap();
    assert_eq!(g.S.phase, "setup");
    expect_act_err(&mut g, 0, json!({ "type": "rename", "name": "Spät" }), "vor Spielbeginn");
    assert!(g.join("Neu", "rot", None, None).unwrap_err().0.contains("läuft"));
}

#[test]
fn bot_weicht_der_farbe_eines_menschen() {
    let mut g = Game::new(Arc::new(Mutex::new(Rng::seeded(1))), "test", "Test");
    g.join("Anna", "rot", None, None).unwrap();
    g.add_bot(0, Some("baumeister")).unwrap();
    let bot = g.S.players.iter().find(|p| p.bot.is_some()).unwrap().id;
    assert_eq!(g.S.players[bot].color, "blau");
    g.join("Ben", "blau", None, None).unwrap();
    assert_eq!(g.S.players[bot].color, "orange", "Bot weicht zuerst");
    assert_eq!(g.S.players.iter().find(|p| p.name == "Ben").unwrap().color, "blau");
}

#[test]
fn aufbau_schlangenreihenfolge_zweite_siedlung_und_startinsel() {
    let mut g = new_game(2, 3);
    g.act(0, &json!({ "type": "set_settings", "settings": { "dice": "auto" } }))
        .unwrap();
    g.act(0, &json!({ "type": "start" })).unwrap();
    let order = g.S.order.clone();
    let seq = [order[0], order[1], order[1], order[0]];
    for i in 0..4 {
        let pid = g.S.turn;
        assert_eq!(pid, seq[i]);
        let legal = g.legal(Some(pid));
        let spots = legal["settlement"].as_array().unwrap();
        assert!(!spots.is_empty());
        let first = spots[0].as_str().unwrap().to_string();
        let second = spots.get(1).map(|x| x.as_str().unwrap().to_string());
        g.act(pid, &json!({ "type": "place_settlement", "v": first }))
            .unwrap();
        if let Some(second) = second {
            assert!(g
                .act(pid, &json!({ "type": "place_settlement", "v": second }))
                .is_err());
        }
        let legal2 = g.legal(Some(pid));
        let roads = legal2["road"].as_array().unwrap();
        let ships = legal2["ship"].as_array().unwrap();
        let (ty, e) = if !roads.is_empty() {
            ("place_road", roads[0].as_str().unwrap().to_string())
        } else {
            ("place_ship", ships[0].as_str().unwrap().to_string())
        };
        g.act(pid, &json!({ "type": ty, "e": e })).unwrap();
        while let Some((&p, _)) = g.S.pend.gold.iter().next() {
            let need = g.S.pend.gold[&p];
            g.act(p, &json!({ "type": "gold_pick", "cards": { "holz": need } }))
                .unwrap();
        }
    }
    assert_eq!(g.S.phase, "main");
    assert_eq!(g.S.turn, order[0]);
}

#[test]
fn zustand_ist_json_serialisierbar_und_wiederherstellbar() {
    let mut g = hand_board(4);
    let value = serde_json::to_value(&g.S).unwrap();
    let state: State = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&state).unwrap(), value);
    let mut g2 = Game::from_state(
        state,
        Arc::new(Mutex::new(Rng::seeded(1))),
        "test",
        "Test",
    );
    assert_eq!(g2.view(Some(0))["hexes"], g.view(Some(0))["hexes"]);
    assert_eq!(g2.route_len(0), 0);
}

#[test]
fn einstellungen_standardwerte_und_validierung() {
    let d = Settings::default();
    assert_eq!(d.variant, "klassisch");
    assert_eq!(d.win_points, 14);
    assert_eq!(d.hand_limit, Some(7));
    assert_eq!(d.bank_rate, 4);
    assert_eq!(d.longest_min, 5);
    assert_eq!(d.army_min, 3);
    let m = settings::merge(
        &d,
        &json!({ "winPoints": 12, "variant": "nebel", "dice": "auto" }),
    )
    .unwrap();
    assert_eq!(m.win_points, 12);
    assert_eq!(m.variant, "nebel");
    assert_eq!(m.dice, "auto");
    assert!(settings::merge(&d, &json!({ "winPoints": 2 })).is_err());
    assert!(settings::merge(&d, &json!({ "variant": "quatsch" })).is_err());
    assert!(settings::merge(&d, &json!({ "bankRate": 1 })).is_err());
}

#[test]
fn alle_varianten_erzeugen_ein_spielbares_brett() {
    for variant in ["klassisch", "nebel", "inseln", "archipel"] {
        let set = Settings { variant: variant.to_string(), ..Settings::default() };
        let mut state = State::empty(set.clone());
        let mut rnd = Rng::seeded(9);
        board::generate(&mut state, 4, &mut rnd, &set);
        assert!(!state.hexes.is_empty(), "{variant}: keine Felder");
        assert!(!state.home.is_empty(), "{variant}: keine Startinsel");
        let robber = state.robber.clone().expect("Räuber fehlt");
        assert_eq!(
            state.hexes.get(&robber).map(|h| h.t.as_str()),
            Some("wueste"),
            "{variant}: Räuber nicht auf Wüste"
        );
    }
}

fn tisch_anker(list: &[(usize, &str)]) -> BTreeMap<usize, String> {
    list.iter().map(|(p, s)| (*p, s.to_string())).collect()
}

#[test]
fn tisch_platzverteilung_folgt_der_reihenfolge() {
    let order = [0, 1, 2];
    let a = tisch_anker(&[(0, "b"), (1, "l"), (2, "t")]);
    let p = table_offer::place(&order, &a);
    assert!(p.unsatisfied.is_empty(), "alle Wünsche möglich");
    assert_eq!(p.seats.get(&0).map(String::as_str), Some("b"));
    assert_eq!(p.seats.get(&1).map(String::as_str), Some("l"));
    assert_eq!(p.seats.get(&2).map(String::as_str), Some("t"));

    // Dieselben Plätze, andere Reihenfolge: Die Zuordnung darf rotieren.
    let a = tisch_anker(&[(2, "b"), (0, "l"), (1, "t")]);
    let p = table_offer::place(&order, &a);
    assert!(p.unsatisfied.is_empty(), "Rotation ist erlaubt");
    let mut clockwise = vec![0usize, 1, 2];
    clockwise.sort_by_key(|pid| {
        SEAT_CLOCK
            .iter()
            .position(|s| Some(*s) == p.seats.get(pid).map(String::as_str))
            .unwrap()
    });
    assert_eq!(clockwise, vec![2, 0, 1], "Plätze laufen im Uhrzeigersinn");
}

#[test]
fn tisch_platzverteilung_erkennt_konflikt_und_erlaubte_plaetze() {
    let order = [0, 1, 2];
    let a = tisch_anker(&[(0, "b"), (1, "tr"), (2, "t")]);
    let p = table_offer::place(&order, &a);
    assert_eq!(p.kept.len(), 2, "zwei Wünsche bleiben erhalten");
    assert_eq!(
        p.unsatisfied.iter().copied().collect::<Vec<_>>(),
        vec![1],
        "der unvereinbare Wunsch wird erneut gefragt"
    );
    let kept: BTreeMap<usize, String> = a
        .iter()
        .filter(|(q, _)| p.kept.contains(q))
        .map(|(q, s)| (*q, s.clone()))
        .collect();
    let allowed = table_offer::allowed_seats(&order, &kept, 1);
    assert_eq!(allowed, vec!["bl", "l", "tl"], "nur Plätze zwischen b und t");
    let mut b = kept;
    b.insert(1, allowed[0].clone());
    assert!(table_offer::place(&order, &b).unsatisfied.is_empty());
}

#[test]
fn tisch_platzverteilung_bei_doppeltem_wunsch() {
    let order = [0, 1, 2];
    let a = tisch_anker(&[(0, "b"), (1, "b")]);
    let p = table_offer::place(&order, &a);
    assert_eq!(p.kept.len(), 1, "nur einer kann auf dem Platz sitzen");
    assert_eq!(p.unsatisfied.len(), 1);
    assert_eq!(p.seats.len(), 3, "trotzdem alle Spieler platziert");
}

#[test]
fn tisch_platzverteilung_erlaubte_plaetze_zwischen_ankern() {
    let order = [0, 1, 2];
    let a = tisch_anker(&[(0, "b"), (2, "t")]);
    assert_eq!(table_offer::allowed_seats(&order, &a, 1), vec!["bl", "l", "tl"]);
}
