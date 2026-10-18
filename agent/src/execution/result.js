import { z } from "zod";

export const EXECUTION_STATUSES = Object.freeze([
  "not_run",
  "passed",
  "failed",
  "timed_out",
  "blocked",
  "skipped",
]);

const executionErrorSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  details: z.string().optional(),
});

export const executionResultSchema = z
  .object({
    executionId: z.string().trim().min(1).nullable(),
    component: z.string().trim().min(1),
    type: z.string().trim().min(1),
    script: z.string().trim().min(1).nullable(),
    command: z.string().trim().min(1).nullable(),
    status: z.enum(EXECUTION_STATUSES),
    runner: z.string().trim().min(1).nullable(),
    workingDirectory: z.string().trim().min(1).nullable(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    exitCode: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().finite().nonnegative().nullable(),
    error: executionErrorSchema.nullable(),
  })
  .superRefine((result, context) => {
    if ((result.startedAt === null) !== (result.finishedAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "startedAt and finishedAt must both be set or both be null.",
      });
    }

    if (
      result.startedAt !== null &&
      result.finishedAt !== null &&
      Date.parse(result.finishedAt) < Date.parse(result.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt must not be earlier than startedAt.",
      });
    }

    if (result.status === "passed" && result.exitCode !== 0) {
      context.addIssue({
        code: "custom",
        path: ["exitCode"],
        message: "A passed result must have exitCode 0.",
      });
    }

    if (
      result.status === "failed" &&
      (result.exitCode === null || result.exitCode === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["exitCode"],
        message: "A failed result must have a non-zero exit code.",
      });
    }
  });

const DEFAULT_RESULT = Object.freeze({
  executionId: null,
  component: null,
  type: null,
  script: null,
  command: null,
  status: "not_run",
  runner: null,
  workingDirectory: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  stdout: "",
  stderr: "",
  durationMs: null,
  error: null,
});

/**
 * Creates a complete, validated execution-result record.
 *
 * This function only constructs data. It never starts a process or executes
 * the command recorded in the result.
 */
export function createExecutionResult(input = {}) {
  const candidate = {
    ...DEFAULT_RESULT,
    ...input,
  };

  return executionResultSchema.parse(candidate);
}

/**
 * Validates a result without throwing. The returned object follows Zod's
 * safeParse contract: { success: true, data } or { success: false, error }.
 */
export function validateExecutionResult(input) {
  return executionResultSchema.safeParse(input);
}
