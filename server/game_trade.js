'use strict';
// Spiellogik, Teilbereich: Handel mit der Bank und zwischen Spielern.
// Die Methoden werden in game.js an Game.prototype gehängt (this = das Spiel).
const { RES, RES_DE, fail, sum, fmt, cleanCards } = require('./game_common');

class GameTrade {
  // ---------- Handel ----------
  bankTrade(pid, a) {
    if (!RES.includes(a.give) || !RES.includes(a.get)) fail('Wähle zwei Rohstoffe.');
    if (a.give === a.get) fail('Gleiche Rohstoffe lassen sich nicht tauschen.');
    const times = a.n === undefined ? 1 : a.n;
    if (!Number.isInteger(times) || times < 1 || times > 20) fail('Ungültige Anzahl.');
    const rate = this.ratesFor(pid)[a.give];
    if (this.pl(pid).hand[a.give] < rate * times) fail(`Für diesen Tausch brauchst du ${rate * times}× ${RES_DE[a.give]} (Kurs ${rate}:1).`);
    if (this.stock(a.get) < times) fail(`Die Bank hat nur noch ${this.stock(a.get)}× ${RES_DE[a.get]}.`);
    this.bump(pid, 'tradesBank');
    this.pl(pid).hand[a.give] -= rate * times; this.pl(pid).hand[a.get] += times;
    this.fx('p:' + pid, 'bank', { [a.give]: rate * times }, true, 'bank'); this.fx('bank', 'p:' + pid, { [a.get]: times }, true, 'bank');
    this.log(`${this.name(pid)} tauscht mit der Bank ${rate * times}× ${RES_DE[a.give]} gegen ${times}× ${RES_DE[a.get]} (${rate}:1).`, 'trade', pid);
  }
  tradeOffer(pid, a) {
    const S = this.S;
    if (S.sbp) fail('In der Sonderbauphase ist kein Handel mit Spielern erlaubt.');
    if (!S.settings.playerTrade) fail('In diesem Spiel ist nur der Handel mit der Bank erlaubt.');
    const give = cleanCards(a.give), want = cleanCards(a.want);
    if (!sum(give) || !sum(want)) fail('Ein Angebot braucht Karten auf beiden Seiten.');
    if (RES.some((r) => give[r] && want[r])) fail('Gib nicht dieselbe Ressource, die du verlangst.');
    if (!this.isTablePlayer(pid) && !this.canPay(pid, give)) fail('Du besitzt diese Karten nicht.');
    S.trade = { id: ++S.tradeSeq, from: pid, give, want, responses: {} };
    this.log(`${this.name(pid)} bietet ${fmt(give)} gegen ${fmt(want)}.`, 'trade', pid);
    // Auto-Spieler nehmen jedes 1:1-Angebot an, wenn sie die verlangte Karte besitzen
    if (sum(give) === 1 && sum(want) === 1) {
      for (const q of S.players) if (q.id !== pid && q.auto && this.canPay(q.id, want)) { S.trade.responses[q.id] = { s: 'accept' }; this.log(`${q.name} (Auto) nimmt das 1:1-Angebot an.`, 'trade', q.id); }
    }
  }
  tradeRespond(pid, a) {
    const S = this.S, tr = S.trade;
    if (!tr) fail('Es gibt kein offenes Angebot.');
    if (pid === tr.from) fail('Das ist dein eigenes Angebot.');
    if (S.sbp || S.phase !== 'main') fail('Gerade ist kein Handel möglich.');
    if (a.counter) {
      const give = cleanCards(a.counter.give), want = cleanCards(a.counter.want);
      if (!sum(give) || !sum(want)) fail('Ein Gegenangebot braucht Karten auf beiden Seiten.');
      if (RES.some((r) => give[r] && want[r])) fail('Gib nicht dieselbe Ressource, die du verlangst.');
      if (!this.canPay(pid, want)) fail('Du besitzt die Karten deines Gegenangebots nicht.');
      tr.responses[pid] = { s: 'counter', give, want };
      this.log(`${this.name(pid)} macht ein Gegenangebot: bekommt ${fmt(want)}, gibt ${fmt(give)}.`, 'trade', pid);
    } else if (a.accept) {
      if (!this.canPay(pid, tr.want)) fail('Dir fehlen die verlangten Karten.');
      tr.responses[pid] = { s: 'accept' };
      this.log(`${this.name(pid)} nimmt das Angebot an.`, 'trade', pid);
    } else {
      tr.responses[pid] = { s: 'decline' };
      this.log(`${this.name(pid)} lehnt ab.`, 'trade', pid);
    }
    S.v++;
  }
  tradeConfirm(pid, a) {
    const S = this.S, tr = S.trade;
    if (!tr || tr.from !== pid) fail('Du hast kein offenes Angebot.');
    const r = tr.responses[a.with];
    if (!r || (r.s !== 'accept' && r.s !== 'counter')) fail('Dieser Spieler hat nicht zugesagt.');
    const give = r.s === 'counter' ? r.give : tr.give, want = r.s === 'counter' ? r.want : tr.want;
    if (!this.canPay(pid, give)) fail('Du besitzt die angebotenen Karten nicht mehr.');
    if (!this.canPay(a.with, want)) fail(`${this.name(a.with)} besitzt die Karten nicht mehr.`);
    this.pay(pid, give); this.give(a.with, give);
    this.pay(a.with, want); this.give(pid, want);
    this.fx('p:' + pid, 'p:' + a.with, give, true, 'trade'); this.fx('p:' + a.with, 'p:' + pid, want, true, 'trade');
    this.bump(pid, 'tradesPlayer'); this.bump(a.with, 'tradesPlayer');
    this.log(`Handel: ${this.name(pid)} gibt ${fmt(give)} an ${this.name(a.with)} und erhält ${fmt(want)}.`, 'trade', pid);
    S.trade = null;
  }
  tradeCancel(pid) {
    const S = this.S;
    if (!S.trade || S.trade.from !== pid) fail('Du hast kein offenes Angebot.');
    S.trade = null;
    this.log(`${this.name(pid)} zieht das Angebot zurück.`, 'trade', pid);
  }
}

module.exports = GameTrade;
