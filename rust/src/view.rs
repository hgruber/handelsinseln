// Sichten – Portierung von server/game_view.js (legal, prompt, view, watchView, Statistik).
use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use crate::game::{Game, UNLIMITED};
use crate::geom;
use crate::model::State;
use crate::rules::RES;

impl Game {
    pub fn vp_parts(&self, pid: usize, cards: bool) -> Value {
        let S = &self.S;
        let p = self.pl(pid);
        json!({
            "settlements": self.count(pid, "s"),
            "cities": self.count(pid, "c"),
            "islands": p.svp,
            "islandCount": p.island_bonus,
            "longest": if S.longest == Some(pid) { 2 } else { 0 },
            "largest": if S.largest == Some(pid) { 2 } else { 0 },
            "cards": if cards { Value::from(self.hidden_vp(pid)) } else { Value::Null },
        })
    }

    pub fn stats_view(&self) -> Value {
        let S = &self.S;
        let st = match &S.stats {
            Some(st) if S.phase == "ended" => st,
            _ => return Value::Null,
        };
        let mut rolls = Map::new();
        for n in 2..=12u32 {
            rolls.insert(n.to_string(), json!(st.rolls.get(&n).copied().unwrap_or(0)));
        }
        let rounds = st.history.iter().filter(|h| h.end != Some(true)).count();
        let players: Vec<Value> = S
            .players
            .iter()
            .map(|p| {
                let x = &st.players[p.id];
                let mut produced = Map::new();
                let mut total = 0u32;
                for r in RES {
                    let n = x.produced.get(r);
                    total += n;
                    produced.insert(r.to_string(), json!(n));
                }
                produced.insert("total".to_string(), json!(total));
                json!({
                    "id": p.id, "name": &p.name, "color": &p.color,
                    "vp": self.vp(p.id) + self.hidden_vp(p.id) as i64,
                    "svp": p.svp,
                    "vpParts": self.vp_parts(p.id, true),
                    "built": &x.built,
                    "produced": Value::Object(produced),
                    "tradesPlayer": x.trades_player, "tradesBank": x.trades_bank,
                    "stolenFrom": x.stolen_from, "stolenBy": x.stolen_by,
                    "discarded": x.discarded, "knights": p.knights, "maxRoute": x.max_route,
                    "discovered": x.discovered, "robberMoves": x.robber_moves, "sevens": x.sevens,
                })
            })
            .collect();
        json!({
            "durationSec": (((st.ended_at.unwrap_or_else(crate::game::now_ms)) - st.started_at) as f64 / 1000.0).round() as i64,
            "turns": S.turn_no,
            "rounds": rounds,
            "aborted": S.aborted,
            "rolls": Value::Object(rolls),
            "history": &st.history,
            "players": players,
        })
    }

    pub fn legal(&mut self, pid: Option<usize>) -> Value {
        let empty_ship_to: IndexMap<String, Vec<String>> = IndexMap::new();
        let mut L = Map::new();
        L.insert("settlement".into(), json!([]));
        L.insert("city".into(), json!([]));
        L.insert("road".into(), json!([]));
        L.insert("ship".into(), json!([]));
        L.insert("shipFrom".into(), json!([]));
        L.insert("shipTo".into(), json!(empty_ship_to));
        L.insert("robber".into(), json!([]));
        L.insert("pirate".into(), json!([]));
        L.insert("steal".into(), json!([]));
        L.insert("takeover".into(), json!({"edges": [], "verts": []}));
        let pid = match pid {
            Some(p) => p,
            None => return Value::Object(L),
        };
        let S = &self.S;
        if S.phase == "setup" {
            if pid == S.turn && self.no_pending() {
                let stage = S.setup.as_ref().map(|s| s.stage.as_str()).unwrap_or("");
                if stage == "settlement" {
                    L.insert("settlement".into(), json!(self.settlement_spots(pid)));
                } else if stage == "road" {
                    L.insert("road".into(), json!(self.setup_path_spots(pid, "r")));
                    L.insert("ship".into(), json!(self.setup_path_spots(pid, "s")));
                }
            }
            return Value::Object(L);
        }
        if S.phase != "main" || !self.no_pending() {
            return Value::Object(L);
        }
        let active = self.S.sbp.as_ref().and_then(|s| s.pid).unwrap_or(self.S.turn);
        if pid != active {
            return Value::Object(L);
        }
        let sub = self.S.ts.sub.clone();
        if sub.as_deref() == Some("robber") {
            let keys: Vec<&String> = self.S.hexes.keys().collect();
            let robber: Vec<String> = keys
                .iter()
                .filter(|k| self.is_land_hex(k) && self.S.robber.as_deref() != Some(k.as_str()))
                .map(|k| (*k).clone())
                .collect();
            let pirate: Vec<String> = self
                .S
                .hexes
                .keys()
                .filter(|k| self.is_sea_hex(k) && self.S.pirate.as_deref() != Some(k.as_str()))
                .cloned()
                .collect();
            L.insert("robber".into(), json!(robber));
            L.insert("pirate".into(), json!(pirate));
            return Value::Object(L);
        }
        if sub.as_deref() == Some("steal") {
            L.insert("steal".into(), json!(self.S.ts.victims));
            return Value::Object(L);
        }
        if sub.as_deref() == Some("road_building") {
            let left = self.left(pid);
            if left.road > 0 {
                L.insert("road".into(), json!(self.path_spots(pid, "r")));
            }
            if left.ship > 0 {
                L.insert("ship".into(), json!(self.path_spots(pid, "s")));
            }
            return Value::Object(L);
        }
        if !self.S.ts.rolled && self.S.sbp.is_none() {
            return Value::Object(L);
        }
        let left = self.left(pid);
        if left.road > 0 {
            L.insert("road".into(), json!(self.path_spots(pid, "r")));
        }
        if left.ship > 0 {
            L.insert("ship".into(), json!(self.path_spots(pid, "s")));
        }
        if left.settlement > 0 {
            L.insert("settlement".into(), json!(self.settlement_spots(pid)));
        }
        if left.city > 0 {
            L.insert("city".into(), json!(self.city_spots(pid)));
        }
        if self.S.sbp.is_none() {
            let (from, to) = self.ship_moves(pid);
            L.insert("shipFrom".into(), json!(from));
            L.insert("shipTo".into(), json!(to));
            if !self.S.ts.moved_ship {
                let (e, v) = self.takeover_spots(pid);
                L.insert("takeover".into(), json!({"edges": e, "verts": v}));
            }
        }
        Value::Object(L)
    }

    pub fn prompt(&self, pid: Option<usize>, step: &str) -> Value {
        let S = &self.S;
        let turn = S.sbp.as_ref().and_then(|s| s.pid).unwrap_or(S.turn);
        let me = pid == Some(turn);
        let tn = self.name(turn);
        let txt = match step {
            "lobby" => {
                if pid == Some(S.host) {
                    "Warte auf Mitspieler – starte, sobald alle da sind."
                } else {
                    "Warte, bis der Spielleiter das Spiel startet."
                }
            }
            "ended" => {
                return Value::from(format!(
                    "{} hat gewonnen!",
                    S.winner.map(|w| self.name(w)).unwrap_or_default()
                ))
            }
            "discard" => {
                if let Some(n) = pid.and_then(|p| S.pend.discard.get(&p)).copied() {
                    return Value::from(format!("Eine 7! Wirf {} Karten ab.", n));
                }
                "Warte, bis alle Karten abgeworfen haben …"
            }
            "gold" => {
                if let Some(n) = pid.and_then(|p| S.pend.gold.get(&p)).copied() {
                    return Value::from(format!(
                        "Gold! Wähle {} beliebige{} Rohstoff{}.",
                        n,
                        if n > 1 { "" } else { "n" },
                        if n > 1 { "e" } else { "" }
                    ));
                }
                "Warte auf die Goldwahl der anderen …"
            }
            "setup_seat" => {
                if me { "Wo sitzt du?" } else { return Value::from(format!("{} wählt seinen Platz am Tisch.", tn)) }
            }
            "setup_order" => {
                if me {
                    "Würfle um die Reihenfolge – die höchste Augenzahl beginnt."
                } else {
                    return Value::from(format!("{} würfelt um die Reihenfolge.", tn));
                }
            }
            "setup_settlement" => {
                if me {
                    return Value::from(format!(
                        "Setze deine {} Siedlung.",
                        if S.setup.as_ref().map(|s| s.i >= S.order.len()).unwrap_or(false) {
                            "zweite"
                        } else {
                            "erste"
                        }
                    ));
                }
                return Value::from(format!("{} setzt eine Siedlung.", tn));
            }
            "setup_road" => {
                if me {
                    "Setze eine Straße oder (an der Küste) ein Schiff an deine neue Siedlung."
                } else {
                    return Value::from(format!("{} setzt eine Straße oder ein Schiff.", tn));
                }
            }
            "roll" => {
                if me {
                    let dev = pid
                        .and_then(|p| S.players.get(p))
                        .map(|p| {
                            !S.ts.dev_played
                                && p.dev.iter().any(|d| {
                                    d.kind != "siegpunkt"
                                        && d.kind != "stadtmauer"
                                        && d.bought < S.turn_no
                                })
                        })
                        .unwrap_or(false);
                    if dev {
                        "Du bist dran – würfle! (Vorher darfst du eine Entwicklungskarte spielen.)"
                    } else {
                        "Du bist dran – würfle!"
                    }
                } else {
                    return Value::from(format!("{} ist am Zug.", tn));
                }
            }
            "robber" => {
                if me {
                    "Versetze den Räuber (auf ein Landfeld) oder den Piraten (aufs Meer)."
                } else {
                    return Value::from(format!("{} versetzt Räuber oder Pirat.", tn));
                }
            }
            "steal" => {
                if me {
                    "Wähle, wen du bestehlen willst."
                } else {
                    return Value::from(format!("{} wählt ein Opfer.", tn));
                }
            }
            "road_building" => {
                if me {
                    let rb = S.ts.rb;
                    return Value::from(format!(
                        "Straßenbau: Setze noch {} kostenlose{} Weg{}.",
                        rb,
                        if rb > 1 { "" } else { "n" },
                        if rb > 1 { "e" } else { "" }
                    ));
                }
                return Value::from(format!("{} baut mit Straßenbau.", tn));
            }
            "sbp" => {
                if me {
                    "Sonderbauphase: Du darfst bauen oder kaufen. Klicke „Fertig“, wenn du nichts mehr tun willst."
                } else {
                    return Value::from(format!("Sonderbauphase: {} baut.", tn));
                }
            }
            "main" => {
                if me { "Handeln, bauen oder Zug beenden." } else { return Value::from(format!("{} handelt und baut.", tn)) }
            }
            _ => return Value::Null,
        };
        Value::from(txt)
    }

    pub fn update_awards_view(&mut self) -> Vec<u32> {
        let key = format!("{}:{}", self.S.v, self.S.edges.len());
        if self.len_key.as_deref() != Some(key.as_str()) {
            let lens = self.S.players.iter().map(|p| self.route_len(p.id)).collect();
            self.lens = Some(lens);
            self.len_key = Some(key);
        }
        self.lens.clone().unwrap_or_default()
    }

    pub fn view(&mut self, pid: Option<usize>) -> Value {
        let step = self.step_of();
        let lens = if self.S.phase == "main" || self.S.phase == "ended" {
            self.update_awards_view()
        } else {
            Vec::new()
        };
        let legal = self.legal(pid);
        let S = &self.S;
        let turn: Option<usize> = S.sbp.as_ref().and_then(|s| s.pid).or(Some(S.turn));
        let players: Vec<Value> = S
            .players
            .iter()
            .map(|p| {
                let mut o = Map::new();
                o.insert("id".into(), json!(p.id));
                o.insert("name".into(), json!(p.name));
                o.insert("color".into(), json!(p.color));
                o.insert("avatar".into(), json!(p.avatar));
                o.insert("bot".into(), json!(p.bot));
                o.insert("seat".into(), json!(p.seat));
                o.insert("tableGuest".into(), json!(p.is_table_guest()));
                o.insert("amTisch".into(), json!(p.am_tisch));
                o.insert("connected".into(), json!(p.connected));
                o.insert("auto".into(), json!(p.auto));
                o.insert("gone".into(), json!(p.left));
                o.insert(
                    "vp".into(),
                    json!(if S.phase == "lobby" {
                        0
                    } else {
                        self.vp(p.id) + if S.phase == "ended" { self.hidden_vp(p.id) as i64 } else { 0 }
                    }),
                );
                o.insert("svp".into(), json!(p.svp));
                o.insert(
                    "vpParts".into(),
                    if S.phase == "lobby" {
                        Value::Null
                    } else {
                        self.vp_parts(p.id, S.phase == "ended" || pid == Some(p.id))
                    },
                );
                o.insert("resCount".into(), json!(self.hand_size(p.id)));
                o.insert("devCount".into(), json!(p.dev.len()));
                o.insert("knightsPlayed".into(), json!(p.knights));
                o.insert("longestRoute".into(), json!(lens.get(p.id).copied().unwrap_or(0)));
                o.insert("hasLongest".into(), json!(S.longest == Some(p.id)));
                o.insert("hasLargest".into(), json!(S.largest == Some(p.id)));
                let left = if S.phase == "lobby" {
                    let f = |l: Option<u32>| l.map(|x| x as i64).unwrap_or(UNLIMITED);
                    json!({
                        "road": f(self.lim("road")),
                        "ship": f(self.lim("ship")),
                        "settlement": f(self.lim("settlement")),
                        "city": f(self.lim("city")),
                    })
                } else {
                    let l = self.left(p.id);
                    json!({"road": l.road, "ship": l.ship, "settlement": l.settlement, "city": l.city})
                };
                o.insert("left".into(), left);
                if let Some(n) = S.pend.discard.get(&p.id) {
                    o.insert("discarding".into(), json!(n));
                }
                if let Some(n) = S.pend.gold.get(&p.id) {
                    o.insert("pickingGold".into(), json!(n));
                }
                Value::Object(o)
            })
            .collect();
        let hexes: Vec<Value> = S
            .hexes
            .iter()
            .map(|(k, h)| json!({"k": k, "t": h.t, "n": h.n}))
            .collect();
        let harbors: Vec<Value> = S
            .harbors
            .iter()
            .map(|(e, h)| {
                let hs = geom::edge_hexes(e);
                let land = if self.is_land_hex(&hs[0]) { hs[0].clone() } else { hs[1].clone() };
                let sea = if land == hs[0] { hs[1].clone() } else { hs[0].clone() };
                json!({"e": e, "kind": h.kind, "land": land, "sea": sea})
            })
            .collect();
        let me = match pid {
            Some(p) if p < S.players.len() => {
                let pl = &S.players[p];
                let dev: Vec<Value> = pl
                    .dev
                    .iter()
                    .map(|d| {
                        json!({
                            "id": d.id,
                            "type": d.kind,
                            "playable": d.kind != "siegpunkt" && d.kind != "stadtmauer"
                                && d.bought < S.turn_no && !S.ts.dev_played
                                && S.phase == "main" && S.sbp.is_none() && Some(p) == Some(S.turn),
                            "fresh": d.bought >= S.turn_no,
                        })
                    })
                    .collect();
                json!({
                    "hand": &pl.hand,
                    "dev": dev,
                    "hiddenVp": self.hidden_vp(p),
                    "handLimit": self.hand_limit(p),
                })
            }
            _ => json!({"hand": {}, "dev": [], "hiddenVp": 0}),
        };
        let mut afford = json!({"road": false, "ship": false, "settlement": false, "city": false, "dev": false});
        if let Some(p) = pid {
            if p < S.players.len() && (S.phase == "main" || S.phase == "ended") {
                let l = self.left(p);
                afford = json!({
                    "road": l.road > 0 && self.can_pay(p, &crate::game::cost_map("road")),
                    "ship": l.ship > 0 && self.can_pay(p, &crate::game::cost_map("ship")),
                    "settlement": l.settlement > 0 && self.can_pay(p, &crate::game::cost_map("settlement")),
                    "city": l.city > 0 && self.can_pay(p, &crate::game::cost_map("city")),
                    "dev": self.dev_left() > 0 && self.can_pay(p, &crate::game::cost_map("dev")),
                });
            }
        }
        let rates = match pid {
            Some(p) if p < S.players.len() => self.rates_for(p),
            _ => RES.iter().map(|r| (r.to_string(), self.S.settings.bank_rate)).collect(),
        };
        let trade = S.trade.as_ref().map(|t| {
            json!({"id": t.id, "from": t.from, "give": &t.give, "want": &t.want, "responses": &t.responses})
        });
        let order_rolls = S
            .setup
            .as_ref()
            .and_then(|s| s.ord.as_ref())
            .map(|o| json!(o.rolled))
            .unwrap_or(Value::Null);
        let mut bank_stock = Map::new();
        for r in RES {
            bank_stock.insert(
                r.to_string(),
                json!(self.stock(r).map(|x| x as i64).unwrap_or(UNLIMITED)),
            );
        }
        let mut o = Map::new();
        o.insert("v".into(), json!(S.v));
        o.insert("phase".into(), json!(&S.phase));
        o.insert("you".into(), json!(pid.map(|p| p as i64).unwrap_or(-1)));
        o.insert("host".into(), json!(S.host));
        o.insert("minPlayers".into(), json!(crate::game::MIN_P));
        o.insert("maxPlayers".into(), json!(crate::game::MAX_P));
        o.insert("winPoints".into(), json!(S.settings.win_points));
        o.insert("gameId".into(), json!(self.meta_id));
        o.insert("gameName".into(), json!(self.meta_name));
        o.insert("settings".into(), json!(&S.settings));
        o.insert("closed".into(), json!(S.closed));
        o.insert("endedBy".into(), json!(&S.ended_by));
        o.insert("stats".into(), self.stats_view());
        o.insert("players".into(), Value::Array(players));
        o.insert("order".into(), json!(&S.order));
        o.insert("turn".into(), json!(turn));
        o.insert("step".into(), json!(step));
        o.insert("dice".into(), S.dice.map(|(a, b)| json!([a, b])).unwrap_or(Value::Null));
        o.insert("diceSeq".into(), json!(S.dice_seq));
        o.insert("devShown".into(), json!(&S.dev_shown));
        o.insert("orderShown".into(), json!(&S.order_shown));
        o.insert("orderRolls".into(), order_rolls);
        o.insert("hexes".into(), Value::Array(hexes));
        o.insert("fog".into(), json!(crate::board::fog(S)));
        o.insert("harbors".into(), Value::Array(harbors));
        o.insert("verts".into(), json!(&S.verts));
        o.insert("edges".into(), json!(&S.edges));
        o.insert("robber".into(), json!(&S.robber));
        o.insert("pirate".into(), json!(&S.pirate));
        o.insert("me".into(), me);
        o.insert("afford".into(), afford);
        o.insert("legal".into(), legal);
        o.insert("rates".into(), json!(rates));
        o.insert("trade".into(), trade.unwrap_or(Value::Null));
        o.insert("prompt".into(), self.prompt(pid, &step));
        o.insert("pending".into(), json!(&S.pend));
        o.insert("log".into(), json!(&S.log));
        o.insert("chat".into(), json!(&S.chat));
        o.insert("winner".into(), json!(S.winner));
        o.insert("fx".into(), Value::Array(self.fx_for(pid)));
        o.insert("bank".into(), json!({"dev": self.dev_left(), "stock": Value::Object(bank_stock)}));
        o.insert("longestHolder".into(), json!(S.longest));
        o.insert("largestHolder".into(), json!(S.largest));
        o.insert("sbp".into(), json!(S.sbp.is_some()));
        Value::Object(o)
    }

    pub fn watch_view(&mut self) -> Value {
        let mut v = self.view(None);
        let obj = v.as_object_mut().unwrap();
        obj.insert("watch".into(), json!(true));
        obj.insert("host".into(), json!(-1));
        obj.insert("chat".into(), json!([]));
        // Plätze am Tisch: ohne feste Sitzordnung reihum im Uhrzeigersinn verteilen
        let ws: std::collections::HashMap<usize, Vec<&str>> = [
            (2, vec!["b", "t"]),
            (3, vec!["b", "tl", "tr"]),
            (4, vec!["b", "l", "t", "r"]),
            (5, vec!["b", "l", "tl", "tr", "r"]),
            (6, vec!["bl", "l", "tl", "tr", "r", "br"]),
        ]
        .into_iter()
        .collect();
        let mut ord: Vec<i64> = obj
            .get("order")
            .and_then(|o| o.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
            .unwrap_or_default();
        let players = obj.get("players").and_then(|p| p.as_array()).cloned().unwrap_or_default();
        let gone: Vec<i64> = players
            .iter()
            .filter(|p| p.get("gone").and_then(|g| g.as_bool()).unwrap_or(false))
            .filter_map(|p| p.get("id").and_then(|i| i.as_i64()))
            .collect();
        if ord.is_empty() {
            ord = players.iter().filter_map(|p| p.get("id").and_then(|i| i.as_i64())).collect();
        }
        ord.retain(|id| !gone.contains(id));
        let needs = ord.iter().any(|id| {
            players
                .get(*id as usize)
                .and_then(|p| p.get("seat"))
                .map(|s| s.is_null())
                .unwrap_or(false)
        });
        if !ord.is_empty() && needs {
            let key = ord.len().clamp(2, 6);
            let slots = &ws[&key];
            if let Some(arr) = obj.get_mut("players").and_then(|p| p.as_array_mut()) {
                for (i, id) in ord.iter().enumerate() {
                    if let Some(p) = arr.get_mut(*id as usize) {
                        if let Some(o) = p.as_object_mut() {
                            o.insert(
                                "seat".into(),
                                match slots.get(i) {
                                    Some(s) => json!(s),
                                    None => Value::Null,
                                },
                            );
                        }
                    }
                }
            }
        }
        v
    }
}

#[allow(dead_code)]
fn _state_check(_s: &State) {}
