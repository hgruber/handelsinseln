// trade.js – Handels-Panel (Composer, Angebotsanzeige, Antworten, Gegenangebot).
// Haengt sich in #tradeDock ein; alle Daten kommen aus der aktuellen View.
(function (root) {
  'use strict';
  const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
  let C = null; // Kontext aus app.js: {root, view(), act(), toast(), esc(), Art, avatar(pid,size), pname(pid)}
  const S = { open: false, collapsed: false, give: {}, want: {}, cg: {}, cw: {}, counterOpen: false, tradeId: null, html: '', busy: false };

  const sum = (o) => RES.reduce((a, r) => a + (o && o[r] > 0 ? o[r] : 0), 0);
  const clean = (o) => { const x = {}; for (const r of RES) if (o && o[r] > 0) x[r] = o[r]; return x; };
  const rn = (r) => C.Art.RES_NAMES[r];

  function chips(o, big) {
    const s = RES.filter((r) => o && o[r] > 0).map((r) =>
      `<span class="tchip" title="${o[r]}× ${rn(r)}" style="--rc:${C.Art.RES_COLORS[r]}">${C.Art.res(r, big ? 30 : 22)}<b>${o[r]}</b></span>`).join('');
    return `<span class="tchips">${s || '<em class="muted">nichts</em>'}</span>`;
  }
  function missing(hand, need) {
    return RES.filter((r) => (need[r] || 0) > (hand[r] || 0)).map((r) => `${need[r] - (hand[r] || 0)}× ${rn(r)}`);
  }

  // ---- Karten mit Zaehler -----------------------------------------------------------
  function card(side, r, n, limit, hand) {
    const dim = limit === 0 ? ' dim' : '';
    return `<div class="tc${n > 0 ? ' sel' : ''}${dim}" data-side="${side}" data-res="${r}" style="--rc:${C.Art.RES_COLORS[r]}" title="${rn(r)} – Klick: +1 · Rechtsklick oder gedrückt halten: −1">` +
      `${C.Art.res(r, 34)}<span class="tn">${rn(r)}</span><b class="cnt">${n}</b>` +
      (hand != null ? `<span class="have" title="Im Besitz">${hand}</span>` : '') +
      `<button type="button" class="minus" data-side="${side}" data-res="${r}" aria-label="${rn(r)} −1">−</button></div>`;
  }
  const grid = (side, vals, hand, limited) => `<div class="tgrid">${RES.map((r) => card(side, r, vals[r] || 0, limited ? (hand[r] || 0) : 9, limited ? hand[r] || 0 : null)).join('')}</div>`;

  // ---- Panels ---------------------------------------------------------------------------
  function head(title, extra) {
    return `<header><b>${title}</b><span class="grow"></span>${extra || ''}` +
      `<button type="button" class="ghost" data-do="collapse" title="${S.collapsed ? 'Aufklappen' : 'Einklappen'}">${S.collapsed ? '▴' : '▾'}</button></header>`;
  }

  function composer(v) {
    const hand = v.me.hand, rates = v.rates || {};
    const sbp = v.step === 'sbp';
    const gs = RES.filter((r) => S.give[r] > 0), ws = RES.filter((r) => S.want[r] > 0);
    let bank = null, hint = 'Wähle links eine Sorte zum Abgeben und rechts eine zum Erhalten.';
    if (gs.length === 1 && ws.length === 1) {
      const g = gs[0], w = ws[0], rate = rates[g] || 4;
      if (g === w) hint = 'Gleiche Rohstoffe lassen sich nicht tauschen.';
      else if (S.give[g] === rate * S.want[w]) { bank = { g, w, times: S.want[w], rate }; hint = ''; }
      else hint = `Bank: ${rate}× ${rn(g)} für 1× ${rn(w)} (du gibst ${S.give[g]}, willst ${S.want[w]})`;
    } else if (gs.length || ws.length) hint = 'Für die Bank: genau eine Sorte geben und eine andere erhalten.';
    const canOffer = !sbp && sum(S.give) > 0 && sum(S.want) > 0 && !missing(hand, S.give).length;
    const offerWhy = sbp ? 'In der Sonderbauphase ist nur Handel mit der Bank erlaubt.' : !sum(S.give) || !sum(S.want) ? 'Wähle, was du gibst und was du möchtest.' : missing(hand, S.give).length ? 'Dir fehlen: ' + missing(hand, S.give).join(', ') : 'Angebot an alle Mitspieler senden';
    const rateChips = RES.map((r) => {
      const rt = rates[r] || 4, ok = (hand[r] || 0) >= rt;
      return `<button type="button" class="rate r${rt}${ok ? '' : ' off'}" data-rate="${r}" style="--rc:${C.Art.RES_COLORS[r]}" title="${rt}× ${rn(r)} → 1 beliebiger Rohstoff${rt < 4 ? (rt === 2 ? ' (2:1-Hafen)' : ' (3:1-Hafen)') : ' (Bank 4:1)'}${ok ? ' – Klick füllt „Ich gebe“' : ' – zu wenig Karten'}">${C.Art.res(r, 20)}<b>${rt}:1</b></button>`;
    }).join('');
    const body = `<div class="tbody">` +
      `<div class="tcols"><div class="tcol"><h4>Ich gebe</h4>${grid('give', S.give, hand, true)}</div>` +
      `<div class="tarrow" aria-hidden="true"><svg viewBox="0 0 40 40" width="30" height="30"><path d="M6,14 H30 M23,7 l7,7 l-7,7 M34,26 H10 M17,19 l-7,7 l7,7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>` +
      `<div class="tcol"><h4>Ich möchte</h4>${grid('want', S.want, hand, false)}</div></div>` +
      `<div class="presets"><span class="muted">Schnell:</span><button type="button" class="chipbtn" data-preset="1:1">1 : 1</button><button type="button" class="chipbtn" data-preset="2:1">2 : 1</button><button type="button" class="chipbtn" data-preset="1:2">1 : 2</button><button type="button" class="chipbtn" data-do="clear">Leeren</button></div>` +
      `<div class="rates"><span class="muted" title="So viele gleiche Karten brauchst du für 1 Rohstoff deiner Wahl">Bankkurse</span>${rateChips}</div>` +
      (hint ? `<p class="thint">${C.esc(hint)}</p>` : '') +
      `<div class="tact"><button type="button" class="btn green${bank ? '' : ' dis'}" data-do="bank" ${bank ? '' : 'aria-disabled="true"'} title="${bank ? '' : 'Erst eine passende Menge wählen'}">` +
      (bank ? `Mit der Bank tauschen (${bank.rate}:1${bank.rate < 4 ? ' Hafen' : ''}${bank.times > 1 ? ', ' + bank.times + '×' : ''})` : 'Mit der Bank tauschen') + `</button>` +
      `<button type="button" class="btn gold${canOffer ? '' : ' dis'}" data-do="offer" ${canOffer ? '' : 'aria-disabled="true"'} title="${C.esc(offerWhy)}">Angebot an alle</button></div></div>`;
    return `<div class="tpanel glass composer${S.collapsed ? ' collapsed' : ''}">${head('Handeln', '<button type="button" class="ghost" data-do="close" title="Schließen">✕</button>')}${S.collapsed ? '' : body}</div>`;
  }

  function status(v, pid, r) {
    if (!r) return `<span class="st wait">wartet<i>.</i><i>.</i><i>.</i></span>`;
    if (r.s === 'accept') return `<span class="st ok">✓ angenommen</span>`;
    if (r.s === 'decline') return `<span class="st no">✗ abgelehnt</span>`;
    return `<span class="st cnt2">⇄ Gegenangebot</span>`;
  }

  // Anbieter-Sicht
  function offerOwner(v, t) {
    const hand = v.me.hand;
    const rows = v.order.filter((p) => p !== v.you).map((pid) => {
      const r = t.responses && t.responses[pid], p = v.players[pid];
      let detail = '', btn = '';
      if (r && r.s === 'counter') {
        detail = `<div class="cdet">Du gibst ${chips(r.give)} · du erhältst ${chips(r.want)}</div>`;
        const miss = missing(hand, r.give || {});
        btn = `<button type="button" class="btn green small${miss.length ? ' dis' : ''}" data-do="confirm" data-with="${pid}" ${miss.length ? 'aria-disabled="true"' : ''} title="${miss.length ? 'Dir fehlen: ' + C.esc(miss.join(', ')) : ''}">Handeln mit ${C.esc(p.name)}</button>`;
      } else if (r && r.s === 'accept') {
        const miss = missing(hand, t.give);
        btn = `<button type="button" class="btn green small${miss.length ? ' dis' : ''}" data-do="confirm" data-with="${pid}" ${miss.length ? 'aria-disabled="true"' : ''} title="${miss.length ? 'Dir fehlen: ' + C.esc(miss.join(', ')) : ''}">Handeln mit ${C.esc(p.name)}</button>`;
      }
      return `<li class="resp s-${r ? r.s : 'wait'}">${C.avatar(pid, 26)}<span class="nm">${C.esc(p.name)}</span>${status(v, pid, r)}${detail}${btn}</li>`;
    }).join('');
    const body = `<div class="tbody"><div class="offer-line">${C.avatar(v.you, 34)}<div class="ol"><span class="muted">Du gibst</span>${chips(t.give, true)}</div><span class="tarrow sm">⇄</span><div class="ol"><span class="muted">Du erhältst</span>${chips(t.want, true)}</div></div>` +
      `<ul class="resps">${rows}</ul><div class="tact"><button type="button" class="btn red" data-do="cancel">Zurückziehen</button></div></div>`;
    return `<div class="tpanel glass offer mine${S.collapsed ? ' collapsed' : ''}">${head('Dein Angebot')}${S.collapsed ? `<div class="tsum">${chips(t.give)} ⇄ ${chips(t.want)}</div>` : body}</div>`;
  }

  // Sicht der Mitspieler
  function offerOther(v, t) {
    const hand = v.me.hand, from = v.players[t.from], my = t.responses && t.responses[v.you];
    const miss = missing(hand, t.want);
    let main;
    if (S.counterOpen) {
      const okC = sum(S.cg) + sum(S.cw) > 0 && !missing(hand, S.cg).length;
      main = `<div class="tcols"><div class="tcol"><h4>Ich gebe</h4>${grid('cg', S.cg, hand, true)}</div><div class="tarrow" aria-hidden="true">⇄</div><div class="tcol"><h4>Ich bekomme</h4>${grid('cw', S.cw, hand, false)}</div></div>` +
        `<div class="tact"><button type="button" class="btn ghostb" data-do="counter-close">Zurück</button><button type="button" class="btn gold${okC ? '' : ' dis'}" data-do="counter-send" ${okC ? '' : 'aria-disabled="true"'}>Gegenangebot senden</button></div>`;
    } else {
      main = `<div class="offer-line"><div class="ol"><span class="muted">Du erhältst</span>${chips(t.give, true)}</div><span class="tarrow sm">⇄</span><div class="ol"><span class="muted">Du gibst</span>${chips(t.want, true)}</div></div>` +
        (my ? `<p class="thint mine-st">Deine Antwort: ${status(v, v.you, my)}${my.s === 'counter' ? ' ' + chips(my.want) + ' → ' + chips(my.give) : ''}</p>` : '') +
        `<div class="tact three"><button type="button" class="btn green${miss.length ? ' dis' : ''}" data-do="accept" ${miss.length ? 'aria-disabled="true"' : ''} title="${miss.length ? 'Dir fehlen: ' + C.esc(miss.join(', ')) : 'Angebot annehmen'}">Annehmen</button>` +
        `<button type="button" class="btn red" data-do="decline">Ablehnen</button><button type="button" class="btn ghostb" data-do="counter-open">Gegenangebot</button></div>` +
        (miss.length ? `<p class="thint warn">Zum Annehmen fehlen dir: ${C.esc(miss.join(', '))}</p>` : '');
    }
    return `<div class="tpanel glass offer incoming${S.collapsed ? ' collapsed' : ''}" style="--pc:${C.Art.COLORS[from.color]}">${head(`${C.esc(from.name)} bietet`)}` +
      (S.collapsed ? `<div class="tsum">${chips(t.give)} ⇄ ${chips(t.want)}</div>` : `<div class="tbody"><div class="who">${C.avatar(t.from, 38)}<span>${C.esc(from.name)} möchte handeln</span></div>${main}</div>`) + `</div>`;
  }

  function render() {
    const v = C.view();
    let html = '';
    if (v && (v.phase === 'main' || v.phase === 'setup')) {
      const t = v.trade;
      if (t) {
        if (t.id !== S.tradeId) { S.tradeId = t.id; S.counterOpen = false; S.collapsed = false; S.cg = clean(t.want); S.cw = clean(t.give); }
        html = t.from === v.you ? offerOwner(v, t) : offerOther(v, t);
      } else {
        S.tradeId = null; S.counterOpen = false;
        if (S.open && v.turn === v.you && (v.step === 'main' || v.step === 'sbp')) html = composer(v);
      }
    }
    if (html !== S.html) { S.html = html; C.root.innerHTML = html; C.root.classList.toggle('has', !!html); C.onChange && C.onChange(); }
  }

  // ---- Aenderungen ------------------------------------------------------------------------
  function adj(side, r, d) {
    const v = C.view(), hand = v.me.hand;
    const t = { give: S.give, want: S.want, cg: S.cg, cw: S.cw }[side];
    const lim = side === 'give' || side === 'cg' ? (hand[r] || 0) : 19;
    const n = Math.max(0, Math.min(lim, (t[r] || 0) + d));
    if (n === (t[r] || 0)) { if (d > 0 && lim === 0) C.toast(`Du hast kein ${rn(r)}.`, 'warn'); return; }
    if (n) t[r] = n; else delete t[r];
    render();
  }
  function preset(a, b) {
    const hand = C.view().me.hand;
    let g = RES.find((r) => S.give[r] > 0), w = RES.find((r) => S.want[r] > 0);
    if (!g) g = RES.slice().sort((x, y) => (hand[y] || 0) - (hand[x] || 0))[0];
    if (!w) w = RES.filter((r) => r !== g).sort((x, y) => (hand[x] || 0) - (hand[y] || 0))[0];
    if ((hand[g] || 0) < 1) { C.toast('Du hast keine Karten zum Abgeben.', 'warn'); return; }
    S.give = { [g]: Math.min(a, hand[g]) }; S.want = { [w]: b };
    render();
  }
  async function run(fn) { if (S.busy) return; S.busy = true; try { await fn(); } finally { S.busy = false; } }

  async function onDo(el) {
    const v = C.view(); const d = el.dataset.do;
    if (d !== 'collapse' && d !== 'close' && d !== 'clear' && d !== 'counter-open' && d !== 'counter-close' && el.getAttribute('aria-disabled') === 'true') { if (el.title) C.toast(el.title, 'warn'); return; }
    switch (d) {
      case 'collapse': S.collapsed = !S.collapsed; render(); break;
      case 'close': S.open = false; render(); break;
      case 'clear': S.give = {}; S.want = {}; render(); break;
      case 'counter-open': S.counterOpen = true; render(); break;
      case 'counter-close': S.counterOpen = false; render(); break;
      case 'bank': {
        const gs = RES.find((r) => S.give[r] > 0), ws = RES.find((r) => S.want[r] > 0);
        const times = S.want[ws];
        await run(async () => {
          for (let i = 0; i < times; i++) { const j = await C.act('bank_trade', { give: gs, get: ws }); if (j.error) return; }
          S.give = {}; S.want = {}; render();
        });
        break;
      }
      case 'offer': await run(async () => { const j = await C.act('trade_offer', { give: clean(S.give), want: clean(S.want) }); if (!j.error) { S.give = {}; S.want = {}; } }); break;
      case 'cancel': await run(() => C.act('trade_cancel')); break;
      case 'accept': await run(() => C.act('trade_respond', { accept: true })); break;
      case 'decline': await run(() => C.act('trade_respond', { accept: false })); break;
      case 'counter-send': await run(async () => { const j = await C.act('trade_respond', { counter: { give: clean(S.cw), want: clean(S.cg) } }); if (!j.error) { S.counterOpen = false; render(); } }); break;
      case 'confirm': await run(() => C.act('trade_confirm', { with: Number(el.dataset.with) })); break;
    }
    void v;
  }

  function wire(rootEl) {
    let lp = null, longDone = false, lastTouch = false;
    const stop = () => { if (lp) { clearTimeout(lp); lp = null; } };
    rootEl.addEventListener('pointerdown', (e) => {
      lastTouch = e.pointerType === 'touch'; longDone = false;
      const c = e.target.closest('.tc'); if (!c || e.target.closest('.minus') || e.button > 0) return;
      stop(); lp = setTimeout(() => { longDone = true; adj(c.dataset.side, c.dataset.res, -1); }, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => rootEl.addEventListener(n, stop));
    rootEl.addEventListener('contextmenu', (e) => {
      const c = e.target.closest('.tc'); if (!c) return;
      e.preventDefault(); if (!lastTouch) adj(c.dataset.side, c.dataset.res, -1);
    });
    rootEl.addEventListener('click', (e) => {
      const m = e.target.closest('.minus');
      if (m) { adj(m.dataset.side, m.dataset.res, -1); return; }
      const c = e.target.closest('.tc');
      if (c) { if (longDone) { longDone = false; return; } adj(c.dataset.side, c.dataset.res, +1); return; }
      const p = e.target.closest('[data-preset]');
      if (p) { const [a, b] = p.dataset.preset.split(':').map(Number); preset(a, b); return; }
      const rt = e.target.closest('[data-rate]');
      if (rt) {
        const v = C.view(), r = rt.dataset.rate, n = (v.rates && v.rates[r]) || 4;
        if ((v.me.hand[r] || 0) < n) { C.toast(`Für ${n}:1 brauchst du ${n}× ${rn(r)} – du hast ${v.me.hand[r] || 0}.`, 'warn'); return; }
        S.give = { [r]: n }; if (S.want[r]) delete S.want[r]; render(); return;
      }
      const d = e.target.closest('[data-do]'); if (d) onDo(d);
    });
  }

  root.Trade = {
    init(ctx) { C = ctx; wire(ctx.root); },
    render,
    isOpen: () => S.open,
    toggle() { S.open = !S.open; if (S.open) S.collapsed = false; render(); },
    openComposer() { S.open = true; S.collapsed = false; render(); },
  };
})(typeof self !== 'undefined' ? self : this);
