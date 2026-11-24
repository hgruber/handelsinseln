"""Gemeinsamer Rahmen der Browser-Tests: freier Port, Testserver starten, HTTP-/SSE-Hilfen, Prüfungen und Abschluss.
Jeder Test bekommt eigene Ports (Port 0 → Betriebssystem wählt), damit Tests parallel laufen können."""
import json, os, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
problems = []  # gemeinsame Fehlerliste; Tests hängen auch direkt an (Konsolenfehler u. Ä.)


def check(cond, msg):
    if not cond: problems.append('FEHLER: ' + msg)
    print('  ' + ('✓' if cond else '✗'), msg)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def shots(name):
    """Verzeichnis für Screenshots: $SHOTS oder ein neues temporäres."""
    d = os.environ.get('SHOTS') or tempfile.mkdtemp(prefix=f'handelsinseln-{name}-')
    os.makedirs(d, exist_ok=True)
    return d


def wait_port(port, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            socket.create_connection(('127.0.0.1', port), timeout=0.5).close(); return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError(f'Port {port} antwortet nicht')


def wait_until(cond, timeout=10, step=0.1):
    """Wartet, bis cond() wahr ist (statt fester Pausen); gibt das letzte Ergebnis zurück."""
    t0 = time.time()
    while True:
        try:
            ok = cond()
        except Exception:
            ok = False
        if ok or time.time() - t0 > timeout: return ok
        time.sleep(step)


def start_server(port=None, **env):
    """Startet server/server.js mit eigenem Port und Datenverzeichnis (https aus, falls nicht anders gesetzt).
    Kehrt zurück, sobald der Server antwortet: (Prozess, Basis-URL)."""
    port = port or free_port()
    e = dict(os.environ, PORT=str(port), DATA_DIR=tempfile.mkdtemp(prefix='handelsinseln-data-'), HTTPS_PORT='0')
    e.update({k: str(v) for k, v in env.items()})
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.js')], env=e)
    wait_port(port)
    if e['HTTPS_PORT'] != '0': wait_port(int(e['HTTPS_PORT']))
    return proc, f'http://127.0.0.1:{port}'


def poster(base):
    """post(pfad, daten) → JSON-Antwort; bei HTTP-Fehlern mit '_status'."""
    def post(path, body):
        req = urllib.request.Request(base + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
        try:
            return json.load(urllib.request.urlopen(req))
        except urllib.error.HTTPError as e:
            j = json.load(e); j['_status'] = e.code; return j
    return post


def get_json(base, path):
    return json.load(urllib.request.urlopen(base + path))


def sse_event(base, token, want='state', query='', timeout=10):
    """Liest den Ereignisstrom bis zum ersten Ereignis `want` und gibt dessen Daten zurück."""
    r = urllib.request.urlopen(base + '/api/events?token=' + token + query, timeout=timeout)
    ev = None
    try:
        while True:
            line = r.readline().decode()
            if line.startswith('event:'): ev = line[6:].strip()
            elif line.startswith('data:') and ev == want: return json.loads(line[5:])
    finally:
        r.close()


def finish(shots_dir=None, ok_msg=None):
    """Ergebnis ausgeben und mit 0 (keine Probleme) bzw. 1 beenden."""
    if shots_dir: print('Screenshots:', shots_dir)
    print('Probleme:', 'keine' if not problems else '\n' + '\n'.join(problems))
    if not problems and ok_msg: print(ok_msg)
    sys.exit(1 if problems else 0)
