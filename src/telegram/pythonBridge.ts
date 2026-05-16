import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../logger';
import type { DeviceProfile } from './deviceProfile';
import { devicePayloadFromProfile } from './deviceProfile';
import { bridgeErrorToDomain, TgDomainError } from './errors';
import type { TelethonProxyPayload } from './proxyPayload';

/**
 * Per-call options for the Telethon bridge subprocess.
 * `timeoutMs` of 0 disables the timeout (use only in CLI/auth flows).
 */
export interface RunTelethonBridgeOptions {
  /** Hard wall-clock timeout for the entire subprocess. 0 disables. */
  timeoutMs?: number;
}

export interface TelethonBridgeError {
  code: string;
  message: string;
  waitSeconds?: number;
  traceback?: string;
}

export interface TelethonBridgeResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: TelethonBridgeError;
}

export interface TelethonRequestBase {
  action: string;
  apiId: number;
  apiHash: string;
  device?: Record<string, string>;
  proxy?: TelethonProxyPayload;
  floodSleepThreshold?: number;
  /** Telethon TCP connect attempts (default 5, max 20). */
  connectionRetries?: number;
  /** Seconds between Telethon connection retries (default 1). */
  retryDelay?: number;
  /** Per-attempt connect timeout in seconds (default 10, max 120). */
  timeout?: number;
}

function bridgeScriptPath(): string {
  return path.join(__dirname, '..', '..', 'python', 'tg_worker', 'run.py');
}

/**
 * Arch/Artix and other distros use PEP 668 — no system `pip install`.
 * If `TG_PYTHON` is left at the generic `python3` / `python`, prefer `python/.venv` when present.
 * Set `TG_PYTHON` to an explicit path to override.
 */
export function resolveTelethonPythonInterpreter(configured: string): string {
  const c = (configured || '').trim();
  const generic = c === '' || c === 'python3' || c === 'python';
  if (!generic) {
    return c;
  }
  const root = path.join(__dirname, '..', '..');
  for (const name of ['python', 'python3'] as const) {
    const inVenv = path.join(root, 'python', '.venv', 'bin', name);
    if (fs.existsSync(inVenv)) {
      return inVenv;
    }
  }
  return c || 'python3';
}

export function telethonCommon(
  creds: { apiId: number; apiHash: string },
  device?: DeviceProfile,
  proxy?: TelethonProxyPayload,
  floodSleepThreshold?: number,
): Pick<TelethonRequestBase, 'apiId' | 'apiHash' | 'device' | 'proxy' | 'floodSleepThreshold'> {
  const apiId = Math.trunc(Number(creds.apiId));
  const apiHash = String(creds.apiHash ?? '').trim();
  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error(
      `Invalid Telegram api_id for Telethon bridge (${String(creds.apiId)}). Set telegramApiId on the account or TG_API_ID in .env.`,
    );
  }
  if (!apiHash) {
    throw new Error(
      'Telegram api_hash is empty. Set telegramApiHash on the account or TG_API_HASH in .env.',
    );
  }
  const out: Pick<TelethonRequestBase, 'apiId' | 'apiHash' | 'device' | 'proxy' | 'floodSleepThreshold'> = {
    apiId,
    apiHash,
    device: device ? devicePayloadFromProfile(device) : undefined,
    proxy,
  };
  if (floodSleepThreshold != null) {
    out.floodSleepThreshold = floodSleepThreshold;
  }
  return out;
}

export function runTelethonBridge<T = unknown>(
  req: TelethonRequestBase & Record<string, unknown>,
  options: RunTelethonBridgeOptions = {},
): TelethonBridgeResponse<T> {
  const python = resolveTelethonPythonInterpreter(config.TG_PYTHON || '');
  const script = bridgeScriptPath();
  const payload = JSON.stringify(req);
  const timeoutMs =
    options.timeoutMs ?? (config.TG_BRIDGE_TIMEOUT_MS > 0 ? config.TG_BRIDGE_TIMEOUT_MS : undefined);
  const res = spawnSync(python, [script], {
    input: payload,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env },
    ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' as const } : {}),
  });

  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT' || res.signal === 'SIGTERM' || res.signal === 'SIGKILL') {
      logger.warn(
        { action: req.action, timeoutMs },
        'tg: python bridge timed out; killed',
      );
      throw new TgDomainError({
        kind: 'network',
        code: 'BRIDGE_TIMEOUT',
        message: `Telethon bridge timed out after ${timeoutMs ?? '?'}ms`,
        retryable: true,
      });
    }
    logger.error({ err: res.error }, 'tg: python bridge spawn failed');
    throw new TgDomainError({
      kind: 'unknown',
      code: code ?? 'BRIDGE_SPAWN_FAILED',
      message: `Telethon bridge could not be started: ${res.error.message}`,
      retryable: false,
    });
  }
  if (res.signal === 'SIGTERM' || res.signal === 'SIGKILL') {
    logger.warn(
      { action: req.action, signal: res.signal, timeoutMs },
      'tg: python bridge killed by signal',
    );
    throw new TgDomainError({
      kind: 'network',
      code: 'BRIDGE_TIMEOUT',
      message: `Telethon bridge killed by ${res.signal} after ${timeoutMs ?? '?'}ms`,
      retryable: true,
    });
  }
  const stderr = (res.stderr ?? '').trim();
  if (stderr) {
    logger.info({ stderr }, 'tg: python bridge stderr');
  }
  if (res.status !== 0) {
    throw new TgDomainError({
      kind: 'unknown',
      code: 'BRIDGE_EXIT',
      message: `Telethon bridge exited ${res.status}: ${stderr || (res.stdout ?? '').slice(0, 500) || 'no output'}`,
      retryable: false,
    });
  }
  let parsed: TelethonBridgeResponse<T>;
  try {
    parsed = JSON.parse(res.stdout ?? '{}') as TelethonBridgeResponse<T>;
  } catch (e) {
    /** Don't dump stdout — could be huge or contain sensitive frames if Python misbehaved. */
    logger.error(
      { stdoutLength: (res.stdout ?? '').length, stdoutHead: (res.stdout ?? '').slice(0, 200) },
      'tg: python bridge bad JSON',
    );
    throw new TgDomainError({
      kind: 'unknown',
      code: 'BRIDGE_BAD_JSON',
      message: `Telethon bridge returned non-JSON: ${String(e)}`,
      retryable: false,
    });
  }
  if (!parsed.ok && parsed.error?.traceback) {
    logger.error({ traceback: parsed.error.traceback }, 'tg: python bridge exception');
  }
  return parsed;
}

/**
 * Async (non-blocking) variant of `runTelethonBridge`. Spawns the Python
 * subprocess, writes the JSON request to stdin, collects stdout/stderr, and
 * resolves with the parsed bridge response. Use this from the API, scheduler,
 * and queue processor — anywhere blocking the Node event loop matters.
 *
 * The synchronous `runTelethonBridge` variant remains for the CLI, where
 * blocking is acceptable and the surrounding code uses `inquirer` prompts.
 */
export function runTelethonBridgeAsync<T = unknown>(
  req: TelethonRequestBase & Record<string, unknown>,
  options: RunTelethonBridgeOptions = {},
): Promise<TelethonBridgeResponse<T>> {
  const python = resolveTelethonPythonInterpreter(config.TG_PYTHON || '');
  const script = bridgeScriptPath();
  const payload = JSON.stringify(req);
  const timeoutMs =
    options.timeoutMs ?? (config.TG_BRIDGE_TIMEOUT_MS > 0 ? config.TG_BRIDGE_TIMEOUT_MS : undefined);

  return new Promise<TelethonBridgeResponse<T>>((resolve, reject) => {
    const child = spawn(python, [script], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    const MAX_BUF = 32 * 1024 * 1024;
    let timedOut = false;
    let killed = false;

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killed = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.stdout.on('data', (b: Buffer) => {
      stdoutLen += b.length;
      if (stdoutLen > MAX_BUF) {
        killed = true;
        child.kill('SIGKILL');
        return;
      }
      stdoutChunks.push(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      stderrChunks.push(b);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      const code = (err as NodeJS.ErrnoException).code;
      logger.error({ err }, 'tg: python bridge spawn failed (async)');
      reject(
        new TgDomainError({
          kind: 'unknown',
          code: code ?? 'BRIDGE_SPAWN_FAILED',
          message: `Telethon bridge could not be started: ${err.message}`,
          retryable: false,
        }),
      );
    });

    child.on('close', (status, signal) => {
      if (timer) clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
      if (stderr) {
        logger.info({ stderr }, 'tg: python bridge stderr (async)');
      }
      if (timedOut || signal === 'SIGTERM' || signal === 'SIGKILL') {
        logger.warn(
          { action: req.action, signal, timeoutMs },
          'tg: python bridge timed out / killed (async)',
        );
        return reject(
          new TgDomainError({
            kind: 'network',
            code: 'BRIDGE_TIMEOUT',
            message: `Telethon bridge timed out after ${timeoutMs ?? '?'}ms`,
            retryable: true,
          }),
        );
      }
      if (killed) {
        return reject(
          new TgDomainError({
            kind: 'unknown',
            code: 'BRIDGE_KILLED',
            message: 'Telethon bridge was killed (output too large)',
            retryable: false,
          }),
        );
      }
      if (status !== 0) {
        const stdoutStr = Buffer.concat(stdoutChunks).toString('utf-8');
        return reject(
          new TgDomainError({
            kind: 'unknown',
            code: 'BRIDGE_EXIT',
            message: `Telethon bridge exited ${status}: ${stderr || stdoutStr.slice(0, 500) || 'no output'}`,
            retryable: false,
          }),
        );
      }
      const stdoutStr = Buffer.concat(stdoutChunks).toString('utf-8');
      let parsed: TelethonBridgeResponse<T>;
      try {
        parsed = JSON.parse(stdoutStr || '{}') as TelethonBridgeResponse<T>;
      } catch (e) {
        logger.error(
          { stdoutLength: stdoutStr.length, stdoutHead: stdoutStr.slice(0, 200) },
          'tg: python bridge bad JSON (async)',
        );
        return reject(
          new TgDomainError({
            kind: 'unknown',
            code: 'BRIDGE_BAD_JSON',
            message: `Telethon bridge returned non-JSON: ${String(e)}`,
            retryable: false,
          }),
        );
      }
      if (!parsed.ok && parsed.error?.traceback) {
        logger.error({ traceback: parsed.error.traceback }, 'tg: python bridge exception (async)');
      }
      resolve(parsed);
    });

    child.stdin.on('error', (err) => {
      logger.error({ err }, 'tg: python bridge stdin error (async)');
    });
    child.stdin.end(payload);
  });
}

export function unwrapTelethonBridge<T>(res: TelethonBridgeResponse<T>): T {
  if (res.ok && res.result !== undefined) {
    return res.result;
  }
  throw bridgeErrorToDomain(res.error ?? { code: 'UNKNOWN', message: 'Telethon bridge error' });
}
