import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { UnrecoverableError } from 'bullmq';
import { DialogSessionModel } from '../../db/models';
import { continueDialogSession } from '../../modules/dialog/continueSession';

export async function processDialogTurnJob(job: Job<{ sessionId: string }>): Promise<void> {
  const sessionId = job.data.sessionId;
  const session = await DialogSessionModel.findById(sessionId).lean();
  if (!session) {
    throw new UnrecoverableError(`Dialog session ${job.data.sessionId} not found`);
  }
  if (session.status !== 'running' && session.status !== 'waiting_peer') {
    return;
  }
  if (session.runMode !== 'auto') {
    return;
  }

  await continueDialogSession(new Types.ObjectId(sessionId));
}
