// menu.js – Spielmenue, Dialoge (Bestaetigung, Einstellungen, Sprachchat) und Statistik-Bildschirm nach Spielende.
// Kontext von app.js: {view(), act(), leave(), toast(), esc(), Art, avatar(pid,size), colorOf(pid), setHTML(el,html), help()}
(function (root) {
  'use strict';
  let C = null;
  const $ = (id) => document.getElementById(id);
  const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];

  // ======================================================================================
  // Dialoge (eigener Container #dlgRoot, unabhaengig von den Spiel-Modalen)
  // ======================================================================================
  let dlg = null; // {render:()=>html, onClose, resolve}
  function closeDlg(val) {
    const d = dlg; if (!d) return;
    dlg = null; $('dlgRoot').replaceChildren();
    if (d.back) d.back.focus && d.back.focus();
    if (d.resolve) d.resolve(val);
  }
  function openDlg(cls, render, resolve) {
    closeDlg(false);
    const back = document.activeElement;
    $('dlgRoot').innerHTML = `<div class="mback dlg" data-dlg="back"><div class="modal glass ${cls}" role="dialog" aria-modal="true"><div class="mbody"></div></div></div>`;
    dlg = { render, resolve, back }; refreshDlg(true);
    const f = $('dlgRoot').querySelector('[data-focus]') || $('dlgRoot').querySelector('button'); if (f) f.focus();
  }
  function refreshDlg(force) {
    if (!dlg) return;
    const body = $('dlgRoot').querySelector('.mbody'); if (!body) return;
    const a = document.activeElement;
    if (!force && a && a.matches && a.matches('input[type=range]') && body.contains(a)) return;
    C.setHTML(body, dlg.render());
    if (root.Voice) root.Voice.paintSpeaking();
  }
  function confirm(title, text, okLabel, danger) {
    return new Promise((resolve) => openDlg('m-confirm', () =>
      `<h2>${C.esc(title)}</h2><p class="lead">${C.esc(text)}</p><div class="mact"><button class="btn ghostb" data-d="no" ${danger ? 'data-focus' : ''}>Abbrechen</button><button class="btn ${danger ? 'red' : 'gold'}" data-d="yes" ${danger ? '' : 'data-focus'}>${C.esc(okLabel || 'OK')}</button></div>`, resolve));
  }
  $('dlgRoot').addEventListener('click', (e) => {
    if (e.target.dataset.dlg === 'back') { closeDlg(false); return; }
    const b = e.target.closest('[data-d]'); if (!b) return;
    closeDlg(b.dataset.d === 'yes');
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && dlg) { e.stopPropagation(); closeDlg(false); } else if (e.key === 'Escape') closeMenu(); }, true);

  function showSettings() {
    openDlg('m-info', () => {
      const v = C.view();
      return `<h2>Spieleinstellungen</h2><p class="lead small muted">${C.esc(v && v.gameName || '')} · nur Ansicht</p><div class="sumbox">${root.Lobby.summaryHTML(v && v.settings)}</div><div class="mact"><button class="btn gold" data-d="no" data-focus>Schließen</button></div>`;
    });
  }
  function showVoice() {
    openDlg('m-voice', () => {
      const v = C.view(); if (!v) return '';
      const rows = v.players.map((p, i) => i === v.you || !root.Voice.inVoice(i) ? '' :
        `<li data-pid="${i}" style="--pc:${C.colorOf(i)}">${C.avatar(i, 34)}<span class="nm">${C.esc(p.name)}</span>${root.Voice.badge(i)}<span class="grow"></span>${root.Voice.rowCtl(i)}</li>`).join('');
      return `<h2>Sprachchat</h2>${root.Voice.panel()}<ul class="vlist">${rows || '<li class="muted">Noch niemand sonst im Sprachchat.</li>'}</ul><div class="mact"><button class="btn gold" data-d="no" data-focus>Schließen</button></div>`;
    });
  }

  // ======================================================================================
  // Menue-Popover
  // ======================================================================================
  let pop = null;
  function closeMenu() { if (pop) { pop.remove(); pop = null; $('btnMenu').setAttribute('aria-expanded', 'false'); } }
  function openMenu() {
    closeMenu();
    const v = C.view(); if (!v) return;
    const host = v.host === v.you, running = v.phase === 'main' || v.phase === 'setup';
    const V = root.Voice, joined = V.isJoined();
    const item = (id, ic, label, cls) => `<button type="button" role="menuitem" class="mi ${cls || ''}" data-mi="${id}"><span class="mic">${ic}</span>${label}</button>`;
    const I = {
      info: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12,11 V17 M12,7.5 V8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
      help: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5,9.5 a2.6,2.6 0 1 1 3.6,2.4 c-.8,.4 -1.1,.9 -1.1,1.8 M12,17 V17.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
      sound: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4,9.5 H8 L13,5 V19 L8,14.5 H4z" fill="currentColor"/><path d="M16,9 a4,4 0 0 1 0,6 M18.5,6.5 a7.5,7.5 0 0 1 0,11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      fit: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4,9 V4 H9 M15,4 H20 V9 M20,15 V20 H15 M9,20 H4 V15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>',
      mic: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5,11 a6.5,6.5 0 0 0 13,0 M12,17.5 V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      exit: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M10,4 H5 V20 H10 M14,8 L19,12 L14,16 M19,12 H9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      flow: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7,5 L19,12 L7,19z" fill="currentColor"/></svg>',
      stop: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
    };
    pop = document.createElement('div'); pop.className = 'menu-pop glass'; pop.setAttribute('role', 'menu');
    pop.innerHTML = item('settings', I.info, 'Einstellungen ansehen') +
      item('voice', I.mic, joined ? 'Sprachchat verlassen' : 'Sprachchat beitreten') +
      (joined ? item('mute', I.mic, V.micOn() ? 'Mikrofon stummschalten' : 'Mikrofon einschalten') + item('voicepanel', I.mic, 'Sprachchat-Einstellungen …') : '') +
      (host && running ? item('flow', I.flow, 'Auto Ablauf: ' + (v.settings && v.settings.dice === 'auto' ? 'Auto → Manuell' : 'Manuell → Auto')) : '') +
      item('sound', I.sound, root.Sound.enabled() ? 'Töne ausschalten' : 'Töne einschalten') +
      item('fit', I.fit, 'Brett zentrieren') +
      item('help', I.help, 'Hilfe &amp; Spielregeln') + '<hr>' +
      (host && running ? item('end', I.stop, 'Spiel beenden', 'danger') : '') + item('leave', I.exit, 'Spiel verlassen', 'danger');
    document.body.appendChild(pop);
    const r = $('btnMenu').getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    $('btnMenu').setAttribute('aria-expanded', 'true');
    const f = pop.querySelector('button'); if (f) f.focus();
  }
  async function onMenuItem(id) {
    closeMenu();
    if (id === 'settings') showSettings();
    else if (id === 'voice') { root.Voice.isJoined() ? root.Voice.leave(false) : root.Voice.join(); }
    else if (id === 'mute') root.Voice.toggleMute();
    else if (id === 'voicepanel') showVoice();
    else if (id === 'help') C.help();
    else if (id === 'sound') root.Sound.toggle();
    else if (id === 'fit') C.fit();
    else if (id === 'flow') { const v = C.view(); await C.act('set_settings', { settings: { dice: v.settings.dice === 'auto' ? 'manuell' : 'auto' } }); }
    else if (id === 'end') { if (await confirm('Spiel beenden?', 'Das Spiel wird für alle sofort beendet. Alle sehen danach die Statistik.', 'Spiel beenden', true)) await C.act('end_game'); }
    else if (id === 'leave') leaveGame();
  }
  async function leaveGame() {
    const v = C.view(); const lobby = v && v.phase === 'lobby';
    const txt = lobby ? 'Du verlässt die Lobby.' : v && v.phase === 'ended' ? 'Du verlässt das Spiel.' : 'Ein Auto-Spieler übernimmt für dich. Du kannst nicht zurückkehren.';
    if (await confirm('Spiel verlassen?', txt, 'Verlassen', true)) C.leave();
  }
  function init(ctx) {
    C = ctx;
    $('btnMenu').addEventListener('click', (e) => { e.stopPropagation(); pop ? closeMenu() : openMenu(); });
    document.addEventListener('click', (e) => {
      if (!pop) return;
      const b = e.target.closest('[data-mi]'); if (b && pop.contains(b)) { onMenuItem(b.dataset.mi); return; }
      if (!pop.contains(e.target)) closeMenu();
    });
    $('stats').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      if (b.dataset.st === 'lobby') await C.act('new_game');
      else if (b.dataset.st === 'leave') leaveGame();
      else if (b.dataset.st === 'board') { $('stats').classList.add('peek'); }
    });
  }

  // ======================================================================================
  // Statistik
  // ======================================================================================
  const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} Std. ${m} Min.` : m ? `${m} Min. ${s % 60} Sek.` : `${s} Sek.`; };
  const SVGNS = 'http://www.w3.org/2000/svg';
  void SVGNS;

  function diceChart(rolls) {
    const W = 380, H = 230, ml = 30, mr = 8, mt = 16, mb = 30, pw = W - ml - mr, ph = H - mt - mb;
    const ks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], n = ks.reduce((a, k) => a + (rolls[k] || 0), 0);
    const exp = (k) => n * (6 - Math.abs(k - 7)) / 36;
    const maxV = Math.max(1, ...ks.map((k) => Math.max(rolls[k] || 0, exp(k)))), step = maxV <= 6 ? 1 : maxV <= 14 ? 2 : maxV <= 30 ? 5 : 10, top = Math.ceil(maxV / step) * step;
    const y = (v) => mt + ph - v / top * ph, bw = pw / ks.length, gap = 3;
    let g = '';
    for (let t = 0; t <= top; t += step) g += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${ml - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`;
    const maxK = ks.reduce((b, k) => ((rolls[k] || 0) > (rolls[b] || 0) ? k : b), 7);
    let bars = '', pts = [];
    ks.forEach((k, i) => {
      const v = rolls[k] || 0, x = ml + i * bw + gap / 2, w = bw - gap, h = v / top * ph, r = Math.min(4, w / 2, h);
      bars += `<g class="bar${k === 7 ? ' seven' : ''}"><title>${k}: ${v}× gewürfelt (Erwartung ${exp(k).toFixed(1)})</title>` +
        (v ? `<path d="M${x.toFixed(1)},${(mt + ph).toFixed(1)} V${(y(v) + r).toFixed(1)} a${r},${r} 0 0 1 ${r},-${r} H${(x + w - r).toFixed(1)} a${r},${r} 0 0 1 ${r},${r} V${(mt + ph).toFixed(1)} Z"/>` : '') +
        `<rect class="hit" x="${x.toFixed(1)}" y="${mt}" width="${w.toFixed(1)}" height="${ph}"/></g>` +
        `<text class="ax" x="${(x + w / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${k}</text>` +
        (k === maxK && v ? `<text class="val" x="${(x + w / 2).toFixed(1)}" y="${(y(v) - 5).toFixed(1)}" text-anchor="middle">${v}</text>` : '');
      pts.push(`${(x + w / 2).toFixed(1)},${y(exp(k)).toFixed(1)}`);
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Würfelverteilung: ${n} Würfe"><line class="axis" x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}"/>${g}${bars}` +
      `<polyline class="expl" points="${pts.join(' ')}"/>${pts.map((p) => `<circle class="expd" cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3"/>`).join('')}</svg>` +
      `<div class="legend"><span><i class="lg bar"></i>Gewürfelt (${n} Würfe)</span><span><i class="lg line"></i>Erwartung</span></div>`;
  }

  const MARK = [(x, y) => `<circle cx="${x}" cy="${y}" r="4.5"/>`, (x, y) => `<rect x="${x - 4}" y="${y - 4}" width="8" height="8"/>`, (x, y) => `<path d="M${x},${y - 5.5} L${x + 5},${y + 4} L${x - 5},${y + 4}Z"/>`,
    (x, y) => `<path d="M${x},${y - 5.5} L${x + 5.5},${y} L${x},${y + 5.5} L${x - 5.5},${y}Z"/>`, (x, y) => `<circle cx="${x}" cy="${y}" r="4.5" class="hollow"/>`, (x, y) => `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" class="hollow"/>`];
  function vpChart(st, v) {
    const hist = (st.history || []).filter((h) => h && Array.isArray(h.vp));
    if (hist.length < 1) return '<p class="muted">Kein Verlauf aufgezeichnet.</p>';
    const W = 560, H = 290, ml = 34, mr = 92, mt = 14, mb = 44, pw = W - ml - mr, ph = H - mt - mb;
    const rounds = hist.map((h) => h.round), r0 = Math.min(...rounds), r1 = Math.max(...rounds);
    const maxV = Math.max(v.winPoints || 10, ...hist.flatMap((h) => h.vp)), step = maxV <= 10 ? 2 : maxV <= 20 ? 4 : 5, top = Math.ceil(maxV / step) * step;
    const x = (r) => ml + (r1 === r0 ? pw / 2 : (r - r0) / (r1 - r0) * pw), y = (val) => mt + ph - val / top * ph;
    let g = '';
    for (let t = 0; t <= top; t += step) g += `<line class="grid" x1="${ml}" x2="${ml + pw}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${ml - 6}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}</text>`;
    const xs = Math.max(1, Math.ceil((r1 - r0 + 1) / 8));
    for (let r = r0; r <= r1; r += xs) g += `<text class="ax" x="${x(r).toFixed(1)}" y="${mt + ph + 17}" text-anchor="middle">${r}</text>`;
    g += `<text class="ax" x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle">Runde</text>`;
    g += `<line class="wl" x1="${ml}" x2="${ml + pw}" y1="${y(v.winPoints).toFixed(1)}" y2="${y(v.winPoints).toFixed(1)}"><title>Siegpunkte zum Sieg: ${v.winPoints}</title></line>`;
    let lines = '', labels = [];
    st.players.forEach((p, i) => {
      const col = C.Art.COLORS[p.color] || '#ccc';
      const pts = hist.map((h) => `${x(h.round).toFixed(1)},${y(h.vp[i] || 0).toFixed(1)}`);
      const last = hist[hist.length - 1], ly = y(last.vp[i] || 0);
      lines += `<g style="--c:${col}"><polyline class="vl" points="${pts.join(' ')}"/><g class="mk">${MARK[i % MARK.length](+x(last.round).toFixed(1), +ly.toFixed(1))}</g></g>`;
      labels.push({ y: ly, name: p.name, col, vp: last.vp[i] || 0 });
    });
    labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    const lab = labels.map((l) => `<text class="dl" x="${ml + pw + 9}" y="${(l.y + 4).toFixed(1)}" style="fill:${l.col}"><tspan class="dn">${C.esc(l.name.length > 9 ? l.name.slice(0, 8) + '…' : l.name)}</tspan> <tspan class="dv">${l.vp}</tspan></text>`).join('');
    // Hover-Spalten mit nativem Tooltip
    const cw = hist.length > 1 ? pw / (hist.length - 1) : pw;
    const cols = hist.map((h) => `<rect class="hov" x="${(x(h.round) - cw / 2).toFixed(1)}" y="${mt}" width="${cw.toFixed(1)}" height="${ph}"><title>Runde ${h.round}\n${st.players.map((p, i) => `${p.name}: ${h.vp[i] || 0}`).join('\n')}</title></rect>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Siegpunkt-Verlauf pro Runde"><line class="axis" x1="${ml}" x2="${ml + pw}" y1="${mt + ph}" y2="${mt + ph}"/>${g}${cols}${lines}${lab}</svg>` +
      `<div class="legend">${st.players.map((p, i) => `<span><i class="lg mkr" style="--c:${C.Art.COLORS[p.color] || '#ccc'}"><svg viewBox="-8 -8 16 16" width="14" height="14">${MARK[i % MARK.length](0, 0)}</svg></i>${C.esc(p.name)}</span>`).join('')}<span><i class="lg wline"></i>Siegpunkt-Ziel</span></div>`;
  }

  function table(st) {
    const A = C.Art, P = st.players;
    const row = (label, get, opt) => {
      const vals = P.map(get), max = Math.max(...vals.map(Number));
      return `<tr><th scope="row">${opt && opt.icon || ''}${label}</th>${vals.map((x) => `<td class="${max > 0 && Number(x) === max ? 'best' : ''}">${x}</td>`).join('')}</tr>`;
    };
    const sec = (t) => `<tr class="sec"><th colspan="${P.length + 1}">${t}</th></tr>`;
    const b = (k) => (p) => (p.built || {})[k] || 0, pr = (k) => (p) => (p.produced || {})[k] || 0;
    return `<div class="tablewrap"><table class="stt"><thead><tr><th></th>${P.map((p) => `<th scope="col" style="--pc:${A.COLORS[p.color] || '#888'}"><span class="av" style="--pc:${A.COLORS[p.color] || '#888'};--sz:30px" aria-hidden="true">${C.esc((Array.from(p.name || '?')[0] || '?').toUpperCase())}</span><span class="tn">${C.esc(p.name)}</span></th>`).join('')}</tr></thead><tbody>` +
      sec('Gebaut') + row('Straßen', b('road')) + row('Schiffe', b('ship')) + row('Siedlungen', b('settlement')) + row('Städte', b('city')) + row('Entwicklungskarten', b('dev')) +
      sec('Erträge (Rohstoffe)') + RES.map((r) => row(A.RES_NAMES[r], pr(r), { icon: A.res(r, 18) })).join('') + row('Gesamt', pr('total')) +
      sec('Handel') + row('Mit Spielern', (p) => p.tradesPlayer || 0) + row('Mit der Bank', (p) => p.tradesBank || 0) +
      sec('Räuber &amp; Diebstahl') + row('Gestohlen (bei anderen)', (p) => p.stolenBy || 0) + row('Bestohlen worden', (p) => p.stolenFrom || 0) + row('Räuber versetzt', (p) => p.robberMoves || 0) + row('Siebener gewürfelt', (p) => p.sevens || 0) + row('Karten abgeworfen', (p) => p.discarded || 0) +
      sec('Sonstiges') + row('Ritter gespielt', (p) => p.knights || 0) + row('Längste Route', (p) => p.maxRoute || 0) + row('Entdeckte Felder', (p) => p.discovered || 0) +
      '</tbody></table></div>';
  }

  function renderStats(v) {
    const el = $('stats'), st = v.stats;
    el.hidden = false;
    const P = st.players.slice().sort((a, b) => (b.vp || 0) - (a.vp || 0));
    const aborted = !!st.aborted || v.winner == null;
    const w = v.winner != null ? v.players[v.winner] : null;
    const host = v.host === v.you;
    const title = aborted ? 'Spiel beendet' : `${C.esc(w ? w.name : '')} gewinnt!`;
    const sub = aborted ? (v.endedBy === 'host' || st.aborted ? 'Der Spielleiter hat das Spiel vorzeitig beendet.' : 'Das Spiel wurde abgebrochen.') : 'Glückwunsch zum Sieg!';
    const html = `<div class="stwrap"><header class="sthead glass"><div class="trophy" aria-hidden="true"><svg viewBox="0 0 64 64" width="64" height="64"><defs><linearGradient id="tg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset=".5" stop-color="#f5c542"/><stop offset="1" stop-color="#a8740c"/></linearGradient></defs><path d="M18,8 H46 V24 Q46,38 32,40 Q18,38 18,24Z" fill="url(#tg2)" stroke="#6b4a08" stroke-width="2"/><path d="M18,12 H8 Q8,28 20,30 M46,12 H56 Q56,28 44,30" fill="none" stroke="#e0aa2a" stroke-width="3.4"/><path d="M32,40 V50 M22,56 H42 M24,50 H40 V56 H24Z" stroke="#6b4a08" stroke-width="2" fill="#c8901a"/></svg></div>` +
      `<div><h2 class="${aborted ? '' : 'win'}">${title}</h2><p class="muted">${sub}</p><p class="meta"><span>Dauer: <b>${fmtDur(st.durationSec)}</b></span><span>Runden: <b>${st.turns != null ? st.turns : '–'}</b></span><span>Siegpunkte zum Sieg: <b>${v.winPoints}</b></span></p></div></header>` +
      `<div class="stgrid"><section class="glass stcard"><h3>Rangliste</h3><ol class="rank">${P.map((p, i) => `<li class="${!aborted && v.winner === p.id ? 'first' : ''}" style="--pc:${C.Art.COLORS[p.color] || '#888'}"><span class="pos">${i + 1}.</span>${C.avatar(p.id, 30)}<span class="nm">${C.esc(p.name)}</span><b>${p.vp} ★</b>${p.svp ? `<small class="muted">${p.svp} Sonder</small>` : ''}</li>`).join('')}</ol></section>` +
      `<section class="glass stcard"><h3>Würfelverteilung</h3>${diceChart(st.rolls || {})}</section>` +
      `<section class="glass stcard wide2"><h3>Siegpunkte pro Runde</h3>${vpChart(st, v)}</section>` +
      `<section class="glass stcard wide2"><h3>Spieler im Vergleich</h3>${table(st)}</section></div>` +
      `<footer class="stfoot glass">${host ? '<button class="btn gold big" data-st="lobby" title="Alle kehren in die Lobby zurück, die Einstellungen bleiben.">Zurück zur Lobby</button>' : '<p class="waiting"><span class="spin"></span>Warte auf den Spielleiter …</p>'}<button class="btn ghostb" data-st="leave">Spiel verlassen</button></footer></div>`;
    if (el._h !== html) { const sc = el.scrollTop; C.setHTML(el, html); el.scrollTop = sc; }
  }
  function hideStats() { const el = $('stats'); if (!el.hidden) { el.hidden = true; el._h = null; el.replaceChildren(); } }

  root.Menu = { init, confirm, refresh: () => refreshDlg(false), renderStats, hideStats, closeMenu, showSettings, isDialogOpen: () => !!dlg };
})(typeof self !== 'undefined' ? self : this);
