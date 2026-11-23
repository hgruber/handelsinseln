// fx.js – Animation von Rohstoffkarten: fliegen von der Quelle (Feld, Bank, Spieler) zum Ziel (Spieler, Bank).
// Der Server liefert in view.fx die letzten Kartenbewegungen {id, f, t, c:{res:n}|-, n, pub, why}; f/t = 'bank' | 'p:<Spieler>' | 'h:<Feld>'.
// Eigene Karten fliegen groß und mit Gesicht, öffentliche Bewegungen anderer klein mit Gesicht, verdeckte (Diebstahl unter anderen,
// Abwerfen anderer) als Kartenrücken. Jede Karte startet leicht versetzt, damit man sieht, wer was bekommt.
(function (root) {
  'use strict';
  const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
  let C = null, seen = null, layer = null;
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  // Bildschirmposition eines Ortes; res = Rohstoff (für den Kartenplatz in der eigenen Hand)
  function where(ref, v, res) {
    const W = root.innerWidth, H = root.innerHeight;
    if (ref === 'bank') return C.table && C.table() ? { x: W - 46, y: H - 46 } : { x: W / 2, y: 34 }; // Tisch: Bank = Ecke unten rechts
    if (ref.startsWith('h:')) {
      const el = C.hexEl(ref.slice(2));
      if (el) { const p = center(el.getBoundingClientRect()); return { x: Math.max(20, Math.min(W - 20, p.x)), y: Math.max(20, Math.min(H - 20, p.y)) }; }
      return { x: W / 2, y: H / 2 };
    }
    const pid = +ref.slice(2);
    if (C.table && C.table()) { // Spieltisch: Ziel ist die Rohstoffleiste am Platz des Spielers
      const seat = document.querySelector(`.seat[data-pid="${pid}"]`);
      const slot = seat && res && seat.querySelector(`[data-res="${res}"]`);
      if (slot) return center(slot.getBoundingClientRect());
      if (seat) return center(seat.getBoundingClientRect());
    }
    if (pid === v.you) {
      const slot = res && document.querySelector(`#hand .rcard[data-res="${res}"]`);
      if (slot) return center(slot.getBoundingClientRect());
      const hand = document.getElementById('hand');
      if (hand) return center(hand.getBoundingClientRect());
      return { x: W / 2, y: H - 60 };
    }
    const pc = document.querySelector(`.pc[data-pid="${pid}"]`);
    if (pc) { const r = pc.getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }; }
    return { x: 80, y: 100 };
  }

  function cardEl(res, hidden, mine, size) {
    const d = document.createElement('div');
    d.className = 'fxc' + (hidden ? ' back' : '') + (mine ? ' mine' : '');
    d.style.cssText = `width:${size}px;height:${Math.round(size * 1.3)}px;` + (hidden ? '' : `--rc:${C.Art.RES_COLORS[res]};`);
    if (!hidden) d.innerHTML = C.Art.res(res, Math.round(size * 0.78));
    return d;
  }

  // Karte wächst im Flug auf doppelte Größe und kehrt zur ursprünglichen zurück (manuell und auto gleich, auto nur schneller)
  function flight(from, to, el, size, delay, dur) {
    const hw = size / 2, hh = size * 0.65;
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2 - Math.min(70, Math.hypot(to.x - from.x, to.y - from.y) / 4);
    const t = (p, s, r) => `translate(${p.x - hw}px, ${p.y - hh}px) scale(${s}) rotate(${r}deg)`;
    const a = el.animate([
      { transform: t(from, 1, -10), opacity: 0 },
      { transform: t({ x: from.x + (mx - from.x) * 0.25, y: from.y + (my - from.y) * 0.25 }, 1.5, -4), opacity: 1, offset: 0.15 },
      { transform: t({ x: mx, y: my }, 2, 2), opacity: 1, offset: 0.5 },
      { transform: t(to, 1, 0), opacity: 1, offset: 0.88 },
      { transform: t(to, 0.7, 0), opacity: 0 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
    a.onfinish = () => el.remove();
    return a;
  }

  function pulse(ref, v, delay) {
    if (!ref.startsWith('p:')) return;
    const pid = +ref.slice(2);
    const el = C.table && C.table() ? document.querySelector(`.seat[data-pid="${pid}"]`) : pid === v.you ? document.getElementById('hand') : document.querySelector(`.pc[data-pid="${pid}"]`);
    if (!el) return;
    setTimeout(() => { el.classList.add('fxpulse'); setTimeout(() => el.classList.remove('fxpulse'), 450); }, delay);
  }

  function play(v) {
    const evs = (v && v.fx) || [];
    const maxId = evs.length ? evs[evs.length - 1].id : 0;
    const land = {}; // Rohstoff -> ms bis die letzte eigene Karte im Depot ankommt
    if (seen === null || maxId < seen) { seen = maxId; return land; } // erste Sicht / neues Spiel: nicht nachspielen
    const fresh = evs.filter((e) => e.id > seen);
    seen = Math.max(seen, maxId);
    if (!fresh.length || reduced() || document.hidden) return land;
    if (!layer) { layer = document.createElement('div'); layer.id = 'fxLayer'; document.body.appendChild(layer); }
    const T = (C.slow && C.slow()) ? 2.6 : 1.6; // manueller Ablauf: deutlich langsamer, Auto etwas schneller
    const step = Math.max(120, Math.min(380, 3600 / fresh.length)) * T; // Abstand zwischen den Bewegungen
    fresh.forEach((e, i) => {
      // Spieltisch: alle schauen auf denselben Bildschirm – nur öffentliche Bewegungen (Ertrag, Handel, Bank) zeigen Gesichter
      const tbl = !!(C.table && C.table()), me = 'p:' + v.you, mine = !tbl && (e.f === me || e.t === me), hidden = tbl ? !e.pub : !e.c;
      const size = mine ? 46 : hidden ? 26 : 32;
      const list = [];
      if (e.c && !hidden) RES.forEach((r) => { for (let k = 0; k < (e.c[r] || 0); k++) list.push(r); });
      else for (let k = 0; k < e.n; k++) list.push(null);
      const shown = list.slice(0, 8);
      const base = i * step;
      shown.forEach((r, j) => {
        const el = cardEl(r, hidden || r === null, mine, size);
        layer.appendChild(el);
        const from = where(e.f, v, r), to = where(e.t, v, r);
        const dur = (mine ? 1000 : 820) * T, dl = base + j * 130 * T;
        flight(from, to, el, size, dl, dur);
        if (r && e.t === me && !tbl) land[r] = Math.max(land[r] || 0, dl + dur * 0.88);
      });
      pulse(e.t, v, base + 130 * T * (shown.length - 1) + (mine ? 850 : 700) * T);
    });
    return land;
  }

  root.Fx = { init(ctx) { C = ctx; }, play, reset() { seen = null; } };
})(typeof self !== 'undefined' ? self : this);
