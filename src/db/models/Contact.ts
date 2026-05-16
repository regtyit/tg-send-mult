import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

export const CONTACT_STATUSES = ['new', 'resolved', 'unresolvable', 'blocked'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

const contactSchema = new Schema(
  {
    phoneE164: { type: String, default: '', trim: true },
    username: { type: String, default: '' },
    userId: { type: String, default: '' },
    accessHash: { type: String, default: '' },

    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },

    status: {
      type: String,
      enum: CONTACT_STATUSES,
      default: 'new',
      index: true,
    },

    tags: { type: [String], default: [], index: true },
    importedFrom: { type: String, default: '' },
    extras: { type: Schema.Types.Mixed, default: {} },

    lastResolvedByAccountId: { type: Types.ObjectId, ref: 'Account', default: null },
    resolvedAt: { type: Date, default: null },
    blockedReason: { type: String, default: '' },

    /**
     * Sticky sender assignment. Once a contact is delivered through a sender
     * account, all future campaigns will reuse the same sender so a receiver
     * never sees messages from two different sender accounts.
     */
    assignedSenderId: { type: Types.ObjectId, ref: 'Account', default: null, index: true },
    assignedSenderAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'contacts' },
);

contactSchema.index(
  { phoneE164: 1 },
  {
    unique: true,
    partialFilterExpression: { phoneE164: { $type: 'string', $ne: '' } },
  },
);
contactSchema.index({ username: 1 }, { sparse: true });

export type ContactDoc = InferSchemaType<typeof contactSchema> & { _id: Types.ObjectId };

export const ContactModel: Model<ContactDoc> = model<ContactDoc>('Contact', contactSchema);
