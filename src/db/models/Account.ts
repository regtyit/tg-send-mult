import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

export const ACCOUNT_STATUSES = [
  'new',
  'warming',
  'active',
  'paused',
  'quarantined',
  'banned',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_ROLES = ['sender', 'test_recipient'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

const deviceProfileSchema = new Schema(
  {
    deviceModel: { type: String, required: true },
    systemVersion: { type: String, required: true },
    appVersion: { type: String, required: true },
    langCode: { type: String, required: true, default: 'en' },
    systemLangCode: { type: String, required: true, default: 'en' },
  },
  { _id: false },
);

const dailyLimitsSchema = new Schema(
  {
    msgsToNew: { type: Number, default: 80 },
    contactsAdded: { type: Number, default: 20 },
    ratePerHour: { type: Number, default: 20 },
  },
  { _id: false },
);

const dailyCountersSchema = new Schema(
  {
    msgsToNew: { type: Number, default: 0 },
    contactsAdded: { type: Number, default: 0 },
    sentTotal: { type: Number, default: 0 },
    failedTotal: { type: Number, default: 0 },
    resetAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const sendingWindowSchema = new Schema(
  {
    start: { type: String, default: '09:00' },
    end: { type: String, default: '22:00' },
    timezone: { type: String, default: 'Europe/Moscow' },
  },
  { _id: false },
);

const healthMetricsSchema = new Schema(
  {
    sent24h: { type: Number, default: 0 },
    failed24h: { type: Number, default: 0 },
    floodWait24h: { type: Number, default: 0 },
    peerFlood24h: { type: Number, default: 0 },
  },
  { _id: false },
);

const accountSchema = new Schema(
  {
    phone: { type: String, required: true, trim: true },
    /** Telegram @username of the logged-in user (from getMe), for UI / campaign picker. */
    telegramUsername: { type: String, default: '', trim: true },
    label: { type: String, default: '' },

    sessionEnc: { type: String, default: '' },
    sessionAuthorizedAt: { type: Date, default: null },

    /** Telegram API app id (my.telegram.org / export). Overrides TG_API_ID in .env when set. */
    telegramApiId: { type: Number, default: null },
    /** Telegram API app hash. Overrides TG_API_HASH in .env when set. */
    telegramApiHash: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ACCOUNT_STATUSES,
      default: 'new',
      index: true,
    },

    /**
     * Account role:
     * - "sender": included in campaign sender pool, can dispatch messages.
     * - "test_recipient": never sends; used to verify deliveries by reading
     *   their personal inbox via inbound sync.
     */
    role: {
      type: String,
      enum: ACCOUNT_ROLES,
      default: 'sender',
      index: true,
    },

    deviceProfile: { type: deviceProfileSchema, required: true },
    proxyId: { type: Types.ObjectId, ref: 'Proxy', default: null },

    dailyLimits: { type: dailyLimitsSchema, default: () => ({}) },
    dailyCounters: { type: dailyCountersSchema, default: () => ({}) },
    sendingWindow: { type: sendingWindowSchema, default: () => ({}) },

    healthScore: { type: Number, default: 1.0, min: 0, max: 1 },
    healthMetrics: { type: healthMetricsSchema, default: () => ({}) },

    floodWaitUntil: { type: Date, default: null, index: true },
    quarantineUntil: { type: Date, default: null, index: true },

    warmingStartedAt: { type: Date, default: null },
    warmingFinishesAt: { type: Date, default: null },

    lastUsedAt: { type: Date, default: null },
    lastInboundSyncAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: '' },
    lastErrorMessage: { type: String, default: '' },

    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'accounts' },
);

accountSchema.index({ phone: 1 }, { unique: true });
accountSchema.index({ telegramUsername: 1 }, { sparse: true });
accountSchema.index({ status: 1, floodWaitUntil: 1 });
accountSchema.index({ proxyId: 1 }, { sparse: true });
accountSchema.index({ status: 1, healthScore: -1 });

export type AccountDoc = InferSchemaType<typeof accountSchema> & {
  _id: Types.ObjectId;
};

export const AccountModel: Model<AccountDoc> = model<AccountDoc>('Account', accountSchema);
