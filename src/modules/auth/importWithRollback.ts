import { Types } from 'mongoose';
import { AccountModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import { TgDomainError } from '../../telegram/errors';
import { rollbackNewAccountOnVerifyFail } from './rollbackAccount';

export interface ImportAccountWithRollbackOptions {
  /**
   * When true, a newly created row with a saved session is kept on verify failure
   * (proxy/network) so the operator can fix MTProxy and retry — the row is not deleted.
   * CLI imports keep the default false for a strict pass/fail.
   */
  preserveNewAccountOnFailure?: boolean;
}

/**
 * Run an import that may persist then verify. On failure, delete the row if it was
 * newly created (same behavior as CLI auth import commands), unless
 * `preserveNewAccountOnFailure` is set for API flows.
 */
export async function importAccountWithRollback(
  phone: string,
  run: () => Promise<AccountDoc>,
  options?: ImportAccountWithRollbackOptions,
): Promise<AccountDoc> {
  const trimmed = phone.trim();
  const existedBefore = Boolean(await AccountModel.exists({ phone: trimmed }));
  let importedId: Types.ObjectId | null = null;
  try {
    const account = await run();
    importedId = account._id;
    return account;
  } catch (err) {
    if (options?.preserveNewAccountOnFailure && !existedBefore) {
      /**
       * `run()` often persists the account (session row) before verify/connect throws.
       * In that case `importedId` was never set because assignment happens only after
       * `run()` resolves. Look up the newest row for this phone so we do not run
       * `rollbackNewAccountOnVerifyFail` → deleteOne({ phone }) and wipe the import.
       */
      const row =
        (importedId
          ? await AccountModel.findById(importedId).lean()
          : await AccountModel.findOne({ phone: trimmed }).sort({ createdAt: -1 }).lean()) ?? null;
      const hasSession = typeof row?.sessionEnc === 'string' && row.sessionEnc.trim().length > 0;
      if (hasSession && row?._id) {
        const code = err instanceof TgDomainError ? err.code : 'import_verify_failed';
        const message = err instanceof Error ? err.message : String(err);
        await AccountModel.findByIdAndUpdate(row._id, {
          $set: {
            status: 'new',
            proxyId: null,
            sessionAuthorizedAt: null,
            lastErrorCode: code,
            lastErrorMessage: message.slice(0, 2000),
            warmingStartedAt: null,
            warmingFinishesAt: null,
            warmingScriptDaysCompleted: 0,
            warmingLastScriptDay: '',
          },
        });
        throw err;
      }
    }
    await rollbackNewAccountOnVerifyFail(trimmed, existedBefore, importedId);
    throw err;
  }
}
