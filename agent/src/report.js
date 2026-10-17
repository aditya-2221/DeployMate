
export function printReport(result) {
  console.log("\n=== DeployMate Package Discovery Report ===");
  console.log("Project:", result.root);
  console.log(
    "Package manager:",
    result.packageManager?.manager ?? "unknown"
  );

  if (result.packageManager?.lockfiles?.length) {
    console.log(
      "Lockfiles:",result.packageManager.lockfiles .map((file) => file.filename) .join(", ")
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
    console.log("Package manager:",component.packageManager?.manager ?? "unknown");
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
    "\nNote: Package discovery does not verify application correctness or release readiness."
  );
}
