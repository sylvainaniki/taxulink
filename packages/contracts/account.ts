import { z } from "zod";
export const accountEmailInput = z
  .object({ email: z.email().max(254) })
  .strict();
export const accountTokenInput = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const resetPasswordInput = accountTokenInput
  .extend({
    password: z.string().min(16).max(128),
    mfa_code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recovery_code: z.string().max(64).optional(),
  })
  .strict();
