import * as cheerio from "cheerio";

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

async function runAudit(input: string): Promise<AuditReport> {
  const url = normalizeUrl(input);
  const res = await fetch(url, {
    headers: { "User-Agent": "store-audit/0.1" },
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const $ = cheerio.load(body);
  const results = [
    checkViewport($),
    checkTitle($),
    checkH1($),
    checkImageAlt($),
  ];
  return {
    url,
    finalUrl: res.url,
    results,
    passed: results.filter((r) => r.pass).length,
  };
}

function hostOf(u: string): string {
  return new URL(u).hostname.replace(/^www\./, "");
}

async function main() {
  const input = process.argv[2];

  if (!input) {
    console.log("Usage: npx tsx audit.ts <url>");
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
