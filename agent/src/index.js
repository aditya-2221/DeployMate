
import { discoverPackages } from "./discovery/discoverPackages.js";
import { discoverChecks } from "./checks/discoverChecks.js";
import { discoverOperationalScripts } from "./checks/discoverOperationalScripts.js";
import { createPolicyAwareDockerRunner } from "./execution/dockerPolicyRunner.js";
import { createExecutionResult } from "./execution/result.js";
import { diagnose } from "./diagnostics/diagnose.js";
import { printReport } from "./report.js";

function parseArguments(args) {
  const flags = new Set(["--run", "--approve"]);
  const options = {
    targetPath: null,
    run: false,
    approve: false,
    errors: [],
  };

  for (const arg of args) {
    if (flags.has(arg)) {
      if (arg === "--run") options.run = true;
      if (arg === "--approve") options.approve = true;
      continue;
    }

    if (arg.startsWith("--")) {
      options.errors.push(`Unknown option: ${arg}`);
      continue;
    }

    if (options.targetPath !== null) {
      options.errors.push(`Unexpected argument: ${arg}`);
      continue;
    }

    options.targetPath = arg;
  }

  if (options.approve && !options.run) {
    options.errors.push("--approve requires --run.");
  }

  return options;
}

function createOrchestrationFailure(check, error) {
  return createExecutionResult({
    executionId: null,
    component: check.component,
    type: check.type,
    script: check.script ?? null,
    command: check.command ?? null,
    status: "not_run",
    runner: "docker",
    workingDirectory: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: null,
    error: {
      code: "ORCHESTRATION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "An unexpected orchestration error occurred.",
    },
  });
}

function printUsage() {
  console.log(
    'Usage: npm run dev -- "C:\\path\\to\\your\\project" [--run] [--approve]'
  );
  console.log("");
  console.log("Options:");
  console.log("  (no flags)    Discover packages and checks only.");
  console.log("  --run         Evaluate policy and request check execution.");
  console.log("  --approve     Explicitly approve checks for this invocation.");
  console.log("");
  console.log("--approve must be used together with --run.");
}

const options = parseArguments(process.argv.slice(2));

if (options.errors.length > 0) {
  for (const error of options.errors) {
    console.error(`Argument error: ${error}`);
  }

  printUsage();
  process.exitCode = 1;
} else if (!options.targetPath) {
  printUsage();
  process.exitCode = 1;
} else {
  try {
    const discoveryResult = await discoverPackages(options.targetPath);
    const checks = discoverChecks(discoveryResult);
    const operationalScripts =
      discoverOperationalScripts(discoveryResult);

    const executionResults = [];
    const policyDecisions = [];

    if (options.run) {
      const runner = createPolicyAwareDockerRunner({
        projectRoot: discoveryResult.root,
      });

      const availableChecks = checks.filter(
        (check) => check.status === "available"
      );

      for (const check of availableChecks) {
        try {
          const outcome = await runner.runCheck(check, {
            approvalGranted: options.approve,
          });

          policyDecisions.push({
            check,
            decision: outcome.decision,
          });

          if (outcome.result !== null) {
            executionResults.push(outcome.result);
          }
        } catch (error) {
          // Preserve earlier results if one check fails unexpectedly.
          executionResults.push(
            createOrchestrationFailure(check, error)
          );
        }
      }
    }

    const findings = diagnose({
      discoveryResult,
      checks,
      executionResults,
      policyDecisions,
    });

    printReport(
      discoveryResult,
      checks,
      operationalScripts,
      findings,
      executionResults,
      policyDecisions
    );
  } catch (error) {
    console.error(
      "DeployMate failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  }
}
