import { z } from "zod";
import {
  uuid,
  timestamp,
  courseInput,
  driverInput,
  vehicleInput,
  roles,
} from "./index";
export const contactInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    kind: z.enum(["customer", "facility", "partner"]),
    phone: z.string().max(30).default(""),
    address: z.string().max(200).default(""),
  })
  .strict();
export const offerInput = z.union([
  z.object({ course_id: uuid, group_id: uuid, expires_at: timestamp }).strict(),
  z
    .object({
      course_id: uuid,
      group_ids: z.array(uuid).min(1).max(8),
      expires_at: timestamp,
    })
    .strict(),
]);
export const claimInput = z
  .object({ driver_id: uuid, vehicle_id: uuid })
  .strict();
export const decisionInput = z
  .object({ decision: z.enum(["approve", "reject", "withdraw"]) })
  .strict();
export const memberInput = z
  .object({ role: z.enum(roles), active: z.boolean() })
  .strict();
export const companyTargetInput = z.object({ tenant_id: uuid }).strict();
export const networkCodeInput = z
  .object({ code: z.string().regex(/^[a-zA-Z0-9]{12}$/) })
  .strict();
export const messageInput = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict();
export const conversationInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("course"), course_id: uuid }).strict(),
  z.object({ kind: z.literal("direct"), user_id: uuid }).strict(),
]);
export const shiftInput = z
  .object({ driver_id: uuid, shift: driverInput })
  .strict();
export const vehicleUpdateInput = vehicleInput
  .extend({
    active: z.boolean(),
    start_location: z.string().min(1).max(40).optional(),
  })
  .strict();
export const courseUpdateInput = z
  .object({ course: courseInput, version: z.number().int().positive() })
  .strict();
export const versionInput = z
  .object({ version: z.number().int().positive() })
  .strict();
export const delayInput = z
  .object({ minutes: z.number().int().min(1).max(240) })
  .strict();
export const planInput = z.union([
  z.object({ date: z.iso.date() }).strict(),
  z
    .object({
      date: z.iso.date(),
      strategy: z.literal("search"),
      replan: z.boolean().default(false),
      max_seconds: z.number().int().min(1).max(10).default(3),
    })
    .strict(),
]);
export const contactUpdateInput = z
  .object({ contact: contactInput, version: z.number().int().positive() })
  .strict();
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const recurrenceTemplate = z
  .object({
    reference: z.string().min(1).max(50),
    customer_id: uuid.optional(),
    origin: z.string().max(40),
    destination: z.string().max(40),
    pickup_time: clock,
    appointment_time: clock,
    arrival_buffer: z.number().int().min(0).max(120).default(15),
    passengers: z.number().int().min(1).max(8),
    accessible: z.boolean().default(false),
  })
  .strict();
export const recurrenceInput = z
  .object({
    template: recurrenceTemplate,
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    exceptions: z.array(z.iso.date()).max(93).default([]),
    interval_weeks: z.number().int().min(1).max(4).default(1),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.end_date) >= Date.parse(v.start_date) &&
      Date.parse(v.end_date) - Date.parse(v.start_date) <= 92 * 86400000,
    { message: "RANGE_MAX_93_DAYS" },
  );
export const returnInput = z
  .object({
    version: z.number().int().positive(),
    pickup_at: timestamp.optional(),
    appointment_at: timestamp.optional(),
  })
  .strict();
export const importInput = z
  .object({ rows: z.array(courseInput).min(1).max(100) })
  .strict();
export const passwordInput = z
  .object({
    old_password: z.string().max(128),
    new_password: z.string().min(16).max(128),
  })
  .strict();
export const offerOutput = z
  .object({
    id: uuid,
    group_id: uuid.nullable(),
    origin_label: z.string(),
    destination_label: z.string(),
    pickup_at: timestamp,
    appointment_at: timestamp,
    passengers: z.number().int(),
    accessible: z.boolean(),
    status: z.enum([
      "published",
      "reserved",
      "accepted",
      "withdrawn",
      "expired",
      "rejected",
    ]),
    expires_at: timestamp,
    reserved_until: timestamp.nullable(),
    version: z.number().int(),
    own: z.boolean(),
    claimed_by_me: z.boolean().nullable(),
  })
  .strict();
export const courseOutput = z
  .object({
    id: uuid,
    tenant_id: uuid,
    reference: z.string(),
    origin: z.string(),
    destination: z.string(),
    pickup_at: timestamp,
    appointment_at: timestamp,
    arrival_buffer: z.number().int(),
    passengers: z.number().int(),
    accessible: z.boolean(),
    status: z.enum([
      "draft",
      "unassigned",
      "assigned",
      "confirmed",
      "approaching",
      "onboard",
      "completed",
      "cancelled",
      "failed",
      "no_show",
    ]),
    priority: z.number().int(),
    pickup_latest: timestamp.nullable(),
    operational_notes: z.string(),
    request_origin: z.string(),
    version: z.number().int(),
    source_course_id: uuid.nullable(),
    source_tenant_id: uuid.nullable(),
    recurrence_key: z.string().nullable(),
    return_pending: z.boolean(),
    return_of: uuid.nullable(),
    customer_id: uuid.nullable(),
    passenger_name: z.string(),
    passenger_phone: z.string(),
    dropoff_deadline: timestamp,
    driver_id: uuid.nullable(),
    vehicle_id: uuid.nullable(),
    driver_name: z.string().nullable(),
  })
  .strict();
