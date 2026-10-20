
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
    checks: [
      {
        component: ".",
        type: "test",
        script: "test",
        status: "available",
      },
    ],
    executionResults: [
      {
        component: ".",
        type: "test",
        script: "test",
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
    checks: [
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "available",
      },
      {
        component: "frontend",
        type: "build",
        script: "build",
        status: "available",
      },
    ],
    executionResults: [
      {
        component: "backend",
        type: "test",
        script: "test",
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
        script: "build",
        status: "failed",
        exitCode: 1,
        error: null,
      },
    ],
  });

  assert.equal(findings.length, 2);

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
        check: {
          component: ".",
          type: "test",
          script: null,
        },
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

test("reports malformed execution results instead of silently ignoring them", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    executionResults: [null, "invalid-result", { component: "backend" }],
  });

  assert.equal(findings.length, 3);
  assert.ok(
    findings.every(
      (finding) => finding.code === "INVALID_EXECUTION_RESULT",
    ),
  );

  assert.deepEqual(
    findings.map((finding) => finding.evidence.index),
    [0, 1, 2],
  );
});

test("reports malformed policy entries instead of silently ignoring them", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    policyDecisions: [
      null,
      { check: { component: "backend" } },
      { decision: {} },
    ],
  });

  assert.equal(findings.length, 3);
  assert.ok(
    findings.every(
      (finding) => finding.code === "INVALID_POLICY_DECISION",
    ),
  );

  assert.deepEqual(
    findings.map((finding) => finding.evidence.index),
    [0, 1, 2],
  );
});


test("rejects policy decisions with missing check identity", () => {
  const findings = diagnose({
    discoveryResult: {
      components: [],
      warnings: [],
    },
    checks: [],
    executionResults: [],
    policyDecisions: [
      {
        check: {},
        decision: {
          decision: "blocked",
          code: "POLICY_BLOCKED",
          reason: "Blocked by policy.",
        },
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.code === "INVALID_POLICY_DECISION",
    ),
  );
});


test("reports a passed result with a non-zero exit code as invalid", () => {
  const findings = diagnose({
    discoveryResult: {
      components: [],
      warnings: [],
    },
    checks: [],
    executionResults: [
      {
        component: ".",
        type: "test",
        script: "test",
        status: "passed",
        exitCode: 1,
      },
    ],
    policyDecisions: [],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "INVALID_EXECUTION_RESULT",
    ),
  );

  assert.ok(
    !findings.some((finding) => finding.code === "CHECK_FAILED"),
  );
});

test("reports a failed result with exit code zero as invalid", () => {
  const findings = diagnose({
    discoveryResult: {
      components: [],
      warnings: [],
    },
    checks: [],
    executionResults: [
      {
        component: ".",
        type: "test",
        script: "test",
        status: "failed",
        exitCode: 0,
      },
    ],
    policyDecisions: [],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "INVALID_EXECUTION_RESULT",
    ),
  );

  assert.ok(
    !findings.some((finding) => finding.code === "CHECK_FAILED"),
  );
});


test("flags execution results that do not match a discovered check", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery({
      components: [{ path: "backend", type: "application" }],
    }),
    checks: [
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "available",
      },
    ],
    executionResults: [
      {
        component: "frontend",
        type: "test",
        script: "test",
        status: "failed",
        exitCode: 1,
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "UNMATCHED_EXECUTION_RESULT",
    ),
  );
  assert.ok(
    !findings.some((finding) => finding.code === "CHECK_FAILED"),
  );
});

test("flags execution results for checks discovered as unavailable", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery({
      components: [{ path: "backend", type: "application" }],
    }),
    checks: [
      {
        component: "backend",
        type: "test",
        script: null,
        status: "unavailable",
      },
    ],
    executionResults: [
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "failed",
        exitCode: 1,
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "UNMATCHED_EXECUTION_RESULT",
    ),
  );
  assert.ok(
    !findings.some((finding) => finding.code === "CHECK_FAILED"),
  );
});


test("flags conflicting execution results for the same check", () => {
  const check = {
    component: "backend",
    type: "test",
    script: "test",
    status: "available",
  };

  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    checks: [check],
    executionResults: [
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "passed",
        exitCode: 0,
      },
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "failed",
        exitCode: 1,
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "CONFLICTING_EXECUTION_RESULTS",
    ),
  );
});


test("flags execution evidence that conflicts with a blocked policy decision", () => {
  const check = {
    component: "backend",
    type: "test",
    script: "test",
    status: "available",
  };

  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    checks: [check],
    executionResults: [
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "passed",
        exitCode: 0,
      },
    ],
    policyDecisions: [
      {
        check: {
          component: "backend",
          type: "test",
          script: "test",
        },
        decision: {
          decision: "blocked",
          code: "POLICY_DENIED",
          reason: "Execution was denied.",
        },
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "POLICY_EXECUTION_CONFLICT",
    ),
  );
});


test("flags duplicate identical execution results without calling them conflicting", () => {
  const check = {
    component: "backend",
    type: "test",
    script: "test",
    status: "available",
  };

  const result = {
    component: "backend",
    type: "test",
    script: "test",
    status: "passed",
    exitCode: 0,
  };

  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    checks: [check],
    executionResults: [result, { ...result }],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "DUPLICATE_EXECUTION_RESULT",
    ),
  );

  assert.ok(
    !findings.some(
      (finding) => finding.code === "CONFLICTING_EXECUTION_RESULTS",
    ),
  );
});


test("flags same-status results with different errors as conflicting", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    checks: [
      {
        component: ".",
        type: "test",
        script: "test",
        status: "available",
      },
    ],
    executionResults: [
      {
        component: ".",
        type: "test",
        script: "test",
        status: "failed",
        exitCode: 1,
        error: {
          code: "TEST_FAILURE_A",
          message: "The first test failed.",
        },
      },
      {
        component: ".",
        type: "test",
        script: "test",
        status: "failed",
        exitCode: 1,
        error: {
          code: "TEST_FAILURE_B",
          message: "The second test failed.",
        },
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) =>
        finding.code === "CONFLICTING_EXECUTION_RESULTS",
    ),
  );
});


test("rejects a passing result with missing check identity fields", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    checks: [
      {
        status: "available",
      },
    ],
    executionResults: [
      {
        status: "passed",
        exitCode: 0,
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "INVALID_EXECUTION_RESULT",
    ),
  );

  assert.ok(
    !findings.some((finding) => finding.code === "CHECK_FAILED"),
  );
});

test("reports an unknown execution status for a matched check", () => {
  const findings = diagnose({
    discoveryResult: makeDiscovery(),
    checks: [
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "available",
      },
    ],
    executionResults: [
      {
        component: "backend",
        type: "test",
        script: "test",
        status: "mystery",
        exitCode: null,
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "UNKNOWN_EXECUTION_STATUS",
    ),
  );
});

test("reports an unknown policy decision", () => {
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
          decision: "unrecognized_decision",
        },
      },
    ],
  });

  assert.ok(
    findings.some(
      (finding) => finding.code === "UNKNOWN_POLICY_DECISION",
    ),
  );
});
