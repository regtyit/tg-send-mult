import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveImportPath } from '../../src/util/resolveImportPath';

describe('resolveImportPath', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('resolves relative paths under project data/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-import-path-'));
    dirs.push(root);
    const dataDir = path.join(root, 'data', 'acc');
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, 'meta.json');
    fs.writeFileSync(file, '{}');

    const prev = process.cwd();
    try {
      process.chdir(root);
      expect(resolveImportPath('acc/meta.json')).toBe(file);
    } finally {
      process.chdir(prev);
    }
  });

  it('returns normalized absolute path when file is missing', () => {
    const resolved = resolveImportPath('/tmp/does-not-exist-tg-import');
    expect(path.isAbsolute(resolved)).toBe(true);
  });
});
