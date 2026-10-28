import * as cheerio from "cheerio";

type CheckResult = {
  name: string;
  pass: boolean;
  detail: string;
};

function checkViewport(html: string): CheckResult {
  const $ = cheerio.load(html);
  const found = $('meta[name="viewport"]').length > 0;

  return {
    name: "viewport",
    pass: found,
    detail: found
      ? "viewport tag found"
      : "missing viewport tag (bad on mobile)",
  };
}

function checkTitle(html: string): CheckResult {
  const $ = cheerio.load(html);
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

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.log("Usage: npx tsx audit.ts <url>");
    return;
  }

  const res = await fetch(url);
  const html = await res.text();

  const results = [checkViewport(html), checkTitle(html)];

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
  }
}

main();
