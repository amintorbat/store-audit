/**
 * safe-fetch: fetches a URL only if it is a public website, checking every redirect hop.
 * Known limit: DNS is checked before fetch, so a hostile DNS "rebinding" trick is not fully covered.
 */

import { lookUp } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivetIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local, includes cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    );
  }

  const v = ip.toLowerCase();

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, includes cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  );
}

async function assertPublicUrl(raw: string): Promise<void> {
  const url = new URL(raw); // the parser also normalizes tricks like 0x7f.1 -> 127.0.0.1
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https addresses are allowed");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const blockedName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal");
  if (blockedName) throw new Error("That address isn't a public website");

  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error("That address isn't a public website");
  }
}

// Follows redirects by hand (max 5) so every hop is checked, not only the first URL.
export async function safeFetch(startUrl: string): Promise<{ res: Response; finalUrl: string }> {
  let current = startUrl;

  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);

    const res = await fetch(current, {
      headers: { "User-Agent": "store-audit/0.1" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel(); // free the connection of the redirect response
      current = new URL(location, current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error("Too many redirects");
}
