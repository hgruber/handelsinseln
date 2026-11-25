// Spielt eine von tests/diff/logic.js aufgezeichnete Aktionsfolge nach und gibt je Schritt einen
// kanonischen Zustands-Hash aus. Grundlage für den Gleichheitstest Node ⇄ Rust.
use std::io::{BufRead, BufReader};

use handelsinseln::game::Game;
use handelsinseln::rng::Rng;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

fn canon(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else if let Some(f) = n.as_f64() {
                out.push_str(&format!("{}", f));
            } else {
                out.push_str("null");
            }
        }
        Value::String(s) => out.push_str(&serde_json::to_string(s).unwrap()),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canon(x, out);
            }
            out.push(']');
        }
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k.as_str()).unwrap());
                out.push(':');
                let v = &o[*k];
                if k.as_str() == "token" || k.as_str() == "phone" {
                    out.push('"');
                    out.push('t');
                    out.push('"');
                } else if k.as_str() == "startedAt" || k.as_str() == "endedAt" || k.as_str() == "durationSec" {
                    out.push('0');
                } else {
                    canon(v, out);
                }
            }
            out.push('}');
        }
    }
}

fn hash_string(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:016x}", h)
}

fn hash_views(g: &mut Game) -> String {
    let mut s = String::new();
    let n = g.S.players.len();
    for pid in 0..n {
        canon(&g.view(Some(pid)), &mut s);
        s.push('|');
    }
    canon(&g.watch_view(), &mut s);
    hash_string(&s)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let path = a.get(1).cloned().unwrap_or_else(|| "-".to_string());
    let reader: Box<dyn BufRead> = if path == "-" {
        Box::new(BufReader::new(std::io::stdin()))
    } else {
        Box::new(BufReader::new(std::fs::File::open(&path).expect("Trace nicht lesbar")))
    };
    let mut lines = reader.lines();
    let init: Value = match lines.next().and_then(|l| l.ok()).and_then(|l| serde_json::from_str(&l).ok()) {
        Some(v) => v,
        None => {
            eprintln!("Trace leer");
            std::process::exit(2);
        }
    };
    let seed = init.get("seed").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let rnd = Arc::new(Mutex::new(Rng::seeded(seed)));
    let mut g = Game::new(rnd, "test", "Testspiel");
    if let Some(players) = init.get("players").and_then(|p| p.as_array()) {
        for p in players {
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("P");
            let color = p.get("color").and_then(|v| v.as_str()).unwrap_or("rot");
            if let Err(e) = g.join(name, color, None, None) {
                println!("ERR join: {}", e.0);
            }
        }
    }
    let mut out = Vec::new();
    let bot_mode = init.get("bot").and_then(|v| v.as_bool()).unwrap_or(false);
    if bot_mode {
        use handelsinseln::botplay::bot_play;
        let bot_seed = init.get("botSeed").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let now = init.get("now").and_then(|v| v.as_i64()).unwrap_or(1000);
        let bot_rnd = Arc::new(Mutex::new(Rng::seeded(bot_seed)));
        if let Some(settings) = init.get("settings") {
            let a = json!({"type": "set_settings", "settings": settings});
            if let Err(e) = g.act(0, &a) {
                out.push(format!("ERR settings: {}", e.0));
            } else {
                out.push(hash_views(&mut g));
            }
        }
        if let Err(e) = g.act(0, &json!({"type": "start"})) {
            out.push(format!("ERR start: {}", e.0));
        } else {
            out.push(hash_views(&mut g));
        }
        let n = g.S.players.len();
        let kinds = ["baumeister", "haendler", "ritter"];
        let mut steps = 0usize;
        let mut stuck = 0;
        let max_steps = init.get("max").and_then(|v| v.as_u64()).map(|x| x as usize).unwrap_or(6000);
        while g.S.phase != "ended" && g.S.turn_no < 1200 && steps < max_steps {
            let mut acted = false;
            for pid in 0..n {
                if g.S.phase == "ended" {
                    break;
                }
                match bot_play(&mut g, pid, Some(kinds[pid % 3]), &bot_rnd, now) {
                    Ok(true) => {
                        steps += 1;
                        acted = true;
                        out.push(hash_views(&mut g));
                    }
                    Ok(false) => {}
                    Err(e) => {
                        out.push(format!("ERR bot: {}", e.0));
                        acted = true;
                    }
                }
            }
            if !acted {
                stuck += 1;
                if stuck > 3 {
                    break;
                }
            } else {
                stuck = 0;
            }
        }
        println!("{}", out.join("\n"));
        return;
    }
    for line in lines {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let cmd: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                out.push(format!("ERR parse: {}", e));
                continue;
            }
        };
        let kind = cmd.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "act" {
            let pid = cmd.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let action = cmd.get("action").cloned().unwrap_or_else(|| json!({}));
            match g.act(pid, &action) {
                Ok(()) => out.push(hash_views(&mut g)),
                Err(e) => out.push(format!("ERR act: {}", e.0)),
            }
        }
    }
    println!("{}", out.join("\n"));
}
