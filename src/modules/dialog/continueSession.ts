import { Types } from 'mongoose';
import { DialogSessionModel } from '../../db/models';
import { executeDialogTurn } from './executeTurn';
import { enqueueDialogTurn } from '../../queue/queues';
import { dialogWaitPollMs } from '../sync/timing';

/**
 * Run one dialog turn and schedule the next auto step (queue delay or peer-wait poll).
 */
export async function continueDialogSession(sessionId: Types.ObjectId | string): Promise<void> {
  const id = typeof sessionId === 'string' ? new Types.ObjectId(sessionId) : sessionId;
  const session = await DialogSessionModel.findById(id).lean();
  if (!session || session.runMode !== 'auto') return;
  if (session.status !== 'running' && session.status !== 'waiting_peer') return;

  const result = await executeDialogTurn(id);
  if (result.done) return;

  const updated = await DialogSessionModel.findById(id).lean();
  if (!updated || updated.runMode !== 'auto') return;

  if (updated.status === 'waiting_peer') {
    await enqueueDialogTurn(id.toString(), dialogWaitPollMs());
    return;
  }
  if (updated.status === 'running' && updated.nextRunAt) {
    const delayMs = Math.max(0, updated.nextRunAt.getTime() - Date.now());
    await enqueueDialogTurn(id.toString(), delayMs);
  }
}
