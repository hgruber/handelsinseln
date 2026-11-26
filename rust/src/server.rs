// HTTP-Server: statische Dateien, SSE, Aktions-API, Spieleverwaltung und WebRTC-Signalweg.
// HTTP/HTTPS, SSE, API und Persistenz; TLS-Konfiguration in tls.rs (gzip für SSE gibt es nicht).
use std::collections::HashMap;
use std::io::{self, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

use crate::arm;
use crate::game::{now_ms, truthy, GameError};
use crate::http::{self, Request};
use crate::hub::{Hub, HubError, JoinReq, Room};
use crate::log;
use crate::pair;
use crate::rng::Rng;

static STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

extern "C" fn stop_handler(_sig: i32) {
    STOP.store(true, std::sync::atomic::Ordering::SeqCst);
}

fn install_signal_handlers() {
    unsafe extern "C" {
        fn signal(signum: i32, handler: usize) -> usize;
    }
    unsafe {
        signal(2, stop_handler as extern "C" fn(i32) as usize); // SIGINT
        signal(15, stop_handler as extern "C" fn(i32) as usize); // SIGTERM
    }
}

pub struct Client {
    pub id: u64,
    pub tx: Sender<Vec<u8>>,
    pub table_mode: bool,
}

pub type Clients = HashMap<String, Vec<Client>>;

pub struct Inner {
    pub hub: Hub,
    pub clients: Clients,
    pub next_client_id: u64,
    pub rate: HashMap<String, (u32, i64)>,
    pub pair_tries: (u32, i64),
    /// Ratenschutz für /api/person und /api/person/resume (Pass ist ein Orakel).
    pub person_tries: (u32, i64),
    pub dirty_since: Option<i64>,
    pub version: String,
    pub data_dir: PathBuf,
    pub no_save: bool,
    pub stun: Option<String>,
    pub https_port: Option<u16>,
    pub server_id: String,
}

#[derive(Clone)]
pub struct App {
    pub inner: Arc<Mutex<Inner>>,
    pub root: Arc<PathBuf>,
}

fn sse(event: &str, data: &Value) -> Vec<u8> {
    format!(
        "event: {}\ndata: {}\n\n",
        event,
        serde_json::to_string(data).unwrap_or_else(|_| "null".into())
    )
    .into_bytes()
}

fn send_token(clients: &Clients, token: &str, bytes: &[u8]) {
    if let Some(list) = clients.get(token) {
        for c in list {
            let _ = c.tx.send(bytes.to_vec());
        }
    }
}

impl Inner {
    fn send_token(&self, token: &str, bytes: &[u8]) {
        send_token(&self.clients, token, bytes);
    }
    fn drop_clients(&mut self, token: &str, event: Option<&str>) {
        if let Some(list) = self.clients.remove(token) {
            for c in list {
                if let Some(ev) = event {
                    let _ = c.tx.send(sse(ev, &json!({})));
                }
            }
        }
    }
    fn mark_dirty(&mut self) {
        self.dirty_since = Some(now_ms());
    }
    fn save(&mut self) {
        if self.no_save {
            return;
        }
        let data = match serde_json::to_string(&self.hub.to_json()) {
            Ok(s) => s,
            Err(e) => {
                log::error("speichern_fehler", &[("fehler", e.to_string())]);
                return;
            }
        };
        if let Err(e) = std::fs::create_dir_all(&self.data_dir) {
            log::error("speichern_fehler", &[("fehler", e.to_string())]);
            return;
        }
        let tmp = self.data_dir.join("state.json.tmp");
        let target = self.data_dir.join("state.json");
        if let Err(e) = std::fs::write(&tmp, data).and_then(|_| std::fs::rename(&tmp, &target)) {
            log::error("speichern_fehler", &[("fehler", e.to_string())]);
        }
        self.dirty_since = None;
    }

    fn broadcast(&mut self, room_id: &str) {
        if !self.hub.rooms.contains_key(room_id) {
            return;
        }
        let version = self.version.clone();
        let data_dir = self.data_dir.clone();
        let no_save = self.no_save;
        let clients = &self.clients;
        let room = self.hub.rooms.get_mut(room_id).unwrap();
        let phase = room.game.S.phase.clone();
        let was = room.last_phase.clone();
        room.last_phase = Some(phase.clone());
        let transition = was.as_deref() != Some(phase.as_str());
        let started = transition && phase == "setup";
        let ended_now = transition && phase == "ended";
        let back_lobby = transition && phase == "lobby" && was.as_deref() == Some("ended");
        let resumed = transition && was.as_deref() == Some("ended") && phase != "lobby";
        if started {
            let S = &room.game.S;
            let players: Vec<String> = S
                .players
                .iter()
                .map(|p| {
                    format!(
                        "{}{}",
                        p.name,
                        if p.bot.is_some() {
                            "(Bot)"
                        } else if p.is_table_guest() {
                            "(Tisch)"
                        } else {
                            ""
                        }
                    )
                })
                .collect();
            log::info(
                "partie_start",
                &[
                    ("raum", room.id.clone()),
                    ("variante", S.settings.variant.clone()),
                    ("ziel", S.settings.win_points.to_string()),
                    ("tisch", S.settings.table.to_string()),
                    ("spieler", players.join(",")),
                ],
            );
        }
        let players: Vec<(usize, Option<String>)> =
            room.game.S.players.iter().map(|p| (p.id, p.token.clone())).collect();
        for (pid, tok) in players.iter() {
            if let Some(t) = tok {
                let has = clients.get(t).map(|l| !l.is_empty()).unwrap_or(false);
                if !has {
                    continue;
                }
                let v = pview(room, clients, *pid);
                send_token(clients, t, &sse("state", &v));
            }
        }
        // Digitaler Spieltisch: die Tisch-Verbindung des Spielleiters bekommt zusätzlich die Sicht aller Spieler
        let host_tok = room
            .game
            .S
            .players
            .get(room.game.S.host)
            .and_then(|p| p.token.clone());
        if let Some(ht) = host_tok {
            if room.game.S.settings.table
                && (room.game.S.phase == "main" || room.game.S.phase == "setup")
            {
                let tabs: Vec<&Client> = clients
                    .get(&ht)
                    .map(|l| l.iter().filter(|c| c.table_mode).collect())
                    .unwrap_or_default();
                if !tabs.is_empty() {
                    let pub_view = wview(room, clients);
                    let ids: Vec<usize> = room.game.S.players.iter().map(|p| p.id).collect();
                    let views: Vec<Value> = ids
                        .into_iter()
                        .map(|pid| {
                            if room.game.is_table_player(pid) {
                                pview(room, clients, pid)
                            } else {
                                pub_view.clone()
                            }
                        })
                        .collect();
                    let data = json!({"views": views});
                    let bytes = sse("table", &data);
                    for c in tabs {
                        let _ = c.tx.send(bytes.clone());
                    }
                }
            }
        }
        // Zuschauer: nur die öffentliche Sicht
        if !room.watchers.is_empty() {
            let toks: Vec<String> = room.watchers.keys().cloned().collect();
            let mut wv: Option<Vec<u8>> = None;
            for tok in toks {
                let has = clients.get(&tok).map(|l| !l.is_empty()).unwrap_or(false);
                if !has {
                    continue;
                }
                if wv.is_none() {
                    wv = Some(sse("state", &wview(room, clients)));
                }
                if let Some(bytes) = &wv {
                    send_token(clients, &tok, bytes);
                }
            }
        }
        if ended_now {
            report(room, None, &version, &data_dir, no_save);
        } else if back_lobby {
            log::info("neue_runde", &[("raum", room.id.clone())]);
        } else if resumed {
            log::info(
                "partie_weiter",
                &[("raum", room.id.clone()), ("ziel", room.game.S.settings.win_points.to_string())],
            );
        }
        self.dirty_since = Some(now_ms());
    }
}

fn displays(room: &Room, clients: &Clients) -> usize {
    let w = room
        .watchers
        .keys()
        .filter(|t| clients.get(*t).map(|l| !l.is_empty()).unwrap_or(false))
        .count();
    w + if table_stream(room, clients) { 1 } else { 0 }
}

fn table_stream(room: &Room, clients: &Clients) -> bool {
    if !room.game.S.settings.table {
        return false;
    }
    let tok = match room.game.S.players.get(room.game.S.host).and_then(|p| p.token.clone()) {
        Some(t) => t,
        None => return false,
    };
    clients.get(&tok).map(|l| l.iter().any(|c| c.table_mode)).unwrap_or(false)
}

fn pview(room: &mut Room, clients: &Clients, pid: usize) -> Value {
    let mut v = room.game.view(Some(pid));
    let disp = displays(room, clients) > 0;
    let av = arm::view_for(room, Some(pid));
    if let Some(o) = v.as_object_mut() {
        o.insert("display".into(), json!(disp));
        o.insert("arm".into(), av);
    }
    v
}

fn wview(room: &mut Room, _clients: &Clients) -> Value {
    let mut v = room.game.watch_view();
    let av = arm::view_for(room, None);
    if let Some(o) = v.as_object_mut() {
        o.insert("arm".into(), av);
    }
    v
}

fn kind_of(p: &crate::model::Player) -> String {
    if let Some(b) = &p.bot {
        format!("bot:{}", b)
    } else if p.is_table_guest() {
        "tisch".into()
    } else {
        "mensch".into()
    }
}

fn report(room: &Room, reason: Option<&str>, version: &str, data_dir: &Path, no_save: bool) {
    let g = &room.game;
    let S = &g.S;
    let st = match &S.stats {
        Some(s) => s,
        None => return,
    };
    let end = st.ended_at.unwrap_or_else(now_ms);
    let result = if S.phase != "ended" {
        "abgebrochen"
    } else if S.aborted {
        "beendet"
    } else {
        "sieg"
    };
    let rounds = st.history.iter().filter(|h| h.end != Some(true)).count();
    let winner = S
        .winner
        .and_then(|w| S.players.get(w))
        .map(|p| p.name.clone());
    let players: Vec<Value> = S
        .players
        .iter()
        .map(|p| {
            json!({
                "name": p.name, "color": p.color, "kind": kind_of(p),
                "vp": g.vp(p.id) + g.hidden_vp(p.id) as i64,
                "left": p.left, "vanished": p.vanished,
                "personId": p.person_id,
                "stats": st.players.get(p.id),
            })
        })
        .collect();
    let rec = json!({
        "room": room.id,
        "version": version,
        "startedAt": http::iso_time(st.started_at),
        "endedAt": http::iso_time(end),
        "minutes": ((end - st.started_at) as f64 / 60000.0).round() as i64,
        "rounds": rounds,
        "result": result,
        "reason": reason,
        "winner": winner,
        "settings": &S.settings,
        "players": players,
        "history": st.history.iter().map(|h| json!(h.vp)).collect::<Vec<_>>(),
    });
    log::info(
        "partie_ende",
        &[
            ("raum", room.id.clone()),
            ("ergebnis", result.to_string()),
            ("sieger", winner.unwrap_or_default()),
            ("runden", rounds.to_string()),
            ("dauer", format!("{}min", ((end - st.started_at) as f64 / 60000.0).round() as i64)),
            ("grund", reason.unwrap_or("").to_string()),
        ],
    );
    if no_save {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(data_dir) {
        log::error("bericht_fehler", &[("raum", room.id.clone()), ("fehler", e.to_string())]);
        return;
    }
    let line = format!("{}\n", rec);
    use std::io::Write as _;
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("partien.jsonl"))
        .and_then(|mut f| f.write_all(line.as_bytes()))
    {
        Ok(_) => {}
        Err(e) => log::error("bericht_fehler", &[("raum", room.id.clone()), ("fehler", e.to_string())]),
    }
}

// ---------- Anfragen ----------

pub fn handle_conn<S: Read + Write + Send + 'static>(app: App, stream: S) {
    let mut reader = BufReader::new(stream);
    loop {
        let req = match http::read_request(&mut reader) {
            Ok(Some(r)) => r,
            _ => break,
        };
        if req.method == "GET" && req.path == "/api/events" {
            events(&app, reader.get_mut(), &req);
            return;
        }
        if handle(&app, reader.get_mut(), &req).is_err() {
            break;
        }
        if reader.get_mut().flush().is_err() {
            break;
        }
    }
}

fn json_error<W: Write>(stream: &mut W, code: u16, msg: &str, games: Option<&[Value]>) -> io::Result<()> {
    let mut v = json!({ "error": msg });
    if let Some(g) = games {
        v.as_object_mut().unwrap().insert("games".into(), json!(g));
    }
    http::send_json(stream, code, &v)
}

fn parse_body(req: &Request) -> Result<Value, String> {
    if req.body.len() > 20000 {
        return Err("Anfrage zu groß".into());
    }
    req.json()
}

fn handle<W: Write>(app: &App, stream: &mut W, req: &Request) -> io::Result<()> {
    let path = req.path.as_str();
    if path == "/api/games" || path == "/api/lobby" {
        let inner = app.inner.lock().unwrap();
        let games = inner.hub.list();
        return http::send_json(stream, 200, &json!({ "games": games }));
    }
    if path == "/api/config" {
        let inner = app.inner.lock().unwrap();
        return http::send_json(
            stream,
            200,
            &json!({
                "stun": inner.stun,
                "httpsPort": inner.https_port,
                "version": inner.version,
                "serverId": inner.server_id,
            }),
        );
    }
    if req.method == "POST"
        && [
            "/api/join",
            "/api/watch",
            "/api/pick",
            "/api/act",
            "/api/leave",
            "/api/signal",
            "/api/pair",
            "/api/pair/claim",
            "/api/pair/check",
            "/api/person",
            "/api/person/link",
            "/api/person/resume",
        ]
        .contains(&path)
    {
        return handle_post(app, stream, req, path);
    }
    let head_only = req.method == "HEAD";
    http::serve_static(stream, req, &app.root, head_only)
}

fn handle_post<W: Write>(app: &App, stream: &mut W, req: &Request, path: &str) -> io::Result<()> {
    let b = match parse_body(req) {
        Ok(v) => v,
        Err(e) => return json_error(stream, 400, &e, None),
    };
    let token = b.get("token").and_then(|v| v.as_str()).map(|s| s.to_string());
    let mut inner = app.inner.lock().unwrap();

    // Der Pass ist über die Personen-ID ein Orakel: Anfragen mengenbegrenzen (global, 300/min).
    if path == "/api/person" || path == "/api/person/resume" {
        let now = now_ms();
        let e = &mut inner.person_tries;
        if now - e.1 > 60_000 {
            *e = (0, now);
        }
        e.0 += 1;
        if e.0 > 300 {
            return json_error(stream, 429, "Zu viele Pass-Anfragen – bitte kurz warten.", None);
        }
    }

    if path == "/api/watch" {
        let game = b.get("game").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let out = match inner.hub.watch(&game) {
            Ok(o) => o,
            Err(e) => return json_error(stream, 400, &e.msg, None),
        };
        let count = inner.hub.rooms.get(&out.game).map(|r| r.watchers.len()).unwrap_or(0);
        log::info(
            "zuschauer",
            &[("raum", out.game.clone()), ("anzahl", count.to_string())],
        );
        return http::send_json(stream, 200, &json!({"token": out.token, "game": out.game, "watch": true}));
    }

    // ---------- Gerätekopplung (Nonce) ----------
    if path == "/api/pair" {
        let pid_b = b.get("pid").and_then(|v| v.as_u64()).map(|x| x as usize);
        let owner = token.as_deref().and_then(|t| inner.hub.find_by_token(t));
        let (rid, pid) = match owner {
            Some((rid, pid)) => {
                let host_table = inner
                    .hub
                    .rooms
                    .get(&rid)
                    .map(|r| pid == r.game.S.host && r.game.S.settings.table)
                    .unwrap_or(false);
                let allowed_other = pid_b
                    .and_then(|x| inner.hub.rooms.get(&rid).and_then(|r| r.game.S.players.get(x)).map(|_| x));
                let bind = match pid_b {
                    Some(x) if x == pid => Some(x),
                    Some(_) if host_table => allowed_other.or(Some(pid)),
                    _ => Some(pid),
                };
                (rid, bind)
            }
            None => {
                let g = match b.get("game").and_then(|v| v.as_str()) {
                    Some(g) if !g.is_empty() => g.to_string(),
                    _ => return json_error(stream, 400, "Bitte ein Spiel angeben.", None),
                };
                if !inner.hub.rooms.contains_key(&g) {
                    return json_error(stream, 400, "Dieses Spiel gibt es nicht mehr.", None);
                }
                (g, pid_b)
            }
        };
        let p = pair::offer(inner.hub.rooms.get_mut(&rid).unwrap(), pid);
        log::info(
            "kopplung_angebot",
            &[
                ("raum", rid.clone()),
                ("platz", pid.map(|x| x.to_string()).unwrap_or_else(|| "-".into())),
            ],
        );
        return http::send_json(
            stream,
            200,
            &json!({
                "nonce": p.nonce, "secret": p.secret, "game": rid, "pid": p.pid,
                "ms": (p.until - now_ms()).max(0),
            }),
        );
    }

    if path == "/api/pair/claim" {
        let key = b.get("nonce").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if key.is_empty() {
            return json_error(stream, 400, "Kein Kopplungscode angegeben.", None);
        }
        let now = now_ms();
        let e = &mut inner.pair_tries;
        if now - e.1 > 60_000 {
            *e = (0, now);
        }
        e.0 += 1;
        if e.0 > 60 {
            return json_error(stream, 429, "Zu viele Versuche – bitte kurz warten.", None);
        }
        let rid = match inner.hub.find_pair(&key) {
            Some(r) => r,
            None => return json_error(stream, 400, "Dieser Kopplungscode gilt nicht mehr.", None),
        };
        let claimant = b
            .get("token")
            .and_then(|v| v.as_str())
            .and_then(|t| inner.hub.find_by_token(t))
            .filter(|(r, _)| r == &rid)
            .map(|(_, pid)| pid);
        let room = inner.hub.rooms.get_mut(&rid).unwrap();
        match pair::claim(room, &key, claimant) {
            Ok(pair::Claim::Receiver { token, pid }) => {
                log::info(
                    "kopplung_uebernommen",
                    &[("raum", rid.clone()), ("platz", pid.to_string())],
                );
                http::send_json(
                    stream,
                    200,
                    &json!({"role": "receiver", "token": token, "game": rid, "pid": pid}),
                )
            }
            Ok(pair::Claim::Giver { pid }) => {
                log::info(
                    "kopplung_verbunden",
                    &[("raum", rid.clone()), ("platz", pid.to_string())],
                );
                http::send_json(
                    stream,
                    200,
                    &json!({"role": "giver", "game": rid, "pid": pid}),
                )
            }
            Err(e) => json_error(stream, 400, &e.0, None),
        }
    } else if path == "/api/pair/check" {
        let key = b.get("nonce").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let secret = b.get("secret").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let rid = match inner.hub.find_pair(&key) {
            Some(r) => r,
            None => return json_error(stream, 400, "Dieser Kopplungscode gilt nicht mehr.", None),
        };
        let mut out = {
            let room = inner.hub.rooms.get(&rid).unwrap();
            match pair::check(room, &key, &secret) {
                Some(v) => v,
                None => return json_error(stream, 403, "Ungültiges Angebot.", None),
            }
        };
        if let Some(o) = out.as_object_mut() {
            o.insert("game".into(), json!(rid));
        }
        http::send_json(stream, 200, &out)
    } else if path == "/api/person" {
        let id = match b.get("personId").and_then(|v| v.as_str()).and_then(norm_person) {
            Some(x) => x,
            None => return json_error(stream, 400, "Ungültige Personen-ID.", None),
        };
        let mut partien: Vec<Value> = Vec::new();
        for room in inner.hub.rooms.values() {
            if room.game.S.phase == "ended" {
                continue;
            }
            let paused_room = room.paused_at.is_some();
            for p in &room.game.S.players {
                if p.person_id.as_deref() != Some(id.as_str()) {
                    continue;
                }
                // Laufend und erreichbar – oder der Platz wartet (verlassen bzw. Partie pausiert)
                // und lässt sich über den Pass fortsetzen, auch wenn die Partie schon weiterläuft.
                let laufend = !paused_room && !p.left && p.token.is_some();
                if !laufend && !(paused_room || p.left) {
                    continue;
                }
                partien.push(json!({
                    "game": room.id, "name": p.name, "pid": p.id,
                    "phase": room.game.S.phase, "running": true, "paused": !laufend,
                    "token": if laufend { json!(p.token) } else { Value::Null },
                    "winner": room.game.S.winner,
                    // Mitspieler ohne die eigene Zeile – der eigene Name steht schon als Titel.
                    "players": room.game.S.players.iter().filter(|q| !q.left && q.id != p.id).map(|q| json!({"name": q.name})).collect::<Vec<_>>(),
                }));
            }
        }
        let laufend = partien.len();
        partien.extend(archiv_partien(&inner.data_dir, &id));
        log::info("person_partien", &[("laufend", laufend.to_string()), ("gesamt", partien.len().to_string())]);
        http::send_json(stream, 200, &json!({"partien": partien}))
    } else if path == "/api/person/link" {
        let id = match b.get("personId").and_then(|v| v.as_str()).and_then(norm_person) {
            Some(x) => x,
            None => return json_error(stream, 400, "Ungültige Personen-ID.", None),
        };
        let (rid, pid) = match token.as_deref().and_then(|t| inner.hub.find_by_token(t)) {
            Some(f) => f,
            None => return json_error(stream, 401, "Unbekannte Sitzung – bitte neu anmelden.", None),
        };
        if let Some(room) = inner.hub.rooms.get_mut(&rid) {
            if let Some(p) = room.game.S.players.get_mut(pid) {
                p.person_id = Some(id);
            }
        }
        inner.mark_dirty();
        http::send_json(stream, 200, &json!({"ok": true}))
    } else if path == "/api/person/resume" {
        let id = match b.get("personId").and_then(|v| v.as_str()).and_then(norm_person) {
            Some(x) => x,
            None => return json_error(stream, 400, "Ungültige Personen-ID.", None),
        };
        let rid = match b.get("game").and_then(|v| v.as_str()) {
            Some(g) => g.to_string(),
            None => return json_error(stream, 400, "Keine Partie angegeben.", None),
        };
        let mut out: Option<(String, usize)> = None;
        let mut err: Option<String> = None;
        match inner.hub.rooms.get_mut(&rid) {
            None => err = Some("Diese Partie gibt es nicht mehr.".into()),
            Some(room) => {
                if room.game.S.phase == "ended" {
                    err = Some("Diese Partie ist beendet.".into());
                } else {
                    let pid = room.game.S.players.iter().position(|p| {
                        p.person_id.as_deref() == Some(id.as_str()) && p.bot.is_none() && !p.is_table_guest()
                    });
                    match pid {
                        None => err = Some("Zu dieser Partie gehört kein Platz mit deinem Spielerpass.".into()),
                        Some(pid) => {
                            {
                                let p = room.game.pl_mut(pid);
                                p.left = false;
                                p.auto = false;
                                p.connected = false;
                            }
                            match crate::pair::take_token(room, pid) {
                                Ok(tok) => {
                                    room.paused_at = None;
                                    room.empty_since = Some(crate::game::now_ms());
                                    out = Some((tok, pid));
                                }
                                Err(e) => err = Some(e.0),
                            }
                        }
                    }
                }
            }
        }
        if let Some(e) = err {
            return json_error(stream, 400, &e, None);
        }
        match out {
            Some((tok, pid)) => {
                inner.broadcast(&rid);
                inner.mark_dirty();
                log::info("pause_fortgesetzt", &[("raum", rid.clone()), ("platz", pid.to_string())]);
                http::send_json(stream, 200, &json!({"ok": true, "token": tok, "game": rid, "pid": pid}))
            }
            None => json_error(stream, 400, "Diese Partie lässt sich nicht fortsetzen.", None),
        }
    } else {
        drop(inner);
        handle_post_game(app, stream, token, b, path)
    }
}

/// Personen-ID: 64 Hex-Zeichen (HMAC-SHA256), Kleinbuchstaben.
fn norm_person(s: &str) -> Option<String> {
    let s = s.trim().to_ascii_lowercase();
    if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(s)
    } else {
        None
    }
}

/// Abgeschlossene Partien der Person aus partien.jsonl.
fn archiv_partien(data_dir: &Path, id: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let s = match std::fs::read_to_string(data_dir.join("partien.jsonl")) {
        Ok(s) => s,
        Err(_) => return out,
    };
    for line in s.lines() {
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let ps = match v.get("players").and_then(|p| p.as_array()) {
            Some(p) => p,
            None => continue,
        };
        for (i, p) in ps.iter().enumerate() {
            if p.get("personId").and_then(|x| x.as_str()) != Some(id) {
                continue;
            }
            out.push(json!({
                "game": v.get("room"), "name": p.get("name"), "vp": p.get("vp"),
                "startedAt": v.get("startedAt"), "endedAt": v.get("endedAt"), "result": v.get("result"),
                "reason": v.get("reason"), "winner": v.get("winner"), "rounds": v.get("rounds"),
                "minutes": v.get("minutes"), "settings": v.get("settings"), "history": v.get("history"),
                "running": false,
                // Alle Plätze für den Endstand; `you` markiert den eigenen.
                "players": ps.iter().enumerate().map(|(j, q)| json!({
                    "name": q.get("name"), "color": q.get("color"), "kind": q.get("kind"),
                    "vp": q.get("vp"), "you": j == i,
                })).collect::<Vec<_>>(),
            }));
        }
    }
    out
}

/// Beitritt, Aktionen und Kontrollübergabe (nach den Kopplungs-Endpunkten).
fn handle_post_game<W: Write>(
    app: &App,
    stream: &mut W,
    token: Option<String>,
    b: Value,
    path: &str,
) -> io::Result<()> {
    let mut inner = app.inner.lock().unwrap();
    let watcher = token.as_deref().and_then(|t| inner.hub.find_watcher(t));

    if path == "/api/pick" {
        let t = b.get("t").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let k = b.get("k").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let kind = b.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let found = token.as_deref().and_then(|tok| inner.hub.find_by_token(tok));
        let room_id = match (&watcher, &found) {
            (Some(w), _) => Some(w.clone()),
            (None, Some((rid, pid))) => {
                let is_host_table = inner
                    .hub
                    .rooms
                    .get(rid)
                    .map(|r| *pid == r.game.S.host && table_stream(r, &inner.clients))
                    .unwrap_or(false);
                if is_host_table {
                    Some(rid.clone())
                } else {
                    None
                }
            }
            _ => None,
        };
        let rid = match room_id {
            Some(r) => r,
            None => {
                return json_error(
                    stream,
                    403,
                    "Nur eine Tisch-Anzeige (Zuschauer oder Spieltisch) kann Ziele wählen.",
                    None,
                )
            }
        };
        let room = inner.hub.rooms.get_mut(&rid).unwrap();
        if let Err(e) = arm::pick(room, &t, &k, &kind) {
            return json_error(stream, 400, &e.0, None);
        }
        inner.broadcast(&rid);
        return http::send_json(stream, 200, &json!({"ok": true}));
    }

    if watcher.is_some() {
        if path != "/api/leave" {
            return json_error(stream, 403, "Zuschauer können nicht mitspielen.", None);
        }
        let rid = watcher.unwrap();
        if let Some(tok) = &token {
            if let Some(room) = inner.hub.rooms.get_mut(&rid) {
                room.watchers.shift_remove(tok);
            }
            inner.drop_clients(tok, None);
        }
        return http::send_json(stream, 200, &json!({"ok": true}));
    }

    if path == "/api/join" {
        let jr = JoinReq {
            token,
            game: b.get("game").and_then(|v| v.as_str()).map(|s| s.to_string()),
            create: b.get("create").map(truthy).unwrap_or(false),
            name: b.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            color: b.get("color").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            avatar: b.get("avatar").and_then(|v| v.as_str()).map(|s| s.to_string()),
        };
        let out = match inner.hub.join(jr) {
            Ok(o) => o,
            Err(HubError { msg, games }) => {
                return json_error(stream, 400, &msg, games.as_deref());
            }
        };
        {
            let p = inner.hub.rooms.get(&out.game).map(|r| r.game.S.players.get(out.pid).cloned());
            if let Some(Some(p)) = p {
                let fields = vec![
                    ("raum", out.game.clone()),
                    ("spieler", p.name.clone()),
                    ("pid", out.pid.to_string()),
                    ("farbe", p.color.clone()),
                ];
                if out.again {
                    log::debug("wieder_angemeldet", &fields);
                } else {
                    log::info("beitritt", &fields);
                }
            }
        }
        inner.broadcast(&out.game);
        return http::send_json(
            stream,
            200,
            &json!({"token": out.token, "pid": out.pid, "game": out.game}),
        );
    }

    let (rid, pid) = match token.as_deref().and_then(|t| inner.hub.find_by_token(t)) {
        Some(f) => f,
        None => return json_error(stream, 401, "Unbekannte Sitzung – bitte neu anmelden.", None),
    };
    let tok = token.clone().unwrap_or_default();

    if path == "/api/leave" {
        let (name, phase) = inner
            .hub
            .rooms
            .get(&rid)
            .and_then(|r| r.game.S.players.get(pid).map(|p| (p.name.clone(), r.game.S.phase.clone())))
            .unwrap_or_default();
        log::info(
            "verlassen",
            &[("raum", rid.clone()), ("spieler", name), ("phase", phase)],
        );
        if let Some(room) = inner.hub.rooms.get_mut(&rid) {
            room.game.leave(&tok);
        }
        inner.drop_clients(&tok, None);
        let humans = inner
            .hub
            .rooms
            .get(&rid)
            .map(|r| r.game.humans().len())
            .unwrap_or(0);
        let pause_ok = inner.hub.rooms.get(&rid).map(crate::hub::darf_pausieren).unwrap_or(false);
        if humans == 0 {
            // Mit Spielerpass für alle Menschen bleibt die Partie als Pause stehen.
            if pause_ok {
                if let Some(room) = inner.hub.rooms.get_mut(&rid) {
                    room.paused_at = Some(crate::game::now_ms());
                    room.empty_since = None;
                }
                log::info("pausiert", &[("raum", rid.clone())]);
                inner.save();
            } else {
                room_gone(&mut inner, &rid, "alle Menschen haben verlassen");
                drop_room(&mut inner, &rid);
                inner.save();
            }
        } else {
            inner.broadcast(&rid);
        }
        return http::send_json(stream, 200, &json!({"ok": true}));
    }

    if path == "/api/signal" {
        let now = now_ms();
        let entry = inner.rate.entry(tok.clone()).or_insert((0, now));
        if now - entry.1 > 10_000 {
            entry.0 = 0;
            entry.1 = now;
        }
        entry.0 += 1;
        if entry.0 > 200 {
            return json_error(stream, 429, "Zu viele Signale.", None);
        }
        let data = b.get("data").cloned().unwrap_or_else(|| json!({}));
        if serde_json::to_string(&data).map(|s| s.len()).unwrap_or(0) > 16000 {
            return json_error(stream, 400, "Signal zu groß.", None);
        }
        let targets: Vec<usize> = {
            let room = inner.hub.rooms.get(&rid).unwrap();
            let to = b.get("to");
            if to.and_then(|v| v.as_str()) == Some("all") {
                room.game.S.players.iter().map(|p| p.id).filter(|i| *i != pid).collect()
            } else {
                to.and_then(|v| v.as_u64())
                    .map(|x| x as usize)
                    .filter(|i| *i != pid && room.game.S.players.get(*i).is_some())
                    .into_iter()
                    .collect()
            }
        };
        let msg = sse("signal", &json!({"from": pid, "data": data}));
        for t in targets {
            let ptok = inner
                .hub
                .rooms
                .get(&rid)
                .and_then(|r| r.game.S.players.get(t))
                .and_then(|p| p.token.clone());
            if let Some(pt) = ptok {
                inner.send_token(&pt, &msg);
            }
        }
        return http::send_json(stream, 200, &json!({"ok": true}));
    }

    // ---------- /api/act ----------
    let ty = b.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if ty == "arm" || ty == "disarm" {
        let room = inner.hub.rooms.get_mut(&rid).unwrap();
        let res = if ty == "arm" {
            arm::arm(room, pid, b.get("mode").and_then(|v| v.as_str())).map(|_| ())
        } else {
            arm::disarm(room, pid);
            Ok(())
        };
        if let Err(e) = res {
            return json_error(stream, 400, &e.0, None);
        }
        inner.broadcast(&rid);
        return http::send_json(stream, 200, &json!({"ok": true}));
    }
    let mut actor = pid;
    if let Some(as_pid) = b.get("as").and_then(|v| v.as_u64()) {
        let as_pid = as_pid as usize;
        if as_pid != pid {
            let ok = {
                let room = inner.hub.rooms.get(&rid).unwrap();
                room.game.S.settings.table
                    && pid == room.game.S.host
                    && room.game.is_table_player(as_pid)
            };
            if !ok {
                return json_error(
                    stream,
                    400,
                    "Der digitale Spieltisch ist nicht aktiv, oder der Spieler sitzt nicht am Tisch.",
                    None,
                );
            }
            actor = as_pid;
        }
    }
    let kicked = if ty == "kick" {
        b.get("pid")
            .and_then(|v| v.as_u64())
            .and_then(|x| inner.hub.rooms.get(&rid).and_then(|r| r.game.S.players.get(x as usize)))
            .map(|p| p.name.clone())
    } else {
        None
    };
    let result = {
        let room = inner.hub.rooms.get_mut(&rid).unwrap();
        room.game.last_kicked = None;
        let r = room.game.act(actor, &b);
        (r, room.game.last_kicked.clone())
    };
    let (r, last_kicked) = result;
    if let Err(GameError(msg)) = r {
        return json_error(stream, 400, &msg, None);
    }
    if let Some(t) = last_kicked {
        log::info(
            "entfernt",
            &[
                ("raum", rid.clone()),
                ("spieler", kicked.unwrap_or_default()),
                ("durch", inner.name_of(&rid, pid)),
            ],
        );
        inner.drop_clients(&t, Some("kicked"));
    }
    inner.broadcast(&rid);
    http::send_json(stream, 200, &json!({"ok": true}))
}

impl Inner {
    fn name_of(&self, rid: &str, pid: usize) -> String {
        self.hub
            .rooms
            .get(rid)
            .and_then(|r| r.game.S.players.get(pid))
            .map(|p| p.name.clone())
            .unwrap_or_default()
    }
}

fn room_gone(inner: &mut Inner, rid: &str, reason: &str) {
    let version = inner.version.clone();
    let data_dir = inner.data_dir.clone();
    let no_save = inner.no_save;
    if let Some(room) = inner.hub.rooms.get(rid) {
        if room.game.S.phase == "setup" || room.game.S.phase == "main" {
            let why = room.removed_why.clone().unwrap_or_else(|| reason.to_string());
            report(room, Some(&why), &version, &data_dir, no_save);
        }
    }
}

fn drop_room(inner: &mut Inner, rid: &str) {
    let room = match inner.hub.remove_room(rid) {
        Some(r) => r,
        None => return,
    };
    for p in &room.game.S.players {
        if let Some(t) = &p.token {
            inner.drop_clients(t, None);
        }
    }
    for tok in room.watchers.keys() {
        inner.drop_clients(tok, Some("closed"));
    }
    log::info(
        "raum_weg",
        &[
            ("raum", rid.to_string()),
            ("phase", room.game.S.phase.clone()),
            ("grund", room.removed_why.clone().unwrap_or_default()),
        ],
    );
    inner.mark_dirty();
}

// ---------- Ereignisstrom ----------

fn events<W: Write>(app: &App, stream: &mut W, req: &Request) {
    let token = req.q("token").unwrap_or("").to_string();
    let want_table = req.q("table") == Some("1");
    let (rx, client_id, room_id, is_watcher, pid, initial) = {
        let mut inner = app.inner.lock().unwrap();
        let found = inner.hub.find_by_token(&token);
        let watcher = if found.is_none() {
            inner.hub.find_watcher(&token)
        } else {
            None
        };
        if found.is_none() && watcher.is_none() {
            drop(inner);
            let _ = http::write_head(
                stream,
                401,
                &[("Content-Type", "text/plain; charset=utf-8".into())],
                Some(0),
            );
            return;
        }
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        inner.next_client_id += 1;
        let cid = inner.next_client_id;
        let (rid, p_id, isw) = if let Some(w) = watcher {
            let table_mode = false;
            inner.clients.entry(token.clone()).or_default().push(Client {
                id: cid,
                tx,
                table_mode,
            });
            if let Some(room) = inner.hub.rooms.get_mut(&w) {
                if let Some(x) = room.watchers.get_mut(&token) {
                    x.gone = None;
                }
                room.game.settle();
            }
            (w, 0usize, true)
        } else {
            let (rid, pidv) = found.unwrap();
            let table_mode = want_table
                && inner
                    .hub
                    .rooms
                    .get(&rid)
                    .map(|r| pidv == r.game.S.host)
                    .unwrap_or(false);
            inner.clients.entry(token.clone()).or_default().push(Client {
                id: cid,
                tx,
                table_mode,
            });
            inner.hub.connect_player(&rid, pidv);
            if let Some(room) = inner.hub.rooms.get_mut(&rid) {
                room.game.settle();
            }
            (rid, pidv, false)
        };
        let v = {
            let iref: &mut Inner = &mut inner;
            let clients = &iref.clients;
            let room = iref.hub.rooms.get_mut(&rid).unwrap();
            if isw {
                wview(room, clients)
            } else {
                pview(room, clients, p_id)
            }
        };
        let mut bytes = b"retry: 2000\n\n".to_vec();
        bytes.extend_from_slice(&sse("state", &v));
        inner.broadcast(&rid);
        drop(inner);
        (rx, cid, rid, isw, p_id, bytes)
    };
    let _ = http::write_head(
        stream,
        200,
        &[
            ("Content-Type", "text/event-stream".into()),
            ("Cache-Control", "no-store".into()),
            ("X-Accel-Buffering", "no".into()),
        ],
        None,
    );
    let _ = stream.write_all(&initial);
    let _ = stream.flush();
    let ping_ms = std::env::var("SSE_PING_MS")
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(20_000)
        .max(50);
    loop {
        match rx.recv_timeout(Duration::from_millis(ping_ms)) {
            Ok(msg) => {
                if stream.write_all(&msg).is_err() || stream.flush().is_err() {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if stream.write_all(b"event: ping\ndata: 1\n\n").is_err() {
                    break;
                }
                let _ = stream.flush();
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    let mut inner = app.inner.lock().unwrap();
    remove_client(&mut inner, &token, client_id);
    let last = inner.clients.get(&token).map(|l| l.is_empty()).unwrap_or(true);
    if last {
        inner.clients.remove(&token);
        if is_watcher {
            if let Some(room) = inner.hub.rooms.get_mut(&room_id) {
                if let Some(w) = room.watchers.get_mut(&token) {
                    w.gone = Some(now_ms());
                }
            }
            inner.broadcast(&room_id);
        } else {
            inner.hub.disconnect_player(&room_id, pid);
            inner.broadcast(&room_id);
        }
    }
}

fn remove_client(inner: &mut Inner, token: &str, id: u64) {
    if let Some(list) = inner.clients.get_mut(token) {
        list.retain(|c| c.id != id);
    }
}

// ---------- Start ----------

pub struct Options {
    pub listen: Option<String>,
    pub port: u16,
    pub data_dir: PathBuf,
    pub root: PathBuf,
    pub no_save: bool,
    pub version: String,
    pub stun: Option<String>,
    pub https_port: Option<u16>,
    pub tls_hosts: String,
    pub tick_ms: u64,
    pub bot_ms: u64,
}

impl App {
    pub fn start_state(&mut self) {
        let mut inner = self.inner.lock().unwrap();
        inner.save();
    }
}

pub fn run(opts: Options) -> io::Result<()> {
    install_signal_handlers();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let seed = Rng::from_env().unwrap_or_else(random_rng);
    let rnd = Arc::new(Mutex::new(seed));
    let mut hub = Hub::new(rnd);
    let state_file = opts.data_dir.join("state.json");
    if let Ok(s) = std::fs::read_to_string(&state_file) {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            hub.load(&v, 300_000);
            log::info("spielstand_geladen", &[("spiele", hub.rooms.len().to_string())]);
        }
    }
    let mut https_port = opts.https_port;
    let mut tls_setup: Option<(Arc<rustls::ServerConfig>, TcpListener)> = None;
    if let Some(p) = https_port {
        match crate::tls::build(&opts.data_dir, &opts.tls_hosts) {
            Ok(cfg) => match TcpListener::bind(("0.0.0.0", p)) {
                Ok(l) => tls_setup = Some((cfg, l)),
                Err(e) => {
                    log::error("tls_fehler", &[("fehler", e.to_string())]);
                    https_port = None;
                }
            },
            Err(e) => {
                log::error("tls_fehler", &[("fehler", e)]);
                https_port = None;
            }
        }
    }
    let inner = Arc::new(Mutex::new(Inner {
        hub,
        clients: HashMap::new(),
        next_client_id: 0,
        rate: HashMap::new(),
        pair_tries: (0, 0),
        person_tries: (0, 0),
        dirty_since: None,
        version: opts.version.clone(),
        data_dir: opts.data_dir.clone(),
        no_save: opts.no_save,
        stun: opts.stun.clone(),
        https_port,
        server_id: ensure_server_id(&opts.data_dir),
    }));
    let app = App { inner: inner.clone(), root: Arc::new(opts.root.clone()) };
    let addr = match &opts.listen {
        Some(l) => l.clone(),
        None => format!("0.0.0.0:{}", opts.port),
    };
    let listener = TcpListener::bind(&addr)?;
    log::info(
        "start",
        &[
            ("version", opts.version.clone()),
            ("http", addr.clone()),
            ("https", https_port.map(|p| p.to_string()).unwrap_or_else(|| "aus".into())),
            ("daten", opts.data_dir.to_string_lossy().to_string()),
        ],
    );
    // Pflege: Abwesende → Auto-Modus, verwaiste Spiele aufräumen, entprellt speichern
    {
        let app2 = app.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(opts.tick_ms.max(100)));
            let mut inner = app2.inner.lock().unwrap();
            if STOP.load(std::sync::atomic::Ordering::SeqCst) {
                inner.save();
                log::info("stop", &[("signal", "SIGTERM/SIGINT".into())]);
                std::process::exit(0);
            }
            let (changed, remove) = inner.hub.tick();
            if !changed.is_empty() || !remove.is_empty() {
                inner.mark_dirty();
            }
            for rid in remove {
                room_gone(&mut inner, &rid, "niemand mehr verbunden");
                drop_room(&mut inner, &rid);
            }
            for rid in &changed {
                inner.broadcast(rid);
            }
            let ids: Vec<String> = inner.hub.rooms.keys().cloned().collect();
            for rid in ids {
                let before = inner.hub.rooms.get(&rid).map(|r| r.game.S.v).unwrap_or(0);
                if let Some(room) = inner.hub.rooms.get_mut(&rid) {
                    room.game.settle();
                    if room.game.S.v != before {
                        inner.broadcast(&rid);
                    }
                }
            }
            if let Some(since) = inner.dirty_since {
                if now_ms() - since >= 300 {
                    inner.save();
                }
            }
        });
    }
    // Bots ziehen im Takt
    {
        let app3 = app.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(opts.bot_ms.max(50)));
            let mut inner = app3.inner.lock().unwrap();
            let ids: Vec<String> = inner.hub.rooms.keys().cloned().collect();
            for rid in ids {
                let changed = {
                    let rnd = inner.hub.rnd.clone();
                    match inner.hub.rooms.get_mut(&rid) {
                        Some(room) if room.paused_at.is_none() => crate::bots::bot_tick(room, &rnd),
                        _ => false,
                    }
                };
                if changed {
                    inner.broadcast(&rid);
                }
            }
        });
    }
    if let Some((cfg, tls_listener)) = tls_setup {
        let app_tls = app.clone();
        thread::spawn(move || {
            for stream in tls_listener.incoming() {
                if let Ok(s) = stream {
                    let _ = s.set_nodelay(true);
                    let app = app_tls.clone();
                    let cfg = cfg.clone();
                    thread::spawn(move || {
                        if let Ok(conn) = rustls::ServerConnection::new(cfg) {
                            handle_conn(app, rustls::StreamOwned::new(conn, s));
                        }
                    });
                }
            }
        });
    }
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                let app = app.clone();
                thread::spawn(move || handle_conn(app, s));
            }
            Err(_) => continue,
        }
    }
    Ok(())
}

fn random_rng() -> Rng {
    use std::io::Read;
    let mut b = [0u8; 4];
    let seed = std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut b).map(|_| ()))
        .map(|_| u32::from_le_bytes(b))
        .unwrap_or_else(|_| now_ms() as u32);
    Rng::seeded(seed)
}

/// Stabile Kennung dieser Installation (für die servergebundene Personen-ID).
fn ensure_server_id(data_dir: &Path) -> String {
    let file = data_dir.join("server.json");
    if let Ok(s) = std::fs::read_to_string(&file) {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            if let Some(id) = v.get("serverId").and_then(|x| x.as_str()) {
                if !id.is_empty() {
                    return id.to_string();
                }
            }
        }
    }
    let id = crate::game_lobby::random_hex(16);
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(&file, serde_json::to_string(&json!({"serverId": id})).unwrap_or_default());
    id
}
