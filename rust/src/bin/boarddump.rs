// Vergleichswerkzeug: erzeugt ein Startbrett wie server/board.js und gibt es als JSON aus.
// Aufruf: boarddump <seed> <n> [variant] [dense:0|1] [aspect|null] [goldHome] [goldStart] [goldRate]
use std::env;

use handelsinseln::board;
use handelsinseln::model::State;
use handelsinseln::rng::Rng;
use handelsinseln::settings::Settings;
use serde_json::json;

fn main() {
    let a: Vec<String> = env::args().collect();
    let seed: u32 = a.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
    let n: usize = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(4);
    let mut set = Settings::default();
    if let Some(v) = a.get(3) {
        if !v.is_empty() {
            set.variant = v.clone();
        }
    }
    if let Some(v) = a.get(4) {
        set.dense = v != "0";
    }
    if let Some(v) = a.get(5) {
        if v != "null" && !v.is_empty() {
            set.aspect = v.parse().ok();
        }
    }
    if let Some(v) = a.get(6) {
        set.gold_home = v != "0";
    }
    if let Some(v) = a.get(7) {
        set.gold_start = v != "0";
    }
    if let Some(v) = a.get(8) {
        if let Some(x) = v.parse().ok() {
            set.gold_rate = x;
        }
    }
    let mut rnd = Rng::seeded(seed);
    let mut state = State::empty(set.clone());
    board::generate(&mut state, n, &mut rnd, &set);
    let out = json!({
        "hexes": state.hexes,
        "harbors": state.harbors,
        "robber": state.robber,
        "pirate": state.pirate,
        "home": state.home,
        "numBag": state.num_bag,
        "landBag": state.land_bag,
        "harborKinds": state.harbor_kinds,
        "next": rnd.next_f64(),
    });
    println!("{}", serde_json::to_string(&out).unwrap());
}
