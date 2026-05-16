import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const inboundReplySchema = new Schema(
  {
    accountId: { type: Types.ObjectId, ref: 'Account', required: true, index: true },
    contactId: { type: Types.ObjectId, ref: 'Contact', default: null, index: true },

    peerUserId: { type: String, default: '', index: true },
    peerUsername: { type: String, default: '' },
    peerPhone: { type: String, default: '' },
    senderUserId: { type: String, default: '' },
    direction: { type: String, enum: ['incoming', 'outgoing'], default: 'incoming', index: true },

    telegramMessageId: { type: Number, required: true },
    telegramDate: { type: Date, default: null, index: true },
    text: { type: String, default: '' },
  },
  { timestamps: true, collection: 'inbound_replies' },
);

inboundReplySchema.index({ accountId: 1, peerUserId: 1, telegramMessageId: 1 }, { unique: true });
inboundReplySchema.index({ contactId: 1, createdAt: -1 });
inboundReplySchema.index({ accountId: 1, direction: 1, telegramDate: -1 });

export type InboundReplyDoc = InferSchemaType<typeof inboundReplySchema> & { _id: Types.ObjectId };

export const InboundReplyModel: Model<InboundReplyDoc> = model<InboundReplyDoc>(
  'InboundReply',
  inboundReplySchema,
);
