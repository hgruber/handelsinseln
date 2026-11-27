// Räume und ihre Verwaltung – Portierung von server/hub.js.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::game::{now_ms, Game, GameError};
use crate::game_lobby::random_hex;
use crate::model::State;
use crate::rng::Rng;

pub struct Watcher {
    pub token: String,
    pub gone: Option<i64>,
}

pub struct Room {
    pub id: String,
    pub game: Game,
    pub absent: HashMap<String, i64>,
    pub empty_since: Option<i64>,
    pub created_at: i64,
    pub watchers: IndexMap<String, Watcher>,
    pub grace_ms: Option<i64>,
    pub last_phase: Option<String>,
    pub removed_why: Option<String>,
    pub arm: Option<crate::arm::ArmState>,
    pub pairs: IndexMap<String, crate::pair::Pairing>,
    /// Seit wann die Partie pausiert ist (ms); nur wenn alle menschlichen Plätze einen Spielerpass haben.
    pub paused_at: Option<i64>,
}

pub struct Hub {
    pub rooms: IndexMap<String, Room>,
    pub counter: u64,
    pub rnd: Arc<Mutex<Rng>>,
    pub grace_ms: i64,
    pub absent_ms: i64,
    pub lobby_absent_ms: i64,
    pub max_games: usize,
    pub max_watchers: usize,
    pub watch_grace_ms: i64,
    /// Wie lange eine pausierte Partie liegen bleibt (Standard: 30 Tage, wie der Spielerpass).
    pub pause_ms: i64,
}

pub struct JoinReq {
    pub token: Option<String>,
    pub game: Option<String>,
    pub create: bool,
    pub name: String,
    pub color: String,
    pub avatar: Option<String>,
}

pub struct JoinOut {
    pub token: String,
    pub pid: usize,
    pub game: String,
    pub again: bool,
}

pub struct WatchOut {
    pub token: String,
    pub game: String,
}

pub struct HubError {
    pub msg: String,
    pub games: Option<Vec<Value>>,
}

impl From<GameError> for HubError {
    fn from(e: GameError) -> Self {
        HubError { msg: e.0, games: None }
    }
}

impl Hub {
    pub fn new(rnd: Arc<Mutex<Rng>>) -> Self {
        Hub {
            rooms: IndexMap::new(),
            counter: 0,
            rnd,
            grace_ms: env_i64("GRACE_MS", 20_000),
            absent_ms: env_i64("ABSENT_MS", 60_000),
            lobby_absent_ms: 120_000,
            max_games: env_usize("MAX_GAMES", 3),
            max_watchers: 8,
            watch_grace_ms: 60_000,
            pause_ms: env_i64("PAUSE_MS", 30 * 24 * 60 * 60 * 1000),
        }
    }

    pub fn new_room(&mut self) -> String {
        let id = random_hex(4);
        let name = format!("Spiel {}", {
            self.counter += 1;
            self.counter
        });
        let game = Game::new(self.rnd.clone(), &id, &name);
        let now = now_ms();
        self.rooms.insert(
            id.clone(),
            Room {
                id: id.clone(),
                game,
                absent: HashMap::new(),
                empty_since: Some(now),
                created_at: now,
                watchers: IndexMap::new(),
                grace_ms: None,
                last_phase: None,
                removed_why: None,
                arm: None,
                pairs: IndexMap::new(),
                paused_at: None,
            },
        );
        id
    }

    pub fn remove_room(&mut self, id: &str) -> Option<Room> {
        self.rooms.shift_remove(id)
    }

    pub fn find_by_token(&self, token: &str) -> Option<(String, usize)> {
        for room in self.rooms.values() {
            if let Some(p) = room.game.S.players.iter().find(|x| x.token.as_deref() == Some(token)) {
                return Some((room.id.clone(), p.id));
            }
        }
        None
    }

    /// Raum, in dem ein Kopplungsangebot (Nonce) hängt.
    pub fn find_pair(&self, nonce: &str) -> Option<String> {
        for room in self.rooms.values() {
            if room.pairs.contains_key(nonce) {
                return Some(room.id.clone());
            }
        }
        None
    }

    pub fn find_watcher(&self, token: &str) -> Option<String> {
        for room in self.rooms.values() {
            if room.watchers.contains_key(token) {
                return Some(room.id.clone());
            }
        }
        None
    }

    pub fn summary(&self, room: &Room) -> Value {
        let S = &room.game.S;
        let host_name = S
            .players
            .get(S.host)
            .map(|p| p.name.clone())
            .or_else(|| S.players.first().map(|p| p.name.clone()))
            .unwrap_or_default();
        let name = if !S.players.is_empty() {
            format!("Spiel von {}", host_name)
        } else {
            room.game.meta_name.clone()
        };
        let players: Vec<Value> = S
            .players
            .iter()
            .filter(|p| !p.left)
            .map(|p| json!({"name": &p.name, "color": &p.color, "avatar": &p.avatar, "bot": &p.bot}))
            .collect();
        json!({
            "id": room.id,
            "name": name,
            "host": S.players.get(S.host).map(|p| p.name.clone()).unwrap_or_default(),
            "phase": &S.phase,
            "closed": S.closed,
            "variant": &S.settings.variant,
            "plannedPlayers": S.settings.planned_players,
            "maxPlayers": 6,
            "players": players,
            "table": S.settings.table,
            "joinable": S.phase == "lobby" && !S.closed && S.players.len() < 6,
            "watchable": S.phase == "setup" || S.phase == "main",
        })
    }

    pub fn list(&self) -> Vec<Value> {
        self.rooms
            .values()
            .filter(|r| r.paused_at.is_none())
            .map(|r| self.summary(r))
            .collect()
    }

    pub fn join(&mut self, b: JoinReq) -> Result<JoinOut, HubError> {
        if let Some(tok) = &b.token {
            if let Some((room_id, pid)) = self.find_by_token(tok) {
                return Ok(JoinOut { token: tok.clone(), pid, game: room_id, again: true });
            }
        }
        let mut room_id = match &b.game {
            Some(g) => {
                if !self.rooms.contains_key(g) {
                    return Err(HubError { msg: "Dieses Spiel gibt es nicht mehr.".into(), games: None });
                }
                Some(g.clone())
            }
            None if b.create => None,
            None => {
                let j: Vec<Value> = self
                    .rooms
                    .values()
                    .filter(|r| {
                        let S = &r.game.S;
                        r.paused_at.is_none() && S.phase == "lobby" && !S.closed && S.players.len() < 6
                    })
                    .map(|r| self.summary(r))
                    .collect();
                if j.len() == 1 {
                    Some(j[0].get("id").and_then(|v| v.as_str()).unwrap_or("").to_string())
                } else if j.len() > 1 {
                    return Err(HubError {
                        msg: "Bitte wähle ein Spiel, dem du beitreten möchtest.".into(),
                        games: Some(j),
                    });
                } else {
                    None
                }
            }
        };
        let fresh = room_id.is_none();
        if fresh {
            if self.rooms.len() >= self.max_games {
                return Err(HubError {
                    msg: format!(
                        "Es laufen schon {} Spiele – bitte warte, bis eines endet, oder tritt einem bei.",
                        self.max_games
                    ),
                    games: None,
                });
            }
            room_id = Some(self.new_room());
        }
        let id = room_id.unwrap();
        let joined = {
            let room = self.rooms.get_mut(&id).unwrap();
            room.game.join(&b.name, &b.color, None, b.avatar.as_deref())
        };
        match joined {
            Ok((token, pid)) => {
                if let Some(room) = self.rooms.get_mut(&id) {
                    room.empty_since = Some(now_ms());
                }
                Ok(JoinOut { token, pid, game: id, again: false })
            }
            Err(e) => {
                if fresh {
                    self.rooms.shift_remove(&id);
                }
                Err(e.into())
            }
        }
    }

    pub fn watch(&mut self, game: &str) -> Result<WatchOut, HubError> {
        let room = match self.rooms.get_mut(game) {
            Some(r) => r,
            None => return Err(HubError { msg: "Dieses Spiel gibt es nicht mehr.".into(), games: None }),
        };
        let ph = room.game.S.phase.clone();
        if ph != "setup" && ph != "main" {
            return Err(HubError {
                msg: "Dieses Spiel läuft gerade nicht – zuschauen ist nur bei laufenden Spielen möglich.".into(),
                games: None,
            });
        }
        if room.watchers.len() >= self.max_watchers {
            return Err(HubError { msg: format!("Es sehen schon {} Zuschauer zu.", self.max_watchers), games: None });
        }
        let token = random_hex(16);
        room.watchers.insert(
            token.clone(),
            Watcher { token: token.clone(), gone: Some(now_ms()) },
        );
        Ok(WatchOut { token, game: room.id.clone() })
    }

    pub fn connect_player(&mut self, room_id: &str, pid: usize) {
        if let Some(room) = self.rooms.get_mut(room_id) {
            if let Some(p) = room.game.S.players.get(pid) {
                if let Some(tok) = p.token.clone() {
                    room.absent.remove(&tok);
                }
            }
            room.game.set_connected(pid, true);
            room.empty_since = None;
            room.paused_at = None; // jemand ist zurück: weiter geht es
        }
    }

    pub fn disconnect_player(&mut self, room_id: &str, pid: usize) {
        let now = now_ms();
        if let Some(room) = self.rooms.get_mut(room_id) {
            if let Some(p) = room.game.S.players.get(pid) {
                if let Some(tok) = p.token.clone() {
                    room.absent.insert(tok, now);
                }
            }
            room.game.set_connected(pid, false);
            let any_connected = room
                .game
                .S
                .players
                .iter()
                .any(|p| !p.left && p.connected);
            if !any_connected {
                room.empty_since = Some(now);
            }
        }
    }

    /// Regelmäßige Pflege: geänderte Räume und zu entfernende (Aufrufer meldet/entfernt sie).
    pub fn tick(&mut self) -> (Vec<String>, Vec<String>) {
        let t = now_ms();
        let mut changed = Vec::new();
        for room in self.rooms.values_mut() {
            let gone: Vec<String> = room
                .watchers
                .iter()
                .filter(|(_, w)| w.gone.is_some() && t - w.gone.unwrap_or(t) > self.watch_grace_ms)
                .map(|(k, _)| k.clone())
                .collect();
            for k in gone {
                room.watchers.shift_remove(&k);
            }
        }
        let mut remove = Vec::new();
        for room in self.rooms.values_mut() {
            // Pausierte Partien ruhen; nur nach Ablauf der Frist wird aufgeräumt.
            if let Some(since) = room.paused_at {
                if t - since >= self.pause_ms {
                    room.removed_why = Some("Pause abgelaufen".into());
                    remove.push(room.id.clone());
                }
                continue;
            }
            let phase = room.game.S.phase.clone();
            if phase == "lobby" {
                let players = room.game.S.players.clone();
                for p in players {
                    let tok = match p.token.clone() {
                        Some(t) => t,
                        None => continue,
                    };
                    let since = room.absent.get(&tok).copied();
                    if !p.connected
                        && since.map(|s| t - s > self.lobby_absent_ms).unwrap_or(false)
                        && room.game.S.players.len() > 1
                    {
                        room.game.leave(&tok);
                        room.absent.remove(&tok);
                        if !changed.contains(&room.id) {
                            changed.push(room.id.clone());
                        }
                    }
                }
            } else if phase != "ended" {
                let ids: Vec<usize> = room.game.S.players.iter().map(|p| p.id).collect();
                for pid in ids {
                    let (left, connected, auto, tok) = {
                        let p = &room.game.S.players[pid];
                        (p.left, p.connected, p.auto, p.token.clone())
                    };
                    let since = tok.as_ref().and_then(|x| room.absent.get(x).copied());
                    if !left
                        && !connected
                        && !auto
                        && since.map(|s| t - s >= self.absent_ms).unwrap_or(false)
                    {
                        if room.game.set_absent_auto(pid, true) && !changed.contains(&room.id) {
                            changed.push(room.id.clone());
                        }
                    }
                }
            }
            let connected_humans = room
                .game
                .S
                .players
                .iter()
                .filter(|p| !p.left && p.bot.is_none() && !p.is_table_guest() && p.connected)
                .count();
            let humans = room.game.humans().len();
            if humans == 0 {
                // Mit Spielerpass für alle Menschen bleibt die Partie als Pause stehen.
                if darf_pausieren(room) {
                    room.paused_at = Some(t);
                    room.empty_since = None;
                } else {
                    remove.push(room.id.clone());
                }
                continue;
            }
            if connected_humans > 0 {
                room.empty_since = None;
            } else {
                if room.empty_since.is_none() {
                    room.empty_since = Some(t);
                }
                let grace = room.grace_ms.unwrap_or(self.grace_ms);
                if t - room.empty_since.unwrap_or(t) >= grace {
                    if darf_pausieren(room) {
                        room.paused_at = Some(t);
                        room.empty_since = None;
                    } else {
                        remove.push(room.id.clone());
                    }
                }
            }
        }
        (changed, remove)
    }

    pub fn to_json(&self) -> Value {
        let rooms: Vec<Value> = self
            .rooms
            .values()
            .map(|r| {
                json!({
                    "id": r.id,
                    "meta": {"id": r.game.meta_id, "name": r.game.meta_name},
                    "S": &r.game.S,
                    "pausedAt": r.paused_at,
                })
            })
            .collect();
        json!({"counter": self.counter, "rooms": rooms})
    }

    pub fn load(&mut self, data: &Value, load_grace_ms: i64) {
        self.counter = data.get("counter").and_then(|v| v.as_u64()).unwrap_or(0);
        let rooms = match data.get("rooms").and_then(|v| v.as_array()) {
            Some(r) => r.clone(),
            None => return,
        };
        for r in rooms {
            let S = match r.get("S") {
                Some(s) => s,
                None => continue,
            };
            if S.get("settings").is_none() {
                continue;
            }
            let state: State = match serde_json::from_value(S.clone()) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let paused_at = r.get("pausedAt").and_then(|v| v.as_i64());
            let meta = r.get("meta").cloned().unwrap_or(Value::Null);
            let mid = meta.get("id").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
            let mname = meta.get("name").and_then(|v| v.as_str()).unwrap_or("Spiel").to_string();
            let mut state = state;
            for p in state.players.iter_mut() {
                p.connected = p.bot.is_some() || p.is_table_guest();
            }
            let game = Game::from_state(state, self.rnd.clone(), &mid, &mname);
            let now = now_ms();
            let absent: HashMap<String, i64> = game
                .S
                .players
                .iter()
                .filter(|p| p.bot.is_none() && !p.is_table_guest())
                .filter_map(|p| p.token.clone().map(|t| (t, now)))
                .collect();
            self.rooms.insert(
                id.clone(),
                Room {
                    id,
                    game,
                    absent,
                    empty_since: Some(now),
                    created_at: now,
                    watchers: IndexMap::new(),
                    grace_ms: Some(load_grace_ms),
                    last_phase: None,
                    removed_why: None,
                    arm: None,
                    pairs: IndexMap::new(),
                    paused_at,
                },
            );
        }
    }
}

/// Eine laufende Partie darf pausieren, wenn alle menschlichen Plätze einen Spielerpass haben –
/// nur dann kann jeder später zurückkehren. Bots und Tischspieler zählen nicht.
pub fn darf_pausieren(room: &Room) -> bool {
    let ph = room.game.S.phase.as_str();
    (ph == "setup" || ph == "main") && room.game.all_humans_have_pass()
}

fn env_i64(name: &str, def: i64) -> i64 {
    std::env::var(name).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(def)
}

fn env_usize(name: &str, def: usize) -> usize {
    std::env::var(name).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(def)
}
