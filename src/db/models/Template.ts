import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

const templateSchema = new Schema(
  {
    name: { type: String, required: true },
    body: { type: String, required: true },
    placeholders: { type: [String], default: [] },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'templates' },
);

templateSchema.index({ name: 1 }, { unique: true });

export type TemplateDoc = InferSchemaType<typeof templateSchema> & { _id: Types.ObjectId };

export const TemplateModel: Model<TemplateDoc> = model<TemplateDoc>('Template', templateSchema);
