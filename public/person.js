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
      const others = (p.players || []).map((q) => q.name).join(', ');
      const sub = (t) => (t ? '<span class="psub">' + C.esc(t) + '</span>' : '');
      if (p.running) {
        // Dieselbe Sitzung (gleicher Token) braucht keinen Fortsetzen-Knopf.
        const hier = !p.paused && !!p.token && p.token === C.token();
        const line = [others, p.paused ? 'Pausiert' : '', hier ? 'Du spielst gerade' : ''].filter(Boolean).join(' · ');
        return '<div class="prow"><div><b>' + C.esc(p.name) + '</b>' + sub(line) + '</div>' +
          (hier ? '' : '<button type="button" class="btn gold" data-i="' + i + '">Fortsetzen</button>') + '</div>';
      }
      const dt = p.endedAt ? new Date(p.endedAt).toLocaleDateString('de-DE') : '';
      return '<div class="prow"><div><b>' + C.esc(p.name) + '</b>' + sub(
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
      if (!p || !p.running) return;
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

  root.Person = { init, dialog, list, link, personId, getPass, close };
})(window);
