import type { Types } from 'mongoose';
import { SessionEventModel, type SessionEventType } from '../../db/models/SessionEvent';

export async function logSessionEvent(
  accountId: Types.ObjectId,
  type: SessionEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await SessionEventModel.create({ accountId, type, payload });
}
