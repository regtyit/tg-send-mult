import { zipSync } from 'fflate';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  decodeTdataAccountCount,
  findTdataDirectory,
  prepareTdataRoot,
} from '../../src/modules/auth/tdataImport';

describe('findTdataDirectory', () => {
  it('finds tdata nested under a parent path', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tdata-test-'));
    try {
      const troot = path.join(base, 'Telegram Desktop', 'tdata');
      fs.mkdirSync(troot, { recursive: true });
      fs.writeFileSync(path.join(troot, 'key_data0'), Buffer.from('x'));
      expect(findTdataDirectory(base)).toBe(troot);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('returns null when no tdata markers exist', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tdata-empty-'));
    try {
      fs.mkdirSync(path.join(base, 'a', 'b'), { recursive: true });
      expect(findTdataDirectory(base)).toBeNull();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('prepareTdataRoot', () => {
  it('accepts a zip that contains nested tdata', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tdata-zip-'));
    const zipPath = path.join(dir, 'session.zip');
    try {
      fs.writeFileSync(
        zipPath,
        zipSync({
          'tdesktop/tdata/key_data0': new Uint8Array([1]),
        }),
      );
      const { root, cleanup } = prepareTdataRoot(zipPath);
      try {
        expect(fs.existsSync(path.join(root, 'key_data0'))).toBe(true);
      } finally {
        cleanup();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects zip entries with path traversal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tdata-bad-'));
    const zipPath = path.join(dir, 'bad.zip');
    try {
      fs.writeFileSync(
        zipPath,
        zipSync({
          '../outside.txt': new Uint8Array([1]),
        }),
      );
      expect(() => prepareTdataRoot(zipPath)).toThrow(/zip|traversal/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('decodeTdataAccountCount', () => {
  it('reads normal little-endian counts', () => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(1, 0);
    expect(decodeTdataAccountCount(b)).toBe(1);
  });

  it('accepts swapped-endian count that represents 1', () => {
    const b = Buffer.from([0x00, 0x00, 0x00, 0x01]);
    expect(decodeTdataAccountCount(b)).toBe(1);
  });

  it('keeps a plausible LE count when both are plausible', () => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(2, 0);
    expect(decodeTdataAccountCount(b)).toBe(2);
  });
});
