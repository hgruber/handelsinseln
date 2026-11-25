// Auszeichnungen, Siegpunkte, Spielende und Schritt – Portierung aus server/game.js.
use indexmap::{IndexMap, IndexSet};

use crate::game::{now_ms, Game};
use crate::geom;
use crate::model::{HistoryEntry, State};

impl Game {
    pub fn route_len(&self, pid: usize) -> u32 {
        let S = &self.S;
        let mut own: IndexMap<String, Vec<String>> = IndexMap::new();
        for (e, b) in &S.edges {
            if b.p == pid {
                for v in geom::edge_verts(e) {
                    own.entry(v).or_default().push(e.clone());
                }
            }
        }
        let edges_own: Vec<String> = S
            .edges
            .iter()
            .filter(|(_, b)| b.p == pid)
            .map(|(e, _)| e.clone())
            .collect();
        if edges_own.is_empty() {
            return 0;
        }
        let mut ends: IndexMap<String, [String; 2]> = IndexMap::new();
        for e in &edges_own {
            let v = geom::edge_verts(e);
            ends.insert(e.clone(), [v[0].clone(), v[1].clone()]);
        }
        let mut used: IndexSet<String> = IndexSet::new();
        let mut best = 0u32;
        let mut budget = 400_000i32;
        let total = edges_own.len() as u32;
        for e in &edges_own {
            for v in &ends[e] {
                if budget < 0 || best >= total {
                    break;
                }
                used.insert(e.clone());
                dfs(v, e, 1, pid, S, &own, &ends, &mut used, &mut best, &mut budget, total);
                used.shift_remove(e);
            }
        }
        best
    }

    pub fn update_awards(&mut self, _quiet: bool) {
        let lens: Vec<u32> = self.S.players.iter().map(|p| self.route_len(p.id)).collect();
        self.lens = Some(lens.clone());
        if let Some(st) = self.S.stats.as_mut() {
            for (i, l) in lens.iter().enumerate() {
                if *l > st.players[i].max_route {
                    st.players[i].max_route = *l;
                }
            }
        }
        let max = lens.iter().copied().max().unwrap_or(0);
        let cands: Vec<usize> = lens
            .iter()
            .enumerate()
            .filter(|(_, l)| **l == max)
            .map(|(i, _)| i)
            .collect();
        let mut nl = self.S.longest;
        let lm = self.S.settings.longest_min;
        if max < lm {
            nl = None;
        } else if nl.is_none() || !nl.map(|n| cands.contains(&n)).unwrap_or(false) {
            nl = if cands.len() == 1 {
                Some(cands[0])
            } else if let Some(n) = nl {
                if lens[n] >= lm && lens[n] == max {
                    Some(n)
                } else {
                    None
                }
            } else {
                None
            };
        }
        if nl != self.S.longest {
            if let Some(n) = nl {
                let name = self.name(n);
                self.log(
                    format!("{} hat jetzt den Längsten Handelsweg ({})! +2 Punkte.", name, lens[n]),
                    "award",
                    Some(n),
                );
            } else if self.S.longest.is_some() {
                self.log("Der Längste Handelsweg ist unterbrochen – niemand hat ihn.", "award", None);
            }
            self.S.longest = nl;
        }
        let k: Vec<u32> = self.S.players.iter().map(|p| p.knights).collect();
        let kmax = k.iter().copied().max().unwrap_or(0);
        let mut na = self.S.largest;
        if kmax >= self.S.settings.army_min {
            let kc: Vec<usize> = k
                .iter()
                .enumerate()
                .filter(|(_, x)| **x == kmax)
                .map(|(i, _)| i)
                .collect();
            if na.is_none() || !na.map(|n| kc.contains(&n)).unwrap_or(false) {
                na = if kc.len() == 1 { Some(kc[0]) } else { na };
            }
        }
        if na != self.S.largest {
            self.S.largest = na;
            if let Some(n) = na {
                let name = self.name(n);
                self.log(
                    format!(
                        "{} hat jetzt die Stärkste Schutzmacht ({} Ritter)! +2 Punkte.",
                        name, k[n]
                    ),
                    "award",
                    Some(n),
                );
            }
        }
    }

    pub fn vp(&self, pid: usize) -> i64 {
        self.count(pid, "s")
            + 2 * self.count(pid, "c")
            + self.pl(pid).svp as i64
            + if self.S.longest == Some(pid) { 2 } else { 0 }
            + if self.S.largest == Some(pid) { 2 } else { 0 }
    }

    pub fn hidden_vp(&self, pid: usize) -> u32 {
        self.pl(pid).dev.iter().filter(|d| d.kind == "siegpunkt").count() as u32
    }

    pub fn check_win(&mut self) {
        self.update_awards(false);
        let pid = match self.S.sbp.as_ref() {
            Some(sb) => sb.pid,
            None => Some(self.S.turn),
        };
        if let Some(pid) = pid {
            let vp = self.vp(pid) + self.hidden_vp(pid) as i64;
            if vp >= self.S.settings.win_points as i64 {
                self.finish(Some(pid), "win");
                let name = self.name(pid);
                self.log(
                    format!("🏆 {} gewinnt mit {} Siegpunkten!", name, vp),
                    "award",
                    Some(pid),
                );
            }
        }
    }

    pub fn finish(&mut self, winner: Option<usize>, by: &str) {
        self.S.ended_from = Some(self.S.phase.clone());
        self.S.phase = "ended".to_string();
        self.S.winner = winner;
        self.S.ended_by = Some(by.to_string());
        self.S.aborted = by == "host";
        self.S.trade = None;
        if self.S.stats.is_some() {
            let vps: Vec<u32> = self
                .S
                .players
                .iter()
                .map(|q| (self.vp(q.id) + self.hidden_vp(q.id) as i64) as u32)
                .collect();
            if let Some(st) = self.S.stats.as_mut() {
                st.ended_at = Some(now_ms());
                let round = (st.history.len() + 1) as u32;
                st.history.push(HistoryEntry { round, vp: vps, end: Some(true) });
            }
        }
    }

    pub fn step_of(&self) -> String {
        let S = &self.S;
        if S.phase == "lobby" {
            return "lobby".into();
        }
        if S.phase == "ended" {
            return "ended".into();
        }
        if !S.pend.discard.is_empty() {
            return "discard".into();
        }
        if !S.pend.gold.is_empty() {
            return "gold".into();
        }
        if S.phase == "setup" {
            let stage = S.setup.as_ref().map(|s| s.stage.as_str()).unwrap_or("");
            return match stage {
                "seat" => "setup_seat",
                "order" => "setup_order",
                "settlement" => "setup_settlement",
                _ => "setup_road",
            }
            .into();
        }
        if S.sbp.is_some() {
            return "sbp".into();
        }
        if let Some(sub) = &S.ts.sub {
            return sub.clone();
        }
        if S.ts.rolled {
            "main".into()
        } else {
            "roll".into()
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn dfs(
    v: &str,
    prev: &str,
    len: u32,
    pid: usize,
    S: &State,
    own: &IndexMap<String, Vec<String>>,
    ends: &IndexMap<String, [String; 2]>,
    used: &mut IndexSet<String>,
    best: &mut u32,
    budget: &mut i32,
    total: u32,
) {
    if len > *best {
        *best = len;
    }
    *budget -= 1;
    if *best >= total || *budget < 0 {
        return;
    }
    let b = S.verts.get(v);
    if let Some(b) = b {
        if b.p != pid {
            return;
        }
    }
    if let Some(list) = own.get(v) {
        let prev_kind = S.edges.get(prev).map(|x| x.k.as_str()).unwrap_or("");
        for e in list {
            if used.contains(e) {
                continue;
            }
            let kind = S.edges.get(e).map(|x| x.k.as_str()).unwrap_or("");
            if kind != prev_kind && !matches!(b, Some(b) if b.p == pid) {
                continue;
            }
            used.insert(e.clone());
            let e_ends = &ends[e];
            let w = if &e_ends[0] == v { e_ends[1].clone() } else { e_ends[0].clone() };
            dfs(&w, e, len + 1, pid, S, own, ends, used, best, budget, total);
            used.shift_remove(e);
        }
    }
}
