// Deterministischer Zufallsgenerator (mulberry32) – bitgleich zu server/rng.js.
// Ohne festen Seed wird der Startwert aus /dev/urandom gezogen (wie Math.random beim Node-Server).

#[derive(Clone)]
pub struct Rng {
    a: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng { a: seed }
    }

    /// Feste Zufallsquelle aus RNG_SEED (gleiche Zahlenfolge wie der Node-Server).
    pub fn from_env() -> Option<Self> {
        let s = std::env::var("RNG_SEED").ok()?;
        if s.is_empty() {
            return None;
        }
        let n: f64 = s.trim().parse().ok()?;
        if !n.is_finite() {
            return None;
        }
        Some(Rng::new(n as u32))
    }

    pub fn seeded(seed: u32) -> Self {
        Rng::new(seed)
    }

    /// Eine Zahl in [0,1) – exakt wie Math.random im Node-Server (mulberry32).
    pub fn next_f64(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6D2B_79F5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(self.a | 1);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    }

    /// Ganzzahl in [0,n) wie Math.floor(rnd()*n).
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        (self.next_f64() * n as f64).floor() as usize
    }

    pub fn chance(&mut self, p: f64) -> bool {
        self.next_f64() < p
    }
}
