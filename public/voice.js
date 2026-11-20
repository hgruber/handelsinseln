// voice.js – Sprachchat per WebRTC (Mesh, nur Audio). Signalisierung ueber POST /api/signal und SSE-Event "signal".
// Ablauf: Beitritt => {t:'hello'} an 'all'; wer aktiv ist, antwortet {t:'hello',re:true}; der mit der kleineren pid sendet das Offer.
// Alles hier ist eigenstaendig: Klicks auf [data-v] / Regler [data-vv] werden per Delegation selbst behandelt.
(function (root) {
  'use strict';
  let C = null; // {token(), view(), post(), toast(), esc(), onChange()}
  const S = {
    joined: false, joining: false, stream: null, track: null, muted: false, ptt: false, pttDown: false,
    peers: new Map(),            // pid -> {pc, audio, src, analyser, buf, conn, vol, muted, queue:[], remoteSet}
    members: new Set(),          // pids, die im Sprachchat sind (nach hello)
    prefs: new Map(),            // pid -> {vol, muted} (bleibt ueber Neuverbindung erhalten)
    speaking: new Set(), ctx: null, own: null, ice: [], timer: 0, err: '',
  };
  const myPid = () => { const v = C.view(); return v ? v.you : -1; };
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext && window.RTCPeerConnection);
  const notify = () => { if (C && C.onChange) C.onChange(); };

  // ---- Signalisierung -----------------------------------------------------------------
  async function send(to, data) {
    if (!C.token()) return;
    const j = await C.post('/api/signal', { token: C.token(), to, data });
    if (j && j.error && !/Rate|zu schnell/i.test(j.error)) console.warn('signal:', j.error);
  }

  // ---- Analyser ("spricht gerade") ----------------------------------------------------------
  function makeAnalyser(stream) {
    if (!S.ctx) return null;
    try {
      const src = S.ctx.createMediaStreamSource(stream), an = S.ctx.createAnalyser();
      an.fftSize = 512; src.connect(an);
      return { src, an, buf: new Uint8Array(an.fftSize), on: false };
    } catch (_) { return null; }
  }
  function level(a) {
    a.an.getByteTimeDomainData(a.buf);
    let s = 0; for (let i = 0; i < a.buf.length; i++) { const x = (a.buf[i] - 128) / 128; s += x * x; }
    return Math.sqrt(s / a.buf.length);
  }
  function tick() {
    const next = new Set();
    const chk = (pid, a, gate) => {
      if (!a) return;
      const l = gate ? level(a) : 0;
      a.on = l > (a.on ? 0.012 : 0.03); // Hysterese
      if (a.on) next.add(pid);
    };
    chk(myPid(), S.own, S.joined && S.track && S.track.enabled);
    for (const [pid, p] of S.peers) chk(pid, p.analyser, !(S.prefs.get(pid) || {}).muted);
    const same = next.size === S.speaking.size && [...next].every((x) => S.speaking.has(x));
    if (!same) { S.speaking = next; paintSpeaking(); }
  }
  // Nur Klassen umschalten (kein neues HTML => kein Flackern)
  function paintSpeaking() {
    document.querySelectorAll('[data-pid]').forEach((el) => el.classList.toggle('speaking', S.speaking.has(Number(el.dataset.pid))));
  }

  // ---- Peers ------------------------------------------------------------------------------------
  function closePeer(pid) {
    const p = S.peers.get(pid); if (!p) return;
    try { p.pc.close(); } catch (_) { /* egal */ }
    if (p.analyser) { try { p.analyser.src.disconnect(); } catch (_) { /* egal */ } }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    S.peers.delete(pid); S.speaking.delete(pid);
  }
  function makePeer(pid) {
    closePeer(pid);
    const pc = new RTCPeerConnection({ iceServers: S.ice });
    const pref = S.prefs.get(pid) || { vol: 1, muted: false };
    const p = { pc, audio: null, analyser: null, conn: 'new', queue: [], remote: false };
    S.peers.set(pid, p);
    if (S.stream) S.stream.getTracks().forEach((t) => pc.addTrack(t, S.stream));
    pc.onicecandidate = (e) => { if (e.candidate) send(pid, { t: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (!p.audio) {
        const a = document.createElement('audio'); a.autoplay = true; a.playsInline = true;
        a.volume = pref.vol; a.muted = !!pref.muted; document.getElementById('voiceAudio').appendChild(a); p.audio = a;
      }
      p.audio.srcObject = stream;
      const pl = p.audio.play(); if (pl && pl.catch) pl.catch(() => C.toast('Klicke einmal ins Fenster, damit der Ton starten darf.', 'info'));
      if (!p.analyser) p.analyser = makeAnalyser(stream);
    };
    pc.onconnectionstatechange = () => {
      p.conn = pc.connectionState; notify();
      if (pc.connectionState === 'failed' && S.peers.get(pid) === p) { closePeer(pid); if (S.joined && S.members.has(pid)) send(pid, { t: 'hello' }); }
    };
    return p;
  }
  async function offerTo(pid) {
    const p = makePeer(pid);
    try {
      await p.pc.setLocalDescription(await p.pc.createOffer());
      send(pid, { t: 'offer', sdp: p.pc.localDescription.sdp });
    } catch (e) { console.warn(e); }
  }
  async function flushQueue(p) {
    p.remote = true;
    for (const c of p.queue.splice(0)) { try { await p.pc.addIceCandidate(c); } catch (_) { /* egal */ } }
  }

  async function onSignal(msg) {
    if (!S.joined || !msg || !msg.data || typeof msg.data !== 'object') return;
    const from = Number(msg.from), d = msg.data;
    if (!Number.isInteger(from) || from === myPid()) return;
    switch (d.t) {
      case 'hello':
        S.members.add(from);
        if (!d.re) send(from, { t: 'hello', re: true });
        if (myPid() < from) offerTo(from);
        else if (S.peers.has(from) && !d.re) closePeer(from); // Gegenseite kommt neu: alte Verbindung verwerfen, Offer folgt
        notify(); break;
      case 'bye': S.members.delete(from); closePeer(from); notify(); break;
      case 'offer': {
        if (typeof d.sdp !== 'string') return;
        S.members.add(from);
        const p = makePeer(from);
        try {
          await p.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp }); await flushQueue(p);
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          send(from, { t: 'answer', sdp: p.pc.localDescription.sdp });
        } catch (e) { console.warn(e); }
        notify(); break;
      }
      case 'answer': {
        const p = S.peers.get(from); if (!p || typeof d.sdp !== 'string') return;
        try { await p.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }); await flushQueue(p); } catch (e) { console.warn(e); }
        break;
      }
      case 'ice': {
        const p = S.peers.get(from); if (!p || !d.c) return;
        if (!p.remote) p.queue.push(d.c); else { try { await p.pc.addIceCandidate(d.c); } catch (_) { /* egal */ } }
        break;
      }
    }
  }

  // ---- Beitreten / Verlassen ---------------------------------------------------------------------------
  async function join() {
    if (S.joined || S.joining) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
      S.err = 'Das Mikrofon funktioniert nur über https oder auf localhost. Öffne das Spiel über eine gesicherte Adresse, um den Sprachchat zu nutzen.';
      C.toast(S.err, 'warn'); notify(); return;
    }
    if (!window.RTCPeerConnection) { S.err = 'Dein Browser unterstützt keinen Sprachchat (WebRTC fehlt).'; C.toast(S.err, 'warn'); notify(); return; }
    S.joining = true; S.err = ''; notify();
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) {
      S.joining = false;
      S.err = e && e.name === 'NotAllowedError' ? 'Der Zugriff auf das Mikrofon wurde verweigert. Erlaube ihn in der Adressleiste und versuche es erneut.'
        : e && e.name === 'NotFoundError' ? 'Es wurde kein Mikrofon gefunden.' : 'Das Mikrofon konnte nicht gestartet werden.';
      C.toast(S.err, 'warn'); notify(); return;
    }
    try { const r = await fetch('/api/config'); const j = await r.json(); S.ice = j && j.stun ? [{ urls: j.stun }] : []; } catch (_) { S.ice = []; }
    S.track = S.stream.getAudioTracks()[0];
    try { S.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (S.ctx.state === 'suspended') S.ctx.resume(); } catch (_) { S.ctx = null; }
    S.own = makeAnalyser(S.stream);
    S.joined = true; S.joining = false; S.pttDown = false;
    applyMute();
    clearInterval(S.timer); S.timer = setInterval(tick, 120);
    send('all', { t: 'hello' });
    C.toast('Sprachchat beigetreten. Bei Echo bitte Kopfhörer nutzen oder stummschalten.', 'info');
    notify();
  }
  function leave(silent) {
    if (!S.joined && !S.stream) return;
    if (S.joined && !silent) send('all', { t: 'bye' });
    else if (S.joined && silent && C.token()) { try { fetch('/api/signal', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: C.token(), to: 'all', data: { t: 'bye' } }) }); } catch (_) { /* egal */ } }
    for (const pid of [...S.peers.keys()]) closePeer(pid);
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    if (S.own) { try { S.own.src.disconnect(); } catch (_) { /* egal */ } }
    if (S.ctx) { try { S.ctx.close(); } catch (_) { /* egal */ } }
    clearInterval(S.timer);
    Object.assign(S, { joined: false, joining: false, stream: null, track: null, ctx: null, own: null, pttDown: false });
    S.members.clear(); S.speaking = new Set(); paintSpeaking(); notify();
  }
  function applyMute() {
    if (S.track) S.track.enabled = S.ptt ? S.pttDown : !S.muted;
    notify();
  }
  const micOn = () => S.joined && !!S.track && S.track.enabled;
  function toggleMute() {
    if (!S.joined) { join(); return; }
    S.muted = !S.muted; applyMute();
  }

  // ---- Oberflaeche ---------------------------------------------------------------------------------
  const ICON = {
    on: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5,11 a6.5,6.5 0 0 0 13,0 M12,17.5 V21 M8.5,21 H15.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    off: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" opacity=".55"/><path d="M5.5,11 a6.5,6.5 0 0 0 13,0 M12,17.5 V21 M8.5,21 H15.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".55"/><path d="M3.5,3.5 L20.5,20.5" stroke="#ff8f84" stroke-width="2.6" stroke-linecap="round"/></svg>',
  };
  // Immer sichtbarer Stummschalter im Spiel-HUD
  function hudMic() {
    const t = !S.joined ? 'Sprachchat beitreten (Mikrofon einschalten)' : micOn() ? 'Mikrofon ist AN – klicken zum Stummschalten' : S.ptt ? 'Push-to-talk: Leertaste gedrückt halten' : 'Mikrofon ist AUS – klicken zum Einschalten';
    return `<button class="ibtn mic ${!S.joined ? 'idle' : micOn() ? 'live' : 'muted'}${S.speaking.has(myPid()) ? ' speaking' : ''}" data-v="mic" data-pid="${myPid()}" title="${t}" aria-label="${t}" aria-pressed="${micOn()}">${micOn() ? ICON.on : ICON.off}</button>`;
  }
  function rowCtl(pid) {
    const pr = S.prefs.get(pid) || { vol: 1, muted: false };
    return `<span class="vrow" title="Lautstärke dieses Mitspielers"><button type="button" class="vmini${pr.muted ? ' off' : ''}" data-vm="${pid}" aria-label="Mitspieler stummschalten" aria-pressed="${!!pr.muted}">${pr.muted ? ICON.off : ICON.on}</button>` +
      `<input type="range" min="0" max="1" step="0.05" value="${pr.vol}" data-vv="${pid}" aria-label="Lautstärke"></span>`;
  }
  // Kleine Markierung an Spielerkarte/Lobbyliste
  function badge(pid) {
    if (pid === myPid()) return S.joined ? `<span class="vbadge${micOn() ? '' : ' off'}" title="${micOn() ? 'Dein Mikrofon ist an' : 'Dein Mikrofon ist aus'}">${micOn() ? ICON.on : ICON.off}</span>` : '';
    if (!S.joined || !S.members.has(pid)) return '';
    const pr = S.prefs.get(pid) || {}, p = S.peers.get(pid);
    return `<span class="vbadge${pr.muted ? ' off' : ''}${p && p.conn === 'connected' ? '' : ' wait'}" title="${pr.muted ? 'Von dir stummgeschaltet' : p && p.conn === 'connected' ? 'Im Sprachchat' : 'Verbindet…'}">${pr.muted ? ICON.off : ICON.on}</span>`;
  }
  function panel() {
    if (!window.isSecureContext || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      return `<div class="vpanel"><div class="vhead"><b>Sprachchat</b></div><p class="vwarn">Das Mikrofon braucht <b>https</b> oder <b>localhost</b>. Über diese Adresse ist der Sprachchat nicht verfügbar.</p></div>`;
    }
    if (!S.joined) {
      return `<div class="vpanel"><div class="vhead"><b>Sprachchat</b><button type="button" class="btn small green" data-v="join"${S.joining ? ' aria-disabled="true"' : ''}>${S.joining ? 'Verbinde…' : 'Sprachchat beitreten'}</button></div>` +
        (S.err ? `<p class="vwarn">${C.esc(S.err)}</p>` : '<p class="vnote">Mit Mikrofon direkt miteinander sprechen. Bei Echo bitte Kopfhörer nutzen oder stummschalten.</p>') + '</div>';
    }
    return `<div class="vpanel on"><div class="vhead"><b>Sprachchat</b><button type="button" class="btn small ${micOn() ? '' : 'red'}" data-v="mute" aria-pressed="${!micOn()}">${micOn() ? 'Stummschalten' : 'Stumm – einschalten'}</button><button type="button" class="btn small ghostb" data-v="leave">Verlassen</button></div>` +
      `<label class="vptt" title="Mikrofon nur senden, solange die Leertaste gedrückt ist"><input type="checkbox" data-v="ptt" ${S.ptt ? 'checked' : ''}> Push-to-talk (Leertaste halten)</label>` +
      `<p class="vnote">Bei Echo bitte Kopfhörer nutzen oder stummschalten.</p></div>`;
  }

  // ---- Ereignisse -------------------------------------------------------------------------------------
  function wire() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (b && b.type !== 'checkbox') {
        if (b.getAttribute('aria-disabled') === 'true') return;
        const a = b.dataset.v;
        if (a === 'join') join(); else if (a === 'leave') leave(false); else if (a === 'mute' || a === 'mic') toggleMute();
        return;
      }
      const m = e.target.closest('[data-vm]');
      if (m) { const pid = Number(m.dataset.vm), pr = S.prefs.get(pid) || { vol: 1, muted: false }; pr.muted = !pr.muted; S.prefs.set(pid, pr); const p = S.peers.get(pid); if (p && p.audio) p.audio.muted = pr.muted; notify(); }
    });
    document.addEventListener('change', (e) => {
      const c = e.target.closest('input[data-v="ptt"]'); if (!c) return;
      S.ptt = c.checked; S.pttDown = false; applyMute();
    });
    document.addEventListener('input', (e) => {
      const r = e.target.closest('input[data-vv]'); if (!r) return;
      const pid = Number(r.dataset.vv), pr = S.prefs.get(pid) || { vol: 1, muted: false };
      pr.vol = Math.max(0, Math.min(1, Number(r.value))); S.prefs.set(pid, pr);
      const p = S.peers.get(pid); if (p && p.audio) p.audio.volume = pr.vol;
    });
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) && e.target.type !== 'checkbox' && e.target.type !== 'range';
    document.addEventListener('keydown', (e) => {
      if (!S.joined || !S.ptt || e.code !== 'Space' || e.repeat || typing(e)) return;
      e.preventDefault(); S.pttDown = true; applyMute();
    });
    document.addEventListener('keyup', (e) => { if (S.joined && S.ptt && e.code === 'Space' && S.pttDown) { S.pttDown = false; applyMute(); } });
    addEventListener('blur', () => { if (S.joined && S.ptt && S.pttDown) { S.pttDown = false; applyMute(); } });
    addEventListener('pagehide', () => leave(true));
  }

  root.Voice = {
    init(ctx) { C = ctx; wire(); },
    onSignal, join, leave, toggleMute, panel, hudMic, badge, rowCtl, paintSpeaking,
    isJoined: () => S.joined, isSupported: supported, micOn,
    inVoice: (pid) => S.joined && (pid === myPid() || S.members.has(pid)),
    // Testhilfe
    debug: () => ({ joined: S.joined, members: [...S.members], peers: Object.fromEntries([...S.peers].map(([k, p]) => [k, p.pc.connectionState])) }),
  };
})(typeof self !== 'undefined' ? self : this);
