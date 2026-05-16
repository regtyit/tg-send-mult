import { describe, expect, it } from 'vitest';
import { parseCsvBuffer, parseJsonBuffer } from '../../src/modules/contacts/importRows';

describe('contact import parsers', () => {
  it('parseCsvBuffer reads header row', () => {
    const rows = parseCsvBuffer('phone,firstName\n+79991112233,Ann\n');
    expect(rows).toEqual([{ phone: '+79991112233', firstName: 'Ann' }]);
  });

  it('parseJsonBuffer expects array', () => {
    const rows = parseJsonBuffer('[{"phone":"+79991112233","firstName":"Bob"}]');
    expect(rows).toEqual([{ phone: '+79991112233', firstName: 'Bob' }]);
  });

  it('parseJsonBuffer rejects non-array', () => {
    expect(() => parseJsonBuffer('{}')).toThrow(/array/);
  });
});
