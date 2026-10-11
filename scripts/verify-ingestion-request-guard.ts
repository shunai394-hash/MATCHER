import { guardIngestionRequest } from "../lib/matcher/ingestion/request-guard.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function request(origin: string | null, ip: string, fetchSite = "same-origin"): Request {
  const headers = new Headers({ "x-forwarded-for": `203.0.113.5, ${ip}`, "sec-fetch-site": fetchSite });
  if (origin) headers.set("origin", origin);
  return new Request("https://matcher.example/api/ingestion/scan", { method: "POST", headers });
}

const originState = new Map();
assert(guardIngestionRequest(request("https://evil.example", "198.51.100.1"), 1_000, originState).ok === false, "cross-origin request must be rejected");
assert(guardIngestionRequest(request(null, "198.51.100.2"), 1_000, originState).ok === false, "missing Origin must be rejected");
assert(guardIngestionRequest(request("https://matcher.example", "198.51.100.3", "cross-site"), 1_000, originState).ok === false, "cross-site fetch must be rejected");

const state = new Map();
const first = guardIngestionRequest(request("https://matcher.example", "198.51.100.4"), 1_000, state);
assert(first.ok, "same-origin request should pass");
const concurrent = guardIngestionRequest(request("https://matcher.example", "198.51.100.4"), 1_001, state);
assert(!concurrent.ok && concurrent.code === "SCAN_ALREADY_RUNNING", "concurrent scan should be rejected");
first.release();
const second = guardIngestionRequest(request("https://matcher.example", "198.51.100.4"), 1_002, state);
assert(second.ok, "second request should pass after release");
second.release();
const third = guardIngestionRequest(request("https://matcher.example", "198.51.100.4"), 1_003, state);
assert(third.ok, "third request should pass within limit");
third.release();
const fourth = guardIngestionRequest(request("https://matcher.example", "198.51.100.4"), 1_004, state);
assert(!fourth.ok && fourth.code === "SCAN_RATE_LIMITED", "fourth request in window should be rate limited");
const afterWindow = guardIngestionRequest(request("https://matcher.example", "198.51.100.4"), 302_000, state);
assert(afterWindow.ok, "request after rate-limit window should pass");
afterWindow.release();
console.log("MATCHER ingestion request guard verification: PASS");
