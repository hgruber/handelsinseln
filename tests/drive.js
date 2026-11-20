'use strict';
// Treibt Spieler eines laufenden Servers per Testspieler-Logik an (für Browser-Tests).
// Aufruf: node tests/drive.js <basis-url> <ms-pro-aktion> <token> [<token> …]  (Tokens der zu steuernden Spieler)
const { botAct } = require('../server/bot');
const [base, delay, ...tokens] = process.argv.slice(2);
const views = {};
const rnd = Math.random;
let errors = 0;
tokens.forEach((t, i) => {
  (async () => {
    for (;;) {
      try {
        const res = await fetch(base + '/api/events?token=' + t);
        if (res.status === 401) { console.log('Token ungültig', i); return; }
        const dec = new TextDecoder(); let buf = '';
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let k; while ((k = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, k); buf = buf.slice(k + 2); if (b.includes('event: state')) views[t] = JSON.parse(b.split('data: ')[1]); }
        }
      } catch (e) { /* neu verbinden */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
});
let busy = false;
setInterval(() => {
  if (busy) return; busy = true;
  for (const t of tokens) {
    const v = views[t];
    if (!v || v.phase === 'lobby' || v.phase === 'ended') continue;
    const game = { S: { phase: v.phase }, rnd, view: () => v, act: (pid, a) => { fetch(base + '/api/act', { method: 'POST', body: JSON.stringify({ token: t, ...a }) }).then((r) => r.json()).then((j) => { if (j.error && ++errors < 15) console.log('abgelehnt:', a.type, j.error); }); } };
    try { botAct(game, v.you, { rnd }); } catch (e) { /* veraltete Sicht */ }
  }
  busy = false;
}, +delay || 150);
