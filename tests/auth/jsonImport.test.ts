import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readJsonAccountMetadata } from '../../src/modules/auth/jsonImport';

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
});

