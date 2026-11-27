// Spieltisch anbieten – Angebot am Raum (nicht gespeichert) und Platzverteilung.
// Der Spielleiter bietet an, die anderen Menschen nehmen an und wählen ihren Platz. Bei fester
// Zugreihenfolge muss die Sitzordnung im Uhrzeigersinn dazu passen; sonst werden die betroffenen
// Spieler erneut gefragt. Zustand wie `arm`/`pairs` im Raum, nicht im Spielstand.
use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::game::{now_ms, GameError};
use crate::game_lobby::{SEAT_CLOCK, SEATS};
use crate::hub::Room;
use crate::model::Player;

const OFFER_MS_DEFAULT: i64 = 60_000;

#[derive(Clone, Debug)]
pub enum Answer {
    Declined,
    Accepted { seat: Option<String> },
}

#[derive(Clone, Debug)]
pub struct TableOffer {
    pub id: u64,
    pub phase: String,
    pub host: usize,
    pub invited: Vec<usize>,
    pub answers: BTreeMap<usize, Answer>,
    pub host_seat: Option<String>,
    /// Spieler, die ihren Platz erneut wählen müssen (Wunsch war mit der Reihenfolge unvereinbar).
    pub reask: BTreeSet<usize>,
    pub until: i64,
    /// Mitglieder-Signatur beim Anlegen; ändert sich der Raum, verfällt das Angebot.
    members: Vec<String>,
}

pub struct Placement {
    pub seats: BTreeMap<usize, String>,
    pub kept: BTreeSet<usize>,
    pub unsatisfied: BTreeSet<usize>,
}

fn offer_ms() -> i64 {
    std::env::var("TABLE_OFFER_MS")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(OFFER_MS_DEFAULT)
}

fn human(p: &Player) -> bool {
    p.bot.is_none() && !p.is_table_guest() && !p.left
}

fn members_sig(room: &Room) -> Vec<String> {
    room.game
        .S
        .players
        .iter()
        .map(|p| {
            format!(
                "{}|{}|{}|{}",
                p.id,
                p.bot.is_some(),
                p.is_table_guest(),
                p.left
            )
        })
        .collect()
}

fn no_offer() -> GameError {
    GameError("Es läuft gerade kein Spieltisch-Angebot.".into())
}

fn check_id(off: &TableOffer, id: Option<u64>) -> Result<(), GameError> {
    if let Some(x) = id {
        if x != off.id {
            return Err(no_offer());
        }
    }
    Ok(())
}

/// Alle bereits gewählten Plätze (Host und angenommene Spieler).
fn chosen(off: &TableOffer) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    if let Some(s) = &off.host_seat {
        out.push((off.host, s.clone()));
    }
    for (pid, a) in &off.answers {
        if let Answer::Accepted { seat: Some(s) } = a {
            out.push((*pid, s.clone()));
        }
    }
    out
}

fn anchors(off: &TableOffer, without: Option<usize>) -> BTreeMap<usize, String> {
    chosen(off)
        .into_iter()
        .filter(|(pid, _)| Some(*pid) != without)
        .collect()
}

/// Reihenfolge der Spieler, ergänzt um alle, die in `S.order` fehlen.
pub fn normalized_order(order: &[usize], players: &[Player]) -> Vec<usize> {
    let mut out = Vec::new();
    for id in order {
        if *id < players.len() && !out.contains(id) {
            out.push(*id);
        }
    }
    for p in players {
        if !out.contains(&p.id) {
            out.push(p.id);
        }
    }
    out
}

/// Vollständige, reihenfolgetreue Sitzverteilung. `order` bestimmt die zyklische Reihenfolge,
/// `anchors` sind bereits gewählte Plätze (pid → Platz). Maximal viele Anker bleiben erhalten.
pub fn place(order: &[usize], anchors: &BTreeMap<usize, String>) -> Placement {
    let n = order.len();
    let m = SEAT_CLOCK.len();
    let empty = || Placement {
        seats: BTreeMap::new(),
        kept: BTreeSet::new(),
        unsatisfied: anchors.keys().copied().collect(),
    };
    if n == 0 || n > m || order.iter().collect::<BTreeSet<_>>().len() != n {
        return empty();
    }
    let mut best: Option<(usize, BTreeMap<usize, String>, BTreeSet<usize>)> = None;
    for mask in 0u32..(1u32 << m) {
        if mask.count_ones() as usize != n {
            continue;
        }
        let seats: Vec<&str> = (0..m)
            .filter(|i| mask & (1u32 << i) != 0)
            .map(|i| SEAT_CLOCK[i])
            .collect();
        for rot in 0..n {
            let mut map = BTreeMap::new();
            let mut kept = BTreeSet::new();
            for (i, seat) in seats.iter().enumerate() {
                let pid = order[(rot + i) % n];
                if anchors.get(&pid).map(|a| a.as_str() == *seat).unwrap_or(false) {
                    kept.insert(pid);
                }
                map.insert(pid, (*seat).to_string());
            }
            if best.as_ref().map(|(s, _, _)| kept.len() > *s).unwrap_or(true) {
                best = Some((kept.len(), map, kept));
            }
        }
    }
    match best {
        Some((_, seats, kept)) => {
            let unsatisfied = anchors.keys().filter(|p| !kept.contains(p)).copied().collect();
            Placement { seats, kept, unsatisfied }
        }
        None => empty(),
    }
}

/// Plätze, die `pid` wählen kann, ohne die behaltenen Anker unmöglich zu machen.
pub fn allowed_seats(order: &[usize], anchors: &BTreeMap<usize, String>, pid: usize) -> Vec<String> {
    let mut out = Vec::new();
    for s in SEAT_CLOCK {
        let mut a = anchors.clone();
        a.insert(pid, s.to_string());
        if place(order, &a).unsatisfied.is_empty() {
            out.push(s.to_string());
        }
    }
    out
}

fn name(room: &Room, pid: usize) -> String {
    room.game.S.players.get(pid).map(|p| p.name.clone()).unwrap_or_default()
}

fn log(room: &mut Room, text: impl Into<String>) {
    room.game.log(text, "sys", None);
    room.game.S.v += 1;
}

/// Angebot anlegen (nur Spielleiter, Lobby/Aufbau/Hauptphase).
pub fn create(room: &mut Room, pid: usize) -> Result<(), GameError> {
    let (host, phase, table, seat_stage) = {
        let S = &room.game.S;
        (S.host, S.phase.clone(), S.settings.table, room.game.step_of() == "setup_seat")
    };
    if pid != host {
        return Err(GameError("Nur der Spielleiter kann den Spieltisch anbieten.".into()));
    }
    if phase != "lobby" && phase != "setup" && phase != "main" {
        return Err(GameError("Das Spiel ist beendet.".into()));
    }
    if table {
        return Err(GameError("Der digitale Spieltisch ist schon eingerichtet.".into()));
    }
    if room.table_offer.is_some() {
        return Err(GameError("Es läuft schon ein Spieltisch-Angebot.".into()));
    }
    if seat_stage {
        return Err(GameError("Die Sitzordnung wird gerade gewählt.".into()));
    }
    let invited: Vec<usize> = room
        .game
        .S
        .players
        .iter()
        .filter(|p| p.id != pid && human(p))
        .map(|p| p.id)
        .collect();
    if invited.is_empty() {
        return Err(GameError("Es ist kein Mitspieler da, dem man den Spieltisch anbieten könnte.".into()));
    }
    if !room
        .game
        .S
        .players
        .iter()
        .any(|p| invited.contains(&p.id) && p.connected)
    {
        return Err(GameError("Kein Mitspieler ist gerade verbunden – bitte später erneut anbieten.".into()));
    }
    // Sitze aus einer früheren Runde räumen, damit die Wahl eindeutig ist.
    for p in room.game.S.players.iter_mut() {
        p.seat = None;
    }
    let members = members_sig(room);
    room.table_offer = Some(TableOffer {
        id: now_ms() as u64,
        phase,
        host,
        invited,
        answers: BTreeMap::new(),
        host_seat: None,
        reask: BTreeSet::new(),
        until: now_ms() + offer_ms(),
        members,
    });
    log(room, "Der Spielleiter bietet den digitalen Spieltisch an.");
    Ok(())
}

/// Ein eingeladener Spieler antwortet. Nach einer erneuten Platzwahl darf er auch noch ablehnen.
pub fn answer(room: &mut Room, pid: usize, accept: bool, id: Option<u64>) -> Result<(), GameError> {
    {
        let off = room.table_offer.as_ref().ok_or_else(no_offer)?;
        check_id(off, id)?;
        if !off.invited.contains(&pid) {
            return Err(GameError("Du bist zum Spieltisch-Angebot nicht eingeladen.".into()));
        }
        match off.answers.get(&pid) {
            None => {}
            Some(Answer::Accepted { .. }) if accept && off.reask.contains(&pid) => {}
            Some(Answer::Accepted { .. }) => {
                return Err(GameError("Du hast dem Spieltisch schon zugesagt.".into()))
            }
            Some(Answer::Declined) => {
                return Err(GameError("Du hast schon abgelehnt.".into()))
            }
        }
    }
    if let Some(off) = room.table_offer.as_mut() {
        if !accept {
            off.answers.insert(pid, Answer::Declined);
            off.reask.remove(&pid);
        } else if !matches!(off.answers.get(&pid), Some(Answer::Accepted { .. })) {
            off.answers.insert(pid, Answer::Accepted { seat: None });
        }
    }
    advance(room, false);
    Ok(())
}

/// Host oder angenommener Spieler wählt seinen Platz.
pub fn seat(room: &mut Room, pid: usize, seat: &str, id: Option<u64>) -> Result<(), GameError> {
    if !SEATS.contains(&seat) {
        return Err(GameError("Bitte einen Platz am Tisch wählen.".into()));
    }
    {
        let off = room.table_offer.as_ref().ok_or_else(no_offer)?;
        check_id(off, id)?;
        let accepted = matches!(off.answers.get(&pid), Some(Answer::Accepted { .. }));
        if pid != off.host && !accepted {
            return Err(GameError("Du bist beim Spieltisch-Angebot nicht dabei.".into()));
        }
        if let Some((q, _)) = chosen(off).into_iter().find(|(q, s)| *q != pid && s == seat) {
            return Err(GameError(format!("Dieser Platz ist schon von {} belegt.", name(room, q))));
        }
        if off.reask.contains(&pid) && off.phase != "lobby" {
            let order = normalized_order(&room.game.S.order, &room.game.S.players);
            let a = anchors(off, Some(pid));
            if !allowed_seats(&order, &a, pid).iter().any(|s| s == seat) {
                return Err(GameError(
                    "Dieser Platz passt nicht zur Zugreihenfolge. Wähle einen der markierten Plätze.".into(),
                ));
            }
        }
    }
    if let Some(off) = room.table_offer.as_mut() {
        if pid == off.host {
            off.host_seat = Some(seat.to_string());
        } else if let Some(Answer::Accepted { seat: s }) = off.answers.get_mut(&pid) {
            *s = Some(seat.to_string());
        }
        off.reask.remove(&pid);
    }
    advance(room, false);
    Ok(())
}

/// Host zieht das Angebot zurück.
pub fn cancel_by_host(room: &mut Room, pid: usize, id: Option<u64>) -> Result<(), GameError> {
    {
        let off = room.table_offer.as_ref().ok_or_else(no_offer)?;
        check_id(off, id)?;
        if pid != off.host {
            return Err(GameError("Nur der Spielleiter kann das Angebot zurückziehen.".into()));
        }
    }
    cancel(room, "Der Spielleiter hat das Spieltisch-Angebot zurückgezogen.");
    Ok(())
}

fn cancel(room: &mut Room, why: &str) -> bool {
    if room.table_offer.take().is_some() {
        room.arm = None;
        log(room, why);
        true
    } else {
        false
    }
}

/// Wurde der Raum seit dem Anlegen so verändert, dass das Angebot nicht mehr gilt?
pub fn stale(room: &Room) -> bool {
    let off = match &room.table_offer {
        Some(o) => o,
        None => return false,
    };
    let S = &room.game.S;
    if room.paused_at.is_some() {
        return true;
    }
    if S.phase != off.phase || (S.phase != "lobby" && S.phase != "setup" && S.phase != "main") {
        return true;
    }
    if S.settings.table || S.host != off.host {
        return true;
    }
    members_sig(room) != off.members
}

pub fn cancel_if_stale(room: &mut Room) -> bool {
    if stale(room) {
        cancel(room, "Das Spieltisch-Angebot ist entfallen.")
    } else {
        false
    }
}

fn finalize_lobby(room: &mut Room) {
    let (host, invited, answers, host_seat) = match &room.table_offer {
        Some(o) => (o.host, o.invited.clone(), o.answers.clone(), o.host_seat.clone()),
        None => return,
    };
    let accepted: BTreeSet<usize> = invited
        .iter()
        .filter(|p| matches!(answers.get(p), Some(Answer::Accepted { .. })))
        .copied()
        .collect();
    room.game.S.settings.table = true;
    for p in room.game.S.players.iter_mut() {
        if p.id == host || accepted.contains(&p.id) {
            p.am_tisch = Some(true);
        } else if invited.contains(&p.id) {
            p.am_tisch = Some(false);
        }
    }
    if let Some(s) = host_seat {
        room.game.S.players[host].seat = Some(s);
    }
    for p in &accepted {
        if let Some(Answer::Accepted { seat: Some(s) }) = answers.get(p) {
            room.game.S.players[*p].seat = Some(s.clone());
        }
    }
    let mut names: Vec<String> = vec![name(room, host)];
    names.extend(accepted.iter().map(|p| name(room, *p)));
    room.table_offer = None;
    room.arm = None;
    log(room, format!("Der digitale Spieltisch ist eingerichtet: {}.", names.join(", ")));
}

fn finalize_midgame(room: &mut Room, seats: &BTreeMap<usize, String>) {
    let (host, invited, answers) = match &room.table_offer {
        Some(o) => (o.host, o.invited.clone(), o.answers.clone()),
        None => return,
    };
    let accepted: BTreeSet<usize> = invited
        .iter()
        .filter(|p| matches!(answers.get(p), Some(Answer::Accepted { .. })))
        .copied()
        .collect();
    room.game.S.settings.table = true;
    for p in room.game.S.players.iter_mut() {
        if p.id == host || accepted.contains(&p.id) {
            p.am_tisch = Some(true);
        } else if invited.contains(&p.id) {
            p.am_tisch = Some(false);
        }
        if let Some(s) = seats.get(&p.id) {
            p.seat = Some(s.clone());
        }
    }
    let mut names: Vec<String> = vec![name(room, host)];
    names.extend(accepted.iter().map(|p| name(room, *p)));
    room.table_offer = None;
    room.arm = None;
    log(room, format!("Der digitale Spieltisch ist eingerichtet: {}.", names.join(", ")));
}

/// Angebot weitertreiben: warten, neu fragen, finalisieren oder abbrechen.
pub fn advance(room: &mut Room, timed_out: bool) -> bool {
    if room.table_offer.is_none() {
        return false;
    }
    if stale(room) {
        return cancel(room, "Das Spieltisch-Angebot ist entfallen.");
    }
    let (phase, host, invited) = match &room.table_offer {
        Some(o) => (o.phase.clone(), o.host, o.invited.clone()),
        None => return false,
    };
    // Eingeladene, die inzwischen keine Menschen mehr sind, fallen heraus (Sicherheitsnetz).
    let valid: Vec<usize> = invited
        .iter()
        .copied()
        .filter(|p| room.game.S.players.get(*p).map(human).unwrap_or(false))
        .collect();
    if valid.len() != invited.len() {
        if let Some(o) = room.table_offer.as_mut() {
            o.invited = valid.clone();
        }
    }
    let connected = |p: usize| room.game.S.players.get(p).map(|x| x.connected).unwrap_or(false);
    // Ohne den Bildschirm des Spielleiters gibt es keine Tischplatte: warten bzw. im Takt abbrechen.
    if !connected(host) {
        return false;
    }
    let accepted: Vec<usize> = room
        .table_offer
        .as_ref()
        .map(|o| {
            valid
                .iter()
                .copied()
                .filter(|p| matches!(o.answers.get(p), Some(Answer::Accepted { .. })))
                .collect()
        })
        .unwrap_or_default();
    // Antworten allein reichen nicht: Annehmen ohne Platzwahl ist noch nicht fertig.
    let all_answered = room
        .table_offer
        .as_ref()
        .map(|o| {
            valid
                .iter()
                .all(|p| o.answers.contains_key(p) || !connected(*p))
        })
        .unwrap_or(false);
    if all_answered && accepted.is_empty() {
        cancel(room, "Der digitale Spieltisch ist nicht zustande gekommen.");
        return true;
    }
    // Bei Timeout gelten offene Antworten als Ablehnung; Zusagen bleiben Zusagen.
    if timed_out {
        if let Some(o) = room.table_offer.as_mut() {
            for p in &valid {
                if !o.answers.contains_key(p) {
                    o.answers.insert(*p, Answer::Declined);
                }
            }
        }
    }
    let host_done = room
        .table_offer
        .as_ref()
        .and_then(|o| o.host_seat.as_ref())
        .is_some()
        || timed_out;
    let done = |p: usize, off: &TableOffer| {
        timed_out
            || match off.answers.get(&p) {
                Some(Answer::Declined) => true,
                Some(Answer::Accepted { seat: Some(_) }) => true,
                _ => !connected(p),
            }
    };
    let all_done = host_done
        && room
            .table_offer
            .as_ref()
            .map(|o| valid.iter().all(|p| done(*p, o)))
            .unwrap_or(false);
    if !all_done {
        return false;
    }
    if accepted.is_empty() {
        cancel(room, "Der digitale Spieltisch ist nicht zustande gekommen.");
        return true;
    }
    if phase == "lobby" {
        finalize_lobby(room);
        return true;
    }
    // Laufendes Spiel: S.order bleibt unverändert, nur die zyklische Zuordnung wird geprüft.
    let anchors = match &room.table_offer {
        Some(o) => anchors(o, None),
        None => return false,
    };
    let order = normalized_order(&room.game.S.order, &room.game.S.players);
    let pl = place(&order, &anchors);
    if pl.unsatisfied.is_empty() || timed_out {
        finalize_midgame(room, &pl.seats);
        return true;
    }
    let unsat: Vec<usize> = pl
        .unsatisfied
        .iter()
        .copied()
        .filter(|p| *p == host || accepted.contains(p))
        .collect();
    if unsat.is_empty() {
        finalize_midgame(room, &pl.seats);
        return true;
    }
    if let Some(o) = room.table_offer.as_mut() {
        for p in &unsat {
            if *p == o.host {
                o.host_seat = None;
            } else if let Some(Answer::Accepted { seat }) = o.answers.get_mut(p) {
                *seat = None;
            }
        }
        o.reask = unsat.iter().copied().collect();
    }
    true
}

/// Ablauf und Verfall prüfen (im Pflege-Takt aufrufen).
pub fn tick(room: &mut Room, now: i64) -> bool {
    if room.table_offer.is_none() {
        return false;
    }
    if stale(room) {
        return cancel(room, "Das Spieltisch-Angebot ist entfallen.");
    }
    let (until, host) = match &room.table_offer {
        Some(o) => (o.until, o.host),
        None => return false,
    };
    if now < until {
        return false;
    }
    if !room.game.S.players.get(host).map(|p| p.connected).unwrap_or(false) {
        return cancel(room, "Der digitale Spieltisch ist nicht zustande gekommen.");
    }
    advance(room, true)
}

/// Sicht auf das Angebot für einen Spieler (nur Host und Eingeladene).
pub fn view(room: &Room, pid: usize) -> Value {
    let off = match &room.table_offer {
        Some(o) => o,
        None => return Value::Null,
    };
    let is_host = pid == off.host;
    if !is_host && !off.invited.contains(&pid) {
        return Value::Null;
    }
    let mode = if is_host {
        if off.host_seat.is_none() || off.reask.contains(&pid) {
            "seat"
        } else {
            "wait"
        }
    } else {
        match off.answers.get(&pid) {
            None => "ask",
            Some(Answer::Declined) => "declined",
            Some(Answer::Accepted { seat: Some(_) }) if !off.reask.contains(&pid) => "wait",
            Some(Answer::Accepted { .. }) => "seat",
        }
    };
    let ask_again = off.reask.contains(&pid);
    let mut allowed: Vec<String> = Vec::new();
    if mode == "seat" {
        let a = anchors(off, Some(pid));
        let taken: Vec<String> = a.values().cloned().collect();
        let free = |s: &str| !taken.iter().any(|x| x == s);
        if off.phase != "lobby" && ask_again {
            let order = normalized_order(&room.game.S.order, &room.game.S.players);
            allowed = allowed_seats(&order, &a, pid);
        } else {
            allowed = SEAT_CLOCK
                .iter()
                .filter(|s| free(s))
                .map(|s| s.to_string())
                .collect();
        }
    }
    let mut seats = Map::new();
    for (p, s) in chosen(off) {
        seats.insert(p.to_string(), json!(s));
    }
    let accepted: Vec<usize> = std::iter::once(off.host)
        .chain(off.invited.iter().copied().filter(|p| {
            matches!(off.answers.get(p), Some(Answer::Accepted { .. }))
        }))
        .collect();
    let declined: Vec<usize> = off
        .invited
        .iter()
        .copied()
        .filter(|p| matches!(off.answers.get(p), Some(Answer::Declined)))
        .collect();
    let pending: Vec<usize> = off
        .invited
        .iter()
        .copied()
        .filter(|p| !off.answers.contains_key(p))
        .collect();
    json!({
        "id": off.id,
        "you": pid,
        "host": off.host,
        "hostName": name(room, off.host),
        "mode": mode,
        "askAgain": ask_again,
        "seats": Value::Object(seats),
        "allowed": allowed,
        "accepted": accepted,
        "declined": declined,
        "pending": pending,
        "canCancel": is_host,
        "ms": (off.until - now_ms()).max(0),
    })
}
