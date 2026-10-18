
import { runDockerCheck } from "./src/execution/dockerProcess.js";

const result = await runDockerCheck({
  stagedWorkspacePath: "C:\\DeployMate\\docker-smoke-test",
  componentRelativePath: ".",
  packageManager: "npm",
  script: "test:timeout",
  expectedCommand:
    'node -e "setInterval(() => console.log(\'still running\'), 1000)"',
  timeoutMs: 5_000,
  maxOutputBytes: 16 * 1024,
});

console.log(JSON.stringify(result, null, 2));

const checks = {
  reportsTimeout: result.status === "timed_out",
  timeoutError: result.error?.code === "CHECK_TIMEOUT",
  cleanupSucceeded: result.cleanup?.success === true,
  processClosed: result.processDidNotClose === false,
};

console.log("\nTimeout assertions:");
console.log(JSON.stringify(checks, null, 2));

if (Object.values(checks).some((passed) => !passed)) {
  console.error("FAIL: One or more timeout assertions failed.");
  process.exitCode = 1;
} else {
  console.log("PASS: Docker timeout handling behaved as expected.");
}
