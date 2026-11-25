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
use crate::handover;
use crate::http::{self, Request};
use crate::hub::{Hub, HubError, JoinReq, Room};
use crate::log;
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
    pub dirty_since: Option<i64>,
    pub version: String,
    pub data_dir: PathBuf,
    pub no_save: bool,
    pub stun: Option<String>,
    pub https_port: Option<u16>,
}

#[derive(Clone)]
pub struct App {
    pub inner: Arc<Mutex<Inner>>,
    pub root: Arc<PathBuf>,
}

const HOST_ACTS: [&str; 10] = [
    "set_settings", "end_game", "resume_game", "new_game", "regen_board", "close_seats",
    "add_bot", "add_table_player", "kick", "start",
];

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
    fn notify(&self, token: &str, event: &str, data: &Value) {
        self.send_token(token, &sse(event, data));
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
        let players: Vec<(usize, Option<String>, Option<String>)> = room
            .game
            .S
            .players
            .iter()
            .map(|p| (p.id, p.token.clone(), p.phone.clone()))
            .collect();
        for (pid, tok, phone) in players.iter() {
            for t in [tok.clone(), phone.clone()].into_iter().flatten() {
                let has = clients.get(&t).map(|l| !l.is_empty()).unwrap_or(false);
                if !has {
                    continue;
                }
                let via_phone = phone.as_deref() == Some(t.as_str());
                let v = pview(room, clients, *pid, via_phone);
                send_token(clients, &t, &sse("state", &v));
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
                                pview(room, clients, pid, false)
                            } else {
                                pub_view.clone()
                            }
                        })
                        .collect();
                    let data = json!({"views": views, "requests": handover::pending(room)});
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

fn pview(room: &mut Room, clients: &Clients, pid: usize, via_phone: bool) -> Value {
    let mut v = room.game.view(Some(pid));
    let disp = displays(room, clients) > 0;
    let av = arm::view_for(room, Some(pid));
    if let Some(o) = v.as_object_mut() {
        o.insert("display".into(), json!(disp));
        o.insert("arm".into(), av);
        if via_phone {
            o.insert("host".into(), json!(-1));
        }
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
            }),
        );
    }
    if req.method == "POST"
        && [
            "/api/join",
            "/api/watch",
            "/api/pick",
            "/api/handover",
            "/api/act",
            "/api/leave",
            "/api/signal",
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

    let watcher = token.as_deref().and_then(|t| inner.hub.find_watcher(t));

    if path == "/api/pick" {
        let t = b.get("t").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let k = b.get("k").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let kind = b.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let found = token.as_deref().and_then(|tok| inner.hub.find_by_token(tok));
        let room_id = match (&watcher, &found) {
            (Some(w), _) => Some(w.clone()),
            (None, Some((rid, pid, false))) => {
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

    if path == "/api/handover" {
        let rid = match &watcher {
            Some(w) => w.clone(),
            None => {
                return json_error(stream, 403, "Nur ein zusehendes Gerät kann Kontrolle anfragen.", None)
            }
        };
        let pid = b.get("pid").and_then(|v| v.as_u64()).unwrap_or(u64::MAX) as usize;
        let tok = token.clone().unwrap_or_default();
        let room = inner.hub.rooms.get_mut(&rid).unwrap();
        let (req_, replaced, ttl) = match handover::request(room, &tok, pid) {
            Ok(x) => x,
            Err(e) => return json_error(stream, 400, &e.0, None),
        };
        if let Some(old) = replaced {
            inner.notify(&old.token, "handover", &json!({"state": "replaced", "pid": old.pid}));
        }
        schedule_expire(app.inner.clone(), rid.clone(), ttl);
        inner.broadcast(&rid);
        return http::send_json(
            stream,
            200,
            &json!({"code": req_.code, "ttl": ttl, "pid": req_.pid}),
        );
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

    let (rid, pid, phone) = match token.as_deref().and_then(|t| inner.hub.find_by_token(t)) {
        Some(f) => f,
        None => return json_error(stream, 401, "Unbekannte Sitzung – bitte neu anmelden.", None),
    };
    let tok = token.clone().unwrap_or_default();

    if path == "/api/leave" {
        let host_pid = inner.hub.rooms.get(&rid).map(|r| r.game.S.host).unwrap_or(0);
        let is_handover = inner
            .hub
            .rooms
            .get(&rid)
            .and_then(|r| r.game.S.players.get(pid))
            .map(|p| p.handover == Some(true) && (phone || pid != host_pid))
            .unwrap_or(false);
        if is_handover {
            let room = inner.hub.rooms.get_mut(&rid).unwrap();
            let ctl = match handover::hand_back(room, pid) {
                Ok(t) => t,
                Err(e) => return json_error(stream, 400, &e.0, None),
            };
            log::info(
                "kontrolle_tisch",
                &[("raum", rid.clone()), ("spieler", inner.name_of(&rid, pid)), ("pid", pid.to_string())],
            );
            inner.notify(&ctl, "control_end", &json!({}));
            inner.drop_clients(&ctl, None);
            inner.broadcast(&rid);
            return http::send_json(stream, 200, &json!({"ok": true}));
        }
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
        if humans == 0 {
            room_gone(&mut inner, &rid, "alle Menschen haben verlassen");
            drop_room(&mut inner, &rid);
            inner.save();
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
    if ty == "handover_answer" {
        let tpid = b.get("pid").and_then(|v| v.as_u64()).unwrap_or(u64::MAX) as usize;
        let code = b.get("code").map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }).unwrap_or_default();
        let accept = b.get("accept").map(truthy).unwrap_or(false);
        let (r, accepted, host_pid, pname) = {
            let room = inner.hub.rooms.get_mut(&rid).unwrap();
            let is_host = !phone && pid == room.game.S.host && room.game.S.settings.table;
            if !is_host {
                return json_error(stream, 400, "Nur der Spieltisch kann Kontrollanfragen beantworten.", None);
            }
            let host_pid = room.game.S.host;
            let pname = room.game.S.players.get(tpid).map(|p| p.name.clone()).unwrap_or_default();
            match handover::answer(room, tpid, &code, accept) {
                Ok((r, acc)) => (r, acc, host_pid, pname),
                Err(e) => return json_error(stream, 400, &e.0, None),
            }
        };
        if accepted {
            inner.notify(
                &r.token,
                "control",
                &json!({"pid": r.pid, "host": r.pid == host_pid}),
            );
            log::info(
                "kontrolle_handy",
                &[
                    ("raum", rid.clone()),
                    ("spieler", pname),
                    ("pid", r.pid.to_string()),
                ],
            );
        } else {
            inner.notify(&r.token, "handover", &json!({"state": "declined", "pid": r.pid}));
        }
        inner.broadcast(&rid);
        return http::send_json(stream, 200, &json!({"ok": true}));
    }
    if ty == "handback" {
        let table = !phone
            && inner
                .hub
                .rooms
                .get(&rid)
                .map(|r| pid == r.game.S.host)
                .unwrap_or(false);
        let table = table
            && inner
                .hub
                .rooms
                .get(&rid)
                .map(|r| r.game.S.settings.table)
                .unwrap_or(false);
        let target = if table {
            b.get("pid").and_then(|v| v.as_u64()).map(|x| x as usize).unwrap_or(pid)
        } else {
            pid
        };
        let room = inner.hub.rooms.get_mut(&rid).unwrap();
        let has = room
            .game
            .S
            .players
            .get(target)
            .map(|o| o.handover == Some(true))
            .unwrap_or(false);
        if !has {
            return json_error(stream, 400, "Dieser Platz wird nicht von einem Handy gesteuert.", None);
        }
        let ctl = if target == room.game.S.host {
            room.game.S.players[target].phone.clone()
        } else {
            room.game.S.players[target].token.clone()
        }
        .unwrap_or_default();
        let given = b.get("token").map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }).unwrap_or_default();
        if given != ctl && !table {
            return json_error(stream, 400, "Das darfst du nicht.", None);
        }
        let t = match handover::hand_back(room, target) {
            Ok(t) => t,
            Err(e) => return json_error(stream, 400, &e.0, None),
        };
        log::info(
            "kontrolle_tisch",
            &[("raum", rid.clone()), ("durch", inner.name_of(&rid, pid))],
        );
        inner.notify(&t, "control_end", &json!({}));
        inner.drop_clients(&t, None);
        inner.broadcast(&rid);
        return http::send_json(stream, 200, &json!({"ok": true}));
    }

    if phone && HOST_ACTS.contains(&ty.as_str()) {
        return json_error(stream, 403, "Das Handy hat keine Spielleiter-Rechte.", None);
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
    if actor == pid && !phone {
        let controlled = inner
            .hub
            .rooms
            .get(&rid)
            .and_then(|r| r.game.S.players.get(actor))
            .and_then(|p| p.phone.clone())
            .is_some();
        if controlled && !HOST_ACTS.contains(&ty.as_str()) && ty != "chat" {
            return json_error(stream, 400, "Dieser Platz wird gerade von einem Handy gesteuert.", None);
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

fn schedule_expire(app: Arc<Mutex<Inner>>, rid: String, ttl: i64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis((ttl + 60) as u64));
        let mut inner = app.lock().unwrap();
        let gone = match inner.hub.rooms.get_mut(&rid) {
            Some(room) => handover::expire(room),
            None => return,
        };
        for r in &gone {
            inner.notify(&r.token, "handover", &json!({"state": "expired", "pid": r.pid}));
        }
        if !gone.is_empty() {
            inner.broadcast(&rid);
        }
    });
}

// ---------- Ereignisstrom ----------

fn events<W: Write>(app: &App, stream: &mut W, req: &Request) {
    let token = req.q("token").unwrap_or("").to_string();
    let want_table = req.q("table") == Some("1");
    let (rx, client_id, room_id, is_watcher, pid, phone, initial) = {
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
        let (rid, p_id, ph, isw) = if let Some(w) = watcher {
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
            (w, 0usize, false, true)
        } else {
            let (rid, pidv, phonev) = found.unwrap();
            let table_mode = !phonev
                && want_table
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
            (rid, pidv, phonev, false)
        };
        let v = {
            let iref: &mut Inner = &mut inner;
            let clients = &iref.clients;
            let room = iref.hub.rooms.get_mut(&rid).unwrap();
            if isw {
                wview(room, clients)
            } else {
                pview(room, clients, p_id, ph)
            }
        };
        let mut bytes = b"retry: 2000\n\n".to_vec();
        bytes.extend_from_slice(&sse("state", &v));
        inner.broadcast(&rid);
        drop(inner);
        (rx, cid, rid, isw, p_id, ph, bytes)
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
        } else if !phone {
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
        dirty_since: None,
        version: opts.version.clone(),
        data_dir: opts.data_dir.clone(),
        no_save: opts.no_save,
        stun: opts.stun.clone(),
        https_port,
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
                        Some(room) => crate::bots::bot_tick(room, &rnd),
                        None => false,
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
