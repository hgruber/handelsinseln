// regeln.js – ausführliche, bebilderte Spielregeln für den Reiter „Regeln“ (Protokoll/Chat/Regeln-Panel).
// Kontext von app.js: {Art, costChips(kind), settings()}. Liefert HTML (ohne Nutzereingaben, daher ohne Escaping).
(function (root) {
  'use strict';
  let C = null;
  const TER = [
    ['wald1', 'Wald', 'holz', 'Holz'], ['huegel1', 'Hügelland', 'lehm', 'Lehm'], ['weide1', 'Weide', 'wolle', 'Wolle'],
    ['acker1', 'Acker', 'getreide', 'Getreide'], ['gebirge1', 'Gebirge', 'erz', 'Erz'],
  ];
  const tile = (img, cap) => `<figure class="rl-tile"><img src="img/${img}.webp" alt="" width="44" height="44" draggable="false"><figcaption>${cap}</figcaption></figure>`;
  const sec = (title, body, open) => `<details class="rl-sec"${open ? ' open' : ''}><summary>${title}</summary><div class="rl-body">${body}</div></details>`;
  const cost = (k, label, extra) => `<tr><td>${C.Art.pieceIcon(k, 'rot', 28)}</td><th>${label}${extra ? ` <small>${extra}</small>` : ''}</th><td>${C.costChips(k)}</td></tr>`;
  const dots = (n) => '●'.repeat(6 - Math.abs(7 - n));

  function html() {
    const s = C.settings(), A = C.Art;
    const win = s.winPoints || 14, bank = s.bankRate || 4, lim = s.handLimit === null ? null : s.handLimit || 7;
    const chips = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((n) => `<span class="rl-chip${n === 6 || n === 8 ? ' hot' : ''}"><b>${n}</b><i>${dots(n)}</i></span>`).join('');
    return `<div class="rl">` +
      sec('Ziel des Spiels', `<p>Wer zuerst <b>${win} Siegpunkte</b> erreicht, gewinnt – sofort, auch mitten im eigenen Zug.</p>` +
        `<table class="rl-t"><tr><td>${A.pieceIcon('settlement', 'rot', 26)}</td><th>Siedlung</th><td><b>1</b></td></tr><tr><td>${A.pieceIcon('city', 'rot', 26)}</td><th>Stadt</th><td><b>2</b></td></tr>` +
        `<tr><td>${A.dev('siegpunkt', 26)}</td><th>Siegpunktkarte (verdeckt)</th><td><b>1</b></td></tr><tr><td>${A.pieceIcon('road', 'rot', 26)}</td><th>Längster Handelsweg <small>(ab ${s.longestMin || 5} Teilen)</small></th><td><b>2</b></td></tr>` +
        `<tr><td>${A.dev('ritter', 26)}</td><th>Stärkste Schutzmacht <small>(ab ${s.armyMin || 3} Rittern)</small></th><td><b>2</b></td></tr>` +
        `<tr><td>${A.pieceIcon('ship', 'rot', 26)}</td><th>Neue Insel besiedelt <small>(Handelsinseln)</small></th><td><b>${s.islandBonus === undefined ? 2 : s.islandBonus}</b></td></tr></table>`, true) +
      sec('Spielaufbau', `<p>Reihum setzt jeder eine <b>Siedlung</b> und daran anschließend eine <b>Straße</b>. In der zweiten Runde geht es <b>rückwärts</b> – wieder Siedlung und Straße.</p>` +
        `<p>Für die <b>zweite</b> Siedlung erhältst du sofort je einen Rohstoff von jedem angrenzenden Feld.</p>` +
        `<p><b>Abstandsregel:</b> Zwischen zwei Gebäuden müssen mindestens zwei Wege liegen – auch beim Weiterbauen später. Im Aufbau darf nur auf der Startinsel gebaut werden.</p>`) +
      sec('Ein Zug', `<ol class="rl-ol"><li><b>Würfeln</b> – beide Würfel zählen zusammen. Mit „Auto Ablauf“ würfelt der Server sofort nach Zugende.</li>` +
        `<li><b>Erträge</b> – jedes Feld mit der gewürfelten Zahl gibt jedem angrenzenden Gebäude Rohstoffe: <b>1</b> für eine Siedlung, <b>2</b> für eine Stadt. Eine <b>7</b> bringt nichts, sondern bewegt den Räuber.</li>` +
        `<li><b>Handeln &amp; Bauen</b> – in beliebiger Reihenfolge und Menge.</li><li><b>Zug beenden</b> – der nächste Spieler ist dran.</li></ol>` +
        `<p class="rl-chips">${chips}</p><p class="rl-note">Die Punkte unter der Zahl zeigen, wie wahrscheinlich sie fällt (6 und 8 am häufigsten).</p>`, true) +
      sec('Gelände &amp; Rohstoffe', `<div class="rl-tiles">${TER.map(([img, n, r, rn]) => `<div class="rl-ter">${tile(img, n)}<span class="rl-arr">→</span>${A.res(r, 40)}<small>${rn}</small></div>`).join('')}</div>` +
        `<div class="rl-tiles"><div class="rl-ter">${tile('gold1', 'Goldfluss')}<span class="rl-arr">→</span><small>beliebiger Rohstoff deiner Wahl</small></div>` +
        `<div class="rl-ter">${tile('wueste1', 'Wüste')}<span class="rl-arr">→</span><small>nichts (hier startet der Räuber)</small></div>` +
        `<div class="rl-ter">${tile('meer1', 'Meer')}<span class="rl-arr">→</span><small>nur Schiffe &amp; Häfen</small></div>` +
        `<div class="rl-ter">${tile('nebel1', 'Nebel')}<span class="rl-arr">→</span><small>wird beim Anlegen aufgedeckt</small></div></div>`) +
      sec('Bauen &amp; Kosten', `<table class="rl-t cost-t">${cost('road', 'Straße')}${cost('ship', 'Schiff')}${cost('settlement', 'Siedlung', '(1 Punkt)')}${cost('city', 'Stadt', '(2 Punkte)')}` +
        `<tr><td>${A.dev('ritter', 26)}</td><th>Entwicklungskarte</th><td>${C.costChips('dev')}</td></tr></table>` +
        `<ul class="rl-ul"><li>Siedlungen müssen an einer <b>eigenen Straße oder einem eigenen Schiff</b> liegen.</li><li>Eine <b>Stadt</b> ersetzt eine eigene Siedlung (die Siedlung geht zurück in deinen Vorrat).</li>` +
        `<li>Straßen führen über Land, <b>Schiffe</b> über das Meer; beide bilden zusammen eine Handelsroute.</li>` +
        `<li>Ein Schiff mit offenem Ende darf einmal pro Zug versetzt werden – nicht in dem Zug, in dem es gebaut wurde.</li></ul>`) +
      sec('Handeln', `<ul class="rl-ul"><li><b>Mit Spielern:</b> ${s.playerTrade === false ? 'In dieser Partie nicht erlaubt – nur mit der Bank.' : 'Im eigenen Zug (nach dem Würfeln) machst du ein Angebot; als Mitspieler kannst du dem Spielenden jederzeit eines machen. Andere nehmen an, lehnen ab oder machen ein Gegenangebot.'}</li>` +
        `<li><b>Mit der Bank:</b> <b>${bank}:1</b> – ${bank} gleiche Rohstoffe gegen einen beliebigen.</li>` +
        `<li><b>Hafen:</b> Eine Siedlung oder Stadt an der Hafenkante schaltet <b>3:1</b> (allgemeiner Hafen) oder <b>2:1</b> (Spezialhafen für eine Sorte) frei.</li></ul>`) +
      sec('Die 7 – Räuber &amp; Pirat', `<div class="rl-pic"><img src="img/stein-raeuber.webp" alt="" height="56" draggable="false"><img src="img/stein-pirat.webp" alt="" height="56" draggable="false"></div>` +
        `<ol class="rl-ol"><li>${lim === null ? 'Das Handkartenlimit ist aufgehoben – niemand muss abwerfen.' : `Wer mehr als <b>${lim}</b> Karten hat, wirft die Hälfte (abgerundet) ab.`}</li>` +
        `<li>Der Würfler versetzt den <b>Räuber</b> auf ein Landfeld <i>oder</i> den <b>Piraten</b> auf ein Meerfeld.</li>` +
        `<li>Das Feld liefert keine Erträge mehr; der Pirat sperrt zusätzlich Schiffe an seiner Küste.</li>` +
        `<li>Dann bestiehlst du einen Mitspieler mit Gebäude am Feld: eine zufällige Karte wandert zu dir.</li></ol>`) +
      sec('Entwicklungskarten', `<table class="rl-t">` +
        `<tr><td>${A.dev('ritter', 30)}</td><th>Ritter</th><td>Räuber versetzen &amp; stehlen. Ab ${s.armyMin || 3} gespielten Rittern: Stärkste Schutzmacht.</td></tr>` +
        `<tr><td>${A.dev('strassenbau', 30)}</td><th>Straßenbau</th><td>Zwei Straßen (oder Schiffe) kostenlos bauen.</td></tr>` +
        `<tr><td>${A.dev('erfindung', 30)}</td><th>Erfindung</th><td>Zwei beliebige Rohstoffe aus der Bank nehmen.</td></tr>` +
        `<tr><td>${A.dev('monopol', 30)}</td><th>Monopol</th><td>Alle Mitspieler geben dir ihre Karten einer Sorte.</td></tr>` +
        `<tr><td>${A.dev('siegpunkt', 30)}</td><th>Siegpunkt</th><td>Bleibt verdeckt, zählt automatisch.</td></tr>` +
        (s.limits && s.limits.dev && ![0, 'standard', undefined].includes(s.limits.dev.stadtmauer) ? `<tr><td>${A.dev('stadtmauer', 30)}</td><th>Stadtmauer</th><td>Bleibt verdeckt; jede erlaubt bei einer 7 eine Handkarte mehr.</td></tr>` : '') + '</table>' +
        `<p class="rl-note">Pro Zug darf eine Karte gespielt werden, aber nicht die im selben Zug gekaufte.</p>`) +
      sec('Handelsinseln', `<ul class="rl-ul"><li><b>Inseln:</b> Die erste Siedlung auf einer neuen Insel bringt Sonderpunkte (bis zur Obergrenze der Einstellungen).</li>` +
        `<li><b>Nebel:</b> Wer mit Straße oder Schiff an ein Nebelfeld anlegt, deckt es auf – bei Rohstoffen gibt es eine Karte.</li>` +
        `<li><b>Gold:</b> Ein Goldfeld gibt dir beliebige Rohstoffe deiner Wahl.</li>` +
        `<li><b>Sonderbauphase</b> (ab 5 Spielern): Nach jedem Zug dürfen die anderen reihum bauen und mit der Bank tauschen – ohne Handel unter Spielern.</li></ul>`) +
      `</div>`;
  }
  root.Regeln = { init(ctx) { C = ctx; }, html };
})(typeof self !== 'undefined' ? self : this);
