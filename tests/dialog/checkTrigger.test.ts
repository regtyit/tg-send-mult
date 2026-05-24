import { describe, expect, it } from 'vitest';
import { messageMatchesTrigger, normalizeTriggerText } from '../../src/modules/dialog/checkTrigger';

describe('messageMatchesTrigger', () => {
  it('matches exact text case-insensitively', () => {
    expect(messageMatchesTrigger('  Yes, I am here! ', 'yes, i am here!')).toBe(true);
  });

  it('allows contains match for longer triggers', () => {
    expect(messageMatchesTrigger('yes, i am here', 'i am here')).toBe(true);
  });

  it('rejects short partial matches', () => {
    expect(messageMatchesTrigger('yes', 'yes, i am here')).toBe(false);
  });

  it('treats empty trigger as satisfied', () => {
    expect(messageMatchesTrigger('anything', '')).toBe(true);
  });
});

describe('normalizeTriggerText', () => {
  it('collapses whitespace', () => {
    expect(normalizeTriggerText('  Hello   World ')).toBe('hello world');
  });
});
