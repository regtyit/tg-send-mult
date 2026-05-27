import fs from 'fs';
import path from 'path';

/**
 * Resolve tdata / JSON import paths for API, CLI, and bulk import.
 * Tries the literal path, cwd-relative, project `data/`, and `/app/data` (Docker).
 */
export function resolveImportPath(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;

  const stripped = raw.replace(/^\/app\/data\/?/, '').replace(/^\.\/?data\/?/, '');
  const candidates = [
    raw,
    path.resolve(raw),
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), 'data', stripped),
    path.join('/app/data', stripped),
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (fs.existsSync(normalized)) return normalized;
  }

  return path.resolve(raw);
}
