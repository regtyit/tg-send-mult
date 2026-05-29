import { Types } from 'mongoose';
import {
  AccountModel,
  ContactModel,
  DialogScriptModel,
  DialogSessionModel,
  DialogTurnModel,
  ProxyModel,
} from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import type { ContactDoc } from '../../db/models/Contact';
import type { DialogScriptDoc } from '../../db/models/DialogScript';
import type { DialogSessionDoc } from '../../db/models/DialogSession';
import { recordWarmingScriptDayForSession } from '../accounts/warming';
import { isWithinSendingWindowAccount, nextTimeWithinSendingWindow } from '../antilimit/window';
import { sendText } from '../messaging/send';
import { nextPeerCheckAt, peerCheckDelaySec, sessionDueForPeerCheck } from '../sync/timing';
import { pickDelayMs } from './delay';
import { findPeerTriggerInbound } from './checkTrigger';
import { planTurnForSession, totalTurnsForScript } from './planTurn';
import {
  peerFilterFromAccount,
  peerFilterFromContact,
  peerImportFirstName,
  peerImportFirstNameFromContact,
  peerStringFromAccount,
  peerStringFromContact,
} from './resolvePeer';
import { setTypingForPeer } from './setTyping';
import { syncPeerInboxForAccount, type SyncPeerInboxResult } from './syncPeerInbox';

export interface ExecuteTurnOptions {
  /** Manual Step / CLI: poll Telegram even if backoff has not elapsed. */
  forcePeerCheck?: boolean;
}

export interface ExecuteTurnResult {
  done: boolean;
  turnIndex: number;
  waiting?: boolean;
  error?: string;
}

async function scheduleWaitingPeer(
  session: DialogSessionDoc,
  attempt: number,
): Promise<void> {
  const at = nextPeerCheckAt(attempt);
  await DialogSessionModel.updateOne(
    { _id: session._id },
    {
      $set: {
        status: 'waiting_peer',
        nextRunAt: at,
        peerCheckAttempt: attempt,
        lastError: '',
      },
    },
  );
}

function peerSyncMarkedRead(result: SyncPeerInboxResult): Date | null {
  if ('skipped' in result && result.skipped) return null;
  return result.markedRead > 0 ? new Date() : null;
}

async function loadSessionContext(sessionId: Types.ObjectId) {
  const session = await DialogSessionModel.findById(sessionId);
  if (!session) return null;

  const script = await DialogScriptModel.findById(session.scriptId);
  const accountA = await AccountModel.findById(session.accountAId);
  if (!script || !accountA?.sessionEnc) return { session, script: null, accountA, peerAccount: null, peerContact: null };

  let peerAccount = null;
  let peerContact = null;
  if (session.peerType === 'account' && session.peerAccountId) {
    peerAccount = await AccountModel.findById(session.peerAccountId);
  } else if (session.peerType === 'contact' && session.peerContactId) {
    peerContact = await ContactModel.findById(session.peerContactId);
  }

  return { session, script, accountA, peerAccount, peerContact };
}

async function lastTurnSentAt(sessionId: Types.ObjectId): Promise<Date | null> {
  const last = await DialogTurnModel.findOne({ sessionId })
    .sort({ turnIndex: -1 })
    .select('sentAt')
    .lean();
  return last?.sentAt ?? null;
}

async function triggerSince(session: DialogSessionDoc, sessionId: Types.ObjectId): Promise<Date | null> {
  if (session.waitCursorAt) return session.waitCursorAt;
  return lastTurnSentAt(sessionId);
}

async function ensurePeerTrigger(
  session: DialogSessionDoc,
  accountA: AccountDoc,
  peerAccount: AccountDoc | null,
  peerContact: ContactDoc | null,
  trigger: string,
  opts: { forcePeerCheck?: boolean } = {},
): Promise<boolean> {
  const since = await triggerSince(session, session._id);
  let match = await findPeerTriggerInbound(
    session,
    accountA._id,
    peerAccount,
    peerContact,
    trigger,
    since,
  );

  if (!match.matched && sessionDueForPeerCheck(session, { force: opts.forcePeerCheck })) {
    const proxy = accountA.proxyId ? await ProxyModel.findById(accountA.proxyId) : null;
    const peerFilter =
      session.peerType === 'contact' && peerContact
        ? peerFilterFromContact(peerContact)
        : peerAccount
          ? peerFilterFromAccount(peerAccount)
          : {};

    await syncPeerInboxForAccount(
      accountA,
      proxy,
      {
        ...peerFilter,
        markRead: true,
        dialogSessionId: session._id,
        sinceEpochSec: since ? Math.max(0, Math.floor(since.getTime() / 1000) - 30) : 0,
        force: opts.forcePeerCheck,
      },
      session,
    );

    match = await findPeerTriggerInbound(
      session,
      accountA._id,
      peerAccount,
      peerContact,
      trigger,
      since,
    );
  }

  if (match.matched && match.messageAt) {
    const cursor = new Date(match.messageAt.getTime() + 1);
    await DialogSessionModel.updateOne({ _id: session._id }, { $set: { waitCursorAt: cursor } });
  }

  return match.matched;
}

async function scheduleSessionAfterTurn(
  session: DialogSessionDoc,
  script: DialogScriptDoc,
  accountA: AccountDoc,
  peerAccount: AccountDoc | null,
  peerContact: ContactDoc | null,
  peerStrA: string,
  peerStrB: string,
  nextTurn: number,
  total: number,
): Promise<{ done: boolean; waiting: boolean }> {
  if (nextTurn >= total) {
    await DialogSessionModel.updateOne(
      { _id: session._id },
      {
        $set: {
          currentTurn: nextTurn,
          status: 'completed',
          completedAt: new Date(),
          nextRunAt: null,
          lastError: '',
        },
      },
    );
    await recordWarmingScriptDayForSession(session);
    return { done: true, waiting: false };
  }

  const snap = await DialogSessionModel.findById(session._id).lean();
  const nextPlanned = snap
    ? await planTurnForSession(
        { ...snap, currentTurn: nextTurn } as DialogSessionDoc,
        script,
        accountA,
        peerAccount,
        peerContact,
        peerStrA,
        peerStrB,
      )
    : null;

  const needsPeerWait = Boolean(nextPlanned?.waitForText?.trim());
  let nextRunAt: Date | null = null;
  let nextStatus: 'running' | 'waiting_peer' = 'running';

  if (needsPeerWait) {
    nextStatus = 'waiting_peer';
    nextRunAt = nextPeerCheckAt(0);
  } else if (session.runMode === 'auto' && nextPlanned) {
    const delayMs = pickDelayMs(nextPlanned.delaySecMin, nextPlanned.delaySecMax);
    let candidate = new Date(Date.now() + delayMs);
    const nextSender = await AccountModel.findById(nextPlanned.senderAccountId);
    if (nextSender) {
      candidate = nextTimeWithinSendingWindow(nextSender, candidate);
    }
    nextRunAt = candidate;
  }

  await DialogSessionModel.updateOne(
    { _id: session._id },
    {
      $set: {
        currentTurn: nextTurn,
        status: nextStatus,
        nextRunAt,
        peerCheckAttempt: 0,
        lastError: '',
      },
    },
  );

  return { done: false, waiting: needsPeerWait };
}

export async function executeDialogTurn(
  sessionId: Types.ObjectId,
  opts: ExecuteTurnOptions = {},
): Promise<ExecuteTurnResult> {
  const ctx = await loadSessionContext(sessionId);
  if (!ctx?.session || !ctx.script) {
    return { done: true, turnIndex: -1, error: 'Session or script not found' };
  }

  const { session, script, accountA, peerAccount, peerContact } = ctx;

  if (session.status !== 'running' && session.status !== 'waiting_peer') {
    return { done: true, turnIndex: session.currentTurn, error: 'Session not running' };
  }

  const peerStrA =
    session.peerType === 'account' && peerAccount
      ? peerStringFromAccount(peerAccount)
      : peerContact
        ? peerStringFromContact(peerContact)
        : '';
  const peerStrB = peerStringFromAccount(accountA);

  if (!peerStrA && session.peerType === 'account') {
    await DialogSessionModel.updateOne(
      { _id: session._id },
      { $set: { status: 'failed', lastError: 'Peer account has no phone/username' } },
    );
    return { done: true, turnIndex: session.currentTurn, error: 'Peer not resolvable' };
  }
  if (!peerStrA && session.peerType === 'contact') {
    await DialogSessionModel.updateOne(
      { _id: session._id },
      { $set: { status: 'failed', lastError: 'Contact has no phone/username' } },
    );
    return { done: true, turnIndex: session.currentTurn, error: 'Contact not resolvable' };
  }

  const planned = await planTurnForSession(
    session,
    script,
    accountA,
    peerAccount,
    peerContact,
    peerStrA,
    peerStrB,
  );

  const total = totalTurnsForScript(script);
  if (!planned) {
    await DialogSessionModel.updateOne(
      { _id: session._id },
      { $set: { status: 'completed', completedAt: new Date(), nextRunAt: null } },
    );
    await recordWarmingScriptDayForSession(session);
    return { done: true, turnIndex: session.currentTurn };
  }

  if (await DialogTurnModel.exists({ sessionId: session._id, turnIndex: planned.turnIndex })) {
    const nextTurn = planned.turnIndex + 1;
    const advanced = await scheduleSessionAfterTurn(
      session,
      script,
      accountA,
      peerAccount,
      peerContact,
      peerStrA,
      peerStrB,
      nextTurn,
      total,
    );
    return {
      done: advanced.done,
      turnIndex: planned.turnIndex,
      waiting: advanced.waiting,
    };
  }

  if (planned.waitForText) {
    const ready = await ensurePeerTrigger(
      session,
      accountA,
      peerAccount,
      peerContact,
      planned.waitForText,
      { forcePeerCheck: opts.forcePeerCheck },
    );
    if (!ready) {
      const attempt = Math.max(0, Number(session.peerCheckAttempt ?? 0));
      await scheduleWaitingPeer(session, attempt + 1);
      return { done: false, turnIndex: planned.turnIndex, waiting: true };
    }
    await DialogSessionModel.updateOne(
      { _id: session._id },
      { $set: { peerCheckAttempt: 0, nextRunAt: null } },
    );
    if (session.status === 'waiting_peer') {
      await DialogSessionModel.updateOne({ _id: session._id }, { $set: { status: 'running' } });
    }
  }

  const sender = await AccountModel.findById(planned.senderAccountId);
  if (!sender?.sessionEnc) {
    await DialogSessionModel.updateOne(
      { _id: session._id },
      { $set: { status: 'failed', lastError: 'Sender missing session' } },
    );
    return { done: true, turnIndex: planned.turnIndex, error: 'No sender session' };
  }

  if (session.runMode === 'auto' && !isWithinSendingWindowAccount(sender)) {
    const nextRunAt = nextTimeWithinSendingWindow(sender, new Date());
    await DialogSessionModel.updateOne(
      { _id: session._id },
      {
        $set: {
          status: 'running',
          nextRunAt,
          lastError: 'Deferred: outside sending window',
        },
      },
    );
    return { done: false, turnIndex: planned.turnIndex, waiting: false };
  }

  const proxy = sender.proxyId ? await ProxyModel.findById(sender.proxyId) : null;
  let readAt: Date | null = null;
  let turnError = '';
  const importContactFirstName =
    planned.senderAccountId.equals(accountA._id)
      ? session.peerType === 'contact' && peerContact
        ? peerImportFirstNameFromContact(peerContact)
        : peerImportFirstName(peerAccount)
      : peerImportFirstName(accountA);

  try {
    if (planned.side === 'sync') {
      const peerFilter =
        session.peerType === 'contact' && peerContact
          ? peerFilterFromContact(peerContact)
          : peerAccount
            ? peerFilterFromAccount(peerAccount)
            : {};
      const sync = await syncPeerInboxForAccount(
        sender,
        proxy,
        {
          ...peerFilter,
          markRead: true,
          dialogSessionId: session._id,
          force: opts.forcePeerCheck,
        },
        session,
      );
      readAt = peerSyncMarkedRead(sync);
    } else {
      if (planned.typingSec > 0 && planned.text) {
        await setTypingForPeer(sender, proxy, planned.peer, planned.typingSec, {
          importContactFirstName,
        });
      }
      if (planned.text) {
        await sendText(sender, proxy, planned.peer, planned.text, { importContactFirstName });
      }
    }
  } catch (err) {
    turnError = err instanceof Error ? err.message : String(err);
    await DialogSessionModel.updateOne(
      { _id: session._id },
      { $set: { status: 'failed', lastError: turnError } },
    );
    await DialogTurnModel.create({
      sessionId: session._id,
      turnIndex: planned.turnIndex,
      senderAccountId: planned.senderAccountId,
      side: planned.side,
      text: planned.text,
      peer: planned.peer,
      error: turnError,
      sentAt: new Date(),
    });
    return { done: true, turnIndex: planned.turnIndex, error: turnError };
  }

  await DialogTurnModel.create({
    sessionId: session._id,
    turnIndex: planned.turnIndex,
    senderAccountId: planned.senderAccountId,
    side: planned.side,
    text: planned.text,
    peer: planned.peer,
    telegramMessageId: 0,
    readAt,
    sentAt: new Date(),
  });

  const nextTurn = planned.turnIndex + 1;
  const advanced = await scheduleSessionAfterTurn(
    session,
    script,
    accountA,
    peerAccount,
    peerContact,
    peerStrA,
    peerStrB,
    nextTurn,
    total,
  );
  return { done: advanced.done, turnIndex: planned.turnIndex, waiting: advanced.waiting };
}
