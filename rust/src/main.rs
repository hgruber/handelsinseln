// Einstiegspunkt: liest die Umgebung und startet den HTTP/HTTPS-Server.
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

/// Baut aus einer `git describe`-Angabe (`v1.0.0-5-g11661da[-dirty]`) den Versionszusatz:
/// `1.0.0+5.11661da`, bei uncommitteten Änderungen `1.0.0+5.11661da (geändert)`.
/// Liefert None, wenn die Angabe kein describe-Format hat.
fn describe_version(base: Option<&str>, d: &str) -> Option<String> {
    let (d, dirty) = match d.strip_suffix("-dirty") {
        Some(rest) => (rest, true),
        None => (d, false),
    };
    let mut parts = d.rsplitn(3, '-');
    let hash = parts.next()?.strip_prefix('g')?;
    let n: u32 = parts.next()?.parse().ok()?;
    let tag = parts.next()?.trim_start_matches('v');
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) || tag.is_empty() {
        return None;
    }
    let mut s = if n > 0 || dirty { tag.to_string() } else { base.unwrap_or(tag).to_string() };
    if n > 0 {
        s.push_str(&format!("+{}.{}", n, hash));
    }
    if dirty {
        s.push_str(" (geändert)");
    }
    Some(s)
}

/// Version: package.json; liegen seit dem letzten Tag Commits vor, kommt ein Zusatz
/// „+Anzahl.Hash“ dazu (aus der Build-Zeit, `git describe` in build.rs, oder aus `APP_VERSION`).
fn read_version(root: &Path) -> String {
    let base = std::fs::read_to_string(root.join("package.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(String::from));
    if let Ok(v) = std::env::var("APP_VERSION") {
        if !v.is_empty() {
            return describe_version(base.as_deref(), &v).unwrap_or(v);
        }
    }
    if let Some(d) = option_env!("GIT_DESCRIBE") {
        if let Some(v) = describe_version(base.as_deref(), d) {
            return v;
        }
    }
    base.unwrap_or_else(|| "unbekannt".to_string())
}

fn env_num<T: std::str::FromStr>(name: &str, def: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|s| s.trim().parse::<T>().ok())
        .unwrap_or(def)
}

/// Healthcheck für den Container: GET /api/lobby, Exit 0 bei HTTP 200.
fn health() -> ! {
    use std::io::{Read, Write};
    let port = std::env::var("PORT").ok().and_then(|s| s.parse::<u16>().ok()).unwrap_or(8080);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let ok = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(3))
        .and_then(|mut s| {
            s.set_read_timeout(Some(std::time::Duration::from_secs(3)))?;
            s.write_all(b"GET /api/lobby HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")?;
            let mut buf = [0u8; 64];
            let n = s.read(&mut buf)?;
            Ok(String::from_utf8_lossy(&buf[..n]).contains(" 200 "))
        })
        .unwrap_or(false);
    std::process::exit(if ok { 0 } else { 1 });
}

fn main() {
    if std::env::args().any(|a| a == "--health") {
        health();
    }
    log::set_level(&std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into()));
    let log_time = std::env::var("LOG_TIMESTAMP")
        .map(|v| !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "off" | "false" | "no" | "aus"))
        .unwrap_or(true);
    log::set_time(log_time);
    let root = find_root();
    let data_dir = std::env::var("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join("data"));
    let version = read_version(&root);
    let port = env_num("PORT", 8080u16);
    let listen = std::env::var("LISTEN").ok().filter(|s| !s.is_empty());
    let no_save = std::env::var("NO_SAVE").ok().map(|v| v == "1").unwrap_or(false);
    let stun = std::env::var("STUN_URL").ok().filter(|s| !s.is_empty());
    let https_port = match env_num("HTTPS_PORT", 8443u16) {
        0 => None,
        p => Some(p),
    };
    let tls_hosts = std::env::var("TLS_HOSTS").unwrap_or_default();
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
        https_port,
        tls_hosts,
        tick_ms,
        bot_ms,
    };
    if let Err(e) = run(opts) {
        eprintln!("Server-Fehler: {}", e);
        std::process::exit(1);
    }
}
