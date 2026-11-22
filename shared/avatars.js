// Avatare (Bilder in public/img/av/<id>.webp, per Forge/Flux gemalt) und die drei Bot-Spieler. Server + Client.
(function (root) {
  // Frei wählbare Avatare der Menschen
  const HUMAN = [
    { id: 'kapitaen', name: 'Alter Kapitän', g: 'Menschen' }, { id: 'piratin', name: 'Piratin mit Augenklappe', g: 'Menschen' }, { id: 'matrose', name: 'Matrose', g: 'Menschen' },
    { id: 'forscherin', name: 'Forscherin mit Fernrohr', g: 'Menschen' }, { id: 'haendler', name: 'Pfeffersack-Händler', g: 'Menschen' }, { id: 'navigatorin', name: 'Navigatorin mit Kompass', g: 'Menschen' },
    { id: 'fischer', name: 'Fischer mit Pfeife', g: 'Menschen' }, { id: 'junge', name: 'Schiffsjunge', g: 'Menschen' },
    { id: 'fuchs', name: 'Kapitän Fuchs', g: 'Tiere' }, { id: 'eule', name: 'Eule mit Fernrohr', g: 'Tiere' }, { id: 'otter', name: 'Matrosen-Otter', g: 'Tiere' },
    { id: 'pinguin', name: 'Rettungsring-Pinguin', g: 'Tiere' }, { id: 'krake', name: 'Kraken-Käpt\'n', g: 'Tiere' }, { id: 'robbe', name: 'Mützen-Robbe', g: 'Tiere' },
    { id: 'moewe', name: 'Brötchen-Möwe', g: 'Tiere' }, { id: 'krabbe', name: 'Krabbe Klaus', g: 'Tiere' },
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
