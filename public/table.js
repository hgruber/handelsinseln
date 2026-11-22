// table.js – Digitaler Spieltisch: Anzeige in der Tischplatte (nur der Spielleiter-Browser, vom Spielleiter ein-/ausschaltbar).
// Der Server liefert der Tisch-Verbindung zusätzlich die Sicht aller Spieler (Ereignis „table“). Der Tisch zeigt die Sicht des
// „Fokus-Spielers“ (am Zug bzw. mit offener Pflicht) und handelt in dessen Namen (act mit `as`).
// Die Rohstoffleiste jedes Spielers sitzt am Bildschirmrand, zur Sitzposition gedreht; das Menü (#bottom, Handel) des
// Fokus-Spielers sitzt in seiner Leiste, Handelsangebote bekommt jeder Mitspieler als eigenes Menü an seinem Platz.
(function (root) {
  'use strict';
  const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
  // Plätze (b/t = unten/oben Mitte, l/r = links/rechts Mitte, bl/br/tl/tr = Ecken) legt der Spielleiter in der Lobby fest
  const EDGE = { b: 'b', bl: 'b', br: 'b', t: 't', tl: 't', tr: 't', l: 'l', r: 'r' };
  const $ = (id) => document.getElementById(id);
  let C = null, on = false, seatsEl = null, centerEl = null, key = '';
  const seats = new Map(); // pid -> {el, head, menu, panel, bar}
  const counter = new Map(); // pid -> {cg:{}, cw:{}} offenes Gegenangebot (Ich gebe / Ich bekomme)
  let last = null; // zuletzt gezeichnete {views, focus}
  const html = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; } };

  // Wer wird gerade bedient: Spieler mit offener Pflicht (Abwerfen, Gold), sonst der Spieler am Zug
  function focusOf(views) {
    const v = views[0];
    const owing = (k) => v.order.find((pid) => v.players[pid][k] > 0);
    if (v.step === 'discard') { const p = owing('discarding'); if (p != null) return p; }
    if (v.step === 'gold') { const p = owing('pickingGold'); if (p != null) return p; }
    return v.turn != null ? v.turn : v.host;
  }

  function build(v) {
    seatsEl = document.createElement('div'); seatsEl.id = 'seats';
    centerEl = document.createElement('div'); centerEl.id = 'tableCenter';
    const hud = $('hud'); hud.appendChild(seatsEl); hud.appendChild(centerEl);
    centerEl.appendChild($('banner')); centerEl.appendChild($('dice'));
    seatsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tr]'); if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const pid = Number(b.dataset.pid), what = b.dataset.tr, c = counter.get(pid);
      if (what === 'accept' || what === 'decline') { counter.delete(pid); C.act('trade_respond', { accept: what === 'accept' }, pid); return; }
      if (what === 'open') { counter.set(pid, { cg: {}, cw: {} }); }
      else if (what === 'back') counter.delete(pid);
      else if (what === 'send' && c) {
        const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));
        counter.delete(pid); C.act('trade_respond', { counter: { give: clean(c.cw), want: clean(c.cg) } }, pid);
      } else if (what === 'adj' && c) {
        const side = b.dataset.side, r = b.dataset.res, hand = last.views[pid].me.hand, d = Number(b.dataset.d);
        const n = Math.max(0, Math.min(side === 'cg' ? hand[r] || 0 : 19, (c[side][r] || 0) + d));
        if (n) c[side][r] = n; else delete c[side][r];
      }
      if (last) render(last.views, last.focus);
    });
    void v;
  }

  function layout(v) {
    const k = v.order.map((pid) => pid + ':' + v.players[pid].seat).join(',');
    if (k === key) return;
    key = k;
    for (const s of seats.values()) s.el.remove();
    seats.clear();
    v.order.forEach((pid) => {
      const el = document.createElement('section');
      const slot = v.players[pid].seat || 'b';
      el.className = 'seat s-' + slot; el.dataset.pid = pid;
      el.innerHTML = '<div class="seathead"></div><div class="seatmenu"></div><div class="seatpanel"></div><div class="seatbar"></div>';
      seatsEl.appendChild(el);
      seats.set(pid, { el, head: el.children[0], menu: el.children[1], panel: el.children[2], bar: el.children[3], slot });
    });
    // Ränder, an denen Plätze sitzen (für den Kamerabereich)
    const used = new Set([...seats.values()].map((s) => EDGE[s.slot]));
    document.body.dataset.tedges = [...used].join('');
  }

  function barHTML(hand, dev) {
    const dv = (dev || []).map((d) => `<div class="dc${d.fresh ? ' fresh' : ''}" title="${C.Art.DEV_NAMES[d.type]}${d.fresh ? ' (neu)' : ''}">${C.Art.dev(d.type, 26)}</div>`).join('');
    return RES.map((r) => `<div class="rc${hand[r] ? '' : ' zero'}" data-res="${r}" style="--rc:${C.Art.RES_COLORS[r]}" title="${C.Art.RES_NAMES[r]}: ${hand[r] || 0}">${C.Art.res(r, 30)}<b>${hand[r] || 0}</b></div>`).join('') + (dv ? `<span class="dcs">${dv}</span>` : '');
  }

  function menuHTML(views, pid, v) {
    const t = v.trade;
    if (!t || t.from === pid) return '';
    const me = views[pid], hand = me.me.hand, r = t.responses && t.responses[pid];
    const chips = (o) => `<span class="tchips">${RES.filter((x) => o[x] > 0).map((x) => `<span class="tchip" style="--rc:${C.Art.RES_COLORS[x]}">${C.Art.res(x, 24)}<b>${o[x]}</b></span>`).join('')}</span>`;
    const miss = RES.filter((x) => (t.want[x] || 0) > (hand[x] || 0));
    const from = v.players[t.from];
    if (counter.has(pid) && !r) {
      const c = counter.get(pid), tot = (o) => RES.reduce((a, x) => a + (o[x] || 0), 0);
      const row = (side, label) => `<div class="crow"><span class="muted">${label}</span>${RES.map((x) => `<span class="cc" style="--rc:${C.Art.RES_COLORS[x]}"><button type="button" data-tr="adj" data-pid="${pid}" data-side="${side}" data-res="${x}" data-d="-1">−</button>${C.Art.res(x, 22)}<b>${c[side][x] || 0}</b><button type="button" data-tr="adj" data-pid="${pid}" data-side="${side}" data-res="${x}" data-d="1">+</button></span>`).join('')}</div>`;
      const ok = tot(c.cg) > 0 && tot(c.cw) > 0 && !RES.some((x) => (c.cg[x] || 0) > (hand[x] || 0) || (c.cg[x] && c.cw[x]));
      return `<div class="tpanel glass tmenu" style="--pc:${C.Art.COLORS[from.color]}"><div class="who">${C.avatar(t.from, 30)}<b>Gegenangebot an ${C.esc(from.name)}</b></div>${row('cg', 'Ich gebe')}${row('cw', 'Ich bekomme')}` +
        `<div class="tact"><button type="button" class="btn ghostb" data-tr="back" data-pid="${pid}">Zurück</button><button type="button" class="btn gold${ok ? '' : ' dis'}" data-tr="send" data-pid="${pid}" ${ok ? '' : 'aria-disabled="true"'}>Senden</button></div></div>`;
    }
    const state = r ? `<span class="st ${r.s === 'accept' ? 'ok' : r.s === 'decline' ? 'no' : 'cnt2'}">${r.s === 'accept' ? '✓ angenommen' : r.s === 'decline' ? '✗ abgelehnt' : '⇄ Gegenangebot'}</span>` : '';
    return `<div class="tpanel glass tmenu" style="--pc:${C.Art.COLORS[from.color]}"><div class="who">${C.avatar(t.from, 30)}<b>${C.esc(from.name)} bietet</b></div>` +
      `<div class="offer-line"><div class="ol"><span class="muted">Du erhältst</span>${chips(t.give)}</div><span class="tarrow sm">⇄</span><div class="ol"><span class="muted">Du gibst</span>${chips(t.want)}</div></div>` +
      (state || `<div class="tact"><button type="button" class="btn green${miss.length ? ' dis' : ''}" data-tr="accept" data-pid="${pid}" ${miss.length ? 'aria-disabled="true"' : ''}>Annehmen</button><button type="button" class="btn red" data-tr="decline" data-pid="${pid}">Ablehnen</button><button type="button" class="btn ghostb" data-tr="open" data-pid="${pid}">Gegenangebot</button></div>`) + '</div>';
  }

  function render(views, focus) {
    last = { views, focus };
    const v = views[focus];
    if (!v.trade) counter.clear();
    layout(v);
    document.body.dataset.tseat = (seats.get(focus) || {}).slot || 'b';
    for (const [pid, s] of seats) {
      const pv = views[pid], p = v.players[pid], active = pid === focus;
      s.el.classList.toggle('active', active);
      s.el.classList.toggle('turn', v.turn === pid);
      s.el.style.setProperty('--pc', C.Art.COLORS[p.color]);
      html(s.head, `${C.avatar(pid, 34)}<b class="nm">${C.esc(p.name)}</b><span class="vp">${p.vp + (pv.me.hiddenVp || 0)}<i>★</i></span>` +
        `<span class="dv" title="Entwicklungskarten">${C.Art.dev('ritter', 16)}${p.devCount || 0}</span>` +
        (p.discarding ? `<span class="duty">⚠ wirft ${p.discarding} ab</span>` : '') + (p.pickingGold ? `<span class="duty gold">✦ Gold ×${p.pickingGold}</span>` : ''));
      html(s.bar, active ? '' : barHTML(pv.me.hand, pv.me.dev));
      $('dice').style.display = $('dicebox').hidden ? 'none' : '';
      html(s.menu, active ? '' : menuHTML(views, pid, v));
      if (active) {
        if ($('bottom').parentNode !== s.panel) s.panel.appendChild($('bottom'));
        if ($('tradeDock').parentNode !== s.menu) s.menu.appendChild($('tradeDock'));
      }
    }
  }

  function activate(views) {
    if (on) return;
    on = true; key = '';
    document.body.classList.add('table');
    build(views[0]);
  }
  function deactivate() {
    if (!on) return;
    on = false; key = '';
    const hud = $('hud');
    $('hud').insertBefore($('banner'), $('players'));
    $('dicebox').insertBefore($('dice'), $('primary'));
    $('side').insertBefore($('tradeDock'), $('side').firstChild);
    hud.appendChild($('bottom'));
    if (seatsEl) seatsEl.remove(); if (centerEl) centerEl.remove();
    seats.clear(); seatsEl = centerEl = null;
    document.body.classList.remove('table'); delete document.body.dataset.tseat; delete document.body.dataset.tedges;
  }

  root.Table = {
    init(ctx) { C = ctx; },
    focusOf, render, activate, deactivate,
    isOn: () => on,
  };
})(typeof self !== 'undefined' ? self : this);
