// Avatare (Bilder in public/img/av/<id>.webp, per Forge/Flux gemalt) und die drei Bot-Spieler. Server + Client.
(function (root) {
  // Frei wählbare Avatare der Menschen
  const HUMAN = [
    { id: 'fuchs', name: 'Kapitän Fuchs' }, { id: 'eule', name: 'Eule mit Fernrohr' }, { id: 'otter', name: 'Matrosen-Otter' },
    { id: 'pinguin', name: 'Rettungsring-Pinguin' }, { id: 'krake', name: 'Kraken-Käpt\'n' }, { id: 'robbe', name: 'Mützen-Robbe' },
    { id: 'moewe', name: 'Brötchen-Möwe' }, { id: 'krabbe', name: 'Krabbe Klaus' },
  ];
  // Bots: feste Avatare, Namen und Spielstil; Menschen können sie nicht wählen
  const BOTS = {
    baumeister: { avatar: 'biber', name: 'Bruno Biber', label: 'Baumeister', desc: 'Baut Straßen und Siedlungen, jagt den Längsten Handelsweg.' },
    haendler: { avatar: 'papagei', name: 'Polly Profit', label: 'Händler', desc: 'Sucht Häfen, tauscht ständig und baut früh Städte.' },
    ritter: { avatar: 'ente', name: 'Sir Quakalot', label: 'Ritter', desc: 'Kauft Entwicklungskarten, sammelt Ritter, plagt den Führenden mit dem Räuber.' },
  };
  const BOT_AVATARS = Object.values(BOTS).map((b) => b.avatar);
  const api = { HUMAN, BOTS, BOT_AVATARS, HUMAN_IDS: HUMAN.map((a) => a.id), ALL_IDS: [...HUMAN.map((a) => a.id), ...BOT_AVATARS] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Avatars = api;
})(typeof self !== 'undefined' ? self : this);
