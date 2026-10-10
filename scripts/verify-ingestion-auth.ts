import { createIngestionSessionValue, hasIngestionSession, ingestionTokenConfigured, matchesIngestionToken } from "../lib/matcher/ingestion/auth.ts";

const token = "test-only-ingestion-token-that-is-at-least-32-chars";
process.env.MATCHER_INGESTION_ADMIN_TOKEN = token;
if (!ingestionTokenConfigured()) throw new Error("valid configured token was rejected");
if (!matchesIngestionToken(token)) throw new Error("valid token was rejected");
if (matchesIngestionToken("incorrect-token")) throw new Error("incorrect token was accepted");
const session = createIngestionSessionValue(token);
const request = new Request("https://matcher.example/api/ingestion/scan", {
  headers: { cookie: `matcher_ingestion_session=${session}` },
});
if (!hasIngestionSession(request)) throw new Error("valid session cookie was rejected");
const badRequest = new Request("https://matcher.example/api/ingestion/scan", {
  headers: { cookie: "matcher_ingestion_session=not-a-valid-session" },
});
if (hasIngestionSession(badRequest)) throw new Error("invalid session cookie was accepted");
process.env.MATCHER_INGESTION_ADMIN_TOKEN = "short";
if (ingestionTokenConfigured()) throw new Error("short token must not be configured");
if (hasIngestionSession(request)) throw new Error("session must fail when token configuration is invalid");
console.log("verify:ingestion-auth PASS");
