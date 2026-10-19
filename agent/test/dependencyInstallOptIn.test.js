import test from "node:test";
import assert from "node:assert/strict";

import { createPolicyAwareDockerRunner } from "../src/execution/dockerPolicyRunner.js";

const CHECK = {
  component: ".",
  type: "test",
  status: "available",
  script: "test",
  command: "node -e \"console.log('ok')\"",
};

const TARGET = "https://registry.npmjs.org/";

test("dependency installation is denied when policy disables network access", async () => {
  let stageCalls = 0;
  let dockerCalls = 0;

  const runner = createPolicyAwareDockerRunner({
    projectRoot: "/tmp/deploymate-test-project",
    dockerRunner: {
      async runDockerCheck() {
        dockerCalls += 1;
        throw new Error("Docker must not run");
      },
    },
    stageWorkspace: async () => {
      stageCalls += 1;
      throw new Error("Workspace must not be staged");
    },
  });

  const outcome = await runner.runCheck(CHECK, {
    approvalGranted: true,
    installDependencies: true,
    dependencyInstallTargets: [TARGET],
  });

  assert.equal(outcome.decision.decision, "blocked");
  assert.equal(outcome.decision.code, "NETWORK_ACCESS_DENIED");
  assert.equal(outcome.result, null);
  assert.equal(stageCalls, 0);
  assert.equal(dockerCalls, 0);
});

test("dependency installation fails closed when no restricted network is implemented", async () => {
  let stageCalls = 0;
  let dockerCalls = 0;

  const runner = createPolicyAwareDockerRunner({
    projectRoot: "/tmp/deploymate-test-project",
    policy: {
      profile: "standard",
      trustedProject: true,
      allowedCheckTypes: ["test"],
      networkAccess: "dependency_install",
      networkAllowlist: [TARGET],
    },
    dockerRunner: {
      async runDockerCheck() {
        dockerCalls += 1;
        throw new Error("Docker must not run");
      },
    },
    stageWorkspace: async () => {
      stageCalls += 1;
      throw new Error("Workspace must not be staged");
    },
  });

  const outcome = await runner.runCheck(CHECK, {
    installDependencies: true,
    dependencyInstallTargets: [TARGET],
  });

  assert.equal(outcome.decision.decision, "allowed");
  assert.equal(outcome.result.status, "not_run");
  assert.equal(
    outcome.result.error.code,
    "DEPENDENCY_INSTALL_NETWORK_NOT_CONFIGURED",
  );
  assert.match(outcome.result.error.message, /egress-restricted Docker network/i);
  assert.equal(stageCalls, 0);
  assert.equal(dockerCalls, 0);
});

test("normal check requests do not implicitly request network access", async () => {
  let stageCalls = 0;

  const runner = createPolicyAwareDockerRunner({
    projectRoot: "/tmp/deploymate-test-project",
    dockerRunner: {
      async runDockerCheck() {
        throw new Error("This test only checks the default policy gate");
      },
    },
    stageWorkspace: async () => {
      stageCalls += 1;
      throw new Error("Workspace must not be staged without approval");
    },
  });

  const outcome = await runner.runCheck(CHECK);

  assert.equal(outcome.decision.decision, "requires_approval");
  assert.equal(outcome.result, null);
  assert.equal(stageCalls, 0);
});
