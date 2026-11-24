// Mini-Server fuer Mock-Tests: node tests/mock/serve.js  (Port 8099)
// Liefert public/ unter /, shared/ unter /shared/ und tests/mock/ unter /tests/mock/ aus.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  let file;
  if (u.startsWith('/shared/') || u.startsWith('/tests/mock/')) file = path.join(root, u);
  else file = path.join(root, 'public', u);
  if (!path.resolve(file).startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(+process.argv[2] || 8099, function () { console.log('Mock-Server auf http://localhost:' + this.address().port); });
