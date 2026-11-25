// Server-Bots: Portierung von server/bot.js und server/botplay.js (folgt).
use std::sync::{Arc, Mutex};

use crate::hub::Room;
use crate::rng::Rng;

pub fn bot_tick(_room: &mut Room, _rnd: &Arc<Mutex<Rng>>) -> bool {
    false
}
