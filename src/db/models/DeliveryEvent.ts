import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';
import { config } from '../../config';

export const DELIVERY_EVENT_TYPES = [
  'queued',
  'delayed',
  'sending',
  'sent',
  'failed',
  'skipped_quota',
  'skipped_blocked',
] as const;
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];

const deliveryEventSchema = new Schema(
  {
    messageId: { type: Types.ObjectId, ref: 'Message', required: true, index: true },
    campaignId: { type: Types.ObjectId, ref: 'Campaign', default: null, index: true },
    accountId: { type: Types.ObjectId, ref: 'Account', default: null, index: true },
    contactId: { type: Types.ObjectId, ref: 'Contact', required: true, index: true },
    type: { type: String, enum: DELIVERY_EVENT_TYPES, required: true, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'delivery_events' },
);

deliveryEventSchema.index({ campaignId: 1, createdAt: -1 });
deliveryEventSchema.index({ accountId: 1, createdAt: -1 });
deliveryEventSchema.index({ contactId: 1, createdAt: -1 });

/**
 * TTL index on `createdAt`. We never need delivery events forever — they are
 * append-only audit traces used for status pages, debugging, and quick stats.
 * Retention is configurable via `DELIVERY_EVENT_TTL_DAYS` (default 30).
 * Setting `DELIVERY_EVENT_TTL_DAYS=0` disables the TTL (kept for forensics).
 *
 * MongoDB enforces this with a single TTL monitor pass, so it costs us
 * effectively nothing at write time.
 */
const ttlSeconds = Math.max(0, Math.floor(config.DELIVERY_EVENT_TTL_DAYS)) * 24 * 60 * 60;
if (ttlSeconds > 0) {
  deliveryEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: ttlSeconds });
}

export type DeliveryEventDoc = InferSchemaType<typeof deliveryEventSchema> & {
  _id: Types.ObjectId;
};

export const DeliveryEventModel: Model<DeliveryEventDoc> = model<DeliveryEventDoc>(
  'DeliveryEvent',
  deliveryEventSchema,
);
