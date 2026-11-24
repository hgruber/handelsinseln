// table.js – Digitaler Spieltisch: Anzeige in der Tischplatte (nur der Spielleiter-Browser, Plätze legt der Spielleiter in der Lobby fest).
// Der Server liefert der Tisch-Verbindung zusätzlich die Sicht aller Spieler (Ereignis „table“). Der Tisch zeigt die Sicht des
// „Fokus-Spielers“ (am Zug bzw. mit offener Pflicht) und handelt in dessen Namen (act mit `as`).
// Jeder Platz besteht aus einem geheimen Bereich (eine Zeile, feste Größe: Rohstoffe + bis zu 4 Entwicklungskarten, immer sichtbar)
// und einer öffentlichen Zeile darüber (nur am Zug: Baukosten, Handeln, Würfeln/Zug beenden, Würfel; sonst Avatar, Name, Punkte).
// Ist der Spieler am Zug, rutscht sein Namensfeld links neben den geheimen Bereich. Alle Plätze sind zur Sitzposition gedreht.
(function (root) {
  'use strict';
  const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
  const EDGE = { b: 'b', bl: 'b', br: 'b', t: 't', tl: 't', tr: 't', l: 'l', r: 'r' };
  const $ = (id) => document.getElementById(id);
  let C = null, on = false, seatsEl = null, msgEl = null, key = '', seenLog = null;
  const askOpen = new Set(), backOpen = new Set(); // Plätze mit offener Rückfrage zur Kontrollübergabe bzw. -rückgabe
  let reqs = []; // offene Kontrollanfragen (Nummer, Restzeit)
  const seats = new Map(); // pid -> {el, menu, ctl, badgeTop, badgeSide, secret, hb, slot}
  const counter = new Map(); // pid -> {cg:{}, cw:{}} offenes Gegenangebot (Ich gebe / Ich bekomme)
  let last = null; // zuletzt gezeichnete {views, focus}
  const html = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; } };

  // Wer wird gerade bedient: Spieler mit offener Pflicht (Abwerfen, Gold), sonst der Spieler am Zug
  function focusOf(views) {
    const v = views[0];
    // Wer eine Pflicht hat: Tischspieler zuerst (Online-Spieler und Bots erledigen sie selbst am Handy bzw. automatisch)
    const owing = (k) => v.order.find((pid) => v.players[pid][k] > 0 && !views[pid].watch) ?? v.order.find((pid) => v.players[pid][k] > 0);
    if (v.step === 'discard') { const p = owing('discarding'); if (p != null) return p; }
    if (v.step === 'gold') { const p = owing('pickingGold'); if (p != null) return p; }
    return v.turn != null ? v.turn : v.host >= 0 ? v.host : (v.order && v.order.length ? v.order[0] : 0);
  }

  function build() {
    seatsEl = document.createElement('div'); seatsEl.id = 'seats';
    msgEl = document.createElement('div'); msgEl.id = 'tableMsgs';
    const hud = $('hud'); hud.appendChild(seatsEl); hud.appendChild(msgEl);
    seatsEl.addEventListener('click', (e) => {
      // Kontrollübergabe: Hamburger in der Leiste → Rückfrage mit der Nummer → bestätigen oder ablehnen
      const hr = e.target.closest('[data-hreq]');
      if (hr) { const pid = Number(hr.dataset.hreq); askOpen.has(pid) ? askOpen.delete(pid) : askOpen.add(pid); if (last) render(last.views, last.focus, false, reqs); return; }
      const hq = e.target.closest('[data-hq]');
      if (hq) { const pid = Number(hq.dataset.pid); askOpen.delete(pid); C.act('handover_answer', { pid, code: hq.dataset.code, accept: hq.dataset.hq === 'yes' }); if (last) render(last.views, last.focus, false, reqs); return; }
      const hb = e.target.closest('[data-hback]');
      if (hb) { const pid = Number(hb.dataset.hback); backOpen.has(pid) ? backOpen.delete(pid) : backOpen.add(pid); if (last) render(last.views, last.focus, false, reqs); return; }
      const hbq = e.target.closest('[data-hbq]');
      if (hbq) { const pid = Number(hbq.dataset.pid); backOpen.delete(pid); if (hbq.dataset.hbq === 'yes') C.act('handback', { pid }); if (last) render(last.views, last.focus, false, reqs); return; }
      const b = e.target.closest('[data-tr]'); if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const pid = Number(b.dataset.pid), what = b.dataset.tr, c = counter.get(pid);
      if (what === 'accept' || what === 'decline') { counter.delete(pid); C.act('trade_respond', { accept: what === 'accept' }, pid); return; }
      if (what === 'open') { counter.set(pid, { cg: {}, cw: {} }); }
      else if (what === 'back') counter.delete(pid);
      else if (what === 'send' && c) {
        const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));
        counter.delete(pid); C.act('trade_respond', { counter: { give: clean(c.cw), want: clean(c.cg) } }, pid);
      } else if (what === 'adj' && c) {
        const side = b.dataset.side, r = b.dataset.res, d = Number(b.dataset.d);
        const n = Math.max(0, Math.min(19, (c[side][r] || 0) + d));
        if (n) c[side][r] = n; else delete c[side][r];
      }
      if (last) render(last.views, last.focus);
    });
    msgEl.addEventListener('click', (e) => { const m = e.target.closest('.tmsg'); if (m) m.remove(); });
    // Zuschauer-Handy: langes Drücken auf die Leiste eines übernehmbaren Platzes fragt dessen Kontrolle an
    let hold = null;
    const stopHold = () => { if (hold) { clearTimeout(hold.t); hold = null; } };
    seatsEl.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('watch') || !C.hold) return;
      const bd = e.target.closest('.badge'), seat = bd && bd.closest('.seat'); if (!seat) return;
      const pid = Number(seat.dataset.pid), v = last && last.views[0];
      if (!v || !(v.takeable || []).includes(pid)) return;
      stopHold(); hold = { x: e.clientX, y: e.clientY, t: setTimeout(() => { hold = null; C.hold(pid); }, 700) };
    });
    seatsEl.addEventListener('pointermove', (e) => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) stopHold(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => seatsEl.addEventListener(n, stopHold));
    seatsEl.addEventListener('contextmenu', (e) => { if (document.body.classList.contains('watch') && e.target.closest('.badge')) e.preventDefault(); });
  }

  // Platzabfrage beim Start: Der Spieler, der dran ist, sieht sein großes Avatar und wählt per Knopf seinen Platz (3 unten, 3 oben, je 1 links/rechts)
  const SIDES = [['bl', 'b', 'br'], ['tl', 't', 'tr']];
  const SEAT_LABEL = { tl: 'oben links', t: 'oben Mitte', tr: 'oben rechts', l: 'links', r: 'rechts', bl: 'unten links', b: 'unten Mitte', br: 'unten rechts' };
  function seatAsk(v) {
    let el = $('seatAsk');
    if (v.step !== 'setup_seat') { if (el) el.remove(); return; }
    const pid = v.turn, p = v.players[pid], by = {};
    v.players.forEach((q) => { if (q.seat) by[q.seat] = q; });
    const btn = (b) => { const q = by[b]; return `<button type="button" class="sa-seat${q ? ' taken' : ''}" data-seat="${b}" ${q ? 'disabled' : ''}>${q ? `${C.avatar(q.id, 34)}<span>${C.esc(q.name)}</span>` : `<span>${SEAT_LABEL[b]}</span>`}</button>`; };
    const h = `<div class="sa-box glass"><div class="sa-av">${C.avatar(pid, 132)}</div><h2>Wo sitzt du, ${C.esc(p.name)}?</h2>` +
      `<div class="sa-grid">${['tl', 't', 'tr', 'l', null, 'r', 'bl', 'b', 'br'].map((b) => (b ? btn(b) : '<div class="sa-table">Tisch</div>')).join('')}</div></div>`;
    if (!el) { el = document.createElement('div'); el.id = 'seatAsk'; $('hud').appendChild(el); el.addEventListener('click', (e) => { const b = e.target.closest('.sa-seat'); if (b && !b.disabled && last) C.act('place_seat', { seat: b.dataset.seat }, last.views[0].turn); }); }
    html(el, h);
  }
  // Elemente aus den Plätzen zurück an sichere Orte, bevor die Plätze neu aufgebaut werden
  function parkAll() {
    $('bottom').appendChild($('build')); $('bottom').appendChild($('dicebox'));
    $('side').insertBefore($('tradeDock'), $('side').firstChild);
    $('hud').insertBefore($('camBtns'), $('sideToggle'));
  }

  function layout(v) {
    const placed = v.order.filter((pid) => v.players[pid].seat);
    const k = placed.map((pid) => pid + ':' + v.players[pid].seat).join(',');
    if (k === key) return;
    key = k;
    parkAll();
    for (const s of seats.values()) s.el.remove();
    seats.clear();
    const occ = new Set(placed.map((pid) => v.players[pid].seat));
    placed.forEach((pid) => {
      const slot = v.players[pid].seat;
      const el = document.createElement('section');
      el.className = 'seat s-' + slot; el.dataset.pid = pid;
      el.innerHTML = '<div class="seatmenu"></div><div class="badgerow"><div class="badge above"></div></div><div class="pubrow"><div class="badge top"></div><div class="seatctl"><div class="seathint"></div></div></div>' +
        '<div class="secretrow"><div class="secret"></div><div class="seathb"></div></div>';
      seatsEl.appendChild(el);
      const q = (c) => el.querySelector(c);
      // sitzen auf einer langen Seite Nachbarn nebeneinander, werden die Plätze verkleinert, damit sie sich nicht überdecken
      const grp = SIDES.find((g) => g.includes(slot));
      if (grp) { const i = grp.indexOf(slot); if ((i > 0 && occ.has(grp[i - 1])) || (i < 2 && occ.has(grp[i + 1]))) el.style.zoom = Math.min(1, innerWidth * 0.3 / 575); }
      seats.set(pid, { el, menu: q('.seatmenu'), ctl: q('.seatctl'), hint: q('.seathint'), badgeTop: q('.badge.top'), badgeAbove: q('.badge.above'), secret: q('.secret'), hb: q('.seathb'), slot });
    });
  }

  // Namensfeld: Avatar, Name, öffentliche Punkte und weitere öffentliche Daten
  function badgeHTML(v, p, pid, extra) {
    const A = C.Art;
    return `${C.avatar(pid, 36)}<span class="bn2"><b class="nm">${C.esc(p.name)}</b><span class="bst">` +
      `<span title="Öffentliche Siegpunkte"><b>${p.vp}</b>★</span>` +
      `<span title="Rohstoffkarten auf der Hand">▯ ${p.resCount}</span>` +
      `<span title="Entwicklungskarten">${A.dev('ritter', 13)}${p.devCount || 0}</span>` +
      `<span title="Gespielte Ritter">⚔ ${p.knightsPlayed}</span>` +
      `<span title="Längster Handelsweg">${A.pieceIcon('road', p.color, 13)}${p.longestRoute}</span>` +
      (p.hasLongest ? '<span class="bdg2" title="Längster Handelsweg">Längster</span>' : '') + (p.hasLargest ? '<span class="bdg2" title="Stärkste Schutzmacht">Ritter</span>' : '') +
      (p.discarding ? `<span class="duty">⚠ wirft ${p.discarding} ab</span>` : '') + (p.pickingGold ? `<span class="duty gold">✦ Gold ×${p.pickingGold}</span>` : '') +
      `</span></span>${extra || ''}`;
  }

  // Geheimer Bereich: Rohstoffstapel und Entwicklungskarten (immer sichtbar, bis zu 4 Karten, feste Größe)
  function secretHTML(v, pv, pid, active) {
    const A = C.Art, hand = pv.me.hand, t = v.trade;
    const short = t && t.from === pid ? t.give : null; // angebotener Rohstoff, den der Spieler nicht hat: Stapel blinkt rot
    const res = RES.map((r) => `<div class="rc${hand[r] ? '' : ' zero'}${short && (short[r] || 0) > (hand[r] || 0) ? ' short' : ''}" data-res="${r}" style="--rc:${A.RES_COLORS[r]}" title="${A.RES_NAMES[r]}">${A.res(r, 30)}<b>${hand[r] || 0}</b></div>`).join('');
    const devs = pv.me.dev || [];
    const dv = devs.slice(0, 4).map((d) => {
      const can = active && d.playable;
      return `<${can ? 'button type="button"' : 'div'} class="dc${can ? ' play' : ''}${d.fresh ? ' fresh' : ''}" ${can ? `data-a="dev" data-type="${d.type}" data-id="${C.esc(d.id)}"` : ''} title="${A.DEV_NAMES[d.type]}${d.fresh ? ' (neu)' : ''}">${A.dev(d.type, 26)}</${can ? 'button' : 'div'}>`;
    }).join('') + (devs.length > 4 ? `<span class="dmore">+${devs.length - 4}</span>` : '');
    return `<span class="rcs">${res}</span><span class="dcs">${dv}</span>`;
  }

  function menuHTML(views, pid, v) {
    const t = v.trade;
    if (!t || t.from === pid) return '';
    const me = views[pid], hand = me.me.hand, r = t.responses && t.responses[pid];
    const chips = (o) => `<span class="tchips">${RES.filter((x) => o[x] > 0).map((x) => `<span class="tchip" style="--rc:${C.Art.RES_COLORS[x]}">${C.Art.res(x, 24)}<b>${o[x]}</b></span>`).join('')}</span>`;
    const from = v.players[t.from];
    if (counter.has(pid) && !r) {
      const c = counter.get(pid), tot = (o) => RES.reduce((a, x) => a + (o[x] || 0), 0);
      const row = (side, label) => `<div class="crow"><span class="muted">${label}</span>${RES.map((x) => `<span class="cc" style="--rc:${C.Art.RES_COLORS[x]}"><button type="button" data-tr="adj" data-pid="${pid}" data-side="${side}" data-res="${x}" data-d="-1">−</button>${C.Art.res(x, 22)}<b>${c[side][x] || 0}</b><button type="button" data-tr="adj" data-pid="${pid}" data-side="${side}" data-res="${x}" data-d="1">+</button></span>`).join('')}</div>`;
      const ok = tot(c.cg) > 0 && tot(c.cw) > 0 && !RES.some((x) => c.cg[x] && c.cw[x]);
      return `<div class="tpanel glass tmenu" style="--pc:${C.Art.COLORS[from.color]}"><div class="who">${C.avatar(t.from, 30)}<b>Gegenangebot an ${C.esc(from.name)}</b></div>${row('cg', 'Ich gebe')}${row('cw', 'Ich bekomme')}` +
        `<div class="tact"><button type="button" class="btn ghostb" data-tr="back" data-pid="${pid}">Zurück</button><button type="button" class="btn gold${ok ? '' : ' dis'}" data-tr="send" data-pid="${pid}" ${ok ? '' : 'aria-disabled="true"'}>Senden</button></div></div>`;
    }
    const state = r ? `<span class="st ${r.s === 'accept' ? 'ok' : r.s === 'decline' ? 'no' : 'cnt2'}">${r.s === 'accept' ? '✓ angenommen' : r.s === 'decline' ? '✗ abgelehnt' : '⇄ Gegenangebot'}</span>` : '';
    void hand;
    return `<div class="tpanel glass tmenu" style="--pc:${C.Art.COLORS[from.color]}"><div class="who">${C.avatar(t.from, 30)}<b>${C.esc(from.name)} bietet</b></div>` +
      `<div class="offer-line"><div class="ol"><span class="muted">Du erhältst</span>${chips(t.give)}</div><span class="tarrow sm">⇄</span><div class="ol"><span class="muted">Du gibst</span>${chips(t.want)}</div></div>` +
      (state || `<div class="tact"><button type="button" class="btn green" data-tr="accept" data-pid="${pid}">Annehmen</button><button type="button" class="btn red" data-tr="decline" data-pid="${pid}">Ablehnen</button><button type="button" class="btn ghostb" data-tr="open" data-pid="${pid}">Gegenangebot</button></div>`) + '</div>';
  }

  // Nachrichten an alle: neue Protokolleinträge erscheinen kurz in der Tischmitte (verschwinden selbst oder per Klick)
  function messages(v) {
    const lg = v.log || [], max = lg.length ? lg[lg.length - 1].id : 0;
    if (seenLog === null || max < seenLog) { seenLog = max; return; }
    // Reihenfolge, Würfel, Karten und alles, was direkt auf dem Spielfeld passiert (Bauen, Räuber, Schiffe), ist am Tisch zu sehen
    const skip = /ist an der Reihe| würfelt |erhält|^Startrohstoffe|^Handel:| baut | setzt | versetzt ein Schiff| stellt den | übernimmt | legt /;
    const fresh = lg.filter((l) => l.id > seenLog && !skip.test(l.text));
    seenLog = max;
    fresh.slice(-3).forEach((l) => {
      const d = document.createElement('div');
      d.className = 'tmsg k-' + l.kind; d.textContent = l.text; d.title = 'Zum Schließen klicken';
      msgEl.appendChild(d);
      while (msgEl.children.length > 4) msgEl.firstChild.remove();
      setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, 6000);
    });
  }

  // Standortwahl am Tisch: wer am Handy eine Aktion freigegeben hat, steht im Hinweis seines Platzes
  const ARM_LABEL = { settlement: 'Siedlung', city: 'Stadt', road: 'Straße', ship: 'Schiff', takeover: 'Übernahme', move: 'Schiff versetzen' };
  const STEP_LABEL = { setup_settlement: 'Siedlung', setup_road: 'Straße oder Schiff', road_building: 'Straße oder Schiff', robber: 'Räuber oder Pirat' };
  function armHint(v, pid) {
    const a = v.arm;
    if (!a || a.pid !== pid) return '';
    return a.pick ? '✓ Ziel gewählt – wartet auf die Bestätigung am Handy' : 'Tippe auf den Tisch: ' + (ARM_LABEL[a.mode] || STEP_LABEL[a.step] || '');
  }

  // Zuschauer: Handel nur zum Ansehen (Angebot und Antworten), keine Knöpfe
  function watchMenuHTML(v, pid) {
    const t = v.trade;
    if (!t || t.from !== pid) return '';
    const chips = (o) => `<span class="tchips">${RES.filter((x) => o[x] > 0).map((x) => `<span class="tchip" style="--rc:${C.Art.RES_COLORS[x]}">${C.Art.res(x, 24)}<b>${o[x]}</b></span>`).join('')}</span>`;
    const st = (r) => (r.s === 'accept' ? '<span class="st ok">✓</span>' : r.s === 'decline' ? '<span class="st no">✗</span>' : '<span class="st cnt2">⇄</span>');
    const res = v.order.filter((p) => p !== pid).map((p) => { const r = t.responses && t.responses[p]; return `<span class="wr">${C.avatar(p, 22)}${r ? st(r) : '<span class="st">…</span>'}</span>`; }).join('');
    return `<div class="tpanel glass tmenu" style="--pc:${C.Art.COLORS[v.players[pid].color]}"><div class="who">${C.avatar(pid, 30)}<b>${C.esc(v.players[pid].name)} bietet</b></div>` +
      `<div class="offer-line"><div class="ol">${chips(t.give)}</div><span class="tarrow sm">⇄</span><div class="ol">${chips(t.want)}</div></div><div class="wresp">${res}</div></div>`;
  }

  // Rückfrage am Platz: „Kontrolle an Nummer … abgeben?“ bzw. „Kontrolle wieder am Spieltisch?“
  function handoverPanel(pid, rq, v) {
    const col = C.Art.COLORS[v.players[pid].color];
    if (rq && askOpen.has(pid)) {
      return `<div class="tpanel glass tmenu hask" style="--pc:${col}"><b>Kontrolle abgeben?</b><div class="hcode">${C.esc(rq.code)}</div><small>Ein Handy fragt mit dieser Nummer an – zeigt es dieselbe Nummer?</small>` +
        `<div class="tact"><button type="button" class="btn green" data-hq="yes" data-pid="${pid}" data-code="${C.esc(rq.code)}">Ja, abgeben</button><button type="button" class="btn red" data-hq="no" data-pid="${pid}" data-code="${C.esc(rq.code)}">Ablehnen</button></div></div>`;
    }
    if (!rq && backOpen.has(pid)) {
      return `<div class="tpanel glass tmenu hask" style="--pc:${col}"><b>Kontrolle zurück an den Spieltisch?</b><small>Das Handy dieses Spielers wird abgemeldet.</small>` +
        `<div class="tact"><button type="button" class="btn green" data-hbq="yes" data-pid="${pid}">Ja, zurück</button><button type="button" class="btn ghostb" data-hbq="no" data-pid="${pid}">Nein</button></div></div>`;
    }
    return '';
  }

  function render(views, focus, watch, requests) {
    last = { views, focus };
    if (requests !== undefined) reqs = requests || [];
    const v = views[focus];
    layout(v);
    if (watch) { const el = $('seatAsk'); if (el) el.remove(); } else seatAsk(v);
    messages(v);
    document.body.dataset.tseat = (seats.get(focus) || {}).slot || 'b';
    if (!v.trade) counter.clear();
    const isPub = (pid) => !!watch || !!(views[pid] && views[pid].watch); // Zuschauer-Tisch oder Online-Spieler/Bot am Tisch: nur Öffentliches
    const diceSeat = v.turn === focus && v.phase !== 'ended' ? focus : null; // Würfel zeigt auch der öffentliche Platz des Spielers am Zug
    for (const [pid, s] of seats) {
      const pv = views[pid], p = v.players[pid], active = pid === focus, turn = v.turn === pid, pub = isPub(pid);
      s.el.classList.toggle('active', active);
      s.el.classList.toggle('pub', pub);
      s.el.classList.toggle('turn', turn);
      s.el.classList.toggle('ctl', pid === diceSeat);
      // Aufbau: der Spieler am Zug sieht in seiner Zeile, was er tun soll (Siedlung bzw. Straße/Schiff setzen)
      html(s.hint, armHint(v, pid) ? C.esc(armHint(v, pid)) : pid === diceSeat && v.phase === 'setup' && (v.step === 'setup_settlement' || v.step === 'setup_road') ? C.esc(v.prompt || '') : '');
      s.el.style.setProperty('--pc', C.Art.COLORS[p.color]);
      const rq = !watch ? reqs.find((r) => r.pid === pid) : null;
      if (!rq) askOpen.delete(pid);
      if (!p.handover) backOpen.delete(pid);
      const hbtn = rq ? `<button type="button" class="hreq blink" data-hreq="${pid}" title="Ein Handy möchte die Kontrolle übernehmen" aria-label="Kontrollanfrage">☰</button>` : !watch && p.handover ? `<button type="button" class="hreq" data-hback="${pid}" title="Dieser Platz wird von einem Handy gesteuert" aria-label="Kontrolle an den Spieltisch">☰</button>` : '';
      const bh = badgeHTML(v, p, pid, hbtn);
      html(s.badgeTop, bh); html(s.badgeAbove, bh);
      if (!pub) html(s.secret, secretHTML(v, pv, pid, active));
      const menuH = handoverPanel(pid, rq, v) + (pub ? (v.trade && v.trade.from === pid ? watchMenuHTML(v, pid) : '') : active ? '' : menuHTML(views, pid, v));
      if (s.menu._h !== menuH && $('tradeDock').parentNode === s.menu) $('side').insertBefore($('tradeDock'), $('side').firstChild); // das Handelsfenster nicht mit dem Menü überschreiben
      html(s.menu, menuH);
      if (!pub && active && $('tradeDock').parentNode !== s.menu) s.menu.appendChild($('tradeDock'));
      if (pid === diceSeat) {
        if ($('build').parentNode !== s.ctl) s.ctl.appendChild($('build'));
        if ($('dicebox').parentNode !== s.ctl) s.ctl.appendChild($('dicebox'));
      }
      if (!watch && pid === v.host && $('camBtns').parentNode !== s.hb) s.hb.appendChild($('camBtns')); // Hamburger-Menü rechts vom geheimen Bereich des Spielleiters
    }
    if (diceSeat === null) { // niemand am Zug: Bedienelemente wegräumen
      const b = $('bottom');
      if ($('build').parentNode !== b) b.appendChild($('build'));
      if ($('dicebox').parentNode !== b) b.appendChild($('dicebox'));
    }
    $('dice').style.display = $('dicebox').hidden ? 'none' : '';
  }

  function activate() {
    if (on) return;
    on = true; key = ''; seenLog = null;
    document.body.classList.add('table');
    build();
  }
  function deactivate() {
    if (!on) return;
    on = false; key = ''; seenLog = null;
    const hud = $('hud'), b = $('bottom');
    hud.insertBefore($('camBtns'), $('sideToggle'));
    b.insertBefore($('build'), $('score')); b.insertBefore($('dicebox'), $('score'));
    $('side').insertBefore($('tradeDock'), $('side').firstChild);
    if ($('seatAsk')) $('seatAsk').remove();
    if (seatsEl) seatsEl.remove(); if (msgEl) msgEl.remove();
    seats.clear(); seatsEl = msgEl = null;
    document.body.classList.remove('table'); delete document.body.dataset.tseat; delete document.body.dataset.tedges;
  }

  root.Table = {
    init(ctx) { C = ctx; },
    focusOf, render, activate, deactivate,
    isOn: () => on,
  };
  void EDGE;
})(typeof self !== 'undefined' ? self : this);
