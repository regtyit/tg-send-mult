import { Types } from 'mongoose';
import { InboundReplyModel } from '../../db/models';

/** Persist read status for recipient (incoming) messages after Telegram read ack. */
export async function markInboundRepliesReadInDb(
  accountId: Types.ObjectId,
  peerUserIds: string[],
  extra?: { dialogSessionId?: Types.ObjectId | null },
): Promise<number> {
  const peers = [...new Set(peerUserIds.map((p) => String(p || '').trim()).filter(Boolean))];
  if (!peers.length) return 0;

  const readAt = new Date();
  const res = await InboundReplyModel.updateMany(
    {
      accountId,
      direction: 'incoming',
      peerUserId: { $in: peers },
    },
    {
      $set: {
        readAt,
        ...(extra?.dialogSessionId ? { dialogSessionId: extra.dialogSessionId } : {}),
      },
    },
  );
  return res.modifiedCount ?? 0;
}
