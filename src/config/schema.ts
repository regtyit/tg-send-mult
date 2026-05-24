import { z } from 'zod';

const timeHHMM = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM time format');

/** Default placeholders that are valid in development but must not survive into production. */
export const DEV_DEFAULT_BASIC_USER = 'admin';
export const DEV_DEFAULT_BASIC_PASSWORD = 'changeme';

const csv = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Optional fallback when sender accounts do not store per-account api_id / api_hash. */
    TG_API_ID: z.preprocess((val) => {
      if (val === '' || val === undefined || val === null) return undefined;
      const n = Number(val);
      return Number.isFinite(n) ? n : undefined;
    }, z.number().int().positive().optional()),
    TG_API_HASH: z.preprocess((val) => {
      if (val === undefined || val === null) return undefined;
      const s = String(val).trim();
      return s === '' ? undefined : s;
    }, z.string().min(1).optional()),
    /** Python 3 interpreter for Telethon bridge (`python/tg_worker/run.py`). */
    TG_PYTHON: z.string().optional().default('python3'),
    TELEGRAM_PROXY_ID: z.string().optional().default(''),
    TG_MTPROXY_HOST: z.string().optional().default(''),
    TG_MTPROXY_PORT: z.string().optional().default(''),
    TG_MTPROXY_SECRET: z.string().optional().default(''),
    TG_MTPROXY_COUNTRY: z.string().optional().default(''),

    MONGO_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/tg_send_mult'),

    REDIS_HOST: z.string().default('127.0.0.1'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional().default(''),

    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    API_BASIC_USER: z.string().min(1).default(DEV_DEFAULT_BASIC_USER),
    API_BASIC_PASSWORD: z.string().min(1).default(DEV_DEFAULT_BASIC_PASSWORD),

    /**
     * Comma-separated list of allowed CORS origins for the dashboard / API.
     * Examples: "https://dashboard.example.com,https://ops.example.com".
     * Special values:
     *   ""     (empty) — same-origin only (default in production)
     *   "*"            — reflect any origin (only allowed when NODE_ENV !== 'production')
     */
    CORS_ALLOWED_ORIGINS: z
      .string()
      .optional()
      .default('')
      .transform((raw) => csv(raw)),

    SESSION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'SESSION_KEY must be a 64-char hex string (32 bytes)'),

    DEFAULT_MSGS_PER_DAY: z.coerce.number().int().positive().default(80),
    /** Days in `warming` before auto-promotion to `active` (requires warm-up scripts too). */
    WARMUP_DAYS: z.coerce.number().int().positive().default(3),
    /** Max outbound campaign messages per day while status is `warming`. */
    WARMUP_MSGS_PER_DAY: z.coerce.number().int().positive().default(1),
    /** Max completed dialog scripts per calendar day while status is `warming`. */
    WARMUP_SCRIPTS_PER_DAY: z.coerce.number().int().positive().default(1),
    DEFAULT_RATE_PER_HOUR: z.coerce.number().int().positive().default(20),
    DEFAULT_WINDOW_START: timeHHMM.default('09:00'),
    DEFAULT_WINDOW_END: timeHHMM.default('22:00'),
    DEFAULT_TIMEZONE: z.string().default('Europe/Moscow'),

    DEFAULT_DEVICE_MODEL: z.string().default('Desktop'),
    DEFAULT_SYSTEM_VERSION: z.string().default('Linux'),
    DEFAULT_APP_VERSION: z.string().default('1.0.0'),
    DEFAULT_LANG_CODE: z.string().default('en'),

    /**
     * Retention for delivery_events (TTL on createdAt). 0 disables the TTL index.
     */
    DELIVERY_EVENT_TTL_DAYS: z.coerce.number().int().nonnegative().default(90),

    /**
     * Per-action timeout for the Python Telethon bridge (in milliseconds).
     * Set to 0 to disable.
     */
    TG_BRIDGE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(45_000),

    /**
     * Buffer (in seconds) added to FLOOD_WAIT before re-trying. Helps avoid
     * re-tripping the same wait by a few milliseconds.
     */
    FLOOD_WAIT_BUFFER_SEC: z.coerce.number().int().nonnegative().default(5),

    /** Max auto dialog sessions processed per scheduler tick. */
    DIALOG_BATCH_LIMIT: z.coerce.number().int().positive().default(200),
    /** Parallel dialog sessions per batch tick. */
    DIALOG_BATCH_CONCURRENCY: z.coerce.number().int().positive().default(25),
    /** Lock duration (seconds) while a session turn is executing. */
    DIALOG_PROCESSING_LOCK_SEC: z.coerce.number().int().positive().default(90),

    /** Inbound: max age of messages to fetch on first sync (seconds). */
    INBOUND_SYNC_LOOKBACK_SEC: z.coerce.number().int().positive().default(86_400),
    /** Inbound: min interval between automatic syncs per sender account (seconds). */
    INBOUND_SYNC_INTERVAL_SEC: z.coerce.number().int().positive().default(90),
    /** Inbound: delay between accounts in one scheduler tick (milliseconds). */
    INBOUND_SYNC_STAGGER_MS: z.coerce.number().int().nonnegative().default(2_000),
    /** Inbound: how many accounts to sync per scheduler minute tick. */
    INBOUND_SYNC_BATCH_PER_TICK: z.coerce.number().int().positive().default(8),

    /** Dialog: min interval between peer inbox polls per session (seconds). */
    DIALOG_PEER_SYNC_INTERVAL_SEC: z.coerce.number().int().positive().default(15),
    /** Dialog: how long to wait before re-polling when waiting_peer (milliseconds). */
    DIALOG_WAIT_POLL_MS: z.coerce.number().int().positive().default(8_000),
    /** Dialog: delay between sessions in one batch tick (milliseconds). */
    DIALOG_SESSION_STAGGER_MS: z.coerce.number().int().nonnegative().default(400),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production') {
      if (cfg.API_BASIC_USER === DEV_DEFAULT_BASIC_USER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_BASIC_USER'],
          message: `API_BASIC_USER must be set to a non-default value in production (current: "${DEV_DEFAULT_BASIC_USER}").`,
        });
      }
      if (cfg.API_BASIC_PASSWORD === DEV_DEFAULT_BASIC_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_BASIC_PASSWORD'],
          message: 'API_BASIC_PASSWORD must be set to a non-default secret in production.',
        });
      }
      if (cfg.API_BASIC_PASSWORD.length < 12) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_BASIC_PASSWORD'],
          message: 'API_BASIC_PASSWORD must be at least 12 characters in production.',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;
