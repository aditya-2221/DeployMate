
import { discoverPackages } from "./discovery/discoverPackages.js";
import { discoverChecks } from "./checks/discoverChecks.js";
import { discoverOperationalScripts } from "./checks/discoverOperationalScripts.js";
import { printReport } from "./report.js";

const targetPath = process.argv[2];

if (!targetPath) {
  console.error('Usage: npm run dev -- "C:\\path\\to\\your\\project"');
  process.exitCode = 1;
} else {
  try {
    const result = await discoverPackages(targetPath);
    const checks = discoverChecks(result);
    const operationalScripts = discoverOperationalScripts(result);

    printReport(result, checks, operationalScripts);
  } catch (error) {
    console.error("Discovery failed:", error.message);
    process.exitCode = 1;
  }
}
