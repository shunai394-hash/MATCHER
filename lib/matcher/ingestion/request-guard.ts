const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;

type ClientWindow = { timestamps: number[]; inFlight: boolean };
type GuardState = Map<string, ClientWindow>;

const processState: GuardState = new Map();

export type IngestionGuardResult =
  | { ok: true; release: () => void }
  | { ok: false; status: 403 | 429; code: "SAME_ORIGIN_REQUIRED" | "SCAN_ALREADY_RUNNING" | "SCAN_RATE_LIMITED" };

function clientKey(request: Request): string {
  // Vercel appends the connecting client address to X-Forwarded-For.
  const forwarded = request.headers.get("x-forwarded-for");
  const clientAddress = forwarded?.split(",").map((value) => value.trim()).filter(Boolean).at(-1);
  return clientAddress || request.headers.get("x-real-ip") || "unknown-client";
}

export function guardIngestionRequest(
  request: Request,
  now = Date.now(),
  state: GuardState = processState,
): IngestionGuardResult {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    sameOrigin = Boolean(origin) && new URL(origin!).origin === new URL(request.url).origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    return { ok: false, status: 403, code: "SAME_ORIGIN_REQUIRED" };
  }

  const key = clientKey(request);
  const entry = state.get(key) ?? { timestamps: [], inFlight: false };
  entry.timestamps = entry.timestamps.filter((timestamp) => now - timestamp < WINDOW_MS);
  if (entry.inFlight) return { ok: false, status: 429, code: "SCAN_ALREADY_RUNNING" };
  if (entry.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    state.set(key, entry);
    return { ok: false, status: 429, code: "SCAN_RATE_LIMITED" };
  }

  entry.timestamps.push(now);
  entry.inFlight = true;
  state.set(key, entry);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const current = state.get(key);
      if (current) current.inFlight = false;
    },
  };
}
