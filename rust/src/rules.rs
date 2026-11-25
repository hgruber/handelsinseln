// Spielkonstanten – Portierung von shared/rules.js. Nicht duplizieren: Die Werte stammen aus dem Client.
use indexmap::IndexMap;

pub const RES: [&str; 5] = ["holz", "lehm", "wolle", "getreide", "erz"];
pub const TERRAINS: [&str; 8] = ["wald", "huegel", "weide", "acker", "gebirge", "gold", "wueste", "meer"];
pub const CHIPS: [u32; 10] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
pub const COLORS: [&str; 6] = ["rot", "blau", "orange", "weiss", "gruen", "violett"];
pub const DEV: [&str; 6] = ["ritter", "siegpunkt", "strassenbau", "erfindung", "monopol", "stadtmauer"];

pub fn terrain_res(t: &str) -> Option<&'static str> {
    match t {
        "wald" => Some("holz"),
        "huegel" => Some("lehm"),
        "weide" => Some("wolle"),
        "acker" => Some("getreide"),
        "gebirge" => Some("erz"),
        _ => None,
    }
}

pub fn terrain_de(t: &str) -> &'static str {
    match t {
        "wald" => "Wald",
        "huegel" => "Hügel",
        "weide" => "Weide",
        "acker" => "Acker",
        "gebirge" => "Gebirge",
        "wueste" => "Wüste",
        "gold" => "Goldfeld",
        "meer" => "Meer",
        _ => "",
    }
}

pub fn res_de(r: &str) -> &'static str {
    match r {
        "holz" => "Holz",
        "lehm" => "Lehm",
        "wolle" => "Wolle",
        "getreide" => "Getreide",
        "erz" => "Erz",
        _ => "",
    }
}

pub fn dev_de(t: &str) -> &'static str {
    match t {
        "ritter" => "Ritter",
        "siegpunkt" => "Siegpunkt",
        "strassenbau" => "Straßenbau",
        "erfindung" => "Erfindung",
        "monopol" => "Monopol",
        "stadtmauer" => "Stadtmauer",
        _ => "",
    }
}

/// Standard-Kartenzahl je Art: Grundspiel (2–4) und Erweiterung (5–6). Stadtmauer ist eine Hausregel (aus).
pub fn dev_std(n: usize) -> &'static [(&'static str, u32); 6] {
    if n >= 5 {
        &[
            ("ritter", 20),
            ("siegpunkt", 5),
            ("strassenbau", 3),
            ("erfindung", 3),
            ("monopol", 3),
            ("stadtmauer", 0),
        ]
    } else {
        &[
            ("ritter", 14),
            ("siegpunkt", 5),
            ("strassenbau", 2),
            ("erfindung", 2),
            ("monopol", 2),
            ("stadtmauer", 0),
        ]
    }
}

pub fn cost(what: &str) -> IndexMap<&'static str, u32> {
    let mut m = IndexMap::new();
    let items: &[(&'static str, u32)] = match what {
        "road" => &[("lehm", 1), ("holz", 1)],
        "ship" => &[("wolle", 1), ("holz", 1)],
        "settlement" => &[("lehm", 1), ("holz", 1), ("wolle", 1), ("getreide", 1)],
        "city" => &[("getreide", 2), ("erz", 3)],
        "dev" => &[("erz", 1), ("wolle", 1), ("getreide", 1)],
        _ => &[],
    };
    for (k, v) in items {
        m.insert(*k, *v);
    }
    m
}
