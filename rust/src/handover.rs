// Kontrollübergabe (Handy übernimmt einen Platz) – Portierung von server/handover.js.
use serde_json::{json, Value};

use crate::game::{now_ms, GameError};
use crate::hub::Room;

#[derive(Clone)]
pub struct Request {
    pub pid: usize,
    pub code: String,
    pub token: String,
    pub until: i64,
}

pub fn ttl() -> i64 {
    std::env::var("HANDOVER_MS").ok().and_then(|s| s.trim().parse().ok()).unwrap_or(15_000)
}

fn random_code(existing: &[String]) -> String {
    use std::io::Read;
    loop {
        let mut b = [0u8; 4];
        let ok = std::fs::File::open("/dev/urandom")
            .and_then(|mut f| f.read_exact(&mut b).map(|_| ()))
            .is_ok();
        let n = if ok {
            u32::from_le_bytes(b) as usize
        } else {
            (now_ms() as usize).wrapping_mul(2654435761) & 0xffff
        };
        let code = format!("{}", 1000 + n % 9000);
        if !existing.iter().any(|c| c == &code) {
            return code;
        }
    }
}

/// Ein Zuschauer-Handy fragt einen Platz an. Rückgabe: Anfrage, verdrängte Anfrage, TTL.
pub fn request(
    room: &mut Room,
    token: &str,
    pid: usize,
) -> Result<(Request, Option<Request>, i64), GameError> {
    if !room.watchers.contains_key(token) {
        return Err(GameError("Nur zusehende Geräte können Kontrolle anfragen.".into()));
    }
    let has_players = room.game.S.players.get(pid).is_some();
    if !has_players || !room.game.takeable().contains(&pid) {
        return Err(GameError("Diesen Platz kann ein Handy nicht übernehmen.".into()));
    }
    let keys: Vec<usize> = room
        .handovers
        .iter()
        .filter(|(_, r)| r.token == token)
        .map(|(k, _)| *k)
        .collect();
    for k in keys {
        room.handovers.shift_remove(&k);
    }
    let codes: Vec<String> = room.handovers.values().map(|r| r.code.clone()).collect();
    let code = random_code(&codes);
    let until = now_ms() + ttl();
    let req = Request { pid, code, token: token.to_string(), until };
    let old = room.handovers.get(&pid).cloned();
    room.handovers.insert(pid, req.clone());
    let replaced = old.filter(|o| o.token != token);
    Ok((req, replaced, ttl()))
}

/// Offene Anfragen für den Tisch (Nummer und Restzeit).
pub fn pending(room: &Room) -> Vec<Value> {
    let now = now_ms();
    room.handovers
        .values()
        .filter(|r| r.until > now)
        .map(|r| json!({"pid": r.pid, "code": r.code, "ms": r.until - now}))
        .collect()
}

/// Der Tisch beantwortet die Anfrage für einen Platz. accept: Kontrolle abgeben; sonst ablehnen.
pub fn answer(room: &mut Room, pid: usize, code: &str, accept: bool) -> Result<(Request, bool), GameError> {
    let now = now_ms();
    let r = match room.handovers.get(&pid).cloned() {
        Some(r) if r.until > now => r,
        _ => {
            room.handovers.shift_remove(&pid);
            return Err(GameError(
                "Es liegt keine Kontrollanfrage vor (sie ist abgelaufen).".into(),
            ));
        }
    };
    if code != r.code {
        return Err(GameError("Die Nummer passt nicht zur Anfrage.".into()));
    }
    room.handovers.shift_remove(&pid);
    if !accept {
        return Ok((r, false));
    }
    if !room.game.takeable().contains(&pid) {
        return Err(GameError("Dieser Platz ist nicht mehr übernehmbar.".into()));
    }
    room.game.hand_to(pid, &r.token);
    if pid != room.game.S.host {
        room.absent.insert(r.token.clone(), now);
    }
    room.watchers.shift_remove(&r.token);
    Ok((r, true))
}

/// Das Handy gibt die Kontrolle an den Spieltisch zurück. Rückgabe: Token des Handys/Platzes.
pub fn hand_back(room: &mut Room, pid: usize) -> Result<String, GameError> {
    let p = match room.game.S.players.get(pid) {
        Some(p) if p.handover == Some(true) => p,
        _ => return Err(GameError("Dieser Platz wird nicht von einem Handy gesteuert.".into())),
    };
    let token = if pid == room.game.S.host {
        p.phone.clone()
    } else {
        p.token.clone()
    }
    .unwrap_or_default();
    if !token.is_empty() {
        room.absent.remove(&token);
    }
    room.game.hand_back(pid);
    Ok(token)
}

/// Abgelaufene Anfragen entfernen; Rückgabe: die entfernten.
pub fn expire(room: &mut Room) -> Vec<Request> {
    let now = now_ms();
    let keys: Vec<usize> = room
        .handovers
        .iter()
        .filter(|(_, r)| r.until <= now)
        .map(|(k, _)| *k)
        .collect();
    let mut out = Vec::new();
    for k in keys {
        if let Some(r) = room.handovers.shift_remove(&k) {
            out.push(r);
        }
    }
    out
}
