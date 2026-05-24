import { Types } from 'mongoose';
import type { DialogScriptDoc } from '../../db/models/DialogScript';
import type { DialogSessionDoc } from '../../db/models/DialogSession';
import type { AccountDoc } from '../../db/models/Account';
import type { ContactDoc } from '../../db/models/Contact';
import { TemplateModel } from '../../db/models';
import { renderTemplateBody } from '../template/render';
import { delayRangeFromPause } from './delay';

export interface PlannedTurn {
  turnIndex: number;
  side: 'a' | 'b' | 'sync';
  /** Account that sends or syncs inbox. */
  senderAccountId: Types.ObjectId;
  peer: string;
  text: string;
  delaySecMin: number;
  delaySecMax: number;
  typingSec: number;
  /** When set, this turn does not run until the peer sends this exact message (normalized match). */
  waitForText: string;
}

function delayRange(script: DialogScriptDoc, min?: number, max?: number): { min: number; max: number } {
  const lo = min ?? script.defaultDelaySecMin ?? 30;
  const hi = max ?? script.defaultDelaySecMax ?? 90;
  if (lo === hi && lo > 0) {
    return delayRangeFromPause(lo);
  }
  return { min: Math.max(0, lo), max: Math.max(lo, hi) };
}

function contactLike(
  peerContact: ContactDoc | null,
  peerAccount: AccountDoc | null,
): ContactDoc {
  return (
    peerContact ??
    ({
      firstName: peerAccount?.label || '',
      lastName: '',
      phoneE164: peerAccount?.phone || '',
      username: peerAccount?.telegramUsername || '',
      extras: {},
    } as ContactDoc)
  );
}

async function resolveTurnText(
  def: { text?: string; templateId?: unknown },
  contact: ContactDoc,
): Promise<string> {
  const templateId = def.templateId ? new Types.ObjectId(String(def.templateId)) : null;
  if (templateId) {
    const template = await TemplateModel.findById(templateId);
    if (!template) return '';
    return renderTemplateBody(template.body, contact);
  }
  return String(def.text || '').trim();
}

export async function planTurnForSession(
  session: DialogSessionDoc,
  script: DialogScriptDoc,
  accountA: AccountDoc,
  peerAccount: AccountDoc | null,
  peerContact: ContactDoc | null,
  peerStrA: string,
  peerStrB: string,
): Promise<PlannedTurn | null> {
  const idx = session.currentTurn;
  const typingSec = script.typingSec ?? 3;
  const contact = contactLike(peerContact, peerAccount);

  if (script.mode === 'template_pairs') {
    const totalTurns = (script.rounds ?? 1) * 2;
    if (idx >= totalTurns) return null;

    const isQuestion = idx % 2 === 0;
    const templateId = isQuestion ? script.questionTemplateId : script.answerTemplateId;
    if (!templateId) return null;

    const template = await TemplateModel.findById(templateId);
    if (!template) return null;

    const text = renderTemplateBody(template.body, contact);
    const dr = delayRange(script);
    const peerWait = String(script.peerWaitText || '').trim();

    if (isQuestion) {
      return {
        turnIndex: idx,
        side: 'a',
        senderAccountId: accountA._id,
        peer: peerStrA,
        text,
        delaySecMin: dr.min,
        delaySecMax: dr.max,
        typingSec,
        waitForText: idx > 0 && peerWait ? peerWait : '',
      };
    }

    if (session.peerType === 'contact') {
      return {
        turnIndex: idx,
        side: 'sync',
        senderAccountId: accountA._id,
        peer: peerStrA,
        text: '',
        delaySecMin: dr.min,
        delaySecMax: dr.max,
        typingSec: 0,
        waitForText: peerWait,
      };
    }

    if (!peerAccount) return null;
    return {
      turnIndex: idx,
      side: 'b',
      senderAccountId: peerAccount._id,
      peer: peerStrB,
      text,
      delaySecMin: dr.min,
      delaySecMax: dr.max,
      typingSec,
      waitForText: '',
    };
  }

  const turns = script.turns ?? [];
  if (idx >= turns.length) return null;
  const def = turns[idx]!;
  const dr = delayRange(script, def.delaySecMin, def.delaySecMax);
  const text = await resolveTurnText(
    { text: def.text, templateId: def.templateId },
    contact,
  );
  const waitForText = String(def.waitForText || '').trim();

  if (def.side === 'a') {
    return {
      turnIndex: idx,
      side: 'a',
      senderAccountId: accountA._id,
      peer: peerStrA,
      text,
      delaySecMin: dr.min,
      delaySecMax: dr.max,
      typingSec,
      waitForText,
    };
  }

  if (session.peerType === 'contact') {
    return {
      turnIndex: idx,
      side: 'sync',
      senderAccountId: accountA._id,
      peer: peerStrA,
      text: '',
      delaySecMin: dr.min,
      delaySecMax: dr.max,
      typingSec: 0,
      waitForText,
    };
  }

  if (!peerAccount) return null;
  return {
    turnIndex: idx,
    side: 'b',
    senderAccountId: peerAccount._id,
    peer: peerStrB,
    text,
    delaySecMin: dr.min,
    delaySecMax: dr.max,
    typingSec,
    waitForText,
  };
}

export function totalTurnsForScript(script: DialogScriptDoc): number {
  if (script.mode === 'template_pairs') return (script.rounds ?? 1) * 2;
  return (script.turns ?? []).length;
}
