// lobby.js – Anmeldung mit Spieleliste, Lobby-Bildschirm und Spieleinstellungen.
// Kontext von app.js: {view(), act(), post(), toast(), esc(), Art, avatar(pid,size), colorOf(pid), setHTML(el,html), joined(j), mock}
(function (root) {
  'use strict';
  const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
  const TER = ['wald', 'huegel', 'weide', 'acker', 'gebirge', 'gold', 'wueste', 'meer'];
  const CHIPS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]; // es gibt keinen Wertechip 7
  let C = null;
  const $ = (id) => document.getElementById(id);
  const VARIANTS = [
    { id: 'klassisch', name: 'Klassisch', desc: 'Eine große Hauptinsel, dazu kleine Inseln – dahinter wartet der Nebel.' },
    { id: 'nebel', name: 'Nebelinseln', desc: 'Eine kleine Startinsel in dichtem Nebel. Alles Weitere muss erst entdeckt werden.' },
    { id: 'inseln', name: 'Vier Heimatinseln', desc: 'Jeder Spieler startet auf einer eigenen Heimatinsel. Dazwischen liegen Meer und Nebel.' },
    { id: 'archipel', name: 'Archipel', desc: 'Viele kleine Inseln im Meer – jeder startet auf einer eigenen, überall wartet Gold und Nebel.' },
  ];
  const VNAME = Object.fromEntries(VARIANTS.map((x) => [x.id, x.name]));

  // ======================================================================================
  // Anmeldung: Name, Farbe, Spieleliste
  // ======================================================================================
  const L = { botsOpen: false, games: [], sel: null, color: null, avatar: null, timer: 0, notice: '', err: '' };
  const AVS = root.Avatars;
  const joinable = () => L.games.filter((g) => g.joinable !== false);
  const selGame = () => L.games.find((g) => g.id === L.sel) || null;
  const takenColors = () => { const g = selGame(); return g ? (g.players || []).map((p) => p.color) : []; };

  function normalizeSel() {
    const j = joinable();
    if (L.sel !== 'new' && !j.some((g) => g.id === L.sel)) L.sel = null;
    if (!L.sel && j.length === 1) L.sel = j[0].id;
    if (!j.length) L.sel = 'new';
  }
  const takenAvatars = () => { const g = selGame(); return g ? (g.players || []).map((p) => p.avatar).filter(Boolean) : []; };
  // Avatar: gemerkter oder zufälliger Vorschlag; ist er im gewählten Spiel schon vergeben, wird ein freier zufällig gewählt
  function pickAvatar() {
    const t = takenAvatars();
    if (L.avatar && (t.includes(L.avatar) || !AVS.HUMAN_IDS.includes(L.avatar))) L.avatar = null;
    if (!L.avatar) { const free = AVS.HUMAN_IDS.filter((a) => !t.includes(a)); L.avatar = free[Math.floor(Math.random() * free.length)] || AVS.HUMAN_IDS[0]; }
  }
  function renderAvatars() {
    const t = takenAvatars();
    C.setHTML($('avatars'), AVS.HUMAN.map((a) => {
      const tk = t.includes(a.id);
      return `<button type="button" class="avb${L.avatar === a.id ? ' on' : ''}${tk ? ' taken' : ''}" data-a="${a.id}" role="radio" aria-checked="${L.avatar === a.id}" ${tk ? 'disabled' : ''} title="${C.esc(a.name)}${tk ? ' (in diesem Spiel vergeben)' : ''}"><img src="img/av/${a.id}.webp" alt="${C.esc(a.name)}" draggable="false"></button>`;
    }).join(''));
  }
  function pickColor() {
    const t = takenColors();
    if (L.color && t.includes(L.color)) L.color = null;
    if (!L.color) L.color = Object.keys(C.Art.COLORS).find((c) => !t.includes(c)) || null;
  }
  function renderSwatches() {
    const t = takenColors(), sel = L.color;
    C.setHTML($('swatches'), Object.entries(C.Art.COLORS).map(([c, hex]) => {
      const tk = t.includes(c);
      return `<button type="button" class="sw${sel === c ? ' on' : ''}${tk ? ' taken' : ''}" data-c="${c}" role="radio" aria-checked="${sel === c}" ${tk ? 'disabled' : ''} title="${C.Art.COLOR_NAMES[c]}${tk ? ' (in diesem Spiel vergeben)' : ''}" style="--c:${hex};--c2:${C.Art.darken(hex, .35)}"><span>${tk ? '✕' : ''}</span></button>`;
    }).join(''));
  }
  function gameCard(g) {
    const n = (g.players || []).length, plan = Math.max(g.plannedPlayers || 0, n), max = g.maxPlayers || 6;
    const dots = (g.players || []).map((p) => `<i class="gd" style="--c:${C.Art.COLORS[p.color] || '#888'}" title="${C.esc(p.name)}"></i>`).join('') +
      Array.from({ length: Math.max(0, plan - n) }, () => '<i class="gd empty" title="freier Platz"></i>').join('');
    const names = (g.players || []).map((p) => C.esc(p.name)).join(', ');
    return `<button type="button" class="gcard${L.sel === g.id ? ' on' : ''}" data-g="${C.esc(g.id)}" role="option" aria-selected="${L.sel === g.id}">` +
      `<span class="gtop"><b class="gname">${C.esc(g.name || 'Spiel')}</b><span class="gvar">${C.esc(VNAME[g.variant] || g.variant || '')}</span></span>` +
      `<span class="ghost-line">Spielleiter: <b>${C.esc(g.host)}</b></span>` +
      `<span class="gbot"><span class="gdots">${dots}</span><span class="gcnt">${n}/${plan > n ? plan : max}</span></span>` +
      (names ? `<span class="gnames">${names}</span>` : '') + '</button>';
  }
  function renderGames() {
    normalizeSel(); pickColor(); renderSwatches(); pickAvatar(); renderAvatars();
    const j = joinable(), other = L.games.length - j.length;
    let html;
    if (!j.length) html = `<p class="gempty">Noch kein offenes Spiel – eröffne das erste!${other ? ` <span class="muted">(${other} laufende${other === 1 ? 's' : ''} Spiel${other === 1 ? '' : 'e'} nicht beitretbar)</span>` : ''}</p>`;
    else html = j.map(gameCard).join('') + (other ? `<p class="gempty small">${other} weitere${other === 1 ? 's' : ''} Spiel${other === 1 ? '' : 'e'} laufen bereits.</p>` : '');
    C.setHTML($('gameList'), html);
    $('gameList').closest('.fld').hidden = !j.length;
    const jb = $('joinBtn'); jb.hidden = !j.length;
    const needPick = j.length > 1 && !selGame();
    jb.classList.toggle('dis', needPick); jb.setAttribute('aria-disabled', String(needPick)); jb.title = needPick ? 'Wähle zuerst ein Spiel aus der Liste.' : '';
    $('createBtn').classList.toggle('gold', !j.length); $('createBtn').classList.toggle('ghostb', !!j.length);
    const info = $('loginInfo');
    info.classList.toggle('notice', !!L.notice);
    info.textContent = L.notice || L.err || '';
  }
  async function pollGames() {
    clearTimeout(L.timer);
    if ($('login').hidden) return;
    try {
      let j;
      if (C.mockLogin) j = await (await fetch('/tests/mock/' + encodeURIComponent(C.mockLogin) + '.json')).json();
      else j = await (await fetch('/api/games')).json();
      L.games = (j && j.games) || []; L.err = '';
    } catch (_) { L.err = 'Server nicht erreichbar …'; }
    renderGames();
    L.timer = setTimeout(pollGames, 2500);
  }
  async function doJoin(forceCreate) {
    const name = $('nameIn').value.trim();
    if (!name) { $('loginForm').reportValidity(); return; }
    if (!L.color) { C.toast('Bitte wähle eine Farbe.', 'warn'); return; }
    const j = joinable();
    if (!forceCreate && j.length > 1 && !selGame() && L.sel !== 'new') { C.toast('Wähle zuerst ein Spiel aus der Liste oder eröffne ein neues.', 'warn'); return; }
    localStorage.setItem('handelsinseln.name', name); localStorage.setItem('handelsinseln.color', L.color); localStorage.setItem('handelsinseln.avatar', L.avatar);
    const body = { name, color: L.color, avatar: L.avatar };
    if (forceCreate || !j.length || L.sel === 'new') body.create = true; else body.game = L.sel;
    if (C.mockLogin) { C.toast('Mock-Modus: join ' + JSON.stringify(body), 'info'); return; }
    ['joinBtn', 'createBtn'].forEach((i) => $(i).classList.add('dis'));
    const r = await C.post('/api/join', body);
    ['joinBtn', 'createBtn'].forEach((i) => $(i).classList.remove('dis'));
    if (r.error) {
      C.toast(r.error, 'err');
      if (r.games) { L.games = r.games; L.sel = null; }
      pollGames(); return;
    }
    L.notice = ''; C.joined(r);
  }
  function initLogin() {
    $('swatches').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (!b || b.disabled) return; L.color = b.dataset.c; localStorage.setItem('handelsinseln.color', L.color); renderSwatches(); });
    $('avatars').addEventListener('click', (e) => { const b = e.target.closest('.avb'); if (!b || b.disabled) return; L.avatar = b.dataset.a; localStorage.setItem('handelsinseln.avatar', L.avatar); renderAvatars(); });
    $('gameList').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; L.sel = L.sel === b.dataset.g ? null : b.dataset.g; L.color = L.color; renderGames(); });
    $('loginForm').addEventListener('submit', (e) => { e.preventDefault(); if ($('joinBtn').getAttribute('aria-disabled') === 'true') { C.toast($('joinBtn').title, 'warn'); return; } doJoin(false); });
    $('createBtn').addEventListener('click', () => doJoin(true));
    L.color = localStorage.getItem('handelsinseln.color') || null;
    L.avatar = localStorage.getItem('handelsinseln.avatar') || null;
  }
  function loginShown() { renderGames(); pollGames(); }
  function setNotice(t) { L.notice = t || ''; }

  // ======================================================================================
  // Einstellungs-Schema (Vorgaben + Beschriftungen) – auch fuer die Info-Anzeige im Spiel
  // ======================================================================================
  const DEF = {
    dice: 'manuell', robber: 'manuell', winPoints: 14, handLimit: 7, bankRate: 4, playerTrade: true,
    islandBonus: 2, islandBonusMax: 2, longestMin: 5, armyMin: 3, leaver: 'uebernahme', vanishRounds: 5,
    limits: {
      road: 15, ship: 15, settlement: 5, city: 4, dev: 'standard',
      bank: Object.fromEntries(RES.map((r) => [r, null])),
      fogTerrain: Object.fromEntries(TER.map((t) => [t, null])),
      fogChips: Object.fromEntries(CHIPS.map((c) => [c, null])),
    },
  };
  const getp = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const setp = (o, path, val) => { const ks = path.split('.'); let a = o; ks.slice(0, -1).forEach((k) => { a = a[k] = a[k] || {}; }); a[ks[ks.length - 1]] = val; return o; };
  const fmtNum = (v) => (v === null ? '∞' : v === 'standard' ? 'Standard' : String(v));

  function schema() {
    const Art = C.Art;
    return [
      { id: 'ablauf', title: 'Ablauf', rows: [
        { path: 'dice', type: 'seg', label: 'Würfeln', tip: 'Manuell: der Spieler klickt „Würfeln“. Automatisch: der Server würfelt am Zugbeginn.', opts: [['manuell', 'Manuell'], ['auto', 'Automatisch']] },
        { path: 'robber', type: 'seg', label: 'Räuber versetzen', tip: 'Automatisch: Räuber/Pirat und Opfer werden vom Server gewählt.', opts: [['manuell', 'Manuell'], ['auto', 'Automatisch']] },
        { path: 'playerTrade', type: 'seg', label: 'Spielerhandel', tip: 'Aus: nur Handel mit der Bank.', opts: [[true, 'Erlaubt'], [false, 'Nur Bank']] },
      ] },
      { id: 'regeln', title: 'Regeln', rows: [
        { path: 'winPoints', type: 'num', label: 'Siegpunkte zum Sieg', min: 3, max: 30 },
        { path: 'handLimit', type: 'num', label: 'Handkarten-Limit', tip: 'Bei einer 7 wirft ab, wer MEHR Karten hat.', min: 1, max: 99, inf: true, infLabel: 'unbegrenzt' },
        { path: 'bankRate', type: 'num', label: 'Bankkurs', tip: 'So viele gleiche Karten für 1 Karte der Bank (ohne Hafen).', min: 2, max: 6, suffix: ' : 1' },
        { path: 'islandBonus', type: 'num', label: 'Inselbonus (Punkte)', tip: 'Sonderpunkte für jede neu besiedelte Insel.', min: 0, max: 9 },
        { path: 'islandBonusMax', type: 'num', label: 'Inselbonus für höchstens … Inseln', min: 0, max: 99 },
        { path: 'longestMin', type: 'num', label: 'Längste Route ab', min: 2, max: 20 },
        { path: 'armyMin', type: 'num', label: 'Stärkste Schutzmacht ab', min: 1, max: 20 },
      ] },
      { id: 'vorraete', title: 'Vorräte & Limits', rows: [
        { path: 'limits.road', type: 'num', label: 'Straßen', min: 1, max: 99, inf: true },
        { path: 'limits.ship', type: 'num', label: 'Schiffe', min: 1, max: 99, inf: true },
        { path: 'limits.settlement', type: 'num', label: 'Siedlungen', min: 1, max: 99, inf: true },
        { path: 'limits.city', type: 'num', label: 'Städte', min: 1, max: 99, inf: true },
        { path: 'limits.dev', type: 'num', label: 'Entwicklungskarten', tip: 'Standard: 25 Karten (ab 5 Spielern 34). ∞: Ziehen mit Zurücklegen.', min: 1, max: 99, inf: true, std: true },
      ], subs: [
        { title: 'Bank-Vorrat je Rohstoff', note: '∞ = die Bank geht nie leer.', rows: RES.map((r) => ({ path: 'limits.bank.' + r, type: 'num', label: Art.RES_NAMES[r], icon: Art.res(r, 22), min: 1, max: 99, inf: true, mini: true })) },
        { title: 'Nebel-Felder je Gelände', note: 'Wie viele Felder der Sorte aufgedeckt werden können (∞ = beliebig viele).', rows: TER.map((t) => ({ path: 'limits.fogTerrain.' + t, type: 'num', label: Art.TERRAIN_NAMES[t] || t, min: 1, max: 99, inf: true, mini: true })) },
        { title: 'Nebel-Wertechips je Zahl', note: 'Wie oft jede Zahl beim Aufdecken vergeben wird.', rows: CHIPS.map((c) => ({ path: 'limits.fogChips.' + c, type: 'num', label: String(c), min: 1, max: 99, inf: true, mini: true })) },
      ] },
      { id: 'verlassen', title: 'Verlassen', rows: [
        { path: 'leaver', type: 'seg', label: 'Wenn jemand geht', tip: 'Übernahme: Mitspieler dürfen Teile seiner Infrastruktur übernehmen. Verschwinden: alles wird nach einigen Runden entfernt.', opts: [['uebernahme', 'Übernahme'], ['verschwinden', 'Verschwinden']] },
        { path: 'vanishRounds', type: 'num', label: 'Verschwinden nach … Runden', min: 1, max: 99, dep: 'leaver=verschwinden' },
      ] },
    ];
  }
  const rowsOf = (g) => g.rows.concat(...(g.subs || []).map((s) => s.rows));

  function ctlHTML(r) {
    const defv = getp(DEF, r.path);
    if (r.type === 'seg') {
      return `<div class="ctl seg" data-path="${r.path}" data-type="seg" role="radiogroup" aria-label="${C.esc(r.label)}">${r.opts.map(([v, l]) => `<button type="button" role="radio" data-val="${v}" aria-checked="false">${l}</button>`).join('')}</div>`;
    }
    return `<div class="ctl num${r.mini ? ' mini' : ''}" data-path="${r.path}" data-type="num" data-min="${r.min}" data-max="${r.max}" data-def="${defv === null ? 'inf' : defv}" data-mode="num">` +
      `<button type="button" class="stp" data-s="-1" aria-label="weniger">−</button>` +
      `<input type="number" inputmode="numeric" min="${r.min}" max="${r.max}" step="1" aria-label="${C.esc(r.label)}">` +
      `<button type="button" class="stp" data-s="1" aria-label="mehr">+</button>` +
      (r.suffix ? `<span class="sfx">${r.suffix}</span>` : '') +
      (r.std ? '<button type="button" class="tg" data-tg="std" title="Standardwert verwenden" aria-pressed="false">Std</button>' : '') +
      (r.inf ? `<button type="button" class="tg" data-tg="inf" title="${r.infLabel || 'Unbegrenzt'}" aria-pressed="false">∞</button>` : '') + '</div>';
  }
  function defHint(r) {
    const d = getp(DEF, r.path);
    if (r.type === 'seg') { const o = r.opts.find((x) => String(x[0]) === String(d)); return o ? o[1] : ''; }
    return d === null ? '∞' : d === 'standard' ? 'Standard' : String(d) + (r.suffix || '');
  }
  function rowHTML(r) {
    if (r.mini) return `<div class="srow mini" data-row="${r.path}"><span class="sl">${r.icon || ''}${C.esc(r.label)}</span>${ctlHTML(r)}</div>`;
    return `<div class="srow" data-row="${r.path}"${r.dep ? ` data-dep="${r.dep}"` : ''}><span class="sl" ${r.tip ? `title="${C.esc(r.tip)}"` : ''}>${C.esc(r.label)}<small>Standard: ${C.esc(defHint(r))}</small></span>${ctlHTML(r)}</div>`;
  }
  function panelHTML() {
    return `<details class="setpanel" open><summary><span>Spieleinstellungen</span><small id="setHint"></small></summary><div class="setbody">` +
      schema().map((g) => `<section class="sgroup" data-g="${g.id}"><h4>${g.title}</h4>${g.rows.map(rowHTML).join('')}` +
        (g.subs || []).map((s) => `<details class="subset"><summary>${s.title}</summary><p class="snote">${s.note}</p><div class="sgrid">${s.rows.map(rowHTML).join('')}</div></details>`).join('') + '</section>').join('') +
      `<div class="setfoot"><button type="button" class="btn small ghostb" id="setReset" title="Alle Regeln und Vorräte auf die Standardwerte zurücksetzen">Standard wiederherstellen</button></div></div></details>`;
  }

  // ---- Zustand der Einstellungs-Eingaben (Debounce, lokale Vorrang-Werte) -----------------------
  const ovr = new Map();       // path -> {val, until}  (eigene Eingaben, die der Server noch nicht bestaetigt hat)
  let patch = {}, flushT = 0, lastSettings = null;
  const isHost = () => { const v = C.view(); return !!v && v.host === v.you; };
  const eff = (path) => { const o = ovr.get(path); if (o && o.until > Date.now()) return o.val; return lastSettings ? getp(lastSettings, path) : undefined; };

  function queue(path, val) {
    ovr.set(path, { val, until: Infinity });
    setp(patch, path, val);
    clearTimeout(flushT); flushT = setTimeout(flush, 300);
  }
  async function flush() {
    const p = patch, paths = [...ovr.entries()].filter(([, o]) => o.until === Infinity).map(([k]) => k);
    patch = {};
    if (!paths.length) return;
    const j = await C.act('set_settings', { settings: p });
    const now = Date.now();
    for (const k of paths) { const o = ovr.get(k); if (!o || o.until !== Infinity) continue; if (j && j.error) ovr.delete(k); else o.until = now + 1500; }
    if (lastSettings) syncSettings(lastSettings, true);
  }

  function readCtl(ctl) {
    const mode = ctl.dataset.mode, inp = ctl.querySelector('input');
    if (mode === 'inf') return null; if (mode === 'std') return 'standard';
    const n = Math.round(Number(inp.value)); return Number.isFinite(n) ? n : NaN;
  }
  function paintCtl(ctl, val) {
    if (ctl.dataset.type === 'seg') {
      ctl.querySelectorAll('button').forEach((b) => { const on = b.dataset.val === String(val); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      return;
    }
    const inp = ctl.querySelector('input'), def = ctl.dataset.def;
    const mode = val === null ? 'inf' : val === 'standard' ? 'std' : 'num';
    ctl.dataset.mode = mode;
    if (mode === 'num') inp.value = String(val);
    else if (mode === 'std') inp.value = '';
    else if (!inp.value || inp.value === '') inp.value = '';
    inp.placeholder = mode === 'inf' ? '∞' : mode === 'std' ? 'Std' : '';
    ctl.querySelectorAll('.tg').forEach((t) => t.setAttribute('aria-pressed', String((t.dataset.tg === 'inf' && mode === 'inf') || (t.dataset.tg === 'std' && mode === 'std'))));
    void def;
  }
  function syncSettings(s, force) {
    lastSettings = s;
    const host = isHost(), box = $('lobbySettings'); if (!box.firstChild) return;
    box.querySelectorAll('.ctl').forEach((ctl) => {
      const path = ctl.dataset.path; let val = eff(path); if (val === undefined) return;
      const busy = ctl.contains(document.activeElement) && ctl.dataset.type === 'num' && !force;
      ctl.classList.toggle('ro', !host);
      ctl.querySelectorAll('input,button').forEach((x) => { x.disabled = !host; });
      const row = ctl.closest('.srow');
      const def = getp(DEF, path); row.classList.toggle('chg', JSON.stringify(val) !== JSON.stringify(def));
      if (!busy) paintCtl(ctl, val);
      if (row.dataset.dep) { const [dp, dv] = row.dataset.dep.split('='); row.classList.toggle('inactive', String(eff(dp)) !== dv); }
    });
    const n = box.querySelectorAll('.srow.chg').length;
    $('setHint').textContent = (host ? '' : 'nur der Spielleiter kann ändern · ') + (n ? `${n} geändert` : 'Standard');
    $('setReset').hidden = !host;
  }
  function onSettingsEvents() {
    const box = $('lobbySettings');
    const cur = (ctl) => { const v = readCtl(ctl); return Number.isFinite(v) ? v : (Number(ctl.dataset.def) || Number(ctl.dataset.min)); };
    const clamp = (ctl, n) => Math.max(Number(ctl.dataset.min), Math.min(Number(ctl.dataset.max), n));
    box.addEventListener('click', (e) => {
      if (!isHost()) return;
      const seg = e.target.closest('.seg button');
      if (seg) { const v = seg.dataset.val; const val = v === 'true' ? true : v === 'false' ? false : v; paintCtl(seg.parentNode, val); queue(seg.parentNode.dataset.path, val); return; }
      const ctl = e.target.closest('.ctl.num'); if (!ctl) return;
      const path = ctl.dataset.path, st = e.target.closest('.stp'), tg = e.target.closest('.tg');
      let val;
      if (st) {
        let base = readCtl(ctl);
        if (base === null || base === 'standard' || Number.isNaN(base)) { const d = ctl.dataset.def; base = d === 'inf' || d === 'standard' ? (path === 'limits.dev' ? 25 : Number(ctl.dataset.min)) : Number(d); if (path === 'limits.dev' && ctl.dataset.mode === 'std') base = 25; }
        val = clamp(ctl, base + Number(st.dataset.s));
      } else if (tg) {
        const k = tg.dataset.tg, mode = ctl.dataset.mode;
        if (mode === k) { const d = ctl.dataset.def; val = d === 'inf' || d === 'standard' ? (path === 'limits.dev' ? 25 : clamp(ctl, 10)) : Number(d); }
        else val = k === 'inf' ? null : 'standard';
      } else return;
      paintCtl(ctl, val); queue(path, val);
      ctl.closest('.srow').classList.toggle('chg', JSON.stringify(val) !== JSON.stringify(getp(DEF, path)));
    });
    box.addEventListener('input', (e) => {
      const ctl = e.target.closest('.ctl.num'); if (!ctl || !isHost()) return;
      const n = Math.round(Number(e.target.value));
      if (e.target.value === '' || !Number.isFinite(n) || n < Number(ctl.dataset.min) || n > Number(ctl.dataset.max)) return; // erst senden, wenn gueltig
      ctl.dataset.mode = 'num'; ctl.querySelectorAll('.tg').forEach((t) => t.setAttribute('aria-pressed', 'false'));
      queue(ctl.dataset.path, n);
    });
    box.addEventListener('change', (e) => {
      const ctl = e.target.closest('.ctl.num'); if (!ctl || !isHost()) return;
      let n = Math.round(Number(e.target.value));
      if (e.target.value === '' && ctl.dataset.mode !== 'num') return;
      if (!Number.isFinite(n)) n = cur(ctl);
      n = clamp(ctl, n); e.target.value = String(n); ctl.dataset.mode = 'num'; queue(ctl.dataset.path, n);
    });
    box.addEventListener('click', (e) => {
      if (!e.target.closest('#setReset') || !isHost()) return;
      const p = JSON.parse(JSON.stringify(DEF)); ovr.clear(); clearTimeout(flushT);
      (function walk(o, pre) { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v, pre + k + '.'); else ovr.set(pre + k, { val: v, until: Infinity }); } })(p, '');
      patch = p; syncSettings(lastSettings, true); flush();
    });
  }

  // ---- Schreibgeschuetzte Zusammenfassung (Info-Dialog im Spiel) ---------------------------------
  function summaryHTML(s) {
    if (!s) return '<p class="muted">Keine Einstellungen verfügbar.</p>';
    const fmt = (r, v) => {
      if (r.type === 'seg') { const o = r.opts.find((x) => String(x[0]) === String(v)); return o ? o[1] : String(v); }
      if (v === null) return r.infLabel || 'unbegrenzt'; if (v === 'standard') return 'Standard';
      return v + (r.suffix || '');
    };
    const all = (s.variant ? `<div class="sum-row"><span>Variante</span><b>${C.esc(VNAME[s.variant] || s.variant)}</b></div>` : '') +
      (s.plannedPlayers ? `<div class="sum-row"><span>Geplante Spieler</span><b>${s.plannedPlayers}</b></div>` : '');
    return `<div class="sum">${all}` + schema().map((g) => {
      const main = g.rows.filter((r) => !(r.dep && String(getp(s, r.dep.split('=')[0])) !== r.dep.split('=')[1]))
        .map((r) => { const v = getp(s, r.path); const ch = JSON.stringify(v) !== JSON.stringify(getp(DEF, r.path)); return `<div class="sum-row${ch ? ' chg' : ''}"><span>${C.esc(r.label)}</span><b>${C.esc(fmt(r, v))}</b></div>`; }).join('');
      const subs = (g.subs || []).map((sb) => {
        const parts = sb.rows.map((r) => ({ r, v: getp(s, r.path) })), lim = parts.filter((x) => x.v !== null && x.v !== undefined);
        const val = lim.length ? lim.map((x) => `${C.esc(x.r.label)}&nbsp;${x.v}`).join(' · ') : 'alle unbegrenzt';
        return `<div class="sum-row${lim.length ? ' chg' : ''}"><span>${sb.title}</span><b class="wrapb">${val}</b></div>`;
      }).join('');
      return `<h4>${g.title}</h4>${main}${subs}`;
    }).join('') + '</div>';
  }

  // ---- Abweichende Regeln (Vergleich mit den Standardwerten) --------------------------------------------
  function deviations(s) {
    const out = [];
    if (!s) return out;
    const fmt = (r, v) => {
      if (r.type === 'seg') { const o = r.opts.find((x) => String(x[0]) === String(v)); return o ? o[1] : String(v); }
      if (v === null) return r.infLabel || '∞'; if (v === 'standard') return 'Standard';
      return v + (r.suffix || '');
    };
    if (s.variant && s.variant !== 'klassisch') out.push({ n: 'Variante', v: VNAME[s.variant] || s.variant, d: VNAME.klassisch });
    for (const g of schema()) {
      const add = (r, label) => {
        if (r.dep && String(getp(s, r.dep.split('=')[0])) !== r.dep.split('=')[1]) return;
        const v = getp(s, r.path); if (v === undefined) return;
        const d = getp(DEF, r.path);
        if (JSON.stringify(v) !== JSON.stringify(d)) out.push({ n: label, v: fmt(r, v), d: fmt(r, d) });
      };
      g.rows.forEach((r) => add(r, r.label));
      (g.subs || []).forEach((sb) => sb.rows.forEach((r) => add(r, `${sb.title.replace(/ je .*$/, '')} ${r.label}`)));
    }
    return out;
  }
  function deviationsHTML(s) {
    const d = deviations(s);
    if (!d.length) return '<p class="devnone">✓ Alle Regeln wie im Originalspiel.</p>';
    return `<ul class="devlist">${d.map((x) => `<li><span>${C.esc(x.n)}</span><b>${C.esc(x.v)}</b><small>Standard: ${C.esc(x.d)}</small></li>`).join('')}</ul>`;
  }

  // ======================================================================================
  // Lobby-Bildschirm
  // ======================================================================================
  const HEX = (cx, cy, s) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`; }).join(' ');
  function ring(R) { const o = []; for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) if (Math.abs(q + r) <= R) o.push([q, r]); return o; }
  function miniMap(id) {
    const cells = new Map(); const put = (q, r, t) => cells.set(q + ',' + r, [q, r, t]);
    if (id === 'klassisch') {
      ring(5).forEach(([q, r]) => put(q, r, 'fog')); ring(4).forEach(([q, r]) => put(q, r, 'sea'));
      ring(2).forEach(([q, r]) => put(q - 1, r, 'land')); [[3, -3], [3, 1], [-4, 1], [2, -4]].forEach(([q, r]) => put(q, r, 'land')); put(3, -2, 'gold');
    } else if (id === 'nebel') {
      ring(3).forEach(([q, r]) => put(q, r, 'fog')); ring(1).forEach(([q, r]) => put(q, r, 'sea')); [[0, 0], [1, 0], [0, 1], [-1, 1]].forEach(([q, r]) => put(q, r, 'land'));
    } else if (id === 'archipel') {
      ring(5).forEach(([q, r]) => put(q, r, 'fog')); ring(4).forEach(([q, r]) => put(q, r, 'sea'));
      [[-3, 0], [-3, 1], [-1, -2], [0, -2], [0, -1], [2, -3], [3, -3], [2, 0], [3, -1], [3, 0], [-1, 2], [0, 2], [-2, 3], [1, 3], [-4, 3], [4, -2]].forEach(([q, r], i) => put(q, r, i % 5 === 3 ? 'gold' : 'land'));
    } else {
      ring(4).forEach(([q, r]) => put(q, r, 'fog')); ring(3).forEach(([q, r]) => put(q, r, 'sea'));
      [[-3, 1], [-2, 1], [-3, 2], [2, -2], [3, -2], [2, -1], [-1, -2], [0, -2], [0, -3], [0, 2], [1, 1], [0, 3]].forEach(([q, r]) => put(q, r, 'land'));
    }
    const s = 9; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const pol = [...cells.values()].map(([q, r, t]) => { const cx = s * Math.sqrt(3) * (q + r / 2), cy = s * 1.5 * r; x0 = Math.min(x0, cx - s); x1 = Math.max(x1, cx + s); y0 = Math.min(y0, cy - s); y1 = Math.max(y1, cy + s); return `<polygon class="mh ${t}" points="${HEX(cx, cy, s * .94)}"/>`; }).join('');
    return `<svg viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}" aria-hidden="true">${pol}</svg>`;
  }
  const MINI = Object.fromEntries(VARIANTS.map((x) => [x.id, null]));

  function renderLobby(v) {
    const me = v.you, host = v.host === me, s = v.settings || {};
    lastSettings = v.settings || lastSettings;
    $('lbGame').textContent = v.gameName || '';
    $('lbCount').textContent = `${v.players.length}/${v.maxPlayers || 6}`;
    $('lbVariantName').textContent = VNAME[eff('variant')] ? '· ' + VNAME[eff('variant')] : '';

    // Spielerliste
    const act = document.activeElement;
    if (!(act && act.matches && act.matches('#lobbyList input[type=range]'))) {
      C.setHTML($('lobbyList'), v.players.map((p, i) => {
        const off = !p.connected && !p.gone;
        return `<li class="${i === me ? 'me' : ''}${off ? ' off' : ''}" data-pid="${i}" style="--pc:${C.colorOf(i)}">${C.avatar(i, 42)}<span class="nm">${C.esc(p.name)}</span>${p.bot ? `<span class="botTag" title="${C.esc((AVS.BOTS[p.bot] || {}).desc || '')}">Bot · ${C.esc((AVS.BOTS[p.bot] || {}).label || '')}</span>` : ''}` +
          `${i === v.host ? '<span class="crown" title="Spielleiter">♛ Spielleiter</span>' : ''}${i === me ? '<span class="you">du</span>' : ''}` +
          `${off ? '<span class="away" title="Die Verbindung ist unterbrochen.">getrennt</span>' : ''}${p.auto ? '<span class="away auto" title="Der Auto-Modus spielt für diesen Spieler.">Auto</span>' : ''}` +
          `${root.Voice && !p.bot ? root.Voice.badge(i) + (i !== me && root.Voice.inVoice(i) ? root.Voice.rowCtl(i) : '') : ''}` +
          `<span class="grow"></span>${host && i !== me ? `<button type="button" class="btn small red" data-kick="${i}" title="${C.esc(p.name)} aus der Lobby entfernen">Entfernen</button>` : ''}</li>`;
      }).join('') || '<li class="muted">Noch niemand hier.</li>');
      if (root.Voice) root.Voice.paintSpeaking();
    }
    C.setHTML($('lobbyVoice'), root.Voice ? root.Voice.panel() : '');
    // Bots hinzufügen (nur Spielleiter)
    const full = v.players.length >= (v.maxPlayers || 6), here = new Set(v.players.map((p) => p.bot).filter(Boolean));
    C.setHTML($('lobbyBots'), host ? `<details class="botdrop"${L.botsOpen ? ' open' : ''}><summary><span>Bots hinzufügen</span><small>${here.size} von ${Object.keys(AVS.BOTS).length} dabei</small></summary><div class="botcards">` + Object.entries(AVS.BOTS).map(([k, b]) => {
      const dis = here.has(k) || full || !!v.closed;
      return `<div class="botcard${here.has(k) ? ' here' : ''}"><img src="img/av/${b.avatar}.webp" alt="" draggable="false"><div class="bi"><b>${C.esc(b.name)}</b> <span class="botTag">${C.esc(b.label)}</span><small>${C.esc(b.desc)}</small></div>` +
        `<button type="button" class="btn small gold" data-addbot="${k}" ${dis ? 'disabled' : ''} title="${here.has(k) ? 'Ist schon dabei' : full ? 'Das Spiel ist voll' : v.closed ? 'Die Plätze sind als besetzt erklärt' : 'Als Mitspieler hinzufügen'}">${here.has(k) ? 'dabei' : 'Hinzufügen'}</button></div>`;
    }).join('') + '</div></details>' : '');

    // Variante, Spielerzahl, Plaetze
    const cur = eff('variant') || 'klassisch';
    C.setHTML($('lobbyVariants'), VARIANTS.map((x) =>
      `<button type="button" class="vcard${cur === x.id ? ' on' : ''}" data-var="${x.id}" role="radio" aria-checked="${cur === x.id}" ${host ? '' : 'disabled'} title="${host ? 'Variante wählen' : 'Nur der Spielleiter kann die Variante ändern.'}">` +
      `<span class="vmini-map">${MINI[x.id] || (MINI[x.id] = miniMap(x.id))}</span><b>${x.name}</b><span class="vdesc">${x.desc}</span><i class="vtick" aria-hidden="true">✓</i></button>`).join(''));
    const planned = eff('plannedPlayers') || v.players.length || 2, closed = !!v.closed;
    C.setHTML($('lobbySeats'),
      `<div class="seatrow"><span class="sl">Geplante Spielerzahl<small>Das Spielfeld wird dafür erzeugt.</small></span><div class="ctl num stepper"><button type="button" class="stp" data-plan="-1" ${host && planned > Math.max(2, v.players.length) ? '' : 'disabled'} aria-label="weniger">−</button><b class="pv">${planned}</b><button type="button" class="stp" data-plan="1" ${host && planned < (v.maxPlayers || 6) ? '' : 'disabled'} aria-label="mehr">+</button></div></div>` +
      `<div class="seatrow"><span class="sl">Plätze fertig besetzt<small>${closed ? 'Niemand kann mehr beitreten.' : 'Weitere Spieler können noch beitreten.'}</small></span>` +
      `<button type="button" class="switch${closed ? ' on' : ''}" data-closeseats="${closed ? 0 : 1}" role="switch" aria-checked="${closed}" ${host ? '' : 'disabled'} title="${host ? 'Schließt die Lobby für neue Spieler' : 'Nur der Spielleiter kann das ändern.'}"><i></i></button></div>`);

    // Abweichende Regeln (immer sichtbar)
    const dv = deviations(v.settings); C.setHTML($('lobbyDev'), deviationsHTML(v.settings)); $('devCount').textContent = dv.length ? String(dv.length) : '';

    // Einstellungen
    const box = $('lobbySettings'); if (!box.firstChild) box.innerHTML = panelHTML();
    syncSettings(s);

    // Brett neu wuerfeln
    C.setHTML($('lbRegen'), host ? `<button type="button" class="btn small gold" data-regen="1" title="Erzeugt ein neues Spielfeld mit denselben Einstellungen"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg> Neues Spielfeld würfeln</button>` : '<span class="muted small">Der Spielleiter wählt das Spielfeld.</span>');

    // Chat
    const chatEl = $('lobbyChat'), stick = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 40;
    if (C.setHTML(chatEl, (v.chat || []).map((c) => `<div class="ce"><b class="pn" style="color:${C.colorOf(c.p)}">${C.esc(v.players[c.p] ? v.players[c.p].name : '?')}</b> ${C.esc(c.text)}</div>`).join('') || '<div class="muted small">Noch keine Nachrichten.</div>') && stick) chatEl.scrollTop = chatEl.scrollHeight;

    // Start
    const can = v.players.length >= (v.minPlayers || 2);
    C.setHTML($('lobbyAct'), host
      ? `<button class="btn gold big${can ? '' : ' dis'}" id="startBtn" ${can ? '' : 'aria-disabled="true"'} title="${can ? 'Das Spiel beginnt für alle.' : 'Mindestens ' + (v.minPlayers || 2) + ' Spieler nötig'}">Spiel starten</button>` +
        (can ? '' : `<p class="hint">Mindestens ${v.minPlayers || 2} Spieler nötig (${v.players.length}/${v.maxPlayers || 6}).</p>`)
      : `<p class="waiting"><span class="spin"></span>Warte auf den Spielleiter…</p>`);
  }

  function initLobby() {
    onSettingsEvents();
    $('lobby').addEventListener('click', async (e) => {
      const v = C.view(); if (!v) return;
      const start = e.target.closest('#startBtn');
      if (start) { if (start.getAttribute('aria-disabled') === 'true') { C.toast(start.title || 'Zu wenige Spieler.', 'warn'); return; } await C.act('start'); return; }
      const vc = e.target.closest('[data-var]'); if (vc && !vc.disabled && isHost()) { ovr.set('variant', { val: vc.dataset.var, until: Infinity }); queue('variant', vc.dataset.var); renderLobby(v); return; }
      const pl = e.target.closest('[data-plan]'); if (pl && !pl.disabled && isHost()) { const n = Math.max(2, Math.min(v.maxPlayers || 6, (eff('plannedPlayers') || 2) + Number(pl.dataset.plan))); queue('plannedPlayers', n); renderLobby(v); return; }
      const ab = e.target.closest('[data-addbot]'); if (ab && !ab.disabled && isHost()) { ab.disabled = true; await C.act('add_bot', { kind: ab.dataset.addbot }); return; }
      const cs = e.target.closest('[data-closeseats]'); if (cs && !cs.disabled) { await C.act('close_seats', { closed: cs.dataset.closeseats === '1' }); return; }
      const rg = e.target.closest('[data-regen]'); if (rg && !rg.disabled) { rg.disabled = true; await C.act('regen_board'); setTimeout(() => { rg.disabled = false; }, 500); return; }
      const k = e.target.closest('[data-kick]');
      if (k) { const pid = Number(k.dataset.kick), name = v.players[pid] ? v.players[pid].name : ''; if (await Menu.confirm('Spieler entfernen?', `${name} wird aus der Lobby entfernt.`, 'Entfernen', true)) await C.act('kick', { pid }); }
    });
    $('lobbyChatForm').addEventListener('submit', async (e) => { e.preventDefault(); const t = $('lobbyChatIn').value.trim(); if (!t) return; $('lobbyChatIn').value = ''; await C.act('chat', { text: t }); });
    $('lobbyBots').addEventListener('toggle', (e) => { if (e.target.classList.contains('botdrop')) L.botsOpen = e.target.open; }, true); // Auf-/Zuklappen merken, auch wenn die Liste neu gezeichnet wird
    $('leaveBtn').addEventListener('click', () => C.leave());
  }
  const resetLocal = () => { ovr.clear(); patch = {}; clearTimeout(flushT); lastSettings = null; $('lobbySettings').replaceChildren(); };

  root.Lobby = {
    init(ctx) { C = ctx; initLogin(); initLobby(); },
    loginShown, setNotice, renderLobby, summaryHTML, deviations, deviationsHTML, resetLocal, VNAME,
  };
})(typeof self !== 'undefined' ? self : this);
