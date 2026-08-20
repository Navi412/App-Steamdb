const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { openDatabase } = require('../db/connection');
const { migrate } = require('../db/migrate');
const { createRouter } = require('./router');
const { registerGameRoutes } = require('./routes/games');

const PORT = process.env.PORT || 3000;
const UI_DIR = path.join(__dirname, '..', 'ui');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const urlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(UI_DIR, urlPath);
  const relative = path.relative(UI_DIR, filePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, contents) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(contents);
  });
}

function createServer() {
  const db = openDatabase();
  migrate(db);

  const router = createRouter();
  registerGameRoutes(router, db);

  return http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const dbOk = db.prepare('SELECT 1 AS ok').get().ok === 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', db: dbOk ? 'ok' : 'error' }));
      return;
    }

    const handled = await router.handle(req, res);
    if (!handled) serveStatic(req, res);
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`SteamDB escuchando en http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
