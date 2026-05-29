import type { FastifyReply } from 'fastify';
import { Types } from 'mongoose';
import { z } from 'zod';

/**
 * Run a Zod schema against a request input. On failure, reply with 400 and
 * a structured payload describing the issues; the caller should `return`
 * immediately. On success, returns the parsed data.
 *
 * Usage:
 *   const body = parseBody(reply, accountCreateBody, req.body);
 *   if (!body) return;
 */
export function validate<S extends z.ZodTypeAny>(
  reply: FastifyReply,
  schema: S,
  value: unknown,
  source: 'body' | 'params' | 'query' = 'body',
): z.infer<S> | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data as z.infer<S>;
  reply.code(400).send({
    error: 'invalid_request',
    source,
    issues: parsed.error.flatten(),
  });
  return undefined;
}

/** Mongo ObjectId as a 24-char hex string. */
export const objectIdString = z
  .string()
  .refine((s) => Types.ObjectId.isValid(s), { message: 'invalid ObjectId' });

export const idParams = z.object({ id: objectIdString });

export const phoneE164 = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, 'expected E.164 phone (8–15 digits, optional leading +)');

export const deviceProfileSchema = z
  .object({
    deviceModel: z.string().trim().max(100).optional(),
    systemVersion: z.string().trim().max(100).optional(),
    appVersion: z.string().trim().max(100).optional(),
    langCode: z.string().trim().max(20).optional(),
    systemLangCode: z.string().trim().max(20).optional(),
  })
  .partial()
  .strict();

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected HH:MM');

export const sendingWindowSchema = z
  .object({
    start: timeHHMM,
    end: timeHHMM,
    timezone: z.string().trim().min(1).max(80),
  })
  .strict();

export const accountCreateBody = z
  .object({
    phone: phoneE164,
    label: z.string().trim().max(200).optional().default(''),
    proxyId: objectIdString.optional(),
    deviceProfile: deviceProfileSchema.optional(),
    telegramApiId: z.number().int().positive().optional(),
    telegramApiHash: z.string().trim().min(1).optional(),
    role: z.enum(['sender', 'test_recipient']).optional(),
    /** ISO2 — apply bundled regional active hours (else derived from phone). */
    sendingWindowRegion: z.string().trim().length(2).optional(),
    sendingWindow: sendingWindowSchema.optional(),
  })
  .strict();

export const warmupScheduleSchema = z
  .object({
    mode: z.enum(['interval', 'weekdays']),
    intervalDays: z.number().int().min(1).max(30).optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).optional(),
    maxRecommendedDialogs: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export const accountPatchBody = z
  .object({
    status: z.enum(['new', 'warming', 'active', 'paused', 'quarantined', 'banned']).optional(),
    label: z.string().trim().max(200).optional(),
    proxyId: objectIdString.nullable().optional(),
    deviceProfile: deviceProfileSchema.optional(),
    telegramApiId: z.number().int().positive().nullable().optional(),
    telegramApiHash: z.string().trim().optional(),
    role: z.enum(['sender', 'test_recipient']).optional(),
    /** Re-apply bundled regional window from ISO2 (overrides sendingWindow when set). */
    applyRegionalWindow: z.boolean().optional(),
    sendingWindow: sendingWindowSchema.optional(),
    warmupSchedule: warmupScheduleSchema.optional(),
  })
  .strict();

export const accountAssignProxyBody = z
  .object({
    proxyId: z.union([objectIdString, z.null()]).optional(),
    auto: z.boolean().optional(),
  })
  .strict();

export const accountAssignProxyAutoBody = z
  .object({
    onlyUnassigned: z.boolean().optional(),
  })
  .strict();

export const accountSendTestBody = z
  .object({
    to: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(4096),
  })
  .strict();

export const accountSessionBody = z
  .object({
    sessionString: z.string().min(1),
  })
  .strict();

export const proxyCreateBody = z
  .object({
    label: z.string().trim().min(1).max(200),
    type: z.enum(['socks5', 'http', 'mtproto']),
    host: z.string().trim().min(1).max(2048),
    port: z.number().int().min(1).max(65535),
    country: z.string().trim().max(8).optional().default(''),
    login: z.string().optional(),
    password: z.string().optional(),
    secret: z.string().optional(),
  })
  .strict();

export const proxyTestBody = z
  .object({
    accountId: objectIdString.optional(),
  })
  .strict();

export const proxyPatchBody = z
  .object({
    type: z.enum(['socks5', 'http', 'mtproto']).optional(),
    label: z.string().trim().min(1).max(200).optional(),
    host: z.string().trim().min(1).max(2048).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    country: z.string().trim().max(8).optional(),
    login: z.string().optional(),
    password: z.string().optional(),
    secret: z.string().optional(),
  })
  .strict();

export const accountImportTdataBody = z
  .object({
    /** Optional when JSON metadata includes `phone`. */
    phone: phoneE164.optional(),
    tdataPath: z.string().trim().min(1).max(4000),
    jsonPath: z.string().trim().min(1).max(4000),
    label: z.string().trim().max(200).optional(),
    role: z.enum(['sender', 'test_recipient']).optional(),
  })
  .strict();

export const accountImportJsonBody = z
  .object({
    jsonPath: z.string().trim().min(1).max(4000),
    phone: phoneE164.optional(),
    proxyId: objectIdString.optional(),
    label: z.string().trim().max(200).optional(),
    role: z.enum(['sender', 'test_recipient']).optional(),
  })
  .strict();

export const contactsImportBody = z
  .object({
    csv: z.string().optional(),
    json: z.string().optional(),
    tags: z.array(z.string().trim().max(80)).optional(),
    defaultCountry: z.string().trim().max(8).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.csv) || Boolean(b.json), {
    message: 'Provide csv or json string',
    path: ['csv'],
  });

export const templateCreateBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(8192),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const campaignCreateBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    templateId: objectIdString,
    accountPool: z.array(z.string().trim().min(1)).min(1),
    audience: z
      .object({
        contactIds: z.array(objectIdString).optional(),
        tags: z.array(z.string().trim().max(80)).optional(),
      })
      .strict()
      .optional(),
    schedule: z.record(z.unknown()).optional(),
    homoglyphs: z
      .object({
        enabled: z.boolean().optional(),
        probability: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const messagesQuery = z
  .object({
    campaignId: objectIdString.optional(),
    accountId: objectIdString.optional(),
    contactId: objectIdString.optional(),
    status: z
      .enum([
        'queued',
        'sending',
        'sent',
        'failed',
        'skipped_duplicate',
        'skipped_quota',
        'skipped_blocked',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    skip: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
    paginated: z.coerce.boolean().optional().default(false),
  })
  .strict();

export const contactsQuery = z
  .object({
    q: z.string().trim().max(200).optional(),
    tag: z.string().trim().max(80).optional(),
    status: z.string().trim().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional().default(50),
    skip: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
    paginated: z.coerce.boolean().optional().default(false),
  })
  .strict();

export const inboundRepliesQuery = z
  .object({
    accountId: objectIdString.optional(),
    contactId: objectIdString.optional(),
    dialogSessionId: objectIdString.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(100),
    skip: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
    paginated: z.coerce.boolean().optional().default(false),
  })
  .strict();

const dialogTurnDefSchema = z
  .object({
    side: z.enum(['a', 'b']),
    text: z.string().max(4096).optional().default(''),
    templateId: objectIdString.optional(),
    waitForText: z.string().max(500).optional().default(''),
    delaySecMin: z.number().int().min(0).max(86_400).optional(),
    delaySecMax: z.number().int().min(0).max(86_400).optional(),
  })
  .strict()
  .refine((t) => Boolean(t.text?.trim()) || t.templateId, {
    message: 'Each turn needs text or templateId',
  });

export const dialogScriptCreateBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    mode: z.enum(['turns', 'template_pairs']).optional().default('turns'),
    turns: z.array(dialogTurnDefSchema).optional().default([]),
    questionTemplateId: objectIdString.optional(),
    answerTemplateId: objectIdString.optional(),
    peerWaitText: z.string().max(500).optional().default(''),
    rounds: z.number().int().min(1).max(100).optional().default(1),
    defaultDelaySecMin: z.number().int().min(0).max(86_400).optional().default(30),
    defaultDelaySecMax: z.number().int().min(0).max(86_400).optional().default(90),
    typingSec: z.number().int().min(0).max(30).optional().default(3),
    notes: z.string().max(2000).optional().default(''),
  })
  .strict();

export const dialogScriptImportBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    csv: z.string().optional(),
    json: z.string().optional(),
    defaultDelaySecMin: z.number().int().min(0).optional(),
    defaultDelaySecMax: z.number().int().min(0).optional(),
    typingSec: z.number().int().min(0).max(30).optional(),
  })
  .strict()
  .refine((b) => Boolean(b.csv?.trim() || b.json?.trim()), {
    message: 'csv or json required',
  });

export const dialogPresetApplyBody = z
  .object({
    slug: z.string().trim().min(1).max(80).optional(),
    replace: z.boolean().optional().default(false),
  })
  .strict();

export const dialogPresetsQuery = z
  .object({
    lang: z.enum(['en', 'ru']).optional(),
    category: z.enum(['social', 'work', 'support', 'logistics']).optional(),
  })
  .strict();

export const dialogPresetSlugParams = z.object({ slug: z.string().trim().min(1).max(80) }).strict();

export const dialogSessionCreateBody = z
  .object({
    name: z.string().trim().max(200).optional().default(''),
    scriptId: objectIdString.optional(),
    /** Built-in human dialog template; creates/reuses script in DB when scriptId omitted. */
    presetSlug: z.string().trim().min(1).max(80).optional(),
    accountAId: objectIdString,
    peerType: z.enum(['account', 'contact']),
    peerAccountId: objectIdString.optional(),
    peerContactId: objectIdString.optional(),
    runMode: z.enum(['auto', 'manual']).optional().default('manual'),
  })
  .strict()
  .refine((b) => Boolean(b.scriptId || b.presetSlug), {
    message: 'scriptId or presetSlug required',
  });

export const bulkImportBody = z
  .object({
    csv: z.string().optional(),
    json: z.string().optional(),
    testAfterImport: z.boolean().optional().default(false),
  })
  .strict()
  .refine((b) => Boolean(b.csv?.trim() || b.json?.trim()), {
    message: 'csv or json required',
  });

export const accountsBulkImportBody = z
  .object({
    csv: z.string().min(1),
    defaultCountry: z.string().trim().max(8).optional(),
  })
  .strict();
