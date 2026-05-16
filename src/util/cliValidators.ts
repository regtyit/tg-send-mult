import { Types } from 'mongoose';

export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliArgError';
  }
}

/**
 * Parse a TCP/UDP port number from a CLI argument. Accepts strings or numbers.
 * Throws `CliArgError` on anything that isn't a finite integer in [1, 65535].
 */
export function parsePort(raw: unknown, label = 'port'): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new CliArgError(`${label} must be a finite integer, got: ${String(raw)}`);
  }
  if (n < 1 || n > 65535) {
    throw new CliArgError(`${label} must be between 1 and 65535, got: ${n}`);
  }
  return n;
}

/**
 * Parse a Telegram data-center id. Production DCs are 1–5; test DCs go up to
 * 6, but in practice we never want to dial a test DC by accident from the
 * CLI, so we cap at 5 by default. Callers that really need test DCs can pass
 * `{ allowTest: true }`.
 */
export function parseDcId(raw: unknown, opts: { allowTest?: boolean } = {}): number {
  const max = opts.allowTest ? 6 : 5;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new CliArgError(`--dc must be a finite integer, got: ${String(raw)}`);
  }
  if (n < 1 || n > max) {
    throw new CliArgError(`--dc must be between 1 and ${max}, got: ${n}`);
  }
  return n;
}

/**
 * Validate that a value looks like a Mongo ObjectId. Returns the string form
 * on success, throws `CliArgError` otherwise.
 */
export function parseObjectId(raw: unknown, label = 'id'): string {
  if (typeof raw !== 'string') {
    throw new CliArgError(`${label} must be a string, got: ${typeof raw}`);
  }
  const s = raw.trim();
  if (!Types.ObjectId.isValid(s)) {
    throw new CliArgError(`${label} is not a valid ObjectId: "${s}"`);
  }
  return s;
}

/**
 * Validate a phone string in international form. Accepts an optional leading
 * "+" and 8–15 digits. This is a syntactic check only — actual phone-country
 * resolution happens via libphonenumber later.
 */
const PHONE_RE = /^\+?[1-9]\d{6,14}$/;
export function parsePhoneE164(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new CliArgError(`phone must be a string, got: ${typeof raw}`);
  }
  const s = raw.trim();
  if (!PHONE_RE.test(s)) {
    throw new CliArgError(
      `phone must look like an international number (+ then 7–15 digits), got: "${s}"`,
    );
  }
  return s;
}

/**
 * Validate an HTTP listen port from the API CLI / .env. Identical to
 * `parsePort` but with a friendlier label.
 */
export function parseHttpPort(raw: unknown): number {
  return parsePort(raw, 'API port');
}
