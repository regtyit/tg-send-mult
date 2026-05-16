import { CampaignModel } from '../../db/models';
import { enqueueCampaignJobs } from './campaignEnqueue';

export async function startCampaign(campaignId: string): Promise<void> {
  const existing = await CampaignModel.findById(campaignId).lean();
  if (!existing) throw new Error('Campaign not found');
  if (existing.status === 'running') {
    // Idempotent start: do not enqueue again if already running.
    return;
  }
  const c = await CampaignModel.findByIdAndUpdate(
    campaignId,
    {
      $set: {
        status: 'running',
        startedAt: existing.startedAt ?? new Date(),
        finishedAt: null,
      },
    },
    { new: true },
  );
  if (!c) throw new Error('Campaign not found');
  try {
    await enqueueCampaignJobs(c._id);
  } catch (err) {
    await CampaignModel.findByIdAndUpdate(c._id, {
      $set: {
        status: 'failed',
        notes: `start failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    throw err;
  }
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  await CampaignModel.findByIdAndUpdate(campaignId, { $set: { status: 'paused' } });
}

export async function resumeCampaign(campaignId: string): Promise<void> {
  const c = await CampaignModel.findByIdAndUpdate(campaignId, { $set: { status: 'running' } }, { new: true });
  if (!c) throw new Error('Campaign not found');
}
