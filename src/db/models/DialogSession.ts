import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

export const DIALOG_SESSION_STATUSES = [
  'draft',
  'running',
  'waiting_peer',
  'paused',
  'completed',
  'failed',
] as const;
export type DialogSessionStatus = (typeof DIALOG_SESSION_STATUSES)[number];

const dialogSessionSchema = new Schema(
  {
    name: { type: String, default: '', trim: true },
    scriptId: { type: Types.ObjectId, ref: 'DialogScript', required: true, index: true },
    accountAId: { type: Types.ObjectId, ref: 'Account', required: true, index: true },
    peerType: { type: String, enum: ['account', 'contact'], required: true },
    peerAccountId: { type: Types.ObjectId, ref: 'Account', default: null, index: true },
    peerContactId: { type: Types.ObjectId, ref: 'Contact', default: null, index: true },
    status: {
      type: String,
      enum: DIALOG_SESSION_STATUSES,
      default: 'draft',
      index: true,
    },
    runMode: { type: String, enum: ['auto', 'manual'], default: 'manual' },
    currentTurn: { type: Number, default: 0 },
    /** After a peer trigger matches, only newer inbound messages count for the next wait. */
    waitCursorAt: { type: Date, default: null },
    /** Throttle Telegram inbox polls while waiting for a peer reply. */
    lastPeerSyncAt: { type: Date, default: null },
    /** Index into DIALOG_PEER_CHECK_DELAYS_SEC while waiting_peer. */
    peerCheckAttempt: { type: Number, default: 0 },
    nextRunAt: { type: Date, default: null, index: true },
    /** Prevents duplicate turn execution across scheduler/worker instances. */
    processingLockUntil: { type: Date, default: null, index: true },
    lastError: { type: String, default: '' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'dialog_sessions' },
);

dialogSessionSchema.index({ status: 1, runMode: 1, nextRunAt: 1 });
dialogSessionSchema.index({ runMode: 1, status: 1, processingLockUntil: 1, nextRunAt: 1 });

export type DialogSessionDoc = InferSchemaType<typeof dialogSessionSchema> & { _id: Types.ObjectId };

export const DialogSessionModel: Model<DialogSessionDoc> = model<DialogSessionDoc>(
  'DialogSession',
  dialogSessionSchema,
);
