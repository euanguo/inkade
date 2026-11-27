import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { InkadeError } from "@inkade/core";

export function zValidate<
  T extends z.ZodType,
  Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
  return honoZValidator(target, schema, (result) => {
    if (!result.success) {
      throw new InkadeError("VALIDATION_ERROR", "Request validation failed", {
        target: result.target,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      });
    }
  });
}
