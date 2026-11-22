'use strict';
// Autopilot (nur Pflichten, für abwesende Spieler) und Testspieler (baut, handelt, spielt Karten).
const RES = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function randomCards(hand, n, rnd) {
  const pool = []; RES.forEach((r) => { for (let i = 0; i < hand[r]; i++) pool.push(r); });
  const out = {};
  for (let i = 0; i < n && pool.length; i++) { const k = Math.floor(rnd() * pool.length); const r = pool.splice(k, 1)[0]; out[r] = (out[r] || 0) + 1; }
  return out;
}
function anyCards(n, rnd) { const out = {}; for (let i = 0; i < n; i++) { const r = pick(RES, rnd); out[r] = (out[r] || 0) + 1; } return out; }

// Führt höchstens EINE Aktion für pid aus. Gibt true zurück, wenn etwas geschah.
function botAct(game, pid, opts = {}) {
  const rnd = opts.rnd || game.rnd;
  const full = !opts.minimal;
  const S = game.S;
  const act = (a) => { game.act(pid, a); return true; };
  if (S.phase === 'lobby' || S.phase === 'ended') return false;
  const v = game.view(pid);
  const L = v.legal;

  // Pflichten für alle
  if (v.pending.discard[pid]) return act({ type: 'discard', cards: randomCards(v.me.hand, v.pending.discard[pid], rnd) });
  if (v.pending.gold[pid]) return act({ type: 'gold_pick', cards: anyCards(v.pending.gold[pid], rnd) });
  if (v.step === 'discard' || v.step === 'gold') return false;

  // Handelsangebote beantworten (nur Testspieler)
  if (full && v.trade && v.trade.from !== pid && !v.trade.responses[pid] && !v.sbp) {
    const canGive = Object.keys(v.trade.want).every((r) => v.me.hand[r] >= v.trade.want[r]);
    const r = rnd();
    if (canGive && r < 0.5) return act({ type: 'trade_respond', accept: true });
    if (r < 0.6 && total(v.me.hand) > 2) {
      const want = pick(RES, rnd), have = RES.filter((x) => v.me.hand[x] > 0 && x !== want);
      if (have.length) return act({ type: 'trade_respond', counter: { give: { [want]: 1 }, want: { [have[0]]: 1 } } });
    }
    return act({ type: 'trade_respond', accept: false });
  }

  if (v.turn !== pid) return false;
  switch (v.step) {
    case 'setup_order': return act({ type: 'roll' });
    case 'setup_settlement': return act({ type: 'place_settlement', v: pick(L.settlement, rnd) });
    case 'setup_road': {
      const opts2 = [...L.road.map((e) => ['place_road', e]), ...L.ship.map((e) => ['place_ship', e])];
      const [type, e] = pick(opts2, rnd); return act({ type, e });
    }
    case 'roll': {
      if (full && v.me.dev.some((d) => d.type === 'ritter' && d.playable) && rnd() < 0.3) return act({ type: 'play_knight' });
      return act({ type: 'roll' });
    }
    case 'robber': {
      const mine = (h) => Object.keys(v.verts).some((k) => v.verts[k].p === pid && k.split('|').includes(h));
      if (L.pirate.length && rnd() < 0.25) return act({ type: 'move_pirate', hex: pick(L.pirate, rnd) });
      const good = L.robber.filter((h) => !mine(h));
      return act({ type: 'move_robber', hex: pick(good.length ? good : L.robber, rnd) });
    }
    case 'steal': return act({ type: 'steal', target: pick(L.steal, rnd) });
    case 'road_building': {
      const all = [...L.road.map((e) => ['build_road', e]), ...L.ship.map((e) => ['build_ship', e])];
      if (!all.length) return act({ type: 'skip_roadbuilding' });
      const [type, e] = pick(all, rnd); return act({ type, e });
    }
    case 'sbp':
    case 'main': {
      const sbp = v.step === 'sbp';
      if (!full) return act({ type: sbp ? 'sbp_done' : 'end_turn' });
      const h = v.me.hand, af = v.afford;
      if (L.city.length && af.city) return act({ type: 'build_city', v: pick(L.city, rnd) });
      if (L.settlement.length && af.settlement) return act({ type: 'build_settlement', v: pick(L.settlement, rnd) });
      if (!sbp && v.me.dev.some((d) => d.playable) && rnd() < 0.5) {
        const d = pick(v.me.dev.filter((x) => x.playable), rnd);
        if (d.type === 'ritter') return act({ type: 'play_knight' });
        if (d.type === 'strassenbau') return act({ type: 'play_roadbuilding' });
        if (d.type === 'erfindung') { const ok = RES.filter((r) => v.bank.stock[r] >= 2); if (!ok.length) return act({ type: 'end_turn' }); return act({ type: 'play_yop', a: ok[0], b: ok[0] }); }
        if (d.type === 'monopol') return act({ type: 'play_monopoly', res: pick(RES, rnd) });
      }
      if (af.dev && rnd() < 0.6) return act({ type: 'buy_dev' });
      // Rohstoffe passend tauschen (Bank): Überschuss gegen Fehlendes für Siedlung/Stadt
      const need = L.city.length ? { getreide: 2, erz: 3 } : { holz: 1, lehm: 1, wolle: 1, getreide: 1 };
      const missing = RES.filter((r) => h[r] < (need[r] || 0));
      const spare = RES.filter((r) => h[r] - (need[r] || 0) >= v.rates[r]);
      const missingOk = missing.filter((r) => v.bank.stock[r] > 0);
      if (missingOk.length && spare.length && rnd() < 0.8) return act({ type: 'bank_trade', give: pick(spare, rnd), get: pick(missingOk, rnd) });
      // Spielerhandel anbieten
      if (!sbp && v.settings.playerTrade && !v.trade && missing.length && total(h) >= 2 && rnd() < 0.25) {
        const g = pick(RES.filter((r) => h[r] > 0 && !missing.includes(r)), rnd);
        if (g) return act({ type: 'trade_offer', give: { [g]: 1 }, want: { [pick(missing, rnd)]: 1 } });
      }
      if (v.trade && v.trade.from === pid) {
        const acc = Object.keys(v.trade.responses).find((k) => v.trade.responses[k].s !== 'decline');
        if (acc !== undefined) { try { return act({ type: 'trade_confirm', with: +acc }); } catch (e) { return act({ type: 'trade_cancel' }); } }
        if (Object.keys(v.trade.responses).length >= v.players.length - 1) return act({ type: 'trade_cancel' });
      }
      if (af.road && L.road.length && rnd() < (L.settlement.length ? 0.1 : 0.5)) return act({ type: 'build_road', e: pick(L.road, rnd) });
      if (af.ship && L.ship.length && rnd() < 0.5) return act({ type: 'build_ship', e: pick(L.ship, rnd) });
      if (!sbp && L.shipFrom.length && rnd() < 0.15) { const f = pick(L.shipFrom, rnd); return act({ type: 'move_ship', from: f, to: pick(L.shipTo[f], rnd) }); }
      if (v.trade && v.trade.from === pid && !Object.keys(v.trade.responses).length) return false;
      return act({ type: sbp ? 'sbp_done' : 'end_turn' });
    }
    default: return false;
  }
}

module.exports = { botAct };
