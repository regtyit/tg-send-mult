import { Types } from 'mongoose';
import { AccountModel } from '../../db/models';

/** Remove a newly created account when post-import verification fails (CLI + API). */
export async function rollbackNewAccountOnVerifyFail(
  phone: string,
  existedBefore: boolean,
  importedId: Types.ObjectId | null,
): Promise<void> {
  if (existedBefore) return;
  if (importedId) {
    await AccountModel.deleteOne({ _id: importedId });
  } else {
    await AccountModel.deleteOne({ phone: phone.trim() });
  }
}
