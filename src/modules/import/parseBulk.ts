import { parseCsvBuffer, parseJsonBuffer } from '../contacts/importRows';

export interface BulkParseResult<T> {
  rows: T[];
  errors: { line: number; reason: string }[];
}

export function parseBulkCsv<T extends Record<string, unknown>>(csv: string): T[] {
  return parseCsvBuffer(csv) as T[];
}

export function parseBulkJson<T extends Record<string, unknown>>(json: string): T[] {
  return parseJsonBuffer(json) as T[];
}

export function parseBulkInput<T extends Record<string, unknown>>(
  input: { csv?: string; json?: string },
): { rows: T[]; format: 'csv' | 'json' } {
  if (input.csv?.trim()) {
    return { rows: parseBulkCsv<T>(input.csv), format: 'csv' };
  }
  if (input.json?.trim()) {
    return { rows: parseBulkJson<T>(input.json), format: 'json' };
  }
  return { rows: [], format: 'csv' };
}
