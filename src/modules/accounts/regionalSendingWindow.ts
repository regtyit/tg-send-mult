import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { phoneCountryIso2 } from './phoneCountry';

export interface RegionalSendingWindowRow {
  countryIso2: string;
  name: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
}

type JsonRegion = { name: string; timezone: string; windowStart: string; windowEnd: string };

type Bundle = { version: number; regions: Record<string, JsonRegion> };

let bundleCache: Bundle | null = null;

function loadBundle(): Bundle {
  if (bundleCache) return bundleCache;
  const file = path.join(__dirname, '../../data/regionalSendingWindows.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Bundle;
  bundleCache = raw;
  return raw;
}

function regions(): Record<string, JsonRegion> {
  return loadBundle().regions;
}

/** Sorted list for API / UI (no secrets). */
export function listRegionalSendingWindows(): RegionalSendingWindowRow[] {
  return Object.keys(regions())
    .sort()
    .map((countryIso2) => {
      const r = regions()[countryIso2]!;
      return {
        countryIso2,
        name: r.name,
        timezone: r.timezone,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
      };
    });
}

/**
 * Active sending window for a country (ISO2). Outside this local window the
 * worker does not send campaign messages (`isWithinSendingWindowAccount`).
 */
export function getRegionalSendingWindow(iso2: string | null | undefined): RegionalSendingWindowRow {
  const code = (iso2 ?? '').trim().toUpperCase().slice(0, 2);
  const row = code && regions()[code];
  if (row) {
    return {
      countryIso2: code,
      name: row.name,
      timezone: row.timezone,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
    };
  }
  return {
    countryIso2: code || 'DEFAULT',
    name: 'App default (.env)',
    timezone: config.DEFAULT_TIMEZONE,
    windowStart: config.DEFAULT_WINDOW_START,
    windowEnd: config.DEFAULT_WINDOW_END,
  };
}

/** Resolve region: explicit ISO2 override, else phone-derived country, else default bundle row. */
export function resolveSendingWindowForNewAccount(
  phone: string,
  explicitRegionIso2?: string | null,
): { start: string; end: string; timezone: string; region: RegionalSendingWindowRow } {
  const fromPhone = phoneCountryIso2(phone);
  const iso = (explicitRegionIso2 ?? fromPhone ?? '').trim().toUpperCase().slice(0, 2) || null;
  const region = getRegionalSendingWindow(iso);
  return {
    start: region.windowStart,
    end: region.windowEnd,
    timezone: region.timezone,
    region,
  };
}
