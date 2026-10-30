import * as cheerio from "cheerio";

type Page = cheerio.CheerioAPI;

type CheckResult = {
  name: string;
  pass: boolean;
  detail: string;
};

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

async function main() {
  let url = process.argv[2];

  if (!url) {
    console.log("Usage: npx tsx audit.ts <url>");
    return;
  }
  if (!url.startsWith("https")) url = "https://" + url;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "store-audit/0.1" },
    });

    if (!res.ok) {
      console.log(`Could not load page: HTTP ${res.status}`);
      return;
    }
    html = await res.text();
  } catch {
    console.log("Could not reach the site. Check the URL and your connection.");
    return;
  }

  const $ = cheerio.load(html);

  const results = [
    checkViewport($),
    checkTitle($),
    checkH1($),
    checkImageAlt($),
  ];

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
  }
}

main();
