// Zustandsmodell des Spiels (reines JSON, speicherbar) – Form wie in server/game.js.
use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::settings::Settings;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Hand {
    pub holz: u32,
    pub lehm: u32,
    pub wolle: u32,
    pub getreide: u32,
    pub erz: u32,
}

impl Hand {
    pub fn get(&self, r: &str) -> u32 {
        match r {
            "holz" => self.holz,
            "lehm" => self.lehm,
            "wolle" => self.wolle,
            "getreide" => self.getreide,
            "erz" => self.erz,
            _ => 0,
        }
    }

    pub fn set(&mut self, r: &str, n: u32) {
        match r {
            "holz" => self.holz = n,
            "lehm" => self.lehm = n,
            "wolle" => self.wolle = n,
            "getreide" => self.getreide = n,
            "erz" => self.erz = n,
            _ => {}
        }
    }

    pub fn add(&mut self, r: &str, n: i64) {
        let v = self.get(r) as i64 + n;
        self.set(r, v.max(0) as u32);
    }

    pub fn sum(&self) -> u32 {
        self.holz + self.lehm + self.wolle + self.getreide + self.erz
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevCard {
    pub id: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub bought: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct BotMemory {
    pub turn: u64,
    pub bank: u32,
    pub offers: u32,
    pub offer_at: i64,
    pub tried: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Player {
    pub id: usize,
    pub name: String,
    pub color: String,
    pub avatar: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub token: Option<String>,
    pub connected: bool,
    pub hand: Hand,
    pub dev: Vec<DevCard>,
    pub claimed: IndexMap<String, u32>,
    pub knights: u32,
    pub svp: u32,
    #[serde(rename = "islandBonus")]
    pub island_bonus: u32,
    pub auto: bool,
    pub left: bool,
    #[serde(rename = "autoTurns")]
    pub auto_turns: u32,
    pub vanished: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub seat: Option<String>,
    #[serde(rename = "tableGuest", skip_serializing_if = "Option::is_none", default)]
    pub table_guest: Option<bool>,
    /// Nimmt am angebotenen Spieltisch teil (eigenes Gerät bleibt die Steuerung).
    #[serde(rename = "amTisch", skip_serializing_if = "Option::is_none", default)]
    pub am_tisch: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bm: Option<BotMemory>,
    /// Pseudonyme der Personen (HMAC aus dem Spielerpass und der serverId). Mehrere Geräte
    /// desselben Platzes können verschiedene Pässe haben; jeder darf die Partie wiederfinden.
    #[serde(rename = "personIds", skip_serializing_if = "Vec::is_empty", default)]
    pub person_ids: Vec<String>,
    /// Alte Ablage aus 1.1.0 (eine Personen-ID); bleibt lesbar, neue Verknüpfungen stehen in `person_ids`.
    #[serde(rename = "personId", skip_serializing_if = "Option::is_none", default)]
    pub person_id: Option<String>,
}

impl Player {
    pub fn is_table_guest(&self) -> bool {
        self.table_guest.unwrap_or(false)
    }
    /// Gehört der Platz zu dieser Personen-ID?
    pub fn person_hat(&self, id: &str) -> bool {
        self.person_ids.iter().any(|x| x == id) || self.person_id.as_deref() == Some(id)
    }
    /// Weitere Personen-ID am Platz vermerken (etwa ein zweites Gerät mit eigenem Pass).
    /// Höchstens acht Geräte je Platz, damit die Liste nicht unbegrenzt wächst.
    pub fn person_verknuepfen(&mut self, id: &str) {
        if !self.person_hat(id) && self.person_ids.len() < 8 {
            self.person_ids.push(id.to_string());
        }
    }
    /// Sitzt an diesem Platz ein abgelaufener Pass?
    pub fn person_verloren(&self, abgelaufen: &[String]) -> bool {
        let treffer = |x: &str| abgelaufen.iter().any(|e| e == x);
        self.person_ids.iter().any(|x| treffer(x))
            || self.person_id.as_deref().map(treffer).unwrap_or(false)
    }
    /// Abgelaufene Personen-IDs von diesem Platz lösen.
    pub fn personen_aufraeumen(&mut self, abgelaufen: &[String]) {
        let treffer = |x: &str| abgelaufen.iter().any(|e| e == x);
        self.person_ids.retain(|x| !treffer(x));
        if self.person_id.as_deref().map(treffer).unwrap_or(false) {
            self.person_id = None;
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Hex {
    pub t: String,
    pub n: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Harbor {
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Building {
    pub p: usize,
    pub k: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub t: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Fx {
    pub id: u64,
    pub f: String,
    pub t: String,
    pub c: IndexMap<String, u32>,
    pub n: u32,
    #[serde(rename = "pub")]
    pub pub_: bool,
    pub why: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: u64,
    pub p: Option<usize>,
    pub text: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatEntry {
    pub id: u64,
    pub p: usize,
    pub text: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnState {
    pub rolled: bool,
    #[serde(rename = "movedShip")]
    pub moved_ship: bool,
    #[serde(rename = "devPlayed")]
    pub dev_played: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sub: Option<String>,
    pub rb: u32,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub victims: Vec<usize>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Pending {
    pub discard: BTreeMap<usize, u32>,
    pub gold: BTreeMap<usize, u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TradeResponse {
    pub s: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub give: Option<IndexMap<String, u32>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub want: Option<IndexMap<String, u32>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Trade {
    pub id: u64,
    pub from: usize,
    pub give: IndexMap<String, u32>,
    pub want: IndexMap<String, u32>,
    pub responses: BTreeMap<usize, TradeResponse>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct OrderRoll {
    pub table: bool,
    pub groups: Vec<Vec<usize>>,
    pub cur: Vec<usize>,
    pub rolled: BTreeMap<usize, u32>,
    pub idx: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Setup {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub seq: Option<Vec<usize>>,
    pub i: usize,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ask: Option<Vec<usize>>,
    #[serde(rename = "askIdx", skip_serializing_if = "Option::is_none", default)]
    pub ask_idx: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ord: Option<OrderRoll>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Sbp {
    pub queue: Vec<usize>,
    pub pid: Option<usize>,
    pub after: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Built {
    pub road: u32,
    pub ship: u32,
    pub settlement: u32,
    pub city: u32,
    pub dev: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub built: Built,
    pub produced: Hand,
    pub trades_player: u32,
    pub trades_bank: u32,
    pub stolen_from: u32,
    pub stolen_by: u32,
    pub discarded: u32,
    pub robber_moves: u32,
    pub sevens: u32,
    pub discovered: u32,
    pub max_route: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub round: u32,
    pub vp: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub rolls: BTreeMap<u32, u32>,
    pub history: Vec<HistoryEntry>,
    pub players: Vec<PlayerStats>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Supply {
    pub terrain: IndexMap<String, Option<u32>>,
    pub chips: IndexMap<String, Option<u32>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DevShown {
    pub id: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub by: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrderShown {
    pub id: u64,
    pub order: Vec<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct State {
    pub v: u64,
    pub fx: Vec<Fx>,
    #[serde(rename = "fxId")]
    pub fx_id: u64,
    pub phase: String,
    pub players: Vec<Player>,
    pub settings: Settings,
    pub closed: bool,
    #[serde(rename = "endedBy")]
    pub ended_by: Option<String>,
    pub aborted: bool,
    pub stats: Option<Stats>,
    pub supply: Option<Supply>,
    #[serde(rename = "fogGold")]
    pub fog_gold: f64,
    pub host: usize,
    pub log: Vec<LogEntry>,
    pub chat: Vec<ChatEntry>,
    #[serde(rename = "logId")]
    pub log_id: u64,
    pub seq: u64,
    pub hexes: IndexMap<String, Hex>,
    pub harbors: IndexMap<String, Harbor>,
    pub verts: IndexMap<String, Building>,
    pub edges: IndexMap<String, Building>,
    pub robber: Option<String>,
    pub pirate: Option<String>,
    pub home: Vec<String>,
    pub order: Vec<usize>,
    pub turn: usize,
    #[serde(rename = "turnNo")]
    pub turn_no: u64,
    pub ts: TurnState,
    pub pend: Pending,
    pub trade: Option<Trade>,
    pub dice: Option<(u32, u32)>,
    #[serde(rename = "diceSeq")]
    pub dice_seq: u64,
    pub deck: Vec<String>,
    pub setup: Option<Setup>,
    pub sbp: Option<Sbp>,
    pub winner: Option<usize>,
    pub longest: Option<usize>,
    pub largest: Option<usize>,
    #[serde(rename = "tradeSeq")]
    pub trade_seq: u64,
    #[serde(rename = "goldRate", skip_serializing_if = "Option::is_none", default)]
    pub gold_rate: Option<u32>,
    #[serde(rename = "devShown", skip_serializing_if = "Option::is_none", default)]
    pub dev_shown: Option<DevShown>,
    #[serde(rename = "orderSeq", skip_serializing_if = "Option::is_none", default)]
    pub order_seq: Option<u64>,
    #[serde(rename = "orderShown", skip_serializing_if = "Option::is_none", default)]
    pub order_shown: Option<OrderShown>,
    #[serde(rename = "endedFrom", skip_serializing_if = "Option::is_none", default)]
    pub ended_from: Option<String>,
    #[serde(rename = "numBag", default)]
    pub num_bag: Vec<u32>,
    #[serde(rename = "landBag", default)]
    pub land_bag: Vec<String>,
    #[serde(rename = "harborKinds", skip_serializing_if = "Option::is_none", default)]
    pub harbor_kinds: Option<Vec<String>>,
}

impl State {
    /// Leerer Zustand in der Form von Game#reset (ohne Spieler und ohne Vorschau-Brett).
    pub fn empty(settings: Settings) -> Self {
        State {
            v: 0,
            fx: Vec::new(),
            fx_id: 0,
            phase: "lobby".to_string(),
            players: Vec::new(),
            settings,
            closed: false,
            ended_by: None,
            aborted: false,
            stats: None,
            supply: None,
            fog_gold: 1.0,
            host: 0,
            log: Vec::new(),
            chat: Vec::new(),
            log_id: 0,
            seq: 0,
            hexes: IndexMap::new(),
            harbors: IndexMap::new(),
            verts: IndexMap::new(),
            edges: IndexMap::new(),
            robber: None,
            pirate: None,
            home: Vec::new(),
            order: Vec::new(),
            turn: 0,
            turn_no: 0,
            ts: TurnState::default(),
            pend: Pending::default(),
            trade: None,
            dice: None,
            dice_seq: 0,
            deck: Vec::new(),
            setup: None,
            sbp: None,
            winner: None,
            longest: None,
            largest: None,
            trade_seq: 0,
            gold_rate: None,
            dev_shown: None,
            order_seq: None,
            order_shown: None,
            ended_from: None,
            num_bag: Vec::new(),
            land_bag: Vec::new(),
            harbor_kinds: None,
        }
    }
}
