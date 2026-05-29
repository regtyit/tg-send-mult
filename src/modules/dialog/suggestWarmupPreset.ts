import type { AccountDoc } from '../../db/models/Account';
import { readinessDialogsRecommended } from '../accounts/warming';
import {
  HUMAN_DIALOG_PRESETS,
  filterHumanDialogPresets,
  warmupSlotForPreset,
  type HumanDialogPreset,
} from './humanDialogTemplates';

export interface SuggestedWarmupPreset {
  slug: string;
  name: string;
  warmupSlot: number;
  reason: string;
}

function preferredLang(account: Pick<AccountDoc, 'deviceProfile'>): 'en' | 'ru' | null {
  const code = account.deviceProfile?.langCode?.trim().toLowerCase() ?? '';
  if (code.startsWith('ru')) return 'ru';
  if (code.startsWith('en') || code === '') return 'en';
  return null;
}

/** Pick a built-in preset for the account's next recommended warm-up dialog slot. */
export function suggestWarmupPreset(
  account: Pick<
    AccountDoc,
    'warmingScriptDaysCompleted' | 'warmingUsedPresetSlugs' | 'deviceProfile'
  >,
): SuggestedWarmupPreset | null {
  const completed = account.warmingScriptDaysCompleted ?? 0;
  const recommended = readinessDialogsRecommended();
  if (completed >= recommended) return null;

  const slot = Math.min(completed + 1, 3) as 1 | 2 | 3;
  const used = new Set((account.warmingUsedPresetSlugs ?? []).map((s) => s.toLowerCase()));
  const lang = preferredLang(account);

  let candidates: HumanDialogPreset[] = HUMAN_DIALOG_PRESETS.map((p, i) => ({
    preset: p,
    slot: warmupSlotForPreset(p, i),
  }))
    .filter(({ preset, slot: s }) => s === slot && !used.has(preset.slug))
    .map(({ preset }) => preset);

  if (lang) {
    const byLang = candidates.filter((p) => p.lang === lang);
    if (byLang.length) candidates = byLang;
  }

  if (!candidates.length) {
    candidates = filterHumanDialogPresets(lang ? { lang } : {}).filter(
      (p) => !used.has(p.slug),
    );
  }

  const pick = candidates[0];
  if (!pick) return null;

  const idx = HUMAN_DIALOG_PRESETS.findIndex((p) => p.slug === pick.slug);
  return {
    slug: pick.slug,
    name: pick.name,
    warmupSlot: warmupSlotForPreset(pick, idx >= 0 ? idx : 0),
    reason: `Recommended dialog ${completed + 1} of ${recommended} (slot ${slot})`,
  };
}
