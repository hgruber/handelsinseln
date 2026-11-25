// Avatare und Bot-Spieler – Werte wie shared/avatars.js.
pub const HUMAN_IDS: [&str; 16] = [
    "kapitaen", "piratin", "matrose", "forscherin", "haendler", "navigatorin", "fischer", "junge",
    "fuchs", "eule", "otter", "pinguin", "krake", "robbe", "moewe", "krabbe",
];

pub struct BotDef {
    pub key: &'static str,
    pub avatar: &'static str,
    pub name: &'static str,
    pub label: &'static str,
}

pub const BOTS: [BotDef; 3] = [
    BotDef { key: "baumeister", avatar: "biber", name: "Bruno Biber", label: "Baumeister" },
    BotDef { key: "haendler", avatar: "papagei", name: "Polly Profit", label: "Händler" },
    BotDef { key: "ritter", avatar: "ente", name: "Sir Quakalot", label: "Ritter" },
];

pub fn bot(key: &str) -> Option<&'static BotDef> {
    BOTS.iter().find(|b| b.key == key)
}
