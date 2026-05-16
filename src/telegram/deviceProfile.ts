import { config } from '../config';
import type { AccountDoc } from '../db/models/Account';

export interface DeviceProfile {
  deviceModel: string;
  systemVersion: string;
  appVersion: string;
  langCode: string;
  systemLangCode: string;
}

export function defaultDeviceProfile(): DeviceProfile {
  return {
    deviceModel: config.DEFAULT_DEVICE_MODEL,
    systemVersion: config.DEFAULT_SYSTEM_VERSION,
    appVersion: config.DEFAULT_APP_VERSION,
    langCode: config.DEFAULT_LANG_CODE,
    systemLangCode: config.DEFAULT_LANG_CODE,
  };
}

export function deviceProfileFromAccount(account: AccountDoc | null | undefined): DeviceProfile {
  return account?.deviceProfile ?? defaultDeviceProfile();
}

export function devicePayloadFromProfile(p: DeviceProfile): Record<string, string> {
  return {
    deviceModel: p.deviceModel,
    systemVersion: p.systemVersion,
    appVersion: p.appVersion,
    langCode: p.langCode,
    systemLangCode: p.systemLangCode,
  };
}
