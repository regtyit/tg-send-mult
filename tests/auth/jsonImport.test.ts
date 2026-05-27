import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  readJsonAccountMetadata,
  unwrapJsonAccountRoot,
} from '../../src/modules/auth/jsonImport';

describe('unwrapJsonAccountRoot', () => {
  it('unwraps nested account/data wrappers', () => {
    const row = unwrapJsonAccountRoot({
      data: { phone: '+14155552671', app_id: 1, app_hash: 'abc' },
    });
    expect(row.phone).toBe('+14155552671');
    expect(row.app_id).toBe(1);
  });

  it('unwraps array exports and picks row by phone hint', () => {
    const row = unwrapJsonAccountRoot(
      [
        { phone: '+11111111111', app_id: 1, app_hash: 'a' },
        { phone: '+22222222222', app_id: 2, app_hash: 'b' },
      ],
      '+22222222222',
    );
    expect(row.phone).toBe('+22222222222');
    expect(row.app_id).toBe(2);
  });
});

describe('readJsonAccountMetadata', () => {
  it('extracts app/device/label metadata from flat JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-json-meta-'));
    const file = path.join(dir, 'acc.json');
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({
          phone: '+14155552671',
          username: 'alice',
          device: 'Pixel',
          sdk: 'Android 14',
          app_version: '10.11.0',
          lang_code: 'en',
          system_lang_code: 'en-US',
          app_id: 123456,
          app_hash: 'abcdef0123456789',
        }),
      );
      const m = readJsonAccountMetadata(file);
      expect(m.phone).toBe('+14155552671');
      expect(m.label).toBe('alice');
      expect(m.deviceProfile.deviceModel).toBe('Pixel');
      expect(m.deviceProfile.systemVersion).toBe('Android 14');
      expect(m.telegramApiId).toBe(123456);
      expect(m.telegramApiHash).toBe('abcdef0123456789');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts metadata from wrapped one-key JSON account object', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-json-meta-wrap-'));
    const file = path.join(dir, 'acc.json');
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({
          '227636356': {
            appId: '999001',
            appHash: 'deadbeef',
            device: 'Desktop',
            sdk: 'Linux',
          },
        }),
      );
      const m = readJsonAccountMetadata(file);
      expect(m.telegramApiId).toBe(999001);
      expect(m.telegramApiHash).toBe('deadbeef');
      expect(m.deviceProfile.deviceModel).toBe('Desktop');
      expect(m.deviceProfile.systemVersion).toBe('Linux');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads numeric phone and api_id from seller-style JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-json-num-'));
    const file = path.join(dir, 'acc.json');
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({
          phone: 79001234567,
          app_id: '2040',
          app_hash: 'b18441a1ff607e10a989891a5462e627',
          device: 'Samsung SM-G973F',
        }),
      );
      const m = readJsonAccountMetadata(file);
      expect(m.phone).toBe('79001234567');
      expect(m.telegramApiId).toBe(2040);
      expect(m.telegramApiHash).toBe('b18441a1ff607e10a989891a5462e627');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strips UTF-8 BOM from JSON files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-json-bom-'));
    const file = path.join(dir, 'acc.json');
    try {
      fs.writeFileSync(
        file,
        `\uFEFF${JSON.stringify({ phone: '+14155552671', app_id: 1, app_hash: 'x' })}`,
        'utf8',
      );
      const m = readJsonAccountMetadata(file);
      expect(m.phone).toBe('+14155552671');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
