import http from 'http';
import serveStatic from 'serve-static';
import finalhandler from 'finalhandler';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const filename = fileURLToPath(import.meta.url);
const rootDir = join(dirname(filename), '..');

const servePublic = serveStatic(rootDir, { index: ['index.html'] });
const serveModules = serveStatic(join(rootDir, '../node_modules'), { redirect: false, index: [] });

const server = http.createServer((req, res) => {
  if (req.url != null && req.url.startsWith('/node_modules')) {
    req.url = req.url.replace('/node_modules', '');
    if (!req.url.startsWith('/')) req.url = '/';

    const done = (err?: any) => {
      if (req.url != null) {
        req.url = `/node_modules${req.url.startsWith('/') ? '' : '/'}${req.url}`;
      }
      finalhandler(req, res)(err);
    };

    serveModules(req, res, done);
  } else {
    servePublic(req, res, finalhandler(req, res));
  }
});

const port = 3000;
server.listen(3000);
console.log(`Started server on http://127.0.0.1:${port}/`);
