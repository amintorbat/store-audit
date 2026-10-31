/**
 * store-audit: CLI that audits one ecommerce page (SEO and mobile basics).
 *
 * Structure (top to bottom):
 *  1. Types: CheckResult, AuditReport
 *  2. Helpers: normalizeUrl, hostOf
 *  3. Checks: one function per rule, each takes cheerio ($) and returns CheckResult
 *  4. runAudit(url): fetch + run all checks, returns AuditReport (never prints)
 *  5. main(): read argv, call runAudit, print the report
 *
 * Done: viewport, title, h1, image alt, meta description, product schema,
 *       error handling, redirect warning, final URL, all 6 checks registered
 *       (h1 count on example.com verified with the browser: tool was right)
 *
 * TODO (P1 = needed before the Nov 9 event, P3 = after):
 *  - P1 step 1: product schema only on /products/ pages (no unfair FAILs)
 *  - P1 step 2: batch mode: read stores.txt, print one line per store
 *  - P1 step 3: scan 10 real small stores, collect results for the outreach
 *  - P2 step 4: add a --json flag to main so a web page can reuse the output
 *  - P2 step 5: simple Vercel page that calls runAudit and shows the report
 *  - P3 step 6: render JS-heavy pages with Playwright (fetch only sees raw HTML)
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
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// Returns data only (no console.log) so a web page can reuse this later.
async function runAudit(input: string): Promise<AuditReport> {
  const url = normalizeUrl(input);
  const res = await fetch(url, {
    headers: { "User-Agent": "store-audit/0.1" },
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

  if (isProductPage) results.push(checkProductSchema($));

  return {
    url,
    finalUrl: res.url,
    results,
    passed: results.filter((r) => r.pass).length,
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
      console.log(`${site} | ERROR: ${(e as Error).message}`);
    }
    await sleep(1500);
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
  } catch (e) {
    console.log(`Could not audit site: ${(e as Error).message}`);
  }
}

main();
