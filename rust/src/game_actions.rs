// Aktionen und Zugablauf – Portierung von server/game.js (act, roll, produce, setup).
use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde_json::Value;

use crate::game::{clean_cards, fmt_cards, truthy, Game, GameError};
use crate::geom;
use crate::model::*;
use crate::rules::{self, terrain_res, RES};

fn astr<'a>(a: &'a Value, k: &str) -> Option<&'a str> {
    a.get(k).and_then(|v| v.as_str())
}

#[derive(Clone)]
struct Entry {
    res: Option<String>,
    amt: u32,
    hex: Option<String>,
    desc: Option<String>,
    label: Option<String>,
}

impl Game {
    pub fn act(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        let t = match a.get("type").and_then(|v| v.as_str()) {
            Some(t) => t.to_string(),
            None => return Err(GameError("Unbekannte Aktion.".into())),
        };
        match t.as_str() {
            "chat" => {
                let text = a
                    .get("text")
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        Value::Null => String::new(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                self.chat(pid, &text);
                return Ok(());
            }
            "start" => return self.start(pid),
            "new_game" => return self.new_game(pid),
            "resume_game" => return self.resume_game(pid, a.get("winPoints")),
            "set_settings" => return self.set_settings(pid, a.get("settings").unwrap_or(&Value::Null)),
            "rename" => return self.rename_game(pid, astr(a, "name").unwrap_or("")),
            "regen_board" => {
                self.host_only(pid, "das Spielfeld neu würfeln")?;
                self.regen();
                self.S.v += 1;
                return Ok(());
            }
            "close_seats" => {
                self.host_only(pid, "die Plätze schließen")?;
                self.S.closed = a.get("closed").map(truthy).unwrap_or(false);
                let text = if self.S.closed {
                    "Die Plätze sind besetzt – niemand kann mehr beitreten."
                } else {
                    "Die Plätze sind wieder offen."
                };
                self.log(text, "sys", None);
                self.S.v += 1;
                return Ok(());
            }
            "add_bot" => return self.add_bot(pid, astr(a, "kind")),
            "add_table_player" => return self.add_table_player(pid, a),
            "kick" => {
                let target = match a.get("pid").and_then(|v| v.as_u64()) {
                    Some(x) => x as usize,
                    None => usize::MAX,
                };
                self.last_kicked = self.kick(pid, target)?;
                return Ok(());
            }
            "end_game" => return self.end_game(pid),
            _ => {}
        }
        if self.S.phase == "lobby" {
            return Err(GameError("Das Spiel hat noch nicht begonnen.".into()));
        }
        if self.S.phase == "ended" {
            return Err(GameError("Das Spiel ist beendet.".into()));
        }
        if t == "discard" {
            self.discard(pid, a.get("cards").unwrap_or(&Value::Null))?;
        } else if t == "gold_pick" {
            self.gold_pick(pid, a.get("cards").unwrap_or(&Value::Null))?;
        } else if self.S.phase == "setup" {
            self.setup_act(pid, a)?;
        } else {
            self.main_act(pid, a)?;
        }
        self.S.v += 1;
        self.after_action();
        Ok(())
    }

    pub fn after_action(&mut self) {
        if let Some(tr) = self.S.trade.clone() {
            if !self.is_table_player(tr.from) && !self.can_pay(tr.from, &tr.give) {
                self.S.trade = None;
                self.log(
                    "Das Angebot wurde automatisch zurückgezogen (Karten nicht mehr vorhanden).",
                    "trade",
                    None,
                );
            }
        }
        if self.S.phase == "main" {
            self.check_win();
        }
        self.settle();
    }

    pub fn chat(&mut self, pid: usize, text: &str) {
        let t: String = text.trim().chars().take(200).collect();
        if t.is_empty() {
            return;
        }
        self.S.seq += 1;
        let id = self.S.seq;
        self.S.chat.push(ChatEntry { id, p: pid, text: t });
        if self.S.chat.len() > 60 {
            self.S.chat.remove(0);
        }
        self.S.v += 1;
    }

    pub fn no_pending(&self) -> bool {
        self.S.pend.discard.is_empty() && self.S.pend.gold.is_empty()
    }

    pub fn discard(&mut self, pid: usize, cards: &Value) -> Result<(), GameError> {
        let need = match self.S.pend.discard.get(&pid).copied() {
            Some(n) if n > 0 => n,
            _ => return Err(GameError("Du musst gerade nichts abwerfen.".into())),
        };
        let c = clean_cards(cards)?;
        if hand_sum_map(&c) != need {
            return Err(GameError(format!("Bitte genau {} Karten abwerfen.", need)));
        }
        if !self.can_pay(pid, &c) {
            return Err(GameError("Du besitzt diese Karten nicht.".into()));
        }
        self.pay(pid, &c);
        self.fx(&format!("p:{}", pid), "bank", &c, false, "discard");
        self.S.pend.discard.remove(&pid);
        self.bump(pid, "discarded", need, None);
        let name = self.name(pid);
        self.log(format!("{} wirft {} Karten ab.", name, need), "steal", Some(pid));
        Ok(())
    }

    pub fn gold_pick(&mut self, pid: usize, cards: &Value) -> Result<(), GameError> {
        let mut need = match self.S.pend.gold.get(&pid).copied() {
            Some(n) if n > 0 => n,
            _ => return Err(GameError("Du hast gerade keine Gold-Wahl.".into())),
        };
        let total: u32 = RES
            .iter()
            .map(|r| match self.stock(r) {
                Some(s) => s.min(99),
                None => 99,
            })
            .sum();
        if total < need {
            need = total;
        }
        let c = clean_cards(cards)?;
        if hand_sum_map(&c) != need {
            if need == 0 {
                return Err(GameError("Die Bank hat keine Rohstoffe mehr.".into()));
            }
            return Err(GameError(format!(
                "Bitte genau {} Rohstoff{} wählen.",
                need,
                if need > 1 { "e" } else { "" }
            )));
        }
        for r in RES {
            let x = c.get(r).copied().unwrap_or(0);
            if x > 0 {
                let st = match self.stock(r) {
                    Some(s) => s as i64,
                    None => i64::MAX,
                };
                if x as i64 > st {
                    return Err(GameError(format!(
                        "Die Bank hat nur noch {}× {}.",
                        st,
                        rules::res_de(r)
                    )));
                }
            }
        }
        self.give(pid, &c);
        self.fx("bank", &format!("p:{}", pid), &c, true, "gold");
        self.S.pend.gold.remove(&pid);
        let name = self.name(pid);
        self.log(format!("{} wählt für Gold: {}.", name, fmt_cards(&c)), "info", Some(pid));
        if self.S.phase == "setup" {
            self.setup_advance_if_ready();
        }
        Ok(())
    }

    pub fn setup_act(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        let stage = match self.S.setup.as_ref() {
            Some(s) => s.stage.clone(),
            None => String::new(),
        };
        if stage == "seat" {
            if astr(a, "type") != Some("place_seat") {
                return Err(GameError("Zuerst wählt jeder Spieler seinen Platz am Tisch.".into()));
            }
            return self.place_seat(pid, a);
        }
        if stage == "order" {
            if pid != self.S.turn {
                return Err(GameError(format!(
                    "{} würfelt gerade um die Reihenfolge.",
                    self.name(self.S.turn)
                )));
            }
            if astr(a, "type") != Some("roll") {
                return Err(GameError("Zuerst wird die Reihenfolge ausgewürfelt.".into()));
            }
            return self.order_roll(pid);
        }
        if !self.no_pending() {
            return Err(GameError("Zuerst müssen alle ihre Goldwahl treffen.".into()));
        }
        if pid != self.S.turn {
            return Err(GameError(format!(
                "{} ist beim Aufbau an der Reihe.",
                self.name(self.S.turn)
            )));
        }
        if stage == "settlement" {
            if astr(a, "type") != Some("place_settlement") {
                return Err(GameError("Setze zuerst eine Siedlung.".into()));
            }
            let v = match astr(a, "v") {
                Some(v) => v.to_string(),
                None => String::new(),
            };
            let spots = self.settlement_spots(pid);
            if !spots.contains(&v) {
                return Err(GameError(format!(
                    "Hier darf keine Siedlung stehen (Abstandsregel: mindestens zwei Wege Abstand; Aufbau nur auf der Startinsel{}).",
                    if self.S.settings.gold_start { "" } else { " und nicht an einem Goldfluss" }
                )));
            }
            self.place_settlement(pid, &v, true);
            let second;
            {
                let su = self.S.setup.as_mut().unwrap();
                su.last = Some(v.clone());
                su.stage = "road".to_string();
                second = su.i >= self.S.order.len();
            }
            let name = self.name(pid);
            self.log(format!("{} setzt eine Siedlung.", name), "build", Some(pid));
            if second {
                let mut got: IndexMap<String, u32> = IndexMap::new();
                let mut gold = 0u32;
                let mut parts: Vec<String> = Vec::new();
                for h in geom::vert_hexes(&v) {
                    let hx = match self.S.hexes.get(&h) {
                        Some(x) => x.clone(),
                        None => continue,
                    };
                    if hx.t == "gold" {
                        gold += 1;
                    } else if let Some(r) = terrain_res(&hx.t) {
                        *got.entry(r.to_string()).or_insert(0) += 1;
                        parts.push(format!("{} ({})", rules::res_de(r), rules::terrain_de(&hx.t)));
                    }
                }
                let mut out = self.bank_give(pid, &got);
                for h in geom::vert_hexes(&v) {
                    let rs = self
                        .S
                        .hexes
                        .get(&h)
                        .and_then(|x| terrain_res(&x.t));
                    if let Some(rs) = rs {
                        if out.get(rs).copied().unwrap_or(0) > 0 {
                            *out.get_mut(rs).unwrap() -= 1;
                            self.fx_single(&format!("h:{}", h), &format!("p:{}", pid), rs, 1, true, "setup");
                        }
                    }
                }
                if gold > 0 {
                    self.S.pend.gold.insert(pid, gold);
                }
                if !parts.is_empty() || gold > 0 {
                    let mut text = format!("Startrohstoffe für {}: {}", self.name(pid), parts.join(", "));
                    if gold > 0 {
                        if !parts.is_empty() {
                            text.push_str(" und ");
                        }
                        text.push_str(&format!("{}× freie Wahl (Gold)", gold));
                    }
                    self.log(format!("{}.", text), "info", Some(pid));
                }
            }
            return Ok(());
        }
        // Straße oder Schiff direkt an der neuen Siedlung
        let t = astr(a, "type");
        if t != Some("place_road") && t != Some("place_ship") {
            return Err(GameError(
                "Setze jetzt eine Straße oder ein Schiff an deine neue Siedlung.".into(),
            ));
        }
        let kind = if t == Some("place_road") { "r" } else { "s" };
        let e = astr(a, "e").unwrap_or("").to_string();
        if !self.setup_path_spots(pid, kind).contains(&e) {
            return Err(GameError(
                if kind == "r" {
                    "Die Straße muss an die neue Siedlung angrenzen und an Land liegen."
                } else {
                    "Das Schiff muss an die neue Siedlung angrenzen und Meer berühren."
                }
                .into(),
            ));
        }
        self.S.edges.insert(
            e.clone(),
            Building { p: pid, k: kind.to_string(), t: Some(0) },
        );
        let name = self.name(pid);
        self.log(
            format!("{} legt {}.", name, if kind == "r" { "eine Straße" } else { "ein Schiff" }),
            "build",
            Some(pid),
        );
        self.discover_around(pid, &e, false);
        self.update_awards(true);
        self.S.setup.as_mut().unwrap().stage = "done".to_string();
        self.setup_advance_if_ready();
        Ok(())
    }

    pub fn setup_advance_if_ready(&mut self) {
        let (stage, i, seq_len) = match self.S.setup.as_ref() {
            Some(su) => (
                su.stage.clone(),
                su.i,
                su.seq.as_ref().map(|x| x.len()).unwrap_or(0),
            ),
            None => return,
        };
        if stage != "done" || !self.no_pending() {
            return;
        }
        let i = i + 1;
        if let Some(su) = self.S.setup.as_mut() {
            su.i = i;
        }
        if i >= seq_len {
            self.S.phase = "main".to_string();
            self.S.setup = None;
            let first = self.S.order.first().copied().unwrap_or(0);
            self.start_turn(first);
            self.log("Der Aufbau ist beendet – die Hauptphase beginnt!", "sys", None);
            return;
        }
        let next = self
            .S
            .setup
            .as_ref()
            .and_then(|s| s.seq.as_ref())
            .and_then(|s| s.get(i))
            .copied()
            .unwrap_or(0);
        let su = self.S.setup.as_mut().unwrap();
        su.stage = "settlement".to_string();
        su.last = None;
        self.S.turn = next;
    }

    pub fn start_turn(&mut self, pid: usize) {
        self.S.turn = pid;
        self.S.turn_no += 1;
        self.S.ts = TurnState::default();
        self.S.trade = None;
        self.S.sbp = None;
        self.S.dice = None;
        if self.S.stats.is_some() && Some(&pid) == self.S.order.first() {
            let vp: Vec<u32> = self.S.players.iter().map(|q| self.vp(q.id) as u32).collect();
            if let Some(st) = self.S.stats.as_mut() {
                let round = (st.history.len() + 1) as u32;
                st.history.push(HistoryEntry { round, vp, end: None });
            }
        }
        if self.pl(pid).left && !self.pl(pid).vanished && self.S.settings.leaver == "verschwinden" {
            let pl = self.pl_mut(pid);
            pl.auto_turns += 1;
            if pl.auto_turns > self.S.settings.vanish_rounds {
                self.vanish(pid);
            }
        }
        let name = self.name(pid);
        self.log(format!("{} ist an der Reihe.", name), "sys", Some(pid));
    }

    pub fn main_act(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        let t = astr(a, "type").unwrap_or("");
        // Handelsantworten hängen nicht am Zug (Gegenangebot, Annehmen, Ablehnen).
        if t == "trade_respond" {
            return self.trade_respond(pid, a);
        }
        if !self.no_pending() {
            return Err(GameError(
                "Zuerst müssen alle Pflichten (Abwerfen/Goldwahl) erledigt sein.".into(),
            ));
        }
        // Spielerhandel: Jeder darf dem Spielenden ein Angebot machen (wie ein Gegenangebot);
        // nur der Spielende selbst muss dafür gewürfelt haben. Angebot und Abschluss gehen an alle.
        if t == "trade_offer" {
            if pid == self.S.turn {
                self.need_rolled()?;
            }
            return self.trade_offer(pid, a);
        }
        if t == "trade_confirm" {
            return self.trade_confirm(pid, a);
        }
        if t == "trade_cancel" {
            return self.trade_cancel(pid);
        }
        if let Some(sbp) = self.S.sbp.clone() {
            if pid != sbp.pid.unwrap_or(usize::MAX) {
                return Err(GameError(format!(
                    "{} baut gerade in der Sonderbauphase.",
                    self.name(sbp.pid.unwrap_or(0))
                )));
            }
            let ok = [
                "build_road", "build_ship", "build_settlement", "build_city", "buy_dev",
                "sbp_done",
            ];
            if !ok.contains(&t) {
                return Err(GameError(
                    "In der Sonderbauphase kannst du nur bauen oder Entwicklungskarten kaufen.".into(),
                ));
            }
            if t == "sbp_done" {
                self.sbp_next();
                return Ok(());
            }
        } else if pid != self.S.turn {
            return Err(GameError(format!("{} ist am Zug.", self.name(self.S.turn))));
        }
        if self.S.ts.sub.as_deref() == Some("robber") {
            if t == "move_robber" {
                return self.move_robber(pid, astr(a, "hex").unwrap_or(""));
            }
            if t == "move_pirate" {
                return self.move_pirate(pid, astr(a, "hex").unwrap_or(""));
            }
            return Err(GameError("Zuerst muss der Räuber oder der Pirat versetzt werden.".into()));
        }
        if self.S.ts.sub.as_deref() == Some("steal") {
            if t != "steal" {
                return Err(GameError("Wähle, wen du bestehlen möchtest.".into()));
            }
            let target = a.get("target").and_then(|v| v.as_u64()).unwrap_or(u64::MAX) as usize;
            return self.steal(pid, target);
        }
        if self.S.ts.sub.as_deref() == Some("road_building") {
            if t == "skip_roadbuilding" {
                self.end_road_building();
                return Ok(());
            }
            if t != "build_road" && t != "build_ship" {
                return Err(GameError("Setze deine beiden kostenlosen Wege oder überspringe.".into()));
            }
            let e = astr(a, "e").unwrap_or("");
            return self.build(pid, if t == "build_road" { "road" } else { "ship" }, e, true);
        }
        match t {
            "roll" => {
                if self.S.settings.dice == "auto" {
                    return Err(GameError("In diesem Spiel würfelt der Server automatisch.".into()));
                }
                self.roll(pid)
            }
            "build_road" => {
                self.need_rolled()?;
                self.build(pid, "road", astr(a, "e").unwrap_or(""), false)
            }
            "build_ship" => {
                self.need_rolled()?;
                self.build(pid, "ship", astr(a, "e").unwrap_or(""), false)
            }
            "build_settlement" => {
                self.need_rolled()?;
                self.build(pid, "settlement", astr(a, "v").unwrap_or(""), false)
            }
            "build_city" => {
                self.need_rolled()?;
                self.build(pid, "city", astr(a, "v").unwrap_or(""), false)
            }
            "move_ship" => {
                self.need_rolled()?;
                let from = astr(a, "from").unwrap_or("").to_string();
                let to = astr(a, "to").unwrap_or("").to_string();
                self.move_ship(pid, &from, &to)
            }
            "buy_dev" => {
                self.need_rolled()?;
                self.buy_dev(pid)
            }
            "play_knight" => self.play_dev(pid, "ritter", a),
            "play_roadbuilding" => self.play_dev(pid, "strassenbau", a),
            "play_yop" => self.play_dev(pid, "erfindung", a),
            "play_monopoly" => self.play_dev(pid, "monopol", a),
            "bank_trade" => {
                self.need_rolled()?;
                self.bank_trade(pid, a)
            }
            "take_over" => {
                self.need_rolled()?;
                self.take_over(pid, a)
            }
            "end_turn" => self.end_turn(pid),
            _ => Err(GameError("Unbekannte Aktion.".into())),
        }
    }

    pub fn need_rolled(&self) -> Result<(), GameError> {
        if !self.S.ts.rolled && self.S.sbp.is_none() {
            return Err(GameError("Würfle zuerst.".into()));
        }
        Ok(())
    }

    pub fn roll(&mut self, pid: usize) -> Result<(), GameError> {
        if self.S.ts.rolled {
            return Err(GameError("Du hast schon gewürfelt.".into()));
        }
        let a = 1 + self.rbelow(6) as u32;
        let b = 1 + self.rbelow(6) as u32;
        let n = a + b;
        self.S.dice = Some((a, b));
        self.S.dice_seq += 1;
        self.S.ts.rolled = true;
        self.S.trade = None;
        let name = self.name(pid);
        self.log(format!("{} würfelt {} ({}+{}).", name, n, a, b), "roll", Some(pid));
        if let Some(st) = self.S.stats.as_mut() {
            *st.rolls.entry(n).or_insert(0) += 1;
        }
        if n == 7 {
            self.bump(pid, "sevens", 1, None);
            let mut any = false;
            let lim = self.S.settings.hand_limit;
            let wall = if self.stadtmauer_count() > 0 {
                " (+1 je Stadtmauer)"
            } else {
                ""
            };
            let ids: Vec<usize> = self.S.players.iter().map(|p| p.id).collect();
            for id in ids {
                let sz = self.hand_size(id);
                let pl = self.hand_limit(id);
                if let Some(pl) = pl {
                    if sz > pl {
                        self.S.pend.discard.insert(id, sz / 2);
                        any = true;
                    }
                }
            }
            let who = if self.S.settings.robber == "auto" {
                "wird der Räuber automatisch versetzt"
            } else {
                "versetzt der Würfler Räuber oder Pirat"
            };
            let text = if any {
                format!(
                    "Eine 7! Wer mehr als {} Karten hat{}, wirft die Hälfte ab. Dann {}.",
                    lim.map(|x| x.to_string()).unwrap_or_else(|| "null".to_string()),
                    wall,
                    who
                )
            } else {
                let mut w: Vec<char> = who.chars().collect();
                if let Some(c) = w.first_mut() {
                    *c = c.to_uppercase().next().unwrap_or(*c);
                }
                format!("Eine 7! Niemand muss abwerfen. {}.", w.into_iter().collect::<String>())
            };
            self.log(text, "roll", None);
            self.S.ts.sub = Some("robber".to_string());
            return Ok(());
        }
        self.produce(n);
        Ok(())
    }

    pub fn stadtmauer_count(&self) -> u32 {
        // Standard-Stadtmauer ist 0; nur eine ausdrückliche Zahl zählt als Wand.
        match self.S.settings.limits.dev.get("stadtmauer") {
            Some(crate::settings::DevLimit::N(n)) => *n,
            _ => 0,
        }
    }

    pub fn produce(&mut self, n: u32) {
        let mut got: BTreeMap<usize, Hand> = BTreeMap::new();
        let mut entries: BTreeMap<usize, Vec<Entry>> = BTreeMap::new();
        let mut blocked: Option<String> = None;
        let keys: Vec<String> = self.S.hexes.keys().cloned().collect();
        for k in keys {
            let h = match self.S.hexes.get(&k) {
                Some(h) => h.clone(),
                None => continue,
            };
            if h.n != Some(n) {
                continue;
            }
            let is_gold = h.t == "gold";
            let res = terrain_res(&h.t).map(|x| x.to_string());
            if res.is_none() && !is_gold {
                continue;
            }
            for v in geom::hex_corners(&k) {
                let b = match self.S.verts.get(&v) {
                    Some(b) => b.clone(),
                    None => continue,
                };
                if self.S.robber.as_deref() == Some(k.as_str()) {
                    blocked = Some(k.clone());
                    continue;
                }
                let amt = if b.k == "c" { 2 } else { 1 };
                if is_gold {
                    *self.S.pend.gold.entry(b.p).or_insert(0) += amt;
                    entries.entry(b.p).or_default().push(Entry {
                        res: None,
                        amt,
                        hex: None,
                        desc: Some(format!("{}× freie Wahl ({} {})", amt, rules::terrain_de("gold"), n)),
                        label: None,
                    });
                } else {
                    let r = res.clone().unwrap();
                    got.entry(b.p).or_default().add(&r, amt as i64);
                    entries.entry(b.p).or_default().push(Entry {
                        res: Some(r.clone()),
                        amt,
                        hex: Some(k.clone()),
                        desc: None,
                        label: Some(format!(
                            "{} {}{}",
                            rules::terrain_de(&h.t),
                            n,
                            if b.k == "c" { ", Stadt" } else { "" }
                        )),
                    });
                }
            }
        }
        // Bank-Vorrat: reicht er nicht, bekommt ein einzelner Empfänger den Rest, bei mehreren niemand
        for r in RES {
            let holders: Vec<usize> = got
                .iter()
                .filter(|(_, h)| h.get(r) > 0)
                .map(|(p, _)| *p)
                .collect();
            let owed: u32 = holders.iter().map(|p| got[p].get(r)).sum();
            let st = self.stock(r);
            if let Some(st) = st {
                if owed > st {
                    if holders.len() == 1 {
                        got.get_mut(&holders[0]).unwrap().set(r, st);
                        self.log(format!("Die Bank hat nur noch {}× {}.", st, rules::res_de(r)), "info", None);
                    } else {
                        for p in &holders {
                            got.get_mut(p).unwrap().set(r, 0);
                        }
                        self.log(
                            format!(
                                "Die Bank hat nicht genug {} für alle ({} von {}): niemand erhält welches.",
                                rules::res_de(r),
                                st,
                                owed
                            ),
                            "info",
                            None,
                        );
                    }
                }
            }
        }
        let ids: Vec<usize> = entries.keys().copied().collect();
        for p in ids {
            let ents = entries.get(&p).cloned().unwrap_or_default();
            let mut left = got.get(&p).cloned().unwrap_or_default();
            let mut parts: Vec<String> = Vec::new();
            for e in ents {
                if e.res.is_none() {
                    parts.push(e.desc.unwrap_or_default());
                    continue;
                }
                let r = e.res.unwrap();
                let a = e.amt.min(left.get(&r));
                left.add(&r, -(a as i64));
                if a > 0 {
                    parts.push(format!(
                        "{}× {} ({})",
                        a,
                        rules::res_de(&r),
                        e.label.unwrap_or_default()
                    ));
                    self.fx_single(
                        &format!("h:{}", e.hex.unwrap_or_default()),
                        &format!("p:{}", p),
                        &r,
                        a,
                        true,
                        "roll",
                    );
                }
            }
            if let Some(g) = got.get(&p).cloned() {
                for r in RES {
                    self.pl_mut(p).hand.add(r, g.get(r) as i64);
                }
                for r in RES {
                    self.bump(p, "produced", g.get(r), Some(r));
                }
            }
            if !parts.is_empty() {
                let name = self.name(p);
                self.log(format!("{} erhält {}.", name, parts.join(", ")), "roll", Some(p));
            }
        }
        if entries.is_empty() && blocked.is_none() {
            self.log(format!("Niemand besitzt ein Feld mit der {}.", n), "info", None);
        }
        if let Some(b) = blocked {
            let t = self.S.hexes.get(&b).map(|h| h.t.clone()).unwrap_or_default();
            self.log(
                format!("Der Räuber blockiert {} {}: dort gibt es nichts.", rules::terrain_de(&t), n),
                "info",
                None,
            );
        }
    }

    pub fn hand_limit(&self, pid: usize) -> Option<u32> {
        let l = self.S.settings.hand_limit?;
        let walls = self.pl(pid).dev.iter().filter(|d| d.kind == "stadtmauer").count() as u32;
        Some(l + walls)
    }
}

fn hand_sum_map(c: &IndexMap<String, u32>) -> u32 {
    c.values().sum()
}
