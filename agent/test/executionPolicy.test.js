
import test from "node:test";
import assert from "node:assert/strict";

import {
  createExecutionPolicy,
  evaluateExecutionPolicy,
} from "../src/execution/policy.js";

const buildCheck = {
  component: "frontend",
  type: "build",
  status: "available",
  script: "build",
  command: "vite build",
};

function evaluate(overrides = {}) {
  return evaluateExecutionPolicy({
    check: buildCheck,
    ...overrides,
  });
}

test("defaults to restricted execution with safe permissions", () => {
  const policy = createExecutionPolicy();

  assert.equal(policy.profile, "restricted");
  assert.equal(policy.trustedProject, false);
  assert.equal(policy.networkAccess, "disabled");
  assert.equal(policy.allowSecrets, false);
  assert.equal(policy.limits.timeoutMs, 120_000);
});

test("requires approval for checks under the restricted profile", () => {
  const result = evaluate();

  assert.equal(result.decision, "requires_approval");
  assert.equal(result.code, "RESTRICTED_PROFILE_REQUIRES_APPROVAL");
});

test("allows supported checks for trusted projects under standard profile", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
    },
  });

  assert.equal(result.decision, "allowed");
  assert.equal(result.code, "TRUSTED_CHECK_ALLOWED");
});

test("requires approval for checks in an untrusted project", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: false,
    },
  });

  assert.equal(result.decision, "requires_approval");
  assert.equal(result.code, "PROJECT_NOT_TRUSTED");
});

test("blocks unavailable checks", () => {
  const result = evaluate({
    check: { ...buildCheck, status: "unavailable" },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "CHECK_UNAVAILABLE");
});

test("blocks malformed and unsupported checks", () => {
  const malformed = evaluate({ check: null });
  assert.equal(malformed.decision, "blocked");
  assert.equal(malformed.code, "INVALID_CHECK");

  const unsupported = evaluate({
    check: { ...buildCheck, type: "deploy-production" },
  });
  assert.equal(unsupported.decision, "blocked");
  assert.equal(unsupported.code, "UNSUPPORTED_CHECK_TYPE");
});

test("blocks check types excluded by the policy allowlist", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
      allowedCheckTypes: ["test"],
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "CHECK_TYPE_NOT_ALLOWED");
});

test("requires approval for operational scripts", () => {
  const result = evaluate({
    check: {
      component: "backend",
      type: "start",
      status: "available",
      script: "start",
      command: "node server.js",
    },
    policy: {
      profile: "standard",
      trustedProject: true,
    },
  });

  assert.equal(result.decision, "requires_approval");
  assert.equal(result.code, "OPERATIONAL_SCRIPT_REQUIRES_APPROVAL");
});

test("approval permits a supported operational script", () => {
  const result = evaluate({
    check: {
      component: "backend",
      type: "start",
      status: "available",
      script: "start",
      command: "node server.js",
    },
    approvalGranted: true,
  });

  assert.equal(result.decision, "allowed");
  assert.equal(result.code, "APPROVED");
});

test("approval cannot override denied network access", () => {
  const result = evaluate({
    approvalGranted: true,
    requestedCapabilities: { networkAccess: true },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "NETWORK_ACCESS_DENIED");
});

test("blocks secret access by default", () => {
  const result = evaluate({
    requestedCapabilities: { secrets: true },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "SECRET_ACCESS_DENIED");
});


test("blocks network access for the wrong purpose", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
      networkAccess: "dependency_install",
    },
    requestedCapabilities: {
      networkAccess: true,
      networkPurpose: "check",
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "NETWORK_PURPOSE_DENIED");
});

test("allows dependency-install network requests under the matching policy", () => {
  const result = evaluate({
    
    policy: {
    profile: "standard",
    trustedProject: true,
    networkAccess: "dependency_install",
    networkAllowlist: ["https://registry.npmjs.org"],
    },
    requestedCapabilities: {
    networkAccess: true,
    networkPurpose: "dependency_install",
    networkTargets: ["https://registry.npmjs.org/some-package"],
    },

  });

  assert.equal(result.decision, "allowed");
});

test("blocks destinations outside the configured origin allowlist", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
      networkAccess: "allowlist",
      networkAllowlist: ["https://registry.npmjs.org"],
    },
    requestedCapabilities: {
      networkAccess: true,
      networkTargets: ["https://example.com/package"],
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "NETWORK_TARGET_DENIED");
});


test("rejects invalid resource limits and policy values", () => {
  assert.throws(
    () => createExecutionPolicy({
      limits: { timeoutMs: -1 },
    }),
  );

  assert.throws(
    () => createExecutionPolicy({
      profile: "unrestricted",
    }),
  );
});

test("returns configured limits and permission metadata", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
      limits: {
        timeoutMs: 60_000,
        maxOutputBytes: 524_288,
        memoryMb: 512,
        cpuCount: 0.5,
        processLimit: 64,
      },
    },
  });

  assert.equal(result.limits.timeoutMs, 60_000);
  assert.equal(result.limits.memoryMb, 512);
  assert.equal(result.permissions.networkAccess, "disabled");
  assert.equal(result.permissions.allowSecrets, false);
});


test("blocks unrelated destinations during dependency installation", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
      networkAccess: "dependency_install",
      networkAllowlist: ["https://registry.npmjs.org"],
    },
    requestedCapabilities: {
      networkAccess: true,
      networkPurpose: "dependency_install",
      networkTargets: ["https://example.com/package"],
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "NETWORK_TARGET_DENIED");
});

test("blocks network access when no destination is requested", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
      networkAccess: "allowlist",
      networkAllowlist: ["https://registry.npmjs.org"],
    },
    requestedCapabilities: {
      networkAccess: true,
      networkTargets: [],
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "NETWORK_TARGET_REQUIRED");
});

test("rejects malformed network target URLs", () => {
  assert.throws(() =>
    evaluate({
      policy: {
        profile: "standard",
        trustedProject: true,
        networkAccess: "allowlist",
        networkAllowlist: ["https://registry.npmjs.org"],
      },
      requestedCapabilities: {
        networkAccess: true,
        networkTargets: ["not-a-valid-url"],
      },
    }),
  );
});

test("blocks network access when the allowlist is empty", () => {
  const result = evaluate({
    policy: {
      profile: "standard",
      trustedProject: true,
      networkAccess: "allowlist",
      networkAllowlist: [],
    },
    requestedCapabilities: {
      networkAccess: true,
      networkTargets: ["https://registry.npmjs.org/package"],
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.code, "NETWORK_TARGET_DENIED");
});
