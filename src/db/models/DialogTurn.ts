import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const dialogTurnSchema = new Schema(
  {
    sessionId: { type: Types.ObjectId, ref: 'DialogSession', required: true, index: true },
    turnIndex: { type: Number, required: true },
    senderAccountId: { type: Types.ObjectId, ref: 'Account', required: true, index: true },
    side: { type: String, enum: ['a', 'b', 'sync'], required: true },
    text: { type: String, default: '' },
    peer: { type: String, default: '' },
    telegramMessageId: { type: Number, default: 0 },
    inboundReplyId: { type: Types.ObjectId, ref: 'InboundReply', default: null },
    readAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true, collection: 'dialog_turns' },
);

dialogTurnSchema.index({ sessionId: 1, turnIndex: 1 }, { unique: true });

export type DialogTurnDoc = InferSchemaType<typeof dialogTurnSchema> & { _id: Types.ObjectId };

export const DialogTurnModel: Model<DialogTurnDoc> = model<DialogTurnDoc>(
  'DialogTurn',
  dialogTurnSchema,
);
