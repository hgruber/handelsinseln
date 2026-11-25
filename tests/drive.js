'use strict';
// Treibt Spieler eines laufenden Servers über die API an (für Browser-Tests).
// Aufruf: node tests/drive.js <basis-url> <ms-pro-aktion> <token> [<token> …]
// Die Aktionen werden aus der jeweils aktuellen Sicht gewählt (keine Server-Interna).
const [base, delayArg, ...tokens] = process.argv.slice(2);
const delay = +delayArg || 120;
const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
const views = new Map(); // token -> Sicht
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(token) {
  (async () => {
    for (;;) {
      try {
        const res = await fetch(base + '/api/events?token=' + encodeURIComponent(token));
        if (res.status === 401) { views.delete(token); console.log('Token ungültig'); return; }
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = (block.match(/^event: (\w+)/m) || [])[1];
            const data = (block.match(/^data: (.*)$/m) || [])[1];
            if (ev === 'state' && data) {
              try { views.set(token, JSON.parse(data)); } catch (e) { /* egal */ }
            }
          }
        }
      } catch (e) { /* neu verbinden */ }
      await sleep(300);
    }
  })();
}

const half = (hand, need) => {
  const out = {}; let left = need;
  for (const r of RES) { const t = Math.min(hand[r] || 0, left); if (t) { out[r] = t; left -= t; } if (!left) break; }
  return out;
};
const anyCards = (view, need) => {
  const out = {}; let left = need;
  for (const r of RES) { const st = view.bank.stock[r]; const t = Math.min(st === 999 ? left : st, left); if (t) { out[r] = t; left -= t; } if (!left) break; }
  return out;
};

function actionFor(pid, v) {
  const L = v.legal;
  if (v.pending.discard[pid]) return { type: 'discard', cards: half(v.me.hand, v.pending.discard[pid]) };
  if (v.pending.gold[pid]) return { type: 'gold_pick', cards: anyCards(v, v.pending.gold[pid]) };
  switch (v.step) {
    case 'setup_seat': {
      const seat = ['bl', 'b', 'br', 'tl', 't', 'tr', 'l', 'r'].find((s) => !v.players.some((p) => p.seat === s));
      return { type: 'place_seat', seat };
    }
    case 'setup_order': return { type: 'roll' };
    case 'setup_settlement': return L.settlement.length ? { type: 'place_settlement', v: L.settlement[0] } : null;
    case 'setup_road': return L.road.length ? { type: 'place_road', e: L.road[0] } : L.ship.length ? { type: 'place_ship', e: L.ship[0] } : null;
    case 'roll': return { type: 'roll' };
    case 'robber': {
      if (L.robber.length) {
        const mine = (h) => Object.keys(v.verts).some((k) => v.verts[k].p === pid && k.split('|').includes(h));
        const good = L.robber.filter((h) => !mine(h));
        return { type: 'move_robber', hex: (good.length ? good : L.robber)[0] };
      }
      return L.pirate.length ? { type: 'move_pirate', hex: L.pirate[0] } : null;
    }
    case 'steal': return L.steal.length ? { type: 'steal', target: L.steal[0] } : null;
    case 'road_building': return L.road.length ? { type: 'build_road', e: L.road[0] } : L.ship.length ? { type: 'build_ship', e: L.ship[0] } : { type: 'skip_roadbuilding' };
    case 'main':
    case 'sbp': {
      if (v.afford.city && L.city.length) return { type: 'build_city', v: L.city[0] };
      if (v.afford.settlement && L.settlement.length) return { type: 'build_settlement', v: L.settlement[0] };
      if (v.afford.dev) return { type: 'buy_dev' };
      if (v.afford.road && L.road.length) return { type: 'build_road', e: L.road[0] };
      if (v.afford.ship && L.ship.length) return { type: 'build_ship', e: L.ship[0] };
      const h = v.me.hand;
      const need = L.city.length ? { getreide: 2, erz: 3 } : L.settlement.length ? { holz: 1, lehm: 1, wolle: 1, getreide: 1 } : { getreide: 1, erz: 1, wolle: 1 };
      const missing = RES.filter((r) => (h[r] || 0) < (need[r] || 0) && v.bank.stock[r] > 0);
      const spare = RES.filter((r) => (h[r] || 0) - (need[r] || 0) >= (v.rates[r] || 4));
      if (missing.length && spare.length) return { type: 'bank_trade', give: spare[0], get: missing[0] };
      return { type: v.step === 'sbp' ? 'sbp_done' : 'end_turn' };
    }
    default: return null;
  }
}

async function post(token, action) {
  try {
    await fetch(base + '/api/act', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...action }),
    });
  } catch (e) { /* egal */ }
}

(async () => {
  tokens.forEach(connect);
  await sleep(200);
  for (;;) {
    // Pflichten (Abwerfen/Gold) für alle gesteuerten Spieler zuerst
    let acted = false;
    for (const [token, v] of views) {
      if (v.pending.discard[v.you] || v.pending.gold[v.you]) {
        const a = actionFor(v.you, v);
        if (a) { await post(token, a); acted = true; }
      }
      if (acted) break;
    }
    if (!acted) {
      const first = [...views.values()][0];
      if (first) {
        const active = first.turn;
        for (const [token, v] of views) {
          if (v.you !== active) continue;
          const a = actionFor(active, v);
          if (a) { await post(token, a); acted = true; }
          break;
        }
      }
    }
    await sleep(acted ? delay : 100);
  }
})();
