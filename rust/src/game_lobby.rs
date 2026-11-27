// Lobby, Spieler, Einstellungen, Spielstart und Spielende – Portierung von server/game_lobby.js.
use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde_json::Value;

use crate::avatars;
use crate::board;
use crate::game::{empty_hand, now_ms, Game, GameError, MAX_P, MIN_P};
use crate::model::*;
use crate::rules::{self, COLORS, DEV};
use crate::settings::{self, DevLimit, Settings};

pub const SEATS: [&str; 8] = ["bl", "b", "br", "tl", "t", "tr", "l", "r"];
pub const SEAT_CLOCK: [&str; 8] = ["br", "b", "bl", "l", "tl", "t", "tr", "r"];

pub fn random_hex(nbytes: usize) -> String {
    use std::io::Read;
    let mut buf = vec![0u8; nbytes];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if f.read_exact(&mut buf).is_ok() {
            return buf.iter().map(|b| format!("{:02x}", b)).collect();
        }
    }
    // Notfall (kein /dev/urandom): Zeit und Adresse mischen – nur für lokale Tests.
    let mut x = now_ms() as u64 ^ (&buf as *const _ as usize as u64);
    buf.iter()
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            format!("{:02x}", (x & 0xff) as u8)
        })
        .collect()
}

fn norm_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ")
}

impl Game {
    pub fn new_player(&self, name: &str, color: &str, avatar: &str, bot: Option<&str>) -> Player {
        Player {
            id: self.S.players.len(),
            name: name.to_string(),
            color: color.to_string(),
            avatar: avatar.to_string(),
            bot: bot.map(|b| b.to_string()),
            token: if bot.is_some() { None } else { Some(random_hex(16)) },
            connected: bot.is_some(),
            hand: empty_hand(),
            dev: Vec::new(),
            claimed: IndexMap::new(),
            knights: 0,
            svp: 0,
            island_bonus: 0,
            auto: false,
            left: false,
            auto_turns: 0,
            vanished: false,
            seat: None,
            table_guest: None,
            bm: None,
            person_ids: Vec::new(),
            person_id: None,
        }
    }

    pub fn pick_avatar(&mut self, want: Option<&str>) -> String {
        let taken: std::collections::HashSet<String> =
            self.S.players.iter().map(|p| p.avatar.clone()).collect();
        if let Some(w) = want {
            if avatars::HUMAN_IDS.contains(&w) && !taken.contains(w) {
                return w.to_string();
            }
        }
        let free: Vec<&str> = avatars::HUMAN_IDS
            .iter()
            .copied()
            .filter(|a| !taken.contains(*a))
            .collect();
        let idx = if free.is_empty() {
            let _ = self.r();
            0
        } else {
            self.rbelow(free.len())
        };
        free.get(idx).map(|s| s.to_string()).unwrap_or_else(|| avatars::HUMAN_IDS[0].to_string())
    }

    /// Farbe für einen Menschen reservieren. Hat sie ein Bot, weicht der Bot zuerst auf eine
    /// freie Farbe aus; erst bei einer Kollision mit einem anderen Menschen gibt es einen Fehler.
    fn claim_color(&mut self, color: &str) -> Result<(), GameError> {
        let i = match self.S.players.iter().position(|p| p.color == color) {
            Some(i) => i,
            None => return Ok(()),
        };
        if self.S.players[i].bot.is_none() {
            return Err(GameError("Diese Farbe ist schon vergeben.".into()));
        }
        let alt = match COLORS
            .iter()
            .find(|c| !self.S.players.iter().any(|p| p.color == **c))
        {
            Some(c) => (*c).to_string(),
            None => return Err(GameError("Diese Farbe ist schon vergeben.".into())),
        };
        let name = self.S.players[i].name.clone();
        self.S.players[i].color = alt.clone();
        self.log(
            format!("{} weicht auf die Farbe {} aus.", name, alt),
            "sys",
            Some(i),
        );
        Ok(())
    }

    pub fn join(
        &mut self,
        name: &str,
        color: &str,
        token: Option<&str>,
        avatar: Option<&str>,
    ) -> Result<(String, usize), GameError> {
        if let Some(tok) = token {
            if let Some(p) = self.S.players.iter().find(|x| x.token.as_deref() == Some(tok)) {
                return Ok((tok.to_string(), p.id));
            }
        }
        let name = norm_name(name);
        let len = name.chars().count();
        if len < 1 || len > 16 {
            return Err(GameError("Bitte einen Namen mit 1–16 Zeichen angeben.".into()));
        }
        if !COLORS.contains(&color) {
            return Err(GameError("Bitte eine Farbe wählen.".into()));
        }
        if self.S.phase != "lobby" {
            return Err(GameError(
                "Das Spiel läuft bereits. Nur angemeldete Spieler können zurückkehren.".into(),
            ));
        }
        if self.S.closed {
            return Err(GameError("Der Spielleiter hat die Plätze als besetzt erklärt.".into()));
        }
        if self.S.players.len() >= MAX_P {
            return Err(GameError("Das Spiel ist voll (maximal 6 Spieler).".into()));
        }
        let low = name.to_lowercase();
        if self.S.players.iter().any(|p| p.name.to_lowercase() == low) {
            return Err(GameError("Dieser Name ist schon vergeben.".into()));
        }
        if avatars::BOTS.iter().any(|b| b.name.to_lowercase() == low) {
            return Err(GameError("Dieser Name gehört einem Bot.".into()));
        }
        let av = self.pick_avatar(avatar);
        self.claim_color(color)?;
        let p = self.new_player(&name, color, &av, None);
        let pid = p.id;
        let tok = p.token.clone().unwrap_or_default();
        self.S.players.push(p);
        self.log(format!("{} ist dem Spiel beigetreten.", name), "sys", Some(pid));
        if self.S.players.len() > self.S.settings.planned_players as usize {
            self.S.settings.planned_players = self.S.players.len() as u32;
            self.regen();
            let n = self.S.players.len();
            self.log(format!("Das Spielfeld wurde für {} Spieler neu erzeugt.", n), "sys", None);
        }
        self.S.v += 1;
        Ok((tok, pid))
    }

    pub fn add_bot(&mut self, pid: usize, kind: Option<&str>) -> Result<(), GameError> {
        self.host_only(pid, "Bots hinzufügen")?;
        let key = kind.unwrap_or("");
        let b0 = match avatars::bot(key) {
            Some(b) => b,
            None => return Err(GameError("Diesen Bot gibt es nicht.".into())),
        };
        if self.S.closed {
            return Err(GameError("Die Plätze sind als besetzt erklärt.".into()));
        }
        if self.S.players.len() >= MAX_P {
            return Err(GameError("Das Spiel ist voll (maximal 6 Spieler).".into()));
        }
        if self.S.players.iter().any(|p| p.bot.as_deref() == Some(key)) {
            return Err(GameError(format!("{} ist schon dabei.", b0.name)));
        }
        if self.S.players.iter().any(|p| p.name.to_lowercase() == b0.name.to_lowercase()) {
            return Err(GameError("Dieser Name ist schon vergeben.".into()));
        }
        let color = COLORS
            .iter()
            .find(|c| !self.S.players.iter().any(|p| p.color == **c))
            .map(|s| s.to_string())
            .unwrap_or_else(|| COLORS[0].to_string());
        let p = self.new_player(b0.name, &color, b0.avatar, Some(key));
        let new_id = p.id;
        self.S.players.push(p);
        self.log(
            format!("{} (Bot: {}) ist dem Spiel beigetreten.", b0.name, b0.label),
            "sys",
            Some(new_id),
        );
        if self.S.players.len() > self.S.settings.planned_players as usize {
            self.S.settings.planned_players = self.S.players.len() as u32;
            self.regen();
            let n = self.S.players.len();
            self.log(format!("Das Spielfeld wurde für {} Spieler neu erzeugt.", n), "sys", None);
        }
        self.S.v += 1;
        Ok(())
    }

    pub fn add_table_player(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        self.host_only(pid, "Tischspieler anlegen")?;
        let name = norm_name(a.get("name").and_then(|v| v.as_str()).unwrap_or(""));
        let color = a.get("color").and_then(|v| v.as_str()).unwrap_or("");
        let len = name.chars().count();
        if len < 1 || len > 16 {
            return Err(GameError("Bitte einen Namen mit 1–16 Zeichen angeben.".into()));
        }
        if !COLORS.contains(&color) {
            return Err(GameError("Bitte eine Farbe wählen.".into()));
        }
        if self.S.closed {
            return Err(GameError("Die Plätze sind als besetzt erklärt.".into()));
        }
        if self.S.players.len() >= MAX_P {
            return Err(GameError("Das Spiel ist voll (maximal 6 Spieler).".into()));
        }
        let low = name.to_lowercase();
        if self.S.players.iter().any(|p| p.name.to_lowercase() == low) {
            return Err(GameError("Dieser Name ist schon vergeben.".into()));
        }
        if avatars::BOTS.iter().any(|b| b.name.to_lowercase() == low) {
            return Err(GameError("Dieser Name gehört einem Bot.".into()));
        }
        let av = self.pick_avatar(a.get("avatar").and_then(|v| v.as_str()));
        self.claim_color(color)?;
        let mut p = self.new_player(&name, color, &av, None);
        p.token = None;
        p.connected = true;
        p.table_guest = Some(true);
        let new_id = p.id;
        self.S.players.push(p);
        self.log(format!("{} sitzt am Spieltisch.", name), "sys", Some(new_id));
        if self.S.players.len() > self.S.settings.planned_players as usize {
            self.S.settings.planned_players = self.S.players.len() as u32;
            self.regen();
            let n = self.S.players.len();
            self.log(format!("Das Spielfeld wurde für {} Spieler neu erzeugt.", n), "sys", None);
        }
        self.sync_table();
        self.S.v += 1;
        Ok(())
    }

    pub fn is_table_player(&self, pid: usize) -> bool {
        let p = match self.S.players.get(pid) {
            Some(p) => p,
            None => return false,
        };
        self.S.settings.table && (pid == self.S.host || p.is_table_guest())
    }

    pub fn sync_table(&mut self) {
        self.S.settings.table = self.S.players.iter().any(|p| p.is_table_guest());
        for p in self.S.players.iter_mut() {
            p.seat = None;
        }
    }

    pub fn remove_from_lobby(&mut self, pid: usize) {
        let host_tok = self.S.players.get(self.S.host).and_then(|p| p.token.clone());
        if pid < self.S.players.len() {
            self.S.players.remove(pid);
        }
        for (i, q) in self.S.players.iter_mut().enumerate() {
            q.id = i;
        }
        let ni = host_tok
            .and_then(|t| self.S.players.iter().position(|q| q.token.as_deref() == Some(t.as_str())))
            .map(|i| i as isize)
            .unwrap_or(-1);
        let mut host = if ni >= 0 {
            ni as usize
        } else {
            let i = self
                .S
                .players
                .iter()
                .position(|q| q.connected && q.bot.is_none() && !q.is_table_guest());
            i.map(|x| x as isize).unwrap_or(-1).max(0) as usize
        };
        if host >= self.S.players.len() {
            host = 0;
        }
        self.S.host = host;
    }

    pub fn leave(&mut self, token: &str) -> bool {
        let pid = match self.S.players.iter().position(|x| x.token.as_deref() == Some(token)) {
            Some(p) => p,
            None => return false,
        };
        let name = self.name(pid);
        if self.S.phase == "lobby" {
            self.remove_from_lobby(pid);
            self.log(format!("{} hat die Lobby verlassen.", name), "sys", None);
        } else {
            let phase = self.S.phase.clone();
            let p = self.pl_mut(pid);
            p.left = true;
            p.auto = true;
            p.connected = false;
            p.token = None;
            p.auto_turns = 0;
            self.log(
                format!(
                    "{} hat das Spiel verlassen{}.",
                    name,
                    if phase == "ended" { "" } else { " – der Auto-Modus spielt für diesen Spieler weiter" }
                ),
                "sys",
                Some(pid),
            );
            if self.S.trade.as_ref().map(|t| t.from == pid).unwrap_or(false) {
                self.S.trade = None;
            }
            self.settle();
        }
        self.S.v += 1;
        true
    }

    pub fn humans(&self) -> Vec<usize> {
        self.S
            .players
            .iter()
            .filter(|p| !p.left && p.bot.is_none() && !p.is_table_guest())
            .map(|p| p.id)
            .collect()
    }

    /// Alle menschlichen Plätze haben einen Spielerpass (Bots und Tischspieler zählen nicht) –
    /// nur dann lässt sich die Partie pausieren und von jedem Menschen wieder aufnehmen.
    pub fn all_humans_have_pass(&self) -> bool {
        let mut n = 0;
        for p in &self.S.players {
            if p.bot.is_some() || p.is_table_guest() {
                continue;
            }
            n += 1;
            if p.person_ids.is_empty() && p.person_id.is_none() {
                return false;
            }
        }
        n > 0
    }

    pub fn set_connected(&mut self, pid: usize, c: bool) {
        let changed = match self.S.players.get(pid) {
            Some(p) => p.connected != c,
            None => return,
        };
        if !changed {
            return;
        }
        let name;
        let rejoin;
        {
            let p = self.pl_mut(pid);
            p.connected = c;
            name = p.name.clone();
            rejoin = c && !p.left && p.auto;
            if rejoin {
                p.auto = false;
            }
        }
        if rejoin {
            self.log(format!("{} ist zurück und spielt wieder selbst.", name), "sys", Some(pid));
        }
        self.S.v += 1;
    }

    pub fn set_absent_auto(&mut self, pid: usize, on: bool) -> bool {
        let ok = match self.S.players.get(pid) {
            Some(p) => !p.left && p.auto != on,
            None => false,
        };
        if !ok {
            return false;
        }
        let name;
        {
            let p = self.pl_mut(pid);
            p.auto = on;
            name = p.name.clone();
        }
        self.log(
            if on {
                format!("{} ist abwesend – der Auto-Modus übernimmt vorübergehend.", name)
            } else {
                format!("{} spielt wieder selbst.", name)
            },
            "sys",
            Some(pid),
        );
        self.S.v += 1;
        if on {
            self.settle();
        }
        true
    }

    pub fn host_only(&self, pid: usize, what: &str) -> Result<(), GameError> {
        if pid != self.S.host {
            return Err(GameError(format!("Nur der Spielleiter kann {}.", what)));
        }
        if self.S.phase != "lobby" {
            return Err(GameError("Das geht nur vor Spielbeginn.".into()));
        }
        Ok(())
    }

    pub fn set_settings(&mut self, pid: usize, patch: &Value) -> Result<(), GameError> {
        if self.S.phase != "lobby" {
            return self.change_settings(pid, patch);
        }
        self.host_only(pid, "die Einstellungen ändern")?;
        let mut ns = settings::merge(&self.S.settings, patch).map_err(|e| GameError(e.0))?;
        if ns.planned_players < self.S.players.len() as u32 {
            ns.planned_players = self.S.players.len() as u32;
        }
        let old = &self.S.settings;
        let board_changed = ns.variant != old.variant
            || ns.planned_players != old.planned_players
            || ns.dense != old.dense
            || ns.gold_home != old.gold_home
            || ((ns.aspect.unwrap_or(0.0) - old.aspect.unwrap_or(0.0)).abs() > 0.12);
        self.S.settings = ns;
        if board_changed {
            self.regen();
        }
        self.S.v += 1;
        Ok(())
    }

    pub fn change_settings(&mut self, pid: usize, patch: &Value) -> Result<(), GameError> {
        if pid != self.S.host {
            return Err(GameError("Nur der Spielleiter kann die Einstellungen ändern.".into()));
        }
        if !patch.is_object() {
            return Err(GameError("Ungültige Einstellungen.".into()));
        }
        if let Value::Object(o) = patch {
            if ["variant", "plannedPlayers", "dense", "aspect", "goldHome"]
                .iter()
                .any(|k| o.contains_key(*k))
            {
                return Err(GameError("Das Spielfeld lässt sich im Spiel nicht mehr ändern.".into()));
            }
        }
        let old: Settings = self.S.settings.clone();
        let ns = settings::merge(&old, patch).map_err(|e| GameError(e.0))?;
        if self.S.phase != "ended" && ns.win_points != old.win_points {
            let top = self
                .S
                .players
                .iter()
                .filter(|p| !p.left)
                .map(|p| self.vp(p.id) + self.hidden_vp(p.id) as i64)
                .max()
                .unwrap_or(0);
            if ns.win_points as i64 <= top {
                return Err(GameError(format!(
                    "Das Siegpunktziel muss über dem höchsten Stand ({}) liegen.",
                    top
                )));
            }
        }
        // Vorräte der laufenden Partie an die neuen Grenzen anpassen
        for (lk, sk) in [("fogTerrain", "terrain"), ("fogChips", "chips")] {
            let old_map = if lk == "fogTerrain" { &old.limits.fog_terrain } else { &old.limits.fog_chips };
            let new_map = if lk == "fogTerrain" { &ns.limits.fog_terrain } else { &ns.limits.fog_chips };
            for (x, b) in new_map.iter() {
                let a = old_map.get(x).copied().flatten();
                let b = *b;
                if a == b || self.S.supply.is_none() {
                    continue;
                }
                if let Some(sup) = self.S.supply.as_mut() {
                    let target = if sk == "terrain" { &mut sup.terrain } else { &mut sup.chips };
                    let cur = target.get(x).copied().flatten().unwrap_or(0);
                    let val = match b {
                        None => None,
                        Some(b) => match a {
                            None => Some(b),
                            Some(a) => Some(cur.saturating_add(b).saturating_sub(a).max(0)),
                        },
                    };
                    target.insert(x.clone(), val);
                }
            }
        }
        let dev_changed = old.limits.dev != ns.limits.dev;
        let ret_changed = old.dev_return != ns.dev_return;
        self.S.settings = ns;
        if (dev_changed || ret_changed) && self.S.stats.is_some() {
            self.rebuild_deck();
        }
        let msg = "Der Spielleiter hat die Spieleinstellungen geändert.";
        let last_ok = self.S.log.last().map(|l| l.text != msg).unwrap_or(true);
        if last_ok {
            self.log(msg, "sys", None);
        }
        self.S.v += 1;
        if self.S.phase != "ended" {
            self.settle();
        }
        Ok(())
    }

    pub fn kick(&mut self, pid: usize, target: usize) -> Result<Option<String>, GameError> {
        self.host_only(pid, "Spieler entfernen")?;
        let t = match self.S.players.get(target) {
            Some(t) => t,
            None => return Err(GameError("Diesen Spieler gibt es nicht.".into())),
        };
        if target == pid {
            return Err(GameError(
                "Du kannst dich nicht selbst entfernen (nutze „Spiel verlassen“).".into(),
            ));
        }
        let tok = t.token.clone();
        let name = t.name.clone();
        self.remove_from_lobby(target);
        self.sync_table();
        self.log(format!("{} wurde vom Spielleiter entfernt.", name), "sys", None);
        self.S.v += 1;
        Ok(tok)
    }

    pub fn build_deck(&mut self, n: usize) {
        let lim = self.S.settings.limits.dev.clone();
        self.S.deck.clear();
        for k in DEV {
            let c = match lim.get(k) {
                Some(DevLimit::Standard) => rules::dev_std(n)
                    .iter()
                    .find(|(x, _)| *x == k)
                    .map(|(_, v)| *v)
                    .unwrap_or(0),
                Some(DevLimit::N(x)) => *x,
                None => 0,
            };
            for _ in 0..c {
                self.S.deck.push(k.to_string());
            }
        }
        let deck = std::mem::take(&mut self.S.deck);
        self.S.deck = board::shuffle(&deck, &mut self.rnd.lock().unwrap());
    }

    pub fn rebuild_deck(&mut self) {
        let drawn: u32 = self
            .S
            .stats
            .as_ref()
            .map(|st| st.players.iter().map(|p| p.built.dev).sum())
            .unwrap_or(0);
        let n = self.S.players.len();
        self.build_deck(n);
        if !self.S.settings.dev_return {
            let keep = self.S.deck.len().saturating_sub(drawn as usize);
            self.S.deck.truncate(keep);
        }
    }

    pub fn draw_dev(&mut self) -> String {
        if self.S.settings.dev_return {
            if self.S.deck.is_empty() {
                return String::new();
            }
            let i = self.rbelow(self.S.deck.len());
            return self.S.deck[i].clone();
        }
        self.S.deck.pop().unwrap_or_default()
    }

    pub fn dev_left(&self) -> u32 {
        if self.S.settings.dev_return && !self.S.deck.is_empty() {
            crate::game::UNLIMITED as u32
        } else {
            self.S.deck.len() as u32
        }
    }

    pub fn start(&mut self, pid: usize) -> Result<(), GameError> {
        if self.S.phase != "lobby" {
            return Err(GameError("Das Spiel läuft bereits.".into()));
        }
        if pid != self.S.host {
            return Err(GameError("Nur der Spielleiter kann das Spiel starten.".into()));
        }
        if self.S.players.len() < MIN_P {
            return Err(GameError(format!("Es braucht mindestens {} Spieler.", MIN_P)));
        }
        let n = self.S.players.len();
        let set = self.S.settings.clone();
        // Vorrat für aufgedeckte Felder (Nebel)
        self.S.supply = Some(Supply {
            terrain: set.limits.fog_terrain.clone(),
            chips: set.limits.fog_chips.clone(),
        });
        self.S.gold_rate = Some(set.gold_rate);
        self.S.fog_gold = match set.variant.as_str() {
            "nebel" => 1.3,
            "archipel" => 1.6,
            _ => 1.0,
        };
        self.build_deck(n);
        let ids: Vec<usize> = (0..n).collect();
        self.S.order = board::shuffle(&ids, &mut self.rnd.lock().unwrap());
        self.S.phase = "setup".to_string();
        self.S.dice = None;
        self.S.stats = Some(Stats {
            started_at: now_ms(),
            ended_at: None,
            rolls: BTreeMap::new(),
            history: Vec::new(),
            players: (0..n)
                .map(|_| PlayerStats {
                    built: Built::default(),
                    produced: empty_hand(),
                    trades_player: 0,
                    trades_bank: 0,
                    stolen_from: 0,
                    stolen_by: 0,
                    discarded: 0,
                    robber_moves: 0,
                    sevens: 0,
                    discovered: 0,
                    max_route: 0,
                })
                .collect(),
        });
        self.log(
            format!("Das Spiel beginnt! Erster mit {} Punkten gewinnt.", set.win_points),
            "sys",
            None,
        );
        self.log(
            "Aufbau: Jeder setzt zwei Siedlungen samt Straße oder Schiff (die zweite in umgekehrter Reihenfolge) und erhält dafür Startrohstoffe.",
            "sys",
            None,
        );
        if set.table {
            let mut ask = vec![self.S.host];
            let ids: Vec<usize> = self.S.players.iter().map(|p| p.id).collect();
            for i in ids {
                if i != self.S.host && self.is_table_player(i) {
                    ask.push(i);
                }
            }
            self.S.order = ask.clone();
            for p in self.S.players.iter_mut() {
                p.seat = None;
            }
            self.S.setup = Some(Setup {
                seq: None,
                i: 0,
                stage: "seat".to_string(),
                last: None,
                ask: Some(ask),
                ask_idx: Some(0),
                ord: None,
            });
            self.S.turn = self.S.setup.as_ref().unwrap().ask.as_ref().unwrap()[0];
            self.log("Am Spieltisch wählt jetzt jeder Tischspieler seinen Platz.", "sys", None);
        } else if set.dice == "auto" {
            self.order_done();
        } else {
            let order = self.S.order.clone();
            self.S.setup = Some(Setup {
                seq: None,
                i: 0,
                stage: "order".to_string(),
                last: None,
                ask: None,
                ask_idx: None,
                ord: Some(OrderRoll {
                    table: set.table,
                    groups: vec![order.clone()],
                    cur: order.clone(),
                    rolled: BTreeMap::new(),
                    idx: 0,
                }),
            });
            self.S.turn = self.S.order[0];
            self.log(
                if set.table {
                    "Es wird gewürfelt, wer beginnt: Die höchste Augenzahl fängt an, danach geht es im Uhrzeigersinn weiter."
                } else {
                    "Die Reihenfolge wird ausgewürfelt: Wer die höchste Augenzahl wirft, beginnt."
                },
                "sys",
                None,
            );
        }
        self.S.v += 1;
        self.settle();
        Ok(())
    }

    pub fn after_seating(&mut self) {
        let set = self.S.settings.clone();
        let n = self.S.players.len();
        let mut free: Vec<&str> = ["b", "t", "l", "r", "bl", "br", "tl", "tr"]
            .into_iter()
            .filter(|x| !self.S.players.iter().any(|p| p.seat.as_deref() == Some(*x)))
            .collect();
        let ids: Vec<usize> = self.S.players.iter().filter(|p| p.seat.is_none()).map(|p| p.id).collect();
        for id in ids {
            let s = free.first().copied().unwrap_or("b").to_string();
            if !free.is_empty() {
                free.remove(0);
            }
            let name;
            {
                let p = self.pl_mut(id);
                p.seat = Some(s);
                name = p.name.clone();
            }
            self.log(format!("{} sitzt am Tisch.", name), "sys", Some(id));
        }
        let mut ids: Vec<usize> = self.S.players.iter().map(|p| p.id).collect();
        ids.sort_by_key(|id| {
            SEAT_CLOCK
                .iter()
                .position(|x| Some(*x) == self.S.players[*id].seat.as_deref())
                .unwrap_or(0)
        });
        self.S.order = ids;
        if set.dice == "auto" {
            let idx = self.rbelow(n);
            let first = self.S.order[idx];
            self.start_with(first);
            self.order_done();
            return;
        }
        let order = self.S.order.clone();
        self.S.setup = Some(Setup {
            seq: None,
            i: 0,
            stage: "order".to_string(),
            last: None,
            ask: None,
            ask_idx: None,
            ord: Some(OrderRoll {
                table: true,
                groups: vec![order.clone()],
                cur: order.clone(),
                rolled: BTreeMap::new(),
                idx: 0,
            }),
        });
        self.S.turn = self.S.order[0];
        self.log(
            "Es wird gewürfelt, wer beginnt: Die höchste Augenzahl fängt an, danach geht es im Uhrzeigersinn weiter.",
            "sys",
            None,
        );
    }

    pub fn place_seat(&mut self, pid: usize, a: &Value) -> Result<(), GameError> {
        if pid != self.S.turn {
            return Err(GameError(format!("{} wählt gerade seinen Platz.", self.name(self.S.turn))));
        }
        let seat = match a.get("seat").and_then(|v| v.as_str()) {
            Some(s) if SEATS.contains(&s) => s.to_string(),
            _ => return Err(GameError("Bitte einen Platz am Tisch wählen.".into())),
        };
        if let Some(taken) = self.S.players.iter().find(|p| p.seat.as_deref() == Some(seat.as_str())) {
            return Err(GameError(format!("Dieser Platz ist schon von {} besetzt.", taken.name)));
        }
        self.pl_mut(pid).seat = Some(seat);
        let name = self.name(pid);
        self.log(format!("{} sitzt am Tisch.", name), "sys", Some(pid));
        let (next_turn, done) = {
            let su = self.S.setup.as_mut().unwrap();
            let idx = su.ask_idx.unwrap_or(0) + 1;
            su.ask_idx = Some(idx);
            let ask = su.ask.clone().unwrap_or_default();
            if idx < ask.len() {
                (Some(ask[idx]), false)
            } else {
                (None, true)
            }
        };
        if let Some(t) = next_turn {
            self.S.turn = t;
        } else if done {
            self.after_seating();
        }
        Ok(())
    }

    pub fn order_done(&mut self) {
        let mut seq = self.S.order.clone();
        let mut rev = self.S.order.clone();
        rev.reverse();
        seq.extend(rev);
        self.S.setup = Some(Setup {
            seq: Some(seq.clone()),
            i: 0,
            stage: "settlement".to_string(),
            last: None,
            ask: None,
            ask_idx: None,
            ord: None,
        });
        self.S.turn = seq[0];
        let id = self.S.order_seq.unwrap_or(0) + 1;
        self.S.order_seq = Some(id);
        self.S.order_shown = Some(OrderShown { id, order: self.S.order.clone() });
        let names: Vec<String> = self.S.order.iter().map(|i| self.name(*i)).collect();
        self.log(format!("Reihenfolge: {}.", names.join(" → ")), "sys", None);
    }

    pub fn start_with(&mut self, first: usize) {
        if let Some(i) = self.S.order.iter().position(|x| *x == first) {
            let mut o = self.S.order.clone();
            o.rotate_left(i);
            self.S.order = o;
        }
    }

    pub fn order_roll(&mut self, pid: usize) -> Result<(), GameError> {
        let a = 1 + self.rbelow(6) as u32;
        let b = 1 + self.rbelow(6) as u32;
        self.S.dice = Some((a, b));
        self.S.dice_seq += 1;
        let (idx, cur_len, table) = {
            let o = self.S.setup.as_mut().unwrap().ord.as_mut().unwrap();
            o.rolled.insert(pid, a + b);
            o.idx += 1;
            (o.idx, o.cur.len(), o.table)
        };
        let name = self.name(pid);
        self.log(format!("{} würfelt {} ({}+{}) um die Reihenfolge.", name, a + b, a, b), "roll", Some(pid));
        if idx < cur_len {
            let t = {
                let o = self.S.setup.as_ref().unwrap().ord.as_ref().unwrap();
                o.cur[o.idx]
            };
            self.S.turn = t;
            return Ok(());
        }
        if table {
            let (top, best) = {
                let o = self.S.setup.as_ref().unwrap().ord.as_ref().unwrap();
                let top = o.cur.iter().map(|p| o.rolled[p]).max().unwrap_or(0);
                let best: Vec<usize> = o.cur.iter().copied().filter(|p| o.rolled[p] == top).collect();
                (top, best)
            };
            let _ = top;
            if best.len() > 1 {
                let names: Vec<String> = best.iter().map(|p| self.name(*p)).collect();
                let o = self.S.setup.as_mut().unwrap().ord.as_mut().unwrap();
                o.cur = best.clone();
                o.rolled.clear();
                o.idx = 0;
                self.S.turn = best[0];
                self.log(
                    format!("Gleichstand zwischen {} – sie würfeln noch einmal.", names.join(", ")),
                    "sys",
                    None,
                );
                return Ok(());
            }
            self.start_with(best[0]);
            self.order_done();
            return Ok(());
        }
        // Runde vollständig: Gruppe nach Augenzahl aufteilen
        let mut log_stand: Option<Vec<usize>> = None;
        let mut flat: Option<Vec<usize>> = None;
        {
            let o = self.S.setup.as_mut().unwrap().ord.as_mut().unwrap();
            let mut by_val: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
            for p in o.cur.iter() {
                by_val.entry(o.rolled[p]).or_default().push(*p);
            }
            let parts: Vec<Vec<usize>> = by_val.into_iter().rev().map(|(_, v)| v).collect();
            let cur = o.cur.clone();
            let gi = o
                .groups
                .iter()
                .position(|g| *g == cur || (g.len() == cur.len() && g.iter().all(|p| cur.contains(p))))
                .unwrap_or(0);
            o.groups.splice(gi..gi + 1, parts);
            if let Some(next) = o.groups.iter().find(|g| g.len() > 1).cloned() {
                o.cur = next;
                o.rolled.clear();
                o.idx = 0;
                self.S.turn = o.cur[0];
                log_stand = Some(o.cur.clone());
            } else {
                flat = Some(o.groups.iter().flatten().copied().collect());
            }
        }
        if let Some(cur) = log_stand {
            let names: Vec<String> = cur.iter().map(|p| self.name(*p)).collect();
            self.log(
                format!("Gleichstand zwischen {} – sie würfeln noch einmal.", names.join(", ")),
                "sys",
                None,
            );
        } else if let Some(flat) = flat {
            self.S.order = flat;
            self.order_done();
        }
        Ok(())
    }

    pub fn end_game(&mut self, pid: usize) -> Result<(), GameError> {
        if pid != self.S.host {
            return Err(GameError("Nur der Spielleiter kann das Spiel beenden.".into()));
        }
        if self.S.phase != "setup" && self.S.phase != "main" {
            return Err(GameError("Das Spiel läuft nicht.".into()));
        }
        self.finish(None, "host");
        self.log("Der Spielleiter hat das Spiel beendet.", "sys", None);
        Ok(())
    }

    pub fn resume_game(&mut self, pid: usize, win_points: Option<&Value>) -> Result<(), GameError> {
        if pid != self.S.host {
            return Err(GameError("Nur der Spielleiter kann das Spiel fortsetzen.".into()));
        }
        if self.S.phase != "ended" {
            return Err(GameError("Das Spiel ist noch nicht beendet.".into()));
        }
        let mut patch = serde_json::Map::new();
        patch.insert(
            "winPoints".to_string(),
            win_points.cloned().unwrap_or(Value::Null),
        );
        let ns = settings::merge(&self.S.settings, &Value::Object(patch)).map_err(|e| GameError(e.0))?;
        let wp = ns.win_points;
        let top = self
            .S
            .players
            .iter()
            .filter(|p| !p.left)
            .map(|p| self.vp(p.id) + self.hidden_vp(p.id) as i64)
            .max()
            .unwrap_or(0);
        if wp as i64 <= top {
            return Err(GameError(format!(
                "Das neue Siegpunktziel muss über dem höchsten Stand ({}) liegen.",
                top
            )));
        }
        self.S.settings.win_points = wp;
        self.S.phase = self.S.ended_from.clone().unwrap_or_else(|| "main".to_string());
        self.S.winner = None;
        self.S.ended_by = None;
        self.S.aborted = false;
        if let Some(st) = self.S.stats.as_mut() {
            st.ended_at = None;
            if st.history.last().map(|h| h.end == Some(true)).unwrap_or(false) {
                st.history.pop();
            }
        }
        self.log(format!("Das Spiel geht weiter – neues Siegpunktziel: {}.", wp), "sys", None);
        self.S.v += 1;
        self.settle();
        Ok(())
    }

    pub fn new_game(&mut self, pid: usize) -> Result<(), GameError> {
        if pid != self.S.host {
            return Err(GameError("Nur der Spielleiter kann ein neues Spiel beginnen.".into()));
        }
        if self.S.phase != "ended" {
            return Err(GameError("Das Spiel ist noch nicht beendet.".into()));
        }
        let host_tok = self.S.players.get(self.S.host).and_then(|p| p.token.clone());
        self.S.players.retain(|p| !p.left);
        let pos = host_tok.and_then(|t| {
            self.S
                .players
                .iter()
                .position(|p| p.token.as_deref() == Some(t.as_str()))
        });
        self.S.host = pos.unwrap_or(0);
        self.reset(true);
        self.log("Neue Runde – wartet in der Lobby auf den Start.", "sys", None);
        self.S.v += 1;
        Ok(())
    }
}
