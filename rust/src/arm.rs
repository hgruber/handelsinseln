// Controller-Ansicht (arm/disarm/pick) – Portierung von server/arm.js. Zustand liegt am Raum, nicht im Spielstand.
use serde_json::{json, Value};

use crate::game::{Game, GameError};
use crate::hub::Room;

pub const MODES: [&str; 6] = ["settlement", "city", "road", "ship", "takeover", "move"];
pub const FORCED: [&str; 4] = ["setup_settlement", "setup_road", "road_building", "robber"];

#[derive(Clone)]
pub struct ArmState {
    pub pid: usize,
    pub mode: Option<String>,
    pub move_from: Option<String>,
    pub sig: String,
}

#[derive(Clone)]
pub struct Target {
    pub t: String,
    pub k: String,
    pub kinds: Vec<String>,
}

fn actor_of(g: &Game) -> usize {
    g.S.sbp.as_ref().and_then(|s| s.pid).unwrap_or(g.S.turn)
}

fn sig_of(g: &Game) -> String {
    format!("{}:{}:{}:{}", g.S.phase, g.step_of(), actor_of(g), g.S.turn_no)
}

fn arr(v: &Value, k: &str) -> Vec<String> {
    v.get(k)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

/// Mögliche Ziele für den Spieler am Zug (wie die Klickziele im Browser).
pub fn targets(g: &mut Game, pid: usize, mode: Option<&str>, move_from: Option<&str>) -> Vec<Target> {
    if actor_of(g) != pid {
        return Vec::new();
    }
    let step = g.step_of();
    let mut out: Vec<Target> = Vec::new();
    let mut add = |t: &str, k: &str, kind: &str, out: &mut Vec<Target>| {
        let id = format!("{}:{}", t, k);
        if let Some(x) = out.iter_mut().find(|x| format!("{}:{}", x.t, x.k) == id) {
            if !x.kinds.iter().any(|z| z == kind) {
                x.kinds.push(kind.to_string());
            }
        } else {
            out.push(Target { t: t.to_string(), k: k.to_string(), kinds: vec![kind.to_string()] });
        }
    };
    let lg = g.legal(Some(pid));
    if step == "setup_settlement" {
        for k in arr(&lg, "settlement") {
            add("v", &k, "settlement", &mut out);
        }
    } else if step == "setup_road" || step == "road_building" {
        for k in arr(&lg, "road") {
            add("e", &k, "road", &mut out);
        }
        for k in arr(&lg, "ship") {
            add("e", &k, "ship", &mut out);
        }
    } else if step == "robber" {
        if g.S.settings.robber == "auto" {
            return Vec::new();
        }
        for k in arr(&lg, "robber") {
            add("h", &k, "robber", &mut out);
        }
        for k in arr(&lg, "pirate") {
            add("h", &k, "pirate", &mut out);
        }
    } else if step == "main" || step == "sbp" {
        if let Some(from) = move_from {
            add("sf", from, "sel", &mut out);
            let to: Vec<String> = lg
                .get("shipTo")
                .and_then(|x| x.get(from))
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            for k in to {
                add("e", &k, "moveto", &mut out);
            }
        } else if mode == Some("takeover") {
            if let Some(t) = lg.get("takeover") {
                for k in arr(t, "edges") {
                    add("e", &k, "takeover", &mut out);
                }
                for k in arr(t, "verts") {
                    add("v", &k, "takeover", &mut out);
                }
            }
        } else if mode == Some("settlement") {
            for k in arr(&lg, "settlement") {
                add("v", &k, "settlement", &mut out);
            }
        } else if mode == Some("city") {
            for k in arr(&lg, "city") {
                add("v", &k, "city", &mut out);
            }
        } else if mode == Some("road") {
            for k in arr(&lg, "road") {
                add("e", &k, "road", &mut out);
            }
        } else if mode == Some("ship") {
            for k in arr(&lg, "ship") {
                add("e", &k, "ship", &mut out);
            }
        } else if mode == Some("move") {
            for k in arr(&lg, "shipFrom") {
                add("sf", &k, "pick", &mut out);
            }
        }
    }
    out
}

fn action_of(g: &Game, arm: &ArmState, t: &str, k: &str, kind: &str) -> Result<Value, GameError> {
    let step = g.step_of();
    if kind == "takeover" {
        return Ok(json!({"type": "take_over", "kind": if t == "e" { "edge" } else { "vert" }, "key": k}));
    }
    if t == "v" {
        let ty = if kind == "city" {
            "build_city"
        } else if step == "setup_settlement" {
            "place_settlement"
        } else {
            "build_settlement"
        };
        return Ok(json!({"type": ty, "v": k}));
    }
    if t == "e" {
        if kind == "moveto" {
            return Ok(json!({"type": "move_ship", "from": arm.move_from, "to": k}));
        }
        let setup = step == "setup_road";
        let ty = if kind == "road" {
            if setup { "place_road" } else { "build_road" }
        } else if setup {
            "place_ship"
        } else {
            "build_ship"
        };
        return Ok(json!({"type": ty, "e": k}));
    }
    if t == "h" {
        return Ok(json!({"type": if kind == "robber" { "move_robber" } else { "move_pirate" }, "hex": k}));
    }
    Err(GameError("Unbekanntes Ziel.".into()))
}

pub fn current(room: &mut Room) -> Option<ArmState> {
    let a = room.arm.clone()?;
    let g = &room.game;
    if a.sig != sig_of(g) || (g.S.phase != "setup" && g.S.phase != "main") {
        room.arm = None;
        return None;
    }
    Some(a)
}

pub fn arm(room: &mut Room, pid: usize, mode: Option<&str>) -> Result<ArmState, GameError> {
    let g = &mut room.game;
    if g.S.phase != "setup" && g.S.phase != "main" {
        return Err(GameError("Das Spiel läuft nicht.".into()));
    }
    if actor_of(g) != pid {
        return Err(GameError("Du bist nicht am Zug.".into()));
    }
    let step = g.step_of();
    let forced = FORCED.contains(&step.as_str());
    if !forced && step != "main" && step != "sbp" {
        return Err(GameError("Jetzt kannst du nichts auf dem Spielfeld wählen.".into()));
    }
    if !forced && !mode.map(|m| MODES.contains(&m)).unwrap_or(false) {
        return Err(GameError("Unbekannte Aktion.".into()));
    }
    let a = ArmState {
        pid,
        mode: if forced { None } else { mode.map(|s| s.to_string()) },
        move_from: None,
        sig: sig_of(g),
    };
    if targets(g, pid, a.mode.as_deref(), a.move_from.as_deref()).is_empty() {
        return Err(GameError("Hier ist gerade nichts möglich.".into()));
    }
    room.arm = Some(a.clone());
    Ok(a)
}

pub fn disarm(room: &mut Room, pid: usize) {
    if let Some(a) = current(room) {
        if a.pid == pid {
            room.arm = None;
        }
    }
}

/// Jemand tippt am Tisch ein Ziel an: Die Freigabe des Spielers gilt als Bestätigung, die Aktion läuft sofort.
pub fn pick(room: &mut Room, t: &str, k: &str, kind: &str) -> Result<(), GameError> {
    let a = match current(room) {
        Some(a) => a,
        None => return Err(GameError("Am Handy ist gerade nichts zum Wählen freigegeben.".into())),
    };
    let ts = targets(&mut room.game, a.pid, a.mode.as_deref(), a.move_from.as_deref());
    let found = ts.iter().any(|x| x.t == t && x.k == k && x.kinds.iter().any(|z| z == kind));
    if !found {
        return Err(GameError("Dieses Ziel ist nicht wählbar.".into()));
    }
    if t == "sf" {
        if let Some(arm) = room.arm.as_mut() {
            arm.move_from = if arm.move_from.as_deref() == Some(k) { None } else { Some(k.to_string()) };
        }
        return Ok(());
    }
    let action = action_of(&room.game, &a, t, k, kind)?;
    room.game.act(a.pid, &action)?;
    room.arm = None;
    Ok(())
}

/// Sicht auf den Arm-Zustand: Zuschauer (Tisch) bekommen die Ziele, alle anderen nur, dass gewählt wird.
pub fn view_for(room: &mut Room, who: Option<usize>) -> Value {
    let a = match current(room) {
        Some(a) => a,
        None => return Value::Null,
    };
    let targets_v = if who.is_none() {
        let ts = targets(&mut room.game, a.pid, a.mode.as_deref(), a.move_from.as_deref());
        json!(ts
            .iter()
            .map(|x| json!({"t": x.t, "k": x.k, "kinds": x.kinds}))
            .collect::<Vec<_>>())
    } else {
        Value::Null
    };
    let step = room.game.step_of();
    let mut o = serde_json::Map::new();
    o.insert("pid".into(), json!(a.pid));
    o.insert("mode".into(), json!(a.mode));
    o.insert("moveFrom".into(), json!(a.move_from));
    o.insert("step".into(), json!(step));
    if who.is_none() {
        o.insert("targets".into(), targets_v);
    }
    Value::Object(o)
}
