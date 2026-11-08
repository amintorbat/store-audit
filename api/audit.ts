import { runAudit, explainError } from "../audit-core";

/**
 * Vercel function: GET /api/audit?url=...
 * Simple in-memory rate limit: 10 audits per minute per IP.
 * Limit: memory is per server instance, so it slows abuse but doesn't stop it (P2: shared store).
 */
const hits = new Map<string, number[]>();
const LIMIT = 10;
const WINDOW_MS = 60_000;

function tooMany(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return recent.length > LIMIT;
}

export default {
  async fetch(request: Request) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (tooMany(ip)) {
      return Response.json({ error: "Too many audits, wait a minute and retry" }, { status: 429 });
    }

    const url = new URL(request.url).searchParams.get("url")?.trim();

    if (!url || url.length > 300) {
      return Response.json(
        { error: "Enter a store URL (up to 300 characters)" },
        { status: 400 },
      );
    }

    try {
      return Response.json(await runAudit(url));
    } catch (e) {
      return Response.json({ error: explainError(e) }, { status: 502 });
    }
  },
};
