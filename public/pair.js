// pair.js – Gerätekopplung: QR/Code anzeigen (anzeigendes Gerät) und Angebot einlösen (Handy).
// Kontext von app.js: { post, toast, token(), joined(), showLogin }
(function (root) {
  'use strict';
  let C = null;
  let box = null, timer = 0, tick = 0;

  function init(ctx) { C = ctx; }

  function close() {
    clearInterval(timer); clearInterval(tick);
    timer = tick = 0;
    if (box) { box.remove(); box = null; }
  }

  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  function show(r, opts) {
    close();
    const url = location.origin + location.pathname + '#k=' + r.nonce;
    let qr = '';
    try { qr = root.QR ? root.QR.svg(url, { px: 220 }) : ''; } catch (e) { qr = ''; }
    const until = Date.now() + (r.ms || 60000);
    box = el(`<div class="pairback">
      <div class="pairbox glass" data-k="${C.esc(r.nonce)}" role="dialog" aria-modal="true" aria-label="Gerät koppeln">
        <div class="pairq">${qr || '<span class="pnote">QR-Code nicht verfügbar.</span>'}</div>
        <p class="pnote">Scanne den QR-Code mit der Kamera des anderen Geräts.</p>
        <p class="ptime">Noch <b>60</b> s</p>
        <div class="pact"><button type="button" class="btn ghostb">Abbrechen</button></div>
      </div>
    </div>`);
    document.body.appendChild(box);
    const timeEl = box.querySelector('.ptime b');
    box.querySelector('.pact .btn').addEventListener('click', close);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    tick = setInterval(() => {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      timeEl.textContent = String(left);
      if (left <= 0) close();
    }, 500);
    timer = setInterval(async () => {
      const s = await C.post('/api/pair/check', { nonce: r.nonce, secret: r.secret });
      if (s.error) return;
      if (s.expired) { close(); C.toast('Der Kopplungscode ist abgelaufen.', 'warn'); return; }
      if (s.claimed && s.token) {
        close();
        C.toast('Gerät verbunden.', 'ok');
        if (opts && opts.onDone) opts.onDone(s); else if (!C.token()) C.joined({ token: s.token, game: s.game });
      }
    }, 2000);
  }

  // Angebot anlegen. pid: Platz, dessen Sitzung übertragen wird (ohne Angabe: eigener Platz).
  async function open(opts) {
    const o = opts || {};
    const r = await C.post('/api/pair', { token: C.token(), pid: o.pid });
    if (r.error) { C.toast(r.error, 'err'); return; }
    show(r, o);
  }

  // Ein Angebot aus dem URL-Fragment (#k=…) einlösen.
  async function fromHash(k) {
    const had = C.token();
    const r = await C.post('/api/pair/claim', { nonce: k, token: had });
    if (r.error) C.toast(r.error, 'err');
    else if (r.role === 'receiver' && r.token) { C.joined({ token: r.token, game: r.game }); return; }
    else C.toast('Gerät verbunden.', 'ok');
    if (had) C.joined({ token: had }); else C.showLogin();
  }

  root.Pair = { init, open, fromHash, close };
})(window);
