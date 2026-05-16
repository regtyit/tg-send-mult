import { Types } from 'mongoose';
import { AccountModel } from '../../db/models';

const OID24 = /^[a-f0-9]{24}$/i;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function isMostlyPhoneToken(t: string): boolean {
  const d = digitsOnly(t);
  return d.length >= 8 && d.length <= 15 && /^[\d+\s().-]+$/.test(t.replace(/@/g, ''));
}

/**
 * Map free-text account references to MongoDB ids. Accepts:
 * - 24-char ObjectId
 * - Phone in common shapes (+E.164, spaces)
 * - Telegram @username (must match `telegramUsername` on the account, filled after login)
 */
export async function resolveAccountSpecifiers(
  raw: string[],
): Promise<{ ids: Types.ObjectId[]; unresolved: string[] }> {
  const tokens = raw.map((s) => s.trim()).filter(Boolean);
  const accounts = await AccountModel.find()
    .select('_id phone telegramUsername')
    .lean();

  const byId = new Map<string, Types.ObjectId>();
  const byPhoneDigits = new Map<string, Types.ObjectId>();
  const byUsername = new Map<string, Types.ObjectId>();
  for (const a of accounts) {
    const id = String(a._id);
    byId.set(id.toLowerCase(), new Types.ObjectId(id));
    const phoneDigits = digitsOnly(String(a.phone ?? ''));
    if (phoneDigits) byPhoneDigits.set(phoneDigits, new Types.ObjectId(id));
    const uname = String(a.telegramUsername ?? '').trim().toLowerCase();
    if (uname) byUsername.set(uname, new Types.ObjectId(id));
  }

  const ids: Types.ObjectId[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const t of tokens) {
    if (OID24.test(t) && Types.ObjectId.isValid(t)) {
      const found = byId.get(t.toLowerCase());
      if (found) {
        const id = found.toString();
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(found);
        }
        continue;
      }
      unresolved.push(t);
      continue;
    }

    if (isMostlyPhoneToken(t)) {
      const d = digitsOnly(t);
      const found = byPhoneDigits.get(d);
      if (found) {
        const id = found.toString();
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(found);
        }
        continue;
      }
      unresolved.push(t);
      continue;
    }

    const uname = t.startsWith('@') ? t.slice(1) : t;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{3,}$/.test(uname)) {
      unresolved.push(t);
      continue;
    }

    const found = byUsername.get(uname.toLowerCase());
    if (found) {
      const id = found.toString();
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(found);
      }
      continue;
    }
    unresolved.push(t);
  }

  return { ids, unresolved };
}
