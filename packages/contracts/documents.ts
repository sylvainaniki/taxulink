import { z } from "zod";

export const patientDocumentKinds = [
  "transport_voucher",
  "mutual_insurance_photo",
] as const;
export const documentUploadInput = z
  .object({
    course_id: z.uuid().optional(),
    contact_id: z.uuid().optional(),
    kind: z.enum(patientDocumentKinds),
    title: z.string().trim().min(2).max(80),
    mime: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    content: z
      .string()
      .max(1400000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    synthetic: z.literal(true),
    expires_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => v.course_id || v.contact_id, {
    message: "A course or patient link is required",
  })
  .refine(
    (v) => v.kind !== "mutual_insurance_photo" || v.mime !== "application/pdf",
    { message: "Mutual insurance must be a photo", path: ["mime"] },
  );
