import { createHash } from 'crypto';

export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeTextHash(renderedText: string): string {
  return createHash('sha256').update(normalizeText(renderedText), 'utf8').digest('hex');
}
