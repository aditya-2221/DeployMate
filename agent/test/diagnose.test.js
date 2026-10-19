
import test from "node:test";
import assert from "node:assert/strict";

import { diagnose } from "../src/diagnostics/diagnose.js";

function makeDiscovery(overrides = {}) {
  return {
    root: "/example",
    components: [],
    warnings: [],
    ...overrides,
  };
}

test("returns no findings for clean discovery and passing checks", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery({
      components: [{ path: ".", type: "root" }],
    }),
    executionResults: [
      {
        component: ".",
        type: "test",
        status: "passed",
        exitCode: 0,
      },
    ],
  });

  assert.deepEqual(findings, []);
});

test("preserves discovery warnings as structured findings", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery({
      warnings: ["Conflicting package-manager lockfiles."],
    }),
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "DISCOVERY_WARNING");
  assert.equal(findings[0].severity, "warning");
  assert.equal(
    findings[0].evidence.warning,
    "Conflicting package-manager lockfiles.",
  );
});

test("treats unavailable checks as informational", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    checks: [
      {
        component: "backend",
        type: "typecheck",
        status: "unavailable",
      },
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "CHECK_UNAVAILABLE");
  assert.equal(findings[0].severity, "info");
});

test("distinguishes timeout from check failure", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    executionResults: [
      {
        component: "backend",
        type: "test",
        status: "timed_out",
        exitCode: null,
        error: {
          code: "CHECK_TIMEOUT",
          message: "Execution exceeded the configured timeout.",
        },
      },
      {
        component: "frontend",
        type: "build",
        status: "failed",
        exitCode: 1,
        error: null,
      },
    ],
  });

  assert.equal(findings[0].code, "CHECK_TIMED_OUT");
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[1].code, "CHECK_FAILED");
  assert.equal(findings[1].severity, "error");
});

test("reports policy denial separately from execution failure", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    policyDecisions: [
      {
        check: {
          component: "backend",
          type: "test",
          script: "test",
        },
        decision: {
          decision: "blocked",
          code: "NETWORK_ACCESS_DENIED",
          reason: "Network access is disabled.",
          profile: "restricted",
        },
      },
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "POLICY_BLOCKED");
  assert.equal(findings[0].category, "policy");
  assert.equal(
    findings[0].evidence.code,
    "NETWORK_ACCESS_DENIED",
  );
});

test("reports required approval without treating it as a code defect", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    policyDecisions: [
      {
        check: { component: ".", type: "test" },
        decision: {
          decision: "requires_approval",
          code: "PROJECT_NOT_TRUSTED",
          reason: "Automatic execution is disabled.",
        },
      },
    ],
  });

  assert.equal(findings[0].code, "POLICY_APPROVAL_REQUIRED");
  assert.equal(findings[0].severity, "warning");
});

test("rejects malformed top-level inputs", () => {
  assert.throws(
    () => diagnose({ discoveryResult: null }),
    /discoveryResult must contain/,
  );

  assert.throws(
    () =>
      diagnose({
        discoveryResult: makeDiscovery(),
        executionResults: {},
      }),
    /executionResults must be an array/,
  );
});
