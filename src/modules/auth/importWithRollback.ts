import { Types } from 'mongoose';
import { AccountModel } from '../../db/models';
import type { AccountDoc } from '../../db/models/Account';
import { rollbackNewAccountOnVerifyFail } from './rollbackAccount';

/**
 * Run an import that may persist then verify. On failure, delete the row if it was
 * newly created (same behavior as CLI auth import commands).
 */
export async function importAccountWithRollback(
  phone: string,
  run: () => Promise<AccountDoc>,
): Promise<AccountDoc> {
  const trimmed = phone.trim();
  const existedBefore = Boolean(await AccountModel.exists({ phone: trimmed }));
  let importedId: Types.ObjectId | null = null;
  try {
    const account = await run();
    importedId = account._id;
    return account;
  } catch (err) {
    await rollbackNewAccountOnVerifyFail(trimmed, existedBefore, importedId);
    throw err;
  }
}
