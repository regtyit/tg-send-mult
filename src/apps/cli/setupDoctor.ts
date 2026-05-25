#!/usr/bin/env node
/**
 * Standalone setup checks: validates `.env` without importing the rest of the app (no eager config exit).
 * Run: npm run setup
 */
import { spawnSync } from 'child_process';
import 'dotenv/config';
import mongoose from 'mongoose';
import IORedis from 'ioredis';
import { envSchema } from '../../config/schema';
import { resolveTelethonPythonInterpreter } from '../../telegram/pythonBridge';

const steps = [
  '1. Copy .env.example → .env and fill secrets (see README “API credentials”).',
  '2. Start MongoDB and Redis; defaults are 127.0.0.1:27017 and :6379.',
  '3. npm run setup:python   (venv under python/.venv — required on Arch/Artix / PEP 668)',
  '4. npm install && (cd web && npm install) && npm run build:all',
  '5. npm test',
  '6. Add an account: npm run cli -- auth login   OR   auth import-session / auth import-mtp',
  '7. Run stack: npm run dev:api, dev:worker, dev:scheduler (three terminals).',
] as const;

async function main(): Promise<void> {
  console.log('tg-send-mult — setup checklist (do in order):\n');
  for (const line of steps) console.log(`  ${line}`);
  console.log('\n--- Checking current .env ---\n');

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid or missing environment variables:\n');
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    console.error(
      '\nTip: set telegramApiId + telegramApiHash on each sender (API/dashboard/import), or set optional TG_API_ID / TG_API_HASH in .env as a fallback.\n',
    );
    process.exit(1);
  }

  const cfg = parsed.data;
  console.log('  Environment: OK (SESSION_KEY, …). TG_API_* optional if each account has api id/hash.\n');

  const py = resolveTelethonPythonInterpreter(cfg.TG_PYTHON || '');
  process.stdout.write(`  Python Telethon (${py}): `);
  const pyChk = spawnSync(py, ['-c', 'import telethon; print(telethon.__version__)'], {
    encoding: 'utf-8',
  });
  if (pyChk.status !== 0) {
    console.log('FAILED');
    console.error(
      '    On Arch/Artix (PEP 668) use a venv — do not pip install system-wide:\n',
      '      npm run setup:python\n',
      '    Or: cd python && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt\n',
      '    Optional: set TG_PYTHON to that interpreter if it is not auto-detected.\n',
      pyChk.stderr || pyChk.stdout || '',
    );
    process.exit(1);
  }
  console.log(`OK (${(pyChk.stdout ?? '').trim()})`);

  process.stdout.write('  TelethonFakeTLS (ee MTProxy): ');
  const faketlsChk = spawnSync(py, ['-c', 'import TelethonFakeTLS; print("ok")'], {
    encoding: 'utf-8',
  });
  if (faketlsChk.status !== 0) {
    console.log('MISSING');
    console.error(
      '    Re-run: npm run setup:python\n',
      '    (installs TelethonFakeTLS from python/requirements.txt for ee... proxy secrets)\n',
      faketlsChk.stderr || faketlsChk.stdout || '',
    );
    process.exit(1);
  }
  console.log('OK');

  process.stdout.write('  MongoDB: connecting… ');
  try {
    await mongoose.connect(cfg.MONGO_URI, { serverSelectionTimeoutMS: 8_000 });
    await mongoose.disconnect();
    console.log('OK');
  } catch (err) {
    console.log('FAILED');
    console.error('  ', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  process.stdout.write('  Valkey/Redis: PING… ');
  const redis = new IORedis({
    host: cfg.REDIS_HOST,
    port: cfg.REDIS_PORT,
    password: cfg.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 2,
    connectTimeout: 8_000,
  });
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      console.log(`unexpected: ${pong}`);
      process.exit(1);
    }
    console.log('OK');
  } catch (err) {
    console.log('FAILED');
    console.error('  ', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    redis.disconnect();
  }

  console.log('\nAll checks passed. Next: npm run cli -- auth login (or import-session).\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
