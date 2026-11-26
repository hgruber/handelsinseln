// person.js – Spielerpass: anlegen, eingeben, Partien wiederfinden.
// Der Pass bleibt auf dem Gerät; an den Server geht nur HMAC(pass, serverId).
// Kontext von app.js: { post, toast, esc, token(), joined() }
(function (root) {
  'use strict';
  const KEY = 'handelsinseln.pass';
  let C = null, serverId = null, serverP = null, box = null;

  function init(ctx) {
    C = ctx;
    syncLabel();
    ensureServer();
  }

  function ensureServer() {
    if (serverId) return Promise.resolve(serverId);
    if (!serverP) {
      serverP = fetch('/api/config').then((r) => r.json())
        .then((c) => { serverId = c && c.serverId ? c.serverId : null; return serverId; })
        .catch(() => null);
    }
    return serverP;
  }

  function getPass() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function setPass(p) {
    try { if (p) localStorage.setItem(KEY, p); else localStorage.removeItem(KEY); } catch (e) { /* egal */ }
    syncLabel();
  }

  // Beschriftung auf der Anmeldung: ohne Pass führt der Link zum Pass, mit Pass zu den Partien.
  function syncLabel() {
    const b = document.getElementById('myGamesBtn');
    if (b) b.textContent = getPass() ? 'Meine Partien' : 'Spielerpass';
  }
  function normalize(p) {
    return String(p || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  }

  // Personen-ID: HMAC-SHA256(pass, serverId), lokal berechnet. Der Pass verlässt das Gerät nie.
  async function personId(pass) {
    const sid = await ensureServer();
    if (!sid || !root.crypto || !root.crypto.subtle) return null;
    const enc = new TextEncoder();
    const key = await root.crypto.subtle.importKey('raw', enc.encode(pass), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await root.crypto.subtle.sign('HMAC', key, enc.encode(sid));
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Die laufende Partie mit dem Pass verknüpfen (damit „Meine Partien“ sie findet).
  async function link() {
    const pass = getPass();
    if (!pass || !C.token()) return;
    const id = await personId(pass);
    if (!id) return;
    const r = await C.post('/api/person/link', { token: C.token(), personId: id });
    if (r && r.error) console.warn('Spielerpass nicht verknüpft:', r.error);
  }

  function open(html, cls) {
    close();
    box = document.createElement('div');
    box.className = 'passback';
    box.innerHTML = '<div class="passbox glass ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(box);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    return box.querySelector('.passbox');
  }
  function close() { if (box) { box.remove(); box = null; } }

  function dialog() {
    const pass = getPass();
    if (!pass) { return choose(); }
    const words = pass.split(' ').map((w) => C.esc(w)).join(' ');
    const b = open(
      '<div class="pq">Mein Spielerpass</div>' +
      '<div class="passwords">' + words + '</div>' +
      '<p class="pnote">Mit diesen Wörtern findest du deine Partien auf jedem Gerät wieder. Behandle sie wie ein Passwort – wer sie kennt, sieht deine Partien.</p>' +
      '<div class="pact column">' +
      '<button type="button" class="btn gold" data-p="list">Meine Partien</button>' +
      '<button type="button" class="btn ghostb" data-p="new">Neuen Pass anlegen</button>' +
      '<button type="button" class="btn ghostb" data-p="clear">Pass von diesem Gerät entfernen</button>' +
      '</div><div class="pact"><button type="button" class="btn" data-p="close">Schließen</button></div>'
    );
    b.addEventListener('click', (e) => {
      const x = e.target.closest('[data-p]'); if (!x) return;
      const what = x.dataset.p;
      if (what === 'list') list();
      else if (what === 'new') anew();
      else if (what === 'clear') { setPass(''); close(); C.toast('Spielerpass von diesem Gerät entfernt.', 'ok'); }
      else close();
    });
  }

  function choose() {
    const b = open(
      '<div class="pq">Spielerpass</div>' +
      '<p class="pnote">Mit einem Spielerpass findest du deine Partien wieder – auch nach dem Löschen der Browserdaten oder auf einem anderen Gerät. Er ist freiwillig.</p>' +
      '<div class="pact column"><button type="button" class="btn gold" data-p="new">Neuen Pass anlegen</button>' +
      '<button type="button" class="btn ghostb" data-p="in">Vorhandenen eingeben</button></div>' +
      '<div class="pact"><button type="button" class="btn" data-p="close">Abbrechen</button></div>'
    );
    b.addEventListener('click', (e) => {
      const x = e.target.closest('[data-p]'); if (!x) return;
      if (x.dataset.p === 'new') anew();
      else if (x.dataset.p === 'in') enter();
      else close();
    });
  }

  function anew() {
    const p = root.Woerter.pass();
    const b = open(
      '<div class="pq">Dein Spielerpass</div>' +
      '<div class="passwords big">' + C.esc(p) + '</div>' +
      '<p class="pnote">Notiere dir diese vier Wörter jetzt. Sie werden nicht wieder angezeigt. Wer sie kennt, sieht deine Partien.</p>' +
      '<div class="pact"><button type="button" class="btn gold" data-p="ok">Ich habe sie notiert</button>' +
      '<button type="button" class="btn ghostb" data-p="no">Abbrechen</button></div>'
    );
    b.addEventListener('click', (e) => {
      const x = e.target.closest('[data-p]'); if (!x) return;
      if (x.dataset.p === 'ok') {
        setPass(p); close(); link();
        C.toast('Spielerpass angelegt.', 'ok');
      } else close();
    });
  }

  function enter() {
    const b = open(
      '<div class="pq">Spielerpass eingeben</div>' +
      '<p class="pnote">Gib die vier Wörter ein, getrennt durch Leerzeichen.</p>' +
      '<input class="passin" type="text" maxlength="80" autocomplete="off" spellcheck="false" aria-label="Spielerpass">' +
      '<div class="pact"><button type="button" class="btn gold" data-p="ok">Weiter</button>' +
      '<button type="button" class="btn ghostb" data-p="no">Abbrechen</button></div>'
    );
    const inp = b.querySelector('.passin');
    inp.focus();
    const go = async () => {
      const p = normalize(inp.value);
      if (p.split(' ').length !== 4) { C.toast('Bitte alle vier Wörter eingeben.', 'warn'); return; }
      setPass(p); close(); await link(); list();
    };
    b.addEventListener('click', (e) => {
      const x = e.target.closest('[data-p]'); if (!x) return;
      if (x.dataset.p === 'ok') go(); else close();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  async function list() {
    const pass = getPass();
    if (!pass) return choose();
    const id = await personId(pass);
    if (!id) { C.toast('Der Spielerpass braucht HTTPS oder localhost.', 'err'); return; }
    const r = await C.post('/api/person', { personId: id });
    if (r.error) { C.toast(r.error, 'err'); return; }
    const rows = (r.partien || []).map((p, i) => {
      const others = (p.players || []).filter((q) => !q.you).map((q) => q.name).join(', ');
      const sub = (t) => (t ? '<span class="psub">' + C.esc(t) + '</span>' : '');
      if (p.running) {
        // Dieselbe Sitzung (gleicher Token) braucht keinen Fortsetzen-Knopf.
        const hier = !p.paused && !!p.token && p.token === C.token();
        const line = [others, p.paused ? 'Pausiert' : '', hier ? 'Du spielst gerade' : ''].filter(Boolean).join(' · ');
        return '<div class="prow"><div><b>' + C.esc(p.name) + '</b>' + sub(line) + '</div>' +
          (hier ? '' : '<button type="button" class="btn gold" data-i="' + i + '">Fortsetzen</button>') + '</div>';
      }
      const dt = p.endedAt ? new Date(p.endedAt).toLocaleDateString('de-DE') : '';
      return '<div class="prow end" data-i="' + i + '" title="Endstand, Punkteverlauf und Regeln ansehen"><div><b>' + C.esc(p.name) + '</b>' + sub(
        (dt ? 'Beendet am ' + dt : 'Beendet') + (others ? ' · ' + others : '') +
        (p.winner ? ' · Sieger: ' + p.winner : '') + (p.vp != null ? ' · ' + p.vp + ' Punkte' : '')
      ) + '</div></div>';
    }).join('');
    const b = open(
      '<div class="pq">Meine Partien</div>' +
      (rows ? '<div class="plist">' + rows + '</div>' : '<p class="pnote">Keine Partien gefunden. Laufende Partien erscheinen hier, sobald dieses Gerät mit dem Pass verknüpft ist.</p>') +
      '<div class="pact"><button type="button" class="btn ghostb" data-p="pass">Spielerpass</button>' +
      '<button type="button" class="btn" data-p="close">Schließen</button></div>'
    );
    b.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-p]');
      if (c) { if (c.dataset.p === 'pass') dialog(); else close(); return; }
      const x = e.target.closest('[data-i]'); if (!x) return;
      const p = r.partien[Number(x.dataset.i)];
      if (!p) return;
      if (!p.running) { detail(p); return; }
      if (p.paused) {
        // Pausierte Partie: der Pass holt den Platz samt neuem Sitzungstoken zurück.
        const res = await C.post('/api/person/resume', { personId: await personId(getPass()), game: p.game });
        if (res.error) { C.toast(res.error, 'err'); return; }
        close(); C.joined({ token: res.token, game: res.game });
        return;
      }
      if (p.token) { close(); C.joined({ token: p.token, game: p.game }); }
    });
  }

  // Punkteverlauf der Partie als kleine Linien (history: je Eintrag die Punkte pro Platz).
  function curve(p) {
    const hist = (p.history || []).filter((h) => Array.isArray(h) || (h && Array.isArray(h.vp)));
    const P = p.players || [];
    if (hist.length < 2 || !P.length) return '';
    const COL = (root.Art && root.Art.COLORS) || {};
    const vpOf = (h, i) => (Array.isArray(h) ? h[i] : (h.vp || [])[i]) || 0;
    const W = 380, H = 170, ml = 26, mr = 96, mt = 12, mb = 24, pw = W - ml - mr, ph = H - mt - mb;
    const maxV = Math.max(1, (p.settings && p.settings.winPoints) || 0, ...hist.map((h) => Math.max(0, ...P.map((_, i) => vpOf(h, i)))));
    const step = maxV <= 10 ? 2 : maxV <= 20 ? 4 : 5, top = Math.ceil(maxV / step) * step;
    const x = (k) => ml + k / (hist.length - 1) * pw, y = (v) => mt + ph - v / top * ph;
    let g = '';
    for (let t = 0; t <= top; t += step) g += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${ml - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`;
    const xs = Math.max(1, Math.ceil(hist.length / 6));
    for (let k = 0; k < hist.length; k += xs) g += `<text class="ax" x="${x(k).toFixed(1)}" y="${mt + ph + 16}" text-anchor="middle">${k + 1}</text>`;
    g += `<text class="ax" x="${ml + pw / 2}" y="${H - 4}" text-anchor="middle">Runde</text>`;
    let lines = '';
    const labels = P.map((q, i) => {
      const col = COL[q.color] || '#ccc';
      const pts = hist.map((h, k) => `${x(k).toFixed(1)},${y(vpOf(h, i)).toFixed(1)}`);
      lines += `<g style="--c:${col}"><polyline class="vl" points="${pts.join(' ')}"/></g>`;
      const vp = vpOf(hist[hist.length - 1], i);
      return { y: y(vp), name: q.name, vp, col };
    }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    const lab = labels.map((l) => `<text class="dl" x="${ml + pw + 9}" y="${(l.y + 4).toFixed(1)}" style="fill:${l.col}"><tspan>${C.esc(l.name.length > 9 ? l.name.slice(0, 8) + '…' : l.name)}</tspan> <tspan class="dv">${l.vp}</tspan></text>`).join('');
    return '<h4>Punkteverlauf</h4><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Siegpunkte pro Runde"><line class="axis" x1="' + ml + '" x2="' + (ml + pw) + '" y1="' + (mt + ph) + '" y2="' + (mt + ph) + '"/>' + g + lines + lab + '</svg>';
  }

  // Rückblick auf eine beendete Partie: Endstand, Punkteverlauf und die Regeln dieser Partie.
  function detail(p) {
    const P = (p.players || []).slice().sort((a, b) => (b.vp || 0) - (a.vp || 0));
    const COL = (root.Art && root.Art.COLORS) || {};
    const aborted = p.result !== 'sieg';
    const dt = p.endedAt ? new Date(p.endedAt).toLocaleDateString('de-DE') : '';
    const meta = [aborted ? 'Ohne Sieger' : 'Sieger: ' + (p.winner || '–'),
      p.minutes != null ? p.minutes + ' Min.' : '', p.rounds != null ? p.rounds + ' Runden' : ''].filter(Boolean).join(' · ');
    const rank = P.length ? '<ol class="rank">' + P.map((q, i) =>
      '<li class="' + (!aborted && q.name === p.winner ? 'first' : '') + '" style="--pc:' + (COL[q.color] || '#888') + '">' +
      '<span class="pos">' + (i + 1) + '.</span><span class="nm">' + C.esc(q.name) + (q.you ? ' <small>(du)</small>' : '') + '</span><b>' + (q.vp || 0) + ' ★</b></li>'
    ).join('') + '</ol>' : '';
    const regeln = root.Lobby && root.Lobby.deviationsHTML && p.settings
      ? '<div class="pregeln"><h4>Regeln dieser Partie</h4>' + root.Lobby.deviationsHTML(p.settings) + '</div>' : '';
    const b = open(
      '<div class="pq">Partie' + (dt ? ' vom ' + dt : '') + '</div>' +
      '<p class="pnote">' + C.esc(meta) + '</p>' + rank + curve(p) + regeln +
      '<div class="pact"><button type="button" class="btn ghostb" data-p="back">Zurück zu meinen Partien</button>' +
      '<button type="button" class="btn" data-p="close">Schließen</button></div>',
      'wide'
    );
    b.addEventListener('click', (e) => {
      const x = e.target.closest('[data-p]'); if (!x) return;
      if (x.dataset.p === 'back') list(); else close();
    });
  }

  root.Person = { init, dialog, list, link, personId, getPass, close };
})(window);
