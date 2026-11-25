// Spieleinstellungen – Portierung von server/settings.js (Standardwerte und geprüfte Teiländerungen).
use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::rules::{self, DEV, RES, TERRAINS};

pub const VARIANTS: [&str; 4] = ["klassisch", "nebel", "inseln", "archipel"];
pub const CHIP_KEYS: [&str; 10] = ["2", "3", "4", "5", "6", "8", "9", "10", "11", "12"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DevLimit {
    Standard,
    N(u32),
}

impl Serialize for DevLimit {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            DevLimit::Standard => s.serialize_str("standard"),
            DevLimit::N(n) => s.serialize_u64(*n as u64),
        }
    }
}

impl<'de> Deserialize<'de> for DevLimit {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        Ok(dev_limit_of(&v))
    }
}

fn dev_limit_of(v: &Value) -> DevLimit {
    match v {
        Value::Number(n) => {
            if let Some(x) = n.as_u64() {
                DevLimit::N(x.min(u32::MAX as u64) as u32)
            } else if let Some(x) = n.as_f64() {
                if x.is_finite() && x >= 0.0 {
                    DevLimit::N(x as u32)
                } else {
                    DevLimit::N(0)
                }
            } else {
                DevLimit::N(0)
            }
        }
        _ => DevLimit::Standard,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub road: Option<u32>,
    pub ship: Option<u32>,
    pub settlement: Option<u32>,
    pub city: Option<u32>,
    pub dev: IndexMap<String, DevLimit>,
    pub bank: IndexMap<String, Option<u32>>,
    pub fog_terrain: IndexMap<String, Option<u32>>,
    pub fog_chips: IndexMap<String, Option<u32>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub variant: String,
    pub planned_players: u32,
    pub dense: bool,
    pub table: bool,
    pub aspect: Option<f64>,
    pub dice: String,
    pub robber: String,
    pub win_points: u32,
    pub hand_limit: Option<u32>,
    pub bank_rate: u32,
    pub player_trade: bool,
    pub island_bonus: u32,
    pub island_bonus_max: u32,
    pub longest_min: u32,
    pub army_min: u32,
    pub gold_home: bool,
    pub gold_start: bool,
    pub gold_rate: u32,
    pub leaver: String,
    pub vanish_rounds: u32,
    pub dev_return: bool,
    pub limits: Limits,
}

#[derive(Debug)]
pub struct SettingsError(pub String);

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn bad<T>(m: impl Into<String>) -> Result<T, SettingsError> {
    Err(SettingsError(m.into()))
}

fn dev_std(k: &str) -> DevLimit {
    if k == "stadtmauer" {
        DevLimit::N(0)
    } else {
        DevLimit::Standard
    }
}

pub fn dev_defaults() -> IndexMap<String, DevLimit> {
    DEV.iter().map(|k| (k.to_string(), dev_std(k))).collect()
}

/// Verteilung einer Gesamtzahl im Verhältnis des Grundspiels (wie JS).
fn spread_total(total: u32) -> IndexMap<String, DevLimit> {
    let std = rules::dev_std(4);
    let tot: u32 = std.iter().map(|(_, v)| *v).sum();
    let raw: Vec<(String, f64, f64)> = std
        .iter()
        .map(|(k, v)| {
            let x = (total as f64 * *v as f64) / tot as f64;
            (k.to_string(), x, x.floor())
        })
        .collect();
    let mut csum: u32 = raw.iter().map(|(_, _, c)| *c as u32).sum();
    let mut rest = total.saturating_sub(csum.min(total));
    // JS sortiert nach (x - c) absteigend, stabil (IndexMap-Reihenfolge bleibt bei Gleichstand)
    let mut idx: Vec<usize> = (0..raw.len()).collect();
    idx.sort_by(|&a, &b| {
        let da = raw[a].1 - raw[a].2;
        let db = raw[b].1 - raw[b].2;
        db.partial_cmp(&da).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut counts: Vec<u32> = raw.iter().map(|(_, _, c)| *c as u32).collect();
    let mut i = 0;
    while rest > 0 {
        counts[idx[i % idx.len()]] += 1;
        rest -= 1;
        i += 1;
    }
    // csum nur zur Klarheit; Reihenfolge der Ausgabe folgt DEV
    csum = 0;
    let _ = csum;
    DEV.iter()
        .map(|k| {
            let pos = std.iter().position(|(x, _)| x == k).unwrap_or(0);
            (k.to_string(), DevLimit::N(counts[pos]))
        })
        .collect()
}

/// Portierung von ST.devLimits: 'standard'/null → Standard je Art; Zahl → im Verhältnis aufteilen;
/// Objekt → je Art den angegebenen Wert (fehlend/null = Standard).
pub fn dev_limits(v: &Value) -> IndexMap<String, DevLimit> {
    if let Value::Object(o) = v {
        let mut out = IndexMap::new();
        for k in DEV {
            let x = o.get(k).unwrap_or(&Value::Null);
            out.insert(
                k.to_string(),
                if x.is_null() {
                    dev_std(k)
                } else {
                    dev_limit_of(x)
                },
            );
        }
        return out;
    }
    if let Some(n) = v.as_u64() {
        if n <= u32::MAX as u64 {
            return spread_total(n as u32);
        }
    }
    if let Some(x) = v.as_f64() {
        if x.is_finite() && x >= 0.0 && x <= u32::MAX as f64 {
            return spread_total(x as u32);
        }
    }
    dev_defaults()
}

fn null_map(keys: impl IntoIterator<Item = &'static str>) -> IndexMap<String, Option<u32>> {
    keys.into_iter().map(|k| (k.to_string(), None)).collect()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            variant: "klassisch".to_string(),
            planned_players: 4,
            dense: true,
            table: false,
            aspect: None,
            dice: "manuell".to_string(),
            robber: "manuell".to_string(),
            win_points: 14,
            hand_limit: Some(7),
            bank_rate: 4,
            player_trade: true,
            island_bonus: 2,
            island_bonus_max: 2,
            longest_min: 5,
            army_min: 3,
            gold_home: true,
            gold_start: false,
            gold_rate: 3,
            leaver: "uebernahme".to_string(),
            vanish_rounds: 5,
            dev_return: false,
            limits: Limits {
                road: Some(15),
                ship: Some(15),
                settlement: Some(5),
                city: Some(4),
                dev: dev_defaults(),
                bank: null_map(RES),
                fog_terrain: null_map(TERRAINS),
                fog_chips: null_map(CHIP_KEYS),
            },
        }
    }
}

fn is_obj(v: &Value) -> bool {
    v.is_object()
}

fn int_of(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => {
            if let Some(x) = n.as_i64() {
                Some(x)
            } else if let Some(x) = n.as_u64() {
                if x <= i64::MAX as u64 {
                    Some(x as i64)
                } else {
                    None
                }
            } else if let Some(x) = n.as_f64() {
                if x.is_finite() && x.fract() == 0.0 && x >= i64::MIN as f64 && x <= i64::MAX as f64 {
                    Some(x as i64)
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

fn int(v: &Value, lo: i64, hi: i64, what: &str) -> Result<i64, SettingsError> {
    match int_of(v) {
        Some(x) if x >= lo && x <= hi => Ok(x),
        _ => bad(format!("{}: erlaubt sind ganze Zahlen von {} bis {}.", what, lo, hi)),
    }
}

fn int_or_null(v: &Value, lo: i64, hi: i64, what: &str) -> Result<Option<u32>, SettingsError> {
    if v.is_null() {
        return Ok(None);
    }
    Ok(Some(int(v, lo, hi, what)? as u32))
}

fn one_of<'a>(v: &'a Value, list: &[&str], what: &str) -> Result<String, SettingsError> {
    if let Some(s) = v.as_str() {
        if list.contains(&s) {
            return Ok(s.to_string());
        }
    }
    bad(format!("{}: ungültiger Wert.", what))
}

fn bool_of(v: &Value, msg: &str) -> Result<bool, SettingsError> {
    match v.as_bool() {
        Some(b) => Ok(b),
        None => bad(msg),
    }
}

fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Mischt ein Teilobjekt `patch` geprüft in `cur` und liefert die neuen Einstellungen.
pub fn merge(cur: &Settings, patch: &Value) -> Result<Settings, SettingsError> {
    let obj = match patch {
        Value::Object(o) => o,
        _ => return bad("Ungültige Einstellungen."),
    };
    let mut s = cur.clone();
    for (k, v) in obj.iter() {
        match k.as_str() {
            "variant" => s.variant = one_of(v, &VARIANTS, "Variante")?,
            "dense" => s.dense = bool_of(v, "Inselabstand: ja/nein erwartet.")?,
            "aspect" => {
                s.aspect = if v.is_null() {
                    None
                } else {
                    match v.as_f64() {
                        Some(x) if x.is_finite() && x >= 0.5 && x <= 3.0 => {
                            Some(js_round(x * 100.0) / 100.0)
                        }
                        _ => return bad("Seitenverhältnis: Zahl von 0,5 bis 3 erwartet."),
                    }
                }
            }
            "plannedPlayers" => s.planned_players = int(v, 2, 6, "Geplante Spielerzahl")? as u32,
            "dice" => s.dice = one_of(v, &["manuell", "auto"], "Würfeln")?,
            "robber" => s.robber = one_of(v, &["manuell", "auto"], "Räuber")?,
            "winPoints" => s.win_points = int(v, 3, 30, "Siegpunkte")? as u32,
            "handLimit" => s.hand_limit = int_or_null(v, 3, 50, "Handkarten-Limit")?,
            "bankRate" => s.bank_rate = int(v, 2, 6, "Bankkurs")? as u32,
            "playerTrade" => s.player_trade = bool_of(v, "Spielerhandel: ja/nein erwartet.")?,
            "islandBonus" => s.island_bonus = int(v, 0, 5, "Inselpunkte")? as u32,
            "islandBonusMax" => s.island_bonus_max = int(v, 0, 20, "Max. Inseln")? as u32,
            "longestMin" => s.longest_min = int(v, 3, 15, "Längster Handelsweg ab")? as u32,
            "armyMin" => s.army_min = int(v, 2, 10, "Stärkste Schutzmacht ab")? as u32,
            "goldHome" => s.gold_home = bool_of(v, "Goldfluss auf der Startinsel: ja/nein erwartet.")?,
            "goldStart" => s.gold_start = bool_of(v, "Erstsiedlung am Goldfluss: ja/nein erwartet.")?,
            "goldRate" => s.gold_rate = int(v, 1, 5, "Ertragsrate Goldfluss")? as u32,
            "leaver" => s.leaver = one_of(v, &["uebernahme", "verschwinden"], "Verhalten bei Verlassen")?,
            "devReturn" => s.dev_return = bool_of(v, "Entwicklungskarten zurücklegen: ja/nein erwartet.")?,
            "vanishRounds" => s.vanish_rounds = int(v, 1, 30, "Runden bis zum Verschwinden")? as u32,
            "limits" => {
                if !is_obj(v) {
                    return bad("Limits: Objekt erwartet.");
                }
                let lo = v.as_object().unwrap();
                for (lk, lv) in lo.iter() {
                    match lk.as_str() {
                        "road" | "ship" | "settlement" | "city" => {
                            let x = int_or_null(lv, 1, 99, "Figurenlimit")?;
                            match lk.as_str() {
                                "road" => s.limits.road = x,
                                "ship" => s.limits.ship = x,
                                "settlement" => s.limits.settlement = x,
                                _ => s.limits.city = x,
                            }
                        }
                        "dev" => {
                            if !is_obj(lv) {
                                s.limits.dev = if lv.as_str() == Some("standard") {
                                    dev_limits(&Value::String("standard".into()))
                                } else {
                                    let n = int(lv, 1, 99, "Entwicklungskarten")? as u32;
                                    spread_total(n)
                                };
                                continue;
                            }
                            // bestehende Werte normalisieren, dann je Art überschreiben
                            let cur_map: IndexMap<String, DevLimit> = s.limits.dev.clone();
                            let mut normalized = IndexMap::new();
                            for k in DEV {
                                let val = cur_map.get(k).cloned().unwrap_or_else(|| dev_std(k));
                                normalized.insert(k.to_string(), val);
                            }
                            s.limits.dev = normalized;
                            for (x, xv) in lv.as_object().unwrap().iter() {
                                if !DEV.contains(&x.as_str()) {
                                    return bad(format!(
                                        "Entwicklungskarten: unbekannte Art „{}“.",
                                        x
                                    ));
                                }
                                let val = if xv.as_str() == Some("standard") {
                                    DevLimit::Standard
                                } else {
                                    DevLimit::N(int(xv, 0, 99, "Entwicklungskarten")? as u32)
                                };
                                s.limits.dev.insert(x.clone(), val);
                            }
                        }
                        "bank" | "fogTerrain" | "fogChips" => {
                            if !is_obj(lv) {
                                return bad(format!("{}: Objekt erwartet.", lk));
                            }
                            let keys: Vec<&str> = match lk.as_str() {
                                "bank" => RES.to_vec(),
                                "fogTerrain" => TERRAINS.to_vec(),
                                _ => CHIP_KEYS.to_vec(),
                            };
                            let what = match lk.as_str() {
                                "bank" => "Bank-Vorrat",
                                "fogTerrain" => "Feld-Vorrat",
                                _ => "Chip-Vorrat",
                            };
                            for (x, xv) in lv.as_object().unwrap().iter() {
                                if lk == "fogChips" && x == "7" {
                                    continue; // eine 7 gibt es nicht als Wertechip (Räuber-Wurf)
                                }
                                if !keys.contains(&x.as_str()) {
                                    return bad(format!("{}: unbekannter Eintrag „{}“.", lk, x));
                                }
                                let val = int_or_null(xv, 0, 99, what)?;
                                let target = match lk.as_str() {
                                    "bank" => &mut s.limits.bank,
                                    "fogTerrain" => &mut s.limits.fog_terrain,
                                    _ => &mut s.limits.fog_chips,
                                };
                                if let Some(slot) = target.get_mut(x) {
                                    *slot = val;
                                } else {
                                    target.insert(x.clone(), val);
                                }
                            }
                        }
                        _ => return bad(format!("Unbekanntes Limit „{}“.", lk)),
                    }
                }
            }
            _ => return bad(format!("Unbekannte Einstellung „{}“.", k)),
        }
    }
    Ok(s)
}

/// Anzahl einer Entwicklungskarten-Art nach Einstellung (Standard → Grundspiel/Erweiterung).
pub fn dev_count(dev: &IndexMap<String, DevLimit>, k: &str, players: usize) -> u32 {
    match dev.get(k) {
        Some(DevLimit::Standard) => rules::dev_std(players)
            .iter()
            .find(|(x, _)| *x == k)
            .map(|(_, v)| *v)
            .unwrap_or(0),
        Some(DevLimit::N(n)) => *n,
        None => 0,
    }
}
