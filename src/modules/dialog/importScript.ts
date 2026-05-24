import { parseCsvBuffer, parseJsonBuffer } from '../contacts/importRows';

export interface ImportedDialogTurnRow {
  side: 'a' | 'b';
  text: string;
  templateId?: string;
  waitForText?: string;
  delaySecMin?: number;
  delaySecMax?: number;
}

function parseSide(raw: unknown): 'a' | 'b' | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'a' || s === 'sidea' || s === 'sender') return 'a';
  if (s === 'b' || s === 'sideb' || s === 'peer') return 'b';
  return null;
}

function rowToTurn(row: Record<string, unknown>): ImportedDialogTurnRow | null {
  const side =
    parseSide(row.side) ??
    parseSide(row.Side) ??
    parseSide(row.SIDE) ??
    parseSide(row.role);
  const text = String(row.text ?? row.Text ?? row.message ?? row.Message ?? '').trim();
  const templateId = String(row.templateId ?? row.template_id ?? row.TemplateId ?? '').trim();
  const waitForText = String(
    row.waitForText ?? row.wait_for_text ?? row.trigger ?? row.Trigger ?? '',
  ).trim();
  if (!side || (!text && !templateId)) return null;

  const minRaw = row.delaySecMin ?? row.delay_min ?? row.delayMin;
  const maxRaw = row.delaySecMax ?? row.delay_max ?? row.delayMax;
  const delaySecMin =
    minRaw !== undefined && minRaw !== '' ? Number.parseInt(String(minRaw), 10) : undefined;
  const delaySecMax =
    maxRaw !== undefined && maxRaw !== '' ? Number.parseInt(String(maxRaw), 10) : undefined;

  return {
    side,
    text,
    ...(templateId ? { templateId } : {}),
    ...(waitForText ? { waitForText } : {}),
    ...(Number.isFinite(delaySecMin) ? { delaySecMin } : {}),
    ...(Number.isFinite(delaySecMax) ? { delaySecMax } : {}),
  };
}

export function parseDialogTurnsFromCsv(csv: string): ImportedDialogTurnRow[] {
  const rows = parseCsvBuffer(Buffer.from(csv, 'utf8')) as Record<string, unknown>[];
  return rows.map(rowToTurn).filter((t): t is ImportedDialogTurnRow => t !== null);
}

export function parseDialogTurnsFromJson(json: string): ImportedDialogTurnRow[] {
  const rows = parseJsonBuffer(Buffer.from(json, 'utf8')) as Record<string, unknown>[];
  return rows.map(rowToTurn).filter((t): t is ImportedDialogTurnRow => t !== null);
}
