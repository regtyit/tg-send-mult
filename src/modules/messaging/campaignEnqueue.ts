import { Types } from 'mongoose';
import { CampaignModel, DeliveryEventModel, MessageModel, TemplateModel } from '../../db/models';
import { computeTextHash } from '../dedup/hash';
import { pickStickyAccountForContact } from '../multi/stickyAssignment';
import { applyHomoglyphMix } from '../template/homoglyphs';
import { renderTemplateBody } from '../template/render';
import { resolveAudienceContacts } from '../contacts/importRows';
import { isMongoDuplicateKey } from '../../util/mongoError';
import { getSendQueue, SEND_JOB_NAME } from '../../queue/queues';
import { logger } from '../../logger';
import { isWithinTelegramMessageLength } from './telegramLimits';

export async function enqueueCampaignJobs(campaignId: string | Types.ObjectId): Promise<void> {
  const campaign = await CampaignModel.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'running') {
    throw new Error(`Campaign must be in "running" status (got ${campaign.status})`);
  }
  if (!campaign.accountPool?.length) {
    throw new Error('Campaign has empty sender pool. Pick at least one sender account.');
  }

  const template = await TemplateModel.findById(campaign.templateId);
  if (!template) throw new Error('Template not found');

  const rawContactIds = campaign.audience?.contactIds ?? [];
  const contactIds =
    rawContactIds.length > 0
      ? rawContactIds.map((id) => new Types.ObjectId(String(id)))
      : undefined;
  const contacts = await resolveAudienceContacts({
    contactIds,
    tags: campaign.audience?.tags ?? [],
  });

  if (!contacts.length) {
    throw new Error(
      'Campaign audience resolved to 0 contacts. Pick explicit contacts or add audience tags.',
    );
  }
  logger.info(
    { campaignId: campaign._id.toString(), contacts: contacts.length, senders: campaign.accountPool.length },
    'campaign: enqueue start',
  );

  const hg = campaign.homoglyphs;
  const homoglyphProbability =
    hg && typeof hg === 'object' && hg.enabled === true
      ? Math.min(1, Math.max(0, hg.probability ?? 0.35))
      : 0;

  let queued = 0;
  let failed = 0;
  for (const contact of contacts) {
    // Hard guard: queue at most one message per campaign+contact.
    const alreadyQueuedForCampaign = await MessageModel.exists({
      campaignId: campaign._id,
      contactId: contact._id,
    });
    if (alreadyQueuedForCampaign) {
      await CampaignModel.updateOne({ _id: campaign._id }, { $inc: { 'stats.skippedDuplicate': 1 } });
      continue;
    }

    let rendered = renderTemplateBody(template.body, contact);
    if (homoglyphProbability > 0) {
      rendered = applyHomoglyphMix(rendered, { probability: homoglyphProbability });
    }
    if (!isWithinTelegramMessageLength(rendered)) {
      logger.warn(
        { campaignId: campaign._id, contactId: contact._id, len: rendered.length },
        'campaign: rendered message exceeds Telegram limit',
      );
      await CampaignModel.updateOne({ _id: campaign._id }, { $inc: { 'stats.failed': 1 } });
      failed++;
      continue;
    }
    const textHash = computeTextHash(rendered);

    /**
     * Cross-campaign dedup: do not resend an identical text to a contact
     * who already received it via any past campaign. This protects against
     * accidental spam and matches the project plan's
     * "хеширование текста + userId" requirement.
     */
    const alreadySent = await MessageModel.exists({
      contactId: contact._id,
      textHash,
      status: 'sent',
    });
    if (alreadySent) {
      await CampaignModel.updateOne(
        { _id: campaign._id },
        { $inc: { 'stats.skippedDuplicate': 1 } },
      );
      continue;
    }

    let message;
    try {
      message = await MessageModel.create({
        campaignId: campaign._id,
        contactId: contact._id,
        textHash,
        renderedText: rendered,
        status: 'queued',
      });
    } catch (err) {
      if (isMongoDuplicateKey(err)) {
        await CampaignModel.updateOne({ _id: campaign._id }, { $inc: { 'stats.skippedDuplicate': 1 } });
        continue;
      }
      throw err;
    }
    await DeliveryEventModel.create({
      messageId: message._id,
      campaignId: campaign._id,
      accountId: null,
      contactId: contact._id,
      type: 'queued',
      payload: { source: 'campaign_enqueue' },
    });

    const pool = campaign.accountPool.map((id) => new Types.ObjectId(String(id)));
    const accountId = await pickStickyAccountForContact(contact, pool);
    if (!accountId) {
      await MessageModel.updateOne(
        { _id: message._id },
        {
          $set: {
            status: 'failed',
            error: {
              code: 'NO_ACCOUNT',
              message:
                'No active sender available for this contact. ' +
                'Either the pool is empty or the contact is sticky-bound to a sender not in the pool.',
            },
          },
        },
      );
      await CampaignModel.updateOne({ _id: campaign._id }, { $inc: { 'stats.failed': 1 } });
      failed++;
      continue;
    }

    await MessageModel.updateOne({ _id: message._id }, { $set: { accountId } });

    const q = getSendQueue(accountId.toString());
    await q.add(
      SEND_JOB_NAME,
      { messageId: message._id.toString() },
      { jobId: message._id.toString() },
    );
    await CampaignModel.updateOne({ _id: campaign._id }, { $inc: { 'stats.queued': 1 } });
    queued++;
  }
  logger.info(
    { campaignId: campaign._id.toString(), queued, failed, total: contacts.length },
    'campaign: enqueue done',
  );
}
