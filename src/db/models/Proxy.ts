import { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const proxySchema = new Schema(
  {
    label: { type: String, required: true },
    type: { type: String, enum: ['socks5', 'http', 'mtproto'], required: true },
    /** ISO 3166-1 alpha-2 country (example: US, RU) where proxy exits. */
    country: { type: String, default: '', trim: true, uppercase: true },
    host: { type: String, required: true },
    port: { type: Number, required: true },
    login: { type: String, default: '' },
    password: { type: String, default: '' },
    secret: { type: String, default: '' },
    healthScore: { type: Number, default: 1.0, min: 0, max: 1 },
    lastError: { type: String, default: '' },
    lastCheckedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'proxies' },
);

proxySchema.index({ label: 1 }, { unique: true });

export type ProxyDoc = InferSchemaType<typeof proxySchema> & { _id: Schema.Types.ObjectId };
export const ProxyModel: Model<ProxyDoc> = model<ProxyDoc>('Proxy', proxySchema);
