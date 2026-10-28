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

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.log("Usage: npx tsx audit.ts <url>");
    return;
  }

  const res = await fetch(url);
  const html = await res.text();

  const results = [checkViewport(html)];

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
  }
}

main();
