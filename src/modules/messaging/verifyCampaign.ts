import { Types } from 'mongoose';
import {
  AccountModel,
  CampaignModel,
  ContactModel,
  InboundReplyModel,
  MessageModel,
  ProxyModel,
} from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import { logger } from '../../logger';
import { syncInboundRepliesForAccount } from './syncInboundReplies';

export interface VerifyCampaignResult {
  campaignId: string;
  totalSent: number;
  testRecipients: number;
  observable: number;
  verified: number;
  missing: number;
  details: VerifyDetail[];
}

export interface VerifyDetail {
  messageId: string;
  contactId: string;
  contactPhone: string;
  testAccountId?: string;
  status: 'verified' | 'missing' | 'no_test_account';
  reason?: string;
}

function normalizePhone(raw: string): string {
  return String(raw || '').replace(/[^\d+]/g, '');
}

/**
 * After a campaign has been delivered, verify that messages actually reached
 * the receivers we know about by reading the inbox of any "test_recipient"
 * accounts whose phone matches a campaign contact.
 *
 * Pipeline:
 * 1. Force-sync the inbox of every test_recipient account (so we have the
 *    latest messages in our DB).
 * 2. For each "sent" message in the campaign, find the receiver Contact, look
 *    up a matching test_recipient Account by phone, and check whether the
 *    rendered text appears in the test_recipient's `inbound_replies` history.
 */
export async function verifyCampaignDelivery(campaignId: string): Promise<VerifyCampaignResult> {
  const id = new Types.ObjectId(String(campaignId));
  const campaign = await CampaignModel.findById(id);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const testAccounts: AccountDoc[] = await AccountModel.find({
    role: 'test_recipient',
    sessionEnc: { $ne: '' },
  });

  let scannedDialogs = 0;
  let savedTotal = 0;
  for (const acc of testAccounts) {
    const proxy = acc.proxyId ? await ProxyModel.findById(acc.proxyId) : null;
    try {
      const r = await syncInboundRepliesForAccount(acc, proxy, { markRead: true, force: true });
      if ('skipped' in r && r.skipped) continue;
      scannedDialogs += r.scanned;
      savedTotal += r.saved;
    } catch (err) {
      logger.warn(
        { err, accountId: acc._id.toString() },
        'verifyCampaign: test recipient sync failed',
      );
    }
  }
  logger.info(
    {
      campaignId: String(campaign._id),
      testAccounts: testAccounts.length,
      scannedDialogs,
      savedTotal,
    },
    'verifyCampaign: test inboxes synced',
  );

  const sentMessages = await MessageModel.find({ campaignId: id, status: 'sent' }).lean();

  const phoneToTestAccountId = new Map<string, Types.ObjectId>();
  for (const acc of testAccounts) {
    const p = normalizePhone(String(acc.phone || ''));
    if (p) phoneToTestAccountId.set(p, new Types.ObjectId(String(acc._id)));
  }

  const details: VerifyDetail[] = [];
  let verified = 0;
  let missing = 0;
  let observable = 0;

  for (const msg of sentMessages) {
    const contact = await ContactModel.findById(msg.contactId).lean();
    if (!contact) continue;

    const phone = normalizePhone(String(contact.phoneE164 || ''));
    const testAccountId = phone ? phoneToTestAccountId.get(phone) : undefined;
    if (!testAccountId) {
      details.push({
        messageId: String(msg._id),
        contactId: String(contact._id),
        contactPhone: contact.phoneE164 || '',
        status: 'no_test_account',
      });
      continue;
    }

    observable += 1;

    const text = String(msg.renderedText || '').trim();
    if (!text) {
      details.push({
        messageId: String(msg._id),
        contactId: String(contact._id),
        contactPhone: contact.phoneE164 || '',
        testAccountId: String(testAccountId),
        status: 'missing',
        reason: 'message has no rendered text',
      });
      missing += 1;
      continue;
    }

    const found = await InboundReplyModel.findOne({
      accountId: testAccountId,
      direction: 'incoming',
      text,
    })
      .select('_id telegramMessageId telegramDate')
      .lean();

    if (found) {
      verified += 1;
      details.push({
        messageId: String(msg._id),
        contactId: String(contact._id),
        contactPhone: contact.phoneE164 || '',
        testAccountId: String(testAccountId),
        status: 'verified',
      });
    } else {
      missing += 1;
      details.push({
        messageId: String(msg._id),
        contactId: String(contact._id),
        contactPhone: contact.phoneE164 || '',
        testAccountId: String(testAccountId),
        status: 'missing',
        reason: 'no inbound message with matching text',
      });
    }
  }

  return {
    campaignId: String(campaign._id),
    totalSent: sentMessages.length,
    testRecipients: testAccounts.length,
    observable,
    verified,
    missing,
    details,
  };
}
