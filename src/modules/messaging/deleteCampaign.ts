import { Types } from 'mongoose';
import { CampaignModel, DeliveryEventModel, MessageModel } from '../../db/models';
import { pauseCampaign } from './campaignLifecycle';

export async function deleteCampaign(campaignId: string): Promise<{ messagesRemoved: number }> {
  const id = new Types.ObjectId(campaignId);
  const campaign = await CampaignModel.findById(id);
  if (!campaign) throw new Error('Campaign not found');

  if (campaign.status === 'running') {
    await pauseCampaign(campaignId);
  }

  const msgRes = await MessageModel.deleteMany({ campaignId: id });
  await DeliveryEventModel.deleteMany({ campaignId: id });
  await CampaignModel.findByIdAndDelete(id);

  return { messagesRemoved: msgRes.deletedCount ?? 0 };
}
