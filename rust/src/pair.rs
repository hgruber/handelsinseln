// Gerätekopplung per Nonce – ein Gerät zeigt an, ein Gerät löst ein.
// Der Nonce steht im QR-Code, der secret bleibt beim anzeigenden Gerät (für check).
// Ein Angebot hängt am Room, liegt nicht in S und wird nicht gespeichert.
use serde_json::{json, Value};

use crate::game::{now_ms, GameError};
use crate::game_lobby::random_hex;
use crate::hub::Room;

#[derive(Clone, Debug)]
pub struct Pairing {
    pub nonce: String,
    pub secret: String,
    pub pid: Option<usize>,
    pub until: i64,
    pub claimed: bool,
}

pub fn ttl() -> i64 {
    std::env::var("PAIR_MS")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(60_000)
}

/// Abgelaufene Angebote entfernen.
pub fn sweep(room: &mut Room) {
    let now = now_ms();
    let gone: Vec<String> = room
        .pairs
        .iter()
        .filter(|(_, p)| p.until <= now)
        .map(|(k, _)| k.clone())
        .collect();
    for k in gone {
        room.pairs.shift_remove(&k);
    }
}

/// Ein Angebot anlegen. pid: der Platz, dessen Token übertragen wird (None = offen).
pub fn offer(room: &mut Room, pid: Option<usize>) -> Pairing {
    sweep(room);
    let nonce = loop {
        let n = random_hex(16);
        if !room.pairs.contains_key(&n) {
            break n;
        }
    };
    let p = Pairing {
        nonce: nonce.clone(),
        secret: random_hex(16),
        pid,
        until: now_ms() + ttl(),
        claimed: false,
    };
    room.pairs.insert(nonce, p.clone());
    p
}

/// Angebot über den Nonce aus dem QR-Code finden.
pub fn find<'a>(room: &'a Room, nonce: &str) -> Option<&'a Pairing> {
    room.pairs.get(nonce)
}

pub enum Claim {
    /// Das anzeigende Gerät bekommt den Token des Platzes.
    Receiver { token: String, pid: usize },
    /// Das einlösende Gerät hatte die Sitzung; das Angebot ist jetzt an seinen Platz gebunden.
    Giver { pid: usize },
}

/// Ein Angebot einlösen. claimant: Platz des einlösenden Geräts, falls es eine Sitzung hat.
pub fn claim(room: &mut Room, key: &str, claimant: Option<usize>) -> Result<Claim, GameError> {
    sweep(room);
    let nonce = find(room, key)
        .map(|p| p.nonce.clone())
        .ok_or_else(|| GameError("Dieses Angebot gibt es nicht oder es ist abgelaufen.".into()))?;
    let p = room.pairs.get(&nonce).unwrap().clone();
    if p.claimed {
        return Err(GameError("Dieses Angebot wurde schon verwendet.".into()));
    }
    let result = match (p.pid, claimant) {
        // Das anzeigende Gerät hat die Sitzung, das einlösende nicht.
        (Some(pid), None) => Claim::Receiver { token: take_token(room, pid)?, pid },
        // Das einlösende Gerät hat die Sitzung, das Angebot war offen.
        (None, Some(pid)) => {
            let x = room.pairs.get_mut(&nonce).unwrap();
            x.pid = Some(pid);
            Claim::Giver { pid }
        }
        // Beide Geräte gehören schon zum selben Platz.
        (Some(a), Some(b)) if a == b => Claim::Receiver { token: take_token(room, a)?, pid: a },
        (Some(_), Some(_)) => {
            return Err(GameError("Dieses Angebot gehört zu einem anderen Platz.".into()))
        }
        (None, None) => {
            return Err(GameError("Nur ein Gerät mit Sitzung kann dieses Angebot einlösen.".into()))
        }
    };
    room.pairs.get_mut(&nonce).unwrap().claimed = true;
    Ok(result)
}

/// Token eines Platzes; ein Platz ohne Sitzung (Bot) bekommt beim Koppeln eine und hört auf, Bot zu sein.
pub(crate) fn take_token(room: &mut Room, pid: usize) -> Result<String, GameError> {
    let existing = room
        .game
        .S
        .players
        .get(pid)
        .and_then(|x| x.token.clone())
        .filter(|t| !t.is_empty());
    if let Some(t) = existing {
        return Ok(t);
    }
    let p = room
        .game
        .S
        .players
        .get_mut(pid)
        .ok_or_else(|| GameError("Diesen Platz gibt es nicht.".into()))?;
    if p.left {
        return Err(GameError("Dieser Platz ist verlassen.".into()));
    }
    let t = random_hex(16);
    p.token = Some(t.clone());
    if p.bot.is_some() {
        p.bot = None;
        p.auto = false;
    }
    Ok(t)
}

/// Status für das anzeigende Gerät. Nur mit dem passenden secret.
pub fn check(room: &Room, nonce: &str, secret: &str) -> Option<Value> {
    let p = room.pairs.get(nonce)?;
    if p.secret != secret {
        return None;
    }
    let now = now_ms();
    if p.until <= now {
        return Some(json!({"claimed": false, "expired": true}));
    }
    if !p.claimed {
        return Some(json!({"claimed": false}));
    }
    let pid = p.pid.unwrap_or(0);
    let token = room.game.S.players.get(pid).and_then(|x| x.token.clone());
    Some(json!({"claimed": true, "pid": pid, "token": token}))
}
