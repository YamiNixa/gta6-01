// Porto Verde — tiny static server for local play-testing only.
// Serves game/ at http://localhost:8080 so the game can be opened in a
// desktop browser. Not part of the entry; the entry itself is static files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'game');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

createServer(async (req, res) => {
  try {
    const raw = (req.url ?? '/').split('?')[0];
    const path = raw === '/' || raw === '' ? '/index.html' : raw;
    const file = join(root, decodeURIComponent(path));
    if (!file.startsWith(root)) throw new Error('outside root');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8080, () => console.log('Porto Verde at http://localhost:8080'));
