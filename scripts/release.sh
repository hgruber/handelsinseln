#!/usr/bin/env bash
# Release-Skript: ./scripts/release.sh 1.0.0 [--build] [--skip-tests]
#  1. prüft Versionsformat, Branch master, sauberen Arbeitsbaum und einen Eintrag unter „Unveröffentlicht“
#  2. führt alle Tests aus (tests/run_all.sh)
#  3. setzt die Version in package.json und macht aus „Unveröffentlicht“ den Abschnitt „[X.Y.Z] - Datum“ (mit neuem leeren Block)
#  4. committet „Release X.Y.Z“ und setzt das Tag vX.Y.Z; mit --build wird zusätzlich das Container-Image getaggt
# Gepusht wird NIE automatisch; am Ende stehen die nächsten Befehle auf dem Bildschirm.
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${1:-}"; shift || true
BUILD=0; TESTS=1
for a in "$@"; do case "$a" in --build) BUILD=1 ;; --skip-tests) TESTS=0 ;; *) echo "Unbekannte Option: $a" >&2; exit 2 ;; esac; done
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "Aufruf: $0 <MAJOR.MINOR.PATCH> [--build] [--skip-tests]" >&2; exit 2; }
[[ "$(git branch --show-current)" == "master" ]] || { echo "Releases nur auf master (aktuell: $(git branch --show-current))." >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "Arbeitsbaum ist nicht sauber – erst committen." >&2; exit 1; }
git rev-parse "v$VER" >/dev/null 2>&1 && { echo "Tag v$VER existiert schon." >&2; exit 1; }
node -e '
  const t = require("fs").readFileSync("CHANGELOG.md", "utf8"), m = /## \[Unveröffentlicht\]\n([\s\S]*?)(?=\n## \[|$)/.exec(t);
  if (!m || !/^- /m.test(m[1])) { console.error("CHANGELOG.md: unter „Unveröffentlicht“ steht kein Eintrag."); process.exit(1); }'
if (( TESTS )); then echo "== Tests =="; bash tests/run_all.sh; fi
DATE="$(date +%F)"
VER="$VER" DATE="$DATE" node -e '
  const fs = require("fs"), v = process.env.VER, d = process.env.DATE;
  const p = JSON.parse(fs.readFileSync("package.json", "utf8")); p.version = v; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
  fs.writeFileSync("CHANGELOG.md", fs.readFileSync("CHANGELOG.md", "utf8").replace("## [Unveröffentlicht]", `## [Unveröffentlicht]\n\n## [${v}] - ${d}`));'
git add package.json CHANGELOG.md
git commit -q -m "Release $VER"
git tag -a "v$VER" -m "Die Handelsinseln $VER"
if (( BUILD )); then podman build -t "localhost/handelsinseln:$VER" -t localhost/handelsinseln:latest .; fi
echo
echo "Release $VER ist lokal fertig (Commit + Tag v$VER). Nichts wurde gepusht. Nächste Schritte:"
echo "  git push origin master && git push origin v$VER"
if (( BUILD )); then echo "  podman save localhost/handelsinseln:latest | ssh <host> podman load && ssh <host> systemctl restart handelsinseln.service"
else echo "  podman build -t localhost/handelsinseln:$VER -t localhost/handelsinseln:latest .   # oder das Skript mit --build starten"; fi
