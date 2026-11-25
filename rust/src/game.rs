// Spiellogik – Portierung von server/game.js (Kern) und seinen Teilbereichen (game_*.rs).
use std::sync::{Arc, Mutex};

use indexmap::{IndexMap, IndexSet};
use serde_json::{json, Value};

use crate::board;
use crate::geom::{self, vert_hexes};
use crate::model::*;
use crate::rng::Rng;
use crate::rules::{self, terrain_res, RES};
use crate::settings::Settings;

pub const MIN_P: usize = 2;
pub const MAX_P: usize = 6;
pub const UNLIMITED: i64 = 999;

#[derive(Debug, Clone)]
pub struct GameError(pub String);

impl std::fmt::Display for GameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for GameError {}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn empty_hand() -> Hand {
    Hand::default()
}

pub fn hand_sum(h: &Hand) -> u32 {
    h.sum()
}

pub fn fmt_cards(c: &IndexMap<String, u32>) -> String {
    let parts: Vec<String> = RES
        .iter()
        .filter(|r| c.get(**r).copied().unwrap_or(0) > 0)
        .map(|r| format!("{}× {}", c[*r], rules::res_de(r)))
        .collect();
    if parts.is_empty() {
        "nichts".to_string()
    } else {
        parts.join(", ")
    }
}

pub fn clean_cards(v: &Value) -> Result<IndexMap<String, u32>, GameError> {
    let obj = match v {
        Value::Object(o) => o,
        _ => return Err(GameError("Ungültige Kartenangabe.".into())),
    };
    let mut out = IndexMap::new();
    for r in RES {
        let n = match obj.get(r) {
            None => 0,
            Some(x) => match x.as_f64() {
                Some(f) if f.fract() == 0.0 && (0.0..=99.0).contains(&f) => f as u32,
                _ => return Err(GameError("Ungültige Kartenanzahl.".into())),
            },
        };
        if n > 0 {
            out.insert(r.to_string(), n);
        }
    }
    Ok(out)
}

pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

pub fn cost_map(what: &str) -> IndexMap<String, u32> {
    rules::cost(what)
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect()
}

#[derive(Clone)]
pub struct Game {
    pub rnd: Arc<Mutex<Rng>>,
    pub meta_id: String,
    pub meta_name: String,
    pub S: State,
    pub lens: Option<Vec<u32>>,
    pub len_key: Option<String>,
    pub last_kicked: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct Left {
    pub road: i64,
    pub ship: i64,
    pub settlement: i64,
    pub city: i64,
}

impl Game {
    pub fn new(rnd: Arc<Mutex<Rng>>, id: &str, name: &str) -> Self {
        let mut g = Game {
            rnd,
            meta_id: id.to_string(),
            meta_name: name.to_string(),
            S: State::empty(Settings::default()),
            lens: None,
            len_key: None,
            last_kicked: None,
        };
        g.reset(false);
        g
    }

    pub fn from_state(S: State, rnd: Arc<Mutex<Rng>>, id: &str, name: &str) -> Self {
        Game {
            rnd,
            meta_id: id.to_string(),
            meta_name: name.to_string(),
            S,
            lens: None,
            len_key: None,
            last_kicked: None,
        }
    }

    pub fn r(&self) -> f64 {
        self.rnd.lock().unwrap().next_f64()
    }

    pub fn rbelow(&self, n: usize) -> usize {
        self.rnd.lock().unwrap().below(n)
    }

    pub fn chance(&self, p: f64) -> bool {
        self.rnd.lock().unwrap().next_f64() < p
    }

    pub fn reset(&mut self, keep_players: bool) {
        let old_players: Vec<Player> = if keep_players { self.S.players.clone() } else { Vec::new() };
        let settings = if keep_players { self.S.settings.clone() } else { Settings::default() };
        let host = if keep_players { self.S.host } else { 0 };
        let fx_id = self.S.fx_id;
        let mut players: Vec<Player> = old_players
            .into_iter()
            .map(|mut p| {
                p.hand = empty_hand();
                p.dev = Vec::new();
                p.claimed = IndexMap::new();
                p.knights = 0;
                p.svp = 0;
                p.island_bonus = 0;
                p.auto = false;
                p.auto_turns = 0;
                p.vanished = false;
                p
            })
            .collect();
        for (i, p) in players.iter_mut().enumerate() {
            p.id = i;
        }
        let mut S = State::empty(settings);
        S.fx_id = fx_id;
        S.host = host;
        S.players = players;
        self.S = S;
        self.regen();
    }

    pub fn regen(&mut self) {
        self.S.verts.clear();
        self.S.edges.clear();
        let n = self.S.settings.planned_players as usize;
        let n = n.max(self.S.players.len()).max(2);
        let set = self.S.settings.clone();
        board::generate(&mut self.S, n, &mut self.rnd.lock().unwrap(), &set);
    }

    pub fn lim(&self, kind: &str) -> Option<u32> {
        match kind {
            "road" => self.S.settings.limits.road,
            "ship" => self.S.settings.limits.ship,
            "settlement" => self.S.settings.limits.settlement,
            "city" => self.S.settings.limits.city,
            _ => None,
        }
    }

    // ---------- Hilfen ----------
    pub fn pl(&self, pid: usize) -> &Player {
        &self.S.players[pid]
    }
    pub fn pl_mut(&mut self, pid: usize) -> &mut Player {
        &mut self.S.players[pid]
    }
    pub fn name(&self, pid: usize) -> String {
        self.S.players[pid].name.clone()
    }
    pub fn log(&mut self, text: impl Into<String>, kind: &str, p: Option<usize>) {
        let id = self.S.log_id + 1;
        self.S.log_id = id;
        self.S.log.push(LogEntry {
            id,
            p,
            text: text.into(),
            kind: kind.to_string(),
        });
        if self.S.log.len() > 100 {
            self.S.log.remove(0);
        }
    }
    pub fn count(&self, pid: usize, kind: &str) -> i64 {
        self.S
            .verts
            .values()
            .filter(|b| b.p == pid && b.k == kind)
            .count() as i64
    }
    pub fn count_e(&self, pid: usize, kind: &str) -> i64 {
        self.S
            .edges
            .values()
            .filter(|b| b.p == pid && b.k == kind)
            .count() as i64
    }
    pub fn left(&self, pid: usize) -> Left {
        let f = |lim: Option<u32>, used: i64| if lim.is_none() { UNLIMITED } else { lim.unwrap() as i64 - used };
        Left {
            road: f(self.lim("road"), self.count_e(pid, "r")),
            ship: f(self.lim("ship"), self.count_e(pid, "s")),
            settlement: f(self.lim("settlement"), self.count(pid, "s")),
            city: f(self.lim("city"), self.count(pid, "c")),
        }
    }
    pub fn can_pay(&self, pid: usize, cost: &IndexMap<String, u32>) -> bool {
        let h = &self.pl(pid).hand;
        cost.iter().all(|(r, n)| h.get(r) >= *n)
    }
    pub fn pay(&mut self, pid: usize, cost: &IndexMap<String, u32>) {
        let h = &mut self.pl_mut(pid).hand;
        for (r, n) in cost {
            h.add(r, -(*n as i64));
        }
    }
    pub fn give(&mut self, pid: usize, cost: &IndexMap<String, u32>) {
        let h = &mut self.pl_mut(pid).hand;
        for (r, n) in cost {
            h.add(r, *n as i64);
        }
    }
    pub fn hand_size(&self, pid: usize) -> u32 {
        hand_sum(&self.pl(pid).hand)
    }
    /// Vorrat der Bank: None = unbegrenzt.
    pub fn stock(&self, res: &str) -> Option<u32> {
        let lim = self.S.settings.limits.bank.get(res).copied().flatten()?;
        let used: u32 = self.S.players.iter().map(|p| p.hand.get(res)).sum();
        Some(lim.saturating_sub(used))
    }
    pub fn fx(&mut self, from: &str, to: &str, cards: &IndexMap<String, u32>, pub_: bool, why: &str) {
        let mut c = IndexMap::new();
        let mut n = 0;
        for r in RES {
            let x = cards.get(r).copied().unwrap_or(0);
            if x > 0 {
                c.insert(r.to_string(), x);
                n += x;
            }
        }
        if n == 0 {
            return;
        }
        self.S.fx_id += 1;
        self.S.fx.push(Fx {
            id: self.S.fx_id,
            f: from.to_string(),
            t: to.to_string(),
            c,
            n,
            pub_,
            why: Some(why.to_string()),
        });
        if self.S.fx.len() > 40 {
            self.S.fx.remove(0);
        }
    }
    pub fn fx_single(&mut self, from: &str, to: &str, res: &str, n: u32, pub_: bool, why: &str) {
        let mut c = IndexMap::new();
        c.insert(res.to_string(), n);
        self.fx(from, to, &c, pub_, why);
    }
    pub fn fx_for(&self, pid: Option<usize>) -> Vec<Value> {
        let me = match pid {
            Some(p) => format!("p:{}", p),
            None => "p:-1".to_string(),
        };
        self.S
            .fx
            .iter()
            .map(|e| {
                if e.pub_ || e.f == me || e.t == me {
                    json!({"id": e.id, "f": e.f, "t": e.t, "c": e.c, "n": e.n, "pub": e.pub_, "why": e.why})
                } else {
                    json!({"id": e.id, "f": e.f, "t": e.t, "n": e.n, "pub": false, "why": e.why})
                }
            })
            .collect()
    }
    pub fn pay_bank(&mut self, pid: usize, cost: &IndexMap<String, u32>) {
        self.pay(pid, cost);
        self.fx(&format!("p:{}", pid), "bank", cost, true, "build");
    }
    /// Gibt, was die Bank hergeben kann; Rückgabe: tatsächlich ausgegebene Karten.
    pub fn bank_give(&mut self, pid: usize, cost: &IndexMap<String, u32>) -> IndexMap<String, u32> {
        let mut out = IndexMap::new();
        for r in RES {
            let want = cost.get(r).copied().unwrap_or(0);
            if want == 0 {
                continue;
            }
            let n = match self.stock(r) {
                Some(s) => want.min(s),
                None => want,
            };
            if n > 0 {
                self.pl_mut(pid).hand.add(r, n as i64);
                out.insert(r.to_string(), n);
            }
        }
        out
    }
    pub fn bump(&mut self, pid: usize, key: &str, n: u32, sub: Option<&str>) {
        let st = match self.S.stats.as_mut() {
            Some(s) => s,
            None => return,
        };
        let p = match st.players.get_mut(pid) {
            Some(p) => p,
            None => return,
        };
        match (key, sub) {
            ("built", Some("road")) => p.built.road += n,
            ("built", Some("ship")) => p.built.ship += n,
            ("built", Some("settlement")) => p.built.settlement += n,
            ("built", Some("city")) => p.built.city += n,
            ("built", Some("dev")) => p.built.dev += n,
            ("produced", Some(r)) => p.produced.add(r, n as i64),
            ("tradesPlayer", _) => p.trades_player += n,
            ("tradesBank", _) => p.trades_bank += n,
            ("stolenFrom", _) => p.stolen_from += n,
            ("stolenBy", _) => p.stolen_by += n,
            ("discarded", _) => p.discarded += n,
            ("robberMoves", _) => p.robber_moves += n,
            ("sevens", _) => p.sevens += n,
            ("discovered", _) => p.discovered += n,
            _ => {}
        }
    }
    pub fn hex_t(&self, k: &str) -> Option<&str> {
        self.S.hexes.get(k).map(|h| h.t.as_str())
    }
    pub fn is_land_hex(&self, k: &str) -> bool {
        self.hex_t(k).map(board::is_land).unwrap_or(false)
    }
    pub fn is_sea_hex(&self, k: &str) -> bool {
        self.hex_t(k) == Some("meer")
    }

    // ---------- Geometrie / Legalität ----------
    pub fn building_at(&self, v: &str) -> Option<&Building> {
        self.S.verts.get(v)
    }
    pub fn vert_touches_land(&self, v: &str) -> bool {
        vert_hexes(v).iter().any(|h| self.is_land_hex(h))
    }
    pub fn distance_ok(&self, v: &str) -> bool {
        !self.S.verts.contains_key(v)
            && geom::vert_neighbors(v).iter().all(|n| !self.S.verts.contains_key(n))
    }
    pub fn edge_hexes_known(&self, e: &str) -> bool {
        geom::edge_hexes(e).iter().all(|h| self.S.hexes.contains_key(h))
    }
    pub fn edge_for(&self, e: &str, kind: &str) -> bool {
        if !self.edge_hexes_known(e) {
            return false;
        }
        let hs = geom::edge_hexes(e);
        if kind == "r" {
            return hs.iter().any(|h| self.is_land_hex(h));
        }
        hs.iter().any(|h| self.is_sea_hex(h))
            && !self.S.pirate.as_ref().map(|p| hs.contains(p)).unwrap_or(false)
    }
    pub fn connected_at(&self, pid: usize, v: &str, kind: &str) -> bool {
        if let Some(b) = self.building_at(v) {
            return b.p == pid;
        }
        geom::vert_edges(v).iter().any(|e| {
            self.S
                .edges
                .get(e)
                .map(|x| x.p == pid && x.k == kind)
                .unwrap_or(false)
        })
    }
    pub fn settlement_spots(&self, pid: usize) -> Vec<String> {
        let S = &self.S;
        let mut out: IndexSet<String> = IndexSet::new();
        if S.phase == "setup" {
            for h in &S.home {
                for v in geom::hex_corners(h) {
                    if self.distance_ok(&v)
                        && self.vert_touches_land(&v)
                        && (S.settings.gold_start || !board::touches_gold(S, &v))
                    {
                        out.insert(v);
                    }
                }
            }
            return out.into_iter().collect();
        }
        for e in S.edges.keys() {
            if S.edges[e].p != pid {
                continue;
            }
            for v in geom::edge_verts(e) {
                if !out.contains(&v) && self.distance_ok(&v) && self.vert_touches_land(&v) {
                    out.insert(v);
                }
            }
        }
        out.into_iter().collect()
    }
    pub fn city_spots(&self, pid: usize) -> Vec<String> {
        self.S
            .verts
            .iter()
            .filter(|(_, b)| b.p == pid && b.k == "s")
            .map(|(v, _)| v.clone())
            .collect()
    }
    pub fn path_spots(&self, pid: usize, kind: &str) -> Vec<String> {
        let S = &self.S;
        let mut out: IndexSet<String> = IndexSet::new();
        let mut starts: IndexSet<String> = IndexSet::new();
        for (v, b) in &S.verts {
            if b.p == pid {
                starts.insert(v.clone());
            }
        }
        for (e, b) in &S.edges {
            if b.p == pid {
                for v in geom::edge_verts(e) {
                    starts.insert(v);
                }
            }
        }
        for v in &starts {
            if !self.connected_at(pid, v, kind) {
                continue;
            }
            for e in geom::vert_edges(v) {
                if !S.edges.contains_key(&e) && self.edge_for(&e, kind) {
                    out.insert(e);
                }
            }
        }
        out.into_iter().collect()
    }
    pub fn setup_path_spots(&self, pid: usize, kind: &str) -> Vec<String> {
        let v = match self.S.setup.as_ref().and_then(|s| s.last.clone()) {
            Some(v) => v,
            None => return Vec::new(),
        };
        geom::vert_edges(&v)
            .into_iter()
            .filter(|e| !self.S.edges.contains_key(e) && self.edge_for(e, kind))
            .collect()
    }
    pub fn ship_moves(&mut self, pid: usize) -> (Vec<String>, IndexMap<String, Vec<String>>) {
        let mut from: Vec<String> = Vec::new();
        let mut to: IndexMap<String, Vec<String>> = IndexMap::new();
        if self.S.ts.moved_ship {
            return (from, to);
        }
        let keys: Vec<String> = self.S.edges.keys().cloned().collect();
        let turn_no = self.S.turn_no;
        for e in keys {
            let x = match self.S.edges.get(&e) {
                Some(x) => x.clone(),
                None => continue,
            };
            if x.p != pid || x.k != "s" || x.t == Some(turn_no) {
                continue;
            }
            if self.S.pirate.as_ref().map(|p| geom::edge_hexes(&e).contains(p)).unwrap_or(false) {
                continue;
            }
            let open = geom::edge_verts(&e).iter().any(|v| {
                if let Some(b) = self.building_at(v) {
                    if b.p == pid {
                        return false;
                    }
                }
                !geom::vert_edges(v).iter().any(|o| {
                    o != &e
                        && self.S.edges.get(o).map(|x| x.p == pid).unwrap_or(false)
                })
            });
            if !open {
                continue;
            }
            self.S.edges.shift_remove(&e);
            let spots: Vec<String> = self
                .path_spots(pid, "s")
                .into_iter()
                .filter(|s| s != &e)
                .collect();
            self.S.edges.insert(e.clone(), x);
            if !spots.is_empty() {
                from.push(e.clone());
                to.insert(e, spots);
            }
        }
        (from, to)
    }
    pub fn rates_for(&self, pid: usize) -> IndexMap<String, u32> {
        let mut r: IndexMap<String, u32> = RES
            .iter()
            .map(|x| (x.to_string(), self.S.settings.bank_rate))
            .collect();
        for (e, h) in &self.S.harbors {
            if !geom::edge_verts(e).iter().any(|v| {
                self.building_at(v).map(|b| b.p == pid).unwrap_or(false)
            }) {
                continue;
            }
            if h.kind == "any" {
                for x in RES {
                    let e = r.get_mut(x).unwrap();
                    *e = (*e).min(3);
                }
            } else if let Some(e) = r.get_mut(&h.kind) {
                *e = (*e).min(2);
            }
        }
        r
    }
    pub fn island_at(&self, v: &str) -> IndexSet<String> {
        match vert_hexes(v).into_iter().find(|x| self.is_land_hex(x)) {
            Some(h) => board::island(&self.S, &h),
            None => IndexSet::new(),
        }
    }

    // ---------- Entdeckung ----------
    pub fn discover_around(&mut self, pid: usize, e: &str, reward: bool) {
        let mut cands: Vec<String> = Vec::new();
        for v in geom::edge_verts(e) {
            for h in geom::vert_hexes(&v) {
                if !self.S.hexes.contains_key(&h) && !cands.contains(&h) {
                    cands.push(h);
                }
            }
        }
        for h in cands {
            if self.S.hexes.contains_key(&h) {
                continue;
            }
            let hex = board::discover(&mut self.S, &h, &mut self.rnd.lock().unwrap());
            if hex.t == "meer" {
                self.log(format!("{} entdeckt offenes Meer.", self.name(pid)), "info", Some(pid));
                continue;
            }
            self.bump(pid, "discovered", 1, None);
            let mut text = format!(
                "{} entdeckt neues Land: {}{}!",
                self.name(pid),
                rules::terrain_de(&hex.t),
                hex.n.map(|n| format!(" ({})", n)).unwrap_or_default()
            );
            if reward && hex.t != "wueste" {
                if hex.t == "gold" {
                    *self.S.pend.gold.entry(pid).or_insert(0) += 1;
                    text.push_str(" Als Belohnung darf ein beliebiger Rohstoff gewählt werden.");
                } else if let Some(r) = terrain_res(&hex.t) {
                    let mut c = IndexMap::new();
                    c.insert(r.to_string(), 1);
                    let out = self.bank_give(pid, &c);
                    if !out.is_empty() {
                        self.fx_single("bank", &format!("p:{}", pid), r, 1, true, "gold");
                        text.push_str(&format!(" Belohnung: 1× {}.", rules::res_de(r)));
                    } else {
                        text.push_str(&format!(" (Die Bank hat kein {} mehr.)", rules::res_de(r)));
                    }
                }
            }
            self.log(text, "build", Some(pid));
        }
    }

    // ---------- Bauen ----------
    pub fn place_settlement(&mut self, pid: usize, v: &str, free: bool) {
        self.S
            .verts
            .insert(v.to_string(), Building { p: pid, k: "s".into(), t: None });
        let isl = self.island_at(v);
        let known = {
            let pl = self.pl(pid);
            isl.iter().any(|h| pl.claimed.contains_key(h))
        };
        let bonus = !free
            && self.pl(pid).island_bonus < self.S.settings.island_bonus_max
            && self.S.settings.island_bonus > 0;
        for h in &isl {
            self.pl_mut(pid).claimed.insert(h.clone(), 1);
        }
        if !known && bonus {
            let n = self.S.settings.island_bonus;
            {
                let pl = self.pl_mut(pid);
                pl.svp += n;
                pl.island_bonus += 1;
            }
            let name = self.name(pid);
            self.log(
                format!("{} gründet die erste Siedlung auf einer neuen Insel: +{} Sonderpunkte!", name, n),
                "award",
                Some(pid),
            );
        }
    }
}

pub const COST_KEYS: [&str; 5] = ["road", "ship", "settlement", "city", "dev"];
