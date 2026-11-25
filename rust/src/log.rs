// Betriebslog – gleiches Zeilenformat wie server/log.js.
use std::sync::atomic::{AtomicBool, AtomicI8, Ordering};

static LEVEL: AtomicI8 = AtomicI8::new(1); // warn, bis main "info" setzt
static SHOW_TIME: AtomicBool = AtomicBool::new(true);

pub fn set_level(name: &str) {
    let v = match name {
        "silent" => -1,
        "error" => 0,
        "warn" => 1,
        "info" => 2,
        "debug" => 3,
        _ => return,
    };
    LEVEL.store(v, Ordering::Relaxed);
}

pub fn is_debug() -> bool {
    LEVEL.load(Ordering::Relaxed) >= 3
}

/// Zeitstempel im Log ein-/ausschalten. Unter systemd/journald aus (journald schreibt ihn selbst).
pub fn set_time(on: bool) {
    SHOW_TIME.store(on, Ordering::Relaxed);
}

fn esc(v: &str) -> String {
    let plain = !v.is_empty()
        && v.chars().all(|c| c.is_alphanumeric() || "_.:-/@+".contains(c));
    if plain {
        v.to_string()
    } else {
        serde_json::to_string(v).unwrap_or_else(|_| "\"\"".to_string())
    }
}

fn line(level: &str, lv: i8, ev: &str, fields: &[(&str, String)]) {
    if lv > LEVEL.load(Ordering::Relaxed) {
        return;
    }
    let mut parts = Vec::new();
    if SHOW_TIME.load(Ordering::Relaxed) {
        parts.push(crate::http::iso_time(crate::game::now_ms()));
    }
    parts.push(format!("{:<5}", level.to_uppercase()));
    parts.push(ev.to_string());
    for (k, v) in fields {
        if v.is_empty() {
            continue;
        }
        parts.push(format!("{}={}", k, esc(v)));
    }
    let s = parts.join(" ");
    if lv <= 1 {
        eprintln!("{}", s);
    } else {
        println!("{}", s);
    }
}

pub fn info(ev: &str, fields: &[(&str, String)]) {
    line("info", 2, ev, fields);
}
pub fn warn(ev: &str, fields: &[(&str, String)]) {
    line("warn", 1, ev, fields);
}
pub fn error(ev: &str, fields: &[(&str, String)]) {
    line("error", 0, ev, fields);
}
pub fn debug(ev: &str, fields: &[(&str, String)]) {
    line("debug", 3, ev, fields);
}

pub fn tok(t: Option<&str>) -> String {
    t.map(|s| s.chars().take(8).collect()).unwrap_or_default()
}
