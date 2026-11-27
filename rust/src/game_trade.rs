// Handel mit der Bank und zwischen Spielern – Portierung von server/game_trade.js.
use indexmap::IndexMap;
use serde_json::Value;

use crate::game::{clean_cards, fmt_cards, Game, GameError};
use crate::model::{Trade, TradeResponse};
use crate::rules::{self, RES};

fn sum_cards(c: &IndexMap<String, u32>) -> u32 {
    c.values().sum()
}

impl Game {
    pub fn bank_trade(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        let give = a.get("give").and_then(|v| v.as_str()).unwrap_or("");
        let get = a.get("get").and_then(|v| v.as_str()).unwrap_or("");
        if !RES.contains(&give) || !RES.contains(&get) {
            return Err(GameError("Wähle zwei Rohstoffe.".into()));
        }
        if give == get {
            return Err(GameError("Gleiche Rohstoffe lassen sich nicht tauschen.".into()));
        }
        let times: i64 = match a.get("n") {
            None | Some(Value::Null) => 1,
            Some(v) => match v.as_i64() {
                Some(x) => x,
                None => match v.as_f64() {
                    Some(f) if f.fract() == 0.0 => f as i64,
                    _ => return Err(GameError("Ungültige Anzahl.".into())),
                },
            },
        };
        if times < 1 || times > 20 {
            return Err(GameError("Ungültige Anzahl.".into()));
        }
        let times = times as u32;
        let rate = self.rates_for(pid)[give];
        if self.pl(pid).hand.get(give) < rate * times {
            return Err(GameError(format!(
                "Für diesen Tausch brauchst du {}× {} (Kurs {}:1).",
                rate * times,
                rules::res_de(give),
                rate
            )));
        }
        if let Some(st) = self.stock(get) {
            if st < times {
                return Err(GameError(format!(
                    "Die Bank hat nur noch {}× {}.",
                    st,
                    rules::res_de(get)
                )));
            }
        }
        self.bump(pid, "tradesBank", 1, None);
        self.pl_mut(pid).hand.add(give, -((rate * times) as i64));
        self.pl_mut(pid).hand.add(get, times as i64);
        self.fx_single(&format!("p:{}", pid), "bank", give, rate * times, true, "bank");
        self.fx_single("bank", &format!("p:{}", pid), get, times, true, "bank");
        let name = self.name(pid);
        self.log(
            format!(
                "{} tauscht mit der Bank {}× {} gegen {}× {} ({}:1).",
                name,
                rate * times,
                rules::res_de(give),
                times,
                rules::res_de(get),
                rate
            ),
            "trade",
            Some(pid),
        );
        Ok(())
    }

    pub fn trade_offer(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        if self.S.sbp.is_some() {
            return Err(GameError("In der Sonderbauphase ist kein Handel erlaubt – nur Bauen.".into()));
        }
        if !self.S.settings.player_trade {
            return Err(GameError("In diesem Spiel ist nur der Handel mit der Bank erlaubt.".into()));
        }
        if self.S.trade.is_some() {
            return Err(GameError("Es läuft bereits ein Angebot. Warte darauf oder ziehe es zurück.".into()));
        }
        let give = clean_cards(a.get("give").unwrap_or(&Value::Null))?;
        let want = clean_cards(a.get("want").unwrap_or(&Value::Null))?;
        if sum_cards(&give) == 0 || sum_cards(&want) == 0 {
            return Err(GameError("Ein Angebot braucht Karten auf beiden Seiten.".into()));
        }
        if RES
            .iter()
            .any(|r| give.get(*r).copied().unwrap_or(0) > 0 && want.get(*r).copied().unwrap_or(0) > 0)
        {
            return Err(GameError("Gib nicht dieselbe Ressource, die du verlangst.".into()));
        }
        if !self.is_table_player(pid) && !self.can_pay(pid, &give) {
            return Err(GameError("Du besitzt diese Karten nicht.".into()));
        }
        self.S.trade_seq += 1;
        let id = self.S.trade_seq;
        self.S.trade = Some(Trade {
            id,
            from: pid,
            give: give.clone(),
            want: want.clone(),
            responses: Default::default(),
        });
        let name = self.name(pid);
        self.log(
            format!("{} bietet {} gegen {}.", name, fmt_cards(&give), fmt_cards(&want)),
            "trade",
            Some(pid),
        );
        // Auto-Spieler nehmen jedes 1:1-Angebot an, wenn sie die verlangte Karte besitzen
        if sum_cards(&give) == 1 && sum_cards(&want) == 1 {
            let ids: Vec<usize> = self.S.players.iter().map(|p| p.id).collect();
            for q in ids {
                if q != pid && self.pl(q).auto && self.can_pay(q, &want) {
                    if let Some(tr) = self.S.trade.as_mut() {
                        tr.responses.insert(q, TradeResponse { s: "accept".into(), give: None, want: None });
                    }
                    let qname = self.name(q);
                    self.log(format!("{} (Auto) nimmt das 1:1-Angebot an.", qname), "trade", Some(q));
                }
            }
        }
        Ok(())
    }

    pub fn trade_respond(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        let tr = match self.S.trade.clone() {
            Some(t) => t,
            None => return Err(GameError("Es gibt kein offenes Angebot.".into())),
        };
        if pid == tr.from {
            return Err(GameError("Das ist dein eigenes Angebot.".into()));
        }
        if self.S.sbp.is_some() || self.S.phase != "main" {
            return Err(GameError("Gerade ist kein Handel möglich.".into()));
        }
        if let Some(counter) = a.get("counter").filter(|v| v.is_object()) {
            let give = clean_cards(counter.get("give").unwrap_or(&Value::Null))?;
            let want = clean_cards(counter.get("want").unwrap_or(&Value::Null))?;
            if sum_cards(&give) == 0 || sum_cards(&want) == 0 {
                return Err(GameError("Ein Gegenangebot braucht Karten auf beiden Seiten.".into()));
            }
            if RES
                .iter()
                .any(|r| give.get(*r).copied().unwrap_or(0) > 0 && want.get(*r).copied().unwrap_or(0) > 0)
            {
                return Err(GameError("Gib nicht dieselbe Ressource, die du verlangst.".into()));
            }
            if !self.can_pay(pid, &want) {
                return Err(GameError("Du besitzt die Karten deines Gegenangebots nicht.".into()));
            }
            if let Some(tr) = self.S.trade.as_mut() {
                tr.responses.insert(
                    pid,
                    TradeResponse { s: "counter".into(), give: Some(give.clone()), want: Some(want.clone()) },
                );
            }
            let name = self.name(pid);
            self.log(
                format!(
                    "{} macht ein Gegenangebot: bekommt {}, gibt {}.",
                    name,
                    fmt_cards(&want),
                    fmt_cards(&give)
                ),
                "trade",
                Some(pid),
            );
        } else if a.get("accept").map(crate::game::truthy).unwrap_or(false) {
            if !self.can_pay(pid, &tr.want) {
                return Err(GameError("Dir fehlen die verlangten Karten.".into()));
            }
            if let Some(tr) = self.S.trade.as_mut() {
                tr.responses.insert(pid, TradeResponse { s: "accept".into(), give: None, want: None });
            }
            let name = self.name(pid);
            self.log(format!("{} nimmt das Angebot an.", name), "trade", Some(pid));
        } else {
            if let Some(tr) = self.S.trade.as_mut() {
                tr.responses.insert(pid, TradeResponse { s: "decline".into(), give: None, want: None });
            }
            let name = self.name(pid);
            self.log(format!("{} lehnt ab.", name), "trade", Some(pid));
        }
        self.S.v += 1;
        Ok(())
    }

    pub fn trade_confirm(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        if self.S.sbp.is_some() || self.S.phase != "main" {
            return Err(GameError("Gerade ist kein Handel möglich.".into()));
        }
        let tr = match self.S.trade.clone() {
            Some(t) if t.from == pid => t,
            _ => return Err(GameError("Du hast kein offenes Angebot.".into())),
        };
        let with = a.get("with").and_then(|v| v.as_u64()).map(|x| x as usize);
        let with = match with {
            Some(w) => w,
            None => return Err(GameError("Dieser Spieler hat nicht zugesagt.".into())),
        };
        let r = match tr.responses.get(&with) {
            Some(r) if r.s == "accept" || r.s == "counter" => r.clone(),
            _ => return Err(GameError("Dieser Spieler hat nicht zugesagt.".into())),
        };
        let counter = r.s == "counter";
        let give = if counter { r.give.clone().unwrap_or_default() } else { tr.give.clone() };
        let want = if counter { r.want.clone().unwrap_or_default() } else { tr.want.clone() };
        if !self.can_pay(pid, &give) {
            return Err(GameError("Du besitzt die angebotenen Karten nicht mehr.".into()));
        }
        if !self.can_pay(with, &want) {
            return Err(GameError(format!(
                "{} besitzt die Karten nicht mehr.",
                self.name(with)
            )));
        }
        self.pay(pid, &give);
        self.give(with, &give);
        self.pay(with, &want);
        self.give(pid, &want);
        self.fx(&format!("p:{}", pid), &format!("p:{}", with), &give, true, "trade");
        self.fx(&format!("p:{}", with), &format!("p:{}", pid), &want, true, "trade");
        self.bump(pid, "tradesPlayer", 1, None);
        self.bump(with, "tradesPlayer", 1, None);
        let (a_name, b_name) = (self.name(pid), self.name(with));
        self.log(
            format!(
                "Handel: {} gibt {} an {} und erhält {}.",
                a_name,
                fmt_cards(&give),
                b_name,
                fmt_cards(&want)
            ),
            "trade",
            Some(pid),
        );
        self.S.trade = None;
        Ok(())
    }

    pub fn trade_cancel(&mut self, pid: usize) -> Result<(), GameError> {
        match &self.S.trade {
            Some(t) if t.from == pid => {}
            _ => return Err(GameError("Du hast kein offenes Angebot.".into())),
        }
        self.S.trade = None;
        let name = self.name(pid);
        self.log(format!("{} zieht das Angebot zurück.", name), "trade", Some(pid));
        Ok(())
    }
}
