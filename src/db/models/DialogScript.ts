import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const dialogTurnDefSchema = new Schema(
  {
    side: { type: String, enum: ['a', 'b'], required: true },
    text: { type: String, default: '' },
    templateId: { type: Types.ObjectId, ref: 'Template', default: null },
    waitForText: { type: String, default: '' },
    delaySecMin: { type: Number, default: 30 },
    delaySecMax: { type: Number, default: 90 },
  },
  { _id: false },
);

const dialogScriptSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    mode: { type: String, enum: ['turns', 'template_pairs'], default: 'turns' },
    turns: { type: [dialogTurnDefSchema], default: [] },
    questionTemplateId: { type: Types.ObjectId, ref: 'Template', default: null },
    answerTemplateId: { type: Types.ObjectId, ref: 'Template', default: null },
    /** Incoming text to wait for before each answer/sync step when peer is a contact. */
    peerWaitText: { type: String, default: '' },
    rounds: { type: Number, default: 1, min: 1 },
    defaultDelaySecMin: { type: Number, default: 30 },
    defaultDelaySecMax: { type: Number, default: 90 },
    typingSec: { type: Number, default: 3, min: 0, max: 30 },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'dialog_scripts' },
);

dialogScriptSchema.index({ name: 1 }, { unique: true });

export type DialogScriptDoc = InferSchemaType<typeof dialogScriptSchema> & { _id: Types.ObjectId };

export const DialogScriptModel: Model<DialogScriptDoc> = model<DialogScriptDoc>(
  'DialogScript',
  dialogScriptSchema,
);
