/**
 * LOCAL DEVELOPMENT ONLY — never expose this to a network you do not control.
 *
 * Serves `public/` with an SPA fallback, as a stand-in for `mc-scripts serve`, whose port is hardcoded
 * (`dist/serve-*.js`: `const DEFAULT_PORT = 3001`, no env var and no CLI flag) so it cannot run beside
 * the `mc` application. Beyond static files, `mc-scripts serve` adds only the `/login*` and `/logout*`
 * handlers, and in production those belong to the Merchant Center host — a Custom View is plain static
 * content on its own origin.
 *
 * The index.html fallback is what makes it usable at all: the MC loads the view in an iframe at
 * `/custom-views/<viewId>/projects/<projectKey>`, which is a client-side route of the shell, not a file.
 *
 *   node serve-static.js [port] [host]      (defaults: 3002, 127.0.0.1)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2] ?? process.env.HTTP_PORT ?? 3002);
// Loopback by default: this server has no auth, no rate limit and serves whatever `public/` holds, so
// reaching it must be a deliberate act. Pass a host (or HTTP_HOST) to widen it.
const host = process.argv[3] ?? process.env.HTTP_HOST ?? '127.0.0.1';
const root = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const indexHtml = path.join(root, 'index.html');

/**
 * The file a request resolves to inside `public/`, or `undefined` when it resolves to nothing there.
 *
 * Containment is checked on the REAL path and against `root + sep`, which is the whole point:
 * `startsWith(root)` alone is a string prefix, so `/../public-secret/x` — which normalises to a SIBLING
 * of `public/` — would pass it, and a symlink inside `public/` pointing at `../.env` would be followed
 * without `realpath`. Both are the same class of escape and both are closed here.
 */
function resolveFile(urlPath) {
  const candidate = path.resolve(
    root,
    `.${path.posix.normalize(`/${urlPath}`)}`
  );
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return undefined;
  }
  if (real !== root && !real.startsWith(root + path.sep)) {
    return undefined;
  }
  return fs.statSync(real).isFile() ? real : undefined;
}

http
  .createServer((req, res) => {
    // A malformed escape (`GET /%`) throws URIError, and an exception thrown synchronously in a request
    // listener takes the whole process down — one request would stop the server.
    let urlPath;
    try {
      urlPath = decodeURIComponent(
        new URL(req.url ?? '/', 'http://localhost').pathname
      );
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request URI');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }

    // A real file is served as itself; anything else falls back to the shell, which owns the routing.
    const file = resolveFile(urlPath) ?? indexHtml;
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found — run `npm run build` first');
      return;
    }

    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, host, () =>
    console.log(`mc-view public/ on http://${host}:${port} (SPA fallback on)`)
  );
