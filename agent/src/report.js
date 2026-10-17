
export function printReport(
  result,
  checks = [],
  operationalScripts = []
) {
  console.log("\n=== DeployMate Package Discovery Report ===");
  console.log("Project:", result.root);
  console.log(
    "Package manager:",
    result.packageManager?.manager ?? "unknown"
  );

  if (result.packageManager?.lockfiles?.length) {
    console.log(
      "Lockfiles:",
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

      for (const check of componentChecks) {
        if (check.status === "available") {
          console.log(
            `  [AVAILABLE] ${check.type}: ${check.script} (${check.command})`
          );
          console.log("    Execution status: NOT RUN");
        } else {
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

  console.log("\nWarnings:");

  if (result.warnings.length === 0) {
    console.log("No discovery warnings.");
  } else {
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }

  console.log(
    "\nNote: Discovery identifies declared scripts; it does not verify application correctness or release readiness."
  );
}
