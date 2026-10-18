export function assertRunner(runner) {
  if (
    runner === null ||
    typeof runner !== "object" ||
    typeof runner.runCheck !== "function"
  ) {
    throw new TypeError(
      "Runner must be an object with a runCheck function.",
    );
  }

  return runner;
}
