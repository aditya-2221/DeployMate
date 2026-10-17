
import test from "node:test";
import assert from "node:assert/strict";
import { discoverChecks } from "../src/checks/discoverChecks.js";

test("discovers available lint and build checks", () => {
  const result = discoverChecks({
    components: [
      {
        path: "frontend",
        scripts: {
          lint: "eslint .",
          build: "vite build",
        },
      },
    ],
  });

  assert.equal(
    result.find((check) => check.type === "lint").status,
    "available"
  );

  assert.equal(
    result.find((check) => check.type === "build").status,
    "available"
  );
});

test("marks missing checks as unavailable", () => {
  const result = discoverChecks({
    components: [
      {
        path: "backend",
        scripts: {
          start: "node src/index.js",
        },
      },
    ],
  });

  assert.equal(
    result.find((check) => check.type === "test").status,
    "unavailable"
  );
});

test("preserves the declared command without executing it", () => {
  const result = discoverChecks({
    components: [
      {
        path: "frontend",
        scripts: {
          lint: "eslint .",
        },
      },
    ],
  });

  const lintCheck = result.find((check) => check.type === "lint");

  assert.equal(lintCheck.script, "lint");
  assert.equal(lintCheck.command, "eslint .");
});
