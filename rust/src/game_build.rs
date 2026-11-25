// Bauen, Entwicklungskarten, Räuber/Pirat, Zugende, Sonderbau, Auto-Modus und Übernahme
// – Portierung von server/game.js und server/game_auto.js.
use indexmap::{IndexMap, IndexSet};
use serde_json::Value;

use crate::game::{cost_map, fmt_cards, Game, GameError};
use crate::geom;
use crate::model::*;
use crate::rules::{self, RES};

impl Game {
    pub fn build(&mut self, pid: usize, what: &str, where_: &str, free: bool) -> Result<(), GameError> {
        let cost = cost_map(what);
        let left = self.left(pid);
        if !free && !self.can_pay(pid, &cost) {
            return Err(GameError(format!("Dir fehlen Rohstoffe ({}).", fmt_cards(&cost))));
        }
        if what == "road" || what == "ship" {
            let mine = if what == "road" { left.road } else { left.ship };
            if mine <= 0 {
                return Err(GameError(format!(
                    "Du hast keine {} mehr.",
                    if what == "road" { "Straßen" } else { "Schiffe" }
                )));
            }
            let kind = if what == "road" { "r" } else { "s" };
            if self.S.edges.contains_key(where_) {
                return Err(GameError("Hier liegt schon ein Weg.".into()));
            }
            if !self.path_spots(pid, kind).contains(&where_.to_string()) {
                if kind == "s"
                    && self
                        .S
                        .pirate
                        .as_ref()
                        .map(|p| geom::edge_hexes(where_).contains(p))
                        .unwrap_or(false)
                {
                    return Err(GameError("Der Pirat blockiert diese Küste.".into()));
                }
                return Err(GameError(
                    if kind == "r" {
                        "Straßen müssen an Land liegen und an deine Straße/Siedlung anschließen."
                    } else {
                        "Schiffe müssen Meer berühren und an dein Schiff/deine Küstensiedlung anschließen."
                    }
                    .into(),
                ));
            }
            if !free {
                self.pay_bank(pid, &cost);
            }
            let turn_no = self.S.turn_no;
            self.S.edges.insert(
                where_.to_string(),
                Building { p: pid, k: kind.to_string(), t: Some(turn_no) },
            );
            self.bump(pid, "built", 1, Some(if kind == "r" { "road" } else { "ship" }));
            let name = self.name(pid);
            self.log(
                format!(
                    "{} baut {}{}.",
                    name,
                    if kind == "r" { "eine Straße" } else { "ein Schiff" },
                    if free { " (Straßenbau)" } else { "" }
                ),
                "build",
                Some(pid),
            );
            self.discover_around(pid, where_, true);
            self.update_awards(false);
            if free {
                self.S.ts.rb = self.S.ts.rb.saturating_sub(1);
                if self.S.ts.rb == 0 || !self.rb_possible(pid) {
                    self.end_road_building();
                }
            }
            return Ok(());
        }
        if what == "settlement" {
            if left.settlement <= 0 {
                return Err(GameError(
                    "Du hast keine Siedlungen mehr (baue eine zur Stadt aus, dann wird wieder eine frei).".into(),
                ));
            }
            if !self.settlement_spots(pid).contains(&where_.to_string()) {
                return Err(GameError(
                    "Siedlungen brauchen Anschluss an deinen Weg und zwei Wege Abstand zu jedem Gebäude.".into(),
                ));
            }
            self.pay_bank(pid, &cost);
            self.place_settlement(pid, where_, false);
            self.bump(pid, "built", 1, Some("settlement"));
            let name = self.name(pid);
            self.log(format!("{} baut eine Siedlung.", name), "build", Some(pid));
            self.update_awards(false);
            return Ok(());
        }
        if what == "city" {
            if left.city <= 0 {
                return Err(GameError("Du hast keine Städte mehr.".into()));
            }
            if !self.city_spots(pid).contains(&where_.to_string()) {
                return Err(GameError("Städte werden nur aus eigenen Siedlungen ausgebaut.".into()));
            }
            self.pay_bank(pid, &cost);
            if let Some(b) = self.S.verts.get_mut(where_) {
                b.k = "c".to_string();
            }
            self.bump(pid, "built", 1, Some("city"));
            let name = self.name(pid);
            self.log(format!("{} baut eine Stadt.", name), "build", Some(pid));
        }
        Ok(())
    }

    pub fn rb_possible(&mut self, pid: usize) -> bool {
        let left = self.left(pid);
        (self.path_spots(pid, "r").len() > 0 && left.road > 0)
            || (self.path_spots(pid, "s").len() > 0 && left.ship > 0)
    }

    pub fn end_road_building(&mut self) {
        self.S.ts.sub = None;
        self.S.ts.rb = 0;
    }

    pub fn move_ship(&mut self, pid: usize, from: &str, to: &str) -> Result<(), GameError> {
        if self.S.ts.moved_ship {
            return Err(GameError("Du hast in diesem Zug schon ein Schiff versetzt.".into()));
        }
        let (mv_from, mv_to) = self.ship_moves(pid);
        if !mv_from.iter().any(|x| x == from) {
            return Err(GameError(
                "Dieses Schiff kann nicht versetzt werden (es muss ein offenes Ende haben, darf nicht neu gebaut sein und der Pirat darf nicht daneben liegen).".into(),
            ));
        }
        if !mv_to.get(from).map(|v| v.iter().any(|x| x == to)).unwrap_or(false) {
            return Err(GameError("Dorthin kann das Schiff nicht fahren.".into()));
        }
        self.S.edges.shift_remove(from);
        let turn_no = self.S.turn_no;
        self.S.edges.insert(
            to.to_string(),
            Building { p: pid, k: "s".to_string(), t: Some(turn_no) },
        );
        self.S.ts.moved_ship = true;
        let name = self.name(pid);
        self.log(format!("{} versetzt ein Schiff.", name), "build", Some(pid));
        self.discover_around(pid, to, true);
        self.update_awards(false);
        Ok(())
    }

    pub fn buy_dev(&mut self, pid: usize) -> Result<(), GameError> {
        if self.dev_left() == 0 {
            return Err(GameError("Der Entwicklungskartenstapel ist leer.".into()));
        }
        let cost = cost_map("dev");
        if !self.can_pay(pid, &cost) {
            return Err(GameError(format!("Dir fehlen Rohstoffe ({}).", fmt_cards(&cost))));
        }
        self.pay_bank(pid, &cost);
        let kind = self.draw_dev();
        self.bump(pid, "built", 1, Some("dev"));
        self.S.seq += 1;
        let id = self.S.seq;
        let bought = self.S.turn_no;
        self.pl_mut(pid).dev.push(DevCard { id, kind, bought });
        let name = self.name(pid);
        self.log(format!("{} kauft eine Entwicklungskarte.", name), "build", Some(pid));
        Ok(())
    }

    pub fn play_dev(&mut self, pid: usize, kind: &str, a: &Value) -> Result<(), GameError> {
        if self.S.sbp.is_some() {
            return Err(GameError(
                "In der Sonderbauphase dürfen keine Entwicklungskarten gespielt werden.".into(),
            ));
        }
        if self.S.ts.dev_played {
            return Err(GameError("Du darfst nur eine Entwicklungskarte pro Zug ausspielen.".into()));
        }
        let pos = self
            .pl(pid)
            .dev
            .iter()
            .position(|d| d.kind == kind && d.bought < self.S.turn_no);
        let pos = match pos {
            Some(p) => p,
            None => {
                if self.pl(pid).dev.iter().any(|d| d.kind == kind) {
                    return Err(GameError(
                        "Diese Karte hast du in diesem Zug gekauft – sie ist erst im nächsten Zug spielbar.".into(),
                    ));
                }
                return Err(GameError(format!("Du besitzt keine Karte „{}“.", rules::dev_de(kind))));
            }
        };
        let a1 = a.get("a").and_then(|v| v.as_str()).unwrap_or("");
        let b1 = a.get("b").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "erfindung" {
            if !RES.contains(&a1) || !RES.contains(&b1) {
                return Err(GameError("Wähle zwei Rohstoffe.".into()));
            }
            let mut need2: IndexMap<String, u32> = IndexMap::new();
            *need2.entry(a1.to_string()).or_insert(0) += 1;
            *need2.entry(b1.to_string()).or_insert(0) += 1;
            for (r, n) in &need2 {
                if let Some(st) = self.stock(r) {
                    if *n > st {
                        return Err(GameError(format!(
                            "Die Bank hat nicht genug {}.",
                            rules::res_de(r)
                        )));
                    }
                }
            }
        }
        let res_arg = a.get("res").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "monopol" && !RES.contains(&res_arg) {
            return Err(GameError("Wähle einen Rohstoff.".into()));
        }
        self.pl_mut(pid).dev.remove(pos);
        self.S.ts.dev_played = true;
        self.S.trade = None;
        let shown_id = self.S.dev_shown.as_ref().map(|d| d.id).unwrap_or(0) + 1;
        self.S.dev_shown = Some(DevShown { id: shown_id, kind: kind.to_string(), by: pid });
        let pname = self.name(pid);
        if kind == "ritter" {
            self.pl_mut(pid).knights += 1;
            self.log(
                format!("{} spielt einen Ritter und versetzt Räuber oder Pirat.", pname),
                "steal",
                Some(pid),
            );
            self.S.ts.sub = Some("robber".to_string());
            self.update_awards(false);
        } else if kind == "strassenbau" {
            self.log(
                format!("{} spielt Straßenbau: zwei kostenlose Wege (Straßen und/oder Schiffe).", pname),
                "build",
                Some(pid),
            );
            self.S.ts.sub = Some("road_building".to_string());
            self.S.ts.rb = 2;
            if !self.rb_possible(pid) {
                self.end_road_building();
                self.log("Es gibt keinen freien Platz für Wege – Karte verfällt.", "info", None);
            }
        } else if kind == "erfindung" {
            let mut c = Hand::default();
            c.add(a1, 1);
            c.add(b1, 1);
            let mut cards = IndexMap::new();
            for r in RES {
                let n = c.get(r);
                if n > 0 {
                    cards.insert(r.to_string(), n);
                }
            }
            self.give(pid, &cards);
            self.fx("bank", &format!("p:{}", pid), &cards, true, "dev");
            self.log(
                format!(
                    "{} spielt Erfindung und nimmt {} und {} von der Bank.",
                    pname,
                    rules::res_de(a1),
                    rules::res_de(b1)
                ),
                "info",
                Some(pid),
            );
        } else if kind == "monopol" {
            let mut tot = 0u32;
            let n = self.S.players.len();
            for q in 0..n {
                if q == pid {
                    continue;
                }
                let have = self.pl(q).hand.get(res_arg);
                if have > 0 {
                    self.fx_single(&format!("p:{}", q), &format!("p:{}", pid), res_arg, have, true, "dev");
                }
                let pl = self.pl_mut(pid);
                pl.hand.add(res_arg, have as i64);
                self.pl_mut(q).hand.set(res_arg, 0);
                tot += have;
            }
            self.log(
                format!(
                    "{} spielt Monopol auf {} und erhält {} Karten.",
                    pname,
                    rules::res_de(res_arg),
                    tot
                ),
                "steal",
                Some(pid),
            );
        }
        Ok(())
    }

    pub fn move_robber(&mut self, pid: usize, hex: &str) -> Result<(), GameError> {
        if !self.S.hexes.contains_key(hex) || !self.is_land_hex(hex) {
            return Err(GameError("Der Räuber kann nur auf ein Landfeld gestellt werden.".into()));
        }
        if self.S.robber.as_deref() == Some(hex) {
            return Err(GameError("Der Räuber muss auf ein anderes Feld ziehen.".into()));
        }
        self.S.robber = Some(hex.to_string());
        self.bump(pid, "robberMoves", 1, None);
        let h = self.S.hexes.get(hex).cloned().unwrap();
        let name = self.name(pid);
        self.log(
            format!(
                "{} stellt den Räuber auf {}{}.",
                name,
                rules::terrain_de(&h.t),
                h.n.map(|n| format!(" {}", n)).unwrap_or_default()
            ),
            "steal",
            Some(pid),
        );
        let mut seen: IndexSet<usize> = IndexSet::new();
        for v in geom::hex_corners(hex) {
            if let Some(b) = self.S.verts.get(&v) {
                if b.p != pid && self.hand_size(b.p) > 0 {
                    seen.insert(b.p);
                }
            }
        }
        self.after_move(pid, seen.into_iter().collect());
        Ok(())
    }

    pub fn move_pirate(&mut self, pid: usize, hex: &str) -> Result<(), GameError> {
        if !self.S.hexes.contains_key(hex) || !self.is_sea_hex(hex) {
            return Err(GameError("Der Pirat kann nur auf ein Meerfeld gestellt werden.".into()));
        }
        if self.S.pirate.as_deref() == Some(hex) {
            return Err(GameError("Der Pirat muss auf ein anderes Feld ziehen.".into()));
        }
        self.S.pirate = Some(hex.to_string());
        let name = self.name(pid);
        self.log(
            format!("{} stellt den Piraten auf ein Meerfeld.", name),
            "steal",
            Some(pid),
        );
        let mut seen: IndexSet<usize> = IndexSet::new();
        for e in geom::hex_edges(hex) {
            if let Some(x) = self.S.edges.get(&e) {
                if x.k == "s" && x.p != pid && self.hand_size(x.p) > 0 {
                    seen.insert(x.p);
                }
            }
        }
        self.after_move(pid, seen.into_iter().collect());
        Ok(())
    }

    pub fn after_move(&mut self, pid: usize, victims: Vec<usize>) {
        self.S.ts.victims = victims.clone();
        if victims.is_empty() {
            self.S.ts.sub = None;
            self.log("Es gibt niemanden zum Bestehlen.", "info", None);
        } else if victims.len() == 1 {
            let v = victims[0];
            let _ = self.steal(pid, v);
        } else {
            self.S.ts.sub = Some("steal".to_string());
        }
    }

    pub fn steal(&mut self, pid: usize, target: usize) -> Result<(), GameError> {
        if !self.S.ts.victims.contains(&target) {
            return Err(GameError("Diesen Spieler kannst du nicht bestehlen.".into()));
        }
        let h = self.pl(target).hand.clone();
        let mut pool: Vec<String> = Vec::new();
        for r in RES {
            for _ in 0..h.get(r) {
                pool.push(r.to_string());
            }
        }
        if !pool.is_empty() {
            let r = pool[self.rbelow(pool.len())].clone();
            self.pl_mut(target).hand.add(&r, -1);
            self.pl_mut(pid).hand.add(&r, 1);
            self.fx_single(&format!("p:{}", target), &format!("p:{}", pid), &r, 1, false, "steal");
            self.bump(pid, "stolenBy", 1, None);
            self.bump(target, "stolenFrom", 1, None);
            let (a, b) = (self.name(pid), self.name(target));
            self.log(format!("{} stiehlt {} eine Karte.", a, b), "steal", Some(pid));
        }
        self.S.ts.sub = None;
        self.S.ts.victims = Vec::new();
        Ok(())
    }

    pub fn end_turn(&mut self, pid: usize) -> Result<(), GameError> {
        if !self.S.ts.rolled {
            return Err(GameError("Würfle zuerst, bevor du den Zug beendest.".into()));
        }
        self.S.trade = None;
        let len = self.S.order.len();
        let i = self.S.order.iter().position(|x| *x == pid).unwrap_or(0);
        let next = self.S.order[(i + 1) % len];
        if self.S.players.len() >= 5 {
            let mut queue = Vec::new();
            for k in 1..len {
                queue.push(self.S.order[(i + k) % len]);
            }
            self.S.sbp = Some(Sbp { queue, pid: None, after: next });
            self.log(
                "Sonderbauphase: Die anderen Spieler dürfen reihum bauen (kein Handel mit Spielern).",
                "sys",
                None,
            );
            self.sbp_next();
        } else {
            self.start_turn(next);
        }
        Ok(())
    }

    pub fn can_do_something(&mut self, pid: usize) -> bool {
        if self.pl(pid).auto {
            return false;
        }
        let h = self.pl(pid).hand.clone();
        let rates = self.rates_for(pid);
        let left = self.left(pid);
        let spots = [
            ("road", !self.path_spots(pid, "r").is_empty() && left.road > 0),
            ("ship", !self.path_spots(pid, "s").is_empty() && left.ship > 0),
            ("settlement", !self.settlement_spots(pid).is_empty() && left.settlement > 0),
            ("city", !self.city_spots(pid).is_empty() && left.city > 0),
            ("dev", self.dev_left() > 0),
        ];
        for (k, ok) in spots {
            if !ok {
                continue;
            }
            let cost = rules::cost(k);
            let mut deficit = 0i64;
            let mut spare = 0i64;
            for r in RES {
                let need = cost.get(r).copied().unwrap_or(0) as i64;
                let have = h.get(r) as i64;
                if have < need {
                    deficit += need - have;
                } else {
                    spare += (have - need) / rates[r].max(1) as i64;
                }
            }
            if spare >= deficit {
                return true;
            }
        }
        false
    }

    pub fn sbp_next(&mut self) {
        loop {
            let p = match self.S.sbp.as_mut().and_then(|s| {
                if s.queue.is_empty() {
                    None
                } else {
                    Some(s.queue.remove(0))
                }
            }) {
                Some(p) => p,
                None => break,
            };
            if self.can_do_something(p) {
                if let Some(sb) = self.S.sbp.as_mut() {
                    sb.pid = Some(p);
                }
                let name = self.name(p);
                self.log(format!("Sonderbauphase: {} darf bauen.", name), "sys", Some(p));
                return;
            }
        }
        let after = self.S.sbp.as_ref().map(|s| s.after).unwrap_or(0);
        self.S.sbp = None;
        self.start_turn(after);
    }

    // ---------- Auto-Modus ----------
    pub fn settle(&mut self) {
        for _ in 0..400 {
            if self.S.phase == "ended" || self.S.phase == "lobby" {
                return;
            }
            let mut acted = false;
            let discards: Vec<(usize, u32)> = self.S.pend.discard.iter().map(|(p, n)| (*p, *n)).collect();
            for (id, need) in discards {
                if self.pl(id).auto {
                    let cards = self.random_cards(id, need);
                    let obj: serde_json::Map<String, Value> = cards.into_iter().map(|(k, v)| (k, Value::from(v))).collect();
                    let _ = self.discard(id, &Value::Object(obj));
                    acted = true;
                }
            }
            let golds: Vec<(usize, u32)> = self.S.pend.gold.iter().map(|(p, n)| (*p, *n)).collect();
            for (id, _) in golds {
                if self.pl(id).auto {
                    self.auto_gold(id);
                    acted = true;
                }
            }
            if self.S.phase == "setup" {
                self.setup_advance_if_ready();
                if self.S.phase == "setup" && self.no_pending() && self.pl(self.S.turn).auto {
                    self.auto_setup(self.S.turn);
                    acted = true;
                }
                if acted {
                    continue;
                }
                return;
            }
            if acted {
                self.S.v += 1;
                continue;
            }
            if !self.no_pending() {
                return;
            }
            let pid = self.S.sbp.as_ref().and_then(|s| s.pid).unwrap_or(self.S.turn);
            let pl_auto = self.pl(pid).auto;
            if self.S.sbp.is_some() {
                if pl_auto {
                    self.sbp_next();
                    self.S.v += 1;
                    continue;
                }
                return;
            }
            let rolled = self.S.ts.rolled;
            let sub = self.S.ts.sub.clone();
            if !rolled && sub.is_none() && (self.S.settings.dice == "auto" || pl_auto) {
                let _ = self.roll(pid);
                self.S.v += 1;
                continue;
            }
            if sub.as_deref() == Some("robber") && (self.S.settings.robber == "auto" || pl_auto) {
                self.auto_robber(pid, pl_auto);
                self.S.v += 1;
                continue;
            }
            if sub.as_deref() == Some("steal") && (self.S.settings.robber == "auto" || pl_auto) {
                let victims = self.S.ts.victims.clone();
                if !victims.is_empty() {
                    let v = victims[self.rbelow(victims.len())];
                    let _ = self.steal(pid, v);
                }
                self.S.v += 1;
                continue;
            }
            if pl_auto && rolled && sub.is_none() {
                let _ = self.end_turn(pid);
                self.S.v += 1;
                if self.S.phase == "main" {
                    self.check_win();
                }
                continue;
            }
            return;
        }
    }

    pub fn random_cards(&self, pid: usize, n: u32) -> IndexMap<String, u32> {
        let h = self.pl(pid).hand.clone();
        let mut pool: Vec<String> = Vec::new();
        for r in RES {
            for _ in 0..h.get(r) {
                pool.push(r.to_string());
            }
        }
        let mut out: IndexMap<String, u32> = IndexMap::new();
        for _ in 0..n {
            if pool.is_empty() {
                break;
            }
            let r = pool.remove(self.rbelow(pool.len()));
            *out.entry(r).or_insert(0) += 1;
        }
        out
    }

    pub fn auto_gold(&mut self, pid: usize) {
        let need = match self.S.pend.gold.get(&pid).copied() {
            Some(n) => n,
            None => return,
        };
        let mut c: IndexMap<String, u32> = IndexMap::new();
        let mut n = 0;
        let mut guard = 0;
        while n < need && guard < 200 {
            guard += 1;
            let r = RES[self.rbelow(5)];
            let have = c.get(r).copied().unwrap_or(0);
            let stock_ok = match self.stock(r) {
                Some(s) => have < s,
                None => true,
            };
            if stock_ok {
                *c.entry(r.to_string()).or_insert(0) += 1;
                n += 1;
            } else if RES.iter().all(|x| {
                let have = c.get(*x).copied().unwrap_or(0);
                match self.stock(x) {
                    Some(s) => have >= s,
                    None => false,
                }
            }) {
                break;
            }
        }
        if n < need {
            self.S.pend.gold.remove(&pid);
            return;
        }
        let mut obj = serde_json::Map::new();
        for (k, v) in c {
            obj.insert(k, Value::from(v));
        }
        let _ = self.gold_pick(pid, &Value::Object(obj));
    }

    pub fn auto_robber(&mut self, pid: usize, randomly: bool) {
        let keys: Vec<String> = self.S.hexes.keys().cloned().collect();
        let mut best: Option<String> = None;
        let mut best_score = -1e9f64;
        for k in keys {
            if !self.is_land_hex(&k) || self.S.robber.as_deref() == Some(k.as_str()) {
                continue;
            }
            let mut score = self.r();
            if !randomly {
                let h = self.S.hexes.get(&k).cloned().unwrap();
                let n = h.n.unwrap_or(7);
                let pips = 6 - (7i32 - n as i32).abs();
                for v in geom::hex_corners(&k) {
                    if let Some(b) = self.S.verts.get(&v).cloned() {
                        let hs = self.hand_size(b.p) > 0;
                        score += (if b.p == pid { -3.0 } else { 1.0 + if hs { 0.5 } else { 0.0 } })
                            * (if b.k == "c" { 2.0 } else { 1.0 })
                            * (0.5 + pips as f64 / 3.0);
                    }
                }
            }
            if score > best_score {
                best_score = score;
                best = Some(k);
            }
        }
        if let Some(b) = best {
            let _ = self.move_robber(pid, &b);
        }
    }

    pub fn auto_setup(&mut self, pid: usize) {
        let stage = match self.S.setup.as_ref() {
            Some(s) => s.stage.clone(),
            None => return,
        };
        if stage == "seat" {
            let seats = ["bl", "b", "br", "tl", "t", "tr", "l", "r"];
            let free = seats
                .iter()
                .find(|x| !self.S.players.iter().any(|p| p.seat.as_deref() == Some(**x)))
                .map(|x| x.to_string())
                .unwrap_or_default();
            let a: Value = serde_json::json!({"type": "place_seat", "seat": free});
            let _ = self.setup_act(pid, &a);
            return;
        }
        if stage == "order" {
            let a: Value = serde_json::json!({"type": "roll"});
            let _ = self.setup_act(pid, &a);
            return;
        }
        if stage == "settlement" {
            let spots = self.settlement_spots(pid);
            if spots.is_empty() {
                return;
            }
            let v = spots[self.rbelow(spots.len())].clone();
            let a: Value = serde_json::json!({"type": "place_settlement", "v": v});
            let _ = self.setup_act(pid, &a);
        } else {
            let mut opts: Vec<(String, String)> = Vec::new();
            for e in self.setup_path_spots(pid, "r") {
                opts.push(("place_road".to_string(), e));
            }
            for e in self.setup_path_spots(pid, "s") {
                opts.push(("place_ship".to_string(), e));
            }
            if opts.is_empty() {
                return;
            }
            let (t, e) = opts[self.rbelow(opts.len())].clone();
            let a: Value = serde_json::json!({"type": t, "e": e});
            let _ = self.setup_act(pid, &a);
        }
    }

    /// Verlassene Spieler: komplette Infrastruktur verschwindet.
    pub fn vanish(&mut self, pid: usize) {
        let edges: Vec<String> = self.S.edges.iter().filter(|(_, x)| x.p == pid).map(|(e, _)| e.clone()).collect();
        for e in edges {
            self.S.edges.shift_remove(&e);
        }
        let verts: Vec<String> = self.S.verts.iter().filter(|(_, x)| x.p == pid).map(|(v, _)| v.clone()).collect();
        for v in verts {
            self.S.verts.shift_remove(&v);
        }
        let name = self.name(pid);
        {
            let p = self.pl_mut(pid);
            p.hand = Hand::default();
            p.dev = Vec::new();
            p.vanished = true;
            p.svp = 0;
            p.knights = 0;
        }
        self.log(
            format!("Die Siedlungen, Straßen und Schiffe von {} sind verschwunden.", name),
            "award",
            Some(pid),
        );
        self.update_awards(false);
    }

    /// Übernehmbare Infrastruktur verlassener Spieler: muss an eigene Teile angrenzen.
    pub fn takeover_spots(&self, pid: usize) -> (Vec<String>, Vec<String>) {
        let mut out_e: Vec<String> = Vec::new();
        let mut out_v: Vec<String> = Vec::new();
        if self.S.settings.leaver != "uebernahme" {
            return (out_e, out_v);
        }
        let gone: IndexSet<usize> = self
            .S
            .players
            .iter()
            .filter(|q| q.left && !q.vanished)
            .map(|q| q.id)
            .collect();
        if gone.is_empty() {
            return (out_e, out_v);
        }
        let mut anchors: IndexSet<String> = IndexSet::new();
        for (v, b) in &self.S.verts {
            if b.p == pid {
                anchors.insert(v.clone());
            }
        }
        for (e, b) in &self.S.edges {
            if b.p == pid {
                for v in geom::edge_verts(e) {
                    anchors.insert(v);
                }
            }
        }
        let left = self.left(pid);
        for (e, x) in &self.S.edges {
            if !gone.contains(&x.p) {
                continue;
            }
            let lim = if x.k == "r" { left.road } else { left.ship };
            if lim <= 0 {
                continue;
            }
            if geom::edge_verts(e).iter().any(|v| anchors.contains(v)) {
                out_e.push(e.clone());
            }
        }
        for (v, b) in &self.S.verts {
            if !gone.contains(&b.p) {
                continue;
            }
            let lim = if b.k == "c" { left.city } else { left.settlement };
            if lim <= 0 {
                continue;
            }
            if anchors.contains(v) {
                out_v.push(v.clone());
            }
        }
        (out_e, out_v)
    }

    pub fn take_over(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        if self.S.ts.moved_ship {
            return Err(GameError(
                "Du hast in diesem Zug schon ein Schiff versetzt oder etwas übernommen.".into(),
            ));
        }
        let (edges, verts) = self.takeover_spots(pid);
        let kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let key = a.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if kind == "edge" {
            if !edges.contains(&key) {
                return Err(GameError(
                    "Diesen Weg kannst du nicht übernehmen (er muss an deine Infrastruktur grenzen und einem Verlassenen gehören).".into(),
                ));
            }
            let turn_no = self.S.turn_no;
            let from_pid = self.S.edges[&key].p;
            let from = self.name(from_pid);
            let k = {
                let x = self.S.edges.get_mut(&key).unwrap();
                x.p = pid;
                x.t = Some(turn_no);
                x.k.clone()
            };
            let name = self.name(pid);
            self.log(
                format!(
                    "{} übernimmt {} von {}.",
                    name,
                    if k == "r" { "eine Straße" } else { "ein Schiff" },
                    from
                ),
                "build",
                Some(pid),
            );
        } else if kind == "vert" {
            if !verts.contains(&key) {
                return Err(GameError(
                    "Dieses Gebäude kannst du nicht übernehmen (es muss an deine Infrastruktur grenzen und einem Verlassenen gehören).".into(),
                ));
            }
            let from_pid = self.S.verts[&key].p;
            let from = self.name(from_pid);
            let k = {
                let b = self.S.verts.get_mut(&key).unwrap();
                b.p = pid;
                b.k.clone()
            };
            let isl = self.island_at(&key);
            for h in isl {
                self.pl_mut(pid).claimed.insert(h, 1);
            }
            let name = self.name(pid);
            self.log(
                format!(
                    "{} übernimmt {} von {}.",
                    name,
                    if k == "c" { "eine Stadt" } else { "eine Siedlung" },
                    from
                ),
                "build",
                Some(pid),
            );
        } else {
            return Err(GameError("Unbekannte Übernahme.".into()));
        }
        self.S.ts.moved_ship = true;
        self.update_awards(false);
        Ok(())
    }
}
