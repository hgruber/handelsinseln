// Kleiner HTTP/1.1-Server (keine Abhängigkeiten): Anfragen lesen, Antworten schreiben, Dateien ausliefern.
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

pub struct Request {
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn q(&self, k: &str) -> Option<&str> {
        self.query.get(k).map(|s| s.as_str())
    }
    pub fn header(&self, k: &str) -> Option<&str> {
        self.headers.get(k).map(|s| s.as_str())
    }
    pub fn json(&self) -> Result<serde_json::Value, String> {
        if self.body.is_empty() {
            return Ok(serde_json::json!({}));
        }
        serde_json::from_slice(&self.body).map_err(|_| "Ungültiges JSON".to_string())
    }
}

pub fn read_request<R: BufRead>(reader: &mut R) -> io::Result<Option<Request>> {
    let mut line = String::new();
    let n = reader.read_line(&mut line)?;
    if n == 0 {
        return Ok(None);
    }
    if line.len() > 8192 {
        return Ok(None);
    }
    let mut parts = line.trim_end().split(' ');
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    if method.is_empty() || target.is_empty() {
        return Ok(None);
    }
    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h)? == 0 {
            return Ok(None);
        }
        let h = h.trim_end_matches(['\r', '\n']);
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers
        .get("content-length")
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0);
    if len > 2_000_000 {
        return Ok(None);
    }
    let mut body = vec![0u8; len];
    if len > 0 {
        reader.read_exact(&mut body)?;
    }
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), parse_query(q)),
        None => (target, HashMap::new()),
    };
    Ok(Some(Request { method, path, query, headers, body }))
}

fn parse_query(q: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for part in q.split('&') {
        if part.is_empty() {
            continue;
        }
        let (k, v) = part.split_once('=').unwrap_or((part, ""));
        m.insert(percent_decode(k).unwrap_or_else(|| k.to_string()), percent_decode(v).unwrap_or_else(|| v.to_string()));
    }
    m
}

pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return None;
            }
            let h = (b[i + 1] as char).to_digit(16)?;
            let l = (b[i + 2] as char).to_digit(16)?;
            out.push((h * 16 + l) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        429 => "Too Many Requests",
        _ => "OK",
    }
}

pub fn write_head<W: Write>(
    stream: &mut W,
    code: u16,
    headers: &[(&str, String)],
    content_length: Option<usize>,
) -> io::Result<()> {
    let mut s = format!("HTTP/1.1 {} {}\r\n", code, status_text(code));
    for (k, v) in headers {
        s.push_str(k);
        s.push_str(": ");
        s.push_str(v);
        s.push_str("\r\n");
    }
    if let Some(n) = content_length {
        s.push_str(&format!("Content-Length: {}\r\n", n));
    }
    s.push_str("Connection: keep-alive\r\n\r\n");
    stream.write_all(s.as_bytes())
}

pub fn send_json<W: Write>(stream: &mut W, code: u16, value: &serde_json::Value) -> io::Result<()> {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    write_head(
        stream,
        code,
        &[
            ("Content-Type", "application/json; charset=utf-8".into()),
            ("Cache-Control", "no-store".into()),
        ],
        Some(body.len()),
    )?;
    stream.write_all(&body)
}

pub fn send_text<W: Write>(stream: &mut W, code: u16, text: &str) -> io::Result<()> {
    write_head(
        stream,
        code,
        &[("Content-Type", "text/plain; charset=utf-8".into())],
        Some(text.len()),
    )?;
    stream.write_all(text.as_bytes())
}

fn base36(mut n: u64) -> String {
    if n == 0 {
        return "0".into();
    }
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

fn mime_of(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(x) => out.push(x),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// Statische Datei ausliefern (mit ETag/Last-Modified, 304 bei unverändert).
pub fn serve_static<W: Write>(
    stream: &mut W,
    req: &Request,
    root: &Path,
    head_only: bool,
) -> io::Result<()> {
    let decoded = match percent_decode(&req.path) {
        Some(d) => d,
        None => return send_text(stream, 400, "Ungültiger Pfad"),
    };
    let mut rel = decoded;
    if rel == "/" {
        rel = "/index.html".into();
    }
    let (base, rest) = if let Some(r) = rel.strip_prefix("/shared/") {
        (root.join("shared"), r.to_string())
    } else {
        (root.join("public"), rel.trim_start_matches('/').to_string())
    };
    let file = match safe_join(&base, &rest) {
        Some(f) => f,
        None => return send_text(stream, 403, ""),
    };
    let meta = match fs::metadata(&file) {
        Ok(m) if m.is_file() => m,
        _ => return send_text(stream, 404, "Nicht gefunden"),
    };
    let size = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let etag = format!("W/\"{}-{}\"", base36(size), base36(mtime_ms));
    let mtime_secs = mtime_ms / 1000;
    if req.header("if-none-match") == Some(etag.as_str()) {
        return write_head(
            stream,
            304,
            &[
                ("Content-Type", mime_of(&file).into()),
                ("Cache-Control", "no-cache".into()),
                ("ETag", etag),
                ("Last-Modified", http_date(mtime_secs)),
            ],
            None,
        );
    }
    write_head(
        stream,
        200,
        &[
            ("Content-Type", mime_of(&file).into()),
            ("Cache-Control", "no-cache".into()),
            ("ETag", etag),
            ("Last-Modified", http_date(mtime_secs)),
        ],
        Some(size as usize),
    )?;
    if head_only {
        return Ok(());
    }
    let mut f = fs::File::open(&file)?;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        stream.write_all(&buf[..n])?;
    }
    Ok(())
}

/// "Tue, 25 Nov 2026 12:00:00 GMT"
pub fn http_date(secs: u64) -> String {
    let (y, mo, d, h, mi, s, wd) = civil(secs as i64);
    let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{}, {:02} {} {:04} {:02}:{:02}:{:02} GMT",
        days[wd], d, months[(mo - 1) as usize], y, h, mi, s
    )
}

/// "2026-11-25T12:00:00.000Z"
pub fn iso_time(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let frac = ms.rem_euclid(1000);
    let (y, mo, d, h, mi, s, _) = civil(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, d, h, mi, s, frac
    )
}

/// Ziviles Datum aus Unix-Sekunden (Howard Hinnant) – liefert (Jahr, Monat, Tag, Std, Min, Sek, Wochentag).
fn civil(secs: i64) -> (i64, i64, i64, i64, i64, i64, usize) {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y0 = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y0 + 1 } else { y0 };
    let wd = (days + 4).rem_euclid(7) as usize; // 1970-01-01 war Donnerstag
    (y, m, d, h, mi, s, wd)
}
