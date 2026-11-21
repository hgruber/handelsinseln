// sound.js – dezente Töne (WebAudio, synthetisiert, keine Dateien): Chat, eigener Zug, Würfel, Bauen, Handelsangebot, Beitritt, Spielende.
// Sound.onView(alt, neu) vergleicht zwei Ansichten und spielt, was neu ist. Die erste Ansicht (Neuladen) bleibt stumm.
// Aus/an: Spielmenü („Töne“), gemerkt in localStorage 'handelsinseln.sound'.
(function (root) {
  'use strict';
  let ctx = null, master = null, on = localStorage.getItem('handelsinseln.sound') !== '0', lastAt = {};
  const GAIN = 0.5;

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain(); master.gain.value = GAIN; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Browser erlauben Ton erst nach einer Geste: beim ersten Tippen/Klicken/Taste den Kontext anlegen
  const unlock = () => { ensure(); };
  ['pointerdown', 'keydown', 'touchend'].forEach((e) => addEventListener(e, unlock, { passive: true }));

  // Ein Ton: Sinus/Dreieck mit weichem Ein- und Ausklang
  function tone(t0, f, dur, vol, type, f2) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // Rauschstoß (gefiltert): Würfelklappern, Holzklopfen
  function noise(t0, dur, vol, freq, q) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1.2; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master); s.start(t0);
  }

  const SOUNDS = {
    chat(t) { tone(t, 659, 0.16, 0.16); tone(t + 0.11, 880, 0.24, 0.16); },                     // zwei weiche Töne aufwärts
    turn(t) { [523, 659, 784].forEach((f, i) => tone(t + i * 0.11, f, 0.34, 0.15, 'triangle')); }, // kleiner Dur-Akkord: du bist dran
    dice(t) { for (let i = 0; i < 6; i++) noise(t + i * 0.07 + Math.random() * 0.03, 0.05, 0.5, 1800 + Math.random() * 1800, 2); },
    build(t) { noise(t, 0.07, 0.7, 500, 1.5); tone(t, 180, 0.12, 0.2, 'triangle', 90); },       // Holzklopfen
    offer(t) { tone(t, 784, 0.3, 0.14); tone(t + 0.16, 587, 0.4, 0.14); },                       // Türglocke: Handelsangebot
    join(t) { tone(t, 440, 0.12, 0.12); tone(t + 0.08, 587, 0.18, 0.12); },
    steal(t) { tone(t, 330, 0.22, 0.14, 'triangle', 200); },
    win(t) { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.13, f, 0.5, 0.15, 'triangle')); },
    end(t) { tone(t, 392, 0.4, 0.13, 'triangle'); tone(t + 0.18, 294, 0.6, 0.13, 'triangle'); },
  };

  function play(name) {
    if (!on || !SOUNDS[name]) return;
    const now = Date.now(); if (now - (lastAt[name] || 0) < 150) return; lastAt[name] = now; // nie doppelt in einem Atemzug
    if (!ensure() || ctx.state !== 'running') return; // noch keine Geste: stumm bleiben statt später nachzuholen
    SOUNDS[name](ctx.currentTime + 0.01);
  }

  // Vergleich zweier Ansichten (Server-Zustand). Kein Ton bei der ersten Ansicht, beim Moduswechsel oder bei einem neuen Spiel.
  function onView(old, v) {
    if (!old || !v || old.phase === 'lobby' && v.phase !== 'lobby') return;
    const me = v.you;
    if (v.phase === 'lobby') {
      if (old.phase === 'lobby' && v.players.length > old.players.length) play('join');
    } else if (v.phase === 'ended' && old.phase !== 'ended') { play(v.winner === me ? 'win' : 'end'); return; }
    const maxId = (a) => (a || []).reduce((m, x) => Math.max(m, x.id || 0), 0);
    const oc = maxId(old.chat), oldLog = maxId(old.log);
    if ((v.chat || []).some((c) => (c.id || 0) > oc && c.p !== me)) play('chat');
    if (v.phase === 'lobby') return;
    if (v.diceSeq !== old.diceSeq && v.diceSeq) play('dice');
    const fresh = (v.log || []).filter((l) => l.id > oldLog);
    if (fresh.some((l) => l.kind === 'build')) play('build');
    if (fresh.some((l) => l.kind === 'steal')) play('steal');
    if (v.trade && (!old.trade || old.trade.id !== v.trade.id) && v.trade.from !== me) play('offer');
    if (v.turn === me && (old.turn !== me || old.phase !== v.phase) && v.phase !== 'ended') setTimeout(() => play('turn'), v.diceSeq !== old.diceSeq ? 900 : 0);
  }

  root.Sound = { play, onView, enabled: () => on, toggle() { on = !on; localStorage.setItem('handelsinseln.sound', on ? '1' : '0'); if (on) { ensure(); setTimeout(() => play('chat'), 60); } return on; } };
})(typeof self !== 'undefined' ? self : this);
