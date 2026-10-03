// E2E only. Maps Supabase's /rest/v1/* URL layout onto a bare PostgREST server so supabase-js works
// unchanged, and stands in for Supabase Auth's GET /auth/v1/user (GoTrue is not part of the local
// stack). Test tokens look like "e2e.<base64url({id,email,matcher_role?})>.sig"; anything else is 401,
// exactly like an invalid or expired Supabase access token.
import http from "node:http";

const [listenPort, targetPort] = process.argv.slice(2).map(Number);

function authUser(req, res) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const [prefix, payload] = token.split(".");
  let claims = null;
  try { claims = prefix === "e2e" ? JSON.parse(Buffer.from(payload, "base64url").toString()) : null; } catch { claims = null; }
  if (!claims?.id || !claims?.email) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT: unable to parse or verify signature" }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    id: claims.id, aud: "authenticated", role: "authenticated", email: claims.email,
    app_metadata: claims.matcher_role ? { provider: "email", matcher_role: claims.matcher_role } : { provider: "email" },
    user_metadata: {}, created_at: "2026-10-01T00:00:00Z",
  }));
}

http.createServer((req, res) => {
  if (req.url.startsWith("/auth/v1/user")) return authUser(req, res);
  const path = req.url.startsWith("/rest/v1") ? req.url.slice("/rest/v1".length) || "/" : req.url;
  const upstream = http.request({ host: "127.0.0.1", port: targetPort, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (error) => { res.writeHead(502); res.end(String(error)); });
  req.pipe(upstream);
}).listen(listenPort, "127.0.0.1");
