import { parse } from 'csv-parse/sync';
import { ContactModel } from '../../db/models';
import type { ContactDoc } from '../../db/models/Contact';
import { toE164 } from './normalize';

export interface ImportRow {
  phone?: string;
  Phone?: string;
  PHONE?: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  username?: string;
  Username?: string;
  USERNAME?: string;
  tags?: string;
  [key: string]: unknown;
}

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim();
}

function normalizeUsername(v: string): string {
  const u = v.trim().replace(/^@+/, '');
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(u)) return '';
  return u.toLowerCase();
}

export interface ContactImportLineError {
  line: number;
  reason: string;
}

export async function importContactsFromRows(
  rows: ImportRow[],
  opts: { defaultCountry?: string; tags?: string[]; source?: string } = {},
): Promise<{ upserted: number; invalid: number; errors: ContactImportLineError[] }> {
  let upserted = 0;
  let invalid = 0;
  const errors: ContactImportLineError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 2;
    const raw =
      (typeof row.phone === 'string' && row.phone) ||
      (typeof row.Phone === 'string' && row.Phone) ||
      (typeof row.PHONE === 'string' && row.PHONE) ||
      '';
    const usernameCandidate = normalizeUsername(
      cleanText(row.username) || cleanText(row.Username) || cleanText(row.USERNAME),
    );
    const usernameFromPhone = raw.trim().startsWith('@') ? normalizeUsername(raw) : '';
    const username = usernameCandidate || usernameFromPhone;
    const e164 = username ? null : toE164(raw, opts.defaultCountry);
    if (!e164 && !username) {
      invalid++;
      errors.push({ line, reason: 'missing phone or username' });
      continue;
    }

    const firstName = cleanText(row.firstName) || cleanText(row.first_name);
    const lastName = cleanText(row.lastName) || cleanText(row.last_name);
    const rowTags =
      typeof row.tags === 'string'
        ? row.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];
    const allTags = [...new Set([...(opts.tags ?? []), ...rowTags])];

    const extras: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (
        [
          'phone',
          'Phone',
          'PHONE',
          'firstName',
          'first_name',
          'lastName',
          'last_name',
          'username',
          'Username',
          'USERNAME',
          'tags',
        ].includes(
          k,
        )
      ) {
        continue;
      }
      if (typeof v === 'string' || typeof v === 'number') extras[k] = String(v);
    }

    const existing = e164
      ? await ContactModel.findOne({ phoneE164: e164 }).lean()
      : await ContactModel.findOne({
          username: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        }).lean();
    const mergedExtras = { ...(existing?.extras ?? {}), ...extras };
    const mergedTags = [...new Set([...(existing?.tags ?? []), ...allTags])];

    const phone = e164 || existing?.phoneE164 || '';
    const setDoc = {
      // Preserve known names/usernames when import rows are partial.
      firstName: firstName || existing?.firstName || '',
      lastName: lastName || existing?.lastName || '',
      username: username || existing?.username || '',
      tags: mergedTags,
      importedFrom: opts.source ?? 'import',
      extras: mergedExtras,
      ...(phone ? { phoneE164: phone } : {}),
    };
    if (existing?._id) {
      const update: { $set: typeof setDoc; $unset?: { phoneE164: 1 } } = { $set: setDoc };
      if (!phone) update.$unset = { phoneE164: 1 };
      await ContactModel.findByIdAndUpdate(existing._id, update);
    } else {
      await ContactModel.create(setDoc);
    }
    upserted++;
  }

  return { upserted, invalid, errors };
}

export function parseCsvBuffer(buf: Buffer | string): ImportRow[] {
  const text = typeof buf === 'string' ? buf : buf.toString('utf8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as ImportRow[];
  return records;
}

export function parseJsonBuffer(buf: Buffer | string): ImportRow[] {
  const text = typeof buf === 'string' ? buf : buf.toString('utf8');
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) {
    throw new Error('JSON import expects an array of objects');
  }
  return data as ImportRow[];
}

export async function resolveAudienceContacts(opts: {
  contactIds?: import('mongoose').Types.ObjectId[];
  tags?: string[];
}): Promise<ContactDoc[]> {
  const q: Record<string, unknown> = {};
  if (opts.contactIds?.length) {
    q._id = { $in: opts.contactIds };
  } else if (opts.tags?.length) {
    q.tags = { $in: opts.tags };
  } else {
    return [];
  }
  return ContactModel.find(q).exec();
}
