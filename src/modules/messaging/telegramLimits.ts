/** Telegram plain-text message cap (UTF-16 code units), per Bot/API docs. */
export const TELEGRAM_MESSAGE_MAX_CHARS = 4096;

export function telegramMessageCharLength(text: string): number {
  return text.length;
}

export function isWithinTelegramMessageLength(text: string): boolean {
  return telegramMessageCharLength(text) <= TELEGRAM_MESSAGE_MAX_CHARS;
}
