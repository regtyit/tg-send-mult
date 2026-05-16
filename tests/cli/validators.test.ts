import { describe, expect, it } from 'vitest';
import {
  CliArgError,
  parseDcId,
  parseHttpPort,
  parseObjectId,
  parsePhoneE164,
  parsePort,
} from '../../src/util/cliValidators';

describe('parsePort', () => {
  it('accepts strings and numbers in range', () => {
    expect(parsePort('443')).toBe(443);
    expect(parsePort(80)).toBe(80);
    expect(parsePort('65535')).toBe(65535);
    expect(parsePort('1')).toBe(1);
  });

  it('trims whitespace', () => {
    expect(parsePort('  443  ')).toBe(443);
  });

  it('rejects non-integers', () => {
    expect(() => parsePort('abc')).toThrow(CliArgError);
    expect(() => parsePort('')).toThrow(CliArgError);
    expect(() => parsePort(NaN)).toThrow(CliArgError);
    expect(() => parsePort(Infinity)).toThrow(CliArgError);
    expect(() => parsePort(undefined)).toThrow(CliArgError);
  });

  it('rejects out-of-range values', () => {
    expect(() => parsePort(0)).toThrow(/between 1 and 65535/);
    expect(() => parsePort(-1)).toThrow(/between 1 and 65535/);
    expect(() => parsePort(70000)).toThrow(/between 1 and 65535/);
  });
});

describe('parseHttpPort', () => {
  it('uses API port label in error messages', () => {
    expect(() => parseHttpPort(0)).toThrow(/API port/);
  });
});

describe('parseDcId', () => {
  it('accepts production DCs 1..5', () => {
    for (let i = 1; i <= 5; i++) {
      expect(parseDcId(String(i))).toBe(i);
    }
  });

  it('rejects DC=0 or DC>5 by default', () => {
    expect(() => parseDcId('0')).toThrow(CliArgError);
    expect(() => parseDcId('6')).toThrow(CliArgError);
    expect(() => parseDcId('-2')).toThrow(CliArgError);
  });

  it('allows DC=6 when allowTest is set', () => {
    expect(parseDcId('6', { allowTest: true })).toBe(6);
    expect(() => parseDcId('7', { allowTest: true })).toThrow(CliArgError);
  });

  it('rejects garbage input', () => {
    expect(() => parseDcId('abc')).toThrow(CliArgError);
    expect(() => parseDcId('')).toThrow(CliArgError);
  });
});

describe('parseObjectId', () => {
  it('accepts well-formed 24-char hex ids', () => {
    expect(parseObjectId('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
  });

  it('rejects too short / too long / non-hex strings', () => {
    expect(() => parseObjectId('abc')).toThrow(CliArgError);
    expect(() => parseObjectId('507f1f77bcf86cd79943901')).toThrow(CliArgError);
    expect(() => parseObjectId('zzzzzzzzzzzzzzzzzzzzzzzz')).toThrow(CliArgError);
  });

  it('rejects non-strings', () => {
    expect(() => parseObjectId(123 as unknown)).toThrow(CliArgError);
    expect(() => parseObjectId(undefined as unknown)).toThrow(CliArgError);
  });
});

describe('parsePhoneE164', () => {
  it('accepts well-formed numbers', () => {
    expect(parsePhoneE164('+14155552671')).toBe('+14155552671');
    expect(parsePhoneE164('14155552671')).toBe('14155552671');
    expect(parsePhoneE164('  +79991234567  ')).toBe('+79991234567');
  });

  it('rejects too short / too long', () => {
    expect(() => parsePhoneE164('+1234')).toThrow(CliArgError);
    expect(() => parsePhoneE164('+1234567890123456789')).toThrow(CliArgError);
  });

  it('rejects letters or symbols', () => {
    expect(() => parsePhoneE164('+1abc')).toThrow(CliArgError);
    expect(() => parsePhoneE164('+1 415 555 2671')).toThrow(CliArgError);
  });

  it('rejects non-strings', () => {
    expect(() => parsePhoneE164(undefined as unknown)).toThrow(CliArgError);
    expect(() => parsePhoneE164(14155552671 as unknown)).toThrow(CliArgError);
  });
});
