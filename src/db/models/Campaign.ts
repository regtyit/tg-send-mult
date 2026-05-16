import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

export const CAMPAIGN_STATUSES = [
  'draft',
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const audienceSchema = new Schema(
  {
    contactIds: { type: [Types.ObjectId], default: [] },
    tags: { type: [String], default: [] },
  },
  { _id: false },
);

const scheduleSchema = new Schema(
  {
    windowStart: { type: String, default: '09:00' },
    windowEnd: { type: String, default: '22:00' },
    timezone: { type: String, default: 'Europe/Moscow' },
    ratePerAccountPerHour: { type: Number, default: 20 },
    jitter: {
      meanSec: { type: Number, default: 8 },
      sigma: { type: Number, default: 0.5 },
    },
  },
  { _id: false },
);

const statsSchema = new Schema(
  {
    queued: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skippedDuplicate: { type: Number, default: 0 },
    skippedQuota: { type: Number, default: 0 },
    skippedBlocked: { type: Number, default: 0 },
  },
  { _id: false },
);

const homoglyphsSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    /** Fraction of eligible Latin letters replaced with Cyrillic lookalikes (0–1). */
    probability: { type: Number, default: 0.35, min: 0, max: 1 },
  },
  { _id: false },
);

const campaignSchema = new Schema(
  {
    name: { type: String, required: true },
    audience: { type: audienceSchema, default: () => ({}) },
    templateId: { type: Types.ObjectId, ref: 'Template', required: true },
    accountPool: { type: [Types.ObjectId], ref: 'Account', default: [] },
    schedule: { type: scheduleSchema, default: () => ({}) },
    homoglyphs: { type: homoglyphsSchema, default: () => ({}) },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'draft', index: true },
    stats: { type: statsSchema, default: () => ({}) },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'campaigns' },
);

campaignSchema.index({ name: 1 }, { unique: true });

export type CampaignDoc = InferSchemaType<typeof campaignSchema> & { _id: Types.ObjectId };

export const CampaignModel: Model<CampaignDoc> = model<CampaignDoc>('Campaign', campaignSchema);
