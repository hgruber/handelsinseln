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
  const S = 100;

  const st = {
    token: localStorage.getItem('handelsinseln.token') || null, view: null, mode: null, moveFrom: null, mock: null,
    es: null, logOpen: innerWidth > 1150, tab: 'log', modal: null, modalKey: '', draft: {}, draftKey: '',
    firstBoard: true, known: new Set(), lastSeq: null, lastHand: null, chatSeen: 0, seenChat: -1, color: null,
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
    return `<span class="av" style="--pc:${colorOf(pid)};--sz:${size}px" aria-hidden="true">${esc(initial(p && p.name))}</span>`;
  };
  const sumO = (o) => RES.reduce((a, r) => a + (o && o[r] > 0 ? o[r] : 0), 0);
  const missingOf = (hand, need) => RES.filter((r) => (need[r] || 0) > (hand[r] || 0)).map((r) => `${need[r] - (hand[r] || 0)}× ${RN[r]}`);
  const costChips = (kind) => RES.filter((r) => COST[kind][r]).map((r) => `<span class="cc">${Art.res(r, 16)}${COST[kind][r] > 1 ? '<b>' + COST[kind][r] + '</b>' : ''}</span>`).join('');
  const isMe = () => st.view && st.view.turn === st.view.you;

  let toastN = 0;
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || 'err'); t.textContent = msg;
    const box = $('toasts'); box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    const id = ++toastN; void id;
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 4200);
  }

  // ======================================================================================
  // Netzwerk
  // ======================================================================================
  async function post(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let j = {}; try { j = await r.json(); } catch (_) { /* leer */ }
      if (!r.ok && !j.error) j.error = `Fehler (HTTP ${r.status})`;
      return j;
    } catch (e) { return { error: 'Keine Verbindung zum Server.' }; }
  }
  async function act(type, params) {
    if (st.mock) { toast(`Mock-Modus: „${type}“ ${JSON.stringify(params || {})} nicht gesendet`, 'info'); console.log('act', type, params); return { ok: true }; }
    const j = await post('/api/act', Object.assign({ token: st.token, type }, params || {}));
    if (j.error) toast(j.error, 'err');
    return j;
  }
  function setOnline(on) { $('conn').hidden = on; }
  function connect() {
    if (st.es) st.es.close();
    const es = new EventSource('/api/events?token=' + encodeURIComponent(st.token));
    st.es = es;
    es.addEventListener('state', (e) => { setOnline(true); try { applyView(JSON.parse(e.data)); } catch (err) { console.error(err); } });
    es.onopen = () => setOnline(true);
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) logout('Die Sitzung ist abgelaufen – bitte neu anmelden.');
      else setOnline(false);
    };
  }
  function logout(msg) {
    if (st.es) st.es.close(); st.es = null;
    localStorage.removeItem('handelsinseln.token'); st.token = null; st.view = null; setOnline(true);
    if (msg) toast(msg, 'warn');
    showScreens();
  }

  // ======================================================================================
  // Anmeldung / Lobby
  // ======================================================================================
  let lobbyTimer = 0;
  function buildSwatches(taken) {
    const box = $('swatches'); const sel = st.color;
    const html = Object.entries(Art.COLORS).map(([c, hex]) => {
      const t = taken.includes(c);
      return `<button type="button" class="sw${sel === c ? ' on' : ''}${t ? ' taken' : ''}" data-c="${c}" role="radio" aria-checked="${sel === c}" ${t ? 'disabled' : ''} title="${Art.COLOR_NAMES[c]}${t ? ' (vergeben)' : ''}" style="--c:${hex};--c2:${Art.darken(hex, .35)}"><span>${t ? '✕' : ''}</span></button>`;
    }).join('');
    setHTML(box, html);
  }
  async function pollLobby() {
    clearTimeout(lobbyTimer);
    if (st.token || st.mock || $('login').hidden) return;
    try {
      const j = await (await fetch('/api/lobby')).json();
      const taken = j.takenColors || [];
      if (st.color && taken.includes(st.color)) st.color = null;
      if (!st.color) st.color = Object.keys(Art.COLORS).find((c) => !taken.includes(c)) || null;
      buildSwatches(taken);
      $('loginInfo').textContent = j.players && j.players.length ? `In der Lobby: ${j.players.map((p) => p.name).join(', ')}` : 'Noch niemand in der Lobby.';
      if (j.phase && j.phase !== 'lobby') $('loginInfo').textContent += ' · Ein Spiel läuft bereits.';
    } catch (_) { $('loginInfo').textContent = 'Server nicht erreichbar …'; }
    lobbyTimer = setTimeout(pollLobby, 2500);
  }
  function renderLobby(v) {
    const me = v.you;
    const list = v.players.map((p, i) => `<li class="${i === me ? 'me' : ''}" style="--pc:${colorOf(i)}">${avatar(i, 46)}<span class="nm">${esc(p.name)}</span>` +
      `${i === v.host ? '<span class="crown" title="Spielleiter">♛ Spielleiter</span>' : ''}${i === me ? '<span class="you">du</span>' : ''}<span class="dot ${p.connected ? 'on' : ''}"></span></li>`).join('');
    setHTML($('lobbyList'), list || '<li class="muted">Noch niemand hier.</li>');
    const can = v.players.length >= (v.minPlayers || 2);
    const isHost = v.host === me;
    setHTML($('lobbyAct'), isHost
      ? `<button class="btn gold big${can ? '' : ' dis'}" id="startBtn" ${can ? '' : 'aria-disabled="true"'} title="${can ? '' : 'Mindestens ' + (v.minPlayers || 2) + ' Spieler nötig'}">Spiel starten</button>` +
        (can ? '' : `<p class="hint">Mindestens ${v.minPlayers || 2} Spieler nötig (${v.players.length}/${v.maxPlayers || 6}).</p>`)
      : `<p class="waiting"><span class="spin"></span>Warte auf den Spielleiter…</p>`);
  }

  // ======================================================================================
  // Sichtbarkeit der Bildschirme
  // ======================================================================================
  function showScreens() {
    const v = st.view;
    const inGame = !!v && v.phase !== 'lobby';
    $('login').hidden = !!(v || st.token || st.mock) ;
    $('lobby').hidden = !(v && v.phase === 'lobby');
    $('hud').hidden = !inGame;
    $('board').toggleAttribute('hidden', !inGame);
    if (!$('login').hidden) { buildSwatches([]); pollLobby(); }
  }

  // ======================================================================================
  // View anwenden
  // ======================================================================================
  function applyView(v) {
    const old = st.view;
    st.view = v;
    if (old && old.phase !== v.phase && v.phase === 'lobby') { st.mode = null; st.moveFrom = null; st.known = new Set(); st.firstBoard = true; boardClear(); }
    // Modus-Aufraeumen: nur gueltig im eigenen Hauptschritt
    if (!(isMe() && (v.step === 'main' || v.step === 'sbp'))) { st.mode = null; st.moveFrom = null; }
    if (st.moveFrom && !(v.legal && v.legal.shipTo && v.legal.shipTo[st.moveFrom])) st.moveFrom = null;
    showScreens();
    if (v.phase === 'lobby') { renderLobby(v); return; }
    renderGame(v, old);
  }

  function renderGame(v, old) {
    renderHUD(v);
    renderBoard(v);
    // Wuerfel
    const seq = v.diceSeq || 0;
    if (st.lastSeq == null) { setDice(v.dice, false); }
    else if (seq !== st.lastSeq) { setDice(v.dice, true); if (v.dice) pulseNumber(v.dice[0] + v.dice[1]); }
    st.lastSeq = seq;
    void old;
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
        const nk = came.splice(ci, 1)[0], c = L.edge.map.get(g), p = epos(nk);
        c.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) rotate(${p.ang.toFixed(1)}deg)`;
        c.el.classList.add('sailing'); setTimeout(() => c.el.classList.remove('sailing'), 1000);
        L.edge.map.delete(g); L.edge.map.set(nk, c);
      }
    }
    syncLayer(L.edge, edges.map(([e, d]) => {
      const p = epos(e), col = v.players[d.p] ? v.players[d.p].color : 'rot';
      const ship = d.k === 's';
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
    if (nk.length) {
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
    if (v.turn !== v.you || !v.legal) return [];
    const Lg = v.legal;
    const step = v.step;
    if (step === 'setup_settlement') (Lg.settlement || []).forEach((k) => add('v', k, 'settlement'));
    else if (step === 'setup_road' || step === 'road_building') { (Lg.road || []).forEach((k) => add('e', k, 'road')); (Lg.ship || []).forEach((k) => add('e', k, 'ship')); }
    else if (step === 'robber') { (Lg.robber || []).forEach((k) => add('h', k, 'robber')); (Lg.pirate || []).forEach((k) => add('h', k, 'pirate')); }
    else if (step === 'main' || step === 'sbp') {
      if (st.moveFrom) { add('sf', st.moveFrom, 'sel'); ((Lg.shipTo || {})[st.moveFrom] || []).forEach((k) => add('e', k, 'moveto')); }
      else if (st.mode === 'settlement') (Lg.settlement || []).forEach((k) => add('v', k, 'settlement'));
      else if (st.mode === 'city') (Lg.city || []).forEach((k) => add('v', k, 'city'));
      else if (st.mode === 'road') (Lg.road || []).forEach((k) => add('e', k, 'road'));
      else if (st.mode === 'ship') (Lg.ship || []).forEach((k) => add('e', k, 'ship'));
      else (Lg.shipFrom || []).forEach((k) => add('sf', k, 'pick'));
    }
    return [...T.values()];
  }
  function renderTargets(v) {
    const items = computeTargets(v).map((t) => {
      const kinds = t.kinds.join(',');
      return {
        key: t.t + ':' + t.k, sig: kinds,
        make: () => {
          let g;
          if (t.t === 'v') { const p = vpos(t.k); g = at(el('tgt tv ' + t.kinds[0], '<circle class="halo" r="22"/><circle class="core" r="9"/><circle class="hit" r="26"/>'), p.x, p.y); }
          else if (t.t === 'e') { const p = epos(t.k); g = at(el('tgt te ' + t.kinds[0], '<rect class="bar" x="-31" y="-8" width="62" height="16" rx="8"/><rect class="hit" x="-34" y="-16" width="68" height="32"/>'), p.x, p.y); g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${p.ang.toFixed(1)})`); }
          else if (t.t === 'h') { const p = hpos(t.k); g = at(el('tgt th ' + t.kinds[0], `<polygon class="hexo" points="${Art.hexPts(.93)}"/><circle class="dotc" r="11"/>`), p.x, p.y); }
          else { const p = epos(t.k); g = at(el('tgt tsf ' + t.kinds[0], '<circle class="ringo" r="29"/><circle class="hit" r="30"/>'), p.x, p.y); }
          g.dataset.t = t.t; g.dataset.k = t.k; g.dataset.kinds = kinds;
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
    if (t === 'sf') { st.moveFrom = st.moveFrom === k ? null : k; renderTargets(v); return; }
    const setup = step === 'setup_road';
    let j;
    const send = async (kind) => {
      if (t === 'v') j = await act(kind === 'city' ? 'build_city' : step === 'setup_settlement' ? 'place_settlement' : 'build_settlement', { v: k });
      else if (t === 'e') {
        if (kind === 'moveto') j = await act('move_ship', { from: st.moveFrom, to: k });
        else if (kind === 'road') j = await act(setup ? 'place_road' : 'build_road', { e: k });
        else j = await act(setup ? 'place_ship' : 'build_ship', { e: k });
      } else if (t === 'h') j = await act(kind === 'robber' ? 'move_robber' : 'move_pirate', { hex: k });
      if (j && !j.error) { st.mode = null; st.moveFrom = null; renderHUD(V()); renderTargets(V()); }
    };
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
  function applyCam() {
    const W = board.clientWidth, H = board.clientHeight;
    world.setAttribute('transform', `translate(${(W / 2 - cam.x * cam.k).toFixed(2)},${(H / 2 - cam.y * cam.k).toFixed(2)}) scale(${cam.k.toFixed(4)})`);
    const ox = W / 2 - cam.x * cam.k, oy = H / 2 - cam.y * cam.k, md = (a, m) => (((a % m) + m) % m).toFixed(0) + 'px';
    const seaEl = $('sea');
    seaEl.style.setProperty('--ox1', md(ox * .9, 240)); seaEl.style.setProperty('--oy1', md(oy * .9, 120));
    seaEl.style.setProperty('--ox2', md(ox * .6, 340)); seaEl.style.setProperty('--oy2', md(oy * .6, 170));
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
    const pl = g('players'), bt = g('bottom'), bn = g('banner'), sd = g('side');
    const narrow = W < 900;
    const left = narrow ? 12 : pl.right + 14;
    const sideUsed = $('hud').classList.contains('side-open');
    const right = sideUsed ? W - sd.left + 12 : 64;
    const top = Math.max(76, bn.bottom + 10) + (narrow ? pl.height : 0);
    const bottom = H - bt.top + 12;
    return { left, top, right: W - right, bottom: H - bottom, W, H };
  }
  function inView(p) {
    const a = area(); const sx = a.W / 2 + (p.x - cam.x) * cam.k, sy = a.H / 2 + (p.y - cam.y) * cam.k;
    return sx > a.left && sx < a.right && sy > a.top && sy < a.bottom;
  }
  function fit(snap) {
    const v = V(); if (!v) return;
    const keys = v.hexes.filter((h) => h.t !== 'meer').map((h) => h.k); // Land (Meer/Nebel bleiben als Rand außen vor)
    if (!keys.length) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k of keys) { const p = hpos(k); x0 = Math.min(x0, p.x - 190); x1 = Math.max(x1, p.x + 190); y0 = Math.min(y0, p.y - 200); y1 = Math.max(y1, p.y + 200); }
    const a = area(); const aw = Math.max(200, a.right - a.left), ah = Math.max(160, a.bottom - a.top);
    const k = Math.max(KMIN, Math.min(1.25, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, scx = (a.left + a.right) / 2, scy = (a.top + a.bottom) / 2;
    tgt.k = k; tgt.x = cx - (scx - a.W / 2) / k; tgt.y = cy - (scy - a.H / 2) / k;
    kick(snap);
  }
  function zoomAt(f, mx, my) {
    const W = board.clientWidth, H = board.clientHeight;
    const k2 = Math.max(KMIN, Math.min(KMAX, tgt.k * f));
    const wx = tgt.x + (mx - W / 2) / tgt.k, wy = tgt.y + (my - H / 2) / tgt.k;
    tgt.k = k2; tgt.x = wx - (mx - W / 2) / k2; tgt.y = wy - (my - H / 2) / k2;
    kick();
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
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { drag = null; board.classList.remove('drag'); setTimeout(() => { moved = false; }, 30); } };
  board.addEventListener('pointerup', up); board.addEventListener('pointercancel', up);
  board.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0017)), e.clientX, e.clientY); }, { passive: false });
  board.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-t]')) fit(false); });
  addEventListener('resize', () => { applyCam(); });

  // ======================================================================================
  // WUERFEL
  // ======================================================================================
  const ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const faceOrder = [[1, 'f1'], [6, 'f6'], [3, 'f3'], [4, 'f4'], [2, 'f2'], [5, 'f5']];
  const cubes = ['d1', 'd2'].map((id) => {
    const d = $(id);
    d.innerHTML = '<div class="cube">' + faceOrder.map(([n, c]) => `<div class="dface ${c}">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="p"' : ''}></i>`).join('')}</div>`).join('') + '</div>';
    return d.firstChild;
  });
  const rotStr = (v, a = 0, b = 0) => `rotateX(${ROT[v][0] + a}deg) rotateY(${ROT[v][1] + b}deg)`;
  function setDice(vals, anim) {
    $('dice').classList.toggle('idle', !vals);
    const show = vals || [1, 1];
    cubes.forEach((c, i) => {
      const v = show[i];
      c.style.transform = rotStr(v);
      if (anim && !reduced) c.animate([
        { transform: `translateY(0) ${rotStr(v, 720 + i * 360, 1080 - i * 360)}` },
        { transform: `translateY(-70px) ${rotStr(v, 360, 540)}`, offset: .4 },
        { transform: `translateY(0) ${rotStr(v)}` },
      ], { duration: 950 + i * 160, easing: 'cubic-bezier(.25,.7,.3,1)' });
    });
  }

  // ======================================================================================
  // HUD
  // ======================================================================================
  const prevHand = {};
  function renderHUD(v) {
    const hud = $('hud');
    const tradeHas = !!$('tradeDock').innerHTML;
    hud.classList.toggle('side-open', st.logOpen || tradeHas);
    hud.classList.toggle('log-open', st.logOpen);
    $('build').hidden = $('dicebox').hidden = v.phase === 'setup';
    renderBanner(v); renderPlayers(v); renderHand(v); renderBuild(v); renderPrimary(v); renderLog(v);
    Trade.render();
    renderModal(v);
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
    const mode = st.moveFrom ? ' Wähle das Ziel für das Schiff.' : st.mode ? ` Wähle ${st.mode === 'settlement' ? 'eine Ecke für die Siedlung' : st.mode === 'city' ? 'eine Siedlung zum Ausbau' : st.mode === 'road' ? 'eine Kante für die Straße' : 'eine Kante für das Schiff'}.` : '';
    setHTML($('banner'), `<div class="bn ${you ? 'mine' : 'wait'}">${avatar(v.turn, 28)}<span class="txt">${pre}${esc(txt)}${esc(mode)}</span>${extra}</div>`);
  }

  function renderPlayers(v) {
    const html = v.order.map((pid) => {
      const p = v.players[pid]; const turn = v.turn === pid && v.phase !== 'ended';
      const duty = (p.discarding ? `<span class="duty" title="Muss ${p.discarding} Karten abwerfen">⚠ wirft ${p.discarding} ab</span>` : '') + (p.pickingGold ? `<span class="duty gold" title="Wählt ${p.pickingGold} Rohstoffe vom Goldfluss">✦ Gold ×${p.pickingGold}</span>` : '');
      const badges = (p.hasLongest ? `<span class="bdg" title="Längster Handelsweg (${p.longestRoute})">${Art.pieceIcon('road', p.color, 16)}Längste</span>` : '') + (p.hasLargest ? `<span class="bdg" title="Stärkste Schutzmacht (${p.knightsPlayed} Ritter)">${Art.dev('ritter', 16)}Schutzmacht</span>` : '');
      return `<div class="pc${turn ? ' turn' : ''}${pid === v.you ? ' me' : ''}${p.connected ? '' : ' off'}" style="--pc:${Art.COLORS[p.color]}">` +
        `${avatar(pid, 38)}<div class="info"><div class="top"><b class="nm">${esc(p.name)}</b>${pid === v.host ? '<span class="crown" title="Spielleiter">♛</span>' : ''}<span class="dot ${p.connected ? 'on' : ''}" title="${p.connected ? 'verbunden' : 'getrennt'}"></span></div>` +
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
      const n = hand[r] || 0, gain = prevHand[r] != null && n > prevHand[r];
      prevHand[r] = n;
      return `<div class="rcard${n ? '' : ' zero'}${gain ? ' gain' : ''}" style="--rc:${Art.RES_COLORS[r]}" title="${RN[r]}: ${n}"><div class="sk s${Math.min(n, 4)}"></div><div class="face">${Art.res(r, 42)}<span class="rn">${RN[r]}</span></div><b class="cnt">${n}</b></div>`;
    }).join('');
    setHTML($('resRow'), res);
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

  function buildWhy(kind, v) {
    if (v.phase !== 'main') return 'Erst nach dem Aufbau.';
    if (v.turn !== v.you) return 'Du bist nicht am Zug.';
    if (v.step === 'roll') return 'Würfle zuerst.';
    if (v.step !== 'main' && v.step !== 'sbp') return 'Im Moment nicht möglich – erledige zuerst die offene Aktion.';
    const miss = missingOf(v.me.hand, COST[kind]);
    if (miss.length) return 'Dir fehlen: ' + miss.join(', ');
    const left = v.players[v.you].left || {};
    if (kind !== 'dev' && left[kind] === 0) return `Du hast keine ${BUILD_LABEL[kind]}-Figuren mehr.`;
    if (kind === 'dev' && v.bank && v.bank.dev === 0) return 'Der Entwicklungskartenstapel ist leer.';
    if (v.afford && v.afford[kind] === false) return 'Nicht genug Rohstoffe oder Figuren.';
    const lg = v.legal || {};
    if (kind !== 'dev' && v.step !== 'roll' && !(lg[kind] || []).length) return kind === 'city' ? 'Du hast keine Siedlung, die zur Stadt werden kann.' : 'Gerade gibt es keinen freien Bauplatz (Abstandsregel / Anschluss an eigene Wege nötig).';
    return '';
  }
  function renderBuild(v) {
    const lg = v.legal || {};
    const html = ['road', 'ship', 'settlement', 'city', 'dev'].map((k) => {
      const why = buildWhy(k, v);
      const tip = why || (k === 'dev' ? `Entwicklungskarte kaufen (${v.bank ? v.bank.dev : '?'} im Stapel)` : `${BUILD_LABEL[k]} bauen – klicke danach auf eine markierte Stelle.`);
      const icon = k === 'dev' ? Art.dev('ritter', 38) : Art.pieceIcon(k, v.players[v.you].color, 38);
      return `<button class="bb${st.mode === k ? ' on' : ''}${why ? ' dis' : ''}" data-a="build" data-k="${k}" ${why ? 'aria-disabled="true"' : ''} title="${esc(tip)}"><span class="ic">${icon}</span><span class="lb">${BUILD_LABEL[k] === 'Entwicklungskarte' ? 'Entw.-Karte' : BUILD_LABEL[k]}</span><span class="cost">${costChips(k)}</span>${k === 'dev' && v.bank ? `<i class="stk" title="Karten im Stapel">${v.bank.dev}</i>` : ''}</button>`;
    }).join('') +
      ((lg.shipFrom && lg.shipFrom.length && isMe()) ? `<button class="bb${st.moveFrom ? ' on' : ''}" data-a="move" title="Ein Schiff versetzen: klicke ein markiertes Schiff, dann das Ziel."><span class="ic">${Art.pieceIcon('ship', v.players[v.you].color, 38)}</span><span class="lb">Versetzen</span><span class="cost"><span class="cc">⇄</span></span></button>` : '') +
      (() => {
        const canT = isMe() && (v.step === 'main' || v.step === 'sbp');
        const why = canT ? (v.step === 'sbp' ? 'Sonderbauphase: nur Handel mit der Bank.' : 'Handeln: mit der Bank oder den Mitspielern') : (v.phase !== 'main' ? 'Erst nach dem Aufbau.' : v.turn !== v.you ? 'Nur im eigenen Zug.' : 'Jetzt nicht möglich.');
        return `<button class="bb trade${Trade.isOpen() && canT ? ' on' : ''}${canT ? '' : ' dis'}" data-a="trade" ${canT ? '' : 'aria-disabled="true"'} title="${esc(why)}"><span class="ic"><svg viewBox="0 0 40 40" width="38" height="38"><path d="M7,14 H30 M23,7 l7,7 l-7,7 M33,27 H10 M17,20 l-7,7 l7,7" fill="none" stroke="#7fd6a0" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="lb">Handeln</span><span class="cost small">Bank · Spieler</span></button>`;
      })();
    setHTML($('build'), html);
  }

  function renderPrimary(v) {
    const you = isMe(); let html = '';
    if (v.phase === 'ended') html = '';
    else if (you && v.step === 'roll') html = '<button class="btn gold huge pulsing" data-a="roll">Würfeln</button>';
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
    logEl.hidden = st.tab !== 'log'; chatEl.hidden = st.tab !== 'chat';
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
      `<li><b>Handel:</b> Im eigenen Zug mit allen Mitspielern (Angebot) oder mit der Bank <b>4:1</b>. Mit Hafen <b>3:1</b>, mit Spezialhafen <b>2:1</b> für die passende Sorte.</li>` +
      `<li><b>Häfen:</b> Eine eigene Siedlung/Stadt an der Hafenkante schaltet den Kurs frei.</li>` +
      `<li><b>Räuber:</b> Bei einer 7 verlieren alle mit mehr als 7 Karten die Hälfte. Der Räuber blockiert ein Landfeld und bestiehlt einen Nachbarn.</li>` +
      `<li><b>Pirat:</b> Blockiert ein Meerfeld (keine Schiffe/Erträge der angrenzenden Siedlungen) und bestiehlt.</li>` +
      `<li><b>Gold:</b> Siedlungen am Goldfluss geben beliebige Rohstoffe deiner Wahl.</li>` +
      `<li><b>Entdeckung:</b> Nebelfelder werden aufgedeckt, wenn du mit Straße/Schiff anlegst – das gibt eventuell Rohstoffe.</li>` +
      `<li><b>Sonderpunkte:</b> Neue Inseln zu besiedeln bringt Sonderpunkte.</li>` +
      `<li><b>Längster Handelsweg</b> (mindestens 5 Teile): 2 Punkte.</li>` +
      `<li><b>Stärkste Schutzmacht</b> (mindestens 3 Ritter): 2 Punkte.</li></ul></div></div>` +
      `<div class="mact"><button class="btn gold" data-m="close">Verstanden</button></div>`;
  }
  const sumDraft = () => sumO(st.draft);

  function wantedModal(v) {
    if (v.phase === 'ended' || v.winner != null) return { key: 'win', type: 'win' };
    const you = v.you, me = v.players[you];
    if (v.step === 'steal' && v.turn === you && v.legal && v.legal.steal && v.legal.steal.length) return { key: 'steal:' + v.legal.steal.join(','), type: 'steal' };
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
        return `<h2>Die 7 – Räuber!</h2><p class="lead">Du hast mehr als 7 Karten und musst <b>${w.n}</b> abwerfen.</p>` + mgrid('d', st.draft, hand) +
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
    if (!mm) { if (e.target.classList.contains('mback') && (st.modal === 'help')) { st.modal = null; renderModal(v); } return; }
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
    if (b.getAttribute('aria-disabled') === 'true') { const t = b.title; if (t) toast(t, 'warn'); if (b.dataset.a !== 'dev') return; return; }
    const a = b.dataset.a;
    switch (a) {
      case 'roll': await act('roll'); break;
      case 'end': st.mode = null; await act('end_turn'); break;
      case 'sbp_done': await act('sbp_done'); break;
      case 'skip_rb': await act('skip_roadbuilding'); break;
      case 'cancel': st.mode = null; st.moveFrom = null; renderHUD(v); renderTargets(v); break;
      case 'trade': st.mode = null; st.moveFrom = null; Trade.toggle(); renderHUD(v); renderTargets(v); break;
      case 'move': st.mode = null; if (st.moveFrom) st.moveFrom = null; else { const f = v.legal.shipFrom; if (f.length === 1) st.moveFrom = f[0]; else toast('Klicke auf das Schiff, das du versetzen möchtest.', 'info'); } renderHUD(v); renderTargets(v); break;
      case 'build': {
        const k = b.dataset.k;
        if (k === 'dev') { st.mode = null; await act('buy_dev'); break; }
        st.moveFrom = null; st.mode = st.mode === k ? null : k;
        if (st.mode && !((v.legal && v.legal[k]) || []).length) toast(`Kein erlaubter Platz für ${BUILD_LABEL[k] === 'Siedlung' ? 'eine Siedlung' : BUILD_LABEL[k] === 'Stadt' ? 'eine Stadt' : 'ein(e) ' + BUILD_LABEL[k]}.`, 'warn');
        renderHUD(v); renderTargets(v); break;
      }
      case 'dev': {
        const t = b.dataset.type;
        if (t === 'siegpunkt') { toast('Siegpunktkarten bleiben verdeckt und zählen automatisch.', 'info'); break; }
        if (t === 'ritter') await act('play_knight');
        else if (t === 'strassenbau') await act('play_roadbuilding');
        else if (t === 'erfindung') { st.modal = 'yop'; st.draftKey = ''; renderModal(v); }
        else if (t === 'monopol') { st.modal = 'monopol'; renderModal(v); }
        break;
      }
    }
  });
  // Tooltips auch fuer gesperrte Dev-Karten
  $('btnFit').addEventListener('click', () => fit(false));
  $('btnIn').addEventListener('click', () => zoomAt(1.3, board.clientWidth / 2, board.clientHeight / 2));
  $('btnOut').addEventListener('click', () => zoomAt(1 / 1.3, board.clientWidth / 2, board.clientHeight / 2));
  $('btnHelp').addEventListener('click', () => { st.modal = st.modal === 'help' ? null : 'help'; renderModal(V()); });
  $('sideToggle').addEventListener('click', () => { st.logOpen = !st.logOpen; renderHUD(V()); setTimeout(() => { if (V()) fit(false); }, 260); });
  document.querySelectorAll('#logPanel .tabbtn').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; renderLog(V()); const l = $(st.tab === 'log' ? 'logList' : 'chatList'); l.scrollTop = l.scrollHeight; }));
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

  // Lobby / Login
  $('swatches').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (!b || b.disabled) return; st.color = b.dataset.c; localStorage.setItem('handelsinseln.color', st.color); pollLobby(); });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('nameIn').value.trim(); if (!name) return;
    if (!st.color) { toast('Bitte wähle eine Farbe.', 'warn'); return; }
    localStorage.setItem('handelsinseln.name', name);
    $('joinBtn').classList.add('dis');
    const j = await post('/api/join', { name, color: st.color });
    $('joinBtn').classList.remove('dis');
    if (j.error) { toast(j.error, 'err'); pollLobby(); return; }
    st.token = j.token; localStorage.setItem('handelsinseln.token', j.token);
    showScreens(); connect();
  });
  $('lobby').addEventListener('click', async (e) => {
    if (e.target.closest('#startBtn')) { const b = e.target.closest('#startBtn'); if (b.getAttribute('aria-disabled') === 'true') { toast(b.title || 'Zu wenige Spieler.', 'warn'); return; } await act('start'); }
  });
  $('leaveBtn').addEventListener('click', async () => { if (!st.mock) await post('/api/leave', { token: st.token }); logout(); });

  // ======================================================================================
  // Start
  // ======================================================================================
  function boot() {
    $('defs').innerHTML = Art.defs();
    $('nameIn').value = localStorage.getItem('handelsinseln.name') || '';
    st.color = localStorage.getItem('handelsinseln.color') || null;
    Trade.init({ root: $('tradeDock'), view: V, act, toast, esc, Art, avatar, onChange: () => { if (V()) { renderHUD(V()); } } });
    const q = new URLSearchParams(location.search);
    const mock = q.get('mock');
    if (mock) {
      st.mock = mock;
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
    if (st.token) connect(); else showScreens();
  }
  boot();
})();
