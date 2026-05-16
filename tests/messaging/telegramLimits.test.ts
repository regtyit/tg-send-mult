import { describe, expect, it } from 'vitest';
import {
  isWithinTelegramMessageLength,
  TELEGRAM_MESSAGE_MAX_CHARS,
  telegramMessageCharLength,
} from '../../src/modules/messaging/telegramLimits';

describe('telegram message limits', () => {
  it('accepts empty and short text', () => {
    expect(isWithinTelegramMessageLength('')).toBe(true);
    expect(isWithinTelegramMessageLength('a'.repeat(100))).toBe(true);
  });

  it('rejects text longer than cap', () => {
    expect(isWithinTelegramMessageLength('x'.repeat(TELEGRAM_MESSAGE_MAX_CHARS + 1))).toBe(false);
  });

  it('counts UTF-16 code units like Telegram', () => {
    const emoji = '😀';
    expect(telegramMessageCharLength(emoji)).toBe(2);
  });
});
