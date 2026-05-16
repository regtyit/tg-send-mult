import 'dotenv/config';
import {
  envSchema,
  DEV_DEFAULT_BASIC_USER,
  DEV_DEFAULT_BASIC_PASSWORD,
  type AppConfig,
} from './schema';

export { envSchema, type AppConfig } from './schema';

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(parsed.error.format());
    process.exit(1);
  }
  cached = parsed.data;

  if (
    cached.NODE_ENV !== 'test' &&
    (cached.API_BASIC_USER === DEV_DEFAULT_BASIC_USER ||
      cached.API_BASIC_PASSWORD === DEV_DEFAULT_BASIC_PASSWORD)
  ) {
    console.warn(
      '[config] WARNING: dashboard is using the default API credentials (admin / changeme). ' +
        'Set API_BASIC_USER and API_BASIC_PASSWORD in .env before exposing this service.',
    );
  }

  return cached;
}

/**
 * Lazy access to validated env. Prefer this over calling `loadConfig()` directly.
 * Importing this module does not validate `.env` until first property read.
 */
export const config = new Proxy({} as AppConfig, {
  get(_target, prop: string | symbol) {
    if (typeof prop === 'symbol') return undefined;
    return loadConfig()[prop as keyof AppConfig];
  },
});
