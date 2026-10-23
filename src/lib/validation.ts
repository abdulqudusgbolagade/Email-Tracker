import { z } from "zod";

export const SERVICES = [
  "Book Publicity",
  "Book Formatting",
  "Book Cover Design",
  "Amazon Listing Optimization",
  "Podcast Outreach",
] as const;
export const STATUSES = [
  "New",
  "Contacted",
  "Awaiting Reply",
  "Replied",
  "Interested",
  "Meeting Scheduled",
  "Proposal Sent",
  "Won",
  "Lost",
  "Not Interested",
  "Do Not Contact",
] as const;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform(normalizeEmail);
const short = z.string().trim().max(500).default("");
export const prospectSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: emailSchema,
  website: z
    .union([
      z.literal(""),
      z
        .url()
        .refine((x) => /^https?:\/\//.test(x), "Use an HTTP or HTTPS website"),
    ])
    .default(""),
  bookTitle: short,
  bookGenre: short,
  country: short,
  publishingPlatform: short,
  service: z.enum(SERVICES).default("Book Publicity"),
  leadSource: short,
  campaignId: z.string().max(100).nullable().default(null),
  status: z.enum(STATUSES).default("New"),
  notes: z.string().max(20000).default(""),
});
export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  service: z.enum(SERVICES),
  active: z.boolean().default(true),
  trackingDefault: z.boolean().default(false),
});
export const draftSchema = z.object({
  id: z.string().optional(),
  revision: z.number().int().positive().optional(),
  prospectId: z.string(),
  conversationId: z.string().nullable().optional(),
  campaignId: z.string().nullable().optional(),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((x) => !/[\r\n]/.test(x)),
  html: z.string().max(200000),
  text: z.string().max(100000),
  tracking: z.boolean().default(false),
});
export const settingsSchema = z
  .object({
    timezone: z.string().refine((x) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: x });
        return true;
      } catch {
        return false;
      }
    }, "Unknown timezone"),
    signature: z.string().max(5000),
    intervals: z
      .string()
      .regex(/^\d{1,3}(,\d{1,3}){0,9}$/)
      .refine((x) => x.split(",").every((n) => +n > 0 && +n <= 365)),
    keepReminders: z.boolean(),
    outreachEnabled: z.boolean(),
    testRecipients: z
      .string()
      .max(5000)
      .refine(
        (x) =>
          x
            .split(/[\s,;]+/)
            .filter(Boolean)
            .every((e) => emailSchema.safeParse(e).success),
        "Enter valid test recipient addresses separated by commas",
      ),
    hourlyLimit: z.number().int().min(1).max(500),
    dailyLimit: z.number().int().min(1).max(5000),
    requestLimit: z.number().int().min(30).max(1000),
    fromName: z.string().trim().min(1).max(200),
    mailboxUser: emailSchema,
    password: z.string().max(2000).optional(),
    smtpHost: z
      .string()
      .regex(/^[a-zA-Z0-9.-]+$/)
      .max(253),
    smtpPort: z.number().int().min(1).max(65535),
    smtpSecurity: z.enum(["TLS", "STARTTLS"]),
    imapHost: z
      .string()
      .regex(/^[a-zA-Z0-9.-]+$/)
      .max(253),
    imapPort: z.number().int().min(1).max(65535),
    sentFolder: z.string().max(200).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.smtpPort === 465 && v.smtpSecurity !== "TLS") ||
      (v.smtpPort === 587 && v.smtpSecurity !== "STARTTLS")
    )
      ctx.addIssue({
        code: "custom",
        message: "Port 465 requires TLS; port 587 requires STARTTLS.",
        path: ["smtpSecurity"],
      });
  });
