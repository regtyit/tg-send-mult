import { afterEach, describe, expect, it } from 'vitest';
import { assertNotProduction } from '../../src/seeds/assertDevOnly';
import { generateDialog, generateDialogs } from '../../src/seeds/dialog-generator';

describe('dialog-generator', () => {
  const prev = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it('generateDialog uses test_user ids and Russian messages', () => {
    const d = generateDialog(3);
    expect(d.id).toBe('qa_dialog_3');
    expect(d.participants[0].id).toBe('test_user_3_1');
    expect(d.participants[1].id).toBe('test_user_3_2');
    expect(d.messages.length).toBeGreaterThanOrEqual(14);
    expect(d.messages.length).toBeLessThanOrEqual(18);
    const from1 = d.messages.filter((m) => m.from === 'test_user_3_1').length;
    const from2 = d.messages.length - from1;
    expect(from1).toBeGreaterThanOrEqual(7);
    expect(from1).toBeLessThanOrEqual(9);
    expect(from2).toBeGreaterThanOrEqual(7);
    expect(from2).toBeLessThanOrEqual(9);
    expect(d.messages.every((m) => m.text.length > 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(d))).toBeTruthy();
  });

  it('generateDialogs returns requested count', () => {
    const list = generateDialogs(3);
    expect(list).toHaveLength(3);
    expect(list.map((d) => d.index)).toEqual([1, 2, 3]);
  });

  it('assertNotProduction throws in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNotProduction('test')).toThrow(/production/i);
  });
});
