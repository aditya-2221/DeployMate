
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const reportUrl = new URL("../src/report.js", import.meta.url);

test("prints available checks and marks them as not run", () => {
  const script = `
    import { printReport } from ${JSON.stringify(reportUrl.href)};

    printReport(
      {
        root: "C:/sample",
        packageManager: { manager: "npm" },
        components: [
          {
            path: "frontend",
            type: "frontend",
            name: "sample-frontend",
            packageFile: "frontend/package.json",
            scripts: { build: "vite build" },
            packageManager: { manager: "npm" }
          }
        ],
        warnings: []
      },
      [
        {
          component: "frontend",
          type: "build",
          status: "available",
          script: "build",
          command: "vite build"
        }
      ]
    );
  `;

  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Check Inventory:/);
  assert.match(result.stdout, /\[AVAILABLE\] build: build/);
  assert.match(result.stdout, /Execution status: NOT RUN/);
});

test("reports when no checks are discovered", () => {
  const script = `
    import { printReport } from ${JSON.stringify(reportUrl.href)};
    printReport(
      {
        root: "C:/sample",
        components: [],
        warnings: []
      },
      []
    );
  `;

  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No checks discovered/);
});
