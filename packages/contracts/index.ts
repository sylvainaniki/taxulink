import { z } from "zod";
export const uuid = z.uuid();
export const timestamp = z.iso.datetime({ offset: true });
export const roles = ["admin", "dispatcher", "driver", "viewer"] as const;
export const loginInput = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(128),
    mfa_code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recovery_code: z
      .string()
      .regex(/^[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{8}$/)
      .optional(),
  })
  .strict();
export const registerInput = loginInput
  .omit({ mfa_code: true, recovery_code: true })
  .extend({
    password: z.string().min(16).max(128),
    company: z.string().trim().min(2).max(100),
  })
  .strict();
export const vehicleInput = z
  .object({
    label: z.string().trim().min(1).max(60),
    seats: z.number().int().min(1).max(8),
    accessible: z.boolean().default(false),
  })
  .strict();
export const driverInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    user_id: uuid.optional(),
    shift_start: timestamp,
    shift_end: timestamp,
    start_location: z.string().max(40),
    end_location: z.string().max(40),
    breaks: z
      .array(z.object({ start: timestamp, end: timestamp }).strict())
      .max(8)
      .default([]),
  })
  .strict()
  .refine((v) => Date.parse(v.shift_end) > Date.parse(v.shift_start), {
    message: "SHIFT_INVALID",
  })
  .refine(
    (v) =>
      v.breaks.every(
        (b) =>
          Date.parse(b.end) > Date.parse(b.start) &&
          Date.parse(b.start) >= Date.parse(v.shift_start) &&
          Date.parse(b.end) <= Date.parse(v.shift_end),
      ),
    { message: "BREAK_INVALID" },
  );
export const courseInput = z
  .object({
    reference: z.string().trim().min(1).max(60),
    customer_id: uuid.optional(),
    origin: z.string().max(40),
    destination: z.string().max(40),
    pickup_at: timestamp,
    appointment_at: timestamp,
    arrival_buffer: z.number().int().min(0).max(120).default(15),
    passengers: z.number().int().min(1).max(8),
    accessible: z.boolean().default(false),
  })
  .strict()
  .refine((v) => Date.parse(v.appointment_at) > Date.parse(v.pickup_at), {
    message: "TIME_WINDOW_INVALID",
  });
export const assignmentInput = z
  .object({
    driver_id: uuid,
    vehicle_id: uuid,
    version: z.number().int().positive(),
  })
  .strict();
export const invitationInput = z
  .object({
    email: z.email().max(254),
    role: z.enum(["dispatcher", "driver", "viewer"]),
  })
  .strict();
export const acceptInput = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const groupInput = z
  .object({ name: z.string().trim().min(2).max(80) })
  .strict();
export const statusInput = z
  .object({
    status: z.enum(["approaching", "onboard", "completed", "cancelled"]),
    version: z.number().int().positive(),
  })
  .strict();
