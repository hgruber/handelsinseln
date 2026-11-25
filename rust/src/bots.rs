// Server-Bots: je Takt höchstens eine Aktion pro Bot (Portierung von Hub#botStep).
use std::sync::{Arc, Mutex};

use crate::bot::bot_act;
use crate::botplay::bot_play;
use crate::game::{now_ms, GameError};
use crate::hub::Room;
use crate::log;
use crate::rng::Rng;

pub fn bot_tick(room: &mut Room, rnd: &Arc<Mutex<Rng>>) -> bool {
    if room.game.S.phase != "setup" && room.game.S.phase != "main" {
        return false;
    }
    let mut changed = false;
    let ids: Vec<usize> = room.game.S.players.iter().map(|p| p.id).collect();
    for pid in ids {
        let is_bot = room
            .game
            .S
            .players
            .get(pid)
            .map(|p| p.bot.is_some() && !p.left)
            .unwrap_or(false);
        if !is_bot {
            continue;
        }
        match bot_play(&mut room.game, pid, None, rnd, now_ms()) {
            Ok(true) => changed = true,
            Ok(false) => {}
            Err(GameError(msg)) => {
                let name = room
                    .game
                    .S
                    .players
                    .get(pid)
                    .map(|p| p.name.clone())
                    .unwrap_or_default();
                log::warn(
                    "bot_abgelehnt",
                    &[("raum", room.id.clone()), ("spieler", name), ("fehler", msg)],
                );
                match bot_act(&mut room.game, pid, rnd, true) {
                    Ok(true) => changed = true,
                    Ok(false) => {}
                    Err(e) => log::warn(
                        "bot_abgelehnt",
                        &[("raum", room.id.clone()), ("fehler", e.0)],
                    ),
                }
            }
        }
    }
    changed
}
