import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

export const MESSAGE_STATUSES = [
  'queued',
  'sending',
  'sent',
  'failed',
  'skipped_duplicate',
  'skipped_quota',
  'skipped_blocked',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

const messageSchema = new Schema(
  {
    campaignId: { type: Types.ObjectId, ref: 'Campaign', default: null, index: true },
    contactId: { type: Types.ObjectId, ref: 'Contact', required: true, index: true },
    accountId: { type: Types.ObjectId, ref: 'Account', default: null, index: true },

    peerId: { type: String, default: '' },
    renderedText: { type: String, default: '' },
    textHash: { type: String, required: true },

    status: {
      type: String,
      enum: MESSAGE_STATUSES,
      default: 'queued',
      index: true,
    },

    error: {
      code: { type: String, default: '' },
      message: { type: String, default: '' },
    },

    randomId: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'messages' },
);

/** At most one message row per contact per campaign (regardless of text variant / homoglyphs). */
messageSchema.index(
  { campaignId: 1, contactId: 1 },
  {
    name: 'campaignId_1_contactId_1',
    unique: true,
    partialFilterExpression: { campaignId: { $type: 'objectId' } },
  },
);
messageSchema.index({ campaignId: 1, status: 1 });
messageSchema.index({ accountId: 1, sentAt: -1 });
messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ contactId: 1, status: 1 });

export type MessageDoc = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId };

export const MessageModel: Model<MessageDoc> = model<MessageDoc>('Message', messageSchema);
