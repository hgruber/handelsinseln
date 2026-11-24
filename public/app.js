// app.js – Zustand, Netzwerk, Brett (SVG, diff-basiert), HUD, Modale.
(function () {
  'use strict';
  const { Geom, Art } = window;
  const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
  const RN = Art.RES_NAMES;
  const COST = {
    road: { lehm: 1, holz: 1 }, ship: { wolle: 1, holz: 1 }, settlement: { lehm: 1, holz: 1, wolle: 1, getreide: 1 },
    city: { erz: 3, getreide: 2 }, dev: { erz: 1, wolle: 1, getreide: 1 },
  };
  const BUILD_LABEL = { road: 'Straße', ship: 'Schiff', settlement: 'Siedlung', city: 'Stadt', dev: 'Entwicklungskarte' };
  const DEV_HELP = {
    ritter: 'Ritter: Räuber versetzen und eine Karte stehlen. 3 gespielte Ritter = Stärkste Schutzmacht (2 Punkte).',
    siegpunkt: 'Siegpunkt: bleibt verdeckt, zählt 1 Punkt.',
    strassenbau: 'Straßenbau: baue 2 Wege (Straße/Schiff) kostenlos.',
    erfindung: 'Erfindung: nimm 2 beliebige Rohstoffe aus der Bank.',
    monopol: 'Monopol: alle Mitspieler geben dir ihre Karten einer Sorte.',
  };
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const compactMQ = matchMedia('(max-width: 900px), (max-height: 520px)'); // Handy/kleines Tablet: kompaktes HUD (siehe style.css)
  const compact = () => compactMQ.matches;
  const S = 100;

  const st = {
    token: localStorage.getItem('handelsinseln.token') || null, view: null, mode: null, moveFrom: null, mock: null,
    es: null, logOpen: false, tab: 'log', modal: null, modalKey: '', draft: {}, draftKey: '',
    ctlPref: localStorage.getItem('handelsinseln.ctl') === '1', ctl: false,
    openPc: null, firstBoard: true, known: new Set(), lastSeq: null, lastHand: null, chatSeen: 0, seenChat: -1, color: null,
  };

  // ======================================================================================
  // Hilfen
  // ======================================================================================
  const setHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; return true; } return false; };
  const V = () => st.view;
  const colorOf = (pid) => { const p = st.view && st.view.players[pid]; return (p && Art.COLORS[p.color]) || '#888'; };
  const initial = (n) => (Array.from(String(n || '?'))[0] || '?').toUpperCase();
  const avatar = (pid, size = 30) => {
    const p = st.view.players[pid];
    const pic = p && p.avatar;
    return `<span class="av${pic ? ' pic' : ''}" style="--pc:${colorOf(pid)};--sz:${size}px" aria-hidden="true">${pic ? `<img src="img/av/${esc(pic)}.webp" alt="" draggable="false">` : esc(initial(p && p.name))}</span>`;
  };
  const sumO = (o) => RES.reduce((a, r) => a + (o && o[r] > 0 ? o[r] : 0), 0);
  const missingOf = (hand, need) => RES.filter((r) => (need[r] || 0) > (hand[r] || 0)).map((r) => `${need[r] - (hand[r] || 0)}× ${RN[r]}`);
  const costChips = (kind) => RES.filter((r) => COST[kind][r]).map((r) => `<span class="cc">${Art.res(r, 16)}${COST[kind][r] > 1 ? '<b>' + COST[kind][r] + '</b>' : ''}</span>`).join('');
  const isMe = () => st.view && st.view.turn === st.view.you;
  const setg = () => (st.view && st.view.settings) || {};
  // Auto-Ablauf (Einstellung „dice“): Hinweise verschwinden von selbst, Karten fliegen schnell; sonst Klick zum Wegklicken und langsamere Animation
  const autoFlow = () => setg().dice === 'auto';
  const autoRobber = () => setg().robber === 'auto';
  const fmtLeft = (n) => (n >= 900 ? '∞' : String(n));

  let toastN = 0;
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || 'err'); t.textContent = msg;
    const box = $('toasts'); box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    const id = ++toastN; void id;
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 400); };
    const live = st.view && (st.view.phase === 'main' || st.view.phase === 'setup');
    if (live && !autoFlow() && kind !== 'err') { t.classList.add('sticky'); t.title = 'Zum Schließen klicken'; t.addEventListener('click', close); }
    else setTimeout(close, 4200);
  }

  // ======================================================================================
  // Netzwerk
  // ======================================================================================
  async function post(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let j = {}; try { j = await r.json(); } catch (_) { /* leer */ }
      if (!r.ok && !j.error) j.error = `Fehler (HTTP ${r.status})`;
      j.status = r.status;
      return j;
    } catch (e) { return { error: 'Keine Verbindung zum Server.' }; }
  }
  // Aktionen des Spielleiters selbst (nie im Namen eines Mitspielers)
  const OWN_ACTS = new Set(['set_settings', 'end_game', 'resume_game', 'new_game', 'regen_board', 'close_seats', 'add_bot', 'kick', 'chat', 'start']);
  async function act(type, params, asPid) {
    if (st.mock) { toast(`Mock-Modus: „${type}“ ${JSON.stringify(params || {})} nicht gesendet`, 'info'); console.log('act', type, params); return { ok: true }; }
    const body = Object.assign({ token: st.token, type }, params || {});
    if (st.tableOn && !OWN_ACTS.has(type)) { const who = asPid != null ? asPid : st.view && st.view.you; if (who != null) body.as = who; } // Spieltisch: im Namen des Fokus-Spielers
    const j = await post('/api/act', body);
    if (j.status === 401) { logout('Die Sitzung ist abgelaufen – bitte neu anmelden.'); return j; }
    if (j.error) toast(j.error, 'err');
    return j;
  }
  function setOnline(on) { $('conn').hidden = on; }
  addEventListener('pagehide', () => { st.unloading = true; });
  addEventListener('pageshow', () => { st.unloading = false; }); // Seite kommt aus dem Zurück-Cache wieder
  function connect() {
    if (st.es) st.es.close();
    const es = new EventSource('/api/events?token=' + encodeURIComponent(st.token) + (st.tableStream ? '&table=1' : ''));
    st.es = es;
    es.addEventListener('state', (e) => { setOnline(true); try { const v = JSON.parse(e.data); if (v.watch) watchState(v); else if (!tableState(v)) applyView(v); } catch (err) { console.error(err); } });
    es.addEventListener('table', (e) => { setOnline(true); try { tableViews(JSON.parse(e.data).views); } catch (err) { console.error(err); } });
    es.addEventListener('closed', () => logout('Das Spiel ist nicht mehr verfügbar.'));
    es.addEventListener('signal', (e) => { try { Voice.onSignal(JSON.parse(e.data)); } catch (err) { console.error(err); } });
    es.addEventListener('kicked', () => { Lobby.setNotice('Du wurdest vom Spielleiter entfernt.'); logout('Du wurdest vom Spielleiter entfernt.'); });
    es.onopen = () => setOnline(true);
    es.onerror = () => {
      if (st.unloading) return; // Neuladen/Tab schließen: der Browser bricht die Verbindung selbst ab, das ist kein Sitzungsende
      if (es.readyState === EventSource.CLOSED) logout('Die Sitzung ist abgelaufen – bitte neu anmelden.');
      else setOnline(false);
    };
  }
  // ---- Digitaler Spieltisch ---------------------------------------------------------------------------
  // Läuft der Tisch (Einstellung „table“, nur Spielleiter, nur im Spiel), kommt die Anzeige aus dem Ereignis „table“.
  function tableState(v) {
    const want = !!(v.settings && v.settings.table) && v.you === v.host && (v.phase === 'main' || v.phase === 'setup');
    if (want && !st.tableStream) { st.tableStream = true; connect(); return true; }
    if (!want && st.tableStream) { st.tableStream = false; st.tableOn = false; Table.deactivate(); st.tv = null; connect(); return true; }
    return want;
  }
  function tableViews(views) {
    if (!st.tableStream || !views || !views.length) return;
    const first = !st.tableOn;
    st.tableOn = true; st.tv = views;
    Table.activate(views);
    const focus = Table.focusOf(views);
    applyView(views[focus]);
    Table.render(views, focus);
    if (first) { fit(true); setTimeout(() => fit(false), 120); }
  }
  // ---- Zuschauer ----------------------------------------------------------------------------------------
  // Wer zusieht, bekommt nur die öffentliche Sicht (Ereignis „state“ mit watch:true) und sieht sie wie am Spieltisch: Plätze rund ums Brett, ohne geheimen Bereich.
  function watchState(v) {
    if (v.phase === 'lobby') { logout('Das Spiel wurde beendet.'); return; }
    const first = !st.tableOn;
    st.watch = true; st.tableOn = true; st.tableStream = false;
    document.body.classList.add('watch');
    Table.activate();
    const views = v.players.map(() => v);
    applyView(v);
    Table.render(views, Table.focusOf(views), true);
    if (first) { fit(true); setTimeout(() => fit(false), 120); }
  }
  function logout(msg) {
    Voice.leave(true);
    if (st.es) st.es.close(); st.es = null;
    st.tableStream = false; st.tableOn = false; st.tv = null; st.watch = false; st.ctl = false; document.body.classList.remove('watch', 'ctl'); Table.deactivate();
    localStorage.removeItem('handelsinseln.token'); st.token = null; st.view = null; setOnline(true);
    st.mode = null; st.moveFrom = null; st.known = new Set(); st.firstBoard = true; st.lastSeq = null; st.lobbySig = ''; st.lobbySeen = false; boardClear();
    Lobby.resetLocal(); Menu.hideStats(); document.getElementById('dlgRoot').replaceChildren(); Menu.closeMenu();
    if (msg) toast(msg, 'warn');
    showScreens();
  }
  // Menuepunkt „Spiel verlassen“ / Lobby verlassen
  async function leaveGame() {
    if (!st.mock) await post('/api/leave', { token: st.token });
    logout();
  }

  // ======================================================================================
  // Anmeldung / Lobby
  // ======================================================================================
  // Anmeldung (Spieleliste) und Lobby-Bildschirm: siehe lobby.js
  function joined(j) {
    st.token = j.token; localStorage.setItem('handelsinseln.token', j.token);
    showScreens(); connect();
  }

  // ======================================================================================
  // Sichtbarkeit der Bildschirme
  // ======================================================================================
  function showScreens() {
    const v = st.view;
    const inGame = !!v && v.phase !== 'lobby';
    const wasLogin = !$('login').hidden;
    $('login').hidden = !!(v || st.token || (st.mock && !st.loginMock));
    $('lobby').hidden = !(v && v.phase === 'lobby');
    $('hud').hidden = !inGame;
    $('board').toggleAttribute('hidden', !v);
    document.body.dataset.screen = !v ? 'login' : v.phase;
    if (v && v.phase !== 'ended') Menu.hideStats();
    if (!$('login').hidden && !wasLogin) Lobby.loginShown();
  }

  // ======================================================================================
  // View anwenden
  // ======================================================================================
  function applyView(v) {
    const old = st.view;
    st.view = v;
    syncCtl(v);
    const mute = (x) => (x && x.watch ? Object.assign({}, x, { you: -1 }) : x); Sound.onView(mute(old), mute(v)); // Zuschauer: nie „mein Zug“
    if (!old) Fx.reset(); // neue Sitzung: bisherige Kartenbewegungen nicht nachspielen
    if (old && old.phase !== v.phase && v.phase === 'lobby') { st.mode = null; st.moveFrom = null; st.known = new Set(); st.firstBoard = true; st.lobbySig = ''; st.lastSeq = null; boardClear(); }
    // Modus-Aufraeumen: nur gueltig im eigenen Hauptschritt
    if (!(isMe() && (v.step === 'main' || v.step === 'sbp'))) { st.mode = null; st.moveFrom = null; }
    if (st.moveFrom && !(v.legal && v.legal.shipTo && v.legal.shipTo[st.moveFrom])) st.moveFrom = null;
    showScreens();
    if (v.phase === 'lobby') {
      renderBoard(v); Lobby.renderLobby(v);
      const sig = v.hexes.length + '|' + (v.fog || []).length + '|' + v.hexes.map((h) => h.k + h.t + (h.n || '')).join(',');
      if (sig !== st.lobbySig) { st.lobbySig = sig; fit(!st.lobbySeen); st.lobbySeen = true; }
      return;
    }
    if (old && old.phase === 'lobby') setTimeout(() => fit(false), 60);
    if (v.phase === 'ended' && v.stats) { renderGame(v, old); Menu.renderStats(v); if (!old || old.phase !== 'ended') Voice.leave(false); return; }
    renderGame(v, old);
  }

  // ---- Controller-Ansicht (Handy als Steuerung, das Spielfeld zeigt die Tisch-Anzeige) ----------------
  // Sie gilt nur, solange im Spiel eine Tisch-Anzeige (Zuschauer) verbunden ist; die Wahl des Spielers bleibt gemerkt.
  function syncCtl(v) {
    const on = !!(st.ctlPref && v && !v.watch && v.display && (v.phase === 'main' || v.phase === 'setup'));
    if (on === st.ctl) return;
    st.ctl = on; document.body.classList.toggle('ctl', on);
    if (on) { st.mode = null; st.moveFrom = null; } else setTimeout(() => { if (V()) fit(false); }, 80);
  }
  function toggleCtl() {
    st.ctlPref = !st.ctlPref; localStorage.setItem('handelsinseln.ctl', st.ctlPref ? '1' : '0');
    const v = V(); syncCtl(v); if (v) { renderHUD(v); renderTargets(v); }
  }
  const ARM_NAME = { settlement: 'Siedlung', city: 'Stadt', road: 'Straße', ship: 'Schiff', takeover: 'Übernahme', move: 'Schiff versetzen' };
  const FORCED_NAME = { setup_settlement: 'Siedlung', setup_road: 'Straße oder Schiff', road_building: 'Straße oder Schiff', robber: 'Räuber oder Pirat' };
  // Freigabe-Fenster: erst wenn der Spieler hier etwas aktiviert, lässt sich am Tisch ein Ziel wählen; gebaut wird erst nach seiner Bestätigung
  function renderArm(v) {
    const el = $('armPanel'); let html = '';
    if (st.ctl && !v.watch) {
      const ar = v.arm, mine = isMe();
      if (ar && ar.pick) {
        html = `<div class="arm confirm"><span class="aq">Bestätigen?</span><b class="al">${esc(ar.pick.label || '')}</b><span class="aw">${esc(ar.pick.where || '')}</span>` +
          '<div class="aact"><button type="button" class="btn green big" data-arm="confirm">Ja, ausführen</button><button type="button" class="btn ghostb" data-arm="again">Anderes Ziel</button></div></div>';
      } else if (ar) {
        const what = ARM_NAME[ar.mode] || FORCED_NAME[ar.step] || '';
        const second = ar.mode === 'move' && ar.moveFrom ? ' – jetzt das Ziel' : ar.mode === 'move' ? ' – erst das Schiff' : '';
        html = `<div class="arm wait"><span class="aq">Schau auf den Spieltisch</span><b class="al">${esc(what)}${esc(second)}</b><span class="aw">Tippe dort das Ziel an – danach bestätigst du hier.</span>` +
          '<div class="aact"><button type="button" class="btn ghostb" data-arm="cancel">Abbrechen</button></div></div>';
      } else if (mine && FORCED_NAME[v.step] && !(v.step === 'robber' && autoRobber())) {
        html = `<div class="arm go"><span class="aq">Du bist dran</span><b class="al">${esc(FORCED_NAME[v.step])} setzen</b><span class="aw">Die Auswahl erscheint auf dem Spieltisch.</span>` +
          '<div class="aact"><button type="button" class="btn gold big" data-arm="start">Am Spieltisch wählen</button>' + (v.step === 'road_building' ? '<button type="button" class="btn ghostb" data-a="skip_rb">Überspringen</button>' : '') + '</div></div>';
      }
    }
    el.hidden = !html; setHTML(el, html);
  }
  $('armPanel').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-arm]'); if (!b) return;
    const w = b.dataset.arm;
    if (w === 'start') await act('arm', {});
    else if (w === 'cancel') await act('disarm');
    else if (w === 'again') await act('cancel_pick');
    else if (w === 'confirm') await act('confirm_pick');
  });

  function renderGame(v, old) {
    holdHand(Fx.play(v), v); // Kartenanimation (Quelle → Ziel); Depotzähler erst nach der Landung hochzählen
    if (v.watch) { $('dicebox').hidden = v.phase === 'setup' && v.step !== 'setup_order'; } // Zuschauer: nur Tisch-Anzeige, keine Bedienelemente
    else renderHUD(v);
    renderBoard(v);
    // Wuerfel
    const seq = v.diceSeq || 0;
    if (st.lastSeq == null) { setDice(v.dice, false); }
    else if (seq !== st.lastSeq) { setDice(v.dice, true); if (v.dice && v.phase === 'main') pulseNumber(v.dice[0] + v.dice[1]); }
    st.lastSeq = seq;
    showOrder(v.orderShown);
    showDev(v.devShown);
    void old;
  }

  // Gespielte Entwicklungskarte: 2 Sekunden groß in der Bildschirmmitte (für alle Spieler)
  function showDev(d) {
    if (!d) { st.devSeen = st.devSeen || 0; return; }
    if (st.devSeen === undefined) { st.devSeen = d.id; return; } // erste Sicht: nicht nachspielen
    if (d.id < st.devSeen) st.devSeen = d.id - 1; // neues Spiel: Zähler beginnt neu
    if (d.id <= st.devSeen) return;
    st.devSeen = d.id;
    const v = V(), p = v.players[d.by];
    const o = document.createElement('div'); o.className = 'devshow';
    o.style.setProperty('--pc', colorOf(d.by));
    o.innerHTML = `<div class="ds-card">${Art.dev(d.type, 140)}<b>${esc(Art.DEV_NAMES[d.type])}</b></div><div class="ds-who">${esc(p ? p.name : '')}</div>`;
    document.body.appendChild(o);
    if (autoFlow() || st.watch) setTimeout(() => o.remove(), 2000); // Zuschauer-Bildschirm: niemand klickt
    else { o.classList.add('manual'); o.insertAdjacentHTML('beforeend', '<div class="ds-hint">Klicken zum Schließen</div>'); o.addEventListener('click', () => o.remove()); }
  }

  // Feststehende Spielreihenfolge als Info-Fenster für alle (Auto: kurz, Manuell: bis zum Klick)
  function showOrder(o) {
    if (!o) { st.orderSeen = st.orderSeen || 0; return; }
    if (st.orderSeen === undefined) { st.orderSeen = o.id; return; }
    if (o.id < st.orderSeen) st.orderSeen = o.id - 1; // neues Spiel
    if (o.id <= st.orderSeen) return;
    st.orderSeen = o.id;
    const v = V();
    const el = document.createElement('div'); el.className = 'devshow ordshow';
    el.innerHTML = `<div class="ds-card ord"><b>Spielreihenfolge</b><ol>${o.order.map((pid) => `<li style="--pc:${colorOf(pid)}">${avatar(pid, 34)}<span>${esc(v.players[pid] ? v.players[pid].name : '')}</span></li>`).join('')}</ol></div>`;
    document.body.appendChild(el);
    if (autoFlow() || st.watch) setTimeout(() => el.remove(), 3500);
    else { el.classList.add('manual'); el.insertAdjacentHTML('beforeend', '<div class="ds-hint">Klicken zum Schließen</div>'); el.addEventListener('click', () => el.remove()); }
  }

  // ======================================================================================
  // BRETT
  // ======================================================================================
  const board = $('board'), world = $('world');
  const layer = (name) => { const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'L-' + name); world.appendChild(g); return { g, map: new Map() }; };
  const L = {};
  ['shadow', 'hex', 'foam', 'harbor', 'edge', 'vert', 'token', 'target'].forEach((n) => { L[n] = layer(n); });
  const posCache = { v: new Map(), e: new Map(), h: new Map() };
  const vpos = (k) => { let p = posCache.v.get(k); if (!p) { p = Geom.vertPos(k, S); posCache.v.set(k, p); } return p; };
  const hpos = (k) => { let p = posCache.h.get(k); if (!p) { p = Geom.hexCenter(k, S); posCache.h.set(k, p); } return p; };
  // Schiff: etwas weg von der eigenen Siedlung/Stadt an einem Kantenende rücken (Optik)
  const SHIP_GAP = 9;
  function shipPos(k, pid, v) {
    const p = epos(k), [a, b] = Geom.edgeVerts(k);
    const own = (x) => { const d = v.verts && v.verts[x]; return !!d && d.p === pid; };
    const dir = own(a) && !own(b) ? 1 : own(b) && !own(a) ? -1 : 0; // 1: weg von a (Richtung b)
    if (!dir) return p;
    const pa = vpos(a), pb = vpos(b), len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    return { x: p.x + dir * SHIP_GAP * (pb.x - pa.x) / len, y: p.y + dir * SHIP_GAP * (pb.y - pa.y) / len, ang: p.ang };
  }
  const epos = (k) => {
    let p = posCache.e.get(k);
    if (!p) {
      const [a, b] = Geom.edgeVerts(k).map(vpos);
      let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
      p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ang }; posCache.e.set(k, p);
    }
    return p;
  };
  function el(cls, inner) { const g = document.createElementNS(NS, 'g'); if (cls) g.setAttribute('class', cls); if (inner) g.innerHTML = inner; return g; }
  function boardClear() { for (const l of Object.values(L)) { l.g.replaceChildren(); l.map.clear(); } }

  // Diff-Synchronisation einer Ebene: items = [{key,sig,make}]
  function syncLayer(l, items, popCls) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.key);
      const cur = l.map.get(it.key);
      if (cur && cur.sig === it.sig) continue;
      const node = it.make();
      if (popCls && !st.firstBoard) node.classList.add(popCls);
      if (cur) { cur.el.replaceWith(node); } else l.g.appendChild(node);
      l.map.set(it.key, { el: node, sig: it.sig });
    }
    for (const [k, c] of l.map) if (!seen.has(k)) { c.el.remove(); l.map.delete(k); }
  }
  const at = (g, x, y) => { g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`); return g; };
  function piece(cls, x, y, ang, inner) {
    const g = el('piece ' + cls, `<g class="in">${inner}</g>`);
    g.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${ang.toFixed(1)}deg)`;
    return g;
  }

  function renderBoard(v) {
    board.classList.toggle('calm', v.hexes.length > 150); // grosse Karten: Ambient-Animationen aus
    const hexMap = new Map(v.hexes.map((h) => [h.k, h]));
    const isLand = (k) => { const h = hexMap.get(k); return !!h && h.t !== 'meer'; };
    const hexItems = [], shItems = [], foamItems = [];
    for (const h of v.hexes) {
      const p = hpos(h.k);
      hexItems.push({ key: h.k, sig: h.t + '|' + (h.n || 0), make: () => { const g = at(el('hex t-' + h.t, `<g class="in">${Art.hex(h.k, h.t, h.n)}</g>`), p.x, p.y); g.dataset.n = h.n || ''; g.dataset.k = h.k; return g; } });
      if (h.t !== 'meer') {
        shItems.push({ key: h.k, sig: '1', make: () => at(el('', Art.shadow()), p.x, p.y) });
        let mask = 0; Geom.neighbors(h.k).forEach((n, j) => { if (!isLand(n)) mask |= 1 << j; });
        if (mask) foamItems.push({ key: h.k, sig: String(mask), make: () => at(el('foam', Art.foam(mask)), p.x, p.y) });
      }
    }
    for (const k of v.fog || []) { const p = hpos(k); hexItems.push({ key: k, sig: 'fog', make: () => at(el('hex fog', `<g class="in">${Art.fog(k)}</g>`), p.x, p.y) }); }
    syncLayer(L.shadow, shItems);
    syncLayer(L.hex, hexItems, 'reveal');
    syncLayer(L.foam, foamItems);

    // Haefen
    syncLayer(L.harbor, (v.harbors || []).map((h) => {
      const a = hpos(h.land), b = hpos(h.sea);
      const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, m = epos(h.e);
      return { key: h.e, sig: h.kind + h.land + h.sea, make: () => at(el('harbor', Art.harbor(h.kind, ang)), m.x, m.y) };
    }));

    // Kanten (Strassen/Schiffe) – Schiffsbewegung weich: abgehendes Schiff -> neue Kante uebernehmen
    const edges = Object.entries(v.edges || {});
    const wantShips = new Map(); for (const [e, d] of edges) if (d.k === 's') wantShips.set(e, d);
    const gone = [], came = [];
    for (const [k, c] of L.edge.map) if (c.sig.startsWith('s') && !wantShips.has(k)) gone.push(k);
    for (const [k, d] of wantShips) if (!L.edge.map.has(k)) came.push(k);
    if (!st.firstBoard && gone.length && came.length) {
      for (const g of gone.slice()) {
        const gp = L.edge.map.get(g).sig.slice(1);
        const ci = came.findIndex((k) => String(wantShips.get(k).p) === gp);
        if (ci < 0) continue;
        const nk = came.splice(ci, 1)[0], c = L.edge.map.get(g), p = shipPos(nk, +gp, v);
        c.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) rotate(${p.ang.toFixed(1)}deg)`;
        c.el.classList.add('sailing'); setTimeout(() => c.el.classList.remove('sailing'), 1000);
        L.edge.map.delete(g); L.edge.map.set(nk, c);
      }
    }
    syncLayer(L.edge, edges.map(([e, d]) => {
      const ship = d.k === 's';
      const p = ship ? shipPos(e, d.p, v) : epos(e), col = v.players[d.p] ? v.players[d.p].color : 'rot';
      return { key: e, sig: (ship ? 's' : 'r') + d.p, make: () => piece(ship ? 'ship' : 'road', p.x, p.y, p.ang, ship ? Art.ship(col) : Art.road(col)) };
    }), 'pop');

    // Ecken
    syncLayer(L.vert, Object.entries(v.verts || {}).map(([k, d]) => {
      const p = vpos(k), col = v.players[d.p] && v.players[d.p].color;
      return { key: k, sig: d.k + d.p, make: () => piece(d.k === 'c' ? 'city' : 'settlement', p.x, p.y, 0, d.k === 'c' ? Art.city(col) : Art.settlement(col)) };
    }), 'pop');

    // Raeuber / Pirat (Element bleibt erhalten, bewegt sich per CSS-Transition)
    const tok = [];
    if (v.robber) { const p = hpos(v.robber); tok.push({ key: 'robber', x: p.x - 24, y: p.y + 10, art: Art.robber(), cls: 'robber', title: 'Räuber' }); }
    if (v.pirate) { const p = hpos(v.pirate); tok.push({ key: 'pirate', x: p.x, y: p.y + 6, art: Art.pirate(), cls: 'pirate', title: 'Pirat' }); }
    const seenT = new Set();
    for (const t of tok) {
      seenT.add(t.key);
      let c = L.token.map.get(t.key);
      if (!c) { const node = piece(t.cls, t.x, t.y, 0, t.art); if (!st.firstBoard) node.classList.add('pop'); L.token.g.appendChild(node); c = { el: node }; L.token.map.set(t.key, c); }
      else c.el.style.transform = `translate(${t.x.toFixed(1)}px,${t.y.toFixed(1)}px)`;
    }
    for (const [k, c] of L.token.map) if (!seenT.has(k)) { c.el.remove(); L.token.map.delete(k); }

    renderTargets(v);

    // Kamera
    const nk = []; for (const h of v.hexes) if (!st.known.has(h.k)) nk.push(h.k); for (const k of v.fog || []) if (!st.known.has(k)) nk.push(k);
    if (v.phase === 'lobby') {
      // Lobby-Vorschau: bei jedem neuen Brett (Variante, „Neu würfeln“, Spielerzahl) die Kamera neu einpassen
      const sig = v.hexes.filter((h) => h.t !== 'meer').map((h) => h.k).join(';') + '|' + (v.fog || []).length;
      if (sig !== st.lobbySig) { const first = !st.lobbySig; st.lobbySig = sig; v.hexes.forEach((h) => st.known.add(h.k)); (v.fog || []).forEach((k) => st.known.add(k)); fit(first || st.firstBoard); }
    } else if (nk.length) {
      const first = st.firstBoard;
      nk.forEach((k) => st.known.add(k));
      if (first) fit(true);
      else if (!nk.every((k) => inView(hpos(k)))) fit(false);
    }
    if (st.firstBoard) { st.firstBoard = false; document.body.dataset.phase = 'ready'; }
  }

  // ---- Klickziele -----------------------------------------------------------------------
  function computeTargets(v) {
    const T = new Map();
    const add = (t, k, kind) => { const id = t + ':' + k; const x = T.get(id) || { t, k, kinds: [] }; if (!x.kinds.includes(kind)) x.kinds.push(kind); T.set(id, x); };
    if (v.watch) return (v.arm && v.arm.targets) || []; // Tisch-Anzeige: Ziele, die ein Spieler am Handy freigegeben hat
    if (v.turn !== v.you || !v.legal) return [];
    const Lg = v.legal;
    const step = v.step;
    if (step === 'setup_settlement') (Lg.settlement || []).forEach((k) => add('v', k, 'settlement'));
    else if (step === 'setup_road' || step === 'road_building') { (Lg.road || []).forEach((k) => add('e', k, 'road')); (Lg.ship || []).forEach((k) => add('e', k, 'ship')); }
    else if (step === 'robber') { if (autoRobber()) return []; (Lg.robber || []).forEach((k) => add('h', k, 'robber')); (Lg.pirate || []).forEach((k) => add('h', k, 'pirate')); }
    else if (step === 'main' || step === 'sbp') {
      if (st.moveFrom) { add('sf', st.moveFrom, 'sel'); ((Lg.shipTo || {})[st.moveFrom] || []).forEach((k) => add('e', k, 'moveto')); }
      else if (st.mode === 'takeover') { const t = Lg.takeover || {}; (t.edges || []).forEach((k) => add('e', k, 'takeover')); (t.verts || []).forEach((k) => add('v', k, 'takeover')); }
      else if (st.mode === 'settlement') (Lg.settlement || []).forEach((k) => add('v', k, 'settlement'));
      else if (st.mode === 'city') (Lg.city || []).forEach((k) => add('v', k, 'city'));
      else if (st.mode === 'road') (Lg.road || []).forEach((k) => add('e', k, 'road'));
      else if (st.mode === 'ship') (Lg.ship || []).forEach((k) => add('e', k, 'ship'));
      else (Lg.shipFrom || []).forEach((k) => add('sf', k, 'pick'));
    }
    return [...T.values()];
  }
  // Kante grenzt an ein unentdecktes Feld (Nachbarhex einer Endecke steht in view.fog) => Bauen deckt es auf
  const DISC_TIP = 'Hier wird beim Bauen ein neues Feld aufgedeckt';
  function discoverSet(v) {
    const fg = new Set(v.fog || []), out = new Set();
    if (!fg.size) return out;
    for (const t of computeTargets(v)) if (t.t === 'e' && !t.kinds.includes('takeover') && Geom.edgeVerts(t.k).some((vk) => Geom.vertHexes(vk).some((h) => fg.has(h)))) out.add(t.k);
    return out;
  }
  function renderTargets(v) {
    const disc = discoverSet(v);
    const items = computeTargets(v).map((t) => {
      const d = t.t === 'e' && disc.has(t.k);
      const kinds = t.kinds.join(',');
      const pk = !!(v.watch && v.arm && v.arm.pick && v.arm.pick.t === t.t && v.arm.pick.k === t.k); // gewählt, wartet auf die Bestätigung am Handy
      return {
        key: t.t + ':' + t.k, sig: kinds + (d ? '|d' : '') + (pk ? '|p' : ''),
        make: () => {
          let g;
          if (t.t === 'v') { const p = vpos(t.k); g = at(el('tgt tv ' + t.kinds[0], '<circle class="halo" r="22"/><circle class="core" r="9"/><circle class="hit" r="26"/>'), p.x, p.y); }
          else if (t.t === 'e') { const p = epos(t.k); g = at(el('tgt te ' + t.kinds[0], '<rect class="bar" x="-31" y="-8" width="62" height="16" rx="8"/><rect class="hit" x="-34" y="-16" width="68" height="32"/>'), p.x, p.y); g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${p.ang.toFixed(1)})`);
            if (d) { g.classList.add('disc'); g.insertAdjacentHTML('beforeend', `<title>${DISC_TIP}</title><g class="dbadge" transform="translate(0,-34) rotate(${(-p.ang).toFixed(1)})"><circle r="19"/><text y="7.5" x="0" text-anchor="middle" class="qm">?</text></g>`); } }
          else if (t.t === 'h') { const p = hpos(t.k); g = at(el('tgt th ' + t.kinds[0], `<polygon class="hexo" points="${Art.hexPts(.93)}"/><circle class="dotc" r="11"/>`), p.x, p.y); }
          else { const p = epos(t.k); g = at(el('tgt tsf ' + t.kinds[0], '<circle class="ringo" r="29"/><circle class="hit" r="30"/>'), p.x, p.y); }
          g.dataset.t = t.t; g.dataset.k = t.k; g.dataset.kinds = kinds;
          if (pk) g.classList.add('picked');
          return g;
        },
      };
    });
    syncLayer(L.target, items);
  }
  L.target.g.addEventListener('click', (e) => {
    if (moved) return;
    const g = e.target.closest('[data-t]'); if (!g) return;
    e.stopPropagation();
    onTarget(g.dataset.t, g.dataset.k, g.dataset.kinds.split(','), e);
  });
  async function onTarget(t, k, kinds, ev) {
    const v = V(); const step = v.step;
    if (v.watch) { // Tisch-Anzeige: das Ziel nur vormerken – gebaut wird erst, wenn der Spieler am Handy bestätigt
      const pickIt = async (kind) => { const j = await post('/api/pick', { token: st.token, t, k, kind }); if (j.error) toast(j.error, 'err'); };
      if (kinds.length > 1) chooser(ev, k, kinds, pickIt); else await pickIt(kinds[0]);
      return;
    }
    if (t === 'sf') { st.moveFrom = st.moveFrom === k ? null : k; renderTargets(v); return; }
    const setup = step === 'setup_road';
    let j;
    const send = async (kind) => {
      if (kind === 'takeover') { j = await act('take_over', { kind: t === 'e' ? 'edge' : 'vert', key: k }); if (j && !j.error) { st.mode = null; renderHUD(V()); renderTargets(V()); } return; }
      if (t === 'v') j = await act(kind === 'city' ? 'build_city' : step === 'setup_settlement' ? 'place_settlement' : 'build_settlement', { v: k });
      else if (t === 'e') {
        if (kind === 'moveto') j = await act('move_ship', { from: st.moveFrom, to: k });
        else if (kind === 'road') j = await act(setup ? 'place_road' : 'build_road', { e: k });
        else j = await act(setup ? 'place_ship' : 'build_ship', { e: k });
      } else if (t === 'h') j = await act(kind === 'robber' ? 'move_robber' : 'move_pirate', { hex: k });
      if (j && !j.error) { st.mode = null; st.moveFrom = null; renderHUD(V()); renderTargets(V()); }
    };
    if (kinds[0] === 'takeover') { await send('takeover'); return; }
    if (kinds.length > 1) { chooser(ev, k, kinds, send); return; }
    await send(kinds[0]);
  }
  function chooser(ev, k, kinds, send) {
    closeChooser();
    const d = document.createElement('div'); d.className = 'chooser glass'; d.id = 'chooser';
    d.innerHTML = kinds.map((x) => `<button type="button" class="btn small" data-kind="${x}">${x === 'road' ? 'Straße' : 'Schiff'}</button>`).join('');
    d.style.left = Math.min(innerWidth - 190, ev.clientX + 8) + 'px'; d.style.top = Math.min(innerHeight - 70, ev.clientY + 8) + 'px';
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { closeChooser(); send(b.dataset.kind); } });
    document.body.appendChild(d);
  }
  const closeChooser = () => { const c = $('chooser'); if (c) c.remove(); };

  // ---- Zahlen-Hover / Pulsieren -------------------------------------------------------------------
  function hlNumber(n, on) {
    if (!n) return;
    for (const c of L.hex.map.values()) if (c.el.dataset.n === String(n)) c.el.classList.toggle('hl', on);
  }
  board.addEventListener('click', (e) => {
    if (moved || !V() || V().phase === 'lobby') return;
    const c = e.target.closest && e.target.closest('.chip'); if (!c) return;
    st.chipN = +c.dataset.n; st.modal = 'chiphelp'; renderModal(V());
  });
  board.addEventListener('pointerover', (e) => { const c = e.target.closest && e.target.closest('.chip'); if (c) hlNumber(c.dataset.n, true); });
  board.addEventListener('pointerout', (e) => { const c = e.target.closest && e.target.closest('.chip'); if (c) hlNumber(c.dataset.n, false); });
  function pulseNumber(n) {
    for (const c of L.hex.map.values()) if (c.el.dataset.n === String(n)) {
      c.el.classList.remove('pulse'); void c.el.getBoundingClientRect(); c.el.classList.add('pulse');
      setTimeout(() => c.el.classList.remove('pulse'), 2600);
    }
  }

  // ---- Kamera -------------------------------------------------------------------------------------------
  const cam = { x: 0, y: 0, k: 0.6 }, tgt = { x: 0, y: 0, k: 0.6 };
  let animOn = false, lastT = 0;
  const KMIN = 0.12, KMAX = 2.6;
  let movingT = 0;
  function applyCam() {
    document.body.classList.add('moving'); clearTimeout(movingT); movingT = setTimeout(() => document.body.classList.remove('moving'), 220);
    const W = board.clientWidth, H = board.clientHeight;
    world.setAttribute('transform', `translate(${(W / 2 - cam.x * cam.k).toFixed(2)},${(H / 2 - cam.y * cam.k).toFixed(2)}) scale(${cam.k.toFixed(4)})`);
  }
  function loop(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
    const a = 1 - Math.exp(-dt * 7);
    cam.x += (tgt.x - cam.x) * a; cam.y += (tgt.y - cam.y) * a; cam.k *= Math.pow(tgt.k / cam.k, a);
    applyCam();
    if (Math.abs(tgt.x - cam.x) < .2 && Math.abs(tgt.y - cam.y) < .2 && Math.abs(tgt.k / cam.k - 1) < .0007) { Object.assign(cam, tgt); applyCam(); animOn = false; return; }
    requestAnimationFrame(loop);
  }
  function kick(snap) {
    if (snap || reduced) { Object.assign(cam, tgt); applyCam(); return; }
    if (!animOn) { animOn = true; lastT = performance.now(); requestAnimationFrame(loop); }
  }
  function area() {
    const W = board.clientWidth, H = board.clientHeight, g = (id) => $(id).getBoundingClientRect();
    if (st.view && st.view.phase === 'lobby') { const r = g('lobbyPreview'); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, W, H }; }
    if (st.tableOn) return { left: 4, top: 4, right: W - 4, bottom: H - 4, W, H }; // Tisch: ganzer Bildschirm, die Spielerleisten liegen darüber
    const pl = g('players'), bt = g('bottom'), bn = g('banner'), sd = g('side');
    const cp = compact();
    const left = cp ? 54 : pl.right + 14;
    const sideUsed = $('hud').classList.contains('side-open');
    const right = sideUsed ? W - sd.left + 12 : cp ? 8 : 64;
    const top = cp ? Math.max(54, bn.bottom + 6) : Math.max(76, bn.bottom + 10);
    const bottom = H - bt.top + 12;
    return { left, top, right: W - right, bottom: H - bottom, W, H };
  }
  function inView(p) {
    const a = area(); const sx = a.W / 2 + (p.x - cam.x) * cam.k, sy = a.H / 2 + (p.y - cam.y) * cam.k;
    return sx > a.left && sx < a.right && sy > a.top && sy < a.bottom;
  }
  function fit(snap) {
    const v = V(); if (!v) return;
    // Aufgedeckte Felder (Land + Meer) UND der umlaufende Nebelring (view.fog) sollen immer im Bild sein.
    const tbl = !!st.tableOn; // Spieltisch: nur die sichtbaren Felder (ohne Nebelring), so groß wie möglich
    const keys = tbl ? v.hexes.map((h) => h.k) : v.hexes.map((h) => h.k).concat(v.fog || []);
    if (!keys.length) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k of keys) { const p = hpos(k); const px = tbl ? 88 : 140, py = tbl ? 101 : 155; x0 = Math.min(x0, p.x - px); x1 = Math.max(x1, p.x + px); y0 = Math.min(y0, p.y - py); y1 = Math.max(y1, p.y + py); }
    const a = area(); const aw = Math.max(200, a.right - a.left), ah = Math.max(160, a.bottom - a.top);
    const k = Math.max(KMIN, Math.min(tbl ? KMAX : 1.25, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, scx = (a.left + a.right) / 2, scy = (a.top + a.bottom) / 2;
    tgt.k = k; tgt.x = cx - (scx - a.W / 2) / k; tgt.y = cy - (scy - a.H / 2) / k;
    kick(snap);
  }
  // Spieltisch: nach Zoomen/Verschieben springt die Ansicht zurück, damit das ganze Spielfeld sichtbar bleibt
  let snapT = 0;
  const snapBack = () => { if (!st.tableOn) return; clearTimeout(snapT); snapT = setTimeout(() => fit(false), 1500); };
  function zoomAt(f, mx, my) {
    const W = board.clientWidth, H = board.clientHeight;
    const k2 = Math.max(KMIN, Math.min(KMAX, tgt.k * f));
    const wx = tgt.x + (mx - W / 2) / tgt.k, wy = tgt.y + (my - H / 2) / tgt.k;
    tgt.k = k2; tgt.x = wx - (mx - W / 2) / k2; tgt.y = wy - (my - H / 2) / k2;
    kick(); snapBack();
  }
  let moved = false;
  const ptrs = new Map(); let drag = null, pinch = null;
  board.addEventListener('pointerdown', (e) => {
    closeChooser();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
    if (ptrs.size === 1) drag = { sx: e.clientX, sy: e.clientY, cx: tgt.x, cy: tgt.y, cap: false };
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: tgt.k }; drag = null; moved = true; }
  });
  board.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      const f = (pinch.k * d / pinch.d) / tgt.k; if (isFinite(f) && f > 0) zoomAt(f, (a.x + b.x) / 2, (a.y + b.y) / 2);
      Object.assign(cam, tgt); applyCam(); return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!moved && Math.hypot(dx, dy) > 5) { moved = true; try { board.setPointerCapture(e.pointerId); } catch (_) { /* egal */ } board.classList.add('drag'); }
    if (moved) { tgt.x = drag.cx - dx / tgt.k; tgt.y = drag.cy - dy / tgt.k; Object.assign(cam, tgt); applyCam(); }
  });
  const up = (e) => { snapBack(); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { drag = null; board.classList.remove('drag'); setTimeout(() => { moved = false; }, 30); } };
  board.addEventListener('pointerup', up); board.addEventListener('pointercancel', up);
  board.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0017)), e.clientX, e.clientY); }, { passive: false });
  board.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-t]')) fit(false); });
  // Doppeltippen am Handy (dblclick feuert dort nicht überall): Brett zentrieren
  let lastTap = null;
  board.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || moved || ptrs.size) { lastTap = null; return; }
    const now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { lastTap = null; if (!e.target.closest('[data-t]')) fit(false); return; }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
  });
  addEventListener('resize', () => { applyCam(); if (st.tableOn) fit(true); if (st.view && st.view.phase === 'lobby') fit(true); });

  // ======================================================================================
  // WUERFEL
  // ======================================================================================
  const ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const faceOrder = [[1, 'f1'], [6, 'f6'], [3, 'f3'], [4, 'f4'], [2, 'f2'], [5, 'f5']];
  const cubes = ['d1', 'd2'].map((id) => {
    const d = $(id);
    d.innerHTML = '<div class="cube">' + faceOrder.map(([n, c]) => `<div class="dface ${c}">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="p"' : ''}></i>`).join('')}</div>`).join('') + '</div>' +
      '<div class="dflat">' + Array.from({ length: 9 }, () => '<i></i>').join('') + '</div>'; // Tisch: im Ruhezustand flache 2D-Seite (3D-Würfel verschwinden in gedrehten Plätzen)
    return d.firstChild;
  });
  const rotStr = (v, a = 0, b = 0) => `rotateX(${ROT[v][0] + a}deg) rotateY(${ROT[v][1] + b}deg)`;
  function setDice(vals, anim) {
    $('dice').classList.toggle('idle', !vals);
    const show = vals || [1, 1];
    const rest = (c, v) => { // Tisch: flache Seite mit dem Wurf anzeigen
      const die = c.parentNode, flat = die.querySelector('.dflat');
      flat.classList.toggle('one', v === 1);
      flat.querySelectorAll('i').forEach((p, k) => p.classList.toggle('p', PIPS[v].includes(k)));
      die.classList.add('rest');
    };
    cubes.forEach((c, i) => {
      const v = show[i];
      c.style.transform = rotStr(v);
      const die = c.parentNode; die.classList.remove('rest'); const tok = c._dt = (c._dt || 0) + 1; // nur der letzte Wurf zeigt die Ruheseite
      if (anim && !reduced) { const an = c.animate([
        { transform: `translateY(0) ${rotStr(v, 720 + i * 360, 1080 - i * 360)}` },
        { transform: `translateY(-70px) ${rotStr(v, 360, 540)}`, offset: .4 },
        { transform: `translateY(0) ${rotStr(v)}` },
      ], { duration: 950 + i * 160, easing: 'cubic-bezier(.25,.7,.3,1)' }); an.finished.then(() => { if (c._dt === tok) rest(c, v); }, () => {}); } else rest(c, v);
    });
  }

  // ======================================================================================
  // HUD
  // ======================================================================================
  const prevHand = {}, heldHand = {};
  function holdHand(land, v) {
    for (const r of Object.keys(land)) {
      if (prevHand[r] == null || (v.me.hand[r] || 0) <= prevHand[r]) continue;
      if (heldHand[r] == null) heldHand[r] = prevHand[r];
      clearTimeout(heldHand[r + 't']);
      heldHand[r + 't'] = setTimeout(() => { delete heldHand[r]; if (V()) renderHand(V()); }, land[r]);
    }
  }
  // Sprachchat-Anzeigen (Mikrofon-Knopf, Spielerkarten, Lobbyliste, Dialog) – nur Klassen/kleine Teile, kein Flackern
  function renderVoiceUI() {
    const v = V(); if (!v) return;
    if (v.phase === 'lobby') Lobby.renderLobby(v); else renderPlayers(v);
    Menu.refresh(); Voice.paintSpeaking();
  }
  function renderHUD(v) {
    const hud = $('hud');
    const tradeHas = !!$('tradeDock').innerHTML;
    hud.classList.toggle('side-open', st.logOpen || tradeHas);
    hud.classList.toggle('log-open', st.logOpen);
    $('build').hidden = v.phase === 'setup'; $('dicebox').hidden = v.phase === 'setup' && v.step !== 'setup_order';
    renderArm(v); renderBanner(v); renderPlayers(v); renderHand(v); renderBuild(v); renderPrimary(v); renderLog(v);
    Trade.render();
    renderModal(v);
    renderVoiceUI();
    // eigener Zug => Titel
    document.title = (isMe() ? '▶ ' : '') + 'Die Handelsinseln';
  }

  function renderBanner(v) {
    const you = isMe();
    let txt = v.prompt;
    if (!txt) txt = v.step === 'ended' || v.winner != null ? 'Das Spiel ist beendet.' : `${v.players[v.turn] ? v.players[v.turn].name : '…'} ist am Zug.`;
    let pre = '', extra = '';
    if (v.step === 'sbp') { const n = v.players[v.turn]; pre = `<span class="tag">Sonderbauphase</span><b>${esc(n ? n.name : '')} baut</b><span class="sep">·</span>`; }
    if (v.step === 'road_building' && you) extra = '<button class="btn small ghostb" data-a="skip_rb">Überspringen</button>';
    if (st.mode || st.moveFrom) extra += '<button class="btn small ghostb" data-a="cancel">Abbrechen (Esc)</button>';
    if (autoRobber() && v.step === 'robber') txt = v.prompt || 'Der Räuber wird automatisch versetzt …';
    const mode = st.mode === 'takeover' ? ' Wähle eine markierte Straße, ein Schiff oder eine Siedlung eines verlassenen Spielers.' : st.moveFrom ? ' Wähle das Ziel für das Schiff.' : st.mode ? ` Wähle ${st.mode === 'settlement' ? 'eine Ecke für die Siedlung' : st.mode === 'city' ? 'eine Siedlung zum Ausbau' : st.mode === 'road' ? 'eine Kante für die Straße' : 'eine Kante für das Schiff'}.` : '';
    const placing = you && (st.mode === 'road' || st.mode === 'ship' || st.moveFrom || v.step === 'setup_road' || v.step === 'road_building');
    const dsc = placing && discoverSet(v).size ? ' Mit „?“ markierte Stellen: ' + DISC_TIP + '.' : '';
    setHTML($('banner'), `<div class="bn ${you ? 'mine' : 'wait'}">${avatar(v.turn, 28)}<span class="txt">${pre}${esc(txt)}${esc(mode)}${esc(dsc)}</span>${extra}</div>`);
  }

  function renderPlayers(v) {
    const html = v.order.map((pid) => {
      const p = v.players[pid]; const turn = v.turn === pid && v.phase !== 'ended';
      const duty = (p.discarding ? `<span class="duty" title="Muss ${p.discarding} Karten abwerfen">⚠ wirft ${p.discarding} ab</span>` : '') + (p.pickingGold ? `<span class="duty gold" title="Wählt ${p.pickingGold} Rohstoffe vom Goldfluss">✦ Gold ×${p.pickingGold}</span>` : '');
      const gone = p.gone ? '<span class="bdg gone" title="Dieser Spieler hat das Spiel verlassen. Seine Figuren bleiben stehen (oder verschwinden nach den Spieleinstellungen).">verlassen</span>'
        : p.auto ? '<span class="bdg auto" title="Auto-Modus: Der Server spielt für diesen Spieler (abwesend). Er würfelt, tauscht 1:1 und beendet den Zug selbst.">Auto</span>' : '';
      const badges = gone + (p.hasLongest ? `<span class="bdg" title="Längster Handelsweg (${p.longestRoute})">${Art.pieceIcon('road', p.color, 16)}Längste</span>` : '') + (p.hasLargest ? `<span class="bdg" title="Stärkste Schutzmacht (${p.knightsPlayed} Ritter)">${Art.dev('ritter', 16)}Schutzmacht</span>` : '');
      return `<div class="pc${turn ? ' turn' : ''}${compact() && st.openPc === pid ? ' open' : ''}${pid === v.you ? ' me' : ''}${p.connected && !p.gone ? '' : ' off'}${p.gone ? ' gone' : ''}" data-pid="${pid}" style="--pc:${Art.COLORS[p.color]}">` +
        `${avatar(pid, 38)}<div class="info"><div class="top"><b class="nm">${esc(p.name)}</b>${p.bot ? `<span class="botTag" title="Computerspieler: ${esc((Avatars.BOTS[p.bot] || {}).label || '')}">Bot</span>` : ''}${pid === v.host ? '<span class="crown" title="Spielleiter">♛</span>' : ''}<span class="dot ${p.connected ? 'on' : ''}" title="${p.connected ? 'verbunden' : 'getrennt'}"></span>${Voice.badge(pid)}</div>` +
        `<div class="stats"><span title="Rohstoffkarten auf der Hand"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1.5" width="10" height="13" rx="2" fill="#e8dcc0" stroke="#7a6a48"/></svg>${p.resCount}</span>` +
        `<span title="Entwicklungskarten auf der Hand"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="1.5" width="10" height="13" rx="2" fill="#6a7bb0" stroke="#2c3560"/><path d="M8,5 l1,2 2,.3 -1.5,1.4 .4,2 -1.9,-1 -1.9,1 .4,-2 -1.5,-1.4 2,-.3z" fill="#ffe27a"/></svg>${p.devCount}</span>` +
        `<span title="Gespielte Ritter">${Art.dev('ritter', 14)}${p.knightsPlayed}</span>` +
        `<span title="Längster Handelsweg (Länge)">${Art.pieceIcon('road', p.color, 14)}${p.longestRoute}</span></div>${badges || duty ? `<div class="bd">${badges}${duty}</div>` : ''}</div>` +
        `<div class="vp" title="Öffentliche Siegpunkte${p.svp ? ' (davon ' + p.svp + ' Sonderpunkte)' : ''}"><b>${p.vp}</b><i>★</i>${p.svp ? `<small>${p.svp} Sonder</small>` : ''}</div>${turn ? '<span class="arrow" aria-hidden="true"></span>' : ''}</div>`;
    }).join('');
    setHTML($('players'), html);
  }

  function renderHand(v) {
    const hand = v.me.hand;
    const res = RES.map((r) => {
      const n = heldHand[r] != null ? Math.min(heldHand[r], hand[r] || 0) : (hand[r] || 0), gain = prevHand[r] != null && n > prevHand[r];
      prevHand[r] = n;
      return `<div class="rcard${n ? '' : ' zero'}${gain ? ' gain' : ''}" data-res="${r}" style="--rc:${Art.RES_COLORS[r]}" title="${RN[r]}: ${n}"><div class="sk s${Math.min(n, 4)}"></div><div class="face">${Art.res(r, 42)}<span class="rn">${RN[r]}</span></div><b class="cnt">${n}</b></div>`;
    }).join('');
    const lim = setg().handLimit === null ? Infinity : setg().handLimit || 7, tot = sumO(hand);
    const warn = tot > lim ? `<span class="handwarn" title="Du hast ${tot} Karten (Limit ${lim}). Bei einer 7 musst du die Hälfte abwerfen.">⚠ ${tot}/${lim}</span>` : '';
    setHTML($('resRow'), res + warn);
    const cards = v.me.dev.map((d) => {
      const can = d.playable && isMe() && (v.step === 'main' || v.step === 'roll' || v.step === 'sbp');
      const why = d.type === 'siegpunkt' ? 'Siegpunkt – bleibt verdeckt und zählt automatisch.' : d.fresh ? 'Erst in der nächsten Runde spielbar (in diesem Zug gekauft).' : !d.playable ? 'Gerade nicht spielbar.' : DEV_HELP[d.type];
      return `<button class="dcard${d.playable ? ' play' : ''}${d.fresh ? ' fresh' : ''}${d.type === 'siegpunkt' ? ' vpc' : ''}" data-a="dev" data-type="${d.type}" data-id="${esc(d.id)}" title="${esc(Art.DEV_NAMES[d.type] + ' – ' + why)}" ${d.playable ? '' : 'aria-disabled="true"'}>` +
        `${Art.dev(d.type, 34)}<span>${Art.DEV_NAMES[d.type]}</span>${d.fresh ? '<i class="new">neu</i>' : ''}</button>`;
      void can;
    }).join('');
    setHTML($('devRow'), cards || '<span class="muted small">Keine Entwicklungskarten</span>');
    const mine = v.players[v.you];
    const pts = mine.vp + (v.me.hiddenVp || 0);
    setHTML($('score'), `<div class="sc" title="Deine Siegpunkte (inkl. verdeckter Siegpunktkarten). Wer ${v.winPoints} erreicht, gewinnt."><b>${pts}</b><span>/ ${v.winPoints}</span><small>Punkte</small></div>`);
  }

  // Fehlende Rohstoffe per Bank ausgleichen (Kurs 4:1/3:1/2:1 je Hafen): Liste {give,get,rate} oder null, wenn nicht möglich
  function bankPlan(v, kind) {
    const hand = Object.assign({}, v.me.hand), cost = COST[kind], rates = v.rates || {}, stock = (v.bank && v.bank.stock) || {}, got = {}, out = [];
    for (const g of RES) {
      for (let d = (cost[g] || 0) - (hand[g] || 0); d > 0; d--) {
        if ((stock[g] != null ? stock[g] : 999) - (got[g] || 0) < 1) return null;
        const free = (r) => (hand[r] || 0) - (cost[r] || 0), rt = (r) => rates[r] || 4;
        const give = RES.filter((r) => r !== g && free(r) >= rt(r)).sort((x, y) => rt(x) - rt(y) || free(y) - free(x))[0];
        if (!give) return null;
        hand[give] -= rt(give); hand[g] = (hand[g] || 0) + 1; got[g] = (got[g] || 0) + 1; out.push({ give, get: g, rate: rt(give) });
      }
    }
    return out;
  }
  const planText = (plan) => plan.map((t) => `${t.rate}× ${RN[t.give]} → 1× ${RN[t.get]}`).join(', ');

  function buildWhy(kind, v) {
    if (v.phase !== 'main') return 'Erst nach dem Aufbau.';
    if (v.turn !== v.you) return 'Du bist nicht am Zug.';
    if (v.step === 'roll') return 'Würfle zuerst.';
    if (v.step !== 'main' && v.step !== 'sbp') return 'Im Moment nicht möglich – erledige zuerst die offene Aktion.';
    const miss = missingOf(v.me.hand, COST[kind]);
    if (miss.length && !bankPlan(v, kind)) return 'Dir fehlen: ' + miss.join(', ');
    const left = v.players[v.you].left || {};
    if (kind !== 'dev' && left[kind] === 0) return `Du hast keine ${BUILD_LABEL[kind]}-Figuren mehr.`;
    if (kind === 'dev' && v.bank && v.bank.dev === 0) return 'Der Entwicklungskartenstapel ist leer.';
    if (v.afford && v.afford[kind] === false && !miss.length) return 'Nicht genug Rohstoffe oder Figuren.';
    const lg = v.legal || {};
    if (kind !== 'dev' && v.step !== 'roll' && !(lg[kind] || []).length) return kind === 'city' ? 'Du hast keine Siedlung, die zur Stadt werden kann.' : 'Gerade gibt es keinen freien Bauplatz (Abstandsregel / Anschluss an eigene Wege nötig).';
    return '';
  }
  const curMode = () => (st.ctl ? (V() && V().arm && V().arm.mode) || null : st.mode);
  function renderBuild(v) {
    const lg = v.legal || {};
    const html = ['road', 'ship', 'settlement', 'city', 'dev'].map((k) => {
      const why = st.tableOn ? '' : buildWhy(k, v); // am Tisch ist nichts gesperrt: Die Spieler sehen ihre Karten selbst
      const lf = k !== 'dev' && v.players[v.you].left ? v.players[v.you].left[k] : null;
      const plan = !why && missingOf(v.me.hand, COST[k]).length ? bankPlan(v, k) : null;
      const tip = (plan ? `Tauscht vorher automatisch mit der Bank: ${planText(plan)}. ` : '') + (why || (k === 'dev' ? `Entwicklungskarte kaufen (${v.bank ? fmtLeft(v.bank.dev) : '?'} im Stapel)` : `${BUILD_LABEL[k]} bauen – klicke danach auf eine markierte Stelle.`) + (lf != null ? ` Noch ${fmtLeft(lf)} Figuren übrig.` : ''));
      const icon = k === 'dev' ? Art.dev('ritter', 38) : Art.pieceIcon(k, v.players[v.you].color, 38);
      return `<button class="bb${curMode() === k ? ' on' : ''}${why ? ' dis' : ''}" data-a="build" data-k="${k}" ${why ? 'aria-disabled="true"' : ''} title="${esc(tip)}"><span class="ic">${icon}</span><span class="lb">${BUILD_LABEL[k] === 'Entwicklungskarte' ? (compact() ? 'Karte' : 'Entw.-Karte') : BUILD_LABEL[k]}</span><span class="cost">${costChips(k)}</span>${k === 'dev' && v.bank ? `<i class="stk" title="Karten im Stapel">${fmtLeft(v.bank.dev)}</i>` : ''}${lf != null ? `<i class="lf${lf === 0 ? ' zero' : ''}" title="Figuren übrig">${fmtLeft(lf)}</i>` : ''}</button>`;
    }).join('') +
      ((lg.shipFrom && lg.shipFrom.length && isMe()) ? `<button class="bb${(st.ctl ? curMode() === 'move' : st.moveFrom) ? ' on' : ''}" data-a="move" title="Ein Schiff versetzen: klicke ein markiertes Schiff, dann das Ziel."><span class="ic">${Art.pieceIcon('ship', v.players[v.you].color, 38)}</span><span class="lb">${compact() ? 'Fahren' : 'Versetzen'}</span><span class="cost"><span class="cc">⇄</span></span></button>` : '') +
      ((lg.takeover && ((lg.takeover.edges || []).length || (lg.takeover.verts || []).length) && isMe() && v.step === 'main') ? `<button class="bb take${curMode() === 'takeover' ? ' on' : ''}" data-a="takeover" title="Übernehmen: Du nimmst ein Teil eines verlassenen Spielers anstelle eines Schiffsversetzens. Klicke danach auf eine markierte Stelle."><span class="ic"><svg viewBox="0 0 40 40" width="38" height="38"><path d="M8,22 L16,14 L22,20 L32,10 M32,10 V18 M32,10 H24" fill="none" stroke="#d9a8ff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8,32 H32" stroke="#d9a8ff" stroke-width="3.2" stroke-linecap="round"/></svg></span><span class="lb">Übernehmen</span><span class="cost small">Verlassene</span></button>` : '') +
      (() => {
        const canT = st.tableOn || (isMe() && (v.step === 'main' || v.step === 'sbp'));
        const why = canT ? (v.step === 'sbp' ? 'Sonderbauphase: nur Handel mit der Bank.' : 'Handeln: mit der Bank oder den Mitspielern') : (v.phase !== 'main' ? 'Erst nach dem Aufbau.' : v.turn !== v.you ? 'Nur im eigenen Zug.' : 'Jetzt nicht möglich.');
        return `<button class="bb trade${Trade.isOpen() && canT ? ' on' : ''}${canT ? '' : ' dis'}" data-a="trade" ${canT ? '' : 'aria-disabled="true"'} title="${esc(why)}"><span class="ic"><svg viewBox="0 0 40 40" width="38" height="38"><path d="M7,14 H30 M23,7 l7,7 l-7,7 M33,27 H10 M17,20 l-7,7 l7,7" fill="none" stroke="#7fd6a0" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="lb">Handeln</span><span class="cost small">${setg().playerTrade === false ? 'nur Bank' : 'Bank · Spieler'}</span></button>`;
      })();
    setHTML($('build'), html);
  }

  function renderPrimary(v) {
    const you = isMe(); let html = '';
    if (v.phase === 'ended') html = '';
    else if (you && v.step === 'roll') html = autoFlow() ? '<div class="waitbox autodice" title="Der Server würfelt am Zugbeginn automatisch.">Würfelt automatisch …</div>' : '<button class="btn gold huge pulsing" data-a="roll">Würfeln</button>';
    else if (you && v.step === 'setup_order') html = '<button class="btn gold huge pulsing" data-a="roll">Würfeln</button>';
    else if (you && v.step === 'main') html = '<button class="btn gold big" data-a="end">Zug beenden</button>';
    else if (you && v.step === 'sbp') html = '<button class="btn gold big" data-a="sbp_done">Fertig</button>';
    else if (you) html = '';
    else html = `<div class="waitbox">${v.turn != null && v.players[v.turn] ? `Warte auf <b style="color:${colorOf(v.turn)}">${esc(v.players[v.turn].name)}</b>` : ''}</div>`;
    setHTML($('primary'), html);
  }

  // ---- Protokoll / Chat -----------------------------------------------------------------------------
  function colorize(v, text) {
    const names = v.players.map((p, i) => ({ n: esc(p.name), c: colorOf(i) })).filter((x) => x.n).sort((a, b) => b.n.length - a.n.length);
    const t = esc(text); if (!names.length) return t;
    const re = new RegExp(names.map((x) => x.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    return t.replace(re, (m) => `<b class="pn" style="color:${(names.find((x) => x.n === m) || {}).c}">${m}</b>`);
  }
  function renderLog(v) {
    const logEl = $('logList'), chatEl = $('chatList');
    const lh = (v.log || []).map((l) => `<div class="le k-${esc(l.kind)}">${Art.logIcon(l.kind)}<span>${colorize(v, l.text)}</span></div>`).join('');
    const nearBottom = (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 60;
    let stick = nearBottom(logEl); if (setHTML(logEl, lh) && stick) logEl.scrollTop = logEl.scrollHeight;
    const ch = (v.chat || []).map((c) => `<div class="ce"><b class="pn" style="color:${colorOf(c.p)}">${esc(v.players[c.p] ? v.players[c.p].name : '?')}</b> ${esc(c.text)}</div>`).join('');
    stick = nearBottom(chatEl); if (setHTML(chatEl, ch) && stick) chatEl.scrollTop = chatEl.scrollHeight;
    const lastId = (v.chat || []).reduce((m, c) => Math.max(m, c.id || 0), 0);
    if (st.seenChat < 0) st.seenChat = lastId;
    if (st.tab === 'chat') st.seenChat = lastId;
    $('chatDot').hidden = !(lastId > st.seenChat);
    const dv = Lobby.deviations(v.settings); setHTML($('rulesList'), `<h4 class="rl-h">Einstellungen dieser Partie</h4>${Lobby.deviationsHTML(v.settings)}<h4 class="rl-h">Spielregeln</h4>${Regeln.html()}`); $('rulesTab').textContent = dv.length ? `Regeln (${dv.length})` : 'Regeln';
    logEl.hidden = st.tab !== 'log'; chatEl.hidden = st.tab !== 'chat'; $('rulesList').hidden = st.tab !== 'rules';
    document.querySelectorAll('#logPanel .tabbtn').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
    $('sideToggle').textContent = st.logOpen ? '›' : '‹';
  }

  // ======================================================================================
  // MODALE
  // ======================================================================================
  const mcard = (side, r, n, lim) => `<div class="tc${n > 0 ? ' sel' : ''}${lim === 0 ? ' dim' : ''}" data-ms="${side}" data-res="${r}" style="--rc:${Art.RES_COLORS[r]}">${Art.res(r, 40)}<span class="tn">${RN[r]}</span><b class="cnt">${n}</b>${lim != null ? `<span class="have" title="Im Besitz">${lim}</span>` : ''}<button type="button" class="minus" data-ms="${side}" data-res="${r}" aria-label="${RN[r]} −1">−</button></div>`;
  const mgrid = (side, vals, hand) => `<div class="tgrid big">${RES.map((r) => mcard(side, r, vals[r] || 0, hand ? hand[r] || 0 : null)).join('')}</div>`;

  function prefillDiscard(hand, n) {
    const left = Object.assign({}, hand), d = {};
    for (let i = 0; i < n; i++) {
      const r = RES.filter((x) => left[x] > 0).sort((a, b) => left[b] - left[a])[0]; if (!r) break;
      left[r]--; d[r] = (d[r] || 0) + 1;
    }
    return d;
  }
  function confetti() {
    let s = '';
    for (let i = 0; i < 70; i++) s += `<i style="left:${(Math.random() * 100).toFixed(1)}%;--d:${(Math.random() * 4).toFixed(2)}s;--t:${(3 + Math.random() * 3).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg;--c:${['#f5c542', '#dc3c3c', '#2f78e0', '#38a857', '#9150cc', '#f2922a', '#fff'][i % 7]}"></i>`;
    return `<div class="confetti" aria-hidden="true">${s}</div>`;
  }
  function helpHTML() {
    const row = (k, l) => `<tr><td>${Art.pieceIcon(k, 'rot', 28)}</td><th>${l}</th><td>${costChips(k)}</td></tr>`;
    return `<h2>Spielregeln – Kurzhilfe</h2><div class="helpgrid"><div><h3>Baukosten</h3><table class="cost-t">` +
      `<tr><td>${Art.pieceIcon('road', 'rot', 28)}</td><th>Straße</th><td>${costChips('road')}</td></tr>` +
      `<tr><td>${Art.pieceIcon('ship', 'rot', 28)}</td><th>Schiff</th><td>${costChips('ship')}</td></tr>` +
      `<tr><td>${Art.pieceIcon('settlement', 'rot', 28)}</td><th>Siedlung <small>(1 Punkt)</small></th><td>${costChips('settlement')}</td></tr>` +
      `<tr><td>${Art.pieceIcon('city', 'rot', 28)}</td><th>Stadt <small>(2 Punkte)</small></th><td>${costChips('city')}</td></tr>` +
      `<tr><td>${Art.dev('ritter', 28)}</td><th>Entwicklungskarte</th><td>${costChips('dev')}</td></tr></table>${row.length ? '' : ''}` +
      `<h3>Entwicklungskarten</h3><ul><li><b>Ritter</b> – Räuber versetzen &amp; stehlen</li><li><b>Straßenbau</b> – 2 Wege gratis</li><li><b>Erfindung</b> – 2 beliebige Rohstoffe</li><li><b>Monopol</b> – alle Karten einer Sorte einsammeln</li><li><b>Siegpunkt</b> – 1 verdeckter Punkt</li></ul></div>` +
      `<div><h3>Kurzregeln</h3><ul>` +
      `<li><b>Handel:</b> ${setg().playerTrade === false ? 'In dieser Partie nur mit der Bank' : 'Im eigenen Zug mit allen Mitspielern (Angebot) oder mit der Bank'} <b>${setg().bankRate || 4}:1</b>. Mit Hafen <b>3:1</b>, mit Spezialhafen <b>2:1</b> für die passende Sorte.</li>` +
      `<li><b>Häfen:</b> Eine eigene Siedlung/Stadt an der Hafenkante schaltet den Kurs frei.</li>` +
      `<li><b>Räuber:</b> Bei einer 7 verlieren alle mit mehr als ${setg().handLimit === null ? '∞ (unbegrenzt)' : setg().handLimit || 7} Karten die Hälfte. Der Räuber blockiert ein Landfeld und bestiehlt einen Nachbarn.</li>` +
      `<li><b>Pirat:</b> Blockiert ein Meerfeld (keine Schiffe/Erträge der angrenzenden Siedlungen) und bestiehlt.</li>` +
      `<li><b>Gold:</b> Siedlungen am Goldfluss geben beliebige Rohstoffe deiner Wahl.</li>` +
      `<li><b>Entdeckung:</b> Nebelfelder werden aufgedeckt, wenn du mit Straße/Schiff anlegst – das gibt eventuell Rohstoffe.</li>` +
      `<li><b>Sonderpunkte:</b> Neue Inseln zu besiedeln bringt Sonderpunkte.</li>` +
      `<li><b>Längster Handelsweg</b> (mindestens ${setg().longestMin || 5} Teile): 2 Punkte.</li>` +
      `<li><b>Stärkste Schutzmacht</b> (mindestens ${setg().armyMin || 3} Ritter): 2 Punkte.</li></ul></div></div>` +
      `<div class="mact"><button class="btn gold" data-m="close">Verstanden</button></div>`;
  }
  // Hilfe zum Zahlenchip (Klick auf einen Chip im Brett)
  function chipHelpHTML(n) {
    const dots = 6 - Math.abs(7 - n), pct = (dots / 36 * 100).toFixed(1).replace('.', ',');
    return `<h2>Zahlenchip ${n}</h2><p class="lead">Wird mit beiden Würfeln eine <b>${n}</b> geworfen, erzeugt jedes angrenzende Feld mit diesem Chip Rohstoffe: <b>1</b> für eine Siedlung, <b>2</b> für eine Stadt.</p>` +
      `<p>${dots === 1 ? 'Der Punkt zeigt' : 'Die Punkte zeigen'} die Wahrscheinlichkeit: ${dots} von 36 Würfen, also etwa <b>${pct} %</b> pro Wurf. Die roten Chips 6 und 8 fallen am häufigsten.</p>` +
      `<p>Ein vom Räuber (oder Piraten) blockiertes Feld liefert nichts. Bei einer <b>7</b> bringt kein Feld etwas, stattdessen wird der Räuber versetzt.</p>` +
      `<div class="mact"><button class="btn gold" data-m="close">Verstanden</button></div>`;
  }
  const sumDraft = () => sumO(st.draft);

  function wantedModal(v) {
    if ((v.phase === 'ended' || v.winner != null) && !v.stats) return { key: 'win', type: 'win' };
    if (v.phase === 'ended') return null;
    const you = v.you, me = v.players[you];
    if (v.step === 'steal' && v.turn === you && !autoRobber() && v.legal && v.legal.steal && v.legal.steal.length) return { key: 'steal:' + v.legal.steal.join(','), type: 'steal' };
    const dn = (v.pending && v.pending.discard && v.pending.discard[you]) || me.discarding || 0;
    if (v.step === 'discard' && dn > 0) return { key: 'discard:' + dn + ':' + JSON.stringify(v.me.hand), type: 'discard', n: dn };
    const gn = (v.pending && v.pending.gold && v.pending.gold[you]) || me.pickingGold || 0;
    if (v.step === 'gold' && gn > 0) return { key: 'gold:' + gn, type: 'gold', n: gn };
    if (st.modal) return { key: st.modal, type: st.modal };
    return null;
  }
  function modalBody(v, w) {
    const hand = v.me.hand;
    switch (w.type) {
      case 'discard': {
        const left = w.n - sumDraft();
        return `<h2>Die 7 – Räuber!</h2><p class="lead">Du hast mehr als ${setg().handLimit || 7} Karten und musst <b>${w.n}</b> abwerfen.</p>` + mgrid('d', st.draft, hand) +
          `<p class="cnt-line ${left === 0 ? 'ok' : ''}">${left > 0 ? `Noch <b>${left}</b> wählen` : left < 0 ? `<b>${-left}</b> zu viel` : 'Genau richtig'}</p>` +
          `<div class="mact"><button class="btn ghostb" data-m="refill">Automatisch</button><button class="btn gold${left === 0 ? '' : ' dis'}" data-m="discard" ${left === 0 ? '' : 'aria-disabled="true"'}>Abwerfen bestätigen</button></div>`;
      }
      case 'gold': {
        const left = w.n - sumDraft();
        return `<h2>Goldfluss!</h2><p class="lead">Wähle <b>${w.n}</b> beliebige Rohstoffe.</p>` + mgrid('g', st.draft, null) +
          `<p class="cnt-line ${left === 0 ? 'ok' : ''}">${left > 0 ? `Noch <b>${left}</b> wählen` : left < 0 ? `<b>${-left}</b> zu viel` : 'Bereit'}</p>` +
          `<div class="mact"><button class="btn gold${left === 0 ? '' : ' dis'}" data-m="gold" ${left === 0 ? '' : 'aria-disabled="true"'}>Nehmen</button></div>`;
      }
      case 'yop': {
        const left = 2 - sumDraft();
        return `<h2>Erfindung</h2><p class="lead">Nimm <b>2</b> beliebige Rohstoffe aus der Bank.</p>` + mgrid('y', st.draft, null) +
          `<p class="cnt-line ${left === 0 ? 'ok' : ''}">${left > 0 ? `Noch <b>${left}</b> wählen` : 'Bereit'}</p>` +
          `<div class="mact"><button class="btn ghostb" data-m="close">Abbrechen</button><button class="btn gold${left === 0 ? '' : ' dis'}" data-m="yop" ${left === 0 ? '' : 'aria-disabled="true"'}>Karte spielen</button></div>`;
      }
      case 'monopol':
        return `<h2>Monopol</h2><p class="lead">Welche Rohstoffsorte sollen dir <b>alle</b> Mitspieler geben?</p><div class="tgrid big pick">${RES.map((r) => `<button type="button" class="tc pickc" data-m="mono" data-res="${r}" style="--rc:${Art.RES_COLORS[r]}">${Art.res(r, 48)}<span class="tn">${RN[r]}</span></button>`).join('')}</div>` +
          `<div class="mact"><button class="btn ghostb" data-m="close">Abbrechen</button></div>`;
      case 'steal':
        return `<h2>Wen bestiehlst du?</h2><p class="lead">Eine zufällige Karte wandert zu dir.</p><div class="steal">${v.legal.steal.map((pid) => `<button type="button" class="stl" data-m="steal" data-pid="${pid}" style="--pc:${colorOf(pid)}">${avatar(pid, 56)}<b>${esc(v.players[pid].name)}</b><small>${v.players[pid].resCount} Karten</small></button>`).join('')}</div>`;
      case 'help': return helpHTML();
      case 'chiphelp': return chipHelpHTML(st.chipN);
      case 'win': {
        const w2 = v.winner != null ? v.winner : v.order[0];
        const rank = v.players.map((p, i) => ({ p, i })).sort((a, b) => (b.p.vp + (b.i === v.you ? v.me.hiddenVp || 0 : 0)) - (a.p.vp + (a.i === v.you ? v.me.hiddenVp || 0 : 0)));
        const host = v.host === v.you;
        return `${confetti()}<div class="trophy" aria-hidden="true"><svg viewBox="0 0 64 64" width="96" height="96"><defs><linearGradient id="tgld" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset=".5" stop-color="#f5c542"/><stop offset="1" stop-color="#a8740c"/></linearGradient></defs><path d="M18,8 H46 V24 Q46,38 32,40 Q18,38 18,24Z" fill="url(#tgld)" stroke="#6b4a08" stroke-width="2"/><path d="M18,12 H8 Q8,28 20,30 M46,12 H56 Q56,28 44,30" fill="none" stroke="#e0aa2a" stroke-width="3.4"/><path d="M32,40 V50 M22,56 H42 M24,50 H40 V56 H24Z" stroke="#6b4a08" stroke-width="2" fill="#c8901a"/><path d="M23,12 V24 Q23,32 28,35" stroke="#fff" stroke-opacity=".6" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg></div>` +
          `<h2 class="win">${esc(v.players[w2].name)} gewinnt!</h2><div class="winav">${avatar(w2, 84)}</div>` +
          `<ol class="rank">${rank.map(({ p, i }) => `<li class="${i === w2 ? 'first' : ''}" style="--pc:${colorOf(i)}">${avatar(i, 30)}<span class="nm">${esc(p.name)}</span><b>${p.vp + (i === v.you ? v.me.hiddenVp || 0 : 0)} ★</b></li>`).join('')}</ol>` +
          `<div class="mact">${host ? '<button class="btn gold big" data-m="newgame">Neues Spiel</button>' : '<p class="waiting"><span class="spin"></span>Warte auf den Spielleiter…</p>'}</div>`;
      }
    }
    return '';
  }
  function renderModal(v) {
    const root = $('modalRoot');
    const w = wantedModal(v);
    if (!w) { if (root.firstChild) { root.replaceChildren(); st.modalKey = ''; } return; }
    if (st.draftKey !== w.key && (w.type === 'discard' || w.type === 'gold' || w.type === 'yop')) {
      st.draftKey = w.key; st.draft = w.type === 'discard' ? prefillDiscard(v.me.hand, w.n) : {};
    }
    const html = modalBody(v, w);
    if (st.modalKey !== w.key || !root.firstChild) {
      st.modalKey = w.key; root._h = null;
      root.innerHTML = `<div class="mback m-${w.type}"><div class="modal glass m-${w.type}" role="dialog" aria-modal="true"><div class="mbody"></div></div></div>`;
    }
    setHTML(root.querySelector('.mbody'), html);
  }
  function adjDraft(side, r, d) {
    const v = V(), w = wantedModal(v); if (!w) return;
    const cap = side === 'd' ? v.me.hand[r] || 0 : 19;
    const max = side === 'y' ? 2 : side === 'g' ? w.n : side === 'd' ? w.n : 19;
    let n = (st.draft[r] || 0) + d;
    n = Math.max(0, Math.min(cap, n));
    if (d > 0 && sumDraft() >= max) { if (side === 'y' || side === 'g') { const o = RES.find((x) => st.draft[x] > 0 && x !== r); if (o && max === 1) { delete st.draft[o]; } else return; } else return; }
    if (n) st.draft[r] = n; else delete st.draft[r];
    renderModal(v);
  }
  $('modalRoot').addEventListener('click', async (e) => {
    const v = V(); if (!v) return;
    const mm = e.target.closest('[data-m]');
    if (e.target.closest('.minus')) { const b = e.target.closest('.minus'); adjDraft(b.dataset.ms, b.dataset.res, -1); return; }
    const c = e.target.closest('.tc[data-ms]'); if (c) { adjDraft(c.dataset.ms, c.dataset.res, +1); return; }
    if (!mm) { if (e.target.classList.contains('mback') && (st.modal === 'help' || st.modal === 'chiphelp')) { st.modal = null; renderModal(v); } return; }
    if (mm.getAttribute('aria-disabled') === 'true') return;
    const m = mm.dataset.m; let j;
    if (m === 'close') { st.modal = null; renderModal(v); }
    else if (m === 'refill') { const w = wantedModal(v); st.draft = prefillDiscard(v.me.hand, w.n); renderModal(v); }
    else if (m === 'discard') j = await act('discard', { cards: st.draft });
    else if (m === 'gold') j = await act('gold_pick', { cards: st.draft });
    else if (m === 'yop') { const picks = RES.flatMap((r) => Array(st.draft[r] || 0).fill(r)); j = await act('play_yop', { a: picks[0], b: picks[1] }); if (j && !j.error) { st.modal = null; renderModal(V()); } }
    else if (m === 'mono') { j = await act('play_monopoly', { res: mm.dataset.res }); if (j && !j.error) { st.modal = null; renderModal(V()); } }
    else if (m === 'steal') j = await act('steal', { target: Number(mm.dataset.pid) });
    else if (m === 'newgame') j = await act('new_game');
    void j;
  });
  $('modalRoot').addEventListener('contextmenu', (e) => { const c = e.target.closest('.tc[data-ms]'); if (c) { e.preventDefault(); adjDraft(c.dataset.ms, c.dataset.res, -1); } });

  // ======================================================================================
  // Eingaben (HUD-Delegation)
  // ======================================================================================
  $('hud').addEventListener('click', async (e) => {
    const v = V(); if (!v) return;
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.getAttribute('aria-disabled') === 'true') return;
    const a = b.dataset.a;
    switch (a) {
      case 'roll': await act('roll'); break;
      case 'end': st.mode = null; await act('end_turn'); break;
      case 'sbp_done': await act('sbp_done'); break;
      case 'skip_rb': await act('skip_roadbuilding'); break;
      case 'takeover': if (st.ctl) { await act(v.arm && v.arm.mode === 'takeover' ? 'disarm' : 'arm', { mode: 'takeover' }); break; } st.moveFrom = null; st.mode = st.mode === 'takeover' ? null : 'takeover'; renderHUD(v); renderTargets(v); break;
      case 'cancel': if (st.ctl) { await act('disarm'); break; } st.mode = null; st.moveFrom = null; renderHUD(v); renderTargets(v); break;
      case 'trade': st.mode = null; st.moveFrom = null; Trade.toggle(); renderHUD(v); renderTargets(v); break;
      case 'move': if (st.ctl) { await act(v.arm && v.arm.mode === 'move' ? 'disarm' : 'arm', { mode: 'move' }); break; } st.mode = null; if (st.moveFrom) st.moveFrom = null; else { const f = v.legal.shipFrom; if (f.length === 1) st.moveFrom = f[0]; } renderHUD(v); renderTargets(v); break;
      case 'build': {
        const k = b.dataset.k;
        if (!st.tableOn && missingOf(v.me.hand, COST[k]).length) { // fehlende Rohstoffe vorher per Bank tauschen
          const plan = bankPlan(v, k); if (!plan) break;
          let ok = true; for (const t of plan) { const j = await act('bank_trade', { give: t.give, get: t.get }); if (j.error) { ok = false; break; } }
          if (!ok) break;
        }
        if (k === 'dev') { st.mode = null; await act('buy_dev'); break; }
        if (st.ctl) { await act(v.arm && v.arm.mode === k ? 'disarm' : 'arm', { mode: k }); break; }
        st.moveFrom = null; st.mode = st.mode === k ? null : k;
        renderHUD(V()); renderTargets(V()); break; // V(): nach dem Tausch kann die View neuer sein
      }
      case 'dev': {
        const t = b.dataset.type;
        if (t === 'siegpunkt') break;
        if (t === 'ritter') await act('play_knight');
        else if (t === 'strassenbau') await act('play_roadbuilding');
        else if (t === 'erfindung') { st.modal = 'yop'; st.draftKey = ''; renderModal(v); }
        else if (t === 'monopol') { st.modal = 'monopol'; renderModal(v); }
        break;
      }
    }
  });
  // Tooltips auch fuer gesperrte Dev-Karten
  // Kompakt: Antippen eines Mitspieler-Logos zeigt/verbirgt seine Werte; Tippen daneben oder nach 6 s blendet sie wieder aus
  let pcTimer = 0;
  const setOpenPc = (pid) => { st.openPc = pid; clearTimeout(pcTimer); if (pid != null) pcTimer = setTimeout(() => setOpenPc(null), 6000); if (V() && V().phase !== 'lobby') renderPlayers(V()); };
  document.addEventListener('click', (e) => {
    const c = compact() && e.target.closest('#players .pc');
    if (c) setOpenPc(st.openPc === +c.dataset.pid ? null : +c.dataset.pid);
    else if (st.openPc != null) setOpenPc(null);
  });
  compactMQ.addEventListener('change', () => { st.openPc = null; if (V() && V().phase !== 'lobby') { renderPlayers(V()); renderBuild(V()); fit(true); } });
  $('sideToggle').addEventListener('click', () => { st.logOpen = !st.logOpen; renderHUD(V()); setTimeout(() => { if (V()) fit(false); }, 260); });
  document.querySelectorAll('#logPanel .tabbtn').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; renderLog(V()); const l = $(st.tab === 'log' ? 'logList' : st.tab === 'chat' ? 'chatList' : 'rulesList'); l.scrollTop = l.scrollHeight; }));
  $('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const t = $('chatIn').value.trim(); if (!t) return;
    $('chatIn').value = ''; await act('chat', { text: t });
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeChooser();
      if (st.modal) { st.modal = null; renderModal(V()); return; }
      if (st.mode || st.moveFrom) { st.mode = null; st.moveFrom = null; if (V()) { renderHUD(V()); renderTargets(V()); } }
    }
  });

  // ======================================================================================
  // Start
  // ======================================================================================
  function boot() {
    $('defs').innerHTML = Art.defs();
    $('nameIn').value = localStorage.getItem('handelsinseln.name') || '';
    st.color = localStorage.getItem('handelsinseln.color') || null;
    const ctx = { get mockLogin() { return st.loginMock; }, tableOn: () => !!st.tableOn, ctl: () => st.ctl, toggleCtl, view: V, act, post, toast, esc, Art, avatar, colorOf, setHTML, joined, leave: leaveGame, token: () => st.token, help: () => { st.modal = 'help'; renderModal(V()); }, fit: () => fit(false),
      onChange: () => { renderVoiceUI(); } };
    Lobby.init(ctx); Menu.init(ctx); Voice.init(ctx);
    Regeln.init({ Art, costChips, settings: setg });
    Table.init({ act, Art, avatar, esc });
    Fx.init({ Art, table: () => !!st.tableOn, slow: () => !autoFlow(), hexEl: (k) => { const c = L.hex.map.get(k); return c ? c.el : null; } });
    Trade.init({ root: $('tradeDock'), table: () => !!st.tableOn, view: V, act, toast, esc, Art, avatar, onChange: () => { if (V()) { renderHUD(V()); } } });
    const q = new URLSearchParams(location.search);
    const mock = q.get('mock');
    if (mock) {
      st.mock = mock;
      if (mock === 'anmeldung') { st.loginMock = q.get('games') || 'games'; $('nameIn').value = $('nameIn').value || 'Anna'; showScreens(); return; }
      const url = '/tests/mock/' + encodeURIComponent(mock) + '.json';
      const show = (v) => {
        applyView(v);
        if (q.get('open') === 'trade') { Trade.openComposer(); }
        if (q.get('mode')) { st.mode = q.get('mode'); renderHUD(v); renderTargets(v); }
        if (q.get('modal')) { st.modal = q.get('modal'); renderModal(v); }
        if (q.get('tab')) { st.tab = q.get('tab'); renderLog(v); }
        if (q.get('side') === '0') { st.logOpen = false; renderHUD(v); }
        if (q.get('fit') !== '0') { if (q.get('sync')) fit(true); else setTimeout(() => fit(true), 50); }
        if (q.get('roll')) setTimeout(() => setDice(v.dice, true), 100);
      };
      if (q.get('sync')) { // synchron laden: der Screenshot des Browsers kommt erst nach dem Rendern (z. B. firefox --screenshot)
        const x = new XMLHttpRequest(); x.open('GET', url, false); x.send(); show(JSON.parse(x.responseText));
      } else fetch(url).then((r) => r.json()).then(show).catch((e) => toast('Mock nicht ladbar: ' + e.message, 'err'));
      return;
    }
    fetch('/api/config').then((r) => r.json()).then((c) => { if (c.version) $('ver').textContent = 'Version ' + c.version; }).catch(() => {});
    if (st.token) connect(); else showScreens();
  }
  boot();
  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {}); // nur für „App installieren“ (Weiterreichen, kein Cache)
})();
