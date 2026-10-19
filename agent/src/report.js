
export function printReport(
  result,
  checks = [],
  operationalScripts = [],
  findings = [],
  executionResults = [],
  policyDecisions = []
) {
  console.log("\n=== DeployMate Package Discovery Report ===");
  console.log("Project:", result.root);
  console.log(
    "Root package manager:",
    result.packageManager?.manager ?? "unknown"
  );

  if (result.packageManager?.lockfiles?.length) {
    console.log(
      "Root lockfiles:",
      result.packageManager.lockfiles
        .map((file) => file.filename)
        .join(", ")
    );
  }

  console.log("\nDiscovered packages:");

  if (result.components.length === 0) {
    console.log("No packages discovered.");
  }

  for (const component of result.components) {
    console.log(`\n[${component.type.toUpperCase()}] ${component.path}`);
    console.log("Name:", component.name);
    console.log("Package file:", component.packageFile);
    console.log("Available scripts:");

    const scripts = Object.entries(component.scripts ?? {});

    if (scripts.length === 0) {
      console.log("  No scripts defined.");
    } else {
      for (const [name, command] of scripts) {
        console.log(`  ${name}: ${command}`);
      }
    }

    console.log(
      "Package manager:",
      component.packageManager?.manager ?? "unknown"
    );
  }

  console.log("\nCheck Inventory:");

  if (checks.length === 0) {
    console.log("No checks discovered.");
  } else {
    for (const component of result.components) {
      const componentChecks = checks.filter(
        (check) => check.component === component.path
      );

      console.log(`\n[${component.type.toUpperCase()}] ${component.path}`);

      if (componentChecks.length === 0) {
        console.log("  No checks discovered for this component.");
        continue;
      }

      for (const check of componentChecks) {
        if (check.status === "available") {
          console.log(
            `  [AVAILABLE] ${check.type}: ${check.script} (${check.command})`
          );

          const matchingResult = executionResults.find(
            (execution) =>
              execution.component === check.component &&
              execution.type === check.type &&
              execution.script === check.script
          );

          if (matchingResult) {
            console.log(
              `    Execution status: ${matchingResult.status.toUpperCase()}`
            );
          } else {
            console.log("    Execution status: NOT RUN");
          }
        } 
        else {
          console.log(
            `  [UNAVAILABLE] ${check.type}: No recognized script detected`
          );
        }
      }
    }
  }

  console.log("\nOperational Scripts:");

  if (operationalScripts.length === 0) {
    console.log("No operational scripts discovered.");
  } else {
    for (const component of result.components) {
      const componentScripts = operationalScripts.filter(
        (script) => script.component === component.path
      );

      console.log(`\n[${component.type.toUpperCase()}] ${component.path}`);

      for (const script of componentScripts) {
        if (script.status === "available") {
          console.log(
            `  [AVAILABLE] ${script.type}: ${script.command}`
          );
          console.log("    Execution status: NOT RUN");
        } else {
          console.log(
            `  [UNAVAILABLE] ${script.type}: No recognized script detected`
          );
        }
      }
    }
  }

  console.log("\nPolicy Decisions:");

  if (policyDecisions.length === 0) {
    console.log("No execution policy decisions requested.");
  } else {
    for (const entry of policyDecisions) {
      const check = entry.check ?? {};
      const decision = entry.decision ?? {};

      console.log(
        `  [${String(decision.decision ?? "unknown").toUpperCase()}] ` +
          `${check.component ?? "unknown"} | ${check.type ?? "unknown"}`
      );

      if (decision.code) {
        console.log(`    Code: ${decision.code}`);
      }

      if (decision.reason) {
        console.log(`    Reason: ${decision.reason}`);
      }
    }
  }

  console.log("\nExecution Results:");

  if (executionResults.length === 0) {
    console.log("No checks were executed.");
  } else {
    for (const execution of executionResults) {
      console.log(
        `  [${execution.status.toUpperCase()}] ` +
          `${execution.component} | ${execution.type} | ${execution.script ?? "unknown"}`
      );

      if (execution.exitCode !== null) {
        console.log(`    Exit code: ${execution.exitCode}`);
      }

      if (execution.durationMs !== null) {
        console.log(`    Duration: ${execution.durationMs} ms`);
      }

      if (execution.error) {
        console.log(`    Error code: ${execution.error.code}`);
        console.log(`    Error: ${execution.error.message}`);
      }

      if (execution.stderr?.trim()) {
        console.log(`    Stderr: ${execution.stderr.trim()}`);
      }
    }
  }

  console.log("\nWarnings:");

  if (result.warnings.length === 0) {
    console.log("No discovery warnings.");
  } else {
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }

  console.log("\n=== Diagnostic Findings ===");

  if (findings.length === 0) {
    console.log("No diagnostic findings.");
  } else {
    const severityOrder = ["error", "warning", "info"];

    for (const severity of severityOrder) {
      const matchingFindings = findings.filter(
        (finding) => finding.severity === severity
      );

      if (matchingFindings.length === 0) {
        continue;
      }

      console.log(`\n${severity.toUpperCase()} (${matchingFindings.length})`);

      for (const finding of matchingFindings) {
        console.log(
          `  [${finding.code}] ${finding.component}`
        );
        console.log(`    ${finding.message}`);

        if (Object.keys(finding.evidence ?? {}).length > 0) {
          console.log(
            `    Evidence: ${JSON.stringify(finding.evidence)}`
          );
        }

        if (finding.recommendation) {
          console.log(
            `    Recommendation: ${finding.recommendation}`
          );
        }
      }
    }
  }

  console.log(
    "\nNote: Discovery identifies declared scripts; it does not verify application correctness or release readiness."
  );
}
