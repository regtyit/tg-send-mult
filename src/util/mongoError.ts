export function isMongoDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
