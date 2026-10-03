// Maps Supabase's /rest/v1/* URL layout onto a bare PostgREST server so supabase-js works unchanged.
import http from "node:http";

const [listenPort, targetPort] = process.argv.slice(2).map(Number);
http.createServer((req, res) => {
  const path = req.url.startsWith("/rest/v1") ? req.url.slice("/rest/v1".length) || "/" : req.url;
  const upstream = http.request({ host: "127.0.0.1", port: targetPort, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (error) => { res.writeHead(502); res.end(String(error)); });
  req.pipe(upstream);
}).listen(listenPort, "127.0.0.1");
