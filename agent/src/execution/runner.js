/**
 * Validates the shape of a runner implementation without invoking it.
 *
 * A runner is expected to expose runCheck(check, options), which will later
 * return a validated execution result. This contract helper does not execute
 * project scripts or make assumptions about the runner backend.
 */
export function assertRunner(runner) {
  if (
    runner === null ||
    typeof runner !== "object" ||
    typeof runner.runCheck !== "function"
  ) {
    throw new TypeError("Runner must be an object with a runCheck function.");
  }

  return runner;
}
