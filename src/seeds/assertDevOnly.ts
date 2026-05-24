/**
 * QA / seed utilities must not run against production data.
 */
export function assertNotProduction(action: string): void {
  const env = String(process.env.NODE_ENV ?? 'development').trim();
  if (env === 'production') {
    throw new Error(
      `${action} is disabled when NODE_ENV=production. Use development or test only.`,
    );
  }
}

export function isProductionEnv(): boolean {
  return String(process.env.NODE_ENV ?? '').trim() === 'production';
}
