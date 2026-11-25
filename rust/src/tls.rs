// TLS: selbstsigniertes Zertifikat (oder TLS_CERT/TLS_KEY) und rustls-Konfiguration.
// Die Namen für das Zertifikat kommen aus localhost, 127.0.0.1, ::1, dem Hostnamen und TLS_HOSTS.
use std::path::Path;
use std::sync::Arc;

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct CertFile {
    cert: String,
    key: String,
    hosts: Vec<String>,
}

/// Namen, die im Zertifikat stehen sollen (dedupliziert).
pub fn wanted_hosts(extra: &str) -> Vec<String> {
    let mut v: Vec<String> = vec!["localhost".into(), "127.0.0.1".into(), "::1".into()];
    if let Ok(h) = std::fs::read_to_string("/etc/hostname") {
        let h = h.trim();
        if !h.is_empty() {
            v.push(h.to_string());
        }
    }
    if let Ok(h) = std::env::var("HOSTNAME") {
        let h = h.trim();
        if !h.is_empty() {
            v.push(h.to_string());
        }
    }
    for h in extra.split(',') {
        let h = h.trim();
        if !h.is_empty() {
            v.push(h.to_string());
        }
    }
    let mut out: Vec<String> = Vec::new();
    for h in v {
        if !out.contains(&h) {
            out.push(h);
        }
    }
    out
}

/// Baut die rustls-Konfiguration. Reihenfolge: TLS_CERT/TLS_KEY, sonst gespeichertes
/// Zertifikat in DATA_DIR/tls/tls.json, sonst neu erzeugen.
pub fn build(data_dir: &Path, tls_hosts: &str) -> Result<Arc<rustls::ServerConfig>, String> {
    let hosts = wanted_hosts(tls_hosts);
    let env_cert = std::env::var("TLS_CERT").ok().filter(|s| !s.is_empty());
    let env_key = std::env::var("TLS_KEY").ok().filter(|s| !s.is_empty());
    let (cert_pem, key_pem) = match (env_cert, env_key) {
        (Some(c), Some(k)) => {
            let cert = std::fs::read_to_string(&c)
                .map_err(|e| format!("TLS_CERT {}: {}", c, e))?;
            let key = std::fs::read_to_string(&k)
                .map_err(|e| format!("TLS_KEY {}: {}", k, e))?;
            (cert, key)
        }
        _ => load_or_create(data_dir, &hosts)?,
    };
    let certs = parse_certs(&cert_pem)?;
    let key = parse_key(&key_pem)?;
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("Zertifikat/Schlüssel passen nicht zusammen: {}", e))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

fn load_or_create(data_dir: &Path, hosts: &[String]) -> Result<(String, String), String> {
    let path = data_dir.join("tls").join("tls.json");
    if let Ok(s) = std::fs::read_to_string(&path) {
        if let Ok(j) = serde_json::from_str::<CertFile>(&s) {
            if !j.cert.is_empty() && !j.key.is_empty() && hosts.iter().all(|h| j.hosts.contains(h)) {
                crate::log::debug("tls_geladen", &[("datei", path.display().to_string())]);
                return Ok((j.cert, j.key));
            }
        }
    }
    let ck = rcgen::generate_simple_self_signed(hosts.to_vec())
        .map_err(|e| format!("Zertifikat erzeugen: {}", e))?;
    let cert = ck.cert.pem();
    let key = ck.key_pair.serialize_pem();
    let record = CertFile { cert: cert.clone(), key: key.clone(), hosts: hosts.to_vec() };
    let json = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::write(&path, json).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
    crate::log::info(
        "tls_zertifikat",
        &[("datei", path.display().to_string()), ("hosts", hosts.join(","))],
    );
    Ok((cert, key))
}

fn parse_certs(pem: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let mut r = std::io::BufReader::new(pem.as_bytes());
    let v: Result<Vec<_>, _> = rustls_pemfile::certs(&mut r).collect();
    let v = v.map_err(|e| format!("Zertifikat lesen: {}", e))?;
    if v.is_empty() {
        return Err("Kein Zertifikat in der PEM-Datei.".into());
    }
    Ok(v)
}

fn parse_key(pem: &str) -> Result<PrivateKeyDer<'static>, String> {
    let mut r = std::io::BufReader::new(pem.as_bytes());
    rustls_pemfile::private_key(&mut r)
        .map_err(|e| format!("Schlüssel lesen: {}", e))?
        .ok_or_else(|| "Kein privater Schlüssel in der PEM-Datei.".to_string())
}
