// Einstiegspunkt: liest die Umgebung wie server/server.js und startet den HTTP-Server.
use std::path::{Path, PathBuf};

use handelsinseln::log;
use handelsinseln::server::{run, Options};

fn find_root() -> PathBuf {
    if let Ok(d) = std::env::var("ROOT_DIR") {
        return PathBuf::from(d);
    }
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let start = exe.parent().unwrap_or(Path::new(".")).to_path_buf();
    let cand = [start.clone(), start.join("../.."), start.join("../../.."), start.join("../../../..")];
    for c in cand {
        if c.join("public").is_dir() && c.join("shared").is_dir() {
            return c.canonicalize().unwrap_or(c);
        }
    }
    std::env::current_dir().unwrap_or(start)
}

fn read_version(root: &Path) -> String {
    if let Ok(v) = std::env::var("APP_VERSION") {
        if !v.is_empty() {
            return v;
        }
    }
    let pkg = root.join("package.json");
    if let Ok(s) = std::fs::read_to_string(pkg) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                return ver.to_string();
            }
        }
    }
    "unbekannt".to_string()
}

fn env_num<T: std::str::FromStr>(name: &str, def: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|s| s.trim().parse::<T>().ok())
        .unwrap_or(def)
}

fn main() {
    log::set_level(&std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into()));
    let root = find_root();
    let data_dir = std::env::var("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join("data"));
    let version = read_version(&root);
    let port = env_num("PORT", 8080u16);
    let listen = std::env::var("LISTEN").ok().filter(|s| !s.is_empty());
    let no_save = std::env::var("NO_SAVE").ok().map(|v| v == "1").unwrap_or(false);
    let stun = std::env::var("STUN_URL").ok().filter(|s| !s.is_empty());
    let tick_ms = env_num("TICK_MS", 2000u64);
    let bot_ms = env_num("BOT_MS", 800u64);
    let opts = Options {
        listen,
        port,
        data_dir,
        root,
        no_save,
        version,
        stun,
        https_port: None,
        tick_ms,
        bot_ms,
    };
    if let Err(e) = run(opts) {
        eprintln!("Server-Fehler: {}", e);
        std::process::exit(1);
    }
}
