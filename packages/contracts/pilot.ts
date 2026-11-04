import { z } from "zod";
import { uuid, timestamp } from "./index";
export const locationInput = z
  .object({
    label: z.string().trim().min(2).max(80),
    address: z.string().trim().min(2).max(200),
    sector: z.string().trim().min(2).max(80),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    confirmed: z.literal(true),
  })
  .strict();
export const routingInput = z
  .object({ location_ids: z.array(z.string().max(40)).min(1).max(20) })
  .strict();
export const absenceInput = z
  .object({
    driver_id: uuid.optional(),
    vehicle_id: uuid.optional(),
    start_at: timestamp,
    end_at: timestamp,
    reason: z.enum(["leave", "illness", "maintenance", "other"]),
    acknowledge_conflicts: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => Boolean(v.driver_id) !== Boolean(v.vehicle_id),
    "EXACTLY_ONE_RESOURCE",
  )
  .refine(
    (v) => Date.parse(v.end_at) > Date.parse(v.start_at),
    "INVALID_PERIOD",
  );
export const transferInput = z
  .object({
    version: z.number().int().positive(),
    reason: z.enum(["delay", "breakdown", "illness", "other"]),
  })
  .strict();
export const transferDecisionInput = z
  .object({
    decision: z.enum(["approve", "reject"]),
    driver_id: uuid.optional(),
    vehicle_id: uuid.optional(),
  })
  .strict();
