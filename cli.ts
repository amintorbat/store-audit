/**
 * cli.ts: terminal front end for audit-core.
 * Usage: npx tsx cli.ts <url> [--json]   |   npx tsx cli.ts --batch [stores.txt]
 */
import { readFileSync } from "node:fs";
import { runAudit, explainError } from "./audit-core";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readStores(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

// Sequential on purpose: polite to other people's servers, one failure never stops the rest.
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

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const batch = args.includes("--batch");
  const positional = args.filter((a) => !a.startsWith("--"));

  if (batch) {
    await runBatch(positional[0] ?? "stores.txt");
    return;
  }
  if (!positional[0]) {
    console.log("Usage: npx tsx cli.ts <url> [--json] | --batch [file]");
    return;
  }

  try {
    const report = await runAudit(positional[0]);

    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Audited: ${report.finalUrl}`);
    if (report.redirected) {
      console.log(
        `Warning: redirected from ${report.url} to ${report.finalUrl}; results may be for a different page.`,
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
