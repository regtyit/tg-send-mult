import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

export const SESSION_EVENT_TYPES = [
  'login_started',
  'login_succeeded',
  'login_failed',
  'session_loaded',
  'session_invalidated',
  'reauth_required',
  'imported',
  'paused',
  'resumed',
  'quarantined',
  'banned',
  'unbanned',
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

const sessionEventSchema = new Schema(
  {
    accountId: { type: Types.ObjectId, ref: 'Account', required: true, index: true },
    type: { type: String, enum: SESSION_EVENT_TYPES, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'session_events' },
);

sessionEventSchema.index({ accountId: 1, createdAt: -1 });

export type SessionEventDoc = InferSchemaType<typeof sessionEventSchema> & {
  _id: Types.ObjectId;
};

export const SessionEventModel: Model<SessionEventDoc> = model<SessionEventDoc>(
  'SessionEvent',
  sessionEventSchema,
);
