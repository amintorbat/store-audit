/**
 * audit-core: the engine of store-audit. It never prints and never reads files,
 * so both the CLI (cli.ts) and the web page (api/audit.ts) can reuse it.
 *
 * Structure (top to bottom):
 *  1. Types + severity table
 *  2. Helpers: normalizeUrl, hostOf, explainError
 *  3. Checks: one function per rule, each returns CheckResult
 *  4. AI readiness: robots.txt parsing, fetchRobots, checkAiCrawlers
 *  5. topFixes + runAudit (fetch, run checks, return AuditReport)
 *
 * Done: 7 checks, timeout + readable errors, severity + top fixes, redirect flag
 *
 * TODO (P1 = before the Nov 9 event, P2 = if time, P3 = after):
 *  - P1 step 1: Vercel function api/audit.ts + simple page (input, score, fixes)
 *  - P1 step 2: block private/internal URLs before publishing the page
 *  - P1 step 3: scan 10-15 real small stores, pick 3 reports to show
 *  - P3 step 4: Playwright render, PageSpeed Insights, content freshness checks
 */

import * as cheerio from "cheerio";
import { readFileSync } from "node:fs";

type Page = cheerio.CheerioAPI;

type CheckResult = {
  name: string;
  pass: boolean;
  detail: string;
};

type AuditReport = {
  url: string;
  finalUrl: string;
  results: CheckResult[];
  passed: number;
  topFixes: CheckResult[];
};

type Severity = "high" | "medium" | "low";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

// Policy lives in one table so it is easy to tune after real feedback (my judgment, not a standard).
const SEVERITY: Record<string, Severity> = {
  viewport: "high", // broken on phones = lost sales
  "AI crawlers": "high", // invisible to AI search answers
  title: "medium",
  h1: "medium",
  "product schema": "medium",
  "meta description": "low",
  "image alt": "low",
};

// Answer engines: blocking them means no citations. Training bots: blocking is a legit choice.
const AI_SEARCH_BOTS = ["OAI-SearchBot", "PerplexityBot"];
const AI_TRAINING_BOTS = ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot"];

function normalizeUrl(input: string): string {
  return /^https?:\/\//i.test(input) ? input : "https://" + input;
}

function checkViewport($: Page): CheckResult {
  const found = $('meta[name="viewport"]').length > 0;

  return {
    name: "viewport",
    pass: found,
    detail: found
      ? "viewport tag found"
      : "missing viewport tag (bad on mobile)",
  };
}

function checkTitle($: Page): CheckResult {
  const title = $("title").first().text().trim();
  const len = title.length;

  if (len === 0) {
    return { name: "title", pass: false, detail: "missing the title tag" };
  }

  const ok = len >= 30 && len <= 60;

  return {
    name: "title",
    pass: ok,
    detail: ok
      ? `title length OK (${len} chars)`
      : `title is ${len} chars; aim for 30-60`,
  };
}

function checkH1($: Page): CheckResult {
  const count = $("h1").length;

  return {
    name: "h1",
    pass: count === 1,
    detail:
      count === 1
        ? "exactly one h1"
        : `found ${count} h1 tags; use exactly one`,
  };
}

function checkImageAlt($: Page): CheckResult {
  const imgs = $("img");
  const total = imgs.length;
  if (total === 0) {
    return { name: "image alt", pass: true, detail: "no images found" };
  }
  const missing = imgs.filter(
    (_, el) => $(el).attr("alt") === undefined,
  ).length;

  return {
    name: "image alt",
    pass: missing === 0,
    detail:
      missing === 0
        ? `all ${total} images have alt`
        : `${missing} of ${total} images missing alt`,
  };
}

function checkMetaDescription($: Page): CheckResult {
  const desc = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const len = desc.length;

  if (len === 0) {
    return {
      name: "meta description",
      pass: false,
      detail: "missing meta description",
    };
  }

  const ok = len >= 70 && len <= 160;
  return {
    name: "meta description",
    pass: ok,
    detail: ok ? `length OK (${len} chars)` : `${len} chars; aim for 70-160`,
  };
}

function checkProductSchema($: Page): CheckResult {
  const found = $('script[type="application/ld+json"]')
    .toArray()
    .some((el) => {
      try {
        return JSON.stringify(JSON.parse($(el).text())).includes('"Product"');
      } catch {
        return false;
      }
    });

  return {
    name: "product schema",
    pass: found,
    detail: found
      ? "Product structured data found"
      : "no Product structured data (only matters on product pages)",
  };
}

function readStores(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

// Turns Node's vague "fetch failed" into a sentence an owner can act on.
function explainError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } };
  const code = err.cause?.code;

  if (err.name === "TimeoutError") return "site took too long (over 10s)";
  if (code === "ENOTFOUND") return "domain not found (check the spelling)";
  if (code) return `network error (${code})`;
  return err.message;
}

// Simplified parser: groups User-agent lines with their Disallow rules.
// Limitation: ignores "Allow" lines, so partial blocks may be over-reported.
function parseRobots(text: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  let agents: string[] = [];
  let sawRule = false;
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (sawRule) {
        agents = [];
        sawRule = false;
      }
      const a = val.toLowerCase();
      agents.push(a);
      if (!groups.has(a)) groups.set(a, []);
    } else if (key === "disallow" || key === "allow") {
      sawRule = true;
      if (key === "disallow") for (const a of agents) groups.get(a)!.push(val);
    }
  }
  return groups;
}

// A bot's own group wins; otherwise the "*" group applies.
function isBlocked(groups: Map<string, string[]>, bot: string): boolean {
  const rules = groups.get(bot.toLowerCase()) ?? groups.get("*") ?? [];
  return rules.includes("/");
}

function checkAiCrawlers(robots: string | null): CheckResult {
  if (robots === null) {
    return {
      name: "AI crawlers",
      pass: true,
      detail: "no robots.txt (nothing blocked)",
    };
  }
  const groups = parseRobots(robots);
  const blockedSearch = AI_SEARCH_BOTS.filter((b) => isBlocked(groups, b));
  const blockedTraining = AI_TRAINING_BOTS.filter((b) => isBlocked(groups, b));

  if (blockedSearch.length > 0) {
    return {
      name: "AI crawlers",
      pass: false,
      detail: `robots.txt blocks AI search bots (${blockedSearch.join(", ")}): pages can't be cited by ChatGPT search / Perplexity`,
    };
  }
  return {
    name: "AI crawlers",
    pass: true,
    detail: blockedTraining.length
      ? `AI search bots allowed; training bots blocked (${blockedTraining.join(", ")}), fine if intentional`
      : "AI search bots allowed",
  };
}

function topFixes(results: CheckResult[], n = 3): CheckResult[] {
  return results
    .filter((r) => !r.pass) // filter returns a new array, so sort won't touch the original
    .sort(
      (a, b) =>
        WEIGHT[SEVERITY[b.name] ?? "low"] - WEIGHT[SEVERITY[a.name] ?? "low"],
    )
    .slice(0, n);
}

// Returns data only (no console.log) so a web page can reuse this later.
async function runAudit(input: string): Promise<AuditReport> {
  const url = normalizeUrl(input);
  const res = await fetch(url, {
    headers: { "User-Agent": "store-audit/0.1" },
    signal: AbortSignal.timeout(10_000),
  });

  const isProductPage = /\/products?\//i.test(res.url);

  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const $ = cheerio.load(body);
  const results: CheckResult[] = [
    checkViewport($),
    checkTitle($),
    checkH1($),
    checkImageAlt($),
    checkMetaDescription($),
  ];

  const robots = await fetchRobots(new URL(res.url).origin);
  if (isProductPage) results.push(checkProductSchema($));

  results.push(checkAiCrawlers(robots));

  return {
    url,
    finalUrl: res.url,
    results,
    passed: results.filter((r) => r.pass).length,
    topFixes: topFixes(results),
  };
}

async function runBatch(path: string) {
  for (const site of readStores(path)) {
    try {
      const rep = await runAudit(site);
      const failed = rep.results.filter((r) => !r.pass).map((r) => r.name);
      console.log(
        `${site} | ${rep.passed}/${rep.results.length} | fails: ${failed.join(", ") || "none"}`,
      );
    } catch (e) {
      console.log(`${site} | ERROR: ${explainError(e)}`);
    }
    await sleep(1500);
  }
}

async function fetchRobots(origin: string): Promise<string | null> {
  try {
    const res = await fetch(origin + "/robots.txt", {
      headers: { "User-Agent": "store-audit/0.1" },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// Strips "www." so kith.com <-> www.kith.com is not flagged as a redirect.
function hostOf(u: string): string {
  return new URL(u).hostname.replace(/^www\./, "");
}

async function main() {
  const input = process.argv[2];

  if (!input) {
    console.log("Usage: npx tsx audit.ts <url>");
    return;
  }

  if (input === "--batch") {
    await runBatch(process.argv[3] ?? "stores.txt");
    return;
  }

  try {
    const report = await runAudit(input);
    console.log(`Audited: ${report.finalUrl}`);

    if (hostOf(report.finalUrl) !== hostOf(report.url)) {
      console.log(
        `Warning: redirected from ${hostOf(report.url)} to ${hostOf(report.finalUrl)}; results may be for a different page.`,
      );
    }
    for (const r of report.results) {
      console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
    }
    console.log(`Score: ${report.passed}/${report.results.length} passed`);

    if (report.topFixes.length > 0) {
      console.log("Fix first:");
      for (const f of report.topFixes)
        console.log(`  - ${f.name}: ${f.detail}`);
    }
  } catch (e) {
    console.log(`Could not audit site: ${explainError(e)}`);
  }
}

main();
