import { Types } from 'mongoose';
import { AccountModel, CampaignModel, DeliveryEventModel, MessageModel, TemplateModel } from '../../db/models';
import { computeTextHash } from '../dedup/hash';
import { pickStickyAccountForContact } from '../multi/stickyAssignment';
import { applyHomoglyphMix } from '../template/homoglyphs';
import { renderTemplateBody } from '../template/render';
import { resolveAudienceContacts } from '../contacts/importRows';
import { isMongoDuplicateKey } from '../../util/mongoError';
import { getSendQueue, SEND_JOB_NAME } from '../../queue/queues';
import { logger } from '../../logger';
import { isWithinTelegramMessageLength } from './telegramLimits';
import { formatPoolEligibilityError } from '../multi/senderEligibility';

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

  const pool = campaign.accountPool.map((id) => new Types.ObjectId(String(id)));
  const poolAccounts = await AccountModel.find({ _id: { $in: pool } }).lean();
  const poolUnavailableMsg = formatPoolEligibilityError(poolAccounts);

  let queued = 0;
  let failed = 0;
  const assignmentCounts = new Map<string, number>();
  const stickyCtx = { assignmentCounts };

  for (const contact of contacts) {
    // One message per contact per campaign (any status — no resend on restart).
    const existingForCampaign = await MessageModel.findOne({
      campaignId: campaign._id,
      contactId: contact._id,
    })
      .select('status')
      .lean();
    if (existingForCampaign) {
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

    /** Cross-campaign: skip if this exact text was already delivered to the contact. */
    const alreadySentSameText = await MessageModel.exists({
      contactId: contact._id,
      textHash,
      status: 'sent',
    });
    if (alreadySentSameText) {
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

    const accountId = await pickStickyAccountForContact(contact, pool, stickyCtx);
    if (!accountId) {
      await MessageModel.updateOne(
        { _id: message._id },
        {
          $set: {
            status: 'failed',
            error: {
              code: 'NO_ACCOUNT',
              message: poolUnavailableMsg,
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
